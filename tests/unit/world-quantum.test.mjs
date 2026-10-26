// 目的 — 量子のビジョン：定数・区間の重み・クロスフェード・殻の膨張係数・火花バースト・GLモックでの init/step/render を検査する — doc/20261024-design-visions-v1.md §3・§5
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';
import { worldHarnessScripts } from '../lib/world-harness.mjs';
const r=loadClassic(worldHarnessScripts()),C=r.get('WORLD_QUANTUM'),Analyzer=r.get('WorldQuantumAnalyzer');
const Feature=r.get('MfsFrameView'),L=r.get('MFS_LAYOUT'),compile=r.get('compileWorldScore');
const weightsOf=r.get('worldQuantumSceneWeights'),shellOf=r.get('worldQuantumShellFactor');
const smooth=x=>x*x*(3-2*x);
function scoreFor(kinds,duration=10,seed=11) {
  return compile({bpm:120,durationSec:kinds.length*duration,beats:[],downbeatIndices:[],
    sections:kinds.map((kind,i)=>({kind,label:kind,startSec:i*duration,endSec:(i+1)*duration}))},seed);
}
function setup(kinds=['main'],duration=10) {
  const score=scoreFor(kinds,duration),features=new Feature();
  const engine={score,sectionIndex:0,seed:11,gpu:{uniforms:new Float32Array(244)},preview:false};
  return {analyzer:new Analyzer(),features,engine,input:{engine,song:score.song,features,dt:0,tSec:0}};
}
// GPUの数値結果ではなく、FBO/サンプラーと命令回数・uniform転送を検査するmock。
function commandGl() {
  let id=1,program=null,fbo=null,unit=0;
  const attachments=new Map(),textures=new Map(),samplers=new Map(),values=new Map(),calls=[];
  const gl={calls,values,INVALID_INDEX:0xffffffff};
  for(const name of ['UNIFORM_BUFFER','DYNAMIC_DRAW','VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS',
    'TEXTURE_2D','RGBA8','RGBA32F','RGBA16F','NEAREST','LINEAR','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER',
    'TEXTURE_WRAP_S','TEXTURE_WRAP_T','CLAMP_TO_EDGE','REPEAT','FRAMEBUFFER','READ_FRAMEBUFFER','DRAW_FRAMEBUFFER',
    'COLOR_ATTACHMENT0','COLOR_ATTACHMENT1','FRAMEBUFFER_COMPLETE','COLOR_BUFFER_BIT','TRIANGLES','POINTS','BLEND','ONE',
    'RGBA','FLOAT','UNSIGNED_BYTE'])gl[name]=id++;
  gl.TEXTURE0=1000;
  for(const name of ['createVertexArray','createBuffer','createShader','createProgram','createTexture','createFramebuffer'])gl[name]=()=>({id:id++});
  for(const name of ['bindVertexArray','bindBuffer','bufferData','bindBufferBase','compileShader','deleteShader','attachShader',
    'linkProgram','uniformBlockBinding','texParameteri','viewport','clearColor','blitFramebuffer','enable','blendFunc','disable',
    'deleteTexture','deleteFramebuffer','deleteProgram','deleteBuffer','deleteVertexArray','texSubImage2D','drawBuffers','bufferSubData'])gl[name]=()=>{};
  gl.shaderSource=(shader,source)=>{shader.source=source;};
  gl.texStorage2D=(target,levels,format,w,h)=>calls.push({storage:format,w,h});
  gl.getExtension=name=>name==='EXT_disjoint_timer_query_webgl2'?null:{};
  gl.getShaderParameter=gl.getProgramParameter=()=>true;gl.getUniformBlockIndex=()=>0;
  gl.checkFramebufferStatus=()=>gl.FRAMEBUFFER_COMPLETE;
  gl.getUniformLocation=(p,name)=>({p,name});gl.useProgram=p=>{program=p;};
  gl.activeTexture=v=>{unit=v-gl.TEXTURE0;};gl.bindTexture=(target,t)=>textures.set(unit,t);
  gl.bindFramebuffer=(target,f)=>{if(target!==gl.READ_FRAMEBUFFER)fbo=f;};
  gl.framebufferTexture2D=(target,attachment,type,t)=>{
    if(!attachments.has(fbo))attachments.set(fbo,new Map());attachments.get(fbo).set(attachment,t);
  };
  gl.uniform1i=(loc,v)=>{
    values.set(loc,v);
    if(['state','stateA','stateB','source','scene','history','bloom0','bloom1','bloom2','bloom3','exposure','flow','dye','velocity'].includes(loc.name)){
      if(!samplers.has(loc.p))samplers.set(loc.p,new Map());samplers.get(loc.p).set(loc.name,v);
    }
  };
  for(const name of ['uniform1ui','uniform1f','uniform2f','uniform3fv','uniform4fv','uniform1fv'])gl[name]=(loc,...v)=>{
    values.set(loc,v.length===1?v[0]:v);calls.push({uniform:loc,value:v.length===1?v[0]:v});
  };
  gl.clear=()=>calls.push({clear:fbo});
  gl.drawArrays=(mode,first,count)=>{
    for(const u of (samplers.get(program)||new Map()).values())for(const t of (attachments.get(fbo)||new Map()).values()){
      assert.notEqual(textures.get(u),t,'読取textureと描画先は独立');
    }
    calls.push({program,mode,count,fbo});
  };
  return gl;
}
function glContext() {
  const gl=commandGl(),canvas={width:1280,height:720,getContext:()=>gl};gl.canvas=canvas;
  return {gl,gpu:new(r.get('WorldGL'))(canvas)};
}
const lin=hex=>{const v=parseInt(hex.slice(1),16);return [16,8,0].map(s=>{const c=((v>>s)&255)/255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);});};
test('UW-Q-00 定数表・登録・色の linear 変換・GLSL 定数',()=>{
  assert.ok(Object.isFrozen(C));
  const num={FIL_BUNDLES:6,FIL_PER_BUNDLE:16,FIL_SAMPLES:4096,FIL_R_MIN:1.2,FIL_R_SPAN:1.2,FIL_TILT:70,FIL_OMEGA_MIN:.12,FIL_OMEGA_SPAN:.25,FIL_SPAN:2.6,
    FIL_WAVE_M_MIN:3,FIL_WAVE_M_SPAN:4,FIL_WAVE_A_MIN:.06,FIL_WAVE_A_SPAN:.16,FIL_WAVE_NU:1.3,FIL_WAVE_LOUD:.8,FIL_WAVE_BAND:.6,
    FIL_BUNDLE_W:.22,FIL_RADIAL_W:.10,FIL_GAIN:2,FIL_PULSE_FRACTION:.35,FIL_PULSE_SPEED:.9,FIL_PULSE_WIDTH:.03,FIL_PULSE_GAIN:4,FIL_PULSE_SECONDS:1.4,
    SHELL_COUNT:262144,SHELL_R:.8,SHELL_JITTER:.30,SHELL_SPRAY:.18,SHELL_SPRAY_MIN:1.12,SHELL_SPRAY_SPAN:.5,SHELL_SPRAY_GAIN:.45,
    CRACK_FREQ:4,CRACK_WIDTH:.08,CRACK_FLOOR:.05,SHELL_SPIN:.06,SHELL_GAIN:5,BURST_GROW:.4,BURST_SECONDS:4,IMPLODE:.85,
    CORE_RADIUS:.05,CORE_GAIN:6,CORE_KICK:1.5,CORE_HALO:.03,SPARK_BURSTS:16,SPARK_PER_BURST:768,SPARK_TAPS:4,
    SPARK_SPEED_MIN:1.2,SPARK_SPEED_MAX:4,SPARK_LIFE_MIN:.5,SPARK_LIFE_SPAN:.9,SPARK_DRAG:1.6,SPARK_GRAVITY:2.2,SPARK_SHUTTER:1/30,SPARK_GAIN:12,
    SPARK_BOKEH:.3,SPARK_BOKEH_NEAR:1,STAR_GRID:420,STAR_PROB:.06,STAR_RADIUS_PX:.6,STAR_GAIN:1.4,
    BEAM_COUNT:3,BEAM_WIDTH:.06,BEAM_GAIN:.35,BASE_SIZE:1.6,COC_K:26,MAX_POINT:64,BAND_BASE:.55,BAND_GAIN:.9,KICK_SECONDS:.18,
    EXPOSURE_BASE:1,EXPOSURE_FLOOR:.8,EXPOSURE_GAIN:.4,BLOOM_THRESHOLD:.7,BLOOM_STRENGTH:.6,SCENE_FADE:2,CAMERA_EASE_SECONDS:4,
    SPEED_LOUD_GAIN:.8,SPEED_MIN:.5,SPEED_MAX:1.6};
  for(const [k,v] of Object.entries(num))assert.equal(C[k],v,k);
  assert.equal(C.FIL_BUNDLES*C.FIL_PER_BUNDLE*C.FIL_SAMPLES,393216);assert.equal(C.SPARK_BURSTS*C.SPARK_PER_BURST*C.SPARK_TAPS,49152);
  assert.deepEqual([C.FIL_CORE,C.FIL_EDGE,C.STAR_COLOR,C.GROUND_BLACK,C.GROUND_TEAL_CENTER,C.GROUND_TEAL_EDGE,C.BEAM_COLOR],
    ['#EBE0C4','#C3C3A8','#9D9287','#060B04','#0D2226','#060E0A','#566B67']);
  assert.deepEqual(C.SHELL_GOLD.map(g=>[g[0],g[1]]),[['#925A05',29.4],['#A66704',25.3],['#BA7704',20.1],['#CE8B07',14.9],['#9D9287',10.2]]);
  assert.deepEqual(Array.from(C.SPARK_COLORS),['#EECA81','#DEAF5C','#CA913C','#935C25']);
  assert.deepEqual(Array.from(C.CORE_COLOR),[1,.96,.88]);
  const conv=r.get('worldSrgbToLinear');
  for(const hex of ['#EBE0C4','#060B04','#566B67'])for(let k=0;k<3;k++)assert.ok(Math.abs(conv(hex,new Float32Array(3))[k]-lin(hex)[k])<1e-6);
  const types=r.get('WORLD_ANALYZER_TYPES');
  assert.deepEqual(types.find(t=>t.id==='g-quantum'),{id:'g-quantum',label:'量子のビジョン',key:5,available:true});
  const shader=r.get('WORLD_QUANTUM_POINT_VERTEX');
  assert.match(shader,/const int SHELL_COUNT = 262144;/);assert.match(shader,/const float FIL_PULSE_GAIN = 4\.00000000;/);
  const got=shader.match(/const vec3 FIL_CORE_LIN = vec3\(([\d.]+),/)[1];assert.ok(Math.abs(Number(got)-lin('#EBE0C4')[0])<1e-6);
  const cum=C.SHELL_GOLD.reduce((a,g)=>a+g[1],0);assert.match(shader,new RegExp('const float GOLD_CUM0 = '+(C.SHELL_GOLD[0][1]/cum).toFixed(8)));
  // 加算ブレンドの点は 1 回の drawArrays（下の GL モックテスト）。smoothstep の逆順引数は使わない。
  assert.doesNotMatch(r.get('WORLD_QUANTUM_POINT_FRAGMENT'),/smoothstep\(1\.,/);
  console.log('UW-Q-00 constants='+Object.keys(num).length+' filPoints=393216 sparkPoints=49152');
});
test('UW-Q-01 区間の重み表（§3.2）・variation 奇数≥3 の main',()=>{
  const table={intro:[0,1,0,0],build:[1,.35,0,1],drop:[.35,1,1,0],break:[1,0,0,1],main:[1,0,.7,1],outro:[0,1,0,0]};
  const out=new Float64Array(4);let cases=0;
  for(const [kind,row] of Object.entries(table))for(const variation of [1,2,3,4,5]){
    const want=kind==='main'&&variation>=3&&variation%2===1?[.5,1,.7,0]:row;
    assert.equal(weightsOf(kind,variation,out),out);assert.deepEqual(Array.from(out),want);cases++;
  }
  console.log('UW-Q-01 cases='+cases);
});
test('UW-Q-02 重みのクロスフェード：SCENE_FADE で終わり、途中の区間変更でも飛ばない',()=>{
  {
    const {analyzer,engine,input}=setup(['intro','drop']);input.dt=.1;
    input.tSec=0;analyzer.step(input);assert.deepEqual(Array.from(analyzer.weights),[0,1,0,0]);
    input.tSec=9.9;analyzer.step(input);engine.sectionIndex=1;
    input.tSec=10;analyzer.step(input);assert.deepEqual(Array.from(analyzer.weights),[0,1,0,0]);
    const from=[0,1,0,0],to=[.35,1,1,0];
    for(const dt of [.5,1,1.5,C.SCENE_FADE,3]){
      input.tSec=10+dt;analyzer.step(input);const e=smooth(Math.min(1,dt/C.SCENE_FADE));
      for(let i=0;i<4;i++)assert.ok(Math.abs(analyzer.weights[i]-(from[i]+(to[i]-from[i])*e))<1e-12);
    }
    assert.deepEqual(Array.from(analyzer.weights),to);
  }
  {
    const {analyzer,engine,input}=setup(['intro','drop','break']);input.dt=.1;
    input.tSec=9.9;analyzer.step(input);engine.sectionIndex=1;input.tSec=10;analyzer.step(input);
    input.tSec=11;analyzer.step(input);const mid=Array.from(analyzer.weights);
    assert.ok(mid[2]>0&&mid[2]<1);
    engine.sectionIndex=2;input.tSec=11;analyzer.step(input);
    for(let i=0;i<4;i++)assert.equal(analyzer.weights[i],mid[i]);
    input.tSec=11+C.SCENE_FADE;analyzer.step(input);assert.deepEqual(Array.from(analyzer.weights),[1,0,0,1]);
  }
  console.log('UW-Q-02 fadeSec='+C.SCENE_FADE);
});
test('UW-Q-03 殻の膨張係数 B：drop・outro・その他と区間切替時の連続性',()=>{
  for(const q of [0,.25,.5,1,2])assert.ok(Math.abs(shellOf('drop',5+q*C.BURST_SECONDS,5,.3)-(1+C.BURST_GROW*(1-Math.pow(1-Math.min(1,q),3))))<1e-12);
  assert.equal(shellOf('drop',5,5,0),1);assert.equal(shellOf('drop',99,5,0),1+C.BURST_GROW);
  assert.equal(shellOf('outro',0,0,0),1);assert.ok(Math.abs(shellOf('outro',0,0,1)-(1-C.IMPLODE))<1e-12);assert.ok(Math.abs(shellOf('outro',0,0,.5)-(1-C.IMPLODE*.5))<1e-12);
  for(const kind of ['intro','build','break','main'])assert.equal(shellOf(kind,3,0,.7),1);
  const {analyzer,engine,input}=setup(['drop','main']);input.dt=.1;
  input.tSec=9.9;analyzer.step(input);const before=analyzer.shellFactor;assert.ok(Math.abs(before-(1+C.BURST_GROW))<1e-12);
  engine.sectionIndex=1;input.tSec=10;analyzer.step(input);assert.equal(analyzer.shellFactor,before);
  input.tSec=11;analyzer.step(input);assert.ok(Math.abs(analyzer.shellFactor-(before+(1-before)*smooth(.5)))<1e-12);
  input.tSec=12;analyzer.step(input);assert.equal(analyzer.shellFactor,1);
  console.log('UW-Q-03 peakB='+before);
});
test('UW-Q-04 キックのバーストは sparks の重みが .05 を超えるときだけ。drop では殻の上',()=>{
  const {analyzer,engine,input,features}=setup(['intro','drop']);input.dt=.1;
  features.raw[L.ONSET_FLAGS]=1;
  input.tSec=1;analyzer.step(input);assert.equal(analyzer.sparkSerial,0);assert.equal(analyzer.weights[2],0);
  engine.sectionIndex=1;
  input.tSec=10;analyzer.step(input);assert.equal(analyzer.sparkSerial,0);
  input.tSec=10.1;analyzer.step(input);assert.ok(analyzer.weights[2]<=.05);assert.equal(analyzer.sparkSerial,0);
  // 同時刻の再呼び出しで二重に作らない
  input.tSec=10.5;analyzer.step(input);assert.ok(analyzer.weights[2]>.05);assert.equal(analyzer.sparkSerial,1);
  analyzer.step(input);assert.equal(analyzer.sparkSerial,1);
  const o=analyzer.sparkOrigin;assert.equal(o[1*4+3],Math.fround(10.5));
  assert.ok(Math.abs(Math.hypot(o[4],o[5],o[6])-C.SHELL_R*analyzer.shellFactor)<1e-5);assert.equal(analyzer.sparkSerials[1],1);
  // スロットは serial % SPARK_BURSTS で循環する
  for(let i=0;i<C.SPARK_BURSTS;i++){input.tSec=11+i*.01;analyzer.step(input);}
  assert.equal(analyzer.sparkSerial,1+C.SPARK_BURSTS);assert.equal(analyzer.sparkSerials[(1+C.SPARK_BURSTS)%C.SPARK_BURSTS],1+C.SPARK_BURSTS);
  // drop 以外は半径 1.6 の球の内側
  const m=setup(['main']);m.input.dt=.1;m.features.raw[L.ONSET_FLAGS]=1;m.input.tSec=2;m.analyzer.step(m.input);
  assert.equal(m.analyzer.sparkSerial,1);assert.ok(Math.hypot(m.analyzer.sparkOrigin[4],m.analyzer.sparkOrigin[5],m.analyzer.sparkOrigin[6])<=C.BURST_BALL_R+1e-6);
  // 決定性：同じ seed・手順なら同じ origin
  const m2=setup(['main']);m2.input.dt=.1;m2.features.raw[L.ONSET_FLAGS]=1;m2.input.tSec=2;m2.analyzer.step(m2.input);
  assert.deepEqual(Array.from(m2.analyzer.sparkOrigin),Array.from(m.analyzer.sparkOrigin));
  console.log('UW-Q-04 bursts='+analyzer.sparkSerial);
});
test('UW-Q 高域オンセットのパルススロット循環・同時刻の二重消費防止・カメラ表の補間と反転',()=>{
  const {analyzer,input,features}=setup();input.dt=.1;features.raw[L.ONSET_FLAGS]=4;
  for(let i=1;i<=6;i++){input.tSec=i;analyzer.step(input);assert.equal(analyzer.filSerial,i);assert.equal(analyzer.filPulse[(i%4)*2],i);assert.equal(analyzer.filPulse[(i%4)*2+1],i);}
  analyzer.step(input);assert.equal(analyzer.filSerial,6);
  analyzer.reset();assert.equal(analyzer.filSerial,0);assert.equal(analyzer.filPulse[1],-100);
  const cam=r.get('WORLD_QUANTUM_CAMERA');let cases=0;
  for(const [kind,row] of Object.entries(cam))for(const variation of [1,2,3,4,5])for(const p of [0,.5,1]){
    const s=setup([kind]);s.engine.score.sections[0].variation=variation;s.input.tSec=p*10;s.analyzer.step(s.input);
    const flip=variation>=3&&variation%2===1?-1:1,sh=s.analyzer.cameraShot,k=smooth(p),at=i=>row[2*i]+(row[2*i+1]-row[2*i])*k;
    const want=[at(0),flip*at(1),at(2)*Math.PI/180,flip*at(3)*Math.PI/180,at(4)*Math.PI/180,at(5)];
    for(let i=0;i<6;i++)assert.ok(Math.abs(sh[i]-want[i])<1e-12);cases++;
  }
  console.log('UW-Q camera cases='+cases);
});
test('UW-Q GL モック：init/step/render が通り、背景 1 回＋点 1 回の加算描画。step は配列を作り直さない',()=>{
  const {gl,gpu}=glContext(),{analyzer,engine,input,features}=setup(['intro','drop']);
  analyzer.init(gpu);const target=gpu.target(1280,720);input.target=target;input.dt=1/60;
  const keys=['camera','cameraFrom','cameraTarget','cameraShot','camPos','camForward','camRight','camUp','weights','weightsFrom','weightsTarget','weightsU','filPulse','sparkOrigin','sparkSerials','timing','view','screen','corePx','bandUniforms'];
  const refs=keys.map(k=>analyzer[k]);
  features.raw[L.ONSET_FLAGS]=5;features.raw[L.LEVEL]=.6;
  for(let i=0;i<30;i++){input.tSec=i/60;analyzer.step(input);}
  engine.sectionIndex=1;for(let i=600;i<700;i++){input.tSec=i/60;analyzer.step(input);}
  keys.forEach((k,i)=>assert.equal(analyzer[k],refs[i],k));
  const base=gl.calls.length;analyzer.render(input);
  const draws=gl.calls.slice(base).filter(c=>c.mode!==undefined);
  assert.equal(draws.length,2);assert.equal(draws[0].mode,gl.TRIANGLES);assert.equal(draws[1].mode,gl.POINTS);
  assert.equal(draws[1].count,393216+262144+49152);assert.equal(draws[0].fbo,draws[1].fbo);
  assert.notEqual(draws[0].program,draws[1].program);
  assert.ok(analyzer.exposure>0&&Number.isFinite(analyzer.exposure));
  for(const a of [analyzer.camPos,analyzer.camForward,analyzer.camRight,analyzer.camUp,analyzer.corePx])for(const v of a)assert.ok(Number.isFinite(v));
  assert.ok(Math.abs(analyzer.corePx[0]-640)<1e-3&&Math.abs(analyzer.corePx[1]-360)<1e-3);
  console.log('UW-Q GL draws=2 points='+draws[1].count);
});
test('UW-Q WorldEngine 経由：g-quantum を選んで _step・post.quantum',()=>{
  const {gl,gpu}=glContext();void gpu;
  const canvas=gl.canvas,engine=new(r.get('WorldEngine'))(canvas),features=new Feature();
  engine.selectType('g-quantum',true);engine.setScore(scoreFor(['intro','drop'],10));
  engine._step(0,features,0);engine._step(1/60,features,1/60);engine._draw();
  assert.equal(engine.type.id,'g-quantum');assert.equal(engine.post.quantum,true);assert.equal(engine.post.gargantua,false);assert.equal(engine.post.attractor,false);
  engine.dispose();
});
