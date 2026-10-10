// 目的 — g-fluid v2 の定数表・噴出口配置・区間補間・キック1フレーム・瞬き・塵の視差・暖機・GPU命令回数を検査する — doc/20261010-design-fluid-v2.md §11
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';
import { worldHarnessScripts } from '../lib/world-harness.mjs';

const scripts = worldHarnessScripts();
const r = loadClassic(scripts), C = r.get('WORLD_FLUID2'), Analyzer = r.get('WorldFluid2Analyzer');
const Feature = r.get('MfsFrameView'), L = r.get('MFS_LAYOUT'), compile = r.get('compileWorldScore');
const close = (actual, expected, eps = 1e-12) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);

function scoreFor(kinds = ['main'], duration = 10, seed = 11) {
  return compile({ bpm: 120, durationSec: kinds.length * duration, beats: [], downbeatIndices: [],
    sections: kinds.map((kind, i) => ({ kind, label: kind + i, startSec: i * duration, endSec: (i + 1) * duration })) }, seed);
}
function setup(kinds = ['main'], duration = 10) {
  const score = scoreFor(kinds, duration), features = new Feature();
  const engine = { score, sectionIndex: 0, gpu: { uniforms: new Float32Array(244) }, preview: false };
  return { analyzer: new Analyzer(), features, engine, score, input: { engine, song: score.song, features, dt: 1 / 60, tSec: 0 } };
}

test('UW-F2-01 WORLD-38 定数表・登録・凍結', () => {
  const expected = { VEL_W: 384, VEL_H: 216, DYE_W: 1152, DYE_H: 648, VEL_DAMP: .6, BG_RELAX: 1.5, VORT: 14, PRESSURE_ITERS: 24, DYE_DECAY: C.DYE_DECAY,
    EDGE: .06, OMEGA_BASE: .55, OMEGA_FLOOR: .6, OMEGA_LOUD: .8, CURL_SCALE: 1.2, CURL_FREQ: .03, CURL_AMP: .03, JET_COUNT: 32, R0: .27,
    SWIRL_ANGLE: 50, JET_FORCE: 6, JET_DYE: C.JET_DYE, HUE_SAT: .9, NORM_TAU: 4, NORM_FLOOR: .08, NORM_GAIN: 1.8, KICK_PUSH: 1.4, CAM_AMP: .05, CAM_PERIOD: 40, DUST1_COUNT: 3000, DUST1_DEPTH: 3,
    DUST2_COUNT: 9000, DUST2_DEPTH: 8, GLINT_MAX: 24, GLINT_RISE: .06, GLINT_DECAY: .5, EXPOSURE: C.EXPOSURE, TRANS_SECONDS: 2,
    WARM_FRAMES: 420, BLOOM_THRESHOLD: .7, BLOOM_STRENGTH: .6 };
  for (const [name, value] of Object.entries(expected)) assert.equal(C[name], value, name);
  assert.equal(C.DT, 1 / 60); assert.equal(C.SIM_ASPECT, 16 / 9); assert.ok(Object.isFrozen(C));
  // GLSLの定数は同じ値から生成される。
  const shader = r.get('WORLD_FLUID2_ADVECT_FRAGMENT');
  for (const name of ['JET_FORCE', 'VORT', 'R0', 'BG_RELAX']) assert.ok(shader.includes(`const float ${name} = ${C[name].toFixed(8)};`), name);
  assert.ok(shader.includes('const int JET_COUNT = 32;'));
  assert.deepEqual(r.get('WORLD_ANALYZER_TYPES')[0], { id: 'g-fluid', label: 'スペクトル流体', key: 1, available: true });
  const a = new Analyzer(); assert.equal(a.id, 'g-fluid'); assert.equal(a.label, 'スペクトル流体');
  assert.equal(typeof globalThis.WorldFluidAnalyzer, 'undefined'); assert.throws(() => r.get('WorldFluidAnalyzer'), ReferenceError);
  assert.ok(!scripts.includes('js/world/g-fluid.js') && scripts.includes('js/world/g-fluid2.js'));
  console.log('UW-F2-01 constants=' + Object.keys(C).length + ' warmFrames=' + C.WARM_FRAMES);
});

test('UW-F2-02 WORLD-38 噴出口：帯域0が真下・反時計回り・半径R0・向きは28度回転', () => {
  const pos = r.get('worldFluid2JetPosition'), normal = r.get('worldFluid2JetNormal'), p = [0, 0], n = [0, 0];
  const theta0 = pos(0, p); close(theta0, -Math.PI / 2 + .5 * 2 * Math.PI / 32);
  // 帯域0は真下の少し反時計回り側（x>0、y<0）。
  assert.ok(p[1] < 0 && p[0] > 0 && Math.abs(p[0]) < Math.abs(p[1]));
  let previous = theta0;
  for (let i = 0; i < 32; i++) {
    const theta = pos(i, p);
    close(Math.hypot(p[0], p[1]), C.R0); close(p[0], C.R0 * Math.cos(-Math.PI / 2 + (i + .5) * 2 * Math.PI / 32)); close(p[1], C.R0 * Math.sin(theta));
    if (i) { close(theta - previous, 2 * Math.PI / 32); assert.ok(theta > previous); } // 角度が増える向き＝反時計回り
    previous = theta;
    // n_i = 放射方向を +28度 回した単位ベクトル
    normal(i, n); close(Math.hypot(n[0], n[1]), 1);
    const radial = Math.atan2(p[1], p[0]), direction = Math.atan2(n[1], n[0]);
    close(Math.atan2(Math.sin(direction - radial), Math.cos(direction - radial)), C.SWIRL_ANGLE * Math.PI / 180);
  }
  // 帯域16は真上の少し反時計回り側（x<0、y>0）。
  pos(16, p); assert.ok(p[1] > 0 && p[0] < 0);
  console.log('UW-F2-02 jets=32 radius=' + C.R0 + ' swirl=28deg');
});

test('UW-F2-03 WORLD-38 区間表・線形補間・2秒smoothstep', () => {
  const params = r.get('worldFluid2SectionParams'), out = new Float64Array(5);
  const table = { intro: [.6, .6, .7, 1, 1], drop: [1.4, 1.5, 1.4, 1.15, 1.08], break: [.45, .4, .6, .7, .94], main: [1, 1, 1, 1, 1.02] };
  for (const [kind, row] of Object.entries(table)) { params(kind, .37, out); for (let i = 0; i < 5; i++) close(out[i], row[i]); }
  params('build', 0, out); [.6, 1, .8, 1, 1].forEach((v, i) => close(out[i], v));
  params('build', 1, out); [1.1, 1, 1.3, 1, 1.06].forEach((v, i) => close(out[i], v));
  params('build', .5, out); [.85, 1, 1.05, 1, 1.03].forEach((v, i) => close(out[i], v));
  params('outro', 0, out); [1, .5, .8, .6, 1].forEach((v, i) => close(out[i], v));
  params('outro', 1, out); [0, .5, .8, .6, .92].forEach((v, i) => close(out[i], v));
  params('outro', .25, out); close(out[0], .75); close(out[4], .98);
  // 区間境界：2秒のsmoothstepで前区間の終端値から補間（intro→build→drop）。
  const score = scoreFor(['intro', 'build', 'drop'], 10), blended = r.get('worldFluid2Params'), got = new Float64Array(5);
  blended(score.sections, 1, 10, got); close(got[0], .6); close(got[4], 1);                    // buildの始点＝introの終端
  blended(score.sections, 1, 11, got); close(got[0], .6 + (.6 + .05 - .6) * .5);               // 1秒＝smoothstep(.5)=.5
  blended(score.sections, 2, 20, got); close(got[0], 1.1); close(got[4], 1.06); close(got[2], 1.3); // dropの始点＝buildの終端値(p=1)
  blended(score.sections, 2, 22, got); close(got[0], 1.4); close(got[1], 1.5); close(got[3], 1.15); close(got[4], 1.08);
  blended(score.sections, 0, 3, got); close(got[0], .6);
  console.log('UW-F2-03 kinds=6 transitionSeconds=2');
});

test('UW-F2-04 WORLD-38 キックの衝撃は1フレームだけ・同時刻の再呼び出しで数え直さない・区間係数を掛ける', () => {
  const { analyzer, features, input, engine } = setup(['main', 'drop'], 10);
  features.raw[L.ONSET_FLAGS] = 0; input.tSec = 1; analyzer.step(input); assert.equal(analyzer.kickPush, 0);
  features.raw[L.ONSET_FLAGS] = 1; input.tSec = 1 + 1 / 60; analyzer.step(input);
  close(analyzer.kickPush, C.KICK_PUSH * 1, 1e-12); assert.equal(analyzer.simPending, true);
  // 同じ時刻の再step（dt0の再描画など）は再加算も解除もしない。
  input.dt = 0; analyzer.step(input); close(analyzer.kickPush, C.KICK_PUSH, 1e-12); assert.equal(analyzer.simPending, false);
  // シミュレーションが消費したら0（_simulateは衝撃を使い切る）。次のフレームではフラグなしで0。
  input.dt = 1 / 60; features.raw[L.ONSET_FLAGS] = 0; input.tSec = 1 + 2 / 60; analyzer.step(input); assert.equal(analyzer.kickPush, 0);
  // kickEnvは0.18秒で1/eへ。
  features.raw[L.ONSET_FLAGS] = 1; input.tSec = 2; analyzer.step(input); close(analyzer.kickEnv, 1);
  features.raw[L.ONSET_FLAGS] = 0; input.tSec = 2 + C.KICK_SECONDS; analyzer.step(input); close(analyzer.kickEnv, Math.exp(-1), 1e-12);
  // dropでは sectionKick=1.5（区間開始から2秒以上後）。
  engine.sectionIndex = 1; features.raw[L.ONSET_FLAGS] = 1; input.tSec = 13; analyzer.step(input); close(analyzer.kickPush, C.KICK_PUSH * 1.5, 1e-12);
  console.log('UW-F2-04 kickPush=' + analyzer.kickPush);
});

test('UW-F2-05 WORLD-38 瞬き：包絡・生成位置の決定性・最強の高域帯域・最大24', () => {
  const env = r.get('worldFluid2GlintEnvelope'), position = r.get('worldFluid2GlintPosition');
  close(env(0), 0); assert.equal(env(-1), 0);
  close(env(.06), (1 - Math.exp(-1)) * Math.exp(-.06 / .5)); close(env(.5), (1 - Math.exp(-.5 / .06)) * Math.exp(-1));
  let peak = 0, peakAge = 0; for (let a = 0; a < 3; a += .001) if (env(a) > peak) { peak = env(a); peakAge = a; }
  assert.ok(peakAge > .06 && peakAge < .3 && peak < 1); assert.ok(env(3) < .01);
  // 位置：同じ(serial,k,seed)で一致、seed/serialで変わる。半径は R0+.1..R0+.6 の近傍。
  const a = [0, 0], b = [0, 0], c = [0, 0];
  position(3, 20, 11, a); position(3, 20, 11, b); assert.deepEqual(a, b);
  position(4, 20, 11, c); assert.notDeepEqual(a, c); position(3, 20, 12, c); assert.notDeepEqual(a, c);
  const theta = -Math.PI / 2 + (20 + .5) * 2 * Math.PI / 32;
  for (let s = 0; s < 200; s++) {
    position(s, 20, 11, a); const along = a[0] * Math.cos(theta) + a[1] * Math.sin(theta);
    assert.ok(along >= C.R0 + .1 - C.GLINT_JITTER * 1.5 && along <= C.R0 + .6 + C.GLINT_JITTER * 1.5);
  }
  // 解析器：高域オンセットで最強の16..31帯域に置く。25個目は最古の枠を上書き。
  const { analyzer, features, input } = setup();
  features.bandsSmooth.fill(.3); features.bandsSmooth[22] = .95; features.raw[L.LEVEL] = .6;
  for (let i = 0; i < 26; i++) { features.raw[L.ONSET_FLAGS] = 4; input.tSec = 1 + i * .01; analyzer.step(input); }
  const expected = [0, 0]; position(0, 22, analyzer.seed, expected);
  analyzer.glintSerial = 0; analyzer.glintBirth.fill(-1e9); analyzer._spawnGlint(5);
  close(analyzer.glints[0], expected[0], 1e-6); close(analyzer.glints[1], expected[1], 1e-6);
  assert.equal(analyzer.glintSerial, 1); assert.equal(analyzer.glints.length, 24 * 4);
  // 寿命を過ぎた枠は無効（経過秒が負）。
  features.raw[L.ONSET_FLAGS] = 0; input.tSec = 1 + 26 * .01 + 10; analyzer.step(input);
  for (let n = 0; n < 24; n++) assert.equal(analyzer.glints[n * 4 + 2], -1);
  // 同じ時刻の再stepで二重に生まれない。
  const before = analyzer.glintSerial; features.raw[L.ONSET_FLAGS] = 4; input.tSec = 50; analyzer.step(input); analyzer.step(input);
  assert.equal(analyzer.glintSerial, before + 1);
  console.log('UW-F2-05 peakAge=' + peakAge.toFixed(3) + ' peak=' + peak.toFixed(3));
});

test('UW-F2-06 WORLD-38 塵の視差(p - cam/depth)/zoom・カメラ周期・遠いほど動かない', () => {
  const dust = r.get('worldFluid2DustScreen'), camera = r.get('worldFluid2Camera'), cam = [0, 0];
  close(dust(.5, 3, .05, 1), .5 - .05 / 3); close(dust(.5, 8, .05, 1), .5 - .05 / 8); close(dust(.5, 1, .05, 1.08), (.5 - .05) / 1.08);
  assert.ok(Math.abs(dust(.5, 8, .05, 1) - .5) < Math.abs(dust(.5, 3, .05, 1) - .5));
  camera(10, cam); close(cam[0], .05 * Math.sin(2 * Math.PI * 10 / 40)); close(cam[1], .05 * .6 * Math.sin(2 * Math.PI * 10 / (40 * 1.37)));
  camera(0, cam); close(cam[0], 0); close(cam[1], 0); camera(40, cam); close(cam[0], 0, 1e-12);
  assert.equal(C.DUST1_COUNT + C.DUST2_COUNT, 12000);
  const vertex = r.get('WORLD_FLUID2_DUST_VERTEX'); assert.ok(vertex.includes('(p - cam / depth) / zoom'));
  console.log('UW-F2-06 parallaxDepth3=' + (.05 / 3).toFixed(5) + ' depth8=' + (.05 / 8).toFixed(5));
});

// GPU命令の回数だけを検査するmock。数値結果はブラウザ側（BW-38）に任せる。
function commandGl() {
  let id = 1, program = null, fbo = null, unit = 0;
  const attachments = new Map(), textures = new Map(), samplers = new Map(), calls = [], gl = { calls, INVALID_INDEX: 0xffffffff };
  for (const name of ['UNIFORM_BUFFER', 'DYNAMIC_DRAW', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'TEXTURE_2D', 'RGBA8',
    'RGBA32F', 'RGBA16F', 'NEAREST', 'LINEAR', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'REPEAT',
    'FRAMEBUFFER', 'READ_FRAMEBUFFER', 'DRAW_FRAMEBUFFER', 'COLOR_ATTACHMENT0', 'FRAMEBUFFER_COMPLETE', 'COLOR_BUFFER_BIT', 'TRIANGLES', 'POINTS',
    'BLEND', 'ONE']) gl[name] = id++;
  gl.TEXTURE0 = 1000;
  for (const name of ['createVertexArray', 'createBuffer', 'createShader', 'createProgram', 'createTexture', 'createFramebuffer']) gl[name] = () => ({ id: id++ });
  for (const name of ['bindVertexArray', 'bindBuffer', 'bufferData', 'bindBufferBase', 'shaderSource', 'compileShader', 'deleteShader', 'attachShader',
    'linkProgram', 'uniformBlockBinding', 'texParameteri', 'viewport', 'clearColor', 'blitFramebuffer', 'enable', 'blendFunc', 'disable', 'deleteTexture',
    'deleteFramebuffer', 'deleteProgram', 'deleteBuffer', 'deleteVertexArray', 'bufferSubData', 'uniform1f', 'uniform2f', 'uniform2fv', 'uniform3fv',
    'uniform4fv', 'uniform1fv', 'uniform1ui', 'uniform1i']) gl[name] = () => {};
  gl.texStorage2D = (target, levels, format, w, h) => calls.push({ storage: format, w, h });
  gl.getExtension = name => name === 'EXT_disjoint_timer_query_webgl2' ? null : {};
  gl.getShaderParameter = gl.getProgramParameter = () => true; gl.getUniformBlockIndex = () => 0;
  gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_COMPLETE;
  gl.getUniformLocation = (p, name) => ({ p, name }); gl.useProgram = p => { program = p; };
  gl.activeTexture = v => { unit = v - gl.TEXTURE0; }; gl.bindTexture = (target, t) => textures.set(unit, t);
  gl.bindFramebuffer = (target, f) => { if (target !== gl.READ_FRAMEBUFFER) fbo = f; };
  gl.framebufferTexture2D = (target, attachment, type, t) => { if (!attachments.has(fbo)) attachments.set(fbo, new Map()); attachments.get(fbo).set(attachment, t); };
  gl.clear = () => calls.push({ clear: fbo });
  gl.drawArrays = (mode, first, count) => {
    calls.push({ program, mode, count, fbo });
  };
  return gl;
}
function realEngine(kinds = ['main']) {
  const gl = commandGl(), canvas = { width: 1280, height: 720, getContext: () => gl }; gl.canvas = canvas;
  const engine = new (r.get('WorldEngine'))(canvas), score = scoreFor(kinds, 10); engine.selectType('g-fluid', true); engine.setScore(score);
  return { engine, gl, features: new Feature() };
}

test('UW-F2-07 WORLD-38 暖機窓420枚・engineは旧流体を持たない・GPU命令回数', async () => {
  const { engine, gl } = realEngine(); const a = engine.type;
  assert.equal(a.warmFrames, 420); assert.equal(engine.fluid, undefined); assert.equal(engine.particles, undefined); assert.equal(engine.depthParticles, undefined);
  assert.equal(engine.post.stepFeedback, undefined);
  // 暖機窓：10秒（600ステップ）のadvanceToで描くのは末尾420枚。最初の窓でwarmStart（クリア）が1回。
  let renders = 0, warms = 0; const render = a.render.bind(a), warm = a.warmStart.bind(a);
  a.render = input => { renders++; render(input); }; a.warmStart = t => { warms++; assert.equal(t, 181 / 60); warm(t); };
  engine.advanceTo(10); assert.equal(engine.frame, 601); assert.equal(renders, 420); assert.equal(warms, 1);
  // 格子の確保：速度/圧力384x216、染料1152x648。
  const storages = gl.calls.filter(c => c.storage === gl.RGBA16F);
  assert.equal(storages.filter(c => c.w === 384 && c.h === 216).length, 5, '速度2＋圧力2＋発散1');
  assert.equal(storages.filter(c => c.w === 1152 && c.h === 648).length, 2);
  // 1ステップ分の命令：移流1、渦度1、発散1、Jacobi24、射影1、染料1、合成1、塵の点12000。
  const count = p => gl.calls.filter(c => c.program === p).length, mark = gl.calls.length;
  const before = [a.advectProgram, a.vorticityProgram, a.divergenceProgram, a.jacobiProgram, a.projectProgram, a.dyeProgram, a.compositeProgram].map(count);
  a.simPending = true; a.render(engine.typeInput);
  const after = [a.advectProgram, a.vorticityProgram, a.divergenceProgram, a.jacobiProgram, a.projectProgram, a.dyeProgram, a.compositeProgram].map(count);
  assert.deepEqual(after.map((v, i) => v - before[i]), [1, 1, 1, 24, 1, 1, 1]);
  assert.equal(gl.calls.slice(mark).filter(c => c.program === a.dustProgram)[0].count, 12000);
  // 再描画（dt0）では積分しない。
  const again = count(a.advectProgram); a.render(engine.typeInput); assert.equal(count(a.advectProgram), again);
  assert.equal(engine.metrics().particleCount, 12000); assert.equal(engine.metrics().fluidWidth, 384); assert.equal(engine.metrics().dyeWidth, 1152);
  // postの分岐：閾値.7・強度.6・feedbackなし。
  engine._draw(); assert.equal(engine.post.fluid2, true); assert.equal(engine.post.attractor, false); assert.equal(engine.post.gargantua, false);
  assert.ok(r.get('WORLD_POST_FRAGMENT').includes('const float FLUID2_BLOOM_STRENGTH = 0.60000000;'));
  assert.equal(r.get('WORLD_FLUID2').BLOOM_THRESHOLD, .7);
  engine.dispose();
  console.log('UW-F2-07 warmDraws=420 passes=[1,1,1,24,1,1,1] dust=12000');
});

test('UW-F2-08 WORLD-38 同じ入力列から同じCPU状態（再演・逆シーク）', () => {
  const run = () => {
    const { analyzer, features, input, engine } = setup(['intro', 'build', 'drop'], 10);
    features.bandsSmooth.fill(.4); features.raw[L.LEVEL] = .5;
    for (let i = 0; i < 1500; i++) {
      const t = i / 60; engine.sectionIndex = Math.min(2, Math.floor(t / 10));
      features.raw[L.ONSET_FLAGS] = i % 40 === 0 ? 5 : 0; input.tSec = t; analyzer.step(input);
      if (analyzer.simPending) analyzer.kickPush = 0;
    }
    return [analyzer.omega, analyzer.sectionJet, analyzer.zoom, analyzer.paletteShift, analyzer.glintSerial, ...analyzer.glints, ...analyzer.cam];
  };
  assert.deepEqual(run(), run());
});

test('UW-F2-09 WORLD-39 帯域ごとのEMA・正規化（床・上限clamp）・初期値・BG_SIGMA撤去', () => {
  const norm = r.get('worldFluid2Norm'), { analyzer, features, input } = setup();
  assert.equal(analyzer.normMean.length, 32); assert.ok(analyzer.normMean.every(v => Math.abs(v - C.NORM_INIT) < 1e-6));
  assert.equal(C.NORM_INIT, .2);
  // 正規化式：n = clamp(L / max(FLOOR, m*GAIN), 0, 1)
  const m = .3, l = .25; close(norm(l, m), l / (m * C.NORM_GAIN));
  assert.equal(norm(.01, 0), .01 / C.NORM_FLOOR);   // 平均0でも床で割る
  assert.equal(norm(5, .1), 1); assert.equal(norm(-1, .1), 0);
  // EMA：1ステップ後 m = m0 + (L - m0)*(1 - exp(-dt/TAU))、出力は更新後の平均で正規化
  features.bandsSmooth.fill(0); features.bandsSmooth[3] = .6; analyzer.step(input);
  const a = 1 - Math.exp(-input.dt / C.NORM_TAU), b = analyzer.bandUniforms;
  const m3 = C.NORM_INIT + (b[12] - C.NORM_INIT) * a, m0 = C.NORM_INIT + (b[0] - C.NORM_INIT) * a;
  close(analyzer.normMean[3], m3, 1e-6); close(analyzer.normMean[0], m0, 1e-6);
  close(analyzer.jetLevels[3], norm(analyzer.bandUniforms[12], analyzer.normMean[3]), 1e-6); assert.equal(analyzer.jetLevels[0], norm(b[0], analyzer.normMean[0]));
  // 定常入力 L では m→L、n→min(1, 1/GAIN)。割り当てなし（同じ配列のまま）
  const mean = analyzer.normMean, lv = analyzer.jetLevels;
  features.bandsSmooth.fill(.4);
  for (let i = 0; i < 60 * 40; i++) { input.tSec = i / 60; analyzer.step(input); }
  assert.equal(analyzer.normMean, mean); assert.equal(analyzer.jetLevels, lv);
  const L = analyzer.bandUniforms[0]; assert.ok(Math.abs(mean[0] - L) < 1e-3); close(lv[0], Math.min(1, 1 / C.NORM_GAIN), 1e-2);
  // reset / warmStart で .2 に戻る
  analyzer.reset(); assert.ok(mean.every(v => Math.abs(v - C.NORM_INIT) < 1e-6));
  mean.fill(.9); analyzer._clear = () => {}; analyzer.warmStart(0); assert.ok(mean.every(v => Math.abs(v - C.NORM_INIT) < 1e-6));
  // BG_SIGMA 撤去
  assert.ok(!('BG_SIGMA' in C)); assert.ok(!r.get('WORLD_FLUID2_ADVECT_FRAGMENT').includes('BG_SIGMA'));
  assert.ok(r.get('WORLD_FLUID2_ADVECT_FRAGMENT').includes('uniform float jetLevels[32];'));
  console.log('UW-F2-09 normTau=' + C.NORM_TAU + ' floor=' + C.NORM_FLOOR + ' gain=' + C.NORM_GAIN);
});

test('UW-F2-10 WORLD-39 差動回転vθ(r)：R0で連続・角速度は外側ほど遅い', () => {
  const vt = r.get('worldFluid2Tangential'), w = 1.3, R0 = C.R0, e = 1e-9;
  close(vt(R0 - e, w), vt(R0 + e, w), 1e-7); close(vt(R0, w), w * R0);
  close(vt(.1, w), w * .1);                                  // 内側は剛体回転
  close(vt(2 * R0, w), w * R0 * Math.sqrt(.5));              // 外側は R0*sqrt(R0/r)
  let prev = Infinity;
  for (let r1 = .05; r1 < 2.2; r1 += .05) { const om = vt(r1, w) / r1; assert.ok(om <= prev + 1e-12); prev = om; }
  assert.ok(vt(1, w) / 1 < vt(R0, w) / R0);
  const shader = r.get('WORLD_FLUID2_ADVECT_FRAGMENT');
  assert.ok(shader.includes('R0 * sqrt(R0 / rr)') && shader.includes('smoothstep(2.2, 1.4, rr)'));
  console.log('UW-F2-10 vθ(R0)=' + vt(R0, w).toFixed(4));
});
