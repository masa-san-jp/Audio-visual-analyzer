// 目的 — h²測地線・降着円盤・音楽イベントとレンズ星空を描く — doc/20261004-design-gargantua-v1.md §7・§10
const WORLD_GARGANTUA = Object.freeze({
  MAX_STEPS: 180, MAX_CROSSINGS: 3, Rs: 1, FOV: 22, HALF_RESOLUTION: .5,
  STEP_SCALE: .045, STEP_MIN: .015, STEP_MAX: 1.6, GRAVITY: 1.5, ESCAPE_RADIUS: 100,
  DISK_INNER: 3, DISK_OUTER: 20, BAND_OUTER: 14, KEPLER_SPEED: 1.35, KEPLER_POWER: -1.5,
  DISK_INNER_COLOR: Object.freeze([1.00,.90,.76]), DISK_OUTER_COLOR: Object.freeze([1.00,.52,.20]),
  COLOR_POWER: 1.3, PALETTE_TINT: .15, PALETTE_GAIN: 1.6,
  STREAK_RADIAL: 60, STREAK_ANGULAR: 3.0, STREAK_TIME: .03,
  FLOW_PERIOD: 8, FLOW_PHASE_OFFSET: 17.3, SHEAR_FACTOR: 1.5,
  FBM_OCTAVES: 4, FBM_FREQUENCY: 2.03, LOD_HEIGHT: 540, LOD_START: .6, LOD_END: 2,
  GRAZE_MIN: .05, TURN_START: 1.2, TURN_MAX_LOG: 6.3, NOISE_MEAN: .5, DERIV_SCALE: 1.0, LF_MAX: 1.0,
  STREAK_FLOOR: .15, STREAK_LO: .30, STREAK_HI: .70, DISK_HDR: 3.0, INTENSITY_POWER: .8,
  INNER_FADE: 3.25, OUTER_FADE: 12, OPACITY_BASE: .45, OPACITY_STREAK: .5, OPACITY_MAX: .90,
  BAND_COUNT: 32, BAND_BLEND: .15, MUSIC_BASE: .45, MUSIC_GAIN: 2.2,
  KICK_SECONDS: .18, KICK_RADIUS: 6.5, KICK_REST: .40, KICK_GAIN: 3.5, KICK_BLOOM: .8,
  LIGHT_STREAK_COUNT: 8, LIGHT_STREAK_INNER: 5.5, LIGHT_STREAK_OUTER: 9,
  LIGHT_STREAK_LAP: .35, LIGHT_STREAK_SPEED: 2*Math.PI/.35, LIGHT_STREAK_TAIL: 1.6,
  LIGHT_STREAK_WIDTH: .08, LIGHT_STREAK_LOD: 1.5, LIGHT_STREAK_LIFE: .7, LIGHT_STREAK_HDR: 14,
  EXPOSURE_BASE: .85, EXPOSURE_GAIN: .3, CAMERA_EASE_SECONDS: 4,
  SWAY_DEGREES: 1.0, SWAY_SPEED: .07,
  STAR_HIGH_GAIN: 1.5, ORBIT_LOUD_GAIN: .8, ORBIT_MIN: .5, ORBIT_MAX: 1.6,
  RING_SAMPLE_MIN: 1.3, RING_SAMPLE_MAX: 3.2, SUBSAMPLE_NEAR: .125, SUBSAMPLE_FAR: .375,
  STAR_CELLS: 180, STAR_PROBABILITY: .03, STAR_POWER: 18, STAR_HDR: 6,
  STAR_RADIUS_PX: .6, STAR_REFERENCE_HEIGHT: 1080,
  TWINKLE_BASE: .75, TWINKLE_GAIN: .25, TWINKLE_ONSET: 1.7,
  MILKY_WAY_MAX: .035, MILKY_WAY_OCTAVES: 5, MILKY_WAY_WIDTH: .18, MILKY_WAY_TINT: .4, BACKGROUND_MAX: .04,
  BLOOM_THRESHOLD: .55, BLOOM_STRENGTH: .90, VEIL_GAIN: .10
});
// 各行はdist、inc、roll、offX、offY、周回速度、円盤係数の始/終。角度は度（§10.20）。
const WORLD_GARGANTUA_CAMERA = Object.freeze({
  intro: [60,38,2,3,0,0,0,0,0,0,.010,.010,.6,.7],
  build: [36,28,-10,16,0,-6,0,6,0,0,.02,.04,.8,1.1],
  drop: [27,25,4,6,8,10,9,9,-2,-2,.09,.09,1.35,1.35],
  break: [42,42,38,46,0,0,0,0,0,0,.015,.015,.7,.7],
  main: [32,30,1.2,1.8,-4,-4,-8,-8,0,0,.03,.03,1,1],
  outro: [34,80,6,24,0,0,0,0,0,0,.008,.008,.9,0]
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
  Array.isArray(value) ? `const vec3 ${name} = vec3(${value.map(v=>v.toFixed(8)).join(',')});` : `const ${['MAX_STEPS','MAX_CROSSINGS','FBM_OCTAVES','MILKY_WAY_OCTAVES','BAND_COUNT','LIGHT_STREAK_COUNT'].includes(name)?'int':'float'} ${name} = ${['MAX_STEPS','MAX_CROSSINGS','FBM_OCTAVES','MILKY_WAY_OCTAVES','BAND_COUNT','LIGHT_STREAK_COUNT'].includes(name)?value:Number(value).toFixed(8)};`).join('\n');
const WORLD_GARGANTUA_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_GARGANTUA_GLSL}
in vec2 vUv;
uniform vec4 bands[32];
uniform vec3 primary, secondary;
uniform vec4 camera; // dist、inc(rad)、azim、円盤係数
uniform vec4 view2; // roll(rad)、offX(rad)、offY(rad)、高域8帯域の平均
uniform vec4 music; // キック包絡、高域位相、BPM速度、時刻
uniform vec4 streaks[8]; // 半径、初期角度、誕生時刻、回転方向（+1固定）
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
// §10.17: 位相ごとの巻き込みをlog半径の画素幅へ加え、§10.11の平均値補填を保持する。
float streakFbm(vec3 p,float lf,float omega,float tau){
 float n=0.,amp=.5,frequency=STREAK_RADIAL,angularFrequency=STREAK_ANGULAR;
 for(int k=0;k<FBM_OCTAVES;k++){
  float w=1.-smoothstep(LOD_START,LOD_END,lf*(frequency+angularFrequency*SHEAR_FACTOR*omega*tau));
  n+=amp*(w*gargantuaNoise3(p)+(1.-w)*NOISE_MEAN);p=p*FBM_FREQUENCY+vec3(7.1,3.7,1.9);frequency*=FBM_FREQUENCY;angularFrequency*=FBM_FREQUENCY;amp*=.5;
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
vec3 streakInput(float rd,float phi,float omega,float tau,float phase){
 float rot=phi-omega*tau;
 return vec3(log(rd)*STREAK_RADIAL,cos(rot)*STREAK_ANGULAR,sin(rot)*STREAK_ANGULAR+music.w*STREAK_TIME+phase*FLOW_PHASE_OFFSET);
}
// §10.17: 半周期ずらした2位相を混ぜ、重み0で作り直しを隠して分散を戻す。
float streakFlow(float rd,float phi,float omega,float lf){
 float tau1=mod(music.w,FLOW_PERIOD),tau2=mod(music.w+FLOW_PERIOD*.5,FLOW_PERIOD);
 float w1=1.-abs(2.*tau1/FLOW_PERIOD-1.),w2=1.-w1;
 float n1=streakFbm(streakInput(rd,phi,omega,tau1,1.),lf,omega,tau1);
 float n2=streakFbm(streakInput(rd,phi,omega,tau2,2.),lf,omega,tau2);
 float n=w1*n1+w2*n2;
 return .5+(n-.5)/sqrt(w1*w1+w2*w2);
}
// §10.16: 交点の有効性が画素間で変わるときだけ、従来の解析値へ戻す。
float analyticLf(float rd,float travel,vec3 ndir,float turn){
 float fp=travel*radians(FOV)/LOD_HEIGHT;
 fp*=1./max(abs(ndir.y),GRAZE_MIN);
 fp*=exp(clamp(turn-TURN_START,0.,TURN_MAX_LOG));
 return fp/rd;
}
vec4 diskSample(vec3 hit,float travel,vec3 ndir,float turn,float lf){
 float rd=length(hit.xz),phi=atan(hit.z,hit.x);
 float omega=KEPLER_SPEED*pow(rd/DISK_INNER,KEPLER_POWER)*music.z;
 vec3 warm=mix(DISK_OUTER_COLOR,DISK_INNER_COLOR,pow(DISK_INNER/rd,COLOR_POWER));
 vec3 tint=mix(warm,warm*primary*PALETTE_GAIN,PALETTE_TINT);
 // 負のlfは中心に該当する交点がないサブサンプル／測定プローブの解析値指定。
 if(lf<0.)lf=analyticLf(rd,travel,ndir,turn);
 lf=clamp(lf,0.,LF_MAX);
 float n=streakFlow(rd,phi,omega,lf);
 float streak=STREAK_FLOOR+(1.-STREAK_FLOOR)*smoothstep(STREAK_LO,STREAK_HI,n);
 float env=smoothstep(gravity.z,gravity.z+INNER_FADE-DISK_INNER,rd)*(1.-smoothstep(OUTER_FADE,DISK_OUTER,rd));
 float I=DISK_HDR*env*streak*pow(DISK_INNER/rd,INTENSITY_POWER);
 vec3 col=tint*I*musicGain(rd);
 // §10.18: 先頭から後ろへ減衰する筋。LODで太らせた分だけ明るさを下げる。
 for(int i=0;i<LIGHT_STREAK_COUNT;i++){
  vec4 light=streaks[i];float age=music.w-light.z;
  if(age<0.||age>=LIGHT_STREAK_LIFE)continue;
  float head=light.y+LIGHT_STREAK_SPEED*age;
  float d=mod(head-phi,TAU),tail=exp(-d/LIGHT_STREAK_TAIL);
  float width=max(LIGHT_STREAK_WIDTH,rd*lf*LIGHT_STREAK_LOD);
  float radial=exp(-pow((rd-light.x)/width,2.))*(LIGHT_STREAK_WIDTH/width);
  float fade=pow(1.-age/LIGHT_STREAK_LIFE,2.);
  col+=mix(tint,vec3(1.),.5)*LIGHT_STREAK_HDR*tail*radial*fade;
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
 return (stars+min(vec3(BACKGROUND_MAX),milk))*(1.+STAR_HIGH_GAIN*view2.w);
}
// §10.16: 陰影計算を遅らせ、手前から奥の交点と逃走方向だけを記録する。
void traceRay(vec2 uv,out float closest,out float directPhi,out float background,out float directRadius,
 out vec4 hitA[MAX_CROSSINGS],out vec4 hitB[MAX_CROSSINGS],out int hitCount,out bool escaped,out vec3 escapeDir){
 vec3 camPos=cameraPosition();
 vec3 forward=normalize(-camPos),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward);
 // §10.20: 視線をずらして基底を作り直し、その後にロールする。
 forward=normalize(forward+right*tan(view2.y)+up*tan(view2.z));
 right=normalize(cross(forward,vec3(0,1,0)));up=cross(right,forward);
 vec3 r2=cos(view2.x)*right+sin(view2.x)*up,u2=-sin(view2.x)*right+cos(view2.x)*up;
 vec2 p=(uv*2.-1.)*vec2(outputResolution.x/outputResolution.y,1.)*tan(radians(FOV)*.5);
 vec3 pos=camPos,dir=normalize(forward+r2*p.x+u2*p.y),angular=cross(pos,dir),ndPrev=dir;
 float h2=dot(angular,angular),travel=0.,turn=0.;int crossings=0,planeCrossings=0;
 escaped=false;closest=length(pos);directPhi=0.;background=0.;directRadius=0.;hitCount=0;
 // 未使用の交点も初期化し、mainの一様な微分計算で未定義値を読まない。
 for(int c=0;c<MAX_CROSSINGS;c++){hitA[c]=vec4(0);hitB[c]=vec4(0);}
 for(int i=0;i<MAX_STEPS;i++){
  float r=length(pos);closest=min(closest,r);if(r<gravity.y)break;
  float dt=clamp(r*STEP_SCALE,STEP_MIN,STEP_MAX);
  vec3 acc=-gravity.x*h2*pos/pow(r,5.),prev=pos;
  dir+=acc*dt;pos+=dir*dt;
  // §10.11: 円盤の交差有無に依存せず、ステップごとの曲がりを累積する。
  vec3 nd=normalize(dir);turn+=length(cross(ndPrev,nd));ndPrev=nd;
  vec3 segment=pos-prev;
  closest=min(closest,length(prev+segment*clamp(-dot(prev,segment)/max(dot(segment,segment),1e-12),0.,1.)));
  // §10.16: y=0の平面の交点・交点までの累積距離・正規化方向を保存する。
  if(sign(prev.y)!=sign(pos.y)){
   planeCrossings++;
   float fraction=prev.y/(prev.y-pos.y);
   vec3 hit=mix(prev,pos,fraction);float rd=length(hit.xz);
   if(rd>=gravity.z&&rd<=DISK_OUTER&&crossings<MAX_CROSSINGS){
    if(planeCrossings==1&&crossings==0&&dot(hit.xz,camPos.xz)>0.&&dot(hit,dir)<0.){
     directRadius=rd;directPhi=atan(hit.z,hit.x);
    }
    hitA[crossings]=vec4(hit.x,hit.z,travel+length(segment)*fraction,turn);
    hitB[crossings]=vec4(nd,1.);crossings++;
   }
  }
  travel+=length(segment);
  if(r>ESCAPE_RADIUS){escaped=true;break;}
 }
 hitCount=crossings;escapeDir=dir;
 // 直接像だけを保持し、再交差の高次像が混ざった画素を測定から除く。
 if(crossings>1)directRadius=0.;
 background=float(escaped&&crossings==0);
}
// 中心のlfを同じ交差番号へ渡し、欠けた交点だけ解析値で陰影計算する。
vec4 shadeHits(vec4 hitA[MAX_CROSSINGS],vec4 hitB[MAX_CROSSINGS],int hitCount,bool escaped,vec3 escapeDir,
 float directRadius,float lf[MAX_CROSSINGS],int lfCount){
 vec3 col=vec3(0);float alpha=1.;
 for(int c=0;c<MAX_CROSSINGS;c++){
  if(c>=hitCount)break;
  vec4 a=hitA[c],b=hitB[c];
  vec4 sampleValue=diskSample(vec3(a.x,0.,a.y),a.z,b.xyz,a.w,c<lfCount?lf[c]:-1.);
  col+=alpha*sampleValue.rgb*sampleValue.a;alpha*=1.-sampleValue.a;
 }
 if(escaped)col+=alpha*starfield(escapeDir);
 return vec4(col,directRadius);
}
void main(){
 float closest,phi,background,directRadius;vec4 hitA[MAX_CROSSINGS],hitB[MAX_CROSSINGS];
 int hitCount;bool escaped;vec3 escapeDir;
 traceRay(vUv,closest,phi,background,directRadius,hitA,hitB,hitCount,escaped,escapeDir);
 float lf[MAX_CROSSINGS];
 // 微分は中心追跡の直後、分岐外の一様な3回のループでだけ評価する。
 for(int c=0;c<MAX_CROSSINGS;c++){
  float rd=length(hitA[c].xy),L=log(max(rd,1e-3)),v=c<hitCount?1.:0.;
  float dL=length(vec2(dFdx(L),dFdy(L)));
  bool ok=fwidth(v)==0.&&v>0.;
  lf[c]=clamp(ok?dL*DERIV_SCALE:analyticLf(max(rd,1e-3),hitA[c].z,hitB[c].xyz,hitA[c].w),0.,LF_MAX);
 }
 vec4 center=shadeHits(hitA,hitB,hitCount,escaped,escapeDir,directRadius,lf,hitCount);
 if(closest>=RING_SAMPLE_MIN&&closest<=RING_SAMPLE_MAX){
  // §10.10: 半解像度の画素単位で8点の回転格子を平均し、測定用alphaは中心光線を保つ。
  vec2 delta=vec2(SUBSAMPLE_NEAR,SUBSAMPLE_FAR)/(outputResolution*HALF_RESOLUTION);
  float r,a,b,d;vec4 subA[MAX_CROSSINGS],subB[MAX_CROSSINGS];int subCount;bool subEscaped;vec3 subDir;vec4 sum=vec4(0);
  traceRay(vUv+vec2(-delta.x,-delta.y),r,a,b,d,subA,subB,subCount,subEscaped,subDir);
  sum+=shadeHits(subA,subB,subCount,subEscaped,subDir,d,lf,hitCount);
  traceRay(vUv+vec2(delta.x,-delta.y),r,a,b,d,subA,subB,subCount,subEscaped,subDir);
  sum+=shadeHits(subA,subB,subCount,subEscaped,subDir,d,lf,hitCount);
  traceRay(vUv+vec2(-delta.x,delta.y),r,a,b,d,subA,subB,subCount,subEscaped,subDir);
  sum+=shadeHits(subA,subB,subCount,subEscaped,subDir,d,lf,hitCount);
  traceRay(vUv+vec2(delta.x,delta.y),r,a,b,d,subA,subB,subCount,subEscaped,subDir);
  sum+=shadeHits(subA,subB,subCount,subEscaped,subDir,d,lf,hitCount);
  traceRay(vUv+vec2(-delta.y,-delta.x),r,a,b,d,subA,subB,subCount,subEscaped,subDir);
  sum+=shadeHits(subA,subB,subCount,subEscaped,subDir,d,lf,hitCount);
  traceRay(vUv+vec2(delta.y,-delta.x),r,a,b,d,subA,subB,subCount,subEscaped,subDir);
  sum+=shadeHits(subA,subB,subCount,subEscaped,subDir,d,lf,hitCount);
  traceRay(vUv+vec2(-delta.y,delta.x),r,a,b,d,subA,subB,subCount,subEscaped,subDir);
  sum+=shadeHits(subA,subB,subCount,subEscaped,subDir,d,lf,hitCount);
  traceRay(vUv+vec2(delta.y,delta.x),r,a,b,d,subA,subB,subCount,subEscaped,subDir);
  sum+=shadeHits(subA,subB,subCount,subEscaped,subDir,d,lf,hitCount);
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
    this.camera=new Float32Array(4);this.view2=new Float32Array(4);this.cameraFrom=new Float64Array(7);this.cameraTarget=new Float64Array(7);this.cameraShot=new Float64Array(7);
    this.gravity=new Float32Array(3);this.music=new Float32Array(4);this.streaks=new Float32Array(WORLD_GARGANTUA.LIGHT_STREAK_COUNT*4);
    this.reset();
  }
  reset() {
    super.reset();if(!this.camera)return;
    this.camera.fill(0);this.cameraFrom.fill(0);this.cameraTarget.fill(0);this.cameraShot.fill(0);this.view2.fill(0);this.music.fill(0);
    this.streaks.fill(0);for(let i=0;i<WORLD_GARGANTUA.LIGHT_STREAK_COUNT;i++)this.streaks[i*4+2]=-100;
    this.baseInclination=0;
    this.gravity[0]=WORLD_GARGANTUA.GRAVITY;this.gravity[1]=WORLD_GARGANTUA.Rs;this.gravity[2]=WORLD_GARGANTUA.DISK_INNER;
    this.section=null;this.sectionChangedSec=0;this.azim=0;this.orbitSpeed=0;this.streakSerial=0;this.highOnsetPhase=0;
    this.lastKick=-100;this.lastEventSec=-1;this.exposureMultiplier=WORLD_GARGANTUA.EXPOSURE_BASE;
  }
  init(gpu) {
    super.init(gpu);this.program=gpu.program(WORLD_GARGANTUA_FRAGMENT);
    this.bandLoc=gpu.texture(this.program,'bands[0]');this.primaryLoc=gpu.texture(this.program,'primary');this.secondaryLoc=gpu.texture(this.program,'secondary');
    this.gravityLoc=gpu.texture(this.program,'gravity');this.cameraLoc=gpu.texture(this.program,'camera');this.view2Loc=gpu.texture(this.program,'view2');this.musicLoc=gpu.texture(this.program,'music');
    this.streakLoc=gpu.texture(this.program,'streaks[0]');this.outputLoc=gpu.texture(this.program,'outputResolution');
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
    const row=WORLD_GARGANTUA_CAMERA[s.kind],target=this.cameraTarget,shot=this.cameraShot;
    const progress=p*p*(3-2*p);
    for(let i=0;i<7;i++)target[i]=row[i*2]+(row[i*2+1]-row[i*2])*progress;
    if(s.kind==='drop'&&s.variation>=2){target[0]=27;target[1]=-6-2*progress;target[2]=-10-2*progress;target[3]=-9;}
    // 初回は表の構図。再登場する奇数variationだけ左右を反転する。
    if(s.variation>=3&&s.variation%2===1){target[2]=-target[2];target[3]=-target[3];}
    for(let i=1;i<=4;i++)target[i]*=Math.PI/180;
    if(s!==this.section){
      if(this.section)this.cameraFrom.set(shot);
      else this.cameraFrom.set(target);
      this.sectionChangedSec=this.section?s.startSec:s.startSec-c.CAMERA_EASE_SECONDS;this.section=s;
    }
    const x=Math.max(0,Math.min(1,(t-this.sectionChangedSec)/c.CAMERA_EASE_SECONDS)),ease=x*x*(3-2*x);
    for(let i=0;i<7;i++)shot[i]=this.cameraFrom[i]+(target[i]-this.cameraFrom[i])*ease;
    this.camera[0]=shot[0];this.baseInclination=shot[1];
    this.camera[1]=this.baseInclination+c.SWAY_DEGREES*Math.PI/180*Math.sin(t*c.SWAY_SPEED);
    this.view2[0]=shot[2];this.view2[1]=shot[3];this.view2[2]=shot[4];
    let hi=0;for(let i=c.BAND_COUNT-8;i<c.BAND_COUNT;i++)hi+=input.features.bandsSmooth[i];
    this.view2[3]=hi/8;
    this.orbitSpeed=shot[5];this.camera[3]=shot[6];
    const loudness=input.features.loudness.level;
    this.azim+=this.orbitSpeed*Math.max(c.ORBIT_MIN,Math.min(c.ORBIT_MAX,1+c.ORBIT_LOUD_GAIN*(loudness-.5)))*input.dt;
    this.camera[2]=this.azim;
    // MFSは未消費ホップを集約し、同じホップの再取得では0を返す。
    // 連続フレームの同じbitも別イベント。再描画の同時刻だけ二重消費を防ぐ。
    const flags=input.features.onset.flags;
    if(t!==this.lastEventSec){
      if(flags&1)this.lastKick=t;
      if(flags&4){
        const serial=this.streakSerial++,o=(serial%c.LIGHT_STREAK_COUNT)*4;
        const h=worldGargantuaEventHash('gargantua:',serial,input.engine.seed),h2=worldGargantuaEventHash('gargantua-angle:',serial,input.engine.seed);
        this.streaks[o]=c.LIGHT_STREAK_INNER+(c.LIGHT_STREAK_OUTER-c.LIGHT_STREAK_INNER)*h/4294967296;
        this.streaks[o+1]=h2/4294967296*Math.PI*2;this.streaks[o+2]=t;this.streaks[o+3]=1;this.highOnsetPhase++;
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
    gl.uniform3fv(this.gravityLoc,this.gravity);gl.uniform4fv(this.cameraLoc,this.camera);gl.uniform4fv(this.view2Loc,this.view2);gl.uniform4fv(this.musicLoc,this.music);gl.uniform4fv(this.streakLoc,this.streaks);
    gl.uniform2f(this.outputLoc,input.target.width,input.target.height);g.draw();
    g.bind(this.upsample,input.target);g.sampler(this.sourceLoc,0,this.half);g.draw();
  }
}
if(typeof module!=='undefined'&&module.exports){module.exports={WorldGargantuaAnalyzer,WORLD_GARGANTUA,WORLD_GARGANTUA_CAMERA,worldGargantuaEventHash};}
