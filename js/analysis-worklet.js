// AudioWorklet ベースのオフライン解析（Phase 9.2）
//
// AnalyserNode はメインスレッド専用オブジェクトのため、AudioWorklet（オーディオ
// レンダリングスレッド・別レルム）からは利用できない。そこで js/fft.js の
// SpectrumAnalyzer（AnalyserNode 互換の自前実装）をワークレット内で動かして
// 同等の解析を行う。
//
// - ワークレットモジュールは file:// 直開きでも動くよう data: URL として生成する
//   （外部ファイルの fetch を行わない。SpectrumAnalyzer は toString() で埋め込む。
//    blob: URL は file:// オリジンで addModule が拒否されるため使用しない）
// - ScriptProcessorNode 版（旧実装）と出力を完全一致させるため、スナップショットは
//   2048 サンプル境界でのみ採取する（旧実装のバッファ粒度・平滑化の進み方を踏襲）。
//   同一ブロック内に複数の出力フレーム時刻が入る場合は同一スナップショットを共有する
// - 入力は AudioWorkletNode 側で channelCount:1 / explicit / speakers を指定して
//   モノラルへダウンミックスする（AnalyserNode の解析時ダウンミックスと同じ規則）

function buildAnalysisWorkletSource() {
  return SpectrumAnalyzer.toString() + '\n' + `
class OfflineAnalysisProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this._fftSize = o.fftSize;
    this._blockSize = o.blockSize;
    this._samplesPerFrame = o.samplesPerFrame;
    this._totalSamples = o.totalSamples;
    this._analyzer = new SpectrumAnalyzer(this._fftSize, o.smoothing, -100, -30);
    this._ring = new Float32Array(this._fftSize);
    this._ringPos = 0;
    this._processed = 0;
    this._sinceBlock = 0;
    this._nextFrameSample = 0;
    this._chrono = new Float32Array(this._fftSize);
    this._doneSent = false;
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true;

    const ring = this._ring;
    const size = this._fftSize;
    for (let i = 0; i < ch.length; i++) {
      ring[this._ringPos] = ch[i];
      this._ringPos = (this._ringPos + 1) % size;
    }
    this._processed += ch.length;
    this._sinceBlock += ch.length;

    if (this._sinceBlock >= this._blockSize) {
      this._sinceBlock -= this._blockSize;
      if (this._nextFrameSample <= this._processed && this._nextFrameSample <= this._totalSamples) {
        const chrono = this._chrono;
        const head = this._ringPos;
        for (let i = 0; i < size; i++) chrono[i] = ring[(head + i) % size];

        const freq = new Uint8Array(size / 2);
        this._analyzer.analyze(chrono, freq);
        const time = new Uint8Array(size);
        SpectrumAnalyzer.timeDomainToBytes(chrono, time);

        while (this._nextFrameSample <= this._processed && this._nextFrameSample <= this._totalSamples) {
          this.port.postMessage({
            timeMs: this._nextFrameSample / sampleRate * 1000,
            freq: freq.slice(),
            time: time.slice(),
          });
          this._nextFrameSample += this._samplesPerFrame;
        }
      }
    }

    if (!this._doneSent && this._processed >= this._totalSamples) {
      this._doneSent = true;
      this.port.postMessage({ done: true });
    }
    return true;
  }
}
registerProcessor('offline-analysis', OfflineAnalysisProcessor);
`;
}

// ワークレットモジュールの data: URL を生成する
function createAnalysisWorkletUrl() {
  return 'data:application/javascript;charset=utf-8,' + encodeURIComponent(buildAnalysisWorkletSource());
}
