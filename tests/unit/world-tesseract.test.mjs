// 目的 — テッセラクトの定数・パレット・カメラ表・パルススロット・GPU命令を検査する — doc/20261024-design-visions-v1.md §2・§5
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';
import { worldHarnessScripts } from '../lib/world-harness.mjs';
const scripts=worldHarnessScripts();
const r=loadClassic(scripts),C=r.get('WORLD_TESSERACT'),Analyzer=r.get('WorldTesseractAnalyzer');
const Feature=r.get('MfsFrameView'),L=r.get('MFS_LAYOUT'),compile=r.get('compileWorldScore');
const smooth=x=>x*x*(3-2*x);
const lin=c=>c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);
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
  const engine=new(r.get('WorldEngine'))(canvas),score=scoreFor(kinds,duration);engine.selectType('g-tesseract',true);engine.setScore(score);
  return {engine,gl,features:new Feature()};
}

test('UW-T-01 定数・パレット・linear変換・登録',()=>{
  const expected={PITCH:.02,LAYERS:3,LAYER_DZ:1.2,NEAR:.25,NEAR_FADE:.35,FAR_FADE:1.2,FOG:3.5,PRESENCE:.45,
    W_MIN:.06,W_MAX:.30,W_POW:2.5,JITTER:.6,BUNDLE:.28,BUNDLE_LO:.38,BUNDLE_HI:.60,BUNDLE_FLOOR:0,
    HALO_GAIN:.08,HALO_WIDTH:3,APERTURE:.003,NEIGHBOR:3,PEAK:3.0,BAND_BASE:.55,BAND_GAIN:.9,KICK_GAIN:.25,KICK_SECONDS:.18,
    FLOW_WAVELENGTH:.9,FLOW_SPEED:.12,FLOW_DEPTH:.12,PULSE_FRACTION:.04,PULSE_SPEED:2.4,PULSE_LENGTH:.12,PULSE_GAIN:3,PULSE_SECONDS:1.6,PULSE_START:1.6,
    PULSE_SLOTS:4,BG:'#080502',EXPOSURE_BASE:1,EXPOSURE_FLOOR:.8,EXPOSURE_GAIN:.4,BLOOM_THRESHOLD:.8,BLOOM_STRENGTH:.55,CAMERA_EASE_SECONDS:4,
    SPEED_LOUD_GAIN:.8,SPEED_MIN:.5,SPEED_MAX:1.6};
  assert.deepEqual(C,expected);assert.ok(Object.isFrozen(C));
  const palette=r.get('WORLD_TESSERACT_PALETTE');
  assert.deepEqual(palette.map(p=>[...p]),[[.426,'#C1C5BC','#929388'],[.418,'#F9F7DF','#B0A58A'],[.097,'#EEC1AE','#B28B83'],
    [.043,'#F5F9E8','#C9CEB8'],[.009,'#EBF7F3','#BFD0CC'],[.007,'#E1EBE3','#D2DFD7']]);
  assert.ok(Math.abs(palette.reduce((a,p)=>a+p[0],0)-1)<1e-12);
  for(let i=1;i<palette.length;i++)assert.ok(palette[i-1][0]>=palette[i][0]);
  // linear変換: 地 #080502 と先頭族の core #C1C5BC
  const bg=r.get('WORLD_TESSERACT_BG_LINEAR'),pal=r.get('WORLD_TESSERACT_PALETTE_LINEAR');
  for(let i=0;i<3;i++){
    assert.ok(Math.abs(bg[i]-lin([8,5,2][i]/255))<1e-7);
    assert.ok(Math.abs(pal[0].core[i]-lin([0xC1,0xC5,0xBC][i]/255))<1e-6);
  }
  const shader=r.get('WORLD_TESSERACT_FRAGMENT');
  assert.match(shader,/const int LAYERS = 3;/);assert.match(shader,/const float PITCH = 0\.02000000;/);
  assert.deepEqual(r.get('WORLD_ANALYZER_TYPES')[3],{id:'g-tesseract',label:'テッセラクト',key:4,available:true});
  assert.equal(new Analyzer().statelessRender,true);
  console.log('UW-T-01 constants='+Object.keys(C).length+' paletteFamilies='+palette.length);
});
test('UW-T-02 カメラ表の補間・奇数variationで反転列だけ符号変更・4秒補間',()=>{
  const expected={intro:[.03,.03,.02,.02,0,0,0,0,0,0,40,40,2.2,2.2],build:[.05,.10,.05,.35,0,6,0,4,0,-3,40,46,2.2,1.6],
    drop:[.22,.22,.30,.30,20,26,-4,-4,-7,-7,52,52,1.4,1.4],break:[.015,.015,.03,.03,0,0,24,30,0,0,44,44,2.6,2.6],
    main:[.08,.08,.10,.10,-10,-10,3,3,3,3,42,42,1.8,1.8],outro:[.02,.01,-.06,-.06,0,0,0,0,0,0,40,36,2.4,2.4]};
  const camera=r.get('WORLD_TESSERACT_CAMERA');assert.deepEqual(camera,expected);let cases=0;
  const flip=[0,2,4],deg=[2,3,4,5];
  for(const [kind,row] of Object.entries(camera))for(const variation of [1,2,3,4,5])for(const p of [0,.25,.5,.75,1]){
    const {analyzer,engine,input}=setup([kind]);engine.score.sections[0].variation=variation;input.tSec=p*10;analyzer.step(input);
    for(let i=0;i<7;i++){
      let want=row[2*i]+(row[2*i+1]-row[2*i])*smooth(p);
      if(variation>=3&&variation%2===1&&flip.includes(i))want=-want;
      if(deg.includes(i))want*=Math.PI/180;
      assert.ok(Math.abs(analyzer.cameraShot[i]-want)<1e-14,kind+' v'+variation+' col'+i);cases++;
    }
  }
  const {analyzer,engine,input}=setup(['intro','drop']);analyzer.step(input);input.tSec=9;analyzer.step(input);
  const from=analyzer.cameraShot.slice();engine.sectionIndex=1;input.tSec=10;analyzer.step(input);assert.deepEqual(analyzer.cameraShot,from);
  input.tSec=10+C.CAMERA_EASE_SECONDS/2;analyzer.step(input);for(let i=0;i<7;i++)assert.equal(analyzer.cameraShot[i],from[i]+(analyzer.cameraTarget[i]-from[i])*.5);
  input.tSec=10+C.CAMERA_EASE_SECONDS;analyzer.step(input);assert.deepEqual(analyzer.cameraShot,analyzer.cameraTarget);
  // 移動の積分: camZ += vz*speedFactor*motionSpeed*dt（音量係数はclamp）、基底は直交・単位長
  for(const loud of [-2,.5,3]){
    const s=setup(['main']);s.features.raw[L.LEVEL]=loud;s.input.dt=.5;s.input.tSec=1;s.analyzer.step(s.input);
    const f=Math.max(C.SPEED_MIN,Math.min(C.SPEED_MAX,1+C.SPEED_LOUD_GAIN*(loud-.5)));
    assert.ok(Math.abs(s.analyzer.camZ-s.analyzer.cameraShot[1]*f*s.input.song.motionSpeed*.5)<1e-12);
    assert.ok(Math.abs(s.analyzer.camX-s.analyzer.cameraShot[0]*f*s.input.song.motionSpeed*.5)<1e-12);
  }
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  for(const kind of Object.keys(camera)){
    const s=setup([kind]);s.input.tSec=3;s.analyzer.step(s.input);const a=s.analyzer;
    for(const v of [a.camForward,a.camRight,a.camUp])assert.ok(Math.abs(dot(v,v)-1)<1e-6);
    assert.ok(Math.abs(dot(a.camForward,a.camRight))<1e-6&&Math.abs(dot(a.camForward,a.camUp))<1e-6&&Math.abs(dot(a.camRight,a.camUp))<1e-6);
  }
  const t0=setup(['intro']);t0.analyzer.step(t0.input);const a0=t0.analyzer;
  for(const [got,want] of [[a0.camForward,[0,0,1]],[a0.camRight,[1,0,0]],[a0.camUp,[0,1,0]]])for(let i=0;i<3;i++)assert.ok(Math.abs(got[i]-want[i])<1e-7);
  console.log('UW-T-02 shotComponents='+cases);
});
test('UW-T-03 高域オンセットでパルススロットが循環・同時刻の再呼び出しで二重に入らない',()=>{
  const {analyzer,input,features}=setup();const S=C.PULSE_SLOTS,hash=r.get('worldAttractorHash');
  for(let i=0;i<S;i++){assert.equal(analyzer.pulses[i*4+1],-100);}
  const seen=[];
  for(let k=1;k<=S+2;k++){
    input.tSec=k;features.raw[L.ONSET_FLAGS]=4;analyzer.step(input);
    const o=(k%S)*4;assert.equal(analyzer.pulses[o],k);assert.equal(analyzer.pulses[o+1],k);
    assert.equal(analyzer.pulses[o+2],hash(0,k,analyzer.seed)<.5?1:-1);assert.equal(analyzer.pulseSerial,k);
    // 同時刻の再呼び出しでは増えない
    const snap=analyzer.pulses.slice();analyzer.step(input);assert.equal(analyzer.pulseSerial,k);assert.deepEqual(analyzer.pulses,snap);
    seen.push(o/4);
  }
  assert.deepEqual(seen.slice(0,S),[1,2,3,0]);assert.equal(analyzer.pulses[1*4],S+1);
  // キックだけではパルスは増えず、キック包絡が立つ
  input.tSec=20;features.raw[L.ONSET_FLAGS]=1;const n=analyzer.pulseSerial;analyzer.step(input);assert.equal(analyzer.pulseSerial,n);assert.equal(analyzer.kick,1);
  // reset で t0=-100、serial=0
  analyzer.reset();assert.equal(analyzer.pulseSerial,0);for(let i=0;i<S;i++)assert.equal(analyzer.pulses[i*4+1],-100);
  console.log('UW-T-03 slots='+S);
});
test('UW-T 両タイプ共通: GLモックで init/step/render が通り、stepで新しい配列を作らない',()=>{
  const {engine,gl,features}=realEngine(['intro','drop'],10),a=engine.type,g=engine.gpu;
  assert.equal(a.id,'g-tesseract');
  const resources=[g.textures.length,g.fbos.length,g.programs.length];
  const count=p=>gl.calls.filter(c=>c.program===p).length;
  engine._step(0,features,0);assert.equal(count(a.program),1);
  const arrays=['camPos','camForward','camRight','camUp','pulses','cameraFrom','cameraTarget','cameraShot','bandUniforms'];
  const before=arrays.map(n=>a[n]);
  features.raw[L.ONSET_FLAGS]=5;engine._step(10/60,features,1/60);engine._step(11/60,features,1/60);engine._step(10.5,features,1/60);
  assert.ok(arrays.every((n,i)=>a[n]===before[i]),'配列を再確保しない');
  engine._draw();assert.equal(engine.post.tesseract,true);assert.equal(engine.post.attractor,false);
  assert.ok(gl.calls.some(c=>c.uniform===engine.post.thresholdLoc&&c.value===C.BLOOM_THRESHOLD));
  assert.equal(count(engine.post.exposureProgram),0);
  assert.deepEqual([g.textures.length,g.fbos.length,g.programs.length],resources);
  // 出力はフル解像度のtargetへ直接描く（半解像度なし）
  engine.dispose();console.log('UW-T GL mock draws='+gl.calls.length);
});
