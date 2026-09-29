import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['tests/shared/wav.js']);

test('U15-08 wav.js: PCM 16bit WAV の44バイトヘッダーが仕様値になる', () => {
  const pcm = {
    sampleRate: 48000,
    channels: [new Float32Array([-1, -0.5, 0, 0.5, 1]), new Float32Array([1, 0.5, 0, -0.5, -1])]
  };
  const bytes = get('encodeWav16')(pcm);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));

  assert.equal(bytes.length, 44 + 5 * 2 * 2);
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(view.getUint32(4, true), 36 + 20);
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(12, 4), 'fmt ');
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(28, true), 192000);
  assert.equal(view.getUint16(32, true), 4);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(text(36, 4), 'data');
  assert.equal(view.getUint32(40, true), 20);
});

test('U15-08 wav.js: 16bit変換は±1.0を±32767にクランプする', () => {
  const pcm = { sampleRate: 8000, channels: [new Float32Array([-2, -1, 1, 2])] };
  const bytes = get('encodeWav16')(pcm);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.deepEqual([
    view.getInt16(44, true),
    view.getInt16(46, true),
    view.getInt16(48, true),
    view.getInt16(50, true)
  ], [-32767, -32767, 32767, 32767]);
});
