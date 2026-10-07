// 目的 — h²測地線・降着円盤・音楽イベントとレンズ星空を描く — doc/20261004-design-gargantua-v1.md §7・§10
const WORLD_GARGANTUA = Object.freeze({
  MAX_STEPS: 180, MAX_CROSSINGS: 3, Rs: 1, FOV: 22, HALF_RESOLUTION: .5,
  STEP_SCALE: .045, STEP_MIN: .015, STEP_MAX: 1.6, GRAVITY: 1.5, ESCAPE_RADIUS: 100,
  DISK_INNER: 3, DISK_OUTER: 20, BAND_OUTER: 14, KEPLER_SPEED: 1.35, KEPLER_POWER: -1.5,
  DISK_INNER_COLOR: Object.freeze([1.00,.90,.76]), DISK_OUTER_COLOR: Object.freeze([1.00,.52,.20]),
  COLOR_POWER: 1.3, PALETTE_TINT: .15, PALETTE_GAIN: 1.6,
  STREAK_RADIAL: 60, STREAK_ANGULAR: 3.0, STREAK_TIME: .03,
  FBM_OCTAVES: 4, FBM_FREQUENCY: 2.03, LOD_HEIGHT: 540, LOD_START: .6, LOD_END: 2,
  GRAZE_MIN: .05, TURN_START: 1.2, TURN_MAX_LOG: 6.3, NOISE_MEAN: .5,
  STREAK_FLOOR: .15, STREAK_LO: .30, STREAK_HI: .70, DISK_HDR: 3.0, INTENSITY_POWER: .8,
  INNER_FADE: 3.25, OUTER_FADE: 12, OPACITY_BASE: .45, OPACITY_STREAK: .5, OPACITY_MAX: .90,
  BAND_COUNT: 32, BAND_BLEND: .15, MUSIC_BASE: .45, MUSIC_GAIN: 2.2,
  KICK_SECONDS: .18, KICK_RADIUS: 6.5, KICK_REST: .40, KICK_GAIN: 3.5, KICK_BLOOM: .8,
  HOTSPOT_COUNT: 12, HOTSPOT_INNER: 3.5, HOTSPOT_OUTER: 8, HOTSPOT_SECONDS: 6, HOTSPOT_RADIUS: .18, HOTSPOT_HDR: 6,
  EXPOSURE_BASE: .85, EXPOSURE_GAIN: .3, CAMERA_EASE_SECONDS: 4,
  SECOND_DROP_INC: -6, SWAY_DEGREES: 1.5, SWAY_SPEED: .07,
  DROP_GRAVITY: 2.1, DROP_HORIZON: 1.18, DROP_DISK_INNER: 3.4, GRAVITY_EASE_IN: 1.2, GRAVITY_EASE_OUT: 2,
  RING_SAMPLE_MIN: 1.3, RING_SAMPLE_MAX: 3.2, SUBSAMPLE_NEAR: .125, SUBSAMPLE_FAR: .375,
  SECOND_DROP_DIST: 27, SECOND_DROP_SPEED: .09, SECOND_DROP_GAIN: 1.5,
  STAR_CELLS: 180, STAR_PROBABILITY: .03, STAR_POWER: 18, STAR_HDR: 6,
  STAR_RADIUS_PX: .6, STAR_REFERENCE_HEIGHT: 1080,
  TWINKLE_BASE: .75, TWINKLE_GAIN: .25, TWINKLE_ONSET: 1.7,
  MILKY_WAY_MAX: .035, MILKY_WAY_OCTAVES: 5, MILKY_WAY_WIDTH: .18, MILKY_WAY_TINT: .4, BACKGROUND_MAX: .04,
  BLOOM_THRESHOLD: .55, BLOOM_STRENGTH: .90, VEIL_GAIN: .10
});
// 各行はdist始/終、inc始/終、周回速度始/終、円盤係数始/終。incは度。
const WORLD_GARGANTUA_CAMERA = Object.freeze({
  intro: [50,38,2,2,.010,.010,.6,.6], build: [40,32,2,8,.020,.05,.8,1.1],
  drop: [30,30,3,3,.07,.07,1.35,1.35], break: [36,36,20,20,.012,.012,.7,.7],
  outro: [34,70,6,6,.008,.008,.9,0], main: [34,34,3,3,.03,.03,1,1]
});
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
  Array.isArray(value) ? `const vec3 ${name} = vec3(${value.map(v=>v.toFixed(8)).join(',')});` : `const ${['MAX_STEPS','MAX_CROSSINGS','FBM_OCTAVES','MILKY_WAY_OCTAVES','BAND_COUNT','HOTSPOT_COUNT'].includes(name)?'int':'float'} ${name} = ${['MAX_STEPS','MAX_CROSSINGS','FBM_OCTAVES','MILKY_WAY_OCTAVES','BAND_COUNT','HOTSPOT_COUNT'].includes(name)?value:Number(value).toFixed(8)};`).join('\n');
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
uniform vec3 gravity; // 曲がりの係数、地平面半径、ISCO内縁
out vec4 frag;
const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453123);}
float gargantuaNoise3(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
}
// §10.11: 半径方向の実波長で減衰した分を平均値で補う。逆順smoothstepは正順補数で表す。
float streakFbm(vec3 p,float rd,float fp){
 float n=0.,amp=.5,frequency=STREAK_RADIAL;
 for(int k=0;k<FBM_OCTAVES;k++){
  float wavelength=rd/frequency,w=1.-smoothstep(LOD_START,LOD_END,fp/wavelength);
  n+=amp*(w*gargantuaNoise3(p)+(1.-w)*NOISE_MEAN);p=p*FBM_FREQUENCY+vec3(7.1,3.7,1.9);frequency*=FBM_FREQUENCY;amp*=.5;
 }return n;
}
float musicGain(float rd){
 // §10.8: 円盤の外縁と独立した3〜14の帯域範囲。外側は最後の帯域を保持する。
 float x=clamp((rd-DISK_INNER)/(BAND_OUTER-DISK_INNER),0.,1.)*float(BAND_COUNT);
 int k=clamp(int(floor(x)),0,BAND_COUNT-1);float f=fract(x),L=bands[BAND_COUNT-1-k].x;
 // 境界の前後7.5%ずつ（合計15%）だけ隣接帯と補間。
 if(f<BAND_BLEND*.5&&k>0)L=mix(bands[BAND_COUNT-k].x,L,.5+.5*smoothstep(0.,BAND_BLEND*.5,f));
 if(f>1.-BAND_BLEND*.5&&k<BAND_COUNT-1)L=mix(L,bands[BAND_COUNT-2-k].x,.5*smoothstep(1.-BAND_BLEND*.5,1.,f));
 float gain=MUSIC_BASE+MUSIC_GAIN*L;
 // §10.13: キックの間は内側を休ませ、包絡で増光する。
 float inner=1.-smoothstep(DISK_INNER,KICK_RADIUS,rd);
 gain*=mix(1.,KICK_REST,inner)*(1.+KICK_GAIN*music.x*inner);
 return gain;
}
vec3 streakInput(float rd,float phi,float omega){
 float rot=phi-omega*music.w;
 return vec3(log(rd)*STREAK_RADIAL,cos(rot)*STREAK_ANGULAR,sin(rot)*STREAK_ANGULAR+music.w*STREAK_TIME);
}
vec4 diskSample(vec3 hit,float travel,vec3 ndir,float turn){
 float rd=length(hit.xz),phi=atan(hit.z,hit.x);
 float omega=KEPLER_SPEED*pow(rd/DISK_INNER,KEPLER_POWER)*music.z;
 vec3 warm=mix(DISK_OUTER_COLOR,DISK_INNER_COLOR,pow(DISK_INNER/rd,COLOR_POWER));
 vec3 tint=mix(warm,warm*primary*PALETTE_GAIN,PALETTE_TINT);
 float fp=travel*radians(FOV)/LOD_HEIGHT;
 // §10.11: すれすれの視線は最大20倍、累積曲がり角で連続的に画素幅を広げてLODを引く。
 fp*=1./max(abs(ndir.y),GRAZE_MIN);
 fp*=exp(clamp(turn-TURN_START,0.,TURN_MAX_LOG));
 float n=streakFbm(streakInput(rd,phi,omega),rd,fp);
 float streak=STREAK_FLOOR+(1.-STREAK_FLOOR)*smoothstep(STREAK_LO,STREAK_HI,n);
 float env=smoothstep(gravity.z,gravity.z+INNER_FADE-DISK_INNER,rd)*(1.-smoothstep(OUTER_FADE,DISK_OUTER,rd));
 float I=DISK_HDR*env*streak*pow(DISK_INNER/rd,INTENSITY_POWER);
 vec3 col=tint*I*musicGain(rd);
 for(int i=0;i<HOTSPOT_COUNT;i++){
  vec4 spot=hotspots[i];float age=music.w-spot.z;
  if(age<0.||age>=HOTSPOT_SECONDS)continue;
  float a=spot.y+KEPLER_SPEED*pow(spot.x/DISK_INNER,KEPLER_POWER)*music.z*age;
  vec2 center=spot.x*vec2(cos(a),sin(a));float d2=dot(hit.xz-center,hit.xz-center);
  col+=tint*HOTSPOT_HDR*exp(-d2/(2.*HOTSPOT_RADIUS*HOTSPOT_RADIUS))*(1.-age/HOTSPOT_SECONDS);
 }
 return vec4(col*camera.w,env*clamp(OPACITY_BASE+OPACITY_STREAK*streak,0.,OPACITY_MAX));
}
float milkyFbm(vec3 p){
 float n=0.,a=.5;for(int i=0;i<MILKY_WAY_OCTAVES;i++){n+=gargantuaNoise3(p)*a;p=p*2.+vec3(7.1,3.7,1.9);a*=.5;}return n;
}
vec3 cameraPosition(){return camera.x*vec3(cos(camera.y)*cos(camera.z),sin(camera.y),cos(camera.y)*sin(camera.z));}
vec3 starfield(vec3 d){
 d=normalize(d);vec3 cell=floor(d*STAR_CELLS),stars=vec3(0);
 vec3 right=normalize(cross(abs(d.y)<.99?vec3(0,1,0):vec3(1,0,0),d)),up=cross(d,right);
 // §10.5: 1080p換算の半径.6画素の点。光暈と光条は描かない。
 float pixel=2.*tan(radians(FOV)*.5)/STAR_REFERENCE_HEIGHT;
 // 近隣27セルで点を境界越しに引く。
 for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec3 c=cell+vec3(x,y,z);if(hash3(c)>=STAR_PROBABILITY)continue;
  float h=hash3(c+19.7),phase=hash3(c+37.1)*TAU,brightness=STAR_HDR*pow(h,STAR_POWER);
  vec3 center=normalize((c+vec3(hash3(c+2.3),hash3(c+5.9),hash3(c+8.1)))/STAR_CELLS);
  vec3 delta=center-d;vec2 p=vec2(dot(delta,right),dot(delta,up))/pixel;
  float point=exp(-dot(p,p)/(2.*STAR_RADIUS_PX*STAR_RADIUS_PX));
  float twinkle=TWINKLE_BASE+TWINKLE_GAIN*sin(phase+music.w*.25+music.y*TWINKLE_ONSET);
  vec3 color=mix(vec3(.72,.84,1.),vec3(1.,.72,.44),hash3(c+53.2));
  stars+=color*brightness*twinkle*point;
 }
 // 未レンズ方向では画面の対角線上の一本の帯。逃走方向で引くので穴の周りへ曲がる。
 vec3 forward=normalize(-cameraPosition()),camRight=normalize(cross(forward,vec3(0,1,0))),camUp=cross(camRight,forward);
 vec3 beltNormal=normalize(camRight-camUp);
 float cloud=milkyFbm(d*3.);
 float belt=exp(-pow(dot(d,beltNormal)/MILKY_WAY_WIDTH,2.));
 vec3 milk=secondary*MILKY_WAY_TINT*min(MILKY_WAY_MAX,cloud*belt*MILKY_WAY_MAX);
 return stars+min(vec3(BACKGROUND_MAX),milk);
}
// 追跡の中心光線で最接近距離を測る。alphaは測定専用の直接像半径を保持する。
vec4 traceRay(vec2 uv,out float closest,out float directPhi,out float background){
 vec3 camPos=cameraPosition();
 vec3 forward=normalize(-camPos),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward);
 vec2 p=(uv*2.-1.)*vec2(outputResolution.x/outputResolution.y,1.)*tan(radians(FOV)*.5);
 vec3 pos=camPos,dir=normalize(forward+right*p.x+up*p.y),angular=cross(pos,dir),ndPrev=dir;
 float h2=dot(angular,angular),alpha=1.,directRadius=0.,travel=0.,turn=0.;vec3 col=vec3(0);int crossings=0,planeCrossings=0;
 bool escaped=false;closest=length(pos);directPhi=0.;background=0.;
 for(int i=0;i<MAX_STEPS;i++){
  float r=length(pos);closest=min(closest,r);if(r<gravity.y)break;
  float dt=clamp(r*STEP_SCALE,STEP_MIN,STEP_MAX);
  vec3 acc=-gravity.x*h2*pos/pow(r,5.),prev=pos;
  dir+=acc*dt;pos+=dir*dt;
  // §10.11: 円盤の交差有無に依存せず、ステップごとの曲がりを累積する。
  vec3 nd=normalize(dir);turn+=length(cross(ndPrev,nd));ndPrev=nd;
  vec3 segment=pos-prev;
  closest=min(closest,length(prev+segment*clamp(-dot(prev,segment)/max(dot(segment,segment),1e-12),0.,1.)));
  // §10.1: y=0の平面だけを手前から奥へ合成。交点までの累積距離でLODを計算する。
  if(sign(prev.y)!=sign(pos.y)){
   planeCrossings++;
   float fraction=prev.y/(prev.y-pos.y);
   vec3 hit=mix(prev,pos,fraction);float rd=length(hit.xz);
   if(rd>=gravity.z&&rd<=DISK_OUTER&&crossings<MAX_CROSSINGS){
    if(planeCrossings==1&&crossings==0&&dot(hit.xz,camPos.xz)>0.&&dot(hit,dir)<0.){
     directRadius=rd;directPhi=atan(hit.z,hit.x);
    }
    vec4 sampleValue=diskSample(hit,travel+length(segment)*fraction,nd,turn);
    col+=alpha*sampleValue.rgb*sampleValue.a;alpha*=1.-sampleValue.a;crossings++;
   }
  }
  travel+=length(segment);
  if(r>ESCAPE_RADIUS){escaped=true;break;}
 }
 if(escaped)col+=alpha*starfield(dir);
 // 直接像だけを保持し、再交差の高次像が混ざった画素を測定から除く。
 if(crossings>1)directRadius=0.;
 background=float(escaped&&crossings==0);
 return vec4(col,directRadius);
}
void main(){
 float closest,phi,background;
 vec4 center=traceRay(vUv,closest,phi,background);
 if(closest>=RING_SAMPLE_MIN&&closest<=RING_SAMPLE_MAX){
  // §10.10: 半解像度の画素単位で8点の回転格子を平均し、測定用alphaは中心光線を保つ。
  vec2 delta=vec2(SUBSAMPLE_NEAR,SUBSAMPLE_FAR)/(outputResolution*HALF_RESOLUTION);
  float r,a,b;vec4 sum=traceRay(vUv+vec2(-delta.x,-delta.y),r,a,b);
  sum+=traceRay(vUv+vec2(delta.x,-delta.y),r,a,b);
  sum+=traceRay(vUv+vec2(-delta.x,delta.y),r,a,b);
  sum+=traceRay(vUv+vec2(delta.x,delta.y),r,a,b);
  sum+=traceRay(vUv+vec2(-delta.y,-delta.x),r,a,b);
  sum+=traceRay(vUv+vec2(delta.y,-delta.x),r,a,b);
  sum+=traceRay(vUv+vec2(-delta.y,delta.x),r,a,b);
  sum+=traceRay(vUv+vec2(delta.y,delta.x),r,a,b);
  frag=vec4(sum.rgb*.125,center.a);
 }else frag=center;
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
    this.statelessRender=true; // フレーム間のGPU履歴を持たない（設計 §10.12）。
    this.camera=new Float32Array(4);this.cameraFrom=new Float64Array(4);this.cameraTarget=new Float64Array(4);
    this.gravity=new Float32Array(3);this.music=new Float32Array(4);this.hotspots=new Float32Array(WORLD_GARGANTUA.HOTSPOT_COUNT*4);
    this.reset();
  }
  reset() {
    super.reset();if(!this.camera)return;
    this.camera.fill(0);this.cameraFrom.fill(0);this.cameraTarget.fill(0);this.music.fill(0);
    this.hotspots.fill(0);for(let i=0;i<WORLD_GARGANTUA.HOTSPOT_COUNT;i++)this.hotspots[i*4+2]=-100;
    this.baseInclination=0;this.gravityAmount=0;this.gravityFrom=0;this.gravityTarget=0;this.gravityChangedSec=0;
    this.gravity[0]=WORLD_GARGANTUA.GRAVITY;this.gravity[1]=WORLD_GARGANTUA.Rs;this.gravity[2]=WORLD_GARGANTUA.DISK_INNER;
    this.section=null;this.sectionChangedSec=0;this.azim=0;this.orbitSpeed=0;this.hotspotSerial=0;this.highOnsetPhase=0;
    this.lastKick=-100;this.lastEventSec=-1;this.exposureMultiplier=WORLD_GARGANTUA.EXPOSURE_BASE;
  }
  init(gpu) {
    super.init(gpu);this.program=gpu.program(WORLD_GARGANTUA_FRAGMENT);
    this.bandLoc=gpu.texture(this.program,'bands[0]');this.primaryLoc=gpu.texture(this.program,'primary');this.secondaryLoc=gpu.texture(this.program,'secondary');
    this.gravityLoc=gpu.texture(this.program,'gravity');this.cameraLoc=gpu.texture(this.program,'camera');this.musicLoc=gpu.texture(this.program,'music');
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
    if(s.kind==='drop'&&s.variation>=2){target[0]=c.SECOND_DROP_DIST;target[2]=c.SECOND_DROP_SPEED;target[3]*=c.SECOND_DROP_GAIN;target[1]=c.SECOND_DROP_INC*Math.PI/180;}
    if(s!==this.section){
      if(this.section){this.cameraFrom[0]=this.camera[0];this.cameraFrom[1]=this.baseInclination;this.cameraFrom[2]=this.orbitSpeed;this.cameraFrom[3]=this.camera[3];}
      else this.cameraFrom.set(target);
      this.sectionChangedSec=this.section?s.startSec:s.startSec-c.CAMERA_EASE_SECONDS;this.section=s;
    }
    const x=Math.max(0,Math.min(1,(t-this.sectionChangedSec)/c.CAMERA_EASE_SECONDS)),ease=x*x*(3-2*x);
    this.camera[0]=this.cameraFrom[0]+(target[0]-this.cameraFrom[0])*ease;
    this.baseInclination=this.cameraFrom[1]+(target[1]-this.cameraFrom[1])*ease;
    this.camera[1]=this.baseInclination+c.SWAY_DEGREES*Math.PI/180*Math.sin(t*c.SWAY_SPEED);
    this.orbitSpeed=this.cameraFrom[2]+(target[2]-this.cameraFrom[2])*ease;
    this.camera[3]=this.cameraFrom[3]+(target[3]-this.cameraFrom[3])*ease;
    this.azim+=this.orbitSpeed*input.dt;this.camera[2]=this.azim;
    const gravityTarget=s.kind==='drop'?1:0;
    if(gravityTarget!==this.gravityTarget){
      this.gravityFrom=this.gravityAmount;this.gravityTarget=gravityTarget;this.gravityChangedSec=s.startSec;
    }
    const gx=Math.max(0,Math.min(1,(t-this.gravityChangedSec)/(this.gravityTarget?c.GRAVITY_EASE_IN:c.GRAVITY_EASE_OUT)));
    this.gravityAmount=this.gravityFrom+(this.gravityTarget-this.gravityFrom)*gx*gx*(3-2*gx);
    this.gravity[0]=c.GRAVITY+(c.DROP_GRAVITY-c.GRAVITY)*this.gravityAmount;
    this.gravity[1]=c.Rs+(c.DROP_HORIZON-c.Rs)*this.gravityAmount;
    this.gravity[2]=c.DISK_INNER+(c.DROP_DISK_INNER-c.DISK_INNER)*this.gravityAmount;
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
    gl.uniform3fv(this.gravityLoc,this.gravity);gl.uniform4fv(this.cameraLoc,this.camera);gl.uniform4fv(this.musicLoc,this.music);gl.uniform4fv(this.hotspotLoc,this.hotspots);
    gl.uniform2f(this.outputLoc,input.target.width,input.target.height);g.draw();
    g.bind(this.upsample,input.target);g.sampler(this.sourceLoc,0,this.half);g.draw();
  }
}
if(typeof module!=='undefined'&&module.exports){module.exports={WorldGargantuaAnalyzer,WORLD_GARGANTUA,WORLD_GARGANTUA_CAMERA,worldGargantuaEventHash};}
