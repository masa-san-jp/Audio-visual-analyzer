document.addEventListener('DOMContentLoaded', () => {
  const canvas       = document.getElementById('canvas');
  const audioEngine  = new AudioEngine();
  const mediaManager = new MediaManager(audioEngine);
  const visualizer   = new VisualizerCore(canvas, audioEngine);
  const recorder     = new Recorder(canvas, audioEngine);
  const ui           = new UIController(visualizer, mediaManager, audioEngine, recorder);

  // 初期レイアウト確定後にキャンバスサイズを設定
  visualizer.resize();

  // UI イベント登録
  ui.init();

  // デバッグ・動作確認用（devtools コンソールから状態を参照できるようにする）
  window.__app = { audioEngine, mediaManager, visualizer, recorder, ui };

  // 最初から黒背景を表示するためにループを開始
  visualizer.start();
});
