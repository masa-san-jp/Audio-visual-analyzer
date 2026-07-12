// 描画ループ v2 — doc/spec-phase6.md §4.1.3
// ステートレス（既存 bar/radial）とステートフル（Phase 6）レンダラーを両対応する。

class VisualizerCore {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioEngine = audioEngine;
    this.settings = createDefaultSettings();
    this.running = false;
    this.rafId = null;
    // 色相連続変化用の内部カウンター
    this._huePhase = 0;
    // Phase 6: フレーム状態
    this._history = null;          // FrameHistory（遅延生成）
    this._beat = new BeatDetector();
    this._lastFrameMs = 0;
    this._activeType = null;       // 現在のステートフルレンダラーのタイプ
    this._stateful = null;         // ステートフルレンダラーインスタンス
    this._physics = null;          // SpringArray（粘性揺らぎ用）
    this._physicsLen = 0;
    // 外へ渡す frame オブジェクト（使い回してGCを避ける）
    this._frame = {
      freq: null, time: null, history: null, beat: null,
      dtMs: 16.7, nowMs: 0,
      getLayer: (i, count) => this.audioEngine.getLayerData(i, count),
    };
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

    if (this._stateful && this._stateful.onResize) {
      this._stateful.onResize(this.canvas);
    }
    this._fillBackground();
  }

  start() {
    if (this.running) return;
    this.running = true;
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
    this.ctx.fillStyle = this.settings.bgColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _clearWithAfterimage() {
    const intensity = this.settings.afterimageIntensity;
    if (intensity <= 0) {
      this._fillBackground();
      return;
    }
    const fadeAlpha = Math.pow(0.7, intensity);
    const isWhite = this.settings.bgColor === '#fff';
    const rgb = isWhite ? '255,255,255' : '0,0,0';
    this.ctx.fillStyle = `rgba(${rgb},${fadeAlpha})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // 履歴バッファを（必要なら）確保・サイズ調整する
  _ensureHistory() {
    const len = this.audioEngine.freqSliceLength();
    if (len <= 0) return null;
    const capSeconds = clamp(this.settings.historySeconds, 1, 8);
    const capacity = Math.min(240, Math.max(2, Math.round(capSeconds * 60)));
    if (!this._history) {
      this._history = new FrameHistory(capacity, len);
    } else if (this._history.frameLength !== len) {
      this._history.setFrameLength(len);
    } else if (this._history.capacity !== capacity) {
      // 容量変更は作り直し（履歴はクリアされる）
      this._history = new FrameHistory(capacity, len);
    }
    return this._history;
  }

  // タイプ切替に応じてステートフルレンダラーを生成/破棄する
  _syncRenderer() {
    const type = this.settings.analyzerType;
    if (type === this._activeType) return;
    if (this._stateful && this._stateful.dispose) {
      try { this._stateful.dispose(); } catch (_) {}
    }
    this._stateful = null;
    const entry = getRendererEntry(type);
    if (entry.stateful) {
      this._stateful = entry.create(this.canvas);
      if (this._stateful.onResize) this._stateful.onResize(this.canvas);
    }
    // タイプ切替時は履歴をクリアして前タイプの残りを持ち越さない
    if (this._history) this._history.clear();
    this._activeType = type;
  }

  _loop() {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(() => this._loop());

    const now = performance.now();
    let dtMs = now - this._lastFrameMs;
    if (!(dtMs > 0) || dtMs > 200) dtMs = 16.7; // 異常値の吸収
    this._lastFrameMs = now;
    this._frame.dtMs = dtMs;
    this._frame.nowMs = now;

    this._syncRenderer();

    // フレームデータ取得
    this.audioEngine.captureFrame();

    const entry = getRendererEntry(this.settings.analyzerType);
    const selfClear = entry.capabilities && entry.capabilities.selfClear;
    if (!selfClear) this._clearWithAfterimage();

    // 色相連続変化モード
    let effectiveHue = this.settings.hue;
    if (this.settings.hueContinuousMode) {
      this._huePhase = (this._huePhase + this.settings.hueContinuousSpeed * 0.5) % 360;
      effectiveHue = (this.settings.hue + this._huePhase) % 360;
    }

    if (entry.stateful && this._stateful) {
      this._renderStateful(entry, effectiveHue, dtMs, now);
    } else {
      this._renderStateless(entry, effectiveHue);
    }
  }

  // ── ステートフル描画 ──
  _renderStateful(entry, effectiveHue, dtMs, nowMs) {
    const history = this._ensureHistory();
    const freq = this.audioEngine.getFreqSlice();
    if (history && freq) history.push(freq);

    const frame = this._frame;
    frame.freq = freq;
    frame.time = this.audioEngine.getTimeDomainData();
    frame.history = history;
    frame.beat = this._beat.update(freq, nowMs);
    frame.dtMs = dtMs;
    frame.nowMs = nowMs;

    const s = { ...this.settings, hue: effectiveHue };
    this._stateful.render(this.ctx, this.canvas, frame, s);
  }

  // ── ステートレス描画（既存 bar/radial） ──
  _renderStateless(entry, effectiveHue) {
    const { layerCount, layers, expressionMethod } = this.settings;
    const rendererMap = entry.methods;
    const renderer = rendererMap[expressionMethod] || rendererMap.bar;
    const usePhysics = this.settings.physicsAmount > 0 &&
      (expressionMethod === 'line' || expressionMethod === 'dot') &&
      entry.capabilities && entry.capabilities.physics;

    for (let i = 0; i < layerCount; i++) {
      let layerData = this.audioEngine.getLayerData(i, layerCount);
      if (!layerData) continue;

      if (usePhysics) layerData = this._applyPhysics(layerData, this._frame.dtMs);

      const layer = layers[i] || { hueOffset: 0, sensitivity: 1.0 };
      const layerSettings = {
        ...this.settings,
        hue: (effectiveHue + layer.hueOffset + 360) % 360,
        sensitivity: this.settings.sensitivity * layer.sensitivity,
      };
      renderer(this.ctx, this.canvas, layerData, layerSettings);
    }
  }

  // 粘性揺らぎ: layerData を SpringArray で平滑化した Uint8Array を返す
  // physicsAmount=0 のときは呼ばれない（呼び出し側でバイパス）
  _applyPhysics(layerData, dtMs) {
    const n = layerData.length;
    const params = springParamsFromAmount(this.settings.physicsAmount);
    if (!this._physics || this._physicsLen !== n) {
      this._physics = new SpringArray(n, params);
      this._physics.value.set(layerData); // 初期値を現状に合わせ突入を防ぐ
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
}
