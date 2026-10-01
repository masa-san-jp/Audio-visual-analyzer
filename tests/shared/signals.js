// 目的 — Phase 15 §3.5 の決定的な合成信号を Node とブラウザで共有する。

function _signalsClamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

function _signalsMakeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _signalsBuffer(sampleRate, length) {
  return {
    sampleRate,
    channels: [new Float32Array(length), new Float32Array(length)]
  };
}

function _signalsPanAdd(channels, index, value, pan) {
  if (index < 0 || index >= channels[0].length) return;
  const angle = (pan + 1) * Math.PI / 4;
  const gain = Math.SQRT2;
  channels[0][index] += value * Math.cos(angle) * gain;
  channels[1][index] += value * Math.sin(angle) * gain;
}

function sigSine(sampleRate, sec, freqHz, amp, { pan = 0 } = {}) {
  const length = Math.round(sec * sampleRate);
  const result = _signalsBuffer(sampleRate, length);
  for (let i = 0; i < length; i++) {
    const value = amp * Math.sin(2 * Math.PI * freqHz * i / sampleRate);
    _signalsPanAdd(result.channels, i, value, pan);
  }
  return result;
}

function _signalsNoiseChannel(length, amp, seed, color) {
  const channel = new Float32Array(length);
  const rng = _signalsMakeRng(seed);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = rng() * 2 - 1;
    let value = white;
    if (color === 'pink') {
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      value = (b0 + b1 + b2 + white * 0.1848) / 3;
    }
    channel[i] = amp * value;
  }
  return channel;
}

function sigNoise(sampleRate, sec, amp, seed, { color = 'white', stereo = 'same' } = {}) {
  const length = Math.round(sec * sampleRate);
  const left = _signalsNoiseChannel(length, amp, seed, color);
  const right = stereo === 'independent'
    ? _signalsNoiseChannel(length, amp, seed + 1, color)
    : new Float32Array(left);
  return { sampleRate, channels: [left, right] };
}

function sigClickTrack(sampleRate, sec, bpm, {
  amp = 0.8,
  accentEvery = 0,
  accentGain = 2
} = {}) {
  const length = Math.round(sec * sampleRate);
  const result = _signalsBuffer(sampleRate, length);
  const rng = _signalsMakeRng(1);
  const clickLength = Math.round(0.005 * sampleRate);
  const beatSec = 60 / bpm;
  for (let k = 0; k * beatSec < sec; k++) {
    const start = Math.round(k * beatSec * sampleRate);
    const gain = accentEvery > 0 && k % accentEvery === 0 ? accentGain : 1;
    const clickAmp = Math.min(1, amp * gain);
    for (let i = 0; i < clickLength; i++) {
      const value = clickAmp * (rng() * 2 - 1) * Math.exp(-i / (clickLength / 4));
      const index = start + i;
      if (index < length) {
        result.channels[0][index] += value;
        result.channels[1][index] += value;
      }
    }
  }
  return result;
}

function _signalsDefaultPattern(values) {
  return values.slice();
}

function sigDrumPattern(sampleRate, sec, bpm, {
  kick = _signalsDefaultPattern([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
  hat = _signalsDefaultPattern([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]),
  snare = _signalsDefaultPattern([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
} = {}) {
  const length = Math.round(sec * sampleRate);
  const result = _signalsBuffer(sampleRate, length);
  const rng = _signalsMakeRng(3);
  const stepSec = 15 / bpm;
  for (let k = 0; k * stepSec < sec; k++) {
    const start = Math.round(k * stepSec * sampleRate);
    const step = k % 16;

    if (kick[step]) {
      const drumLength = Math.round(0.12 * sampleRate);
      let phase = 0;
      for (let i = 0; i < drumLength; i++) {
        phase += 2 * Math.PI * (60 - 20 * i / drumLength) / sampleRate;
        const value = 0.9 * Math.sin(phase) * Math.exp(-i / (0.04 * sampleRate));
        const index = start + i;
        if (index < length) {
          result.channels[0][index] += value;
          result.channels[1][index] += value;
        }
      }
    }

    if (hat[step]) {
      const hatLength = Math.round(0.03 * sampleRate);
      let previous = 0;
      for (let i = 0; i < hatLength; i++) {
        const white = rng() * 2 - 1;
        const value = 0.25 * (white - previous) * Math.exp(-i / (0.008 * sampleRate));
        previous = white;
        const index = start + i;
        if (index < length) {
          result.channels[0][index] += value;
          result.channels[1][index] += value;
        }
      }
    }

    if (snare[step]) {
      const snareLength = Math.round(0.08 * sampleRate);
      let phase = 0;
      for (let i = 0; i < snareLength; i++) {
        phase += 2 * Math.PI * 200 / sampleRate;
        const value = (0.3 * Math.sin(phase) + 0.3 * (rng() * 2 - 1))
          * Math.exp(-i / (0.02 * sampleRate));
        const index = start + i;
        if (index < length) {
          result.channels[0][index] += value;
          result.channels[1][index] += value;
        }
      }
    }
  }
  return result;
}

function sigChord(sampleRate, sec, midiNotes, amp) {
  const length = Math.round(sec * sampleRate);
  const result = _signalsBuffer(sampleRate, length);
  for (let i = 0; i < length; i++) {
    let value = 0;
    for (const midi of midiNotes) {
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      value += Math.sin(2 * Math.PI * frequency * i / sampleRate)
        + 0.5 * Math.sin(4 * Math.PI * frequency * i / sampleRate)
        + 0.25 * Math.sin(6 * Math.PI * frequency * i / sampleRate);
    }
    value = amp * value / midiNotes.length;
    result.channels[0][i] = value;
    result.channels[1][i] = value;
  }
  return result;
}

function sigMix(buffers, gains) {
  const sampleRate = buffers[0].sampleRate;
  const channelCount = buffers.reduce((count, buffer) => Math.max(count, buffer.channels.length), 0);
  const length = buffers.reduce((max, buffer) => Math.max(max, buffer.channels[0].length), 0);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
  for (let j = 0; j < buffers.length; j++) {
    const gain = gains[j];
    for (let channel = 0; channel < buffers[j].channels.length; channel++) {
      const source = buffers[j].channels[channel];
      for (let i = 0; i < source.length; i++) channels[channel][i] += gain * source[i];
    }
  }
  return { sampleRate, channels };
}

function sigConcat(buffers) {
  const sampleRate = buffers[0].sampleRate;
  const channelCount = buffers.reduce((count, buffer) => Math.max(count, buffer.channels.length), 0);
  const length = buffers.reduce((sum, buffer) => sum + buffer.channels[0].length, 0);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
  let offset = 0;
  for (const buffer of buffers) {
    const partLength = buffer.channels[0].length;
    for (let channel = 0; channel < buffer.channels.length; channel++) {
      channels[channel].set(buffer.channels[channel], offset);
    }
    offset += partLength;
  }
  return { sampleRate, channels };
}

// Phase 16 §5.8 の K 特性（js/mfs-dsp.js の MfsBiquad.kWeighting。係数は複製しない）で全区間のラウドネスを測り、
// 目標 LUFS になるよう全体に定数を掛けた新しい PcmBuffer を返す。無音（エネルギー 0）はそのままコピーする。
// MfsBiquad / MFS_CONST は呼び出し時に参照する（呼び出し側が js/mfs-const.js と js/mfs-dsp.js を読み込んでおくこと）
function sigScaleToLufs(buf, targetLufs) {
  const sr = buf.sampleRate;
  const length = buf.channels[0].length;
  let sum = 0;
  for (let c = 0; c < 2; c++) {
    const src = buf.channels[c < buf.channels.length ? c : 0];
    const [s1, s2] = MfsBiquad.kWeighting(sr);
    let acc = 0;
    for (let i = 0; i < length; i++) {
      const y = s2.process(s1.process(src[i]));
      acc += y * y;
    }
    sum += acc / length;
  }
  const channels = buf.channels.map((ch) => new Float32Array(ch));
  if (!(sum > 0)) return { sampleRate: sr, channels };
  const loud = MFS_CONST.LOUD_OFFSET + 10 * Math.log10(sum);
  const gain = Math.pow(10, (targetLufs - loud) / 20);
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  return { sampleRate: sr, channels };
}

function synthFrame(i, freqLen, timeLen, outFreq, outTime) {
  const pulse = i % 15 < 3 ? 1.0 : 0.4;
  const center1 = 0.10 + 0.05 * Math.sin(i * 0.07);
  const center2 = 0.50 + 0.30 * Math.sin(i * 0.023);
  for (let k = 0; k < freqLen; k++) {
    const position = k / freqLen;
    const value = 200 * Math.exp(-((position - center1) ** 2) / (2 * 0.02 ** 2))
      + 150 * pulse * Math.exp(-((position - center2) ** 2) / (2 * 0.05 ** 2))
      + 40 * (0.5 + 0.5 * Math.sin(0.3 * k + 0.1 * i));
    outFreq[k] = _signalsClamp(Math.round(value), 0, 255);
  }
  for (let n = 0; n < timeLen; n++) {
    const value = 128 + 90 * (0.5 + 0.5 * pulse)
      * Math.sin(2 * Math.PI * n * (3 + i % 7) / timeLen);
    outTime[n] = _signalsClamp(Math.round(value), 0, 255);
  }
  return { freq: outFreq, time: outTime };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sigSine,
    sigNoise,
    sigClickTrack,
    sigDrumPattern,
    sigChord,
    sigMix,
    sigConcat,
    sigScaleToLufs,
    synthFrame
  };
}
