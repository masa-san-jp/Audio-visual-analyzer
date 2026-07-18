// MP4（ISOBMFF）デマルチプレクサ（Phase 14.2）
//
// MP4 を解析し、映像トラック（AVC/H.264）の符号化チャンク列を取り出す。
// オフライン書き出しの動画合成で WebCodecs VideoDecoder へ供給するために使う。
// 外部ライブラリ不使用。js/mp4-muxer.js（書き込み側）と対になる読み取り側の実装。
//
// 対応:
//  - progressive MP4（moov>trak>stbl の stts/ctts/stss/stsc/stsz/stco/co64）
//  - fragmented MP4（moov>mvex>trex + moof>traf の tfhd/tfdt/trun）
//  - サンプルエントリ avc1/avc3（avcC を description として返す）
// 非対応・解析不能なファイルは例外を投げ、呼び出し側（offline-exporter.js）が
// 既存のシーク方式へフォールバックする。
//
// チャンクはデコード順（ファイル出現順）で返す。timestampUs は提示時刻（pts）で、
// 先頭が 0 になるよう正規化する（編集リストの一般的なずらし込みを吸収する）。

class Mp4Demuxer {
  // bytes: Uint8Array
  // 戻り値: { codec, codedWidth, codedHeight, description, chunks: [{data, timestampUs, keyframe}] }
  static parse(bytes) {
    return new Mp4Demuxer(bytes)._parse();
  }

  constructor(bytes) {
    this._b = bytes;
    this._dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  _parse() {
    const top = this._children(0, this._b.length);
    const moov = top.find((c) => c.type === 'moov');
    if (!moov) throw new Error('moov がありません（MP4 ではないか、未対応の構成です）');

    const video = this._parseMoov(moov);
    if (!video) throw new Error('AVC 映像トラックがありません');

    let chunks;
    if (video.sampleCount > 0) {
      chunks = this._parseProgressiveSamples(video);
    } else {
      const moofs = top.filter((c) => c.type === 'moof');
      if (moofs.length === 0) throw new Error('サンプルがありません（stbl 空・moof なし）');
      chunks = this._parseFragmentSamples(video, moofs);
    }
    if (chunks.length === 0) throw new Error('映像チャンクがありません');

    // pts の最小値を 0 に正規化してから μs へ変換する（tick領域で引くことで丸め誤差を避ける）
    let minTicks = Infinity;
    for (const c of chunks) minTicks = Math.min(minTicks, c.ptsTicks);
    for (const c of chunks) {
      c.timestampUs = Math.round((c.ptsTicks - minTicks) * 1e6 / video.timescale);
      delete c.ptsTicks;
    }

    const d = video.description;
    const hex = (v) => v.toString(16).padStart(2, '0');
    return {
      codec: `avc1.${hex(d[1])}${hex(d[2])}${hex(d[3])}`,
      codedWidth: video.width,
      codedHeight: video.height,
      description: d,
      chunks,
    };
  }

  // ── moov 解析 ──

  _parseMoov(moov) {
    const moovKids = this._children(moov.dataStart, moov.end);
    // mvex>trex（fragmented の既定値）を trackId で引けるようにする
    const trexById = new Map();
    const mvex = moovKids.find((c) => c.type === 'mvex');
    if (mvex) {
      for (const trex of this._children(mvex.dataStart, mvex.end)) {
        if (trex.type !== 'trex') continue;
        const p = trex.dataStart + 4; // fullbox header
        trexById.set(this._u32(p), {
          defaultDuration: this._u32(p + 8),
          defaultSize: this._u32(p + 12),
          defaultFlags: this._u32(p + 16),
        });
      }
    }

    for (const trak of moovKids) {
      if (trak.type !== 'trak') continue;
      const t = this._parseTrak(trak);
      if (t) {
        t.trex = trexById.get(t.trackId) || null;
        return t;
      }
    }
    return null;
  }

  _parseTrak(trak) {
    const kids = this._children(trak.dataStart, trak.end);
    const tkhd = kids.find((c) => c.type === 'tkhd');
    const mdia = kids.find((c) => c.type === 'mdia');
    if (!tkhd || !mdia) return null;
    const tkhdVersion = this._b[tkhd.dataStart];
    const trackId = this._u32(tkhd.dataStart + (tkhdVersion === 1 ? 20 : 12));

    const mdiaKids = this._children(mdia.dataStart, mdia.end);
    const hdlr = mdiaKids.find((c) => c.type === 'hdlr');
    const mdhd = mdiaKids.find((c) => c.type === 'mdhd');
    const minf = mdiaKids.find((c) => c.type === 'minf');
    if (!hdlr || !mdhd || !minf) return null;
    if (this._type4(hdlr.dataStart + 8) !== 'vide') return null;

    const mdhdVersion = this._b[mdhd.dataStart];
    const timescale = this._u32(mdhd.dataStart + (mdhdVersion === 1 ? 20 : 12));
    if (!timescale) return null;

    const stbl = this._findPath(minf, ['stbl']);
    if (!stbl) return null;
    const stblKids = this._children(stbl.dataStart, stbl.end);
    const stsd = stblKids.find((c) => c.type === 'stsd');
    if (!stsd) return null;

    // stsd の最初のサンプルエントリが avc1/avc3 であること
    const entry = this._children(stsd.dataStart + 8, stsd.end)[0];
    if (!entry || (entry.type !== 'avc1' && entry.type !== 'avc3')) return null;
    const width = this._u16(entry.dataStart + 24);
    const height = this._u16(entry.dataStart + 26);
    // VisualSampleEntry の固定部（78バイト）以降に子ボックス（avcC 等）が並ぶ
    const avcC = this._children(entry.dataStart + 78, entry.end).find((c) => c.type === 'avcC');
    if (!avcC) return null;
    const description = this._b.slice(avcC.dataStart, avcC.end);

    const stsz = stblKids.find((c) => c.type === 'stsz');
    const sampleCount = stsz ? this._u32(stsz.dataStart + 8) : 0;

    return { trackId, timescale, width, height, description, stblKids, sampleCount };
  }

  // ── progressive MP4 のサンプル抽出 ──

  _parseProgressiveSamples(video) {
    const { stblKids, sampleCount } = video;
    const get = (type) => stblKids.find((c) => c.type === type);
    const stsz = get('stsz');
    const stsc = get('stsc');
    const stco = get('stco');
    const co64 = get('co64');
    const stts = get('stts');
    if (!stsz || !stsc || (!stco && !co64) || !stts) throw new Error('stbl が不完全です');

    // サイズ（stsz）
    const uniformSize = this._u32(stsz.dataStart + 4);
    const sizes = new Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      sizes[i] = uniformSize !== 0 ? uniformSize : this._u32(stsz.dataStart + 12 + i * 4);
    }

    // オフセット（stsc + stco/co64）
    const chunkCount = this._u32((stco || co64).dataStart + 4);
    const chunkOffsets = new Array(chunkCount);
    for (let i = 0; i < chunkCount; i++) {
      chunkOffsets[i] = stco ? this._u32(stco.dataStart + 8 + i * 4) : this._u64(co64.dataStart + 8 + i * 8);
    }
    const stscCount = this._u32(stsc.dataStart + 4);
    const stscEntries = [];
    for (let i = 0; i < stscCount; i++) {
      const p = stsc.dataStart + 8 + i * 12;
      stscEntries.push({ firstChunk: this._u32(p), samplesPerChunk: this._u32(p + 4) });
    }
    const offsets = new Array(sampleCount);
    {
      let sample = 0;
      for (let e = 0; e < stscEntries.length && sample < sampleCount; e++) {
        const start = stscEntries[e].firstChunk;                                   // 1-based
        const endChunk = e + 1 < stscEntries.length ? stscEntries[e + 1].firstChunk : chunkCount + 1;
        for (let ch = start; ch < endChunk && sample < sampleCount; ch++) {
          let pos = chunkOffsets[ch - 1];
          for (let s = 0; s < stscEntries[e].samplesPerChunk && sample < sampleCount; s++) {
            offsets[sample] = pos;
            pos += sizes[sample];
            sample++;
          }
        }
      }
      if (sample < sampleCount) throw new Error('stsc/stco の整合性がありません');
    }

    // dts（stts）と pts オフセット（ctts）
    const dts = new Array(sampleCount);
    {
      const n = this._u32(stts.dataStart + 4);
      let sample = 0, t = 0;
      for (let i = 0; i < n && sample < sampleCount; i++) {
        const p = stts.dataStart + 8 + i * 8;
        const count = this._u32(p);
        const delta = this._u32(p + 4);
        for (let s = 0; s < count && sample < sampleCount; s++) {
          dts[sample++] = t;
          t += delta;
        }
      }
      if (sample < sampleCount) throw new Error('stts の整合性がありません');
    }
    const ctts = get('ctts');
    const ptsOffset = new Array(sampleCount).fill(0);
    if (ctts) {
      const version = this._b[ctts.dataStart];
      const n = this._u32(ctts.dataStart + 4);
      let sample = 0;
      for (let i = 0; i < n && sample < sampleCount; i++) {
        const p = ctts.dataStart + 8 + i * 8;
        const count = this._u32(p);
        const off = version === 1 ? this._i32(p + 4) : this._u32(p + 4);
        for (let s = 0; s < count && sample < sampleCount; s++) ptsOffset[sample++] = off;
      }
    }

    // キーフレーム（stss。無ければ全サンプルが同期サンプル）
    const stss = get('stss');
    let syncSet = null;
    if (stss) {
      syncSet = new Set();
      const n = this._u32(stss.dataStart + 4);
      for (let i = 0; i < n; i++) syncSet.add(this._u32(stss.dataStart + 8 + i * 4));
    }

    const chunks = [];
    for (let i = 0; i < sampleCount; i++) {
      const end = offsets[i] + sizes[i];
      if (end > this._b.length) throw new Error('サンプルがファイル範囲外です');
      chunks.push({
        data: this._b.slice(offsets[i], end),
        ptsTicks: dts[i] + ptsOffset[i],
        keyframe: syncSet ? syncSet.has(i + 1) : true,
      });
    }
    return chunks;
  }

  // ── fragmented MP4 のサンプル抽出 ──

  _parseFragmentSamples(video, moofs) {
    const chunks = [];
    for (const moof of moofs) {
      for (const traf of this._children(moof.dataStart, moof.end)) {
        if (traf.type !== 'traf') continue;
        this._parseTraf(video, moof, traf, chunks);
      }
    }
    return chunks;
  }

  _parseTraf(video, moof, traf, outChunks) {
    const kids = this._children(traf.dataStart, traf.end);
    const tfhd = kids.find((c) => c.type === 'tfhd');
    if (!tfhd) return;
    const tfFlags = this._u32(tfhd.dataStart) & 0xFFFFFF;
    let p = tfhd.dataStart + 4;
    const trackId = this._u32(p); p += 4;
    if (trackId !== video.trackId) return;

    let baseDataOffset = null;
    if (tfFlags & 0x000001) { baseDataOffset = this._u64(p); p += 8; }
    if (tfFlags & 0x000002) p += 4; // sample_description_index
    const defaults = video.trex || { defaultDuration: 0, defaultSize: 0, defaultFlags: 0 };
    let defaultDuration = defaults.defaultDuration;
    let defaultSize = defaults.defaultSize;
    let defaultFlags = defaults.defaultFlags;
    if (tfFlags & 0x000008) { defaultDuration = this._u32(p); p += 4; }
    if (tfFlags & 0x000010) { defaultSize = this._u32(p); p += 4; }
    if (tfFlags & 0x000020) { defaultFlags = this._u32(p); p += 4; }

    // base-data-offset 未指定時は default-base-is-moof / 慣例により moof 先頭を基準とする
    const base = baseDataOffset != null ? baseDataOffset : moof.start;

    let dts = 0;
    const tfdt = kids.find((c) => c.type === 'tfdt');
    if (tfdt) {
      const version = this._b[tfdt.dataStart];
      dts = version === 1 ? this._u64(tfdt.dataStart + 4) : this._u32(tfdt.dataStart + 4);
    }

    for (const trun of kids) {
      if (trun.type !== 'trun') continue;
      const trFlags = this._u32(trun.dataStart) & 0xFFFFFF;
      const trVersion = this._b[trun.dataStart];
      let q = trun.dataStart + 4;
      const count = this._u32(q); q += 4;
      let dataOffset = 0;
      if (trFlags & 0x000001) { dataOffset = this._i32(q); q += 4; }
      let firstSampleFlags = null;
      if (trFlags & 0x000004) { firstSampleFlags = this._u32(q); q += 4; }

      let pos = base + dataOffset;
      for (let i = 0; i < count; i++) {
        let duration = defaultDuration;
        let size = defaultSize;
        let flags = i === 0 && firstSampleFlags != null ? firstSampleFlags : defaultFlags;
        let ctsOffset = 0;
        if (trFlags & 0x000100) { duration = this._u32(q); q += 4; }
        if (trFlags & 0x000200) { size = this._u32(q); q += 4; }
        if (trFlags & 0x000400) { flags = this._u32(q); q += 4; }
        if (trFlags & 0x000800) { ctsOffset = trVersion === 1 ? this._i32(q) : this._u32(q); q += 4; }
        const end = pos + size;
        if (end > this._b.length) throw new Error('サンプルがファイル範囲外です');
        outChunks.push({
          data: this._b.slice(pos, end),
          ptsTicks: dts + ctsOffset,
          keyframe: (flags & 0x00010000) === 0, // sample_is_non_sync_sample が立っていなければ同期サンプル
        });
        pos = end;
        dts += duration;
      }
    }
  }

  // ── 低レベル読み取り ──

  // [start, end) の直下ボックス一覧
  _children(start, end) {
    const out = [];
    let pos = start;
    while (pos + 8 <= end) {
      let size = this._u32(pos);
      const type = this._type4(pos + 4);
      let dataStart = pos + 8;
      if (size === 1) { size = this._u64(pos + 8); dataStart = pos + 16; }
      else if (size === 0) { size = end - pos; }
      if (size < 8 || pos + size > end) break; // 壊れたボックスで停止（それまでの結果を返す）
      out.push({ type, start: pos, dataStart, end: pos + size });
      pos += size;
    }
    return out;
  }

  _findPath(box, path) {
    let cur = box;
    for (const type of path) {
      cur = this._children(cur.dataStart, cur.end).find((c) => c.type === type);
      if (!cur) return null;
    }
    return cur;
  }

  _type4(pos) {
    const b = this._b;
    return String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]);
  }

  _u16(pos) { return this._dv.getUint16(pos, false); }
  _u32(pos) { return this._dv.getUint32(pos, false); }
  _i32(pos) { return this._dv.getInt32(pos, false); }
  _u64(pos) { return Number(this._dv.getBigUint64(pos, false)); }
}
