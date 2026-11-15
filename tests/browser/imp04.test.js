// @page app
// 目的 — IMP-04: 効かない設定を隠し、対応しないタイプでも保存値を保持する — doc/20261115-improvement-spec-adoption-review.md §2.5・§3.1（決定4）

function imp04Pick(type) {
  const select = document.getElementById('analyzer-type');
  select.value = type;
  select.dispatchEvent(new Event('change'));
}
function imp04Row(id) {
  return document.getElementById(id).closest('label');
}
function imp04Visible(el) {
  return el.style.display !== 'none';
}
function imp04Save() {
  const s = window.__app.visualizer.settings;
  return { type: s.analyzerType, method: s.expressionMethod, layers: s.layerCount, video: s.videoCompositeEnabled };
}
function imp04Restore(saved) {
  const s = window.__app.visualizer.settings;
  s.expressionMethod = saved.method; s.layerCount = saved.layers; s.videoCompositeEnabled = saved.video;
  document.getElementById('expression-method').value = saved.method;
  imp04Pick(saved.type);
}

avzTest('IMP04-01', '粘性揺らぎは表現方法が波形線・点のときだけ表示し、棒では隠す', async () => {
  const saved = imp04Save();
  const expr = document.getElementById('expression-method');
  const group = document.getElementById('group-physics');
  try {
    for (const type of ['bar', 'radial']) {
      imp04Pick(type);
      for (const [method, visible] of [['bar', false], ['line', true], ['dot', true]]) {
        expr.value = method; expr.dispatchEvent(new Event('change'));
        avzAssert.equal(imp04Visible(group), visible, `${type}・${method}`);
      }
    }
    imp04Pick('terrain');
    avzAssert.ok(!imp04Visible(group), '3D地形では隠す');
  } finally { imp04Restore(saved); }
});

avzTest('IMP04-02', 'タイプが使わないスライダーを隠し、使うタイプでは表示する', async () => {
  const saved = imp04Save();
  const ids = { barWidth: 'slider-bar-width', density: 'slider-density', baseOffset: 'slider-base-offset',
    afterimageIntensity: 'slider-afterimage', smoothing: 'slider-smoothing', autoGain: 'chk-auto-gain' };
  const hidden = {
    bar: [], radial: [], terrain: [],
    spectrogram: ['barWidth', 'density', 'baseOffset', 'afterimageIntensity'],
    tunnel: ['baseOffset'],
    lissajous: ['smoothing', 'autoGain'],
  };
  try {
    for (const [type, keys] of Object.entries(hidden)) {
      imp04Pick(type);
      for (const [key, id] of Object.entries(ids)) {
        avzAssert.equal(imp04Visible(imp04Row(id)), keys.indexOf(key) === -1, `${type}・${key}`);
      }
    }
  } finally { imp04Restore(saved); }
});

avzTest('IMP04-03', '対応しないタイプへ切り替えても表現方法・レイヤー数の保存値を保持し、戻すと元どおり', async () => {
  const saved = imp04Save();
  const s = window.__app.visualizer.settings;
  const expr = document.getElementById('expression-method');
  try {
    imp04Pick('bar');
    expr.value = 'bar'; expr.dispatchEvent(new Event('change'));
    document.getElementById('btn-layer-3').click();
    avzAssert.equal(s.layerCount, 3);

    imp04Pick('lissajous');
    avzAssert.equal(s.expressionMethod, 'bar', '保存値は bar のまま');
    avzAssert.equal(s.layerCount, 3, '保存値は 3 のまま');
    avzAssert.equal(expr.value, 'line', '表示は有効な値（波形線）');

    imp04Pick('spectrogram');
    avzAssert.equal(s.expressionMethod, 'bar');
    avzAssert.equal(s.layerCount, 3);

    imp04Pick('bar');
    avzAssert.equal(expr.value, 'bar', '棒グラフへ戻すと棒');
    avzAssert.ok(document.getElementById('btn-layer-3').classList.contains('active') || s.layerCount === 3, 'レイヤー数 3 が残る');
  } finally { imp04Restore(saved); }
});

avzTest('IMP04-04', '描画時の読み替え: 保存値が棒のオシロスコープは波形線と同じ画素で描く', async () => {
  const render = (method) => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d');
    const p = new FramePipeline(canvas, ctx);
    const settings = Object.assign(createDefaultSettings(), { analyzerType: 'lissajous', expressionMethod: method, layerCount: 3 });
    const freq = new Uint8Array(638), time = new Uint8Array(2048);
    const input = { freq, time, getLayer: null, dtMs: 16.7, nowMs: 0, historyFps: 60, drawBackground: null };
    p.fillBackground(settings);
    for (let i = 0; i < 10; i++) { synthFrame(i, 638, 2048, freq, time); input.nowMs = i * 16.7; p.render(input, settings); }
    return ctx.getImageData(0, 0, 160, 90).data;
  };
  const a = render('bar'), b = render('line');
  let same = a.length === b.length;
  for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
  avzAssert.ok(same, '棒（非対応）は先頭の対応方法＝波形線として描かれる');
  avzAssert.equal(effectiveExpressionMethod('lissajous', 'bar'), 'line');
  avzAssert.equal(effectiveLayerCount('lissajous', 3), 1);
  avzAssert.equal(effectiveLayerCount('bar', 3), 3);
});

avzTest('IMP04-05', '動画合成は対象の動画が無くても設定値を保持し、スペクトログラムでは隠す', async () => {
  const saved = imp04Save();
  const { ui, visualizer } = window.__app;
  const section = document.getElementById('video-composite-controls');
  const savedEl = visualizer.videoElement, savedOffline = ui._offlineFileIsVideo;
  try {
    visualizer.settings.videoCompositeEnabled = true;
    ui._offlineFileIsVideo = false;
    ui._setVideoElement(null);
    avzAssert.equal(visualizer.settings.videoCompositeEnabled, true, '対象が無くても保存値は true のまま');
    avzAssert.ok(!imp04Visible(section), '対象が無ければ隠す');

    ui._offlineFileIsVideo = true;
    imp04Pick('bar');
    avzAssert.ok(imp04Visible(section), '対象があれば表示');
    imp04Pick('spectrogram');
    avzAssert.ok(!imp04Visible(section), 'スペクトログラムでは隠す');
  } finally {
    ui._offlineFileIsVideo = savedOffline;
    ui._setVideoElement(savedEl);
    imp04Restore(saved);
  }
});
