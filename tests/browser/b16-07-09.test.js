// @page app
// 目的 — 音量自動補正・レイヤー分割の設定と UI を確認する（計画書 §9.2 B16-07・B16-09、§7）。

function b1607Wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function b1607WaitFor(predicate, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return true;
    await b1607Wait(25);
  }
  return predicate();
}

// UI のチェックボックス操作で autoGain を切り替える（ユーザー操作と同じ経路）
function b1607SetAutoGain(on) {
  const chk = document.getElementById('chk-auto-gain');
  chk.checked = on;
  chk.dispatchEvent(new Event('change'));
}

avzTest('B16-07', 'B16-07 音量自動補正: -30 / -10 LUFS の同一ドラムの lastFreq 平均値の差が、OFF に比べ ON で 70% 以上縮小', async function () {
  const app = window.__app;
  const engine = app.audioEngine;
  const mediaManager = app.mediaManager;
  const base = sigDrumPattern(48000, 12, 120);
  const files = {
    quiet: new File([encodeWav16(sigScaleToLufs(base, -30))], 'b16-07-m30.wav', { type: 'audio/wav' }),
    loud: new File([encodeWav16(sigScaleToLufs(base, -10))], 'b16-07-m10.wav', { type: 'audio/wav' }),
  };

  // 10 秒時点（9.5〜10 秒の 500ms 間）の lastFreq 全ビン平均をフレームごとに求めて平均する
  const measure = async (file, autoGain) => {
    b1607SetAutoGain(autoGain);
    await app.ui._loadMediaFile(file);
    avzAssert.ok(mediaManager.isLoaded, 'WAV が読み込まれていません');
    app.visualizer.start();
    document.getElementById('btn-play').click();
    avzAssert.ok(await b1607WaitFor(() => mediaManager.isPlaying, 3000), '再生状態になりませんでした');
    avzAssert.ok(await b1607WaitFor(() => engine.mfsStatus === 'active', 5000), 'mfsStatus が active になりません');
    const el = mediaManager.mediaElement;
    avzAssert.ok(await b1607WaitFor(() => el.currentTime >= 9.5, 20000), '9.5 秒に達しませんでした');
    let sum = 0;
    let n = 0;
    while (el.currentTime < 10) {
      const freq = app.visualizer.pipeline.lastFreq;
      if (freq) {
        let s = 0;
        for (let i = 0; i < freq.length; i++) s += freq[i];
        sum += s / freq.length;
        n++;
      }
      await b1607Wait(16);
    }
    mediaManager.stop();
    avzAssert.ok(n >= 10, `lastFreq のサンプル数が少なすぎます (${n})`);
    return sum / n;
  };

  try {
    const offQuiet = await measure(files.quiet, false);
    const offLoud = await measure(files.loud, false);
    const onQuiet = await measure(files.quiet, true);
    const onLoud = await measure(files.loud, true);
    const diffOff = Math.abs(offLoud - offQuiet);
    const diffOn = Math.abs(onLoud - onQuiet);
    window.__b1607 = { offQuiet, offLoud, onQuiet, onLoud, diffOff, diffOn, reduction: 1 - diffOn / diffOff };
    avzAssert.ok(diffOff > 5, `OFF 時に差が出ていません (${diffOff})`);
    avzAssert.ok(diffOn <= diffOff * 0.3, `ON 時の差が 70% 以上縮小していません (OFF ${diffOff}, ON ${diffOn})`);
  } finally {
    b1607SetAutoGain(false);
    mediaManager.stop();
    app.visualizer.stop();
  }
}, { slow: true, timeoutMs: 120000 });

avzTest('B16-09', 'B16-09 設定の往復: autoGain・layerSplit がプリセット・JSON で保持され、旧形式 JSON は既定値になる', async function () {
  const app = window.__app;
  const ui = app.ui;
  const settingsOf = () => app.visualizer.settings;
  const presetName = 'b16-09-preset';
  const status = () => document.getElementById('preset-status').textContent;

  // 既定値
  const defaults = createDefaultSettings();
  avzAssert.equal(defaults.autoGain, false, '既定 autoGain');
  avzAssert.equal(defaults.layerSplit, 'linear', '既定 layerSplit');

  try {
    // layers 対応タイプ・layerCount 2 でレイヤー分割セレクトが表示される / 条件外では非表示
    const typeSelect = document.getElementById('analyzer-type');
    const splitGroup = document.getElementById('group-layer-split');
    typeSelect.value = 'bar';
    typeSelect.dispatchEvent(new Event('change'));
    document.getElementById('btn-layer-1').click();
    avzAssert.equal(splitGroup.style.display, 'none', 'layerCount 1 では非表示');
    document.getElementById('btn-layer-2').click();
    avzAssert.equal(splitGroup.style.display, '', 'layers 対応かつ layerCount 2 で表示');

    // UI 操作 → settings
    b1607SetAutoGain(true);
    const sel = document.getElementById('layer-split');
    sel.value = 'mel';
    sel.dispatchEvent(new Event('change'));
    avzAssert.equal(settingsOf().autoGain, true, 'UI → autoGain');
    avzAssert.equal(settingsOf().layerSplit, 'mel', 'UI → layerSplit');

    // アナライザーランダムは 2 項目を変えない
    document.getElementById('btn-analyzer-randomize').click();
    avzAssert.equal(settingsOf().autoGain, true, 'ランダム後も autoGain');
    avzAssert.equal(settingsOf().layerSplit, 'mel', 'ランダム後も layerSplit');

    // プリセット保存 → 既定へ戻す → 読込
    document.getElementById('preset-name').value = presetName;
    document.getElementById('btn-preset-save').click();
    avzAssert.ok(status().includes('保存しました'), `プリセット保存: ${status()}`);
    b1607SetAutoGain(false);
    sel.value = 'linear';
    sel.dispatchEvent(new Event('change'));
    avzAssert.equal(settingsOf().autoGain, false);
    document.getElementById('preset-select').value = presetName;
    document.getElementById('btn-preset-load').click();
    avzAssert.equal(settingsOf().autoGain, true, 'プリセット読込後 autoGain');
    avzAssert.equal(settingsOf().layerSplit, 'mel', 'プリセット読込後 layerSplit');
    avzAssert.equal(document.getElementById('chk-auto-gain').checked, true, 'プリセット読込後 UI チェックボックス');
    avzAssert.equal(document.getElementById('layer-split').value, 'mel', 'プリセット読込後 UI セレクト');

    // JSON 書き出し（ダウンロードは捕捉して止める）
    const originalCreate = URL.createObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    let blob = null;
    URL.createObjectURL = function (b) { blob = b; return 'blob:b16-09'; };
    HTMLAnchorElement.prototype.click = function () {};
    try {
      document.getElementById('btn-settings-export').click();
    } finally {
      URL.createObjectURL = originalCreate;
      HTMLAnchorElement.prototype.click = originalClick;
    }
    avzAssert.ok(blob, 'JSON 書き出しの Blob が得られません');
    const exported = JSON.parse(await blob.text());
    avzAssert.equal(exported.settings.autoGain, true, '書き出し JSON の autoGain');
    avzAssert.equal(exported.settings.layerSplit, 'mel', '書き出し JSON の layerSplit');

    // JSON 読込（現状を既定へ戻してから、書き出した JSON を読み込む）
    b1607SetAutoGain(false);
    sel.value = 'linear';
    sel.dispatchEvent(new Event('change'));
    const importInput = document.getElementById('settings-import-input');
    const loadJson = async (obj) => {
      const dt = new DataTransfer();
      dt.items.add(new File([JSON.stringify(obj)], 'settings.json', { type: 'application/json' }));
      importInput.files = dt.files;
      importInput.dispatchEvent(new Event('change'));
      avzAssert.ok(await b1607WaitFor(() => status().includes('JSONから設定を読み込みました'), 3000), `JSON 読込: ${status()}`);
    };
    document.getElementById('preset-status').textContent = '';
    await loadJson(exported);
    avzAssert.equal(settingsOf().autoGain, true, 'JSON 読込後 autoGain');
    avzAssert.equal(settingsOf().layerSplit, 'mel', 'JSON 読込後 layerSplit');
    avzAssert.equal(document.getElementById('chk-auto-gain').checked, true, 'JSON 読込後 UI チェックボックス');

    // 旧形式 JSON（2 項目なし）は既定値になる
    const legacy = JSON.parse(JSON.stringify(exported));
    delete legacy.settings.autoGain;
    delete legacy.settings.layerSplit;
    document.getElementById('preset-status').textContent = '';
    await loadJson(legacy);
    avzAssert.equal(settingsOf().autoGain, false, '旧形式 JSON の autoGain は既定値');
    avzAssert.equal(settingsOf().layerSplit, 'linear', '旧形式 JSON の layerSplit は既定値');
    avzAssert.equal(document.getElementById('chk-auto-gain').checked, false, '旧形式 JSON 読込後 UI チェックボックス');
    avzAssert.equal(document.getElementById('layer-split').value, 'linear', '旧形式 JSON 読込後 UI セレクト');
  } finally {
    deletePreset(presetName);
    settingsOf().autoGain = false;
    settingsOf().layerSplit = 'linear';
  }
}, { timeoutMs: 30000 });
