// @page app
// @query debug=1
// 目的 — フェードを含む10秒のライブ描画時間p95を比較する — Phase 18 計画書 §8.3 B18-08。
// B18-01と同じ32bit float WAVで、合成PCMを量子化せずに渡す。
function b1808Wav(signal) {
  const channels = signal.channels, frames = channels[0].length, align = channels.length * 4;
  const bytes = new Uint8Array(44 + frames * align), view = new DataView(bytes.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true);
  ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, signal.sampleRate, true); view.setUint32(28, signal.sampleRate * align, true);
  view.setUint16(32, align, true); view.setUint16(34, 32, true);
  ascii(36, 'data'); view.setUint32(40, frames * align, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) { view.setFloat32(offset, channel[i], true); offset += 4; }
  }
  return bytes;
}
avzTest('B18-08', 'B18-08 自動演出ON・debug=1・10秒再生: フェードp95 <= 通常p95の2.5倍', async function () {
  const app = window.__app;
  const visualizer = app.visualizer, director = visualizer.director;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(predicate, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    while (!predicate() && performance.now() < deadline) await wait(25);
    avzAssert.ok(predicate(), '状態変更がタイムアウトしました');
  }
  const overlay = visualizer.debugOverlay;
  avzAssert.ok(overlay, '?debug=1 の描画計測');
  const original = overlay.recordFrame;
  const fade = [], normal = [];
  let recording = false;
  try {
    app.mediaManager.selectSlot(0);
    const file = new File([b1808Wav(synthSong(48000, { bpm: 128, seed: 11 }))],
      'b18-performance.wav', { type: 'audio/wav', lastModified: 1808 });
    await app.ui._loadMediaFile(file, 0);
    const enabled = document.getElementById('director-enabled');
    enabled.checked = true; enabled.dispatchEvent(new Event('change'));
    await until(() => director.status === 'ready', 120000);
    const segment = director.timeline.segments.find(s => s.transitionIn.type === 'fade');
    const el = app.mediaManager.mediaElement;
    const startSec = segment.startSec - 2;
    el.currentTime = startSec;
    app.audioEngine.resetAnalysis();
    overlay.recordFrame = function (renderMs, nowMs) {
      if (recording) (director.state.secondary ? fade : normal).push(renderMs);
      original.call(this, renderMs, nowMs);
    };
    document.getElementById('btn-play').click();
    await until(() => app.mediaManager.isPlaying, 3000);
    recording = true;
    await until(() => el.currentTime >= startSec + 10, 15000);
    recording = false;
    avzAssert.ok(fade.length > 0 && normal.length > 0, 'フェード内外のサンプル');
    function p95(values) { values.sort((a, b) => a - b); return values[Math.ceil(values.length * 0.95) - 1]; }
    const fadeP95 = p95(fade), normalP95 = p95(normal);
    const result = { fadeP95Ms: fadeP95, normalP95Ms: normalP95,
      ratio: fadeP95 / normalP95, fadeFrames: fade.length, normalFrames: normal.length,
      playbackSec: el.currentTime - startSec };
    window.__b1808 = result;
    console.log('B18-08 ' + JSON.stringify(result));
    avzAssert.ok(fadeP95 <= normalP95 * 2.5,
      '描画時間p95: fade=' + fadeP95 + 'ms normal=' + normalP95 + 'ms ratio=' + result.ratio);
  } finally {
    recording = false; overlay.recordFrame = original;
    app.mediaManager.stop(); visualizer.stop();
    document.getElementById('director-enabled').checked = false;
    document.getElementById('director-enabled').dispatchEvent(new Event('change'));
  }
}, { slow: true, timeoutMs: 150000 });
