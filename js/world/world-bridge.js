// 目的 — 本体（index.html）と WorldEngine の唯一の接点。GPU タイプの遅延初期化・曲の事前解析・毎フレーム描画・書き出し — doc/20261010-design-integration-v1.md §2・§5・§7
const WORLD_BRIDGE_SEED = 11;                 // score と WorldEngine の乱数 seed（world-app.js と同じ）
const WORLD_BRIDGE_MAX_LONG_EDGE = 1920;      // 内部解像度の長辺上限（性能のため。アスペクト比は保つ）
const WORLD_BRIDGE_PREVIEW_FPS = 60;          // ライブ表示用の特徴量時系列の fps
const WORLD_BRIDGE_FALLBACK_SIZE = [1280, 720]; // 表示サイズが未確定のときの内部解像度
const WORLD_BRIDGE_EXPORT_SIZE = { '16:9': [1920, 1080], '1:1': [1080, 1080] };
const WORLD_BRIDGE_REWIND_EPS = 1e-6;         // 時刻が戻ったと判定する許容差（秒）
const WORLD_BRIDGE_TEXT_PREPARING = 'GPU 解析中…';
const WORLD_BRIDGE_TEXT_UNAVAILABLE = 'この環境では GPU タイプを利用できません';
const WORLD_BRIDGE_TEXT_FAILED = 'GPU 解析に失敗しました';
const WORLD_BRIDGE_TEXT_NEED_SONG = '曲ファイルを読み込んでください';

// 内部解像度を求める純粋関数。表示サイズ×devicePixelRatio、長辺は上限に収める（アスペクト比保持）
function worldBridgeInternalSize(cssW, cssH, dpr) {
  let w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  const longEdge = Math.max(w, h);
  if (longEdge > WORLD_BRIDGE_MAX_LONG_EDGE) {
    const k = WORLD_BRIDGE_MAX_LONG_EDGE / longEdge;
    w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
  }
  return [w, h];
}

class WorldBridge {
  constructor({ container, gpuCanvas, audioEngine, mediaManager, songMapService, messageEl = null, statusEl = null, canvas2d = null }) {
    this.container = container; this.gpuCanvas = gpuCanvas; this.audioEngine = audioEngine;
    this.mediaManager = mediaManager; this.songMapService = songMapService;
    this.messageEl = messageEl; this.statusEl = statusEl; this.canvas2d = canvas2d;
    this.engine = null;
    this.available = null;        // null=未試行 / true / false（WebGL2 を作れなかった）
    this.active = false;          // GPU タイプ選択中か
    this.typeId = 'g-fluid';
    this._exporter = null; this._prepExporter = null;
    this._cache = null;           // { key, fps, map, prepared, score }（ライブ用。同じファイルは使い回す）
    this._preparing = null;       // { key, promise }
    this._token = 0;              // prepare の世代（古い結果を捨てる）
    this.ready = false;           // 現在のエンジンに score とタイムラインを設定済みか
    this.error = null;
    this._w = WORLD_BRIDGE_FALLBACK_SIZE[0]; this._h = WORLD_BRIDGE_FALLBACK_SIZE[1];
    this._prevT = 0; this._needsRedraw = false;
  }

  // 書き出し用 WorldExporter（本体のボタン類と共通で使うため、UI がコールバックを差し込む）
  get exporter() {
    if (!this._exporter) this._exporter = new WorldExporter();
    return this._exporter;
  }

  // ライブ用の事前解析専用（書き出しの進捗・状態表示を汚さない別インスタンス）
  _previewExporter() {
    if (!this._prepExporter) this._prepExporter = new WorldExporter();
    return this._prepExporter;
  }

  _setText(el, text) {
    if (!el) return;
    el.textContent = text || ''; el.hidden = !text;
  }

  // 遅延初期化。最初に GPU タイプが選ばれたときに WebGL を作る。失敗したら available=false
  ensureEngine() {
    if (this.engine) return true;
    if (this.available === false) return false;
    try {
      this.gpuCanvas.width = this._w; this.gpuCanvas.height = this._h;
      this.engine = new WorldEngine(this.gpuCanvas, WORLD_BRIDGE_SEED);
      this.engine.clear(); this.available = true;
    } catch (error) {
      this.engine = null; this.available = false; this.error = error.message || String(error);
      this._setText(this.messageEl, WORLD_BRIDGE_TEXT_UNAVAILABLE);
      this._setText(this.statusEl, WORLD_BRIDGE_TEXT_UNAVAILABLE);
      return false;
    }
    return true;
  }

  // GPU タイプの選択状態に合わせて canvas の表示を切り替える
  setActive(active) {
    this.active = !!active;
    this.gpuCanvas.hidden = !this.active;
    if (this.canvas2d) this.canvas2d.classList.toggle('gpu-hidden', this.active);
    if (!this.active) {
      this._setText(this.messageEl, ''); this._setText(this.statusEl, '');
    } else {
      this._needsRedraw = true; this._refreshText();
    }
  }

  _refreshText() {
    if (!this.active) return;
    if (this.available === false) return;
    this._setText(this.messageEl, this.ready ? '' : (this._preparing ? WORLD_BRIDGE_TEXT_PREPARING : (this.error ? WORLD_BRIDGE_TEXT_FAILED : WORLD_BRIDGE_TEXT_NEED_SONG)));
    this._setText(this.statusEl, this._preparing ? WORLD_BRIDGE_TEXT_PREPARING : '');
  }

  _keyOf(file) { return this.songMapService.keyOf(file); }

  // 曲の事前解析。SongMap は本体のサービス、特徴量は WorldExporter.prepare。同じファイルは使い回す
  async _build(file, fps, audioBuffer, exporter) {
    const map = await this.songMapService.request(file);
    const prepared = await exporter.prepare(file, fps, audioBuffer);
    const score = compileWorldScore(map, WORLD_BRIDGE_SEED, prepared.featureFrames);
    return { key: this._keyOf(file), fps, map, prepared, score };
  }

  async prepare(file) {
    if (!file || !this.ensureEngine()) return null;
    const key = this._keyOf(file);
    if (this._cache && this._cache.key === key) {
      if (!this.ready) this._apply(this._cache);
      return this._cache;
    }
    if (this._preparing && this._preparing.key === key) return this._preparing.promise;
    const token = ++this._token;
    this.ready = false; this.error = null;
    const promise = (async () => {
      try {
        const built = await this._build(file, WORLD_BRIDGE_PREVIEW_FPS, null, this._previewExporter());
        if (token !== this._token) return null;
        this._cache = built; this._apply(built); return built;
      } catch (error) {
        if (token !== this._token) return null;
        // 曲の入替で SongMap が中止されただけなら失敗扱いにしない
        this.error = error && error.code === 'cancelled' ? null : (error.message || String(error)); return null;
      } finally {
        if (token === this._token) { this._preparing = null; this._refreshText(); }
      }
    })();
    this._preparing = { key, promise };
    this._refreshText();
    return promise;
  }

  // 準備結果をエンジンへ設定し、選択中のタイプを即時反映する
  _apply(built) {
    const e = this.engine; if (!e) return;
    e.setScore(built.score); e.setTimeline(built.prepared.featureFrames, built.prepared.fps);
    e.selectType(this.typeId, true);
    this.ready = true; this._prevT = 0; this._needsRedraw = true; this._refreshText();
  }

  // 曲の切替・解除で準備状態を捨てる（別ファイルの結果が残らないようにする）
  invalidate() {
    this._token++; this._preparing = null; this._cache = null; this.ready = false; this.error = null;
    this._refreshText();
  }

  // タイプの選択。準備が済んでいれば 0.5 秒のクロスフェードで切り替える
  selectType(id) {
    this.typeId = id;
    if (!this.ensureEngine()) return false;
    if (this.ready) { this.engine.selectType(id); this._needsRedraw = true; }
    return true;
  }

  // 毎フレーム。GPU タイプが選ばれている間だけ VisualizerCore._loop から呼ばれる
  frame(nowMs, dtSec) {
    const e = this.engine; if (!e) return;
    const media = this.mediaManager.mediaElement;
    if (!this.ready || !media) { e.clear(); return; }
    const t = media.currentTime;
    if (t + WORLD_BRIDGE_REWIND_EPS < this._prevT) e.setScore(this._cache.score); // 逆シーク・ループは巻き戻して再上演
    const advancing = !media.paused || t !== this._prevT;
    this._prevT = t;
    if (advancing) {
      e.render(t, this.audioEngine.getFeatures(), dtSec); this._needsRedraw = false;
    } else if (e.fadeElapsed < .5) {
      e.redrawTransition(dtSec); this._needsRedraw = false;
    } else if (this._needsRedraw) {
      e.render(t, this.audioEngine.getFeatures(), 0); this._needsRedraw = false;
    }
  }

  // 内部解像度の更新。cssW/cssH は表示サイズ(px)。gpu-canvas の CSS サイズもここで揃える
  resize(cssW, cssH) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const size = worldBridgeInternalSize(cssW, cssH, dpr);
    this._w = size[0]; this._h = size[1];
    this.gpuCanvas.style.width = cssW + 'px'; this.gpuCanvas.style.height = cssH + 'px';
    if (this.engine) { this.engine.resize(this._w, this._h); this._needsRedraw = true; }
    else { this.gpuCanvas.width = this._w; this.gpuCanvas.height = this._h; }
  }

  // 書き出し。file は書き出し用に選んだ曲（再生中の曲と同じファイルなら解析結果を使い回す）
  async exportVideo({ file, fps, aspect, quality = 'standard', typeId = null, onProgress = null, signal = null }) {
    const exporter = this.exporter, size = WORLD_BRIDGE_EXPORT_SIZE[aspect] || WORLD_BRIDGE_EXPORT_SIZE['16:9'];
    const exportFps = fps >= 59 ? 60 : 30; // WorldExporter は 30/60 のみ
    exporter._quality = quality;
    if (onProgress) exporter.onProgress = onProgress;
    const onAbort = () => exporter.cancel();
    if (signal) { if (signal.aborted) return null; signal.addEventListener('abort', onAbort); }
    try {
      let built = this._cache && this._cache.key === this._keyOf(file) && this._cache.fps === exportFps ? this._cache : null;
      if (!built) {
        const reuse = this._cache && this._cache.key === this._keyOf(file) ? this._cache.prepared.audioBuffer : null;
        built = await this._build(file, exportFps, reuse, exporter);
      }
      if (signal && signal.aborted) return null;
      return await exporter.exportWorld(built.score, built.prepared, { typeId: typeId || this.typeId, width: size[0], height: size[1] });
    } catch (error) {
      if (exporter.onError) exporter.onError(error.message || String(error));
      throw error;
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  dispose() {
    this._token++;
    if (this.engine) { this.engine.dispose(); this.engine = null; }
    this.ready = false; this._cache = null; this._preparing = null;
  }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { WorldBridge, worldBridgeInternalSize }; }
