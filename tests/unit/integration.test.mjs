// 目的 — GPU タイプの本体統合（WORLD-41）のうち、ブラウザなしで検査できる論理 — doc/20261010-design-integration-v1.md §2〜§4・§6
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

// ── DOM の簡易モック（getElementById は未知の id でも要素を自動生成する） ──
function makeDom() {
  const elements = new Map();
  const make = (id) => ({
    id, style: {}, options: [], value: '', disabled: false, hidden: false, title: '', textContent: '',
    attrs: {}, removeAttribute(name) { delete this.attrs[name]; if (name === 'title') this.title = ''; },
    setAttribute(name, value) { this.attrs[name] = value; },
  });
  const bodyClasses = new Set();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    querySelectorAll() { return []; },
    body: { classList: { toggle(name, on) { if (on) bodyClasses.add(name); else bodyClasses.delete(name); }, contains: (n) => bodyClasses.has(n) } },
  };
  return { document, elements, bodyClasses };
}

const { document: _d } = makeDom();
const runtime = loadClassic([
  'js/vis-utils.js', 'js/settings.js', 'js/mfs-const.js',
  'js/renderers/bars.js', 'js/renderers/lines.js', 'js/renderers/dots.js', 'js/renderers/radial.js',
  'js/renderer-registry.js', 'js/director-scenes.js', 'js/director-timeline.js',
  'js/world/score.js', 'js/world/world-bridge.js', 'js/ui-controller.js',
], { document: _d, window: { devicePixelRatio: 1 }, WorldExporter: class {}, WorldEngine: class {} });
const get = runtime.get;
const registry = get('RENDERER_REGISTRY');
const GPU_IDS = ['g-fluid', 'g-gargantua', 'g-attractor'];

test('UI-01 レジストリ: GPU 3 項目・グループ GPU が最後・capabilities は gpu のみ・create なし', () => {
  const order = get('RENDERER_GROUP_ORDER');
  assert.equal(order.at(-1), 'GPU');
  const gpuKeys = Object.keys(registry).filter((key) => registry[key].gpu);
  assert.deepEqual(gpuKeys, GPU_IDS);
  for (const id of GPU_IDS) {
    assert.equal(registry[id].group, 'GPU');
    assert.deepEqual(registry[id].capabilities, { gpu: true });
    assert.equal(registry[id].create, undefined);
    assert.equal(get('getRendererEntry')(id).gpu, true);
  }
  // 2D の 8 タイプは gpu を持たない
  assert.equal(Object.keys(registry).filter((key) => !registry[key].gpu).length, 8);
});

test('UI-02 ランダム選択の母集団・ディレクターのシーンから GPU 項目が除外される', () => {
  const twoD = get('listRenderer2DKeys')();
  assert.equal(twoD.length, 8);
  for (const id of GPU_IDS) assert.ok(!twoD.includes(id));
  // 内蔵シーンに GPU タイプは無い
  for (const scene of get('DIRECTOR_SCENES')) assert.ok(!registry[scene.patch.analyzerType].gpu);
  // マイプリセットに GPU タイプがあっても演出候補に入らない
  const presets = GPU_IDS.map((id, i) => ({ name: `gpu${i}`, settings: { ...get('createDefaultSettings')(), analyzerType: id } }));
  for (const cls of ['calm', 'build', 'drop']) {
    const scenes = get('directorSceneCandidates')(cls, 'presets', presets);
    assert.ok(scenes.every((scene) => !scene.id.startsWith('preset:gpu')));
  }
  // GPU の設定が紛れ込んでも例外にならず、2D 用の変化は適用不可
  const settings = { ...get('createDefaultSettings')(), analyzerType: 'g-fluid' };
  assert.doesNotThrow(() => get('applyScenePatch')(settings, { expressionMethod: 'dot', layerCount: 3 }));
  assert.equal(get('directorVariationApplicable')(settings, 'method'), false);
  assert.equal(get('directorVariationApplicable')(settings, 'layers'), false);
});

test('UI-03 worldAugmentSongMap: 旧 WorldSongMapService の追加処理と同じ平均クロマを付与する', () => {
  const R = get('SONGMAP_ROW'), augment = get('worldAugmentSongMap');
  const hops = 37, rows = new Float32Array(hops * R.LENGTH);
  let seed = 12345;
  for (let i = 0; i < rows.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; rows[i] = seed / 4294967296; }
  // 旧実装（world-app.js の WorldSongMapService._collectRows / _run）をそのまま再現
  const old = new Float64Array(12);
  for (let h = 0; h < rows.length; h += R.LENGTH) for (let k = 0; k < 12; k++) old[k] += rows[h + R.CHROMA + k];
  const map = { bpm: 120, durationSec: 10 };
  const out = augment(map, rows);
  assert.equal(out, map);
  assert.deepEqual(map.worldChroma, Array.from(old));
  assert.equal(map.worldChroma.length, 12);
  // rows が無ければ何もしない
  const plain = { bpm: 90 };
  assert.equal(augment(plain, null), plain);
  assert.equal('worldChroma' in plain, false);
});

test('UI-04 worldBridgeInternalSize: 表示サイズ×dpr・長辺 1920 に収めアスペクト比を保つ', () => {
  const size = get('worldBridgeInternalSize');
  assert.deepEqual(size(1280, 720, 1), [1280, 720]);
  assert.deepEqual(size(1280, 720, 2), [1920, 1080]);
  assert.deepEqual(size(1920, 1080, 2), [1920, 1080]);
  assert.deepEqual(size(900, 900, 3), [1920, 1920].map(() => 1920));
  const [w, h] = size(1600, 900, 2);
  assert.equal(Math.max(w, h), 1920);
  assert.ok(Math.abs(w / h - 16 / 9) < 0.01);
});

// ── _applyCapabilities（GPU 項目の表示切替） ──
function makeUi({ bridge = null, mic = false } = {}) {
  const UI = get('UIController');
  const ui = Object.create(UI.prototype);
  ui.visualizer = { settings: { ...get('createDefaultSettings')(), layerCount: 3, expressionMethod: 'line' } };
  ui.micInput = { active: mic };
  ui.worldBridge = bridge;
  ui._last2DType = 'bar';
  ui._updateDirectorUI = () => { ui.directorUpdates = (ui.directorUpdates || 0) + 1; };
  ui._updateLayerSplitVisibility = () => {};
  return { ui };
}

// UIController は読込時に渡した document（_d）を参照するため、テストでも _d の要素を使う
function withDocument(fn) {
  return fn();
}

function stubBridge({ ok = true } = {}) {
  const calls = [];
  const bridge = {
    available: ok ? null : false, statusEl: null, calls,
    selectType(id) { calls.push(['selectType', id]); return ok; },
    setActive(on) { calls.push(['setActive', on]); },
    prepare() { calls.push(['prepare']); return Promise.resolve(null); },
    invalidate() { calls.push(['invalidate']); },
    _setText() {},
  };
  return bridge;
}

test('UI-05 _applyCapabilities: GPU タイプは body.gpu-type を付け、2D の設定値を変えず、2D へ戻すと外す', () => withDocument(() => {
  const bridge = stubBridge();
  const { ui } = makeUi({ bridge });
  ui.mediaManager = { slots: [], activeIndex: 0 };
  const s = ui.visualizer.settings;
  ui.visualizer.settings.analyzerType = 'g-gargantua';
  ui._applyCapabilities('g-gargantua');
  assert.equal(_d.body.classList.contains('gpu-type'), true);
  // 隠すだけで値は保持する（layerCount を 1 に戻す 2D の処理は走らない）
  assert.equal(s.layerCount, 3);
  assert.equal(s.expressionMethod, 'line');
  assert.deepEqual(bridge.calls.filter((c) => c[0] === 'selectType'), [['selectType', 'g-gargantua']]);
  assert.ok(bridge.calls.some((c) => c[0] === 'setActive' && c[1] === true));
  // 2D へ戻す
  ui.visualizer.settings.analyzerType = 'radial';
  ui._applyCapabilities('radial');
  assert.equal(_d.body.classList.contains('gpu-type'), false);
  assert.ok(bridge.calls.some((c) => c[0] === 'setActive' && c[1] === false));
  assert.equal(ui._last2DType, 'radial');
  assert.ok(ui.directorUpdates >= 2); // GPU 状態が変わるたびディレクター表示を更新
}));

test('UI-06 GPU を使えない環境・マイク入力中は直前の 2D タイプへ戻し、option を disabled にする', () => withDocument(() => {
  // WebGL 不可
  let { ui } = makeUi({ bridge: stubBridge({ ok: false }) });
  ui.visualizer.settings.analyzerType = 'g-fluid';
  ui._applyCapabilities('g-fluid');
  assert.equal(ui.visualizer.settings.analyzerType, 'bar');
  assert.equal(_d.body.classList.contains('gpu-type'), false);
  // マイク入力中
  ({ ui } = makeUi({ bridge: stubBridge(), mic: true }));
  ui._last2DType = 'ring3d';
  ui.visualizer.settings.analyzerType = 'g-attractor';
  ui._applyCapabilities('g-attractor');
  assert.equal(ui.visualizer.settings.analyzerType, 'ring3d');
  assert.equal(_d.body.classList.contains('gpu-type'), false);
}));

test('UI-07 _updateGpuOptions: マイク入力中は GPU の option だけ disabled で理由をツールチップに出す', () => withDocument(() => {
  const mk = (value) => ({ value, disabled: false, title: '', removeAttribute(n) { if (n === 'title') this.title = ''; } });
  const select = _d.getElementById('analyzer-type');
  select.options = ['bar', 'radial', ...GPU_IDS].map(mk);
  let { ui } = makeUi({ bridge: stubBridge(), mic: true });
  ui._updateGpuOptions();
  for (const opt of select.options) assert.equal(opt.disabled, GPU_IDS.includes(opt.value), opt.value);
  assert.match(select.options[2].title, /マイク入力/);
  ({ ui } = makeUi({ bridge: stubBridge(), mic: false }));
  ui._updateGpuOptions();
  for (const opt of select.options) assert.equal(opt.disabled, false);
  // WebGL 不可の理由
  const bridge = stubBridge(); bridge.available = false;
  ({ ui } = makeUi({ bridge }));
  ui._updateGpuOptions();
  assert.match(select.options[3].title, /GPU タイプを利用できません/);
  assert.equal(select.options[0].disabled, false);
}));

test('UI-08 WorldBridge.frame: 再生中は描画・時刻が戻ったら setScore で巻き戻し・停止中は描画しない・準備前は黒', () => {
  const Bridge = get('WorldBridge');
  const media = { currentTime: 1, paused: false };
  const log = [];
  const engine = {
    fadeElapsed: .5, clear() { log.push('clear'); }, setScore(s) { log.push(['setScore', s]); },
    render(t, f, dt) { log.push(['render', t, dt]); }, redrawTransition(dt) { log.push(['redraw', dt]); },
  };
  const bridge = new Bridge({ container: {}, gpuCanvas: { style: {} }, audioEngine: { getFeatures: () => 'F' },
    mediaManager: { mediaElement: media }, songMapService: {} });
  bridge.engine = engine;
  // 準備前は黒
  bridge.frame(0, 1 / 60);
  assert.deepEqual(log.splice(0), ['clear']);
  // 準備済み・再生中
  bridge.ready = true; bridge._cache = { score: 'SCORE' }; bridge._prevT = 0;
  bridge.frame(0, 1 / 60);
  assert.deepEqual(log.splice(0), [['render', 1, 1 / 60]]);
  // 逆シーク（ループ）は先に巻き戻す
  media.currentTime = .2;
  bridge.frame(0, 1 / 60);
  assert.deepEqual(log.splice(0), [['setScore', 'SCORE'], ['render', .2, 1 / 60]]);
  // 停止中で時刻も同じなら描画しない（最初の 1 回だけ再描画フラグで描く）
  media.paused = true; bridge._needsRedraw = false;
  bridge.frame(0, 1 / 60);
  assert.deepEqual(log.splice(0), []);
  // 停止中のクロスフェードは進める
  engine.fadeElapsed = .1;
  bridge.frame(0, 1 / 60);
  assert.deepEqual(log.splice(0), [['redraw', 1 / 60]]);
});
