// 目的 — 自動演出タイムラインの決定的コンパイルと変化 — Phase 18 計画書 §6.2・§6.4・§6.5。

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
  return { version: 1, seed, durationSec: songMap.durationSec, segments, flashes };
}

// ── T18-08 追記位置: directorStateAt（Phase 18 計画書 §6.6） ──
// applyScenePatch / applyDirectorVariation を使い、呼び出し側の設定バッファへ上書きする。

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DIRECTOR_CONST, compileDirectorTimeline, fnv1a32,
    directorVariationApplicable, applyDirectorVariation };
}
