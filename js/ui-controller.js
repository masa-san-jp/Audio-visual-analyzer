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
    this._initLayers();
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
      // 録画中はモード切替前に録画を自動停止する
      if (this.recorder.state === 'recording') {
        this.recorder.stop();
        this.mediaManager.pause();
      }
      this.mode = 'play';
      btnPlay.classList.add('active');
      btnRec.classList.remove('active');
      recControls.style.display = 'none';
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

    btnFile.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      fileNameEl.textContent = '読み込み中…';
      try {
        await this.mediaManager.loadFile(file);
        fileNameEl.textContent = file.name;
        this.mediaManager.onEnded = () => this._onEnded();
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

    // 録画開始: 再生も同時に開始する
    btnStart.addEventListener('click', () => {
      this.mediaManager.stop();
      this.mediaManager.play();
      this.visualizer.start();
      this.recorder.start();
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
  }

  _updateRecButtons() {
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
  }

  // ── アナライザー設定 ──

  _initAnalyzer() {
    const analyzerTypeSelect = document.getElementById('analyzer-type');
    const expressionSelect = document.getElementById('expression-method');
    const barModeGroup = document.getElementById('bar-mode-group');
    const barModeSelect = document.getElementById('bar-display-mode');
    const radialTiltGroup = document.getElementById('radial-tilt-group');
    const radialTiltSelect = document.getElementById('radial-tilt');

    const updateVisibility = () => {
      const isRadial = analyzerTypeSelect.value === 'radial';
      barModeGroup.style.display = isRadial ? 'none' : '';
      radialTiltGroup.style.display = isRadial ? '' : 'none';
    };

    analyzerTypeSelect.addEventListener('change', () => {
      this.visualizer.settings.analyzerType = analyzerTypeSelect.value;
      updateVisibility();
    });

    expressionSelect.addEventListener('change', () => {
      this.visualizer.settings.expressionMethod = expressionSelect.value;
    });

    barModeSelect.addEventListener('change', () => {
      this.visualizer.settings.barDisplayMode = barModeSelect.value;
    });

    radialTiltSelect.addEventListener('change', () => {
      this.visualizer.settings.radialTilt = parseInt(radialTiltSelect.value, 10);
    });

    updateVisibility();
  }

  // ── レイヤー ──

  _initLayers() {
    const buttons = document.querySelectorAll('.layer-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const count = parseInt(btn.id.replace('btn-layer-', ''), 10);
        this.visualizer.settings.layerCount = count;
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderLayerSettings(count);
      });
    });

    this._renderLayerSettings(1);
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
