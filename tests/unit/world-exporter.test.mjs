// 目的 — WORLD-9の容器選択・音声入り180/360フレーム・中止時の資源解放 — 構想 §2.7(1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';
function setup({ mp4Audio = true, audioError = false } = {}) {
  const calls = { video: [], audio: [], closed: 0, frameClosed: 0, disposed: 0, steps: [], timeline: null };
  class Encoder {
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.encodeQueueSize = 0; }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame, options) {
      const video = !!options;
      calls[video ? 'video' : 'audio'].push(frame.timestamp);
      if (!video && audioError) { this.callbacks.error(new Error('audio failure')); return; }
      this.callbacks.output({ byteLength: 4, copyTo: data => data.set([0,0,0,1]), timestamp: frame.timestamp,
        duration: video ? frame.duration : 500000, type: options?.keyFrame ? 'key' : 'delta' },
      { decoderConfig: { description: new Uint8Array(video ? [1,100,0,40,255,225,0,0] : [0x11,0x90]).buffer } });
    }
    async flush() {}
    close() { this.state = 'closed'; calls.closed++; }
  }
  class Video extends Encoder { static async isConfigSupported(config) { return { supported: true }; } }
  class Audio extends Encoder { static async isConfigSupported(config) { return { supported: config.codec !== 'mp4a.40.2' || mp4Audio }; } }
  class Frame { constructor(canvas, config) { Object.assign(this, config); } close() { calls.frameClosed++; } }
  class AudioFrame { constructor(config) { Object.assign(this, config); } close() {} }
  class Engine {
    selectType(id, immediate) { calls.typeId = id; calls.immediate = immediate; }
    setScore(score) {} setTimeline(frames, fps) { calls.timeline = { frames, fps }; }
    advanceTo(t) { calls.steps.push(t); } _draw() {} dispose() { calls.disposed++; }
  }
  const r = loadClassic(['js/vis-utils.js', 'js/offline-exporter.js', 'js/mp4-muxer.js', 'js/webm-muxer.js',
    'js/mp4-demuxer.js', 'js/webm-demuxer.js', 'js/world/world-exporter.js'], {
    VideoEncoder: Video, AudioEncoder: Audio, VideoFrame: Frame, AudioData: AudioFrame, WorldEngine: Engine,
    OfflineAudioContext: class {}, document: { createElement: () => ({}) }, Blob
  });
  const exporter = new (r.get('WorldExporter'))(); exporter._yield = async () => {};
  const buffer = { sampleRate: 48000, length: 288000, duration: 6, numberOfChannels: 2,
    getChannelData: () => new Float32Array(288000) };
  const prepared = fps => ({ audioBuffer: buffer, fps, frameCount: 6 * fps,
    featureFrames: Array.from({ length: 6 * fps + 1 }, () => new Float32Array(104)) });
  return { r, exporter, calls, prepared };
}
test('UW-34 WORLD-9 MP4: 6秒30fps=180枚・音声・時刻・既存demuxer・解放', async () => {
  const {r,exporter,calls,prepared} = setup();
  const blob = await exporter.exportWorld({seed:11},prepared(30));
  const parsed = r.get('Mp4Demuxer').parse(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(parsed.chunks.length,180); assert.equal(parsed.chunks[90].timestampUs,3000000);
  assert.equal(parsed.codedWidth,1920);assert.equal(parsed.codedHeight,1080);
  assert.equal(calls.video.length,180);assert.equal(calls.audio.length,12);assert.equal(calls.frameClosed,180);
  assert.equal(calls.closed,2);assert.equal(calls.disposed,1);assert.equal(calls.timeline.fps,30);
  assert.equal(calls.steps[90],3);assert.equal(exporter.progress,1);assert.equal(exporter.state,'done');
  console.log('UW-34 MP4 frames=180 audioPCMChunks=12 frame90=3000000us dimensions=1920x1080 closed=2 disposed=1');
});
test('UW-35 WORLD-9 AAC非対応: 音声入りWebMへ・60fps=360枚', async () => {
  const {r,exporter,calls,prepared}=setup({mp4Audio:false});
  const blob=await exporter.exportWorld({seed:11},prepared(60));assert.equal(blob.type,'video/webm');
  const parsed=r.get('WebmDemuxer').parse(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(parsed.chunks.length,360);assert.equal(calls.audio.length,12);assert.equal(calls.timeline.fps,60);
  console.log('UW-35 WebM frames=360 fps=60 audioPCMChunks=12 AACunsupportedFallback=true');
});
test('UW-36 WORLD-9 cancel/error: download用blob無し・encoder/engineを確実に解放', async () => {
  const {exporter,calls,prepared}=setup();exporter.onProgress=p=>{if(p>.05)exporter.cancel();};
  assert.equal(await exporter.exportWorld({seed:11},prepared(30)),null);
  assert.equal(exporter.blob,null);assert.equal(exporter.state,'idle');assert.equal(calls.closed,2);assert.equal(calls.disposed,1);
  const fail=setup({audioError:true});await assert.rejects(fail.exporter.exportWorld({seed:11},fail.prepared(30)),/audio failure/);
  assert.equal(fail.exporter.blob,null);assert.equal(fail.calls.closed,2);assert.equal(fail.calls.disposed,1);
  console.log('UW-36 cancellationFrames='+calls.video.length+' cancelledBlob=null audioFailureRejected=true resourcesReleased=true');
});

test('UW-42 WORLD-11 書き出し: 選択タイプを固定して全フレームを符号化', async () => {
  for (const typeId of ['g-gargantua', 'g-attractor']) {
    const { exporter, calls, prepared } = setup();
    await exporter.exportWorld({ seed: 11 }, prepared(30), { typeId });
    assert.equal(calls.typeId, typeId); assert.equal(calls.immediate, true); assert.equal(calls.video.length, 180);
    console.log('UW-42 selectedExportType='+typeId+' frames=180 startupFade=false');
  }
});
