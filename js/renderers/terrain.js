// T3 3D地形 — doc/spec-phase6.md §6.3
// 過去 N フレームの周波数列を奥行き方向に並べ、平行投影で描く擬似3D地形。
// ステートフルレンダラー（クラス）。背景クリアはコアが行う（selfClear ではない）。

class TerrainRenderer {
  constructor(canvas) {
    // レイアウト定数・スクラッチ配列を初期化。オフスクリーンは不要。
    this.W = 0;
    this.H = 0;
    this.cx = 0;

    // 頂点上限（rows ≤ 90, cols ≤ 96）。1行分の投影座標を使い回す固定長バッファ。
    this.MAX_COLS = 96;
    this._xs = new Float32Array(this.MAX_COLS); // 投影後 x
    this._ys = new Float32Array(this.MAX_COLS); // 投影後 y

    // 平行投影係数（isoProject 用）。ky=1 で高さをピクセルに1:1、kx で右方向へ傾ける。
    this.ISO_KX = 0.3;
    this.ISO_KY = 1.0;

    this.onResize(canvas);
  }

  // canvas サイズ変更時にキャンバス依存のスカラーを再計算（配列は使い回す）。
  onResize(canvas) {
    this.W = canvas ? canvas.width : 0;
    this.H = canvas ? canvas.height : 0;
    this.cx = this.W / 2;
  }

  dispose() {
    this._xs = null;
    this._ys = null;
  }

  render(ctx, canvas, frame, settings) {
    // ── ガード ──
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    if (!frame || !frame.history || frame.history.size === 0) return;

    const W = canvas.width;
    const H = canvas.height;
    // リサイズ検知（onResize 未呼び出しでも破綻しないよう保険）。
    if (W !== this.W || H !== this.H) this.onResize(canvas);
    const cx = this.cx;

    const hist = frame.history;
    const size = hist.size;
    const frameLen = hist.frameLength | 0;
    if (frameLen <= 0) return;

    // ── 設定 ──
    const sensitivity = settings && settings.sensitivity != null ? settings.sensitivity : 1;
    const density = settings && settings.density != null ? settings.density : 50;
    const baseOffset = settings && settings.baseOffset != null ? settings.baseOffset : 50;
    const method = settings && settings.expressionMethod ? settings.expressionMethod : 'line';
    const lineW = settings && settings.barWidth != null ? Math.max(1, settings.barWidth) : 2;
    const hue = settings && settings.hue != null ? settings.hue : 200;
    const bg = settings && settings.bgColor ? settings.bgColor : '#000';

    // ── 行数・列数 ──
    // rows: 履歴から等間隔サンプルする行数（奥行き）。cols: 各行の周波数解像度。
    const rows = Math.min(size, 90);
    let cols = 32 + Math.round((density / 100) * 64);
    if (cols > this.MAX_COLS) cols = this.MAX_COLS;
    if (cols < 2) cols = 2;

    // ── レイアウト（キャンバス基準）──
    const frontHalf = W * 0.45;        // 最前列の半幅（画面幅の 90%）
    const depthSpan = H * 0.32;        // 奥行きで持ち上がる量（奥ほど上へ）
    const elevPx = H * 0.28;           // 高さ振幅の最大ピクセル
    // baseOffset(0..99): 地形全体の縦位置。大きいほど下へ。
    const frontBaseY = H * (0.30 + (baseOffset / 99) * 0.50);

    const rowDenom = rows > 1 ? rows - 1 : 1;
    const colDenom = cols > 1 ? cols - 1 : 1;
    const binDenom = frameLen > 1 ? frameLen - 1 : 1;
    const kx = this.ISO_KX;
    const ky = this.ISO_KY;

    if (method === 'dot') {
      this._renderDots(ctx, rows, cols, size, hist, {
        sensitivity, hue, cx, frontHalf, depthSpan, elevPx, frontBaseY,
        rowDenom, colDenom, binDenom, kx, ky, lineW, settings,
      });
    } else {
      // 既定は line（稜線 + 隠面処理の代替）。
      this._renderLines(ctx, canvas, rows, cols, size, hist, {
        sensitivity, hue, cx, frontHalf, depthSpan, elevPx, frontBaseY,
        rowDenom, colDenom, binDenom, kx, ky, lineW, bg, settings,
      });
    }
  }

  // 稜線モード: 奥→手前の順に描き、各稜線の下側を背景色で塗ってから線を引く。
  // これで手前の山が奥を隠す（隠面処理の代替）。
  _renderLines(ctx, canvas, rows, cols, size, hist, p) {
    const H = canvas.height;
    const xs = this._xs;
    const ys = this._ys;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = p.lineW;

    // r=0 が最前（最新, age=0）。奥（r=rows-1, 最古）から描く。
    for (let r = rows - 1; r >= 0; r--) {
      const depth = rows > 1 ? r / p.rowDenom : 0; // 0=手前, 1=奥
      const rowScale = 1 - depth * 0.6;             // 奥ほど中央へ縮小（狭く）
      const rowW = p.frontHalf * rowScale;
      const baseY = p.frontBaseY - depth * p.depthSpan; // 奥ほど上へ

      // 履歴 age を等間隔サンプル（age=0 が最新=手前）。
      const age = Math.round(r * (size - 1) / p.rowDenom);
      const freqRow = hist.get(age);
      if (!freqRow) continue;

      // 頂点を投影しつつ、行の平均振幅を蓄積（線色決定用）。
      let ampSum = 0;
      for (let c = 0; c < cols; c++) {
        const bin = Math.round(c * p.binDenom / p.colDenom);
        const v = freqRow[bin] / 255;
        const amp = clamp(v * p.sensitivity, 0, 1);
        ampSum += amp;
        const hPx = amp * p.elevPx;                 // 高さ（ピクセル）
        const colNorm = (c / p.colDenom) - 0.5;     // -0.5..0.5
        const groundX = p.cx + colNorm * rowW * 2;
        // isoProject: 高さで上へ + 右へ傾ける。
        const pr = isoProject(groundX, baseY, hPx, p.kx, p.ky);
        xs[c] = pr.x;
        ys[c] = pr.y;
      }

      // 稜線の下側を背景色で塗り、奥の稜線を遮蔽する。
      ctx.fillStyle = p.bg;
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let c = 1; c < cols; c++) ctx.lineTo(xs[c], ys[c]);
      ctx.lineTo(xs[cols - 1], H);
      ctx.lineTo(xs[0], H);
      ctx.closePath();
      ctx.fill();

      // 線色: 行平均振幅を奥行きで減衰（奥ほど暗く）。
      const rowAmp = ampSum / cols;
      const depthDim = 1 - depth * 0.65;
      const amp = clamp(rowAmp * depthDim, 0, 1);
      ctx.strokeStyle = makeColor(p.hue, amp, p.settings);

      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let c = 1; c < cols; c++) ctx.lineTo(xs[c], ys[c]);
      ctx.stroke();
    }
  }

  // 点描モード: 頂点を点として打つ（遮蔽塗りなし）。
  _renderDots(ctx, rows, cols, size, hist, p) {
    const dotSize = Math.max(1, p.lineW);
    const half = dotSize / 2;

    // 奥→手前の順（手前を上に重ねる）。
    for (let r = rows - 1; r >= 0; r--) {
      const depth = rows > 1 ? r / p.rowDenom : 0;
      const rowScale = 1 - depth * 0.6;
      const rowW = p.frontHalf * rowScale;
      const baseY = p.frontBaseY - depth * p.depthSpan;
      const depthDim = 1 - depth * 0.65;

      const age = Math.round(r * (size - 1) / p.rowDenom);
      const freqRow = hist.get(age);
      if (!freqRow) continue;

      for (let c = 0; c < cols; c++) {
        const bin = Math.round(c * p.binDenom / p.colDenom);
        const v = freqRow[bin] / 255;
        const amp = clamp(v * p.sensitivity, 0, 1);
        if (amp < 0.01) continue;
        const hPx = amp * p.elevPx;
        const colNorm = (c / p.colDenom) - 0.5;
        const groundX = p.cx + colNorm * rowW * 2;
        const pr = isoProject(groundX, baseY, hPx, p.kx, p.ky);

        const cAmp = clamp(amp * depthDim, 0, 1);
        ctx.fillStyle = makeColor(p.hue, cAmp, p.settings);
        ctx.fillRect(pr.x - half, pr.y - half, dotSize, dotSize);
      }
    }
  }
}
