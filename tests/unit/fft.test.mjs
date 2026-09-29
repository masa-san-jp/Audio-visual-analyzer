import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['js/fft.js', 'js/vis-utils.js']);
const SpectrumAnalyzer = get('SpectrumAnalyzer');
const makeRng = get('makeRng');

function referenceSpectrum(timeData, minDecibels, maxDecibels) {
  const n = timeData.length;
  const result = new Uint8Array(n / 2);
  const windowed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / n)
      + 0.08 * Math.cos(4 * Math.PI * i / n);
    windowed[i] = timeData[i] * window;
  }

  const range = maxDecibels - minDecibels;
  for (let k = 0; k < n / 2; k++) {
    let real = 0;
    let imaginary = 0;
    for (let i = 0; i < n; i++) {
      const angle = -2 * Math.PI * k * i / n;
      real += windowed[i] * Math.cos(angle);
      imaginary += windowed[i] * Math.sin(angle);
    }
    const magnitude = Math.sqrt(real * real + imaginary * imaginary) / n;
    const db = 20 * Math.log10(magnitude);
    let value = Math.floor(255 * (db - minDecibels) / range);
    if (!(value > 0)) value = 0;
    else if (value > 255) value = 255;
    result[k] = value;
  }
  return result;
}

test('U15-04 fft: SpectrumAnalyzer は倍精度の素朴な DFT 参照と一致する', () => {
  const fftSize = 256;
  let exactMatches = 0;
  let totalBins = 0;

  for (let seed = 1; seed <= 5; seed++) {
    const rng = makeRng(seed);
    const input = new Float32Array(fftSize);
    for (let i = 0; i < input.length; i++) input[i] = rng() * 2 - 1;

    const actual = new Uint8Array(fftSize / 2);
    const analyzer = new SpectrumAnalyzer(fftSize, 0, -100, -30);
    analyzer.analyze(input, actual);
    const expected = referenceSpectrum(input, -100, -30);

    for (let i = 0; i < actual.length; i++) {
      assert.ok(Math.abs(actual[i] - expected[i]) <= 1,
        `seed=${seed}, bin=${i}: actual=${actual[i]}, expected=${expected[i]}`);
      if (actual[i] === expected[i]) exactMatches++;
      totalBins++;
    }
  }

  assert.ok(exactMatches / totalBins >= 0.99,
    `完全一致率 ${exactMatches}/${totalBins} が 99% 未満です`);
});
