// 目的 — 決定的な抽象状態・変奏・モチーフ・三色パレットを編成する — doc/20261004-concept-world-mode.md §2.7・§4・§5
const WORLD_KINDS = ['intro', 'build', 'drop', 'break', 'outro', 'main'];
const WORLD_ENVIRONMENTS = ['mist', 'convergence', 'explosion', 'drift', 'dissipation', 'galaxy'];
const WORLD_KIND_ENVIRONMENT = [0, 1, 2, 3, 4, 5];
const WORLD_BOUNDARIES = ['ignite', 'converge', 'phase-transition', 'drift', 'extinguish', 'morph'];
// 形態IDはラベルの契約を保持。構図はkindと変奏で独立に編成する。
const WORLD_COMPOSITIONS = ['vortices', 'ribbons', 'streams', 'nebula', 'arms'];
const WORLD_KIND_COMPOSITION = [3, 4, 0, 1, 2, 4];
function worldHash(text, seed) {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}
function worldHue(h) {
  // 三色の正規化色相。描画時の明度・彩度・役割はworldColorで統一する。
  const hue = ((h / (Math.PI * 2)) % 1 + 1) % 1;
  const channel = offset => .015 + .985 * Math.max(0, Math.min(1, Math.abs(((hue * 6 + offset) % 6) - 3) - 1));
  return [channel(0), channel(4), channel(2)];
}
function compileWorldScore(songMap, seed) {
  const rng = makeRng(seed);
  const harmony = songMap.worldChroma || [];
  let cx = 0, cy = 0;
  for (let i = 0; i < 12; i++) {
    const a = i * 7 / 12 * Math.PI * 2;
    cx += (harmony[i] || 0) * Math.cos(a); cy += (harmony[i] || 0) * Math.sin(a);
  }
  const harmonyHue = Math.atan2(cy, cx) + rng() * 0.35;
  const hue = (.58 + .025 * Math.sin(harmonyHue)) * Math.PI * 2;
  const motifs = Object.create(null), counts = Object.create(null), sections = [], events = [];
  const beatSec = 60 / songMap.bpm;
  const palette = [worldHue(hue), worldHue(hue + Math.PI * .14), worldHue(hue + Math.PI)];
  for (let i = 0; i < songMap.sections.length; i++) {
    const s = songMap.sections[i];
    if (!motifs[s.label]) {
      const h = worldHash(s.label, seed);
      motifs[s.label] = { formId: h % 6, paletteRotation: (h >>> 8) / 16777216 * Math.PI * 2 };

    }
    const motif = motifs[s.label], key = s.kind + ':' + s.label;
    const variation = counts[key] = (counts[key] || 0) + 1;
    // 再登場では三色の役割を循環させる。labelの回転値と曲の色数は維持する。
    const colorIndex = (Math.floor(motif.paletteRotation / (Math.PI * 2) * 3) + variation - 1) % 3;
    const environmentId = WORLD_KIND_ENVIRONMENT[WORLD_KINDS.indexOf(s.kind)];
    const nextDrop = i + 1 < songMap.sections.length && songMap.sections[i + 1].kind === 'drop';
    const compositionId = (WORLD_KIND_COMPOSITION[WORLD_KINDS.indexOf(s.kind)] + variation - 1) % WORLD_COMPOSITIONS.length;
    const compositionSeed = worldHash(key, seed);
    sections.push({ startSec: s.startSec, endSec: s.endSec, label: s.label, kind: s.kind,
      kindId: WORLD_KINDS.indexOf(s.kind), formId: motif.formId, variation,
      paletteRotation: motif.paletteRotation, primary: palette[colorIndex], secondary: palette[(colorIndex + 1) % 3],
      accent: palette[(colorIndex + 2) % 3], environmentId, environment: WORLD_ENVIRONMENTS[environmentId],
      worldScale: 1 + (variation - 1) * .75, cameraSpeed: 1 + (variation - 1) * .4,
      cameraAngle: rng() * Math.PI * 2, intensity: 1 + (variation - 1) * 0.35,
      compositionId, composition: WORLD_COMPOSITIONS[compositionId], compositionSeed,
      vortexCount: variation % 2 === 1 ? 2 : 1,
      density: 1 - 0.5 / variation, complexity: 1 + variation * 0.55,
      foreshadowSec: nextDrop ? Math.max(s.startSec, s.endSec - 8 * beatSec) : Infinity,
      silenceSec: nextDrop ? Math.max(s.startSec, s.endSec - beatSec) : Infinity });
    events.push({ tSec: s.startSec, type: 'boundary', sectionIndex: i, action: WORLD_BOUNDARIES[WORLD_KINDS.indexOf(s.kind)] });
    if (nextDrop) {
      events.push({ tSec: sections[i].foreshadowSec, type: 'foreshadow', sectionIndex: i });
      events.push({ tSec: sections[i].silenceSec, type: 'silence', sectionIndex: i });
    }
  }
  events.push({ tSec: songMap.durationSec, type: 'end', sectionIndex: sections.length - 1 });
  events.sort((a, b) => a.tSec - b.tSec || (a.type === 'boundary' ? -1 : b.type === 'boundary' ? 1 : 0));
  return { seed: seed >>> 0, durationSec: songMap.durationSec, beatSec, sections, events,
    beats: Array.from(songMap.beats), downbeats: Array.from(songMap.downbeatIndices, i => songMap.beats[i]),
    palette: { primary: palette[0], secondary: palette[1], accent: palette[2] } };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { compileWorldScore, worldHash, WORLD_KINDS, WORLD_ENVIRONMENTS, WORLD_KIND_ENVIRONMENT, WORLD_COMPOSITIONS };
}
