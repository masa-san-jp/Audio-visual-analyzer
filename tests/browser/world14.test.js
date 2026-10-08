// 目的 — v1.1の画面輝度・継ぎ目・星の見える大きさを実画素で測る — doc/20261004-design-gargantua-v1.md §7.7
// @page harness
function world14ExposureReport(capture) {
  let clipped=0;const p=capture.rgba,n=capture.width*capture.height;
  for(let i=0;i<p.length;i+=4)if((.2126*p[i]+.7152*p[i+1]+.0722*p[i+2])/255>=.97)clipped++;
  return {clippedPixels:clipped,pixels:n,fraction:n?clipped/n:1,pass:n>0&&clipped/n<=.08};
}
function world14KickReport(before,after,at100ms) {
  const mean=rows=>rows.reduce((sum,r)=>sum+r.inner,0)/Math.max(1,rows.length);
  const pre=mean(before),post=mean(after),increase=pre>0?(post-pre)/pre:0;
  const at100msIncrease=pre>0&&at100ms?(at100ms.inner-pre)/pre:0;
  return {before:pre,after:post,increase,at100ms:at100ms?.inner??null,at100msIncrease,windowSeconds:.1,
    beforeSamples:before.length,afterSamples:after.length,
    pass:before.length===6&&after.length===6&&before.concat(after).every(r=>r.innerCount>0)&&at100ms?.innerCount>0&&increase>=.35&&at100msIncrease>=.35};
}
// 元のキック測定と同じ固定入力・6枚窓・100msの実標本。v1.1では表示sRGB輝度で合否を決める。
async function world14Kick(engine) {
  const e=engine,originalScore=e.score,originalTimeline=e.timeline,originalType=e.type.id,originalFps=e.fps;
  const score=compileWorldScore({bpm:120,durationSec:8,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:8,kind:'main',label:'G-kick-v1.1'}]},11);
  const f=new MfsFrameView(),before=[],after=[];let at100ms;
  try {
    e.timeline=null;e.selectType('g-gargantua',true);e.setScore(score);f.bandsSmooth.fill(.47);f.raw[MFS_LAYOUT.LEVEL]=.65;
    for(let frame=0;frame<=186;frame++){
      f.raw[MFS_LAYOUT.ONSET_FLAGS]=frame===180?1:0;e._step(frame/60,f,1/60);
      if(frame>=174){e._draw();const capture=e.capture();if(capture.glError)throw new Error('kick GL error');
        const row=world13ReadAnnuli(e,capture);if(frame===186)at100ms=row;else (frame<180?before:after).push(row);}
      if(frame%30===0)await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    return world14KickReport(before,after,at100ms);
  }finally {e.selectType(originalType,true);e.setScore(originalScore);e.setTimeline(originalTimeline,originalFps);}
}
// 計測専用shaderで直接像のφ／最接近距離／背景マスクを同じ半解像度で引く。
function world14ReadGeometry(engine) {
  const e=engine,a=e.type,g=e.gpu,gl=g.gl;
  if(!e.world14Geometry){
    const source=WORLD_GARGANTUA_FRAGMENT.replace(/void main\(\)\{[\s\S]*$/,'');
    e.world14Geometry=g.program(source+'void main(){float r,phi,bg;vec4 c=traceRay(vUv,r,phi,bg);frag=vec4(c.a,phi,r,bg);}');
  }
  const target=g.target(a.half.width,a.half.height,true),program=e.world14Geometry;
  try {
    g.bind(program,target);gl.uniform4fv(g.texture(program,'bands[0]'),a.bandUniforms);
    gl.uniform3fv(g.texture(program,'primary'),e.score.song.palette.primary);gl.uniform3fv(g.texture(program,'secondary'),e.score.song.palette.secondary);
    gl.uniform4fv(g.texture(program,'camera'),a.camera);gl.uniform4fv(g.texture(program,'music'),a.music);
    gl.uniform3fv(g.texture(program,'gravity'),a.gravity);gl.uniform4fv(g.texture(program,'streaks[0]'),a.streaks);
    gl.uniform2f(g.texture(program,'outputResolution'),e.canvas.width,e.canvas.height);g.draw();
    const pixels=new Float32Array(target.width*target.height*4);gl.readPixels(0,0,target.width,target.height,gl.RGBA,gl.FLOAT,pixels);
    if(gl.getError())throw new Error('v1.1 geometry GL error');
    return {pixels,width:target.width,height:target.height};
  }finally {g.releaseTarget(target);}
}
function world14SeamReport(capture,geometry) {
  const w=capture.width,h=capture.height,p=capture.rgba,g=geometry.pixels;
  const Y=(x,y)=>{const i=(y*w+x)*4;return (.2126*p[i]+.7152*p[i+1]+.0722*p[i+2])/255;};
  const meta=(x,y)=>((Math.min(geometry.height-1,Math.floor(y*geometry.height/h))*geometry.width+
    Math.min(geometry.width-1,Math.floor(x*geometry.width/w)))*4);
  const difference=(x,y)=>{
    let left=0,right=0;for(let k=0;k<4;k++){left+=Y(x-1-k,y);right+=Y(x+k,y);}return Math.abs(left-right)/4;
  };
  let seam=0,surround=0,samples=0;
  for(let y=0;y<h;y++)for(let x=12;x<w-12;x++){
    const l=meta(x-1,y),r=meta(x,y);
    // φ=±πの実際の折り返しだけを選ぶ。背景／高次像／内外縁は除く。
    if(g[l]<3.5||g[r]<3.5||g[l]>10.5||g[r]>10.5||Math.abs(g[l+1]-g[r+1])<6)continue;
    let valid=true;for(const dx of [-12,-4,4,12]){const o=meta(x+dx,y);if(g[o]<3.5||g[o]>10.5)valid=false;}
    if(!valid)continue;
    seam+=difference(x,y);surround+=(difference(x-8,y)+difference(x+8,y))*.5;samples++;
  }
  const seamDifference=samples?seam/samples:0,surroundingDifference=samples?surround/samples:0;
  return {samples,seamDifference,surroundingDifference,ratio:surroundingDifference>0?seamDifference/surroundingDifference:null,
    pass:samples>0&&seamDifference<=2*surroundingDifference};
}
function world14StarReport(capture,geometry) {
  const w=capture.width,h=capture.height,n=w*h,p=capture.rgba,g=geometry.pixels;
  // 星空背景の上限.04（線形HDR）の表示値より明るい芯を8近傍で連結する。
  // 背景のみ逃走した光線をマスクに使い、円盤や光速の筋を星として数えない。
  const mask=new Uint8Array(n),queue=new Uint32Array(n),threshold=.22;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const o=(y*w+x)*4,gm=(Math.min(geometry.height-1,Math.floor(y*geometry.height/h))*geometry.width+
      Math.min(geometry.width-1,Math.floor(x*geometry.width/w)))*4;
    if(g[gm+3]>.5&&(.2126*p[o]+.7152*p[o+1]+.0722*p[o+2])/255>=threshold)mask[y*w+x]=1;
  }
  let visible=0,components=0;const diameters=[];
  for(let i=0;i<n;i++){
    if(!mask[i])continue;mask[i]=0;queue[0]=i;let head=0,tail=1,area=0;
    let minX=w,maxX=0,minY=h,maxY=0;
    while(head<tail){
      const pos=queue[head++],x=pos%w,y=Math.floor(pos/w);area++;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const next=ny*w+nx;
        if(mask[next]){mask[next]=0;queue[tail++]=next;}
      }
    }
    components++;const diameter=2*Math.sqrt(area/Math.PI)*1080/h;
    // 大きい円盤縁の漏れ／雲は除く。1.5画素は1080p相当の等面積直径。
    if(diameter>=1.5&&maxX-minX+1<=64*w/1920&&maxY-minY+1<=64*h/1080){visible++;diameters.push(diameter);}
  }
  return {visible,components,threshold,minDiameterPx:1.5,meanDiameterPx:diameters.length?diameters.reduce((a,b)=>a+b,0)/diameters.length:0};
}
function world14ShotReport(engine,capture) {
  const geometry=world14ReadGeometry(engine);
  return {exposure:world14ExposureReport(capture),stars:world14StarReport(capture,geometry)};
}
function world14AcceptanceReport(shots,seams,kick,gpu) {
  const applicable=shots.filter(s=>s.typeId==='g-gargantua');
  const frames=applicable.flatMap(s=>s.records.map(r=>r.exposure));
  const exposure={samples:frames.length,maxFraction:frames.length?Math.max(...frames.map(r=>r?.fraction??1)):null,
    pass:frames.length>0&&frames.every(r=>r?.pass)&&applicable.every(s=>s.v11?.exposure.pass)};
  const meanStars=applicable.length?applicable.reduce((sum,s)=>sum+(s.v11?.stars.visible??0),0)/applicable.length:0;
  const stars={samples:applicable.length,meanVisible:meanStars,minDiameterPx:1.5,pass:applicable.length>0&&meanStars>=400};
  const seam={samples:seams.length,results:seams,pass:seams.length===applicable.length&&seams.length>0&&seams.every(s=>s.pass)};
  return {exposure,stars,seam,kick,gpu,pass:exposure.pass&&stars.pass&&seam.pass&&!!kick?.pass&&!!gpu?.pass};
}
// 方位角πへ一時的に回して近側の継ぎ目を画面に置く。時刻・incl・重力・音楽は撮影時の値。
function world14Seam(engine) {
  const a=engine.type,azim=a.camera[2];
  try {a.camera[2]=Math.PI;engine._draw();const capture=engine.capture();if(capture.glError)throw new Error('seam GL error');
    return world14SeamReport(capture,world14ReadGeometry(engine));
  }finally {a.camera[2]=azim;engine._draw();}
}
if(typeof avzTest==='function')avzTest('BW-14-screen','v1.1の継ぎ目4画素・白飛び輝度.97・星400個・画面キック35%・GPU16ms',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../../world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  try {
    await ready;const child=iframe.contentWindow,e=child.__world?.engine;avzAssert.ok(e,child.__world?.error);
    child.eval([world13AnnulusSamples,world13ReadAnnuli,world13Performance,world14ExposureReport,world14KickReport,world14Kick,
      world14ReadGeometry,world14SeamReport,world14StarReport,world14ShotReport,world14AcceptanceReport,world14Seam].map(f=>f.toString()).join('\n'));
    const result=await child.eval(`(async()=>{
      const e=__world.engine,score=compileWorldScore({bpm:120,durationSec:100,beats:[],downbeatIndices:[],sections:
        [{startSec:0,endSec:14,kind:'intro',label:'I'},{startSec:14,endSec:26,kind:'build',label:'B'},
         {startSec:26,endSec:40,kind:'drop',label:'D'},{startSec:40,endSec:54,kind:'break',label:'K'},
         {startSec:54,endSec:80,kind:'drop',label:'D'},{startSec:80,endSec:100,kind:'outro',label:'O'}]},11),f=new MfsFrameView();
      e.timeline=null;e.selectType('g-gargantua',true);e.setScore(score);f.bandsSmooth.fill(.8);f.raw[MFS_LAYOUT.LEVEL]=.8;
      const shots=[],seams=[],times=[7,20,31,45,62,90];
      for(let frame=0;frame<=5400;frame++){
        f.raw[MFS_LAYOUT.ONSET_FLAGS]=frame%30===0?5:0;e._step(frame/60,f,1/60);
        if(times.includes(frame/60)){e._draw();const c=e.capture();if(c.glError)throw new Error('shot GL error');
          shots.push({typeId:'g-gargantua',records:[{exposure:world14ExposureReport(c)}],v11:world14ShotReport(e,c)});
          seams.push({tSec:frame/60,...world14Seam(e)});}
      }
      return world14AcceptanceReport(shots,seams,await world14Kick(e),await world13Performance(e));
    })()`);
    console.log('BW-14-screen '+JSON.stringify(result));avzAssert.ok(result.pass,JSON.stringify(result));
  }finally {iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
},{timeoutMs:180000,slow:true});
if(typeof module!=='undefined'&&module.exports){module.exports={world14ExposureReport,world14KickReport,world14SeamReport,world14StarReport,world14AcceptanceReport};}
if(typeof avzTest==='function')avzTest('BW-14-periodic','実GLSLの両層・6時刻のφ周期性と有限な出力',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../../world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  try {
    await ready;const child=iframe.contentWindow;avzAssert.ok(child.__world?.engine,child.__world?.error);
    const result=child.eval(`(()=>{
      const e=__world.engine,g=e.gpu,gl=g.gl,source=WORLD_GARGANTUA_FRAGMENT.replace(/void main\\(\\)\\{[\\s\\S]*$/,'');
      const target=g.target(64,2,true),program=g.program(source+'void main(){float layer=floor(gl_FragCoord.y),rd=3.5+floor(gl_FragCoord.x)/64.*7.;float omega=KEPLER_SPEED*pow(rd/DISK_INNER,KEPLER_POWER)*music.z;vec3 a=filamentInput(rd,-PI,omega,layer),b=filamentInput(rd,PI,omega,layer);frag=vec4(abs(a-b),abs(fbm(a)-fbm(b)));}');
      let inputError=0,fbmError=0,nonfinite=0;
      try {
        for(const t of [7,20,31,45,62,90]){
          g.bind(program,target);gl.uniform4fv(g.texture(program,'music'),[0,0,1,t]);g.draw();
          const p=new Float32Array(64*2*4);gl.readPixels(0,0,64,2,gl.RGBA,gl.FLOAT,p);
          for(let i=0;i<p.length;i++){if(!Number.isFinite(p[i]))nonfinite++;if(i%4===3)fbmError=Math.max(fbmError,p[i]);else inputError=Math.max(inputError,p[i]);}
        }
        return {inputError,fbmError,nonfinite,samples:64*2*6,glError:gl.getError()};
      }finally {g.releaseTarget(target);}
    })()`);
    console.log('BW-14-periodic '+JSON.stringify(result));avzAssert.equal(result.glError,0);avzAssert.equal(result.nonfinite,0);
    avzAssert.ok(result.inputError<.0001);avzAssert.ok(result.fbmError<.0001);
  }finally {iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
},{timeoutMs:60000});
