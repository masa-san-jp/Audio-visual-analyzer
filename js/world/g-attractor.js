// 目的 — 固定Clifford写像の膜・粒子の再組み立て・音楽の光を描く — doc/20261008-design-attractor-v1.md §1〜8
const WORLD_ATTRACTOR = Object.freeze({
  PARTICLE_W: 2048, PARTICLE_H: 768, PARTICLE_COUNT: 1572864, WARM_ITERS: 40,
  DECAY: .90, Z_SCALE: .9, SHAPE_SCALE: 1.0, BAND_COUNT: 32,
  BAND_BASE: .35, BAND_GAIN: 1.6, PALETTE_TINT: .10, DEPTH_REF: 3.2,
  EXPOSURE_BASE: 2.5, EXPOSURE_FLOOR: .75, EXPOSURE_GAIN: .5,
  TRANS_SECONDS: 1.8, TRANS_STAGGER: .5, TRANS_FLIGHT: 1.1, SWIRL: 1.6,
  KICK_BREATH: .06, KICK_SECONDS: .18,
  GLINT_FRACTION: .004, GLINT_GAIN: 10, GLINT_SECONDS: .25,
  WARM_FRAMES: 90, CAMERA_EASE_SECONDS: 4,
  ORBIT_LOUD_GAIN: .8, ORBIT_MIN: .5, ORBIT_MAX: 1.6,
  BLOOM_THRESHOLD: .6, BLOOM_STRENGTH: .8, GLINT_EPS: .01
});
// 色の回転用 cos(2.1)、sin(2.1)。頂点シェーダーでは定数として使い、三角関数を呼ばない。
const WORLD_ATTRACTOR_COS2 = Math.cos(2.1), WORLD_ATTRACTOR_SIN2 = Math.sin(2.1);
const WORLD_ATTRACTOR_SHAPES = Object.freeze({
  L: Object.freeze([-2.0,-1.9,-1.2,2.0]), H: Object.freeze([-1.24,-1.25,-1.81,-1.91]),
  J: Object.freeze([-1.9,1.9,.9,.5]), F: Object.freeze([-1.8,-2.0,-.5,-.9]),
  D: Object.freeze([1.5,-1.8,1.6,.9]), A: Object.freeze([-1.4,1.6,1.0,.7]),
  Cc: Object.freeze([1.7,1.7,.6,1.2])
});
// dist、pitch（度）、yaw速度、roll（度）、fov（度）の始点/終点。
const WORLD_ATTRACTOR_CAMERA = Object.freeze({
  intro: Object.freeze([5.2,4.0,12,18,.05,.05,0,0,34,34]),
  build: Object.freeze([4.6,3.6,28,6,.09,.09,0,-6,34,34]),
  drop: Object.freeze([3.4,3.1,10,14,.24,.24,8,8,38,38]),
  break: Object.freeze([4.8,4.8,58,64,.03,.03,0,0,30,30]),
  main: Object.freeze([3.9,3.9,16,16,.11,.11,-4,-4,34,34]),
  outro: Object.freeze([4.2,6.5,18,30,.04,.04,0,0,34,34])
});
function worldAttractorShape(kind, variation) {
  switch(kind) {
    case 'build': return 'J';
    case 'drop': return variation>=3 && variation%2===1 ? 'F' : 'H';
    case 'break': return 'A';
    case 'main': return variation>=3 && variation%2===1 ? 'Cc' : 'D';
    default: return 'L';
  }
}
// uintの混合をCPU/GLSLで一致させる。曲seedと粒子番号、イベント通番だけに依存する。
function worldAttractorHash(i, serial, seed) {
  let h=(i ^ Math.imul(serial,0x9e3779b9) ^ seed)>>>0;
  h=Math.imul(h^(h>>>16),0x7feb352d)>>>0;
  h=Math.imul(h^(h>>>15),0x846ca68b)>>>0;
  return ((h^(h>>>16))>>>8)/16777216;
}
function worldAttractorFlight(age, delayHash) {
  const p=Math.max(0,Math.min(1,(age-delayHash*WORLD_ATTRACTOR.TRANS_STAGGER)/WORLD_ATTRACTOR.TRANS_FLIGHT));
  return p*p*(3-2*p);
}
function worldAttractorPointGain(w,h) {
  return (w*h*.08)/(WORLD_ATTRACTOR.PARTICLE_COUNT/(1-WORLD_ATTRACTOR.DECAY));
}
const WORLD_ATTRACTOR_GLSL = Object.entries(WORLD_ATTRACTOR).map(([name,value])=>
  `const ${['PARTICLE_W','PARTICLE_H','PARTICLE_COUNT','WARM_ITERS','BAND_COUNT','WARM_FRAMES'].includes(name)?'int':'float'} ${name} = ${['PARTICLE_W','PARTICLE_H','PARTICLE_COUNT','WARM_ITERS','BAND_COUNT','WARM_FRAMES'].includes(name)?value:value.toFixed(8)};`).join('\n');
const WORLD_ATTRACTOR_HASH_GLSL = `
uniform uint seed;
float particleHash(uint i,uint serial){
 uint h=i^(serial*0x9e3779b9u)^seed;
 h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;
 return float((h^(h>>16u))>>8u)*(1./16777216.);
}
vec2 initialPosition(uint i){return (vec2(particleHash(i,1u),particleHash(i,2u))*2.-1.)*.5;}
`;
const WORLD_ATTRACTOR_UPDATE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_ATTRACTOR_GLSL}
${WORLD_ATTRACTOR_HASH_GLSL}
uniform sampler2D state;
uniform vec4 shapeA;
uniform int initialize;
out vec4 frag;
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy);uint i=uint(p.y*PARTICLE_W+p.x);
 if(initialize==1){vec2 xy=initialPosition(i);frag=vec4(xy,xy);return;}
 vec2 xy=texelFetch(state,p,0).xy;
 if(initialize==2){frag=vec4(xy,xy);return;}
 if(any(greaterThan(abs(xy),vec2(4.))))xy=initialPosition(i);
 vec2 next=vec2(sin(shapeA.x*xy.y)+shapeA.z*cos(shapeA.x*xy.x),sin(shapeA.y*xy.x)+shapeA.w*cos(shapeA.y*xy.y));
 frag=vec4(next,xy);
}`;
const WORLD_ATTRACTOR_POINT_VERTEX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_ATTRACTOR_GLSL}
${WORLD_ATTRACTOR_HASH_GLSL}
uniform sampler2D stateA,stateB;
uniform vec4 shapeA,shapeB,bands[32];
uniform vec3 primary;
uniform vec3 camPos,camForward,camRight,camUp; // CPUで計算したカメラ位置と基底（rollを含む）
uniform vec2 projection; // aspect、tan(fov/2)
uniform vec4 music; // キック包絡、グリント包絡、変身経過秒、変身中
uniform uint glintSerial;
uniform float POINT_GAIN;
out vec3 pointColor;
const float PI=3.141592653589793;
const float COS2=${WORLD_ATTRACTOR_COS2.toFixed(10)},SIN2=${WORLD_ATTRACTOR_SIN2.toFixed(10)};
vec3 position(vec4 s,vec4 shape){return vec3(s.w/(1.+abs(shape.w)),s.z/(1.+abs(shape.z)),s.x/(1.+abs(shape.z))*Z_SCALE)*SHAPE_SCALE;}
vec3 color(vec4 s){
 vec2 v=vec2(s.x-s.z,s.y-s.w);float L=length(v);vec2 n=L>1e-6?v/L:vec2(1,0);
 float ang=atan(v.y,v.x),u=fract((ang+PI)/(2.*PI));int k=int(u*float(BAND_COUNT));
 float w1=.5+.5*n.x,w2=.5+.5*dot(n,vec2(COS2,SIN2)),w3=.5+.5*dot(n,vec2(COS2,-SIN2));
 vec3 rgb=vec3(.55+.45*w1,.35+.4*w2+.1*w1,.12+.55*w3);
 return mix(rgb,rgb*primary*1.6,PALETTE_TINT)*(BAND_BASE+BAND_GAIN*bands[k].x);
}
void main(){
 uint i=uint(gl_VertexID);ivec2 uv=ivec2(gl_VertexID%PARTICLE_W,gl_VertexID/PARTICLE_W);
 vec4 a=texelFetch(stateA,uv,0);vec3 P=position(a,shapeA),rgb=color(a);
 if(music.w>.5){
  vec4 b=texelFetch(stateB,uv,0);
  float e=smoothstep(0.,1.,clamp((music.z-particleHash(i,0u)*TRANS_STAGGER)/TRANS_FLIGHT,0.,1.));
  P=mix(P,position(b,shapeB),e);rgb=mix(rgb,color(b),e);
  float angle=SWIRL*sin(PI*e);P=vec3(cos(angle)*P.x+sin(angle)*P.z,P.y,-sin(angle)*P.x+cos(angle)*P.z);
 }
 P*=1.+KICK_BREATH*music.x;
 vec3 relative=P-camPos;float zv=dot(relative,camForward);
 // 正のwで視錐台の外をクリップし、近側の特異点を画面へ戻さない。
 gl_Position=vec4(dot(relative,camRight)/(projection.x*projection.y),dot(relative,camUp)/projection.y,0.,zv);
 gl_PointSize=1.;
 float glint=1.;
 if(music.y>GLINT_EPS&&particleHash(i,glintSerial)<GLINT_FRACTION)glint=GLINT_GAIN*music.y;
 pointColor=rgb*clamp(DEPTH_REF/zv,.2,1.6)*POINT_GAIN*glint;
}`;
const WORLD_ATTRACTOR_POINT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 pointColor;
out vec4 frag;
void main(){frag=vec4(pointColor,0.);}`;
const WORLD_ATTRACTOR_DENSITY_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_ATTRACTOR_GLSL}
in vec2 vUv;
uniform sampler2D source;
out vec4 frag;
void main(){frag=texture(source,vUv)*DECAY;}`;
const WORLD_ATTRACTOR_TONE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D source;
uniform float EXPOSURE;
out vec4 frag;
void main(){frag=vec4(1.-exp(-texture(source,vUv).rgb*EXPOSURE),1.);}`;
class WorldAttractorAnalyzer extends WorldBandAnalyzer {
  constructor() {
    super();this.id='g-attractor';this.label='ストレンジアトラクター';this.warmFrames=WORLD_ATTRACTOR.WARM_FRAMES;this.particleCount=WORLD_ATTRACTOR.PARTICLE_COUNT;
    this.camera=new Float32Array(4);this.cameraFrom=new Float64Array(5);this.cameraTarget=new Float64Array(5);this.cameraShot=new Float64Array(5);
    this.music=new Float32Array(4);
    // 頂点シェーダーへ渡すカメラ位置と基底。毎フレーム再利用し、確保しない。
    this.camPos=new Float32Array(3);this.camForward=new Float32Array(3);this.camRight=new Float32Array(3);this.camUp=new Float32Array(3);
    this.reset();
  }
  reset() {
    super.reset();if(!this.camera)return;
    this.camera.fill(0);this.cameraFrom.fill(0);this.cameraTarget.fill(0);this.cameraShot.fill(0);this.music.fill(0);
    this.camPos.fill(0);this.camForward.fill(0);this.camRight.fill(0);this.camUp.fill(0);
    this.section=null;this.sectionChangedSec=0;this.yaw=0;this.shapeA=null;this.shapeB=null;this.transitionStart=-100;
    this.lastKick=-100;this.lastHigh=-100;this.glintSerial=0;this.lastEventSec=-1;this.seed=0;
    this.gpuNeedsInit=true;this.gpuNeedsB=false;this.dirty=true;this.exposure=0;
  }
  init(gpu) {
    super.init(gpu);
    this.updateProgram=gpu.program(WORLD_ATTRACTOR_UPDATE_FRAGMENT);
    this.updateStateLoc=gpu.texture(this.updateProgram,'state');this.updateShapeLoc=gpu.texture(this.updateProgram,'shapeA');
    this.initializeLoc=gpu.texture(this.updateProgram,'initialize');this.updateSeedLoc=gpu.texture(this.updateProgram,'seed');
    this.program=gpu.program(WORLD_ATTRACTOR_POINT_FRAGMENT,WORLD_ATTRACTOR_POINT_VERTEX);
    this.stateALoc=gpu.texture(this.program,'stateA');this.stateBLoc=gpu.texture(this.program,'stateB');
    this.shapeALoc=gpu.texture(this.program,'shapeA');this.shapeBLoc=gpu.texture(this.program,'shapeB');
    this.bandLoc=gpu.texture(this.program,'bands[0]');this.primaryLoc=gpu.texture(this.program,'primary');
    this.camPosLoc=gpu.texture(this.program,'camPos');this.camForwardLoc=gpu.texture(this.program,'camForward');
    this.camRightLoc=gpu.texture(this.program,'camRight');this.camUpLoc=gpu.texture(this.program,'camUp');this.projectionLoc=gpu.texture(this.program,'projection');
    this.musicLoc=gpu.texture(this.program,'music');this.seedLoc=gpu.texture(this.program,'seed');
    this.glintLoc=gpu.texture(this.program,'glintSerial');this.pointGainLoc=gpu.texture(this.program,'POINT_GAIN');
    this.decayProgram=gpu.program(WORLD_ATTRACTOR_DENSITY_FRAGMENT);this.decaySourceLoc=gpu.texture(this.decayProgram,'source');
    this.toneProgram=gpu.program(WORLD_ATTRACTOR_TONE_FRAGMENT);this.toneSourceLoc=gpu.texture(this.toneProgram,'source');
    this.exposureLoc=gpu.texture(this.toneProgram,'EXPOSURE');
    // A/B各2枚を初期化時に確保し、区間切替では保持した組を再利用する。
    this.stateA=gpu.pair(WORLD_ATTRACTOR.PARTICLE_W,WORLD_ATTRACTOR.PARTICLE_H,true);
    this.stateB=gpu.pair(WORLD_ATTRACTOR.PARTICLE_W,WORLD_ATTRACTOR.PARTICLE_H,true);
    this.resize(gpu.gl.canvas.width,gpu.gl.canvas.height);
  }
  resize(w,h) {
    if(this.density&&this.density.read.width===w&&this.density.read.height===h)return;
    if(this.density){this.gpu.releaseTarget(this.density.read);this.gpu.releaseTarget(this.density.write);}
    this.density=this.gpu.pair(w,h);this.pointGain=worldAttractorPointGain(w,h);this.dirty=true;
  }
  step(input) {
    this.update(input);
    const c=WORLD_ATTRACTOR,t=input.tSec,s=input.engine.score.sections[input.engine.sectionIndex];
    this.seed=input.engine.score.seed;
    if(this.shapeB&&t>=this.transitionStart+c.TRANS_SECONDS){
      this.shapeA=this.shapeB;this.shapeB=null;
      const pair=this.stateA;this.stateA=this.stateB;this.stateB=pair;
      // CPUだけで変身が完了した場合、次の描画窓で現在の形を初期化する。
      if(this.gpuNeedsB)this.gpuNeedsInit=true;
      this.gpuNeedsB=false;
    }
    const p=Math.max(0,Math.min(1,(t-s.startSec)/Math.max(.001,s.endSec-s.startSec))),progress=p*p*(3-2*p);
    const row=WORLD_ATTRACTOR_CAMERA[s.kind],target=this.cameraTarget,shot=this.cameraShot;
    for(let i=0;i<5;i++)target[i]=row[i*2]+(row[i*2+1]-row[i*2])*progress;
    if(s.variation%2===1){target[2]=-target[2];target[3]=-target[3];}
    target[1]*=Math.PI/180;target[3]*=Math.PI/180;target[4]*=Math.PI/180;
    if(s!==this.section){
      if(this.section)this.cameraFrom.set(shot);else this.cameraFrom.set(target);
      this.sectionChangedSec=this.section?s.startSec:s.startSec-c.CAMERA_EASE_SECONDS;this.section=s;
      const next=worldAttractorShape(s.kind,s.variation);
      if(!this.shapeA)this.shapeA=next;
      else if(next!==(this.shapeB||this.shapeA)){
        // 3秒未満の区間では進行中の宛先を旧形にして、次の再組み立てへ進む。
        if(this.shapeB){this.shapeA=this.shapeB;const pair=this.stateA;this.stateA=this.stateB;this.stateB=pair;if(this.gpuNeedsB)this.gpuNeedsInit=true;}
        this.shapeB=next;this.transitionStart=t;this.gpuNeedsB=true;
      }
    }
    const x=Math.max(0,Math.min(1,(t-this.sectionChangedSec)/c.CAMERA_EASE_SECONDS)),ease=x*x*(3-2*x);
    for(let i=0;i<5;i++)shot[i]=this.cameraFrom[i]+(target[i]-this.cameraFrom[i])*ease;
    this.yaw+=shot[2]*Math.max(c.ORBIT_MIN,Math.min(c.ORBIT_MAX,1+c.ORBIT_LOUD_GAIN*(input.features.loudness.level-.5)))*input.dt;
    this.camera[0]=shot[0];this.camera[1]=shot[1];this.camera[2]=this.yaw;this.camera[3]=shot[3];
    this._updateCameraBasis();
    if(t!==this.lastEventSec){
      const flags=input.features.onset.flags;
      if(flags&1)this.lastKick=t;
      if(flags&4){this.lastHigh=t;this.glintSerial++;}
      this.lastEventSec=t;
    }
    this.music[0]=Math.exp(-Math.max(0,t-this.lastKick)/c.KICK_SECONDS);
    this.music[1]=Math.exp(-Math.max(0,t-this.lastHigh)/c.GLINT_SECONDS);
    this.music[2]=t-this.transitionStart;this.music[3]=this.shapeB?1:0;
    this.exposure=c.EXPOSURE_BASE*(c.EXPOSURE_FLOOR+c.EXPOSURE_GAIN*input.features.loudness.level);
    this.dirty=true;
  }
  // 旧GLSLと同じ式でカメラ位置と前/右/上（roll適用済み）を計算する。配列は再利用する。
  _updateCameraBasis() {
    const dist=this.camera[0],pitch=this.camera[1],yaw=this.camera[2],roll=this.camera[3];
    const cp=Math.cos(pitch),cx=dist*cp*Math.cos(yaw),cy=dist*Math.sin(pitch),cz=dist*cp*Math.sin(yaw);
    const il=1/Math.hypot(cx,cy,cz),fx=-cx*il,fy=-cy*il,fz=-cz*il;
    // right=normalize(cross(forward,(0,1,0)))=normalize(-fz,0,fx)
    const ir=1/Math.hypot(fz,fx),rx=-fz*ir,ry=0,rz=fx*ir;
    const ux=ry*fz-rz*fy,uy=rz*fx-rx*fz,uz=rx*fy-ry*fx;
    const cr=Math.cos(roll),sr=Math.sin(roll);
    this.camPos[0]=cx;this.camPos[1]=cy;this.camPos[2]=cz;
    this.camForward[0]=fx;this.camForward[1]=fy;this.camForward[2]=fz;
    this.camRight[0]=cr*rx+sr*ux;this.camRight[1]=cr*ry+sr*uy;this.camRight[2]=cr*rz+sr*uz;
    this.camUp[0]=-sr*rx+cr*ux;this.camUp[1]=-sr*ry+cr*uy;this.camUp[2]=-sr*rz+cr*uz;
  }
  _updateState(pair,shape,initialize=0,source=pair.read) {
    const g=this.gpu,gl=g.gl;
    g.bind(this.updateProgram,pair.write);g.sampler(this.updateStateLoc,0,source);
    gl.uniform4fv(this.updateShapeLoc,WORLD_ATTRACTOR_SHAPES[shape]);gl.uniform1i(this.initializeLoc,initialize);
    gl.uniform1ui(this.updateSeedLoc,this.seed);g.draw();g.swap(pair);
  }
  _warmState(pair,shape,source=null) {
    this._updateState(pair,shape,source?2:1,source||pair.read);
    for(let i=0;i<WORLD_ATTRACTOR.WARM_ITERS;i++)this._updateState(pair,shape);
  }
  warmStart(tSec) {
    const g=this.gpu;
    this._warmState(this.stateA,this.shapeA);
    if(this.shapeB)this._warmState(this.stateB,this.shapeB);
    g.clearTarget(this.density.read);g.clearTarget(this.density.write);
    this.gpuNeedsInit=false;this.gpuNeedsB=false;this.dirty=true;
  }
  render(input) {
    const g=this.gpu,gl=g.gl;
    gl.disable(gl.BLEND);
    if(this.gpuNeedsInit)this.warmStart(input.tSec);
    if(this.gpuNeedsB){this._warmState(this.stateB,this.shapeB,this.stateA.read);this.gpuNeedsB=false;}
    if(this.dirty){
      this._updateState(this.stateA,this.shapeA);
      if(this.shapeB)this._updateState(this.stateB,this.shapeB);
      g.bind(this.decayProgram,this.density.write);g.sampler(this.decaySourceLoc,0,this.density.read);g.draw();g.swap(this.density);
      g.bind(this.program,this.density.read);g.sampler(this.stateALoc,0,this.stateA.read);g.sampler(this.stateBLoc,1,this.stateB.read);
      gl.uniform4fv(this.shapeALoc,WORLD_ATTRACTOR_SHAPES[this.shapeA]);gl.uniform4fv(this.shapeBLoc,WORLD_ATTRACTOR_SHAPES[this.shapeB||this.shapeA]);
      gl.uniform4fv(this.bandLoc,this.bandUniforms);gl.uniform3fv(this.primaryLoc,input.song.palette.primary);
      gl.uniform3fv(this.camPosLoc,this.camPos);gl.uniform3fv(this.camForwardLoc,this.camForward);gl.uniform3fv(this.camRightLoc,this.camRight);gl.uniform3fv(this.camUpLoc,this.camUp);gl.uniform2f(this.projectionLoc,input.target.width/input.target.height,Math.tan(this.cameraShot[4]*.5));
      gl.uniform4fv(this.musicLoc,this.music);gl.uniform1ui(this.seedLoc,this.seed);gl.uniform1ui(this.glintLoc,this.glintSerial);
      gl.uniform1f(this.pointGainLoc,this.pointGain);
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.drawArrays(gl.POINTS,0,WORLD_ATTRACTOR.PARTICLE_COUNT);gl.disable(gl.BLEND);
      this.dirty=false;
    }
    g.bind(this.toneProgram,input.target);g.sampler(this.toneSourceLoc,0,this.density.read);gl.uniform1f(this.exposureLoc,this.exposure);g.draw();
  }
}
if(typeof module!=='undefined'&&module.exports){module.exports={WorldAttractorAnalyzer,WORLD_ATTRACTOR,WORLD_ATTRACTOR_SHAPES,WORLD_ATTRACTOR_CAMERA,worldAttractorShape,worldAttractorHash,worldAttractorFlight,worldAttractorPointGain};}
