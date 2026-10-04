// 目的 — 64帯域光線・残光・拍の同心衝撃環をHDRで描く — 構想 §2.8(2)
const WORLD_RINGS_FRAGMENT = `#version 300 es
${WORLD_ANALYZER_GLSL}
in vec2 vUv;
out vec4 frag;
void main(){
 vec2 p=(vUv-.5)*vec2(resolution.x/resolution.y,1.);
 float radius=length(p),a=mod(atan(p.y,p.x)+TAU,TAU);
 int ray=int(floor(a/TAU*64.)),band=ray/2;
 float angle=(float(ray)+.5)*TAU/64.,d=abs(sin(a-angle))*radius;
 vec4 b=bands[band];float level=b.x,len=.035+level*.35;
 float width=.0015+.001*song.y;
 float core=exp(-pow(d/width,2.));
 float extent=smoothstep(.065,.078,radius)*(1.-smoothstep(.078+len,.088+len,radius));
 float trail=exp(-pow(d/(width*2.2),2.))*smoothstep(.065,.085,radius)*(1.-smoothstep(.10+b.y*.36,.14+b.y*.36,radius));
 // 残光は主光線より暗くし、現在の帯域レベルを隠さない。
 float detail=.8+.2*sin(radius*(60.+song.y*120.)-b.z*4.);
 vec3 c=bandColor(band)*(core*extent*detail*level*7.*(1.+b.w*.3)+trail*b.y*.55);
 float shock=0.;for(int i=0;i<4;i++){
  float age=beats[i];if(age<.6)shock+=exp(-pow((radius-(.08+age*.8*song.x))/.0035,2.))*(1.-smoothstep(.1,.6,age));
 }
 c+=colors[2]*shock*2.;
 frag=vec4(c*(.45+.55*song.w),1.);
}`;
class WorldRingsAnalyzer extends WorldBandAnalyzer {
  constructor() { super(); this.id = 'g-rings'; this.label = '光の放射リング'; this.rayCount = 64; }
  init(gpu) { super.init(gpu); this.program = gpu.program(WORLD_RINGS_FRAGMENT); this.initUniforms(this.program); }
  render(input) { this.gpu.bind(this.program, input.target); this.upload(input); this.gpu.draw(); }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldRingsAnalyzer }; }
