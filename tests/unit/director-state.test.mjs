// 目的 — 状態評価と描画の受け入れ検証 — Phase 18 計画書 §6.6・§6.7・§8.2 U18-17・U18-18・U18-20。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic([
  'js/vis-utils.js', 'js/settings.js',
  'js/renderers/bars.js', 'js/renderers/lines.js', 'js/renderers/dots.js', 'js/renderers/radial.js',
  'js/renderer-registry.js', 'js/director-scenes.js', 'js/director-timeline.js',
]);
const directorStateAt = get('directorStateAt');
const createDirectorState = get('createDirectorState');
const createDefaultSettings = get('createDefaultSettings');
const compileDirectorTimeline = get('compileDirectorTimeline');
const C = get('DIRECTOR_CONST');
const map = JSON.parse(fs.readFileSync(new URL('../fixtures/songmap-128.json', import.meta.url), 'utf8'));
const options = { intensity: 'standard', pool: 'builtin', flash: true, seedOffset: 0 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} != ${expected}`);

function segment(startSec, endSec, overrides = {}) {
  return { startSec, endSec, sceneId: `test:${startSec}`, patch: { analyzerType: 'bar' },
    variations: [], ramp: null, transitionIn: { type: 'cut', duration: 0 }, ...overrides };
}
function timeline(segments, overrides = {}) {
  return { version: 1, intensity: 'standard', durationSec: segments.at(-1).endSec,
    segments, flashes: [], ...overrides };
}
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

test('U18-17 フェード開始・中央・終了は mix 0/0.5/1、ドロップはカット', t => {
  const compiled = compileDirectorTimeline(map, options);
  const base = createDefaultSettings();
  const out = createDirectorState();
  let fades = 0;
  let cuts = 0;
  for (let i = 1; i < compiled.segments.length; i++) {
    const seg = compiled.segments[i];
    assert.equal(directorStateAt(compiled, seg.startSec, base, out), out);
    assert.equal(out.primary.segmentIndex, i);
    assert.equal(out.primary.sceneId, seg.sceneId);
    if (seg.transitionIn.type === 'fade') {
      for (const fraction of [0, 0.5, 1]) {
        directorStateAt(compiled, seg.startSec + fraction * seg.transitionIn.duration, base, out);
        close(out.mix, fraction);
        if (fraction < 1) {
          assert.equal(out.secondary.segmentIndex, i - 1);
          assert.equal(out.secondary.sceneId, compiled.segments[i - 1].sceneId);
        } else assert.equal(out.secondary, null);
      }
      fades++;
    } else {
      assert.equal(seg.kind, 'drop');
      assert.equal(out.secondary, null);
      assert.equal(out.mix, 1);
      cuts++;
    }
  }
  assert.equal(fades, 3);
  assert.equal(cuts, 2);
  t.diagnostic(`フェード ${fades}区間 × 3地点: 0/0.5/1、ドロップ ${cuts}区間: カット`);
});

test('U18-17 ビルド 0/50/100% の式・クランプ・丸め、前シーンの終端', t => {
  const base = createDefaultSettings();
  const out = createDirectorState();
  const measurements = [];
  for (const intensity of ['calm', 'standard', 'wild']) {
    const compiled = compileDirectorTimeline(map, { ...options, intensity });
    const build = compiled.segments.find(seg => seg.kind === 'build');
    // 最終ビルドなら100%も primary として直接観測できる。
    const single = timeline([{ ...build, startSec: 0, endSec: 10, variations: [],
      transitionIn: { type: 'cut', duration: 0 },
      patch: { analyzerType: 'flow', motionSpeed: 1, afterimageIntensity: 2, particleAmount: 40 } }], { intensity });
    for (const u of [0, 0.5, 1]) {
      directorStateAt(single, 10 * u, base, out);
      close(out.primary.settings.motionSpeed, 1 + (C.RAMP_MOTION_MUL[intensity] - 1) * u);
      close(out.primary.settings.afterimageIntensity, 2 + C.RAMP_AFTERIMAGE_ADD * u);
      assert.equal(out.primary.settings.particleAmount, Math.round(40 * (1 + (C.RAMP_PARTICLE_MUL - 1) * u)));
      measurements.push(`${intensity}@${u}: ${out.primary.settings.motionSpeed.toFixed(2)}/${out.primary.settings.afterimageIntensity}/${out.primary.settings.particleAmount}`);
    }
    single.segments[0].patch = { analyzerType: 'flow', motionSpeed: 2.9, afterimageIntensity: 9, particleAmount: 95 };
    directorStateAt(single, 10, base, out);
    assert.equal(out.primary.settings.motionSpeed, 3);
    assert.equal(out.primary.settings.afterimageIntensity, 10);
    assert.equal(out.primary.settings.particleAmount, 100);
    single.segments[0].patch = { analyzerType: 'flow', motionSpeed: 0.01, afterimageIntensity: -2, particleAmount: 1 };
    directorStateAt(single, 0, base, out);
    assert.equal(out.primary.settings.motionSpeed, 0.1);
    assert.equal(out.primary.settings.afterimageIntensity, 0);
    assert.equal(out.primary.settings.particleAmount, 10);
  }
  const previous = segment(0, 10, {
    patch: { analyzerType: 'flow', motionSpeed: 1, afterimageIntensity: 2, particleAmount: 41 },
    variations: [{ timeSec: 9, op: 'hueShift' }],
    ramp: { motionMul: [1, C.RAMP_MOTION_MUL.standard], afterimageAdd: [0, C.RAMP_AFTERIMAGE_ADD], particleMul: [1, C.RAMP_PARTICLE_MUL] },
  });
  const two = timeline([previous, segment(10, 20, { transitionIn: { type: 'fade', duration: C.FADE_MAX_SEC } })]);
  directorStateAt(two, 10.5, base, out);
  close(out.secondary.settings.motionSpeed, C.RAMP_MOTION_MUL.standard);
  close(out.secondary.settings.afterimageIntensity, 2 + C.RAMP_AFTERIMAGE_ADD);
  assert.equal(out.secondary.settings.particleAmount, Math.round(41 * C.RAMP_PARTICLE_MUL));
  assert.equal(out.secondary.settings.hue, (base.hue + C.HUE_SHIFT_DEG.standard) % 360);
  t.diagnostic(`motion/afterimage/particle: ${measurements.join(', ')}`);
});

test('U18-17 累積変化は timeline.intensity を使い、逆行・範囲外時刻・ユーザー変更も決定的', () => {
  const compiled = freezeDeep(timeline([
    segment(0, 10, { variations: [
      { timeSec: 2, op: 'hueShift' }, { timeSec: 3, op: 'hueShift' },
      { timeSec: 4, op: 'method' }, { timeSec: 5, op: 'mirror' }, { timeSec: 6, op: 'layers' },
    ] }),
    segment(10, 20, { patch: { analyzerType: 'spectrogram', expressionMethod: 'dot', layerCount: 4, barDisplayMode: 'mirror-horizontal' },
      transitionIn: { type: 'fade', duration: C.FADE_MAX_SEC } }),
  ], { intensity: 'calm' }));
  const base = freezeDeep({ ...createDefaultSettings(), hue: 350, directorIntensity: 'wild' });
  const out = createDirectorState();
  directorStateAt(compiled, 8, base, out);
  assert.equal(out.primary.settings.hue, 50);
  assert.equal(out.primary.settings.expressionMethod, 'line');
  assert.equal(out.primary.settings.barDisplayMode, 'mirror-vertical');
  assert.equal(out.primary.settings.layerCount, 2);
  for (const time of [10.5, 20, 100, 1, -5, 2, 3, 6, 10.5, 0]) {
    directorStateAt(compiled, time, base, out);
    const independent = directorStateAt(compiled, time, base, createDirectorState());
    assert.deepEqual(out.primary, independent.primary);
    assert.deepEqual(out.secondary, independent.secondary);
    assert.equal(out.mix, independent.mix);
    assert.equal(out.flashAlpha, independent.flashAlpha);
  }
  directorStateAt(compiled, 10.5, base, out);
  assert.equal(out.primary.settings.analyzerType, 'spectrogram');
  assert.equal(out.primary.settings.expressionMethod, base.expressionMethod);
  assert.equal(out.primary.settings.layerCount, base.layerCount);
  assert.equal(out.primary.settings.barDisplayMode, base.barDisplayMode);
  assert.equal(out.secondary.settings.hue, 50);
  assert.notEqual(out.primary.settings.layers, base.layers);
  const changed = { ...base, hue: 100, bgColor: '#fff', brightness: 12, videoCompositeOpacity: 33,
    layers: base.layers.map(layer => ({ ...layer, sensitivity: 2, hueOffset: 13 })) };
  directorStateAt(compiled, 10.5, changed, out);
  for (const settings of [out.primary.settings, out.secondary.settings]) {
    assert.equal(settings.bgColor, '#fff');
    assert.equal(settings.brightness, 12);
    assert.equal(settings.videoCompositeOpacity, 33);
    assert.deepEqual(settings.layers, changed.layers);
    settings.layers.forEach((layer, i) => assert.notEqual(layer, changed.layers[i]));
  }
  assert.equal(out.primary.settings.hue, 100);
  assert.equal(out.secondary.settings.hue, 160);
});

test('U18-18 フラッシュ 0/0.12/0.4秒は 0.8/0.8e^-1/0、最新イベントだけを評価', t => {
  const base = createDefaultSettings();
  const out = createDirectorState();
  const values = [];
  for (const start of [0, 30, 75.173]) {
    const compiled = timeline([segment(0, 120)], { flashes: [start] });
    for (const [dt, expected] of [[0, 0.8], [0.12, 0.8 * Math.exp(-1)], [0.4, 0], [0.5, 0]]) {
      directorStateAt(compiled, start + dt, base, out);
      close(out.flashAlpha, expected);
      if (dt >= 0.4) assert.equal(out.flashAlpha, 0);
      assert.ok(out.flashAlpha >= 0 && out.flashAlpha <= C.FLASH_PEAK_ALPHA);
      if (start === 30) values.push(out.flashAlpha);
    }
    if (start > 0) {
      directorStateAt(compiled, start - 0.001, base, out);
      assert.equal(out.flashAlpha, 0);
    }
  }
  const latest = timeline([segment(0, 20)], { flashes: [0, C.FLASH_MIN_INTERVAL_SEC] });
  directorStateAt(latest, C.FLASH_MIN_INTERVAL_SEC, base, out);
  assert.equal(out.flashAlpha, 0.8);
  directorStateAt(latest, 1, base, out);
  assert.equal(out.flashAlpha, 0);
  t.diagnostic(`30秒の発光: +0/+0.12/+0.4/+0.5秒 = ${values.join('/')}`);
});

test('U18-18 フラッシュ間隔 >=2秒、calm または flash=false で無し', t => {
  // 間隔制限に届かないドロップもコンパイル時に抑制される。
  const dense = { ...map, durationSec: 10, sections: Array.from({ length: 9 }, (_, i) => ({
    startSec: i, endSec: i + 1, startBar: i, endBar: i + 1, kind: 'drop', label: String(i), energy: 1,
  })) };
  let minInterval = Infinity;
  let checks = 0;
  for (const input of [map, dense]) {
    for (const intensity of ['calm', 'standard', 'wild']) {
      for (const flash of [true, false]) {
        const compiled = compileDirectorTimeline(input, { ...options, intensity, flash });
        if (intensity === 'calm' || !flash) assert.deepEqual(compiled.flashes, []);
        else {
          assert.ok(compiled.flashes.length >= 2);
          for (let i = 1; i < compiled.flashes.length; i++) {
            const dt = compiled.flashes[i] - compiled.flashes[i - 1];
            assert.ok(dt >= 2);
            minInterval = Math.min(minInterval, dt);
            checks++;
          }
        }
      }
    }
  }
  t.diagnostic(`12条件、フラッシュ間隔 ${checks}組、最短 ${minInterval}秒`);
});

test('U18-20 1000回評価して out・両設定・レイヤーの参照が変わらない', t => {
  const compiled = compileDirectorTimeline(map, { ...options, intensity: 'wild' });
  const base = createDefaultSettings();
  const out = createDirectorState();
  const primary = out.primary;
  const secondary = out._secondary;
  const pSettings = primary.settings;
  const sSettings = secondary.settings;
  const pLayers = pSettings.layers;
  const sLayers = sSettings.layers;
  const pItems = [...pLayers];
  const sItems = [...sLayers];
  const times = [0, 15, 15.1, 30, 60, 60.1, 75, 105, 105.1, 120];
  let faded = 0;
  for (let i = 0; i < 1000; i++) {
    assert.equal(directorStateAt(compiled, times[i % times.length], base, out), out);
    assert.equal(out.primary, primary);
    assert.equal(out._secondary, secondary);
    assert.equal(out.primary.settings, pSettings);
    assert.equal(out._secondary.settings, sSettings);
    assert.equal(pSettings.layers, pLayers);
    assert.equal(sSettings.layers, sLayers);
    for (let j = 0; j < 4; j++) {
      assert.equal(pLayers[j], pItems[j]);
      assert.equal(sLayers[j], sItems[j]);
    }
    if (out.secondary) { assert.equal(out.secondary, secondary); faded++; }
  }
  assert.ok(faded > 0 && faded < 1000);
  t.diagnostic(`1000回、フェード ${faded}回、out/設定2個/配列2個/レイヤー8個の参照変更0`);
});

test('U18-20 手動で事前確保した out も secondary を null にした後に再利用する', () => {
  const secondary = { settings: createDefaultSettings() };
  const out = { primary: { settings: createDefaultSettings() }, secondary, mix: 1, flashAlpha: 0 };
  const compiled = timeline([segment(0, 10), segment(10, 20, { transitionIn: { type: 'fade', duration: 1 } })]);
  directorStateAt(compiled, 0, createDefaultSettings(), out);
  assert.equal(out.secondary, null);
  directorStateAt(compiled, 10.5, createDefaultSettings(), out);
  assert.equal(out.secondary, secondary);
  directorStateAt(compiled, 15, createDefaultSettings(), out);
  directorStateAt(compiled, 10, createDefaultSettings(), out);
  assert.equal(out.secondary, secondary);
});
