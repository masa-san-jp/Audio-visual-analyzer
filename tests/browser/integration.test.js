// @page app
// 目的 — index.html に統合した GPU タイプ（g-fluid / g-gargantua / g-attractor）の動作確認 — doc/20261010-design-integration-v1.md §6。
// 実 GPU（CHROME_PATH=~/worktrees/avz-tools/chrome-gpu.sh --headed）で実行する。WebGL2 が無い環境では INT-02 以降が失敗する。
function intWav(signal) {
  const channels = signal.channels, frames = channels[0].length, align = channels.length * 4;
  const bytes = new Uint8Array(44 + frames * align), view = new DataView(bytes.buffer);
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true);
  ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, signal.sampleRate, true); view.setUint32(28, signal.sampleRate * align, true);
  view.setUint16(32, align, true); view.setUint16(34, 32, true);
  ascii(36, 'data'); view.setUint32(40, frames * align, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) for (const channel of channels) { view.setFloat32(offset, channel[i], true); offset += 4; }
  return bytes;
}
const intWait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function intUntil(predicate, timeoutMs = 120000, message = '状態変更がタイムアウトしました') {
  const deadline = performance.now() + timeoutMs;
  while (!predicate() && performance.now() < deadline) await intWait(25);
  avzAssert.ok(predicate(), message);
}
let intFile = null;
function intSong() {
  if (!intFile) intFile = new File([intWav(synthSong(48000, { bpm: 128, seed: 11 }))], 'int-128.wav', { type: 'audio/wav', lastModified: 41 });
  return intFile;
}
function intSelectType(id) {
  const select = document.getElementById('analyzer-type');
  select.value = id;
  select.dispatchEvent(new Event('change'));
}
// GPU canvas の描画内容を読む。preserveDrawingBuffer:false のため描画バッファはフレーム外で消えうるので、
// 同じタスク内で engine._draw() により再提示してから既定フレームバッファを 1 回 readPixels し、64×36 に間引いて RGB 平均を返す。
function intGpuPixelStats() {
  const COLS = 64, ROWS = 36;
  const engine = window.__app.worldBridge.engine;
  const gl = engine.gpu.gl;
  engine._draw();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let sum = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = Math.floor((col + .5) * width / COLS), y = Math.floor((row + .5) * height / ROWS);
      const i = (y * width + x) * 4;
      sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
    }
  }
  return { mean: sum / (COLS * ROWS * 3) };
}
async function intCleanup(app) {
  if (app.micInput.active) app.micInput.active = false;
  app.mediaManager.stop();
  intSelectType('bar');
  await intWait(50);
}
async function intLoadSong(app) {
  if (app.mediaManager.activeIndex !== 0) app.mediaManager.selectSlot(0);
  await app.ui._loadMediaFile(intSong(), 0);
}

avzGpuTest('INT-01', 'INT-01 GPU の 3 タイプが GPU グループに並び、選ぶと gpu-canvas に切り替わり、2D へ戻せる', async function () {
  const app = window.__app;
  try {
    const select = document.getElementById('analyzer-type');
    const group = Array.from(select.querySelectorAll('optgroup')).find(g => g.label === 'GPU');
    avzAssert.ok(group, 'GPU グループ');
    avzAssert.deepEqual(Array.from(group.children).map(o => o.value), ['g-fluid', 'g-gargantua', 'g-attractor']);
    avzAssert.equal(select.lastElementChild, group, 'GPU グループが最後');
    const gpu = document.getElementById('gpu-canvas'), main = document.getElementById('canvas');
    avzAssert.equal(gpu.hidden, true, '初期は非表示（WebGL 未作成）');
    avzAssert.equal(app.worldBridge.engine, null, '2D だけなら WebGL を作らない');
    for (const id of ['g-fluid', 'g-gargantua', 'g-attractor']) {
      intSelectType(id);
      avzAssert.equal(app.visualizer.settings.analyzerType, id);
      avzAssert.equal(gpu.hidden, false, id);
      avzAssert.equal(main.style.visibility === 'hidden' || getComputedStyle(main).visibility === 'hidden', true, id);
      avzAssert.ok(app.worldBridge.engine, id + ': 遅延初期化');
      avzAssert.equal(document.body.classList.contains('gpu-type'), true);
    }
    // 設定画面: 形状・色・感度・背景・動画合成が隠れ、アスペクト比・全画面・書き出しは残る
    for (const id of ['slider-bar-width', 'slider-density', 'slider-afterimage', 'slider-hue', 'slider-sensitivity', 'btn-bg-black']) {
      avzAssert.equal(document.getElementById(id).offsetParent, null, id + ' は隠れる');
    }
    for (const id of ['btn-16-9', 'btn-1-1', 'btn-fullscreen', 'btn-offline-start', 'offline-fps']) {
      avzAssert.ok(document.getElementById(id).offsetParent !== null, id + ' は表示');
    }
    // 2D へ戻す
    intSelectType('radial');
    avzAssert.equal(gpu.hidden, true);
    avzAssert.equal(getComputedStyle(main).visibility, 'visible');
    avzAssert.equal(document.body.classList.contains('gpu-type'), false);
    avzAssert.ok(document.getElementById('slider-hue').offsetParent !== null, '色の設定が元どおり表示される');
  } finally { await intCleanup(app); }
});

avzGpuTest('INT-02', 'INT-02 曲の読み込み後に GPU タイプが描画され、再生で画素が動く', async function () {
  const app = window.__app;
  try {
    await intLoadSong(app);
    intSelectType('g-fluid');
    await intUntil(() => app.worldBridge.ready, 120000, 'GPU 解析が完了しない');
    avzAssert.equal(document.getElementById('gpu-status').hidden, true, '解析表示は消える');
    document.getElementById('btn-play').click();
    await intUntil(() => app.mediaManager.isPlaying, 5000);
    await intWait(1500);
    const first = intGpuPixelStats();
    await intWait(1500);
    const second = intGpuPixelStats();
    avzAssert.ok(first.mean > 0 || second.mean > 0, 'GPU canvas に何かが描かれている');
    avzAssert.ok(app.worldBridge.engine.metrics().frameP95Ms >= 0, 'エンジンが毎フレーム呼ばれている');
    // 逆シーク（ループ）で巻き戻しても描画が続く
    app.mediaManager.mediaElement.currentTime = 0.5;
    await intWait(500);
    avzAssert.ok(intGpuPixelStats().mean >= 0);
    // 他の GPU タイプへ 0.5 秒のクロスフェードで切り替わる
    intSelectType('g-gargantua');
    avzAssert.equal(app.worldBridge.engine.type.id, 'g-gargantua');
  } finally { await intCleanup(app); }
}, { timeoutMs: 180000, slow: true });

avzGpuTest('INT-03', 'INT-03 準備前は黒＋「GPU 解析中…」を表示し、準備後に消える', async function () {
  const app = window.__app;
  try {
    await app.ui._loadMediaFile(intSong(), 0);
    app.worldBridge.invalidate();
    intSelectType('g-attractor');
    avzAssert.equal(document.getElementById('gpu-status').textContent, 'GPU 解析中…');
    await intUntil(() => app.worldBridge.ready, 120000);
    avzAssert.equal(document.getElementById('gpu-message').hidden, true);
  } finally { await intCleanup(app); }
}, { timeoutMs: 180000, slow: true });

avzGpuTest('INT-04', 'INT-04 GPU タイプ選択中の書き出しで mp4（または webm）が作れる', async function () {
  const app = window.__app;
  try {
    intSelectType('g-fluid');
    const exporter = app.worldBridge.exporter;
    const input = document.getElementById('offline-file-input');
    const transfer = new DataTransfer(); transfer.items.add(intSong()); input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
    document.getElementById('offline-fps').value = '30';
    document.getElementById('btn-offline-start').click();
    await intUntil(() => exporter.state === 'done', 900000, '書き出しが完了しない');
    avzAssert.ok(exporter.blob && exporter.blob.size > 0, 'blob');
    const head = new Uint8Array(await exporter.blob.slice(0, 12).arrayBuffer());
    const isMp4 = String.fromCharCode(...head.slice(4, 8)) === 'ftyp';
    const isWebm = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    avzAssert.ok(isMp4 || isWebm, 'コンテナ形式');
    avzAssert.equal(document.getElementById('btn-offline-save').disabled, false, '保存ボタンが有効');
  } finally { await intCleanup(app); }
}, { timeoutMs: 1000000, slow: true });

avzTest('INT-05', 'INT-05 マイク入力中は GPU タイプを選べない（option が disabled で理由を表示）', async function () {
  const app = window.__app;
  try {
    app.micInput.active = true;
    app.ui._updateGpuOptions();
    const select = document.getElementById('analyzer-type');
    for (const id of ['g-fluid', 'g-gargantua', 'g-attractor']) {
      const option = select.querySelector(`option[value="${id}"]`);
      avzAssert.equal(option.disabled, true, id);
      avzAssert.ok(option.title.length > 0, id + ' の理由');
    }
    avzAssert.equal(select.querySelector('option[value="bar"]').disabled, false);
    app.micInput.active = false;
    app.ui._updateGpuOptions();
    avzAssert.equal(select.querySelector('option[value="g-fluid"]').disabled, false);
  } finally { await intCleanup(app); }
});

avzTest('INT-06', 'INT-06 GPU タイプ選択中はディレクターの操作が無効になり注記が出る。2D へ戻すと戻る', async function () {
  const app = window.__app;
  try {
    const ids = ['director-enabled', 'director-intensity', 'director-pool', 'director-flash', 'director-shuffle'];
    intSelectType('g-gargantua');
    for (const id of ids) avzAssert.equal(document.getElementById(id).disabled, true, id);
    const note = document.getElementById('director-gpu-note');
    avzAssert.ok(note.offsetParent !== null, '注記が表示される');
    avzAssert.ok(note.textContent.includes('GPU タイプでは自動演出を使いません'));
    // ランダムは 2D だけから選ぶ
    for (let i = 0; i < 30; i++) {
      document.getElementById('btn-analyzer-randomize').click();
      avzAssert.ok(!app.visualizer.settings.analyzerType.startsWith('g-'), 'ランダムは GPU を選ばない');
      intSelectType('g-fluid');
    }
    intSelectType('bar');
    for (const id of ids) avzAssert.equal(document.getElementById(id).disabled, false, id);
    avzAssert.equal(note.offsetParent, null);
  } finally { await intCleanup(app); }
});

avzTest('INT-07', 'INT-07 プリセットに GPU タイプの ID を保存して復元できる', async function () {
  const app = window.__app;
  try {
    intSelectType('g-attractor');
    document.getElementById('preset-name').value = 'int-gpu';
    document.getElementById('btn-preset-save').click();
    intSelectType('bar');
    const select = document.getElementById('preset-select');
    select.value = 'int-gpu';
    document.getElementById('btn-preset-load').click();
    avzAssert.equal(app.visualizer.settings.analyzerType, 'g-attractor');
    avzAssert.equal(document.getElementById('analyzer-type').value, 'g-attractor');
    avzAssert.equal(document.body.classList.contains('gpu-type'), true);
  } finally {
    const presetSelect = document.getElementById('preset-select');
    presetSelect.value = 'int-gpu';
    document.getElementById('btn-preset-delete').click();
    await intCleanup(app);
  }
});
