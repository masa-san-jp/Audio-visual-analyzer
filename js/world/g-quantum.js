// 目的 — 「量子のビジョン」を、実写のレンズの質感（ぼけ・光跡・粉・粒子）の場面のモンタージュで描く（量子のビジョン v2）— doc/20261028-design-quantum-v2.md
const WORLD_QUANTUM = Object.freeze({
  FADE: 2.5,                     // 場面の切り替えにかける秒数（次の場面の開始時刻の FADE 秒前から溶かし始める）
  MINT_LEAD: 3,                  // drop の直前の build で、最後のこの秒数をミントの光にする
  DROP_SPLIT: 3,                 // drop 区間を 3 等分して、殻 → 火花 → 太陽面
  CAM_BASE: .14, CAM_LOUD: .5, CAM_PUSH: .45,   // 前進の速さの目標 = CAM_BASE + CAM_LOUD*loud + CAM_PUSH*push（層/秒）
  CAM_TAU: .35,                  // 速さが目標へ追いつく時定数（秒）
  PUSH_ATTACK: .08, PUSH_RELEASE: .6,           // 拍の押し出しの立ち上がりと減衰の時定数（秒）
  PAN_RATE_X: .23, PAN_X: .05, PAN_X_LOUD: .2,  // 横のパンの速度 = sin(t*PAN_RATE_X)*(PAN_X+PAN_X_LOUD*loud)
  PAN_RATE_Y: .17, PAN_PHASE_Y: 1, PAN_Y: .04, PAN_Y_LOUD: .14,
  ROLL_SWAY: .25, ROLL_SWAY_RATE: .09, ROLL_RATE: .02,   // 回転 = ROLL_SWAY*sin(t*ROLL_SWAY_RATE) + ROLL_RATE*t
  // 音の状態（テッセラクトと同じ。§5）
  LEVEL_ATTACK: .048, LEVEL_RELEASE: .26, LOUD_ATTACK: .065, LOUD_RELEASE: .4, LOUD_LO: .33, LOUD_HI: .93,
  AGE_MAX: 9, REFRACTORY: .12, BEAT_HOLD: 2,
  EXPOSURE: 1.47,                // ACES の前の露出。エンジンの後処理（×.75）で暗くなる分を補う
  VIGNETTE: .4,
  GRAIN: .035,                   // フィルム粒子（後処理で毎フレーム更新。§7）
  HALATION: .25,                 // 明るい所のまわりの暖色のにじみ（後処理。§7）
  BLOOM_THRESHOLD: .02, BLOOM_STRENGTH: .55,
  SPARK_COUNT: 128,              // 火花の群ごとの本数（3 群）
  SPARK_GRID: 48, SPARK_GRID_MIN: -2.4, SPARK_GRID_CELL: .1,   // 火花を登録する升目（場面の座標で [MIN, MIN+GRID*CELL]²）
  SPARK_GRID_CAP: 32,            // 1 升に登録する火花の上限
  SPARK_GRID_MARGIN: .03,        // 線分の外接矩形を広げる幅（最も太い線のにじみが届く距離より広い）
  RENDER_SCALE: .67,             // 内部の描画解像度（出力に対する比）。ぼけと粒子の柔らかい絵なので、縮めて描いて拡大する
  FADE_SCALE: .5,                // 溶かしの間（2 場面を描く）の内部解像度。動いている間なので粗さは目立たない
  PX_MIN: .5                     // 線・点の幅の下限（内部の描画画素）。これより細い線は太らせ、明るさを幅の比で下げる
});
// 場面の番号（シェーダーの scene。5 は欠番＝水面、不使用）
const WORLD_QUANTUM_SCENE = Object.freeze({ DUST: 0, SHELL: 1, SUN: 2, SPARKS: 3, STREAMS: 4, MINT: 6 });
// 色（sRGB）。JS で linear にしてから GLSL 定数にする（設計 §3）。
const WORLD_QUANTUM_COLORS = Object.freeze({
  TEAL: Object.freeze(['#1D5953', '#266B61', '#44A69B', '#3B796E', '#A3D3BE', '#1A6287', '#39A1B8', '#93B0BA']),
  TEAL_BG: Object.freeze(['#041104', '#06150D', '#071515', '#08212A']),
  SHELL: Object.freeze(['#72470B', '#885206', '#9F6105', '#B87405', '#D18D05', '#CABBA5']),
  SUN: Object.freeze(['#7B4402', '#884B01', '#935601', '#9F6401', '#AE7C01', '#BE9715', '#DBCC97']),
  SPARK: Object.freeze(['#A33C09', '#B95113', '#D47228', '#E89B51', '#F9D289']),
  GOLDB: Object.freeze(['#8C5522', '#A56C2D', '#C48939', '#DCA954', '#EDC67C']),
  STREAK: Object.freeze(['#285668', '#457688', '#719FAD', '#B3DEDA', '#155792', '#3785BE', '#5FA0D2']),
  MINT: Object.freeze(['#A7ECCD', '#B3F0CF', '#C1F0C4', '#CAF3CE', '#3A5148'])
});
const WORLD_QUANTUM_COLORS_LINEAR = Object.freeze(Object.fromEntries(Object.entries(WORLD_QUANTUM_COLORS).map(([name, list]) =>
  [name, Object.freeze(list.map(hex => worldSrgbToLinear(hex, new Float32Array(3))))])));
const WORLD_QUANTUM_VEC3_LIST = list => list.map(c => `vec3(${c[0].toFixed(8)},${c[1].toFixed(8)},${c[2].toFixed(8)})`).join(',');
// 曲の区間から場面の予定表 [開始秒, 場面] を作る（設計 §6.2）。starts/scenes は呼び出し側が確保した配列（容量 = 区間数*3+2 以上）。行数を返す
function worldQuantumBuildSchedule(sections, starts, scenes) {
  const C = WORLD_QUANTUM, S = WORLD_QUANTUM_SCENE;
  let n = 0;
  const add = (start, scene) => { if (n > 0 && scenes[n - 1] === scene) return; starts[n] = start; scenes[n] = scene; n++; };
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i], a = s.startSec, b = s.endSec;
    switch (s.kind) {
      case 'build':
        add(a, S.STREAMS);
        if (i + 1 < sections.length && sections[i + 1].kind === 'drop' && b - C.MINT_LEAD > a) add(b - C.MINT_LEAD, S.MINT);
        break;
      case 'drop': {
        const len = (b - a) / C.DROP_SPLIT;
        add(a, S.SHELL); add(a + len, S.SPARKS); add(a + 2 * len, S.SUN);
        break;
      }
      case 'break': add(a, S.DUST); add(a + (b - a) / 2, S.STREAMS); break;
      case 'main': add(a, s.variation % 2 === 1 ? S.SHELL : S.SUN); break;
      default: add(a, S.DUST); // intro・outro
    }
  }
  return n;
}
// 火花の 3 群の引数: 時間の倍率, 発生点, 広がり, 速さ, 重力, 寿命, seed, 明るさ, 露光時間, 太さ, 発生点のばらつき
const WORLD_QUANTUM_SPARK_BURSTS = Object.freeze([
  Object.freeze([1, .02, .03, 6.283, .8, .3, .8, 3, 1.4, .03, 1.6, .5]),
  Object.freeze([1.3, .02, -.02, 6.283, .45, .2, 1.1, 4, 1, .02, 1.2, .8]),
  Object.freeze([.8, .12, .18, 6.283, .3, .1, 1.4, 5, .8, .025, 1.4, .9])
]);
function worldQuantumShaderBody() {
  const C = WORLD_QUANTUM, LIN = WORLD_QUANTUM_COLORS_LINEAR, VEC3_LIST = WORLD_QUANTUM_VEC3_LIST;
  return `out vec4 frag;
uniform vec2 res;               // 描画先の幅・高さ（画素）
uniform float time;             // 曲の時刻（秒）
uniform int scene; uniform int sceneB; uniform float mixW;   // 今の場面、次の場面、溶かす量（0..1）
uniform float camZ; uniform float ts;    // 前進量（層）、この描画の場面の経過秒
uniform float camV; uniform vec2 camPan; uniform float camRoll;
uniform vec4 lvl; uniform vec4 sm; uniform vec4 age; uniform float loud;
const int SPARKS=${WORLD_QUANTUM_SPARK_BURSTS.length * C.SPARK_COUNT}; uniform sampler2D sparkTex;   // 火花の線分（行 0）と性質（行 1）。CPU で計算
uniform sampler2D sparkGrid;  // 升ごとの火花: 行 0 の r = 本数、行 1.. = 番号（1 texel に 4 つ）
const int SG_N=${C.SPARK_GRID}, SG_CAP=${C.SPARK_GRID_CAP}; const float SG_MIN=${C.SPARK_GRID_MIN.toFixed(8)}, SG_CELL=${C.SPARK_GRID_CELL.toFixed(8)};
const float EXPOSURE=${C.EXPOSURE.toFixed(8)}; const float VIGNETTE=${C.VIGNETTE.toFixed(8)};
const vec3 TEAL[8]=vec3[](${VEC3_LIST(LIN.TEAL)}); const vec3 TEAL_BG[4]=vec3[](${VEC3_LIST(LIN.TEAL_BG)}); const vec3 SHELL[6]=vec3[](${VEC3_LIST(LIN.SHELL)}); const vec3 SUN[7]=vec3[](${VEC3_LIST(LIN.SUN)});
const vec3 SPARK[5]=vec3[](${VEC3_LIST(LIN.SPARK)}); const vec3 GOLDB[5]=vec3[](${VEC3_LIST(LIN.GOLDB)}); const vec3 STREAK[7]=vec3[](${VEC3_LIST(LIN.STREAK)}); const vec3 MINT[5]=vec3[](${VEC3_LIST(LIN.MINT)});
const float PXREF=1440.; const float PX_MIN=${C.PX_MIN.toFixed(8)};
float PX=1./PXREF, PXE=1.;    // 線・点の幅の単位（main で決める）と、太らせた分の明るさの補正
uint hu(uint x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;return x;}
float h1(ivec2 c,int s){return float(hu(uint(c.x)*73856093u^uint(c.y)*19349663u^uint(s)*83492791u))/4294967295.;}
vec2 h2(ivec2 c,int s){return vec2(h1(c,s),h1(c,s+101));}
// 1 回のハッシュを 8 ビットずつに分けた 4 つの乱数（0..1）。粒や火花の性質のように粗くてよい値に使う
vec4 h4(ivec2 c,int s){uint x=hu(uint(c.x)*73856093u^uint(c.y)*19349663u^uint(s)*83492791u);return (vec4(x&255u,(x>>8)&255u,(x>>16)&255u,x>>24)+.5)/256.;}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);ivec2 c=ivec2(i);
  return mix(mix(h1(c,7),h1(c+ivec2(1,0),7),f.x),mix(h1(c+ivec2(0,1),7),h1(c+ivec2(1,1),7),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vnoise(p);p=p*2.03+vec2(17.1,9.3);a*=.5;}return s;}
// 低周波だけでよいところ用の 3 オクターブ版（5 オクターブ版と平均をそろえる）
float fbm3(vec2 p){float a=.5,s=0.;for(int i=0;i<3;i++){s+=a*vnoise(p);p=p*2.03+vec2(17.1,9.3);a*=.5;}return s+.047;}
// ぼけの円: 半径 r、中心からの距離 d。縁がわずかに明るい（実写のぼけ）。面積が大きいほど暗い
float bokeh(float d,float r,float px){
  float e=max(px*1.2,r*.22);
  float disc=1.-smoothstep(r-e,r+e,d);
  float rim=smoothstep(r*.55,r,d)*disc;
  return disc*(.75+.35*rim);
}
// 層に分けた粒子の場（画面空間）。z=0 が奥（小さく鋭い点）、1 が手前（大きなぼけ）
// 2 乗（pow(x,2.) は x<0 で未定義。NaN になって画素が黒く抜ける）
float sq(float x){return x*x;}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float beat(float k){return exp(-age.x*k);}
float clump(vec2 uv,float t,int seed){return smoothstep(.42,.72,fbm3(uv*1.4+vec2(float(seed)*3.1,t*.03)));}
vec3 particles(vec2 uv,float t,int seed,int nl,float dens,vec2 drift,int pal,float gain){
  vec3 col=vec3(0.); float px=PX;
  for(int i=0;i<8;i++){
    if(i>=nl)break;
    float zr=(float(i)+.5)/float(nl)+camZ;
    float z=fract(zr); int wrap=int(floor(zr));
    float fz=smoothstep(0.,.15,z)*smoothstep(1.,.85,z);
    int sd=seed+wrap*977;
    float cs=mix(.018,.22,z*z);
    float r=mix(.0011,.075,pow(z,2.2));
    vec2 v=drift*(.25+2.2*z);
    vec2 p=(uv+v*t+camPan*(.15+2.5*z*z))/cs+float(i)*13.7;
    ivec2 c=ivec2(floor(p));
    float cm=clump((floor(p)+.5-float(i)*13.7)*cs-v*t-camPan*(.15+2.5*z*z),t,sd);
    float dth=dens*(1.-.6*z)*(.15+.85*cm);
    if(fz<=0.||dth<=0.)continue;
    for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
      ivec2 cc=c+ivec2(dx,dy);
      vec4 ha=h4(cc,sd+i*31);
      float hp=ha.x;
      if(hp>dth)continue;
      vec4 hb=h4(cc,sd+i*31+5);
      vec2 o=vec2(ha.y,ha.z);
      vec2 q=vec2(cc)+.15+.7*o+.12*vec2(sin(t*.7+hp*40.),cos(t*.6+hp*30.));
      vec2 dv=(p-q)*cs; vec2 rad=normalize(uv+1e-4);
      float st=1.+camV*z*z*length(uv)*5.;
      float d=length(vec2(dot(dv,rad)/st,dot(dv,vec2(-rad.y,rad.x))));
      float rr=r*(.6+.8*ha.w);
      float b=bokeh(d,max(rr,px*.8),px);
      if(b<=0.)continue;
      float hc=hb.x;
      vec3 cl=pal==0?TEAL[int(hc*8.)%8]:pal==1?GOLDB[int(hc*5.)%5]:SHELL[int(hc*6.)%6];
      // 小さい鋭い点は明るく、大きなぼけは薄く広く
      float sharp=1.-z;
      float I=fz*gain*(.25+2.2*pow(hb.y,5.)*sharp)*clamp(.0035/max(rr,.0011),.11,2.2);
      float tw=.75+.25*sin(t*(1.+3.*hc)+hp*60.);
      col+=cl*b*I*tw;
    }
  }
  return col;
}
// 場面 0: 青緑の闇に漂う塵とぼけ（参照 5・6）
vec3 sceneDust(vec2 uv,float t){
  vec3 bg=mix(TEAL_BG[2],TEAL_BG[3]*1.6,smoothstep(-.7,.9,uv.y+.5*fbm(uv*1.1+t*.02)));
  bg+=vec3(.004,.02,.035)*clump(uv*.6,t,9);
  vec3 c=bg+particles(uv,t,1,7,.5,vec2(.012,.004),0,1.4)*(.8+.6*sm.y+1.6*beat(3.));
  return c;
}
// 場面 1: 白い核を包む金の粒子殻（参照 1）。粒の細かい殻に暗いひび、外へ散る金の塵
// 細かい粉: 画面空間の細かい格子に 1 粒ずつ、鋭い点（ぼけない）
float powder(vec2 uv,float t,float scale,int seed,float dens){
  vec2 p=uv*scale; ivec2 c=ivec2(floor(p)); float s=0.;
  for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
    ivec2 cc=c+ivec2(dx,dy); float h=h1(cc,seed);
    if(h>dens)continue;
    vec2 q=vec2(cc)+h2(cc,seed+3);
    float d=length(p-q)/scale/PX;
    s+=exp(-d*d*.22)*(.4+1.2*h1(cc,seed+7))*PXE*PXE;
  }
  return s;
}
// 場面 1: 白い核を包む金の粒子殻（参照 1）
vec3 sceneShell(vec2 uv,float t){
  float r=length(uv); float a=atan(uv.y,uv.x);
  vec2 dir=uv/max(r,1e-4);
  float R=.25*(1.+.07*sm.x+.03*sin(t*.4)+.05*beat(4.));
  // 不規則な形: 方向で半径と厚みが変わる（多重の揺らぎ）
  float n1=fbm(dir*1.3+vec2(t*.02,0.)), n2=fbm(dir*3.1+5.);
  float Rr=R*(1.+.28*(n1-.5)+.12*(n2-.5));
  float th=.07+.06*fbm(dir*2.2+9.);
  float sh=(r-Rr)/th;
  // 殻の濃さ: 内側はゆるやかに、外側は粉になって散る
  float body=sh<0.?exp(-sh*sh*2.2):exp(-sh*1.3);
  // 暗いひびの網（2 つの揺らぎの等値線）と煙
  vec2 q=uv*7.+vec2(t*.02);
  float v1=fbm(q+fbm(q*1.5)*1.2);
  float crack=smoothstep(.1,.0,abs(v1-.5))*.9+smoothstep(.07,.0,abs(fbm(q*1.9+3.)-.5))*.45;
  float smoke=fbm(uv*4.+vec2(0.,t*.05));
  float grainF=powder(uv,t,260.,11,.85)+.6*powder(uv,t,520.,12,.9);
  float lump=smoothstep(.25,.75,fbm(uv*5.5+vec2(3.,t*.04)));
  float m=body*(.25+.75*lump)*(.5+.5*smoke)*(1.-min(crack,1.)*.9);
  vec3 c=mix(SHELL[0],SHELL[4],clamp(smoke*1.2+grainF*.15-.2,0.,1.))*m*1.1;
  c+=mix(SHELL[3],SHELL[5],.3)*grainF*body*(.2+.4*lump)*.45;
  // 内側は焦げた茶の煙
  c+=SHELL[0]*.18*smoothstep(Rr,0.,r)*smoothstep(.3,.8,smoke);
  // 小さな白い核とまぶしさ
  c+=vec3(1.,.96,.88)*(exp(-r*r/.00022)*4.+exp(-r/.03)*.35)*(1.+.8*sm.x+1.5*beat(5.));
  // 外へ散る細かい粉（殻から離れるほど疎ら）
  float spray=powder(uv,t,300.,21,.35)*exp(-max(sh,0.)*1.1)*smoothstep(-.5,.3,sh)*(.4+.8*fbm(dir*4.+2.));
  c+=mix(SHELL[3],SHELL[4],.5)*spray*1.1;
  c+=SHELL[2]*powder(uv,t,180.,23,.04)*.2;
  return c;
}

// 場面 2: 泡の浮く太陽面（参照 11）。画面の右上に大きな球、縁は暗く、表面に明るい泡と暗い粒、下に地平の影
vec3 sceneSun(vec2 uv,float t){
  vec2 C=vec2(.5,.38); float R=.8;
  vec2 d=uv-C; float r=length(d);
  vec3 c=vec3(0.);
  if(r<R){
    float mu=sqrt(max(0.,1.-r*r/(R*R)));
    vec2 sp=d/R*(1.+.4*(1.-mu));                 // 球面に貼る座標（縁で詰まる）
    float conv=fbm(sp*4.+vec2(t*.03,-t*.02)), conv2=fbm(sp*11.-t*.05);
    float k=clamp(-.1+1.1*conv+.25*conv2-.2*(1.-mu),0.,1.);
    c=mix(SUN[0]*.7,SUN[4],k)*(.25+.6*pow(mu,.7))*.9;
    c+=SUN[6]*pow(max(0.,conv2-.55),2.)*1.2*mu;
    // 表面の泡（明るいぼけ）と暗い粒
    vec3 bub=particles(uv*.45,t,5,4,.22,vec2(-.002,.003),1,3.2);
    c+=(bub+SUN[6]*dot(bub,vec3(.3))*.8)*smoothstep(R,R*.85,r)*(.6+.8*sm.x+.8*beat(3.));
    c*=1.-.6*powder(uv,t,90.,31,.12)*smoothstep(R,R*.6,r);
  }
  // 縁の光
  c+=SUN[4]*exp(-abs(r-R)*40.)*.5;
  // 地平の影（草の輪郭）
  float gy=-.4+.02*fbm(vec2(uv.x*8.,0.))+.012*pow(vnoise(vec2(uv.x*140.,0.)),3.);
  c*=smoothstep(gy-.003,gy+.006,uv.y);
  return c;
}
float dashField(vec2 uv,vec2 src,float t,float cols,float spd,float len,int seed,float dens,out float hc);
// 火花（長時間露光の光跡）: 軌道は CPU が毎フレーム計算する（WORLD_QUANTUM.SPARK_COUNT 本 × 3 群）。
// 行 0 = 線分の両端、行 1 = (太さの倍率, 温度, 明るさ, 0)。最初の群は拍で強まる。
// 線分から離れた画素は先に飛ばす（近くの画素どうしで同じ判定になるので、GPU でも分岐が安い）
vec3 sparkField(vec2 uv){
  vec3 col=vec3(0.); float kick=.4+2.6*beat(2.5);
  ivec2 g=ivec2(floor((uv-SG_MIN)/SG_CELL));
  if(any(lessThan(g,ivec2(0)))||any(greaterThanEqual(g,ivec2(SG_N))))return col;
  int cell=g.y*SG_N+g.x, n=int(texelFetch(sparkGrid,ivec2(cell,0),0).r);
  for(int k=0;k<SG_CAP;k++){
    if(k>=n)break;
    int i=int(texelFetch(sparkGrid,ivec2(cell,1+k/4),0)[k%4]);
    vec4 A=texelFetch(sparkTex,ivec2(i,0),0);
    vec2 pa=A.xy, ab=A.zw-pa;
    vec4 B=texelFetch(sparkTex,ivec2(i,1),0);
    float w=PX*B.x;
    float l2=max(dot(ab,ab),1e-9);
    float h=clamp(dot(uv-pa,ab)/l2,0.,1.);
    float dd=length(uv-pa-ab*h);
    float core=exp(-dd*dd/(w*w));
    float heat=B.y;
    // 冷めた赤 → 橙 → 黄 → 白に近い金（分岐なし。GPU では分岐と途中抜けのほうが遅い）
    vec3 cl=mix(SPARK[0]*.6,SPARK[1],clamp(heat/.4,0.,1.));
    cl=mix(cl,SPARK[3],clamp((heat-.4)/.35,0.,1.));
    cl=mix(cl,SPARK[4],clamp((heat-.75)*4.,0.,1.));
    col+=cl*core*B.z*PXE*(i<SPARKS/3?kick:1.);
  }
  return col;
}
// 場面 3: 火花の噴出と金のぼけ（参照 12・4）
vec3 sceneSparks(vec2 uv,float t){
  vec2 src=vec2(.02,-.02);
  vec3 c=vec3(.015,.006,.002);
  // 火の霞（発生点のまわり）
  float fire=pow(fbm(uv*4.5+vec2(0.,-t*.6)+fbm3(uv*9.)*.6),2.6)*exp(-length((uv-src)*vec2(1.6,.8))*2.6)*1.6;
  c+=mix(SPARK[0],SPARK[4],fire*fire*2.)*fire*2.2*(1.+.8*sm.x);
  c+=sparkField(uv);
  c+=particles(uv,t,17,3,.5,vec2(.0,.02),1,1.2)*vec3(1.,.55,.2)*exp(-length(uv-src)*1.2)*(1.+1.5*beat(2.5));
  {float hc; float rr=length(uv-src); float k=dashField(uv,src,t*.8,320.,.35,.9,85,.06+.25*exp(-rr*2.),hc); c+=mix(SPARK[2],SPARK[4],hc)*k*1.2*(.5+1.5*beat(2.5))*smoothstep(.03,.1,rr);}
  {float hc; float rr=length(uv-src); float k=dashField(uv,src,t,500.,.5,1.2,81,(.03+.18*exp(-rr*3.))*(.3+1.4*clump(uv,t,4)),hc); c+=mix(SPARK[1],SPARK[4],hc)*k*1.1*smoothstep(.04,.12,rr);}
  // 金のぼけの雲（手前、ピントの外）
  vec3 gb=particles(uv*.8+vec2(.1,0.),t,7,6,.55,vec2(.006,.012),1,1.3);
  c+=gb*smoothstep(1.1,.1,length(uv-vec2(.15,.05)));
  return c;
}

// 放射状の光跡の場: 発生点 src から外へ流れる短い光跡を、極座標（角度 × log 半径）の格子に 1 本ずつ置く。
// 数千本を一定の計算量で描ける。cols は角度方向の密度、spd は外へ流れる速さ、len は光跡の長さ（log 半径）
float dashField(vec2 uv,vec2 src,float t,float cols,float spd,float len,int seed,float dens,out float hc){
  vec2 d=uv-src; float r=max(length(d),1e-3);
  float th=atan(d.x,d.y);                 // 0 が真上
  float lr=log(r)*cols/6.283;
  vec2 q=vec2(th*cols/6.283,lr-t*spd*cols/6.283);
  ivec2 c=ivec2(floor(q)); float s=0.; hc=0.;
  for(int dy=-1;dy<=1;dy++)for(int dx=0;dx<=0;dx++){
    ivec2 cc=c+ivec2(dx,dy); float h=h1(cc,seed);
    if(h>dens)continue;
    vec2 o=h2(cc,seed+1);
    float ax=(q.x-float(cc.x)-o.x)*6.283/cols*r;            // 線からの横のずれ（画面の長さ）
    float ay=q.y-float(cc.y)-o.y;                             // 線に沿った位置（格子単位）
    float L=len*(.5+h1(cc,seed+2));
    float along=smoothstep(0.,.15*L,ay+L)*smoothstep(0.,.08,-ay)*step(ay,0.);
    float w=(.6+1.*h1(cc,seed+3))*PX;
    float k=exp(-ax*ax/(w*w))*along*(.4+1.2*h1(cc,seed+4))*PXE;
    if(k>s){s=k;hc=h1(cc,seed+5);}
  }
  return s;
}
// 場面 4: 青い粒子の光跡（参照 7・8）。中央下から上へ広がる流れと、降る帳と横の光の帯
vec3 sceneStreams(vec2 uv,float t){
  vec3 c=mix(STREAK[0]*.06,STREAK[1]*.12,smoothstep(-.6,.6,uv.y));
  // 2 本の明るい柱（虹色のにじみ）と、その間と外の疎らな光跡
  vec2 src=vec2(0.,-1.1);
  float th=atan(uv.x-src.x,uv.y-src.y);
  float colm=exp(-sq((th+.2)/.11))+exp(-sq((th-.18)/.11));
  for(int L=0;L<3;L++){
    float hc; float fl=float(L);
    vec2 wob=vec2(fbm3(uv*3.+t*.2)-.5,0.)*.06;
    float k=dashField(uv+wob,src+vec2(.03*fl,0.),t,1600.-fl*400.,.9+.3*fl,1.1+fl*.5,71+L,.05+.55*colm,hc);
    vec3 cl=mix(STREAK[int(hc*4.)%4],vec3(.8,.95,1.),.25+.35*hc);
    c+=cl*k*(.35+.9*colm)*(1.-.25*fl)*(1.+.6*sm.z+1.2*beat(3.))*smoothstep(.25,.6,length(uv-src));
  }
  // 柱の虹色のにじみ
  vec3 irid=.5+.5*cos(6.283*(uv.y*1.5+vec3(0.,.33,.67))+th*8.);
  c+=mix(STREAK[2],irid,.18)*colm*.22*smoothstep(-.9,.4,uv.y)*(.6+.5*fbm(vec2(th*20.,uv.y*3.-t)));
  // 横の光の帯
  float band=exp(-sq((uv.y+.18+.03*sin(uv.x*3.+t))/.05));
  c+=STREAK[6]*band*(.03+.05*fbm(vec2(uv.x*4.-t*.3,0.)))*(1.+sm.z+beat(3.));
  c+=particles(uv,t,13,5,.4,vec2(0.,-.03),0,.8)*vec3(.6,.8,1.2);
  return c;
}
// 場面 6: ミントの光（参照 15）。露出の飛んだ淡い緑に、暗い塵が流れる
vec3 sceneMint(vec2 uv,float t){
  vec3 c=mix(MINT[0],MINT[2],fbm(uv*2.+t*.05))*.62;
  c=mix(vec3(dot(c,vec3(.3,.59,.11))),c,1.6);
  {float hc; float k=dashField(uv,vec2(-1.4,-1.),t*.5,420.,.35,1.4,62,.12,hc); c+=MINT[3]*.5*k;}
  c-=vec3(.08,.05,.07)*powder(uv+vec2(t*.02,-t*.01),t,220.,51,.35);
  {float hc; float k=dashField(uv,vec2(-1.2,-.9),t,500.,.3,.8,91,.1*(.3+fbm(uv*2.)),hc); c+=MINT[3]*k*.6;}
  return c;
}
vec3 sceneOf(int scene,vec2 uv,float time,float ts);
void main(){
  PX=max(1./PXREF,PX_MIN/res.y); PXE=1./(PXREF*PX);
  vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;
  vec3 c=sceneOf(QSCENE,uv,time,ts);   // 場面は program ごとに固定（使わない場面のコードを持たないため速い）
  float warm=float(scene==1||scene==2||scene==3)*(1.-mixW)+float(sceneB==1||sceneB==2||sceneB==3)*mixW;
  vec2 fu=rot(camRoll)*uv;
  c+=particles(fu,time,401,4,.16,vec2(0.),warm>.5?1:0,.55)*mix(vec3(.8,1.,1.1),vec3(1.2,.9,.6),warm);
  c*=1.+.45*beat(4.)*(.4+loud);
  vec2 ndc=gl_FragCoord.xy/res*2.-1.;
  c*=1.-VIGNETTE*dot(ndc*.8,ndc*.8); if(any(isnan(c))||any(isinf(c)))c=vec3(0.); frag=vec4(min(c,vec3(60.))*EXPOSURE,1.);
}
vec2 camera(int scene,vec2 uv,float ts){
  float sat=1.-exp(-ts/6.);
  if(scene==4)return rot(.25*sin(camRoll)+.12*sin(ts*.3))*(uv+vec2(0.,-.35+.5*(1.-exp(-ts/5.))));   // 流れを追って振り上げる
  uv=rot(camRoll)*uv;
  if(scene==0)return uv;
  if(scene==6)return uv+vec2(.08,.04)*ts;
  if(scene==1)return rot(.14*ts+.2)*uv/(.75+.6*sat);                        // 遠くから殻へ寄りながら回り込む
  if(scene==3)return rot(-.08*ts)*uv/(.8+.6*sat);                           // 噴出へ突っ込む
  if(scene==2)return uv/(1.+.3*sat)+vec2(.8*sat-.35,.18*sat);                // 表面を横へなめる
  return uv;
}

vec3 sceneOf(int scene,vec2 uv0,float time,float ts){
  vec2 uv=camera(scene,uv0,ts);
  vec3 c;
  if(scene==1)c=sceneShell(uv,time);
  else if(scene==2)c=sceneSun(uv,time);
  else if(scene==3)c=sceneSparks(uv,time);
  else if(scene==4)c=sceneStreams(uv,time);
  else if(scene==6)c=sceneMint(uv,time);
  else c=sceneDust(uv,time);
  return c;
}
`;
}
// 設計 §4.1 のヘッダー（version・precision）。sampler2D の精度宣言は全 WORLD シェーダーの監査（UW-47）に合わせる
// QSCENE は場面ごとの program を作るときに置き換える（worldQuantumSceneSource）
const WORLD_QUANTUM_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define QSCENE 0
${worldQuantumShaderBody()}`;
// 縮めて描いた絵を出力の大きさへ線形補間で広げる。溶かしの間は次の場面の絵を mixW の割合で混ぜる
const WORLD_QUANTUM_UPSAMPLE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D source;
uniform sampler2D sourceB;
uniform float mixW;
out vec4 frag;
void main(){frag=vec4(mix(texture(source,vUv).rgb,texture(sourceB,vUv).rgb,mixW),1.);}`;
function worldQuantumSceneSource(id) { return WORLD_QUANTUM_FRAGMENT.replace('#define QSCENE 0', '#define QSCENE ' + id); }
// シェーダーの hu・h4 と同じ整数ハッシュ。火花の性質を CPU で同じ乱数から作る
function worldQuantumHu(x) {
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16; return x >>> 0;
}
function worldQuantumH4(cx, cy, s, out) {
  const x = worldQuantumHu((Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(s, 83492791)) >>> 0);
  out[0] = ((x & 255) + .5) / 256; out[1] = (((x >>> 8) & 255) + .5) / 256; out[2] = (((x >>> 16) & 255) + .5) / 256; out[3] = ((x >>> 24) + .5) / 256;
  return out;
}
// 時刻 t の火花の線分（a）と性質（b）を埋める。smx は低域の平滑レベル（速さを上げる）
function worldQuantumSparks(t, smx, a, b, hA, hB) {
  const n = WORLD_QUANTUM.SPARK_COUNT;
  for (let g = 0; g < WORLD_QUANTUM_SPARK_BURSTS.length; g++) {
    const [tm, sx, sy, spread, speed, grav, life, seed, gain, dtE, thick, jit] = WORLD_QUANTUM_SPARK_BURSTS[g], tg = t * tm;
    for (let i = 0; i < n; i++) {
      const o = (g * n + i) * 4;
      worldQuantumH4(i, seed, 1, hA);
      const per = life * (.7 + .6 * hA[0]), tt = tg + hA[1] * per, k = Math.floor(tt / per), age = tt - k * per;
      worldQuantumH4(i, k, seed + 3, hA); worldQuantumH4(i, k, seed + 5, hB);
      const ang = 1.5708 + (hA[0] - .5) * spread, v = speed * (.4 + .9 * hA[1]) * (1 + .6 * smx);
      const vx = Math.cos(ang) * v, vy = Math.sin(ang) * v, px = sx + (hB[0] - .5) * jit, py = sy + (hB[1] - .5) * jit;
      // 長時間露光: 年齢 age-dt から age までの区間を線分にする
      const a0 = Math.max(age - dtE * (.5 + hA[2]), 0);
      a[o] = px + vx * a0; a[o + 1] = py + vy * a0 - grav * .5 * a0 * a0;
      a[o + 2] = px + vx * age; a[o + 3] = py + vy * age - grav * .5 * age * age;
      const heat = 1 - age / per, x = Math.min(1, age / .02);
      b[o] = thick * (1.2 + 1.5 * hA[3]); b[o + 1] = heat; b[o + 2] = gain * (.3 + 1.2 * heat) * x * x * (3 - 2 * x); b[o + 3] = 0;
    }
  }
}
// 火花を升目に登録する。grid は行 0（本数）と行 1..CAP/4（番号）の RGBA。a は worldQuantumSparks の線分
function worldQuantumSparkGrid(a, count, grid) {
  const c = WORLD_QUANTUM, N = c.SPARK_GRID, W = N * N, m = c.SPARK_GRID_MARGIN;
  for (let k = 0; k < W; k++) grid[k * 4] = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const x0 = Math.max(0, Math.floor((Math.min(a[o], a[o + 2]) - m - c.SPARK_GRID_MIN) / c.SPARK_GRID_CELL));
    const x1 = Math.min(N - 1, Math.floor((Math.max(a[o], a[o + 2]) + m - c.SPARK_GRID_MIN) / c.SPARK_GRID_CELL));
    const y0 = Math.max(0, Math.floor((Math.min(a[o + 1], a[o + 3]) - m - c.SPARK_GRID_MIN) / c.SPARK_GRID_CELL));
    const y1 = Math.min(N - 1, Math.floor((Math.max(a[o + 1], a[o + 3]) + m - c.SPARK_GRID_MIN) / c.SPARK_GRID_CELL));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cell = y * N + x, n = grid[cell * 4];
      if (n >= c.SPARK_GRID_CAP) continue;   // 上限を超えた分は描かない（密な中心でもまれ）
      grid[((1 + (n >> 2)) * W + cell) * 4 + (n & 3)] = i; grid[cell * 4] = n + 1;
    }
  }
}
// 帯域群（テッセラクトと同じ）: [開始帯域, 終了帯域（含む）]
const WORLD_QUANTUM_GROUPS = Object.freeze([Object.freeze([0, 3]), Object.freeze([4, 13]), Object.freeze([14, 23]), Object.freeze([24, 31])]);
const WORLD_QUANTUM_UNIFORM_NAMES = Object.freeze(['res', 'time', 'scene', 'sceneB', 'mixW', 'camZ', 'ts', 'camV', 'camPan', 'camRoll', 'lvl', 'sm', 'age', 'loud']);
class WorldQuantumAnalyzer extends WorldBandAnalyzer {
  constructor() {
    super(); this.id = 'g-quantum'; this.label = '量子のビジョン';
    this.statelessRender = true; // フレーム間のGPU履歴を持たない
    // 音の状態（シェーダーへ渡す。毎フレーム再利用し、確保しない）
    this.lvl = new Float32Array(4); this.sm = new Float32Array(4); this.age = new Float32Array(4);
    this.lastOn = new Float64Array(4);
    // 火花のテクスチャの中身: 前半 = 行 0（線分）、後半 = 行 1（性質）
    this.sparkData = new Float32Array(WORLD_QUANTUM_SPARK_BURSTS.length * WORLD_QUANTUM.SPARK_COUNT * 8);
    this.spA = this.sparkData.subarray(0, this.sparkData.length / 2); this.spB = this.sparkData.subarray(this.sparkData.length / 2);
    this.sparkGridData = new Float32Array(WORLD_QUANTUM.SPARK_GRID * WORLD_QUANTUM.SPARK_GRID * (1 + WORLD_QUANTUM.SPARK_GRID_CAP / 4) * 4);
    this.hashA = new Float64Array(4); this.hashB = new Float64Array(4);
    // 場面の予定表（曲が変わったときに 1 回だけ確保・作成）
    this.schedStart = new Float64Array(8); this.schedScene = new Uint8Array(8); this.schedCount = 0; this.schedScore = null;
    this.reset();
  }
  reset() {
    super.reset(); if (!this.lvl) return;
    this.lvl.fill(0); this.sm.fill(0); this.age.fill(WORLD_QUANTUM.AGE_MAX); this.lastOn.fill(-100);
    this.loud = 0; this.lastEventSec = -1; this.lastBeatSec = -100; this.lastBeatIndex = 0; this.previewDownbeatIndex = 0;
    this.hit = 0; this.push = 0; this.camV = 0; this.camZ = 0; this.panX = 0; this.panY = 0; this.camRoll = 0;
    this.sceneA = 0; this.sceneB = 0; this.mixW = 0; this.tA = 0; this.tB = 0;
    this.schedScore = null; // 次の step で予定表を作り直す（確保済みの配列は再利用する）
  }
  init(gpu) {
    super.init(gpu);
    // 場面ごとの program。1 本にまとめると火花の場面でコードが大きくなりすぎ、GPU 時間が倍以上になった（設計 §8）
    this.programs = [];
    for (const id of Object.values(WORLD_QUANTUM_SCENE)) {
      const program = gpu.program(worldQuantumSceneSource(id)), loc = {};
      for (const name of WORLD_QUANTUM_UNIFORM_NAMES) loc[name] = gpu.texture(program, name);
      loc.sparkTex = gpu.texture(program, 'sparkTex'); loc.sparkGrid = gpu.texture(program, 'sparkGrid');
      this.programs[id] = { program, loc };
    }
    this.sparkTex = gpu.target(WORLD_QUANTUM_SPARK_BURSTS.length * WORLD_QUANTUM.SPARK_COUNT, 2, true);
    this.sparkGrid = gpu.target(WORLD_QUANTUM.SPARK_GRID * WORLD_QUANTUM.SPARK_GRID, 1 + WORLD_QUANTUM.SPARK_GRID_CAP / 4, true);
    this.upsample = gpu.program(WORLD_QUANTUM_UPSAMPLE_FRAGMENT); this.sourceLoc = gpu.texture(this.upsample, 'source');
    this.sourceBLoc = gpu.texture(this.upsample, 'sourceB'); this.upMixLoc = gpu.texture(this.upsample, 'mixW');
    this.resize(gpu.gl.canvas.width, gpu.gl.canvas.height);
  }
  _pass(input, id, ts, target) {
    const g = this.gpu, gl = g.gl, p = this.programs[id], l = p.loc;
    g.bind(p.program, target);
    gl.uniform2f(l.res, target.width, target.height); gl.uniform1f(l.time, input.tSec);
    gl.uniform1i(l.scene, this.sceneA); gl.uniform1i(l.sceneB, this.sceneB); gl.uniform1f(l.mixW, this.mixW);
    gl.uniform1f(l.camZ, this.camZ); gl.uniform1f(l.ts, ts);
    gl.uniform1f(l.camV, this.camV); gl.uniform2f(l.camPan, this.panX, this.panY); gl.uniform1f(l.camRoll, this.camRoll);
    gl.uniform4fv(l.lvl, this.lvl); gl.uniform4fv(l.sm, this.sm); gl.uniform4fv(l.age, this.age);
    gl.uniform1f(l.loud, this.loud);
    if (id === WORLD_QUANTUM_SCENE.SPARKS) { g.sampler(l.sparkTex, 2, this.sparkTex); g.sampler(l.sparkGrid, 3, this.sparkGrid); }
    g.draw();
  }
  // 内部の描画先（ふだんは出力の RENDER_SCALE 倍を 1 枚。溶かしの間は FADE_SCALE 倍を 2 枚）。大きさが変わったときだけ作り直す
  resize(w, h) {
    const c = WORLD_QUANTUM, size = k => [Math.max(1, Math.ceil(w * k)), Math.max(1, Math.ceil(h * k))];
    const [width, height] = size(c.RENDER_SCALE), [fw, fh] = size(c.FADE_SCALE);
    if (this.low && this.low.width === width && this.low.height === height) return;
    if (this.low) for (const t of [this.low, this.fadeA, this.fadeB]) this.gpu.releaseTarget(t);
    this.low = this.gpu.target(width, height); this.fadeA = this.gpu.target(fw, fh); this.fadeB = this.gpu.target(fw, fh);
  }
  // 曲の区間から予定表を作る（曲が変わったときだけ。配列は足りないときだけ確保し直す）
  _buildSchedule(score) {
    const sections = score && score.sections ? score.sections : [], cap = sections.length * 3 + 2;
    if (this.schedStart.length < cap) { this.schedStart = new Float64Array(cap); this.schedScene = new Uint8Array(cap); }
    this.schedCount = worldQuantumBuildSchedule(sections, this.schedStart, this.schedScene);
    if (this.schedCount === 0) { this.schedStart[0] = 0; this.schedScene[0] = WORLD_QUANTUM_SCENE.DUST; this.schedCount = 1; }
    this.schedScore = score;
  }
  _fire(g, t) {
    if (t - this.lastOn[g] < WORLD_QUANTUM.REFRACTORY) return;
    this.lastOn[g] = t; if (g === 0) this.hit = 1;
  }
  step(input) {
    this.update(input);
    const c = WORLD_QUANTUM, t = input.tSec, dt = input.dt, f = input.features, engine = input.engine, b = this.bandUniforms;
    if (engine.score !== this.schedScore) this._buildSchedule(engine.score);
    // 音の状態（§5）
    for (let g = 0; g < 4; g++) {
      const g0 = WORLD_QUANTUM_GROUPS[g][0], g1 = WORLD_QUANTUM_GROUPS[g][1];
      let sum = 0;
      for (let i = g0; i <= g1; i++) sum += b[i * 4];
      const v = sum / (g1 - g0 + 1); this.lvl[g] = v;
      const tau = v > this.sm[g] ? c.LEVEL_ATTACK : c.LEVEL_RELEASE;
      this.sm[g] += (v - this.sm[g]) * (1 - Math.exp(-dt / tau));
    }
    const x = Math.max(0, Math.min(1, (f.loudness.level - c.LOUD_LO) / (c.LOUD_HI - c.LOUD_LO)));
    this.loud += (x - this.loud) * (1 - Math.exp(-dt / (x > this.loud ? c.LOUD_ATTACK : c.LOUD_RELEASE)));
    // 立ち上がり。同じ t での再呼び出しでは二重に数えない
    this.hit = 0;
    if (t !== this.lastEventSec) {
      if (engine.preview) {
        if (engine.beatIndex !== this.lastBeatIndex) { this._fire(0, t); this._fire(1, t); this.lastBeatIndex = engine.beatIndex; }
        const db = engine.score.downbeats; let crossed = false;
        while (this.previewDownbeatIndex < db.length && db[this.previewDownbeatIndex] <= t) { this.previewDownbeatIndex++; crossed = true; }
        if (crossed) { this._fire(2, t); this._fire(3, t); }
      } else {
        // 拍があるあいだは拍だけで 4 群を立てる。拍が BEAT_HOLD 秒ないときだけ、帯域ごとの立ち上がりを使う
        if (f.tempo.beatFlag) { this.lastBeatSec = t; for (let g = 0; g < 4; g++) this._fire(g, t); }
        else if (t - this.lastBeatSec > c.BEAT_HOLD) { const flags = f.onset.flags; for (let g = 0; g < 4; g++) if (flags & (1 << g)) this._fire(g, t); }
      }
      this.lastEventSec = t;
    }
    for (let g = 0; g < 4; g++) this.age[g] = Math.min(c.AGE_MAX, t - this.lastOn[g]);
    this._stepCamera(t, dt);
    this._stepScene(t);
  }
  // 前進・パン・回転（§6.1）
  _stepCamera(t, dt) {
    const c = WORLD_QUANTUM, hit = this.hit;
    this.push += (hit - this.push) * (1 - Math.exp(-dt / (hit > this.push ? c.PUSH_ATTACK : c.PUSH_RELEASE)));
    const target = c.CAM_BASE + c.CAM_LOUD * this.loud + c.CAM_PUSH * this.push;
    this.camV += (target - this.camV) * (1 - Math.exp(-dt / c.CAM_TAU));
    this.camZ += this.camV * dt;
    this.panX += Math.sin(t * c.PAN_RATE_X) * (c.PAN_X + c.PAN_X_LOUD * this.loud) * dt;
    this.panY += Math.cos(t * c.PAN_RATE_Y + c.PAN_PHASE_Y) * (c.PAN_Y + c.PAN_Y_LOUD * this.loud) * dt;
    this.camRoll = c.ROLL_SWAY * Math.sin(t * c.ROLL_SWAY_RATE) + c.ROLL_RATE * t;
  }
  // 今の場面と溶かす量（§6.3）。start <= t を満たす最後の行を二分探索で求める
  _stepScene(t) {
    const st = this.schedStart, sc = this.schedScene, n = this.schedCount, fade = WORLD_QUANTUM.FADE;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid] <= t) lo = mid; else hi = mid - 1; }
    const i = lo;
    this.sceneA = sc[i]; this.sceneB = sc[i]; this.mixW = 0; this.tA = t - st[i]; this.tB = 0;
    if (i + 1 < n && t > st[i + 1] - fade) {
      const x = (t - (st[i + 1] - fade)) / fade;
      this.sceneB = sc[i + 1]; this.mixW = x * x * (3 - 2 * x); this.tB = t - (st[i + 1] - fade);
    }
  }
  render(input) {
    const g = this.gpu, gl = g.gl;
    // 火花の場面が映っているときだけ軌道を計算する（時刻だけで決まるので、途中の描画を省いても同じ絵）
    const sparks = this.sceneA === WORLD_QUANTUM_SCENE.SPARKS || this.sceneB === WORLD_QUANTUM_SCENE.SPARKS;
    if (sparks) {
      worldQuantumSparks(input.tSec, this.sm[0], this.spA, this.spB, this.hashA, this.hashB);
      gl.bindTexture(gl.TEXTURE_2D, this.sparkTex.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.sparkTex.width, 2, gl.RGBA, gl.FLOAT, this.sparkData);
      worldQuantumSparkGrid(this.spA, this.sparkTex.width, this.sparkGridData);
      gl.bindTexture(gl.TEXTURE_2D, this.sparkGrid.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.sparkGrid.width, this.sparkGrid.height, gl.RGBA, gl.FLOAT, this.sparkGridData);
    }
    // 溶かしの間は次の場面を別の描画先へ描き、拡大のときに混ぜる（後段の処理は線形なので、1 本で mix するのと同じ絵。
    // GPU の blend で重ねると、M4 Max で描画時間が 6 倍になった）
    const fading = this.mixW > 0, a = fading ? this.fadeA : this.low;
    this._pass(input, this.sceneA, this.tA, a);
    if (fading) this._pass(input, this.sceneB, this.tB, this.fadeB);
    g.bind(this.upsample, input.target); g.sampler(this.sourceLoc, 0, a); g.sampler(this.sourceBLoc, 1, fading ? this.fadeB : a);
    gl.uniform1f(this.upMixLoc, fading ? this.mixW : 0); g.draw();
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldQuantumAnalyzer, WORLD_QUANTUM, WORLD_QUANTUM_SCENE, WORLD_QUANTUM_COLORS, WORLD_QUANTUM_COLORS_LINEAR, WORLD_QUANTUM_FRAGMENT, worldQuantumBuildSchedule, worldQuantumSparks, worldQuantumSparkGrid }; }
