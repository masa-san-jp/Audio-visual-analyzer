// 目的 — WORLDのオフラインMFS・固定dt・音声入りWebCodecs書き出し — 構想 §2.7(1)、Phase16 §6.3
// 既存OfflineExporterのMFS worklet／音声エンコード／品質算出を再利用する。
class WorldExporter extends OfflineExporter {
  async prepare(file, fps, audioBuffer = null) {
    if (fps !== 30 && fps !== 60) throw new RangeError('fpsは30/60です');
    if (this.state === 'analyzing' || this.state === 'rendering') throw new Error('書き出し／解析中です');
    this._cancelRequested = false; this._setState('analyzing');
    try {
      if (!audioBuffer) {
        const context = new OfflineAudioContext(2, 1, 48000);
        audioBuffer = await context.decodeAudioData(await file.arrayBuffer());
      }
      this._checkCancelled();
      // WORLDは特徴量が必須。従来Analyser/ScriptProcessorへはフォールバックしない。
      const captured = await this._captureFramesWorklet(audioBuffer, .8, fps, 0, 0);
      this._checkCancelled();
      if (captured.cancelled) throw new _ExportCancelled();
      const count = Math.ceil(audioBuffer.length * fps / audioBuffer.sampleRate - 1e-9);
      if (captured.featureFrames.length < count) throw new Error('MFSフレームが不足しています');
      return { audioBuffer, featureFrames: captured.featureFrames, fps, frameCount: count };
    } finally { this._setState('idle'); }
  }
  async _selectAV(width, height, fps, buffer) {
    if (!WorldExporter.isSupported() || typeof AudioEncoder === 'undefined') throw new Error('音声入り書き出し用WebCodecsが利用できません');
    for (const candidate of OFFLINE_EXPORT_CONTAINER_CANDIDATES) {
      const video = { codec: candidate.videoCodec, width, height, bitrate: this._videoBitrate(width, height, fps), framerate: fps };
      if (candidate.container === 'mp4') video.avc = { format: 'avc' };
      const audio = { codec: candidate.audioCodec, sampleRate: buffer.sampleRate,
        numberOfChannels: Math.min(2, buffer.numberOfChannels), bitrate: OFFLINE_EXPORT_AUDIO_BPS };
      try {
        const [v, a] = await Promise.all([VideoEncoder.isConfigSupported(video), AudioEncoder.isConfigSupported(audio)]);
        if (v.supported && a.supported) return { candidate, video, audio };
      } catch (_) { /* 音声と映像の両方が使える次の容器へ */ }
    }
    throw new Error('H.264/AACまたはVP9/VP8/Opusのエンコーダーが利用できません');
  }
  async exportWorld(score, prepared, options = {}) {
    if (this.state === 'analyzing' || this.state === 'rendering') throw new Error('書き出し中です');
    this._cancelRequested = false; this.blob = null; this._setProgress(0); this._setState('rendering');
    const { fps, audioBuffer, featureFrames, frameCount } = prepared;
    const width = options.width || 1920, height = options.height || 1080;
    let engine = null, videoEncoder = null, audioEncoder = null, encoderError = null;
    try {
      const choice = await this._selectAV(width, height, fps, audioBuffer);
      this._checkCancelled();
      const { candidate, video, audio } = choice;
      const videoChunks = [], audioChunks = []; let avcConfig = null, audioConfig = null;
      videoEncoder = new VideoEncoder({ output: (chunk, metadata) => {
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        videoChunks.push({ data, timestamp: chunk.timestamp, key: chunk.type === 'key' });
        if (metadata?.decoderConfig?.description) avcConfig = new Uint8Array(metadata.decoderConfig.description.slice(0));
      }, error: error => { encoderError = error; } });
      audioEncoder = new AudioEncoder({ output: (chunk, metadata) => {
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        audioChunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration });
        if (metadata?.decoderConfig?.description) audioConfig = new Uint8Array(metadata.decoderConfig.description.slice(0));
      }, error: error => { encoderError = error; } });
      videoEncoder.configure(video); audioEncoder.configure(audio);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      engine = new WorldEngine(canvas, score.seed); engine.setScore(score); engine.setTimeline(featureFrames, fps);
      // 終端のMFSフレームはシミュレーション用。6秒×30fpsは[0,6)の180枚だけを符号化する。
      for (let i = 0; i < frameCount; i++) {
        this._checkCancelled(); if (encoderError) throw encoderError;
        engine.advanceTo(i / fps); engine._draw();
        const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps),
          duration: Math.round((i + 1) * 1e6 / fps) - Math.round(i * 1e6 / fps) });
        try { videoEncoder.encode(frame, { keyFrame: i % (fps * OFFLINE_EXPORT_KEYFRAME_INTERVAL_SEC) === 0 }); }
        finally { frame.close(); }
        if (videoEncoder.encodeQueueSize >= 8) await videoEncoder.flush();
        if (i % 4 === 0 || i === frameCount - 1) { this._setProgress(.85 * (i + 1) / frameCount); await this._yield(); }
      }
      await videoEncoder.flush(); this._checkCancelled();
      await this._encodeAudio(audioEncoder, audioBuffer, audio.sampleRate, audio.numberOfChannels);
      await audioEncoder.flush(); this._checkCancelled(); if (encoderError) throw encoderError;
      if (!audioChunks.length) throw new Error('音声エンコード結果が空です');
      this._setProgress(.95);
      let muxer;
      if (candidate.container === 'mp4') {
        if (!avcConfig?.length || !audioConfig?.length) throw new Error('MP4のコーデック情報が不足しています');
        muxer = new Mp4Muxer({ width, height, fps, sampleRate: audio.sampleRate, channels: audio.numberOfChannels,
          avcConfig, audioSpecificConfig: audioConfig });
      } else {
        muxer = new WebmMuxer({ width, height, videoCodecId: video.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8',
          audioCodecId: 'A_OPUS', sampleRate: audio.sampleRate, channels: audio.numberOfChannels, audioCodecPrivate: audioConfig });
      }
      for (const c of videoChunks) muxer.addVideoChunk(c.data, c.timestamp, c.key);
      for (const c of audioChunks) muxer.addAudioChunk(c.data, c.timestamp, c.duration);
      this._checkCancelled(); this.blob = muxer.finalize(audioBuffer.duration * 1000);
      this._setProgress(1); this._setState('done'); return this.blob;
    } catch (error) {
      if (error instanceof _ExportCancelled) { this._setState('idle'); return null; }
      this._setState('error'); throw error;
    } finally {
      if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close();
      if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
      if (engine) engine.dispose();
    }
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldExporter }; }
