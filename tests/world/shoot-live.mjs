#!/usr/bin/env node
// 目的 — 実GPUラッパーで実音を再生し、指定時刻の最初のrAF画像とG-1中央値を保存する — doc/20261004-design-gpu-analyzers-v1.md §5
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from '../lib/chrome.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'tests/world/output/live');
const options={types:['g-rings','g-galaxy','g-fluid'],times:[20,31,45,90],wav:null};
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
  const arg=args[i];if(arg==='--help'){
    console.log('node tests/world/shoot-live.mjs [--types g-rings,g-galaxy,g-fluid] [--times 20,31,45,90] [--wav path]\nWORLD_CHROME_WRAPPERに実GPU用起動ラッパーを指定（--disable-gpuを除去）。');process.exit(0);
  }
  if(!['--types','--times','--wav'].includes(arg)||!args[i+1])throw new Error('不正な引数: '+arg);
  const value=args[++i];if(arg==='--types')options.types=value.split(',');else if(arg==='--times')options.times=value.split(',').map(Number);else options.wav=path.resolve(root,value);
}
if(options.types.some(id=>!['g-rings','g-galaxy','g-fluid'].includes(id)))throw new Error('未実装のタイプ');
if(options.times.some(t=>!Number.isFinite(t)||t<1.5))throw new Error('撮影時刻は有限かつ1.5秒以上');
if(!process.env.WORLD_CHROME_WRAPPER)throw new Error('WORLD_CHROME_WRAPPERに実GPU起動ラッパーを指定してください');
await fs.mkdir(output,{recursive:true});
let chrome;
try {
  chrome=await launchChrome({headed:true,executablePath:process.env.WORLD_CHROME_WRAPPER});
  await chrome.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await chrome.navigate(pathToFileURL(path.join(root,'world.html')).href);
  for(const file of ['tests/shared/song-synth.js','tests/shared/wav.js','tests/browser/world11.test.js','tests/browser/world12.test.js'])await chrome.evaluate(await fs.readFile(path.join(root,file),'utf8'));
  const hardware=await chrome.evaluate(`(()=>{const gl=__world.engine?.gpu.gl;if(!gl)throw new Error(__world.error);const ext=gl.getExtension('WEBGL_debug_renderer_info');const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);return {renderer,hardware:!!ext&&!/swiftshader|llvmpipe|software/i.test(renderer)};})()`);
  if(!hardware.hardware)throw new Error('実GPUを確認できません: '+hardware.renderer);
  if(options.wav){
    const bytes=await fs.readFile(options.wav);
    await chrome.evaluate(`__world.app.load(new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0))],${JSON.stringify(path.basename(options.wav))},{type:'audio/wav',lastModified:1}))`,{timeoutMs:900000});
  }else await chrome.evaluate(`__world.app.load(new File([encodeWav16(synthSong(48000,{bpm:128,seed:11}))],'synth-128-11.wav',{type:'audio/wav',lastModified:1}))`,{timeoutMs:900000});
  const rows=[];
  for(const typeId of options.types)for(const t of options.times){
    const shot=await chrome.evaluate(`world12Shoot(${JSON.stringify(typeId)},${t})`,{timeoutMs:60000});
    const png=path.join(output,typeId+'-'+t+'.png');await fs.writeFile(png,Buffer.from(shot.png.split(',')[1],'base64'));delete shot.png;
    await fs.writeFile(path.join(output,typeId+'-'+t+'.json'),JSON.stringify(shot,null,2)+'\n');rows.push(shot);
    console.log((shot.g1.applicable?(shot.g1.pass?'PASS ':'FAIL '):'N/A ')+'G-1 '+JSON.stringify({typeId,t,capturedSec:shot.capturedSec,samples:shot.records.length,median:shot.g1.median,mfsFrames:shot.mfsFrames,png}));
  }
  const summary={environment:hardware,shots:rows.map(({records,...row})=>row),consoleErrors:chrome.errors};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(summary,null,2)+'\n');
  if(chrome.errors.length||rows.some(r=>!r.mfsFrames||(r.g1.applicable&&!r.g1.pass)))process.exitCode=1;
}finally {if(chrome)await chrome.close();}
