import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['js/mp4-muxer.js', 'js/mp4-demuxer.js']);
const Mp4Muxer = get('Mp4Muxer');
const Mp4Demuxer = get('Mp4Demuxer');

function chunkData(index) {
  return Uint8Array.from([0x10 + index, index ^ 0xAA, 0xC0 + (index % 37), 0x7F]);
}

test('U15-06 MP4: 映像30チャンクと音声付きの往復でデータとPTSを一致させる', async () => {
  const expected = [];
  const muxer = new Mp4Muxer({
    width: 320,
    height: 180,
    fps: 30,
    sampleRate: 48000,
    channels: 2,
    avcConfig: Uint8Array.from([1, 0x64, 0, 0x1F, 0xFF]),
    audioSpecificConfig: Uint8Array.from([0x12, 0x10]),
  });

  for (let i = 0; i < 30; i++) {
    const timestampUs = Math.round(i * 1_000_000 / 30);
    const data = chunkData(i);
    const keyframe = i % 10 === 0;
    muxer.addVideoChunk(data, timestampUs, keyframe);
    expected.push({ data, timestampUs, keyframe });
    if (i % 3 === 0) {
      muxer.addAudioChunk(Uint8Array.from([0x21, i, 0x43]), timestampUs, 20_000);
    }
  }

  const blob = muxer.finalize(1000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parsed = Mp4Demuxer.parse(bytes);

  assert.equal(parsed.chunks.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(Array.from(parsed.chunks[i].data), Array.from(expected[i].data), `chunk ${i} data`);
    assert.ok(Math.abs(parsed.chunks[i].timestampUs - expected[i].timestampUs) <= 1,
      `chunk ${i} timestamp: actual=${parsed.chunks[i].timestampUs}, expected=${expected[i].timestampUs}`);
    assert.equal(parsed.chunks[i].keyframe, expected[i].keyframe, `chunk ${i} keyframe`);
  }
});
