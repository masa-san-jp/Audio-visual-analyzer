// WebM デマルチプレクサ（Phase 14.1）
//
// WebM（EBML）を解析し、映像トラックの符号化チャンク列を取り出す。
// オフライン書き出しの動画合成で WebCodecs VideoDecoder へ供給するために使う。
// 外部ライブラリ不使用。js/webm-muxer.js（書き込み側）と対になる読み取り側の実装。
//
// MediaRecorder のストリーミング出力は Segment / Cluster が不定長（unknown-size）
// になるため、「次の同レベル要素 ID の出現 or EOF まで」を終端とみなして走査する。
//
// 対応コーデック: V_VP8 / V_VP9。それ以外・解析不能なファイルは例外を投げ、
// 呼び出し側（offline-exporter.js）が既存のシーク方式へフォールバックする。

// 要素 ID（ID は長さマーカーを含んだ数値として扱う）
const WDMX_ID_EBML          = 0x1A45DFA3;
const WDMX_ID_SEGMENT       = 0x18538067;
const WDMX_ID_INFO          = 0x1549A966;
const WDMX_ID_TIMESTAMP_SCALE = 0x2AD7B1;
const WDMX_ID_TRACKS        = 0x1654AE6B;
const WDMX_ID_TRACK_ENTRY   = 0xAE;
const WDMX_ID_TRACK_NUMBER  = 0xD7;
const WDMX_ID_TRACK_TYPE    = 0x83;
const WDMX_ID_CODEC_ID      = 0x86;
const WDMX_ID_VIDEO         = 0xE0;
const WDMX_ID_PIXEL_WIDTH   = 0xB0;
const WDMX_ID_PIXEL_HEIGHT  = 0xBA;
const WDMX_ID_CLUSTER       = 0x1F43B675;
const WDMX_ID_TIMESTAMP     = 0xE7;
const WDMX_ID_SIMPLEBLOCK   = 0xA3;
const WDMX_ID_BLOCKGROUP    = 0xA0;
const WDMX_ID_BLOCK         = 0xA1;
const WDMX_ID_REFERENCEBLOCK = 0xFB;

// Segment 直下に現れうる要素（不定長 Cluster の終端判定に使う）
const WDMX_SEGMENT_LEVEL_IDS = new Set([
  WDMX_ID_INFO, WDMX_ID_TRACKS, WDMX_ID_CLUSTER,
  0x1C53BB6B, // Cues
  0x114D9B74, // SeekHead
  0x1254C367, // Tags
  0x1043A770, // Chapters
  0x1941A469, // Attachments
]);

class WebmDemuxer {
  // bytes: Uint8Array
  // 戻り値: { codec, codedWidth, codedHeight, chunks: [{data, timestampUs, keyframe}] }
  static parse(bytes) {
    const dmx = new WebmDemuxer(bytes);
    return dmx._parse();
  }

  constructor(bytes) {
    this._b = bytes;
    this._timestampScaleNs = 1000000; // 既定 1ms
    this._videoTrackNumber = -1;
    this._codecId = null;
    this._codedWidth = 0;
    this._codedHeight = 0;
    this._chunks = [];
  }

  _parse() {
    const b = this._b;
    let pos = 0;

    // EBML ヘッダー
    const ebml = this._readElementHeader(pos);
    if (!ebml || ebml.id !== WDMX_ID_EBML) throw new Error('WebM ではありません（EBMLヘッダーなし）');
    pos = ebml.dataStart + ebml.size;

    // Segment
    const seg = this._readElementHeader(pos);
    if (!seg || seg.id !== WDMX_ID_SEGMENT) throw new Error('Segment がありません');
    const segEnd = seg.unknownSize ? b.length : Math.min(b.length, seg.dataStart + seg.size);
    pos = seg.dataStart;

    while (pos < segEnd) {
      const el = this._readElementHeader(pos);
      if (!el) break;
      if (el.id === WDMX_ID_INFO) {
        this._parseInfo(el.dataStart, el.dataStart + el.size);
        pos = el.dataStart + el.size;
      } else if (el.id === WDMX_ID_TRACKS) {
        this._parseTracks(el.dataStart, el.dataStart + el.size);
        pos = el.dataStart + el.size;
      } else if (el.id === WDMX_ID_CLUSTER) {
        pos = this._parseCluster(el, segEnd);
      } else {
        if (el.unknownSize) throw new Error('不定長の未対応要素があります');
        pos = el.dataStart + el.size;
      }
    }

    if (this._videoTrackNumber < 0) throw new Error('映像トラックがありません');
    let codec;
    if (this._codecId === 'V_VP8') codec = 'vp8';
    else if (this._codecId === 'V_VP9') codec = 'vp09.00.10.08';
    else throw new Error('未対応の映像コーデックです: ' + this._codecId);
    if (this._chunks.length === 0) throw new Error('映像チャンクがありません');

    return {
      codec,
      codedWidth: this._codedWidth,
      codedHeight: this._codedHeight,
      chunks: this._chunks,
    };
  }

  _parseInfo(start, end) {
    let pos = start;
    while (pos < end) {
      const el = this._readElementHeader(pos);
      if (!el || el.unknownSize) break;
      if (el.id === WDMX_ID_TIMESTAMP_SCALE) {
        this._timestampScaleNs = this._readUint(el.dataStart, el.size);
      }
      pos = el.dataStart + el.size;
    }
  }

  _parseTracks(start, end) {
    let pos = start;
    while (pos < end) {
      const el = this._readElementHeader(pos);
      if (!el || el.unknownSize) break;
      if (el.id === WDMX_ID_TRACK_ENTRY) {
        this._parseTrackEntry(el.dataStart, el.dataStart + el.size);
      }
      pos = el.dataStart + el.size;
    }
  }

  _parseTrackEntry(start, end) {
    let pos = start;
    let trackNumber = -1;
    let trackType = -1;
    let codecId = null;
    let width = 0, height = 0;
    while (pos < end) {
      const el = this._readElementHeader(pos);
      if (!el || el.unknownSize) break;
      if (el.id === WDMX_ID_TRACK_NUMBER) trackNumber = this._readUint(el.dataStart, el.size);
      else if (el.id === WDMX_ID_TRACK_TYPE) trackType = this._readUint(el.dataStart, el.size);
      else if (el.id === WDMX_ID_CODEC_ID) codecId = this._readString(el.dataStart, el.size);
      else if (el.id === WDMX_ID_VIDEO) {
        let vp = el.dataStart;
        const vend = el.dataStart + el.size;
        while (vp < vend) {
          const ve = this._readElementHeader(vp);
          if (!ve || ve.unknownSize) break;
          if (ve.id === WDMX_ID_PIXEL_WIDTH) width = this._readUint(ve.dataStart, ve.size);
          else if (ve.id === WDMX_ID_PIXEL_HEIGHT) height = this._readUint(ve.dataStart, ve.size);
          vp = ve.dataStart + ve.size;
        }
      }
      pos = el.dataStart + el.size;
    }
    // 最初に見つかった映像トラック（TrackType=1）を採用する
    if (trackType === 1 && this._videoTrackNumber < 0) {
      this._videoTrackNumber = trackNumber;
      this._codecId = codecId;
      this._codedWidth = width;
      this._codedHeight = height;
    }
  }

  // Cluster を解析し、次の走査位置を返す（不定長 Cluster に対応）
  _parseCluster(clusterEl, segEnd) {
    const b = this._b;
    const knownEnd = clusterEl.unknownSize ? segEnd : Math.min(segEnd, clusterEl.dataStart + clusterEl.size);
    let pos = clusterEl.dataStart;
    let clusterTimestamp = 0;

    while (pos < knownEnd) {
      const el = this._readElementHeader(pos);
      if (!el) break;
      // 不定長 Cluster: Segment 直下レベルの要素が現れたらそこで終端
      if (clusterEl.unknownSize && WDMX_SEGMENT_LEVEL_IDS.has(el.id)) {
        return pos;
      }
      if (el.id === WDMX_ID_TIMESTAMP) {
        clusterTimestamp = this._readUint(el.dataStart, el.size);
      } else if (el.id === WDMX_ID_SIMPLEBLOCK) {
        this._parseBlockPayload(el.dataStart, el.size, clusterTimestamp, null);
      } else if (el.id === WDMX_ID_BLOCKGROUP) {
        this._parseBlockGroup(el.dataStart, el.dataStart + el.size, clusterTimestamp);
      } else if (el.unknownSize) {
        throw new Error('不定長の未対応要素があります');
      }
      pos = el.dataStart + el.size;
      if (el.unknownSize) break;
    }
    return clusterEl.unknownSize ? Math.min(pos, b.length) : knownEnd;
  }

  _parseBlockGroup(start, end, clusterTimestamp) {
    let pos = start;
    let blockEl = null;
    let hasReference = false;
    while (pos < end) {
      const el = this._readElementHeader(pos);
      if (!el || el.unknownSize) break;
      if (el.id === WDMX_ID_BLOCK) blockEl = el;
      else if (el.id === WDMX_ID_REFERENCEBLOCK) hasReference = true;
      pos = el.dataStart + el.size;
    }
    if (blockEl) {
      // Block はフラグにキーフレームビットを持たないため、ReferenceBlock の有無で判定する
      this._parseBlockPayload(blockEl.dataStart, blockEl.size, clusterTimestamp, !hasReference);
    }
  }

  // SimpleBlock / Block のペイロードを解析してチャンクを追加する
  // keyframeOverride: BlockGroup 由来の場合のキーフレーム判定（SimpleBlock は null でフラグから読む）
  _parseBlockPayload(start, size, clusterTimestamp, keyframeOverride) {
    const b = this._b;
    const track = this._readVint(start);
    if (!track) return;
    let pos = start + track.length;
    if (track.value !== this._videoTrackNumber) return;

    const relTime = ((b[pos] << 8) | b[pos + 1]) << 16 >> 16; // signed 16bit
    const flags = b[pos + 2];
    pos += 3;
    if ((flags & 0x06) !== 0) throw new Error('レーシングされた Block は未対応です');

    const keyframe = keyframeOverride != null ? keyframeOverride : !!(flags & 0x80);
    const dataEnd = start + size;
    const data = b.slice(pos, dataEnd);
    const timestampTicks = clusterTimestamp + relTime;
    const timestampUs = Math.round(timestampTicks * this._timestampScaleNs / 1000);
    this._chunks.push({ data, timestampUs, keyframe });
  }

  // ── 低レベル読み取り ──

  // 要素ヘッダー（ID + サイズ vint）。範囲外なら null
  _readElementHeader(pos) {
    const b = this._b;
    if (pos >= b.length) return null;
    const id = this._readId(pos);
    if (!id) return null;
    const size = this._readVint(pos + id.length);
    if (!size) return null;
    return {
      id: id.value,
      dataStart: pos + id.length + size.length,
      size: size.unknown ? (b.length - (pos + id.length + size.length)) : size.value,
      unknownSize: !!size.unknown,
    };
  }

  // 要素 ID（長さマーカー込みの数値）
  _readId(pos) {
    const b = this._b;
    const first = b[pos];
    if (first === undefined || first === 0) return null;
    let length = 1;
    let mask = 0x80;
    while (!(first & mask) && length <= 4) { length++; mask >>= 1; }
    if (length > 4 || pos + length > b.length) return null;
    let value = 0;
    for (let i = 0; i < length; i++) value = value * 256 + b[pos + i];
    return { value, length };
  }

  // サイズ vint（値は長さマーカーを除く）。全ビット1は不定長
  _readVint(pos) {
    const b = this._b;
    const first = b[pos];
    if (first === undefined || first === 0) return null;
    let length = 1;
    let mask = 0x80;
    while (!(first & mask) && length <= 8) { length++; mask >>= 1; }
    if (length > 8 || pos + length > b.length) return null;
    let value = first & (mask - 1);
    let allOnes = (first & (mask - 1)) === mask - 1;
    for (let i = 1; i < length; i++) {
      value = value * 256 + b[pos + i];
      if (b[pos + i] !== 0xFF) allOnes = false;
    }
    return { value, length, unknown: allOnes };
  }

  _readUint(pos, size) {
    const b = this._b;
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + b[pos + i];
    return value;
  }

  _readString(pos, size) {
    let s = '';
    for (let i = 0; i < size; i++) s += String.fromCharCode(this._b[pos + i]);
    return s.replace(/\0+$/, '');
  }
}
