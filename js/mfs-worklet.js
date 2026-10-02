// MFS の AudioWorklet 組み立て（プロセッサ MfsProcessor と data: URL 生成）— doc/20260928-plan-phase16-music-feature-stream.md §2.2・§6.1・§6.3、songmap モードは doc/20260928-plan-phase18-song-map-and-auto-director.md §3
//
// 既存 js/analysis-worklet.js と同じく、ワークレットモジュールは file:// 直開きでも動くよう data: URL として生成する
// （外部ファイルの fetch を行わない。クラスは toString() で埋め込む。blob: URL は file:// オリジンで addModule が拒否される）。
// MFS_PROCESSOR_SOURCE はワークレット内でのみ評価される文字列（AudioWorkletProcessor はメインスレッドに存在しないため）。
// process() 経路は配列・オブジェクトを生成しない。ホップ/フレームのメッセージ用の配列だけは例外（計画書 §6.1・ガイド §9.3）。
// 注意: 下のテンプレート文字列内にバッククォートと ${ を書かないこと。

const MFS_PROCESSOR_SOURCE = `
class MfsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this._offline = o.mode === 'offline';
    this._songmap = o.mode === 'songmap';
    this._fps = o.fps > 0 ? o.fps : 30;
    this._total = typeof o.totalSamples === 'number' ? o.totalSamples : Infinity;
    this._extractor = new MfsExtractor(sampleRate, { smoothing: o.smoothing });
    // 入力済みサンプル数（reset でゼロに戻る）と、現在ブロック先頭の値
    this._pushed = 0;
    this._blockBase = 0;
    this._blockFrame = 0;
    // offline: 直前ホップの内容（フレーム確定用）とフラグ集約
    this._prevPacked = new Float32Array(MFS_LAYOUT.LENGTH);
    this._prevFreq = new Uint8Array(MFS_CONST.FFT_SIZE / 2);
    this._prevTime = new Uint8Array(MFS_CONST.FFT_SIZE);
    this._prevHop = -1;
    this._accOnset = 0;
    this._accBeat = 0;
    this._accDown = 0;
    this._nextIndex = 0;
    this._doneSent = false;
    // songmap: 256 行ぶんの行バッファ（constructor で確保して使い回す。送信時のみ slice でコピー）
    this._smRows = new Float32Array(MFS_SONGMAP_BATCH * SONGMAP_ROW.LENGTH);
    this._smCount = 0;
    this._smStartHop = 0;
    this._smHops = 0;
    this._resetOfflineState();

    this._extractor.onHop = this._songmap
      ? (ex) => this._onHopSongmap(ex)
      : this._offline
        ? (ex) => this._onHopOffline(ex)
        : (ex) => this._onHopLive(ex);
    this.port.onmessage = (ev) => {
      const m = ev.data;
      if (!m) return;
      if (m.type === 'reset') this._reset();
      else if (m.type === 'smoothing') this._extractor.setSmoothing(m.value);
    };
  }

  _resetOfflineState() {
    this._prevPacked.fill(0);
    this._prevFreq.fill(0);
    this._prevTime.fill(128);
    this._prevHop = -1;
    this._accOnset = 0;
    this._accBeat = 0;
    this._accDown = 0;
    this._nextIndex = 0;
    this._doneSent = false;
    this._smCount = 0;
    this._smStartHop = 0;
    this._smHops = 0;
  }

  // 全状態を初期化（ホップ番号も 0 から数え直し）
  _reset() {
    this._extractor.reset();
    this._pushed = 0;
    this._blockBase = 0;
    this._resetOfflineState();
  }

  // live: ホップ完了ごとに送る。t = そのホップを完了させたサンプルのコンテキスト時刻（§6.2）
  _onHopLive(ex) {
    const t = (this._blockFrame + ex.hopEndSample - this._blockBase) / sampleRate;
    const f = ex.packed.slice();
    const freq = ex.freqBytes.slice();
    const time = ex.timeBytes.slice();
    this.port.postMessage(
      { type: 'hop', hop: ex.hopIndex, t: t, f: f, freq: freq, time: time },
      [f.buffer, freq.buffer, time.buffer]
    );
  }

  // offline: 出力フレーム i（時刻 s_i = i*sampleRate/fps）のデータは (h+1)*H <= s_i の最大の h のホップ（§6.3）
  _sendFrame(tSec) {
    const LY = MFS_LAYOUT;
    const f = this._prevPacked.slice();
    f[LY.ONSET_FLAGS] = this._accOnset;
    f[LY.BEAT_FLAG] = this._accBeat;
    f[LY.DOWNBEAT_FLAG] = this._accDown;
    const freq = this._prevFreq.slice();
    const time = this._prevTime.slice();
    this.port.postMessage(
      { type: 'frame', index: this._nextIndex, hop: this._prevHop, t: tSec, f: f, freq: freq, time: time },
      [f.buffer, freq.buffer, time.buffer]
    );
    this._nextIndex++;
    this._accOnset = 0;
    this._accBeat = 0;
    this._accDown = 0;
  }

  _onHopOffline(ex) {
    const LY = MFS_LAYOUT;
    const e = ex.hopEndSample;
    const sr = sampleRate;
    // 終端が s_i を超えるホップが完了した時点で、直前のホップの内容でフレーム i を送る
    for (;;) {
      const s = this._nextIndex * sr / this._fps;
      if (!(s < e) || s > this._total + 1) break; // +1 の理由は _finishOffline を参照
      this._sendFrame(s / sr);
    }
    this._prevPacked.set(ex.packed);
    this._prevFreq.set(ex.freqBytes);
    this._prevTime.set(ex.timeBytes);
    this._prevHop = ex.hopIndex;
    const p = ex.packed;
    this._accOnset |= p[LY.ONSET_FLAGS];
    this._accBeat |= p[LY.BEAT_FLAG];
    this._accDown |= p[LY.DOWNBEAT_FLAG];
  }

  // songmap: ホップ完了ごとに 1 行を積み、256 行たまるごとに rows メッセージで送る（§3）
  _onHopSongmap(ex) {
    const R = SONGMAP_ROW;
    const base = this._smCount * R.LENGTH;
    const rows = this._smRows;
    const flux = ex.flux;
    const p = ex.packed;
    for (let i = 0; i < 4; i++) rows[base + R.FLUX + i] = flux[i];
    for (let i = 0; i < 32; i++) rows[base + R.BANDS + i] = p[MFS_LAYOUT.BANDS + i];
    for (let i = 0; i < 12; i++) rows[base + R.CHROMA + i] = p[MFS_LAYOUT.CHROMA + i];
    rows[base + R.ENERGY] = ex.hopEnergy;
    this._smCount++;
    this._smHops++;
    if (this._smCount >= MFS_SONGMAP_BATCH) this._flushSongmapRows();
  }

  _flushSongmapRows() {
    if (this._smCount === 0) return;
    const data = this._smRows.slice(0, this._smCount * SONGMAP_ROW.LENGTH);
    this.port.postMessage(
      { type: 'rows', startHop: this._smStartHop, count: this._smCount, data: data },
      [data.buffer]
    );
    this._smStartHop += this._smCount;
    this._smCount = 0;
  }

  _finishSongmap() {
    this._doneSent = true;
    this._flushSongmapRows();
    this.port.postMessage({ type: 'done', hops: this._smHops });
  }

  _finishOffline() {
    this._doneSent = true;
    // 入力の終わり: 未送信のフレームを最後のホップの内容で全て送る
    for (;;) {
      const s = this._nextIndex * sampleRate / this._fps;
      // デコード時のリサンプリング（例: 48kHz 素材を 44.1kHz で復号）で長さが duration×rate より 1 サンプル短くなることがあり、
      // 最終フレーム（s_i = duration×rate）を失わないよう 1 サンプル分の許容を持たせる（計画書 §6.3、2026-10-03 T16-09）
      if (s > this._total + 1) break;
      this._sendFrame(s / sampleRate);
    }
    this.port.postMessage({ type: 'done' });
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const L = input[0];
    const R = input.length > 1 ? input[1] : null;
    let n = L.length;
    const remain = this._total - this._pushed;
    if (n > remain) n = remain;
    this._blockBase = this._pushed;
    this._blockFrame = currentFrame;
    if (n > 0) {
      this._extractor.pushSamples(L, R, n);
      this._pushed += n;
    }
    if (!this._doneSent && this._pushed >= this._total) {
      if (this._songmap) this._finishSongmap();
      else if (this._offline) this._finishOffline();
    }
    return true;
  }
}
`;

// ワークレットのソース全体を組み立てる。依存クラスは toString() で埋め込む（自己完結の前提は計画書 §2.2）
function buildMfsWorkletSource() {
  return [
    'const MFS_CONST = ' + JSON.stringify(MFS_CONST) + ';',
    'const MFS_LAYOUT = ' + JSON.stringify(MFS_LAYOUT) + ';',
    'const SONGMAP_ROW = ' + JSON.stringify(SONGMAP_ROW) + ';',
    'const MFS_SONGMAP_BATCH = 256;', // rows メッセージ 1 通あたりの行数（計画書 §3）
    mfsDerived.toString(), mfsWindowHann.toString(),
    SpectrumAnalyzer.toString(), MfsFft.toString(), MfsMelBank.toString(), MfsBiquad.toString(),
    MfsOnset.toString(), MfsTempo.toString(), MfsExtractor.toString(),
    MFS_PROCESSOR_SOURCE,
    "registerProcessor('mfs', MfsProcessor);",
  ].join('\n');
}

// ワークレットモジュールの data: URL を生成する
function createMfsWorkletUrl() {
  return 'data:application/javascript;charset=utf-8,' + encodeURIComponent(buildMfsWorkletSource());
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MFS_PROCESSOR_SOURCE, buildMfsWorkletSource, createMfsWorkletUrl };
}
