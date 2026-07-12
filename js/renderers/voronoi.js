// T13 ボロノイ脈動 — doc/spec-phase6.md §6.13
// 画面をボロノイ分割し、各セルの明度・彩度・スケールが担当帯域に反応して脈打つモザイク。
// ステートフルレンダラー（背景クリアはコア側 _clearWithAfterimage が行う。selfClear ではない）。

class VoronoiRenderer {
  constructor(canvas) {
    // ── 性能予算 §6.13: セル ≤ 80 ──
    this.MAX_CELLS = 80;
    this.MIN_CELLS = 20;
    this.SEED = 1337;      // 決定的なサイト配置用シード
    this.JITTER = 0.65;    // 格子からの揺らぎ量（0=整列, 1=最大）

    // 構築済みセル群。各要素: { polygon:[{x,y}], cx, cy, bandLo, bandHi }
    // onResize / セル数変更まで再計算しない（O(n^2) と重いため）。
    this.cells = null;

    // 構築時の状態（変化検出に使う）
    this._w = 0;           // 構築に使った canvas 幅
    this._h = 0;           // 構築に使った canvas 高さ
    this._cellCount = 0;   // 実際に生成したセル数
    this.lastAmount = -1;  // 前フレームの particleAmount

    // ビート増光値（+0.15 から実時間で減衰させて全セルを一瞬明るくする）
    this._beatFlash = 0;
  }

  onResize(canvas) {
    // サイズ変更時にセルを作り直す（構築は _rebuild 内で遅延実行してもよい）
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      this.cells = null; // 0 サイズなら破棄。render 側で遅延構築する。
      return;
    }
    this._rebuild(canvas.width, canvas.height, this._amountToCount(this.lastAmount));
  }

  // particleAmount(10..100) → セル数(20..80)
  _amountToCount(amount) {
    const a = clamp(amount != null ? amount : 50, 10, 100);
    const t = (a - 10) / 90; // 0..1
    const count = Math.round(this.MIN_CELLS + t * (this.MAX_CELLS - this.MIN_CELLS));
    return clamp(count, this.MIN_CELLS, this.MAX_CELLS);
  }

  // 目標セル数と canvas アスペクトから cols/rows を決めてセルを構築する。
  _rebuild(w, h, targetCount) {
    if (!w || !h) { this.cells = null; return; }

    // アスペクト比に沿って列・行を決める（16:9 でも 1:1 でも破綻しないように）
    const aspect = w / h;
    let cols = Math.max(1, Math.round(Math.sqrt(targetCount * aspect)));
    let rows = Math.max(1, Math.round(targetCount / cols));
    // 実セル数が上限を超えないように調整
    while (cols * rows > this.MAX_CELLS) {
      if (cols >= rows) cols--; else rows--;
    }
    cols = Math.max(1, cols);
    rows = Math.max(1, rows);
    const count = cols * rows;

    // サイト（0..1 正規化）→ 画素座標へ変換してボロノイセルを計算
    const sitesNorm = generateJitteredSites(cols, rows, this.JITTER, this.SEED);
    const sitesPx = [];
    for (let i = 0; i < sitesNorm.length; i++) {
      sitesPx.push({ x: sitesNorm[i].x * w, y: sitesNorm[i].y * h });
    }
    const raw = computeVoronoiCells(sitesPx, w, h);

    // 重心を事前計算し、x 座標順に並べて帯域を割り当てる（左=低域）。
    const cells = [];
    for (let i = 0; i < raw.length; i++) {
      const poly = raw[i].polygon;
      if (!poly || poly.length < 3) continue; // 退化セルは除外
      const c = this._centroid(poly);
      cells.push({ polygon: poly, cx: c.x, cy: c.y, bandLo: 0, bandHi: 0 });
    }
    // 重心 x の昇順で帯域インデックスを割当（左端が最低域）
    cells.sort((a, b) => a.cx - b.cx);
    const n = cells.length;
    for (let i = 0; i < n; i++) {
      // 帯域比率を保存（freq 長は毎フレーム変わり得るので実インデックスは描画時に算出）
      cells[i]._loFrac = i / n;
      cells[i]._hiFrac = (i + 1) / n;
    }

    this.cells = cells;
    this._w = w;
    this._h = h;
    this._cellCount = count;
  }

  // 多角形の重心（面積重み付き。縮小の中心に使う）
  _centroid(poly) {
    let area = 0, cx = 0, cy = 0;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n];
      const cross = p.x * q.y - q.x * p.y;
      area += cross;
      cx += (p.x + q.x) * cross;
      cy += (p.y + q.y) * cross;
    }
    if (Math.abs(area) < 1e-9) {
      // 面積ゼロ（退化）は頂点平均で代用
      let sx = 0, sy = 0;
      for (let i = 0; i < n; i++) { sx += poly[i].x; sy += poly[i].y; }
      return { x: sx / n, y: sy / n };
    }
    area *= 0.5;
    return { x: cx / (6 * area), y: cy / (6 * area) };
  }

  render(ctx, canvas, frame, settings) {
    // ── ガード: canvas 0 サイズ / frame・freq 欠落 ──
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    if (!frame) return;
    const freq = frame.freq;
    if (!freq || freq.length === 0) return;

    const w = canvas.width, h = canvas.height;

    // ── particleAmount 変化 or サイズ変化 or 未構築 → 再構築 ──
    const amount = settings.particleAmount != null ? settings.particleAmount : 50;
    const targetCount = this._amountToCount(amount);
    if (!this.cells || this._w !== w || this._h !== h || amount !== this.lastAmount) {
      this._rebuild(w, h, targetCount);
    }
    this.lastAmount = amount;
    if (!this.cells || this.cells.length === 0) return; // 構築失敗時は安全に抜ける

    const dtMs = (frame.dtMs && frame.dtMs > 0) ? frame.dtMs : 16.7;
    const sens = settings.sensitivity != null ? settings.sensitivity : 1.0;
    const barWidth = settings.barWidth != null ? settings.barWidth : 2;
    // 単層タイプ: baseHue は settings.hue（レイヤー指定があれば layers[0]）
    let baseHue = settings.hue != null ? settings.hue : 0;
    if (settings.layers && settings.layers[0] && settings.layers[0].hueOffset != null) {
      baseHue = baseHue + settings.layers[0].hueOffset;
    }

    // ── ビート増光の更新（実時間で減衰） ──
    if (frame.beat && frame.beat.isBeat) {
      this._beatFlash = 0.15; // +15% 相当
    } else {
      // 約 250ms で減衰
      this._beatFlash *= Math.exp(-dtMs / 250);
      if (this._beatFlash < 0.001) this._beatFlash = 0;
    }

    const len = freq.length;
    const cells = this.cells;
    const n = cells.length;

    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.5, barWidth);

    for (let ci = 0; ci < n; ci++) {
      const cell = cells[ci];
      const poly = cell.polygon;

      // 担当帯域の平均振幅（左=低域）
      let lo = Math.floor(cell._loFrac * len);
      let hi = Math.floor(cell._hiFrac * len);
      if (hi <= lo) hi = lo + 1;
      if (hi > len) hi = len;
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += freq[k];
      const raw = (sum / (hi - lo)) / 255;
      const amp = clamp(raw * sens, 0, 1);

      // 色: makeColor に振幅＋ビート増光を渡して明度・彩度を決定
      const ampColor = clamp(amp + this._beatFlash, 0, 1);
      const fill = makeColor(baseHue, ampColor, settings);

      // 縮小率: 静かなセルほど重心へ縮む（0..15%）。大音量で満ちて脈動して見える。
      const shrink = (1 - amp) * 0.15;
      const keep = 1 - shrink; // 頂点を重心方向へ寄せる係数
      const ccx = cell.cx, ccy = cell.cy;

      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const px = ccx + (poly[i].x - ccx) * keep;
        const py = ccy + (poly[i].y - ccy) * keep;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();

      ctx.fillStyle = fill;
      ctx.fill();

      // セル境界線（線幅 = barWidth）。少し明るめの色で縁取る。
      ctx.strokeStyle = makeColor(baseHue, clamp(ampColor + 0.2, 0, 1), settings);
      ctx.stroke();
    }
  }

  dispose() {
    this.cells = null;
  }
}
