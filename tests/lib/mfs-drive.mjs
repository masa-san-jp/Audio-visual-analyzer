// MFS テスト用ドライバ — MfsExtractor 統合前に、計画書 §5.1 / §5.3 どおりホップ分割・Hann 窓・FFT で
// 振幅スペクトル A を作り、MfsOnset（と MfsTempo）を駆動する（tests/ 専用。アプリ本体は参照しない）。
import { loadClassic } from './load-classic.mjs';

const { get } = loadClassic([
  'js/mfs-const.js', 'js/mfs-dsp.js', 'js/mfs-onset.js', 'js/mfs-tempo.js', 'tests/shared/signals.js'
]);
export const MFS_CONST = get('MFS_CONST');
export const mfsDerived = get('mfsDerived');
export const MfsOnset = get('MfsOnset');
export const MfsTempo = get('MfsTempo');
export const sig = {
  sigClickTrack: get('sigClickTrack'),
  sigDrumPattern: get('sigDrumPattern'),
  sigNoise: get('sigNoise'),
  sigMix: get('sigMix'),
  sigConcat: get('sigConcat')
};
const mfsWindowHann = get('mfsWindowHann');
const MfsFft = get('MfsFft');

const N = MFS_CONST.FFT_SIZE;
const H = MFS_CONST.HOP_SIZE;

// 信号 { sampleRate, channels:[L,R] } をホップごとに処理し、cb(A, tSec, h) を呼ぶ。A は使い回される Float64Array(N/2)
export function forEachHop(signal, cb) {
  const sr = signal.sampleRate;
  const [L, R] = signal.channels;
  const w = mfsWindowHann(N);
  const fft = new MfsFft(N);
  const reL = new Float64Array(N), imL = new Float64Array(N);
  const reR = new Float64Array(N), imR = new Float64Array(N);
  const A = new Float64Array(N / 2);
  const scale = 2 / (N / 2);
  const hops = Math.floor(L.length / H);
  // L と R が同一内容なら R の FFT を省く（A = |XL|·scale と数値的に同じ。テスト時間の短縮のみが目的）
  let same = true;
  for (let i = 0; i < L.length; i++) if (L[i] !== R[i]) { same = false; break; }
  for (let h = 0; h < hops; h++) {
    const end = (h + 1) * H;
    for (let n = 0; n < N; n++) {
      const idx = end - N + n;
      const l = idx >= 0 ? L[idx] : 0, r = idx >= 0 ? R[idx] : 0;
      reL[n] = l * w[n]; imL[n] = 0;
      if (!same) { reR[n] = r * w[n]; imR[n] = 0; }
    }
    fft.transform(reL, imL);
    if (same) {
      for (let k = 0; k < N / 2; k++) {
        const re = reL[k], im = imL[k];
        A[k] = Math.sqrt(re * re + im * im) * scale;
      }
    } else {
      fft.transform(reR, imR);
      for (let k = 0; k < N / 2; k++) {
        const re = reL[k] + reR[k], im = imL[k] + imR[k];
        A[k] = Math.sqrt(re * re + im * im) * scale / 2;
      }
    }
    cb(A, end / sr, h);
  }
}

// MfsOnset → MfsTempo を駆動し、ホップごとの出力列を返す
export function runTempo(signal) {
  const sr = signal.sampleRate;
  const hops = Math.floor(signal.channels[0].length / H);
  const onset = new MfsOnset(sr, N);
  const tempo = new MfsTempo(sr);
  const rec = {
    sr, hops,
    t: new Float64Array(hops), bpm: new Float64Array(hops), conf: new Float64Array(hops),
    phase: new Float64Array(hops), barPhase: new Float64Array(hops),
    beatInBar: new Uint8Array(hops), beat: new Uint8Array(hops), downbeat: new Uint8Array(hops),
    locked: new Uint8Array(hops)
  };
  forEachHop(signal, (A, tSec, h) => {
    const flags = onset.process(A, tSec);
    tempo.process(onset.odf, onset.odfLow, flags, onset.env[3], tSec);
    rec.t[h] = tSec; rec.bpm[h] = tempo.bpm; rec.conf[h] = tempo.conf;
    rec.phase[h] = tempo.phase; rec.barPhase[h] = tempo.barPhase;
    rec.beatInBar[h] = tempo.beatInBar; rec.beat[h] = tempo.beatFlag;
    rec.downbeat[h] = tempo.downbeatFlag; rec.locked[h] = tempo.locked;
  });
  return rec;
}
