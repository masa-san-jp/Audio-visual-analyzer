// 目的 — g-fluid v2 の実GPU：噴出口ごとの染料・キックの外向き押し出し・7区間の撮影・再演一致・1080p計測・書き出し — doc/20261010-design-fluid-v2.md §11
// @page harness
async function world38Page(run) {
  const iframe=document.createElement('iframe');iframe.src=new URL('../browser/harness/world.html',location.href).href;
  const ready=new Promise((resolve,reject)=>{iframe.onload=resolve;iframe.onerror=()=>reject(new Error('world.html load failed'));});
  document.body.appendChild(iframe);
  try {await ready;const child=iframe.contentWindow;avzAssert.ok(child.__world?.engine,child.__world?.error);return await run(child);}
  finally {const w=iframe.contentWindow.__world;w?.audio?.pause();w?.audioEngine?.ctx?.close();w?.engine?.dispose();iframe.remove();}
}
// 7区間（intro/build/drop/break/main/outro＋drop）の短い曲。各区間 6 秒。
const WORLD38_SECTIONS="[['intro',0],['build',6],['drop',12],['break',18],['main',24],['drop',30],['outro',36]].map(([kind,startSec],i)=>({kind,label:'S'+i,startSec,endSec:startSec+6}))";
if(typeof avzGpuTest==='function')avzGpuTest('BW-38-jets','実GPU：帯域の噴出口だけが染料を出す・キックで円環から外向きの速度',async()=>{
  const result=await world38Page(child=>child.eval(`(()=>{
    const e=__world.engine,gl=e.gpu.gl;e.selectType('g-fluid',true);
    const score=compileWorldScore({bpm:120,durationSec:12,beats:[],downbeatIndices:[],sections:[{kind:'main',label:'J',startSec:0,endSec:12}]},11);
    e.setScore(score);e.timeline=null;
    const resources=[e.gpu.textures.length,e.gpu.fbos.length,e.gpu.programs.length];
    const f=new MfsFrameView();f.raw.fill(0);f.bandsSmooth.fill(0);f.bandsSmooth[5]=.95;f.raw[MFS_LAYOUT.LEVEL]=.7;
    for(let i=0;i<90;i++)e.render(i/60,f,i?1/60:0);
    const a=e.type,C=WORLD_FLUID2;
    const dye=new Float32Array(C.DYE_W*C.DYE_H*4);gl.bindFramebuffer(gl.FRAMEBUFFER,a.dye.read.fbo);gl.readPixels(0,0,C.DYE_W,C.DYE_H,gl.RGBA,gl.FLOAT,dye);
    // 噴出口 i の周囲 ±12 画素の染料輝度の合計。
    const around=i=>{const p=[0,0];worldFluid2JetPosition(i,p);const cx=Math.round((p[0]/C.SIM_ASPECT*.5+.5)*C.DYE_W),cy=Math.round((p[1]*.5+.5)*C.DYE_H);let sum=0;
      for(let dy=-12;dy<=12;dy++)for(let dx=-12;dx<=12;dx++){const o=((cy+dy)*C.DYE_W+cx+dx)*4;sum+=dye[o]+dye[o+1]+dye[o+2];}return sum;};
    const own=around(5),others=[];for(let i=0;i<32;i++)if(Math.abs(i-5)>3)others.push(around(i));
    let nonfinite=0;for(let i=0;i<dye.length;i++)if(!Number.isFinite(dye[i]))nonfinite++;
    // キック：無音にして染料と速度が落ち着いてから低域オンセットを 1 フレーム与える。
    e.setScore(score);f.bandsSmooth.fill(0);
    for(let i=0;i<60;i++)e.render(i/60,f,i?1/60:0);
    const velocity=new Float32Array(C.VEL_W*C.VEL_H*4),radial=()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,a.velocity.read.fbo);gl.readPixels(0,0,C.VEL_W,C.VEL_H,gl.RGBA,gl.FLOAT,velocity);
      let sum=0,n=0;for(let k=0;k<32;k++){const p=[0,0];worldFluid2JetPosition(k,p);const x=Math.round((p[0]/C.SIM_ASPECT*.5+.5)*C.VEL_W),y=Math.round((p[1]*.5+.5)*C.VEL_H),o=(y*C.VEL_W+x)*4;
        sum+=(velocity[o]*p[0]+velocity[o+1]*p[1])/C.R0;n++;}return sum/n;};
    const before=radial();f.raw[MFS_LAYOUT.ONSET_FLAGS]=1;e.render(60/60,f,1/60);f.raw[MFS_LAYOUT.ONSET_FLAGS]=0;const after=radial();
    e.render(61/60,f,1/60);const later=radial();
    return {own,maxOther:Math.max(...others),before,after,later,nonfinite,resourceGrowth:[e.gpu.textures.length-resources[0],e.gpu.fbos.length-resources[1],e.gpu.programs.length-resources[2]],glError:gl.getError()};
  })()`));
  console.log('BW-38-jets '+JSON.stringify(result));
  avzAssert.equal(result.glError,0);avzAssert.equal(result.nonfinite,0);avzAssert.deepEqual(result.resourceGrowth,[0,0,0]);
  avzAssert.ok(result.own>0&&result.own>result.maxOther*3,'対応する噴出口の染料が最大');
  avzAssert.ok(result.after-result.before>.2,'キック直後に円環から外向きの速度');
});
if(typeof avzGpuTest==='function')avzGpuTest('BW-38-sections','1280×720 7区間の撮影・白飛び上限・同時刻の再演一致・逆シーク一致',async()=>{
  const result=await world38Page(child=>child.eval(`(async()=>{
    const e=__world.engine;e.resize(1280,720);e.selectType('g-fluid',true);
    const score=compileWorldScore({bpm:120,durationSec:42,beats:[],downbeatIndices:[],sections:${WORLD38_SECTIONS}},11);
    e.setScore(score);e.timeline=null;const shots=[];
    for(const s of score.sections){
      await e.renderAt(s.startSec+4);const c=e.capture();
      shots.push({kind:s.kind,mean:c.mean,clipped:c.clippedFraction,hdrMax:c.hdrMax,glError:c.glError});
    }
    await e.renderAt(20);const first=e.capture().rgba.slice();await e.renderAt(8);await e.renderAt(20);const second=e.capture().rgba;
    let replayDiff=0;for(let i=0;i<first.length;i++)replayDiff=Math.max(replayDiff,Math.abs(first[i]-second[i]));
    return {shots,replayDiff,glError:e.gpu.gl.getError()};
  })()`));
  console.log('BW-38-sections '+JSON.stringify(result));
  avzAssert.equal(result.glError,0);avzAssert.equal(result.shots.length,7);
  for(const s of result.shots){avzAssert.equal(s.glError,0);avzAssert.ok(Number.isFinite(s.hdrMax));avzAssert.ok(s.clipped<=.02,'白飛び '+JSON.stringify(s));}
  avzAssert.equal(result.replayDiff,0);
},{timeoutMs:300000,slow:true});
if(typeof avzGpuTest==='function')avzGpuTest('BW-38-gpu','w13sync: 1080p・GPU完了を同期して計測・p95≤16ms',async()=>{
  const result=await world38Page(child=>child.eval(`(async()=>{
    const e=__world.engine,gl=e.gpu.gl;e.resize(1920,1080);e.selectType('g-fluid',true);
    e.setScore(compileWorldScore({bpm:120,durationSec:8,beats:[],downbeatIndices:[],sections:[{kind:'drop',label:'H',startSec:0,endSec:8}]},11));
    e.timeline=null;const f=new MfsFrameView();f.bandsSmooth.fill(.8);f.raw[MFS_LAYOUT.LEVEL]=.8;
    for(let i=0;i<360;i++){
      f.raw[MFS_LAYOUT.ONSET_FLAGS]=i%30===0?5:0;const start=performance.now();e.render(i/60,f,1/60);gl.finish();e.endCpuTiming(performance.now()-start);
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    const m=e.metrics(),ext=gl.getExtension('WEBGL_debug_renderer_info'),renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    return {method:'w13sync',width:m.width,height:m.height,fluidWidth:m.fluidWidth,dyeWidth:m.dyeWidth,gpuP95Ms:m.gpuP95Ms,cpuP95Ms:m.cpuP95Ms,
      samples:m.timingSamples,timerAvailable:m.timerAvailable,disjoints:m.timerDisjoints,renderer,hardware:!!ext&&!/swiftshader|llvmpipe|software/i.test(renderer),glError:gl.getError()};
  })()`));
  console.log('BW-38-gpu '+JSON.stringify(result));avzAssert.equal(result.glError,0);avzAssert.equal(result.width,1920);avzAssert.equal(result.height,1080);
  avzAssert.equal(result.fluidWidth,384);avzAssert.equal(result.dyeWidth,1152);
  avzAssert.ok(result.hardware);avzAssert.ok(result.timerAvailable);avzAssert.equal(result.disjoints,0);
  avzAssert.ok(result.samples>=120);avzAssert.ok(result.gpuP95Ms!==null&&result.gpuP95Ms<=16);
},{timeoutMs:180000,slow:true});
if(typeof avzGpuTest==='function')avzGpuTest('BW-38-export','typeId g-fluid で実WebCodecsの音声入り1080p・30枚の書き出し',async()=>{
  await world38Page(async child=>{
    for(const name of ['mp4-demuxer','webm-demuxer']){
      const script=child.document.createElement('script');script.src=new URL('../../js/'+name+'.js',location.href).href;
      await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;child.document.body.appendChild(script);});
    }
    const result=await child.eval(`(async()=>{
      const buffer=new AudioBuffer({length:48000,numberOfChannels:2,sampleRate:48000});
      for(let c=0;c<2;c++){const data=buffer.getChannelData(c);for(let i=0;i<data.length;i++)data[i]=.1*Math.sin(2*Math.PI*180*i/48000);}
      const frames=Array.from({length:31},()=>{const f=new MfsFrameView();f.bandsSmooth.fill(.6);f.raw[MFS_LAYOUT.LEVEL]=.7;return f.raw.slice();});
      const score=compileWorldScore({bpm:120,durationSec:1,beats:[],downbeatIndices:[],sections:[{kind:'intro',label:'L',startSec:0,endSec:1}]},11);
      const exporter=new WorldExporter(),blob=await exporter.exportWorld(score,{audioBuffer:buffer,fps:30,frameCount:30,featureFrames:frames},{typeId:'g-fluid'});
      const bytes=new Uint8Array(await blob.arrayBuffer()),parsed=blob.type==='video/mp4'?Mp4Demuxer.parse(bytes):WebmDemuxer.parse(bytes);
      const decoded=await new OfflineAudioContext(2,1,48000).decodeAudioData(await blob.arrayBuffer());let energy=0;
      for(const sample of decoded.getChannelData(0))energy+=sample*sample;
      return {frames:parsed.chunks.length,width:parsed.codedWidth,height:parsed.codedHeight,audioSeconds:decoded.duration,audioRms:Math.sqrt(energy/decoded.length),state:exporter.state,bytes:blob.size};
    })()`);
    console.log('BW-38-export '+JSON.stringify(result));avzAssert.equal(result.frames,30);avzAssert.equal(result.width,1920);avzAssert.equal(result.height,1080);
    avzAssert.close(result.audioSeconds,1,.1);avzAssert.ok(result.audioRms>1e-4);avzAssert.equal(result.state,'done');avzAssert.ok(result.bytes>0);
  });
},{timeoutMs:180000,slow:true});
