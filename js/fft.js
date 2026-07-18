// AnalyserNode 互換のスペクトル解析（Phase 9.2）
//
// Web Audio API 仕様の AnalyserNode と同じ手順で周波数データを計算する:
//   Blackman窓（α=0.16）→ FFT（1/N 正規化）→ 時間平滑化（線形振幅のEMA）
//   → dB変換 → minDecibels/maxDecibels による byte マッピング（切り捨て・クランプ）
//
// AudioWorklet 内（別レルム）でも使うため、このクラスは外部関数・グローバルへ
// 依存しない自己完結の実装とする（js/analysis-worklet.js が toString() で
// ワークレットモジュールのソースへ埋め込む）。

class SpectrumAnalyzer {
  constructor(fftSize, smoothingTimeConstant, minDecibels, maxDecibels) {
    this.fftSize = fftSize;
    this.binCount = fftSize / 2;
    this.smoothing = Math.min(1, Math.max(0, smoothingTimeConstant != null ? smoothingTimeConstant : 0.8));
    this.minDecibels = minDecibels != null ? minDecibels : -100;
    this.maxDecibels = maxDecibels != null ? maxDecibels : -30;

    const N = fftSize;

    // Blackman窓（Web Audio 仕様: α=0.16 → a0=0.42, a1=0.5, a2=0.08）
    this._window = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      this._window[n] = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / N) + 0.08 * Math.cos(4 * Math.PI * n / N);
    }

    // ビット反転テーブル（Radix-2 Cooley-Tukey 用）
    let bits = 0;
    while ((1 << bits) < N) bits++;
    this._rev = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      let r = 0, x = i;
      for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      this._rev[i] = r;
    }

    // 前方DFT（e^{-j2πk/N}）の回転因子テーブル
    this._cosTab = new Float32Array(N / 2);
    this._sinTab = new Float32Array(N / 2);
    for (let k = 0; k < N / 2; k++) {
      this._cosTab[k] = Math.cos(-2 * Math.PI * k / N);
      this._sinTab[k] = Math.sin(-2 * Math.PI * k / N);
    }

    this._re = new Float32Array(N);
    this._im = new Float32Array(N);
    this._prevMag = new Float32Array(this.binCount); // 平滑化状態（線形振幅）
  }

  // timeData: 時系列順の直近 fftSize サンプル（Float32Array）
  // out: Uint8Array(binCount) — AnalyserNode.getByteFrequencyData 相当の値を書き込む
  // 呼び出しごとに平滑化状態が1ステップ進む（AnalyserNode の FFT 解析1回に相当）
  analyze(timeData, out) {
    const N = this.fftSize;
    const re = this._re, im = this._im, rev = this._rev, win = this._window;
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      re[i] = timeData[j] * win[j];
      im[i] = 0;
    }
    const cosTab = this._cosTab, sinTab = this._sinTab;
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const tableStep = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; k++) {
          const t = k * tableStep;
          const wr = cosTab[t], wi = sinTab[t];
          const i1 = start + k, i2 = i1 + half;
          const tr = re[i2] * wr - im[i2] * wi;
          const ti = re[i2] * wi + im[i2] * wr;
          re[i2] = re[i1] - tr; im[i2] = im[i1] - ti;
          re[i1] += tr; im[i1] += ti;
        }
      }
    }

    const tau = this.smoothing;
    const minDb = this.minDecibels;
    const range = this.maxDecibels - minDb;
    const prev = this._prevMag;
    const binCount = this.binCount;
    for (let k = 0; k < binCount; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N;
      const sm = tau * prev[k] + (1 - tau) * mag;
      prev[k] = sm;
      const db = 20 * Math.log10(sm); // sm=0 → -Infinity → 下でクランプされ 0 になる
      let v = Math.floor(255 * (db - minDb) / range);
      if (!(v > 0)) v = 0; else if (v > 255) v = 255;
      out[k] = v;
    }
  }

  // AnalyserNode.getByteTimeDomainData と同じマッピング
  // （128*(1+x) を 0..255 に切り捨て・クランプ）
  static timeDomainToBytes(timeData, out) {
    for (let i = 0; i < timeData.length; i++) {
      let v = Math.floor(128 * (timeData[i] + 1));
      if (!(v > 0)) v = 0; else if (v > 255) v = 255;
      out[i] = v;
    }
  }
}
