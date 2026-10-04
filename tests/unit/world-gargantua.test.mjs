// 目的 — WORLD-13のカメラ表・オンセット寿命・帯域/測定契約と再演を検査する — doc/20261004-design-gargantua-v1.md §1〜7
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';
const runtime=loadClassic(['js/vis-utils.js','js/mfs-const.js','js/mfs-view.js','js/world/gl-util.js','js/world/score.js','js/world/analyzer-types.js','js/world/g-gargantua.js']);
const C=runtime.get('WORLD_GARGANTUA'),Analyzer=runtime.get('WorldGargantuaAnalyzer'),Feature=runtime.get('MfsFrameView'),layout=runtime.get('MFS_LAYOUT');
function setup(kinds=['main'],duration=10) {
  const score=runtime.get('compileWorldScore')({bpm:120,durationSec:kinds.length*duration,beats:[],downbeatIndices:[],sections:kinds.map((kind,i)=>({kind,label:'A',startSec:i*duration,endSec:(i+1)*duration}))},11);
  const f=new Feature(),engine={score,sectionIndex:0,seed:11,gpu:{uniforms:new Float32Array(244)},preview:false};
  const input={engine,song:score.song,features:f,dt:0,tSec:0},analyzer=new Analyzer();
  return {score,f,engine,input,analyzer};
}
test('UW-48 WORLD-13 カメラ全6kind表・4秒ease・同labelの第二drop・パレット20%の定数',()=>{
  const expected={intro:[40,26,2,2,.010,.010,.6,.6],build:[26,18,2,18,.020,.05,.8,1.1],drop:[15,15,4,4,.07,.07,1.35,1.35],break:[30,30,28,28,.012,.012,.7,.7],outro:[26,60,8,8,.008,.008,.9,0],main:[22,22,6,6,.03,.03,1,1]};
  const table=runtime.get('WORLD_GARGANTUA_CAMERA');assert.equal(JSON.stringify(table),JSON.stringify(expected));
  for(const kind of Object.keys(expected)){
    const {input,analyzer}=setup([kind]);input.tSec=5;analyzer.step(input);const row=expected[kind];
    assert.ok(Math.abs(analyzer.camera[0]-(row[0]+row[1])*.5)<1e-6);
    assert.ok(Math.abs(analyzer.camera[1]-((row[2]+row[3])*.5+3*Math.sin(5*.07))*Math.PI/180)<1e-7);
    assert.ok(Math.abs(analyzer.orbitSpeed-(row[4]+row[5])*.5)<1e-12);
    assert.ok(Math.abs(analyzer.camera[3]-(row[6]+row[7])*.5)<1e-6);
  }
  const {input,engine,analyzer}=setup(['main','drop','break','drop']);analyzer.step(input);
  engine.sectionIndex=1;input.tSec=10;analyzer.step(input);assert.equal(analyzer.camera[0],22);
  input.tSec=12;analyzer.step(input);assert.equal(analyzer.camera[0],18.5);
  input.tSec=14;analyzer.step(input);assert.equal(analyzer.camera[0],15);
  engine.sectionIndex=2;input.tSec=24;analyzer.step(input);
  engine.sectionIndex=3;input.tSec=34;analyzer.step(input);assert.equal(analyzer.camera[0],13);assert.equal(analyzer.orbitSpeed,.09);
  assert.ok(Math.abs(analyzer.camera[3]-1.35*1.5)<1e-6);assert.equal(C.CAMERA_EASE_SECONDS,4);assert.equal(C.PALETTE_TINT,.2);
  assert.equal(C.MAX_STEPS,180);assert.equal(C.BLOOM_THRESHOLD,1);assert.equal(C.BLOOM_STRENGTH,.35);
  console.log('UW-48 cameraKinds=6 easeMidpointDist=18.5 secondDropDist=13 speed=.09 brightness=2.025 maxSteps=180');
});
test('UW-49 WORLD-13 キックexp(-age/.11)・高域pool12/寿命6秒・連続イベント・無拍反応・再演',()=>{
  const {input,f,analyzer}=setup();f.raw[layout.LEVEL]=.5;analyzer.step(input);
  assert.ok(Math.abs(analyzer.exposureMultiplier-1)<1e-12);
  input.tSec=1;f.raw[layout.ONSET_FLAGS]=5;analyzer.step(input);assert.equal(analyzer.music[0],1);assert.equal(analyzer.hotspotSerial,1);assert.equal(analyzer.highOnsetPhase,1);
  const spots=analyzer.hotspots.slice();analyzer.step(input);assert.deepEqual(analyzer.hotspots,spots);
  input.tSec=1.01;analyzer.step(input);assert.equal(analyzer.hotspotSerial,2,'MFSの連続フレームのbitは別イベント');
  assert.equal(analyzer.music[0],1,'連続低域オンセットも包絡を再開する');
  f.raw[layout.ONSET_FLAGS]=0;input.tSec=1.11;analyzer.step(input);assert.ok(Math.abs(analyzer.music[0]-Math.exp(-.1/.11))<1e-7);
  const kick=analyzer.music[0];f.raw[layout.BEAT_FLAG]=1;f.raw[layout.DOWNBEAT_FLAG]=1;analyzer.step(input);assert.equal(analyzer.music[0],kick);
  for(let i=1;i<14;i++){f.raw[layout.ONSET_FLAGS]=0;input.tSec=1+i*.2;analyzer.step(input);f.raw[layout.ONSET_FLAGS]=4;input.tSec+=.1;analyzer.step(input);}
  assert.equal(analyzer.hotspots.length/4,12);assert.equal(analyzer.hotspotSerial,15);assert.equal(analyzer.highOnsetPhase,15);
  for(let i=0;i<12;i++){assert.ok(analyzer.hotspots[i*4]>=3.5&&analyzer.hotspots[i*4]<=8);assert.ok(analyzer.hotspots[i*4+1]>=0&&analyzer.hotspots[i*4+1]<2*Math.PI);}
  analyzer.reset();input.tSec=1;f.raw[layout.ONSET_FLAGS]=5;analyzer.step(input);assert.deepEqual(analyzer.hotspots,spots);
  assert.equal(C.HOTSPOT_SECONDS,6);assert.equal(C.HOTSPOT_RADIUS,.18);assert.equal(C.HOTSPOT_HDR,6);
  console.log('UW-49 kick100ms='+kick+' hotspotCapacity=12 events=15 lifetime=6 onsetReplayError=0 consecutiveOnsets=2 exposure=.85+.3*.5=1');
});
test('UW-51 WORLD-13 数値イベントhash: 旧worldHashと一致・seed差・桁境界',()=>{
  const hash=runtime.get('worldGargantuaEventHash'),reference=runtime.get('worldHash');
  let cases=0;
  for(const seed of [0,11,4294967295])for(const serial of [0,1,9,10,99,100,999,1000,123456,4294967295])for(const prefix of ['gargantua:','gargantua-angle:']){
    assert.equal(hash(prefix,serial,seed),reference(prefix+serial,seed));cases++;
  }
  assert.notEqual(hash('gargantua:',0,11),hash('gargantua:',0,12));
  console.log('UW-51 numericHashCases='+cases+' oldPositionHashError=0');
});
test('UW-50 WORLD-13 直接像の32環: 外側低域・高次像除外・G-1中央値/空領域拒否・キック40%',()=>{
  const r=loadClassic(['tests/browser/world13.test.js']),sample=r.get('world13AnnulusSamples'),report=r.get('world13CorrelationReport'),kick=r.get('world13KickReport');
  const pixels=new Float32Array(64*4),rgba=new Uint8Array(64*4);
  for(let k=0;k<32;k++){pixels[k*8]=.04+k*.005;pixels[k*8+3]=3+(k+.5)/32*11;rgba[k*8]=Math.round(40+k*5);rgba[k*8+3]=255;}
  const values=sample(pixels,64,1,{width:64,height:1,rgba});assert.deepEqual(Array.from(values.counts),new Array(32).fill(1));
  assert.ok(values.luminance[0]>values.luminance[31]);pixels[3]=0;
  assert.equal(sample(pixels,64,1,{width:64,height:1,rgba}).counts[31],0);
  const rows=Array.from({length:8},(_,n)=>({levels:Array.from({length:32},(_,i)=>(n+i)%7),luminance:Array.from({length:32},(_,i)=>2*((n+i)%7)),counts:new Array(32).fill(1)}));
  const correlated=report(rows);assert.equal(correlated.median,1);assert.equal(correlated.pass,true);
  rows[0].counts.fill(0);rows.forEach(row=>row.levels.fill(1));assert.equal(report(rows).pass,false);
  const before=Array.from({length:6},()=>({inner:.1,innerHDR:1,innerCount:32})),after=Array.from({length:6},()=>({inner:.141,innerHDR:1.41,innerCount:32}));
  const result=kick(before,after,after[0]);assert.equal(result.pass,true);assert.ok(Math.abs(result.increase-.41)<1e-12);
  assert.ok(Math.abs(result.at100msIncrease-.41)<1e-12);
  assert.equal(kick(before,after,{innerHDR:1.39,innerCount:32}).pass,false,'age=.1も40%を満たす');
  assert.equal(kick(before,after).pass,false,'100ms実標本なしを合格にしない');
  after.forEach(row=>row.innerHDR=1.39);assert.equal(kick(before,after,after[0]).pass,false);assert.equal(kick([],after,after[0]).pass,false);
  console.log('UW-50 annuli=32 directROIExcluded=1 outerBand=0 innerBand=31 PearsonMedian=1 constantRejected=true kickSyntheticIncrease=.41');
});

test('UW-52 WORLD-14 重力の1.2秒/2秒ease・地平面/ISCO・第二drop負角・揺れの重複なし・reset再演',()=>{
  const {input,engine,analyzer}=setup(['main','drop','break','drop']);
  analyzer.step(input);engine.sectionIndex=1;input.tSec=10;analyzer.step(input);
  assert.equal(analyzer.gravityAmount,0);input.tSec=10.6;analyzer.step(input);
  assert.ok(Math.abs(analyzer.gravityAmount-.5)<1e-12);
  assert.ok(Math.abs(analyzer.gravity[0]-1.8)<1e-6);assert.ok(Math.abs(analyzer.gravity[1]-1.09)<1e-6);assert.ok(Math.abs(analyzer.gravity[2]-3.2)<1e-6);
  input.tSec=11.2;analyzer.step(input);assert.ok(Math.abs(analyzer.gravityAmount-1)<1e-12);
  assert.ok(Math.abs(analyzer.gravity[0]-2.1)<1e-6);assert.ok(Math.abs(analyzer.gravity[1]-1.18)<1e-6);assert.ok(Math.abs(analyzer.gravity[2]-3.4)<1e-6);
  input.tSec=19.99;analyzer.step(input);const inclination=analyzer.baseInclination;
  engine.sectionIndex=2;input.tSec=20;analyzer.step(input);assert.equal(analyzer.baseInclination,inclination);
  assert.ok(Math.abs(analyzer.camera[1]-(inclination+3*Math.PI/180*Math.sin(20*.07)))<1e-7);
  assert.equal(analyzer.gravityAmount,1);input.tSec=21;analyzer.step(input);assert.equal(analyzer.gravityAmount,.5);
  input.tSec=22;analyzer.step(input);assert.equal(analyzer.gravityAmount,0);
  input.tSec=24;analyzer.step(input);assert.ok(Math.abs(analyzer.baseInclination-28*Math.PI/180)<1e-12);
  engine.sectionIndex=3;input.tSec=34;analyzer.step(input);
  assert.ok(Math.abs(analyzer.baseInclination+10*Math.PI/180)<1e-12);
  const gravity=analyzer.gravity.slice(),camera=analyzer.camera.slice();
  analyzer.reset();engine.sectionIndex=3;input.tSec=34;analyzer.step(input);
  assert.deepEqual(analyzer.gravity,gravity);assert.deepEqual(analyzer.camera,camera);
  assert.equal(C.KEPLER_SPEED,1.35);assert.equal(C.DISK_LAYER_A_SPEED,3);assert.equal(C.DISK_LAYER_B_SPEED,4.2);
  assert.equal(C.DISK_LAYER_B_SCALE,1.7);assert.equal(C.DISK_LAYER_B_PHASE,2.1);assert.equal(C.DISK_LAYER_HEIGHT,.035);assert.equal(C.DISK_LAYER_OPACITY,.6);
  assert.equal(C.FILAMENT_POWER,3);assert.equal(C.FILAMENT_GAIN,2.2);assert.equal(C.FILAMENT_BASE,.08);assert.equal(C.DISK_INTENSITY,.55);assert.equal(C.KICK_GAIN,2.6);
  assert.equal(C.RING_SAMPLE_MIN,1.3);assert.equal(C.RING_SAMPLE_MAX,3.2);
  assert.equal(C.STAR_PROBABILITY,.05);assert.equal(C.STAR_POWER,10);assert.equal(C.STAR_HDR,9);assert.equal(C.STAR_CORE_MAX,.6);
  assert.equal(C.STAR_RADIUS_MIN_PX,1.2);assert.equal(C.STAR_RADIUS_MAX_PX,2.6);assert.equal(C.STAR_HALO_RADIUS,3);assert.equal(C.STAR_HALO_GAIN,.15);
  assert.equal(C.SPIKE_FRACTION,.02);assert.equal(C.SPIKE_LENGTH_MIN_PX,10);assert.equal(C.SPIKE_LENGTH_MAX_PX,18);assert.equal(C.SPIKE_WIDTH_PX,1);
  assert.equal(C.MILKY_WAY_MAX,.035);assert.equal(C.MILKY_WAY_OCTAVES,5);
  console.log('UW-52 surgeMidpoint=[1.8,1.09,3.2] surgePeak=[2.1,1.18,3.4] easeIn=1.2 easeOut=2 secondDropInc=-10 replayError=0');
});
test('UW-53 WORLD-14 画面判定: 輝度.97の白飛び8%境界・HDRのみ増光を拒否・星の実画素サイズ',()=>{
  const r=loadClassic(['tests/browser/world14.test.js']),exposure=r.get('world14ExposureReport'),kick=r.get('world14KickReport'),stars=r.get('world14StarReport');
  const capture={width:100,height:1,rgba:new Uint8Array(400)};
  for(let i=0;i<8;i++)capture.rgba.fill(255,i*4,i*4+3);
  assert.equal(exposure(capture).fraction,.08);assert.equal(exposure(capture).pass,true);
  capture.rgba[8*4+1]=255;capture.rgba[8*4]=255;capture.rgba[8*4+2]=200;
  assert.equal(exposure(capture).fraction,.09);assert.equal(exposure(capture).pass,false,'輝度≥.97、全RGB≥250ではない');
  const before=Array.from({length:6},()=>({inner:.2,innerHDR:1,innerCount:10}));
  const after=Array.from({length:6},()=>({inner:.272,innerHDR:1,innerCount:10}));
  assert.equal(kick(before,after,after[0]).pass,true);
  const display=kick(before,after,after[0]);assert.ok(Math.abs(display.increase-.36)<1e-12);
  assert.equal(kick(before,after).pass,false);assert.equal(kick(before,after,{inner:.26,innerCount:10}).pass,false);
  after.forEach(row=>{row.inner=.2;row.innerHDR=2;});assert.equal(kick(before,after,after[0]).pass,false,'HDR2倍でも画面増光0は不合格');
  const c={width:1920,height:1080,rgba:new Uint8Array(1920*1080*4)},geometry={width:1920,height:1080,pixels:new Float32Array(1920*1080*4)};
  const put=(x,y,background)=>{const o=(y*c.width+x)*4;c.rgba.fill(150,o,o+3);geometry.pixels[o+3]=background;};
  put(10,10,1);for(const x of [20,21])for(const y of [20,21])put(x,y,1);
  for(const x of [30,31])for(const y of [30,31])put(x,y,0);
  const report=stars(c,geometry);assert.equal(report.visible,1);assert.equal(report.components,2);
  assert.ok(Math.abs(report.meanDiameterPx-4/Math.sqrt(Math.PI))<1e-12);
  console.log('UW-53 whiteBoundary=.08 whiteRejected=.09 displayKick=.36 hdrOnlyRejected=true visibleStarsSynthetic=1 diameter='+report.meanDiameterPx);
});
test('UW-54 WORLD-14 継ぎ目4画素の実φ折り返し・周囲2倍境界・平均星400個・空測定拒否',()=>{
  const r=loadClassic(['tests/browser/world14.test.js']),seam=r.get('world14SeamReport'),accept=r.get('world14AcceptanceReport');
  const w=64,c={width:w,height:1,rgba:new Uint8Array(w*4)},g={width:w,height:1,pixels:new Float32Array(w*4)};
  for(let x=0;x<w;x++){c.rgba.fill(x*3,x*4,x*4+3);g.pixels[x*4]=6;g.pixels[x*4+1]=x<32?3.13:-3.13;}
  const continuous=seam(c,g);assert.equal(continuous.samples,1);assert.ok(Math.abs(continuous.ratio-1)<1e-12);assert.equal(continuous.pass,true);
  for(let x=32;x<w;x++)c.rgba.fill(x*3+60,x*4,x*4+3);
  const broken=seam(c,g);assert.ok(broken.ratio>2);assert.equal(broken.pass,false);
  g.pixels.fill(0);assert.equal(seam(c,g).pass,false);
  const shots=[399,401].map(visible=>({typeId:'g-gargantua',records:[{exposure:{fraction:.08,pass:true}}],v11:{exposure:{pass:true},stars:{visible}}}));
  const result=accept(shots,[continuous,continuous],{pass:true},{pass:true});assert.equal(result.stars.meanVisible,400);assert.equal(result.pass,true);
  shots[0].records[0].exposure={fraction:.081,pass:false};assert.equal(accept(shots,[continuous,continuous],{pass:true},{pass:true}).pass,false);
  assert.equal(accept([],[],{pass:true},{pass:true}).pass,false);
  console.log('UW-54 continuousSeamRatio='+continuous.ratio+' brokenSeamRatio='+broken.ratio+' meanStars=400 missingSamplesRejected=true');
});
