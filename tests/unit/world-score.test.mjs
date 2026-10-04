// 目的 — WORLD-7 の決定性・全境界・モチーフ・先読みを検証する — 構想 §4
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';
const { get } = loadClassic(['js/vis-utils.js', 'js/world/score.js']);
const compile = get('compileWorldScore');
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/songmap-128.json', import.meta.url)));

test('UW-01 compileWorldScore: 同じ曲とseedで完全一致・入力不変', () => {
  const original = JSON.stringify(fixture);
  const a = compile(fixture, 11), b = compile(fixture, 11);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(fixture), original);
  assert.notDeepEqual(a, compile(fixture, 12));
  console.log('UW-01 sections=' + a.sections.length + ' events=' + a.events.length);
});
test('UW-02 全セクション開始と終端・静寂・2小節の予兆', () => {
  const score = compile(fixture, 11), boundaries = score.events.filter(e => e.type === 'boundary');
  assert.equal(boundaries.length, fixture.sections.length);
  for (let i = 0; i < boundaries.length; i++) {
    assert.equal(boundaries[i].tSec, fixture.sections[i].startSec);
    assert.equal(boundaries[i].sectionIndex, i);
    if (fixture.sections[i].kind === 'drop') assert.equal(boundaries[i].action, 'phase-transition');
    if (i + 1 < score.sections.length && score.sections[i + 1].kind === 'drop') {
      assert.equal(score.sections[i].silenceSec, Math.max(score.sections[i].startSec, score.sections[i].endSec - score.beatSec));
      assert.equal(score.sections[i].foreshadowSec, Math.max(score.sections[i].startSec, score.sections[i].endSec - score.beatSec * 8));
      assert.ok(score.events.some(e => e.type === 'silence' && e.sectionIndex === i));
    }
  }
  assert.equal(score.events.at(-1).type, 'end'); assert.equal(score.events.at(-1).tSec, fixture.durationSec);
  for (let i = 1; i < score.events.length; i++) assert.ok(score.events[i].tSec >= score.events[i - 1].tSec);
});
test('UW-03 同ラベルの形態・パレット固定、kind/label別変奏、強度と複雑さの成長', () => {
  const score = compile(fixture, 77), motifs = new Map(), repeats = new Map();
  for (const s of score.sections) {
    assert.ok(s.formId >= 0 && s.formId < 6);
    const motif = motifs.get(s.label), key = s.kind + ':' + s.label, prev = repeats.get(key);
    if (motif) { assert.equal(s.formId, motif.formId); assert.equal(s.paletteRotation, motif.paletteRotation); }
    if (prev) {
      assert.equal(s.variation, prev.variation + 1); assert.ok(s.intensity > prev.intensity);
      assert.ok(s.density >= prev.density); assert.ok(s.complexity > prev.complexity);
      assert.ok(s.worldScale > prev.worldScale); assert.ok(s.cameraSpeed > prev.cameraSpeed);
      assert.notDeepEqual(s.primary, prev.primary); assert.notDeepEqual(s.accent, prev.accent);
    } else assert.equal(s.variation, 1);
    motifs.set(s.label, s); repeats.set(key, s);
  }
  assert.deepEqual(score.sections.map(s => s.variation), [1, 1, 1, 1, 2, 1]);
  assert.deepEqual(score.sections.map(s => s.environment), ['mist', 'convergence', 'explosion', 'drift', 'explosion', 'dissipation']);
  assert.equal(new Set(score.sections.map(s => s.environment)).size, 5);
  console.log('UW-03 formations=5 variations=' + score.sections.map(s => s.variation).join(','));
});
test('UW-04 六つの形態族・main・短い先読み・和音固有パレット', () => {
  const map = { bpm: 120, beats: [0, .5, 1], downbeatIndices: [0], durationSec: 10,
    sections: ['intro', 'build', 'drop', 'break', 'main', 'outro'].map((kind, i) =>
      ({ startSec: i, endSec: i === 5 ? 10 : i + 1, kind, label: 'label' + i })) };
  const forms = new Set();
  for (let seed = 0; seed < 100; seed++) for (const s of compile(map, seed).sections) forms.add(s.formId);
  assert.equal(forms.size, 6);
  const score = compile(map, 11); assert.equal(score.sections[1].foreshadowSec, 1); assert.equal(score.sections[1].silenceSec, 1.5);
  assert.equal(score.events.find(e => e.sectionIndex === 4 && e.type === 'boundary').action, 'morph');
  const c = compile({ ...map, worldChroma: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, 11);
  const g = compile({ ...map, worldChroma: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0] }, 11);
  assert.notDeepEqual(c.palette, g.palette);
});

const measurement = loadClassic(['tests/browser/world.test.js']);
test('UW-05 W-2計測: DC除去・対称折返し・Gaussian定数保存・3帯正規化', () => {
  const gaussian = measurement.get('worldGaussian'), reflect = measurement.get('worldReflectIndex');
  assert.deepEqual([-2, -1, 0, 3, 4, 5].map(i => reflect(i, 4)), [1, 0, 0, 3, 3, 2]);
  const constant = new Float64Array(8 * 6).fill(.4);
  for (const value of gaussian(constant, 8, 6, 4)) assert.ok(Math.abs(value - .4) < 1e-14);
  const rgba = new Uint8Array(1920 * 1080 * 4);
  const energy = measurement.get('worldBandEnergy');
  assert.deepEqual(energy(rgba, 1920, 1080).fractions, { low: 0, middle: 0, high: 0 });
  for (let y = 0; y < 1080; y++) for (let x = 0; x < 1920; x++) {
    const v = Math.round(128 + 35 * Math.sin(x / 130) + 35 * Math.sin(x / 13) + 35 * Math.sin(x / 2.7));
    const p = (y * 1920 + x) * 4; rgba[p] = v; rgba[p + 1] = v; rgba[p + 2] = v; rgba[p + 3] = 255;
  }
  const result = energy(rgba, 1920, 1080), f = result.fractions;
  assert.ok(Math.abs(f.low + f.middle + f.high - 1) < 1e-12);
  assert.ok(Object.values(f).every(v => v > 0));
  console.log('UW-05 synthetic band fractions=' + JSON.stringify(f));
});

// WebGLの命令契約を監査する。GLSLのコンパイル／描画品質／性能は実Chromeのみが検証する。
function worldCommandGl() {
  let id = 1, activeUnit = 0, currentProgram = null, currentFbo = null;
  const textures = new Map(), attachments = new Map(), samplers = new Map(), modes = new Map();
  const calls = [], gl = { calls, NO_ERROR: 0, INVALID_INDEX: 0xffffffff };
  for (const name of ['UNIFORM_BUFFER', 'DYNAMIC_DRAW', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS',
    'TEXTURE_2D', 'RGBA8', 'RGBA32F', 'RGBA16F', 'NEAREST', 'LINEAR', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER',
    'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'FRAMEBUFFER', 'READ_FRAMEBUFFER', 'DRAW_FRAMEBUFFER',
    'COLOR_ATTACHMENT0', 'COLOR_ATTACHMENT1', 'FRAMEBUFFER_COMPLETE', 'COLOR_BUFFER_BIT', 'TRIANGLES', 'POINTS',
    'BLEND', 'ONE', 'RGBA', 'FLOAT', 'UNSIGNED_BYTE']) gl[name] = id++;
  gl.TEXTURE0 = 1000;
  for (const name of ['createVertexArray', 'createBuffer', 'createShader', 'createProgram', 'createTexture', 'createFramebuffer']) gl[name] = () => ({ id: id++ });
  for (const name of ['bindVertexArray', 'bindBuffer', 'bufferData', 'bindBufferBase', 'shaderSource', 'compileShader',
    'deleteShader', 'attachShader', 'linkProgram', 'uniformBlockBinding', 'texStorage2D', 'texParameteri', 'viewport',
    'clearColor', 'clear', 'uniform2f', 'uniform1f', 'blitFramebuffer', 'enable', 'blendFunc', 'disable',
    'deleteTexture', 'deleteFramebuffer', 'deleteProgram', 'deleteBuffer', 'deleteVertexArray', 'texSubImage2D', 'drawBuffers']) gl[name] = () => {};
  gl.getExtension = name => name === 'EXT_disjoint_timer_query_webgl2' ? null : {};
  gl.getShaderParameter = gl.getProgramParameter = () => true;
  gl.getUniformBlockIndex = () => 0;
  gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_COMPLETE;
  gl.getUniformLocation = (p, name) => ({ p, name });
  gl.useProgram = p => { currentProgram = p; };
  gl.activeTexture = unit => { activeUnit = unit - gl.TEXTURE0; };
  gl.bindTexture = (type, tex) => textures.set(activeUnit, tex);
  gl.bindFramebuffer = (type, fbo) => { if (type !== gl.READ_FRAMEBUFFER) currentFbo = fbo; };
  gl.framebufferTexture2D = (type, attachment, target, tex) => {
    if (!attachments.has(currentFbo)) attachments.set(currentFbo, new Map());
    attachments.get(currentFbo).set(attachment, tex);
  };
  gl.uniform1i = (loc, value) => {
    if (loc.name === 'mode') modes.set(loc.p, value);
    else if (['maxSteps', 'firstPass'].includes(loc.name)) {}
    else {
      if (!samplers.has(loc.p)) samplers.set(loc.p, new Map());
      samplers.get(loc.p).set(loc.name, value);
    }
  };
  gl.bufferSubData = (type, offset, data) => { gl.lastUniforms = Array.from(data); };
  gl.drawArrays = (type, first, count) => {
    for (const unit of (samplers.get(currentProgram) || new Map()).values()) {
      for (const tex of (attachments.get(currentFbo) || new Map()).values()) assert.notEqual(textures.get(unit), tex, '読み取りと描画先のtexture feedback禁止');
    }
    calls.push({ type, count, mode: modes.get(currentProgram) });
  };
  return gl;
}
test('UW-06 GPU命令: 流体射影20反復・全粒子・同時合成・MFS即時uniform・全境界', () => {
  const gl = worldCommandGl(), canvas = { width: 1920, height: 1080, getContext: () => gl };
  gl.canvas = canvas;
  const runtime = loadClassic(['js/vis-utils.js', 'js/mfs-const.js', 'js/mfs-view.js', 'js/world/gl-util.js',
    'js/world/fluid.js', 'js/world/particles.js', 'js/world/post.js', 'js/world/score.js', 'js/world/world-engine.js']);
  const engine = new (runtime.get('WorldEngine'))(canvas), score = runtime.get('compileWorldScore')(fixture, 11);
  const features = new (runtime.get('MfsFrameView'))(), layout = runtime.get('MFS_LAYOUT');
  engine.setScore(score);
  const first = score.sections.find(s => s.kind === 'drop');
  features.raw[layout.ONSET_FLAGS] = 15; features.raw[layout.BEAT_FLAG] = 1;
  engine.render(first.startSec, features, 1 / 60);
  assert.equal(gl.calls.filter(c => c.mode === 5).length, 20);
  assert.equal(gl.calls.filter(c => c.type === gl.POINTS)[0].count, 262144);
  assert.deepEqual(gl.lastUniforms.slice(8, 11), [1, 1, 1]); assert.equal(gl.lastUniforms[35], 31);
  assert.equal(engine.responses[6] - engine.responses[0], 0);
  assert.equal(gl.lastUniforms[11], 1); assert.equal(gl.lastUniforms[17], -1);
  assert.deepEqual(gl.lastUniforms.slice(24, 27), Array.from(new Float32Array(first.secondary)));
  engine.setScore(score);
  const preceding = score.sections.find(s => s.silenceSec < Infinity);
  engine.render(preceding.silenceSec + .01, null, 1 / 60);
  assert.equal(gl.lastUniforms[16], 0); assert.equal(gl.lastUniforms[39], 1); assert.equal(gl.lastUniforms[1], 0);
  engine.render(score.durationSec, null, 0);
  assert.equal(engine.events.filter(e => e.type === 'boundary' && e.firedFrame >= 0).length, fixture.sections.length);
  assert.equal(engine.events.at(-1).type, 'end'); assert.ok(engine.events.at(-1).firedFrame >= 0);
  assert.equal(engine.metrics().particleCount, 262144); assert.equal(engine.metrics().fluidWidth, 720);
  console.log('UW-06 pressureIterations=20 particles=262144 fluid=720x405 boundaryCoverage=6/6 mockUniformLatencyFrames=0');
});

test('UW-07 曲の三色だけで全抽象状態を配色・種別をまたぐラベルの独立変奏', () => {
  const map = { ...fixture, sections: ['intro', 'break', 'outro', 'main', 'build', 'drop', 'drop', 'break'].map((kind, i) =>
    ({ startSec: i, endSec: i + 1, kind, label: 'A' })), durationSec: 8 };
  const score = compile(map, 12), colors = Object.values(score.palette).map(c => JSON.stringify(c));
  assert.equal(new Set(colors).size, 3);
  for (const s of score.sections) {
    for (const color of [s.primary, s.secondary, s.accent]) assert.ok(colors.includes(JSON.stringify(color)));
    assert.equal(s.formId, score.sections[0].formId); assert.equal(s.paletteRotation, score.sections[0].paletteRotation);
  }
  assert.deepEqual(score.sections.map(s => s.variation), [1, 1, 1, 1, 1, 1, 2, 2]);
  assert.equal(score.sections[3].environment, 'galaxy');
  console.log('UW-07 paletteColors=3 kindLabelVariations=' + score.sections.map(s => s.variation));
});
function worldTestEngine() {
  const gl = worldCommandGl(), canvas = { width: 1920, height: 1080, getContext: () => gl }; gl.canvas = canvas;
  const runtime = loadClassic(['js/vis-utils.js', 'js/mfs-const.js', 'js/mfs-view.js', 'js/world/gl-util.js',
    'js/world/fluid.js', 'js/world/particles.js', 'js/world/post.js', 'js/world/score.js', 'js/world/world-engine.js']);
  const engine = new (runtime.get('WorldEngine'))(canvas); engine.setScore(runtime.get('compileWorldScore')(fixture, 11));
  return { engine, gl };
}
test('UW-08 renderAt: 0から固定60Hz・音声不要・逆向きと反復でuniform一致', async () => {
  const { engine, gl } = worldTestEngine();
  await engine.renderAt(.1); const initial = Array.from(engine.gpu.uniforms);
  assert.equal(engine.previewStep, 6); assert.equal(engine.mfsFrames, 0); assert.equal(engine.responseCount, 0);
  assert.equal(engine.latestSec, .1); assert.equal(engine.metrics().raymarchSteps, 0);
  await engine.renderAt(.2); await engine.renderAt(.1);
  assert.deepEqual(Array.from(engine.gpu.uniforms), initial);
  await engine.renderAt(.105); assert.equal(engine.previewStep, 6); assert.equal(engine.latestSec, .105);
  await assert.rejects(engine.renderAt(-1), RangeError); await assert.rejects(engine.renderAt(NaN), RangeError);
  assert.ok(gl.calls.some(c => c.type === gl.POINTS && c.count === 262144));
  assert.equal(engine.post.meter.at(-1).width, 1); assert.equal(engine.post.meter.at(-1).height, 1);
  console.log('UW-08 fixedSteps=6 dt=1/60 repeatUniformDifference=0 meterLevels=' + engine.post.meter.length);
});
test('UW-09 全抽象状態のcamera基底・前進加速・cut時のmotion履歴・drop再登場の拡大', () => {
  const { engine } = worldTestEngine(), u = engine.gpu.uniforms, s = engine.score.sections;
  const basis = () => {
    for (const offset of [44, 48, 52]) assert.ok(Math.abs(Math.hypot(...u.slice(offset, offset + 3)) - 1) < 1e-6);
    for (const [a, b] of [[44, 48], [44, 52], [48, 52]]) {
      let dot = 0; for (let i = 0; i < 3; i++) dot += u[a + i] * u[b + i]; assert.ok(Math.abs(dot) < 1e-6);
    }
  };
  for (const section of s) { engine._camera(section, section.startSec + 1, .1, true, false); basis();
    assert.deepEqual(u.slice(40, 56), u.slice(56, 72)); }
  const build = s[1], duration = build.endSec - build.startSec;
  engine._camera(build, build.startSec + 1, 1 / duration, false, false); const z1 = u[42];
  engine._camera(build, build.startSec + 2, 2 / duration, false, false); const speed1 = u[42] - z1;
  engine._camera(build, build.startSec + 10, 10 / duration, false, false); const z2 = u[42];
  engine._camera(build, build.startSec + 11, 11 / duration, false, false); const speed2 = u[42] - z2;
  assert.ok(speed2 > speed1 * 2);
  engine._camera(s[2], s[2].startSec + 1, .1, false, true); const first = u[42];
  engine._camera(s[4], s[4].startSec + 1, .1, false, true); assert.ok(u[42] > first * 2);
  console.log('UW-09 cameraEarlySpeed=' + speed1.toFixed(3) + ' lateSpeed=' + speed2.toFixed(3) + ' secondDropScale=' + s[4].worldScale);
});
function worldStartApp(resume, play, timers = {}) {
  const calls = [], document = { fullscreenElement: null, body: { classList: { add: () => {} } } };
  const runtime = loadClassic(['js/world/world-app.js'], { SongMapService: class {}, document,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout });
  const app = Object.create(runtime.get('WorldApp').prototype);
  Object.assign(app, { score: {}, state: 'ready', public: {}, prompt: { hidden: false }, canvas: {}, _updateControls: () => {}, engine: {
    events: [], setScore: () => calls.push('reset') }, audioEngine: {
    resetAnalysis: () => {}, resume: () => { calls.push('resume'); return resume(); } },
    audio: { currentTime: 0, play: () => { calls.push('play'); return play(); }, pause: () => calls.push('pause') }, _tickBound: () => {} });
  return { app, calls };
}
test('UW-10 start(false): resume待ち中にもplayを発行・全画面不要・停止待ちをタイムアウト', async () => {
  let unlock;
  const resuming = new Promise(resolve => { unlock = resolve; });
  const { app, calls } = worldStartApp(() => resuming, () => { unlock(); return Promise.resolve(); });
  await app.start(false);
  assert.deepEqual(calls, ['reset', 'resume', 'play']); assert.equal(app.state, 'playing'); assert.equal(app.prompt.hidden, true);
  assert.equal(app.starting, false);
  let timeoutCallback, timeoutMs, cleared = false;
  const blocked = worldStartApp(() => new Promise(() => {}), () => new Promise(() => {}), {
    setTimeout: (callback, ms) => { timeoutCallback = callback; timeoutMs = ms; return 123; },
    clearTimeout: id => { assert.equal(id, 123); cleared = true; }
  });
  const pending = blocked.app.start(false); assert.equal(timeoutMs, 10000); timeoutCallback();
  await assert.rejects(pending, /タイムアウト/);
  assert.equal(blocked.app.state, 'ready'); assert.equal(blocked.app.starting, false); assert.ok(cleared);
  assert.deepEqual(blocked.calls, ['reset', 'resume', 'play', 'pause']);
  console.log('UW-10 resumeAndPlayConcurrent=true startupTimeoutMs=10000 mockedTimeout=true');
});
test('UW-11 renderAt: 120秒7200固定ステップ・全境界・dt0の描画では積分しない', async () => {
  const { engine } = worldTestEngine(); let steps = 0, maxDt = 0;
  // GPU計算はUW-06の命令監査とブラウザ計測に任せ、ここでは全曲の時刻とイベントを検証する。
  engine.fluid.step = () => { steps++; maxDt = Math.max(maxDt, engine.gpu.uniforms[1]); };
  engine.particles.step = () => {}; engine._draw = () => {};
  const m = await engine.renderAt(120);
  assert.equal(engine.previewStep, 7200); assert.equal(steps, 7200); assert.ok(maxDt <= 1 / 60 + 1e-9);
  assert.equal(m.boundaryCount, 6); assert.equal(engine.events.at(-1).type, 'end'); assert.ok(engine.events.at(-1).firedFrame >= 0);
  assert.equal(engine.gpu.uniforms[16], 0); assert.equal(engine.mfsFrames, 0);
  await engine.renderAt(.105); assert.equal(steps, 7206);
  await engine.advancePreview(.2); assert.equal(steps, 7212);
  await assert.rejects(engine.advancePreview(.1), RangeError);
  console.log('UW-11 previewSteps=7200 boundaryCoverage=6/6 maximumSimDt=' + maxDt.toFixed(9));
});

test('UW-12 WORLD-3 パレット: 調性ごとに三色・飽和した補色・濁った黄緑を作らない', () => {
  let minimumSaturation = 1;
  for (let seed = 0; seed < 96; seed++) {
    const harmony = new Array(12).fill(0); harmony[seed % 12] = 1;
    const score = compile({ ...fixture, worldChroma: harmony }, seed);
    const colors = Object.values(score.palette);
    assert.equal(new Set(colors.map(c => JSON.stringify(c))).size, 3);
    for (const c of colors) {
      assert.ok(c.every(v => v >= .015 && v <= 1));
      const saturation = (Math.max(...c) - Math.min(...c)) / Math.max(...c);
      minimumSaturation = Math.min(minimumSaturation, saturation);
      assert.ok(saturation > .98);
      assert.ok(!(c[1] > c[2] * 2 && c[0] > c[2] * 2 && c[1] > c[0]), 'olive禁止');
    }
  }
  console.log('UW-12 palettes=96 colorsPerSong=3 minimumLinearRgbSaturation=' + minimumSaturation);
});
test('UW-13 WORLD-3 キック: 同フレームで衝撃中心を固定・移動中は保持・次キックで更新', () => {
  const { engine } = worldTestEngine(), score = engine.score, u = engine.gpu.uniforms;
  const features = new (loadClassic(['js/mfs-const.js', 'js/mfs-view.js']).get('MfsFrameView'))();
  const drop = score.sections.find(s => s.kind === 'drop');
  engine._step(drop.startSec, null, 1 / 60);
  const center = [u[47], u[51], u[55]];
  assert.equal(u[75], new Float32Array([drop.startSec])[0]);
  engine._step(drop.startSec + .2, null, 1 / 60);
  assert.deepEqual([u[47], u[51], u[55]], center);
  features.raw[loadClassic(['js/mfs-const.js']).get('MFS_LAYOUT').ONSET_FLAGS] = 1;
  engine._step(drop.startSec + .3, features, 1 / 60);
  assert.equal(u[8], 1); assert.equal(u[31], 0);
  assert.notDeepEqual([u[47], u[51], u[55]], center);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(u[[47, 51, 55][i]] - (u[40 + i] + u[52 + i] * 12 * drop.worldScale)) < 1e-5);
  const kicked = [u[47], u[51], u[55]];
  engine._step(drop.startSec + .4, null, 1 / 60);
  assert.deepEqual([u[47], u[51], u[55]], kicked);
  assert.ok(Math.abs(u[31] - .1) < 1e-6);
  console.log('UW-13 kickUniformLatencyFrames=0 anchorDriftWithoutKick=0 kickAgeSec=' + u[31]);
});
test('UW-14 WORLD-6 第二drop: 拡大・螺旋変奏・レイマーチ撤去と履歴解像度', () => {
  const { engine } = worldTestEngine(), drops = engine.score.sections.filter(s => s.kind === 'drop');
  let firstMax = 0, secondMin = Infinity;
  for (const local of [1, 6, 11]) {
    for (let i = 0; i < 2; i++) {
      const s = drops[i]; engine._camera(s, s.startSec + local, .3, false, false);
      const radius = Math.hypot(engine.gpu.uniforms[40], engine.gpu.uniforms[41]) / s.worldScale;
      if (i === 0) firstMax = Math.max(firstMax, radius); else secondMin = Math.min(secondMin, radius);
    }
  }
  assert.ok(secondMin > firstMax * 4);
  engine._step(drops[1].startSec, null, 0);
  assert.equal(engine.metrics().formation, 'explosion'); assert.equal(engine.metrics().raymarchSteps, 0);
  assert.equal(engine.form, undefined);
  assert.equal(engine.metrics().feedbackWidth, 960); assert.equal(engine.metrics().feedbackHeight, 540);
  assert.ok(drops[1].intensity > drops[0].intensity);
  console.log('UW-14 firstPathRadiusMax=' + firstMax.toFixed(4) + ' secondPathRadiusMin=' + secondMin.toFixed(4) +
    ' worldScale=' + drops[1].worldScale + ' intensity=' + drops[1].intensity + ' raymarchSteps=0 feedback=960x540');
});


test('UW-15 WORLD-6 粒子: 262144全件を描画・seed再現・深度遮蔽と面積間引き撤去', () => {
  const { engine, gl } = worldTestEngine(), initial = engine.particles.initial.slice();
  engine.particles.reset(engine.score.seed); assert.deepEqual(engine.particles.initial, initial);
  engine._step(45, null, 1 / 60);
  const points = gl.calls.filter(c => c.type === gl.POINTS);
  assert.ok(points.length > 0); assert.ok(points.every(c => c.count === 262144));
  const runtime = loadClassic(['js/world/gl-util.js', 'js/world/particles.js']);
  const vertex = runtime.get('WORLD_PARTICLE_VERTEX');
  assert.ok(!/coverageBudget|activeCount|rank|depthField/.test(vertex));
  console.log('UW-15 submittedParticles=262144 seedResetDifference=0 pointDrawCalls=' + points.length);
});
test('UW-16 WORLD-4 harmony: 96曲の寒色二色・暖色一色・補色角差180度', () => {
  let minimumHueGap = 360;
  const hue = c => {
    const hi = Math.max(...c), lo = Math.min(...c), delta = hi - lo;
    const angle = hi === c[0] ? (c[1] - c[2]) / delta : hi === c[1] ? 2 + (c[2] - c[0]) / delta : 4 + (c[0] - c[1]) / delta;
    return (angle * 60 + 360) % 360;
  };
  for (let seed = 0; seed < 96; seed++) {
    const harmony = new Array(12).fill(0);harmony[seed % 12] = 1;
    const { primary, secondary, accent } = compile({ ...fixture, worldChroma: harmony }, seed).palette;
    const a = hue(primary), b = hue(secondary), warm = hue(accent);
    assert.ok(a >= 199 && a <= 218);assert.ok(b >= 224 && b <= 244);
    assert.ok(warm >= 19 && warm <= 38);
    assert.ok(Math.abs(a - warm - 180) < 1e-10);
    minimumHueGap = Math.min(minimumHueGap, b - a);
  }
  console.log('UW-16 complementaryGapDeg=180 secondaryGapMinDeg=' + minimumHueGap);
});

test('UW-17 WORLD-4 暖色面積計測: 黒・寒色・中立を除外し暖色を数える', () => {
  const fraction = measurement.get('worldWarmFraction');
  const rgba = new Uint8Array([0, 0, 0, 255, 5, 1, 1, 255, 30, 90, 180, 255, 128, 128, 128, 255,
    240, 90, 30, 255, 100, 30, 10, 255, 8, 9, 12, 255, 255, 255, 255, 255]);
  assert.equal(fraction(rgba), .25);
  console.log('UW-17 syntheticWarmPixels=2/8 fraction=0.25');
});

test('UW-18 WORLD-5 小節頭: 全カットで30度以上の切り返し・motion履歴のリセット', () => {
  const { engine } = worldTestEngine(), u = engine.gpu.uniforms;
  let minimumAngle = Infinity, checked = 0;
  for (const section of engine.score.sections.filter(s => s.kind === 'drop')) {
    engine.setScore(engine.score);
    for (const t of engine.score.downbeats.filter(t => t > section.startSec + .01 && t < section.endSec)) {
      engine._step(t - .001, null, 0); const before = Array.from(u.slice(52, 55));
      const cuts = engine.cut; engine._step(t, null, 0);
      assert.equal(engine.cut, cuts + 1);
      const dot = before.reduce((sum, value, i) => sum + value * u[52 + i], 0);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
      assert.ok(angle >= 30, 'downbeat=' + t + ' angle=' + angle);
      minimumAngle = Math.min(minimumAngle, angle); checked++;
      assert.deepEqual(u.slice(40, 56), u.slice(56, 72));
      assert.equal(engine.metrics().dropKeyRole, section.variation === 1 ? 'accent' : 'secondary');
    }
  }
  assert.ok(checked > 0);
  console.log('UW-18 downbeatCuts=' + checked + ' minimumCameraCutDeg=' + minimumAngle.toFixed(4));
});

test('UW-19 WORLD-5 計測開始: gesture不要resume→start(false)・AudioContext失敗/timeoutを明示', async () => {
  const start = measurement.get('worldStartLiveMeasurement'), calls = [];
  const w = { audioEngine: { ctx: { state: 'suspended' }, resume: async () => {
    calls.push('resume'); w.audioEngine.ctx.state = 'running';
  } }, app: { state: 'preview', start: async fullscreen => {
    assert.equal(fullscreen, false); assert.equal(w.audioEngine.ctx.state, 'running');
    calls.push('start(false)'); w.app.state = 'playing'; w.audio.paused = false;
  } }, audio: { paused: true } };
  await start(w); assert.deepEqual(calls, ['resume', 'start(false)']);
  const suspended = { ...w, audioEngine: { ctx: { state: 'suspended' }, resume: async () => {} } };
  await assert.rejects(start(suspended), /not running/);
  const rejected = { ...w, audioEngine: { resume: async () => { throw new Error('resume rejected'); } } };
  await assert.rejects(start(rejected), /resume rejected/);
  const paused = { ...w, audio: { paused: true } };
  await assert.rejects(start(paused), /did not start/);
  let callback, timeoutMs, cleared = false;
  const timed = loadClassic(['tests/browser/world.test.js'], {
    setTimeout: (fn, ms) => { callback = fn; timeoutMs = ms; return 55; },
    clearTimeout: id => { assert.equal(id, 55); cleared = true; }
  }).get('worldStartLiveMeasurement');
  const pending = timed({ audioEngine: { resume: () => new Promise(() => {}) } });
  assert.equal(timeoutMs, 10000); callback();
  await assert.rejects(pending, /resume timed out/); assert.ok(cleared);
  console.log('UW-19 resumeBeforeStart=true fullscreen=false resumeTimeoutMs=10000 failureCases=4');
});


test('UW-20 WORLD-6 被覆計測: 暗部丸めを除外・重複画素を一度だけ数える', () => {
  const coverage = measurement.get('worldParticleCoverage');
  const before = new Float32Array(100 * 4), after = new Float32Array(before.length);
  for (let i = 0; i < 10; i++) after[i * 4 + 1] = .01;
  after[40] = .00001; after[44] = -.1;
  const m = coverage(before, after);
  assert.equal(m.visiblePixels, 10); assert.equal(m.fraction, .1);
  assert.ok(m.peakHdrContribution > .007); assert.equal(m.particleEnergyFraction, 1);
  console.log('UW-20 syntheticCoverage=10/100=10% excludedSubthresholdPixels=1');
});
test('UW-21 WORLD-6 履歴: 毎simulationステップで進む・再描画は不変・reset/resizeで破棄', () => {
  const { engine } = worldTestEngine(); let updates = 0, resets = 0;
  const step = engine.post.stepFeedback.bind(engine.post), reset = engine.post.reset.bind(engine.post);
  engine.post.stepFeedback = (...args) => { updates++; step(...args); };
  engine.post.reset = () => { resets++; reset(); };
  engine._step(0, null, 0); const first = engine.post.feedback.read;
  engine._draw(); engine._draw(); assert.equal(engine.post.feedback.read, first); assert.equal(updates, 1);
  engine._step(1 / 60, null, 1 / 60); assert.notEqual(engine.post.feedback.read, first); assert.equal(updates, 2);
  engine._step(.017, null, 0); assert.equal(updates, 2);
  engine.setScore(engine.score); assert.equal(resets, 1);
  engine.resize(1280, 720); assert.equal(engine.post.feedback.read.width, 640); assert.equal(engine.fluid.velocity.read.width, 480);
  console.log('UW-21 historyUpdates=2 repeatedDrawUpdates=0 resetCalls=1 resizedFluid=480x270 feedback=640x360');
});
test('UW-22 WORLD-6 全画面は明示操作のみ・シーク後は位置を維持して再開', async () => {
  let requests = 0, exits = 0;
  const document = { fullscreenElement: null, documentElement: { requestFullscreen: async () => { requests++; } }, exitFullscreen: async () => { exits++; } };
  const runtime = loadClassic(['js/world/world-app.js'], { SongMapService: class {}, document });
  const app = Object.create(runtime.get('WorldApp').prototype);
  Object.assign(app, { _fitCanvas: () => {}, _updateControls: () => {}, public: {}, score: { durationSec: 120 },
    state: 'playing', engine: { preview: true }, audio: { currentTime: 0 }, audioEngine: { resetAnalysis: () => {} },
    renderAt: async t => { app.drawnSec = t; }, start: async () => { app.resumedAt = app.audio.currentTime; app.state = 'playing'; } });
  await app.seek(45); assert.equal(app.drawnSec, 45); assert.equal(app.resumedAt, 45); assert.equal(app.engine.preview, false);
  app.state = 'paused'; await app.seek(10); assert.equal(app.audio.currentTime, 10); assert.equal(app.state, 'paused');
  await app.toggleFullscreen(); document.fullscreenElement = {}; await app.toggleFullscreen();
  assert.equal(requests, 1); assert.equal(exits, 1);
  document.fullscreenElement = null; document.documentElement.requestFullscreen = async () => { throw new Error('denied'); };
  assert.equal(await app.toggleFullscreen(), false); assert.equal(app.state, 'paused'); assert.equal(app.public.fullscreenError, 'denied');
  // default start()もrequestFullscreenを呼ばない（旧fullscreen引数も強制しない）。
  const startup = worldStartApp(() => Promise.resolve(), () => Promise.resolve());
  startup.app.canvas.requestFullscreen = () => { throw new Error('forced fullscreen'); };
  await startup.app.start(); assert.equal(startup.app.audio.currentTime, 0);
  console.log('UW-22 explicitFullscreenRequests=1 exits=1 seekForwardSec=45 seekBackwardSec=10 defaultStartFullscreenRequests=0');
});


test('UW-23 WORLD-7 構図: 全kindに独立の初回構図・毎再登場で構図かcamera方向を変える', () => {
  const kinds = ['intro', 'build', 'drop', 'break', 'outro', 'main'];
  const map = { ...fixture, durationSec: 72, sections: Array.from({ length: 72 }, (_, i) =>
    ({ startSec: i, endSec: i + 1, kind: kinds[i % 6], label: 'A' })) };
  const score = compile(map, 11), previous = new Map();
  assert.equal(new Set(score.sections.slice(0, 6).map(s => s.composition)).size, 5);
  for (const section of score.sections) {
    const before = previous.get(section.kind);
    if (before) {
      assert.notEqual(section.composition, before.composition);
      assert.equal(section.formId, before.formId); assert.equal(section.paletteRotation, before.paletteRotation);
      assert.equal(section.compositionSeed, before.compositionSeed);
    }
    previous.set(section.kind, section);
  }
  assert.deepEqual(score, compile(map, 11));
  const { engine } = worldTestEngine();
  const first = score.sections[2], repeat = score.sections[32];
  assert.equal(first.composition, repeat.composition);
  engine._camera(first, first.startSec + .4, .4, false, false); const a = engine.gpu.uniforms.slice(80, 84);
  engine._camera(repeat, repeat.startSec + .4, .4, false, false); const b = engine.gpu.uniforms.slice(80, 84);
  assert.notDeepEqual(a, b);
  console.log('UW-23 sections=72 distinctCompositions=5 adjacentRepeatDifferences=66 fiveRepeatCameraDifference=true');
});
test('UW-24 WORLD-7 kick: 同フレームに決定的な新渦ペア・非kick時の固定中心・交互の更新', () => {
  const { engine } = worldTestEngine(), u = engine.gpu.uniforms;
  const features = new (loadClassic(['js/mfs-const.js', 'js/mfs-view.js']).get('MfsFrameView'))();
  features.raw[loadClassic(['js/mfs-const.js']).get('MFS_LAYOUT').ONSET_FLAGS] = 1;
  let minimumShift = Infinity; const counts = [];
  for (const section of engine.score.sections.filter(s => s.kind === 'drop')) {
    const series = () => {
      engine.setScore(engine.score); engine._step(section.startSec, null, 0);
      assert.equal(engine.kickCount, 1); assert.equal(u[31], 0); counts.push(u[86]);
      const samples = [];
      for (let i = 1; i <= 12; i++) {
        const t = section.startSec + i * .1, before = u.slice(88, 104), center = u.slice(105, 107);
        engine._step(t, features, 0);
        assert.equal(u[8], 1); assert.equal(u[31], 0); assert.equal(engine.kickCount, i + 1);
        const shift = Math.hypot(u[105] - center[0], u[106] - center[1]);
        minimumShift = Math.min(minimumShift, shift); assert.ok(shift > 0);
        assert.ok(Math.abs(u[105]) > .15); assert.ok(Math.abs(u[106]) > .1);
        const pair = section.vortexCount === 4 ? i % 2 * 2 : 0, offset = 88 + pair * 4;
        assert.ok(Math.abs(Math.hypot(u[offset] - u[offset + 4], u[offset + 1] - u[offset + 5]) - .22) < 1e-6);
        if (section.vortexCount === 4) {
          const untouched = 88 + (pair === 0 ? 2 : 0) * 4;
          assert.deepEqual(u.slice(untouched, untouched + 8), before.slice(untouched - 88, untouched - 80));
        }
        const kicked = u.slice(88, 108); samples.push(Array.from(kicked));
        engine._step(t + .05, null, 0);
        assert.deepEqual(u.slice(88, 104), kicked.slice(0, 16));
        assert.deepEqual(u.slice(105, 108), kicked.slice(17, 20));
      }
      return samples;
    };
    assert.deepEqual(series(), series());
  }
  assert.deepEqual(counts, [2, 2, 4, 4]);
  console.log('UW-24 kickPairs=48 counts=2/4 minimumCenterShift=' + minimumShift.toFixed(6) +
    ' pairSeparation=0.22 deterministicDifference=0 eventLatencyFrames=0');
});
test('UW-25 WORLD-7 2D camera: 全小節頭30度以上のcut・kind別pan/zoom/rotation', () => {
  const { engine } = worldTestEngine(), u = engine.gpu.uniforms;
  let minimumAngle = Infinity, cuts = 0;
  for (const section of engine.score.sections.filter(s => s.kind === 'drop')) {
    engine.setScore(engine.score);
    for (const t of engine.score.downbeats.filter(t => t > section.startSec + .01 && t < section.endSec)) {
      engine._step(t - .001, null, 0); const angle = u[83];
      engine._step(t, null, 0);
      const delta = Math.abs(u[83] - angle) * 180 / Math.PI;
      minimumAngle = Math.min(minimumAngle, delta); assert.ok(delta >= 30); cuts++;
      assert.equal(u[104], 0);
    }
  }
  for (const section of engine.score.sections) {
    engine._camera(section, section.startSec, 0, true, false); const start = u.slice(80, 84);
    engine._camera(section, (section.startSec + section.endSec) / 2, .5, false, false);
    assert.notDeepEqual(u.slice(80, 84), start);
    for (const value of u.slice(80, 84)) assert.ok(Number.isFinite(value));
    assert.ok(u[82] > 0);
  }
  assert.equal(u.length, 108);
  assert.equal(engine.fluid.velocity.read.width, 720); assert.equal(engine.fluid.velocity.read.height, 405);
  assert.equal(engine.fluid.dye.read.width, 1440); assert.equal(engine.fluid.dye.read.height, 810);
  assert.equal(engine.particles.count, 262144);
  console.log('UW-25 camera2DCuts=' + cuts + ' minimumCutDeg=' + minimumAngle.toFixed(4) +
    ' uniformFloats=108 velocity=720x405 dye=1440x810 particles=262144');
});
test('UW-26 WORLD-7 計測: RGB丸めを除外したmotion差・画面3×3占有', () => {
  const difference = measurement.get('worldFrameDifference'), occupied = measurement.get('worldOccupiedTiles');
  const before = new Uint8Array(9 * 4), after = new Uint8Array(before.length);
  after[0] = 3; after[4] = 4;
  assert.equal(difference(before, after).changedFraction, 1 / 9);
  const rgba = new Uint8Array(9 * 9 * 4);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 9; x++) rgba[(y * 9 + x) * 4 + 1] = 255;
  assert.deepEqual(occupied({ width: 9, height: 9, rgba }), [1, 1, 1, 0, 0, 0, 0, 0, 0]);
  assert.throws(() => difference(before, rgba), /dimensions/);
  console.log('UW-26 syntheticMotionChanged=1/9 syntheticOccupiedTiles=3/9');
});

test('UW-27 WORLD-7 preview: 拍格子でkickを生成・反復一致・ライブの空MFSでは生成しない', async () => {
  const { engine } = worldTestEngine(), section = engine.score.sections.find(s => s.kind === 'drop');
  engine.fluid.step = () => {}; engine.particles.step = () => {}; engine._renderMatter = () => {};
  engine.post.stepFeedback = () => {}; engine._draw = () => {};
  const t = section.startSec + 1;
  await engine.renderAt(t); const count = engine.kickCount, state = engine.gpu.uniforms.slice(88, 108);
  assert.ok(count >= 2); assert.equal(engine.mfsFrames, 0);
  await engine.renderAt(t); assert.equal(engine.kickCount, count); assert.deepEqual(engine.gpu.uniforms.slice(88, 108), state);
  engine.setScore(engine.score); engine._step(section.startSec, null, 0);
  engine._step(t, null, 1 / 60); assert.equal(engine.kickCount, 1); assert.equal(engine.mfsFrames, 0);
  console.log('UW-27 previewKicksInFirstSecond=' + count + ' repeatDifference=0 liveNullMfsKicks=1(boundary)');
});

test('UW-28 WORLD-7 std140契約: GLSLの各vec4配列とJSのcamera/渦/衝撃の配置が一致', () => {
  const source = loadClassic(['js/world/gl-util.js']).get('WORLD_GLSL');
  const block = source.match(/uniform World \{([\s\S]*?)\};/)[1].replace(/\/\/[^\n]*/g, '');
  const offsets = new Map(); let offset = 0;
  for (const declaration of block.matchAll(/vec4\s+([^;]+);/g)) {
    for (const item of declaration[1].split(',')) {
      const field = item.trim().match(/^(\w+)(?:\[(\d+)\])?$/);
      assert.ok(field, item); offsets.set(field[1], offset); offset += 4 * (field[2] ? Number(field[2]) : 1);
    }
  }
  const { engine } = worldTestEngine(), u = engine.gpu.uniforms;
  assert.equal(offset, u.length);
  const section = engine.score.sections.find(s => s.kind === 'drop');
  engine._step(section.startSec, null, 0);
  assert.deepEqual(u.slice(offsets.get('lens'), offsets.get('lens') + 4), new Float32Array(engine.metrics().camera2D));
  assert.equal(u[offsets.get('composition')], section.compositionId);
  assert.equal(u[offsets.get('composition') + 2], section.vortexCount);
  assert.ok(Math.abs(u[offsets.get('vortices') + 2]) === 1);
  const shot = offsets.get('shot');
  assert.equal(u[shot + 3], engine.kickCount);
  assert.ok(Math.abs(u[shot + 1]) > .15 && Math.abs(u[shot + 2]) > .1);
  console.log('UW-28 shaderUniformFloats=' + offset + ' lensOffset=' + offsets.get('lens') +
    ' vortexOffset=' + offsets.get('vortices') + ' shockOffset=' + shot + ' packedKickCount=' + u[shot + 3]);
});


test('UW-29 WORLD-8 領域: 1.5倍の速度・圧力・染料・補助場、リサイズ後も世界単位の格子密度を維持', () => {
  const { engine } = worldTestEngine();
  for (const [w, h] of [[1920, 1080], [1080, 1080], [1281, 721]]) {
    engine.resize(w, h);
    const f = engine.fluid, fw = Math.ceil(w * 1.5 / 4), fh = Math.ceil(h * 1.5 / 4);
    for (const target of [f.velocity.read, f.velocity.write, f.pressure.read, f.pressure.write, f.curl, f.divergence, f.base]) {
      assert.equal(target.width, fw); assert.equal(target.height, fh);
    }
    assert.equal(f.dye.read.width, Math.ceil(w * 1.5 / 2)); assert.equal(f.dye.read.height, Math.ceil(h * 1.5 / 2));
    assert.equal(engine.scene.width, w); assert.equal(engine.scene.height, h);
  }
  const runtime = loadClassic(['js/world/gl-util.js', 'js/world/fluid.js', 'js/world/particles.js', 'js/world/post.js']);
  assert.equal(runtime.get('OVERSCAN'), 1.5);
  assert.match(runtime.get('WORLD_FLUID_FRAGMENT'), /worldDomainPosition\(uv\)/);
  assert.match(runtime.get('WORLD_PARTICLE_UPDATE'), /worldExtent\(\)\.x\*\.5/);
  assert.match(runtime.get('WORLD_PARTICLE_VERTEX'), /worldScreenUv\(worldView\(s.xy\)\)/);
  assert.match(runtime.get('WORLD_FEEDBACK_FRAGMENT'), /worldUv\(worldPosition\(vUv\)\)/);
  console.log('UW-29 overscan=1.5 velocity/pressure=720x405 dye=1440x810 targetsAreaRatio=2.25 screenResolutionUnchanged=true');
});
test('UW-30 WORLD-8 camera: 全60Hz時刻・両cut方向・16:9/1:1で四隅に3%以上の余白', () => {
  const { engine } = worldTestEngine(), u = engine.gpu.uniforms;
  const marginOf = loadClassic(['js/world/gl-util.js', 'tests/browser/world.test.js']).get('worldCameraMargin');
  const clamp = engine._clampCamera;
  let minimumMargin = .5, maximumZoomRatio = 1, samples = 0, unchanged = 0;
  engine._clampCamera = function (minimumRotation) {
    const original = u.slice(80, 84);
    const originalMargin = marginOf(engine);
    clamp.call(this, minimumRotation);
    maximumZoomRatio = Math.max(maximumZoomRatio, u[82] / original[2]);
    if (originalMargin >= .035 + 1e-5) { assert.deepEqual(u.slice(80, 84), original); unchanged++; }
  };
  for (const [w, h] of [[1920, 1080], [1080, 1080]]) {
    engine.resize(w, h);
    for (const section of engine.score.sections) {
      for (let frame = Math.ceil(section.startSec * 60); frame < section.endSec * 60; frame++) {
        const t = frame / 60, p = (t - section.startSec) / (section.endSec - section.startSec);
        for (const cut of [0, 1]) {
          engine.cut = cut; engine._camera(section, t, p, false, false);
          const margin = marginOf(engine); minimumMargin = Math.min(minimumMargin, margin);
          assert.ok(margin >= .03, 'camera margin=' + margin); samples++;
        }
      }
    }
  }
  // 式の検証: 最大角で必要なズームは、余白から半径を除いた各軸の比の最大値。
  u.set([2, -2, 1.05, .85], 80); clamp.call(engine);
  assert.ok(marginOf(engine) >= .03); assert.equal(u[82], Math.fround(1.05));
  console.log('UW-30 cornersChecked=' + samples * 4 + ' cameraSamples=' + samples +
    ' minimumDomainUvMargin=' + minimumMargin.toFixed(9) + ' maximumZoomRatio=' + maximumZoomRatio.toFixed(9) +
    ' unchangedSafeCameras=' + unchanged);
});
test('UW-31 BW-8-edges 計測: 一定輝度・黒い端・0.6閾値・暗部除外', () => {
  const bands = measurement.get('worldEdgeBands'), width = 100, height = 100, rgba = new Uint8Array(width * height * 4);
  function fill(outer, inner) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const d = Math.min(x + .5, width - x - .5, y + .5, height - y - .5) / 100;
      const value = d < .04 ? outer : inner, i = (y * width + x) * 4;
      rgba[i] = value; rgba[i + 1] = value; rgba[i + 2] = value;
    }
    return bands(rgba, width, height);
  }
  assert.equal(fill(100, 100).pass, true); assert.equal(fill(0, 100).pass, false);
  const exact = fill(60, 100); assert.equal(exact.pass, true);
  assert.equal(fill(59, 100).pass, false); assert.equal(fill(0, 2).pass, true);
  assert.equal(exact.outerPixels, 1536); assert.equal(exact.innerPixels, 1408);
  assert.ok(Math.abs(exact.ratio - .6) < 1e-12);
  console.log('UW-31 syntheticOuter/Inner=0.6 outerPixels=1536 innerPixels=1408 blackBorderRejected=true darkInnerExempt=true');
});
