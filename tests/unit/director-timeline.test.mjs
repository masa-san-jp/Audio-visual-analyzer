// 目的 — シーンとコンパイルの受け入れ検証 — Phase 18 計画書 §8.2 U18-13〜16・U18-19。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic([
  'js/vis-utils.js', 'js/settings.js',
  'js/renderers/bars.js', 'js/renderers/lines.js', 'js/renderers/dots.js', 'js/renderers/radial.js',
  'js/renderer-registry.js', 'js/director-scenes.js', 'js/director-timeline.js',
]);
const DIRECTOR_CONST = get('DIRECTOR_CONST');
const DIRECTOR_MANAGED_KEYS = get('DIRECTOR_MANAGED_KEYS');
const DIRECTOR_SCENES = get('DIRECTOR_SCENES');
const directorSceneCandidates = get('directorSceneCandidates');
const applyScenePatch = get('applyScenePatch');
const compileDirectorTimeline = get('compileDirectorTimeline');
const fnv1a32 = get('fnv1a32');
const directorVariationApplicable = get('directorVariationApplicable');
const applyDirectorVariation = get('applyDirectorVariation');
const makeRng = get('makeRng');
const createDefaultSettings = get('createDefaultSettings');
const registry = get('RENDERER_REGISTRY');
const map = JSON.parse(fs.readFileSync(new URL('../fixtures/songmap-128.json', import.meta.url), 'utf8'));
const options = { intensity: 'standard', pool: 'builtin', flash: true, seedOffset: 0 };
const intensities = ['calm', 'standard', 'wild'];

test('U18-13 定数名・値は §6.2 と完全一致する', () => {
  assert.deepEqual(DIRECTOR_CONST, {
    KIND_CLASS: { intro: 'calm', break: 'calm', outro: 'calm', build: 'build', drop: 'drop' },
    MAIN_DROP_ENERGY: 0.6,
    VARIATION_PERIOD_BARS: { calm: 16, standard: 8, wild: 4 },
    VARIATION_OPS: ['hueShift', 'method', 'mirror', 'layers'],
    HUE_SHIFT_DEG: { calm: 30, standard: 60, wild: 60 },
    RAMP_MOTION_MUL: { calm: 1.4, standard: 1.8, wild: 2.2 },
    RAMP_AFTERIMAGE_ADD: 3, RAMP_PARTICLE_MUL: 1.5,
    FADE_MIN_SEC: 0.25, FADE_MAX_SEC: 1.0,
    FLASH_PEAK_ALPHA: 0.8, FLASH_TAU_SEC: 0.12, FLASH_DURATION_SEC: 0.4,
    FLASH_MIN_INTERVAL_SEC: 2.0, SEEK_RESET_SEC: 1.0,
  });
  assert.deepEqual(DIRECTOR_MANAGED_KEYS, [
    'analyzerType', 'expressionMethod', 'barDisplayMode', 'layerCount',
    'motionSpeed', 'particleAmount', 'afterimageIntensity', 'hue',
  ]);
});

test('U18-13 FNV-1a は既知値と UTF-16 コード単位に一致する', () => {
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('hello'), 0x4f9f2cab);
  // 独立した整数演算で、サロゲート対を2コード単位として扱うことを確認する。
  let expected = 0x811c9dc5n;
  for (const unit of [0x6f14n, 0x51fan, 0xd83dn, 0xde00n]) {
    expected = ((expected ^ unit) * 0x01000193n) & 0xffffffffn;
  }
  assert.equal(fnv1a32('演出😀'), Number(expected));
});

test('U18-13 同じ入力の深い一致・seedOffset 0〜9 によるシーン変更・入力非破壊', t => {
  const before = structuredClone(map);
  let changed = 0;
  for (const intensity of intensities) {
    const baseline = compileDirectorTimeline(map, { ...options, intensity });
    for (let seedOffset = 0; seedOffset <= 9; seedOffset++) {
      const opts = { ...options, intensity, seedOffset };
      const first = compileDirectorTimeline(map, opts);
      assert.equal(first.intensity, intensity);
      assert.deepEqual(first, compileDirectorTimeline(map, opts));
      assert.deepEqual(opts, { ...options, intensity, seedOffset });
      assert.equal(first.seed, fnv1a32(`120.000|127.75|6|${seedOffset}`));
      if (first.segments.some((seg, i) => seg.sceneId !== baseline.segments[i].sceneId)) changed++;
    }
  }
  assert.ok(changed > 0);
  assert.deepEqual(map, before);
  t.diagnostic(`シーン変更あり: ${changed}/30 条件（3強度 × seedOffset 0〜9）`);
});

test('U18-14 fixture の2つのドロップは同じシーン ID を再利用する', () => {
  for (const intensity of intensities) {
    for (let seedOffset = 0; seedOffset < 50; seedOffset++) {
      const timeline = compileDirectorTimeline(map, { ...options, intensity, seedOffset });
      const drops = timeline.segments.filter(seg => seg.kind === 'drop');
      assert.equal(drops.length, 2);
      assert.equal(drops[0].sceneId, drops[1].sceneId);
      assert.equal(timeline.segments[0].sceneId, timeline.segments[3].sceneId);
      assert.equal(timeline.segments[0].sceneId, timeline.segments[5].sceneId);
    }
  }
  const sameLabel = { ...map, sections: map.sections.map(s => ({ ...s, label: 'A' })) };
  const timeline = compileDirectorTimeline(sameLabel, options);
  assert.notEqual(timeline.segments[0].sceneId, timeline.segments[1].sceneId);
  assert.notEqual(timeline.segments[1].sceneId, timeline.segments[2].sceneId);
  assert.equal(timeline.segments[0].sceneId, timeline.segments[3].sceneId);
});

test('U18-15 seedOffset 0〜49 で連続シーンを回避する（fixture・同系統の新規ラベル）', t => {
  // fixture から作る追加ケースで、同じ候補リストから前シーンを除く処理も通す。
  const consecutive = { ...map, sections: map.sections.map((s, i) => ({ ...s, kind: 'drop', label: `D${i}` })) };
  const presets = DIRECTOR_SCENES.map(scene => ({ name: scene.id, settings: { ...scene.patch } }));
  let pairs = 0;
  for (const input of [map, consecutive]) {
    for (const pool of ['builtin', 'presets']) {
      for (const intensity of intensities) {
        for (let seedOffset = 0; seedOffset < 50; seedOffset++) {
          const timeline = compileDirectorTimeline(input, { ...options, pool, intensity, seedOffset }, presets);
          for (let i = 1; i < timeline.segments.length; i++) {
            assert.notEqual(timeline.segments[i - 1].sceneId, timeline.segments[i].sceneId);
            pairs++;
          }
        }
      }
    }
  }
  t.diagnostic(`連続回避: ${pairs}/${pairs} 組（seedOffset 0〜49）`);
});

test('U18-16 内蔵14シーンは §6.3 の値・空欄・系統と一致する', () => {
  const rows = [
    ['spectrogram', 'calm'], ['lissajous', 'calm', 'line', undefined, undefined, 1.0, undefined, 4],
    ['flower', 'calm', 'line', undefined, 2, 0.6, undefined, 3],
    ['voronoi', 'calm', undefined, undefined, 2, 0.5, 40, 2],
    ['ripple', 'calm', undefined, undefined, 2, 0.8, undefined, 3],
    ['tunnel', 'build', 'line', undefined, undefined, 1.2, undefined, 2],
    ['terrain', 'build', 'line', undefined, undefined, 1.0, undefined, 0],
    ['ring3d', 'build', 'line', undefined, 2, 1.2, undefined, 2],
    ['flow', 'build', 'dot', undefined, 2, 1.2, 70, 4],
    ['particles', 'drop', 'dot', undefined, 3, 1.5, 90, 3],
    ['bar3d', 'drop', undefined, undefined, 3, undefined, undefined, 0],
    ['radial', 'drop', 'bar', undefined, 3, undefined, undefined, 2],
    ['metaball', 'drop', undefined, undefined, 2, 1.2, undefined, 0],
    ['bar', 'drop', 'bar', 'mirror-vertical', 4, undefined, undefined, 1],
  ];
  const keys = ['expressionMethod', 'barDisplayMode', 'layerCount', 'motionSpeed', 'particleAmount', 'afterimageIntensity'];
  const expected = rows.map(([type, cls, ...values]) => {
    const patch = { analyzerType: type };
    values.forEach((value, i) => { if (value !== undefined) patch[keys[i]] = value; });
    return { id: `builtin:${type}`, cls, patch };
  });
  assert.deepEqual(DIRECTOR_SCENES, expected);
  assert.deepEqual(Object.keys(registry).sort(), rows.map(row => row[0]).sort());
});

test('U18-16 各 op の効果は累積し、末尾から先頭へ循環する', () => {
  for (const intensity of intensities) {
    const settings = createDefaultSettings();
    settings.hue = 350;
    applyDirectorVariation(settings, 'hueShift', intensity);
    assert.equal(settings.hue, intensity === 'calm' ? 20 : 50);
    applyDirectorVariation(settings, 'hueShift', intensity);
    assert.equal(settings.hue, intensity === 'calm' ? 50 : 110);
    for (const method of ['line', 'dot', 'bar']) {
      applyDirectorVariation(settings, 'method', intensity);
      assert.equal(settings.expressionMethod, method);
    }
    for (const mode of ['mirror-vertical', 'mirror-horizontal', 'normal']) {
      applyDirectorVariation(settings, 'mirror', intensity);
      assert.equal(settings.barDisplayMode, mode);
    }
    for (const count of [2, 3, 4, 1]) {
      applyDirectorVariation(settings, 'layers', intensity);
      assert.equal(settings.layerCount, count);
    }
  }
});

test('U18-16 14タイプ全ての適用条件を使い、非対応 op を飛ばして次を選ぶ', t => {
  let skipped = 0;
  let starts = new Set();
  for (const scene of DIRECTOR_SCENES) {
    const cap = registry[scene.patch.analyzerType].capabilities;
    const applicable = {
      hueShift: true, method: cap.methods.length >= 2,
      mirror: cap.barDisplayMode === true, layers: cap.layers === true,
    };
    for (const [op, allowed] of Object.entries(applicable)) {
      const settings = createDefaultSettings();
      applyScenePatch(settings, scene.patch);
      assert.equal(directorVariationApplicable(settings, op), allowed);
      if (!allowed) {
        const before = structuredClone(settings);
        applyDirectorVariation(settings, op, 'wild');
        assert.deepEqual(settings, before);
      }
    }
    // 候補を1つに固定。最初の乱数はシーン、次の乱数は opStart。
    const single = [{ name: scene.id, settings: scene.patch }];
    for (let seedOffset = 0; seedOffset < 50; seedOffset++) {
      const timeline = compileDirectorTimeline(map, { ...options, pool: 'presets', intensity: 'wild', seedOffset }, single);
      const rng = makeRng(timeline.seed);
      const seen = new Set();
      for (let i = 0; i < map.sections.length; i++) {
        const seg = timeline.segments[i];
        const key = map.sections[i].label + '|' + seg.cls;
        if (!seen.has(key)) { rng(); seen.add(key); }
        let cursor = Math.floor(rng() * 4);
        if (seg.sceneId !== `preset:${scene.id}`) continue;
        starts.add(cursor);
        for (const variation of seg.variations) {
          while (!applicable[DIRECTOR_CONST.VARIATION_OPS[cursor % 4]]) { cursor++; skipped++; }
          assert.equal(variation.op, DIRECTOR_CONST.VARIATION_OPS[cursor % 4]);
          cursor++;
        }
      }
    }
  }
  assert.equal(starts.size, 4);
  assert.ok(skipped > 0);
  t.diagnostic(`opStart 4/4 種類・非対応 op のスキップ ${skipped} 回`);
});

test('U18-16 変化は強度・系統の間隔と小節開始時刻に一致する', () => {
  for (const intensity of intensities) {
    const timeline = compileDirectorTimeline(map, { ...options, intensity });
    for (const [i, seg] of timeline.segments.entries()) {
      const period = seg.cls === 'drop' ? { calm: 8, standard: 4, wild: 2 }[intensity]
        : { calm: 16, standard: 8, wild: 4 }[intensity];
      const section = map.sections[i];
      const times = [];
      for (let bar = section.startBar + period; bar < section.endBar; bar += period) times.push(map.bars[bar].startSec);
      assert.deepEqual(seg.variations.map(v => v.timeSec), times);
    }
  }
  const shortenedBars = { ...map, bars: map.bars.slice(0, 18) };
  const timeline = compileDirectorTimeline(shortenedBars, { ...options, intensity: 'wild' });
  assert.ok(timeline.segments[2].variations.length > 0);
  assert.ok(timeline.segments[2].variations.every(v => v.timeSec === map.durationSec));
});

test('U18-13 タイムライン形状・main の閾値・カット・フェード・ランプ・フラッシュのコンパイル', () => {
  for (const intensity of intensities) {
    const timeline = compileDirectorTimeline(map, { ...options, intensity });
    assert.equal(timeline.version, 1);
    assert.equal(timeline.durationSec, 120);
    assert.equal(timeline.segments.length, 6);
    for (const [i, seg] of timeline.segments.entries()) {
      assert.equal(seg.startSec, map.sections[i].startSec);
      assert.equal(seg.endSec, map.sections[i].endSec);
      assert.equal(seg.sectionIndex, i);
      assert.equal(seg.kind, map.sections[i].kind);
      assert.deepEqual(seg.transitionIn, i === 0 || seg.kind === 'drop'
        ? { type: 'cut', duration: 0 } : { type: 'fade', duration: 60 / 127.75 });
      assert.deepEqual(seg.ramp, seg.kind === 'build' ? {
        motionMul: [1, { calm: 1.4, standard: 1.8, wild: 2.2 }[intensity]],
        afterimageAdd: [0, 3], particleMul: [1, 1.5],
      } : null);
    }
    assert.deepEqual(timeline.flashes, intensity === 'calm' ? [] : [map.sections[2].startSec, map.sections[4].startSec]);
    assert.deepEqual(compileDirectorTimeline(map, { ...options, intensity, flash: false }).flashes, []);
  }
  const mainMap = { ...map, sections: map.sections.map((s, i) => ({ ...s, kind: 'main', energy: i % 2 ? 0.6 : 0.599 })) };
  assert.deepEqual(compileDirectorTimeline(mainMap, options).segments.map(seg => seg.cls), ['calm', 'drop', 'calm', 'drop', 'calm', 'drop']);
  for (const [bpm, duration] of [[300, 0.25], [30, 1]]) {
    assert.equal(compileDirectorTimeline({ ...map, bpm }, options).segments[1].transitionIn.duration, duration);
  }
  // コンパイルだけを検証。状態評価のフラッシュ減衰は T18-08 が担当する。
  const packed = { ...map, sections: map.sections.map((s, i) => ({ ...s, kind: 'drop', startSec: i * 0.5 })) };
  assert.deepEqual(compileDirectorTimeline(packed, options).flashes, [0.5, 2.5]);
});

test('U18-19 内蔵シーンと全タイプのプリセットで保護キーを保持する', t => {
  const base = createDefaultSettings();
  Object.assign(base, {
    bgColor: '#fff', aspectRatio: '1:1', hue: 317, hueRange: 12, saturation: 43, brightness: 57,
    videoCompositeEnabled: true, videoCompositeOpacity: 37, videoCompositeBlendMode: 'multiply',
    autoGain: true, layerSplit: 'mel', sensitivity: 2.3, smoothing: 0.23,
  });
  base.layers[0].hueOffset = 17;
  const before = structuredClone(base);
  const allowed = new Set(DIRECTOR_MANAGED_KEYS.filter(key => key !== 'hue'));
  const forbidden = Object.keys(base).filter(key => !allowed.has(key));
  const presets = DIRECTOR_SCENES.map((scene, i) => ({
    name: `P${String(i).padStart(2, '0')}`,
    settings: { ...createDefaultSettings(), ...scene.patch },
  }));
  const scenes = ['calm', 'build', 'drop'].flatMap(cls => directorSceneCandidates(cls, 'presets', presets));
  assert.equal(scenes.length, 14);
  for (const scene of [...DIRECTOR_SCENES, ...scenes]) {
    assert.ok(Object.keys(scene.patch).every(key => allowed.has(key)));
    const settings = structuredClone(base);
    applyScenePatch(settings, scene.patch);
    for (const key of forbidden) assert.deepEqual(settings[key], base[key], `${scene.id}: ${key}`);
  }
  for (let seedOffset = 0; seedOffset < 50; seedOffset++) {
    const timeline = compileDirectorTimeline(map, { ...options, pool: 'presets', seedOffset }, presets);
    for (const seg of timeline.segments) {
      const settings = structuredClone(base);
      applyScenePatch(settings, seg.patch);
      for (const variation of seg.variations) applyDirectorVariation(settings, variation.op, 'standard');
      for (const key of forbidden.filter(key => key !== 'hue')) assert.deepEqual(settings[key], base[key]);
    }
  }
  // applyScenePatch 自体も、全設定を渡されても保護キーを取り込まない。
  const hostile = { ...createDefaultSettings(), analyzerType: 'bar' };
  const settings = structuredClone(base);
  applyScenePatch(settings, hostile);
  for (const key of forbidden) assert.deepEqual(settings[key], base[key]);
  assert.deepEqual(base, before);
  t.diagnostic(`保護キー ${forbidden.length} 個・内蔵14 + プリセット14 シーン・コンパイル50条件`);
});

test('U18-19 パッチは適用後のタイプの capabilities に従う', () => {
  for (const type of Object.keys(registry)) {
    const settings = createDefaultSettings();
    settings.analyzerType = type === 'bar' ? 'spectrogram' : 'bar';
    const cap = registry[type].capabilities;
    const patch = { analyzerType: type, expressionMethod: 'dot', barDisplayMode: 'mirror-horizontal',
      layerCount: 4, motionSpeed: 0.7, particleAmount: 83, afterimageIntensity: 0 };
    applyScenePatch(settings, patch);
    assert.equal(settings.analyzerType, type);
    assert.equal(settings.expressionMethod, cap.methods.includes('dot') ? 'dot' : 'bar');
    assert.equal(settings.barDisplayMode, cap.barDisplayMode === true ? 'mirror-horizontal' : 'normal');
    assert.equal(settings.layerCount, cap.layers === true ? 4 : 1);
    assert.equal(settings.motionSpeed, 0.7);
    assert.equal(settings.particleAmount, 83);
    assert.equal(settings.afterimageIntensity, 0);
    applyScenePatch(settings, { expressionMethod: 'unsupported' });
    assert.equal(settings.expressionMethod, cap.methods.includes('dot') ? 'dot' : 'bar');
  }
});

test('U18-19 プリセット候補は ID 昇順・系統ごとの内蔵フォールバック', () => {
  const presets = [
    { name: 'Alpha', settings: { analyzerType: 'bar', hue: 1, bgColor: '#fff' } },
    { name: 'Zulu', settings: { analyzerType: 'radial', sensitivity: 9 } },
  ];
  const before = structuredClone(presets);
  assert.deepEqual(directorSceneCandidates('drop', 'presets', presets), [
    { id: 'preset:Alpha', cls: 'drop', patch: { analyzerType: 'bar' } },
    { id: 'preset:Zulu', cls: 'drop', patch: { analyzerType: 'radial' } },
  ]);
  for (const cls of ['calm', 'build']) {
    assert.deepEqual(directorSceneCandidates(cls, 'presets', presets), directorSceneCandidates(cls, 'builtin'));
  }
  for (const cls of ['calm', 'build', 'drop']) {
    const ids = directorSceneCandidates(cls, 'builtin').map(scene => scene.id);
    assert.deepEqual(ids, [...ids].sort());
  }
  assert.deepEqual(compileDirectorTimeline(map, { ...options, pool: 'presets' }, []), compileDirectorTimeline(map, options));
  assert.deepEqual(presets, before);
});
