// マイク入力 — doc/plan-phase8.md §8.2
// getUserMedia でマイク入力を取得し、AudioEngine の解析グラフへ接続する。

class MicInputManager {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.stream = null;
    this.active = false;
  }

  async start() {
    if (this.active) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('この環境ではマイク入力に対応していません');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      throw new Error('マイクの使用が許可されませんでした');
    }
    await this.audioEngine.resume();
    this.audioEngine.connectStream(stream);
    this.stream = stream;
    this.active = true;
    return true;
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.active = false;
  }
}
