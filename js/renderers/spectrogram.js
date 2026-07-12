// T1/T2 スペクトログラム — doc/spec-phase6.md §6.1 / §6.2
// どちらも selfClear タイプ。オフスクリーンcanvasを保持し、毎フレーム全面を自分で塗る。

// ── T1 スペクトログラム（滝） ── §6.1
// 横軸=時間（右端が現在）、縦軸=周波数（対数スケール・下=低域）、色=強度。
class SpectrogramRenderer {
  constructor(canvas) {
    // オフスクリーンはコンストラクタで生成し、サイズは onResize で合わせる
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.off.width = 0;
    this.off.height = 0;
    if (canvas) this.onResize(canvas);
  }

  // メインと同サイズにオフスクリーンを作り直す。0サイズは弾く。
  onResize(canvas) {
    if (!canvas) return;
    const w = canvas.width | 0;
    const h = canvas.height | 0;
    if (w <= 0 || h <= 0) return;
    if (this.off.width !== w || this.off.height !== h) {
      this.off.width = w;
      this.off.height = h;
    }
    // リサイズ時は履歴（絵）をクリアしてよい仕様
    if (this.offCtx) {
      this.offCtx.fillStyle = '#000';
      this.offCtx.fillRect(0, 0, w, h);
    }
  }

  render(ctx, canvas, frame, settings) {
    if (!ctx || !canvas) return;
    const w = canvas.width | 0;
    const h = canvas.height | 0;
    if (w <= 0 || h <= 0) return;               // 0サイズガード
    const freq = frame && frame.freq;
    if (!freq || freq.length === 0) return;     // 周波数データガード
    if (!this.offCtx) return;

    // サイズ変更を検知したら作り直し（onResize漏れの保険）
    if (this.off.width !== w || this.off.height !== h) this.onResize(canvas);

    const octx = this.offCtx;
    const bg = settings && settings.bgColor === '#fff' ? '#fff' : '#000';
    const sens = settings && settings.sensitivity != null ? settings.sensitivity : 1;
    const hist = settings && settings.historySeconds != null ? settings.historySeconds : 4;

    // 1フレームで左へずらす画素数（時間幅 → 画素の対応）
    const shiftPx = Math.max(1, Math.round(w / (hist * 60)));

    // オフスクリーンを丸ごと左へ shiftPx ずらす（自己 drawImage）
    octx.drawImage(this.off, -shiftPx, 0);

    // 右端 shiftPx 幅の新規列を背景色でクリア
    const xCol = w - shiftPx;
    octx.fillStyle = bg;
    octx.fillRect(xCol, 0, shiftPx, h);

    // 縦解像度: 使用ビン数を density（30〜100%）で間引き、fillRect 予算内に収める
    const len = freq.length;
    let density = settings && settings.density != null ? settings.density : 100;
    density = clamp(density, 30, 100) / 100;
    const rows = clamp(Math.round(len * density), 8, Math.min(h, 480));
    const rowH = h / rows;

    // 各行を対数周波数スケールで配置（下=低域）。無音は背景色のまま。
    const hue = settings && settings.hue != null ? settings.hue : 0;
    for (let i = 0; i < rows; i++) {
      const frac = rows > 1 ? i / (rows - 1) : 0;          // 0=最下 1=最上
      // 対数マッピング: bin = len^frac - 1
      let bin = Math.round(Math.pow(len, frac)) - 1;
      if (bin < 0) bin = 0; else if (bin >= len) bin = len - 1;
      const amp = clamp(freq[bin] / 255 * sens, 0, 1);
      if (amp <= 0.001) continue;                          // 無音は背景色を残す
      octx.fillStyle = makeColor(hue, amp, settings);
      // 下から積み上げ。継ぎ目防止に +1px 重ねる。
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

// ── T2 円形スペクトログラム（年輪） ── §6.2
// 中心=現在、外周=過去。角度=周波数、半径=時間。毎フレーム外側へドリフトさせる。
class SpectrogramRadialRenderer {
  constructor(canvas) {
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.off.width = 0;
    this.off.height = 0;
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
    if (w <= 0 || h <= 0) return;               // 0サイズガード
    const freq = frame && frame.freq;
    if (!freq || freq.length === 0) return;     // 周波数データガード
    if (!this.offCtx) return;

    if (this.off.width !== w || this.off.height !== h) this.onResize(canvas);

    const octx = this.offCtx;
    const bg = settings && settings.bgColor === '#fff' ? '#fff' : '#000';
    const sens = settings && settings.sensitivity != null ? settings.sensitivity : 1;
    const hue = settings && settings.hue != null ? settings.hue : 0;
    const motion = settings && settings.motionSpeed != null ? settings.motionSpeed : 1;

    // 中心（16:9 / 1:1 いずれも canvas 中央）と最大半径
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) * 0.95;
    if (maxR <= 0) { ctx.drawImage(this.off, 0, 0); return; }

    // 実時間基準のドリフト倍率（>1 で外側へ拡大）。motionSpeed で速度可変。
    const dt = frame.dtMs != null ? frame.dtMs : 16.7;
    let s = 1 + 0.012 * motion * clamp(dt / 16.7, 0, 3);
    s = clamp(s, 1.0, 1.2);

    // 既存の絵を中心基準で拡大コピー（年輪が外周へ流れる）
    octx.save();
    octx.translate(cx, cy);
    octx.scale(s, s);
    octx.translate(-cx, -cy);
    octx.drawImage(this.off, 0, 0);
    octx.restore();

    // 最内周リング（=現在）を新規描画する半径帯
    const rBand = Math.max(3, maxR * 0.05);

    // まず中心の円盤を背景色で消し込み（無音時は背景のまま残る）
    octx.beginPath();
    octx.arc(cx, cy, rBand, 0, Math.PI * 2);
    octx.fillStyle = bg;
    octx.fill();

    // 角度=周波数。セグメント ≤ 128。各セグメントを中心からの扇形で塗る。
    const len = freq.length;
    const segs = Math.min(128, len);
    const aStep = (Math.PI * 2) / segs;
    for (let i = 0; i < segs; i++) {
      const bin = Math.floor(i * len / segs);
      const amp = clamp(freq[bin] / 255 * sens, 0, 1);
      if (amp <= 0.02) continue;                 // 無音セグメントは背景を残す
      const a0 = i * aStep - Math.PI / 2;
      const a1 = a0 + aStep;
      octx.beginPath();
      octx.moveTo(cx, cy);
      octx.arc(cx, cy, rBand, a0, a1);
      octx.closePath();
      octx.fillStyle = makeColor(hue, amp, settings);
      octx.fill();
    }

    // メインへ転写（selfClear）
    ctx.drawImage(this.off, 0, 0);
  }

  dispose() {
    this.off = null;
    this.offCtx = null;
  }
}
