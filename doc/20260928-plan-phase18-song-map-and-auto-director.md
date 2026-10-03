# Phase 18 実装計画書 — ソングマップと自動演出（Auto Director）

- Document version: `v1.0`
- Date: `2026-09-28`
- 前提: Phase 16 完了（MFS・ワークレット・`MfsFrameView`）
- 作業ルール: `doc/20260928-implementation-guide-for-contractors.md`（以下「ガイド」）
- 目的: 曲を読み込むと裏で全体を先読み解析して「ソングマップ」（拍・小節・セクション・展開の種類）を作り、それに基づいて**拍ぴったりにシーンを切り替える自動演出**を行う。ライブ再生と書き出しは同一のタイムラインで演出する（オーナー決定 D2: 進化の主軸）

---

## 1. スコープ

| 含む | 含まない |
|---|---|
| ソングマップ解析（拍・小節頭・セクション境界・ラベル・展開の種類） | 調（キー）推定（検証で合成音に対し信頼性が不足したため見送り。§10） |
| 自動演出（シーン選択・変化・ビルドの盛り上げ・フラッシュ・クロスフェード） | マイク入力での自動演出（曲全体が無いため。状態表示で「利用できません」と出す） |
| ライブ・書き出し双方への組み込み、UI、シークバーのセクション表示 | タイムラインの手動編集（Phase 20 構想） |
| ソングマップによる `frame.features.tempo` の精度向上 | 4/4 以外の拍子 |

### 1.1 ユーザーから見える変化

- 「アナライザー」セクションに「自動演出」の設定群が増える（既定 OFF。OFF の間は従来と完全に同じ）
- ファイル読込後、各スロットで曲の解析が裏で走り、完了すると自動演出が使える
- シークバーの下に、セクション（イントロ・ビルド・ドロップ等）が色分けで表示される（自動演出 ON のとき）

---

## 2. 全体構成

```
ファイル読込（ui-controller._loadMediaFile）
   └→ SongMapService.request(file)                        … 裏で実行（1件ずつ）
         decodeAudioData → OfflineAudioContext + MFS ワークレット（mode: 'songmap'）
         → ホップごとの行データ → buildSongMap() → SongMap（キャッシュ）
                                    │
アクティブスロットの SongMap ────────┤
                                    ▼
DirectorController.setSongMap → compileDirectorTimeline(SongMap, 演出オプション) → Timeline
                                    │
毎フレーム:  directorStateAt(Timeline, 再生時刻 t, ユーザー設定) → DirectorRenderer（FramePipeline ×2）
書き出し:    同じ Timeline を t = i / fps で評価（ライブと完全一致）
```

### 2.1 新規・変更ファイル

| ファイル | 内容 |
|---|---|
| `js/songmap-analysis.js`（新規） | `buildSongMap(rows, meta)` と各段階の関数（§4）。DOM・Web Audio に依存しない純粋関数 |
| `js/songmap-service.js`（新規） | `SongMapService`（解析キュー・キャッシュ・進捗・中止） |
| `js/director-scenes.js`（新規） | シーンカタログ（§6.3） |
| `js/director-timeline.js`（新規） | `DIRECTOR_CONST`、`compileDirectorTimeline`、`directorStateAt`、`fnv1a32` |
| `js/director-renderer.js`（新規） | `DirectorRenderer` |
| `js/director-controller.js`（新規） | `DirectorController` |
| `js/mfs-worklet.js`（変更） | `mode: 'songmap'` の追加（§3） |
| `js/visualizer-core.js`・`js/offline-exporter.js`・`js/ui-controller.js`・`js/settings.js`・`index.html`・`style.css`（変更） | 組み込みと UI |

`index.html` の読み込み順: `mfs-view.js` の後に `songmap-analysis.js` → `songmap-service.js`、`frame-pipeline.js` の後に `director-scenes.js` → `director-timeline.js` → `director-renderer.js` → `director-controller.js`。

---

## 3. ワークレットの songmap モード

`MfsProcessor` の `processorOptions.mode` に `'songmap'` を追加する（`totalSamples` 必須）。

- ホップ完了ごとに1行（長さ **49** の数値列）を内部バッファに積み、**256 行ごと**にまとめて `{ type: 'rows', startHop, count, data: Float32Array(count·49) }` を送る（`transfer`）。最後に残りを送ってから `{ type: 'done', hops }`
- 行の配置（`SONGMAP_ROW`）:

| キー | オフセット | 長さ | 内容 |
|---|---|---|---|
| `FLUX` | 0 | 4 | `MfsExtractor.flux`（low/mid/high/full のスペクトラルフラックス生値） |
| `BANDS` | 4 | 32 | `MFS_LAYOUT.BANDS` の値 |
| `CHROMA` | 36 | 12 | `MFS_LAYOUT.CHROMA` の値 |
| `ENERGY` | 48 | 1 | `MfsExtractor.hopEnergy`（K 特性二乗和 z_hop） |
| （`LENGTH`） | — | 49 | |

- `SONGMAP_ROW` は `js/mfs-const.js` に `MFS_LAYOUT` と同じ形式で定義する

---

## 4. ソングマップ解析（`js/songmap-analysis.js`）

### 4.1 定数表（`SONG_CONST`）

| 名前 | 値 | 意味 |
|---|---|---|
| `ODF_MEAN_SEC` | 1.0 | ODF から引く移動平均の窓（中心化、秒） |
| `BEAT_TIGHTNESS` | 400 | 動的計画法でテンポ一定を好む強さ |
| `GRID_PERIOD_STEPS` | 10 | 格子当てはめで周期を振る段数（±） |
| `GRID_PERIOD_STEP` | 0.0005 | 1段あたりの周期の相対変化 |
| `GRID_PHASE_STEP_HOPS` | 0.25 | 格子の位相を振る刻み（ホップ） |
| `GRID_TOL` | 0.1 | DP の拍が格子上にあるとみなす許容（周期比） |
| `GRID_MIN_FRAC` | 0.8 | 格子を採用するのに必要な、格子上にある DP 拍の割合 |
| `DOWNBEAT_WINDOW_HOPS` | 2 | 拍位置の前後で低域 ODF の最大値を見るホップ数 |
| `CHROMA_WEIGHT` | 0.5 | 小節特徴ベクトルでのクロマの重み |
| `KERNEL_SEC` | 8 | 新規性カーネルの片側幅（秒。小節数へ換算） |
| `MIN_SECTION_SEC` | 7 | 最小セクション長（秒。小節数へ換算） |
| `PEAK_NEIGHBOR_SEC` | 3.75 | ピーク判定の近傍幅（秒。小節数へ換算） |
| `PEAK_K` | 0.5 | ピーク閾値 = 平均 + この値 × 標準偏差 |
| `ENERGY_NOVELTY_WEIGHT` | 0.5 | エネルギー変化の新規性への加算重み |
| `LABEL_SIM` | 0.8 | 同じラベルとみなすセクション平均ベクトルのコサイン類似度 |
| `EDGE_MAX_ENERGY` | 0.5 | イントロ・アウトロと判定するエネルギー上限 |
| `BREAK_MAX_ENERGY` | 0.5 | ブレイクと判定するエネルギー上限 |
| `BREAK_DROP` | 0.2 | ブレイク判定に必要な直前セクションからのエネルギー低下 |
| `BUILD_SLOPE_PER_SEC` | 0.0267 | ビルド判定に必要なエネルギーの傾き（1秒あたり） |
| `DROP_MIN_ENERGY` | 0.7 | ドロップと判定するエネルギー下限 |
| `DROP_JUMP` | 0.2 | ドロップ判定に必要な直前セクションからのエネルギー上昇 |
| `MIN_DURATION_SEC` | 20 | これより短い音声は解析しない |
| `MAX_DURATION_SEC` | 1200 | これより長い音声は解析しない（メモリ保護） |

Phase 16 の定数（`MFS_CONST`・`mfsDerived`）もそのまま使う（`fr`、`hopSec`、`eventLatencySec`、テンポ推定の定数）。

### 4.2 手順（`buildSongMap(rows, { sampleRate, durationSec })`）

`rows` は `Float32Array(L·49)`（§3 の行を連結）。最初に `durationSec < MIN_DURATION_SEC` なら `'too-short'`、`> MAX_DURATION_SEC` なら `'too-long'` を投げる（`SongMapService` も解析前に同じ判定をして無駄な処理を避ける）。各段階は次の関数に分け、テストから個別に呼べるようにする（すべて `module.exports` に含める）。

| 段階 | 関数 |
|---|---|
| ① | `songOdf(rows, L, fr) -> { o, oL }`（Float64Array） |
| ② | `songGlobalTempo(o, fr) -> { bpm, conf, P }` |
| ③ | `songDpBeats(o, P) -> number[]`（ホップ番号） |
| ④ | `songGridBeats(o, P, dpBeats, sampleRate) -> { beatHops, beats, beatSource, near }` |
| ⑤ | `songDownbeats(beatHops, oL, rows, L) -> number[]`（downbeatIndices） |
| ⑥ | `songBars(beatHops, beats, downbeatIndices, rows, L, durationSec) -> { bars, v, E }` |
| ⑦ | `songBoundaries(v, E, bpm) -> number[]`（小節番号。先頭 0・末尾 nbar を含む） |
| ⑧⑨ | `songSections(boundaries, bars, v, E, bpm) -> sections` |


記法: L = 行数（ホップ数）。本節の平均・標準偏差はすべて**母集団**（n で割る）。`z(a)` は母標準偏差による標準化（標準偏差 ≤ `EPS` なら全 0）、`cos(a, b)` はコサイン類似度（どちらかのノルム ≤ `EPS` なら 0）、`pct(a, p)` は昇順ソート後の要素 `a[round(p·(n−1))]`。

**① ODF**

```
movmean(a)[t] = a[max(0, t−w) .. min(L−1, t+w)] の平均,  w = round(ODF_MEAN_SEC·fr/2)
odfRaw(F)[t]  = max(0, F[t] − movmean(F)[t])
o  = odfRaw(FLUX full) / 母標準偏差（≤ EPS なら全 0）
oL = odfRaw(FLUX low)  / 母標準偏差（同上）
```

**② 全体テンポ**: Phase 16 §5.5.1 の式を o 全体に適用する（`x = o`、`ri[τ]` は τ = 0..TMAX のみ計算、`TMAX = ceil(TEMPO_HARMONICS·60·fr/TEMPO_SEARCH_MIN_BPM) + 2`）。`ri[0] ≤ EPS` なら `SongMapError('no-rhythm')`。得た `fold` 後の値を `bpm`、`conf` を `tempoConfidence`、`P = 60·fr/bpm`（ホップ、実数）とする。

**③ 動的計画法による拍（DP 拍）**

```
for t in 0..L−1:
    lo = max(0, t − round(2P)),  hi = t − round(P/2)
    best = −∞, back[t] = −1
    for p in lo..hi: v = C[p] − BEAT_TIGHTNESS·(ln((t − p)/P))²;  v > best なら best = v, back[t] = p
    C[t] = o[t] + (back[t] ≥ 0 ? best : 0)
tEnd = [max(0, L − round(P)), L−1] で C が最大の t（同値は小さい t）
dpBeats = tEnd から back をたどって −1 まで（昇順に並べ直す）
```

**④ 一定テンポ格子の当てはめ**

```
oi(t) = o の線形補間（t < 0 または t ≥ L−1 なら 0）
for q in −GRID_PERIOD_STEPS..GRID_PERIOD_STEPS（昇順）:
    PP = P·(1 + q·GRID_PERIOD_STEP)
    for m = 0, 1, …（ph = m·GRID_PHASE_STEP_HOPS < PP）:
        score = Σ_{k = 0, 1, …} oi(ph + k·PP)（ph + k·PP < L の範囲。t は累積加算でなく乗算で求める）
        score が今までの最大より大きければ（等しい場合は更新しない）(gP, gPh) = (PP, ph)
grid = [gPh + k·gP]（k = 0, 1, …、< L）
near = |{ h ∈ dpBeats : |h − (gPh + round((h − gPh)/gP)·gP)| ≤ GRID_TOL·gP }| / |dpBeats|
beatHops   = near ≥ GRID_MIN_FRAC ? grid : dpBeats
beatSource = near ≥ GRID_MIN_FRAC ? 'grid' : 'dp'
beats[i] = (beatHops[i] + 1)·hopSec − eventLatencySec
beats[i] < 0 となる i は beats と beatHops の両方から除く（以降の添字は除いた後の配列で数える）
```

- `songGridBeats` は `sampleRate` を受け取り、上の秒換算と「`beats[i] < 0` の拍を `beats` と `beatHops` の両方から除く」処理までを行って `beats`（秒、昇順）も返す。`near`（格子上にある DP 拍の割合）も返す。`buildSongMap` と T18-04 以降は、この戻り値の `beatHops` / `beats` をそのまま使う（2026-10-03 T18-03 で明記）

- 打ち込み音楽のようにテンポが一定の曲では格子を使う（キックの無いブレイクで拍が裏に滑る DP の弱点を補う。§10）。テンポが揺れる曲では DP 拍を使う

**⑤ 小節頭（4/4 固定）**

```
hb_i  = round(beatHops[i])
low_i = oL[hb_i − DOWNBEAT_WINDOW_HOPS .. hb_i + DOWNBEAT_WINDOW_HOPS] の最大値（範囲外は無視）
c_i   = CHROMA 行の和（hop ∈ [hb_i, hb_{i+1})、最後の拍は L まで）
hc_i  = i == 0 ? 0 : 1 − cos(c_i, c_{i−1})
score[k] = Σ_{i mod 4 = k} (z(low)_i + z(hc)_i),  k* = argmax score（同値は小さい k）
downbeatIndices = [k*, k* + 4, k* + 8, …]（beats の範囲内）
```

**⑥ 小節**

```
barStartHop_j = round(beatHops[downbeatIndices[j]])。barStartHop ≥ L − 1 の小節は捨てる。小節数 nbar
小節 j のホップ範囲 = [j == 0 ? 0 : barStartHop_j,  j + 1 < nbar ? barStartHop_{j+1} : L)   // 先頭の弱起は最初の小節に含める
小節 j の時刻範囲   = [j == 0 ? 0 : beats[downbeatIndices[j]],  j + 1 < nbar ? beats[downbeatIndices[j+1]] : durationSec)
v_j (44次元) = ホップ範囲の平均 [BANDS(32), CHROMA_WEIGHT·CHROMA(12)]、その後 次元ごとに全小節で z 標準化
barLufs_j = LOUD_OFFSET + 10·log10(ホップ範囲の ENERGY の平均 + EPS)
p5 = pct(barLufs, 0.05), p95 = pct(barLufs, 0.95)
E_j = p95 − p5 < 1 ? 0.5 : clamp((barLufs_j − p5)/(p95 − p5), 0, 1)
```

nbar < 2 の場合は、全体を1セクション（`kind: 'main'`, `label: 'A'`）として⑦〜⑨を省略する。

**⑦ 境界（新規性）**

```
barSecA = 4·60/bpm                                       // 解析上の1小節（秒）
K   = max(4, round(KERNEL_SEC/barSecA)),  σ = K/2           // 下限 4 小節 = コード進行1周（2026-10-03 変更、§10 の 6）
MINS = max(2, round(MIN_SECTION_SEC/barSecA)),  NB = max(1, round(PEAK_NEIGHBOR_SEC/barSecA))
S(i, k) = (0 ≤ i, k < nbar) ? cos(v_i, v_k) : 0
offsets = {−K..−1, 1..K}
nov_j (j = 1..nbar−1) = max(0, Σ_{a,b ∈ offsets} sgn(a)·sgn(b)·exp(−(a² + b²)/(2σ²))·S(ia, ib)),  ia = a < 0 ? j + a : j + a − 1（ib も同様）
en_j  (j = 1..nbar−1) = |E_j − E_{j−1}|
N_j = nov_j / max(nov) + ENERGY_NOVELTY_WEIGHT·en_j / max(en)     （max が 0 なら 1 で割る）
thr = mean(N_1..N_{nbar−1}) + PEAK_K·std(N_1..N_{nbar−1})
候補 j ∈ [MINS, nbar − MINS]: N_j ≥ thr かつ |d| ≤ NB（d ≠ 0, 1 ≤ j + d < nbar）の全 d で N_j ≥ N_{j+d}
候補を N の降順（同値は j の昇順）に見て、採用済みの全境界と MINS 以上離れていれば採用
boundaries = [0, 採用した j（昇順）, nbar]
```

**⑧ ラベル**: セクション s の平均ベクトル `mv_s`（小節 `v_j` の平均）を時刻順に見て、既存ラベルの代表ベクトル（そのラベルを最初に付けたセクションの `mv`）とのコサイン類似度の最大が `LABEL_SIM` 以上ならそのラベル（同値は先に作ったラベル）、そうでなければ新しいラベル（`A`, `B`, …, `Z`, `AA`, `AB`, …）。

**⑨ 展開の種類**: セクション s について `E_s` = 小節 E の平均、`slope_s` = 小節番号に対する E の最小二乗の傾き ÷ `barSecA`（1秒あたり。1小節なら 0）。上から順に最初に当てはまるもの:

| 順 | kind | 条件 |
|---|---|---|
| 1 | `intro` | s = 最初 かつ `E_s < EDGE_MAX_ENERGY` かつ セクション数 ≥ 3 |
| 2 | `outro` | s = 最後 かつ `E_s < EDGE_MAX_ENERGY` かつ セクション数 ≥ 3 |
| 3 | `break` | 最初でも最後でもない かつ `E_s ≤ BREAK_MAX_ENERGY` かつ `E_{s−1} − E_s ≥ BREAK_DROP` |
| 4 | `build` | 最後でない かつ `slope_s ≥ BUILD_SLOPE_PER_SEC` かつ `E_{s+1} > E_s` |
| 5 | `drop` | `E_s ≥ DROP_MIN_ENERGY` かつ（最初 または `E_s − E_{s−1} ≥ DROP_JUMP` または 直前の kind が `build`） |
| 6 | `main` | 上記以外 |

### 4.3 出力（SongMap v1）

```js
{
  version: 1,
  durationSec, sampleRate,
  bpm, tempoConfidence,
  beatSource: 'grid' | 'dp',
  beats: number[],               // 秒、昇順
  downbeatIndices: number[],     // beats の添字、昇順
  bars: [{ startSec, endSec, energy }],
  sections: [{ startBar, endBar, startSec, endSec, label, kind, energy, slopePerSec }],  // 連続・重なりなし・[0, durationSec] を覆う
}
```

- `validateSongMap(map) -> { ok, errors: string[] }` を同ファイルに置く（`beats` 昇順・`downbeatIndices` が範囲内・`sections` が連続して全区間を覆う・`kind` が6種のいずれか、等）。`buildSongMap` の出力は常に検証を通ること
- `SongMapError(code)` の `code`: `'no-rhythm'`（リズムが検出できない）、`'too-short'`、`'too-long'`、`'decode'`（デコード失敗）、`'cancelled'`

### 4.4 ソングマップによる拍情報の置き換え（`songMapTempoAt`）

ソングマップがあるとき、`frame.features.tempo` の値を、ライブの推定（Phase 16 §5.5）ではなくソングマップの拍から計算した値で上書きする（全レンダラー・演出でライブと書き出しの拍が一致し、精度も上がる）。

```js
songMapTempoAt(map, tSec, prevTSec, view)   // view: MfsFrameView。tempo 関連の raw 値を上書きする
```

```
i = beats[i] ≤ tSec < beats[i+1] を満たす i
無ければ（最初の拍より前・最後の拍以降）: BPM = map.bpm、TEMPO_CONF = map.tempoConfidence、TEMPO_LOCKED = 0、
  BEAT_PHASE = BAR_PHASE = BEAT_IN_BAR = 0、BEAT_FLAG = DOWNBEAT_FLAG = 0 を書いて終了
BPM = map.bpm, TEMPO_CONF = map.tempoConfidence, TEMPO_LOCKED = 1
BEAT_PHASE = (tSec − beats[i]) / (beats[i+1] − beats[i])
d0 = downbeatIndices[0];  BEAT_IN_BAR = ((i − d0) mod 4 + 4) mod 4
BAR_PHASE = (BEAT_IN_BAR + BEAT_PHASE) / 4
シーク判定: prevTSec が null、tSec < prevTSec、または tSec − prevTSec > DIRECTOR_CONST.SEEK_RESET_SEC（§6.2）なら フラグは 0
それ以外: BEAT_FLAG = (prevTSec, tSec] に beats の要素がある ? 1 : 0
          DOWNBEAT_FLAG = (prevTSec, tSec] に downbeatIndices が指す拍がある ? 1 : 0
```

- ライブは `mediaElement.currentTime`、書き出しは `i / fps` を `tSec` に使う。`prevTSec` は呼び出し側が前フレームの値を保持する
- 置き換えは `FramePipeline.render` の前に、`input.features` に対して行う（`features` が null なら何もしない）

---

## 5. SongMapService（`js/songmap-service.js`）

```js
class SongMapService {
  constructor()
  keyOf(file)                  // `${file.name}|${file.size}|${file.lastModified}`
  request(file) -> Promise<SongMap>   // 同じキーの実行中・キャッシュ済みがあればそれを返す
  get(file) -> SongMap | null         // キャッシュのみ参照
  cancel(file)                        // 実行中・待機中を中止（Promise は SongMapError('cancelled') で reject）
  onProgress = (key, ratio) => {}     // 0..1
}
```

- 実行は**1件ずつ**（待機列、先着順）。キャッシュは最大 6 件（最も古く参照されたものから捨てる）
- 処理: `file.arrayBuffer()` → `AudioContext.decodeAudioData`（失敗は `'decode'`）→ 長さ判定（`MIN_DURATION_SEC` / `MAX_DURATION_SEC`）→ `OfflineAudioContext`（元のチャンネル数・サンプルレート）+ MFS ワークレット（songmap モード。ノードのチャンネル指定は Phase 16 §6.2 と同じ）→ 行データを `Float32Array(L·49)` に集める → `buildSongMap`
- 進捗: ワークレット処理 0〜0.9（受信行数 / 予想ホップ数）、`buildSongMap` 完了で 1.0
- 呼び出し元: `ui-controller._loadMediaFile` の読込完了後に `request`（自動演出が OFF でも実行する。解析結果は §4.4 で全体の拍精度向上に使うため）。スロットのファイルを差し替え・削除したら、旧ファイルを `cancel`
- AudioWorklet が使えない環境（Phase 16 のフォールバック状態）では実行せず、状態を `unavailable` にする

---

## 6. 自動演出（Auto Director）

### 6.1 基本方針

- 演出は **「タイムライン」を事前にコンパイルし、描画時は時刻 t から状態を引くだけ**の純粋関数方式にする
  - 同じ入力（ソングマップ・演出オプション）からは常に同じタイムラインができる → **ライブ再生と書き出しで演出が完全一致**
  - シークしても即座に正しい場面になる（内部状態を持たない）
  - 将来のタイムライン編集（Phase 20 構想）も同じデータ構造を編集するだけで済む
- 演出が変更するのは「どのタイプで・どんな動きで描くか」だけ。**色（色相・彩度・輝度）・背景色・表示比率・動画合成・解析設定はユーザー設定のまま**
- 演出が変更する設定キー（`DIRECTOR_MANAGED_KEYS`）: `analyzerType`, `expressionMethod`, `barDisplayMode`, `layerCount`, `motionSpeed`, `particleAmount`, `afterimageIntensity`、および色相のずらし量（`hue` への加算のみ）

### 6.2 定数表（`DIRECTOR_CONST`、`js/director-timeline.js`）

| 名前 | 値 | 意味 |
|---|---|---|
| `KIND_CLASS` | `{intro:'calm', break:'calm', outro:'calm', build:'build', drop:'drop'}` | 展開の種類 → シーン系統。`main` は下記で決定 |
| `MAIN_DROP_ENERGY` | 0.6 | `main` のうち、エネルギーがこれ以上なら `drop` 系統、未満なら `calm` 系統 |
| `VARIATION_PERIOD_BARS` | `{calm: 16, standard: 8, wild: 4}` | セクション内の変化の間隔（小節）。`drop` 系統は半分（最小 2） |
| `VARIATION_OPS` | `['hueShift', 'method', 'mirror', 'layers']` | 変化の種類（§6.5） |
| `HUE_SHIFT_DEG` | `{calm: 30, standard: 60, wild: 60}` | `hueShift` 1回の色相加算量 |
| `RAMP_MOTION_MUL` | `{calm: 1.4, standard: 1.8, wild: 2.2}` | ビルド区間終端での `motionSpeed` 倍率 |
| `RAMP_AFTERIMAGE_ADD` | 3 | ビルド区間終端での `afterimageIntensity` 加算量 |
| `RAMP_PARTICLE_MUL` | 1.5 | ビルド区間終端での `particleAmount` 倍率 |
| `FADE_MIN_SEC` | 0.25 | クロスフェードの最短時間 |
| `FADE_MAX_SEC` | 1.0 | クロスフェードの最長時間 |
| `FLASH_PEAK_ALPHA` | 0.8 | フラッシュの最大不透明度 |
| `FLASH_TAU_SEC` | 0.12 | フラッシュの減衰時定数 |
| `FLASH_DURATION_SEC` | 0.4 | フラッシュの表示時間 |
| `FLASH_MIN_INTERVAL_SEC` | 2.0 | フラッシュの最小間隔（光過敏への配慮。WCAG 2.3.1 の「1秒に3回以下」を十分に下回る） |
| `SEEK_RESET_SEC` | 1.0 | 前フレームとの時刻差がこれを超える（または逆行する）とシークとみなす |

### 6.3 シーンカタログ（`js/director-scenes.js`）

内蔵シーンは全14タイプを系統に割り当てる。空欄は「ユーザー設定のまま」。`patch` の適用規則（プリセット由来も同じ。`applyScenePatch(settings, patch)` として `director-scenes.js` に置く）:

- `analyzerType` は常に適用し、以降の判定は適用後のタイプの `capabilities` で行う
- `expressionMethod`: `capabilities.methods` に含まれる場合のみ
- `barDisplayMode`: `capabilities.barDisplayMode === true` の場合のみ
- `layerCount`: `capabilities.layers === true` の場合のみ
- `motionSpeed`・`particleAmount`・`afterimageIntensity`: 常に適用（対応しないタイプでは描画に影響しないだけ）

| ID | 系統 | analyzerType | expressionMethod | barDisplayMode | layerCount | motionSpeed | particleAmount | afterimageIntensity |
|---|---|---|---|---|---|---|---|---|
| `builtin:spectrogram` | calm | spectrogram | | | | | | |
| `builtin:lissajous` | calm | lissajous | line | | | 1.0 | | 4 |
| `builtin:flower` | calm | flower | line | | 2 | 0.6 | | 3 |
| `builtin:voronoi` | calm | voronoi | | | 2 | 0.5 | 40 | 2 |
| `builtin:ripple` | calm | ripple | | | 2 | 0.8 | | 3 |
| `builtin:tunnel` | build | tunnel | line | | | 1.2 | | 2 |
| `builtin:terrain` | build | terrain | line | | | 1.0 | | 0 |
| `builtin:ring3d` | build | ring3d | line | | 2 | 1.2 | | 2 |
| `builtin:flow` | build | flow | dot | | 2 | 1.2 | 70 | 4 |
| `builtin:particles` | drop | particles | dot | | 3 | 1.5 | 90 | 3 |
| `builtin:bar3d` | drop | bar3d | | | 3 | | | 0 |
| `builtin:radial` | drop | radial | bar | | 3 | | | 2 |
| `builtin:metaball` | drop | metaball | | | 2 | 1.2 | | 0 |
| `builtin:bar` | drop | bar | bar | mirror-vertical | 4 | | | 1 |

「マイプリセット」を選んだ場合（`directorPool = 'presets'`）:
- 各プリセットの系統は、そのプリセットの `analyzerType` を上表で引いて決める
- `patch` はプリセットの設定のうち `DIRECTOR_MANAGED_KEYS`（§6.1。`hue` は除く）に含まれるキーだけを取り出したもの。色・感度・レイヤー個別設定・背景・動画合成・解析設定などはプリセットの値を使わず、ユーザーの現在の設定のまま（§6.1 の方針どおり）
- ある系統にプリセットが1つも無い場合、その系統は内蔵シーンを使う
- シーン ID は `preset:<プリセット名>`

### 6.4 タイムラインのコンパイル（`compileDirectorTimeline`）

```js
compileDirectorTimeline(songMap, options, presets) -> timeline
// options: { intensity: 'calm'|'standard'|'wild', pool: 'builtin'|'presets', flash: boolean, seedOffset: integer }
// presets: [{ name, settings }]（pool = 'presets' のときのみ使用。名前の昇順で渡す）
```

```
seed = fnv1a32(`${songMap.durationSec.toFixed(3)}|${songMap.bpm.toFixed(2)}|${songMap.sections.length}|${options.seedOffset}`)
rng  = makeRng(seed)                  // js/vis-utils.js
sceneByKey = {}; prevSceneId = null; lastFlash = -Infinity; segments = []; flashes = []
for (s, i) in songMap.sections（時刻順）:
  cls = s.kind == 'main' ? (s.energy ≥ MAIN_DROP_ENERGY ? 'drop' : 'calm') : KIND_CLASS[s.kind]
  key = s.label + '|' + cls
  if key in sceneByKey: scene = sceneByKey[key]                  // 同じラベルの繰り返しは同じシーン（例: 2回目のドロップ）
  else:
    list = 候補(cls)（シーン ID の昇順）
    if list.length > 1: list から prevSceneId を除く
    scene = list[floor(rng() * list.length)];  sceneByKey[key] = scene
  transitionIn = i == 0 ? {type: 'cut', duration: 0}
               : s.kind == 'drop' ? {type: 'cut', duration: 0}
               : {type: 'fade', duration: clamp(60 / songMap.bpm, FADE_MIN_SEC, FADE_MAX_SEC)}
  period = VARIATION_PERIOD_BARS[intensity];  if cls == 'drop': period = max(2, period / 2)
  opStart = floor(rng() * VARIATION_OPS.length)
  variations = []; opCursor = opStart
  for bar = s.startBar + period; bar < s.endBar; bar += period:
    適用可能な op を VARIATION_OPS[opCursor % 4] から最大4つ順に探す（§6.5 の適用条件）
    見つかれば variations.push({ timeSec: 小節 bar の開始時刻, op }), opCursor = 見つかった位置 + 1
  ramp = s.kind == 'build' ? { motionMul: [1, RAMP_MOTION_MUL[intensity]], afterimageAdd: [0, RAMP_AFTERIMAGE_ADD],
                               particleMul: [1, RAMP_PARTICLE_MUL] } : null
  if options.flash && intensity != 'calm' && s.kind == 'drop' && i > 0 && s.startSec - lastFlash ≥ FLASH_MIN_INTERVAL_SEC:
    flashes.push(s.startSec); lastFlash = s.startSec
  segments.push({ startSec: s.startSec, endSec: s.endSec, sectionIndex: i, kind: s.kind, cls,
                  sceneId: scene.id, patch: scene.patch, variations, ramp, transitionIn })
  prevSceneId = scene.id
return { version: 1, seed, intensity: options.intensity, durationSec: songMap.durationSec, segments, flashes }   // intensity は directorStateAt の変化適用（hueShift 等）で使う（2026-10-03 追加）
```

- `fnv1a32(str)`: FNV-1a 32bit（初期値 `0x811c9dc5`、乗数 `0x01000193`、UTF-16 コード単位ごと、`Math.imul` と `>>> 0` で計算）
- 小節 bar の開始時刻 = `songMap.bars[bar].startSec`（bar がソングマップの小節数以上なら `durationSec`）

### 6.5 変化（variation）の適用条件と効果

変化は同じセグメント内で**累積**する（2回目の `hueShift` なら合計 2 回分ずれる）。

| op | 適用条件（シーン適用後のタイプの `capabilities`） | 効果 |
|---|---|---|
| `hueShift` | 常に | `hue = (hue + HUE_SHIFT_DEG[intensity]) mod 360` |
| `method` | `methods.length ≥ 2` | `expressionMethod` を `methods` 配列内の次の値へ（末尾の次は先頭） |
| `mirror` | `barDisplayMode === true` | `barDisplayMode` を `normal → mirror-vertical → mirror-horizontal → normal` の順に |
| `layers` | `layers === true` | `layerCount = (layerCount mod 4) + 1` |

### 6.6 時刻から状態を引く（`directorStateAt`）

```js
directorStateAt(timeline, tSec, baseSettings, out) -> out
// out は呼び出し側が1回だけ作って使い回す:
// { primary: { segmentIndex, sceneId, settings }, secondary: { segmentIndex, sceneId, settings } | null, mix, flashAlpha }
// settings は createDefaultSettings() で作った使い回しオブジェクトへ上書きする（毎フレームの生成なし）
```

```
t = clamp(tSec, 0, durationSec)
i = startSec ≤ t < endSec を満たすセグメント（t = durationSec なら最後）
primary.settings = segmentSettings(i, t)
seg = segments[i]
if seg.transitionIn.type == 'fade' && t < seg.startSec + seg.transitionIn.duration && i > 0:
    secondary.settings = segmentSettings(i - 1, t)     // 前セグメントの状態（変化は全て適用済み、ランプは終端値）
    mix = (t - seg.startSec) / seg.transitionIn.duration     // 新セグメントの重み 0..1
else: secondary = null, mix = 1
f = t 以下で最も新しい flashes の要素
flashAlpha = (f が存在 && t - f < FLASH_DURATION_SEC) ? FLASH_PEAK_ALPHA·exp(-(t - f)/FLASH_TAU_SEC) : 0

segmentSettings(j, t):
  s = baseSettings を複製（layers も要素ごとに複製。使い回しオブジェクトへ代入）
  s に segments[j].patch を適用（capabilities が対応しない項目は除く）
  segments[j].variations のうち timeSec ≤ t のものを順に適用
  if segments[j].ramp:
      u = clamp((t - startSec)/(endSec - startSec), 0, 1)
      s.motionSpeed         = clamp(s.motionSpeed · lerp(1, motionMul[1], u), 0.1, 3.0)
      s.afterimageIntensity = clamp(s.afterimageIntensity + lerp(0, afterimageAdd[1], u), 0, 10)
      s.particleAmount      = clamp(round(s.particleAmount · lerp(1, particleMul[1], u)), 10, 100)
  return s
```

### 6.7 描画（`DirectorRenderer`、`js/director-renderer.js`）

- 毎フレームの設定オブジェクト生成: 各 `FramePipeline.render` 内の `{...settings, hue}` は Phase 15 計画書 §4.3 で許容した例外のまま。DirectorRenderer 側では追加の生成をしない（2026-10-03 明記）
- シーク検出と拍フラグの集約は §4.4 `songMapTempoAt` と DirectorController（§6.8）の責務。`directorStateAt` は時刻 → 状態の純関数とする（2026-10-03 明記）

```js
class DirectorRenderer {
  constructor(targetCanvas, targetCtx)   // オフスクリーン canvas を2枚、FramePipeline を2つ作る
  resize()                               // オフスクリーンを target と同寸にし、両パイプラインの resize()
  reset()                                // 両パイプラインの reset()、割当の消去
  render(input, state, bgColor)          // state は directorStateAt の out
  dispose()
}
```

- パイプラインの割当: セグメント番号 `k` は `pipelines[k % 2]` で描く。あるパイプラインに割り当てたセグメント番号が変わったら、描画前にそのパイプラインを `reset()` する（前シーンの履歴・残像を持ち越さない）
- 手順:
  1. `pipelines[primary.segmentIndex % 2]` で `primary.settings` を描画（オフスクリーンへ）
  2. `secondary` があれば、もう一方のパイプラインで `secondary.settings` を描画
  3. 出力 canvas へ合成: `secondary` があれば secondary のオフスクリーンを不透明度 1 で描き、その上に primary を不透明度 `mix` で描く。無ければ primary を不透明度 1 で描く
  4. `flashAlpha > 0` なら、背景が黒なら白、白なら黒で全面を不透明度 `flashAlpha` で塗る
- 動画合成（`input.drawBackground`）は両パイプラインでそのまま使う
- 呼び出し側は、時刻が `SEEK_RESET_SEC` を超えて飛んだ、または逆行したときに `reset()` を呼ぶ

### 6.8 ライブ・書き出しへの組み込み

`DirectorController`（`js/director-controller.js`）が、タイムライン・`DirectorRenderer`・状態をまとめて持つ。

```js
class DirectorController {
  constructor(targetCanvas, targetCtx)
  setSongMap(songMap | null)          // アクティブスロットのソングマップ
  setOptions(options, presets)        // 変更時に再コンパイル
  get status()                        // 'off' | 'analyzing' | 'ready' | 'unavailable' | 'error'
  isReady()                           // songMap とタイムラインがある
  render(input, baseSettings, tSec)   // directorStateAt → DirectorRenderer.render。シーク検出もここで行う
  resize(), dispose()
}
```

| 経路 | 変更 |
|---|---|
| ライブ（`visualizer-core.js`） | `VisualizerCore` に `mediaElement`（再生中のメディア要素。音声・動画とも）と `director`（`DirectorController`）のプロパティを追加する。`mediaElement` は `UIController` が `_applyActiveSlot()`・`_loadMediaFile()` の後に `mediaManager.mediaElement` を設定し、マイク入力中は `null` にする。`settings.directorEnabled && director.isReady() && mediaElement` のとき、`FramePipeline.render` の代わりに `director.render(input, settings, mediaElement.currentTime)` を呼ぶ。それ以外は従来どおり |
| 書き出し（`offline-exporter.js`） | `export(file, settings, opts)` の `opts` に `songMapService`（`SongMapService`）と `presets`（`[{name, settings}]`、名前の昇順）を追加する（`UIController` が渡す。演出オプションは `settings` の `director*` から作る）。`settings.directorEnabled` なら、書き出し開始時に `opts.songMapService.request(file)` でソングマップを得て、ライブと**同じ引数**でタイムラインをコンパイルし、書き出し用 `DirectorController` で `t = i / fps` として描く。ソングマップ取得に失敗した場合は自動演出なしで書き出す |
| 再コンパイルの契機 | 自動演出の ON、アクティブスロットのソングマップ確定、スロット切替、`directorIntensity`・`directorPool`・`directorFlash`・`directorSeedOffset` の変更、プリセットの保存・削除 |

- タイムラインは色などのユーザー設定を含まない（毎フレーム `baseSettings` に重ねる）。したがってユーザーが色を変えても再コンパイルは不要で、即座に反映される

---

## 7. 設定と UI

### 7.1 設定キー（`js/settings.js` の `DEFAULT_SETTINGS` に追加）

| キー | 型 | 既定 | 意味 |
|---|---|---|---|
| `directorEnabled` | boolean | `false` | 自動演出 |
| `directorIntensity` | `'calm'`\|`'standard'`\|`'wild'` | `'standard'` | 演出の強さ |
| `directorPool` | `'builtin'`\|`'presets'` | `'builtin'` | シーン候補 |
| `directorFlash` | boolean | `true` | ドロップ時のフラッシュ |
| `directorSeedOffset` | number（整数） | `0` | 「別の演出にする」で +1 |

### 7.2 UI（「アナライザー」セクション末尾に小見出し「自動演出」を追加）

| 要素 ID | 種類 | ラベル / 内容 |
|---|---|---|
| `director-enabled` | チェックボックス | 自動演出 |
| `director-intensity` | セレクト | 控えめ / 標準 / 激しい |
| `director-pool` | セレクト | 内蔵シーン / マイプリセット |
| `director-flash` | チェックボックス | ドロップ時のフラッシュ（点滅を含みます） |
| `director-shuffle` | ボタン | 別の演出にする |
| `director-status` | テキスト | 下表 |

| 状態 | `director-status` の表示 |
|---|---|
| OFF | （空） |
| 解析中 | `曲を解析中… 42%` |
| 準備完了 | `128 BPM・6 セクション`（BPM は整数に四捨五入） |
| マイク入力中 | `マイク入力では利用できません` |
| ワークレット非対応 | `この環境では利用できません` |
| 解析失敗 | `解析できませんでした（<理由>）`。理由: `no-rhythm` → リズムを検出できません、`too-short` → 20秒未満です、`too-long` → 20分を超えています、`decode` → 音声を読み込めません |

- 自動演出が ON かつ準備完了の間、`DIRECTOR_MANAGED_KEYS` に対応する操作（タイプ・表現方法・表示モード・レイヤー数・動きの速さ・要素量・残像強度）と「アナライザーランダム」「形状ランダム」ボタンを無効化し、`title="自動演出中"` を付ける
- シークバーの直下に高さ 3px のセクション帯（要素 ID `section-strip`）を置き、各セクションを長さに比例した幅の `div` で表す。色は `style.css` の CSS 変数 `--section-calm`（`#666`）、`--section-build`（`#c90`）、`--section-drop`（`#e33`）、`--section-main`（`#999`）で、系統（§6.4 の `cls`、`main` は `--section-main`）により決める。自動演出 OFF では非表示
- 各ランダムボタンは `director*` の5項目を変更しない
- プリセット・JSON 入出力は既存の仕組みで5項目も保存される（旧 JSON は既定値で補完）

---

## 8. 受け入れテスト

### 8.1 テスト用合成楽曲（`tests/shared/song-synth.js`）

`synthSong(sampleRate, { bpm = 128, seed = 11 }) -> { channels: [L, R], sampleRate, truth, barSec }`。**以下の手順・順序どおりに**生成する（乱数の消費順が結果に影響するため）。

```
plan  = [intro 8小節, build 8, drop 16, break 8, drop 16, outro 8]（計 64 小節、4/4）
barSec = 4·60/bpm,  n = round(64·barSec·sampleRate),  L・R = Float32Array(n)
rng = makeRng(seed)                                   // js/vis-utils.js と同一
prog = [[57,60,64], [53,57,60], [48,52,55], [55,59,62]]   // Am F C G（MIDI）
midi(m) = 440·2^((m − 69)/12)
add(i, v, pan = 0): 0 ≤ i < n のときのみ
    L[i] += v·cos((pan + 1)·π/4)·√2,  R[i] += v·sin((pan + 1)·π/4)·√2
各セクション kind（小節数 nb）の各小節 b（0..nb−1）について、通し小節番号 gb、t0 = gb·barSec、chord = prog[gb mod 4]、frac = b/nb:
  (1) パッド: padAmp = {intro: 0.05, build: 0.06, drop: 0.08, break: 0.07, outro: 0.05·(1 − frac)}
      s0 = round(t0·sr), s1 = round((t0 + barSec)·sr)
      i ∈ [s0, s1): env = min(1, (i − s0)/sr/0.05)
                    v = Σ_{m∈chord} (sin(2π·midi(m)·i/sr) + 0.5·sin(4π·midi(m)·i/sr))
                    add(i, padAmp·env·v/3)
  (2) 16分音符 q = 0..15（ts = t0 + q·barSec/16、s = round(ts·sr)）について、この順で:
      drums = (kind == drop)
      キック: drums かつ q mod 4 == 0、または kind == build かつ b ≥ 4 かつ q mod 4 == 0 のとき
              len = round(0.12·sr), ph = 0; i ∈ [0, len): ph += 2π·(60 − 20·i/len)/sr; add(s + i, 0.9·sin(ph)·exp(−i/(0.04·sr)))
      ハット: amp = {drop: 0.2, build: 0.05 + 0.25·frac, break: 0.06, その他: 0}
              on  = {drop: q mod 2 == 0, build: 常に, break: q mod 4 == 2, その他: なし}
              on かつ amp > 0 のとき len = round(0.03·sr), prev = 0;
              i ∈ [0, len): w = rng()·2 − 1; add(s + i, amp·(w − prev)·exp(−i/(0.008·sr)), 0.3); prev = w
      スネア: drums かつ q ∈ {4, 12} のとき len = round(0.08·sr), ph = 0;
              i ∈ [0, len): ph += 2π·200/sr; add(s + i, (0.3·sin(ph) + 0.3·(rng()·2 − 1))·exp(−i/(0.02·sr)), −0.1)
      ベース: drums かつ q mod 2 == 0 のとき f = midi(chord[0] − 24), len = round(barSec/8·sr);
              i ∈ [0, len): add(s + i, 0.35·sin(2π·f·i/sr)·exp(−i/(0.15·sr)))
  (3) ライザー: kind == build のとき i ∈ [s0, s1): add(i, 0.15·((b + (i − s0)/(s1 − s0))/nb)·(rng()·2 − 1))
最後に L・R 全体の絶対値の最大 pk を求め、全サンプルに 0.9/pk を掛ける
truth = { boundariesBars: [0, 8, 16, 32, 40, 56, 64], kinds: [intro, build, drop, break, drop, outro],
          beats: 各4分音符の時刻, downbeats: 各小節の t0 }
```

`tests/shared/song-synth.js` には、テンポ変化曲 `synthTempoChange(sampleRate)`（Phase 15 の `sigDrumPattern` によるキック4つ打ち＋8分ハットを 120BPM 30 秒 → 126BPM 30 秒で連結）も置く。戻り値の `truth.beats` に正解の拍時刻（秒）を持たせる（U18-10 の F 値計算用。2026-10-01 T18-01 で明記）。

### 8.2 Node 単体

ソングマップの入力行は、合成音を Node 上の `MfsExtractor` に通して作る（`tests/lib/songmap-rows.mjs` に共通化）。

| ID | 対象 | 内容・合格基準 |
|---|---|---|
| U18-01 | ① ODF | 定数列で全 0、単発インパルス列で該当位置のみ正、標準偏差 1 に正規化 |
| U18-02 | ③ DP 拍 | 120BPM 相当のインパルス列 ODF（L = 3000 ホップ、48kHz）で、DP 拍がインパルス位置と ±1 ホップで全一致 |
| U18-03 | ④ 格子 | U18-02 の入力で `beatSource = 'grid'`。インパルス列の後半のテンポを 5% 変えた入力で `'dp'` |
| U18-04 | ⑤ 小節頭 | 4拍ごと（位相 1）にだけ強い low 値を持つ合成行で `downbeatIndices[0] mod 4 = 1` |
| U18-05 | ⑦ 境界 | `bpm = 120`（K = 4、MINS = 4、NB = 2）で、8小節ずつ4種の小節ベクトル（A, B, A, C、各次元に標準偏差 0.1 の乱数、シード固定）で境界が [0, 8, 16, 24, 32] |
| U18-06 | ⑦ 最小長 | `bpm = 120` で、2小節だけ異なるベクトルを挟んでも、その前後に境界が立たない（`MINS` の確認） |
| U18-07 | ⑨ 種類 | §4.2 ⑨ の表の各行を満たす E・傾きの組を与え、期待どおりの kind（表駆動テスト、各行 2 例以上） |
| U18-08 | 楽曲（主要テンポ） | `synthSong` を bpm ∈ {100, 128, 140} × sampleRate ∈ {48000, 44100}: bpm が真値 ±1%、拍 F 値（±70ms）≥ 0.95、`downbeatIndices` が指す拍の 90% 以上が真の小節頭 ±70ms、境界が 5 個で各真値（秒）と ±(1小節 + 70ms) 以内、kind が `[intro, build, drop, break, drop, outro]`、ラベルが「3番目 = 5番目 ≠ 1番目」、`validateSongMap` が ok |
| U18-09 | 楽曲（半分への折り返し） | `synthSong` bpm = 174（両サンプルレート）: bpm = 87 ± 1%、拍 F 値 ≥ 0.95（真の拍の偶数番目または奇数番目のうち良い方）、境界は ±(解析上の1小節 = 4·60/87 秒 + 70ms)、kind・ラベルは U18-08 と同じ。小節頭は評価しない（半拍子の位相は原理的に決まらない） |
| U18-10 | 楽曲（テンポ変化） | `synthTempoChange`: `beatSource = 'dp'`、拍 F 値 ≥ 0.95 |
| U18-11 | エラー | 無音 30 秒 → `no-rhythm`、10 秒 → `too-short` |
| U18-12 | `songMapTempoAt` | 拍の直前・直後・小節頭・最初の拍より前・最後の拍より後で各値が定義どおり。シーク（逆行・1秒超）でフラグ 0 |
| U18-13 | コンパイルの決定性 | 同じ入力で2回コンパイルした結果が深く一致。`seedOffset` 0〜9 のうち少なくとも1つで、あるセクションのシーンが変わる |
| U18-14 | ラベルの再利用 | U18-08（128BPM）のソングマップで、2つのドロップのシーン ID が同じ |
| U18-15 | 連続回避 | 候補が2つ以上の系統で、隣り合うセグメントのシーン ID が同じにならない（`seedOffset` 0〜49 の全てで確認） |
| U18-16 | 変化 | 各 op の効果と適用条件（§6.5）。適用できない op は飛ばされ、次の op が使われる |
| U18-17 | `directorStateAt` | フェード区間の開始・中央・終了で `mix` = 0 / 0.5 / 1（許容 1e-9）、ドロップ開始はカット（secondary null）、ビルド区間の 0%・50%・100% 地点でランプ値が式どおり |
| U18-18 | フラッシュ | 経過 0 秒で 0.8、0.12 秒で 0.8·e⁻¹、0.4 秒以降 0。`flashes` の間隔が全て 2 秒以上。`intensity = 'calm'` または `flash = false` でフラッシュ無し |
| U18-19 | 保護キー | どのシーン・プリセットでも `bgColor`・`aspectRatio`・動画合成・解析設定が `baseSettings` の値のまま |
| U18-20 | 毎フレームの生成なし | `directorStateAt` を 1000 回呼んで、`out` 内の `settings` オブジェクトの参照が変わらない |

### 8.3 ブラウザ

| ID | ページ | 内容 | 合格基準 |
|---|---|---|---|
| B18-01 | ハーネス | `synthSong(48000, {bpm: 128})` を WAV にして `SongMapService.request`（`timeoutMs: 120000`） | 結果が U18-08 と同じ基準に合格。同じ PCM から Node の `MfsExtractor` で作った行による `buildSongMap` の結果と、`beats`（±1e-6 秒）・`sections` が一致 |
| B18-02 | アプリ | 同 WAV をスロット1に読み込み、自動演出 ON で再生 | 解析完了後に状態が「準備完了」、`section-strip` にセクションが6個、コンソールエラー 0 |
| B18-03 | アプリ | B18-02 の状態で、ライブの `DirectorController` のタイムラインと、書き出しで生成されるタイムライン | 深く一致 |
| B18-04 | アプリ | 同 WAV を自動演出 ON で書き出し（30fps。`{ slow: true, timeoutMs: 900000 }`） | 完了。デコードした映像で、2つ目のセクション境界（ビルド→ドロップ）の直前と直後のフレームの平均絶対差が、同一セクション内で隣り合うフレームの平均絶対差の 3 倍以上（場面転換が境界で起きている） |
| B18-05 | アプリ | 再生中に最初のドロップの中央へシーク | 次のフレームの `primary.sceneId` が、タイムライン上のそのセグメントのシーン ID と一致 |
| B18-06 | アプリ | マイク入力（フェイクデバイス: 起動引数 `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`）で自動演出 ON | 状態表示が「マイク入力では利用できません」、通常描画が続く、コンソールエラー 0 |
| B18-07 | アプリ | `window.__avzForceMfsFailure = true` で起動 | 自動演出の状態が「この環境では利用できません」、コンソールエラー 0 |
| B18-08 | アプリ | 自動演出 ON で `?debug=1` を開き、フェード区間を含む 10 秒間を再生 | フェード中の描画時間の p95 が、フェード外の p95 の 2.5 倍以下（参考値として両方を出力） |

### 8.4 手動確認（T18-09・T18-10 の PR で実施し結果を記載）

- [ ] ジャンルの異なる実楽曲 5 曲（オーナー提供）で、シーンの切り替えが曲の展開と合っていると感じられる（曲ごとに ○/△/× と一言コメントを PR に記載）
- [ ] フラッシュが不快・危険に感じられない（「控えめ」ではフラッシュが無いこと）
- [ ] 書き出した動画と、ライブ表示の演出が同じ
- [ ] 自動演出 OFF にすると、すべての操作が元どおり使える

---

## 9. チケット一覧

| ID | タイトル | 難易度 | 前提 | 成果物 | 受け入れテスト | spec 更新 |
|---|---|---|---|---|---|---|
| T18-01 | テスト用合成楽曲・行データ生成 | ★2 | Phase 16 | `tests/shared/song-synth.js`、`tests/lib/songmap-rows.mjs` | 生成の決定性（2回生成でビット一致）、`truth` の値 | 不要 |
| T18-02 | ワークレット songmap モード | ★2 | Phase 16 | `mfs-worklet.js`、`mfs-const.js`（`SONGMAP_ROW`） | B18-01 の行データ部分、行数 = ホップ数 | 不要 |
| T18-03 | 拍・格子・小節頭（①〜⑤） | ★3 | T18-01 | `songmap-analysis.js`（前半） | U18-01〜U18-04、U18-10 | 不要 |
| T18-04 | 小節・境界・ラベル・種類・出力（⑥〜⑨、§4.3） | ★3 | T18-03 | `songmap-analysis.js`（後半）、`tests/fixtures/songmap-128.json` | U18-05〜U18-09、U18-11 | 不要 |
| T18-05 | SongMapService | ★2 | T18-02, T18-04 | `songmap-service.js`、`ui-controller.js`（読込後の request・差し替え時の cancel） | B18-01 | 不要 |
| T18-06 | 拍情報の置き換え（関数のみ） | ★1 | T18-04 | `songmap-analysis.js`（`songMapTempoAt`）。ライブ・書き出しからの呼び出しは T18-09・T18-10 で行う | U18-12 | 不要 |
| T18-07 | シーンカタログとコンパイル | ★2 | T18-04 | `director-scenes.js`、`director-timeline.js`（`compileDirectorTimeline`・`fnv1a32`） | U18-13〜U18-16、U18-19 | 不要 |
| T18-08 | 状態の評価と描画 | ★3 | T18-07 | `director-timeline.js`（`directorStateAt`）、`director-renderer.js` | U18-17、U18-18、U18-20 | 不要 |
| T18-09 | ライブへの組み込み（`songMapTempoAt` の呼び出しを含む）と UI | ★2 | T18-05, T18-06, T18-08 | `director-controller.js`、`visualizer-core.js`、`ui-controller.js`、`settings.js`、`index.html`、`style.css` | B18-02、B18-05〜B18-08 | 要 |
| T18-10 | 書き出しへの組み込み（`songMapTempoAt` の呼び出しを含む） | ★2 | T18-09 | `offline-exporter.js` | B18-03、B18-04 | 要 |

- T18-07 の単体テストは、T18-04 で生成した U18-08（128BPM・48kHz）のソングマップを JSON に保存したフィクスチャ `tests/fixtures/songmap-128.json` を使う（T18-04 の成果物に含める）
- `visualizer-core.js` を編集するのは T18-09 のみ、`offline-exporter.js` は T18-10 のみ（並行作業での衝突を避けるため）

---

## 10. 設計検証の記録（2026-09-28）

§4 のソングマップ解析を、アーキテクトが本書どおりに試作（リポジトリ外）し、§8.1 の合成楽曲で §8.2 の U18-08〜U18-10 相当の基準を満たすことを確認した。

| 条件 | 結果 |
|---|---|
| 100 / 128 / 140BPM × 48kHz / 44.1kHz（6条件） | 全条件で合格。拍 F 値 0.998〜1.000、小節頭 98〜100%、境界 5/5、種類 6/6、ラベル条件合格、拍の平均誤差 −1.8〜+0.9ms |
| 174BPM × 2 サンプルレート（87 へ折り返し） | 合格（拍 F 値 1.000、境界・種類・ラベル合格） |
| テンポ変化 120→126BPM | 格子一致率 0.59 で `dp` を選択、拍 F 値 1.000 |
| 解析時間（120 秒の曲、特徴抽出後） | 83〜135ms |

検証の過程で当初案から次を変更した（本書は変更後の内容）。

1. DP の `BEAT_TIGHTNESS` を 100 から 400 に変更し、さらに一定テンポ格子の当てはめ（④）を追加。キックの無いブレイクで裏拍ハイハットに DP 拍が滑り、小節頭の判定も崩れたため。tightness の調整だけでは条件によって失敗が残った
2. 新規性カーネル幅・最小セクション長・ピーク近傍を小節数固定から秒指定に変更（半分へ折り返したテンポでは解析上の小節が実際の2倍になり、境界を取りこぼしたため）
3. ビルドの傾きを1秒あたりに正規化し、判定順を「ブレイク → ビルド → ドロップ」に変更（ビルドをドロップと、ブレイクをビルドと誤判定したため）
4. 最後の小節が空になる場合を除外（ゼロ除算で NaN が出たため）
5. 調（キー）推定をスコープから除外。FFT 長 2048 では 400Hz 未満で半音を分解できず、合成音で主音を安定して当てられなかったため。自動演出は調を使わない設計にした
6. （2026-10-03、T18-04 実装時）新規性カーネル片側幅 K の下限を 2 から 4 小節に変更。Phase 16 T16-04 でクロマをスペクトルピークのビンのみの加算に変えた結果、コード変化の新規性が強まり、100BPM（K = round(8/2.4) = 3）ではカーネルが 4 小節のコード進行1周を覆えず、drop 内の 4 小節ごとに偽の境界が立った（48kHz で内部境界 10 個）。下限 4 で 8 条件すべて境界 5/5・種類 6/6・ラベル合格。128BPM 以上は K ≥ 4 のため結果は不変

---

## 11. `doc/spec.md` への反映内容

| 節 | 内容 | チケット |
|---|---|---|
| §9（音声解析） | 「9.7 ソングマップ（Phase 18）」を新設: 読込後に曲全体を解析して拍・小節・セクションを求めること、ソングマップがある場合は拍情報をそれで置き換えること | T18-06 |
| §13（再生モード） | 「13.4 自動演出」を新設: 目的、設定項目（§7.1）、変更される設定と変更されない設定（§6.1）、ライブと書き出しで同一であること、フラッシュの頻度上限 | T18-09 |
| §14.8（オフライン書き出し） | 自動演出 ON の場合の挙動 | T18-10 |
| §15.1（必須 UI 要素） | 自動演出の UI、セクション帯 | T18-09 |
| §20 | 「Phase 18: ソングマップと自動演出（実装済み）」 | フェーズ完了時 |
