// 目的 — 量子のビジョン v2 の定数・色・シェーダー・予定表・溶かし・カメラ・音の状態・後処理・GPU命令を検査する — doc/20261028-design-quantum-v2.md §9
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';
import { worldHarnessScripts } from '../lib/world-harness.mjs';
const scripts=worldHarnessScripts();
const r=loadClassic(scripts),C=r.get('WORLD_QUANTUM'),Analyzer=r.get('WorldQuantumAnalyzer'),BuildSchedule=r.get('worldQuantumBuildSchedule');
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
  // 量子のビジョンの int scene（場面番号）を sampler と取り違えないよう、sampler2D と宣言された名前だけを読取textureとして扱う
  gl.attachShader=(p,shader)=>{p.source=(p.source||'')+shader.source;};
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
    if(new RegExp('uniform\\s+(?:\\w+\\s+)?sampler2D\\s+'+loc.name+'\\b').test(loc.p.source||'')&&['state','stateA','stateB','source','scene','history','bloom0','bloom1','bloom2','bloom3','exposure','flow','dye','velocity'].includes(loc.name)){
      if(!samplers.has(loc.p))samplers.set(loc.p,new Map());samplers.get(loc.p).set(loc.name,v);
    }
  };
  for(const name of ['uniform1ui','uniformMatrix3fv','uniform1f','uniform2f','uniform3fv','uniform4fv','uniform1fv'])gl[name]=(loc,...v)=>{
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
  const engine=new(r.get('WorldEngine'))(canvas),score=scoreFor(kinds,duration);engine.selectType('g-quantum',true);engine.setScore(score);
  return {engine,gl,features:new Feature()};
}

const sceneOf=(s,t)=>{s.analyzer._stepScene(t);return [s.analyzer.sceneA,s.analyzer.sceneB,s.analyzer.mixW,s.analyzer.tA,s.analyzer.tB];};
const sec=(kind,startSec,endSec,variation=1)=>({kind,startSec,endSec,variation});
function schedule(sections){
  const starts=new Float64Array(sections.length*3+2),scenes=new Uint8Array(sections.length*3+2);
  const n=BuildSchedule(sections,starts,scenes);
  return Array.from({length:n},(_,i)=>[starts[i],scenes[i]]);
}
function setBands(features,fn){for(let i=0;i<32;i++)features.raw[L.BANDS_SMOOTH+i]=fn(i);}
function stepAt(s,t,dt){s.input.tSec=t;s.input.dt=dt;s.analyzer.step(s.input);}
const bandLevel=raw=>Math.pow(Math.max(0,Math.min(1,(raw-.12)/.7)),.8);

test('UW-Q-01 定数・色・シェーダー本文・登録',()=>{
  const expected={FADE:2.5,MINT_LEAD:3,DROP_SPLIT:3,CAM_BASE:.14,CAM_LOUD:.5,CAM_PUSH:.45,CAM_TAU:.35,PUSH_ATTACK:.08,PUSH_RELEASE:.6,
    PAN_RATE_X:.23,PAN_X:.05,PAN_X_LOUD:.2,PAN_RATE_Y:.17,PAN_PHASE_Y:1,PAN_Y:.04,PAN_Y_LOUD:.14,ROLL_SWAY:.25,ROLL_SWAY_RATE:.09,ROLL_RATE:.02,
    LEVEL_ATTACK:.048,LEVEL_RELEASE:.26,LOUD_ATTACK:.065,LOUD_RELEASE:.4,LOUD_LO:.33,LOUD_HI:.93,AGE_MAX:9,REFRACTORY:.12,BEAT_HOLD:2,
    EXPOSURE:1.47,VIGNETTE:.4,GRAIN:.035,HALATION:.25,BLOOM_THRESHOLD:.02,BLOOM_STRENGTH:.55,SPARK_COUNT:128,SPARK_GRID:48,SPARK_GRID_MIN:-2.4,SPARK_GRID_CELL:.1,SPARK_GRID_CAP:32,SPARK_GRID_MARGIN:.03,RENDER_SCALE:.67,FADE_SCALE:.5,PX_MIN:.5};
  assert.deepEqual(C,expected);assert.ok(Object.isFrozen(C));
  const col=r.get('WORLD_QUANTUM_COLORS');
  assert.deepEqual([...col.TEAL],['#1D5953','#266B61','#44A69B','#3B796E','#A3D3BE','#1A6287','#39A1B8','#93B0BA']);
  assert.deepEqual([...col.TEAL_BG],['#041104','#06150D','#071515','#08212A']);
  assert.deepEqual([...col.SHELL],['#72470B','#885206','#9F6105','#B87405','#D18D05','#CABBA5']);
  assert.deepEqual([...col.SUN],['#7B4402','#884B01','#935601','#9F6401','#AE7C01','#BE9715','#DBCC97']);
  assert.deepEqual([...col.SPARK],['#A33C09','#B95113','#D47228','#E89B51','#F9D289']);
  assert.deepEqual([...col.GOLDB],['#8C5522','#A56C2D','#C48939','#DCA954','#EDC67C']);
  assert.deepEqual([...col.STREAK],['#285668','#457688','#719FAD','#B3DEDA','#155792','#3785BE','#5FA0D2']);
  assert.deepEqual([...col.MINT],['#A7ECCD','#B3F0CF','#C1F0C4','#CAF3CE','#3A5148']);
  const lin3=r.get('WORLD_QUANTUM_COLORS_LINEAR');
  for(let i=0;i<3;i++){assert.ok(Math.abs(lin3.SPARK[4][i]-lin([0xF9,0xD2,0x89][i]/255))<1e-6);assert.ok(Math.abs(lin3.TEAL[0][i]-lin([0x1D,0x59,0x53][i]/255))<1e-6);}
  const shader=r.get('WORLD_QUANTUM_FRAGMENT');
  assert.ok(shader.startsWith('#version 300 es'));assert.ok(!shader.includes('${'));
  for(const fn of ['sceneDust(','sceneShell(','sceneSun(','sceneSparks(','sceneStreams(','sceneMint(','vec2 camera(','vec3 sceneOf(','vec3 particles('])assert.ok(shader.includes(fn),fn);
  assert.ok(!shader.includes('sceneRipples'));assert.ok(!shader.includes('WATER'));
  for(const u of ['uniform vec2 res','uniform float time','uniform int scene; uniform int sceneB; uniform float mixW','uniform float camZ; uniform float ts','#define QSCENE 0','vec3 sparkField(','uniform sampler2D sparkTex','uniform float camV; uniform vec2 camPan; uniform float camRoll','uniform vec4 lvl; uniform vec4 sm; uniform vec4 age; uniform float loud'])assert.ok(shader.includes(u),u);
  assert.match(shader,/const float EXPOSURE=1\.47000000;/);assert.match(shader,/const float VIGNETTE=0\.40000000;/);
  assert.ok(shader.includes('c*=1.-VIGNETTE*dot(ndc*.8,ndc*.8)')&&shader.includes('frag=vec4(min(c,vec3(60.))*EXPOSURE,1.)'));
  for(const n of ['TEAL[8]','TEAL_BG[4]','SHELL[6]','SUN[7]','SPARK[5]','GOLDB[5]','STREAK[7]','MINT[5]'])assert.ok(shader.includes('const vec3 '+n+'=vec3[]('),n);
  const types=r.get('WORLD_ANALYZER_TYPES');
  assert.deepEqual(types[4],{id:'g-quantum',label:'量子のビジョン',key:5,available:true});
  const a=new Analyzer();assert.equal(a.statelessRender,true);assert.equal(a.id,'g-quantum');assert.equal(a.label,'量子のビジョン');
  console.log('UW-Q-01 constants='+Object.keys(C).length);
});
test('UW-Q-02 予定表: 区間の kind ごとの場面・同じ場面は続けて並べない',()=>{
  assert.deepEqual(schedule([sec('intro',0,10)]),[[0,0]]);
  assert.deepEqual(schedule([sec('build',0,10),sec('main',10,20,1)]),[[0,4],[10,1]]);
  // drop の直前の build は最後の MINT_LEAD 秒がミント
  assert.deepEqual(schedule([sec('build',0,10),sec('drop',10,19)]),[[0,4],[10-C.MINT_LEAD,6],[10,1],[13,3],[16,2]]);
  assert.deepEqual(schedule([sec('drop',0,9)]),[[0,1],[3,3],[6,2]]);
  assert.deepEqual(schedule([sec('break',0,10)]),[[0,0],[5,4]]);
  assert.deepEqual(schedule([sec('main',0,10,1)]),[[0,1]]);
  assert.deepEqual(schedule([sec('main',0,10,2)]),[[0,2]]);
  assert.deepEqual(schedule([sec('main',0,10,3)]),[[0,1]]);
  assert.deepEqual(schedule([sec('outro',0,10)]),[[0,0]]);
  // 同じ場面は並べない: intro→outro は 0 のまま、drop の最後の 2 から main(偶数) の 2 へも続く
  assert.deepEqual(schedule([sec('intro',0,10),sec('outro',10,20)]),[[0,0]]);
  assert.deepEqual(schedule([sec('drop',0,9),sec('main',9,20,2)]),[[0,1],[3,3],[6,2]]);
  const sch=schedule([sec('intro',0,8),sec('build',8,16),sec('drop',16,28),sec('break',28,36),sec('main',36,48,1),sec('main',48,60,2),sec('outro',60,70)]);
  for(let i=1;i<sch.length;i++){assert.notEqual(sch[i][1],sch[i-1][1]);assert.ok(sch[i][0]>sch[i-1][0]);}
  // build が短く MINT_LEAD に満たないときはミントを入れない
  assert.deepEqual(schedule([sec('build',0,2),sec('drop',2,11)]),[[0,4],[2,1],[5,3],[8,2]]);
  // 予定表の配列は曲ごとに 1 回だけ確保する（step で作らない）
  const s=setup(['intro','build','drop']),a=s.analyzer;stepAt(s,0,0);const st=a.schedStart,sc=a.schedScene;
  stepAt(s,1,.016);stepAt(s,2,.016);assert.equal(a.schedStart,st);assert.equal(a.schedScene,sc);
  console.log('UW-Q-02 ok');
});
test('UW-Q-03 溶かし: 境目の FADE 秒前から w が 0→1 で連続し、境目で次の場面へ切り替わる',()=>{
  const s=setup(['build','drop'],10);stepAt(s,0,0);
  // build 0..10、ミントは 7 から。drop 10..20。境目は 7（4→6）と 10（6→1）
  let [a,b,w]=sceneOf(s,3);assert.deepEqual([a,b,w],[4,4,0]);
  [a,b,w]=sceneOf(s,7-C.FADE);assert.deepEqual([a,b,w],[4,4,0]);
  let prev=0;
  for(let t=7-C.FADE+.001;t<7;t+=.01){const [sa,sb,ww,ta,tb]=sceneOf(s,t);assert.equal(sa,4);assert.equal(sb,6);assert.ok(ww>=prev-1e-12&&ww<=1);prev=ww;
    const x=(t-(7-C.FADE))/C.FADE;assert.ok(Math.abs(ww-smooth(x))<1e-12);assert.ok(Math.abs(tb-(t-(7-C.FADE)))<1e-12);assert.ok(Math.abs(ta-t)<1e-12);}
  assert.ok(prev>.99);
  [a,b,w]=sceneOf(s,7);assert.equal(a,6);assert.equal(b,6);assert.equal(w,0);
  assert.ok(Math.abs(sceneOf(s,7)[3]-0)<1e-12); // 次の場面の tA は 0 から
  // 溶かし終わりの直前は w≈1 で次の場面が B、直後は A が次の場面で w=0（画面は連続）
  const before=sceneOf(s,7-1e-6);assert.equal(before[1],6);assert.ok(before[2]>1-1e-6);
  console.log('UW-Q-03 ok');
});
test('UW-Q-04 カメラ: camZ が単調増加・拍の押し出しと時定数・飛ばない',()=>{
  const s=setup(['main'],70),a=s.analyzer,dt=1/60;let prev=-1,mx=0,mn=1e9;
  for(let i=0;i<3600;i++){
    const t=i*dt;if(i%27===0)s.features.raw[L.BEAT_FLAG]=1;else s.features.raw[L.BEAT_FLAG]=0;
    s.features.raw[L.LEVEL]=.5+.4*Math.sin(t);
    const z0=a.camZ;stepAt(s,t,dt);const d=a.camZ-z0;
    assert.ok(a.camZ>prev);prev=a.camZ;
    if(i>120){mx=Math.max(mx,d);mn=Math.min(mn,d);}
  }
  assert.ok(mx/mn<10,'max/min='+mx/mn);
  // 静かなとき v は CAM_BASE へ収束する
  const q=setup(['main'],70);for(let i=0;i<600;i++)stepAt(q,i/60,1/60);assert.ok(Math.abs(q.analyzer.camV-C.CAM_BASE)<2e-3);
  // 拍の直後に v が増え、PUSH_RELEASE の時定数で push が戻る
  const p=setup(['main'],70),b=p.analyzer;for(let i=0;i<300;i++)stepAt(p,i/60,1/60);
  const v0=b.camV;p.features.raw[L.BEAT_FLAG]=1;stepAt(p,5,1/60);p.features.raw[L.BEAT_FLAG]=0;
  assert.ok(b.camV>v0&&b.push>0&&b.hit===1);
  const pk=b.push;stepAt(p,5+1/60,1/60);assert.equal(b.hit,0);
  assert.ok(Math.abs(b.push-pk*Math.exp(-(1/60)/C.PUSH_RELEASE))<1e-9);
  // パンと回転
  assert.ok(Math.abs(b.camRoll-(C.ROLL_SWAY*Math.sin((5+1/60)*C.ROLL_SWAY_RATE)+C.ROLL_RATE*(5+1/60)))<1e-12);
  assert.ok(Number.isFinite(b.panX)&&Number.isFinite(b.panY));
  // reset
  b.reset();assert.deepEqual([b.camZ,b.camV,b.push,b.panX,b.panY],[0,0,0,0,0]);
  console.log('UW-Q-04 maxmin='+(mx/mn).toFixed(2));
});
test('UW-Q-05 音の状態: 立ち上がり・二重カウントなし・時定数',()=>{
  const s=setup(['main']),a=s.analyzer;
  stepAt(s,1,0);assert.equal(a.age[0],C.AGE_MAX);
  s.features.raw[L.ONSET_FLAGS]=5; // 群 0 と 2
  stepAt(s,2,.016);assert.equal(a.age[0],0);assert.equal(a.age[1],C.AGE_MAX);assert.equal(a.age[2],0);assert.equal(a.hit,1);
  stepAt(s,2,.016);assert.equal(a.age[0],0); // 同じ t では増えない
  s.features.raw[L.ONSET_FLAGS]=8;stepAt(s,4,.016);assert.ok(Math.abs(a.age[0]-2)<1e-6);assert.equal(a.age[3],0);assert.equal(a.hit,0);
  s.features.raw[L.ONSET_FLAGS]=0;stepAt(s,20,.016);assert.equal(a.age[0],C.AGE_MAX);
  const s2=setup(['main']);setBands(s2.features,()=>.82);s2.features.raw[L.LEVEL]=1;
  stepAt(s2,0,.016);const lv=bandLevel(.82);
  assert.ok(Math.abs(s2.analyzer.sm[1]-lv*(1-Math.exp(-.016/C.LEVEL_ATTACK)))<1e-6);
  assert.ok(Math.abs(s2.analyzer.loud-(1-Math.exp(-.016/C.LOUD_ATTACK)))<1e-9);
  for(let i=1;i<200;i++)stepAt(s2,i*.016,.016);
  assert.ok(s2.analyzer.sm[0]>.99*lv&&s2.analyzer.loud>.99);
  const top=s2.analyzer.sm[2],topLoud=s2.analyzer.loud;setBands(s2.features,()=>0);s2.features.raw[L.LEVEL]=0;stepAt(s2,4,.016);
  assert.ok(Math.abs(s2.analyzer.sm[2]-top*Math.exp(-.016/C.LEVEL_RELEASE))<1e-6);
  assert.ok(Math.abs(s2.analyzer.loud-topLoud*Math.exp(-.016/C.LOUD_RELEASE))<1e-6);
  s2.analyzer.reset();assert.equal(s2.analyzer.loud,0);assert.deepEqual([...s2.analyzer.sm],[0,0,0,0]);assert.equal(s2.analyzer.age[0],C.AGE_MAX);
  console.log('UW-Q-05 ok');
});
test('UW-Q-06 拍と不応期と BEAT_HOLD: 拍で 4 群・同じ群は REFRACTORY 以内に数えない・拍の直後は帯域の立ち上がりを使わない',()=>{
  const s=setup(['main']),a=s.analyzer;
  // 拍（beatFlag）で、立ち上がりのビットがなくても 4 群すべてが立つ
  s.features.raw[L.BEAT_FLAG]=1;stepAt(s,10,.016);assert.deepEqual([...a.age],[0,0,0,0]);assert.equal(a.hit,1);
  // 拍から BEAT_HOLD 以内は帯域ごとの立ち上がりを無視する
  s.features.raw[L.BEAT_FLAG]=0;s.features.raw[L.ONSET_FLAGS]=15;stepAt(s,10.5,.016);assert.ok(Math.abs(a.age[0]-.5)<1e-6);assert.equal(a.hit,0);
  // BEAT_HOLD を超えたら帯域ごとの立ち上がりを使う
  stepAt(s,10+C.BEAT_HOLD+.5,.016);assert.equal(a.age[0],0);assert.equal(a.hit,1);
  // REFRACTORY
  const s2=setup(['main']),b=s2.analyzer;s2.features.raw[L.ONSET_FLAGS]=1;
  stepAt(s2,10,.016);assert.equal(b.age[0],0);
  stepAt(s2,10+C.REFRACTORY/2,.016);assert.ok(Math.abs(b.age[0]-C.REFRACTORY/2)<1e-6);assert.equal(b.hit,0);
  stepAt(s2,10+C.REFRACTORY+.001,.016);assert.equal(b.age[0],0);assert.equal(b.hit,1);
  console.log('UW-Q-06 ok');
});
test('UW-Q-07 preview: 拍で群 0・1、小節頭で群 2・3',()=>{
  const s=setup(['main']);s.engine.preview=true;s.engine.beatIndex=0;s.engine.score={seed:11,beats:[],downbeats:[2,6]};
  const a=s.analyzer;
  stepAt(s,1,.016);assert.deepEqual([...a.age],[C.AGE_MAX,C.AGE_MAX,C.AGE_MAX,C.AGE_MAX]);
  s.engine.beatIndex=1;stepAt(s,1.5,.016);assert.equal(a.age[0],0);assert.equal(a.age[1],0);assert.equal(a.age[2],C.AGE_MAX);assert.equal(a.hit,1);
  stepAt(s,2.5,.016);assert.equal(a.age[2],0);assert.equal(a.age[3],0);
  stepAt(s,3,.016);assert.ok(Math.abs(a.age[2]-.5)<1e-9);assert.ok(Math.abs(a.age[0]-1.5)<1e-9);
  assert.equal(a.schedCount,1); // 区間のない曲でも落ちない（場面 0 だけ）
  console.log('UW-Q-07 ok');
});
test('UW-Q-08 後処理: quantum 枝に grainFrame・ハレーション・粒子の定数があり、engine が grainFrame を渡す',()=>{
  const post=fs.readFileSync(new URL('../../js/world/post.js',import.meta.url),'utf8'),eng=fs.readFileSync(new URL('../../js/world/world-engine.js',import.meta.url),'utf8');
  const branch=post.slice(post.indexOf('if(quantumMode>.5)'),post.indexOf('if(gargantuaMode>.5)'));
  assert.ok(branch.includes('QUANTUM_HALATION')&&branch.includes('QUANTUM_GRAIN')&&branch.includes('grainFrame'));
  assert.ok(post.includes('uniform int grainFrame;')&&post.includes('WORLD_QUANTUM.HALATION')&&post.includes('WORLD_QUANTUM.GRAIN'));
  assert.ok(eng.includes('this.post.grainFrame = Math.round(this.latestSec * 60)'));
  console.log('UW-Q-08 ok');
});
test('UW-Q-09 キー 5 で量子のビジョンが選べる・UI 一覧に出る',()=>{
  const types=r.get('WORLD_ANALYZER_TYPES'),q=types.find(t=>t.key===5);
  assert.equal(q.id,'g-quantum');assert.equal(q.available,true);
  const reg=fs.readFileSync(new URL('../../js/renderer-registry.js',import.meta.url),'utf8');
  assert.ok(reg.includes("'g-quantum': {")&&reg.indexOf("'g-tesseract': {")<reg.indexOf("'g-quantum': {"));
  console.log('UW-Q-09 ok');
});
test('UW-Q GLモックで init/step/render が通り、stepで新しい配列を作らない・uniform を渡す',()=>{
  const {engine,gl,features}=realEngine(['intro','drop'],10),a=engine.type,g=engine.gpu;
  assert.equal(a.id,'g-quantum');
  const resources=[g.textures.length,g.fbos.length,g.programs.length];
  const count=p=>gl.calls.filter(c=>c.program===p).length;
  engine._step(0,features,0);assert.equal(a.programs.reduce((n,p)=>p?n+count(p.program):n,0),1);assert.equal(count(a.programs[0].program),1);
  const arrays=['lvl','sm','age','lastOn','schedStart','schedScene','bandUniforms'];
  const before=arrays.map(n=>a[n]);
  features.raw[L.ONSET_FLAGS]=5;engine._step(10/60,features,1/60);engine._step(11/60,features,1/60);engine._step(10.5,features,1/60);
  assert.ok(arrays.every((n,i)=>a[n]===before[i]),'配列を再確保しない');
  engine._draw();assert.equal(engine.post.quantum,true);assert.equal(engine.post.tesseract,false);
  assert.equal(engine.post.grainFrame,Math.round(engine.latestSec*60));
  assert.ok(gl.calls.some(c=>c.uniform===engine.post.thresholdLoc&&c.value===C.BLOOM_THRESHOLD));
  // 内部の描画先は出力の RENDER_SCALE 倍。拡大の program が出力へ描く
  assert.ok(gl.calls.some(c=>c.uniform&&c.uniform.name==='res'&&c.value[0]===Math.ceil(1280*C.RENDER_SCALE)&&c.value[1]===Math.ceil(720*C.RENDER_SCALE)));
  assert.ok(count(a.upsample)>=1);
  assert.ok(gl.calls.some(c=>c.uniform&&c.uniform.name==='time'));
  assert.equal(count(engine.post.exposureProgram),0);
  assert.deepEqual([g.textures.length,g.fbos.length,g.programs.length],resources);
  engine.dispose();console.log('UW-Q GL mock draws='+gl.calls.length);
});
