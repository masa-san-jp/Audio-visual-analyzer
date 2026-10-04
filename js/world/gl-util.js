// 目的 — WebGL2 の資源・全画面パス・共通uniformを管理する — doc/20261004-concept-world-mode.md §2.7・§5
// WORLD-8: 計算領域だけを拡張し、画面座標・構図の世界単位は維持する。
const OVERSCAN = 1.5;
const WORLD_DOMAIN_MARGIN = .035; // 3%以上、既存の安全用フェード幅も避ける
const WORLD_VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
const WORLD_GLSL = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
// std140: 全パス共通。JS は事前確保した Float32Array を再利用する。
layout(std140) uniform World {
 vec4 clock; // 演出時刻、dt、音声時刻、セクション進行
 vec4 audio; // 低域、高域、ラウドネス、拍位相
 vec4 hit;   // 低域onset、高域onset、拍、相転移
 vec4 story; // kind、変奏、抽象モチーフ、予兆
 vec4 mood;  // 明るさ、中心力、霧、粘性
 vec4 camera;// 角度、距離、揺れ、複雑さ
 vec4 primary;
 vec4 secondary;
 vec4 chord;
 vec4 screen; // 幅、高さ、粒子密度、静寂
 vec4 eye, right, up, forward; // right/up/forward.w: 直近の衝撃環の中心xyz
 vec4 oldEye, oldRight, oldUp, oldForward;
 vec4 accent; // rgb: 第三色、w: drop開始時刻
 vec4 environment; // 抽象状態ID、変奏スケール、予約、予約
 vec4 lens; // 2Dカメラ: pan.xy、zoom、rotation
 vec4 composition; // 構図ID、曲中の遅い整数周期数、中心数、構図位相
 vec4 vortices[4]; // xy: 世界座標、z: 回転方向、w: 生成時刻
 vec4 shot; // セクションの経過秒、最新kickの中心xy、kick通番
 vec4 oldComposition, transition; // 構図モーフ、outro収束、前後kind
 vec4 emitters[32]; // 漂う帯域曲線の画面xy、平滑化レベル、瞬時レベル
};
// 曲の三色から照明役割を選ぶ。第二DROPだけアクセントとsecondaryの役割を交換する。
vec3 worldColor(float role){
 // パレットはCPU側でモーフ済み。RGB大小の分岐による突然の役割交換をしない。
 vec3 c=role<.5?primary.rgb:role<1.5?secondary.rgb:accent.rgb;
 float y=dot(c,vec3(.2126,.7152,.0722));
 return mix(vec3(y),c,role<1.5?.68:.78)*(role<.5?.22:role<1.5?.55:1.);
}
// kick/boundaryの薄い殻は0.4秒で厳密に消える（音声時刻、breakの遅延時刻ではない）。
float worldShockAge(){return min(secondary.w,max(0.,clock.z-accent.w));}
float worldShockFade(float age){return 1.-smoothstep(.08,.4,age);}
// 低域イベントの当該フレームから立ち上がり、継続フラグがなくても余韻を残す。
float worldDropFlare(){return max(hit.w,max(hit.x,exp(-max(0.,secondary.w)*18.)*worldShockFade(secondary.w)));}
float hash31(vec3 p){ p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
// 値ノイズ（三線形補間）。流体の注入を途切れさせ、細い筋を作るために使う
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x),mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),
  mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y),f.z);}
mat2 rot(float a){ return mat2(cos(a),sin(a),-sin(a),cos(a)); }
// 粒子と染料は同じ世界に置き、表示時だけ共通のカメラを適用する。
const float OVERSCAN = ${OVERSCAN};
vec2 worldExtent(){return vec2(screen.x/screen.y,1.)*OVERSCAN;}
vec2 worldUv(vec2 p){return p/worldExtent()+.5;}
vec2 worldDomainPosition(vec2 uv){return (uv-.5)*worldExtent();}
vec2 worldScreenUv(vec2 p){return p/vec2(screen.x/screen.y,1.)+.5;}
vec2 worldView(vec2 p){return rot(-lens.w)*(p-lens.xy)*lens.z;}
vec2 worldPosition(vec2 uv){return rot(lens.w)*((uv-.5)*vec2(screen.x/screen.y,1.))/lens.z+lens.xy;}
float worldKind(float id){
 float current=mix(float(transition.z==id),float(transition.w==id),transition.x);
 return mix(current,float(id==0.),transition.y);
}
// dropの空間解放は0.5秒程度で立ち上がる。カメラには瞬時の切り返しを加えない。
float worldDropSpace(){
 float base=worldKind(2.);
 return base+(1.-base)*(1.-exp(-max(0.,clock.z-accent.w)*6.))*float(story.x==2.);
}
float worldSlowPhase(){return clock.x*composition.y;}
vec2 worldCenter(int i){
 // 曲の周期に整数周波数を掛ける。両端で位置と微分が一致する。
 return vortices[i].xy+vec2(cos(worldSlowPhase()+float(i)*2.),sin(worldSlowPhase()+float(i)*2.))*.07;
}
float worldPeriodicNoise(vec2 p,float scale,float phase){
 vec2 a=p/worldExtent()*6.283185;
 return noise3(vec3(sin(a.x)*scale,cos(a.x)*scale+sin(a.y)*scale,cos(a.y)*scale+phase));
}
vec2 flowFor(vec2 p,float id,float count){
 vec2 f=vec2(0);
 for(int i=0;i<2;i++){
  vec2 a=(p-worldCenter(i))/worldExtent()*6.283185;
  vec2 d=sin(a)*worldExtent()/6.283185;
  float r2=dot(d,d)+.018;
  f+=vec2(-d.y,d.x)*vortices[i].z*.075/r2*(i==0?1.:count-1.);
 }
 float t=worldSlowPhase();
 vec2 a=p/worldExtent()*6.283185;
 vec2 undulation=vec2(sin(a.y+sin(t)),cos(a.x+cos(t)))*.13;
 if(id==1.)f+=vec2(.16,.08);
 if(id==2.)f+=vec2(.2,.04);
 if(id==4.)f-=sin(a)*(.15+.25*worldKind(1.));
 vec2 axis=normalize(vortices[1].xy-vortices[0].xy+vec2(.001));
 vec2 d=sin(p/worldExtent()*6.283185)*worldExtent()/6.283185;
 float shear=exp(-pow(dot(d,vec2(-axis.y,axis.x))/.08,2.));
 return f+undulation+axis*.45*shear*worldKind(2.);
}
vec2 worldFlow(vec2 p){
 p=worldDomainPosition(fract(worldUv(p)));
 vec2 f=mix(flowFor(p,oldComposition.x,oldComposition.z),flowFor(p,composition.x,composition.z),transition.x);
 return mix(f,flowFor(p,3.,2.),transition.y)*(1.+audio.x*.35+environment.z*.25);
}
// 角度の反復や水平な正弦波の列を使わず、雲の密度境界に細い筋を置く。
// 回転させながら重ねる fbm（格子方向の癖を消す）
float worldFbm(vec3 p){float a=.5,s=0.;mat2 R=mat2(.8,.6,-.6,.8);
 for(int i=0;i<3;i++){s+=a*noise3(p);p.xy=R*p.xy*2.03;p.z+=1.7;a*=.5;}return s*1.14;}
// 星雲: ドメインワープした fbm の柔らかい雲と、流れに沿う細い筋。
// 値ノイズの等高線（網目・水面の揺らぎに見える）は使わない。周期写像で継ぎ目なし
float worldNebula(vec2 p,float depth){
 float t=clock.x;vec2 drift=vec2(sin(t),cos(t))*.12;
 vec2 q=sin(p/worldExtent()*6.283185)*worldExtent()*.5;
 vec2 w=vec2(worldFbm(vec3(q*1.6,depth)),worldFbm(vec3(q*1.6+5.2,depth+3.)));
 float n=worldFbm(vec3(q*2.2+w*1.8+drift,depth+t*.05));
 float wisp=pow(worldFbm(vec3(q*6.+w*3.,depth*2.+t*.03)),3.);
 return smoothstep(.42,.85,n)*(.03+wisp*.25);
}
float filamentFor(vec2 p,float id,float a){
 float t=worldSlowPhase();
 if(id==3.)return worldNebula(p,2.+sin(clock.x));
 // v8の細い渦腕を復元。周期領域の差分座標で両端の連続性を保持する。
 float f=0.;
 for(int i=0;i<2;i++){
  vec2 angle=(p-worldCenter(i))/worldExtent()*6.283185;
  vec2 d=sin(angle)*worldExtent()/6.283185;float r=length(d);
  float warp=worldPeriodicNoise(p,3.,sin(t))*1.8;
  float phase=atan(d.y,d.x)*2.+r*36.+sin(t)+float(i)+a*.15+warp;
  float width=.009*(1.+environment.z*.3);
  f+=exp(-pow(sin(phase)*max(.03,r)/width,2.))*exp(-r*3.);
 }
 return min(1.,f);
}
float worldFilament(vec2 p){
 p=worldDomainPosition(fract(worldUv(p)));
 // 遷移中だけ両方を評価する（常時3回の評価が GPU 時間の大半を占めていた）
 float f=filamentFor(p,composition.x,composition.w);
 if(transition.x<.999)f=mix(filamentFor(p,oldComposition.x,oldComposition.w),f,transition.x);
 if(transition.y>.001)f=mix(f,filamentFor(p,3.,0.),transition.y);
 return f;
}
vec2 emitterWorld(int i){
 vec2 p=emitters[i].xy;
 return rot(lens.w)*p/lens.z+lens.xy;
}
float worldShock(vec2 p){
 float age=worldShockAge(),r=length(p-shot.yz);
 return exp(-pow((r-(.025+age*1.6))/.018,2.))*worldShockFade(age);
}
`;
class WorldGL {
  constructor(canvas) {
    this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
    if (!this.gl || !this.gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('この環境では利用できません');
    }
    // RGBA16Fの加算は標準で可能。32F状態textureにはブレンドしないためEXT_float_blendを要求しない。
    this.linearFloat = !!this.gl.getExtension('OES_texture_float_linear');
    this.textures = []; this.fbos = []; this.programs = [];
    this.vao = this.gl.createVertexArray(); this.gl.bindVertexArray(this.vao);
    this.uniforms = new Float32Array(244);
    this.ubo = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.UNIFORM_BUFFER, this.ubo);
    this.gl.bufferData(this.gl.UNIFORM_BUFFER, this.uniforms.byteLength, this.gl.DYNAMIC_DRAW);
    this.gl.bindBufferBase(this.gl.UNIFORM_BUFFER, 0, this.ubo);
  }
  program(fragment, vertex = WORLD_VERTEX) {
    const gl = this.gl;
    const compile = (type, source) => {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(error);
      }
      return s;
    };
    const v = compile(gl.VERTEX_SHADER, vertex), f = compile(gl.FRAGMENT_SHADER, fragment);
    const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const block = gl.getUniformBlockIndex(p, 'World');
    if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, block, 0);
    this.programs.push(p); return p;
  }
  target(width, height, fullFloat = false, byte = false, repeat = false) {
    const gl = this.gl, texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, byte ? gl.RGBA8 : fullFloat ? gl.RGBA32F : gl.RGBA16F, width, height);
    const filter = fullFloat && !this.linearFloat ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('HDR framebuffer unavailable');
    gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    this.textures.push(texture); this.fbos.push(fbo);
    return { texture, fbo, width, height };
  }
  pair(w, h, fullFloat = false, repeat = false) { return { read: this.target(w, h, fullFloat, false, repeat), write: this.target(w, h, fullFloat, false, repeat) }; }
  swap(pair) { const old = pair.read; pair.read = pair.write; pair.write = old; }
  bind(p, target) {
    const gl = this.gl; gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.width : gl.canvas.width, target ? target.height : gl.canvas.height);
  }
  texture(p, name) { return this.gl.getUniformLocation(p, name); }
  sampler(location, unit, target) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, target.texture); gl.uniform1i(location, unit);
  }
  draw() { this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }
  upload() {
    const gl = this.gl; gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo); gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.uniforms);
  }
  clearTarget(t) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  releaseTarget(t) {
    this.gl.deleteTexture(t.texture); this.gl.deleteFramebuffer(t.fbo);
    this.textures.splice(this.textures.indexOf(t.texture), 1); this.fbos.splice(this.fbos.indexOf(t.fbo), 1);
  }
  dispose() {
    const gl = this.gl;
    for (const p of this.programs) gl.deleteProgram(p);
    for (const t of this.textures) gl.deleteTexture(t);
    for (const f of this.fbos) gl.deleteFramebuffer(f);
    gl.deleteBuffer(this.ubo); gl.deleteVertexArray(this.vao);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldGL, OVERSCAN, WORLD_DOMAIN_MARGIN }; }
