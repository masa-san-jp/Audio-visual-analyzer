// 目的 — カメラ表・平面円盤・色/縞/星/フレア・曲がり角LOD/平均補填と再演を検査する — doc/20261004-design-gargantua-v1.md §10・§10.9〜10.11
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
test('UW-48 WORLD-25 カメラ全6kind表・4秒ease・同labelの第二drop倍率1.25・パレット15%の定数',()=>{
  const expected={intro:[50,38,2,2,.010,.010,.6,.6],build:[40,32,2,8,.020,.05,.8,1.1],drop:[30,30,3,3,.07,.07,1.35,1.35],break:[36,36,20,20,.012,.012,.7,.7],outro:[34,70,6,6,.008,.008,.9,0],main:[34,34,3,3,.03,.03,1,1]};
  const table=runtime.get('WORLD_GARGANTUA_CAMERA');assert.equal(JSON.stringify(table),JSON.stringify(expected));
  for(const kind of Object.keys(expected)){
    const {input,analyzer}=setup([kind]);input.tSec=5;analyzer.step(input);const row=expected[kind];
    assert.ok(Math.abs(analyzer.camera[0]-(row[0]+row[1])*.5)<1e-6);
    assert.ok(Math.abs(analyzer.camera[1]-((row[2]+row[3])*.5+1.5*Math.sin(5*.07))*Math.PI/180)<1e-7);
    assert.ok(Math.abs(analyzer.orbitSpeed-(row[4]+row[5])*.5)<1e-12);
    assert.ok(Math.abs(analyzer.camera[3]-(row[6]+row[7])*.5)<1e-6);
  }
  const {input,engine,analyzer}=setup(['main','drop','break','drop']);analyzer.step(input);
  engine.sectionIndex=1;input.tSec=10;analyzer.step(input);assert.equal(analyzer.camera[0],34);
  input.tSec=12;analyzer.step(input);assert.equal(analyzer.camera[0],32);
  input.tSec=14;analyzer.step(input);assert.equal(analyzer.camera[0],30);assert.ok(Math.abs(analyzer.camera[3]-1.35)<1e-6);
  engine.sectionIndex=2;input.tSec=24;analyzer.step(input);
  engine.sectionIndex=3;input.tSec=34;analyzer.step(input);assert.equal(analyzer.camera[0],27);assert.equal(analyzer.orbitSpeed,.09);
  assert.equal(C.SECOND_DROP_GAIN,1.25);assert.equal(analyzer.camera[3],1.6875);assert.equal(C.CAMERA_EASE_SECONDS,4);assert.equal(C.PALETTE_TINT,.15);
  assert.equal(C.MAX_STEPS,180);assert.equal(C.BLOOM_THRESHOLD,.55);assert.equal(C.BLOOM_STRENGTH,.90);
  console.log('UW-48 cameraKinds=6 easeMidpointDist=32 firstDropBrightness=1.35 secondDropDist=27 speed=.09 gain=1.25 brightness='+analyzer.camera[3]+' maxSteps=180');
});
test('UW-49 WORLD-13 キックexp(-age/.18)・高域pool12/寿命6秒・連続イベント・無拍反応・再演',()=>{
  const {input,f,analyzer}=setup();f.raw[layout.LEVEL]=.5;analyzer.step(input);
  assert.ok(Math.abs(analyzer.exposureMultiplier-1)<1e-12);
  input.tSec=1;f.raw[layout.ONSET_FLAGS]=5;analyzer.step(input);assert.equal(analyzer.music[0],1);assert.equal(analyzer.hotspotSerial,1);assert.equal(analyzer.highOnsetPhase,1);
  const spots=analyzer.hotspots.slice();analyzer.step(input);assert.deepEqual(analyzer.hotspots,spots);
  input.tSec=1.01;analyzer.step(input);assert.equal(analyzer.hotspotSerial,2,'MFSの連続フレームのbitは別イベント');
  assert.equal(analyzer.music[0],1,'連続低域オンセットも包絡を再開する');
  f.raw[layout.ONSET_FLAGS]=0;input.tSec=1.11;analyzer.step(input);assert.ok(Math.abs(analyzer.music[0]-Math.exp(-.1/.18))<1e-7);
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
  assert.ok(Math.abs(analyzer.camera[1]-(inclination+1.5*Math.PI/180*Math.sin(20*.07)))<1e-7);
  assert.equal(analyzer.gravityAmount,1);input.tSec=21;analyzer.step(input);assert.equal(analyzer.gravityAmount,.5);
  input.tSec=22;analyzer.step(input);assert.equal(analyzer.gravityAmount,0);
  input.tSec=24;analyzer.step(input);assert.ok(Math.abs(analyzer.baseInclination-20*Math.PI/180)<1e-12);
  engine.sectionIndex=3;input.tSec=34;analyzer.step(input);
  assert.ok(Math.abs(analyzer.baseInclination+6*Math.PI/180)<1e-12);
  const gravity=analyzer.gravity.slice(),camera=analyzer.camera.slice();
  analyzer.reset();engine.sectionIndex=3;input.tSec=34;analyzer.step(input);
  assert.deepEqual(analyzer.gravity,gravity);assert.deepEqual(analyzer.camera,camera);
  assert.equal(C.KEPLER_SPEED,1.35);assert.equal(C.MAX_CROSSINGS,3);assert.equal(C.KICK_GAIN,3.5);
  assert.equal(C.RING_SAMPLE_MIN,1.3);assert.equal(C.RING_SAMPLE_MAX,3.2);
  assert.equal(C.MILKY_WAY_MAX,.035);assert.equal(C.MILKY_WAY_OCTAVES,5);
  console.log('UW-52 surgeMidpoint=[1.8,1.09,3.2] surgePeak=[2.1,1.18,3.4] easeIn=1.2 easeOut=2 secondDropInc=-6 replayError=0');
});
test('UW-53 WORLD-20 §10.9〜10.11定数・廃止した層/EMA/BEAM/黒体/スラブ/光暈/光条なし',()=>{
  const expected={FOV:22,ESCAPE_RADIUS:100,SWAY_DEGREES:1.5,SECOND_DROP_DIST:27,SECOND_DROP_INC:-6,
    COLOR_POWER:1.3,PALETTE_TINT:.15,STREAK_RADIAL:60,STREAK_ANGULAR:3,STREAK_TIME:.03,
    FBM_OCTAVES:4,FBM_FREQUENCY:2.03,LOD_HEIGHT:540,LOD_START:.6,LOD_END:2,
    GRAZE_MIN:.05,TURN_START:1.2,TURN_MAX_LOG:6.3,NOISE_MEAN:.5,SUBSAMPLE_NEAR:.125,SUBSAMPLE_FAR:.375,
    STREAK_FLOOR:.15,STREAK_LO:.30,STREAK_HI:.70,DISK_HDR:3,INTENSITY_POWER:.8,
    DISK_OUTER:20,OUTER_FADE:12,BAND_OUTER:14,STAR_CELLS:180,STAR_REFERENCE_HEIGHT:1080,
    OPACITY_BASE:.45,OPACITY_STREAK:.5,OPACITY_MAX:.90,STAR_RADIUS_PX:.6,STAR_PROBABILITY:.03,
    STAR_HDR:6,STAR_POWER:18,BLOOM_THRESHOLD:.55,BLOOM_STRENGTH:.90,VEIL_GAIN:.10};
  for(const [name,value] of Object.entries(expected))assert.equal(C[name],value,name);
  assert.equal(C.SUBSAMPLE_OFFSET,undefined);
  assert.equal(C.LENS_DEMAG,undefined);
  assert.deepEqual(Array.from(C.DISK_INNER_COLOR),[1,.90,.76]);assert.deepEqual(Array.from(C.DISK_OUTER_COLOR),[1,.52,.20]);
  const removed=/DISK_LAYER|FILAMENT|TEMPERATURE|BEAM_|VELOCITY_SCALE|SLAB_|KAPPA|FLOW_|CORE_|STAR_HALO|STAR_CORE|SPIKE_|STAR_RADIUS_(MIN|MAX)|STAR_FLOOR/;
  assert.ok(Object.keys(C).every(name=>!removed.test(name)));
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT'),a=new Analyzer();
  assert.ok(!/blackbody|coreColor|volumeSample|slabHeight|flowQuality|history|\bEMA(?:\b|_)|BEAM_|VELOCITY_SCALE|DISK_LAYER|SPIKE_|STAR_HALO/.test(shader));
  assert.equal(a.setQuality,undefined);assert.equal(a.flowQuality,undefined);
  assert.ok(shader.includes('if(sign(prev.y)!=sign(pos.y))'));
  assert.ok(shader.includes('crossings<MAX_CROSSINGS'));
  assert.ok(shader.includes('travel+length(segment)*fraction'));
  assert.ok(shader.includes('col+=alpha*sampleValue.rgb*sampleValue.a;alpha*=1.-sampleValue.a;crossings++'));
  assert.ok(shader.includes('if(crossings>1)directRadius=0.'));
  assert.ok(shader.includes('if(escaped)col+=alpha*starfield(dir)'));
  assert.ok(shader.includes('sum.rgb*.125,center.a'));
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
test('UW-62 WORLD-20 §10.11 grazing上限20倍・曲がり角の連続LOD/上限・8点回転格子',()=>{
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT');
  assert.ok(shader.includes('vec4 diskSample(vec3 hit,float travel,vec3 ndir,float turn)'));
  assert.ok(shader.includes('diskSample(hit,travel+length(segment)*fraction,nd,turn)'));
  assert.ok(!/LENS_DEMAG|float\(c\)|int c\)/.test(shader));
  assert.ok(shader.indexOf('diskSample(hit,')<shader.indexOf('crossings++;'));
  // 製品GLSLからスカラー式だけを取り出し、GPUなしでLODの数値契約を検査する。
  const source=shader.match(/float fp=travel[^;]+;\s*(?:\/\/[^\n]*\n\s*)?(?:fp\*=[^;]+;\s*){2}/)?.[0];
  assert.ok(source,'fpの基準式と2つの補正を取得できる');
  const footprint=new Function('travel','ndir','turn','FOV','LOD_HEIGHT','GRAZE_MIN','TURN_START','TURN_MAX_LOG','clamp',
    source.replace('float fp=','let fp=').replaceAll('radians(FOV)','(FOV*Math.PI/180)')
      .replaceAll('max(','Math.max(').replaceAll('abs(','Math.abs(').replaceAll('exp(','Math.exp(')
      +'return fp;');
  const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
  const fp=(y,turn)=>footprint(30,{y},turn,C.FOV,C.LOD_HEIGHT,C.GRAZE_MIN,C.TURN_START,C.TURN_MAX_LOG,clamp);
  const base=30*(22*Math.PI/180)/540;
  assert.ok(Math.abs(fp(1,0)-base)<1e-15);
  assert.ok(Math.abs(fp(.1,0)/base-10)<1e-12);
  assert.equal(fp(-.1,0),fp(.1,0),'上下の視線で同じ画素幅');
  for(const y of [.05,.01,0,-.01])assert.ok(Math.abs(fp(y,0)/base-20)<1e-12);
  const turns=[0,1.2,2.2,7.5,10],multipliers=turns.map(turn=>fp(1,turn)/base);
  for(let i=0;i<turns.length;i++)assert.ok(Math.abs(multipliers[i]-Math.exp(clamp(turns[i]-1.2,0,6.3)))<1e-12);
  assert.equal(fp(1,10),fp(1,7.5),'最大倍率に達した後は一定');
  for(const turn of [1.2,2.2,7.5])assert.ok(Math.abs(fp(1,turn+1e-8)/fp(1,turn-1e-8)-1)<2.1e-8,'LOD境界は連続');
  assert.ok(Math.abs(fp(0,10)/base-20*Math.exp(6.3))<1e-9,'grazingと曲がり角の補正を両方保持');
  assert.ok(shader.includes('vec2 delta=vec2(SUBSAMPLE_NEAR,SUBSAMPLE_FAR)/(outputResolution*HALF_RESOLUTION)'));
  const main=shader.slice(shader.indexOf('void main(){'));
  assert.ok(main.includes('if(closest>=RING_SAMPLE_MIN&&closest<=RING_SAMPLE_MAX)'));
  const offsets=[...main.matchAll(/traceRay\(vUv\+vec2\((-?delta\.[xy]),(-?delta\.[xy])\),r,a,b\)/g)].map(match=>
    match.slice(1).map(value=>(value[0]==='-'?-1:1)*(value.endsWith('x')?C.SUBSAMPLE_NEAR:C.SUBSAMPLE_FAR)));
  assert.deepEqual(offsets,[[-.125,-.375],[.125,-.375],[-.125,.375],[.125,.375],
    [-.375,-.125],[.375,-.125],[-.375,.125],[.375,.125]]);
  assert.equal((main.match(/traceRay\(/g)||[]).length,9,'中心判定1本と平均用8本');
  assert.ok(main.includes('frag=vec4(sum.rgb*.125,center.a)'));
  assert.ok(main.includes('}else frag=center;'));
  console.log('UW-62 fpBase='+base+' grazeMax='+fp(0,0)+' turnMultipliers='+multipliers.join('/')+' combinedMax='+fp(0,10)/base+' ssaaPoints='+offsets.length+' totalRingRays=9 meanWeight=.125');
});
test('UW-63 WORLD-20 §10.11 毎ステップの累積曲がり角・4オクターブの平均補填',()=>{
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT');
  const trace=shader.slice(shader.indexOf('vec4 traceRay('),shader.indexOf('void main(){'));
  assert.ok(trace.includes('angular=cross(pos,dir),ndPrev=dir;'));
  assert.ok(trace.includes('travel=0.,turn=0.;'));
  const step=trace.match(/vec3 nd=normalize\(dir\);turn\+=length\(cross\(ndPrev,nd\)\);ndPrev=nd;/)?.[0];
  assert.ok(step,'設計どおりのステップ式を取得できる');
  assert.ok(trace.indexOf('dir+=acc*dt;')<trace.indexOf(step));
  assert.ok(trace.indexOf(step)<trace.indexOf('if(sign(prev.y)!=sign(pos.y))'),'交差しないステップも曲がり角へ含める');
  // 製品の累積式を評価し、非単位ベクトル・曲がりの逆転・直進を検査する。
  const normalize=v=>{const d=Math.hypot(...v);return v.map(x=>x/d);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const advance=new Function('dir','ndPrev','turn','normalize','cross','length',
    step.replace('vec3 nd=','const nd=')+'return {ndPrev,turn};');
  let state={ndPrev:[1,0,0],turn:0};
  for(const dir of [[2,0,0],[0,3,0],[4,0,0],[5,0,0]])state=advance(dir,state.ndPrev,state.turn,normalize,cross,v=>Math.hypot(...v));
  assert.equal(state.turn,2,'直進は0、往復の曲がりは打ち消さず加算');
  const small=advance([2*Math.cos(.01),2*Math.sin(.01),0],[1,0,0],0,normalize,cross,v=>Math.hypot(...v));
  assert.ok(Math.abs(small.turn-Math.sin(.01))<1e-15,'arccos等に置き換えず指定の外積長を使う');
  // 製品の4オクターブループを評価し、全減衰時の暗化と平均値の変動を検出する。
  const body=shader.match(/float streakFbm\(vec3 p,float rd,float fp\)\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body,'streakFbmの本体を取得できる');
  const smoothstep=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
  const fbm=new Function('rd','fp','samples','C','smoothstep',
    'const {STREAK_RADIAL,FBM_OCTAVES,FBM_FREQUENCY,LOD_START,LOD_END,NOISE_MEAN}=C;'+
    body.replaceAll(/\bfloat\b|\bint\b/g,'let').replace('p=p*FBM_FREQUENCY+vec3(7.1,3.7,1.9);','')
      .replace('gargantuaNoise3(p)','samples[k]'));
  const sample=(fp,values)=>fbm(6,fp,values,C,smoothstep);
  const fps=[0,.001,.01,.03,.06,.1,.2],mean=.5*(.5+.25+.125+.0625);
  for(const fp of fps)assert.equal(sample(fp,[.5,.5,.5,.5]),mean,'平均ノイズの明るさはLODに依存しない');
  assert.equal(sample(0,[0,1,.25,.75]),.328125,'未減衰の縞の値を保持する');
  assert.equal(sample(.2,[0,0,0,0]),mean);
  assert.equal(sample(.2,[1,1,1,1]),mean,'全減衰ではノイズに依存せず平均値へ収束する');
  let previous=-1;
  for(const fp of fps){const n=sample(fp,[0,0,0,0]);assert.ok(n>=previous&&n<=mean);previous=n;}
  const partial=sample(.06,[0,0,0,0]);assert.ok(partial>0&&partial<mean,'部分減衰にも平均値を補う');
  console.log('UW-63 turnStraightReverse=2 turnSmall='+small.turn+' noiseMeanCases='+fps.length+' unfiltered=.328125 fullyFiltered='+mean+' partialFiltered='+partial);
});
test('UW-54 WORLD-17 §10.7/10.8画面境界・継ぎ目4画素・postのフレアはACESより前',async()=>{
  const {world17Stars,world17Arcs,world17Acceptance,WORLD17_CHECKS}=await import('../world/shoot-live.mjs');
  const c={width:200,height:1,rgba:new Uint8Array(800)},g={width:200,height:1,pixels:new Float32Array(800)};
  for(let x=0;x<30;x++){c.rgba.fill(128,x*4,x*4+3);g.pixels[x*4+3]=1;}
  assert.equal(world17Stars(c,g).pixels,30);assert.equal(world17Stars(c,g).pass,true);
  c.rgba.fill(127,0,3);assert.equal(world17Stars(c,g).pixels,29);assert.equal(world17Stars(c,g).pass,false);
  g.pixels[7]=0;assert.equal(world17Stars(c,g).pixels,28,'円盤上の明るい画素を星に数えない');
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
  console.log('UW-54 starPixelsPass=30 fail=29 arcPeakPass='+217/255+' fail='+216/255+' upperThickness=5 lowerThickness=1 seamContinuous=1 bloomWeights=.25/.25/.30/.45 veil='+C.VEIL_GAIN+' beforeACES=true');
});
