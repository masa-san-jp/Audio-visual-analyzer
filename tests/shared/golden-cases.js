// 目的 — ゴールデンフレームの42ケースを決定的に定義する（計画書 §3.6.1）。

const GOLDEN_ANALYZER_TYPES = [
  'bar', 'radial', 'spectrogram', 'terrain', 'tunnel',
  'bar3d', 'ring3d', 'lissajous',
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
  return cases;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createGoldenCases };
}

