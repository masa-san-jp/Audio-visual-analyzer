// T1 スペクトログラム（滝） — doc/spec-phase6.md §6.1
// selfClear タイプ。オフスクリーンcanvasを保持し、毎フレーム全面を自分で塗る。
// 横軸=時間（右端が現在）、縦軸=周波数（対数スケール・下=低域）、色=強度。

class SpectrogramRenderer {
  constructor(canvas) {
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.off.width = 0;
    this.off.height = 0;
    // 細かな時間表現のため、端数の送りを溜めるアキュムレータ
    this._shiftAcc = 0;
    if (canvas) this.onResize(canvas);
  }

  onResize(canvas) {
    if (!canvas) return;
    const w = canvas.width | 0;
    const h = canvas.height | 0;
    if (w <= 0 || h <= 0) return;
    if (this.off.width !== w || this.off.height !== h) {
      this.off.width = w;
      this.off.height = h;
    }
    if (this.offCtx) {
      this.offCtx.fillStyle = '#000';
      this.offCtx.fillRect(0, 0, w, h);
    }
  }

  render(ctx, canvas, frame, settings) {
    if (!ctx || !canvas) return;
    const w = canvas.width | 0;
    const h = canvas.height | 0;
    if (w <= 0 || h <= 0) return;
    const freq = frame && frame.freq;
    if (!freq || freq.length === 0) return;
    if (!this.offCtx) return;

    if (this.off.width !== w || this.off.height !== h) this.onResize(canvas);

    const octx = this.offCtx;
    const bg = settings && settings.bgColor === '#fff' ? '#fff' : '#000';
    const sens = settings && settings.sensitivity != null ? settings.sensitivity : 1;
    const hist = settings && settings.historySeconds != null ? settings.historySeconds : 4;

    // 1フレームで左へずらす画素数。繊細な時間表現のため 1〜2px に抑える。
    // 端数はアキュムレータに溜めて平均送り量を保つ。
    const dt = frame.dtMs != null ? clamp(frame.dtMs / 16.7, 0.2, 3) : 1;
    const wantShift = (w / (hist * 90)) * dt;
    this._shiftAcc += wantShift;
    let shiftPx = Math.floor(this._shiftAcc);
    if (shiftPx < 1) shiftPx = 1;
    if (shiftPx > 4) shiftPx = 4;
    this._shiftAcc -= shiftPx;
    // 強制的に1px送った分が wantShift の実績を上回っても負債を残さない
    // （残さないと wantShift が後で増えたときに解消まで1pxへ張り付き続ける）
    if (this._shiftAcc < 0) this._shiftAcc = 0;

    // オフスクリーンを丸ごと左へずらす（自己 drawImage）
    octx.drawImage(this.off, -shiftPx, 0);

    // 右端の新規列を背景色でクリア
    const xCol = w - shiftPx;
    octx.fillStyle = bg;
    octx.fillRect(xCol, 0, shiftPx, h);

    // 縦解像度: 高さいっぱいの行数（1pxごと）で描き、繊細な帯を作る。
    const len = freq.length;
    const rows = Math.min(h, 720);
    const rowH = h / rows;
    const hue = settings && settings.hue != null ? settings.hue : 0;

    // 各行を対数周波数スケールで配置（下=低域）。
    // 強度は log/gamma で持ち上げて微弱な成分も繊細に見せる。
    for (let i = 0; i < rows; i++) {
      const frac = rows > 1 ? i / (rows - 1) : 0;
      // 対数マッピング: bin = len^frac - 1
      let bin = Math.round(Math.pow(len, frac)) - 1;
      if (bin < 0) bin = 0; else if (bin >= len) bin = len - 1;
      // 隣接ビンとの平均で滑らかに（繊細化）
      const b0 = bin > 0 ? freq[bin - 1] : freq[bin];
      const b2 = bin < len - 1 ? freq[bin + 1] : freq[bin];
      const raw = (freq[bin] * 2 + b0 + b2) / 4 / 255;
      let amp = clamp(raw * sens, 0, 1);
      // gamma で微弱成分を持ち上げる（0.55）
      amp = Math.pow(amp, 0.55);
      if (amp <= 0.02) continue; // ごく微弱は背景を残す
      octx.fillStyle = makeColor(hue, amp, settings, clamp(amp * 1.3, 0.15, 1));
      octx.fillRect(xCol, h - (i + 1) * rowH, shiftPx, rowH + 1);
    }

    // メインへ転写（selfClear なので全面をこれで塗る）
    ctx.drawImage(this.off, 0, 0);
  }

  dispose() {
    this.off = null;
    this.offCtx = null;
  }
}
