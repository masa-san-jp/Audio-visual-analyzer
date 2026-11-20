// 目的 — Phase 17 音に連動（js/modulation.js）の純粋関数 — doc/20261120-plan-phase17-21-modulation-and-portrait.md §2
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['js/vis-utils.js', 'js/settings.js', 'js/modulation.js', 'js/settings-io.js']);
const normalizeModRoutes = get('normalizeModRoutes');
const applyModulation = get('applyModulation');
const modSourceValue = get('modSourceValue');
const MOD_SOURCES = get('MOD_SOURCES');
const MOD_TARGETS = get('MOD_TARGETS');
const createDefaultSettings = get('createDefaultSettings');
const serializeSettings = get('serializeSettings');
const deserializeSettings = get('deserializeSettings');

function features({ env = [0, 0, 0, 0], locked = false, beatPhase = 0, beatInBar = 0, level = 0, centroid = 0, width = 0 } = {}) {
  return { onset: { env }, tempo: { locked, beatPhase, beatInBar }, loudness: { level }, timbre: { centroid }, stereo: { width } };
}

test('P17-U01 normalizeModRoutes: 未知のキーを除き、強さを -1..1 に丸め、最大4本', () => {
  assert.deepEqual(normalizeModRoutes(null), []);
  assert.deepEqual(normalizeModRoutes([{ source: 'x', target: 'hue', amount: 1 }, { source: 'kick', target: 'nope', amount: 1 }, 5]), []);
  assert.deepEqual(normalizeModRoutes([{ source: 'kick', target: 'hue', amount: 3 }]), [{ source: 'kick', target: 'hue', amount: 1 }]);
  assert.deepEqual(normalizeModRoutes([{ source: 'kick', target: 'hue', amount: 'a' }]), [{ source: 'kick', target: 'hue', amount: 0 }]);
  const many = Array.from({ length: 6 }, () => ({ source: 'level', target: 'density', amount: 0.5 }));
  assert.equal(normalizeModRoutes(many).length, 4);
});

test('P17-U02 applyModulation: 結線なし・特徴なし・強さ0は base をそのまま返す（従来と同じ描画）', () => {
  const base = createDefaultSettings();
  const out = {};
  assert.equal(applyModulation(base, [], features(), out), base);
  assert.equal(applyModulation(base, [{ source: 'kick', target: 'hue', amount: 1 }], null, out), base);
  assert.equal(applyModulation(base, [{ source: 'kick', target: 'hue', amount: 0 }], features({ env: [1, 0, 0, 0] }), out), base);
});

test('P17-U03 applyModulation: 加算・乗算・クランプ・色相の折り返し。base は変えず out を使い回す', () => {
  const base = Object.assign(createDefaultSettings(), { sensitivity: 1, afterimageIntensity: 8, hue: 300, barWidth: 2 });
  const out = {};
  const f = features({ env: [1, 0.5, 0, 0] });
  const r = applyModulation(base, [
    { source: 'kick', target: 'sensitivity', amount: 0.5 },          // 1 × (1 + 0.5·1·1) = 1.5
    { source: 'kick', target: 'afterimageIntensity', amount: 1 },    // 8 + 10 → 10 にクランプ
    { source: 'kick', target: 'hue', amount: 0.5 },                  // 300 + 90 → 30（折り返し）
    { source: 'snare', target: 'barWidth', amount: -1 },             // 2 − 10·0.5 → 1 にクランプ
  ], f, out);
  assert.equal(r, out);
  assert.equal(r.sensitivity, 1.5);
  assert.equal(r.afterimageIntensity, 10);
  assert.equal(r.hue, 30);
  assert.equal(r.barWidth, 1);
  assert.equal(base.sensitivity, 1, 'base は変えない');
  assert.equal(base.hue, 300);
  assert.equal(r.layers, base.layers, '他の値はそのまま');
});

test('P17-U04 連動元: 拍・小節の頭はテンポ確定時のみ、値は 0..1', () => {
  assert.equal(modSourceValue('beat', features({ locked: false, beatPhase: 0 })), 0);
  assert.equal(modSourceValue('beat', features({ locked: true, beatPhase: 0 })), 1);
  assert.ok(Math.abs(modSourceValue('beat', features({ locked: true, beatPhase: 0.5 })) - 0.0625) < 1e-12);
  assert.equal(modSourceValue('downbeat', features({ locked: true, beatPhase: 0, beatInBar: 1 })), 0);
  assert.equal(modSourceValue('downbeat', features({ locked: true, beatPhase: 0, beatInBar: 0 })), 1);
  assert.equal(modSourceValue('level', features({ level: 2 })), 1);
  for (const key of Object.keys(MOD_SOURCES)) {
    const v = modSourceValue(key, features({ env: [0.3, 0.3, 0.3, 0.3], locked: true, beatPhase: 0.2, level: 0.3, centroid: 0.3, width: 0.3 }));
    assert.ok(v >= 0 && v <= 1, key);
  }
  for (const key of Object.keys(MOD_TARGETS)) assert.ok(key in createDefaultSettings(), `連動先 ${key} は設定に存在する`);
});

test('P17-U05 設定の往復: modRoutes は保存・読込で保持され、旧形式・不正値は空', () => {
  const s = createDefaultSettings();
  assert.deepEqual(s.modRoutes, []);
  s.modRoutes = [{ source: 'kick', target: 'sensitivity', amount: 0.6 }, { source: 'bad', target: 'hue', amount: 1 }];
  const back = deserializeSettings(serializeSettings(s));
  assert.deepEqual(back.modRoutes, [{ source: 'kick', target: 'sensitivity', amount: 0.6 }]);
  const legacy = serializeSettings(createDefaultSettings());
  delete legacy.settings.modRoutes;
  assert.deepEqual(deserializeSettings(legacy).modRoutes, []);
  assert.notEqual(createDefaultSettings().modRoutes, createDefaultSettings().modRoutes, '既定値は毎回新しい配列');
});
