import test from 'node:test';
import assert from 'node:assert/strict';
import { MFS_CONST, MfsTempo, runTempo, sig } from '../lib/mfs-drive.mjs';

const { sigClickTrack, sigDrumPattern, sigNoise, sigMix, sigConcat } = sig;

const SAMPLE_RATES = [48000, 44100];
const BPMS = [70, 90, 100, 120, 128, 140, 150, 174];

// §5.5.1 の fold
function fold(b) {
  let c = b;
  while (c < MFS_CONST.TEMPO_FOLD_MIN_BPM) c *= 2;
  while (c >= MFS_CONST.TEMPO_FOLD_MAX_BPM) c /= 2;
  return c;
}

function withPink(s, seed = 7) {
  return sigMix([s, sigNoise(s.sampleRate, s.channels[0].length / s.sampleRate, 0.25, seed, { color: 'pink' })], [1, 1]);
}

// 条件ごとの信号を作る
function makeSignal(kind, sr, bpm, sec, noise) {
  let s = kind === 'click' ? sigClickTrack(sr, sec, bpm) : sigDrumPattern(sr, sec, bpm);
  if (noise) s = withPink(s);
  return s;
}

// 8 秒以降の全ホップで BPM が fold(真値) の ±tol 以内か。最悪誤差[%]とロック時刻を返す
function bpmStats(rec, trueBpm, tol) {
  const target = fold(trueBpm);
  let worst = 0, lockT = null, firstOk = null;
  for (let h = 0; h < rec.hops; h++) {
    if (rec.locked[h] && lockT === null) lockT = rec.t[h];
    if (rec.t[h] >= 8) {
      const e = Math.abs(rec.bpm[h] - target) / target;
      if (e > worst) worst = e;
    }
    if (firstOk === null && rec.bpm[h] > 0 && Math.abs(rec.bpm[h] - target) / target <= tol) firstOk = rec.t[h];
  }
  return { worst, lockT, firstOk, ok: worst <= tol, target };
}

// 拍イベント時刻と正解拍の最寄り誤差（符号付き, ms）。正解拍は §9.1 U16-06 の定義
function beatErrors(rec, trueBpm, sec) {
  const target = fold(trueBpm);
  const ratio = target / trueBpm;       // 2^m（m は整数）
  const beatSec = 60 / trueBpm;
  const events = [];
  for (let h = 0; h < rec.hops; h++) {
    if (rec.beat[h] && rec.t[h] >= 8 && rec.t[h] <= sec - 0.5) events.push(rec.t[h]);
  }
  const nBeats = Math.ceil(sec / beatSec) + 2;
  const grids = [];
  if (ratio >= 1) {
    const step = beatSec / ratio;
    grids.push((i) => i * step);
  } else {
    const k = Math.round(1 / ratio);
    for (let parity = 0; parity < k; parity++) grids.push((i) => (i * k + parity) * beatSec);
  }
  let best = null;
  for (const g of grids) {
    const errs = [];
    for (const t of events) {
      let bd = Infinity;
      const lim = Math.ceil(nBeats * Math.max(1, ratio)) + 2;
      for (let i = 0; i < lim; i++) {
        const d = t - g(i);
        if (Math.abs(d) < Math.abs(bd)) bd = d;
      }
      errs.push(bd * 1000);
    }
    const abs = errs.map(Math.abs).sort((a, b) => a - b);
    const med = abs.length ? abs[Math.floor(abs.length / 2)] : Infinity;
    if (!best || med < best.med) best = { med, errs, abs };
  }
  const abs = best.abs;
  return {
    n: abs.length,
    median: best.med,
    p95: abs.length ? abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] : Infinity,
    mean: best.errs.reduce((a, b) => a + b, 0) / Math.max(1, best.errs.length)
  };
}

const conds = [];
for (const sr of SAMPLE_RATES) {
  for (const kind of ['click', 'drum']) {
    for (const noise of [false, true]) {
      for (const bpm of BPMS) conds.push({ sr, kind, noise, bpm });
    }
  }
}

test('U16-05 / U16-06 MfsTempo: クリック・ドラム × 8 テンポ × 2 サンプルレート（±1% / ノイズ付き ±2%、拍位相）', () => {
  let fail = [];
  const lines = [];
  let sumMean = { 48000: [], 44100: [] };
  for (const c of conds) {
    const sec = 16;
    const rec = runTempo(makeSignal(c.kind, c.sr, c.bpm, sec, c.noise));
    const tol = c.noise ? 0.02 : 0.01;
    const st = bpmStats(rec, c.bpm, tol);
    const be = beatErrors(rec, c.bpm, sec);
    const tag = `${c.kind}${c.noise ? '+pink' : ''} sr=${c.sr} bpm=${c.bpm}`;
    lines.push(`${tag}: target=${st.target} worstErr=${(st.worst * 100).toFixed(2)}% lock=${st.lockT === null ? '-' : st.lockT.toFixed(2)}s ` +
      `beats=${be.n} median=${be.median.toFixed(1)}ms p95=${be.p95.toFixed(1)}ms mean=${be.mean.toFixed(1)}ms`);
    if (!st.ok) fail.push(`U16-05 ${tag} worst=${(st.worst * 100).toFixed(2)}%`);
    if (!(be.median <= 20)) fail.push(`U16-06 ${tag} median=${be.median.toFixed(1)}ms`);
    if (!(be.p95 <= 35)) fail.push(`U16-06 ${tag} p95=${be.p95.toFixed(1)}ms`);
    if (!(be.n > 0)) fail.push(`U16-06 ${tag} no beats`);
    if (!c.noise && Number.isFinite(be.mean)) sumMean[c.sr].push(be.mean);
  }
  console.log(lines.join('\n'));
  for (const sr of SAMPLE_RATES) {
    const m = sumMean[sr];
    console.log(`U16-06 sr=${sr} 符号付き平均誤差(ノイズなし全条件の平均) = ${(m.reduce((a, b) => a + b, 0) / m.length).toFixed(2)}ms`);
  }
  assert.deepEqual(fail, []);
});

test('U16-05 MfsTempo: 62〜198BPM を 4BPM 刻み・14 秒で最終ホップの BPM が fold(真値) の ±1%', () => {
  const fails = [];
  let maxErr = 0, count = 0;
  for (const sr of SAMPLE_RATES) {
    for (let bpm = 62; bpm <= 198; bpm += 4) {
      const rec = runTempo(sigClickTrack(sr, 14, bpm));
      const target = fold(bpm);
      const err = Math.abs(rec.bpm[rec.hops - 1] - target) / target;
      if (err > maxErr) maxErr = err;
      count++;
      if (!(err <= 0.01)) fails.push(`sr=${sr} bpm=${bpm} got=${rec.bpm[rec.hops - 1].toFixed(2)} target=${target}`);
    }
  }
  console.log(`U16-05 sweep: ${count - fails.length}/${count} 合格, 最大誤差 ${(maxErr * 100).toFixed(2)}%`);
  assert.deepEqual(fails, []);
});

test('U16-07 MfsTempo: 120BPM 16 秒 → 128BPM 16 秒で切り替えから 6 秒以内に 128 ± 1%', () => {
  for (const sr of SAMPLE_RATES) {
    const rec = runTempo(sigConcat([sigClickTrack(sr, 16, 120), sigClickTrack(sr, 16, 128)]));
    let reach = null;
    for (let h = 0; h < rec.hops; h++) {
      if (rec.t[h] > 16 && Math.abs(rec.bpm[h] - 128) / 128 <= 0.01) { reach = rec.t[h] - 16; break; }
    }
    // 120BPM 区間の終端でまだ 120 付近であること
    const before = rec.bpm[Math.floor(15.5 * sr / MFS_CONST.HOP_SIZE)];
    console.log(`U16-07 sr=${sr}: 再追従 ${reach === null ? '未達' : reach.toFixed(2) + 's'} (切替直前 BPM=${before.toFixed(2)})`);
    assert.ok(reach !== null && reach <= 6, `sr=${sr} reach=${reach}`);
    const end = rec.bpm[rec.hops - 1];
    assert.ok(Math.abs(end - 128) / 128 <= 0.01, `sr=${sr} end=${end}`);
  }
});

test('U16-08 MfsTempo: 小節頭（キックが 16 分グリッドの 0 番のみ）の DOWNBEAT_FLAG が 16 秒以降 90% 以上キック位置 ±60ms', () => {
  const kick = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const snare = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
  const fails = [];
  for (const sr of SAMPLE_RATES) {
    for (const bpm of [90, 100, 120, 128, 140, 150]) {
      const rec = runTempo(sigDrumPattern(sr, 32, bpm, { kick, snare }));
      const bar = 4 * 60 / bpm;
      let n = 0, ok = 0, worst = 0;
      for (let h = 0; h < rec.hops; h++) {
        if (!rec.downbeat[h] || rec.t[h] < 16) continue;
        n++;
        const ph = rec.t[h] / bar;
        const d = Math.abs(ph - Math.round(ph)) * bar;
        if (d <= 0.06) ok++;
        if (d > worst) worst = d;
      }
      console.log(`U16-08 sr=${sr} bpm=${bpm}: downbeat ${ok}/${n} 一致 (最大ずれ ${(worst * 1000).toFixed(0)}ms)`);
      if (!(n > 0 && ok / n >= 0.9)) fails.push(`sr=${sr} bpm=${bpm} ${ok}/${n}`);
    }
  }
  assert.deepEqual(fails, []);
});

test('U16-05 MfsTempo: 無音・初期状態は locked=0 / BPM=0 / フラグなし、出力は有限、reset() 後の再処理は同一（決定性）', () => {
  const sr = 48000;
  const silent = { sampleRate: sr, channels: [new Float32Array(sr * 10), new Float32Array(sr * 10)] };
  const rec = runTempo(silent);
  for (let h = 0; h < rec.hops; h++) {
    assert.equal(rec.locked[h], 0);
    assert.equal(rec.bpm[h], 0);
    assert.equal(rec.beat[h], 0);
    assert.equal(rec.downbeat[h], 0);
  }
  const sigA = sigDrumPattern(sr, 12, 120);
  const a = runTempo(sigA), b = runTempo(sigA);
  assert.deepEqual(Array.from(a.bpm), Array.from(b.bpm));
  assert.deepEqual(Array.from(a.beat), Array.from(b.beat));
  for (let h = 0; h < a.hops; h++) {
    assert.ok(Number.isFinite(a.bpm[h]) && Number.isFinite(a.phase[h]) && Number.isFinite(a.barPhase[h]) && Number.isFinite(a.conf[h]));
    assert.ok(a.phase[h] >= 0 && a.phase[h] < 1);
    assert.ok(a.barPhase[h] >= 0 && a.barPhase[h] < 1);
    assert.ok(a.beatInBar[h] <= 3);
  }
  // reset() で初期値へ戻る
  const t = new MfsTempo(sr);
  for (let i = 0; i < 1000; i++) t.process(i % 47 === 0 ? 1 : 0, 0, 0, 0, i * 0.01);
  t.reset();
  assert.equal(t.bpm, 0); assert.equal(t.locked, 0); assert.equal(t.phase, 0); assert.equal(t.conf, 0);
});
