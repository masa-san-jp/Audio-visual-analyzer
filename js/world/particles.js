// 目的 — 流体とカール場で26万粒子を運び、速度方向のHDRストリークを描く — doc/20261004-concept-world-mode.md §2.7
const WORLD_PARTICLE_SIDE = 512;
const WORLD_PARTICLE_UPDATE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_GLSL}
uniform sampler2D particles, particleVelocity, velocity;
uniform float analyzerSpeed;
uniform int ringMode, sparkReset, fluidReset;
uniform float analyzerDt;
uniform vec4 bands[32], sparkEvents[32];
layout(location=0) out vec4 positionOut;
layout(location=1) out vec4 velocityOut;
vec3 spawn(vec3 key){
 float seed=hash31(key),a=hash31(key+4.)*6.283185;
 float depth=1.+hash31(key+3.)*8.;
 // v8の生成密度を戻す。主役は焦点面に置き、zは既存状態の材質属性として保持する。
 int center=int(step(.5,seed));
 float r=.025+sqrt(hash31(key+2.))*.32*OVERSCAN;
 vec2 p=worldCenter(center)+vec2(cos(a+r*12.),sin(a+r*12.))*r;
 if(composition.x==1.||composition.x==2.){
  vec2 wide=vec2((hash31(key+2.)-.5)*worldExtent().x*1.2,(hash31(key+5.)-.5)*worldExtent().y*.7);
  p=mix(p,wide,.6);
 }else if(composition.x==3.){
  p=vec2((hash31(key+2.)-.5)*worldExtent().x,(hash31(key+5.)-.5)*worldExtent().y);
 }else if(composition.x==4.){
  r=.06+sqrt(hash31(key+2.))*.95*OVERSCAN;
  a=floor(seed*3.)*6.283185/3.-r*7.+composition.w+(hash31(key+5.)-.5)*.09;
  p=worldCenter(0)+vec2(cos(a),sin(a))*r;
 }
 p=mod(p+worldExtent()*.5,worldExtent())-worldExtent()*.5;
 return vec3(p*depth/3.,depth);
}
// v8の三段のcurlを周期領域に置く。微細な剪断は残し、大きなうねりを主流にする。
vec2 curlFlow(vec2 p,float t){
 vec2 a=p/worldExtent()*6.283185,c=vec2(0);
 for(int i=0;i<3;i++){
  float f=1.+float(i),phase=sin(t+float(i)*2.1);
  c+=vec2(sin(a.x*f+phase)*cos(a.y*f-phase),-cos(a.x*f+phase)*sin(a.y*f-phase))/(1.+float(i));
 }
 return c*.045;
}
void main(){
 ivec2 id=ivec2(gl_FragCoord.xy);vec4 state=texelFetch(particles,id,0);
 vec3 key=vec3(vec2(id),state.w),p=state.xyz;vec4 previousVelocity=texelFetch(particleVelocity,id,0);vec2 v=previousVelocity.xy;
 if(ringMode==1){
   int particle=id.x+id.y*512,ray=(particle%512)/SPARKS_PER_RAY,volley=particle/512;
   int band=ray<32?ray:63-ray;vec4 event=sparkEvents[band];
   float lastEvent=previousVelocity.z,sparkAlive=previousVelocity.w;
   if(sparkReset==1){p=vec3(0,0,SPARK_LIFE);sparkAlive=0.;lastEvent=-100.;}
   if(event.x>=0.&&int(event.y)%512==volley&&event.x!=lastEvent){
     float angle=(float(ray)+.5)*TAU/RAY_COUNT-PI-event.w;
     vec2 direction=vec2(cos(angle),sin(angle));
     p=vec3(direction*event.z,0.);v=direction*(SPARK_SPEED+bands[band].x*SPARK_LEVEL_SPEED);
     sparkAlive=1.;lastEvent=event.x;
   }else {p.xy+=v*analyzerDt;p.z=max(0.,clock.z-lastEvent);}
   sparkAlive*=float(p.z<SPARK_LIFE);
   positionOut=vec4(p,state.w);velocityOut=vec4(v,lastEvent,sparkAlive);return;
 }
 if(eye.w>.5||fluidReset==1){p=spawn(key);v=worldFlow(p.xy*3./p.z)*(.1+worldKind(2.)*1.1);}
 int band=(id.x+id.y*512)%32;float level=emitters[band].z;
 // 一斉に同じ方向の噴流を作らず、少量を既存の流線へ散らして供給する。
 if(clock.y>0.&&hash31(key+floor(clock.z/max(.0001,clock.y)))<clock.y*level*3.){
  float a=hash31(key+9.)*6.283185,r=sqrt(hash31(key+13.))*(.006+level*.006);
  vec2 point=emitterWorld(band)+vec2(cos(a),sin(a))*r;
  p.xy=point*p.z/3.;v=worldFlow(point)*(.65+worldKind(2.)*.95);
 }
 // v8同様、kickで4%だけ大渦へ補給し、残りの慣性を保持する。
 if(hit.x>.5&&worldKind(2.)>.5&&hash31(key+shot.w)<.04){
  int center=int(step(.5,hash31(key+shot.w+3.)));
  float a=hash31(key+shot.w+7.)*6.283185,r=.01+hash31(key+shot.w+9.)*.06;
  vec2 point=worldCenter(center)+vec2(cos(a),sin(a))*r;
  p.xy=point*p.z/3.;v=worldFlow(point)*1.2;
 }
 vec2 plane=p.xy*3./p.z,uv=worldUv(plane);
 vec2 flow=texture(velocity,fract(uv)).xy/vec2(textureSize(velocity,0))*worldExtent();
 float tempo=.65+worldKind(2.)*.95-worldKind(0.)*.53-worldKind(3.)*.47;
 vec2 desired=worldFlow(plane)*tempo*analyzerSpeed;
 vec2 force=(desired-v)*(2.5+worldKind(2.)*3.5)+flow*.9+curlFlow(plane,worldSlowPhase());
 vec2 d=plane-shot.yz;float r=max(.002,length(d));
 force+=d/r*(worldShock(plane)*5.+hit.w*exp(-r*4.)*2.)*worldKind(2.);
 v+=force*clock.y;v*=exp(-clock.y*(.6-worldKind(2.)*.25));p.xy+=v*clock.y*p.z/3.;
 vec2 extent=worldExtent()*p.z/3.;
 if(abs(p.x)>extent.x*.5||abs(p.y)>extent.y*.5){p=spawn(key+floor(clock.z));v=worldFlow(p.xy*3./p.z)*tempo;}
 positionOut=vec4(p,state.w);velocityOut=vec4(v,0,1);
}`;
const WORLD_PARTICLE_VERTEX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_GLSL.replace('in vec2 vUv;', '')}
uniform sampler2D particles, particleVelocity;
uniform float analyzerAmount;
uniform int ringMode;
uniform vec3 sparkColors[3];
out vec3 color;
out float alpha;
out vec2 streakAxis;
out float streakWidth;
void main(){
 ivec2 id=ivec2(gl_VertexID%512,gl_VertexID/512);vec4 s=texelFetch(particles,id,0);
 vec2 velocity=texelFetch(particleVelocity,id,0).xy;
 if(ringMode==1){
   int ray=(gl_VertexID%512)/SPARKS_PER_RAY,band=ray<32?ray:63-ray;
   vec4 v=texelFetch(particleVelocity,id,0);
   gl_Position=vec4(s.xy/vec2(screen.x/screen.y,1.)*2.,0,1);
   // 火花も既存の速度ストリークの幅・サイズを使う。
   gl_PointSize=clamp(1.5*screen.y/REFERENCE_HEIGHT+length(v.xy)*screen.y*.025,1.5,8.*screen.y/REFERENCE_HEIGHT);
   streakWidth=.45*screen.y/REFERENCE_HEIGHT/gl_PointSize;
   streakAxis=length(v.xy)>.001?normalize(v.xy):vec2(0,1);
   color=bandRamp(float(band)/31.,sparkColors[0],sparkColors[1],sparkColors[2])*SPARK_LIGHT;
   alpha=v.w*float(s.z<SPARK_LIFE);return;
 }
 float seed=hash31(vec3(vec2(id),s.w)),depth=max(1.,s.z),material=(depth-1.)/8.;
 vec2 plane=s.xy*3./depth;
 // 焦点面の流体粒子。深度ぼけ・画面全体の伸張は別の奥行き層へ分離する。
 vec2 view=worldView(plane),uv=worldScreenUv(view);
 vec2 speed=rot(-lens.w)*velocity*lens.z*screen.y*.025;
 streakAxis=length(speed)>.01?normalize(speed):vec2(0,1);
 int band=gl_VertexID%32;float level=emitters[band].z;
 float width=mix(.45,.8,material)*screen.y/1080.*(1.+level*.3);
 float size=clamp(1.5*screen.y/1080.+length(speed),1.5,8.*screen.y/1080.);
 streakWidth=width/size;gl_PointSize=size;gl_Position=vec4(uv*2.-1.,0,1);
 color=seed<.7?worldColor(0.):seed<.97?worldColor(1.):worldColor(2.);
 float sparkle=band>=22?pow(.5+.5*sin(worldSlowPhase()*24.+s.w),8.):0.;
 color*=1.+length(velocity)*5.+level*(1.+sparkle*2.)+audio.y*2.+hit.y*3.;
 float ring=worldShock(plane)*worldKind(2.);
 float strength=1.-worldKind(0.)*.4-worldKind(3.)*.65+worldKind(2.)*.4;
 float sparse=mix(1.,step(seed,.08+clock.w*.04),worldKind(0.));
 alpha=step(seed,analyzerAmount)*mood.x*strength*sparse*(.06+.1*material)*(1.+ring*3.)*environment.w;
}`;
const WORLD_PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
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
// WORLD-10: 遠景4096粒と近景12粒。周期深度と透視投影で、流体をぼかさず前進する。
const WORLD_DEPTH_PARTICLE_COUNT = 4108;
const WORLD_DEPTH_VERTEX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_GLSL.replace('in vec2 vUv;', '')}
out vec2 local;
out vec3 color;
out float alpha;
uniform float particleSeed;
void main(){
 int i=gl_VertexID/6,j=gl_VertexID%6;
 vec2 corner=j==0?vec2(-1,-1):j==1?vec2(1,-1):j==2?vec2(-1,1):j==3?vec2(-1,1):j==4?vec2(1,-1):vec2(1,1);
 vec3 key=vec3(float(i),particleSeed,17.);float seed=hash31(key);
 bool near=i>=4096;
 float range=near?1.6:32.,start=near?1.2:1.;
 float travel=clock.x/6.283185*range;
 float depth=start+mod(hash31(key+3.)*range-travel,range);
 vec2 position=(vec2(hash31(key+7.),hash31(key+11.))-.5)*vec2(screen.x/screen.y,1.)*(near?1.6:12.);
 float expansion=1.+worldDropSpace()*(.32+.12*(environment.y-1.))+audio.x*.08;
 vec2 view=rot(-lens.w)*(position-eye.xy)*3./depth*lens.z*expansion;
 float radius=(near?10.+seed*14.:.45+seed*.8)*3./depth*screen.y/1080.;
 local=corner;vec2 uv=worldScreenUv(view)+corner*radius/screen.xy;
 gl_Position=vec4(uv*2.-1.,0,1);
 float fade=smoothstep(start,start+range*.08,depth)*(1.-smoothstep(start+range*.92,start+range,depth));
 // 遠くほど青く淡く、小さく鋭く。近景だけ大きなぼけ円にする。
 color=mix(worldColor(1.),worldColor(0.),smoothstep(3.,24.,depth));
 alpha=mix(.32,mood.x,environment.w)*fade*exp(-depth*.055)*(near?.035:.6)*(1.+audio.y*.5);
}`;
const WORLD_DEPTH_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 local;in vec3 color;in float alpha;
out vec4 frag;
void main(){float r=dot(local,local);if(r>1.)discard;frag=vec4(color*alpha*exp(-r*5.)*(1.-smoothstep(.6,1.,r)),0);}
`;
class WorldDepthParticles {
 constructor(gpu,seed){this.gpu=gpu;this.count=WORLD_DEPTH_PARTICLE_COUNT;this.program=gpu.program(WORLD_DEPTH_FRAGMENT,WORLD_DEPTH_VERTEX);
  this.seedLoc=gpu.texture(this.program,'particleSeed');this.reset(seed);}
 reset(seed){this.seed=seed;}
 render(target){const g=this.gpu,gl=g.gl;g.bind(this.program,target);gl.uniform1f(this.seedLoc,this.seed);
  gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.drawArrays(gl.TRIANGLES,0,this.count*6);gl.disable(gl.BLEND);}
}
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
    this.updateProgram = gpu.program(WORLD_PARTICLE_UPDATE); this.motionSpeed = 1;
    this.speedLoc = gpu.texture(this.updateProgram, 'analyzerSpeed');
    this.fluidResetLoc = gpu.texture(this.updateProgram, 'fluidReset');
    this.dtLoc = gpu.texture(this.updateProgram, 'analyzerDt');
    this.ringLoc = gpu.texture(this.updateProgram, 'ringMode'); this.sparkResetLoc = gpu.texture(this.updateProgram, 'sparkReset');
    this.sparkBandLoc = gpu.texture(this.updateProgram, 'bands[0]'); this.sparkEventLoc = gpu.texture(this.updateProgram, 'sparkEvents[0]');
    this.stateLoc = gpu.texture(this.updateProgram, 'particles'); this.particleVelocityLoc = gpu.texture(this.updateProgram, 'particleVelocity');
    this.flowLoc = gpu.texture(this.updateProgram, 'velocity');
    this.drawProgram = gpu.program(WORLD_PARTICLE_FRAGMENT, WORLD_PARTICLE_VERTEX);
    this.drawRingLoc = gpu.texture(this.drawProgram, 'ringMode'); this.sparkColorLoc = gpu.texture(this.drawProgram, 'sparkColors[0]');
    this.amount = 1; this.amountLoc = gpu.texture(this.drawProgram, 'analyzerAmount');
    this.drawStateLoc = gpu.texture(this.drawProgram, 'particles'); this.drawVelocityLoc = gpu.texture(this.drawProgram, 'particleVelocity');
    this.reset(seed);
  }
  reset(seed) {
    this.needsReset = true;
    const rng = makeRng(seed), data = this.initial, gl = this.gpu.gl;
    for (let i = 0; i < this.count; i++) {
      data[i * 4] = 0; data[i * 4 + 1] = 0; data[i * 4 + 2] = .5; data[i * 4 + 3] = rng() * 1000;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.state.read.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 512, gl.RGBA, gl.FLOAT, data);
    this.gpu.clearTarget(this.velocity.read); this.gpu.clearTarget(this.velocity.write);
  }
  step(fluid, rings = null, input = null) {
    const g = this.gpu; g.bind(this.updateProgram, this.state.write); g.gl.uniform1f(this.speedLoc, this.motionSpeed);
    g.gl.uniform1f(this.dtLoc, input ? input.dt : g.uniforms[1]);
    g.gl.uniform1i(this.fluidResetLoc, this.needsReset ? 1 : 0);
    g.gl.uniform1i(this.ringLoc, rings ? 1 : 0); g.gl.uniform1i(this.sparkResetLoc, rings && rings.sparkReset ? 1 : 0);
    if (rings) { g.gl.uniform4fv(this.sparkBandLoc, rings.bandUniforms); g.gl.uniform4fv(this.sparkEventLoc, rings.sparkEvents); }
    g.sampler(this.stateLoc, 0, this.state.read); g.sampler(this.particleVelocityLoc, 1, this.velocity.read);
    g.sampler(this.flowLoc, 2, fluid.velocity.read); g.draw(); g.swap(this.state); g.swap(this.velocity); this.needsReset = false;
  }
  render(target, rings = null) {
    const g = this.gpu, gl = g.gl; g.bind(this.drawProgram, target); gl.uniform1f(this.amountLoc, this.amount);
    gl.uniform1i(this.drawRingLoc, rings ? 1 : 0); if (rings) gl.uniform3fv(this.sparkColorLoc, rings.colors);
    g.sampler(this.drawStateLoc, 0, this.state.read); g.sampler(this.drawVelocityLoc, 1, this.velocity.read);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.POINTS, 0, this.count); gl.disable(gl.BLEND);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldParticles, WorldDepthParticles, WORLD_PARTICLE_SIDE, WORLD_DEPTH_PARTICLE_COUNT }; }
