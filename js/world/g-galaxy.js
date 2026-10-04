// 目的 — 傾斜62度の渦腕・暗黒帯・32×1024粒子・核と楕円衝撃環を描く — doc/20261004-design-gpu-analyzers-v1.md §3
const WORLD_GALAXY_ORBITS = 32;
const WORLD_GALAXY_PARTICLES_PER_ORBIT = 1024;
const WORLD_GALAXY_BACKGROUND = `#version 300 es
${WORLD_ANALYZER_GLSL}
in vec2 vUv;
out vec4 frag;
void main(){
 vec2 p=(vUv-.5)*vec2(resolution.x/resolution.y,1.);
 float r=length(p),a=atan(p.y,p.x)+PI;
 vec3 col=analyzerBackground(p,a,r,t,colors[1]);
 float tilt=cos(radians(GALAXY_TILT_DEGREES)),scale=1.+pulse.x*GALAXY_BEAT_SCALE;
 vec2 disk=vec2(p.x,p.y/tilt)/scale;
 float diskR=length(disk);
 float bulge=exp(-diskR/BULGE_RADIUS)*(BULGE_BASE+pulse.z*BULGE_BASS+pulse.x*BULGE_BEAT);
 col+=mix(colors[2],vec3(1.),BULGE_WHITE_MIX)*bulge;
 col+=analyzerBeatRings(diskR,coronaRadius(pulse),beats,song.x,colors[2]);
 frag=vec4(col,1.);
}`;
const WORLD_GALAXY_VERTEX = `#version 300 es
${WORLD_ANALYZER_GLSL}
uniform int particlesPerOrbit;
out vec2 local;
out vec3 tint;
out float intensity;
void main(){
 int particle=gl_VertexID/6,j=gl_VertexID%6,band=particle/particlesPerOrbit,k=particle%particlesPerOrbit;
 vec2 corner=j==0?vec2(-1,-1):j==1?vec2(1,-1):j==2?vec2(-1,1):j==3?vec2(-1,1):j==4?vec2(1,-1):vec2(1,1);
 vec4 b=bands[band];float x=float(band)/31.;
 float ri=ORBIT_INNER+ORBIT_SPAN*pow(x,ORBIT_POWER);
 float theta=TAU*float(k)/float(particlesPerOrbit)+b.z+gpuHash(vec3(float(band),float(k),0.))*GALAXY_ANGLE_JITTER;
 float arm=ARM_BASE+ARM_MODULATION*cos(ARM_COUNT*(theta-log(ri)*ARM_TWIST-t*ARM_SPEED));
 float rr=ri*(1.+ORBIT_WOBBLE*b.x*sin(ORBIT_WAVES*theta+t*ORBIT_WOBBLE_SPEED))+(gpuHash(vec3(float(band),float(k),1.))-.5)*ORBIT_JITTER;
 vec2 disk=gpuRot(t*GALAXY_SPIN*song.x)*vec2(cos(theta),sin(theta))*rr;
 float tilt=cos(radians(GALAXY_TILT_DEGREES));
 vec2 p=vec2(disk.x,disk.y*tilt)*(1.+pulse.x*GALAXY_BEAT_SCALE);
 float size=(GALAXY_SIZE+b.x*GALAXY_LEVEL_SIZE+pulse.x*GALAXY_BEAT_SIZE)*resolution.y/REFERENCE_HEIGHT;
 // sizeは点の直径。既存のquadで、ハードウェアのpoint-size制限を避ける。
 gl_Position=vec4(p/vec2(resolution.x/resolution.y,1.)*2.+corner*size/resolution,0,1);
 local=corner;tint=bandRamp(x);
 float lane=smoothstep(LANE_LOW,LANE_HIGH,gpuNoise3(vec3(theta*LANE_ANGLE,rr*LANE_RADIUS,LANE_SEED)));
 float depth=mix(1.,GALAXY_FAR_LIGHT,clamp(.5+.5*disk.y/max(.001,rr),0.,1.));
 intensity=(GALAXY_BASE_LIGHT+pow(b.x,GALAXY_LEVEL_POWER)*GALAXY_LEVEL_LIGHT)*arm*(1.+pulse.x*GALAXY_BEAT_LIGHT)*(1.-lane*LANE_SHADE)*depth;
}`;
const WORLD_GALAXY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 local;in vec3 tint;in float intensity;
out vec4 frag;
void main(){float radius=dot(local,local);if(radius>1.)discard;
 frag=vec4(tint*intensity*exp(-radius*4.),0.);
}`;
class WorldGalaxyAnalyzer extends WorldBandAnalyzer {
  constructor() { super(); this.id = 'g-galaxy'; this.label = '周波数の銀河'; this.orbitCount = WORLD_GALAXY_ORBITS;
    this.particleCount = WORLD_GALAXY_ORBITS * WORLD_GALAXY_PARTICLES_PER_ORBIT; }
  init(gpu) {
    super.init(gpu); this.background = gpu.program(WORLD_GALAXY_BACKGROUND); this.initUniforms(this.background);
    this.backgroundLocs = this._locations();
    this.program = gpu.program(WORLD_GALAXY_FRAGMENT, WORLD_GALAXY_VERTEX); this.initUniforms(this.program);
    this.pointLocs = this._locations(); this.countLoc = gpu.texture(this.program, 'particlesPerOrbit');
  }
  // uniformの入替は初期化時だけ確保したオブジェクトを使う。
  _locations() { return { bandLoc: this.bandLoc, songLoc: this.songLoc, colorLoc: this.colorLoc,
    resolutionLoc: this.resolutionLoc, beatLoc: this.beatLoc, pulseLoc: this.pulseLoc, midsLoc: this.midsLoc, timeLoc: this.timeLoc }; }
  render(input) {
    const g = this.gpu, gl = g.gl;
    Object.assign(this, this.backgroundLocs); g.bind(this.background, input.target); this.upload(input); g.draw();
    Object.assign(this, this.pointLocs); g.bind(this.program, input.target); this.upload(input);
    gl.uniform1i(this.countLoc, WORLD_GALAXY_PARTICLES_PER_ORBIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLES, 0, this.particleCount * 6); gl.disable(gl.BLEND);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldGalaxyAnalyzer, WORLD_GALAXY_PARTICLES_PER_ORBIT }; }
