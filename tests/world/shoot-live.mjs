#!/usr/bin/env node
// 目的 — v1.4の実音撮影と星画素/明弧/上弧の厚み・実GLSLを検査する — doc/20261004-design-gargantua-v1.md §10
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from '../lib/chrome.mjs';
export const WORLD17_CHECKS=Object.freeze({G1_FRAMES:20,G1_SECONDS:.4,G1_CORRELATION:.6,LEAD_SECONDS:1.5,
  PRE_KICK_SECONDS:.15,KICK_SECONDS:.1,KICK_FRAME_TOLERANCE:.05,KICK_INCREASE:.35,
  ARC_TIME:45,ARC_THRESHOLD:.85,ARC_MASK_THRESHOLD:.5,ARC_UPPER_RATIO:.4,STAR_THRESHOLD:.5,STAR_PIXELS:150,
  WIDTH:1280,HEIGHT:720});
export function world17Median(values){const a=values.slice().sort((x,y)=>x-y),n=a.length;return n?(a[(n-1)>>1]+a[n>>1])*.5:null;}
export function world17Correlation(records){
  const correlations=[],bandSamples=[];
  for(let band=0;band<32;band++){
    let n=0,sx=0,sy=0,xx=0,yy=0,xy=0;
    for(const r of records){if(!r.counts[band])continue;const x=r.levels[band],y=r.luminance[band];n++;sx+=x;sy+=y;xx+=x*x;yy+=y*y;xy+=x*y;}
    const d=Math.sqrt(Math.max(0,n*xx-sx*sx)*Math.max(0,n*yy-sy*sy));
    correlations.push(d?(n*xy-sx*sy)/d:0);bandSamples.push(n);
  }
  const median=world17Median(correlations),duration=records.length?records.at(-1).tSec-records[0].tSec:0;
  return {applicable:true,correlations,bandSamples,median,samples:records.length,durationSec:duration,
    pass:bandSamples.every(n=>n>=WORLD17_CHECKS.G1_FRAMES)&&duration>=WORLD17_CHECKS.G1_SECONDS&&median>=WORLD17_CHECKS.G1_CORRELATION};
}
// 同じ実再生窓の低域オンセットを使う。固定入力や偽のオンセットを挿入しない。
export function world17RealKick(records,requestedSec){
  const c=WORLD17_CHECKS;
  const onset=records.find(r=>r.onset&&r.tSec>=requestedSec-c.PRE_KICK_SECONDS&&
    records.some(p=>p.tSec<r.tSec&&p.tSec>=r.tSec-c.KICK_SECONDS));
  if(!onset)return {requestedSec,pass:false,reason:'撮影窓に前標本のある実キックがない',samples:records.length};
  const t=onset.tSec,before=records.filter(r=>r.tSec>=t-c.KICK_SECONDS&&r.tSec<t),
    after=records.filter(r=>r.tSec>=t&&r.tSec<t+c.KICK_SECONDS),at100ms=records.find(r=>r.tSec>=t+c.KICK_SECONDS);
  const mean=a=>a.reduce((sum,r)=>sum+r.inner,0)/Math.max(1,a.length),pre=mean(before),post=mean(after);
  const increase=pre>0?(post-pre)/pre:0,at100msIncrease=pre>0&&at100ms?(at100ms.inner-pre)/pre:0;
  const valid=before.length>=2&&after.length>=2&&before.concat(after).every(r=>r.innerCount>0)&&at100ms?.innerCount>0&&
    at100ms.tSec-t<=c.KICK_SECONDS+c.KICK_FRAME_TOLERANCE&& !records.some(r=>r.onset&&r.tSec>t&&r.tSec<=at100ms.tSec);
  return {requestedSec,kickSec:t,offsetSec:t-requestedSec,before:pre,after:post,increase,at100ms:at100ms?.inner??null,
    at100msSec:at100ms?.tSec??null,at100msIncrease,beforeSamples:before.length,afterSamples:after.length,
    pass:!!valid&&increase>=c.KICK_INCREASE&&at100msIncrease>=c.KICK_INCREASE};
}
// §10.7: 影と円盤を除いた逃走背景で、表示輝度>.5の画素数を数える。
export function world17Stars(capture,geometry){
  const w=capture.width,h=capture.height,p=capture.rgba;let pixels=0,backgroundPixels=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const o=(y*w+x)*4,m=(Math.floor(y*geometry.height/h)*geometry.width+Math.floor(x*geometry.width/w))*4;
    if(geometry.pixels[m+3]<=.5)continue; backgroundPixels++;
    if((.2126*p[o]+.7152*p[o+1]+.0722*p[o+2])/255>WORLD17_CHECKS.STAR_THRESHOLD)pixels++;
  }
  return {pixels,backgroundPixels,threshold:WORLD17_CHECKS.STAR_THRESHOLD,pass:pixels>=WORLD17_CHECKS.STAR_PIXELS};
}
// 中心を含む地平面像の面積から半径を測り、明弧のピークと§10.8の上弧の厚みを判定する。
export function world17Arcs(capture,geometry,horizon){
  const w=capture.width,h=capture.height,p=capture.rgba,n=w*h,queue=new Uint32Array(n),seen=new Uint8Array(n);
  const Y=(x,y)=>{const o=(y*w+x)*4;return (.2126*p[o]+.7152*p[o+1]+.0722*p[o+2])/255;};
  const dark=(x,y)=>{const o=(Math.floor(y*geometry.height/h)*geometry.width+Math.floor(x*geometry.width/w))*4;
    return geometry.pixels[o+2]<horizon;};
  const cx=Math.floor(w/2),cy=Math.floor(h/2);let head=0,tail=0;
  if(dark(cx,cy)){queue[tail++]=cy*w+cx;seen[cy*w+cx]=1;}
  while(head<tail){const pos=queue[head++],x=pos%w,y=Math.floor(pos/w);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const i=ny*w+nx;
      if(!seen[i]&&dark(nx,ny)){seen[i]=1;queue[tail++]=i;}
    }
  }
  const radius=Math.sqrt(tail/Math.PI),upper=[],lower=[];let upperPeak=0,lowerPeak=0;
  if(radius>=1)for(let x=Math.max(0,Math.ceil(cx-radius*.5));x<=Math.min(w-1,Math.floor(cx+radius*.5));x++){
    for(const sign of [-1,1]){let run=0,best=0;
      for(let d=1;d<=Math.ceil(radius*3);d++){
        const y=cy+sign*d;if(y<0||y>=h)break;
        const o=(Math.floor(y*geometry.height/h)*geometry.width+Math.floor(x*geometry.width/w))*4;
        // 直接像と逃走背景を除き、地平面外を通る曲がった円盤像だけで弧の明るさを測る。
        const arc=geometry.pixels[o]===0&&geometry.pixels[o+2]>=horizon&&geometry.pixels[o+3]<.5;
        // readPixelsは下から上へ並ぶため、yが増える方向が画面の上側。
        const lum=arc?Y(x,y):0;if(sign>0)upperPeak=Math.max(upperPeak,lum);else lowerPeak=Math.max(lowerPeak,lum);
        if(lum>WORLD17_CHECKS.ARC_MASK_THRESHOLD){run++;best=Math.max(best,run);}else run=0;
      }
      (sign>0?upper:lower).push(best);
    }
  }
  const upperPx=world17Median(upper),lowerPx=world17Median(lower),ratio=radius>0?Math.min(upperPx??0,lowerPx??0)/radius:0;
  const upperRatio=radius>0?(upperPx??0)/radius:0;
  return {shadowPixels:tail,shadowRadiusPx:radius,upperThicknessPx:upperPx,lowerThicknessPx:lowerPx,ratio,upperRatio,upperPeak,lowerPeak,
    pass:tail>0&&upper.length>0&&upperPeak>WORLD17_CHECKS.ARC_THRESHOLD&&lowerPeak>WORLD17_CHECKS.ARC_THRESHOLD&&
      upperRatio>=WORLD17_CHECKS.ARC_UPPER_RATIO};
}
// 数値条件だけの判定。§10.8で更新した弧の柔らかな外縁・全画面の滲み・映画参照との一致は目視する。
export function world17Acceptance(snapshot){
  const dimensions=snapshot?.width===WORLD17_CHECKS.WIDTH&&snapshot?.height===WORLD17_CHECKS.HEIGHT;
  return {snapshot,manualChecks:['上下の弧が明るく、上弧の外側が柔らかく減衰している','画面全体の柔らかい光の滲み','映画スチルと同じ系統の見た目'],
    pass:!!(dimensions&&snapshot.requestedSec===WORLD17_CHECKS.ARC_TIME&&snapshot.stars?.pass&&snapshot.arcs?.pass)};
}
async function world17Seek(audio,t){
  // currentTime代入前にlistenerを付け、seek中の同時刻もsettleを待つ。
  if(audio.seeking||Math.abs(audio.currentTime-t)>1e-6)await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('seek timeout'));},10000);
    function cleanup(){clearTimeout(timer);audio.removeEventListener('seeked',done);audio.removeEventListener('error',failed);}
    function done(){if(audio.seeking)return;cleanup();resolve();}
    function failed(){cleanup();reject(new Error('audio seek error'));}
    audio.addEventListener('seeked',done);audio.addEventListener('error',failed);audio.currentTime=t;
  });
  await new Promise(resolve=>requestAnimationFrame(resolve));
  if(audio.seeking||Math.abs(audio.currentTime-t)>.01)throw new Error('seek did not settle at requested start');
}
// PBOへ転送だけ発行し、再生中に同期readPixels/画素集計を待たない。待機・読み戻しは一時停止後。
function world17QueuePixels(engine){
  const gl=engine.gpu.gl,a=engine.type,items=[];let fence=null;
  const targets=[{target:engine.post.output,float:false},...(a.id==='g-gargantua'?[{target:a.half,float:true}]:[])];
  try {
    for(const {target,float} of targets){
      const buffer=gl.createBuffer(),bytes=target.width*target.height*4*(float?4:1);items.push({buffer,bytes,float,width:target.width,height:target.height});
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.bufferData(gl.PIXEL_PACK_BUFFER,bytes,gl.STREAM_READ);
      gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);gl.readPixels(0,0,target.width,target.height,gl.RGBA,float?gl.FLOAT:gl.UNSIGNED_BYTE,0);
    }
    fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
    if(gl.getError())throw new Error('queued capture GL error');return {items,fence};
  }catch(error){for(const item of items)gl.deleteBuffer(item.buffer);if(fence)gl.deleteSync(fence);throw error;}
  finally {gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);}
}
async function world17ReadPixels(engine,queued){
  const gl=engine.gpu.gl,deadline=performance.now()+30000;
  try {
    while(true){const status=gl.clientWaitSync(queued.fence,0,0);
      if(status===gl.WAIT_FAILED)throw new Error('capture fence failed');
      if(status!==gl.TIMEOUT_EXPIRED)break;
      if(performance.now()>deadline)throw new Error('capture fence timeout');
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    const result=[];
    for(const item of queued.items){const pixels=item.float?new Float32Array(item.bytes/4):new Uint8Array(item.bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER,item.buffer);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,pixels);
      result.push({pixels,width:item.width,height:item.height});}
    if(gl.getError())throw new Error('capture readback GL error');return result;
  }finally {gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);world17ReleasePixels(engine,queued);}
}
function world17ReleasePixels(engine,queued){
  if(queued.released)return;queued.released=true;const gl=engine.gpu.gl;
  for(const item of queued.items)gl.deleteBuffer(item.buffer);gl.deleteSync(queued.fence);
}
function world17Geometry(engine,state){
  const e=engine,g=e.gpu,gl=g.gl,source=WORLD_GARGANTUA_FRAGMENT.replace(/void main\(\)\{[\s\S]*$/,'');
  if(!e.world17Geometry)e.world17Geometry=g.program(source+'void main(){float r,phi,bg;vec4 c=traceRay(vUv,r,phi,bg);frag=vec4(c.a,phi,r,bg);}');
  const target=g.target(e.type.half.width,e.type.half.height,true),program=e.world17Geometry;
  try {
    g.bind(program,target);gl.uniform4fv(g.texture(program,'bands[0]'),state.bands);
    gl.uniform3fv(g.texture(program,'primary'),e.score.song.palette.primary);gl.uniform3fv(g.texture(program,'secondary'),e.score.song.palette.secondary);
    gl.uniform4fv(g.texture(program,'camera'),state.camera);gl.uniform4fv(g.texture(program,'music'),state.music);
    gl.uniform3fv(g.texture(program,'gravity'),state.gravity);gl.uniform4fv(g.texture(program,'hotspots[0]'),state.hotspots);
    gl.uniform2f(g.texture(program,'outputResolution'),e.canvas.width,e.canvas.height);g.draw();
    const pixels=new Float32Array(target.width*target.height*4);gl.readPixels(0,0,target.width,target.height,gl.RGBA,gl.FLOAT,pixels);
    if(gl.getError())throw new Error('geometry GL error');return {pixels,width:target.width,height:target.height};
  }finally {g.releaseTarget(target);}
}
// world12/13Shootをこのticketの計測経路へ差し替える（製品と他ticketのテストファイルは編集しない）。
async function world12Shoot(typeId,tSec){
  const w=__world,app=w.app,e=w.engine,audio=w.audio,c=WORLD17_CHECKS,gargantua=typeId==='g-gargantua';
  if(!['g-gargantua','g-fluid'].includes(typeId))throw new RangeError('未実装のタイプ');
  if(tSec<c.LEAD_SECONDS||tSec+c.G1_SECONDS>=w.score.durationSec)throw new RangeError('撮影窓が曲長の範囲外');
  audio.pause();cancelAnimationFrame(app.raf);app.state='paused';e.selectType(typeId,true);e.setScore(w.score);
  const timeline=e.timeline,queued=[],records=[];let timeout,first=null,firstState=null,firstTime=null;
  try {
    const start=tSec-c.LEAD_SECONDS;await e.renderAt(start);e.timeline=null;
    await world17Seek(audio,start);app.audioEngine.resetAnalysis();app.previousSec=audio.currentTime;
    let resolveShot,rejectShot,previousTime=-1;
    const completed=new Promise((resolve,reject)=>{resolveShot=resolve;rejectShot=reject;});
    timeout=setTimeout(()=>rejectShot(new Error('playback/capture timeout')),60000);
    e.onFrame=()=>{
      try {
        const time=e.latestSec;if(audio.seeking||time<tSec-c.PRE_KICK_SECONDS||time===previousTime)return;previousTime=time;
        const a=e.type,row={tSec:time,levels:Array.from({length:32},(_,i)=>a.bandUniforms[i*4]),
          onset:gargantua&&a.lastKick===time,kickSec:gargantua?a.lastKick:null,kick:gargantua?a.music[0]:null};
        // 描画されたフレームの時刻とuniformを転送前に固定する。
        queued.push({row,pixels:world17QueuePixels(e)});
        if(time>=tSec&&firstTime===null){
          firstTime=time;firstState=gargantua?{camera:a.camera.slice(),music:a.music.slice(),gravity:a.gravity.slice(),hotspots:a.hotspots.slice(),bands:a.bandUniforms.slice()}:null;
        }
        const post=queued.filter(q=>q.row.tSec>=tSec);
        if(firstTime!==null&&post.length>=c.G1_FRAMES&&time-firstTime>=c.G1_SECONDS){audio.pause();app.state='paused';e.onFrame=null;resolveShot();}
      }catch(error){e.onFrame=null;rejectShot(error);}
    };
    await app.start();await completed;clearTimeout(timeout);cancelAnimationFrame(app.raf);
    for(const q of queued){
      const data=await world17ReadPixels(e,q.pixels),display=data[0],capture={width:display.width,height:display.height,rgba:display.pixels};
      const row=q.row;
      if(gargantua)Object.assign(row,world13AnnulusSamples(data[1].pixels,data[1].width,data[1].height,capture));
      if(row.tSec===firstTime){first=capture;}
      records.push(row);
    }
    const g1Records=records.filter(r=>r.tSec>=tSec),geometry=gargantua?world17Geometry(e,firstState):null;
    const canvas=document.createElement('canvas');canvas.width=first.width;canvas.height=first.height;
    const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height),stride=canvas.width*4;
    for(let y=0;y<canvas.height;y++)image.data.set(first.rgba.subarray((canvas.height-1-y)*stride,(canvas.height-y)*stride),y*stride);
    ctx.putImageData(image,0,0);
    return {typeId,requestedSec:tSec,capturedSec:firstTime,captureLagSec:firstTime-tSec,records:g1Records,
      sampleEndSec:g1Records.at(-1).tSec,png:canvas.toDataURL('image/png'),
      g1:gargantua?world17Correlation(g1Records):{applicable:false},kick:gargantua?world17RealKick(records,tSec):null,
      v14:gargantua?{stars:world17Stars(first,geometry),
        arcs:tSec===c.ARC_TIME?world17Arcs(first,geometry,firstState.gravity[1]):null}:null,
      mfsFrames:e.mfsFrames,metrics:e.metrics()};
  }finally {
    clearTimeout(timeout);audio.pause();cancelAnimationFrame(app.raf);app.state='paused';e.onFrame=null;e.timeline=timeline;
    for(const q of queued)world17ReleasePixels(e,q.pixels);
  }
}
async function world13Shoot(typeId,tSec){return world12Shoot(typeId,tSec);}
// §10の周期性・暖色/パレット・縞/不透明度・LOD・滑らかなキック・前方合成を実GLSLで照合する。
async function world17ShaderChecks(engine){
  const g=engine.gpu,gl=g.gl,source=WORLD_GARGANTUA_FRAGMENT.replace(/void main\(\)\{[\s\S]*$/,'');
  const body=`void main(){
    float x=floor(gl_FragCoord.x),rd=3.5+x/63.*20.5,omega=KEPLER_SPEED*pow(rd/3.,KEPLER_POWER),row=floor(gl_FragCoord.y);
    vec3 p=streakInput(rd,0.,omega);
    if(row==0.){vec3 a=streakInput(rd,-PI,omega),b=streakInput(rd,PI,omega);frag=vec4(abs(a-b),abs(streakFbm(a,rd,.02)-streakFbm(b,rd,.02)));}
    else if(row==1.)frag=vec4(mix(DISK_OUTER_COLOR,DISK_INNER_COLOR,pow(DISK_INNER/rd,COLOR_POWER)),musicGain(rd));
    else if(row==2.)frag=diskSample(vec3(rd,0.,0.),0.);
    else if(row==3.){float fp=x/63.*3.;frag=vec4(1.-smoothstep(LOD_START,LOD_END,fp),streakFbm(p,rd,2.*rd/STREAK_RADIAL),streakFbm(p,rd,0.),1.);}
    else if(row==4.){vec4 value=diskSample(vec3(rd,0.,0.),0.);float trans=1.;vec3 c=vec3(0.);for(int i=0;i<MAX_CROSSINGS;i++){c+=trans*value.rgb*value.a;trans*=1.-value.a;}frag=vec4(c.r,trans,value.a,1.);}
    else frag=vec4(musicGain(rd),0.,0.,1.);
  }`;
  const target=g.target(64,6,true),program=g.program(source+body),bands=new Float32Array(128),hotspots=new Float32Array(48);
  for(let i=0;i<12;i++)hotspots[i*4+2]=-100;
  try {
    g.bind(program,target);gl.uniform4fv(g.texture(program,'bands[0]'),bands);gl.uniform4fv(g.texture(program,'hotspots[0]'),hotspots);
    gl.uniform3fv(g.texture(program,'primary'),[.2,.5,.8]);gl.uniform3fv(g.texture(program,'gravity'),[1.5,1,3]);
    gl.uniform4fv(g.texture(program,'camera'),[17,.1,0,1]);gl.uniform4fv(g.texture(program,'music'),[1,3,1,45]);
    gl.uniform2f(g.texture(program,'outputResolution'),1280,720);g.draw();
    const pixels=new Float32Array(64*5*4);gl.readPixels(0,0,64,5,gl.RGBA,gl.FLOAT,pixels);
    const smooth=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
    let periodicError=0,colorError=0,diskError=0,kickError=0,lodError=0,integrationError=0,nonfinite=0;
    for(const value of pixels)if(!Number.isFinite(value))nonfinite++;
    for(let x=0;x<64;x++){
      for(let c=0;c<4;c++)periodicError=Math.max(periodicError,pixels[x*4+c]);
      const rd=3.5+x/63*20.5,warm=[1,.6+.3*3/rd,.28+.48*3/rd],primary=[.2,.5,.8];
      for(let c=0;c<3;c++)colorError=Math.max(colorError,Math.abs(pixels[(64+x)*4+c]-warm[c]));
      const gain=.45*(rd<6.5?1+2.6*(1-smooth(3,6.5,rd)):1);
      kickError=Math.max(kickError,Math.abs(pixels[(64+x)*4+3]-gain));
      const n=pixels[(192+x)*4+2],streak=.3+.7*smooth(.3,.7,n),env=smooth(3,3.25,rd)*(1-smooth(15,24,rd));
      const alpha=env*Math.min(.9,.45+.5*streak),I=6*env*streak*(3/rd)**.8;
      for(let c=0;c<3;c++)diskError=Math.max(diskError,Math.abs(pixels[(128+x)*4+c]-warm[c]*(.85+.15*primary[c]*1.6)*I*gain));
      diskError=Math.max(diskError,Math.abs(pixels[(128+x)*4+3]-alpha));
      lodError=Math.max(lodError,Math.abs(pixels[(192+x)*4]-(1-smooth(.6,2,x/63*3))),Math.abs(pixels[(192+x)*4+1]));
      const trans=(1-alpha)**3,emission=pixels[(128+x)*4]*(1-trans);
      integrationError=Math.max(integrationError,Math.abs(pixels[(256+x)*4]-emission),Math.abs(pixels[(256+x)*4+1]-trans));
    }
    // 非一様な帯域入力でも14より外が同じ低域へ固定され、境界補間も復元元と一致する。
    for(let i=0;i<32;i++)bands[i*4]=i/31;
    gl.uniform4fv(g.texture(program,'bands[0]'),bands);gl.uniform4fv(g.texture(program,'music'),[0,3,1,45]);g.draw();
    const gains=new Float32Array(64*4);gl.readPixels(0,5,64,1,gl.RGBA,gl.FLOAT,gains);let bandError=0;
    for(let x=0;x<64;x++){
      const rd=3.5+x/63*20.5,pos=Math.max(0,Math.min(1,(rd-3)/11))*32,k=Math.min(31,Math.floor(pos)),f=pos-Math.floor(pos);
      let level=(31-k)/31;
      if(f<.075&&k>0)level=((32-k)/31)*(1-(.5+.5*smooth(0,.075,f)))+level*(.5+.5*smooth(0,.075,f));
      if(f>.925&&k<31)level=level*(1-.5*smooth(.925,1,f))+((30-k)/31)*.5*smooth(.925,1,f);
      if(!Number.isFinite(gains[x*4]))nonfinite++;
      bandError=Math.max(bandError,Math.abs(gains[x*4]-(.45+2.2*level)));
    }
    const glError=gl.getError();return {samples:384,periodicError,colorError,diskError,kickError,lodError,integrationError,bandError,nonfinite,glError,
      pass:!glError&&!nonfinite&&periodicError<.0001&&colorError<.001&&diskError<.004&&kickError<.004&&lodError<.001&&integrationError<.001&&bandError<.004};
  }finally {g.releaseTarget(target);}
}
// §10.7の指定時刻をrenderAtで正確に復元し、実音撮影と別に数値条件の画像を残す。
async function world17RenderCheck(engine){
  const e=engine;e.selectType('g-gargantua',true);await e.renderAt(WORLD17_CHECKS.ARC_TIME);
  const a=e.type,capture=e.capture(),state={camera:a.camera,music:a.music,gravity:a.gravity,hotspots:a.hotspots,bands:a.bandUniforms};
  if(capture.glError)throw new Error('renderAt capture GL error');
  const geometry=world17Geometry(e,state);
  const canvas=document.createElement('canvas');canvas.width=capture.width;canvas.height=capture.height;
  const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height),stride=canvas.width*4;
  for(let y=0;y<canvas.height;y++)image.data.set(capture.rgba.subarray((canvas.height-1-y)*stride,(canvas.height-y)*stride),y*stride);
  ctx.putImageData(image,0,0);
  return {requestedSec:WORLD17_CHECKS.ARC_TIME,width:capture.width,height:capture.height,
    stars:world17Stars(capture,geometry),arcs:world17Arcs(capture,geometry,a.gravity[1]),png:canvas.toDataURL('image/png')};
}
const browserFunctions=[world17Median,world17Correlation,world17RealKick,world17Stars,world17Arcs,world17Acceptance,
  world17ShaderChecks,world17RenderCheck,world17Seek,world17QueuePixels,world17ReadPixels,world17ReleasePixels,world17Geometry,world12Shoot,world13Shoot];
export const world17BrowserSource='const WORLD17_CHECKS='+JSON.stringify(WORLD17_CHECKS)+';\n'+browserFunctions.map(f=>f.toString().replace(/^export /,'')).join('\n');
async function main(){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),output=path.join(root,'tests/world/output/live');
  const options={types:['g-gargantua'],times:[7,20,31,45,62,90],wav:null},args=process.argv.slice(2);
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg==='--help'){
      console.log('node tests/world/shoot-live.mjs [--types g-gargantua,g-fluid] [--times 7,20,31,45,62,90] [--wav path]\nWORLD_CHROME_WRAPPERに実GPU用起動ラッパーを指定。node tests/world/shoot-live.mjs --unit はGPUなしの計測契約テスト。');return;
    }
    if(arg==='--unit'){await unitChecks();return;}
    if(!['--types','--times','--wav'].includes(arg)||!args[i+1])throw new Error('不正な引数: '+arg);
    const value=args[++i];if(arg==='--types')options.types=value.split(',');else if(arg==='--times')options.times=value.split(',').map(Number);else options.wav=path.resolve(root,value);
  }
  if(options.types.some(id=>!['g-gargantua','g-fluid'].includes(id)))throw new Error('未実装のタイプ');
  if(options.times.some(t=>!Number.isFinite(t)||t<1.5))throw new Error('撮影時刻は有限かつ1.5秒以上');
  if(!process.env.WORLD_CHROME_WRAPPER)throw new Error('WORLD_CHROME_WRAPPERに実GPU起動ラッパーを指定してください');
  await fs.mkdir(output,{recursive:true});let chrome;
  try {
    chrome=await launchChrome({headed:true,executablePath:process.env.WORLD_CHROME_WRAPPER});
    await chrome.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
    await chrome.navigate(pathToFileURL(path.join(root,'world.html')).href);
    for(const file of ['tests/shared/song-synth.js','tests/shared/wav.js','tests/browser/world11.test.js','tests/browser/world12.test.js','tests/browser/world13.test.js'])await chrome.evaluate(await fs.readFile(path.join(root,file),'utf8'));
    await chrome.evaluate(world17BrowserSource);
    const hardware=await chrome.evaluate(`(()=>{const gl=__world.engine?.gpu.gl;if(!gl)throw new Error(__world.error);const ext=gl.getExtension('WEBGL_debug_renderer_info');const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);return {renderer,hardware:!!ext&&!/swiftshader|llvmpipe|software/i.test(renderer)};})()`);
    if(!hardware.hardware)throw new Error('実GPUを確認できません: '+hardware.renderer);
    if(options.wav){const bytes=await fs.readFile(options.wav);
      await chrome.evaluate(`__world.app.load(new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0))],${JSON.stringify(path.basename(options.wav))},{type:'audio/wav',lastModified:1}))`,{timeoutMs:900000});
    }else await chrome.evaluate(`__world.app.load(new File([encodeWav16(synthSong(48000,{bpm:128,seed:11}))],'synth-128-11.wav',{type:'audio/wav',lastModified:1}))`,{timeoutMs:900000});
    const gpu=options.types.includes('g-gargantua')?await chrome.evaluate('world13Performance(__world.engine)',{timeoutMs:900000}):null;
    const shader=options.types.includes('g-gargantua')?await chrome.evaluate('world17ShaderChecks(__world.engine)',{timeoutMs:900000}):null;
    await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
    // WORLDのcanvasは固定1920×1080なので、CSSのviewportとは別に評価用の描画解像度を指定する。
    await chrome.evaluate('(__world.engine.resize(WORLD17_CHECKS.WIDTH,WORLD17_CHECKS.HEIGHT),true)');
    const snapshot=options.types.includes('g-gargantua')?await chrome.evaluate('world17RenderCheck(__world.engine)',{timeoutMs:900000}):null;
    if(snapshot){await fs.writeFile(path.join(output,'g-gargantua-renderAt-45-v14.png'),Buffer.from(snapshot.png.split(',')[1],'base64'));delete snapshot.png;}
    const rows=[];
    for(const typeId of options.types)for(const t of options.times){
      const shot=await chrome.evaluate(`world12Shoot(${JSON.stringify(typeId)},${t})`,{timeoutMs:900000});
      const png=path.join(output,typeId+'-'+t+'.png');await fs.writeFile(png,Buffer.from(shot.png.split(',')[1],'base64'));delete shot.png;
      await fs.writeFile(path.join(output,typeId+'-'+t+'.json'),JSON.stringify(shot,null,2)+'\n');rows.push(shot);
      console.log(JSON.stringify({typeId,t,capturedSec:shot.capturedSec,lagSec:shot.captureLagSec,samples:shot.records.length,
        durationSec:shot.g1.durationSec,g1:shot.g1.median,kick:shot.kick,v14:shot.v14,png}));
    }
    const v14=options.types.includes('g-gargantua')?world17Acceptance(snapshot):null;
    const summary={v14,shader,gpu,environment:hardware,shots:rows.map(({records,...row})=>row),consoleErrors:chrome.errors};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(summary,null,2)+'\n');
    if((v14&&!v14.pass)||(shader&&!shader.pass)||chrome.errors.length||rows.some(r=>!r.mfsFrames||(r.g1.applicable&&!r.g1.pass)))process.exitCode=1;
    console.log(JSON.stringify({v14,shader,gpu}));
  }finally {if(chrome)await chrome.close();}
}
// ブラウザを起動せず§10の計測契約と非同期撮影を検証する。
async function unitChecks(){
  const {default:test}=await import('node:test'),{default:assert}=await import('node:assert/strict');
  const {loadClassic}=await import('../lib/load-classic.mjs');
  test('UW-55 WORLD-17 平面/LOD/星/フレア定数と品質fallback削除',()=>{
    const r=loadClassic(['js/world/gl-util.js','js/world/score.js','js/world/analyzer-types.js','js/world/g-gargantua.js']);
    const c=r.get('WORLD_GARGANTUA'),A=r.get('WorldGargantuaAnalyzer'),a=new A();
    for(const [name,value] of Object.entries({MAX_CROSSINGS:3,STREAK_RADIAL:60,STREAK_ANGULAR:3,STREAK_TIME:.03,
      FBM_OCTAVES:4,FBM_FREQUENCY:2.03,LOD_HEIGHT:540,STREAK_FLOOR:.3,DISK_HDR:6,INTENSITY_POWER:.8,DISK_OUTER:24,OUTER_FADE:15,BAND_OUTER:14,
      STAR_PROBABILITY:.03,STAR_RADIUS_PX:.6,STAR_POWER:18,STAR_HDR:6,VEIL_GAIN:.12}))assert.equal(c[name],value,name);
    assert.equal(a.setQuality,undefined);assert.equal(a.flowQuality,undefined);
    const shader=r.get('WORLD_GARGANTUA_FRAGMENT');assert.ok(!/SLAB_|DISK_LAYER|history|EMA|BEAM_|blackbody|SPIKE_|STAR_HALO/.test(shader));
    console.log('UW-55 plane=1 crossings=3 octaves=4 frequency=2.03 starFloor=0 starPeak=6 veil=.12');
  });
  test('UW-56 WORLD-17 G-1は20標本/0.4秒・定数/空領域を拒否',()=>{
    const rows=Array.from({length:21},(_,n)=>({tSec:7+n*.025,levels:Array.from({length:32},(_,b)=>(n+b)%9),
      luminance:Array.from({length:32},(_,b)=>2*((n+b)%9)),counts:new Array(32).fill(3)}));
    const result=world17Correlation(rows);assert.equal(result.median,1);assert.equal(result.pass,true);assert.equal(result.durationSec,.5);
    assert.equal(world17Correlation(rows.slice(0,2)).pass,false);assert.equal(world17Correlation(rows.map(r=>({...r,tSec:7}))).pass,false);
    assert.equal(world17Correlation(rows.map(r=>({...r,levels:new Array(32).fill(1)}))).pass,false);
    assert.equal(world17Correlation(rows.map(r=>({...r,counts:new Array(32).fill(0)}))).pass,false);
    console.log('UW-56 samples=21 duration=.5 PearsonMedian=1 twoSamples/constant/emptyRejected=true');
  });
  test('UW-57 WORLD-17 背景輝度>.5の150画素・境界/空測定拒否',()=>{
    const c={width:151,height:1,rgba:new Uint8Array(604)},g={width:151,height:1,pixels:new Float32Array(604)};
    c.rgba.fill(128);g.pixels.fill(1);assert.equal(world17Stars(c,g).pixels,151);
    c.rgba.fill(127,0,4);assert.equal(world17Stars(c,g).pass,true);
    c.rgba.fill(127,4,8);assert.equal(world17Stars(c,g).pass,false);
    g.pixels.fill(0);assert.equal(world17Stars(c,g).pixels,0);
    assert.equal(world17Stars({width:0,height:0,rgba:[]},{width:0,height:0,pixels:[]}).pass,false);
    console.log('UW-57 pixels=151/150 pass 149/0 fail thresholdStrictlyGreater=.5');
  });
  test('UW-58 WORLD-17 実キックの画面35%・100ms実標本・無オンセットを拒否',()=>{
    const rows=Array.from({length:18},(_,i)=>({tSec:(54+i)/60,inner:i<6?.2:.272,innerCount:12,onset:i===6}));
    const result=world17RealKick(rows,1);assert.equal(result.pass,true);assert.ok(Math.abs(result.increase-.36)<1e-12);
    assert.ok(Math.abs(result.at100msSec-1.1)<1e-12);assert.equal(world17RealKick(rows.map(r=>({...r,onset:false})),1).pass,false);
    assert.equal(world17RealKick(rows.map(r=>({...r,inner:.2})),1).pass,false);assert.equal(world17RealKick(rows.slice(0,12),1).pass,false);
    assert.equal(world17RealKick(rows.map(r=>({...r,innerCount:0})),1).pass,false);
    console.log('UW-58 realKickSec=1 screenIncrease=.36 at100ms=1.1 missingOnset/100ms/ROIRejected=true');
  });
  test('UW-59 WORLD-17 上下明弧>.85・上弧は影半径40%以上・GL上下方向・影なし拒否',()=>{
    const w=101,h=101,c={width:w,height:h,rgba:new Uint8Array(w*h*4)},g={width:w,height:h,pixels:new Float32Array(w*h*4)};
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)g.pixels[(y*w+x)*4+2]=Math.hypot(x-50,y-50)<=10?.9:4;
    const put=(value,thickness)=>{c.rgba.fill(0);for(const y of [30,...Array.from({length:thickness},(_,i)=>70+i)])
      for(let x=44;x<=56;x++)c.rgba.fill(value,(y*w+x)*4,(y*w+x)*4+3);};
    put(217,5);const bright=world17Arcs(c,g,1);assert.equal(bright.pass,true);assert.equal(bright.upperThicknessPx,5);assert.equal(bright.lowerThicknessPx,1);
    put(217,4);const thin=world17Arcs(c,g,1);assert.equal(thin.pass,false);assert.ok(thin.upperRatio<.4);
    put(216,5);assert.equal(world17Arcs(c,g,1).pass,false);
    put(217,5);for(let x=44;x<=56;x++)c.rgba.fill(127,(74*w+x)*4,(74*w+x)*4+3);
    assert.equal(world17Arcs(c,g,1).pass,false,'厚みは輝度>.5の連続画素だけを数える');
    g.pixels.fill(4);assert.equal(world17Arcs(c,g,1).pass,false);
    console.log('UW-59 shadowRadius='+bright.shadowRadiusPx+' upperThickness=5 lowerThickness=1 upperRatio='+bright.upperRatio+' thinRatio='+thin.upperRatio+' brightPeak='+bright.upperPeak+' dimPeak='+216/255);
  });
  test('UW-60 WORLD-17 seek listener先行・seeked/first-rAFを待つ',async()=>{
    const events=new Map(),order=[];let time=2,seeking=false;
    const audio={get currentTime(){return time;},set currentTime(t){order.push('set');assert.ok(events.has('seeked'));seeking=true;time=t;
      queueMicrotask(()=>{seeking=false;order.push('seeked');events.get('seeked')();});},get seeking(){return seeking;},
      addEventListener(name,fn){events.set(name,fn);order.push('listen:'+name);},removeEventListener(name){events.delete(name);}};
    const vm=await import('node:vm'),scope={WORLD17_CHECKS,requestAnimationFrame:fn=>{order.push('rAF');queueMicrotask(fn);},setTimeout,clearTimeout,Promise};
    vm.createContext(scope);vm.runInContext(world17Seek.toString(),scope);await scope.world17Seek(audio,7);
    assert.deepEqual(order,['listen:seeked','listen:error','set','seeked','rAF']);assert.equal(time,7);
    console.log('UW-60 seek=7 order=listener/set/seeked/rAF settled=true');
  });
  test('UW-61 WORLD-17 撮影mock: t以降の最初の描画・20枚以上・非同期readback・後始末',async()=>{
    const vm=await import('node:vm');let audioTime=0,seeking=false,cancelled=0,reads=0,firstReadAt=null;
    const listeners=new Map(),rows=[],engine={timeline:[1],latestSec:0,type:{id:'g-fluid',bandUniforms:new Float32Array(128)},
      selectType(){},setScore(){},async renderAt(t){this.latestSec=t;},metrics(){return {};},mfsFrames:40};
    const audio={pause(){},get currentTime(){return audioTime;},set currentTime(t){audioTime=t;seeking=true;queueMicrotask(()=>{seeking=false;listeners.get('seeked')();});},
      get seeking(){return seeking;},addEventListener(n,f){listeners.set(n,f);},removeEventListener(n){listeners.delete(n);}};
    const app={state:'paused',audioEngine:{resetAnalysis(){}},async start(){this.state='playing';
      for(let i=0;i<90&&this.state==='playing';i++){audioTime=5.5+i/60;engine.latestSec=audioTime;engine.onFrame();}
    }};
    // t=7より前を含めて120描画。pixel転送の完了処理はpause後であることも検査する。
    app.start=async function(){this.state='playing';for(let i=0;i<140&&this.state==='playing';i++){audioTime=5.5+i/60;engine.latestSec=audioTime;engine.onFrame();}};
    const ctx={createImageData:()=>({data:new Uint8Array(4)}),putImageData(){}},scope={__world:{app,engine,audio,score:{durationSec:20}},WORLD17_CHECKS,
      world17Seek:async(a,t)=>{audioTime=t;},world17QueuePixels:()=>{rows.push(engine.latestSec);return {};},
      world17ReadPixels:async()=>{assert.equal(app.state,'paused');firstReadAt??=engine.latestSec;reads++;return [{width:1,height:1,pixels:new Uint8Array(4)}];},
      world17ReleasePixels(){},document:{createElement:()=>({getContext:()=>ctx,toDataURL:()=> 'data:image/png;base64,AA=='})},
      cancelAnimationFrame:()=>cancelled++,setTimeout,clearTimeout,Promise,Float32Array,Array};
    vm.createContext(scope);vm.runInContext(world12Shoot.toString(),scope);const shot=await scope.world12Shoot('g-fluid',7);
    assert.equal(shot.capturedSec,7);assert.equal(shot.records.length,25);assert.ok(shot.sampleEndSec-7>=.4);
    assert.equal(rows[0],6.85);assert.equal(reads,rows.length);assert.ok(firstReadAt>=7.4);assert.deepEqual(engine.timeline,[1]);assert.equal(engine.onFrame,null);
    assert.ok(cancelled>=2);console.log('UW-61 capturedSec='+shot.capturedSec+' lag=0 postFrames='+shot.records.length+' duration='+(shot.sampleEndSec-7)+' queuedFrames='+rows.length+' readsAfterPause='+reads);
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
