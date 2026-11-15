// @page app
// 目的 — IMP-01: GPU タイプで表示を自動で変えたとき・録画できないときに理由を示す — doc/20261115-improvement-spec-adoption-review.md §2.2・§3.1
// GPU の無い環境でも検証できるよう、WorldBridge の準備状態（ready / error）を直接設定して UI の判定だけを確かめる。

function imp01WithLoaded(fn) {
  const mm = window.__app.mediaManager;
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(mm), 'isLoaded');
  Object.defineProperty(mm, 'isLoaded', { configurable: true, get: () => true });
  try { return fn(); } finally { delete mm.isLoaded; if (!desc) avzAssert.ok(false, 'isLoaded getter が見つかりません'); }
}

avzTest('IMP01-01', '書き出し FPS に 60fps の選択肢がある', async () => {
  const values = Array.from(document.getElementById('offline-fps').options).map(o => o.value);
  avzAssert.deepEqual(values, ['25', '29.97', '30', '60']);
});

avzTest('IMP01-02', 'GPU タイプで解析前は録画開始を無効にして理由を表示し、準備後に有効へ戻る', async () => {
  const { ui, worldBridge: bridge, visualizer } = window.__app;
  const settings = visualizer.settings;
  const saved = { type: settings.analyzerType, ready: bridge.ready, error: bridge.error };
  const btn = document.getElementById('btn-rec-start');
  const status = document.getElementById('rec-status');
  try {
    imp01WithLoaded(() => {
      settings.analyzerType = 'g-gargantua';
      bridge.ready = false; bridge.error = null;
      ui._updateRecButtons();
      avzAssert.ok(btn.disabled, '解析前は録画開始が無効');
      avzAssert.equal(status.textContent, UI_REC_GPU_WAIT);

      bridge.error = 'x';
      ui._updateRecButtons();
      avzAssert.ok(btn.disabled, '解析失敗時も無効');
      avzAssert.equal(status.textContent, UI_REC_GPU_FAILED);

      bridge.error = null; bridge.ready = true;
      ui._updateRecButtons();
      avzAssert.ok(!btn.disabled, '準備後は録画開始が有効');
      avzAssert.equal(status.textContent, '待機中');

      settings.analyzerType = 'bar'; bridge.ready = false;
      ui._updateRecButtons();
      avzAssert.ok(!btn.disabled, '2D タイプは GPU の準備状態に関係なく録画できる');
    });
  } finally {
    settings.analyzerType = saved.type; bridge.ready = saved.ready; bridge.error = saved.error;
    ui._updateRecButtons();
  }
});

avzTest('IMP01-03', 'WorldBridge の状態変化で録画ボタンが更新される', async () => {
  const { ui, worldBridge: bridge } = window.__app;
  avzAssert.equal(typeof bridge.onStateChange, 'function');
  let calls = 0;
  const original = ui._updateRecButtons;
  ui._updateRecButtons = function () { calls++; return original.apply(this, arguments); };
  try {
    bridge._refreshText();
  } finally {
    ui._updateRecButtons = original;
  }
  avzAssert.ok(calls >= 1, '状態変化の通知で _updateRecButtons が呼ばれる');
});

avzTest('IMP01-04', 'マイク入力で GPU タイプから 2D へ戻したとき、理由をタイプ選択の下に表示し、手動で選び直すと消える', async () => {
  const { ui, visualizer } = window.__app;
  const select = document.getElementById('analyzer-type');
  const notice = document.getElementById('analyzer-notice');
  const savedType = visualizer.settings.analyzerType, saved2D = ui._last2DType;
  try {
    visualizer.settings.analyzerType = 'g-gargantua';
    ui._last2DType = 'radial';
    ui._leaveGpuForMic();
    avzAssert.equal(visualizer.settings.analyzerType, 'radial');
    avzAssert.equal(select.value, 'radial');
    avzAssert.ok(!notice.hidden, '理由が表示される');
    avzAssert.ok(notice.textContent.includes('マイク入力中') && notice.textContent.includes('円形放射'), notice.textContent);

    select.value = 'bar';
    select.dispatchEvent(new Event('change'));
    avzAssert.ok(notice.hidden, '手動で選び直すと消える');
    avzAssert.equal(notice.textContent, '');
  } finally {
    ui._last2DType = saved2D;
    select.value = savedType;
    select.dispatchEvent(new Event('change'));
  }
});

avzTest('IMP01-05', '2D タイプへ戻すだけのとき（理由なし）は注記を出さない', async () => {
  const { ui } = window.__app;
  const notice = document.getElementById('analyzer-notice');
  ui._setAnalyzerNotice('');
  ui._revertTo2D();
  avzAssert.ok(notice.hidden);
});
