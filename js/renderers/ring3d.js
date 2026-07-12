// T6 回転3Dリング — doc/spec-phase6.md §6.6
// 水平に置いた円環に要素を立て、環がY軸回転して見える擬似3D表現。
// 楕円写像 x = cx + R cos(θ+φ), y = cy + R sin(θ+φ)*TILT で奥行きを表し、
// sin(θ+φ) の大小で描画順（奥→手前）とし、奥ほど暗く・細くする。
// ステートフルレンダラー（フレーム間で回転位相 φ を保持）。背景クリアはしない。

class Ring3dRenderer {
  constructor(canvas) {
    // 楕円の潰し率（奥行き感）。1 に近いほど正円、小さいほど寝かせた環になる。
    this.TILT = 0.35;
    // 要素数の上限（性能予算 §6.6: 要素 ≤ 96）。プールはこの長さで確保する。
    this.MAX = 96;
    // 回転位相（ラジアン）。フレームをまたいで保持し、motionSpeed*dt で進める。
    this.phase = 0;
    // motionSpeed=1.0 のときの基準角速度（ラジアン/秒）。
    this.baseOmega = 0.8;

    // ── ソート用の要素バッファ（毎フレーム再利用。ここで一度だけ確保）──
    this._ax = new Float32Array(this.MAX);   // ベース点 x
    this._ay = new Float32Array(this.MAX);   // ベース点 y
    this._th = new Float32Array(this.MAX);   // 高さ（上方向変位・px）
    this._sn = new Float32Array(this.MAX);   // sin(θ+φ)（奥行き -1..1）
    this._am = new Float32Array(this.MAX);   // 振幅 0..1（色決定用）
    this._order = new Array(this.MAX);       // 描画順インデックス（in-place ソート）

    this._layout(canvas);
  }

  onResize(canvas) {
    this._layout(canvas);
  }

  // キャンバスサイズからレイアウト（中心・基準半径）を再計算する。
  _layout(canvas) {
    const w = canvas ? canvas.width : 0;
    const h = canvas ? canvas.height : 0;
    this.cx = w / 2;
    this.cy = h / 2;
    // 16:9 / 1:1 いずれでも収まるよう短辺基準で半径上限を決める。
    this.maxR = Math.max(0, Math.min(this.cx, this.cy) * 0.92);
  }

  render(ctx, canvas, frame, settings) {
    // ── ガード：サイズ0・frame欠損・freq欠損 ──
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    if (!frame) return;

    // レイアウトが未計算/古い場合に備えて中心を追従（リサイズ漏れ対策）。
    if (this.cx !== canvas.width / 2 || this.cy !== canvas.height / 2) {
      this._layout(canvas);
    }
    if (this.maxR <= 0) return;

    // ── 回転位相を実時間基準で更新（motionSpeed 0.1..3.0 が倍率）──
    let dtMs = frame.dtMs;
    if (!(dtMs > 0) || !isFinite(dtMs)) dtMs = 16.7;
    const motion = settings.motionSpeed != null ? settings.motionSpeed : 1.0;
    this.phase += motion * this.baseOmega * (dtMs / 1000);
    // 桁あふれ防止で 2π に丸める。
    const TAU = Math.PI * 2;
    if (this.phase > TAU) this.phase %= TAU;
    else if (this.phase < 0) this.phase = (this.phase % TAU) + TAU;

    // ── レイヤー設定（layers=true）──
    const layerCount = clamp(settings.layerCount || 1, 1, 4);
    const layers = settings.layers || [];
    const method = settings.expressionMethod || 'bar';

    for (let li = 0; li < layerCount; li++) {
      // 帯域スライス（null の場合はスキップ）。
      const freq = frame.getLayer ? frame.getLayer(li, layerCount) : frame.freq;
      if (!freq || freq.length === 0) continue;

      const layer = layers[li] || { hueOffset: 0, sensitivity: 1.0 };
      const baseHue = (settings.hue + (layer.hueOffset || 0)) % 360;
      const sens = (settings.sensitivity != null ? settings.sensitivity : 1.0) *
                   (layer.sensitivity != null ? layer.sensitivity : 1.0);

      // レイヤーごとに半径を段階化（外側レイヤーほど大きい環）。
      const layerScale = layerCount > 1 ? (1 - li * (0.42 / layerCount)) : 1;
      this._renderLayer(ctx, freq, baseHue, sens, method, settings, layerScale);
    }
  }

  // 1レイヤー分の環を描画する。
  _renderLayer(ctx, freq, baseHue, sens, method, settings, layerScale) {
    const len = freq.length;
    const density = settings.density != null ? settings.density : 100;
    const baseOffset = settings.baseOffset != null ? settings.baseOffset : 0;
    const barWidth = settings.barWidth != null ? settings.barWidth : 3;

    // 要素数（性能予算で 8..96 にクランプ）。
    const count = clamp(Math.round(this.MAX * density / 100), 8, this.MAX);
    // baseOffset で環半径を可変（0=小さい環, 99=大きい環）。
    const ringR = this.maxR * (0.35 + (baseOffset / 99) * 0.45) * layerScale;
    // 高さ（上方向変位）の最大値。
    const hMax = this.maxR * 0.55 * layerScale;
    const TILT = this.TILT;
    const phase = this.phase;

    // ── 第1パス：各要素の位置・高さ・奥行き・振幅をバッファへ ──
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + phase;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const idx = Math.floor((i / count) * len);
      const raw = freq[idx] || 0;
      const amp = clamp((raw / 255) * sens, 0, 1);

      this._ax[i] = this.cx + ringR * cosA;
      this._ay[i] = this.cy + ringR * sinA * TILT;
      this._th[i] = amp * hMax;
      this._sn[i] = sinA;
      this._am[i] = amp;
      this._order[i] = i;
    }

    if (method === 'line') {
      // line は角度順に頂点（要素の頂上）を結んで帯状のポリラインにする。
      this._drawLine(ctx, count, baseHue, settings);
      return;
    }

    // bar / dot は奥→手前（sin 昇順）でソートしてから描く。
    this._order.length = count;
    const sn = this._sn;
    this._order.sort(function (p, q) { return sn[p] - sn[q]; });

    if (method === 'dot') {
      this._drawDots(ctx, count, baseHue, settings, barWidth);
    } else {
      this._drawBars(ctx, count, baseHue, settings, barWidth);
    }
  }

  // bar: ベース点から上方向へ縦線を立てる。
  _drawBars(ctx, count, baseHue, settings, barWidth) {
    ctx.lineCap = 'round';
    for (let k = 0; k < count; k++) {
      const i = this._order[k];
      const h = this._th[i];
      if (h < 1) continue;
      // 奥行き係数 0(奥)..1(手前)。奥は暗く・細く。
      const depth = (this._sn[i] + 1) * 0.5;
      const alpha = lerp(0.3, 1, depth);
      ctx.lineWidth = Math.max(0.5, barWidth * lerp(0.4, 1, depth));
      ctx.strokeStyle = makeColor(baseHue, this._am[i], settings, alpha);
      const x = this._ax[i];
      const y = this._ay[i];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - h); // 上方向（画面座標で y を減らす）
      ctx.stroke();
    }
  }

  // dot: 要素の頂上に点を打つ。
  _drawDots(ctx, count, baseHue, settings, barWidth) {
    for (let k = 0; k < count; k++) {
      const i = this._order[k];
      const amp = this._am[i];
      if (amp < 0.01) continue;
      const depth = (this._sn[i] + 1) * 0.5;
      const alpha = lerp(0.3, 1, depth);
      const r = Math.max(0.8, barWidth * lerp(0.45, 1, depth));
      ctx.fillStyle = makeColor(baseHue, amp, settings, alpha);
      const x = this._ax[i];
      const y = this._ay[i] - this._th[i];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // line: 頂上点を角度順に結ぶ。各セグメントを奥行きで着色（奥は暗く・細く）。
  _drawLine(ctx, count, baseHue, settings) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const baseLw = Math.max(1, (settings.barWidth != null ? settings.barWidth : 3) * 0.8);
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count; // 環状に閉じる
      const x1 = this._ax[i], y1 = this._ay[i] - this._th[i];
      const x2 = this._ax[j], y2 = this._ay[j] - this._th[j];
      const depth = ((this._sn[i] + this._sn[j]) * 0.5 + 1) * 0.5;
      const amp = (this._am[i] + this._am[j]) * 0.5;
      const alpha = lerp(0.3, 1, depth);
      ctx.lineWidth = Math.max(0.5, baseLw * lerp(0.4, 1, depth));
      ctx.strokeStyle = makeColor(baseHue, amp, settings, alpha);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  dispose() {
    // 保持リソースなし（バッファは GC 任せ）。
  }
}
