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
