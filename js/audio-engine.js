// 目的 — ライブ音声の解析グラフ。AudioWorklet（MFS: 音楽特徴ストリーム）を主経路とし、使えない環境は AnalyserNode へ自動フォールバックする — doc/20260928-plan-phase16-music-feature-stream.md §6.2
// 依存グローバル: createMfsWorkletUrl（js/mfs-worklet.js）、MfsFrameView（js/mfs-view.js）、MFS_CONST / MFS_LAYOUT（js/mfs-const.js）。

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.dataArray = null;
    // ── MFS（§6.2） ──
    this.mfsStatus = 'initializing';   // 'initializing' | 'active' | 'fallback'（fallback は以後戻らない）
    this._smoothing = 0.80;
    this._mfsNode = null;
    this._silentGain = null;
    this._view = null;                 // MfsFrameView（選択したホップの特徴。構築は ctx 生成時に1回）
    this._ring = new Array(MFS_CONST.LIVE_RING_SIZE).fill(null);
    this._ringPos = 0;
    this._selected = null;             // 直近に選択したホップメッセージ
    this._lastSelHop = -1;             // 前回描画時に選択したホップ番号（リセット直後は -1）
    this._lastRecvHop = -1;            // 最後に受信したホップ番号
    this._hopCount = 0;                // 受信ホップの通算数（hopsPerSec / ウォッチドッグ用）
    this._freqSelected = null;         // 選択ホップの freq（Uint8Array(1024)。事前確保）
    this._timeSelected = null;         // 選択ホップの time（Uint8Array(2048)。事前確保）
    this._freqSliceView = null;        // _freqSelected の 50Hz〜15kHz スライス（事前確保）
    // ウォッチドッグ・受信レート計測（時刻は captureFrame の引数から得る）
    this._wdRefMs = null;
    this._wdHopCount = 0;
    this._wdLastNowMs = 0;
    this._rateStartMs = null;
    this._rateStartCount = 0;
    this._hopsPerSec = 0;
    this._debugInfo = { status: 'initializing', lastHop: -1, hopsPerSec: 0 };
  }

  _ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = this._smoothing;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeArray = new Uint8Array(this.analyser.fftSize); // 時間波形（Phase 6）
    this.analyser.connect(this.ctx.destination);
    // MFS 用の事前確保バッファ（毎フレームの生成を避ける）
    this._view = new MfsFrameView();
    this._freqSelected = new Uint8Array(MFS_CONST.FFT_SIZE / 2);
    this._timeSelected = new Uint8Array(MFS_CONST.FFT_SIZE);
    const { startBin, endBin } = this._freqRange();
    this._freqSliceView = this._freqSelected.subarray(startBin, endBin);
    this._clearSelection();
    this._initMfs();
  }

  // ── MFS 初期化（§6.2「初期化と状態」） ──
  // 同期的に失敗が分かる場合（強制失敗フラグ・AudioWorklet 非対応）はすぐ 'fallback'。
  // それ以外は 'initializing' で addModule を開始し、完了で 'active'、例外で 'fallback'。
  _initMfs() {
    this.mfsStatus = 'initializing';
    if (typeof window !== 'undefined' && window.__avzForceMfsFailure === true) {
      this._enterFallback('強制失敗フラグ（__avzForceMfsFailure）');
      return;
    }
    if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      this._enterFallback('AudioWorklet に対応していません');
      return;
    }
    const ctx = this.ctx;
    ctx.audioWorklet.addModule(createMfsWorkletUrl()).then(() => {
      if (this.mfsStatus !== 'initializing') return;
      const node = new AudioWorkletNode(ctx, 'mfs', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
        processorOptions: { mode: 'live', smoothing: this._smoothing },
      });
      node.port.onmessage = (ev) => this._onMfsMessage(ev.data);
      node.onprocessorerror = () => this._enterFallback('MFS プロセッサでエラーが発生しました');
      // 出力を接続して確実に process() が呼ばれるようにする（音は鳴らさない）
      const silent = ctx.createGain();
      silent.gain.value = 0;
      node.connect(silent);
      silent.connect(ctx.destination);
      this._mfsNode = node;
      this._silentGain = silent;
      this.mfsStatus = 'active';
      this._wdRefMs = null;
      // 'initializing' 中に接続された音源は、ここで MFS 側へ接続する
      if (this.source) this.source.connect(node);
    }).catch((e) => {
      this._enterFallback('MFS ワークレットの初期化に失敗: ' + (e && e.message ? e.message : e));
    });
  }

  // AnalyserNode 経路へ切り替える（以後このページでは戻らない）。console.error は使わない
  _enterFallback(reason) {
    if (this.mfsStatus === 'fallback') return;
    console.warn('[AudioEngine] MFS を使えないため AnalyserNode 経路にフォールバックします: ' + reason);
    this.mfsStatus = 'fallback';
    const node = this._mfsNode;
    this._mfsNode = null;
    if (node) {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      try { node.disconnect(); } catch (_) {}
    }
    if (this._silentGain) {
      try { this._silentGain.disconnect(); } catch (_) {}
      this._silentGain = null;
    }
    this._clearSelection();
  }

  // ワークレットからのメッセージ（hop のみ使う）
  _onMfsMessage(m) {
    if (!m || m.type !== 'hop' || this.mfsStatus !== 'active') return;
    // ホップ番号が戻った = ワークレットが reset された（reset 前に送られた未着メッセージが残っていた場合の自己修復）
    if (m.hop <= this._lastRecvHop) this._clearSelection();
    this._ring[this._ringPos] = m;
    this._ringPos = (this._ringPos + 1) % this._ring.length;
    this._lastRecvHop = m.hop;
    this._hopCount++;
  }

  // リング・選択・選択済みバッファを初期状態へ戻す
  _clearSelection() {
    this._ring.fill(null);
    this._ringPos = 0;
    this._selected = null;
    this._lastSelHop = -1;
    this._lastRecvHop = -1;
    if (this._freqSelected) this._freqSelected.fill(0);
    if (this._timeSelected) this._timeSelected.fill(128);
    if (this._view) this._view.raw.fill(0);
  }

  // 音源を MFS ノードへも接続する（active のときのみ。initializing 中は _initMfs 完了時に接続される）
  _attachMfs() {
    if (this.source && this._mfsNode) this.source.connect(this._mfsNode);
  }

  connectMedia(mediaElement) {
    this._ensureContext();
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    // createMediaElementSource は同一要素へ2回呼ぶと例外になるため、
    // 要素→ソースノードをキャッシュしてスロット再選択時に再利用する（Phase 12）
    if (!this._mediaSources) this._mediaSources = new WeakMap();
    let source = this._mediaSources.get(mediaElement);
    if (!source) {
      source = this.ctx.createMediaElementSource(mediaElement);
      this._mediaSources.set(mediaElement, source);
    }
    this.source = source;
    this.source.connect(this.analyser);
    this._attachMfs();
    this.resetAnalysis();
  }

  // マイク入力等の MediaStream を解析グラフへ接続する（Phase 8: マイク入力対応）
  connectStream(stream) {
    this._ensureContext();
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    this._attachMfs();
    this.resetAnalysis();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      return this.ctx.resume();
    }
    return Promise.resolve();
  }

  // フレームごとに1回呼び出してデータを取得する。nowPerfMs は performance.now() の値（VisualizerCore が渡す）
  captureFrame(nowPerfMs) {
    if (!this.analyser) return;
    if (this.mfsStatus === 'active') {
      this._captureMfs(nowPerfMs);
      return;
    }
    this.analyser.getByteFrequencyData(this.dataArray);
    if (this.timeArray) this.analyser.getByteTimeDomainData(this.timeArray);
  }

  // 「今スピーカーから出ている音」に対応するホップを選ぶ（出力遅延の補正。§6.2）
  _captureMfs(nowPerfMs) {
    const now = typeof nowPerfMs === 'number' ? nowPerfMs : 0;
    this._watchdog(now);

    const ctx = this.ctx;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    const target = (ts && ts.contextTime > 0 && ts.performanceTime > 0)
      ? ts.contextTime + (now - ts.performanceTime) / 1000
      : ctx.currentTime - (ctx.baseLatency || 0) - (ctx.outputLatency || 0);

    // リング内で t <= target を満たす最新のホップ
    const ring = this._ring;
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const e = ring[i];
      if (e && e.t <= target && (best === null || e.hop > best.hop)) best = e;
    }
    if (best === null) return;   // 前回の選択を維持（初回は null のまま）

    const view = this._view;
    if (best !== this._selected) {
      this._selected = best;
      view.setPacked(best.f);
      this._freqSelected.set(best.freq);
      this._timeSelected.set(best.time);
    }
    // フラグの集約: 前回選択より後〜今回選択以下の全ホップの OR（二重発火・取りこぼしを防ぐ）。
    // 対象が空（前回と同じ件を含む）なら 0。リング内の packed は書き換えない
    let onset = 0, beat = 0, down = 0;
    const last = this._lastSelHop;
    const sel = best.hop;
    if (sel > last) {
      for (let i = 0; i < ring.length; i++) {
        const e = ring[i];
        if (e && e.hop > last && e.hop <= sel) {
          onset |= e.f[MFS_LAYOUT.ONSET_FLAGS];
          beat |= e.f[MFS_LAYOUT.BEAT_FLAG];
          down |= e.f[MFS_LAYOUT.DOWNBEAT_FLAG];
        }
      }
    }
    const raw = view.raw;
    raw[MFS_LAYOUT.ONSET_FLAGS] = onset;
    raw[MFS_LAYOUT.BEAT_FLAG] = beat ? 1 : 0;
    raw[MFS_LAYOUT.DOWNBEAT_FLAG] = down ? 1 : 0;
    this._lastSelHop = sel;
  }

  // ホップ受信レートの計測と、ホップが届かない場合のフォールバック判定
  _watchdog(now) {
    // 受信レート（直近約1秒）
    if (this._rateStartMs === null) {
      this._rateStartMs = now;
      this._rateStartCount = this._hopCount;
    } else if (now - this._rateStartMs >= 1000) {
      this._hopsPerSec = (this._hopCount - this._rateStartCount) * 1000 / (now - this._rateStartMs);
      this._rateStartMs = now;
      this._rateStartCount = this._hopCount;
    }
    // ウォッチドッグ: 音源接続済みかつ running なのにホップが届かない
    // （タブが隠れて rAF が止まっていた間の時間差は数えない）
    const gap = now - this._wdLastNowMs;
    this._wdLastNowMs = now;
    const watching = this.source && this.ctx.state === 'running';
    if (!watching || this._wdRefMs === null || this._hopCount !== this._wdHopCount || gap > 1000) {
      this._wdRefMs = now;
      this._wdHopCount = this._hopCount;
      return;
    }
    if (now - this._wdRefMs > MFS_CONST.LIVE_WATCHDOG_SEC * 1000) {
      this._enterFallback(MFS_CONST.LIVE_WATCHDOG_SEC + ' 秒間ホップが届きませんでした');
    }
  }

  // 解析をやり直す（シーク・停止・スロット切替・メディア読込時。§6.2）
  resetAnalysis() {
    if (this._mfsNode) this._mfsNode.port.postMessage({ type: 'reset' });
    this._clearSelection();
    this._wdRefMs = null;
  }

  // 'active' かつ選択済みなら特徴ビュー、それ以外は null
  getFeatures() {
    return (this.mfsStatus === 'active' && this._selected) ? this._view : null;
  }

  // { status, lastHop, hopsPerSec }。同一オブジェクトを使い回して値だけ更新する（毎フレーム呼んでも生成なし）
  getMfsDebugInfo() {
    const d = this._debugInfo;
    d.status = this.mfsStatus;
    d.lastHop = this._lastRecvHop;
    d.hopsPerSec = this._hopsPerSec;
    return d;
  }

  // 時間波形データ（Phase 6: リサージュ等）
  getTimeDomainData() {
    if (this.mfsStatus === 'active' && this._timeSelected) return this._timeSelected;
    return this.timeArray || null;
  }

  // 50Hz〜15kHz の全帯域スライス（captureFrame 済みのデータを使う）
  getFreqSlice() {
    if (!this.dataArray) return null;
    if (this.mfsStatus === 'active' && this._freqSliceView) return this._freqSliceView;
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
  // オフライン書き出し（offline-exporter.js）と同一ロジックを共有する（vis-utils.js）
  _freqRange() {
    return computeFreqRange(this.ctx.sampleRate, this.dataArray.length);
  }

  // レイヤーに対応する帯域データを返す（互換のため残す。T16-07 以降のライブ描画は FramePipeline 内で切り出すため使わない）
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
    this._smoothing = value;
    if (this.analyser) this.analyser.smoothingTimeConstant = value;
    if (this._mfsNode) this._mfsNode.port.postMessage({ type: 'smoothing', value: value });
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
