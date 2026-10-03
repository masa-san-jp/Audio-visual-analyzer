// ソングマップの拍情報置き換え — doc/20260928-plan-phase18-song-map-and-auto-director.md §4.4 / §8.2 U18-12
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClassic } from '../lib/load-classic.mjs';

// DIRECTOR_CONST（SEEK_RESET_SEC）は js/director-timeline.js（T18-07）の実物を使う
const { get } = loadClassic(['js/vis-utils.js', 'js/mfs-const.js', 'js/mfs-view.js', 'js/songmap-analysis.js',
  'js/director-scenes.js', 'js/director-timeline.js'], {
  module: { exports: {} },
});
const songMapTempoAt = get('songMapTempoAt');
const MfsFrameView = get('MfsFrameView');
const MFS_LAYOUT = get('MFS_LAYOUT');
const tempoKeys = ['BPM', 'TEMPO_CONF', 'TEMPO_LOCKED', 'BEAT_PHASE', 'BAR_PHASE',
  'BEAT_IN_BAR', 'BEAT_FLAG', 'DOWNBEAT_FLAG'];
const map = Object.freeze({
  version: 1, sampleRate: 48000, durationSec: 6, bpm: 120, tempoConfidence: 0.875,
  beatSource: 'grid', beats: Object.freeze([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]),
  downbeatIndices: Object.freeze([1, 5]),
  bars: [], sections: [],
});

function assertTempo(view, expected, context) {
  tempoKeys.forEach((key, index) => {
    assert.equal(view.raw[MFS_LAYOUT[key]], Math.fround(expected[index]), `${context}: ${key}`);
  });
  assert.equal(view.tempo.locked, expected[2] === 1);
  assert.equal(view.tempo.beatFlag, expected[6] === 1);
  assert.equal(view.tempo.downbeatFlag, expected[7] === 1);
}

test('U18-12 拍の直前・直後・拍上・小節頭・弱起で全 tempo 値が定義どおり', () => {
  const view = new MfsFrameView();
  // [時刻, 前時刻, locked, beatPhase, barPhase, beatInBar, beatFlag, downbeatFlag]
  const cases = [
    [1, 0.99, 1, 0, 0.75, 3, 1, 0],
    [1.25, 1.125, 1, 0.5, 0.875, 3, 0, 0],
    [1.499, 1.498, 1, 0.998, 0.9995, 3, 0, 0],
    [1.5, 1.499, 1, 0, 0, 0, 1, 1],
    [1.501, 1.499, 1, 0.002, 0.0005, 0, 1, 1],
    [1.501, 1.5, 1, 0.002, 0.0005, 0, 0, 0],
    [2, 1.999, 1, 0, 0.25, 1, 1, 0],
    [2.25, 2.125, 1, 0.5, 0.375, 1, 0, 0],
    [3.5, 3.499, 1, 0, 0, 0, 1, 1],
  ];
  for (const [t, prev, ...expected] of cases) {
    view.raw.fill(-7);
    songMapTempoAt(map, t, prev, view);
    assertTempo(view, [120, 0.875, ...expected], `t=${t}, prev=${prev}`);
  }
});

test('U18-12 拍区間外は BPM・confidence を保持し位相・ロック・フラグを 0 にする', () => {
  const view = new MfsFrameView();
  for (const [t, prev] of [[0, null], [0.999, 0.998], [5, 4.999], [5.001, 4.999], [6, 5.5]]) {
    view.raw.fill(9);
    songMapTempoAt(map, t, prev, view);
    assertTempo(view, [120, 0.875, 0, 0, 0, 0, 0, 0], `t=${t}`);
  }
});

test('U18-12 シーク・初回はフラグ 0、ちょうど 1 秒と (prev, t] の端点を確認', () => {
  const view = new MfsFrameView();
  for (const prev of [null, 3.75, 2.499]) {
    view.raw.fill(9);
    songMapTempoAt(map, 3.5, prev, view);
    assertTempo(view, [120, 0.875, 1, 0, 0, 0, 0, 0], `prev=${prev}`);
  }
  for (const [t, prev, phase, barPhase, beatInBar, beatFlag, downbeatFlag] of [
    [3.5, 2.5, 0, 0, 0, 1, 1],
    [3.5, 3.5, 0, 0, 0, 0, 0],
    [3.75, 3.5, 0.5, 0.125, 0, 0, 0],
    // 最新の拍が小節頭でなくても、区間内に小節頭があればフラグを立てる。
    [2.125, 1.125, 0.25, 0.3125, 1, 1, 1],
  ]) {
    songMapTempoAt(map, t, prev, view);
    assertTempo(view, [120, 0.875, 1, phase, barPhase, beatInBar, beatFlag, downbeatFlag],
      `t=${t}, prev=${prev}`);
  }
});

// §4.4 の定義を線形探索で評価する独立した参照実装（テスト専用）。
function referenceTempo(songMap, t, prev) {
  const { beats, downbeatIndices, bpm, tempoConfidence } = songMap;
  const i = beats.findIndex((beat, index) => beat <= t && t < beats[index + 1]);
  if (i < 0) return [bpm, tempoConfidence, 0, 0, 0, 0, 0, 0];
  const phase = (t - beats[i]) / (beats[i + 1] - beats[i]);
  const inBar = ((i - downbeatIndices[0]) % 4 + 4) % 4;
  const seek = prev === null || t < prev || t - prev > 1.0;
  return [bpm, tempoConfidence, 1, phase, (inBar + phase) / 4, inBar,
    !seek && beats.some((beat) => prev < beat && beat <= t) ? 1 : 0,
    !seek && downbeatIndices.some((index) => prev < beats[index] && beats[index] <= t) ? 1 : 0];
}

test('U18-12 格子 fixture・不均等 DP 拍で線形定義と一致し入力・参照・他の特徴を保持', (t) => {
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/songmap-128.json', import.meta.url), 'utf8'));
  const dpMap = { ...map, beatSource: 'dp', beats: [1, 1.2, 1.45, 1.7, 2.1, 2.3, 2.65, 3, 3.3] };
  const view = new MfsFrameView();
  const raw = view.raw;
  const tempo = view.tempo;
  const tempoOffsets = new Set(tempoKeys.map((key) => MFS_LAYOUT[key]));
  let comparisons = 0;
  let maxPhaseError = 0;
  for (const songMap of [fixture, dpMap]) {
    const before = JSON.stringify(songMap);
    for (let frame = 0; frame < 1000; frame++) {
      const time = frame * songMap.durationSec / 999;
      const prev = frame === 0 ? null : (frame - 1) * songMap.durationSec / 999;
      raw.fill(-7);
      const expected = referenceTempo(songMap, time, prev);
      songMapTempoAt(songMap, time, prev, view);
      assertTempo(view, expected, `frame=${frame}, source=${songMap.beatSource}`);
      maxPhaseError = Math.max(maxPhaseError, Math.abs(view.tempo.beatPhase - expected[3]),
        Math.abs(view.tempo.barPhase - expected[4]));
      for (let index = 0; index < raw.length; index++) {
        if (!tempoOffsets.has(index)) assert.equal(raw[index], -7, `他の特徴 index=${index}`);
      }
      assert.equal(view.raw, raw);
      assert.equal(view.tempo, tempo);
      comparisons++;
    }
    assert.equal(JSON.stringify(songMap), before);
  }
  t.diagnostic(`比較=${comparisons} フレーム、最大位相誤差=${maxPhaseError.toExponential(6)}（Float32 丸め）`);
});

test('U18-12 null features は処理せず Node 用にも関数を公開する', () => {
  assert.doesNotThrow(() => songMapTempoAt(null, 0, null, null));
  // 後続ファイルが module.exports を上書きするため、公開の確認は songmap-analysis.js 単独の読み込みで行う
  const alone = loadClassic(['js/mfs-const.js', 'js/mfs-view.js', 'js/songmap-analysis.js'], { module: { exports: {} } });
  assert.equal(typeof alone.get('module.exports').songMapTempoAt, 'function');
});
