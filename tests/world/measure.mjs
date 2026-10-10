#!/usr/bin/env node
// 目的 — ヘッド付きmacOS Chromeでテスト専用の tests/browser/harness/world.htmlを実再生しW/BWとG-1〜G-4を報告する — SSOT §1.3・§2.8
// 実行: node tests/world/measure.mjs（CHROME_PATHも使用可）。Chromeを起動できるレビュアー専用。
// 計測上の判断（閾値はSSOTのまま）:
// W-1: セクション中央のHDR全画素のmin/max。ゼロ除算だけ1e-6で保護し、生min/maxも記録。
// W-2: SSOTどおりsRGBのYを4×4平均（線形化しない）。Gaussianは半径ceil(3σ)、
//      正規化された分離畳み込み、端画素を重複する対称折り返し。window.__world.renderAt(中央時刻)で0から固定dt=1/60、共有offline MFS。
// W-4: AudioEngine.getFeatures()でフラグを読んだフレームと、実際のUBO読出しを比較。
// W-5: renderAtで初期化し、advancePreviewによる固定60Hzの直前1拍／直後.25秒の各フレームのsRGB平均輝度を時間窓ごとに算術平均。
//      完全黒→非ゼロはInfinityとして記録し、窓内フレーム0枚は失敗。
// WORLD-7: §2.6に従い旧環境の検査を抽象状態・粒子・軌跡へ移行。
//      被覆は合成前後HDR輝度差>1e-4（暗部丸めを除外）の画素率、ブルーム／履歴の広がりを含めない。
//      各section中央＋参照7時刻（112秒outroを含む）を等重みで平均し5〜25%。最大被覆上限は撤回。
//      同じ測定で生の粒子輝度積分寄与を報告。建築の優勢率／sparks≤8%は新方針で撤回。
//      BW-4-shellは粒子位置固定で殻の経過のみを変更し0.4秒以降HDR差0を検査。
//      BW-4-introは光の霧／粒子の進行による増光。BW-5-lightは直接kickのHDR増光。
//      BW-3-coverage/BW-4-sparks/BW-4-accentを撤回。白飛び≤2%・三色役割交換は保持。
//      BW-7: 3×3占有（Y>.005の画素が各tileの1%以上、6tile以上）、再登場の画素差、
//      実2Dカメラの恒等変換との差、camera固定・kick無し0.15秒の物質移動を検査。
//      動きは平均粒子速度≥.1世界単位/秒、RGB差合計>3の画素≥1%。intro平均Y=.02〜.05。
//      BW-7-performanceはW-8を保持したまま1080pのGPU p95≤14msを追加。
//      BW-6-uiは常設UI・start()非全画面・前後シーク・ボタン/Fのページ全体fullscreen要求を検査。
//      実全画面の出入り、全画面中の操作UI、構図・第二drop・粒子の主役感は目視も必要。
// W-6: 曲頭を含む全セクション開始。曲末は別のendイベント。
// W-8: ウォームアップ2秒後、GPU timer query全パス＋CPU送信の大きい方のp95。
//      GPU完了を非同期で観測。読み戻し／Gaussian／debug整形をGPU区間に含めない。
//      両値・rAF間隔・標本数・disjoint数も報告。query未対応／120標本未満は合格にしない。
//      解像度を下げたり、粒子を減らしたり、基準値を調整しない。
// tests/lib/chrome.mjsは--disable-gpuを固定付与するため、起動専用の一時adapterでこの1引数だけ除く。
// 同じlaunchChrome / navigate / evaluate / errors / closeを使用し、headed:true、実GPUを確認する。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome, launchChrome } from '../lib/chrome.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'tests/world/output');
await fs.mkdir(output, { recursive: true });
// 外部wrapperがあるときはChrome探索も内部adapter生成も不要。
// wrapperはheaded/実GPU起動に加え、autoplay-policyを含む引数を引き継ぐこと。
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
let chrome, adapterDir, visual;
try {
  let executable = process.env.WORLD_CHROME_WRAPPER;
  if (!executable) {
    const actualChrome = findChrome();
    if (!actualChrome) throw new Error('Chromeが見つかりません。CHROME_PATHまたはWORLD_CHROME_WRAPPERを指定してください。');
    adapterDir = await fs.mkdtemp(path.join(output, '.chrome-'));
    executable = path.join(adapterDir, 'launch');
    const launcher = path.join(adapterDir, 'launcher.mjs');
    await fs.writeFile(launcher, `import {spawn} from 'node:child_process';
const child=spawn(${JSON.stringify(actualChrome)},process.argv.slice(2).filter(a=>a!=='--disable-gpu'),{stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>child.kill(signal));
child.on('error',e=>{process.stderr.write(e.message);process.exit(2)});
child.on('close',code=>process.exit(code ?? 0));\n`);
    await fs.writeFile(executable, '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(launcher) + ' "$@"\n', { mode: 0o755 });
  }
  chrome = await launchChrome({ headed: true, executablePath: executable });
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await chrome.navigate(pathToFileURL(path.join(root, 'tests/browser/harness/world.html')).href + '?debug=1');
  for (const file of ['tests/shared/song-synth.js', 'tests/shared/wav.js', 'tests/browser/world.test.js', 'tests/browser/world11.test.js']) {
    const source = await fs.readFile(path.join(root, file), 'utf8');
    await chrome.evaluate(source + '\n//# sourceURL=' + pathToFileURL(path.join(root, file)).href);
  }
  const hardware = await chrome.evaluate(`(() => {
    const gl=window.__world?.engine?.gpu.gl; if(!gl) return {renderer:null,hardware:false,error:window.__world?.error};
    const ext=gl.getExtension('WEBGL_debug_renderer_info');
    const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    return {renderer,hardware:!!ext&&!/swiftshader|llvmpipe|software/i.test(renderer),userAgent:navigator.userAgent};
  })()`);
  console.log('WORLD-11 measurement: headed Chrome, file://, 1920×1080, ' + hardware.renderer);
  // 静止画とライブを別CDP呼び出しにし、再生失敗でもvisualの結果とPNGを残す。
  await chrome.evaluate('worldLoadMeasurement()', { timeoutMs: 900000 });
  visual = await chrome.evaluate('(async () => { window.__worldVisualResult = await runWorldVisualMeasurement(); return window.__worldVisualResult; })()', { timeoutMs: 900000 });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ...visual, environment: hardware, livePending: true }, null, 2) + '\n');
  for (let i = 0; i < visual['W-2'].sections.length; i++) {
    const png = await chrome.evaluate('worldScreenshot(' + i + ')');
    if (png) await fs.writeFile(path.join(output, 'section-' + i + '.png'), Buffer.from(png.split(',')[1], 'base64'));
  }
  for (let i = 0; i < visual.references.length; i++) {
    const png = await chrome.evaluate('worldScreenshot(' + i + ', true)');
    if (png) await fs.writeFile(path.join(output, 't-' + visual.references[i].tSec.toFixed(3) + '.png'), Buffer.from(png.split(',')[1], 'base64'));
  }
  const result = await chrome.evaluate('runWorldMeasurement(window.__worldVisualResult)', { timeoutMs: 900000 });
  const analyzer = await chrome.evaluate('runWorldAnalyzerMeasurement()', { timeoutMs: 900000 });
  Object.assign(result, analyzer);
  // §2.8: W/BWはg-fluidの回帰として保持。旧SDF併描／全タイプ26万粒という解釈のみ撤回。
  result.applicability = { legacy: 'W/BWはg-fluidへ適用（閾値維持）', obsolete: ['W-3のSDF併描: §2.6で撤回', 'W-3/BW-6-coverageを全タイプへ強制: §2.8で独立形態へ置換'], replacement: '新形態はG-1〜G-4。W-3はWORLD-38でg-fluid v2の格子・塵・HDRの検査へ置換（BW-3-hero/BW-6-coverageは撤去）' };
  result.environment = hardware; result.consoleErrors = chrome.errors;
  if (!hardware.hardware) {
    result['G-4'].pass = false; result['G-4'].reason = '実GPUを確認できません';
    for (const type of result['G-4'].types) { type.pass = false; type.reason = result['G-4'].reason; }
    result['W-8'].pass = false; result['W-8'].reason = '実GPUを確認できません';
    result['BW-7-performance'].pass = false; result['BW-7-performance'].reason = '実GPUを確認できません';
  }
  result.runtimePass = !(result.glError || result.analyzerGlErrors || result.consoleErrors.length || result.debugErrors);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(result, null, 2) + '\n');
  for (const id of ['BW-2-exposure', 'BW-2-preview', 'BW-2-environments', 'BW-2-matter', 'BW-3-kick', 'BW-4-shell', 'BW-4-intro', 'BW-5-light', 'BW-5-palette', 'BW-6-ui', 'BW-6-layers', 'BW-7-composition', 'BW-7-camera', 'BW-7-motion', 'BW-7-intro', 'BW-7-performance', 'BW-8-edges']) console.log((result[id].pass ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(result[id]));
  for (let i = 1; i <= 8; i++) console.log((result['W-' + i].pass ? 'PASS ' : 'FAIL ') + 'W-' + i + ' ' + JSON.stringify(result['W-' + i]));
  for (const id of ['G-1','G-2','G-3','G-4']) console.log((result[id].pass ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(result[id]));
  console.log('Report/images: ' + output);
  if (!result.runtimePass || ['G-1','G-2','G-3','G-4'].some(id => !result[id].pass) || ['BW-2-exposure', 'BW-2-preview', 'BW-2-environments', 'BW-2-matter', 'BW-3-kick', 'BW-4-shell', 'BW-4-intro', 'BW-5-light', 'BW-5-palette', 'BW-6-ui', 'BW-6-layers', 'BW-7-composition', 'BW-7-camera', 'BW-7-motion', 'BW-7-intro', 'BW-7-performance', 'BW-8-edges'].some(id => !result[id].pass) || Array.from({ length: 8 }, (_, i) => result['W-' + (i + 1)].pass).some(v => !v)) process.exitCode = 1;
} catch (error) {
  const state = chrome ? await chrome.evaluate('({ error: window.__world?.error, state: window.__world?.app?.state, tSec: window.__world?.engine?.latestSec, previewSteps: window.__world?.engine?.previewStep, audioTime: window.__world?.audio?.currentTime, audioPaused: window.__world?.audio?.paused, audioReadyState: window.__world?.audio?.readyState, audioContextState: window.__world?.audioEngine?.ctx?.state, mfsStatus: window.__world?.audioEngine?.mfsStatus })').catch(() => null) : null;
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ...visual, runtimePass: false, setupError: error.message, state, consoleErrors: chrome ? chrome.errors : [] }, null, 2) + '\n');
  throw error;
} finally {
  if (chrome) await chrome.close();
  if (adapterDir) await fs.rm(adapterDir, { recursive: true, force: true });
}
