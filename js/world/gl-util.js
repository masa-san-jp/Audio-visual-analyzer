// 目的 — WebGL2 の資源・全画面パス・共通uniformを管理する — doc/20261004-concept-world-mode.md §2.6・§5
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
 vec4 composition; // 構図ID、曲seed、中心数、構図位相
 vec4 vortices[4]; // xy: 世界座標、z: 回転方向、w: 生成時刻
 vec4 shot; // 小節頭の経過秒、最新kickの中心xy、kick通番
};
// 曲の三色から照明役割を選ぶ。第二DROPだけアクセントとsecondaryの役割を交換する。
vec3 worldColor(float role){
 vec3 warm=primary.rgb,base=secondary.rgb,fill=accent.rgb;
 if(secondary.r>secondary.b){warm=secondary.rgb;base=primary.rgb;fill=accent.rgb;}
 else if(accent.r>accent.b){warm=accent.rgb;base=primary.rgb;fill=secondary.rgb;}
 if(base.g<fill.g){vec3 swapColor=base;base=fill;fill=swapColor;}
 if(environment.x==2.&&story.y>1.5){vec3 swapColor=warm;warm=fill;fill=swapColor;}
 vec3 c=role<.5?base:role<1.5?fill:warm;
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
vec2 worldCenter(int i){
 vec4 v=vortices[i];float age=max(0.,clock.z-v.w);
 vec2 orbit=vec2(cos(age*.9+float(i)*2.),sin(age*.9+float(i)*2.))*.055;
 // 小節頭だけペアを寄せ、再び離す。原点への固定収束はしない。
 vec2 midpoint=(vortices[i-i%2].xy+vortices[i-i%2+1].xy)*.5;
 return mix(v.xy+orbit,midpoint,.65*exp(-shot.x*5.));
}
vec2 worldFlow(vec2 p){
 float id=composition.x,t=clock.x;
 if(id==0.||story.x==2.){
  vec2 f=vec2(0);
  for(int i=0;i<4;i++){
   if(float(i)>=composition.z)break;
   vec2 d=p-worldCenter(i);float r2=dot(d,d)+.018;
   f+=vec2(-d.y,d.x)*vortices[i].z*.075/r2;
  }
  // ペアの間を貫く細い流線。kickの合間も力は途切れない。
  vec2 axis=normalize(vortices[1].xy-vortices[0].xy+vec2(.001));
  vec2 d=p-(vortices[0].xy+vortices[1].xy)*.5;
  if(id==1.)f+=vec2(.4,.2);
  return f+axis*.45*exp(-pow(dot(d,vec2(-axis.y,axis.x))/.08,2.));
 }
 if(id==1.)return vec2(.55,.28)+vec2(.12*sin(p.y*13.-t),.16*cos(p.x*8.-t));
 if(id==2.)return vec2(.75,.06*sin(p.x*9.-t*2.));
 if(id==3.)return vec2(.12+.06*cos(p.y*18.),.018*sin(p.x*5.+t*.3));
 vec2 d=p-vortices[0].xy;float r=max(.04,length(d));
 return vec2(-d.y,d.x)/r*.5-d*(story.x==1.?.35+clock.w*.6:-.12);
}
// 太い円盤の代わりに細い曲線を注入。armは世界の端まで伸びる。
float worldFilament(vec2 p){
 float id=composition.x,t=clock.x,a=composition.w;
 if(id==0.){
  float f=0.;
  for(int i=0;i<4;i++){
   if(float(i)>=composition.z)break;
   vec2 d=p-worldCenter(i);float r=length(d);
   float phase=atan(d.y,d.x)*2.+r*36.-t*2.+float(i);
   f+=exp(-pow(sin(phase)*r/.009,2.))*exp(-r*3.);
  }
  return min(1.,f);
 }
 if(id==1.)return exp(-pow(sin((p.y-p.x*.48+.035*sin(p.x*8.-t))*24.+a)/.11,2.));
 if(id==2.)return exp(-pow(sin((p.y+.035*sin(p.x*9.-t))*32.+a)/.10,2.));
 if(id==3.)return exp(-pow(sin((p.y+.025*sin(p.x*5.+t*.3))*48.+a)/.14,2.));
 vec2 d=p-vortices[0].xy;float r=length(d);
 return exp(-pow(sin(atan(d.y,d.x)*3.+r*22.-t*1.3+a)/.10,2.));
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
    this.uniforms = new Float32Array(108);
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
  target(width, height, fullFloat = false, byte = false) {
    const gl = this.gl, texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, byte ? gl.RGBA8 : fullFloat ? gl.RGBA32F : gl.RGBA16F, width, height);
    const filter = fullFloat && !this.linearFloat ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('HDR framebuffer unavailable');
    gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    this.textures.push(texture); this.fbos.push(fbo);
    return { texture, fbo, width, height };
  }
  pair(w, h, fullFloat = false) { return { read: this.target(w, h, fullFloat), write: this.target(w, h, fullFloat) }; }
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
