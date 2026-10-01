// MFS テンポ・拍位相・小節頭の推定（自己相関＋ヒステリシス＋PLL、4/4 固定）— doc/20260928-plan-phase16-music-feature-stream.md §5.5
//
// AudioWorklet 内（別レルム）でも使うため、MFS_CONST と mfsDerived（js/mfs-const.js）以外の
// グローバルを参照しない自己完結の実装とする（js/mfs-worklet.js が toString() で埋め込む）。
// process() 内（推定を含む）では配列・オブジェクトを生成しない。バッファは constructor で確保する（ガイド §9.3）。

class MfsTempo {
  constructor(sampleRate) {
    const C = MFS_CONST;
    const d = mfsDerived(sampleRate);
    this._fr = d.fr;
    this._hopSec = d.hopSec;
    this._latency = d.eventLatencySec;
    this._size = d.frames(C.TEMPO_BUFFER_SEC);
    this._minFill = d.frames(C.TEMPO_MIN_FILL_SEC);
    this._updateHops = d.frames(C.TEMPO_UPDATE_SEC);

    // odf / odfLow のリング（書き込み位置 _head、蓄積数 _count）
    this._odf = new Float64Array(this._size);
    this._odfLow = new Float64Array(this._size);
    // 推定時に時系列順（[L-1] が最新）へ並べ直した作業領域
    this._x = new Float64Array(this._size);
    this._xl = new Float64Array(this._size);
    this._xt = new Float64Array(this._size);
    this._ri = new Float64Array(this._size + 1);

    // 候補テンポ表（k 番目: MIN + k·STEP。乗算で求める）。τ(b) と事前分布 W(b) は構築時に1回だけ計算する
    const nCand = Math.floor((C.TEMPO_SEARCH_MAX_BPM - C.TEMPO_SEARCH_MIN_BPM) / C.TEMPO_GRID_STEP_BPM + 1e-9) + 1;
    this._nCand = nCand;
    this._candBpm = new Float64Array(nCand);
    this._candTau = new Float64Array(nCand);
    this._candW = new Float64Array(nCand);
    for (let k = 0; k < nCand; k++) {
      const b = C.TEMPO_SEARCH_MIN_BPM + k * C.TEMPO_GRID_STEP_BPM;
      const z = Math.log(b / C.TEMPO_PRIOR_CENTER_BPM) / Math.LN2 / C.TEMPO_PRIOR_SIGMA_OCT;
      this._candBpm[k] = b;
      this._candTau[k] = 60 * d.fr / b;
      this._candW[k] = Math.exp(-0.5 * z * z);
    }
    // 自己相関を計算する最大ラグ（r(j·τ) に必要な範囲）
    this._maxLagWanted = Math.ceil(C.TEMPO_HARMONICS * 60 * d.fr / C.TEMPO_SEARCH_MIN_BPM) + 1;

    this._acc = new Float64Array(C.BAR_BEATS);

    this.bpm = 0;
    this.conf = 0;
    this.phase = 0;
    this.barPhase = 0;
    this.beatInBar = 0;
    this.beatFlag = 0;
    this.downbeatFlag = 0;
    this.locked = 0;
    this.reset();
  }

  reset() {
    this._odf.fill(0);
    this._odfLow.fill(0);
    this._x.fill(0);
    this._xl.fill(0);
    this._xt.fill(0);
    this._ri.fill(0);
    this._head = 0;
    this._count = 0;
    this._L = 0;
    this._sinceUpdate = 0;
    this._pending = 0;
    this._pendingCount = 0;
    this._lastBeatSec = -Infinity;
    this._beatCount = 0;
    this._barStart = 0;
    this._barPending = 0;   // 小節蓄積中なら、発行ホップから数えたホップ数（0 は蓄積なし）
    this._barSlot = 0;
    this._barV = 0;
    this._acc.fill(0);
    this._estBpm = 0;       // 直近の推定のうち fold 後の候補 c
    this._estConf = 0;
    this.bpm = 0;
    this.conf = 0;
    this.phase = 0;
    this.barPhase = 0;
    this.beatInBar = 0;
    this.beatFlag = 0;
    this.downbeatFlag = 0;
    this.locked = 0;
  }

  // odf / odfLow: MfsOnset の出力、onsetFlags: そのホップのフラグ（bit3 = full）、envFull: ONSET_ENV[3]、tSec: ホップ完了時刻
  process(odf, odfLow, onsetFlags, envFull, tSec) {
    const C = MFS_CONST;
    this.beatFlag = 0;
    this.downbeatFlag = 0;

    // a. リングへ格納してから推定する
    this._odf[this._head] = odf;
    this._odfLow[this._head] = odfLow;
    this._head = this._head + 1 === this._size ? 0 : this._head + 1;
    if (this._count < this._size) this._count++;

    // b. 推定の間隔と蓄積量の判定
    this._sinceUpdate++;
    if (this._sinceUpdate >= this._updateHops && this._count >= this._minFill) {
      this._estimate();
      this._update();
      this._sinceUpdate = 0;
    }

    // c. 位相の進行と補正、小節
    if (this.locked) {
      this._advance(odfLow, onsetFlags, envFull, tSec);
      this.barPhase = (this.beatInBar + this.phase) / C.BAR_BEATS;
    } else {
      this.phase = 0;
      this.barPhase = 0;
      this.beatInBar = 0;
    }
  }

  // §5.5.1 テンポ推定。結果は _estBpm（fold 後 c）・_estConf に入れる
  _estimate() {
    const C = MFS_CONST;
    const size = this._size;
    const L = this._count;
    this._L = L;
    const start = this._head - L;   // 最古サンプルのリング位置（負なら折り返す）
    const x = this._x, xl = this._xl, xt = this._xt, ri = this._ri;
    let mean = 0;
    for (let i = 0; i < L; i++) {
      let p = start + i;
      if (p < 0) p += size;
      x[i] = this._odf[p];
      xl[i] = this._odfLow[p];
      mean += x[i];
    }
    mean /= L;
    for (let i = 0; i < L; i++) xt[i] = x[i] - mean;

    const maxLag = Math.min(L - 1, this._maxLagWanted);
    for (let tau = 0; tau <= maxLag; tau++) {
      let s = 0;
      for (let t = tau; t < L; t++) s += xt[t] * xt[t - tau];
      ri[tau] = s / (L - tau);
    }

    let bestScore = -Infinity, bestK = 0;
    for (let k = 0; k < this._nCand; k++) {
      const tau = this._candTau[k];
      let S = 0;
      for (let j = 1; j <= C.TEMPO_HARMONICS; j++) S += this._r(j * tau, L) / j;
      S += C.TEMPO_HALF_WEIGHT * this._r(tau / 2, L);
      const score = this._candW[k] * S;
      if (score > bestScore) { bestScore = score; bestK = k; }   // 同値は小さい b
    }

    const bStar = this._candBpm[bestK];
    let conf = 0;
    if (ri[0] > C.EPS) {
      conf = this._r(this._candTau[bestK], L) / ri[0];
      conf = conf < 0 ? 0 : (conf > 1 ? 1 : conf);
    }
    let c = bStar;
    while (c < C.TEMPO_FOLD_MIN_BPM) c *= 2;
    while (c >= C.TEMPO_FOLD_MAX_BPM) c /= 2;
    this._estBpm = c;
    this._estConf = conf;
  }

  // 実数ラグの自己相関（線形補間）。τ ≥ L-1 なら 0
  _r(tau, L) {
    if (tau >= L - 1) return 0;
    const a = Math.floor(tau);
    const f = tau - a;
    return this._ri[a] * (1 - f) + this._ri[a + 1] * f;
  }

  // §5.5.2 テンポの確定・更新（ヒステリシス）
  _update() {
    const C = MFS_CONST;
    const conf = this._estConf;
    const c = this._estBpm;
    this.conf = conf;   // 推定を実行したときに更新する
    if (conf < C.TEMPO_MIN_CONF) return;

    if (this.bpm === 0) {
      this._pendingStep(c);
      if (this._pendingCount >= C.TEMPO_LOCK_COUNT) {
        this.bpm = c;
        this.locked = 1;
        this._setInitialPhase();
        this._resetBar();
        this._pending = 0;
      }
    } else if (this._same(c, this.bpm)) {
      this.bpm = (1 - C.TEMPO_REFINE_WEIGHT) * this.bpm + C.TEMPO_REFINE_WEIGHT * c;
      this._pending = 0;
      this._pendingCount = 0;
    } else {
      this._pendingStep(c);
      if (this._pendingCount >= C.TEMPO_SWITCH_COUNT) {
        this.bpm = c;
        this._setInitialPhase();
        this._resetBar();
        this._pending = 0;
      }
    }
  }

  // same(a, b) = |a-b|/b ≤ TEMPO_SAME_TOL。b = 0 は常に偽
  _same(a, b) {
    return b > 0 && Math.abs(a - b) / b <= MFS_CONST.TEMPO_SAME_TOL;
  }

  _pendingStep(c) {
    if (this._same(c, this._pending)) {
      this._pendingCount++;
    } else {
      this._pending = c;
      this._pendingCount = 1;
    }
  }

  _resetBar() {
    this._acc.fill(0);
    this._barStart = 0;
    this._barPending = 0;
    this._beatCount = 0;
    this.beatInBar = 0;
  }

  // くし形の和 s(o) = Σ_n v[L-1-round(o+n·τ)]（添字 ≥ 0 の範囲のみ）
  _comb(v, o, tau, L) {
    let s = 0;
    for (let n = 0; ; n++) {
      const idx = Math.round(o + n * tau);
      if (idx > L - 1) break;
      s += v[L - 1 - idx];
    }
    return s;
  }

  // §5.5.3 初期位相（x / xl は _estimate で時系列順に並べ済み）
  _setInitialPhase() {
    const C = MFS_CONST;
    const L = this._L;
    const tau = 60 * this._fr / this.bpm;
    const nO = Math.floor(tau);
    let bestO = 0, bestS = -Infinity;
    for (let o = 0; o < nO; o++) {
      const s = this._comb(this._x, o, tau, L);
      if (s > bestS) { bestS = s; bestO = o; }   // 同値は小さい o
    }
    let oStar = bestO;
    // 半拍ずれの判定（低域 ODF）
    let oHalf = oStar + tau / 2;
    if (oHalf >= tau) oHalf -= tau;
    const sLStar = this._comb(this._xl, oStar, tau, L);
    const sLHalf = this._comb(this._xl, oHalf, tau, L);
    if (sLHalf > C.PHASE_DISAMBIG_RATIO * sLStar) oStar = oHalf;

    let ph = (oStar * this._hopSec + this._latency) * this.bpm / 60;
    ph -= Math.floor(ph);
    this.phase = ph;
    this._beatCount = 0;
  }

  // §5.5.4 位相の進行と補正、§5.5.5 小節
  _advance(odfLow, onsetFlags, envFull, tSec) {
    const C = MFS_CONST;
    // 小節蓄積（発行ホップに続く各ホップ）
    if (this._barPending > 0) {
      if (odfLow > this._barV) this._barV = odfLow;
      this._barPending++;
      if (this._barPending >= C.BAR_ACCUM_HOPS) this._finishBar();
    }

    const bpmHz = this.bpm / 60;
    this.phase += this._hopSec * bpmHz;
    if (this.phase >= 1) {
      this.phase -= 1;
      this._emitBeat(tSec);
    }
    if (onsetFlags & 8) {
      const po = this.phase - this._latency * bpmHz;
      const e = po - Math.round(po);
      if (Math.abs(e) <= C.PLL_WINDOW) {
        this.phase -= C.PLL_GAIN * envFull * e;
        if (this.phase >= 1) {
          this.phase -= 1;
          this._emitBeat(tSec);
        }
        if (this.phase < 0) this.phase += 1;   // 直前に発行済みのため再発行しない
      }
    }
  }

  _emitBeat(tSec) {
    const C = MFS_CONST;
    if (tSec - this._lastBeatSec < C.BEAT_MIN_INTERVAL_FRAC * 60 / this.bpm) return;   // 位相の巻き戻しのみ
    this.beatFlag = 1;
    this._lastBeatSec = tSec;
    this._beatCount++;
    if (this._barPending > 0) this._finishBar();   // 通常は起きない（拍間隔 > 蓄積ホップ数）
    const slot = (this._beatCount - 1) % C.BAR_BEATS;
    // 直近 BAR_LOOKBACK_HOPS ホップ（このホップを含む）の odfLow の最大値
    let v = 0;
    let p = this._head;
    for (let i = 0; i < C.BAR_LOOKBACK_HOPS && i < this._count; i++) {
      p = p === 0 ? this._size - 1 : p - 1;
      if (this._odfLow[p] > v) v = this._odfLow[p];
    }
    this._barSlot = slot;
    this._barV = v;
    this._barPending = 1;
    if (this._barPending >= C.BAR_ACCUM_HOPS) this._finishBar();

    let bib = ((this._beatCount - 1) - this._barStart) % C.BAR_BEATS;
    if (bib < 0) bib += C.BAR_BEATS;
    this.beatInBar = bib;
    if (bib === 0) this.downbeatFlag = 1;
  }

  // 蓄積の確定: 加算するスロットだけに減衰を掛け、最大のスロットを小節頭とする
  _finishBar() {
    const C = MFS_CONST;
    const acc = this._acc;
    acc[this._barSlot] = C.BAR_DECAY * acc[this._barSlot] + this._barV;
    let best = 0;
    for (let i = 1; i < C.BAR_BEATS; i++) if (acc[i] > acc[best]) best = i;   // 同値は小さい添字
    this._barStart = best;
    this._barPending = 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MfsTempo };
}
