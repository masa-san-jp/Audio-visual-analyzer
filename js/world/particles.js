// 目的 — 流体とカール場で26万粒子を運び、速度方向のHDRストリークを描く — doc/20261004-concept-world-mode.md §2.7
const WORLD_PARTICLE_SIDE = 512;
const WORLD_PARTICLE_UPDATE = `#version 300 es
${WORLD_GLSL}
uniform sampler2D particles, particleVelocity, velocity;
layout(location=0) out vec4 positionOut;
layout(location=1) out vec4 velocityOut;
vec3 spawn(vec3 key){
 float seed=hash31(key),a=hash31(key+4.)*6.283185;
 float depth=1.+hash31(key+3.)*8.;
 int band=int(mod(key.x+key.y*512.,32.));
 vec2 emitter=emitterWorld(band);
 vec2 nebula=vec2(cos(a),sin(a))*(.06+sqrt(seed)*worldExtent().x*.44);
 // 静かな星雲から、帯域に応じた細い噴流へ連続に供給する。
 vec2 p=mix(nebula,emitter+vec2(cos(a),sin(a))*.009,emitters[band].z*environment.w);
 return vec3(p*depth/3.,depth);
}
vec2 curlFlow(vec2 p,float t){
 vec2 a=p/worldExtent()*6.283185;
 return vec2(sin(a.x+sin(t))*cos(a.y-cos(t)),
 -cos(a.x+sin(t))*sin(a.y-cos(t)))*.045;
}
void main(){
 ivec2 id=ivec2(gl_FragCoord.xy);vec4 state=texelFetch(particles,id,0);
 vec3 key=vec3(vec2(id),state.w),p=state.xyz;vec2 v=texelFetch(particleVelocity,id,0).xy;
 if(eye.w>.5){p=spawn(key);v=vec2(0);}
 int band=(id.x+id.y*512)%32;
 float level=emitters[band].z;
 // 毎秒の少量補給。曲の時刻とseedで決定し、拍で構図を変更しない。
 if(clock.y>0.&&hash31(key+vec3(floor(clock.z/max(.0001,clock.y))))<clock.y*level*.8){
  p.xy=(emitterWorld(band)+vec2(cos(state.w),sin(state.w))*.006)*p.z/3.;
 }
 vec2 plane=p.xy*3./p.z,uv=worldUv(plane);
 vec2 flow=texture(velocity,fract(uv)).xy/vec2(textureSize(velocity,0))*worldExtent();
 float tempo=.65+worldKind(2.)*.95-worldKind(0.)*.53-worldKind(3.)*.47;
 vec2 desired=worldFlow(plane)*tempo;
 vec2 force=(desired-v)*(2.5+worldKind(2.)*3.5)+flow*.9+curlFlow(plane,worldSlowPhase());
 vec2 d=plane-shot.yz;float r=max(.002,length(d));
 force+=d/r*(worldShock(plane)*5.+hit.w*exp(-r*4.)*2.)*worldKind(2.);
 v+=force*clock.y;v*=exp(-clock.y*.5);p.xy+=v*clock.y*p.z/3.;
 // カメラの前進。dropでは奥へ散り、空間が広がる。近端／遠端はfadeでつなぐ。
 p.z-=clock.y*.18;p.z+=clock.y*worldDropSpace()*worldDropFlare()*8.*(.3+hash31(key+7.));
 if(p.z<1.||p.z>9.){p=spawn(key+floor(clock.z));p.z=8.99;v=vec2(0);}
 vec2 extent=worldExtent()*p.z/3.;p.xy=mod(p.xy+extent*.5,extent)-extent*.5;
 positionOut=vec4(p,state.w);velocityOut=vec4(v,0,1);
}`;
const WORLD_PARTICLE_VERTEX = `#version 300 es
${WORLD_GLSL.replace('in vec2 vUv;', '')}
uniform sampler2D particles, particleVelocity;
out vec3 color;
out float alpha;
out vec2 streakAxis;
out float streakWidth;
void main(){
 ivec2 id=ivec2(gl_VertexID%512,gl_VertexID/512);vec4 s=texelFetch(particles,id,0);
 vec2 velocity=texelFetch(particleVelocity,id,0).xy;
 float seed=hash31(vec3(vec2(id),s.w)),depth=max(1.,s.z);
 float expansion=1.+worldDropSpace()*(.32+.12*(environment.y-1.))+audio.x*.08;
 vec2 plane=s.xy*3./depth*expansion;
 // 本当のzによる透視投影と視差。近い粒子ほど大きく速く見える。
 vec2 view=rot(-lens.w)*(plane-lens.xy*3./depth)*lens.z;
 vec2 uv=worldScreenUv(view),speed=rot(-lens.w)*velocity*lens.z*screen.y*.025*3./depth;
 streakAxis=length(speed)>.01?normalize(speed):vec2(0,1);
 float coc=max(0.,3.-depth)*.8;
 float width=(.5*3./depth+coc)*screen.y/1080.;
 float size=clamp(1.5*3./depth+length(speed)+coc*2.,1.5,12.)*screen.y/1080.;
 streakWidth=min(.7,width/size);gl_PointSize=size;gl_Position=vec4(uv*2.-1.,0,1);
 int band=gl_VertexID%32;float level=emitters[band].z;
 color=worldColor(band<6?1.:band<22?0.:2.);
 float sparkle=band>=22?pow(.5+.5*sin(clock.x*24.+s.w),8.):0.;
 color*=1.+length(velocity)*5.+level*(4.+sparkle*3.)+audio.y*2.+hit.y*3.;
 float ring=worldShock(plane)*worldKind(2.);
 float strength=1.-worldKind(0.)*.4-worldKind(3.)*.65+worldKind(2.)*.4;
 float sparse=mix(1.,step(seed,.1),worldKind(0.));
 float fade=smoothstep(1.,1.4,depth)*(1.-smoothstep(8.4,9.,depth));
 alpha=mood.x*strength*sparse*(.06+.1*3./depth)*(1.+ring*3.)*fade*environment.w*exp(-depth*.06)/(1.+coc);
}`;
const WORLD_PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
in vec3 color;
in float alpha;
in vec2 streakAxis;
in float streakWidth;
out vec4 frag;
void main(){
 if(alpha<=0.)discard;vec2 p=gl_PointCoord*2.-1.;p.y=-p.y;
 float along=dot(p,streakAxis),across=dot(p,vec2(-streakAxis.y,streakAxis.x));
 float taper=max(0.,1.-along*along),width=streakWidth*sqrt(taper);
 if(abs(along)>.95||abs(across)>width*2.)discard;
 float glow=exp(-pow(across/max(.001,width),2.)*3.)*taper;
 frag=vec4(color*glow*alpha,0);
}`;
class WorldParticles {
  constructor(gpu, seed) {
    this.gpu = gpu; this.state = gpu.pair(WORLD_PARTICLE_SIDE, WORLD_PARTICLE_SIDE, true);
    this.velocity = gpu.pair(WORLD_PARTICLE_SIDE, WORLD_PARTICLE_SIDE, true);
    this.count = WORLD_PARTICLE_SIDE * WORLD_PARTICLE_SIDE;
    this.initial = new Float32Array(this.count * 4); this.seed = seed;
    this.attachments = new Uint32Array([gpu.gl.COLOR_ATTACHMENT0, gpu.gl.COLOR_ATTACHMENT1]);
    const gl = gpu.gl;
    for (const side of ['read', 'write']) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.state[side].fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.velocity[side].texture, 0);
      gl.drawBuffers(this.attachments);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Particle MRT unavailable');
    }
    this.updateProgram = gpu.program(WORLD_PARTICLE_UPDATE);
    this.stateLoc = gpu.texture(this.updateProgram, 'particles'); this.particleVelocityLoc = gpu.texture(this.updateProgram, 'particleVelocity');
    this.flowLoc = gpu.texture(this.updateProgram, 'velocity');
    this.drawProgram = gpu.program(WORLD_PARTICLE_FRAGMENT, WORLD_PARTICLE_VERTEX);
    this.drawStateLoc = gpu.texture(this.drawProgram, 'particles'); this.drawVelocityLoc = gpu.texture(this.drawProgram, 'particleVelocity');
    this.reset(seed);
  }
  reset(seed) {
    const rng = makeRng(seed), data = this.initial, gl = this.gpu.gl;
    for (let i = 0; i < this.count; i++) {
      data[i * 4] = 0; data[i * 4 + 1] = 0; data[i * 4 + 2] = .5; data[i * 4 + 3] = rng() * 1000;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.state.read.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 512, gl.RGBA, gl.FLOAT, data);
    this.gpu.clearTarget(this.velocity.read); this.gpu.clearTarget(this.velocity.write);
  }
  step(fluid) {
    const g = this.gpu; g.bind(this.updateProgram, this.state.write);
    g.sampler(this.stateLoc, 0, this.state.read); g.sampler(this.particleVelocityLoc, 1, this.velocity.read);
    g.sampler(this.flowLoc, 2, fluid.velocity.read); g.draw(); g.swap(this.state); g.swap(this.velocity);
  }
  render(target) {
    const g = this.gpu, gl = g.gl; g.bind(this.drawProgram, target);
    g.sampler(this.drawStateLoc, 0, this.state.read); g.sampler(this.drawVelocityLoc, 1, this.velocity.read);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.POINTS, 0, this.count); gl.disable(gl.BLEND);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldParticles, WORLD_PARTICLE_SIDE }; }
