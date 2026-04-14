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
    this._resetting = false;
    // コールバック
    this.onStateChange = null;
  }

  // 録画開始
  start() {
    if (this.state !== 'idle') return;

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

    const options = mimeType ? { mimeType } : {};
    try {
      this.mediaRecorder = new MediaRecorder(canvasStream, options);
    } catch (e) {
      this._cleanupAudioDest();
      this._setState('idle');
      if (this.onError) this.onError('この環境では録画がサポートされていません');
      return;
    }

    const recordedMime = this.mediaRecorder.mimeType || 'video/webm';
    const chunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      // reset() による停止の場合は無視する
      if (this._resetting) {
        this._cleanupAudioDest();
        return;
      }
      this.chunks = chunks;
      this.blob = new Blob(chunks, { type: recordedMime });
      this._setState('recorded');
      this._cleanupAudioDest();
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
    if (this.state === 'recording') {
      this._resetting = true;
      this.mediaRecorder.stop();
    }
    this.chunks = [];
    this.blob = null;
    this.mediaRecorder = null;
    this._resetting = false;
    this._setState('idle');
  }

  _cleanupAudioDest() {
    if (this._audioDest) {
      this.audioEngine.removeStreamDestination(this._audioDest);
      this._audioDest = null;
    }
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
    return null;
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
