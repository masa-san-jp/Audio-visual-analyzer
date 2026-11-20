// @page app
// 目的 — Phase 17 音に連動: 描画への反映と UI — doc/20261120-plan-phase17-21-modulation-and-portrait.md §2

function p17Render(routes, withFeatures) {
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
  const ctx = canvas.getContext('2d');
  const p = new FramePipeline(canvas, ctx);
  const settings = Object.assign(createDefaultSettings(), { analyzerType: 'bar', modRoutes: routes });
  const freq = new Uint8Array(638), time = new Uint8Array(2048);
  let features = null;
  if (withFeatures) {
    features = new MfsFrameView();
    const raw = new Float32Array(MFS_LAYOUT.LENGTH);
    raw[MFS_LAYOUT.ONSET_ENV] = 1;           // キック最大
    raw[MFS_LAYOUT.LEVEL] = 0.8;
    features.setPacked(raw);
  }
  const input = { freq, time, getLayer: null, features, dtMs: 16.7, nowMs: 0, historyFps: 60, drawBackground: null, sampleRate: 48000, fftSize: 2048 };
  p.fillBackground(settings);
  for (let i = 0; i < 10; i++) { synthFrame(i, 638, 2048, freq, time); input.nowMs = i * 16.7; p.render(input, settings); }
  return { pixels: ctx.getImageData(0, 0, 160, 90).data, settings };
}
function p17Same(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

avzTest('P17-01', '結線があり特徴があるときだけ描画が変わり、保存値は変わらない', async () => {
  const routes = [{ source: 'kick', target: 'sensitivity', amount: -0.8 }, { source: 'level', target: 'hue', amount: 0.5 }];
  const plain = p17Render([], true).pixels;
  const modded = p17Render(routes, true);
  avzAssert.ok(!p17Same(plain, modded.pixels), '連動で描画が変わる');
  avzAssert.equal(modded.settings.sensitivity, 1, '保存値（感度）は変わらない');
  avzAssert.ok(p17Same(p17Render(routes, false).pixels, p17Render([], false).pixels), '特徴が無いときは従来と同じ');
});

avzTest('P17-02', 'UI: おすすめで3本、行の編集が設定へ反映、すべて解除で空、プリセット読込で表示が戻る', async () => {
  const s = window.__app.visualizer.settings;
  const saved = s.modRoutes;
  try {
    document.getElementById('btn-mod-recommend').click();
    avzAssert.equal(s.modRoutes.length, 3);
    avzAssert.equal(document.getElementById('mod-source-0').value, 'kick');
    avzAssert.ok(document.getElementById('mod-target-3').disabled, '未使用の行は連動先を選べない');

    const src = document.getElementById('mod-source-3');
    src.value = 'hat'; src.dispatchEvent(new Event('change'));
    const tgt = document.getElementById('mod-target-3');
    tgt.value = 'brightness'; tgt.dispatchEvent(new Event('change'));
    const amt = document.getElementById('mod-amount-3');
    amt.value = '-40'; amt.dispatchEvent(new Event('input'));
    avzAssert.deepEqual(s.modRoutes[3], { source: 'hat', target: 'brightness', amount: -0.4 });

    document.getElementById('btn-mod-clear').click();
    avzAssert.deepEqual(s.modRoutes, []);
    avzAssert.equal(document.getElementById('mod-source-0').value, '');

    s.modRoutes = [{ source: 'beat', target: 'density', amount: 0.3 }];
    window.__app.ui._syncControlsFromSettings();
    avzAssert.equal(document.getElementById('mod-source-0').value, 'beat');
    avzAssert.equal(document.getElementById('mod-target-0').value, 'density');
    avzAssert.equal(document.getElementById('mod-amount-0').value, '30');
  } finally {
    s.modRoutes = saved;
    window.__app.ui._syncModulationUI();
  }
});
