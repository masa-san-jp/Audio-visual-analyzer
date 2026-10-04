// 目的 — 移流・粘性拡散・渦度閉じ込め・圧力投影による Stable Fluids — doc/20261004-concept-world-mode.md §2.7・§3
const WORLD_FLUID_FRAGMENT = `#version 300 es
${WORLD_GLSL}
uniform sampler2D field, velocity, auxiliary;
uniform int mode;
out vec4 frag;
void main(){
 vec2 dx=1./vec2(textureSize(field,0)), uv=vUv;
 vec4 c=texture(field,uv),l=texture(field,fract(uv-vec2(dx.x,0))),r=texture(field,fract(uv+vec2(dx.x,0)));
 vec4 b=texture(field,fract(uv-vec2(0,dx.y))),t=texture(field,fract(uv+vec2(0,dx.y)));
 vec2 q=worldDomainPosition(uv);
 if(mode==0){ // 半ラグランジュ移流。速度は格子セル/秒。
   frag=texture(field,fract(uv-clock.y*texture(velocity,uv).xy*dx));
   frag.xy*=exp(-clock.y*(.12+story.w*1.8));
 }else if(mode==1){ // 構図の流線と、キック位置からの衝撃。
   vec2 v=c.xy;
   vec2 d=q-shot.yz;float distance=max(.002,length(d));
   vec2 desired=worldFlow(q)*(.65+worldKind(2.)*.95-worldKind(0.)*.53-worldKind(3.)*.47-worldKind(4.)*.57);
   // 速度格子のセル/秒へ変換。投影後も渦ペア間の剪断を維持する。
   vec2 cells=vec2(textureSize(velocity,0))/worldExtent();
   v+=clock.y*(desired*cells-v)*(story.x==2.?5.:1.4);
   if(story.x==2.)v+=clock.y*d/distance*(worldShock(q)*180.+hit.x*100.*exp(-distance*12.));
   frag=vec4(clamp(v,vec2(-120),vec2(120)),0,1);
 }else if(mode==2){ // curl(v)
   frag=vec4(.5*(r.y-l.y-t.x+b.x),0,0,1);
 }else if(mode==3){ // 渦度閉じ込め: ∇|curl| × curl。
   vec2 n=.5*vec2(abs(r.x)-abs(l.x),abs(t.x)-abs(b.x)); n/=length(n)+.0001;
   vec2 v=texture(velocity,uv).xy+clock.y*(8.+audio.x*35.)*vec2(n.y,-n.x)*c.x;
   frag=vec4(clamp(v,vec2(-120),vec2(120)),0,1);
 }else if(mode==4){ // 非圧縮条件の右辺。
   frag=vec4(.5*(r.x-l.x+t.y-b.y),0,0,1);
 }else if(mode==5){ // Poisson 方程式の Jacobi 反復。
   frag=vec4((l.x+r.x+b.x+t.x-texture(auxiliary,uv).x)*.25,0,0,1);
 }else if(mode==6){ // 圧力勾配を引いて発散を除く。
   vec2 v=texture(velocity,uv).xy-.5*vec2(r.x-l.x,t.x-b.x);
   frag=vec4(v,0,1);
 }else if(mode==7){ // 染料の移流と減衰。三色の発光性の煙と全方位バースト。
   vec2 dv=1./vec2(textureSize(velocity,0)); // 染料は速度格子の2倍の解像度。変位は速度格子のセル単位
   vec3 dye=texture(field,fract(uv-clock.y*texture(velocity,uv).xy*dv)).rgb;
   dye*=exp(-clock.y*(story.x==4.?1.5:.25));
   float angle=atan(q.y,q.x)+camera.x;
   // 細い注入とノイズの途切れで、渦に巻かれて細い筋（フィラメント）が生まれるようにする
   float plume=worldFilament(q)*smoothstep(.35,.75,worldPeriodicNoise(q,5.,sin(worldSlowPhase())));
   float burst=worldShock(q)*(.4+.6*worldPeriodicNoise(q,7.,7.));
   float inkRate=1.-worldKind(0.)*.5-worldKind(3.)*.4-worldKind(4.);
   dye+=clock.y*inkRate*(1.+audio.z*4.+hit.x*12.)*plume*mix(worldColor(0.),worldColor(1.),.5+.5*sin(angle));
   dye+=clock.y*(hit.w*14.*burst+hit.x*8.*burst)*worldColor(story.y>1.5?1.:2.);
   frag=vec4(min(dye,vec3(32)),1);
 }else { // 暗黙的粘性拡散: 初期速度を auxiliary に固定して反復。
   float a=clock.y*mood.w*35.; frag=vec4((texture(auxiliary,uv).xy+a*(l.xy+r.xy+b.xy+t.xy))/(1.+4.*a),0,1);
 }
}`;
// 帯域の短い細線を32個のquadで供給。流れの向きで変形し、染料は直ちに移流へ乗る。
const WORLD_SPECTRUM_VERTEX = `#version 300 es
${WORLD_GLSL.replace('in vec2 vUv;', '')}
uniform int screenSpace;
out vec2 local;
out float level;
out vec3 tint;
void main(){
 int i=gl_VertexID/6,j=gl_VertexID%6;
 vec2 corner=j==0?vec2(-1,-1):j==1?vec2(1,-1):j==2?vec2(-1,1):j==3?vec2(-1,1):j==4?vec2(1,-1):vec2(1,1);
 local=corner;level=emitters[i].z;
 vec2 point=emitterWorld(i),flow=worldFlow(point);
 vec2 tangent=length(flow)>.001?normalize(flow):vec2(1,0),normal=vec2(-tangent.y,tangent.x);
 float radius=.010+level*.002;
 // 核は局所輝度を保ち、短い尖った筋を同じ流れに沿って作る。平行な長い噴流は作らない。
 vec2 offset=tangent*corner.x*radius+normal*corner.y*radius*.38;
 vec2 uv=screenSpace==1?worldScreenUv(emitters[i].xy+rot(-lens.w)*offset*lens.z):worldUv(point+offset);
 gl_Position=vec4(uv*2.-1.,0,1);
 // 全噴出点の基準色度を共通にし、輝度の順位を帯域のレベルだけで決める。
 tint=worldColor(1.);tint/=max(.01,dot(tint,vec3(.2126,.7152,.0722)));
}`;
const WORLD_SPECTRUM_FRAGMENT = `#version 300 es
precision highp float;
in vec2 local;in float level;in vec3 tint;
uniform float amount;
out vec4 frag;
void main(){float r=dot(local,local);if(r>1.)discard;
 frag=vec4(tint*level*exp(-r*6.)*amount,0);
}`;
class WorldSpectrum {
 constructor(gpu){this.gpu=gpu;this.program=gpu.program(WORLD_SPECTRUM_FRAGMENT,WORLD_SPECTRUM_VERTEX);
  this.space=gpu.texture(this.program,'screenSpace');this.amount=gpu.texture(this.program,'amount');}
 render(target,screenSpace,amount){const g=this.gpu,gl=g.gl;g.bind(this.program,target);
  gl.uniform1i(this.space,screenSpace);gl.uniform1f(this.amount,amount);
  gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.drawArrays(gl.TRIANGLES,0,32*6);gl.disable(gl.BLEND);}
}
class WorldFluid {
  constructor(gpu, w, h) {
    this.gpu = gpu; this.program = gpu.program(WORLD_FLUID_FRAGMENT);
    this.fieldLoc = gpu.texture(this.program, 'field'); this.velocityLoc = gpu.texture(this.program, 'velocity');
    this.auxLoc = gpu.texture(this.program, 'auxiliary'); this.modeLoc = gpu.texture(this.program, 'mode');
    this.spectrum = new WorldSpectrum(gpu); this.resize(w, h);
  }
  resize(w, h) {
    const g = this.gpu;
    if (this.velocity) {
      g.releaseTarget(this.velocity.read); g.releaseTarget(this.velocity.write);
      g.releaseTarget(this.pressure.read); g.releaseTarget(this.pressure.write);
      g.releaseTarget(this.dye.read); g.releaseTarget(this.dye.write);
      g.releaseTarget(this.curl); g.releaseTarget(this.divergence); g.releaseTarget(this.base);
    }
    const fw = Math.max(2, Math.ceil(w * OVERSCAN / 4)), fh = Math.max(2, Math.ceil(h * OVERSCAN / 4));
    const dw = Math.max(2, Math.ceil(w * OVERSCAN / 2)), dh = Math.max(2, Math.ceil(h * OVERSCAN / 2)); // 染料は画面の1/2×オーバースキャン（世界単位の細部を保つ）
    this.velocity = g.pair(fw, fh, false, true); this.pressure = g.pair(fw, fh, false, true); this.dye = g.pair(dw, dh, false, true);
    this.curl = g.target(fw, fh, false, false, true); this.divergence = g.target(fw, fh, false, false, true); this.base = g.target(fw, fh, false, false, true);
  }
  reset() {
    const g = this.gpu;
    g.clearTarget(this.velocity.read); g.clearTarget(this.velocity.write);
    g.clearTarget(this.pressure.read); g.clearTarget(this.pressure.write);
    g.clearTarget(this.dye.read); g.clearTarget(this.dye.write);
    g.clearTarget(this.curl); g.clearTarget(this.divergence); g.clearTarget(this.base);
  }
  pass(mode, field, target, auxiliary = this.divergence) {
    const g = this.gpu, p = this.program; g.bind(p, target);
    g.sampler(this.fieldLoc, 0, field); g.sampler(this.velocityLoc, 1, this.velocity.read);
    g.sampler(this.auxLoc, 2, auxiliary === target ? this.base : auxiliary); g.gl.uniform1i(this.modeLoc, mode); g.draw();
  }
  step() {
    const g = this.gpu;
    this.pass(0, this.velocity.read, this.base);
    this.pass(1, this.base, this.velocity.write); g.swap(this.velocity);
    // 粘性の反復で使う固定 RHS。コピーも GPU 内で完結する。
    g.gl.bindFramebuffer(g.gl.READ_FRAMEBUFFER, this.velocity.read.fbo);
    g.gl.bindFramebuffer(g.gl.DRAW_FRAMEBUFFER, this.base.fbo);
    g.gl.blitFramebuffer(0, 0, this.base.width, this.base.height, 0, 0, this.base.width, this.base.height, g.gl.COLOR_BUFFER_BIT, g.gl.NEAREST);
    for (let i = 0; i < 4; i++) { this.pass(8, this.velocity.read, this.velocity.write, this.base); g.swap(this.velocity); }
    this.pass(2, this.velocity.read, this.curl);
    this.pass(3, this.curl, this.velocity.write); g.swap(this.velocity);
    this.pass(4, this.velocity.read, this.divergence);
    // 前フレームの圧力を初期値にする。20反復で射影する。
    for (let i = 0; i < 20; i++) { this.pass(5, this.pressure.read, this.pressure.write); g.swap(this.pressure); }
    this.pass(6, this.pressure.read, this.velocity.write); g.swap(this.velocity);
    this.pass(7, this.dye.read, this.dye.write); g.swap(this.dye);
    this.spectrum.render(this.dye.read, 0, this.gpu.uniforms[1] * 6);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldFluid }; }
