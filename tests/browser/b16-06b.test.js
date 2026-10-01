// @page app
// 目的 — 動画合成つきオフライン書き出しが MFS 経路でも動くことを確認する（計画書 §9.2 B16-06 の補足、§6.3）。

// 既知の色（赤）を描いたキャンバス映像 + オシレーター音声の WebM を MediaRecorder で作る
async function b1606bMakeVideoFile(seconds) {
  const cv = document.createElement('canvas');
  cv.width = 320; cv.height = 180;
  const g = cv.getContext('2d');
  const vStream = cv.captureStream(30);
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ac.createOscillator();
  osc.frequency.value = 440;
  const dest = ac.createMediaStreamDestination();
  osc.connect(dest);
  osc.start();
  const stream = new MediaStream([...vStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
  const chunks = [];
  rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(function (r) { rec.onstop = r; });
  rec.start(100);
  const t0 = performance.now();
  while (performance.now() - t0 < seconds * 1000) {
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, cv.width, cv.height);
    await new Promise(function (r) { setTimeout(r, 33); });
  }
  rec.stop();
  await stopped;
  osc.stop();
  ac.close();
  return new File([new Blob(chunks, { type: 'video/webm' })], 'b16-06b-red.webm', { type: 'video/webm' });
}

async function b1606bRun(forceSeek) {
  const file = await b1606bMakeVideoFile(2);
  const settings = createDefaultSettings();
  settings.videoCompositeEnabled = true;
  settings.videoCompositeOpacity = 100;
  settings.videoCompositeBlendMode = 'source-over';
  const exporter = window.__app.ui.offlineExporter;

  const origDecoder = exporter._createDecoderCompositeSource;
  if (forceSeek) exporter._createDecoderCompositeSource = async function () { return null; };
  let analysis = null;
  const origRE = exporter._renderAndEncode;
  exporter._renderAndEncode = function (a, s, o) { analysis = a; return origRE.call(this, a, s, o); };
  let drawCalls = 0, redPixels = 0;
  const origDraw = exporter._drawCompositeVideoFrame;
  exporter._drawCompositeVideoFrame = function (ctx, canvas) {
    const r = origDraw.apply(this, arguments);
    drawCalls++;
    const px = ctx.getImageData(2, 2, 1, 1).data;
    if (px[0] > 200 && px[1] < 60 && px[2] < 60) redPixels++;
    return r;
  };
  const origRender = FramePipeline.prototype.render;
  let renderCalls = 0, featuresNonNull = 0;
  FramePipeline.prototype.render = function (input, s) {
    if (input.dtMs === 1000 / 30) { renderCalls++; if (input.features) featuresNonNull++; }
    return origRender.call(this, input, s);
  };
  let blob;
  try {
    blob = await exporter.export(file, settings, { fps: 30 });
  } finally {
    FramePipeline.prototype.render = origRender;
    exporter._drawCompositeVideoFrame = origDraw;
    exporter._renderAndEncode = origRE;
    exporter._createDecoderCompositeSource = origDecoder;
  }
  avzAssert.equal(exporter.state, 'done', 'OfflineExporter の完了状態');
  avzAssert.ok(blob && blob.size > 0, '書き出しBlobが空です');
  const expectedType = forceSeek ? 'seek' : exporter._lastCompositeSourceType;
  avzAssert.ok(exporter._lastCompositeSourceType, '動画合成ソースが作られていません');
  if (forceSeek) avzAssert.equal(exporter._lastCompositeSourceType, expectedType, '合成方式');
  const frames = analysis.freqFrames.length;
  avzAssert.close(frames, Math.floor(analysis.durationMs * 30 / 1000) + 1, 1, 'フレーム数が fps×長さ(±1)と一致しません');
  avzAssert.equal(analysis.featureFrames.length, frames, 'featureFrames の数');
  avzAssert.equal(renderCalls, frames, 'render 回数');
  avzAssert.equal(featuresNonNull, renderCalls, 'features が null の render がある');
  avzAssert.ok(drawCalls >= frames - 1, `動画合成の描画回数が不足: ${drawCalls}/${frames}`);
  avzAssert.ok(redPixels >= drawCalls * 0.8, `合成された映像に赤が含まれません: ${redPixels}/${drawCalls}`);
  return { frames, type: exporter._lastCompositeSourceType };
}

avzTest('B16-06b', 'B16-06b 動画合成つき書き出し（デコーダー方式優先）で features が渡り映像色が合成される', async function () {
  const r = await b1606bRun(false);
  avzAssert.equal(r.type, 'decoder', '合成方式（デコーダー方式が使われること）');
}, { slow: true, timeoutMs: 180000 });

avzTest('B16-06c', 'B16-06c 動画合成つき書き出し（シーク方式）で features が渡り映像色が合成される', async function () {
  const r = await b1606bRun(true);
  avzAssert.equal(r.type, 'seek', '合成方式');
}, { slow: true, timeoutMs: 180000 });
