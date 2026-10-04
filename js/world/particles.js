// 目的 — 流体とカール場で26万粒子を運び、速度方向のHDRストリークを描く — doc/20261004-concept-world-mode.md §2.6
const WORLD_PARTICLE_SIDE = 512;
const WORLD_PARTICLE_UPDATE = `#version 300 es
${WORLD_GLSL}
uniform sampler2D particles, particleVelocity, velocity;
layout(location=0) out vec4 positionOut;
layout(location=1) out vec4 velocityOut;
vec3 spawn(vec3 key){
 float seed=hash31(key),lane=floor(seed*6.),r=.08+sqrt(hash31(key+2.))*.43;
 float a=lane*6.283185/6.+r*12.+camera.x+story.z*.31;
 a+=(hash31(key+4.)-.5)*.12;
 if(story.x==2.){
  a=hash31(key+5.)*6.283185;
  r=.14+hash31(key+2.)*(story.y>1.5?.42:.28);
  if(story.y>1.5)r*=1.+.25*cos(a*3.+camera.x);
 }
 if(story.x==3.)r*=1.15;
 return vec3(vec2(cos(a),sin(a))*r,.3+hash31(key+3.)*.7);
}
// 三つの滑らかな流れ関数の解析的curl。発散のない揺らぎを加える。
vec2 curlFlow(vec2 p,float t){
 vec2 c=vec2(0);
 for(int i=0;i<3;i++){
  float f=3.+float(i)*4.,phase=t*(.13+float(i)*.07)+float(i)*2.1;
  c+=vec2(sin(p.x*f+phase)*cos(p.y*f-phase),-cos(p.x*f+phase)*sin(p.y*f-phase))/(1.+float(i));
 }
 return c*.045;
}
void main(){
 ivec2 id=ivec2(gl_FragCoord.xy);vec4 state=texelFetch(particles,id,0);
 vec3 key=vec3(vec2(id),state.w),p=state.xyz;vec2 v=texelFetch(particleVelocity,id,0).xy;
 if(eye.w>.5){p=spawn(key);v=vec2(0);if(story.x==2.)v=normalize(p.xy)*(.4+story.y*.2);}
 float radius=max(.001,length(p.xy));vec2 radial=p.xy/radius,tangent=vec2(-radial.y,radial.x);
 vec2 uv=p.xy/vec2(screen.x/screen.y,1.)+.5;
 vec2 flow=texture(velocity,clamp(uv,0.,1.)).xy/vec2(textureSize(velocity,0))*vec2(screen.x/screen.y,1.);
 vec2 force=tangent*(.12+audio.x*.22)-radial*(radius-.32)*.32;
 if(story.x==1.)force=tangent*(.18+clock.w*.42)-p.xy*(.4+mood.y*.45);
 if(story.x==2.){
  float age=worldShockAge();
  float shell=exp(-pow((radius-(.12+age*1.1))/.035,2.))*worldShockFade(age);
  force=tangent*(story.y>1.5?.9:.4)-radial*(radius-.42)*.3+radial*(shell*2.+hit.w*2.);
 }
 if(story.x==3.)force=vec2(-p.y,p.x)*.035;
 if(story.x==4.)force=radial*.16;
 force+=flow*.9+curlFlow(p.xy,clock.x)*(story.x==3.?.4:1.);
 v+=force*clock.y;v*=exp(-clock.y*(story.x==2.?1.8:2.5));p.xy+=v*clock.y;
 // 外へ消えた粒子は同じ曲／種の流線へ戻す。outroは再供給しない。
 if(story.x!=4.&&(abs(p.x)>screen.x/screen.y*.52||abs(p.y)>.53)){
  p=spawn(key+floor(clock.x*.1));v=vec2(0);
 }
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
 float seed=hash31(vec3(vec2(id),s.w));
 vec2 uv=s.xy/vec2(screen.x/screen.y,1.)+.5;
 vec2 speed=velocity*screen.y*.025;
 streakAxis=length(speed)>.01?normalize(speed):vec2(0,1);
 float width=mix(.45,.8,s.z)*screen.y/1080.;
 float size=clamp(1.5*screen.y/1080.+length(speed),1.5,8.*screen.y/1080.);
 streakWidth=width/size;gl_PointSize=size;gl_Position=vec4(uv*2.-1.,0,1);
 color=seed<.7?worldColor(0.):seed<.97?worldColor(1.):worldColor(2.);
 color*=1.+length(velocity)*5.+audio.y*2.+hit.y*3.;
 float age=worldShockAge(),r=length(s.xy);
 float ring=exp(-pow((r-(.12+age*1.1))/.04,2.))*worldShockFade(age);
 float strength=story.x==0.?.15:story.x==3.?.35:story.x==2.?1.4:1.;
 float sparse=story.x==0.?step(seed,.04+clock.w*.08):1.;
 // 1粒ずつが光の筋として見える明るさにする（v6 は暗すぎて霞にしか見えなかった）
 alpha=mood.x*strength*sparse*(.06+.10*s.z)*(1.+ring*3.);
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
