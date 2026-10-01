import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['js/vis-utils.js', 'js/mfs-const.js', 'js/mfs-view.js']);
const MFS_LAYOUT = get('MFS_LAYOUT');
const computeFreqRange = get('computeFreqRange');
const MfsFrameView = get('MfsFrameView');
const applyAutoGain = get('applyAutoGain');
const computeLayerRange = get('computeLayerRange');

test('U16-18 MfsFrameView: 参照が不変で getter が packed の値を返す', () => {
  const v = new MfsFrameView();
  const refs = [v.raw, v.bands, v.bandsSmooth, v.onset, v.onset.env, v.tempo, v.stereo, v.stereo.pan,
    v.timbre, v.chroma, v.loudness];
  const f = new Float32Array(MFS_LAYOUT.LENGTH);
  for (let n = 0; n < 1000; n++) {
    for (let i = 0; i < f.length; i++) f[i] = (i + 1) * 0.001 + n * 1e-4;
    v.setPacked(f);
  }
  const now = [v.raw, v.bands, v.bandsSmooth, v.onset, v.onset.env, v.tempo, v.stereo, v.stereo.pan,
    v.timbre, v.chroma, v.loudness];
  refs.forEach((r, i) => assert.equal(now[i], r));
  assert.equal(v.raw.length, 104);
  assert.equal(v.bands.length, 32);
  assert.equal(v.bandsSmooth.length, 32);
  assert.equal(v.onset.env.length, 4);
  assert.equal(v.stereo.pan.length, 3);
  assert.equal(v.chroma.length, 12);
  // 全 getter / 配列が packed の該当値と一致
  for (let b = 0; b < 32; b++) {
    assert.equal(v.bands[b], f[MFS_LAYOUT.BANDS + b]);
    assert.equal(v.bandsSmooth[b], f[MFS_LAYOUT.BANDS_SMOOTH + b]);
  }
  for (let k = 0; k < 4; k++) assert.equal(v.onset.env[k], f[MFS_LAYOUT.ONSET_ENV + k]);
  for (let k = 0; k < 3; k++) assert.equal(v.stereo.pan[k], f[MFS_LAYOUT.STEREO_PAN + k]);
  for (let k = 0; k < 12; k++) assert.equal(v.chroma[k], f[MFS_LAYOUT.CHROMA + k]);
  assert.equal(v.onset.flags, f[MFS_LAYOUT.ONSET_FLAGS]);
  assert.equal(v.tempo.bpm, f[MFS_LAYOUT.BPM]);
  assert.equal(v.tempo.confidence, f[MFS_LAYOUT.TEMPO_CONF]);
  assert.equal(v.tempo.beatPhase, f[MFS_LAYOUT.BEAT_PHASE]);
  assert.equal(v.tempo.barPhase, f[MFS_LAYOUT.BAR_PHASE]);
  assert.equal(v.tempo.beatInBar, f[MFS_LAYOUT.BEAT_IN_BAR]);
  assert.equal(v.stereo.correlation, f[MFS_LAYOUT.STEREO_CORR]);
  assert.equal(v.stereo.width, f[MFS_LAYOUT.STEREO_WIDTH]);
  assert.equal(v.stereo.balance, f[MFS_LAYOUT.STEREO_BALANCE]);
  assert.equal(v.timbre.centroid, f[MFS_LAYOUT.CENTROID]);
  assert.equal(v.timbre.flatness, f[MFS_LAYOUT.FLATNESS]);
  assert.equal(v.timbre.rolloff, f[MFS_LAYOUT.ROLLOFF]);
  assert.equal(v.loudness.momentary, f[MFS_LAYOUT.LOUD_MOMENTARY]);
  assert.equal(v.loudness.shortTerm, f[MFS_LAYOUT.LOUD_SHORT]);
  assert.equal(v.loudness.level, f[MFS_LAYOUT.LEVEL]);
  assert.equal(v.loudness.agcDb, f[MFS_LAYOUT.AGC_DB]);
  assert.equal(v.rms, f[MFS_LAYOUT.RMS]);
  assert.equal(v.peak, f[MFS_LAYOUT.PEAK]);
  // boolean getter は >= 0.5
  const g = new Float32Array(MFS_LAYOUT.LENGTH);
  g[MFS_LAYOUT.BEAT_FLAG] = 1; g[MFS_LAYOUT.DOWNBEAT_FLAG] = 0.49; g[MFS_LAYOUT.TEMPO_LOCKED] = 0.5;
  v.setPacked(g);
  assert.equal(v.tempo.beatFlag, true);
  assert.equal(v.tempo.downbeatFlag, false);
  assert.equal(v.tempo.locked, true);
  // setPacked はコピー（元配列の変更が反映されない）
  g[MFS_LAYOUT.BPM] = 99;
  assert.equal(v.tempo.bpm, 0);
});

test('U16-19 computeLayerRange: linear は現行式と一致', () => {
  const out = new Int32Array(2);
  for (const sliceLen of [100, 337, 640]) {
    for (const count of [2, 3, 4, 7]) {
      for (const mode of ['linear', undefined, 'other']) {
        for (let i = 0; i < count; i++) {
          computeLayerRange(i, count, sliceLen, 48000, 2048, mode, out);
          assert.equal(out[0], Math.floor(i * sliceLen / count));
          assert.equal(out[1], Math.floor((i + 1) * sliceLen / count));
        }
      }
    }
  }
  assert.equal(computeLayerRange(0, 4, 100, 48000, 2048, 'linear', out), out);
});

test('U16-19 computeLayerRange: mel は境界がメル等分のビン ±1・幅 ≥ 1・連続', () => {
  const out = new Int32Array(2);
  const mel = (f) => 2595 * Math.log10(1 + f / 700);
  const inv = (m) => 700 * (Math.pow(10, m / 2595) - 1);
  for (const sr of [48000, 44100]) {
    const { startBin, endBin } = computeFreqRange(sr, 1024);
    const sliceLen = endBin - startBin + 1;
    for (const count of [2, 3, 4, 8, 16]) {
      let prevEnd = 0;
      for (let i = 0; i < count; i++) {
        computeLayerRange(i, count, sliceLen, sr, 2048, 'mel', out);
        assert.ok(out[1] - out[0] >= 1, `幅 sr=${sr} count=${count} i=${i}`);
        assert.equal(out[0], prevEnd, `連続 sr=${sr} count=${count} i=${i}`);
        const fStart = inv(mel(50) + i * (mel(15000) - mel(50)) / count);
        const fEnd = inv(mel(50) + (i + 1) * (mel(15000) - mel(50)) / count);
        const eStart = Math.round(fStart * 2048 / sr) - startBin;
        const eEnd = Math.round(fEnd * 2048 / sr) - startBin;
        assert.ok(Math.abs(out[0] - Math.max(0, eStart)) <= 1, `start sr=${sr} count=${count} i=${i}`);
        assert.ok(Math.abs(out[1] - Math.min(sliceLen, eEnd)) <= 1, `end sr=${sr} count=${count} i=${i}`);
        prevEnd = out[1];
      }
      assert.ok(Math.abs(prevEnd - sliceLen) <= 1);
    }
  }
});

test('U16-19 computeLayerRange: mel で極小スライスでも幅 ≥ 1 かつ隙間なし', () => {
  const out = new Int32Array(2);
  const count = 4, sliceLen = 6;
  let prevEnd = 0;
  for (let i = 0; i < count; i++) {
    computeLayerRange(i, count, sliceLen, 48000, 2048, 'mel', out);
    assert.ok(out[1] > out[0]);
    assert.equal(out[0], prevEnd);
    prevEnd = out[1];
  }
  assert.equal(prevEnd, sliceLen);
});

test('U16-20 applyAutoGain: クランプと 0dB 不変', () => {
  const inp = new Uint8Array([200, 10, 0, 255, 128]);
  const out = new Uint8Array(5);
  assert.equal(applyAutoGain(inp, 18, out), out);
  assert.equal(out[0], 255);
  applyAutoGain(inp, -6, out);
  assert.equal(out[1], 0);
  applyAutoGain(inp, 0, out);
  assert.deepEqual(Array.from(out), Array.from(inp));
});
