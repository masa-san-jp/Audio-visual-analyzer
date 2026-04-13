class VisualizerCore {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioEngine = audioEngine;
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.running = false;
    this.rafId = null;
  }

  resize() {
    const area = this.canvas.parentElement;
    const aw = area.clientWidth;
    const ah = area.clientHeight;

    if (this.settings.aspectRatio === '16:9') {
      // キャンバスを16:9でエリア内に収める
      const byWidth = { w: aw, h: Math.round(aw * 9 / 16) };
      const byHeight = { w: Math.round(ah * 16 / 9), h: ah };
      const fit = byWidth.h <= ah ? byWidth : byHeight;
      this.canvas.width = fit.w;
      this.canvas.height = fit.h;
    } else {
      const size = Math.min(aw, ah);
      this.canvas.width = size;
      this.canvas.height = size;
    }

    // リサイズ後に黒塗りを維持
    this._fillBlack();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this._fillBlack();
  }

  _fillBlack() {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _loop() {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(() => this._loop());

    this._fillBlack();

    const data = this.audioEngine.getFrequencyData();
    if (data) {
      renderBars(this.ctx, this.canvas, data, this.settings);
    }
  }
}
