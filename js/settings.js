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
  // 背景色
  bgColor: '#000',             // '#000' | '#fff'
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
