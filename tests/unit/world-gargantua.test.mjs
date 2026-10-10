// 目的 — カメラ・円盤・LOD/2位相の流れ・光速の筋/鳴動と再演を検査する — doc/20261004-design-gargantua-v1.md §10・§10.9〜10.20
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';
const runtime=loadClassic(['js/vis-utils.js','js/mfs-const.js','js/mfs-view.js','js/world/gl-util.js','js/world/score.js','js/world/analyzer-types.js','js/world/g-gargantua.js']);
const C=runtime.get('WORLD_GARGANTUA'),Analyzer=runtime.get('WorldGargantuaAnalyzer'),Feature=runtime.get('MfsFrameView'),layout=runtime.get('MFS_LAYOUT');
// 製品のオクターブループをスカラーJSで評価し、位相ごとのLODと平均補填を検査する。
function evaluateStreakFbm(lf,omega,tau,samples,ratios=null) {
  const body=runtime.get('WORLD_GARGANTUA_FRAGMENT').match(/float streakFbm\(vec3 p,float lf,float omega,float tau\)\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body,'streakFbmの本体を取得できる');
  const smoothstep=(lo,hi,x)=>{if(ratios)ratios.push(x);const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
  const fbm=new Function('lf','omega','tau','samples','C','smoothstep',
    'const {STREAK_RADIAL,STREAK_ANGULAR,SHEAR_FACTOR,FBM_OCTAVES,FBM_FREQUENCY,LOD_START,LOD_END,NOISE_MEAN}=C;'+
    body.replaceAll(/\bfloat\b|\bint\b/g,'let').replace('p=p*FBM_FREQUENCY+vec3(7.1,3.7,1.9);','')
      .replace('gargantuaNoise3(p)','samples[k]'));
  return fbm(lf,omega,tau,samples,C,smoothstep);
}
function setup(kinds=['main'],duration=10) {
  const score=runtime.get('compileWorldScore')({bpm:120,durationSec:kinds.length*duration,beats:[],downbeatIndices:[],sections:kinds.map((kind,i)=>({kind,label:'A',startSec:i*duration,endSec:(i+1)*duration}))},11);
  const f=new Feature(),engine={score,sectionIndex:0,seed:11,gpu:{uniforms:new Float32Array(244)},preview:false};
  const input={engine,song:score.song,features:f,dt:0,tSec:0},analyzer=new Analyzer();
  return {score,f,engine,input,analyzer};
}
// 製品GLSLの筋のループをスカラーJSへ置換し、GPUなしで指定式を評価する。
function lightStreakEvaluator() {
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT');
  const body=shader.match(/for\(int i=0;i<LIGHT_STREAK_COUNT;i\+\+\)\{([\s\S]*?)\n \}/)?.[1];
  assert.ok(body,'筋のループを取得できる');
  const scalar=body.replaceAll(/\bfloat\b|\bvec4\b/g,'let').replaceAll('vec3(1.)','1')
    .replaceAll(/\b(exp|pow|max)\(/g,'Math.$1(');
  const names=Object.keys(C).filter(name=>name.startsWith('LIGHT_STREAK_'));
  return new Function('rd','phi','lf','music','streaks','tint','C',
    'const {'+names.join(',')+'}=C;const TAU=2*Math.PI;'+
    'const mod=(x,y)=>x-y*Math.floor(x/y),mix=(a,b,t)=>a+(b-a)*t;let col=0;const values=[];'+
    'for(let i=0;i<LIGHT_STREAK_COUNT;i++){'+scalar+
    'values.push({age,head,d,tail,width,radial,fade});}return {col,values};');
}
test('UW-48 WORLD-30 §10.20 全6kind/7項目のショット表・区間内smoothstep・4秒全項目ease',()=>{
  const expected={intro:[60,38,2,3,0,0,0,0,0,0,.010,.010,.6,.7],build:[36,28,-10,16,0,-6,0,6,0,0,.02,.04,.8,1.1],
    drop:[27,25,4,6,8,10,9,9,-2,-2,.09,.09,1.35,1.35],break:[42,42,38,46,0,0,0,0,0,0,.015,.015,.7,.7],
    main:[32,30,1.2,1.8,-4,-4,-8,-8,0,0,.03,.03,1,1],outro:[34,80,6,24,0,0,0,0,0,0,.008,.008,.9,0]};
  assert.equal(JSON.stringify(runtime.get('WORLD_GARGANTUA_CAMERA')),JSON.stringify(expected));
  let cases=0,maxError=0;
  for(const [kind,row] of Object.entries(expected))for(const p of [0,.25,.5,.75,1]){
    const {input,analyzer}=setup([kind]);input.tSec=p*10;analyzer.step(input);
    const progress=p*p*(3-2*p),actual=[analyzer.camera[0],analyzer.baseInclination,...analyzer.view2.slice(0,3),analyzer.orbitSpeed,analyzer.camera[3]];
    for(let i=0;i<7;i++){
      const value=(row[i*2]+(row[i*2+1]-row[i*2])*progress)*(i>=1&&i<=4?Math.PI/180:1);
      const error=Math.abs(actual[i]-value);maxError=Math.max(maxError,error);assert.ok(error<2e-6,kind+' item='+i);
    }
    assert.equal(analyzer.camera[1],Math.fround(analyzer.baseInclination+C.SWAY_DEGREES*Math.PI/180*Math.sin(input.tSec*C.SWAY_SPEED)));cases++;
  }
  const {input,engine,analyzer}=setup(['main','build']);input.tSec=9;analyzer.step(input);const from=analyzer.cameraShot.slice();
  engine.sectionIndex=1;
  for(const age of [0,1,2,3,4]){
    input.tSec=10+age;analyzer.step(input);const x=age/4,ease=x*x*(3-2*x);
    for(let i=0;i<7;i++)assert.equal(analyzer.cameraShot[i],from[i]+(analyzer.cameraTarget[i]-from[i])*ease);
  }
  assert.equal(C.CAMERA_EASE_SECONDS,4);assert.equal(C.SWAY_DEGREES,1);assert.equal(C.PALETTE_TINT,.15);
  assert.equal(C.MAX_STEPS,180);assert.equal(C.BLOOM_THRESHOLD,.45);assert.equal(C.BLOOM_STRENGTH,1.4);
  console.log('UW-48 shotRows=6 fields=7 progressCases='+cases+' transitionCases=35 maxFloat32Error='+maxError+' easeSeconds=4 swayDegrees=1');
});
test('UW-49 WORLD-28 キックexp(-age/.18)・光速の筋pool8/寿命.7秒・連続イベント・無拍反応・再演',()=>{
  const {input,f,analyzer}=setup();f.raw[layout.LEVEL]=.5;analyzer.step(input);
  assert.ok(Math.abs(analyzer.exposureMultiplier-1)<1e-12);
  input.tSec=1;f.raw[layout.ONSET_FLAGS]=5;analyzer.step(input);assert.equal(analyzer.music[0],1);assert.equal(analyzer.streakSerial,1);assert.equal(analyzer.highOnsetPhase,1);
  const streaks=analyzer.streaks.slice();analyzer.step(input);assert.deepEqual(analyzer.streaks,streaks);
  const hash=runtime.get('worldGargantuaEventHash');
  const radius=C.LIGHT_STREAK_INNER+(C.LIGHT_STREAK_OUTER-C.LIGHT_STREAK_INNER)*hash('gargantua:',0,11)/4294967296;
  assert.equal(streaks[0],Math.fround(radius),'生成半径は定数の範囲とhashから求めたFloat32値');
  assert.ok(Math.abs(streaks[1]-hash('gargantua-angle:',0,11)/4294967296*2*Math.PI)<3e-7);
  assert.equal(streaks[2],1);assert.equal(streaks[3],1);
  input.tSec=1.01;analyzer.step(input);assert.equal(analyzer.streakSerial,2,'MFSの連続フレームのbitは別イベント');
  assert.equal(analyzer.music[0],1,'連続低域オンセットも包絡を再開する');
  f.raw[layout.ONSET_FLAGS]=0;input.tSec=1.11;analyzer.step(input);assert.ok(Math.abs(analyzer.music[0]-Math.exp(-.1/.18))<1e-7);
  const kick=analyzer.music[0];f.raw[layout.BEAT_FLAG]=1;f.raw[layout.DOWNBEAT_FLAG]=1;analyzer.step(input);assert.equal(analyzer.music[0],kick);
  for(let i=1;i<14;i++){f.raw[layout.ONSET_FLAGS]=0;input.tSec=1+i*.2;analyzer.step(input);f.raw[layout.ONSET_FLAGS]=4;input.tSec+=.1;analyzer.step(input);}
  assert.equal(analyzer.streaks.length/4,8);assert.equal(analyzer.streakSerial,15);assert.equal(analyzer.highOnsetPhase,15);
  for(let i=0;i<8;i++){
    assert.ok(analyzer.streaks[i*4]>=C.LIGHT_STREAK_INNER&&analyzer.streaks[i*4]<=C.LIGHT_STREAK_OUTER);
    assert.ok(analyzer.streaks[i*4+1]>=0&&analyzer.streaks[i*4+1]<2*Math.PI);assert.equal(analyzer.streaks[i*4+3],1);
    const serial=i<7?i+8:7;assert.ok(Math.abs(analyzer.streaks[i*4+2]-(1+(serial-1)*.2+.1))<2e-7,'循環プールは新しい誕生時刻を保持');
  }
  analyzer.reset();input.tSec=1;f.raw[layout.ONSET_FLAGS]=5;analyzer.step(input);assert.deepEqual(analyzer.streaks,streaks);
  assert.equal(C.LIGHT_STREAK_LIFE,.7);assert.equal(C.LIGHT_STREAK_WIDTH,.08);assert.equal(C.LIGHT_STREAK_HDR,14);
  console.log('UW-49 kick100ms='+kick+' streakCapacity=8 events=15 lifetime=.7 onsetReplayError=0 direction=+1 consecutiveOnsets=2 exposure=.85+.3*.5=1 radius='+streaks[0]+' radiusRange='+C.LIGHT_STREAK_INNER+'..'+C.LIGHT_STREAK_OUTER);
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

test('UW-52 WORLD-30 重力/地平面/ISCO固定・全区間の切替とreset再演・旧surge定数なし',()=>{
  const {input,engine,analyzer}=setup(['intro','build','drop','break','main','outro','drop']);let cases=0;
  const fixed=[C.GRAVITY,C.Rs,C.DISK_INNER];
  for(let section=0;section<7;section++)for(const age of [0,.6,1.2,2,4,9.99]){
    engine.sectionIndex=section;input.tSec=section*10+age;analyzer.step(input);
    assert.deepEqual(Array.from(analyzer.gravity),fixed);cases++;
  }
  const gravity=analyzer.gravity.slice(),camera=analyzer.camera.slice(),view2=analyzer.view2.slice();
  analyzer.reset();analyzer.step(input);assert.deepEqual(analyzer.gravity,gravity);assert.deepEqual(analyzer.camera,camera);assert.deepEqual(analyzer.view2,view2);
  for(const name of ['DROP_GRAVITY','DROP_HORIZON','DROP_DISK_INNER','GRAVITY_EASE_IN','GRAVITY_EASE_OUT'])assert.equal(C[name],undefined);
  assert.equal(analyzer.gravityAmount,undefined);assert.equal(C.KEPLER_SPEED,1.35);assert.equal(C.MAX_CROSSINGS,3);assert.equal(C.KICK_GAIN,3.5);
  assert.equal(C.RING_SAMPLE_MIN,1.3);assert.equal(C.RING_SAMPLE_MAX,3.2);assert.equal(C.MILKY_WAY_MAX,.035);assert.equal(C.MILKY_WAY_OCTAVES,5);
  console.log('UW-52 fixedGravity=[1.5,1,3] sectionAgeCases='+cases+' replayError=0 surgeStateRemoved=true');
});
test('UW-53 WORLD-20 §10.9〜10.11定数・廃止した層/EMA/BEAM/黒体/スラブ/光暈/光条なし',()=>{
  const expected={FOV:22,ESCAPE_RADIUS:100,SWAY_DEGREES:1,STAR_HIGH_GAIN:1.5,ORBIT_LOUD_GAIN:.8,ORBIT_MIN:.5,ORBIT_MAX:1.6,
    COLOR_POWER:1.3,PALETTE_TINT:.15,STREAK_RADIAL:60,STREAK_ANGULAR:3,STREAK_TIME:.03,
    FBM_OCTAVES:4,FBM_FREQUENCY:2.03,LOD_HEIGHT:540,LOD_START:.6,LOD_END:2,
    GRAZE_MIN:.05,TURN_START:1.2,TURN_MAX_LOG:6.3,NOISE_MEAN:.5,SUBSAMPLE_NEAR:.125,SUBSAMPLE_FAR:.375,
    STREAK_FLOOR:.15,STREAK_LO:.30,STREAK_HI:.70,DISK_HDR:5.2,INTENSITY_POWER:.65,
    DISK_OUTER:20,OUTER_FADE:12,BAND_OUTER:14,STAR_CELLS:180,STAR_REFERENCE_HEIGHT:1080,
    OPACITY_BASE:.45,OPACITY_STREAK:.5,OPACITY_MAX:.90,STAR_RADIUS_PX:.6,STAR_PROBABILITY:.03,
    STAR_HDR:6,STAR_POWER:18,BLOOM_THRESHOLD:.45,BLOOM_STRENGTH:1.4,VEIL_GAIN:.18};
  for(const [name,value] of Object.entries(expected))assert.equal(C[name],value,name);
  assert.equal(C.SUBSAMPLE_OFFSET,undefined);
  assert.equal(C.LENS_DEMAG,undefined);
  assert.deepEqual(Array.from(C.DISK_INNER_COLOR),[1,.90,.76]);assert.deepEqual(Array.from(C.DISK_OUTER_COLOR),[1,.52,.20]);
  const removed=/DISK_LAYER|FILAMENT|TEMPERATURE|BEAM_|VELOCITY_SCALE|SLAB_|KAPPA|FLOW_(?!(?:PERIOD|PHASE_OFFSET)$)|CORE_|STAR_HALO|STAR_CORE|SPIKE_|STAR_RADIUS_(MIN|MAX)|STAR_FLOOR/;
  assert.ok(Object.keys(C).every(name=>!removed.test(name)));
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT'),a=new Analyzer();
  assert.ok(!/blackbody|coreColor|volumeSample|slabHeight|flowQuality|history|\bEMA(?:\b|_)|BEAM_|VELOCITY_SCALE|DISK_LAYER|SPIKE_|STAR_HALO/.test(shader));
  assert.equal(a.setQuality,undefined);assert.equal(a.flowQuality,undefined);
  assert.ok(shader.includes('if(sign(prev.y)!=sign(pos.y))'));
  assert.ok(shader.includes('crossings<MAX_CROSSINGS'));
  assert.ok(shader.includes('travel+length(segment)*fraction'));
  assert.ok(shader.includes('col+=alpha*sampleValue.rgb*sampleValue.a;alpha*=1.-sampleValue.a;'));
  assert.ok(shader.includes('if(crossings>1)directRadius=0.'));
  assert.ok(shader.includes('if(escaped)col+=alpha*starfield(escapeDir)'));
  assert.ok(shader.includes('sum.rgb*.125,center.a'));
  assert.ok(shader.includes('return (stars+min(vec3(BACKGROUND_MAX),milk))*(1.+STAR_HIGH_GAIN*view2.w)'));
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
  assert.ok(shader.includes('vec4 diskSample(vec3 hit,float travel,vec3 ndir,float turn,float lf)'));
  assert.ok(shader.includes('hitA[crossings]=vec4(hit.x,hit.z,travel+length(segment)*fraction,turn)'));
  assert.ok(!/LENS_DEMAG|float\(c\)|int c\)/.test(shader));
  assert.ok(shader.indexOf('hitA[crossings]=')<shader.indexOf('crossings++;'));
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
  const offsets=[...main.matchAll(/traceRay\(vUv\+vec2\((-?delta\.[xy]),(-?delta\.[xy])\),r,a,b,d,subA,subB,subCount,subEscaped,subDir\)/g)].map(match=>
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
  const trace=shader.slice(shader.indexOf('void traceRay('),shader.indexOf('void main(){'));
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
  const sample=(fp,values)=>evaluateStreakFbm(fp/6,1.35,0,values);
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

test('UW-72 WORLD-26 §10.16 交点out配列・分岐外の微分・SSAAへ中心lfを共有',()=>{
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT');
  assert.equal(C.DERIV_SCALE,1);assert.equal(C.LF_MAX,1);assert.equal(C.MAX_CROSSINGS,3);
  const trace=shader.slice(shader.indexOf('void traceRay('),shader.indexOf('vec4 shadeHits('));
  assert.match(trace,/out vec4 hitA\[MAX_CROSSINGS\],out vec4 hitB\[MAX_CROSSINGS\],out int hitCount,out bool escaped,out vec3 escapeDir/);
  assert.ok(trace.includes('hitA[c]=vec4(0);hitB[c]=vec4(0);'));
  assert.ok(trace.includes('hitA[crossings]=vec4(hit.x,hit.z,travel+length(segment)*fraction,turn);'));
  assert.ok(trace.includes('hitB[crossings]=vec4(nd,1.);crossings++;'));
  assert.ok(trace.includes('hitCount=crossings;escapeDir=dir;'));
  assert.ok(!/diskSample\(|starfield\(/.test(trace),'追跡中は陰影計算しない');
  const beforeMain=shader.slice(0,shader.indexOf('void main(){'));
  assert.ok(!/dFdx\(|dFdy\(|fwidth\(/.test(beforeMain),'微分を補助関数へ隠さない');
  const main=shader.slice(shader.indexOf('void main(){')).replace(/\/\/[^\n]*/g,'');
  const loop=main.match(/for\(int c=0;c<MAX_CROSSINGS;c\+\+\)\{([^}]+)\}/)?.[1];
  assert.ok(loop);assert.ok(!/\bif\s*\(|\bbreak\b|\bcontinue\b|\breturn\b/.test(loop));
  assert.ok(loop.includes('L=log(max(rd,1e-3)),v=c<hitCount?1.:0.'));
  assert.ok(loop.includes('float dL=length(vec2(dFdx(L),dFdy(L)));'));
  assert.ok(loop.includes('bool ok=fwidth(v)==0.&&v>0.;'));
  for(const name of ['dFdx','dFdy','fwidth']){
    const at=main.indexOf(name+'('),prefix=main.slice(0,at);
    assert.equal((main.match(new RegExp(name+'\\(', 'g'))||[]).length,1);
    assert.equal((prefix.match(/\{/g)||[]).length-(prefix.match(/\}/g)||[]).length,2,'main直下の固定ループ');
    assert.ok(at>main.indexOf('traceRay(vUv,'));assert.ok(at<main.indexOf('if(closest'));
  }
  const ring=main.slice(main.indexOf('if(closest'));
  assert.ok(!/dFdx\(|dFdy\(|fwidth\(/.test(ring));
  assert.equal((ring.match(/shadeHits\(subA,subB,subCount,subEscaped,subDir,d,lf,hitCount\)/g)||[]).length,8);
  const shade=beforeMain.slice(beforeMain.indexOf('vec4 shadeHits('));
  assert.ok(shade.includes('c<lfCount?lf[c]:-1.'));
  const disk=shader.slice(shader.indexOf('vec4 diskSample('),shader.indexOf('float milkyFbm('));
  assert.ok(disk.includes('if(lf<0.)lf=analyticLf(rd,travel,ndir,turn);'));
  assert.ok(disk.includes('lf=clamp(lf,0.,LF_MAX);'));
  assert.ok(shader.includes('float w=1.-smoothstep(LOD_START,LOD_END,lf*(frequency+angularFrequency*SHEAR_FACTOR*omega*tau));'));
  console.log('UW-72 crossings=3 derivativeCalls=3 uniformLoop=3 ssaaSharedLf=8 DERIV_SCALE=1 LF_MAX=1');
});

test('UW-73 WORLD-26 §10.16 実GLSL式: 微分の優先・不連続/欠落の解析値・lf上下限',()=>{
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT'),clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
  // 製品の解析値関数とmainの微分ループをスカラーJSへ写し、選択と上限を数値検証する。
  const analyticBody=shader.match(/float analyticLf\([^)]*\)\{([^}]+)\}/)[1];
  const analytic=new Function('rd','travel','ndir','turn','C','clamp',
    'const {FOV,LOD_HEIGHT,GRAZE_MIN,TURN_START,TURN_MAX_LOG}=C;'+analyticBody
      .replace('float fp=','let fp=').replace('radians(FOV)','(FOV*Math.PI/180)')
      .replaceAll('max(','Math.max(').replaceAll('abs(','Math.abs(').replaceAll('exp(','Math.exp('));
  const analyticLf=(rd,travel,ndir,turn)=>analytic(rd,travel,ndir,turn,C,clamp);
  const loop=shader.slice(shader.indexOf('void main(){')).match(/for\(int c=0;c<MAX_CROSSINGS;c\+\+\)\{([^}]+)\}/)[1];
  const evaluate=new Function('hitA','hitB','hitCount','dFdx','dFdy','fwidth','analyticLf','clamp','C',
    'const {MAX_CROSSINGS,DERIV_SCALE,LF_MAX}=C;const lf=[];for(let c=0;c<MAX_CROSSINGS;c++){'+loop
      .replaceAll(/\bfloat\b|\bbool\b/g,'let').replace('length(hitA[c].xy)','Math.hypot(...hitA[c].xy)')
      .replace('length(vec2(dFdx(L),dFdy(L)))','Math.hypot(dFdx(L),dFdy(L))')
      .replaceAll('log(','Math.log(').replaceAll('max(','Math.max(')+'}return lf;');
  const hitA=[3,6,12].map(rd=>({xy:[rd,0],z:30,w:2.2})),hitB=hitA.map(()=>({xyz:{y:.1}}));
  const run=(count,dx,dy,width)=>evaluate(hitA,hitB,count,()=>dx,()=>dy,()=>width,analyticLf,clamp,C);
  assert.deepEqual(run(3,.003,.004,0),[.005,.005,.005],'微分が有効なら解析値の半径/曲がり角に依存しない');
  const fallback=run(3,.003,.004,1),expected=hitA.map(a=>clamp(analyticLf(Math.hypot(...a.xy),a.z,hitB[0].xyz,a.w),0,1));
  assert.deepEqual(fallback,expected,'近隣画素の有効性が異なると解析値へ戻す');
  assert.deepEqual(run(0,0,0,0),expected,'一様に交点なしでもokにはしない');
  assert.deepEqual(run(1,.003,.004,0),[.005,expected[1],expected[2]]);
  assert.deepEqual(run(3,3,4,0),[1,1,1]);assert.deepEqual(run(3,0,0,0),[0,0,0]);
  hitA.forEach(a=>a.w=10);hitB.forEach(b=>b.xyz.y=0);
  assert.deepEqual(run(3,0,0,1),[1,1,1],'解析値にもLF_MAXを適用する');
  hitA.forEach(a=>a.z=-30);assert.deepEqual(run(3,0,0,1),[0,0,0],'下限も両経路で適用する');
  assert.equal(analyticLf(6,0,{y:0},10),0);
  console.log('UW-73 derivativeLf=.005 analyticLf='+expected.join('/')+' clampMin=0 clampMax=1 fallbackCases=validityEdge/absent/extraHit');
});

test('UW-74 WORLD-26 §10.16 遅延合成は従来の前方合成と一致・中心欠落時は交点ごとに解析指定',()=>{
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT');
  const body=shader.match(/vec4 shadeHits\([\s\S]*?\)\{([\s\S]*?)\n\}\nvoid main/)[1];
  // ベクトル演算だけをJSへ写し、製品の合成順序・alpha・星空・lfの受け渡しを実行する。
  const shade=new Function('hitA','hitB','hitCount','escaped','escapeDir','directRadius','lf','lfCount','diskSample','starfield','add','scale','MAX_CROSSINGS',
    body.replaceAll(/\bvec3\b(?= col)|\bvec4\b(?= a| sampleValue)|\bfloat\b|\bint\b/g,'let')
      .replace('vec3(0)','[0,0,0]').replace('vec3(a.x,0.,a.y)','[a.x,0,a.y]')
      .replace('col+=alpha*sampleValue.rgb*sampleValue.a','col=add(col,scale(sampleValue.rgb,alpha*sampleValue.a))')
      .replace('col+=alpha*starfield(escapeDir)','col=add(col,scale(starfield(escapeDir),alpha))')
      .replace('return vec4(col,directRadius)','return {rgb:col,a:directRadius}'));
  const add=(a,b)=>a.map((x,i)=>x+b[i]),scale=(a,k)=>a.map(x=>x*k);
  const hitA=[0,1,2].map(c=>({x:c+3,y:c+4,z:30+c,w:c/2})),hitB=[0,1,2].map(c=>({xyz:[0,c/10,1]}));
  const samples=[{rgb:[1,2,3],a:.45},{rgb:[4,5,6],a:.7},{rgb:[7,8,9],a:.9}],stars=[.1,.2,.3],lf=[.005,.01,.02];
  let cases=0,maxError=0;
  for(let count=0;count<=3;count++)for(const escaped of [false,true])for(let lfCount=0;lfCount<=3;lfCount++){
    const calls=[],disk=(hit,travel,dir,turn,width)=>{const c=calls.length;calls.push({hit,travel,dir,turn,width});return samples[c];};
    let starCalls=0;const star=dir=>{assert.deepEqual(dir,[0,1,0]);starCalls++;return stars;};
    const actual=shade(hitA,hitB,count,escaped,[0,1,0],6,lf,lfCount,disk,star,add,scale,3);
    let col=[0,0,0],alpha=1;
    for(let c=0;c<count;c++){col=add(col,scale(samples[c].rgb,alpha*samples[c].a));alpha*=1-samples[c].a;}
    if(escaped)col=add(col,scale(stars,alpha));
    assert.deepEqual(actual,{rgb:col,a:6});assert.equal(starCalls,Number(escaped));assert.equal(calls.length,count);
    for(let c=0;c<count;c++)assert.deepEqual(calls[c],{hit:[c+3,0,c+4],travel:30+c,dir:hitB[c].xyz,turn:c/2,width:c<lfCount?lf[c]:-1});
    for(let c=0;c<3;c++)maxError=Math.max(maxError,Math.abs(actual.rgb[c]-col[c]));cases++;
  }
  console.log('UW-74 compositingCases='+cases+' maxRGBError='+maxError+' hitOrder=frontToBack directRadius=6 missingCenterLf=-1');
});

test('UW-75 WORLD-27 §10.17 2位相の定数・位相別入力/LOD・時刻項・分散復元の構造',()=>{
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT');
  for(const [name,value] of Object.entries({FLOW_PERIOD:8,FLOW_PHASE_OFFSET:17.3,SHEAR_FACTOR:1.5})){
    assert.equal(C[name],value,name);assert.ok(shader.includes('const float '+name+' = '+value.toFixed(8)+';'));
  }
  assert.equal(C.SHEAR_FACTOR,Math.abs(C.KEPLER_POWER));
  const input=shader.match(/vec3 streakInput\([^)]*\)\{([^}]+)\}/)[1];
  assert.ok(input.includes('float rot=phi-omega*tau;'));
  assert.ok(input.includes('sin(rot)*STREAK_ANGULAR+music.w*STREAK_TIME+phase*FLOW_PHASE_OFFSET'));
  assert.ok(!/omega\*music\.w|tau\*STREAK_TIME/.test(input));
  const flow=shader.match(/float streakFlow\([^)]*\)\{([^}]+)\}/)[1];
  assert.ok(flow.includes('tau1=mod(music.w,FLOW_PERIOD),tau2=mod(music.w+FLOW_PERIOD*.5,FLOW_PERIOD)'));
  assert.ok(flow.includes('w1=1.-abs(2.*tau1/FLOW_PERIOD-1.),w2=1.-w1'));
  assert.ok(flow.includes('streakFbm(streakInput(rd,phi,omega,tau1,1.),lf,omega,tau1)'));
  assert.ok(flow.includes('streakFbm(streakInput(rd,phi,omega,tau2,2.),lf,omega,tau2)'));
  assert.equal((flow.match(/streakFbm\(/g)||[]).length,2);
  assert.ok(flow.includes('float n=w1*n1+w2*n2;'));
  assert.ok(flow.includes('return .5+(n-.5)/sqrt(w1*w1+w2*w2);'));
  const fbm=shader.match(/float streakFbm\([^)]*\)\{([\s\S]*?)\n\}/)[1];
  assert.ok(fbm.includes('frequency=STREAK_RADIAL,angularFrequency=STREAK_ANGULAR'));
  assert.ok(fbm.includes('lf*(frequency+angularFrequency*SHEAR_FACTOR*omega*tau)'));
  assert.ok(fbm.includes('frequency*=FBM_FREQUENCY;angularFrequency*=FBM_FREQUENCY;'));
  assert.ok(!/music\.w/.test(fbm));
  const disk=shader.slice(shader.indexOf('vec4 diskSample('),shader.indexOf('float milkyFbm('));
  assert.ok(disk.includes('float n=streakFlow(rd,phi,omega,lf);'));
  assert.ok(disk.includes('smoothstep(STREAK_LO,STREAK_HI,n)'));
  console.log('UW-75 FLOW_PERIOD=8 FLOW_PHASE_OFFSET=17.3 phaseOffsets=17.3/34.6 SHEAR_FACTOR=1.5 fbmEvaluations=2 octavesPerPhase=4');
});

test('UW-76 WORLD-27 §10.17 実GLSL式: tauリセット前後の重みの連続性・和1・ゼロ重み・分散復元',()=>{
  const body=runtime.get('WORLD_GARGANTUA_FRAGMENT').match(/float streakFlow\([^)]*\)\{([^}]+)\}/)[1];
  const scalar=body.replaceAll(/\bfloat\b/g,'let').replaceAll('abs(','Math.abs(').replaceAll('sqrt(','Math.sqrt(');
  const mod=(x,y)=>x-y*Math.floor(x/y);
  const state=new Function('music','FLOW_PERIOD','mod',scalar.slice(0,scalar.indexOf('let n1='))+'return {tau1,tau2,w1,w2};');
  const weights=t=>state({w:t},C.FLOW_PERIOD,mod);
  const evaluate=new Function('rd','phi','omega','lf','music','FLOW_PERIOD','mod','streakInput','streakFbm',scalar);
  // リセットで不連続になる模様を与え、重み0がその飛びを隠すことを製品の混合式で検査する。
  const input=(rd,phi,omega,tau,phase)=>({tau,phase}),noise=p=>p.phase===1?.1+.8*p.tau/C.FLOW_PERIOD:.9-.6*p.tau/C.FLOW_PERIOD;
  const blend=(t,fbm=noise)=>evaluate(6,.3,1.35,.01,{w:t},C.FLOW_PERIOD,mod,input,fbm);
  let sumError=0,maxWeightJump=0,maxBlendJump=0;
  for(let i=0;i<=1920;i++){
    const {tau1,tau2,w1,w2}=weights(i/10);
    assert.ok(tau1>=0&&tau1<C.FLOW_PERIOD&&tau2>=0&&tau2<C.FLOW_PERIOD);
    assert.ok(w1>=0&&w1<=1&&w2>=0&&w2<=1);
    sumError=Math.max(sumError,Math.abs(w1+w2-1));assert.equal(w1+w2,1);
  }
  const epsilon=1e-7;let resets=0;
  for(let t=4;t<=192;t+=4){
    const before=weights(t-epsilon),at=weights(t),after=weights(t+epsilon);
    if(t%8===0){assert.equal(at.tau1,0);assert.equal(at.w1,0);assert.equal(at.w2,1);}
    else {assert.equal(at.tau2,0);assert.equal(at.w2,0);assert.equal(at.w1,1);}
    for(const name of ['w1','w2']){
      const jump=Math.abs(before[name]-after[name]);maxWeightJump=Math.max(maxWeightJump,jump);
      assert.ok(Math.abs(before[name]-at[name])<3e-8);assert.ok(Math.abs(after[name]-at[name])<3e-8);
      assert.ok(jump<3e-8);
    }
    const jump=Math.abs(blend(t-epsilon)-blend(t+epsilon));maxBlendJump=Math.max(maxBlendJump,jump);
    assert.ok(jump<1e-7);assert.ok(Math.abs(blend(t)-blend(t-epsilon))<1e-7);resets++;
  }
  assert.equal(weights(0).w1,0);assert.equal(blend(0,()=>.2),.2);assert.equal(blend(4,()=>.8),.8);
  assert.equal(blend(2,()=>.5),.5);
  const mixed=blend(2,p=>p.phase===1?.2:.6),expected=.5+(.4-.5)/Math.sqrt(.5);
  assert.equal(mixed,expected);
  assert.ok(Math.abs(1/Math.sqrt(weights(2).w1**2+weights(2).w2**2)-Math.SQRT2)<1e-15);
  console.log('UW-76 weightSamples=1921 resetBoundaries='+resets+' epsilon='+epsilon+' maxWeightSumError='+sumError+
    ' maxWeightJump='+maxWeightJump+' syntheticNoiseBlendJump='+maxBlendJump+' midpointVarianceGain='+Math.SQRT2);
});

test('UW-77 WORLD-27 §10.17 オクターブごとの巻き込み比・8秒の上限・平均補填',()=>{
  const mean=C.NOISE_MEAN*(1-2**(-C.FBM_OCTAVES));let cases=0,maxRatioError=0;
  for(const lf of [0,.001,.01,.03,1])for(const omega of [0,.5,1.35,2.7])for(const tau of [0,1,4,8-1e-7]){
    const ratios=[];assert.equal(evaluateStreakFbm(lf,omega,tau,[.5,.5,.5,.5],ratios),mean);
    assert.equal(ratios.length,C.FBM_OCTAVES);
    for(let k=0;k<C.FBM_OCTAVES;k++){
      const scale=C.FBM_FREQUENCY**k,expected=lf*(C.STREAK_RADIAL*scale+C.STREAK_ANGULAR*scale*C.SHEAR_FACTOR*omega*tau),
        bound=lf*(C.STREAK_RADIAL*scale+C.STREAK_ANGULAR*scale*C.SHEAR_FACTOR*omega*C.FLOW_PERIOD);
      maxRatioError=Math.max(maxRatioError,Math.abs(ratios[k]-expected));
      assert.ok(Math.abs(ratios[k]-expected)<1e-12);assert.ok(ratios[k]<=bound);cases++;
    }
    assert.equal(evaluateStreakFbm(1,omega,tau,[0,0,0,0]),mean);
    assert.equal(evaluateStreakFbm(1,omega,tau,[1,1,1,1]),mean);
  }
  const omega=C.KEPLER_SPEED,frequencies=[20,45,90].map(t=>{
    const tau1=t%C.FLOW_PERIOD,tau2=(t+C.FLOW_PERIOD*.5)%C.FLOW_PERIOD;
    return [tau1,tau2].map(tau=>C.STREAK_RADIAL+C.STREAK_ANGULAR*C.SHEAR_FACTOR*omega*tau);
  });
  const maxFrequency=C.STREAK_RADIAL+C.STREAK_ANGULAR*C.SHEAR_FACTOR*omega*C.FLOW_PERIOD;
  assert.ok(Math.abs(maxFrequency-108.6)<1e-12);
  for(const values of frequencies)for(const f of values)assert.ok(f<maxFrequency);
  console.log('UW-77 octaveRatioCases='+cases+' maxRatioError='+maxRatioError+' fullyFilteredPerPhase='+mean+
    ' innerFrequency20/45/90='+JSON.stringify(frequencies)+' innerFrequencyBound='+maxFrequency+' boundVsRadial='+maxFrequency/C.STREAK_RADIAL);
});

test('UW-78 WORLD-28 §10.18 共有定数・筋の先頭/尾/LOD半径/寿命を製品GLSLからCPU評価',()=>{
  const expected={LIGHT_STREAK_COUNT:8,LIGHT_STREAK_INNER:5.5,LIGHT_STREAK_OUTER:9,
    LIGHT_STREAK_LAP:.35,LIGHT_STREAK_SPEED:2*Math.PI/.35,LIGHT_STREAK_TAIL:1.6,
    LIGHT_STREAK_WIDTH:.08,LIGHT_STREAK_LOD:1.5,LIGHT_STREAK_LIFE:.7,LIGHT_STREAK_HDR:14};
  for(const [name,value] of Object.entries(expected))assert.equal(C[name],value,name);
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT'),glsl=runtime.get('WORLD_GARGANTUA_GLSL');
  assert.ok(shader.includes('uniform vec4 streaks[8]'));assert.ok(glsl.includes('const int LIGHT_STREAK_COUNT = 8;'));
  for(const [name,value] of Object.entries(expected))if(name!=='LIGHT_STREAK_COUNT')assert.ok(glsl.includes(`const float ${name} = ${value.toFixed(8)};`),name);
  assert.ok(!Object.keys(C).some(name=>name.startsWith('HOT'+'SPOT_')));
  assert.ok(!/KEPLER|music\.z/.test(shader.match(/for\(int i=0;i<LIGHT_STREAK_COUNT;i\+\+\)\{([\s\S]*?)\n \}/)[1]));
  const evaluate=lightStreakEvaluator(),streaks=Array.from({length:8},()=>({x:4,y:.3,z:-100,w:0}));
  streaks[0]={x:4,y:.3,z:0,w:1};
  const sample=(age,phi,rd=4,lf=0)=>evaluate(rd,phi,lf,{w:age},streaks,.8,C);
  let maxError=0,cases=0;
  for(const age of [0,1/60,.1,C.LIGHT_STREAK_LIFE/2,C.LIGHT_STREAK_LIFE-1e-8])for(const phi of [-7,-Math.PI,.3,Math.PI,9])for(const rd of [3.8,4,4.1])for(const lf of [0,.001,.02,.1]){
    const result=sample(age,phi,rd,lf),actual=result.values[0],head=.3+C.LIGHT_STREAK_SPEED*age,
      d=((head-phi)%(2*Math.PI)+2*Math.PI)%(2*Math.PI),width=Math.max(C.LIGHT_STREAK_WIDTH,rd*lf*C.LIGHT_STREAK_LOD),
      values={head,d,tail:Math.exp(-d/C.LIGHT_STREAK_TAIL),width,radial:Math.exp(-(((rd-4)/width)**2))*(C.LIGHT_STREAK_WIDTH/width),fade:(1-age/C.LIGHT_STREAK_LIFE)**2};
    for(const [name,value] of Object.entries(values)){
      const error=Math.abs(actual[name]-value);maxError=Math.max(maxError,error);assert.ok(error<1e-12,name);
    }
    assert.ok(Math.abs(result.col-.9*C.LIGHT_STREAK_HDR*values.tail*values.radial*values.fade)<1e-12);cases++;
  }
  const heads=Array.from({length:6},(_,i)=>sample(i/60,0).values[0].head),advance=360/C.LIGHT_STREAK_LAP/60;
  for(let i=1;i<6;i++)assert.ok(Math.abs((heads[i]-heads[i-1])*180/Math.PI-advance)<1e-12);
  assert.ok(Math.abs(sample(C.LIGHT_STREAK_LAP,0).values[0].head-sample(0,0).values[0].head-2*Math.PI)<1e-12);
  const behind=sample(0,.3-C.LIGHT_STREAK_TAIL).values[0],ahead=sample(0,.3+.01).values[0];
  assert.ok(Math.abs(behind.tail-Math.exp(-1))<1e-12);
  assert.ok(Math.abs(ahead.tail-Math.exp(-(2*Math.PI-.01)/C.LIGHT_STREAK_TAIL))<1e-12);
  assert.ok(ahead.tail<behind.tail,'尾は先頭の後ろ側');
  assert.equal(sample(0,.3).values[0].radial,1);
  const lodWidth=Math.max(C.LIGHT_STREAK_WIDTH,4*.1*C.LIGHT_STREAK_LOD),lodPeak=C.LIGHT_STREAK_WIDTH/lodWidth;
  assert.ok(Math.abs(sample(0,.3,4,.1).values[0].radial-lodPeak)<1e-15);
  assert.equal(sample(C.LIGHT_STREAK_LIFE/2,0).values[0].fade,.25);
  for(const age of [-.01,C.LIGHT_STREAK_LIFE,C.LIGHT_STREAK_LIFE+.3]){assert.equal(sample(age,0).col,0);assert.equal(sample(age,0).values.length,0);}
  const additiveHDR=2*.9*C.LIGHT_STREAK_HDR;
  streaks[1]={...streaks[0]};assert.equal(sample(0,.3).col,additiveHDR,'複数の筋は加算');
  console.log('UW-78 formulaCases='+cases+' maxError='+maxError+' headAdvanceDegreesPer60fps='+advance+
    ' sixFrames=6 lap='+C.LIGHT_STREAK_LAP+' tailAt'+C.LIGHT_STREAK_TAIL+'rad='+behind.tail+' radialCenter=1 LODwidth='+lodWidth+' LODpeak='+lodPeak+' halfLifeFade=.25 expiredEmission=0 additiveHDR='+additiveHDR);
});

test('UW-79 WORLD-30 キック包絡は光だけに反応・全6kindで重力不動・同時刻/reset再演',()=>{
  let cases=0,maxError=0;
  for(const kind of ['intro','build','drop','break','main','outro']){
    const {input,f,analyzer}=setup([kind]);input.tSec=3;analyzer.step(input);
    const streaks=analyzer.streaks.slice();f.raw[layout.ONSET_FLAGS]=1;input.tSec=4;analyzer.step(input);
    assert.equal(analyzer.music[0],1);assert.equal(analyzer.lastKick,4);assert.deepEqual(analyzer.streaks,streaks);
    for(const age of [0,1/60,1/36,1/18,1/12,.1,.18,.7]){
      f.raw[layout.ONSET_FLAGS]=0;input.tSec=4+age;analyzer.step(input);
      assert.deepEqual(Array.from(analyzer.gravity),[1.5,1,3]);
      const error=Math.abs(analyzer.music[0]-Math.exp(-age/.18));maxError=Math.max(maxError,error);assert.ok(error<1e-7);
      const repeat=analyzer.gravity.slice();analyzer.step(input);assert.deepEqual(analyzer.gravity,repeat);cases++;
    }
    f.raw[layout.ONSET_FLAGS]=1;input.tSec=5;analyzer.step(input);assert.equal(analyzer.music[0],1);
    f.raw[layout.ONSET_FLAGS]=0;input.tSec=5+.1;analyzer.step(input);const music=analyzer.music.slice();
    analyzer.reset();f.raw[layout.ONSET_FLAGS]=1;input.tSec=5;analyzer.step(input);
    f.raw[layout.ONSET_FLAGS]=0;input.tSec=5+.1;analyzer.step(input);assert.deepEqual(analyzer.music,music);
  }
  assert.equal(C.QUAKE_GAIN,undefined);assert.equal(C.QUAKE_HZ,undefined);
  console.log('UW-79 fixedGravityKickCases='+cases+' envelopeMaxError='+maxError+' gravityDelta=0 quakeRemoved=true replayError=0');
});
test('UW-80 WORLD-30 variation 1〜5・初回/偶数構図保持・再登場奇数の左右反転・第2drop行',()=>{
  let cases=0;
  for(const kind of ['intro','build','drop','break','main','outro'])for(const variation of [1,2,3,4,5])for(const p of [0,.25,.5,1]){
    const {input,engine,analyzer}=setup(new Array(variation).fill(kind));
    engine.sectionIndex=variation-1;assert.equal(engine.score.sections[variation-1].variation,variation);
    input.tSec=(variation-1)*10+p*10;analyzer.step(input);
    const row=runtime.get('WORLD_GARGANTUA_CAMERA')[kind],progress=p*p*(3-2*p),expected=[];
    for(let i=0;i<7;i++)expected.push(row[i*2]+(row[i*2+1]-row[i*2])*progress);
    if(kind==='drop'&&variation>=2){expected[0]=27;expected[1]=-6-2*progress;expected[2]=-10-2*progress;expected[3]=-9;}
    if(variation>=3&&variation%2===1){expected[2]*=-1;expected[3]*=-1;}
    for(let i=1;i<=4;i++)expected[i]*=Math.PI/180;
    for(let i=0;i<7;i++)assert.ok(Math.abs(analyzer.cameraShot[i]-expected[i])<1e-14,kind+' variation='+variation+' item='+i);cases++;
  }
  for(const name of Object.keys(C))assert.ok(!name.startsWith('SECOND_DROP_'));
  console.log('UW-80 variationCases='+cases+' repeatedOddMirror=3,5 firstUnmirrored=true secondDropDist=27 gain=1.35');
});
test('UW-81 WORLD-30 音量の周回倍率clamp・高域8本の生bandsSmooth平均・露出式保持',()=>{
  const {input,f,analyzer}=setup(['main']);let cases=0,maxError=0;
  for(const loudness of [-10,-.125,0,.5,1,1.25,10]){
    f.raw[layout.LEVEL]=loudness;f.bandsSmooth.fill(.9);for(let i=24;i<32;i++)f.bandsSmooth[i]=(i-24)/8;
    input.tSec=5;input.dt=.25;const before=analyzer.azim;analyzer.step(input);
    const factor=Math.max(.5,Math.min(1.6,1+.8*(f.loudness.level-.5))),expected=before+.03*factor*.25;
    const error=Math.abs(analyzer.azim-expected);maxError=Math.max(maxError,error);assert.ok(error<1e-15);
    assert.equal(analyzer.view2[3],.4375);assert.equal(analyzer.exposureMultiplier,.85+.3*f.loudness.level);cases++;
  }
  input.dt=0;const before=analyzer.azim;analyzer.step(input);assert.equal(analyzer.azim,before);
  analyzer.reset();assert.equal(analyzer.view2[3],0);assert.equal(analyzer.azim,0);
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT');assert.match(shader,/\(stars\+min\(vec3\(BACKGROUND_MAX\),milk\)\)\*\(1\.\+STAR_HIGH_GAIN\*view2\.w\)/);
  assert.match(shader,/TWINKLE_BASE\+TWINKLE_GAIN\*sin\(phase\+music\.w\*\.25\+music\.y\*TWINKLE_ONSET\)/);
  console.log('UW-81 loudnessCases='+cases+' orbitClamp=.5..1.6 maxError='+maxError+' high8Mean=.4375 starGain='+ (1+1.5*.4375)+' zeroDtDelta=0');
});
test('UW-82 WORLD-30 traceRayのview2式をCPU評価・基底の直交性・正offXは穴を左へ・撮影投影の往復',async()=>{
  const {world17View,world17Project}=await import('../world/shoot-live.mjs');
  const shader=runtime.get('WORLD_GARGANTUA_FRAGMENT'),start=shader.indexOf(' vec3 camPos=cameraPosition();'),end=shader.indexOf(' float h2=',start);
  const body=shader.slice(start,end)
    .replace('normalize(-camPos)','normalize(scale(camPos,-1))')
    .replaceAll('vec3(0,1,0)','[0,1,0]')
    .replace('normalize(forward+right*tan(view2.y)+up*tan(view2.z))','normalize(add(forward,add(scale(right,tan(view2.y)),scale(up,tan(view2.z)))))')
    .replace('cos(view2.x)*right+sin(view2.x)*up','add(scale(right,cos(view2.x)),scale(up,sin(view2.x)))')
    .replace('-sin(view2.x)*right+cos(view2.x)*up','add(scale(right,-sin(view2.x)),scale(up,cos(view2.x)))')
    .replace('(uv*2.-1.)*vec2(outputResolution.x/outputResolution.y,1.)*tan(radians(FOV)*.5)','[(uv[0]*2-1)*outputResolution[0]/outputResolution[1]*tan(radians(FOV)*.5),(uv[1]*2-1)*tan(radians(FOV)*.5)]')
    .replace('normalize(forward+r2*p.x+u2*p.y)','normalize(add(forward,add(scale(r2,p[0]),scale(u2,p[1]))))')
    .replaceAll(/\bvec[23]\b/g,'let').replaceAll(/view2\.([xyz])/g,(_,c)=>'view2['+'xyz'.indexOf(c)+']');
  const normalize=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);},scale=(v,k)=>v.map(x=>x*k),add=(a,b)=>a.map((x,i)=>x+b[i]),
    dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const evaluate=new Function('cameraPosition','view2','uv','outputResolution','normalize','scale','add','cross',
    'const {sin,cos,tan}=Math,FOV=22,radians=x=>x*Math.PI/180;'+body+'return {forward,right:r2,up:u2,dir};');
  const poses=Object.values(runtime.get('WORLD_GARGANTUA_CAMERA')).map(row=>[row[0],row[2],row[4],row[6],row[8]]);
  poses.push([27,-6,-10,-9,-2],[27,-8,12,9,-2]);let cases=0,maxError=0;
  for(const [dist,inc,roll,offX,offY] of poses)for(const azim of [0,.7,2.8])for(const [w,h] of [[1280,720],[720,720]]){
    const camera=[dist,inc*Math.PI/180,azim,1],view2=[roll*Math.PI/180,offX*Math.PI/180,offY*Math.PI/180,.5],
      position=()=>scale([Math.cos(camera[1])*Math.cos(azim),Math.sin(camera[1]),Math.cos(camera[1])*Math.sin(azim)],dist),view=world17View(camera,view2);
    for(const dx of [-50,0,50])for(const dy of [-40,0,40]){
      const screen=world17Project(view,w,h,dx,dy),actual=evaluate(position,view2,[screen.x/w,screen.y/h],[w,h],normalize,scale,add,cross),
        focal=h/(2*Math.tan(22*Math.PI/360)),expected=normalize(add(view.forward,add(scale(view.right,dx/focal),scale(view.up,dy/focal))));
      for(let i=0;i<3;i++){const error=Math.abs(actual.dir[i]-expected[i]);maxError=Math.max(maxError,error);assert.ok(error<1e-14);}
      for(const v of [actual.forward,actual.right,actual.up])assert.ok(Math.abs(dot(v,v)-1)<1e-14);
      assert.ok(Math.abs(dot(actual.forward,actual.right))<1e-14);assert.ok(Math.abs(dot(actual.forward,actual.up))<1e-14);
      assert.ok(Math.abs(dot(actual.right,actual.up))<1e-14);cases++;
    }
  }
  const base=[30,0,0,1],center=world17Project(world17View(base,[0,0,0,0]),1280,720,0,0);
  assert.deepEqual(center,{x:640,y:360});
  const left=world17Project(world17View(base,[0,9*Math.PI/180,0,0]),1280,720,0,0);assert.ok(left.x<640);assert.equal(left.y,360);
  const rolled=world17Project(world17View(base,[Math.PI/2,0,0,0]),1280,720,50,0);assert.ok(Math.abs(rolled.x-640)<1e-12);assert.equal(rolled.y,310);
  console.log('UW-82 CPUProjectionCases='+cases+' maxRayError='+maxError+' positiveOffXShadowX='+left.x+' centered=640,360 roll90MapsRightToDown=true');
});
