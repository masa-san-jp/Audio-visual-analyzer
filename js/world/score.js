// 目的 — 決定的な抽象状態・変奏・モチーフ・三色パレットを編成する — doc/20261004-concept-world-mode.md §2.8・§4・§5
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
// 線形RGB。色の役割の回転はcompileWorldScoreで維持する — 詳細設計 §1.1。
const WORLD_PALETTES = [
  { primary: [.10,.85,.75], secondary: [.45,.25,1.00], accent: [1.00,.85,.60] }, // Aurora
  { primary: [1.00,.55,.15], secondary: [.90,.12,.25], accent: [1.00,.90,.75] }, // Ember
  { primary: [.35,.70,1.00], secondary: [.12,.25,.90], accent: [.90,.95,1.00] }, // Glacier
  { primary: [1.00,.45,.70], secondary: [.60,.50,1.00], accent: [1.00,.85,.55] }, // Sakura
  { primary: [1.00,.75,.25], secondary: [1.00,.40,.10], accent: [1.00,.95,.85] }, // Solar
  { primary: [.00,.80,1.00], secondary: [.25,.15,.80], accent: [1.00,.30,.80] }, // Abyss
  { primary: [.60,1.00,.40], secondary: [.10,.70,.45], accent: [1.00,.85,.40] }, // Canopy
  { primary: [.95,.25,.75], secondary: [.20,.40,1.00], accent: [.40,.95,1.00] }, // Nebula
  { primary: [1.00,.45,.35], secondary: [.55,.20,.80], accent: [1.00,.75,.50] }, // Sunset
  { primary: [.15,.50,1.00], secondary: [1.00,.20,.60], accent: [.95,.95,1.00] }, // Neon
  { primary: [.95,.50,.25], secondary: [.10,.60,.60], accent: [1.00,.92,.80] }, // Copper
  { primary: [.55,.30,1.00], secondary: [1.00,.40,.55], accent: [.50,.80,1.00] } // Twilight
];
// 全曲特徴は読込時だけ集計。ゼロ分布のtieは音名順、入力配列は変更しない。
function worldSongVariation(songMap, featureFrames = null) {
  const chroma = new Float64Array(12); let centroid = 0, active = 0, onsets = 0;
  if (featureFrames) for (let h = 0; h < featureFrames.length; h++) {
    const f = featureFrames[h];
    for (let k = 0; k < 12; k++) chroma[k] += f[86 + k];
    if (f[102] > .0001) { centroid += f[83]; active++; }
    if (f[68]) onsets++;
  }
  if (songMap.worldChroma) chroma.set(songMap.worldChroma);
  const order = Array.from({ length: 12 }, (_, i) => i).sort((a, b) => chroma[b] - chroma[a] || a - b);
  const meanCentroid = active ? centroid / active : 0, onsetDensity = onsets / Math.max(.001, songMap.durationSec);
  const brightness = Math.min(1, meanCentroid / 8000), density = onsetDensity / (onsetDensity + 2);
  return { palette: WORLD_PALETTES[order[0]],
    motionSpeed: songMap.bpm / 120, detail: featureFrames ? .25 + .75 * (brightness + density) * .5 : 1,
    particleAmount: featureFrames ? .2 + .8 * (brightness * .6 + density * .4) : 1,
    centroidHz: meanCentroid, onsetDensity, dominantChroma: order[0] };
}
function compileWorldScore(songMap, seed, featureFrames = null) {
  const rng = makeRng(seed), song = worldSongVariation(songMap, featureFrames);
  const motifs = Object.create(null), counts = Object.create(null), sections = [], events = [];
  const beatSec = 60 / songMap.bpm;
  const palette = [song.palette.primary, song.palette.secondary, song.palette.accent];
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
  return { song, seed: seed >>> 0, durationSec: songMap.durationSec, beatSec, sections, events,
    beats: Array.from(songMap.beats), downbeats: Array.from(songMap.downbeatIndices, i => songMap.beats[i]),
    palette: { primary: palette[0], secondary: palette[1], accent: palette[2] } };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { worldSongVariation, compileWorldScore, worldHash, WORLD_PALETTES, WORLD_KINDS, WORLD_ENVIRONMENTS, WORLD_KIND_ENVIRONMENT, WORLD_COMPOSITIONS };
}
