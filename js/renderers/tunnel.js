// T4 トンネル — doc/spec-phase6.md §6.4
// radial のリングが奥（中心）から手前（外周）へ湧き出て抜けていく擬似3Dトンネル。
// ステートフルレンダラー（背景クリアはコア側 _clearWithAfterimage が行う。selfClear ではない）。

class TunnelRenderer {
  constructor(canvas) {
    // ── 固定長プールの事前確保（毎フレームの新規確保を避ける） ──
    this.MAX_RINGS = 24;   // リング上限（性能予算 §6.4）
    this.SNAP = 64;        // 1リングが保持する freq のダウンサンプル数
    this.MAX_SEG = 96;     // 1リングのセグメント上限

    // リング状態プール。active=false のスロットは未使用。
    this.rings = new Array(this.MAX_RINGS);
    for (let i = 0; i < this.MAX_RINGS; i++) {
      this.rings[i] = {
        active: false,
        scale: 0,
        freqSnapshot: new Float32Array(this.SNAP), // 0..1 に正規化済み
      };
    }

    // far→near 描画用の並べ替えインデックス（毎フレーム使い回す）
    this._order = new Int32Array(this.MAX_RINGS);

    // 頂点座標の一時バッファ（描画のたびに使い回す）
    this._px = new Float32Array(this.MAX_SEG);
    this._py = new Float32Array(this.MAX_SEG);

    // スポーン用の時間アキュムレータ（ミリ秒）
    this._spawnAccMs = 0;

    // レイアウト（onResize / 初期化で算出、render でも安全に再計算する）
    this._layout(canvas);
  }

  // canvas サイズからトンネルの中心・基準半径を算出
  _layout(canvas) {
    const w = canvas ? canvas.width : 0;
    const h = canvas ? canvas.height : 0;
    this.cx = w / 2;
    this.cy = h / 2;
    const maxR = Math.min(this.cx, this.cy) * 0.95; // 画面内に収まる最大半径
    this.maxR = maxR;
    // scale=1.6（破棄直前）でほぼ maxR に届くよう基準半径を決める
    this.baseRadius = maxR * 0.6;
  }

  onResize(canvas) {
    // サイズ変更時はレイアウトのみ再計算（リング状態は維持してよい）
    this._layout(canvas);
  }

  render(ctx, canvas, frame, settings) {
    // ── ガード: canvas 0 サイズ / frame・freq 欠落 ──
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    if (!frame) return;
    const freq = frame.freq;
    if (!freq || freq.length === 0) return;

    // サイズが変わっていたらレイアウト追従（onResize 未呼び出しでも破綻しない）
    if (this.cx !== canvas.width / 2 || this.cy !== canvas.height / 2) {
      this._layout(canvas);
    }

    const dtMs = (frame.dtMs && frame.dtMs > 0) ? frame.dtMs : 16.7;
    const motion = clamp(settings.motionSpeed != null ? settings.motionSpeed : 1.0, 0.1, 3.0);
    const historySeconds = clamp(settings.historySeconds != null ? settings.historySeconds : 4, 1, 8);
    const sens = settings.sensitivity != null ? settings.sensitivity : 1.0;
    const method = settings.expressionMethod === 'dot' ? 'dot' : 'line';

    // ── スポーン間隔: historySeconds と motionSpeed から算出 ──
    // 速いほど・時間幅が短いほど密に湧き出す。プールを埋め切るよう MAX_RINGS で割る。
    let spawnIntervalMs = (historySeconds * 1000) / (this.MAX_RINGS * motion);
    if (spawnIntervalMs < 30) spawnIntervalMs = 30; // 過剰スポーン防止

    this._spawnAccMs += dtMs;
    if (this._spawnAccMs >= spawnIntervalMs) {
      // 1フレームにつき最大1本だけ生成（バースト回避）
      this._spawnAccMs = this._spawnAccMs % spawnIntervalMs;
      this._spawnRing(freq);
    }

    // ── 成長: scale を実時間基準で指数的に拡大 ──
    // 寿命 = historySeconds / motion のとき scale 0.05→1.6（比 32, ln≈3.466）
    const growthPerSec = motion * 3.4657 / historySeconds;
    const growthFactor = Math.exp(growthPerSec * (dtMs / 1000));
    for (let i = 0; i < this.MAX_RINGS; i++) {
      const r = this.rings[i];
      if (!r.active) continue;
      r.scale *= growthFactor;
      if (r.scale > 1.6) r.active = false; // 手前を抜けたら破棄
    }

    // ── far→near（scale 昇順）に並べ替え（挿入ソート・追加確保なし） ──
    let count = 0;
    for (let i = 0; i < this.MAX_RINGS; i++) {
      if (this.rings[i].active) this._order[count++] = i;
    }
    for (let a = 1; a < count; a++) {
      const idx = this._order[a];
      const sc = this.rings[idx].scale;
      let b = a - 1;
      while (b >= 0 && this.rings[this._order[b]].scale > sc) {
        this._order[b + 1] = this._order[b];
        b--;
      }
      this._order[b + 1] = idx;
    }

    // ── セグメント数: density 準拠で上限クランプ ──
    const density = clamp(settings.density != null ? settings.density : 100, 30, 100);
    let segCount = Math.round(this.MAX_SEG * density / 100);
    if (segCount < 12) segCount = 12;
    if (segCount > this.MAX_SEG) segCount = this.MAX_SEG;

    const barWidth = settings.barWidth != null ? settings.barWidth : 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 奥→手前の順に描画
    for (let o = 0; o < count; o++) {
      this._drawRing(ctx, this.rings[this._order[o]], segCount, sens, barWidth, method, settings);
    }
  }

  // 現在の freq をダウンサンプルして新リングを生成（未使用スロットを再利用）
  _spawnRing(freq) {
    let slot = -1;
    for (let i = 0; i < this.MAX_RINGS; i++) {
      if (!this.rings[i].active) { slot = i; break; }
    }
    if (slot < 0) return; // 満杯なら間引く（新規確保しない）

    const r = this.rings[slot];
    const snap = r.freqSnapshot;
    const len = freq.length;
    for (let i = 0; i < this.SNAP; i++) {
      const idx = Math.floor(i * len / this.SNAP);
      snap[i] = freq[idx] / 255; // 0..1
    }
    r.scale = 0.05; // 奥（中心）から出発
    r.active = true;
  }

  // 1リングを radial 形状で描画。奥（scale 小）ほど暗く細く。
  _drawRing(ctx, ring, segCount, sens, barWidth, method, settings) {
    const scale = ring.scale;
    const snap = ring.freqSnapshot;
    const cx = this.cx;
    const cy = this.cy;
    const baseRadius = this.baseRadius;

    // 深度係数: scale 0.05→1.6 を 0..1 に。手前ほど大きい。
    const depth = clamp((scale - 0.05) / (1.6 - 0.05), 0, 1);
    // 手前ほど明るく、生成直後と破棄直前はフェードして連続感を出す
    const fadeIn = clamp(scale / 0.2, 0, 1);
    const fadeOut = clamp((1.6 - scale) / 0.35, 0, 1);
    const alpha = clamp((0.25 + 0.75 * depth) * fadeIn * fadeOut, 0, 1);
    if (alpha <= 0.01) return;

    // リング振幅の平均（色決定用）
    let ampSum = 0;
    for (let i = 0; i < this.SNAP; i++) ampSum += snap[i];
    const avgAmp = clamp((ampSum / this.SNAP) * sens, 0, 1);

    // 変位量: 手前ほど大きく効く（奥は小さくまとまる）
    const dispMax = baseRadius * 0.4 * (0.3 + 0.7 * depth);
    const ringR = scale * baseRadius;

    // 頂点を一時バッファへ算出
    const px = this._px;
    const py = this._py;
    for (let i = 0; i < segCount; i++) {
      const sidx = Math.floor(i * this.SNAP / segCount) % this.SNAP;
      const val = clamp(snap[sidx] * sens, 0, 1);
      const r = ringR + val * dispMax;
      const angle = (i / segCount) * Math.PI * 2 - Math.PI / 2;
      px[i] = cx + Math.cos(angle) * r;
      py[i] = cy + Math.sin(angle) * r;
    }

    if (method === 'dot') {
      // 点のみ。奥ほど小さい点。
      const dotSize = Math.max(1, barWidth * (0.4 + 0.6 * depth));
      const half = dotSize / 2;
      for (let i = 0; i < segCount; i++) {
        const sidx = Math.floor(i * this.SNAP / segCount) % this.SNAP;
        const val = clamp(snap[sidx] * sens, 0, 1);
        ctx.fillStyle = makeColor(settings.hue, val, settings, alpha);
        ctx.fillRect(px[i] - half, py[i] - half, dotSize, dotSize);
      }
    } else {
      // 閉じたポリライン。奥ほど細い線。
      ctx.lineWidth = Math.max(0.5, barWidth * (0.35 + 0.65 * depth));
      ctx.strokeStyle = makeColor(settings.hue, avgAmp, settings, alpha);
      ctx.beginPath();
      ctx.moveTo(px[0], py[0]);
      for (let i = 1; i < segCount; i++) ctx.lineTo(px[i], py[i]);
      ctx.closePath();
      ctx.stroke();
    }
  }

  dispose() {
    this.rings = null;
    this._order = null;
    this._px = null;
    this._py = null;
  }
}
