// g-quantum v2 のフラグメントシェーダー本文（設計 doc/20261028-design-quantum-v2.md §4）。
// 試作 scratchpad/proto/q1.html の FS から、水面の場面（オーナー指示で不使用）を除いたもの。
// この前に、設計 §4.1 のヘッダー（#version・precision・uniform・色の定数）を置く。
uint hu(uint x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;return x;}
float h1(ivec2 c,int s){return float(hu(uint(c.x)*73856093u^uint(c.y)*19349663u^uint(s)*83492791u))/4294967295.;}
vec2 h2(ivec2 c,int s){return vec2(h1(c,s),h1(c,s+101));}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);ivec2 c=ivec2(i);
  return mix(mix(h1(c,7),h1(c+ivec2(1,0),7),f.x),mix(h1(c+ivec2(0,1),7),h1(c+ivec2(1,1),7),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vnoise(p);p=p*2.03+vec2(17.1,9.3);a*=.5;}return s;}
// ぼけの円: 半径 r、中心からの距離 d。縁がわずかに明るい（実写のぼけ）。面積が大きいほど暗い
float bokeh(float d,float r,float px){
  float e=max(px*1.2,r*.22);
  float disc=1.-smoothstep(r-e,r+e,d);
  float rim=smoothstep(r*.55,r,d)*disc;
  return disc*(.75+.35*rim);
}
// 層に分けた粒子の場（画面空間）。z=0 が奥（小さく鋭い点）、1 が手前（大きなぼけ）
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float beat(float k){return exp(-age.x*k);}
float clump(vec2 uv,float t,int seed){return smoothstep(.42,.72,fbm(uv*1.4+vec2(float(seed)*3.1,t*.03)));}
vec3 particles(vec2 uv,float t,int seed,int nl,float dens,vec2 drift,int pal,float gain){
  vec3 col=vec3(0.); float px=1./res.y;
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
    for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
      ivec2 cc=c+ivec2(dx,dy);
      float hp=h1(cc,sd+i*31);
      float cm=clump((vec2(cc)+.5)*cs-v*t,t,sd);
      if(hp>dens*(1.-.6*z)*(.15+.85*cm))continue;
      vec2 o=h2(cc,sd+i*31+5);
      vec2 q=vec2(cc)+.15+.7*o+.12*vec2(sin(t*.7+hp*40.),cos(t*.6+hp*30.));
      vec2 dv=(p-q)*cs; vec2 rad=normalize(uv+1e-4);
      float st=1.+camV*z*z*length(uv)*5.;
      float d=length(vec2(dot(dv,rad)/st,dot(dv,vec2(-rad.y,rad.x))));
      float rr=r*(.6+.8*h1(cc,sd+i*31+9));
      float b=bokeh(d,max(rr,px*.8),px);
      if(b<=0.)continue;
      float hc=h1(cc,sd+i*31+13);
      vec3 cl=pal==0?TEAL[int(hc*8.)%8]:pal==1?GOLDB[int(hc*5.)%5]:SHELL[int(hc*6.)%6];
      // 小さい鋭い点は明るく、大きなぼけは薄く広く
      float sharp=1.-z;
      float I=fz*gain*(.25+2.2*pow(h1(cc,sd+i*31+17),5.)*sharp)*clamp(.0035/max(rr,.0011),.11,2.2);
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
    float d=length(p-q)/scale*res.y;
    s+=exp(-d*d*.22)*(.4+1.2*h1(cc,seed+7));
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
vec3 sparks2(vec2 uv,float t,vec2 src,float spread,float speed,float grav,float life,int seed,float gain,int pal,float dtE,float thick,float jit);
float dashField(vec2 uv,vec2 src,float t,float cols,float spd,float len,int seed,float dens,out float hc);
// 火花（光跡）: 発生点 src から上向きの円錐へ、毎秒 rate 個。重力で曲がり、温度で白→黄→橙→赤
vec3 sparks(vec2 uv,float t,vec2 src,float spread,float speed,float grav,float life,int seed,float gain,int pal){
  return sparks2(uv,t,src,spread,speed,grav,life,seed,gain,pal,.07,1.,.04);
}
vec3 sparks2(vec2 uv,float t,vec2 src,float spread,float speed,float grav,float life,int seed,float gain,int pal,float dtE,float thick,float jit){
  vec3 col=vec3(0.); float px=1./res.y;
  const int NS=220;
  for(int i=0;i<NS;i++){
    float fi=float(i);
    float per=life*(.7+.6*h1(ivec2(i,seed),1));
    float ph=h1(ivec2(i,seed),2)*per;
    float tt=t+ph; float k=floor(tt/per); float a=tt-k*per;   // この火花の年齢
    ivec2 key=ivec2(i,int(k));
    float ang=1.5708+(h1(key,seed+3)-.5)*spread;
    float v=speed*(.4+.9*h1(key,seed+4))*(1.+.6*sm.x);
    vec2 v0=vec2(cos(ang),sin(ang))*v;
    vec2 p0=src+(h2(key,seed+5)-.5)*jit;
    // 長時間露光: 年齢 a-dt から a までの区間を線分として描く
    float dt=dtE*(.5+h1(key,seed+8));
    vec2 pa=p0+v0*max(a-dt,0.)+vec2(0.,-grav)*.5*max(a-dt,0.)*max(a-dt,0.);
    vec2 pb=p0+v0*a+vec2(0.,-grav)*.5*a*a;
    vec2 ab=pb-pa; float l2=max(dot(ab,ab),1e-9);
    float h=clamp(dot(uv-pa,ab)/l2,0.,1.);
    float dd=length(uv-pa-ab*h);
    float w=px*thick*(1.2+1.5*h1(key,seed+6));
    float core=exp(-dd*dd/(w*w));
    if(core<1e-3)continue;
    float heat=1.-a/per;
    vec3 cl=pal==0?(heat>.75?mix(SPARK[3],SPARK[4],(heat-.75)*4.):heat>.4?mix(SPARK[1],SPARK[3],(heat-.4)/.35):mix(SPARK[0]*.6,SPARK[1],heat/.4))
                  :mix(STREAK[int(h1(key,seed+7)*7.)%7],vec3(.85,.95,1.),heat*.5);
    col+=cl*core*gain*(.3+1.2*heat)*smoothstep(0.,.02,a);
  }
  return col;
}
// 場面 3: 火花の噴出と金のぼけ（参照 12・4）
vec3 sceneSparks(vec2 uv,float t){
  vec2 src=vec2(.02,-.02);
  vec3 c=vec3(.015,.006,.002);
  // 火の霞（発生点のまわり）
  float fire=pow(fbm(uv*4.5+vec2(0.,-t*.6)+fbm(uv*9.)*.6),2.6)*exp(-length((uv-src)*vec2(1.6,.8))*2.6)*1.6;
  c+=mix(SPARK[0],SPARK[4],fire*fire*2.)*fire*2.2*(1.+.8*sm.x);
  c+=sparks2(uv,t,src+vec2(0.,.05),6.283,.8,.3,.8,3,1.4*(.4+2.6*beat(2.5)),0,.03,1.6,.5);
  c+=sparks2(uv,t*1.3,src,6.283,.45,.2,1.1,4,1.,0,.02,1.2,.8);
  c+=particles(uv,t,17,5,.5,vec2(.0,.02),1,1.2)*vec3(1.,.55,.2)*exp(-length(uv-src)*1.2)*(1.+1.5*beat(2.5));
  c+=sparks2(uv,t*.8,src+vec2(.1,.2),6.283,.3,.1,1.4,5,.8,0,.025,1.4,.9);
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
    float w=(.6+1.*h1(cc,seed+3))/res.y;
    float k=exp(-ax*ax/(w*w))*along*(.4+1.2*h1(cc,seed+4));
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
  float colm=exp(-pow((th+.2)/.11,2.))+exp(-pow((th-.18)/.11,2.));
  for(int L=0;L<3;L++){
    float hc; float fl=float(L);
    vec2 wob=vec2(fbm(uv*3.+t*.2)-.5,0.)*.06;
    float k=dashField(uv+wob,src+vec2(.03*fl,0.),t,1600.-fl*400.,.9+.3*fl,1.1+fl*.5,71+L,.05+.55*colm,hc);
    vec3 cl=mix(STREAK[int(hc*4.)%4],vec3(.8,.95,1.),.25+.35*hc);
    c+=cl*k*(.35+.9*colm)*(1.-.25*fl)*(1.+.6*sm.z+1.2*beat(3.))*smoothstep(.25,.6,length(uv-src));
  }
  // 柱の虹色のにじみ
  vec3 irid=.5+.5*cos(6.283*(uv.y*1.5+vec3(0.,.33,.67))+th*8.);
  c+=mix(STREAK[2],irid,.18)*colm*.22*smoothstep(-.9,.4,uv.y)*(.6+.5*fbm(vec2(th*20.,uv.y*3.-t)));
  // 横の光の帯
  float band=exp(-pow((uv.y+.18+.03*sin(uv.x*3.+t))/.05,2.));
  c+=STREAK[6]*band*(.03+.05*fbm(vec2(uv.x*4.-t*.3,0.)))*(1.+sm.z+beat(3.));
  c+=particles(uv,t,13,5,.4,vec2(0.,-.03),0,.8)*vec3(.6,.8,1.2);
  return c;
}
// 場面 6: ミントの光（参照 15）。露出の飛んだ淡い緑に、暗い塵が流れる
vec3 sceneMint(vec2 uv,float t){
  vec3 c=mix(MINT[0],MINT[2],fbm(uv*2.+t*.05))*.62;
  c=mix(vec3(dot(c,vec3(.3,.59,.11))),c,1.6);
  c+=MINT[3]*.6*sparks2(uv,t*.5,vec2(-.9,-.6),1.4,.6,0.,3.,61,1.,1,.05,1.6,1.2);
  c-=vec3(.08,.05,.07)*powder(uv+vec2(t*.02,-t*.01),t,220.,51,.35);
  {float hc; float k=dashField(uv,vec2(-1.2,-.9),t,500.,.3,.8,91,.1*(.3+fbm(uv*2.)),hc); c+=MINT[3]*k*.6;}
  return c;
}
vec3 sceneOf(int scene,vec2 uv,float time,float ts);
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;
  vec3 c=sceneOf(scene,uv,time,tA);
  if(mixW>0.)c=mix(c,sceneOf(sceneB,uv,time,tB),mixW);
  float warm=float(scene==1||scene==2||scene==3)*(1.-mixW)+float(sceneB==1||sceneB==2||sceneB==3)*mixW;
  vec2 fu=rot(camRoll)*uv;
  c+=particles(fu,time,401,4,.16,vec2(0.),warm>.5?1:0,.55)*mix(vec3(.8,1.,1.1),vec3(1.2,.9,.6),warm);
  c*=1.+.45*beat(4.)*(.4+loud);
  frag=vec4(c,1.);
}
vec2 camera(int scene,vec2 uv,float ts){
  uv=rot(camRoll)*uv;
  if(scene==0)return uv;
  if(scene==4)return rot(.05*ts)*(uv+vec2(0.,-.35+.09*ts));                 // 流れを追って振り上げる
  if(scene==6)return uv+vec2(.08,.04)*ts;
  if(scene==1)return rot(.14*ts+.2)*uv/(.75+.16*ts);                         // 遠くから殻へ寄りながら回り込む
  if(scene==3)return rot(-.08*ts)*uv/(.8+.2*ts);                             // 噴出へ突っ込む
  if(scene==2)return uv/(1.+.05*ts)+vec2(.13*ts-.35,.03*ts);                 // 表面を横へなめる
  return uv;
}
vec3 sceneOf(int scene,vec2 uv0,float time,float ts){
  vec2 uv=camera(scene,uv0,ts);
  vec3 c;
  if(scene==1)c=sceneShell(uv,time);
  else if(scene==2)c=sceneSun(uv,time);
  else if(scene==3)c=sceneSparks(uv,time);
  else if(scene==4)c=sceneStreams(uv,time);
  else if(scene==5)c=sceneRipples(uv,time);
  else if(scene==6)c=sceneMint(uv,time);
  else c=sceneDust(uv,time);
  return c;
}