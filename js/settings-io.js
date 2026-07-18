// 設定シリアライズ基盤 — doc/plan-phase8.md §8.1
// プリセット保存/読込（localStorage）と JSON ファイル入出力が共有するシリアライズ形式。

const SETTINGS_IO_VERSION = 1;
const SETTINGS_IO_PRESET_KEY = 'avz.presets.v1';

function serializeSettings(settings) {
  return {
    version: SETTINGS_IO_VERSION,
    settings: {
      ...settings,
      layers: settings.layers.map(l => ({ ...l })),
    },
  };
}

// 既定値へ安全にフォールバックしつつマージする。
// 型不一致・欠損・不正なJSON構造でもクラッシュせず既定値を採用する。
function deserializeSettings(json) {
  const base = createDefaultSettings();
  if (!json || typeof json !== 'object' || !json.settings || typeof json.settings !== 'object') {
    return base;
  }
  const src = json.settings;
  const out = { ...base };
  for (const key of Object.keys(base)) {
    if (key === 'layers') continue;
    const srcVal = src[key];
    if (srcVal === undefined) continue;
    const defVal = base[key];
    if (typeof defVal === 'number') {
      if (typeof srcVal === 'number' && isFinite(srcVal)) out[key] = srcVal;
    } else if (typeof defVal === 'boolean') {
      if (typeof srcVal === 'boolean') out[key] = srcVal;
    } else if (typeof defVal === 'string') {
      if (typeof srcVal === 'string') out[key] = srcVal;
    }
  }
  if (Array.isArray(src.layers)) {
    out.layers = base.layers.map((defLayer, i) => {
      const srcLayer = src.layers[i];
      if (!srcLayer || typeof srcLayer !== 'object') return { ...defLayer };
      const layer = { ...defLayer };
      if (typeof srcLayer.hueOffset === 'number' && isFinite(srcLayer.hueOffset)) layer.hueOffset = srcLayer.hueOffset;
      if (typeof srcLayer.sensitivity === 'number' && isFinite(srcLayer.sensitivity)) layer.sensitivity = srcLayer.sensitivity;
      if (typeof srcLayer.blendMode === 'string') layer.blendMode = srcLayer.blendMode;
      return layer;
    });
  }
  return out;
}

// ── プリセット（localStorage） ──

function _presetStorageAvailable() {
  try { return typeof localStorage !== 'undefined'; } catch (_) { return false; }
}

function _readPresetMap() {
  try {
    const raw = localStorage.getItem(SETTINGS_IO_PRESET_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return (map && typeof map === 'object') ? map : {};
  } catch (_) { return {}; }
}

function listPresets() {
  if (!_presetStorageAvailable()) return [];
  return Object.keys(_readPresetMap()).sort();
}

function savePreset(name, settings) {
  if (!_presetStorageAvailable() || !name) return false;
  try {
    const map = _readPresetMap();
    map[name] = serializeSettings(settings);
    localStorage.setItem(SETTINGS_IO_PRESET_KEY, JSON.stringify(map));
    return true;
  } catch (_) { return false; }
}

function loadPreset(name) {
  if (!_presetStorageAvailable()) return null;
  const map = _readPresetMap();
  if (!map[name]) return null;
  return deserializeSettings(map[name]);
}

function deletePreset(name) {
  if (!_presetStorageAvailable()) return false;
  try {
    const map = _readPresetMap();
    delete map[name];
    localStorage.setItem(SETTINGS_IO_PRESET_KEY, JSON.stringify(map));
    return true;
  } catch (_) { return false; }
}

// ── ファイル入出力 ──

function downloadSettingsJson(settings, filename) {
  const json = serializeSettings(settings);
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'avz-settings.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function readSettingsJsonFile(file) {
  const text = await file.text();
  const json = JSON.parse(text);
  return deserializeSettings(json);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    serializeSettings, deserializeSettings,
    listPresets, savePreset, loadPreset, deletePreset,
    downloadSettingsJson, readSettingsJsonFile,
    SETTINGS_IO_VERSION, SETTINGS_IO_PRESET_KEY,
  };
}
