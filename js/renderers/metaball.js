// T10 メタボール — doc/spec-phase6.md §6.10
//
// 概要: 帯域ごとの「音で膨らむ円（ブロブ）」を、中心不透明→外周透明の
// 放射状グラデーションで `globalCompositeOperation='lighter'` 描画し、
// メインへ `ctx.filter='blur(12px) contrast(24)'` で転写することで
// 隣接するブロブの輪郭を融合させたしきい値形状（流体塊）を得る。
//
// 実装方針:
//  - オフスクリーンはメインの 1/2 解像度（filter コスト削減）。
//  - ブロブは固定長プール（≤12 個）。位置（周回角）と半径バネは instance に保持し、
//    毎フレームの配列/オブジェクト新規生成を避ける。
//  - 半径 = 基準 + 帯域振幅 × sensitivity を Spring で揺らす。
//  - 色はレイヤーごとに makeColor(baseHue = settings.hue + layers[i].hueOffset) で
//    決定し、ブロブ自体を色分けして filter 転写のみ行う（spec §6.10 既定）。
//  - `ctx.filter` 非対応環境ではフォールバック（通常の半透明円、融合なし）。

const METABALL_MAX_BLOBS = 12; // 性能予算: ブロブ ≤ 12（spec §6.10）

// ctx.filter サポート判定（一度だけ実行してキャッシュ）。
// プロパティ未定義、または 'blur(1px)' を代入しても 'none' のままなら非対応とみなす。
function _metaballDetectFilter(ctx) {
  if (!ctx || typeof ctx.filter === 'undefined') return false;
  try {
    const prev = ctx.filter;
    ctx.filter = 'blur(1px)';
    const ok = ctx.filter !== 'none' && ctx.filter !== '';
    ctx.filter = prev || 'none';
    return ok;
  } catch (e) {
    return false;
  }
}

class MetaballRenderer {
  constructor(canvas) {
    // ── 固定長ブロブプール（seed 決定的に初期化） ──
    const rng = makeRng(0x7a2b3c);
    this._blobs = new Array(METABALL_MAX_BLOBS);
    this._springs = new Array(METABALL_MAX_BLOBS);
    for (let i = 0; i < METABALL_MAX_BLOBS; i++) {
      this._blobs[i] = {
        // 周回中心（画面中央からの正規化オフセット、minDim 倍で画素化）
        ox: (rng() - 0.5) * 0.5,
        oy: (rng() - 0.5) * 0.5,
        orbitR: 0.05 + rng() * 0.14, // 周回半径（正規化・個体差を拡大）
        angle: rng() * Math.PI * 2,  // 現在の周回角（毎フレーム更新して保持）
        speed: (0.0002 + rng() * 0.0009) * (rng() < 0.5 ? -1 : 1), // rad/ms（個体差拡大）
        bandFrac: rng(),             // レイヤー内の担当帯域位置（0..1）
        // ノイズ徘徊用の固有位相（中心をゆっくり漂わせて形状ランダム性を高める）
        nseed: rng() * 100,
        rBias: 0.7 + rng() * 0.9,    // 基準半径の個体差
      };
      // 半径揺れ用の Spring（instance に保持）
      this._springs[i] = new Spring(0.35, 0.75);
    }

    // 中心徘徊用ノイズ（決定的）と時間アキュムレータ
    this._noise = new ValueNoise(0x2b71);
    this._t = 0;

    // ── オフスクリーン（メインの 1/2 解像度） ──
    this._off = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    this._octx = this._off ? this._off.getContext('2d') : null;

    // filter サポートは初回 render 時に判定してキャッシュ
    this._filterSupported = null;

    if (canvas) this.onResize(canvas);
  }

  // canvas サイズ変更時: オフスクリーンをメインの 1/2 に作り直す。
  onResize(canvas) {
    if (!this._off || !canvas) return;
    const w = Math.max(1, Math.floor((canvas.width || 0) / 2));
    const h = Math.max(1, Math.floor((canvas.height || 0) / 2));
    this._off.width = w;
    this._off.height = h;
  }

  // 毎フレーム描画。背景クリアはしない（コアが実施）。
  render(ctx, canvas, frame, settings) {
    // ── ガード ──
    if (!ctx || !canvas) return;
    const w = canvas.width | 0, h = canvas.height | 0;
    if (w <= 0 || h <= 0) return;
    if (!frame || !frame.freq || frame.freq.length === 0) return;
    if (typeof frame.getLayer !== 'function') return;

    // filter サポートを一度だけ判定
    if (this._filterSupported === null) {
      this._filterSupported = _metaballDetectFilter(ctx);
    }
    const useFilter = this._filterSupported && this._off && this._octx;

    // オフスクリーンがメインと不整合ならサイズ合わせ（1/2）
    if (this._off) {
      const ow = Math.max(1, Math.floor(w / 2));
      const oh = Math.max(1, Math.floor(h / 2));
      if (this._off.width !== ow || this._off.height !== oh) {
        this._off.width = ow;
        this._off.height = oh;
      }
      if (this._off.width <= 0 || this._off.height <= 0) return;
    }

    const layerCount = clamp((settings.layerCount | 0) || 1, 1, 4);
    // 12 個を各レイヤーへ均等配分（合計 ≤ 12）
    const perLayer = Math.max(1, Math.floor(METABALL_MAX_BLOBS / layerCount));
    const activeCount = Math.min(METABALL_MAX_BLOBS, perLayer * layerCount);

    const minDim = Math.min(w, h);
    const cx = w * 0.5, cy = h * 0.5;
    const baseR = minDim * 0.055;         // ブロブ基準半径
    const ampR = minDim * 0.14;           // 振幅による最大加算（膨らみを強調）
    const dt = frame.dtMs || 16.7;
    const motion = settings.motionSpeed != null ? settings.motionSpeed : 1;
    const globalSens = settings.sensitivity != null ? settings.sensitivity : 1;
    // ノイズ時間を進める（中心の徘徊速度も motionSpeed に連動）
    this._t += (dt / 1000) * (0.15 + motion * 0.25);

    // ── 描画ターゲットとスケール ──
    // filter 使用時: オフスクリーン（1/2）へ 'lighter' で描画。
    // 非対応時: メインへ直接、半透明円（融合なし）で描画。
    let tctx, scale;
    if (useFilter) {
      tctx = this._octx;
      scale = 0.5;
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, this._off.width, this._off.height);
      tctx.globalCompositeOperation = 'lighter';
    } else {
      tctx = ctx;
      scale = 1;
    }

    // ── ブロブ描画ループ（新規配列/オブジェクトを作らない） ──
    for (let b = 0; b < activeCount; b++) {
      const blob = this._blobs[b];
      const li = Math.min(layerCount - 1, Math.floor(b / perLayer));

      // レイヤー帯域スライスを取得（null ガード）
      const layerData = frame.getLayer(li, layerCount);
      if (!layerData || layerData.length === 0) continue;

      const layer = (settings.layers && settings.layers[li]) || { hueOffset: 0, sensitivity: 1 };
      const sens = globalSens * (layer.sensitivity != null ? layer.sensitivity : 1);

      // 担当帯域の振幅（0..1 正規化）
      const idx = Math.min(layerData.length - 1, Math.floor(blob.bandFrac * layerData.length));
      const raw = layerData[idx] / 255;
      const amp = clamp(raw * sens, 0, 1);

      // 半径を Spring で揺らす（instance 保持のバネ）。個体差 rBias で大小に散らす。
      const spr = this._springs[b];
      spr.target((baseR + amp * ampR) * blob.rBias);
      let r = spr.update(dt);
      if (r < 1) r = 1;

      // 中心をノイズでゆっくり徘徊させ、形状のランダム性を高める
      const nx = this._noise.noise2(blob.nseed, this._t) - 0.5;
      const ny = this._noise.noise2(blob.nseed + 50, this._t) - 0.5;
      const wanderX = nx * minDim * 0.22;
      const wanderY = ny * minDim * 0.22;

      // 位置はゆっくり周回（dtMs 基準 × motionSpeed）＋ノイズ徘徊
      blob.angle += blob.speed * motion * dt;
      const centerX = cx + blob.ox * minDim + wanderX;
      const centerY = cy + blob.oy * minDim + wanderY;
      const px = centerX + Math.cos(blob.angle) * blob.orbitR * minDim;
      const py = centerY + Math.sin(blob.angle) * blob.orbitR * minDim;

      // レイヤー色（makeColor で決定）
      const baseHue = (settings.hue || 0) + (layer.hueOffset || 0);

      // 描画（ターゲット座標系にスケール）
      const dx = px * scale, dy = py * scale, dr = r * scale;
      const grad = tctx.createRadialGradient(dx, dy, 0, dx, dy, dr);
      if (useFilter) {
        // 中心不透明 → 外周透明（filter で融合させる）
        grad.addColorStop(0, makeColor(baseHue, amp, settings, 1));
        grad.addColorStop(1, makeColor(baseHue, amp, settings, 0));
      } else {
        // フォールバック: 半透明円（融合なし）
        grad.addColorStop(0, makeColor(baseHue, amp, settings, 0.55));
        grad.addColorStop(1, makeColor(baseHue, amp, settings, 0));
      }
      tctx.fillStyle = grad;
      tctx.beginPath();
      tctx.arc(dx, dy, dr, 0, Math.PI * 2);
      tctx.fill();
    }

    if (useFilter) {
      // オフスクリーンの合成モードを戻す
      tctx.globalCompositeOperation = 'source-over';

      // ── メインへ filter 転写（blur + contrast でしきい値融合） ──
      const prevFilter = ctx.filter;
      // blur を画面サイズに比例させ、contrast を高めて融合輪郭を滑らかかつ明瞭にする
      const blurPx = Math.max(8, Math.round(minDim * 0.018));
      ctx.filter = 'blur(' + blurPx + 'px) contrast(30)';
      ctx.drawImage(this._off, 0, 0, this._off.width, this._off.height, 0, 0, w, h);
      // CRITICAL: filter は必ずリセットする
      ctx.filter = (typeof prevFilter === 'string' && prevFilter) ? prevFilter : 'none';
    }
  }

  // 破棄時: オフスクリーン参照を解放。
  dispose() {
    this._off = null;
    this._octx = null;
    this._blobs = null;
    this._springs = null;
    this._noise = null;
  }
}
