// 目的 — 光の糸の束でできたマーフの部屋の格子（テッセラクト v2）— doc/20261027-design-tesseract-v2.md
const WORLD_TESSERACT = Object.freeze({
  FOV: 80,                       // 縦の画角（度）
  SPEED_BASE: 6, SPEED_LOUD: 9, SPEED_SCALE: .8,   // 前進の速さ = SPEED_SCALE*(SPEED_BASE+SPEED_LOUD*loud) [単位/秒]
  CORNER: 1,                     // 道の角の丸み（2 次ベジエの半径。角の中点は通路の中心から .35 ずれる。押し出しまでの余裕は .75）
  ROOMS_MIN: 3, ROOMS_SPAN: 5,   // 1 区間に進む部屋の数 = ROOMS_MIN + floor(R()*ROOMS_SPAN)（3〜7 部屋）
  LOOK_STEPS: 8, LOOK_STEP: 3,   // 視線 = 先の道 k*LOOK_STEP（k=1..8）への方向の平均
  BANK_NEAR: 8, BANK_FAR: 24, BANK_GAIN: .6,       // 曲がる向きへの傾き
  ROLL_RATE: .12, ROLL_SWAY: .35, ROLL_SWAY_RATE: .25,
  SWAY_RATE_X: .5, SWAY_X: .22, SWAY_RATE_Y: .4, SWAY_Y: .18, SWAY_PHASE_Y: 1.3, SWAY_RATE_Z: .28, SWAY_Z: .12, SWAY_PHASE_Z: 2.1,
  PATH_NODES: 4096,              // 道の折れ点の数
  LEVEL_ATTACK: .048, LEVEL_RELEASE: .26,          // 帯域群のなめらかな音量の時定数（秒）
  LOUD_ATTACK: .065, LOUD_RELEASE: .4,             // 全体音量の時定数（秒）
  LOUD_LO: .33, LOUD_HI: .93,    // loudness.level を 0..1 へ写す範囲。128 BPM のテスト曲で静か .40→.12、ドロップ .67→.57
  ENERGY_TAU: .54, CENTROID_TAU: 1.09,
  PHASE_BASE: .015, PHASE_GAIN: .12, PHASE_RATE: 4, PHASE_TIMBRE: .6,
  AGE_MAX: 9, REFRACTORY: .12,   // 同じ群の立ち上がりを数えない間隔（秒）
  BEAT_HOLD: 2,                  // 最後の拍からこの秒数のあいだは拍だけで明滅させる（帯域ごとの立ち上がりは使わない）
  EXPOSURE: 1.8,
  VIGNETTE: .35,
  FLASH_GAIN: 1.6,                // 拍の明滅の強さ（エンジンの後処理で暗くなり、明滅が埋もれないように強める）
  BLOOM_THRESHOLD: .05, BLOOM_STRENGTH: .7
});
// 色（sRGB）。JS で linear にしてから GLSL 定数にする（設計 §3）。
const WORLD_TESSERACT_COLORS = Object.freeze({
  WOOD: Object.freeze(['#2D1C15', '#493225', '#5C4739', '#695241', '#77634F', '#8F7B63']),
  BOOK: Object.freeze(['#6B4A2C', '#89612B', '#806A66', '#9E8785', '#7A6D30', '#938C47', '#566B67', '#B1B15F']),
  SILVER: Object.freeze(['#8C8473', '#A49A89', '#B9B1A3', '#CECBC7']),
  AMB: Object.freeze(['#E07E34', '#89612B', '#8B6250', '#6B4A2C', '#C98A4B']),
  GLD: Object.freeze(['#D4AF37', '#CFB53B', '#DAA520', '#B8860B', '#E6BE8A'])
});
const WORLD_TESSERACT_COLORS_LINEAR = Object.freeze(Object.fromEntries(Object.entries(WORLD_TESSERACT_COLORS).map(([name, list]) =>
  [name, Object.freeze(list.map(hex => worldSrgbToLinear(hex, new Float32Array(3))))])));
const WORLD_TESSERACT_VEC3_LIST = list => list.map(c => `vec3(${c[0].toFixed(8)},${c[1].toFixed(8)},${c[2].toFixed(8)})`).join(',');
function worldTesseractShaderBody() {
  const C = WORLD_TESSERACT, LIN = WORLD_TESSERACT_COLORS_LINEAR, VEC3_LIST = WORLD_TESSERACT_VEC3_LIST;
  const WOOD = LIN.WOOD, BOOK = LIN.BOOK, SILVER = LIN.SILVER, AMB = LIN.AMB, GLD = LIN.GLD;
  return `in vec2 vUv;
out vec4 frag;
uniform vec2 resolution;
uniform float tSec, tanH, pxk;   // pxk = 2*tanH/resolution.y（距離 1 あたりの画素の大きさ）
uniform vec3 camPos;
uniform mat3 camRot;             // 列 = 右、上、前
uniform vec4 lvl, sm, age, age2, cnt; // 帯域群 4 つ: 生の音量、なめらかな音量、最後の立ち上がりからの秒、1 つ前の立ち上がりからの秒、立ち上がりの回数
uniform float loud, phase;
const float L=4.;
const float H=1.25;
const int N=14;
const int MN=4;
const int S=3;
const float EXPOSURE=${C.EXPOSURE.toFixed(8)};
const float VIGNETTE=${C.VIGNETTE.toFixed(8)};
const float FLASH_GAIN=${C.FLASH_GAIN.toFixed(8)};
const vec3 WOOD[6]=vec3[](${VEC3_LIST(WOOD)});
const vec3 BOOK[8]=vec3[](${VEC3_LIST(BOOK)});
const vec3 SILVER[4]=vec3[](${VEC3_LIST(SILVER)});
const vec3 AMB[5]=vec3[](${VEC3_LIST(AMB)});
const vec3 GLD[5]=vec3[](${VEC3_LIST(GLD)});
uint hu(uint x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;return x;}
float h3(ivec3 c,int s){return float(hu(uint(c.x)*73856093u^uint(c.y)*19349663u^uint(c.z)*83492791u^uint(s)*2654435761u))/4294967295.;}
float vn(float x,int s){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
  return mix(float(hu(uint(int(i))+uint(s)*977u))/4294967295.,float(hu(uint(int(i)+1)+uint(s)*977u))/4294967295.,f);}
// 色: 位相 phase に沿ってアンバー（0）と黄金（1）の間を cos で連続的に往復する。梁ごとに位相が少しずれ、色の波が空間を渡る
vec3 palCol(float hb,float hc,float hs,vec3 base,float along){
  float pf=phase+.6*(hb-.5)+.15*sin(along*.02+hb*6.283);
  float w=.5-.5*cos(pf*3.14159);
  vec3 amb=mix(AMB[int(hc*5.)%5]*(.6+.7*hs),base,.2), gld=GLD[int(hc*5.)%5]*(.55+.7*hs);
  return mix(amb,gld,w);
}
// 束ごとの明滅: 梁は 4 帯域群のどれかに属し、その群の立ち上がりで、選ばれた束（16%）が束ごと光る。
// 光は長い尾（70 単位）を引くストロークとして押し出しに沿って毎秒 26 単位で進み、束全体も明るむ。
// 今回と 1 つ前の立ち上がりを重ね、次の拍で前の光が途切れないようにする
float flash1(ivec3 key,int a,float along,float ag,float cn){
  ivec3 kk=key+ivec3(int(cn)*101,0,0);
  float sel=step(h3(kk,a*7+53),.16);
  float env=exp(-ag*2.)*smoothstep(0.,.05,ag+.02);
  float org=(h3(kk,a*7+59)-.5)*60.,dir=h3(kk,a*7+61)<.5?-1.:1.;
  float x=(along-org)*dir-26.*ag;
  float stroke=smoothstep(-70.,0.,x)*(1.-smoothstep(0.,4.,x));
  return sel*env*(.6+2.6*stroke)*FLASH_GAIN;
}
float flash(ivec3 key,int a,float along){
  int b=int(h3(key,a*7+47)*4.);
  return flash1(key,a,along,age[b],cnt[b])+flash1(key,a,along,age2[b],cnt[b]-1.);
}
// 梁の明るさ: すべての梁が常に光り、明るさは全体の音量と、梁の帯域群のなめらかな音量に追従する。明滅はその上に重なる
float beamLight(ivec3 key,int a,float along){
  int b=int(h3(key,a*7+47)*4.);
  float p=.22+.75*pow(h3(key,a*7+41),1.6);
  float g=(.42+.5*loud)*(.6+.6*sm[b]);
  return p*g+flash(key,a,along);
}
int fblock(int c){return c>=0?c/MN:-((-c+MN-1)/MN);}
int fold(int c){int b=fblock(c),r=c-b*MN;return (b&1)==0?r:MN-1-r;}
bool hasB(int a,ivec3 c){
  if(a==0)return ((c.y+c.z)&1)==0;
  if(a==1)return ((c.x+c.z)&1)==0;
  return ((c.x+c.y)&1)==1;
}
// 部屋の断面の升目 (i,j) の材質。0 空気、1 壁・床（木）、2 本棚の板、3 本、4 家具、5 ランプ、6 窓。j=0 が床側
int mat(ivec3 key,int a,int i,int j){
  int e=N-1;
  float hr=h3(key,a*31+7);
  if(i==0||j==0||i==e||j==e){
    float g=h3(key+ivec3(i,j,a),11);
    int side=i==0?0:i==e?1:j==0?2:3;
    if(side==int(hr*4.)&&((side<2?j:i)>=6&&(side<2?j:i)<=7))return 6;
    return g<.55?1:0;
  }
  int sw=int(h3(key,a*31+9)*2.);
  int depth=sw==0?i:e-i;
  if(depth<=2&&j<e-1){
    if(j%3==0)return 2;
    float hb=h3(key+ivec3(i,j,a),13);
    return hb<.85?3:0;
  }
  int fx=4+int(hr*5.);
  if(j<=2&&i>=fx&&i<fx+4)return 4;
  if(j==3&&i==fx+1&&h3(key,a*31+15)<.7)return 5;
  if(j==e-1&&abs(i-N/2)<=1&&h3(key,a*31+17)<.5)return 5;
  return 0;
}
struct Hit{float t;vec3 n;int m;float along;ivec3 key;int a;int i;ivec2 rod;};
vec3 G;
// ランプと窓は、押し出しの長さ方向に点いている区間と消えている区間がある
float onSeg(float along,ivec3 key,int a){float v=vn(along*.12+float(a)*17.,key.x*13+key.y*7+key.z*3+a);return smoothstep(.5,.6,v);}
float matLight(int m){return m==5?3.2:m==6?1.6:0.;}
void beam(vec3 ro,vec3 rd,vec3 C,int a,ivec3 key,vec2 flip,float t0,float t1,inout Hit h){
  int a1=(a+1)%3,a2=(a+2)%3;
  vec2 o=vec2(ro[a1]-C[a1],ro[a2]-C[a2])*flip; vec2 d=vec2(rd[a1],rd[a2])*flip;
  vec2 inv=1./(sign(d)*max(abs(d),vec2(1e-6)));
  vec2 lo=(vec2(-H)-o)*inv, hi=(vec2(H)-o)*inv;
  vec2 mn=min(lo,hi), mx=max(lo,hi);
  float ta=max(max(mn.x,mn.y),t0), tb=min(min(mx.x,mx.y),min(t1,h.t));
  if(tb<=ta)return;
  const int NF=N*S;
  float cs=2.*H/float(NF);
  vec2 p=o+d*(ta+1e-4);
  ivec2 c=clamp(ivec2(floor((p+H)/cs)),ivec2(0),ivec2(NF-1));
  ivec2 st=ivec2(sign(d));
  vec2 nb=(vec2(c)+max(sign(d),0.))*cs-H;
  vec2 tm=(nb-o)*inv; vec2 td=abs(cs*inv);
  float tc=ta; float A=max(dot(d,d),1e-8);
  for(int k=0;k<2*NF+2;k++){
    float tn=min(min(tm.x,tm.y),tb);
    int m=mat(key,a,c.x/S,c.y/S);
    if(m!=0){
      ivec3 rk=key+ivec3(c.x*7,c.y*13,a*5);
      float hr=h3(rk,29);
      vec2 cc=(vec2(c)+.5)*cs-H+(vec2(h3(rk,31),h3(rk,37))-.5)*cs*.2;
      float pw=pxk*max(tc,.1);
      // 遠くで糸が画素より細くなったら、太らせて面へ溶かす（ちらつき防止）
      float rr=cs*mix(m>=5?.2:.26+.2*hr,.56,smoothstep(.12,.55,pw/cs));
      vec2 oc=o-cc; float B=dot(oc,d), Cq=dot(oc,oc)-rr*rr, disc=B*B-A*Cq;
      float tcl=clamp(-B/A,tc,tn);
      float dm=length(oc+d*tcl);
      float hs=h3(rk,23);
      float proj=beamLight(key,a,ro[a]+rd[a]*tcl);
      float lit=matLight(m)*onSeg(ro[a]+rd[a]*tcl,key,a)+(hs>.9?1.4*proj:0.)+.14*proj;
      if(lit>0.&&tcl<h.t){
        float gw=cs*.9+pw; float far=1.-smoothstep(.3,1.2,pw/cs);
        vec3 gc=m>=5?vec3(1.,.9,.74):mix(vec3(.95,.9,.82),palCol(h3(key,a*7+43),.5,.8,vec3(.9),ro[a]+rd[a]*tcl),.6);
        G+=gc*lit*exp(-max(dm-rr,0.)/gw)*.09*min((tn-tc)*sqrt(A)/cs,1.5)*far;
      }
      if(disc>0.){
        float th=(-B-sqrt(disc))/A;
        if(th<tn&&th>=ta-1e-4&&th<h.t){
          vec2 q=o+d*th; vec2 n2=(q-cc)/rr;
          vec3 n=vec3(0.); n[a1]=n2.x*flip.x; n[a2]=n2.y*flip.y;
          h.t=th;h.n=n;h.m=m;h.along=ro[a]+rd[a]*th;h.key=key;h.a=a;h.i=c.x/S;h.rod=c;
          return;
        }
      }
    }
    if(tm.x<tm.y){tc=tm.x;c.x+=st.x;tm.x+=td.x;}
    else{tc=tm.y;c.y+=st.y;tm.y+=td.y;}
    if(tc>=tb||c.x<0||c.y<0||c.x>=NF||c.y>=NF)return;
  }
}
Hit trace(vec3 ro,vec3 rd){
  Hit h; h.t=1e9; h.m=0;
  vec3 cf=floor((ro+L*.5)/L); ivec3 cell=ivec3(cf);
  vec3 sv=sign(rd); vec3 inv=1./max(abs(rd),vec3(1e-6));
  vec3 tMax=((cf+max(sv,0.))*L-L*.5-ro)/rd; vec3 tDel=L*inv;
  float t0=0.;
  for(int i=0;i<64;i++){
    float t1=min(tMax.x,min(tMax.y,tMax.z));
    ivec3 bk=ivec3(fblock(cell.x),fblock(cell.y),fblock(cell.z));
    ivec3 fc=ivec3(fold(cell.x),fold(cell.y),fold(cell.z));
    vec3 fl=vec3((bk.x&1)==0?1.:-1.,(bk.y&1)==0?1.:-1.,(bk.z&1)==0?1.:-1.);
    for(int a=0;a<3;a++){
      if(!hasB(a,fc))continue;
      vec3 C=vec3(cell)*L;
      ivec3 key=a==0?ivec3(0,fc.y,fc.z):a==1?ivec3(fc.x,0,fc.z):ivec3(fc.x,fc.y,0);
      int a1=(a+1)%3,a2=(a+2)%3;
      beam(ro,rd,C,a,key,vec2(fl[a1],fl[a2]),t0,t1,h);
    }
    if(h.t<t1)break;
    if(tMax.x<tMax.y&&tMax.x<tMax.z){cell.x+=int(sv.x);tMax.x+=tDel.x;}
    else if(tMax.y<tMax.z){cell.y+=int(sv.y);tMax.y+=tDel.y;}
    else{cell.z+=int(sv.z);tMax.z+=tDel.z;}
    t0=t1;
    if(t0>140.)break;
  }
  return h;
}
vec3 shade(Hit h,vec3 rd,float pxw){
  ivec3 sk=h.key+ivec3(h.i*7,(h.rod.y/S)*13,h.a*5);
  float hc=h3(sk,21);
  vec3 base; float emis=0.;
  if(h.m==1)base=WOOD[int(hc*6.)%6];
  else if(h.m==2)base=WOOD[1];
  else if(h.m==3)base=BOOK[int(hc*8.)%8];
  else if(h.m==4)base=WOOD[2+int(hc*3.)%3];
  else {base=vec3(1.,.93,.8); emis=h.m==5?3.:.9;}
  ivec3 rk=h.key+ivec3(h.rod.x*7,h.rod.y*13,h.a*5);
  float hs=h3(rk,23),hcol=h3(rk,25);
  float vis=clamp(1.3-pxw*float(S),0.,1.);
  float stripe=mix(1.,.35+1.3*hs*hs,vis);
  vec3 tint=mix(base,SILVER[int(hcol*4.)%4]*.8,.35*vis*step(.6,hcol));
  float flow=.5+.5*vn(h.along*.6-tSec*(.5+hs)+hc*40.,h.rod.x*31+h.rod.y*7);
  tint=palCol(h3(h.key,h.a*7+43),hcol,hs,tint,h.along);
  float proj=beamLight(h.key,h.a,h.along);
  vec3 Lk=normalize(vec3(.4,.7,-.5));
  float diff=.12+.7*max(dot(h.n,Lk),0.)+.25*max(dot(h.n,-rd),0.);
  vec3 col=tint*stripe*flow*proj*diff;
  vec3 hv=normalize(Lk-rd), hv2=normalize(-rd+vec3(0.,.3,0.));
  float spec=pow(max(dot(h.n,hv),0.),48.)*1.2+pow(max(dot(h.n,hv2),0.),90.)*.8;
  col+=mix(vec3(1.,.96,.9),tint,.35)*spec*(.25+proj)*(.4+.6*flow)*(.3+.7*vis);
  float hot=step(.93,hs);
  col+=mix(vec3(1.,.95,.86),tint,.4)*hot*1.6*proj*flow;
  if(emis>0.){
    float fl2=.75+.25*vn(tSec*3.+hc*20.,h.i);
    float day=h.m==6?.2+pow(hs,2.)*1.6:(.6+.4*stripe); float on=onSeg(h.along,h.key,h.a);
    col=mix(WOOD[3]*proj*.6,base*emis*fl2*day*flow,on);
  }
  return col;
}
void main(){
  vec2 ndc=vUv*2.-1.;
  vec3 rd=normalize(camRot*vec3(ndc.x*resolution.x/resolution.y*tanH,ndc.y*tanH,1.));
  vec3 ro=camPos;
  G=vec3(0.);
  Hit h=trace(ro,rd);
  vec3 col=vec3(.004,.003,.003);
  float depth=200.;
  if(h.m!=0){
    depth=h.t;
    float pxw=h.t*2.*tanH/resolution.y/max(abs(dot(h.n,rd)),.05)/(2.*H/float(N));
    col=shade(h,rd,pxw);
    float mc=max(col.r,max(col.g,col.b)); if(mc>1.)col*=(1.+(mc-1.)*.25)/mc;
    vec3 hp=ro+rd*h.t;
    ivec3 c0=ivec3(floor((ro+L*.5)/L)),c1=ivec3(floor((hp+L*.5)/L));
    ivec3 b0=ivec3(fblock(c0.x),fblock(c0.y),fblock(c0.z)),b1=ivec3(fblock(c1.x),fblock(c1.y),fblock(c1.z));
    float gen=float(abs(b1.x-b0.x)+abs(b1.y-b0.y)+abs(b1.z-b0.z));
    col*=pow(.78,gen)*pow(vec3(.94,1.,.97),vec3(gen));
    col*=exp(-h.t*.045);
  }
  col+=G*exp(-min(depth,200.)*.025);
  col*=1.-VIGNETTE*dot(ndc*.75,ndc*.75);
  if(any(isnan(col))||any(isinf(col)))col=vec3(0.);
  frag=vec4(min(col,vec3(60.))*EXPOSURE,1.);
}
`;
}
// 設計 §4 の本文には sampler2D の精度宣言が無いが、全 WORLD シェーダーの監査（UW-47）に合わせて足す（sampler は使わないので出力は変わらない）
const WORLD_TESSERACT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${worldTesseractShaderBody()}`;
// 帯域群（§5.1）: [開始帯域, 終了帯域（含む）]
const WORLD_TESSERACT_GROUPS = Object.freeze([Object.freeze([0, 3]), Object.freeze([4, 13]), Object.freeze([14, 23]), Object.freeze([24, 31])]);
const WORLD_TESSERACT_UNIFORM_NAMES = Object.freeze(['resolution', 'tSec', 'tanH', 'pxk', 'camPos', 'camRot', 'loud', 'phase']);
// 道の乱数（§6.1）
function worldTesseractBuildPath(seed, nodes, cum, axisOf, signOf) {
  const C = WORLD_TESSERACT, n = C.PATH_NODES;
  let x = seed >>> 0;
  const R = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
  nodes[0] = 2; nodes[1] = 2; nodes[2] = 2; cum[0] = 0;
  let axis = 2, sign = 1;
  for (let k = 0; k < n - 1; k++) {
    const rooms = C.ROOMS_MIN + Math.floor(R() * C.ROOMS_SPAN), len = 4 * rooms;
    axisOf[k] = axis; signOf[k] = sign;
    nodes[(k + 1) * 3] = nodes[k * 3]; nodes[(k + 1) * 3 + 1] = nodes[k * 3 + 1]; nodes[(k + 1) * 3 + 2] = nodes[k * 3 + 2];
    nodes[(k + 1) * 3 + axis] += sign * len;
    cum[k + 1] = cum[k] + len;
    // 残り 2 軸からどちらかを選び、向きを選ぶ（乱数を呼ぶ順: n、軸、向き）
    const other0 = (axis + 1) % 3, other1 = (axis + 2) % 3;
    const lo = Math.min(other0, other1), hi = Math.max(other0, other1);
    axis = R() < .5 ? lo : hi;
    sign = R() < .5 ? -1 : 1;
  }
}
class WorldTesseractAnalyzer extends WorldBandAnalyzer {
  constructor() {
    super(); this.id = 'g-tesseract'; this.label = 'テッセラクト';
    this.statelessRender = true; // フレーム間のGPU履歴を持たない
    const n = WORLD_TESSERACT.PATH_NODES;
    this.pathNodes = new Float64Array(n * 3); this.pathCum = new Float64Array(n);
    this.pathAxis = new Uint8Array(n); this.pathSign = new Int8Array(n);
    // 音の状態（シェーダーへ渡す。毎フレーム再利用し、確保しない）
    this.lvl = new Float32Array(4); this.sm = new Float32Array(4); this.age = new Float32Array(4); this.age2 = new Float32Array(4); this.cnt = new Float32Array(4);
    this.lastOn = new Float64Array(4); this.prevOn = new Float64Array(4);
    this.camPos = new Float32Array(3); this.camRot = new Float32Array(9);
    this.up = new Float64Array(3); this.fwd = new Float64Array(3); this.posTmp = new Float64Array(3); this.posTmp2 = new Float64Array(3); this.accTmp = new Float64Array(3);
    this.reset();
  }
  reset() {
    super.reset(); if (!this.lvl) return;
    this.lvl.fill(0); this.sm.fill(0); this.age.fill(WORLD_TESSERACT.AGE_MAX); this.age2.fill(WORLD_TESSERACT.AGE_MAX); this.cnt.fill(0);
    this.lastOn.fill(-100); this.prevOn.fill(-100);
    this.loud = 0; this.energy = 0; this.cen = 1.5; this.phaseAcc = 0; this.phase = 0;
    this.lastEventSec = -1; this.lastBeatSec = -100; this.lastBeatIndex = 0; this.previewDownbeatIndex = 0;
    this.s = 0; this.pathSeed = null; this.tanH = Math.tan(WORLD_TESSERACT.FOV * Math.PI / 360);
    this.camPos.fill(0); this.camRot.fill(0); this.camRot[0] = 1; this.camRot[4] = 1; this.camRot[8] = 1;
    this.up[0] = 0; this.up[1] = 1; this.up[2] = 0; this.fwd[0] = 0; this.fwd[1] = 0; this.fwd[2] = 1;
  }
  init(gpu) {
    super.init(gpu); this.program = gpu.program(WORLD_TESSERACT_FRAGMENT);
    for (const name of WORLD_TESSERACT_UNIFORM_NAMES) this[name + 'Loc'] = gpu.texture(this.program, name);
    for (const name of ['lvl', 'sm', 'age', 'age2', 'cnt']) this[name + 'Loc'] = gpu.texture(this.program, name);
  }
  // 道の上の位置（§6.2）。角は 2 次ベジエで丸める
  at(s, out) {
    const C = WORLD_TESSERACT, r = C.CORNER, n = C.PATH_NODES, cum = this.pathCum, P = this.pathNodes, ax = this.pathAxis, sg = this.pathSign;
    const segs = n - 1;
    if (s < 0) s = 0; if (s > cum[segs] - 1e-6) s = cum[segs] - 1e-6;
    let lo = 0, hi = segs - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid - 1; }
    const k = lo, u = s - cum[k], len = cum[k + 1] - cum[k];
    let corner = -1, w = 0, a0 = 0, s0 = 0, a1 = 0, s1 = 0;
    if (u > len - r && k + 1 < segs) {
      corner = k + 1; w = (u - (len - r)) / (2 * r); a0 = ax[k]; s0 = sg[k]; a1 = ax[k + 1]; s1 = sg[k + 1];
    } else if (u < r && k > 0) {
      corner = k; w = (u + r) / (2 * r); a0 = ax[k - 1]; s0 = sg[k - 1]; a1 = ax[k]; s1 = sg[k];
    }
    if (corner < 0) {
      out[0] = P[k * 3]; out[1] = P[k * 3 + 1]; out[2] = P[k * 3 + 2]; out[ax[k]] += sg[k] * u; return out;
    }
    const b0 = (1 - w) * (1 - w), b1 = 2 * (1 - w) * w, b2 = w * w;
    for (let i = 0; i < 3; i++) {
      const c = P[corner * 3 + i];
      out[i] = b0 * (c - (i === a0 ? s0 * r : 0)) + b1 * c + b2 * (c + (i === a1 ? s1 * r : 0));
    }
    return out;
  }
  _buildPath(seed) {
    worldTesseractBuildPath(seed, this.pathNodes, this.pathCum, this.pathAxis, this.pathSign);
    this.pathSeed = seed; this.s = 0;
    this.up[0] = 0; this.up[1] = 1; this.up[2] = 0;
  }
  _fire(g, t) { if (t - this.lastOn[g] < WORLD_TESSERACT.REFRACTORY) return; this.prevOn[g] = this.lastOn[g]; this.lastOn[g] = t; this.cnt[g]++; }
  step(input) {
    this.update(input);
    const c = WORLD_TESSERACT, t = input.tSec, dt = input.dt, f = input.features, engine = input.engine, b = this.bandUniforms;
    const seed = engine.score.seed >>> 0;
    if (seed !== this.pathSeed) this._buildPath(seed);
    // 音の状態（§5）
    for (let g = 0; g < 4; g++) {
      const g0 = WORLD_TESSERACT_GROUPS[g][0], g1 = WORLD_TESSERACT_GROUPS[g][1];
      let sum = 0;
      for (let i = g0; i <= g1; i++) sum += b[i * 4];
      const v = sum / (g1 - g0 + 1); this.lvl[g] = v;
      const tau = v > this.sm[g] ? c.LEVEL_ATTACK : c.LEVEL_RELEASE;
      this.sm[g] += (v - this.sm[g]) * (1 - Math.exp(-dt / tau));
    }
    const x = Math.max(0, Math.min(1, (f.loudness.level - c.LOUD_LO) / (c.LOUD_HI - c.LOUD_LO)));
    this.loud += (x - this.loud) * (1 - Math.exp(-dt / (x > this.loud ? c.LOUD_ATTACK : c.LOUD_RELEASE)));
    const l0 = this.lvl[0], l1 = this.lvl[1], l2 = this.lvl[2], l3 = this.lvl[3];
    const e = (l0 * 1.2 + l1 + l2 + l3 * .8) / 4;
    this.energy += (e - this.energy) * (1 - Math.exp(-dt / c.ENERGY_TAU));
    const cc = (l1 + 2 * l2 + 3 * l3) / Math.max(l0 + l1 + l2 + l3, 1e-3);
    this.cen += (cc - this.cen) * (1 - Math.exp(-dt / c.CENTROID_TAU));
    this.phaseAcc += dt * (c.PHASE_BASE + c.PHASE_GAIN * this.energy * this.energy) * c.PHASE_RATE;
    this.phase = this.phaseAcc + c.PHASE_TIMBRE * (this.cen - 1.5);
    // 立ち上がり。同じ t での再呼び出しでは二重に数えない
    if (t !== this.lastEventSec) {
      if (engine.preview) {
        if (engine.beatIndex !== this.lastBeatIndex) { this._fire(0, t); this._fire(1, t); this.lastBeatIndex = engine.beatIndex; }
        const db = engine.score.downbeats; let crossed = false;
        while (this.previewDownbeatIndex < db.length && db[this.previewDownbeatIndex] <= t) { this.previewDownbeatIndex++; crossed = true; }
        if (crossed) { this._fire(2, t); this._fire(3, t); }
      } else {
        // 拍があるあいだは拍だけで 4 群を立てる（MFS は中高域の立ち上がりを拍より多く出すため、明滅が細かく散って拍が見えなくなる）。
        // 拍が BEAT_HOLD 秒ないときだけ、帯域ごとの立ち上がりを使う
        if (f.tempo.beatFlag) { this.lastBeatSec = t; for (let g = 0; g < 4; g++) this._fire(g, t); }
        else if (t - this.lastBeatSec > c.BEAT_HOLD) { const flags = f.onset.flags; for (let g = 0; g < 4; g++) if (flags & (1 << g)) this._fire(g, t); }
      }
      this.lastEventSec = t;
    }
    for (let g = 0; g < 4; g++) {
      this.age[g] = Math.min(c.AGE_MAX, t - this.lastOn[g]); this.age2[g] = Math.min(c.AGE_MAX, t - this.prevOn[g]);
    }
    this._stepCamera(t, dt);
  }
  // カメラ（§6.3・§6.4）。配列は再利用する
  _stepCamera(t, dt) {
    const c = WORLD_TESSERACT, pos = this.posTmp, p2 = this.posTmp2, acc = this.accTmp, up = this.up, fw = this.fwd;
    this.s += c.SPEED_SCALE * (c.SPEED_BASE + c.SPEED_LOUD * this.loud) * dt;
    const s = this.s;
    this.at(s, pos);
    acc[0] = 0; acc[1] = 0; acc[2] = 0;
    for (let k = 1; k <= c.LOOK_STEPS; k++) {
      const d = k * c.LOOK_STEP; this.at(s + d, p2);
      acc[0] += (p2[0] - pos[0]) / d; acc[1] += (p2[1] - pos[1]) / d; acc[2] += (p2[2] - pos[2]) / d;
    }
    let n = Math.hypot(acc[0], acc[1], acc[2]) || 1;
    let fx = acc[0] / n, fy = acc[1] / n, fz = acc[2] / n;
    fx += c.SWAY_X * Math.sin(t * c.SWAY_RATE_X); fy += c.SWAY_Y * Math.sin(t * c.SWAY_RATE_Y + c.SWAY_PHASE_Y); fz += c.SWAY_Z * Math.sin(t * c.SWAY_RATE_Z + c.SWAY_PHASE_Z);
    n = Math.hypot(fx, fy, fz) || 1; fx /= n; fy /= n; fz /= n;
    fw[0] = fx; fw[1] = fy; fw[2] = fz;
    // 上向きは前のステップから平行移動で運ぶ
    const d = up[0] * fx + up[1] * fy + up[2] * fz;
    let ux = up[0] - fx * d, uy = up[1] - fy * d, uz = up[2] - fz * d;
    n = Math.hypot(ux, uy, uz);
    if (n < 1e-6) {
      // f に直交する任意の単位ベクトル
      if (Math.abs(fx) < .9) { ux = 0; uy = fz; uz = -fy; } else { ux = -fz; uy = 0; uz = fx; }
      n = Math.hypot(ux, uy, uz) || 1;
    }
    ux /= n; uy /= n; uz /= n; up[0] = ux; up[1] = uy; up[2] = uz;
    const rx = uy * fz - uz * fy, ry = uz * fx - ux * fz, rz = ux * fy - uy * fx;
    this.at(s + c.BANK_FAR, p2); this.at(s + c.BANK_NEAR, acc);
    let ax = p2[0] - acc[0], ay = p2[1] - acc[1], az = p2[2] - acc[2];
    n = Math.hypot(ax, ay, az) || 1; ax /= n; ay /= n; az /= n;
    const roll = c.ROLL_RATE * t + c.ROLL_SWAY * Math.sin(c.ROLL_SWAY_RATE * t) - c.BANK_GAIN * (ax * rx + ay * ry + az * rz);
    const cr = Math.cos(roll), sr = Math.sin(roll), m = this.camRot;
    m[0] = cr * rx + sr * ux; m[1] = cr * ry + sr * uy; m[2] = cr * rz + sr * uz;
    m[3] = -sr * rx + cr * ux; m[4] = -sr * ry + cr * uy; m[5] = -sr * rz + cr * uz;
    m[6] = fx; m[7] = fy; m[8] = fz;
    this.camPos[0] = pos[0]; this.camPos[1] = pos[1]; this.camPos[2] = pos[2];
  }
  render(input) {
    const g = this.gpu, gl = g.gl, w = input.target.width, h = input.target.height;
    g.bind(this.program, input.target);
    const tanH = Math.tan(WORLD_TESSERACT.FOV * Math.PI / 360);
    gl.uniform2f(this.resolutionLoc, w, h); gl.uniform1f(this.tSecLoc, input.tSec);
    gl.uniform1f(this.tanHLoc, tanH); gl.uniform1f(this.pxkLoc, 2 * tanH / h);
    gl.uniform3fv(this.camPosLoc, this.camPos); gl.uniformMatrix3fv(this.camRotLoc, false, this.camRot);
    gl.uniform4fv(this.lvlLoc, this.lvl); gl.uniform4fv(this.smLoc, this.sm);
    gl.uniform4fv(this.ageLoc, this.age); gl.uniform4fv(this.age2Loc, this.age2); gl.uniform4fv(this.cntLoc, this.cnt);
    gl.uniform1f(this.loudLoc, this.loud); gl.uniform1f(this.phaseLoc, this.phase);
    g.draw();
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldTesseractAnalyzer, WORLD_TESSERACT, WORLD_TESSERACT_COLORS, WORLD_TESSERACT_COLORS_LINEAR, WORLD_TESSERACT_FRAGMENT, worldTesseractBuildPath }; }
