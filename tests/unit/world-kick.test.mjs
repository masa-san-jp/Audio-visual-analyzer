// 目的 — キック休止ゲイン・減衰・postへの伝達と撮影の適用条件を検査する — doc/20261004-design-gargantua-v1.md §10.13
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';
import { WORLD17_CHECKS, world17Correlation, world17RealKick, world23LiveAcceptance } from '../world/shoot-live.mjs';

const scripts=[...fs.readFileSync(new URL('../../world.html',import.meta.url),'utf8').matchAll(/<script\s+src="([^"]+)"/g)].map(m=>m[1]);
const r=loadClassic(scripts),C=r.get('WORLD_GARGANTUA');
const smoothstep=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);

test('UW-68 WORLD-23 定数・実musicGain式の休止/ピーク/100ms・半径境界',()=>{
  for(const [name,value] of Object.entries({KICK_REST:.55,KICK_GAIN:3.5,KICK_SECONDS:.18,KICK_BLOOM:.8,KICK_RADIUS:6.5}))assert.equal(C[name],value,name);
  const shader=r.get('WORLD_GARGANTUA_FRAGMENT');
  for(const name of ['KICK_REST','KICK_GAIN','KICK_SECONDS','KICK_BLOOM'])assert.ok(shader.includes(`const float ${name} = ${C[name].toFixed(8)};`));
  // 製品GLSLのスカラー関数本体を評価し、式の転記だけで合格するテストを避ける。
  const body=shader.match(/float musicGain\(float rd\)\{([\s\S]*?)\n\}/)?.[1];assert.ok(body);
  const gain=new Function('rd','bands','music','C','smoothstep','mix','clamp','fract',
    'const {DISK_INNER,BAND_OUTER,BAND_COUNT,BAND_BLEND,MUSIC_BASE,MUSIC_GAIN,KICK_RADIUS,KICK_REST,KICK_GAIN}=C;'+
    body.replaceAll(/\bfloat\s+|\bint\s+/g,'let ').replace('float(BAND_COUNT)','BAND_COUNT')
      .replace('int(floor(x))','Math.floor(x)').replaceAll('floor(','Math.floor(').replace('Math.Math.floor','Math.floor'));
  const bands=Array.from({length:32},()=>({x:.4})),base=.45+2.2*.4;
  const evaluate=(rd,kick)=>gain(rd,bands,{x:kick},C,smoothstep,(a,b,t)=>a+(b-a)*t,(x,lo,hi)=>Math.max(lo,Math.min(hi,x)),x=>x-Math.floor(x))/base;
  const at100=Math.exp(-.1/.18);
  for(const kick of [0,at100,1]){
    close(evaluate(3,kick),.55*(1+3.5*kick));
    close(evaluate(4.75,kick),.775*(1+1.75*kick));
    for(const rd of [6.5,7,14,20])close(evaluate(rd,kick),1);
    for(const rd of [3,6.5])assert.ok(Math.abs(evaluate(rd+1e-7,kick)-evaluate(rd-1e-7,kick))<1e-12);
  }
  close(evaluate(3,1)/evaluate(3,0),4.5);
  console.log('UW-68 innerRest='+evaluate(3,0)+' innerPeak='+evaluate(3,1)+' peakRestRatio=4.5 kick100ms='+at100+' inner100ms='+evaluate(3,at100)+' kick470ms='+Math.exp(-.47/.18));
});

test('UW-69 WORLD-23 engine→post→uniform・全他タイプは0・ブルーム/フレア実式',()=>{
  const uniforms=new Map(),gl={canvas:{width:1280,height:720},uniform1f:(loc,value)=>uniforms.set(loc,value),uniform2f(){},uniform1i(){},bindFramebuffer(){},blitFramebuffer(){}};
  const target=(width,height)=>({width,height,fbo:{}}),gpu={gl,program:source=>source,texture:(program,name)=>name,
    target,pair:(w,h)=>({read:target(w,h),write:target(w,h)}),bind(){},sampler(){},draw(){},swap(pair){[pair.read,pair.write]=[pair.write,pair.read];}};
  const post=new (r.get('WorldPost'))(gpu,1280,720);assert.equal(post.kick,0);assert.equal(post.kickLoc,'kick');
  const engine={post,scene:{},fadeElapsed:.5,previousPostMode:1,type:{id:'g-gargantua',music:new Float32Array([.6]),exposureMultiplier:1.1}};
  const draw=r.get('WorldEngine').prototype._draw;draw.call(engine);
  assert.equal(post.kick,engine.type.music[0]);assert.equal(uniforms.get('kick'),engine.type.music[0]);
  assert.equal(uniforms.get('gargantuaMode'),1);assert.equal(uniforms.get('exposureMultiplier'),1.1);
  for(const id of ['g-fluid','g-rings','g-galaxy']){engine.type={id};draw.call(engine);assert.equal(post.kick,0);assert.equal(uniforms.get('kick'),0);}
  const shader=r.get('WORLD_POST_FRAGMENT'),branch=shader.slice(shader.indexOf('if(gargantuaMode>.5)'),shader.indexOf('if(screen.w>.5||mood.x<=0.)'));
  assert.ok(shader.includes('const float KICK_BLOOM = 0.80000000;'));
  const bloom=branch.match(/bloom\*GARGANTUA_BLOOM_STRENGTH[^;]+/)[0],veil=branch.match(/b3\*VEIL_GAIN[^;]+/)[0];
  assert.ok(branch.indexOf(veil)<branch.indexOf('c=aces('));
  for(const [expr,sourceName,scale] of [[bloom,'bloom',.9],[veil,'b3',.1]]){
    const value=new Function(sourceName,'GARGANTUA_BLOOM_STRENGTH','VEIL_GAIN','KICK_BLOOM','kick','return '+expr);
    for(const kick of [0,Math.exp(-.1/.18),1])close(value(2,C.BLOOM_STRENGTH,C.VEIL_GAIN,C.KICK_BLOOM,kick),2*scale*(1+.8*kick));
  }
  console.log('UW-69 kickUniform=.6000000238418579 otherTypesZero=3 bloomRest/Peak=1.8/3.24 veilRest/Peak=.2/.36 multiplier100ms='+(1+.8*Math.exp(-.1/.18)));
});

test('UW-70 WORLD-23 無分散/無キックの除外・1e-3境界・35%/25%境界・集計',()=>{
  assert.equal(WORLD17_CHECKS.G1_MIN_STD_DEV,1e-3);assert.equal(WORLD17_CHECKS.KICK_INCREASE,.35);
  assert.equal(WORLD17_CHECKS.KICK_100MS_INCREASE,.25);assert.equal(WORLD17_CHECKS.STAR_PIXELS,30);
  const rows=amplitude=>Array.from({length:22},(_,i)=>({tSec:i/40,levels:Array.from({length:32},(_,b)=>b===0?amplitude*(i%2?1:-1):0),
    luminance:Array.from({length:32},(_,b)=>b===0?amplitude*(i%2?1:-1):0),counts:new Array(32).fill(1)}));
  const quiet=world17Correlation(rows(.000999)),boundary=world17Correlation(rows(.001));
  assert.equal(quiet.applicable,false);assert.equal(boundary.applicable,true);close(boundary.bandStdDevs[0],.001);
  assert.equal(world17Correlation([]).applicable,true);assert.equal(world17Correlation([]).pass,false);
  const emptyRoi=world17Correlation(rows(.01).map(row=>({...row,counts:new Array(32).fill(0)})));assert.equal(emptyRoi.applicable,true);assert.equal(emptyRoi.pass,false);
  const kicks=Array.from({length:18},(_,i)=>({tSec:(54+i)/60,inner:i<6?1:i<12?1.36:1.25,innerCount:12,onset:i===6}));
  // 35%境界は2標本の平均で確認する。6回の1.35加算では丸めにより閾値直下になる。
  const boundaryKick=kicks.filter((row,i)=>[0,3,6,9,12].includes(i)).map(row=>({...row,inner:row.inner===1.36?1.35:row.inner}));
  const hit=world17RealKick(boundaryKick,1);assert.equal(hit.applicable,true);assert.equal(hit.pass,true);close(hit.increase,.35);close(hit.at100msIncrease,.25);
  const noKick=world17RealKick(kicks.map(row=>({...row,onset:false})),1);assert.equal(noKick.applicable,false);
  const missingPre=world17RealKick(kicks.slice(6),1);assert.equal(missingPre.applicable,true);assert.equal(missingPre.pass,false);
  for(const bad of [kicks.map((row,i)=>({...row,inner:i>=6&&i<12?1.3499:row.inner})),kicks.map((row,i)=>({...row,inner:i>=12?1.2499:row.inner})),
    kicks.slice(0,12),kicks.map(row=>({...row,innerCount:0})),kicks.map((row,i)=>({...row,onset:i===6||i===10}))]){
    const result=world17RealKick(bad,1);assert.equal(result.applicable,true);assert.equal(result.pass,false);
  }
  const excluded={mfsFrames:22,g1:quiet,kick:noKick},active={mfsFrames:22,g1:{applicable:true,pass:true},kick:hit};
  const result=world23LiveAcceptance([excluded,active],{pass:true});assert.deepEqual(result,{g1Applicable:1,kickApplicable:1,pass:true});
  assert.equal(world23LiveAcceptance([excluded],{pass:true}).pass,true);
  for(const row of [{...active,g1:emptyRoi},{...active,kick:missingPre},{...active,mfsFrames:0}])assert.equal(world23LiveAcceptance([row],{pass:true}).pass,false);
  assert.equal(world23LiveAcceptance([active],{pass:false}).pass,false);
  console.log('UW-70 quietStd=.000999 excluded boundaryStd='+boundary.bandStdDevs[0]+' applicable peakIncrease='+hit.increase+' at100msIncrease='+hit.at100msIncrease+' applicableCounts=1/1 missingData/weakKick/GPURejected=true');
});
