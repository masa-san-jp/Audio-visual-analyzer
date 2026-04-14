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
  // レイヤー
  layerCount: 1,
  layers: [
    { hueOffset: 0,   sensitivity: 1.0 },
    { hueOffset: 90,  sensitivity: 1.0 },
    { hueOffset: 180, sensitivity: 1.0 },
    { hueOffset: 270, sensitivity: 1.0 },
  ],
};

function createDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    layers: DEFAULT_SETTINGS.layers.map(l => ({ ...l })),
  };
}
