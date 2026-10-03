// @page app
// 目的 — 実書き出しのタイムライン一致とデコード映像の場面転換を検証する — Phase 18 計画書 §8.3 B18-03・B18-04。
// 両テストで同じ全曲書き出しを共有する。ID単独の実行でも実書き出しを行う。
function b18ExportWav(signal) {
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
async function b18ExportUntil(predicate, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  avzAssert.ok(predicate(), '状態変更がタイムアウトしました');
}
let b18ExportPromise = null;
function b18ExportOnce() {
  if (!b18ExportPromise) b18ExportPromise = b18ExportRun();
  return b18ExportPromise;
}
async function b18ExportRun() {
  const app = window.__app, visualizer = app.visualizer, exporter = app.ui.offlineExporter;
  const originalSettings = visualizer.settings;
  const originalRender = DirectorController.prototype.render;
  let exportTimeline = null, renderCalls = 0, analysis = null;
  const originalAnalyze = exporter._analyze;
  try {
    app.mediaManager.stop(); visualizer.stop();
    app.mediaManager.selectSlot(0);
    visualizer.settings = createDefaultSettings();
    visualizer.settings.directorEnabled = true;
    app.ui._syncDirectorOptions();
    const file = new File([b18ExportWav(synthSong(48000, { bpm: 128, seed: 11 }))],
      'b18-export-128.wav', { type: 'audio/wav', lastModified: 1810 });
    await app.ui._loadMediaFile(file, 0);
    await b18ExportUntil(() => visualizer.director.status === 'ready', 120000);
    avzAssert.equal(visualizer.director.songMap.sampleRate, SONG_CONST.DECODE_SAMPLE_RATE);
    avzAssert.equal(visualizer.director.songMap.sections.length, 6);
    document.getElementById('btn-play').click();
    await b18ExportUntil(() => app.mediaManager.isPlaying && visualizer.director.state.primary.sceneId, 3000);
    const liveTimeline = structuredClone(visualizer.director.timeline);
    const map = visualizer.director.songMap;
    // オフライン側だけのフレームを数える。
    app.mediaManager.stop(); visualizer.stop();
    const settings = { ...visualizer.settings, layers: visualizer.settings.layers.map(layer => ({ ...layer })) };
    const expected = new MfsFrameView();
    DirectorController.prototype.render = function (input, base, tSec) {
      if (this !== visualizer.director) {
        if (!exportTimeline) exportTimeline = structuredClone(this.timeline);
        avzAssert.equal(tSec, renderCalls / 30, '書き出し時計はi/fps');
        avzAssert.ok(input.features, '書き出しにMFSが渡る');
        songMapTempoAt(map, tSec, renderCalls ? (renderCalls - 1) / 30 : null, expected);
        for (const key of ['BPM', 'TEMPO_CONF', 'TEMPO_LOCKED', 'BEAT_PHASE', 'BAR_PHASE',
          'BEAT_IN_BAR', 'BEAT_FLAG', 'DOWNBEAT_FLAG']) {
          avzAssert.equal(input.features.raw[MFS_LAYOUT[key]], expected.raw[MFS_LAYOUT[key]], '拍の置換: ' + key);
        }
        renderCalls++;
      }
      return originalRender.call(this, input, base, tSec);
    };
    exporter._analyze = async function (...args) {
      analysis = await originalAnalyze.apply(this, args); return analysis;
    };
    const blob = await exporter.export(file, settings, { fps: 30, quality: 'standard',
      songMapService: app.ui.songMapService, presets: app.ui._directorPresets() });
    avzAssert.equal(exporter.state, 'done'); avzAssert.ok(blob && blob.size > 0, '全曲書き出し完了');
    avzAssert.ok(exportTimeline, '書き出し用Controllerが描画したタイムライン');
    avzAssert.equal(renderCalls, analysis.freqFrames.length);
    const totalSamples = analysis.audioBuffer.length;
    avzAssert.equal(renderCalls, Math.floor((totalSamples + 1) * 30 / analysis.sampleRate) + 1,
      'フレーム規則 s_i <= totalSamples + 1');
    console.log('B18 export ' + JSON.stringify({ renderCalls, durationSec: map.durationSec,
      decodeSampleRate: map.sampleRate, exportSampleRate: analysis.sampleRate, blobBytes: blob.size }));
    return { blob, map, liveTimeline, exportTimeline, renderCalls };
  } finally {
    DirectorController.prototype.render = originalRender; exporter._analyze = originalAnalyze;
    app.mediaManager.stop(); visualizer.stop();
    visualizer.settings = originalSettings; visualizer.settings.directorEnabled = false;
    app.ui._syncDirectorOptions();
  }
}

avzTest('B18-03', 'B18-03 同じWAVをONでライブ再生・書き出し: 実際に使われるタイムラインが深く一致', async function () {
  const result = await b18ExportOnce();
  avzAssert.deepEqual(result.exportTimeline, result.liveTimeline, 'ライブと書き出しのタイムライン');
  console.log('B18-03 segments=' + result.exportTimeline.segments.length + ' deepEqual=true');
}, { slow: true, timeoutMs: 900000 });

async function b18ExportDecode(blob, indices) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let parsed;
  try { parsed = Mp4Demuxer.parse(bytes); } catch (_) { parsed = WebmDemuxer.parse(bytes); }
  const chunks = parsed.chunks;
  const ordered = chunks.slice().sort((a, b) => a.timestampUs - b.timestampUs);
  const wanted = new Map(indices.map(index => [ordered[index].timestampUs, index]));
  const canvas = document.createElement('canvas');
  canvas.width = parsed.codedWidth; canvas.height = parsed.codedHeight;
  const ctx = canvas.getContext('2d');
  const frames = new Map();
  let error = null;
  const decoder = new VideoDecoder({
    output(frame) {
      try {
        if (wanted.has(frame.timestamp)) {
          ctx.drawImage(frame, 0, 0);
          frames.set(wanted.get(frame.timestamp), ctx.getImageData(0, 0, canvas.width, canvas.height).data);
        }
      } finally { frame.close(); }
    },
    error(e) { error = e; },
  });
  try {
    const config = { codec: parsed.codec, codedWidth: parsed.codedWidth, codedHeight: parsed.codedHeight };
    if (parsed.description) config.description = parsed.description;
    decoder.configure(config);
    const firstTime = ordered[Math.min(...indices)].timestampUs;
    const lastTime = ordered[Math.max(...indices)].timestampUs;
    let start = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].keyframe && chunks[i].timestampUs <= firstTime) start = i;
    }
    // 並べ替えを行うコーデックでも目的のフレームが出るよう、次のキーフレームまで供給する。
    let end = chunks.length - 1;
    for (let i = start; i < chunks.length; i++) {
      if (chunks[i].keyframe && chunks[i].timestampUs > lastTime) { end = i; break; }
    }
    for (let i = start; i <= end; i++) {
      const chunk = chunks[i];
      decoder.decode(new EncodedVideoChunk({ type: chunk.keyframe ? 'key' : 'delta',
        timestamp: chunk.timestampUs, data: chunk.data }));
    }
    await decoder.flush();
    if (error) throw error;
    avzAssert.equal(frames.size, indices.length, '境界前後の全フレームをデコード');
    return { frames, chunks: ordered.length, width: canvas.width, height: canvas.height };
  } finally { decoder.close(); }
}
function b18ExportMad(a, b) {
  avzAssert.equal(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  return sum / (a.length / 4 * 3);
}
avzTest('B18-04', 'B18-04 全曲30fps書き出し映像: build→drop境界の平均絶対差 >= 同セクション内の3倍', async function () {
  const result = await b18ExportOnce();
  const boundary = result.map.sections[2].startSec;
  avzAssert.equal(result.map.sections[1].kind, 'build'); avzAssert.equal(result.map.sections[2].kind, 'drop');
  const after = Math.ceil(boundary * 30), before = after - 1;
  // 境界直前の同じbuild内の隣接2枚を基準にする（フラッシュの影響を含まない）。
  avzAssert.ok((before - 1) / 30 >= result.map.sections[1].startSec);
  avzAssert.ok(before / 30 < boundary && after / 30 >= boundary);
  const decoded = await b18ExportDecode(result.blob, [before - 1, before, after]);
  avzAssert.equal(decoded.chunks, result.renderCalls, 'エンコード済み映像のフレーム数');
  const within = b18ExportMad(decoded.frames.get(before - 1), decoded.frames.get(before));
  const crossing = b18ExportMad(decoded.frames.get(before), decoded.frames.get(after));
  const measured = { boundarySec: boundary, beforeFrame: before, afterFrame: after,
    width: decoded.width, height: decoded.height, withinMad: within, crossingMad: crossing,
    ratio: within ? crossing / within : null };
  window.__b1804 = measured;
  console.log('B18-04 ' + JSON.stringify(measured));
  avzAssert.ok(crossing > 0, '境界で映像が変化する');
  avzAssert.ok(crossing >= within * 3, '境界の平均絶対差が同セクション内の3倍未満: ' + JSON.stringify(measured));
}, { slow: true, timeoutMs: 900000 });
