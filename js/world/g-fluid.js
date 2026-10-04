// 目的 — 既存流体・粒子を独立したGPUタイプへ接続する — doc/20261004-design-gpu-analyzers-v1.md §4
const WORLD_COMPOSITE_FRAGMENT = `#version 300 es
${WORLD_GLSL}
uniform sampler2D dye, velocity;
uniform vec4 pulse;
uniform float mids;
out vec4 frag;
void main(){
 vec2 p=worldPosition(vUv),uv=worldUv(p);
 vec2 flow=texture(velocity,uv).xy;
 vec3 ink=texture(dye,uv+flow*(.00004/OVERSCAN)).rgb;
 vec2 dx=1./vec2(textureSize(dye,0));
 vec3 edge=abs(texture(dye,uv+dx).rgb-texture(dye,uv-dx).rgb);
 vec3 mist=vec3(0);
 // 星雲は遠景だけに置き、dropの焦点面を霞で覆わない。
 float quiet=worldKind(0.)+worldKind(3.)*.2;
 if(quiet>.001){
  for(int i=0;i<2;i++){
   float depth=3.+float(i)*5.;
   vec2 q=worldPosition(vUv)+eye.xy/depth;
   q*=1.+float(i)*.45;
   float cloud=worldNebula(q,depth);
   // 最近の雲だけに細部を加える。全画面のぼかし・同心円・波紋は使わない。
   mist+=worldColor(float(i%2))*cloud*exp(-depth*.12);
  }
 }
 // 直近の流体はv8の合成係数へ戻し、領域の矩形フェードを重ねない。
 frag=vec4((mist*quiet+(ink*.65+edge*.8)*mood.x*environment.w)*(1.+pulse.x*FLUID_BEAT_EXPOSURE),1);

}`;
const WORLD_FLUID_ARC_RADIUS = .32;
const WORLD_FLUID_ARC_DEGREES = 220;
const WORLD_FLUID_DRIFT_MAX = .02;
const WORLD_FLUID_JITTER = .006;
function worldEmitterHash(i, frame, salt) {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(frame + 1, 668265263) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
class WorldFluidAnalyzer extends WorldBandAnalyzer {
  constructor() { super(); this.id = 'g-fluid'; this.label = 'スペクトル流体'; this.flow = new Float64Array(2); this.reset(); }
  reset() { super.reset(); this.driftX = 0; this.driftY = 0; this.particleReset = true; }
  init(gpu) { super.init(gpu); this.program = gpu.program(WORLD_COMPOSITE_FRAGMENT); this.initUniforms(this.program);
    this.dyeLoc = gpu.texture(this.program, 'dye'); this.velocityLoc = gpu.texture(this.program, 'velocity'); }
  step(input) {
    this.update(input);
    const engine = input.engine;
    // CPUで同じ大域worldFlowを評価し、円弧全体を最大0.02世界単位/秒で移流する。
    engine._globalFlow(this.driftX, this.driftY, this.flow);
    const speed = Math.hypot(this.flow[0], this.flow[1]), scale = speed > WORLD_FLUID_DRIFT_MAX ? WORLD_FLUID_DRIFT_MAX / speed : 1;
    this.driftX += this.flow[0] * scale * input.dt; this.driftY += this.flow[1] * scale * input.dt;
    engine._emitters(input.features, this); engine.gpu.upload();
    engine.fluid.bands.set(this.bandUniforms); engine.fluid.pulse.set(this.pulseUniforms); engine.fluid.mids = this.mids;
    engine.fluid.motionSpeed = input.song.motionSpeed; engine.fluid.detail = input.song.detail;
    engine.fluid.spectrum.detail = input.song.detail; engine.particles.motionSpeed = input.song.motionSpeed;
    if (input.dt > 0) engine.fluid.step();
    if (this.particleReset) engine.particles.needsReset = true;
    if (input.dt > 0 || engine.frame === 1 || input.boundaryNow || this.particleReset) engine.particles.step(engine.fluid);
    this.particleReset = false;
  }
  render(input) {
    const g = this.gpu;
    g.bind(this.program, input.target); this.upload(input);
    input.engine._renderFluid(input.target);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldFluidAnalyzer, worldEmitterHash }; }
