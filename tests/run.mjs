#!/usr/bin/env node
// 目的 — Node 単体テストとブラウザテストを統一実行する（計画書 §3.1・§3.4）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BrowserEnvironmentError, findChrome, launchChrome } from './lib/chrome.mjs';
import { listSharedScripts, writeHarness } from './lib/harness-builder.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'tests/output');
const args = process.argv.slice(2);
const options = { unit: false, browser: false, headed: false, skipSlow: false, filter: null };
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--unit') options.unit = true;
  else if (arg === '--browser') options.browser = true;
  else if (arg === '--headed') options.headed = true;
  else if (arg === '--skip-slow') options.skipSlow = true;
  else if (arg === '--filter') options.filter = args[++i];
  else if (arg === '--help') {
    console.log('使い方: node tests/run.mjs [--unit] [--browser] [--filter <正規表現>] [--headed] [--skip-slow]');
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
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: ROOT, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
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
    files.push({ filePath, source, page });
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

async function runBrowserPage(chrome, page, files, includeExpectedFailure) {
  if (page === 'app') {
    for (const sharedFile of await listSharedScripts(ROOT)) await injectScript(chrome, sharedFile);
    await injectScript(chrome, path.join(ROOT, 'tests/browser/lib/avz-test.js'));
    for (const file of files) await injectScript(chrome, file.filePath, file.source);
  }
  await chrome.evaluate(`window.__avzIncludeExpectedFailure = ${includeExpectedFailure}; window.__avzSkipSlow = ${options.skipSlow}; true`);
  const browserResults = await chrome.evaluate(`window.__avzRun(${JSON.stringify(filter?.source ?? null)})`);
  if (!Array.isArray(browserResults)) throw new Error('ブラウザテストの結果配列を取得できませんでした。');
  for (const result of browserResults) {
    record(result.id, result.name, result.status, result.ms, result.error);
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
  if (appFiles.length) {
    const chrome = await launchChrome({ headed: options.headed });
    try {
      await chrome.navigate(pathToFileURL(path.join(ROOT, 'index.html')).href);
      await runBrowserPage(chrome, 'app', appFiles, includeExpectedFailure);
    } finally {
      await chrome.close();
    }
  }
}

if (options.unit) await runUnitTests();
if (options.browser) {
  try {
    await runBrowserTests();
  } catch (error) {
    record('BROWSER', 'ブラウザテスト実行', 'fail', 0, error.message);
    if (error instanceof BrowserEnvironmentError || !findChrome()) {
      console.error(`実行環境エラー: ${error.message}`);
      process.exitCode = 2;
    }
  }
}

const failed = results.filter((result) => result.status === 'fail');
const skipped = results.filter((result) => result.status === 'skip');
const report = results.map(({ id, name, status, ms, error }) => ({ id, name, status, ms, error }));
await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\n${results.length} 件: ${results.length - failed.length - skipped.length} 成功 / ${failed.length} 失敗 / ${skipped.length} スキップ / ${Date.now() - started}ms`);
if (!process.exitCode && failed.length) process.exitCode = 1;
