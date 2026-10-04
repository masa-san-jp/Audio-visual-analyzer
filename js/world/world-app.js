// 目的 — ドロップ・先行解析・常設操作と評価用の公開口 — doc/20261004-concept-world-mode.md §2.7・§5
class WorldSongMapService extends SongMapService {
  async _collectRows(job, buffer) {
    const rows = await super._collectRows(job, buffer);
    // 既存SongMap v1は平均クロマを公開しない。行の寿命内で分布だけ保持し、既存APIは変更しない。
    const chroma = new Float64Array(12), R = SONGMAP_ROW;
    for (let h = 0; h < rows.length; h += R.LENGTH) for (let k = 0; k < 12; k++) chroma[k] += rows[h + R.CHROMA + k];
    this.worldChroma = chroma; return rows;
  }
  async _run(job) {
    const map = await super._run(job); map.worldChroma = Array.from(this.worldChroma); return map;
  }
}
class WorldApp {
  constructor() {
    this.canvas = document.getElementById('world'); this.prompt = document.getElementById('prompt');
    this.controls = document.getElementById('controls'); this.fileInput = document.getElementById('file');
    this.playButton = document.getElementById('play'); this.seekInput = document.getElementById('seek');
    this.timeOutput = document.getElementById('time'); this.fullscreenButton = document.getElementById('fullscreen');
    this.seeking = false; this.prepared = null; this.exportBusy = false;
    this.fpsInput = document.getElementById('fps'); this.exportButton = document.getElementById('export');
    this.cancelExportButton = document.getElementById('cancel-export'); this.exportProgress = document.getElementById('export-progress');
    this.exportStatus = document.getElementById('export-status'); this.exporter = new WorldExporter();
    this.exporter.onProgress = value => { if (!this.exportBusy) return; this.exportProgress.value = value; this.exportStatus.textContent = Math.round(value * 100) + '%'; };
    this.debug = document.getElementById('debug'); this.audio = document.getElementById('audio');
    this.debugMode = new URLSearchParams(location.search).get('debug') === '1';
    this.debug.hidden = !this.debugMode; this.audioEngine = new AudioEngine(); this.service = new WorldSongMapService();
    this.state = 'empty'; this.file = null; this.url = null; this.score = null; this.engine = null; this.lastMs = 0;
    this.loadId = 0; this.raf = 0; this.lastDebugMs = 0; this.previousSec = 0; this.previewBusy = false; this.starting = false;
    this._tickBound = this._tick.bind(this); this._debugBound = this._updateDebug.bind(this);
    this.public = { score: null, engine: null, events: [], audio: this.audio, audioEngine: this.audioEngine,
      app: this, renderAt: tSec => this.renderAt(tSec), metrics: () => this.engine ? this.engine.metrics() : { state: this.state } };
    window.__world = this.public;
    try { this.engine = new WorldEngine(this.canvas); this.public.engine = this.engine; this.engine.clear(); }
    catch (error) { this.state = 'unavailable'; this.prompt.textContent = 'この環境では利用できません'; this.prompt.disabled = true; this.public.error = error.message; }
    this._fitCanvas(); this._updateControls();
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => { e.preventDefault(); if (this.engine && e.dataTransfer.files[0]) this.load(e.dataTransfer.files[0]).catch(this._showError.bind(this)); });
    this.prompt.addEventListener('click', () => { if (this.state === 'ready' || this.state === 'ended') this.start().catch(this._showError.bind(this)); });
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files[0]; if (file && this.engine) this.load(file).catch(this._showError.bind(this));
      this.fileInput.value = '';
    });
    this.exportButton.addEventListener('click', () => this.exportSong());
    this.cancelExportButton.addEventListener('click', () => this.exporter.cancel());
    this.fpsInput.addEventListener('change', () => this.setFps(Number(this.fpsInput.value)).catch(this._showError.bind(this)));
    this.playButton.addEventListener('click', () => this.togglePlay().catch(this._showError.bind(this)));
    this.seekInput.addEventListener('change', () => this.seek(this.seekInput.valueAsNumber).catch(this._showError.bind(this)));
    this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen().catch(this._showError.bind(this)));
    document.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const editing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.code === 'KeyF') { e.preventDefault(); this.toggleFullscreen().catch(this._showError.bind(this)); }
      if (e.code === 'Space' && !editing && (!e.target || e.target.tagName !== 'BUTTON')) { e.preventDefault(); this.togglePlay().catch(this._showError.bind(this)); }
    });
    this.audio.addEventListener('timeupdate', () => this._updateControls());
    this.audio.addEventListener('loadedmetadata', () => this._updateControls());
    this.audio.addEventListener('ended', () => this._end());
    document.addEventListener('fullscreenchange', () => { this._fitCanvas(); this._updateControls(); });
    window.addEventListener('resize', () => this._fitCanvas());
    this.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.audio.pause(); this._showError(new Error('この環境では利用できません')); });
    // デバッグのソート／文字列整形はrAFから分離する。
    if (this.debugMode) this.debugTimer = setInterval(this._debugBound, 500);
  }
  _fitCanvas() {
    if (!this.engine) return;
    // 1920×1080を固定の描画解像度として保持し、CSSで画面内に16:9のまま合わせる。
    const available = Math.max(1, window.innerHeight - this.controls.offsetHeight);
    const w = Math.min(window.innerWidth, available * 16 / 9);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = w * 9 / 16 + 'px';
  }
  async load(file) {
    if (!this.engine) throw new Error('この環境では利用できません');
    if (this.previewBusy || this.starting || this.exportBusy || this.state === 'analyzing') throw new Error('描画／再生の準備が完了するまでお待ちください');
    const id = ++this.loadId; if (this.file) this.service.cancel(this.file);
    this.audio.pause(); cancelAnimationFrame(this.raf); this.engine.clear(); this.file = file;
    this.score = null; this.public.score = null; this.public.error = null; this.exportStatus.textContent = ''; this.exportProgress.value = 0;
    this.state = 'analyzing'; this.prompt.hidden = false; this.prompt.textContent = '曲を解析中…'; this.prompt.classList.add('busy'); this._updateControls();
    try {
      const map = await this.service.request(file); if (id !== this.loadId) return;
      this.score = compileWorldScore(map, 11);
      this.prepared = await this.exporter.prepare(file, Number(this.fpsInput.value)); if (id !== this.loadId) return;
      this.engine.setScore(this.score); this.engine.setTimeline(this.prepared.featureFrames, this.prepared.fps);
      this.public.score = this.score; this.public.events = this.engine.events; this.public.songMap = map;
      if (this.url) URL.revokeObjectURL(this.url); this.url = URL.createObjectURL(file);
      this.audio.src = this.url; this.audio.load(); this.audioEngine.connectMedia(this.audio);
      this.state = 'ready'; this.prompt.classList.remove('busy'); this.prompt.textContent = '再生で開始'; this._updateControls();
      return this.score;
    } catch (error) { if (id !== this.loadId) return; this._showError(error); throw error; }
  }
  async setFps(fps) {
    if (!this.score || !this.prepared) return;
    if (this.previewBusy || this.starting || this.exportBusy) throw new Error('処理中です');
    this.audio.pause(); cancelAnimationFrame(this.raf); this.previewBusy = true; this._updateControls();
    try {
      this.prepared = await this.exporter.prepare(this.file, fps, this.prepared.audioBuffer);
      this.engine.setTimeline(this.prepared.featureFrames, fps);
      await this.engine.renderAt(this.audio.currentTime); this.public.events = this.engine.events; this.prompt.hidden = true; this.state = 'paused';
    } finally { this.fpsInput.value = String(this.prepared.fps); this.previewBusy = false; this._updateControls(); }
  }
  async exportSong() {
    if (!this.prepared || !this.score || this.exportBusy || this.previewBusy || this.starting) return;
    this.audio.pause(); cancelAnimationFrame(this.raf); this.state = 'paused'; this.exportBusy = true;
    this.exportStatus.textContent = '書き出し中…'; this._updateControls();
    try {
      const blob = await this.exporter.exportWorld(this.score, this.prepared);
      if (blob) { this.exporter.download(); this.exportStatus.textContent = '保存しました'; }
      else this.exportStatus.textContent = '中止しました';
    } catch (error) { this.exportStatus.textContent = '書き出し失敗: ' + error.message; }
    finally { this.exportBusy = false; this._updateControls(); }
  }
  async renderAt(tSec) {
    if (!this.score || !this.engine) throw new Error('曲を読み込んでください');
    if (this.previewBusy || this.starting || this.exportBusy) throw new Error('描画／再生の準備が完了するまでお待ちください');
    this.engine._validatePreview(tSec);
    this.previewBusy = true; this.audio.pause(); cancelAnimationFrame(this.raf);
    this.state = 'preview'; this.prompt.hidden = true; this._updateControls();
    try {
      const metrics = await this.engine.renderAt(tSec); this.public.events = this.engine.events; return metrics;
    } finally { this.previewBusy = false; this._updateControls(); }
  }
  async start() {
    if (!this.score || this.state === 'playing') return;
    if (this.previewBusy || this.starting || this.exportBusy) throw new Error('描画／再生の準備が完了するまでお待ちください');
    this.starting = true;
    if (this.state !== 'paused') {
      this.audio.currentTime = 0; this.audioEngine.resetAnalysis(); this.engine.setScore(this.score); this.public.events = this.engine.events;
    }
    // playとresumeはユーザージェスチャー内で同時に発行する。
    // suspendedのresumeを先にawaitすると、playが一度も呼ばれず自動化が停止する。
    let timeout;
    try {
      const resuming = this.audioEngine.resume(), playing = this.audio.play();
      await Promise.race([
        Promise.all([resuming, playing]),
        new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('再生開始がタイムアウトしました。クリックで開始してください')), 10000); })
      ]);
      this.state = 'playing'; this.prompt.hidden = true; this.lastMs = 0; this.previousSec = this.audio.currentTime;
      cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(this._tickBound);
    } catch (error) {
      this.audio.pause(); this.state = 'ready'; this.prompt.hidden = false; throw error;
    } finally { clearTimeout(timeout); this.starting = false; this._updateControls(); }
  }
  async togglePlay() {
    if (this.state === 'playing') {
      this.audio.pause(); this.state = 'paused'; cancelAnimationFrame(this.raf); this._updateControls();
    } else if (this.score && !this.previewBusy && !this.starting) await this.start();
  }
  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      // ページ全体を全画面にして操作UIも保持する。
      this._fitCanvas(); this._updateControls(); return true;
    } catch (error) {
      // 全画面は任意。拒否されても鑑賞とシークを継続できる。
      this.public.fullscreenError = error.message; return false;
    }
  }
  async seek(tSec) {
    if (!this.score || this.previewBusy || this.starting) return;
    const resume = this.state === 'playing', t = Math.max(0, Math.min(this.score.durationSec, tSec));
    this.seeking = true;
    try {
      await this.renderAt(t);
      this.audio.currentTime = t; this.audioEngine.resetAnalysis(); this.engine.preview = false;
      this.state = t >= this.score.durationSec ? 'ended' : 'paused'; this.lastMs = 0;
      if (resume && this.state !== 'ended') await this.start();
    } finally { this.seeking = false; this._updateControls(); }
  }
  _updateControls() {
    const busy = this.previewBusy || this.starting || this.exportBusy || this.state === 'analyzing';
    this.fileInput.disabled = busy; this.fpsInput.disabled = busy;
    this.exportButton.disabled = !this.prepared || busy || this.state === 'error';
    this.cancelExportButton.hidden = !this.exportBusy; this.exportProgress.hidden = !this.exportBusy;
    this.playButton.disabled = !this.score || busy || this.state === 'error' || this.state === 'unavailable';
    this.playButton.textContent = this.state === 'playing' ? '一時停止' : '再生';
    this.seekInput.disabled = !this.score || busy;
    this.seekInput.max = this.score ? this.score.durationSec : 1;
    if (!this.seeking) this.seekInput.valueAsNumber = this.audio.currentTime || 0;
    const format = value => Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0');
    this.timeOutput.textContent = format(this.audio.currentTime || 0) + ' / ' + format(this.score ? this.score.durationSec : 0);
    this.fullscreenButton.setAttribute('aria-pressed', document.fullscreenElement ? 'true' : 'false');
  }
  _tick(nowMs) {
    if (this.state === 'playing') {
      const dt = this.lastMs ? (nowMs - this.lastMs) / 1000 : 1 / 60; this.lastMs = nowMs;
      if (this.audio.currentTime + 1e-6 < this.previousSec) {
        this.engine.setScore(this.score); this.public.events = this.engine.events;
      }
      this.previousSec = this.audio.currentTime;
      this.audioEngine.captureFrame(nowMs);
      // 計測時刻は呼び出し側で取得し、描画・シミュレーションには音声時刻とdtを渡す。
      const start = performance.now(); this.engine.render(this.audio.currentTime, this.audioEngine.getFeatures(), dt);
      this.engine.endCpuTiming(performance.now() - start);
      if (this.engine.onFrame) this.engine.onFrame(this.engine);
    } else this.lastMs = 0;
    if (this.state === 'playing' || this.state === 'paused') this.raf = requestAnimationFrame(this._tickBound);
  }
  _end() {
    if (this.engine && this.score) {
      // media endedがrAFより先でも最後の境界を落とさない。
      this.engine.render(this.score.durationSec, null, 0); this.engine.clear();
      if (this.engine.onFrame) this.engine.onFrame(this.engine);
    }
    this.state = 'ended'; cancelAnimationFrame(this.raf); this.prompt.hidden = false; this.prompt.classList.remove('busy'); this.prompt.textContent = 'もう一度'; this._updateControls();
  }
  _showError(error) {
    this.state = 'error'; this.audio.pause(); cancelAnimationFrame(this.raf);
    if (this.engine) this.engine.clear();
    this.prompt.hidden = false; this.prompt.classList.remove('busy'); this.prompt.textContent = '再生できません。別の曲をドロップ';
    this._updateControls(); this.public.error = error.message || error.code; if (this.debugMode) this.debug.textContent = this.public.error;
  }
  _updateDebug() {
    if (!this.engine || !this.score) return;
    const m = this.engine.metrics(), s = this.score.sections[m.sectionIndex];
    let text = 'WORLD  ' + this.state + '  MFS: ' + this.audioEngine.mfsStatus + '\n' + this.canvas.width + '×' + this.canvas.height
      + '  particles ' + m.particleCount + '\nFPS ' + (m.frameP95Ms ? (1000 / m.frameP95Ms).toFixed(1) : '—')
      + '  p95 ' + (m.renderP95Ms === null ? 'GPU計測待ち' : m.renderP95Ms.toFixed(2) + 'ms')
      + '\n' + s.environment + ' (' + s.kind + ') / ' + s.label + ' / motif ' + s.formId + ' / variation ' + s.variation + '\n';
    for (let i = Math.max(0, this.engine.eventIndex - 8); i < this.engine.eventIndex; i++) {
      const e = this.engine.events[i]; text += e.tSec.toFixed(3) + ' ' + e.type + ' ' + e.action + '\n';
    }
    this.debug.textContent = text;
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') window.worldApp = new WorldApp();
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldApp, WorldSongMapService }; }
