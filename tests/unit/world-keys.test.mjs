// 目的 — WORLD-34 数字キーのタイプ選択（割当のないキーは無視、割当キーは該当タイプを選択）を検査する
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

// 期待値はタイプ表（WORLD_ANALYZER_TYPES）の key・id から導出し、タイプ数や割当の変更に追従させる。
const types = loadClassic(['js/world/gl-util.js', 'js/world/analyzer-types.js']).get('WORLD_ANALYZER_TYPES');

// world-app.js は実物を読み込み、WebGL・音声・書き出しだけをstubに置き換える。
// 返す press は keydown を1回発火し、preventDefault が呼ばれたかを返す。
function setup() {
  const listeners = [], elements = {};
  const element = () => ({ style: {}, offsetHeight: 0, setAttribute() {}, appendChild() {}, addEventListener() {} });
  const document = {
    fullscreenElement: null,
    addEventListener(type, fn) { if (type === 'keydown') listeners.push(fn); },
    createElement: () => element(),
    getElementById: id => elements[id] ||= element()
  };
  const window = { innerWidth: 1920, innerHeight: 1080, addEventListener() {} };
  class Engine {
    constructor() { this.type = types[0]; this.fadeElapsed = .5; }
    clear() {}
    selectType(id) { this.type = types.find(t => t.id === id); this.fadeElapsed = 0; }
  }
  loadClassic(['tests/browser/harness/world-app.js'], {
    WORLD_ANALYZER_TYPES: types, SongMapService: class {}, WorldEngine: Engine, WorldExporter: class {}, AudioEngine: class {},
    window, document, location: { search: '' }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}
  });
  const press = code => {
    const event = { code, target: { tagName: 'BODY' }, altKey: false, ctrlKey: false, metaKey: false, repeat: false,
      prevented: false, preventDefault() { this.prevented = true; } };
    for (const fn of listeners) fn(event);
    return event.prevented;
  };
  return { app: window.worldApp, press };
}

test('UW-94 WORLD-34 割当のない数字キーは例外なく無視し、選択中のタイプを変えない', () => {
  const { app, press } = setup();
  const assigned = new Set(types.map(t => t.key));
  const unassigned = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(n => !assigned.has(n));
  // 先に最後のタイプを選び、割当なしのキーで変わらないことを確かめる。
  const last = types[types.length - 1];
  press('Digit' + last.key);
  assert.equal(app.engine.type.id, last.id);
  for (const n of unassigned) {
    // 例外が出ればこの行で失敗する。割当なしのキーは preventDefault もしない。
    assert.equal(press('Digit' + n), false, 'Digit' + n);
    assert.equal(app.engine.type.id, last.id, 'Digit' + n);
  }
});

test('UW-95 WORLD-34 割当済みの数字キーは該当タイプを選び preventDefault する（Digit3→g-attractor）', () => {
  const { app, press } = setup();
  for (const type of types) {
    const before = app.engine.type.id;
    // 利用可能なタイプだけが選ばれる。表の key を押すと表の id へ切り替わる。
    assert.equal(press('Digit' + type.key), type.available, 'Digit' + type.key);
    assert.equal(app.engine.type.id, type.available ? type.id : before, 'Digit' + type.key);
  }
});
