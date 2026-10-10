// 目的 — WORLD-9の実WebCodecs/MFS/GLSLをfile://の独立ページで検査 — 構想 §2.7
// @page harness
async function world9Page(run) {
  const iframe = document.createElement('iframe'); iframe.style.cssText = 'width:960px;height:600px;border:0';
  const url = new URL('../browser/harness/world.html', location.href);
  const ready = new Promise((resolve, reject) => {
    iframe.onload = resolve; iframe.onerror = () => reject(new Error('world.html load failed'));
  });
  iframe.src = url.href; document.body.appendChild(iframe);
  try {
    await ready; const child = iframe.contentWindow;
    avzAssert.ok(child.__world?.engine, child.__world?.error || 'WORLD initialization');
    // demuxerは製品の描画には不要。テスト時だけ読み込む。
    for (const name of ['mp4-demuxer', 'webm-demuxer']) {
      const script = child.document.createElement('script'); script.src = new URL('../../js/' + name + '.js', location.href).href;
      await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; child.document.body.appendChild(script); });
    }
    return await run(child);
  } finally { const w=iframe.contentWindow.__world; w?.audio?.pause(); w?.audioEngine?.ctx?.close(); if(w?.app?.url)iframe.contentWindow.URL.revokeObjectURL(w.app.url); w?.engine?.dispose(); iframe.remove(); }
}
avzTest('BW-9-export', '6秒30fps・音声・180フレーム・t=3のrenderAt一致', async () => {
  await world9Page(async child => {
    const signal = sigSine(48000, 6, 180, .2);
    const melody = sigSine(48000, 6, 1300, .08);
    for (let c=0;c<2;c++) for(let i=0;i<signal.channels[c].length;i++) {
      signal.channels[c][i] = signal.channels[c][i]*(.6+.4*Math.cos(2*Math.PI*i/24000))+melody.channels[c][i];
    }
    const file = new child.File([encodeWav16(signal)], 'world9-six-seconds.wav', {type:'audio/wav',lastModified:1});
    const w=child.__world; await w.app.load(file); await w.app.setFps(30);
    const score=w.score,prepared=w.app.prepared;
    avzAssert.equal(prepared.frameCount,180);await w.renderAt(3);const reference=w.engine.capture();
    // ライブの不規則なrAF時計で進めても同じGPU状態になること。
    w.engine.setScore(score);for(const t of [.17,.36,.78,1.22,1.63,2.03,2.8,3])w.engine.render(t,null,.017);
    const live=w.engine.capture();avzAssert.deepEqual(Array.from(live.rgba),Array.from(reference.rgba),'live/renderAt exact GPU equality');
    const blob=await w.app.exporter.exportWorld(score,prepared);
    child.__world9Blob=blob;
    const parsed=await child.eval(`(async()=>{const bytes=new Uint8Array(await __world9Blob.arrayBuffer());return __world9Blob.type==='video/mp4'?Mp4Demuxer.parse(bytes):WebmDemuxer.parse(bytes);})()`);
    avzAssert.equal(parsed.chunks.length,180);avzAssert.equal(parsed.codedWidth,1920);avzAssert.equal(parsed.codedHeight,1080);
    let decoded=null,decodeError=null;
    const decoder=new child.VideoDecoder({output: frame=>{if(Math.abs(frame.timestamp-3000000)<1000)decoded=frame.clone();frame.close();},error:e=>{decodeError=e;}});
    try {
      const config={codec:parsed.codec,codedWidth:parsed.codedWidth,codedHeight:parsed.codedHeight};if(parsed.description)config.description=parsed.description;
      decoder.configure(config);
      for(const c of parsed.chunks){decoder.decode(new child.EncodedVideoChunk({type:c.keyframe?'key':'delta',timestamp:c.timestampUs,data:c.data}));}
      await decoder.flush();if(decodeError)throw decodeError;avzAssert.ok(decoded,'decoded frame at 3 seconds');
      const canvas=child.document.createElement('canvas');canvas.width=1920;canvas.height=1080;
      const ctx=canvas.getContext('2d');ctx.drawImage(decoded,0,0);const rgba=ctx.getImageData(0,0,1920,1080).data;
      let squared=0;for(let y=0;y<1080;y++)for(let x=0;x<1920;x++)for(let c=0;c<3;c++){
        const d=(rgba[(y*1920+x)*4+c]-reference.rgba[((1079-y)*1920+x)*4+c])/255;squared+=d*d;
      }
      // 有損失圧縮の許容差: sRGB各channelのRMSE≤.04（約10/255）。閾値を再調整しない。
      const rmse=Math.sqrt(squared/(1920*1080*3));avzAssert.ok(rmse<=.04,'encoded/reference RMSE='+rmse);
      const audioContext=new child.OfflineAudioContext(2,1,48000),audio=await audioContext.decodeAudioData(await blob.arrayBuffer());
      let energy=0;for(const sample of audio.getChannelData(0))energy+=sample*sample;
      const rms=Math.sqrt(energy/audio.length);avzAssert.ok(rms>1e-4,'encoded audio present');avzAssert.close(audio.duration,6,.1);
      console.log('BW-9-export frames=180 frame90=3s dimensions=1920x1080 livePixelError=0 codec='+parsed.codec+' RMSE='+rmse+' audioRMS='+rms+' audioDuration='+audio.duration);
    } finally {decoded?.close();decoder.close();}
    // 実エンコーダーの中止も検査。UIのダウンロードを呼ばない。
    w.app.exporter.onProgress=p=>{if(p>.05)w.app.exporter.cancel();};
    avzAssert.equal(await w.app.exporter.exportWorld(score,prepared),null);avzAssert.equal(w.app.exporter.blob,null);
  });
}, {timeoutMs:180000,slow:true});
avzTest('BW-9-spectrum', '32帯域サイン掃引: 円環の対応する噴出口の輝度が最大', async () => {
  await world9Page(async child => {
    const bank=child.eval('new MfsMelBank(48000,2048)'),rate=48000,segment=.7;
    const signal={sampleRate:rate,channels:[new Float32Array(rate*segment*32),new Float32Array(rate*segment*32)]};
    for(let band=0;band<32;band++){
      const sine=sigSine(rate,segment,bank.centerHz[band],.1);
      for(let c=0;c<2;c++)signal.channels[c].set(sine.channels[c],Math.round(band*segment*rate));
    }
    child.__world9Sweep=new child.File([encodeWav16(signal)],'mel-sweep.wav',{type:'audio/wav',lastModified:1});
    const result=await child.eval(`(async()=>{
      const exporter=new WorldExporter(),prepared=await exporter.prepare(__world9Sweep,30);
      const engine=__world.engine,score=compileWorldScore({bpm:120,durationSec:32*.7,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:32*.7,kind:'main',label:'sweep'}]},11);
      const rows=[];
      for(let band=0;band<32;band++){
        engine.setScore(score);const f=new MfsFrameView().setPacked(prepared.featureFrames[Math.round((band*.7+.5)*30)]);
        // 各測定は履歴をリセット。実MFS出力をそのまま使い、帯域を手で立てない。
        engine._step(0,f,1/30);engine._draw();const capture=engine.capture(),u=engine.gpu.uniforms,lum=[];
        for(let i=0;i<32;i++){
          // 噴出口の位置（流体面）を画面ピクセルへ。q=(p-cam)/zoom（WORLD-38 g-fluid v2）。
          const jet=[0,0];worldFluid2JetPosition(i,jet);const a=engine.type;
          const x=Math.round((((jet[0]-a.cam[0])/a.zoom)/(1920/1080)*.5+.5)*1920),y=Math.round((((jet[1]-a.cam[1])/a.zoom)*.5+.5)*1080);
          let sum=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
            const o=((y+dy)*1920+x+dx)*4;sum+=(.2126*capture.rgba[o]+.7152*capture.rgba[o+1]+.0722*capture.rgba[o+2])/255;
          }lum.push(sum/25);
        }
        const featureWinner=Array.from(f.bandsSmooth).indexOf(Math.max(...f.bandsSmooth)),winner=lum.indexOf(Math.max(...lum));
        rows.push({band,featureWinner,winner,luminance:lum[band],maximum:Math.max(...lum),glError:capture.glError});
      }return rows;
    })()`);
    avzAssert.equal(result.length,32);
    for(const row of result){avzAssert.equal(row.featureWinner,row.band,'MFS center band');avzAssert.equal(row.winner,row.band,'luminance winner '+JSON.stringify(row));avzAssert.equal(row.glError,0);}
    console.log('BW-9-spectrum '+JSON.stringify(result));
  });
}, {timeoutMs:180000,slow:true});
