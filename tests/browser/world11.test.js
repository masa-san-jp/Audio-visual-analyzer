// 目的 — 現行タイプの選択・書き出し検査と、その合成曲生成ヘルパー
// @page harness
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
if(typeof avzTest==='function'){
  avzGpuTest('BW-11-types','タイプ選択（キー1〜3）・0.5秒crossfade・逆シークで選択維持',async()=>{
    const iframe=document.createElement('iframe');iframe.src=new URL('../browser/harness/world.html',location.href).href;
    const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
    try{await ready;const child=iframe.contentWindow,w=child.__world;avzAssert.ok(w?.engine,w?.error);
      const result=child.eval(`(()=>{
        const app=__world.app,e=__world.engine,score=compileWorldScore({bpm:120,durationSec:2,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:2,kind:'main',label:'A'}]},11);
        e.setScore(score);e._step(0,new MfsFrameView(),0);
        const slots=Array.from(app.typeInput.options,o=>({id:o.value,disabled:o.disabled}));
        document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit2',bubbles:true}));const selected=e.type.id,first=e.fadeElapsed;
        e.redrawTransition(.25);const halfway=e.fadeElapsed;
        document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit3',bubbles:true}));const third=e.type.id;
        document.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit4',bubbles:true}));const fourth=e.type.id;
        e.redrawTransition(.5);return {typeCount:WORLD_ANALYZER_TYPES.length,availableCount:WORLD_ANALYZER_TYPES.filter(t=>t.available).length,slots,selected,first,halfway,third,fourth,end:e.fadeElapsed,glError:e.gpu.gl.getError()};
      })()`);
      avzAssert.equal(result.slots.length,result.typeCount);avzAssert.equal(result.slots.filter(o=>!o.disabled).length,result.availableCount);
      avzAssert.equal(result.selected,'g-tesseract');avzAssert.equal(result.first,0);avzAssert.equal(result.halfway,.25);
      avzAssert.equal(result.third,'g-quantum');avzAssert.equal(result.fourth,'g-quantum','割当のないキー4は無視');avzAssert.equal(result.end,.5);avzAssert.equal(result.glError,0);
      await w.engine.renderAt(.2);avzAssert.equal(w.engine.type.id,'g-quantum');
    }finally{iframe.contentWindow.__world?.engine?.dispose();iframe.remove();}
  },{timeoutMs:30000});
}

if(typeof avzGpuTest==='function')avzGpuTest('BW-11-export','選択tesseract/gargantuaをUIから音声入りexport・live/renderAt・復号画像で検査',async()=>{
  const iframe=document.createElement('iframe');iframe.src=new URL('../browser/harness/world.html',location.href).href;
  const ready=new Promise(resolve=>iframe.onload=resolve);document.body.appendChild(iframe);
  let decoded=null,decoder=null;
  try{
    await ready;const child=iframe.contentWindow,w=child.__world;avzAssert.ok(w?.engine,w?.error);
    for(const name of ['mp4-demuxer','webm-demuxer']){
      const script=child.document.createElement('script');script.src=new URL('../../js/'+name+'.js',location.href).href;
      await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;child.document.body.appendChild(script);});
    }
    // 最短曲長（SONG_CONST.MIN_DURATION_SEC）+2秒の曲。全曲を書き出すと660枚になるため、下で先頭6秒に制限する。
    await w.app.load(new child.File([encodeWav16(world11SyntheticSong(120,0,3,SONG_CONST.MIN_DURATION_SEC+2))],'types-export.wav',{type:'audio/wav',lastModified:1}));
    await w.app.setFps(30);let downloads=0;if(typeof w.app.exporter.save!=="function")throw new Error("exporter.save missing");w.app.exporter.save=()=>downloads++;
    // 他の書き出しテストと同じく、frameCountと音声バッファを6秒に揃えて先頭6秒の窓に制限する（180枚）。
    const full=w.app.prepared,{sampleRate,numberOfChannels}=full.audioBuffer,windowSamples=6*sampleRate,windowed=new child.AudioBuffer({length:windowSamples,numberOfChannels,sampleRate});
    for(let c=0;c<numberOfChannels;c++)windowed.copyToChannel(full.audioBuffer.getChannelData(c).subarray(0,windowSamples),c);
    w.app.prepared={...full,audioBuffer:windowed,frameCount:6*full.fps};
    for(const typeId of ['g-tesseract','g-gargantua']){
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
      const rmse=Math.sqrt(sum/(1920*1080*3));const maxRmse=typeId==='g-tesseract'?.07:.04;avzAssert.ok(rmse<=maxRmse,'selected type='+typeId+' decoded RMSE='+rmse);
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
