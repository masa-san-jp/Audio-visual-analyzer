const RENDERERS = {
  bars:   renderBars,
  lines:  renderLines,
  dots:   renderDots,
  radial: renderRadial,
  mirror: renderMirror,
};

class VisualizerCore {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioEngine = audioEngine;
    this.settings = createDefaultSettings();
    this.running = false;
    this.rafId = null;
  }

  resize() {
    const area = this.canvas.parentElement;
    const aw = area.clientWidth;
    const ah = area.clientHeight;

    if (this.settings.aspectRatio === '16:9') {
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

    // フレームデータを1回だけ取得
    this.audioEngine.captureFrame();

    const { layerCount, layers, rendererType, zeroDbMode } = this.settings;
    const renderer = RENDERERS[rendererType] || renderBars;

    for (let i = 0; i < layerCount; i++) {
      const layerData = this.audioEngine.getLayerData(i, layerCount);
      if (!layerData) continue;

      const layer = layers[i] || { hueOffset: 0, sensitivity: 1.0 };
      const layerSettings = {
        ...this.settings,
        hue: (this.settings.hue + layer.hueOffset + 360) % 360,
        sensitivity: this.settings.sensitivity * layer.sensitivity,
        zeroDbMode,
      };

      renderer(this.ctx, this.canvas, layerData, layerSettings);
    }
  }
}
