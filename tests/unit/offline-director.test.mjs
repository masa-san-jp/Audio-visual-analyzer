// 目的 — 書き出しの演出・拍時計・従来経路・中断を検証する — Phase 18 計画書 §4.4・§6.8。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';
const map = JSON.parse(fs.readFileSync(new URL('../fixtures/songmap-128.json', import.meta.url), 'utf8'));

function environment() {
  const normal = [], directed = [], renderers = [], encoded = [], pipelines = [];
  let hook = null;
  function record(input, settings, state) {
    const row = { input, features: input.features, nowMs: input.nowMs, settings,
      raw: input.features ? input.features.raw.slice() : null,
      scene: state && state.primary.sceneId, out: state };
    (state ? directed : normal).push(row);
    if (hook) hook(input, state);
  }
  class Pipeline {
    constructor() { pipelines.push(this); }
    render(input, settings) { record(input, settings, null); }
    dispose() { this.disposed = true; }
  }
  class Renderer {
    constructor() { renderers.push(this); this.resets = 0; }
    reset() { this.resets++; }
    render(input, state) { record(input, state.primary.settings, state); }
    dispose() { this.disposed = true; }
  }
  class Encoder {
    configure() {}
    encode(frame, options) { encoded.push({ ...frame.options, ...options }); }
    async flush() {}
    close() {}
  }
  class Frame {
    constructor(canvas, options) { this.options = options; }
    close() {}
  }
  class Muxer {
    finalize() { return new Blob(['mock-video'], { type: 'video/webm' }); }
  }
  const { get } = loadClassic([
    'js/vis-utils.js', 'js/settings.js', 'js/mfs-const.js', 'js/mfs-view.js',
    'js/renderers/bars.js', 'js/renderers/lines.js', 'js/renderers/dots.js', 'js/renderers/radial.js',
    'js/renderer-registry.js', 'js/songmap-analysis.js', 'js/director-scenes.js',
    'js/director-timeline.js', 'js/director-controller.js', 'js/offline-exporter.js',
  ], { FramePipeline: Pipeline, DirectorRenderer: Renderer, VideoEncoder: Encoder,
    VideoFrame: Frame, WebmMuxer: Muxer, document: { createElement: () => ({ getContext: () => ({}) }) } });
  const exporter = new (get('OfflineExporter'))();
  exporter._selectContainer = async () => ({ container: 'webm', videoCodec: 'vp8', audioCodec: 'opus' });
  exporter._yield = async () => {};
  const settings = get('createDefaultSettings')();
  const layout = get('MFS_LAYOUT');
  function analysis(n = 61, features = true, fps = 30) {
    const packed = new Float32Array(layout.LENGTH); packed[layout.BPM] = 99;
    return { freqFrames: Array.from({ length: n }, () => new Uint8Array([3, 7])),
      timeFrames: Array.from({ length: n }, () => new Uint8Array([128])),
      // 意図的に描画時計とずらし、拍・演出だけが i/fps を使うことを確認する。
      frameTimesMs: Array.from({ length: n }, (_, i) => i * 1000 / fps + 0.125),
      featureFrames: features ? Array.from({ length: n }, () => packed.slice()) : null,
      freqLen: 2, durationMs: (n - 1) * 1000 / fps, sampleRate: 48000, numberOfChannels: 2,
      audioBuffer: {} };
  }
  return { get, exporter, settings, analysis, normal, directed, renderers, encoded, pipelines,
    setHook(fn) { hook = fn; } };
}
const renderOpts = { fps: 30, width: 320, height: 180 };

test('T18-10 同じライブ引数でタイムライン一致・1000フレームの入力と状態を使い回す', async t => {
  let conditions = 0;
  for (const intensity of ['calm', 'standard', 'wild']) {
    for (const pool of ['builtin', 'presets']) {
      const env = environment(), { get, exporter, settings } = env;
      Object.assign(settings, { directorEnabled: true, directorIntensity: intensity,
        directorPool: pool, directorFlash: false, directorSeedOffset: 7 });
      const presets = ['bar', 'lissajous', 'tunnel'].map((type, i) => ({ name: 'preset-' + i,
        settings: { ...settings, analyzerType: type } }));
      const options = { intensity, pool, flash: false, seedOffset: 7 };
      const live = new (get('DirectorController'))({}, {});
      live.setOptions(options, presets); live.setSongMap(map); live.setEnabled(true);
      const original = get('DirectorController').prototype.render;
      let timeline;
      get('DirectorController').prototype.render = function (input, base, time) {
        timeline = this.timeline;
        assert.equal(time, env.directed.length / 30);
        original.call(this, input, base, time);
      };
      await exporter._renderAndEncode(env.analysis(1000), settings, { ...renderOpts, songMap: map, presets });
      assert.deepEqual(timeline, live.timeline);
      assert.equal(env.normal.length, 0);
      assert.equal(env.directed.length, 1000);
      const first = env.directed[0];
      for (const row of env.directed) {
        assert.equal(row.input, first.input); assert.equal(row.features, first.features);
        assert.equal(row.out, first.out); assert.equal(row.settings, first.settings);
      }
      assert.equal(env.renderers[1].disposed, true);
      assert.equal(env.renderers[1].resets, 3, '初期コンパイルのみ。連続フレームではシークしない');
      conditions++;
    }
  }
  t.diagnostic(`timelineConditions=${conditions} framesPerCondition=1000 referenceChanges=0`);
});

test('T18-10 ON/OFFともマップがあれば各フレームi/fpsの拍とフラグ・元packed非破壊', async t => {
  for (const enabled of [false, true]) {
    const env = environment(), { exporter, settings, get } = env;
    settings.directorEnabled = enabled;
    const a = env.analysis();
    const before = a.featureFrames.map(raw => raw.slice());
    await exporter._renderAndEncode(a, settings, { ...renderOpts, songMap: map });
    const expected = new (get('MfsFrameView'))();
    const rows = enabled ? env.directed : env.normal;
    for (let i = 0; i < rows.length; i++) {
      expected.setPacked(before[i]);
      get('songMapTempoAt')(map, i / 30, i ? (i - 1) / 30 : null, expected);
      assert.deepEqual(rows[i].raw, expected.raw);
      assert.deepEqual(a.featureFrames[i], before[i]);
      assert.equal(env.encoded[i].timestamp, Math.round(a.frameTimesMs[i] * 1000));
    }
    assert.equal(rows[0].raw[get('MFS_LAYOUT').BEAT_FLAG], 0);
    t.diagnostic(`enabled=${enabled} checkedFrames=${rows.length} packedChanges=0`);
  }
});

test('T18-10 マップなしのON/OFFは同じ通常描画・timestamp・keyframe、features=nullにも対応', async () => {
  const off = environment(), on = environment();
  on.settings.directorEnabled = true;
  for (const env of [off, on]) {
    const a = env.analysis();
    await env.exporter._renderAndEncode(a, env.settings, renderOpts);
    assert.equal(env.directed.length, 0); assert.equal(env.renderers.length, 0);
    for (let i = 0; i < env.normal.length; i++) assert.deepEqual(env.normal[i].raw, a.featureFrames[i]);
  }
  assert.deepEqual(on.encoded, off.encoded);
  assert.deepEqual(on.normal.map(r => r.raw), off.normal.map(r => r.raw));
  const env = environment(); env.settings.directorEnabled = true;
  await env.exporter._renderAndEncode(env.analysis(3, false), env.settings, { ...renderOpts, songMap: map });
  assert.equal(env.directed.length, 3);
  assert.ok(env.directed.every(r => r.features === null));
});

test('T18-10 request待ち・OFFはgetのみ・全SongMapErrorで演出なし・中止後は解析しない', async t => {
  const file = { name: 'song.wav' };
  for (const code of [null, 'no-rhythm', 'too-short', 'too-long', 'decode', 'cancelled', 'unavailable']) {
    const env = environment(); env.settings.directorEnabled = true;
    let release, requestFile, renderMap;
    const service = { request(f) { requestFile = f; return new Promise((resolve, reject) => {
      release = () => code ? reject({ code }) : resolve(map);
    }); } };
    let analyzes = 0;
    env.exporter._analyze = async () => { analyzes++; return env.analysis(); };
    env.exporter._renderAndEncode = async (a, s, o) => { renderMap = o.songMap; return new Blob(['video']); };
    const promise = env.exporter.export(file, env.settings, { songMapService: service });
    assert.equal(requestFile, file); assert.equal(analyzes, 0);
    release(); await promise;
    assert.equal(renderMap, code ? null : map); assert.equal(env.exporter.state, 'done');
  }
  const env = environment();
  let gets = 0;
  env.exporter._analyze = async () => env.analysis();
  env.exporter._renderAndEncode = async (a, s, o) => { assert.equal(o.songMap, map); return new Blob(); };
  await env.exporter.export(file, env.settings, { songMapService: {
    get(f) { assert.equal(f, file); gets++; return map; }, request() { assert.fail('OFFは新規解析しない'); },
  } });
  assert.equal(gets, 1);
  env.settings.directorEnabled = true;
  let release;
  env.exporter._analyze = async () => assert.fail('中止後の解析');
  const promise = env.exporter.export(file, env.settings, { songMapService: {
    request() { return new Promise(resolve => { release = resolve; }); }, cancel() { assert.fail('共有解析は中止しない'); },
  } });
  env.exporter.cancel(); release(map);
  assert.equal(await promise, null); assert.equal(env.exporter.state, 'idle');
  t.diagnostic('requestResults=7 cacheGets=1 cancelledAnalysisCalls=0');
});

test('T18-10 演出中の中止・描画失敗でも専用Controllerをdispose', async () => {
  for (const fail of [false, true]) {
    const env = environment(); env.settings.directorEnabled = true;
    env.exporter._analyze = async () => env.analysis();
    env.setHook(() => { if (fail) throw new Error('render failed'); env.exporter.cancel(); });
    const promise = env.exporter.export({}, env.settings, { songMapService: { request: async () => map } });
    if (fail) { await assert.rejects(promise, /render failed/); assert.equal(env.exporter.state, 'error'); }
    else { assert.equal(await promise, null); assert.equal(env.exporter.state, 'idle'); }
    assert.equal(env.directed.length, 1);
    assert.equal(env.renderers[0].disposed, true); assert.equal(env.pipelines[0].disposed, true);
  }
});

test('T18-10 25/29.97fpsでも拍・演出時計はi/fps、書き出しごとに前時刻を破棄', async t => {
  for (const fps of [25, 29.97]) {
    const env = environment(); env.settings.directorEnabled = true;
    const original = env.get('DirectorController').prototype.render;
    let frame = 0;
    env.get('DirectorController').prototype.render = function (input, base, time) {
      assert.equal(time, frame++ / fps); original.call(this, input, base, time);
    };
    for (let run = 0; run < 2; run++) {
      frame = 0;
      await env.exporter._renderAndEncode(env.analysis(61, true, fps), env.settings,
        { ...renderOpts, fps, songMap: map });
      assert.equal(frame, 61);
      assert.equal(env.directed[run * 61].raw[env.get('MFS_LAYOUT').BEAT_FLAG], 0);
    }
    assert.deepEqual(env.directed.slice(0, 61).map(r => r.raw), env.directed.slice(61).map(r => r.raw));
    t.diagnostic(`fps=${fps} repeatedExports=2 framesPerExport=61`);
  }
});

test('T18-10 元設定がselfClearでも演出シーンへ動画背景を渡す・OFFは従来どおり', async t => {
  for (const enabled of [false, true]) {
    const env = environment(), { exporter, settings } = env;
    Object.assign(settings, { analyzerType: 'spectrogram', directorEnabled: enabled, videoCompositeEnabled: true });
    let created = 0, fetched = 0, drawn = 0, disposed = 0;
    const source = { type: 'decoder', async frameAt() { fetched++; return {}; }, dispose() { disposed++; } };
    exporter._createDecoderCompositeSource = async () => { created++; return source; };
    exporter._drawCompositeVideoFrame = () => { drawn++; };
    env.setHook(input => { if (input.drawBackground) input.drawBackground({}, {}); });
    await exporter._renderAndEncode(env.analysis(3), settings,
      { ...renderOpts, songMap: map, file: { type: 'video/webm' } });
    assert.equal(created, enabled ? 1 : 0); assert.equal(fetched, enabled ? 3 : 0);
    assert.equal(drawn, enabled ? 3 : 0); assert.equal(disposed, enabled ? 1 : 0);
    t.diagnostic(`enabled=${enabled} compositeFrames=${fetched} disposedSources=${disposed}`);
  }
});
