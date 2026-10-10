// 目的 — ブラウザテスト専用の WORLD 画面（tests/browser/harness/world.html）の script 一覧を、リポジトリ直下からの相対パスで返す。
// world.html は利用者向けには廃止され、tests/browser/harness/ へ移した（統合設計 §6）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const WORLD_HARNESS_DIR = 'tests/browser/harness';
export const WORLD_HARNESS_HTML = `${WORLD_HARNESS_DIR}/world.html`;

export function worldHarnessHtml() {
  return fs.readFileSync(path.join(ROOT, WORLD_HARNESS_HTML), 'utf8');
}

export function worldHarnessScripts() {
  return [...worldHarnessHtml().matchAll(/<script\s+src="([^"]+)"/g)]
    .map((m) => path.posix.normalize(path.posix.join(WORLD_HARNESS_DIR, m[1])));
}
