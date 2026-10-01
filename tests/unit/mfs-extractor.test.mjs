import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadClassic } from '../lib/load-classic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const { get } = loadClassic([
  'js/mfs-const.js', 'js/fft.js', 'js/mfs-dsp.js', 'js/mfs-onset.js',
  'js/mfs-tempo.js', 'js/mfs-extractor.js', 'tests/shared/signals.js'
]);
const MFS_CONST = get('MFS_CONST');
const MFS_LAYOUT = get('MFS_LAYOUT');
const MfsExtractor = get('MfsExtractor');
const SpectrumAnalyzer = get('SpectrumAnalyzer');
const sigSine = get('sigSine');
const sigNoise = get('sigNoise');
const sigChord = get('sigChord');
const sigDrumPattern = get('sigDrumPattern');
const sigScaleToLufs = get('sigScaleToLufs');

const L = MFS_LAYOUT;
const N = MFS_CONST.FFT_SIZE;
const H = MFS_CONST.HOP_SIZE;
const SAMPLE_RATES = [48000, 44100];

// 128 サンプルずつ pushSamples し、ホップごとに packed をコピーして返す
function run(signal, { smoothing = 0.8, keepBytes = false, extractor = null } = {}) {
  const ex = extractor || new MfsExtractor(signal.sampleRate, { smoothing });
  const [cl, cr] = signal.channels;
  const frames = [];
  const freqs = [];
  const times = [];
  ex.onHop = (e) => {
    frames.push(new Float32Array(e.packed));
    if (keepBytes) { freqs.push(new Uint8Array(e.freqBytes)); times.push(new Uint8Array(e.timeBytes)); }
  };
  for (let i = 0; i < cl.length; i += 128) {
    const n = Math.min(128, cl.length - i);
    ex.pushSamples(cl.subarray(i, i + n), cr.subarray(i, i + n), n);
  }
  return { ex, frames, freqs, times };
}

function mono(sr, left, right) {
  return { sampleRate: sr, channels: [left, right] };
}
function sineLR(sr, sec, f, amp, lAmp, rAmp) {
  const s = sigSine(sr, sec, f, amp).channels[0];
  const l = new Float32Array(s.length), r = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) { l[i] = s[i] * lAmp; r[i] = s[i] * rAmp; }
  return mono(sr, l, r);
}
const last = (frames) => frames[frames.length - 1];

test('U16-09 ステレオ: L のみ → BALANCE=-1・全 PAN=-1', () => {
  for (const sr of SAMPLE_RATES) {
    // low/mid/high の各帯域群にエネルギーを持たせるため、100Hz・1kHz・8kHz の和
    const a = sigSine(sr, 2, 100, 0.2).channels[0], b = sigSine(sr, 2, 1000, 0.2).channels[0], c = sigSine(sr, 2, 8000, 0.2).channels[0];
    const l = new Float32Array(a.length);
    for (let i = 0; i < l.length; i++) l[i] = a[i] + b[i] + c[i];
    const { frames } = run(mono(sr, l, new Float32Array(l.length)));
    const f = last(frames);
    assert.ok(Math.abs(f[L.STEREO_BALANCE] + 1) <= 0.01, `balance ${f[L.STEREO_BALANCE]}`);
    for (let g = 0; g < 3; g++) assert.ok(Math.abs(f[L.STEREO_PAN + g] + 1) <= 0.01, `pan[${g}] ${f[L.STEREO_PAN + g]}`);
  }
});

test('U16-09 ステレオ: L=R → CORR=1・WIDTH=0、L=-R → CORR=-1・WIDTH=1', () => {
  for (const sr of SAMPLE_RATES) {
    const s = sigNoise(sr, 2, 0.3, 5).channels[0];
    const f1 = last(run(mono(sr, s, new Float32Array(s))).frames);
    assert.ok(Math.abs(f1[L.STEREO_CORR] - 1) <= 0.001);
    assert.ok(Math.abs(f1[L.STEREO_WIDTH]) <= 0.001);
    const neg = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) neg[i] = -s[i];
    const f2 = last(run(mono(sr, s, neg)).frames);
    assert.ok(Math.abs(f2[L.STEREO_CORR] + 1) <= 0.001);
    assert.ok(Math.abs(f2[L.STEREO_WIDTH] - 1) <= 0.001);
  }
});

test('U16-09 ステレオ: 独立白色ノイズ → |CORR|<0.1・WIDTH=0.5±0.05（全ホップ）', () => {
  for (const sr of SAMPLE_RATES) {
    const { frames } = run(sigNoise(sr, 3, 0.3, 9, { stereo: 'independent' }));
    for (const f of frames.slice(8)) {
      assert.ok(Math.abs(f[L.STEREO_CORR]) < 0.1, `corr ${f[L.STEREO_CORR]}`);
      assert.ok(Math.abs(f[L.STEREO_WIDTH] - 0.5) <= 0.05, `width ${f[L.STEREO_WIDTH]}`);
    }
  }
});

test('U16-10 音色: 1kHz 正弦波 CENTROID=ln(20)/ln(300)±0.02・FLATNESS<0.05、白色ノイズ FLATNESS≥0.45', () => {
  for (const sr of SAMPLE_RATES) {
    const f = last(run(sigSine(sr, 2, 1000, 0.5)).frames);
    const expect = Math.log(20) / Math.log(300);
    console.log(`U16-10 sr=${sr} sine centroid=${f[L.CENTROID].toFixed(4)} (理論 ${expect.toFixed(4)}) flatness=${f[L.FLATNESS].toExponential(2)} rolloff=${f[L.ROLLOFF].toFixed(4)}`);
    assert.ok(Math.abs(f[L.CENTROID] - expect) <= 0.02);
    assert.ok(f[L.FLATNESS] < 0.05);
    const n = run(sigNoise(sr, 2, 0.3, 4)).frames;
    let minFlat = 1;
    for (const g of n.slice(8)) minFlat = Math.min(minFlat, g[L.FLATNESS]);
    console.log(`U16-10 sr=${sr} noise flatness min=${minFlat.toFixed(4)}`);
    assert.ok(minFlat >= 0.45);
  }
});

function assertSineChroma(sr) {
  const f = last(run(sigSine(sr, 2, 440, 0.5)).frames);
  assert.equal(f[L.CHROMA + 9], 1);
  for (let i = 0; i < 12; i++) if (i !== 9) assert.ok(f[L.CHROMA + i] < 0.3, `sr=${sr} chroma[${i}]=${f[L.CHROMA + i]}`);
}

test('U16-11 クロマ: 440Hz 正弦波（44.1kHz）CHROMA[9]=1・他<0.3', () => {
  assertSineChroma(44100);
});

test('U16-11 クロマ: 440Hz 正弦波（48kHz）CHROMA[9]=1・他<0.3', () => {
  assertSineChroma(48000);
});

test('U16-11 クロマ: C メジャー和音（MIDI 60, 64, 67）の上位3つ={0,4,7}', () => {
  for (const sr of SAMPLE_RATES) {
    const c = last(run(sigChord(sr, 2, [60, 64, 67], 0.4)).frames);
    const idx = [...Array(12).keys()].sort((a, b) => c[L.CHROMA + b] - c[L.CHROMA + a]).slice(0, 3).sort((a, b) => a - b);
    console.log(`U16-11 sr=${sr} chord chroma=${Array.from(c.subarray(L.CHROMA, L.CHROMA + 12)).map((v) => v.toFixed(2)).join(' ')}`);
    assert.deepEqual(idx, [0, 4, 7]);
  }
});

test('U16-12 ラウドネス: 1kHz・振幅0.1・両ch → -20.0±0.1 LUFS（5秒後）、997Hz・振幅1.0・L のみ → -3.01±0.05', () => {
  for (const sr of SAMPLE_RATES) {
    const f1 = last(run(sigSine(sr, 5, 1000, 0.1)).frames);
    console.log(`U16-12 sr=${sr} 1kHz/0.1/両ch: LOUD_SHORT=${f1[L.LOUD_SHORT].toFixed(3)}`);
    assert.ok(Math.abs(f1[L.LOUD_SHORT] + 20.0) <= 0.1);
    const f2 = last(run(sineLR(sr, 5, 997, 1.0, 1, 0)).frames);
    console.log(`U16-12 sr=${sr} 997Hz/1.0/L のみ: LOUD_SHORT=${f2[L.LOUD_SHORT].toFixed(3)}`);
    assert.ok(Math.abs(f2[L.LOUD_SHORT] + 3.01) <= 0.05);
  }
});

test('U16-13 従来互換 byte: smoothing=0 で SpectrumAnalyzer.analyze と完全一致、tauHop が §5.2 の式どおり', () => {
  const sr = 48000;
  const sig = sigMix2(sr);
  const { frames, freqs, times } = run(sig, { smoothing: 0, keepBytes: true });
  const sa = new SpectrumAnalyzer(N, 0, MFS_CONST.LEGACY_MIN_DB, MFS_CONST.LEGACY_MAX_DB);
  const win = new Float32Array(N);
  const out = new Uint8Array(N / 2), tb = new Uint8Array(N);
  for (const h of [0, 1, 2, 20, 100, frames.length - 1]) {
    const end = (h + 1) * H;
    for (let n = 0; n < N; n++) {
      const i = end - N + n;
      win[n] = i >= 0 ? 0.5 * (sig.channels[0][i] + sig.channels[1][i]) : 0;
    }
    // smoothing=0 では状態を持たないので、任意のホップを単独で計算してよい
    sa.analyze(win, out);
    SpectrumAnalyzer.timeDomainToBytes(win, tb);
    assert.deepEqual(Array.from(freqs[h]), Array.from(out), `freq hop ${h}`);
    assert.deepEqual(Array.from(times[h]), Array.from(tb), `time hop ${h}`);
  }
  const ex = new MfsExtractor(48000, { smoothing: 0.8 });
  assert.ok(Math.abs(ex.tauHop - Math.pow(0.8, 0.64)) < 1e-12);
  const ex2 = new MfsExtractor(44100, { smoothing: 0.8 });
  assert.ok(Math.abs(ex2.tauHop - Math.pow(0.8, 512 * 60 / 44100)) < 1e-12);
  ex.setSmoothing(0.5);
  assert.ok(Math.abs(ex.tauHop - Math.pow(0.5, 0.64)) < 1e-12);
  ex.setSmoothing(0);
  assert.equal(ex.tauHop, 0);
});

test('U16-13 従来互換 byte: smoothing>0 でも逐次 SpectrumAnalyzer と一致（平滑化状態の進み方）', () => {
  const sr = 48000;
  const sig = sigMix2(sr);
  const { freqs } = run(sig, { smoothing: 0.8, keepBytes: true });
  const sa = new SpectrumAnalyzer(N, Math.pow(0.8, 0.64), MFS_CONST.LEGACY_MIN_DB, MFS_CONST.LEGACY_MAX_DB);
  const win = new Float32Array(N), out = new Uint8Array(N / 2);
  for (let h = 0; h < freqs.length; h++) {
    const end = (h + 1) * H;
    for (let n = 0; n < N; n++) {
      const i = end - N + n;
      win[n] = i >= 0 ? 0.5 * (sig.channels[0][i] + sig.channels[1][i]) : 0;
    }
    sa.analyze(win, out);
    assert.deepEqual(Array.from(freqs[h]), Array.from(out), `hop ${h}`);
  }
});

function sigMix2(sr) {
  const d = sigDrumPattern(sr, 3, 120);
  const n = sigNoise(sr, 3, 0.1, 21, { stereo: 'independent' });
  const l = new Float32Array(d.channels[0].length), r = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) { l[i] = d.channels[0][i] + n.channels[0][i]; r[i] = d.channels[1][i] + n.channels[1][i]; }
  return mono(sr, l, r);
}

function bitsOf(frames) {
  const all = new Float32Array(frames.length * L.LENGTH);
  frames.forEach((f, i) => all.set(f, i * L.LENGTH));
  return Buffer.from(all.buffer);
}
function bytesBuf(arrs) {
  return Buffer.concat(arrs.map((a) => Buffer.from(a)));
}

test('U16-14 決定性: 同じ入力2回・reset 後の再処理で packed/freqBytes/timeBytes がビット一致', () => {
  for (const sr of SAMPLE_RATES) {
    const sig = sigMix2(sr);
    const a = run(sig, { keepBytes: true });
    const b = run(sig, { keepBytes: true });
    assert.ok(bitsOf(a.frames).equals(bitsOf(b.frames)));
    assert.ok(bytesBuf(a.freqs).equals(bytesBuf(b.freqs)));
    assert.ok(bytesBuf(a.times).equals(bytesBuf(b.times)));
    // 同じインスタンスを reset して再処理
    a.ex.reset();
    assert.equal(a.ex.hopIndex, -1);
    const c = run(sig, { keepBytes: true, extractor: a.ex });
    assert.ok(bitsOf(a.frames).equals(bitsOf(c.frames)));
    assert.ok(bytesBuf(a.freqs).equals(bytesBuf(c.freqs)));
    assert.ok(bytesBuf(a.times).equals(bytesBuf(c.times)));
  }
});

test('U16-14 ホップ番号・hopEndSample・R=null の扱い', () => {
  const sr = 48000;
  const ex = new MfsExtractor(sr, { smoothing: 0.8 });
  const seen = [];
  ex.onHop = (e) => seen.push([e.hopIndex, e.hopEndSample, e.hopEnergy]);
  const s = sigSine(sr, 0.1, 1000, 0.3).channels[0];
  ex.pushSamples(s, null, s.length);
  assert.equal(seen.length, Math.floor(s.length / H));
  seen.forEach((v, i) => { assert.equal(v[0], i); assert.equal(v[1], (i + 1) * H); });
  const a = run(mono(sr, s, new Float32Array(s))).frames;
  const ex2 = new MfsExtractor(sr, { smoothing: 0.8 });
  const bf = [];
  ex2.onHop = (e) => bf.push(new Float32Array(e.packed));
  ex2.pushSamples(s, null, s.length);
  assert.ok(bitsOf(a).equals(bitsOf(bf)));
});

// §4 の値域チェック
function checkRanges(frames, label) {
  for (let h = 0; h < frames.length; h++) {
    const f = frames[h];
    for (let i = 0; i < L.LENGTH; i++) assert.ok(Number.isFinite(f[i]), `${label} hop ${h} idx ${i}`);
    const rng = (off, len, lo, hi, nm) => {
      for (let i = off; i < off + len; i++) assert.ok(f[i] >= lo && f[i] <= hi, `${label} hop ${h} ${nm}[${i - off}]=${f[i]}`);
    };
    rng(L.BANDS, 32, 0, 1, 'BANDS'); rng(L.BANDS_SMOOTH, 32, 0, 1, 'BANDS_SMOOTH');
    rng(L.ONSET_ENV, 4, 0, 1, 'ONSET_ENV'); rng(L.ONSET_FLAGS, 1, 0, 15, 'ONSET_FLAGS');
    assert.ok(f[L.BPM] === 0 || (f[L.BPM] >= 80 && f[L.BPM] < 160), `${label} BPM ${f[L.BPM]}`);
    rng(L.TEMPO_CONF, 1, 0, 1, 'TEMPO_CONF'); rng(L.BEAT_PHASE, 1, 0, 1, 'BEAT_PHASE'); rng(L.BAR_PHASE, 1, 0, 1, 'BAR_PHASE');
    rng(L.BEAT_IN_BAR, 1, 0, 3, 'BEAT_IN_BAR'); rng(L.BEAT_FLAG, 1, 0, 1, 'BEAT_FLAG'); rng(L.DOWNBEAT_FLAG, 1, 0, 1, 'DOWNBEAT_FLAG');
    rng(L.TEMPO_LOCKED, 1, 0, 1, 'TEMPO_LOCKED');
    rng(L.STEREO_CORR, 1, -1, 1, 'CORR'); rng(L.STEREO_WIDTH, 1, 0, 1, 'WIDTH'); rng(L.STEREO_BALANCE, 1, -1, 1, 'BALANCE');
    rng(L.STEREO_PAN, 3, -1, 1, 'PAN');
    rng(L.CENTROID, 1, 0, 1, 'CENTROID'); rng(L.FLATNESS, 1, 0, 1, 'FLATNESS'); rng(L.ROLLOFF, 1, 0, 1, 'ROLLOFF');
    rng(L.CHROMA, 12, 0, 1, 'CHROMA'); rng(L.LEVEL, 1, 0, 1, 'LEVEL');
    rng(L.AGC_DB, 1, MFS_CONST.AGC_MIN_DB, MFS_CONST.AGC_MAX_DB, 'AGC_DB');
    rng(L.RMS, 1, 0, 1, 'RMS'); rng(L.PEAK, 1, 0, 1, 'PEAK');
  }
}

test('U16-15 数値安全性: 無音・直流・矩形波・インパルス・L のみ無音 で NaN/Infinity なし・値域内', () => {
  for (const sr of SAMPLE_RATES) {
    const len = 5 * sr;
    const zeros = () => new Float32Array(len);
    const dc = new Float32Array(len).fill(1);
    const sq = new Float32Array(len);
    const period = Math.round(sr / 1000);
    for (let i = 0; i < len; i++) sq[i] = (Math.floor(i / (period / 2)) % 2 === 0) ? 1 : -1;
    const imp = zeros(); imp[sr] = 1;
    const noise = sigNoise(sr, 5, 0.5, 13).channels[0];
    const cases = {
      silence: mono(sr, zeros(), zeros()),
      dc: mono(sr, dc, new Float32Array(dc)),
      square: mono(sr, sq, new Float32Array(sq)),
      impulse: mono(sr, imp, new Float32Array(imp)),
      leftSilent: mono(sr, zeros(), new Float32Array(noise)),
    };
    for (const [name, sig] of Object.entries(cases)) {
      checkRanges(run(sig).frames, `sr=${sr} ${name}`);
    }
    // 無音では特徴が 0（音色・クロマ・ステレオ）で、ラウドネスは有限の最小値
    const fs = last(run(cases.silence).frames);
    assert.equal(fs[L.CENTROID], 0); assert.equal(fs[L.FLATNESS], 0); assert.equal(fs[L.ROLLOFF], 0);
    assert.equal(fs[L.STEREO_CORR], 0); assert.equal(fs[L.STEREO_BALANCE], 0);
    assert.equal(fs[L.AGC_DB], 0);
  }
});

test('U16-16 音量自動補正: 同じドラムを -30 / -10 LUFS にして 10 秒後の AGC_DB が clamp(-14 - LOUD_SHORT, -6, 18) ± 0.5', () => {
  for (const sr of SAMPLE_RATES) {
    const drums = sigDrumPattern(sr, 10, 120);
    for (const target of [-30, -10]) {
      const sig = sigScaleToLufs(drums, target);
      const f = last(run(sig).frames);
      const expect = Math.min(MFS_CONST.AGC_MAX_DB, Math.max(MFS_CONST.AGC_MIN_DB, MFS_CONST.AGC_TARGET_LUFS - f[L.LOUD_SHORT]));
      console.log(`U16-16 sr=${sr} target=${target}: LOUD_SHORT=${f[L.LOUD_SHORT].toFixed(2)} AGC_DB=${f[L.AGC_DB].toFixed(2)} expect=${expect.toFixed(2)}`);
      assert.ok(Math.abs(f[L.AGC_DB] - expect) <= 0.5);
    }
  }
});

test('U16-16 sigScaleToLufs: 全区間ラウドネスが目標に一致（K 特性は MfsBiquad.kWeighting を使用）', () => {
  const sr = 48000;
  const sig = sigScaleToLufs(sigSine(sr, 5, 1000, 0.3), -23);
  const f = last(run(sig).frames);
  assert.ok(Math.abs(f[L.LOUD_SHORT] + 23) <= 0.05, `${f[L.LOUD_SHORT]}`);
  const silent = sigScaleToLufs(mono(sr, new Float32Array(100), new Float32Array(100)), -23);
  assert.equal(silent.channels[0].length, 100);
});

test('U16-17 性能: 60 秒ステレオ 48kHz の処理時間 ≤ 6 秒', () => {
  const sr = 48000;
  const sig = sigMix2Long(sr, 60);
  // loadClassic の vm コンテキストは Math 等のグローバル参照が約 15 倍遅い（実測）ため、性能は通常のコンテキスト
  // （ブラウザ・ワークレットと同じ条件）で測る。ここで読み込むのはアプリ本体のファイルのみ
  for (const f of ['js/mfs-const.js', 'js/fft.js', 'js/mfs-dsp.js', 'js/mfs-onset.js',
    'js/mfs-tempo.js', 'js/mfs-extractor.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  }
  const Ex = vm.runInThisContext('MfsExtractor');
  const ex = new Ex(sr, { smoothing: 0.8 });
  let hops = 0;
  ex.onHop = () => { hops++; };
  const [cl, cr] = sig.channels;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < cl.length; i += 128) {
    const n = Math.min(128, cl.length - i);
    ex.pushSamples(cl.subarray(i, i + n), cr.subarray(i, i + n), n);
  }
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(`U16-17 60秒ステレオ 48kHz: ${sec.toFixed(2)} 秒 (${hops} ホップ, リアルタイム比 ${(60 / sec).toFixed(1)}x)`);
  assert.equal(hops, Math.floor(60 * sr / H));
  assert.ok(sec <= 6);
});

function sigMix2Long(sr, sec) {
  const d = sigDrumPattern(sr, sec, 128);
  const n = sigNoise(sr, sec, 0.1, 31, { stereo: 'independent' });
  const l = new Float32Array(d.channels[0].length), r = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) { l[i] = d.channels[0][i] + n.channels[0][i]; r[i] = d.channels[1][i] + n.channels[1][i]; }
  return mono(sr, l, r);
}
