// 音楽特徴ストリーム（MFS）の定数・データ配置・導出値 — doc/20260928-plan-phase16-music-feature-stream.md §3 / §3.1 / §4
//
// 値の唯一の正は計画書の定数表。変更する場合は先に計画書を更新する（ガイド §2.2）。
// ワークレットへは JSON.stringify(MFS_CONST) / mfsDerived.toString() で埋め込むため、
// mfsDerived は MFS_CONST 以外のグローバルを参照しない。

const MFS_CONST = {
  FFT_SIZE: 2048,
  HOP_SIZE: 512,
  FREQ_MIN_HZ: 50,
  FREQ_MAX_HZ: 15000,
  MEL_BANDS: 32,
  BAND_DB_FLOOR: -80,
  BAND_DB_CEIL: 0,
  BAND_ATTACK_SEC: 0.01,
  BAND_RELEASE_SEC: 0.15,
  LEGACY_MIN_DB: -100,
  LEGACY_MAX_DB: -30,
  LEGACY_REF_FPS: 60,
  ONSET_LOG_GAMMA: 100,
  ONSET_GROUPS: [[50, 150], [150, 2500], [5000, 15000], [50, 15000]],
  ONSET_STAT_SEC: 1.0,
  ONSET_K: 2.0,
  ONSET_DELTA: 0.02,
  ONSET_REFRACTORY_SEC: 0.06,
  ONSET_PEAK_RELEASE_SEC: 2.0,
  ONSET_ENV_DECAY_SEC: 0.15,
  EVENT_LATENCY_FFT_FRACTION: 0.45,
  TEMPO_BUFFER_SEC: 8,
  TEMPO_MIN_FILL_SEC: 4,
  TEMPO_UPDATE_SEC: 0.5,
  TEMPO_SEARCH_MIN_BPM: 60,
  TEMPO_SEARCH_MAX_BPM: 200,
  TEMPO_GRID_STEP_BPM: 0.25,
  TEMPO_HARMONICS: 4,
  TEMPO_HALF_WEIGHT: 0.5,
  TEMPO_PRIOR_CENTER_BPM: 120,
  TEMPO_PRIOR_SIGMA_OCT: 0.9,
  TEMPO_FOLD_MIN_BPM: 80,
  TEMPO_FOLD_MAX_BPM: 160,
  TEMPO_MIN_CONF: 0.1,
  TEMPO_SAME_TOL: 0.02,
  TEMPO_REFINE_WEIGHT: 0.2,
  TEMPO_LOCK_COUNT: 2,
  TEMPO_SWITCH_COUNT: 3,
  PHASE_DISAMBIG_RATIO: 1.5,
  PLL_WINDOW: 0.2,
  PLL_GAIN: 0.3,
  BEAT_MIN_INTERVAL_FRAC: 0.5,
  BAR_BEATS: 4,
  BAR_DECAY: 0.9,
  BAR_LOOKBACK_HOPS: 3,
  BAR_ACCUM_HOPS: 4,
  CHROMA_MIN_HZ: 55,
  CHROMA_MAX_HZ: 5000,
  ROLLOFF_FRACTION: 0.85,
  LOUD_MOMENTARY_SEC: 0.4,
  LOUD_SHORT_SEC: 3.0,
  LOUD_OFFSET: -0.691,
  KW_SHELF_F0: 1681.974450955533,
  KW_SHELF_GAIN_DB: 3.999843853973347,
  KW_SHELF_Q: 0.7071752369554196,
  KW_SHELF_VB_EXPONENT: 0.4996667741545416,
  KW_HP_F0: 38.13547087602444,
  KW_HP_Q: 0.5003270373238773,
  LEVEL_FLOOR_LUFS: -60,
  AGC_TARGET_LUFS: -14,
  AGC_MIN_DB: -6,
  AGC_MAX_DB: 18,
  AGC_SILENCE_LUFS: -60,
  AGC_TIME_SEC: 2,
  LIVE_RING_SIZE: 32,
  LIVE_WATCHDOG_SEC: 2,
  EPS: 1e-12,
};

// 1ホップの特徴 packed（Float32Array(LENGTH)）のオフセット（計画書 §4）。長さは §4 の表で定義する
const MFS_LAYOUT = {
  BANDS: 0,
  BANDS_SMOOTH: 32,
  ONSET_ENV: 64,
  ONSET_FLAGS: 68,
  BPM: 69,
  TEMPO_CONF: 70,
  BEAT_PHASE: 71,
  BAR_PHASE: 72,
  BEAT_IN_BAR: 73,
  BEAT_FLAG: 74,
  DOWNBEAT_FLAG: 75,
  TEMPO_LOCKED: 76,
  STEREO_CORR: 77,
  STEREO_WIDTH: 78,
  STEREO_BALANCE: 79,
  STEREO_PAN: 80,
  CENTROID: 83,
  FLATNESS: 84,
  ROLLOFF: 85,
  CHROMA: 86,
  LOUD_MOMENTARY: 98,
  LOUD_SHORT: 99,
  LEVEL: 100,
  AGC_DB: 101,
  RMS: 102,
  PEAK: 103,
  LENGTH: 104,
};

// サンプルレートからの導出値（計画書 §3.1）。alpha / frames / binOf は関数として返す
function mfsDerived(sampleRate) {
  const H = MFS_CONST.HOP_SIZE;
  const N = MFS_CONST.FFT_SIZE;
  const fr = sampleRate / H;
  const binHz = sampleRate / N;
  return {
    fr: fr,
    hopSec: H / sampleRate,
    alpha: function (T) { return 1 - Math.exp(-H / (sampleRate * T)); },
    frames: function (T) { return Math.max(1, Math.round(T * fr)); },
    eventLatencySec: MFS_CONST.EVENT_LATENCY_FFT_FRACTION * N / sampleRate,
    binHz: binHz,
    binOf: function (hz) { return Math.round(hz / binHz); },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MFS_CONST, MFS_LAYOUT, mfsDerived };
}
