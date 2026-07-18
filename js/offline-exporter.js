// オフライン書き出し — 音楽ファイルの信号を解析し、現在のビジュアライザー設定に
// 合わせて実時間に依存せず決定的にレンダリング・エンコードして動画ファイルを生成する。
//
// 処理の流れ:
//  1. ファイルを AudioBuffer にデコードする
//  2. OfflineAudioContext 上で AnalyserNode を通し、ScriptProcessorNode の
//     コールバックで各出力フレーム時刻の周波数/時間波形スナップショットを採取する。
//     AnalyserNode は音声グラフ上でしか動作しないためこの手法を用いる。
//     OfflineAudioContext は実時間より高速に処理されるため、採取自体も高速に終わる
//     （ScriptProcessorNode は非推奨 API だが、対象ブラウザ（Chrome/Edge）では
//      オフラインレンダリング中に AnalyserNode のスナップショットを取得できる
//      標準APIとして現状もっとも確実な手段のため使用する）。
//  3. 採取したフレーム列を、既存レンダラー群（renderer-registry.js）を用いて
//     固定 dt（1/fps）で1枚ずつ Canvas に描画する。
//  4. WebCodecs（VideoEncoder / AudioEncoder）でエンコードし、
//     js/mp4-muxer.js（MP4優先）または js/webm-muxer.js（フォールバック）で
//     コンテナへ格納する（recorder.js の MP4優先方針を踏襲）。
//
// 外部ライブラリ不使用。WebCodecs / OfflineAudioContext は Chrome/Edge が対象。

const OFFLINE_EXPORT_VIDEO_BITS_PER_PIXEL = 0.15; // recorder.js と同じ算出式
const OFFLINE_EXPORT_MIN_VIDEO_BPS = 6000000;
const OFFLINE_EXPORT_MAX_VIDEO_BPS = 24000000;
const OFFLINE_EXPORT_AUDIO_BPS = 192000;
const OFFLINE_EXPORT_KEYFRAME_INTERVAL_SEC = 2;
const OFFLINE_EXPORT_RESOLUTIONS = {
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};
// MP4（H.264/AAC）を優先し、非対応環境は WebM（VP9/VP8 + Opus）へフォールバックする
const OFFLINE_EXPORT_CONTAINER_CANDIDATES = [
  { container: 'mp4', videoCodec: 'avc1.640028', audioCodec: 'mp4a.40.2' },
  { container: 'mp4', videoCodec: 'avc1.4d401f', audioCodec: 'mp4a.40.2' },
  { container: 'mp4', videoCodec: 'avc1.42e01e', audioCodec: 'mp4a.40.2' },
  { container: 'webm', videoCodec: 'vp09.00.10.08', audioCodec: 'opus' },
  { container: 'webm', videoCodec: 'vp8', audioCodec: 'opus' },
];

class _ExportCancelled extends Error {}

class OfflineExporter {
  constructor() {
    this.state = 'idle'; // 'idle' | 'analyzing' | 'rendering' | 'done' | 'error'
    this.progress = 0;   // 0..1
    this.blob = null;
    this._cancelRequested = false;
    // 粘性揺らぎ（physicsAmount）用の内部状態。VisualizerCore._applyPhysics と同一ロジック。
    this._physics = null;
    this._physicsLen = 0;
    this._physicsOut = null;
    // コールバック
    this.onStateChange = null;
    this.onProgress = null;
    this.onError = null;
  }

  static isSupported() {
    return typeof OfflineAudioContext !== 'undefined' &&
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoFrame !== 'undefined';
  }

  cancel() {
    if (this.state === 'analyzing' || this.state === 'rendering') {
      this._cancelRequested = true;
    }
  }

  // file: 音楽/動画ファイル（File）, settings: visualizer.settings のスナップショット,
  // opts: { fps }
  async export(file, settings, opts) {
    this._cancelRequested = false;
    this.blob = null;
    const fps = (opts && opts.fps) || 30;
    const aspectRatio = settings.aspectRatio === '1:1' ? '1:1' : '16:9';
    const res = OFFLINE_EXPORT_RESOLUTIONS[aspectRatio];

    try {
      this._setState('analyzing');
      this._setProgress(0);
      const analysis = await this._analyze(file, settings, fps);
      this._checkCancelled();

      this._setState('rendering');
      const blob = await this._renderAndEncode(analysis, settings, {
        fps, width: res.width, height: res.height,
      });
      this.blob = blob;
      this._setState('done');
      return blob;
    } catch (e) {
      if (e instanceof _ExportCancelled) {
        this._setState('idle');
        this._setProgress(0);
        return null;
      }
      this._setState('error');
      if (this.onError) this.onError(e.message || String(e));
      throw e;
    }
  }

  save(filename) {
    if (!this.blob) return;
    const url = URL.createObjectURL(this.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || this._generateFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── 解析フェーズ: OfflineAudioContext + AnalyserNode でフレーム列を採取 ──
  async _analyze(file, settings, fps) {
    const arrayBuffer = await file.arrayBuffer();
    const probeCtx = new (window.AudioContext || window.webkitAudioContext)();
    let audioBuffer;
    try {
      audioBuffer = await probeCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      probeCtx.close();
    }

    const sampleRate = audioBuffer.sampleRate;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const totalSamples = audioBuffer.length;
    const durationMs = (totalSamples / sampleRate) * 1000;
    if (durationMs <= 0) throw new Error('音声データが空です');

    const offlineCtx = new OfflineAudioContext(numberOfChannels, totalSamples, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    const analyser = offlineCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = clamp(settings.smoothing != null ? settings.smoothing : 0.8, 0, 0.99);

    const bufSize = 2048;
    const processor = offlineCtx.createScriptProcessor(bufSize, numberOfChannels, numberOfChannels);

    source.connect(analyser);
    analyser.connect(processor);
    processor.connect(offlineCtx.destination);

    const { startBin, endBin } = computeFreqRange(sampleRate, analyser.frequencyBinCount);
    const freqLen = endBin - startBin;

    const samplesPerFrame = sampleRate / fps;
    let nextFrameSample = 0;
    let processedSamples = 0;

    const freqFrames = [];
    const timeFrames = [];
    const frameTimesMs = [];

    const fullFreq = new Uint8Array(analyser.frequencyBinCount);
    const fullTime = new Uint8Array(analyser.fftSize);
    let cancelledDuringAnalyze = false;

    processor.onaudioprocess = () => {
      if (this._cancelRequested) { cancelledDuringAnalyze = true; return; }
      processedSamples += bufSize;
      while (nextFrameSample <= processedSamples && nextFrameSample <= totalSamples) {
        analyser.getByteFrequencyData(fullFreq);
        analyser.getByteTimeDomainData(fullTime);
        freqFrames.push(fullFreq.slice(startBin, endBin));
        timeFrames.push(fullTime.slice(0));
        frameTimesMs.push((nextFrameSample / sampleRate) * 1000);
        nextFrameSample += samplesPerFrame;
      }
      this._setProgress(clamp(processedSamples / totalSamples, 0, 1) * 0.4);
    };

    source.start(0);
    await offlineCtx.startRendering();
    try { processor.disconnect(); analyser.disconnect(); source.disconnect(); } catch (_) {}

    if (cancelledDuringAnalyze) throw new _ExportCancelled();
    if (freqFrames.length === 0) throw new Error('解析結果が空です（音声が短すぎる可能性があります）');

    return { audioBuffer, sampleRate, numberOfChannels, durationMs, freqLen, freqFrames, timeFrames, frameTimesMs };
  }

  // ── 描画 + エンコードフェーズ ──
  async _renderAndEncode(analysis, settings, opts) {
    const { fps, width, height } = opts;
    const { freqFrames, timeFrames, frameTimesMs, freqLen, durationMs, audioBuffer, sampleRate, numberOfChannels } = analysis;
    const totalFrames = freqFrames.length;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });

    const entry = getRendererEntry(settings.analyzerType);
    const stateful = entry.stateful ? entry.create(canvas) : null;
    if (stateful && stateful.onResize) stateful.onResize(canvas);

    const capacitySec = clamp(settings.historySeconds != null ? settings.historySeconds : 4, 1, 8);
    const historyCapacity = Math.min(240, Math.max(2, Math.round(capacitySec * fps)));
    const history = new FrameHistory(historyCapacity, freqLen);
    const beatDetector = new BeatDetector();

    // ── コンテナ・コーデック選択（MP4優先、非対応環境は WebM） ──
    const containerChoice = await this._selectContainer(width, height, fps);
    if (!containerChoice) throw new Error('この環境では書き出し用のビデオエンコーダーが利用できません');
    const { container, videoCodec, audioCodec } = containerChoice;

    // ── 映像エンコーダ ──
    const videoChunks = [];
    let videoError = null;
    let videoDescription = null; // MP4: avcC（AVCDecoderConfigurationRecord）
    const videoEncoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        videoChunks.push({ data, timestampUs: chunk.timestamp, keyframe: chunk.type === 'key' });
        if (!videoDescription && metadata && metadata.decoderConfig && metadata.decoderConfig.description) {
          videoDescription = new Uint8Array(metadata.decoderConfig.description.slice(0));
        }
      },
      error: (e) => { videoError = e; },
    });
    const videoEncoderConfig = {
      codec: videoCodec, width, height,
      bitrate: this._videoBitrate(width, height, fps),
      framerate: fps,
    };
    if (container === 'mp4') videoEncoderConfig.avc = { format: 'avc' };
    videoEncoder.configure(videoEncoderConfig);

    // ── 音声エンコーダ ──
    const audioChunks = [];
    let audioCodecDescription = null;
    let encodeSampleRate = sampleRate;
    let encodeChannels = Math.min(2, numberOfChannels);
    let pcmSource = audioBuffer;
    let audioEncoder = null;

    if (typeof AudioEncoder !== 'undefined') {
      let audioConfig = { codec: audioCodec, sampleRate: encodeSampleRate, numberOfChannels: encodeChannels, bitrate: OFFLINE_EXPORT_AUDIO_BPS };
      let support = await AudioEncoder.isConfigSupported(audioConfig).catch(() => ({ supported: false }));
      if (!support.supported) {
        const resampled = await this._resampleTo48k(audioBuffer);
        pcmSource = resampled;
        encodeSampleRate = resampled.sampleRate;
        encodeChannels = Math.min(2, resampled.numberOfChannels);
        audioConfig = { codec: audioCodec, sampleRate: encodeSampleRate, numberOfChannels: encodeChannels, bitrate: OFFLINE_EXPORT_AUDIO_BPS };
        support = await AudioEncoder.isConfigSupported(audioConfig).catch(() => ({ supported: false }));
      }
      if (support.supported) {
        audioEncoder = new AudioEncoder({
          output: (chunk, metadata) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            const durationUs = chunk.duration != null ? chunk.duration : Math.round((data.length ? 1024 : 0) / encodeSampleRate * 1e6);
            audioChunks.push({ data, timestampUs: chunk.timestamp, durationUs });
            if (!audioCodecDescription && metadata && metadata.decoderConfig && metadata.decoderConfig.description) {
              audioCodecDescription = new Uint8Array(metadata.decoderConfig.description.slice(0));
            }
          },
          error: () => {},
        });
        audioEncoder.configure(audioConfig);
      }
    }

    // ── フレーム描画 + 映像エンコード ──
    const dtMs = 1000 / fps;
    const keyframeEveryN = Math.max(1, Math.round(fps * OFFLINE_EXPORT_KEYFRAME_INTERVAL_SEC));
    let huePhase = 0;

    for (let i = 0; i < totalFrames; i++) {
      this._checkCancelled();
      if (videoError) throw new Error('映像エンコードに失敗しました: ' + videoError.message);

      const freq = freqFrames[i];
      const time = timeFrames[i];
      history.push(freq);
      const nowMs = frameTimesMs[i];

      let effectiveHue = settings.hue;
      if (settings.hueContinuousMode) {
        huePhase = (huePhase + settings.hueContinuousSpeed * 0.5 * (dtMs / 16.7)) % 360;
        effectiveHue = (settings.hue + huePhase) % 360;
      }

      const frame = {
        freq, time, history,
        beat: beatDetector.update(freq, nowMs),
        dtMs, nowMs,
        getLayer: (li, count) => this._sliceLayer(freq, li, count),
      };

      const selfClear = entry.capabilities && entry.capabilities.selfClear;
      if (!selfClear) this._clearFrame(ctx, canvas, settings);

      if (entry.stateful && stateful) {
        const s = { ...settings, hue: effectiveHue };
        stateful.render(ctx, canvas, frame, s);
      } else {
        this._renderStateless(ctx, canvas, entry, frame, settings, effectiveHue);
      }

      const vf = new VideoFrame(canvas, { timestamp: Math.round(nowMs * 1000), duration: Math.round(1e6 / fps) });
      videoEncoder.encode(vf, { keyFrame: (i % keyframeEveryN) === 0 });
      vf.close();

      if (i % 4 === 0 || i === totalFrames - 1) {
        this._setProgress(0.4 + clamp(i / totalFrames, 0, 1) * 0.5);
        await this._yield();
      }
    }

    await videoEncoder.flush();
    videoEncoder.close();
    if (stateful && stateful.dispose) { try { stateful.dispose(); } catch (_) {} }

    if (container === 'mp4' && (!videoDescription || videoDescription.length === 0)) {
      throw new Error('MP4 用の映像設定情報（avcC）を取得できませんでした');
    }

    this._checkCancelled();

    if (audioEncoder) {
      await this._encodeAudio(audioEncoder, pcmSource, encodeSampleRate, encodeChannels);
      await audioEncoder.flush();
      audioEncoder.close();
    }

    this._setProgress(0.95);

    let blob;
    if (container === 'mp4') {
      const muxer = new Mp4Muxer({
        width, height, fps,
        sampleRate: encodeSampleRate,
        channels: encodeChannels,
        avcConfig: videoDescription,
        audioSpecificConfig: audioEncoder ? audioCodecDescription : null,
      });
      for (const c of videoChunks) muxer.addVideoChunk(c.data, c.timestampUs, c.keyframe);
      for (const c of audioChunks) muxer.addAudioChunk(c.data, c.timestampUs, c.durationUs);
      blob = muxer.finalize(durationMs);
    } else {
      const muxer = new WebmMuxer({
        width, height,
        videoCodecId: videoCodec.indexOf('vp09') === 0 ? 'V_VP9' : 'V_VP8',
        audioCodecId: audioEncoder ? 'A_OPUS' : null,
        sampleRate: encodeSampleRate,
        channels: encodeChannels,
        audioCodecPrivate: audioCodecDescription,
      });
      for (const c of videoChunks) muxer.addVideoChunk(c.data, c.timestampUs, c.keyframe);
      for (const c of audioChunks) muxer.addAudioChunk(c.data, c.timestampUs);
      blob = muxer.finalize(durationMs);
    }

    this._setProgress(1);
    return blob;
  }

  _sliceLayer(freq, layerIndex, layerCount) {
    const len = freq.length;
    const start = Math.floor(layerIndex * len / layerCount);
    const end = Math.floor((layerIndex + 1) * len / layerCount);
    return freq.subarray(start, end);
  }

  _clearFrame(ctx, canvas, settings) {
    const intensity = settings.afterimageIntensity || 0;
    if (intensity <= 0) {
      ctx.fillStyle = settings.bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const fadeAlpha = Math.pow(0.7, intensity);
    const isWhite = settings.bgColor === '#fff';
    const rgb = isWhite ? '255,255,255' : '0,0,0';
    ctx.fillStyle = `rgba(${rgb},${fadeAlpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // visualizer-core.js の _renderStateless と同一ロジック（実時間駆動できないため複製）
  _renderStateless(ctx, canvas, entry, frame, settings, effectiveHue) {
    const { layerCount, layers, expressionMethod } = settings;
    const rendererMap = entry.methods;
    const renderer = rendererMap[expressionMethod] || rendererMap.bar;
    const usePhysics = settings.physicsAmount > 0 &&
      (expressionMethod === 'line' || expressionMethod === 'dot') &&
      entry.capabilities && entry.capabilities.physics;

    for (let i = 0; i < layerCount; i++) {
      let layerData = frame.getLayer(i, layerCount);
      if (!layerData) continue;
      if (usePhysics) layerData = this._applyPhysics(layerData, frame.dtMs, settings.physicsAmount);
      const layer = layers[i] || { hueOffset: 0, sensitivity: 1.0, blendMode: 'source-over' };
      const layerSettings = {
        ...settings,
        hue: (effectiveHue + layer.hueOffset + 360) % 360,
        sensitivity: settings.sensitivity * layer.sensitivity,
      };
      const prevOp = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = layer.blendMode || 'source-over';
      renderer(ctx, canvas, layerData, layerSettings);
      ctx.globalCompositeOperation = prevOp;
    }
  }

  // visualizer-core.js の _applyPhysics と同一ロジック（実時間駆動できないため複製）
  _applyPhysics(layerData, dtMs, physicsAmount) {
    const n = layerData.length;
    const params = springParamsFromAmount(physicsAmount);
    if (!this._physics || this._physicsLen !== n) {
      this._physics = new SpringArray(n, params);
      this._physics.value.set(layerData);
      this._physicsLen = n;
    } else {
      this._physics.configure(params);
    }
    for (let i = 0; i < n; i++) this._physics.setTarget(i, layerData[i]);
    this._physics.update(dtMs);
    if (!this._physicsOut || this._physicsOut.length !== n) this._physicsOut = new Uint8Array(n);
    for (let i = 0; i < n; i++) this._physicsOut[i] = clamp(this._physics.value[i], 0, 255);
    return this._physicsOut;
  }

  async _encodeAudio(audioEncoder, audioBuffer, sampleRate, channels) {
    const totalSamples = audioBuffer.length;
    const chunkSamples = Math.max(1, Math.round(sampleRate * 0.5));
    const srcChannels = [];
    for (let ch = 0; ch < channels; ch++) {
      const srcCh = Math.min(ch, audioBuffer.numberOfChannels - 1);
      srcChannels.push(audioBuffer.getChannelData(srcCh));
    }
    let chunkIndex = 0;
    for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
      this._checkCancelled();
      const n = Math.min(chunkSamples, totalSamples - offset);
      const planar = new Float32Array(n * channels);
      for (let ch = 0; ch < channels; ch++) {
        planar.set(srcChannels[ch].subarray(offset, offset + n), ch * n);
      }
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((offset / sampleRate) * 1e6),
        data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();
      chunkIndex++;
      if (chunkIndex % 8 === 0) await this._yield();
    }
  }

  async _resampleTo48k(audioBuffer) {
    const targetRate = 48000;
    const targetLength = Math.max(1, Math.ceil(audioBuffer.duration * targetRate));
    const ctx = new OfflineAudioContext(audioBuffer.numberOfChannels, targetLength, targetRate);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.start(0);
    return await ctx.startRendering();
  }

  // MP4（H.264）を優先し、非対応環境では WebM（VP9/VP8）にフォールバックする。
  // ここでは映像コーデックの対応可否のみで容器を確定する
  // （音声コーデックの対応可否・サンプルレート調整は _renderAndEncode 側で扱う）。
  async _selectContainer(width, height, fps) {
    if (typeof VideoEncoder === 'undefined') return null;
    const bitrate = this._videoBitrate(width, height, fps);
    for (const cand of OFFLINE_EXPORT_CONTAINER_CANDIDATES) {
      try {
        const config = { codec: cand.videoCodec, width, height, bitrate, framerate: fps };
        if (cand.container === 'mp4') config.avc = { format: 'avc' };
        const support = await VideoEncoder.isConfigSupported(config);
        if (support && support.supported) return cand;
      } catch (_) { /* 次候補へ */ }
    }
    return null;
  }

  _videoBitrate(width, height, fps) {
    const bps = Math.round(width * height * fps * OFFLINE_EXPORT_VIDEO_BITS_PER_PIXEL);
    return Math.min(OFFLINE_EXPORT_MAX_VIDEO_BPS, Math.max(OFFLINE_EXPORT_MIN_VIDEO_BPS, bps));
  }

  _yield() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  _setState(s) { this.state = s; if (this.onStateChange) this.onStateChange(s); }
  _setProgress(p) { this.progress = p; if (this.onProgress) this.onProgress(p); }
  _checkCancelled() { if (this._cancelRequested) throw new _ExportCancelled(); }

  _generateFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    const mime = this.blob ? this.blob.type : '';
    const ext = mime.indexOf('video/mp4') === 0 ? 'mp4' : 'webm';
    return `visualizer_offline_${ts}.${ext}`;
  }
}
