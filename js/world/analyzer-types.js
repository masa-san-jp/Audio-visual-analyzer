// 目的 — GPUタイプの登録・MFS帯域uniform・残光状態を共有する — doc/20261004-design-gpu-analyzers-v1.md §1
// タイプ表はブラックホール設計 §6・アトラクター設計 §8に従う。
const WORLD_ANALYZER_TYPES = [
  { id: 'g-fluid', label: 'スペクトル流体', key: 1, available: true },
  { id: 'g-gargantua', label: 'ブラックホール', key: 2, available: true },
  { id: 'g-attractor', label: 'ストレンジアトラクター', key: 3, available: true }
];
const WORLD_BAND_FLOOR = .12;
const WORLD_BAND_RANGE = .70;
const WORLD_BAND_POWER = .8;
const WORLD_GLOW_DECAY = 6.;
const WORLD_BEAT_SECONDS = .16;
const WORLD_BAR_SECONDS = .35;
const WORLD_ORBIT_BASE_SPEED = .25;
const WORLD_ORBIT_SPEED_SPAN = 1.2;
const WORLD_ORBIT_LEVEL_SPEED = 1.5;
const WORLD_ANALYZER_GLSL = `
${WORLD_GPU_DESIGN_GLSL}
uniform vec4 bands[32]; // L、G、積分軌道位相、帯域群onset
uniform vec4 song; // BPM速度、細部、粒子量、ラウドネス
uniform vec3 colors[3];
uniform vec2 resolution;
uniform vec4 beats; // 直近4拍の経過秒
uniform vec4 pulse; // 拍、小節頭、低域、高域
uniform float mids;
uniform float t;
vec3 bandRamp(float x){return bandRamp(x,colors[0],colors[1],colors[2]);}
`;
class WorldBandAnalyzer {
  constructor() {
    this.bandUniforms = new Float32Array(128); this.songUniforms = new Float32Array(4);
    this.colors = new Float32Array(9); this.beats = new Float32Array(4); this.beatTimes = new Float64Array(4);
    this.pulseUniforms = new Float32Array(4); this.reset();
  }
  init(gpu) { this.gpu = gpu; }
  initUniforms(program) {
    const g = this.gpu; this.bandLoc = g.texture(program, 'bands[0]'); this.songLoc = g.texture(program, 'song');
    this.colorLoc = g.texture(program, 'colors[0]'); this.resolutionLoc = g.texture(program, 'resolution'); this.beatLoc = g.texture(program, 'beats');
    this.pulseLoc = g.texture(program, 'pulse'); this.midsLoc = g.texture(program, 'mids'); this.timeLoc = g.texture(program, 't');
  }
  reset() {
    this.bandUniforms.fill(0); this.beatTimes.fill(-100); this.beats.fill(100);
    this.pulseUniforms.fill(0); this.mids = 0; this.lastBeat = -100; this.lastDownbeat = -100; this.previewDownbeat = 0;
  }
  update(input) {
    const f = input.features, dt = input.dt, b = this.bandUniforms, variation = input.song;
    let bass = 0, mid = 0, high = 0;
    const glowDecay = Math.exp(-dt * WORLD_GLOW_DECAY);
    for (let i = 0; i < 32; i++) {
      const o = i * 4, raw = f.bandsSmooth[i];
      const level = Math.pow(Math.max(0, Math.min(1, (raw - WORLD_BAND_FLOOR) / WORLD_BAND_RANGE)), WORLD_BAND_POWER);
      b[o] = level; b[o + 1] = Math.max(level, b[o + 1] * glowDecay);
      b[o + 2] += dt * (WORLD_ORBIT_BASE_SPEED + WORLD_ORBIT_SPEED_SPAN * (1 - i / 31)) * variation.motionSpeed * (1 + level * WORLD_ORBIT_LEVEL_SPEED);
      b[o + 3] = f.onset.env[i < 6 ? 0 : i < 22 ? 1 : 2];
      if (i < 4) bass += level;
      if (i >= 8 && i <= 20) mid += level;
      if (i >= 24) high += level;
    }
    let beatTime = f.tempo.beatFlag ? input.tSec : this.lastBeat;
    if (f.tempo.downbeatFlag) this.lastDownbeat = input.tSec;
    // 音声なしのrenderAtだけ拍格子を使う。実MFS経路は同じ特徴のフラグを使う。
    const engine = input.engine;
    if (engine && engine.preview) {
      if (engine.beatIndex) beatTime = engine.score.beats[engine.beatIndex - 1];
      while (this.previewDownbeat < engine.score.downbeats.length && engine.score.downbeats[this.previewDownbeat] <= input.tSec) {
        this.lastDownbeat = engine.score.downbeats[this.previewDownbeat++];
      }
    }
    if (beatTime !== this.lastBeat) {
      this.beatTimes.copyWithin(1, 0, 3); this.beatTimes[0] = beatTime; this.lastBeat = beatTime;
    }
    for (let i = 0; i < 4; i++) this.beats[i] = Math.max(0, input.tSec - this.beatTimes[i]);
    this.pulseUniforms[0] = Math.exp(-Math.max(0, input.tSec - this.lastBeat) / WORLD_BEAT_SECONDS);
    this.pulseUniforms[1] = Math.exp(-Math.max(0, input.tSec - this.lastDownbeat) / WORLD_BAR_SECONDS);
    this.pulseUniforms[2] = bass / 4; this.pulseUniforms[3] = high / 8; this.mids = mid / 13;
    this.songUniforms[0] = variation.motionSpeed; this.songUniforms[1] = variation.detail;
    this.songUniforms[2] = variation.particleAmount; this.songUniforms[3] = f.loudness.level;
    // 曲の中の役割の回転・連続モーフは既存のWorld UBOと共通にする。
    if (engine) {
      const u = engine.gpu.uniforms;
      for (let i = 0; i < 3; i++) { this.colors[i] = u[24 + i]; this.colors[3 + i] = u[28 + i]; this.colors[6 + i] = u[72 + i]; }
    } else {
      this.colors.set(variation.palette.primary, 0); this.colors.set(variation.palette.secondary, 3); this.colors.set(variation.palette.accent, 6);
    }
  }
  step(input) { this.update(input); }
  upload(input) {
    const gl = this.gpu.gl;
    gl.uniform4fv(this.bandLoc, this.bandUniforms); gl.uniform4fv(this.songLoc, this.songUniforms);
    gl.uniform3fv(this.colorLoc, this.colors); gl.uniform4fv(this.beatLoc, this.beats);
    gl.uniform4fv(this.pulseLoc, this.pulseUniforms); gl.uniform1f(this.midsLoc, this.mids); gl.uniform1f(this.timeLoc, input.tSec);
    gl.uniform2f(this.resolutionLoc, input.target.width, input.target.height);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WORLD_ANALYZER_TYPES, WorldBandAnalyzer }; }
