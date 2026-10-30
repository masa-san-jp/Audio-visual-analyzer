// 目的 — 円盤の継ぎ目（φ=±π）を実画素で測る — doc/20261004-design-gargantua-v1.md §7.7。画面のキック増光とGPU p95はBW-13-kick-gpuが現行の定義（線形HDR）で検査する
// @page harness
// 計測専用shaderで直接像のφ／最接近距離／背景マスクを同じ半解像度で引く。
function world14ReadGeometry(engine) {
  const e=engine,a=e.type,g=e.gpu,gl=g.gl;
  if(!e.world14Geometry){
    const source=WORLD_GARGANTUA_FRAGMENT.replace(/void main\(\)\{[\s\S]*$/,'');
    e.world14Geometry=g.program(source+'void main(){float r,phi,bg,d;vec4 a[MAX_CROSSINGS],b[MAX_CROSSINGS];int count;bool escaped;vec3 dir;traceRay(vUv,r,phi,bg,d,a,b,count,escaped,dir);frag=vec4(d,phi,r,bg);}');
  }
  const target=g.target(a.half.width,a.half.height,true),program=e.world14Geometry;
  try {
    g.bind(program,target);gl.uniform4fv(g.texture(program,'bands[0]'),a.bandUniforms);
    gl.uniform3fv(g.texture(program,'primary'),e.score.song.palette.primary);gl.uniform3fv(g.texture(program,'secondary'),e.score.song.palette.secondary);
    gl.uniform4fv(g.texture(program,'camera'),a.camera);gl.uniform4fv(g.texture(program,'music'),a.music);
    gl.uniform3fv(g.texture(program,'gravity'),a.gravity);gl.uniform4fv(g.texture(program,'streaks[0]'),a.streaks);
    gl.uniform2f(g.texture(program,'outputResolution'),e.canvas.width,e.canvas.height);g.draw();
    const pixels=new Float32Array(target.width*target.height*4);gl.readPixels(0,0,target.width,target.height,gl.RGBA,gl.FLOAT,pixels);
    if(gl.getError())throw new Error('v1.1 geometry GL error');
    return {pixels,width:target.width,height:target.height};
  }finally {g.releaseTarget(target);}
}
function world14SeamReport(capture,geometry) {
  const w=capture.width,h=capture.height,p=capture.rgba,g=geometry.pixels;
  const Y=(x,y)=>{const i=(y*w+x)*4;return (.2126*p[i]+.7152*p[i+1]+.0722*p[i+2])/255;};
  const meta=(x,y)=>((Math.min(geometry.height-1,Math.floor(y*geometry.height/h))*geometry.width+
    Math.min(geometry.width-1,Math.floor(x*geometry.width/w)))*4);
  const difference=(x,y)=>{
    let left=0,right=0;for(let k=0;k<4;k++){left+=Y(x-1-k,y);right+=Y(x+k,y);}return Math.abs(left-right)/4;
  };
  let seam=0,surround=0,samples=0;
  for(let y=0;y<h;y++)for(let x=12;x<w-12;x++){
    const l=meta(x-1,y),r=meta(x,y);
    // φ=±πの実際の折り返しだけを選ぶ。背景／高次像／内外縁は除く。
    if(g[l]<3.5||g[r]<3.5||g[l]>10.5||g[r]>10.5||Math.abs(g[l+1]-g[r+1])<6)continue;
    let valid=true;for(const dx of [-12,-4,4,12]){const o=meta(x+dx,y);if(g[o]<3.5||g[o]>10.5)valid=false;}
    if(!valid)continue;
    seam+=difference(x,y);surround+=(difference(x-8,y)+difference(x+8,y))*.5;samples++;
  }
  const seamDifference=samples?seam/samples:0,surroundingDifference=samples?surround/samples:0;
  return {samples,seamDifference,surroundingDifference,ratio:surroundingDifference>0?seamDifference/surroundingDifference:null,
    pass:samples>0&&seamDifference<=2*surroundingDifference};
}
// 方位角πへ一時的に回して近側の継ぎ目を画面に置く。時刻・incl・重力・音楽は撮影時の値。
function world14Seam(engine) {
  const a=engine.type,azim=a.camera[2];
  try {a.camera[2]=Math.PI;engine._draw();const capture=engine.capture();if(capture.glError)throw new Error('seam GL error');
    return world14SeamReport(capture,world14ReadGeometry(engine));
  }finally {a.camera[2]=azim;engine._draw();}
}
if(typeof avzGpuTest==='function')avzGpuTest('BW-14-screen','継ぎ目の左右4画素の差が周囲の2倍以下（6時刻）',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../browser/harness/world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  try {
    await ready;const child=iframe.contentWindow,e=child.__world?.engine;avzAssert.ok(e,child.__world?.error);
    child.eval([world14ReadGeometry,world14SeamReport,world14Seam].map(f=>f.toString()).join('\n'));
    const result=await child.eval(`(async()=>{
      const e=__world.engine,score=compileWorldScore({bpm:120,durationSec:100,beats:[],downbeatIndices:[],sections:
        [{startSec:0,endSec:14,kind:'intro',label:'I'},{startSec:14,endSec:26,kind:'build',label:'B'},
         {startSec:26,endSec:40,kind:'drop',label:'D'},{startSec:40,endSec:54,kind:'break',label:'K'},
         {startSec:54,endSec:80,kind:'drop',label:'D'},{startSec:80,endSec:100,kind:'outro',label:'O'}]},11),f=new MfsFrameView();
      e.timeline=null;e.selectType('g-gargantua',true);e.setScore(score);f.bandsSmooth.fill(.8);f.raw[MFS_LAYOUT.LEVEL]=.8;
      const seams=[],times=[7,20,31,45,62,90];
      for(let frame=0;frame<=5400;frame++){
        f.raw[MFS_LAYOUT.ONSET_FLAGS]=frame%30===0?5:0;e._step(frame/60,f,1/60);
        if(times.includes(frame/60))seams.push({tSec:frame/60,...world14Seam(e)});
      }
      const seam={samples:seams.length,results:seams,pass:seams.length===times.length&&seams.every(s=>s.pass)};
      return {seam,pass:seam.pass};
    })()`);
    console.log('BW-14-screen '+JSON.stringify(result));avzAssert.ok(result.pass,JSON.stringify(result));
  }finally {iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
},{timeoutMs:180000,slow:true});
if(typeof module!=='undefined'&&module.exports){module.exports={world14SeamReport};}
if(typeof avzGpuTest==='function')avzGpuTest('BW-14-periodic','実GLSLの2位相・6時刻のφ周期性と有限な出力',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../browser/harness/world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  try {
    await ready;const child=iframe.contentWindow;avzAssert.ok(child.__world?.engine,child.__world?.error);
    const result=child.eval(`(()=>{
      const e=__world.engine,g=e.gpu,gl=g.gl,source=WORLD_GARGANTUA_FRAGMENT.replace(/void main\\(\\)\\{[\\s\\S]*$/,'');
      // 現行のstreakInput（位相1・2）とstreakFlowで、φ=-πとφ=+πが同じ値になること。lfは中間の0.3。
      const target=g.target(64,2,true),program=g.program(source+'void main(){float layer=floor(gl_FragCoord.y),rd=3.5+floor(gl_FragCoord.x)/64.*7.;float omega=KEPLER_SPEED*pow(rd/DISK_INNER,KEPLER_POWER)*music.z;float tau=mod(music.w+layer*FLOW_PERIOD*.5,FLOW_PERIOD);vec3 a=streakInput(rd,-PI,omega,tau,layer+1.),b=streakInput(rd,PI,omega,tau,layer+1.);frag=vec4(abs(a-b),abs(streakFlow(rd,-PI,omega,.3)-streakFlow(rd,PI,omega,.3)));}');
      let inputError=0,fbmError=0,nonfinite=0;
      try {
        for(const t of [7,20,31,45,62,90]){
          g.bind(program,target);gl.uniform4fv(g.texture(program,'music'),[0,0,1,t]);g.draw();
          const p=new Float32Array(64*2*4);gl.readPixels(0,0,64,2,gl.RGBA,gl.FLOAT,p);
          for(let i=0;i<p.length;i++){if(!Number.isFinite(p[i]))nonfinite++;if(i%4===3)fbmError=Math.max(fbmError,p[i]);else inputError=Math.max(inputError,p[i]);}
        }
        return {inputError,fbmError,nonfinite,samples:64*2*6,glError:gl.getError()};
      }finally {g.releaseTarget(target);}
    })()`);
    console.log('BW-14-periodic '+JSON.stringify(result));avzAssert.equal(result.glError,0);avzAssert.equal(result.nonfinite,0);
    avzAssert.ok(result.inputError<.0001);avzAssert.ok(result.fbmError<.0001);
  }finally {iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
},{timeoutMs:60000});
