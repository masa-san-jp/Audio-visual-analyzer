// T7/T9 パーティクル・ノイズフロー — doc/spec-phase6.md §6.7 / §6.9
// classic script（import/export・#private 不可）。グローバルにクラス宣言する。
// ParticlesRenderer(T7) と FlowRenderer(T9) が共通の固定長パーティクルプールを利用する。
// いずれも selfClear ではない（背景クリア・残像はコアの _clearWithAfterimage が担当）。

const TAU = Math.PI * 2;

// ── 共通パーティクルプール ─────────────────────────────────────────────
// 固定長 Float32Array 群で粒子を管理する。毎フレームの配列/オブジェクト生成をしない。
// 空きスロットはフリーリスト（スタック）で O(1) 取得/返却する。
class ParticlePool {
  constructor(capacity) {
    this.capacity = capacity | 0;
    // 位置（現在）
    this.x = new Float32Array(this.capacity);
    this.y = new Float32Array(this.capacity);
    // 位置（前フレーム・軌跡線分用）
    this.px = new Float32Array(this.capacity);
    this.py = new Float32Array(this.capacity);
    // 速度（px/秒）
    this.vx = new Float32Array(this.capacity);
    this.vy = new Float32Array(this.capacity);
    // 寿命（残り ms）と総寿命（ms）
    this.life = new Float32Array(this.capacity);
    this.maxLife = new Float32Array(this.capacity);
    // 色相と振幅（描画色決定用）
    this.hue = new Float32Array(this.capacity);
    this.amp = new Float32Array(this.capacity);
    // 生存フラグ（0/1）
    this.active = new Uint8Array(this.capacity);

    // フリースロットのスタック（初期状態は全スロットが空き）
    this._free = new Int32Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) this._free[i] = i;
    this._freeTop = this.capacity; // 空きスロット数
  }

  // 現在の生存粒子数（開発用カウンタ・上限確認に使う）
  aliveCount() { return this.capacity - this._freeTop; }
  isFull() { return this._freeTop === 0; }

  // 粒子を1つ生成する。満杯なら何もせず -1 を返す（放出の間引きは呼び出し側で判断）。
  // 戻り値はスロット index（呼び出し側が付随データを別配列に持つ場合に使う）。
  spawn(x, y, vx, vy, lifeMs, hue, amp) {
    if (this._freeTop === 0) return -1; // 枯渇時は no-op
    const i = this._free[--this._freeTop];
    this.x[i] = x;      this.y[i] = y;
    this.px[i] = x;     this.py[i] = y; // 生成直後は軌跡長ゼロ
    this.vx[i] = vx;    this.vy[i] = vy;
    this.life[i] = lifeMs; this.maxLife[i] = lifeMs;
    this.hue[i] = hue;  this.amp[i] = amp;
    this.active[i] = 1;
    return i;
  }

  // スロットを解放してフリーリストへ戻す。
  _kill(i) {
    this.active[i] = 0;
    this._free[this._freeTop++] = i;
  }

  // 全生存粒子を dtMs 進める。重力 gravity（px/秒^2、下向き正）を vy に加える。
  // 寿命切れは kill してスロットを解放する。新規割り当ては一切しない。
  update(dtMs, gravity) {
    const dt = (dtMs > 0 ? (dtMs < 100 ? dtMs : 100) : 16.7) / 1000; // 秒。異常値を吸収
    const g = gravity || 0;
    const cap = this.capacity;
    for (let i = 0; i < cap; i++) {
      if (!this.active[i]) continue;
      this.life[i] -= dtMs;
      if (this.life[i] <= 0) { this._kill(i); continue; }
      // 前位置を退避（軌跡線分 px,py → x,y に使う）
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      if (g !== 0) this.vy[i] += g * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }
}

// レイヤー数を 1〜4 にクランプして返す。
function _layerCount(settings) {
  const c = settings && settings.layerCount ? settings.layerCount : 1;
  return clamp(c | 0, 1, 4);
}
// レイヤー i の設定（未定義時のフォールバック付き）。
function _layerOf(settings, i) {
  const layers = settings && settings.layers;
  return (layers && layers[i]) ? layers[i] : { hueOffset: 0, sensitivity: 1.0 };
}
// レイヤー i の帯域スライス（Uint8Array）を安全に取得。getLayer が無ければ freq を等分する。
function _bandSlice(frame, i, count) {
  if (frame && typeof frame.getLayer === 'function') {
    const b = frame.getLayer(i, count);
    if (b && b.length) return b;
  }
  const f = frame && frame.freq;
  if (!f || !f.length) return null;
  const start = Math.floor(i * f.length / count);
  const end = Math.floor((i + 1) * f.length / count);
  return f.subarray(start, end);
}

// ── T7 パーティクル放出 ────────────────────────────────────────────────
// 帯域ごとの発生源から音量に比例して粒子を放出。重力で舞い、寿命でフェードアウト。
class ParticlesRenderer {
  constructor(canvas) {
    this.MAX_ALIVE = 600;          // 生存上限（§6.7 性能予算）
    this.MAX_SPAWN_PER_FRAME = 60; // 1フレーム新規放出上限
    this.SOURCES_PER_LAYER = 8;    // レイヤー帯域あたりの横軸発生源数
    this.pool = new ParticlePool(this.MAX_ALIVE);
    // 散乱用の乱数（永続性は不要。決定的にしておく）
    this.rng = makeRng(0x7c1e5b3 ^ ((canvas && canvas.width) | 0));
  }

  onResize(_canvas) { /* レイアウトは毎フレーム canvas から算出するため再計算不要 */ }

  render(ctx, canvas, frame, settings) {
    const W = canvas.width | 0, H = canvas.height | 0;
    if (W <= 0 || H <= 0) return;                 // 0サイズガード
    if (!frame || !frame.freq || !frame.freq.length) { // 無音/無データでも既存粒子は進める
      this.pool.update(frame ? frame.dtMs : 16.7, H * 0.8);
      this._draw(ctx, settings);
      return;
    }

    const rng = this.rng;
    const dtMs = frame.dtMs || 16.7;
    const gravity = H * 0.8; // 画面高に比例した重力（アスペクト差を吸収）
    const beat = (frame.beat && frame.beat.isBeat) ? 1 : 0;

    // 1) 既存粒子を進める（寿命切れを解放）
    this.pool.update(dtMs, gravity);

    // 2) 放出（レイヤー×発生源ごとに音量比例）
    const layerCount = _layerCount(settings);
    const amountScale = clamp((settings.particleAmount || 50) / 100, 0.1, 1);
    const baselineY = H * 0.97; // 画面下端付近から放出
    let budget = this.MAX_SPAWN_PER_FRAME;
    const src = this.SOURCES_PER_LAYER;

    for (let li = 0; li < layerCount && budget > 0; li++) {
      const band = _bandSlice(frame, li, layerCount);
      if (!band || !band.length) continue;
      const layer = _layerOf(settings, li);
      const sens = (settings.sensitivity || 1) * (layer.sensitivity || 1);
      const baseHue = (settings.hue || 0) + (layer.hueOffset || 0);
      const bl = band.length;

      for (let s = 0; s < src && budget > 0; s++) {
        // 発生源が担当する帯域サブスライスの平均振幅
        const bs = Math.floor(s * bl / src);
        const be = Math.max(bs + 1, Math.floor((s + 1) * bl / src));
        let sum = 0;
        for (let k = bs; k < be; k++) sum += band[k];
        const amp = clamp((sum / (be - bs)) / 255 * sens, 0, 1);
        if (amp < 0.02) continue;

        // 放出数 ∝ 振幅（誇張のため amp^2）× 量スケール。ビート時 2倍バースト。
        let count = Math.floor(amp * amp * amountScale * 7);
        if (beat) count *= 2;
        if (count <= 0) continue;
        if (count > budget) count = budget;

        // 発生源の横位置（全幅に等配置）
        const sx = (s + 0.5) / src * W;
        const spread = W / src * 0.5;

        for (let n = 0; n < count; n++) {
          // 初速: 上向き（-y）+ ランダム散乱
          const up = -(H * (0.35 + amp * 0.45)) * (0.7 + rng() * 0.6);
          const vx = (rng() - 0.5) * H * 0.4;
          const x = sx + (rng() - 0.5) * spread;
          const life = 1000 + rng() * 1000; // 寿命 1〜2s
          if (this.pool.spawn(x, baselineY, vx, up, life, baseHue, amp) < 0) {
            budget = 0; break; // プール枯渇 → 以降の放出を間引く
          }
        }
        budget -= count;
      }
    }

    // 3) 描画
    this._draw(ctx, settings);
  }

  _draw(ctx, settings) {
    const p = this.pool;
    const cap = p.capacity;
    const method = settings.expressionMethod === 'line' ? 'line' : 'dot';
    const baseSize = Math.max(1, settings.barWidth || 3);

    // 加算合成でグロー感を出す（美しさ向上）。描画後に必ず戻す。
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';

    if (method === 'line') {
      // ── 線: 速度方向に伸びる流れ星状のストリーク ──
      ctx.lineCap = 'round';
      for (let i = 0; i < cap; i++) {
        if (!p.active[i]) continue;
        const frac = clamp(p.life[i] / p.maxLife[i], 0, 1);
        const alpha = frac * frac; // 尾は淡く
        // 速度に比例した尾の長さ（px/秒 → 一定時間ぶんの変位）
        const vx = p.vx[i], vy = p.vy[i];
        const speed = Math.hypot(vx, vy) || 1;
        const tail = clamp(speed * 0.05, 4, 60);
        const tx = p.x[i] - (vx / speed) * tail;
        const ty = p.y[i] - (vy / speed) * tail;
        ctx.lineWidth = Math.max(1, baseSize * (0.4 + 0.6 * frac));
        ctx.strokeStyle = makeColor(p.hue[i], clamp(p.amp[i], 0, 1), settings, alpha);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(p.x[i], p.y[i]);
        ctx.stroke();
      }
    } else {
      // ── 点: 中心が明るく外周が透明な放射グラデーションの光球 ──
      for (let i = 0; i < cap; i++) {
        if (!p.active[i]) continue;
        const frac = clamp(p.life[i] / p.maxLife[i], 0, 1);
        const amp = clamp(p.amp[i], 0, 1);
        const r = baseSize * (0.8 + 1.6 * amp) * (0.35 + 0.65 * frac);
        if (r < 0.5) continue;
        const x = p.x[i], y = p.y[i];
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, makeColor(p.hue[i], amp, settings, frac));
        g.addColorStop(0.5, makeColor(p.hue[i], amp, settings, frac * 0.5));
        g.addColorStop(1, makeColor(p.hue[i], amp, settings, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = prevOp;
  }

  dispose() { this.pool = null; }
}

// ── T9 ノイズフロー（煙）────────────────────────────────────────────────
// ValueNoise の角度場に沿って粒子が常時流れる。寿命でリスポーンし個体数を維持。
// afterimage 併用が既定の見せ方だが、ここでは強制せず軌跡線分のみ描く（UI が既定値を扱う）。
class FlowRenderer {
  constructor(canvas) {
    this.MAX = 400;                 // 粒子上限（§6.9 性能予算）
    this.pool = new ParticlePool(this.MAX);
    this.noise = new ValueNoise(1337);
    this.rng = makeRng(0x51f0a3 ^ ((canvas && canvas.width) | 0));
    // スロットごとの担当レイヤー帯域（プールと並行して保持）
    this.band = new Uint8Array(this.MAX);
    this.t = 0;                     // ノイズの時間発展
    this._w = 0; this._h = 0;
    // レイヤー平均振幅（毎フレーム再利用する固定長バッファ）
    this._layerAmp = new Float32Array(4);
    this._seeded = false;
  }

  onResize(canvas) {
    // サイズが変わったら粒子を新しい領域へ再配置する。
    this._reseed(canvas.width | 0, canvas.height | 0, _layerCount({ layerCount: 1 }));
  }

  // 個体群を全リセットして領域内へ再配置する。
  _reseed(W, H, layerCount) {
    const p = this.pool;
    // 既存を全解放
    for (let i = 0; i < p.capacity; i++) if (p.active[i]) p._kill(i);
    this._w = W; this._h = H;
    this._seeded = (W > 0 && H > 0);
  }

  // 死んだ/未使用スロットを補充し、目標個体数まで生成する。
  _replenish(W, H, target, layerCount) {
    const p = this.pool;
    const rng = this.rng;
    while (p.aliveCount() < target && !p.isFull()) {
      const x = rng() * W;
      const y = rng() * H;
      const layer = (Math.floor(rng() * layerCount)) % layerCount;
      const life = 2000 + rng() * 4000; // 2〜6s で入れ替わり
      const idx = p.spawn(x, y, 0, 0, life, 0, 0);
      if (idx < 0) break;
      this.band[idx] = layer;
    }
  }

  render(ctx, canvas, frame, settings) {
    const W = canvas.width | 0, H = canvas.height | 0;
    if (W <= 0 || H <= 0) return;                 // 0サイズガード

    const layerCount = _layerCount(settings);

    // サイズ変化で再配置
    if (W !== this._w || H !== this._h || !this._seeded) this._reseed(W, H, layerCount);

    if (!frame || !frame.freq || !frame.freq.length) return; // 無データガード

    const dtMs = frame.dtMs || 16.7;
    const dt = clamp(dtMs, 0, 100) / 1000;
    const motion = settings.motionSpeed || 1.0;
    this.t += motion * dt * 0.5; // ノイズ時間発展（motionSpeed 倍率）

    // レイヤーごとの平均振幅を先に算出（粒子ループ内の再計算を避ける）
    const amp = this._layerAmp;
    for (let li = 0; li < layerCount; li++) {
      const band = _bandSlice(frame, li, layerCount);
      const layer = _layerOf(settings, li);
      const sens = (settings.sensitivity || 1) * (layer.sensitivity || 1);
      if (!band || !band.length) { amp[li] = 0; continue; }
      let sum = 0;
      for (let k = 0; k < band.length; k++) sum += band[k];
      amp[li] = clamp((sum / band.length) / 255 * sens, 0, 1);
    }

    // 目標個体数（particleAmount 10〜100 → 50〜MAX）
    const target = clamp(Math.round((settings.particleAmount || 50) / 100 * this.MAX), 40, this.MAX);
    this._replenish(W, H, target, layerCount);

    // 角度場に沿って速度を設定
    const p = this.pool;
    const cap = p.capacity;
    const s = 0.003; // ノイズ空間スケール（px→ノイズ座標）
    const baseSpeed = H * 0.05; // 常時のゆるやかな流れ（px/秒）
    for (let i = 0; i < cap; i++) {
      if (!p.active[i]) continue;
      const layer = this.band[i];
      const a = amp[layer] || 0;
      // fbm(0..1) を角度に写像（1周以上回して有機的にする）
      const ang = this.noise.fbm(p.x[i] * s, p.y[i] * s + this.t, 3) * TAU * 2;
      const speed = baseSpeed + a * H * 0.6; // 変位量 ∝ 帯域振幅 × sensitivity（amp に反映済み）
      p.vx[i] = Math.cos(ang) * speed;
      p.vy[i] = Math.sin(ang) * speed;
    }

    // 位置更新（重力なし）
    p.update(dtMs, 0);

    // 画面外へ出たら領域内へ再配置（軌跡が飛ばないよう前位置もリセット）
    const rng = this.rng;
    for (let i = 0; i < cap; i++) {
      if (!p.active[i]) continue;
      if (p.x[i] < 0 || p.x[i] > W || p.y[i] < 0 || p.y[i] > H) {
        const nx = rng() * W, ny = rng() * H;
        p.x[i] = nx; p.y[i] = ny;
        p.px[i] = nx; p.py[i] = ny;
      }
    }

    // ── 描画: 表現方法で明確に描き分ける ──
    const method = settings.expressionMethod === 'dot' ? 'dot' : 'line';
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter'; // グロー感

    if (method === 'dot') {
      // 点: 流れに沿って移動する小さな光点（線でつながず粒として見せる）
      const dotSize = Math.max(1, (settings.barWidth || 2));
      for (let i = 0; i < cap; i++) {
        if (!p.active[i]) continue;
        const layer = this.band[i];
        const a = amp[layer] || 0;
        const lyr = _layerOf(settings, layer);
        const baseHue = (settings.hue || 0) + (lyr.hueOffset || 0);
        const frac = clamp(p.life[i] / p.maxLife[i], 0, 1);
        const alpha = clamp(0.2 + a * 0.8, 0, 1) * clamp(frac * 3, 0, 1);
        const r = dotSize * (0.6 + a * 1.4);
        const x = p.x[i], y = p.y[i];
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, makeColor(baseHue, clamp(0.25 + a, 0, 1), settings, alpha));
        g.addColorStop(1, makeColor(baseHue, clamp(0.25 + a, 0, 1), settings, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    } else {
      // 線: 流線（前位置→現位置の線分）。連続したなめらかな流れとして見せる。
      ctx.lineCap = 'round';
      for (let i = 0; i < cap; i++) {
        if (!p.active[i]) continue;
        const layer = this.band[i];
        const a = amp[layer] || 0;
        const lyr = _layerOf(settings, layer);
        const baseHue = (settings.hue || 0) + (lyr.hueOffset || 0);
        const frac = clamp(p.life[i] / p.maxLife[i], 0, 1);
        const alpha = clamp(0.15 + a * 0.7, 0, 1) * clamp(frac * 3, 0, 1);
        ctx.lineWidth = Math.max(1, (settings.barWidth || 2) * (0.6 + a));
        ctx.strokeStyle = makeColor(baseHue, clamp(0.2 + a, 0, 1), settings, alpha);
        ctx.beginPath();
        ctx.moveTo(p.px[i], p.py[i]);
        ctx.lineTo(p.x[i], p.y[i]);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = prevOp;
  }

  dispose() { this.pool = null; this.noise = null; this.band = null; }
}
