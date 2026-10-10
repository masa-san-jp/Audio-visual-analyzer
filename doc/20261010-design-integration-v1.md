# GPU タイプの本体統合 設計 v1

- 作成：2026-10-10。設計は Opus、実装は impl-sonnet。
- 状態：SSOT。
- 目的：オーナーの指示「統合から」。world.html（試作）と index.html（本体）に UI が分かれている状態をなくし、**index.html だけ**にする。
- 前提の調査（Explore、2026-10-10）：
  - 本体はすべて 2D canvas で描く。`#canvas` は 1 枚。
  - タイプは `RENDERER_REGISTRY`、描画は `FramePipeline`、毎フレームの駆動は `VisualizerCore._loop` が担う。
  - 書き出しは `OfflineExporter`。WorldExporter はこれを継承している。

## 1. 画面（canvas の重ね合わせ）

- `#visualizer-area` の中、`#canvas` の直後に `<canvas id="gpu-canvas" hidden>` を置く。
- CSS で `#canvas` と同じ位置・同じ大きさに重ねる（`position:absolute; inset:0; width:100%; height:100%`）。
- GPU タイプを選んでいる間は `#gpu-canvas` を表示し、`#canvas` を `visibility:hidden` にする。2D タイプに戻したら逆にする。
- 内部の解像度：
  - 表示サイズ × devicePixelRatio とする。
  - ただし長辺は 1920 に収める（性能のため。アスペクト比は保つ）。
  - `#visualizer-area` の resize と fullscreenchange で更新する。

## 2. 新しいモジュール `js/world/world-bridge.js`（クラス WorldBridge）

本体と WorldEngine の間の唯一の接点にする。

- `constructor({ container, gpuCanvas, audioEngine, mediaManager, songMapService })`
- **遅延初期化**：最初に GPU タイプが選ばれたときに `new WorldEngine(gpuCanvas, seed)` を作る。2D だけを使う利用者には WebGL を作らない。
  - 作成に失敗したら `available = false` とし、UI に「この環境では GPU タイプを利用できません」と表示する。
- `async prepare(file)`：
  - 曲を読み込んだとき、かつ GPU タイプが使われる可能性があるとき（GPU タイプが選ばれているとき、または初めて GPU タイプが選ばれたとき）に呼ぶ。
  - SongMap は本体の songMapService から取得する。`worldChroma` は、world-app.js の `WorldSongMapService` の追加処理を純粋関数 `worldAugmentSongMap(map)`（js/world/score.js に移す）にして適用する。
  - 特徴量の時系列は `WorldExporter.prepare(file, fps)` で作る（fps は本体の書き出し FPS の設定。既定 60）。
  - `compileWorldScore(map, seed, featureFrames)` で score を作り、`engine.setScore(score)` と `engine.setTimeline(featureFrames, fps)` を呼ぶ。
  - 準備中は `#time-display` の隣に「GPU 解析中…」を表示する。曲の長さに比例して数秒かかる。
  - 同じファイルで 2 度目以降は使い回す。
- `selectType(id)`：準備が済んでいれば `engine.selectType(id)` を呼ぶ（0.5 秒のクロスフェード）。
- `frame(nowMs, dtSec)`：VisualizerCore._loop から、GPU タイプが選ばれている間だけ毎フレーム呼ぶ。
  - `engine.render(media.currentTime, audioEngine.getFeatures(), dt)`。
  - 時刻が戻ったとき（逆シーク・ループ）は、world-app.js の `_tick` と同じく `engine.setScore(score)` で巻き戻す。
  - 準備がまだなら、黒い画面に「GPU 解析中…」を表示する。
- `resize(w, h)`、`dispose()`。
- `exportVideo({ fps, aspect, onProgress, signal })`：`WorldExporter.exportWorld(score, prepared, { typeId, width, height })` を呼ぶ。サイズは 16:9 なら 1920×1080、1:1 なら 1080×1080。

## 3. タイプの選択肢

- `RENDERER_REGISTRY` に `gpu: true` の 3 項目を追加する。
  - `g-fluid`（スペクトル流体）、`g-gargantua`（ブラックホール）、`g-attractor`（ストレンジアトラクター）
  - グループは「GPU」。RENDERER_GROUP_ORDER の最後に置く。
  - `capabilities` は `{ gpu: true }` だけにする。2D の項目は一切持たない。
  - `create` は持たない。FramePipeline は gpu 項目を描画しない。
- ランダム選択（:1064）は 2D の項目だけから選ぶ。
- **ディレクター**：
  - ディレクターのプールとシーンには、GPU 項目を入れない（`getRendererEntry(t).gpu` で除外する）。
  - GPU タイプを選んでいる間は、ディレクターの操作を無効にし、「GPU タイプでは自動演出を使いません（タイプ自身が曲の展開に追従します）」と表示する。
- **マイク入力**：GPU タイプは曲ファイル全体の解析が必要。マイク入力中は GPU 項目を選べないようにし（option を disabled にする）、理由をツールチップに出す。
- **プリセット**：analyzerType に GPU の ID も保存し、復元できること。

## 4. 設定画面（_applyCapabilities）

GPU タイプのときの表示を次のように決める。

| 区分 | GPU タイプでは |
|---|---|
| 形状（barWidth、density、baseOffset、barDisplayMode、expressionMethod、layers、layerSplit、physics、history、depthAngle、petalCount） | 隠す |
| 残像（afterimageIntensity） | 隠す |
| 動画合成（videoComposite*） | 隠す |
| 背景色（bgColor） | 隠す |
| 色（hue など） | 隠す。色は曲のパレットから自動で決まる、と小さく表示する |
| 感度・平滑化・自動ゲイン | 隠す（GPU タイプは事前解析の時系列を使うため効かない） |
| アスペクト比（16:9 / 1:1） | 有効。描画と書き出しの両方に効く |
| 全画面 | 有効 |
| 書き出し（FPS・画質） | 有効（§5） |

- 隠した設定の値は保持し、2D に戻したら元どおりに表示する。

## 5. 書き出し

- `_initOfflineExport` の開始処理で、`settings.analyzerType` が GPU の ID なら `worldBridge.exportVideo(...)` を使う。
  - 進捗、中止、保存のボタンは本体のものを共通で使う。
  - 保存は `OfflineExporter.save()` を使う。
- 本体の書き出しには独自のファイル選択（`#btn-offline-file`）がある。GPU タイプのときも同じ流れにし、そのファイルで `prepare` を行う（再生中の曲と同じファイルなら使い回す）。

## 6. world.html の扱い

- 利用者向けには廃止する。README と spec から world.html の案内を消し、index.html の GPU タイプとして説明する。
- 既存のブラウザテスト（world*.test.js）の多くは world.html を前提にしている。world.html と world-app.js は `tests/browser/harness/world.html` に移し、テスト専用の画面として残す（パスを更新する）。
- 統合を確かめるブラウザテストを新規に作る：`tests/browser/integration.test.js`。index.html で次を確かめる。
  - GPU タイプを選べる。
  - 曲の読み込み後に描画される。
  - 2D に戻せる。
  - 書き出しで mp4 ができる。
  - マイク入力中は選べない。
  - ディレクターが無効になる。

## 7. 毎フレームの処理

- `VisualizerCore._loop` で、GPU タイプのときは `pipeline.render` とディレクターの描画を呼ばず、`worldBridge.frame()` だけを呼ぶ。
- `audioEngine.captureFrame` は今のまま呼ぶ（MFS の状態維持のため）。
- 2D タイプのときの処理は一切変えない（既存のゴールデンテストがそのまま通ること）。

## 8. 受け入れ条件

- `node tests/run.mjs --unit` が全件合格する（既存の 2D のテストとゴールデンも含む）。
- integration.test.js と、移した world* のブラウザテストが、実 GPU（`CHROME_PATH=~/worktrees/avz-tools/chrome-gpu.sh`、`--headed`）で合格する。実行は Opus が行う。
- Opus が index.html を撮影して判定する：
  - 2D タイプの見た目が変わっていない。
  - GPU の 3 タイプが表示される。
  - 設定の表示が切り替わる。
