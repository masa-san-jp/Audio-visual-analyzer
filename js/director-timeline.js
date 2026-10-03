// 目的 — 自動演出タイムラインの決定的コンパイル・変化・状態評価 — Phase 18 計画書 §6.2・§6.4〜§6.6。

const DIRECTOR_CONST = {
  KIND_CLASS: { intro: 'calm', break: 'calm', outro: 'calm', build: 'build', drop: 'drop' },
  MAIN_DROP_ENERGY: 0.6,
  VARIATION_PERIOD_BARS: { calm: 16, standard: 8, wild: 4 },
  VARIATION_OPS: ['hueShift', 'method', 'mirror', 'layers'],
  HUE_SHIFT_DEG: { calm: 30, standard: 60, wild: 60 },
  RAMP_MOTION_MUL: { calm: 1.4, standard: 1.8, wild: 2.2 },
  RAMP_AFTERIMAGE_ADD: 3,
  RAMP_PARTICLE_MUL: 1.5,
  FADE_MIN_SEC: 0.25,
  FADE_MAX_SEC: 1.0,
  FLASH_PEAK_ALPHA: 0.8,
  FLASH_TAU_SEC: 0.12,
  FLASH_DURATION_SEC: 0.4,
  FLASH_MIN_INTERVAL_SEC: 2.0,
  SEEK_RESET_SEC: 1.0,
};

function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(hash ^ str.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash;
}

function directorVariationApplicable(settings, op) {
  if (op === 'hueShift') return true;
  const capabilities = getRendererEntry(settings.analyzerType).capabilities;
  if (op === 'method') return capabilities.methods.length >= 2;
  if (op === 'mirror') return capabilities.barDisplayMode === true;
  if (op === 'layers') return capabilities.layers === true;
  return false;
}

// 同じ設定へ順に呼び出すことで、セグメント内の変化を累積させる（§6.5）。
function applyDirectorVariation(settings, op, intensity) {
  if (!directorVariationApplicable(settings, op)) return settings;
  if (op === 'hueShift') {
    settings.hue = (settings.hue + DIRECTOR_CONST.HUE_SHIFT_DEG[intensity]) % 360;
  } else if (op === 'method') {
    const methods = getRendererEntry(settings.analyzerType).capabilities.methods;
    settings.expressionMethod = methods[(methods.indexOf(settings.expressionMethod) + 1) % methods.length];
  } else if (op === 'mirror') {
    // 配列の生成を避け、状態評価の毎フレーム経路でもそのまま使える。
    settings.barDisplayMode = settings.barDisplayMode === 'normal' ? 'mirror-vertical'
      : settings.barDisplayMode === 'mirror-vertical' ? 'mirror-horizontal' : 'normal';
  } else if (op === 'layers') {
    settings.layerCount = (settings.layerCount % 4) + 1;
  }
  return settings;
}

function compileDirectorTimeline(songMap, options, presets) {
  const intensity = options.intensity;
  const seed = fnv1a32(`${songMap.durationSec.toFixed(3)}|${songMap.bpm.toFixed(2)}|${songMap.sections.length}|${options.seedOffset}`);
  const rng = makeRng(seed);
  const sceneByKey = Object.create(null);
  let prevSceneId = null;
  let lastFlash = -Infinity;
  const segments = [];
  const flashes = [];
  for (let i = 0; i < songMap.sections.length; i++) {
    const s = songMap.sections[i];
    const cls = s.kind === 'main' ? (s.energy >= DIRECTOR_CONST.MAIN_DROP_ENERGY ? 'drop' : 'calm')
      : DIRECTOR_CONST.KIND_CLASS[s.kind];
    const key = s.label + '|' + cls;
    let scene = sceneByKey[key];
    if (!scene) {
      let list = directorSceneCandidates(cls, options.pool, presets);
      if (list.length > 1) list = list.filter(candidate => candidate.id !== prevSceneId);
      scene = list[Math.floor(rng() * list.length)];
      sceneByKey[key] = scene;
    }
    const transitionIn = i === 0 || s.kind === 'drop' ? { type: 'cut', duration: 0 }
      : { type: 'fade', duration: clamp(60 / songMap.bpm, DIRECTOR_CONST.FADE_MIN_SEC, DIRECTOR_CONST.FADE_MAX_SEC) };
    let period = DIRECTOR_CONST.VARIATION_PERIOD_BARS[intensity];
    if (cls === 'drop') period = Math.max(2, period / 2);
    let opCursor = Math.floor(rng() * DIRECTOR_CONST.VARIATION_OPS.length);
    const variations = [];
    for (let bar = s.startBar + period; bar < s.endBar; bar += period) {
      for (let step = 0; step < 4; step++) {
        const position = opCursor + step;
        const op = DIRECTOR_CONST.VARIATION_OPS[position % 4];
        if (!directorVariationApplicable(scene.patch, op)) continue;
        variations.push({ timeSec: bar < songMap.bars.length ? songMap.bars[bar].startSec : songMap.durationSec, op });
        opCursor = position + 1;
        break;
      }
    }
    const ramp = s.kind === 'build' ? {
      motionMul: [1, DIRECTOR_CONST.RAMP_MOTION_MUL[intensity]],
      afterimageAdd: [0, DIRECTOR_CONST.RAMP_AFTERIMAGE_ADD],
      particleMul: [1, DIRECTOR_CONST.RAMP_PARTICLE_MUL],
    } : null;
    if (options.flash && intensity !== 'calm' && s.kind === 'drop' && i > 0
      && s.startSec - lastFlash >= DIRECTOR_CONST.FLASH_MIN_INTERVAL_SEC) {
      flashes.push(s.startSec);
      lastFlash = s.startSec;
    }
    segments.push({ startSec: s.startSec, endSec: s.endSec, sectionIndex: i, kind: s.kind, cls,
      sceneId: scene.id, patch: scene.patch, variations, ramp, transitionIn });
    prevSceneId = scene.id;
  }
  return { version: 1, seed, intensity: options.intensity, durationSec: songMap.durationSec, segments, flashes };
}

// 呼び出し側が初期化時に1回だけ確保する。非フェード中も secondary の設定を保持する。
function createDirectorState() {
  const secondary = { segmentIndex: -1, sceneId: null, settings: createDefaultSettings() };
  return {
    primary: { segmentIndex: -1, sceneId: null, settings: createDefaultSettings() },
    secondary: null, mix: 1, flashAlpha: 0,
    _secondary: secondary,
  };
}

// layers の配列・要素を含め、呼び出し側で確保した設定へ値だけを複写する。
function directorSegmentSettings(timeline, index, t, baseSettings, settings) {
  for (const key in baseSettings) {
    if (Object.hasOwn(baseSettings, key) && key !== 'layers') settings[key] = baseSettings[key];
  }
  for (let i = 0; i < baseSettings.layers.length; i++) {
    const layer = baseSettings.layers[i];
    const target = settings.layers[i];
    for (const key in layer) {
      if (Object.hasOwn(layer, key)) target[key] = layer[key];
    }
  }
  const segment = timeline.segments[index];
  applyScenePatch(settings, segment.patch);
  for (let i = 0; i < segment.variations.length; i++) {
    const variation = segment.variations[i];
    if (variation.timeSec <= t) applyDirectorVariation(settings, variation.op, timeline.intensity);
  }
  if (segment.ramp) {
    const u = clamp((t - segment.startSec) / (segment.endSec - segment.startSec), 0, 1);
    settings.motionSpeed = clamp(settings.motionSpeed * lerp(1, segment.ramp.motionMul[1], u), 0.1, 3.0);
    settings.afterimageIntensity = clamp(settings.afterimageIntensity + lerp(0, segment.ramp.afterimageAdd[1], u), 0, 10);
    settings.particleAmount = clamp(Math.round(settings.particleAmount * lerp(1, segment.ramp.particleMul[1], u)), 10, 100);
  }
  return settings;
}

// 時刻のみから評価する。前回の評価時刻や拍フラグには依存しない（§6.6）。
// out は createDirectorState()、または primary / secondary の設定を事前確保したもの。
function directorStateAt(timeline, tSec, baseSettings, out) {
  const t = clamp(tSec, 0, timeline.durationSec);
  let index = timeline.segments.length - 1;
  for (let i = 0; i < timeline.segments.length; i++) {
    const segment = timeline.segments[i];
    if (segment.startSec <= t && t < segment.endSec) {
      index = i;
      break;
    }
  }
  const segment = timeline.segments[index];
  out.primary.segmentIndex = index;
  out.primary.sceneId = segment.sceneId;
  directorSegmentSettings(timeline, index, t, baseSettings, out.primary.settings);
  // 手動で確保した secondary も最初の呼び出しで保持し、null との切替で失わない。
  if (out.secondary) out._secondary = out.secondary;
  if (index > 0 && segment.transitionIn.type === 'fade'
    && t < segment.startSec + segment.transitionIn.duration) {
    out.secondary = out._secondary;
    out.secondary.segmentIndex = index - 1;
    out.secondary.sceneId = timeline.segments[index - 1].sceneId;
    directorSegmentSettings(timeline, index - 1, t, baseSettings, out.secondary.settings);
    out.mix = (t - segment.startSec) / segment.transitionIn.duration;
  } else {
    out.secondary = null;
    out.mix = 1;
  }
  out.flashAlpha = 0;
  for (let i = timeline.flashes.length - 1; i >= 0; i--) {
    const flash = timeline.flashes[i];
    if (flash > t) continue;
    const elapsed = t - flash;
    // 終端時刻で比較し、f + duration の減算丸めで終端に光が残るのを避ける。
    if (t < flash + DIRECTOR_CONST.FLASH_DURATION_SEC) {
      out.flashAlpha = DIRECTOR_CONST.FLASH_PEAK_ALPHA * Math.exp(-elapsed / DIRECTOR_CONST.FLASH_TAU_SEC);
    }
    break;
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DIRECTOR_CONST, compileDirectorTimeline, fnv1a32,
    directorVariationApplicable, applyDirectorVariation, createDirectorState, directorStateAt };
}
