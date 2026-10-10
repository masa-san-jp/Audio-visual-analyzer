// 目的 — ライブ表示の rAF ループと入力組み立て（描画本体は FramePipeline に委譲）— Phase 15 計画書 §4.5・Phase 18 計画書 §4.4・§6.8
// 旧: 描画ループ v2 — doc/spec-phase6.md §4.1.3

class VisualizerCore {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioEngine = audioEngine;
    this.settings = createDefaultSettings();
    this.running = false;
    this.rafId = null;
    this._lastFrameMs = 0;
    // 1フレーム描画の本体（背景クリア・色相・レンダラー呼び出し）
    this.pipeline = new FramePipeline(canvas, this.ctx);
    // Phase 10: 動画合成表示（動画ファイル読込時に UIController が設定する）
    this.videoElement = null;
    // 音声・動画共通の再生時計と自動演出 — Phase 18 計画書 §4.4・§6.8
    this.mediaElement = null;
    this.director = new DirectorController(canvas, this.ctx);
    // GPU タイプの描画橋渡し（WorldBridge。app.js が設定する。2D だけの利用では null のまま）— 統合設計 §7
    this.worldBridge = null;
    this._prevSongTSec = null;
    this._songTempoMap = null;
    this._songTempoElement = null;
    this._boundLoop = () => this._loop();
    // `?debug=1` のときだけ start() で生成される（無効時は null のまま）— 計画書 §5
    this.debugOverlay = null;
    // pipeline.render へ渡す input（毎フレーム使い回して値だけ更新する）
    this._input = {
      freq: null, time: null,
      // T16-07 以降、レイヤーは FramePipeline 内で（音量自動補正後の）freq から切り出す（計画書 §6.5）
      getLayer: null,
      features: null, sampleRate: 0, fftSize: 2048,
      dtMs: 16.7, nowMs: 0,
      historyFps: 60,
      drawBackground: (ctx, canvas) => this._drawVideoComposite(ctx, canvas),
    };
  }

  // 現在のステートフルレンダラーのタイプ（テスト・診断用の読み取り専用ビュー）
  get _activeType() {
    return this.pipeline._activeType;
  }

  resize() {
    const area = this.canvas.parentElement;
    const aw = area.clientWidth;
    const ah = area.clientHeight;

    if (this.settings.aspectRatio === '16:9') {
      const byWidth = { w: aw, h: Math.round(aw * 9 / 16) };
      const byHeight = { w: Math.round(ah * 16 / 9), h: ah };
      const fit = byWidth.h <= ah ? byWidth : byHeight;
      this.canvas.width = fit.w;
      this.canvas.height = fit.h;
    } else {
      const size = Math.min(aw, ah);
      this.canvas.width = size;
      this.canvas.height = size;
    }
    // GPU タイプの canvas も同じ表示サイズに揃える（内部解像度は WorldBridge が決める）
    if (this.worldBridge) this.worldBridge.resize(this.canvas.width, this.canvas.height);

    this.pipeline.resize();
    this.director.resize();
    this._fillBackground();
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (!this.debugOverlay && typeof DebugOverlay !== 'undefined') {
      this.debugOverlay = DebugOverlay.create(this.canvas.parentElement);
      if (this.debugOverlay) this.debugOverlay.setMfsSource(this.audioEngine);
    }
    this._lastFrameMs = performance.now();
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this._fillBackground();
  }

  _fillBackground() {
    this.pipeline.fillBackground(this.settings);
  }

  // 動画ファイル読込中に、現在再生位置のフレームを cover フィットで描画する
  // （doc/plan-phase8.md §Phase 10.1）。UIController が videoElement /
  // settings.videoCompositeEnabled を設定したときのみ描画する。
  // pipeline.render の input.drawBackground として渡される（selfClear タイプでは呼ばれない）。
  _drawVideoComposite(ctx, canvas) {
    const el = this.videoElement;
    if (!el || !this.settings.videoCompositeEnabled) return;
    if (el.readyState < 2) return; // HAVE_CURRENT_DATA 未満はフレームが無い
    const vw = el.videoWidth, vh = el.videoHeight;
    if (!vw || !vh) return;

    const canvasAspect = canvas.width / canvas.height;
    const videoAspect = vw / vh;
    let sx, sy, sw, sh;
    if (videoAspect > canvasAspect) {
      sh = vh; sw = vh * canvasAspect; sx = (vw - sw) / 2; sy = 0;
    } else {
      sw = vw; sh = vw / canvasAspect; sx = 0; sy = (vh - sh) / 2;
    }

    const prevAlpha = ctx.globalAlpha;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalAlpha = clamp(this.settings.videoCompositeOpacity, 0, 100) / 100;
    ctx.globalCompositeOperation = this.settings.videoCompositeBlendMode || 'source-over';
    ctx.drawImage(el, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevOp;
  }

  _render(input) {
    if (this.settings.directorEnabled && this.director.isReady() && this.mediaElement) {
      this.director.render(input, this.settings, this.mediaElement.currentTime);
    } else {
      this.pipeline.render(input, this.settings);
    }
  }

  _loop() {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._boundLoop);

    const now = performance.now();
    let dtMs = now - this._lastFrameMs;
    if (!(dtMs > 0) || dtMs > 200) dtMs = 16.7; // 異常値の吸収
    this._lastFrameMs = now;

    // フレームデータ取得
    this.audioEngine.captureFrame(now);

    const input = this._input;
    input.freq = this.audioEngine.getFreqSlice();
    input.time = this.audioEngine.getTimeDomainData();
    input.features = this.audioEngine.getFeatures();
    input.sampleRate = this.audioEngine.ctx ? this.audioEngine.ctx.sampleRate : 0;
    input.dtMs = dtMs;
    input.nowMs = now;
    // 自動演出 OFF でもソングマップの拍精度を利用する。スロット変更では前時刻を捨てる。
    const map = this.director.songMap;
    const media = this.mediaElement;
    if (map !== this._songTempoMap || media !== this._songTempoElement) {
      this._prevSongTSec = null;
      this._songTempoMap = map;
      this._songTempoElement = media;
    }
    if (map && media) {
      songMapTempoAt(map, media.currentTime, this._prevSongTSec, input.features);
      this._prevSongTSec = media.currentTime;
    }
    // GPU タイプ: pipeline とディレクターは呼ばず、WorldBridge だけを駆動する（captureFrame は上で呼び済み）
    const bridge = this.worldBridge;
    if (bridge && bridge.active) {
      bridge.frame(now, dtMs / 1000);
      return;
    }
    const overlay = this.debugOverlay;
    if (overlay) {
      // デバッグ表示時のみ描画時間を計測する（ガイド §9.1 の時刻規則の例外、計画書 §5）
      const t0 = performance.now();
      this._render(input);
      overlay.setField('type', this.settings.directorEnabled && this.director.isReady() && media
        ? this.director.state.primary.settings.analyzerType : this.settings.analyzerType);
      overlay.recordFeatures(input.features, now);
      overlay.recordFrame(performance.now() - t0, now);
    } else {
      this._render(input);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VisualizerCore };
}
