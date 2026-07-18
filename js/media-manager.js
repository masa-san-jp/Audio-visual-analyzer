// メディアファイルの読込・再生制御
// Phase 12: 3スロット再生キュー（doc/spec.md §8）に対応。
// 各スロットが独立にメディア要素を保持し、アクティブスロットの要素だけが
// 解析グラフへ接続される。既存の mediaElement / isLoaded / isPlaying は
// アクティブスロットを指す getter として互換を維持する。

const MEDIA_SLOT_COUNT = 3;

class MediaManager {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.slots = new Array(MEDIA_SLOT_COUNT).fill(null); // {element, url, name, isVideo}
    this.activeIndex = 0;
    this.onEnded = null;
  }

  get slotCount() { return MEDIA_SLOT_COUNT; }

  get mediaElement() {
    const slot = this.slots[this.activeIndex];
    return slot ? slot.element : null;
  }

  get isPlaying() {
    return !!(this.mediaElement && !this.mediaElement.paused);
  }

  get isLoaded() {
    return !!this.mediaElement;
  }

  // slotIndex 省略時はアクティブスロットへ読み込む（Phase 11 までの動作と互換）
  loadFile(file, slotIndex) {
    const index = slotIndex != null ? slotIndex : this.activeIndex;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video/');
      const el = document.createElement(isVideo ? 'video' : 'audio');
      el.preload = 'auto';
      el.src = url;

      el.addEventListener('canplay', () => {
        // 読込成功が確定してから旧スロット内容を破棄する（失敗時は旧内容を保持）
        this._disposeSlot(index);
        // ended はアクティブスロットの要素からのみ通知する。
        // 破棄時の src='' がブラウザによって ended を発火させる場合があるが、
        // mediaElement === el の判定により誤発火しない
        el.addEventListener('ended', () => {
          if (this.onEnded && this.mediaElement === el) this.onEnded();
        });
        this.slots[index] = { element: el, url, name: file.name, isVideo };
        if (index === this.activeIndex) {
          this.audioEngine.connectMedia(el);
        }
        resolve({ element: el, name: file.name, isVideo, slotIndex: index });
      }, { once: true });

      el.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        reject(new Error(`"${file.name}" の読み込みに失敗しました`));
      }, { once: true });
    });
  }

  // アクティブスロットを切り替える。切替できたら true
  selectSlot(index) {
    if (index < 0 || index >= MEDIA_SLOT_COUNT || !this.slots[index]) return false;
    if (index === this.activeIndex) return true;
    const current = this.mediaElement;
    if (current) current.pause();
    this.activeIndex = index;
    this.audioEngine.connectMedia(this.slots[index].element);
    return true;
  }

  // スロットの内容を破棄する（アクティブスロットの場合は再生も止まる）
  clearSlot(index) {
    if (index < 0 || index >= MEDIA_SLOT_COUNT) return;
    this._disposeSlot(index);
  }

  // ±dir 方向に次の設定済みスロットを循環探索して選択する。
  // 見つかれば選択後のインデックス、全スロット未設定なら -1 を返す。
  // 設定済みが自分だけの場合は自分自身に戻る（§8.2 のループ循環）
  advance(dir) {
    for (let step = 1; step <= MEDIA_SLOT_COUNT; step++) {
      const idx = ((this.activeIndex + dir * step) % MEDIA_SLOT_COUNT + MEDIA_SLOT_COUNT) % MEDIA_SLOT_COUNT;
      if (this.slots[idx]) {
        this.selectSlot(idx);
        return idx;
      }
    }
    return -1;
  }

  play() {
    if (!this.mediaElement) return;
    this.audioEngine.resume().then(() => this.mediaElement.play());
  }

  pause() {
    this.mediaElement?.pause();
  }

  stop() {
    if (!this.mediaElement) return;
    this.mediaElement.pause();
    this.mediaElement.currentTime = 0;
  }

  _disposeSlot(index) {
    const slot = this.slots[index];
    if (!slot) return;
    slot.element.pause();
    slot.element.src = '';
    URL.revokeObjectURL(slot.url);
    this.slots[index] = null;
  }
}
