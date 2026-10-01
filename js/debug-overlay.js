// 目的 — `?debug=1` のときだけ表示するデバッグ表示（FPS・描画時間・タイプ）— doc/20260928-plan-phase15-test-foundation-and-frame-pipeline.md §5

const DEBUG_OVERLAY_WINDOW_FRAMES = 120;   // 描画時間の集計対象（直近フレーム数）
const DEBUG_OVERLAY_UPDATE_MS = 250;       // DOM 更新間隔
const DEBUG_OVERLAY_FPS_WINDOW_MS = 1000;  // FPS の集計窓

class DebugOverlay {
  // 有効（URL に debug=1）のときだけ要素を作って返す。無効時は null（DOM には何も触れない）。
  // search は検証用に差し替え可能（既定は location.search）。
  static create(containerEl, search) {
    const query = (search !== undefined)
      ? search
      : (typeof location !== 'undefined' ? location.search : '');
    if (!containerEl || !DebugOverlay.isEnabled(query)) return null;
    return new DebugOverlay(containerEl);
  }

  static isEnabled(search) {
    if (typeof URLSearchParams === 'undefined') return false;
    return new URLSearchParams(search || '').get('debug') === '1';
  }

  constructor(containerEl) {
    this.element = document.createElement('div');
    this.element.id = 'debug-overlay';
    const style = this.element.style;
    style.position = 'absolute';
    style.left = '8px';
    style.top = '8px';
    style.zIndex = '10';
    style.padding = '4px 8px';
    style.background = 'rgba(0,0,0,0.6)';
    style.color = '#0f0';
    style.font = '12px/1.4 monospace';
    style.whiteSpace = 'pre';
    style.pointerEvents = 'none';
    containerEl.style.position = 'relative';
    containerEl.appendChild(this.element);

    // 以下は constructor で確保し、recordFrame / setField では新規生成しない
    this._ring = new Float32Array(DEBUG_OVERLAY_WINDOW_FRAMES);
    this._sorted = new Float32Array(DEBUG_OVERLAY_WINDOW_FRAMES);
    this._count = 0;
    this._head = 0;
    this._fpsStartMs = -1;
    this._fpsFrames = 0;
    this._fps = -1;
    this._lastUpdateMs = -Infinity;
    this._typeText = '-';
    this._extra = {};
    this._extraKeys = [];
    this.element.textContent = 'FPS: --';
  }

  // 1フレーム分の描画時間(ms)を記録する。nowMs は呼び出し側の時刻。
  recordFrame(renderMs, nowMs) {
    this._ring[this._head] = renderMs;
    this._head = (this._head + 1) % DEBUG_OVERLAY_WINDOW_FRAMES;
    if (this._count < DEBUG_OVERLAY_WINDOW_FRAMES) this._count++;

    if (this._fpsStartMs < 0) {
      this._fpsStartMs = nowMs;
      this._fpsFrames = 0;
    }
    this._fpsFrames++;
    const span = nowMs - this._fpsStartMs;
    if (span >= DEBUG_OVERLAY_FPS_WINDOW_MS) {
      this._fps = this._fpsFrames * 1000 / span;
      this._fpsStartMs = nowMs;
      this._fpsFrames = 0;
    }

    if (nowMs - this._lastUpdateMs >= DEBUG_OVERLAY_UPDATE_MS) {
      this._lastUpdateMs = nowMs;
      this._refresh();
    }
  }

  // 任意項目を設定する。key は 'type' のほか Phase 16 以降の追加項目用。
  setField(key, text) {
    if (key === 'type') {
      this._typeText = text;
      return;
    }
    if (!(key in this._extra)) this._extraKeys.push(key);
    this._extra[key] = text;
  }

  // 250ms ごとの表示更新（毎フレームは呼ばれない）
  _refresh() {
    const n = this._count;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const v = this._ring[i];
      this._sorted[i] = v;
      sum += v;
      if (v > max) max = v;
    }
    const view = this._sorted.subarray(0, n);
    view.sort();
    const p95 = n > 0 ? view[Math.max(0, Math.ceil(n * 0.95) - 1)] : 0;
    const avg = n > 0 ? sum / n : 0;

    let text = 'FPS: ' + (this._fps >= 0 ? this._fps.toFixed(1) : '--')
      + '\nrender avg/p95/max: ' + avg.toFixed(2) + ' / ' + p95.toFixed(2) + ' / ' + max.toFixed(2) + ' ms'
      + '\ntype: ' + this._typeText;
    for (let i = 0; i < this._extraKeys.length; i++) {
      const key = this._extraKeys[i];
      text += '\n' + key + ': ' + this._extra[key];
    }
    this.element.textContent = text;
  }

  dispose() {
    if (this.element.parentNode) this.element.parentNode.removeChild(this.element);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DebugOverlay };
}
