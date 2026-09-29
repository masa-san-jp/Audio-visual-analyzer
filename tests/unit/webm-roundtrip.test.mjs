import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['js/webm-muxer.js', 'js/webm-demuxer.js']);
const WebmMuxer = get('WebmMuxer');
const WebmDemuxer = get('WebmDemuxer');

function chunkData(index) {
  return Uint8Array.from([index, index ^ 0x55, 0xA0 + (index % 31)]);
}

test('U15-05 WebM: 映像30チャンクと音声付きの往復で映像データを完全一致させる', async () => {
  const expected = [];
  const muxer = new WebmMuxer({
    width: 320,
    height: 180,
    videoCodecId: 'V_VP9',
    audioCodecId: 'A_OPUS',
    sampleRate: 48000,
    channels: 2,
  });

  for (let i = 0; i < 30; i++) {
    const timestampUs = i * 33_000;
    const data = chunkData(i);
    const keyframe = i % 10 === 0;
    muxer.addVideoChunk(data, timestampUs, keyframe);
    expected.push({ data, timestampUs, keyframe });
    if (i % 3 === 0) {
      muxer.addAudioChunk(Uint8Array.from([0xF0, i, 0x0D]), timestampUs);
    }
  }

  const blob = muxer.finalize(1000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parsed = WebmDemuxer.parse(bytes);

  assert.equal(parsed.chunks.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(Array.from(parsed.chunks[i].data), Array.from(expected[i].data), `chunk ${i} data`);
    assert.equal(parsed.chunks[i].timestampUs, expected[i].timestampUs, `chunk ${i} timestamp`);
    assert.equal(parsed.chunks[i].keyframe, expected[i].keyframe, `chunk ${i} keyframe`);
  }
});
