// @page harness
// 目的 — OfflineExporter が描画を FramePipeline.render に一本化していることを確認する（計画書 §7.2 B15-05）。

avzTest('B15-05', 'B15-05 書き出し中に FramePipeline.render が総フレーム数と同じ回数呼ばれる', async function () {
  const fps = 30;
  const seconds = 2;
  const pcm = sigDrumPattern(48000, seconds, 120);
  const file = new File([encodeWav16(pcm)], 'b15-05-drum-pattern.wav', { type: 'audio/wav' });
  const settings = createDefaultSettings();

  // 複製ロジックが残っていないこと（旧メソッドの不在）
  for (const name of ['_renderStateless', '_applyPhysics', '_clearFrame', '_sliceLayer']) {
    avzAssert.equal(typeof OfflineExporter.prototype[name], 'undefined', `OfflineExporter.${name} が残っています`);
  }

  const originalRender = FramePipeline.prototype.render;
  let renderCalls = 0;
  FramePipeline.prototype.render = function (input, s) {
    renderCalls++;
    return originalRender.call(this, input, s);
  };
  let blob;
  const exporter = new OfflineExporter();
  try {
    blob = await exporter.export(file, settings, { fps });
  } finally {
    FramePipeline.prototype.render = originalRender;
  }

  avzAssert.equal(exporter.state, 'done', 'OfflineExporter の完了状態');
  avzAssert.ok(blob && blob.size > 0, '書き出しBlobが空です');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let parsed;
  try { parsed = Mp4Demuxer.parse(bytes); } catch (_) { parsed = WebmDemuxer.parse(bytes); }
  const totalFrames = parsed.chunks.length;
  avzAssert.ok(totalFrames > 0, '映像フレームを読み戻せません');
  avzAssert.close(totalFrames, fps * seconds, 1, '映像フレーム数が想定と一致しません');
  avzAssert.equal(renderCalls, totalFrames, 'FramePipeline.render の呼び出し回数が総フレーム数と一致しません');
}, { slow: true, timeoutMs: 180000 });
