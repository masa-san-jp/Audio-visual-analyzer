// ソングマップの解析キュー・LRU キャッシュ・進捗・中止 — doc/20260928-plan-phase18-song-map-and-auto-director.md §5
class SongMapService {
  constructor({ isAvailable = () => typeof AudioWorkletNode !== 'undefined', augment = null } = {}) {
    this._isAvailable = isAvailable;
    // 任意の追加処理 augment(map, rows)。GPU タイプ用の平均クロマ付与に使う（既定は無効）
    this._augment = augment;
    this._cache = new Map();
    this._pending = new Map();
    this._queue = [];
    this._active = null;
    this.onProgress = (key, ratio) => {};
  }

  keyOf(file) {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  request(file) {
    if (!this._isAvailable()) return Promise.reject(new SongMapError('unavailable'));
    const key = this.keyOf(file);
    const cached = this.get(file);
    if (cached) return Promise.resolve(cached);
    const pending = this._pending.get(key);
    if (pending) return pending.promise;

    const job = { key, file, cancelled: false, wake: null };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    this._pending.set(key, job);
    this._queue.push(job);
    this._drain();
    return job.promise;
  }

  get(file) {
    const key = this.keyOf(file);
    const map = this._cache.get(key);
    if (!map) return null;
    // Map の挿入順を最終参照順として使う（§5: 最大 6 件）。
    this._cache.delete(key);
    this._cache.set(key, map);
    return map;
  }

  cancel(file) {
    const key = this.keyOf(file);
    const job = this._pending.get(key);
    if (!job) return;
    job.cancelled = true;
    this._pending.delete(key);
    const index = this._queue.indexOf(job);
    if (index >= 0) this._queue.splice(index, 1);
    job.reject(new SongMapError('cancelled'));
    if (job.wake) job.wake();
    // OfflineAudioContext に中止 API はない。実行中の処理が終了するまで
    // _active を保持し、遅れて届く行は無視することで同時解析を防ぐ。
  }

  _check(job) {
    if (job.cancelled) throw new SongMapError('cancelled');
  }

  _drain() {
    if (this._active || !this._queue.length) return;
    const job = this._queue.shift();
    this._active = job;
    this._run(job).then((map) => {
      if (job.cancelled) return;
      this._cache.set(job.key, map);
      if (this._cache.size > 6) this._cache.delete(this._cache.keys().next().value);
      job.resolve(map);
    }, (error) => {
      if (!job.cancelled) job.reject(error);
    }).finally(() => {
      if (this._pending.get(job.key) === job) this._pending.delete(job.key);
      this._active = null;
      this._drain();
    });
  }

  async _run(job) {
    this._check(job);
    if (!this._isAvailable()) throw new SongMapError('unavailable');
    let probe = null;
    let buffer;
    try {
      const bytes = await job.file.arrayBuffer();
      this._check(job);
      const Context = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext;
      // 解析はデバイスのサンプルレートに依存させず常に同じレートで行う（計画書 §4.1 DECODE_SAMPLE_RATE、§5）
      try {
        probe = new Context({ sampleRate: SONG_CONST.DECODE_SAMPLE_RATE });
      } catch (_) {
        probe = new Context();
      }
      buffer = await probe.decodeAudioData(bytes);
    } catch (error) {
      this._check(job);
      throw new SongMapError('decode');
    } finally {
      if (probe) await probe.close();
    }
    this._check(job);
    if (!this._isAvailable()) throw new SongMapError('unavailable');
    const durationSec = buffer.duration;
    if (durationSec < SONG_CONST.MIN_DURATION_SEC) throw new SongMapError('too-short');
    if (durationSec > SONG_CONST.MAX_DURATION_SEC) throw new SongMapError('too-long');
    const rows = await this._collectRows(job, buffer);
    this._check(job);
    const map = buildSongMap(rows, { sampleRate: buffer.sampleRate, durationSec });
    if (this._augment) this._augment(map, rows);
    this.onProgress(job.key, 1);
    this._check(job);
    return map;
  }

  async _collectRows(job, buffer) {
    const hops = Math.floor(buffer.length / MFS_CONST.HOP_SIZE);
    const rows = new Float32Array(hops * SONGMAP_ROW.LENGTH);
    let source = null;
    let node = null;
    try {
      let ctx;
      try {
        ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
        if (!ctx.audioWorklet) throw new SongMapError('unavailable');
        await ctx.audioWorklet.addModule(createMfsWorkletUrl());
        this._check(job);
        if (!this._isAvailable()) throw new SongMapError('unavailable');
        node = new AudioWorkletNode(ctx, 'mfs', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
          processorOptions: { mode: 'songmap', totalSamples: buffer.length },
        });
      } catch (error) {
        this._check(job);
        throw new SongMapError('unavailable');
      }
      let received = 0;
      let failure = null;
      const done = new Promise((resolve) => {
        job.wake = resolve;
        node.port.onmessage = (event) => {
          if (job.cancelled || failure) return;
          const message = event.data;
          if (message.type === 'rows') {
            rows.set(message.data, message.startHop * SONGMAP_ROW.LENGTH);
            received += message.count;
            this.onProgress(job.key, 0.9 * received / hops);
          } else if (message.type === 'done') {
            resolve();
          }
        };
        node.onprocessorerror = () => {
          failure = new SongMapError('unavailable');
          resolve();
        };
      });
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(node);
      node.connect(ctx.destination);
      this.onProgress(job.key, 0);
      this._check(job);
      source.start(0);
      try {
        await ctx.startRendering();
      } catch (error) {
        this._check(job);
        throw new SongMapError('unavailable');
      }
      this._check(job);
      // port の done が描画完了より後に届く場合も全バッチを待つ。
      await done;
      this._check(job);
      if (failure) throw failure;
      return rows;
    } finally {
      job.wake = null;
      if (node) {
        node.port.onmessage = null;
        node.onprocessorerror = null;
        node.disconnect();
        node.port.close();
      }
      if (source) source.disconnect();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SongMapService };
}
