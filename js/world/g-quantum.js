// 目的 — 映画の「量子のビジョン」：筋の弧・金の粒子殻と白い核・金の火花を描く — doc/20261024-design-visions-v1.md §0・§1・§3
const WORLD_QUANTUM = Object.freeze({
  FIL_BUNDLES: 6, FIL_PER_BUNDLE: 8, FIL_SAMPLES: 4096,
  FIL_R_MIN: 1.2, FIL_R_SPAN: 1.2, FIL_TILT: 70,
  FIL_OMEGA_MIN: .12, FIL_OMEGA_SPAN: .25, FIL_SPAN: 2.6,
  FIL_WAVE_M_MIN: 3, FIL_WAVE_M_SPAN: 4, FIL_WAVE_A_MIN: .06, FIL_WAVE_A_SPAN: .16,
  FIL_WAVE_NU: 1.3, FIL_WAVE_LOUD: .8, FIL_WAVE_BAND: .6,
  FIL_BUNDLE_W: .10, FIL_RADIAL_W: .05, FIL_GAIN: .35,
  FIL_CORE: '#EBE0C4', FIL_EDGE: '#C3C3A8',
  FIL_PULSE_FRACTION: .35, FIL_PULSE_SPEED: .9, FIL_PULSE_WIDTH: .03, FIL_PULSE_GAIN: 4.0, FIL_PULSE_SECONDS: 1.4, FIL_PULSE_SLOTS: 4,
  SHELL_COUNT: 262144, SHELL_R: .8, SHELL_JITTER: .06,
  SHELL_SPRAY: .10, SHELL_SPRAY_MIN: 1.12, SHELL_SPRAY_SPAN: .5, SHELL_SPRAY_GAIN: .45,
  CRACK_FREQ: 3.2, CRACK_WIDTH: .035, CRACK_FLOOR: .05,
  SHELL_SPIN: .06, SHELL_GAIN: .5,
  // 03 の殻の金（sRGB 色と割合）。粒ごとに累積重みで選ぶ。
  SHELL_GOLD: Object.freeze([
    Object.freeze(['#925A05', 29.4]), Object.freeze(['#A66704', 25.3]), Object.freeze(['#BA7704', 20.1]),
    Object.freeze(['#CE8B07', 14.9]), Object.freeze(['#9D9287', 10.2])
  ]),
  BURST_GROW: 1.8, BURST_SECONDS: 4, IMPLODE: .85,
  CORE_RADIUS: .05, CORE_GAIN: 6.0, CORE_KICK: 1.5, CORE_HALO: .15,
  CORE_COLOR: Object.freeze([1.0, .96, .88]), // linear
  SPARK_BURSTS: 16, SPARK_PER_BURST: 768, SPARK_TAPS: 4,
  SPARK_SPEED_MIN: 1.2, SPARK_SPEED_MAX: 4.0, SPARK_LIFE_MIN: .5, SPARK_LIFE_SPAN: .9,
  SPARK_DRAG: 1.6, SPARK_GRAVITY: 2.2, SPARK_SHUTTER: 1 / 30, SPARK_GAIN: 2.2,
  // 07 の火花（温度順）。u = 0, .33, .66, 1 に置く。
  SPARK_COLORS: Object.freeze(['#EECA81', '#DEAF5C', '#CA913C', '#935C25']),
  SPARK_BOKEH: .12, SPARK_BOKEH_NEAR: 1.0,
  STAR_GRID: 420, STAR_PROB: .06, STAR_RADIUS_PX: .6, STAR_GAIN: 1.4, STAR_COLOR: '#9D9287',
  GROUND_BLACK: '#060B04', GROUND_TEAL_CENTER: '#0D2226', GROUND_TEAL_EDGE: '#060E0A',
  BEAM_COUNT: 3, BEAM_WIDTH: .06, BEAM_GAIN: .35, BEAM_COLOR: '#566B67',
  BASE_SIZE: 1.6, COC_K: 26, MAX_POINT: 64,
  BAND_BASE: .55, BAND_GAIN: .9, KICK_SECONDS: .18,
  EXPOSURE_BASE: 1.0, EXPOSURE_FLOOR: .8, EXPOSURE_GAIN: .4,
  BLOOM_THRESHOLD: .7, BLOOM_STRENGTH: .9,
  SCENE_FADE: 2.0, CAMERA_EASE_SECONDS: 4,
  SPEED_LOUD_GAIN: .8, SPEED_MIN: .5, SPEED_MAX: 1.6,
  // 実装の内部定数（設計に値のないもの）
  MIN_WEIGHT: .002, SPARK_MIN_WEIGHT: .05, NEAR_Z: .05, BURST_BALL_R: 1.6, DISCARD_AGE: -100
});
// §3.2 区間の重み：filaments、star、sparks、teal。main の variation 奇数 ≥3 だけ別行。
const WORLD_QUANTUM_SCENES = Object.freeze({
  intro: Object.freeze([0, 1, 0, 0]),
  build: Object.freeze([1, .35, 0, 1]),
  drop: Object.freeze([.35, 1, 1, 0]),
  break: Object.freeze([1, 0, 0, 1]),
  main: Object.freeze([1, 0, .7, 1]),
  mainAlt: Object.freeze([.5, 1, .7, 0]),
  outro: Object.freeze([0, 1, 0, 0])
});
// §3.4 dist、yaw速度、pitch(°)、roll(°)、fov(°)、focus の始点/終点（各 2 値）。
const WORLD_QUANTUM_CAMERA = Object.freeze({
  intro: Object.freeze([4.2, 3.4, .04, .04, 6, 6, 0, 0, 34, 34, 4.2, 3.4]),
  build: Object.freeze([3.6, 3.0, .10, .10, 10, 18, -4, -4, 38, 38, 3.0, 3.0]),
  drop: Object.freeze([3.0, 3.0, .22, .22, 4, 4, 8, 8, 44, 44, 3.0, 3.0]),
  break: Object.freeze([3.4, 3.8, .05, .05, 20, 20, 0, 0, 36, 36, 3.4, 3.4]),
  main: Object.freeze([3.2, 3.2, .12, .12, -6, -6, -3, -3, 40, 40, 3.2, 3.2]),
  outro: Object.freeze([3.6, 5.0, .03, .03, 8, 14, 0, 0, 34, 34, 4.0, 4.0])
});
// 区間の種類から重みを out[0..3] へ書く（純関数）。
function worldQuantumSceneWeights(kind, variation, out) {
  const row = kind === 'main' && variation >= 3 && variation % 2 === 1 ? WORLD_QUANTUM_SCENES.mainAlt : (WORLD_QUANTUM_SCENES[kind] || WORLD_QUANTUM_SCENES.intro);
  out[0] = row[0]; out[1] = row[1]; out[2] = row[2]; out[3] = row[3];
  return out;
}
// 殻の膨張係数 B（§3.7）。drop は冒頭で膨らみ、outro は核へ縮む。
function worldQuantumShellFactor(kind, tSec, startSec, progress) {
  const c = WORLD_QUANTUM;
  if (kind === 'drop') {
    const q = Math.max(0, Math.min(1, (tSec - startSec) / c.BURST_SECONDS));
    return 1 + c.BURST_GROW * (1 - (1 - q) * (1 - q) * (1 - q));
  }
  if (kind === 'outro') return 1 - c.IMPLODE * progress;
  return 1;
}
const WORLD_QUANTUM_INT_NAMES = ['FIL_BUNDLES', 'FIL_PER_BUNDLE', 'FIL_SAMPLES', 'FIL_PULSE_SLOTS', 'SHELL_COUNT', 'SPARK_BURSTS', 'SPARK_PER_BURST', 'SPARK_TAPS', 'BEAM_COUNT'];
const WORLD_QUANTUM_GLSL_TMP = new Float32Array(3);
function worldQuantumVec3(hex) {
  const v = worldSrgbToLinear(hex, WORLD_QUANTUM_GLSL_TMP);
  return `vec3(${v[0].toFixed(10)},${v[1].toFixed(10)},${v[2].toFixed(10)})`;
}
const WORLD_QUANTUM_GLSL = (() => {
  const c = WORLD_QUANTUM, lines = [];
  for (const [name, value] of Object.entries(c)) {
    if (typeof value !== 'number') continue;
    lines.push(WORLD_QUANTUM_INT_NAMES.includes(name) ? `const int ${name} = ${value};` : `const float ${name} = ${value.toFixed(8)};`);
  }
  for (const name of ['FIL_CORE', 'FIL_EDGE', 'STAR_COLOR', 'GROUND_BLACK', 'GROUND_TEAL_CENTER', 'GROUND_TEAL_EDGE', 'BEAM_COLOR']) lines.push(`const vec3 ${name}_LIN = ${worldQuantumVec3(c[name])};`);
  lines.push(`const vec3 CORE_COLOR_LIN = vec3(${c.CORE_COLOR.map(v => v.toFixed(8)).join(',')});`);
  // 殻の金：累積重み（合計で正規化）と色
  let total = 0; for (const g of c.SHELL_GOLD) total += g[1];
  let acc = 0;
  c.SHELL_GOLD.forEach((g, i) => { acc += g[1]; lines.push(`const vec3 GOLD${i} = ${worldQuantumVec3(g[0])};`, `const float GOLD_CUM${i} = ${(acc / total).toFixed(8)};`); });
  c.SPARK_COLORS.forEach((hex, i) => lines.push(`const vec3 SPARK_C${i} = ${worldQuantumVec3(hex)};`));
  return lines.join('\n');
})();
const WORLD_QUANTUM_HASH_GLSL = `
uniform uint seed;
float particleHash(uint i,uint serial){
 uint h=i^(serial*0x9e3779b9u)^seed;
 h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;
 return float((h^(h>>16u))>>8u)*(1./16777216.);
}
float lattice3(ivec3 p){
 uint k=uint(p.x)*73856093u^uint(p.y)*19349663u^uint(p.z)*83492791u;
 return particleHash(k,0x7c000000u);
}
// 整数格子のハッシュ値を smoothstep で三線形補間した 3 次元 value noise（0..1）
float vnoise3(vec3 x){
 vec3 f=floor(x),w=fract(x);w=w*w*(3.-2.*w);ivec3 i=ivec3(f);
 float a=mix(mix(lattice3(i),lattice3(i+ivec3(1,0,0)),w.x),mix(lattice3(i+ivec3(0,1,0)),lattice3(i+ivec3(1,1,0)),w.x),w.y);
 float b=mix(mix(lattice3(i+ivec3(0,0,1)),lattice3(i+ivec3(1,0,1)),w.x),mix(lattice3(i+ivec3(0,1,1)),lattice3(i+ivec3(1,1,1)),w.x),w.y);
 return mix(a,b,w.z);
}
`;
const WORLD_QUANTUM_POINT_VERTEX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_QUANTUM_GLSL}
${WORLD_QUANTUM_HASH_GLSL}
const float PI=3.141592653589793;
const float DEG=PI/180.;
// 乱数の用途ごとの系列（イベント通番と衝突しない上位ビット）
const uint SER_BUNDLE=0x7a000000u,SER_FIL=0x7a100000u,SER_SHELL=0x7b000000u;
const int FIL_TOTAL=FIL_BUNDLES*FIL_PER_BUNDLE*FIL_SAMPLES;
const int SHELL_END=FIL_TOTAL+SHELL_COUNT;
uniform vec4 bands[32];
uniform vec4 weights; // filaments、star、sparks、teal
uniform vec3 camPos,camForward,camRight,camUp;
uniform vec2 projection; // aspect、tan(fov/2)
uniform vec4 timing; // t、波の位相、殻の膨張係数B、露出
uniform vec4 view; // s1080、focus
uniform vec4 filPulse[2]; // 4スロット (serial,t0)
uniform vec4 sparkOrigin[SPARK_BURSTS]; // xyz、t0
uniform float sparkSerial[SPARK_BURSTS];
out vec3 pointColor;
out float pointSizeNorm;
void dropPoint(){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=1.;pointColor=vec3(0.);pointSizeNorm=1.;}
vec3 rotX(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(p.x,p.y*c-p.z*s,p.y*s+p.z*c);}
vec3 rotY(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);}
vec3 sparkColor(float u){
 if(u<.33)return mix(SPARK_C0,SPARK_C1,u/.33);
 if(u<.66)return mix(SPARK_C1,SPARK_C2,(u-.33)/.33);
 return mix(SPARK_C2,SPARK_C3,clamp((u-.66)/.34,0.,1.));
}
vec3 goldColor(float h){
 if(h<GOLD_CUM0)return GOLD0;if(h<GOLD_CUM1)return GOLD1;if(h<GOLD_CUM2)return GOLD2;if(h<GOLD_CUM3)return GOLD3;return GOLD4;
}
void main(){
 int v=gl_VertexID;vec3 P;vec3 col;float t=timing.x;
 if(v<FIL_TOTAL){
  if(weights.x<MIN_WEIGHT){dropPoint();return;}
  int j=v%FIL_SAMPLES,fi=(v/FIL_SAMPLES)%FIL_PER_BUNDLE,b=v/(FIL_SAMPLES*FIL_PER_BUNDLE);
  uint ub=uint(b),uf=uint(b*FIL_PER_BUNDLE+fi);
  float R=FIL_R_MIN+FIL_R_SPAN*particleHash(ub,SER_BUNDLE+1u);
  float alpha=(particleHash(ub,SER_BUNDLE+2u)-.5)*FIL_TILT*DEG;
  float beta=particleHash(ub,SER_BUNDLE+3u)*2.*PI;
  float omega=(FIL_OMEGA_MIN+FIL_OMEGA_SPAN*particleHash(ub,SER_BUNDLE+4u))*((b&1)==0?1.:-1.);
  float th0=particleHash(ub,SER_BUNDLE+5u)*2.*PI;
  float m=FIL_WAVE_M_MIN+floor(particleHash(ub,SER_BUNDLE+6u)*FIL_WAVE_M_SPAN);
  float amp=FIL_WAVE_A_MIN+FIL_WAVE_A_SPAN*particleHash(ub,SER_BUNDLE+7u);
  float o=(particleHash(uf,SER_FIL+1u)-.5)*FIL_BUNDLE_W,ro=(particleHash(uf,SER_FIL+2u)-.5)*FIL_RADIAL_W;
  float phi=particleHash(uf,SER_FIL+3u)*.6;
  col=mix(FIL_EDGE_LIN,FIL_CORE_LIN,particleHash(uf,SER_FIL+4u));
  int band=(b*5+fi*4)%32;float lv=bands[band].y;
  float u=float(j)/float(FIL_SAMPLES-1);
  float th=th0+omega*t+u*FIL_SPAN;
  float wave=amp*(1.+FIL_WAVE_BAND*lv)*sin(m*th-timing.y+phi);
  vec3 local=vec3((R+ro)*cos(th),o+wave,(R+ro)*sin(th));
  P=rotY(rotX(local,alpha),beta);
  float pulse=0.;
  for(int k=0;k<FIL_PULSE_SLOTS;k++){
   vec4 q=filPulse[k>>1];vec2 sl=(k&1)==0?q.xy:q.zw;
   float age=t-sl.y;
   if(age>=0.&&age<=FIL_PULSE_SECONDS&&particleHash(uf,uint(sl.x))<FIL_PULSE_FRACTION){
    float s=age*FIL_PULSE_SPEED;
    if(s<=1.){float d=(u-s)/FIL_PULSE_WIDTH;pulse+=FIL_PULSE_GAIN*exp(-.5*d*d)*(1.-age/FIL_PULSE_SECONDS);}
   }
  }
  col*=FIL_GAIN*pow(max(sin(PI*u),0.),.8)*(BAND_BASE+BAND_GAIN*lv)*(1.+pulse)*weights.x;
 }else if(v<SHELL_END){
  if(weights.y<MIN_WEIGHT){dropPoint();return;}
  uint ui=uint(v-FIL_TOTAL);
  float h1=particleHash(ui,SER_SHELL+1u),h2=particleHash(ui,SER_SHELL+2u),h3=particleHash(ui,SER_SHELL+3u);
  float h4=particleHash(ui,SER_SHELL+4u),h5=particleHash(ui,SER_SHELL+5u),h6=particleHash(ui,SER_SHELL+6u);
  float z=2.*h1-1.,ph=2.*PI*h2,sq=sqrt(max(0.,1.-z*z));vec3 dir=vec3(sq*cos(ph),z,sq*sin(ph));
  bool spray=h3<SHELL_SPRAY;
  float r=spray?SHELL_R*(SHELL_SPRAY_MIN+SHELL_SPRAY_SPAN*h4):SHELL_R*(1.+SHELL_JITTER*(h4-.5));
  float B=timing.z;
  r*=1.+(B-1.)*(.6+.8*h5);
  P=rotY(dir*r,SHELL_SPIN*t);
  vec3 seedOffset=vec3(float(seed%1024u)*.37);
  float vein=max(CRACK_FLOOR,smoothstep(0.,CRACK_WIDTH,abs(vnoise3(dir*CRACK_FREQ+seedOffset)-.5)));
  int band=int((dir.y*.5+.5)*31.99);
  float gain=SHELL_GAIN*(BAND_BASE+BAND_GAIN*bands[band].y)*vein*weights.y;
  if(spray)gain*=SHELL_SPRAY_GAIN;
  if(B>1.)gain*=1.-.6*(B-1.)/BURST_GROW;
  col=goldColor(h6)*gain;
 }else{
  if(weights.z<MIN_WEIGHT){dropPoint();return;}
  int k=v-SHELL_END;
  int tap=k%SPARK_TAPS,pi=(k/SPARK_TAPS)%SPARK_PER_BURST,bu=k/(SPARK_TAPS*SPARK_PER_BURST);
  vec4 so=sparkOrigin[bu];uint ser=uint(sparkSerial[bu])*16u,up=uint(pi);
  float a=t-so.w-float(tap)*SPARK_SHUTTER/float(SPARK_TAPS);
  float life=SPARK_LIFE_MIN+SPARK_LIFE_SPAN*particleHash(up,ser+1u);
  if(a<0.||a>=life){dropPoint();return;}
  float z=2.*particleHash(up,ser+2u)-1.,ph=2.*PI*particleHash(up,ser+3u),sq=sqrt(max(0.,1.-z*z));vec3 dir=vec3(sq*cos(ph),z,sq*sin(ph));
  float hs=particleHash(up,ser+4u),speed=SPARK_SPEED_MIN+(SPARK_SPEED_MAX-SPARK_SPEED_MIN)*hs*hs;
  P=so.xyz+dir*speed*(1.-exp(-SPARK_DRAG*a))/SPARK_DRAG+vec3(0.,-.5*SPARK_GRAVITY*a*a,0.);
  float hb=particleHash(up,ser+5u);
  if(hb<SPARK_BOKEH)P-=camForward*(SPARK_BOKEH_NEAR+particleHash(up,ser+6u));
  float u=a/life;
  col=sparkColor(u)*SPARK_GAIN*pow(1.-u,1.5)*weights.z/float(SPARK_TAPS);
 }
 vec3 rel=P-camPos;float zv=dot(rel,camForward);
 if(zv<=NEAR_Z){dropPoint();return;}
 gl_Position=vec4(dot(rel,camRight)/(projection.x*projection.y),dot(rel,camUp)/projection.y,0.,zv);
 float s1080=view.x,coc=COC_K*s1080*abs(zv-view.y)/zv,base=BASE_SIZE*s1080;
 float size=min(MAX_POINT*s1080,sqrt(base*base+coc*coc));
 gl_PointSize=size;pointSizeNorm=size/s1080;
 pointColor=col*(base/size)*(base/size)*timing.w;
}`;
const WORLD_QUANTUM_POINT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 pointColor;
in float pointSizeNorm;
out vec4 frag;
void main(){
 float r=length(gl_PointCoord*2.-1.);
 if(r>1.){frag=vec4(0.);return;}
 float gauss=exp(-4.5*r*r);
 float disc=.30*(1.-smoothstep(.82,1.,r))*(.85+.25*smoothstep(.55,.95,r));
 frag=vec4(pointColor*mix(gauss,disc,smoothstep(4.,14.,pointSizeNorm)),0.);
}`;
const WORLD_QUANTUM_BACKGROUND_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_QUANTUM_GLSL}
${WORLD_QUANTUM_HASH_GLSL}
in vec2 vUv;
uniform vec4 weights; // filaments、star、sparks、teal
uniform vec3 camForward,camRight,camUp;
uniform vec2 projection; // aspect、tan(fov/2)
uniform vec4 timing; // t、キック包絡、殻の膨張係数B、露出
uniform vec4 screen; // 幅px、高さpx、s1080、focalPx
uniform vec3 core; // corePx.x、corePx.y、coreR
out vec4 frag;
void main(){
 float aspect=projection.x,tanH=projection.y,t=timing.x;
 vec2 q=(vUv-.5)*vec2(aspect,1.);
 vec3 teal=mix(GROUND_TEAL_EDGE_LIN,GROUND_TEAL_CENTER_LIN,exp(-1.6*dot(q,q)*4.));
 vec3 beams=vec3(0.);
 for(int j=0;j<BEAM_COUNT;j++){
  float cx=.5+.35*sin(.05*t+float(j)*2.1),d=(vUv.x-cx)/BEAM_WIDTH;
  beams+=BEAM_COLOR_LIN*BEAM_GAIN*exp(-.5*d*d);
 }
 vec3 ground=mix(GROUND_BLACK_LIN,teal+beams,weights.w);
 // 星：光線方向の 3D 格子。セルごとに確率 STAR_PROB で 1 個（セル内ずれ ±.3）
 vec2 ndc=vUv*2.-1.;
 vec3 ray=normalize(camForward+ndc.x*aspect*tanH*camRight+ndc.y*tanH*camUp);
 vec3 cell=floor(ray*STAR_GRID);
 ivec3 ic=ivec3(cell);
 uint ck=uint(ic.x)*73856093u^uint(ic.y)*19349663u^uint(ic.z)*83492791u;
 vec3 stars=vec3(0.);
 if(particleHash(ck,0x7d000000u)<STAR_PROB){
  vec3 jit=vec3(particleHash(ck,0x7d000001u),particleHash(ck,0x7d000002u),particleHash(ck,0x7d000003u));
  vec3 sdir=normalize(cell+.5+(jit-.5)*.6);
  float dpx=length(ray-sdir)*screen.w,rpx=STAR_RADIUS_PX*screen.z,hh=particleHash(ck,0x7d000004u);
  stars=STAR_COLOR_LIN*hh*hh*hh*STAR_GAIN*exp(-(dpx/rpx)*(dpx/rpx));
 }
 // 核：白に近い暖色。膨らむと弱まり、縮むと強まる
 float d=length(gl_FragCoord.xy-core.xy);
 float Bcore=1./max(timing.z,.3);
 vec3 coreLight=CORE_GAIN*(1.+CORE_KICK*timing.y)*(exp(-(d/core.z)*(d/core.z))+CORE_HALO*exp(-d/(core.z*6.)))*CORE_COLOR_LIN*weights.y*Bcore;
 frag=vec4((ground+stars*(1.-weights.w)+coreLight)*timing.w,1.);
}`;
class WorldQuantumAnalyzer extends WorldBandAnalyzer {
  constructor() {
    super(); this.id = 'g-quantum'; this.label = '量子のビジョン';
    this.statelessRender = true; // フレーム間のGPU履歴を持たない（設計 §1）。
    this.camera = new Float32Array(4); this.cameraFrom = new Float64Array(6); this.cameraTarget = new Float64Array(6); this.cameraShot = new Float64Array(6);
    this.camPos = new Float32Array(3); this.camForward = new Float32Array(3); this.camRight = new Float32Array(3); this.camUp = new Float32Array(3);
    this.weights = new Float64Array(4); this.weightsFrom = new Float64Array(4); this.weightsTarget = new Float64Array(4); this.weightsU = new Float32Array(4);
    this.filPulse = new Float32Array(8); this.sparkOrigin = new Float32Array(WORLD_QUANTUM.SPARK_BURSTS * 4); this.sparkSerials = new Float32Array(WORLD_QUANTUM.SPARK_BURSTS);
    this.timing = new Float32Array(4); this.view = new Float32Array(4); this.screen = new Float32Array(4); this.corePx = new Float32Array(3);
    this.reset();
  }
  reset() {
    super.reset(); if (!this.camera) return;
    this.camera.fill(0); this.cameraFrom.fill(0); this.cameraTarget.fill(0); this.cameraShot.fill(0);
    this.camPos.fill(0); this.camForward.fill(0); this.camRight.fill(0); this.camUp.fill(0);
    this.weights.fill(0); this.weightsFrom.fill(0); this.weightsTarget.fill(0); this.weightsU.fill(0);
    this.filPulse.fill(0); for (let i = 0; i < WORLD_QUANTUM.FIL_PULSE_SLOTS; i++) this.filPulse[i * 2 + 1] = WORLD_QUANTUM.DISCARD_AGE;
    this.sparkOrigin.fill(0); for (let i = 0; i < WORLD_QUANTUM.SPARK_BURSTS; i++) this.sparkOrigin[i * 4 + 3] = WORLD_QUANTUM.DISCARD_AGE;
    this.sparkSerials.fill(0);
    this.timing.fill(0); this.view.fill(0); this.screen.fill(0); this.corePx.fill(0);
    this.section = null; this.sectionChangedSec = 0; this.sceneChangedSec = 0; this.yaw = 0; this.wavePhase = 0;
    this.shellFactor = 1; this.shellFrom = 1; this.filSerial = 0; this.sparkSerial = 0;
    this.lastKick = -100; this.lastEventSec = -1; this.seed = 0; this.exposure = 0; this.kind = 'intro';
  }
  init(gpu) {
    super.init(gpu);
    this.program = gpu.program(WORLD_QUANTUM_POINT_FRAGMENT, WORLD_QUANTUM_POINT_VERTEX);
    const names = ['bands[0]', 'weights', 'camPos', 'camForward', 'camRight', 'camUp', 'projection', 'timing', 'view', 'filPulse[0]', 'sparkOrigin[0]', 'sparkSerial[0]', 'seed'];
    this.pointLoc = {}; for (const n of names) this.pointLoc[n] = gpu.texture(this.program, n);
    this.backgroundProgram = gpu.program(WORLD_QUANTUM_BACKGROUND_FRAGMENT);
    const bgNames = ['weights', 'camForward', 'camRight', 'camUp', 'projection', 'timing', 'screen', 'core', 'seed'];
    this.bgLoc = {}; for (const n of bgNames) this.bgLoc[n] = gpu.texture(this.backgroundProgram, n);
  }
  // 区間ごとの目標（重み・殻の膨張係数B）と、現在値から目標へのSCENE_FADE秒のsmoothstep。
  _updateScene(s, t, progress) {
    const c = WORLD_QUANTUM, target = this.weightsTarget;
    worldQuantumSceneWeights(s.kind, s.variation, target);
    const bTarget = worldQuantumShellFactor(s.kind, t, s.startSec, progress);
    if (s !== this.section) {
      if (this.section) { this.weightsFrom.set(this.weights); this.shellFrom = this.shellFactor; this.sceneChangedSec = t; }
      else { this.weightsFrom.set(target); this.shellFrom = bTarget; this.sceneChangedSec = t - c.SCENE_FADE; }
    }
    const x = Math.max(0, Math.min(1, (t - this.sceneChangedSec) / c.SCENE_FADE)), e = x * x * (3 - 2 * x);
    for (let i = 0; i < 4; i++) this.weights[i] = this.weightsFrom[i] + (target[i] - this.weightsFrom[i]) * e;
    this.shellFactor = this.shellFrom + (bTarget - this.shellFrom) * e;
  }
  step(input) {
    this.update(input);
    const c = WORLD_QUANTUM, t = input.tSec, s = input.engine.score.sections[input.engine.sectionIndex];
    this.seed = input.engine.score.seed; this.kind = s.kind;
    const p = Math.max(0, Math.min(1, (t - s.startSec) / Math.max(.001, s.endSec - s.startSec))), progress = p * p * (3 - 2 * p);
    const row = WORLD_QUANTUM_CAMERA[s.kind] || WORLD_QUANTUM_CAMERA.intro, target = this.cameraTarget, shot = this.cameraShot;
    for (let i = 0; i < 6; i++) target[i] = row[i * 2] + (row[i * 2 + 1] - row[i * 2]) * progress;
    // 奇数variation（3以上）で yaw速度と roll の符号を反転する。
    if (s.variation >= 3 && s.variation % 2 === 1) { target[1] = -target[1]; target[3] = -target[3]; }
    target[2] *= Math.PI / 180; target[3] *= Math.PI / 180; target[4] *= Math.PI / 180;
    this._updateScene(s, t, progress);
    if (s !== this.section) {
      if (this.section) this.cameraFrom.set(shot); else this.cameraFrom.set(target);
      this.sectionChangedSec = this.section ? s.startSec : s.startSec - c.CAMERA_EASE_SECONDS; this.section = s;
    }
    const x = Math.max(0, Math.min(1, (t - this.sectionChangedSec) / c.CAMERA_EASE_SECONDS)), ease = x * x * (3 - 2 * x);
    for (let i = 0; i < 6; i++) shot[i] = this.cameraFrom[i] + (target[i] - this.cameraFrom[i]) * ease;
    const loud = input.features.loudness.level;
    this.yaw += shot[1] * Math.max(c.SPEED_MIN, Math.min(c.SPEED_MAX, 1 + c.SPEED_LOUD_GAIN * (loud - .5))) * input.dt;
    this.wavePhase += c.FIL_WAVE_NU * (1 + c.FIL_WAVE_LOUD * loud) * input.dt;
    this.camera[0] = shot[0]; this.camera[1] = shot[2]; this.camera[2] = this.yaw; this.camera[3] = shot[3];
    this._updateCameraBasis();
    if (t !== this.lastEventSec) {
      const flags = input.features.onset.flags;
      if (flags & 1) { this.lastKick = t; if (this.weights[2] > c.SPARK_MIN_WEIGHT) this._spawnBurst(t); }
      if (flags & 4) {
        const serial = ++this.filSerial, slot = serial % c.FIL_PULSE_SLOTS;
        this.filPulse[slot * 2] = serial; this.filPulse[slot * 2 + 1] = t;
      }
      this.lastEventSec = t;
    }
    this.exposure = c.EXPOSURE_BASE * (c.EXPOSURE_FLOOR + c.EXPOSURE_GAIN * loud);
  }
  // キックで火花のバーストを 1 つ作る。drop かつ star の重みが .5 以上なら殻の上、それ以外は半径 1.6 の球内。
  _spawnBurst(t) {
    const c = WORLD_QUANTUM, serial = ++this.sparkSerial, slot = serial % c.SPARK_BURSTS, o = slot * 4, seed = this.seed;
    const z = 2 * worldAttractorHash(1, serial, seed) - 1, ph = 2 * Math.PI * worldAttractorHash(2, serial, seed), sq = Math.sqrt(Math.max(0, 1 - z * z));
    const dx = sq * Math.cos(ph), dy = z, dz = sq * Math.sin(ph);
    const r = this.kind === 'drop' && this.weights[1] >= .5 ? c.SHELL_R * this.shellFactor : c.BURST_BALL_R * Math.cbrt(worldAttractorHash(3, serial, seed));
    this.sparkOrigin[o] = dx * r; this.sparkOrigin[o + 1] = dy * r; this.sparkOrigin[o + 2] = dz * r; this.sparkOrigin[o + 3] = t;
    this.sparkSerials[slot] = serial;
  }
  // g-attractor と同じ式でカメラ位置と前/右/上（roll適用済み）を計算する。配列は再利用する。
  _updateCameraBasis() {
    const dist = this.camera[0], pitch = this.camera[1], yaw = this.camera[2], roll = this.camera[3];
    const cp = Math.cos(pitch), cx = dist * cp * Math.cos(yaw), cy = dist * Math.sin(pitch), cz = dist * cp * Math.sin(yaw);
    const il = 1 / Math.hypot(cx, cy, cz), fx = -cx * il, fy = -cy * il, fz = -cz * il;
    const ir = 1 / Math.hypot(fz, fx), rx = -fz * ir, ry = 0, rz = fx * ir;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    this.camPos[0] = cx; this.camPos[1] = cy; this.camPos[2] = cz;
    this.camForward[0] = fx; this.camForward[1] = fy; this.camForward[2] = fz;
    this.camRight[0] = cr * rx + sr * ux; this.camRight[1] = cr * ry + sr * uy; this.camRight[2] = cr * rz + sr * uz;
    this.camUp[0] = -sr * rx + cr * ux; this.camUp[1] = -sr * ry + cr * uy; this.camUp[2] = -sr * rz + cr * uz;
  }
  render(input) {
    const g = this.gpu, gl = g.gl, c = WORLD_QUANTUM, w = input.target.width, h = input.target.height;
    const aspect = w / h, tanH = Math.tan(this.cameraShot[4] * .5), s1080 = h / 1080, focalPx = h / (2 * tanH);
    const t = input.tSec, kick = Math.exp(-Math.max(0, t - this.lastKick) / c.KICK_SECONDS);
    for (let i = 0; i < 4; i++) this.weightsU[i] = this.weights[i];
    // 核の画面位置と半径（原点を投影。カメラは原点を向くので中心になる）
    const rx = -this.camPos[0], ry = -this.camPos[1], rz = -this.camPos[2];
    const zc = rx * this.camForward[0] + ry * this.camForward[1] + rz * this.camForward[2];
    this.corePx[0] = w * .5 + focalPx * (rx * this.camRight[0] + ry * this.camRight[1] + rz * this.camRight[2]) / zc;
    this.corePx[1] = h * .5 + focalPx * (rx * this.camUp[0] + ry * this.camUp[1] + rz * this.camUp[2]) / zc;
    this.corePx[2] = c.CORE_RADIUS * focalPx / this.camera[0];
    this.screen[0] = w; this.screen[1] = h; this.screen[2] = s1080; this.screen[3] = focalPx;
    // 背景パス（地・星・核）。ブレンドなしで全面を上書きする。
    const b = this.bgLoc;
    gl.disable(gl.BLEND);
    g.bind(this.backgroundProgram, input.target);
    gl.uniform4fv(b.weights, this.weightsU); gl.uniform3fv(b.camForward, this.camForward); gl.uniform3fv(b.camRight, this.camRight); gl.uniform3fv(b.camUp, this.camUp);
    gl.uniform2f(b.projection, aspect, tanH);
    this.timing[0] = t; this.timing[1] = kick; this.timing[2] = this.shellFactor; this.timing[3] = this.exposure;
    gl.uniform4fv(b.timing, this.timing); gl.uniform4fv(b.screen, this.screen); gl.uniform3fv(b.core, this.corePx); gl.uniform1ui(b.seed, this.seed);
    g.draw();
    // 点スプライト 1 回の加算描画
    const l = this.pointLoc;
    g.bind(this.program, input.target);
    gl.uniform4fv(l['bands[0]'], this.bandUniforms); gl.uniform4fv(l.weights, this.weightsU);
    gl.uniform3fv(l.camPos, this.camPos); gl.uniform3fv(l.camForward, this.camForward); gl.uniform3fv(l.camRight, this.camRight); gl.uniform3fv(l.camUp, this.camUp);
    gl.uniform2f(l.projection, aspect, tanH);
    this.timing[1] = this.wavePhase; // 点パスでは波の位相
    this.view[0] = s1080; this.view[1] = this.cameraShot[5];
    gl.uniform4fv(l.timing, this.timing); gl.uniform4fv(l.view, this.view);
    gl.uniform4fv(l['filPulse[0]'], this.filPulse); gl.uniform4fv(l['sparkOrigin[0]'], this.sparkOrigin); gl.uniform1fv(l['sparkSerial[0]'], this.sparkSerials);
    gl.uniform1ui(l.seed, this.seed);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, c.FIL_BUNDLES * c.FIL_PER_BUNDLE * c.FIL_SAMPLES + c.SHELL_COUNT + c.SPARK_BURSTS * c.SPARK_PER_BURST * c.SPARK_TAPS);
    gl.disable(gl.BLEND);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldQuantumAnalyzer, WORLD_QUANTUM, WORLD_QUANTUM_SCENES, WORLD_QUANTUM_CAMERA, worldQuantumSceneWeights, worldQuantumShellFactor }; }
