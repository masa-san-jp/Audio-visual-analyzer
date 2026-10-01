// 目的 — ライブ表示とオフライン書き出しで共通の1フレーム描画処理（背景クリア→動画合成→色相→レンダラー）を一箇所に集約する — doc/20260928-plan-phase15-test-foundation-and-frame-pipeline.md §4
// 時刻・音声取得・エンコードは知らない。呼び出し側が render() の input で渡す。

// freq を layerCount 等分したレイヤー帯域スライスを返す（AudioEngine.getLayerData と同じ線形分割）。
// freq が無ければ null。
function sliceLayerLinear(freq, layerIndex, layerCount) {
  if (!freq) return null;
  const len = freq.length;
  const start = Math.floor(layerIndex * len / layerCount);
  const end = Math.floor((layerIndex + 1) * len / layerCount);
  return freq.subarray(start, end);
}

class FramePipeline {
  constructor(canvas, ctx = canvas.getContext('2d')) {
    this.canvas = canvas;
    this.ctx = ctx;
    this._huePhase = 0;            // 色相連続変化の内部位相
    this._history = null;          // FrameHistory（遅延生成）
    this._beat = new BeatDetector();
    this._activeType = null;       // 現在のステートフルレンダラーのタイプ
    this._stateful = null;         // ステートフルレンダラーインスタンス
    this._physics = null;          // SpringArray（粘性揺らぎ用）
    this._physicsLen = 0;
    this._physicsOut = null;
    this._input = null;            // 描画中の input（_getLayer が参照する）
    // 毎フレームのクロージャ生成を避けるため、束縛関数は1回だけ作る
    this._getLayerBound = (i, count) => this._getLayer(i, count);
    // レンダラーへ渡す frame オブジェクト（使い回す）
    this._frame = {
      freq: null, time: null, history: null, beat: null,
      dtMs: 16.7, nowMs: 0,
      getLayer: this._getLayerBound,
    };
  }

  // キャンバスサイズ変更後に呼ぶ。ステートフルレンダラーへ通知する
  resize() {
    if (this._stateful && this._stateful.onResize) {
      this._stateful.onResize(this.canvas);
    }
  }

  // 履歴・BeatDetector・粘性揺らぎ状態・色相位相を初期化する
  reset() {
    this._huePhase = 0;
    this._history = null;
    this._beat = new BeatDetector();
    this._physics = null;
    this._physicsLen = 0;
    this._physicsOut = null;
  }

  // ステートフルレンダラーを破棄する
  dispose() {
    if (this._stateful && this._stateful.dispose) {
      try { this._stateful.dispose(); } catch (_) {}
    }
    this._stateful = null;
    this._activeType = null;
  }

  // 背景色で全面を塗る（停止時・リサイズ時用）
  fillBackground(settings) {
    this.ctx.fillStyle = settings.bgColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // 1フレーム描画（処理順は計画書 §4.3。現行コードと同一の順序）
  render(input, settings) {
    this._input = input;

    // 1. タイプ切替に応じてステートフルレンダラーを生成/破棄
    this._syncRenderer(settings.analyzerType);

    const entry = getRendererEntry(settings.analyzerType);
    const selfClear = !!(entry.capabilities && entry.capabilities.selfClear);

    // 2. 残像付きクリア → 動画合成（selfClear タイプは自分で全面を塗るため対象外）
    if (!selfClear) {
      this._clearWithAfterimage(settings);
      if (input.drawBackground) input.drawBackground(this.ctx, this.canvas);
    }

    // 3. 色相連続変化（経過時間基準: 計画書 §4.4）
    let effectiveHue = settings.hue;
    if (settings.hueContinuousMode) {
      this._huePhase = (this._huePhase + settings.hueContinuousSpeed * 0.5 * (input.dtMs / 16.7)) % 360;
      effectiveHue = (settings.hue + this._huePhase) % 360;
    }

    // 4. レンダラー呼び出し
    if (entry.stateful && this._stateful) {
      this._renderStateful(input, settings, effectiveHue);
    } else {
      this._renderStateless(entry, input, settings, effectiveHue);
    }
  }

  // freq から現在の input のレイヤー帯域を得る。input.getLayer があればそれを優先する
  _getLayer(i, count) {
    const input = this._input;
    if (!input) return null;
    if (input.getLayer) return input.getLayer(i, count);
    return sliceLayerLinear(input.freq, i, count);
  }

  _syncRenderer(type) {
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

  _clearWithAfterimage(settings) {
    const intensity = settings.afterimageIntensity || 0;
    if (intensity <= 0) {
      this.fillBackground(settings);
      return;
    }
    const fadeAlpha = Math.pow(0.7, intensity);
    const isWhite = settings.bgColor === '#fff';
    const rgb = isWhite ? '255,255,255' : '0,0,0';
    this.ctx.fillStyle = `rgba(${rgb},${fadeAlpha})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // 履歴バッファを（必要なら）確保・サイズ調整する。frameLength は freq.length。
  // freq が無い場合は既存の履歴をそのまま返す（新規確保しない）
  _ensureHistory(freq, settings, historyFps) {
    if (!freq || freq.length <= 0) return this._history;
    const len = freq.length;
    const capSeconds = clamp(settings.historySeconds != null ? settings.historySeconds : 4, 1, 8);
    const capacity = Math.min(240, Math.max(2, Math.round(capSeconds * historyFps)));
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

  // ── ステートフル描画 ──
  _renderStateful(input, settings, effectiveHue) {
    const freq = input.freq;
    const history = this._ensureHistory(freq, settings, input.historyFps);
    if (history && freq) history.push(freq);

    const frame = this._frame;
    frame.freq = freq;
    frame.time = input.time;
    frame.history = history;
    frame.beat = this._beat.update(freq, input.nowMs);
    frame.dtMs = input.dtMs;
    frame.nowMs = input.nowMs;
    frame.getLayer = this._getLayerBound;

    const s = { ...settings, hue: effectiveHue };
    this._stateful.render(this.ctx, this.canvas, frame, s);
  }

  // ── ステートレス描画（bar / radial） ──
  _renderStateless(entry, input, settings, effectiveHue) {
    const { layerCount, layers, expressionMethod } = settings;
    const rendererMap = entry.methods;
    const renderer = rendererMap[expressionMethod] || rendererMap.bar;
    const usePhysics = settings.physicsAmount > 0 &&
      (expressionMethod === 'line' || expressionMethod === 'dot') &&
      entry.capabilities && entry.capabilities.physics;
    const ctx = this.ctx;

    for (let i = 0; i < layerCount; i++) {
      let layerData = this._getLayer(i, layerCount);
      if (!layerData) continue;

      if (usePhysics) layerData = this._applyPhysics(layerData, input.dtMs, settings.physicsAmount);

      const layer = layers[i] || { hueOffset: 0, sensitivity: 1.0, blendMode: 'source-over' };
      const layerSettings = {
        ...settings,
        hue: (effectiveHue + layer.hueOffset + 360) % 360,
        sensitivity: settings.sensitivity * layer.sensitivity,
      };
      const prevOp = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = layer.blendMode || 'source-over';
      renderer(ctx, this.canvas, layerData, layerSettings);
      ctx.globalCompositeOperation = prevOp;
    }
  }

  // 粘性揺らぎ: layerData を SpringArray で平滑化した Uint8Array を返す
  _applyPhysics(layerData, dtMs, physicsAmount) {
    const n = layerData.length;
    const params = springParamsFromAmount(physicsAmount);
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

// Node 環境（テスト）向けエクスポート。ブラウザでは無視される。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FramePipeline, sliceLayerLinear };
}
