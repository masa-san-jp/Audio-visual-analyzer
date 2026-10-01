import test from 'node:test';
import assert from 'node:assert/strict';
import { MFS_CONST, MfsOnset, forEachHop, sig } from '../lib/mfs-drive.mjs';

const { sigClickTrack, sigNoise, sigMix } = sig;

const SAMPLE_RATES = [48000, 44100];
const N = MFS_CONST.FFT_SIZE;
const H = MFS_CONST.HOP_SIZE;

// MfsExtractor 未実装のため、tests/lib/mfs-drive.mjs（計画書 §5.1 / §5.3 どおりのホップ分割・FFT）で MfsOnset を駆動する。
// 戻り値: 群ごとのオンセット時刻の配列（tSec = ホップ完了時刻）
function runOnsets(signal) {
  const onset = new MfsOnset(signal.sampleRate, N);
  const times = [[], [], [], []];
  forEachHop(signal, (A, tSec) => {
    const flags = onset.process(A, tSec);
    assert.ok(flags >= 0 && flags <= 15);
    for (let g = 0; g < 4; g++) if (flags & (1 << g)) times[g].push(tSec);
    for (let g = 0; g < 4; g++) {
      assert.ok(Number.isFinite(onset.flux[g]) && Number.isFinite(onset.env[g]));
      assert.ok(onset.env[g] >= 0 && onset.env[g] <= 1);
    }
  });
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
