// 目的 — アトラクターの定数・変身・hash・カメラ・暖機窓とGPU命令を検査する — doc/20261008-design-attractor-v1.md §9
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';
const html=fs.readFileSync(new URL('../../world.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m=>m[1]);
const r=loadClassic(scripts),C=r.get('WORLD_ATTRACTOR'),Analyzer=r.get('WorldAttractorAnalyzer');
const Feature=r.get('MfsFrameView'),L=r.get('MFS_LAYOUT'),compile=r.get('compileWorldScore');
const smooth=x=>x*x*(3-2*x);
function scoreFor(kinds=['main'],duration=10,seed=11) {
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
  for(const name of ['uniform1ui','uniform1f','uniform2f','uniform3fv','uniform4fv'])gl[name]=(loc,...v)=>{
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
function realEngine(kinds=['main'],duration=10) {
  const gl=commandGl(),canvas={width:1280,height:720,getContext:()=>gl};gl.canvas=canvas;
  const engine=new(r.get('WorldEngine'))(canvas),score=scoreFor(kinds,duration);engine.selectType('g-attractor',true);engine.setScore(score);
  return {engine,gl,features:new Feature()};
}
test('UW-84 WORLD-31 定数表・POINT_GAIN正規化・登録',()=>{
  const expected={PARTICLE_W:2048,PARTICLE_H:1024,PARTICLE_COUNT:2097152,WARM_ITERS:40,DECAY:.82,Z_SCALE:.9,SHAPE_SCALE:1,
    BAND_COUNT:32,BAND_BASE:.35,BAND_GAIN:1.6,PALETTE_TINT:.25,DEPTH_REF:3.2,EXPOSURE_BASE:2.5,EXPOSURE_FLOOR:.75,EXPOSURE_GAIN:.5,
    TRANS_SECONDS:3,TRANS_STAGGER:1.2,TRANS_FLIGHT:1.8,SWIRL:1.1,KICK_SCATTER:.07,KICK_SECONDS:.18,
    GLINT_FRACTION:.004,GLINT_GAIN:10,GLINT_SECONDS:.25,WARM_FRAMES:90,CAMERA_EASE_SECONDS:4,ORBIT_LOUD_GAIN:.8,ORBIT_MIN:.5,ORBIT_MAX:1.6,
    BLOOM_THRESHOLD:.6,BLOOM_STRENGTH:.8};
  assert.deepEqual(C,expected);assert.ok(Object.isFrozen(C));
  for(const [w,h] of [[1280,720],[1920,1080],[720,720]]){
    const gain=r.get('worldAttractorPointGain')(w,h);assert.equal(gain,(w*h*.08)/(2097152/(1-.82)));
    assert.ok(Math.abs(gain*C.PARTICLE_COUNT/(1-C.DECAY)/(w*h*.08)-1)<1e-14);
  }
  assert.deepEqual(r.get('WORLD_ANALYZER_TYPES')[2],{id:'g-attractor',label:'ストレンジアトラクター',key:3,available:true});
  console.log('UW-84 particles=2097152 constants='+Object.keys(C).length+' pointGain720='+r.get('worldAttractorPointGain')(1280,720)+' decay90='+C.DECAY**90);
});
test('UW-85 WORLD-31 固定7形・6kind×variation1〜5・有界Clifford写像',()=>{
  const shapes=r.get('WORLD_ATTRACTOR_SHAPES'),choose=r.get('worldAttractorShape');
  assert.deepEqual(shapes,{L:[-2,-1.9,-1.2,2],H:[-1.24,-1.25,-1.81,-1.91],J:[-1.9,1.9,.9,.5],F:[-1.8,-2,-.5,-.9],D:[1.5,-1.8,1.6,.9],A:[-1.4,1.6,1,.7],Cc:[1.7,1.7,.6,1.2]});
  const base={intro:'L',build:'J',drop:'H',break:'A',main:'D',outro:'L'};
  let cases=0,maxMagnitude=0;
  for(const [kind,name] of Object.entries(base))for(let variation=1;variation<=5;variation++){
    assert.equal(choose(kind,variation),variation>=3&&variation%2===1&&kind==='drop'?'F':variation>=3&&variation%2===1&&kind==='main'?'Cc':name);cases++;
  }
  for(const shape of Object.values(shapes)){
    assert.ok(Object.isFrozen(shape));const [a,b,c,d]=shape,ex=1+Math.abs(c),ey=1+Math.abs(d);let x=.17,y=-.31;
    for(let i=0;i<1000;i++){const nx=Math.sin(a*y)+c*Math.cos(a*x),ny=Math.sin(b*x)+d*Math.cos(b*y);x=nx;y=ny;
      assert.ok(Math.abs(x)<=ex&&Math.abs(y)<=ey);maxMagnitude=Math.max(maxMagnitude,Math.abs(x),Math.abs(y));}
  }
  console.log('UW-85 assignmentCases='+cases+' mapIterations=7000 maxMagnitude='+maxMagnitude);
});
test('UW-86 WORLD-31 粒子別変身の端点・単調性・遅延・GLSL式一致',()=>{
  const flight=r.get('worldAttractorFlight');let cases=0,maxError=0;
  const shader=r.get('WORLD_ATTRACTOR_POINT_VERTEX');assert.match(shader,/SWIRL\*sin\(PI\*e\)/);
  assert.match(shader,/P=mix\(P,position\(b,shapeB\),e\);rgb=mix\(rgb,color\(b\),e\)/);
  for(const h of [0,.1,.5,.999999]){
    const delay=h*1.2;assert.equal(flight(-1,h),0);assert.equal(flight(delay,h),0);assert.equal(flight(3,h),1);
    assert.ok(Math.abs(flight(delay+.9,h)-.5)<1e-15);
    let prev=0;
    for(let i=0;i<=300;i++){
      const age=i/100,v=flight(age,h),p=Math.max(0,Math.min(1,(age-delay)/1.8));
      const error=Math.abs(v-smooth(p));maxError=Math.max(maxError,error);assert.equal(error,0);assert.ok(v>=prev);prev=v;cases++;
    }
  }
  assert.ok(flight(1,0)>flight(1,.5));
  console.log('UW-86 flightSamples='+cases+' maxError='+maxError+' staggerSec=1.2 flightSec=1.8');
});
test('UW-87 WORLD-31 グリント部分集合とhashの決定性・seed/serial分離',()=>{
  const hash=r.get('worldAttractorHash');let selected=0,changedSerial=0,changedSeed=0;
  const n=100000;
  for(let i=0;i<n;i++){
    const h=hash(i,4,11),pick=h<C.GLINT_FRACTION;
    assert.equal(h,hash(i,4,11));assert.ok(h>=0&&h<1);
    // GLSLと同じuint積/shiftを独立に参照評価する。
    let u=(i^Math.imul(4,0x9e3779b9)^11)>>>0;
    u=Math.imul(u^(u>>>16),0x7feb352d)>>>0;u=Math.imul(u^(u>>>15),0x846ca68b)>>>0;
    assert.equal(h,((u^(u>>>16))>>>8)/16777216);
    selected+=pick;changedSerial+=pick!==(hash(i,5,11)<C.GLINT_FRACTION);changedSeed+=pick!==(hash(i,4,12)<C.GLINT_FRACTION);
  }
  assert.ok(selected>300&&selected<500);assert.ok(changedSerial>500&&changedSeed>500);
  console.log('UW-87 particles='+n+' selected='+selected+' serialChanged='+changedSerial+' seedChanged='+changedSeed+' replayError=0');
});
test('UW-88 WORLD-31 カメラ表・区間内smoothstep・奇数反転・全項目4秒補間',()=>{
  const expected={intro:[5.2,4,12,18,.05,.05,0,0,34,34],build:[3.8,2.8,28,6,.09,.09,0,-6,34,34],
    drop:[2.5,2.3,10,14,.24,.24,8,8,38,38],break:[4.2,4.2,58,64,.03,.03,0,0,30,30],
    main:[3.2,3.2,16,16,.11,.11,-4,-4,34,34],outro:[3.4,6.5,18,30,.04,.04,0,0,34,34]};
  assert.deepEqual(r.get('WORLD_ATTRACTOR_CAMERA'),expected);let cases=0,maxError=0;
  for(const [kind,row] of Object.entries(expected))for(const variation of [1,2,3])for(const p of [0,.25,.5,.75,1]){
    const {analyzer,engine,input}=setup([kind]);engine.score.sections[0].variation=variation;input.tSec=p*10;analyzer.step(input);
    for(let i=0;i<5;i++){
      let want=row[2*i]+(row[2*i+1]-row[2*i])*smooth(p);
      if(variation%2===1&&(i===2||i===3))want=-want;
      if(i===1||i===3||i===4)want*=Math.PI/180;
      const error=Math.abs(analyzer.cameraShot[i]-want);maxError=Math.max(maxError,error);assert.ok(error<1e-14);cases++;
    }
  }
  const {analyzer,engine,input}=setup(['intro','drop']);analyzer.step(input);input.tSec=9;analyzer.step(input);
  const from=analyzer.cameraShot.slice();engine.sectionIndex=1;input.tSec=10;analyzer.step(input);assert.deepEqual(analyzer.cameraShot,from);
  input.tSec=12;analyzer.step(input);for(let i=0;i<5;i++)assert.equal(analyzer.cameraShot[i],from[i]+(analyzer.cameraTarget[i]-from[i])*.5);
  input.tSec=14;analyzer.step(input);assert.deepEqual(analyzer.cameraShot,analyzer.cameraTarget);
  console.log('UW-88 shotComponents='+cases+' transitionComponents=15 maxError='+maxError);
});
test('UW-89 WORLD-31 音量周回clamp・キック/高域イベント・同時刻二重消費防止・再演',()=>{
  let maxError=0;
  for(const loudness of [-2,0,.5,1,3]){
    const {analyzer,input,features}=setup();features.raw[L.LEVEL]=loudness;input.dt=.2;input.tSec=1;features.raw[L.ONSET_FLAGS]=5;
    analyzer.step(input);const want=analyzer.cameraShot[2]*Math.max(.5,Math.min(1.6,1+.8*(loudness-.5)))*.2;
    assert.equal(analyzer.yaw,want);assert.equal(analyzer.glintSerial,1);assert.equal(analyzer.music[0],1);assert.equal(analyzer.music[1],1);
    input.dt=0;analyzer.step(input);assert.equal(analyzer.glintSerial,1);assert.equal(analyzer.yaw,want);
    input.tSec=1.18;features.raw[L.ONSET_FLAGS]=0;analyzer.step(input);
    const error=Math.abs(analyzer.music[0]-Math.exp(-.18/.18));maxError=Math.max(maxError,error);assert.ok(error<3e-8);
    assert.ok(Math.abs(analyzer.music[1]-Math.exp(-.18/.25))<3e-8);
    const snapshot=analyzer.music.slice();analyzer.reset();input.tSec=1;features.raw[L.ONSET_FLAGS]=5;analyzer.step(input);
    input.tSec=1.18;features.raw[L.ONSET_FLAGS]=0;analyzer.step(input);assert.deepEqual(analyzer.music,snapshot);
  }
  console.log('UW-89 loudnessCases=5 maxEnvelopeFloat32Error='+maxError+' eventReplayError=0');
});
test('UW-90 WORLD-31 advanceTo暖機90枚・非同期renderAt・既存流体/ブラックホール回数',async()=>{
  const {engine,gl}=realEngine();const a=engine.type;let renders=0,warms=0,feedback=0;
  a.render=()=>renders++;a.warmStart=t=>{warms++;assert.equal(t,511/60);};engine.post.stepFeedback=()=>feedback++;
  engine.advanceTo(10);assert.equal(engine.frame,601);assert.equal(renders,90);assert.equal(warms,1);assert.equal(feedback,0);
  assert.equal(engine.latestSec,10);engine.advanceTo(10+1/60);assert.equal(renders,91);assert.equal(warms,1);
  renders=warms=0;await engine.renderAt(10);assert.equal(renders,90);assert.equal(warms,1);
  renders=warms=0;await engine.renderAt(0);assert.equal(renders,1);assert.equal(warms,0);
  for(const [id,expected] of [['g-fluid',601],['g-gargantua',1]]){
    engine.selectType(id,true);engine.setScore(engine.score);let count=0;engine.type.render=()=>count++;engine.advanceTo(10);assert.equal(count,expected);
  }
  engine.selectType('g-attractor',true);engine.setScore(engine.score);renders=warms=0;engine.fadeElapsed=0;
  a.warmStart=()=>warms++;engine.advanceTo(10);assert.equal(renders,122);assert.equal(warms,1);
  // 1/60の累積丸めで0.5秒に届くまで32枚、末尾の暖機窓90枚。
  assert.equal(feedback,601); // g-fluidは時刻0と600正dtを更新する。
  engine.dispose();
  console.log('UW-90 CPUsteps=601 GPUdraws=90 warmStarts=1 fluidDraws=601 gargantuaDraws=1 fadeDraws='+renders+' mockCommands='+gl.calls.length);
});
test('UW-91 WORLD-31 GPU命令: 32F二組・40反復・16F密度・変身・資源再利用・再描画不変',()=>{
  const {engine,gl,features}=realEngine(['intro','drop','outro'],10),a=engine.type,g=engine.gpu;
  const storage=gl.calls.filter(c=>c.storage===gl.RGBA32F&&c.w===2048&&c.h===1024);assert.equal(storage.length,4);
  const resources=[g.textures.length,g.fbos.length,g.programs.length];
  const count=p=>gl.calls.filter(c=>c.program===p).length;
  engine._step(0,features,0);assert.equal(count(a.updateProgram),42);assert.equal(count(a.program),1);assert.equal(count(a.decayProgram),1);
  assert.equal(gl.calls.filter(c=>c.program===a.program)[0].count,2097152);
  assert.equal(gl.values.get(a.pointGainLoc),r.get('worldAttractorPointGain')(1280,720));
  const initial=count(a.updateProgram);a.render(engine.typeInput);assert.equal(count(a.updateProgram),initial);assert.equal(count(a.program),1);
  const oldA=a.stateA,oldB=a.stateB;
  engine._step(10,features,1/60);assert.equal(a.shapeA,'L');assert.equal(a.shapeB,'H');assert.equal(count(a.updateProgram)-initial,43);
  const before=count(a.updateProgram);engine._step(13,features,1/60);
  assert.equal(a.shapeA,'H');assert.equal(a.shapeB,null);assert.equal(a.stateA,oldB);assert.equal(a.stateB,oldA);assert.equal(count(a.updateProgram)-before,1);
  engine._step(20,features,1/60);assert.equal(a.shapeB,'L');assert.deepEqual([g.textures.length,g.fbos.length,g.programs.length],resources);
  engine._draw();assert.equal(engine.post.attractor,true);assert.equal(engine.post.gargantua,false);
  assert.equal(gl.values.get(engine.post.thresholdLoc),0);assert.equal(count(engine.post.feedbackProgram),0);assert.equal(count(engine.post.exposureProgram),0);
  assert.ok(gl.calls.some(c=>c.uniform===engine.post.thresholdLoc&&c.value===.6));
  const bInit=count(a.updateProgram);a.warmStart(20);assert.equal(count(a.updateProgram)-bInit,82);
  assert.equal(a.gpuNeedsB,false);assert.equal(a.gpuNeedsInit,false);
  engine.dispose();console.log('UW-91 stateTextures32F=4 initialPasses=42 transitionPasses=43 dualWarmPasses=82 resourceGrowth=0 redrawUpdatePasses=0 feedbackPasses=0');
});
test('UW-92 WORLD-31 同形境界は変身しない・CPUのみ変身完了後/短区間も再初期化',()=>{
  const {engine,features}=realEngine(['intro','outro','build','drop'],1),a=engine.type;
  engine._step(0,features,0,false);engine._step(1,features,1/60,false);assert.equal(a.shapeA,'L');assert.equal(a.shapeB,null);
  engine._step(2,features,1/60,false);assert.equal(a.shapeB,'J');engine._step(3,features,1/60,false);assert.equal(a.shapeA,'J');assert.equal(a.shapeB,'H');
  engine._step(6,features,1/60);assert.equal(a.shapeA,'H');assert.equal(a.shapeB,null);assert.equal(a.gpuNeedsInit,false);
  engine.dispose();console.log('UW-92 sameShapeTransitions=0 interruptedDestination=J finalShape=H');
});
test('UW-93 WORLD-31 変身中に暖機窓へ入りA/B再初期化・全CPU上演と状態一致',()=>{
  const timeline=Array.from({length:721},(_,i)=>{const f=new Float32Array(104);f[L.LEVEL]=.7;f[L.ONSET_FLAGS]=i%30===0?5:0;return f;});
  const optimized=realEngine(['intro','build','drop']),full=realEngine(['intro','build','drop']);
  for(const item of [optimized,full])item.engine.setTimeline(timeline,60);
  const e=optimized.engine,a=e.type;let warmTime=null;
  const warm=a.warmStart.bind(a);a.warmStart=t=>{warmTime=t;warm(t);};e.advanceTo(12);
  assert.equal(warmTime,631/60);assert.equal(a.shapeA,'L');assert.equal(a.shapeB,'J');
  const updatePasses=optimized.gl.calls.filter(c=>c.program===a.updateProgram).length;
  assert.equal(updatePasses,82+90*2);
  full.engine.type.render=()=>{};for(let i=0;i<=720;i++)full.engine._step(i/60,full.engine.frameFeatures(i),i?1/60:0);
  const b=full.engine.type;
  for(const name of ['camera','cameraShot','bandUniforms','music'])assert.deepEqual(a[name],b[name]);
  for(const name of ['yaw','shapeA','shapeB','lastKick','lastHigh','glintSerial','transitionStart'])assert.equal(a[name],b[name]);
  assert.equal(e.frame,full.engine.frame);assert.equal(a.glintSerial,25);assert.equal(a.gpuNeedsB,false);
  e.dispose();full.engine.dispose();console.log('UW-93 CPUsteps=721 dualStateUpdatePasses='+updatePasses+' warmStartSec='+warmTime+' glintEvents=25 CPUstateError=0');
});
