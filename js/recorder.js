// Canvas + Audio 録画モジュール
// MediaRecorder API を使用し mp4 / webm 形式で出力する

// MIME タイプ候補（編集ソフト互換性の高い MP4 を優先し、非対応環境は WebM へフォールバック）
const RECORDER_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4d401f,mp4a.40.2',
  'video/mp4;codecs=avc1.42e01e,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

// 映像ビットレートの算出パラメーター
const RECORDER_BITS_PER_PIXEL = 0.15;      // 1ピクセル・1フレームあたりのビット数（標準画質）
const RECORDER_MIN_VIDEO_BPS  = 6000000;   // 6 Mbps（標準画質時）
const RECORDER_MAX_VIDEO_BPS  = 24000000;  // 24 Mbps（標準画質時）
const RECORDER_AUDIO_BPS      = 192000;    // 192 kbps
const RECORDER_TIMESLICE_MS   = 1000;      // チャンク回収間隔
// 画質プリセット（bit/pixel/frame）。下限/上限も標準比の係数でスケールする
const RECORDER_QUALITY_FACTORS = { low: 0.08, standard: 0.15, high: 0.25 };

class Recorder {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.audioEngine = audioEngine;
    this.mediaRecorder = null;
    this.chunks = [];
    this.state = 'idle'; // 'idle' | 'recording' | 'recorded'
    this.blob = null;
    this.frameRate = 30;
    this.quality = 'standard'; // 'low' | 'standard' | 'high'
    this._audioDest = null;
    this._resetting = false;
    this._starting = false;
    this._startedAt = 0;
    this._stoppedAt = 0;
    // コールバック
    this.onStateChange = null;
    this.onError = null;
  }

  // 録画開始
  // MediaRecorder の start イベント発火を待って resolve する。
  // 呼び出し側は resolve（true）後に再生を開始することで、録画準備が整う前に
  // 音が鳴り始めて映像と音声の頭がずれることを防ぐ。
  async start() {
    if (this.state !== 'idle' || this._starting) return false;
    this._starting = true;

    // AudioContext が suspended のままだと音声トラックにデータが流れず、
    // 冒頭の A/V ずれの原因になるため、先に必ず resume を完了させる
    try {
      await this.audioEngine.resume();
    } catch (e) {
      this._abortStart('音声の初期化に失敗しました');
      return false;
    }

    // Canvas 映像ストリーム
    const canvasStream = this.canvas.captureStream(this.frameRate);

    // AudioContext からオーディオストリームを取得して合成
    const audioDest = this.audioEngine.createStreamDestination();
    if (audioDest) {
      this._audioDest = audioDest;
      const audioTrack = audioDest.stream.getAudioTracks()[0];
      if (audioTrack) {
        canvasStream.addTrack(audioTrack);
      }
    }

    // MIME タイプとビットレートを決定
    const mimeType = this._selectMimeType();
    const options = {
      videoBitsPerSecond: this._videoBitrate(),
      audioBitsPerSecond: RECORDER_AUDIO_BPS,
    };
    if (mimeType) options.mimeType = mimeType;

    try {
      this.mediaRecorder = new MediaRecorder(canvasStream, options);
    } catch (e) {
      this._abortStart('この環境では録画がサポートされていません');
      return false;
    }

    const recordedMime = this.mediaRecorder.mimeType || mimeType || 'video/webm';
    const chunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      this._handleStop(chunks, recordedMime);
    };

    return new Promise((resolve) => {
      let settled = false;
      const settle = (ok) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };

      this.mediaRecorder.onstart = () => {
        // 実際にキャプチャが始まった時刻を録画長の計測基準にする
        this._startedAt = performance.now();
        this._stoppedAt = 0;
        this._starting = false;
        this._setState('recording');
        settle(true);
      };

      this.mediaRecorder.onerror = () => {
        if (!settled) {
          // キャプチャ開始前のエラー: 開始失敗として状態を戻す
          this._abortStart('録画を開始できませんでした');
          settle(false);
        } else if (this.state === 'recording') {
          // 録画中のエラー: 録画を停止して回収済みデータを保全する
          if (this.onError) this.onError('録画中にエラーが発生しました');
          this.stop();
        }
      };

      try {
        // タイムスライス付きで開始し、長時間録画でもチャンクを定期回収する
        this.mediaRecorder.start(RECORDER_TIMESLICE_MS);
      } catch (e) {
        this._abortStart('録画を開始できませんでした');
        settle(false);
      }
    });
  }

  // 録画停止
  stop() {
    if (this.mediaRecorder && this.state === 'recording') {
      this._stoppedAt = performance.now();
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
      // _resettingをtrueにしたままonstopに後処理を委譲する（非同期）
      this._resetting = true;
      this.mediaRecorder.stop();
      return;
    }
    this.chunks = [];
    this.blob = null;
    this.mediaRecorder = null;
    this._cleanupAudioDest();
    this._setState('idle');
  }

  setFrameRate(fps) {
    const allowed = [25, 29.97, 30];
    const numericFps = Number(fps);
    if (!allowed.includes(numericFps)) return;
    this.frameRate = numericFps;
  }

  setQuality(quality) {
    if (!RECORDER_QUALITY_FACTORS[quality]) return;
    this.quality = quality;
  }

  // ── 内部処理 ──

  // MediaRecorder 停止後の後処理（Blob 生成・WebM の Duration 書き込み）
  async _handleStop(chunks, recordedMime) {
    this._cleanupAudioDest();
    this.mediaRecorder = null;

    // reset() による停止の場合はクリーンアップのみ行う
    if (this._resetting) {
      this._resetting = false;
      this.chunks = [];
      this.blob = null;
      this._setState('idle');
      return;
    }

    const stoppedAt = this._stoppedAt || performance.now();
    const durationMs = this._startedAt ? stoppedAt - this._startedAt : 0;

    let blob = new Blob(chunks, { type: recordedMime });

    // WebM は MediaRecorder が Duration を書き込まないため、
    // ヘッダーに再生時間を書き込み、編集ソフトでの長さ認識・シークを可能にする
    if (recordedMime.indexOf('webm') !== -1 &&
        typeof patchWebmDuration === 'function' && durationMs > 0) {
      try {
        blob = await patchWebmDuration(blob, durationMs);
      } catch (_) {
        // パッチ失敗時は元の Blob をそのまま使う
      }
    }

    this.chunks = chunks;
    this.blob = blob;
    this._setState('recorded');
  }

  _abortStart(message) {
    this._starting = false;
    this.mediaRecorder = null;
    this._cleanupAudioDest();
    this._setState('idle');
    if (this.onError) this.onError(message);
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

  // 解像度・フレームレート・画質プリセットに応じた映像ビットレート（bps）を算出する
  _videoBitrate() {
    const factor = RECORDER_QUALITY_FACTORS[this.quality] || RECORDER_BITS_PER_PIXEL;
    const scale = factor / RECORDER_BITS_PER_PIXEL;
    const pixelsPerSecond = this.canvas.width * this.canvas.height * this.frameRate;
    const bps = Math.round(pixelsPerSecond * factor);
    return Math.min(RECORDER_MAX_VIDEO_BPS * scale, Math.max(RECORDER_MIN_VIDEO_BPS * scale, bps));
  }

  _selectMimeType() {
    for (const mime of RECORDER_MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return null;
  }

  _extFromMime(mimeType) {
    if (mimeType && mimeType.toLowerCase().indexOf('video/mp4') === 0) return 'mp4';
    return 'webm';
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
    const ext = this._extFromMime(this.blob ? this.blob.type : null);
    return `visualizer_${ts}.${ext}`;
  }
}
