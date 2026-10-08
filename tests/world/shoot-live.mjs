#!/usr/bin/env node
// 目的 — v1.4の実音撮影と星画素/明弧/上弧の厚み・実GLSLを検査する — doc/20261004-design-gargantua-v1.md §10
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from '../lib/chrome.mjs';
export const WORLD17_CHECKS=Object.freeze({G1_FRAMES:20,G1_SECONDS:.4,G1_CORRELATION:.6,G1_MIN_STD_DEV:1e-3,LEAD_SECONDS:1.5,
  LAG_MAX_SECONDS:1/30,
  PRE_KICK_SECONDS:.15,PRE_WINDOW:.10,KICK_SECONDS:.18,KICK_INCREASE:.35,
  ARC_TIME:45,ARC_THRESHOLD:.85,ARC_MASK_THRESHOLD:.5,ARC_UPPER_RATIO:.4,STAR_THRESHOLD:.5,STAR_PIXELS:30,
  WIDTH:1280,HEIGHT:720});
const WORLD21_DRAIN_BUFFER=new Uint8Array(4);
// WORLD-21: 再生前に既発行のGPU描画を同期し、続く2回のrAFまで待つ。
async function world21DrainGpu(e){
  const gl=e.gpu.gl;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,WORLD21_DRAIN_BUFFER);
  await new Promise(resolve=>requestAnimationFrame(resolve));
  await new Promise(resolve=>requestAnimationFrame(resolve));
}
export function world17Median(values){const a=values.slice().sort((x,y)=>x-y),n=a.length;return n?(a[(n-1)>>1]+a[n>>1])*.5:null;}
export function world17Correlation(records){
  const correlations=[],bandSamples=[],bandStdDevs=[];
  for(let band=0;band<32;band++){
    // §10.13: 適用可否はROIの有無と独立した、撮影窓の音声帯域の分散で決める。
    const mean=records.reduce((sum,r)=>sum+r.levels[band],0)/Math.max(1,records.length);
    bandStdDevs.push(Math.sqrt(records.reduce((sum,r)=>sum+(r.levels[band]-mean)**2,0)/Math.max(1,records.length)));
    let n=0,sx=0,sy=0,xx=0,yy=0,xy=0;
    for(const r of records){if(!r.counts[band])continue;const x=r.levels[band],y=r.luminance[band];n++;sx+=x;sy+=y;xx+=x*x;yy+=y*y;xy+=x*y;}
    const d=Math.sqrt(Math.max(0,n*xx-sx*sx)*Math.max(0,n*yy-sy*sy));
    correlations.push(d?(n*xy-sx*sy)/d:0);bandSamples.push(n);
  }
  const median=world17Median(correlations),duration=records.length?records.at(-1).tSec-records[0].tSec:0;
  const applicable=!records.length||!bandStdDevs.every(s=>s<WORLD17_CHECKS.G1_MIN_STD_DEV);
  return {applicable,correlations,bandSamples,bandStdDevs,median,samples:records.length,durationSec:duration,
    reason:applicable?null:'すべての帯域の標準偏差が1e-3未満',
    pass:applicable&&bandSamples.every(n=>n>=WORLD17_CHECKS.G1_FRAMES)&&duration>=WORLD17_CHECKS.G1_SECONDS&&median>=WORLD17_CHECKS.G1_CORRELATION};
}
// §10.15: 休みのある実低域オンセットの前.10秒の最小値と後.18秒の最大値を比べる。
export function world17RealKick(records,requestedSec){
  const c=WORLD17_CHECKS;
  const candidates=records.filter(r=>r.onset&&r.tSec>=requestedSec-c.PRE_KICK_SECONDS);
  const onset=candidates.find(r=>!records.some(p=>p.onset&&p.tSec<r.tSec&&p.tSec>=r.tSec-c.PRE_WINDOW));
  if(!onset){
    return {requestedSec,applicable:false,pass:false,reason:candidates.length?'休みのないロール':'撮影窓に実キックがない',samples:records.length};
  }
  const t=onset.tSec,before=records.filter(r=>r.tSec>=t-c.PRE_WINDOW&&r.tSec<t),
    after=records.filter(r=>r.tSec>=t&&r.tSec<=t+c.KICK_SECONDS);
  const pre=before.length?before.reduce((minimum,r)=>Math.min(minimum,r.inner),Infinity):0,
    post=after.reduce((peak,r)=>Math.max(peak,r.inner),0),increase=pre>0?(post-pre)/pre:0;
  const valid=before.length>=2&&after.length>=2&&pre>0&&before.concat(after).every(r=>r.innerCount>0&&Number.isFinite(r.inner));
  return {requestedSec,applicable:true,kickSec:t,offsetSec:t-requestedSec,before:pre,after:post,increase,
    beforeSamples:before.length,afterSamples:after.length,
    pass:valid&&increase>=c.KICK_INCREASE};
}
// §10.13〜10.14: 無キック・無分散・休みのないロールを除き、適用される測定と実GPU条件を判定する。
export function world23LiveAcceptance(rows,gpu){
  return {g1Applicable:rows.filter(r=>r.g1?.applicable).length,kickApplicable:rows.filter(r=>r.kick?.applicable).length,
    pass:(!gpu||gpu.pass)&&rows.every(r=>r.mfsFrames&&(!r.g1?.applicable||r.g1.pass)&&(!r.kick?.applicable||r.kick.pass))};
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
// §10.20: 製品の視線オフセット→基底再計算→ロールと同じ順で撮影用の基底を作る。
export function world17View(camera,view2){
  const norm=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);},
    cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const forward=[-Math.cos(camera[1])*Math.cos(camera[2]),-Math.sin(camera[1]),-Math.cos(camera[1])*Math.sin(camera[2])],
    right=norm(cross(forward,[0,1,0])),up=cross(right,forward),
    f=norm(forward.map((x,i)=>x+right[i]*Math.tan(view2[1])+up[i]*Math.tan(view2[2]))),
    r=norm(cross(f,[0,1,0])),u=cross(r,f),co=Math.cos(view2[0]),si=Math.sin(view2[0]);
  return {forward,right,up,f,r:r.map((x,i)=>co*x+si*u[i]),u:u.map((x,i)=>-si*r[i]+co*x)};
}
// 原点を向く旧画面の画素オフセットを、view2を反映した画面へ透視投影する。
export function world17Project(view,width,height,dx,dy){
  const focal=height/(2*Math.tan(22*Math.PI/360)),
    d=view.forward.map((x,i)=>x+view.right[i]*dx/focal+view.up[i]*dy/focal),
    dot=a=>a.reduce((sum,x,i)=>sum+x*d[i],0),z=dot(view.f);
  return {x:width/2+focal*dot(view.r)/z,y:height/2+focal*dot(view.u)/z};
}
// 投影した穴を含む地平面像の面積から半径を測り、元のカメラ基底に沿って上下弧を測る。
export function world17Arcs(capture,geometry,horizon){
  const w=capture.width,h=capture.height,p=capture.rgba,n=w*h,queue=new Uint32Array(n),seen=new Uint8Array(n);
  const Y=(x,y)=>{const o=(y*w+x)*4;return (.2126*p[o]+.7152*p[o+1]+.0722*p[o+2])/255;};
  const dark=(x,y)=>{const o=(Math.floor(y*geometry.height/h)*geometry.width+Math.floor(x*geometry.width/w))*4;
    return geometry.pixels[o+2]<horizon;};
  const view=geometry.view;
  const project=(dx,dy)=>view?world17Project(view,w,h,dx,dy):{x:w/2+dx,y:h/2+dy};
  const center=project(0,0),cx=Math.floor(center.x),cy=Math.floor(center.y);let head=0,tail=0;
  if(cx>=0&&cx<w&&cy>=0&&cy<h&&dark(cx,cy)){queue[tail++]=cy*w+cx;seen[cy*w+cx]=1;}
  while(head<tail){const pos=queue[head++],x=pos%w,y=Math.floor(pos/w);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const i=ny*w+nx;
      if(!seen[i]&&dark(nx,ny)){seen[i]=1;queue[tail++]=i;}
    }
  }
  const radius=Math.sqrt(tail/Math.PI),upper=[],lower=[];let upperPeak=0,lowerPeak=0;
  if(radius>=1)for(let dx=Math.ceil(-radius*.5);dx<=Math.floor(radius*.5);dx++){
    for(const sign of [-1,1]){let run=0,best=0;
      for(let d=1;d<=Math.ceil(radius*3);d++){
        const point=project(dx,sign*d),x=Math.floor(point.x),y=Math.floor(point.y);if(x<0||x>=w||y<0||y>=h)break;
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
  if(!e.world17Geometry)e.world17Geometry=g.program(source+'void main(){float r,phi,bg,d;vec4 hitA[MAX_CROSSINGS],hitB[MAX_CROSSINGS];int count;bool escaped;vec3 dir;traceRay(vUv,r,phi,bg,d,hitA,hitB,count,escaped,dir);frag=vec4(d,phi,r,bg);}');
  const target=g.target(e.type.half.width,e.type.half.height,true),program=e.world17Geometry;
  try {
    g.bind(program,target);gl.uniform4fv(g.texture(program,'bands[0]'),state.bands);
    gl.uniform3fv(g.texture(program,'primary'),e.score.song.palette.primary);gl.uniform3fv(g.texture(program,'secondary'),e.score.song.palette.secondary);
    gl.uniform4fv(g.texture(program,'camera'),state.camera);gl.uniform4fv(g.texture(program,'view2'),state.view2);gl.uniform4fv(g.texture(program,'music'),state.music);
    gl.uniform3fv(g.texture(program,'gravity'),state.gravity);gl.uniform4fv(g.texture(program,'streaks[0]'),state.streaks);
    gl.uniform2f(g.texture(program,'outputResolution'),e.canvas.width,e.canvas.height);g.draw();
    const pixels=new Float32Array(target.width*target.height*4);gl.readPixels(0,0,target.width,target.height,gl.RGBA,gl.FLOAT,pixels);
    if(gl.getError())throw new Error('geometry GL error');return {pixels,width:target.width,height:target.height,view:world17View(state.camera,state.view2)};
  }finally {g.releaseTarget(target);}
}
// world12/13Shootをこのticketの計測経路へ差し替える（製品と他ticketのテストファイルは編集しない）。
async function world12Shoot(typeId,tSec){
  const w=__world,app=w.app,e=w.engine,audio=w.audio,c=WORLD17_CHECKS,gargantua=typeId==='g-gargantua';
  if(!['g-gargantua','g-fluid'].includes(typeId))throw new RangeError('未実装のタイプ');
  if(tSec<c.LEAD_SECONDS||tSec+c.G1_SECONDS>=w.score.durationSec)throw new RangeError('撮影窓が曲長の範囲外');
  for(let attempt=0;attempt<2;attempt++){
    audio.pause();cancelAnimationFrame(app.raf);app.state='paused';e.selectType(typeId,true);e.setScore(w.score);
    const timeline=e.timeline,queued=[],records=[];let timeout,first=null,firstState=null,firstTime=null;
    try {
      const start=tSec-c.LEAD_SECONDS;await e.renderAt(start);await world21DrainGpu(e);e.timeline=null;
      await world17Seek(audio,start);await world21DrainGpu(e);app.audioEngine.resetAnalysis();app.previousSec=audio.currentTime;
      let resolveShot,rejectShot,previousTime=-1;
      const completed=new Promise((resolve,reject)=>{resolveShot=resolve;rejectShot=reject;});
      timeout=setTimeout(()=>rejectShot(new Error('playback/capture timeout')),60000);
      e.onFrame=()=>{
        try {
          // 候補窓よりKICK_SECONDS早く記録し、先頭候補の直前最小値とロールを判定する。
          const time=e.latestSec;if(audio.seeking||time<tSec-c.PRE_KICK_SECONDS-c.KICK_SECONDS||time===previousTime)return;previousTime=time;
          const a=e.type,row={tSec:time,levels:Array.from({length:32},(_,i)=>a.bandUniforms[i*4]),
            onset:gargantua&&a.lastKick===time,kickSec:gargantua?a.lastKick:null,kick:gargantua?a.music[0]:null};
          // 描画されたフレームの時刻とuniformを転送前に固定する。
          queued.push({row,pixels:world17QueuePixels(e)});
          if(time>=tSec&&firstTime===null){
            firstTime=time;firstState=gargantua?{camera:a.camera.slice(),view2:a.view2.slice(),music:a.music.slice(),gravity:a.gravity.slice(),streaks:a.streaks.slice(),bands:a.bandUniforms.slice()}:null;
            // 遅れた初回標本では再生を止め、finallyで破棄して撮影全体をやり直す。
            if(firstTime-tSec>c.LAG_MAX_SECONDS){audio.pause();app.state='paused';e.onFrame=null;resolveShot();return;}
          }
          const post=queued.filter(q=>q.row.tSec>=tSec);
          if(firstTime!==null&&post.length>=c.G1_FRAMES&&time-firstTime>=c.G1_SECONDS){audio.pause();app.state='paused';e.onFrame=null;resolveShot();}
        }catch(error){e.onFrame=null;rejectShot(error);}
      };
      await app.start();await completed;clearTimeout(timeout);cancelAnimationFrame(app.raf);
      const lag=firstTime-tSec;
      if(lag>c.LAG_MAX_SECONDS){
        if(attempt===0)continue;
        throw new Error('capture lag '+lag.toFixed(3)+'s > '+c.LAG_MAX_SECONDS);
      }
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
}
async function world13Shoot(typeId,tSec){return world12Shoot(typeId,tSec);}
// §10の周期性・暖色/パレット・縞/不透明度・LOD・滑らかなキック・前方合成を実GLSLで照合する。
async function world17ShaderChecks(engine){
  const g=engine.gpu,gl=g.gl,c=WORLD_GARGANTUA,source=WORLD_GARGANTUA_FRAGMENT.replace(/void main\(\)\{[\s\S]*$/,'');
  const body=`void main(){
    float x=floor(gl_FragCoord.x),rd=3.5+x/63.*20.5,omega=KEPLER_SPEED*pow(rd/3.,KEPLER_POWER),row=floor(gl_FragCoord.y);
    float tau1=mod(music.w,FLOW_PERIOD);vec3 p=streakInput(rd,0.,omega,tau1,1.);
    if(row==0.){vec3 a=streakInput(rd,-PI,omega,tau1,1.),b=streakInput(rd,PI,omega,tau1,1.);frag=vec4(abs(a-b),abs(streakFlow(rd,-PI,omega,.02/rd)-streakFlow(rd,PI,omega,.02/rd)));}
    else if(row==1.)frag=vec4(mix(DISK_OUTER_COLOR,DISK_INNER_COLOR,pow(DISK_INNER/rd,COLOR_POWER)),musicGain(rd));
    else if(row==2.)frag=diskSample(vec3(rd,0.,0.),0.,vec3(0.,-1.,0.),0.,-1.);
    else if(row==3.){float fp=x/63.*3.;frag=vec4(1.-smoothstep(LOD_START,LOD_END,fp),streakFbm(p,2./STREAK_RADIAL,omega,tau1),streakFlow(rd,0.,omega,0.),1.);}
    else if(row==4.){vec4 value=diskSample(vec3(rd,0.,0.),0.,vec3(0.,-1.,0.),0.,-1.);float trans=1.;vec3 c=vec3(0.);for(int i=0;i<MAX_CROSSINGS;i++){c+=trans*value.rgb*value.a;trans*=1.-value.a;}frag=vec4(c.r,trans,value.a,1.);}
    else frag=vec4(musicGain(rd),0.,0.,1.);
  }`;
  const target=g.target(64,6,true),program=g.program(source+body),bands=new Float32Array(128),streaks=new Float32Array(WORLD_GARGANTUA.LIGHT_STREAK_COUNT*4);
  for(let i=0;i<WORLD_GARGANTUA.LIGHT_STREAK_COUNT;i++)streaks[i*4+2]=-100;
  try {
    g.bind(program,target);gl.uniform4fv(g.texture(program,'bands[0]'),bands);gl.uniform4fv(g.texture(program,'streaks[0]'),streaks);
    gl.uniform3fv(g.texture(program,'primary'),[.2,.5,.8]);gl.uniform3fv(g.texture(program,'gravity'),[1.5,1,3]);
    gl.uniform4fv(g.texture(program,'camera'),[17,.1,0,1]);gl.uniform4fv(g.texture(program,'music'),[1,3,1,45]);
    gl.uniform2f(g.texture(program,'outputResolution'),1280,720);g.draw();
    const pixels=new Float32Array(64*5*4);gl.readPixels(0,0,64,5,gl.RGBA,gl.FLOAT,pixels);
    const smooth=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
    let periodicError=0,colorError=0,diskError=0,kickError=0,lodError=0,integrationError=0,nonfinite=0;
    for(const value of pixels)if(!Number.isFinite(value))nonfinite++;
    for(let x=0;x<64;x++){
      for(let c=0;c<4;c++)periodicError=Math.max(periodicError,pixels[x*4+c]);
      const rd=3.5+x/63*20.5,colorMix=(c.DISK_INNER/rd)**c.COLOR_POWER,
        warm=c.DISK_OUTER_COLOR.map((value,i)=>value+(c.DISK_INNER_COLOR[i]-value)*colorMix),primary=[.2,.5,.8];
      for(let c=0;c<3;c++)colorError=Math.max(colorError,Math.abs(pixels[(64+x)*4+c]-warm[c]));
      const inner=1-smooth(c.DISK_INNER,c.KICK_RADIUS,rd),gain=c.MUSIC_BASE*(1+(c.KICK_REST-1)*inner)*(1+c.KICK_GAIN*inner);
      kickError=Math.max(kickError,Math.abs(pixels[(64+x)*4+3]-gain));
      const n=pixels[(192+x)*4+2],streak=c.STREAK_FLOOR+(1-c.STREAK_FLOOR)*smooth(c.STREAK_LO,c.STREAK_HI,n),
        env=smooth(c.DISK_INNER,c.INNER_FADE,rd)*(1-smooth(c.OUTER_FADE,c.DISK_OUTER,rd));
      const alpha=env*Math.min(c.OPACITY_MAX,c.OPACITY_BASE+c.OPACITY_STREAK*streak),I=c.DISK_HDR*env*streak*(c.DISK_INNER/rd)**c.INTENSITY_POWER;
      for(let i=0;i<3;i++)diskError=Math.max(diskError,Math.abs(pixels[(128+x)*4+i]-warm[i]*(1-c.PALETTE_TINT+c.PALETTE_TINT*primary[i]*c.PALETTE_GAIN)*I*gain));
      diskError=Math.max(diskError,Math.abs(pixels[(128+x)*4+3]-alpha));
      const noiseMean=c.NOISE_MEAN*(1-2**(-c.FBM_OCTAVES));
      lodError=Math.max(lodError,Math.abs(pixels[(192+x)*4]-(1-smooth(c.LOD_START,c.LOD_END,x/63*3))),Math.abs(pixels[(192+x)*4+1]-noiseMean));
      const trans=(1-alpha)**c.MAX_CROSSINGS,emission=pixels[(128+x)*4]*(1-trans);
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
      const inner=1-smooth(c.DISK_INNER,c.KICK_RADIUS,rd);
      bandError=Math.max(bandError,Math.abs(gains[x*4]-(c.MUSIC_BASE+c.MUSIC_GAIN*level)*(1+(c.KICK_REST-1)*inner)));
    }
    const glError=gl.getError();return {samples:384,periodicError,colorError,diskError,kickError,lodError,integrationError,bandError,nonfinite,glError,
      pass:!glError&&!nonfinite&&periodicError<.0001&&colorError<.001&&diskError<.004&&kickError<.004&&lodError<.001&&integrationError<.001&&bandError<.004};
  }finally {g.releaseTarget(target);}
}
// §10.7の指定時刻をrenderAtで正確に復元し、実音撮影と別に数値条件の画像を残す。
async function world17RenderCheck(engine){
  const e=engine;e.selectType('g-gargantua',true);await e.renderAt(WORLD17_CHECKS.ARC_TIME);
  const a=e.type,capture=e.capture(),state={camera:a.camera,view2:a.view2,music:a.music,gravity:a.gravity,streaks:a.streaks,bands:a.bandUniforms};
  if(capture.glError)throw new Error('renderAt capture GL error');
  const geometry=world17Geometry(e,state);
  const canvas=document.createElement('canvas');canvas.width=capture.width;canvas.height=capture.height;
  const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height),stride=canvas.width*4;
  for(let y=0;y<canvas.height;y++)image.data.set(capture.rgba.subarray((canvas.height-1-y)*stride,(canvas.height-y)*stride),y*stride);
  ctx.putImageData(image,0,0);
  return {requestedSec:WORLD17_CHECKS.ARC_TIME,width:capture.width,height:capture.height,
    stars:world17Stars(capture,geometry),arcs:world17Arcs(capture,geometry,a.gravity[1]),png:canvas.toDataURL('image/png')};
}
const browserFunctions=[world17View,world17Project,world17Median,world17Correlation,world17RealKick,world17Stars,world17Arcs,world17Acceptance,
  world17ShaderChecks,world17RenderCheck,world21DrainGpu,world17Seek,world17QueuePixels,world17ReadPixels,world17ReleasePixels,world17Geometry,world12Shoot,world13Shoot];
export const world17BrowserSource='const WORLD17_CHECKS='+JSON.stringify(WORLD17_CHECKS)+';\nconst WORLD21_DRAIN_BUFFER=new Uint8Array(4);\n'+browserFunctions.map(f=>f.toString().replace(/^export /,'')).join('\n');
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
    const live=world23LiveAcceptance(rows,gpu);
    const summary={v14,shader,gpu,live,environment:hardware,shots:rows.map(({records,...row})=>row),consoleErrors:chrome.errors};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(summary,null,2)+'\n');
    if((v14&&!v14.pass)||(shader&&!shader.pass)||chrome.errors.length||!live.pass)process.exitCode=1;
    console.log(JSON.stringify({v14,shader,gpu,live}));
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
      FBM_OCTAVES:4,FBM_FREQUENCY:2.03,LOD_HEIGHT:540,STREAK_FLOOR:.15,DISK_HDR:3,INTENSITY_POWER:.8,DISK_OUTER:20,OUTER_FADE:12,BAND_OUTER:14,
      GRAZE_MIN:.05,TURN_START:1.2,TURN_MAX_LOG:6.3,NOISE_MEAN:.5,
      STAR_PROBABILITY:.03,STAR_RADIUS_PX:.6,STAR_POWER:18,STAR_HDR:6,VEIL_GAIN:.10}))assert.equal(c[name],value,name);
    assert.equal(a.setQuality,undefined);assert.equal(a.flowQuality,undefined);
    const shader=r.get('WORLD_GARGANTUA_FRAGMENT');assert.ok(!/SLAB_|DISK_LAYER|history|EMA|BEAM_|blackbody|SPIKE_|STAR_HALO/.test(shader));
    console.log('UW-55 plane=1 crossings=3 octaves=4 frequency=2.03 starFloor=0 starPeak=6 veil=.10');
  });
  test('UW-56 WORLD-23 G-1は20標本/0.4秒・無分散は非適用・空領域を拒否',()=>{
    const rows=Array.from({length:21},(_,n)=>({tSec:7+n*.025,levels:Array.from({length:32},(_,b)=>(n+b)%9),
      luminance:Array.from({length:32},(_,b)=>2*((n+b)%9)),counts:new Array(32).fill(3)}));
    const result=world17Correlation(rows);assert.equal(result.median,1);assert.equal(result.pass,true);assert.equal(result.durationSec,.5);
    assert.equal(world17Correlation(rows.slice(0,2)).pass,false);assert.equal(world17Correlation(rows.map(r=>({...r,tSec:7}))).pass,false);
    const constant=world17Correlation(rows.map(r=>({...r,levels:new Array(32).fill(1)})));assert.equal(constant.applicable,false);assert.equal(constant.pass,false);
    assert.equal(world17Correlation(rows.map(r=>({...r,counts:new Array(32).fill(0)}))).pass,false);
    console.log('UW-56 samples=21 duration=.5 PearsonMedian=1 constantApplicable=false twoSamples/emptyRejected=true');
  });
  test('UW-57 WORLD-23 背景輝度>.5の30画素・境界/空測定拒否',()=>{
    const c={width:31,height:1,rgba:new Uint8Array(124)},g={width:31,height:1,pixels:new Float32Array(124)};
    c.rgba.fill(128);g.pixels.fill(1);assert.equal(world17Stars(c,g).pixels,31);
    c.rgba.fill(127,0,4);assert.equal(world17Stars(c,g).pass,true);
    c.rgba.fill(127,4,8);assert.equal(world17Stars(c,g).pass,false);
    g.pixels.fill(0);assert.equal(world17Stars(c,g).pixels,0);
    assert.equal(world17Stars({width:0,height:0,rgba:[]},{width:0,height:0,pixels:[]}).pass,false);
    console.log('UW-57 pixels=31/30 pass 29/0 fail thresholdStrictlyGreater=.5');
  });
  test('UW-58 WORLD-25 実キックの前.10秒最小値/後最大値35%・無キック/ロールは非適用',()=>{
    const rows=Array.from({length:24},(_,i)=>({tSec:(48+i)/60,inner:i===12?.272:.2,innerCount:12,onset:i===12}));
    const result=world17RealKick(rows,1);assert.equal(result.pass,true);assert.ok(Math.abs(result.increase-.36)<1e-12);
    assert.equal(result.after,.272);assert.equal('at100msSec' in result,false);
    const noKick=world17RealKick(rows.map(r=>({...r,onset:false})),1);assert.equal(noKick.applicable,false);assert.equal(noKick.pass,false);
    const roll=world17RealKick(rows.map((r,i)=>({...r,onset:i%4===0})),1);assert.equal(roll.applicable,false);assert.equal(roll.reason,'休みのないロール');
    assert.equal(world17RealKick(rows.map(r=>({...r,inner:.2})),1).pass,false);assert.equal(world17RealKick(rows.slice(0,13),1).pass,false);
    assert.equal(world17RealKick(rows.map(r=>({...r,innerCount:0})),1).pass,false);
    console.log('UW-58 realKickSec=1 screenPeakIncrease='+result.increase+' beforeSamples='+result.beforeSamples+' afterSamples='+result.afterSamples+' noKick/rollApplicable=false missingSamples/ROIRejected=true');
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
  test('UW-83 WORLD-30 片寄せ/ロール後の影を起点に弧を計測・画面中央が背景でも有効',()=>{
    const w=201,h=201,view=world17View([30,.05,.7,1],[10*Math.PI/180,3*Math.PI/180,-Math.PI/180,0]),
      capture={width:w,height:h,rgba:new Uint8Array(w*h*4)},geometry={width:w,height:h,pixels:new Float32Array(w*h*4),view},
      focal=h/(2*Math.tan(22*Math.PI/360)),dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
    let shadowPixels=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const d=view.f.map((v,i)=>v+view.r[i]*(x+.5-w/2)/focal+view.u[i]*(y+.5-h/2)/focal),
        z=dot(d,view.forward),dx=focal*dot(d,view.right)/z,dy=focal*dot(d,view.up)/z,o=(y*w+x)*4,
        dark=Math.hypot(dx,dy)<=10;
      geometry.pixels[o+2]=dark?.9:4;if(dark)shadowPixels++;
      if(Math.abs(dx)<=7&&((dy>=20&&dy<27)||(dy>=-21&&dy< -19)))capture.rgba.fill(217,o,o+3);
    }
    assert.equal(geometry.pixels[(100*w+100)*4+2],4,'画面中央は影ではない');
    const result=world17Arcs(capture,geometry,1);assert.equal(result.pass,true);assert.equal(result.shadowPixels,shadowPixels);
    assert.ok(result.upperThicknessPx>=6);assert.ok(result.lowerThicknessPx>=1);
    const noView=world17Arcs(capture,{...geometry,view:null},1);assert.equal(noView.pass,false);
    console.log('UW-83 shiftedRolledShadowPixels='+result.shadowPixels+' shadowRadius='+result.shadowRadiusPx+
      ' upperThickness='+result.upperThicknessPx+' lowerThickness='+result.lowerThicknessPx+' upperRatio='+result.upperRatio+' centeredAssumptionRejected=true');
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
  test('UW-61 WORLD-24 撮影mock: 候補窓の直前.18秒・最初の描画・20枚以上・後始末',async()=>{
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
      world21DrainGpu:async()=>{},
      world17Seek:async(a,t)=>{audioTime=t;},world17QueuePixels:()=>{rows.push(engine.latestSec);return {};},
      world17ReadPixels:async()=>{assert.equal(app.state,'paused');firstReadAt??=engine.latestSec;reads++;return [{width:1,height:1,pixels:new Uint8Array(4)}];},
      world17ReleasePixels(){},document:{createElement:()=>({getContext:()=>ctx,toDataURL:()=> 'data:image/png;base64,AA=='})},
      cancelAnimationFrame:()=>cancelled++,setTimeout,clearTimeout,Promise,Float32Array,Array};
    vm.createContext(scope);vm.runInContext(world12Shoot.toString(),scope);const shot=await scope.world12Shoot('g-fluid',7);
    assert.equal(shot.capturedSec,7);assert.equal(shot.records.length,25);assert.ok(shot.sampleEndSec-7>=.4);
    const historyStart=7-WORLD17_CHECKS.PRE_KICK_SECONDS-WORLD17_CHECKS.KICK_SECONDS;
    assert.ok(rows[0]>=historyStart);assert.ok(rows[0]-1/60<historyStart);
    assert.equal(reads,rows.length);assert.ok(firstReadAt>=7.4);assert.deepEqual(engine.timeline,[1]);assert.equal(engine.onFrame,null);
    assert.ok(cancelled>=2);console.log('UW-61 capturedSec='+shot.capturedSec+' lag=0 historyStart='+rows[0]+' postFrames='+shot.records.length+' duration='+(shot.sampleEndSec-7)+' queuedFrames='+rows.length+' readsAfterPause='+reads);
  });
  test('UW-64 WORLD-21 mock audio/GL: GPU drainがstartより先・lagは1回再試行して失敗',async()=>{
    const vm=await import('node:vm');
    async function capture(lags){
      const order=[],listeners=new Map(),buffers=new Set(),fences=new Set(),drainBuffers=[],timeline=[1];
      let audioTime=0,seeking=false,starts=0,reads=0,transfers=0,cancelled=0,framebuffer={},packBuffer={};
      const engine={timeline,latestSec:0,type:{id:'g-fluid',bandUniforms:new Float32Array(128)},
        post:{output:{width:1,height:1,fbo:{}}},selectType(id,reset){assert.equal(id,'g-fluid');assert.equal(reset,true);order.push('select');},
        setScore(){order.push('score');},async renderAt(t){assert.equal(this.timeline,timeline);assert.equal(t,5.5);this.latestSec=t;order.push('render');
          framebuffer={};packBuffer={};},metrics(){return {};},mfsFrames:40};
      const audio={pause(){},get currentTime(){return audioTime;},set currentTime(t){
        assert.ok(listeners.has('seeked'));audioTime=t;seeking=true;order.push('seek');
        queueMicrotask(()=>{seeking=false;order.push('seeked');listeners.get('seeked')();});},get seeking(){return seeking;},
        addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
      const app={state:'paused',raf:1,audioEngine:{resetAnalysis(){order.push('reset');}},async start(){
        assert.equal(audio.currentTime,5.5);assert.equal(this.previousSec,5.5);assert.equal(engine.timeline,null);
        const lag=lags[starts++];assert.notEqual(lag,undefined,'再試行は1回まで');order.push('start');this.state='playing';
        for(let i=0;i<100&&this.state==='playing';i++){audioTime=7+lag+i/60;engine.latestSec=audioTime;engine.onFrame();}
        assert.equal(this.state,'paused','撮影窓内で完了する');
      }};
      const gl={FRAMEBUFFER:1,PIXEL_PACK_BUFFER:2,RGBA:3,UNSIGNED_BYTE:4,STREAM_READ:5,SYNC_GPU_COMMANDS_COMPLETE:6,
        WAIT_FAILED:7,TIMEOUT_EXPIRED:8,bindFramebuffer(target,value){assert.equal(target,this.FRAMEBUFFER);framebuffer=value;},
        bindBuffer(target,value){assert.equal(target,this.PIXEL_PACK_BUFFER);packBuffer=value;},
        readPixels(x,y,width,height,format,type,destination){
          assert.deepEqual([x,y,width,height,format,type],[0,0,1,1,this.RGBA,this.UNSIGNED_BYTE]);
          if(destination===0){assert.equal(app.state,'playing');assert.ok(buffers.has(packBuffer));assert.equal(framebuffer,engine.post.output.fbo);transfers++;}
          else {assert.equal(app.state,'paused');assert.equal(framebuffer,null);assert.equal(packBuffer,null);
            assert.equal(Object.prototype.toString.call(destination),'[object Uint8Array]');assert.equal(destination.length,4);
            drainBuffers.push(destination);order.push('drain');}
        },createBuffer(){const buffer={};buffers.add(buffer);return buffer;},bufferData(){},
        createFence(){const fence={};fences.add(fence);return fence;},fenceSync(){return this.createFence();},flush(){},getError(){return 0;},
        clientWaitSync(){return 9;},getBufferSubData(target,offset,pixels){assert.equal(app.state,'paused');assert.ok(buffers.has(packBuffer));pixels.fill(128);reads++;},
        deleteBuffer(buffer){assert.equal(app.state,'paused');assert.equal(buffers.delete(buffer),true);},
        deleteSync(fence){assert.equal(fences.delete(fence),true);}};
      engine.gpu={gl};
      const ctx={createImageData:()=>({data:new Uint8Array(4)}),putImageData(){}},scope={__world:{app,engine,audio,score:{durationSec:20}},
        document:{createElement:()=>({getContext:()=>ctx,toDataURL:()=> 'data:image/png;base64,AA=='})},
        requestAnimationFrame:fn=>{assert.equal(app.state,'paused');order.push('rAF');queueMicrotask(fn);return 1;},
        cancelAnimationFrame:()=>cancelled++,setTimeout,clearTimeout,performance};
      vm.createContext(scope);vm.runInContext(world17BrowserSource,scope);
      let shot,error;try {shot=await scope.world12Shoot('g-fluid',7);}catch(value){error=value;}
      assert.equal(engine.timeline,timeline);assert.equal(engine.onFrame,null);assert.equal(app.state,'paused');
      assert.equal(audio.seeking,false);assert.equal(listeners.size,0);assert.equal(buffers.size,0);assert.equal(fences.size,0);
      assert.ok(cancelled>=2*starts);assert.equal(drainBuffers.length,2*starts);
      assert.ok(drainBuffers.every(buffer=>buffer===drainBuffers[0]),'4-byte bufferを全試行で使い回す');
      const attemptOrder=['select','score','render','drain','rAF','rAF','seek','seeked','rAF','drain','rAF','rAF','reset','start'];
      assert.deepEqual(order,Array.from({length:starts},()=>attemptOrder).flat());
      return {shot,error,starts,reads,transfers,drains:drainBuffers.length};
    }
    assert.equal(WORLD17_CHECKS.LAG_MAX_SECONDS,1/30);
    const onTime=await capture([0]);assert.equal(onTime.error,undefined);assert.equal(onTime.starts,1);assert.equal(onTime.shot.captureLagSec,0);
    const boundary=await capture([WORLD17_CHECKS.LAG_MAX_SECONDS]);assert.equal(boundary.error,undefined);assert.equal(boundary.starts,1);
    assert.ok(Math.abs(boundary.shot.captureLagSec-WORLD17_CHECKS.LAG_MAX_SECONDS)<1e-12);
    const retried=await capture([2.5,0]);assert.equal(retried.error,undefined);assert.equal(retried.starts,2);assert.equal(retried.shot.captureLagSec,0);
    assert.equal(retried.transfers-retried.reads,1,'遅れた試行のPBOはreadbackせず破棄');
    const failed=await capture([2.5,.1]);assert.equal(failed.starts,2);assert.equal(failed.shot,undefined);assert.equal(failed.reads,0);assert.equal(failed.transfers,2);
    assert.equal(failed.error?.message,'capture lag 0.100s > '+WORLD17_CHECKS.LAG_MAX_SECONDS);
    const overBoundary=await capture([WORLD17_CHECKS.LAG_MAX_SECONDS+1e-6,WORLD17_CHECKS.LAG_MAX_SECONDS+1e-6]);
    assert.equal(overBoundary.starts,2);assert.equal(overBoundary.error?.message,'capture lag 0.033s > '+WORLD17_CHECKS.LAG_MAX_SECONDS);
    console.log('UW-64 lagMax='+WORLD17_CHECKS.LAG_MAX_SECONDS+' cases=5 drainsPerAttempt=2 rAFPerDrain=2 bufferBytes=4 retryStarts='+retried.starts+
      ' retryLag='+retried.shot.captureLagSec+' failedStarts='+failed.starts+' failedLag=.1 failedReads='+failed.reads+' leakedBuffers=0 leakedFences=0');
  });
  test('UW-65 WORLD-21 probeのJS/GLSL定数参照とdiskSample署名が現行ソースに存在する',async()=>{
    const r=loadClassic(['js/world/gl-util.js','js/world/score.js','js/world/analyzer-types.js','js/world/g-gargantua.js']);
    const constants=r.get('WORLD_GARGANTUA'),shader=r.get('WORLD_GARGANTUA_FRAGMENT'),source=await fs.readFile(fileURLToPath(import.meta.url),'utf8');
    const directNames=[...source.matchAll(/WORLD_GARGANTUA\.(\w+)/g)].map(match=>match[1]);
    const probeSource=world17ShaderChecks.toString(),jsSource=probeSource.replace(/const body=`[\s\S]*?`;/,''),
      aliasNames=[...jsSource.matchAll(/\bc\.(\w+)/g)].map(match=>match[1]);
    const jsNames=new Set([...directNames,...aliasNames]);for(const name of jsNames)assert.ok(Object.hasOwn(constants,name),name);
    const body=probeSource.match(/const body=`([\s\S]*?)`;/)[1],glslNames=new Set(body.match(/\b[A-Z][A-Z_0-9]*\b/g)),
      declared=new Set([...shader.matchAll(/\bconst\s+(?:float|int|vec3)\s+(\w+)/g)].map(match=>match[1]));
    for(const name of glslNames)assert.ok(declared.has(name),name);
    assert.equal((body.match(/diskSample\(vec3\(rd,0\.,0\.\),0\.,vec3\(0\.,-1\.,0\.\),0\.,-1\.\)/g)||[]).length,2);
    assert.match(shader,/vec4 diskSample\(vec3 hit,float travel,vec3 ndir,float turn,float lf\)/);
    assert.match(shader,/vec3 streakInput\(float rd,float phi,float omega,float tau,float phase\)/);
    assert.match(shader,/float streakFbm\(vec3 p,float lf,float omega,float tau\)/);
    assert.match(shader,/float streakFlow\(float rd,float phi,float omega,float lf\)/);
    assert.equal((body.match(/streakInput\(rd,(?:0\.|-PI|PI),omega,tau1,1\.\)/g)||[]).length,3);
    assert.equal((body.match(/streakFbm\(p,2\.\/STREAK_RADIAL,omega,tau1\)/g)||[]).length,1);
    assert.equal((body.match(/streakFlow\(rd,(?:0\.|-PI|PI),omega,(?:0\.|\.02\/rd)\)/g)||[]).length,3);
    assert.equal(constants.NOISE_MEAN*(1-2**(-constants.FBM_OCTAVES)),.46875);
    console.log('UW-65 JSConstants='+jsNames.size+' GLSLConstants='+glslNames.size+' diskSampleCalls=2 fullyFilteredNoise=.46875 missingConstants=0');
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
