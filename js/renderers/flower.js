// T12 極座標フラワー — doc/spec-phase6.md §6.12
// 帯域を花弁に写像し、音で開閉する曼荼羅状の花。
// ステートフルレンダラー（背景クリアはコア側 _clearWithAfterimage が行う。selfClear ではない）。
// - レイヤー対応（capabilities.layers = true）: 半径を段階的に縮めた花を hueOffset で重ねる。
// - expressionMethod: bar=花弁の塗り / line=輪郭線 / dot=輪郭上の点。

class FlowerRenderer {
  constructor(canvas) {
    // ── 性能予算 §6.12: 輪郭サンプル ≤ 256 点 × レイヤー ≤ 4 ──
    this.MAX_SAMPLES = 256;

    // 輪郭頂点の一時バッファ（毎フレームの新規確保を避け使い回す）
    this._cx = new Float32Array(this.MAX_SAMPLES);
    this._cy = new Float32Array(this.MAX_SAMPLES);
    this._amp = new Float32Array(this.MAX_SAMPLES); // 各点の振幅 0..1（色決定用）

    // 回転位相 φ。フレーム間で持続させる（実時間基準で進める）。
    this.phi = 0;

    // 輪郭の微揺らぎ用 ValueNoise。コンストラクタで一度だけ生成する。
    this.noise = new ValueNoise(0x51ce);

    // レイアウト（onResize / render 内でも安全に再計算する）
    this._layout(canvas);
  }

  // canvas サイズから中心・基準半径を算出
  _layout(canvas) {
    const w = canvas ? canvas.width : 0;
    const h = canvas ? canvas.height : 0;
    this.cx = w / 2;
    this.cy = h / 2;
    this.maxR = Math.min(this.cx, this.cy) * 0.95; // 画面内に収まる最大半径
  }

  onResize(canvas) {
    this._layout(canvas);
  }

  render(ctx, canvas, frame, settings) {
    // ── ガード: canvas 0 サイズ / frame・getLayer・freq 欠落 ──
    if (!ctx || !canvas) return;
    if (canvas.width === 0 || canvas.height === 0) return;
    if (!frame || typeof frame.getLayer !== 'function') return;
    if (!frame.freq || frame.freq.length === 0) return;

    // サイズ変更に追従（onResize 未呼び出しでも破綻しない）
    if (this.cx !== canvas.width / 2 || this.cy !== canvas.height / 2) {
      this._layout(canvas);
    }

    // ── 設定取り出し（欠損時は makeColor と同じ既定に寄せる） ──
    const baseHueSetting = settings.hue != null ? settings.hue : 0;
    const sensitivity = settings.sensitivity != null ? settings.sensitivity : 1.0;
    const density = clamp(settings.density != null ? settings.density : 100, 30, 100);
    const baseOffset = clamp(settings.baseOffset != null ? settings.baseOffset : 0, 0, 99);
    const layerCount = clamp(settings.layerCount != null ? settings.layerCount : 1, 1, 4);
    const barWidth = Math.max(1, settings.barWidth != null ? settings.barWidth : 2);
    const motion = clamp(settings.motionSpeed != null ? settings.motionSpeed : 1.0, 0.1, 3.0);
    const method = settings.expressionMethod === 'bar' ? 'bar'
      : (settings.expressionMethod === 'dot' ? 'dot' : 'line');

    // ── 回転位相 φ を実時間基準で進める（motionSpeed が倍率） ──
    const dtMs = (frame.dtMs && frame.dtMs > 0) ? frame.dtMs : 16.7;
    this.phi += motion * (dtMs / 1000);
    if (this.phi > Math.PI * 4) this.phi -= Math.PI * 4; // 桁あふれ防止

    // ── 花弁数 k は専用パラメーター petalCount(2..16) で直接指定 ──
    const k = clamp(Math.round(settings.petalCount != null ? settings.petalCount : 6), 2, 16);

    // ── 輪郭サンプル数（density で密度調整・上限クランプ） ──
    let sampleCount = Math.round(this.MAX_SAMPLES * density / 100);
    if (sampleCount < 48) sampleCount = 48;
    if (sampleCount > this.MAX_SAMPLES) sampleCount = this.MAX_SAMPLES;
    // dot は点数を抑える（描画コスト・見た目のバランス）
    if (method === 'dot' && sampleCount > 128) sampleCount = 128;

    // 基準半径 R0 と花弁の振幅 A（baseOffset で中心円の大きさを決める）
    const R0base = this.maxR * (0.12 + (baseOffset / 99) * 0.35);
    const Abase = this.maxR - R0base;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // ── 奥（大きい i）→ 手前（i=0）の順に重ねる ──
    for (let layer = layerCount - 1; layer >= 0; layer--) {
      const data = frame.getLayer(layer, layerCount);
      if (!data || data.length === 0) continue;

      // レイヤーごとの色相・感度（設定が無ければ既定）
      const lconf = (settings.layers && settings.layers[layer]) ? settings.layers[layer] : null;
      const hueOffset = lconf && lconf.hueOffset != null ? lconf.hueOffset : 0;
      const layerSens = lconf && lconf.sensitivity != null ? lconf.sensitivity : 1;
      const baseHue = baseHueSetting + hueOffset;
      const sens = sensitivity * layerSens;

      // 半径の段階縮小（内側のレイヤーほど小さな花にして入れ子にする）
      const shrink = 1 - (layer / Math.max(1, layerCount)) * 0.30;
      const R0 = R0base * shrink;
      const A = Abase * shrink;
      // レイヤーごとに位相と揺らぎ座標をずらして重なりを見せる
      const phi = this.phi + layer * 0.4;

      const avgAmp = this._computeContour(data, sampleCount, R0, A, k, phi, sens, layer);
      this._draw(ctx, method, sampleCount, baseHue, avgAmp, sens, barWidth, settings);
    }
  }

  // 輪郭 r(θ) = R0 + A * |sin(kθ/2 + φ)| * env(θ) を算出し、
  // this._cx / this._cy / this._amp を埋めて平均振幅を返す。配列の新規確保はしない。
  _computeContour(data, sampleCount, R0, A, k, phi, sens, layer) {
    const len = data.length;
    const cx = this.cx;
    const cy = this.cy;
    const noise = this.noise;
    const jitterAmp = A * 0.05; // 微揺らぎの最大変位
    const noiseY = layer * 8.0 + phi * 0.3; // 時間で緩やかに変化させる
    let ampSum = 0;

    for (let s = 0; s < sampleCount; s++) {
      const theta = (s / sampleCount) * Math.PI * 2;
      // env(θ): θ に対応する帯域の振幅（0..1）
      const idx = Math.floor((s / sampleCount) * len) % len;
      const env = clamp((data[idx] / 255) * sens, 0, 1);
      this._amp[s] = env;
      ampSum += env;

      // 花弁の輪郭
      const petal = Math.abs(Math.sin(k * theta / 2 + phi));
      // ValueNoise による微揺らぎ（-1..1 に写像）
      const n = noise.noise2(s * 0.15 + phi * 0.5, noiseY) - 0.5;
      const r = R0 + A * petal * env + n * 2 * jitterAmp;

      const angle = theta - Math.PI / 2; // 上を起点にする
      this._cx[s] = cx + Math.cos(angle) * r;
      this._cy[s] = cy + Math.sin(angle) * r;
    }
    return clamp(ampSum / sampleCount, 0, 1);
  }

  // 算出済みバッファを表現方法に応じて描画する
  _draw(ctx, method, sampleCount, baseHue, avgAmp, sens, barWidth, settings) {
    const px = this._cx;
    const py = this._cy;

    if (method === 'dot') {
      // 輪郭上の点。各点をその振幅で着色する。
      const dotSize = Math.max(1.5, barWidth);
      const half = dotSize / 2;
      for (let s = 0; s < sampleCount; s++) {
        const amp = this._amp[s];
        if (amp < 0.01) continue;
        ctx.fillStyle = makeColor(baseHue, amp, settings, 1);
        ctx.fillRect(px[s] - half, py[s] - half, dotSize, dotSize);
      }
      return;
    }

    // line / bar は閉じた輪郭を作る
    ctx.beginPath();
    ctx.moveTo(px[0], py[0]);
    for (let s = 1; s < sampleCount; s++) ctx.lineTo(px[s], py[s]);
    ctx.closePath();

    if (method === 'bar') {
      // 花弁を塗り（半透明）＋縁取りで立体感を出す
      ctx.fillStyle = makeColor(baseHue, avgAmp, settings, 0.5);
      ctx.fill();
      ctx.lineWidth = Math.max(1, barWidth * 0.6);
      ctx.strokeStyle = makeColor(baseHue, avgAmp, settings, 1);
      ctx.stroke();
    } else {
      // line: 輪郭線のみ
      ctx.lineWidth = Math.max(1, barWidth * 0.8);
      ctx.strokeStyle = makeColor(baseHue, avgAmp, settings, 1);
      ctx.stroke();
    }
  }

  dispose() {
    this._cx = null;
    this._cy = null;
    this._amp = null;
    this.noise = null;
  }
}
