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
function polarToXy(cx, cy, r, angleRad) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
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

// ── 32bit 整数ハッシュ（決定的乱数の素） ──
function hash32(n) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}
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

// ── ValueNoise ── §5.1
function _smooth(t) { return t * t * (3 - 2 * t); }
class ValueNoise {
  constructor(seed = 1) { this.seed = seed >>> 0; }
  _gridVal(ix, iy) {
    // 格子点ハッシュ → 0..1
    const h = hash32((ix * 374761393 + iy * 668265263) ^ this.seed);
    return h / 4294967296;
  }
  noise2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const v00 = this._gridVal(ix, iy);
    const v10 = this._gridVal(ix + 1, iy);
    const v01 = this._gridVal(ix, iy + 1);
    const v11 = this._gridVal(ix + 1, iy + 1);
    const ux = _smooth(fx), uy = _smooth(fy);
    return lerp(lerp(v00, v10, ux), lerp(v01, v11, ux), uy);
  }
  fbm(x, y, octaves = 3) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }
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
class Spring {
  constructor(stiffness = 0.3, damping = 0.7) {
    this.k = stiffness; this.d = damping;
    this.value = 0; this.vel = 0; this._target = 0; this.bypass = false;
  }
  configure(params) { this.k = params.stiffness; this.d = params.damping; this.bypass = params.bypass; }
  target(v) { this._target = v; }
  update(dtMs) {
    if (this.bypass) { this.value = this._target; this.vel = 0; return this.value; }
    // dt を 60fps 基準の係数に正規化（発散防止のため 0..2 にクランプ）
    const dt = clamp((dtMs || 16.7) / 16.7, 0, 2);
    const force = (this._target - this.value) * this.k;
    this.vel = (this.vel + force) * Math.pow(this.d, dt);
    this.value += this.vel * dt;
    return this.value;
  }
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

// ── Voronoi 分割 ── §5.5
function generateJitteredSites(cols, rows, jitter, seed) {
  const rng = makeRng(seed);
  const sites = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      sites.push({
        x: (c + 0.5 + (rng() - 0.5) * jitter) / cols,
        y: (r + 0.5 + (rng() - 0.5) * jitter) / rows,
      });
    }
  }
  return sites;
}
// 凸多角形を半平面 (a·x + b·y <= c) でクリップ（Sutherland–Hodgman）
function _clipHalfPlane(poly, a, b, c) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i], nxt = poly[(i + 1) % n];
    const dCur = a * cur.x + b * cur.y - c;
    const dNxt = a * nxt.x + b * nxt.y - c;
    const inCur = dCur <= 1e-12, inNxt = dNxt <= 1e-12;
    if (inCur) out.push(cur);
    if (inCur !== inNxt) {
      const t = dCur / (dCur - dNxt);
      out.push({ x: cur.x + t * (nxt.x - cur.x), y: cur.y + t * (nxt.y - cur.y) });
    }
  }
  return out;
}
// sites: [{x,y}]（画素座標）, width/height: 画素。各サイトのセル多角形を返す O(n^2)。
function computeVoronoiCells(sites, width, height) {
  const cells = [];
  for (let i = 0; i < sites.length; i++) {
    let poly = [
      { x: 0, y: 0 }, { x: width, y: 0 },
      { x: width, y: height }, { x: 0, y: height },
    ];
    const si = sites[i];
    for (let j = 0; j < sites.length && poly.length > 0; j++) {
      if (j === i) continue;
      const sj = sites[j];
      // si に属する領域: |p - si|^2 <= |p - sj|^2
      // → 2(sj-si)·p <= |sj|^2 - |si|^2
      const a = 2 * (sj.x - si.x);
      const b = 2 * (sj.y - si.y);
      const c = (sj.x * sj.x + sj.y * sj.y) - (si.x * si.x + si.y * si.y);
      poly = _clipHalfPlane(poly, a, b, c);
    }
    cells.push({ site: si, polygon: poly });
  }
  return cells;
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
    clamp, lerp, isoProject, polarToXy, makeColor, hash32, makeRng,
    ValueNoise, Spring, SpringArray, springParamsFromAmount, BeatDetector,
    generateJitteredSites, computeVoronoiCells, ISO_KX, ISO_KY,
    computeFreqRange,
  };
}
