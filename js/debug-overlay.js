// 目的 — `?debug=1` のときだけ表示するデバッグ表示（FPS・描画時間・タイプ）— doc/20260928-plan-phase15-test-foundation-and-frame-pipeline.md §5

const DEBUG_OVERLAY_WINDOW_FRAMES = 120;   // 描画時間の集計対象（直近フレーム数）
const DEBUG_OVERLAY_UPDATE_MS = 250;       // DOM 更新間隔
const DEBUG_OVERLAY_FPS_WINDOW_MS = 1000;  // FPS の集計窓
const DEBUG_OVERLAY_ONSET_HOLD_MS = 150;   // オンセットランプの点灯時間（Phase 16 計画書 §7）
const DEBUG_OVERLAY_BEAT_BAR_CELLS = 8;    // 拍位相テキストバーの桁数
const DEBUG_OVERLAY_BEATS_PER_BAR = 4;     // 小節内の拍数（MFS_LAYOUT.BEAT_IN_BAR の範囲 0..3）
// オンセットランプの表示文字列（bit0=L, bit1=M, bit2=H の 8 通り。事前生成して更新時に生成しない）
const DEBUG_OVERLAY_LAMP_TEXTS = (function () {
  const out = [];
  for (let m = 0; m < 8; m++) {
    out.push('onset: ' + ((m & 1) ? 'L' : '.') + ' ' + ((m & 2) ? 'M' : '.') + ' ' + ((m & 4) ? 'H' : '.'));
  }
  return out;
})();

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
    // 本文（250ms ごとに更新）とオンセットランプ（状態が変わったときだけ更新）を別要素にする
    this._textEl = document.createElement('div');
    this._lampEl = document.createElement('div');
    this._lampEl.style.display = 'none';
    this.element.appendChild(this._textEl);
    this.element.appendChild(this._lampEl);

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
    this._textEl.textContent = 'FPS: --';

    // MFS 項目（Phase 16 T16-11）。setMfsSource を呼ぶまで表示しない
    this._mfsEngine = null;
    this._features = null;
    this._onsetLastMs = new Float64Array(3).fill(-Infinity);  // low / mid / high
    this._lampMask = -1;
  }

  // MFS 項目の取得元（AudioEngine）を設定する。設定後、MFS / BPM / beat / LUFS / hops の行が加わる。
  setMfsSource(engine) {
    this._mfsEngine = engine;
    this._lampEl.style.display = engine ? '' : 'none';
    this._lampMask = -1;
  }

  // 毎フレーム呼ぶ。features は MfsFrameView | null。割り当てなし（ランプは状態変化時のみ DOM 更新）
  recordFeatures(features, nowMs) {
    this._features = features;
    if (!this._mfsEngine) return;
    if (features) {
      const flags = features.onset.flags;
      for (let g = 0; g < 3; g++) {
        if ((flags >> g) & 1) this._onsetLastMs[g] = nowMs;
      }
    }
    let mask = 0;
    for (let g = 0; g < 3; g++) {
      if (nowMs - this._onsetLastMs[g] < DEBUG_OVERLAY_ONSET_HOLD_MS) mask |= (1 << g);
    }
    if (mask !== this._lampMask) {
      this._lampMask = mask;
      this._lampEl.textContent = DEBUG_OVERLAY_LAMP_TEXTS[mask];
    }
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
    if (this._mfsEngine) text += this._mfsText();
    this._textEl.textContent = text;
  }

  // MFS 行（250ms ごとにだけ呼ばれる。文字列生成はここに限る）
  _mfsText() {
    const info = this._mfsEngine.getMfsDebugInfo();
    const f = this._features;
    let text = '\nMFS: ' + info.status;
    if (f && f.tempo.locked) {
      text += '\nBPM ' + f.tempo.bpm.toFixed(1) + ' (' + f.tempo.confidence.toFixed(2) + ') locked';
      const filled = Math.min(DEBUG_OVERLAY_BEAT_BAR_CELLS,
        Math.floor(f.tempo.beatPhase * DEBUG_OVERLAY_BEAT_BAR_CELLS) + 1);
      let bar = '';
      for (let i = 0; i < DEBUG_OVERLAY_BEAT_BAR_CELLS; i++) bar += (i < filled) ? '#' : '.';
      text += '\nbeat [' + bar + '] ' + (Math.round(f.tempo.beatInBar) + 1) + '/' + DEBUG_OVERLAY_BEATS_PER_BAR;
    } else {
      text += '\nBPM ' + (f ? f.tempo.bpm.toFixed(1) + ' (' + f.tempo.confidence.toFixed(2) + ') \u2014' : '\u2014');
      text += '\nbeat [' + '........' + '] \u2014';
    }
    if (f) {
      text += '\nLUFS M ' + f.loudness.momentary.toFixed(1) + ' S ' + f.loudness.shortTerm.toFixed(1)
        + ' AGC ' + f.loudness.agcDb.toFixed(1) + 'dB';
    } else {
      text += '\nLUFS M \u2014 S \u2014 AGC \u2014';
    }
    text += '\nhops/s: ' + info.hopsPerSec;
    return text;
  }

  dispose() {
    if (this.element.parentNode) this.element.parentNode.removeChild(this.element);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DebugOverlay };
}
