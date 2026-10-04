// 目的 — WebGL2 の資源・全画面パス・共通uniformを管理する — doc/20261004-concept-world-mode.md §2.6・§5
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
    this.uniforms = new Float32Array(80);
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
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldGL }; }
