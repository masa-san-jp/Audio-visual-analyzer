// 目的 — WORLD-7 の決定的静止画・実再生同期・GPU読出し計測 — 構想 §1.3・§2.6
// @page harness
// tests/world/measure.mjs が world.html に注入する。既存runnerのharnessでは登録／実行しない。
function worldReflectIndex(i, n) {
  // 端画素を反復する対称折り返し: -1→0、n→n-1。
  while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1;
  return i;
}
function worldGaussian(image, w, h, sigma) {
  const radius = Math.ceil(3 * sigma), kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) { kernel[i + radius] = Math.exp(-i * i / (2 * sigma * sigma)); sum += kernel[i + radius]; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const temp = new Float64Array(image.length), out = new Float64Array(image.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let k = -radius; k <= radius; k++) v += kernel[k + radius] * image[y * w + worldReflectIndex(x + k, w)];
    temp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let k = -radius; k <= radius; k++) v += kernel[k + radius] * temp[worldReflectIndex(y + k, h) * w + x];
    out[y * w + x] = v;
  }
  return out;
}
function worldBandEnergy(rgba, width, height) {
  if (width !== 1920 || height !== 1080) throw new Error('W-2は1920×1080で測定する');
  const w = width / 4, h = height / 4, L = new Float64Array(w * h); let mean = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const p = ((y * 4 + j) * width + x * 4 + i) * 4;
      v += (.2126 * rgba[p] + .7152 * rgba[p + 1] + .0722 * rgba[p + 2]) / 255;
    }
    L[y * w + x] = v / 16; mean += v / 16;
  }
  mean /= L.length;
  const g1 = worldGaussian(L, w, h, 1), g4 = worldGaussian(L, w, h, 4);
  let high = 0, middle = 0, low = 0;
  for (let i = 0; i < L.length; i++) {
    high += (L[i] - g1[i]) ** 2; middle += (g1[i] - g4[i]) ** 2; low += (g4[i] - mean) ** 2;
  }
  const total = high + middle + low;
  return { energies: { low, middle, high }, fractions: { low: total ? low / total : 0,
    middle: total ? middle / total : 0, high: total ? high / total : 0 }, mean };
}
function worldMeanOutput(engine, scratch) {
  const gl = engine.gpu.gl, target = engine.post.output;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
  let mean = 0;
  for (let i = 0; i < scratch.length; i += 4) mean += (.2126 * scratch[i] + .7152 * scratch[i + 1] + .0722 * scratch[i + 2]) / 255;
  return mean / (target.width * target.height);
}
function worldReadHdr(engine, target = engine.scene) {
  const gl = engine.gpu.gl, data = new Float32Array(target.width * target.height * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, data);
  return data;
}
function worldParticleCoverage(before, after) {
  // 半精度の暗部丸めを除き、HDR輝度差>1e-4を可視な直接粒子として数える。
  let pixels = 0, peak = 0, total = 0, fluidEnergy = 0;
  for (let i = 0; i < before.length; i += 4) {
    const delta = .2126 * (after[i] - before[i]) + .7152 * (after[i + 1] - before[i + 1]) + .0722 * (after[i + 2] - before[i + 2]);
    fluidEnergy += .2126 * before[i] + .7152 * before[i + 1] + .0722 * before[i + 2];
    if (delta > .0001) pixels++; peak = Math.max(peak, delta); total += Math.max(0, delta);
  }
  const n = before.length / 4;
  return { visiblePixels: pixels, fraction: pixels / n, peakHdrContribution: peak, meanHdrContribution: total / n,
    particleEnergyFraction: total / Math.max(1e-12, fluidEnergy + total) };
}
function worldMatterProbe(engine) {
  const g = engine.gpu;
  g.bind(engine.composite, engine.scene);
  g.sampler(engine.dyeLoc, 0, engine.fluid.dye.read); g.sampler(engine.velocityLoc, 1, engine.fluid.velocity.read); g.draw();
  const before = worldReadHdr(engine); engine.particles.render(engine.scene);
  const result = worldParticleCoverage(before, worldReadHdr(engine));
  engine._draw(); return result;
}
// 暖色の可視面積: RGB最大値>16/255かつR>B*1.15、R>G*1.05の画素。
// 黒の量子化誤差を色面積へ数えず、ブルーム/トーンマップ後の画面で判定する。
function worldWarmFraction(rgba) {
  let warm = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > 16 && rgba[i] > rgba[i + 2] * 1.15 && rgba[i] > rgba[i + 1] * 1.05) warm++;
  }
  return warm / (rgba.length / 4);
}
async function worldV4Probe(w) {
  const engine = w.engine, u = engine.gpu.uniforms, shells = [];
  for (const section of w.score.sections.filter(s => s.kind === 'drop')) {
    const t = section.startSec + .6; await w.renderAt(t);
    const features = new MfsFrameView(); features.raw[MFS_LAYOUT.ONSET_FLAGS] = 1;
    engine._step(t, features, 1 / 60);
    // 視点／粒子位置は固定。殻の発光だけを直接HDRで比較する。
    u[8] = 0; u[11] = 0; u[75] = -100; u[31] = 100;
    engine.gpu.upload(); engine._renderMatter(); const baseline = worldReadHdr(engine);
    let maximumAliveDifference = 0, expiredDifference = 0;
    for (const age of [0, .12, .25, .4, .5]) {
      u[31] = age; engine.gpu.upload(); engine._renderMatter(); const shell = worldReadHdr(engine);
      let difference = 0;
      for (let i = 0; i < shell.length; i += 4) for (let c = 0; c < 3; c++) difference = Math.max(difference, Math.abs(shell[i + c] - baseline[i + c]));
      if (age < .4) maximumAliveDifference = Math.max(maximumAliveDifference, difference);
      else expiredDifference = Math.max(expiredDifference, difference);
    }
    shells.push({ tSec: t, maximumAliveDifference, expiredDifference,
      pass: maximumAliveDifference > 0 && expiredDifference === 0 && engine.gpu.gl.getError() === 0 });
  }
  const intro = w.score.sections.find(s => s.kind === 'intro');
  let reveal = { pass: false, reason: 'introなし' };
  if (intro) {
    await w.renderAt((intro.startSec + intro.endSec) / 2);
    u[3] = 0; u[16] = .32; engine.gpu.upload(); engine._renderMatter(); const early = worldReadHdr(engine);
    u[3] = 1; u[16] = .50; engine.gpu.upload(); engine._renderMatter(); const late = worldReadHdr(engine);
    let revealedPixels = 0, fogGain = 0;
    for (let i = 0; i < early.length; i += 4) {
      const gain = .2126 * (late[i] - early[i]) + .7152 * (late[i + 1] - early[i + 1]) + .0722 * (late[i + 2] - early[i + 2]);
      if (gain > .00001) revealedPixels++; fogGain += Math.max(0, gain);
    }
    reveal = { pass: revealedPixels > 0 && fogGain > 0 && engine.gpu.gl.getError() === 0, revealedPixels, fogGain };
  }
  return { 'BW-4-shell': { pass: shells.length > 0 && shells.every(s => s.pass), shells }, 'BW-4-intro': reveal };
}
async function worldV5Probe(w) {
  const engine = w.engine, u = engine.gpu.uniforms, samples = [];
  for (const section of w.score.sections.filter(s => s.kind === 'drop')) {
    const tSec = (section.startSec + section.endSec) / 2; await w.renderAt(tSec);
    // §2.6: dropのhistory weightは0。trailPixelsの必須判定は撤回し、直接のkick発光を測る。
    const before = worldReadHdr(engine), features = new MfsFrameView(); features.raw[MFS_LAYOUT.ONSET_FLAGS] = 1;
    engine._step(tSec, features, 1 / 60); engine._draw(); const flared = engine.capture(), after = worldReadHdr(engine);
    let flareEnergy = 0;
    for (let i = 0; i < after.length; i += 4) for (let c = 0; c < 3; c++) flareEnergy += Math.max(0, after[i + c] - before[i + c]);
    samples.push({ tSec, keyRole: engine.metrics().dropKeyRole, flareEnergy,
      flaredClippedFraction: flared.clippedFraction,
      pass: flareEnergy > 0 && flared.clippedFraction <= .02 && engine.gpu.gl.getError() === 0 });
  }
  // §2.7: 色はCPU側でモーフする。GLSLの変奏番号だけを変えて瞬時に役割交換しない。
  const g = engine.gpu, gl = g.gl, target = g.target(3, 1, true), color = new Float32Array(12);
  const program = g.program('#version 300 es\n' + WORLD_GLSL + '\nout vec4 frag;void main(){frag=vec4(worldColor(floor(gl_FragCoord.x)),1.);}');
  let first, second;
  try {
    u[76] = 2; u[13] = 1; g.upload(); g.bind(program, target); g.draw();
    gl.readPixels(0, 0, 3, 1, gl.RGBA, gl.FLOAT, color); first = Array.from(color);
    u[13] = 2; g.upload(); g.bind(program, target); g.draw();
    gl.readPixels(0, 0, 3, 1, gl.RGBA, gl.FLOAT, color); second = Array.from(color);
  } finally { g.releaseTarget(target); gl.deleteProgram(program); g.programs.splice(g.programs.indexOf(program), 1); }
  // role別の彩度/明度係数は保持するため、単位RGB色度で交換を比較する。
  const chromaticity = (rgb, offset) => {
    const sum = rgb[offset] + rgb[offset + 1] + rgb[offset + 2];
    return rgb.slice(offset, offset + 3).map(c => c / sum);
  };
  // 彩度係数(.68/.78)の差は中立成分を除いた色差の方向で比較する。
  const direction = (rgb, offset) => {
    const mean = (rgb[offset] + rgb[offset + 1] + rgb[offset + 2]) / 3;
    const c = rgb.slice(offset, offset + 3).map(v => v - mean), length = Math.hypot(...c);
    return c.map(v => v / length);
  };
  const swapError = Math.max(...direction(first, 4).map((v, i) => Math.abs(v - direction(second, 4)[i])),
    ...direction(first, 8).map((v, i) => Math.abs(v - direction(second, 8)[i])));
  const ambientError = Math.max(...chromaticity(first, 0).map((v, i) => Math.abs(v - chromaticity(second, 0)[i])));
  return { 'BW-5-light': { pass: samples.length > 0 && samples.every(s => s.pass), samples },
    'BW-5-palette': { pass: swapError < 1e-5 && ambientError < 1e-5 && gl.getError() === 0, swapError, ambientError, first, second } };
}
// WORLD-8: sRGB Yの外側0〜4%と隣接4〜8%を比較する。四隅は帯全体では一度だけ数える。
function worldEdgeBands(rgba, width, height) {
  const sums = new Float64Array(2), counts = new Uint32Array(2);
  const sideSums = new Float64Array(8), sideCounts = new Uint32Array(8);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const left = (x + .5) / width, right = 1 - left, bottom = (y + .5) / height, top = 1 - bottom;
    const distance = Math.min(left, right, bottom, top);
    if (distance >= .08) continue;
    const i = (y * width + x) * 4;
    const luminance = (.2126 * rgba[i] + .7152 * rgba[i + 1] + .0722 * rgba[i + 2]) / 255;
    const band = distance < .04 ? 0 : 1; sums[band] += luminance; counts[band]++;
    for (let side = 0; side < 4; side++) {
      const d = side === 0 ? left : side === 1 ? right : side === 2 ? bottom : top;
      if (d >= .08) continue;
      const j = side * 2 + (d < .04 ? 0 : 1); sideSums[j] += luminance; sideCounts[j]++;
    }
  }
  const outerMean = sums[0] / counts[0], innerMean = sums[1] / counts[1];
  return { pass: innerMean <= .01 || outerMean >= .6 * innerMean, outerMean, innerMean,
    ratio: innerMean > 0 ? outerMean / innerMean : null, outerPixels: counts[0], innerPixels: counts[1],
    sides: ['left', 'right', 'bottom', 'top'].map((side, i) => ({ side,
      outerMean: sideSums[i * 2] / sideCounts[i * 2], innerMean: sideSums[i * 2 + 1] / sideCounts[i * 2 + 1] })) };
}
function worldCameraMargin(engine) {
  const u = engine.gpu.uniforms, aspect = engine.canvas.width / engine.canvas.height;
  let margin = .5;
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) {
    const px = x * aspect / u[82], py = y / u[82], c = Math.cos(u[83]), s = Math.sin(u[83]);
    const ux = (c * px - s * py + u[80]) / (aspect * OVERSCAN) + .5;
    const uy = (s * px + c * py + u[81]) / OVERSCAN + .5;
    margin = Math.min(margin, ux, 1 - ux, uy, 1 - uy);
  }
  return margin;
}
async function runWorldVisualMeasurement() {
  const w = window.__world, engine = w.engine, score = w.score, sections = score.sections;
  const screenshots = new Array(sections.length).fill(null), bands = [], references = [];
  window.__worldScreenshots = screenshots; window.__worldReferences = references;
  let maxRatio = 0, hdrMin = null, hdrMax = null;
  const exposure = [], matter = [], referenceMatter = [], edges = [];
  function record(c, tSec, kind) {
    if (c.glError) throw new Error('capture GL error ' + c.glError);
    exposure.push({ tSec, kind, clippedFraction: c.clippedFraction, mean: c.mean });
    if (c.hdrRatio > maxRatio) { maxRatio = c.hdrRatio; hdrMin = c.hdrMin; hdrMax = c.hdrMax; }
  }
  for (let i = 0; i < sections.length; i++) {
    const tSec = (sections[i].startSec + sections[i].endSec) / 2;
    await w.renderAt(tSec); const c = engine.capture(); screenshots[i] = c;
    bands.push({ sectionIndex: i, targetSec: tSec, capturedSec: engine.latestSec, environment: sections[i].environment,
      ...worldBandEnergy(c.rgba, c.width, c.height) }); record(c, tSec, sections[i].kind);
    edges.push({ sectionIndex: i, tSec, kind: sections[i].kind, cameraMargin: worldCameraMargin(engine),
      ...worldEdgeBands(c.rgba, c.width, c.height) });
    matter.push({ sectionIndex: i, kind: sections[i].kind, ...worldMatterProbe(engine) });
  }
  // v1と同じ時刻を必ず保存する。曲の中央値だけで白飛びと構図の繰り返しを見逃さない。
  for (const tSec of [7, 20, 30.3, 45, 62, 90, 112]) {
    if (tSec > score.durationSec) continue;
    await w.renderAt(tSec); const c = engine.capture();
    references.push({ tSec, capture: c, environment: sections[engine.sectionIndex].environment }); record(c, tSec, 'reference');
    edges.push({ tSec, kind: 'reference', cameraMargin: worldCameraMargin(engine), ...worldEdgeBands(c.rgba, c.width, c.height) });
    referenceMatter.push({ tSec, kind: sections[engine.sectionIndex].kind, ...worldMatterProbe(engine) });
  }
  const dropRatios = [];
  const scratch = new Uint8Array(1920 * 1080 * 4);
  for (const section of sections.filter(s => s.kind === 'drop')) {
    const start = Math.max(0, section.startSec - score.beatSec);
    await w.renderAt(start);
    let beforeSum = 0, beforeN = 0, afterSum = 0, afterN = 0;
    // 固定60Hz窓を前進させる。renderAtで0から初期化済みの同じsimulationを使用する。
    const first = Math.ceil(start * 60), last = Math.ceil((section.startSec + .25) * 60);
    for (let frame = first; frame < last; frame++) {
      const tSec = frame / 60; await engine.advancePreview(tSec);
      const mean = worldMeanOutput(engine, scratch);
      if (tSec < section.startSec) { beforeSum += mean; beforeN++; } else { afterSum += mean; afterN++; }
      let clipped = 0;
      for (let i = 0; i < scratch.length; i += 4) if (scratch[i] >= 250 && scratch[i + 1] >= 250 && scratch[i + 2] >= 250) clipped++;
      exposure.push({ tSec, kind: 'drop-window', clippedFraction: clipped / (scratch.length / 4), mean });
    }
    const before = beforeN ? beforeSum / beforeN : null, after = afterN ? afterSum / afterN : null;
    const ratio = before === 0 && after > 0 ? Infinity : before > 0 ? after / before : 0;
    dropRatios.push({ tSec: section.startSec, beforeN, afterN, beforeMean: before, afterMean: after,
      ratio: ratio === Infinity ? 'Infinity' : ratio, pass: beforeN > 0 && afterN > 0 && ratio >= 10 });
  }
  // BW-3-kick: 合成MFSで低域イベントを与え、実GPUで即時の画素反応と環の進行を測る。
  const kicks = [];
  for (const section of sections.filter(s => s.kind === 'drop')) {
    const t = section.startSec + .6;
    await w.renderAt(t); const before = engine.capture();
    const features = new MfsFrameView(); features.raw[MFS_LAYOUT.ONSET_FLAGS] = 1;
    engine._step(t, features, 1 / 60); engine._draw(); const kicked = engine.capture();
    let changed = 0;
    for (let i = 0; i < before.rgba.length; i += 4) {
      if (Math.abs(before.rgba[i] - kicked.rgba[i]) + Math.abs(before.rgba[i + 1] - kicked.rgba[i + 1]) +
        Math.abs(before.rgba[i + 2] - kicked.rgba[i + 2]) > 3) changed++;
    }
    const u = engine.gpu.uniforms, anchor = [u[47], u[51], u[55]], immediateAge = u[31];
    engine._step(t + .12, null, 1 / 60); engine._draw();
    const anchorDrift = Math.hypot(u[47] - anchor[0], u[51] - anchor[1], u[55] - anchor[2]);
    kicks.push({ tSec: t, immediateAge, advancedAge: u[31], changedPixels: changed, anchorDrift,
      pass: immediateAge === 0 && Math.abs(u[31] - .12) < 1e-6 && changed > 0 && anchorDrift === 0 && engine.gpu.gl.getError() === 0 });
  }
  const coverage = matter.concat(referenceMatter), drops = coverage.filter(m => m.kind === 'drop');
  // 被覆は合成前後HDR差>0の画素（ブルーム前）。元のBW-2可視寄与基準も保持する。
  const meanCoverage = coverage.reduce((sum, m) => sum + m.fraction, 0) / coverage.length;
  // BW-2再現性: 時間を戻して同じ0.1秒を描いた画素差を実GPUで確認。
  await w.renderAt(.1); const first = engine.capture();
  await w.renderAt(.2); await w.renderAt(.1); const second = engine.capture();
  let mismatched = 0; for (let i = 0; i < first.rgba.length; i++) if (first.rgba[i] !== second.rgba[i]) mismatched++;
  const preview = { pass: mismatched === 0 && !!engine.timeline && engine.mfsFrames === engine.previewStep + 1, mismatchedChannels: mismatched, previewSteps: engine.previewStep, mfsFrames: engine.mfsFrames };
  const v4 = await worldV4Probe(w), v5 = await worldV5Probe(w), v6 = await worldV6Probe(w), v7 = await worldV7Probe(w);
  return {
    ...v4, ...v5, ...v6, ...v7,
    'BW-8-edges': { pass: edges.length > 0 && edges.every(e => e.pass && e.cameraMargin >= .03), frames: edges },
    'W-1': { pass: maxRatio >= 1000, maxHdrRatio: maxRatio, hdrMin, hdrMax },
    'W-2': { pass: bands.every(b => Object.values(b.fractions).every(v => v >= .1)), sections: bands },
    'W-5': { pass: dropRatios.length > 0 && dropRatios.every(d => d.pass), drops: dropRatios },
    'BW-2-exposure': { pass: exposure.every(e => e.clippedFraction <= .02), maximum: Math.max(...exposure.map(e => e.clippedFraction)), frames: exposure },
    'BW-2-preview': preview,
    'BW-2-matter': { pass: matter.every(m => m.visiblePixels > 0 && m.peakHdrContribution > 0), sections: matter },
    'BW-6-coverage': { pass: meanCoverage >= .05 && meanCoverage <= .25, meanCoverage, sections: coverage },
    'BW-3-hero': { pass: drops.length > 0 && drops.every(m => m.visiblePixels > 0 && m.particleEnergyFraction > 0), drops },
    'BW-3-kick': { pass: kicks.length > 0 && kicks.every(k => k.pass), kicks },
    'BW-2-environments': { pass: new Set(sections.map(s => s.environment)).size >= 4 && sections.every(s => ['mist','convergence','explosion','drift','dissipation','galaxy'].includes(s.environment)), formations: sections.map(s => s.environment) },
    references: references.map(r => ({ tSec: r.tSec, environment: r.environment, mean: r.capture.mean, clippedFraction: r.capture.clippedFraction }))
  };
}
async function worldV6Probe(w) {
  const app = w.app, root = document.documentElement, fullscreenBefore = document.fullscreenElement;
  await app.start(); const fullscreenAfterStart = document.fullscreenElement;
  await app.togglePlay();
  await app.seek(.2); const forwardSec = w.engine.latestSec;
  await app.seek(.1); const backwardSec = w.engine.latestSec;
  const seekState = app.state;
  let requests = 0;
  const original = root.requestFullscreen;
  // gestureに依存する実fullscreenの見え方は目視。ここではボタン／Fの対象を検査。
  root.requestFullscreen = async () => { requests++; };
  try {
    app.fullscreenButton.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));
    await Promise.resolve(); await Promise.resolve();
  } finally { root.requestFullscreen = original; }
  const visible = ['controls', 'file', 'play', 'seek', 'fullscreen'].every(id => {
    const node = document.getElementById(id); return !!node && !node.hidden && getComputedStyle(node).display !== 'none';
  });
  const m = w.metrics(), layers = m.layers;
  return {
    'BW-6-ui': { pass: visible && fullscreenBefore === fullscreenAfterStart && requests === 2 && forwardSec === .2 && backwardSec === .1 && seekState === 'paused',
      visible, forcedFullscreen: fullscreenBefore !== fullscreenAfterStart, requests, forwardSec, backwardSec, seekState },
    'BW-6-layers': { pass: layers.join('/') === 'ABSTRACT/FLUID/PARTICLE/LIGHT/FEEDBACK' && m.raymarchSteps === 0 && !w.engine.form,
      layers, raymarchSteps: m.raymarchSteps }
  };
}
// カメラを固定した画素差は物質の動き。RGB各channelの差合計>3で量子化を除く。
function worldFrameDifference(a, b) {
  if (a.length !== b.length) throw new Error('frame dimensions differ');
  let changed = 0, sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (delta > 3) changed++; sum += delta;
  }
  return { changedFraction: changed / (a.length / 4), meanChannelDifference: sum / (a.length / 4 * 3 * 255) };
}
function worldOccupiedTiles(capture) {
  // 3×3各領域の1%以上がsRGB Y>.005なら物質がある。中央だけの作品を診断する。
  const hits = new Uint32Array(9), pixels = new Uint32Array(9);
  for (let y = 0; y < capture.height; y++) for (let x = 0; x < capture.width; x++) {
    const tile = Math.min(2, Math.floor(y * 3 / capture.height)) * 3 + Math.min(2, Math.floor(x * 3 / capture.width));
    const i = (y * capture.width + x) * 4, p = capture.rgba;
    pixels[tile]++;
    if ((.2126 * p[i] + .7152 * p[i + 1] + .0722 * p[i + 2]) / 255 > .005) hits[tile]++;
  }
  return Array.from(hits, (v, i) => v / pixels[i]);
}
async function worldV7Probe(w) {
  const engine = w.engine, u = engine.gpu.uniforms, compositions = [], motion = [], cameras = [];
  const repeats = new Map(), intros = []; let repeatPass = true;
  for (const section of w.score.sections) {
    const t = (section.startSec + section.endSec) / 2; await w.renderAt(t);
    const c = engine.capture(), tiles = worldOccupiedTiles(c), key = section.kind + ':' + section.label;
    if (section.kind === 'intro') intros.push({ tSec: t, variation: section.variation, mean: c.mean });
    const previous = repeats.get(key);
    if (previous) {
      const difference = worldFrameDifference(previous.rgba, c.rgba);
      repeatPass &&= difference.changedFraction >= .01 &&
        (previous.composition !== section.composition || previous.camera.some((v, i) => Math.abs(v - u[80 + i]) >= .02));
    }
    repeats.set(key, { rgba: c.rgba, composition: section.composition, camera: Array.from(u.slice(80, 84)) });
    compositions.push({ kind: section.kind, variation: section.variation, composition: section.composition, tiles,
      occupied: tiles.filter(f => f >= .01).length, camera: Array.from(u.slice(80, 84)) });
    // カメラを恒等変換にしたとき、GPU上の粒子／染料合成像が変わること。
    const saved = u.slice(80, 84); u.set([0, 0, 1, 0], 80); engine.gpu.upload(); engine._renderMatter(); engine._draw();
    const difference = worldFrameDifference(c.rgba, engine.capture().rgba);
    cameras.push({ kind: section.kind, ...difference });
    u.set(saved, 80); engine.gpu.upload(); engine._renderMatter(); engine._draw();
    if (section.kind !== 'drop') continue;
    // previewの合成拍も止め、無kickの0.15秒を固定カメラで比較する。
    engine.preview = false; const kickCount = engine.kickCount, before = engine.capture();
    const originalCamera = engine._camera;
    // feedback/bloomの入力も固定カメラにする。合成後だけlensを戻すと履歴にcameraの差が混ざる。
    engine._camera = function (...args) { originalCamera.apply(this, args); u.set(saved, 80); };
    try {
      for (let step = 1; step <= 9; step++) { engine._step(t + step / 60, null, 1 / 60); engine._draw(); }
    } finally { engine._camera = originalCamera; }
    const moved = worldFrameDifference(before.rgba, engine.capture().rgba);
    const velocity = worldReadHdr(engine, engine.particles.velocity.read); let speed = 0;
    for (let i = 0; i < velocity.length; i += 4) speed += Math.hypot(velocity[i], velocity[i + 1]);
    speed /= velocity.length / 4;
    motion.push({ tSec: t, meanParticleSpeed: speed, kickCountBefore: kickCount, kickCountAfter: engine.kickCount,
      ...moved, pass: speed >= .1 && moved.changedFraction >= .01 && kickCount === engine.kickCount });
  }
  return {
    'BW-7-composition': { pass: new Set(compositions.map(c => c.composition)).size >= 4 && repeatPass &&
      compositions.every(c => c.occupied >= 6), repeatPass, sections: compositions },
    'BW-7-camera': { pass: cameras.every(c => c.changedFraction >= .01), sections: cameras },
    'BW-7-motion': { pass: motion.length > 0 && motion.every(m => m.pass), drops: motion },
    'BW-7-intro': { pass: intros.length > 0 && intros.every(s => s.mean >= .02 && s.mean <= .05), sections: intros }
  };
}
async function worldLoadMeasurement() {
  const w = window.__world;
  if (!w || !w.engine) throw new Error('World initialization failed: ' + (w && w.error));
  const signal = synthSong(48000, { bpm: 128, seed: 11 });
  const file = new File([encodeWav16(signal)], 'world-synthetic-128.wav', { type: 'audio/wav', lastModified: 1 });
  await w.app.load(file); w.engine.resize(1920, 1080);
}
async function worldStartLiveMeasurement(w) {
  // autoplay許可フラグのあるChromeで、ユーザージェスチャーを要求しないresumeを明示する。
  // start側もresume/playを同時発行するが、ここでAudioContextの失敗を分けて報告する。
  let timeout;
  try {
    await Promise.race([w.audioEngine.resume(), new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('World AudioContext resume timed out')), 10000);
    })]);
  } finally { clearTimeout(timeout); }
  if (w.audioEngine.ctx && w.audioEngine.ctx.state !== 'running') throw new Error('World AudioContext is not running');
  await w.app.start(false);
  if (w.app.state !== 'playing' || w.audio.paused) throw new Error('start(false) did not start playback');
}
async function runWorldMeasurement(visual = null) {
  const w = window.__world;
  if (!visual) { await worldLoadMeasurement(); visual = await runWorldVisualMeasurement(); }
  const score = w.score, engine = w.engine, sections = score.sections;
  const probe = new Float32Array(engine.gpu.uniforms.length);
  let checked = 0, maxDelay = 0, uniformFailures = 0, settled = false;
  // §2.7: ライブもoffline MFSの固定ステップを使う。実際の入力とUBOを同じstepで比較する。
  const originalStep = engine._step;
  engine._step = function (tSec, features, dt) {
    const flags = features ? features.onset.flags : 0, beat = features && features.tempo.beatFlag ? 1 : 0;
    const source = this.frame + 1, serial = this.gpu.uniforms[27];
    originalStep.call(this, tSec, features, dt);
    if (flags || beat) {
      const gl=this.gpu.gl;gl.bindBuffer(gl.UNIFORM_BUFFER,this.gpu.ubo);gl.getBufferSubData(gl.UNIFORM_BUFFER,0,probe);
      if(probe[8] !== (flags & 1 ? 1 : 0) || probe[9] !== (flags & 4 ? 1 : 0) || probe[10] !== beat ||
        probe[35] !== flags + beat*16 || probe[27] <= serial)uniformFailures++;
      maxDelay=Math.max(maxDelay,this.frame-source);checked++;
    }
  };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('World playback timed out')), (score.durationSec + 60) * 1000);
    let previousAudioTime = w.audio.currentTime, stagnantChecks = 0;
    const watchdog = setInterval(() => {
      if (w.app.state !== 'playing') return;
      if (w.audio.error) { finish(new Error('World media error ' + w.audio.error.code)); return; }
      if (w.audio.currentTime > previousAudioTime + .001) stagnantChecks = 0;
      else stagnantChecks++;
      previousAudioTime = w.audio.currentTime;
      if (stagnantChecks >= 20) finish(new Error('World audio clock stalled for 10 seconds'));
    }, 500);
    function finish(error) {
      if (settled) return; settled = true;
      clearTimeout(timeout); clearInterval(watchdog); engine.onFrame = null; engine._step = originalStep;
      if (error) { w.audio.pause(); reject(error); return; }
      const metrics = w.metrics();
      const motifs = Object.create(null); let motifPass = true;
      for (const s of sections) { const key = s.kind + ':' + s.label, prev = motifs[key];
        if (prev && (s.formId !== prev.formId || s.variation !== prev.variation + 1 || s.paletteRotation !== prev.paletteRotation)) motifPass = false;
        if (!prev && s.variation !== 1) motifPass = false; motifs[key] = s;
      }
      const result = {
        ...visual,
        'W-3': { pass: metrics.particleCount >= 262144 && metrics.fluidWidth > 0 && metrics.feedbackWidth > 0 && metrics.raymarchSteps === 0, ...metrics },
        'W-4': { pass: checked > 0 && maxDelay <= 1 && uniformFailures === 0 && !!engine.timeline, checked, maxDelayFrames: maxDelay, uniformFailures },
        'W-6': { pass: metrics.boundaryCount === sections.length, fired: metrics.boundaryCount, expected: sections.length, events: w.events },
        'W-7': { pass: motifPass, sections: sections.map(s => ({ kind: s.kind, label: s.label, environment: s.environment, formId: s.formId, variation: s.variation })) },
        'W-8': { pass: metrics.width === 1920 && metrics.height === 1080 && metrics.timingSamples >= 120 && metrics.renderP95Ms !== null && metrics.renderP95Ms <= 16,
          p95Ms: metrics.renderP95Ms, cpuP95Ms: metrics.cpuP95Ms, gpuP95Ms: metrics.gpuP95Ms, samples: metrics.timingSamples,
          submittedFrames: metrics.submittedFrames, disjoints: metrics.timerDisjoints },
        'BW-7-performance': { pass: metrics.width === 1920 && metrics.height === 1080 && metrics.timingSamples >= 120 &&
          metrics.gpuP95Ms !== null && metrics.gpuP95Ms <= 14, gpuP95Ms: metrics.gpuP95Ms, budgetMs: 14, samples: metrics.timingSamples },
        metrics, durationSec: score.durationSec, debugErrors: w.error || null, glError: engine.gpu.gl.getError()
      };
      window.__worldResult = result; resolve(result);
    }
    engine.onFrame = function () {
      try {
        const t = engine.latestSec;
        if (t >= score.durationSec) finish();
      } catch (error) { finish(error); }
    };
    // BW-2-start: start(false)は10秒以内に解決／拒否する。ライブの開始も独立して確認。
    worldStartLiveMeasurement(w).catch(finish);
  });
}
function worldScreenshot(index, reference = false) {
  const c = reference ? window.__worldReferences[index]?.capture : window.__worldScreenshots[index]; if (!c) return null;
  const canvas = document.createElement('canvas'); canvas.width = c.width; canvas.height = c.height;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++) image.data.set(c.rgba.subarray(y * c.width * 4, (y + 1) * c.width * 4), (c.height - 1 - y) * c.width * 4);
  ctx.putImageData(image, 0, 0); return canvas.toDataURL('image/png');
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { worldBandEnergy, worldGaussian, worldReflectIndex, worldWarmFraction, worldParticleCoverage, worldEdgeBands, worldCameraMargin }; }
