// 目的 — 全WORLDシェーダーの組立済みソースとprecision順序を検証する — 実装者ガイド §9.2、WORLD-12修正
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';

const root = new URL('../../', import.meta.url);
const html = fs.readFileSync(new URL('world.html', root), 'utf8');
const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
const worldFiles = scripts.filter(file => file.startsWith('js/world/'));
const { get } = loadClassic(scripts);
const header = /^#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n/;

test('UW-47 全WORLD vertex/fragmentソース: version直後にfloat/int/sampler2D precision', () => {
  // ページと同じ順序で評価し、テンプレート内の共有GLSLも実コードで組み立てる。
  assert.deepEqual(worldFiles.slice().sort(), fs.readdirSync(new URL('js/world/', root))
    .filter(file => file.endsWith('.js')).map(file => 'js/world/' + file).sort());
  let count = 0, vertices = 0, fragments = 0;
  const failures = [];
  for (const file of worldFiles) {
    const source = fs.readFileSync(new URL(file, root), 'utf8');
    // versionが失われた場合も拾うため、文字列定数からmainを持つ組立済みソースを選ぶ。
    for (const match of source.matchAll(/^const\s+(\w+)\s*=\s*[`'"]/gm)) {
      const shader = get(match[1]);
      if (typeof shader !== 'string' || !/\bvoid\s+main\s*\(/.test(shader)) continue;
      count++;
      if (shader.includes('gl_Position')) vertices++; else fragments++;
      if (!header.test(shader)) failures.push(file + ': ' + match[1]);
      assert.equal((shader.match(/#version/g) || []).length, 1, match[1] + ': version重複');
    }
  }
  assert.equal(count, 33, '全33シェーダーを監査する');
  assert.equal(vertices, 7); assert.equal(fragments, 26);
  assert.deepEqual(failures, [], '宣言より前に完全なprecisionヘッダーが必要');
  console.log('UW-47 shaders=' + count + ' vertex=' + vertices + ' fragment=' + fragments + ' headerFailures=' + failures.length);
});
