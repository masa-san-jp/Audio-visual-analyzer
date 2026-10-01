// @page app
// 目的 — オフライン書き出しが MFS ワークレットの特徴を採取し FramePipeline へ渡すことを確認する（計画書 §9.2 B16-06、§6.3）。

avzTest('B16-06', 'B16-06 ドラム5秒の書き出しで featureFrames が freqFrames と同数、フレーム0は全0、render に features が渡る', async function () {
  const pcm = sigDrumPattern(48000, 5, 120);
  const file = new File([encodeWav16(pcm)], 'b16-06-drum-pattern.wav', { type: 'audio/wav' });
  const settings = createDefaultSettings();
  const exporter = window.__app.ui.offlineExporter;

  let analysis = null;
  const originalRenderAndEncode = exporter._renderAndEncode;
  exporter._renderAndEncode = function (a, s, o) { analysis = a; return originalRenderAndEncode.call(this, a, s, o); };
  const originalRender = FramePipeline.prototype.render;
  let renderCalls = 0;
  let featuresNonNull = 0;
  FramePipeline.prototype.render = function (input, s) {
    // アプリページではライブ描画ループも render を呼ぶため、書き出し側（固定 dt = 1000/30）だけを数える
    if (input.dtMs === 1000 / 30) {
      renderCalls++;
      if (input.features) featuresNonNull++;
    }
    return originalRender.call(this, input, s);
  };
  let blob;
  try {
    blob = await exporter.export(file, settings, { fps: 30 });
  } finally {
    FramePipeline.prototype.render = originalRender;
    exporter._renderAndEncode = originalRenderAndEncode;
  }

  avzAssert.equal(exporter.state, 'done', 'OfflineExporter の完了状態');
  avzAssert.ok(blob && blob.size > 0, '書き出しBlobが空です');
  avzAssert.ok(analysis && analysis.featureFrames, 'featureFrames が採取されていません（MFS 経路が使われていません）');
  avzAssert.equal(analysis.freqFrames.length, 151, 'freqFrames の数');
  avzAssert.equal(analysis.featureFrames.length, analysis.freqFrames.length, 'featureFrames の数');
  avzAssert.equal(analysis.timeFrames.length, 151, 'timeFrames の数');
  avzAssert.equal(analysis.frameTimesMs.length, 151, 'frameTimesMs の数');
  const f0 = analysis.featureFrames[0];
  let nonZero = 0;
  for (let k = 0; k < f0.length; k++) if (f0[k] !== 0) nonZero++;
  avzAssert.equal(nonZero, 0, 'フレーム0の packed が全 0 ではありません');
  let late = 0;
  const last = analysis.featureFrames[150];
  for (let k = 0; k < last.length; k++) if (last[k] !== 0) late++;
  avzAssert.ok(late > 0, '最終フレームの packed が全 0 です');
  avzAssert.equal(renderCalls, 151, 'FramePipeline.render の呼び出し回数');
  avzAssert.equal(featuresNonNull, renderCalls, 'features が null の render 呼び出しがあります');
}, { slow: true, timeoutMs: 180000 });
