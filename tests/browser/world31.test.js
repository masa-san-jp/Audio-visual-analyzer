// 目的 — 実GLSLの状態・6ショット/変身/反応・再演・1080p同期GPU計測・書き出しを検査する — doc/20261008-design-attractor-v1.md §9
// @page harness
async function world31Page(run) {
  const iframe=document.createElement('iframe');iframe.src=new URL('../../world.html',location.href).href;
  const ready=new Promise((resolve,reject)=>{iframe.onload=resolve;iframe.onerror=()=>reject(new Error('world.html load failed'));});
  document.body.appendChild(iframe);
  try {await ready;const child=iframe.contentWindow;avzAssert.ok(child.__world?.engine,child.__world?.error);return await run(child);}
  finally {const w=iframe.contentWindow.__world;w?.audio?.pause();w?.audioEngine?.ctx?.close();w?.engine?.dispose();iframe.remove();}
}
if(typeof avzTest==='function')avzTest('BW-31-state','実RGBA32Fのseed初期化・Clifford1反復・旧座標・有限な40反復',async()=>{
  const result=await world31Page(child=>child.eval(`(()=>{
    const e=__world.engine;e.selectType('g-attractor',true);
    e.setScore(compileWorldScore({bpm:120,durationSec:10,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:10,kind:'intro',label:'L'}]},11));
    e._step(0,new MfsFrameView(),0,false);
    const a=e.type,g=e.gpu,gl=g.gl,pixels=new Float32Array(4);let seedError=0,mapError=0,oldError=0,nonfinite=0;
    const read=()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,a.stateA.read.fbo);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,pixels);};
    a._updateState(a.stateA,'L',1);read();
    const x=(worldAttractorHash(0,1,11)*2-1)*.5,y=(worldAttractorHash(0,2,11)*2-1)*.5;
    seedError=Math.max(Math.abs(pixels[0]-x),Math.abs(pixels[1]-y),Math.abs(pixels[2]-x),Math.abs(pixels[3]-y));
    a._updateState(a.stateA,'L');read();const shape=WORLD_ATTRACTOR_SHAPES.L;
    mapError=Math.max(Math.abs(pixels[0]-(Math.sin(shape[0]*y)+shape[2]*Math.cos(shape[0]*x))),Math.abs(pixels[1]-(Math.sin(shape[1]*x)+shape[3]*Math.cos(shape[1]*y))));
    oldError=Math.max(Math.abs(pixels[2]-x),Math.abs(pixels[3]-y));
    for(const name of Object.keys(WORLD_ATTRACTOR_SHAPES)){
      a._warmState(a.stateA,name);read();for(const v of pixels)if(!Number.isFinite(v))nonfinite++;
      const s=WORLD_ATTRACTOR_SHAPES[name];if(Math.abs(pixels[0])>1+Math.abs(s[2])||Math.abs(pixels[1])>1+Math.abs(s[3]))throw new Error('unbounded state '+name);
    }
    return {seedError,mapError,oldError,nonfinite,shapes:7,glError:gl.getError()};
  })()`));
  console.log('BW-31-state '+JSON.stringify(result));avzAssert.equal(result.glError,0);avzAssert.equal(result.nonfinite,0);
  avzAssert.ok(result.seedError<=1e-7);avzAssert.ok(result.oldError<=1e-7);avzAssert.ok(result.mapError<=1e-5);
},{timeoutMs:60000});
if(typeof avzTest==='function')avzTest('BW-31-render','1280×720全6区間・変身連続フレーム・キック/グリント・逆シーク再演',async()=>{
  const result=await world31Page(child=>child.eval(`(async()=>{
    const e=__world.engine;e.resize(1280,720);e.selectType('g-attractor',true);
    const kinds=['intro','build','drop','break','main','outro'],score=compileWorldScore({bpm:120,durationSec:60,beats:[],downbeatIndices:[],
      sections:kinds.map((kind,i)=>({kind,label:kind,startSec:i*10,endSec:(i+1)*10}))},11);
    const features=Array.from({length:3601},(_,i)=>{const f=new MfsFrameView();f.bandsSmooth.fill(.6);f.raw[MFS_LAYOUT.LEVEL]=.7;f.raw[MFS_LAYOUT.ONSET_FLAGS]=i%30===0?5:0;return f.raw.slice();});
    e.setScore(score);e.setTimeline(features,60);const shots=[],a=e.type,resources=[e.gpu.textures.length,e.gpu.fbos.length,e.gpu.programs.length];
    for(const t of [5,15,25,35,45,55]){
      await e.renderAt(t);const capture=e.capture();if(capture.glError)throw new Error('shot GL error');
      let lit=0;for(let i=0;i<capture.rgba.length;i+=4)if(capture.rgba[i]+capture.rgba[i+1]+capture.rgba[i+2]>0)lit++;
      shots.push({tSec:t,shape:a.shapeA,litPixels:lit,width:capture.width,height:capture.height});
      if(!lit)throw new Error('empty shot '+t);
    }
    await e.renderAt(10);let previous=e.capture().rgba,changed=0;
    for(let i=1;i<=180;i++){
      e.advanceTo(10+i/60);e._draw();const capture=e.capture();if(capture.glError)throw new Error('flight GL error');
      if(i%30===0){let diff=0;for(let k=0;k<previous.length;k++)diff+=previous[k]!==capture.rgba[k];if(diff)changed++;previous=capture.rgba;}
      if(i%30===0)await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    const finalShape=a.shapeA;
    await e.renderAt(11.5);const reference=e.capture().rgba;
    await e.renderAt(2);await e.renderAt(11.5);const replay=e.capture().rgba;let replayDiff=0;
    for(let i=0;i<reference.length;i++)replayDiff+=reference[i]!==replay[i];
    e.timeline=null;e.setScore(score);const f=new MfsFrameView();f.bandsSmooth.fill(.6);f.raw[MFS_LAYOUT.ONSET_FLAGS]=5;
    e._step(1,f,1/60);const kickPeak=a.music[0],glintPeak=a.music[1],serial=a.glintSerial;
    f.raw[MFS_LAYOUT.ONSET_FLAGS]=0;e._step(1.18,f,1/60);const kickAfter=a.music[0],glintAfter=a.music[1];
    return {shots,transitionFrames:180,changedSamples:changed,finalShape,replayDiff,kickPeak,kickAfter,glintPeak,glintAfter,serial,
      resourceGrowth:[e.gpu.textures.length,e.gpu.fbos.length,e.gpu.programs.length].map((v,i)=>v-resources[i]),glError:e.gpu.gl.getError()};
  })()`));
  console.log('BW-31-render '+JSON.stringify(result));avzAssert.equal(result.glError,0);avzAssert.equal(result.shots.length,6);
  avzAssert.deepEqual(result.shots.map(s=>s.shape),['L','J','H','A','D','L']);avzAssert.equal(result.changedSamples,6);
  avzAssert.equal(result.finalShape,'J');avzAssert.equal(result.replayDiff,0);avzAssert.deepEqual(result.resourceGrowth,[0,0,0]);
  avzAssert.equal(result.kickPeak,1);avzAssert.close(result.kickAfter,Math.exp(-1),3e-8);
  avzAssert.equal(result.glintPeak,1);avzAssert.close(result.glintAfter,Math.exp(-.18/.25),3e-8);avzAssert.equal(result.serial,1);
},{timeoutMs:240000,slow:true});
if(typeof avzTest==='function')avzTest('BW-31-gpu','w13sync: 1080p・GPU完了を同期して計測・p95≤16ms',async()=>{
  const result=await world31Page(child=>child.eval(`(async()=>{
    const e=__world.engine,gl=e.gpu.gl;e.resize(1920,1080);e.selectType('g-attractor',true);
    e.setScore(compileWorldScore({bpm:120,durationSec:8,beats:[],downbeatIndices:[],sections:[{kind:'drop',label:'H',startSec:0,endSec:8}]},11));
    e.timeline=null;const f=new MfsFrameView();f.bandsSmooth.fill(.8);f.raw[MFS_LAYOUT.LEVEL]=.8;
    // query終了後にGPUを同期させ、次フレーム冒頭で完了したtimer queryを回収する。
    for(let i=0;i<360;i++){
      f.raw[MFS_LAYOUT.ONSET_FLAGS]=i%30===0?5:0;const start=performance.now();e.render(i/60,f,1/60);gl.finish();e.endCpuTiming(performance.now()-start);
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    const m=e.metrics(),ext=gl.getExtension('WEBGL_debug_renderer_info'),renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    return {method:'w13sync',width:m.width,height:m.height,particles:e.type.particleCount,expectedParticles:WORLD_ATTRACTOR.PARTICLE_COUNT,gpuP95Ms:m.gpuP95Ms,cpuP95Ms:m.cpuP95Ms,
      samples:m.timingSamples,timerAvailable:m.timerAvailable,disjoints:m.timerDisjoints,renderer,hardware:!!ext&&!/swiftshader|llvmpipe|software/i.test(renderer),glError:gl.getError()};
  })()`));
  console.log('BW-31-gpu '+JSON.stringify(result));avzAssert.equal(result.glError,0);avzAssert.equal(result.width,1920);avzAssert.equal(result.height,1080);
  avzAssert.equal(result.particles,result.expectedParticles);avzAssert.ok(result.hardware);avzAssert.ok(result.timerAvailable);avzAssert.equal(result.disjoints,0);
  avzAssert.ok(result.samples>=120);avzAssert.ok(result.gpuP95Ms!==null&&result.gpuP95Ms<=16);
},{timeoutMs:180000,slow:true});
if(typeof avzTest==='function')avzTest('BW-31-export','typeIdだけで実WebCodecsの音声入り1080p・30枚の書き出し',async()=>{
  await world31Page(async child=>{
    for(const name of ['mp4-demuxer','webm-demuxer']){
      const script=child.document.createElement('script');script.src=new URL('../../js/'+name+'.js',location.href).href;
      await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;child.document.body.appendChild(script);});
    }
    const result=await child.eval(`(async()=>{
      const buffer=new AudioBuffer({length:48000,numberOfChannels:2,sampleRate:48000});
      for(let c=0;c<2;c++){const data=buffer.getChannelData(c);for(let i=0;i<data.length;i++)data[i]=.1*Math.sin(2*Math.PI*180*i/48000);}
      const frames=Array.from({length:31},()=>{const f=new MfsFrameView();f.bandsSmooth.fill(.6);f.raw[MFS_LAYOUT.LEVEL]=.7;return f.raw.slice();});
      const score=compileWorldScore({bpm:120,durationSec:1,beats:[],downbeatIndices:[],sections:[{kind:'intro',label:'L',startSec:0,endSec:1}]},11);
      const exporter=new WorldExporter(),blob=await exporter.exportWorld(score,{audioBuffer:buffer,fps:30,frameCount:30,featureFrames:frames},{typeId:'g-attractor'});
      const bytes=new Uint8Array(await blob.arrayBuffer()),parsed=blob.type==='video/mp4'?Mp4Demuxer.parse(bytes):WebmDemuxer.parse(bytes);
      const decoded=await new OfflineAudioContext(2,1,48000).decodeAudioData(await blob.arrayBuffer());let energy=0;
      for(const sample of decoded.getChannelData(0))energy+=sample*sample;
      return {frames:parsed.chunks.length,width:parsed.codedWidth,height:parsed.codedHeight,audioSeconds:decoded.duration,audioRms:Math.sqrt(energy/decoded.length),state:exporter.state,bytes:blob.size};
    })()`);
    console.log('BW-31-export '+JSON.stringify(result));avzAssert.equal(result.frames,30);avzAssert.equal(result.width,1920);avzAssert.equal(result.height,1080);
    avzAssert.close(result.audioSeconds,1,.1);avzAssert.ok(result.audioRms>1e-4);avzAssert.equal(result.state,'done');avzAssert.ok(result.bytes>0);
  });
},{timeoutMs:180000,slow:true});
