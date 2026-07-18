// フラグメント化 MP4（fMP4）マクサー（オフライン書き出し用）— doc/plan-phase8.md §9.1
//
// js/webm-muxer.js の MP4版。映像（H.264/AVC）・音声（AAC）のエンコード済み
// チャンクから fMP4 ファイル全体をゼロから構築する。
//
// 構成: ftyp → moov(mvhd, trak×2[空のサンプルテーブル+avcC/esds], mvex)
//       → (moof+mdat) の繰り返し（1フラグメント=1映像キーフレーム区間）
//       → mfra（tfra: シーク索引。WebM の Cues に相当）
//
// 外部ライブラリ不使用。ブラウザ依存 API は Blob のみ（Node でも動作可）。

const MP4_TRACK_ID_VIDEO = 1;
const MP4_TRACK_ID_AUDIO = 2;
const MP4_MOVIE_TIMESCALE = 1000; // ms

// fps(25/29.97/30) → { timescale, sampleDuration } の対応
// 29.97 は 30000/1001 として厳密に扱う（NTSC慣行）。
function mp4TimescaleForFps(fps) {
  if (Math.abs(fps - 29.97) < 0.01) return { timescale: 30000, sampleDuration: 1001 };
  const n = Math.round(fps);
  return { timescale: n, sampleDuration: 1 };
}

// ── バイト列ヘルパー ──

function _concatBytes(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

function _u8(v) { return new Uint8Array([v & 0xFF]); }
function _u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v & 0xFFFF, false); return b; }
function _u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, false); return b; }
function _i16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v, false); return b; }
function _fixed16_16(v) { return _u32(Math.round(v * 65536)); }
function _ascii(str) { const b = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i); return b; }
function _zeros(n) { return new Uint8Array(n); }

// ISO BMFF box: [size(4)][type(4ascii)][payload]
function _box(type, payload) {
  const size = 8 + payload.length;
  const out = new Uint8Array(size);
  out.set(_u32(size), 0);
  out.set(_ascii(type), 4);
  out.set(payload, 8);
  return out;
}

// FullBox のヘッダー（version(1)+flags(3)）
function _fullHeader(version, flags) {
  return new Uint8Array([version & 0xFF, (flags >>> 16) & 0xFF, (flags >>> 8) & 0xFF, flags & 0xFF]);
}

// MPEG-4 記述子のサイズフィールド（expandable 4byte 固定形式。0x80 0x80 0x80 X）。
// 冗長な継続ビット付きバイトを許す仕様を利用し、サイズ確定前に固定4バイトで書ける。
function _descSize(n) {
  if (n > 0x7F) throw new Error('mp4-muxer: descriptor too large for fixed 4-byte size');
  return new Uint8Array([0x80, 0x80, 0x80, n & 0x7F]);
}

// unity matrix（tkhd/mvhd 用）: [16.16, 16.16, 2.30, 16.16, 16.16, 2.30, 2.30, 2.30, 2.30]
const IDENTITY_MATRIX = _concatBytes([
  _fixed16_16(1), _fixed16_16(0), _u32(0),
  _fixed16_16(0), _fixed16_16(1), _u32(0),
  _u32(0), _u32(0), _u32(0x40000000), // w = 1.0 (2.30 fixed)
]);

class Mp4Muxer {
  // opts: { width, height, fps, sampleRate, channels, avcConfig(Uint8Array|null),
  //         audioSpecificConfig(Uint8Array|null) }
  constructor(opts) {
    this._width = opts.width;
    this._height = opts.height;
    this._fps = opts.fps || 30;
    this._sampleRate = opts.sampleRate || 48000;
    this._channels = opts.channels || 2;
    this._avcConfig = opts.avcConfig || new Uint8Array(0);
    this._audioSpecificConfig = opts.audioSpecificConfig || new Uint8Array(0);
    this._videoChunks = []; // {data, timestampUs, keyframe}
    this._audioChunks = []; // {data, timestampUs, durationUs}
    this._videoBaseTicks = 0;
    this._audioBaseTicks = 0;
    this._lastVideoBaseTicks = 0;
  }

  addVideoChunk(data, timestampUs, keyframe) {
    this._videoChunks.push({ data, timestampUs, keyframe: !!keyframe });
  }

  addAudioChunk(data, timestampUs, durationUs) {
    this._audioChunks.push({ data, timestampUs, durationUs: durationUs || 0 });
  }

  finalize(durationMs) {
    this._videoBaseTicks = 0;
    this._audioBaseTicks = 0;

    const { timescale: vScale } = mp4TimescaleForFps(this._fps);
    const hasAudio = this._audioChunks.length > 0 && this._audioSpecificConfig.length > 0;
    const aScale = this._sampleRate;

    const ftyp = this._buildFtyp();
    const moov = this._buildMoov(Math.round(durationMs), vScale, hasAudio, aScale);

    const groups = this._buildFragmentGroups();
    const fragments = groups.map((g, i) =>
      this._buildFragment(g, i + 1, hasAudio, aScale));

    // ── mfra（シーク索引）: 各フラグメントの moof 絶対バイト位置を記録 ──
    let offset = ftyp.length + moov.length;
    const tfraEntries = [];
    const fragmentBytesList = [];
    for (const frag of fragments) {
      tfraEntries.push({ timeVScale: frag.videoBaseTicks, moofOffset: offset });
      fragmentBytesList.push(frag.bytes);
      offset += frag.bytes.length;
    }
    const mfra = this._buildMfra(tfraEntries);

    const fileBytes = _concatBytes([ftyp, moov, ...fragmentBytesList, mfra]);
    return new Blob([fileBytes], { type: 'video/mp4' });
  }

  // ── フラグメント分割: 映像キーフレームを境に分割（WebM マクサーと同方針） ──
  _buildFragmentGroups() {
    const video = this._videoChunks;
    const audio = this._audioChunks;
    const merged = [];
    let vi = 0, ai = 0;
    while (vi < video.length || ai < audio.length) {
      const v = video[vi], a = audio[ai];
      if (v && (!a || v.timestampUs <= a.timestampUs)) { merged.push({ type: 'v', c: v }); vi++; }
      else { merged.push({ type: 'a', c: a }); ai++; }
    }

    const groups = [];
    let cur = null;
    for (const m of merged) {
      const isVideo = m.type === 'v';
      const isKeyStart = isVideo && m.c.keyframe;
      if (!cur || isKeyStart) {
        cur = { videoSamples: [], audioSamples: [] };
        groups.push(cur);
      }
      if (isVideo) cur.videoSamples.push(m.c);
      else cur.audioSamples.push(m.c);
    }
    return groups;
  }

  // ── ftyp ──
  _buildFtyp() {
    const payload = _concatBytes([
      _ascii('isom'), _u32(0x200),
      _ascii('isom'), _ascii('iso5'), _ascii('iso6'), _ascii('mp41'),
    ]);
    return _box('ftyp', payload);
  }

  // ── moov ──
  _buildMoov(durationMovie, vScale, hasAudio, aScale) {
    const mvhd = this._buildMvhd(durationMovie);
    const videoTrak = this._buildVideoTrak(durationMovie, vScale);
    const parts = [mvhd, videoTrak];
    if (hasAudio) parts.push(this._buildAudioTrak(durationMovie, aScale));

    const trexList = [this._buildTrex(MP4_TRACK_ID_VIDEO)];
    if (hasAudio) trexList.push(this._buildTrex(MP4_TRACK_ID_AUDIO));
    parts.push(_box('mvex', _concatBytes(trexList)));

    return _box('moov', _concatBytes(parts));
  }

  _buildMvhd(durationMovie) {
    const payload = _concatBytes([
      _fullHeader(0, 0),
      _u32(0), _u32(0), // creation/modification time
      _u32(MP4_MOVIE_TIMESCALE),
      _u32(durationMovie),
      _fixed16_16(1), // rate
      _u16(0x0100), _u16(0), // volume + reserved
      _u32(0), _u32(0), // reserved x2
      IDENTITY_MATRIX,
      _zeros(24), // pre_defined
      _u32(3), // next_track_ID
    ]);
    return _box('mvhd', payload);
  }

  _buildTrex(trackId) {
    const payload = _concatBytes([
      _fullHeader(0, 0),
      _u32(trackId),
      _u32(1), // default_sample_description_index
      _u32(0), _u32(0), _u32(0), // duration/size/flags は trun で毎回明示するため未使用
    ]);
    return _box('trex', payload);
  }

  _buildVideoTrak(durationMovie, vScale) {
    const tkhd = _box('tkhd', _concatBytes([
      _fullHeader(0, 0x000007),
      _u32(0), _u32(0),
      _u32(MP4_TRACK_ID_VIDEO),
      _u32(0),
      _u32(durationMovie),
      _u32(0), _u32(0),
      _u16(0), _u16(0), // layer, alternate_group
      _u16(0), _u16(0), // volume(0 for video), reserved
      IDENTITY_MATRIX,
      _fixed16_16(this._width), _fixed16_16(this._height),
    ]));
    return this._assembleTrak(tkhd, this._buildVideoMdia(vScale));
  }

  _buildVideoMdia(vScale) {
    const totalSamples = this._videoChunks.length;
    const sampleDuration = mp4TimescaleForFps(this._fps).sampleDuration;
    const trackDurationTicks = totalSamples * sampleDuration;

    const mdhd = _box('mdhd', _concatBytes([
      _fullHeader(0, 0),
      _u32(0), _u32(0),
      _u32(vScale),
      _u32(trackDurationTicks),
      _u16(0x55C4), // language 'und'
      _u16(0),
    ]));
    const hdlr = _box('hdlr', _concatBytes([
      _fullHeader(0, 0),
      _u32(0), _ascii('vide'), _zeros(12),
      _ascii('VideoHandler'), _u8(0),
    ]));
    const vmhd = _box('vmhd', _concatBytes([_fullHeader(0, 1), _u16(0), _zeros(6)]));
    const dref = _box('dref', _concatBytes([_fullHeader(0, 0), _u32(1), _box('url ', _fullHeader(0, 1))]));
    const dinf = _box('dinf', dref);
    const stsd = this._buildVideoStsd();
    const stts = _box('stts', _concatBytes([_fullHeader(0, 0), _u32(0)]));
    const stsc = _box('stsc', _concatBytes([_fullHeader(0, 0), _u32(0)]));
    const stsz = _box('stsz', _concatBytes([_fullHeader(0, 0), _u32(0), _u32(0)]));
    const stco = _box('stco', _concatBytes([_fullHeader(0, 0), _u32(0)]));
    const stbl = _box('stbl', _concatBytes([stsd, stts, stsc, stsz, stco]));
    const minf = _box('minf', _concatBytes([vmhd, dinf, stbl]));
    return _box('mdia', _concatBytes([mdhd, hdlr, minf]));
  }

  _buildVideoStsd() {
    const avcC = _box('avcC', this._avcConfig);
    const avc1Payload = _concatBytes([
      _zeros(6), _u16(1), // reserved, data_reference_index
      _u16(0), _u16(0), _zeros(12), // pre_defined/reserved
      _u16(this._width), _u16(this._height),
      _u32(0x00480000), _u32(0x00480000), // h/v resolution 72dpi
      _u32(0), // reserved
      _u16(1), // frame_count
      _zeros(32), // compressorname
      _u16(0x0018), // depth
      _i16(-1), // pre_defined
      avcC,
    ]);
    const avc1 = _box('avc1', avc1Payload);
    return _box('stsd', _concatBytes([_fullHeader(0, 0), _u32(1), avc1]));
  }

  _buildAudioTrak(durationMovie, aScale) {
    const tkhd = _box('tkhd', _concatBytes([
      _fullHeader(0, 0x000007),
      _u32(0), _u32(0),
      _u32(MP4_TRACK_ID_AUDIO),
      _u32(0),
      _u32(durationMovie),
      _u32(0), _u32(0),
      _u16(0), _u16(0),
      _u16(0x0100), _u16(0), // volume(1.0 for audio)
      IDENTITY_MATRIX,
      _fixed16_16(0), _fixed16_16(0),
    ]));
    return this._assembleTrak(tkhd, this._buildAudioMdia(aScale));
  }

  _buildAudioMdia(aScale) {
    let totalTicks = 0;
    for (const c of this._audioChunks) {
      totalTicks += Math.max(1, Math.round((c.durationUs || 0) * aScale / 1e6));
    }
    const mdhd = _box('mdhd', _concatBytes([
      _fullHeader(0, 0),
      _u32(0), _u32(0),
      _u32(aScale),
      _u32(totalTicks),
      _u16(0x55C4), _u16(0),
    ]));
    const hdlr = _box('hdlr', _concatBytes([
      _fullHeader(0, 0),
      _u32(0), _ascii('soun'), _zeros(12),
      _ascii('SoundHandler'), _u8(0),
    ]));
    const smhd = _box('smhd', _concatBytes([_fullHeader(0, 0), _u16(0), _u16(0)]));
    const dref = _box('dref', _concatBytes([_fullHeader(0, 0), _u32(1), _box('url ', _fullHeader(0, 1))]));
    const dinf = _box('dinf', dref);
    const stsd = this._buildAudioStsd();
    const stts = _box('stts', _concatBytes([_fullHeader(0, 0), _u32(0)]));
    const stsc = _box('stsc', _concatBytes([_fullHeader(0, 0), _u32(0)]));
    const stsz = _box('stsz', _concatBytes([_fullHeader(0, 0), _u32(0), _u32(0)]));
    const stco = _box('stco', _concatBytes([_fullHeader(0, 0), _u32(0)]));
    const stbl = _box('stbl', _concatBytes([stsd, stts, stsc, stsz, stco]));
    const minf = _box('minf', _concatBytes([smhd, dinf, stbl]));
    return _box('mdia', _concatBytes([mdhd, hdlr, minf]));
  }

  _buildAudioStsd() {
    // esds（ES_Descriptor > DecoderConfigDescriptor > DecoderSpecificInfo + SLConfigDescriptor）
    const dsi = _concatBytes([_u8(0x05), _descSize(this._audioSpecificConfig.length), this._audioSpecificConfig]);
    const decCfgPayload = _concatBytes([
      _u8(0x40), // objectTypeIndication: MPEG-4 Audio
      _u8(0x15), // streamType(5,audio)<<2 | upStream(0)<<1 | reserved(1)
      _zeros(3), // bufferSizeDB
      _u32(0), // maxBitrate
      _u32(0), // avgBitrate
      dsi,
    ]);
    const decCfg = _concatBytes([_u8(0x04), _descSize(decCfgPayload.length), decCfgPayload]);
    const slCfgPayload = _u8(0x02);
    const slCfg = _concatBytes([_u8(0x06), _descSize(slCfgPayload.length), slCfgPayload]);
    const esPayload = _concatBytes([_u16(1), _u8(0), decCfg, slCfg]); // ES_ID=1, flags=0
    const es = _concatBytes([_u8(0x03), _descSize(esPayload.length), esPayload]);
    const esds = _box('esds', _concatBytes([_fullHeader(0, 0), es]));

    const mp4aPayload = _concatBytes([
      _zeros(6), _u16(1), // reserved, data_reference_index
      _zeros(8), // reserved x2
      _u16(this._channels), _u16(16), // channelcount, samplesize
      _u16(0), _u16(0), // pre_defined, reserved
      _u32(this._sampleRate << 16),
      esds,
    ]);
    const mp4a = _box('mp4a', mp4aPayload);
    return _box('stsd', _concatBytes([_fullHeader(0, 0), _u32(1), mp4a]));
  }

  _assembleTrak(tkhd, mdia) {
    return _box('trak', _concatBytes([tkhd, mdia]));
  }

  // ── moof + mdat（1フラグメント） ──
  _buildFragment(group, sequenceNumber, hasAudio, aScale) {
    const videoData = group.videoSamples.map((s) => s.data);
    const audioData = hasAudio ? group.audioSamples.map((s) => s.data) : [];
    const videoBytesTotal = videoData.reduce((s, d) => s + d.length, 0);
    const mdat = _box('mdat', _concatBytes([...videoData, ...audioData]));

    const mfhd = _box('mfhd', _concatBytes([_fullHeader(0, 0), _u32(sequenceNumber)]));

    // 映像 traf は音声サンプルレートを使わない（isVideo=true 分岐が fps から自前で算出するため）
    const videoTraf = this._buildTraf(MP4_TRACK_ID_VIDEO, group.videoSamples, null, true, 0);
    const trafList = [videoTraf];
    if (hasAudio) {
      trafList.push(this._buildTraf(MP4_TRACK_ID_AUDIO, group.audioSamples, aScale, false, videoBytesTotal));
    }

    let moofBytes = _box('moof', _concatBytes([mfhd, ...trafList.map((t) => t.bytes)]));
    moofBytes = this._patchDataOffsets(moofBytes, trafList);

    return {
      bytes: _concatBytes([moofBytes, mdat]),
      videoBaseTicks: videoTraf.baseTicks,
    };
  }

  // traf（tfhd + tfdt + trun）を構築する。
  // scale: 音声トラック（isVideo=false）のサンプルレート。映像では未使用（null 可）。
  // mdatWithinOffset: このトラックのサンプル群が mdat 内で始まるバイトオフセット（video=0, audio=video合計後）
  _buildTraf(trackId, samples, scale, isVideo, mdatWithinOffset) {
    const tfhd = _box('tfhd', _concatBytes([
      _fullHeader(0, 0x020000), // default-base-is-moof
      _u32(trackId),
    ]));

    const baseTicks = isVideo ? this._advanceVideoBase(samples.length) : this._advanceAudioBase(samples, scale);
    const tfdt = _box('tfdt', _concatBytes([_fullHeader(0, 0), _u32(baseTicks)]));

    // trun フラグ: data-offset-present | sample-duration-present | sample-size-present | sample-flags-present
    const trunFlags = 0x000001 | 0x000100 | 0x000200 | 0x000400;
    const entries = [];
    if (isVideo) {
      const { sampleDuration } = mp4TimescaleForFps(this._fps);
      for (const s of samples) {
        entries.push(_concatBytes([
          _u32(sampleDuration),
          _u32(s.data.length),
          _u32(s.keyframe ? 0x02000000 : 0x01010000),
        ]));
      }
    } else {
      for (const s of samples) {
        const dur = Math.max(1, Math.round((s.durationUs || 0) * scale / 1e6));
        entries.push(_concatBytes([
          _u32(dur),
          _u32(s.data.length),
          _u32(0x02000000), // 音声フレームは常に独立デコード可能として扱う
        ]));
      }
    }

    // data_offset はここではプレースホルダ 0（moof全体の長さ確定後にパッチする）
    const trunPayload = _concatBytes([
      _fullHeader(0, trunFlags),
      _u32(samples.length),
      _u32(0), // data_offset placeholder
      ...entries,
    ]);
    const trun = _box('trun', trunPayload);
    const trafBytes = _box('traf', _concatBytes([tfhd, tfdt, trun]));

    return {
      bytes: trafBytes,
      // trafBytes 先頭からの data_offset フィールド位置:
      // traf header(8) + tfhd + tfdt + [trun header(8) + fullHeader(4) + sample_count(4)]
      dataOffsetPosInTraf: 8 + tfhd.length + tfdt.length + 8 + 4 + 4,
      mdatWithinOffset,
      baseTicks,
    };
  }

  // moof 全体の長さが確定してから、各 traf の data_offset（moof先頭からの相対値）を書き込む
  _patchDataOffsets(moofBytes, trafList) {
    const dv = new DataView(moofBytes.buffer, moofBytes.byteOffset, moofBytes.byteLength);
    const mfhdSize = dv.getUint32(8, false);
    let cursor = 8 + mfhdSize; // moof header(8) + mfhd 全体の直後 = 最初の traf の開始位置

    for (const t of trafList) {
      const fieldPos = cursor + t.dataOffsetPosInTraf;
      // data_offset は moof box 先頭（オフセット0）からの相対値。
      // mdat のペイロード開始位置は moof の全長 + mdat ヘッダー(8バイト)。
      const value = moofBytes.length + 8 + t.mdatWithinOffset;
      dv.setUint32(fieldPos, value, false);
      cursor += t.bytes.length;
    }
    return moofBytes;
  }

  _advanceVideoBase(count) {
    const base = this._videoBaseTicks;
    const { sampleDuration } = mp4TimescaleForFps(this._fps);
    this._videoBaseTicks += count * sampleDuration;
    return base;
  }

  _advanceAudioBase(samples, aScale) {
    const base = this._audioBaseTicks;
    let sum = 0;
    for (const s of samples) sum += Math.max(1, Math.round((s.durationUs || 0) * aScale / 1e6));
    this._audioBaseTicks += sum;
    return base;
  }

  // ── mfra（シーク索引） ──
  _buildMfra(entries) {
    const tfraEntries = entries.map((e) => _concatBytes([
      _u32(e.timeVScale), _u32(e.moofOffset), _u8(1), _u8(1), _u8(1),
    ]));
    const tfraPayload = _concatBytes([
      _fullHeader(0, 0),
      _u32(MP4_TRACK_ID_VIDEO),
      _u32(0), // traf/trun/sample の各 num フィールド幅 = 1byte（0=>1byteの符号化）
      _u32(entries.length),
      ...tfraEntries,
    ]);
    const tfra = _box('tfra', tfraPayload);
    const mfraLen = 8 + tfra.length + 16; // mfra header(8) + tfra + mfro(16)
    const mfro = _box('mfro', _concatBytes([_fullHeader(0, 0), _u32(mfraLen)]));
    return _box('mfra', _concatBytes([tfra, mfro]));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Mp4Muxer, mp4TimescaleForFps };
}
