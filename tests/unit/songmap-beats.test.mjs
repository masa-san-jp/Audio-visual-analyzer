// ソングマップ解析 前半（①〜⑤）の単体テスト — doc/20260928-plan-phase18-song-map-and-auto-director.md §8.2 U18-01〜U18-04 / U18-10
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';
import { songmapRows, SONGMAP_ROW } from '../lib/songmap-rows.mjs';

const { get } = loadClassic([
  'js/mfs-const.js', 'js/songmap-analysis.js',
  'tests/shared/signals.js', 'tests/shared/song-synth.js'
]);
const songOdf = get('songOdf');
const songGlobalTempo = get('songGlobalTempo');
const songDpBeats = get('songDpBeats');
const songGridBeats = get('songGridBeats');
const songDownbeats = get('songDownbeats');
const buildSongMap = get('buildSongMap');
const synthTempoChange = get('synthTempoChange');
const mfsDerived = get('mfsDerived');

const LEN = SONGMAP_ROW.LENGTH;
const FR48 = mfsDerived(48000).fr;   // 93.75 hop/s

// 指定ホップに値を置いた行列（FLUX の full=3 / low=0 列のみ）
function rowsWith({ L, full = [], low = [], chroma = null }) {
  const rows = new Float32Array(L * LEN);
  for (const [h, v] of full) rows[h * LEN + SONGMAP_ROW.FLUX + 3] = v;
  for (const [h, v] of low) rows[h * LEN + SONGMAP_ROW.FLUX + 0] = v;
  if (chroma) for (let h = 0; h < L; h++) for (let k = 0; k < 12; k++) rows[h * LEN + SONGMAP_ROW.CHROMA + k] = chroma(h, k);
  return rows;
}

// 母標準偏差
function popStd(a) {
  let m = 0; for (const v of a) m += v; m /= a.length;
  let s = 0; for (const v of a) s += (v - m) * (v - m);
  return Math.sqrt(s / a.length);
}

// 120BPM 相当（P = 46.875 ホップ）のインパルス位置。tempoScale > 1 の区間は周期を 1/tempoScale にする
function impulsePositions(L, P, { changeAt = null, scale = 1 } = {}) {
  const pos = [];
  let t = 10;
  while (t < L) {
    pos.push(Math.round(t));
    t += (changeAt !== null && t >= changeAt) ? P / scale : P;
  }
  return pos;
}

// 拍 F 値（許容 tolSec、昇順配列同士の貪欲な 1 対 1 対応）
function fMeasure(est, truth, tolSec) {
  let i = 0, j = 0, hit = 0;
  while (i < est.length && j < truth.length) {
    const d = est[i] - truth[j];
    if (Math.abs(d) <= tolSec) { hit++; i++; j++; }
    else if (d < 0) i++;
    else j++;
  }
  const p = est.length ? hit / est.length : 0;
  const r = truth.length ? hit / truth.length : 0;
  return p + r > 0 ? 2 * p * r / (p + r) : 0;
}

test('U18-01 ODF: 定数列は全 0', () => {
  const L = 2000;
  const rows = new Float32Array(L * LEN);
  for (let h = 0; h < L; h++) { rows[h * LEN + 3] = 5; rows[h * LEN + 0] = 2; }
  const { o, oL } = songOdf(rows, L, FR48);
  assert.ok(o.every((v) => v === 0));
  assert.ok(oL.every((v) => v === 0));
});

test('U18-01 ODF: 単発インパルス列は該当位置のみ正で、標準偏差 1 に正規化される', () => {
  const L = 2000;
  const pos = [100, 400, 700, 1000, 1300, 1600];
  const rows = rowsWith({ L, full: pos.map((h) => [h, 3]), low: pos.map((h) => [h, 1]) });
  const { o, oL } = songOdf(rows, L, FR48);
  const set = new Set(pos);
  for (let h = 0; h < L; h++) {
    if (set.has(h)) { assert.ok(o[h] > 0 && oL[h] > 0, `位置 ${h} が正`); }
    else { assert.equal(o[h], 0); assert.equal(oL[h], 0); }
  }
  assert.ok(Math.abs(popStd(o) - 1) < 1e-9);
  assert.ok(Math.abs(popStd(oL) - 1) < 1e-9);
});

test('U18-02 DP 拍: 120BPM 相当のインパルス列（L=3000、48kHz）で ±1 ホップに全一致', () => {
  const L = 3000;
  const P = 60 * FR48 / 120;
  const pos = impulsePositions(L, P);
  const rows = rowsWith({ L, full: pos.map((h) => [h, 1]) });
  const { o } = songOdf(rows, L, FR48);
  const tempo = songGlobalTempo(o, FR48);
  assert.ok(Math.abs(tempo.bpm - 120) / 120 < 0.01, `bpm=${tempo.bpm}`);
  const dp = songDpBeats(o, tempo.P);
  // DP 拍はすべてインパルス位置の ±1 ホップ以内、かつインパルスもすべて DP 拍で拾われる
  for (const h of dp) assert.ok(pos.some((p) => Math.abs(p - h) <= 1), `DP 拍 ${h} がインパルス位置と不一致`);
  for (const p of pos) assert.ok(dp.some((h) => Math.abs(p - h) <= 1), `インパルス ${p} が DP 拍に無い`);
  assert.equal(dp.length, pos.length);
});

test('U18-03 格子: U18-02 の入力で beatSource = grid。後半のテンポを 5% 変えると dp', () => {
  const L = 3000;
  const P = 60 * FR48 / 120;
  const pos = impulsePositions(L, P);
  const rows = rowsWith({ L, full: pos.map((h) => [h, 1]) });
  const { o } = songOdf(rows, L, FR48);
  const tempo = songGlobalTempo(o, FR48);
  const g = songGridBeats(o, tempo.P, songDpBeats(o, tempo.P));
  assert.equal(g.beatSource, 'grid');

  const pos2 = impulsePositions(L, P, { changeAt: L / 2, scale: 1.05 });
  const rows2 = rowsWith({ L, full: pos2.map((h) => [h, 1]) });
  const o2 = songOdf(rows2, L, FR48).o;
  const t2 = songGlobalTempo(o2, FR48);
  const g2 = songGridBeats(o2, t2.P, songDpBeats(o2, t2.P));
  assert.equal(g2.beatSource, 'dp', `near=${g2.near}`);
});

test('U18-04 小節頭: 4 拍ごと（位相 1）にだけ強い low 値で downbeatIndices[0] mod 4 = 1', () => {
  const L = 3000;
  for (const phase of [1, 3]) {
    const beatHops = [];
    for (let i = 0; 5 + 48 * i < L - 10; i++) beatHops.push(5 + 48 * i);
    const low = beatHops.map((h, i) => [h, i % 4 === phase ? 3 : 1]);
    const full = beatHops.map((h) => [h, 1]);
    const rows = rowsWith({ L, full, low });
    const { oL } = songOdf(rows, L, FR48);
    const idx = songDownbeats(beatHops, oL, rows, L);
    assert.equal(idx[0] % 4, phase);
    assert.equal(idx[0], phase);
    for (let k = 1; k < idx.length; k++) assert.equal(idx[k] - idx[k - 1], 4);
    assert.equal(idx[idx.length - 1], beatHops.length - 1 - ((beatHops.length - 1 - phase) % 4));
  }
});

test('U18-04 小節頭: low が一様でもクロマ変化（和声の切り替わり）が小節頭を決める', () => {
  const L = 3000;
  const beatHops = [];
  for (let i = 0; 5 + 48 * i < L - 10; i++) beatHops.push(5 + 48 * i);
  const full = beatHops.map((h) => [h, 1]);
  const low = beatHops.map((h) => [h, 1]);
  // 拍 i ≡ 2 (mod 4) の開始で和音が変わる
  const chord = (h) => Math.floor((Math.floor((h - 5) / 48) + 2) / 4) % 4;
  const rows = rowsWith({ L, full, low, chroma: (h, k) => ((k + 3 * chord(h)) % 12 < 3 ? 1 : 0) });
  const { oL } = songOdf(rows, L, FR48);
  assert.equal(songDownbeats(beatHops, oL, rows, L)[0], 2);
});

// ── U18-10: テンポ変化曲（48kHz、60 秒）。行データの生成が重いので 1 回だけ作って共有する ──
let tcCache = null;
function tempoChangeResult() {
  if (tcCache) return tcCache;
  const sig = synthTempoChange(48000);
  const { rows, durationSec } = songmapRows(sig);
  const map = buildSongMap(rows, { sampleRate: 48000, durationSec });
  tcCache = { map, truth: sig.truth };
  return tcCache;
}

test('U18-10 テンポ変化 120→126BPM: beatSource = dp、拍 F 値（±70ms）≥ 0.95', () => {
  const { map, truth } = tempoChangeResult();
  assert.equal(map.beatSource, 'dp');
  const f = fMeasure(map.beats, truth.beats, 0.07);
  console.log(`# U18-10 bpm=${map.bpm.toFixed(2)} conf=${map.tempoConfidence.toFixed(3)} beats=${map.beats.length} F=${f.toFixed(4)}`);
  assert.ok(f >= 0.95, `F=${f}`);
});

test('U18-10 buildSongMap 骨格: ①〜⑤ の出力（beats 昇順・downbeatIndices は範囲内で 4 刻み）', () => {
  const { map } = tempoChangeResult();
  assert.equal(map.version, 1);
  for (let i = 1; i < map.beats.length; i++) assert.ok(map.beats[i] > map.beats[i - 1]);
  assert.ok(map.beats[0] >= 0);
  for (let k = 0; k < map.downbeatIndices.length; k++) {
    assert.ok(map.downbeatIndices[k] >= 0 && map.downbeatIndices[k] < map.beats.length);
    if (k > 0) assert.equal(map.downbeatIndices[k] - map.downbeatIndices[k - 1], 4);
  }
});
