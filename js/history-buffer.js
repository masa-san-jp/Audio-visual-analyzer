// Phase 6 履歴リングバッファ — doc/spec-phase6.md §4.2.2
// 固定容量。frame ごとの Uint8Array を事前確保し push はコピーのみ（GC 回避）。

class FrameHistory {
  constructor(capacity, frameLength) {
    this.capacity = Math.max(1, capacity | 0);
    this.frameLength = frameLength | 0;
    this._buffers = [];
    for (let i = 0; i < this.capacity; i++) {
      this._buffers.push(new Uint8Array(this.frameLength));
    }
    this._head = 0;   // 次に書き込む位置
    this.size = 0;    // 有効フレーム数
  }

  // 最新データを追加（コピー）。frameLength が変わった場合は作り直しが必要。
  push(data) {
    if (!data) return;
    const buf = this._buffers[this._head];
    if (data.length === this.frameLength) {
      buf.set(data);
    } else {
      // 長さ不一致時は安全に切り詰め/ゼロ埋め
      const n = Math.min(data.length, this.frameLength);
      for (let i = 0; i < n; i++) buf[i] = data[i];
      for (let i = n; i < this.frameLength; i++) buf[i] = 0;
    }
    this._head = (this._head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  // age=0 が最新、age=size-1 が最古。範囲外は null。
  get(age) {
    if (age < 0 || age >= this.size) return null;
    const idx = (this._head - 1 - age + this.capacity * 2) % this.capacity;
    return this._buffers[idx];
  }

  // フレーム長変更（レイアウト変更時）。全消去して確保し直す。
  setFrameLength(len) {
    len = len | 0;
    if (len === this.frameLength) { this.clear(); return; }
    this.frameLength = len;
    for (let i = 0; i < this.capacity; i++) {
      this._buffers[i] = new Uint8Array(len);
    }
    this.clear();
  }

  clear() {
    this._head = 0;
    this.size = 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FrameHistory };
}
