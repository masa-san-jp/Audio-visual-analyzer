// T13 ボロノイ脈動 — doc/spec-phase6.md §6.13
// 画面をボロノイ分割し、各セルが担当帯域に反応して脈打つモザイク。
// サイト（母点）をノイズで動的に動かし、形状そのものが常に変化する。
// ステートフルレンダラー（背景クリアはコア側 _clearWithAfterimage が行う。selfClear ではない）。

class VoronoiRenderer {
  constructor(canvas) {
    // ── 性能予算 §6.13: セル ≤ 80。動的再計算のため既定は控えめに ──
    this.MAX_CELLS = 64;
    this.MIN_CELLS = 20;
    this.SEED = 1337;
    this.JITTER = 0.7;

    // 基準サイト（正規化 0..1）。各サイトに安定した帯域割当(loFrac/hiFrac)と
    // ノイズ位相(seed)を持たせる。onResize / セル数変更まで再生成しない。
    this.baseSites = null;
    this._w = 0;
    this._h = 0;
    this.lastAmount = -1;

    // 徘徊ノイズと時間
    this.noise = new ValueNoise(0x9e37);
    this._t = 0;

    // ビート増光値（実時間で減衰）
    this._beatFlash = 0;

    // 描画用の一時サイト配列（px 座標。使い回してGCを避ける）
    this._sitesPx = [];
  }

  onResize(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      this.baseSites = null;
      return;
    }
    this._rebuild(canvas.width, canvas.height, this._amountToCount(this.lastAmount));
  }

  _amountToCount(amount) {
    const a = clamp(amount != null ? amount : 50, 10, 100);
    const t = (a - 10) / 90;
    return clamp(Math.round(this.MIN_CELLS + t * (this.MAX_CELLS - this.MIN_CELLS)),
                 this.MIN_CELLS, this.MAX_CELLS);
  }

  // 基準サイト（正規化）を生成し、x 順で安定した帯域割当を付与する。
  _rebuild(w, h, targetCount) {
    if (!w || !h) { this.baseSites = null; return; }

    const aspect = w / h;
    let cols = Math.max(1, Math.round(Math.sqrt(targetCount * aspect)));
    let rows = Math.max(1, Math.round(targetCount / cols));
    while (cols * rows > this.MAX_CELLS) { if (cols >= rows) cols--; else rows--; }
    cols = Math.max(1, cols);
    rows = Math.max(1, rows);

    const sitesNorm = generateJitteredSites(cols, rows, this.JITTER, this.SEED);
    const rng = makeRng(this.SEED ^ 0x55);
    const sites = [];
    for (let i = 0; i < sitesNorm.length; i++) {
      sites.push({
        nx: sitesNorm[i].x, ny: sitesNorm[i].y,
        seed: rng() * 100,          // ノイズ位相
        loFrac: 0, hiFrac: 0,       // 帯域割当（下でx順に確定）
      });
    }
    // 基準 x の昇順で帯域を割り当て（左=低域）。移動後もこの割当は固定。
    sites.sort((a, b) => a.nx - b.nx);
    const n = sites.length;
    for (let i = 0; i < n; i++) {
      sites[i].loFrac = i / n;
      sites[i].hiFrac = (i + 1) / n;
    }

    this.baseSites = sites;
    this._w = w;
    this._h = h;
  }

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
      let sx = 0, sy = 0;
      for (let i = 0; i < n; i++) { sx += poly[i].x; sy += poly[i].y; }
      return { x: sx / n, y: sy / n };
    }
    area *= 0.5;
    return { x: cx / (6 * area), y: cy / (6 * area) };
  }

  render(ctx, canvas, frame, settings) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    if (!frame) return;
    const freq = frame.freq;
    if (!freq || freq.length === 0) return;

    const w = canvas.width, h = canvas.height;
    const amount = settings.particleAmount != null ? settings.particleAmount : 50;
    if (!this.baseSites || this._w !== w || this._h !== h || amount !== this.lastAmount) {
      this._rebuild(w, h, this._amountToCount(amount));
    }
    this.lastAmount = amount;
    if (!this.baseSites || this.baseSites.length === 0) return;

    const dtMs = (frame.dtMs && frame.dtMs > 0) ? frame.dtMs : 16.7;
    const sens = settings.sensitivity != null ? settings.sensitivity : 1.0;
    const barWidth = settings.barWidth != null ? settings.barWidth : 2;
    const motion = clamp(settings.motionSpeed != null ? settings.motionSpeed : 1.0, 0.1, 3.0);
    let baseHue = settings.hue != null ? settings.hue : 0;
    if (settings.layers && settings.layers[0] && settings.layers[0].hueOffset != null) {
      baseHue += settings.layers[0].hueOffset;
    }

    // 時間を進める（サイト徘徊の速度は motionSpeed 連動）
    this._t += (dtMs / 1000) * motion * 0.35;

    // ビート増光
    if (frame.beat && frame.beat.isBeat) this._beatFlash = 0.25;
    else { this._beatFlash *= Math.exp(-dtMs / 220); if (this._beatFlash < 0.001) this._beatFlash = 0; }

    // ── サイトをノイズで動かして px 座標へ（形状が常に変化） ──
    const base = this.baseSites;
    const n = base.length;
    const len = freq.length;
    const wander = Math.min(w, h) * 0.06; // 徘徊量
    // n が変化したときのみ配列長を調整（要素オブジェクト自体は使い回す）
    const sites = this._sitesPx;
    if (sites.length !== n) sites.length = n;
    for (let i = 0; i < n; i++) {
      const s = base[i];
      // 担当帯域の平均振幅（サイト移動量にも寄与させ、音で暴れる）
      const lo = Math.floor(s.loFrac * len);
      let hi = Math.floor(s.hiFrac * len);
      if (hi <= lo) hi = lo + 1;
      if (hi > len) hi = len;
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += freq[k];
      const amp = clamp((sum / (hi - lo)) / 255 * sens, 0, 1);

      const dx = (this.noise.noise2(s.seed, this._t) - 0.5);
      const dy = (this.noise.noise2(s.seed + 50, this._t) - 0.5);
      // 音が大きいほど大きく動く（追従）
      const mv = wander * (0.5 + amp * 1.8);
      let obj = sites[i];
      if (!obj) { obj = { x: 0, y: 0, amp: 0 }; sites[i] = obj; }
      obj.x = clamp(s.nx * w + dx * mv, 0, w);
      obj.y = clamp(s.ny * h + dy * mv, 0, h);
      obj.amp = amp;
    }

    // ── ボロノイ再計算（毎フレーム。n ≤ 64 で O(n^2)） ──
    const cells = computeVoronoiCells(sites, w, h);

    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.5, barWidth);

    for (let ci = 0; ci < cells.length; ci++) {
      const poly = cells[ci].polygon;
      if (!poly || poly.length < 3) continue;
      const amp = sites[ci].amp;

      const ampColor = clamp(amp + this._beatFlash, 0, 1);
      const fill = makeColor(baseHue, ampColor, settings);

      // 縮小率: 静かなセルほど重心へ縮む（0..28%）。大音量で満ちて脈動が強く見える。
      const shrink = (1 - amp) * 0.28;
      const keep = 1 - shrink;
      const c = this._centroid(poly);

      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const px = c.x + (poly[i].x - c.x) * keep;
        const py = c.y + (poly[i].y - c.y) * keep;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = makeColor(baseHue, clamp(ampColor + 0.2, 0, 1), settings);
      ctx.stroke();
    }
  }

  dispose() {
    this.baseSites = null;
    this.noise = null;
    this._sitesPx = null;
  }
}
