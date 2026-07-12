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
    this.timeArray = new Uint8Array(this.analyser.fftSize); // 時間波形（Phase 6）
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
    if (this.timeArray) this.analyser.getByteTimeDomainData(this.timeArray);
  }

  // 時間波形データ（Phase 6: リサージュ等）
  getTimeDomainData() {
    return this.timeArray || null;
  }

  // 50Hz〜15kHz の全帯域スライス（captureFrame 済みのデータを使う）
  getFreqSlice() {
    if (!this.dataArray) return null;
    const { startBin, endBin } = this._freqRange();
    return this.dataArray.subarray(startBin, endBin);
  }

  // 全帯域スライスの長さ（履歴バッファのサイズ確定に使用）
  freqSliceLength() {
    if (!this.dataArray) return 0;
    const { startBin, endBin } = this._freqRange();
    return endBin - startBin;
  }

  // アナライザーが表現する帯域: 50Hz〜15kHz
  _freqRange() {
    const sampleRate = this.ctx.sampleRate;
    const binCount = this.dataArray.length; // fftSize / 2
    const hzPerBin = sampleRate / (binCount * 2);
    const startBin = Math.round(50 / hzPerBin);
    const endBin   = Math.min(binCount - 1, Math.round(15000 / hzPerBin));
    return { startBin, endBin };
  }

  // レイヤーに対応する帯域データを返す
  // layerIndex: 0始まり, layerCount: 1〜4
  getLayerData(layerIndex, layerCount) {
    if (!this.dataArray) return null;
    const { startBin, endBin } = this._freqRange();
    const rangeLen = endBin - startBin;
    const start = startBin + Math.floor(layerIndex * rangeLen / layerCount);
    const end   = startBin + Math.floor((layerIndex + 1) * rangeLen / layerCount);
    return this.dataArray.subarray(start, end);
  }

  // 後方互換: 50Hz〜15kHz 帯域データを返す（captureFrameを内包）
  getFrequencyData() {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this.dataArray);
    const { startBin, endBin } = this._freqRange();
    return this.dataArray.subarray(startBin, endBin);
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
    if (!this.analyser || !dest || !this.ctx) return;
    try {
      // 対象ノードのみを切断し、スピーカー出力への接続はそのまま維持する
      this.analyser.disconnect(dest);
    } catch (_) {
      // 引数付き disconnect 非対応環境では全切断後に出力へ再接続する
      try { this.analyser.disconnect(); } catch (_) {}
      try { this.analyser.connect(this.ctx.destination); } catch (_) {}
    }
  }
}
