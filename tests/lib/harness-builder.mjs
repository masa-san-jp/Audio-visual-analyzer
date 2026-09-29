// 目的 — index.html の script 順を保ったブラウザテスト用ハーネスを生成する（計画書 §3.4.1）。
import fs from 'node:fs/promises';
import path from 'node:path';

const SCRIPT_RE = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;

function normalizeScriptSource(source) {
  return source.replace(/\\/g, '/').replace(/^\.\//, '').split(/[?#]/, 1)[0];
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function resolveLocalScript(rootDir, source) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) {
    throw new Error(`外部 script はハーネスへ追加できません: ${source}`);
  }
  return path.resolve(rootDir, normalizeScriptSource(source));
}

function generatedScriptSource(generatedDir, filePath) {
  const relative = path.relative(generatedDir, filePath).split(path.sep).join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export function extractScriptSources(indexHtml) {
  const sources = [];
  for (const match of indexHtml.matchAll(SCRIPT_RE)) {
    const source = match[1].trim();
    if (normalizeScriptSource(source) === 'js/app.js') continue;
    sources.push(source);
  }
  return sources;
}

export function buildHarnessHtml({
  indexHtml,
  rootDir,
  generatedDir = path.join(rootDir, 'tests/.generated'),
  sharedFiles = [],
  testFiles = []
}) {
  const appScripts = extractScriptSources(indexHtml).map((source) => ({
    filePath: resolveLocalScript(rootDir, source),
    sourceSuffix: source.includes('?') || source.includes('#')
      ? source.slice(source.search(/[?#]/))
      : ''
  }));
  const supportFiles = [
    ...appScripts,
    ...sharedFiles.map((filePath) => ({ filePath: path.resolve(filePath), sourceSuffix: '' })),
    { filePath: path.resolve(rootDir, 'tests/browser/lib/avz-test.js'), sourceSuffix: '' },
    ...testFiles.map((filePath) => ({ filePath: path.resolve(filePath), sourceSuffix: '' }))
  ];
  const scriptTags = supportFiles.map(({ filePath, sourceSuffix }) =>
    `  <script src="${escapeHtml(generatedScriptSource(generatedDir, filePath) + sourceSuffix)}"></script>`
  ).join('\n');

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>AVZ browser test harness</title>
</head>
<body>
${scriptTags}
</body>
</html>
`;
}

export async function listSharedScripts(rootDir) {
  const sharedDir = path.join(rootDir, 'tests/shared');
  let names;
  try {
    names = await fs.readdir(sharedDir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return names.filter((name) => name.endsWith('.js')).sort()
    .map((name) => path.join(sharedDir, name));
}

export async function writeHarness({ rootDir, testFiles }) {
  const generatedDir = path.join(rootDir, 'tests/.generated');
  const indexHtml = await fs.readFile(path.join(rootDir, 'index.html'), 'utf8');
  const html = buildHarnessHtml({
    indexHtml,
    rootDir,
    generatedDir,
    sharedFiles: await listSharedScripts(rootDir),
    testFiles
  });
  await fs.mkdir(generatedDir, { recursive: true });
  const filePath = path.join(generatedDir, 'harness.html');
  await fs.writeFile(filePath, html);
  return { filePath, html };
}
