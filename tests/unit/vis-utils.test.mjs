import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['js/vis-utils.js']);
const makeRng = get('makeRng');
const computeFreqRange = get('computeFreqRange');

test('U15-03 vis-utils: makeRng(1) は先頭5値を再現する', () => {
  const firstRng = makeRng(1);
  const secondRng = makeRng(1);
  const first = Array.from({ length: 5 }, () => firstRng());
  const second = Array.from({ length: 5 }, () => secondRng());

  assert.deepEqual(first, second);
});

test('U15-03 vis-utils: computeFreqRange はサンプルレートごとの帯域を返す', () => {
  const range48000 = computeFreqRange(48000, 1024);
  const range44100 = computeFreqRange(44100, 1024);
  assert.equal(range48000.startBin, 2);
  assert.equal(range48000.endBin, 640);
  assert.equal(range44100.startBin, 2);
  assert.equal(range44100.endBin, 697);
});
