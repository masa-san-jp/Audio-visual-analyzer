class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.dataArray = null;
  }

  _ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.80;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.connect(this.ctx.destination);
  }

  connectMedia(mediaElement) {
    this._ensureContext();
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    this.source = this.ctx.createMediaElementSource(mediaElement);
    this.source.connect(this.analyser);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      return this.ctx.resume();
    }
    return Promise.resolve();
  }

  // フレームごとに1回呼び出してデータを取得する
  captureFrame() {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.dataArray);
  }

  // レイヤーに対応する帯域データを返す
  // layerIndex: 0始まり, layerCount: 1〜4
  getLayerData(layerIndex, layerCount) {
    if (!this.dataArray) return null;
    const total = this.dataArray.length;
    const start = Math.floor(layerIndex * total / layerCount);
    const end = Math.floor((layerIndex + 1) * total / layerCount);
    return this.dataArray.subarray(start, end);
  }

  // 後方互換: 全帯域データを返す（captureFrameを内包）
  getFrequencyData() {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this.dataArray);
    return this.dataArray;
  }

  setSmoothing(value) {
    if (this.analyser) this.analyser.smoothingTimeConstant = value;
  }

  // 録画用: MediaStreamDestination を作成し analyser に接続して返す
  createStreamDestination() {
    if (!this.ctx || !this.analyser) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.analyser.connect(dest);
    return dest;
  }

  // 録画用: 接続済みの MediaStreamDestination を解除する
  removeStreamDestination(dest) {
    if (!this.analyser || !dest) return;
    try { this.analyser.disconnect(dest); } catch (_) { /* already disconnected */ }
  }
}
