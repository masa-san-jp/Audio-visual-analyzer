// 目的 — 奥行き方向に並ぶ縦の光の筋の壁の中をカメラが進む「テッセラクト」— doc/20261024-design-visions-v1.md §0〜2
const WORLD_TESSERACT = Object.freeze({
  PITCH: .02, LAYERS: 3, LAYER_DZ: 1.2, NEAR: .25, NEAR_FADE: .35, FAR_FADE: 1.2, FOG: 3.5, PRESENCE: .45,
  W_MIN: .06, W_MAX: .30, W_POW: 2.5, JITTER: .6, BUNDLE: .28,
  BUNDLE_LO: .38, BUNDLE_HI: .60, BUNDLE_FLOOR: 0,
  HALO_GAIN: .08, HALO_WIDTH: 3.0, APERTURE: .003, NEIGHBOR: 3, PEAK: 3.0,
  BAND_BASE: .55, BAND_GAIN: .9, KICK_GAIN: .25, KICK_SECONDS: .18,
  FLOW_WAVELENGTH: .9, FLOW_SPEED: .12, FLOW_DEPTH: .12,
  PULSE_FRACTION: .04, PULSE_SPEED: 2.4, PULSE_LENGTH: .12, PULSE_GAIN: 3.0, PULSE_SECONDS: 1.6, PULSE_START: 1.6,
  PULSE_SLOTS: 4, BG: '#080502',
  EXPOSURE_BASE: 1.0, EXPOSURE_FLOOR: .8, EXPOSURE_GAIN: .4,
  BLOOM_THRESHOLD: .8, BLOOM_STRENGTH: .55, CAMERA_EASE_SECONDS: 4,
  SPEED_LOUD_GAIN: .8, SPEED_MIN: .5, SPEED_MAX: 1.6
});
// §0.1 実測した筋の色（sRGB）。[重み（割合）, core, halo]、割合の大きい順。
const WORLD_TESSERACT_PALETTE = Object.freeze([
  Object.freeze([.426, '#C1C5BC', '#929388']),
  Object.freeze([.418, '#F9F7DF', '#B0A58A']),
  Object.freeze([.097, '#EEC1AE', '#B28B83']),
  Object.freeze([.043, '#F5F9E8', '#C9CEB8']),
  Object.freeze([.009, '#EBF7F3', '#BFD0CC']),
  Object.freeze([.007, '#E1EBE3', '#D2DFD7'])
]);
// 列: vx（反転）、vz、yaw°（反転）、pitch°、roll°（反転）、fov°、focus の各 始点/終点。
const WORLD_TESSERACT_CAMERA = Object.freeze({
  intro: Object.freeze([.03,.03, .02,.02, 0,0, 0,0, 0,0, 40,40, 2.2,2.2]),
  build: Object.freeze([.05,.10, .05,.35, 0,6, 0,4, 0,-3, 40,46, 2.2,1.6]),
  drop: Object.freeze([.22,.22, .30,.30, 20,26, -4,-4, -7,-7, 52,52, 1.4,1.4]),
  break: Object.freeze([.015,.015, .03,.03, 0,0, 24,30, 0,0, 44,44, 2.6,2.6]),
  main: Object.freeze([.08,.08, .10,.10, -10,-10, 3,3, 3,3, 42,42, 1.8,1.8]),
  outro: Object.freeze([.02,.01, -.06,-.06, 0,0, 0,0, 0,0, 40,36, 2.4,2.4])
});
// 反転する列（vx=0、yaw=2、roll=4）と、角度（度→rad）にする列（yaw=2、pitch=3、roll=4、fov=5）。
const WORLD_TESSERACT_FLIP_COLUMNS = Object.freeze([0, 2, 4]);
const WORLD_TESSERACT_SHOT_COLUMNS = 7;
// 色は JS 側で sRGB→linear にしてから定数にする（§0.1）。
const WORLD_TESSERACT_BG_LINEAR = worldSrgbToLinear(WORLD_TESSERACT.BG, new Float32Array(3));
const WORLD_TESSERACT_PALETTE_LINEAR = Object.freeze(WORLD_TESSERACT_PALETTE.map(p => Object.freeze({
  weight: p[0], core: worldSrgbToLinear(p[1], new Float32Array(3)), halo: worldSrgbToLinear(p[2], new Float32Array(3))
})));
const WORLD_TESSERACT_INT_NAMES = ['LAYERS', 'NEIGHBOR', 'PULSE_SLOTS'];
const WORLD_TESSERACT_GLSL = Object.entries(WORLD_TESSERACT).filter(([, v]) => typeof v === 'number').map(([name, value]) =>
  `const ${WORLD_TESSERACT_INT_NAMES.includes(name) ? 'int' : 'float'} ${name} = ${WORLD_TESSERACT_INT_NAMES.includes(name) ? value : value.toFixed(8)};`).join('\n');
const WORLD_TESSERACT_VEC3 = a => `vec3(${a[0].toFixed(8)},${a[1].toFixed(8)},${a[2].toFixed(8)})`;
const WORLD_TESSERACT_PALETTE_GLSL = `
const int PAL_N = ${WORLD_TESSERACT_PALETTE_LINEAR.length};
const float PAL_WEIGHT[PAL_N] = float[PAL_N](${WORLD_TESSERACT_PALETTE_LINEAR.map(p => p.weight.toFixed(8)).join(',')});
const vec3 PAL_CORE[PAL_N] = vec3[PAL_N](${WORLD_TESSERACT_PALETTE_LINEAR.map(p => WORLD_TESSERACT_VEC3(p.core)).join(',')});
const vec3 PAL_HALO[PAL_N] = vec3[PAL_N](${WORLD_TESSERACT_PALETTE_LINEAR.map(p => WORLD_TESSERACT_VEC3(p.halo)).join(',')});
const vec3 BG_COLOR = ${WORLD_TESSERACT_VEC3(WORLD_TESSERACT_BG_LINEAR)};
`;
const WORLD_TESSERACT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_TESSERACT_GLSL}
${WORLD_TESSERACT_PALETTE_GLSL}
in vec2 vUv;
uniform vec4 bands[32]; // y = 残光つきレベル
uniform vec4 pulses[PULSE_SLOTS]; // serial、t0、dir、未使用
uniform vec3 camPos, camForward, camRight, camUp;
uniform vec2 projection; // aspect、tan(fov/2)
uniform vec2 resolution;
uniform float tSec, focus, kick, exposure;
uniform uint seed;
out vec4 frag;
const float TAU = 6.283185307179586;
float tsHash(uint i, uint serial){
 uint h=i^(serial*0x9e3779b9u)^seed;
 h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;
 return float((h^(h>>16u))>>8u)*(1./16777216.);
}
float cellHash(int n, int k, uint j){return tsHash(uint(n)*0x9e3779b1u+uint(k)*0x85ebca6bu, j);}
// 整数格子のハッシュ値を smoothstep で補間した 1 次元 value noise（0..1）。
float vnoise1(float x){
 float f=floor(x),u=x-f;u=u*u*(3.-2.*u);
 return mix(tsHash(uint(int(f)),7u),tsHash(uint(int(f)+1),7u),u);
}
void main(){
 vec2 ndc=vUv*2.-1.;
 float tanH=projection.y;
 vec3 ray=normalize(camForward+ndc.x*projection.x*tanH*camRight+ndc.y*tanH*camUp);
 vec3 sum=vec3(0.);
 if(ray.z>=.05){
  int k0=int(floor((camPos.z+NEAR)/LAYER_DZ))+1;
  float Dfar=NEAR+float(LAYERS)*LAYER_DZ;
  for(int i=0;i<LAYERS;i++){
   int k=k0+i;float D=float(k)*LAYER_DZ-camPos.z;
   float t=D/ray.z,x=camPos.x+ray.x*t,y=ray.y*t;
   float fade=smoothstep(NEAR,NEAR+NEAR_FADE,D)*(1.-smoothstep(Dfar-FAR_FADE,Dfar,D))*exp(-t/FOG);
   if(fade<=0.)continue;
   float coc=APERTURE*abs(t-focus)/focus;
   float pix=t*2.*tanH/resolution.y/max(ray.z,.25);
   int n0=int(floor(x/PITCH));
   for(int dn=-NEIGHBOR;dn<=NEIGHBOR;dn++){
    int n=n0+dn;
    float h1=cellHash(n,k,1u);
    if(h1>=PRESENCE)continue;
    float h2=cellHash(n,k,2u),h3=cellHash(n,k,3u),h4=cellHash(n,k,4u),h5=cellHash(n,k,5u),h6=cellHash(n,k,6u);
    float xs=(float(n)+.5+(h2-.5)*JITTER)*PITCH;
    float w=PITCH*(W_MIN+(W_MAX-W_MIN)*pow(h3,W_POW));
    float we=sqrt(w*w+coc*coc+pix*pix),d=x-xs;
    // h4 で選んだパレット族（累積重み）
    int pi=PAL_N-1;float acc=0.;
    for(int q=0;q<PAL_N;q++){acc+=PAL_WEIGHT[q];if(h4<acc){pi=q;break;}}
    float dh=d/(HALO_WIDTH*we);
    vec3 prof=(w/we)*(exp(-.5*(d/we)*(d/we))*PAL_CORE[pi]+HALO_GAIN*exp(-.5*dh*dh)*PAL_HALO[pi]);
    float env=max(BUNDLE_FLOOR,smoothstep(BUNDLE_LO,BUNDLE_HI,vnoise1(xs/BUNDLE+float(k)*17.31)));
    int b=clamp(int(fract(floor(xs/BUNDLE)*.618034+float(k)*.31)*32.)+int(h5*3.)-1,0,31);
    float L=BAND_BASE+BAND_GAIN*bands[b].y;
    float flow=1.-FLOW_DEPTH*.5+FLOW_DEPTH*.5*sin(TAU*(y/FLOW_WAVELENGTH-FLOW_SPEED*tSec)+TAU*h6);
    float pulse=0.;
    for(int s=0;s<PULSE_SLOTS;s++){
     vec4 ps=pulses[s];float age=tSec-ps.y;
     if(age<0.||age>=PULSE_SECONDS)continue;
     if(tsHash(uint(n*7919+k),uint(ps.x))>=PULSE_FRACTION)continue;
     float dy=y-ps.z*(-PULSE_START+PULSE_SPEED*age);
     float len=dy*ps.z<0.?PULSE_LENGTH*3.:PULSE_LENGTH;
     pulse+=PULSE_GAIN*exp(-.5*(dy/len)*(dy/len))*(1.-age/PULSE_SECONDS);
    }
    sum+=fade*env*prof*L*flow*(1.+pulse);
   }
  }
 }
 frag=vec4((BG_COLOR+sum*PEAK*(1.+KICK_GAIN*kick))*exposure,1.);
}`;
class WorldTesseractAnalyzer extends WorldBandAnalyzer {
  constructor() {
    super();this.id='g-tesseract';this.label='テッセラクト';
    this.statelessRender=true; // フレーム間のGPU履歴を持たない（設計 §1）。
    this.cameraFrom=new Float64Array(WORLD_TESSERACT_SHOT_COLUMNS);this.cameraTarget=new Float64Array(WORLD_TESSERACT_SHOT_COLUMNS);this.cameraShot=new Float64Array(WORLD_TESSERACT_SHOT_COLUMNS);
    // シェーダーへ渡すカメラ位置と基底、高域パルスのスロット（serial、t0、dir、未使用）。毎フレーム再利用し、確保しない。
    this.camPos=new Float32Array(3);this.camForward=new Float32Array(3);this.camRight=new Float32Array(3);this.camUp=new Float32Array(3);
    this.pulses=new Float32Array(WORLD_TESSERACT.PULSE_SLOTS*4);
    this.reset();
  }
  reset() {
    super.reset();if(!this.camPos)return;
    this.cameraFrom.fill(0);this.cameraTarget.fill(0);this.cameraShot.fill(0);
    this.camPos.fill(0);this.camForward.fill(0);this.camRight.fill(0);this.camUp.fill(0);
    this.pulses.fill(0);for(let i=0;i<WORLD_TESSERACT.PULSE_SLOTS;i++)this.pulses[i*4+1]=-100;
    this.section=null;this.sectionChangedSec=0;this.camX=0;this.camZ=0;this.speedFactor=1;
    this.lastKick=-100;this.pulseSerial=0;this.lastEventSec=-1;this.seed=0;this.kick=0;this.exposure=0;
  }
  init(gpu) {
    super.init(gpu);this.program=gpu.program(WORLD_TESSERACT_FRAGMENT);
    for(const name of ['camPos','camForward','camRight','camUp','projection','resolution','tSec','focus','kick','exposure','seed'])
      this[name+'Loc']=gpu.texture(this.program,name);
    this.bandLoc=gpu.texture(this.program,'bands[0]');this.pulsesLoc=gpu.texture(this.program,'pulses[0]');
  }
  step(input) {
    this.update(input);
    const c=WORLD_TESSERACT,t=input.tSec,s=input.engine.score.sections[input.engine.sectionIndex];
    this.seed=input.engine.score.seed;
    const p=Math.max(0,Math.min(1,(t-s.startSec)/Math.max(.001,s.endSec-s.startSec))),progress=p*p*(3-2*p);
    const row=WORLD_TESSERACT_CAMERA[s.kind],target=this.cameraTarget,shot=this.cameraShot,n=WORLD_TESSERACT_SHOT_COLUMNS;
    for(let i=0;i<n;i++)target[i]=row[i*2]+(row[i*2+1]-row[i*2])*progress;
    // 初回は表の構図。再登場する奇数variationだけ「反転」列の符号を反転する。
    if(s.variation>=3&&s.variation%2===1)for(let i=0;i<WORLD_TESSERACT_FLIP_COLUMNS.length;i++)target[WORLD_TESSERACT_FLIP_COLUMNS[i]]*=-1;
    for(let i=2;i<=5;i++)target[i]*=Math.PI/180;
    if(s!==this.section){
      if(this.section)this.cameraFrom.set(shot);else this.cameraFrom.set(target);
      this.sectionChangedSec=this.section?s.startSec:s.startSec-c.CAMERA_EASE_SECONDS;this.section=s;
    }
    const x=Math.max(0,Math.min(1,(t-this.sectionChangedSec)/c.CAMERA_EASE_SECONDS)),ease=x*x*(3-2*x);
    for(let i=0;i<n;i++)shot[i]=this.cameraFrom[i]+(target[i]-this.cameraFrom[i])*ease;
    const loud=input.features.loudness.level;
    this.speedFactor=Math.max(c.SPEED_MIN,Math.min(c.SPEED_MAX,1+c.SPEED_LOUD_GAIN*(loud-.5)));
    const move=this.speedFactor*input.song.motionSpeed*input.dt;
    this.camX+=shot[0]*move;this.camZ+=shot[1]*move;
    this._updateCameraBasis();
    // 同じ時刻の再呼び出しでは二重に消費しない。
    if(t!==this.lastEventSec){
      const flags=input.features.onset.flags;
      if(flags&1)this.lastKick=t;
      if(flags&4){
        const serial=++this.pulseSerial,o=(serial%c.PULSE_SLOTS)*4;
        this.pulses[o]=serial;this.pulses[o+1]=t;this.pulses[o+2]=worldAttractorHash(0,serial,this.seed)<.5?1:-1;this.pulses[o+3]=0;
      }
      this.lastEventSec=t;
    }
    this.kick=Math.exp(-Math.max(0,t-this.lastKick)/c.KICK_SECONDS);
    this.exposure=c.EXPOSURE_BASE*(c.EXPOSURE_FLOOR+c.EXPOSURE_GAIN*loud);
  }
  // §2.3 の基底（yaw ψ、pitch θ、roll φ）。配列は再利用する。
  _updateCameraBasis() {
    const yaw=this.cameraShot[2],pitch=this.cameraShot[3],roll=this.cameraShot[4];
    const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch),sr=Math.sin(roll),cr=Math.cos(roll);
    const fx=sy*cp,fy=sp,fz=cy*cp,rx=cy,ry=0,rz=-sy;
    const ux=fy*rz-fz*ry,uy=fz*rx-fx*rz,uz=fx*ry-fy*rx;
    this.camPos[0]=this.camX;this.camPos[1]=0;this.camPos[2]=this.camZ;
    this.camForward[0]=fx;this.camForward[1]=fy;this.camForward[2]=fz;
    this.camRight[0]=cr*rx+sr*ux;this.camRight[1]=cr*ry+sr*uy;this.camRight[2]=cr*rz+sr*uz;
    this.camUp[0]=-sr*rx+cr*ux;this.camUp[1]=-sr*ry+cr*uy;this.camUp[2]=-sr*rz+cr*uz;
  }
  render(input) {
    const g=this.gpu,gl=g.gl,w=input.target.width,h=input.target.height;
    g.bind(this.program,input.target);
    gl.uniform4fv(this.bandLoc,this.bandUniforms);gl.uniform4fv(this.pulsesLoc,this.pulses);
    gl.uniform3fv(this.camPosLoc,this.camPos);gl.uniform3fv(this.camForwardLoc,this.camForward);gl.uniform3fv(this.camRightLoc,this.camRight);gl.uniform3fv(this.camUpLoc,this.camUp);
    gl.uniform2f(this.projectionLoc,w/h,Math.tan(this.cameraShot[5]*.5));gl.uniform2f(this.resolutionLoc,w,h);
    gl.uniform1f(this.tSecLoc,input.tSec);gl.uniform1f(this.focusLoc,this.cameraShot[6]);gl.uniform1f(this.kickLoc,this.kick);
    gl.uniform1f(this.exposureLoc,this.exposure);gl.uniform1ui(this.seedLoc,this.seed);
    g.draw();
  }
}
if(typeof module!=='undefined'&&module.exports){module.exports={WorldTesseractAnalyzer,WORLD_TESSERACT,WORLD_TESSERACT_PALETTE,WORLD_TESSERACT_CAMERA};}
