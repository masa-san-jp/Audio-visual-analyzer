// 目的 — Phase 17 モジュレーション: 曲の特徴（キック・拍・音量など）で設定値を毎フレーム動かす — doc/20261120-plan-phase17-21-modulation-and-portrait.md §2
// 計算は FramePipeline の1か所だけで行う（ライブ・書き出し・自動演出で同じ効果になる）。保存値は変えない。

const MOD_MAX_ROUTES = 4;

// 連動元: 曲の特徴（MfsFrameView）から 0..1 の値を取り出す
const MOD_SOURCES = {
  kick:     { label: 'キック（低音の打撃）',   value: f => f.onset.env[0] },
  snare:    { label: 'スネア（中音の打撃）',   value: f => f.onset.env[1] },
  hat:      { label: 'ハイハット（高音の打撃）', value: f => f.onset.env[2] },
  beat:     { label: '拍',                   value: f => (f.tempo.locked ? Math.pow(1 - f.tempo.beatPhase, 4) : 0) },
  downbeat: { label: '小節の頭',             value: f => (f.tempo.locked && f.tempo.beatInBar === 0 ? Math.pow(1 - f.tempo.beatPhase, 4) : 0) },
  level:    { label: '音量',                 value: f => f.loudness.level },
  bright:   { label: '音の明るさ',           value: f => f.timbre.centroid },
  width:    { label: '音の広がり',           value: f => f.stereo.width },
};

// 連動先: kind 'add' は base + amount·range·v、'mul' は base·(1 + amount·range·v)。結果は [min, max] にクランプ（hue は 360 で折り返す）
const MOD_TARGETS = {
  hue:                 { label: '色相',             kind: 'add', range: 180, min: 0,   max: 360, wrap: true },
  sensitivity:         { label: '感度',             kind: 'mul', range: 1,   min: 0.1, max: 3 },
  afterimageIntensity: { label: '残像強度',         kind: 'add', range: 10,  min: 0,   max: 10 },
  barWidth:            { label: '線の太さ',         kind: 'add', range: 10,  min: 1,   max: 20 },
  density:             { label: '密度',             kind: 'add', range: 70,  min: 30,  max: 100 },
  baseOffset:          { label: '基準点オフセット', kind: 'add', range: 99,  min: 0,   max: 99 },
  motionSpeed:         { label: '動きの速さ',       kind: 'mul', range: 2,   min: 0.1, max: 3 },
  brightness:          { label: '輝度',             kind: 'add', range: 90,  min: 10,  max: 100 },
  saturation:          { label: '彩度',             kind: 'add', range: 100, min: 0,   max: 100 },
};

// 「おすすめ」の結線（UI のボタン用）
const MOD_RECOMMENDED = [
  { source: 'kick', target: 'sensitivity', amount: 0.6 },
  { source: 'beat', target: 'afterimageIntensity', amount: 0.4 },
  { source: 'bright', target: 'hue', amount: 0.25 },
];

// 保存値・JSON から読んだ値を、正しい結線の配列（最大4本、未知のキーや範囲外の強さは除く/丸める）にする
function normalizeModRoutes(routes) {
  if (!Array.isArray(routes)) return [];
  const out = [];
  for (const r of routes) {
    if (out.length >= MOD_MAX_ROUTES) break;
    if (!r || typeof r !== 'object') continue;
    if (!Object.hasOwn(MOD_SOURCES, r.source) || !Object.hasOwn(MOD_TARGETS, r.target)) continue;
    const amount = typeof r.amount === 'number' && isFinite(r.amount) ? Math.max(-1, Math.min(1, r.amount)) : 0;
    out.push({ source: r.source, target: r.target, amount });
  }
  return out;
}

function modSourceValue(source, features) {
  const s = MOD_SOURCES[source];
  if (!s || !features) return 0;
  const v = s.value(features);
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

// base の設定に結線を適用した値を out へ書いて返す（out は呼び出し側が使い回すオブジェクト）。
// 結線が無い・強さ 0 だけ・features が無いときは base をそのまま返す（従来と同じ描画）
function applyModulation(base, routes, features, out) {
  if (!features || !Array.isArray(routes) || routes.length === 0) return base;
  let active = false;
  for (const r of routes) if (r && r.amount) { active = true; break; }
  if (!active) return base;
  Object.assign(out, base);
  for (const r of routes) {
    const t = r && MOD_TARGETS[r.target];
    if (!t || !r.amount) continue;
    const v = modSourceValue(r.source, features);
    const cur = out[r.target];
    let next = t.kind === 'mul' ? cur * (1 + r.amount * t.range * v) : cur + r.amount * t.range * v;
    if (t.wrap) next = ((next % 360) + 360) % 360;
    else next = Math.max(t.min, Math.min(t.max, next));
    out[r.target] = next;
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MOD_MAX_ROUTES, MOD_SOURCES, MOD_TARGETS, MOD_RECOMMENDED, normalizeModRoutes, modSourceValue, applyModulation };
}
