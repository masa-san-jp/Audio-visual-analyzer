// 目的 — 実HDR像・MFS入力からGPUタイプのG-1〜G-4を計測する — 構想 §2.8(4)
// @page harness
// G-1: 8秒の独立した32帯域包絡。60Hzで描画、15Hzで最終sRGB像を4px間隔で標本化。
//      詳細設計v1: ringsは鏡像64光線の回転扇形、galaxyは62度・非線形半径の軌道環。
//      整形後のL_iと領域平均YのPearson相関を全32帯域で検査（最小≥.6）。
// G-2: 定常帯域・一定ラウドネス、3秒の拍前[2.9,3)と拍後[3,3.1)の6枚ずつ。
//      |after-before|/before、黒→非ゼロはInfinity。空の窓／両方黒は失敗。
// G-3: 6秒の90BPM/C/純音と180BPM/F#/倍音＋細かい打撃を実offline MFSで解析。
//      4×4平均したsRGB像の24色相binをYで重み付け・正規化し、総変動距離=.5Σ|a-b|。
//      黒い背景の共通面積が色の違いを隠さないよう輝度重みを使用。全黒像は失敗。
// G-4: 1080pで2秒ウォームアップ＋3秒の全帯域強入力。実GPU queryのp95、≥120標本。
//      CPU／rAF／readPixelsは別に記録。timer未対応／disjoint／software GPUは合格にしない。
function world11Correlation(x, y) {
  const n=x.length;if(n!==y.length||n<2)return 0;
  let sx=0,sy=0,xx=0,yy=0,xy=0;
  for(let i=0;i<n;i++){sx+=x[i];sy+=y[i];xx+=x[i]*x[i];yy+=y[i]*y[i];xy+=x[i]*y[i];}
  const denominator=Math.sqrt(Math.max(0,n*xx-sx*sx)*Math.max(0,n*yy-sy*sy));
  return denominator>0?(n*xy-sx*sy)/denominator:0;
}
function world11Histogram(capture) {
  const bins=new Float64Array(24),p=capture.rgba;let weight=0;
  for(let y=0;y<capture.height;y+=4)for(let x=0;x<capture.width;x+=4){
    let r=0,g=0,b=0,n=0;
    for(let dy=0;dy<4&&y+dy<capture.height;dy++)for(let dx=0;dx<4&&x+dx<capture.width;dx++){
      const o=((y+dy)*capture.width+x+dx)*4;r+=p[o];g+=p[o+1];b+=p[o+2];n++;
    }
    r/=n*255;g/=n*255;b/=n*255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    if(d<1/255)continue;let hue=max===r?(g-b)/d:max===g?2+(b-r)/d:4+(r-g)/d;
    hue=((hue/6)%1+1)%1;const w=.2126*r+.7152*g+.0722*b;
    bins[Math.min(23,Math.floor(hue*24))]+=w;weight+=w;
  }
  if(weight)for(let i=0;i<24;i++)bins[i]/=weight;
  return {bins:Array.from(bins),weight};
}
function world11HistogramDistance(a,b){let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum*.5;}
function world11RegionSamples(capture,typeId,state){
  const sums=new Float64Array(32),counts=new Uint32Array(32),p=capture.rgba,w=capture.width,h=capture.height;
  const t=state?.tSec||0,speed=state?.speed||1,beat=state?.beat||0,bass=state?.bass||0;
  const angle=t*.04*speed+beat*.025,c=Math.cos(angle),s=Math.sin(angle),scale=1+beat*.035;
  const inner=.075+bass*.035+beat*.02,tilt=Math.cos(62*Math.PI/180);
  for(let y=0;y<h;y+=4)for(let x=0;x<w;x+=4){
    const px=(x+.5-w/2)/h,py=(y+.5-h/2)/h;let band=-1;
    if(typeId==='g-rings'){
      const qx=c*px-s*py,qy=s*px+c*py,r=Math.hypot(px,py);
      if(r>=inner+.02&&r<=inner+.06+.40+.05*bass){
        const a=Math.atan2(qy,qx)+Math.PI,ray=Math.min(63,Math.floor(a/(Math.PI*2)*64));band=ray<32?ray:63-ray;
      }
    }else{
      const r=Math.hypot(px,py/tilt)/scale;
      // 非線形の32軌道。隣接半径の中点が環の境界になる。
      if(r>=.10-.5*(.78*Math.pow(1/31,.9))&&r<=.88+.5*(.88-(.10+.78*Math.pow(30/31,.9)))){
        const orbit=31*Math.pow(Math.max(0,(r-.10)/.78),1/.9),lo=Math.min(31,Math.floor(orbit)),hi=Math.min(31,lo+1);
        const rLo=.10+.78*Math.pow(lo/31,.9),rHi=.10+.78*Math.pow(hi/31,.9);
        band=Math.abs(r-rLo)<=Math.abs(r-rHi)?lo:hi;
      }
    }
    if(band>=0){const o=(y*w+x)*4;sums[band]+=(.2126*p[o]+.7152*p[o+1]+.0722*p[o+2])/255;counts[band]++;}
  }
  return Array.from(sums,(v,i)=>counts[i]?v/counts[i]:0);
}
function world11SyntheticSong(bpm,key,harmonics,duration=6){
  const sampleRate=48000,n=Math.round(sampleRate*duration),a=new Float32Array(n),b=new Float32Array(n);
  const frequency=261.625565*Math.pow(2,key/12),beatSec=60/bpm;
  for(let i=0;i<n;i++){
    const t=i/sampleRate,age=t%beatSec,envelope=.2+.8*Math.exp(-age*18);let v=0;
    for(let h=1;h<=harmonics;h++)v+=Math.sin(2*Math.PI*frequency*h*t)/h;
    const percussion=harmonics>1?Math.sin(2*Math.PI*6200*t)*Math.exp(-(t%(beatSec/4))*180)*.12:0;
    a[i]=b[i]=v*.12*envelope+percussion;
  }
  return {sampleRate,channels:[a,b]};
}
async function runWorldAnalyzerMeasurement(){
  const engine=window.__world.engine,originalScore=engine.score,originalTimeline=engine.timeline,originalFps=engine.fps,originalType=engine.type.id;
  // 選択肢から外したshaderも、従来G閾値を保った回帰として明示的に登録する。
  const retained=[new WorldRingsAnalyzer(),new WorldGalaxyAnalyzer()];
  for(const analyzer of retained){analyzer.init(engine.gpu);engine.types.push(analyzer);}
  const types=['g-fluid','g-rings','g-galaxy'],G1=[],G2=[],G3=[],G4=[];let glErrors=0;
  const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const feature=new MfsFrameView(),score=compileWorldScore({bpm:120,durationSec:12,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:12,kind:'main',label:'G'}]},11);
  engine.timeline=null;
  try{
    for(const typeId of ['g-rings','g-galaxy']){
      engine.selectType(typeId,true);engine.setScore(score);
      const levels=Array.from({length:32},()=>[]),regions=Array.from({length:32},()=>[]);
      for(let frame=0;frame<480;frame++){
        const t=frame/60;feature.raw.fill(0);feature.raw[MFS_LAYOUT.LEVEL]=.65;
        for(let i=0;i<32;i++)feature.bandsSmooth[i]=.05+.9*(.5+.5*Math.sin(t*(1.4+i*.067)+i*2.399963));
        engine._step(t,feature,1/60);
        if(frame%4===0){engine._draw();const capture=engine.capture();if(capture.glError)glErrors++;const values=world11RegionSamples(capture,typeId,{tSec:t,speed:engine.type.songUniforms[0],beat:engine.type.pulseUniforms[0],bass:engine.type.pulseUniforms[2]});
          for(let i=0;i<32;i++){levels[i].push(engine.type.bandUniforms[i*4]);regions[i].push(values[i]);}}
        if(frame%30===0)await nextFrame();
      }
      const correlations=levels.map((values,i)=>world11Correlation(values,regions[i]));
      G1.push({typeId,correlations,minimum:Math.min(...correlations),samples:levels[0].length,pass:correlations.every(r=>r>=.6)});
    }
    for(const typeId of types){
      engine.selectType(typeId,true);engine.setScore(score);feature.raw.fill(0);feature.bandsSmooth.fill(.65);feature.raw[MFS_LAYOUT.LEVEL]=.65;
      let before=0,after=0,beforeN=0,afterN=0;
      for(let frame=0;frame<186;frame++){
        feature.raw[MFS_LAYOUT.BEAT_FLAG]=frame===180?1:0;engine._step(frame/60,feature,1/60);
        if(frame>=174){engine._draw();const capture=engine.capture();if(capture.glError)glErrors++;const mean=capture.mean;if(frame<180){before+=mean;beforeN++;}else{after+=mean;afterN++;}}
        if(frame%30===0)await nextFrame();
      }
      before/=beforeN;after/=afterN;const swing=before>0?Math.abs(after-before)/before:after>0?Infinity:0;
      G2.push({typeId,before,after,beforeN,afterN,swing:swing===Infinity?'Infinity':swing,pass:beforeN===6&&afterN===6&&swing>=.25});
    }
    const songs=[];
    for(const [bpm,key,harmonics] of [[90,0,1],[180,6,9]]){
      const file=new File([encodeWav16(world11SyntheticSong(bpm,key,harmonics))],'G3-'+bpm+'.wav',{type:'audio/wav',lastModified:1});
      const prepared=await window.__world.app.exporter.prepare(file,60);
      const map={bpm,durationSec:6,beats:Array.from({length:Math.floor(6*bpm/60)},(_,i)=>i*60/bpm),downbeatIndices:[],sections:[{startSec:0,endSec:6,kind:'main',label:'G3'}]};
      songs.push({score:compileWorldScore(map,11,prepared.featureFrames),prepared});
    }
    for(const typeId of types){
      const histograms=[];
      for(const song of songs){engine.selectType(typeId,true);engine.setScore(song.score);engine.setTimeline(song.prepared.featureFrames,60);
        await engine.renderAt(3);const capture=engine.capture();if(capture.glError)glErrors++;histograms.push(world11Histogram(capture));}
      const a=songs[0].score.song,b=songs[1].score.song,distance=world11HistogramDistance(histograms[0].bins,histograms[1].bins);
      const parametersDiffer=JSON.stringify(a.palette)!==JSON.stringify(b.palette)&&a.motionSpeed!==b.motionSpeed&&a.detail!==b.detail&&a.particleAmount!==b.particleAmount;
      G3.push({typeId,distance,histograms,parameters:[a,b],pass:parametersDiffer&&histograms.every(h=>h.weight>0)&&distance>=.3});
    }
    engine.timeline=null;
    for(const typeId of types){
      engine.selectType(typeId,true);engine.setScore(score);feature.raw.fill(0);feature.bandsSmooth.fill(.8);feature.raw[MFS_LAYOUT.LEVEL]=.8;
      for(let frame=0;frame<330;frame++){
        feature.raw[MFS_LAYOUT.BEAT_FLAG]=frame%30===0?1:0;feature.raw[MFS_LAYOUT.ONSET_FLAGS]=frame%30===0?7:0;
        const start=performance.now();engine.render(frame/60,feature,1/60);engine.endCpuTiming(performance.now()-start);await nextFrame();
      }
      const m=engine.metrics();if(engine.gpu.gl.getError())glErrors++;G4.push({typeId,gpuP95Ms:m.gpuP95Ms,cpuP95Ms:m.cpuP95Ms,samples:m.timingSamples,disjoints:m.timerDisjoints,
        pass:m.width===1920&&m.height===1080&&m.timerAvailable&&m.timerDisjoints===0&&m.timingSamples>=120&&m.gpuP95Ms!==null&&m.gpuP95Ms<=16});
    }
    return {analyzerGlErrors:glErrors,'G-1':{pass:G1.every(r=>r.pass),types:G1},'G-2':{pass:G2.every(r=>r.pass),types:G2},'G-3':{pass:G3.every(r=>r.pass),types:G3},'G-4':{pass:G4.every(r=>r.pass),types:G4}};
  }finally{engine.selectType(originalType,true);engine.setScore(originalScore);engine.setTimeline(originalTimeline,originalFps);engine.types.splice(engine.types.length-retained.length,retained.length);}
}
if(typeof avzTest==='function'){
  avzTest('BW-11-types','タイプ選択・ブラックホールkey2・0.5秒crossfade・逆シークで選択維持',async()=>{
    const iframe=document.createElement('iframe');iframe.src=new URL('../../world.html',location.href).href;
    const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
    try{await ready;const child=iframe.contentWindow,w=child.__world;avzAssert.ok(w?.engine,w?.error);
      const result=child.eval(`(()=>{
        const app=__world.app,e=__world.engine,score=compileWorldScore({bpm:120,durationSec:2,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:2,kind:'main',label:'A'}]},11);
        e.setScore(score);e._step(0,new MfsFrameView(),0);
        const slots=Array.from(app.typeInput.options,o=>({id:o.value,disabled:o.disabled}));
        document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit2',bubbles:true}));const selected=e.type.id,first=e.fadeElapsed;
        e.redrawTransition(.25);const halfway=e.fadeElapsed;
        document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit3',bubbles:true}));const reserved=e.type.id;
        document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit4',bubbles:true}));const galaxy=e.type.id;
        e.redrawTransition(.5);return {slots,selected,first,halfway,reserved,galaxy,end:e.fadeElapsed,glError:e.gpu.gl.getError()};
      })()`);
      avzAssert.equal(result.slots.length,5);avzAssert.equal(result.slots.filter(o=>!o.disabled).length,2);
      avzAssert.equal(result.selected,'g-gargantua');avzAssert.equal(result.first,0);avzAssert.equal(result.halfway,.25);
      avzAssert.equal(result.reserved,'g-gargantua');avzAssert.equal(result.galaxy,'g-gargantua');avzAssert.equal(result.end,.5);avzAssert.equal(result.glError,0);
      await w.engine.renderAt(.2);avzAssert.equal(w.engine.type.id,'g-gargantua');
    }finally{iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
  },{timeoutMs:30000});
}
if(typeof module!=='undefined'&&module.exports){module.exports={world11Correlation,world11Histogram,world11HistogramDistance,world11RegionSamples};}

if(typeof avzTest==='function')avzTest('BW-11-export','選択fluid/gargantuaをUIから音声入りexport・live/renderAt・復号画像で検査',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../../world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  let decoded=null,decoder=null;
  try{
    await ready;const child=iframe.contentWindow,w=child.__world;avzAssert.ok(w?.engine,w?.error);
    for(const name of ['mp4-demuxer','webm-demuxer']){
      const script=child.document.createElement('script');script.src=new URL('../../js/'+name+'.js',location.href).href;
      await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;child.document.body.appendChild(script);});
    }
    await w.app.load(new child.File([encodeWav16(world11SyntheticSong(120,0,3))],'types-export.wav',{type:'audio/wav',lastModified:1}));
    await w.app.setFps(30);let downloads=0;w.app.exporter.download=()=>downloads++;
    for(const typeId of ['g-fluid','g-gargantua']){
      w.app.selectType(typeId);await w.app.renderAt(3);const reference=w.engine.capture();
      w.engine.setScore(w.score);for(const t of [.12,.34,.72,1.5,2.2,3])w.engine.render(t,null,.017);
      const live=w.engine.capture();avzAssert.deepEqual(Array.from(live.rgba),Array.from(reference.rgba),'selected-type fixed-step pixels');
      await w.app.exportSong();const blob=w.app.exporter.blob;avzAssert.ok(blob,w.app.exportStatus.textContent);child.__world11Blob=blob;
      const parsed=await child.eval(`(async()=>{const bytes=new Uint8Array(await __world11Blob.arrayBuffer());return __world11Blob.type==='video/mp4'?Mp4Demuxer.parse(bytes):WebmDemuxer.parse(bytes);})()`);
      avzAssert.equal(parsed.chunks.length,180);let decodeError=null;
      decoder=new child.VideoDecoder({output:frame=>{if(Math.abs(frame.timestamp-3000000)<1000)decoded=frame.clone();frame.close();},error:e=>decodeError=e});
      const config={codec:parsed.codec,codedWidth:parsed.codedWidth,codedHeight:parsed.codedHeight};if(parsed.description)config.description=parsed.description;
      decoder.configure(config);for(const c of parsed.chunks)decoder.decode(new child.EncodedVideoChunk({type:c.keyframe?'key':'delta',timestamp:c.timestampUs,data:c.data}));
      await decoder.flush();if(decodeError)throw decodeError;avzAssert.ok(decoded,'frame90 present');
      const canvas=child.document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d');ctx.drawImage(decoded,0,0);
      const rgba=ctx.getImageData(0,0,1920,1080).data;let sum=0;
      for(let y=0;y<1080;y++)for(let x=0;x<1920;x++)for(let c=0;c<3;c++){
        const d=(rgba[(y*1920+x)*4+c]-reference.rgba[((1079-y)*1920+x)*4+c])/255;sum+=d*d;
      }
      const rmse=Math.sqrt(sum/(1920*1080*3));avzAssert.ok(rmse<=.04,'selected type='+typeId+' decoded RMSE='+rmse);
      const audioContext=new child.OfflineAudioContext(2,1,48000),audio=await audioContext.decodeAudioData(await blob.arrayBuffer());
      let energy=0;for(const sample of audio.getChannelData(0))energy+=sample*sample;const rms=Math.sqrt(energy/audio.length);
      avzAssert.ok(rms>1e-4,'audio present');avzAssert.equal(w.engine.type.id,typeId);
      console.log('BW-11-export '+JSON.stringify({typeId,frames:180,livePixelError:0,rmse,audioRms:rms}));
      decoded.close();decoded=null;decoder.close();decoder=null;
    }
    avzAssert.equal(downloads,2);
  }finally{
    decoded?.close();decoder?.close();const w=iframe.contentWindow.__world;w?.audio?.pause();w?.audioEngine?.ctx?.close();if(w?.app?.url)iframe.contentWindow.URL.revokeObjectURL(w.app.url);w?.engine?.dispose();iframe.remove();
  }
},{timeoutMs:180000,slow:true});
