// @page app
// 目的 — ライブ経路（AudioWorklet MFS・フォールバック・解析リセット）をアプリ上で確認する（計画書 §9.2 B16-02〜B16-04、§6.2）。
// B16-03 は「以後このページでは戻らない」フォールバックを共有ページの AudioEngine に残さないよう、新しい AudioEngine / VisualizerCore で行う。

function b16LiveWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function b16LiveWaitFor(predicate, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return true;
    await b16LiveWait(25);
  }
  return predicate();
}

function b16LiveWavFile(name, sec) {
  return new File([encodeWav16(sigDrumPattern(48000, sec, 120))], name, { type: 'audio/wav' });
}

avzTest('B16-02', 'B16-02 120BPM ドラム再生（実時間12秒）で mfsStatus が active、10秒以降の BPM が 120 ± 1.5%', async function () {
  const app = window.__app;
  const engine = app.audioEngine;
  const mediaManager = app.mediaManager;
  try {
    await app.ui._loadMediaFile(b16LiveWavFile('b16-02-drum.wav', 14));
    avzAssert.ok(mediaManager.isLoaded, 'WAV が読み込まれていません');
    document.getElementById('btn-play').click();
    avzAssert.ok(await b16LiveWaitFor(() => mediaManager.isPlaying, 3000), '再生状態になりませんでした');
    avzAssert.ok(await b16LiveWaitFor(() => engine.mfsStatus !== 'initializing', 5000), 'MFS 初期化が完了しません');
    avzAssert.equal(engine.mfsStatus, 'active', 'mfsStatus');

    const el = mediaManager.mediaElement;
    avzAssert.ok(await b16LiveWaitFor(() => el.currentTime >= 10, 15000), '10 秒に達しませんでした');
    const samples = [];
    while (el.currentTime < 12) {
      const f = engine.getFeatures();
      if (f) samples.push(f.tempo.bpm);
      await b16LiveWait(100);
    }
    avzAssert.equal(engine.mfsStatus, 'active', '再生中に mfsStatus が変わりました');
    avzAssert.ok(samples.length >= 10, `10〜12 秒の BPM サンプルが少なすぎます (${samples.length})`);
    for (const bpm of samples) {
      avzAssert.close(bpm, 120, 120 * 0.015, 'tempo.bpm');
    }
    const info = engine.getMfsDebugInfo();
    avzAssert.ok(info.hopsPerSec > 80 && info.hopsPerSec < 110, `受信ホップ数/秒 ${info.hopsPerSec}`);
    window.__b1602 = { samples: samples.length, bpmMin: Math.min(...samples), bpmMax: Math.max(...samples), hopsPerSec: info.hopsPerSec };
  } finally {
    mediaManager.stop();
    app.visualizer.stop();
  }
}, { slow: true, timeoutMs: 60000 });

avzTest('B16-02f', 'B16-02f フラグ集約: 描画間のオンセット/拍フラグを OR し、同じホップの再選択では 0（二重発火なし）', async function () {
  const engine = new AudioEngine();
  engine._ensureContext();
  try {
    avzAssert.ok(await b16LiveWaitFor(() => engine.mfsStatus === 'active', 5000), 'MFS が active になりません');
    const LY = MFS_LAYOUT;
    const message = (hop, onset, beat, down) => {
      const f = new Float32Array(LY.LENGTH);
      f[LY.ONSET_FLAGS] = onset;
      f[LY.BEAT_FLAG] = beat;
      f[LY.DOWNBEAT_FLAG] = down;
      f[LY.BPM] = 100 + hop;
      return { type: 'hop', hop, t: hop * 0.01, f, freq: new Uint8Array(1024).fill(hop), time: new Uint8Array(2048).fill(100 + hop) };
    };
    for (let h = 0; h < 12; h++) {
      engine._onMfsMessage(message(h, h === 3 ? 1 : h === 4 ? 2 : h === 9 ? 8 : 0, h === 5 ? 1 : 0, h === 6 ? 1 : 0));
    }
    // 実コンテキストの代わりに、出力時刻を固定するスタブを使う（t ≤ target の選択を決定的に検証する）
    let contextTime = 0.035;
    engine.ctx = { state: 'suspended', currentTime: 0, getOutputTimestamp: () => ({ contextTime, performanceTime: 1000 }) };
    avzAssert.equal(engine.getFeatures(), null, '選択前は features が null');

    engine._captureMfs(1000);                       // target 0.035 → hop 3
    let f = engine.getFeatures();
    avzAssert.ok(f !== null, '選択後は features あり');
    avzAssert.equal(f.tempo.bpm, 103, 'hop 3 が選ばれる');
    avzAssert.equal(f.onset.flags, 1, 'hop 0..3 の OR = 1');
    avzAssert.equal(engine.getFreqSlice()[0], 3, 'freq は選択ホップのもの');
    avzAssert.equal(engine.getTimeDomainData()[0], 103, 'time は選択ホップのもの');

    contextTime = 0.075;                            // → hop 7（4..7: onset 2、beat 5、downbeat 6）
    engine._captureMfs(1000);
    avzAssert.equal(f.tempo.bpm, 107, 'hop 7 が選ばれる');
    avzAssert.equal(f.onset.flags, 2, 'hop 4..7 の onset OR');
    avzAssert.ok(f.tempo.beatFlag, 'hop 5 の拍が集約される');
    avzAssert.ok(f.tempo.downbeatFlag, 'hop 6 の小節頭が集約される');

    engine._captureMfs(1000);                       // 同じホップの再選択
    avzAssert.equal(f.onset.flags, 0, '同じホップでは onset フラグ 0');
    avzAssert.ok(!f.tempo.beatFlag && !f.tempo.downbeatFlag, '同じホップでは拍フラグ 0');

    contextTime = 0.2;                              // → hop 11（8..11: onset 8）
    engine._captureMfs(1000);
    avzAssert.equal(f.onset.flags, 8, 'hop 8..11 の onset OR（取りこぼしなし）');
    avzAssert.ok(!f.tempo.beatFlag, '拍は二重発火しない');
    // リング内の packed は書き換えない
    avzAssert.equal(engine._ring.find((e) => e && e.hop === 5).f[LY.BEAT_FLAG], 1, 'リング内の packed は不変');

    // resetAnalysis でリング・選択をクリア（全 0 / 128）
    engine.resetAnalysis();
    avzAssert.equal(engine.getFeatures(), null, 'リセット後は features が null');
    avzAssert.equal(engine.getFreqSlice()[0], 0, 'リセット後の freq は 0');
    avzAssert.equal(engine.getTimeDomainData()[0], 128, 'リセット後の time は 128');
    // ホップ番号が戻ったら（未着メッセージの後に reset 後のホップが来た場合）リングを捨てる
    engine._onMfsMessage(message(500, 0, 0, 0));
    engine._onMfsMessage(message(0, 0, 0, 0));
    avzAssert.equal(engine.getMfsDebugInfo().lastHop, 0, 'ホップ番号が戻ったら 0 から数え直す');
    avzAssert.equal(engine._ring.filter(Boolean).length, 1, '戻る前のホップはリングから消える');
  } finally {
    if (engine.ctx && engine.ctx.close) { try { engine.ctx.close(); } catch (_) {} }
  }
});

avzTest('B16-02m', 'B16-02m マイク入力（フェイクデバイス）でも MFS が active でホップが届く', async function () {
  const app = window.__app;
  const engine = app.audioEngine;
  try {
    avzAssert.ok(await b16LiveWaitFor(() => engine.mfsStatus !== 'initializing', 5000), 'MFS 初期化が完了しません');
    avzAssert.equal(engine.mfsStatus, 'active', 'mfsStatus');
    await app.micInput.start();
    avzAssert.ok(app.micInput.active, 'マイクが開始されていません');
    app.visualizer.start();
    const before = engine.getMfsDebugInfo().lastHop;
    await b16LiveWait(1200);
    const info = engine.getMfsDebugInfo();
    avzAssert.equal(info.status, 'active', 'mfsStatus（マイク接続後）');
    avzAssert.ok(info.lastHop >= 0 && info.lastHop < 400, `マイク接続でホップが 0 から数え直される (lastHop ${info.lastHop}, 直前 ${before})`);
    avzAssert.ok(info.lastHop > 50, `マイク入力のホップが届く (lastHop ${info.lastHop})`);
    avzAssert.ok(engine.getFeatures() !== null, 'features が得られる');
  } finally {
    app.micInput.stop();
    app.visualizer.stop();
  }
}, { timeoutMs: 30000 });

avzTest('B16-03', 'B16-03 __avzForceMfsFailure でフォールバック: features null・全14タイプ描画・コンソールエラー 0', async function () {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = function () { warnings.push(Array.prototype.join.call(arguments, ' ')); };
  window.__avzForceMfsFailure = true;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px;';
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  document.body.appendChild(host);
  const engine = new AudioEngine();
  const visualizer = new VisualizerCore(canvas, engine);
  const audio = document.createElement('audio');
  const url = URL.createObjectURL(b16LiveWavFile('b16-03-drum.wav', 12));
  try {
    visualizer.resize();
    audio.src = url;
    await new Promise((resolve, reject) => {
      audio.addEventListener('canplay', resolve, { once: true });
      audio.addEventListener('error', () => reject(new Error('WAV 読込失敗')), { once: true });
    });
    engine.connectMedia(audio);
    await engine.resume();
    visualizer.start();
    await audio.play();
    avzAssert.equal(engine.mfsStatus, 'fallback', 'mfsStatus');
    avzAssert.ok(warnings.some((w) => w.includes('フォールバック')), 'フォールバック理由が console.warn に出ていません');
    const types = Array.from(document.getElementById('analyzer-type').options).map((o) => o.value);
    avzAssert.equal(types.length, 14, 'アナライザータイプ数');
    let frames = 0;
    for (const type of types) {
      visualizer.settings.analyzerType = type;
      await b16LiveWait(250);
      avzAssert.equal(visualizer._activeType, type, `${type} の描画反映`);
      avzAssert.equal(engine.getFeatures(), null, `${type}: features が null`);
      const freq = engine.getFreqSlice();
      avzAssert.ok(freq && freq.length > 0, `${type}: AnalyserNode 経路の freq`);
      frames++;
    }
    avzAssert.equal(frames, 14, '描画したタイプ数');
    avzAssert.equal(engine.mfsStatus, 'fallback', '再生後も fallback');
    // AnalyserNode 経路が実際に音を拾っている
    let nonZero = 0;
    for (let i = 0; i < 20; i++) {
      engine.captureFrame(performance.now());
      const f = engine.getFreqSlice();
      for (let k = 0; k < f.length; k++) if (f[k] > 0) { nonZero++; break; }
      await b16LiveWait(30);
    }
    avzAssert.ok(nonZero > 0, 'フォールバック経路の freq が常に 0 です');
  } finally {
    window.__avzForceMfsFailure = false;
    console.warn = originalWarn;
    visualizer.stop();
    audio.pause();
    URL.revokeObjectURL(url);
    host.remove();
    if (engine.ctx) { try { engine.ctx.close(); } catch (_) {} }
  }
}, { slow: true, timeoutMs: 60000 });

avzTest('B16-04', 'B16-04 再生中のシーク・スロット切替・停止の 200ms 後に lastHop が 30 以下へ戻る', async function () {
  const app = window.__app;
  const engine = app.audioEngine;
  const mediaManager = app.mediaManager;
  const lastHop = () => engine.getMfsDebugInfo().lastHop;
  try {
    await app.ui._loadMediaFile(b16LiveWavFile('b16-04-a.wav', 30), 0);
    await app.ui._loadMediaFile(b16LiveWavFile('b16-04-b.wav', 30), 1);
    mediaManager.selectSlot(0);
    app.ui._applyActiveSlot();
    avzAssert.ok(mediaManager.isLoaded, 'WAV が読み込まれていません');
    document.getElementById('btn-play').click();
    avzAssert.ok(await b16LiveWaitFor(() => mediaManager.isPlaying, 3000), '再生状態になりませんでした');
    avzAssert.ok(await b16LiveWaitFor(() => engine.mfsStatus === 'active', 5000), 'mfsStatus が active になりません');

    const results = {};
    const check = async (label, operation) => {
      // 十分にホップが積まれてから操作する
      avzAssert.ok(await b16LiveWaitFor(() => lastHop() > 100, 5000), `${label}: 操作前にホップが 100 を超えません`);
      const before = lastHop();
      operation();
      await b16LiveWait(200);
      const after = lastHop();
      results[label] = { before, after };
      avzAssert.ok(after < before, `${label}: lastHop が減っていません (前 ${before} 後 ${after})`);
      avzAssert.ok(after <= 30, `${label}: lastHop が 30 を超えています (${after})`);
      avzAssert.equal(engine.mfsStatus, 'active', `${label}: mfsStatus`);
    };

    // シーク（シークバー input）
    await check('シーク', () => {
      const seekBar = document.getElementById('seek-bar');
      seekBar.value = 500;
      seekBar.dispatchEvent(new Event('input'));
    });
    // スロット切替（スロット 1 を選択。再生は継続）
    await check('スロット切替', () => {
      document.querySelector('#slot-list .slot-row[data-slot="1"] .slot-select').click();
    });
    avzAssert.equal(mediaManager.activeIndex, 1, 'アクティブスロットが 1 になっていません');
    // 停止
    await check('停止', () => {
      document.getElementById('btn-stop').click();
    });
    window.__b1604 = results;
  } finally {
    mediaManager.selectSlot(0);
    mediaManager.stop();
    app.visualizer.stop();
  }
}, { slow: true, timeoutMs: 60000 });
