// 目的 — 世界の状態・演出・HDR合成と計測を統合する — doc/20261004-concept-world-mode.md §2.8・§4〜§5
// 切替時の現在HDR像を保持し、0.5秒で選択タイプへ連続的に溶かす。
const WORLD_TYPE_FADE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D previous, current;
uniform float blend;
out vec4 frag;
void main(){frag=mix(texture(previous,vUv),texture(current,vUv),blend);}`;
class WorldEngine {
  constructor(canvas, seed = 11) {
    this.canvas = canvas; this.seed = seed; this.gpu = new WorldGL(canvas);
    this.post = new WorldPost(this.gpu, canvas.width, canvas.height);
    this.scene = this.gpu.target(canvas.width, canvas.height);
    this.types = [new WorldFluid2Analyzer(), new WorldGargantuaAnalyzer(), new WorldAttractorAnalyzer()];
    for (let i = 0; i < this.types.length; i++) this.types[i].init(this.gpu);
    this.type = this.types[0]; this.fadeElapsed = .5; this.previousPostMode = 0;
    this.typeTarget = this.gpu.target(canvas.width, canvas.height); this.typeSnapshot = this.gpu.target(canvas.width, canvas.height);
    this.typeFade = this.gpu.program(WORLD_TYPE_FADE_FRAGMENT);
    this.previousLoc = this.gpu.texture(this.typeFade, 'previous'); this.currentLoc = this.gpu.texture(this.typeFade, 'current');
    this.blendLoc = this.gpu.texture(this.typeFade, 'blend');
    this.typeInput = { engine: this, target: this.scene, features: null, song: null, dt: 0, tSec: 0, boundaryNow: false };
    this.lastBeat = -100; this.pulse = 0;
    this.score = null; this.events = []; this.sectionIndex = 0; this.eventIndex = 0; this.downbeatIndex = 0;
    this.frame = 0; this.simTime = 0; this.cut = 0; this.lastDrop = -100; this.lastKick = -100; this.onFrame = null;
    this.beatIndex = 0; this.kickCount = 0; this.lastCut = 0;
    this.emptyFeatures = new MfsFrameView();
    this.responses = new Float64Array(16384 * 7); this.responseCount = 0;
    this.cpuTimes = new Float64Array(16384); this.gpuTimes = new Float64Array(16384); this.gpuTimes.fill(NaN);
    this.frameIntervals = new Float64Array(16384); this.timeCount = 0; this.lastTimeSlot = -1;
    const gl = this.gpu.gl; this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = []; this.queryActive = null;
    if (this.timer) for (let i = 0; i < 32; i++) this.queries.push({ query: gl.createQuery(), pending: false, slot: -1 });
    this.preview = false; this.timeline = null; this.fps = 60; this.featureView = new MfsFrameView();
    this.timerDisjoints = 0; this.gpuSamples = 0; this.mfsFrames = 0; this.latestSec = 0;
  }
  setScore(score) {
    this.score = score; this.sectionIndex = 0; this.eventIndex = 0; this.downbeatIndex = 0;
    // ログ用レコードは再生前に全件確保する（rAFからpushしない）。
    this.events = score.events.map(e => ({ tSec: e.tSec, type: e.type, sectionIndex: e.sectionIndex,
      action: e.action || '', firedFrame: -1, firedSec: -1 }));
    this.frame = 0; this.simTime = 0; this.cut = 0; this.lastDrop = -100; this.lastKick = -100;
    this.beatIndex = 0; this.kickCount = 0; this.lastCut = 0;
    this.responseCount = 0; this.timeCount = 0; this.mfsFrames = 0; this.gpuSamples = 0; this.timerDisjoints = 0;
    this.gpuTimes.fill(NaN); this.cpuTimes.fill(0); this.lastTimeSlot = -1;
    for (let i = 0; i < this.queries.length; i++) this.queries[i].slot = -1;
    // 再上演とpreviewは同じGPU状態から開始する。program/FBOを再作成しない。
    const g = this.gpu; g.uniforms.fill(0); this.post.reset();
    this.latestSec = 0; this.previewStep = 0; this.preview = false; this.matterSkipped = false;
    this.fadeElapsed = .5; this.lastBeat = -100; this.pulse = 0;
    for (let i = 0; i < this.types.length; i++) if (this.types[i].reset) this.types[i].reset();
  }

  resize(w, h) {
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w; this.canvas.height = h;
    this.post.resize(w, h);
    for (let i = 0; i < this.types.length; i++) if (this.types[i].resize) this.types[i].resize(w, h);
    this.gpu.releaseTarget(this.scene); this.scene = this.gpu.target(w, h);
    this.gpu.releaseTarget(this.typeTarget); this.gpu.releaseTarget(this.typeSnapshot);
    this.typeTarget = this.gpu.target(w, h); this.typeSnapshot = this.gpu.target(w, h); this.fadeElapsed = .5;
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
    this._beginTiming(tSec, dt);
    if (this.timeline) this.advanceTo(tSec); else this._step(tSec, features, dt);
    this._draw();
    if (this.queryActive) { this.gpu.gl.endQuery(this.timer.TIME_ELAPSED_EXT); this.queryActive = null; }
  }
  _step(tSec, features, dt, drawMatter = true) {
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
    let flags = features ? f.onset.flags : 0;
    const beat = features && f.tempo.beatFlag ? 1 : 0;
    // 音声なしpreviewにも解析済みの拍格子を使う。ライブのonsetはMFSだけを使う。
    while (this.beatIndex < score.beats.length && score.beats[this.beatIndex] <= tSec) {
      if (this.preview && s.kind === 'drop' && score.beats[this.beatIndex] >= s.startSec) flags |= 1;
      this.beatIndex++;
    }
    if (features) this.mfsFrames++;
    // 小節頭はカメラ／構図を切り替えない。拍は光だけに結びつける。
    const cutNow = false;
    const simDt = silence ? 0 : Math.max(0, dt) * (s.kind === 'break' ? .3 : 1) * (1 - anticipate * .96);
    this.simTime += simDt;
    u[0] = Math.PI * 2 * tSec / score.durationSec; u[1] = simDt; u[2] = tSec; u[3] = p;
    let low = 0, high = 0, mid = 0;
    for (let i = 0; i < 6; i++) low += f.bandsSmooth[i];
    for (let i = 22; i < 32; i++) high += f.bandsSmooth[i];
    for (let i = 6; i < 22; i++) mid += f.bandsSmooth[i];
    u[78] = mid / 16;
    u[4] = low / 6; u[5] = high / 10; u[6] = f.loudness.level; u[7] = f.tempo.beatPhase;
    u[8] = flags & 1 ? 1 : 0; u[9] = flags & 4 ? 1 : 0; u[10] = beat;
    u[11] = s.kind === 'drop' ? Math.exp(-(tSec - this.lastDrop) * 6) : 0;
    if (s.kind === 'drop' && (flags & 1)) this.lastKick = tSec;
    u[31] = s.kind === 'drop' ? tSec - this.lastKick : 100;
    u[12] = s.kindId; u[13] = s.variation; u[14] = s.formId; u[15] = anticipate;
    const brightness = s.kind === 'intro' ? .32 + p * .18 : s.kind === 'build' ? .75 * (1 - p * .7) :
      s.kind === 'drop' ? 1.4 : s.kind === 'break' ? .55 : s.kind === 'outro' ? .32 : .9;
    u[16] = silence ? 0 : brightness * s.intensity;
    u[17] = s.kind === 'build' ? p * 2.8 : s.kind === 'drop' ? -1 : .04;
    u[18] = s.kind === 'break' ? 2.4 : 1; u[19] = s.kind === 'break' ? .8 : s.kind === 'intro' ? .6 : .15;
    u[20] = .16 * Math.sin(u[0]);
    u[21] = 22 * s.worldScale;
    u[22] = s.kind === 'build' ? p * p * .025 : u[8] * .008; u[23] = s.complexity * score.song.detail;
    const invert = s.kind === 'drop';
    for (let i = 0; i < 3; i++) { u[24 + i] = invert ? s.secondary[i] : s.primary[i]; u[28 + i] = invert ? s.primary[i] : s.secondary[i]; }
    u[32] = f.chroma[0] + f.chroma[4]; u[33] = f.chroma[3] + f.chroma[7]; u[34] = f.chroma[5] + f.chroma[11];
    // イベント通番もuniformへ書く。連続フレームに同じフラグが立っても新しい反応と判別可能。
    u[35] = flags + beat * 16;
    if (flags || beat) u[27] = this.responseCount + 1;
    for (let i = 0; i < 3; i++) u[72 + i] = s.accent[i];
    u[75] = this.lastDrop;
    u[76] = s.environmentId; u[77] = s.worldScale;
    u[79] = 0;
    this._composition(s, tSec, boundaryNow, s.kind === 'drop' && !!(flags & 1));
    this._morph(s, tSec, p);
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
    if (beat) this.lastBeat = tSec;
    this.pulse = Math.exp(-Math.max(0, tSec - this.lastBeat) / WORLD_BEAT_SECONDS);
    const input = this.typeInput; input.features = f; input.song = score.song;
    input.dt = Math.max(0, dt); input.tSec = tSec; input.boundaryNow = boundaryNow;
    this.fadeElapsed = Math.min(.5, this.fadeElapsed + input.dt);
    this.type.step(input);
    if (drawMatter) {
      // CPUだけの区間から暖機窓へ入る最初のステップでGPU履歴を作り直す（アトラクター §6）。
      if (this.matterSkipped && this.type.warmStart) this.type.warmStart(tSec);
      this._renderMatter();
      // 履歴は描画した固定simulationステップで更新。captureや再描画では進めない。
    }
    this.matterSkipped = !drawMatter;
  }
  _blend(s, tSec) {
    const p = Math.max(0, Math.min(1, (tSec - s.startSec) / Math.min(4, (s.endSec - s.startSec) * .25)));
    return p * p * (3 - 2 * p);
  }
  _previous(s) { const i = this.score.sections.indexOf(s); return this.score.sections[Math.max(0, i - 1)]; }
  _morph(s, tSec, p) {
    const u = this.gpu.uniforms, previous = this._previous(s), blend = this._blend(s, tSec);
    const loop = s.kind === 'outro' ? p * p * (3 - 2 * p) : 0;
    u[108] = previous.compositionId; u[109] = previous.compositionSeed & 65535;
    u[110] = previous.vortexCount; u[111] = (previous.compositionSeed & 65535) / 65536 * Math.PI * 2;
    u[77] = (previous.worldScale + (s.worldScale - previous.worldScale) * blend) * (1 - loop) + this.score.sections[0].worldScale * loop;
    u[112] = blend; u[113] = loop; u[114] = previous.kindId; u[115] = s.kindId;
    // intro/outroの継ぎ目は解析的な霧へ収束させ、流体／履歴の初期条件を隠す。
    u[79] = s.kind === 'intro' ? p * p * (3 - 2 * p) : 1 - loop;
    for (let i = 0; i < 3; i++) {
      const oldA = previous.kind === 'drop' ? previous.secondary[i] : previous.primary[i];
      const oldB = previous.kind === 'drop' ? previous.primary[i] : previous.secondary[i];
      u[24 + i] = (oldA + (u[24 + i] - oldA) * blend) * (1 - loop) + this.score.sections[0].primary[i] * loop;
      u[28 + i] = (oldB + (u[28 + i] - oldB) * blend) * (1 - loop) + this.score.sections[0].secondary[i] * loop;
      u[72 + i] = (previous.accent[i] + (s.accent[i] - previous.accent[i]) * blend) * (1 - loop) + this.score.sections[0].accent[i] * loop;
    }
    // 規定のdrop／静寂の明暗は即時。空間・中心力・霧は連続に移行する。
    u[17] *= blend; u[18] = 1 + (u[18] - 1) * blend;
  }
  _composition(s, tSec, boundaryNow, kickNow) {
    const u = this.gpu.uniforms, aspect = this.canvas.width / this.canvas.height;
    u[84] = s.compositionId; u[85] = Math.max(1, Math.round(this.score.durationSec / 24)); u[86] = s.vortexCount;
    u[87] = (s.compositionSeed & 65535) / 65536 * Math.PI * 2;
    // 大きい2中心を曲全体で保持。kickで位置を飛ばさない。
    for (let i = 0; i < 4; i++) {
      const offset = 88 + i * 4;
      u[offset] = (i % 2 === 0 ? -1 : 1) * aspect * .22;
      u[offset + 1] = (i % 2 === 0 ? -.14 : .14);
      u[offset + 2] = i % 2 === 0 ? 1 : -1; u[offset + 3] = 0;
    }
    if (boundaryNow) this.kickCount = 0;
    if (s.kind === 'drop' && (boundaryNow || kickNow)) {
      this.kickCount++; this.lastKick = tSec; u[31] = 0;
      const index = this.kickCount % 2;
      u[105] = u[88 + index * 4]; u[106] = u[89 + index * 4]; u[107] = this.kickCount;
    }
    u[104] = Math.max(0, tSec - s.startSec);
  }
  _camera(s, tSec, p, boundaryNow, cutNow) {
    const u = this.gpu.uniforms, phase = Math.PI * 2 * tSec / this.score.durationSec;
    const old = this._previous(s), blend = this._blend(s, tSec), loop = s.kind === 'outro' ? p * p * (3 - 2 * p) : 0;
    const intro = this.score.sections[0];
    const angle = (old.cameraAngle + Math.atan2(Math.sin(s.cameraAngle - old.cameraAngle), Math.cos(s.cameraAngle - old.cameraAngle)) * blend);
    const gain = (old.worldScale + (s.worldScale - old.worldScale) * blend) * (1 - loop) + intro.worldScale * loop;
    const amplitude = .06 + .02 * (Math.sin(angle) * (1 - loop) + Math.sin(intro.cameraAngle) * loop);
    u.copyWithin(56, 40, 56);
    u[40] = .18 * Math.sin(phase); u[41] = .12 * Math.sin(phase * 2);
    // 奥行きは周期領域を前進。粒子の折返しはdepthのfadeで不可視になる。
    u[42] = tSec * .18; u[43] = this.frame === 1 ? 1 : 0;
    const fx = .05 * Math.sin(phase), fy = .025 * Math.sin(phase * 2), fz = 1 / Math.hypot(fx, fy, 1);
    u[52] = fx * fz; u[53] = fy * fz; u[54] = fz;
    const norm = Math.hypot(u[54], u[52]);
    u[44] = u[54] / norm; u[45] = 0; u[46] = -u[52] / norm;
    u[48] = u[53] * u[46]; u[49] = u[54] * u[44] - u[52] * u[46]; u[50] = -u[53] * u[44];
    u[80] = amplitude * Math.sin(phase); u[81] = amplitude * .7 * Math.sin(phase * 2);
    u[82] = 1.08 + .08 * Math.sin(phase) ** 2 + .03 * (gain - 1);
    u[83] = .12 * Math.sin(phase); this._clampCamera();
  }
  setTimeline(frames, fps) {
    if (fps !== 30 && fps !== 60) throw new RangeError('fpsは30/60です');
    this.timeline = frames; this.fps = fps;
  }
  frameFeatures(index) {
    if (!this.timeline) return null;
    return this.featureView.setPacked(this.timeline[Math.min(index, this.timeline.length - 1)]);
  }
  advanceTo(tSec) {
    // ライブ・export・renderAt共通の整数ステップ。rAFの間隔に依存しない。
    const steps = Math.floor(tSec * this.fps + 1e-9);
    if (!this.frame) this._step(0, this.frameFeatures(0), 0, this._drawMatterAt(0, steps));
    for (let i = this.previewStep + 1; i <= steps; i++) {
      const drawMatter = this._drawMatterAt(i, steps);
      this._step(i / this.fps, this.frameFeatures(i), 1 / this.fps, drawMatter); this.previewStep = i;
    }
  }
  _drawMatterAt(i, steps) {
    const type = this.type;
    // statelessRenderは末尾1枚、warmFrames（g-fluid／g-attractor）は指定窓を描く。
    // 時刻0だけの要求も従来どおり描画する。
    return steps === 0 || i > steps - (type.warmFrames || (type.statelessRender ? 1 : Infinity)) || this.fadeElapsed < .5;
  }
  // WORLD-8: 回転矩形の軸方向半径から必要ズームを解析的に求める。
  // まずパンを減らす。中心でも収まらない回転だけを減らし、過大なズームを避ける。
  _clampCamera() {
    const u = this.gpu.uniforms, aspect = this.canvas.width / this.canvas.height;
    // Float32への丸め後にも安全用フェードの外側に四隅を保つ。
    const bx = aspect * OVERSCAN * (.5 - WORLD_DOMAIN_MARGIN) - 1e-6;
    const by = OVERSCAN * (.5 - WORLD_DOMAIN_MARGIN) - 1e-6;
    const requested = u[82], angle = Math.abs(u[83]);
    const zoom = requested;
    let c = Math.abs(Math.cos(angle)), sn = Math.abs(Math.sin(angle));
    if ((aspect * c + sn) / (2 * zoom) > bx || (aspect * sn + c) / (2 * zoom) > by) {
      let lo = 0, hi = angle;
      // 原点から連続して収まる回転範囲を二分探索。割り当ては発生しない。
      for (let i = 0; i < 24; i++) {
        const a = (lo + hi) * .5, ac = Math.abs(Math.cos(a)), as = Math.abs(Math.sin(a));
        if ((aspect * ac + as) / (2 * zoom) <= bx && (aspect * as + ac) / (2 * zoom) <= by) lo = a;
        else hi = a;
      }
      u[83] = Math.sign(u[83]) * lo;
      c = Math.abs(Math.cos(u[83])); sn = Math.abs(Math.sin(u[83]));
    }
    const hx = (aspect * c + sn) * .5, hy = (aspect * sn + c) * .5;
    const px = Math.max(0, bx - hx / zoom), py = Math.max(0, by - hy / zoom);
    u[80] = Math.max(-px, Math.min(px, u[80]));
    u[81] = Math.max(-py, Math.min(py, u[81]));
    const minimumZoom = Math.max(hx / (bx - Math.abs(u[80])), hy / (by - Math.abs(u[81])));
    u[82] = Math.max(requested, minimumZoom);
  }
  selectType(id, immediate = false) {
    let next = null;
    for (let i = 0; i < this.types.length; i++) if (this.types[i].id === id) next = this.types[i];
    if (!next) throw new RangeError('未実装のGPUタイプ: ' + id);
    if (next === this.type) return;
    // 再切替時も現在の混合像を起点にする。GPU資源は選択時に増やさない。
    const gl = this.gpu.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.scene.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.typeSnapshot.fbo);
    gl.blitFramebuffer(0, 0, this.scene.width, this.scene.height, 0, 0, this.scene.width, this.scene.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    this.previousPostMode = this.post.analyzerMode;
    this.type = next; this.matterSkipped = false; if (next.reset) next.reset(); this.fadeElapsed = immediate || !this.frame ? .5 : 0;
    if (this.frame) { this.typeInput.dt = 0; this.typeInput.boundaryNow = false; next.step(this.typeInput); }
  }
  _renderMatter() {
    const input = this.typeInput, g = this.gpu;
    input.target = this.fadeElapsed < .5 ? this.typeTarget : this.scene;
    this.type.render(input);
    if (this.fadeElapsed < .5) {
      const p = this.fadeElapsed / .5;
      g.bind(this.typeFade, this.scene); g.sampler(this.previousLoc, 0, this.typeSnapshot); g.sampler(this.currentLoc, 1, this.typeTarget);
      g.gl.uniform1f(this.blendLoc, p * p * (3 - 2 * p)); g.draw();
    }
  }
  redrawTransition(dt) {
    if (!this.score || this.fadeElapsed >= .5 || !this.frame) return;
    this.fadeElapsed = Math.min(.5, this.fadeElapsed + Math.max(0, dt));
    this.typeInput.dt = 0; this.typeInput.boundaryNow = false;
    this._renderMatter(); this._draw();
  }
  _draw() {
    const p = this.fadeElapsed / .5, blend = p * p * (3 - 2 * p);
    // 詳細設計の各タイプで拍の露出・スケールを適用済み。旧postの二重pulseを止める。
    this.post.pulse = 0;
    this.post.analyzerMode = this.previousPostMode * (1 - blend) + (this.type.id === 'g-fluid' ? 0 : 1) * blend;
    this.post.gargantua = this.type.id === 'g-gargantua';
    this.post.attractor = this.type.id === 'g-attractor';
    this.post.fluid2 = this.type.id === 'g-fluid';
    this.post.kick = this.post.gargantua ? this.type.music[0] : 0;
    this.post.exposureMultiplier = this.post.gargantua ? this.type.exposureMultiplier : 1;
    this.post.render(this.scene);
  }
  _validatePreview(tSec) {
    if (!this.score) throw new Error('曲を読み込んでください');
    if (!Number.isFinite(tSec) || tSec < 0 || tSec > this.score.durationSec) throw new RangeError('preview時刻が範囲外です');
    if (this.previewBusy) throw new Error('preview描画中です');
  }
  async renderAt(tSec) {
    this._validatePreview(tSec); this.previewBusy = true;
    try {
      // 毎回0から再生する契約。状態を再利用して途中から近似することはしない。
      this.setScore(this.score); this.preview = !this.timeline;
      // 時刻0と暖機窓の条件は同期advanceToと共通。
      const steps = Math.floor(tSec * this.fps + 1e-9);
      this._step(0, this.frameFeatures(0), 0, this._drawMatterAt(0, steps));
      return await this._advancePreview(tSec);
    } finally { this.previewBusy = false; }
  }
  async advancePreview(tSec) {
    this._validatePreview(tSec);
    if ((!this.preview && !this.timeline) || tSec < this.latestSec) throw new RangeError('previewをrenderAtで初期化し、前進時刻を指定してください');
    this.previewBusy = true;
    try { return await this._advancePreview(tSec); } finally { this.previewBusy = false; }
  }
  async _advancePreview(tSec) {
    const steps = Math.floor(tSec * this.fps + 1e-9);
    for (let i = this.previewStep + 1; i <= steps; i++) {
      // renderAtの非同期ループにもadvanceToと同じ描画条件を適用する。
      const drawMatter = this._drawMatterAt(i, steps);
      this._step(i / this.fps, this.frameFeatures(i), 1 / this.fps, drawMatter); this.previewStep = i;
      // GPUキューとUIを定期的に解放する（dt・シェーダー時刻には影響しない）。
      if (i % 120 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (tSec > steps / this.fps + 1e-9) {
      if (this.timeline) this.latestSec = tSec; // 端数時刻で同じMFSイベントを二度発火しない。
      else this._step(tSec, null, 0);
    }
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
    // 旧世界流体・粒子は撤去済み（WORLD-38）。粒子数・格子はアクティブなタイプの値を返す。
    return { width: this.canvas.width, height: this.canvas.height, particleCount: this.type.particleCount || 0,
      depthParticleCount: 0, focusedFluid: this.type.id === 'g-fluid',
      typeId: this.type.id, typeBlend: this.fadeElapsed / .5, analyzerParticleCount: this.type.particleCount || 0,
      fluidWidth: this.type.velocityWidth || 0, fluidHeight: this.type.velocityHeight || 0,
      overscan: OVERSCAN, domainMargin: WORLD_DOMAIN_MARGIN,
      dyeWidth: this.type.dyeWidth || 0, dyeHeight: this.type.dyeHeight || 0, hdrFormat: 'RGBA16F',
      cpuP95Ms: p95(cpu), gpuP95Ms: p95(gpu), renderP95Ms: p95(duration), frameP95Ms: p95(intervals),
      timingSamples: duration.length, submittedFrames: this.timeCount, timerAvailable: !!this.timer,
      timerDisjoints: this.timerDisjoints, mfsFrames: this.mfsFrames, responseCount: this.responseCount,
      environment: this.score ? this.score.sections[this.sectionIndex].environment : null,
      layers: ['ABSTRACT', 'FLUID', 'PARTICLE', 'LIGHT', 'FEEDBACK'],
      formation: this.score ? this.score.sections[this.sectionIndex].environment : null,
      composition: this.score ? this.score.sections[this.sectionIndex].composition : null,
      camera2D: Array.from(this.gpu.uniforms.slice(80, 84)), kickCount: this.kickCount,
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
