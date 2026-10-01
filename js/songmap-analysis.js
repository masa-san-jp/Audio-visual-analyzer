// ソングマップ解析（前半: ① ODF・② 全体テンポ・③ DP 拍・④ 一定テンポ格子・⑤ 小節頭）— doc/20260928-plan-phase18-song-map-and-auto-director.md §4
//
// 純粋関数のみ（DOM・Web Audio に依存しない）。ファイル読込後に 1 回だけメインスレッドで実行する解析であり、
// 毎フレーム経路ではないため配列の新規確保を許す（計画書 §2 / §5、ガイド §9.3 の例外）。
// 決定的（乱数・時刻を使わない）。MFS_CONST / mfsDerived（js/mfs-const.js）を先に読み込んでおくこと。
// 後半（⑥ 小節〜⑨ 展開の種類、validateSongMap）は T18-04 でこのファイルの末尾（「後半」の位置）に追記する。

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

// §3 の行配置。js/mfs-const.js に SONGMAP_ROW があればそれを使い、無ければ §3 の表どおりの値を使う
function _songRow() {
  if (typeof SONGMAP_ROW !== 'undefined') return SONGMAP_ROW;
  return { FLUX: 0, BANDS: 4, CHROMA: 36, ENERGY: 48, LENGTH: 49 };
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
// sampleRate を渡すと、拍の秒（beats）への換算と「beats < 0 の拍を beats / beatHops の両方から除く」処理まで行う
// （buildSongMap はこの形で呼ぶ）。省略時は beatHops / beatSource のみを返す（段階単独のテスト用）。
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
  let beatHops = useGrid ? grid : dpBeats.slice();
  const out = { beatHops: beatHops, beatSource: useGrid ? 'grid' : 'dp', near: near };
  if (sampleRate !== undefined) {
    const d = mfsDerived(sampleRate);
    const hops = [], beats = [];
    for (let i = 0; i < beatHops.length; i++) {
      const sec = (beatHops[i] + 1) * d.hopSec - d.eventLatencySec;
      if (sec >= 0) { hops.push(beatHops[i]); beats.push(sec); }
    }
    out.beatHops = hops;
    out.beats = beats;
  }
  return out;
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
// ⑥〜⑨（bars・sections）と validateSongMap は T18-04 で後半に追記し、この関数の末尾で続きを呼ぶ。
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
  // ── 後半（T18-04）: ⑥〜⑨ をここから呼び、bars / sections を map に加えて返す ──
  return map;
}

// ── 後半（⑥〜⑨・validateSongMap）は T18-04 でここに追記する ──

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SONG_CONST, SongMapError, buildSongMap,
    songZ, songCos, songPct,
    songOdf, songGlobalTempo, songDpBeats, songGridBeats, songDownbeats,
  };
}
