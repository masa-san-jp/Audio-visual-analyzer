// MFS 統合抽出器（ホップ分割と全特徴の統合）— doc/20260928-plan-phase16-music-feature-stream.md §5.0〜§5.9
//
// AudioWorklet 内（別レルム）でも使うため、MFS_CONST / MFS_LAYOUT / mfsDerived / mfsWindowHann /
// SpectrumAnalyzer / MfsFft / MfsMelBank / MfsBiquad / MfsOnset / MfsTempo 以外のグローバルを参照しない
// 自己完結の実装とする（js/mfs-worklet.js が toString() で埋め込む）。
// pushSamples・ホップ処理では配列・オブジェクトを生成しない（ガイド §9.3）。
// MfsTempo は API（§5.0）のみを使う。js/mfs-tempo.js が読み込まれていれば実物、なければ呼び出し側が用意した同 API の実装が使われる。

class MfsExtractor {
  // opts.smoothing: 従来互換 byte スペクトルの平滑化係数（既定 0.8）
  constructor(sampleRate, opts) {
    const C = MFS_CONST;
    const N = C.FFT_SIZE, H = C.HOP_SIZE, K = N / 2;
    const d = mfsDerived(sampleRate);
    this.sampleRate = sampleRate;
    this._d = d;
    this._smoothing = (opts && opts.smoothing != null) ? opts.smoothing : 0.8;

    // 公開フィールド（onHop 内でのみ有効）
    this.hopIndex = -1;
    this.hopEndSample = 0;
    this.packed = new Float32Array(MFS_LAYOUT.LENGTH);
    this.freqBytes = new Uint8Array(K);
    this.timeBytes = new Uint8Array(N);
    this.hopEnergy = 0;
    this.onHop = null;

    // 入力リング（N は 2 のべき乗）
    this._ringL = new Float64Array(N);
    this._ringR = new Float64Array(N);
    this._wp = 0;
    this._fill = 0;
    this._chronoL = new Float64Array(N);
    this._chronoR = new Float64Array(N);
    this._mono = new Float32Array(N);

    // FFT 作業領域・窓・メル
    this._fft = new MfsFft(N);
    this._win = mfsWindowHann(N);
    this._reL = new Float64Array(N); this._imL = new Float64Array(N);
    this._reR = new Float64Array(N); this._imR = new Float64Array(N);
    this._A = new Float64Array(K);
    this._P = new Float64Array(K);
    this._E = new Float32Array(C.MEL_BANDS);
    this._mel = new MfsMelBank(sampleRate, N);
    this._bandsSmooth = new Float64Array(C.MEL_BANDS);
    this._aAttack = d.alpha(C.BAND_ATTACK_SEC);
    this._aRelease = d.alpha(C.BAND_RELEASE_SEC);

    this._onset = new MfsOnset(sampleRate, N);
    this.flux = this._onset.flux;
    this._tempo = new MfsTempo(sampleRate);

    // ステレオ用の帯域群ビン範囲 [lo, hi)（low/mid/high。MfsOnset の G_g と同じ定義）
    this._gLo = new Int32Array(3);
    this._gHi = new Int32Array(3);
    for (let g = 0; g < 3; g++) {
      const f0 = C.ONSET_GROUPS[g][0], f1 = C.ONSET_GROUPS[g][1];
      let lo = K, hi = K;
      for (let k = 0; k < K; k++) {
        const fk = k * d.binHz;
        if (fk >= f0 && lo === K) lo = k;
        if (fk >= f1) { hi = k; break; }
      }
      this._gLo[g] = lo;
      this._gHi[g] = hi < lo ? lo : hi;
    }

    // 音色: FREQ_MIN_HZ ≤ fk ≤ FREQ_MAX_HZ のビン範囲 [tLo, tHi]
    let tLo = K, tHi = -1;
    for (let k = 0; k < K; k++) {
      const fk = k * d.binHz;
      if (fk >= C.FREQ_MIN_HZ && tLo === K) tLo = k;
      if (fk <= C.FREQ_MAX_HZ) tHi = k;
    }
    this._tLo = tLo; this._tHi = tHi;
    this._lnRange = Math.log(C.FREQ_MAX_HZ / C.FREQ_MIN_HZ);

    // クロマ: 各ビンのピッチクラス（範囲外 = -1）
    this._pc = new Int8Array(K);
    for (let k = 0; k < K; k++) {
      const fk = k * d.binHz;
      if (fk >= C.CHROMA_MIN_HZ && fk <= C.CHROMA_MAX_HZ) {
        this._pc[k] = ((Math.round(12 * Math.log2(fk / 440) + 69) % 12) + 12) % 12;
      } else {
        this._pc[k] = -1;
      }
    }
    this._chroma = new Float64Array(12);

    // ラウドネス: K 特性（L/R 独立の2段）
    const kwL = MfsBiquad.kWeighting(sampleRate);
    const kwR = MfsBiquad.kWeighting(sampleRate);
    this._kL1 = kwL[0]; this._kL2 = kwL[1];
    this._kR1 = kwR[0]; this._kR2 = kwR[1];
    this._sumL = 0; this._sumR = 0;
    this._nMom = d.frames(C.LOUD_MOMENTARY_SEC);
    this._nShort = d.frames(C.LOUD_SHORT_SEC);
    this._zRing = new Float64Array(this._nShort);
    this._zPos = 0;
    this._zCount = 0;
    this._agcDb = 0;
    this._aAgc = d.alpha(C.AGC_TIME_SEC);

    this._spectrum = null;
    this.reset();
  }

  // 全状態を初期値へ戻す（ホップ番号も -1 から数え直し）。onHop は保持する
  reset() {
    const C = MFS_CONST;
    this.hopIndex = -1;
    this.hopEndSample = 0;
    this.hopEnergy = 0;
    this._ringL.fill(0); this._ringR.fill(0);
    this._wp = 0; this._fill = 0;
    this._bandsSmooth.fill(0);
    this.packed.fill(0);
    this.freqBytes.fill(0);
    this.timeBytes.fill(0);
    this._onset.reset();
    this._tempo.reset();
    this._kL1.reset(); this._kL2.reset(); this._kR1.reset(); this._kR2.reset();
    this._sumL = 0; this._sumR = 0;
    this._zRing.fill(0); this._zPos = 0; this._zCount = 0;
    this._agcDb = 0;
    this._spectrum = new SpectrumAnalyzer(C.FFT_SIZE, 0, C.LEGACY_MIN_DB, C.LEGACY_MAX_DB);
    this.setSmoothing(this._smoothing);
  }

  // §5.2: tauHop = smoothing ^ (H·LEGACY_REF_FPS / sampleRate)
  setSmoothing(v) {
    const C = MFS_CONST;
    const s = v < 0 ? 0 : (v > 1 ? 1 : v);
    this._smoothing = s;
    this._spectrum.smoothing = s > 0 ? Math.pow(s, C.HOP_SIZE * C.LEGACY_REF_FPS / this.sampleRate) : 0;
  }

  // 現在の tauHop（§5.2。SpectrumAnalyzer.smoothing）。テスト・診断用
  get tauHop() { return this._spectrum.smoothing; }

  // L, R: 入力サンプル（先頭 count 個）。R が null なら L を使う
  pushSamples(L, R, count) {
    const H = MFS_CONST.HOP_SIZE;
    const mask = MFS_CONST.FFT_SIZE - 1;
    const rL = this._ringL, rR = this._ringR;
    const a1 = this._kL1, a2 = this._kL2, b1 = this._kR1, b2 = this._kR2;
    const rr = R || L;
    for (let i = 0; i < count; i++) {
      const l = L[i], r = rr[i];
      const wp = this._wp;
      rL[wp] = l; rR[wp] = r;
      this._wp = (wp + 1) & mask;
      const yl = a2.process(a1.process(l));
      const yr = b2.process(b1.process(r));
      this._sumL += yl * yl;
      this._sumR += yr * yr;
      if (++this._fill === H) {
        this._fill = 0;
        this._completeHop();
      }
    }
  }

  // §5.9 の順序でホップ h を処理する
  _completeHop() {
    const C = MFS_CONST, LY = MFS_LAYOUT;
    const N = C.FFT_SIZE, H = C.HOP_SIZE, K = N / 2, EPS = C.EPS;
    const d = this._d;
    const out = this.packed;
    const h = this.hopIndex + 1;
    this.hopIndex = h;
    this.hopEndSample = (h + 1) * H;
    const tSec = (h + 1) * H / this.sampleRate;

    // 1. chrono / mono
    const cL = this._chronoL, cR = this._chronoR, mono = this._mono;
    const rL = this._ringL, rR = this._ringR, mask = N - 1;
    const wp = this._wp;
    for (let n = 0; n < N; n++) {
      const idx = (wp + n) & mask;
      const l = rL[idx], r = rR[idx];
      cL[n] = l; cR[n] = r;
      mono[n] = 0.5 * (l + r);
    }

    // 2. 従来互換 byte
    this._spectrum.analyze(mono, this.freqBytes);
    SpectrumAnalyzer.timeDomainToBytes(mono, this.timeBytes);

    // 3. 特徴用 FFT・メル帯域
    const w = this._win, reL = this._reL, imL = this._imL, reR = this._reR, imR = this._imR;
    for (let n = 0; n < N; n++) {
      reL[n] = cL[n] * w[n]; imL[n] = 0;
      reR[n] = cR[n] * w[n]; imR[n] = 0;
    }
    this._fft.transform(reL, imL);
    this._fft.transform(reR, imR);
    const A = this._A, P = this._P;
    const scale = 2 / K;
    for (let k = 0; k < K; k++) {
      const a = Math.sqrt((reL[k] + reR[k]) * (reL[k] + reR[k]) + (imL[k] + imR[k]) * (imL[k] + imR[k])) * scale / 2;
      A[k] = a;
      P[k] = a * a;
    }
    this._mel.apply(P, this._E);
    const E = this._E, bs = this._bandsSmooth;
    const dbSpan = C.BAND_DB_CEIL - C.BAND_DB_FLOOR;
    for (let b = 0; b < C.MEL_BANDS; b++) {
      let v = (10 * Math.log10(E[b] + EPS) - C.BAND_DB_FLOOR) / dbSpan;
      v = v < 0 ? 0 : (v > 1 ? 1 : v);
      const cur = bs[b];
      bs[b] = cur + (v > cur ? this._aAttack : this._aRelease) * (v - cur);
      out[LY.BANDS + b] = v;
      out[LY.BANDS_SMOOTH + b] = bs[b];
    }

    // 4. オンセット
    const flags = this._onset.process(A, tSec);
    const env = this._onset.env;
    for (let g = 0; g < 4; g++) out[LY.ONSET_ENV + g] = env[g];
    out[LY.ONSET_FLAGS] = flags;

    // 5. テンポ（odf・odfLow の蓄積から位相・小節まで MfsTempo が行う）
    const tempo = this._tempo;
    tempo.process(this._onset.odf, this._onset.odfLow, flags, env[3], tSec);
    if (tempo.locked) {
      out[LY.BPM] = tempo.bpm;
      out[LY.TEMPO_CONF] = tempo.conf;
      out[LY.BEAT_PHASE] = tempo.phase;
      out[LY.BAR_PHASE] = tempo.barPhase;
      out[LY.BEAT_IN_BAR] = tempo.beatInBar;
      out[LY.BEAT_FLAG] = tempo.beatFlag ? 1 : 0;
      out[LY.DOWNBEAT_FLAG] = tempo.downbeatFlag ? 1 : 0;
      out[LY.TEMPO_LOCKED] = 1;
    } else {
      out[LY.BPM] = 0;
      out[LY.TEMPO_CONF] = tempo.conf;
      out[LY.BEAT_PHASE] = 0;
      out[LY.BAR_PHASE] = 0;
      out[LY.BEAT_IN_BAR] = 0;
      out[LY.BEAT_FLAG] = 0;
      out[LY.DOWNBEAT_FLAG] = 0;
      out[LY.TEMPO_LOCKED] = 0;
    }

    // 6. ステレオ
    let EL = 0, ER = 0, ELR = 0, EM = 0, ES = 0;
    for (let n = 0; n < N; n++) {
      const l = cL[n], r = cR[n];
      EL += l * l; ER += r * r; ELR += l * r;
      const m = 0.5 * (l + r), s = 0.5 * (l - r);
      EM += m * m; ES += s * s;
    }
    let corr = EL * ER > EPS ? ELR / Math.sqrt(EL * ER) : 0;
    corr = corr < -1 ? -1 : (corr > 1 ? 1 : corr);
    out[LY.STEREO_CORR] = corr;
    out[LY.STEREO_WIDTH] = EM + ES > EPS ? ES / (EM + ES) : 0;
    let bal = EL + ER > EPS ? (ER - EL) / (ER + EL) : 0;
    bal = bal < -1 ? -1 : (bal > 1 ? 1 : bal);
    out[LY.STEREO_BALANCE] = bal;
    for (let g = 0; g < 3; g++) {
      let sl = 0, sr = 0;
      for (let k = this._gLo[g], hi = this._gHi[g]; k < hi; k++) {
        const al = Math.sqrt(reL[k] * reL[k] + imL[k] * imL[k]) * scale;
        const ar = Math.sqrt(reR[k] * reR[k] + imR[k] * imR[k]) * scale;
        sl += al * al; sr += ar * ar;
      }
      out[LY.STEREO_PAN + g] = sl + sr > EPS ? (sr - sl) / (sr + sl) : 0;
    }

    // 6'. 音色
    const tLo = this._tLo, tHi = this._tHi, binHz = d.binHz;
    let Ptot = 0, wsum = 0, lnSum = 0;
    for (let k = tLo; k <= tHi; k++) {
      const p = P[k];
      Ptot += p; wsum += k * binHz * p; lnSum += Math.log(p + EPS);
    }
    if (Ptot <= EPS || tHi < tLo) {
      out[LY.CENTROID] = 0; out[LY.FLATNESS] = 0; out[LY.ROLLOFF] = 0;
    } else {
      const cnt = tHi - tLo + 1;
      out[LY.CENTROID] = this._lognorm(wsum / Ptot);
      let fl = Math.exp(lnSum / cnt) / (Ptot / cnt + EPS);
      fl = fl < 0 ? 0 : (fl > 1 ? 1 : fl);
      out[LY.FLATNESS] = fl;
      const target = C.ROLLOFF_FRACTION * Ptot;
      let acc = 0, rk = tHi;
      for (let k = tLo; k <= tHi; k++) {
        acc += P[k];
        if (acc >= target) { rk = k; break; }
      }
      out[LY.ROLLOFF] = this._lognorm(rk * binHz);
    }

    // 6''. クロマ
    const chroma = this._chroma, pc = this._pc;
    chroma.fill(0);
    for (let k = 0; k < K; k++) {
      const c = pc[k];
      if (c >= 0) chroma[c] += A[k];
    }
    let cmax = 0;
    for (let i = 0; i < 12; i++) if (chroma[i] > cmax) cmax = chroma[i];
    for (let i = 0; i < 12; i++) out[LY.CHROMA + i] = cmax > EPS ? chroma[i] / cmax : 0;

    // RMS / PEAK
    let ss = 0, pk = 0;
    for (let n = 0; n < N; n++) {
      const v = mono[n];
      ss += v * v;
      const a = v < 0 ? -v : v;
      if (a > pk) pk = a;
    }
    const rms = Math.sqrt(ss / N);
    out[LY.RMS] = rms > 1 ? 1 : rms;
    out[LY.PEAK] = pk > 1 ? 1 : pk;

    // 7. ラウドネス・AGC
    const z = (this._sumL + this._sumR) / H;
    this._sumL = 0; this._sumR = 0;
    this._zRing[this._zPos] = z;
    this._zPos = (this._zPos + 1) % this._nShort;
    if (this._zCount < this._nShort) this._zCount++;
    const cnt = this._zCount;
    const nShort = this._nShort;
    const nMom = cnt < this._nMom ? cnt : this._nMom;
    let sMom = 0, sShort = 0;
    for (let i = 0; i < cnt; i++) {
      const v = this._zRing[((this._zPos - 1 - i) % nShort + nShort) % nShort];
      sShort += v;
      if (i < nMom) sMom += v;
    }
    const lm = C.LOUD_OFFSET + 10 * Math.log10(sMom / nMom + EPS);
    const ls = C.LOUD_OFFSET + 10 * Math.log10(sShort / cnt + EPS);
    out[LY.LOUD_MOMENTARY] = lm;
    out[LY.LOUD_SHORT] = ls;
    let level = (lm - C.LEVEL_FLOOR_LUFS) / (-C.LEVEL_FLOOR_LUFS);
    out[LY.LEVEL] = level < 0 ? 0 : (level > 1 ? 1 : level);
    if (ls >= C.AGC_SILENCE_LUFS) {
      let target = C.AGC_TARGET_LUFS - ls;
      target = target < C.AGC_MIN_DB ? C.AGC_MIN_DB : (target > C.AGC_MAX_DB ? C.AGC_MAX_DB : target);
      this._agcDb += this._aAgc * (target - this._agcDb);
    }
    out[LY.AGC_DB] = this._agcDb;

    // 8. 通知
    this.hopEnergy = z;
    if (this.onHop) this.onHop(this);
  }

  // log(f/FREQ_MIN)/log(FREQ_MAX/FREQ_MIN) を 0..1 にクランプ
  _lognorm(f) {
    const v = Math.log(f / MFS_CONST.FREQ_MIN_HZ) / this._lnRange;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MfsExtractor };
}
