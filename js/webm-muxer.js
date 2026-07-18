// WebM マクサー（オフライン書き出し用）— ゼロから EBML を組み立てる
//
// js/webm-duration.js は MediaRecorder が出力した WebM に Duration を
// 後付けするパッチ処理だが、本モジュールは映像（VP9/VP8）・音声（Opus）の
// エンコード済みチャンクから WebM ファイル全体を新規に構築する。
// Cues（シーク索引）を書き込むため、Duration パッチのみの録画より
// 編集ソフトでの扱いやすさが向上する。
//
// 外部ライブラリ不使用。ブラウザ依存 API は Blob のみ（Node でも動作可）。

// ── EBML 要素 ID ──
const WEBM_ID_EBML                = [0x1A, 0x45, 0xDF, 0xA3];
const WEBM_ID_EBML_VERSION        = [0x42, 0x86];
const WEBM_ID_EBML_READ_VERSION   = [0x42, 0xF7];
const WEBM_ID_EBML_MAX_ID_LEN     = [0x42, 0xF2];
const WEBM_ID_EBML_MAX_SIZE_LEN   = [0x42, 0xF3];
const WEBM_ID_DOC_TYPE            = [0x42, 0x82];
const WEBM_ID_DOC_TYPE_VERSION    = [0x42, 0x87];
const WEBM_ID_DOC_TYPE_READ_VER   = [0x42, 0x85];

const WEBM_ID_SEGMENT             = [0x18, 0x53, 0x80, 0x67];
const WEBM_ID_INFO                = [0x15, 0x49, 0xA9, 0x66];
const WEBM_ID_TIMECODE_SCALE      = [0x2A, 0xD7, 0xB1];
const WEBM_ID_DURATION            = [0x44, 0x89];
const WEBM_ID_MUXING_APP          = [0x4D, 0x80];
const WEBM_ID_WRITING_APP         = [0x57, 0x41];

const WEBM_ID_TRACKS              = [0x16, 0x54, 0xAE, 0x6B];
const WEBM_ID_TRACK_ENTRY         = [0xAE];
const WEBM_ID_TRACK_NUMBER        = [0xD7];
const WEBM_ID_TRACK_UID           = [0x73, 0xC5];
const WEBM_ID_TRACK_TYPE          = [0x83];
const WEBM_ID_CODEC_ID            = [0x86];
const WEBM_ID_CODEC_PRIVATE       = [0x63, 0xA2];
const WEBM_ID_VIDEO               = [0xE0];
const WEBM_ID_PIXEL_WIDTH         = [0xB0];
const WEBM_ID_PIXEL_HEIGHT        = [0xBA];
const WEBM_ID_AUDIO               = [0xE1];
const WEBM_ID_SAMPLING_FREQ       = [0xB5];
const WEBM_ID_CHANNELS            = [0x9F];

const WEBM_ID_CLUSTER             = [0x1F, 0x43, 0xB6, 0x75];
const WEBM_ID_TIMECODE            = [0xE7];
const WEBM_ID_SIMPLEBLOCK         = [0xA3];

const WEBM_ID_CUES                = [0x1C, 0x53, 0xBB, 0x6B];
const WEBM_ID_CUE_POINT           = [0xBB];
const WEBM_ID_CUE_TIME            = [0xB3];
const WEBM_ID_CUE_TRACK_POSITIONS = [0xB7];
const WEBM_ID_CUE_TRACK           = [0xF7];
const WEBM_ID_CUE_CLUSTER_POS     = [0xF1];

const WEBM_TRACK_TYPE_VIDEO = 1;
const WEBM_TRACK_TYPE_AUDIO = 2;
const WEBM_TRACK_NUMBER_VIDEO = 1;
const WEBM_TRACK_NUMBER_AUDIO = 2;

const WEBM_TIMECODE_SCALE = 1000000; // 1 tick = 1ms
const WEBM_CUE_POS_BYTES = 8;        // CueClusterPosition のデータ幅（固定長。後から実値を書き込む）
const WEBM_CLUSTER_MAX_REL_MS = 32000; // SimpleBlock の相対タイムコード（int16）安全マージン

// ── バイト列ヘルパー ──

function _concatBytes(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

// EBML「サイズ」vint（先頭ビットで長さを示す）。最小バイト数で符号化する。
function _sizeVint(value) {
  for (let len = 1; len <= 8; len++) {
    const max = Math.pow(2, 7 * len) - 2;
    if (value <= max) {
      const out = new Uint8Array(len);
      let v = value;
      for (let i = len - 1; i > 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
      out[0] = v | (0x80 >> (len - 1));
      return out;
    }
  }
  throw new Error('WebmMuxer: element size too large');
}

// EBML 符号なし整数要素のデータ本体（vint マーカーなし、最小バイト長のビッグエンディアン）
function _uintBytes(value) {
  value = Math.max(0, Math.round(value));
  if (value === 0) return new Uint8Array([0]);
  const bytes = [];
  let v = value;
  while (v > 0) { bytes.unshift(v % 256); v = Math.floor(v / 256); }
  return new Uint8Array(bytes);
}

function _float64Bytes(value) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false);
  return new Uint8Array(buf);
}

function _utf8Bytes(str) {
  return new TextEncoder().encode(str);
}

// 1要素 = ID + サイズvint + データ
function _elem(idArray, dataBytes) {
  const id = idArray instanceof Uint8Array ? idArray : new Uint8Array(idArray);
  const size = _sizeVint(dataBytes.length);
  const out = new Uint8Array(id.length + size.length + dataBytes.length);
  out.set(id, 0);
  out.set(size, id.length);
  out.set(dataBytes, id.length + size.length);
  return out;
}

// SimpleBlock 内のトラック番号 vint（本実装ではトラック 1 / 2 のみ使用）
function _trackVint(trackNumber) {
  return new Uint8Array([0x80 | trackNumber]);
}

class WebmMuxer {
  // opts: { width, height, videoCodecId('V_VP9'|'V_VP8'), audioCodecId('A_OPUS'|null),
  //         sampleRate, channels, audioCodecPrivate(Uint8Array|null) }
  constructor(opts) {
    this._width = opts.width;
    this._height = opts.height;
    this._videoCodecId = opts.videoCodecId || 'V_VP9';
    this._audioCodecId = opts.audioCodecId || null;
    this._sampleRate = opts.sampleRate || 48000;
    this._channels = opts.channels || 2;
    this._audioCodecPrivate = opts.audioCodecPrivate || null;
    this._videoChunks = [];
    this._audioChunks = [];
  }

  addVideoChunk(data, timestampUs, keyframe) {
    this._videoChunks.push({ data, timestampUs, keyframe: !!keyframe });
  }

  addAudioChunk(data, timestampUs) {
    this._audioChunks.push({ data, timestampUs });
  }

  // durationMs: コンテナに書き込む正確な再生時間（呼び出し側が既知の値を渡す）
  finalize(durationMs) {
    const ebmlHeader = this._buildEbmlHeader();
    const infoElem = this._buildInfo(durationMs);
    const tracksElem = this._buildTracks();
    const clusters = this._buildClusterGroups();
    const clusterBytesList = clusters.map((cl) => this._buildClusterBytes(cl));

    const cuePoints = clusters.map((cl) => this._buildCuePoint(Math.round(cl.baseMs)));
    const cuesContent = _concatBytes(cuePoints.map((cp) => cp.bytes));
    const cuesElem = _elem(WEBM_ID_CUES, cuesContent);

    // 各 CuePoint の cuesElem 内での開始位置を求める
    const cuesElemHeaderLen = cuesElem.length - cuesContent.length;
    let acc = 0;
    const cuePointStartInCuesContent = cuePoints.map((cp) => {
      const start = acc;
      acc += cp.bytes.length;
      return start;
    });

    // クラスタの byte オフセット（Segment データ先頭からの相対位置）
    let offset = infoElem.length + tracksElem.length + cuesElem.length;
    const clusterOffsets = clusterBytesList.map((cb) => {
      const o = offset;
      offset += cb.length;
      return o;
    });

    // Cues 内の CueClusterPosition プレースホルダへ実値を書き込む
    const cuesView = new DataView(cuesElem.buffer, cuesElem.byteOffset, cuesElem.byteLength);
    for (let i = 0; i < cuePoints.length; i++) {
      // 各 CuePoint は構造上、末尾 WEBM_CUE_POS_BYTES バイトが CueClusterPosition のデータ
      const posInCuesElem = cuesElemHeaderLen + cuePointStartInCuesContent[i] +
        (cuePoints[i].bytes.length - WEBM_CUE_POS_BYTES);
      cuesView.setBigUint64(posInCuesElem, BigInt(clusterOffsets[i]), false);
    }

    const segmentContent = _concatBytes([infoElem, tracksElem, cuesElem, ...clusterBytesList]);
    const segmentElem = _elem(WEBM_ID_SEGMENT, segmentContent);
    const fileBytes = _concatBytes([ebmlHeader, segmentElem]);
    return new Blob([fileBytes], { type: 'video/webm' });
  }

  // ── 内部構築処理 ──

  _buildEbmlHeader() {
    const content = _concatBytes([
      _elem(WEBM_ID_EBML_VERSION, _uintBytes(1)),
      _elem(WEBM_ID_EBML_READ_VERSION, _uintBytes(1)),
      _elem(WEBM_ID_EBML_MAX_ID_LEN, _uintBytes(4)),
      _elem(WEBM_ID_EBML_MAX_SIZE_LEN, _uintBytes(8)),
      _elem(WEBM_ID_DOC_TYPE, _utf8Bytes('webm')),
      _elem(WEBM_ID_DOC_TYPE_VERSION, _uintBytes(4)),
      _elem(WEBM_ID_DOC_TYPE_READ_VER, _uintBytes(2)),
    ]);
    return _elem(WEBM_ID_EBML, content);
  }

  _buildInfo(durationMs) {
    const content = _concatBytes([
      _elem(WEBM_ID_TIMECODE_SCALE, _uintBytes(WEBM_TIMECODE_SCALE)),
      _elem(WEBM_ID_DURATION, _float64Bytes(durationMs)),
      _elem(WEBM_ID_MUXING_APP, _utf8Bytes('AudioVisualAnalyzer OfflineExporter')),
      _elem(WEBM_ID_WRITING_APP, _utf8Bytes('AudioVisualAnalyzer')),
    ]);
    return _elem(WEBM_ID_INFO, content);
  }

  _buildTracks() {
    const videoContent = _concatBytes([
      _elem(WEBM_ID_TRACK_NUMBER, _uintBytes(WEBM_TRACK_NUMBER_VIDEO)),
      _elem(WEBM_ID_TRACK_UID, _uintBytes(WEBM_TRACK_NUMBER_VIDEO)),
      _elem(WEBM_ID_TRACK_TYPE, _uintBytes(WEBM_TRACK_TYPE_VIDEO)),
      _elem(WEBM_ID_CODEC_ID, _utf8Bytes(this._videoCodecId)),
      _elem(WEBM_ID_VIDEO, _concatBytes([
        _elem(WEBM_ID_PIXEL_WIDTH, _uintBytes(this._width)),
        _elem(WEBM_ID_PIXEL_HEIGHT, _uintBytes(this._height)),
      ])),
    ]);
    const entries = [_elem(WEBM_ID_TRACK_ENTRY, videoContent)];

    if (this._audioCodecId) {
      const parts = [
        _elem(WEBM_ID_TRACK_NUMBER, _uintBytes(WEBM_TRACK_NUMBER_AUDIO)),
        _elem(WEBM_ID_TRACK_UID, _uintBytes(WEBM_TRACK_NUMBER_AUDIO)),
        _elem(WEBM_ID_TRACK_TYPE, _uintBytes(WEBM_TRACK_TYPE_AUDIO)),
        _elem(WEBM_ID_CODEC_ID, _utf8Bytes(this._audioCodecId)),
      ];
      if (this._audioCodecPrivate && this._audioCodecPrivate.length > 0) {
        parts.push(_elem(WEBM_ID_CODEC_PRIVATE, this._audioCodecPrivate));
      }
      parts.push(_elem(WEBM_ID_AUDIO, _concatBytes([
        _elem(WEBM_ID_SAMPLING_FREQ, _float64Bytes(this._sampleRate)),
        _elem(WEBM_ID_CHANNELS, _uintBytes(this._channels)),
      ])));
      entries.push(_elem(WEBM_ID_TRACK_ENTRY, _concatBytes(parts)));
    }

    return _elem(WEBM_ID_TRACKS, _concatBytes(entries));
  }

  // 映像と音声のチャンクをタイムスタンプ順にマージし、映像キーフレームを境に
  // クラスタへ分割する（相対タイムコードの範囲超過時も安全のため分割する）。
  _buildClusterGroups() {
    const video = this._videoChunks;
    const audio = this._audioChunks;
    const merged = [];
    let vi = 0, ai = 0;
    while (vi < video.length || ai < audio.length) {
      const v = video[vi], a = audio[ai];
      if (v && (!a || v.timestampUs <= a.timestampUs)) { merged.push({ type: 'v', c: v }); vi++; }
      else { merged.push({ type: 'a', c: a }); ai++; }
    }

    const clusters = [];
    let cur = null;
    for (const m of merged) {
      const tsMs = m.c.timestampUs / 1000;
      const isVideo = m.type === 'v';
      const isKeyStart = isVideo && m.c.keyframe;

      if (cur && !isKeyStart) {
        const rel = tsMs - cur.baseMs;
        if (rel > WEBM_CLUSTER_MAX_REL_MS || rel < 0) cur = null;
      }
      if (!cur || isKeyStart) {
        cur = { baseMs: tsMs, entries: [] };
        clusters.push(cur);
      }
      cur.entries.push({
        track: isVideo ? WEBM_TRACK_NUMBER_VIDEO : WEBM_TRACK_NUMBER_AUDIO,
        relMs: Math.round(tsMs - cur.baseMs),
        keyframe: isVideo ? m.c.keyframe : true,
        data: m.c.data,
      });
    }
    return clusters;
  }

  _buildClusterBytes(cluster) {
    const timecodeElem = _elem(WEBM_ID_TIMECODE, _uintBytes(Math.round(cluster.baseMs)));
    const blockElems = cluster.entries.map((e) => _elem(WEBM_ID_SIMPLEBLOCK, this._buildSimpleBlock(e)));
    const content = _concatBytes([timecodeElem, ...blockElems]);
    return _elem(WEBM_ID_CLUSTER, content);
  }

  _buildSimpleBlock(entry) {
    const trackVint = _trackVint(entry.track);
    const tcBytes = new Uint8Array(2);
    new DataView(tcBytes.buffer).setInt16(0, entry.relMs | 0, false);
    const flags = new Uint8Array([entry.keyframe ? 0x80 : 0x00]);
    return _concatBytes([trackVint, tcBytes, flags, entry.data]);
  }

  // CueClusterPosition は末尾 WEBM_CUE_POS_BYTES バイトに来るよう構造を固定する
  // （CueTrackPositions の子を [CueTrack, CueClusterPosition] の順、
  //   CuePoint の子を [CueTime, CueTrackPositions] の順で組むことで保証する）
  _buildCuePoint(timeMs) {
    const cueTimeElem = _elem(WEBM_ID_CUE_TIME, _uintBytes(timeMs));
    const cueTrackElem = _elem(WEBM_ID_CUE_TRACK, _uintBytes(WEBM_TRACK_NUMBER_VIDEO));
    const posPlaceholder = new Uint8Array(WEBM_CUE_POS_BYTES);
    const cueClusterPosElem = _elem(WEBM_ID_CUE_CLUSTER_POS, posPlaceholder);
    const trackPosContent = _concatBytes([cueTrackElem, cueClusterPosElem]);
    const trackPosElem = _elem(WEBM_ID_CUE_TRACK_POSITIONS, trackPosContent);
    const cuePointContent = _concatBytes([cueTimeElem, trackPosElem]);
    const bytes = _elem(WEBM_ID_CUE_POINT, cuePointContent);
    return { bytes };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebmMuxer };
}
