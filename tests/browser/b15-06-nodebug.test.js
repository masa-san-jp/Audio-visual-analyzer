// 目的 — `?debug` なしではデバッグ表示の要素が存在しないことを確認する（計画書 §7.2 B15-06）。
// @page app

avzTest('B15-06b', 'B15-06 ?debug なしではデバッグ表示の要素が存在しない', async function () {
  avzAssert.ok(location.search === '', `クエリが想定と違います: ${location.search}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  avzAssert.equal(document.getElementById('debug-overlay'), null, 'debug-overlay 要素が存在します');
  avzAssert.equal(window.__app.visualizer.debugOverlay, null, 'debugOverlay が生成されています');
  avzAssert.equal(document.getElementById('visualizer-area').style.position, '', 'コンテナのスタイルが変更されています');
});
