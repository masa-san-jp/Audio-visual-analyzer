// Phase 6 共通ユーティリティ — doc/spec-phase6.md §5
// すべて純関数/純クラス。DOM/Canvas に依存しない（単体テスト対象）。

// ── 数学系 ── §5.3
function clamp(v, min, max) {
  return v < min ? min : (v > max ? max : v);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 平行投影の既定係数
const ISO_KX = 0.5;
const ISO_KY = 0.35;
function isoProject(x, y, z, kx = ISO_KX, ky = ISO_KY) {
  return { x: x + z * kx, y: y - z * ky };
}

// ── 色 ── 全レンダラー共通の HSL 決定則
// 振幅 amp(0..1) と設定から HSL 文字列を返す。
// hueRange: 振幅に応じた色相の広がり幅、brightness/saturation は設定パーセント。
// 既存レンダラー（bars.js 等）と同一の HSL 決定則:
//   h = (baseHue + amp*hueRange) % 360, s = saturation, l = brightness*(0.3 + 0.7*amp)
function makeColor(baseHue, amp, settings, alpha = 1) {
  const hueRange = settings.hueRange || 0;
  const hue = ((baseHue + hueRange * amp) % 360 + 360) % 360;
  const sat = clamp(settings.saturation != null ? settings.saturation : 100, 0, 100);
  const briMax = settings.brightness != null ? settings.brightness : 80;
  const light = clamp(briMax * (0.3 + 0.7 * amp), 0, 100);
  if (alpha >= 1) return `hsl(${hue.toFixed(1)},${sat}%,${light.toFixed(1)}%)`;
  return `hsla(${hue.toFixed(1)},${sat}%,${light.toFixed(1)}%,${alpha})`;
}

// ── 決定的乱数 ──
// seed から決定的な 0..1 乱数列を返すクロージャ（Mulberry32）
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Spring（バネ・粘性） ── §5.2
// physicsAmount(0..10) を stiffness/damping にマップ
function springParamsFromAmount(amount) {
  const a = clamp(amount, 0, 10);
  // amount=0 は即時追従（バイパス）を意味する
  const stiffness = lerp(0.9, 0.08, a / 10); // 高いほど速く追従
  const damping = lerp(1.0, 0.55, a / 10);   // 低いほどオーバーシュート
  return { stiffness, damping, bypass: a <= 0 };
}
class SpringArray {
  constructor(n, params) {
    this.n = n;
    this.value = new Float32Array(n);
    this.vel = new Float32Array(n);
    this._target = new Float32Array(n);
    this.k = params ? params.stiffness : 0.3;
    this.d = params ? params.damping : 0.7;
    this.bypass = params ? params.bypass : false;
  }
  configure(params) { this.k = params.stiffness; this.d = params.damping; this.bypass = params.bypass; }
  resize(n) {
    if (n === this.n) return;
    this.n = n;
    this.value = new Float32Array(n);
    this.vel = new Float32Array(n);
    this._target = new Float32Array(n);
  }
  setTarget(i, v) { this._target[i] = v; }
  update(dtMs) {
    if (this.bypass) {
      this.value.set(this._target);
      this.vel.fill(0);
      return;
    }
    const dt = clamp((dtMs || 16.7) / 16.7, 0, 2);
    const damp = Math.pow(this.d, dt);
    for (let i = 0; i < this.n; i++) {
      const force = (this._target[i] - this.value[i]) * this.k;
      this.vel[i] = (this.vel[i] + force) * damp;
      this.value[i] += this.vel[i] * dt;
    }
  }
}

// ── BeatDetector ── §5.4
class BeatDetector {
  constructor() {
    this.ema = 0;
    this.lastBeatMs = -1e9;
    this.initialized = false;
  }
  update(freq, nowMs) {
    if (!freq || freq.length === 0) return { isBeat: false, energy: 0, sinceBeatMs: nowMs - this.lastBeatMs };
    // 低域（先頭 1/8）の平均振幅
    const n = Math.max(1, Math.floor(freq.length / 8));
    let sum = 0;
    for (let i = 0; i < n; i++) sum += freq[i];
    const e = sum / n;
    if (!this.initialized) { this.ema = e; this.initialized = true; }
    const isBeat = e > this.ema * 1.4 && (nowMs - this.lastBeatMs) >= 200;
    if (isBeat) this.lastBeatMs = nowMs;
    // EMA 更新（係数 0.03）
    this.ema = this.ema * 0.97 + e * 0.03;
    return { isBeat, energy: clamp(e / 255, 0, 1), sinceBeatMs: nowMs - this.lastBeatMs };
  }
}

// ── 解析帯域（50Hz〜15kHz） ──
// ライブ再生（AudioEngine）とオフライン書き出し（OfflineExporter）の双方が
// 同一の帯域切り出しを行うための共有ロジック。
function computeFreqRange(sampleRate, binCount) {
  const hzPerBin = sampleRate / (binCount * 2);
  const startBin = Math.round(50 / hzPerBin);
  const endBin = Math.min(binCount - 1, Math.round(15000 / hzPerBin));
  return { startBin, endBin };
}

// Node 環境（テスト）向けエクスポート。ブラウザでは無視される。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    clamp, lerp, isoProject, makeColor, makeRng,
    SpringArray, springParamsFromAmount, BeatDetector, ISO_KX, ISO_KY,
    computeFreqRange,
  };
}
