// ソングマップ解析用の行データ生成（tests/ 専用）— doc/20260928-plan-phase18-song-map-and-auto-director.md §3 / §8.2
// 合成音（PcmBuffer）を Node 上の MfsExtractor に通し、ワークレット songmap モードと同じ配置の
// 行（長さ 49 × ホップ数）を作る。ワークレットと同じく 128 サンプルずつ pushSamples し、ホップ完了ごとに 1 行を積む。
import { loadClassic } from './load-classic.mjs';

const { get } = loadClassic([
  'js/mfs-const.js', 'js/fft.js', 'js/mfs-dsp.js', 'js/mfs-onset.js',
  'js/mfs-tempo.js', 'js/mfs-extractor.js'
]);
export const MFS_CONST = get('MFS_CONST');
export const MFS_LAYOUT = get('MFS_LAYOUT');
const MfsExtractor = get('MfsExtractor');

// §3 の行配置。js/mfs-const.js に SONGMAP_ROW が入った（T18-02）ら、そちらを使う。
// それまでは §3 の表どおりのテスト内定義（T18-02 で置き換わる想定。アプリ本体には追加しない）
function resolveSongmapRow() {
  try {
    return get('SONGMAP_ROW');
  } catch (e) {
    return { FLUX: 0, BANDS: 4, CHROMA: 36, ENERGY: 48, LENGTH: 49 };
  }
}
export const SONGMAP_ROW = resolveSongmapRow();

const BLOCK = 128; // AudioWorklet のレンダー量子と同じ

// signal: { sampleRate, channels: [L, R] } → { rows: Float32Array(L·49), hops, sampleRate, durationSec }
// hops = floor(サンプル数 / HOP_SIZE)（ワークレットの「ホップ完了ごとに 1 行」と同じ）
export function songmapRows(signal) {
  const sr = signal.sampleRate;
  const [cl, cr] = signal.channels;
  const H = MFS_CONST.HOP_SIZE;
  const hops = Math.floor(cl.length / H);
  const LEN = SONGMAP_ROW.LENGTH;
  const rows = new Float32Array(hops * LEN);
  const ex = new MfsExtractor(sr);
  ex.onHop = (e) => {
    const base = e.hopIndex * LEN;
    for (let i = 0; i < 4; i++) rows[base + SONGMAP_ROW.FLUX + i] = e.flux[i];
    for (let i = 0; i < 32; i++) rows[base + SONGMAP_ROW.BANDS + i] = e.packed[MFS_LAYOUT.BANDS + i];
    for (let i = 0; i < 12; i++) rows[base + SONGMAP_ROW.CHROMA + i] = e.packed[MFS_LAYOUT.CHROMA + i];
    rows[base + SONGMAP_ROW.ENERGY] = e.hopEnergy;
  };
  for (let i = 0; i < cl.length; i += BLOCK) {
    const n = Math.min(BLOCK, cl.length - i);
    ex.pushSamples(cl.subarray(i, i + n), cr.subarray(i, i + n), n);
  }
  return { rows, hops, sampleRate: sr, durationSec: cl.length / sr };
}
