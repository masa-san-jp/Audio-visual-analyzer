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
avzGpuTest('BW-9-export', '6秒30fps・音声・180フレーム・t=3のrenderAt一致', async () => {
  await world9Page(async child => {
    // SongMapの最短曲長+2秒の曲を読み込み、下で先頭6秒の窓に制限する（6秒単体は最短曲長未満でSongMapErrorになる）。
    const loadSec = SONG_CONST.MIN_DURATION_SEC + 2;
    const signal = sigSine(48000, loadSec, 180, .2);
    const melody = sigSine(48000, loadSec, 1300, .08);
    for (let c=0;c<2;c++) for(let i=0;i<signal.channels[c].length;i++) {
      signal.channels[c][i] = signal.channels[c][i]*(.6+.4*Math.cos(2*Math.PI*i/24000))+melody.channels[c][i];
    }
    const file = new child.File([encodeWav16(signal)], 'world9-export.wav', {type:'audio/wav',lastModified:1});
    const w=child.__world; await w.app.load(file); await w.app.setFps(30);
    // frameCountと音声バッファを6秒に揃え、先頭6秒（180枚）だけを書き出す。描画タイプは既定のg-gargantua。
    const full=w.app.prepared,{sampleRate,numberOfChannels}=full.audioBuffer,windowSamples=6*sampleRate;
    const windowed=new child.AudioBuffer({length:windowSamples,numberOfChannels,sampleRate});
    for(let c=0;c<numberOfChannels;c++)windowed.copyToChannel(full.audioBuffer.getChannelData(c).subarray(0,windowSamples),c);
    w.app.prepared={...full,audioBuffer:windowed,frameCount:6*full.fps};
    avzAssert.equal(w.engine.type.id,'g-gargantua');
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
