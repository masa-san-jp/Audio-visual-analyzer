// 目的 — 音声ファイルのオフライン書き出しと全アナライザータイプを回帰確認する（計画書 §7.2 B15-02〜B15-03）。
// @page app

function b15RegressionWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function b15RegressionWaitFor(predicate, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return true;
    await b15RegressionWait(25);
  }
  return predicate();
}

function b1502CreateWavFile() {
  const pcm = sigDrumPattern(48000, 3, 120);
  const bytes = encodeWav16(pcm);
  return new File([bytes], 'b15-02-drum-pattern.wav', { type: 'audio/wav' });
}

async function b1502ParseVideoBlob(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    return Mp4Demuxer.parse(bytes);
  } catch (_) {
    return WebmDemuxer.parse(bytes);
  }
}

avzTest('B15-02', 'B15-02 OfflineExporter の3秒WAV書き出しと映像フレーム数', async function () {
  const file = b1502CreateWavFile();
  const settings = createDefaultSettings();
  const exporter = window.__app.ui.offlineExporter;
  const blob = await exporter.export(file, settings, { fps: 30 });

  avzAssert.equal(exporter.state, 'done', 'OfflineExporter の完了状態');
  avzAssert.ok(blob && blob.size > 0, '書き出しBlobが空です');
  const parsed = await b1502ParseVideoBlob(blob);
  avzAssert.ok(parsed && Array.isArray(parsed.chunks), '映像をデマルチプレクサで読み戻せません');
  avzAssert.close(parsed.chunks.length, 90, 1, '映像フレーム数が3秒・30fpsと一致しません');
}, { slow: true, timeoutMs: 180000 });

avzTest('B15-03', 'B15-03 WAV再生中の全8アナライザータイプ切替', async function () {
  const pcm = sigDrumPattern(48000, 10, 120);
  const file = new File([encodeWav16(pcm)], 'b15-03-drum-pattern.wav', { type: 'audio/wav' });
  const app = window.__app;
  const mediaManager = app.mediaManager;
  const visualizer = app.visualizer;
  const typeSelect = document.getElementById('analyzer-type');
  // 2D の描画タイプだけを数える（GPU タイプは別グループ。GPU テストは avzGpuTest 側で確認する）
  const types = Array.from(typeSelect.options).map((option) => option.value).filter((v) => !getRendererEntry(v).gpu);

  try {
    await app.ui._loadMediaFile(file);
    avzAssert.ok(mediaManager.isLoaded, 'WAVがアプリのファイル読込経路で読み込まれていません');
    document.getElementById('btn-play').click();
    avzAssert.ok(
      await b15RegressionWaitFor(() => mediaManager.isPlaying, 2000),
      'WAVの再生状態になりませんでした',
    );

    avzAssert.equal(types.join(','), 'bar,radial,spectrogram,terrain,tunnel,bar3d,ring3d,lissajous', '残存8タイプの一覧');
    avzAssert.equal(types.length, 8, 'アナライザータイプ数');
    avzAssert.equal(document.getElementById('group-particles'), null, '要素量UIは削除済み');
    avzAssert.equal(document.getElementById('group-petals'), null, '花弁数UIは削除済み');
    avzAssert.equal(new Set(types).size, 8, 'アナライザータイプに重複があります');
    for (const type of types) {
      typeSelect.value = type;
      typeSelect.dispatchEvent(new Event('change'));
      await b15RegressionWait(500);
      avzAssert.equal(visualizer.settings.analyzerType, type, `${type} の設定反映`);
      avzAssert.equal(visualizer._activeType, type, `${type} の描画反映`);
    }
  } finally {
    mediaManager.stop();
    visualizer.stop();
  }
});
