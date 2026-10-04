// 目的 — WORLD-10の焦点面と独立深度を実GLSLで検証し、v8比較用時刻を記録する — 構想 §2.7・WORLD-10
// @page harness
async function world10Page(run) {
  const iframe=document.createElement('iframe');iframe.style.cssText='width:960px;height:600px;border:0';
  const url=new URL('../../world.html',location.href);
  const ready=new Promise((resolve,reject)=>{iframe.onload=resolve;iframe.onerror=()=>reject(new Error('world.html load failed'));});
  iframe.src=url.href;document.body.appendChild(iframe);
  try{await ready;const child=iframe.contentWindow;avzAssert.ok(child.__world?.engine,child.__world?.error||'WORLD initialization');return await run(child);}
  finally{const w=iframe.contentWindow.__world;w?.audio?.pause();w?.audioEngine?.ctx?.close();w?.engine?.dispose();iframe.remove();}
}

avzTest('BW-10-focus-depth','実vertex: 流体面の鋭さ・独立星塵の透視前進／視差／近景ぼけ',async()=>{
  await world10Page(async child=>{
    const result=child.eval(`(()=>{
      const engine=__world.engine,g=engine.gpu,gl=g.gl,u=g.uniforms;
      const score=compileWorldScore({bpm:120,durationSec:120,beats:[],downbeatIndices:[],sections:[{startSec:0,endSec:120,kind:'drop',label:'A'}]},11);
      engine.setScore(score);engine._step(45,null,0);u[80]=0;u[81]=0;u[82]=1;u[83]=0;u[40]=0;u[41]=0;g.upload();
      // 製品vertexそのものを使う。計算を複製せず、最終座標・深度・サイズだけTFへ露出する。
      function probe(source,lastSize,count,first=0){
        source=source.replace('void main(){','out vec4 world10Probe;\\nvoid main(){');
        const position='gl_Position=vec4(uv*2.-1.,0,1);';
        if(!source.includes(position))throw new Error('vertex probe insertion point missing');
        source=source.replace(position,position+'world10Probe=vec4(gl_Position.xy,depth,'+lastSize+');');
        const shaders=[],program=gl.createProgram(),buffer=gl.createBuffer(),tf=gl.createTransformFeedback();
        try{
          for(const [type,code] of [[gl.VERTEX_SHADER,source],[gl.FRAGMENT_SHADER,'#version 300 es\\nprecision highp float;out vec4 frag;void main(){frag=vec4(0);}']]){
            const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,code);gl.compileShader(shader);
            if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));gl.attachShader(program,shader);
          }
          gl.transformFeedbackVaryings(program,['world10Probe'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);
          if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
          gl.uniformBlockBinding(program,gl.getUniformBlockIndex(program,'World'),0);gl.useProgram(program);
          for(const [name,unit,target] of [['particles',0,engine.particles.state.read],['particleVelocity',1,engine.particles.velocity.read]])g.sampler(gl.getUniformLocation(program,name),unit,target);
          gl.uniform1f(gl.getUniformLocation(program,'particleSeed'),score.seed);
          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,tf);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,buffer);
          gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,count*16,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,buffer);
          gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,first,count);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);
          const values=new Float32Array(count*4);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,values);return values;
        }finally{gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.deleteTransformFeedback(tf);gl.deleteBuffer(buffer);gl.deleteProgram(program);for(const shader of shaders)gl.deleteShader(shader);}
      }
      const point=new Float32Array(4);point[3]=11;
      function focused(depth){point[0]=.2*depth/3;point[1]=.1*depth/3;point[2]=depth;gl.bindTexture(gl.TEXTURE_2D,engine.particles.state.read.texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1,1,gl.RGBA,gl.FLOAT,point);return probe(WORLD_PARTICLE_VERTEX,'size',1);}
      const a=focused(1.5),b=focused(8.5);const focusedPositionError=Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1])),focusedSizeError=Math.abs(a[3]-b[3]);
      u[0]=0;g.upload();const start=probe(WORLD_DEPTH_VERTEX,'radius',4108*6);
      u[0]=Math.PI/120;g.upload();const next=probe(WORLD_DEPTH_VERTEX,'radius',4108*6);
      let forward=0,total=0,nearRadius=0,farRadius=0,min=Infinity,max=0,projectionError=0;
      for(let i=0;i<4108;i++){
        const o=i*24,z=start[o+2],nz=next[o+2];min=Math.min(min,z);max=Math.max(max,z);
        if(i>=4096)nearRadius=Math.max(nearRadius,start[o+3]);else if(z>12)farRadius=Math.max(farRadius,start[o+3]);
        if(i<4096&&z>2&&nz<z){forward++;total+=z-nz;projectionError=Math.max(projectionError,Math.abs(start[o+3]*z-next[o+3]*nz));}
      }
      u[40]=.1;g.upload();const moved=probe(WORLD_DEPTH_VERTEX,'radius',4108*6);let nearParallax=0,farParallax=0;
      for(let i=0;i<4096;i++){const o=i*24,z=next[o+2],d=Math.abs(moved[o]-next[o]);if(z<3)nearParallax=Math.max(nearParallax,d);if(z>20)farParallax=Math.max(farParallax,d);}
      return {focusedPositionError,focusedSizeError,focusedSize:a[3],forward,meanForward:total/forward,min,max,nearRadius,farRadius,projectionError,nearParallax,farParallax,glError:gl.getError()};
    })()`);
    avzAssert.ok(result.focusedPositionError<1e-6);avzAssert.equal(result.focusedSizeError,0);avzAssert.ok(result.focusedSize<=8);
    avzAssert.ok(result.forward>3000);avzAssert.ok(result.meanForward>0);avzAssert.ok(result.min>=1&&result.max<=33);
    avzAssert.ok(result.nearRadius>result.farRadius*10);avzAssert.ok(result.projectionError<1e-4);
    avzAssert.ok(result.nearParallax>result.farParallax*4);avzAssert.equal(result.glError,0);
    console.log('BW-10-focus-depth '+JSON.stringify(result));
  });
},{timeoutMs:180000,slow:true});

avzTest('BW-10-v8-times','intro7／drop45／break62／drop90: 細部3帯とv8比較用計測',async()=>{
  await world10Page(async child=>{
    const engine=child.__world.engine,score=child.eval('compileWorldScore')({bpm:128,durationSec:120,beats:Array.from({length:256},(_,i)=>i*60/128),downbeatIndices:Array.from({length:64},(_,i)=>i*4),sections:[{startSec:0,endSec:15,kind:'intro',label:'A'},{startSec:15,endSec:30,kind:'build',label:'B'},{startSec:30,endSec:60,kind:'drop',label:'C'},{startSec:60,endSec:75,kind:'break',label:'D'},{startSec:75,endSec:105,kind:'drop',label:'C'},{startSec:105,endSec:120,kind:'outro',label:'A'}]},11);
    engine.setScore(score);const rows=[];
    for(const t of [7,45,62,90]){
      await engine.renderAt(t);const capture=engine.capture(),bands=worldBandEnergy(capture.rgba,capture.width,capture.height);
      rows.push({t,mean:capture.mean,hdrRatio:capture.hdrRatio,clipped:capture.clippedFraction,bands:bands.fractions,glError:capture.glError});
      if(t===62){
        // breakの全画面履歴を白く汚しても、現在の像／bloom／露出へ矩形残像が戻らない。
        engine.post.reset();engine.post.stepFeedback(engine.scene,engine.fluid);engine._draw();const clean=engine.capture();
        const gl=engine.gpu.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,engine.post.feedback.read.fbo);gl.clearColor(32,32,32,1);gl.clear(gl.COLOR_BUFFER_BIT);
        engine.post.stepFeedback(engine.scene,engine.fluid);engine._draw();const dirty=engine.capture();let historyPixelError=0;
        for(let i=0;i<clean.rgba.length;i++)historyPixelError=Math.max(historyPixelError,Math.abs(clean.rgba[i]-dirty.rgba[i]));
        avzAssert.ok(historyPixelError<=1,'break history border contamination '+historyPixelError);avzAssert.equal(dirty.glError,0);
        rows.at(-1).historyPixelError=historyPixelError;
      }
      avzAssert.equal(capture.glError,0);avzAssert.ok(Object.values(bands.fractions).every(v=>v>=.1),'W-2 at '+t+': '+JSON.stringify(bands.fractions));
    }
    console.log('BW-10-v8-times '+JSON.stringify(rows));
    // 数値は画質の代用ではない。v8の添付像と、櫛／波紋／矩形境界／主流体のぼけを別途目視する。
  });
},{timeoutMs:300000,slow:true});
