// @page app
// 目的 — Phase 21 縦型 9:16: 表示・書き出し・GPU 書き出しサイズ・設定 — doc/20261120-plan-phase17-21-modulation-and-portrait.md §3

avzTest('P21-01', '9:16 ボタンで表示が縦長（高さ:幅 = 16:9）になり、他の比率へ戻せる', async () => {
  const { visualizer } = window.__app;
  const canvas = visualizer.canvas;
  const saved = visualizer.settings.aspectRatio;
  try {
    document.getElementById('btn-9-16').click();
    avzAssert.equal(visualizer.settings.aspectRatio, '9:16');
    avzAssert.ok(document.getElementById('btn-9-16').classList.contains('active'));
    avzAssert.ok(!document.getElementById('btn-16-9').classList.contains('active'));
    avzAssert.ok(canvas.height > canvas.width, `縦長 ${canvas.width}x${canvas.height}`);
    avzAssert.close(canvas.height / canvas.width, 16 / 9, 0.02);
    const area = canvas.parentElement;
    avzAssert.ok(canvas.width <= area.clientWidth && canvas.height <= area.clientHeight, '表示領域に収まる');
    document.getElementById('btn-16-9').click();
    avzAssert.ok(canvas.width > canvas.height, '16:9 に戻る');
  } finally {
    const id = { '16:9': 'btn-16-9', '1:1': 'btn-1-1', '9:16': 'btn-9-16' }[saved] || 'btn-16-9';
    document.getElementById(id).click();
  }
});

avzTest('P21-02', '書き出しサイズ: 2D は 1080×1920、GPU は [1080, 1920]、設定の往復で 9:16 が保持される', async () => {
  avzAssert.deepEqual(OFFLINE_EXPORT_RESOLUTIONS['9:16'], { width: 1080, height: 1920 });
  avzAssert.deepEqual(WORLD_BRIDGE_EXPORT_SIZE['9:16'], [1080, 1920]);
  const s = Object.assign(createDefaultSettings(), { aspectRatio: '9:16' });
  avzAssert.equal(deserializeSettings(serializeSettings(s)).aspectRatio, '9:16');
  window.__app.visualizer.settings.aspectRatio = '9:16';
  window.__app.ui._syncControlsFromSettings();
  avzAssert.ok(document.getElementById('btn-9-16').classList.contains('active'), 'プリセット読込でボタン表示が揃う');
  document.getElementById('btn-16-9').click();
});

avzTest('P21-03', '9:16 でオフライン書き出しすると 1080×1920 の動画になる', async () => {
  const file = new File([encodeWav16(sigDrumPattern(48000, 2, 120))], 'p21.wav', { type: 'audio/wav' });
  const settings = Object.assign(createDefaultSettings(), { aspectRatio: '9:16', analyzerType: 'bar' });
  const exporter = new OfflineExporter();
  const blob = await exporter.export(file, settings, { fps: 30 });
  avzAssert.equal(exporter.state, 'done');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let parsed;
  try { parsed = Mp4Demuxer.parse(bytes); } catch (_) { parsed = WebmDemuxer.parse(bytes); }
  avzAssert.equal(parsed.codedWidth, 1080);
  avzAssert.equal(parsed.codedHeight, 1920);
  avzAssert.close(parsed.chunks.length, 61, 1);
}, { slow: true, timeoutMs: 300000 });
