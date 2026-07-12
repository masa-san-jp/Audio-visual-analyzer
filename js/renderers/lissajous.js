// T11 オシロスコープ — doc/spec-phase6.md §6.11
// 時間波形をアナログオシロ風に描く XY（リサージュ）表示。
// x_i = time[i], y_i = time[i+delay] を [-1,1] 正規化して中央にプロットする。
// ステートフルレンダラー（背景クリアはコア側 _clearWithAfterimage が行う。selfClear ではない）。
// 残像併用（afterimage）で輝線らしさが出る前提で、自前クリアはしない。

class LissajousRenderer {
  constructor(canvas) {
    // ── 固定長プールの事前確保（毎フレームの新規確保を避ける） ──
    // time 配列長 = fftSize = 2048。頂点上限も 2048（性能予算 §6.11）。
    this.MAX_POINTS = 2048;
    this._px = new Float32Array(this.MAX_POINTS);
    this._py = new Float32Array(this.MAX_POINTS);

    // レイアウト（中心・スケール）を算出
    this._layout(canvas);
  }

  // canvas サイズから中心とプロットスケールを算出。
  // 16:9 / 1:1 のどちらでも収まるよう短辺基準（min(w,h)*0.4）でスケールする。
  _layout(canvas) {
    const w = canvas ? canvas.width : 0;
    const h = canvas ? canvas.height : 0;
    this.cx = w / 2;
    this.cy = h / 2;
    this.scale = Math.min(w, h) * 0.4;
  }

  onResize(canvas) {
    // サイズ変更時はレイアウトのみ再計算（保持状態なし）
    this._layout(canvas);
  }

  render(ctx, canvas, frame, settings) {
    // ── ガード: canvas 0 サイズ ──
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    if (!frame) return;

    // サイズが変わっていたらレイアウト追従（onResize 未呼び出しでも破綻しない）
    if (this.cx !== canvas.width / 2 || this.cy !== canvas.height / 2) {
      this._layout(canvas);
    }

    const cx = this.cx;
    const cy = this.cy;
    const scale = this.scale;
    const barWidth = settings.barWidth != null ? settings.barWidth : 2;

    const time = frame.time;
    // ── ガード: time が null なら中央に点を打って終了（無音相当の表示） ──
    if (!time || time.length === 0) {
      this._drawCenterDot(ctx, cx, cy, barWidth, settings);
      return;
    }

    const len = time.length;
    const sens = settings.sensitivity != null ? settings.sensitivity : 1.0;

    // ── 位相遅延: delay = 128 + baseOffset*4（0..99 → 128..524） ──
    // len で剰余を取り、必ず範囲内に収める。
    const baseOffset = clamp(settings.baseOffset != null ? settings.baseOffset : 0, 0, 99);
    const delay = (128 + baseOffset * 4) % len;

    // ── 点数: density 30..100 を 256..2048 に線形補間して間引く ──
    const density = clamp(settings.density != null ? settings.density : 100, 30, 100);
    let pointCount = Math.round(lerp(256, this.MAX_POINTS, (density - 30) / 70));
    if (pointCount < 2) pointCount = 2;
    if (pointCount > len) pointCount = len;
    if (pointCount > this.MAX_POINTS) pointCount = this.MAX_POINTS;

    // ── 波形の RMS（振れ幅）で輝度を決める（色は makeColor、中庸の明るさに保つ） ──
    // 併せて無音（中心128に張り付き）を検出。
    const px = this._px;
    const py = this._py;
    let sumSq = 0;
    for (let i = 0; i < pointCount; i++) {
      const srcIdx = Math.floor(i * len / pointCount);
      const dstIdx = (srcIdx + delay) % len;
      // [0,255] 中心128 → [-1,1] に正規化
      const nx = (time[srcIdx] - 128) / 128;
      const ny = (time[dstIdx] - 128) / 128;
      sumSq += nx * nx + ny * ny;
      px[i] = cx + nx * scale;
      py[i] = cy + ny * scale;
    }
    const rms = Math.sqrt(sumSq / (pointCount * 2));

    // ── 無音判定: 振れ幅がごく小さければ中央に収束（点/短線） ──
    if (rms < 0.004) {
      this._drawCenterDot(ctx, cx, cy, barWidth, settings);
      return;
    }

    // 輝線らしさのため amp は中庸（0.35）を下限に、RMS×感度で持ち上げる。
    const amp = clamp(0.35 + rms * sens, 0, 1);
    const color = makeColor(settings.hue, amp, settings);

    const method = settings.expressionMethod === 'dot' ? 'dot' : 'line';

    if (method === 'dot') {
      // ── 点描 ──
      const dotSize = Math.max(1, barWidth);
      const half = dotSize / 2;
      ctx.fillStyle = color;
      for (let i = 0; i < pointCount; i++) {
        ctx.fillRect(px[i] - half, py[i] - half, dotSize, dotSize);
      }
    } else {
      // ── ポリライン（単一パス） ──
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, barWidth);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(px[0], py[0]);
      for (let i = 1; i < pointCount; i++) ctx.lineTo(px[i], py[i]);
      ctx.stroke();
    }
  }

  // 無音・time 欠落時: 中央に小さな点を描く（残像に埋もれない輝点）。
  _drawCenterDot(ctx, cx, cy, barWidth, settings) {
    const size = Math.max(2, barWidth);
    const half = size / 2;
    ctx.fillStyle = makeColor(settings.hue, 0.5, settings);
    ctx.fillRect(cx - half, cy - half, size, size);
  }

  dispose() {
    this._px = null;
    this._py = null;
  }
}
