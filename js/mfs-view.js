// 音楽特徴ストリーム（MFS）のメインスレッド側ビュー・音量自動補正・レイヤー分割 — doc/20260928-plan-phase16-music-feature-stream.md §6.4 / §6.5 / §5.8
//
// 依存グローバル: MFS_CONST / MFS_LAYOUT（js/mfs-const.js）、computeFreqRange（js/vis-utils.js）。
// 毎フレーム呼ばれる経路（setPacked・getter・applyAutoGain・computeLayerRange）では配列・オブジェクトを生成しない。

// ── MfsFrameView（§6.4） ──
// 読み取り専用の getter 群。raw の中身を差し替えるだけで全プロパティが最新値を返す。

class MfsOnsetView {
  constructor(raw) {
    this._raw = raw;
    this.env = raw.subarray(MFS_LAYOUT.ONSET_ENV, MFS_LAYOUT.ONSET_ENV + 4);
  }
  get flags() { return this._raw[MFS_LAYOUT.ONSET_FLAGS]; }
}

class MfsTempoView {
  constructor(raw) { this._raw = raw; }
  get bpm() { return this._raw[MFS_LAYOUT.BPM]; }
  get confidence() { return this._raw[MFS_LAYOUT.TEMPO_CONF]; }
  get beatPhase() { return this._raw[MFS_LAYOUT.BEAT_PHASE]; }
  get barPhase() { return this._raw[MFS_LAYOUT.BAR_PHASE]; }
  get beatInBar() { return this._raw[MFS_LAYOUT.BEAT_IN_BAR]; }
  get beatFlag() { return this._raw[MFS_LAYOUT.BEAT_FLAG] >= 0.5; }
  get downbeatFlag() { return this._raw[MFS_LAYOUT.DOWNBEAT_FLAG] >= 0.5; }
  get locked() { return this._raw[MFS_LAYOUT.TEMPO_LOCKED] >= 0.5; }
}

class MfsStereoView {
  constructor(raw) {
    this._raw = raw;
    this.pan = raw.subarray(MFS_LAYOUT.STEREO_PAN, MFS_LAYOUT.STEREO_PAN + 3);
  }
  get correlation() { return this._raw[MFS_LAYOUT.STEREO_CORR]; }
  get width() { return this._raw[MFS_LAYOUT.STEREO_WIDTH]; }
  get balance() { return this._raw[MFS_LAYOUT.STEREO_BALANCE]; }
}

class MfsTimbreView {
  constructor(raw) { this._raw = raw; }
  get centroid() { return this._raw[MFS_LAYOUT.CENTROID]; }
  get flatness() { return this._raw[MFS_LAYOUT.FLATNESS]; }
  get rolloff() { return this._raw[MFS_LAYOUT.ROLLOFF]; }
}

class MfsLoudnessView {
  constructor(raw) { this._raw = raw; }
  get momentary() { return this._raw[MFS_LAYOUT.LOUD_MOMENTARY]; }
  get shortTerm() { return this._raw[MFS_LAYOUT.LOUD_SHORT]; }
  get level() { return this._raw[MFS_LAYOUT.LEVEL]; }
  get agcDb() { return this._raw[MFS_LAYOUT.AGC_DB]; }
}

class MfsFrameView {
  constructor() {
    const raw = new Float32Array(MFS_LAYOUT.LENGTH);
    this.raw = raw;
    this.bands = raw.subarray(MFS_LAYOUT.BANDS, MFS_LAYOUT.BANDS + 32);
    this.bandsSmooth = raw.subarray(MFS_LAYOUT.BANDS_SMOOTH, MFS_LAYOUT.BANDS_SMOOTH + 32);
    this.onset = new MfsOnsetView(raw);
    this.tempo = new MfsTempoView(raw);
    this.stereo = new MfsStereoView(raw);
    this.timbre = new MfsTimbreView(raw);
    this.chroma = raw.subarray(MFS_LAYOUT.CHROMA, MFS_LAYOUT.CHROMA + 12);
    this.loudness = new MfsLoudnessView(raw);
  }
  get rms() { return this.raw[MFS_LAYOUT.RMS]; }
  get peak() { return this.raw[MFS_LAYOUT.PEAK]; }

  // packed（長さ LENGTH の Float32Array）の中身を内部バッファへコピーする。割り当てなし
  setPacked(f) {
    this.raw.set(f);
    return this;
  }
}

// ── 音量自動補正（§5.8）。out へ書き込んで返す。out は freqIn と同じ長さの Uint8Array 等 ──
function applyAutoGain(freqIn, agcDb, out) {
  const add = Math.round(agcDb * 255 / (MFS_CONST.LEGACY_MAX_DB - MFS_CONST.LEGACY_MIN_DB));
  for (let i = 0; i < freqIn.length; i++) out[i] = Math.min(255, Math.max(0, freqIn[i] + add));
  return out;
}

// ── レイヤー分割（§6.5） ──
// computeFreqRange の結果は (sampleRate, fftSize) ごとに1回だけ求めて保持する（毎回のオブジェクト生成を避ける）
let _mfsLayerCacheSr = 0;
let _mfsLayerCacheFft = 0;
let _mfsLayerStartBin = 0;

function _mfsMel(f) { return 2595 * Math.log10(1 + f / 700); }
function _mfsMelInv(m) { return 700 * (Math.pow(10, m / 2595) - 1); }

// メル等分の境界 j（0..count）を freq スライス内のビン番号へ。[0, sliceLen] にクランプ
function _mfsMelBoundary(j, count, sliceLen, sampleRate, fftSize, startBin) {
  const m0 = _mfsMel(MFS_CONST.FREQ_MIN_HZ);
  const m1 = _mfsMel(MFS_CONST.FREQ_MAX_HZ);
  const f = _mfsMelInv(m0 + j * (m1 - m0) / count);
  const bin = Math.round(f * fftSize / sampleRate) - startBin;
  return Math.min(sliceLen, Math.max(0, bin));
}

// out: 長さ2の Int32Array。[start, end)（freq スライス内の添字）を書き込んで out を返す
function computeLayerRange(i, count, sliceLen, sampleRate, fftSize, mode, out) {
  if (mode !== 'mel') {
    out[0] = Math.floor(i * sliceLen / count);
    out[1] = Math.floor((i + 1) * sliceLen / count);
    return out;
  }
  if (_mfsLayerCacheSr !== sampleRate || _mfsLayerCacheFft !== fftSize) {
    _mfsLayerStartBin = computeFreqRange(sampleRate, fftSize / 2).startBin;
    _mfsLayerCacheSr = sampleRate;
    _mfsLayerCacheFft = fftSize;
  }
  const startBin = _mfsLayerStartBin;
  // 各レイヤー最低1ビン: 境界 b_j を b_(j-1)+1 以上に繰り上げる（隙間・重なりなし）。
  // 末尾側に1ビンずつ残せる上限 sliceLen-(count-j) も超えないようにする（sliceLen ≥ count のとき）。
  // 先頭から i+1 番目の境界まで順に求める（配列を作らない）
  let prev = 0;
  let cur = 0;
  for (let j = 1; j <= i + 1; j++) {
    cur = (j === count) ? sliceLen : _mfsMelBoundary(j, count, sliceLen, sampleRate, fftSize, startBin);
    if (cur < prev + 1) cur = prev + 1;
    const cap = sliceLen - (count - j);
    if (j < count && cap >= j && cur > cap) cur = cap;
    if (j < i + 1) prev = cur;
  }
  out[0] = prev;
  out[1] = cur;
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MfsFrameView, applyAutoGain, computeLayerRange };
}
