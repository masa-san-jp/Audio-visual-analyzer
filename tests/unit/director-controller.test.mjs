// 目的 — ライブ統合の状態優先順位・シーク・非同期配線を確認する — Phase 18 計画書 §4.4・§6.8・§7。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';
const map = JSON.parse(fs.readFileSync(new URL('../fixtures/songmap-128.json', import.meta.url), 'utf8'));

function environment() {
  class Renderer {
    constructor() { this.resets = 0; this.frames = 0; this.resizes = 0; }
    reset() { this.resets++; }
    render(input, state) { this.frames++; this.input = input; this.state = state; }
    resize() { this.resizes++; }
    dispose() { this.disposed = true; }
  }
  class Pipeline {
    constructor() { this.frames = 0; }
    render(input, settings) { this.frames++; this.input = input; this.settings = settings; }
    resize() {}
    fillBackground() {}
  }
  class Service {
    constructor() { this.jobs = new Map(); this.cache = new Map(); }
    keyOf(file) { return file.name; }
    get(file) { return this.cache.get(file.name) || null; }
    request(file) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      this.jobs.set(file.name, { resolve, reject });
      return promise;
    }
    cancel(file) { this.jobs.get(file.name)?.reject({ code: 'cancelled' }); }
  }
  const { get } = loadClassic([
    'js/vis-utils.js', 'js/settings.js', 'js/settings-io.js', 'js/mfs-const.js', 'js/mfs-view.js',
    'js/renderers/bars.js', 'js/renderers/lines.js', 'js/renderers/dots.js', 'js/renderers/radial.js',
    'js/renderer-registry.js', 'js/songmap-analysis.js', 'js/director-scenes.js',
    'js/director-timeline.js', 'js/director-controller.js', 'js/visualizer-core.js', 'js/ui-controller.js',
  ], { DirectorRenderer: Renderer, FramePipeline: Pipeline, SongMapService: Service,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  const canvas = { getContext: () => ({}), parentElement: { clientWidth: 320, clientHeight: 180 } };
  const director = new (get('DirectorController'))(canvas, canvas.getContext());
  return { get, canvas, director };
}

test('T18-09 状態の7段階優先順位・詳細・既定OFF・復帰', () => {
  const { director } = environment();
  const detail = director.statusDetail;
  director.setAnalysisState('analyzing', { progress: 0.42 });
  assert.equal(director.status, 'off');
  director.setEnabled(true);
  assert.equal(director.status, 'analyzing');
  assert.equal(detail.progress, 0.42);
  director.setSongMap(map);
  assert.equal(director.status, 'ready');
  director.setAnalysisState('analyzing');
  assert.equal(director.status, 'ready');
  for (const [state, status, reason, code] of [
    ['mic', 'unavailable', 'mic', null], ['unavailable', 'unavailable', 'worklet', null],
    ['error', 'error', null, 'decode'],
  ]) {
    director.setAnalysisState(state, { code });
    assert.equal(director.status, status);
    assert.equal(detail.reason, reason);
    assert.equal(detail.code, code);
    director.setEnabled(false);
    assert.equal(director.status, 'off');
    director.setEnabled(true);
  }
  director.setSongMap(null);
  assert.equal(director.status, 'off');
  assert.equal(director.isReady(), false);
  assert.equal(director.statusDetail, detail);
});

test('T18-09 再コンパイル契機とユーザー色の即時反映', () => {
  const { director, get } = environment();
  const options = { intensity: 'standard', pool: 'builtin', flash: true, seedOffset: 0 };
  director.setOptions(options, []);
  director.setSongMap(map);
  let previous = director.timeline;
  director.setEnabled(true);
  assert.notEqual(director.timeline, previous);
  for (const [key, value] of [['intensity', 'wild'], ['pool', 'presets'], ['flash', false], ['seedOffset', 1]]) {
    previous = director.timeline;
    options[key] = value;
    director.setOptions(options, []);
    assert.notEqual(director.timeline, previous);
  }
  const settings = get('createDefaultSettings')();
  director.setOptions(options, [{ name: 'A', settings }]);
  assert.ok(director.timeline.segments.some(s => s.sceneId === 'preset:A'));
  director.setOptions(options, []);
  assert.ok(director.timeline.segments.every(s => s.sceneId.startsWith('builtin:')));
  previous = director.timeline;
  settings.hue = 10;
  director.render({}, settings, 0);
  settings.hue = 120;
  director.render({}, settings, 0);
  assert.equal(director.state.primary.settings.hue, 120);
  assert.equal(director.timeline, previous);
});

test('T18-09 シーク境界 (>1秒・逆行) と1000フレームの参照維持・resize/dispose', () => {
  const { director, get } = environment();
  director.setSongMap(map);
  const settings = get('createDefaultSettings')();
  const input = {};
  const state = director.state, primary = state.primary.settings, secondary = state._secondary.settings;
  const renderer = director.renderer;
  const resets = renderer.resets;
  for (const time of [1, 2, 2, 3.001, 3]) director.render(input, settings, time);
  assert.equal(renderer.resets - resets, 2);
  const drop = director.timeline.segments.find(s => s.kind === 'drop');
  director.render(input, settings, (drop.startSec + drop.endSec) / 2);
  assert.equal(state.primary.sceneId, drop.sceneId);
  for (let i = 0; i < 1000; i++) {
    director.render(input, settings, drop.startSec + i / 60);
    assert.equal(director.state, state);
    assert.equal(state.primary.settings, primary);
    assert.equal(state._secondary.settings, secondary);
    assert.equal(renderer.input, input);
  }
  director.resize(); director.dispose();
  assert.equal(renderer.resizes, 1);
  assert.equal(renderer.disposed, true);
});

test('T18-09 ライブ毎フレームのtempo更新（OFF含む）とmedia切替・null features・描画分岐', () => {
  const { get, canvas } = environment();
  const view = new (get('MfsFrameView'))();
  const engine = { captureFrame() {}, getFreqSlice: () => null, getTimeDomainData: () => null,
    getFeatures: () => view, ctx: { sampleRate: 48000 } };
  const visualizer = new (get('VisualizerCore'))(canvas, engine);
  assert.equal(visualizer.settings.directorEnabled, false);
  visualizer.director.setSongMap(map);
  visualizer.mediaElement = { currentTime: map.beats[1] - 0.01 };
  visualizer.running = true;
  visualizer._loop();
  visualizer.mediaElement.currentTime = map.beats[1] + 0.01;
  visualizer._loop();
  assert.equal(view.tempo.beatFlag, true);
  assert.ok(Math.abs(view.tempo.bpm - map.bpm) < 1e-4);
  assert.equal(visualizer.pipeline.frames, 2);
  visualizer.mediaElement = { currentTime: map.beats[2] + 0.01 };
  visualizer._loop();
  assert.equal(view.tempo.beatFlag, false);
  visualizer.settings.directorEnabled = true;
  visualizer._loop();
  assert.equal(visualizer.director.renderer.frames, 1);
  engine.getFeatures = () => null;
  visualizer._loop();
  assert.equal(visualizer.director.renderer.frames, 2);
  visualizer.mediaElement = null;
  visualizer._loop();
  assert.equal(visualizer.pipeline.frames, 4);
});

function uiEnvironment() {
  const env = environment();
  const { get, director } = env;
  const a = { name: 'a' }, b = { name: 'b' };
  const mm = { slots: [{ file: a }, { file: b }], activeIndex: 0 };
  const mic = { active: false };
  const ui = new (get('UIController'))({ director }, mm, {}, null, mic);
  ui._updateDirectorUI = () => {};
  director.setEnabled(true);
  return { ...env, ui, mm, mic, a, b, service: ui.songMapService };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('T18-09 進捗・完了はアクティブキーだけへ反映し、スロット切替とmic終了で復帰', async () => {
  const { ui, mm, mic, a, b, service, director } = uiEnvironment();
  ui._requestSongMap(a); ui._requestSongMap(b);
  service.onProgress('a', 0.42); service.onProgress('b', 0.8);
  assert.equal(director.statusDetail.progress, 0.42);
  mm.activeIndex = 1; ui._restoreDirectorAnalysis();
  assert.equal(director.statusDetail.progress, 0.8);
  service.jobs.get('a').resolve(map); await settle();
  assert.equal(director.songMap, null);
  mic.active = true; ui._restoreDirectorAnalysis();
  service.cache.set('b', map); service.jobs.get('b').resolve(map); await settle();
  assert.equal(director.statusDetail.reason, 'mic');
  mic.active = false; ui._restoreDirectorAnalysis();
  assert.equal(director.status, 'ready');
  mm.slots[1] = null; ui._restoreDirectorAnalysis();
  assert.equal(director.status, 'off');
});

test('T18-09 unavailable・エラー・cancelled・遅い旧結果の配線', async () => {
  const { ui, a, service, director } = uiEnvironment();
  for (const code of ['unavailable', 'no-rhythm', 'too-short', 'too-long', 'decode']) {
    ui._requestSongMap(a); service.jobs.get('a').reject({ code }); await settle();
    assert.equal(director.status, code === 'unavailable' ? 'unavailable' : 'error');
    assert.equal(director.statusDetail.code, code === 'unavailable' ? null : code);
  }
  ui._requestSongMap(a);
  ui._cancelSongMap(a); ui._restoreDirectorAnalysis(); await settle();
  assert.equal(director.status, 'off');
  ui._requestSongMap(a);
  const old = service.jobs.get('a');
  ui._requestSongMap(a);
  old.resolve(map); await settle();
  assert.equal(director.songMap, null);
  service.jobs.get('a').resolve(map); await settle();
  assert.equal(director.status, 'ready');
});

test('T18-09 5設定のJSON保存・旧JSON補完', () => {
  const { get } = environment();
  const base = get('createDefaultSettings')();
  assert.deepEqual(get('deserializeSettings')({ settings: {} }), base);
  Object.assign(base, { directorEnabled: true, directorIntensity: 'wild', directorPool: 'presets',
    directorFlash: false, directorSeedOffset: 7 });
  assert.deepEqual(get('deserializeSettings')(get('serializeSettings')(base)), base);
});
