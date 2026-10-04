// 目的 — 変形フィードバック・多段HDRブルーム・ACESの光学仕上げ — doc/20261004-concept-world-mode.md §2.7・§5
const WORLD_BLOOM_FRAGMENT = `#version 300 es
${WORLD_GLSL}
uniform sampler2D source;
uniform vec2 axis;
uniform float threshold;
out vec4 frag;
void main(){vec2 d=axis/vec2(textureSize(source,0));
 vec3 c=texture(source,vUv).rgb*.227027;
 c+=(texture(source,vUv+d*1.384615).rgb+texture(source,vUv-d*1.384615).rgb)*.316216;
 c+=(texture(source,vUv+d*3.230769).rgb+texture(source,vUv-d*3.230769).rgb)*.070270;
 frag=vec4(max(vec3(0),c-vec3(threshold)),1);}`;
// 輝度はGPU内で4×4ずつ縮約し、1×1の平均対数輝度と最大輝度を得る。
const WORLD_EXPOSURE_FRAGMENT = `#version 300 es
${WORLD_GLSL}
uniform sampler2D source;
uniform int firstPass;
out vec4 frag;
void main(){ivec2 size=textureSize(source,0),base=ivec2(gl_FragCoord.xy)*4;
 float sum=0.,count=0.,peak=0.;
 for(int y=0;y<4;y++)for(int x=0;x<4;x++){
  ivec2 p=base+ivec2(x,y);if(any(greaterThanEqual(p,size)))continue;
  vec4 value=texelFetch(source,p,0);
  if(firstPass==1){float lum=dot(value.rgb,vec3(.2126,.7152,.0722));sum+=log(max(.0001,lum));count+=1.;peak=max(peak,lum);}
  else{sum+=value.x;count+=value.y;peak=max(peak,value.z);}
 }
 frag=vec4(sum,count,peak,1.);
}`;
const WORLD_FEEDBACK_FRAGMENT = `#version 300 es
${WORLD_GLSL}
uniform sampler2D source, history, flow;
out vec4 frag;
void main(){
 if(screen.w>.5||mood.x<=0.){frag=vec4(0);return;}
 vec2 q=(vUv-.5)*vec2(screen.x/screen.y,1.);
 float dt=clock.y,angle=(story.x==1.?.12:story.x==2.?-.2:story.x==3.?.025:.05)*dt;
 q=rot(angle)*q;
 q*=exp(-(story.x==1.?.38+clock.w*.7:story.x==2.?.22:-.03)*dt);
 if(story.x==2.){
  float a=atan(q.y,q.x),n=story.y>1.5?8.:5.;
  float folded=abs(mod(a+3.141593/n,6.283185/n)-3.141593/n);
  // 境界の万華鏡を余韻の変形へ滑らかに戻す。
  q=mix(q,vec2(cos(folded),sin(folded))*length(q),hit.w*.8);
 }
 vec2 uv=q/vec2(screen.x/screen.y,1.)+.5;
 uv+=texture(flow,worldUv(worldPosition(vUv))).xy*dt*.0002;
 uv+=vec2(sin(q.y*3.+sin(worldSlowPhase())),cos(q.x*3.-cos(worldSlowPhase())))*dt*.006;
 // 画面外へ出た残像は硬く切らず、端で滑らかに消す（縦の境目を出さない）
 float valid=smoothstep(0.,.06,uv.x)*smoothstep(1.,.94,uv.x)*smoothstep(0.,.06,uv.y)*smoothstep(1.,.94,uv.y);
 float decay=exp(-dt*(story.x==2.?7.:story.x==4.?12.:3.));
 frag=vec4(min(vec3(64),texture(source,vUv).rgb*.24*min(1.,dt*60.)+texture(history,uv).rgb*decay*valid),1);
}`;
const WORLD_POST_FRAGMENT = `#version 300 es
${WORLD_GLSL}
uniform sampler2D scene, history, bloom0, bloom1, bloom2, bloom3, exposure;
out vec4 frag;
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
void main(){
 if(screen.w>.5||mood.x<=0.){frag=vec4(0,0,0,1);return;}
 vec2 uv=vUv,ca=(uv-.5)/screen.xy*1.2;
 // 残像はドロップでは重ねない（万華鏡の折り返しで硬い境目とにじみが出るため）。他の場面は控えめに
 float hw=.3*(1.-worldKind(2.))*environment.w;
 vec3 c=texture(scene,uv).rgb+texture(history,uv).rgb*hw;
 c.r=mix(c.r,texture(scene,uv+ca).r+texture(history,uv+ca).r*hw,.18);
 c.b=mix(c.b,texture(scene,uv-ca).b+texture(history,uv-ca).b*hw,.18);
 vec3 bloom=texture(bloom0,uv).rgb*.3+texture(bloom1,uv).rgb*.22+texture(bloom2,uv).rgb*.14+texture(bloom3,uv).rgb*.08;
 c+=bloom*environment.w*(.35+worldDropFlare()*.12);
 vec4 meter=texelFetch(exposure,ivec2(0),0);float average=exp(meter.x/max(1.,meter.y));
 float target=.08*min(1.5,mood.x)*(story.x==2.?1.+min(2.,story.y-1.)*.25:1.);
 // 静かな細い霧を黒へ潰さない。introだけ低いHDR入力を持ち上げ、他kindの露出は維持。
 float gain=clamp(target/max(.0001,average),.035,2.+22.*worldKind(0.));
 gain=mix(1.8,gain,environment.w);
 float vignette=1.-smoothstep(.35,1.1,length((uv-.5)*vec2(screen.x/screen.y,1.)))*(.18+story.w*.72);
 c=aces(c*gain*vignette*(1.+hit.w*.18));
 c=pow(c,vec3(1.13));float lum=dot(c,vec3(.2126,.7152,.0722));c=max(vec3(0),mix(vec3(lum),c,1.06));
 float peak=max(c.r,max(c.g,c.b));if(peak>.7)c*=(.7+.255*(1.-exp(-(peak-.7)/.255)))/peak;
 c=mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));
 frag=vec4(clamp(c,0.,1.),1.);
}`;
class WorldPost {
  constructor(gpu, w, h) {
    this.gpu = gpu; this.bloomProgram = gpu.program(WORLD_BLOOM_FRAGMENT);
    this.sourceLoc = gpu.texture(this.bloomProgram, 'source'); this.axisLoc = gpu.texture(this.bloomProgram, 'axis');
    this.thresholdLoc = gpu.texture(this.bloomProgram, 'threshold');
    this.exposureProgram = gpu.program(WORLD_EXPOSURE_FRAGMENT);
    this.meterSourceLoc = gpu.texture(this.exposureProgram, 'source'); this.firstLoc = gpu.texture(this.exposureProgram, 'firstPass');
    this.program = gpu.program(WORLD_POST_FRAGMENT);
    this.samplers = ['scene', 'history', 'bloom0', 'bloom1', 'bloom2', 'bloom3', 'exposure'].map(n => gpu.texture(this.program, n));
    this.feedbackProgram = gpu.program(WORLD_FEEDBACK_FRAGMENT);
    this.feedbackSamplers = ['source', 'history', 'flow'].map(n => gpu.texture(this.feedbackProgram, n));
    this.resize(w, h);
  }
  resize(w, h) {
    const g = this.gpu;
    if (this.output) {
      g.releaseTarget(this.output); g.releaseTarget(this.feedback.read); g.releaseTarget(this.feedback.write);
      for (let i = 0; i < this.meter.length; i++) g.releaseTarget(this.meter[i]);
      for (let i = 0; i < this.bloom.length; i++) { g.releaseTarget(this.bloom[i].read); g.releaseTarget(this.bloom[i].write); }
    }
    this.output = g.target(w, h, false, true); this.feedback = g.pair(Math.ceil(w / 2), Math.ceil(h / 2)); this.bloom = []; this.meter = [];
    let mw = this.feedback.read.width, mh = this.feedback.read.height;
    do { mw = Math.ceil(mw / 4); mh = Math.ceil(mh / 4); this.meter.push(g.target(mw, mh, true)); } while (mw > 1 || mh > 1);
    for (let i = 0; i < 4; i++) this.bloom.push(g.pair(Math.max(1, Math.ceil(w / (2 ** (i + 1)))), Math.max(1, Math.ceil(h / (2 ** (i + 1))))));
  }
  reset() {
    this.gpu.clearTarget(this.feedback.read); this.gpu.clearTarget(this.feedback.write);
  }
  stepFeedback(scene, fluid) {
    const g = this.gpu;
    g.bind(this.feedbackProgram, this.feedback.write);
    g.sampler(this.feedbackSamplers[0], 0, scene); g.sampler(this.feedbackSamplers[1], 1, this.feedback.read);
    g.sampler(this.feedbackSamplers[2], 2, fluid.velocity.read); g.draw(); g.swap(this.feedback);
  }
  render(scene) {
    const g = this.gpu, gl = g.gl;
    let source = this.feedback.read;
    for (let i = 0; i < 4; i++) {
      const b = this.bloom[i]; g.bind(this.bloomProgram, b.write); g.sampler(this.sourceLoc, 0, source);
      gl.uniform2f(this.axisLoc, 1, 0); gl.uniform1f(this.thresholdLoc, i === 0 ? .65 : 0); g.draw(); g.swap(b);
      g.bind(this.bloomProgram, b.write); g.sampler(this.sourceLoc, 0, b.read);
      gl.uniform2f(this.axisLoc, 0, 1); gl.uniform1f(this.thresholdLoc, 0); g.draw(); g.swap(b); source = b.read;
    }
    source = this.feedback.read;
    for (let i = 0; i < this.meter.length; i++) {
      g.bind(this.exposureProgram, this.meter[i]); g.sampler(this.meterSourceLoc, 0, source);
      gl.uniform1i(this.firstLoc, i === 0 ? 1 : 0); g.draw(); source = this.meter[i];
    }
    g.bind(this.program, this.output);
    g.sampler(this.samplers[0], 0, scene); g.sampler(this.samplers[1], 1, this.feedback.read);
    for (let i = 0; i < 4; i++) g.sampler(this.samplers[i + 2], i + 2, this.bloom[i].read);
    g.sampler(this.samplers[6], 6, source); g.draw();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.output.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, this.output.width, this.output.height, 0, 0, gl.canvas.width, gl.canvas.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldPost }; }
