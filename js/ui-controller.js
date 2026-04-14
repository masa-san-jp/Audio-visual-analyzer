class UIController {
  constructor(visualizer, mediaManager, audioEngine) {
    this.visualizer = visualizer;
    this.mediaManager = mediaManager;
    this.audioEngine = audioEngine;
  }

  init() {
    this._initFile();
    this._initPlayback();
    this._initAspectRatio();
    this._initAnalyzer();
    this._initColorControls();
    this._initShapeControls();
    window.addEventListener('resize', () => this.visualizer.resize());
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
      } catch (err) {
        fileNameEl.textContent = 'エラー: ' + err.message;
        this._setPlaybackEnabled(false);
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

    const updateVisibility = () => {
      const isRadial = analyzerTypeSelect.value === 'radial';
      barModeGroup.style.display = isRadial ? 'none' : '';
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

    updateVisibility();

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

    document.getElementById('btn-analyzer-randomize').addEventListener('click', () => {
      const types    = ['bar', 'radial'];
      const methods  = ['bar', 'line', 'dot'];
      const barModes = ['normal', 'mirror-vertical', 'mirror-horizontal'];
      const rInt     = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

      const newType   = types[Math.floor(Math.random() * types.length)];
      const newMethod = methods[Math.floor(Math.random() * methods.length)];
      const newMode   = barModes[Math.floor(Math.random() * barModes.length)];
      const newCount  = rInt(1, 4);

      this.visualizer.settings.analyzerType    = newType;
      this.visualizer.settings.expressionMethod = newMethod;
      this.visualizer.settings.barDisplayMode   = newMode;
      this.visualizer.settings.layerCount       = newCount;

      analyzerTypeSelect.value = newType;
      expressionSelect.value   = newMethod;
      barModeSelect.value      = newMode;

      // レイヤー個別設定をランダム化（感度はデフォルト1.0を維持）
      for (let i = 0; i < 4; i++) {
        this.visualizer.settings.layers[i].hueOffset  = rInt(-180, 180);
        this.visualizer.settings.layers[i].sensitivity = 1.0;
      }

      // レイヤー数ボタンのアクティブ状態を更新
      layerButtons.forEach(b => b.classList.remove('active'));
      document.getElementById(`btn-layer-${newCount}`).classList.add('active');
      this._renderLayerSettings(newCount);

      updateVisibility();
    });
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

      // レイヤーの色相オフセットもランダマイズ
      const { layers, layerCount } = this.visualizer.settings;
      for (let i = 0; i < 4; i++) {
        layers[i].hueOffset = Math.floor(Math.random() * 361) - 180;
      }
      // 表示中のレイヤー設定UIを更新
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
    this.mediaManager.stop();
    this.visualizer.stop();
  }
}
