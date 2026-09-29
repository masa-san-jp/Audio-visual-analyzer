// 目的 — 生成ハーネスの script 順と相対パスを検証する（計画書 §3.4.1）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHarnessHtml, extractScriptSources } from '../lib/harness-builder.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('B15-00 ハーネス生成: index.html の script 順と app.js 除外を保つ', async () => {
  const indexHtml = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const sources = extractScriptSources(indexHtml);
  assert.equal(sources[0], 'js/settings.js');
  assert.equal(sources.at(-1), 'js/ui-controller.js');
  assert.ok(!sources.includes('js/app.js'));

  const html = buildHarnessHtml({
    indexHtml,
    rootDir: ROOT,
    generatedDir: path.join(ROOT, 'tests/.generated'),
    sharedFiles: [],
    testFiles: [path.join(ROOT, 'tests/browser/b15-00.test.js')]
  });
  assert.match(html, /<script src="\.\.\/\.\.\/js\/settings\.js"><\/script>/);
  assert.match(html, /<script src="\.\.\/browser\/lib\/avz-test\.js"><\/script>/);
  assert.match(html, /<script src="\.\.\/browser\/b15-00\.test\.js"><\/script>/);
  assert.doesNotMatch(html, /js\/app\.js/);
  assert.ok(html.indexOf('js/settings.js') < html.indexOf('js/ui-controller.js'));
});
