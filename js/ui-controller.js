class UIController {
  constructor(visualizer, mediaManager, audioEngine, recorder, micInput) {
    this.visualizer = visualizer;
    this.mediaManager = mediaManager;
    this.audioEngine = audioEngine;
    this.recorder = recorder;
    this.micInput = micInput || new MicInputManager(audioEngine);
    this.mode = 'play'; // 'play' | 'rec'
    this._lastFileName = '未選択';
  }

  init() {
    this._initMode();
    this._initFile();
    this._initPlayback();
    this._initRecording();
    this._initOfflineExport();
    this._initPresets();
    this._initAspectRatio();
    this._initFullscreen();
    this._initAnalyzer();
    this._initColorControls();
    this._initShapeControls();
    this._initKeyboardShortcuts();
    window.addEventListener('resize', () => this.visualizer.resize());
  }

  // ── モード切替 ──

  _initMode() {
    const btnPlay = document.getElementById('btn-mode-play');
    const btnRec  = document.getElementById('btn-mode-rec');
    const recControls = document.getElementById('rec-controls');

    btnPlay.addEventListener('click', () => {
      // UI を先に更新してモード切替を確実に完了させる
      this.mode = 'play';
      btnPlay.classList.add('active');
      btnRec.classList.remove('active');
      recControls.style.display = 'none';
      // 録画中だった場合は停止する
      if (this.recorder && this.recorder.state === 'recording') {
        this.recorder.stop();
        this.mediaManager.pause();
      }
    });

    btnRec.addEventListener('click', () => {
      this.mode = 'rec';
      btnRec.classList.add('active');
      btnPlay.classList.remove('active');
      recControls.style.display = '';
      this._updateRecButtons();
    });
  }

  // ── ファイル ──

  _initFile() {
    const btnFile = document.getElementById('btn-file');
    const fileInput = document.getElementById('file-input');
    const fileNameEl = document.getElementById('file-name');
    const btnMic = document.getElementById('btn-mic');

    // onEnded を一度だけ設定する（loadFile より先に設定することで
    // canplay 時点で ended リスナーが確実に登録されるようにする）
    this.mediaManager.onEnded = () => this._onEnded();

    btnFile.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // マイク入力中にファイルを選んだ場合はマイクを停止して切り替える
      if (this.micInput.active) this._stopMic(btnMic, fileNameEl);
      fileNameEl.textContent = '読み込み中…';
      try {
        await this.mediaManager.loadFile(file);
        fileNameEl.textContent = file.name;
        this._lastFileName = file.name;
        this._setPlaybackEnabled(true);
        this._updateRecButtons();
      } catch (err) {
        fileNameEl.textContent = 'エラー: ' + err.message;
        this._lastFileName = 'エラー: ' + err.message;
        this._setPlaybackEnabled(false);
        this._updateRecButtons();
      }
      fileInput.value = '';
    });

    // マイク入力トグル
    btnMic.addEventListener('click', async () => {
      if (this.micInput.active) {
        this._stopMic(btnMic, fileNameEl);
        return;
      }
      btnMic.disabled = true;
      try {
        await this.micInput.start();
        btnMic.classList.add('active');
        btnMic.textContent = 'マイク入力停止';
        fileNameEl.textContent = 'マイク入力中';
        this._setPlaybackEnabled(false);
        this.visualizer.start();
      } catch (err) {
        fileNameEl.textContent = 'エラー: ' + err.message;
      } finally {
        btnMic.disabled = false;
        this._updateRecButtons();
      }
    });
  }

  _stopMic(btnMic, fileNameEl) {
    this.micInput.stop();
    btnMic.classList.remove('active');
    btnMic.textContent = 'マイク入力';
    fileNameEl.textContent = this._lastFileName;
    this._setPlaybackEnabled(this.mediaManager.isLoaded);
    this._updateRecButtons();
  }

  // ── 再生制御 ──

  _initPlayback() {
    document.getElementById('btn-play').addEventListener('click', () => {
      this.mediaManager.play();
      this.visualizer.start();
    });

    document.getElementById('btn-pause').addEventListener('click', () => {
      this.mediaManager.pause();
    });

    document.getElementById('btn-stop').addEventListener('click', () => {
      this.mediaManager.stop();
      this.visualizer.stop();
    });
  }

  // ── 録画制御 ──

  _initRecording() {
    const btnStart = document.getElementById('btn-rec-start');
    const btnStop  = document.getElementById('btn-rec-stop');
    const btnSave  = document.getElementById('btn-rec-save');
    const btnReset = document.getElementById('btn-rec-reset');
    const recFps   = document.getElementById('rec-fps');

    this.recorder.setFrameRate(recFps.value);
    recFps.addEventListener('change', () => {
      this.recorder.setFrameRate(recFps.value);
    });

    // 録画開始: 録画キャプチャの開始を待ってから再生を始める（A/V同期のため）
    // マイク入力中は「再生」の概念がないため、そのまま録画キャプチャのみ開始する。
    btnStart.addEventListener('click', async () => {
      if (this.recorder.state !== 'idle') return;
      const usingMic = this.micInput.active;
      if (!usingMic) this.mediaManager.stop();
      this.visualizer.start();
      let started = false;
      try {
        started = await this.recorder.start();
      } catch (_) {
        started = false;
      }
      if (started) {
        if (!usingMic) this.mediaManager.play();
      } else if (this.recorder.state === 'idle') {
        // 開始できなかった場合は描画ループを止めて待機状態に戻す
        this.visualizer.stop();
      }
    });

    // 録画停止
    btnStop.addEventListener('click', () => {
      this.recorder.stop();
      this.mediaManager.pause();
    });

    // 保存
    btnSave.addEventListener('click', () => {
      this.recorder.save();
    });

    // 再録画（リセット）
    btnReset.addEventListener('click', () => {
      this.recorder.reset();
      this.mediaManager.stop();
      this.visualizer.stop();
    });

    // Recorder の状態変更コールバック
    this.recorder.onStateChange = () => this._updateRecButtons();

    // Recorder のエラー表示
    this.recorder.onError = (message) => {
      const statusEl = document.getElementById('rec-status');
      statusEl.textContent = message;
      statusEl.classList.remove('recording');
    };
  }

  _updateRecButtons() {
    if (!this.recorder) return;
    const state = this.recorder.state;
    const loaded = this.mediaManager.isLoaded || this.micInput.active;
    const btnStart = document.getElementById('btn-rec-start');
    const btnStop  = document.getElementById('btn-rec-stop');
    const btnSave  = document.getElementById('btn-rec-save');
    const btnReset = document.getElementById('btn-rec-reset');
    const statusEl = document.getElementById('rec-status');

    btnStart.disabled = !loaded || state !== 'idle';
    btnStop.disabled  = state !== 'recording';
    btnSave.disabled  = state !== 'recorded';
    btnReset.disabled = state === 'idle';

    if (state === 'recording') {
      statusEl.textContent = '録画中…';
      statusEl.classList.add('recording');
    } else if (state === 'recorded') {
      statusEl.textContent = '録画完了 — 保存可能です';
      statusEl.classList.remove('recording');
    } else {
      statusEl.textContent = '待機中';
      statusEl.classList.remove('recording');
    }
  }

  // ── オフライン書き出し ──
  // 音楽ファイルを解析し、再生を伴わず現在の設定に合わせて書き出す。
  // 録画（Recorder）とは独立して動作し、再生スロットのファイルとは無関係に
  // 専用のファイル選択を用いる。

  _initOfflineExport() {
    const statusEl = document.getElementById('offline-export-status');
    const btnFile = document.getElementById('btn-offline-file');
    const fileInput = document.getElementById('offline-file-input');
    const fileNameEl = document.getElementById('offline-file-name');
    const fpsSelect = document.getElementById('offline-fps');
    const btnStart = document.getElementById('btn-offline-start');
    const btnCancel = document.getElementById('btn-offline-cancel');
    const btnSave = document.getElementById('btn-offline-save');
    const progressWrap = document.getElementById('offline-progress-wrap');
    const progressEl = document.getElementById('offline-progress');

    this.offlineExporter = new OfflineExporter();
    this._offlineFile = null;

    const supported = OfflineExporter.isSupported();
    if (!supported) {
      statusEl.textContent = 'この環境ではオフライン書き出しに対応していません（Chrome/Edge推奨）';
    }

    btnFile.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      fileInput.value = '';
      if (!file) return;
      this._offlineFile = file;
      fileNameEl.textContent = file.name;
      btnSave.disabled = true;
      btnStart.disabled = !supported;
      if (supported) statusEl.textContent = '書き出し待機中';
    });

    btnStart.addEventListener('click', async () => {
      const busy = this.offlineExporter.state === 'analyzing' || this.offlineExporter.state === 'rendering';
      if (!this._offlineFile || busy) return;

      btnStart.disabled = true;
      btnFile.disabled = true;
      btnCancel.disabled = false;
      btnSave.disabled = true;
      progressWrap.style.display = '';
      progressEl.value = 0;

      const fps = Number(fpsSelect.value) || 30;
      // 開始時点の設定をスナップショットし、進行中の書き出しに
      // その後のUI操作の影響が混入しないようにする
      const settingsSnapshot = {
        ...this.visualizer.settings,
        layers: this.visualizer.settings.layers.map(l => ({ ...l })),
      };

      try {
        await this.offlineExporter.export(this._offlineFile, settingsSnapshot, { fps });
      } catch (_) {
        // エラー内容は onError 経由で表示済み
      } finally {
        btnFile.disabled = false;
        btnCancel.disabled = true;
        if (this.offlineExporter.state === 'done') {
          btnStart.disabled = false;
          btnSave.disabled = false;
        } else {
          btnStart.disabled = !this._offlineFile;
        }
      }
    });

    btnCancel.addEventListener('click', () => {
      this.offlineExporter.cancel();
    });

    btnSave.addEventListener('click', () => {
      this.offlineExporter.save();
    });

    this.offlineExporter.onStateChange = (state) => {
      if (state === 'analyzing') {
        statusEl.textContent = '解析中…';
      } else if (state === 'rendering') {
        statusEl.textContent = '描画・エンコード中…';
      } else if (state === 'done') {
        statusEl.textContent = '書き出し完了 — 保存できます';
        progressEl.value = 100;
      } else if (state === 'idle') {
        statusEl.textContent = this._offlineFile ? '書き出し待機中' : '音楽ファイルを選択してください';
        progressWrap.style.display = 'none';
      }
    };

    this.offlineExporter.onProgress = (p) => {
      progressEl.value = Math.round(clamp(p, 0, 1) * 100);
    };

    this.offlineExporter.onError = (message) => {
      statusEl.textContent = 'エラー: ' + message;
      progressWrap.style.display = 'none';
    };
  }

  // ── プリセット / JSON設定入出力 ──

  _initPresets() {
    const select = document.getElementById('preset-select');
    const nameInput = document.getElementById('preset-name');
    const btnSave = document.getElementById('btn-preset-save');
    const btnLoad = document.getElementById('btn-preset-load');
    const btnDelete = document.getElementById('btn-preset-delete');
    const btnExport = document.getElementById('btn-settings-export');
    const btnImport = document.getElementById('btn-settings-import');
    const importInput = document.getElementById('settings-import-input');
    const statusEl = document.getElementById('preset-status');

    const refreshList = () => {
      const names = listPresets();
      select.innerHTML = '';
      if (names.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '(保存済みプリセットなし)';
        select.appendChild(opt);
      } else {
        names.forEach((name) => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          select.appendChild(opt);
        });
      }
    };
    refreshList();

    // 設定を UI・アナライザー双方へ反映する
    const applySettings = (settings) => {
      this.visualizer.settings = settings;
      // UI 側の各コントロールを設定値に同期する
      this._syncControlsFromSettings();
    };

    btnSave.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) { statusEl.textContent = 'プリセット名を入力してください'; return; }
      const ok = savePreset(name, this.visualizer.settings);
      statusEl.textContent = ok ? `「${name}」を保存しました` : '保存に失敗しました';
      if (ok) refreshList();
    });

    btnLoad.addEventListener('click', () => {
      const name = select.value;
      if (!name) return;
      const settings = loadPreset(name);
      if (!settings) { statusEl.textContent = '読込に失敗しました'; return; }
      applySettings(settings);
      statusEl.textContent = `「${name}」を読み込みました`;
    });

    btnDelete.addEventListener('click', () => {
      const name = select.value;
      if (!name) return;
      deletePreset(name);
      refreshList();
      statusEl.textContent = `「${name}」を削除しました`;
    });

    btnExport.addEventListener('click', () => {
      downloadSettingsJson(this.visualizer.settings);
    });

    btnImport.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      importInput.value = '';
      if (!file) return;
      try {
        const settings = await readSettingsJsonFile(file);
        applySettings(settings);
        statusEl.textContent = 'JSONから設定を読み込みました';
      } catch (err) {
        statusEl.textContent = 'JSONの読み込みに失敗しました: ' + err.message;
      }
    });
  }

  // プリセット/JSON読込後、UIコントロールを settings の値へ同期する
  _syncControlsFromSettings() {
    const s = this.visualizer.settings;
    this._setSlider('hue', 'val-hue', s.hue, 0);
    this._setSlider('hue-range', 'val-hue-range', s.hueRange, 0);
    this._setSlider('brightness', 'val-brightness', s.brightness, 0);
    this._setSlider('saturation', 'val-saturation', s.saturation, 0);
    this._setSlider('sensitivity', 'val-sensitivity', s.sensitivity, 1);
    this._setSlider('smoothing', 'val-smoothing', s.smoothing, 2);
    this._setSlider('bar-width', 'val-bar-width', s.barWidth, 0);
    this._setSlider('density', 'val-density', s.density, 0);
    this._setSlider('base-offset', 'val-base-offset', s.baseOffset, 0);
    this._setSlider('afterimage', 'val-afterimage', s.afterimageIntensity, 0);
    this._setSlider('history', 'val-history', s.historySeconds, 0);
    this._setSlider('motion', 'val-motion', s.motionSpeed, 1);
    this._setSlider('particles', 'val-particles', s.particleAmount, 0);
    this._setSlider('angle', 'val-angle', s.depthAngle, 0);
    this._setSlider('petals', 'val-petals', s.petalCount, 0);
    this._setSlider('physics', 'val-physics', s.physicsAmount, 0);
    this.audioEngine.setSmoothing(s.smoothing);

    document.getElementById('analyzer-type').value = s.analyzerType;
    document.getElementById('expression-method').value = s.expressionMethod;
    document.getElementById('bar-display-mode').value = s.barDisplayMode;
    this._applyCapabilities(s.analyzerType);

    document.querySelectorAll('.layer-btn').forEach((b) => b.classList.remove('active'));
    const activeLayerBtn = document.getElementById(`btn-layer-${s.layerCount}`);
    if (activeLayerBtn) activeLayerBtn.classList.add('active');
    this._renderLayerSettings(s.layerCount);

    const chk = document.getElementById('chk-hue-continuous');
    chk.checked = s.hueContinuousMode;
    document.getElementById('hue-speed-group').style.display = s.hueContinuousMode ? '' : 'none';
    this._setSlider('hue-speed', 'val-hue-speed', s.hueContinuousSpeed, 1);

    const btn169 = document.getElementById('btn-16-9');
    const btn11 = document.getElementById('btn-1-1');
    btn169.classList.toggle('active', s.aspectRatio === '16:9');
    btn11.classList.toggle('active', s.aspectRatio === '1:1');
    const btnBlack = document.getElementById('btn-bg-black');
    const btnWhite = document.getElementById('btn-bg-white');
    btnBlack.classList.toggle('active', s.bgColor !== '#fff');
    btnWhite.classList.toggle('active', s.bgColor === '#fff');

    this.visualizer.resize();
  }

  // ── フルスクリーン ──

  _initFullscreen() {
    const btn = document.getElementById('btn-fullscreen');
    const area = document.getElementById('visualizer-area');
    if (!btn || !area) return;

    btn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (area.requestFullscreen) {
        area.requestFullscreen().catch(() => {});
      }
    });

    document.addEventListener('fullscreenchange', () => {
      btn.classList.toggle('active', !!document.fullscreenElement);
      this.visualizer.resize();
    });
  }

  // ── キーボードショートカット ──

  _initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

      switch (e.code) {
        case 'Space': {
          e.preventDefault();
          if (this.mediaManager.isPlaying) {
            this.mediaManager.pause();
          } else if (this.mediaManager.isLoaded) {
            this.mediaManager.play();
            this.visualizer.start();
          }
          break;
        }
        case 'KeyR':
          document.getElementById('btn-analyzer-randomize').click();
          break;
        case 'KeyH':
          document.getElementById('btn-hue-randomize').click();
          break;
        case 'KeyS':
          document.getElementById('btn-shape-randomize').click();
          break;
        case 'KeyF':
          document.getElementById('btn-fullscreen').click();
          break;
        case 'KeyB': {
          if (this.mode !== 'rec') break;
          const btnStart = document.getElementById('btn-rec-start');
          const btnStop = document.getElementById('btn-rec-stop');
          if (!btnStart.disabled) btnStart.click();
          else if (!btnStop.disabled) btnStop.click();
          break;
        }
      }
    });
  }

  // ── 表示比率 ──

  _initAspectRatio() {
    const btn169 = document.getElementById('btn-16-9');
    const btn11 = document.getElementById('btn-1-1');

    btn169.addEventListener('click', () => {
      this.visualizer.settings.aspectRatio = '16:9';
      this.visualizer.resize();
      btn169.classList.add('active');
      btn11.classList.remove('active');
    });

    btn11.addEventListener('click', () => {
      this.visualizer.settings.aspectRatio = '1:1';
      this.visualizer.resize();
      btn169.classList.remove('active');
      btn11.classList.add('active');
    });

    // 背景色
    const btnBlack = document.getElementById('btn-bg-black');
    const btnWhite = document.getElementById('btn-bg-white');

    const applyBg = (color) => {
      this.visualizer.settings.bgColor = color;
      this.visualizer._fillBackground();
      if (color === '#fff') {
        btnWhite.classList.add('active');
        btnBlack.classList.remove('active');
      } else {
        btnBlack.classList.add('active');
        btnWhite.classList.remove('active');
      }
    };

    btnBlack.addEventListener('click', () => applyBg('#000'));
    btnWhite.addEventListener('click', () => applyBg('#fff'));
  }

  // ── アナライザー設定 ──

  _initAnalyzer() {
    const analyzerTypeSelect = document.getElementById('analyzer-type');
    const expressionSelect = document.getElementById('expression-method');
    const barModeSelect = document.getElementById('bar-display-mode');

    // タイプ選択肢をレジストリから系統別に生成
    this._populateTypeSelect(analyzerTypeSelect);
    analyzerTypeSelect.value = this.visualizer.settings.analyzerType;

    analyzerTypeSelect.addEventListener('change', () => {
      this.visualizer.settings.analyzerType = analyzerTypeSelect.value;
      this._applyCapabilities(analyzerTypeSelect.value);
    });

    expressionSelect.addEventListener('change', () => {
      this.visualizer.settings.expressionMethod = expressionSelect.value;
    });

    barModeSelect.addEventListener('change', () => {
      this.visualizer.settings.barDisplayMode = barModeSelect.value;
    });

    // レイヤー数ボタン
    const layerButtons = document.querySelectorAll('.layer-btn');
    layerButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const count = parseInt(btn.id.replace('btn-layer-', ''), 10);
        this.visualizer.settings.layerCount = count;
        layerButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderLayerSettings(count);
      });
    });

    this._renderLayerSettings(1);
    this._applyCapabilities(this.visualizer.settings.analyzerType);

    document.getElementById('btn-analyzer-randomize').addEventListener('click', () => {
      const rInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

      // 全タイプから選び、ケイパビリティに従って表現方法・表示モード・レイヤー数を決める
      const types = Object.keys(RENDERER_REGISTRY);
      const newType = pick(types);
      const caps = getRendererEntry(newType).capabilities || {};

      this.visualizer.settings.analyzerType = newType;

      if (caps.methods && caps.methods.length > 0) {
        this.visualizer.settings.expressionMethod = pick(caps.methods);
      }
      if (caps.barDisplayMode) {
        this.visualizer.settings.barDisplayMode = pick(['normal', 'mirror-vertical', 'mirror-horizontal']);
      }
      const newCount = caps.layers ? rInt(1, 4) : 1;
      this.visualizer.settings.layerCount = newCount;

      // レイヤー個別設定をランダム化（感度はデフォルト1.0を維持）
      for (let i = 0; i < 4; i++) {
        this.visualizer.settings.layers[i].hueOffset   = rInt(-180, 180);
        this.visualizer.settings.layers[i].sensitivity = 1.0;
      }

      // UI 反映
      analyzerTypeSelect.value = newType;
      expressionSelect.value   = this.visualizer.settings.expressionMethod;
      barModeSelect.value      = this.visualizer.settings.barDisplayMode;
      layerButtons.forEach(b => b.classList.remove('active'));
      const activeLayerBtn = document.getElementById(`btn-layer-${newCount}`);
      if (activeLayerBtn) activeLayerBtn.classList.add('active');
      this._renderLayerSettings(newCount);
      this._applyCapabilities(newType);
    });
  }

  // タイプセレクトを RENDERER_REGISTRY から系統別 optgroup で構築する
  _populateTypeSelect(select) {
    select.innerHTML = '';
    const byGroup = {};
    Object.keys(RENDERER_REGISTRY).forEach(key => {
      const entry = RENDERER_REGISTRY[key];
      const g = entry.group || 'その他';
      (byGroup[g] = byGroup[g] || []).push({ key, label: entry.label });
    });
    RENDERER_GROUP_ORDER.forEach(group => {
      const items = byGroup[group];
      if (!items) return;
      const og = document.createElement('optgroup');
      og.label = group;
      items.forEach(({ key, label }) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = label;
        og.appendChild(opt);
      });
      select.appendChild(og);
    });
  }

  // 選択タイプのケイパビリティに応じて非対応コントロールを表示/非表示する
  _applyCapabilities(type) {
    const caps = getRendererEntry(type).capabilities || {};
    const show = (id, visible) => {
      const el = document.getElementById(id);
      if (el) el.style.display = visible ? '' : 'none';
    };

    // 表現方法: 対応 method のみ option を残す。無ければセクションごと隠す
    const methods = caps.methods || [];
    const exprSelect = document.getElementById('expression-method');
    if (methods.length === 0) {
      show('group-expression', false);
    } else {
      show('group-expression', true);
      Array.from(exprSelect.options).forEach(opt => {
        opt.hidden = methods.indexOf(opt.value) === -1;
      });
      if (methods.indexOf(this.visualizer.settings.expressionMethod) === -1) {
        this.visualizer.settings.expressionMethod = methods[0];
        exprSelect.value = methods[0];
      }
    }

    // 表示モード（ミラー）
    show('bar-mode-group', !!caps.barDisplayMode);

    // レイヤー数
    show('group-layers', !!caps.layers);
    if (!caps.layers) {
      this.visualizer.settings.layerCount = 1;
    }
    document.getElementById('layer-settings').style.display = caps.layers ? '' : 'none';

    // 追加スライダー（sliders 宣言 + physics）
    const sliders = caps.sliders || [];
    show('group-history',   sliders.indexOf('history') !== -1);
    show('group-motion',    sliders.indexOf('motion') !== -1);
    show('group-particles', sliders.indexOf('particles') !== -1);
    show('group-angle',     sliders.indexOf('angle') !== -1);
    show('group-petals',    sliders.indexOf('petals') !== -1);
    show('group-physics',   !!caps.physics);
  }

  _renderLayerSettings(count) {
    const container = document.getElementById('layer-settings');
    container.innerHTML = '';

    if (count <= 1) return;

    const bandLabels = ['低域', '低中域', '高中域', '高域'];

    for (let i = 0; i < count; i++) {
      const layer = this.visualizer.settings.layers[i];
      const label = bandLabels[i] || `L${i + 1}`;

      const section = document.createElement('div');
      section.className = 'layer-item';
      section.innerHTML = `
        <div class="layer-title">Layer ${i + 1} <span class="layer-band">${label}</span></div>
        <label>
          色相オフセット&ensp;<span id="val-layer-hue-${i}">${layer.hueOffset}</span>
          <input type="range" id="layer-hue-${i}" min="-180" max="180" value="${layer.hueOffset}">
        </label>
        <label>
          感度&ensp;<span id="val-layer-sens-${i}">${layer.sensitivity.toFixed(1)}</span>
          <input type="range" id="layer-sens-${i}" min="0.1" max="3.0" step="0.1" value="${layer.sensitivity}">
        </label>
        <label>
          合成モード
          <select id="layer-blend-${i}">
            <option value="source-over">通常</option>
            <option value="lighter">加算</option>
            <option value="multiply">乗算</option>
            <option value="screen">スクリーン</option>
          </select>
        </label>
      `;
      container.appendChild(section);

      document.getElementById(`layer-hue-${i}`).addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        this.visualizer.settings.layers[i].hueOffset = v;
        document.getElementById(`val-layer-hue-${i}`).textContent = v;
      });

      document.getElementById(`layer-sens-${i}`).addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        this.visualizer.settings.layers[i].sensitivity = v;
        document.getElementById(`val-layer-sens-${i}`).textContent = v.toFixed(1);
      });

      const blendSelect = document.getElementById(`layer-blend-${i}`);
      blendSelect.value = layer.blendMode || 'source-over';
      blendSelect.addEventListener('change', (e) => {
        this.visualizer.settings.layers[i].blendMode = e.target.value;
      });
    }
  }

  // ── 色調整 ──

  _initColorControls() {
    this._bindSlider('hue',        'val-hue',        v => { this.visualizer.settings.hue        = v; });
    this._bindSlider('hue-range',  'val-hue-range',  v => { this.visualizer.settings.hueRange   = v; });
    this._bindSlider('brightness', 'val-brightness',  v => { this.visualizer.settings.brightness = v; });
    this._bindSlider('saturation', 'val-saturation',  v => { this.visualizer.settings.saturation = v; });

    // 色相ランダマイズ
    document.getElementById('btn-hue-randomize').addEventListener('click', () => {
      const newHue = Math.floor(Math.random() * 360);
      this.visualizer.settings.hue = newHue;
      document.getElementById('slider-hue').value = newHue;
      document.getElementById('val-hue').textContent = newHue;

      const { layers, layerCount } = this.visualizer.settings;
      for (let i = 0; i < 4; i++) {
        layers[i].hueOffset = Math.floor(Math.random() * 361) - 180;
      }
      this._renderLayerSettings(layerCount);
    });

    // 色相連続変化モード
    const chk = document.getElementById('chk-hue-continuous');
    const speedGroup = document.getElementById('hue-speed-group');

    chk.addEventListener('change', () => {
      this.visualizer.settings.hueContinuousMode = chk.checked;
      speedGroup.style.display = chk.checked ? '' : 'none';
    });

    this._bindSlider('hue-speed', 'val-hue-speed', v => {
      this.visualizer.settings.hueContinuousSpeed = v;
    }, 1);
  }

  // ── 感度・形状 ──

  _initShapeControls() {
    this._bindSlider('sensitivity', 'val-sensitivity', v => { this.visualizer.settings.sensitivity = v; }, 1);
    this._bindSlider('smoothing',   'val-smoothing',   v => {
      this.visualizer.settings.smoothing = v;
      this.audioEngine.setSmoothing(v);
    }, 2);
    this._bindSlider('bar-width',   'val-bar-width',   v => { this.visualizer.settings.barWidth    = v; });
    this._bindSlider('density',     'val-density',     v => { this.visualizer.settings.density     = v; });
    this._bindSlider('base-offset', 'val-base-offset', v => { this.visualizer.settings.baseOffset  = v; });
    this._bindSlider('afterimage',  'val-afterimage',  v => { this.visualizer.settings.afterimageIntensity = v; });
    // Phase 6 追加スライダー
    this._bindSlider('history',   'val-history',   v => { this.visualizer.settings.historySeconds = v; });
    this._bindSlider('motion',    'val-motion',    v => { this.visualizer.settings.motionSpeed    = v; }, 1);
    this._bindSlider('particles', 'val-particles', v => { this.visualizer.settings.particleAmount = v; });
    this._bindSlider('angle',     'val-angle',     v => { this.visualizer.settings.depthAngle     = v; });
    this._bindSlider('petals',    'val-petals',    v => { this.visualizer.settings.petalCount     = v; });
    this._bindSlider('physics',   'val-physics',   v => { this.visualizer.settings.physicsAmount  = v; });

    document.getElementById('btn-shape-randomize').addEventListener('click', () => {
      const rFloat = (min, max, step) => {
        const steps = Math.round((max - min) / step);
        return Math.round((min + Math.floor(Math.random() * (steps + 1)) * step) * 100) / 100;
      };
      const rInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

      const sens       = rFloat(0.1, 3.0, 0.1);
      const smoothing  = rFloat(0, 0.95, 0.05);
      const barWidth   = rInt(1, 20);
      const density    = rInt(30, 100);
      const baseOffset = rInt(0, 99);
      const afterimage = rInt(0, 10);

      this.visualizer.settings.sensitivity         = sens;
      this.visualizer.settings.smoothing           = smoothing;
      this.visualizer.settings.barWidth            = barWidth;
      this.visualizer.settings.density             = density;
      this.visualizer.settings.baseOffset          = baseOffset;
      this.visualizer.settings.afterimageIntensity = afterimage;
      this.audioEngine.setSmoothing(smoothing);

      this._setSlider('sensitivity', 'val-sensitivity', sens,       1);
      this._setSlider('smoothing',   'val-smoothing',   smoothing,  2);
      this._setSlider('bar-width',   'val-bar-width',   barWidth,   0);
      this._setSlider('density',     'val-density',     density,    0);
      this._setSlider('base-offset', 'val-base-offset', baseOffset, 0);
      this._setSlider('afterimage',  'val-afterimage',  afterimage, 0);
    });
  }

  _setSlider(sliderId, valId, value, decimals) {
    const slider = document.getElementById('slider-' + sliderId);
    const valEl  = document.getElementById(valId);
    slider.value = value;
    valEl.textContent = decimals > 0 ? value.toFixed(decimals) : String(value);
  }

  // ── ヘルパー ──

  _bindSlider(sliderId, valId, setter, decimals = 0) {
    const slider = document.getElementById('slider-' + sliderId);
    const valEl  = document.getElementById(valId);
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valEl.textContent = decimals > 0 ? v.toFixed(decimals) : String(v);
      setter(v);
    });
  }

  _setPlaybackEnabled(enabled) {
    document.getElementById('btn-play').disabled  = !enabled;
    document.getElementById('btn-pause').disabled = !enabled;
    document.getElementById('btn-stop').disabled  = !enabled;
  }

  _onEnded() {
    // 録画中なら録画も停止
    if (this.mode === 'rec' && this.recorder.state === 'recording') {
      this.recorder.stop();
    }
    this.mediaManager.stop();
    this.visualizer.stop();
  }
}
