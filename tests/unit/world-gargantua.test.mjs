// 目的 — WORLD-13のカメラ表・オンセット寿命・帯域/測定契約と再演を検査する — doc/20261004-design-gargantua-v1.md §1〜6
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
  const expected={intro:[40,26,4,4,.010,.010,.6,.6],build:[26,18,4,9,.020,.05,.8,1.1],drop:[15,15,7,7,.07,.07,1.35,1.35],break:[30,30,14,14,.012,.012,.7,.7],outro:[26,60,4,4,.008,.008,.9,0],main:[22,22,6,6,.03,.03,1,1]};
  const table=runtime.get('WORLD_GARGANTUA_CAMERA');assert.equal(JSON.stringify(table),JSON.stringify(expected));
  for(const kind of Object.keys(expected)){
    const {input,analyzer}=setup([kind]);input.tSec=5;analyzer.step(input);const row=expected[kind];
    assert.ok(Math.abs(analyzer.camera[0]-(row[0]+row[1])*.5)<1e-6);
    assert.ok(Math.abs(analyzer.camera[1]-(row[2]+row[3])*.5*Math.PI/180)<1e-7);
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
