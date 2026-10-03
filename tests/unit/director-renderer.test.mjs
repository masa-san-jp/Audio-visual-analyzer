// 目的 — 描画順・割当・リセット・動画入力の検証 — Phase 18 計画書 §6.7（U18-17・U18-20 補足）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

function environment() {
  const events = [];
  let nextId = 0;
  let creations = 0;
  function canvas(width = 0, height = 0) {
    const c = { id: nextId++, width, height };
    const ctx = { globalAlpha: 0.3, globalCompositeOperation: 'multiply', fillStyle: '#123',
      save() { this.saved = [this.globalAlpha, this.globalCompositeOperation, this.fillStyle]; },
      restore() { [this.globalAlpha, this.globalCompositeOperation, this.fillStyle] = this.saved; },
      drawImage(source, x, y) { events.push(['draw', source.id, this.globalAlpha, this.globalCompositeOperation, x, y]); },
      fillRect(x, y, w, h) { events.push(['fill', c.id, this.fillStyle, this.globalAlpha, x, y, w, h]); },
      clearRect(x, y, w, h) { events.push(['clear', c.id, x, y, w, h]); },
    };
    c.getContext = () => ctx;
    return c;
  }
  class Pipeline {
    constructor(c, ctx) { this.canvas = c; this.ctx = ctx; creations++; }
    reset() { events.push(['reset', this.canvas.id]); }
    dispose() { events.push(['dispose', this.canvas.id]); }
    resize() { events.push(['resize', this.canvas.id, this.canvas.width, this.canvas.height]); }
    fillBackground(settings) { events.push(['background', this.canvas.id, settings.bgColor]); }
    render(input, settings) {
      events.push(['render', this.canvas.id, input, settings]);
      if (input.drawBackground) input.drawBackground(this.ctx, this.canvas);
    }
  }
  const { get } = loadClassic(['js/director-renderer.js'], {
    document: { createElement(name) { assert.equal(name, 'canvas'); return canvas(); } },
    FramePipeline: Pipeline,
  });
  const target = canvas(320, 180);
  const ctx = target.getContext('2d');
  const Renderer = get('DirectorRenderer');
  const renderer = new Renderer(target, ctx);
  return { events, target, ctx, renderer, creations: () => creations };
}
const scene = (segmentIndex, bgColor = '#000') => ({ segmentIndex, sceneId: `scene:${segmentIndex}`, settings: { bgColor } });

// 呼び出し順を観測し、ピクセル合成自体は追加ブラウザテストで確認する。
test('U18-17 Renderer は primary/secondary の順に描画し、secondary/primary/flash の順に合成する', () => {
  const { events, renderer, ctx } = environment();
  events.length = 0;
  const inputs = [];
  const input = { drawBackground(g, c) { inputs.push([g, c]); } };
  const state = { primary: scene(1), secondary: scene(0), mix: 0.5, flashAlpha: 0.8 };
  renderer.render(input, state, '#000');
  const renders = events.filter(e => e[0] === 'render');
  assert.deepEqual(renders.map(e => e[1]), [renderer.canvases[1].id, renderer.canvases[0].id]);
  assert.equal(renders[0][2], input);
  assert.equal(renders[0][3], state.primary.settings);
  assert.equal(renders[1][2], input);
  assert.equal(renders[1][3], state.secondary.settings);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0][1], renderer.canvases[1]);
  assert.equal(inputs[1][1], renderer.canvases[0]);
  const draws = events.filter(e => e[0] === 'draw');
  assert.deepEqual(draws, [
    ['draw', renderer.canvases[0].id, 1, 'source-over', 0, 0],
    ['draw', renderer.canvases[1].id, 0.5, 'source-over', 0, 0],
  ]);
  assert.deepEqual(events.at(-1), ['fill', 0, '#fff', 0.8, 0, 0, 320, 180]);
  assert.equal(ctx.globalAlpha, 0.3);
  assert.equal(ctx.globalCompositeOperation, 'multiply');
  assert.equal(ctx.fillStyle, '#123');
  events.length = 0;
  renderer.render(input, { ...state, secondary: null, mix: 0, flashAlpha: 0 }, '#000');
  assert.deepEqual(events.filter(e => e[0] === 'draw'), [['draw', renderer.canvases[1].id, 1, 'source-over', 0, 0]]);
  assert.equal(events.filter(e => e[0] === 'fill').length, 0);
  renderer.render(input, { ...state, secondary: null }, '#fff');
  assert.deepEqual(events.at(-1), ['fill', 0, '#000', 0.8, 0, 0, 320, 180]);
});

test('U18-20 Renderer は同じ割当を1000フレーム保持し、セグメント変更/明示resetだけで初期化する', t => {
  const { events, renderer, creations } = environment();
  const canvases = [...renderer.canvases];
  const pipelines = [...renderer.pipelines];
  const assignment = renderer._assignments;
  const state = { primary: scene(0), secondary: null, mix: 1, flashAlpha: 0 };
  const input = {};
  events.length = 0;
  for (let i = 0; i < 1000; i++) renderer.render(input, state, '#000');
  assert.equal(events.filter(e => e[0] === 'reset').length, 1);
  assert.equal(events.filter(e => e[0] === 'background').length, 1);
  assert.equal(events.filter(e => e[0] === 'render').length, 1000);
  assert.equal(creations(), 2);
  assert.equal(renderer._assignments, assignment);
  for (let i = 0; i < 2; i++) {
    assert.equal(renderer.canvases[i], canvases[i]);
    assert.equal(renderer.pipelines[i], pipelines[i]);
  }
  events.length = 0;
  renderer.render(input, { ...state, primary: scene(1), secondary: state.primary, mix: 0 }, '#000');
  assert.deepEqual(events.filter(e => e[0] === 'reset').map(e => e[1]), [canvases[1].id]);
  events.length = 0;
  renderer.render(input, { ...state, primary: scene(2) }, '#000');
  assert.deepEqual(events.slice(0, 4), [
    ['dispose', canvases[0].id], ['reset', canvases[0].id], ['clear', canvases[0].id, 0, 0, 320, 180],
    ['background', canvases[0].id, '#000'],
  ]);
  events.length = 0;
  renderer.reset();
  assert.deepEqual(renderer._assignments, [-1, -1]);
  assert.equal(events.filter(e => e[0] === 'reset').length, 2);
  assert.equal(events.filter(e => e[0] === 'dispose').length, 2);
  assert.equal(events.filter(e => e[0] === 'clear').length, 2);
  events.length = 0;
  renderer.render(input, { ...state, primary: scene(2) }, '#000');
  assert.equal(events.filter(e => e[0] === 'reset').length, 1);
  t.diagnostic('1000フレーム: Pipeline生成2（constructorのみ）、割当reset1、設定/input参照をそのまま渡す');
});

test('U18-17 Renderer resize/dispose は2つのパイプラインと両canvasへ反映する', () => {
  const { events, renderer, target } = environment();
  for (const [w, h] of [[640, 360], [240, 240], [0, 0]]) {
    events.length = 0;
    target.width = w;
    target.height = h;
    renderer.resize();
    assert.equal(events.filter(e => e[0] === 'resize').length, 2);
    for (const c of renderer.canvases) {
      assert.equal(c.width, w);
      assert.equal(c.height, h);
    }
  }
  events.length = 0;
  renderer.dispose();
  assert.equal(events.filter(e => e[0] === 'dispose').length, 2);
  assert.deepEqual(renderer._assignments, [-1, -1]);
  assert.ok(renderer.canvases.every(c => c.width === 0 && c.height === 0));
});
