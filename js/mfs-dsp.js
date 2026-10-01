// MFS の DSP 部品（Hann 窓・基数2 FFT・メル帯域・K 特性バイカッド）— doc/20260928-plan-phase16-music-feature-stream.md §5.0 / §5.3 / §5.8
//
// AudioWorklet 内（別レルム）でも使うため、ここのクラス・関数は MFS_CONST と
// mfsDerived（js/mfs-const.js）以外のグローバルを参照しない自己完結の実装とする
// （js/mfs-worklet.js が toString() でワークレットソースへ埋め込む）。

// Hann 窓: w[n] = 0.5 - 0.5*cos(2πn/N)（Σw = N/2）
function mfsWindowHann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  return w;
}

// 基数2 FFT（前方・in-place・1/N 正規化なし）。内部演算は倍精度
class MfsFft {
  constructor(n) {
    let bits = 0;
    while ((1 << bits) < n) bits++;
    if ((1 << bits) !== n) throw new Error('MfsFft: n must be a power of 2');
    this.n = n;
    this._rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      this._rev[i] = r;
    }
    this._cos = new Float64Array(n / 2);
    this._sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this._cos[k] = Math.cos(-2 * Math.PI * k / n);
      this._sin[k] = Math.sin(-2 * Math.PI * k / n);
    }
  }

  // re, im: Float64Array(n)。X[k] = Σ x[n]·e^{-j2πkn/N}
  transform(re, im) {
    const n = this.n, rev = this._rev, cosT = this._cos, sinT = this._sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const t = k * step;
          const wr = cosT[t], wi = sinT[t];
          const i1 = start + k, i2 = i1 + half;
          const tr = re[i2] * wr - im[i2] * wi;
          const ti = re[i2] * wi + im[i2] * wr;
          re[i2] = re[i1] - tr; im[i2] = im[i1] - ti;
          re[i1] += tr; im[i1] += ti;
        }
      }
    }
  }
}

// メルフィルタバンク（計画書 §5.3）。三角フィルタを構築時に1回計算する
class MfsMelBank {
  constructor(sampleRate, fftSize) {
    const B = MFS_CONST.MEL_BANDS;
    const K = fftSize / 2;
    const binHz = sampleRate / fftSize;
    const mel = function (f) { return 2595 * Math.log10(1 + f / 700); };
    const inv = function (m) { return 700 * (Math.pow(10, m / 2595) - 1); };
    const m0 = mel(MFS_CONST.FREQ_MIN_HZ);
    const m1 = mel(MFS_CONST.FREQ_MAX_HZ);
    const edge = new Float64Array(B + 2);
    for (let i = 0; i < B + 2; i++) edge[i] = inv(m0 + i * (m1 - m0) / (B + 1));

    this.bands = B;
    this.lowHz = new Float64Array(B);
    this.centerHz = new Float64Array(B);
    this.highHz = new Float64Array(B);
    this._start = new Int32Array(B);   // 重みを持つ最初のビン
    this._count = new Int32Array(B);   // 重みを持つビン数（0 = 中心ビン代替）
    this._sub = new Int32Array(B);     // 代替用の中心ビン
    this._offset = new Int32Array(B);  // _w 内の開始位置
    const ws = [];
    let total = 0;
    for (let b = 0; b < B; b++) {
      const lo = edge[b], c = edge[b + 1], hi = edge[b + 2];
      this.lowHz[b] = lo; this.centerHz[b] = c; this.highHz[b] = hi;
      let sub = Math.round(c / binHz);
      if (sub > K - 1) sub = K - 1;
      this._sub[b] = sub;
      let first = -1, last = -1;
      const row = [];
      for (let k = 0; k < K; k++) {
        const f = k * binHz;
        let w = 0;
        if (f > lo && f <= c) w = (f - lo) / (c - lo);
        else if (f > c && f < hi) w = (hi - f) / (hi - c);
        if (w > 0) {
          if (first < 0) first = k;
          last = k;
        }
        row.push(w);
      }
      if (first < 0) {
        this._start[b] = 0; this._count[b] = 0; this._offset[b] = total;
      } else {
        this._start[b] = first; this._count[b] = last - first + 1; this._offset[b] = total;
        for (let k = first; k <= last; k++) ws.push(row[k]);
        total += last - first + 1;
      }
    }
    this._w = new Float64Array(ws);
    this._wsum = new Float64Array(B);
    for (let b = 0; b < B; b++) {
      let s = 0;
      for (let j = 0; j < this._count[b]; j++) s += this._w[this._offset[b] + j];
      this._wsum[b] = s;
    }
  }

  // P: パワー（長さ N/2）、out: Float32Array(B) に E_b を書く
  apply(P, out) {
    for (let b = 0; b < this.bands; b++) {
      const n = this._count[b];
      const s = this._wsum[b];
      if (n === 0 || !(s > 0)) { out[b] = P[this._sub[b]]; continue; }
      const start = this._start[b], off = this._offset[b], w = this._w;
      let acc = 0;
      for (let j = 0; j < n; j++) acc += w[off + j] * P[start + j];
      out[b] = acc / s;
    }
  }

  // 重み合計（テスト・診断用）。0 の帯域は中心ビン代替が働く
  weightSum(b) { return this._wsum[b]; }
}

// 2次IIR（転置直接形 II・倍精度）。K 特性（ITU-R BS.1770）の2段を kWeighting が返す（計画書 §5.8）
class MfsBiquad {
  constructor(b0, b1, b2, a1, a2) {
    this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2;
    this.z1 = 0; this.z2 = 0;
  }

  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset() { this.z1 = 0; this.z2 = 0; }

  // → [stage1(ハイシェルフ), stage2(ハイパス)]。libebur128 と同じ導出式
  static kWeighting(sampleRate) {
    const C = MFS_CONST;
    const PI = Math.PI;
    let K = Math.tan(PI * C.KW_SHELF_F0 / sampleRate);
    const Q1 = C.KW_SHELF_Q;
    const Vh = Math.pow(10, C.KW_SHELF_GAIN_DB / 20);
    const Vb = Math.pow(Vh, C.KW_SHELF_VB_EXPONENT);
    let a0 = 1 + K / Q1 + K * K;
    const s1 = new MfsBiquad(
      (Vh + Vb * K / Q1 + K * K) / a0,
      2 * (K * K - Vh) / a0,
      (Vh - Vb * K / Q1 + K * K) / a0,
      2 * (K * K - 1) / a0,
      (1 - K / Q1 + K * K) / a0
    );
    K = Math.tan(PI * C.KW_HP_F0 / sampleRate);
    const Q2 = C.KW_HP_Q;
    a0 = 1 + K / Q2 + K * K;
    const s2 = new MfsBiquad(1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q2 + K * K) / a0);
    return [s1, s2];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mfsWindowHann, MfsFft, MfsMelBank, MfsBiquad };
}
