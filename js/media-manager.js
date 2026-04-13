class MediaManager {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.mediaElement = null;
    this.currentUrl = null;
    this.onEnded = null;
  }

  loadFile(file) {
    return new Promise((resolve, reject) => {
      // Clean up previous element
      if (this.mediaElement) {
        this.mediaElement.pause();
        this.mediaElement.src = '';
      }
      if (this.currentUrl) {
        URL.revokeObjectURL(this.currentUrl);
        this.currentUrl = null;
      }

      const url = URL.createObjectURL(file);
      this.currentUrl = url;

      const isVideo = file.type.startsWith('video/');
      const el = document.createElement(isVideo ? 'video' : 'audio');
      el.preload = 'auto';
      el.src = url;

      el.addEventListener('canplay', () => {
        this.mediaElement = el;
        this.audioEngine.connectMedia(el);
        if (this.onEnded) {
          el.addEventListener('ended', this.onEnded);
        }
        resolve({ element: el, name: file.name, isVideo });
      }, { once: true });

      el.addEventListener('error', () => {
        reject(new Error(`"${file.name}" の読み込みに失敗しました`));
      }, { once: true });
    });
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

  get isPlaying() {
    return !!(this.mediaElement && !this.mediaElement.paused);
  }

  get isLoaded() {
    return !!this.mediaElement;
  }
}
