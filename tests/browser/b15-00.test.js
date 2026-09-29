// 目的 — ブラウザテストの成功・失敗・console.error 検出を検証する（計画書 §7.2 B15-00）。
// @page harness

avzTest('B15-00', 'ブラウザー正常系の値を取得できる', async function () {
  avzAssert.equal(2 + 2, 4, '正常系の値');
});

avzTest('B15-00', 'ブラウザー例外を失敗として検知できる', async function () {
  avzAssert.equal('actual', 'expected', '意図的なブラウザテスト失敗');
}, { expectedFailure: true });

avzTest('B15-00', 'コンソールエラーを失敗として検知できる', async function () {
  console.error('意図的な console.error');
}, { expectedFailure: true });
