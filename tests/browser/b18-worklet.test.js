// @page harness
// 目的 — MFS ワークレット songmap モードの行データが、ページ内 MfsExtractor の直接駆動（tests/lib/songmap-rows.mjs と同じ手順）と一致し、行数 = ホップ数であること（計画書 §8.3 B18-01 の行データ部分、§3）。

async function b18RunSongmap(signal) {
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
    processorOptions: { mode: 'songmap', totalSamples: len }
  });
  const messages = [];
  let resolveDone;
  const donePromise = new Promise(function (r) { resolveDone = r; });
  node.port.onmessage = function (ev) {
    messages.push(ev.data);
    if (ev.data.type === 'done') resolveDone();
  };
  src.connect(node);
  node.connect(ctx.destination);
  src.start();
  await ctx.startRendering();
  await Promise.race([donePromise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('done メッセージが届きません')); }, 10000); })]);
  return messages;
}

// tests/lib/songmap-rows.mjs の songmapRows と同じ手順（ページ内の MfsExtractor を 128 サンプルずつ駆動）
function b18DirectRows(signal) {
  const R = SONGMAP_ROW, LY = MFS_LAYOUT;
  const L = signal.channels[0], Rr = signal.channels[1];
  const hops = Math.floor(L.length / MFS_CONST.HOP_SIZE);
  const rows = new Float32Array(hops * R.LENGTH);
  const ex = new MfsExtractor(signal.sampleRate);
  ex.onHop = function (e) {
    const base = e.hopIndex * R.LENGTH;
    for (let i = 0; i < 4; i++) rows[base + R.FLUX + i] = e.flux[i];
    for (let i = 0; i < 32; i++) rows[base + R.BANDS + i] = e.packed[LY.BANDS + i];
    for (let i = 0; i < 12; i++) rows[base + R.CHROMA + i] = e.packed[LY.CHROMA + i];
    rows[base + R.ENERGY] = e.hopEnergy;
  };
  for (let i = 0; i < L.length; i += 128) {
    const n = Math.min(128, L.length - i);
    ex.pushSamples(L.subarray(i, i + n), Rr.subarray(i, i + n), n);
  }
  return { rows: rows, hops: hops };
}

function b18Compare(messages, signal) {
  const R = SONGMAP_ROW;
  const direct = b18DirectRows(signal);
  const rowMsgs = messages.filter(function (m) { return m.type === 'rows'; });
  const done = messages[messages.length - 1];
  avzAssert.equal(done.type, 'done', '最後は done');
  avzAssert.equal(done.hops, direct.hops, 'done.hops = ホップ数');
  let total = 0, expectStart = 0, maxDiff = 0;
  for (let k = 0; k < rowMsgs.length; k++) {
    const m = rowMsgs[k];
    avzAssert.equal(m.startHop, expectStart, `startHop (msg ${k})`);
    avzAssert.ok(m.data instanceof Float32Array, 'data は Float32Array');
    avzAssert.equal(m.data.length, m.count * R.LENGTH, `data 長 (msg ${k})`);
    if (k < rowMsgs.length - 1) avzAssert.equal(m.count, 256, `途中のメッセージは 256 行 (msg ${k})`);
    else avzAssert.ok(m.count >= 1 && m.count <= 256, '最後のメッセージの行数');
    for (let j = 0; j < m.data.length; j++) {
      const d = Math.abs(m.data[j] - direct.rows[expectStart * R.LENGTH + j]);
      if (d > maxDiff) maxDiff = d;
    }
    expectStart += m.count;
    total += m.count;
  }
  avzAssert.equal(total, direct.hops, '行数 = ホップ数');
  avzAssert.ok(maxDiff <= 1e-6, `行データ最大絶対差 ${maxDiff}`);
  return { rowMsgs: rowMsgs.length, hops: direct.hops, maxDiff: maxDiff, messages: messages.length };
}

avzTest('B18-01a', 'B18-01 行データ: ワークレット songmap の行が合成楽曲（128BPM・48kHz）の直接駆動と一致し、行数 = ホップ数', async function () {
  const signal = synthSong(48000, { bpm: 128 });
  const messages = await b18RunSongmap(signal);
  const r = b18Compare(messages, signal);
  avzAssert.ok(r.rowMsgs > 1, 'rows メッセージが複数（256 行ごとのバッチ）');
  console.log('B18-01a hops=' + r.hops + ' rowsMsgs=' + r.rowMsgs + ' maxDiff=' + r.maxDiff);
}, { timeoutMs: 180000 });

avzTest('B18-01b', 'B18-01 行データ: 256 行未満・端数サンプルの短い信号でも rows 1 通 + done', async function () {
  const base = sigDrumPattern(48000, 1, 120);
  const n = base.channels[0].length - 77; // ホップ境界に揃わない長さ
  const signal = { sampleRate: 48000, channels: [base.channels[0].subarray(0, n), base.channels[1].subarray(0, n)] };
  const messages = await b18RunSongmap(signal);
  const r = b18Compare(messages, signal);
  avzAssert.equal(r.rowMsgs, 1, 'rows は 1 通');
  avzAssert.equal(r.messages, 2, '全メッセージ数 = rows + done');
}, { timeoutMs: 30000 });
