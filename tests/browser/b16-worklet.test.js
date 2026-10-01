// @page harness
// 目的 — MFS ワークレット（offline / live モード）を OfflineAudioContext 上で動かし、ページ内の MfsExtractor 直接駆動と比較する（計画書 §9.2 B16-01・B16-08、§6.1・§6.3）。

// ワークレットを走らせて受信メッセージを集める。messages は { type, ... } の配列
async function b16RunWorklet(signal, processorOptions, extra) {
  const sr = signal.sampleRate;
  const len = signal.channels[0].length;
  const ctx = new OfflineAudioContext(2, len, sr);
  const buf = ctx.createBuffer(2, len, sr);
  buf.getChannelData(0).set(signal.channels[0]);
  buf.getChannelData(1).set(signal.channels[1]);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  await ctx.audioWorklet.addModule(createMfsWorkletUrl());
  const node = new AudioWorkletNode(ctx, 'mfs', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    processorOptions: processorOptions
  });
  const messages = [];
  let resolveDone;
  const donePromise = new Promise(function (r) { resolveDone = r; });
  node.port.onmessage = function (ev) {
    messages.push(ev.data);
    if (ev.data.type === 'done') resolveDone();
  };
  if (extra) extra(node);
  src.connect(node);
  node.connect(ctx.destination);
  src.start();
  await ctx.startRendering();
  if (processorOptions.mode === 'offline') {
    await Promise.race([donePromise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('done メッセージが届きません')); }, 10000); })]);
  } else {
    await new Promise(function (r) { setTimeout(r, 300); });
  }
  return messages;
}

// ページ内で MfsExtractor を直接駆動し、ホップごとの packed/freq/time（コピー）を返す
function b16DirectHops(signal, smoothing) {
  const ex = new MfsExtractor(signal.sampleRate, { smoothing: smoothing });
  const hops = [];
  ex.onHop = function (e) {
    hops.push({ f: e.packed.slice(), freq: e.freqBytes.slice(), time: e.timeBytes.slice() });
  };
  const L = signal.channels[0], R = signal.channels[1];
  for (let i = 0; i < L.length; i += 128) {
    const n = Math.min(128, L.length - i);
    ex.pushSamples(L.subarray(i, i + n), R.subarray(i, i + n), n);
  }
  return hops;
}

avzTest('B16-01', 'B16-01 MFS ワークレット（offline・30fps）の出力がページ内 MfsExtractor の直接駆動と一致する', async function () {
  const sr = 48000, fps = 30;
  const signal = sigDrumPattern(sr, 10, 120);
  const total = signal.channels[0].length;
  const messages = await b16RunWorklet(signal, { mode: 'offline', smoothing: 0.8, fps: fps, totalSamples: total });
  const frames = messages.filter(function (m) { return m.type === 'frame'; });
  const hops = b16DirectHops(signal, 0.8);
  const H = MFS_CONST.HOP_SIZE, LY = MFS_LAYOUT;
  const expectedCount = Math.floor(total * fps / sr) + 1;
  avzAssert.equal(frames.length, expectedCount, 'フレーム数');
  let maxDiff = 0, byteMismatch = 0, nonZeroFlags = 0, prevHop = -1;
  for (let i = 0; i < frames.length; i++) {
    const m = frames[i];
    const s = i * sr / fps;
    const h = Math.floor(s / H) - 1;
    avzAssert.equal(m.index, i, 'index');
    avzAssert.equal(m.hop, h, `hop (frame ${i})`);
    const f = m.f;
    avzAssert.equal(f.length, LY.LENGTH, 'packed 長');
    // 期待値: ホップ h の packed。フラグのみ前フレームのホップより後〜h の OR に置換（§6.3）
    let onset = 0, beat = 0, down = 0;
    for (let k = prevHop + 1; k <= h; k++) {
      onset |= hops[k].f[LY.ONSET_FLAGS]; beat |= hops[k].f[LY.BEAT_FLAG]; down |= hops[k].f[LY.DOWNBEAT_FLAG];
    }
    if (onset | beat | down) nonZeroFlags++;
    for (let j = 0; j < LY.LENGTH; j++) {
      let exp = h >= 0 ? hops[h].f[j] : 0;
      if (j === LY.ONSET_FLAGS) exp = onset;
      else if (j === LY.BEAT_FLAG) exp = beat;
      else if (j === LY.DOWNBEAT_FLAG) exp = down;
      const d = Math.abs(f[j] - exp);
      if (d > maxDiff) maxDiff = d;
    }
    for (let j = 0; j < m.freq.length; j++) {
      const e = h >= 0 ? hops[h].freq[j] : 0;
      if (m.freq[j] !== e) byteMismatch++;
    }
    for (let j = 0; j < m.time.length; j++) {
      const e = h >= 0 ? hops[h].time[j] : 128;
      if (m.time[j] !== e) byteMismatch++;
    }
    prevHop = h;
  }
  avzAssert.ok(maxDiff <= 1e-6, `packed 最大絶対差 ${maxDiff}`);
  avzAssert.equal(byteMismatch, 0, 'freq/time のバイト不一致数');
  avzAssert.ok(nonZeroFlags > 0, 'オンセットなどのフラグが 1 度も立たない（信号か集約の不具合）');
  const last = messages[messages.length - 1];
  avzAssert.equal(last.type, 'done', '最後は done');
}, { timeoutMs: 60000 });

avzTest('B16-08', 'B16-08 ワークレット単体（offline・fps=30・totalSamples=96000）のフレーム数・index・hop・done', async function () {
  const sr = 48000, fps = 30, total = 48000 * 2;
  const signal = sigDrumPattern(sr, 2, 120);
  const messages = await b16RunWorklet(signal, { mode: 'offline', smoothing: 0.8, fps: fps, totalSamples: total });
  const frames = messages.filter(function (m) { return m.type === 'frame'; });
  avzAssert.equal(frames.length, 61, '送信フレーム数');
  const H = MFS_CONST.HOP_SIZE;
  for (let i = 0; i < frames.length; i++) {
    avzAssert.equal(frames[i].index, i, `index ${i}`);
    avzAssert.equal(frames[i].hop, Math.floor(i * sr / fps / H) - 1, `hop (frame ${i})`);
    avzAssert.ok(frames[i].f instanceof Float32Array && frames[i].freq instanceof Uint8Array && frames[i].time instanceof Uint8Array, '型');
  }
  // フレーム 0 は s < H なのでホップ無し: packed 全 0、freq 全 0、time 全 128、hop = -1
  avzAssert.equal(frames[0].hop, -1, 'frame 0 の hop');
  avzAssert.ok(frames[0].f.every(function (v) { return v === 0; }), 'frame 0 の packed が全 0');
  avzAssert.ok(frames[0].freq.every(function (v) { return v === 0; }), 'frame 0 の freq が全 0');
  avzAssert.ok(frames[0].time.every(function (v) { return v === 128; }), 'frame 0 の time が全 128');
  // 最後のフレーム（s = totalSamples）は入力終端で最後のホップの内容を使う（ホップ 186 まで完了）
  avzAssert.equal(frames[60].hop, 186, '最終フレームの hop');
  avzAssert.equal(messages.filter(function (m) { return m.type === 'done'; }).length, 1, 'done は 1 回');
  avzAssert.equal(messages[messages.length - 1].type, 'done', '最後に done');
  avzAssert.equal(messages.length, 62, '全メッセージ数');
}, { timeoutMs: 30000 });

avzTest('B16-08b', 'B16-08b ワークレット単体（live）: hop メッセージの番号・時刻・配列長・smoothing オプション', async function () {
  const sr = 48000, total = 48000;
  const signal = sigDrumPattern(sr, 1, 120);
  const H = MFS_CONST.HOP_SIZE;
  // reset / smoothing メッセージの実時間での挙動は T16-07 の B16-04 で確認する（OfflineAudioContext ではメッセージの到着順が不定）
  const messages = await b16RunWorklet(signal, { mode: 'live', smoothing: 0.5 });
  const hops = messages.filter(function (m) { return m.type === 'hop'; });
  avzAssert.equal(hops.length, Math.floor(total / H), 'hop 数');
  for (let i = 0; i < hops.length; i++) {
    avzAssert.equal(hops[i].hop, i, `hop 番号 ${i}`);
    avzAssert.close(hops[i].t, (i + 1) * H / sr, 1e-9, `t (hop ${i})`);
  }
  avzAssert.equal(hops[0].f.length, MFS_LAYOUT.LENGTH, 'packed 長');
  avzAssert.equal(hops[0].freq.length, MFS_CONST.FFT_SIZE / 2, 'freq 長');
  avzAssert.equal(hops[0].time.length, MFS_CONST.FFT_SIZE, 'time 長');
  // processorOptions.smoothing = 0.5 が反映されている: ページ内の直接駆動（smoothing 0.5）とバイト一致
  const direct = b16DirectHops(signal, 0.5);
  let mismatch = 0;
  for (let i = 0; i < hops.length; i++) {
    for (let j = 0; j < hops[i].freq.length; j++) if (hops[i].freq[j] !== direct[i].freq[j]) mismatch++;
  }
  avzAssert.equal(mismatch, 0, 'freq 不一致数');
}, { timeoutMs: 30000 });
