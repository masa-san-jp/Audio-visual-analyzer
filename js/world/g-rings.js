// 目的 — Spectral Coronaの背景・核・鏡像64光線・衝撃環・既存GPU粒子を描く — doc/20261004-design-gpu-analyzers-v1.md §2
const WORLD_SPARK_THRESHOLD = .6;
const WORLD_RINGS_ROTATION = .04;
const WORLD_RINGS_BEAT_ROTATION = .025;
const WORLD_CORE_RADIUS = .075;
const WORLD_CORE_BASS_RADIUS = .035;
const WORLD_CORE_BEAT_RADIUS = .02;
const WORLD_RAY_BASE_LENGTH = .06;
const WORLD_RAY_LEVEL_LENGTH = .40;
const WORLD_RAY_BASS_LENGTH = .05;
const WORLD_RINGS_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_ANALYZER_GLSL}
in vec2 vUv;
out vec4 frag;
void main(){
 vec2 p=(vUv-.5)*vec2(resolution.x/resolution.y,1.);
 float rotA=t*RINGS_ROTATION*song.x+pulse.x*RINGS_BEAT_ROTATION;
 vec2 q=gpuRot(rotA)*p;float r=length(q),a=atan(q.y,q.x)+PI;
 vec3 col=analyzerBackground(p,a,r,t,colors[1]);
 float R0=coronaRadius(pulse);
 float core=exp(-r/(R0*CORE_FALLOFF))*(CORE_BASE+pulse.z*CORE_BASS_LIGHT+pulse.x*CORE_BEAT_LIGHT);
 float corona=core*(CORONA_BASE+CORONA_NOISE*gpuNoise3(vec3(cos(a)*CORONA_SCALE,sin(a)*CORONA_SCALE,t*CORONA_SPEED)));
 col+=mix(colors[2],vec3(1.),CORE_WHITE_MIX)*corona;
 float u=a/TAU*RAY_COUNT,idx=floor(u),f=fract(u)-.5;
 int band=int(idx<32.?idx:63.-idx);band=clamp(band,0,31);
 float L=bands[band].x,G=bands[band].y;
 float len=RAY_BASE_LENGTH+L*RAY_LEVEL_LENGTH+pulse.z*RAY_BASS_LENGTH;
 float s=(r-R0)/len,dAng=f*TAU/RAY_COUNT,d=abs(sin(dAng))*r;
 float w=RAY_ROOT_WIDTH+RAY_TIP_WIDTH*clamp(s,0.,1.);
 float beam=exp(-pow(d/w,2.))+RAY_HALO*exp(-d/(w*RAY_HALO_WIDTH));
 float along=smoothstep(0.,RAY_START,s)*(1.-smoothstep(RAY_FADE,1.,s));
 float tip=exp(-pow((s-1.)*len/RAY_TIP_RADIUS,2.))*L;
 vec3 color=bandRamp(float(band)/31.),heat=mix(vec3(1.),color,smoothstep(0.,RAY_WHITE_END,s));
 float I=(RAY_BASE_LIGHT+L*RAY_LEVEL_LIGHT)*(1.+bands[band].w*RAY_ONSET_LIGHT);
 col+=heat*beam*along*I+color*tip*RAY_TIP_LIGHT;
 float lenG=RAY_BASE_LENGTH+G*RAY_LEVEL_LENGTH;
 float trail=exp(-pow(d/(w*TRAIL_WIDTH),2.))*smoothstep(R0,R0+TRAIL_FADE,r)*(1.-smoothstep(R0+lenG-TRAIL_FADE,R0+lenG,r));
 col+=color*trail*G*TRAIL_LIGHT;
 col+=analyzerBeatRings(r,R0,beats,song.x,colors[2]);
 col*=1.+pulse.y*BAR_EXPOSURE;
 frag=vec4(col,1.);
}`;
class WorldRingsAnalyzer extends WorldBandAnalyzer {
  constructor() { super(); this.id = 'g-rings'; this.label = '光の放射リング'; this.rayCount = 64;
    this.sparkEvents = new Float32Array(128); this.onsetPrevious = new Float32Array(32); this.sparkTimes = new Float64Array(32); this.reset(); }
  init(gpu) { super.init(gpu); this.program = gpu.program(WORLD_RINGS_FRAGMENT); this.initUniforms(this.program); }
  reset() {
    super.reset();
    if (this.sparkEvents) { this.sparkEvents.fill(0); this.onsetPrevious.fill(0); this.sparkTimes.fill(-100); for (let i = 0; i < 32; i++) this.sparkEvents[i * 4] = -100; }
    this.sparkReset = true;
  }
  step(input) {
    this.update(input);
    for (let i = 0; i < 32; i++) {
      const o = i * 4, onset = this.bandUniforms[o + 3], group = i < 6 ? 0 : i < 22 ? 1 : 2;
      if (onset > WORLD_SPARK_THRESHOLD && (this.onsetPrevious[i] <= WORLD_SPARK_THRESHOLD || (input.features.onset.flags & (1 << group))) && this.sparkTimes[i] !== input.tSec) {
        this.sparkTimes[i] = input.tSec; this.sparkEvents[o] = input.tSec; this.sparkEvents[o + 1]++;
        this.sparkEvents[o + 2] = WORLD_CORE_RADIUS + this.pulseUniforms[2] * WORLD_CORE_BASS_RADIUS + this.pulseUniforms[0] * WORLD_CORE_BEAT_RADIUS + WORLD_RAY_BASE_LENGTH + this.bandUniforms[o] * WORLD_RAY_LEVEL_LENGTH + this.pulseUniforms[2] * WORLD_RAY_BASS_LENGTH;
        this.sparkEvents[o + 3] = input.tSec * WORLD_RINGS_ROTATION * input.song.motionSpeed + this.pulseUniforms[0] * WORLD_RINGS_BEAT_ROTATION;
      }
      this.onsetPrevious[i] = onset;
    }
    // 更新・描画とも既存のGPU粒子パスを再利用。追加のパス／資源は作らない。
    if (input.dt > 0 || input.engine.frame === 1 || this.sparkReset) {
      input.engine.particles.step(input.engine.fluid, this, input); this.sparkReset = false;
    }
  }
  render(input) {
    this.gpu.bind(this.program, input.target); this.upload(input); this.gpu.draw();
    input.engine.particles.render(input.target, this, input);
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldRingsAnalyzer }; }
