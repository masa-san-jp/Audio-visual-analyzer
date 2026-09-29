import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['tests/shared/signals.js']);

function bytesOf(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function assertPcmEqual(actual, expected) {
  assert.equal(actual.sampleRate, expected.sampleRate);
  assert.equal(actual.channels.length, expected.channels.length);
  for (let channel = 0; channel < actual.channels.length; channel++) {
    assert.ok(bytesOf(actual.channels[channel]).equals(bytesOf(expected.channels[channel])));
  }
}

test('U15-07 signals.js: 同じ引数で合成信号を生成するとビット単位で一致する', () => {
  const makeNoise = get('sigNoise');
  const first = makeNoise(48000, 1, 0.25, 7, { color: 'pink', stereo: 'independent' });
  const second = makeNoise(48000, 1, 0.25, 7, { color: 'pink', stereo: 'independent' });
  assertPcmEqual(first, second);

  const makeDrums = get('sigDrumPattern');
  assertPcmEqual(makeDrums(48000, 2, 120), makeDrums(48000, 2, 120));
});

test('U15-07 signals.js: クリックの開始サンプルは拍位置を丸めた値になる', () => {
  const signal = get('sigClickTrack')(48000, 4, 120);
  const starts = [0, 24000, 48000, 72000];
  for (const start of starts) {
    assert.notEqual(signal.channels[0][start], 0);
    if (start > 0) assert.equal(signal.channels[0][start - 1], 0);
    assert.equal(signal.channels[0][start], signal.channels[1][start]);
  }
  assert.equal(signal.channels[0].length, 192000);
});

test('U15-07 signals.js: パンなしの正弦波は左右同一になる', () => {
  const signal = get('sigSine')(48000, 0.01, 440, 0.5);
  assertPcmEqual({ sampleRate: signal.sampleRate, channels: [signal.channels[0]] },
    { sampleRate: signal.sampleRate, channels: [signal.channels[1]] });
});
