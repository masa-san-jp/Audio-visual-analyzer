document.addEventListener('DOMContentLoaded', () => {
  const canvas       = document.getElementById('canvas');
  const audioEngine  = new AudioEngine();
  const mediaManager = new MediaManager(audioEngine);
  const visualizer   = new VisualizerCore(canvas, audioEngine);
  const recorder     = new Recorder(canvas, audioEngine);
  const micInput     = new MicInputManager(audioEngine);
  const ui           = new UIController(visualizer, mediaManager, audioEngine, recorder, micInput);

  // GPU タイプの橋渡し（WebGL は最初に GPU タイプが選ばれるまで作らない）— 統合設計 §2
  const worldBridge = new WorldBridge({
    container: document.getElementById('visualizer-area'),
    gpuCanvas: document.getElementById('gpu-canvas'),
    audioEngine, mediaManager, songMapService: ui.songMapService,
    messageEl: document.getElementById('gpu-message'),
    statusEl: document.getElementById('gpu-status'),
    canvas2d: canvas,
  });
  visualizer.worldBridge = worldBridge;
  ui.worldBridge = worldBridge;

  // 初期レイアウト確定後にキャンバスサイズを設定
  visualizer.resize();

  // UI イベント登録
  ui.init();

  // デバッグ・動作確認用（devtools コンソールから状態を参照できるようにする）
  window.__app = { audioEngine, mediaManager, visualizer, recorder, micInput, ui, worldBridge };

  // 最初から黒背景を表示するためにループを開始
  visualizer.start();
});
