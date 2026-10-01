import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic([
  'js/mfs-const.js', 'js/mfs-dsp.js', 'js/mfs-onset.js', 'tests/shared/signals.js'
]);
const MFS_CONST = get('MFS_CONST');
const mfsDerived = get('mfsDerived');
const mfsWindowHann = get('mfsWindowHann');
const MfsFft = get('MfsFft');
const MfsOnset = get('MfsOnset');
const sigClickTrack = get('sigClickTrack');
const sigNoise = get('sigNoise');
const sigMix = get('sigMix');

const SAMPLE_RATES = [48000, 44100];
const N = MFS_CONST.FFT_SIZE;
const H = MFS_CONST.HOP_SIZE;

// MfsExtractor 未実装のため、計画書 §5.1 / §5.3 どおりにホップ分割と振幅スペクトル A を作って MfsOnset を駆動する。
// 戻り値: 群ごとのオンセット時刻の配列（tSec = ホップ完了時刻）
function runOnsets(signal) {
  const sr = signal.sampleRate;
  const [L, R] = signal.channels;
  const w = mfsWindowHann(N);
  const fft = new MfsFft(N);
  const reL = new Float64Array(N), imL = new Float64Array(N);
  const reR = new Float64Array(N), imR = new Float64Array(N);
  const A = new Float64Array(N / 2);
  const scale = 2 / (N / 2);
  const onset = new MfsOnset(sr, N);
  const times = [[], [], [], []];
  const hops = Math.floor(L.length / H);
  for (let h = 0; h < hops; h++) {
    const end = (h + 1) * H;
    for (let n = 0; n < N; n++) {
      const idx = end - N + n;
      const l = idx >= 0 ? L[idx] : 0, r = idx >= 0 ? R[idx] : 0;
      reL[n] = l * w[n]; imL[n] = 0;
      reR[n] = r * w[n]; imR[n] = 0;
    }
    fft.transform(reL, imL);
    fft.transform(reR, imR);
    for (let k = 0; k < N / 2; k++) {
      A[k] = Math.hypot(reL[k] + reR[k], imL[k] + imR[k]) * scale / 2;
    }
    const tSec = end / sr;
    const flags = onset.process(A, tSec);
    assert.ok(flags >= 0 && flags <= 15);
    for (let g = 0; g < 4; g++) if (flags & (1 << g)) times[g].push(tSec);
    for (let g = 0; g < 4; g++) {
      assert.ok(Number.isFinite(onset.flux[g]) && Number.isFinite(onset.env[g]));
      assert.ok(onset.env[g] >= 0 && onset.env[g] <= 1);
    }
  }
  return times;
}

// クリック時刻 c に対し [c, c+25ms] の発生を「検出」とし、命中・取りこぼし・範囲外発生・遅れ(ms)を数える
function evaluate(sr, sec, bpm, times) {
  const clicks = [];
  for (let k = 0; k * 60 / bpm < sec; k++) clicks.push(Math.round(k * 60 / bpm * sr) / sr);
  let hits = 0, misses = 0;
  const delays = [];
  const used = new Set();
  for (const c of clicks) {
    const idx = times.findIndex((t, i) => !used.has(i) && t >= c && t <= c + 0.025);
    if (idx >= 0) { hits++; used.add(idx); delays.push((times[idx] - c) * 1000); } else misses++;
  }
  return { clicks: clicks.length, hits, misses, falsePositives: times.length - used.size, delays };
}

test('U16-04 MfsOnset: sigClickTrack(sr,16,120) の full 群が全クリックの +0〜25ms に発生、範囲外 0', () => {
  for (const sr of SAMPLE_RATES) {
    const sec = 16;
    const times = runOnsets(sigClickTrack(sr, sec, 120));
    const ev = evaluate(sr, sec, 120, times[3]);
    const dmin = Math.min(...ev.delays).toFixed(1), dmax = Math.max(...ev.delays).toFixed(1);
    console.log(`U16-04 sr=${sr}: clicks=${ev.clicks} hits=${ev.hits} misses=${ev.misses} falsePositives=${ev.falsePositives} delay=${dmin}..${dmax}ms`);
    assert.equal(ev.misses, 0);
    assert.equal(ev.falsePositives, 0);
    assert.equal(ev.hits, ev.clicks);
  }
});

test('U16-04 MfsOnset: 無音 10 秒でオンセット発生 0（全群）', () => {
  for (const sr of SAMPLE_RATES) {
    const len = 10 * sr;
    const times = runOnsets({ sampleRate: sr, channels: [new Float32Array(len), new Float32Array(len)] });
    for (let g = 0; g < 4; g++) assert.equal(times[g].length, 0, `sr=${sr} g=${g}`);
  }
});

test('U16-04 MfsOnset: ピンクノイズ(0.25)を重ねたクリックの検出数を出力（参考値・合否基準なし）', () => {
  for (const sr of SAMPLE_RATES) {
    const sec = 16;
    const mix = sigMix([sigClickTrack(sr, sec, 120), sigNoise(sr, sec, 0.25, 11, { color: 'pink' })], [1, 1]);
    const times = runOnsets(mix);
    const ev = evaluate(sr, sec, 120, times[3]);
    console.log(`U16-04(noise) sr=${sr}: clicks=${ev.clicks} hits=${ev.hits} misses=${ev.misses} falsePositives=${ev.falsePositives}`);
    assert.ok(ev.hits > 0);
  }
});

test('U16-04 MfsOnset: reset() 後の再処理は同じ結果（決定性）、process 内で env は 0..1', () => {
  const sr = 48000;
  const sig = sigClickTrack(sr, 4, 120);
  const a = runOnsets(sig), b = runOnsets(sig);
  assert.deepEqual(a, b);
  const o = new MfsOnset(sr, N);
  const A = new Float64Array(N / 2).fill(0.5);
  o.process(A, 0.01);
  o.reset();
  assert.equal(o.odf, 0);
  assert.deepEqual(Array.from(o.env), [0, 0, 0, 0]);
});
