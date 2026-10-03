// ソングマップ解析 後半（⑥〜⑨・SongMap v1）の単体テスト — doc/20260928-plan-phase18-song-map-and-auto-director.md §8.2
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { loadClassic } from '../lib/load-classic.mjs';
import { songmapRows, SONGMAP_ROW } from '../lib/songmap-rows.mjs';

const { get } = loadClassic([
  'js/mfs-const.js', 'js/songmap-analysis.js', 'js/vis-utils.js',
  'tests/shared/signals.js', 'tests/shared/song-synth.js'
]);
const buildSongMap = get('buildSongMap');
const makeRng = get('makeRng');
const songBoundaries = get('songBoundaries');
const songSections = get('songSections');
const validateSongMap = get('validateSongMap');
const SongMapError = get('SongMapError');
const synthSong = get('synthSong');

const songCache = new Map();

function fMeasure(est, truth, toleranceSec) {
  let i = 0;
  let j = 0;
  let hit = 0;
  while (i < est.length && j < truth.length) {
    const delta = est[i] - truth[j];
    if (Math.abs(delta) <= toleranceSec) {
      hit++;
      i++;
      j++;
    } else if (delta < 0) {
      i++;
    } else {
      j++;
    }
  }
  const precision = est.length ? hit / est.length : 0;
  const recall = truth.length ? hit / truth.length : 0;
  return precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
}

function countMatches(est, truth, toleranceSec) {
  let hit = 0;
  for (const value of est) {
    if (truth.some((target) => Math.abs(value - target) <= toleranceSec)) hit++;
  }
  return est.length ? hit / est.length : 0;
}

function synthesizedResult(bpm, sampleRate) {
  const key = bpm + '|' + sampleRate;
  if (songCache.has(key)) return songCache.get(key);
  const started = performance.now();
  const signal = synthSong(sampleRate, { bpm: bpm, seed: 11 });
  const generated = songmapRows(signal);
  const map = buildSongMap(generated.rows, {
    sampleRate: sampleRate,
    durationSec: generated.durationSec,
  });
  const result = { map: map, truth: { ...signal.truth, barSec: signal.barSec }, ms: performance.now() - started };
  songCache.set(key, result);
  console.log('# U18-08/09 ' + key
    + ' ms=' + result.ms.toFixed(1)
    + ' bpm=' + map.bpm.toFixed(2)
    + ' boundaries=' + map.sections.slice(1).map((section) => section.startSec.toFixed(3)).join(',')
    + ' kinds=' + map.sections.map((section) => section.kind).join(',')
    + ' labels=' + map.sections.map((section) => section.label).join(','));
  return result;
}

function makeBarVectors(blocks, seed) {
  const rng = makeRng(seed);
  const bases = [];
  for (let block = 0; block < 3; block++) {
    const vector = new Float64Array(44);
    for (let k = 0; k < vector.length; k++) vector[k] = rng() * 2 - 1;
    bases.push(vector);
  }
  const v = [];
  const E = new Float64Array(blocks.length * 8);
  for (let block = 0; block < blocks.length; block++) {
    for (let bar = 0; bar < 8; bar++) {
      const vector = new Float64Array(44);
      for (let k = 0; k < vector.length; k++) {
        vector[k] = bases[blocks[block]][k] + (rng() - 0.5) * 0.1;
      }
      v.push(vector);
    }
  }
  return { v: v, E: E };
}

function makeBars(count, barSec) {
  return Array.from({ length: count }, (_, index) => ({
    startSec: index * barSec,
    endSec: (index + 1) * barSec,
    energy: 0.5,
  }));
}

function sectionFixture(energyByBar, boundaries, bpm = 120) {
  const bars = makeBars(energyByBar.length, 2);
  const v = energyByBar.map((_, index) => {
    const vector = new Float64Array(44);
    vector[index % 44] = 1;
    return vector;
  });
  return songSections(boundaries, bars, v, Float64Array.from(energyByBar), bpm);
}

test('U18-05 境界: A/B/A/C の8小節ブロックを5境界へ分割する', () => {
  const data = makeBarVectors([0, 1, 0, 2], 0x1805);
  assert.deepEqual(Array.from(songBoundaries(data.v, data.E, 120)), [0, 8, 16, 24, 32]);
});

test('U18-06 最小長: 2小節だけ異なる区間の前後に境界を作らない', () => {
  const rng = makeRng(0x1806);
  const base = new Float64Array(44);
  const different = new Float64Array(44);
  for (let k = 0; k < 44; k++) {
    base[k] = rng() * 2 - 1;
    different[k] = rng() * 2 - 1;
  }
  const v = [];
  for (let bar = 0; bar < 32; bar++) {
    const source = bar === 1 || bar === 2 ? different : base;
    const vector = new Float64Array(44);
    for (let k = 0; k < 44; k++) vector[k] = source[k] + (rng() - 0.5) * 0.1;
    v.push(vector);
  }
  assert.deepEqual(Array.from(songBoundaries(v, new Float64Array(32), 120)), [0, 32]);
});

test('U18-07 種類: §4.2 ⑨の各行を2例ずつ満たす', () => {
  const cases = [
    ['intro', [0.2, 0.8, 0.8], [0, 1, 2, 3]],
    ['intro', [0.49, 0.7, 0.8], [0, 1, 2, 3]],
    ['outro', [0.8, 0.8, 0.2], [0, 1, 2, 3]],
    ['outro', [0.9, 0.8, 0.49], [0, 1, 2, 3]],
    ['break', [0.8, 0.3, 0.8], [0, 1, 2, 3]],
    ['break', [0.9, 0.4, 0.9], [0, 1, 2, 3]],
    ['build', [0.4, 0.1, 0.2, 0.3, 0.4, 0.8], [0, 1, 5, 6]],
    ['build', [0.4, 0.2, 0.3, 0.4, 0.5, 0.9], [0, 1, 5, 6]],
    ['drop', [0.8, 0.3, 0.8], [0, 1, 2, 3]],
    ['drop', [0.8, 0.2, 0.8], [0, 1, 2, 3]],
    ['main', [0.6, 0.55, 0.6], [0, 1, 2, 3]],
    ['main', [0.4, 0.4, 0.4], [0, 1, 2, 3]],
  ];
  for (const [expected, energies, boundaries] of cases) {
    const sections = sectionFixture(energies, boundaries);
    const actual = Array.from(sections).map((section) => section.kind);
    assert.ok(actual.includes(expected), expected + ' was not produced: ' + actual.join(','));
  }
});

for (const [bpm, sampleRate] of [
  [100, 48000], [100, 44100], [128, 48000], [128, 44100],
  [140, 48000], [140, 44100],
]) {
  test('U18-08 楽曲: ' + bpm + 'BPM/' + sampleRate + 'Hz の出力契約と構造', () => {
    const { map, truth } = synthesizedResult(bpm, sampleRate);
    assert.ok(Math.abs(map.bpm - bpm) / bpm <= 0.01, 'bpm=' + map.bpm);
    assert.ok(fMeasure(map.beats, truth.beats, 0.07) >= 0.95);
    assert.ok(countMatches(Array.from(map.downbeatIndices, (index) => map.beats[index]), truth.downbeats, 0.07) >= 0.9);
    const boundaryTruth = truth.boundariesBars.slice(1, -1).map((bar) => bar * truth.barSec);
    const boundaryEst = Array.from(map.sections).slice(1).map((section) => section.startSec);
    assert.equal(boundaryEst.length, 5);
    for (let i = 0; i < boundaryTruth.length; i++) {
      assert.ok(Math.abs(boundaryEst[i] - boundaryTruth[i]) <= truth.barSec + 0.07,
        'boundary ' + i + ': ' + boundaryEst[i] + ' vs ' + boundaryTruth[i]);
    }
    assert.deepEqual(Array.from(map.sections, (section) => section.kind),
      ['intro', 'build', 'drop', 'break', 'drop', 'outro']);
    const labels = Array.from(map.sections, (section) => section.label);
    assert.equal(labels[2], labels[4]);
    assert.notEqual(labels[0], labels[2]);
    const validation = validateSongMap(map); assert.equal(validation.ok, true); assert.deepEqual(Array.from(validation.errors), []);
  });
}

for (const sampleRate of [48000, 44100]) {
  test('U18-09 楽曲: 174BPM/' + sampleRate + 'Hz を87BPMへ折り返す', () => {
    const { map, truth } = synthesizedResult(174, sampleRate);
    assert.ok(Math.abs(map.bpm - 87) / 87 <= 0.01, 'bpm=' + map.bpm);
    const evenF = fMeasure(map.beats, truth.beats.filter((_, index) => index % 2 === 0), 0.07);
    const oddF = fMeasure(map.beats, truth.beats.filter((_, index) => index % 2 === 1), 0.07);
    assert.ok(Math.max(evenF, oddF) >= 0.95, 'even=' + evenF + ' odd=' + oddF);
    const boundaryTruth = truth.boundariesBars.slice(1, -1).map((bar) => bar * truth.barSec);
    const boundaryEst = Array.from(map.sections).slice(1).map((section) => section.startSec);
    const tolerance = 4 * 60 / map.bpm + 0.07;
    assert.equal(boundaryEst.length, 5);
    for (let i = 0; i < boundaryTruth.length; i++) {
      assert.ok(Math.abs(boundaryEst[i] - boundaryTruth[i]) <= tolerance,
        'boundary ' + i + ': ' + boundaryEst[i] + ' vs ' + boundaryTruth[i]);
    }
    assert.deepEqual(Array.from(map.sections, (section) => section.kind),
      ['intro', 'build', 'drop', 'break', 'drop', 'outro']);
    const labels = Array.from(map.sections, (section) => section.label);
    assert.equal(labels[2], labels[4]);
    assert.notEqual(labels[0], labels[2]);
    const validation = validateSongMap(map); assert.equal(validation.ok, true); assert.deepEqual(Array.from(validation.errors), []);
  });
}

test('U18-11 エラー: 無音30秒はno-rhythm、10秒はtoo-short', () => {
  const rowLength = SONGMAP_ROW.LENGTH;
  const rows = new Float32Array(Math.floor(30 * 48000 / 512) * rowLength);
  assert.throws(
    () => buildSongMap(rows, { sampleRate: 48000, durationSec: 30 }),
    (error) => error instanceof SongMapError && error.code === 'no-rhythm'
  );
  assert.throws(
    () => buildSongMap(new Float32Array(1), { sampleRate: 48000, durationSec: 10 }),
    (error) => error instanceof SongMapError && error.code === 'too-short'
  );
});

