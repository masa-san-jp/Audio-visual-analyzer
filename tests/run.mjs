#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BrowserEnvironmentError, findChrome, launchChrome } from './lib/chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'tests/output');
const args = process.argv.slice(2);
const options = { unit: false, browser: false, headed: false, filter: null };
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--unit') options.unit = true;
  else if (arg === '--browser') options.browser = true;
  else if (arg === '--headed') options.headed = true;
  else if (arg === '--filter') options.filter = args[++i];
  else if (arg === '--help') {
    console.log('使い方: node tests/run.mjs [--unit] [--browser] [--filter <正規表現>] [--headed]');
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
function shouldRun(name) { return !filter || filter.test(name); }
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

async function runBrowserSmokeTests() {
  if (!findChrome()) throw new Error('Chrome / Chromium が見つかりません。テスト環境エラーです。');
  const chrome = await launchChrome({ headed: options.headed });
  try {
    const t0 = Date.now();
    const value = await chrome.evaluate('document.title = "AVZ test"; "ok"');
    record('B15-00', 'ブラウザー正常系の値を取得できる', value === 'ok' ? 'pass' : 'fail', Date.now() - t0,
      value === 'ok' ? null : `想定値 ok、実際値 ${value}`);

    const failT0 = Date.now();
    let failureDetected = false;
    try {
      await chrome.evaluate('throw new Error("intentional browser test failure")');
    } catch {
      failureDetected = true;
    }
    record('B15-00', 'ブラウザー例外を失敗として検知できる', failureDetected ? 'pass' : 'fail', Date.now() - failT0,
      failureDetected ? null : '意図的な例外を検知できませんでした');

    const consoleT0 = Date.now();
    const before = chrome.errors.length;
    await chrome.evaluate('console.error("intentional browser console error"); new Promise(resolve => setTimeout(resolve, 0))');
    const consoleDetected = chrome.errors.length > before;
    record('B15-00', 'コンソールエラーを失敗として検知できる', consoleDetected ? 'pass' : 'fail', Date.now() - consoleT0,
      consoleDetected ? null : '意図的な console.error を検知できませんでした');
  } finally {
    await chrome.close();
  }
}

if (options.unit) await runUnitTests();
if (options.browser && shouldRun('B15-00')) {
  try {
    await runBrowserSmokeTests();
  } catch (error) {
    record('B15-00', 'ブラウザー起動', 'fail', 0, error.message);
    if (!findChrome() || error instanceof BrowserEnvironmentError) {
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
