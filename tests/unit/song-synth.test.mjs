import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';
import { songmapRows, SONGMAP_ROW, MFS_CONST } from '../lib/songmap-rows.mjs';

const { get } = loadClassic(['tests/shared/signals.js', 'tests/shared/song-synth.js']);
const synthSong = get('synthSong');
const synthTempoChange = get('synthTempoChange');

const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

test('U18-S01 synthSong: 2回生成でビット一致（16kHz・128BPM）', () => {
  const a = synthSong(16000, { bpm: 128 });
  const b = synthSong(16000, { bpm: 128 });
  assert.equal(a.channels.length, 2);
  assert.ok(bytes(a.channels[0]).equals(bytes(b.channels[0])));
  assert.ok(bytes(a.channels[1]).equals(bytes(b.channels[1])));
  assert.deepEqual(JSON.parse(JSON.stringify(a.truth)), JSON.parse(JSON.stringify(b.truth)));
});

test('U18-S02 synthSong: seed が違えば波形が変わる。既定 seed は 11', () => {
  const a = synthSong(8000, { bpm: 128 });
  const b = synthSong(8000, { bpm: 128, seed: 11 });
  const c = synthSong(8000, { bpm: 128, seed: 12 });
  assert.ok(bytes(a.channels[0]).equals(bytes(b.channels[0])));
  assert.ok(!bytes(a.channels[0]).equals(bytes(c.channels[0])));
});

test('U18-S03 synthSong: 長さ・ピーク・truth の値', () => {
  for (const bpm of [100, 128, 174]) {
    const sr = 8000;
    const s = synthSong(sr, { bpm });
    const barSec = 4 * 60 / bpm;
    assert.equal(s.sampleRate, sr);
    assert.equal(s.barSec, barSec);
    assert.equal(s.channels[0].length, Math.round(64 * barSec * sr));
    assert.equal(s.channels[1].length, s.channels[0].length);
    let pk = 0;
    for (const ch of s.channels) for (let i = 0; i < ch.length; i++) pk = Math.max(pk, Math.abs(ch[i]));
    assert.ok(Math.abs(pk - 0.9) < 1e-6, `peak ${pk}`);
    const t = s.truth;
    assert.deepEqual(Array.from(t.boundariesBars), [0, 8, 16, 32, 40, 56, 64]);
    assert.deepEqual(Array.from(t.kinds), ['intro', 'build', 'drop', 'break', 'drop', 'outro']);
    assert.equal(t.beats.length, 256);
    assert.equal(t.downbeats.length, 64);
    assert.equal(t.beats[0], 0);
    assert.ok(Math.abs(t.beats[255] - 255 * 60 / bpm) < 1e-9);
    assert.ok(Math.abs(t.downbeats[63] - 63 * barSec) < 1e-9);
    for (let k = 0; k < 64; k++) assert.ok(Math.abs(t.downbeats[k] - t.beats[k * 4]) < 1e-9);
  }
});

test('U18-S04 synthSong: セクションごとの音量（ドロップがイントロ・ブレイクより大きい）', () => {
  const sr = 8000, bpm = 128;
  const s = synthSong(sr, { bpm });
  const rms = (b0, b1) => {
    const i0 = Math.round(b0 * s.barSec * sr), i1 = Math.round(b1 * s.barSec * sr);
    let e = 0;
    for (let i = i0; i < i1; i++) e += s.channels[0][i] ** 2;
    return Math.sqrt(e / (i1 - i0));
  };
  const intro = rms(0, 8), drop = rms(16, 32), brk = rms(32 + 0, 40);
  assert.ok(drop > 2 * intro, `drop ${drop} intro ${intro}`);
  assert.ok(drop > 2 * brk, `drop ${drop} break ${brk}`);
});

test('U18-S05 synthTempoChange: 長さ 60 秒・決定的・拍の真値', () => {
  const a = synthTempoChange(8000);
  const b = synthTempoChange(8000);
  assert.equal(a.channels[0].length, 60 * 8000);
  assert.ok(bytes(a.channels[0]).equals(bytes(b.channels[0])));
  assert.equal(a.truth.beats.length, 60 + 63);
  assert.equal(a.truth.beats[60], 30);
  assert.ok(Math.abs(a.truth.beats[61] - (30 + 60 / 126)) < 1e-12);
});

test('U18-S06 songmapRows: 行数 = ホップ数・長さ 49・決定的・有限', () => {
  const sr = 22050;
  const s = synthSong(sr, { bpm: 128 });
  const r1 = songmapRows(s);
  const r2 = songmapRows(s);
  assert.equal(SONGMAP_ROW.LENGTH, 49);
  assert.equal(r1.hops, Math.floor(s.channels[0].length / MFS_CONST.HOP_SIZE));
  assert.equal(r1.rows.length, r1.hops * 49);
  assert.equal(r1.sampleRate, sr);
  assert.ok(Math.abs(r1.durationSec - 64 * s.barSec) < 1 / sr);
  assert.ok(bytes(r1.rows).equals(bytes(r2.rows)));
  for (let i = 0; i < r1.rows.length; i++) assert.ok(Number.isFinite(r1.rows[i]));
  // ドロップ（小節 16〜32）の平均エネルギーがイントロ（小節 0〜8）より大きい
  const hopsPerBar = s.barSec * sr / MFS_CONST.HOP_SIZE;
  const mean = (b0, b1, off) => {
    const h0 = Math.round(b0 * hopsPerBar), h1 = Math.round(b1 * hopsPerBar);
    let a = 0;
    for (let h = h0; h < h1; h++) a += r1.rows[h * 49 + off];
    return a / (h1 - h0);
  };
  assert.ok(mean(16, 32, SONGMAP_ROW.ENERGY) > 2 * mean(0, 8, SONGMAP_ROW.ENERGY));
  // FLUX 列は非負
  for (let h = 0; h < r1.hops; h++) for (let i = 0; i < 4; i++) assert.ok(r1.rows[h * 49 + i] >= 0);
});
