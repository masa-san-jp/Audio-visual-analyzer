// @page app
// 目的 — IMP-02 周波数軸の対数化をパイプライン・UI・設定で確認する — doc/20261115-plan-imp02-log-frequency-axis.md §8

function imp02Render(type, overrides, input48k, frames = 10, width = 160, height = 90) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const pipeline = new FramePipeline(canvas, ctx);
  const settings = Object.assign(createDefaultSettings(), { analyzerType: type }, overrides);
  const freq = new Uint8Array(638), time = new Uint8Array(2048);
  const input = { freq, time, getLayer: null, dtMs: 16.7, nowMs: 0, historyFps: 60, drawBackground: null };
  if (input48k) { input.sampleRate = 48000; input.fftSize = 2048; }
  pipeline.fillBackground(settings);
  for (let i = 0; i < frames; i++) {
    synthFrame(i, 638, 2048, freq, time);
    input.nowMs = i * 16.7;
    pipeline.render(input, settings);
  }
  return { pixels: ctx.getImageData(0, 0, width, height).data, pipeline };
}

function imp02SamePixels(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

avzTest('B-AX-01', '線形軸はサンプルレートの有無にかかわらず従来と同じ画素（回帰）', async () => {
  for (const type of ['bar', 'radial', 'terrain', 'tunnel']) {
    const base = imp02Render(type, { layerSplit: 'linear' }, false).pixels;
    const linear = imp02Render(type, { layerSplit: 'linear', freqAxis: 'linear' }, true).pixels;
    avzAssert.ok(imp02SamePixels(base, linear), `${type}: 線形軸の画素が従来と一致`);
  }
});

avzTest('B-AX-02', '全組合せ（棒グラフ・円形放射 × 表現方法 × レイヤー1〜4 × 表示モード × 軸）で例外なく描ける', async () => {
  let cases = 0;
  for (const freqAxis of ['log', 'linear']) {
    for (const method of ['bar', 'line', 'dot']) {
      for (let layerCount = 1; layerCount <= 4; layerCount++) {
        for (const barDisplayMode of ['normal', 'mirror-vertical', 'mirror-horizontal']) {
          imp02Render('bar', { freqAxis, expressionMethod: method, layerCount, barDisplayMode, physicsAmount: 3 }, true, 5);
          cases++;
        }
        imp02Render('radial', { freqAxis, expressionMethod: method, layerCount }, true, 5);
        cases++;
      }
    }
    for (const type of ['terrain', 'tunnel', 'spectrogram', 'lissajous']) { imp02Render(type, { freqAxis }, true, 5); cases++; }
  }
  avzAssert.equal(cases, 104);
});

avzTest('B-AX-03', 'スペクトログラムは周波数軸の設定で画素が変わらない（独自の軸を持つため対象外）', async () => {
  const log = imp02Render('spectrogram', { freqAxis: 'log' }, true, 20).pixels;
  const linear = imp02Render('spectrogram', { freqAxis: 'linear' }, true, 20).pixels;
  avzAssert.ok(imp02SamePixels(log, linear));
});

avzTest('B-AX-03b', '対数軸では 1kHz のピークが横幅の約 52.5% の位置に来る', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 90;
  const pipeline = new FramePipeline(canvas, canvas.getContext('2d'));
  const settings = Object.assign(createDefaultSettings(), { analyzerType: 'bar' });
  const freq = new Uint8Array(638);
  freq[Math.round(1000 / (48000 / 2048)) - 2] = 255;
  const input = { freq, time: null, getLayer: null, dtMs: 16.7, nowMs: 0, historyFps: 60, drawBackground: null, sampleRate: 48000, fftSize: 2048 };
  pipeline.render(input, settings);
  const mapped = pipeline._getLayer(0, 1);
  let argmax = 0;
  for (let j = 1; j < mapped.length; j++) if (mapped[j] > mapped[argmax]) argmax = j;
  avzAssert.close(argmax / mapped.length, Math.log(20) / Math.log(300), 0.01);
});

avzTest('B-AX-04', 'freqAxis・layerSplit=log の設定往復と、旧形式・不正値の既定値', async () => {
  const s = Object.assign(createDefaultSettings(), { freqAxis: 'linear', layerSplit: 'log' });
  const back = deserializeSettings(serializeSettings(s));
  avzAssert.equal(back.freqAxis, 'linear');
  avzAssert.equal(back.layerSplit, 'log');
  const legacy = serializeSettings(createDefaultSettings());
  delete legacy.settings.freqAxis;
  avzAssert.equal(deserializeSettings(legacy).freqAxis, 'log');
  avzAssert.equal(normalizeLayerSplit('xyz'), 'log');
  avzAssert.equal(normalizeLayerSplit('mel'), 'mel');
});

avzTest('B-AX-05', '周波数軸 UI: スペクトログラム・オシロスコープで隠れ、他で表示、切替が設定に反映される', async () => {
  const { visualizer } = window.__app;
  const typeSelect = document.getElementById('analyzer-type');
  const group = document.getElementById('group-freq-axis');
  const axisSelect = document.getElementById('freq-axis');
  const savedType = visualizer.settings.analyzerType, savedAxis = visualizer.settings.freqAxis;
  const pick = type => { typeSelect.value = type; typeSelect.dispatchEvent(new Event('change')); };
  try {
    for (const type of ['spectrogram', 'lissajous']) { pick(type); avzAssert.equal(group.style.display, 'none', `${type} では隠す`); }
    for (const type of ['bar', 'radial', 'terrain', 'tunnel']) { pick(type); avzAssert.equal(group.style.display, '', `${type} では表示`); }
    axisSelect.value = 'linear'; axisSelect.dispatchEvent(new Event('change'));
    avzAssert.equal(visualizer.settings.freqAxis, 'linear');
    axisSelect.value = 'log'; axisSelect.dispatchEvent(new Event('change'));
    avzAssert.equal(visualizer.settings.freqAxis, 'log');
  } finally {
    visualizer.settings.freqAxis = savedAxis; axisSelect.value = savedAxis;
    pick(savedType);
  }
});
