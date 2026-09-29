import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['js/history-buffer.js']);
const FrameHistory = get('FrameHistory');

function frame(...values) {
  return Uint8Array.from(values);
}

test('U15-02 history-buffer: push と get(age) は最新から古い順に返す', () => {
  const history = new FrameHistory(3, 2);
  history.push(frame(1, 2));
  history.push(frame(3, 4));

  assert.equal(history.size, 2);
  assert.deepEqual(Array.from(history.get(0)), [3, 4]);
  assert.deepEqual(Array.from(history.get(1)), [1, 2]);
});

test('U15-02 history-buffer: 容量超過時は最古のフレームを上書きする', () => {
  const history = new FrameHistory(2, 1);
  history.push(frame(10));
  history.push(frame(20));
  history.push(frame(30));

  assert.equal(history.size, 2);
  assert.deepEqual(Array.from(history.get(0)), [30]);
  assert.deepEqual(Array.from(history.get(1)), [20]);
});

test('U15-02 history-buffer: setFrameLength は容量を再確保して履歴をクリアする', () => {
  const history = new FrameHistory(2, 2);
  history.push(frame(1, 2));
  history.setFrameLength(3);

  assert.equal(history.frameLength, 3);
  assert.equal(history.size, 0);
  assert.equal(history.get(0), null);

  history.push(frame(4, 5, 6));
  assert.deepEqual(Array.from(history.get(0)), [4, 5, 6]);
});

test('U15-02 history-buffer: 範囲外の age は null を返す', () => {
  const history = new FrameHistory(2, 1);
  history.push(frame(1));

  assert.equal(history.get(-1), null);
  assert.equal(history.get(1), null);
  assert.equal(history.get(999), null);
});
