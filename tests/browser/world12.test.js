// 目的 — 詳細設計v1の実GLSL・32×1024点・実再生撮影と相関を検証する — doc/20261004-design-gpu-analyzers-v1.md §1〜5
// @page harness
function world12Median(values) {
  const sorted=values.slice().sort((a,b)=>a-b),n=sorted.length;
  return n?(n%2?sorted[n>>1]:(sorted[n/2-1]+sorted[n/2])/2):0;
}
function world12CorrelationReport(records,typeId) {
  if(typeId==='g-fluid')return {typeId,applicable:false,reason:'§5はringsの扇形とgalaxyの軌道環を指定。g-fluid v2は円環の噴出口でBW-38が検査'};
  const correlations=[];
  for(let i=0;i<32;i++)correlations.push(world11Correlation(records.map(r=>r.levels[i]),records.map(r=>r.luminance[i])));
  const median=world12Median(correlations);
  return {typeId,applicable:true,samples:records.length,correlations,median,pass:records.length>=2&&median>=.6};
}
async function world12Shoot(typeId,tSec) {
  const w=window.__world,app=w.app,e=w.engine,audio=w.audio;
  if(tSec<1.5||tSec>=w.score.durationSec)throw new RangeError('撮影時刻は1.5秒以上、曲長未満');
  if(!['g-rings','g-galaxy','g-fluid'].includes(typeId))throw new RangeError('未実装のタイプ');
  audio.pause();cancelAnimationFrame(app.raf);app.state='paused';
  e.selectType(typeId,true);e.setScore(w.score);
  // この計測だけlive AudioWorkletを使う。製品の固定offline timelineは変更しない。
  const timeline=e.timeline;e.timeline=null;app.audioEngine.resetAnalysis();
  const start=tSec-1.5;
  if(Math.abs(audio.currentTime-start)>1e-6){
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();reject(new Error('seek timeout'));},10000);
      function cleanup(){clearTimeout(timer);audio.removeEventListener('seeked',seeked);audio.removeEventListener('error',failed);}
      function seeked(){cleanup();resolve();}function failed(){cleanup();reject(new Error('audio seek error'));}
      audio.addEventListener('seeked',seeked);audio.addEventListener('error',failed);audio.currentTime=start;
    });
  }
  app.previousSec=audio.currentTime;
  const records=[];let resolveShot,rejectShot;
  const completed=new Promise((resolve,reject)=>{resolveShot=resolve;rejectShot=reject;});
  const timeout=setTimeout(()=>rejectShot(new Error('playback/screenshot timeout')),30000);
  let previousTime=-1;
  e.onFrame=()=>{
    try {
      const capture=e.capture(),analyzer=e.type,time=e.latestSec;
      if(capture.glError)throw new Error('GL error '+capture.glError);
      if(time!==previousTime){
        const levels=Array.from({length:32},(_,i)=>analyzer.bandUniforms[i*4]);
        const state={tSec:e.latestSec,speed:analyzer.songUniforms[0],beat:analyzer.pulseUniforms[0],bass:analyzer.pulseUniforms[2]};
        const luminance=typeId==='g-fluid'?null:world11RegionSamples(capture,typeId,state);
        records.push({tSec:time,levels,luminance});previousTime=time;
      }
      if(time>=tSec){
        audio.pause();app.state='paused';e.onFrame=null;
        // captureはこの最初のrAFの最終出力。上下反転してPNGにする。
        const canvas=document.createElement('canvas');canvas.width=capture.width;canvas.height=capture.height;
        const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height),stride=canvas.width*4;
        for(let y=0;y<canvas.height;y++)image.data.set(capture.rgba.subarray((canvas.height-1-y)*stride,(canvas.height-y)*stride),y*stride);
        ctx.putImageData(image,0,0);
        resolveShot({typeId,requestedSec:tSec,capturedSec:time,records,png:canvas.toDataURL('image/png'),
          g1:world12CorrelationReport(records,typeId),mfsFrames:e.mfsFrames,clippedFraction:capture.clippedFraction,metrics:e.metrics()});
      }
    }catch(error){e.onFrame=null;rejectShot(error);}
  };
  try {await app.start();return await completed;}
  finally {clearTimeout(timeout);audio.pause();cancelAnimationFrame(app.raf);app.state='paused';e.onFrame=null;e.timeline=timeline;}
}
if(typeof avzTest==='function')avzTest('BW-12-design','指定GLSLを実コンパイル・無音/強入力・32×1024点・旧post pulseなし・白飛び上限',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../../world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  try {
    await ready;const child=iframe.contentWindow;avzAssert.ok(child.__world?.engine,child.__world?.error);
    const rows=child.eval(`(()=>{
      const e=__world.engine,score=compileWorldScore({bpm:128,durationSec:4,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:4,kind:'main',label:'v1'}]},11),f=new MfsFrameView(),rows=[];
      for(const id of ['g-galaxy','g-fluid'])for(const raw of [0,.82]){
        if(!e.types.some(type=>type.id===id)){const legacy=id==='g-rings'?new WorldRingsAnalyzer():new WorldGalaxyAnalyzer();legacy.init(e.gpu);e.types.push(legacy);}
        e.selectType(id,true);e.setScore(score);f.raw.fill(0);f.bandsSmooth.fill(raw);f.raw[MFS_LAYOUT.LEVEL]=.7;
        f.raw[MFS_LAYOUT.BEAT_FLAG]=1;f.raw[MFS_LAYOUT.DOWNBEAT_FLAG]=1;f.onset.env.fill(.9);
        for(let i=0;i<30;i++){e._step(i/60,f,1/60);f.raw[MFS_LAYOUT.BEAT_FLAG]=0;f.raw[MFS_LAYOUT.DOWNBEAT_FLAG]=0;}
        e._draw();const c=e.capture();rows.push({id,raw,mean:c.mean,hdrMax:c.hdrMax,clip:c.clippedFraction,glError:c.glError,particles:e.type.particleCount||0,postPulse:e.post.pulse});
      }return rows;
    })()`);
    for(const row of rows){avzAssert.equal(row.glError,0);avzAssert.equal(row.postPulse,0);avzAssert.ok(Number.isFinite(row.hdrMax));avzAssert.ok(row.clip<=.02,'BW-2-exposure '+JSON.stringify(row));if(row.id==='g-galaxy')avzAssert.equal(row.particles,32768);}
    console.log('BW-12-design '+JSON.stringify(rows));
  }finally {iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
},{timeoutMs:60000});
if(typeof module!=='undefined'&&module.exports){module.exports={world12Median,world12CorrelationReport,world12Shoot};}
