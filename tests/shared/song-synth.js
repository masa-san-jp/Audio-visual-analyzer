// 目的 — ソングマップ解析のテスト用に、構成が既知の合成楽曲を決定的に生成する — doc/20260928-plan-phase18-song-map-and-auto-director.md §8.1
// Node とブラウザの両方で使う classic script。乱数は js/vis-utils.js の makeRng と同一の実装を内蔵する
// （tests/shared/signals.js と同じ方針。アプリ本体を参照しない）。乱数の消費順が結果に影響するため、手順・順序は §8.1 のとおり。

function _songSynthMakeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 構成: [kind, 小節数]（計 64 小節、4/4）
const SONG_SYNTH_PLAN = [
  ['intro', 8], ['build', 8], ['drop', 16], ['break', 8], ['drop', 16], ['outro', 8]
];
// コード進行 Am F C G（MIDI）
const SONG_SYNTH_PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];

function synthSong(sampleRate, { bpm = 128, seed = 11 } = {}) {
  const sr = sampleRate;
  const barSec = 4 * 60 / bpm;
  const totalBars = SONG_SYNTH_PLAN.reduce((s, p) => s + p[1], 0);
  const n = Math.round(totalBars * barSec * sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = _songSynthMakeRng(seed);
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const add = (i, v, pan = 0) => {
    if (i < 0 || i >= n) return;
    L[i] += v * Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2;
    R[i] += v * Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  };
  const padAmpOf = { intro: 0.05, build: 0.06, drop: 0.08, break: 0.07 };
  const hatAmpOf = { drop: 0.2, break: 0.06 };

  let gb = 0;
  for (const [kind, nb] of SONG_SYNTH_PLAN) {
    for (let b = 0; b < nb; b++, gb++) {
      const t0 = gb * barSec;
      const chord = SONG_SYNTH_PROG[gb % 4];
      const frac = b / nb;
      const s0 = Math.round(t0 * sr), s1 = Math.round((t0 + barSec) * sr);

      // (1) パッド
      const padAmp = kind === 'outro' ? 0.05 * (1 - frac) : padAmpOf[kind];
      for (let i = s0; i < s1; i++) {
        const env = Math.min(1, (i - s0) / sr / 0.05);
        let v = 0;
        for (let k = 0; k < 3; k++) {
          const f = midi(chord[k]);
          v += Math.sin(2 * Math.PI * f * i / sr) + 0.5 * Math.sin(4 * Math.PI * f * i / sr);
        }
        add(i, padAmp * env * v / 3);
      }

      // (2) 16分音符ごとのキック・ハット・スネア・ベース（この順）
      const drums = kind === 'drop';
      for (let q = 0; q < 16; q++) {
        const ts = t0 + q * barSec / 16;
        const s = Math.round(ts * sr);
        // キック
        if ((drums && q % 4 === 0) || (kind === 'build' && b >= 4 && q % 4 === 0)) {
          const len = Math.round(0.12 * sr);
          let ph = 0;
          for (let i = 0; i < len; i++) {
            ph += 2 * Math.PI * (60 - 20 * i / len) / sr;
            add(s + i, 0.9 * Math.sin(ph) * Math.exp(-i / (0.04 * sr)));
          }
        }
        // ハット
        const amp = kind === 'build' ? 0.05 + 0.25 * frac : (hatAmpOf[kind] || 0);
        let on = false;
        if (kind === 'drop') on = q % 2 === 0;
        else if (kind === 'build') on = true;
        else if (kind === 'break') on = q % 4 === 2;
        if (on && amp > 0) {
          const len = Math.round(0.03 * sr);
          let prev = 0;
          for (let i = 0; i < len; i++) {
            const w = rng() * 2 - 1;
            add(s + i, amp * (w - prev) * Math.exp(-i / (0.008 * sr)), 0.3);
            prev = w;
          }
        }
        // スネア
        if (drums && (q === 4 || q === 12)) {
          const len = Math.round(0.08 * sr);
          let ph = 0;
          for (let i = 0; i < len; i++) {
            ph += 2 * Math.PI * 200 / sr;
            add(s + i, (0.3 * Math.sin(ph) + 0.3 * (rng() * 2 - 1)) * Math.exp(-i / (0.02 * sr)), -0.1);
          }
        }
        // ベース
        if (drums && q % 2 === 0) {
          const f = midi(chord[0] - 24);
          const len = Math.round(barSec / 8 * sr);
          for (let i = 0; i < len; i++) {
            add(s + i, 0.35 * Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / (0.15 * sr)));
          }
        }
      }

      // (3) ライザー
      if (kind === 'build') {
        for (let i = s0; i < s1; i++) {
          add(i, 0.15 * ((b + (i - s0) / (s1 - s0)) / nb) * (rng() * 2 - 1));
        }
      }
    }
  }

  // 正規化（ピークを 0.9 に）
  let pk = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]), c = Math.abs(R[i]);
    if (a > pk) pk = a;
    if (c > pk) pk = c;
  }
  if (pk > 0) {
    const g = 0.9 / pk;
    for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  }

  const beats = [], downbeats = [];
  for (let k = 0; k < totalBars * 4; k++) beats.push(k * 60 / bpm);
  for (let k = 0; k < totalBars; k++) downbeats.push(k * barSec);
  const truth = {
    boundariesBars: [0, 8, 16, 32, 40, 56, 64],
    kinds: ['intro', 'build', 'drop', 'break', 'drop', 'outro'],
    beats,
    downbeats
  };
  return { channels: [L, R], sampleRate, truth, barSec };
}

// テンポ変化曲: 120BPM 30 秒 → 126BPM 30 秒（キック4つ打ち＋8分ハット）。
// 計画書にない追加: 拍の真値 truth.beats（秒）を付ける（U18-10 の拍 F 値の評価用）
function synthTempoChange(sampleRate) {
  const a = sigDrumPattern(sampleRate, 30, 120);
  const b = sigDrumPattern(sampleRate, 30, 126);
  const out = sigConcat([a, b]);
  const beats = [];
  for (let k = 0; k * 0.5 < 30; k++) beats.push(k * 60 / 120);
  for (let k = 0; k * 60 / 126 < 30; k++) beats.push(30 + k * 60 / 126);
  out.truth = { beats };
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { synthSong, synthTempoChange };
}
