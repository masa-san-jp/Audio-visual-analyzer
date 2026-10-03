// @page app
// 目的 — 全曲解析・シーク・マイク・非対応環境のライブUIを確認する — Phase 18 計画書 §8.3 B18-02・B18-05〜07。
// B18-01と同じ32bit float WAVで、合成PCMを量子化せずに渡す。
function b18LiveWav(signal) {
  const channels = signal.channels, frames = channels[0].length, align = channels.length * 4;
  const bytes = new Uint8Array(44 + frames * align), view = new DataView(bytes.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true);
  ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, signal.sampleRate, true); view.setUint32(28, signal.sampleRate * align, true);
  view.setUint16(32, align, true); view.setUint16(34, 32, true);
  ascii(36, 'data'); view.setUint32(40, frames * align, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) { view.setFloat32(offset, channel[i], true); offset += 4; }
  }
  return bytes;
}
const b18LiveWait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function b18LiveUntil(predicate, timeoutMs = 120000) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate() && performance.now() < deadline) await b18LiveWait(25);
  avzAssert.ok(predicate(), '状態変更がタイムアウトしました');
}
let b18LiveFile = null;
function b18LiveSong() {
  if (!b18LiveFile) b18LiveFile = new File([b18LiveWav(synthSong(48000, { bpm: 128, seed: 11 }))],
    'b18-live-128.wav', { type: 'audio/wav', lastModified: 18 });
  return b18LiveFile;
}
function b18LiveEnabled(app, enabled) {
  const checkbox = document.getElementById('director-enabled');
  checkbox.checked = enabled;
  checkbox.dispatchEvent(new Event('change'));
}
async function b18LiveReady(app) {
  if (app.mediaManager.activeIndex !== 0) app.mediaManager.selectSlot(0);
  await app.ui._loadMediaFile(b18LiveSong(), 0);
  b18LiveEnabled(app, true);
  await b18LiveUntil(() => app.visualizer.director.status === 'ready');
}
function b18LiveCleanup(app) {
  if (app.micInput.active) app.ui._stopMic(document.getElementById('btn-mic'), document.getElementById('file-name'));
  app.mediaManager.stop(); app.visualizer.stop();
  b18LiveEnabled(app, false);
}

avzTest('B18-02', 'B18-02 合成曲をスロット1へ読込・ONで再生: 準備完了・6セクション・操作保護・OFF復帰', async function () {
  const app = window.__app;
  try {
    await b18LiveReady(app);
    const director = app.visualizer.director;
    avzAssert.equal(director.status, 'ready');
    avzAssert.equal(document.getElementById('director-status').textContent, '128 BPM・6 セクション');
    const strip = document.getElementById('section-strip');
    avzAssert.equal(strip.children.length, 6);
    avzAssert.equal(strip.hidden, false);
    avzAssert.equal(getComputedStyle(strip).height, '3px');
    for (let i = 0; i < 6; i++) avzAssert.close(parseFloat(strip.children[i].style.width),
      (director.songMap.sections[i].endSec - director.songMap.sections[i].startSec) / director.songMap.durationSec * 100,
      0.01, 'セクションの比例幅（CSS の % は小数第3位で丸められる）');
    const ids = ['analyzer-type', 'expression-method', 'bar-display-mode', 'btn-layer-1', 'btn-layer-2',
      'btn-layer-3', 'btn-layer-4', 'slider-motion', 'slider-particles', 'slider-afterimage',
      'btn-analyzer-randomize', 'btn-shape-randomize'];
    for (const id of ids) {
      avzAssert.equal(document.getElementById(id).disabled, true, id);
      avzAssert.equal(document.getElementById(id).title, '自動演出中', id);
    }
    avzAssert.equal(document.getElementById('slider-hue').disabled, false, '色の操作は利用可');
    document.getElementById('btn-play').click();
    await b18LiveUntil(() => app.mediaManager.isPlaying, 3000);
    await b18LiveWait(250);
    avzAssert.ok(director.state.primary.sceneId, '自動演出の描画');
    b18LiveEnabled(app, false);
    avzAssert.equal(document.getElementById('director-status').textContent, '');
    avzAssert.equal(strip.hidden, true);
    for (const id of ids) {
      avzAssert.equal(document.getElementById(id).disabled, false, id + ' OFF復帰');
      avzAssert.equal(document.getElementById(id).hasAttribute('title'), false);
    }
    const s = app.visualizer.settings;
    const keys = ['directorEnabled', 'directorIntensity', 'directorPool', 'directorFlash', 'directorSeedOffset'];
    const before = keys.map(key => s[key]);
    for (const id of ['btn-analyzer-randomize', 'btn-hue-randomize', 'btn-shape-randomize']) {
      document.getElementById(id).click();
      avzAssert.deepEqual(keys.map(key => s[key]), before, 'ランダムはdirector設定を維持');
    }
    console.log('B18-02 status=ready sections=6 managedControls=' + ids.length + ' consoleErrors=0（runner確認）');
  } finally { b18LiveCleanup(app); }
}, { timeoutMs: 150000 });

avzTest('B18-05', 'B18-05 再生中に最初のdrop中央へシーク: 次フレームのsceneIdが一致', async function () {
  const app = window.__app;
  try {
    await b18LiveReady(app);
    document.getElementById('btn-play').click();
    await b18LiveUntil(() => app.mediaManager.isPlaying, 3000);
    const director = app.visualizer.director;
    const segment = director.timeline.segments.find(s => s.kind === 'drop');
    const midpoint = (segment.startSec + segment.endSec) / 2;
    const seen = new Promise(resolve => {
      const original = director.render;
      director.render = function (input, settings, t) {
        original.call(this, input, settings, t);
        director.render = original;
        resolve({ sceneId: this.state.primary.sceneId, t });
      };
    });
    const seek = document.getElementById('seek-bar');
    seek.value = Math.round(midpoint / app.mediaManager.mediaElement.duration * 1000);
    seek.dispatchEvent(new Event('input'));
    const nextFrame = await seen;
    avzAssert.equal(nextFrame.sceneId, segment.sceneId);
    avzAssert.ok(nextFrame.t > segment.startSec && nextFrame.t < segment.endSec);
    console.log('B18-05 sceneId=' + nextFrame.sceneId + ' seekSec=' + nextFrame.t);
  } finally { b18LiveCleanup(app); }
}, { timeoutMs: 150000 });

avzTest('B18-06', 'B18-06 フェイクマイク入力でON: 利用不可表示・通常描画継続・終了後復帰', async function () {
  const app = window.__app;
  const pipeline = app.visualizer.pipeline;
  const original = pipeline.render;
  let frames = 0;
  try {
    await b18LiveReady(app);
    pipeline.render = function (input, settings) { frames++; return original.call(this, input, settings); };
    document.getElementById('btn-mic').click();
    await b18LiveUntil(() => app.micInput.active && app.visualizer.mediaElement === null, 10000);
    avzAssert.equal(document.getElementById('director-status').textContent, 'マイク入力では利用できません');
    await b18LiveWait(300);
    avzAssert.ok(frames > 0, '通常描画が継続');
    document.getElementById('btn-mic').click();
    avzAssert.equal(app.visualizer.mediaElement, app.mediaManager.mediaElement);
    avzAssert.equal(app.visualizer.director.status, 'ready');
    console.log('B18-06 normalFrames=' + frames + ' restoredStatus=ready');
  } finally { pipeline.render = original; b18LiveCleanup(app); }
}, { timeoutMs: 150000 });

avzTest('B18-07', 'B18-07 MFS起動前に__avzForceMfsFailure=true: 非対応表示・コンソールエラー0', async function () {
  // 永続fallbackを共有ページに残さないよう、実アプリを別frameで起動する。
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:640px;height:360px;';
  const errors = [];
  document.body.appendChild(frame);
  frame.src = new URL('index.html', location.href).href;
  let app;
  try {
    await b18LiveUntil(() => frame.contentWindow.__app, 10000);
    const win = frame.contentWindow, doc = frame.contentDocument;
    win.addEventListener('error', e => errors.push(e.message));
    win.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
    win.console.error = (...args) => errors.push(args.join(' '));
    app = win.__app;
    avzAssert.equal(app.audioEngine.ctx, null, 'MFSをまだ起動していない');
    win.__avzForceMfsFailure = true;
    const enabled = doc.getElementById('director-enabled');
    enabled.checked = true; enabled.dispatchEvent(new win.Event('change'));
    await app.ui._loadMediaFile(b18LiveSong(), 0);
    await b18LiveUntil(() => app.visualizer.director.status === 'unavailable', 10000);
    avzAssert.equal(app.audioEngine.mfsStatus, 'fallback');
    avzAssert.equal(doc.getElementById('director-status').textContent, 'この環境では利用できません');
    doc.getElementById('btn-play').click();
    await b18LiveWait(300);
    avzAssert.equal(app.visualizer._activeType, app.visualizer.settings.analyzerType);
    avzAssert.equal(errors.length, 0, '子frameのコンソールエラー');
    console.log('B18-07 status=unavailable mfs=fallback consoleErrors=' + errors.length);
  } finally {
    if (app) {
      app.mediaManager.stop(); app.visualizer.stop(); app.visualizer.director.dispose();
      if (app.audioEngine.ctx) await app.audioEngine.ctx.close();
    }
    frame.remove();
  }
}, { timeoutMs: 30000 });
