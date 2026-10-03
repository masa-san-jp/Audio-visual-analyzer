// 目的 — 自動演出の状態・タイムライン・ライブ描画を管理する — Phase 18 計画書 §6.8。
class DirectorController {
  constructor(targetCanvas, targetCtx) {
    this.songMap = null;
    this.timeline = null;
    this.renderer = new DirectorRenderer(targetCanvas, targetCtx);
    this.state = createDirectorState();
    this._enabled = false;
    this._analysisState = 'idle';
    this._detail = { progress: 0, code: null, reason: null };
    this._options = { intensity: 'standard', pool: 'builtin', flash: true, seedOffset: 0 };
    this._presets = [];
    this._prevTSec = null;
  }

  setSongMap(songMap) {
    this.songMap = songMap;
    this.setAnalysisState('idle');
    this._compile();
  }

  setOptions(options, presets) {
    this._options = { intensity: options.intensity, pool: options.pool,
      flash: options.flash, seedOffset: options.seedOffset };
    this._presets = presets || [];
    this._compile();
  }

  setEnabled(enabled) {
    const wasEnabled = this._enabled;
    this._enabled = enabled === true;
    if (this._enabled && !wasEnabled) this._compile();
  }

  setAnalysisState(state, info) {
    this._analysisState = state;
    this._detail.progress = info && info.progress !== undefined ? info.progress : 0;
    this._detail.code = info && info.code !== undefined ? info.code : null;
    this._detail.reason = state === 'mic' ? 'mic' : state === 'unavailable' ? 'worklet' : null;
  }

  get status() {
    if (!this._enabled) return 'off';
    if (this._analysisState === 'mic' || this._analysisState === 'unavailable') return 'unavailable';
    if (this._analysisState === 'error') return 'error';
    if (this.isReady()) return 'ready';
    return this._analysisState === 'analyzing' ? 'analyzing' : 'off';
  }

  get statusDetail() { return this._detail; }
  isReady() { return !!(this.songMap && this.timeline); }

  _compile() {
    this.timeline = this.songMap
      ? compileDirectorTimeline(this.songMap, this._options, this._presets) : null;
    this._prevTSec = null;
    this.renderer.reset();
  }

  render(input, baseSettings, tSec) {
    if (!this.isReady()) return;
    if (this._prevTSec !== null &&
        (tSec < this._prevTSec || tSec - this._prevTSec > DIRECTOR_CONST.SEEK_RESET_SEC)) {
      this.renderer.reset();
    }
    directorStateAt(this.timeline, tSec, baseSettings, this.state);
    this.renderer.render(input, this.state, baseSettings.bgColor);
    this._prevTSec = tSec;
  }

  resize() { this.renderer.resize(); }
  dispose() { this.renderer.dispose(); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DirectorController };
}
