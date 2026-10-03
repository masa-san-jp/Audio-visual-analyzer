// ソングマップ解析（前半: ① ODF・② 全体テンポ・③ DP 拍・④ 一定テンポ格子・⑤ 小節頭）— doc/20260928-plan-phase18-song-map-and-auto-director.md §4
//
// 純粋関数のみ（DOM・Web Audio に依存しない）。ファイル読込後に 1 回だけメインスレッドで実行する解析であり、
// 毎フレーム経路ではないため配列の新規確保を許す（計画書 §2 / §5、ガイド §9.3 の例外）。
// 決定的（乱数・時刻を使わない）。MFS_CONST / mfsDerived（js/mfs-const.js）を先に読み込んでおくこと。
// 後半（⑥ 小節〜⑨ 展開の種類、validateSongMap）はファイル末尾に置く。

// §4.1 定数表。値の唯一の正は計画書（ガイド §2.2）。後半（⑥〜⑨）で使う定数もここに揃えておく
const SONG_CONST = {
  ODF_MEAN_SEC: 1.0,
  BEAT_TIGHTNESS: 400,
  GRID_PERIOD_STEPS: 10,
  GRID_PERIOD_STEP: 0.0005,
  GRID_PHASE_STEP_HOPS: 0.25,
  GRID_TOL: 0.1,
  GRID_MIN_FRAC: 0.8,
  DOWNBEAT_WINDOW_HOPS: 2,
  CHROMA_WEIGHT: 0.5,
  KERNEL_SEC: 8,
  MIN_SECTION_SEC: 7,
  PEAK_NEIGHBOR_SEC: 3.75,
  PEAK_K: 0.5,
  ENERGY_NOVELTY_WEIGHT: 0.5,
  LABEL_SIM: 0.8,
  EDGE_MAX_ENERGY: 0.5,
  BREAK_MAX_ENERGY: 0.5,
  BREAK_DROP: 0.2,
  BUILD_SLOPE_PER_SEC: 0.0267,
  DROP_MIN_ENERGY: 0.7,
  DROP_JUMP: 0.2,
  MIN_DURATION_SEC: 20,
  MAX_DURATION_SEC: 1200,
};

// §3 の行配置は js/mfs-const.js の SONGMAP_ROW（SSOT）を使う。そのため mfs-const.js を先に読み込むこと
function _songRow() {
  return SONGMAP_ROW;
}

// §4.3 SongMapError の code: 'no-rhythm' | 'too-short' | 'too-long' | 'decode' | 'cancelled'
class SongMapError extends Error {
  constructor(code) {
    super('SongMapError: ' + code);
    this.name = 'SongMapError';
    this.code = code;
  }
}

// ── 共通ヘルパ（後半 ⑥〜⑨ でも使う）。平均・標準偏差はすべて母集団（n で割る）──

// 母標準偏差による標準化。標準偏差 ≤ EPS なら全 0
function songZ(a) {
  const n = a.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  let m = 0;
  for (let i = 0; i < n; i++) m += a[i];
  m /= n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - m) * (a[i] - m);
  const sd = Math.sqrt(s / n);
  if (sd <= MFS_CONST.EPS) return out;
  for (let i = 0; i < n; i++) out[i] = (a[i] - m) / sd;
  return out;
}

// コサイン類似度。どちらかのノルム ≤ EPS なら 0
function songCos(a, b) {
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  na = Math.sqrt(na);
  nb = Math.sqrt(nb);
  if (na <= MFS_CONST.EPS || nb <= MFS_CONST.EPS) return 0;
  return d / (na * nb);
}

// 昇順ソート後の要素 a[round(p·(n−1))]
function songPct(a, p) {
  const s = Float64Array.from(a).sort();
  if (s.length === 0) return 0;
  return s[Math.round(p * (s.length - 1))];
}

// ── ① ODF ──

// movmean(a)[t] = a[max(0,t−w) .. min(L−1,t+w)] の平均。累積和で求める
function _songMovMean(a, L, w) {
  const cum = new Float64Array(L + 1);
  for (let t = 0; t < L; t++) cum[t + 1] = cum[t] + a[t];
  const out = new Float64Array(L);
  for (let t = 0; t < L; t++) {
    const lo = Math.max(0, t - w);
    const hi = Math.min(L - 1, t + w);
    out[t] = (cum[hi + 1] - cum[lo]) / (hi - lo + 1);
  }
  return out;
}

// 行列 rows から列 col を取り出して odfRaw = max(0, F − movmean(F)) を母標準偏差で割る（≤ EPS なら全 0）
function _songOdfColumn(rows, L, col, w) {
  const LEN = _songRow().LENGTH;
  const F = new Float64Array(L);
  for (let t = 0; t < L; t++) F[t] = rows[t * LEN + col];
  const mm = _songMovMean(F, L, w);
  const raw = new Float64Array(L);
  for (let t = 0; t < L; t++) {
    const v = F[t] - mm[t];
    raw[t] = v > 0 ? v : 0;
  }
  let m = 0;
  for (let t = 0; t < L; t++) m += raw[t];
  m /= L;
  let s = 0;
  for (let t = 0; t < L; t++) s += (raw[t] - m) * (raw[t] - m);
  const sd = Math.sqrt(s / L);
  const out = new Float64Array(L);
  if (L > 0 && sd > MFS_CONST.EPS) {
    for (let t = 0; t < L; t++) out[t] = raw[t] / sd;
  }
  return out;
}

// o = FLUX full の ODF、oL = FLUX low の ODF（どちらも標準偏差 1）
function songOdf(rows, L, fr) {
  const w = Math.round(SONG_CONST.ODF_MEAN_SEC * fr / 2);
  const R = _songRow();
  return {
    o: _songOdfColumn(rows, L, R.FLUX + 3, w),
    oL: _songOdfColumn(rows, L, R.FLUX + 0, w),
  };
}

// ── ② 全体テンポ（Phase 16 §5.5.1 の式を o 全体に適用）──

function songGlobalTempo(o, fr) {
  const C = MFS_CONST;
  const L = o.length;
  const TMAX = Math.ceil(C.TEMPO_HARMONICS * 60 * fr / C.TEMPO_SEARCH_MIN_BPM) + 2;
  let mean = 0;
  for (let t = 0; t < L; t++) mean += o[t];
  mean = L > 0 ? mean / L : 0;
  const xt = new Float64Array(L);
  for (let t = 0; t < L; t++) xt[t] = o[t] - mean;
  const maxLag = Math.min(L - 1, TMAX);
  const ri = new Float64Array(TMAX + 2);
  for (let tau = 0; tau <= maxLag; tau++) {
    let s = 0;
    for (let t = tau; t < L; t++) s += xt[t] * xt[t - tau];
    ri[tau] = s / (L - tau);
  }
  if (!(ri[0] > C.EPS)) throw new SongMapError('no-rhythm');
  // 実数ラグの線形補間。τ ≥ L−1 なら 0
  const r = function (tau) {
    if (tau >= L - 1) return 0;
    const a = Math.floor(tau);
    const f = tau - a;
    return ri[a] * (1 - f) + ri[a + 1] * f;
  };
  const nCand = Math.floor((C.TEMPO_SEARCH_MAX_BPM - C.TEMPO_SEARCH_MIN_BPM) / C.TEMPO_GRID_STEP_BPM + 1e-9) + 1;
  let bestScore = -Infinity, bestB = C.TEMPO_SEARCH_MIN_BPM;
  for (let k = 0; k < nCand; k++) {
    const b = C.TEMPO_SEARCH_MIN_BPM + k * C.TEMPO_GRID_STEP_BPM;
    const tau = 60 * fr / b;
    let S = 0;
    for (let j = 1; j <= C.TEMPO_HARMONICS; j++) S += r(j * tau) / j;
    S += C.TEMPO_HALF_WEIGHT * r(tau / 2);
    const z = Math.log(b / C.TEMPO_PRIOR_CENTER_BPM) / Math.LN2 / C.TEMPO_PRIOR_SIGMA_OCT;
    const score = Math.exp(-0.5 * z * z) * S;
    if (score > bestScore) { bestScore = score; bestB = b; }   // 同値は小さい b
  }
  const tauBest = 60 * fr / bestB;
  let conf = r(tauBest) / ri[0];
  conf = conf < 0 ? 0 : (conf > 1 ? 1 : conf);
  let bpm = bestB;
  while (bpm < C.TEMPO_FOLD_MIN_BPM) bpm *= 2;
  while (bpm >= C.TEMPO_FOLD_MAX_BPM) bpm /= 2;
  return { bpm: bpm, conf: conf, P: 60 * fr / bpm };
}

// ── ③ 動的計画法による拍（DP 拍）。戻り値はホップ番号（昇順）──

function songDpBeats(o, P) {
  const L = o.length;
  if (L === 0) return [];
  const TIGHT = SONG_CONST.BEAT_TIGHTNESS;
  const maxD = Math.round(2 * P);
  // 間隔 d（ホップ）ごとのペナルティ BEAT_TIGHTNESS·(ln(d/P))²。式は擬似コードと同一で、表に前計算するだけ
  const pen = new Float64Array(maxD + 1);
  for (let d = 1; d <= maxD; d++) { const l = Math.log(d / P); pen[d] = TIGHT * l * l; }
  const C = new Float64Array(L);
  const back = new Int32Array(L);
  const rHalf = Math.round(P / 2);
  for (let t = 0; t < L; t++) {
    const lo = Math.max(0, t - maxD);
    const hi = t - rHalf;
    let best = -Infinity;
    let bp = -1;
    for (let p = lo; p <= hi; p++) {
      const v = C[p] - pen[t - p];
      if (v > best) { best = v; bp = p; }
    }
    back[t] = bp;
    C[t] = o[t] + (bp >= 0 ? best : 0);
  }
  let tEnd = Math.max(0, L - Math.round(P));
  for (let t = tEnd + 1; t < L; t++) if (C[t] > C[tEnd]) tEnd = t;   // 同値は小さい t
  const rev = [];
  for (let t = tEnd; t >= 0; t = back[t]) rev.push(t);
  rev.reverse();
  return rev;
}

// ── ④ 一定テンポ格子の当てはめ ──
// 拍の秒（beats）への換算と「beats < 0 の拍を beats / beatHops の両方から除く」処理まで行う（計画書 §4.2 ④）。
// 戻り値: { beatHops, beats, beatSource, near }（near = 格子上にある DP 拍の割合）
function songGridBeats(o, P, dpBeats, sampleRate) {
  const S = SONG_CONST;
  const L = o.length;
  // 線形補間（t < 0 または t ≥ L−1 なら 0）
  const oi = function (t) {
    if (t < 0 || t >= L - 1) return 0;
    const a = Math.floor(t);
    const f = t - a;
    return o[a] * (1 - f) + o[a + 1] * f;
  };
  let bestScore = -Infinity, gP = P, gPh = 0;
  for (let q = -S.GRID_PERIOD_STEPS; q <= S.GRID_PERIOD_STEPS; q++) {
    const PP = P * (1 + q * S.GRID_PERIOD_STEP);
    for (let m = 0; m * S.GRID_PHASE_STEP_HOPS < PP; m++) {
      const ph = m * S.GRID_PHASE_STEP_HOPS;
      let score = 0;
      for (let k = 0; ph + k * PP < L; k++) score += oi(ph + k * PP);
      if (score > bestScore) { bestScore = score; gP = PP; gPh = ph; }   // 等しい場合は更新しない
    }
  }
  const grid = [];
  for (let k = 0; gPh + k * gP < L; k++) grid.push(gPh + k * gP);
  let nearCount = 0;
  for (let i = 0; i < dpBeats.length; i++) {
    const h = dpBeats[i];
    const nearest = gPh + Math.round((h - gPh) / gP) * gP;
    if (Math.abs(h - nearest) <= S.GRID_TOL * gP) nearCount++;
  }
  const near = dpBeats.length > 0 ? nearCount / dpBeats.length : 0;
  const useGrid = near >= S.GRID_MIN_FRAC;
  const allHops = useGrid ? grid : dpBeats;
  const d = mfsDerived(sampleRate);
  const hops = [], beats = [];
  for (let i = 0; i < allHops.length; i++) {
    const sec = (allHops[i] + 1) * d.hopSec - d.eventLatencySec;
    if (sec >= 0) { hops.push(allHops[i]); beats.push(sec); }
  }
  return { beatHops: hops, beats: beats, beatSource: useGrid ? 'grid' : 'dp', near: near };
}

// ── ⑤ 小節頭（4/4 固定）。戻り値は beats の添字（昇順）──

function songDownbeats(beatHops, oL, rows, L) {
  const S = SONG_CONST;
  const R = _songRow();
  const LEN = R.LENGTH;
  const n = beatHops.length;
  if (n === 0) return [];
  const low = new Float64Array(n);
  const hc = new Float64Array(n);
  let prevC = null;
  for (let i = 0; i < n; i++) {
    const hb = Math.round(beatHops[i]);
    // 低域 ODF の最大値（範囲外は無視）
    let mx = -Infinity;
    for (let h = hb - S.DOWNBEAT_WINDOW_HOPS; h <= hb + S.DOWNBEAT_WINDOW_HOPS; h++) {
      if (h >= 0 && h < L && oL[h] > mx) mx = oL[h];
    }
    low[i] = mx === -Infinity ? 0 : mx;
    // クロマ和（hop ∈ [hb_i, hb_{i+1})、最後の拍は L まで）
    const h1 = i + 1 < n ? Math.round(beatHops[i + 1]) : L;
    const c = new Float64Array(12);
    for (let h = Math.max(0, hb); h < Math.min(h1, L); h++) {
      for (let k = 0; k < 12; k++) c[k] += rows[h * LEN + R.CHROMA + k];
    }
    hc[i] = i === 0 ? 0 : 1 - songCos(c, prevC);
    prevC = c;
  }
  const zl = songZ(low), zh = songZ(hc);
  const score = new Float64Array(4);
  for (let i = 0; i < n; i++) score[i % 4] += zl[i] + zh[i];
  const kmax = Math.min(4, n);
  let kStar = 0;
  for (let k = 1; k < kmax; k++) if (score[k] > score[kStar]) kStar = k;   // 同値は小さい k
  const idx = [];
  for (let i = kStar; i < n; i += 4) idx.push(i);
  return idx;
}

// ── buildSongMap（骨格）──
// T18-03 時点では ①〜⑤ の結果（SongMap v1 のうち beats までのフィールド）を返す。
// ⑥〜⑨（bars・sections）と validateSongMap は関数末尾で呼び出す。
function buildSongMap(rows, meta) {
  const sampleRate = meta.sampleRate;
  const durationSec = meta.durationSec;
  if (durationSec < SONG_CONST.MIN_DURATION_SEC) throw new SongMapError('too-short');
  if (durationSec > SONG_CONST.MAX_DURATION_SEC) throw new SongMapError('too-long');
  const d = mfsDerived(sampleRate);
  const L = Math.floor(rows.length / _songRow().LENGTH);

  const odf = songOdf(rows, L, d.fr);                                  // ①
  const tempo = songGlobalTempo(odf.o, d.fr);                          // ②
  const dpBeats = songDpBeats(odf.o, tempo.P);                         // ③
  const grid = songGridBeats(odf.o, tempo.P, dpBeats, sampleRate);     // ④（beats < 0 の除去を含む）
  const downbeatIndices = songDownbeats(grid.beatHops, odf.oL, rows, L);   // ⑤

  const map = {
    version: 1,
    durationSec: durationSec,
    sampleRate: sampleRate,
    bpm: tempo.bpm,
    tempoConfidence: tempo.conf,
    beatSource: grid.beatSource,
    beats: grid.beats,
    downbeatIndices: downbeatIndices,
  };
  const barData = songBars(grid.beatHops, grid.beats, downbeatIndices, rows, L, durationSec); // ⑥
  const boundaries = barData.v.length < 2
    ? [0, barData.v.length]
    : songBoundaries(barData.v, barData.E, tempo.bpm); // ⑦
  const sections = songSections(boundaries, barData.bars, barData.v, barData.E, tempo.bpm); // ⑧⑨
  map.bars = barData.bars;
  map.sections = sections;
  // 解析結果は常に v1 の出力契約を満たす。異常な入力はテンポ解析段階で no-rhythm になる。
  const validation = validateSongMap(map);
  if (!validation.ok) throw new SongMapError('no-rhythm');
  return map;
}

// ── ⑥ 小節 ──

// 拍列と小節頭から、小節特徴ベクトルと正規化エネルギーを作る。
function songBars(beatHops, beats, downbeatIndices, rows, L, durationSec) {
  const R = _songRow();
  const LEN = R.LENGTH;
  const starts = [];
  const startBeatIndices = [];
  for (let j = 0; j < downbeatIndices.length; j++) {
    const beatIndex = downbeatIndices[j];
    const startHop = Math.round(beatHops[beatIndex]);
    if (startHop >= L - 1) continue;
    starts.push(startHop);
    startBeatIndices.push(beatIndex);
  }

  const nbar = starts.length;
  const rawV = [];
  const barLufs = new Float64Array(nbar);
  const bars = [];
  for (let j = 0; j < nbar; j++) {
    const h0 = j === 0 ? 0 : starts[j];
    const h1 = j + 1 < nbar ? starts[j + 1] : L;
    const count = Math.max(0, h1 - h0);
    const mean = new Float64Array(44);
    let energy = 0;
    for (let h = h0; h < h1; h++) {
      const base = h * LEN;
      for (let k = 0; k < 32; k++) mean[k] += rows[base + R.BANDS + k];
      for (let k = 0; k < 12; k++) mean[32 + k] += SONG_CONST.CHROMA_WEIGHT * rows[base + R.CHROMA + k];
      energy += rows[base + R.ENERGY];
    }
    if (count > 0) {
      for (let k = 0; k < mean.length; k++) mean[k] /= count;
      energy /= count;
    }
    rawV.push(mean);
    barLufs[j] = MFS_CONST.LOUD_OFFSET + 10 * Math.log10(energy + MFS_CONST.EPS);
    const startSec = j === 0 ? 0 : beats[startBeatIndices[j]];
    const endSec = j + 1 < nbar ? beats[startBeatIndices[j + 1]] : durationSec;
    bars.push({ startSec: startSec, endSec: endSec, energy: 0 });
  }

  const v = [];
  for (let k = 0; k < 44; k++) {
    const column = new Float64Array(nbar);
    for (let j = 0; j < nbar; j++) column[j] = rawV[j][k];
    const z = songZ(column);
    for (let j = 0; j < nbar; j++) {
      if (!v[j]) v[j] = new Float64Array(44);
      v[j][k] = z[j];
    }
  }

  const p5 = songPct(barLufs, 0.05);
  const p95 = songPct(barLufs, 0.95);
  const spread = p95 - p5;
  const E = new Float64Array(nbar);
  for (let j = 0; j < nbar; j++) {
    E[j] = spread < 1 ? 0.5 : Math.max(0, Math.min(1, (barLufs[j] - p5) / spread));
    bars[j].energy = E[j];
  }
  return { bars: bars, v: v, E: E };
}

// ── ⑦ 境界（小節間の新規性ピーク）──

function songBoundaries(v, E, bpm) {
  const S = SONG_CONST;
  const nbar = Math.min(v.length, E.length);
  if (nbar < 2) return [0, nbar];
  const barSecA = 4 * 60 / bpm;
  const K = Math.max(4, Math.round(S.KERNEL_SEC / barSecA));
  const sigma = K / 2;
  const MINS = Math.max(2, Math.round(S.MIN_SECTION_SEC / barSecA));
  const NB = Math.max(1, Math.round(S.PEAK_NEIGHBOR_SEC / barSecA));
  const offsets = [];
  for (let a = -K; a <= K; a++) if (a !== 0) offsets.push(a);

  const sim = (i, k) => {
    if (i < 0 || i >= nbar || k < 0 || k >= nbar) return 0;
    return songCos(v[i], v[k]);
  };
  const nov = new Float64Array(nbar - 1);
  const en = new Float64Array(nbar - 1);
  for (let j = 1; j < nbar; j++) {
    let total = 0;
    for (let ai = 0; ai < offsets.length; ai++) {
      const a = offsets[ai];
      const ia = a < 0 ? j + a : j + a - 1;
      const sa = a < 0 ? -1 : 1;
      for (let bi = 0; bi < offsets.length; bi++) {
        const b = offsets[bi];
        const ib = b < 0 ? j + b : j + b - 1;
        const sb = b < 0 ? -1 : 1;
        total += sa * sb * Math.exp(-(a * a + b * b) / (2 * sigma * sigma)) * sim(ia, ib);
      }
    }
    nov[j - 1] = Math.max(0, total);
    en[j - 1] = Math.abs(E[j] - E[j - 1]);
  }

  let maxNov = 0, maxEn = 0;
  for (let i = 0; i < nov.length; i++) {
    if (nov[i] > maxNov) maxNov = nov[i];
    if (en[i] > maxEn) maxEn = en[i];
  }
  const N = new Float64Array(nbar - 1);
  for (let i = 0; i < N.length; i++) {
    N[i] = nov[i] / (maxNov > 0 ? maxNov : 1)
      + S.ENERGY_NOVELTY_WEIGHT * en[i] / (maxEn > 0 ? maxEn : 1);
  }
  let mean = 0;
  for (let i = 0; i < N.length; i++) mean += N[i];
  mean /= N.length;
  let variance = 0;
  for (let i = 0; i < N.length; i++) variance += (N[i] - mean) * (N[i] - mean);
  const threshold = mean + S.PEAK_K * Math.sqrt(variance / N.length);

  const candidates = [];
  for (let j = MINS; j <= nbar - MINS; j++) {
    const value = N[j - 1];
    if (value < threshold) continue;
    let local = true;
    for (let d = -NB; d <= NB && local; d++) {
      if (d === 0 || j + d < 1 || j + d >= nbar) continue;
      if (value < N[j + d - 1]) local = false;
    }
    if (local) candidates.push(j);
  }
  candidates.sort((a, b) => {
    const diff = N[b - 1] - N[a - 1];
    return diff !== 0 ? diff : a - b;
  });
  const chosen = [0, nbar];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    let separated = true;
    for (let j = 0; j < chosen.length; j++) {
      if (Math.abs(candidate - chosen[j]) < MINS) { separated = false; break; }
    }
    if (separated) chosen.push(candidate);
  }
  chosen.sort((a, b) => a - b);
  return chosen;
}

// 0=A, 25=Z, 26=AA の順でラベルを生成する。
function _songLabel(index) {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    n--;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}

// ── ⑧⑨ セクションのラベルと展開の種類 ──

function songSections(boundaries, bars, v, E, bpm) {
  const nbar = Math.min(v.length, E.length, bars.length);
  const barSecA = 4 * 60 / bpm;
  if (nbar < 2) {
    if (nbar === 0) return [];
    return [{
      startBar: 0,
      endBar: nbar,
      startSec: bars[0].startSec,
      endSec: bars[nbar - 1].endSec,
      label: 'A',
      kind: 'main',
      energy: E[0],
      slopePerSec: 0,
    }];
  }

  const count = boundaries.length - 1;
  const sectionInfo = [];
  for (let s = 0; s < count; s++) {
    const startBar = boundaries[s];
    const endBar = boundaries[s + 1];
    const length = Math.max(0, endBar - startBar);
    const meanV = new Float64Array(44);
    let energy = 0;
    for (let j = startBar; j < endBar; j++) {
      for (let k = 0; k < 44; k++) meanV[k] += v[j][k];
      energy += E[j];
    }
    if (length > 0) {
      for (let k = 0; k < 44; k++) meanV[k] /= length;
      energy /= length;
    }
    let slope = 0;
    if (length > 1) {
      let meanX = 0;
      for (let j = startBar; j < endBar; j++) meanX += j;
      meanX /= length;
      let meanY = 0;
      for (let j = startBar; j < endBar; j++) meanY += E[j];
      meanY /= length;
      let numerator = 0, denominator = 0;
      for (let j = startBar; j < endBar; j++) {
        const dx = j - meanX;
        numerator += dx * (E[j] - meanY);
        denominator += dx * dx;
      }
      if (denominator > MFS_CONST.EPS) slope = numerator / denominator / barSecA;
    }
    sectionInfo.push({ startBar, endBar, meanV, energy, slope });
  }

  const representatives = [];
  let nextLabel = 0;
  for (let s = 0; s < sectionInfo.length; s++) {
    const info = sectionInfo[s];
    let best = -Infinity;
    let bestIndex = -1;
    for (let r = 0; r < representatives.length; r++) {
      const similarity = songCos(info.meanV, representatives[r].vector);
      if (similarity > best) {
        best = similarity;
        bestIndex = r;
      }
    }
    if (bestIndex >= 0 && best >= SONG_CONST.LABEL_SIM) {
      info.label = representatives[bestIndex].label;
    } else {
      info.label = _songLabel(nextLabel++);
      representatives.push({ label: info.label, vector: info.meanV });
    }
  }

  for (let s = 0; s < sectionInfo.length; s++) {
    const info = sectionInfo[s];
    let kind = 'main';
    if (s === 0 && info.energy < SONG_CONST.EDGE_MAX_ENERGY && sectionInfo.length >= 3) {
      kind = 'intro';
    } else if (s === sectionInfo.length - 1
      && info.energy < SONG_CONST.EDGE_MAX_ENERGY && sectionInfo.length >= 3) {
      kind = 'outro';
    } else if (s > 0 && s < sectionInfo.length - 1
      && info.energy <= SONG_CONST.BREAK_MAX_ENERGY
      && sectionInfo[s - 1].energy - info.energy >= SONG_CONST.BREAK_DROP) {
      kind = 'break';
    } else if (s < sectionInfo.length - 1
      && info.slope >= SONG_CONST.BUILD_SLOPE_PER_SEC
      && sectionInfo[s + 1].energy > info.energy) {
      kind = 'build';
    } else if (info.energy >= SONG_CONST.DROP_MIN_ENERGY
      && (s === 0 || info.energy - sectionInfo[s - 1].energy >= SONG_CONST.DROP_JUMP
        || sectionInfo[s - 1].kind === 'build')) {
      kind = 'drop';
    }
    info.kind = kind;
  }

  return sectionInfo.map((info) => ({
    startBar: info.startBar,
    endBar: info.endBar,
    startSec: bars[info.startBar].startSec,
    endSec: bars[info.endBar - 1].endSec,
    label: info.label,
    kind: info.kind,
    energy: info.energy,
    slopePerSec: info.slope,
  }));
}

// ── SongMap v1 の出力検証 ──

function validateSongMap(map) {
  const errors = [];
  const isArrayLike = (value) => Array.isArray(value) || ArrayBuffer.isView(value);
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const add = (condition, message) => { if (!condition) errors.push(message); };
  if (!map || typeof map !== 'object') return { ok: false, errors: ['map is not an object'] };
  add(map.version === 1, 'version must be 1');
  add(finite(map.durationSec) && map.durationSec >= 0, 'durationSec must be non-negative');
  add(finite(map.sampleRate) && map.sampleRate > 0, 'sampleRate must be positive');
  add(finite(map.bpm) && map.bpm > 0, 'bpm must be positive');
  add(finite(map.tempoConfidence) && map.tempoConfidence >= 0 && map.tempoConfidence <= 1,
    'tempoConfidence must be in [0, 1]');
  add(map.beatSource === 'grid' || map.beatSource === 'dp', 'beatSource must be grid or dp');
  add(isArrayLike(map.beats), 'beats must be an array');
  if (isArrayLike(map.beats)) {
    for (let i = 0; i < map.beats.length; i++) {
      add(finite(map.beats[i]), 'beats[' + i + '] must be finite');
      if (i > 0) add(map.beats[i] > map.beats[i - 1], 'beats must be strictly ascending');
      add(map.beats[i] >= 0, 'beats[' + i + '] must be non-negative');
      if (finite(map.durationSec)) add(map.beats[i] <= map.durationSec, 'beats[' + i + '] exceeds durationSec');
    }
  }
  add(isArrayLike(map.downbeatIndices), 'downbeatIndices must be an array');
  if (isArrayLike(map.downbeatIndices) && isArrayLike(map.beats)) {
    for (let i = 0; i < map.downbeatIndices.length; i++) {
      const index = map.downbeatIndices[i];
      add(Number.isInteger(index) && index >= 0 && index < map.beats.length,
        'downbeatIndices[' + i + '] is out of range');
      if (i > 0) add(index > map.downbeatIndices[i - 1], 'downbeatIndices must be ascending');
      if (i > 0) add(index - map.downbeatIndices[i - 1] === 4, 'downbeatIndices must advance by 4');
    }
  }
  add(isArrayLike(map.bars) && map.bars.length > 0, 'bars must not be empty');
  if (isArrayLike(map.bars)) {
    for (let i = 0; i < map.bars.length; i++) {
      const bar = map.bars[i];
      add(bar && finite(bar.startSec) && finite(bar.endSec), 'bars[' + i + '] times must be finite');
      if (bar && finite(bar.startSec) && finite(bar.endSec)) {
        add(bar.startSec >= 0 && bar.endSec <= map.durationSec && bar.endSec >= bar.startSec,
          'bars[' + i + '] time range is invalid');
        if (i === 0) add(bar.startSec === 0, 'bars must start at 0');
        if (i > 0) add(bar.startSec === map.bars[i - 1].endSec, 'bars must be contiguous');
      }
      add(bar && finite(bar.energy) && bar.energy >= 0 && bar.energy <= 1,
        'bars[' + i + '] energy must be in [0, 1]');
    }
    if (map.bars.length > 0) add(map.bars[map.bars.length - 1].endSec === map.durationSec,
      'bars must end at durationSec');
  }
  const kinds = new Set(['intro', 'build', 'drop', 'break', 'outro', 'main']);
  add(isArrayLike(map.sections) && map.sections.length > 0, 'sections must not be empty');
  if (isArrayLike(map.sections)) {
    for (let i = 0; i < map.sections.length; i++) {
      const section = map.sections[i];
      add(section && Number.isInteger(section.startBar) && Number.isInteger(section.endBar),
        'sections[' + i + '] bar range must be integers');
      if (section && Number.isInteger(section.startBar) && Number.isInteger(section.endBar)) {
        add(section.startBar >= 0 && section.endBar <= map.bars.length && section.endBar > section.startBar,
          'sections[' + i + '] bar range is invalid');
        if (i === 0) add(section.startBar === 0, 'sections must start at bar 0');
        if (i > 0) add(section.startBar === map.sections[i - 1].endBar, 'sections must be contiguous by bars');
      }
      add(section && finite(section.startSec) && finite(section.endSec),
        'sections[' + i + '] times must be finite');
      if (section && finite(section.startSec) && finite(section.endSec)) {
        add(section.startSec >= 0 && section.endSec <= map.durationSec && section.endSec >= section.startSec,
          'sections[' + i + '] time range is invalid');
        if (i === 0) add(section.startSec === 0, 'sections must start at 0 seconds');
        if (i > 0) add(section.startSec === map.sections[i - 1].endSec, 'sections must be contiguous in time');
      }
      add(typeof (section && section.label) === 'string' && section.label.length > 0,
        'sections[' + i + '] label is invalid');
      add(kinds.has(section && section.kind), 'sections[' + i + '] kind is invalid');
      add(finite(section && section.energy) && section.energy >= 0 && section.energy <= 1,
        'sections[' + i + '] energy must be in [0, 1]');
      add(finite(section && section.slopePerSec), 'sections[' + i + '] slopePerSec must be finite');
    }
    if (map.sections.length > 0) {
      const last = map.sections[map.sections.length - 1];
      add(last.endBar === map.bars.length, 'sections must end at the last bar');
      add(last.endSec === map.durationSec, 'sections must end at durationSec');
    }
  }
  return { ok: errors.length === 0, errors: errors };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SONG_CONST, SongMapError, buildSongMap,
    songZ, songCos, songPct,
    songOdf, songGlobalTempo, songDpBeats, songGridBeats, songDownbeats,
    songBars, songBoundaries, songSections, validateSongMap,
  };
}
