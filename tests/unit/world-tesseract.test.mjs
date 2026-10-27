// 目的 — テッセラクト v2 の定数・色・シェーダー・道・向き・音の状態・GPU命令を検査する — doc/20261027-design-tesseract-v2.md §9
import fs from 'node:fs';
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
  const engine=new(r.get('WorldEngine'))(canvas),score=scoreFor(kinds,duration);engine.selectType('g-tesseract',true);engine.setScore(score);
  return {engine,gl,features:new Feature()};
}

const hueOf=hex=>{
  const v=parseInt(hex.slice(1),16),R=(v>>16)/255,G=((v>>8)&255)/255,B=(v&255)/255,mx=Math.max(R,G,B),mn=Math.min(R,G,B),d=mx-mn;
  let h=mx===R?((G-B)/d)%6:mx===G?(B-R)/d+2:(R-G)/d+4;h*=60;return h<0?h+360:h;
};
const bandLevel=raw=>Math.pow(Math.max(0,Math.min(1,(raw-.12)/.7)),.8);
function setBands(features,fn){for(let i=0;i<32;i++)features.raw[L.BANDS_SMOOTH+i]=fn(i);}
function stepAt(s,t,dt){s.input.tSec=t;s.input.dt=dt;s.analyzer.step(s.input);}

test('UW-T-01 定数・色・シェーダー本文・登録',()=>{
  const expected={FOV:80,SPEED_BASE:6,SPEED_LOUD:9,SPEED_SCALE:.8,CORNER:.9,LOOK_STEPS:8,LOOK_STEP:2,BANK_NEAR:6,BANK_FAR:16,BANK_GAIN:1.1,
    ROLL_RATE:.28,ROLL_SWAY:.6,ROLL_SWAY_RATE:.36,SWAY_RATE_X:.72,SWAY_X:.35,SWAY_RATE_Y:.56,SWAY_Y:.28,SWAY_PHASE_Y:1.3,SWAY_RATE_Z:.4,SWAY_Z:.2,SWAY_PHASE_Z:2.1,
    PATH_NODES:4096,LEVEL_ATTACK:.048,LEVEL_RELEASE:.26,LOUD_ATTACK:.065,LOUD_RELEASE:.4,LOUD_LO:0,LOUD_HI:1,ENERGY_TAU:.54,CENTROID_TAU:1.09,
    PHASE_BASE:.015,PHASE_GAIN:.12,PHASE_RATE:4,PHASE_TIMBRE:.6,AGE_MAX:9,EXPOSURE:1.4,VIGNETTE:.35,BLOOM_THRESHOLD:.05,BLOOM_STRENGTH:.7};
  assert.deepEqual(C,expected);assert.ok(Object.isFrozen(C));
  const col=r.get('WORLD_TESSERACT_COLORS');
  assert.deepEqual([...col.WOOD],['#2D1C15','#493225','#5C4739','#695241','#77634F','#8F7B63']);
  assert.deepEqual([...col.BOOK],['#6B4A2C','#89612B','#806A66','#9E8785','#7A6D30','#938C47','#566B67','#B1B15F']);
  assert.deepEqual([...col.SILVER],['#8C8473','#A49A89','#B9B1A3','#CECBC7']);
  assert.deepEqual([...col.AMB],['#E07E34','#89612B','#8B6250','#6B4A2C','#C98A4B']);
  assert.deepEqual([...col.GLD],['#D4AF37','#CFB53B','#DAA520','#B8860B','#E6BE8A']);
  for(const hex of [...col.AMB,...col.GLD]){const h=hueOf(hex);assert.ok(h>=15&&h<=55,hex+' hue='+h);}
  const lin3=r.get('WORLD_TESSERACT_COLORS_LINEAR');
  for(let i=0;i<3;i++)assert.ok(Math.abs(lin3.GLD[0][i]-lin([0xD4,0xAF,0x37][i]/255))<1e-6);
  const shader=r.get('WORLD_TESSERACT_FRAGMENT');
  assert.ok(shader.startsWith('#version 300 es'));
  for(const fn of ['void beam(','Hit trace(','vec3 shade(','float flash1(','vec3 palCol(','float beamLight(','int mat(','float flash(','bool hasB('])assert.ok(shader.includes(fn),fn);
  for(const u of ['uniform vec2 resolution','uniform float tSec, tanH, pxk','uniform vec3 camPos','uniform mat3 camRot','uniform vec4 lvl, sm, age, age2, cnt','uniform float loud, phase'])assert.ok(shader.includes(u),u);
  assert.ok(!shader.includes('${'));assert.match(shader,/const float EXPOSURE=1\.40000000;/);assert.match(shader,/const float VIGNETTE=0\.35000000;/);
  assert.equal((shader.match(/vec3\(/g)||[]).length>=28,true);
  const types=r.get('WORLD_ANALYZER_TYPES');
  assert.deepEqual(types[3],{id:'g-tesseract',label:'テッセラクト',key:4,available:true});
  const a=new Analyzer();assert.equal(a.statelessRender,true);assert.equal(a.id,'g-tesseract');assert.equal(a.label,'テッセラクト');
  console.log('UW-T-01 constants='+Object.keys(C).length);
});
test('UW-T-02 道: 同じ種で同じ折れ点・4の倍数+2・隣は1軸だけ4〜12・at()の連続',()=>{
  const a=new Analyzer(),b=new Analyzer(),d=new Analyzer(),N=C.PATH_NODES;
  a._buildPath(11);b._buildPath(11);d._buildPath(12);
  assert.deepEqual(a.pathNodes,b.pathNodes);assert.notDeepEqual(a.pathNodes,d.pathNodes);
  assert.deepEqual([...a.pathNodes.slice(0,3)],[2,2,2]);assert.equal(a.pathAxis[0],2);assert.equal(a.pathSign[0],1);
  for(let k=0;k<N;k++)for(let i=0;i<3;i++)assert.equal(Math.abs((a.pathNodes[k*3+i]-2)%4),0);
  for(let k=0;k<N-1;k++){
    const diff=[0,1,2].map(i=>Math.abs(a.pathNodes[(k+1)*3+i]-a.pathNodes[k*3+i]));
    assert.equal(diff.filter(v=>v>0).length,1);const m=Math.max(...diff);assert.ok(m>=4&&m<=12);
    assert.equal(a.pathCum[k+1]-a.pathCum[k],m);
    if(k>0)assert.notEqual(a.pathAxis[k],a.pathAxis[k-1]);
  }
  const p=new Float64Array(3),q=new Float64Array(3);let maxJump=0;
  for(let s=0;s<400;s+=.01){a.at(s,p);a.at(s+.01,q);maxJump=Math.max(maxJump,Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]));}
  assert.ok(maxJump<=.02,'maxJump='+maxJump);
  // 区間の境目と角の前後
  for(let k=1;k<30;k++){const s=a.pathCum[k];for(const off of [-C.CORNER-.005,-.005,0,.005,C.CORNER-.005]){
    a.at(s+off,p);a.at(s+off+.01,q);assert.ok(Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2])<=.02);}}
  console.log('UW-T-02 maxStep='+maxJump.toFixed(5));
});
test('UW-T-03 向き: 60秒で飛びがなく up と f が直交',()=>{
  const s=setup(['main'],70),dt=1/60;let maxAng=0,maxDot=0;
  const pf=new Float64Array(3),pu=new Float64Array(3);
  for(let i=0;i<3600;i++){
    stepAt(s,i*dt,dt);const a=s.analyzer,f=a.fwd,u=a.up;
    if(i>0){
      const cf=Math.max(-1,Math.min(1,f[0]*pf[0]+f[1]*pf[1]+f[2]*pf[2])),cu=Math.max(-1,Math.min(1,u[0]*pu[0]+u[1]*pu[1]+u[2]*pu[2]));
      maxAng=Math.max(maxAng,Math.acos(cf),Math.acos(cu));
    }
    maxDot=Math.max(maxDot,Math.abs(f[0]*u[0]+f[1]*u[1]+f[2]*u[2]));
    pf.set(f);pu.set(u);
  }
  assert.ok(maxAng<.35,'maxAng='+maxAng);assert.ok(maxDot<1e-6,'maxDot='+maxDot);
  const m=s.analyzer.camRot,dot=(i,j)=>m[i*3]*m[j*3]+m[i*3+1]*m[j*3+1]+m[i*3+2]*m[j*3+2];
  for(let i=0;i<3;i++){assert.ok(Math.abs(dot(i,i)-1)<1e-5);for(let j=i+1;j<3;j++)assert.ok(Math.abs(dot(i,j))<1e-5);}
  // 前進: 静かなときの速さ = SPEED_SCALE*SPEED_BASE
  const q=setup(['main']);stepAt(q,0,0);stepAt(q,1,1);assert.ok(Math.abs(q.analyzer.s-C.SPEED_SCALE*C.SPEED_BASE)<1e-9);
  console.log('UW-T-03 maxAngle='+maxAng.toFixed(4));
});
test('UW-T-04 音の状態: 立ち上がり・二重カウントなし・時定数・phase 単調増加',()=>{
  const s=setup(['main']),a=s.analyzer;
  stepAt(s,1,0);assert.deepEqual([...a.cnt],[0,0,0,0]);assert.equal(a.age[0],C.AGE_MAX);
  s.features.raw[L.ONSET_FLAGS]=5; // 群 0 と 2
  stepAt(s,2,.016);assert.deepEqual([...a.cnt],[1,0,1,0]);assert.equal(a.age[0],0);assert.equal(a.age2[0],C.AGE_MAX);
  stepAt(s,2,.016);assert.deepEqual([...a.cnt],[1,0,1,0]); // 同じ t では増えない
  s.features.raw[L.ONSET_FLAGS]=1;stepAt(s,3,.016);assert.equal(a.cnt[0],2);assert.equal(a.age[0],0);assert.equal(a.age2[0],1);
  s.features.raw[L.ONSET_FLAGS]=8;stepAt(s,4,.016);assert.equal(a.cnt[3],1);assert.ok(Math.abs(a.age[0]-1)<1e-6);
  s.features.raw[L.ONSET_FLAGS]=0;stepAt(s,20,.016);assert.equal(a.age[0],C.AGE_MAX);
  // sm と loud の時定数
  const s2=setup(['main']);setBands(s2.features,()=>.82);s2.features.raw[L.LEVEL]=1;
  stepAt(s2,0,.016);const lv=bandLevel(.82);
  assert.ok(Math.abs(s2.analyzer.sm[1]-lv*(1-Math.exp(-.016/C.LEVEL_ATTACK)))<1e-6);
  assert.ok(Math.abs(s2.analyzer.loud-(1-Math.exp(-.016/C.LOUD_ATTACK)))<1e-9);
  for(let i=1;i<200;i++)stepAt(s2,i*.016,.016);
  assert.ok(s2.analyzer.sm[0]>.99*lv&&s2.analyzer.loud>.99);
  const top=s2.analyzer.sm[2],topLoud=s2.analyzer.loud;setBands(s2.features,()=>0);s2.features.raw[L.LEVEL]=0;
  stepAt(s2,4,.016);
  assert.ok(Math.abs(s2.analyzer.sm[2]-top*Math.exp(-.016/C.LEVEL_RELEASE))<1e-6);
  assert.ok(Math.abs(s2.analyzer.loud-topLoud*Math.exp(-.016/C.LOUD_RELEASE))<1e-6);
  // phaseAcc は単調増加
  let prev=-1;const s3=setup(['main']);for(let i=0;i<100;i++){setBands(s3.features,()=>i%7*.1);stepAt(s3,i*.016,.016);assert.ok(s3.analyzer.phaseAcc>prev);prev=s3.analyzer.phaseAcc;}
  // reset
  s2.analyzer.reset();assert.equal(s2.analyzer.loud,0);assert.deepEqual([...s2.analyzer.sm],[0,0,0,0]);assert.equal(s2.analyzer.cen,1.5);assert.equal(s2.analyzer.phaseAcc,0);assert.deepEqual([...s2.analyzer.cnt],[0,0,0,0]);
  console.log('UW-T-04 ok');
});
test('UW-T-05 preview: 拍で群 0・1、小節頭で群 2・3',()=>{
  const s=setup(['main']);s.engine.preview=true;s.engine.beatIndex=0;s.engine.score={seed:11,beats:[],downbeats:[2,6]};
  const a=s.analyzer;stepAt(s,1,.016);assert.deepEqual([...a.cnt],[0,0,0,0]);
  s.engine.beatIndex=1;stepAt(s,1.5,.016);assert.deepEqual([...a.cnt],[1,1,0,0]);assert.equal(a.age[0],0);
  stepAt(s,2,.016);assert.deepEqual([...a.cnt],[1,1,1,1]);
  stepAt(s,2.5,.016);assert.deepEqual([...a.cnt],[1,1,1,1]);
  s.engine.beatIndex=2;stepAt(s,3,.016);assert.deepEqual([...a.cnt],[2,2,1,1]);
  console.log('UW-T-05 ok');
});
test('UW-T-06 量子のビジョンは available:false・UI 一覧に出ない',()=>{
  const types=r.get('WORLD_ANALYZER_TYPES');
  assert.deepEqual(types.find(t=>t.id==='g-quantum'),{id:'g-quantum',label:'量子のビジョン',key:5,available:false});
  assert.equal(types.filter(t=>t.available).length,4);
  const reg=fs.readFileSync(new URL('../../js/renderer-registry.js',import.meta.url),'utf8');
  assert.ok(!reg.includes("'g-quantum': {"));assert.ok(reg.includes("'g-tesseract': {"));
  console.log('UW-T-06 ok');
});
test('UW-T GLモックで init/step/render が通り、stepで新しい配列を作らない',()=>{
  const {engine,gl,features}=realEngine(['intro','drop'],10),a=engine.type,g=engine.gpu;
  assert.equal(a.id,'g-tesseract');
  const resources=[g.textures.length,g.fbos.length,g.programs.length];
  const count=p=>gl.calls.filter(c=>c.program===p).length;
  engine._step(0,features,0);assert.equal(count(a.program),1);
  const arrays=['camPos','camRot','lvl','sm','age','age2','cnt','up','fwd','pathNodes','pathCum','bandUniforms'];
  const before=arrays.map(n=>a[n]);
  features.raw[L.ONSET_FLAGS]=5;engine._step(10/60,features,1/60);engine._step(11/60,features,1/60);engine._step(10.5,features,1/60);
  assert.ok(arrays.every((n,i)=>a[n]===before[i]),'配列を再確保しない');
  engine._draw();assert.equal(engine.post.tesseract,true);assert.equal(engine.post.attractor,false);
  assert.ok(gl.calls.some(c=>c.uniform===engine.post.thresholdLoc&&c.value===C.BLOOM_THRESHOLD));
  assert.equal(count(engine.post.exposureProgram),0);
  assert.deepEqual([g.textures.length,g.fbos.length,g.programs.length],resources);
  engine.dispose();console.log('UW-T GL mock draws='+gl.calls.length);
});
