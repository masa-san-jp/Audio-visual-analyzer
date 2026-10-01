import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['js/vis-utils.js', 'js/mfs-const.js', 'js/mfs-dsp.js']);
const makeRng = get('makeRng');
const MFS_CONST = get('MFS_CONST');
const MFS_LAYOUT = get('MFS_LAYOUT');
const mfsDerived = get('mfsDerived');
const mfsWindowHann = get('mfsWindowHann');
const MfsFft = get('MfsFft');
const MfsMelBank = get('MfsMelBank');
const MfsBiquad = get('MfsBiquad');

const SAMPLE_RATES = [48000, 44100];

function naiveDft(x, k) {
  const n = x.length;
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const a = -2 * Math.PI * ((k * i) % n) / n;
    re += x[i] * Math.cos(a);
    im += x[i] * Math.sin(a);
  }
  return [re, im];
}

test('U16-01 MfsFft: 素朴な DFT と全ビンで相対誤差 1e-4 以下 (N=64, 2048)', () => {
  let maxErr = 0;
  let checked = 0;
  for (const n of [64, 2048]) {
    const rng = makeRng(1234 + n);
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = rng() * 2 - 1;
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    new MfsFft(n).transform(re, im);
    for (let k = 0; k < n; k++) {
      const [rr, ri] = naiveDft(x, k);
      const mag = Math.hypot(rr, ri);
      if (!(mag > 1e-3)) continue;
      const err = Math.hypot(re[k] - rr, im[k] - ri) / mag;
      checked++;
      if (err > maxErr) maxErr = err;
      assert.ok(err <= 1e-4, `n=${n} k=${k} err=${err}`);
    }
  }
  console.log(`U16-01 max relative error = ${maxErr.toExponential(3)} (${checked} bins)`);
  assert.ok(checked > 1000);
});

test('U16-01 mfsWindowHann: Σw = N/2、先頭 0', () => {
  const w = mfsWindowHann(2048);
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  assert.ok(Math.abs(s - 1024) < 1e-3);
  assert.equal(w[0], 0);
});

test('U16-02 MfsMelBank: 帯域数・単調増加・端点・重み合計', () => {
  for (const sr of SAMPLE_RATES) {
    const bank = new MfsMelBank(sr, MFS_CONST.FFT_SIZE);
    assert.equal(bank.bands, 32);
    assert.equal(bank.centerHz.length, 32);
    for (let b = 1; b < 32; b++) assert.ok(bank.centerHz[b] > bank.centerHz[b - 1], `sr=${sr} b=${b}`);
    assert.ok(Math.abs(bank.lowHz[0] - 50) < 1e-6);
    assert.ok(Math.abs(bank.highHz[31] - 15000) < 1e-6);
    let fallback = 0;
    for (let b = 0; b < 32; b++) {
      if (!(bank.weightSum(b) > 0)) fallback++;
    }
    // Σweight=0 の帯域は中心ビン代替: 単位パワーを入れて有限正値が返ること
    const P = new Float64Array(MFS_CONST.FFT_SIZE / 2).fill(1);
    const out = new Float32Array(32);
    bank.apply(P, out);
    for (let b = 0; b < 32; b++) {
      assert.ok(bank.weightSum(b) > 0 || out[b] === 1, `sr=${sr} b=${b}`);
      assert.ok(Math.abs(out[b] - 1) < 1e-6, `sr=${sr} b=${b} out=${out[b]}`);
    }
    console.log(`U16-02 sr=${sr}: centers ${bank.centerHz[0].toFixed(1)}..${bank.centerHz[31].toFixed(1)} Hz, 中心ビン代替 ${fallback} 帯域`);
  }
});

test('U16-02 MfsMelBank: 単一ビンのパワーが該当帯域に入る', () => {
  const bank = new MfsMelBank(48000, 2048);
  const P = new Float64Array(1024);
  const k = Math.round(1000 / (48000 / 2048));
  P[k] = 1;
  const out = new Float32Array(32);
  bank.apply(P, out);
  let best = 0;
  for (let b = 1; b < 32; b++) if (out[b] > out[best]) best = b;
  assert.ok(Math.abs(bank.centerHz[best] - 1000) < 150, `center=${bank.centerHz[best]}`);
});

function gainDb(sr, freq) {
  const [s1, s2] = MfsBiquad.kWeighting(sr);
  const n = Math.round(sr * 2);
  let sin = 0, sout = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.sin(2 * Math.PI * freq * i / sr);
    const y = s2.process(s1.process(x));
    if (i >= n / 2) { sin += x * x; sout += y * y; cnt++; }
  }
  return 10 * Math.log10(sout / sin);
}

test('U16-03 MfsBiquad: 48kHz 係数が BS.1770 公式値と一致 (±1e-9)', () => {
  const [s1, s2] = MfsBiquad.kWeighting(48000);
  const want1 = { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 };
  const want2 = { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 };
  for (const key of Object.keys(want1)) assert.ok(Math.abs(s1[key] - want1[key]) <= 1e-9, `stage1 ${key}: ${s1[key]}`);
  for (const key of Object.keys(want2)) assert.ok(Math.abs(s2[key] - want2[key]) <= 1e-9, `stage2 ${key}: ${s2[key]}`);
});

test('U16-03 MfsBiquad: K 特性の周波数応答 (48kHz / 44.1kHz)', () => {
  for (const sr of SAMPLE_RATES) {
    const g997 = gainDb(sr, 997);
    const g20 = gainDb(sr, 20);
    const g10k = gainDb(sr, 10000);
    console.log(`U16-03 sr=${sr}: 997Hz ${g997.toFixed(4)} dB, 20Hz ${g20.toFixed(3)} dB, 10kHz ${g10k.toFixed(4)} dB`);
    assert.ok(Math.abs(g997 - 0.69) <= 0.02, `997Hz ${g997}`);
    assert.ok(g20 < -10, `20Hz ${g20}`);
    assert.ok(Math.abs(g10k - 4.0) <= 0.1, `10kHz ${g10k}`);
  }
});

test('U16-03 MfsBiquad.reset: 状態が初期化される', () => {
  const [s1] = MfsBiquad.kWeighting(48000);
  const a = [s1.process(1), s1.process(0.5)];
  s1.reset();
  assert.deepEqual([s1.process(1), s1.process(0.5)], a);
});

test('T16-01 mfsDerived / MFS_LAYOUT: 導出値と配置', () => {
  const d48 = mfsDerived(48000);
  assert.equal(d48.fr, 93.75);
  assert.ok(Math.abs(mfsDerived(44100).fr - 86.1328125) < 1e-9);
  assert.equal(d48.hopSec, 512 / 48000);
  assert.ok(Math.abs(d48.alpha(0.15) - (1 - Math.exp(-512 / (48000 * 0.15)))) < 1e-15);
  assert.equal(d48.frames(8), 750);
  assert.equal(d48.frames(0), 1);
  assert.ok(Math.abs(d48.eventLatencySec - 0.316 * 2048 / 48000) < 1e-15);
  assert.equal(d48.binHz, 48000 / 2048);
  assert.equal(d48.binOf(1000), Math.round(1000 / (48000 / 2048)));
  assert.equal(MFS_LAYOUT.LENGTH, 104);
  assert.equal(MFS_LAYOUT.PEAK, 103);
  assert.equal(MFS_LAYOUT.CHROMA + 12, MFS_LAYOUT.LOUD_MOMENTARY);
  assert.equal(MFS_LAYOUT.STEREO_PAN + 3, MFS_LAYOUT.CENTROID);
  assert.equal(MFS_CONST.ONSET_GROUPS.length, 4);
});
