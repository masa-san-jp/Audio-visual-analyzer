# Phase 16 実装計画書 — 音楽特徴ストリーム（Music Feature Stream / MFS）

- Document version: `v1.0`
- Date: `2026-09-28`
- 前提: Phase 15 完了（テスト基盤・`FramePipeline`）
- 作業ルール: `doc/20260928-implementation-guide-for-contractors.md`（以下「ガイド」）
- 目的: 解析を「8bit スペクトル＋単純ビート検出」から、**聴感帯域・オンセット・テンポ/拍位相・ステレオ・音色・和音・ラウドネス**を含む特徴ストリームへ格上げする。ライブ再生とオフライン書き出しは**同じ AudioWorklet・同じコード**で解析する（オーナー決定 D4）

---

## 1. スコープ

| 含む | 含まない |
|---|---|
| 特徴抽出コア（`js/mfs-*.js`）、AudioWorklet、ライブ/オフライン統合 | 既存レンダラーの改修（`frame.features` は追加のみ。使うのは Phase 17 以降） |
| `frame.features` の追加（レンダラー契約 v2） | 曲全体の先読み解析（Phase 18） |
| 設定 `autoGain`（音量自動補正）・`layerSplit`（レイヤー分割方式） | 調性（キー）推定（Phase 18 のソングマップで実施） |
| デバッグ表示への MFS 項目追加 | |

### 1.1 ユーザーから見える変化

| 変化 | 既定値での影響 |
|---|---|
| ライブ表示の解析が AudioWorklet 経由になり、**出力遅延を補正**して「今聞こえている音」の解析結果で描く | 描画が音に対して 10〜40ms 程度遅れて表示される（従来は音より先行していた）。見た目はほぼ同じ |
| オフライン書き出しの解析がライブと同じ細かさ（約 94 回/秒）になる | 書き出し結果の動きが従来（約 23 回/秒の階段状）より滑らかになり、ライブ表示に近づく |
| 新設定「音量自動補正」 | 既定 OFF（従来と同じ） |
| 新設定「レイヤー分割: 均等 / 聴感」 | 既定「均等」（従来と同じ） |

AudioWorklet が使えない環境では、従来の `AnalyserNode` 経路へ自動で戻り、`frame.features` は `null` になる（機能低下のみで動作は継続）。

---

## 2. 全体構成

```
[ライブ]  MediaElementSource / MediaStreamSource
             ├─→ AnalyserNode ─→ destination          （従来経路。フォールバック・録画用に残す）
             └─→ AudioWorkletNode 'mfs' ─→ Gain(0) ─→ destination
                     │ ホップごと（512サンプル）に postMessage
                     ▼
             AudioEngine: リングバッファ（32件）→ 出力時刻で1件選択 → MfsFrameView
                     ▼
             FramePipeline.render(input{freq, time, features, ...})

[オフライン] AudioBufferSource ─→ AudioWorkletNode 'mfs'（mode: offline）─→ destination
                     │ 出力フレーム時刻ごとに postMessage
                     ▼
             OfflineExporter: フレーム列 → FramePipeline.render（ライブと同じ）
```

### 2.1 新規ファイル

| ファイル | 内容 | 自己完結（ワークレット埋め込み対象） |
|---|---|---|
| `js/mfs-const.js` | `MFS_CONST`（§3）・`MFS_LAYOUT`（§4）・`mfsDerived(sampleRate)` | 値として埋め込む |
| `js/mfs-dsp.js` | `MfsFft`、`MfsMelBank`、`MfsBiquad`、`mfsWindowHann` | ○ |
| `js/mfs-onset.js` | `MfsOnset` | ○ |
| `js/mfs-tempo.js` | `MfsTempo`（テンポ推定・拍位相・小節） | ○ |
| `js/mfs-extractor.js` | `MfsExtractor`（ホップ分割と全特徴の統合） | ○ |
| `js/mfs-worklet.js` | `buildMfsWorkletSource()`、`createMfsWorkletUrl()`、プロセッサ本体のソース文字列 | — |
| `js/mfs-view.js` | `MfsFrameView`（メインスレッド側の読み取り用ビュー）、`applyAutoGain()`、`computeLayerRange()` | — |

`index.html` への追加位置: `js/fft.js` を現在の位置から `js/audio-engine.js` の直前へ移動し、その直後に `mfs-const.js` → `mfs-dsp.js` → `mfs-onset.js` → `mfs-tempo.js` → `mfs-extractor.js` → `mfs-worklet.js` → `mfs-view.js` の順で置く（`audio-engine.js` がこれらを参照するため）。

### 2.2 ワークレットへの埋め込み方式

既存 `js/analysis-worklet.js` と同じく、data: URL で生成する（`file://` 直開き対応）。

```js
function buildMfsWorkletSource() {
  return [
    'const MFS_CONST = ' + JSON.stringify(MFS_CONST) + ';',
    'const MFS_LAYOUT = ' + JSON.stringify(MFS_LAYOUT) + ';',
    mfsDerived.toString(), mfsWindowHann.toString(),
    SpectrumAnalyzer.toString(), MfsFft.toString(), MfsMelBank.toString(), MfsBiquad.toString(),
    MfsOnset.toString(), MfsTempo.toString(), MfsExtractor.toString(),
    MFS_PROCESSOR_SOURCE,             // class MfsProcessor extends AudioWorkletProcessor {...}
    "registerProcessor('mfs', MfsProcessor);",
  ].join('\n');
}
```

このため `mfs-dsp.js`〜`mfs-extractor.js` のクラス・関数は、`MFS_CONST` / `MFS_LAYOUT` / 上記リスト内のクラス以外を参照してはならない（`clamp` 等の `vis-utils.js` 関数も使用禁止。必要ならクラス内に静的メソッドとして持つ）。

---

## 3. 定数表（`MFS_CONST`）— 値の唯一の正

コードでは `MFS_CONST.<名前>` として、この表と同じ名前・値で定義する。**「校正」列が ○ の定数だけ**、T16-04 の実測結果に基づいて本書を更新する手続き（ガイド §2.2）で変更してよい。

| 名前 | 値 | 意味 | 校正 |
|---|---|---|---|
| `FFT_SIZE` | 2048 | 解析窓長 N（サンプル） | |
| `HOP_SIZE` | 512 | ホップ長 H（サンプル） | |
| `FREQ_MIN_HZ` | 50 | 解析帯域の下限（既存と同じ） | |
| `FREQ_MAX_HZ` | 15000 | 解析帯域の上限（既存と同じ） | |
| `MEL_BANDS` | 32 | メル帯域数 B | |
| `BAND_DB_FLOOR` | -80 | 帯域 dB の正規化下限 | |
| `BAND_DB_CEIL` | 0 | 帯域 dB の正規化上限 | |
| `BAND_ATTACK_SEC` | 0.01 | `bandsSmooth` の立ち上がり時定数 | |
| `BAND_RELEASE_SEC` | 0.15 | `bandsSmooth` の減衰時定数 | |
| `LEGACY_MIN_DB` | -100 | 従来 byte スペクトルの下限 dB（AnalyserNode 既定値） | |
| `LEGACY_MAX_DB` | -30 | 従来 byte スペクトルの上限 dB（AnalyserNode 既定値） | |
| `LEGACY_REF_FPS` | 60 | 平滑化係数の基準フレームレート | |
| `ONSET_LOG_GAMMA` | 100 | 対数圧縮 `log(1 + γ·A)` の γ | |
| `ONSET_GROUPS` | `[[50,150],[150,2500],[5000,15000],[50,15000]]` | オンセット帯域群（Hz）。順に low / mid / high / full | |
| `ONSET_STAT_SEC` | 1.0 | 閾値用の平均・偏差の時定数 | |
| `ONSET_K` | 2.0 | 閾値の偏差係数 | ○ |
| `ONSET_DELTA` | 0.02 | 閾値の絶対下駄 | ○ |
| `ONSET_REFRACTORY_SEC` | 0.06 | 同一帯域群の連続検出禁止時間 | |
| `ONSET_PEAK_RELEASE_SEC` | 2.0 | 強度正規化用ピークの減衰時定数 | |
| `ONSET_ENV_DECAY_SEC` | 0.15 | オンセット包絡の減衰時定数 | |
| `EVENT_LATENCY_FFT_FRACTION` | 0.316 | 拍位相の遅れ補正 = この値 × N / sr（秒）。2026-09-28 の検証（§11）で 0.45 と決定し、2026-10-01 に T16-03 の U16-06 実測（48kHz 符号付き平均誤差 m = −1.73ms）から §8 の校正式で 0.45 + (−1.73 − 4)/1000 × 48000/2048 = 0.316 に更新 | ○ |
| `TEMPO_BUFFER_SEC` | 8 | テンポ推定に使う ODF の長さ | |
| `TEMPO_MIN_FILL_SEC` | 4 | 推定を始める最小蓄積時間 | |
| `TEMPO_UPDATE_SEC` | 0.5 | 推定の実行間隔 | |
| `TEMPO_SEARCH_MIN_BPM` | 60 | 探索範囲の下限 | |
| `TEMPO_SEARCH_MAX_BPM` | 200 | 探索範囲の上限 | |
| `TEMPO_GRID_STEP_BPM` | 0.25 | テンポ候補の刻み | |
| `TEMPO_HARMONICS` | 4 | 自己相関の倍数加算の段数 | |
| `TEMPO_HALF_WEIGHT` | 0.5 | 半周期ラグの自己相関に掛ける重み（拍にならない周期の誤選択を防ぐ） | |
| `TEMPO_PRIOR_CENTER_BPM` | 120 | テンポ事前分布の中心 | |
| `TEMPO_PRIOR_SIGMA_OCT` | 0.9 | 事前分布の幅（オクターブ） | |
| `TEMPO_FOLD_MIN_BPM` | 80 | 出力 BPM の折り返し範囲下限（含む） | |
| `TEMPO_FOLD_MAX_BPM` | 160 | 出力 BPM の折り返し範囲上限（含まない） | |
| `TEMPO_MIN_CONF` | 0.1 | これ未満の推定は無視 | ○ |
| `TEMPO_SAME_TOL` | 0.02 | 「同じテンポ」とみなす相対差 | |
| `TEMPO_REFINE_WEIGHT` | 0.2 | 同じテンポの推定で現在値を更新する重み | |
| `TEMPO_LOCK_COUNT` | 2 | 初回確定に必要な一致回数 | |
| `TEMPO_SWITCH_COUNT` | 3 | テンポ変更に必要な一致回数 | |
| `PHASE_DISAMBIG_RATIO` | 1.5 | 初期位相の半拍ずれ判定の比 | |
| `PLL_WINDOW` | 0.2 | 位相補正を行う誤差範囲（拍単位） | |
| `PLL_GAIN` | 0.3 | 位相補正の強さ | ○ |
| `BEAT_MIN_INTERVAL_FRAC` | 0.5 | 拍イベントの最小間隔（拍周期に対する比） | |
| `BAR_BEATS` | 4 | 1小節の拍数（4/4 固定） | |
| `BAR_DECAY` | 0.9 | 小節頭推定の蓄積の減衰 | |
| `BAR_LOOKBACK_HOPS` | 3 | 拍イベント前に低域 ODF を見るホップ数 | |
| `BAR_ACCUM_HOPS` | 4 | 拍イベント後に低域 ODF を見るホップ数 | |
| `CHROMA_MIN_HZ` | 55 | クロマ計算の下限 | |
| `CHROMA_MAX_HZ` | 5000 | クロマ計算の上限 | |
| `ROLLOFF_FRACTION` | 0.85 | ロールオフの累積エネルギー比 | |
| `LOUD_MOMENTARY_SEC` | 0.4 | モーメンタリーラウドネスの窓 | |
| `LOUD_SHORT_SEC` | 3.0 | ショートタームラウドネスの窓 | |
| `LOUD_OFFSET` | -0.691 | BS.1770 のオフセット | |
| `KW_SHELF_F0` | 1681.974450955533 | K 特性 第1段（ハイシェルフ）中心周波数 | |
| `KW_SHELF_GAIN_DB` | 3.999843853973347 | 同 ゲイン | |
| `KW_SHELF_Q` | 0.7071752369554196 | 同 Q | |
| `KW_SHELF_VB_EXPONENT` | 0.4996667741545416 | 同 帯域ゲイン指数 | |
| `KW_HP_F0` | 38.13547087602444 | K 特性 第2段（ハイパス）カットオフ | |
| `KW_HP_Q` | 0.5003270373238773 | 同 Q | |
| `LEVEL_FLOOR_LUFS` | -60 | `level`（0..1）の下限 | |
| `AGC_TARGET_LUFS` | -14 | 自動補正の目標ラウドネス | ○ |
| `AGC_MIN_DB` | -6 | 補正量の下限 | |
| `AGC_MAX_DB` | 18 | 補正量の上限 | |
| `AGC_SILENCE_LUFS` | -60 | これ未満は無音とみなし補正量を保持 | |
| `AGC_TIME_SEC` | 2 | 補正量の追従時定数 | |
| `LIVE_RING_SIZE` | 32 | メインスレッドで保持するホップ数 | |
| `LIVE_WATCHDOG_SEC` | 2 | この時間ホップが届かなければフォールバック | |
| `EPS` | 1e-12 | ゼロ除算・log(0) 回避 | |

### 3.1 サンプルレートからの導出値（`mfsDerived(sampleRate)` が返す）

| 名前 | 式 |
|---|---|
| `fr` | `sampleRate / HOP_SIZE`（ホップレート。48kHz で 93.75、44.1kHz で 86.13） |
| `hopSec` | `HOP_SIZE / sampleRate` |
| `alpha(T)` | `1 - exp(-HOP_SIZE / (sampleRate * T))`（時定数 T 秒の1次平滑係数。関数として返す） |
| `frames(T)` | `max(1, round(T * fr))`（T 秒に相当するホップ数。関数として返す） |
| `eventLatencySec` | `EVENT_LATENCY_FFT_FRACTION * FFT_SIZE / sampleRate` |
| `binHz` | `sampleRate / FFT_SIZE` |
| `binOf(hz)` | `round(hz / binHz)` |

---

## 4. 特徴フレームのデータ配置（`MFS_LAYOUT`）

1ホップの特徴は長さ **104** の `Float32Array`（以下 packed）に格納する。ワークレットとメインスレッドは必ず `MFS_LAYOUT` の値でアクセスし、数値を直書きしない。

| キー | オフセット | 長さ | 値域 | 内容 |
|---|---|---|---|---|
| `BANDS` | 0 | 32 | 0..1 | メル帯域レベル（§5.3） |
| `BANDS_SMOOTH` | 32 | 32 | 0..1 | 同 平滑版 |
| `ONSET_ENV` | 64 | 4 | 0..1 | オンセット包絡 low/mid/high/full（§5.4） |
| `ONSET_FLAGS` | 68 | 1 | 0..15 | オンセット発生ビット（bit0=low … bit3=full） |
| `BPM` | 69 | 1 | 0 or 80..160 | 推定テンポ（未確定は 0） |
| `TEMPO_CONF` | 70 | 1 | 0..1 | テンポ信頼度 |
| `BEAT_PHASE` | 71 | 1 | 0..1 | 拍内位相（0 = 拍頭） |
| `BAR_PHASE` | 72 | 1 | 0..1 | 小節内位相 |
| `BEAT_IN_BAR` | 73 | 1 | 0..3 | 小節内の拍番号 |
| `BEAT_FLAG` | 74 | 1 | 0/1 | このホップで拍頭を通過 |
| `DOWNBEAT_FLAG` | 75 | 1 | 0/1 | このホップで小節頭を通過 |
| `TEMPO_LOCKED` | 76 | 1 | 0/1 | テンポ確定済み |
| `STEREO_CORR` | 77 | 1 | -1..1 | L/R 相関 |
| `STEREO_WIDTH` | 78 | 1 | 0..1 | 広がり（サイド比） |
| `STEREO_BALANCE` | 79 | 1 | -1..1 | 左右バランス（+ = 右） |
| `STEREO_PAN` | 80 | 3 | -1..1 | 帯域群 low/mid/high の定位 |
| `CENTROID` | 83 | 1 | 0..1 | スペクトル重心（対数正規化） |
| `FLATNESS` | 84 | 1 | 0..1 | スペクトル平坦度 |
| `ROLLOFF` | 85 | 1 | 0..1 | ロールオフ周波数（対数正規化） |
| `CHROMA` | 86 | 12 | 0..1 | クロマ（0 = C … 11 = B） |
| `LOUD_MOMENTARY` | 98 | 1 | LUFS | モーメンタリーラウドネス |
| `LOUD_SHORT` | 99 | 1 | LUFS | ショートタームラウドネス |
| `LEVEL` | 100 | 1 | 0..1 | `clamp((LOUD_MOMENTARY - LEVEL_FLOOR_LUFS) / -LEVEL_FLOOR_LUFS, 0, 1)` |
| `AGC_DB` | 101 | 1 | dB | 音量自動補正量（§5.8） |
| `RMS` | 102 | 1 | 0..1 | モノラル窓の RMS |
| `PEAK` | 103 | 1 | 0..1 | モノラル窓の最大絶対値 |
| （全長 `LENGTH`） | — | 104 | | |

`MFS_LAYOUT` は `{ BANDS: 0, BANDS_SMOOTH: 32, ..., PEAK: 103, LENGTH: 104 }` の形のオブジェクトとする（長さは上表で定義し、コードには持たない）。

---

## 5. アルゴリズム（`MfsExtractor`）

記法: `A[k]` は振幅スペクトル、`P[k] = A[k]²`、`clamp(x, a, b)`、`α(T)`・`frames(T)` は §3.1。無音（除数 < `EPS`）の場合の値は各節に明記した値にし、**NaN / Infinity を出力しない**。

### 5.0 クラスの API（担当者間の結合点。名前・引数を変えないこと）

| クラス / 関数 | API | 説明 |
|---|---|---|
| `mfsDerived(sampleRate)` | → `{ fr, hopSec, alpha(T), frames(T), eventLatencySec, binHz, binOf(hz) }` | §3.1 |
| `mfsWindowHann(n)` | → `Float32Array(n)` | §5.3 の Hann 窓 |
| `MfsFft` | `constructor(n)`、`transform(re, im)`（Float64Array を in-place で前方 FFT。1/N 正規化なし） | 基数2 |
| `MfsMelBank` | `constructor(sampleRate, fftSize)`、`apply(P, out)`（P: Float64Array(N/2) のパワー、out: Float32Array(32) に E_b を書く） | §5.3 |
| `MfsBiquad` | `static kWeighting(sampleRate)` → `[stage1, stage2]`、`constructor(b0, b1, b2, a1, a2)`、`process(x)` → y、`reset()` | §5.8 |
| `MfsOnset` | `constructor(sampleRate, fftSize)`、`process(A, tSec)` → フラグ（0..15）、`reset()`。公開: `flux`（Float32Array(4)）、`env`（Float32Array(4)）、`odf`、`odfLow` | §5.4 |
| `MfsTempo` | `constructor(sampleRate)`、`process(odf, odfLow, onsetFlags, envFull, tSec)`、`reset()`。公開: `bpm`、`conf`、`phase`、`barPhase`、`beatInBar`、`beatFlag`、`downbeatFlag`、`locked` | §5.5 |
| `MfsExtractor` | `constructor(sampleRate, { smoothing })`、`pushSamples(L, R, count)`（R が null なら L を使う）、`setSmoothing(v)`、`reset()`、`onHop`（コールバック。`(extractor) => void`、ホップ完了ごとに同期呼び出し） | §5.1〜§5.9 |
| `MfsExtractor` の公開フィールド | `hopIndex`（完了ホップ番号 h）、`hopEndSample`（(h+1)·H）、`packed`（Float32Array(104)）、`freqBytes`（Uint8Array(1024)）、`timeBytes`（Uint8Array(2048)）、`flux`、`hopEnergy` | `onHop` 内でのみ有効。次のホップで上書きされる |

### 5.1 ホップ分割（入力の扱い）

- 入力は L/R の2チャンネル。1チャンネルしか来ない場合は R = L とする
- 内部に長さ N のリングバッファを L・R それぞれに持つ（初期値 0）
- 入力サンプルを1つずつ積み、累計サンプル数が `(h+1)·H` に達した時点を**ホップ h の完了**とする（h は 0 始まり）
- ホップ完了時、直近 N サンプルを時系列順に `chronoL`、`chronoR` へコピーし、`mono[n] = 0.5·(chronoL[n] + chronoR[n])` を作って §5.2〜§5.8 を**この順で**計算する
- ホップ h の時刻 `tSec = (h+1)·H / sampleRate`（ライブではコンテキスト時刻に換算。§6.2）

### 5.2 従来互換 byte スペクトル・時間波形

```
tauHop = smoothing ^ (H * LEGACY_REF_FPS / sampleRate)     // smoothing=0 のとき 0
spectrumAnalyzer = new SpectrumAnalyzer(N, tauHop, LEGACY_MIN_DB, LEGACY_MAX_DB)  // js/fft.js
spectrumAnalyzer.analyze(mono, freqBytes)           // Uint8Array(N/2)
SpectrumAnalyzer.timeDomainToBytes(mono, timeBytes) // Uint8Array(N)
```

- `tauHop` は「60fps でフレームごとに平滑化していた従来のライブ表示」と同じ1秒あたりの減衰になる値。`setSmoothing(v)` で再計算する（`SpectrumAnalyzer.smoothing` を書き換える）
- モノラル化は `AnalyserNode` の speakers ダウンミックス（0.5·(L+R)）と同じ

### 5.3 特徴用 FFT とメル帯域

```
w[n] = 0.5 - 0.5*cos(2πn/N)                       // Hann。Σw = N/2
XL = FFT(chronoL · w), XR = FFT(chronoR · w)       // 複素、k = 0..N/2-1
scale = 2 / (N/2)                                  // 振幅1の正弦波 → A ≈ 1
AL[k] = |XL[k]|·scale, AR[k] = |XR[k]|·scale
A[k]  = |XL[k] + XR[k]|·scale / 2                  // モノラル振幅
P[k]  = A[k]², PL[k] = AL[k]², PR[k] = AR[k]²
fk    = k · sampleRate / N
```

メルフィルタバンク（`MfsMelBank`、構築時に1回計算）:

```
mel(f) = 2595·log10(1 + f/700),  inv(m) = 700·(10^(m/2595) - 1)
m_i = mel(FREQ_MIN_HZ) + i·(mel(FREQ_MAX_HZ) - mel(FREQ_MIN_HZ))/(B+1),  i = 0..B+1
帯域 b（0..B-1）の三角フィルタ: 下端 inv(m_b)、中心 inv(m_{b+1})、上端 inv(m_{b+2})
weight_b[k] = 上り辺 (fk - 下端)/(中心 - 下端)、下り辺 (上端 - fk)/(上端 - 中心)、範囲外 0
E_b = Σ_k weight_b[k]·P[k] / Σ_k weight_b[k]
      （Σ weight_b = 0 の帯域は E_b = P[binOf(中心)]）
bands[b]       = clamp((10·log10(E_b + EPS) - BAND_DB_FLOOR) / (BAND_DB_CEIL - BAND_DB_FLOOR), 0, 1)
bandsSmooth[b] += (bands[b] > bandsSmooth[b] ? α(BAND_ATTACK_SEC) : α(BAND_RELEASE_SEC))·(bands[b] - bandsSmooth[b])
```

### 5.4 オンセット（`MfsOnset`）

```
C[k] = log(1 + ONSET_LOG_GAMMA·A[k])              // 前ホップの C を保持（初回は 0）
帯域群 g（0..3）のビン集合 G_g = { k : ONSET_GROUPS[g][0] ≤ fk < ONSET_GROUPS[g][1] }
F_g = (1/|G_g|)·Σ_{k∈G_g} max(0, C[k] - Cprev[k])  // スペクトラルフラックス

// 閾値（更新前の μ, d で判定する）
thr_g = μ_g + ONSET_K·d_g + ONSET_DELTA
above = F_g > thr_g
onset_g = above && !prevAbove_g && (tSec - lastOnset_g ≥ ONSET_REFRACTORY_SEC)
if onset_g: lastOnset_g = tSec, ONSET_FLAGS |= (1 << g)
prevAbove_g = above

// 統計更新（μold = 更新前の μ_g を先に保存しておく）
μ_g += α(ONSET_STAT_SEC)·(F_g - μ_g)
d_g += α(ONSET_STAT_SEC)·(|F_g - μ_g| - d_g)     // d は更新後の μ を使う

// 強度と包絡（μold を使う）
peak_g = max(F_g - μold, peak_g·exp(-hopSec/ONSET_PEAK_RELEASE_SEC))
s_g    = peak_g > EPS ? clamp((F_g - μold)/peak_g, 0, 1) : 0
env_g  = max(s_g, env_g·exp(-hopSec/ONSET_ENV_DECAY_SEC))   → ONSET_ENV[g]
```

- 初期値: `μ_g = d_g = peak_g = env_g = 0`、`prevAbove_g = false`、`lastOnset_g = -Infinity`、前ホップの `C` は全 0。§5.9 の `reset()` でもこの値に戻す
- テンポ推定へ渡す値: `odf = max(0, F_3 - μ_3)`、`odfLow = max(0, F_0 - μ_0)`（**μ は更新前の値**）
- `MfsExtractor` は最新ホップの `F_g`（4要素）を公開フィールド `flux`（Float32Array(4)）に保持する（Phase 18 のソングマップ解析が使う）

### 5.5 テンポ・拍位相・小節（`MfsTempo`）

#### 5.5.1 テンポ推定（`TEMPO_UPDATE_SEC` ごと）

```
x  = 直近 frames(TEMPO_BUFFER_SEC) ホップの odf（リング。蓄積 < frames(TEMPO_MIN_FILL_SEC) なら推定しない）
xL = 同じ期間の odfLow（5.5.3 で使用）
L  = x の長さ（蓄積済みの数）
x̃  = x - mean(x)
ri[τ] = Σ_{t=τ}^{L-1} x̃[t]·x̃[t-τ] / (L - τ)      （整数 τ = 0..L-1）
r(τ)  = 実数 τ の線形補間: a = floor(τ), f = τ - a, r = ri[a]·(1-f) + ri[a+1]·f   （τ ≥ L-1 なら 0）
候補 b_k = TEMPO_SEARCH_MIN_BPM + k·TEMPO_GRID_STEP_BPM（k = 0, 1, …, b_k ≤ TEMPO_SEARCH_MAX_BPM。浮動小数の累積加算ではなく乗算で求める）
  τ(b) = 60·fr / b
  S(b) = Σ_{j=1}^{TEMPO_HARMONICS} r(j·τ)/j + TEMPO_HALF_WEIGHT·r(τ/2)
  W(b) = exp(-0.5·(log2(b / TEMPO_PRIOR_CENTER_BPM) / TEMPO_PRIOR_SIGMA_OCT)²)
b* = argmax W(b)·S(b)            （同値は小さい b を採用）
conf = ri[0] > EPS ? clamp(r(τ(b*)) / ri[0], 0, 1) : 0
c = fold(b*):  while c < TEMPO_FOLD_MIN_BPM: c *= 2;  while c ≥ TEMPO_FOLD_MAX_BPM: c /= 2
```

- `TEMPO_HALF_WEIGHT` の項は、8分音符のハイハット等で「2.5拍」のような拍にならない周期が選ばれる誤りを防ぐ（検証で必要と判明。§11）

#### 5.5.2 テンポの確定・更新（ヒステリシス）

```
if conf < TEMPO_MIN_CONF: 何もしない（確定・更新処理を行わない。公開値 conf は推定した値に更新する。2026-10-01 T16-03 で明記）
same(a, b) = |a - b|/b ≤ TEMPO_SAME_TOL
pending = 0 は「保留中の候補なし」を表し、same(c, 0) は常に偽とする。初期値 bpm = 0, pending = 0, pendingCount = 0
if bpm == 0:
    pending と c が same なら pendingCount++、そうでなければ pending = c, pendingCount = 1
    if pendingCount ≥ TEMPO_LOCK_COUNT: bpm = c; locked = 1; 初期位相を設定（5.5.3）; 小節蓄積をリセット; pending = 0
elif same(c, bpm):
    bpm = (1 - TEMPO_REFINE_WEIGHT)·bpm + TEMPO_REFINE_WEIGHT·c;  pending = 0, pendingCount = 0
else:
    pending の更新は bpm == 0 の場合と同じ
    if pendingCount ≥ TEMPO_SWITCH_COUNT: bpm = c; 初期位相を設定; 小節蓄積をリセット; pending = 0
tempoConf = conf（推定を実行したときだけ更新）
```

#### 5.5.3 初期位相（くし形の当てはめ）

```
τ = 60·fr / bpm（実数）
for o in 0..floor(τ)-1:
    s(o) = Σ_{n=0,1,...} x[L-1-round(o + n·τ)]  （添字 ≥ 0 の範囲のみ）
o* = argmax s(o)（同値は小さい o）
半拍ずれの判定: sL(o) を xL について s(o) と同じ式で計算し、
  o½ = (o* + τ/2) mod τ（実数のまま使い、添字計算の round で整数化）
  sL(o½) > PHASE_DISAMBIG_RATIO·sL(o*) なら o* = o½
phase = ((o*·hopSec + eventLatencySec)·bpm/60) mod 1
beatCount = 0
```

#### 5.5.4 位相の進行と補正（毎ホップ、`locked` のときのみ）

```
phase += hopSec·bpm/60
if phase ≥ 1: phase -= 1; 拍イベントを発行（下記）
if このホップで full のオンセット（ONSET_FLAGS bit3）が立った:
    φo = phase - eventLatencySec·bpm/60           // オンセットが実際に起きた時点の位相
    e  = φo - round(φo)                           // -0.5..0.5（拍頭からのずれ）
    if |e| ≤ PLL_WINDOW:
        phase -= PLL_GAIN·ONSET_ENV[full]·e
        if phase ≥ 1: phase -= 1; 拍イベントを発行
        if phase < 0: phase += 1                  // 直前に発行済みのため再発行しない

拍イベントの発行:
    if tSec - lastBeatSec < BEAT_MIN_INTERVAL_FRAC·60/bpm: 発行しない（位相の巻き戻しのみ）
    BEAT_FLAG = 1; lastBeatSec = tSec; beatCount++
    小節（5.5.5）を更新
```

#### 5.5.5 小節頭の推定（4/4 固定）

```
acc[0..3] = 0（ロック時・テンポ切替時にリセット）
拍イベント時: slot = (beatCount - 1) mod 4 を記録し、v = 直近 BAR_LOOKBACK_HOPS ホップ（発行したホップを含む）の odfLow の最大値
発行したホップを1ホップ目として BAR_ACCUM_HOPS ホップ目まで（発行ホップと続く3ホップ）、各ホップの odfLow で v = max(v, odfLow) を更新
BAR_ACCUM_HOPS ホップ目の処理の最後に: acc[slot] = BAR_DECAY·acc[slot] + v     （減衰は加算するスロットだけに掛ける）
barStart = argmax acc（同値は小さい添字）
拍イベント時の beatInBar = ((beatCount - 1) - barStart) mod 4（0..3。barStart はその時点の値）
beatInBar == 0 の拍イベントで DOWNBEAT_FLAG = 1
BAR_PHASE = (beatInBar + phase) / 4
```

- 小節頭の手がかりは「低域の打撃（キック）が最も強い拍」。すべての拍に同じ強さのキックがある曲では小節頭は決まらない（ランダムに近い）。曲全体を使う正確な推定は Phase 18 のソングマップで行う

`locked = 0` の間は `BPM = 0`、`BEAT_PHASE = BAR_PHASE = BEAT_IN_BAR = 0`、フラグは立てない。

### 5.6 ステレオ

```
EL = Σ chronoL²,  ER = Σ chronoR²,  ELR = Σ chronoL·chronoR
EM = Σ ((L+R)/2)²,  ES = Σ ((L-R)/2)²
STEREO_CORR    = EL·ER > EPS ? ELR / sqrt(EL·ER) : 0
STEREO_WIDTH   = EM + ES > EPS ? ES / (EM + ES) : 0
STEREO_BALANCE = EL + ER > EPS ? (ER - EL)/(ER + EL) : 0
STEREO_PAN[g]  = (ΣPR - ΣPL)/(ΣPR + ΣPL)  （g = low/mid/high、ビン集合は §5.4 の G_g、分母 ≤ EPS なら 0）
```

### 5.7 音色・クロマ

```
K = { k : FREQ_MIN_HZ ≤ fk ≤ FREQ_MAX_HZ },  Ptot = Σ_{k∈K} P[k]
lognorm(f) = clamp(log(f/FREQ_MIN_HZ) / log(FREQ_MAX_HZ/FREQ_MIN_HZ), 0, 1)
Ptot ≤ EPS のとき CENTROID = FLATNESS = ROLLOFF = 0
CENTROID = lognorm( Σ fk·P[k] / Ptot )
FLATNESS = exp( mean_{k∈K} ln(P[k] + EPS) ) / (mean_{k∈K} P[k] + EPS)
ROLLOFF  = lognorm( 累積 Σ P が ROLLOFF_FRACTION·Ptot 以上になる最小の fk )

クロマ: CHROMA_MIN_HZ ≤ fk ≤ CHROMA_MAX_HZ の各ビンのうち、スペクトルの山の頂点（A[k] > A[k−1] かつ A[k] ≥ A[k+1]）だけについて
  pc = ((round(12·log2(fk/440) + 69) mod 12) + 12) mod 12
  chroma[pc] += A[k]
  （2026-10-01 変更: 全ビンを足すと 48kHz ではビン幅 ≈ 半音のため窓の主ローブが隣の音名へ漏れ、U16-11 が不合格になるため。T16-04 で判明）
max(chroma) > EPS なら chroma /= max(chroma)、そうでなければ全 0
RMS  = sqrt(mean(mono²)),  PEAK = max|mono|
```

### 5.8 ラウドネス・音量自動補正

K 特性フィルタ（`MfsBiquad`、L・R 独立の状態を持つ。**全サンプルに対して**適用し、ホップ内の H サンプル分だけ二乗和を取る）。係数は libebur128 と同じ導出式で、48kHz で ITU-R BS.1770 の公式係数と一致する（§11 で確認済み）:

```
第1段 ハイシェルフ（f0 = KW_SHELF_F0, G = KW_SHELF_GAIN_DB, Q = KW_SHELF_Q）
  K  = tan(π·f0/sampleRate),  Vh = 10^(G/20),  Vb = Vh^KW_SHELF_VB_EXPONENT
  a0 = 1 + K/Q + K²
  b0 = (Vh + Vb·K/Q + K²)/a0,  b1 = 2(K² - Vh)/a0,  b2 = (Vh - Vb·K/Q + K²)/a0
  a1 = 2(K² - 1)/a0,           a2 = (1 - K/Q + K²)/a0
第2段 ハイパス（f0 = KW_HP_F0, Q = KW_HP_Q）
  K  = tan(π·f0/sampleRate),  a0 = 1 + K/Q + K²
  b0 = 1, b1 = -2, b2 = 1,  a1 = 2(K² - 1)/a0,  a2 = (1 - K/Q + K²)/a0
演算は転置直接形 II:
  y = b0·x + z1;  z1 = b1·x - a1·y + z2;  z2 = b2·x - a2·y     （状態は JS の number = 倍精度）
```

```
z_hop = (Σ_{ホップ内} yL² + Σ_{ホップ内} yR²) / H          // チャンネルの平均二乗の和（BS.1770）
LOUD_MOMENTARY = LOUD_OFFSET + 10·log10(mean(直近 frames(LOUD_MOMENTARY_SEC) 個の z_hop) + EPS)
LOUD_SHORT     = LOUD_OFFSET + 10·log10(mean(直近 frames(LOUD_SHORT_SEC) 個の z_hop) + EPS)
               （蓄積が足りない間は蓄積済みの分だけで平均）
LEVEL = clamp((LOUD_MOMENTARY - LEVEL_FLOOR_LUFS) / (-LEVEL_FLOOR_LUFS), 0, 1)

音量自動補正量（ワークレット内で毎ホップ更新）:
  if LOUD_SHORT ≥ AGC_SILENCE_LUFS:
      target = clamp(AGC_TARGET_LUFS - LOUD_SHORT, AGC_MIN_DB, AGC_MAX_DB)
      agcDb += α(AGC_TIME_SEC)·(target - agcDb)
  AGC_DB = agcDb（初期値 0）
```

- `MfsExtractor` は最新ホップの `z_hop` を公開フィールド `hopEnergy` に保持する（Phase 18 が使う）
- モノラル音源（L = R）では、両チャンネル合算のため単チャンネル計測より +3.01 dB 高く出る。仕様として受け入れる（どの入力でも同じ規則で動くことを優先）

補正の適用（メインスレッド、`FramePipeline` 内。`settings.autoGain === true` かつ `features` がある場合のみ）:

```js
function applyAutoGain(freqIn, agcDb, out) {   // js/mfs-view.js
  const add = Math.round(agcDb * 255 / (MFS_CONST.LEGACY_MAX_DB - MFS_CONST.LEGACY_MIN_DB));
  for (let i = 0; i < freqIn.length; i++) out[i] = Math.min(255, Math.max(0, freqIn[i] + add));
  return out;
}
```

### 5.9 1ホップの処理手順（この順序を厳守）

```
ホップ h 完了時（tSec = (h+1)·H/sampleRate）:
 1. chronoL/chronoR/mono を作る（§5.1）
 2. 従来互換 byte（§5.2）→ freqBytes, timeBytes
 3. FFT・A/AL/AR/P（§5.3）→ BANDS, BANDS_SMOOTH
 4. オンセット（§5.4）→ ONSET_ENV, ONSET_FLAGS（このホップ分のみ）, flux, odf, odfLow
 5. テンポ（MfsTempo.process）:
    a. odf・odfLow をリングへ格納（格納してから推定する）
    b. sinceUpdate += 1。sinceUpdate ≥ frames(TEMPO_UPDATE_SEC) かつ 蓄積 ≥ frames(TEMPO_MIN_FILL_SEC) なら
       推定（§5.5.1）→ 確定・更新（§5.5.2）を行い sinceUpdate = 0
    c. locked なら（このホップでロックした場合も含む）位相の進行と補正（§5.5.4）、小節（§5.5.5）
    d. BPM・TEMPO_CONF・BEAT_PHASE・BAR_PHASE・BEAT_IN_BAR・BEAT_FLAG・DOWNBEAT_FLAG・TEMPO_LOCKED を書く
       （BEAT_FLAG・DOWNBEAT_FLAG はこのホップで発行した場合のみ 1）
 6. ステレオ（§5.6）、音色・クロマ・RMS・PEAK（§5.7）
 7. K 特性の二乗和はサンプル投入時に逐次計算済み。z_hop を確定し、ラウドネス・AGC（§5.8）
 8. hopEnergy = z_hop、onHop(this) を呼ぶ
```

初期値（`reset()` 後も同じ）: テンポ系 `bpm = 0, locked = 0, phase = 0, pending = 0, pendingCount = 0, sinceUpdate = 0, lastBeatSec = -Infinity, beatCount = 0, acc = [0,0,0,0], barStart = 0`、平滑系 `bandsSmooth = 0, agcDb = 0`、K 特性フィルタ状態 0、ラウドネス履歴は空、リングバッファは 0、`hopIndex = -1`（最初の完了で 0）。

---

## 6. AudioWorklet と各経路

### 6.1 プロセッサ `MfsProcessor`（`mfs-worklet.js` 内のソース文字列）

`processorOptions`:

| キー | ライブ | オフライン |
|---|---|---|
| `mode` | `'live'` | `'offline'` |
| `smoothing` | 現在の設定値 | 書き出し時の設定値 |
| `fps` | — | 出力フレームレート |
| `totalSamples` | — | 音声の総サンプル数 |

`process(inputs)`: `inputs[0]` の各サンプルを `MfsExtractor` に渡す（`totalSamples` 以降のサンプルは渡さない）。`true` を返す。

**メインスレッド → ワークレット**:

| メッセージ | 動作 |
|---|---|
| `{ type: 'reset' }` | `MfsExtractor` の全状態（リング、平滑化、統計、テンポ、フィルタ状態、ラウドネス履歴、AGC）を初期化。ホップ番号も 0 に戻す |
| `{ type: 'smoothing', value }` | §5.2 の `tauHop` を再計算 |

**ワークレット → メインスレッド**:

| モード | 送信タイミング | メッセージ |
|---|---|---|
| live | ホップ完了ごと | `{ type: 'hop', hop, t, f, freq, time }`。`t` は §6.2、`f` は packed（Float32Array(104)）、`freq` は Uint8Array(1024)、`time` は Uint8Array(2048)。3配列は `transfer` で渡す（ホップごとの生成を許可。ガイド §9.3 の例外） |
| offline | 出力フレームが確定するごと（§6.3） | `{ type: 'frame', index, hop, t, f, freq, time }` |
| offline | 全フレーム送信後 | `{ type: 'done' }` |

### 6.2 ライブ経路（`js/audio-engine.js` の変更）

グラフ:

```
source → analyser → destination                       （既存のまま）
source → mfsNode → silentGain(gain = 0) → destination （新規。出力を接続して確実に処理させる）
mfsNode = new AudioWorkletNode(ctx, 'mfs', {
  numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
  channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
  processorOptions: { mode: 'live', smoothing } })
```

ホップ時刻 `t`（ワークレット内）: そのホップを完了させたサンプルが、`process()` 呼び出し時のブロック先頭から j 番目（0 始まり）なら `t = (currentFrame + j + 1) / sampleRate`（コンテキスト時刻）。

初期化と状態:

| 状態 `mfsStatus` | 条件 | 解析元 |
|---|---|---|
| `'initializing'` | `_ensureContext()` で `addModule` を開始してから完了まで | AnalyserNode |
| `'active'` | ノード生成成功 | MFS |
| `'fallback'` | `addModule` / ノード生成が例外、`window.__avzForceMfsFailure === true`、または `'active'` で音源接続済みかつコンテキスト `running` なのに `LIVE_WATCHDOG_SEC` 秒ホップが届かない | AnalyserNode（以後このページでは戻らない） |

- フォールバックへ切り替えるときは `console.warn` で理由を出す（`console.error` は使わない。自動テストがエラーとして検出するため）
- `connectMedia` / `connectStream`: 旧 source を analyser と mfsNode の両方から切断し、新 source を両方へ接続して `resetAnalysis()` を呼ぶ。`'initializing'` 中に接続された source は、`'active'` になった時点で mfsNode へ接続する

リングと選択（`captureFrame(nowPerfMs)`。`VisualizerCore` が `performance.now()` を渡す）:

```
ring: 直近 LIVE_RING_SIZE 件の hop メッセージ（古いものから上書き）
ts = ctx.getOutputTimestamp()
target = (ts && ts.contextTime > 0 && ts.performanceTime > 0)
         ? ts.contextTime + (nowPerfMs - ts.performanceTime)/1000
         : ctx.currentTime - (ctx.baseLatency || 0) - (ctx.outputLatency || 0)
selected = ring 内で t ≤ target を満たす最新の件（無ければ前回の選択を維持。初回なら null）
MfsFrameView へ selected.packed をコピー（setPacked）してから、フラグをビュー側で集約する:
  対象 = hop が「前回描画時に選択した hop（リセット直後は -1）」より大きく selected.hop 以下のリング内の全件
  ONSET_FLAGS = 対象全件のビット OR、BEAT_FLAG・DOWNBEAT_FLAG = 対象全件の OR
  対象が空（前回と同じ件を使う場合を含む）ならフラグはすべて 0
  リング内の packed は書き換えない
前回描画時に選択した hop = selected.hop に更新
```

- この選択により「今スピーカーから出ている音」を解析した結果で描画する（出力遅延の補正）
- `getFreqSlice()` / `getTimeDomainData()` は `'active'` なら選択した件の `freq`（`computeFreqRange` のスライス）/ `time`。`'active'` でまだ1件も選択していない場合は、全 0 のスライス / 全 128 の波形（どちらも事前確保した配列）。`'active'` 以外は従来どおり AnalyserNode
- `getMfsDebugInfo()` → `{ status, lastHop, hopsPerSec }`（`lastHop` は最後に受信した hop 番号、`hopsPerSec` は直近1秒の受信数。デバッグ表示とテストが使う）
- `getFeatures()` は `'active'` かつ選択済みなら `MfsFrameView`、それ以外は `null`
- `resetAnalysis()`: ワークレットへ `reset` を送り、リングと前回選択 hop をクリア
- `setSmoothing(v)`: AnalyserNode と、ワークレットへの `smoothing` メッセージの両方

`resetAnalysis()` を呼ぶ箇所（`js/ui-controller.js`）: シークバーの `input` ハンドラ、停止ボタンのハンドラ（`this.mediaManager.stop()` の直後。`currentTime = 0` は `MediaManager.stop()` 内で行われる）、`_applyActiveSlot()`、`_loadMediaFile()` の読込完了後。`connectMedia` / `connectStream` 内でも呼ぶ（上記）。

### 6.3 オフライン経路（`js/offline-exporter.js` の変更）

- `_captureFramesWorklet` を MFS プロセッサ（`mode: 'offline'`）に置き換える。ScriptProcessorNode 経路（`_captureFramesScriptProcessor`）はフォールバックとして残し、その場合 `features` は `null`
- `OfflineAudioContext` は現行どおり元音声のチャンネル数で作り、MFS ノードは §6.2 と同じチャンネル指定にする

出力フレームの確定規則（ワークレット内）:

```
出力フレーム i の時刻（サンプル）s_i = i·sampleRate/fps（実数）。i = 0, 1, … s_i ≤ totalSamples + 1 の間（デコード時のリサンプリングで長さが 1 サンプル短くなる場合に最終フレームを失わないため。2026-10-03 T16-09 で変更）
フレーム i のデータ = ホップ終端 (h+1)·H ≤ s_i を満たす最大の h のホップ
  そのようなホップが無い（s_i < H）: packed 全 0、freq 全 0、time 全 128、hop = -1
確定のタイミング: 終端が s_i を超えるホップが完了した時点で、直前のホップの内容でフレーム i を送る
  入力の終わり（totalSamples 到達）で、s_i ≤ totalSamples + 1 を満たす未送信のフレームを最後のホップの内容で全て送り、'done' を送る
フラグの集約: フレーム i のフラグ = フレーム i-1 のホップより後、フレーム i のホップ以前の全ホップの OR
  （同じホップを指す場合はフラグ 0）
'frame' メッセージの t = s_i / sampleRate（出力フレームの時刻 [秒]。OfflineExporter は frameTimesMs を自前で計算するため参照しない。2026-10-01 T16-05 で明記）
```

- ライブと同じ意味論（「その時刻までに完了した最新ホップ」＋「前回描画以降のイベントの OR」）
- `OfflineExporter` は受信した `frame` を `index` 順に `freqFrames`（`computeFreqRange` スライス）、`timeFrames`、`frameTimesMs`（= `i·1000/fps`）、`featureFrames`（packed）へ格納する

### 6.4 メインスレッドのビュー（`MfsFrameView`、`js/mfs-view.js`）

レンダラーや演出が読むための読み取り専用ビュー。**構築時に1回だけ** subarray とネストしたオブジェクトを作り、以降は `setPacked(f)` で内部の `Float32Array(104)` の中身をコピーして差し替える（毎フレームの生成なし）。

```js
view.raw                 // Float32Array(104)
view.bands               // Float32Array(32)（raw.subarray）
view.bandsSmooth         // Float32Array(32)
view.onset.env           // Float32Array(4)  low/mid/high/full
view.onset.flags         // number（getter）
view.tempo.bpm / .confidence / .beatPhase / .barPhase / .beatInBar / .beatFlag / .downbeatFlag / .locked  // getter
view.stereo.correlation / .width / .balance / .pan(Float32Array(3))
view.timbre.centroid / .flatness / .rolloff
view.chroma              // Float32Array(12)
view.loudness.momentary / .shortTerm / .level / .agcDb
view.rms / view.peak
```

`beatFlag`・`downbeatFlag`・`locked` は boolean（`raw` の値 ≥ 0.5）を返す。

### 6.5 レイヤー分割（`computeLayerRange`、`js/mfs-view.js`）

```js
// out: 長さ2の Int32Array（呼び出し側が1回だけ確保）。[start, end)（freq スライス内の添字）を書き込んで out を返す
function computeLayerRange(i, count, sliceLen, sampleRate, fftSize, mode, out) -> out
// startBin は内部で computeFreqRange(sampleRate, fftSize / 2).startBin から求める
```

- `mode` が `'mel'` 以外（`undefined` を含む）: 現行と同じ `[floor(i·sliceLen/count), floor((i+1)·sliceLen/count))`
- `mode === 'mel'`: `mel(FREQ_MIN_HZ)`〜`mel(FREQ_MAX_HZ)` を count 等分した境界周波数 f をビン番号 `round(f·fftSize/sampleRate) - startBin` に変換し、`[0, sliceLen]` にクランプ。各レイヤーは最低1ビンを持つ（`end ≤ start` なら `end = start + 1`、以降の開始を繰り下げる）。最終レイヤーの `end` は常に `sliceLen` とする（`FREQ_MAX_HZ` の丸めで末尾ビンが欠けないため。2026-10-01 T16-06 で追記）
- `FramePipeline` の既定 `getLayer` をこの関数で置き換える（`input.sampleRate`・`input.fftSize` を追加。ライブは `ctx.sampleRate` と 2048、オフラインは音声のサンプルレートと 2048）
- **T16-08 以降、ライブ（`VisualizerCore`）もオフラインも `input.getLayer` を渡さない**（`null`）。レイヤーは常に `FramePipeline` 内で、音量自動補正後の `freq` から `computeLayerRange` で切り出す（`AudioEngine.getLayerData` は使わなくなるが、互換のため残す）

### 6.6 `FramePipeline` とレンダラー契約の変更

- `input` に `features`（`MfsFrameView | null`）、`sampleRate`、`fftSize` を追加
- `render` の手順 4a/4b の前に: `settings.autoGain && input.features` なら `applyAutoGain(input.freq, features.loudness.agcDb, 内部バッファ)` を `freq` として使う（レイヤー切り出しも補正後の値から）
- 実際に描画へ使った freq（補正後）を読み取り専用プロパティ `FramePipeline.lastFreq` で参照できるようにする（テスト・デバッグ用）
- ステートフルレンダラーへ渡す `frame` に `features` を追加（`null` あり）。`frame.beat`（従来の `BeatDetector`）は**変更しない**（既存レンダラーの見た目を保つため）
- `doc/renderer-contract.md` の frame 表に `frame.features` 行を追加し、「null の場合を必ずガードする」を必須ルールに追記

---

## 7. 設定と UI

| 設定キー | 型 | 既定 | UI | 表示位置 |
|---|---|---|---|---|
| `autoGain` | boolean | `false` | チェックボックス「音量自動補正」 | 「感度・形状」セクションの先頭 |
| `layerSplit` | `'linear'` \| `'mel'` | `'linear'` | セレクト「レイヤー分割」（均等 / 聴感） | レイヤー設定内。選択タイプが `layers` 対応かつ `layerCount ≥ 2` のときだけ表示 |

- `js/settings.js` の `DEFAULT_SETTINGS` に追加するだけで、プリセット・JSON 入出力（`settings-io.js`）は既存の仕組みで対応される（旧 JSON は既定値で補完）
- `_syncControlsFromSettings()` に同期処理を追加
- `ui-controller.js` の各ランダムボタンはこの2項目を変更しない

デバッグ表示（`?debug=1`）に追加する項目: `MFS: active|fallback|initializing`、`BPM <値> (<信頼度>) locked|—`、拍位相のテキストバー（例 `beat [###.....] 2/4`）、`LUFS M <値> S <値> AGC <値>dB`、オンセットランプ（`L M H` が発生から 150ms 点灯）、受信ホップ数/秒。

---

## 8. チケット一覧

| ID | タイトル | 難易度 | 前提 | 成果物 | 受け入れテスト | spec 更新 |
|---|---|---|---|---|---|---|
| T16-01 | 定数・データ配置・DSP 部品 | ★2 | Phase 15 | `mfs-const.js`、`mfs-dsp.js` | U16-01〜U16-03 | 不要 |
| T16-02 | オンセット検出 | ★2 | T16-01 | `mfs-onset.js` | U16-04 | 不要 |
| T16-03 | テンポ・拍位相・小節 | ★3 | T16-02 | `mfs-tempo.js` | U16-05〜U16-08 | 不要 |
| T16-04 | 統合抽出器（ステレオ・音色・クロマ・ラウドネス含む）と校正の確認 | ★2 | T16-01, T16-02（T16-03 はスタブで先行可） | `mfs-extractor.js`、校正結果の記録（§3 の「校正」列の見直し PR） | U16-09〜U16-17 | 不要 |
| T16-05 | ワークレット | ★3 | T16-04 | `mfs-worklet.js`、テスト合成信号を使うブラウザテスト | B16-01、B16-08 | 不要 |
| T16-06 | メインスレッドのビューとレイヤー分割 | ★1 | T16-01 | `mfs-view.js`（`MfsFrameView`、`applyAutoGain`、`computeLayerRange`） | U16-18〜U16-20 | 不要 |
| T16-07 | ライブ経路の統合 | ★3 | T16-05, T16-06 | `audio-engine.js`、`visualizer-core.js`、`ui-controller.js`（`resetAnalysis` 呼び出し）、`index.html` | B16-02〜B16-04 | 要（§1.1） |
| T16-08 | FramePipeline・レンダラー契約 v2 | ★1 | T16-06 | `frame-pipeline.js`、`doc/renderer-contract.md` | B16-05、B15-04（ゴールデン不変） | 不要 |
| T16-09 | オフライン経路の統合 | ★2 | T16-05, T16-08 | `offline-exporter.js` | B16-06、B15-02 | 要（§1.1） |
| T16-10 | 設定・UI（音量自動補正・レイヤー分割） | ★1 | T16-07, T16-08 | `settings.js`、`ui-controller.js`、`index.html` | B16-07、B16-09 | 要 |
| T16-11 | デバッグ表示の MFS 項目 | ★1 | T16-07 | `debug-overlay.js`、`visualizer-core.js` | B16-10 | 不要 |

- T16-01・T16-06 は並行可。T16-07 と T16-10 は同じファイル（`ui-controller.js`・`index.html`）を編集するため、T16-10 は T16-07 のマージ後に着手する。T16-03 と T16-04 は、T16-04 側でテンポ部分を `MfsTempo` の空実装（常に `locked = 0`）で先行実装し、T16-03 のマージ後に結合してよい
- T16-04 の「校正の確認」: U16-06 の実測で拍イベントの**平均誤差（符号付き）**が 0〜+8ms（ホップ境界で発行するため +hopSec/2 程度の遅れは正常）から外れる場合、`EVENT_LATENCY_FFT_FRACTION` を `現在値 + (m − 4) / 1000 × 48000 / 2048`（m = 48kHz での符号付き平均誤差 [ms]）に更新する本書の修正 PR を先に出す。他の校正対象の定数も、受け入れテスト不合格の原因がその定数にあると示せる場合に限り同じ手続きで変更できる

---

## 9. 受け入れテスト

合成信号は `tests/shared/signals.js`（Phase 15 §3.5）。特記なき限り 48kHz・ステレオ。Node 単体テストは `MfsExtractor` を直接駆動する（128 サンプルずつ `pushSamples` し、ホップごとのコールバックで packed を記録）。

### 9.1 Node 単体

| ID | 内容 | 合格基準 |
|---|---|---|
| U16-01 | `MfsFft`（N=64・2048、シード固定乱数入力）を素朴な DFT と比較 | 全ビンで相対誤差 ≤ 1e-4（振幅 > 1e-3 のビン） |
| U16-02 | `MfsMelBank`（48kHz・44.1kHz） | 帯域数 32、中心周波数が単調増加、最低帯域の下端 = 50Hz・最高帯域の上端 = 15000Hz、全帯域で `Σweight > 0` または中心ビン代替が働く |
| U16-03 | `MfsBiquad` の K 特性 | 48kHz の係数が BS.1770 公式値（第1段 b = [1.53512485958697, -2.69169618940638, 1.19839281085285], a = [1, -1.69065929318241, 0.73248077421585]、第2段 b = [1, -2, 1], a = [1, -1.99004745483398, 0.99007225036621]）と各 ±1e-9 で一致。48kHz・44.1kHz で 997Hz の利得 +0.69 ± 0.02 dB、20Hz < -10 dB、10kHz +4.0 ± 0.1 dB（定常正弦波の入出力 RMS 比） |
| U16-04 | オンセット: `sigClickTrack(sr, 16, 120)`（48kHz・44.1kHz） | full 群のオンセットが全クリックについて `クリック時刻 + 0〜25ms` の範囲に発生し、範囲外の発生 0。無音 10 秒では発生 0 |
| U16-05 | テンポ: `sigClickTrack` と `sigDrumPattern`（キック4つ打ち＋8分ハット）を各 BPM {70, 90, 100, 120, 128, 140, 150, 174} で 16 秒（48kHz・44.1kHz） | 8 秒以降の全ホップで `BPM` が `fold(真値)` の ±1%（70→140、174→87）。ピンクノイズ（振幅 0.25）を加えた場合 ±2%。加えて 62〜198BPM を 4BPM 刻みで 14 秒の信号にし、最終ホップの `BPM` が全件 `fold(真値)` の ±1% |
| U16-06 | 拍位相: U16-05 の各信号 | 8 秒以降、信号終端 0.5 秒前までの拍イベント時刻と「正解拍」の最寄り誤差の中央値 ≤ 20ms、95 パーセンタイル ≤ 35ms。正解拍は、`fold` で倍になる場合は真の拍とその中点、半分になる場合は真の拍の偶数番目または奇数番目のうち誤差の小さい方。符号付き平均誤差を出力する（T16-04 の校正に使う） |
| U16-07 | テンポ変化: 120BPM 16 秒 → 128BPM 16 秒 | 切り替えから 6 秒以内に `BPM` が 128 ± 1% |
| U16-08 | 小節頭: `sigDrumPattern`（キックは16分グリッドの 0 番のみ、ハット 8分、スネア 4・12 番）を BPM {90, 100, 120, 128, 140, 150} で 32 秒（48kHz・44.1kHz） | 16 秒以降の `DOWNBEAT_FLAG` の 90% 以上が小節頭（キック位置）± 60ms に一致 |
| U16-09 | ステレオ | L のみ: `BALANCE` = -1 ± 0.01・全 `PAN` = -1 ± 0.01。L = R: `CORR` = 1 ± 0.001・`WIDTH` = 0 ± 0.001。L = -R: `CORR` = -1 ± 0.001・`WIDTH` = 1 ± 0.001。独立白色ノイズ: \|`CORR`\| < 0.1・`WIDTH` = 0.5 ± 0.05 |
| U16-10 | 音色 | 1kHz 正弦波: `CENTROID` = ln(20)/ln(300) ± 0.02、`FLATNESS` < 0.05。白色ノイズ: `FLATNESS` ≥ 0.45 |
| U16-11 | クロマ | 440Hz 正弦波: `CHROMA[9]` = 1、他 < 0.3。C メジャー和音（MIDI 60, 64, 67）: 上位3つが {0, 4, 7} |
| U16-12 | ラウドネス（48kHz・44.1kHz） | 1kHz 正弦波 振幅 0.1（両ch）: 5 秒後の `LOUD_SHORT` = -20.0 ± 0.1 LUFS。997Hz 正弦波 振幅 1.0（L のみ、R は無音）: -3.01 ± 0.05 LUFS（BS.1770 の検定値） |
| U16-13 | 従来互換 byte | `smoothing = 0` で `freqBytes` が同じ窓に対する `SpectrumAnalyzer.analyze` の結果と完全一致。`tauHop` が §5.2 の式どおり（48kHz・0.8 → 0.8^0.64） |
| U16-14 | 決定性 | 同じ入力を2回処理した全ホップの packed・freqBytes・timeBytes がビット単位で一致。`reset` 後の再処理も一致 |
| U16-15 | 数値安全性 | 無音・直流 1.0・振幅 1 の矩形波・単発インパルス・L のみ無音 を各 5 秒: 全出力に NaN / Infinity なし、全値が §4 の値域内 |
| U16-16 | 音量自動補正 | 同じドラムパターンを -30 LUFS と -10 LUFS に調整した2信号で、10 秒後の `AGC_DB` がそれぞれ `clamp(-14 - LOUD_SHORT, -6, 18)` ± 0.5 |
| U16-17 | 性能 | 60 秒ステレオ 48kHz の処理時間（プロセスの CPU 時間。並列実行時の取り合いを除くため。2026-10-03 変更）≤ 6 秒（参考値として実測を出力） |
| U16-18 | `MfsFrameView` | `setPacked` を 1000 回呼んでも `bands` 等のプロパティの参照が同一オブジェクト。各 getter が packed の該当値を返す |
| U16-19 | `computeLayerRange` | `linear` が現行式と一致。`mel`・4 レイヤー・48kHz で境界がメル等分のビン ±1、全レイヤー幅 ≥ 1、連続して隙間・重なりなし |
| U16-20 | `applyAutoGain` | +18dB で 200 → 255（クランプ）、-6dB で 10 → 0（クランプ）、0dB で不変 |

### 9.2 ブラウザ

| ID | ページ | 内容 | 合格基準 |
|---|---|---|---|
| B16-01 | ハーネス | 同じ合成信号（ドラム 10 秒）を `OfflineAudioContext` 上の MFS ワークレット（offline、30fps）と、Node と同じ `MfsExtractor` をページ内で直接駆動した結果で比較 | 全フレームで packed の最大絶対差 ≤ 1e-6、freq/time はバイト一致 |
| B16-02 | アプリ | 120BPM ドラムの WAV を読み込み再生（実時間 12 秒） | `mfsStatus === 'active'`、10 秒以降の `getFeatures().tempo.bpm` が 120 ± 1.5%、コンソールエラー 0 |
| B16-03 | アプリ | `window.__avzForceMfsFailure = true` で起動して再生 | `mfsStatus === 'fallback'`、`getFeatures()` が null、全14タイプで描画してコンソールエラー 0 |
| B16-04 | アプリ | 再生中にシーク・スロット切替・停止を行う | 各操作の 200ms 後の `getMfsDebugInfo().lastHop` が、操作直前の値より小さく 30 以下（ワークレットが 0 から数え直している）、コンソールエラー 0 |
| B16-05 | ハーネス | `features` あり・なし両方の `input` で全14タイプを描画 | 例外 0。`autoGain = false` ではゴールデン（B15-04）が不変 |
| B16-06 | アプリ | ドラム 5 秒を書き出し（30fps） | 状態 `done`、`featureFrames.length === freqFrames.length`（151）、フレーム 0 の packed が全 0、書き出し中の `FramePipeline.render` に渡った `features` が非 null |
| B16-07 | アプリ | 「音量自動補正」を ON/OFF して、-30 LUFS と -10 LUFS の同一ドラムを各 10 秒再生 | 10 秒時点の `visualizer` の `FramePipeline.lastFreq` の平均値の差が、OFF 時に比べ ON 時で 70% 以上縮小 |
| B16-08 | ハーネス | ワークレット単体: offline モードで fps = 30・`totalSamples` = 48000×2 | 送信フレーム数 = 61、index が 0..60 の連番、hop が §6.3 の規則どおり、最後に `done` |
| B16-09 | アプリ | 設定の往復 | `autoGain`・`layerSplit` がプリセット保存/読込・JSON 書き出し/読込で保持される。旧形式 JSON（2項目なし）で既定値になる |
| B16-10 | アプリ | `?debug=1` で再生 | MFS 行・BPM 行・LUFS 行が表示され、再生 10 秒後に BPM 行が数値 |

### 9.3 手動確認（T16-07・T16-09 の PR で実施し結果を記載）

- [ ] 実際の楽曲（ジャンルの異なる3曲以上）で、BPM 表示が曲のテンポ（またはその倍/半分）と一致する
- [ ] 10 分間連続再生して、音切れ・ノイズが発生しない
- [ ] 全14タイプの見た目が Phase 15 時点と同等（体感で遅れ・カクつきが増えていない）
- [ ] マイク入力で解析が動く（`mfsStatus` が `active`）
- [ ] 書き出し結果の動きが、ライブ表示と同等の滑らかさになっている

---

## 10. `doc/spec.md` への反映内容

| 節 | 内容 | チケット |
|---|---|---|
| §9.1（解析方式） | 解析は AudioWorklet（音楽特徴ストリーム）で行い、非対応環境は AnalyserNode へ自動フォールバック。ライブとオフラインは同一の解析コード | T16-07 |
| §9.2（取得データ） | 従来のスペクトル・波形に加え、特徴一覧（本書 §4 の表を参照と記載） | T16-07 |
| §9.3（更新方式） | 解析は約 94 回/秒（48kHz）。描画は出力遅延を補正した時刻の解析結果を使う | T16-07 |
| §10.2（音域分割） | レイヤー分割方式（均等 / 聴感） | T16-10 |
| §12.3（音反応関連パラメータ） | 音量自動補正 | T16-10 |
| §14.8（オフライン書き出し） | 解析粒度がライブと同一になった旨 | T16-09 |
| §20 | 「Phase 16: 音楽特徴ストリーム（実装済み）」 | フェーズ完了時 |

---

## 11. 設計検証の記録（2026-09-28）

本書のアルゴリズム（§5.3〜§5.5、§5.7、§5.8）を、アーキテクトが本書の擬似コードどおりに試作（リポジトリ外）し、§9 の受け入れ基準を満たすことを確認した。実装者は「基準は達成可能である」前提で作業してよい。

| 項目 | 結果（48kHz / 44.1kHz） |
|---|---|
| テンポ（U16-05 相当: クリック・ドラム・ノイズ付き × 8 テンポ） | 32/32 条件で合格（両サンプルレート）。62〜198BPM の 4BPM 刻みスイープ 70/70 |
| 拍位相（U16-06 相当） | 全条件で中央値 ≤ 18.7ms・p95 ≤ 24.1ms。平均誤差 +1.2ms / +2.5ms（`EVENT_LATENCY_FFT_FRACTION = 0.45`） |
| テンポ変化 120→128 | 5.05 秒 / 5.48 秒で再追従 |
| 小節頭（U16-08 相当: 6 テンポ） | 93/93 一致 |
| オンセット（U16-04 相当） | クリック 32/32 を 0〜25ms 以内で検出、誤検出 0、無音で 0 |
| K 特性・ラウドネス | 48kHz 係数が公式値と一致。0dBFS 997Hz 片ch = -3.010 LUFS、振幅 0.1 1kHz 両ch = -19.99 LUFS |
| 音色 | 白色ノイズ平坦度 0.53、1kHz 正弦波の重心 = 理論値 0.5252 |

検証の過程で当初案から次の4点を変更した（本書は変更後の内容）。

1. テンポ候補を整数ラグから 0.25BPM 刻み＋自己相関の線形補間に変更し、半周期ラグの項を追加（当初案はハイハット入り 174BPM を 139BPM と誤推定、高テンポで整数ラグの丸めにより失敗）
2. 初期位相に低域オンセットによる半拍ずれ判定を追加（当初案は 44.1kHz のドラム 120BPM で半拍ずれに固定）
3. 小節頭の蓄積を「全スロット減衰」から「加算スロットのみ減衰」へ変更し、判定窓を拍の前後に拡大、手がかりを低域 ODF の生値に変更（当初案は直近スロットが常に最大となり機能しなかった）
4. K 特性の係数式を RBJ クックブックから libebur128 方式へ変更（RBJ 式は公式係数と一致せず 1kHz で 0.25dB ずれた）

