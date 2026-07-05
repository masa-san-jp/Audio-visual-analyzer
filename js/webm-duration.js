// WebM Duration パッチモジュール
// MediaRecorder が出力する WebM は Segment > Info に Duration 要素を持たないため、
// 再生時間が「不明」なファイルとなり、編集ソフトでの長さ表示やシークに支障が出る。
// このモジュールは EBML 構造を最小限パースし、Info に Duration を書き込む。
// パースに失敗した場合や想定外の構造の場合は、元の Blob をそのまま返す（安全側）。

// EBML 要素 ID
const EBML_ID_HEADER         = 0x1A45DFA3; // EBML ヘッダー
const EBML_ID_SEGMENT        = 0x18538067; // Segment
const EBML_ID_INFO           = 0x1549A966; // Segment > Info
const EBML_ID_CLUSTER        = 0x1F43B675; // Segment > Cluster
const EBML_ID_TIMECODE_SCALE = 0x2AD7B1;   // Info > TimecodeScale
const EBML_ID_DURATION       = 0x4489;     // Info > Duration

// Duration 要素の全長: ID(2) + サイズ(1) + float64(8)
const DURATION_ELEMENT_LENGTH = 11;

// value を length バイトの EBML サイズ vint としてエンコードする。
// length バイトで表現できない場合は null を返す（全ビット1は unknown 扱いのため除外）。
function _encodeEbmlSize(value, length) {
  const max = Math.pow(2, 7 * length) - 2;
  if (value > max) return null;
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i > 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] = v | (0x80 >> (length - 1));
  return out;
}

// blob（WebM）の Info に Duration（ミリ秒基準）を書き込んだ新しい Blob を返す
async function patchWebmDuration(blob, durationMs) {
  if (!blob || !isFinite(durationMs) || durationMs <= 0) return blob;

  // Info は先頭付近にあるため、ヘッダー部分のみ読み込む
  const HEAD_LIMIT = Math.min(blob.size, 4 * 1024 * 1024);
  const head = new Uint8Array(await blob.slice(0, HEAD_LIMIT).arrayBuffer());

  const idLength = (b) => {
    if (b & 0x80) return 1;
    if (b & 0x40) return 2;
    if (b & 0x20) return 3;
    if (b & 0x10) return 4;
    return 0;
  };

  const readId = (pos) => {
    if (pos >= head.length) return null;
    const len = idLength(head[pos]);
    if (!len || pos + len > head.length) return null;
    let value = 0;
    for (let i = 0; i < len; i++) value = value * 256 + head[pos + i];
    return { value, length: len };
  };

  const readSize = (pos) => {
    if (pos >= head.length) return null;
    let len = 0;
    for (let i = 0; i < 8; i++) {
      if (head[pos] & (0x80 >> i)) { len = i + 1; break; }
    }
    if (!len || pos + len > head.length) return null;
    let value = head[pos] & (0xFF >> len);
    let allOnes = value === (0xFF >> len);
    for (let i = 1; i < len; i++) {
      value = value * 256 + head[pos + i];
      if (head[pos + i] !== 0xFF) allOnes = false;
    }
    return { value, length: len, unknown: allOnes };
  };

  // ── EBML ヘッダーをスキップ ──
  const ebmlId = readId(0);
  if (!ebmlId || ebmlId.value !== EBML_ID_HEADER) return blob;
  const ebmlSize = readSize(ebmlId.length);
  if (!ebmlSize || ebmlSize.unknown) return blob;
  let pos = ebmlId.length + ebmlSize.length + ebmlSize.value;

  // ── Segment ──
  const segId = readId(pos);
  if (!segId || segId.value !== EBML_ID_SEGMENT) return blob;
  const segSizePos = pos + segId.length;
  const segSize = readSize(segSizePos);
  if (!segSize) return blob;
  pos = segSizePos + segSize.length;

  // ── Segment 直下から Info を探す ──
  let info = null;
  while (pos < head.length) {
    const id = readId(pos);
    if (!id) return blob;
    const size = readSize(pos + id.length);
    if (!size || size.unknown) return blob;
    const dataStart = pos + id.length + size.length;
    if (id.value === EBML_ID_INFO) {
      info = { sizePos: pos + id.length, sizeLen: size.length, dataStart, dataSize: size.value };
      break;
    }
    if (id.value === EBML_ID_CLUSTER) return blob; // Cluster まで到達: Info なし
    pos = dataStart + size.value;
  }
  if (!info) return blob;
  const infoEnd = info.dataStart + info.dataSize;
  if (infoEnd > head.length) return blob;

  // ── Info 内をスキャン: TimecodeScale と既存 Duration ──
  let timecodeScale = 1000000; // 既定値 1ms
  let durationPos = -1;
  let durationLen = 0;
  pos = info.dataStart;
  while (pos < infoEnd) {
    const id = readId(pos);
    if (!id) return blob;
    const size = readSize(pos + id.length);
    if (!size || size.unknown) return blob;
    const dataStart = pos + id.length + size.length;
    if (id.value === EBML_ID_TIMECODE_SCALE) {
      let v = 0;
      for (let i = 0; i < size.value && dataStart + i < head.length; i++) {
        v = v * 256 + head[dataStart + i];
      }
      if (v > 0) timecodeScale = v;
    } else if (id.value === EBML_ID_DURATION) {
      durationPos = dataStart;
      durationLen = size.value;
    }
    pos = dataStart + size.value;
  }

  // Duration は TimecodeScale 単位（既定では ms）の float
  const durationTicks = durationMs * 1000000 / timecodeScale;

  // ── 既存 Duration があれば同サイズで上書き ──
  if (durationPos >= 0) {
    const view = new DataView(head.buffer);
    if (durationLen === 8) view.setFloat64(durationPos, durationTicks);
    else if (durationLen === 4) view.setFloat32(durationPos, durationTicks);
    else return blob;
    return new Blob([head, blob.slice(HEAD_LIMIT)], { type: blob.type });
  }

  // ── Duration 要素を Info 末尾に挿入 ──
  const durationElement = new Uint8Array(DURATION_ELEMENT_LENGTH);
  durationElement[0] = 0x44;
  durationElement[1] = 0x89;
  durationElement[2] = 0x88; // サイズ 8 の vint
  new DataView(durationElement.buffer).setFloat64(3, durationTicks);

  // Info のサイズを更新（同じバイト長で再エンコードできなければ断念）
  const newInfoSize = _encodeEbmlSize(info.dataSize + DURATION_ELEMENT_LENGTH, info.sizeLen);
  if (!newInfoSize) return blob;

  // Segment サイズが既知の場合はそちらも更新（通常はストリーミング出力のため unknown）
  let newSegSize = null;
  if (!segSize.unknown) {
    newSegSize = _encodeEbmlSize(segSize.value + DURATION_ELEMENT_LENGTH, segSize.length);
    if (!newSegSize) return blob;
  }

  const parts = [
    head.slice(0, segSizePos),
    newSegSize || head.slice(segSizePos, segSizePos + segSize.length),
    head.slice(segSizePos + segSize.length, info.sizePos),
    newInfoSize,
    head.slice(info.dataStart, infoEnd),
    durationElement,
    head.slice(infoEnd),
    blob.slice(HEAD_LIMIT),
  ];
  return new Blob(parts, { type: blob.type });
}
