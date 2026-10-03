#!/usr/bin/env node
// 目的 — Node 単体テストとブラウザテストを統一実行する（計画書 §3.1・§3.4）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { BrowserEnvironmentError, findChrome, launchChrome } from './lib/chrome.mjs';
import { listSharedScripts, writeHarness } from './lib/harness-builder.mjs';
import { encodeRgbaPng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'tests/output');
const GOLDEN_PATH = path.join(ROOT, 'tests/golden/frames.json');
const args = process.argv.slice(2);
const options = {
  unit: false, browser: false, headed: false, skipSlow: false, updateGolden: false, serial: false, filter: null,
};
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--unit') options.unit = true;
  else if (arg === '--browser') options.browser = true;
  else if (arg === '--headed') options.headed = true;
  else if (arg === '--skip-slow') options.skipSlow = true;
  else if (arg === '--update-golden') options.updateGolden = true;
  else if (arg === '--serial') options.serial = true;
  else if (arg === '--filter') options.filter = args[++i];
  else if (arg === '--help') {
    console.log('使い方: node tests/run.mjs [--unit] [--browser] [--update-golden] [--filter <正規表現>] [--headed] [--skip-slow] [--serial]');
    process.exit(0);
  } else {
    console.error(`不明なオプション: ${arg}`);
    process.exit(2);
  }
}
if (!options.unit && !options.browser) options.unit = options.browser = true;
let filter;
try {
  filter = options.filter ? new RegExp(options.filter) : null;
} catch (error) {
  console.error(`--filter の正規表現が不正です: ${error.message}`);
  process.exit(2);
}

const results = [];
const started = Date.now();
// 単体テストとブラウザテストを並行実行するため、出力順（単体 → ブラウザ）を保つよう
// ブラウザ側の記録は一度バッファし、両フェーズの完了後にまとめて出力する（T15-11）。
let browserSink = null;
function recordBrowser(...entry) {
  if (browserSink) browserSink.push(entry);
  else record(...entry);
}
function record(id, name, status, ms, error = null) {
  results.push({ id, name, status, ms, error });
  const mark = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
  console.log(`${mark} ${id} ${name} (${ms}ms)${error ? `: ${error}` : ''}`);
}

async function runUnitTests() {
  const dir = path.join(ROOT, 'tests/unit');
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.test.mjs')).sort()
    .map((name) => path.relative(ROOT, path.join(dir, name)));
  if (!files.length) return;

  const nodeArgs = ['--test', '--test-reporter=tap'];
  if (filter) nodeArgs.push(`--test-name-pattern=${options.filter}`);
  nodeArgs.push(...files);
  const env = { ...process.env };
  if (options.filter && /U15-00.*(?:異常系|fail)/i.test(options.filter)) {
    env.AVZ_RUNNER_INCLUDE_EXPECTED_FAILURE = '1';
  }
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, { cwd: ROOT, env });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({
      status, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8')
    }));
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const starts = [...output.matchAll(/^(ok|not ok) (\d+) - (.*)$/gm)];
  for (let index = 0; index < starts.length; index += 1) {
    const item = starts[index];
    const next = starts[index + 1]?.index ?? output.length;
    const block = output.slice(item.index, next);
    const skipped = / # SKIP(?: |$)/.test(item[3]);
    const name = item[3].replace(/ # SKIP.*$/, '');
    const status = skipped ? 'skip' : item[1] === 'ok' ? 'pass' : 'fail';
    const error = status === 'fail'
      ? (block.match(/^  error: \|\n((?:^(?:    |      ).*\n?)+)/m)?.[1] || 'node:test failed')
      : null;
    record(name.split(' ')[0], name, status, 0, error);
  }
  if (result.status === 2) process.exitCode = 2;
}

async function discoverBrowserTests() {
  const dir = path.join(ROOT, 'tests/browser');
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith('.test.js')).sort();
  const files = [];
  for (const name of names) {
    const filePath = path.join(dir, name);
    const source = await fs.readFile(filePath, 'utf8');
    const directive = source.match(/^\s*\/\/\s*@page\s+(\S+)/m);
    const page = directive?.[1] || 'harness';
    if (page !== 'harness' && page !== 'app') {
      throw new Error(`${name}: @page は harness または app を指定してください。`);
    }
    // app ページ用の任意宣言: `// @query debug=1` で index.html?debug=1 を開く（未指定は従来どおり）
    const query = source.match(/^\s*\/\/\s*@query\s+(\S+)/m)?.[1] || '';
    files.push({ filePath, source, page, query });
  }
  return files;
}

async function injectScript(chrome, filePath, source = null) {
  const script = source ?? await fs.readFile(filePath, 'utf8');
  await chrome.evaluate(`${script}\n//# sourceURL=${pathToFileURL(filePath).href}`);
}

async function saveArtifacts(result) {
  for (const artifact of result.artifacts || []) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(artifact.dataUrl || '');
    if (!match) continue;
    const extension = (match[1] || 'application/octet-stream').split('/').pop();
    const safeName = String(artifact.name || 'artifact').replace(/[^a-zA-Z0-9._-]+/g, '-');
    const bytes = match[2]
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]));
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(path.join(OUTPUT_DIR, `${result.id}-${safeName}.${extension}`), bytes);
  }
}

async function readGoldenFrames() {
  try {
    return JSON.parse(await fs.readFile(GOLDEN_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function thumbnailRgbToRgba(rgb, width, height) {
  const blockSize = 10;
  const rgba = new Uint8Array(width * blockSize * height * blockSize * 4);
  for (let blockY = 0; blockY < height; blockY += 1) {
    for (let blockX = 0; blockX < width; blockX += 1) {
      const source = (blockY * width + blockX) * 3;
      for (let y = 0; y < blockSize; y += 1) {
        for (let x = 0; x < blockSize; x += 1) {
          const target = ((blockY * blockSize + y) * width * blockSize
            + blockX * blockSize + x) * 4;
          rgba[target] = rgb[source];
          rgba[target + 1] = rgb[source + 1];
          rgba[target + 2] = rgb[source + 2];
          rgba[target + 3] = 255;
        }
      }
    }
  }
  return { width: width * blockSize, height: height * blockSize, rgba };
}
async function saveGoldenDiffs(diffs) {
  if (!diffs.length) return;
  const outputDir = path.join(OUTPUT_DIR, 'golden');
  await fs.mkdir(outputDir, { recursive: true });
  for (const diff of diffs) {
    const safeCaseId = String(diff.caseId).replace(/[^a-zA-Z0-9._-]+/g, '-');
    const baseName = `${safeCaseId}-${diff.frame}`;
    const expected = thumbnailRgbToRgba(Buffer.from(diff.expectedThumb, 'base64'), diff.thumbWidth, diff.thumbHeight);
    const actual = thumbnailRgbToRgba(Buffer.from(diff.actualThumb, 'base64'), diff.thumbWidth, diff.thumbHeight);
    await fs.writeFile(path.join(outputDir, `${baseName}-expected.png`), encodeRgbaPng(expected.width, expected.height, expected.rgba));
    await fs.writeFile(path.join(outputDir, `${baseName}-actual.png`), encodeRgbaPng(actual.width, actual.height, actual.rgba));
    await fs.writeFile(path.join(outputDir, `${baseName}-full.png`), encodeRgbaPng(diff.fullWidth, diff.fullHeight, Buffer.from(diff.fullActual, 'base64')));
  }
}
async function writeGoldenFrames(frames) {
  await fs.mkdir(path.dirname(GOLDEN_PATH), { recursive: true });
  await fs.writeFile(GOLDEN_PATH, JSON.stringify(frames, null, 2) + '\n');
}
async function runBrowserPage(chrome, page, files, includeExpectedFailure) {
  if (page === 'app') {
    for (const sharedFile of await listSharedScripts(ROOT)) await injectScript(chrome, sharedFile);
    await injectScript(chrome, path.join(ROOT, 'tests/browser/lib/avz-test.js'));
    for (const file of files) await injectScript(chrome, file.filePath, file.source);
  }
  const expectedFrames = page === 'harness' && !options.updateGolden ? await readGoldenFrames() : null;
  await chrome.evaluate(`window.__avzIncludeExpectedFailure = ${includeExpectedFailure}; window.__avzSkipSlow = ${options.skipSlow}; window.__avzUpdateGolden = ${options.updateGolden}; window.__avzGoldenExpectedFrames = ${JSON.stringify(expectedFrames)}; true`);
  const browserResults = await chrome.evaluate(`window.__avzRun(${JSON.stringify(filter?.source ?? null)})`, { timeoutMs: 180_000 });
  if (!Array.isArray(browserResults)) throw new Error('ブラウザテストの結果配列を取得できませんでした。');
  if (page === 'harness') {
    const goldenOutput = await chrome.evaluate('({ frames: window.__avzGoldenFrames || null, diffs: window.__avzGoldenDiffs || [] })');
    const goldenResult = browserResults.find((result) => result.id === 'B15-04');
    if (options.updateGolden && goldenResult?.status === 'pass') {
      if (!goldenOutput.frames) throw new Error('ゴールデン基準値をブラウザーから取得できませんでした。');
      await writeGoldenFrames(goldenOutput.frames);
    }
    await saveGoldenDiffs(goldenOutput.diffs || []);
  }
  for (const result of browserResults) {
    recordBrowser(result.id, result.name, result.status, result.ms, result.error);
    await saveArtifacts(result);
  }
}

async function runBrowserTests() {
  const allFiles = await discoverBrowserTests();
  const selectedFiles = filter ? allFiles.filter((file) => filter.test(file.source)) : allFiles;
  if (!selectedFiles.length) return;
  if (!findChrome()) throw new BrowserEnvironmentError('Chrome / Chromium が見つかりません。テスト環境エラーです。');

  const includeExpectedFailure = process.env.AVZ_RUNNER_INCLUDE_EXPECTED_FAILURE === '1'
    || Boolean(options.filter && options.filter.includes('B15-00'));
  const harnessFiles = selectedFiles.filter((file) => file.page === 'harness');
  const appFiles = selectedFiles.filter((file) => file.page === 'app');
  if (harnessFiles.length) {
    const { filePath } = await writeHarness({
      rootDir: ROOT,
      testFiles: harnessFiles.map((file) => file.filePath)
    });
    const chrome = await launchChrome({ headed: options.headed });
    try {
      await chrome.navigate(pathToFileURL(filePath).href);
      await runBrowserPage(chrome, 'harness', harnessFiles, includeExpectedFailure);
    } finally {
      await chrome.close();
    }
  }
  // app ページは @query ごとにページを開き直して実行する（既定の '' は従来と同じ index.html）
  const appQueries = [...new Set(appFiles.map((file) => file.query))];
  for (const query of appQueries) {
    const group = appFiles.filter((file) => file.query === query);
    const chrome = await launchChrome({ headed: options.headed });
    try {
      const url = pathToFileURL(path.join(ROOT, 'index.html')).href + (query ? `?${query.replace(/^\?/, '')}` : '');
      await chrome.navigate(url);
      await runBrowserPage(chrome, 'app', group, includeExpectedFailure);
    } finally {
      await chrome.close();
    }
  }
}

async function runBrowserPhase() {
  try {
    await runBrowserTests();
  } catch (error) {
    recordBrowser('BROWSER', 'ブラウザテスト実行', 'fail', 0, error.message);
    if (error instanceof BrowserEnvironmentError || !findChrome()) {
      console.error(`実行環境エラー: ${error.message}`);
      process.exitCode = 2;
    }
  }
}

if (options.unit && options.browser && !options.serial && !options.headed) {
  // 単体テスト（別プロセス）とブラウザテスト（Chrome）は独立しているため並行実行する。
  const browserRecords = [];
  browserSink = browserRecords;
  const browserPhase = runBrowserPhase();
  await runUnitTests();
  await browserPhase;
  browserSink = null;
  for (const entry of browserRecords) record(...entry);
} else {
  if (options.unit) await runUnitTests();
  if (options.browser) await runBrowserPhase();
}

const failed = results.filter((result) => result.status === 'fail');
const skipped = results.filter((result) => result.status === 'skip');
const report = results.map(({ id, name, status, ms, error }) => ({ id, name, status, ms, error }));
await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\n${results.length} 件: ${results.length - failed.length - skipped.length} 成功 / ${failed.length} 失敗 / ${skipped.length} スキップ / ${Date.now() - started}ms`);
if (!process.exitCode && failed.length) process.exitCode = 1;
