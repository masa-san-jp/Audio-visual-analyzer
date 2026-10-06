// 目的 — WORLD-17のカメラ表・平面円盤・色/縞/星/フレアと再演を検査する — doc/20261004-design-gargantua-v1.md §10
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
test('UW-48 WORLD-17 カメラ全6kind表・4秒ease・同labelの第二drop・パレット15%の定数',()=>{
  const expected={intro:[34,22,2,2,.010,.010,.6,.6],build:[24,16,2,18,.020,.05,.8,1.1],drop:[15,15,4,4,.07,.07,1.35,1.35],break:[22,22,28,28,.012,.012,.7,.7],outro:[20,60,8,8,.008,.008,.9,0],main:[17,17,6,6,.03,.03,1,1]};
  const table=runtime.get('WORLD_GARGANTUA_CAMERA');assert.equal(JSON.stringify(table),JSON.stringify(expected));
  for(const kind of Object.keys(expected)){
    const {input,analyzer}=setup([kind]);input.tSec=5;analyzer.step(input);const row=expected[kind];
    assert.ok(Math.abs(analyzer.camera[0]-(row[0]+row[1])*.5)<1e-6);
    assert.ok(Math.abs(analyzer.camera[1]-((row[2]+row[3])*.5+3*Math.sin(5*.07))*Math.PI/180)<1e-7);
    assert.ok(Math.abs(analyzer.orbitSpeed-(row[4]+row[5])*.5)<1e-12);
    assert.ok(Math.abs(analyzer.camera[3]-(row[6]+row[7])*.5)<1e-6);
  }
  const {input,engine,analyzer}=setup(['main','drop','break','drop']);analyzer.step(input);
  engine.sectionIndex=1;input.tSec=10;analyzer.step(input);assert.equal(analyzer.camera[0],17);
  input.tSec=12;analyzer.step(input);assert.equal(analyzer.camera[0],16);
  input.tSec=14;analyzer.step(input);assert.equal(analyzer.camera[0],15);
  engine.sectionIndex=2;input.tSec=24;analyzer.step(input);
  engine.sectionIndex=3;input.tSec=34;analyzer.step(input);assert.equal(analyzer.camera[0],13);assert.equal(analyzer.orbitSpeed,.09);
  assert.ok(Math.abs(analyzer.camera[3]-1.35*1.5)<1e-6);assert.equal(C.CAMERA_EASE_SECONDS,4);assert.equal(C.PALETTE_TINT,.15);
  assert.equal(C.MAX_STEPS,180);assert.equal(C.BLOOM_THRESHOLD,.55);assert.equal(C.BLOOM_STRENGTH,.90);
  console.log('UW-48 cameraKinds=6 easeMidpointDist=16 secondDropDist=13 speed=.09 brightness=2.025 maxSteps=180');
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
  assert.equal(C.KEPLER_SPEED,1.35);assert.equal(C.MAX_CROSSINGS,3);assert.equal(C.KICK_GAIN,2.6);
  assert.equal(C.RING_SAMPLE_MIN,1.3);assert.equal(C.RING_SAMPLE_MAX,3.2);
  assert.equal(C.MILKY_WAY_MAX,.035);assert.equal(C.MILKY_WAY_OCTAVES,5);
  console.log('UW-52 surgeMidpoint=[1.8,1.09,3.2] surgePeak=[2.1,1.18,3.4] easeIn=1.2 easeOut=2 secondDropInc=-10 replayError=0');
});
test('UW-53 WORLD-17 §10定数・廃止した層/EMA/BEAM/黒体/スラブ/光暈/光条なし',()=>{
  const expected={COLOR_POWER:1,PALETTE_TINT:.15,STREAK_RADIAL:60,STREAK_ANGULAR:3,STREAK_TIME:.03,
    FBM_OCTAVES:4,FBM_FREQUENCY:2.03,LOD_HEIGHT:540,LOD_START:.6,LOD_END:2,
    STREAK_FLOOR:.30,STREAK_LO:.30,STREAK_HI:.70,DISK_HDR:6,INTENSITY_POWER:.8,
    DISK_OUTER:24,OUTER_FADE:15,BAND_OUTER:14,STAR_CELLS:180,STAR_REFERENCE_HEIGHT:1080,
    OPACITY_BASE:.45,OPACITY_STREAK:.5,OPACITY_MAX:.90,STAR_RADIUS_PX:.6,STAR_PROBABILITY:.03,
    STAR_HDR:6,STAR_POWER:18,BLOOM_THRESHOLD:.55,BLOOM_STRENGTH:.90,VEIL_GAIN:.12};
  for(const [name,value] of Object.entries(expected))assert.equal(C[name],value,name);
  assert.deepEqual(Array.from(C.DISK_INNER_COLOR),[1,.90,.76]);assert.deepEqual(Array.from(C.DISK_OUTER_COLOR),[1,.60,.28]);
  const removed=/DISK_LAYER|FILAMENT|TEMPERATURE|BEAM_|VELOCITY_SCALE|SLAB_|KAPPA|FLOW_|CORE_|STAR_HALO|STAR_CORE|SPIKE_|STAR_RADIUS_(MIN|MAX)|STAR_FLOOR/;
  assert.ok(Object.keys(C).every(name=>!removed.test(name)));
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT'),a=new Analyzer();
  assert.ok(!/blackbody|coreColor|volumeSample|slabHeight|flowQuality|history|EMA|BEAM_|VELOCITY_SCALE|DISK_LAYER|SPIKE_|STAR_HALO/.test(shader));
  assert.equal(a.setQuality,undefined);assert.equal(a.flowQuality,undefined);
  assert.ok(shader.includes('if(sign(prev.y)!=sign(pos.y))'));
  assert.ok(shader.includes('crossings<MAX_CROSSINGS'));
  assert.ok(shader.includes('travel+length(segment)*fraction'));
  assert.ok(shader.includes('col+=alpha*sampleValue.rgb*sampleValue.a;alpha*=1.-sampleValue.a;crossings++'));
  assert.ok(shader.includes('if(crossings>1)directRadius=0.'));
  assert.ok(shader.includes('if(escaped)col+=alpha*starfield(dir)'));
  assert.ok(shader.includes('sum.rgb*.25,center.a'));
  assert.ok(shader.includes('return stars+min(vec3(BACKGROUND_MAX),milk)'));
  assert.ok(shader.includes('brightness=STAR_HDR*pow(h,STAR_POWER)'));
  assert.ok(shader.includes('float point=exp(-dot(p,p)/(2.*STAR_RADIUS_PX*STAR_RADIUS_PX));'));
  assert.ok(shader.includes('clamp((rd-DISK_INNER)/(BAND_OUTER-DISK_INNER),0.,1.)*float(BAND_COUNT)'));
  assert.ok(shader.includes('float fp=travel*radians(FOV)/LOD_HEIGHT'));
  assert.ok(shader.includes('frequency=STREAK_RADIAL'));
  assert.ok(shader.includes('p=p*FBM_FREQUENCY'));
  assert.ok(shader.includes('env*clamp(OPACITY_BASE+OPACITY_STREAK*streak,0.,OPACITY_MAX)'));
  console.log('UW-53 constants='+Object.keys(expected).length+' layers=1 crossings=3 octaves=4 starHDR=0..6 radius=.6 palette=.15');
});
test('UW-54 WORLD-17 §10.7/10.8画面境界・継ぎ目4画素・postのフレアはACESより前',async()=>{
  const {world17Stars,world17Arcs,world17Acceptance,WORLD17_CHECKS}=await import('../world/shoot-live.mjs');
  const c={width:200,height:1,rgba:new Uint8Array(800)},g={width:200,height:1,pixels:new Float32Array(800)};
  for(let x=0;x<150;x++){c.rgba.fill(128,x*4,x*4+3);g.pixels[x*4+3]=1;}
  assert.equal(world17Stars(c,g).pixels,150);assert.equal(world17Stars(c,g).pass,true);
  c.rgba.fill(127,0,3);assert.equal(world17Stars(c,g).pixels,149);assert.equal(world17Stars(c,g).pass,false);
  g.pixels[7]=0;assert.equal(world17Stars(c,g).pixels,148,'円盤上の明るい画素を星に数えない');
  assert.equal(WORLD17_CHECKS.STAR_THRESHOLD,.5);assert.equal(WORLD17_CHECKS.ARC_THRESHOLD,.85);
  assert.equal(WORLD17_CHECKS.ARC_UPPER_RATIO,.4);
  const r=loadClassic(['tests/browser/world14.test.js']),seam=r.get('world14SeamReport');
  const w=64,image={width:w,height:1,rgba:new Uint8Array(w*4)},geo={width:w,height:1,pixels:new Float32Array(w*4)};
  for(let x=0;x<w;x++){image.rgba.fill(x*3,x*4,x*4+3);geo.pixels[x*4]=6;geo.pixels[x*4+1]=x<32?3.13:-3.13;}
  assert.equal(seam(image,geo).pass,true);for(let x=32;x<w;x++)image.rgba.fill(x*3+60,x*4,x*4+3);
  assert.equal(seam(image,geo).pass,false);
  const fs=await import('node:fs'),post=fs.readFileSync(new URL('../../js/world/post.js',import.meta.url),'utf8');
  const branch=post.slice(post.indexOf('if(gargantuaMode>.5)'),post.indexOf('if(screen.w>.5||mood.x<=0.)',post.indexOf('if(gargantuaMode>.5)')));
  assert.ok(branch.includes('b0*.25+b1*.25+b2*.30+b3*.45'));
  assert.ok(branch.indexOf('c+=b3*VEIL_GAIN')<branch.indexOf('c=aces('));
  const n=101,arc={width:n,height:n,rgba:new Uint8Array(n*n*4)},geometry={width:n,height:n,pixels:new Float32Array(n*n*4)};
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)geometry.pixels[(y*n+x)*4+2]=Math.hypot(x-50,y-50)<=10?.9:4;
  for(const y of [30,70,71,72,73,74])for(let x=44;x<=56;x++)arc.rgba.fill(217,(y*n+x)*4,(y*n+x)*4+3);
  assert.equal(world17Arcs(arc,geometry,1).pass,true);
  for(let x=44;x<=56;x++)arc.rgba.fill(216,(30*n+x)*4,(30*n+x)*4+3);
  assert.equal(world17Arcs(arc,geometry,1).pass,false);
  assert.equal(world17Acceptance({width:1280,height:720,requestedSec:45,stars:{pass:true},arcs:{pass:true}}).pass,true);
  assert.equal(world17Acceptance(null).pass,false);
  assert.equal(world17Acceptance({width:1920,height:1080,requestedSec:45,stars:{pass:true},arcs:{pass:true}}).pass,false);
  console.log('UW-54 starPixelsPass=150 fail=149 arcPeakPass='+217/255+' fail='+216/255+' upperThickness=5 lowerThickness=1 seamContinuous=1 bloomWeights=.25/.25/.30/.45 veil=.12 beforeACES=true');
});
