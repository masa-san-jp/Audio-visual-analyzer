// 目的 — RGBA PNG エンコーダーの署名・寸法・画素復号を検証する（計画書 §3.6.3）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodeRgbaPng } from '../lib/png.mjs';

function readChunks(bytes) {
  const chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = Buffer.from(bytes.buffer, bytes.byteOffset + offset, 4).readUInt32BE(0);
    const type = Buffer.from(bytes.buffer, bytes.byteOffset + offset + 4, 4).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

test('U15-09 png: RGBA 画素を復号すると入力と一致する', () => {
  const input = Uint8Array.from([
    1, 2, 3, 255, 10, 20, 30, 128,
    40, 50, 60, 0, 70, 80, 90, 255,
  ]);
  const png = encodeRgbaPng(2, 2, input);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = readChunks(png);
  assert.deepEqual(chunks.map((chunk) => chunk.type), ['IHDR', 'IDAT', 'IEND']);
  assert.equal(Buffer.from(chunks[0].data).readUInt32BE(0), 2);
  assert.equal(Buffer.from(chunks[0].data).readUInt32BE(4), 2);
  const scanlines = inflateSync(chunks[1].data);
  assert.deepEqual(Array.from(scanlines), [0, ...input.slice(0, 8), 0, ...input.slice(8)]);
});

test('U15-09 png: 不正なサイズを拒否する', () => {
  assert.throws(() => encodeRgbaPng(1, 1, new Uint8Array(3)), RangeError);
  assert.throws(() => encodeRgbaPng(0, 1, new Uint8Array(0)), RangeError);
});
