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
  // Phase 2
  rendererType: 'bars',   // 'bars' | 'lines' | 'dots' | 'radial' | 'mirror'
  zeroDbMode: 'bottom',   // 'bottom' | 'center'
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
