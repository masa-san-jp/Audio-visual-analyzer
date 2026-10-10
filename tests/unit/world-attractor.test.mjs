// 目的 — アトラクターの定数・変身・hash・カメラ・呼吸・暖機窓とGPU命令を検査する — doc/20261008-design-attractor-v1.md §9・§10
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';
import { worldHarnessScripts } from '../lib/world-harness.mjs';
const scripts=worldHarnessScripts();
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
function realEngine(kinds=['main'],duration=10) {
  const gl=commandGl(),canvas={width:1280,height:720,getContext:()=>gl};gl.canvas=canvas;
  const engine=new(r.get('WorldEngine'))(canvas),score=scoreFor(kinds,duration);engine.selectType('g-attractor',true);engine.setScore(score);
  return {engine,gl,features:new Feature()};
}
test('UW-84 WORLD-31 定数表・POINT_GAIN正規化・登録',()=>{
  // §11: 粒子数 768 行（1,572,864 個）、DECAY .90。個数は幅×高さから導出する。
  const expected={PARTICLE_W:2048,PARTICLE_H:768,PARTICLE_COUNT:C.PARTICLE_W*C.PARTICLE_H,WARM_ITERS:40,DECAY:.90,Z_SCALE:.9,SHAPE_SCALE:1,
    BAND_COUNT:32,BAND_BASE:.35,BAND_GAIN:1.6,PALETTE_TINT:.10,DEPTH_REF:3.2,EXPOSURE_BASE:2.5,EXPOSURE_FLOOR:.75,EXPOSURE_GAIN:.5,
    TRANS_SECONDS:1.8,TRANS_STAGGER:.5,TRANS_FLIGHT:1.1,SWIRL:1.6,KICK_BREATH:.06,KICK_SECONDS:.18,
    GLINT_FRACTION:.004,GLINT_GAIN:10,GLINT_SECONDS:.25,WARM_FRAMES:90,CAMERA_EASE_SECONDS:4,ORBIT_LOUD_GAIN:.8,ORBIT_MIN:.5,ORBIT_MAX:1.6,
    BLOOM_THRESHOLD:.6,BLOOM_STRENGTH:.8,GLINT_EPS:.01};
  assert.deepEqual(C,expected);assert.equal(C.PARTICLE_COUNT,1572864);assert.ok(Object.isFrozen(C));
  for(const [w,h] of [[1280,720],[1920,1080],[720,720]]){
    const gain=r.get('worldAttractorPointGain')(w,h);assert.equal(gain,(w*h*.08)/(C.PARTICLE_COUNT/(1-C.DECAY)));
    assert.ok(Math.abs(gain*C.PARTICLE_COUNT/(1-C.DECAY)/(w*h*.08)-1)<1e-14);
  }
  assert.deepEqual(r.get('WORLD_ANALYZER_TYPES')[2],{id:'g-attractor',label:'ストレンジアトラクター',key:3,available:true});
  console.log('UW-84 particles='+C.PARTICLE_COUNT+' constants='+Object.keys(C).length+' pointGain720='+r.get('worldAttractorPointGain')(1280,720)+' decayWarm='+C.DECAY**C.WARM_FRAMES);
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
  assert.match(shader,/\(music\.z-particleHash\(i,0u\)\*TRANS_STAGGER\)\/TRANS_FLIGHT/);
  for(const h of [0,.1,.5,.999999]){
    const delay=h*C.TRANS_STAGGER;assert.equal(flight(-1,h),0);assert.equal(flight(delay,h),0);assert.equal(flight(C.TRANS_SECONDS,h),1);
    assert.equal(flight(delay+C.TRANS_FLIGHT,h),1);
    assert.ok(Math.abs(flight(delay+C.TRANS_FLIGHT/2,h)-.5)<1e-15);
    let prev=0;
    for(let i=0;i<=300;i++){
      const age=i*C.TRANS_SECONDS/300,v=flight(age,h),p=Math.max(0,Math.min(1,(age-delay)/C.TRANS_FLIGHT));
      const error=Math.abs(v-smooth(p));maxError=Math.max(maxError,error);assert.equal(error,0);assert.ok(v>=prev);prev=v;cases++;
    }
  }
  assert.ok(flight(C.TRANS_FLIGHT/2,0)>flight(C.TRANS_FLIGHT/2,.5));
  console.log('UW-86 flightSamples='+cases+' maxError='+maxError+' staggerSec='+C.TRANS_STAGGER+' flightSec='+C.TRANS_FLIGHT);
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
  const expected={intro:[5.2,4,12,18,.05,.05,0,0,34,34],build:[4.6,3.6,28,6,.09,.09,0,-6,34,34],
    drop:[3.4,3.1,10,14,.24,.24,8,8,38,38],break:[4.8,4.8,58,64,.03,.03,0,0,30,30],
    main:[3.9,3.9,16,16,.11,.11,-4,-4,34,34],outro:[4.2,6.5,18,30,.04,.04,0,0,34,34]};
  const camera=r.get('WORLD_ATTRACTOR_CAMERA');assert.deepEqual(camera,expected);let cases=0,maxError=0;
  for(const [kind,row] of Object.entries(camera))for(const variation of [1,2,3])for(const p of [0,.25,.5,.75,1]){
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
  input.tSec=10+C.CAMERA_EASE_SECONDS/2;analyzer.step(input);for(let i=0;i<5;i++)assert.equal(analyzer.cameraShot[i],from[i]+(analyzer.cameraTarget[i]-from[i])*.5);
  input.tSec=10+C.CAMERA_EASE_SECONDS;analyzer.step(input);assert.deepEqual(analyzer.cameraShot,analyzer.cameraTarget);
  console.log('UW-88 shotComponents='+cases+' transitionComponents=15 maxError='+maxError);
});
test('UW-89 WORLD-31 音量周回clamp・キック呼吸/高域イベント・同時刻二重消費防止・再演',()=>{
  const shader=r.get('WORLD_ATTRACTOR_POINT_VERTEX');
  assert.match(shader,/P\*=1\.\+KICK_BREATH\*music\.x;/);
  assert.doesNotMatch(shader,/KICK_SCATTER|P\s*\+=/);
  const update=r.get('WORLD_ATTRACTOR_UPDATE_FRAGMENT');
  assert.doesNotMatch(update.slice(update.indexOf('void main()')),/KICK_BREATH|music/);
  // 実GLSLのスカラー倍率をCPUで評価し、全座標/粒子間距離が同じ比率で膨らむことを確認する。
  const breath=new Function('KICK_BREATH','music','return '+shader.match(/P\*=([^;]+);/)[1]);
  const points=[[0,0,0],[.2,-.7,.4],[-.6,.3,-.9]];
  let maxError=0,maxBreathError=0,breathCases=0,peakScale=0,afterScale=0;
  const checkBreath=env=>{
    const scale=breath(C.KICK_BREATH,{x:env}),expected=1+C.KICK_BREATH*env;
    assert.equal(scale,expected);
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
      const distance=Math.hypot(...points[i].map((v,k)=>v-points[j][k]));
      const expanded=Math.hypot(...points[i].map((v,k)=>v*scale-points[j][k]*scale));
      const error=Math.abs(expanded/distance-expected);maxBreathError=Math.max(maxBreathError,error);
      assert.ok(error<1e-14);breathCases++;
    }
    return scale;
  };
  assert.equal(checkBreath(0),1);
  for(const loudness of [-2,0,.5,1,3]){
    const {analyzer,input,features}=setup();features.raw[L.LEVEL]=loudness;input.dt=.2;input.tSec=1;features.raw[L.ONSET_FLAGS]=5;
    analyzer.step(input);const want=analyzer.cameraShot[2]*Math.max(C.ORBIT_MIN,Math.min(C.ORBIT_MAX,1+C.ORBIT_LOUD_GAIN*(loudness-.5)))*input.dt;
    assert.equal(analyzer.yaw,want);assert.equal(analyzer.glintSerial,1);assert.equal(analyzer.music[0],1);assert.equal(analyzer.music[1],1);
    peakScale=checkBreath(analyzer.music[0]);assert.equal(peakScale,1+C.KICK_BREATH);
    input.dt=0;analyzer.step(input);assert.equal(analyzer.glintSerial,1);assert.equal(analyzer.yaw,want);
    input.tSec=1+C.KICK_SECONDS;features.raw[L.ONSET_FLAGS]=0;analyzer.step(input);
    const age=input.tSec-1,error=Math.abs(analyzer.music[0]-Math.exp(-age/C.KICK_SECONDS));maxError=Math.max(maxError,error);assert.ok(error<3e-8);
    assert.ok(Math.abs(analyzer.music[1]-Math.exp(-age/C.GLINT_SECONDS))<3e-8);
    afterScale=checkBreath(analyzer.music[0]);assert.ok(afterScale>1&&afterScale<peakScale);
    const snapshot=analyzer.music.slice();analyzer.reset();input.tSec=1;features.raw[L.ONSET_FLAGS]=5;analyzer.step(input);
    input.tSec=1+C.KICK_SECONDS;features.raw[L.ONSET_FLAGS]=0;analyzer.step(input);assert.deepEqual(analyzer.music,snapshot);
  }
  console.log('UW-89 loudnessCases=5 maxEnvelopeFloat32Error='+maxError+' breathDistanceCases='+breathCases+' peakScale='+peakScale+' afterScale='+afterScale+' maxBreathError='+maxBreathError+' eventReplayError=0');
});
test('UW-90 WORLD-31 advanceTo暖機90枚・非同期renderAt・新流体/ブラックホール回数',async()=>{
  const {engine,gl}=realEngine();const a=engine.type;let renders=0,warms=0;
  a.render=()=>renders++;a.warmStart=t=>{warms++;assert.equal(t,511/60);};assert.equal(engine.post.stepFeedback,undefined);
  engine.advanceTo(10);assert.equal(engine.frame,601);assert.equal(renders,90);assert.equal(warms,1);
  assert.equal(engine.latestSec,10);engine.advanceTo(10+1/60);assert.equal(renders,91);assert.equal(warms,1);
  renders=warms=0;await engine.renderAt(10);assert.equal(renders,90);assert.equal(warms,1);
  renders=warms=0;await engine.renderAt(0);assert.equal(renders,1);assert.equal(warms,0);
  for(const [id,expected] of [['g-fluid',420],['g-gargantua',1]]){
    engine.selectType(id,true);engine.setScore(engine.score);let count=0;engine.type.render=()=>count++;engine.advanceTo(10);assert.equal(count,expected);
  }
  engine.selectType('g-attractor',true);engine.setScore(engine.score);renders=warms=0;engine.fadeElapsed=0;
  a.warmStart=()=>warms++;engine.advanceTo(10);assert.equal(renders,122);assert.equal(warms,1);
  // 1/60の累積丸めで0.5秒に届くまで32枚、末尾の暖機窓90枚。
  engine.dispose();
  console.log('UW-90 CPUsteps=601 GPUdraws=90 warmStarts=1 fluidDraws=420 gargantuaDraws=1 fadeDraws='+renders+' mockCommands='+gl.calls.length);
});
test('UW-91 WORLD-31 GPU命令: 32F二組・40反復・16F密度・変身・資源再利用・再描画不変',()=>{
  const {engine,gl,features}=realEngine(['intro','drop','outro'],10),a=engine.type,g=engine.gpu;
  const storage=gl.calls.filter(c=>c.storage===gl.RGBA32F&&c.w===C.PARTICLE_W&&c.h===C.PARTICLE_H);assert.equal(storage.length,4);
  const resources=[g.textures.length,g.fbos.length,g.programs.length];
  const count=p=>gl.calls.filter(c=>c.program===p).length;
  engine._step(0,features,0);assert.equal(count(a.updateProgram),42);assert.equal(count(a.program),1);assert.equal(count(a.decayProgram),1);
  assert.equal(gl.calls.filter(c=>c.program===a.program)[0].count,C.PARTICLE_COUNT);
  assert.equal(gl.values.get(a.pointGainLoc),r.get('worldAttractorPointGain')(1280,720));
  const initial=count(a.updateProgram);a.render(engine.typeInput);assert.equal(count(a.updateProgram),initial);assert.equal(count(a.program),1);
  const oldA=a.stateA,oldB=a.stateB;
  engine._step(10,features,1/60);assert.equal(a.shapeA,'L');assert.equal(a.shapeB,'H');assert.equal(count(a.updateProgram)-initial,43);
  const before=count(a.updateProgram);engine._step(13,features,1/60);
  assert.equal(a.shapeA,'H');assert.equal(a.shapeB,null);assert.equal(a.stateA,oldB);assert.equal(a.stateB,oldA);assert.equal(count(a.updateProgram)-before,1);
  engine._step(20,features,1/60);assert.equal(a.shapeB,'L');assert.deepEqual([g.textures.length,g.fbos.length,g.programs.length],resources);
  engine._draw();assert.equal(engine.post.attractor,true);assert.equal(engine.post.gargantua,false);
  assert.equal(gl.values.get(engine.post.thresholdLoc),0);assert.equal(engine.post.feedbackProgram,undefined);assert.equal(count(engine.post.exposureProgram),0);
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
  const fps=60,sectionStart=10,endFrame=Math.ceil((sectionStart+C.TRANS_SECONDS)*fps),targetFrame=endFrame-1;
  const targetSec=targetFrame/fps,warmFrame=targetFrame+1-C.WARM_FRAMES;
  const timeline=Array.from({length:endFrame+1},(_,i)=>{const f=new Float32Array(104);f[L.LEVEL]=.7;f[L.ONSET_FLAGS]=i%30===0?5:0;return f;});
  const optimized=realEngine(['intro','build','drop']),full=realEngine(['intro','build','drop']);
  for(const item of [optimized,full])item.engine.setTimeline(timeline,fps);
  const e=optimized.engine,a=e.type;let warmTime=null;
  const warm=a.warmStart.bind(a);a.warmStart=t=>{warmTime=t;warm(t);};e.advanceTo(targetSec);
  assert.ok(warmTime>sectionStart&&targetSec<sectionStart+C.TRANS_SECONDS);
  assert.equal(warmTime,warmFrame/fps);assert.equal(a.shapeA,'L');assert.equal(a.shapeB,'J');
  const updatePasses=optimized.gl.calls.filter(c=>c.program===a.updateProgram).length;
  assert.equal(updatePasses,2*(C.WARM_ITERS+1)+C.WARM_FRAMES*2);
  full.engine.type.render=()=>{};for(let i=0;i<=targetFrame;i++)full.engine._step(i/fps,full.engine.frameFeatures(i),i?1/fps:0);
  const b=full.engine.type;
  const compare=()=>{
    for(const name of ['camera','cameraShot','bandUniforms','music'])assert.deepEqual(a[name],b[name]);
    for(const name of ['yaw','shapeA','shapeB','lastKick','lastHigh','glintSerial','transitionStart'])assert.equal(a[name],b[name]);
    assert.equal(e.frame,full.engine.frame);assert.equal(a.glintSerial,Math.floor((e.frame-1)/30)+1);assert.equal(a.gpuNeedsB,false);
  };
  compare();
  // §10の完了境界ではBをAへ入れ替え、その後は1組だけ更新する。
  e.advanceTo(endFrame/fps);full.engine._step(endFrame/fps,full.engine.frameFeatures(endFrame),1/fps);
  assert.equal(a.shapeA,'J');assert.equal(a.shapeB,null);assert.equal(a.music[3],0);compare();
  assert.equal(optimized.gl.calls.filter(c=>c.program===a.updateProgram).length-updatePasses,1);
  e.dispose();full.engine.dispose();console.log('UW-93 CPUsteps='+(endFrame+1)+' dualStateUpdatePasses='+updatePasses+' warmStartSec='+warmTime+' targetSec='+targetSec+' completedSec='+endFrame/fps+' glintEvents='+a.glintSerial+' CPUstateError=0 completionUpdatePasses=1');
});
test('UW-96 WORLD-35 §11 三角関数なしの色重み・CPUカメラ基底・シェーダー整理',()=>{
  const shader=r.get('WORLD_ATTRACTOR_POINT_VERTEX');
  // 頂点シェーダーにカメラ基底の計算（normalize・cross）が残らず、uniformで受け取る。
  assert.doesNotMatch(shader,/normalize|cross\(|camera\.|uniform vec4 camera/);
  assert.match(shader,/uniform vec3 camPos,camForward,camRight,camUp;/);
  // 廃止した散乱の残骸（z・phi・r のhash）が消えている。
  assert.doesNotMatch(shader,/particleHash\(i,3u\)|particleHash\(i,4u\)|sqrt\(/);
  // グリントのhashは music.y > GLINT_EPS のときだけ評価する。
  assert.match(shader,/if\(music\.y>GLINT_EPS&&particleHash\(i,glintSerial\)<GLINT_FRACTION\)/);
  assert.match(shader,new RegExp('const float GLINT_EPS = '+C.GLINT_EPS.toFixed(8).replace('.','\\.')+';'));
  // 色の重み: 新式（正規化ベクトルn・定数cos/sin）が旧cos式と一致する（64方向）。
  const c2=Math.cos(2.1),s2=Math.sin(2.1);let maxColor=0;
  for(let i=0;i<64;i++){
    const ang=(i+.5)/64*2*Math.PI-Math.PI,v=[Math.cos(ang)*(.3+i%5),Math.sin(ang)*(.3+i%5)],L=Math.hypot(...v),n=L>1e-6?[v[0]/L,v[1]/L]:[1,0];
    const old=[.5+.5*Math.cos(ang),.5+.5*Math.cos(ang-2.1),.5+.5*Math.cos(ang+2.1)];
    const now=[.5+.5*n[0],.5+.5*(n[0]*c2+n[1]*s2),.5+.5*(n[0]*c2-n[1]*s2)];
    for(let k=0;k<3;k++){const e=Math.abs(old[k]-now[k]);maxColor=Math.max(maxColor,e);assert.ok(e<1e-6);}
  }
  // CPUカメラ基底 = 旧GLSL式（double評価）。roll・奇数variationの符号反転も含む。
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm=a=>{const l=Math.hypot(...a);return a.map(x=>x/l);};
  let maxBasis=0,cases=0;
  for(const kind of ['intro','build','drop','break','main','outro'])for(const variation of [1,2])for(const p of [0,.5,1]){
    const {analyzer,engine,input}=setup([kind]);engine.score.sections[0].variation=variation;input.tSec=p*10;input.dt=.1;analyzer.step(input);
    const [dist,pitch,yaw,roll]=analyzer.camera;
    const cam=[dist*Math.cos(pitch)*Math.cos(yaw),dist*Math.sin(pitch),dist*Math.cos(pitch)*Math.sin(yaw)];
    const forward=norm(cam.map(x=>-x)),right=norm(cross(forward,[0,1,0])),up=cross(right,forward);
    const r2=right.map((x,k)=>Math.cos(roll)*x+Math.sin(roll)*up[k]),u2=right.map((x,k)=>-Math.sin(roll)*x+Math.cos(roll)*up[k]);
    for(const [got,want] of [[analyzer.camPos,cam],[analyzer.camForward,forward],[analyzer.camRight,r2],[analyzer.camUp,u2]])
      for(let k=0;k<3;k++){const e=Math.abs(got[k]-want[k]);maxBasis=Math.max(maxBasis,e);assert.ok(e<1e-6);}
    cases++;
  }
  // 配列は再利用（stepで再確保しない）。
  const {analyzer,input}=setup(),before=[analyzer.camPos,analyzer.camForward,analyzer.camRight,analyzer.camUp];
  analyzer.step(input);input.tSec=1;analyzer.step(input);
  assert.deepEqual([analyzer.camPos,analyzer.camForward,analyzer.camRight,analyzer.camUp].map((a,k)=>a===before[k]),[true,true,true,true]);
  console.log('UW-96 colorDirections=64 maxColorError='+maxColor+' basisCases='+cases+' maxBasisError='+maxBasis);
});
