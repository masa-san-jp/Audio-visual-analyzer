# IMP-02 実装計画書 — 周波数軸の対数化（Issue #68）

- Document version: `v1.0`
- Date: `2026-11-15`
- 前提: main（spec v2.29、IMP-01 まで反映）
- 決定: オーナー決定 3（2026-11-15）「周波数軸の既定は対数にする」。要件は [Issue #68](https://github.com/masa-san-jp/Audio-visual-analyzer/issues/68) の「どうなったら直ったと言えるか」1〜4
- 作業ルール: `doc/20260928-implementation-guide.md`
- 状態: **実装済み（2026-11-15、spec v2.30）**

---

## 1. 目的と効果

48kHz・FFT 2048・50Hz〜15kHz で、各帯域が画面の横幅に占める割合は次のとおり。

| 帯域 | 現行（線形） | 対数（本計画） |
|---|---|---|
| 50〜500Hz（低音域） | 3.0% | 40.4% |
| 1kHz までの左側 | 6.4% | 52.5% |
| 1オクターブあたり | 帯域によって 0.3%〜50% | どこでも一定（12.15%） |

---

## 2. 設計の要点

**描画タイプ（`js/renderers/*.js`）は変更しない。** 描画タイプは今と同じく、受け取った配列を等間隔に読む（`idx = floor(i * len / count)`）。`FramePipeline` が、周波数スペクトルを**対数軸の上で等間隔に並べ直した配列**を作って渡す。こうすると、全描画タイプ・全表示モード・残像・録画・書き出しが、変更なしで対数軸になる（Issue #68 の条件3）。

```
freq（線形のビン列）→ 音量自動補正 → [本計画] 周波数軸の写像（レイヤーごと）→ 描画タイプ
                                      └→ 履歴（3D地形・トンネル）にも写像後の全帯域を積む
```

### 2.1 対象と対象外

| 対象 | 扱い |
|---|---|
| 棒グラフ・円形放射（全表現方法・全表示モード・レイヤー1〜4） | 写像後の配列を渡す |
| 3D地形・トンネル（`frame.freq`・履歴を使う） | 写像後の全帯域を `frame.freq` と履歴に渡す |
| スペクトログラム | **対象外**。独自に縦軸を疑似対数で描いているため、二重に対数化しないよう線形のビン列を渡す（`capabilities.ownFreqAxis: true` を宣言） |
| オシロスコープ（リサージュ） | 対象外（時間波形だけを使う） |
| GPU タイプ | 対象外（別経路） |

---

## 3. 定数と設定

### 3.1 定数（`js/vis-utils.js` の `FREQ_AXIS_CONST`）

| 名前 | 値 | 意味 |
|---|---|---|
| `F_MIN_HZ` | 50 | 軸の左端（`doc/spec.md` §9.6 と同じ） |
| `F_MAX_HZ` | 15000 | 軸の右端。実際は `min(15000, sampleRate / 2)` |
| `MIN_POINTS` | 16 | 写像後の配列の最小長 |

### 3.2 設定（`js/settings.js`）

| キー | 値 | 既定 | 意味 |
|---|---|---|---|
| `freqAxis`（新規） | `'log'` \| `'linear'` | `'log'` | 周波数軸 |
| `layerSplit`（既存） | `'linear'` \| `'mel'` \| `'log'`（`'log'` を追加） | `'log'`（従来は `'linear'`） | レイヤーの帯域の分け方 |

- 不正な値は既定値として扱う（既存の `layerSplit` と同じ方式）
- `freqAxis` を持たない旧プリセット・旧 JSON は既定の `'log'` で表示される（見た目が変わる。オーナー決定 3 のとおり）。旧プリセットに保存されている `layerSplit: 'linear'` はそのまま使う
- 各ランダムボタンは `freqAxis`・`layerSplit` を変更しない

---

## 4. アルゴリズム（`js/vis-utils.js`、純粋関数）

### 4.1 周波数 → 軸上の位置（Issue #68 の検証対象）

```js
freqToAxis(f, fMin, fMax, mode) -> 0..1
```

| 条件 | 戻り値 |
|---|---|
| `mode === 'log'` | `clamp(ln(f / fMin) / ln(fMax / fMin), 0, 1)`（`f ≤ 0` は 0） |
| `mode === 'linear'` | `clamp((f − fMin) / (fMax − fMin), 0, 1)` |
| 帯域外（`f < fMin`・`f > fMax`） | 0 または 1 にクランプ |

逆関数 `axisToFreq(t, fMin, fMax, mode)` も同じファイルに置く（log: `fMin·(fMax/fMin)^t`、linear: `fMin + t·(fMax − fMin)`）。

### 4.2 レイヤーの帯域境界（Hz）

レイヤー i（0..count−1）の周波数範囲 `[fa_i, fb_i]` を `layerSplit` で決める。

| `layerSplit` | 境界 j（0..count） |
|---|---|
| `'log'` | `axisToFreq(j / count, F_MIN, F_MAX, 'log')`（4レイヤーで各 2.057 オクターブ。Issue #68 の条件2） |
| `'mel'` | 既存の `computeLayerRange`（`js/mfs-view.js`）と同じメル等分 |
| `'linear'` | 既存の `computeLayerRange` と同じビン等分 |

### 4.3 スペクトルの並べ直し（`buildAxisResampler` と `resampleSpectrum`）

レイヤー i の周波数範囲 `[fa, fb]` を、`M` 個の点に対数間隔で並べ直す。

```
M = max(MIN_POINTS, floor(sliceLen / count))     // 1レイヤーなら sliceLen と同じ長さ
binHz = sampleRate / fftSize、 startBin = computeFreqRange(sampleRate, fftSize / 2).startBin
点 j（0..M−1）が受け持つ周波数範囲:
  f_lo = fa·(fb/fa)^(j/M),  f_hi = fa·(fb/fa)^((j+1)/M)
  k_lo = f_lo / binHz − startBin,  k_hi = f_hi / binHz − startBin    // スライス内のビン位置（実数）
値の決め方:
  範囲 [k_lo, k_hi) に整数のビン位置が1つ以上ある（高域。複数ビンが1点に入る）
      → それらのビンの最大値
  1つもない（低域。1ビンが複数点にまたがる）
      → 中心 k_c = (k_lo + k_hi)/2 で、両隣のビンを線形補間（小数点以下は四捨五入）
ビン位置はスライスの範囲 [0, sliceLen − 1] にクランプする
```

- 低域でデータの間隔より細かく割り当てる部分は補間し、ブロック状に見えないようにする（48kHz では約 2.6kHz 未満が補間、それ以上は最大値の集約）。最大値を使うのは、細いピークが集約で消えないようにするため
- 補間か最大値かの区別と、ビンの番号・重みは**点ごとに事前計算した表**（`Int32Array`／`Float32Array`）に持つ。表は `(sliceLen, sampleRate, fftSize, fa, fb, M)` が変わったときだけ作り直す（毎フレームの配列生成なし）

### 4.4 `freqAxis === 'linear'` のとき

**写像しない。** 従来どおり `computeLayerRange` のスライス（`subarray`）をそのまま渡す。線形モードは従来と**画素単位で同じ見た目**になる（Issue #68 の条件4、回帰）。

---

## 5. `FramePipeline` の変更（`js/frame-pipeline.js`）

| 箇所 | 変更 |
|---|---|
| `_getLayer(i, count)` | `freqAxis === 'log'` かつ `sampleRate`・`fftSize` がある場合は、§4.2 の範囲を §4.3 で並べ直したレイヤー別の事前確保バッファを返す。それ以外は現行どおり |
| ステートフル描画（`_renderStateful`） | `ownFreqAxis` でないタイプには、全帯域（1レイヤー扱い）を写像した配列を `frame.freq` として渡し、履歴にも写像後の配列を積む |
| 写像のタイミング | 音量自動補正（§0）の後。1フレームで同じレイヤーを2回写像しない |
| `lastFreq` | 現行どおり補正後・写像前の値（観測用） |

`js/renderer-registry.js`: `spectrogram` の `capabilities` に `ownFreqAxis: true` を追加する。

---

## 6. UI と文書

- `index.html`・`js/ui-controller.js`: アナライザーセクションのタイプの下に、セレクト「周波数軸」（`id="freq-axis"`、対数 / 線形）を追加する。スペクトログラム・オシロスコープ・GPU タイプでは隠す（値は保持）。「レイヤー分割」に「対数（オクターブ等分）」を追加する
- `doc/spec.md`: §9.6 に「帯域を画面へ割り当てる軸は既定で対数（1オクターブあたりの幅が一定）。線形に切り替えられる」を追加（Issue #68 の「ついでに直すもの」）。§10.2 にレイヤー分割の3方式、§15.1 に周波数軸の UI を追加
- `README.md`・`log.md`

---

## 7. チケット

| ID | 内容 | 難易度 | 前提 | 成果物 | 受け入れテスト |
|---|---|---|---|---|---|
| AX-1 | 写像の純粋関数 | ★2 | — | `vis-utils.js`（`FREQ_AXIS_CONST`・`freqToAxis`・`axisToFreq`・`buildAxisResampler`・`resampleSpectrum`・対数のレイヤー境界） | U-AX-01〜04 |
| AX-2 | パイプラインへの組み込み・回帰の確認・基準画像の更新 | ★3 | AX-1 | `frame-pipeline.js`、`renderer-registry.js`、`settings.js`（`freqAxis`・`layerSplit` の既定）、`tests/shared/golden-cases.js`、`tests/golden/frames.json` | B-AX-01〜03、B15-04 |
| AX-3 | UI・仕様書 | ★1 | AX-2 | `index.html`、`ui-controller.js`、`spec.md`、`README.md`、`log.md` | B-AX-04・05 |

### 7.1 基準画像（ゴールデン）の扱い（AX-2。実装時に確定）

- 既存の34ケースは描画入力に `sampleRate`・`fftSize` を渡していないため、写像が働かず**従来どおり線形**で描かれる（§5 の条件）。したがって既存の基準値は**一切更新しない**。これがそのまま線形の回帰の証明になる
- 対数軸のケースを6つ追加する（`bar-log`・`bar-log-mirror-h`・`bar-log-layers4`・`radial-log`・`terrain-log`・`tunnel-log`。入力に 48kHz・2048 を渡す）。基準値は `--update-golden` で生成し、**新しいケースの値だけ**を `tests/golden/frames.json` に取り込む（`--update-golden` は全ケースを書き直すため、既存ケースの値は元に戻す）
- 2026-11-15 の実装時、変更前のコードで再生成しても `bar-layers4` が最大1階調ずれた（環境差）。既存値を残す理由の一つ

---

## 8. 受け入れテスト

| ID | 種類 | 内容 | 合格基準 |
|---|---|---|---|
| U-AX-01 | Node | `freqToAxis`（log） | 50Hz → 0、15000Hz → 1。100→200Hz の幅と 2000→4000Hz の幅の差 ≤ 1e-9。100 点で単調増加。49Hz → 0、15001Hz → 1、0Hz・負 → 0。`axisToFreq(freqToAxis(f))` が f と相対誤差 1e-12 以内 |
| U-AX-02 | Node | `freqToAxis`（linear） | `(f − 50)/(15000 − 50)` と一致（回帰。Issue #68 の 110/440/880/7040Hz で 0.004/0.026/0.056/0.468 ± 0.001） |
| U-AX-03 | Node | 対数のレイヤー境界 | 4レイヤーで各レイヤーの幅が `log2(15000/50)/4` オクターブ（誤差 1e-9）。1〜4レイヤーで境界が連続し、隙間・重なりがない |
| U-AX-04 | Node | `resampleSpectrum` | (a) 1kHz にだけ値がある合成スペクトル（48kHz・2048・M = 638）で、最大値の位置 j/M が 0.5252 ± 0.01。(b) 単調増加のスペクトルを並べ直した結果が単調非減少（補間と集約の継ぎ目に段差が出ない）。(c) 同じ引数で 1000 回呼んでも出力配列の参照が変わらない。(d) 44.1kHz でも (a)〜(c) が成り立つ |
| B-AX-01 | ブラウザ | 線形モードの回帰 | §7.1 の `-linear` ケースが現在の基準値に合格 |
| B-AX-02 | ブラウザ | 全組合せの動作 | 棒グラフ・円形放射 × 表現方法3種 × レイヤー1〜4 × 表示モード3種（棒グラフのみ）× 対数／線形で、各 30 フレーム描画して例外 0・コンソールエラー 0 |
| B-AX-03 | ブラウザ | スペクトログラムは対象外 | `freqAxis` を切り替えても、スペクトログラムの描画結果が画素単位で同じ |
| B-AX-04 | ブラウザ | 設定の往復 | `freqAxis`・`layerSplit: 'log'` がプリセット保存/読込・JSON 入出力で保持される。`freqAxis` の無い旧 JSON は `'log'`、不正値は既定値 |
| B-AX-05 | ブラウザ | UI | 「周波数軸」がスペクトログラム・オシロスコープ・GPU タイプで隠れ、他のタイプで表示される。切り替えると次のフレームから反映される |

手動確認（AX-2 の PR に記載）: 1kHz 以下の棒が画面の左 5 割程度まで広がっていること、低音域がブロック状に見えないこと、録画・オフライン書き出しの結果がライブ表示と同じ軸であること。

---

## 9. 作業量とリスク

- 変更ファイル: 9〜11（描画タイプは変更なし）。概算 300〜400 行（テスト含む）
- リスク: 既定の見た目が変わる（オーナー決定済み）。旧プリセットも対数で表示される。線形に戻す選択肢を残し、回帰は §7.1 で画素レベルで保証する
