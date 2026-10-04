// 目的 — 32楕円軌道の発光粒子を帯域ごとに増光・加速・揺動する — 構想 §2.8(2)
const WORLD_GALAXY_VERTEX = `#version 300 es
${WORLD_ANALYZER_GLSL}
uniform int particlesPerOrbit;
out vec2 local;
out vec3 tint;
out float intensity;
void main(){
 int particle=gl_VertexID/6,j=gl_VertexID%6,band=particle/particlesPerOrbit,k=particle%particlesPerOrbit;
 vec2 corner=j==0?vec2(-1,-1):j==1?vec2(1,-1):j==2?vec2(-1,1):j==3?vec2(-1,1):j==4?vec2(1,-1):vec2(1,1);
 vec4 b=bands[band];float phase=float(k)/float(particlesPerOrbit)*TAU+b.z;
 float r=.07+float(band)*.012;
 // 軌道間隔より小さい半径揺動で、各帯域の対応領域を維持する。
 r+=sin(phase*3.+b.z)*b.x*.0024;
 vec2 p=vec2(cos(phase),sin(phase)*.60)*r;
 vec2 tangent=normalize(vec2(-sin(phase),cos(phase)*.60));
 float width=(.00045+.00035*song.y)*(1.+b.w*.3);
 float length=width*(1.6+b.x*3.);
 vec2 offset=tangent*corner.x*length+vec2(-tangent.y,tangent.x)*corner.y*width;
 float tilt=.22;mat2 turn=mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt));
 p=turn*(p+offset);
 gl_Position=vec4(p/vec2(resolution.x/resolution.y,1.)*2.,0,1);
 local=corner;tint=bandColor(band);
 intensity=(b.x*4.+b.y*.18)*(1.+b.w*.4)*(.45+.55*song.w);
}`;
const WORLD_GALAXY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 local;in vec3 tint;in float intensity;
out vec4 frag;
void main(){float radius=dot(local,local);if(radius>1.)discard;
 frag=vec4(tint*intensity*exp(-radius*4.),0.);
}`;
class WorldGalaxyAnalyzer extends WorldBandAnalyzer {
  constructor() { super(); this.id = 'g-galaxy'; this.label = '周波数の銀河'; this.orbitCount = 32; this.particleCount = 0; }
  init(gpu) { super.init(gpu); this.program = gpu.program(WORLD_GALAXY_FRAGMENT, WORLD_GALAXY_VERTEX);
    this.initUniforms(this.program); this.countLoc = gpu.texture(this.program, 'particlesPerOrbit'); }
  render(input) {
    const g = this.gpu, gl = g.gl;
    const count = Math.round(512 + input.song.particleAmount * 1536); this.particleCount = count * 32;
    g.clearTarget(input.target); g.bind(this.program, input.target); this.upload(input); gl.uniform1i(this.countLoc, count);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLES, 0, this.particleCount * 6); gl.disable(gl.BLEND);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldGalaxyAnalyzer }; }
