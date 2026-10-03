// 目的 — 自動演出のシーンカタログと設定パッチ — Phase 18 計画書 §6.1・§6.3。

const DIRECTOR_MANAGED_KEYS = [
  'analyzerType', 'expressionMethod', 'barDisplayMode', 'layerCount',
  'motionSpeed', 'particleAmount', 'afterimageIntensity', 'hue',
];

const DIRECTOR_SCENES = [
  { id: 'builtin:spectrogram', cls: 'calm', patch: { analyzerType: 'spectrogram' } },
  { id: 'builtin:lissajous', cls: 'calm', patch: { analyzerType: 'lissajous', expressionMethod: 'line', motionSpeed: 1.0, afterimageIntensity: 4 } },
  { id: 'builtin:flower', cls: 'calm', patch: { analyzerType: 'flower', expressionMethod: 'line', layerCount: 2, motionSpeed: 0.6, afterimageIntensity: 3 } },
  { id: 'builtin:voronoi', cls: 'calm', patch: { analyzerType: 'voronoi', layerCount: 2, motionSpeed: 0.5, particleAmount: 40, afterimageIntensity: 2 } },
  { id: 'builtin:ripple', cls: 'calm', patch: { analyzerType: 'ripple', layerCount: 2, motionSpeed: 0.8, afterimageIntensity: 3 } },
  { id: 'builtin:tunnel', cls: 'build', patch: { analyzerType: 'tunnel', expressionMethod: 'line', motionSpeed: 1.2, afterimageIntensity: 2 } },
  { id: 'builtin:terrain', cls: 'build', patch: { analyzerType: 'terrain', expressionMethod: 'line', motionSpeed: 1.0, afterimageIntensity: 0 } },
  { id: 'builtin:ring3d', cls: 'build', patch: { analyzerType: 'ring3d', expressionMethod: 'line', layerCount: 2, motionSpeed: 1.2, afterimageIntensity: 2 } },
  { id: 'builtin:flow', cls: 'build', patch: { analyzerType: 'flow', expressionMethod: 'dot', layerCount: 2, motionSpeed: 1.2, particleAmount: 70, afterimageIntensity: 4 } },
  { id: 'builtin:particles', cls: 'drop', patch: { analyzerType: 'particles', expressionMethod: 'dot', layerCount: 3, motionSpeed: 1.5, particleAmount: 90, afterimageIntensity: 3 } },
  { id: 'builtin:bar3d', cls: 'drop', patch: { analyzerType: 'bar3d', layerCount: 3, afterimageIntensity: 0 } },
  { id: 'builtin:radial', cls: 'drop', patch: { analyzerType: 'radial', expressionMethod: 'bar', layerCount: 3, afterimageIntensity: 2 } },
  { id: 'builtin:metaball', cls: 'drop', patch: { analyzerType: 'metaball', layerCount: 2, motionSpeed: 1.2, afterimageIntensity: 0 } },
  { id: 'builtin:bar', cls: 'drop', patch: { analyzerType: 'bar', expressionMethod: 'bar', barDisplayMode: 'mirror-vertical', layerCount: 4, afterimageIntensity: 1 } },
];

function directorSceneCandidates(cls, pool, presets) {
  let scenes = [];
  if (pool === 'presets') {
    for (const preset of presets) {
      const builtin = DIRECTOR_SCENES.find(scene => scene.patch.analyzerType === preset.settings.analyzerType);
      if (builtin.cls !== cls) continue;
      const patch = {};
      for (const key of DIRECTOR_MANAGED_KEYS) {
        // 色相は変化で加算するだけで、プリセットの絶対値は取り込まない。
        if (key !== 'hue' && Object.hasOwn(preset.settings, key)) patch[key] = preset.settings[key];
      }
      scenes.push({ id: `preset:${preset.name}`, cls, patch });
    }
  }
  if (scenes.length === 0) scenes = DIRECTOR_SCENES.filter(scene => scene.cls === cls);
  return scenes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function applyScenePatch(settings, patch) {
  if (Object.hasOwn(patch, 'analyzerType')) settings.analyzerType = patch.analyzerType;
  const capabilities = getRendererEntry(settings.analyzerType).capabilities;
  if (Object.hasOwn(patch, 'expressionMethod') && capabilities.methods.includes(patch.expressionMethod)) {
    settings.expressionMethod = patch.expressionMethod;
  }
  if (Object.hasOwn(patch, 'barDisplayMode') && capabilities.barDisplayMode === true) {
    settings.barDisplayMode = patch.barDisplayMode;
  }
  if (Object.hasOwn(patch, 'layerCount') && capabilities.layers === true) settings.layerCount = patch.layerCount;
  if (Object.hasOwn(patch, 'motionSpeed')) settings.motionSpeed = patch.motionSpeed;
  if (Object.hasOwn(patch, 'particleAmount')) settings.particleAmount = patch.particleAmount;
  if (Object.hasOwn(patch, 'afterimageIntensity')) settings.afterimageIntensity = patch.afterimageIntensity;
  return settings;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DIRECTOR_MANAGED_KEYS, DIRECTOR_SCENES, directorSceneCandidates, applyScenePatch };
}
