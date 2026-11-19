// @page app
// 目的 — IMP-03: 書き出しを途中で中止したあと、再実行した結果が中止前の完走と一致する — doc/20261115-improvement-spec-adoption-review.md §2.4

function imp03Wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// FramePipeline.render の直後に canvas の画素の要約値を記録する（1 フレーム 1 値）
function imp03Hook(sink) {
  const original = FramePipeline.prototype.render;
  FramePipeline.prototype.render = function (input, settings) {
    const result = original.call(this, input, settings);
    // 書き出し用の canvas（DOM に無い）だけを数える。ライブ表示の描画は除く
    if (sink.active && !this.canvas.isConnected) {
      const { width, height } = this.canvas;
      const data = this.ctx.getImageData(0, 0, width, height).data;
      let h = 2166136261;
      for (let i = 0; i < data.length; i += 997) h = Math.imul(h ^ data[i], 16777619) >>> 0;
      sink.frames.push(h);
    }
    return result;
  };
  return () => { FramePipeline.prototype.render = original; };
}

avzTest('IMP03-01', '書き出しを途中で中止しても、再実行の各フレームが中止前の完走と一致する（同じ入力・設定・FPS）', async function () {
  const file = new File([encodeWav16(sigDrumPattern(48000, 2, 120))], 'imp03-drums.wav', { type: 'audio/wav' });
  const settings = Object.assign(createDefaultSettings(), { analyzerType: 'bar', expressionMethod: 'line', physicsAmount: 4, afterimageIntensity: 3 });
  const sink = { active: false, frames: [] };
  const unhook = imp03Hook(sink);
  const exporter = new OfflineExporter();
  try {
    // 1回目: 完走
    sink.active = true; sink.frames = [];
    const blobA = await exporter.export(file, settings, { fps: 30 });
    const framesA = sink.frames.slice();
    avzAssert.ok(blobA && blobA.size > 0, '1回目の書き出し');
    avzAssert.equal(framesA.length, 61, '1回目のフレーム数（2秒・30fps）');

    // 2回目: 描画の途中で中止
    sink.frames = [];
    const pending = exporter.export(file, settings, { fps: 30 });
    const deadline = performance.now() + 60000;
    while (sink.frames.length < 15 && performance.now() < deadline) await imp03Wait(5);
    exporter.cancel();
    const cancelled = await pending;
    avzAssert.equal(cancelled, null, '中止した書き出しは null を返す');
    avzAssert.equal(exporter.state, 'idle', '中止後は待機状態');
    avzAssert.ok(sink.frames.length < framesA.length, '途中で止まっている');

    // 3回目: 再実行して完走
    sink.frames = [];
    const blobC = await exporter.export(file, settings, { fps: 30 });
    const framesC = sink.frames.slice();
    avzAssert.ok(blobC && blobC.size > 0, '再実行の書き出し');
    avzAssert.equal(framesC.length, framesA.length, 'フレーム数が一致');
    const firstDiff = framesC.findIndex((h, i) => h !== framesA[i]);
    avzAssert.equal(firstDiff, -1, `フレーム ${firstDiff} の画素が中止前の完走と異なる`);
  } finally {
    sink.active = false;
    unhook();
  }
}, { slow: true, timeoutMs: 300000 });
