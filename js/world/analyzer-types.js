// 目的 — GPUタイプの登録・MFS帯域uniform・残光状態を共有する — 構想 §2.8
// 未実装の3枠は選択不能。番号はSSOTの表の順序を保持する。
const WORLD_ANALYZER_TYPES = [
  { id: 'g-fluid', label: 'スペクトル流体', key: 1, available: true },
  { id: 'g-rings', label: '光の放射リング', key: 2, available: true },
  { id: 'g-terrain', label: '粒子スペクトラム地形（準備中）', key: 3, available: false },
  { id: 'g-galaxy', label: '周波数の銀河', key: 4, available: true },
  { id: 'g-ribbons', label: '光のリボン（準備中）', key: 5, available: false },
  { id: 'g-kaleido', label: '万華鏡フィードバック（準備中）', key: 6, available: false }
];
const WORLD_ANALYZER_GLSL = `
precision highp float;
uniform vec4 bands[32]; // 即時レベル、残光、積分軌道位相、帯域群onset
uniform vec4 song; // BPM速度、細部、粒子量、ラウドネス
uniform vec3 colors[3];
uniform vec2 resolution;
uniform vec4 beats; // 直近4拍の経過秒
const float TAU=6.28318530718;
vec3 bandColor(int i){return colors[i<24?0:i<30?1:2];}
`;
class WorldBandAnalyzer {
  constructor() { this.bandUniforms = new Float32Array(128); this.songUniforms = new Float32Array(4);
    this.colors = new Float32Array(9); this.beats = new Float32Array(4); this.beatTimes = new Float64Array(4); this.reset(); }
  init(gpu) { this.gpu = gpu; }
  initUniforms(program) {
    const g = this.gpu; this.bandLoc = g.texture(program, 'bands[0]'); this.songLoc = g.texture(program, 'song');
    this.colorLoc = g.texture(program, 'colors[0]'); this.resolutionLoc = g.texture(program, 'resolution'); this.beatLoc = g.texture(program, 'beats');
  }
  reset() { this.bandUniforms.fill(0); this.beatTimes.fill(-100); this.lastBeat = -100; }
  update(input) {
    const f = input.features, dt = input.dt, b = this.bandUniforms, variation = input.song;
    for (let i = 0; i < 32; i++) {
      const o = i * 4, level = Math.max(0, Math.min(1, f.bandsSmooth[i]));
      b[o] = level; b[o + 1] = Math.max(level, b[o + 1] * Math.exp(-dt * 9));
      b[o + 2] += dt * variation.motionSpeed * (.15 + level * 3);
      b[o + 3] = f.onset.env[i < 6 ? 0 : i < 22 ? 1 : 2];
    }
    if (f.tempo.beatFlag && input.tSec !== this.lastBeat) {
      this.beatTimes.copyWithin(1, 0, 3); this.beatTimes[0] = input.tSec; this.lastBeat = input.tSec;
    }
    for (let i = 0; i < 4; i++) this.beats[i] = Math.max(0, input.tSec - this.beatTimes[i]);
    this.songUniforms[0] = variation.motionSpeed; this.songUniforms[1] = variation.detail;
    this.songUniforms[2] = variation.particleAmount; this.songUniforms[3] = f.loudness.level;
    this.colors.set(variation.palette.primary, 0); this.colors.set(variation.palette.secondary, 3); this.colors.set(variation.palette.accent, 6);
  }
  step(input) { this.update(input); }
  upload(input) {
    const gl = this.gpu.gl;
    gl.uniform4fv(this.bandLoc, this.bandUniforms); gl.uniform4fv(this.songLoc, this.songUniforms);
    gl.uniform3fv(this.colorLoc, this.colors); gl.uniform4fv(this.beatLoc, this.beats);
    gl.uniform2f(this.resolutionLoc, input.target.width, input.target.height);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WORLD_ANALYZER_TYPES, WorldBandAnalyzer }; }
