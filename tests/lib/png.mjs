// 目的 — ゴールデン比較の差分画像を依存なしの PNG として書き出す（計画書 §3.6.3）。
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Uint32Array(256);

for (let i = 0; i < CRC_TABLE.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[i] = value >>> 0;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  body.copy(output, 4);
  output.writeUInt32BE(crc32(body), 8 + data.length);
  return output;
}

function assertImageInput(width, height, rgba) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('PNG の幅と高さは正の整数で指定してください。');
  }
  if (!rgba || rgba.length !== width * height * 4) {
    throw new RangeError('RGBA 配列の長さが画像サイズと一致しません。');
  }
}

/**
 * RGBA 8bit の画素列を、フィルターなしの RGBA PNG に変換する。
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|Buffer} rgba 行優先の RGBA 画素列
 * @returns {Uint8Array}
 */
export function encodeRgbaPng(width, height, rgba) {
  assertImageInput(width, height, rgba);
  const rowLength = width * 4;
  const scanlines = Buffer.alloc((rowLength + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowLength + 1);
    scanlines[rowStart] = 0;
    scanlines.set(rgba.subarray(y * rowLength, (y + 1) * rowLength), rowStart + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  const output = Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return new Uint8Array(output);
}
