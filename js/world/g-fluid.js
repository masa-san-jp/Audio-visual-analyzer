// 目的 — 既存流体・粒子を独立したGPUタイプへ接続する — 構想 §2.8(1〜2)
const WORLD_COMPOSITE_FRAGMENT = `#version 300 es
${WORLD_GLSL}
uniform sampler2D dye, velocity;
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
 frag=vec4(mist*quiet+(ink*.65+edge*.8)*mood.x*environment.w,1);

}`;
class WorldFluidAnalyzer {
  constructor() { this.id = 'g-fluid'; this.label = 'スペクトル流体'; }
  init(gpu) { this.gpu = gpu; this.program = gpu.program(WORLD_COMPOSITE_FRAGMENT);
    this.dyeLoc = gpu.texture(this.program, 'dye'); this.velocityLoc = gpu.texture(this.program, 'velocity'); }
  step(input) {
    const engine = input.engine;
    engine.fluid.motionSpeed = input.song.motionSpeed; engine.fluid.detail = input.song.detail;
    engine.fluid.spectrum.detail = input.song.detail; engine.particles.motionSpeed = input.song.motionSpeed;
    if (input.dt > 0) engine.fluid.step();
    if (input.dt > 0 || engine.frame === 1 || input.boundaryNow) engine.particles.step(engine.fluid);
  }
  render(input) {
    input.engine._renderFluid(input.target);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldFluidAnalyzer }; }
