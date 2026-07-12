// T5 擬似3Dバー — doc/spec-phase6.md §6.5
// 各帯域バーを「前面 + 右側面 + 上面」の直方体（アイソメトリック平行投影）で描く。
// ステートフルレンダラー v2 インターフェース（doc/renderer-contract.md）。
// - selfClear なし（背景クリアはコアが担当）
// - expressionMethod は持たない（常に3Dバーを描画。methods: []）
// - レイヤー対応（capabilities.layers = true）: レイヤーごとに奥行き方向へ後退させ階段状に重ねる

class Bar3dRenderer {
  constructor(canvas) {
    // 立体の見た目に使う定数（isoProject 既定係数と揃える）
    this.kx = 0.5;   // 奥行きの水平ずれ係数
    this.ky = 0.35;  // 奥行きの垂直ずれ係数
    this.onResize(canvas);
  }

  onResize(canvas) {
    // レイアウトは render 内で毎回算出するためここでは特別な再計算は不要。
    // （固定長プールを持たない軽量レンダラー）
    this._w = canvas ? canvas.width : 0;
    this._h = canvas ? canvas.height : 0;
  }

  render(ctx, canvas, frame, settings) {
    // ── ガード ──
    if (!ctx || !canvas) return;
    const W = canvas.width, H = canvas.height;
    if (W <= 0 || H <= 0) return;
    if (!frame || typeof frame.getLayer !== 'function') return;

    // ── 設定の取り出し（欠損時は makeColor と同じ既定値） ──
    const baseHueSetting = settings.hue != null ? settings.hue : 0;
    const hueRange = settings.hueRange || 0;
    const saturation = clamp(settings.saturation != null ? settings.saturation : 100, 0, 100);
    const brightness = settings.brightness != null ? settings.brightness : 80;
    const sensitivity = settings.sensitivity != null ? settings.sensitivity : 1;
    const barWidth = Math.max(1, settings.barWidth != null ? settings.barWidth : 4);
    const density = clamp(settings.density != null ? settings.density : 100, 30, 100);
    const baseOffset = clamp(settings.baseOffset != null ? settings.baseOffset : 0, 0, 99);
    const layerCount = clamp(settings.layerCount != null ? settings.layerCount : 1, 1, 4);

    // ── バー数（bars.js 準拠、上限 96） ──
    const gap = 1;
    const step = barWidth + gap;
    const maxCount = Math.floor(W / step);
    let barCount = Math.max(4, Math.floor(maxCount * density / 100));
    if (barCount > 96) barCount = 96;

    // ── 立体の奥行きとレイヤー後退量 ──
    // 奥行き量。棒グラフとの差が明確になるよう大きめに取り、立体感を強調する。
    const depth = Math.max(14, Math.min(barWidth * 3 + 12, W * 0.07));
    // 1レイヤーぶんの後退量（isoProject で計算）。4レイヤーで階段状に見える距離。
    const layerStep = depth * 1.5;

    // 奥行きオフセット（全バー共通なので1回だけ isoProject で算出：ホットループ内の割り当て回避）
    const depthOff = isoProject(0, 0, depth, this.kx, this.ky); // {x:+depth*kx, y:-depth*ky}
    const ddx = depthOff.x;
    const ddy = depthOff.y;

    // ── 縦レイアウト（bars.js の baseOffset 準拠） ──
    const offsetRatio = baseOffset / 99;
    const baseY = H - (offsetRatio * H * 0.5);
    // 上面・奥行き・レイヤー後退のぶんを差し引いて描画可能高さを確保
    const layerRise = (layerCount - 1) * layerStep * this.ky;
    const topMargin = depth * this.ky + layerRise + 2;
    const availHeight = Math.max(1, baseY - topMargin);

    // 描画幅は右方向の奥行き・レイヤーずれのぶんを内側に寄せて確保
    const rightMargin = ddx + (layerCount - 1) * layerStep * this.kx;
    const drawWidth = Math.max(1, W - rightMargin);
    const drawStep = drawWidth / barCount;
    // バー本体の幅（隙間を残す）
    const bw = Math.max(1, Math.min(barWidth, drawStep - gap));

    ctx.lineWidth = 1;

    // ── レイヤーを奥（大きい i）→ 手前（i=0）の順に描く（手前が上に重なる） ──
    for (let layer = layerCount - 1; layer >= 0; layer--) {
      const data = frame.getLayer(layer, layerCount);
      if (!data || data.length === 0) continue;
      const len = data.length;

      // レイヤーごとの色相・感度（設定が無ければ既定）
      const lconf = (settings.layers && settings.layers[layer]) ? settings.layers[layer] : null;
      const hueOffset = lconf && lconf.hueOffset != null ? lconf.hueOffset : 0;
      const layerSens = lconf && lconf.sensitivity != null ? lconf.sensitivity : 1;
      const baseHue = baseHueSetting + hueOffset;
      const sens = sensitivity * layerSens;

      // このレイヤーの奥行き後退量（isoProject で算出、レイヤーごとに1回だけ）
      const back = isoProject(0, 0, layer * layerStep, this.kx, this.ky);
      const shiftX = back.x;   // 右へ
      const shiftY = back.y;   // 上へ（負値）

      // 左→右で描き、右側面・上面の重なり順を保つ
      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor(i * len / barCount);
        const val = data[idx];
        const amp = clamp(val / 255 * sens, 0, 1);
        const barHeight = Math.round(amp * availHeight);
        if (barHeight < 1) continue;

        // 前面の左下基準点（レイヤー後退を反映）
        const x0 = i * drawStep + shiftX;
        const yb = baseY + shiftY;          // 前面 底
        const yt = yb - barHeight;          // 前面 天
        const x1 = x0 + bw;                 // 前面 右辺

        // 色（makeColor と同じ決定則を踏襲し、面ごとに明度を調整）
        const h = ((baseHue + amp * hueRange) % 360 + 360) % 360;
        const l = clamp(brightness * (0.3 + 0.7 * amp), 0, 100);
        const lRight = Math.max(0, l - 20);   // 右側面: 明度 -20%
        const lTop = Math.min(100, l + 15);   // 上面: 明度 +15%

        // 前面（長方形）
        ctx.fillStyle = 'hsl(' + h.toFixed(1) + ',' + saturation + '%,' + l.toFixed(1) + '%)';
        ctx.fillRect(x0, yt, bw, barHeight);

        // 右側面（平行四辺形）: 前右辺 → 奥へ ddx,ddy 平行移動
        ctx.fillStyle = 'hsl(' + h.toFixed(1) + ',' + saturation + '%,' + lRight.toFixed(1) + '%)';
        ctx.beginPath();
        ctx.moveTo(x1, yb);
        ctx.lineTo(x1 + ddx, yb + ddy);
        ctx.lineTo(x1 + ddx, yt + ddy);
        ctx.lineTo(x1, yt);
        ctx.closePath();
        ctx.fill();

        // 上面（平行四辺形）: 前天辺 → 奥へ ddx,ddy 平行移動
        ctx.fillStyle = 'hsl(' + h.toFixed(1) + ',' + saturation + '%,' + lTop.toFixed(1) + '%)';
        ctx.beginPath();
        ctx.moveTo(x0, yt);
        ctx.lineTo(x1, yt);
        ctx.lineTo(x1 + ddx, yt + ddy);
        ctx.lineTo(x0 + ddx, yt + ddy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  dispose() {
    // オフスクリーン等を持たないため解放対象なし
  }
}

// 表現方法は持たない（常に3Dバー）
Bar3dRenderer.methods = [];
