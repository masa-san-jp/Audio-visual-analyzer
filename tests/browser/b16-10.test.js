// 目的 — `?debug=1` で MFS 行・BPM 行・LUFS 行が表示され、再生 10 秒後に BPM 行が数値になることを確認する（計画書 §9.2 B16-10、§7）。
// @page app
// @query debug=1

function b1610Wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

avzTest('B16-10', 'B16-10 ?debug=1 で再生すると MFS・BPM・LUFS 行が表示され、10秒後に BPM が数値', async function () {
  const app = window.__app;
  const mediaManager = app.mediaManager;
  const el = document.getElementById('debug-overlay');
  avzAssert.ok(el, 'debug-overlay 要素が存在しません');
  try {
    const file = new File([encodeWav16(sigDrumPattern(48000, 14, 120))], 'b16-10-drum.wav', { type: 'audio/wav' });
    await app.ui._loadMediaFile(file);
    avzAssert.ok(mediaManager.isLoaded, 'WAV が読み込まれていません');
    document.getElementById('btn-play').click();
    const media = mediaManager.mediaElement;
    const deadline = performance.now() + 20000;
    while (performance.now() < deadline && !(media.currentTime >= 10.3)) await b1610Wait(50);
    avzAssert.ok(media.currentTime >= 10, `10 秒に達しませんでした (${media.currentTime})`);
    const text = el.textContent;
    window.__b1610Text = text;
    avzAssert.ok(/MFS:\s*active/.test(text), `MFS 行がありません: ${text}`);
    const bpm = /BPM\s+([0-9]+(?:\.[0-9]+)?)\s+\(/.exec(text);
    avzAssert.ok(bpm, `BPM 行が数値ではありません: ${text}`);
    avzAssert.close(Number(bpm[1]), 120, 120 * 0.015, 'BPM 表示値');
    avzAssert.ok(/LUFS M\s+-?[0-9.]+\s+S\s+-?[0-9.]+\s+AGC\s+-?[0-9.]+dB/.test(text), `LUFS 行がありません: ${text}`);
    avzAssert.ok(/beat \[[#.]{8}\] [1-4]\/4/.test(text), `拍位相バーがありません: ${text}`);
    avzAssert.ok(/hops\/s:\s*[0-9]+/.test(text), `ホップ数/秒がありません: ${text}`);
    avzAssert.ok(/onset: [L.] [M.] [H.]/.test(text), `オンセットランプがありません: ${text}`);
  } finally {
    mediaManager.stop();
    app.visualizer.stop();
  }
}, { slow: true, timeoutMs: 60000 });
