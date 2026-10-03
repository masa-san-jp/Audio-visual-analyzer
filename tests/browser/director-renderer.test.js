// @page harness
// 目的 — 実Canvasで合成色・動画背景・黒白・縦横比・リセットを確認する — Phase 18 計画書 §6.7（T18-08 補足）。

async function t1808LoadDirectorScripts() {
  // T18-09 が index.html を配線する前でも file:// のハーネスだけで実行できる。
  const scripts = [];
  if (typeof DIRECTOR_SCENES === 'undefined') scripts.push('director-scenes.js');
  if (typeof directorStateAt === 'undefined') scripts.push('director-timeline.js');
  if (typeof DirectorRenderer === 'undefined') scripts.push('director-renderer.js');
  for (const name of scripts) {
    await new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = new URL('../../js/' + name, document.baseURI).href;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('読み込み失敗: ' + name)); };
      document.head.appendChild(script);
    });
  }
}

avzTest('T18-08', 'T18-08 DirectorRenderer の実Canvas合成・動画背景・reset・resize', async function () {
  await t1808LoadDirectorScripts();
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  const renderer = new DirectorRenderer(canvas, ctx);
  const out = createDirectorState();
  const previous = out._secondary;
  previous.segmentIndex = 0;
  previous.settings.analyzerType = 'bar';
  out.primary.segmentIndex = 1;
  out.primary.settings.analyzerType = 'radial';
  out.secondary = previous;
  let backgroundCalls = 0;
  let monochrome = null;
  const input = {
    freq: null, time: null, features: null, dtMs: 1000 / 30, nowMs: 0, historyFps: 30,
    drawBackground(g, c) {
      backgroundCalls++;
      g.fillStyle = monochrome || (c === renderer.canvases[0] ? '#0000ff' : '#ff0000');
      g.fillRect(0, 0, c.width, c.height);
    },
  };
  function pixel() { return Array.from(ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data); }
  function assertPixel(expected) {
    const actual = pixel();
    for (let i = 0; i < 4; i++) avzAssert.close(actual[i], expected[i], 3, '合成ピクセル（Canvas の半透明合成の丸め誤差を許容）');
  }
  try {
    for (const [width, height] of [[320, 180], [240, 240]]) {
      canvas.width = width;
      canvas.height = height;
      renderer.resize();
      for (const bgColor of ['#000', '#fff']) {
        monochrome = null;
        out.primary.settings.bgColor = previous.settings.bgColor = bgColor;
        out.flashAlpha = 0;
        out.secondary = previous;
        for (const [mix, expected] of [[0, [0, 0, 255, 255]], [0.5, [128, 0, 128, 255]], [1, [255, 0, 0, 255]]]) {
          out.mix = mix;
          backgroundCalls = 0;
          renderer.render(input, out, bgColor);
          assertPixel(expected);
          avzAssert.equal(backgroundCalls, 2, '動画背景が両pipelineへ渡る');
          avzAssert.equal(ctx.globalAlpha, 1, '合成後のalpha');
        }
        out.secondary = null;
        out.mix = 0;
        renderer.render(input, out, bgColor);
        assertPixel([255, 0, 0, 255]);
        monochrome = bgColor;
        out.flashAlpha = DIRECTOR_CONST.FLASH_PEAK_ALPHA;
        renderer.render(input, out, bgColor);
        const gray = bgColor === '#000' ? 204 : 51;
        assertPixel([gray, gray, gray, 255]);
      }
    }
    // 同じタイプが偶数セグメントの別シーンで再利用されても固有状態を持ち越さない。
    const entry = RENDERER_REGISTRY.lissajous;
    const originalCreate = entry.create;
    let created = 0;
    let disposed = 0;
    entry.create = function () {
      created++;
      let frames = 0;
      return {
        render(g, c) { frames++; g.fillStyle = frames === 1 ? '#00ff00' : '#ff0000'; g.fillRect(0, 0, c.width, c.height); },
        dispose() { disposed++; },
      };
    };
    try {
      out.primary.settings.analyzerType = 'lissajous';
      out.primary.segmentIndex = 0;
      out.flashAlpha = 0;
      renderer.render(input, out, '#000');
      assertPixel([0, 255, 0, 255]);
      renderer.render(input, out, '#000');
      assertPixel([255, 0, 0, 255]);
      out.primary.segmentIndex = 2;
      renderer.render(input, out, '#000');
      assertPixel([0, 255, 0, 255]);
      renderer.reset();
      renderer.render(input, out, '#000');
      assertPixel([0, 255, 0, 255]);
      avzAssert.equal(created, 3, '割当変更とresetで作り直す');
      avzAssert.equal(disposed, 2, '旧シーンの状態を破棄');
    } finally {
      renderer.dispose();
      entry.create = originalCreate;
    }
  } finally {
    renderer.dispose();
  }
});
