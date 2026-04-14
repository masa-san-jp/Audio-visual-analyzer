// Canvas + Audio 録画モジュール
// MediaRecorder API を使用し webm 形式で出力する
class Recorder {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.audioEngine = audioEngine;
    this.mediaRecorder = null;
    this.chunks = [];
    this.state = 'idle'; // 'idle' | 'recording' | 'recorded'
    this.blob = null;
    this._audioDest = null;
    // コールバック
    this.onStateChange = null;
  }

  // 録画開始
  start() {
    if (this.state === 'recording') return;

    // Canvas 映像ストリーム (30fps)
    const canvasStream = this.canvas.captureStream(30);

    // AudioContext からオーディオストリームを取得して合成
    const audioDest = this.audioEngine.createStreamDestination();
    if (audioDest) {
      this._audioDest = audioDest;
      const audioTrack = audioDest.stream.getAudioTracks()[0];
      if (audioTrack) {
        canvasStream.addTrack(audioTrack);
      }
    }

    // MIME タイプを決定
    const mimeType = this._selectMimeType();

    this.mediaRecorder = new MediaRecorder(canvasStream, { mimeType });
    this.chunks = [];
    this.blob = null;

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      this.blob = new Blob(this.chunks, { type: mimeType });
      this._setState('recorded');
      // オーディオ録音接続を解除
      this.audioEngine.removeStreamDestination(this._audioDest);
      this._audioDest = null;
    };

    this.mediaRecorder.start();
    this._setState('recording');
  }

  // 録画停止
  stop() {
    if (this.mediaRecorder && this.state === 'recording') {
      this.mediaRecorder.stop();
    }
  }

  // 保存（ダウンロード）
  save() {
    if (!this.blob) return;
    const filename = this._generateFilename();
    const url = URL.createObjectURL(this.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 再録画（リセット）
  reset() {
    if (this.state === 'recording') this.stop();
    this.chunks = [];
    this.blob = null;
    this.mediaRecorder = null;
    this._setState('idle');
  }

  _setState(newState) {
    this.state = newState;
    if (this.onStateChange) this.onStateChange(newState);
  }

  _selectMimeType() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return 'video/webm';
  }

  _generateFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) + '_' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds());
    return `visualizer_${ts}.webm`;
  }
}
