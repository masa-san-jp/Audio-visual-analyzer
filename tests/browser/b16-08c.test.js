// @page harness
// 目的 — デコード時のリサンプリングで長さが 1 サンプル短くなっても最終フレームを失わないことを、デバイスレート非依存で確認する（計画書 §6.3、2026-10-03 T16-09）。

avzTest('B16-08c', 'B16-08c ワークレット単体（offline・44.1kHz・fps=30・totalSamples=220499）で 151 フレームを送る', async function () {
  const sr = 44100, fps = 30, total = 220499;
  const ctx = new OfflineAudioContext(2, total, sr);
  const buf = ctx.createBuffer(2, total, sr);
  const signal = sigDrumPattern(sr, 5, 120);
  buf.getChannelData(0).set(signal.channels[0].subarray(0, total));
  buf.getChannelData(1).set(signal.channels[1].subarray(0, total));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  await ctx.audioWorklet.addModule(createMfsWorkletUrl());
  const node = new AudioWorkletNode(ctx, 'mfs', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    processorOptions: { mode: 'offline', smoothing: 0.8, fps: fps, totalSamples: total },
  });
  const messages = [];
  let resolveDone;
  const donePromise = new Promise(function (r) { resolveDone = r; });
  node.port.onmessage = function (ev) { messages.push(ev.data); if (ev.data.type === 'done') resolveDone(); };
  src.connect(node);
  node.connect(ctx.destination);
  src.start();
  await ctx.startRendering();
  await Promise.race([donePromise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('done が届きません')); }, 10000); })]);
  const frames = messages.filter(function (m) { return m.type === 'frame'; });
  avzAssert.equal(frames.length, 151, '送信フレーム数');
  for (let i = 0; i < frames.length; i++) avzAssert.equal(frames[i].index, i, `index ${i}`);
  avzAssert.equal(messages[messages.length - 1].type, 'done', '最後に done');
}, { timeoutMs: 30000 });
