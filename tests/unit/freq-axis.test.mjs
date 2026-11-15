// 目的 — IMP-02 周波数軸の写像（純粋関数）の検証 — doc/20261115-plan-imp02-log-frequency-axis.md §8
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['js/vis-utils.js', 'js/mfs-const.js', 'js/mfs-view.js']);
const freqToAxis = get('freqToAxis');
const axisToFreq = get('axisToFreq');
const freqAxisMaxHz = get('freqAxisMaxHz');
const buildAxisResampler = get('buildAxisResampler');
const resampleSpectrum = get('resampleSpectrum');
const computeFreqRange = get('computeFreqRange');
const computeLayerRange = get('computeLayerRange');

test('U-AX-01 freqToAxis（対数）: 端点・オクターブ等幅・単調・帯域外・逆関数', () => {
  const ax = f => freqToAxis(f, 50, 15000, 'log');
  assert.equal(ax(50), 0);
  assert.equal(ax(15000), 1);
  assert.ok(Math.abs((ax(200) - ax(100)) - (ax(4000) - ax(2000))) <= 1e-9);
  let prev = -1;
  for (let i = 0; i < 100; i++) {
    const v = ax(50 * Math.pow(300, i / 99));
    assert.ok(v > prev, `単調増加 i=${i}`);
    prev = v;
  }
  assert.equal(ax(49), 0);
  assert.equal(ax(15001), 1);
  assert.equal(ax(0), 0);
  assert.equal(ax(-10), 0);
  for (const f of [50, 63.2, 440, 1000, 9999, 15000]) {
    const back = axisToFreq(ax(f), 50, 15000, 'log');
    assert.ok(Math.abs(back - f) / f <= 1e-12, `${f}Hz の往復`);
  }
});

test('U-AX-02 freqToAxis（線形）: 従来の (f - 50) / (15000 - 50) と一致（Issue #68 の値）', () => {
  const ax = f => freqToAxis(f, 50, 15000, 'linear');
  for (const f of [50, 110, 440, 880, 7040, 15000]) assert.equal(ax(f), (f - 50) / 14950);
  const expected = { 110: 0.004, 440: 0.026, 880: 0.056, 7040: 0.468 };
  for (const [f, v] of Object.entries(expected)) assert.ok(Math.abs(ax(Number(f)) - v) <= 0.001, `${f}Hz`);
  assert.equal(ax(49), 0);
  assert.equal(ax(15001), 1);
});

test('U-AX-03 対数のレイヤー境界: 4レイヤーは各 log2(300)/4 オクターブ、1〜4レイヤーで隙間・重なりなし', () => {
  const fMax = freqAxisMaxHz(48000);
  const width = Math.log2(fMax / 50) / 4;
  for (let i = 0; i < 4; i++) {
    const fa = axisToFreq(i / 4, 50, fMax, 'log');
    const fb = axisToFreq((i + 1) / 4, 50, fMax, 'log');
    assert.ok(Math.abs(Math.log2(fb / fa) - width) <= 1e-9, `レイヤー${i}`);
  }
  // ビン単位の境界（線形軸でレイヤー分割だけ対数にする場合）
  const { startBin, endBin } = computeFreqRange(48000, 1024);
  const len = endBin - startBin;
  const r = new Int32Array(2);
  for (let count = 1; count <= 4; count++) {
    let prevEnd = 0;
    for (let i = 0; i < count; i++) {
      computeLayerRange(i, count, len, 48000, 2048, 'log', r);
      assert.equal(r[0], prevEnd, `count=${count} i=${i} 連続`);
      assert.ok(r[1] > r[0], `count=${count} i=${i} 幅 >= 1`);
      prevEnd = r[1];
    }
    assert.equal(prevEnd, len, `count=${count} 末尾`);
  }
});

for (const sampleRate of [48000, 44100]) {
  test(`U-AX-04 resampleSpectrum（${sampleRate}Hz）: 1kHz の位置・単調性・出力の再利用`, () => {
    const fft = 2048, binHz = sampleRate / fft;
    const { startBin, endBin } = computeFreqRange(sampleRate, fft / 2);
    const len = endBin - startBin;
    const fMax = freqAxisMaxHz(sampleRate);
    const table = buildAxisResampler(len, startBin, binHz, 50, fMax, len);

    // (a) 1kHz に最も近いビンだけ値がある → 最大値の位置が対数軸の 1kHz（0.5252）付近
    const spike = new Uint8Array(len);
    spike[Math.round(1000 / binHz) - startBin] = 255;
    const out = resampleSpectrum(table, spike);
    let argmax = 0;
    for (let j = 1; j < out.length; j++) if (out[j] > out[argmax]) argmax = j;
    assert.equal(out[argmax], 255, '集約でピークが消えない');
    assert.ok(Math.abs(argmax / len - Math.log(20) / Math.log(300)) <= 0.01, `位置 ${argmax / len}`);

    // (b) 単調増加のスペクトル → 並べ直しても単調非減少（補間と集約の継ぎ目に段差なし）
    const ramp = new Uint8Array(len);
    for (let k = 0; k < len; k++) ramp[k] = Math.floor(k * 255 / (len - 1));
    const r = resampleSpectrum(table, ramp);
    for (let j = 1; j < r.length; j++) assert.ok(r[j] >= r[j - 1], `j=${j}: ${r[j - 1]} -> ${r[j]}`);

    // (c) 出力配列は毎回同じもの
    const first = resampleSpectrum(table, ramp);
    for (let n = 0; n < 1000; n++) assert.equal(resampleSpectrum(table, ramp), first);
  });
}
