// 目的 — ゴールデンフレームの46ケースを決定的に定義する（計画書 §3.6.1。IMP-02 で対数軸6ケース、Phase 21 で縦型6ケースを追加）。

const GOLDEN_ANALYZER_TYPES = [
  'bar', 'radial', 'spectrogram', 'terrain', 'tunnel',
  'lissajous',
];

function _goldenCaseSettings(overrides) {
  const settings = createDefaultSettings();
  Object.assign(settings, overrides);
  return settings;
}

function _goldenBasicCase(type, bgColor, width, height, aspectId) {
  const bgId = bgColor === '#000' ? 'black' : 'white';
  return {
    id: `${type}-${bgId}-${aspectId}`,
    width,
    height,
    settings: _goldenCaseSettings({ analyzerType: type, bgColor }),
  };
}

function _goldenExtraCase(id, overrides) {
  return {
    id,
    width: 320,
    height: 180,
    settings: _goldenCaseSettings(overrides),
  };
}

function createGoldenCases() {
  const cases = [];
  for (const type of GOLDEN_ANALYZER_TYPES) {
    cases.push(_goldenBasicCase(type, '#000', 320, 180, '169'));
    cases.push(_goldenBasicCase(type, '#000', 180, 180, '11'));
    cases.push(_goldenBasicCase(type, '#fff', 320, 180, '169'));
    cases.push(_goldenBasicCase(type, '#fff', 180, 180, '11'));
  }

  cases.push(_goldenExtraCase('bar-line', {
    analyzerType: 'bar', expressionMethod: 'line',
  }));
  cases.push(_goldenExtraCase('bar-dot', {
    analyzerType: 'bar', expressionMethod: 'dot',
  }));
  cases.push(_goldenExtraCase('bar-mirror-v', {
    analyzerType: 'bar', barDisplayMode: 'mirror-vertical',
  }));
  cases.push(_goldenExtraCase('bar-mirror-h', {
    analyzerType: 'bar', barDisplayMode: 'mirror-horizontal',
  }));
  cases.push(_goldenExtraCase('radial-line', {
    analyzerType: 'radial', expressionMethod: 'line',
  }));
  cases.push(_goldenExtraCase('radial-dot', {
    analyzerType: 'radial', expressionMethod: 'dot',
  }));
  cases.push(_goldenExtraCase('bar-layers4', {
    analyzerType: 'bar',
    layerCount: 4,
    layers: createDefaultSettings().layers.map((layer) => ({ ...layer, blendMode: 'lighter' })),
  }));
  cases.push(_goldenExtraCase('bar-afterimage', {
    analyzerType: 'bar', afterimageIntensity: 5,
  }));
  cases.push(_goldenExtraCase('bar-physics', {
    analyzerType: 'bar', expressionMethod: 'line', physicsAmount: 5,
  }));
  cases.push(_goldenExtraCase('radial-huecont', {
    analyzerType: 'radial', hueContinuousMode: true, hueContinuousSpeed: 2,
  }));
  // IMP-02: 周波数軸の対数化。sampleRate / fftSize を渡すと写像が働く（渡さない上記34ケースは従来どおり線形）
  const logCase = (id, overrides) => Object.assign(_goldenExtraCase(id, overrides), { sampleRate: 48000, fftSize: 2048 });
  cases.push(logCase('bar-log', { analyzerType: 'bar' }));
  cases.push(logCase('bar-log-mirror-h', { analyzerType: 'bar', barDisplayMode: 'mirror-horizontal' }));
  cases.push(logCase('bar-log-layers4', {
    analyzerType: 'bar',
    layerCount: 4,
    layers: createDefaultSettings().layers.map((layer) => ({ ...layer, blendMode: 'lighter' })),
  }));
  cases.push(logCase('radial-log', { analyzerType: 'radial' }));
  cases.push(logCase('terrain-log', { analyzerType: 'terrain' }));
  cases.push(logCase('tunnel-log', { analyzerType: 'tunnel' }));
  // Phase 21: 縦型 9:16（90×160、黒背景、全6タイプ）
  for (const type of GOLDEN_ANALYZER_TYPES) cases.push(_goldenBasicCase(type, '#000', 90, 160, '916'));
  return cases;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createGoldenCases };
}

