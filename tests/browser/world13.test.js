// 目的 — 直接像の32環・内側キック増光・実GPU p95とレンズ描画を検査する — doc/20261004-design-gargantua-v1.md §6・§7
// @page harness
function world13ReadAnnuli(engine,capture) {
  const gl=engine.gpu.gl,target=engine.type.half,pixels=new Float32Array(target.width*target.height*4);
  gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);gl.readPixels(0,0,target.width,target.height,gl.RGBA,gl.FLOAT,pixels);
  if(gl.getError())throw new Error('gargantua annulus readback GL error');
  return world13AnnulusSamples(pixels,target.width,target.height,capture);
}
function world13AnnulusSamples(pixels,w,h,capture) {
  const sums=new Float64Array(32),counts=new Uint32Array(32),hdrSums=new Float64Array(32);
  let inner=0,innerHDR=0,innerCount=0;
  for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){
    const o=(y*w+x)*4,rd=pixels[o+3];
    // alphaは測地線の最初の近側・内向き通過だけ。高次像を環に混ぜない。
    if(!(rd>=3&&rd<14))continue;
    const band=31-Math.min(31,Math.floor((rd-3)/11*32));
    const px=Math.min(capture.width-1,Math.floor((x+.5)*capture.width/w)),py=Math.min(capture.height-1,Math.floor((y+.5)*capture.height/h));
    const s=(py*capture.width+px)*4,p=capture.rgba;
    const Y=(.2126*p[s]+.7152*p[s+1]+.0722*p[s+2])/255;
    const hdr=.2126*pixels[o]+.7152*pixels[o+1]+.0722*pixels[o+2];
    sums[band]+=Y;hdrSums[band]+=hdr;counts[band]++;
    if(rd<6.5){inner+=Y;innerHDR+=hdr;innerCount++;}
  }
  return {luminance:Array.from(hdrSums,(v,i)=>counts[i]?v/counts[i]:0),displayLuminance:Array.from(sums,(v,i)=>counts[i]?v/counts[i]:0),
    counts:Array.from(counts),inner:innerCount?inner/innerCount:0,innerHDR:innerCount?innerHDR/innerCount:0,innerCount};
}
function world13CorrelationReport(records) {
  const corr=(x,y)=>{
    let sx=0,sy=0,xx=0,yy=0,xy=0,n=x.length;
    for(let i=0;i<n;i++){sx+=x[i];sy+=y[i];xx+=x[i]*x[i];yy+=y[i]*y[i];xy+=x[i]*y[i];}
    const d=Math.sqrt(Math.max(0,n*xx-sx*sx)*Math.max(0,n*yy-sy*sy));return d?(n*xy-sx*sy)/d:0;
  };
  const correlations=[],bandSamples=[];
  for(let i=0;i<32;i++){
    const valid=records.filter(r=>r.counts[i]>0);bandSamples.push(valid.length);
    correlations.push(corr(valid.map(r=>r.levels[i]),valid.map(r=>r.luminance[i])));
  }
  const sorted=correlations.slice().sort((a,b)=>a-b),median=(sorted[15]+sorted[16])*.5;
  return {typeId:'g-gargantua',applicable:true,correlations,bandSamples,median,samples:records.length,
    pass:bandSamples.every(n=>n>=2)&&median>=.6};
}
function world13KickReport(before,after,at100ms) {
  const mean=(rows,key)=>rows.reduce((sum,r)=>sum+r[key],0)/Math.max(1,rows.length);
  // SSOTの発光・背景上限と同じ線形HDR輝度で比較。表示sRGBも診断として残す。
  const pre=mean(before,'innerHDR'),post=mean(after,'innerHDR'),displayPre=mean(before,'inner'),displayPost=mean(after,'inner');
  const increase=pre>0?(post-pre)/pre:0,displayIncrease=displayPre>0?(displayPost-displayPre)/displayPre:0;
  const at100msIncrease=pre>0&&at100ms?(at100ms.innerHDR-pre)/pre:0;
  return {before:pre,after:post,increase,displayBefore:displayPre,displayAfter:displayPost,displayIncrease,beforeSamples:before.length,afterSamples:after.length,
    windowSeconds:.1,at100ms:at100ms?.innerHDR??null,at100msIncrease,
    pass:before.length===6&&after.length===6&&before.concat(after).every(r=>r.innerCount>0)&&at100ms?.innerCount>0&&increase>=.4&&at100msIncrease>=.4};
}
async function world13Kick(engine) {
  const e=engine,originalScore=e.score,originalTimeline=e.timeline,originalType=e.type.id,originalFps=e.fps;
  const score=compileWorldScore({bpm:120,durationSec:8,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:8,kind:'main',label:'G-kick'}]},11);
  const f=new MfsFrameView(),before=[],after=[];let at100ms;
  try {
    e.timeline=null;e.selectType('g-gargantua',true);e.setScore(score);f.bandsSmooth.fill(.47);f.raw[MFS_LAYOUT.LEVEL]=.65;
    for(let frame=0;frame<=186;frame++){
      f.raw[MFS_LAYOUT.ONSET_FLAGS]=frame===180?1:0;e._step(frame/60,f,1/60);
      if(frame>=174){e._draw();const capture=e.capture();if(capture.glError)throw new Error('kick GL error');
        const row=world13ReadAnnuli(e,capture);if(frame===186)at100ms=row;else (frame<180?before:after).push(row);}
      if(frame%30===0)await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    return world13KickReport(before,after,at100ms);
  }finally {e.selectType(originalType,true);e.setScore(originalScore);e.setTimeline(originalTimeline,originalFps);}
}
async function world13Performance(engine) {
  const e=engine,originalScore=e.score,originalTimeline=e.timeline,originalType=e.type.id,originalFps=e.fps;
  const score=compileWorldScore({bpm:120,durationSec:8,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:8,kind:'drop',label:'G-gpu'}]},11),f=new MfsFrameView();
  try {
    e.timeline=null;e.selectType('g-gargantua',true);e.setScore(score);f.bandsSmooth.fill(.8);f.raw[MFS_LAYOUT.LEVEL]=.8;
    for(let frame=0;frame<360;frame++){
      f.raw[MFS_LAYOUT.ONSET_FLAGS]=frame%30===0?5:0;
      const start=performance.now();e.render(frame/60,f,1/60);e.endCpuTiming(performance.now()-start);
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    const m=e.metrics(),samples=Array.from(e.gpuTimes.subarray(0,e.timeCount)).filter(Number.isFinite).length;
    const gl=e.gpu.gl,ext=gl.getExtension('WEBGL_debug_renderer_info'),renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    const hardware=!!ext&&!/swiftshader|llvmpipe|software/i.test(renderer),glError=gl.getError();
    return {gpuP95Ms:m.gpuP95Ms,cpuP95Ms:m.cpuP95Ms,samples,disjoints:m.timerDisjoints,renderer,hardware,glError,width:m.width,height:m.height,
      pass:hardware&&!glError&&m.width===1920&&m.height===1080&&m.timerAvailable&&m.timerDisjoints===0&&samples>=120&&m.gpuP95Ms!==null&&m.gpuP95Ms<=16};
  }finally {e.selectType(originalType,true);e.setScore(originalScore);e.setTimeline(originalTimeline,originalFps);}
}
async function world13Shoot(typeId,tSec) {
  if(typeId==='g-fluid')return world12Shoot(typeId,tSec);
  if(typeId!=='g-gargantua')throw new RangeError('未実装のタイプ');
  const w=__world,app=w.app,e=w.engine,audio=w.audio;
  if(tSec<1.5||tSec>=w.score.durationSec)throw new RangeError('撮影時刻は1.5秒以上、曲長未満');
  audio.pause();cancelAnimationFrame(app.raf);app.state='paused';e.selectType(typeId,true);e.setScore(w.score);
  const timeline=e.timeline;
  const start=tSec-1.5;
  try {
    // 4秒のcamera遷移・.7秒の光速の筋・累積azimを曲頭から復元してから実音へ渡す。
    await e.renderAt(start);e.timeline=null;app.audioEngine.resetAnalysis();
    if(Math.abs(audio.currentTime-start)>1e-6)await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();reject(new Error('seek timeout'));},10000);
      function cleanup(){clearTimeout(timer);audio.removeEventListener('seeked',seeked);audio.removeEventListener('error',failed);}
      function seeked(){cleanup();resolve();}function failed(){cleanup();reject(new Error('audio seek error'));}
      audio.addEventListener('seeked',seeked);audio.addEventListener('error',failed);audio.currentTime=start;
    });
    app.previousSec=audio.currentTime;
    const records=[];let resolveShot,rejectShot,previousTime=-1;
    const completed=new Promise((resolve,reject)=>{resolveShot=resolve;rejectShot=reject;});
    const timeout=setTimeout(()=>rejectShot(new Error('playback/screenshot timeout')),30000);
    e.onFrame=()=>{
      try {
        const capture=e.capture(),time=e.latestSec;if(capture.glError)throw new Error('capture GL error '+capture.glError);
        if(time!==previousTime){
          const regions=world13ReadAnnuli(e,capture),levels=Array.from({length:32},(_,i)=>e.type.bandUniforms[i*4]);
          records.push({tSec:time,levels,...regions,...(typeof world14ExposureReport==='function'?{exposure:world14ExposureReport(capture)}:{}),kick:e.type.music[0],highOnsetPhase:e.type.highOnsetPhase,camera:Array.from(e.type.camera),view2:Array.from(e.type.view2)});previousTime=time;
        }
        if(time>=tSec){
          audio.pause();app.state='paused';e.onFrame=null;
          const canvas=document.createElement('canvas');canvas.width=capture.width;canvas.height=capture.height;
          const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height),stride=canvas.width*4;
          for(let y=0;y<canvas.height;y++)image.data.set(capture.rgba.subarray((canvas.height-1-y)*stride,(canvas.height-y)*stride),y*stride);
          ctx.putImageData(image,0,0);
          resolveShot({typeId,requestedSec:tSec,capturedSec:time,records,png:canvas.toDataURL('image/png'),g1:world13CorrelationReport(records),
            v11:typeof world14ShotReport==='function'?world14ShotReport(e,capture):null,
            mfsFrames:e.mfsFrames,clippedFraction:capture.clippedFraction,metrics:e.metrics()});
        }
      }catch(error){e.onFrame=null;rejectShot(error);}
    };
    try {await app.start();return await completed;}finally {clearTimeout(timeout);}
  }finally {audio.pause();cancelAnimationFrame(app.raf);app.state='paused';e.onFrame=null;e.timeline=timeline;}
}
if(typeof avzTest==='function')avzTest('BW-13-render','h² shader実コンパイル・半解像度・直接像・32環・beat無反応・streak上限',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../../world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  try {
    await ready;const child=iframe.contentWindow,e=child.__world?.engine;avzAssert.ok(e,child.__world?.error);
    const result=child.eval(`(()=>{
      const e=__world.engine,score=compileWorldScore({bpm:120,durationSec:20,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:20,kind:'main',label:'G'}]},11),f=new MfsFrameView();
      e.selectType('g-gargantua',true);e.setScore(score);f.bandsSmooth.fill(.47);f.raw[MFS_LAYOUT.LEVEL]=.65;
      e._step(5,f,0);e._draw();const before=e.capture();
      f.raw[MFS_LAYOUT.BEAT_FLAG]=1;f.raw[MFS_LAYOUT.DOWNBEAT_FLAG]=1;e._step(5,f,0);e._draw();const after=e.capture();
      let beatError=0;for(let i=0;i<before.rgba.length;i++)beatError=Math.max(beatError,Math.abs(before.rgba[i]-after.rgba[i]));
      for(let i=0;i<13;i++){f.raw[MFS_LAYOUT.ONSET_FLAGS]=0;e._step(5+i*.2,f,.1);f.raw[MFS_LAYOUT.ONSET_FLAGS]=4;e._step(5+i*.2+.1,f,.1);}
      e._draw();const c=e.capture(),gl=e.gpu.gl,target=e.type.half,pixels=new Float32Array(target.width*target.height*4);
      gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);gl.readPixels(0,0,target.width,target.height,gl.RGBA,gl.FLOAT,pixels);
      let directPixels=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>=3&&pixels[i]<=14)directPixels++;
      return {beatError,directPixels,width:target.width,height:target.height,streaks:e.type.streaks.length/4,serial:e.type.streakSerial,phase:e.type.highOnsetPhase,glError:gl.getError()||c.glError,hdrMax:c.hdrMax};
    })()`);
    avzAssert.equal(result.glError,0);avzAssert.equal(result.beatError,0);avzAssert.ok(result.directPixels>0);avzAssert.equal(result.width,960);avzAssert.equal(result.height,540);
    avzAssert.equal(result.streaks,8);avzAssert.equal(result.serial,13);avzAssert.equal(result.phase,13);console.log('BW-13-render '+JSON.stringify(result));
  }finally {iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
},{timeoutMs:60000});
// §10.20: キックで影の測地線は変えず、view2の構図と高域増光を実GPUで検査する。
if(typeof avzTest==='function')avzTest('BW-13-view2','固定重力のキック前後・片寄せ/ロールの影・高域の星空倍率2.5',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../../world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  try {
    await ready;const child=iframe.contentWindow;avzAssert.ok(child.__world?.engine,child.__world?.error);
    const result=child.eval(`(()=>{
      const e=__world.engine,g=e.gpu,gl=g.gl,source=WORLD_GARGANTUA_FRAGMENT.replace(/void main\\(\\)\\{[\\s\\S]*$/,''),w=128,h=128;
      const read=(body,view,kick)=>{
        const program=g.program(source+body),target=g.target(w,h,true);g.bind(program,target);
        gl.uniform4fv(g.texture(program,'camera'),[30,.05,0,1]);gl.uniform4fv(g.texture(program,'view2'),view);
        gl.uniform3fv(g.texture(program,'gravity'),[WORLD_GARGANTUA.GRAVITY,WORLD_GARGANTUA.Rs,WORLD_GARGANTUA.DISK_INNER]);
        gl.uniform4fv(g.texture(program,'music'),[kick,0,1,5]);gl.uniform3fv(g.texture(program,'secondary'),[.4,.2,.8]);
        gl.uniform2f(g.texture(program,'outputResolution'),w,h);g.draw();
        const pixels=new Float32Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.FLOAT,pixels);g.releaseTarget(target);return pixels;
      };
      const body='void main(){float r,phi,bg,d;vec4 a[MAX_CROSSINGS],b[MAX_CROSSINGS];int count;bool escaped;vec3 dir;traceRay(vUv,r,phi,bg,d,a,b,count,escaped,dir);frag=vec4(r,phi,bg,d);}',
        center=read(body,[0,0,0,0],0),pose=[.15,.09,-.02,0],before=read(body,pose,0),after=read(body,pose,1);
      let geometryError=0,shadowCount=0,shadowX=0,centerCount=0,centerX=0;
      for(let i=0;i<before.length;i++){geometryError=Math.max(geometryError,Math.abs(before[i]-after[i]));
        if(i%4===0&&before[i]<1){shadowCount++;shadowX+=(i/4)%w;}
        if(i%4===0&&center[i]<1){centerCount++;centerX+=(i/4)%w;}}
      const starsBody='void main(){vec2 p=vUv*2.-1.;frag=vec4(starfield(normalize(vec3(p,1))),1);}',
        low=read(starsBody,[0,0,0,0],0),high=read(starsBody,[0,0,0,1],0);
      let gainError=0,brightSamples=0;
      for(let i=0;i<low.length;i++)if(i%4!==3){gainError=Math.max(gainError,Math.abs(high[i]-low[i]*2.5));if(low[i]>.01)brightSamples++;}
      return {geometryError,shadowCount,centerCount,shadowX:shadowX/shadowCount,centerX:centerX/centerCount,gainError,brightSamples,glError:gl.getError()};
    })()`);
    avzAssert.equal(result.glError,0);avzAssert.equal(result.geometryError,0);avzAssert.ok(result.shadowCount>0&&result.centerCount>0);
    avzAssert.ok(result.shadowX<result.centerX,'正offXは影を左へ投影');avzAssert.ok(result.gainError<.00001);avzAssert.ok(result.brightSamples>0);
    console.log('BW-13-view2 '+JSON.stringify(result));
  }finally {iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
},{timeoutMs:60000});
if(typeof avzTest==='function')avzTest('BW-13-kick-gpu','キック直後0.1秒の内側直接像≥40%・1080p GPU p95≤16ms',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../../world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  try {
    await ready;const child=iframe.contentWindow,e=child.__world?.engine;avzAssert.ok(e,child.__world?.error);
    // 関数を実アプリのclassic環境へ注入する。評価時だけ文字列を確保。
    child.eval([world13AnnulusSamples,world13ReadAnnuli,world13KickReport,world13Kick,world13Performance].map(f=>f.toString()).join('\n'));
    const kick=await child.eval('world13Kick(__world.engine)'),gpu=await child.eval('world13Performance(__world.engine)');
    console.log('BW-13-kick-gpu '+JSON.stringify({kick,gpu}));avzAssert.ok(kick.pass,'kick '+JSON.stringify(kick));avzAssert.ok(gpu.pass,'GPU '+JSON.stringify(gpu));
  }finally {iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
},{timeoutMs:120000,slow:true});
if(typeof avzTest==='function')avzTest('BW-13-formulas','実GLSLの黒体5端点・外側低域32環・100msキック式・星空上限',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../../world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  try {
    await ready;const child=iframe.contentWindow;avzAssert.ok(child.__world?.engine,child.__world?.error);
    const result=child.eval(`(()=>{
      const e=__world.engine,g=e.gpu,gl=g.gl,source=WORLD_GARGANTUA_FRAGMENT.replace(/void main\\(\\)\\{[\\s\\S]*$/,'');
      const read=(body,w,h)=>{const target=g.target(w,h,true),program=g.program(source+body);g.bind(program,target);
        const b=new Float32Array(128);for(let i=0;i<32;i++)b[i*4]=i/31;
        gl.uniform4fv(g.texture(program,'bands[0]'),b);gl.uniform3fv(g.texture(program,'gravity'),[1.5,1,3]);
        gl.uniform4fv(g.texture(program,'camera'),[22,.1,0,1]);gl.uniform4fv(g.texture(program,'music'),new Float32Array([Math.exp(-.1/.11),3,1,4]));
        gl.uniform3fv(g.texture(program,'secondary'),[.45,.25,1]);gl.uniform2f(g.texture(program,'outputResolution'),1920,1080);g.draw();
        const pixels=new Float32Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.FLOAT,pixels);g.releaseTarget(target);return pixels;};
      const table=WORLD_GARGANTUA_BLACKBODY,colors=read('void main(){float T[5]=float[5](.33,.50,.70,.85,1.);frag=vec4(blackbodyRamp(T[int(gl_FragCoord.x)]),1);}',5,1);
      let rampError=0;for(let i=0;i<5;i++)for(let c=0;c<3;c++)rampError=Math.max(rampError,Math.abs(colors[i*4+c]-table[i][c+1]));
      const gain=read('void main(){float rd=3.+(floor(gl_FragCoord.x)+.5)/32.*11.;frag=vec4(musicGain(rd),rd,0,1);}',32,1);
      let bandError=0;for(let k=0;k<32;k++){const rd=3+(k+.5)/32*11,x=Math.max(0,Math.min(1,(rd-3)/3.5)),smooth=x*x*(3-2*x);
        const expected=(.45+2.2*(31-k)/31)*(rd<6.5?1+2.6*Math.exp(-.1/.11)*(1-smooth):1);
        bandError=Math.max(bandError,Math.abs(gain[k*4]-expected));}
      const stars=read('void main(){vec2 p=vUv*2.-1.;frag=vec4(starfield(normalize(vec3(p,1))),1);}',128,64);
      let backgroundMax=0;for(let i=0;i<stars.length;i++)if(i%4!==3)backgroundMax=Math.max(backgroundMax,stars[i]);
      return {rampError,bandError,backgroundMax,starSamples:128*64,glError:gl.getError()};
    })()`);
    avzAssert.equal(result.glError,0);avzAssert.ok(result.rampError<.001);avzAssert.ok(result.bandError<.004,'32環の指定gain式');
    avzAssert.ok(result.backgroundMax<=Math.fround(.6));console.log('BW-13-formulas '+JSON.stringify(result));
  }finally {iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
},{timeoutMs:60000});
if(typeof module!=='undefined'&&module.exports){module.exports={world13AnnulusSamples,world13CorrelationReport,world13KickReport};}
