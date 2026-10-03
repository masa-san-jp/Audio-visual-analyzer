// 目的 — 設定の既定値（自動演出は OFF）— Phase 18 計画書 §7.1。
const DEFAULT_SETTINGS = {
  // 色
  hue: 200,
  hueRange: 60,
  brightness: 80,
  saturation: 100,
  // 音反応
  sensitivity: 1.0,
  smoothing: 0.80,
  // 形状
  barWidth: 2,
  // 表示
  aspectRatio: '16:9',
  // Phase 3: アナライザー構造
  analyzerType: 'bar',           // 'bar' | 'radial'
  expressionMethod: 'bar',       // 'bar' | 'line' | 'dot'
  barDisplayMode: 'normal',      // 'normal' | 'mirror-vertical' | 'mirror-horizontal'
  density: 100,                  // 30~100
  baseOffset: 0,                 // 0~99
  // Phase 3: 色相拡張
  hueContinuousMode: false,
  hueContinuousSpeed: 1.0,       // 0.1~5.0
  // Phase 3: 残像
  afterimageIntensity: 0,        // 0~10
  // Phase 6: 拡張表現パラメーター
  historySeconds: 4,             // 1~8   時間軸系の履歴長
  motionSpeed: 1.0,              // 0.1~3.0 回転・流れ・脈動の速度
  particleAmount: 50,            // 10~100 粒子・要素の量
  physicsAmount: 0,              // 0~10  粘性揺らぎ（バネ物理）
  depthAngle: 50,                // 0~100 3D地形の奥行き角度
  petalCount: 6,                 // 2~16  極座標フラワーの花弁数
  // Phase 10: 動画合成表示（動画ファイル読込時のみ有効）
  videoCompositeEnabled: false,
  videoCompositeOpacity: 100,        // 0~100
  videoCompositeBlendMode: 'source-over',
  // 背景色
  bgColor: '#000',             // '#000' | '#fff'
  // Phase 16: 音楽特徴ストリーム関連 — doc/20260928-plan-phase16-music-feature-stream.md §7
  autoGain: false,               // 音量自動補正（false で従来どおり）
  layerSplit: 'linear',          // レイヤー分割方式 'linear'（均等）| 'mel'（聴感）
  // Phase 18: 自動演出（既存の見た目を維持するため既定 OFF）
  directorEnabled: false,
  directorIntensity: 'standard',
  directorPool: 'builtin',
  directorFlash: true,
  directorSeedOffset: 0,
  // レイヤー
  layerCount: 1,
  layers: [
    { hueOffset: 0,   sensitivity: 1.0, blendMode: 'source-over' },
    { hueOffset: 90,  sensitivity: 1.0, blendMode: 'source-over' },
    { hueOffset: 180, sensitivity: 1.0, blendMode: 'source-over' },
    { hueOffset: 270, sensitivity: 1.0, blendMode: 'source-over' },
  ],
};

function createDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    layers: DEFAULT_SETTINGS.layers.map(l => ({ ...l })),
  };
}
