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
