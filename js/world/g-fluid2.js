// 目的 — スペクトル流体 v2：円環の噴出口から帯域ごとの光るインクが渦に巻かれて流れる — doc/20261010-design-fluid-v2.md §1〜10
const WORLD_FLUID2 = Object.freeze({
  // 格子（§2）。座標は画面中心が原点、yは[-1,1]、xは[-SIM_ASPECT,SIM_ASPECT]。
  VEL_W: 384, VEL_H: 216, DYE_W: 1152, DYE_H: 648, SIM_ASPECT: 16 / 9,
  DT: 1 / 60, VEL_DAMP: .6, BG_RELAX: 1.5, VORT: 14, PRESSURE_ITERS: 24, DYE_DECAY: .35, EDGE: .06,
  // 背景の流れ（§3）
  OMEGA_BASE: .55, OMEGA_FLOOR: .6, OMEGA_LOUD: .8, BG_SIGMA: 1.1, CURL_SCALE: 1.2, CURL_FREQ: .03, CURL_AMP: .03,
  // 円環の噴出口（§4）
  JET_COUNT: 32, R0: .27, SWIRL_ANGLE: 50, JET_FORCE: 6, JET_FORCE_SIGMA: .035, JET_DYE: 3.5, JET_DYE_SIGMA: .022,
  JET_POWER: 1.5, HUE_SPAN: .85, HUE_SAT: .9, JET_WINDOW: 3,
  RING_WIDTH: .0035, RING_LIGHT: .35, NUB_SIGMA: .008, NUB_BASE: .15, NUB_GAIN: 1.6,
  // キック（§5）
  KICK_PUSH: 1.4, KICK_WIDTH: .10, KICK_SECONDS: .18, KICK_GLOW: 2.5,
  // 背景（§6）
  CAM_AMP: .05, CAM_PERIOD: 40, CAM_Y_SCALE: .6, CAM_Y_PERIOD_RATIO: 1.37,
  DUST1_COUNT: 3000, DUST1_DEPTH: 3, DUST2_COUNT: 9000, DUST2_DEPTH: 8,
  DUST_MIN: .04, DUST_MAX: .12, DUST_FAR_DIM: .6, DUST_SPREAD: 1.25,
  HAZE_LIGHT: .05, HAZE_SIGMA: .45,
  GLINT_MAX: 24, GLINT_RISE: .06, GLINT_DECAY: .5, GLINT_LIFE: 3, GLINT_HUE_MIX: .3,
  GLINT_CORE: 1.5, GLINT_LINE_W: 1, GLINT_LINE_L: 14, GLINT_BAND_FIRST: 16,
  GLINT_RADIAL_MIN: .1, GLINT_RADIAL_SPAN: .5, GLINT_JITTER: .03,
  // 合成・区間・暖機（§7〜9）
  EXPOSURE: 1.6, EXPOSURE_FLOOR: .8, EXPOSURE_GAIN: .4,
  TRANS_SECONDS: 2, WARM_FRAMES: 420, BLOOM_THRESHOLD: .7, BLOOM_STRENGTH: .6
});
const WORLD_FLUID2_INT_NAMES = ['VEL_W', 'VEL_H', 'DYE_W', 'DYE_H', 'PRESSURE_ITERS', 'JET_COUNT', 'JET_WINDOW',
  'DUST1_COUNT', 'DUST2_COUNT', 'GLINT_MAX', 'GLINT_BAND_FIRST', 'WARM_FRAMES'];
const WORLD_FLUID2_DUST_TOTAL = WORLD_FLUID2.DUST1_COUNT + WORLD_FLUID2.DUST2_COUNT;
const WORLD_FLUID2_COS_SWIRL = Math.cos(WORLD_FLUID2.SWIRL_ANGLE * Math.PI / 180);
const WORLD_FLUID2_SIN_SWIRL = Math.sin(WORLD_FLUID2.SWIRL_ANGLE * Math.PI / 180);
// 区間表（§7）。jet、kick、omega、decay倍率、zoom の順に（始点,終点）を並べる。区間内を線形補間する。
const WORLD_FLUID2_TABLE = Object.freeze({
  //            jet0  jet1  kick0 kick1 omg0  omg1  dec0  dec1  zoom0 zoom1
  intro: Object.freeze([.6, .6, .6, .6, .7, .7, 1, 1, 1, 1]),
  build: Object.freeze([.6, 1.1, 1, 1, .8, 1.3, 1, 1, 1, 1.06]),
  drop: Object.freeze([1.4, 1.4, 1.5, 1.5, 1.4, 1.4, 1.15, 1.15, 1.08, 1.08]),
  break: Object.freeze([.45, .45, .4, .4, .6, .6, .7, .7, .94, .94]),
  main: Object.freeze([1, 1, 1, 1, 1, 1, 1, 1, 1.02, 1.02]),
  outro: Object.freeze([1, 0, .5, .5, .8, .8, .6, .6, 1, .92])
});
const WORLD_FLUID2_PARAM = Object.freeze({ JET: 0, KICK: 1, OMEGA: 2, DECAY: 3, ZOOM: 4 });
const WORLD_FLUID2_SCRATCH = new Float64Array(5);
const WORLD_FLUID2_GLSL = Object.entries(WORLD_FLUID2).map(([name, value]) =>
  `const ${WORLD_FLUID2_INT_NAMES.includes(name) ? 'int' : 'float'} ${name} = ${WORLD_FLUID2_INT_NAMES.includes(name) ? value : value.toFixed(8)};`).join('\n') + `
const float COS_SWIRL = ${WORLD_FLUID2_COS_SWIRL.toFixed(10)}, SIN_SWIRL = ${WORLD_FLUID2_SIN_SWIRL.toFixed(10)};
const float PI = 3.141592653589793, TAU = 6.283185307179586, CELL = 2. / float(VEL_H);
const vec3 DUST_COLOR = vec3(.75, .82, 1.);
uniform float paletteShift;
vec2 uvToP(vec2 uv) { return (uv * 2. - 1.) * vec2(SIM_ASPECT, 1.); }
vec2 pToUv(vec2 p) { return (p / vec2(SIM_ASPECT, 1.)) * .5 + .5; }
vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(fract(h + vec3(0., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.); return v * mix(vec3(1.), k, s); }
float jetHue(int i) { return fract(float(i) / float(JET_COUNT) * HUE_SPAN + paletteShift); }
vec2 jetDir(int i) { float th = -PI * .5 + (float(i) + .5) * TAU / float(JET_COUNT); return vec2(cos(th), sin(th)); }
vec2 jetNormal(int i) { vec2 d = jetDir(i); return vec2(COS_SWIRL * d.x - SIN_SWIRL * d.y, SIN_SWIRL * d.x + COS_SWIRL * d.y); }
int jetNearest(vec2 p) { float a = mod(atan(p.y, p.x) + PI * .5, TAU); return int(floor(a / (TAU / float(JET_COUNT)))) % JET_COUNT; }
int jetWrap(int k, int j) { return ((k + j) % JET_COUNT + JET_COUNT) % JET_COUNT; }
float edgeFade(vec2 p) { return smoothstep(0., EDGE, min(SIM_ASPECT - abs(p.x), 1. - abs(p.y))); }
`;
const WORLD_FLUID2_HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_FLUID2_GLSL}
in vec2 vUv;
out vec4 frag;
`;
// 速度：移流・減衰・背景流への緩和・噴出口の力・キックの衝撃（§2 手順1〜3、§3〜5）
const WORLD_FLUID2_ADVECT_FRAGMENT = `${WORLD_FLUID2_HEAD}
uniform sampler2D vel;
uniform vec4 bands[32];
uniform float time, omega, sectionJet, kickPush;
uniform vec2 seedOff;
float vh(vec3 p) { p = fract(p * .1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
 vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
 return mix(mix(mix(vh(i), vh(i + vec3(1, 0, 0)), f.x), mix(vh(i + vec3(0, 1, 0)), vh(i + vec3(1, 1, 0)), f.x), f.y),
  mix(mix(vh(i + vec3(0, 0, 1)), vh(i + vec3(1, 0, 1)), f.x), mix(vh(i + vec3(0, 1, 1)), vh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec2 bgFlow(vec2 p) {
 vec2 rotation = omega * vec2(-p.y, p.x) * exp(-dot(p, p) / (2. * BG_SIGMA * BG_SIGMA));
 vec3 q = vec3(p * CURL_SCALE + seedOff, time * CURL_FREQ);
 const float e = .01;
 float dx = vnoise(q + vec3(e, 0, 0)) - vnoise(q - vec3(e, 0, 0)), dy = vnoise(q + vec3(0, e, 0)) - vnoise(q - vec3(0, e, 0));
 return rotation + CURL_AMP * vec2(dy, -dx) / (2. * e);
}
void main() {
 vec2 p = uvToP(vUv), v0 = texture(vel, vUv).xy;
 vec2 v = texture(vel, pToUv(p - v0 * DT)).xy * exp(-VEL_DAMP * DT);
 v += (bgFlow(p) - v) * BG_RELAX * DT;
 int k = jetNearest(p);
 for (int j = -JET_WINDOW; j <= JET_WINDOW; j++) {
  int i = jetWrap(k, j); vec2 d = p - R0 * jetDir(i);
  float l = bands[i].x, s = l * sqrt(l);
  v += jetNormal(i) * JET_FORCE * s * sectionJet * exp(-dot(d, d) / (2. * JET_FORCE_SIGMA * JET_FORCE_SIGMA)) * DT;
 }
 float r = length(p);
 if (r > 1e-4) { float w = (r - R0) / KICK_WIDTH; v += p / r * kickPush * exp(-w * w); }
 frag = vec4(v, 0., 1.);
}`;
// 渦度閉じ込め（§2 手順4）。f = VORT * CELL * (N × ω)
const WORLD_FLUID2_VORTICITY_FRAGMENT = `${WORLD_FLUID2_HEAD}
uniform sampler2D vel;
float curlAt(vec2 uv) {
 vec2 ex = vec2(1. / float(VEL_W), 0.), ey = vec2(0., 1. / float(VEL_H));
 return ((texture(vel, uv + ex).y - texture(vel, uv - ex).y) - (texture(vel, uv + ey).x - texture(vel, uv - ey).x)) / (2. * CELL);
}
void main() {
 vec2 ex = vec2(1. / float(VEL_W), 0.), ey = vec2(0., 1. / float(VEL_H));
 float w = curlAt(vUv);
 vec2 g = vec2(abs(curlAt(vUv + ex)) - abs(curlAt(vUv - ex)), abs(curlAt(vUv + ey)) - abs(curlAt(vUv - ey))) / (2. * CELL);
 vec2 n = g / (length(g) + 1e-5);
 vec2 v = texture(vel, vUv).xy + VORT * CELL * vec2(n.y, -n.x) * w * DT;
 frag = vec4(v, 0., 1.);
}`;
const WORLD_FLUID2_DIVERGENCE_FRAGMENT = `${WORLD_FLUID2_HEAD}
uniform sampler2D vel;
void main() {
 vec2 ex = vec2(1. / float(VEL_W), 0.), ey = vec2(0., 1. / float(VEL_H));
 float d = (texture(vel, vUv + ex).x - texture(vel, vUv - ex).x + texture(vel, vUv + ey).y - texture(vel, vUv - ey).y) / (2. * CELL);
 frag = vec4(d, 0., 0., 1.);
}`;
const WORLD_FLUID2_JACOBI_FRAGMENT = `${WORLD_FLUID2_HEAD}
uniform sampler2D pressure, divergence;
void main() {
 vec2 ex = vec2(1. / float(VEL_W), 0.), ey = vec2(0., 1. / float(VEL_H));
 float s = texture(pressure, vUv + ex).x + texture(pressure, vUv - ex).x + texture(pressure, vUv + ey).x + texture(pressure, vUv - ey).x;
 frag = vec4((s - CELL * CELL * texture(divergence, vUv).x) * .25, 0., 0., 1.);
}`;
// 勾配を引き、画面端で速度を0へ落とす（§2 手順5・7）
const WORLD_FLUID2_PROJECT_FRAGMENT = `${WORLD_FLUID2_HEAD}
uniform sampler2D vel, pressure;
void main() {
 vec2 ex = vec2(1. / float(VEL_W), 0.), ey = vec2(0., 1. / float(VEL_H));
 vec2 grad = vec2(texture(pressure, vUv + ex).x - texture(pressure, vUv - ex).x, texture(pressure, vUv + ey).x - texture(pressure, vUv - ey).x) / (2. * CELL);
 frag = vec4((texture(vel, vUv).xy - grad) * edgeFade(uvToP(vUv)), 0., 1.);
}`;
// 染料：移流・減衰・噴出口の染料・吸収境界（§2 手順6・7、§4）
const WORLD_FLUID2_DYE_FRAGMENT = `${WORLD_FLUID2_HEAD}
uniform sampler2D dye, vel;
uniform vec4 bands[32];
uniform float sectionJet, decayMul;
void main() {
 vec2 p = uvToP(vUv), v = texture(vel, vUv).xy;
 vec3 d = texture(dye, pToUv(p - v * DT)).rgb * exp(-DYE_DECAY * decayMul * DT);
 int k = jetNearest(p);
 for (int j = -JET_WINDOW; j <= JET_WINDOW; j++) {
  int i = jetWrap(k, j); vec2 q = p - R0 * jetDir(i);
  float l = bands[i].x, s = l * sqrt(l);
  d += hsv(jetHue(i), HUE_SAT, 1.) * JET_DYE * s * sectionJet * exp(-dot(q, q) / (2. * JET_DYE_SIGMA * JET_DYE_SIGMA)) * DT;
 }
 frag = vec4(d * edgeFade(p), 1.);
}`;
// 合成（§4 円環、§6 霞・瞬き、§8）。塵は別パスの点で足す。
const WORLD_FLUID2_COMPOSITE_FRAGMENT = `${WORLD_FLUID2_HEAD}
uniform sampler2D dye;
uniform vec4 bands[32], glint[24]; // glint: x,y（流体面）、経過秒（負なら無効）、色相
uniform vec3 primary;
uniform vec2 cam;
uniform float aspect, zoom, exposure, kickEnv, height;
void main() {
 vec2 q = (vUv * 2. - 1.) * vec2(aspect, 1.);
 vec2 p = q * zoom + cam;
 vec3 c = 1. - exp(-texture(dye, pToUv(p)).rgb * exposure);
 float glow = 1. + KICK_GLOW * kickEnv, r = length(p);
 int k = jetNearest(p);
 float rw = (r - R0) / RING_WIDTH;
 c += hsv(jetHue(k), HUE_SAT, 1.) * exp(-rw * rw) * RING_LIGHT * glow;
 for (int j = -2; j <= 2; j++) {
  int i = jetWrap(k, j); vec2 d = p - R0 * jetDir(i);
  c += hsv(jetHue(i), HUE_SAT, 1.) * exp(-dot(d, d) / (2. * NUB_SIGMA * NUB_SIGMA)) * (NUB_BASE + NUB_GAIN * bands[i].x) * glow;
 }
 c += primary * HAZE_LIGHT * exp(-dot(p, p) / (2. * HAZE_SIGMA * HAZE_SIGMA));
 for (int n = 0; n < GLINT_MAX; n++) {
  vec4 g = glint[n];
  if (g.z < 0.) continue;
  vec2 o = (q - (g.xy - cam) / zoom) * height * .5, a = abs(o);
  float env = (1. - exp(-g.z / GLINT_RISE)) * exp(-g.z / GLINT_DECAY);
  float shape = exp(-dot(o, o) / (2. * GLINT_CORE * GLINT_CORE)) + exp(-a.y / GLINT_LINE_W) * exp(-a.x / GLINT_LINE_L) + exp(-a.x / GLINT_LINE_W) * exp(-a.y / GLINT_LINE_L);
  c += mix(vec3(1.), hsv(g.w, HUE_SAT, 1.), GLINT_HUE_MIX) * env * shape;
 }
 frag = vec4(c, 1.);
}`;
const WORLD_FLUID2_DUST_VERTEX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_FLUID2_GLSL}
uniform uint seed;
uniform vec2 cam;
uniform float aspect, zoom;
out vec3 dustColor;
float dustHash(uint i, uint salt) {
 uint h = i ^ (salt * 0x9e3779b9u) ^ seed;
 h = (h ^ (h >> 16u)) * 0x7feb352du; h = (h ^ (h >> 15u)) * 0x846ca68bu;
 return float((h ^ (h >> 16u)) >> 8u) * (1. / 16777216.);
}
void main() {
 uint id = uint(gl_VertexID);
 bool outerLayer = gl_VertexID >= DUST1_COUNT;
 float depth = outerLayer ? DUST2_DEPTH : DUST1_DEPTH;
 vec2 p = (vec2(dustHash(id, 1u), dustHash(id, 2u)) * 2. - 1.) * vec2(DUST_SPREAD * aspect, DUST_SPREAD);
 vec2 s = (p - cam / depth) / zoom;
 gl_Position = vec4(s / vec2(aspect, 1.), 0., 1.);
 gl_PointSize = 1.;
 dustColor = DUST_COLOR * mix(DUST_MIN, DUST_MAX, dustHash(id, 3u)) * (outerLayer ? DUST_FAR_DIM : 1.);
}`;
const WORLD_FLUID2_DUST_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 dustColor;
out vec4 frag;
void main() { frag = vec4(dustColor, 0.); }`;

function worldFluid2Hash(i, salt, seed) {
  let h = (i ^ Math.imul(salt, 0x9e3779b9) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 8) / 16777216;
}
// 噴出口 i の位置（out[0..1]）。帯域0が真下から始まり反時計回り。戻り値は角度。
function worldFluid2JetPosition(i, out) {
  const c = WORLD_FLUID2, theta = -Math.PI / 2 + (i + .5) * 2 * Math.PI / c.JET_COUNT;
  out[0] = c.R0 * Math.cos(theta); out[1] = c.R0 * Math.sin(theta);
  return theta;
}
// 噴出口 i の向き n_i（out[0..1]）。放射方向を SWIRL_ANGLE だけ回す。
function worldFluid2JetNormal(i, out) {
  const theta = -Math.PI / 2 + (i + .5) * 2 * Math.PI / WORLD_FLUID2.JET_COUNT, cx = Math.cos(theta), sy = Math.sin(theta);
  out[0] = WORLD_FLUID2_COS_SWIRL * cx - WORLD_FLUID2_SIN_SWIRL * sy;
  out[1] = WORLD_FLUID2_SIN_SWIRL * cx + WORLD_FLUID2_COS_SWIRL * sy;
}
// 区間表の値。out = [jet, kick, omega, decay, zoom]。p は区間内の進行 0..1。
function worldFluid2SectionParams(kind, p, out) {
  const row = WORLD_FLUID2_TABLE[kind] || WORLD_FLUID2_TABLE.main, q = Math.max(0, Math.min(1, p));
  for (let i = 0; i < 5; i++) out[i] = row[i * 2] + (row[i * 2 + 1] - row[i * 2]) * q;
  return out;
}
// 区間ごとの値を 2 秒の smoothstep で前区間の終端値から補間する（§7）。
function worldFluid2Params(sections, index, t, out) {
  const s = sections[index], p = (t - s.startSec) / Math.max(.001, s.endSec - s.startSec);
  worldFluid2SectionParams(s.kind, p, out);
  if (index > 0) {
    const b = Math.max(0, Math.min(1, (t - s.startSec) / WORLD_FLUID2.TRANS_SECONDS)), w = b * b * (3 - 2 * b);
    if (w < 1) {
      const prev = worldFluid2SectionParams(sections[index - 1].kind, 1, WORLD_FLUID2_SCRATCH);
      for (let i = 0; i < 5; i++) out[i] = prev[i] + (out[i] - prev[i]) * w;
    }
  }
  return out;
}
// カメラのずれ（§6）。out[0..1]。
function worldFluid2Camera(t, out) {
  const c = WORLD_FLUID2;
  out[0] = c.CAM_AMP * Math.sin(2 * Math.PI * t / c.CAM_PERIOD);
  out[1] = c.CAM_AMP * c.CAM_Y_SCALE * Math.sin(2 * Math.PI * t / (c.CAM_PERIOD * c.CAM_Y_PERIOD_RATIO));
  return out;
}
// 塵の表示位置 = (p - cam/depth) / zoom（軸ごと）。
function worldFluid2DustScreen(p, depth, cam, zoom) { return (p - cam / depth) / zoom; }
function worldFluid2GlintEnvelope(age) {
  if (age < 0) return 0;
  return (1 - Math.exp(-age / WORLD_FLUID2.GLINT_RISE)) * Math.exp(-age / WORLD_FLUID2.GLINT_DECAY);
}
// 瞬きの生成位置（out[0..1]）。噴出口 k の外側。serial と seed だけで決まる。
function worldFluid2GlintPosition(serial, k, seed, out) {
  const c = WORLD_FLUID2, theta = -Math.PI / 2 + (k + .5) * 2 * Math.PI / c.JET_COUNT;
  const rad = c.R0 + c.GLINT_RADIAL_MIN + c.GLINT_RADIAL_SPAN * worldFluid2Hash(serial, 0, seed);
  out[0] = rad * Math.cos(theta) + c.GLINT_JITTER * (worldFluid2Hash(serial, 1, seed) * 2 - 1);
  out[1] = rad * Math.sin(theta) + c.GLINT_JITTER * (worldFluid2Hash(serial, 2, seed) * 2 - 1);
  return out;
}
function worldFluid2Hue(rgb) {
  const r = rgb[0], g = rgb[1], b = rgb[2], mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d < 1e-9) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h / 6) % 1 + 1) % 1;
}
class WorldFluid2Analyzer extends WorldBandAnalyzer {
  constructor() {
    super(); this.id = 'g-fluid'; this.label = 'スペクトル流体'; this.warmFrames = WORLD_FLUID2.WARM_FRAMES;
    this.particleCount = WORLD_FLUID2_DUST_TOTAL; this.velocityWidth = WORLD_FLUID2.VEL_W; this.velocityHeight = WORLD_FLUID2.VEL_H;
    this.dyeWidth = WORLD_FLUID2.DYE_W; this.dyeHeight = WORLD_FLUID2.DYE_H;
    this.params = new Float64Array(5); this.cam = new Float32Array(2); this.seedOff = new Float32Array(2);
    // 瞬き：x、y、経過秒（負は無効）、色相。誕生時刻は別配列。
    this.glints = new Float32Array(WORLD_FLUID2.GLINT_MAX * 4); this.glintBirth = new Float64Array(WORLD_FLUID2.GLINT_MAX);
    this.glintPos = new Float64Array(2); this.reset();
  }
  reset() {
    super.reset(); if (!this.params) return;
    this.params.fill(0); this.cam.fill(0); this.seedOff.fill(0); this.glints.fill(0); this.glintBirth.fill(-1e9);
    for (let i = 0; i < WORLD_FLUID2.GLINT_MAX; i++) this.glints[i * 4 + 2] = -1;
    this.lastKick = -100; this.lastEventSec = -1; this.glintSerial = 0; this.kickPush = 0; this.kickEnv = 0;
    this.omega = 0; this.sectionJet = 0; this.decayMul = 1; this.zoom = 1; this.exposure = WORLD_FLUID2.EXPOSURE;
    this.paletteShift = 0; this.seed = 0; this.time = 0; this.simPending = false; this.needsClear = true;
  }
  init(gpu) {
    super.init(gpu); const c = WORLD_FLUID2;
    this.velocity = gpu.pair(c.VEL_W, c.VEL_H); this.pressure = gpu.pair(c.VEL_W, c.VEL_H);
    this.divergence = gpu.target(c.VEL_W, c.VEL_H); this.dye = gpu.pair(c.DYE_W, c.DYE_H);
    const loc = (program, names) => names.map(n => gpu.texture(program, n));
    this.advectProgram = gpu.program(WORLD_FLUID2_ADVECT_FRAGMENT);
    this.advectLoc = loc(this.advectProgram, ['vel', 'bands[0]', 'time', 'omega', 'sectionJet', 'kickPush', 'seedOff', 'paletteShift']);
    this.vorticityProgram = gpu.program(WORLD_FLUID2_VORTICITY_FRAGMENT); this.vorticityLoc = loc(this.vorticityProgram, ['vel']);
    this.divergenceProgram = gpu.program(WORLD_FLUID2_DIVERGENCE_FRAGMENT); this.divergenceLoc = loc(this.divergenceProgram, ['vel']);
    this.jacobiProgram = gpu.program(WORLD_FLUID2_JACOBI_FRAGMENT); this.jacobiLoc = loc(this.jacobiProgram, ['pressure', 'divergence']);
    this.projectProgram = gpu.program(WORLD_FLUID2_PROJECT_FRAGMENT); this.projectLoc = loc(this.projectProgram, ['vel', 'pressure']);
    this.dyeProgram = gpu.program(WORLD_FLUID2_DYE_FRAGMENT);
    this.dyeLoc = loc(this.dyeProgram, ['dye', 'vel', 'bands[0]', 'sectionJet', 'decayMul', 'paletteShift']);
    this.compositeProgram = gpu.program(WORLD_FLUID2_COMPOSITE_FRAGMENT);
    this.compositeLoc = loc(this.compositeProgram, ['dye', 'bands[0]', 'glint[0]', 'primary', 'cam', 'aspect', 'zoom', 'exposure', 'kickEnv', 'height', 'paletteShift']);
    this.dustProgram = gpu.program(WORLD_FLUID2_DUST_FRAGMENT, WORLD_FLUID2_DUST_VERTEX);
    this.dustLoc = loc(this.dustProgram, ['seed', 'cam', 'aspect', 'zoom']);
  }
  // 暖機窓の最初のステップ、または再生開始時に速度・圧力・染料を 0 にする（§9）。
  _clear() {
    const g = this.gpu;
    g.clearTarget(this.velocity.read); g.clearTarget(this.velocity.write); g.clearTarget(this.pressure.read); g.clearTarget(this.pressure.write);
    g.clearTarget(this.dye.read); g.clearTarget(this.dye.write); g.clearTarget(this.divergence);
    this.needsClear = false;
  }
  warmStart(tSec) { this._clear(); this.simPending = false; }
  step(input) {
    this.update(input);
    const c = WORLD_FLUID2, t = input.tSec, engine = input.engine, score = engine.score;
    worldFluid2Params(score.sections, engine.sectionIndex, t, this.params);
    const P = WORLD_FLUID2_PARAM, loud = input.features.loudness.level;
    this.seed = score.seed >>> 0; this.time = t;
    this.seedOff[0] = (this.seed & 1023) / 1024 * 100; this.seedOff[1] = ((this.seed >>> 10) & 1023) / 1024 * 100;
    this.omega = c.OMEGA_BASE * (c.OMEGA_FLOOR + c.OMEGA_LOUD * loud) * this.params[P.OMEGA];
    this.sectionJet = this.params[P.JET]; this.decayMul = this.params[P.DECAY]; this.zoom = this.params[P.ZOOM];
    this.exposure = c.EXPOSURE * (c.EXPOSURE_FLOOR + c.EXPOSURE_GAIN * loud);
    this.paletteShift = worldFluid2Hue(input.song.palette.primary);
    worldFluid2Camera(t, this.cam);
    // 低域/高域のオンセットは g-gargantua/g-attractor と同じ検出（同一時刻の再呼び出しでは数え直さない）。
    if (t !== this.lastEventSec) {
      const flags = input.features.onset.flags;
      this.kickPush = flags & 1 ? c.KICK_PUSH * this.params[P.KICK] : 0;
      if (flags & 1) this.lastKick = t;
      if (flags & 4) this._spawnGlint(t);
      this.lastEventSec = t;
    }
    this.kickEnv = Math.exp(-Math.max(0, t - this.lastKick) / c.KICK_SECONDS);
    for (let n = 0; n < c.GLINT_MAX; n++) {
      const age = t - this.glintBirth[n];
      this.glints[n * 4 + 2] = age >= 0 && age <= c.GLINT_LIFE ? age : -1;
    }
    this.simPending = input.dt > 0;
  }
  // 高域（16..31）でいちばん強い帯域の噴出口の外側に瞬きを置く（§6）。
  _spawnGlint(t) {
    const c = WORLD_FLUID2, b = this.bandUniforms;
    let k = c.GLINT_BAND_FIRST, best = -1;
    for (let i = c.GLINT_BAND_FIRST; i < c.JET_COUNT; i++) if (b[i * 4] > best) { best = b[i * 4]; k = i; }
    const slot = this.glintSerial % c.GLINT_MAX;
    worldFluid2GlintPosition(this.glintSerial, k, this.seed, this.glintPos);
    this.glints[slot * 4] = this.glintPos[0]; this.glints[slot * 4 + 1] = this.glintPos[1];
    this.glints[slot * 4 + 3] = (k / c.JET_COUNT * c.HUE_SPAN + this.paletteShift) % 1;
    this.glintBirth[slot] = t; this.glintSerial++;
  }
  _simulate() {
    const g = this.gpu, gl = g.gl, c = WORLD_FLUID2, v = this.velocity, pr = this.pressure;
    const A = this.advectLoc;
    g.bind(this.advectProgram, v.write); g.sampler(A[0], 0, v.read);
    gl.uniform4fv(A[1], this.bandUniforms); gl.uniform1f(A[2], this.time); gl.uniform1f(A[3], this.omega);
    gl.uniform1f(A[4], this.sectionJet); gl.uniform1f(A[5], this.kickPush); gl.uniform2fv(A[6], this.seedOff); gl.uniform1f(A[7], this.paletteShift);
    g.draw(); g.swap(v);
    g.bind(this.vorticityProgram, v.write); g.sampler(this.vorticityLoc[0], 0, v.read); g.draw(); g.swap(v);
    g.bind(this.divergenceProgram, this.divergence); g.sampler(this.divergenceLoc[0], 0, v.read); g.draw();
    for (let i = 0; i < c.PRESSURE_ITERS; i++) {
      g.bind(this.jacobiProgram, pr.write); g.sampler(this.jacobiLoc[0], 0, pr.read); g.sampler(this.jacobiLoc[1], 1, this.divergence); g.draw(); g.swap(pr);
    }
    g.bind(this.projectProgram, v.write); g.sampler(this.projectLoc[0], 0, v.read); g.sampler(this.projectLoc[1], 1, pr.read); g.draw(); g.swap(v);
    const D = this.dyeLoc;
    g.bind(this.dyeProgram, this.dye.write); g.sampler(D[0], 0, this.dye.read); g.sampler(D[1], 1, v.read);
    gl.uniform4fv(D[2], this.bandUniforms); gl.uniform1f(D[3], this.sectionJet); gl.uniform1f(D[4], this.decayMul); gl.uniform1f(D[5], this.paletteShift);
    g.draw(); g.swap(this.dye);
    this.kickPush = 0; // 衝撃は 1 ステップだけ加える
  }
  render(input) {
    const g = this.gpu, gl = g.gl, c = WORLD_FLUID2;
    gl.disable(gl.BLEND);
    if (this.needsClear) this._clear();
    if (this.simPending) { this._simulate(); this.simPending = false; }
    const C = this.compositeLoc, w = input.target.width, h = input.target.height, aspect = w / h;
    g.bind(this.compositeProgram, input.target); g.sampler(C[0], 0, this.dye.read);
    gl.uniform4fv(C[1], this.bandUniforms); gl.uniform4fv(C[2], this.glints); gl.uniform3fv(C[3], input.song.palette.primary);
    gl.uniform2fv(C[4], this.cam); gl.uniform1f(C[5], aspect); gl.uniform1f(C[6], this.zoom); gl.uniform1f(C[7], this.exposure);
    gl.uniform1f(C[8], this.kickEnv); gl.uniform1f(C[9], h); gl.uniform1f(C[10], this.paletteShift);
    g.draw();
    const U = this.dustLoc;
    g.bind(this.dustProgram, input.target);
    gl.uniform1ui(U[0], this.seed); gl.uniform2fv(U[1], this.cam); gl.uniform1f(U[2], aspect); gl.uniform1f(U[3], this.zoom);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.POINTS, 0, WORLD_FLUID2_DUST_TOTAL); gl.disable(gl.BLEND);
  }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorldFluid2Analyzer, WORLD_FLUID2, WORLD_FLUID2_TABLE, worldFluid2Hash, worldFluid2JetPosition, worldFluid2JetNormal,
    worldFluid2SectionParams, worldFluid2Params, worldFluid2Camera, worldFluid2DustScreen, worldFluid2GlintEnvelope,
    worldFluid2GlintPosition, worldFluid2Hue };
}
