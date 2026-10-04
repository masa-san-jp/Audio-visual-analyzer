#!/usr/bin/env node
// 目的 — 実GPUの実音rAF画像・直接像G-1・キック増光・GPU p95を保存する — doc/20261004-design-gargantua-v1.md §6・§7.7
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from '../lib/chrome.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'tests/world/output/live');
const options={types:['g-gargantua'],times:[7,20,31,45,62,90],wav:null};
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
  const arg=args[i];if(arg==='--help'){
    console.log('node tests/world/shoot-live.mjs [--types g-gargantua,g-fluid] [--times 7,20,31,45,62,90] [--wav path]\nWORLD_CHROME_WRAPPERに実GPU用起動ラッパーを指定（--disable-gpuを除去）。');process.exit(0);
  }
  if(!['--types','--times','--wav'].includes(arg)||!args[i+1])throw new Error('不正な引数: '+arg);
  const value=args[++i];if(arg==='--types')options.types=value.split(',');else if(arg==='--times')options.times=value.split(',').map(Number);else options.wav=path.resolve(root,value);
}
if(options.types.some(id=>!['g-gargantua','g-fluid'].includes(id)))throw new Error('未実装のタイプ');
if(options.times.some(t=>!Number.isFinite(t)||t<1.5))throw new Error('撮影時刻は有限かつ1.5秒以上');
if(!process.env.WORLD_CHROME_WRAPPER)throw new Error('WORLD_CHROME_WRAPPERに実GPU起動ラッパーを指定してください');
await fs.mkdir(output,{recursive:true});
let chrome;
try {
  chrome=await launchChrome({headed:true,executablePath:process.env.WORLD_CHROME_WRAPPER});
  await chrome.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await chrome.navigate(pathToFileURL(path.join(root,'world.html')).href);
  for(const file of ['tests/shared/song-synth.js','tests/shared/wav.js','tests/browser/world11.test.js','tests/browser/world12.test.js','tests/browser/world13.test.js','tests/browser/world14.test.js'])await chrome.evaluate(await fs.readFile(path.join(root,file),'utf8'));
  const hardware=await chrome.evaluate(`(()=>{const gl=__world.engine?.gpu.gl;if(!gl)throw new Error(__world.error);const ext=gl.getExtension('WEBGL_debug_renderer_info');const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);return {renderer,hardware:!!ext&&!/swiftshader|llvmpipe|software/i.test(renderer)};})()`);
  if(!hardware.hardware)throw new Error('実GPUを確認できません: '+hardware.renderer);
  if(options.wav){
    const bytes=await fs.readFile(options.wav);
    await chrome.evaluate(`__world.app.load(new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0))],${JSON.stringify(path.basename(options.wav))},{type:'audio/wav',lastModified:1}))`,{timeoutMs:900000});
  }else await chrome.evaluate(`__world.app.load(new File([encodeWav16(synthSong(48000,{bpm:128,seed:11}))],'synth-128-11.wav',{type:'audio/wav',lastModified:1}))`,{timeoutMs:900000});
  const rows=[],seams=[];
  for(const typeId of options.types)for(const t of options.times){
    const shot=await chrome.evaluate(`world13Shoot(${JSON.stringify(typeId)},${t})`,{timeoutMs:900000});
    if(typeId==='g-gargantua')seams.push({tSec:t,...await chrome.evaluate('world14Seam(__world.engine)',{timeoutMs:60000})});
    const png=path.join(output,typeId+'-'+t+'.png');await fs.writeFile(png,Buffer.from(shot.png.split(',')[1],'base64'));delete shot.png;
    await fs.writeFile(path.join(output,typeId+'-'+t+'.json'),JSON.stringify(shot,null,2)+'\n');rows.push(shot);
    console.log((shot.g1.applicable?(shot.g1.pass?'PASS ':'FAIL '):'N/A ')+'G-1 '+JSON.stringify({typeId,t,capturedSec:shot.capturedSec,samples:shot.records.length,median:shot.g1.median,mfsFrames:shot.mfsFrames,png}));
  }
  const gargantuaRecords=rows.filter(row=>row.typeId==='g-gargantua').flatMap(row=>row.records);
  const g1=gargantuaRecords.length?await chrome.evaluate('world13CorrelationReport('+JSON.stringify(gargantuaRecords)+')'):null;
  if(g1)console.log((g1.pass?'PASS ':'FAIL ')+'G-1-all '+JSON.stringify(g1));
  const kick=options.types.includes('g-gargantua')?await chrome.evaluate('world14Kick(__world.engine)',{timeoutMs:60000}):null;
  const gpu=options.types.includes('g-gargantua')?await chrome.evaluate('world13Performance(__world.engine)',{timeoutMs:60000}):null;
  if(kick)console.log((kick.pass?'PASS ':'FAIL ')+'G-kick '+JSON.stringify(kick));
  if(gpu)console.log((gpu.pass?'PASS ':'FAIL ')+'G-gpu '+JSON.stringify(gpu));
  const v11=options.types.includes('g-gargantua')?await chrome.evaluate('world14AcceptanceReport('+JSON.stringify(rows)+','+JSON.stringify(seams)+','+JSON.stringify(kick)+','+JSON.stringify(gpu)+')'):null;
  if(v11)console.log((v11.pass?'PASS ':'FAIL ')+'G-v1.1 '+JSON.stringify(v11));
  const summary={v11,environment:hardware,shots:rows.map(({records,...row})=>row),g1,kick,gpu,consoleErrors:chrome.errors};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(summary,null,2)+'\n');
  if((v11&&!v11.pass)||(g1&&!g1.pass)||(kick&&!kick.pass)||(gpu&&!gpu.pass)||chrome.errors.length||rows.some(r=>!r.mfsFrames||(r.g1.applicable&&!r.g1.pass)))process.exitCode=1;
}finally {if(chrome)await chrome.close();}
