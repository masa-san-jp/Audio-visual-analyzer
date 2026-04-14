// レンダラー選択マップ
const BAR_RENDERERS = {
  bar:  renderBars,
  line: renderLines,
  dot:  renderDots,
};

const RADIAL_RENDERERS = {
  bar:  renderRadialBars,
  line: renderRadialLines,
  dot:  renderRadialDots,
};

class VisualizerCore {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioEngine = audioEngine;
    this.settings = createDefaultSettings();
    this.running = false;
    this.rafId = null;
    // 色相連続変化用の内部カウンター
    this._huePhase = 0;
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

    this._fillBackground();
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
    this._fillBackground();
  }

  _fillBackground() {
    this.ctx.fillStyle = this.settings.bgColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _clearWithAfterimage() {
    const intensity = this.settings.afterimageIntensity;
    if (intensity <= 0) {
      this._fillBackground();
      return;
    }
    // intensity 1~10 → fadeAlpha 0.7^1 ~ 0.7^10
    const fadeAlpha = Math.pow(0.7, intensity);
    const isWhite = this.settings.bgColor === '#fff';
    const rgb = isWhite ? '255,255,255' : '0,0,0';
    this.ctx.fillStyle = `rgba(${rgb},${fadeAlpha})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _loop() {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(() => this._loop());

    // 残像付きクリア
    this._clearWithAfterimage();

    // フレームデータを1回だけ取得
    this.audioEngine.captureFrame();

    // 色相連続変化モード
    let effectiveHue = this.settings.hue;
    if (this.settings.hueContinuousMode) {
      this._huePhase = (this._huePhase + this.settings.hueContinuousSpeed * 0.5) % 360;
      effectiveHue = (this.settings.hue + this._huePhase) % 360;
    }

    const { layerCount, layers, analyzerType, expressionMethod } = this.settings;

    // レンダラー選択
    const rendererMap = analyzerType === 'radial' ? RADIAL_RENDERERS : BAR_RENDERERS;
    const renderer = rendererMap[expressionMethod] || rendererMap.bar;

    for (let i = 0; i < layerCount; i++) {
      const layerData = this.audioEngine.getLayerData(i, layerCount);
      if (!layerData) continue;

      const layer = layers[i] || { hueOffset: 0, sensitivity: 1.0 };
      const layerSettings = {
        ...this.settings,
        hue: (effectiveHue + layer.hueOffset + 360) % 360,
        sensitivity: this.settings.sensitivity * layer.sensitivity,
      };

      renderer(this.ctx, this.canvas, layerData, layerSettings);
    }
  }
}
