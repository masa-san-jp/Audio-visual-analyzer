// 目的 — h²測地線・降着円盤・音楽イベントとレンズ星空を描く — doc/20261004-design-gargantua-v1.md §1〜5
const WORLD_GARGANTUA = Object.freeze({
  MAX_STEPS: 180, MAX_CROSSINGS: 3, Rs: 1, FOV: 38, HALF_RESOLUTION: .5,
  STEP_SCALE: .045, STEP_MIN: .015, STEP_MAX: 1.6, GRAVITY: 1.5, ESCAPE_RADIUS: 60,
  DISK_INNER: 3, DISK_OUTER: 14, KEPLER_SPEED: .45, KEPLER_POWER: -1.5,
  TEMPERATURE_POWER: -.75, PALETTE_TINT: .2, PALETTE_GAIN: 1.6,
  FILAMENT_RADIAL: 6, FILAMENT_ANGULAR: 3, FILAMENT_SCALE: 2.2, FILAMENT_SHEAR: .8,
  FILAMENT_TIME: .05, FBM_OCTAVES: 4, FILAMENT_POWER: 2.2, FILAMENT_GAIN: 1.6, FILAMENT_BASE: .25,
  INNER_FADE: 3.25, OUTER_FADE: 10.5, VELOCITY_SCALE: .5, BEAM_POWER: 2.2, BEAM_MIN: .45, BEAM_MAX: 2.2,
  DISK_BASE: .35, DISK_GAIN: 1.4, DISK_POWER: 2, OPACITY_BASE: .55, OPACITY_FILAMENT: .35, OPACITY_MAX: .95,
  BAND_COUNT: 32, BAND_BLEND: .15, MUSIC_BASE: .45, MUSIC_GAIN: 2.2,
  KICK_SECONDS: .11, KICK_RADIUS: 6.5, KICK_GAIN: 1.8,
  HOTSPOT_COUNT: 12, HOTSPOT_INNER: 3.5, HOTSPOT_OUTER: 8, HOTSPOT_SECONDS: 6, HOTSPOT_RADIUS: .18, HOTSPOT_HDR: 6,
  EXPOSURE_BASE: .85, EXPOSURE_GAIN: .3, CAMERA_EASE_SECONDS: 4,
  SECOND_DROP_DIST: 13, SECOND_DROP_SPEED: .09, SECOND_DROP_GAIN: 1.5,
  STAR_CELLS: 180, STAR_PROBABILITY: .03, STAR_POWER: 18, STAR_HDR: 6, STAR_RADIUS_PX: .6,
  TWINKLE_BASE: .75, TWINKLE_GAIN: .25, TWINKLE_ONSET: 1.7, SPIKE_FRACTION: .005, SPIKE_LENGTH_PX: 6,
  MILKY_WAY_MAX: .015, MILKY_WAY_TINT: .4, BACKGROUND_MAX: .04,
  BLOOM_THRESHOLD: 1, BLOOM_STRENGTH: .35
});
// 各行はdist始/終、inc始/終、周回速度始/終、円盤係数始/終。incは度。
const WORLD_GARGANTUA_CAMERA = Object.freeze({
  intro: [40,26,4,4,.010,.010,.6,.6], build: [26,18,4,9,.020,.05,.8,1.1],
  drop: [15,15,7,7,.07,.07,1.35,1.35], break: [30,30,14,14,.012,.012,.7,.7],
  outro: [26,60,4,4,.008,.008,.9,0], main: [22,22,6,6,.03,.03,1,1]
});
const WORLD_GARGANTUA_BLACKBODY = [[.33,1,.28,.05],[.50,1,.52,.18],[.70,1,.78,.48],[.85,1,.92,.80],[1,.95,.97,1]];
// worldHash(prefix + serial, seed)と同じFNV列を数値で作り、描画経路の文字列確保を避ける。
function worldGargantuaEventHash(prefix, serial, seed) {
  let h = worldHash(prefix, seed), divisor = 1;
  while (divisor <= serial / 10) divisor *= 10;
  do {
    h = Math.imul(h ^ (48 + Math.floor(serial / divisor) % 10), 16777619) >>> 0;
    divisor = Math.floor(divisor / 10);
  } while (divisor);
  return h;
}
// SSOTの定数をJSとGLSLで共有する。文字列生成は読込時だけ。
const WORLD_GARGANTUA_GLSL = Object.entries(WORLD_GARGANTUA).map(([name,value]) =>
  `const ${['MAX_STEPS','MAX_CROSSINGS','FBM_OCTAVES','BAND_COUNT','HOTSPOT_COUNT'].includes(name)?'int':'float'} ${name} = ${['MAX_STEPS','MAX_CROSSINGS','FBM_OCTAVES','BAND_COUNT','HOTSPOT_COUNT'].includes(name)?value:Number(value).toFixed(8)};`).join('\n');
const WORLD_GARGANTUA_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_GARGANTUA_GLSL}
in vec2 vUv;
uniform vec4 bands[32];
uniform vec3 primary, secondary;
uniform vec4 camera; // dist、inc(rad)、azim、円盤係数
uniform vec4 music; // キック包絡、高域位相、BPM速度、時刻
uniform vec4 hotspots[12]; // 半径、初期角度、誕生時刻、未使用
uniform vec2 outputResolution;
out vec4 frag;
const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453123);}
float gargantuaNoise3(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){float n=0.,a=.5;for(int i=0;i<FBM_OCTAVES;i++){n+=gargantuaNoise3(p)*a;p=p*2.+vec3(7.1,3.7,1.9);a*=.5;}return n;}
vec3 blackbodyRamp(float T){
 ${WORLD_GARGANTUA_BLACKBODY.slice(0,-1).map((row,i)=>{const next=WORLD_GARGANTUA_BLACKBODY[i+1];return `if(T<=${next[0].toFixed(2)})return mix(vec3(${row.slice(1).map(v=>v.toFixed(2))}),vec3(${next.slice(1).map(v=>v.toFixed(2))}),clamp((T-${row[0].toFixed(2)})/${(next[0]-row[0]).toFixed(2)},0.,1.));`;}).join('\n')}
 return vec3(${WORLD_GARGANTUA_BLACKBODY[WORLD_GARGANTUA_BLACKBODY.length-1].slice(1).map(v=>v.toFixed(2))});
}
float musicGain(float rd){
 float x=(rd-DISK_INNER)/(DISK_OUTER-DISK_INNER)*float(BAND_COUNT);
 int k=clamp(int(floor(x)),0,BAND_COUNT-1);float f=fract(x),L=bands[BAND_COUNT-1-k].x;
 // 境界の前後7.5%ずつ（合計15%）だけ隣接帯と補間。
 if(f<BAND_BLEND*.5&&k>0)L=mix(bands[BAND_COUNT-k].x,L,.5+.5*smoothstep(0.,BAND_BLEND*.5,f));
 if(f>1.-BAND_BLEND*.5&&k<BAND_COUNT-1)L=mix(L,bands[BAND_COUNT-2-k].x,.5*smoothstep(1.-BAND_BLEND*.5,1.,f));
 float gain=MUSIC_BASE+MUSIC_GAIN*L;
 // 逆順smoothstepはGLSL未定義なので、同じ下降曲線を正順で表す。
 if(rd<KICK_RADIUS)gain*=1.+KICK_GAIN*music.x*(1.-smoothstep(DISK_INNER,KICK_RADIUS,rd));
 return gain;
}
vec4 diskSample(vec3 hit,vec3 viewDir){
 float rd=length(hit.xz),phi=atan(hit.z,hit.x);
 float omega=KEPLER_SPEED*pow(rd/DISK_INNER,KEPLER_POWER)*music.z,rotated=phi-omega*music.w;
 vec3 base=blackbodyRamp(pow(rd/DISK_INNER,TEMPERATURE_POWER));
 vec3 tint=mix(base,base*primary*PALETTE_GAIN,PALETTE_TINT);
 vec2 q=vec2(log(rd)*FILAMENT_RADIAL,rotated*FILAMENT_ANGULAR);
 float turb=fbm(vec3(q.x*FILAMENT_SCALE,q.y+q.x*FILAMENT_SHEAR,music.w*FILAMENT_TIME));
 float fil=pow(turb,FILAMENT_POWER)*FILAMENT_GAIN+FILAMENT_BASE;
 float env=smoothstep(DISK_INNER,INNER_FADE,rd)*(1.-smoothstep(OUTER_FADE,DISK_OUTER,rd));
 vec3 tangent=vec3(-sin(phi),0.,cos(phi));
 float v=sqrt(VELOCITY_SCALE/rd),beam=clamp(pow(1./(1.-v*dot(tangent,-viewDir)),BEAM_POWER),BEAM_MIN,BEAM_MAX);
 float I=env*fil*beam*(DISK_BASE+DISK_GAIN*pow(DISK_INNER/rd,DISK_POWER));
 vec3 col=tint*I*musicGain(rd);
 for(int i=0;i<HOTSPOT_COUNT;i++){
  vec4 spot=hotspots[i];float age=music.w-spot.z;
  if(age<0.||age>=HOTSPOT_SECONDS)continue;
  float a=spot.y+KEPLER_SPEED*pow(spot.x/DISK_INNER,KEPLER_POWER)*music.z*age;
  vec2 center=spot.x*vec2(cos(a),sin(a));float d2=dot(hit.xz-center,hit.xz-center);
  col+=tint*HOTSPOT_HDR*exp(-d2/(2.*HOTSPOT_RADIUS*HOTSPOT_RADIUS))*(1.-age/HOTSPOT_SECONDS);
 }
 return vec4(col*camera.w,clamp(env*(OPACITY_BASE+fil*OPACITY_FILAMENT),0.,OPACITY_MAX));
}
vec3 starfield(vec3 d){
 d=normalize(d);vec3 cell=floor(d*STAR_CELLS),stars=vec3(0);
 vec3 right=normalize(cross(abs(d.y)<.99?vec3(0,1,0):vec3(1,0,0),d)),up=cross(d,right);
 float pixel=2.*tan(radians(FOV)*.5)/outputResolution.y;
 // 近隣セルも引き、セル境界と6画素の光条の切れ目を防ぐ。
 for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec3 c=cell+vec3(x,y,z);if(hash3(c)>=STAR_PROBABILITY)continue;
  float h=hash3(c+19.7),phase=hash3(c+37.1)*TAU;
  vec3 center=normalize((c+vec3(hash3(c+2.3),hash3(c+5.9),hash3(c+8.1)))/STAR_CELLS);
  vec3 delta=center-d;vec2 p=vec2(dot(delta,right),dot(delta,up))/pixel;
  float point=exp(-dot(p,p)/(2.*STAR_RADIUS_PX*STAR_RADIUS_PX));
  float spikes=0.;if(h>=1.-SPIKE_FRACTION){
   spikes=exp(-min(p.x*p.x,p.y*p.y)/(2.*.12*.12))*max(0.,1.-max(abs(p.x),abs(p.y))/SPIKE_LENGTH_PX);
  }
  float twinkle=TWINKLE_BASE+TWINKLE_GAIN*sin(phase+music.w*.25+music.y*TWINKLE_ONSET);
  vec3 color=mix(vec3(.72,.84,1.),vec3(1.,.72,.44),hash3(c+53.2));
  stars+=color*pow(h,STAR_POWER)*STAR_HDR*twinkle*(point+spikes);
 }
 float cloud=(fbm(d*3.)+fbm(d*7.+vec3(9.)))*.5;
 float belt=exp(-pow(dot(d,normalize(vec3(.2,1.,.35)))/.18,2.));
 vec3 milk=secondary*MILKY_WAY_TINT*min(MILKY_WAY_MAX,cloud*belt*MILKY_WAY_MAX);
 return min(vec3(BACKGROUND_MAX),stars+milk);
}
void main(){
 vec3 camPos=camera.x*vec3(cos(camera.y)*cos(camera.z),sin(camera.y),cos(camera.y)*sin(camera.z));
 vec3 forward=normalize(-camPos),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward);
 vec2 p=(vUv*2.-1.)*vec2(outputResolution.x/outputResolution.y,1.)*tan(radians(FOV)*.5);
 vec3 pos=camPos,dir=normalize(forward+right*p.x+up*p.y),angular=cross(pos,dir);
 float h2=dot(angular,angular),alpha=1.,directRadius=0.;vec3 col=vec3(0);int crossings=0,planeCrossings=0;
 bool escaped=false;
 for(int i=0;i<MAX_STEPS;i++){
  float r=length(pos);if(r<Rs)break;
  float dt=clamp(r*STEP_SCALE,STEP_MIN,STEP_MAX);
  vec3 acc=-GRAVITY*h2*pos/pow(r,5.),prev=pos;
  dir+=acc*dt;pos+=dir*dt;
  if(sign(prev.y)!=sign(pos.y)){
   planeCrossings++;
   vec3 hit=mix(prev,pos,prev.y/(prev.y-pos.y));float rd=length(hit.xz);
   if(rd>=DISK_INNER&&rd<=DISK_OUTER&&crossings<MAX_CROSSINGS){
    // alphaに直接像の半径を保持する（postはRGBだけを使う）。G-1の領域判定用。
    if(planeCrossings==1&&crossings==0&&dot(hit.xz,camPos.xz)>0.&&dot(hit,dir)<0.)directRadius=rd;
    vec4 sampleValue=diskSample(hit,normalize(dir));
    col+=alpha*sampleValue.rgb*sampleValue.a;alpha*=1.-sampleValue.a;crossings++;
   }
  }
  if(r>ESCAPE_RADIUS){escaped=true;break;}
 }
 if(escaped)col+=alpha*starfield(dir);
 // 地平面の放射は0。手前の円盤から既に受け取った光は前方合成どおり保持する。
 if(crossings!=1)directRadius=0.;
 frag=vec4(col,directRadius);
}`;
const WORLD_GARGANTUA_UPSAMPLE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D source;
out vec4 frag;
void main(){frag=texture(source,vUv);}`;
class WorldGargantuaAnalyzer extends WorldBandAnalyzer {
  constructor() {
    super();this.id='g-gargantua';this.label='ブラックホール';
    this.camera=new Float32Array(4);this.cameraFrom=new Float64Array(4);this.cameraTarget=new Float64Array(4);
    this.music=new Float32Array(4);this.hotspots=new Float32Array(WORLD_GARGANTUA.HOTSPOT_COUNT*4);
    this.reset();
  }
  reset() {
    super.reset();if(!this.camera)return;
    this.camera.fill(0);this.cameraFrom.fill(0);this.cameraTarget.fill(0);this.music.fill(0);
    this.hotspots.fill(0);for(let i=0;i<WORLD_GARGANTUA.HOTSPOT_COUNT;i++)this.hotspots[i*4+2]=-100;
    this.section=null;this.sectionChangedSec=0;this.azim=0;this.orbitSpeed=0;this.hotspotSerial=0;this.highOnsetPhase=0;
    this.lastKick=-100;this.lastEventSec=-1;this.exposureMultiplier=WORLD_GARGANTUA.EXPOSURE_BASE;
  }
  init(gpu) {
    super.init(gpu);this.program=gpu.program(WORLD_GARGANTUA_FRAGMENT);
    this.bandLoc=gpu.texture(this.program,'bands[0]');this.primaryLoc=gpu.texture(this.program,'primary');this.secondaryLoc=gpu.texture(this.program,'secondary');
    this.cameraLoc=gpu.texture(this.program,'camera');this.musicLoc=gpu.texture(this.program,'music');
    this.hotspotLoc=gpu.texture(this.program,'hotspots[0]');this.outputLoc=gpu.texture(this.program,'outputResolution');
    this.upsample=gpu.program(WORLD_GARGANTUA_UPSAMPLE_FRAGMENT);this.sourceLoc=gpu.texture(this.upsample,'source');
    this.resize(gpu.gl.canvas.width,gpu.gl.canvas.height);
  }
  resize(w,h) {
    const width=Math.max(1,Math.ceil(w*WORLD_GARGANTUA.HALF_RESOLUTION)),height=Math.max(1,Math.ceil(h*WORLD_GARGANTUA.HALF_RESOLUTION));
    if(this.half&&this.half.width===width&&this.half.height===height)return;
    if(this.half)this.gpu.releaseTarget(this.half);this.half=this.gpu.target(width,height);
  }
  step(input) {
    this.update(input);
    // paletteは主音クロマの固定役割を使う。既存engineのdrop反転／色モーフは持ち込まない。
    this.colors.set(input.song.palette.primary,0);this.colors.set(input.song.palette.secondary,3);
    const s=input.engine.score.sections[input.engine.sectionIndex],t=input.tSec,c=WORLD_GARGANTUA;
    const p=Math.max(0,Math.min(1,(t-s.startSec)/Math.max(.001,s.endSec-s.startSec)));
    const row=WORLD_GARGANTUA_CAMERA[s.kind],target=this.cameraTarget;
    for(let i=0;i<4;i++)target[i]=row[i*2]+(row[i*2+1]-row[i*2])*p;
    target[1]*=Math.PI/180;
    if(s.kind==='drop'&&s.variation>=2){target[0]=c.SECOND_DROP_DIST;target[2]=c.SECOND_DROP_SPEED;target[3]*=c.SECOND_DROP_GAIN;}
    if(s!==this.section){
      if(this.section){this.cameraFrom[0]=this.camera[0];this.cameraFrom[1]=this.camera[1];this.cameraFrom[2]=this.orbitSpeed;this.cameraFrom[3]=this.camera[3];}
      else this.cameraFrom.set(target);
      this.sectionChangedSec=this.section?s.startSec:s.startSec-c.CAMERA_EASE_SECONDS;this.section=s;
    }
    const x=Math.max(0,Math.min(1,(t-this.sectionChangedSec)/c.CAMERA_EASE_SECONDS)),ease=x*x*(3-2*x);
    this.camera[0]=this.cameraFrom[0]+(target[0]-this.cameraFrom[0])*ease;
    this.camera[1]=this.cameraFrom[1]+(target[1]-this.cameraFrom[1])*ease;
    this.orbitSpeed=this.cameraFrom[2]+(target[2]-this.cameraFrom[2])*ease;
    this.camera[3]=this.cameraFrom[3]+(target[3]-this.cameraFrom[3])*ease;
    this.azim+=this.orbitSpeed*input.dt;this.camera[2]=this.azim;
    // MFSは未消費ホップを集約し、同じホップの再取得では0を返す。
    // 連続フレームの同じbitも別イベント。再描画の同時刻だけ二重消費を防ぐ。
    const flags=input.features.onset.flags;
    if(t!==this.lastEventSec){
      if(flags&1)this.lastKick=t;
      if(flags&4){
        const serial=this.hotspotSerial++,o=(serial%c.HOTSPOT_COUNT)*4;
        const h=worldGargantuaEventHash('gargantua:',serial,input.engine.seed),h2=worldGargantuaEventHash('gargantua-angle:',serial,input.engine.seed);
        this.hotspots[o]=c.HOTSPOT_INNER+(c.HOTSPOT_OUTER-c.HOTSPOT_INNER)*h/4294967296;
        this.hotspots[o+1]=h2/4294967296*Math.PI*2;this.hotspots[o+2]=t;this.highOnsetPhase++;
      }
      this.lastEventSec=t;
    }
    this.music[0]=Math.exp(-Math.max(0,t-this.lastKick)/c.KICK_SECONDS);this.music[1]=this.highOnsetPhase;
    this.music[2]=input.song.motionSpeed;this.music[3]=t;
    this.exposureMultiplier=c.EXPOSURE_BASE+c.EXPOSURE_GAIN*input.features.loudness.level;
  }
  render(input) {
    const g=this.gpu,gl=g.gl;
    g.bind(this.program,this.half);gl.uniform4fv(this.bandLoc,this.bandUniforms);
    gl.uniform3fv(this.primaryLoc,input.song.palette.primary);gl.uniform3fv(this.secondaryLoc,input.song.palette.secondary);
    gl.uniform4fv(this.cameraLoc,this.camera);gl.uniform4fv(this.musicLoc,this.music);gl.uniform4fv(this.hotspotLoc,this.hotspots);
    gl.uniform2f(this.outputLoc,input.target.width,input.target.height);g.draw();
    g.bind(this.upsample,input.target);g.sampler(this.sourceLoc,0,this.half);g.draw();
  }
}
if(typeof module!=='undefined'&&module.exports){module.exports={WorldGargantuaAnalyzer,WORLD_GARGANTUA,WORLD_GARGANTUA_CAMERA,WORLD_GARGANTUA_BLACKBODY,worldGargantuaEventHash};}
