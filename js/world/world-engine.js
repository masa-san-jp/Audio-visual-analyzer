// 目的 — 世界の状態・演出・HDR合成と計測を統合する — doc/20261004-concept-world-mode.md §2.6・§4〜§5
const WORLD_COMPOSITE_FRAGMENT = `#version 300 es
${WORLD_GLSL}
uniform sampler2D dye, velocity;
out vec4 frag;
void main(){
 vec2 flow=texture(velocity,vUv).xy;
 vec3 ink=texture(dye,vUv+flow*.00004).rgb;
 // HDR染料の細い輪郭を光へ変換する。建造物／地形／レイマーチは使わない。
 vec2 dx=1./vec2(textureSize(dye,0));
 vec3 edge=abs(texture(dye,vUv+dx).rgb-texture(dye,vUv-dx).rgb);
 frag=vec4((ink*.65+edge*.8)*mood.x,1);
}`;
class WorldEngine {
  constructor(canvas, seed = 11) {
    this.canvas = canvas; this.seed = seed; this.gpu = new WorldGL(canvas);
    this.fluid = new WorldFluid(this.gpu, canvas.width, canvas.height);
    this.particles = new WorldParticles(this.gpu, seed);
    this.post = new WorldPost(this.gpu, canvas.width, canvas.height);
    this.scene = this.gpu.target(canvas.width, canvas.height);
    this.composite = this.gpu.program(WORLD_COMPOSITE_FRAGMENT);
    this.dyeLoc = this.gpu.texture(this.composite, 'dye');
    this.velocityLoc = this.gpu.texture(this.composite, 'velocity');
    this.score = null; this.events = []; this.sectionIndex = 0; this.eventIndex = 0; this.downbeatIndex = 0;
    this.frame = 0; this.simTime = 0; this.cut = 0; this.lastDrop = -100; this.lastKick = -100; this.onFrame = null;
    this.emptyFeatures = new MfsFrameView();
    this.responses = new Float64Array(16384 * 7); this.responseCount = 0;
    this.cpuTimes = new Float64Array(16384); this.gpuTimes = new Float64Array(16384); this.gpuTimes.fill(NaN);
    this.frameIntervals = new Float64Array(16384); this.timeCount = 0; this.lastTimeSlot = -1;
    const gl = this.gpu.gl; this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = []; this.queryActive = null;
    if (this.timer) for (let i = 0; i < 32; i++) this.queries.push({ query: gl.createQuery(), pending: false, slot: -1 });
    this.preview = false;
    this.timerDisjoints = 0; this.gpuSamples = 0; this.mfsFrames = 0; this.latestSec = 0;
  }
  setScore(score) {
    this.score = score; this.sectionIndex = 0; this.eventIndex = 0; this.downbeatIndex = 0;
    // ログ用レコードは再生前に全件確保する（rAFからpushしない）。
    this.events = score.events.map(e => ({ tSec: e.tSec, type: e.type, sectionIndex: e.sectionIndex,
      action: e.action || '', firedFrame: -1, firedSec: -1 }));
    this.frame = 0; this.simTime = 0; this.cut = 0; this.lastDrop = -100; this.lastKick = -100;
    this.responseCount = 0; this.timeCount = 0; this.mfsFrames = 0; this.gpuSamples = 0; this.timerDisjoints = 0;
    this.gpuTimes.fill(NaN); this.cpuTimes.fill(0); this.lastTimeSlot = -1;
    for (let i = 0; i < this.queries.length; i++) this.queries[i].slot = -1;
    // 再上演とpreviewは同じGPU状態から開始する。program/FBOを再作成しない。
    const g = this.gpu; g.uniforms.fill(0); this.particles.reset(score.seed); this.fluid.reset(); this.post.reset();
    this.latestSec = 0; this.previewStep = 0; this.preview = false;
  }

  resize(w, h) {
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w; this.canvas.height = h;
    this.fluid.resize(w, h); this.post.resize(w, h);
    this.gpu.releaseTarget(this.scene); this.scene = this.gpu.target(w, h);
  }
  _beginTiming(tSec, dt) {
    const gl = this.gpu.gl;
    this.lastTimeSlot = -1;
    if (this.timer) {
      const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
      if (disjoint) this.timerDisjoints++;
      for (let i = 0; i < this.queries.length; i++) {
        const q = this.queries[i];
        if (q.pending && gl.getQueryParameter(q.query, gl.QUERY_RESULT_AVAILABLE)) {
          if (!disjoint && q.slot >= 0) {
            const ms = gl.getQueryParameter(q.query, gl.QUERY_RESULT) / 1e6;
            this.gpuTimes[q.slot] = ms; this.gpuSamples++;
          }
          q.pending = false;
        } else if (disjoint && q.pending) q.slot = -1;
      }
    }
    if (tSec < 2 || this.timeCount >= this.cpuTimes.length) return;
    const slot = this.timeCount++; this.lastTimeSlot = slot; this.frameIntervals[slot] = dt * 1000;
    if (this.timer) for (let i = 0; i < this.queries.length; i++) {
      const q = this.queries[i]; if (!q.pending) {
        q.slot = slot; q.pending = true; this.queryActive = q;
        gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q.query); break;
      }
    }
  }
  endCpuTiming(ms) { if (this.lastTimeSlot >= 0) this.cpuTimes[this.lastTimeSlot] = ms; }
  render(tSec, features, dt) {
    if (!this.score) return;
    this._beginTiming(tSec, dt); this._step(tSec, features, dt); this._draw();
    if (this.queryActive) { this.gpu.gl.endQuery(this.timer.TIME_ELAPSED_EXT); this.queryActive = null; }
  }
  _step(tSec, features, dt) {
    this.latestSec = tSec; this.frame++;
    let boundaryNow = false;
    const score = this.score, g = this.gpu, u = g.uniforms;
    while (this.eventIndex < this.events.length && this.events[this.eventIndex].tSec <= tSec) {
      const e = this.events[this.eventIndex++]; e.firedFrame = this.frame; e.firedSec = tSec;
      if (e.type === 'boundary') { this.sectionIndex = e.sectionIndex; this.cut = 0; boundaryNow = true;
        if (score.sections[e.sectionIndex].kind === 'drop') this.lastDrop = e.tSec; }
    }
    const s = score.sections[this.sectionIndex], p = Math.min(1, Math.max(0, (tSec - s.startSec) / (s.endSec - s.startSec)));
    const silence = tSec >= s.silenceSec && tSec < s.endSec;
    const anticipate = tSec >= s.foreshadowSec ? Math.min(1, (tSec - s.foreshadowSec) / Math.max(.001, s.endSec - s.foreshadowSec)) : 0;
    const f = features || this.emptyFeatures;
    const flags = features ? f.onset.flags : 0, beat = features && f.tempo.beatFlag ? 1 : 0;
    if (features) this.mfsFrames++;
    // 小節頭は解析済みの格子を使う。ライブの拍イベントは光学反応に直結する。
    let cutNow = false;
    while (this.downbeatIndex < score.downbeats.length && score.downbeats[this.downbeatIndex] <= tSec) {
      if (s.kind === 'drop' && score.downbeats[this.downbeatIndex] >= s.startSec) { this.cut++; cutNow = true; } this.downbeatIndex++;
    }
    const simDt = silence ? 0 : Math.min(.033, Math.max(0, dt)) * (s.kind === 'break' ? .3 : 1) * (1 - anticipate * .96);
    this.simTime += simDt;
    u[0] = this.simTime; u[1] = simDt; u[2] = tSec; u[3] = p;
    let low = 0, high = 0;
    for (let i = 0; i < 6; i++) low += f.bands[i];
    for (let i = 22; i < 32; i++) high += f.bands[i];
    u[4] = low / 6; u[5] = high / 10; u[6] = f.loudness.level; u[7] = f.tempo.beatPhase;
    u[8] = flags & 1 ? 1 : 0; u[9] = flags & 4 ? 1 : 0; u[10] = beat;
    u[11] = s.kind === 'drop' ? Math.exp(-(tSec - this.lastDrop) * 6) : 0;
    if (s.kind === 'drop' && (flags & 1)) this.lastKick = tSec;
    u[31] = s.kind === 'drop' ? tSec - this.lastKick : 100;
    u[12] = s.kindId; u[13] = s.variation; u[14] = s.formId; u[15] = anticipate;
    const brightness = s.kind === 'intro' ? .07 + p * .18 : s.kind === 'build' ? .75 * (1 - p * .7) :
      s.kind === 'drop' ? 1.4 : s.kind === 'break' ? .55 : s.kind === 'outro' ? (1 - p) ** 2 : .9;
    u[16] = silence || tSec >= score.durationSec ? 0 : brightness * s.intensity;
    u[17] = s.kind === 'build' ? p * 2.8 : s.kind === 'drop' ? -1 : .04;
    u[18] = s.kind === 'break' ? 2.4 : 1; u[19] = s.kind === 'break' ? .8 : s.kind === 'intro' ? .6 : .15;
    u[20] = s.cameraAngle + (s.kind === 'drop' ? this.cut * 1.618 : this.simTime * (s.kind === 'break' ? .006 : .025));
    u[21] = 22 * s.worldScale;
    u[22] = s.kind === 'build' ? p * p * .025 : u[8] * .008; u[23] = s.complexity;
    const invert = s.kind === 'drop';
    for (let i = 0; i < 3; i++) { u[24 + i] = invert ? s.secondary[i] : s.primary[i]; u[28 + i] = invert ? s.primary[i] : s.secondary[i]; }
    u[32] = f.chroma[0] + f.chroma[4]; u[33] = f.chroma[3] + f.chroma[7]; u[34] = f.chroma[5] + f.chroma[11];
    // イベント通番もuniformへ書く。連続フレームに同じフラグが立っても新しい反応と判別可能。
    u[35] = flags + beat * 16;
    if (flags || beat) u[27] = this.responseCount + 1;
    for (let i = 0; i < 3; i++) u[72 + i] = s.accent[i];
    u[75] = this.lastDrop;
    u[76] = s.environmentId; u[77] = s.worldScale;
    u[78] = 0; u[79] = 0;
    this._camera(s, tSec, p, boundaryNow, cutNow);
    // 衝撃環の中心はイベント時に固定。カメラ移動で殻を引きずらない。
    if (s.kind === 'drop' && (boundaryNow || (flags & 1))) {
      u[47] = u[40] + u[52] * 12 * s.worldScale;
      u[51] = u[41] + u[53] * 12 * s.worldScale;
      u[55] = u[42] + u[54] * 12 * s.worldScale;
    }
    u[36] = this.canvas.width; u[37] = this.canvas.height; u[38] = s.density; u[39] = silence ? 1 : 0;
    g.upload();
    if (flags || beat) {
      const i = this.responseCount * 7;
      if (i + 7 <= this.responses.length) {
        this.responses[i] = this.frame; this.responses[i + 1] = flags; this.responses[i + 2] = beat;
        this.responses[i + 3] = u[8]; this.responses[i + 4] = u[9]; this.responses[i + 5] = u[10];
        this.responses[i + 6] = this.frame; this.responseCount++;
      }
    }
    if (dt > 0) this.fluid.step();
    if (dt > 0 || this.frame === 1 || boundaryNow) this.particles.step(this.fluid);
    this._renderMatter();
    // 履歴は固定simulationステップで更新。captureや再描画では進めない。
    if (dt > 0 || this.frame === 1 || boundaryNow) this.post.stepFeedback(this.scene, this.fluid);
  }
  _camera(s, tSec, p, boundaryNow, cutNow) {
    const u = this.gpu.uniforms, local = tSec - s.startSec, scale = s.worldScale;
    u.copyWithin(56, 40, 56);
    let x = 0, y = 0, z = 0, fx = 0, fy = 0, fz = 1, roll = 0;
    if (s.kind === 'intro') { x = Math.sin(local * .06) * .3; y = .2; z = local * .25; fx = .08; }
    else if (s.kind === 'build') {
      z = (local * .9 + local * p * p * 3) * s.cameraSpeed; x = .35 * Math.sin(z * .06); y = Math.sin(local * .12) * .18;
      fx = Math.sin(local * .09) * .06; fy = Math.cos(local * .13) * .03; roll = p * p * .22;
    } else if (s.kind === 'drop') {
      z = local * 4 * s.cameraSpeed;
      const angle = s.cameraAngle + this.cut * 1.618;
      if (s.variation === 1) {
        x = .5 * Math.sin(z * .025); y = .3 * Math.sin(local * .17);
        fx = (this.cut % 2 === 0 ? -1 : 1) * .85; fy = Math.cos(angle * 1.3) * .2;
        roll = Math.sin(angle) * .16;
      } else {
        // 第二dropの螺旋変奏。基底は計測互換、抽象の回転はcamera.xで駆動する。
        const orbit = local * .28 + s.cameraAngle;
        x = Math.cos(orbit) * 3.4; y = Math.sin(orbit) * 2.8;
        fx = -Math.sin(orbit) * .8 + (this.cut % 2 === 0 ? -.9 : .9);
        fy = Math.cos(orbit) * .4; roll = Math.sin(orbit) * .38;
      }
    } else if (s.kind === 'break') { x = Math.sin(local * .04) * .5; y = 2.8; z = local * .5 * s.cameraSpeed; fx = .16; fy = .12; roll = -.035; }
    else { x = Math.sin(local * .04) * 5; y = 17.5 + Math.sin(local * .08); z = local * 4 * s.cameraSpeed; fx = -.1; fy = -.24; roll = .06; }
    const inv = 1 / Math.hypot(fx, fy, fz); fx *= inv; fy *= inv; fz *= inv;
    const rInv = 1 / Math.hypot(fz, fx), rx = fz * rInv, rz = -fx * rInv;
    const ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx, c = Math.cos(roll), sn = Math.sin(roll);
    u[40] = x * scale; u[41] = y * scale; u[42] = z * scale; u[43] = boundaryNow ? 1 : 0;
    u[44] = rx * c + ux * sn; u[45] = uy * sn; u[46] = rz * c + uz * sn;
    u[48] = ux * c - rx * sn; u[49] = uy * c; u[50] = uz * c - rz * sn;
    u[52] = fx; u[53] = fy; u[54] = fz;
    if (boundaryNow || cutNow) u.copyWithin(56, 40, 56);
  }
  _renderMatter() {
    const g = this.gpu;
    g.bind(this.composite, this.scene);
    g.sampler(this.dyeLoc, 0, this.fluid.dye.read); g.sampler(this.velocityLoc, 1, this.fluid.velocity.read); g.draw();
    this.particles.render(this.scene);
  }
  _draw() { this.post.render(this.scene); }
  _validatePreview(tSec) {
    if (!this.score) throw new Error('曲を読み込んでください');
    if (!Number.isFinite(tSec) || tSec < 0 || tSec > this.score.durationSec) throw new RangeError('preview時刻が範囲外です');
    if (this.previewBusy) throw new Error('preview描画中です');
  }
  async renderAt(tSec) {
    this._validatePreview(tSec); this.previewBusy = true;
    try {
      // 毎回0から再生する契約。状態を再利用して途中から近似することはしない。
      this.setScore(this.score); this.preview = true; this._step(0, null, 0);
      return await this._advancePreview(tSec);
    } finally { this.previewBusy = false; }
  }
  async advancePreview(tSec) {
    this._validatePreview(tSec);
    if (!this.preview || tSec < this.latestSec) throw new RangeError('previewをrenderAtで初期化し、前進時刻を指定してください');
    this.previewBusy = true;
    try { return await this._advancePreview(tSec); } finally { this.previewBusy = false; }
  }
  async _advancePreview(tSec) {
    const steps = Math.floor(tSec * 60 + 1e-9);
    for (let i = this.previewStep + 1; i <= steps; i++) {
      this._step(i / 60, null, 1 / 60); this.previewStep = i;
      // GPUキューとUIを定期的に解放する（dt・シェーダー時刻には影響しない）。
      if (i % 120 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (tSec > steps / 60 + 1e-9) this._step(tSec, null, 0);
    this._draw(); return this.metrics();
  }

  clear() { const gl = this.gpu.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
  metrics() {
    // 外部からの明示呼び出しのみ。rAFでは呼ばず、ソートの割り当てをホットパスから隔離。
    const cpu = Array.from(this.cpuTimes.subarray(0, this.timeCount));
    const gpu = Array.from(this.gpuTimes.subarray(0, this.timeCount)).filter(Number.isFinite);
    const duration = cpu.map((c, i) => Number.isFinite(this.gpuTimes[i]) ? Math.max(c, this.gpuTimes[i]) : NaN).filter(Number.isFinite);
    const intervals = Array.from(this.frameIntervals.subarray(0, this.timeCount));
    const p95 = a => { a.sort((x, y) => x - y); return a.length ? a[Math.ceil(a.length * .95) - 1] : null; };
    return { width: this.canvas.width, height: this.canvas.height, particleCount: this.particles.count,
      fluidWidth: this.fluid.velocity.read.width, fluidHeight: this.fluid.velocity.read.height,
      feedbackWidth: this.post.feedback.read.width, feedbackHeight: this.post.feedback.read.height, hdrFormat: 'RGBA16F',
      cpuP95Ms: p95(cpu), gpuP95Ms: p95(gpu), renderP95Ms: p95(duration), frameP95Ms: p95(intervals),
      timingSamples: duration.length, submittedFrames: this.timeCount, timerAvailable: !!this.timer,
      timerDisjoints: this.timerDisjoints, mfsFrames: this.mfsFrames, responseCount: this.responseCount,
      environment: this.score ? this.score.sections[this.sectionIndex].environment : null,
      layers: ['ABSTRACT', 'FLUID', 'PARTICLE', 'LIGHT', 'FEEDBACK'],
      formation: this.score ? this.score.sections[this.sectionIndex].environment : null,
      dropKeyRole: this.score && this.score.sections[this.sectionIndex].kind === 'drop' ?
        (this.score.sections[this.sectionIndex].variation === 1 ? 'accent' : 'secondary') : null,
      raymarchSteps: 0, previewSteps: this.previewStep || 0,
      frame: this.frame, tSec: this.latestSec, sectionIndex: this.sectionIndex,
      boundaryCount: this.events.filter(e => e.type === 'boundary' && e.firedFrame >= 0).length,
      expectedBoundaryCount: this.score ? this.score.sections.length : 0 };
  }
  capture() {
    // GPU readback は計測専用。通常の描画経路では実行しない。
    const gl = this.gpu.gl, n = this.canvas.width * this.canvas.height;
    const rgba = new Uint8Array(n * 4), hdr = new Float32Array(n * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.post.output.fbo); gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo); gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.FLOAT, hdr);
    let min = Infinity, max = 0, mean = 0, clipped = 0;
    for (let i = 0; i < n * 4; i += 4) {
      const y = .2126 * hdr[i] + .7152 * hdr[i + 1] + .0722 * hdr[i + 2]; min = Math.min(min, y); max = Math.max(max, y);
      if (rgba[i] >= 250 && rgba[i + 1] >= 250 && rgba[i + 2] >= 250) clipped++;
      mean += (.2126 * rgba[i] + .7152 * rgba[i + 1] + .0722 * rgba[i + 2]) / 255;
    }
    return { width: this.canvas.width, height: this.canvas.height, rgba, hdrMin: min, hdrMax: max,
      hdrRatio: max / Math.max(min, 1e-6), mean: mean / n, clippedFraction: clipped / n, glError: gl.getError() };
  }
  dispose() {
    for (let i = 0; i < this.queries.length; i++) this.gpu.gl.deleteQuery(this.queries[i].query);
    this.gpu.dispose();
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldEngine }; }
