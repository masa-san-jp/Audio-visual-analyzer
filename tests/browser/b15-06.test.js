// 目的 — `?debug=1` でデバッグ表示が存在し FPS が数値になることを確認する（計画書 §7.2 B15-06）。
// @page app
// @query debug=1

avzTest('B15-06', 'B15-06 ?debug=1 でデバッグ表示が存在し 1 秒後に FPS が数値', async function () {
  avzAssert.ok(location.search === '?debug=1', `クエリが想定と違います: ${location.search}`);
  const el = document.getElementById('debug-overlay');
  avzAssert.ok(el, 'debug-overlay 要素が存在しません');
  avzAssert.ok(window.__app.visualizer.debugOverlay, 'visualizer.debugOverlay がありません');
  avzAssert.ok(document.getElementById('visualizer-area').contains(el), 'キャンバス領域内にありません');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const match = /FPS:\s*([0-9.]+)/.exec(el.textContent);
  avzAssert.ok(match, `FPS が数値ではありません: ${el.textContent}`);
  avzAssert.ok(Number(match[1]) > 0, `FPS が正の数ではありません: ${match[1]}`);
  avzAssert.ok(/render avg\/p95\/max/.test(el.textContent), '描画時間の表示がありません');
  avzAssert.ok(/type:\s*\S+/.test(el.textContent) && !/type: -/.test(el.textContent), 'タイプ表示がありません');
});
