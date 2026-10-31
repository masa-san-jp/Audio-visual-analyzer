// 目的 — WebGL2 の資源・全画面パス・共通uniformを管理する — doc/20261004-concept-world-mode.md §2.7・§5
// WORLD-8: 計算領域だけを拡張し、画面座標・構図の世界単位は維持する。
const OVERSCAN = 1.5;
const WORLD_DOMAIN_MARGIN = .035; // 3%以上、既存の安全用フェード幅も避ける
const WORLD_VERTEX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec2 vUv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
// 後処理（post.js）が使う共通の式と名前つき定数。
const WORLD_GPU_DESIGN_GLSL = `
const float PI=3.141592653589793, TAU=6.283185307179586;
const float BAND_SECONDARY_END=.65, BAND_ACCENT_START=.78;
vec3 bandRamp(float x,vec3 a,vec3 b,vec3 c){
 return mix(mix(a,b,smoothstep(0.,BAND_SECONDARY_END,x)),c,smoothstep(BAND_ACCENT_START,1.,x));
}
`;
const WORLD_GLSL = `
${WORLD_GPU_DESIGN_GLSL}
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
float worldShockFade(float age){return 1.-smoothstep(.08,.4,age);}
// 低域イベントの当該フレームから立ち上がり、継続フラグがなくても余韻を残す。
float worldDropFlare(){return max(hit.w,max(hit.x,exp(-max(0.,secondary.w)*18.)*worldShockFade(secondary.w)));}
mat2 rot(float a){ return mat2(cos(a),sin(a),-sin(a),cos(a)); }
float worldKind(float id){
 float current=mix(float(transition.z==id),float(transition.w==id),transition.x);
 return mix(current,float(id==0.),transition.y);
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
// '#RRGGBB'（sRGB）を linear に変換して out[0..2] に書く
function worldSrgbToLinear(hex, out = new Float32Array(3)) {
  const v = parseInt(hex.slice(1), 16);
  for (let i = 0; i < 3; i++) {
    const c = ((v >> (16 - 8 * i)) & 255) / 255;
    out[i] = c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
  }
  return out;
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldGL, OVERSCAN, WORLD_DOMAIN_MARGIN, worldSrgbToLinear }; }
