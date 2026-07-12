class UIController {
  constructor(visualizer, mediaManager, audioEngine, recorder) {
    this.visualizer = visualizer;
    this.mediaManager = mediaManager;
    this.audioEngine = audioEngine;
    this.recorder = recorder;
    this.mode = 'play'; // 'play' | 'rec'
  }

  init() {
    this._initMode();
    this._initFile();
    this._initPlayback();
    this._initRecording();
    this._initAspectRatio();
    this._initAnalyzer();
    this._initColorControls();
    this._initShapeControls();
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

    // onEnded を一度だけ設定する（loadFile より先に設定することで
    // canplay 時点で ended リスナーが確実に登録されるようにする）
    this.mediaManager.onEnded = () => this._onEnded();

    btnFile.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      fileNameEl.textContent = '読み込み中…';
      try {
        await this.mediaManager.loadFile(file);
        fileNameEl.textContent = file.name;
        this._setPlaybackEnabled(true);
        this._updateRecButtons();
      } catch (err) {
        fileNameEl.textContent = 'エラー: ' + err.message;
        this._setPlaybackEnabled(false);
        this._updateRecButtons();
      }
      fileInput.value = '';
    });
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
    btnStart.addEventListener('click', async () => {
      if (this.recorder.state !== 'idle') return;
      this.mediaManager.stop();
      this.visualizer.start();
      let started = false;
      try {
        started = await this.recorder.start();
      } catch (_) {
        started = false;
      }
      if (started) {
        this.mediaManager.play();
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
    const loaded = this.mediaManager.isLoaded;
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
