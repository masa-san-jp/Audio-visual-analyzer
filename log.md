# 開発ログ

## 2026-10-01 — [T16-03] テンポ・拍位相・小節

### 作業内容
- `js/mfs-tempo.js`（新規）: `MfsTempo`（計画書 §5.5.1〜§5.5.5）。`constructor(sampleRate)`、`process(odf, odfLow, onsetFlags, envFull, tSec)`、`reset()`、公開 `bpm / conf / phase / barPhase / beatInBar / beatFlag / downbeatFlag / locked`。`MFS_CONST` と `mfsDerived` 以外を参照しない自己完結クラス。バッファ・候補テンポ表（τ(b)・事前分布 W(b)）は constructor で確保し、`process()`（推定を含む）で配列・オブジェクトを生成しない
- `tests/lib/mfs-drive.mjs`（新規）: MfsExtractor 統合前に §5.1 / §5.3 どおりホップ分割・Hann・FFT で A を作り MfsOnset / MfsTempo を駆動するテスト用ヘルパ（`forEachHop`、`runTempo`）。L=R の信号は R の FFT を省略（同値、時間短縮のみ）
- `tests/unit/mfs-onset.test.mjs`: ホップ駆動部を上記ヘルパへ置換（テスト内容・閾値は不変、結果も同一）
- `tests/unit/mfs-tempo.test.mjs`（新規）: U16-05〜U16-08 ＋ 無音・決定性・reset

### 検証
- U16-05: クリック/ドラム × 8 テンポ × {ノイズなし, ピンク0.25} × {48k, 44.1k} = 64 条件すべて、8 秒以降の全ホップの BPM 誤差 最大 0.36%（基準 ±1% / ノイズ付き ±2%）。ロック時刻 4.5 秒（1 条件のみ 5.5 秒）。62〜198BPM 4BPM 刻みスイープ 70/70、最大誤差 0.31%
- U16-06: 全 64 条件で中央値 ≤ 10.7ms、p95 ≤ 17.2ms（基準 20 / 35ms）。ノイズなし全条件の符号付き平均誤差 48kHz -1.73ms / 44.1kHz -1.10ms（T16-04 の校正の入力）
- U16-07: 切替後 5.05 秒（48kHz）/ 5.48 秒（44.1kHz）で 128±1% に到達
- U16-08: 12 条件（6 テンポ × 2 レート）すべて 16 秒以降の DOWNBEAT_FLAG が 100% 一致（最大ずれ 12ms）
- `node tests/run.mjs`: 54 件中 53 成功 / 0 失敗 / 1 スキップ（U15-00 異常系）

### 備考
- 実装: Sonnet サブエージェント
- 計画書の解釈（推測で決めた箇所）: §5.5.2 の `tempoConf` は `conf < TEMPO_MIN_CONF` のときも推定を実行した時点で更新する。小節蓄積中に次の拍イベントが来た場合は先に蓄積を確定する（実際には拍間隔 > 4 ホップのため起きない）
- テスト実行時間: MfsOnset の `Math.log` が支配的で、mfs-tempo.test.mjs は約 110 秒
- 定数・オンセット実装は変更していない

---

---

## 2026-10-01 — [T16-08] FramePipeline・レンダラー契約 v2

### 作業内容
- `js/frame-pipeline.js`: `input` に `features` / `sampleRate` / `fftSize` を追加。`settings.autoGain && input.features` のとき `applyAutoGain` で補正した freq（内部バッファ、長さ変更時のみ再確保）を履歴・レイヤー切り出し・レンダラーの全てに使う。読み取り専用 `FramePipeline.lastFreq`（実際に描画へ使った freq）を追加。`input.getLayer` が null（または補正適用フレーム）のときは補正後 freq から `computeLayerRange`（`settings.layerSplit`）で切り出す。`sampleRate` / `fftSize` が無い入力は均等分割。レイヤーの subarray はレイヤー別にキャッシュして毎フレーム生成しない。ステートフルレンダラーへ渡す `frame` に `features`（null あり）を追加。`frame.beat`（`BeatDetector`）は補正前の `input.freq` で動かし、従来と同一
- `index.html`: `js/mfs-const.js`・`js/mfs-view.js` を `frame-pipeline.js` の前に追加（`FramePipeline` が `applyAutoGain` / `computeLayerRange` / `MFS_CONST` を使うため必須。ハーネスも index.html の script 順から生成される）
- `doc/renderer-contract.md`: v2。`frame.features` 行、`getLayer` の説明、必須ルール2に「features が null の場合のガード」を追記
- `tests/browser/b16-05.test.js`（新規、ハーネス）: 全14タイプ × 4 パターン（features なし / あり・autoGain 無効 / あり・autoGain 有効・聴感分割 / なし・autoGain 有効）を描画。`lastFreq` が autoGain 無効時は入力そのまま、有効時は `applyAutoGain` の結果と一致、`frame.features` の受け渡し・null を確認

### 検証
- `node tests/run.mjs` 全件（B16-05 追加）。B15-04 ゴールデン66ケースは基準値を再生成せず一致。ゴールデンの pipeline ドライバは `getLayer: null` のまま入力形が不変のため未変更

### 備考
- 実装: Sonnet サブエージェント
- ライブ（`visualizer-core.js`）・オフライン（`offline-exporter.js`）は従来どおり `getLayer` を渡す。T16-07 / T16-09 で `null` に切り替える
- 設定キー `autoGain` / `layerSplit` は `DEFAULT_SETTINGS` 未追加（T16-10）。未定義は falsy / 均等として扱われる

## 2026-10-01 — [T15-08] デバッグ表示

### 作業内容
- `js/debug-overlay.js`（新規）: `DebugOverlay.create(containerEl[, search]) -> overlay | null`、`recordFrame(renderMs, nowMs)`、`setField(key, text)`、`dispose()`。`?debug=1` のときだけ `#debug-overlay`（pointer-events なしの DOM 要素）を作る。FPS は 1 秒窓、描画時間は直近 120 フレーム（平均 / p95 / 最大）、表示更新は 250ms ごと。バッファは constructor で確保済みで、フレームごとの配列・オブジェクト生成なし
- `js/visualizer-core.js`: `start()` で `DebugOverlay.create`、`_loop` で overlay がある場合のみ `performance.now()` を `pipeline.render` の前後に呼んで計測（無効時は従来と同じ経路）
- `index.html`: `js/debug-overlay.js` を `visualizer-core.js` の前に追加
- `tests/run.mjs`: app ページ用に任意の `// @query <クエリ>` 宣言を追加（未指定は従来どおり `index.html`。後方互換）。クエリごとにページを開き直す
- `tests/browser/b15-06.test.js`（`@query debug=1`）、`tests/browser/b15-06-nodebug.test.js`（クエリなし。ID は B15-06b）
- `doc/spec.md` v2.9: §20 に「Phase 15（実装済み）」を追加、Phase 15 を計画済み表から除去。`README.md`: `?debug=1` と `@query` を追記

### 検証
- `node tests/run.mjs`: 40 件中 39 成功 / 0 失敗 / 1 スキップ（U15-00 異常系は想定どおり）。B15-04 ゴールデン 66 ケース一致（基準値未変更）
- B15-06 / B15-06b: PASS
- `file://` で `index.html` と `index.html?debug=1` を開きコンソールエラー 0。debug 時の表示例: `FPS: 62.1 / render avg/p95/max: 0.02 / 0.10 / 0.10 ms / type: bar`
- `node --check` 全 `.js` / `.mjs`: PASS

### spec.md 変更
- v2.8 → v2.9（2026-10-01）。§20 に Phase 15 完了を追加（計画書 §8、フェーズ最終チケットのため）

### 備考
- レビューで追加: CI で Chrome 起動（DevToolsActivePort 生成待ち）が10秒で時間切れになる事象が PR #44・#45 で発生したため、`tests/lib/chrome.mjs` の待ち時間を30秒にし、起動時の環境エラーに限り最大3回試行するよう変更（Claude）
- 実装: Sonnet サブエージェント
- 判断: ランナーが app ページでクエリを開けないため `@query` 宣言を追加。overlay の生成は `app.js` ではなく `VisualizerCore.start()` に置いた（計画書の変更対象ファイルに合わせるため）

---

---

## 2026-10-01 — [T16-02] オンセット検出

### 作業内容
- `js/mfs-onset.js`: `MfsOnset`（計画書 §5.4 の擬似コードどおり。`constructor(sampleRate, fftSize)` / `process(A, tSec)` → フラグ 0..15 / `reset()`、公開 `flux` / `env`（Float32Array(4)）/ `odf` / `odfLow`）。`MFS_CONST` と `mfsDerived` のみ参照する自己完結実装。`process()` 内で配列・オブジェクトを生成しない
- `tests/unit/mfs-onset.test.mjs`: U16-04。`MfsExtractor` 未実装のため、テスト内で §5.1 / §5.3 どおりにホップ分割・Hann 窓・FFT・モノラル振幅 A を作って駆動する
- `index.html`・ワークレットは未変更

### 検証
- U16-04（クリック 120BPM 16 秒）: 48kHz クリック 32 / 命中 32 / 取りこぼし 0 / 範囲外 0、遅れ 5.3〜16.0ms。44.1kHz 同 32/32/0/0、遅れ 6.2〜17.1ms（基準 0〜25ms）
- U16-04（無音 10 秒）: 全群で発生 0（両サンプルレート）
- 参考（基準なし）: ピンクノイズ 0.25 重畳で 27/32 検出、誤検出 1（両サンプルレート）
- `node tests/run.mjs`: 42 件中 41 成功 / 0 失敗 / 1 スキップ（U15-00 異常系は想定どおり）。`node --check` PASS

---

## 2026-10-01 — [T16-06] メインスレッドのビューとレイヤー分割

### 作業内容
- `js/mfs-view.js`: `MfsFrameView`（構築時に subarray とネストした getter ビューを1回だけ生成。`setPacked(f)` は内部 `Float32Array(104)` へコピーのみ。`beatFlag` / `downbeatFlag` / `locked` は raw >= 0.5 の boolean）、`applyAutoGain(freqIn, agcDb, out)`（§5.8 の式どおり）、`computeLayerRange(i, count, sliceLen, sampleRate, fftSize, mode, out)`（§6.5。`'mel'` 以外は現行の線形式、`'mel'` はメル等分境界をビン番号へ変換し各レイヤー最低1ビン・隙間なし。`computeFreqRange` の結果は (sampleRate, fftSize) ごとにモジュール内へキャッシュし、毎回のオブジェクト生成を避ける）
- `tests/unit/mfs-view.test.mjs`: U16-18〜U16-20
- `index.html` / `frame-pipeline.js` / `audio-engine.js` は未変更（組み込みは T16-07 / T16-08）

### 検証
- `node tests/run.mjs`: 43 件中 42 成功 / 0 失敗 / 1 スキップ（U15-00 異常系は想定どおり）
- U16-18〜U16-20: PASS

### spec.md 変更
- なし

### 備考
- 実装: Sonnet サブエージェント
- 時刻は `tSec`（ホップ完了時刻）を使用。`eventLatencySec` による補正はしていない（計画書に従う）

---

- mel の最終レイヤーの終端は常に `sliceLen`（計画書の clamp 規則だと 15000Hz のビンが sliceLen-1 に丸まる場合に末尾1ビンが欠けるため）。差は ±1 ビン以内

## 2026-10-01 — [T16-01] 定数・データ配置・DSP 部品

### 作業内容
- `js/mfs-const.js`: `MFS_CONST`（計画書 §3 の全定数を同名・同値で定義）、`MFS_LAYOUT`（§4 のオフセットと `LENGTH: 104`）、`mfsDerived(sampleRate)`（§3.1。`alpha(T)` / `frames(T)` / `binOf(hz)` は関数）
- `js/mfs-dsp.js`: `mfsWindowHann(n)`、`MfsFft`（基数2・倍精度・in-place・1/N 正規化なし）、`MfsMelBank`（§5.3。三角フィルタを構築時に疎形式で保持。公開: `bands` / `lowHz` / `centerHz` / `highHz` / `weightSum(b)`、`apply(P, out)` は割り当てなし）、`MfsBiquad`（転置直接形 II、`static kWeighting(sampleRate)` は libebur128 方式の係数）。いずれも `MFS_CONST` 以外のグローバルを参照しない自己完結実装
- `tests/unit/mfs-dsp.test.mjs`: U16-01〜U16-03 と導出値・レイアウトの確認（`loadClassic` 経由）
- `index.html` は未変更（組み込みは後続チケット）

### 検証
- `node tests/run.mjs`: 37 件中 36 成功 / 0 失敗 / 1 スキップ（U15-00 異常系は想定どおり）
- U16-01: PASS（最大相対誤差 1.88e-13、N=64・2048 計 2112 ビン）
- U16-02: PASS（48kHz・44.1kHz とも 32 帯域、中心 122.4〜13617.7Hz、中心ビン代替 0 帯域）
- U16-03: PASS（48kHz 係数が公式値と ±1e-9 で一致。997Hz 利得 48kHz +0.6910dB / 44.1kHz +0.6938dB、20Hz -13.27dB、10kHz +4.042dB / +4.046dB）
- `node --check` 全 `.js` / `.mjs`: PASS

### spec.md 変更
- なし

### 備考
- 実装: Sonnet サブエージェント
- 計画書の定数・擬似コードで受け入れテストはすべて合格。計画書にない判断なし（`MfsMelBank` の公開プロパティ名はテスト用に追加したもので §5.0 の API は変更していない）

---

## 2026-10-01 — [T15-06] FramePipeline への統合

### 作業内容
- `js/frame-pipeline.js`（新規）: `FramePipeline`（`resize` / `reset` / `dispose` / `fillBackground` / `render`）と `sliceLayerLinear` を追加。処理順は計画書 §4.3（タイプ同期 → 残像付きクリア＋動画合成 → 色相 → ステートフル/ステートレス描画）で、旧 `VisualizerCore` / `OfflineExporter` の順序を保持。`frame.getLayer` は constructor で作る束縛関数1つを使い回し、`frame` オブジェクトも使い回す
- `js/visualizer-core.js`: rAF ループ・`resize()`・`start/stop`・`input` 組み立て・動画要素の描画関数（`drawBackground`）のみ残し、`_syncRenderer` / `_clearWithAfterimage` / `_renderStateful` / `_renderStateless` / `_applyPhysics` / `_ensureHistory` / `_huePhase` を削除。`_fillBackground()` は `pipeline.fillBackground(this.settings)` へ委譲（名前・引数は不変）。`_activeType` は B15-03 が参照するため pipeline の値を返す読み取り専用 getter として残した
- `js/offline-exporter.js`: 書き出しごとに `new FramePipeline(canvas, ctx)` を作り、`finally` で `dispose()`（中断・失敗時も破棄）。`_renderStateless` / `_applyPhysics` / `_clearFrame` / `_sliceLayer` とフレームループ内の色相計算・履歴・BeatDetector を削除。`frameAt()` を先に `await` して `drawBackground` のクロージャで描く。粘性揺らぎ状態は書き出しごとに初期化される（従来は書き出しをまたいで残っていた）
- `index.html`: `js/frame-pipeline.js` を `js/renderer-registry.js` の直後に追加
- `tests/browser/golden.test.js`: `pipeline` ドライバ（計画書 §3.6.4）へ切替え、`visualizer-core` ドライバと rAF / `performance.now` の差し替えを削除。`tests/golden/frames.json` は未変更
- `tests/browser/b15-05.test.js`（新規）: B15-05
- 意図的な振る舞い変更（計画書 §4.4 の1件のみ）: 色相連続変化を `huePhase += speed * 0.5 * (dtMs / 16.7)` の経過時間基準に統一

### 検証
- `node tests/run.mjs`: 30 件 / 29 成功 / 0 失敗 / 1 スキップ（U15-00 異常系）
- B15-04: `pipeline` ドライバが既存 `tests/golden/frames.json`（再生成なし）と全66ケースで一致。比較しきい値を一時的に 0（平均差 0・最大差 0）へ締めても合格＝ビット一致（確認後に元へ戻した）
- B15-05: `FramePipeline.prototype.render` の呼び出し回数 = 書き出し映像フレーム数、旧メソッドが `OfflineExporter` に残っていないことを確認 — 合格
- B15-02 / B15-03 / B15-07 / B15-01: 合格
- 全 `.js` / `.mjs` に `node --check`: 成功
- `index.html` を `file://` で開いたコンソールエラー: 0（headless Chrome 154）
- 手動確認 §7.3（自動化できた範囲）: PR 本文に記載

### spec.md 変更
- v2.7 → v2.8（2026-10-01）。§12.1: 色相連続変化の速度は表示のリフレッシュレートに依存せず、ライブと書き出しで同じ。§16.3: 描画処理はライブ・書き出しで共通の `FramePipeline` を通る。README の色相連続変化の記述も更新

### 備考
- 実装: Sonnet サブエージェント（レビュー・マージはアーキテクト）
- `_ensureHistory` の履歴フレーム長は `freq.length`（旧ライブは `audioEngine.freqSliceLength()`）。`freq` が null のときは新規確保せず既存履歴を返す（旧ライブで長さ 0 のとき null を返したのと同等）
- 旧オフラインのみあった `settings.historySeconds` 未定義時の既定 4 秒と `afterimageIntensity || 0` を共通化（ライブ側は未定義にならないため見た目は不変）

---

## 2026-09-30 — [T15-09] CI・PR テンプレート

### 作業内容
- `.github/workflows/test.yml`: GitHub Actionsで `pull_request` と `main` への push 時に Node.js 22 と Chrome を使い、`node tests/run.mjs` を実行するCIを追加。失敗時の `tests/output/` アーティファクト保存を設定
- `.github/pull_request_template.md`: チケット・変更内容・検証の記入欄、「完了の定義」はガイド §7 を貼るよう1行で案内（計画書 §3.7 どおり、チェックリスト本文は複製しない）
- `README.md`: 開発者向けテスト節にCIの実行条件を追記

### 検証
- YAML構文チェック（Node.jsの簡易パーサー）: PASS
- `node tests/run.mjs --unit`: PASS
- `node --check`（全 `.js` / `.mjs`）: PASS
- 実装環境（サンドボックス）では Chrome が起動できずブラウザテスト未実施
- CI 上での全件実行は、この PR 自体のワークフロー実行で確認（PR 参照）

### spec.md 変更
- なし（T15-09の指定どおり）

### 備考
- `.gitignore` は既に `tests/output/` と `tests/.generated/` を含むため変更していない
- 実装は Codex。レビューで PR テンプレートを計画書 §3.7 に合わせて修正（チェックリスト本文の複製をやめ、ガイドを参照する1行の案内に変更）。コミット・PR は Claude が担当

---

## 2026-09-30 — [T15-05] ゴールデン基準値の作成

### 作業内容
- `tests/shared/golden-cases.js`: 全14タイプ、背景2種、解像度2種の基本56ケースと追加10ケースを定義
- `tests/browser/golden.test.js`: `visualizer-core` ドライバで60フレームを描画し、19・39・59フレームの10pxブロック平均サムネイルを比較する B15-04 を追加
- `tests/lib/png.mjs` / `tests/unit/png.test.mjs`: Node 標準 `node:zlib` のみで RGBA PNG を生成する機能と単体テストを追加
- `tests/run.mjs`: `--update-golden` による `tests/golden/frames.json` の生成、ゴールデン差分画像の `tests/output/golden/` への出力を追加

### 検証
- `node tests/run.mjs --unit`: 20 成功 / 0 失敗 / 1 スキップ（U15-00 異常系）
- 全 `.js` / `.mjs` に `node --check`: 成功
- 実装環境（サンドボックス）では Chrome が起動できずブラウザ実行は未実施
- レビュアーが macOS（Chrome 154 / Node 26）で T15-10 の取り込み後に実行
  - `--update-golden` を2回実行し、`tests/golden/frames.json` がバイト単位で一致（決定的）
  - `node tests/run.mjs`: 28 PASS / 0 FAIL / 1 SKIP。B15-04 は全66ケースで一致・非空とも合格
  - 基準値を意図的に壊すと B15-04 が失敗し、`tests/output/golden/` に expected / actual / full の PNG が出力されることを確認

### spec.md 変更
- なし（T15-05 の指定どおり）。非空判定のしきい値は T15-10 で計画書を 0.1 に変更済み

### 備考
- ゴールデン生成と比較の詳細は計画書 §3.6.2〜§3.6.4 に従い、T15-06 でドライバだけを `pipeline` に差し替えられる構造にした
- 初回の基準値作成で、白背景の粒子・ノイズフロー・波紋が描画されない不具合と、疎らな描画が非空判定 1.0 に届かない問題が判明。オーナー決定により、T15-10 で不具合を修正し、しきい値を 0.1 にしてから基準値を作成した
- 実装は Codex。レビュアーが2点を修正した（パッチが途中までしか当たっておらず `--update-golden` を受け付けなかった問題、非空判定のしきい値の定数化）。基準値の生成・コミット・PR は Claude が担当

---

## 2026-09-30 — [T15-10] 白背景での加算合成の修正

### 作業内容
- `js/renderers/particles.js`: `ParticlesRenderer` と `FlowRenderer` が白背景で `multiply`、それ以外で `lighter` を使うよう変更
- `js/renderers/ripple.js`: `RippleRenderer` が白背景で `multiply`、それ以外で `lighter` を使うよう変更
- `tests/browser/b15-07.test.js`: 320×180・60フレームの VisualizerCore 描画で、白背景の非空判定と黒背景の `lighter` 維持を検証する B15-07 を追加

### 検証
- `node tests/run.mjs --unit`: 18件成功 / 0件失敗 / 1件スキップ（U15-00 異常系）
- `node --check`（変更した全 `.js` / `.mjs`）: 3ファイル PASS
- 実装環境（サンドボックス）では Chrome が起動できずブラウザテスト未実施
- レビュアーが macOS（Chrome 154 / Node 26）で実行: `node tests/run.mjs` 25 PASS / 0 FAIL / 1 SKIP（B15-07 含む）。`index.html` を `file://` で開きコンソールエラー 0

### spec.md 変更
- `doc/spec.md` §11.1 に白背景では粒子・ノイズフロー・波紋を `multiply` で描画する記述を追加（v2.7）。T15-05 のゴールデン基準作成中に白背景で表示されない不具合が判明し、Phase 15 内で修正する owner 決定による
- 計画書に T15-10 を追加し、T15-05 の前提に T15-10 を追加。非空判定の閾値を owner 決定で `1.0` から `0.1` に変更

### 備考
- `js/offline-exporter.js` に対象3タイプの重複した合成ロジックはなかった
- README.md は黒/白背景の動作を説明していないため変更していない
- 実装は Codex、spec・計画書の変更とレビュー・検証・コミット・PR は Claude が担当


## 2026-09-30 — [T15-07] 既存機能の回帰テスト

### 作業内容
- `tests/browser/b15-01.test.js`: `OfflineAudioContext` 上の決定的な合成音を使い、AnalyserNode と `SpectrumAnalyzer` の周波数データを2048サンプル境界で比較する B15-01 を追加
- `tests/browser/regression.test.js`: `sigDrumPattern` のWAVを `OfflineExporter.export` へ渡し、完了状態・Blob・自前デマルチプレクサの映像フレーム数を確認する B15-02、およびアプリのWAV読込・再生中に全14タイプをUIから切り替える B15-03 を追加

### 検証
- `node tests/run.mjs --unit`: 18件成功 / 0件失敗 / 1件スキップ（U15-00 異常系）
- `node --check`（全 `.js` / `.mjs`）: 55ファイル PASS
- 実装環境（サンドボックス）では Chrome が起動できずブラウザテスト未実施
- レビュアーが macOS（Chrome 154 / Node 26）で `node tests/run.mjs --browser` を実行: B15-01 / B15-02 / B15-03 すべて PASS（B15-02 は約1.4秒、B15-03 は約7秒）

### spec.md 変更
- なし（T15-07 の指定どおり）。計画書 Phase 15 §6 の T15-07 成果物欄を分割後のファイル名に更新

### 備考
- 計画書 §6 の成果物 regression.test.js を、ページ種別に合わせて b15-01.test.js（harness）と regression.test.js（app）に分割（アーキテクト承認）
- `js/` および `index.html` は変更していない
- 実装は Codex、レビュー・ブラウザ検証・コミット・PR は Claude が担当

## 2026-09-29 — [T15-03] ブラウザテストハーネス

### 作業内容
- `tests/lib/harness-builder.mjs`: `index.html` の script src を出現順に抽出し、`js/app.js` を除いた生成ハーネスを `tests/.generated/harness.html` に出力する機能を追加
- `tests/browser/lib/avz-test.js`: ブラウザテスト登録、アサーション、タイムアウト、console.error / 未捕捉例外の失敗判定、成果物保存情報、意図的な失敗ケースの判定（通常は反転判定、`B15-00` 指定時は生の判定）を追加
- `tests/browser/b15-00.test.js`: B15-00 の成功・意図的失敗・console.error の3テストを追加
- `tests/run.mjs`: `tests/browser/*.test.js` のページ種別検出、ハーネス/app の実行、結果集計、`--skip-slow`、意図的な失敗ケースの切り替えを追加。従来のハードコード smoke test を置換
- `tests/unit/harness-builder.test.mjs`: ハーネスの script 順・相対パス・`app.js` 除外を検証する単体テストを追加
- `README.md`: ブラウザテストの検出方法、生成ハーネス、B15-00 の生の判定を確認するコマンドを追記

### 検証
- 実装環境（サンドボックス）: `node tests/run.mjs --unit` PASS、`node --check` PASS。Chrome が起動できずブラウザ実行は未実施
- 2026-09-30 レビュアーが macOS（Chrome 154 / Node 26）で実行
  - `node tests/run.mjs`: ブラウザの B15-00 は、正常系 PASS、意図的な失敗2件が「期待どおり失敗」で PASS。全体で 0 失敗
  - `node tests/run.mjs --browser --filter 'B15-00'`: pass / fail / fail（計画書 §7.2 どおり）

### spec.md 変更
- なし（T15-03 の指定どおり）

### 備考
- `expectedFailure` を付けたテストは、通常実行でも毎回走らせて判定を反転する（失敗を検知できれば pass）。こうすると CI でも失敗検知の仕組みを毎回確かめられる。`--filter` の文字列に `B15-00` を含めるか `AVZ_RUNNER_INCLUDE_EXPECTED_FAILURE=1` を指定したときは、反転せず生の判定を出す
- 実装は Codex、レビュー・修正・push・PR は Claude が担当。レビューで3点を修正した（ハーネステストの ID を誤った U15-03 から B15-00 に変更、意図的な失敗ケースを skip から反転判定に変更、フィルターによる有効化を `B15-00` の明示指定に限定）
- `js/` および `index.html` は変更していない

---

## 2026-09-29 — [T15-02] Node 単体テストの整備

### 作業内容
- tests/unit/settings-io.test.mjs: 設定シリアライズ往復と不正入力の既定値フォールバックを追加
- tests/unit/history-buffer.test.mjs: push / get(age) / 容量超過 / setFrameLength / 範囲外取得を追加
- tests/unit/vis-utils.test.mjs: 固定乱数列と computeFreqRange の受け入れテストを追加
- tests/unit/fft.test.mjs: シード固定5入力と倍精度の素朴な DFT 参照値の比較を追加
- tests/unit/webm-roundtrip.test.mjs: 映像30チャンク・キーフレーム・音声を含む WebM 往復テストを追加
- tests/unit/mp4-roundtrip.test.mjs: 映像30チャンク・キーフレーム・音声を含む MP4 往復テストを追加

### 検証
- node tests/run.mjs --unit: 12 成功 / 0 失敗 / 1 スキップ（U15-00 異常系 SKIP）
- 全 .js / .mjs 45 ファイルの node --check: PASS
- Chrome ブラウザテスト: 実装環境のサンドボックスでは実行せず
- レビュアーが macOS（Chrome 154 / Node 26）で `node tests/run.mjs` を全件実行（T15-04 取り込み後）: 20 PASS / 0 FAIL / 1 SKIP（U15-00 異常系）

### spec.md 変更
- なし（T15-02 の指定どおり）

### 備考
- 計画書 §7.1 の U15-01〜U15-06 のみを実装。js/ と index.html は変更していない
- 実装は Codex、レビュー・push・PR は Claude が担当

---

## 2026-09-29 — [T15-04] 合成信号・WAV ライブラリ

### 作業内容
- tests/shared/signals.js: Phase 15 §3.5 の決定的な正弦波、ノイズ、クリック、ドラム、和音、ミックス、連結、描画フレーム合成を追加（`sigScaleToLufs` は計画書どおり T16-04 で追加）
- tests/shared/wav.js: PcmBuffer を RIFF/WAVE PCM 16bit little-endian にエンコードする機能を追加
- tests/unit/signals.test.mjs: U15-07 の決定性、クリック位置、パンなしステレオを追加
- tests/unit/wav.test.mjs: U15-08 の44バイトヘッダーと±32767クランプを追加

### 検証
- `node tests/run.mjs --unit`: U15-00 異常系 SKIP、その他6件 PASS、失敗0件
- `node --check`（変更した全 JS / MJS）: PASS
- レビュアーが macOS（Chrome 154 / Node 26）で `node tests/run.mjs` を全件実行: 9 PASS / 0 FAIL / 1 SKIP（U15-00 異常系）

### spec.md 変更
- なし（T15-04 の指定どおり）

### 備考
- 実装は Phase 15 §3.5 および後続計画書が参照する関数名・引数に従った
- 実装は Codex、レビュー・コミットは Claude が担当。レビューで T16-04 範囲の `sigScaleToLufs` を削除し、U15-07 に「クリック開始1サンプル前は無音」の確認を追加

---

## 2026-09-28 — [T15-01] テストランナー骨格

### 作業内容
- tests/run.mjs: Node 標準のテストランナーとブラウザテスト実行の入口、フィルター、レポート出力を追加
- tests/lib/load-classic.mjs: classic script を Node VM コンテキストで順に読み込む機能を追加
- tests/lib/chrome.mjs: Chrome / Chromium の検出、CDP 接続、評価、ページ遷移、ブラウザーエラー収集を追加
- tests/unit/runner.test.mjs: ランナーの正常系・意図的失敗系を追加
- .gitignore: 生成ハーネスとテスト出力を除外
- README.md: 開発者向けのテスト実行方法を追加

### 検証
- node tests/run.mjs --unit: 正常系 PASS、意図的失敗系 SKIP、終了コード 0
- node tests/run.mjs --unit --filter 'U15-00 正常系': PASS、終了コード 0
- node tests/run.mjs --unit --filter 'U15-00 異常系': FAIL、終了コード 1（期待どおり）
- 変更した全 JavaScript / MJS ファイルの node --check: PASS
- 初回実装環境（サンドボックス）では Unix domain socket 禁止により Chrome が起動できず B15-00 未実行
- 2026-09-29 macOS（Chrome 154 / Node 26）: 終了処理で ENOTEMPTY（Chrome 終了前にプロファイル削除）を検出し修正。修正後 node tests/run.mjs を3回実行し、いずれも 0 失敗・終了コード 0（U15-00 異常系は SKIP）

### spec.md 変更
- なし（T15-01 の指定どおり）

### 備考
- PR #32 の実装計画書に基づく初回チケット。T15-01 の前提チケットはなし
- 実装は Codex、レビュー・ブラウザ検証は Claude が担当

---

## 2026-09-28 — 実装計画書（Phase 15・16・18）の作成（実装なし）

### 作業内容
- オーナーが進化構想の判断事項 D1〜D6 をすべて推奨案で承認（ブラウザ標準 API は使用可 / 自動演出を主軸 / 9:16 追加 / 解析を AudioWorklet に一本化 / テストをリポジトリ内に配置 / 15→16→18 の順で着手）
- 実装は外注のため、実装者によって結果が変わらないことを目的に、次の文書を唯一の正（SSOT）として作成
  - `doc/20260928-implementation-guide-for-contractors.md`: 文書体系と SSOT 規則、不変条件、作業フロー（1チケット=1ブランチ=1PR）、質問・仕様変更の手順、完了の定義、コーディング規約、難易度表記
  - `doc/20260928-plan-phase15-test-foundation-and-frame-pipeline.md`: Node 標準機能＋Chrome DevTools Protocol による依存ゼロのテスト基盤、ゴールデンフレーム（66ケース）、ライブ/書き出しで複製されていた描画処理の `FramePipeline` への統合、デバッグ表示、CI。チケット 9 件
  - `doc/20260928-plan-phase16-music-feature-stream.md`: 定数表（値の唯一の正）、特徴データ配置（104要素）、アルゴリズムの擬似コード（メル帯域・オンセット・テンポ/拍位相/小節・ステレオ・音色・クロマ・BS.1770 ラウドネス・音量自動補正）、ワークレットのメッセージ仕様、出力遅延補正、オフラインのフレーム確定規則。チケット 11 件
  - `doc/20260928-plan-phase18-song-map-and-auto-director.md`: ソングマップ解析（拍・一定テンポ格子・小節頭・境界・ラベル・展開の種類）、自動演出（タイムラインの事前コンパイルと時刻からの状態評価、シーンカタログ、クロスフェード、フラッシュ上限）、テスト用合成楽曲の生成手順。チケット 10 件
- アルゴリズムの受け入れ基準が達成可能であることを、計画書どおりの試作（リポジトリ外）で検証し、結果を各計画書の「設計検証の記録」に残した
- `README.md` の開発ドキュメント表に4文書を追加。構想書のステータスを承認済みに更新

### 検証（試作による設計検証）
- Phase 16: テンポ推定 32/32 条件・62〜198BPM スイープ 70/70・小節頭 93/93・オンセット 32/32（誤検出0）で合格。K 特性係数が BS.1770 公式値と一致（0dBFS 997Hz 片ch = -3.010 LUFS）
- Phase 18: 合成楽曲 8 条件（100/128/140/174BPM × 48k/44.1k）で拍・小節頭・境界・種類・ラベルすべて合格。テンポ変化曲で DP へ自動切替
- ヘッドレス Chromium で OfflineAudioContext・AudioWorklet（data: URL）・リアルタイム AudioContext・`getOutputTimestamp()`・WebCodecs が動作することを確認（テスト基盤の前提）

### spec.md 変更
- version `v2.5` → `v2.6`
- §2.1: ブラウザ標準 API は外部ライブラリに当たらない旨（D1）
- §11.2・§25: 9:16 は Phase 21 で追加予定（D3）
- §16.5 新設: テストの方針（D5）
- §20: 「Phase 15〜18: 計画済み（未実装）」を追加（D4・D6）
- §23: 進化構想への参照を追加
- 理由: オーナー決定を仕様へ反映するため

- 実装者視点の第三者レビュー（重大6・中12・軽微4件）を実施し、全件を計画書へ反映: クラス API 表と1ホップの処理順の一本化、初期値の明記、合成テスト信号の式の完全定義、ライブのフラグ集約の二重発火防止、レイヤー切り出し経路の一本化（毎フレーム生成の排除）、プリセット適用範囲を演出管理キーに限定（色がユーザー設定のまま保たれる）、チケット依存とファイル衝突の整理、観測用アクセサ（`getMfsDebugInfo`・`FramePipeline.lastFreq`）の追加、Node 要件を 22.4 以上に修正 など

### 備考
- 検証の結果、構想から次を変更: ① テンポ推定を 0.25BPM 刻み＋半周期項に変更、② 小節頭推定の蓄積方式を修正、③ K 特性を libebur128 方式の係数式に変更、④ ソングマップの拍に一定テンポ格子を導入、⑤ 調（キー）推定を Phase 18 のスコープから除外
- Phase 17・19〜21 は構想段階のまま。Phase 18 完了時にオーナーが着手を判断する

---

## 2026-09-28 — 超進化構想書の作成（実装なし）

### 作業内容
- `doc/20260928-evolution-concept-music-understanding-visual-engine.md` を新規作成
  - 根本コンセプトの不変条件（C1〜C7）を `doc/spec.md` §2・§24・§25 から抽出
  - 現状の資産（決定的オフライン書き出し・レンダラー契約・依存ゼロ）と天井（8bit/線形帯域/モノラル解析、テンポ・構造未把握、Canvas 2D 上限、ライブ/オフライン経路の分離、テストのリポジトリ外管理）を診断
  - 進化案を「聴く（Music Feature Stream）/ 繋ぐ（モジュレーション）/ 描く（WebGL2）/ 演じる（自動演出・MIDI・タイムライン）/ 届ける（出力強化）/ 基盤」に整理
  - Phase 15〜21 のロードマップ案・テスト設計要約・除外事項・オーナー判断事項（D1〜D6）を記載
- `README.md` の開発ドキュメント表に構想書を追加

### 備考
- オーナー指示により実装は未着手。判断事項の回答後、フェーズごとに計画書を作成して `doc/spec.md` に反映する

---

## 2026-07-18 — Phase 14.2 MP4 デマルチプレクサ対応

### 作業内容
Phase 14.1（WebM）に続き、`doc/plan-phase14.md` §4 の設計に基づいて MP4（ISOBMFF）のデマルチプレクサを実装し、MP4 入力でもデコーダー方式の動画合成が使えるようにした。これで `doc/spec.md` §23 の実装可能な残候補はすべて完了。

#### 新規ファイル
- `js/mp4-demuxer.js`: 自前 ISOBMFF デマルチプレクサ（`js/mp4-muxer.js` の読み取り側対応物）
  - progressive MP4: `stbl` のサンプルテーブル（`stts`/`ctts`/`stss`/`stsc`/`stsz`/`stco`/`co64`）からサンプル列を構築
  - fragmented MP4: `mvex>trex` の既定値 + `moof>traf`（`tfhd`/`tfdt`/`trun`、base-data-offset / default-base-is-moof / first-sample-flags 対応）を走査
  - サンプルエントリ `avc1`/`avc3` の `avcC` を抽出して `VideoDecoder` の `description` に使用。コーデック文字列（`avc1.PPCCLL`）は `avcC` の profile/compat/level から導出
  - pts（dts + `ctts` オフセット、version 0/1 両対応）は tick 領域で最小値0へ正規化してから μs 変換（丸め誤差の回避。実装時に丸め後正規化のずれをテストで検出して修正）
  - 非対応入力は例外を投げ、呼び出し側がフォールバックする
- `js/offline-exporter.js`: `_createDecoderCompositeSource()` が WebmDemuxer → Mp4Demuxer の順に解析を試み、`description` があれば `VideoDecoder` 設定へ渡すよう拡張
- `index.html`: `js/mp4-demuxer.js` の `<script>` タグを追加

### 検証
- 全JS `node --check` パス
- Node 単体（新規 `test-mp4-demuxer.mjs`、15アサーション全パス）:
  - fragmented: `mp4-muxer.js` の出力（映像65チャンク+音声混在）を読み戻し、チャンクバイト列・キーフレーム・pts（±1μs）・`avcC` の完全往復一致、音声トラックの無視を検証
  - progressive: 手組みの moov+mdat（`ctts` によるBフレーム風の提示順オフセット・`stss` キーフレーム・`stsc` のチャンク切替・2チャンク配置）でサンプル抽出と pts 正規化を厳密検証
  - 不正データ / WebM ヘッダーでの例外
- Chromium実ブラウザE2E（新規 `phase14-2-e2e.mjs`）: ①ブラウザ内で `Mp4Demuxer` が自前ミュクサ出力を正しく解析（コーデック・チャンク数・キーフレーム数・description）、②この環境の Chromium は H.264 デコード非対応（`isConfigSupported` false）であり、その場合デコーダーソースが null になりシーク方式へ正しく譲ること、③ダミーMP4の書き出しがハングせずエラー状態で終了すること、を確認。コンソールエラー0
- 既存回帰: Phase 14.1 E2E（WebM は引き続きデコーダー方式が選択される・優先順維持）・Phase 10.2 動画合成・オフライン書き出し（通常/4バリアント）・全14タイプ切替・mp4-muxer/webm-demuxer 構造テスト、すべてパス

### spec.md 変更
- version `v2.4` → `v2.5`
- §14.8.2 のデコーダー方式に MP4（AVC）対応を追記
- §20 に「Phase 14.2: MP4 デマルチプレクサ対応（実装済み）」を追加
- §23 を更新（残候補はモバイル録画品質のみ）
- 理由: 対応コンテナの拡大を仕様に反映するため

### 備考
- H.264 の実デコードを伴う E2E は開発環境の Chromium（H.264 デコーダー非搭載）では実行できないため、構造レベルの完全検証（往復一致・手組みフィクスチャ）+ フォールバック動作の実機確認で品質を担保した。実 H.264 環境ではデコード失敗時もフレーム単位でシーク方式へ自動フォールバックする安全網がある

---

## 2026-07-18 — Phase 14.1 オフライン書き出しの動画デコード高速化

### 作業内容
`doc/spec.md` §23 残候補「オフライン書き出しの動画デコード高速化」を `doc/plan-phase14.md` を作成して実装した。Phase 10.2 の動画合成は各出力フレームごとの `currentTime` シーク方式（実時間シーク待ちが累積する）だったのを、WebM は WebCodecs `VideoDecoder` による直接デコードへ切り替えた。

#### 新規ファイル
- `js/webm-demuxer.js`: 自前 WebM/EBML デマルチプレクサ（`js/webm-muxer.js` の読み取り側対応物）。映像トラックの符号化チャンク列（データ・タイムスタンプ・キーフレーム）とコーデック・解像度を取り出す。`MediaRecorder` のストリーミング出力特有の**不定長 Segment/Cluster**（「次の同レベル要素 ID の出現 or EOF まで」で終端判定）、`SimpleBlock` と `BlockGroup>Block+ReferenceBlock` の両形式、`V_VP8`/`V_VP9` に対応。非対応入力は例外を投げ、呼び出し側がフォールバックする

#### 変更ファイル
- `js/offline-exporter.js`:
  - 動画合成のフレーム取得を `{type, frameAt(tSec), dispose()}` インターフェースへ抽象化し、**デコーダー方式**（優先）と**シーク方式**(既存・フォールバック)の2実装に分離
  - デコーダー方式: デマルチプレクサ出力を `VideoDecoder` へ順次供給。WebM（VP8/VP9）は B フレームが無く提示順=デコード順のため「目標時刻を超える出力が現れるまで先読み」する単純な戦略で済む。使用済み `VideoFrame` は即 `close()`、供給は `decodeQueueSize < 16` に制限してメモリを管理。無応答時のストール検出（5秒）付き
  - 初期化失敗（非WebM等）は準備段階で、デコード途中の失敗はフレーム単位で捕捉し、どちらもシーク方式へ自動フォールバック。診断用に `_lastCompositeSourceType` を公開
  - `_drawCompositeVideoFrame()` を `<video>`（`videoWidth`）と `VideoFrame`（`displayWidth`）の両対応に一般化
- `index.html`: `js/webm-demuxer.js` の `<script>` タグを追加

### 検証
- 全JS `node --check` パス
- Node 単体（新規 `test-webm-demuxer.mjs`、11アサーション全パス）: `webm-muxer.js` の出力（映像95チャンク+音声混在）を読み戻し、**チャンクバイト列・タイムスタンプ・キーフレームの完全往復一致**、音声トラックの正しい無視、VP9 のコーデック判定、不正データ/MP4ヘッダーでの例外を検証
- Chromium実ブラウザE2E（新規 `phase14-e2e.mjs`）: `MediaRecorder` 実出力（不定長要素を含む4秒WebM）で ①デコーダー方式が実際に選択される（`_lastCompositeSourceType === 'decoder'`）、②合成結果のピクセル検証（マゼンタ約99.4%、Phase 10.2 と同一基準）、③デマルチプレクサを強制失敗させるとシーク方式で完走し同等の結果（99.4%）、④デコーダー方式がシーク方式より高速、を確認。コンソールエラー0
- 既存回帰: Phase 10.2 動画合成E2E（今回からデコーダー経路で実行）・オフライン書き出し（通常/4バリアント）・Phase 9.2 解析比較・全14タイプ切替・Phase 8/10.1/12 E2E・webm-muxer構造テスト、すべてパス

### spec.md 変更
- version `v2.3` → `v2.4`
- §14.8.2 を「デコーダー方式（優先）+ シーク方式（フォールバック）」の2経路構成に更新
- §20 に「Phase 14.1: オフライン書き出しの動画デコード高速化（実装済み）」を追加
- §23 を更新（残候補は MP4 デマルチプレクサ対応（Phase 14.2・設計記録済み）とモバイル録画品質のみ）
- 理由: 処理方式の変更を仕様に反映するため

### 備考
- MP4 の直接デコード（Phase 14.2）は `doc/plan-phase14.md` §4 に設計（stbl/moof 走査・avcC・提示順並べ替え）を記録した。現状 MP4 はシーク方式で正しく動作するため機能欠落はない

---

## 2026-07-18 — Phase 13 モバイルレイアウト対応

### 作業内容
`doc/spec.md` §23 残候補「スマートフォンでの操作性改善」のうち、レイアウト面を CSS のみの変更で実装した（JS 変更なし。キャンバスは既存の `resize()` がコンテナ追従のため自動対応）。

#### 変更ファイル
- `style.css`:
  - 狭幅画面（`max-width: 700px`）で縦積みレイアウトへ切替（上: ビジュアライザー 44dvh / 下: 操作パネル全幅・ページスクロール）
  - タッチターゲット拡大（ボタン最小38px・セレクト36px・スライダー32px・チェックボックス18px）
  - `touch-action: manipulation` でダブルタップズーム遅延を無効化
  - `height: 100vh` → `100dvh`（フォールバック付き）でモバイルブラウザのアドレスバー変動に追従
  - iOS セーフエリア（`env(safe-area-inset-bottom)`）を操作パネル下部余白に反映

### 検証
- Chromium実ブラウザE2E（新規 `phase13-e2e.mjs`）: モバイルビューポート（390×844, isMobile/hasTouch）で ①`#app` が縦積み（flex-direction: column）、②操作パネルが全幅、③キャンバスがビューポート幅に収まる、④横スクロールが発生しない、⑤ボタン高さ38px以上、⑥縦スクロールで全コントロールへ到達可能、を確認。デスクトップビューポート（1280×720）では従来の2カラム（パネル幅220px）のままであることも確認。コンソールエラー0
- デスクトップ回帰: 全14タイプ切替・Phase 11/12 E2E がパス（CSSのみの変更でJS挙動に影響なし）

### spec.md 変更
- version `v2.2` → `v2.3`
- §2.3 対象環境にモバイルレイアウト対応の旨を追記
- §20 に「Phase 13: モバイルレイアウト対応（実装済み）」を追加
- §23 を更新（残候補は `VideoDecoder` 高速化とモバイル録画品質のみ。いずれも規模・実装依存の注記付き）
- 理由: 対象環境の変更を仕様に反映するため

### 備考
- README の「スマホでの利用について」から旧レイアウト制約の記述を削除した

---

## 2026-07-18 — Phase 12 3スロット再生キュー（旧 Phase 4 の再実装）

### 作業内容
2026-04-14 に実装中止した旧 Phase 4（3スロット再生キュー）を、仕様書内に保持されてきた `doc/spec.md` §8 に従い `doc/plan-phase12.md` を作成して再実装した。§23 残候補「再生スロットのプレイリスト化」に対応。

#### 変更ファイル
- `js/media-manager.js`: 単一 `mediaElement` 管理から3スロット管理（`slots[3]` + `activeIndex`）へ全面改修。`loadFile(file, slotIndex)`（省略時アクティブ・既存互換）/ `selectSlot()` / `clearSlot()` / `advance(dir)`（±方向の循環探索）を追加。`mediaElement` / `isLoaded` / `isPlaying` はアクティブスロットを指す getter として互換維持。読込失敗時は旧スロット内容を保持する（従来は読込前に破棄していた）。`ended` はアクティブ要素からのみ通知（`mediaElement === el` 判定で、破棄時 `src=''` による誤発火を防止）
- `js/audio-engine.js`: `connectMedia()` が要素→`MediaElementSourceNode` を `WeakMap` でキャッシュ。`createMediaElementSource` は同一要素へ2回呼ぶと例外になるため、スロット再選択時にキャッシュを再利用する
- `js/ui-controller.js`:
  - ファイルセクションに3スロット行（番号/ファイル名/種別/アクティブ表示 + 読込/選択/削除）を追加。共有 `file-input` に `_loadTargetSlot` で読込先を指定
  - 再生セクションに `次へ` / `前へ` を追加（`advance(±1)`。再生中なら切替後も再生継続）
  - スロット切替時の表示反映（ファイル名/再生可否/動画合成対象/シーク・音量リスナー）を `_applyActiveSlot()` に集約
  - `_onEnded()`: 再生モードでは次の設定済みスロットへ自動循環（§8.2/8.3。1スロットのみならループ再生）。録画モードは現行どおり停止
  - 録画中（`recorder.state === 'recording'`）はスロット操作・次へ/前へを受け付けない
- `index.html` / `style.css`: スロットUI・次へ/前へボタンとスタイル

### 検証
- 全JS `node --check` パス
- Chromium実ブラウザE2E（新規 `phase12-e2e.mjs`）: ①ファイル選択経路でスロット1へ読込（行表示・種別「音声」・アクティブ表示）、②スロット行「読込」経路でスロット2へ読込（アクティブ・ファイル名表示はスロット1のまま）、③1秒音源の再生終了でスロット2へ自動循環し再生継続・表示追従、④「次へ」でスロット2→1へ循環・「前へ」で1→2、⑤非アクティブ削除で行リセット・アクティブ削除で「未選択」+再生無効化、⑥単一スロットのループ再生（終端を跨いで再生継続）、をすべて確認。コンソールエラー0
- 既存回帰: 全14タイプ切替・Phase 8/10.1/10.2/9.2/11 E2E・オフライン書き出し、いずれもコンソールエラー0でパス（`media-manager.js` 全面改修による既存経路への影響なし）

### spec.md 変更
- version `v2.1` → `v2.2`
- §8 に実装済みの旨と解釈の明確化（録画モードの扱い・単一スロットのループ）を追記
- §20 に「Phase 12: 3スロット再生キュー（実装済み）」を追加
- §23 から「再生スロットのプレイリスト化」を削除（実装済みのため）
- 理由: 中止フェーズの再実装を仕様体系に正式に反映するため

### 備考
- §23 の残候補は「オフライン書き出しの `VideoDecoder` 高速化」「スマートフォン対応改善」の2件

---

## 2026-07-18 — Phase 11 画質指定・再生操作性の向上

### 作業内容
Phase 8〜10 の全項目完了を受け、新たに `doc/plan-phase11.md` を作成して4項目を実装した。spec.md §23「今後の検討項目」の最後の未実装項目（画質指定録画）がこれで完了。

#### 11.1 画質指定（録画・オフライン書き出し）
- `js/recorder.js`: 画質プリセット（低/標準/高 = 0.08/0.15/0.25 bit/pixel/frame）と `setQuality()` を追加。`_videoBitrate()` は係数を適用し、下限/上限（6〜24Mbps）も標準比でスケール（低画質時に下限クリップで無効化されるのを防ぐ）
- `js/offline-exporter.js`: `export()` の `opts.quality` として受け取り、同じ算出式を適用
- `index.html`: 録画・オフライン書き出しの両セクションに画質セレクトを追加（独立に選択可能）

#### 11.2 再生シークバー・時間表示 / 11.3 音量調整
- `js/ui-controller.js`: 再生セクションにシークバー（0〜1000）と「現在位置 / 総時間」（mm:ss）表示、音量スライダー（0〜100%）を追加
- メディア要素はファイル読込ごとに作り直されるため、`timeupdate`/`durationchange`/`seeked` リスナーは読込成功時に毎回付け直す（`_attachMediaListeners`）。古い要素はリスナーごと破棄される
- シークバーのドラッグ中は `timeupdate` によるバー上書きを抑止。ファイル未読込・マイク入力中は無効化
- 音量はセッション内で保持し、次のファイル読込時にも適用（永続化はしない）

#### 11.4 ドラッグ&ドロップ読込
- ファイル選択の読込処理を `_loadMediaFile(file)` として抽出し、input change とドロップの両経路から共通利用
- `#visualizer-area` への `audio/`・`video/` ファイルのドロップで読込。ドラッグ中は破線ハイライト（`style.css`）。非対応ファイルは無視。マイク入力中のドロップはマイクを停止して切り替え

### 検証
- 全JS `node --check` パス
- Chromium実ブラウザE2E（新規 `phase11-e2e.mjs`）: ①読込前はシークバー無効→D&D読込後に有効、②ドラッグ中ハイライト表示/解除、③D&Dでファイル読込（ファイル名反映）、④シークバー操作で `currentTime` が50%位置へ移動し時間表示が「0:05 / 0:10」に追従、⑤音量30%が `element.volume` に反映されファイル切替後も維持、⑥画質プリセットで録画・オフライン両方の算出ビットレートが係数どおり変化、⑦テキストファイルのドロップは無視、をすべて確認。コンソールエラー0
- 画質の実出力反映: 同一音源のオフライン書き出しで高画質が低画質の約2.4倍のファイルサイズになることを確認
- 既存回帰: 全14タイプ切替・Phase 8/10.1/10.2/9.2 E2E・オフライン書き出し（通常/4バリアント）、いずれもコンソールエラー0でパス（ファイル読込経路のリファクタによる影響なし）

### spec.md 変更
- version `v2.0` → `v2.1`
- §14.4 / §14.8 に画質プリセットを追記
- §15.1 にシークバー・音量・ドラッグ&ドロップを追加
- §20 に「Phase 11: 画質指定・再生操作性の向上（実装済み）」を追加
- §23 を整理（初版候補は全実装済みのため、残候補を現状に合わせて更新）
- 理由: 新機能の仕様への組み込みと、検討項目リストの現行化のため

### 備考
- 次の候補は §23 の残項目（オフライン書き出しの `VideoDecoder` 高速化・スマホ対応改善・プレイリスト化）

---

## 2026-07-18 — Phase 9.2 AudioWorkletベース解析への移行

### 作業内容
`doc/plan-phase8.md` §9.2 に定めた「AudioWorklet ベース解析への移行」を実装した。オフライン書き出しの解析経路から非推奨APIの `ScriptProcessorNode` への依存を外し（フォールバックとしては維持）、AudioWorklet + 自前FFTを主経路とした。これをもって計画書（Phase 8〜10）の全項目が完了。

#### 新規ファイル
- `js/fft.js`: `SpectrumAnalyzer` クラス。Web Audio API 仕様の `AnalyserNode` と同じ手順（Blackman窓 α=0.16 → Radix-2 Cooley-Tukey FFT（1/N 正規化・回転因子/ビット反転テーブル事前計算）→ 線形振幅の時間平滑化EMA → dB変換 → minDecibels/maxDecibels による byte マッピング（切り捨て・クランプ））を自前実装。`getByteTimeDomainData` 互換の `timeDomainToBytes` も提供。ワークレット（別レルム）へ `toString()` で埋め込むため外部依存なしの自己完結実装
- `js/analysis-worklet.js`: `AudioWorkletProcessor` 実装のソースを生成し data: URL として返す。`file://` 直開きでは blob: URL の `addModule` が拒否されることを実測で確認したため（トリビアルなモジュールでも AbortError）、data: URL を採用。PCMをリングバッファへ蓄積し、2048サンプル境界でのみ FFT + 平滑化を実行して `port.postMessage` でフレームを送出（`ScriptProcessorNode` 版とスナップショット時刻・平滑化の進み方を完全に揃えるため）。全サンプル処理後に完了通知を送出する

#### 変更ファイル
- `js/offline-exporter.js`: `_analyze()` をデコード + 経路選択に再構成し、採取処理を `_captureFramesWorklet()`（主経路）/ `_captureFramesScriptProcessor()`（従来実装、フォールバック）へ分離。ワークレット側は `AudioWorkletNode` を `channelCount:1 / explicit / speakers` で構成し、`AnalyserNode` の解析時と同じ規則のモノラルダウンミックスをブラウザに任せる。`startRendering()` 解決後に port の完了通知（FIFOで全フレーム到着後に届く）を待ってから結果を確定する
- `index.html`: `js/fft.js`・`js/analysis-worklet.js` の `<script>` タグを追加

### 検証
- 全JS `node --check` パス
- `js/fft.js` 単体（Node, 19アサーション全パス）: 独立実装の素朴DFT（O(N²)・倍精度）を参照実装とし、正弦波のピークbin位置・Blackman窓の漏れ形状・期待振幅のbyte値・ランダム信号での全binバイト一致（誤差±1以内）・平滑化EMAの2フレーム連続一致・無音の全ゼロ・時間波形マッピングの境界値（クランプ/切り捨て）を検証
- Chromium実ブラウザE2E（新規 `phase9-2-e2e.mjs`）: **ワークレット版と ScriptProcessorNode 版（本物の `AnalyserNode`）を同一のステレオ音源（440/1320Hzトーン+エンベロープ+決定的ノイズ）で直接比較**。fps30/smoothing0.8 と fps29.97/smoothing0.5 の両条件で、フレーム数・フレーム時刻列は完全一致、時間波形バイト列は全フレーム完全一致（maxDiff 0）、周波数バイト列は maxDiff 1・平均誤差 0.00002（±1の量子化境界のみ）を確認
- 主経路の確認: `_captureFramesScriptProcessor` を強制的に例外にした状態でUIからの書き出しが完走することを確認（本番経路がワークレットであることの実証）
- 既存回帰: オフライン書き出しE2E（音声のみ/4バリアント/動画合成/MP4モック）・Phase 8/10.1 E2E・全14タイプ切替回帰・Node全テスト（foundation23/settings-io16/webm-muxer22/mp4-muxer39）、いずれもパス。バリアントの出力blobサイズが移行前と完全一致しており、解析出力の同一性が間接的にも裏付けられた

### spec.md 変更
- version `v1.9` → `v2.0`
- §14.8 の解析手順の記述を経路非依存の表現に変更し、§14.8.3「解析経路（Phase 9.2）」を新設
- §20 に「Phase 9.2: AudioWorkletベース解析への移行（実装済み）」を追加
- 理由: 解析経路の変更を仕様体系に正式に組み込むため

### 備考
- `doc/plan-phase8.md` の全フェーズ（8 / 9.1 / 9.2 / 10.1 / 10.2）が完了した

---

## 2026-07-18 — Phase 10.2 オフライン書き出しでの動画合成を追加

### 作業内容
`doc/plan-phase8.md` §10.2 に定めた「オフライン書き出しでの動画合成」を、同計画書の初版推奨方式（オフスクリーン `<video>` のシーク + `seeked` 待機）で実装した。

#### 変更ファイル
- `js/offline-exporter.js`:
  - `export()` から `_renderAndEncode()` へ書き出し対象の `File` を引き渡すよう変更
  - 対象が動画ファイル（`file.type` が `video/`）かつ `videoCompositeEnabled` かつ selfClear タイプでない場合、`_prepareCompositeVideo()` でオフスクリーン `<video>` を用意し、フレームループ内で `_seekCompositeVideo()`（`currentTime` 設定 → `seeked` 待機）→ `_drawCompositeVideoFrame()`（cover フィット + 不透明度 + 合成モード。`visualizer-core.js` の `_drawVideoComposite` と同一仕様）の順で背景合成する
  - 頑健性: 映像を取得できないファイルは合成なしで続行、シークできないフレームはタイムアウト（2秒）で先へ進む。後片付け（objectURL の revoke）は `finally` で保証しキャンセル時も漏れない
- `js/ui-controller.js`:
  - `_setVideoElement()` の表示制御を `_updateVideoCompositeVisibility()` へ分離し、表示条件を「ライブ動画読込中 **または** オフライン書き出し対象が動画ファイル」に拡張（オフライン書き出しだけで動画合成を使う場合にトグルへ到達できるようにするため）
  - オフラインファイル選択時に `_offlineFileIsVideo` を判定して表示を更新。どちらの対象もない場合は従来どおり設定を自動オフ

### 検証
- 全JS `node --check` パス
- Chromium実ブラウザE2E（新規 `phase10-2-e2e.mjs`）: 音声トラック（440Hzトーン）付きのマゼンタ単色動画をページ内で `MediaRecorder` 生成し、オフライン書き出しのファイルとして選択 → ①動画合成セクションが表示される、②合成有効で書き出した出力動画の中央フレームをデコード・ピクセル解析するとサンプル画素の約99%がマゼンタ（背景合成が機能）、③合成無効で書き出すとマゼンタ画素0%（対照実験）、をすべて確認。コンソールエラー0
- 既存回帰: オフライン書き出しE2E（音声のみ/4バリアント）・Phase 10.1ライブ動画合成E2E・Phase 8機能E2E・全14タイプ切替回帰、いずれもコンソールエラー0で既存と同結果（`_setVideoElement` 経路と `_renderAndEncode` 変更による影響なし）

### spec.md 変更
- version `v1.8` → `v1.9`
- §14.8.2「オフライン書き出しでの動画合成（Phase 10.2）」を新設
- §14.9 の「オフライン書き出しは対象外」の記述を §14.8.2 への参照に変更
- §20 に「Phase 10.2: オフライン書き出しでの動画合成（実装済み）」を追加
- 理由: 新機能を仕様体系に正式に組み込むため

### 備考
- 残る計画項目は Phase 9.2（AudioWorklet移行）のみ。`ScriptProcessorNode` は現状正常動作しており、置き換えにはFFT・窓関数・スムージングのworklet内自前実装が必要（`doc/plan-phase8.md` §9.2）

---

## 2026-07-18 — Phase 9.1 MP4対応オフライン書き出しを追加

### 作業内容
`doc/plan-phase8.md` Phase 9.1 に定めた「オフライン書き出しのMP4対応」を実装した。WebCodecsが対応していればMP4（H.264+AAC）で出力し、非対応環境ではWebM（VP9→VP8 + Opus）へ自動フォールバックする。

#### 新規ファイル
- `js/mp4-muxer.js`: 自前実装の fragmented MP4（fMP4）マクサー。`Mp4Muxer` クラスと `mp4TimescaleForFps(fps)` ヘルパーを公開する
  - `ftyp` / `moov`（`mvhd` / 映像・音声 `trak` / `mvex`）/ 映像キーフレームごとに区切った `moof`+`mdat` の断片群 / `mfra`（シーク索引）を構築する
  - 映像サンプルエントリは `avc1`+`avcC`、音声サンプルエントリは `mp4a`+`esds`（MPEG-4記述子: `ES_Descriptor`/`DecoderConfigDescriptor`/`DecoderSpecificInfo`/`SLConfigDescriptor`）
  - `avcC`・`AudioSpecificConfig` は手動でビットストリームを解析せず、WebCodecsの `EncodedVideoChunkMetadata.decoderConfig.description` からそのまま取得する
  - `trun.data_offset` と `mfra`の`moof_offset` は、WebMマクサーと同様「固定幅プレースホルダを先に書いてレイアウト確定後にパッチする」方式で解決する（ISOBMFFはフィールド幅が常に4バイト固定のため、WebM側のvint可変長対応より単純）
  - 29.97fps選択時は timescale=30000・サンプル長=1001 を正確に扱う

#### 変更ファイル
- `js/offline-exporter.js`:
  - コーデック候補を `OFFLINE_EXPORT_CONTAINER_CANDIDATES`（MP4優先→WebMフォールバックの5候補）に置き換え、`_selectContainer()` で `VideoEncoder.isConfigSupported()` により上から順に対応可否を判定する
  - 映像・音声それぞれのエンコーダ出力コールバックで `metadata.decoderConfig.description` を捕捉し、MP4選択時は `Mp4Muxer` へ、WebM選択時は既存の `WebmMuxer` へ渡す形に分岐
  - MP4選択時に `avcC` を取得できなかった場合はエラーとして中断するガードを追加
  - `_generateFilename()` を実際の出力Blobの `type` から拡張子（`.mp4`/`.webm`）を判定する方式に変更
- `index.html`: `js/mp4-muxer.js` の `<script>` タグを `webm-muxer.js` の直後・`offline-exporter.js` の直前に追加

### 検証
- 全JS `node --check` パス（`mp4-muxer.js`・`offline-exporter.js`）
- `js/mp4-muxer.js` 単体: 自作Node製ISOBMFFリーダーで **39アサーションすべて成功**（box構成・`mvhd`/`mdhd`のtimescale/duration・29.97fpsの正確なtimescale=30000/サンプル長=1001・`avcC`/`esds`のバイト完全一致・全`trun`サンプルの`data_offset`が`mdat`内の正しいバイト位置を指すこと・キーフレームフラグ・音声なしケースでtrak数が1になること・20秒/約20断片の長時間ケース・`mfra`の`moof_offset`全件が実際の`moof`box境界を指すこと・`mfro`の自己参照サイズ整合性を含む）
- 既存回帰: foundation単体テスト23件・settings-io16件・webm-muxer構造テスト22件・webm-duration検証、すべて既存と同結果でパス
- Chromium実ブラウザE2E:
  - 既存の全14タイプ切替回帰・Phase 8機能E2E・Phase 10.1動画合成E2E・オフライン書き出しE2E（通常/4バリアント）を再実行し、いずれもコンソールエラー0で既存と同結果
  - このサンドボックスのChromium（swiftshader）は`VideoEncoder.isConfigSupported()`でavc1系プロファイルすべてが非対応（`vp09`/`vp8`のみ対応）と判定されることを確認。実行環境がH.264エンコードに対応していない場合の実測であり、`_selectContainer()`が意図通りWebMへフォールバックしていることを実際のオフライン書き出しE2Eで確認（`blobType: "video/webm"`で正常完走）
  - MP4分岐自体は、`VideoEncoder`/`AudioEncoder`をこのサンドボックスでも動作するモック（`isConfigSupported`でavc1/mp4a.40.2を対応と返し、ダミーの符号化データと`decoderConfig.description`を返す）に差し替えた上で実際のオフライン書き出しUIを操作するE2Eで検証した。結果、`_selectContainer`がMP4を選択し、`Mp4Muxer`が呼ばれ、出力Blobの`type`が`video/mp4`、ファイル名が`.mp4`、トップレベルboxが`ftyp`/`moov`/`moof`×2/`mdat`×2/`mfra`の順で過不足なく構成されることを確認（コンソールエラー0）。実際のH.264ビットストリームの妥当性は`Mp4Muxer`単体のNodeテストで別途保証している

### spec.md 変更
- version `v1.7` → `v1.8`
- §14.8 を更新（コンテナ生成方式の記述をWebM限定からMP4/WebM共通の表現に変更）
- §14.8.1「コンテナ・コーデック選定（Phase 9.1）」を新設
- §20 に「Phase 9.1: MP4対応オフライン書き出し（実装済み）」を追加
- 理由: 新機能を仕様体系に正式に組み込むため

### 備考
- Phase 9.2（AudioWorklet移行）・Phase 10.2（オフライン書き出しでの動画合成）は `doc/plan-phase8.md` に設計を記載済みで、次フェーズとして継続する
- AudioWorkletへの移行を見送っている理由: `AudioWorkletProcessor`はメインスレッドの`AnalyserNode`インスタンスに直接アクセスできない（別レルム）ため、置き換えにはFFT・窓関数・スムージングを自前でworklet内に再実装する必要があり、単純なノード差し替えでは済まない。Phase 9.2で対応する

---

## 2026-07-18 — Phase 10.1 ライブ動画合成表示を追加

### 作業内容
`doc/plan-phase8.md` §4 Phase 10.1 に定めた「動画ファイルの映像フレームをビジュアライザーの背景として合成表示する」機能を実装した。

#### 変更ファイル
- `js/settings.js`: `videoCompositeEnabled`(既定false) / `videoCompositeOpacity`(0〜100) / `videoCompositeBlendMode` を追加
- `js/visualizer-core.js`: `videoElement` プロパティを追加。`_drawVideoComposite()` を新設し、`_loop()` の背景クリア直後（selfClearタイプは対象外）に、cover フィット（アスペクト比差は中央基準トリミング）で動画フレームを描画。不透明度・合成モードは `ctx.globalAlpha`/`ctx.globalCompositeOperation` で適用し、描画後に必ず復元する
- `js/ui-controller.js`:
  - `_initFile()`: `loadFile()` の戻り値から `isVideo` を判定し `_setVideoElement()` で反映。読込失敗時・マイク入力開始時はクリア
  - `_setVideoElement(element)`: 動画合成セクションの表示/非表示、要素なし時のトグル自動オフを行う
  - `_initVideoComposite()`: トグル・不透明度・合成モードの各コントロールを配線
  - `_syncControlsFromSettings()`: プリセット/JSON読込時に動画合成の各コントロールも同期するよう拡張
- `index.html`: 「動画合成」セクション（既定非表示、動画ファイル読込時のみ表示）を追加

### 検証
- 全JS `node --check` パス
- 既存回帰: foundation単体テスト23件・煙テスト168ケース・webm-muxer構造テスト22件・settings-io16件、いずれも既存と同結果
- Chromium実ブラウザE2E: `MediaRecorder` で合成した短い動画ファイルを実際にファイル入力へ投入し、①動画読込時にセクションが表示される、②トグルで `settings.videoCompositeEnabled` が反映される、③再生中にキャンバスへ動画由来のピクセルが描画される、④マイク入力へ切替時にセクションが非表示・設定が自動オフになる、をすべて確認。コンソールエラー0
- 既存の全14タイプ切替＋ランダマイズ回帰、Phase 8機能のE2E、オフライン書き出しE2Eも再実行しすべて0エラー（`_loop()` 変更による cross-feature 影響がないことを確認）

### spec.md 変更
- version `v1.6` → `v1.7`
- §13.3 を更新（動画映像の合成表示が可能になった旨）
- §14.9「動画合成表示（Phase 10.1）」を新設
- §20 に「Phase 10.1: ライブ動画合成表示（実装済み）」を追加
- 理由: 新機能を仕様体系に正式に組み込むため

### 備考
- オフライン書き出しでの動画合成（Phase 10.2）・MP4オフライン対応とAudioWorklet移行（Phase 9）は `doc/plan-phase8.md` に設計を記載済みで、次フェーズとして継続する

---

## 2026-07-18 — Phase 8 ユーザー向け機能拡張・計画書（Phase 8〜10）を追加

### 作業内容
`doc/spec.md` §23「今後の検討項目」の候補を整理し、`doc/plan-phase8.md`（Phase 8〜10 開発計画書）を作成。Phase 8「ユーザー向け機能拡張」5項目を実装した。

#### 新規ファイル
- `doc/plan-phase8.md`: Phase 8（ユーザー向け機能拡張）/ Phase 9（書き出し品質強化: MP4オフライン対応・AudioWorklet移行）/ Phase 10（動画合成表示）の設計・優先順位・依存関係を整理
- `js/settings-io.js`: 設定シリアライズ基盤。`serializeSettings`/`deserializeSettings`（不正値は既定値へ安全にフォールバック）、プリセットの保存/読込/削除/一覧（`localStorage`, キー `avz.presets.v1`）、JSON書き出し/読み込み
- `js/mic-input.js`: `MicInputManager`。`getUserMedia` でマイク入力を取得し `AudioEngine.connectStream()` で解析グラフへ接続。停止時に `track.stop()` でリソース解放

#### 変更ファイル
- `js/audio-engine.js`: `connectStream(stream)` を追加（`createMediaStreamSource` を使用。既存 `connectMedia` と同様に旧ソースを切断してから接続）
- `js/settings.js`: 各レイヤーに `blendMode`（既定 `'source-over'`）を追加
- `js/visualizer-core.js` / `js/offline-exporter.js`: `_renderStateless` でレイヤーごとに `ctx.globalCompositeOperation` を `layer.blendMode` に設定して描画するよう変更（両ファイルで同一ロジックを維持）
- `js/ui-controller.js`: `_initPresets`（プリセット/JSON入出力UI・`_syncControlsFromSettings` によるUI同期）、`_initFullscreen`、`_initKeyboardShortcuts` を追加。`_initFile` にマイク入力トグルを追加し、マイク入力中はファイル再生ボタンを無効化。`_initRecording`/`_updateRecButtons` をマイク入力対応に拡張（マイク入力中は録画開始時に `mediaManager.play()` を呼ばない）。`_renderLayerSettings` にレイヤーごとのブレンドモード選択を追加
- `js/app.js`: `MicInputManager` を生成し `UIController` へ渡す。`window.__app` に `micInput` を追加
- `index.html`: 「プリセット」セクション、ファイルセクションへの「マイク入力」ボタン、「表示比率」セクションへの「フルスクリーン」ボタン、キーボードショートカット凡例（`<details>`）を追加。`settings-io.js`/`mic-input.js` のスクリプトタグを追加
- `style.css`: `<progress>`・ショートカット凡例（`<details>`/`<kbd>`）のスタイルを追加

### 検証
- 全JS `node --check` パス
- 既存回帰: foundation単体テスト23件・煙テスト168ケース・webm-muxer構造テスト22件、すべて既存と同結果（blendMode対応による回帰なし）
- `settings-io.js` Node単体テスト16件（ラウンドトリップ、不正値/NaN/Infinityの安全な既定値フォールバック、プリセットCRUD）全通過
- Chromium実ブラウザE2E（Playwright、`--use-fake-device-for-media-stream`でマイクも実機能検証）: プリセット保存/読込/削除、JSON入出力、フルスクリーンボタン存在、キーボードショートカット（テキスト入力中の無効化を含む）、マイク入力の開始/停止と再生ボタン無効化、レイヤーブレンドモードのUI反映、いずれも正常動作・コンソールエラー0
- 既存の全14タイプ切替＋表現方法巡回＋ランダマイズ30連打の回帰チェックも0エラー

### spec.md 変更
- version `v1.5` → `v1.6`、Date を `2026-07-18` に更新
- §20 に「Phase 8: ユーザー向け機能拡張（実装済み）」を追加。Phase 9/10 は `doc/plan-phase8.md` に設計を記載し、順次実装する旨を明記
- 理由: 新機能を仕様体系に正式に組み込むため

### 備考
- Phase 9（MP4オフライン書き出し・AudioWorklet移行）・Phase 10（動画合成表示）は計画書のみ作成済み。実装は次のフェーズとして継続する

---

## 2026-07-12 — Phase 7 オフライン書き出し機能を追加

### 作業内容
音楽ファイルの信号を再生を伴わず解析し、現在のビジュアライザー設定に合わせて動画ファイルへ書き出す「オフライン書き出し」を実装した。通常録画（Recorder/MediaRecorder）とは独立した機能。

#### 新規ファイル
- `js/webm-muxer.js`: ゼロから EBML/WebM コンテナを構築するマクサー（`WebmMuxer`）。映像（VP9/VP8）・音声（Opus）のエンコード済みチャンクから、Duration に加えて **Cues（シーク索引）** を含む WebM を生成する。`js/webm-duration.js`（既存録画の Duration 後付けパッチ）とは別物で、より高機能。
- `js/offline-exporter.js`: オフライン書き出しの本体（`OfflineExporter`）。
  1. `AudioContext.decodeAudioData()` でファイル全体をデコード
  2. `OfflineAudioContext` 上で `AnalyserNode` → `ScriptProcessorNode` を通し、各出力フレーム時刻の周波数/時間波形スナップショットを決定的に採取（実時間より高速）
  3. 採取したフレーム列を既存レンダラー群（renderer-registry.js）で固定 dt(1/FPS) 描画
  4. `VideoEncoder`/`AudioEncoder`（WebCodecs）でエンコードし `WebmMuxer` でコンテナ化

#### 変更ファイル
- `js/vis-utils.js`: `computeFreqRange(sampleRate, binCount)` を追加。50Hz〜15kHz 帯域切り出しをライブ（AudioEngine）とオフライン（OfflineExporter）で共有するため。
- `js/audio-engine.js`: `_freqRange()` を `computeFreqRange` へ委譲するようリファクタ（挙動は完全に同一）。
- `index.html`: スクリプト読込順を変更（`vis-utils.js`/`history-buffer.js` を `audio-engine.js` より前に移動）。`webm-muxer.js`/`offline-exporter.js` を追加。「オフライン書き出し」セクション（音楽ファイル選択・FPS選択・進捗バー・開始/キャンセル/保存）を追加。
- `js/ui-controller.js`: `_initOfflineExport()` を追加。書き出し開始時点の `visualizer.settings` をスナップショットして使用し、進行中の UI 操作の影響を受けないようにした。
- `js/app.js`: `window.__app` にインスタンス一式を公開（devtools からの動作確認・デバッグ用）。

### 検証
- 全 JS `node --check` パス、foundation 単体テスト 23 アサーション・既存煙テスト 168 ケース・webm-duration 相当の回帰確認、いずれも既存と同結果（audio-engine.js のリファクタに回帰なし）。
- `webm-muxer.js` の Node 構造テスト（22 アサーション）: EBML ヘッダー/Segment/Info/Duration/Tracks/Cues の構造、**Cues の各 CueClusterPosition が実際に Cluster 要素を指しているか**（独立実装の EBML リーダーで検証）、SimpleBlock の構造、映像+音声/映像のみ/長時間（多数クラスタ）の各ケースを確認し全通過。
- Chromium 実ブラウザでの E2E テスト（Playwright）: 合成 WAV ファイル（3秒サイン波）を実際の書き出しUIに投入し、生成された WebM を `<video>` 要素に読み込ませてブラウザ自身のデマクサーで検証。`loadedmetadata`（長さ・解像度が期待通り）・**シーク成功**（Cues が実際に機能）・再生成功をすべて確認、コンソール/ページエラー0。
- 追加で、ステートフルタイプ（履歴・ビート検出を使う `terrain`）、レイヤー機能（`particles`/`radial` の複数レイヤー）、粘性揺らぎ（`physicsAmount>0`）の各経路も同様に書き出し→検証し、いずれも正常動作・エラー0を確認。

### spec.md 変更
- version `v1.4` → `v1.5`、Date を `2026-07-12` に更新。
- §14.8「オフライン書き出し（Phase 7）」を新設。処理方式・出力仕様・操作を記述。
- §20 に「Phase 7: オフライン書き出し（実装済み）」を追加。
- 理由: 新機能を仕様体系に正式に組み込むため。

### 備考
- 対応ブラウザは Chrome/Edge（`OfflineAudioContext` + WebCodecs API 対応環境）。非対応環境では書き出し開始前にメッセージを表示する。
- `ScriptProcessorNode` は非推奨 API だが、`OfflineAudioContext` 上で `AnalyserNode` のスナップショットを取得できる現状もっとも確実な標準手段のため採用した（将来的に `AudioWorklet` ベースへの置き換えを検討の余地あり）。
- API化・他アプリへの部品組み込み（当初検討した選択肢の一つ）は今回スコープ外（ユーザー判断によりスキップ）。

---

## 2026-07-12 — Phase 6.1 表現調整（実機レビュー反映）

### 作業内容
実機レビューのフィードバックを受け、Phase 6 の全アナライザータイプを調整した。基盤（レジストリ・ステートフル機構・履歴・ビート検出）は変更なし。

- **円形スペクトログラム（T2）を削除**（可読性が低いため）。`spectrogram.js` からクラス除去、レジストリからエントリ除去。
- **スペクトログラム（滝）**: 縦解像度向上・対数強度＋隣接ビン平均＋γ補正で微弱成分を繊細化、横送りを1〜2pxに抑制。
- **3D地形**: 基準を画面底辺に変更し `baseOffset` で上へ持ち上げる方式に。**奥行き角度**パラメーター（`depthAngle`）を追加。
- **トンネル**: 16:9で画面横幅いっぱいに広がるよう半径基準を対角基準へ。
- **擬似3Dバー**: 奥行きを増やし棒グラフとの立体差を明確化。
- **回転3Dリング**: 環半径・高さ・画面占有を拡大。
- **パーティクル**: 加算グロー化。点＝光球／線＝速度方向ストリークで描き分け。
- **波紋**: 全体エネルギーの立ち上がりでも発生させサウンド追従を明確化、線幅・輝度を音量連動。
- **ノイズフロー**: 点＝光点／線＝流線で描き分け（従来は常に線）。
- **メタボール**: 中心をノイズ徘徊させ形状ランダム性を強化、融合（blur/contrast）を改善。
- **オシロスコープ**: `baseOffset` を中心からの距離（広がり）制御に変更。
- **極座標フラワー**: **花弁数**の専用パラメーター（`petalCount`）を追加。
- **ボロノイ脈動**: サイトをノイズで動的移動＋音量で移動量増幅し、形状が常に変化・音追従（毎フレーム再計算）。`motionSpeed` 対応。
- 追加設定 `depthAngle` / `petalCount`、UIスライダー（奥行き角度・花弁の数）とケイパビリティ `angle`/`petals` を追加。

### 検証
- 全JS `node --check` パス、foundation 単体テスト 23 アサーション全通過。
- ヘッドレス煙テスト: 全ステートフルタイプ×表現方法×4パターン×2アスペクト = 168 render-cases、例外0。
- Chromium 実ブラウザ: 型14種（円形スペクトログラム無し）確認、全型切替＋表現方法巡回＋ランダマイズ30連打でコンソール/ページエラー0。ケイパビリティ連動（3D地形→奥行き角度、フラワー→花弁数）を確認。

### spec.md 変更
- §11.3・§20 Phase6: タイプ数を 15→14、13→12 に更新。Phase 6.1（表現調整）注記を追加。
- `doc/spec-phase6.md` を v1.1 に更新: T2 削除表記、改訂履歴（§11）に全項目の変更を記録、受け入れ条件のタイプ数更新。

### 備考
- `doc/plan-phase6.md` は当初計画のスナップショットのため T2 の記述はそのまま残置。

---

## 2026-07-12 — Phase 6 拡張表現 実装

### 作業内容
- Phase 6「拡張表現」を実装。アナライザータイプを 13 種追加し計 15 種にした。
- **基盤**
  - `js/vis-utils.js` 新規: 純ロジック集（clamp/lerp/isoProject/polarToXy、makeColor、ValueNoise、Spring/SpringArray、springParamsFromAmount、BeatDetector、Voronoi分割、makeRng）
  - `js/history-buffer.js` 新規: `FrameHistory`（事前確保リングバッファ）
  - `js/renderer-registry.js` 新規: レンダラーレジストリ + ケイパビリティ（タイプ別の対応表現/レイヤー/スライダー/selfClear を宣言）
  - `js/audio-engine.js`: 時間波形取得（`getByteTimeDomainData`）・`getFreqSlice`/`freqSliceLength` を追加
  - `js/visualizer-core.js`: 描画ループ v2 に刷新。frame オブジェクト組み立て（freq/time/history/beat/dtMs）、ステートフルレンダラーのライフサイクル（生成/onResize/dispose）、selfClear、粘性揺らぎ（physicsAmount）を実装。既存 bar/radial は physicsAmount=0 で従来と同一動作
  - `js/settings.js`: `historySeconds`/`motionSpeed`/`particleAmount`/`physicsAmount` を追加
- **新レンダラー（js/renderers/）**
  - spectrogram.js（T1滝/T2円形）, terrain.js（T3 3D地形）, tunnel.js（T4トンネル）, bar3d.js（T5擬似3Dバー）, ring3d.js（T6回転リング）, particles.js（T7粒子/T9ノイズフロー）, ripple.js（T8波紋）, metaball.js（T10・blur+contrast合成、filter非対応時フォールバック）, lissajous.js（T11オシロ）, flower.js（T12フラワー）, voronoi.js（T13脈動）
- **UI（ui-controller.js / index.html）**: タイプセレクトをレジストリから系統別 optgroup で動的生成。選択タイプのケイパビリティに応じて表現方法・表示モード・レイヤー・追加スライダーを表示/非表示。ランダマイズもケイパビリティ準拠で不正組み合わせを生成しないよう変更。追加スライダー4本を配線。
- `index.html`: 依存順（vis-utils/history-buffer → renderers → registry → core）でスクリプトを読み込み。
- **検証**
  - 全JS `node --check` パス
  - foundation 単体テスト 23 アサーション全通過（ノイズ決定性・バネ収束/無発散/バイパス・ビート検出・Voronoi面積保存・FrameHistory コピー等）
  - ヘッドレス煙テスト: mock canvas/ctx で全13ステートフルタイプ × 表現方法 × 4パターン × 2アスペクト = 176 render-cases、例外0・描画0件なし
  - Chromium 実ブラウザ起動テスト: 15タイプ×5系統の optgroup 生成確認、全タイプ切替＋ランダマイズ40連打でコンソール/ページエラー0

### spec.md 変更（あれば）
- 20 Phase 6 を「計画中」→「実装済み」に更新（計15タイプ）

### 備考
- 実装は設計文書（doc/spec-phase6.md / plan-phase6.md / test-phase6.md）に準拠。実装契約は doc/renderer-contract.md に整理
- 音声を伴う実描画の目視確認はブラウザ実機（スマホ含む）で別途推奨。ヘッドレスでは合成データによる例外・描画有無まで検証

---

## 2026-07-10

### 作業内容
- `README.md` にスマホ実機テスト向けの記述を追記
  - セットアップ「方法2」に、同一 Wi-Fi のスマホから PC の IP でアクセスする手順を追記
  - 「スマホでの利用について」セクションを新設（初回再生のタップ必須・レイアウトがデスクトップ前提・iOS Safari の録画挙動差の注意）

### spec.md 変更（なし）
- ドキュメント（README）の追記のみで、仕様・コードの変更はないため spec.md 変更なし
- モバイルは引き続き正式対象外（spec.md §2.3）であることを README 側に明記

### 備考
- 公開ホスティング手順（Cloudflare Pages 等）は開発者個人のレビュー用途のため README には記載しない方針とした

---

## 2026-07-09

### 作業内容
- Phase 6「拡張表現」の設計文書一式を作成（実装委託用）
  - `doc/spec-phase6.md`（設計仕様書）: 新アナライザータイプ 13 種 + 粘性揺らぎ修飾の詳細仕様
    - 時間軸系: スペクトログラム（滝）/ 円形スペクトログラム / 3D地形 / トンネル
    - 擬似3D系: 擬似3Dバー（アイソメトリック）/ 回転3Dリング
    - 流体・粒子系: パーティクル放出 / 波紋 / ノイズフロー / メタボール
    - 幾何系: オシロスコープ（リサージュ）/ 極座標フラワー / ボロノイ脈動
    - 基盤設計: ステートフルレンダラー機構（レジストリ + ライフサイクル）、FrameHistory（履歴リングバッファ）、時間波形取得、BeatDetector、ValueNoise、Spring（バネ物理）、Voronoi 分割、ケイパビリティマップ、性能予算（タイプ別要素数上限・60fps/録画中30fps）
  - `doc/plan-phase6.md`（実装計画書）: マイルストーン M1〜M6・タスク分解（DoD付き）・委託パッケージング（並行開発可能な分割）・ブランチ/PR運用・コーディング規約・リスク対策・スケジュール目安
  - `doc/test-phase6.md`（テスト設計書）: Node ミニランナーによる単体テスト（約30ケースを定義）、モック音源によるビジュアルハーネス（全組み合わせ自動巡回・非空描画判定・ベースラインハッシュによる既存タイプ回帰検証）、手動チェックリスト、性能測定基準

### spec.md 変更（あれば）
- version `v1.3` → `v1.4`、Date を `2026-07-09` に更新
- 11.3: Phase 6 で 15 タイプ体制になる旨と詳細仕様書への参照を追記
- 20: Phase 5 に録画品質改善の実施済み注記を追加、Phase 6（計画中）を新設し設計文書3点への参照と概要を記載
- 理由: Phase 6 の拡張表現を正式なフェーズとして仕様体系に組み込むため

### 備考
- 「ミラー山脈」は既存機能の組み合わせ（bar × line × mirror-vertical）で実現済みのため新規タイプから除外
- 実装は未着手。plan-phase6.md の M1（基盤）が全タイプの前提となるため先行実施が必要

---

## 2026-07-05

### 作業内容
- 録画まわりのリファクタリング（A/V同期精度・ファイル形式・エンコーディング品質の向上）
- **A/V同期精度の向上**
  - `Recorder.start()` を async 化し、`AudioContext.resume()` の完了 → `MediaRecorder` の `start` イベント発火を待ってから resolve するよう変更
  - `UIController` の録画開始ハンドラーを「録画キャプチャ開始を待ってから `mediaManager.play()` を呼ぶ」順序に変更し、録画準備前に音が鳴り始めて冒頭がずれる問題を解消
  - 録画長は `start` イベント時刻〜停止指示時刻の実測値で算出するよう変更
  - `AudioEngine.removeStreamDestination()` を対象ノードのみの `disconnect(dest)` 優先に変更（非対応環境のみ全切断+再接続へフォールバック）
- **エンコーディング品質の向上**
  - `videoBitsPerSecond` を解像度×FPSから自動算出（約0.15bpp、6〜24Mbpsでクランプ）、`audioBitsPerSecond` を192kbpsに設定
  - `MediaRecorder.start(1000)` のタイムスライス指定で1秒ごとにチャンクを回収し、長時間録画の安定性を改善
- **ファイル形式の精度向上**
  - `js/webm-duration.js` を新規追加。MediaRecorder の WebM 出力に欠落している `Duration` 要素を EBML 最小パースで `Segment > Info` に書き込み、編集ソフトで長さ表示・シークが正しく機能するファイルとして保存（外部ライブラリ不使用、パース失敗時は元データをそのまま使用する安全設計）
  - MIME 候補リストをモジュール定数 `RECORDER_MIME_CANDIDATES` に抽出、`_extFromMime()` を大文字小文字非依存に変更
- **その他リファクタリング**
  - `Recorder` の停止後処理を `_handleStop()` に分離、開始失敗処理を `_abortStart()` に集約、二重開始防止フラグ `_starting` を追加
  - `UIController` に `recorder.onError` の表示ハンドラーを追加（従来は未接続だった）
- Node によるロジック検証: 全JSの構文チェック、および WebM Duration パッチの挿入・上書き・不正データフォールバック・TimecodeScale 換算の各ケースをテストし全件パス
- **レビュー指摘対応（Copilot）**
  - `AudioContext.resume()` 失敗時に `_starting` フラグが残り以後録画不能になる問題を修正（try/catch + `_abortStart()` で状態復帰）
  - `MediaRecorder` の `onerror` ハンドラーを追加し、キャプチャ開始前のエラーで `start()` の Promise が永久に未解決になる問題を修正（録画中のエラーは録画停止して回収済みデータを保全）
  - UI の録画開始ハンドラーに try/catch を追加し、開始失敗時は描画ループを停止して待機状態に戻すよう修正

### spec.md 変更（あれば）
- version `v1.2` → `v1.3`、Date を `2026-07-05` に更新
- 14.4 出力形式: ビットレート自動算出（映像6〜24Mbps・音声192kbps）、WebM への Duration 書き込み、タイムスライス回収を追記
- 14.7 A/V同期を新設: 録画開始シーケンス（resume 完了 → キャプチャ開始 → 再生開始）と録画長実測の方針を明記
- 理由: 録画品質・同期精度の実装変更を仕様として明文化するため（Phase 5 品質改善に相当）

### 備考
- Duration パッチは WebM のみ対象。MP4 は MediaRecorder が停止時に moov へ長さを書き込むため不要
- Info サイズの vint 再エンコードが同一バイト長で収まらない等の想定外構造では、パッチを断念して元の Blob を保存する（録画データを壊さない）

---

## 2026-04-18

### 作業内容
- `Recorder._selectMimeType()` の MP4 候補を見直し、`avc1.640028` / `avc1.4d401f` / `avc1.42e01e` + `mp4a.40.2` の順で優先するよう変更した。
- これまでの曖昧な `avc1` 指定より、編集ソフト互換性が高い一般的な H.264/AAC プロファイルを先に試す実装へ更新した。
- `README.md` の録画説明を実装に合わせて更新し、保存拡張子の自動判定（`.mp4` / `.webm`）と MP4 優先フォールバック動作を明記した。

### spec.md 変更（あれば）
- 14.4 出力形式の MP4 記述を「H.264/AAC の一般的プロファイル候補を優先」と明確化した。
- 理由: Davinci Resolve など編集ソフトへ取り込みやすい出力を意図した実装変更を仕様にも反映するため。

### 備考
- ブラウザ実装差は残るため、MediaRecorder が MP4 非対応の環境では引き続き WebM へフォールバックする。

---

## 2026-04-18

### 作業内容
- 録画セクションに `FPS` 選択UIを追加し、`25fps / 29.97fps / 30fps` を明示的に選べるようにした。
- `Recorder` に `setFrameRate()` を追加し、選択値を `canvas.captureStream()` の引数へ反映するよう変更した。
- `UIController` で録画FPSセレクトの初期値・変更イベントを `Recorder` に連携するよう実装した。
- `README.md` に録画FPS指定機能の使い方と実装内容を追記した。

### spec.md 変更（あれば）
- セクション 14.5（操作）に「FPS選択（25 / 29.97 / 30）」を追加。
- セクション 15.1（必須UI要素）に「録画FPS選択（25 / 29.97 / 30）」を追加。
- 理由: Issue「fpsを明示的に指定する機能の追加」に合わせ、仕様へ操作項目とUI要件を明記するため。

### 備考
- 既存の録画開始/停止/保存フローは変更せず、fps指定のみ最小差分で追加した。

---

## 2026-04-14 — MP4出力対応・背景色切替機能追加

### 作業内容
- **録画フォーマット**: `video/mp4` を `_selectMimeType()` の候補リスト先頭に追加。Chrome 130+・Safari では MP4（H.264/AAC）で録画・保存される。非対応ブラウザは WebM にフォールバック。保存ファイル名の拡張子（`.mp4` / `.webm`）も `blob.type` から自動判定するよう変更。
- **背景色切替**: 「黒 / 白」トグルを表示比率セクションに追加。設定値 `bgColor`（`'#000'` または `'#fff'`）を新設し、描画クリア・残像フェードの色をそれぞれ連動させた。

#### 変更ファイル
| ファイル | 変更内容 |
|---|---|
| `js/recorder.js` | `_selectMimeType()` に MP4候補追加、`_extFromMime()` 追加、`_generateFilename()` を MIME から拡張子を決定するよう変更 |
| `js/settings.js` | `bgColor: '#000'` をデフォルト設定に追加 |
| `js/visualizer-core.js` | `_fillBlack()` を `_fillBackground()` に改名して `bgColor` 対応、残像フェードも白背景対応 |
| `js/ui-controller.js` | 背景色トグルボタンのハンドラーを `_initAspectRatio()` 内に追加 |
| `index.html` | 表示比率セクションに「黒 / 白」ボタン追加 |

### spec.md 変更
- セクション 14.4（出力形式）に MP4対応を追記

### 備考
- Firefox は `video/mp4` の MediaRecorder 非対応のため WebM のまま

---

## 2026-04-14 — バグ修正: Cannot read properties of undefined (reading 'state')

### 作業内容
- `_initFile()` で `mediaManager.onEnded` を `await loadFile()` の**後**に設定していたため、最初のファイルの `canplay` 時点では `onEnded` が `null` となっており、`ended` リスナーが登録されなかった。
  - 結果として1本目のファイルが終了しても `_onEnded()` が呼ばれず、録画の自動停止が機能しなかった。
- 2本目以降のファイルをロードする際に、古い要素の `src = ''` 変更がブラウザによって `ended` イベントを発火させることがあり、`_onEnded()` が意図せず呼ばれる可能性があった。

#### 修正内容
| ファイル | 変更内容 |
|---|---|
| `js/ui-controller.js` | `this.mediaManager.onEnded = () => this._onEnded()` を `_initFile()` の先頭（`change` ハンドラーの外）に移動。`loadFile()` より前に一度だけ設定することで、1本目のファイルの `canplay` 時点でも `ended` リスナーが確実に登録されるようにした。 |
| `js/media-manager.js` | `loadFile()` 内で `mediaElement.src = ''` を変更する前に `removeEventListener('ended', ...)` を呼び、古い要素への `ended` リスナーを解除するようにした。 |

### spec.md 変更（なし）

### 備考
- `this.mediaManager.onEnded` を一度だけ設定することで `removeEventListener` が同一の関数参照を使用でき、正しく解除される。

---

## 2026-04-14 — Phase 4（キュー機能）中止・フェーズ番号整理

### 作業内容
- Phase 4（3スロット再生キュー・自動循環再生）の実装を中止

#### ドキュメント変更
| ファイル | 変更内容 |
|---|---|
| `doc/spec.md` | Phase 4（キュー機能）を削除。Phase 5→4（録画機能・完了）、Phase 6→5（品質改善）に繰り上げ |
| `doc/spec.md` | 受け入れ条件 #6（3スロット循環再生）を削除し番号を詰め直し |
| `doc/spec.md` | Section 25 固定方針から「3スロット循環再生」を削除 |
| `log.md` | フェーズ番号の参照を修正 |

### spec.md 変更
- version `v1.2` → `v1.3`（フェーズ整理に伴うバージョン更新は spec.md 直接編集で対応）

### 備考
- スロット・キュー関連の仕様（Section 8・13 等）は将来の再実装を考慮し仕様書内に保持する
- 現状の録画モードは「1ファイル・単一スロット」相当として機能している

---

## 2026-04-14 — 録画機能実装

### 作業内容
- 録画モード（Phase 4）を実装

#### 新規・変更ファイル
| ファイル | 変更内容 |
|---|---|
| `js/recorder.js` | 新規: Canvas + Audio 録画モジュール（MediaRecorder API、webm 出力、日時自動命名） |
| `js/audio-engine.js` | `createStreamDestination()` / `removeStreamDestination()` を追加（録画用オーディオストリーム） |
| `js/ui-controller.js` | モード切替（再生/録画）、録画制御（開始/停止/保存/再録画）、状態連動のボタン制御を追加 |
| `js/app.js` | Recorder インスタンス生成と UIController への受け渡しを追加 |
| `index.html` | モード切替セクション、録画コントロールセクション、recorder.js の script タグを追加 |
| `style.css` | 録画ステータス表示（.rec-status / .recording）のスタイルを追加 |
| `README.md` | 録画機能の説明・使いかたを追記 |

#### 実装済み機能
- **モード切替**: 再生モード / 録画モード
- **録画開始**: Canvas ストリーム（30fps）+ AudioContext の MediaStreamDestination を合成し MediaRecorder で録画
- **録画停止**: MediaRecorder を停止し Blob を保持
- **保存**: webm 形式で日時ベースのファイル名（`visualizer_YYYYMMDD_HHMMSS.webm`）でダウンロード
- **再録画**: 録画データをリセットし再度録画可能な状態に戻す
- **録画中の状態表示**: ステータスラベルでの「待機中」「録画中…」「録画完了」表示
- **再生終了時の自動停止**: 録画中にメディア再生が終了した場合、録画も自動停止

### spec.md 変更（なし）
- 既存の仕様（セクション 14: 録画モード仕様）に従った実装のため変更不要

### 備考
- MIME タイプは vp9+opus → vp8+opus → vp8 → webm の順でブラウザサポートを確認し自動選択
- 映像のみでなく音声も録画に含めることで実用性を確保
- 録画対象はビジュアライザー描画領域（Canvas）のみ。UIパネルは含まない

---

## 2026-04-14 — UI改善・ランダマイズ機能追加・ドキュメント更新

### 作業内容
- ミラー（上下）の中心線ずれを修正（`centerY` を常に `Math.floor(canvas.height / 2)` に固定）
- アナライザーランダマイズボタンを追加（タイプ・表現方法・表示モード・レイヤー数・レイヤー色相オフセットをランダム化、レイヤー感度は 1.0 固定）
- 形状ランダマイズボタンを追加（感度・スムージング・線の太さ・密度・基準点オフセット・残像強度をランダム化）
- レイヤーセクションをアナライザーセクションに統合、`_initLayers()` を `_initAnalyzer()` に統合
- アナライザーランダムボタンをレイヤー数ボタンの上に配置

### spec.md 変更
- version `v1.1` → `v1.2`
- 6.1: レイヤー設定領域をアナライザー設定領域に統合
- 9.6: 解析帯域 50Hz〜15kHz を新規追記
- 10.3: 「円形放射時の傾き」項目を削除
- 11.8: 「円形放射時の傾き」仕様を削除（旧11.9残像を11.8に繰り上げ）
- 12.1: アナライザーランダマイズ・形状ランダマイズを追記
- 12.4: ランダマイズボタンの種類（色相 / アナライザー / 形状）を明記
- 15.1: 傾き切替を削除、アナライザーランダマイズ・形状ランダマイズ・レイヤー統合を反映
- 20 Phase 3: 傾き対応を削除、新機能（ランダマイズ×2・帯域制限・レイヤー統合・ミラー修正）を追記

### 備考
- レイヤーの感度はランダマイズ対象から外す仕様に確定（意図しない音量差を防ぐため）

---

## 2026-04-14 — 傾きパラメーター削除・周波数帯域を 50Hz–15kHz に限定

### 作業内容
- `radialTilt` パラメーターを全箇所から削除（settings.js / radial.js / ui-controller.js / index.html）
- アナライザーが表現する帯域を **50Hz〜20kHz** に固定
  - `audio-engine.js` に `_freqRange()` を追加し、サンプルレートから動的に開始・終了ビンを計算
  - `getLayerData()` / `getFrequencyData()` を 50Hz–20kHz スライスのみ返すよう変更

### spec.md 変更（なし）
- UI 整理・帯域絞り込みのみのため spec.md 変更は不要

### 備考
- 可聴域の実用帯域に限定することで低域ノイズ成分（〜50Hz 以下）と折り返し成分（20kHz 超）を排除

---

## 2026-04-14 — Phase 3 実装

### 作業内容
- Phase 3「表現拡張・追加仕様」を実装・完了

#### 変更・追加ファイル
| ファイル | 変更内容 |
|---|---|
| `js/settings.js` | `rendererType`/`zeroDbMode` を廃止し `analyzerType`/`expressionMethod`/`barDisplayMode`/`radialTilt`/`density`/`baseOffset`/`hueContinuousMode`/`hueContinuousSpeed`/`afterimageIntensity` を追加 |
| `js/renderers/bars.js` | 棒グラフ型・棒表現に書き換え。ミラー（上下/左右）・密度・基準点オフセット対応 |
| `js/renderers/lines.js` | 棒グラフ型・波形線表現に書き換え。ミラー・密度・オフセット対応 |
| `js/renderers/dots.js` | 棒グラフ型・点表現に書き換え。ミラー・密度・オフセット対応 |
| `js/renderers/radial.js` | 円形放射型・全表現（棒/波形線/点）対応に書き換え。傾き・密度・オフセット対応 |
| `js/renderers/mirror.js` | 削除（ミラー機能は bars/lines/dots に統合） |
| `js/visualizer-core.js` | レンダラー選択を analyzerType×expressionMethod に変更、残像表現（rgba クリア）、色相連続変化モード対応 |
| `js/ui-controller.js` | Phase 3 UI 全面刷新。アナライザータイプ・表現方法・表示モード・傾き・密度・オフセット・残像・色相ランダム・色相連続変化の各コントロールを追加 |
| `index.html` | Phase 3 UI 構造に全面更新。mirror.js の参照を削除 |
| `style.css` | トグル行・チェックボックスのスタイルを追加 |
| `README.md` | Phase 3 の機能・使いかたを追記 |

#### Phase 3 実装済み機能
- **アナライザータイプ切替**: 棒グラフ / 円形放射
- **表現方法切替**: 棒 / 波形線 / 点（全6組み合わせ）
- **棒グラフ表示モード**: 通常 / ミラー上下 / ミラー左右
- **円形放射の傾き**: 0度 / 30度 / 45度 / 60度
- **密度調整**: 30〜100（最小でもアナライザーが消失しない）
- **基準点オフセット**: 0〜99
- **線の太さ調整**: 1〜20px
- **色相ランダマイズ**: 色相+レイヤー色相オフセットをランダム値に設定
- **色相連続変化モード**: 再生中に色相が自動的に変化
- **残像表現**: 強度 0〜10（rgba フェードによる実装、過剰設定は上限10でクランプ）

### spec.md 変更（なし）
- 今回は既存の Phase 3 仕様に従った実装のため、spec.md への変更は不要

### 備考
- Phase 2 の `rendererType`（bars/lines/dots/radial/mirror）と `zeroDbMode` は廃止し、`analyzerType`（bar/radial）× `expressionMethod`（bar/line/dot）の2軸構造に再編
- mirror.js は削除し、ミラー機能は棒グラフ型の `barDisplayMode` として統合
- 次フェーズ（Phase 4）では録画機能を実装予定

---

## 2026-04-14 — spec.md 復元・Phase 3 仕様追記

### 作業内容
- `doc/spec.md` を過去コミット `12242f67305a59ed23e70e446d75a4eb06f26489` の完全版から復元した。
- 前回の誤更新で全文が失われていたため、元の完全な仕様書をベースに復元した上で Phase 3 仕様を追記した。
- 全文置換ではなく、元文書を保持した上で必要箇所のみを差分更新した。

#### spec.md 変更内容
- ドキュメントヘッダ: version `v1.0` → `v1.1`、Date `2026-04-13` → `2026-04-14`
- **4. 機能一覧**: アナライザータイプ切替・表現方法切替・密度・色相ランダマイズ・色相連続変化モード・残像表現を追記
- **10.3 各レイヤーの設定項目**: レイヤーごとの色相オフセット・密度・基準点オフセット・円形放射時の傾き・棒グラフ時のミラー方式・残像強度を追記
- **11. アナライザー表示仕様**: 11.3〜11.5 を Phase 3 仕様に更新（アナライザータイプ・表現方法・0dB基準位置を明確化）、11.7〜11.9 を新規追加（棒グラフ表示モード・円形放射の傾き・残像表現）
- **12.1 色関連パラメータ**: 色相ランダマイズ・レイヤーごとの色相オフセット・色相連続変化モードを追記
- **12.2 形状関連パラメータ**: 密度の仕様詳細・基準点オフセット・残像強度を追記
- **12.4 UIコントロール形式**: ランダマイズボタンを追記
- **15.1 必須UI要素**: Phase 3 で追加される UI コントロール群を追記
- **20. 開発フェーズ提案**: Phase 1・2 を完了済みとして整理。新規 Phase 3（表現拡張・追加仕様）を追加。旧 Phase 3/4 をそれぞれ Phase 4/5 に繰り下げ（キュー機能は中止）
- **21. 受け入れ条件**: Phase 3 追加受け入れ条件（12〜22）を追記

### spec.md 変更の理由
- Phase 2 まで完了済みという前提のもと、今回の追加要望を Phase 3 として位置付けるため。
- 元の仕様書全体（章構成・既存フェーズ・既存説明）を欠損なく保持するため。

### 備考
- Phase 3 実装開始前に、開発チームはこの spec.md を設計参照として使用できる。

---

## 2026-04-14 — Phase 2 実装

### 作業内容
- Phase 2「表現拡張」を実装・完了

#### 変更・追加ファイル
| ファイル | 変更内容 |
|---|---|
| `js/settings.js` | `rendererType` / `zeroDbMode` / `layerCount` / `layers[]` 設定追加、`createDefaultSettings()` 追加 |
| `js/audio-engine.js` | `captureFrame()` / `getLayerData(layerIndex, layerCount)` を追加（帯域分割対応） |
| `js/renderers/bars.js` | `zeroDbMode: center`（中央基準・上下対称）対応を追加 |
| `js/renderers/lines.js` | 新規: 波形線型レンダラー（bottom / center 対応） |
| `js/renderers/dots.js` | 新規: 点型レンダラー（bottom / center 対応） |
| `js/renderers/radial.js` | 新規: 円形放射型レンダラー |
| `js/renderers/mirror.js` | 新規: ミラー対称型レンダラー（bottom / center 対応） |
| `js/visualizer-core.js` | レイヤーループ実装、レンダラー選択ロジック追加、settings 初期化を `createDefaultSettings()` に変更 |
| `js/ui-controller.js` | レンダラータイプ・0dBモード選択、レイヤー数切替、レイヤー個別設定UIを追加 |
| `index.html` | 表現タイプ・0dB基準・レイヤーセクションを追加、新レンダラー `<script>` タグを追加 |
| `style.css` | select / layer-item / label-row スタイルを追加 |
| `README.md` | Phase 2 実装内容・使いかたを更新 |

#### Phase 2 実装済み機能
- **アナライザータイプ**: 棒グラフ / 波形線 / 点 / 円形放射 / ミラー対称
- **0dB基準位置**: 底辺基準 / 中央基準（上下対称）
- **レイヤー1〜4**: 音域を均等分割し複数レイヤーを重ね描き
- **レイヤー個別設定**: 色相オフセット・感度を各レイヤーで独立調整
- `radial` 選択時は 0dBモード選択を無効化（常に中心基準）

### 備考
- 次フェーズ（Phase 3）では表現拡張・追加仕様を実装予定

---

## 2026-04-14

### 作業内容
- `README.md` を新規作成
- セットアップ方法（直接起動 / ローカルサーバー起動）を追記
- 基本的な使いかたと現在の実装内容を追記

### 備考
- 現状実装に合わせて Phase 1 時点の利用手順を整理

---

## 2026-04-13

### 作業内容
- `doc/spec.md` を作成（仕様設計書 v1.0）
- `CLAUDE.md` を作成（開発基本方針）
- `log.md` を作成（本ファイル）

### 備考
- リポジトリ初期状態。実装はまだなし。
- 次のステップは Phase 1（最小動作版）の実装。

---

## 2026-04-13 — Phase 1 実装

### 作業内容
- Phase 1「最小動作版」を実装・完了

#### 作成ファイル
| ファイル | 役割 |
|---|---|
| `index.html` | メイン画面（2カラム: ビジュアライザー + コントロール） |
| `style.css` | ダークテーマ UI |
| `js/settings.js` | デフォルト設定値 |
| `js/audio-engine.js` | Web Audio API ラッパー（AudioContext / AnalyserNode） |
| `js/media-manager.js` | 音声・動画ファイル読込・再生制御 |
| `js/renderers/bars.js` | 棒グラフ型ビジュアライザー（底辺基準） |
| `js/visualizer-core.js` | Canvas 描画ループ（requestAnimationFrame） |
| `js/ui-controller.js` | UI イベント管理・設定値との同期 |
| `js/app.js` | 初期化エントリポイント |

#### Phase 1 実装済み機能
- 音声 / 動画ファイル読込（ファイル選択ダイアログ）
- Web Audio API によるリアルタイム周波数解析
- 棒グラフ型アナライザー表示
- 再生 / 一時停止 / 停止
- 色相・色相幅・輝度・彩度のリアルタイム調整
- 感度・スムージング・棒幅のリアルタイム調整
- 16:9 / 1:1 アスペクト比切替
- 背景: 常に黒固定
- ライブラリ不要（Vanilla JS + Web 標準 API のみ）

### 備考
- 次フェーズ（Phase 2）では複数アナライザータイプ・0dB基準位置切替・レイヤー対応を予定
