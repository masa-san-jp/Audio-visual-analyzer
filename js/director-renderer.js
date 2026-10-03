// 目的 — 2つの描画パイプラインで自動演出のクロスフェードとフラッシュを合成する — Phase 18 計画書 §6.7。

class DirectorRenderer {
  constructor(targetCanvas, targetCtx) {
    this.canvas = targetCanvas;
    this.ctx = targetCtx;
    this.canvases = [document.createElement('canvas'), document.createElement('canvas')];
    this.pipelines = [
      new FramePipeline(this.canvases[0], this.canvases[0].getContext('2d')),
      new FramePipeline(this.canvases[1], this.canvases[1].getContext('2d')),
    ];
    this._assignments = [-1, -1];
    this.resize();
  }

  resize() {
    for (let i = 0; i < 2; i++) {
      this.canvases[i].width = this.canvas.width;
      this.canvases[i].height = this.canvas.height;
      this.pipelines[i].resize();
    }
  }

  _resetPipeline(index) {
    const pipeline = this.pipelines[index];
    // FramePipeline.reset() はタイプ固有の状態を破棄しないため、公開 dispose() も使う。
    pipeline.dispose();
    pipeline.reset();
    pipeline.ctx.clearRect(0, 0, this.canvases[index].width, this.canvases[index].height);
  }

  reset() {
    for (let i = 0; i < 2; i++) {
      this._resetPipeline(i);
      this._assignments[i] = -1;
    }
  }

  _renderScene(input, scene) {
    const index = scene.segmentIndex % 2;
    const pipeline = this.pipelines[index];
    if (this._assignments[index] !== scene.segmentIndex) {
      this._resetPipeline(index);
      // 残像付きクリアでも前シーンを残さず、不透明な背景から描き始める。
      pipeline.fillBackground(scene.settings);
      this._assignments[index] = scene.segmentIndex;
    }
    pipeline.render(input, scene.settings);
  }

  render(input, state, bgColor) {
    this._renderScene(input, state.primary);
    if (state.secondary) this._renderScene(input, state.secondary);

    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (state.secondary) {
      ctx.drawImage(this.canvases[state.secondary.segmentIndex % 2], 0, 0);
      ctx.globalAlpha = state.mix;
    }
    ctx.drawImage(this.canvases[state.primary.segmentIndex % 2], 0, 0);
    if (state.flashAlpha > 0) {
      ctx.globalAlpha = state.flashAlpha;
      ctx.fillStyle = bgColor === '#000' ? '#fff' : '#000';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.restore();
  }

  dispose() {
    for (let i = 0; i < 2; i++) {
      this.pipelines[i].dispose();
      this._assignments[i] = -1;
      this.canvases[i].width = 0;
      this.canvases[i].height = 0;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DirectorRenderer };
}
