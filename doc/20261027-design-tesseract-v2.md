# g-tesseract 設計 v2 — 光の糸の束でできたマーフの部屋の格子

v1（doc/20261024-design-visions-v1.md §2「縦の光の筋の壁」）を置き換える。v1 は光の帯が蠢いているだけで、テッセラクトの空間の構造が出ていなかった。
v2 は試作を重ねて決めた見た目を、そのままエンジンへ移す。
試作と同じ見た目になることが受け入れ条件。式・定数・色は本書のとおりに実装し、勝手に変えない。

## 0. 根拠と経緯

### 0.1 映画の構造（本編フレーム 12 枚と DNEG の資料から）
- テッセラクトは、マーフの寝室を格子の節点ごとに複製した空間。部屋の中身（壁・床・本棚・本・家具・ランプ・窓）が、時間方向に押し出された角柱になっている（スリットスキャン）。
- Nolan の交互の格子では、部屋ごとに押し出しが 2 方向へ伸びる。押し出しが交差して、四角いトンネルが入れ子に奥へ縮んで見える。
- 押し出しは細い光の糸（gossamer threads）の束で、糸の隙間から奥が透ける。

### 0.2 決定事項（2026-10-27）
- 押し出しは面に縞を描くのではなく、光の糸の束にする（面の縞は安っぽく見える原因だった）。
- 色相はアンバーから黄金の間だけにし、音楽に合わせて連続的に移ろわせる。
- 短い光の粒は使わない。拍では長いストロークで、束ごと明滅させる。
- ブラックホールのように常に光らせ、明るさは音楽に追従させる。
- カメラは速くダイナミックに動き続ける。速さは最初の案の ×0.8（明滅が見える速さ）。
- 2026-10-28: 切り替わりが短すぎて画面酔いしやすいため、直進を 1〜3 部屋から 3〜7 部屋へ、角の丸みを .9 から 1 へ（2 では押し出しを掠めた）、視線の先読みを 16 から 24 単位へ、回転と傾き・首振りを弱めた（§2 の値）。

### 0.3 試作での実測（1280×720、128 BPM のテスト曲 14〜34 秒）
- 拍のフレームでは画面平均輝度が約 21 上がる。拍以外のフレームの変化は約 ±10。
- 画面平均輝度は、静かな導入で約 67、ドロップの拍の直前が 108、拍で 152、直後に 102。
- 全 600 フレームで、場面が飛ぶフレームはない（カメラの上向きを平行移動で運んでいるため）。

## 1. 構造（1 画素の流れ）

1. 光線は、間隔 `L=4` の立方格子のセルを 3D DDA で最大 64 セル進む。
2. セルの各軸 a について、Nolan の交互規則 `hasB(a, セル)` が真なら、そのセルを軸 a 方向へ貫く押し出しが 1 本ある。押し出しの断面は半径 `H=1.25` の正方形。
3. 断面は部屋の断面を `N=14` 升で表す。材質は `mat()` で決まる（0 空気、1 壁・床、2 本棚の板、3 本、4 家具、5 ランプ、6 窓）。
4. 材質のある升は `S=3` で細分する。細分した升ごとに、軸方向へ無限に伸びる円柱（糸）を 1 本置く。光線は断面内を 2D DDA で進み、糸と交差判定する。糸の隙間は通り抜ける。
5. 光る糸の近くを通った光線は、その光をにじみ `G` として拾う。
6. 合わせ鏡: `MN=4` セルごとに空間を鏡映で折り返し、無限に続いて見せる。鏡を越えるごとに像は暗くなる。
7. 当たった糸を `shade()` で塗る。材質の色を音楽の位相でアンバーから黄金へ寄せ、照明・鏡面反射・明滅を加える。

## 2. 定数 `WORLD_TESSERACT`（js/world/g-tesseract.js）

v1 の定数・パレット・カメラ表（`WORLD_TESSERACT_PALETTE`、`WORLD_TESSERACT_CAMERA` など）はすべて削除し、次に置き換える。

```js
const WORLD_TESSERACT = Object.freeze({
  FOV: 80,                       // 縦の画角（度）
  SPEED_BASE: 6, SPEED_LOUD: 9, SPEED_SCALE: .8,   // 前進の速さ = SPEED_SCALE*(SPEED_BASE+SPEED_LOUD*loud) [単位/秒]
  CORNER: 1,                     // 道の角の丸み（2 次ベジエの半径。角の中点は通路の中心から .35 ずれる。2 では押し出しの表面から .04 まで寄って掠めた）
  ROOMS_MIN: 3, ROOMS_SPAN: 5,   // 1 区間に進む部屋の数（3〜7）
  LOOK_STEPS: 8, LOOK_STEP: 3,   // 視線 = 先の道 k*LOOK_STEP（k=1..8）への方向の平均
  BANK_NEAR: 8, BANK_FAR: 24, BANK_GAIN: .6,       // 曲がる向きへの傾き
  ROLL_RATE: .12, ROLL_SWAY: .35, ROLL_SWAY_RATE: .25,
  SWAY_RATE_X: .5, SWAY_X: .22, SWAY_RATE_Y: .4, SWAY_Y: .18, SWAY_PHASE_Y: 1.3, SWAY_RATE_Z: .28, SWAY_Z: .12, SWAY_PHASE_Z: 2.1,
  PATH_NODES: 4096,              // 道の折れ点の数（1 区間 12〜28 単位 → 49000 単位以上。最速 12 単位/秒で 60 分超）
  LEVEL_ATTACK: .048, LEVEL_RELEASE: .26,          // 帯域群のなめらかな音量の時定数（秒）
  LOUD_ATTACK: .065, LOUD_RELEASE: .4,             // 全体音量の時定数（秒）
  LOUD_LO: .33, LOUD_HI: .93,    // loudness.level を 0..1 へ写す範囲（§10 の実測: テスト曲で静か .40、ドロップ .66〜.69 を、試作の loud .12、.57 へ）
  ENERGY_TAU: .54, CENTROID_TAU: 1.09,
  PHASE_BASE: .015, PHASE_GAIN: .12, PHASE_RATE: 4, PHASE_TIMBRE: .6,
  AGE_MAX: 9, REFRACTORY: .12,   // 同じ群の立ち上がりを数えない間隔（秒）
  BEAT_HOLD: 2,                  // 最後の拍からこの秒数のあいだは拍だけで明滅させる
  EXPOSURE: 1.8,                 // 試作の後処理との差を埋める。1.4 ではドロップの画面平均輝度が中央値 64 で、試作（約 100〜110）より暗かった
  FLASH_GAIN: 1.6,               // 拍の明滅の強さ（試作の値に掛ける）。1.0 では拍での平均輝度の上昇が 8 で、試作の 21 に届かなかった
  VIGNETTE: .35,
  BLOOM_THRESHOLD: .05, BLOOM_STRENGTH: .7
});
```

## 3. 色（sRGB。JS で worldSrgbToLinear してから GLSL 定数にする）

| 名前 | 値 | 出典 |
|---|---|---|
| WOOD | #2D1C15 #493225 #5C4739 #695241 #77634F #8F7B63 | 暗部のショットとセット写真の木の実測 |
| BOOK | #6B4A2C #89612B #806A66 #9E8785 #7A6D30 #938C47 #566B67 #B1B15F | 本の実測 |
| SILVER | #8C8473 #A49A89 #B9B1A3 #CECBC7 | DNEG スチルの銀白の実測 |
| AMB（アンバー側） | #E07E34 #89612B #8B6250 #6B4A2C #C98A4B | 本編の橙・琥珀・赤茶の実測 |
| GLD（黄金側） | #D4AF37 #CFB53B #DAA520 #B8860B #E6BE8A | 金の標準色: metallic gold、old gold、goldenrod、dark goldenrod、pale gold |

本編の全景の実測（#AEA93D など）は画面で黄緑に見えるため、黄金側には使わない（色相はアンバーから黄金の間に限る。§0.2）。

## 4. シェーダー（全文。この本文をそのまま使う）

`${...}` の部分は JS のテンプレート文字列で埋める。`VEC3_LIST(WOOD)` は線形化した色を `vec3(r,g,b),...` に並べたもの。
頂点シェーダーと `vUv` はエンジン共通（`gpu.program(fragment)`）を使う。

```glsl
#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
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
```

試作からの変更点（意図したもの）: 被写界深度・動きのぼけ・2 倍の超標本化・フィルム粒子は入れない（リアルタイムのため）。
周辺減光と露出はシェーダー内で掛ける。`shade()` の `sk` は試作の `h.j` の代わりに `h.rod.y/S` を使う（同じ値）。

## 5. 音の状態（`step(input)`、毎ステップ。`dt=input.dt`、`t=input.tSec`）

割り当てなし（配列はコンストラクタで確保して再利用）。同じ `t` での再呼び出しでは立ち上がりを二重に数えない（v1 の `lastEventSec` と同じ）。

1. 帯域群の音量 `lvl[g]`（g=0..3）: `WorldBandAnalyzer.update()` が作る `bandUniforms[i*4]`（0..1 の level）の平均。g0 = 帯域 0〜3、g1 = 4〜13、g2 = 14〜23、g3 = 24〜31。
2. なめらかな音量 `sm[g] += (lvl[g]-sm[g]) * (1-exp(-dt/τ))`。τ は `lvl>sm` なら LEVEL_ATTACK、それ以外は LEVEL_RELEASE。
3. 全体音量 `x = clamp((features.loudness.level-LOUD_LO)/(LOUD_HI-LOUD_LO),0,1)`。`loud += (x-loud)*(1-exp(-dt/τ))`。τ は `x>loud` なら LOUD_ATTACK、それ以外は LOUD_RELEASE。
4. `e = (lvl0*1.2+lvl1+lvl2+lvl3*.8)/4`。`energy += (e-energy)*(1-exp(-dt/ENERGY_TAU))`。
5. `c = (lvl1+2*lvl2+3*lvl3)/max(lvl0+lvl1+lvl2+lvl3,1e-3)`。`cen += (c-cen)*(1-exp(-dt/CENTROID_TAU))`。cen の初期値は 1.5。
6. `phaseAcc += dt*(PHASE_BASE+PHASE_GAIN*energy*energy)*PHASE_RATE`。シェーダーへ渡す `phase = phaseAcc + PHASE_TIMBRE*(cen-1.5)`。
7. 立ち上がり: `features.onset.flags` の bit g（g=0..3。MFS の群は 50–150 Hz、150–2500 Hz、5–15 kHz、全帯域）。
   音声なしの preview（`engine.preview`）では、`engine.beatIndex` が進んだステップ（新しい拍）で群 0 と 1、`engine.score.downbeats` を越えたステップで群 2 と 3 を立てる。
   音声のある経路では、拍（`features.tempo.beatFlag`）で 4 群すべてを立てる。拍があるあいだ（最後の拍から BEAT_HOLD 秒以内）は帯域ごとの立ち上がりを使わず、拍が途絶えたときだけ使う。
   理由（2026-10-28 の実測 2 回目）: 帯域ごとの立ち上がりも併用すると、MFS は中高域の立ち上がりを拍より多く出すため、違う束が毎秒何度も光り始めて明滅が散り、拍での平均輝度の上昇が 5 しかなかった。
   理由（2026-10-28 の実測）: MFS の群 1（150–2500 Hz）の立ち上がりは 128 BPM のテスト曲で 26 秒に 2〜3 回、群 2・3 も拍の 1/3 ほどしか立たない。
   試作の解析では拍ごとに 4 群が揃って立っていたため、エンジンでは明滅する束が約 1/4 になり、拍での画面平均輝度の上昇が試作の 21 に対して 3 しかなかった。
   同じ群が `REFRACTORY`（0.12 秒）以内に再び立つ場合は数えない（拍と立ち上がりが同時に来ても 1 回）。
   立ち上がった群は `prev[g]=last[g]; last[g]=t; cnt[g]++`。
   `age[g]=min(AGE_MAX,t-last[g])`、`age2[g]=min(AGE_MAX,t-prev[g])`。last と prev の初期値は −100。
8. `reset()` ですべて初期値へ戻す（sm=0、loud=0、energy=0、cen=1.5、phaseAcc=0、cnt=0）。

## 6. カメラ（`step(input)` の続き）

### 6.1 道（折れ線）
部屋と部屋の間の通路（座標がすべて「4 の倍数 + 2」の線）を進む。道は乱数の種 `engine.score.seed` から決まる（種が変わったら作り直す）。
- 乱数: `x = (x*1664525 + 1013904223) >>> 0; return x/4294967296`（初期値 = seed >>> 0）。
- 折れ点 0 = (2,2,2)、進む軸 = 2（z）、向き = +1。区間 k ごとに `n = ROOMS_MIN+floor(R()*ROOMS_SPAN)` 部屋（3〜7、長さ 4n）進んで次の折れ点へ行き、残り 2 軸からどちらかを `R()<.5` で選んで軸を替え、向きを `R()<.5 ? -1 : 1` で選ぶ（乱数を呼ぶ順はこのとおり: n、軸、向き）。
- 折れ点 PATH_NODES 個を `Float64Array` に作り、各区間の累積距離も持つ。

### 6.2 道の上の位置 `at(s, out)`（角を 2 次ベジエで丸める、r = CORNER）
区間 k（累積距離 cum[k] ≤ s < cum[k+1]）、`u = s-cum[k]`、長さ len_k、向き d_k、折れ点 P_k。
- `u > len_k-r` かつ次の区間がある: 角は P_{k+1}。`w=(u-(len_k-r))/(2r)`、`B(w)` は始点 P_{k+1}-d_k·r、制御点 P_{k+1}、終点 P_{k+1}+d_{k+1}·r の 2 次ベジエ。
- `u < r` かつ k>0: 角は P_k。`w=(u+r)/(2r)`、始点 P_k-d_{k-1}·r、制御点 P_k、終点 P_k+d_k·r。
- それ以外: `P_k + d_k·u`。

### 6.3 前進
`s += SPEED_SCALE*(SPEED_BASE+SPEED_LOUD*loud)*dt`（loud は §5.3）。

### 6.4 向き
1. `pos = at(s)`。
2. 視線 `f = normalize(Σ_{k=1..LOOK_STEPS} (at(s+k*LOOK_STEP)-pos)/(k*LOOK_STEP))`。
3. 首振り: `f = normalize(f + (SWAY_X*sin(t*SWAY_RATE_X), SWAY_Y*sin(t*SWAY_RATE_Y+SWAY_PHASE_Y), SWAY_Z*sin(t*SWAY_RATE_Z+SWAY_PHASE_Z)))`。
4. 上向きは前のステップから平行移動で運ぶ: `up = normalize(up - f*dot(up,f))`（初期値 (0,1,0)。長さが 1e-6 未満になったら f に直交する任意の単位ベクトル）。基準軸の切り替えは使わない（画面が一瞬で反転する飛びの原因だった）。
5. `rgt = cross(up, f)`、`ahead = normalize(at(s+BANK_FAR)-at(s+BANK_NEAR))`。
6. `roll = ROLL_RATE*t + ROLL_SWAY*sin(ROLL_SWAY_RATE*t) - BANK_GAIN*dot(ahead, rgt)`。
7. `r = cos(roll)*rgt + sin(roll)*up`、`u = -sin(roll)*rgt + cos(roll)*up`。`camRot` = [r, u, f]（列優先で 9 要素）。
8. `tanH = tan(FOV/2)`、`pxk = 2*tanH/resolution.y`（render で求める）。

renderAt は時刻 0 から全ステップを進めるので、状態を持つこのカメラも決定的になる。`statelessRender = true` のまま（GPU の履歴は持たない）。

## 7. 後処理（js/world/post.js の tesseractMode 枝）
いまの枝（bloom0..3 を .25/.25/.30/.45 で合成し、`aces((scene+bloom*BLOOM_STRENGTH)*.75)`）のまま使う。
定数は §2 の `BLOOM_THRESHOLD`、`BLOOM_STRENGTH` を参照する（名前は変えない）。

## 8. 配線と量子のビジョンの非表示
- `js/world/g-tesseract.js` を本書のとおりに書き換える。クラス名・id（`g-tesseract`）・label（テッセラクト）・key 4 は変えない。
- 量子のビジョン（g-quantum）は作り直しまで UI から外す: `WORLD_ANALYZER_TYPES` の g-quantum を `available: false` にし、`js/renderer-registry.js` の UI 一覧から外す（エンジンの型とコードは残す）。
  `available:false` のタイプがキー操作・UI・ランダム選択に出ないことを確かめ、必要なら除外を実装する。
- 影響するテスト（シェーダー数、GPU タイプ一覧、キー割り当て）を追従させる。

## 9. テスト（tests/unit/world-tesseract.test.mjs を書き換え）
- 定数・色: 表の値、GLD が金の標準色 5 つであること、AMB と GLD の色相が 15°〜55°（アンバー〜黄金）に入ること。
- シェーダー: 試作と同じ主要関数（beam、trace、shade、flash1、palCol、beamLight、mat）を含み、`phase`・`loud` などの uniform を宣言していること。
- 道: 同じ種で同じ折れ点。折れ点の座標がすべて 4 の倍数 + 2。隣の折れ点とは 1 軸だけが 12〜28 異なる。`at()` が区間の境目と角の前後で連続（距離 0.01 進めた差が 0.02 以下）。
- 向き: 60 fps で 60 秒進めたとき、1 ステップあたりの f と up の角度変化の最大が 0.35 rad 未満（飛びがない）。up と f が直交（|dot| < 1e-6）。
- 音の状態: flags の bit で cnt・age・age2 が更新されること、同じ t で二重に数えないこと、sm・loud の立ち上がりと減衰の時定数、phase が単調に増えること（PHASE_TIMBRE の項を除く）。
- preview: 拍の時刻で群 0・1 が立つこと。
- 量子のビジョン: `available:false`、UI 一覧に出ないこと。

## 10. 検証
- 実 GPU の Chrome で world ハーネスの renderAt を撮り、試作の同じ構図と見た目を比べる。
- 実曲（128 BPM）を通して、loudness.level の分布を測り、LOUD_LO/LOUD_HI を試作の loud（静か 0.1、ドロップ 0.55）に合わせる。
- エンジンの GPU 計測（metrics の gpuP95Ms）で 1920×1080 の描画時間を測る。
