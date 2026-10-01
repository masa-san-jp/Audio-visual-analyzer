// MFS オンセット検出（対数スペクトラルフラックス＋適応閾値、4帯域群）— doc/20260928-plan-phase16-music-feature-stream.md §5.4
//
// AudioWorklet 内（別レルム）でも使うため、MFS_CONST と mfsDerived（js/mfs-const.js）以外の
// グローバルを参照しない自己完結の実装とする（js/mfs-worklet.js が toString() で埋め込む）。
// process() 内では配列・オブジェクトを生成しない（ガイド §9.3）。

class MfsOnset {
  // fftSize: 特徴用 FFT 長 N（A のビン数は N/2）
  constructor(sampleRate, fftSize) {
    const C = MFS_CONST;
    const d = mfsDerived(sampleRate);
    const G = C.ONSET_GROUPS.length;
    const K = fftSize / 2;
    this.groups = G;
    this.bins = K;
    this._hopSec = d.hopSec;
    this._aStat = d.alpha(C.ONSET_STAT_SEC);
    this._peakDecay = Math.exp(-d.hopSec / C.ONSET_PEAK_RELEASE_SEC);
    this._envDecay = Math.exp(-d.hopSec / C.ONSET_ENV_DECAY_SEC);

    // 帯域群のビン範囲 [lo, hi)。G_g = { k : lo_g ≤ k·binHz < hi_g }（連続区間）
    this._kLo = new Int32Array(G);
    this._kHi = new Int32Array(G);
    for (let g = 0; g < G; g++) {
      const f0 = C.ONSET_GROUPS[g][0], f1 = C.ONSET_GROUPS[g][1];
      let lo = K, hi = K;
      for (let k = 0; k < K; k++) {
        const fk = k * d.binHz;
        if (fk >= f0 && lo === K) lo = k;
        if (fk >= f1) { hi = k; break; }
      }
      this._kLo[g] = lo;
      this._kHi[g] = hi < lo ? lo : hi;
    }

    this._cPrev = new Float64Array(K);
    this._mu = new Float64Array(G);
    this._dev = new Float64Array(G);
    this._peak = new Float64Array(G);
    this._prevAbove = new Uint8Array(G);
    this._last = new Float64Array(G);
    this.flux = new Float32Array(G);
    this.env = new Float32Array(G);
    this.odf = 0;
    this.odfLow = 0;
    this.reset();
  }

  reset() {
    this._cPrev.fill(0);
    this._mu.fill(0);
    this._dev.fill(0);
    this._peak.fill(0);
    this._prevAbove.fill(0);
    this._last.fill(-Infinity);
    this.flux.fill(0);
    this.env.fill(0);
    this.odf = 0;
    this.odfLow = 0;
  }

  // A: 振幅スペクトル（長さ N/2）、tSec: ホップ完了時刻。戻り値: オンセットフラグ（bit g = 群 g）
  process(A, tSec) {
    const C = MFS_CONST;
    const cPrev = this._cPrev;
    const gamma = C.ONSET_LOG_GAMMA;
    const K = this.bins;

    // 1) 群ごとのフラックスを積算する（群は重なるため、cPrev は全群の計算後に更新する）
    let flags = 0;
    for (let g = 0; g < this.groups; g++) {
      const lo = this._kLo[g], hi = this._kHi[g];
      let sum = 0;
      for (let k = lo; k < hi; k++) {
        const diff = Math.log(1 + gamma * A[k]) - cPrev[k];
        if (diff > 0) sum += diff;
      }
      const n = hi - lo;
      const F = n > 0 ? sum / n : 0;
      this.flux[g] = F;

      // 閾値判定（更新前の μ, d）
      const mu = this._mu[g];
      const thr = mu + C.ONSET_K * this._dev[g] + C.ONSET_DELTA;
      const above = F > thr ? 1 : 0;
      if (above && !this._prevAbove[g] && (tSec - this._last[g] >= C.ONSET_REFRACTORY_SEC)) {
        this._last[g] = tSec;
        flags |= (1 << g);
      }
      this._prevAbove[g] = above;

      // 統計更新（d は更新後の μ を使う）
      const muNew = mu + this._aStat * (F - mu);
      this._mu[g] = muNew;
      this._dev[g] += this._aStat * (Math.abs(F - muNew) - this._dev[g]);

      // 強度と包絡（μold を使う）
      const rel = F - mu;
      const decayed = this._peak[g] * this._peakDecay;
      const peak = rel > decayed ? rel : decayed;
      this._peak[g] = peak;
      let s = 0;
      if (peak > C.EPS) {
        s = rel / peak;
        s = s < 0 ? 0 : (s > 1 ? 1 : s);
      }
      const e = this.env[g] * this._envDecay;
      this.env[g] = s > e ? s : e;

      if (g === 0) this.odfLow = rel > 0 ? rel : 0;
      if (g === this.groups - 1) this.odf = rel > 0 ? rel : 0;
    }

    // 2) 前ホップの C を更新
    for (let k = 0; k < K; k++) cPrev[k] = Math.log(1 + gamma * A[k]);
    return flags;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MfsOnset };
}
