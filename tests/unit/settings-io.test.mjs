import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../lib/load-classic.mjs';

const { get } = loadClassic(['js/settings.js', 'js/settings-io.js']);
const createDefaultSettings = get('createDefaultSettings');
const serializeSettings = get('serializeSettings');
const deserializeSettings = get('deserializeSettings');

test('U15-01 settings-io: 既定設定のシリアライズとデシリアライズが深く一致する', () => {
  const defaults = createDefaultSettings();
  const restored = deserializeSettings(serializeSettings(defaults));

  assert.deepEqual(restored, defaults);
});

test('U15-01 settings-io: 不正入力は例外を出さず既定値へフォールバックする', () => {
  const defaults = createDefaultSettings();
  const invalidInputs = [
    null,
    {},
    { settings: null },
    { settings: 'not-an-object' },
    { settings: { hue: 'not-a-number', hueContinuousMode: 'not-a-boolean' } },
    { settings: { unknownSetting: 'ignored' } },
    { settings: { layers: undefined } },
  ];

  for (const input of invalidInputs) {
    assert.doesNotThrow(() => deserializeSettings(input));
    assert.deepEqual(deserializeSettings(input), defaults);
  }
});

test('U15-01 settings-io: Phase 16 の autoGain・layerSplit の往復と、旧形式・型不一致での既定値フォールバック', () => {
  const defaults = createDefaultSettings();
  assert.equal(defaults.autoGain, false);
  assert.equal(defaults.layerSplit, 'linear');

  const custom = { ...defaults, autoGain: true, layerSplit: 'mel' };
  const restored = deserializeSettings(serializeSettings(custom));
  assert.equal(restored.autoGain, true);
  assert.equal(restored.layerSplit, 'mel');

  const legacy = serializeSettings(defaults);
  delete legacy.settings.autoGain;
  delete legacy.settings.layerSplit;
  const fromLegacy = deserializeSettings(legacy);
  assert.equal(fromLegacy.autoGain, false);
  assert.equal(fromLegacy.layerSplit, 'linear');

  const wrongTypes = deserializeSettings({ settings: { autoGain: 'yes', layerSplit: 5 } });
  assert.equal(wrongTypes.autoGain, false);
  assert.equal(wrongTypes.layerSplit, 'linear');
});

test('U15-01 T18-11: 削除6タイプは JSON・保存プリセットで bar に戻り、演出プールから除外される', async t => {
  const removed = ['particles', 'ripple', 'flow', 'metaball', 'flower', 'voronoi'];
  const remaining = ['bar', 'radial', 'spectrogram', 'terrain', 'tunnel', 'bar3d', 'ring3d', 'lissajous'];
  const storage = new Map();
  const { get: lookup } = loadClassic(['js/settings.js', 'js/settings-io.js', 'js/ui-controller.js'], {
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  const savePreset = lookup('savePreset');
  const loadPreset = lookup('loadPreset');
  const readSettingsJsonFile = lookup('readSettingsJsonFile');
  const decode = lookup('deserializeSettings');
  const ui = Object.create(lookup('UIController').prototype);
  const names = [];
  for (const type of [...removed, ...remaining]) {
    const settings = { ...createDefaultSettings(), analyzerType: type, hue: 37, motionSpeed: 1.7 };
    const expected = { ...settings, analyzerType: removed.includes(type) ? 'bar' : type };
    assert.deepEqual(decode(serializeSettings(settings)), expected);
    assert.deepEqual(await readSettingsJsonFile({ text: async () => JSON.stringify(serializeSettings(settings)) }), expected);
    assert.equal(savePreset(type, settings), true);
    assert.deepEqual(loadPreset(type), expected);
    assert.deepEqual(loadPreset(type, { skipRemovedType: true }), removed.includes(type) ? null : expected);
    if (!removed.includes(type)) names.push(type);
  }
  const before = storage.get(lookup('SETTINGS_IO_PRESET_KEY'));
  const presets = ui._directorPresets();
  assert.deepEqual(presets.map(preset => preset.name), names.sort());
  assert.ok(presets.every(preset => remaining.includes(preset.settings.analyzerType)));
  assert.equal(storage.get(lookup('SETTINGS_IO_PRESET_KEY')), before);
  t.diagnostic('削除6タイプ × デシリアライズ・JSONファイル・保存読込・演出用読込、残存8タイプ保持、UI演出候補8件');
});
