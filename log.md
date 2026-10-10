## 2026-10-11

### 作業内容
- README を現行の実装に合わせて更新（使いかたに GPU グループを追記、動作環境に WebGL2、ブラックホール・ストレンジアトラクター・スペクトル流体の説明を最新化。廃止済みの演出の記述を削除）
- GitHub リポジトリの説明（description）とトピック（タグ）を GPU タイプに合わせて更新

## 2026-10-11

### 作業内容
- [WORLD-41〜43] GPU タイプ（スペクトル流体・ブラックホール・ストレンジアトラクター）を本体 index.html に統合。world.html は利用者向けに廃止し tests/browser/harness/ へ移動
- 録画モード: GPU タイプ選択中は #gpu-canvas を録る（Recorder.start(canvasOverride)）。録画中はタイプ選択を固定（自動演出のロックと合成）
- 統合テストの画素読み取りを、engine._draw() 直後の readPixels に変更（preserveDrawingBuffer:false 対策）
- ブラウザテストに avzGpuTest を追加。ハードウェア WebGL2 がない環境（CI ヘッドレス）では GPU テストをスキップし、実機 GPU では従来どおり実行

### 備考
- 実機 GPU で: ゴールデン 42 件一致（2D 不変）、統合テスト INT-01/04/05/06/07 合格。INT-02/03 は画面ロック中に再生待ちでタイムアウト（画面が使える状態での再確認が必要）
- 単体テスト 228 件: 227 成功 / 1 スキップ（既存）

## 2026-10-10 — [WORLD-41] GPU タイプの本体統合

### 作業内容
- 設計 `doc/20261010-design-integration-v1.md` §1〜§7 を実装。GPU の 3 タイプ（g-fluid／g-gargantua／g-attractor）を index.html に 1 本化した。
- 新規 `js/world/world-bridge.js`（`WorldBridge`）：遅延初期化（最初に GPU タイプが選ばれたとき `new WorldEngine`、失敗で `available=false`）、`prepare(file)`（本体の songMapService＋`WorldExporter.prepare`＋`compileWorldScore`、同一ファイルは使い回し）、`selectType`、`frame`（逆シーク・ループで `setScore` 巻き戻し、停止中は描画しない）、`resize`（内部解像度＝表示サイズ×dpr、長辺 1920）、`exportVideo`、`dispose`。純粋関数 `worldBridgeInternalSize`。
- `js/world/score.js`：旧 `WorldSongMapService` の追加処理を純粋関数 `worldAugmentSongMap(map, rows)` に移した。`js/songmap-service.js` に任意の `augment(map, rows)` フック（既定 null）を追加。UIController が `worldAugmentSongMap` を渡す。
- `js/renderer-registry.js`：`gpu: true` の 3 項目（グループ「GPU」、`capabilities: { gpu: true }`、`create` なし）。`RENDERER_GROUP_ORDER` の最後に追加。`listRenderer2DKeys()` を追加。`director-scenes.js` と `director-timeline.js` は GPU 項目を除外し、`capabilities.methods` が無くても例外にならないようにした。
- `js/visualizer-core.js`：`worldBridge` を持ち、GPU タイプ選択中は `pipeline.render` とディレクターを呼ばず `worldBridge.frame()` だけを呼ぶ（`captureFrame` と SongMap テンポ補正は従来どおり）。`resize()` で gpu-canvas の表示サイズも揃える。2D の経路は変更なし。
- `js/ui-controller.js`：`_syncGpuType`／`_updateGpuOptions`／`_revertTo2D`／`_leaveGpuForMic`／`_prepareGpuForActiveFile` を追加。`_applyCapabilities` は GPU タイプなら `body.gpu-type` を付けて 2D の処理をしない（設定値は保持）。ランダムは 2D のみ。マイク開始で GPU を選んでいれば直前の 2D へ戻し、option を disabled＋ツールチップ。`_updateDirectorUI` は GPU 中にディレクターの操作を無効化。書き出しの開始処理は GPU タイプなら `worldBridge.exportVideo` を使い、進捗・中止・保存は本体のものを共通で使う。
- `index.html`／`style.css`／`js/app.js`：`#gpu-canvas`・`#gpu-message`・`#gpu-status`・注記を追加し、設定の各ブロックに `data-gpu-hide`／`data-gpu-only` を付与（CSS `body.gpu-type`）。world 系 script を offline-exporter の後に追加。`#visualizer-area` を `position: relative` にした。
- `world.html` と `world-app.js` を `tests/browser/harness/` へ移動（script パス更新、`world-bridge.js` を追加、`WorldSongMapService` は `worldAugmentSongMap` を使う形に）。単体・ブラウザ・撮影スクリプトの参照を更新。`tests/lib/world-harness.mjs` を追加。
- README・`doc/spec.md` を更新（GPU タイプは index.html、world.html は利用者向けに廃止）。

### テスト
- 追加（単体 8）：`tests/unit/integration.test.mjs` UI-01〜08（レジストリ、ランダム／ディレクター除外、`worldAugmentSongMap` が旧処理と一致、内部解像度、`_applyCapabilities` の GPU 表示切替、WebGL 不可・マイク中の戻し、option の disabled、`WorldBridge.frame`）。
- 修正：`tests/unit/director-timeline.test.mjs`（U18-16／U18-19 は 2D の 8 タイプだけを対象にした）。
- 追加（ブラウザ 7・未実行）：`tests/browser/integration.test.js` INT-01〜07（@page app）。

### 備考
- 判断：書き出し FPS は 25／29.97 の選択肢しかないため、WorldExporter が受ける 30／60 に丸める（59 以上→60、それ以外→30）。ライブ用の事前解析は 60fps 固定。
- 判断：`exportVideo` は設計の引数に `file`・`quality`・`typeId` を足した。
- 判断：録画モードは gpu-canvas を録画しない（2D canvas が対象。設計の範囲外）。

## 2026-10-10 — [WORLD-39] g-fluid v2.1（帯域正規化・差動回転）

### 作業内容
- `js/world/g-fluid2.js`：設計 §12.1・§12.2 を実装。定数 `NORM_TAU=4`・`NORM_FLOOR=.08`・`NORM_GAIN=1.8`（と初期値 `NORM_INIT=.2`）を `WORLD_FLUID2` に追加。帯域ごとの EMA を事前確保の `Float32Array(32)`（`normMean`）で持ち、`reset()`・`warmStart()` で .2 に戻す。`n = clamp(L/max(FLOOR, m*GAIN), 0, 1)`（純関数 `worldFluid2Norm`）を `step()` で `jetLevels`（`Float32Array(32)`）へ書き、`uniform float jetLevels[32]` として移流・染料・合成の 3 パスへ送る。噴出の力・染料・円環の光の粒は `bands[i].x` の代わりに `jetLevels[i]` を使う（瞬きの帯域選びは生の帯域のまま）。
- 背景の回転を差動回転に置換：`vθ(r)=Ωeff*(r<R0 ? r : R0*sqrt(R0/r))`、`smoothstep(2.2,1.4,r)` を掛ける。`BG_SIGMA` と使用箇所を削除。JS 側の同式を `worldFluid2Tangential` として公開（検査用）。
- テスト：`tests/unit/world-fluid2.test.mjs` に UW-F2-09（EMA・正規化・床・clamp・初期値・BG_SIGMA 撤去）と UW-F2-10（vθ の R0 連続・角速度が外側ほど小さい）を追加。UW-F2-01/02 は v2.1 の定数（BG_RELAX 1.5、OMEGA_BASE .55、CURL_AMP .03、SWIRL_ANGLE 50、JET_FORCE 6、JET_DYE 3.5）に追従。他テストの GL モックに `uniform1fv` を追加（world-score、world-attractor）。
- `node tests/run.mjs --unit`：220 件 / 219 成功 / 0 失敗 / 1 スキップ。ブラウザ撮影は未実施（architect の担当）。

### 備考
- 初期値 .2 は定数 `NORM_INIT` として追加した（設計の定数表に名前がなかったため）。

## 2026-10-10 — [WORLD-38] g-fluid v2（円環の噴出口）

### 作業内容
- 新規 `js/world/g-fluid2.js`（設計 `doc/20261010-design-fluid-v2.md` §2〜10）。`WorldFluid2Analyzer`（id `g-fluid`、ラベル「スペクトル流体」、`warmFrames=420`）と凍結定数 `WORLD_FLUID2`（設計の名前と値）。自己完結のソルバー：速度 384×216・圧力 384×216・染料 1152×648（すべて RGBA16F の ping-pong）。1 ステップ＝移流・減衰・背景流への緩和・噴出口の力・キック → 渦度閉じ込め → 発散 → Jacobi 24 回（前フレームの圧力を初期値）→ 勾配 → 染料の移流・減衰・噴出 → 吸収境界。dt は 1/60 固定。合成パス（染料・円環・32 個の光の粒・霞・瞬き）＋塵 12000 点（gl_VertexID の hash、加算ブレンド）。CPU 側は区間表の 2 秒 smoothstep 補間、キック／高域オンセットの検出（`t!==lastEventSec` の g-attractor と同じ方式）、瞬きのリング（最大 24、hash のみ）、カメラ、パレット色相を担当。毎フレーム経路で配列・オブジェクトを確保しない。
- `js/world/world-engine.js`：型一覧の `g-fluid` を `WorldFluid2Analyzer` に差し替え。`WorldFluid`／`WorldParticles`／`WorldDepthParticles`／`WorldSpectrum` の生成・更新・描画、`post.stepFeedback`（`_step`・`redrawTransition`）、`_emitters`／`_emitterPosition`／`_globalFlow`／`_renderFluid`／従来計測口（`composite`・`dyeLoc`・`velocityLoc`）を撤去。`setScore` から旧流体・粒子の reset も除去。`metrics()` の粒子数・格子幅はアクティブなタイプの値（`particleCount`／`fluidWidth`／`dyeWidth` 等）を返し、`feedbackWidth`／`feedbackHeight` は廃止。`_draw` で `post.fluid2` を設定。
- `js/world/post.js`：`fluid2Mode` 分岐（bloom 閾値 .7、強度 .6、feedback なし、露出メーターなし。アトラクター分岐と同じ ACES）を追加。`WORLD_FEEDBACK_FRAGMENT`・`feedbackProgram`・`stepFeedback` を撤去。
- `world.html`：`g-fluid.js` のタグを `g-fluid2.js` に差し替え（post.js より前）。`js/world/g-fluid.js` は削除。README・`doc/spec.md` の流体の説明を更新。

### 旧世界流体・粒子・feedback の撤去判断（grep の結果）
- `engine.fluid`／`engine.particles`／`engine.depthParticles`／`stepFeedback`／`_renderFluid`／`_emitters` の呼び出し元は、旧 `g-fluid.js`（削除）と `g-rings.js` だけだった。`g-rings.js` は WORLD-13 で登録から外れており、`WORLD_ANALYZER_TYPES`・`selectType` のどちらからも到達できない（回帰計測 BW-11/BW-12 が `new WorldRingsAnalyzer()` を手で登録していた）。g-gargantua・g-attractor は一切使っていない。よって撤去した。
- `js/world/fluid.js`・`js/world/particles.js`・`g-rings.js` のファイルと world.html のタグは残した（ticket は生成・更新・描画の停止だけを要求。g-rings.js が参照するため、ファイル削除は別判断）。engine からは到達不能のデッドコード。g-rings は旧 `engine.particles` が無いため実行すると失敗する（登録されないので影響なし）。
- `post.feedback` の ping-pong 対（半解像度）は、レガシー分岐の history サンプラーと露出メーター寸法の都合で割り当てだけ残した。毎ステップの書き込み（`stepFeedback`）は止めている。
- UBO（World ブロック）の emitters 領域は書かなくなった。std140 の配置は変更していない（UW-28 は無修正で合格）。
- g-gargantua／g-attractor の挙動は変更なし（UW-67・UW-68〜70・UW-84〜96 すべて合格）。

### テスト
- 追加（単体 8）：`tests/unit/world-fluid2.test.mjs` UW-F2-01〜08（定数表・登録／噴出口の角度と位置／区間表と補間／キック 1 フレーム／瞬きの包絡と位置の決定性／塵の視差／暖機窓 420・GPU 命令回数（移流 1・渦度 1・発散 1・Jacobi 24・射影 1・染料 1・合成 1・塵 12000 点）／CPU 状態の再演）。
- 追加（ブラウザ 4・未実行）：`tests/browser/world38.test.js` BW-38-jets（帯域 5 だけ染料が出る・キックで外向き速度）／BW-38-sections（1280×720・7 区間・白飛び ≤2%・同時刻の再演一致）／BW-38-gpu（1080p p95 ≤16ms）／BW-38-export（typeId `g-fluid` の書き出し）。
- 修正した単体テスト：UW-06（Jacobi 24 回・塵 12000・格子 384×216）／UW-08／UW-11（CPU ステップ数は `type.step` を数える）／UW-14（feedback 寸法の検査を除去）／UW-25／UW-27／UW-33（emitters 領域→型の帯域レベル）／UW-39／UW-66（feedback の回数検査を除去）／UW-47（シェーダー総数 33、vertex 7、fragment 26）／UW-90（g-fluid の描画 601→420、feedback 検査を除去）／UW-91（`feedbackProgram` 不在を確認）。world-score のモック GL に `uniform2fv`・`uniform1ui` を追加、読み込み一覧を `g-fluid2.js` へ。
- **削除した単体テスト ID**：UW-15（旧粒子 262144 点・WORLD_PARTICLE_VERTEX）／UW-21（feedback 履歴）／UW-29（1.5 倍領域の旧流体格子・旧 GLSL）／UW-37（旧独立深度層）／UW-38（旧 220 度円弧の噴出点と移流）／UW-45（g-rings の火花、旧 `engine.particles` に依存）。
- **削除したブラウザテスト ID**：BW-10-focus-depth・BW-10-v8-times（`tests/browser/world10.test.js` ごと削除。旧粒子・feedback の汚染検査）／BW-9-depth-loop（旧粒子の 3 層・ループ端の画素一致）／BW-12-sparks-ramp（g-rings の火花と旧大域流の CPU/GPU 一致）。計測スクリプト側（`tests/browser/world.test.js`・`tests/world/measure.mjs`、runner 非登録）では BW-6-coverage・BW-3-hero を撤去し、W-3 を新流体の格子・塵数（384／1152／12000）の検査に置換、BW-2-matter は新流体の合成像の可視画素へ、BW-7-motion は粒子速度の代わりに新流体の速度場を使うよう変更。
- 修正したブラウザテスト：BW-9-spectrum（噴出口の画素位置を円環＋カメラ・ズームから計算）／BW-11 の回帰計測（g-rings を対象外、g-fluid・g-galaxy）／BW-12-design（g-rings を除外）。ゴールデン（`tests/golden/frames.json`）は 2D アナライザー用で旧 g-fluid に依存しないため変更なし。`tests/world/output/` の過去の撮影物は未更新。

### 検証
- `node tests/run.mjs --unit`：218 件／217 成功／0 失敗／1 スキップ。`node --check`：変更した全 .js／.mjs で合格。ブラウザテスト・Chrome 実行は未実行（Opus が実施）。コミット・プッシュなし。

### 判断（設計が曖昧／書かれていない点）
- 速度・圧力の RG16F は `WorldGL.target()` が RGBA16F 固定のため RGBA16F で確保（.xy のみ使用）。
- 格子の領域は canvas 比率ではなく固定の `SIM_ASPECT=16/9`（x∈[-16/9,16/9]）にして、セルを正方形・決定性を canvas 非依存にした。吸収境界もこの領域の端。合成は画面座標 q から流体面 p=q*zoom+cam を引く（canvas が 16:9 より広いと左右は暗い）。
- ズームは設計どおり `p_screen /= zoom`（ズーム>1 で縮小＝引き）。流体面 p = q*zoom + cam。
- 渦度閉じ込めは `dv = VORT * CELL * (N_y, -N_x) * ω * dt`（CELL は格子のワールド幅 2/216）。カールノイズは値ノイズの有限差分の回転で、`CURL_AMP` を直接掛けた（勾配の大きさは ≈1 のオーダー）。
- 追加した設計外の定数（見た目の決定を避ける中立値のみ）：`BG_SIGMA=.7`（設計の式の .7）、`JET_FORCE_SIGMA=.035`・`JET_DYE_SIGMA=.022`・`KICK_WIDTH=.10`（設計の式の値）、`HUE_SAT=.75`・`HUE_SPAN=.85`、`DUST_SPREAD=1.25`（塵の配置範囲）、`DUST_FAR_DIM=.6`（遠い層の減光：設計の「遠いほど暗い」の具体値）、`GLINT_LIFE=3`（瞬きの枠の寿命、包絡はこの前に ≈0）、瞬きの明るさに追加ゲインなし（設計の包絡×形のまま）。
- 噴出口の力・染料は最寄りの噴出口の左右 ±3 個（7 個）だけ評価（σ の 3 倍以上は無視できるため。全 32 個の和と数値的に同じ）。円環の線の色は最寄りの噴出口の色相。
- 塵の位置は canvas のアスペクトに依存する（画面端まで届けるため）。それ以外は seed と画面比だけで決まる。
- 時刻 0（dt=0）のステップ・端数時刻（dt=0）では流体を進めない（`simPending = dt>0`）。ライブでも 1 ステップ＝1/60 固定。キックの衝撃は `_simulate` が使い切ると 0 に戻る。
- 暖機：`reset()` で次の描画前にクリア、CPU のみの区間から暖機窓へ入るときは engine の `warmStart(t)` でクリア。`warmStart` は描画前のクリアのみ。

## 2026-10-10 — [WORLD-36/37] ブラウザテストの追従（曲長・粒子数）

### 作業内容
- `tests/browser/world31.test.js`（BW-31-gpu）: 粒子数の期待値を `2097152` の直書きから `WORLD_ATTRACTOR.PARTICLE_COUNT` の導出へ変更。iframe 内の `child.eval` の戻り値に `expectedParticles:WORLD_ATTRACTOR.PARTICLE_COUNT` を追加し、`avzAssert.equal(result.particles,result.expectedParticles)` で比較する（現在の値は 1572864）。
- 同ファイルに `PARTICLE_H`・`DECAY` の直書きは無いため変更なし。

### 検証
- `node --check tests/browser/world31.test.js`: エラーなし。
- `node tests/run.mjs --unit`: 216件／215成功／0失敗／1スキップ、30,660ms。
- ブラウザテスト・Chrome 実行は未実行（作業指示どおり）。コミット・プッシュは未実施。

### 備考
- 曲長側（WORLD-36）の `tests/browser/world11.test.js`（BW-11-export の `SONG_CONST.MIN_DURATION_SEC+2` の曲）は、本チケット着手時点で作業ツリーに未コミットで存在しており、本チケットでは触れていない。`world31.test.js` の `durationSec` も据え置き。
- 前エントリ（WORLD-35）の備考にあった `world31.test.js:82` の 2097152 との比較は、本エントリで解消。

## 2026-10-10 — [WORLD-35] g-attractor 性能

### 作業内容
- `js/world/g-attractor.js`（設計 §11 の 1〜5）:
  1. カメラ基底を CPU 化。`_updateCameraBasis()` が `step` 内で 1 回だけ位置・前・右・上（roll 適用済み）を事前確保の `Float32Array(3)`×4 に書く。頂点シェーダーは `uniform vec3 camPos,camForward,camRight,camUp` を受け取り、三角関数・normalize・cross を使わない。旧 `camera` uniform と `cameraLoc` は撤去。
  2. 廃止した散乱の残骸（`z`・`phi`・`r` の hash 2 回と sqrt）を削除。
  3. グリントの hash は `music.y > GLINT_EPS` のときだけ評価。`GLINT_EPS: .01` を `WORLD_ATTRACTOR` に追加（GLSL 定数へ自動展開）。
  4. 色の重みを三角関数なしに変更（`n = L>1e-6 ? v/L : vec2(1,0)`、`w1=.5+.5n.x`、`w2/w3` は定数 `COS2`/`SIN2` との内積）。帯域番号 k のみ `atan`。
  5. `PARTICLE_H` 768、`PARTICLE_COUNT` 1572864、`DECAY` .90。
- `tests/unit/world-attractor.test.mjs`: UW-84・UW-91 を新定数に追従（個数は `PARTICLE_W*PARTICLE_H`、描画数・storage 寸法は `WORLD_ATTRACTOR` から導出）。UW-96 を新規追加（旧 cos 式との色重み一致 64 方向 <1e-6、CPU カメラ基底と旧 GLSL 式の一致 36 通り <1e-6、シェーダー整理の文字列検査、配列再利用）。

### 検証
- `node tests/run.mjs --unit`: 216件／215成功／0失敗／1スキップ。`node --check`: `g-attractor.js`・`world-attractor.test.mjs` エラーなし。
- ブラウザテスト・Chrome 実行・BW-31-gpu は未実行（Opus が実施）。`tests/browser/world11.test.js` には触れていない。

### 備考
- `tests/browser/world31.test.js:82` は `result.particles` を 2097152 と比較している。新粒子数 1572864 に追従が必要（今回は未変更）。
- 判断: `GLINT_EPS` は設計の指定どおり定数表へ追加したため、UW-84 の期待表にも加えた。右基底 `normalize(cross(forward,(0,1,0)))` は `(-fz,0,fx)` の正規化へ展開（等価）。

## 2026-10-10 — [WORLD-34] 数字キーのタイプ選択

### 作業内容
- `js/world/world-app.js`: keydown の数字キー処理を `Digit[1-9]` にマッチさせ、`n = Number(e.code.slice(5))` を `WORLD_ANALYZER_TYPES` の `key` で線形探索（アロケーションなしの for ループ）する形へ変更。現在のタイプ表（key 1〜3）では 4〜9 が割当なしで、従来の `WORLD_ANALYZER_TYPES[n-1].available` の未ガード参照による TypeError（Digit4〜6）が出ていた。割当があり `available` の場合のみ `e.preventDefault()` と `selectType(type.id)` を呼ぶ。
- `world.html`: TYPE 選択の aria-label を「GPUアナライザー（1〜6）」から「GPUアナライザー（1〜3）」へ変更（残存タイプ数に合わせる）。
- `tests/unit/world-keys.test.mjs`（新規）: `world-app.js` を実物のまま読み込み、WebGL・音声・書き出しだけをstubに置き換えて keydown を発火する。UW-94 で割当なしの数字（タイプ表の key にない 1〜9）が例外なく無視され、preventDefault と選択中のタイプが変わらないことを検査。UW-95 で割当済みの数字がタイプ表の key・id から導出した該当タイプを選ぶこと（Digit3→g-attractor）を検査。期待値はすべて `WORLD_ANALYZER_TYPES` から導出。

### 検証
- 修正前の `js/world/world-app.js` で UW-94 を実行し、`Digit4` の `Cannot read properties of undefined (reading 'available')` で失敗することを確認。UW-95 は修正前から成功。
- `node tests/run.mjs --unit`: 215件／214成功／0失敗／1スキップ、84,591ms。修正前のベースラインは 213件／212成功／0失敗／1スキップ。
- `node --check`: `js/world/world-app.js`・`tests/unit/world-keys.test.mjs` エラーなし。`world.html`・`log.md` は構文チェック対象外。
- ブラウザテスト・Chrome実行は作業指示により未実行。コミット・プッシュは未実施。

### 備考
- `doc/spec.md`・`README.md` は変更なし（数字キーの割当や「1〜6」の記述はなし）。
- `tests/browser/world11.test.js`（BW-11-types）は Digit4 を押す。修正後は TypeError が出なくなるが、ブラウザ実行は未実施のため結果は未確認。
- 前エントリ（WORLD-33）の備考に残していた2件（`world-app.js` のキー処理・`world.html` の aria-label）は本エントリで解消。

## 2026-10-10 — [WORLD-33] 準備中タイプの撤去

### 作業内容
- `js/world/analyzer-types.js`: 準備中の `g-ribbons`（光のリボン・key 5）と `g-kaleido`（万華鏡フィードバック・key 6）を `WORLD_ANALYZER_TYPES` から削除。g-fluid（key 1）・g-gargantua（key 2）・g-attractor（key 3）は値を変えていない。同ファイル先頭の注記「未実装の2枠は選択不能」も対象がなくなったため削除。
- `tests/unit/world-score.test.mjs`: UW-39のタイプID期待値を3件へ更新。ログ出力の `availableTypes` を固定値 3 から `WORLD_ANALYZER_TYPES` の `available` 件数へ導出。
- `tests/browser/world11.test.js`: BW-11-types のスロット数（旧 5）と利用可能数（旧 3）を、iframe 内の `WORLD_ANALYZER_TYPES` から導出するよう変更。Digit2・Digit3の選択とcrossfadeの期待値は変更なし。
- `README.md`・`doc/spec.md`: 「5・6は準備中／予約枠」の記述のみ削除。

### 検証
- `node tests/run.mjs --unit`: 213件／212成功／0失敗／1スキップ（既存U15-00の想定スキップ）、98,852ms。
- `node --check`: `js/world/analyzer-types.js`・`tests/unit/world-score.test.mjs`・`tests/browser/world11.test.js` すべてエラーなし。Markdown（README.md・doc/spec.md・log.md）は構文チェック対象外。`git diff --check`: 問題なし。
- ブラウザテスト（BW-11-types を含む）・Chrome実行は作業指示により未実行。

### spec.md 変更
- §1.1「TYPEで…を切り替える。」の直後にあった「5・6は後続タイプの予約枠として選択不能で表示する。」を削除。理由: 準備中枠を撤去し、追加タイプは不要とオーナーが決定したため。版番号・改訂理由の行は変更していない。

### 備考
- 未対応（本体コード・チケット範囲外）: `js/world/world-app.js:60-61` のキー処理は `WORLD_ANALYZER_TYPES[n-1].available` を未ガードで読むため、削除後は Digit4〜6 の押下で TypeError が出る（状態は変わらず、コンソールのみ）。削除前も Digit6 は同じ経路で TypeError だった。`type && type.available` の1行ガードが必要。
- 未対応（本体コード・チケット範囲外）: `world.html:26` の `aria-label`「GPUアナライザー（1〜6）」は残存タイプに合わせて更新が必要。
- 未対応（文書・チケット範囲外）: `doc/20261004-concept-world-mode.md` の一覧表（93〜94行目）に g-ribbons／g-kaleido の構想表記が残る。過去の設計・履歴文書（`doc/20261008-design-attractor-v1.md` の「g-terrain（準備中）」、過去の log.md）は変更していない。
- BW-11-types の Digit4 押下（未割当キーで選択が変わらないこと）は残し、期待値 `g-attractor` は変えていない。ハーネスは親windowの error だけを監視するため、この TypeError でテストが失敗する可能性は低い（未実行のため推定）。

## 2026-10-09 — [WORLD-32] g-attractor §10 テスト追従

### 作業内容
- `tests/unit/world-attractor.test.mjs`: UW-84の定数表を設計§10のDECAY・PALETTE_TINT・KICK_BREATH・TRANS_*・SWIRLへ追従。POINT_GAINと暖機後の密度減衰の期待値/測定値をWORLD_ATTRACTORから導出。
- `tests/unit/world-attractor.test.mjs`: UW-86の遅延・飛行中点・端点・1,204サンプルの参照式をTRANS_STAGGER/TRANS_FLIGHT/TRANS_SECONDSから導出し、GLSLの遅延式も確認。UW-88のカメラ表を§10の距離へ更新し、補間の期待値をWORLD_ATTRACTOR_CAMERA、切替時刻をCAMERA_EASE_SECONDSから導出。
- `tests/unit/world-attractor.test.mjs`: UW-89で散乱の不使用とGLSLの`P*=1.+KICK_BREATH*music.x`を検証。実シェーダーの倍率式をCPU評価し、無反応・ピーク・減衰時の粒子間距離の相似性を検証。表示の呼吸が状態更新本体に入らないことも確認。周回/包絡の派生期待値はWORLD_ATTRACTORから導出し、二重消費防止とreset再演を保持。
- `tests/unit/world-attractor.test.mjs`: UW-93の測定時刻をTRANS_SECONDSから求める完了直前の60fpsフレームへ変更。A/B暖機と末尾WARM_FRAMES枚の更新回数、イベント数を定数/フレーム数から導出。完了境界のA/B入替と1組だけの更新を追加し、両時点で最適化経路と全CPU上演の状態一致を確認。
- `tests/browser/world31.test.js`: 確認のみ。KICK_SCATTERの参照がないため変更なし。`log.md`: 本エントリを先頭に追加。production codeは変更していない。

### 検証
- 修正前 `node --test tests/unit/world-attractor.test.mjs`: 10件／6成功／4失敗（UW-84・86・88・93）／0スキップ、176.255458ms、終了コード1。指定の失敗を再現。
- 修正途中の同コマンド: 10件／9成功／1失敗（UW-89）／0スキップ、176.368625ms、終了コード1。全シェーダー共通の定数宣言にもKICK_BREATHが入るため、状態更新への混入検査を実行本体へ限定して訂正。
- 修正後 `node --test tests/unit/world-attractor.test.mjs`: 10件／10成功／0失敗／0スキップ、172.971875ms、終了コード0。
- `node tests/run.mjs --unit`: 213件／212成功／0失敗／既存U15-00の想定スキップ1、26,838ms、終了コード0。
- 全JS/MJS `node --check`: 133件／133成功／0失敗、6,884.188208ms、Node v26.7.0、終了コード0。`git diff --check`: 成功。
- UW-84: 粒子2,097,152、定数31件、720p POINT_GAIN=.004218749999999999、DECAY^WARM_FRAMES=.00001007953491379838。
- UW-86: 変身1,204サンプル、遅延.5秒／飛行1.1秒、最大式誤差0。UW-88: ショット450項目／切替15項目、最大式誤差0。
- UW-89: 音量5ケース、包絡の最大Float32誤差9.149755064719045e-9。呼吸の粒子間距離33ケース、ピーク倍率1.06／.18秒後1.0220727670192717、最大相似倍率誤差2.220446049250313e-16、イベント再演誤差0。
- UW-93: CPU709ステップ、暖機開始10.3秒、完了直前11.783333333333333秒、A/B更新262パス（暖機82＋90枚×2）。11.8秒の完了後は1パスだけ更新、グリント24イベント、両時点のCPU状態差0。
- 新規/更新ブラウザテストなし。既存BW-31-state/render/gpu/exportと全ブラウザスイート・file://目視確認は、依頼のChrome/browser禁止に従い未実行。GPUの描画結果・性能は測定していない。

### spec.md 変更
- なし。既存設計へのテスト追従のみで、製品の振る舞いは変更していない。

### 備考
- 判断: 設計§10が旧§3〜5・§7の値/散乱式に優先する。定数表/カメラ表そのものの一致検査は設計値を明示して保持し、派生期待値だけを定数/テーブル参照へ変更する。
- 判断: UW-93の旧12秒では1.8秒の変身が終わっているため、完了直前の整数フレームを選び、従来のA/B暖機窓の検証意図を維持。完了境界も追加検証する。テスト削除・スキップ追加・既存許容誤差の緩和なし。
- 逸脱: 設計からの逸脱なし。一般ガイドのブラウザ実行/目視確認・commit/push/PRは、今回の明示制約を優先して実施しない。外部ライブラリ/build/npm追加、ネットワーク利用なし。作業用出力はworktree内に置き、専用一時ログは記録後に削除。

## 2026-10-08 — [WORLD-31] g-attractor v1

### 作業内容
- `js/world/g-attractor.js`: SSOT `doc/20261008-design-attractor-v1.md` §1〜8を実装。WORLD_ATTRACTORの指定定数、固定7形、区間割り当て、カメラ表、seed付きuint hashを追加。2048×1024粒子のRGBA32F ping-pongをA/B二組、出力解像度のRGBA16F密度ping-pong、40反復暖機、写像更新、1画素点の加算、密度減衰と露出トーンマッピングを実装。
- `js/world/g-attractor.js`: 3秒の遅延付き再組み立て・Y軸の渦・色補間、低域オンセットの表示散乱、高域オンセットの部分集合グリント、32帯域の方向別光、区間内/切替のsmoothstepカメラと音量周回積分を追加。GPU資源は初期化/resizeで確保し、変身終了後も再利用。再描画は密度/粒子を進めない。
- `js/world/world-engine.js`: タイプ登録、warmFrames/statelessRenderの共通描画条件、CPUのみの区間から暖機窓へ入る際のwarmStartを同期advanceToと非同期renderAt/advancePreviewへ適用。g-attractorのfeedbackを除外し、postモードへ接続。既存g-fluid/g-gargantuaの条件と結果は保持。
- `js/world/post.js`: g-attractor専用分岐、bloom閾値.6/強さ.8、sceneからの光学仕上げを追加。feedbackと自動露出縮約を使わない。
- `js/world/analyzer-types.js`・`world.html`: g-terrain予約枠をkey3/availableのストレンジアトラクターへ置換し、classic script読込順へ追加。
- `tests/unit/world-attractor.test.mjs`: UW-84〜93を追加。定数、形/割り当て、変身の端点/単調/遅延、hash/グリント決定性、カメラ表/補間、イベント、GPU命令/暖機窓、資源再利用、CPU状態一致を検証。
- `tests/unit/world-score.test.mjs`・`tests/unit/world-shaders.test.mjs`: 新script依存と登録期待値を同期。全26シェーダーのprecision監査へ拡張。既存のテスト/閾値は削除・緩和していない。
- `tests/unit/world-exporter.test.mjs`: UW-42をg-gargantuaとg-attractorの両方へ適用し、typeIdだけで180枚の書き出しと初期即時選択が動くことを確認。既存world-exporterはtypeIdを透過するため製品コードの変更不要。
- `tests/browser/world31.test.js`: BW-31-state/render/gpu/exportを記述。実GLSLの初期化/写像、6区間、180連続変身フレーム、キック/グリント、逆シーク再演、同期GPU p95、実WebCodecs音声入り書き出しを検査。`tests/browser/world11.test.js`のキー3/available期待値も追従。
- `README.md`・`doc/spec.md`: 選択可能なkey3と設計書への参照を追加。`log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 213件／212成功／0失敗／既存U15-00の想定スキップ1、140,520ms、終了コード0。
- 全JS/MJS `node --check`: 133件／133成功／0失敗、66,466.577ms、Node v26.7.0、終了コード0。
- `node --test tests/unit/world-score.test.mjs tests/unit/world-shaders.test.mjs`: 45件／45成功／0失敗、5,974.487791ms、終了コード0。26シェーダー（vertex6/fragment20）のヘッダー不一致0。
- `node --test tests/unit/world-attractor.test.mjs tests/unit/world-exporter.test.mjs`: 13件／13成功／0失敗、918.322917ms、終了コード0（UW-93追加前）。初回のattractor単独実行は9件／8成功／1失敗、936.086958ms。フェードのmock期待値121を、既存の1/60累積丸めで32枚＋暖機90枚＝122へ訂正し、製品の0.5秒フェードは変更していない。
- `node --test --test-name-pattern=UW-93 tests/unit/world-attractor.test.mjs`: 1件／1成功／0失敗、524.513541ms、終了コード0。最終UW-84〜93全10件は上記全スイートで成功。
- UW-84: 粒子2,097,152、定数31件、720p POINT_GAIN=.006328125000000001、DECAY^90=1.7508410260531964e-8。UW-85: 割当30ケース、7,000写像反復、最大座標絶対値2.9957042379444028で各ex/ey内。
- UW-86: 変身1,204サンプル、端点/遅延/単調性、最大式誤差0。UW-87: hash100,000粒子、グリント選択405粒、serial変更799粒/seed変更810粒、再演誤差0。
- UW-88: カメラ450成分＋切替15成分、最大Float64式誤差0。UW-89: 音量5ケース、キック包絡の最大Float32誤差9.149755175741348e-9、イベント再演誤差0。
- UW-90: 10秒でCPU601ステップ/GPU描画90回/warmStart1回。g-fluid601回、g-gargantua1回を保持。1ステップ前進は暖機を繰り返さず描画1回。時刻0要求は1回描画。feedbackはg-attractorで0回。
- UW-91: RGBA32F状態4枚、初期化/40反復/通常更新計42パス、変身開始43パス、両組の暖機82パス、GPU資源増加0、再描画の粒子更新0、feedback/自動露出0。UW-92: 同形境界の変身0、短区間の宛先引継ぎJ→Hを確認。
- UW-93: 12秒でCPU721ステップ、変身中の暖機開始10.516666666666667秒、両組暖機82＋90×2更新＝262パス、高域イベント25、全CPU上演とcamera/bands/music/形/イベント時刻の差0。
- UW-42: g-gargantua/g-attractorそれぞれ180符号化フレーム、即時選択、初期フェードなし（encoder/engine mock）。`git diff --check`: 成功。
- 新規BW-31-state/render/gpu/exportと更新BW-11-typesを含むブラウザスイートは依頼の禁止に従い未実行。実GLSLコンパイル、実画像の美しさ/散乱/渦、file://コンソール、実WebCodecs、1920×1080 GPU p95≤16msは未測定。上記の数値はCPUまたは命令mockの結果。

### spec.md 変更
- key3の選択可とSSOT参照を追加。設計の定数/式は転記せず、既存タイプの仕様文章は変更していない。

### 備考
- 判断: 形の「2回目以降かつvariation奇数」は3・5…でF/Ccへ切替。カメラ§7の「variationが奇数なら」は文面どおり初回1も含む1・3・5…でroll/yaw速度を反転する。UW-85/88で両者を区別して検証。
- 判断: hashアルゴリズムが未指定のため、uint32の決定的混合と上位24bitの[0,1)変換を採用。CPU/GLSLで同じ演算とし、Float32丸めで1になることを避ける。初期座標2成分と散乱の単位球方向は固定serialを使う。
- 判断: 3秒未満の区間で変身が重なったら進行中の宛先Bを旧形Aへ引き継いで次の変身を開始。同じ宛先の境界では再開始しない。CPUだけでBを通過した場合は次の暖機窓で現在形をseed初期化する。
- 判断: 密度の全画面減衰は同一textureの読書きが禁止なので二枚のRGBA16Fを交代する。resetはGPU再初期化を保留し、最初の描画またはwarmStartで40反復する。GPUを省略した区間のCPU状態は連続して保持。
- 判断: postの未指定の合成細部は既存g-gargantuaのbloom重み/ACES/sRGB変換/.75固定倍率を再利用し、指定強さ.8を適用。新しい美術調整、veil、キックの二重増光、自動露出、feedbackは加えない。
- 判断: w13syncの具体コードは指定されていないため、BW-31-gpuでは既存engineのdisjoint timer queryを使い、各描画後のgl.finishで同期し次フレームでqueryを回収する。実ハードウェア/120以上のサンプル/disjoint0/p95≤16msを検査する。未実行のため性能達成は主張しない。
- 制約/逸脱: SSOTの指定定数・数式を独自調整していない。曖昧な細部は依頼に従い上記判断で継続。一般ガイドのbranch/commit/PR/全ブラウザ確認は、今回の.git読取専用・commit/push禁止・ネットワーク禁止・Chrome禁止を優先し未実施。外部依存/build/npm追加なし。新規の毎フレーム経路に配列/オブジェクト/クロージャの生成なし。作業用ファイルはworktree内に作成して削除。

## 2026-10-08 — [WORLD-30] ブラックホール不動・星の反応・カメラショット

### 作業内容
- `js/world/g-gargantua.js`: 設計書 `doc/20261004-design-gargantua-v1.md` §10.20を実装。QUAKE_*、DROP_GRAVITY/HORIZON/DISK_INNER、GRAVITY_EASE_*、gravityAmount関係、SECOND_DROP_*を撤去。gravityはresetで(GRAVITY, Rs, DISK_INNER)=(1.5,1,3)へ設定し、stepで変調しない。キック包絡・光速の筋は保持。
- `js/world/g-gargantua.js`: STAR_HIGH_GAIN=1.5、ORBIT_LOUD_GAIN=.8、ORBIT_MIN=.5、ORBIT_MAX=1.6、SWAY_DEGREES=1.0を指定名/値で共有定数に設定。高域側bandsSmooth[24..31]の生平均をview2.wへ格納し、starfieldの戻り値へ指定倍率を掛ける。瞬きと露出式を保持し、周回積分へ音量倍率のclampを追加。
- `js/world/g-gargantua.js`: 6kindのカメラ表を7項目の始点/終点へ更新。第2回以降のdropはdist=27、inc=-6→-8、roll=-10→-12、offX=-9へ置換し、周回/円盤係数はdrop表のまま。再登場奇数variationでroll/offXを反転。区間内progressと区間切替4秒の双方にsmoothstepを適用し、全7項目を補間。view2の固定バッファ、location、uniform転送を追加。traceRayでは視線オフセット→right/up再計算→ロールの順に基底を作る。
- `tests/unit/world-gargantua.test.mjs`: UW-48を新ショット表/全項目補間へ更新、UW-52のsurge検証とUW-79のquake検証を固定重力の区間切替/キック/再演へ置換。UW-53/78の廃止定数・旧starfield式の参照を同期。UW-80（variation）、UW-81（音量clamp/高域8本平均）、UW-82（製品GLSLのview2式をCPU評価/撮影投影の往復）を追加。光速の筋300ケースと既存の閾値は保持。
- `tests/world/shoot-live.mjs`: world17Geometryのview2転送と撮影時のview2保存を追加。world17View/world17Projectで製品と同じ基底を計算し、world17Arcsは穴の投影位置から影を抽出し、元のカメラ基底の上下をview2画面へ投影して弧を測る。UW-83で画面中央が背景となる片寄せ/ロールの合成画素を検証。既存の撮影時刻・合否閾値は変更なし。
- `tests/browser/world13.test.js`: 撮影記録へview2を追加。BW-13-view2を記述し、実GLSLのキック前後の幾何一致、正offXによる左寄せ、hi=0→1の星空倍率2.5、GLエラー0を検証する。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 203件／202成功／0失敗／既存U15-00の想定スキップ1、26,529ms、終了コード0。
- `node --test tests/unit/world-gargantua.test.mjs`: 最終20件／20成功／0失敗／0スキップ、97.925625ms、終了コード0。作業途中の初回は19件／16成功／3失敗、99.651458ms（旧starfield式assert、廃止QUAKE定数assert、新variation期待値の符号付き0）。旧参照を更新し、variationは補間のFloat64丸めを考慮して誤差<1e-14で検証した。
- `node tests/world/shoot-live.mjs --unit`: 10件／10成功／0失敗／0スキップ、40.434917ms、終了コード0。
- 全JS/MJS `node --check`: 130件／130成功／0失敗、6,764.282ms、Node v26.7.0、終了コード0。`git diff --check`: 成功。
- UW-48: 表6行×7項目、区間内30ケース、遷移35項目。最大Float32誤差2.384185793236071e-8、ease=4秒、inc揺れ=1度。
- UW-52/79: 区間/時刻42ケース、キック48ケースでgravity=(1.5,1,3)固定、重力差0、reset再演誤差0。キック包絡の最大誤差2.4057007830258215e-8。
- UW-80: 6kind×variation1..5×progress4点=120ケース。初回は表どおり、第2dropの円盤係数1.35、3/5回目で左右反転を確認。
- UW-81: 音量7ケース（範囲外を含む）で周回倍率clamp=.5..1.6、azim指定式の誤差0、dt=0の変化0。高域8本平均=.4375、星空倍率=1.65625。
- UW-82: 8姿勢×3azim×2縦横比×9光線=432ケース、撮影投影と製品GLSLのCPU評価の最大光線誤差2.220446049250313e-16。1280×720でoffX=+9度の穴中心x=346.66576892603086（中央x=640）、ロール90度で右方向が画面下へ向くことを確認。
- UW-83: 片寄せ/ロールの合成影317画素、影半径10.045109950630787画素、上弧厚み7/下弧2、上弧比.6968564838417156。中央を起点とする旧前提では失敗し、view2投影では成功。
- 上記はCPU/合成画素の測定。新規BW-13-view2、更新した撮影記録・world17Geometry/world17Arcs/実音撮影・既存ブラウザスイートはChrome禁止に従い未実行。実GPU p95≤16ms、7ショットの見た目、実画像のキック前後の影の縁、file://コンソール確認は未測定。

### spec.md 変更
- なし。依頼で指定された5ファイルのみ編集し、README/spec/設計書は変更していない。

### 備考
- 判断: 「同じ種類の区間が再び出てくるとき（variationが奇数）」は、初回variation=1を除き3・5…に左右反転を適用すると解釈。第2dropの行へ置換してから符号を反転する。
- 判断: 区間内は正規化した線形時刻pへsmoothstepを掛けて始点→終点を補間し、切替時は従来の4秒smoothstepを別に適用。揺れを含まない全7項目のcameraShotを遷移元に使い、incの揺れを重複させない。
- 判断: starfieldの明るさへの倍率という指定に従い、星と既存の薄い背景を合成した戻り値全体へ高域倍率を掛ける。高域平均はWorldBandAnalyzerの正規化後levelを使わず、生のbandsSmoothを使う。
- 判断: 弧の上下は元のカメラのup/rightに沿う測定点を新構図へ透視投影する。影の面積由来の半径・測定閾値・直接像/背景除外は保持。中央構図の合成テストにはviewなしの従来位置を許容する。
- 制約/逸脱: 設計の定数/式を独自調整していない。初回反転などの曖昧さは上記の通り記録して継続。一般ガイドのREADME/spec更新と全ブラウザ実行は、今回の許可ファイル/Chrome禁止を優先して実施しない。実装の毎フレーム経路に新たな配列/オブジェクト/クロージャ確保なし。外部ライブラリ/build/npm追加なし、ネットワーク/Chrome/commit/push/PRなし。作業用出力はworktree内に置き、記録後に削除。

## 2026-10-08 — [WORLD-29] §10.19 テスト追従

### 作業内容
- `tests/unit/world-gargantua.test.mjs`: UW-49の生成半径と範囲の期待値をWORLD_GARGANTUA.LIGHT_STREAK_INNER/OUTERから導出。Float32Arrayへ格納される半径はMath.froundした期待値と厳密一致で検証し、範囲・循環プール・イベント・再演の検証を保持。
- `tests/unit/world-gargantua.test.mjs`: UW-78の先頭角度・尾・LOD幅/中心係数・寿命・発光量・加算HDRの期待値をWORLD_GARGANTUAの定数から導出。前方の尾も指定の指数式で検証し、後方より暗いことを確認。測定ログを計算結果へ同期し、300ケースと既存の誤差許容値を保持。
- `log.md`: 本エントリを先頭に追加。製品コード・設計書・他テストは変更していない。

### 検証
- 修正前 `node --test tests/unit/world-gargantua.test.mjs`: 17件／15成功／2失敗（UW-49の旧生成半径、UW-78の旧尾定数）／0スキップ、91.242791ms、終了コード1。依頼で指定された失敗を再現。
- 修正後 `node --test tests/unit/world-gargantua.test.mjs`: 17件／17成功／0失敗／0スキップ、146.100334ms、終了コード0。
- `node tests/run.mjs --unit`: 200件／199成功／0失敗／既存U15-00の想定スキップ1、26,911ms、終了コード0。ランナーのtests/output/report.json生成によるgit管理対象の変更なし。
- 全JS/MJS `node --check`: 130件／130成功／0失敗、7,108.213ms、Node v26.7.0、終了コード0。`git diff --check`: 成功。
- UW-49: 生成半径6.353639125823975（定数の範囲5.5〜9）、Float32期待値との誤差0、プール8本/15イベント、reset再演誤差0。
- UW-78: 300ケース、最大式誤差8.881784197001252e-16、60fpsでの先頭移動17.142857142857146度、尾の定数1.6rad後方で.36787944117144233、LOD幅.6000000000000001/中心係数.1333333333333333、半寿命のfade=.25、寿命外発光0、2本の加算HDR=25.2。CPU評価であり実GPU測定ではない。
- 新規/更新ブラウザテストなし。Chrome禁止に従いブラウザテスト・file://確認は未実行。

### spec.md 変更
- なし。テストの定数追従のみで、製品の振る舞いは変更していない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: アーキテクトが更新済みの定数一致assertは保持し、派生期待値だけを定数参照へ変更。半径のFloat32丸めを明示して厳密比較し、閾値を緩和していない。前方の尾の旧固定上限は定数から求める指数式の比較へ置換。計画の定数/式の独自調整・テスト削除/スキップ追加なし。
- 制約: 指定のscratchpad/CODEX_ADDENDUM.mdは存在せず、scratchpad内の検索でも見つからなかった。依頼本文のno commit/push/PR/Chromeを適用し、IMPLEMENTER_RULES.mdと実装者ガイド・関連仕様/設計を確認。編集はこのworktreeの対象テストとlog.mdだけ。
- レビュアー確認: 開始時から存在する設計書§10.19・製品定数5件・定数一致assertの変更と、本チケットの派生期待値の変更を区別して確認すること。UW-49のMath.fround厳密比較と、UW-78の定数由来の尾/LOD/HDR期待値を確認。実GPUの見た目/性能は本チケットでは再検証していない。

## 2026-10-08 — [WORLD-28] 光速の筋・全体の鳴動

### 作業内容
- `js/world/g-gargantua.js`: SSOT `doc/20261004-design-gargantua-v1.md` §10.18を実装。HOTSPOT_*定数とケプラー速度で漂う光の塊の計算を撤去し、LIGHT_STREAK_*・QUAKE_*を指定名/値でJS/GLSL共有定数へ追加。uniformをstreaks[8]、CPUプールを32要素へ変更し、streakSerial/streakLocへ参照を統一。
- `js/world/g-gargantua.js`: 高域オンセットのbit4、イベントhashのprefix/seed、同時刻二重消費防止、highOnsetPhaseを保持。半径3.2〜4.6・初期角度・誕生時刻・回転方向+1を循環プールへ格納。diskSample内でhead=a0+speed*age、modによる後方角度距離、指数の尾、lfによる幅と光量補正、二乗の寿命減衰、白との50%混合色を指定式どおり加算。未来/寿命切れは加算しない。
- `js/world/g-gargantua.js`: 低域オンセットのlastKickとKICK_SECONDS=.18の包絡を更新した後、gravity[0]へ指定の3%/9Hzの鳴動係数を毎step乗算。既存drop重力easeの基準値を毎step設定してから乗算し、再描画で累積しない。gravity[1]/[2]は従来の式を保持。
- `tests/unit/world-gargantua.test.mjs`: UW-49を筋の8本プール/範囲/方向/誕生時刻/シード/再演へ置換し、既存キック・連続イベント・無拍反応の検証を保持。UW-78で共有定数、製品GLSLループをスカラーJSへ変換したCPU検証（先頭角度/尾/LOD半径/寿命/色/加算）を追加。UW-79で通常/dropの鳴動、包絡、位相再開、非累積、再演を追加。
- `tests/unit/world-score.test.mjs`: UW-43/67の状態比較をstreaksへ同期。live/renderAt/逆シークの決定性と、途中GPU描画省略時の2701CPU更新の比較を維持。
- `tests/world/shoot-live.mjs`: removed hotspot参照のあるuniform転送/状態保存/無効化プールだけをstreaksとLIGHT_STREAK_COUNTへ同期。撮影/判定閾値は変更しない。
- `tests/browser/world13.test.js`: removed hotspot参照のあるBW-13-renderのuniform状態検査を筋の8本プールへ置換し、撮影前復元コメントの寿命を.7秒へ同期。
- `tests/browser/world14.test.js`: removed hotspot参照のあるuniform転送と星の除外コメントだけを筋へ同期。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 200件／199成功／0失敗／既存の想定U15-00スキップ1、27,970ms、終了コード0。既存ランナーのtests/output/report.json出力はgit管理対象の変更なし。
- `node --test tests/unit/world-gargantua.test.mjs`: 17件／17成功／0失敗／0スキップ、90.462458ms、終了コード0。初回は追加テストの単項マイナスと指数演算の構文エラーで失敗し、括弧を修正して再実行した。製品定数/式の調整なし。
- `node tests/world/shoot-live.mjs --unit`: 9件／9成功／0失敗／0スキップ、30.239125ms、終了コード0。UW-65: JS定数28、GLSL定数12、欠落定数0。
- 全JS/MJS `node --check`: 130件／130成功／0失敗、8,030.387ms、Node v26.7.0、終了コード0。`git diff --check`: 成功。
- UW-49: kick100ms=.5737534165382385、プール8本/15イベント、生成方向+1、寿命.7秒、reset再演誤差0。UW-51: 従来イベントhashとの60ケースの一致を維持。
- UW-78: 5age×5角度×3半径×4画素幅の300ケースを製品GLSLの式と比較し、最大誤差8.881784197001252e-16。連続6フレームの先頭角度は60fpsで毎フレーム17.142857142857146度、1周.35秒。尾の1.2rad後方は.36787944117144233、中心の半径係数1、rd=4/lf=.1でLOD幅.6・中心係数.08333333333333333、age=.35のfade=.25。age<0とage>=.7の発光0、2本の中心でスカラーtint=.8を白と混合した加算HDR=16.2。
- UW-79: 通常/drop×8ageの16ケースでFloat32の指定鳴動式との最大誤差0。9Hzの正の四分周期でgravity[0]=1.5385648012161255/2.1539907455444336、負の四分周期で1.471676230430603/2.0603466033935547（通常/drop）。位相再開/reset再演誤差0、同時刻の二重更新非累積、低域のみで筋を生成しないことを確認。
- 上記の式の数値はCPU評価であり、実GPU/画像の測定値ではない。更新したBW-13-render（実コンパイル/GLエラー/8本上限）・world14ReadGeometryのuniform転送・shoot-liveのworld17Geometry/world17ShaderChecks/world17RenderCheck/撮影時状態保存はChrome禁止に従いブラウザで未実行。独立した新規ブラウザテストは追加していない。実GPU p95、画素決定性、見た目、file://コンソールは未検証。

### spec.md 変更
- なし。依頼の許可ファイル7件だけ編集。開始時から存在した設計書の§10.18追加（31行）は保持し、本作業では変更していない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: §10.18の定数/式を独自調整していない。LIGHT_STREAK_SPEEDは2*Math.PI/.35として定義し、LIGHT_STREAK_LAP=.35との指定関係をテストする。回転方向は生成時のw=+1に固定し、先頭式は指定どおりa0+speed*ageを使用する（BPM/ケプラー係数を掛けない）。色は既存diskSampleのtintを白へ50%混合して筋だけへ適用。
- 判断: プールの初期無効時刻-100、生成契機/シード、寿命の範囲外除外は既存処理を流用。配列はconstructorで確保し、製品JSの毎フレーム経路に新たな配列/オブジェクト/クロージャ確保なし。鳴動はmusic[0]のFloat32包絡を使い、既存のdrop重力へ乗算する。uniformのFloat32丸めを含めて検証。
- 制約: 指定のscratchpad/CODEX_ADDENDUM.mdは存在せず、セッションディレクトリ内の検索でも見つからなかった。依頼本文のno commit/push/PR/Chromeを適用し、IMPLEMENTER_RULES.md、実装者ガイド、関連仕様/レンダラー契約を確認。編集はこのworktree内だけ。commit/push/PR/ブラウザ起動なし。
- レビュアー確認: 実WebGL2で製品/更新プローブのコンパイルとGLエラー0を確認。高域オンセット直後の連続6枚（1/60秒間隔）で約17度/フレームの筋と後方の尾が見え、ゆっくり漂う塊が残らず、直接像/上弧/光子リングへ映ることをOpusが撮影して判定。キック直後の2フレームで影の縁が数画素揺らぐこと、星空/弧も同時に揺らぐこと、実GPU p95<=16ms、画素決定性、file://コンソールエラー0も確認すること。
- レビュアー確認: 既存`tests/browser/world14.test.js:37`は旧4引数/vec4戻り値のtraceRay呼び出しを保持し、新out署名と不一致。BW-14-periodicにも廃止済みfilamentInput/fbmの呼び出しが残る。今回の許可はremoved hotspot参照箇所だけなので、それらの既存の不一致は編集していない。WORLD-14ブラウザ検証を実行する前に担当者が署名/関数名を同期する必要がある。

## 2026-10-08 — [WORLD-27] ケプラー巻き込みの2位相化

### 作業内容
- `js/world/g-gargantua.js`: SSOT `doc/20261004-design-gargantua-v1.md` §10.17を実装。FLOW_PERIOD=8、FLOW_PHASE_OFFSET=17.3、SHEAR_FACTOR=1.5を既存のJS/GLSL共有定数へ追加。streakInputは位相別のtauと番号を受け取り、回転はomega*tau、zの時刻項はmusic.w*STREAK_TIMEを維持し、1/2位相のオフセットを加える。
- `js/world/g-gargantua.js`: streakFlowで半周期ずらしたtau1/tau2のfbmを2回評価し、指定の三角重みw1/w2で混合して指定の平方和による分散復元を適用。diskSampleは混合結果を使う。streakFbmのLOD比に位相別の巻き込みを加え、各オクターブの半径/角度周波数をFBM_FREQUENCYで更新。§10.11の平均値補填と§10.16の画面微分/解析fallback/中心lf共有を保持。
- `tests/unit/world-gargantua.test.mjs`: UW-53の旧FLOW_禁止から新しい2定数だけを除外し、他の旧定数禁止を維持。UW-63の製品ループ評価を新署名へ同期し、tau=0で従来の平均補填/未減衰値を検証。UW-72のLOD比を新式へ同期。UW-75〜77で共有定数/入力/混合の構造、製品の重み/混合式のCPU評価、tauリセットの連続性/ゼロ重み/和1/分散復元、オクターブ別のLOD比/上限/平均補填を追加。
- `tests/world/shoot-live.mjs`: 変更したGLSL関数を呼ぶworld17ShaderChecksと、その署名を照合するUW-65だけ更新。継ぎ目は混合後のstreakFlowで比較し、diskSampleの色/不透明度の期待値には混合後の未減衰値を使う。単位相の全減衰ノイズ平均の検証を維持。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 198件／197成功／0失敗／既存の想定U15-00スキップ1、29,081ms、終了コード0。既存ランナーのtests/output/report.json出力はgit管理対象の変更なし。
- `node --test tests/unit/world-gargantua.test.mjs tests/unit/world-shaders.test.mjs`: 16件／16成功／0失敗／0スキップ、84.69575ms、終了コード0。UW-47の21シェーダー（vertex5/fragment16）ヘッダー失敗0。
- `node tests/world/shoot-live.mjs --unit`: 9件／9成功／0失敗／0スキップ、27.04725ms、終了コード0。UW-65: JS定数27、GLSL定数12、欠落定数0、新streakInput呼び出し3、新streakFbm呼び出し1、streakFlow呼び出し3、diskSample呼び出し2の署名を照合。
- 全JS/MJS `node --check`: 130件／130成功／0失敗、8,305.204666ms、Node v26.7.0、終了コード0。`git diff --check`: 成功。
- UW-75: FLOW_PERIOD=8、FLOW_PHASE_OFFSET=17.3、位相オフセット17.3/34.6、SHEAR_FACTOR=1.5、fbm評価2回、各4オクターブを確認。
- UW-76: t=0〜192を0.1秒刻みの1,921標本で評価し、重みは0..1、w1+w2の最大誤差0。4秒刻みの48リセット境界の前後±1e-7秒で、リセットする位相の重み0、重みの左右差最大1.7763568394002505e-15。不連続になる合成ノイズを指定混合式へ与えた出力の左右差最大3.500000034240003e-8。半々の重みの分散復元倍率1.4142135623730951。
- UW-77: 5画素幅×4角速度×4tau×4オクターブの320比を比較し、最大誤差2.2737367544323206e-13。全減衰時の単位相平均.46875を維持。rd=3/music.z=1で基底オクターブの実効周波数はt=20で84.3/60、t=45で90.375/66.075、t=90で72.15/96.45、8秒上限108.6（STREAK_RADIALの1.81倍）。これらはCPUの式評価であり、実GPU/画像の測定値ではない。
- ブラウザ用に更新した既存プローブ: world17ShaderChecksの継ぎ目、streakFbmのLOD/平均補填、混合後のdiskSampleの色/不透明度。Chrome禁止に従い未実行。独立した新規ブラウザテストファイルは追加していない。実GLSLコンパイル/リンク、実GPU画素決定性、GPU p95、見た目、0.1秒刻み撮影の輝度段差、file://コンソールは未検証。

### spec.md 変更
- なし。指定4ファイルだけ編集。開始時から存在した設計書の§10.17追加（22行）は保持し、本作業では変更しない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: §10.17の定数/式を独自調整していない。位相番号は指定どおり1/2を使用。新しいstreakFlowへ混合処理をまとめ、製品と測定プローブで同じ値を使う。オクターブのA_kは既存FBM_FREQUENCY=2.03の逐次乗算で作る。JSの毎フレーム経路の変更/新規確保なし。
- 判断: 平均値の基準も指定どおり.5を使用し、単位相fbmの平均.46875への独自補正や追加clampをしない。shoot-liveは変更した関数を呼ぶプローブと静的署名照合だけ同期し、撮影/合否の閾値を変更しない。既存の単位相の全減衰平均と、分散復元後の混合値を区別して検証する。
- 制約: 指定のscratchpad/CODEX_ADDENDUM.mdは存在せず、scratchpad内の検索でも見つからなかった。依頼本文のno commit/push/PR/Chromeを適用し、IMPLEMENTER_RULES.md、実装者ガイド、関連仕様/レンダラー契約を確認。編集はこのworktree内だけ。commit/push/PR/ブラウザ起動なし。
- レビュアー確認: 実WebGL2で製品シェーダーと更新したworld17ShaderChecksのコンパイル/リンク・GLエラー0を確認。t=20/45/90で縞の細かさとコントラストが同程度、どの時刻でもモアレがないことをOpusが撮影して判定。4秒おきの位相リセット付近を0.1秒間隔で連続撮影し、輝度段差<2%を確認。fbm評価2倍後の実GPU p95<=16ms、同じtの画素決定性、file://のconsoleエラー0も確認すること。
- レビュアー確認: 前チケットで記録された許可範囲外の`tests/browser/world14.test.js:37`の旧4引数/vec4戻り値traceRay呼び出しは依然残っている。今回のtraceRay署名変更はなく、ここは編集していない。既存WORLD-14ブラウザテストを実行する前に担当者が新out署名へ同期する必要がある。

## 2026-10-07 — [WORLD-26] 画面微分LOD

### 作業内容
- `js/world/g-gargantua.js`: SSOT `doc/20261004-design-gargantua-v1.md` §10.16を実装。DERIV_SCALE=1.0、LF_MAX=1.0を既存のJS/GLSL共有定数へ追加。traceRayを交点記録へ変更し、MAX_CROSSINGS=3のout配列hitA（x/z/累積距離/曲がり角）、hitB（正規化方向/有効値）、hitCount、逃走状態/方向を返す。shadeHitsで手前から奥へ従来式のalpha合成を行い、逃走時だけ星空を加える。
- `js/world/g-gargantua.js`: mainの中心追跡直後、条件分岐外の固定3回ループだけでlog半径のdFdx/dFdyと有効性のfwidthを計算。微分が有効ならdL*DERIV_SCALE、それ以外は従来のfp/rd（GRAZEとturn補正）を使用し、どちらも0..LF_MAXへclamp。streakFbmをlog単位のlf*frequencyで減衰し、§10.11の平均値補填を保持。リング8点は同じ交差番号の中心lfを共有し、中心に交点がない番号だけ自身の解析値を使う。
- `tests/world/shoot-live.mjs`: 変更したGLSL署名の呼び出し部分だけ更新。geometryプローブはtraceRayのdirectRadius出力を読む。streakFbmプローブはfp/rdへ引数を換算し、diskSampleプローブは解析値指定を追加。UW-65の呼び出し/署名照合も同期。
- `tests/unit/world-gargantua.test.mjs`: UW-53/62/63の構造/署名/オクターブ式を更新し、既存の定数・8点格子・曲がり角・平均補填の検証を保持。UW-72〜74でout配列初期化/交点記録、微分の一様な制御フロー、中心lf共有、解析値への復帰、上下限、32ケースの従来合成との一致を追加。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 195件／194成功／0失敗／既存の想定U15-00スキップ1、25,568ms、終了コード0。既存ランナーのtests/output/report.json出力はgit管理対象の変更なし。
- `node --test tests/unit/world-gargantua.test.mjs tests/unit/world-shaders.test.mjs`: 13件／13成功／0失敗／0スキップ、81.459042ms、終了コード0。UW-47の21シェーダー（vertex5/fragment16）ヘッダー失敗0。
- `node tests/world/shoot-live.mjs --unit`: 9件／9成功／0失敗／0スキップ、23.897292ms、終了コード0。UW-65: JS定数27、GLSL定数11、diskSampleプローブ2呼び出し、欠落定数0。
- 全JS/MJS `node --check`: 130件／130成功／0失敗、6,091.797ms、Node v26.7.0、終了コード0。`git diff --check`: 成功。
- UW-72: 最大交点3、微分呼び出し3種類各1箇所、main直下の固定3回ループ、リング8点すべてで中心lf共有、DERIV_SCALE=1/LF_MAX=1。
- UW-73: dFdx=.003/dFdy=.004でlf=.005。解析値は半径3/6/12で.19328616553376388/.09664308276688194/.04832154138344097。近隣の有効性の不連続・交点なし・追加交点では解析値へ復帰し、両経路のclamp下限0/上限1を確認。
- UW-74: 交点0〜3・逃走有無・中心交点数0〜3の32ケースで、遅延合成と従来の前方合成の最大RGB誤差0、交点の順序/距離/方向/turnの受け渡しと直接像半径6の保持を確認。
- UW-62: fp基準=.02133180196881958、grazing上限=.4266360393763916、turn最大倍率=544.571910125929、両補正最大倍率=10891.438202518579、リング8点/追跡計9本/平均重み.125を維持。UW-63: 全減衰時のノイズ平均=.46875、未減衰=.328125、部分減衰=.1453180911078717。既存のUW-49/52/67などCPU再演/決定性テストも成功。
- ブラウザ用に更新した既存プローブ: world17Geometryの交点/直接像測定、world17ShaderChecksのstreakFbm/diskSample。Chrome禁止に従い未実行。独立した新規ブラウザテストファイルは追加していない。実WebGL2コンパイル/リンク、実GPU画素決定性、GPU p95、t=45/90の見た目とfile://コンソールは未検証。上記の数値はCPUの式評価・合成標本によるもので、実GPU測定値ではない。

### spec.md 変更
- なし。指定ファイルだけ編集。開始時から存在した設計書の§10.16追加（28行）は保持し、本作業では変更しない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: §10.16の定数/式/閾値を独自調整していない。配列長は既存のMAX_CROSSINGS=3を使用。未使用out配列をゼロ初期化し、一様な微分計算で未定義値を読まない。未使用交点のlog/解析値計算には設計の1e-3ガードを使用。中心に交点がないサブサンプルと既存プローブの解析値指定にはlf=-1を使用し、有効なlfは常に0以上にclampする。新たな製品JSの毎フレーム配列/オブジェクト確保なし。
- 判断: closest/directPhi/background/directRadiusの既存測定出力と高次像除外を保持。中心の微分が不連続で解析値になった場合も、その中心lfを同じ交差番号の8点へ共有する。shadeHitsの合成順序/alpha式/逃走時の星空は変更しない。
- 制約: 指定のscratchpad/CODEX_ADDENDUM.mdは存在せず、scratchpad内の検索でも見つからなかった。依頼本文のno commit/push/PR/Chromeを適用し、IMPLEMENTER_RULES.md、実装者ガイド、関連仕様/レンダラー契約を確認。編集はこのworktree内の指定4ファイルのみ。commit/push/PR/ブラウザ起動なし。
- レビュアー確認: 実WebGL2（GLSL ES 3.00）で製品シェーダーと更新したshoot-liveプローブのコンパイル/リンク・GLエラー0を確認。t=45/90でモアレがなく、t=45の縞の細かさ/明るさがv25と同程度であることをOpusが撮影して判定。実GPU p95<=16ms、同じtの画素決定性、file://のconsoleエラー0を確認すること。
- レビュアー確認: 編集許可外の`tests/browser/world14.test.js:37`（world14ReadGeometry）には旧4引数/vec4戻り値のtraceRay呼び出しが残っている。新署名との不一致を静的に確認したが、指定範囲に従い編集していない。shoot-liveのworld17Geometryは更新済み。既存WORLD-14ブラウザテストを実行する前に、担当者がworld14ReadGeometryプローブを新out署名へ同期する必要がある。

## 2026-10-07 — [WORLD-25] G-kick前値・SECOND_DROP_GAIN

### 作業内容
- `tests/world/shoot-live.mjs`: SSOT `doc/20261004-design-gargantua-v1.md` §10.15に従いWORLD17_CHECKSへPRE_WINDOW=.10を追加。world17RealKickのbeforeを直前PRE_WINDOWのinner最小値へ変更し、別オンセットによるロール判定もPRE_WINDOWを使用。後最大値のKICK_SECONDS=.18と合格条件increase>=.35を維持。UW-58の名称と記録開始の説明コメントを更新。
- `js/world/g-gargantua.js`: SECOND_DROP_GAINを1.5から指定値1.25へ変更。
- `tests/unit/world-kick.test.mjs`: UW-70でPRE_WINDOW=.10を照合。UW-71を新定義に更新し、前窓内の最小値、前窓外の低値/オンセットの除外、後窓の最大値、前後端点、オンセット当時の値の前窓からの除外、ロール候補を飛ばした次の休止候補、ロールだけの窓の集計除外を検証。前後標本不足/ROI欠落/非有限値/弱キック/GPU失敗の拒否は維持。
- `tests/unit/world-gargantua.test.mjs`: UW-48でSECOND_DROP_GAIN=1.25、第一dropの円盤係数1.35、第二dropの円盤係数1.6875を照合。全6kind・カメラease・距離/速度の既存検証を維持。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 192件／191成功／0失敗／既存の想定U15-00スキップ1、26,422ms、終了コード0。既存ランナーがtests/output/report.jsonへ結果を保存。
- `node --test tests/unit/world-kick.test.mjs tests/unit/world-gargantua.test.mjs`: 13件／13成功／0失敗／0スキップ、78.755042ms、終了コード0。
- `node tests/world/shoot-live.mjs --unit`: 9件／9成功／0失敗／0スキップ、24.350458ms、終了コード0。
- UW-48: 第一drop円盤係数1.35、SECOND_DROP_GAIN=1.25、第二drop円盤係数1.6875、第二drop距離27・速度.09。UW-70: 合成innerの前最小値1、後最大値1.35、increase=.3500000000000001、前6標本/後11標本で成功、1.3499は失敗。
- UW-71: 合成innerの前最小値2（前2標本は2/4）、後最大値2.7、increase=.3500000000000001。前窓左端t-.10と後窓右端t+.18を含む。ロール判定の左端の別オンセットは非適用、左端より1µs前の別オンセットは対象外。次の休止候補=1.2秒、ロールだけの窓はapplicable:false。100ms標本は要求しない。
- UW-58: 合成画面ピーク増加=.36000000000000004、前6/後11標本で成功。UW-61: mock撮影t=7秒、lag=0、記録先頭6.683333333333334秒、撮影後25標本、期間.40000000000000036秒、44転送をpause後に読み戻し。UW-64: buffer/fence漏れ0、再試行1回。
- 全JS/MJS `node --check`: 130件／130成功／0失敗、6,591.397ms、終了コード0（Node v26.7.0）。説明コメント更新後の`node --check tests/world/shoot-live.mjs`も成功。`git diff --check`: 成功。
- ブラウザへ注入されるworld17RealKickのG-kick判定を更新したが、Chrome禁止に従い実GPUのshoot-liveは未実行。新規の独立ブラウザテストファイルは追加していない。実再生の画面輝度・GLSLコンパイル・GPU p95・file://のconsole・見た目は未検証。上記の数値はCPU/合成標本/モックによる検証であり実GPUの測定値ではない。

### spec.md 変更
- なし。指定ファイルのみ編集。開始時から存在した設計書の§10.15追加（8行）は保持し、doc/spec.mdとREADME.mdは変更しない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: §10.15のみ実装し、定数/閾値を独自調整していない。区間端点の既存ルールを継承し、前区間は[t-.10,t)、後区間は[t,t+.18]。前後各2標本とROI有効性を維持。前標本がない場合のbefore=0と失敗判定を維持し、非適用に変えない。
- 判断: 候補開始は既存の撮影時刻-.15秒、記録開始は既存の撮影時刻-.15-.18秒を維持。PRE_WINDOW=.10秒の履歴を十分含むため、world12Shootの記録開始やUW-61は変更不要。旧.18秒のロール用合成標本は、新しい.10秒以内の連続オンセットへ更新した。製品の毎フレーム経路に新規確保の追加なし。
- 制約: 指定のscratchpad/CODEX_ADDENDUM.mdは存在せず、scratchpad内の検索でも見つからなかった。依頼本文のno commit/push/PR/Chromeを適用し、IMPLEMENTER_RULES.md、実装者ガイド、関連仕様/レンダラー契約を確認して進めた。編集はこのworktree内の上記5ファイルのみ。commit/push/PR/ブラウザ起動なし。
- レビュアー確認: 実GPUのshoot-liveで7/20/31/45/62/90秒を撮影し、applicableな全時刻で§10.15のG-kick>=35%、GPU p95<=16msを確認。beforeが前.10秒の最小値であること、ロール判定が前.10秒であることと非適用時の集計除外を確認。第二dropの倍率1.25と、休止時でも内側が暗く沈みすぎないことをOpusが撮影して判定。実GLSLコンパイルとfile://直開きのconsoleエラー0も確認すること。

## 2026-10-07 — [WORLD-24] KICK_REST・G-kick定義

### 作業内容
- `js/world/g-gargantua.js`: SSOT `doc/20261004-design-gargantua-v1.md` §10.14に従いKICK_RESTを.40へ変更。
- `tests/world/shoot-live.mjs`: world17RealKickの前平均/後最大値の窓を製品と同じKICK_SECONDS=.18にし、increase>=.35で判定。直前.18秒に別のオンセットがある候補を飛ばし、休みのある候補がなければapplicable:false、reason「休みのないロール」にする。100ms測定フィールド・条件・専用定数を削除。集計は既存の適用対象判定とGPU判定を使用。候補窓の先頭にも直前.18秒の履歴を確保するため、実再生の記録開始を撮影時刻-.15-.18秒へ前倒し。UW-58とUW-61を新しい契約へ更新。
- `tests/unit/world-kick.test.mjs`: UW-68のKICK_RESTと実musicGain式の期待値を更新。UW-70のピーク35%境界・標本不足/ROI欠落/無効値/弱キック/GPU失敗の拒否を更新。UW-71を追加し、前.18秒の平均、後.18秒以内の単フレーム最大値、区間端点/区間外、100ms条件撤去、後続オンセット、ロールを飛ばして次の休止候補を使うこと、ロールだけの窓の除外を検証。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 192件／191成功／0失敗／既存の想定U15-00スキップ1、74,730ms、終了コード0。UW-68〜71、既存の決定性UW-08/32/43/67、タイプ契約UW-39、feedback UW-21、export UW-34〜36/42も成功。既存ランナーがtests/output/report.jsonへ結果を保存。
- `node --test tests/unit/world-kick.test.mjs tests/unit/world-gargantua.test.mjs`: 13件／13成功／0失敗／0スキップ、394.813959ms、終了コード0。
- `node tests/world/shoot-live.mjs --unit`: 最終9件／9成功／0失敗／0スキップ、72.599541ms、終了コード0。初回は9件／8成功／1失敗、190.348875ms。UW-61が旧記録開始6.85秒を期待し、実際は6.683333333333334秒だったため、前倒し後の記録開始以上の最初の60Hz標本であることを検証する期待値へ更新して再実行。定数・式・閾値を独自調整していない。
- UW-68: CPUで評価した製品GLSLの内縁休止係数=.4、ピーク係数=1.8、ピーク/休止=4.5倍、100ms係数=1.203254789032406。100msは包絡の回帰確認だけで、G-kickの合否には使わない。UW-69: mock GLのkick uniform=.6000000238418579、他3タイプは0。
- UW-70: 合成innerの前平均1、後最大値1.35、increase=.3500000000000001、前10標本/後11標本で成功、1.3499は失敗。UW-71: 前平均2、後最大値2.7、increase=.3500000000000001、後.18秒の端点も成功、次の休みのある候補=1.2秒、ロールだけの窓はapplicable:false。適用数からロールを除外し、GPU失敗は引き続き不合格。UW-58: 合成画面ピーク増加=.3600000000000002、前10/後11標本で成功。
- UW-61: mock撮影t=7秒、lag=0、記録先頭=6.683333333333334秒、撮影後25標本、期間=.40000000000000036秒、44画素転送をpause後に読み戻し。UW-64: 各試行のGPU drain2回、各drainのrAF2回、再試行1回、buffer/fence漏れ0。
- 全JS/MJS `node --check`: 130件／130成功／0失敗、35,346.023ms、終了コード0（Node v26.7.0）。`git diff --check`: 成功。
- ブラウザへ注入されるworld17RealKickのG-kick判定とworld12Shootの記録開始を更新したが、Chrome禁止に従い実行していない。world17ShaderChecksは製品のKICK_REST=.40を使って実GLSLの休止/ピークゲインを照合する経路だが、これも未実行。実再生の画面輝度・GLSLコンパイル・GPU p95・file://のconsole・見た目は未検証。上記の数値はCPU/合成標本/モックによる検証であり実GPUの測定値ではない。

### spec.md 変更
- なし。指定ファイルのみ編集。開始時から存在した設計書の§10.14追加（18行）は保持し、doc/spec.mdとREADME.mdは変更しない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: 依頼末尾の「Do not stop for ambiguity: decide」に従う。KICK_SECONDSは製品の.18を使用し、候補の開始位置は既存の撮影時刻-.15秒を維持。候補直前の履歴を追加して、履歴内のオンセットもロール判定へ含める。
- 判断: 直前区間は[t-.18,t)、直後区間は[t,t+.18]（「以内」に従い右端を含む）。前後各2標本とROIの有効性は既存条件を維持し、前平均が0以下またはinnerが非有限値の場合はapplicable:trueの失敗にする。100ms標本や区間末までの標本を追加要求せず、区間内の後続オンセットも拒否しない。選んだ休止候補の標本不足は非適用扱いにしない。
- 制約: 指定のscratchpad/CODEX_ADDENDUM.mdは存在せず、scratchpad内の検索でも見つからなかった。依頼本文のno commit/push/PR/Chromeを適用し、IMPLEMENTER_RULES.md、実装者ガイド、関連仕様/レンダラー契約を読んで進めた。編集はこのworktree内の上記4ファイルのみ。製品の毎フレーム経路に配列/オブジェクト/クロージャの新規生成なし。設計の定数/閾値の独自調整なし。
- レビュアー確認: 実GPUのshoot-liveで7/20/31/45/62/90秒を撮影し、applicableな全時刻で新定義のG-kick>=35%、GPU p95<=16msを確認。ロールだけの窓のreason「休みのないロール」と集計除外、候補前.18秒の履歴、100ms条件撤去を確認。KICK_REST=.40でも休止時の内側が暗く沈みすぎないことをOpusが撮影して判定。実GLSL probeとfile://直開きのconsoleエラー0も確認すること。

## 2026-10-07 — [WORLD-23] g-gargantua キックの脈動

### 作業内容
- `js/world/g-gargantua.js`: SSOT `doc/20261004-design-gargantua-v1.md` §10.13のKICK_REST=.55、KICK_GAIN=3.5、KICK_SECONDS=.18、KICK_BLOOM=.8を名前付き定数にし、musicGainのinnerと休止時/キック時の乗算を指定式そのままで実装。
- `js/world/post.js`: kickの事前初期化・uniform location・送信を追加。gargantua分岐のbloomとb3のVEIL_GAINに指定の(1.+KICK_BLOOM*kick)を掛け、ACESの前に適用。
- `js/world/world-engine.js`: _drawでg-gargantuaのtype.music[0]だけをpost.kickへ渡し、他タイプは0にする1行だけを追加。
- `tests/world/shoot-live.mjs`: G-kickのapplicableと100ms時点25%条件、全帯域の標準偏差<1e-3の場合のG-1非適用、STAR_PIXELS=30を反映。実GLSL probeのピーク/休止ゲイン期待値も指定式へ更新。集計に適用対象のG-kickと既存GPU判定を追加し、非適用の窓は除外。UW-56〜58を新しい契約へ更新。
- `tests/unit/world-gargantua.test.mjs`: UW-49の減衰時間、UW-52のKICK_GAIN、UW-54の星画素境界を現行SSOTへ更新。
- `tests/unit/world-kick.test.mjs`: UW-68〜70を追加。製品GLSLのスカラー式を評価し、休止/ピーク/100ms/半径境界、実engine→post→uniformと他3タイプの0、ブルーム/フレア式、無分散/無キックの除外と閾値境界、標本不足/ROI欠落/弱キック/重複オンセット/GPU失敗の拒否を検証。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 191件／190成功／0失敗／既存の想定U15-00スキップ1、73,676ms、終了コード0。UW-68〜70と既存の決定性UW-08/32/43/67、タイプ契約UW-39、feedback UW-21、export UW-34〜36/42も成功。既存ランナーがtests/output/report.jsonへ結果を保存。
- `node --test tests/unit/world-kick.test.mjs tests/unit/world-gargantua.test.mjs`: 12件／12成功／0失敗／0スキップ、429.327ms、終了コード0。
- `node tests/world/shoot-live.mjs --unit`: 9件／9成功／0失敗／0スキップ、26.576625ms、終了コード0。
- UW-49: 実Analyzerの100ms後のFloat32包絡=.5737534165382385。UW-68: CPUで評価した製品GLSLの内縁休止係数=.55、ピーク係数=2.475（休止時の4.5倍）、100ms係数=1.6544753349195584、exp(-.1/.18)=.5737534207374327、exp(-.47/.18)=.07345288408931808。
- UW-69: mock GLへのkick uniform=.6000000238418579、他3タイプは0。入力光量2のブルーム休止/ピーク=1.8/3.24、フレア=.2/.36。100ms時点の両倍率=1.4590027365899463。GPUの画素/輝度実測ではない。
- UW-70: 全帯域の標準偏差.000999は除外、1帯域の標準偏差.0010000000000000002は適用。合成画面輝度の増加=.3500000000000001、100ms=.25は成功。集計の適用数G-1/G-kick=1/1。UW-54/57: 星30/31画素は成功、29/0画素は失敗。
- 全JS/MJS `node --check`: 130件／130成功／0失敗、26,104.899667ms、終了コード0（Node v26.7.0）。
- 対象単体テストの初回は12件／11成功／1失敗、84.621375ms。UW-70の合成標本1.35を6回加算した平均が1.3499999999999999（増加.34999999999999987）となり35%境界を下回った。境界テストを既存の最小標本数2で平均できる入力にし、通常6標本は36%とした。製品の式・定数・閾値・許容誤差は変更していない。
- `git diff --check`: 成功。今回の変更は指定された製品3ファイル・shoot-live・関連ユニット2ファイル・log.mdの7ファイルのみ。開始時から存在した設計書の変更は保持。
- ブラウザ側で実行されるworld17ShaderChecksのピーク/休止ゲインとworld17Correlation/world17RealKickの判定を更新したが、Chrome禁止に従い実行していない。実再生・実GLSLコンパイル・GPU p95・file://・console・見た目の受け入れは未検証。

### spec.md 変更
- なし。指定ファイルだけを編集し、doc/spec.mdとREADME.mdは変更しない。開始時から変更済みの設計書（§10.13の23行追加）は保持。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: 依頼末尾の「Do not stop for ambiguity: decide」を適用。G-1の分散は撮影窓の全音声level標本の母分散とし、ROIの欠落と独立に判定。空標本は無分散の根拠がないので非適用扱いにせず失敗を維持。キックが存在して前標本/100ms標本/ROIが不足する場合もapplicable:trueの失敗とする。
- 判断: 既存の撮影ツールはG-kickとGPUのpassを表示するだけで終了コードへ反映していなかった。§10.13の集計除外・受け入れに従い、world23LiveAcceptanceで適用対象G-kickと既存world13PerformanceのGPU条件も全体の合否に反映する。新しいGPU閾値は追加していない。
- 制約: 指定されたscratchpad/CODEX_ADDENDUM.mdは存在せず、/private/tmp/claude-501内のファイル検索でも見つからなかった。依頼本文に明記されたno commit/push/PR/Chromeを適用し、IMPLEMENTER_RULES.md、実装者ガイド、関連仕様/レンダラー契約を読んで進めた。全編集はこのworktree内のみ。毎フレームの製品経路に配列/オブジェクト/クロージャの新規生成なし。定数の独自調整なし。
- レビュアー確認: 実GPUのshoot-liveで20/31/45/90秒のキックがある窓すべてについてG-kick>=35%、100ms>=25%、GPU p95<=16msを確認すること。7/62秒などの無キック/無分散の窓がapplicable:falseで集計から除外され、標本不足は失敗のままであること。キックの間でも内側の弧が暗くなりすぎないことを撮影してOpusが判定すること。星>=30、実GLSL probe、file://直開きのconsoleエラー0、他タイプのキックuniform=0を確認すること。CPU/モックの検証はこれらの実GPU受け入れを代替しない。

## 2026-10-07 — [WORLD-22] renderAt 途中フレームのGPU描画省略

### 作業内容
- `js/world/world-engine.js`: SSOT `doc/20261004-design-gargantua-v1.md` §10.12に従い、`_step(tSec, features, dt, drawMatter = true)`を追加。falseでもCPUのイベント・セクション・カメラ・uniform更新とtype.stepは実行し、_renderMatterとpost.stepFeedbackだけを省く。advanceToとrenderAtの非同期ループで、最後以外・type.statelessRender・fadeElapsed>=.5の3条件が揃ったときだけ描画を省く。
- `js/world/g-gargantua.js`: WorldGargantuaAnalyzerにstatelessRender=trueを追加。GPUのフレーム間履歴がないタイプとして宣言する。
- `tests/unit/world-score.test.mjs`: UW-66を追加。描画を数えるmockタイプでstateless／false／未定義、時刻0、advanceTo、advancePreview、切替フェード、フェード完了ステップ、drawMatterの既定値／false、ライブとexportの1ステップ経路、端数時刻を検査する。UW-67を追加し、g-gargantuaのrenderAt(45)を全描画の参照経路と比較し、CPU状態の一致と描画回数を検査する。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 188件／187成功／0失敗／既存の想定U15-00スキップ1、47,542ms、終了コード0。既存の決定性UW-08／UW-32／UW-43、feedback UW-21、タイプ契約UW-39、export UW-34〜36／UW-42も成功。既存ランナーがtests/output/report.jsonへ結果を保存。
- `node --test --test-name-pattern='UW-66|UW-67' tests/unit/world-score.test.mjs`: 2件／2成功／0失敗／0スキップ、344.067208ms、終了コード0。
- UW-66: 時刻0を含むCPU更新N=7に対してstateless描画=1回、false／未定義のstateful描画=N=7回。mock feedbackも同じ回数。advanceToとadvancePreviewのフェード中はそれぞれ6/6ステップを描画。フェード完了を跨ぐ3ステップでは完了ステップと最終ステップの2回を描画。ライブ／exportは各7/7回。drawMatter=falseはCPU更新1回・描画0回・feedback0回。renderAt(.105)は最終固定ステップ.1と端数dt0の.105を描画し、CPU更新8回・描画2回。
- UW-67: renderAt(45)は2700固定ステップ＋時刻0のCPU初期化=2701更新を維持。全描画参照2701回→stateless描画1回。uniform・camera・music・bands・hotspots・gravity・beats・responses・events・フレーム／時刻／イベント通番・キック状態・周回角・露出が完全一致（CPU状態の差0）。GLはmockであり実画素／実GPU所要時間の測定ではない。
- 全JS/MJS `node --check`: 129件／129成功／0失敗、20,244.048ms、終了コード0（Node v26.7.0）。
- `git diff --check`: 成功。指定4ファイル以外の製品／テスト／文書を編集していない（設計書の15行追加は開始時から存在）。
- 補助レポート確認の初回はreport.jsonをresultsプロパティ付きオブジェクトと誤認してTypeErrorとなった。ランナーの配列形式を確認して読み取り直し、188件／187成功／0失敗／U15-00スキップ1を照合した。製品コード・テスト・閾値の変更なし。
- ブラウザテストの追加／変更なし。依頼のChrome禁止に従い、ブラウザ・file://・console・実画素・実GPU所要時間は未検証。

### spec.md 変更
- なし。チケット指定の4ファイルだけを編集し、doc/spec.md／README.mdは編集しない。開始時から変更済みの設計書も保持。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: 依頼末尾の「Do not stop for ambiguity: decide」を適用。§10.12はrenderAtがadvanceToを使う前提だが、現行コードでは独立した_advancePreviewループを使うため、両ループに同一の省略条件を適用し、非同期の120ステップごとのyieldを保持した。
- 判断: 描画1回の単体受け入れを満たすため、後続の固定ステップがある場合は時刻0のCPU初期化にも同じ省略条件を適用する。renderAt(0)／exportの初回advanceTo(0)は必ず描く。判定はfadeElapsedを更新する前に行い、混合が完了するステップ自体も描く。固定ステップの最後は常に描き、既存の端数時刻のdt0描画も保持するため、端数時刻では描画2回となる。定数・閾値の調整なし。毎フレーム経路に配列／オブジェクト／クロージャの生成を追加していない。
- 制約: 指定されたscratchpad/CODEX_ADDENDUM.mdは存在せず、scratchpadおよび/private/tmp/claude-501内のファイル検索でも見つからなかった。依頼本文に明記されたno commit／push／PR／Chromeを適用し、IMPLEMENTER_RULES.mdと実装者ガイドを読んで進めた。すべての編集はこのworktree内のみ。
- レビュアー確認: 実GPUの1920×1080でrenderAt(45)直後の1画素gl.readPixels同期を含む所要時間<=1秒を測ること。同じtのg-gargantua画素が修正前と一致し、g-fluidの既存ゴールデンも一致すること、切替フェードが連続すること、file://直開きでconsoleエラー0を確認すること。CPUのmock一致はこれらの実GPU受け入れを代替しない。

## 2026-10-07 — [WORLD-21] shoot-live 撮影時刻ずれ（GPU drain）

### 作業内容
- `tests/world/shoot-live.mjs`: world21DrainGpu(e)を追加。初期化時に確保する4-byte Uint8Arrayを使い回し、PIXEL_PACK_BUFFERを解除・default framebufferへbindして1×1 RGBA/UNSIGNED_BYTEを同期readPixelsした後、2回のrequestAnimationFrameを待つ。renderAt(start)直後とseek完了直後の2箇所から呼び、app.start()前にGPUをdrainする。ブラウザ注入ソースにも関数と事前確保バッファを含める。
- `tests/world/shoot-live.mjs`: WORLD17_CHECKSへLAG_MAX_SECONDS=1/30を追加。tSec以降の最初の転送フレームが超過したら直ちにpauseし、finallyでtimeline・callback・PBO/fenceを後始末して撮影全体を1回だけ再試行する。再試行でも超過したら指定形式のcapture lagエラーをthrowする。成功した試行だけをreadback・集計する。
- `tests/world/shoot-live.mjs`: GLSL probeのdiskSample呼び出し2箇所を(hit,travel,vec3(0.,-1.,0.),0.)へ更新。現行WORLD_GARGANTUAの色・指数・露出・外縁・streak定数と§10.11のNOISE_MEAN補填へCPU側の期待値を追従させる。UW-55の旧§10.8定数値も§10.9〜10.11へ更新し、製品の定数と受け入れ閾値は変更しない。
- `tests/world/shoot-live.mjs`: UW-64を追加し、mock audio/GLで実際のブラウザ注入関数・seek・GPU drain・PBO転送/readback/解放を動かす。start前の順序、バッファ再利用、lag境界・再試行成功・再試行失敗・資源解放を検査する。UW-65を追加し、JS/GLSLの全probe定数参照、diskSample署名と2呼び出しを現行ソースと照合する。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 186件／185成功／0失敗／既存の想定U15-00スキップ1、88,790ms、終了コード0。既存ランナーがtests/output/report.jsonへ結果を保存。このランナーの探索対象はtests/unitだけなので、shoot-live内のUW-55〜61・64・65は次の専用コマンドで別途実行。
- `node tests/world/shoot-live.mjs --unit`: 9件／9成功／0失敗／0スキップ、76.766083ms、終了コード0。
- UW-64: mockの5ケースでLAG_MAX_SECONDS=.03333333333333333秒、各試行のdrain=2回／各drainのrAF=2回／共通バッファ=4byte。入力lag=2.5秒→0秒はstart=2回で成功。2.5秒→.1秒はstart=2回でcapture lag 0.100s > 0.03333333333333333をthrowし、readback=0回。閾値そのものは成功、閾値+1e-6秒は2試行後に失敗。全ケースの残存PBO/fence=0。これらはmockの検証値であり実音・実GPUの測定値ではない。
- UW-65: JS定数25種類／GLSL定数11種類／diskSample呼び出し2箇所、欠落参照0。全減衰時のノイズ期待値=.46875（NOISE_MEAN=.5、4オクターブ）を確認。rgでも全定数参照を確認し、廃止されたLENS_DEMAG／SUBSAMPLE_OFFSETへの参照は0。
- UW-61: mock撮影時刻7秒／lag=0秒／25標本／.40000000000000036秒、34転送すべてpause後readbackを維持。
- 全JS/MJS `node --check`: 129件／129成功／0失敗、43,881.059ms、終了コード0。UW-64でブラウザ注入ソース全体のvmコンパイル・実行も成功。git diff --check成功。
- 専用単体テストの初回は9件／8成功／1失敗、77.634334ms。UW-65がGLSLのローカルvec3 c.rをJSの定数alias cとして誤検出したため、JS定数参照の検索からGLSL文字列を除外して修正。GLSL側は別の宣言照合で引き続き検査する。定数・閾値の調整なし。
- ブラウザテストファイルの追加なし。変更した実GPU撮影・lag guard・384標本GLSL probeはCODEX_ADDENDUM.mdのChrome禁止に従い未実行。file://・console・実画像・実GPUのlagも未測定。

### spec.md 変更
- なし。テストハーネスのみの修正。製品ソース／doc/spec.md／README.md／tests/browserは編集しない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: 依頼末尾の「Do not stop for ambiguity: decide」を適用。編集範囲を守るため単体テストは既存shoot-live.mjsのunitChecks内へ追加し、全単体スイートと専用単体コマンドの両方を実行した。
- 判断: lag超過は最初の転送フレームで検出して再生を止め、既存finallyを通るcontinueで全試行をやり直す。seek/render/startなどlag以外のエラーは再試行しない。同期readPixelsへTypedArrayを渡すためにPBOも明示解除する。
- 判断: 旧GLSL probe期待値とUW-55の定数assertは現行製品に一致せず、署名だけ直しても実GPU照合に失敗するため、§10.9の色／streak／露出／外縁と§10.11の平均ノイズに追従した。probeの半径3.5〜24（現在の外縁20の外側も含む）・384標本・既存誤差閾値は維持し、定数を調整していない。
- レビュアー確認: 実GPUラッパーをWORLD_CHROME_WRAPPERへ指定してnode tests/world/shoot-live.mjsを実行し、t=7／20／31／45／62／90の各captureLagSecが1/30秒以内で、撮影をまたぐ遅れが累積しないことを確認すること。2試行とも遅れた場合の指定エラーも確認すること。384標本の実GLSLコンパイル・全誤差条件、G-1／キック／1280×720の星・上下弧条件、consoleエラー0も未確認。
- 編集はこのworktree内の上記2ファイルのみ。commit／push／PR／Chrome起動は行っていない。

## 2026-10-07 — [WORLD-20] g-gargantua LOD（曲がり角・平均補填）

### 作業内容
- `js/world/g-gargantua.js`: SSOT `doc/20261004-design-gargantua-v1.md` §10.11を実装。LENS_DEMAGを削除し、TURN_START=1.2／TURN_MAX_LOG=6.3／NOISE_MEAN=.5を追加。traceRayは最初の正規化dirをndPrev、0をturnの初期値とし、各積分ステップでlength(cross(ndPrev,nd))を累積する。diskSampleの第4引数を交差番号cからfloat turnへ置換し、fpにexp(clamp(turn-TURN_START,0.,TURN_MAX_LOG))を掛ける。streakFbmは減衰した振幅をNOISE_MEANで補填する。GRAZE_MIN、8点SSAA、交差上限・合成、カメラ、その他の定数、CPU描画経路は保持。
- `tests/unit/world-gargantua.test.mjs`: UW-53を41定数・LENS_DEMAG廃止へ更新。UW-62を新diskSample署名／呼び出し、曲がり角LODの連続性・上限・grazing併用へ更新し、8点SSAA検査を維持。UW-63を追加し、製品GLSLから抽出した累積式／4オクターブループをCPUで評価して、直進・逆転・非単位方向、平均ノイズのLOD不変性、未減衰・部分減衰・全減衰を検査。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 186件／185成功／0失敗／既存の想定U15-00スキップ1、26,231ms、終了コード0。既存ランナーの`tests/output/report.json`へ結果を保存。
- `node --test tests/unit/world-gargantua.test.mjs`: UW-48〜54・UW-62・UW-63の9件／9成功／0失敗／0スキップ、76.622708ms、終了コード0。UW-53は41定数を確認。UW-62はtravel=30の基準fp=.02133180196881958、grazing上限fp=.4266360393763916（20倍）、turn=0／1.2／2.2／7.5／10の補正倍率1／1／2.718281828459046／544.571910125929／544.571910125929、両補正の最大倍率10891.438202518579を確認。8点SSAA・中心判定込み9本・平均重み.125を維持。
- UW-63: 直進と逆転を含む4ステップのturn=2、.01radの外積長=.009999833334166666。7種類のfpで平均ノイズ出力=.46875を保持。未減衰の合成ノイズ=.328125、全減衰=.46875、rd=6／fp=.06の部分減衰=.1453180911078717。これらはCPUによるGLSL数値契約検査であり、実GPU／画像の測定値ではない。
- 全JS/MJS `node --check`: 129件／129成功／0失敗、6,438.545375ms、終了コード0。
- 読み取り専用git/Node比較: HEADに対して定数追加はTURN_START／TURN_MAX_LOG／NOISE_MEANの3個、削除はLENS_DEMAGだけ。他の定数、カメラ表、main()のSSAA、upsample以降のCPUクラスはHEADと完全一致。`git diff --check`成功。
- ブラウザテストの追加／変更なし。CODEX_ADDENDUM.mdのChrome禁止に従い、ブラウザ／実GLSLコンパイル／実画像／実GPU p95／file://／console確認は未実行。

### spec.md 変更
- なし。チケットの編集範囲に従いdoc/spec.md／README.md／撮影ハーネス／tests/browserは編集していない。開始時から変更済みの設計書も保持。

### 備考
- 実装: Codex gpt-6.1-sol high
- 設計からの逸脱・定数調整なし。依頼末尾の「Do not stop for ambiguity: decide」を適用し、実装上の選択を記録して進めた。
- 判断: turnはdirの加速度更新後、円盤交差の判定前に毎ステップ累積し、そのステップのndとturnをdiskSampleへ渡す。交点までのturnの分数補間は設計にないため追加していない。crossingsは合成上限／直接像の測定用に維持し、LODへは渡さない。外積長の累積を指定どおり使い、角度への逆三角関数変換や振幅の再正規化はしていない。
- レビュアー確認: 1280×720のrenderAt(20)／renderAt(45)で下弧の水平な切れ目がないこと、上弧の明るさ・縞がv18（§10.9撮影）と同程度であること、モアレがなく光子リングが連続していることを確認すること。§10.10の実GPU p95<=16ms、実GLSLコンパイル、file://直開きのconsoleエラー0も未確認。
- レビュアー確認: 範囲外の`tests/world/shoot-live.mjs`のworld17GpuFormulas（212／214行付近）はdiskSample(hit,travel)の旧2引数呼び出しがあり、新しい(hit,travel,ndir,turn)へ追従が必要。330行付近の§10.9以前の定数assertも旧値のまま。perf.mjsはこのworktreeに存在せず、オーナー側の測定スクリプトを確認すること。
- 編集はこのworktree内の上記3ファイルのみ。commit／push／PR／Chrome起動は行っていない。

## 2026-10-07 — [WORLD-19] g-gargantua モアレ・光子リング

### 作業内容
- `js/world/g-gargantua.js`: SSOT `doc/20261004-design-gargantua-v1.md` §10.10を実装。GRAZE_MIN=.05／LENS_DEMAG=23.0を追加し、diskSampleに正規化した光線方向ndirとサンプル時点のcrossings（0始まり）を渡す。既存fpへ1/max(abs(ndir.y),GRAZE_MIN)とpow(LENS_DEMAG,float(c))を掛けてからstreakFbmへ渡す。
- `js/world/g-gargantua.js`: SUBSAMPLE_OFFSETをSUBSAMPLE_NEAR=.125／SUBSAMPLE_FAR=.375へ置換。リング帯域だけ半解像度の画素単位の(±.125,±.375)／(±.375,±.125)の8点を平均する。リング判定の中心光線と測定用alphaは既存どおり保持。CPUの描画経路に配列／オブジェクト／クロージャの生成を追加していない。
- `tests/unit/world-gargantua.test.mjs`: UW-53を39定数・旧SUBSAMPLE_OFFSET廃止・8点平均へ更新。UW-62を追加し、製品GLSLから取り出したfpのスカラー式による数値検査、正規化方向／交差番号の受け渡し、8点すべてのオフセットと平均重み、リング帯域外の中心光線を検査する。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 185件／184成功／0失敗／既存の想定U15-00スキップ1、25,771ms、終了コード0。`tests/output/report.json`にも結果を保存する既存ランナーを使用。
- `node --test tests/unit/world-gargantua.test.mjs`: UW-48〜54とUW-62の8件／8成功／0失敗／0スキップ、92.588ms、終了コード0。UW-53で39定数を確認。UW-62でtravel=30の基準fp=.02133180196881958、grazing最大fp=.4266360393763916（20倍）、交差0/1/2の最大補正倍率20／460／10580を確認。正負の視線角で同値、abs(ndir.y)<=.05の4例で20倍の上限を確認。SSAA平均用8点／中心判定を含むリング追跡9本／平均重み.125。これらはCPUで評価した数値とGLSLソースの契約検査であり、実GPU／画像の測定値ではない。
- 全JS/MJS `node --check`: 129件／129成功／0失敗、6,548.238ms、終了コード0。
- 読み取り専用git/Node比較: HEADとの差分は定数4追加／旧定数1削除、diskSampleの2補正と引数、リングSSAAのみ。その他の定数・カメラ表・upsample以降のCPUクラスがHEADと完全一致。`git diff --check`成功。
- 対象単体テストの初回は8件／7成功／1失敗、83.599875ms。UW-53の既存EMA禁止正規表現が新定数LENS_DEMAG中の文字列EMAを誤検知したため、EMA識別子／EMA_接頭辞の禁止へ修正して成功。製品の定数や受け入れ閾値は調整していない。
- ブラウザテストの追加／変更なし。CODEX_ADDENDUM.mdのChrome禁止に従い、ブラウザ／実GLSLコンパイル／実画像／実GPU p95／file://／console確認は未実行。

### spec.md 変更
- なし。チケットの編集範囲に従いdoc/spec.md／README.md／撮影ハーネス／tests/browserは編集していない。開始時から変更済みの設計書も保持。

### 備考
- 実装: Codex gpt-6.1-sol high
- 設計からの逸脱・定数調整なし。依頼末尾の「Do not stop for ambiguity: decide」に従って必要な実装上の選択を記録して進めた。
- 判断: ndirは交差を検出した積分ステップのdirをnormalizeして渡す。cはplaneCrossingsではなく指定どおりdiskSample呼び出し時点のcrossingsで、合成後に増やす。8点の平均に中心光線は含めず、中心は既存のリング判定／直接像測定用alphaだけへ使う。
- 判断: EMAの禁止検査はLENS_DEMAGの誤検知を除くため識別子境界へ修正し、EMA自体とEMA_接頭辞を引き続き禁止。既存のテストを削除／スキップしたり、閾値を緩和したりしていない。
- レビュアー確認: §10.10のt=20／45で穴の真下の帯にモアレがないこと、光子リングが途切れない細い線に見えること、実GPU p95<=16msを確認すること。実GLSLのコンパイルとfile://直開き時のconsoleエラー0も確認が必要。実画像・実GPUの受け入れは未判定。
- レビュアー確認: 範囲外の`tests/world/shoot-live.mjs`のworld17GpuFormulas（212／214行付近）はdiskSample(hit,travel)の旧2引数呼び出しがあり、新4引数への追従が必要。同ハーネスの§10.9以前の定数assertについてはWORLD-18ログも参照。§10.10が測定に指定するperf.mjsはこのworktreeに存在せず、オーナー側の測定スクリプトを確認すること。
- 編集はこのworktree内の上記3ファイルのみ。commit／push／PR／Chrome起動は行っていない。

## 2026-10-07 — [WORLD-18] g-gargantua v1.4 構図・露出調整

### 作業内容
- `js/world/g-gargantua.js`: SSOT `doc/20261004-design-gargantua-v1.md` §10.9の12定数とカメラ6行のdist始/終・inc始/終のみ変更。FOV=22、DISK_OUTER=20、OUTER_FADE=12、ESCAPE_RADIUS=100、SWAY_DEGREES=1.5、SECOND_DROP_DIST=27、SECOND_DROP_INC=-6、DISK_HDR=3.0、DISK_OUTER_COLOR=(1.00,.52,.20)、COLOR_POWER=1.3、STREAK_FLOOR=.15、VEIL_GAIN=.10を設定。周回速度・円盤係数・その他の定数・描画/CPU処理は保持。
- `tests/unit/world-gargantua.test.mjs`: UW-48のカメラ表・揺れ・4秒ease・第二drop、UW-52のinclination、UW-53の定数・外側色、UW-54のveil測定出力を§10.9へ更新。定数検査は35項目、色は2組。既存のテスト・許容誤差・受け入れ閾値は維持。
- `log.md`: 本エントリを先頭に追加。

### 検証
- `node tests/run.mjs --unit`: 184件／183成功／0失敗／既存の想定U15-00スキップ1、26,806ms、終了コード0。結果を`tests/output/report.json`でも確認。
- `node --test tests/unit/world-gargantua.test.mjs`: UW-48〜54の7件／7成功／0失敗／0スキップ、114.004375ms。カメラ6kind、4秒easeのdist=34→32→30、第二drop dist=27／inc=-6°／speed=.09／円盤係数2.025、35定数を確認。hash60例の誤差0、再演誤差0。合成星150画素は合格／149は不合格、合成弧ピーク217/255=.8509803921568627は合格／216/255=.8470588235294118は不合格。これらは実画像の測定値ではない。
- 全JS/MJS `node --check`: 129件／129成功／0失敗、6,926ms、終了コード0。
- 読み取り専用git/Node比較: 変更定数が§10.9の12項目だけであること、カメラ6行の周回速度・円盤係数がHEADと完全一致することを確認。定数/カメラ以降のコードもHEADと完全一致。`git diff --check`成功。
- 補助比較の初回はファイル全体を依存クラスなしでVM評価してReferenceErrorになったため、定数/カメラ宣言だけの評価へ修正して成功。製品ソースの修正や定数の調整はしていない。
- ブラウザテストの追加/変更なし。CODEX_ADDENDUM.mdのChrome禁止に従い、ブラウザ・実GPU・file://・console・実画像の数値/目視受け入れは未実行。

### spec.md 変更
- なし。指定範囲に従いdoc/spec.md／README.md／post.js／撮影ハーネス／tests/browserは編集していない。開始時から変更済みの設計書も保持。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: チケット末尾の「Do not stop for ambiguity: decide」に従い、§10.9を以前の定数/カメラ表より優先。矢印は既存表の形式どおりセクション開始→終了に対応させる。設計外の定数調整なし。
- 判断: VEIL_GAINの定義はg-gargantua.jsにあり、post.jsはそこからGLSLへ展開するため、定義側だけを更新。
- レビュアー確認: 1280×720 renderAt(45)で§10.9の手前円盤高さ<=35%、内側の白／外側の金、筋の暗い隙間、mainの影直径約39%を確認。§10.7/10.8の背景星>=150画素、上下弧ピーク>.85、上弧厚み>=影半径40%、柔らかな外縁/全画面の滲み/映画参照との一致も実GPUで確認すること。画面比率・輝度・星数の実測値は未取得。
- レビュアー確認: 範囲外の`tests/world/shoot-live.mjs`のworld17GpuFormulas（330〜331行付近）はSTREAK_FLOOR=.3／DISK_HDR=6／DISK_OUTER=24／OUTER_FADE=15／VEIL_GAIN=.12の旧assertを含む。ブラウザ撮影前に§10.9へ追従が必要。旧BW-13/BW-14の検査については既存WORLD-17ログの注意も参照。
- 編集はこのworktree内の上記3ファイルのみ。commit／push／PR／Chrome起動は行っていない。

## 2026-10-07 — [WORLD-17] g-gargantua v1.4（映画参照で作り直し）

### 作業内容
- `js/world/g-gargantua.js`: `git show 7a19a4f:js/world/g-gargantua.js` の内容を書き戻し（復元一致を検査）、既存の§10実装を適用して最新SSOT §10.1〜10.6・§10.8へ更新。単一y=0平面／最大3交差の前方合成、暖色と15%パレット、ドップラーなし、4オクターブ／倍率2.03の周期縞と累積travelの半径方向LOD、指定opacityを実装。2層／EMA／黒体／BEAM／体積スラブ／吸収／flowBlur／flowQuality／setQuality／光暈／光条／星の輝度下限は使用しない。CPUクラス・光子リングSSAA・重力ease・キック・hotspotは復元元を維持。
- `js/world/g-gargantua.js`: §10.8を優先してDISK_OUTER=24／OUTER_FADE=15／INTENSITY_POWER=.8／DISK_HDR=6に設定。帯域はBAND_OUTER=14へ分離し、半径の比を0..1へclamp。星は§10.5のSTAR_CELLS=180／確率.03／power18／HDR6／半径.6（1080p）とv1.0のGaussian点関数へ戻し、BACKGROUND_MAX=.04は天の川にだけ適用。カメラdistは§10.6の表を維持。
- `js/world/post.js`: 開始時の変更が§10.4を満たしていたため保持。gargantuaのbloom重み.25/.25/.30/.45、threshold=.55、strength=.90、ACES前のb3*VEIL_GAIN（.12）を検査。他分岐はHEADと一致。
- `tests/unit/world-gargantua.test.mjs`: 廃止定数・旧星値・明るさ指数を§10.5/10.8へ更新。単一平面、LOD、星Gaussian、星だけ上限なし、帯域clamp、フレア順序と合成画像の受け入れ境界を検査。既存のカメラ／イベントhash／キック／再演／32環／重力ease／継ぎ目検査は保持。
- `tests/world/shoot-live.mjs`: 開始時のseek完了待ち／実音撮影／PBO転送／pause後readback／後始末とv1.3専用判定の除去を保持。§10.8の上弧厚み比>=.4を追加し、readPixelsの上側（y増加方向）を正しく判定。実GLSL検査は半径3.5〜24へ拡張し、外縁fade・指数.8・非一様な32帯域のclampと境界補間を384標本で照合する。1280×720 renderAt(45)の正確な時刻の画像と数値条件を保存する。

### 検証
- `node tests/run.mjs --unit`: 184件／183成功／0失敗／想定U15-00スキップ1、26,785ms、終了コード0。出力: `tests/output/world17-v14-unit.txt`。
- `node --test tests/unit/world-gargantua.test.mjs`: UW-48〜54の7件／7成功／0失敗、322.046625ms。§10の30定数、カメラ6kind／ease中点dist16／第二drop dist13、重力中点[1.8,1.09,3.2]／ピーク[2.1,1.18,3.4]、hash60例の誤差0、hotspot容量12／寿命6秒を確認。合成星150画素は合格、149は不合格、円盤を除外後148。弧ピーク217/255=.8509803921568627は合格、216/255=.8470588235294118は不合格。
- `node tests/world/shoot-live.mjs --unit`: UW-55〜61の7件／7成功／0失敗、15.438584ms。合成影半径10.045109950630787px、上弧厚み5px／比.4977546313155112は合格、4px／比.39820370505240893は不合格。下弧1pxでも合格し、上側だけに40%を要求。輝度127/255の画素は厚みから除外。合成G-1は21標本／.5秒／相関中央値1、キック増加.36／100ms時刻1.1秒。撮影mockは時刻7秒／遅れ0／25標本／.40000000000000036秒、34転送すべてpause後readback。これらは実画像・実音・実GPUの測定値ではない。
- 全JS/MJS `node --check`: 129件／129成功／0失敗、6,927ms、終了コード0。ブラウザ注入ソース19,231bytesの`vm.Script`構文検査も成功。
- 読み取り専用git比較: CPUクラスは7a19a4fと完全一致。post.jsはgargantua分岐とVEIL_GAIN宣言以外がHEADと完全一致。対象ソース4ファイルの`git diff --check`成功。
- Chrome禁止のため未実行: 384標本の実GLSL照合、1280×720 renderAt(45)の星150画素／上下ピーク>.85／上弧厚み>=影半径40%、6時刻の実音撮影、G-1／実キック／GPU診断、file://・console・見た目確認。

### spec.md 変更
- なし。指定範囲に従いdoc/spec.md／README.md／tests/browserは編集していない。設計文書と開始時のtests/world/output/live/画像／JSONも編集していない。既存画像は今回のv1.4の検証証拠には使えない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: 依頼末尾の「Do NOT stop for ambiguity」に従う。§10.8は§10.3の外縁／fade／明るさ指数と§10.7の弧の細さに優先する。カメラの矢印はセクション内の開始→終了として読み、dist以外の値とCPUクラスは復元元を保持。
- 判断: LODは§10.3から参照された§9.6のλ=rd/f_k（f_0=60）・正規化なしを採用。逆順smoothstepをGLSLで定義される正順の補数に置換。travelは曲がった線分の長さを累積し、交差区間は交点まで加算。fbm初期振幅.5／固定座標オフセットは復元元を維持。opacityの無名数値はOPACITY_BASE／OPACITY_STREAK／OPACITY_MAXとして定義。
- 判断: 星の点関数はv1.0のGaussianをそのまま使い、§10.5が明示する1080p基準はSTAR_REFERENCE_HEIGHT=1080で維持。v1.0の光条は§10.5の禁止に従い除去。瞬き・天の川は復元元のまま。
- 判断: §10.8の帯域式のclampと復元元のBAND_BLENDを両方維持したため、14以上は14の境界での補間値に固定される。測定用の32環は引き続き3〜14を使用。単一平面の直接像メタデータでは2交差以上を除外する。
- 判断: 弧の測定は既存の中央±影半径/2の列・上下3半径以内で輝度>.5の最長連続長の中央値を使い、§10.8の40%は上側だけへ要求。影半径は中心地平面像の等面積半径。外縁の柔らかな減衰／画面全体の滲み／映画参照は目視項目に残す。半解像度のマスク・ROI・中央値の妥当性は実画像でレビューが必要。
- 手順逸脱: 単体テストの出力を一時的に`/tmp/world17-v14-unit.txt`へ保存したため、終了後にworktree内の`tests/output/world17-v14-unit.txt`へ移動した。ソース変更はこのworktreeの指定4ファイルとlog.mdのみ。commit／push／PR／Chrome起動は行っていない。
- レビュアー確認: `WORLD_CHROME_WRAPPER=/path/to/gpu-wrapper node tests/world/shoot-live.mjs`を実GPUで実行し、renderAt(45)の星>=150画素／上下ピーク>.85／upperRatio>=.4、柔らかな外縁／全画面の滲み／映画スチルとの同系統の見た目、mainの影直径約23%と円盤が左右へはみ出す構図、GPU性能・シーク／書き出し一致を確認。範囲外の旧BW-13-formulas／BW-14-periodic／BW-14-screenは黒体・filamentInput／fbm・両層・旧星値を参照するため§10への追従が必要。前の同名ログにある旧星値・指数1.6・厚み診断だけという説明は本エントリで更新する。

## 2026-10-07 — [WORLD-17] g-gargantua v1.4（映画参照で作り直し）

### 作業内容
- `js/world/g-gargantua.js`: `git show 7a19a4f:js/world/g-gargantua.js` の内容を書き戻してから SSOT §10.1〜10.6 を適用。y=0 の単一平面、最大3交差と前方合成、指定の暖色／15%パレット混合、ドップラーなし、4オクターブの周期縞と半径方向LOD、指定の発光・不透明度を実装。光子リングSSAA、重力ease、帯域・滑らかなキック・hotspot・CPU経路は復元元を維持。2層・EMA・黒体・スラブ・吸収・flowBlur／flowQuality／setQuality・光暈・光条を除去。
- `js/world/g-gargantua.js`: 星は半径1px（1080p換算）／確率.05／HDR .35+5*pow(h,6)へ変更し、上限.04を天の川だけへ適用。distをintro 34→22、build 24→16、drop 15（第二以降13）、break 22、outro 20→60、main 17へ変更。inc・周回速度・円盤係数・瞬きは復元元のまま。
- `js/world/post.js`: gargantua分岐の4段bloomの重みを.25/.25/.30/.45へ変更。threshold=.55、strength=.90は共有定数から取得し、b3*VEIL_GAIN（.12）をACES前に加算。他タイプの分岐は変更なし。
- `tests/unit/world-gargantua.test.mjs`: UW-48のcamera／palette／bloomとUW-52の廃止定数参照を更新。UW-53／54の旧層・halo・spike・白飛び8%・星400個の検査を§10の定数・廃止機能の不在・合成画像の星画素／弧輝度境界・フレアの順序へ置換。オンセット寿命・hash・再演・32環・重力ease・継ぎ目の検査は保持。
- `tests/world/shoot-live.mjs`: 既存のseek完了待ち、曲頭からの状態復元、t以降の最初の描画、20標本以上／.4秒以上のG-1、実オンセットのキック診断、PBO/fenceとpause後readback、資源の後始末を保持。v1.3の品質fallback／体積／白芯／厚み比35%／白飛び18%／星径1.5pxの判定を除去し、§10のGLSL 320標本照合と星150画素・上下弧輝度>.85の判定へ置換。1280×720・renderAt(45)の正確な時刻の画像も別途保存する。GPU測定・実キックは診断として記録し、§10.7の数値条件と画像の目視確認項目を分けて記録する。

### 検証
- `node tests/run.mjs --unit`: 184件／183成功／0失敗／想定U15-00スキップ1、45,761ms、終了コード0。`tests/output/world17-unit.txt` に出力を保存。
- `node --test tests/unit/world-gargantua.test.mjs`: UW-48〜54の7件／7成功／0失敗／0スキップ、最終121.840458ms。camera 6kind、4秒ease中点dist=16、第二drop dist=13、gravity中点=[1.8,1.09,3.2]／ピーク=[2.1,1.18,3.4]、hash 60例の誤差0、hotspot容量12／寿命6秒、26個の新定数を検査。合成星150画素は合格、149は不合格（円盤画素除外後148）。合成弧ピーク217/255=.8509803921568627は合格、216/255=.8470588235294118は不合格。
- `node tests/world/shoot-live.mjs --unit`: UW-55〜61の7件／7成功／0失敗／0スキップ、最終18.675416ms。合成G-1は21標本／.5秒／相関中央値1。合成キック画面増加.36／100ms標本1.1秒。合成影半径10.045109950630787px、上下弧厚み1px（厚みは判定しない）。撮影mockはcapturedSec=7／lag=0／25標本／.40000000000000036秒、34転送すべてpause後readback。これらは実画像・実音・実GPUの測定値ではない。
- 全JS/MJS `node --check`: 129件／129成功／0失敗、16,839ms、終了コード0。最終の撮影テスト変更後にも同ファイルの構文検査を実行して成功。ブラウザ注入ソース（18,010bytes）のvm.Script構文検査も成功。
- 読み取り専用gitによる比較: `WorldGargantuaAnalyzer` のCPU経路は7a19a4fと完全一致。post.jsはgargantua分岐と必要なVEIL_GAIN宣言以外でHEADと完全一致。対象ソース4ファイルの `git diff --check` は成功。
- Chrome禁止のため、追加／更新したブラウザ検査は未実行: 実GLSLの周期性・暖色／パレット・縞／opacity・LOD・滑らかなキック・3交差前方合成（320標本）、1280×720 renderAt(45)の星画素と上下弧ピーク、6時刻の実音撮影、G-1／実キック／GPU診断。実画像の星数・弧輝度・影直径・GPU p95、file://／console確認、見た目の受け入れは未測定／未確認。

### spec.md 変更
- なし。チケットの指定ファイル範囲に従い、doc/spec.md／README.md／既存tests/browserファイルは編集していない。レビュアーによる旧v1.1/v1.3記述とブラウザ検査の追従が必要。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: 依頼末尾の「Do NOT stop for ambiguity」に従い、§10へ最も忠実な読みを採用。§10.6の矢印は旧値置換ではなくセクション内の開始→終了として実装し、dist以外のcamera値を7a19a4fから維持した。
- 判断: LODは§10.3が明示的に参照する§9.6の半径方向波長rd/f_kを使用。逆順smoothstepはGLSLで未定義なので正順の補数1-smoothstep(.6,2,fp/λ)で同じ下降曲線を実装し、正規化しない。travelは実際の曲がった線分長を累積し、交差区間は交点までの比率だけ加算。fbmの初期振幅.5・オクターブ間の固定座標オフセットは復元元を維持。
- 判断: §10.1のopacity式の無名数値をOPACITY_BASE=.45／OPACITY_STREAK=.5／OPACITY_MAX=.90として定義。beam=1は乗算自体を除去して実現。hotspotは復元元と同様にdiskへ加算後camera.wを掛ける。
- 判断: G-1用alphaの直接像メタデータは1枚の平面に合わせて最初の近側・内向き交差を保持し、2回以上の円盤交差を測定から除外。実光の合成・地平面／逃走条件は復元元を維持。
- 判断: §10.7の星は逃走背景マスクの表示輝度>.5の「画素数」で数え、星の連結成分数や径には置換しない。上下弧は中心の地平面像の等面積半径から中央±半径/2の列・上下3半径以内を探索し、直接像／背景／地平面内を除いた円盤像で各ピーク>.85を要求。厚み（輝度>.5の連続長中央値）と影半径の比は診断だけで、設計にない薄さの数値閾値は追加しない。薄さ・画面全体の滲み・映画参照との一致はmanualChecksへ残した。
- 判断: WORLDのcanvasは通常1920×1080固定でviewport変更では描画解像度が変わらないため、撮影ハーネス内で既存engine.resize(1280,720)を明示的に呼ぶ。GPU診断は先に従来の1920×1080で実施し、品質／定数を自動調整しない。§10.7の数値条件を終了コードへ接続し、GPU／キック／旧版の画面基準を新しい見た目の受け入れ条件として追加しない。
- レビュアー確認: `WORLD_CHROME_WRAPPER=/path/to/gpu-wrapper node tests/world/shoot-live.mjs` を実GPUで実行し、`g-gargantua-renderAt-45-v14.png` とreport.jsonの数値条件・manualChecksを確認。特に星が150画素以上見えること、上下弧が>.85かつ細いこと、全画面の滲み、映画スチルとの同系統の見た目、mainの影直径約23%と円盤外縁が左右へはみ出す構図、負角camera／32帯域／hotspot／シーク・書き出し一致を確認すること。半解像度の背景／弧マスクの境界とROIも実画像で確認すること。
- レビュアー確認: 範囲外の旧BW-13-formulas／BW-14-periodic／BW-14-screenは黒体・filamentInput／fbm・両層・星400個／白飛び8%等を参照するため、§10へ追従が必要。変更前から存在するtests/world/output/live/の画像／JSON／reportはv1.4の証拠ではない。
- 開始時から変更済みの `doc/20261004-design-gargantua-v1.md` と tests/world/output/live/ の画像／JSON／report.jsonは編集していない。ソースの編集は上記4ファイルとlog.mdのみ。このworktree以外へ編集せず、commit／push／PR／Chrome起動は行っていない。

## 2026-10-07 — [WORLD-16] g-gargantua v1.3

### 作業内容
- `js/world/g-gargantua.js`: SSOT §9.1〜9.6を実装。2枚の薄い円盤を厚みH(rd)の体積へ置換し、各区間で密度×発光×dtの前方合成とκ=1.6の指数吸収を積分。周期φの異方性ノイズ、6点の流れ方向ブラー、4オクターブ／周波数倍率2.03／半径方向実波長に基づく振幅LOD（正規化なし）、指定の明るいI_flow、連続した白い芯を適用。32帯域と内側rd<6.5の一様なキック係数を体積発光へ掛ける。層・旧露出係数は削除し、EMA／履歴は使わない。星を§4の3%／半径.6／power18／HDR6／上位.5%の6画素光条／背景上限.04へ戻し、高域位相による瞬きと対角の天の川を維持。
- `js/world/g-gargantua.js`: 品質0（6点／H×.35）、品質1（4点／H×.35）、品質2（4点／H×.5）の明示的なsetQualityを追加。毎フレームのCPU経路は事前確保したFloat32Arrayを再利用。品質はresetでも保持し、再生時刻による自動変更はしない。
- `tests/world/shoot-live.mjs`: world12Shoot／world13Shootを本ファイルのブラウザ注入ソースで置換。seekedとseeking=false、開始時刻への到達、その後のrAFを待ち、曲頭からcamera／hotspot／azimを復元して実AudioWorkletへ渡す。tより前のlead-inではreadbackせず、t以降の最初の描画をPNGとして保存し、G-1はt以降の異なる描画を20枚以上かつ.4秒以上収集。PBO＋fenceで転送を予約し、同期readbackと輝度集計はpause後へ移す。capturedSec／lag／sampleEndSec／標本数／窓幅を保存。
- `tests/world/shoot-live.mjs`: 各撮影窓で実際に消費された低域オンセットをG-kickに使用（固定帯域や人工キックは使わない）。直前／直後.1秒窓の画面輝度と最初の100ms以降の実標本を保存し、両方35%以上を要求。実キック・前後標本・ROI・100ms標本がない窓は不合格として理由を保存。6時刻の星径中央値≤1.5、白飛び≤18%、t=45の上下明弧厚み／影半径≥.35、G-1≥.6、実GPU p95≤16msをreportと終了コードへ接続。
- `tests/world/shoot-live.mjs`: GPU測定を先に実行し、p95超過の場合だけ§9.4の順序で品質を落として再測定。全試行と採用品質を記録し、その品質で撮影する。実GLSLの周期性／白芯／密度／LOD／キック／前方積分を320標本で照合するブラウザ検査と、Chrome不要のUW-55〜61（--unit）を同じ指定ファイル内に追加。

### 検証
- `node tests/run.mjs --unit`: 184件／182成功／1失敗／想定U15-00スキップ1、48,715ms。失敗は既存UW-52が廃止されたDISK_LAYER_A_SPEED=3等のv1.1定数を要求するため。定数や閾値を旧設計へ戻していない。全件成功ではない。
- `node --test tests/unit/world-gargantua.test.mjs`: 7件／6成功／1失敗／0スキップ、133.323ms。UW-52の最初の失敗は同ファイル96行のundefined !== 3（DISK_LAYER_A_SPEED）。既存重力／camera／resetの検査はその行まで通過。
- `node tests/world/shoot-live.mjs --unit`: UW-55〜61の7件／7成功／0失敗／0スキップ、24.849ms。H(3)=.10、H(14)=.595、κ=1.6、指定3段階の品質を検査。合成G-1は21枚／.5秒／中央値1、2枚・定数入力・空ROIを拒否。白飛び.18を合格／.19を不合格。単一画素の星径1.1283791671を合格／隣接2画素の1.5957691216を不合格。合成画面キック増加.36／100ms=1.1秒、オンセットなし等を拒否。合成影半径10.0451099506、弧4pxの比.3982037051を合格／3pxの比.2986527788を不合格。
- 撮影mock: seek listener→currentTime代入→seeked→rAFの順序、capturedSec=7.0／lag=0、G-1は25枚／.40000000000000036秒、転送予約34枚のreadbackが全てpause後、timeline／callback／資源の後始末を検査。これらは実GPU／実音の測定結果ではない。
- 全JS/MJS `node --check`: 最終129件／129成功／0失敗、7,716ms。指定3ファイルの `git diff --check` は成功。開始時から変更済みのSSOTの末尾空行は編集対象外。
- Chrome禁止のためブラウザを起動していない。新しいshoot-liveの6時刻、seek／最初の描画／20枚以上の実撮影、実キック35%、上下弧厚み、星径、白飛び、320標本の実GLSL検査、3段階のGPU測定、既存ブラウザ全件、file://／console確認は未実行。実GPU／実画像の受け入れ合格は未確認。

### spec.md 変更
- 指定3ファイルの範囲を優先し、doc/spec.md／README.mdは編集していない。既存の「2層」「大きい星」「露出抑制」等のv1.1記述は、レビュアーが§9への更新を行う必要がある。

### 備考
- 実装: Codex gpt-6.1-sol high
- 設計で未指定の具体化: 発光／吸収を区間中点でサンプルし、travelは曲がった光線の線分長を累積。スラブへ入る直前の区間にもH×刻み制限を掛け、薄い内縁の飛び越しを避ける。LODの逆順smoothstepはGLSL未定義なので数学的に同じ正順補数を使用。白芯はパレット混合の前へ適用。hotspotは既存の半径・寿命・HDRを保って体積密度で積分する。
- G-1の直接像: 最初の近側・内向きのスラブ通過の密度重み付き半径をalphaへ保持し、再入射する高次像を除く。旧平面交点の半径からの変更を実画素で確認すること。星の細い光条の幅は旧v1.0相当の.5pxを採用。時間の遅い瞬きは既存のt×.25を保ち、TWINKLE_SPEEDとして明示した。
- 計測定義の具体化: 星径は画面輝度.08以上の逃走背景の8近傍成分を1080p等面積直径へ換算し、小さい星を除外せず中央値を採る。影半径は画面中心の暗い（輝度<.1）地平面像の4近傍成分の等面積半径。上下弧は中心左右±影半径×.5の列で各方向の連続した輝度>.5の最長区間の中央値を採り、上下それぞれが35%以上を要求。実画像で領域の妥当性を確認すること。
- G-kickの具体化: 各撮影窓の前標本がある最初の実オンセットを使用し、前後各2標本以上と100〜150msの実標本を要求。別のオンセットが100ms標本までに再発した場合も不合格。G-1の.4秒は最小窓であり、遅いGPUでは20枚に達するまで長くなる。時間幅をJSONへ残す。
- §9.6が既定fbmを4オクターブと定義しているため、最初の性能fallbackでブラーを4点へ変更し、fbmは最初から最後まで4オクターブ。GPUの実測なしにMAX_STEPSや設計定数を調整していない。
- レビュアー確認: 実M4 MaxのGPUラッパーで `WORLD_CHROME_WRAPPER=/path/to/gpu-wrapper node tests/world/shoot-live.mjs` を実行し、上記全基準とcapturedSecの遅延、品質段階、PBOのメモリ／転送負荷を確認すること。UW-52を§9定数へ追従させ、BW-13-formulasの旧radial kick式、BW-14-periodicの廃止filamentInput／fbm、BW-14-screenの旧星400個／白飛び8%等を新設計へ更新すること。既存テストファイルは指定範囲外なので編集していない。継ぎ目／上下の量感／流れの勢い／白い芯／小さい星／32帯域／高域hotspot／負角camera／逆シーク／書き出し一致も目視確認すること。
- 開始時から変更済みの `doc/20261004-design-gargantua-v1.md` と tests/world/output/live/ の既存JSON／PNG／report.jsonは変更していない。commit／push／PR／Chrome起動／ゴールデン再生成は行っていない。
- 作業手順の逸脱: 最初の全単体テスト出力を誤って/tmp/world16-unit.txtへリダイレクトした。出力をworktree内のignored tests/output/world16-unit.txtへ移し、作成した外部一時ファイルを削除して修正。ソース編集は指定3ファイルのみ。

## 2026-10-07 — [WORLD-16] g-gargantua v1.3

### 作業内容
- `log.md`: SSOT §9 と既存描画・測定コードを確認し、設計の未定義事項と検証結果を先頭へ記録。WORLD-16 の体積描画・撮影ハーネス修正・受け入れチェック追加は未実装。`js/world/g-gargantua.js` と `tests/world/shoot-live.mjs` は変更していない。
- 指定の `CODEX_ADDENDUM.md`、実装者ガイド、spec.md §2・§24・§25、背景構想、renderer-contract.md、SSOT §9 を確認。`IMPLEMENTER_RULES.md` は指定パスに存在せず、セッションディレクトリ以下の検索でも見つからない。未読の規則を読了扱いにしていない。
- §9 は2層板とEMAの設計問題を撤回しているが、残す半径方向LODと白い内側コアの式は未確定。「計画が曖昧・矛盾なら STOP、定数を調整せず推測しない」という具体的な依頼条件と実装者ガイド §6 に従い、ここで停止した。末尾の「Do not stop」との矛盾は、設計式を自己判断で補う許可として扱っていない。

### 検証
- `node tests/run.mjs --unit`: 184件／183成功／0失敗／想定 U15-00 スキップ1、83,924ms、終了コード0。変更前の回帰確認であり、WORLD-16 の受け入れ合格を意味しない。
- 全 JS/MJS の `node --check`: 129件／129成功／0失敗、終了コード0。
- Chrome は起動していない。追加したブラウザテストは0件。体積流・星の復元・LOD・実キック・撮影時刻の同期・20フレーム以上のG-1・§9.5の受け入れは未実装／未実行。光の弧の厚さ、星の直径、白飛び率、画面キック増光、GPU p95 は未測定。

### spec.md 変更
- なし。製品コードと見た目を変更していないため、README.md も変更していない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 要回答1 — SSOT §9.2（§8.1 を残す半径方向LOD）: §8 の `fp = footprint / rd` は角度方向の値で、各オクターブの波長 `λ_k` の定義は依然ない。§9 の入力は `log(rd)*18` へ変わり、「半径方向のオクターブだけ」への適用手順もない。選択肢は (A) 半径方向フットプリントに基づいて3D fbmの各オクターブの振幅全体を減衰する、(B) 方位・高さ方向の成分を維持して半径方向の座標周波数だけを減衰する。両者は異なる模様になる。推奨は Opus が採用方式と、半径方向フットプリント・`λ_k`・座標／重み更新の正確な式を追記すること。WORLD-15 の停止事項のうちEMA／再投影は§9で不要になったが、LODは既存実装にも存在せず、その定義をそのまま引き継げない。
- 要回答2 — SSOT §9.2（T > .85 の白い内側コア）: 目標RGB `(1.0,.96,.9)` はあるが、「寄せる」割合・温度に対する遷移式がない。選択肢は (A) T>.85 を目標RGBへ置換する、(B) T=.85からT=1まで連続補間して目標RGBへ到達する。前者は境界に色の不連続を作り、後者は設計書にない補間式を追加する。推奨は (B) を設計者が式で明記し、パレット20%混合の前後どちらへ適用するかも確定すること。今回はどちらも実装していない。
- レビュアー確認: Opus に上記の式を SSOT §9 へ追記してもらい、欠落した IMPLEMENTER_RULES.md の正しい場所／内容を共有すること。その後、指定ファイルの実装に加え、world12Shoot の seek 完了・t以降の最初の描画待ち・G-1の20フレーム以上、撮影時刻の実キック計測を実装し、実GPUで§9.5の全基準を確認する必要がある。
- 開始時から変更済みの SSOT と tests/world/output/live/ の既存 JSON／PNG／report.json は編集していない。今回の意図した編集はこの worktree 内の log.md のみ。commit／push／PR／Chrome 起動は行っていない。

## 2026-10-07 — [WORLD-15] g-gargantua v1.2

### 作業内容
- `log.md`: §8 の設計確認と実装停止理由を先頭へ記録。WORLD-15 の描画実装・受け入れテスト追加は未完了。`js/world/g-gargantua.js` と `tests/world/shoot-live.mjs` は変更していない。
- 指定の `CODEX_ADDENDUM.md`、実装者ガイド、SSOT §8、既存の円盤・撮影・ブラウザテストを確認。`IMPLEMENTER_RULES.md` は指定パスに存在せず、今回の scratchpad の親セッションディレクトリ以下を検索しても見つからなかった。未読の規則を読了扱いにしていない。
- SSOT §8 の数値変更（fil の 1.8／1.5／.18、層 B の .35、基準係数 .78）は明記されているが、LOD・EMA・再投影・受け入れの未定義事項は既存実装にも定義がない。「曖昧・矛盾なら STOP、定数を調整せず推測しない」という依頼の条件と実装者ガイド §6 に従い、設計回答を待つ。依頼末尾の「Do not stop」は、この具体的な停止条件を取り消すものとして扱っていない。

### 検証
- `node tests/run.mjs --unit`: 184件／183成功／0失敗／想定 U15-00 スキップ1、29,369ms、終了コード0。既存 v1.1 実装の回帰確認であり、WORLD-15 の合格を意味しない。
- 全 JS/MJS の `node --check`: 129件／129成功／0失敗、7,230ms、終了コード0。
- Chrome は起動していない。追加したブラウザテストは0件。§8 の時間分散比、t=20／45 の v1.0 との目視比較、変更後の §7.7 の全基準は未実装・未実行・未測定。

### spec.md 変更
- なし。製品コードと見た目を変更していないため、README.md も変更していない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 要回答1 — SSOT §8 修正1（LOD）: `fp` は角度方向だが、`λ_k` の定義と単位がない。既存の周期入力は角度に対して cos/sin×3×1.6、層 B はさらに×1.7、各 octave は×2となる。選択肢は (A) ノイズ座標の波長 `2^-k` をそのまま使用する、(B) 周期入力の角度方向の倍率と層 B の倍率を含めて角度単位へ換算する。減衰する octave が変わる。推奨は (B) とし、Opus が `λ_k` の正確な式、`travel` が累積光路長かカメラからの距離か、FOV の角度単位を追記すること。逆順 smoothstep は GLSL で未定義なので、下降曲線を `1-smoothstep(.6,2.,fp/λ_k)` とする許容も確認する。
- 要回答2 — SSOT §8 修正4（EMA）: 「係数 0.6」が履歴と現フレームのどちらの重みか不明。選択肢は (A) `out=.6*history+.4*current`、(B) `out=.4*history+.6*current`。残像とキックの応答が変わる。推奨は平滑化の強い (A) を設計者が式で明記すること。今回はどちらも実装していない。
- 要回答3 — SSOT §8 修正4（回転再投影と深度）: 層 A/B は Ω×3.0／Ω×4.2 で異なって回転し、光線は最大3サンプルを合成する。どの層・通過の位置を履歴へ対応させるか、レンズ像の前画面座標をどう求めるか、5%比較の深度と分母が未定義。選択肢は (A) 層・通過ごとに履歴を持って各速度で再投影する、(B) 代表する最初の円盤交点で合成円盤の履歴を再投影する。前者は複数速度を保持するが資源・GPUコストが増え、後者は他の層・高次像の履歴に誤差を含む。推奨は Opus が (A) の再投影手順と深度比較式を定め、16ms予算を確認すること。単純な透視投影を重力レンズ像の再投影として採用していない。
- 要回答4 — SSOT §8 受け入れ: v1.1 比40%の時間分散について、画素領域、RGB／輝度・HDR／画面値、FPS、標本窓、回転追従の有無が未定義。既存の撮影 JSON は時間分散の基準を持たず、PNG は各時刻の単一画像である。選択肢は (A) v1.1 を同一入力・固定時刻で比較描画する、(B) 承認された v1.1 の画素時系列・分散を基準として提供する。推奨は (A) の同条件比較と、円盤領域・輝度段階・FPS・標本窓の明記。v1.0 の t=20／45 も承認された比較画像または再現方法が必要。
- レビュアー確認: Opus に上記の式・測定契約を SSOT §8 へ追記してもらい、欠落した IMPLEMENTER_RULES.md の正しい場所／内容を共有すること。その後、許可された対象ファイルで実装と shoot-live の §8 判定を追加し、実GPUで時間分散比≤.4、目視比較、§7.7 の全基準を検証する必要がある。
- 開始時から変更済みの SSOT と tests/world/output/live/ の既存 JSON／PNG／report.json は編集していない。今回の意図した編集はこの worktree 内の log.md のみ。commit／push／PR／Chrome 起動は行っていない。

## 2026-10-05 — [WORLD-14] g-gargantua v1.1

### 作業内容
- `js/world/g-gargantua.js`: SSOT §7.1〜7.6の名前つき定数を実装。φをcos/sinの周期座標へ変換し、y=±.035の2層を進行方向順に前方合成。層A/Bの速度3.0/4.2、Bの空間スケール1.7／位相2.1、各層の不透明度.6、全体のケプラー係数1.35を適用。filをpower3／gain2.2／base.08、円盤強度を.55、kick係数を2.6へ変更。半解像度／180ステップ／既存postは維持。
- `js/world/g-gargantua.js`: 最接近距離1.3〜3.2の画素だけ2×2サブサンプルを平均。星を確率.05／power10／HDR9、1080p半径1.2〜2.6、3倍半径の光暈／強さ.15、上位2%の長さ10〜18／太さ1の光条へ変更。芯のみ.6、それ以外の背景は.04上限。仰角表／第二drop−10度／3度sin(t×.07)の揺れを実装。基底仰角を別に保持し、遷移で揺れを二重加算しない。dropでは1.2秒のsmoothstepで重力2.1／地平面1.18／ISCO3.4へ、終了時は2秒で戻す。画面対角線に沿う帯を逃走光線方向で引き、5オクターブfbm／.035上限で天の川をレンズ化。
- `tests/browser/world14.test.js`（追加）: BW-14-screen／BW-14-periodic。画面の白飛びY≥.97／割合≤.08、表示sRGBの内側キック増光≥.35、直接像φ折り返しの左右4画素差／周辺差≤2倍、背景マスク内の連結成分で星の等面積直径≥1.5画素／平均400個、既存の実GPU p95≤16msを測定する。periodicは両層×64半径×6時刻＝768標本で実GLSL入力／fbmの±π連続性と有限値を測る。未実行。
- `tests/world/shoot-live.mjs`、`tests/browser/world13.test.js`: 指定の6時刻（7/20/31/45/62/90）は維持。live窓の各フレームに新しい画面白飛び判定、最終画像に星の個数・直径を保存し、各時刻の継ぎ目も測定。G-kickの合否を画面値へ変更し、新しい全判定をreport.jsonと終了コードへ接続。G-1／実GPU条件／120標本／disjointなし／16msは維持。旧BW-13のHDR40%判定は削除・緩和しない。数式テストのkick2.6／星芯上限.6は§7の上書きに追従し、計測targetをRGBA32Fにして上限は同じFloat32表現で比較。
- `tests/unit/world-gargantua.test.mjs`: UW-48の仰角表を§7へ追従。UW-52〜54で実状態の重力ease／地平面／ISCO／揺れ／負角／reset、指定定数、合成画面の白飛び境界／キック／星サイズ／継ぎ目／平均400個／空領域拒否を追加。
- `README.md`、`doc/spec.md`: v1.1のユーザー向け挙動と追加撮影判定を記載。`log.md`: 本エントリを先頭へ追加。

### 検証
- `node tests/run.mjs --unit`: 184件／183成功／0失敗／想定U15-00スキップ1、25,777ms、終了コード0。先行実行も184件／183成功／0失敗／同スキップ1、25,926ms。最新の出力はignoredの`tests/output/world14-unit-suite.txt`。
- 全JS/MJSの`node --check`: 129件／129成功／0失敗、終了コード0。出力はignoredの`tests/output/world14-syntax.txt`。`git diff --check`: 成功。
- UW-52（実JS状態）: surgeの半分で重力1.8／地平面1.09／ISCO3.2、完了で2.1／1.18／3.4（Float32許容誤差1e−6）。ease-in1.2秒／ease-out2秒、第二drop基底仰角−10度、reset後のcamera／gravity再演差0。UW-48〜51と既存のUW-39／43／47も成功。
- UW-53（合成画素）: 白飛び.08は合格／.09は不合格、表示kick増加.36は合格／HDRだけ2倍かつ画面増光0は不合格。合成星の背景外除外と1画素除外を確認し、2×2画素の等面積直径2.256758334191025、可視星1個。
- UW-54（合成画素）: 連続φ折り返しの輝度差比1、人工的な継ぎ目の差比6を不合格、合成星399／401の平均400を合格、空測定／白飛び.081を不合格。
- Chrome禁止に従い起動していない。BW-14-screen／BW-14-periodic、更新BW-13-formulas、既存BW-13-render／kick-gpu、shoot-liveの6時刻と全追加判定、file://の初期化／console、既存ブラウザ全件は未実行。実GPUコンパイル・白飛び率・表示kick・実星数・実継ぎ目・GPU p95は未測定。単体／合成データの数値はブラウザ受け入れの合格を意味しない。

### spec.md 変更
- v2.21（2026-10-05）。§1.1に2層の渦、星の光暈と光条、上下カメラ／第二drop、重力の増強、対角線の天の川、リング付近サブサンプルを追記。設計定数は重複記載せずSSOT §7を参照。

### 備考
- 実装: Codex gpt-6.1-sol high
- §7.4の差分: 最接近距離は追跡後にしか分からないため、中心光線で分類し、対象画素はさらに4本を追跡してそのRGBだけ平均する。対象外は1本、対象は判定用1本＋2×2の4本＝5本。選択肢はこの正確な測地線分類／事前の影位置近似による4本のみ。指定の1.3〜3.2判定と四隅平均を保つ前者を採用。中心の測定alphaを保持し、4本の半径を混ぜてG-1の環境界を汚さない。最接近距離は各積分線分上の最近点を含めて測る。GPU予算への影響をレビュアーが確認すること。
- §7.1の具体化: Ωの基準係数を1.35へ変えたうえで層ごとの3.0／4.2も掛ける（内縁の層速度は4.05／5.67×motionSpeed rad/s）。Bの位相2.1は回転角へ加算、空間スケール1.7はfbm入力xyだけへ掛け、t×.05は維持。§1の最大3円盤サンプルは合計で維持する。G-1の直接像は近側の最初の有効層を採用し、2層までの通過は許すが3サンプルの高次像は除く。
- §7.6の具体化: 表にないmainの6度は維持。smoothstepの共有進行度で重力／地平面／ISCOを指定端点へ補間し、内縁fade幅.25は移動後も維持。帯域番号／温度／ケプラー速度の基準3Rsは§3／§2を維持。天の川はcamera right−upで対角線方向を定義し、従来の帯幅.18／大域スケール3を維持する。haloはガウス＋外周smoothstep、芯は半径内へなめらかに切り、星の芯だけ.6へ上限を緩和。光暈／光条は非芯の背景上限.04を守る。
- §7.7の具体化: kickは従来の直前／直後の各6枚窓に加え100msの実標本も画面輝度で≥35%を要求。白飛びは既存captureの全RGB≥250指標を流用せず、指定の輝度Y≥.97で全画素を数える。全6時刻と各live1.5秒窓の全測定フレームで判定する（曲全体の全フレーム撮影ではない）。星の「見える」は画面Y≥.22の芯を8近傍で連結し、等面積直径≥1.5（1080p換算）、64画素を超える巨大成分を除く。400個は6撮影の平均で判定する。視認閾値／直径の定義は設計書にない測定上の判断であり、レビュアーが画像と照合すること。
- 継ぎ目測定は撮影時の音楽・incl・重力・時刻を保ち、方位角だけ一時的にπへ回して近側φ=±πを画面に置く。直接像のrd3.5〜10.5、左右4画素の平均輝度差と左右8画素離れた同じ幅の差を比較し、比≤2を要求。空ROIは不合格。実際の6枚とは別の測定カメラであり、レビュー時に実画像の継ぎ目も確認すること。BW-14-periodicは数式レベルの補助検査。
- レビュアー確認: M4 Maxの実GPUで`WORLD_CHROME_WRAPPER=/path/to/gpu-wrapper node tests/world/shoot-live.mjs`を実行し、G-1≥.6／白飛び≤8%／画面G-kick≥35%／平均可視星≥400／継ぎ目差≤2倍／GPU p95≤16msを確認。BW-14-*、更新BW-13-*、既存ブラウザ全件とfile://のconsole0、上下面の2層・速い流れ・負角への4秒ease・surgeの出入り・星の芯／光暈／光条・斜めの帯のレンズ像・逆シーク／書き出し一致も確認すること。今回の定数やMAX_STEPSは実測なしで調整していない。
- 開始時から変更済みのSSOT `doc/20261004-design-gargantua-v1.md`、`tests/world/output/live/report.json`と未追跡の6組の既存撮影JSON/PNGは変更していない。全編集はこのworktree内。commit／push／PR／Chrome起動／ゴールデン再生成は行っていない。

## 2026-10-04 — [WORLD-13] g-gargantua

### 作業内容
- `js/world/g-gargantua.js`（追加）: SSOT §1〜4の名前つき定数・黒体表・6kindカメラ表を実装。h²保存量、180ステップの非正規化積分、y=0通過の補間、最大3サンプルの前方合成、地平面／逃走を半解像度の全画面shaderで計算し、線形texture補間で拡大。ケプラー回転、4オクターブのfilament fbm、包絡、20%パレット、clamped Doppler、32環（外側低域）、低域オンセットの内側フレア、高域オンセットの固定12枠hotspotと星の位相、ラウドネス露出、4秒カメラeaseと第二dropを接続。背景は最終逃走方向から星・明滅・上位0.5%の4方向光条・2層の天の川を引き、線形HDRの各RGBを.04以下に制限。
- `js/world/analyzer-types.js`、`world.html`: 選択肢からg-ringsを除き、g-galaxyをg-gargantua（ブラックホール、key2）へ置換。選択可能2タイプ＋予約3枠。旧2shaderは既存回帰テストを維持するため読み込みだけ残す。新classic scriptとpostの依存順を明示。
- `js/world/world-engine.js`、`js/world/post.js`: 新タイプの初期化・半解像度targetのresize・既存0.5秒fadeを接続。選択中はfeedback更新／露出縮約を停止し、現在像からthreshold1.0／strength.35の既存多段bloom、既存ACES・sRGB変換を適用。既存の新タイプ基準露出.75に(.85+.3*loudnessNorm)を掛ける。bloom strengthは新タイプの名前つき定数からGLSLへ展開し二重定義を避ける。旧postのbeat、静寂／dropフラッシュ、履歴、色収差、vignette、追加色補正はこの分岐へ持ち込まない。DOFのパスは追加しない。
- `tests/world/shoot-live.mjs`: 既定をg-gargantua、t=7/20/31/45/62/90へ変更。曲頭からt−1.5まで既存timelineで再演して累積カメラ位相・4秒ease・寿命6秒のhotspotを復元し、seeked待ちの後に実再生で指定時刻の最初のrAFを撮影。直接像の32環の平均線形HDR輝度／L・画素数・表示sRGB輝度・cameraをJSONへ保存し、各撮影と6撮影全体のG-1中央値≥.6を判定。別の定常入力でキック直後[0,.1)の平均とage=.1秒の実標本の両方で内側直接像の輝度増加≥40%と、1080p・全パスGPU p95≤16ms（実GPU／120標本以上／disjointなし）を検査しreport.jsonへ保存。
- `tests/browser/world13.test.js`（追加）: BW-13-renderで実GLSL、960×540、直接像、beat無反応、hotspot上限／位相を検査。BW-13-kick-gpuで内側直接像のキック増光と実GPU p95を検査。BW-13-formulasで実GLSLの黒体5端点、外側低域の32環／100msキック式、8,192方向の星空上限を読み戻す（未実行）。G-1領域はraytrace targetのalphaへ保持した半径を使い、最初の平面通過・近側・内向き・有効円盤サンプル1回だけを採用し、高次像と背景を除外する。alphaは測定情報であり、postのRGBへ影響しない。
- `tests/browser/world11.test.js`、`tests/browser/world12.test.js`: 現行タイプ選択／export検査をfluid/gargantuaへ更新。旧G-1〜4・光線／銀河／火花の回帰検査はテスト内で旧タイプを明示的に登録し、既存ID・閾値を維持。measure.mjsの旧G結果は旧shaderの回帰であり、新ブラックホールの受け入れを意味しない。
- `tests/unit/world-gargantua.test.mjs`（追加）: UW-48〜51でカメラ表／ease／第二drop、キック包絡、hotspot上限／決定性／同時刻の重複消費防止／連続フレームの別オンセット、露出、直接像の32環／G-1／100msキック判定を検査。文字列生成を避けた数値FNVの60ケースが従来の位置hashと完全一致することを検査。
- `tests/unit/world-score.test.mjs`、`tests/unit/world-exporter.test.mjs`、`tests/unit/world-shaders.test.mjs`: UW-39の現行タイプと半解像度／feedbackなし／資源再利用、UW-42の選択export、UW-43のcamera／kick／hotspotを含むlive・再演・逆シーク一致、UW-47の新2fragmentを含む21shaderのprecisionを検査。UW-45の旧火花回帰はテスト内だけの登録で維持。
- `README.md`、`doc/spec.md`: TYPE、ブラックホールの音楽対応、設計書への参照、撮影・受け入れコマンドを更新。

### 検証
- `node tests/run.mjs --unit`: 181件／180成功／0失敗／想定U15-00スキップ1、27,462ms、終了コード0。再開直後の差分確認時も180件／179成功／0失敗／同スキップ1、27,340ms。最新出力はignoredの`tests/output/world13-unit-suite.txt`。
- `node --test tests/unit/world-gargantua.test.mjs tests/unit/world-score.test.mjs tests/unit/world-shaders.test.mjs tests/unit/world-exporter.test.mjs`: 51件／51成功／0失敗／0スキップ、2,385.546ms。出力はignoredの`tests/output/world13-targeted.txt`。
- 全JS/MJSの`node --check`: 128件／128成功／0失敗。出力はignoredの`tests/output/world13-syntax.txt`。`git diff --check`: 成功。shoot-liveの`--help`: 成功、Chrome起動なし。
- UW-39（GPU命令モック）: availableTypes=2、32環、内部960×540、MFS→帯域uniform遅延0フレーム、fade=.5秒、非選択fluid更新0、選択中feedback更新0、選択／描画によるGPU資源増加0。
- UW-48: 全6kind表一致、4秒easeの2秒地点dist=18.5、第二drop dist=13／周回速度=.09／円盤係数=2.025、MAX_STEPS=180。
- UW-49: 100ms後kickEnv=.40289032459259033、hotspot固定容量12／イベント15／規定寿命6秒、同時刻の二重生成0、連続オンセット2件を両方消費、seed再演差0、loudness=.5時の露出係数1。
- UW-43（GPU命令モック）: fluid／gargantuaで固定30Hzのlive・renderAt・逆シーク後の帯域／拍状態一致。gargantuaのcamera／music／hotspotも完全一致。
- UW-50（合成測定データ）: 32環、外側band0／内側band31、直接像から除外1画素、Pearson中央値1／定数入力拒否、合成キック増加率.41を合格・.39を不合格。実画素のG-1・実キックの合格を意味しない。
- UW-51: 数値FNVと従来位置hashの比較60ケース、差0。文字列連結を新しい描画経路から除去。
- UW-47: 21shader（vertex5／fragment16）、precisionヘッダー違反0。これは実GPUコンパイルの検証ではない。
- Chromeは禁止のため起動していない。新規BW-13-render／BW-13-kick-gpu／BW-13-formulas、更新BW-11-types／BW-11-export、維持BW-12-*、shoot-liveの6時刻・G-1・キック・GPU p95、file:// console、既存ブラウザ全件は未実行。実GLSL・実画素・実GPU数値は未測定。ゴールデンは変更していない。

### spec.md 変更
- v2.20（2026-10-04）。§1.1のTYPEとブラックホールのユーザー向け挙動を更新し、新SSOTを参照。数式・定数の再記載はしない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 指定SSOTの値・受け入れ閾値は調整していない。MAX_STEPSは180のまま。§5の140への性能退避は実GPU測定なしでは採用していない。
- §1の「地平面→黒」は地平面からの放射／透過先が0と解釈し、手前の円盤の前方合成は保持する。選択肢は蓄積光も全消去／地平面の背景だけ0。円盤が穴を遮る物理像と指定の前方合成を両立する後者を推奨して実装。設計者の確認が必要。
- §2・§3のsmoothstep(6.5,3,rd)はGLSLの逆順edgeで未定義。指定の下降曲線を1−smoothstep(3,6.5,rd)で表現。黒体のTは外縁で表の.33より低くなるため、表の端点へclamp（外挿との選択では表の保持を推奨）。fbmは4段の通常のvalue noise、2倍周波数／半分振幅を使う。定数の数式はそのまま。
- §3の帯幅15%は境界の両側7.5%ずつ、隣接Lを境界で50:50へsmoothstep補間。片側15%とする選択肢より指定の総幅を保持する解釈を推奨。hotspotの未指定の決定的位置はseed＋イベント通番のworldHash（再開後は同一出力の数値FNVへ置換）、ガウス半径は標準偏差.18、寿命内のHDR6の減衰は線形で6秒に0。再開時にMFSの実契約（AudioEngineの未消費ホップ集約、再取得時0）を確認し、前回差分の立ち上がり検出を修正。連続フレームの同一bitは別イベントとして両方を消費し、同時刻の再描画だけ二重消費を防ぐ。初回カメラには前のkindがないため表の値から開始し、kind変更で4秒easeする。
- §4の未指定の細部: 星のセル内位置／色／位相は同じ決定的hash、星の半径.6画素は出力画素に対するガウス標準偏差。phase_starにt×.25を加え、ゆっくり明滅させる。光条は細い4方向、長さ6画素で線形減衰。セルの近隣27個も評価して端で光条を切らない。天の川は大きいfbm2層に固定した銀河面のガウス包絡を掛ける。背景の.04上限は線形HDRで適用（ACES／sRGB変換後の表示RGB上限ではない）。これらの未指定形状／時間尺度／減衰の解釈は設計者が確認すること。
- §6の「キック直後0.1秒」は直前[−.1,0)と直後[0,.1)の各6枚の平均線形HDR輝度に加え、age=.1の単一実標本も比較し、両方に≥40%を要求する。窓平均だけ／100msの単一枚だけの選択肢に対し、曖昧さを隠さず両方の結果を残す方式を推奨。表示sRGBも併記する。直接像の領域で比較し、空領域や標本不足を合格にしない。§6は測定する輝度の段階を指定していないため、G-1とキックはSSOTの発光式／HDR6／背景上限と同じ線形HDR輝度を採用。最終sRGB輝度を合否へ使う選択肢より、音楽が増やした光の量を直接検査する方式を推奨し、表示輝度も保存する。設計者がこの測定段階を確認すること。shoot-liveのG-1は各1.5秒窓と全6窓をともに検査する。
- レビュアー確認: M4 Maxの実GPUで`WORLD_CHROME_WRAPPER=/path/to/gpu-wrapper node tests/world/shoot-live.mjs`を実行し、6枚の像・G-1中央値≥.6・キック≥40%・GPU p95≤16msを確認。BW-13-*（formulasを含む）、BW-11-*、BW-12-*、既存W/BW、file://初期化／console0、流体↔ブラックホールのfade、逆シーク／書き出し一致、レンズの上下像／光子リング、背景階層と瞬き、第二dropのカメラを確認すること。失敗時は測定値と該当SSOT節を報告し、定数を独断で調整しない。
- 依頼どおり見出しは2026-10-04。全編集はこのworktree内。既に未追跡だったSSOT `doc/20261004-design-gargantua-v1.md`は変更していない。commit／push／PR／Chrome起動は行っていない。

## 2026-10-03 — [WORLD-12] GLSL precision 宣言順序の修正

### 作業内容
- `js/world/gl-util.js`、`js/world/analyzer-types.js`: 共有GLSL断片内のprecision宣言を取り除き、断片より前に各シェーダー側で宣言する。旧WORLD_GLSLはWORLD_GPU_DESIGN_GLSLのfloat定数・関数より後にprecisionがあり、フラグメントの初期化に失敗していた。
- `js/world/gl-util.js`、`js/world/fluid.js`、`js/world/particles.js`、`js/world/post.js`、`js/world/g-fluid.js`、`js/world/g-rings.js`、`js/world/g-galaxy.js`、`js/world/world-engine.js`: 全19ソースの先頭を、#version 300 es → precision highp float → precision highp int → precision highp sampler2D の順に統一。
- `tests/unit/world-shaders.test.mjs`（追加）: UW-47。world.htmlのscript順でloadClassicを使い、全js/world/*.jsの文字列定数からmainを持つ組立済みソースを取得。全ファイルの読込、19本（vertex 5／fragment 14）の網羅、version単一、他の宣言より前の完全なprecisionヘッダーを検査。version欠落も検出対象。

### 検証
- `node tests/run.mjs --unit --filter UW-47`: 修正前はUW-47失敗（終了コード1）、修正後はUW-47成功（終了コード0、241ms）。filter時の28件表示には他27ファイルの空実行を含む。
- `node tests/run.mjs --unit`: 177件／176成功／0失敗／想定U15-00スキップ1、27,078ms、終了コード0。実行ログはignoredの`tests/output/world12-glsl-unit-suite.txt`。
- 全JS/MJSの`node --check`: 125件／125成功／0失敗。`git diff --check`: 成功。
- precision宣言行を除いたHEADとの差分比較: 変更した本体9ファイルすべて完全一致。設計の数式・定数の変更0。
- Chromeは禁止のため起動していない。新規ブラウザテストはなし。既存BW-12-design／BW-12-sparks-ramp、BW-11、file://の初期化・コンソール、ANGLE/Metalでの実GLSLコンパイルは未実行／未測定。

### spec.md 変更
- なし。既定の描画を復旧するprecision修正であり、見た目の設計・製品仕様の変更はない。チケット範囲に従いREADME.mdも変更していない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: 共有断片の内部で宣言する方式から、各完全ソースのversion直後へ移動した。テスト用exportは追加せず、既存loadClassic.getで実際の組立済み定数を読む。日付は依頼の2026-10-03を使用。
- レビュアー確認: 実Chrome（ANGLE/Metal）でworld.htmlをfile://で開き、window.__world.errorがなくengineが初期化され、コンソールエラー0であること。既存BW-12-design／BW-12-sparks-ramp／BW-11と3タイプの描画・切替・書き出しを確認すること。単体検査は実GPUコンパイルの合格を意味しない。
- 全変更はこのworktree内。commit／push／PRは行っていない。

## 2026-10-04 — [WORLD-12] GPU アナライザー詳細設計 v1 の実装

### 作業内容
- `js/world/score.js`: SSOT §1.1の12組・108成分の線形RGBパレットへ置換。主音クロマの選択、同値の音名順、kind/labelによる役割回転、曲固有の速度／detail／粒子量は保持。
- `js/world/gl-util.js`、`js/world/analyzer-types.js`: SSOT §1〜4のGPU式を名前つき定数として共有。bandColorと補色生成を廃止し、bandRamp、L/G、正確な4/13/8帯域平均、軌道位相積分、pulse/mids、直近4拍を事前確保バッファへ格納。配色は既存UBOの役割回転・モーフと共通。音声なしrenderAtだけ拍格子を使用。
- `js/world/g-rings.js`: SSOT §2の背景、光核、鏡像64光線、先端、残光、RGBごとの衝撃環、小節頭露出を実装。onset閾値通過／新onsetイベントで先端から8粒/光線を供給。
- `js/world/particles.js`: 既存262,144粒の更新／描画program・MRT・ping-pongを火花に再利用。8粒×64光線×512世代の固定プール、初速.25+L*.5、寿命.5秒、bandRamp×HDR2。音声ステップで運動し、音声時刻で寿命を判定。fluidへ戻る際も既存GPU更新の初期化分岐で状態を戻す。新しいGPUパス／targetは追加しない。
- `js/world/g-galaxy.js`: SSOT §3の62度投影、32×1024点、非線形の軌道半径、BPM/帯域比例位相、2本の渦腕、半径変調、ダストレーン、奥側減光、拍スケールを実装。背景／核／楕円衝撃環の全画面パス1枚と既存の加算quad点描画を使用。
- `js/world/g-fluid.js`、`js/world/fluid.js`、`js/world/world-engine.js`: SSOT §4の半径.32・220度円弧、最大.02/sの大域場移流、±.006の決定的フレームハッシュ、半径.010+L*.018のガウス注入、pow(L,1.5)*6、拍の露出.30と放射加速40セル/s、中心渦1〜3倍を接続。染料移流パス内で完全なガウスを加算し、従来の90×dt注入・直接描画の20倍核・全域への一律染料供給を置換。流体20圧力反復、カメラ、overscan、独立深度層、タイプ切替、export、固定timeline/renderAtは保持。旧postの全タイプ共通pulseは0として、タイプ内の指定pulseと二重適用しない。
- `tests/unit/world-score.test.mjs`: UW-12/16の旧高彩度／180度補色を指定表の厳密一致へ変更。UW-33/38の旧不等間隔曲線／周期位置を明示的な円弧・整形・移流・hash・再演へ変更。UW-39の旧可変65,536点と旧post pulseを固定32,768点／タイプ内pulseへ変更。UW-44〜46で帯域整形・包絡・位相・火花イベント・G-1中央値の計測を追加。テストIDの削除／skip追加／G/W/BW閾値の緩和はなし。
- `tests/browser/world11.test.js`: G-1領域を鏡像64光線の回転扇形／62度の非線形32軌道環へ追従させ、入力を整形Lへ変更。既存measureの全32帯域最小相関≥.6とG-2〜4の基準は保持。
- `tests/browser/world12.test.js`（追加）、`tests/world/shoot-live.mjs`（追加）: WORLD_CHROME_WRAPPERによる実GPU起動、既定synthSong(48000,{bpm:128,seed:11})／--wav、t-1.5へのseeked待ちと実再生、tに達した最初のrAFの最終RGBAのPNG保存、各フレームのLと領域平均Y、32帯域相関の中央値≥.6を実装。撮影時だけoffline timelineを外してlive AudioWorkletを使用。PNGと生時系列JSONはtests/world/output/live/<type>-<t>へ保存。BW-12-designとBW-12-sparks-rampは実GLSL・白飛び・点数・bandRamp・CPU/GPU大域場・火花の個数／位置／速度／寿命を検査する。

### 検証
- `node tests/run.mjs --unit`: 176件／175成功／0失敗／想定U15-00スキップ1、64,566ms、終了コード0。先行全件実行も同じ成功件数（65,952ms）。出力はignoredのtests/output/world12-unit-suite.txt。
- `node --test tests/unit/world-score.test.mjs tests/unit/world-exporter.test.mjs`: 46件／46成功／0失敗／0スキップ、1,431.401ms。出力はignoredのtests/output/world12-unit-detail.txt。
- 全JS/MJSの`node --check`: 124件／124成功／0失敗。`git diff --check`: 成功。CLI --help: 終了コード0、Chromeは起動しない。
- UW-12/16: 12組、96曲、RGB108成分の選択誤差0。UW-33: band17 raw=.8→L=.9770768064205642、同時刻／逆方向renderAt後の再演差0。
- UW-38: 円弧半径のFloat32誤差1.4272308446e-8、最小帯域間隔.03961051623、最大移動速度.020000000000000157/s、最大ジッター.005999666382、reset差0。
- UW-39/43: 64光線、32軌道、32,768点、MFS→uniform遅延0フレーム、.5秒fade、非選択fluid更新0、GPU資源増加0、live/renderAt/逆シークの帯域・拍状態差0（GPU命令モック）。
- UW-44: mid=.574349175934、100ms後のG=.548811614513、beatEnv=.535261452198、barEnv=.751477301121、軌道位相誤差<1e-7、dt0積分差0。UW-45: 8粒/光線、鏡像2光線/帯域、onset2回、先端半径.620000004768、同時刻の二重生成0、資源増加0（GPU命令モック）。UW-46: 合成時系列のPearson中央値1、定数入力0で不合格。
- Chrome禁止に従いブラウザは一切起動していない。BW-12-design／BW-12-sparks-ramp、撮影スクリプト、既存BW-11の切替/export、G-1〜4、W/BW全件、file:// console、実GLSL・実画素・実GPU p95は未実行／未測定。上記モック・合成時系列の数値を実GPUの合格とは扱わない。ゴールデンは変更していない。

### spec.md 変更
- `doc/spec.md`をv2.19（2026-10-04）へ更新。§1.1の見た目を詳細設計v1への参照とともに更新。`README.md`の試作説明と実音撮影コマンドも更新。

### 備考
- 実装: Codex gpt-6.1-sol high
- §2のsmoothstep(1.2,.15,r)はGLSLの逆順edgeで未定義。指定下降曲線を1-smoothstep(.15,1.2,r)として忠実に実装。定数は変更していない。
- §4の円弧の方位／中心、ガウスの半径の意味と注入量の時間単位は未指定。選択肢は0〜220度／±110度、点ごとの移流／円弧全体の移流、有限quad／全画面でのガウス評価。円弧形状と「曲線全体」の保持を優先し、中心原点・±110度、円弧中心のworldFlowをCPUで同式評価して全体を平行移流、画面半径を1/e半径とするexp(-distance²/radius²)、量は既存solverと同じ秒あたり（dt積分）として実装。lens.zで半径を補正して画面の指定半径を保つ。これを最も忠実な実装として推奨するが、方位・半径の解釈は設計者に確認が必要。
- §3の奥側減光は前面1.0→背面.75の線形補間、size(px)は点の直径として既存quadへ適用。点のGaussian形状exp(-localRadius²*4)は既存描画を維持。§2の火花には散乱方向が指定されていないため8個とも指定された光線方向・初速をそのまま使い、独自の角度／位置の散乱は足していない。点の形状は既存速度ストリークを維持。重なった8個の明るさは目視確認が必要。
- §1.4の「背景輝度≤.02」と§2の星の固定式は同時に厳密には満たせない（星のHDR白は.6×.35=.21）。選択肢は式の保持／背景係数の変更。SSOTの数式をそのまま実装している。目安と固定式の関係は設計者の確認が必要。定数を測定結果に合わせて調整していない。
- §5のG-1はringsの回転扇形とgalaxyの軌道半径の中点で区切った環で測定。g-fluidの対応領域は指定されていないため撮影／時系列Lは保存し、相関はN/Aと報告する。既存measureのG-1全帯域最小値基準は緩めず、今回指定の中央値基準はshoot-liveで別途報告。時系列の無変化は0相関として合格にしない。
- 明示されたv1の円弧移流に合わせ、旧UW-33/38の位置ループ一致／不等間隔の要求を新仕様へ置換。固定ステップの再演一致、パレットのループ一致、帯域分離、移流上限、hashの決定性は検証。円弧の積分移流そのものに曲末=曲頭の位置一致は課していない。
- レビュアー確認: 実GPUラッパーでshoot-liveの3タイプ×4時刻を実行し、実音G-1中央値≥.6、実AudioWorklet特徴取得、seekedと最初のrAFの撮影を確認。BW-12-*／BW-11-*、既存W/BWとG-2〜4（1080p p95≤16ms、既存BW-7-performance≤14ms）を実行し、GLSL、白飛び≤2%、旧post pulseを止めた拍反応、流体の帯域応答・明るさ・鋭さ、円弧の方位／移流、同方向8粒の火花、62度円盤の見切れを確認すること。失敗した場合は定数を調整せず、該当節・選択肢・推奨案を報告すること。
- 初回の単体テスト出力を誤って/tmpへ保存したため、完了後にworktreeのignored tests/output/world12-score.txtへ移動して元の一時ファイルを除去した。以後の出力と全コード／文書の変更はこのworktree内。開始時から未追跡のSSOT doc/20261004-design-gpu-analyzers-v1.mdは変更していない。commit／push／PRは行っていない。未コミット差分として納品。

### GLSL初期化の修正追記
- precision宣言順序の修正とUW-47の検証は、本ログ先頭の「2026-10-03 — [WORLD-12] GLSL precision 宣言順序の修正」を参照。

## 2026-10-04 — [WORLD-11] GPU アナライザー群 第1弾

### 作業内容
- `world.html`、`js/world/world-app.js`: 常設TYPE選択を追加。構想表の順で1=g-fluid／2=g-rings／4=g-galaxy、3・5・6は後続タイプの予約枠として表示し選択不能にする。再生中／一時停止中の切替を約0.5秒でクロスフェード。書き出し中はタイプを固定し、UIから選択IDをexportへ渡す。全曲特徴の集計はoffline MFS準備後の読込時に行う。
- `js/world/analyzer-types.js`（追加）: 6枠の登録情報、事前確保した32帯域uniform、残光、積分位相、帯域群onset、直近4拍の状態を共有。各タイプのid／label／init(gpu)／render(input)と固定ステップstepを分離。
- `js/world/g-fluid.js`（追加）: 従来の流体合成shader／programの所有者を独立タイプへ移動。共有fluid／particles／depthParticlesを接続し、BPMは固定dtを変えず速度uniformへ適用。共有エンジンに残るcomposite等の公開口は既存W/BW計測との互換用。
- `js/world/g-rings.js`（追加）: 32帯域に2本ずつ、計64本のHDR放射光線。現在レベルに結びつく長さ／輝度、独立した残光包絡、拍ごとの同心衝撃環、BPM比例の細部の移動を描く。
- `js/world/g-galaxy.js`（追加）: 32本の傾いた楕円粒子軌道。帯域のレベルから即時増光・積分速度・半径揺動、onsetから輝度と線幅を変える。全曲特徴から1軌道512〜2048粒を決定。最大65,536粒をquadで描き、同じHDR／bloom／ACESを使用。
- `js/world/world-engine.js`: 選択タイプだけを更新・描画。2枚の再利用HDR targetで現在像を保持して切替先へsmoothstepフェードし、連続した再切替も現在の混合像から始める。停止中のフェードではsimulationを進めない。setScore／renderAt／逆シークでタイプ選択を維持し、位相と残光を決定的に再演。固定step・既存244 float UBO・GPU timer query・資源解放は保持。
- `js/world/fluid.js`、`js/world/particles.js`: 32帯域の大きな染料注入（90×dt、従来6×dt）、レベルで広がる発光フィラメント、粒子供給の増量を追加。流速をBPM、染料／供給線の細部を全曲detail、主粒子の可視量をparticleAmountから駆動。262,144粒の状態容量・描画命令と独立4,108粒の深度層は保持。
- `js/world/post.js`: 全タイプの拍から全画面の輝度・スケールpulse。新タイプは固定露出で帯域応答を保持し、pulseは露出測定後へ適用。タイプ切替に合わせて露出方針も連続にブレンド。新形態のbloomは現在HDR像から作り、旧build履歴の再注入を除く。露出縮約は従来の半解像度入力を保持。
- `js/world/score.js`: 上位クロマ（同値は音名順）から主色・補色・アクセント、BPM/120からmotionSpeed、全曲平均重心とonsetイベント密度からdetail／particleAmountを決定。入力不変、曲＋seed＋特徴量で決定的。ラベルのモチーフ・kind/labelの変奏・連続色モーフは維持。
- `js/world/world-exporter.js`: options.typeIdの選択タイプで曲頭から書き出し。開始時の選択は即時、手動切替履歴は焼き込まず、既存音声・固定dt・muxer・中止／解放経路を再利用。
- `tests/unit/world-score.test.mjs`、`tests/unit/world-exporter.test.mjs`: UW-39〜43でタイプ契約／即時uniform／0.5秒フェード／inactive fluid停止／GPU資源再利用／曲固有値／測定関数／選択タイプの180枚export／逆シーク・live再演一致を追加。UW-12／16の旧固定寒色・olive禁止だけを§2.8のクロマ上位・補色へ書換え、RGB範囲・飽和度・三色・180度の検査を保持。既存テストIDの削除／skip／閾値緩和は行わない。
- `tests/browser/world11.test.js`（追加）: BW-11-types（6枠、3実装、番号、0.5秒、途中再切替、逆シーク）とBW-11-export（UI選択rings／galaxy、live/renderAt完全画素一致、音声付き180枚、復号t=3秒RMSE≤.04）を追加。G計測関数はmeasureから実worldページに注入する。
- `tests/world/measure.mjs`: G-1〜G-4の実ピクセル／実GPU測定を統合。G-1はrings／galaxyの全32帯域の最小Pearson相関≥.6、G-2は3タイプの拍前後0.1秒の平均Y変化≥25%、G-3は実offline MFSの90BPM/C/純音と180BPM/F#/倍音＋打撃の色ヒストグラム距離≥.3、G-4は各タイプ1080p GPU p95≤16ms・120標本以上・disjointなし。GLエラーとsoftware GPUを合格扱いしない。既存W/BWはg-fluidへ適用して閾値を維持（BW-7-performance≤14msも保持）。W-3の旧SDF併描と全タイプへの26万粒／同一被覆の強制をobsoleteとして報告し、新形態をG基準へ置換。

### 検証
- 最終全単体テスト結果: `node tests/run.mjs --unit`: 173件／172成功／0失敗／1スキップ（想定U15-00）、86,094ms、終了コード0。実行ログはignoredの`tests/output/world11-unit-suite.txt`。
- 最終全`.js`／`.mjs`の`node --check`: 122件／122成功／0失敗。`git diff --check`: 成功。
- UW-39: 64光線、32軌道、最大65,536粒、MFS→uniform遅延0フレーム、fade=.5秒、非選択fluid更新0、切替・再演時のGPU資源増加0（GL命令モック）。
- UW-40: 90／180BPM→速度.75／1.5、重心800／6400Hz、onset密度0／4回/秒、detail=.2875／.8、particleAmount=.248／.7973333333。UW-41: Pearson=1／-1、無変化=0、赤対青の色ヒストグラム距離1、同一像0、黒の重み0。
- UW-42: 選択g-galaxyで30fps・180枚、開始fadeなし（encoder／GPUモック、実muxer/demuxer）。UW-43: 2タイプ、固定30step、live／renderAt／逆シーク後の帯域状態差0、拍状態差0。
- 先行全単体検査は173件／169成功／3失敗／想定skip1。BPMをsimulation dtへ掛けた実装不具合（UW-11）を直し、固定dtを保持して速度uniformへ移した。UW-12／16の旧固定色制約は§2.8で明示的に置き換えた。次の全件実行は173件／172成功／0失敗／想定skip1（28,265ms）。最終実行は上記を参照。
- Chrome禁止に従いブラウザは起動していない。新規BW-11-types／exportとG-1〜G-4、既存W/BW全件、file:// console、実GLSLコンパイル、実符号化・実画像・実GPU p95は未実行／未測定。GPU／輝度／相関／実合成音パレットの合格は主張しない。ゴールデンは再生成していない。

### spec.md 変更
- `doc/spec.md`をv2.18（2026-10-04）に更新し、§1.1に3タイプ・番号・切替・選択タイプexport・曲固有の違いを記載。設計と基準は構想§2.8への参照。`README.md`の試作説明も更新。本体index.htmlへの統合は行っていない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断／逸脱: §2.8に描画係数の固定表はないため、上記の形態・発光・残光・粒子数を初回実装として設定。測定失敗に合わせた係数／基準の調整はしていない。番号1〜6は6行の構想表の順を使用し、今回未実装の3タイプを無効枠にした。停止中の切替は描画だけで進行し、書き出しは選択タイプを曲頭から再演する。
- 曲固有値の集計: クロマはsongmapのworldChromaを優先、なければMFSを総和。RMS>.0001のフレームで平均重心を求め、onsetフラグのあるフレーム数/曲長を密度とする。彩度の高い主色に180度の補色、次点クロマのアクセント（無ければ120度）を選ぶ。特徴量がない旧previewはdetail／amount=1。MFS packedオフセットは既存104-float契約のまま。
- G測定の細部（構想§1.3の裁量）: G-1は固定扇形／固定楕円環で8秒・120標本、全帯域の最小値を合格判定。G-2は一定帯域／一定ラウドネスを使い6枚ずつ算術平均。G-3は4×4平均像の24色相binを輝度重みで正規化し、総変動距離を使う（黒背景の共通面積を色差と混同しない）。G-4は2秒ウォームアップ後の全帯域強入力、GPUとCPUを別集計し実GPU・timer・標本数を要求。閾値は変更していない。
- レビュアー確認: `node tests/run.mjs --browser --headed --filter 'BW-11'`で操作・GLSL・選択タイプexport・復号像・音声を検査し、`node tests/world/measure.mjs`をmacOS実GPU／headedで実行して全G/W/BW基準を確認すること。波形の異なる実曲で64光線／32軌道の即応、拍の全画面の明暗・拡大、曲ごとの色・速さ・粒子量、再切替の継ぎ目、停止中の選択、シーク、ループ、exportを目視すること。既存W-2／W-5／BW-6-coverage／BW-7-performance等も新しいg-fluidで確認。基準に失敗したら、定数を調整せず、該当§・選択肢・推奨案を報告すること。
- 作業開始時から変更済みの`doc/20261004-concept-world-mode.md`は編集していない。全成果物はこのworktree内。Chrome起動、commit／push／PRは行っていない。未コミット差分として納品。

## 2026-10-04 — [WORLD-10] v8 の美しさの回復

### 作業内容
- 指定順の追加ルール／実装者ルール／ガイドと構想§2.7を読み、`80c0c48`（wip(WORLD): v8 overscan）とHEAD `6947257`の描画差分を確認。添付のv8 dropを目標に、主流体の鋭さと独立深度を分離した。実画面のv8同等性はChrome禁止のため未判定。
- `js/world/particles.js`: 主役262,144粒の焦点面を復元。v8の0.45〜0.8px線幅、最大8pxの速度ストリーク、70%／27%／3%の三色配分、kick時4%補給を使い、全粒子への透視拡大・前進・CoCぼけを撤去。帯域供給は既存flowの速度で開始し、少量を散らして注入。別クラスWorldDepthParticlesで遠景4,096粒＋近景12粒を解析的なquadとして描画し、周期深度1〜33、透視前進、視差、距離による減光／色の変化、近景だけの大きなぼけを追加。追加simulation targetは0。
- `js/world/gl-util.js`: v8の渦ペア間の剪断と細い渦腕（基準幅.009）を周期場に戻す。v9の太い反復筋、水平の波状注入、角度による同心円状の星雲を撤去し、密度境界の細い星雲を共有。既存の大きなゆっくりしたうねり、1〜2中心、空間／時間ループを維持。周期座標を正規化して領域の両端を同じ座標で評価する。
- `js/world/fluid.js`: 32帯域をflow方向の短いフィラメントとして粒子と同じ位置に供給。染料の追加係数を90×dtから6×dtへ減らし、帯域列の太い噴流・霞の蓄積を抑える。帯域ごとの局所輝度を読める核と既存のBW-9-spectrum測定uniformを保持。20圧力反復、1.5 overscan、速度720×405／染料1440×810を維持。
- `js/world/world-engine.js`: 不等間隔の弧／螺旋が周期的に漂う32帯域曲線へ変更し、水平一列を撤去。v8の染料合成（ink*.65＋edge*.8、mood.x）へ復元。intro／outro／breakの遠景だけに3層の星雲を合成し、dropの流体を全面の霞で覆わない。独立深度層を合成し、depthParticleCount／focusedFluidの計測項目を追加。連続カメラ、固定MFS timeline、renderAtとexportの共通経路は維持。
- `js/world/post.js`: v8→v9差分に独立した全画面motion-blurパスの追加はなかった。既存の変形履歴が霞と矩形境界を再注入し得るため、buildだけに制限（直接合成.12）。build以外ではbloom／露出にも現在の像を渡し、履歴を再注入しない。逆順smoothstepを正順の補数へ修正。breakの矩形境界の消失は実画像未確認。
- `tests/unit/world-score.test.mjs`: UW-33の「固定位置」を今回の明示指示による漂いへ置換。帯域レベル、32点、同時刻のsection境界、loop両端の厳密一致を保持。UW-37／38で独立深度層のGPU命令・資源再利用と曲線の不等間隔・分離・連続性を追加。
- `tests/browser/world10.test.js`（追加）: BW-10-focus-depthは製品vertexをtransform feedbackで読み、焦点面の位置／サイズ不変、深度の透視前進／視差／近景サイズを検査。BW-10-v8-timesはt=7／45／62／90の既存W-2閾値（各帯≥10%）と輝度／clipを記録し、breakの履歴を白く汚した前後の画素差≤1を検査。数値はv8との目視比較の代用ではない。
- `js/world/world-exporter.js`、`js/world/world-app.js`、`world.html`と書き出しテストは変更していない。ゴールデンは再生成していない。

### 検証
- 最終`node tests/run.mjs --unit`: 168件／167成功／0失敗／1スキップ（想定U15-00）、56,345ms、終了コード0。先行全件実行も成功（26,756ms）。実行ログはignoredの`tests/output/world10-unit-suite.txt`。
- `node --test tests/unit/world-score.test.mjs tests/unit/world-exporter.test.mjs`: 38件／38成功／0失敗／0スキップ、930.0195ms。後続のshader／履歴整理も最終全単体テストで確認。詳細はignoredの`tests/output/world10-unit-detail.txt`。
- UW-33: 100msの最大移動0.0002768088832世界単位、32供給点、band17=.8、同時刻のsection境界位置差0、loopのパレット／供給点差0。UW-38: 最小帯域間隔0.02120355394、最小縦方向広がり0.20180929825、1/4ループ時の最大漂い0.06860622498、loop位置誤差<1e-7。
- UW-37: 主役262,144粒、深度4,108粒（近景12）、追加simulation target=0、再上演時のGPU資源増加0。UW-30: 28,800camera／115,200四隅、最小domain UV余白0.127711641、追加zoom比1。
- UW-32: live／renderAt uniform差0、30fps固定6ステップ／MFS7枚。UW-34／35／36: MP4 180枚、frame90=3,000,000μs、1920×1080、音声PCM12チャンク、AAC非対応で音声入りWebM 360枚、13枚で中止しblob=null／資源解放。WebCodecs／GPUは単体テストのモックであり、実符号化・GLSLの証明ではない。
- 全`.js`／`.mjs`の`node --check`: 117件／117成功／0失敗。`git diff --check`: 成功。描画経路へ新しい配列／オブジェクト生成、Math.random／直接時刻取得、外部依存やbuild工程を追加していない。
- Chrome禁止のためブラウザテストは一切未実行。新規BW-10-focus-depth／BW-10-v8-times、既存BW-9-spectrum／depth-loop／exportとW/BW全件、file:// console、実GLSLコンパイル、実画像、1080p GPU p95≤14msは未測定／未確認。

### spec.md 変更
- `doc/spec.md`をv2.17（2026-10-04）へ更新し、帯域曲線・鋭い主流体・独立深度・星雲とbreakの境界の要件を§1.1へ記載。`README.md`のWORLD試作説明を更新。本体index.htmlは変更していない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断／逸脱: WORLD-10の漂う帯域曲線の明示指示を、旧構想§2.7(4)／UW-33の固定位置より優先。BW-9-spectrum自体の測定方法／閾値は変更していない。WORLD-10に固定の描画係数表はなく、v8の係数を復元し、新規層は上記の粒子数／深度／供給量で実装した。測定失敗に合わせた係数の再調整は行っていない。
- 主粒子の既存state.z=1〜9とxyの保存形式は計測互換のため保持するが、描画時に投影を相殺し焦点面の材質属性として扱う。実際の奥行きは独立深度層が担当する。既存BW-9-depth-loopの主state分布に加え、BW-10-focus-depthで実深度層を確認すること。
- 一時編集スクリプト2個を誤ってworktree外の`/tmp`に作成した（作業範囲の指示違反）。スクリプトは削除済み。成果物はこのworktree内にあり、他のworktree／メインcheckout／gitメタデータは変更していない。
- レビュアー確認: `node tests/run.mjs --browser --headed --filter 'BW-9|BW-10'`で実MFSの32帯域輝度順位、実export一致、loop、GLSL／TF、焦点面／視差／break履歴汚染を確認すること。`node tests/world/measure.mjs`をmacOS実GPU／headedで実行し、1080p GPU p95≤14msと既存W/BWの全閾値を確認すること。v8（80c0c48、添付t45／90）と同じ曲・seed・時刻で、鋭いマーブル、櫛／平行噴流／水面の波紋の撤去、t62の上下矩形境界、星塵の前進と広大さ、introの細部を目視比較すること。未測定の閾値に失敗した場合は、係数を調整せず箇所・選択肢・推奨案を報告すること。
- Chrome起動、commit／push／PR作成は行っていない。未コミット差分として納品。

## 2026-10-04 — [WORLD-9] 書き出し・連続性・うねり・周波数

### 作業内容
- オーナー／アーキテクトの選択肢1承認を受けて再開し、最新構想§2.7の項目1〜6を実装。以下の以前の停止記録は経緯として保持する。開始時から変更済みの`doc/20261004-concept-world-mode.md`には手を加えていない。
- `world.html`、`js/world/world-app.js`: 常設UIに30／60 FPS、EXPORT／書き出し、進捗、中止、完了／失敗表示を追加。読込時にオフラインMFSを準備し、同じFPSの再生・シーク・renderAt・書き出しがその特徴量列を共有。再生のループ時はGPU初期状態へ戻し、直前のoutroからintroの霧へ接続する。
- `js/world/world-exporter.js`（追加）: `OfflineExporter`を継承して既存`_captureFramesWorklet`（MFS offline mode）、音声エンコード、品質定数を再利用。48kHzでデコードし、映像・音声の両コーデックが対応するMP4（H.264＋AAC）を優先、非対応時はWebM（VP9／VP8＋Opus）。1920×1080で整数フレームごとに固定dt=1/fps、WebCodecsで符号化して既存muxerで音声と多重化。終端MFSフレームは動画枚数に含めず、6秒30fpsは[0,6)の180枚。キュー制限、中止／失敗時のencoder・VideoFrame・GPU資源解放、音声失敗時の拒否を実装。
- `js/world/score.js`、`js/world/world-engine.js`: 小節ごとのカメラカットとkickごとの渦移動を廃止し、渦を1〜2個に限定。曲全体の連続カメラ、セクションの構図／色／中心力／霧のモーフ、outroからintroへの収束を追加。ライブのrAF時刻は固定ステップへ量子化し、renderAtは同じ特徴量と順序で0から再演。端数時刻でMFSイベントを再発火しない。音声なしの従来renderAtも保持。
- `js/world/gl-util.js`、`js/world/fluid.js`: 大きな周期場と渦を共有し、整数周期の時間ループ、周期空間座標、流体textureのREPEATと端の差分／移流の折返しを追加。遅い場の周期数は曲長に対する整数として編成し、通常は約24秒周期（短い曲は1周期）。旧UBO先頭の配置を保ち244 floatsへ拡張。32固定噴出点は弧／線／螺旋をセクションでモーフし、平滑化済みレベルに比例した小quadの染料注入と発光を追加。全画素で32帯域を探索しない。
- `js/world/particles.js`: 262,144粒子を維持し、zを持つ3D位置、透視投影、近景の大きさ／速さ／被写界深度、奥行きの折返しfade、帯域別の粒子供給を実装。低域は大きな膨張・流れ、中域は筋幅／流量、高域はきらめき。dropでは約0.5秒で空間が広がり、粒子が奥へ散る。introの横に伸びた波状の帯を撤去。
- `js/world/world-engine.js`、`js/world/post.js`: 深い星雲の3視差層、遠景の大気遠近、遠方光源からの細い光の筋をHDR合成。outroでは流体・粒子・履歴を減らし解析的な曲頭の霧に戻す。色役割の瞬時切替をやめ、CPU側の連続パレットを使う。
- `tests/unit/world-score.test.mjs`: 旧設計を固定したUW-06／09／11／14／18／24／25／29／30を最新仕様へ更新（中心力／色の境界モーフ、カット・大きな周回・黒い終端・4渦・2Dだけの投影を撤回）。テストIDは保持し、UW-32／33で固定MFS timelineの再現性と32噴出点・ループ収束を追加。無関係の閾値、20回の圧力反復、粒子数、性能予算は維持。
- `tests/unit/world-exporter.test.mjs`（追加）: UW-34〜36で既存muxer／demuxerとWebCodecsモックを使い、180／360枚、音声付き容器選択、時刻、中止と音声失敗時の解放を検証。
- `tests/browser/world.test.js`: BW-2-previewとW-4を共有オフラインMFS／固定ステップの検査へ変更。BW-5-paletteの旧瞬時役割交換を連続パレットの検査へ変更し、既存1e-5閾値は維持。GPU p95≤14msのBW-7-performanceを保持。
- `tests/browser/world9.test.js`（追加）: 実ブラウザ用BW-9-export（6秒30fps／180枚／音声／liveとrenderAtの完全画素一致／t=3秒の復号像RMSE≤.04）、BW-9-spectrum（32メル中心の合成サイン掃引を実offline MFSへ入力し対応噴出点近傍の輝度が最大）、BW-9-depth-loop（zと3層、ループ両端の画素差≤1、カメラ連続性、実GLSLの空間／時間折返し誤差<1e-4）を追加。

### 検証
- 最終`node tests/run.mjs --unit`: 166件／165成功／0失敗／1スキップ（想定U15-00異常系）、100,776ms、終了コード0。直前の全件実行も同じ件数で成功（140,949ms）。最後のUI進捗表示整理・中域流量・終端bloomの収束は`node --check`とWORLDの36件で再確認。
- `node --test tests/unit/world-score.test.mjs tests/unit/world-exporter.test.mjs`: 36件／36成功／0失敗／0スキップ、最終3,720.229375ms。新規フレーム数検査は実muxer／demuxerを使うが、WebCodecsとGPU自体はモックであり実ブラウザの証明ではない。
- UW-34: MP4 180枚、frame90=3,000,000μs、1920×1080、音声PCM入力12チャンク、encoder解放2、engine解放1。UW-35: AAC非対応時に音声入りWebM、60fps 360枚。UW-36: 13枚で中止、blob=null、全資源解放、音声エラー拒否。
- UW-18: 69境界／小節頭、方向の最大差0.0000037024、カット0。UW-25: lens最大差0.0000131130、ループ両端差<1e-6。UW-24: 渦数2／1、kick時の中心移動0、uniform反応遅延0フレーム。
- UW-30: 28,800camera／115,200四隅、最小domain UV余白0.127711641、追加zoom比1.000000000。UW-32: 30fps 6固定ステップ、live／renderAtのuniform差0、MFSフレーム7。UW-33: 32噴出点、セクション境界の位置差0、ループのパレット／噴出点差0。
- 全`.js`／`.mjs`の`node --check`: 116件／116成功／0失敗。後続変更の該当JSも再検査して成功。`git diff --check`: 成功。
- Chrome禁止に従いブラウザ未実行。BW-9-export／spectrum／depth-loop、既存W/BW全件、file://のconsole／GLSLコンパイルは未確認。実圧縮RMSE、32帯域の実輝度順位、ループの実画素差、1080p GPU p95≤14msは未測定。ゴールデン／PNG／実GPUレポートは再生成していない。

### spec.md 変更
- `doc/spec.md`をv2.16（2026-10-04）へ更新し、独立試作のUI、音声入り書き出し、同FPSでの再現性、連続した帯域／奥行き表現を記載。`README.md`にも操作と対応ブラウザAPIを追加。本体index.htmlは変更していない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断／逸脱: アーキテクト承認に従い旧設計のテストのみを更新。削除／スキップや性能閾値緩和は行わない。描画係数の固定表がない§2.7の表現は、約24秒の整数周期、最大4秒（短いsectionは1/4長）のsmoothstepモーフ、3視差層、深度1〜9、圧縮比較RMSE .04という実装判断を採用し、合格のための測定後の係数調整は行っていない。FPS既定60を維持し、同一FPS内の再現性を保証する経路を使う（30fpsと60fpsの状態一致を主張しない）。
- WORLDではMFSを必須とし、共有worklet特徴量列を曲読込時に保持する。従来ScriptProcessorへはフォールバックせず、音声エンコーダーが使えない場合は無音動画を作らず理由を表示する。通常の非ループ再生終了時の黒画面／再開UIは従来どおり。
- レビュアー確認: `node tests/run.mjs --browser --filter BW-9`（必要に応じて各ID別）で実WebCodecs・MFS・GLSL・音声・画素を検証し、`node tests/world/measure.mjs`をmacOS実GPU／headedで実行して1080p GPU p95≤14msと既存W/BW閾値を確認すること。EXPORTの保存／中止、30／60fps切替、前後シーク、全画面、実曲のloop、星雲の奥行き、水平な水面に見えないこと、音域ごとの光る筋、第二dropの広大さを目視確認すること。
- Chrome起動、commit／push／PR作成は行っていない。全変更をこのworktree内の未コミット差分として残す。

## 2026-10-04 — [WORLD-9] 書き出し・連続性・うねり・周波数

### 作業内容
- 指定順でCODEX_ADDENDUM、IMPLEMENTER_RULES、実装者ガイドを読み、構想§2.7と既存WORLD実装・受け入れテストを照合。
- 新要件と既存テスト保持の矛盾を検出したため、ユーザー指定の停止条件とガイド§6に従って機能実装を停止。変更はこの記録のみ。開始時から変更済みの`doc/20261004-concept-world-mode.md`は編集していない。
- 該当箇所: 構想§2.7(2)はハードカット禁止、§2.7(3)は渦1〜2個。`tests/unit/world-score.test.mjs`のUW-18（353行以降）は小節頭のcut通番増加・3D方向の瞬時30度以上変化・履歴リセットを要求。UW-25（506行以降）は実描画2D回転の瞬時30度以上変化を要求。UW-24（502行）は渦数`[2, 2, 4, 4]`を要求する。これらを維持して全件成功する条件と新要件は両立しない。
- 選択肢A（推奨）: §2.7で廃止された旧振る舞いのテストに限り更新を明示承認し、UW-18／24／25を連続カメラ・1〜2渦の検査へ置換する。無関係の既存テストと性能閾値は保持する。オーナー評価の改善を実現できる。
- 選択肢B: 全既存テストの旧意味を保持し、§2.7のハードカット禁止・1〜2渦を撤回する。回帰互換は保てるが、今回の改善要求を満たさない。

### 検証
- `node tests/run.mjs --unit`: 161件／160成功／0失敗／1スキップ（想定U15-00異常系）、70,921ms、終了コード0。既存WORLDのUW-01〜31も全件成功。これは変更前の実装の基準確認であり、WORLD-9の合格を示すものではない。
- 全`.js`／`.mjs`の`node --check`: 113件／113成功／0失敗、終了コード0。
- `git diff --check`: 成功、終了コード0。
- 追加ブラウザテスト: なし（矛盾の解消前に機能や新受け入れ条件を推測して書かない）。Chrome禁止に従いブラウザ検証未実行。6秒30fps書き出し180フレーム・t=3秒の画素比較・BW-9-spectrum・1080p GPU p95≤14msは未実装／未測定。

### spec.md 変更
- なし。製品の振る舞いは変更していない。READMEも変更なし。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断／逸脱: 定数調整、閾値緩和、旧テスト削除／スキップ、機能実装は行っていない。矛盾時に停止する明示指示を適用した。
- レビュアー確認: 選択肢Aの旧テスト更新を許可するか決定し、WORLD-9の受け入れ条件を整合させること。その後の実装で、既存UI／renderAt／非該当テストと追加export／spectrum／連続性テストを検証する必要がある。
- Chrome起動、commit／push／PR作成は行っていない。未コミットのログ変更として残す。

## 2026-10-04 — [WORLD-8] 計算領域のオーバースキャン

### 作業内容
- `js/world/gl-util.js`: `OVERSCAN = 1.5`をJS/GLSLで共有し、worldUv／worldDomainPosition／worldExtentを計算領域用に拡張。粒子表示用worldScreenUvは画面の世界単位を維持。UBO108 floatsを保持。
- `js/world/fluid.js`: 速度・圧力・curl・divergence・baseを画面1/4×1.5、染料を画面1/2×1.5へ拡張。全領域の世界座標で既存force／filamentを評価し、セル/秒換算も領域サイズに合わせる。渦・衝撃・粘性・圧力反復・染料係数は保持。
- `js/world/particles.js`: 構図別spawnの領域寸法を1.5倍に拡張し、領域外の生成点はdomain内へ折り返す。respawn境界と流体速度の世界単位換算をdomainへ合わせる。表示のUVは画面用へ分離。262,144粒子、kick再供給4%、既存force、色、ストリークの寸法と強度を保持。
- `js/world/world-engine.js`: 回転矩形の半径から必要最小zoomを解析的に計算。パンを制限し、中心でも収まらない回転は24回の二分探索で減らす。既存30度cutの条件を残す最小回転の分だけ追加zoomを許容。染料合成の微小flow変位をdomain UVへ換算し、soft fadeを安全網として保持。metricsにoverscan／domainMargin／dye寸法を追加。
- `js/world/post.js`: feedback用の速度サンプルを同じカメラ／domain UVへ合わせる。dropのhistory weight、bloom、palette、露出、ACES、仕上げ係数は変更なし。
- `tests/browser/world.test.js`: BW-8-edgesを追加。各section中央と7／20／30.3／45／62／90／112秒で外側4%と隣接内側4%のsRGB平均Yを比較し、inner>.01ならouter≥.6×inner、カメラ四隅のdomain UV余白≥.03を検査。四辺の平均も診断値として出力する。
- `tests/world/measure.mjs`: BW-8-edgesを結果出力／終了コード判定へ追加。既存BW-7-performanceの1080p GPU p95≤14msを保持。
- `tests/unit/world-score.test.mjs`: 指定の新target寸法へ既存UW-06／21／25の期待値を更新。UW-29〜31で全流体targetとresize、全60Hzカメラの四隅、band計測の合成入力と閾値を検証。

### 検証
- `node tests/run.mjs --unit`: 161件／160成功／0失敗／1スキップ（想定U15-00異常系）、27,935ms、終了コード0。
- `node --test tests/unit/world-score.test.mjs`: 最終31件／31成功／0失敗／0スキップ、598.560125ms、終了コード0。初回はUW-21に旧1280×720時の速度幅320の期待値が残って失敗（実際480）。チケット指定の1.5倍に期待値を更新して再実行。計画の係数や閾値の調整はしていない。
- UW-29: 1080p速度／圧力720×405、染料1440×810、計算target面積2.25倍。1:1と奇数サイズのresizeも成功。画面・scene・feedback解像度は維持。
- UW-30: 16:9／1:1、120秒の全60Hz時刻×両cut方向、28,800camera／115,200四隅。最小domain UV余白0.035000641、最大zoom比1.034521917（追加3.4522%）、安全な19,082cameraは元の4uniformと完全一致。UW-25: 30cut、最小30.2188度（既存≥30度を保持）。
- UW-31: 合成outer/inner=.6で成功、.59と黒い端で失敗、inner≤.01は除外。100×100画像のouter1,536画素／inner1,408画素、四隅は一度だけ集計。
- 全`.js`／`.mjs`の`node --check`: 113件／113成功／0失敗、終了コード0。`git diff --check`: 成功。
- Chrome禁止に従いBW-8-edges、既存W/BW全件、file://のconsole／GLSL実コンパイルは未実行。実フレームの帯輝度比、GPU p95、v7 dropとの見た目一致は未測定。既存PNG／world report／goldenは再生成していない。

### spec.md 変更
- なし。WORLDの実装・専用テスト・logに限定し、共有`doc/spec.md`／`README.md`、本体`index.html`、構想SSOTは編集していない。必要な共有文書への反映はレビュアー側で扱うこと。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: 余白は既存soft fadeの幅と同じdomain UV3.5%とし、要求の3%以上を確保。Float32丸めへの余裕として世界座標の半幅から1e-6を引く。必要zoomは `max(hx/(bx-abs(panX)), hy/(by-abs(panY)))`。中心でも元zoomに収まらない角度だけ減らし、旧UW-25の30度cutに必要な最小回転を既存基底回転と±.55radから導出した。
- 判断: spawnの寸法・respawn境界を拡張する変更だけを粒子生成に適用。モチーフ選択、渦中心生成、kickの交互更新、force／palette／色／描画係数は変更していない。ただし拡張した領域への粒子配分と必要なcamera clampは画素結果に影響するため、dropの見た目保持は実GPUでの比較が必要。
- 判断: bandは各軸を画像寸法で正規化した画素中心の最短端距離を使い、0〜4%と4〜8%を比較。合否は全周帯、四辺個別は診断値。従来のsRGB Y定義を使用し、閾値はチケット指定のまま。
- 染料は指定の0.5×を維持。GPU実測が禁止されているため、性能超過を仮定した0.4×への削減は行っていない。
- レビュアー確認: 実GPU・headed Chromeで`node tests/world/measure.mjs`を実行し、BW-8-edges全フレーム、1080p GPU p95≤14ms、GLSL／console／GL error 0、既存W/BWを確認。とくに7／20／30.3秒の左右／斜めの硬い境界消失、45／90秒のv7 dropのpalette／motion／composition／主役感を比較すること。性能超過時はユーザー指定の染料0.4×案を評価し、変更と測定値を報告すること。計画基準の失敗は定数を調整せず、該当節・選択肢・推奨案を報告すること。
- 未コミット変更として納品。Chrome起動、commit／push／PR作成は行っていない。

## 2026-10-04 — [WORLD-7] 構図と動き

### 作業内容
- `js/world/score.js`: kind別の初回構図をhorizon／arms／vortices／ribbons／streamsへ分離。kind/label再登場ごとに5構図を循環し、5回後に構図が戻ってもcamera方向・角度を変える。既存formId・paletteRotation・variation・三色・強度の契約を保持。
- `js/world/gl-util.js`: 共通の世界座標／2D camera変換、2〜4中心の逆回転渦、ペア間の流線、斜めリボン・横断流・層状帯・画面外へ伸びる螺旋の流れと細い染料注入曲線を追加。UBOを80→108 floatsへ拡張（lens=80、composition=84、vortices=88、shot=104）。既存noise3は変更していない。
- `js/world/world-engine.js`: 染料の合成を粒子と同じpan／zoom／rotationに追従。smoothstepで移動を加減速し、dropの小節頭で切り返す。seedとkick通番の整数hashで三分割位置付近に新渦ペア／shockを生成し、第二dropは4中心を交互に更新。旧3D camera／shock診断uniformは互換のため保持。previewは解析済み拍格子からkickを生成し、ライブはMFSの低域onsetを使用。metricsにcomposition／camera2D／kickCountを追加。
- `js/world/fluid.js`: 中央固定の力・円形注入を構図の速度場／細い曲線／移動kick中心へ置換。速度場480×270、染料960×540、速度格子単位の移流、粘性4反復・圧力20反復、noiseで切れる薄い注入、境界dye burst×14を維持。outroの横断流はゆっくり散逸させる。
- `js/world/particles.js`: 構図に沿う全画面生成、継続する渦・ペア間の加速した流れ、移動中心の薄いshock、kickごとの4%再供給を追加。粒子262,144個、全件描画、alphaの`.06+.10*s.z`、1080pのpoint size上限8pxを保持。速度方向も2D cameraで回転する。introは8〜12%の鋭い粒子と細い霧、outroは再供給を止めてゆっくり消える。
- `js/world/post.js`: introだけ露出gain上限を24へ上げ、薄いHDR霧が黒に潰れることを防ぐ。drop history weight=0／他kind=.3、soft feedback edge、既存bloom／ACES／三色の役割交換は保持。
- `tests/browser/world.test.js`・`tests/world/measure.mjs`: 指定されたBW-3-coverage／BW-4-sparks／BW-4-accentのlegacy判定を撤回し、BW-6-coverage（平均5〜25%）を唯一の被覆合否基準として保持。BW-5-lightはtrailPixels必須を撤回して直接kickのHDR増光を検査。W-1〜W-8は閾値も含め保持。BW-7-composition／camera／motion／intro／performanceを追加。outroの112秒PNG参照を追加。
- `tests/unit/world-score.test.mjs`: UW-23〜28で72セクションの構図変奏、seed再現・新渦ペアの交互更新、実2Dカメラの全downbeat cut、画素差／3×3占有の合成入力、preview拍kickとライブ空MFSの分離、GLSL std140配置とJS UBOの一致を検証。

### 検証
- `node tests/run.mjs --unit`: 最終158件／157成功／0失敗／1スキップ（想定U15-00異常系）、93,077ms、終了コード0。初回も157件／156成功／0失敗／1スキップ、92,746ms。手動確認で新shot uniformの配置ずれを修正し、UW-28のstd140整合テストを追加してから全件を再検証した。
- `node --test tests/unit/world-score.test.mjs`: 最終UW-01〜28の28件成功／0失敗／0スキップ、2,239.938292ms、終了コード0。
- UW-23: 72セクション、5構図、隣接再登場66件の構図差、5回後の同構図でもcamera差あり。UW-24: 48新渦ペア、中心数2／4、最小kick中心移動0.040199世界単位、ペア距離0.22、反復差0、mockイベント遅延0フレーム。
- UW-25: 2D camera 30cut、最小切り返し63.0250°、UBO108 floats、速度480×270／染料960×540／粒子262,144。UW-26: 合成motion差1/9、合成占有3/9。UW-27: drop最初の1秒のpreview kick 3回、反復差0、ライブ空MFSでは境界1回のみ。UW-28: shader/JS配置一致、lens offset80／vortex offset88／shock offset104、packed kick通番1。
- 既存UW: 120秒7,200固定ステップ、最大simulation dt=0.016666668、全境界6/6、mock MFS→uniform遅延0フレーム、96曲の三色、旧診断camera 30cutの最小角66.0781°、第二drop scale1.75／intensity1.35を保持。
- 全`.js`／`.mjs`の最終`node --check`: 113ファイル／113成功／0失敗、終了コード0。`git diff --check`: 成功。
- Chrome禁止に従い、追加BW-7全件、書き換えたBW-5-light、既存W-1〜8／BWは未実行。GLSL実コンパイル、file://コンソール、実画質、3帯エネルギー、intro平均輝度、実被覆、GPU p95は未測定。ユーザー提示のv6 GPU p95=10.6ms／粒子被覆16.6%は変更前の参考値で、v7の合格値ではない。

### spec.md 変更
- なし。チケットのworld実装・worldテスト・logに限定し、共有`doc/spec.md`／`README.md`、`index.html`、構想SSOT、ゴールデンは編集していない。製品仕様／READMEへの反映はレビュアー側で行う必要がある。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: 今回の明示的「構図と動きを設計し、決めて記録」に従い、構想§2.6とチケットを旧中央配置／旧建築テストより優先。計画の既存数値・擬似コードの失敗に合わせて閾値を調整していない。新しい画質係数は初期設計として選択し、ブラウザでの受入結果に基づく調整はしていない。
- 判断: カメラは共通2D世界の表示変換。3Dの遮蔽／レイマーチは追加しない。kind別初回構図を[3,4,0,1,2,4]として変奏ごとに循環。panは三次smoothstep、drop切り返しは±.55rad、zoomは通常1.08・build1.05→1.50・再dropは+.16。渦中心は三分割座標±aspect/6、±1/6付近にseeded jitter、ペア距離.22、orbit半径.055、downbeat時に65%寄せて重なるコアを作る。dropの目標流速倍率1.6、intro .12、break .18、outro .08。追加FBO／パス／粒子数削減はない。
- 判断: intro明るさは.32→.50、inkRate=.5、particle strength=.6、粒子可視選択8→12%、intro露出上限24（他kindは2のまま）。mean Y=.02〜.05達成は未測定であり、BW-7-introで判定する。outroは横断流を低速にし、セクション中央より前に全物質が画面外へ去ることを避ける。
- 判断: 音声なしpreviewのkickは拍格子、ライブはMFS onsetで生成。イベント列が違うので両者の画素一致は保証しない（構想§6の次段階）。同じ曲／seed／同じイベント列で渦位置と再構築は再現する。旧診断cameraのテストを残し、実描画2D cameraはUW-25／BW-7-cameraで別に検査。
- 計測細部: 被覆は従来と同じ合成前後HDR Y差>1e-4、各section中央＋参照7時刻を等重み平均。112秒追加によりv6の6参照時刻との平均値比較は標本数が異なる。最大値は合否に使用しない。構図は3×3各tileでY>.005の画素が1%以上ある領域が6個以上、構図種類4以上、再登場の画素差1%以上。cameraは恒等変換との差1%以上。motionはcameraをfeedback/bloom入力の段階から固定し、kickなし0.15秒で粒子平均速度≥.1世界単位/秒・RGB差合計>3の画素≥1%。これらの追加補助基準は目視のcinematic品質を代替しない。
- レビュアー確認: 実GPU環境で`node tests/world/measure.mjs`（必要なら既存WORLD_CHROME_WRAPPER）を実行し、GLSLコンパイル／console error 0、W-1〜8、BW-6-coverage平均5〜25%、BW-7全件、とくに1080p GPU p95≤14msを確認すること。7／20／30.3／45／62／90／112秒と各section中央で、全画面の構図差、第二dropの4中心／斜め流線、varying kick、kick間の高速渦、薄い染料フィラメント、introの平均輝度.02〜.05と実細部（W-2各帯≥10%）、outroの散逸、白飛び≤2%を画像・動画で確認すること。失敗した計画基準は係数を勝手に調整せず、該当節・選択肢・推奨案を報告すること。
- worktreeには開始時から`tests/world/output/report.json`と既存PNG群の未コミット差分があった。これらは本実装では編集／再生成していない。Chrome起動、commit／push／PR作成は行っていない。

## 2026-10-04 — [WORLD-6] 抽象・流体・粒子・光への転換

### 作業内容
- `world.html`・`js/world/world-app.js`: ファイル選択／ドロップ、再生・一時停止、シーク、全画面ボタンを常設。開始時の全画面要求・カーソル隠しを撤去。ボタンとFでページ全体を全画面にして操作UIを保持し、Spaceも維持。全画面拒否では鑑賞を止めない。シークは停止→固定60Hz再構築→音声位置／MFSリセット→元の再生状態へ復帰。
- `js/world/form.js`: 削除。大聖堂・建築トンネル・地形・フラクタル建築・全環境レイマーチ・深度／motion FBOを撤去。
- `js/world/fluid.js`: 既存Stable Fluids（粘性4反復、渦度閉じ込め、圧力20反復）と1/4解像度を保持。三色のHDR発光染料、低域onsetによる放射注入、bass swirl、dropの全方位バーストを実装。
- `js/world/particles.js`: 512²GPU位置／速度MRTと262,144全粒子の更新・描画を保持。外接面積予算による171〜232候補への間引きと建築深度遮蔽を撤去。流体速度＋三つの流れ関数の解析的curlで移流し、速度方向の加算ストリーク、速度／HDRの発光、soft falloffで描画。銀河状渦／build収束／drop放出殻／break漂流／outro散逸を切替。第二dropは広い三葉の放出分布、強い回転・初速、配色の役割交換で変奏。
- `js/world/post.js`: 半解像度HDRピンポン履歴にkind別zoom・rotation・velocity warpを適用。buildはzoom-in、dropは5分割→第二8分割の万華鏡バーストと減衰。四段mip-chain bloom、控えめな色収差、ACES、深い黒、色相保持のハイライト肩を使用。深度ボケ／建築motion bufferを撤去。履歴からGPU輝度縮約を行う。
- `js/world/score.js`・`js/world/gl-util.js`・`js/world/world-engine.js`: 抽象状態名へ移行し、kind/label変奏・三色・伏線・静寂・相転移・全境界を維持。流体＋粒子の直接HDR合成を描画ステップごとに行い、履歴も同じステップで更新。再描画／captureでは履歴を進めず、再上演／renderAtで履歴をクリア。未使用の環境GLSL、adaptive march品質調整を撤去。`renderAt`／`advancePreview`／`__world`、80-float UBOと旧カメラ／衝撃中心の診断値は維持。metricsは抽象レイヤー・formation・feedback解像度・raymarchSteps=0を公開。
- `tests/browser/world.test.js`・`tests/world/measure.mjs`: 建築優勢／shaft／表面の検査を抽象状態・直接粒子・履歴軌跡・霧の進行へ移行。旧sparks≤8%を§2.6の≤25%へ移行し、平均5〜25%のBW-6-coverageを追加。BW-6-uiで常設UI・開始時非全画面・前後シーク・ボタン/Fのページ全体要求、BW-6-layersで抽象5レイヤー／レイマーチ撤去を検査。W/BWの測定出力、PNG、ライブGPU timing、同期、白飛び≤2%、三帯各≥10%、暖色≤15%、0.4秒の直接殻消失を保持。
- `tests/unit/world-score.test.mjs`: 旧環境／間引き検査を新方針へ移行し、UW-20被覆計測、UW-21履歴ライフサイクル、UW-22任意全画面・シーク復帰を追加。

### 検証
- `node tests/run.mjs --unit`: 152件／151成功／0失敗／1スキップ（想定のU15-00異常系）、131,146ms、終了コード0。最後のUI拒否処理／縮約サイズ変更は下記のWORLD単体と個別構文検査で再確認。
- `node --test tests/unit/world-score.test.mjs`: 最終UW-01〜22の22件すべて成功、0失敗／0スキップ、2,703.548791ms、終了コード0。
- 全`.js`／`.mjs`113ファイルの`node --check`: 113成功／0失敗。最後に変更したpost/app/unitの3ファイルも再検査し終了コード0。`git diff --check`: 成功。
- mock命令監査: 粒子262,144、流体480×270、履歴960×540、圧力20反復、レイマーチ0、境界6/6、MFS→uniform遅延0フレーム。120秒7,200固定ステップ、最大simulation dt=0.016666668、逆向き／反復uniform差0、非キック時の診断中心ドリフト0。
- UW-20: 合成100画素のうち10画素=10%を計測、閾値未満の1画素と負差分を除外。これは実描画被覆の測定ではない。UW-21: simulation更新2回、再描画による更新0、reset1回、1280×720時の流体320×180／履歴640×360。UW-22: 明示全画面要求1／解除1、45秒→10秒シーク、default startの全画面要求0、全画面拒否でもpaused状態を維持。
- 第二dropのscore: scale=1.75／intensity=1.35／cameraSpeed=1.4。旧診断カメラ30cutの最小切り返し66.0781°。三色96曲、正規化RGB最小彩度0.985、補色色相差180°。これらも実画質／実GPUの測定ではない。
- 新規BW-6-coverage/ui/layers、移行したBW-2〜5、W-1〜8は未実行。Chrome禁止のためGLSL実コンパイル、file://コンソール、実粒子被覆、HDR比、三帯エネルギー、画質、GPU p95を未確認／未測定。

### spec.md 変更
- なし。指定対象のworld実装・worldテスト・logに限定し、共有`README.md`／`doc/spec.md`、`index.html`、構想SSOT、ゴールデンは編集していない。共有仕様の更新／本体統合はレビュアー側で扱う必要がある。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: ユーザー指定の§2.6を旧§2／§2.5／§3の建築・全画面強制・旧8%粒子予算より優先。抽象描画にはレイマーチを全く使わずform.jsを削除。本文に数値表のない画質係数は今回の明示的「決めて記録」に従って選択し、GPU／画質の未実行結果での調整はしていない。粒子数、Stable Fluids反復数、W-1〜8の閾値は保持。
- 判断: 粒子位置は画面のアスペクト比に合う2D場＋奥行き重み。具体物カメラによる遮蔽は使用しない。curl noiseは三周波数の滑らかな流れ関数の解析的curlで、divergence-freeな揺らぎを加える。粒子point sizeは1080pで1.5〜8px、幅0.45〜0.8px、個別加算alphaは0.008〜0.020にkind／速度／音反応を掛ける。低解像度でpoint size下限を1.5pxとする。新しい値は実GPU被覆の達成を保証するものではない。
- 判断: 履歴は960×540、染料は480×270、最終描画は1920×1080。履歴のsource注入はsimulation dtに比例し、静寂で両履歴への残光を消す。dropの直接衝撃殻は0.4秒で失効するが、履歴には芸術的な余韻が残る。ライブのdtは既存のrAF入力／clampを保持し、ライブと固定dt書き出しの一致は構想§6の次段階に残す。
- 計測細部: 直接粒子の合成前後HDR輝度差>1e-4を可視被覆と定義し、半精度の暗部丸めだけを除外。ブルーム／履歴の広がりは含めない。section中央＋従来6参照時刻の全標本を等重みで平均し、5〜25%を検査。各drop標本≤25%も維持。建築が主役という旧BW-3-hero判定を粒子の可視寄与へ変更。BW-6-uiのfullscreen APIは要求対象をmockし、実全画面の見え方は手動検査対象。
- 制限: シークは状態を近似せず曲頭から再構築するため、長い曲の後半へ移動すると待ち時間が生じる。開始時のボタン／Fのみ全画面を要求し、拒否は鑑賞を停止しない。
- レビュアー確認: M4 Max実GPUのheaded Chromeで`node tests/world/measure.mjs`（必要なら既存`WORLD_CHROME_WRAPPER`）を実行しreport.json／PNGを確認。1080p GPU p95≤16ms（十分なtimer標本）、直接粒子平均被覆5〜25%、W-1〜8、GLSL／GLエラー0、コンソール0、実曲MFS同期を判定すること。7／20／30.3／45／62／90秒の抽象の主役感、流体の発光と渦、収束→爆発、第一／第二dropの構図・規模・配色・万華鏡差、深い黒・白飛び・ディテールを目視で審査。常設操作、F／ボタン／Esc、全画面中も操作可能、Space、再生中／停止中の前後シーク、曲末／再上演、file選択とドロップも確認。
- 既存`tests/world/output/`のreport.json／PNGはv5由来で、今回再生成していない。v6の合格証拠として扱わない。
- 未コミットの変更として納品。コミット・push・PR作成・Chrome起動は行っていない。

## 2026-10-04 — [WORLD-5] ワールドモード v5

### 作業内容
- `js/world/form.js`: DROP専用の暗い材質、アクセントのスポットキー、弱い冷色fill、強い距離減衰へ変更。キー光源をフラクタル空洞内に置き、同じ円錐・光源・減衰を表面と霧に使用。半解像度の既存レイマーチで距離場の4点遮蔽と位相関数を伴うin-scatteringを積分。近景の照明/継ぎ目を減衰し、中景を照らし、遠景を冷色霧へ溶かす。計測専用の`shaftStrength`（通常1、0でshaftだけ除去）を追加。
- `js/world/gl-util.js`: 第一DROPのaccentキーと第二DROPのsecondaryキーを明示し、再登場時にaccent/secondaryの照明役割を交換。ambientの冷色と曲の三色制限は維持。低域onsetの当該フレーム・経過時刻・drop境界から共通のflareを計算。
- `js/world/post.js`: DROPのbloomも共通flareに反応。既存ACES、色相を保つ肩、露出目標と白飛び判定を保持。
- `js/world/world-engine.js`: 小節頭で視線の左右を必ず切り返す。第二DROPでは既存螺旋軌道の接線に切り返しを加える。cut時のmotion履歴リセット、境界/キックで固定する世界座標のshock中心を維持。`metrics().dropKeyRole`を追加。
- `tests/browser/world.test.js`: `BW-5-light`で同視点HDRのshaft無効/有効・flare寄与とflare時白飛び率を比較。近/中/遠の深度層の画素数と平均HDR輝度を報告。`BW-5-palette`で実GLSLの色差方向交換とambient固定を検査。計測の読込を分離し、ライブはgesture不要resume→`app.start(false)`で開始。resumeの10秒上限と音声時刻の10秒停止監視を追加。既存W/BWテストを保持。
- `tests/world/measure.mjs`: `WORLD_CHROME_WRAPPER`指定時にはChrome探索・内部adapter生成を省く。静止画とライブを別CDP呼び出しにし、renderAtのvisual結果/PNGをライブより先に保存。ライブ失敗でもvisual結果を残し、AudioContext/media/MFSの診断をreport.jsonに出す。新規BW-5を終了コード判定に含める。
- `tests/unit/world-score.test.mjs`: `UW-18`で全小節頭カットの角度・motion履歴・照明役割、`UW-19`で計測開始順序と4つの失敗ケースを追加。

### 検証
- `node tests/run.mjs --unit`: 149件 / 148成功 / 0失敗 / 1スキップ（想定のU15-00異常系）、109,958ms、終了コード0。
- `node --test tests/unit/world-score.test.mjs`: UW-01〜19の19件すべて成功、2,086.675375ms、終了コード0。UW-18: 30カット、最小視線角66.0781°（CPUカメラ基底の検証）。UW-19: resume→start(false)、fullscreen=false、resume上限10,000ms、4失敗ケースをmock検証。
- 既存UW: 120秒7,200固定ステップ、境界6/6、mock MFS反応0フレーム、shock中心の非キック時ドリフト0、粒子262,144個、form960×540。第二DROPのscale1.75/intensity1.35、経路半径の第一最大0.5299/第二最小2.8763を保持。これらは実GPUの画質/同期/性能測定ではない。
- 全`.js`/`.mjs`114ファイルの`node --check`: 0失敗。個別のmeasure/browser構文チェックも成功。`git diff --check`: 成功。
- 新規BW-5-light/paletteおよび既存W-1〜8/BW-2〜4は未実行。Chrome起動禁止に従い、measure.mjsの実GPU end-to-end、GLSLコンパイル、file://コンソール、白飛び率、画質、GPU p95は未検証・未測定。

### spec.md 変更
- なし。チケット対象のworld実装・worldテスト・logに限定し、共有README.md/spec.md、index.html、SSOT、ゴールデンは編集していない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 保持: アーキテクトのMandelbox反復上限5、environment 2のhit epsilon `max(.0015*scale,travel*.0035)`、法線epsilon `max(.03*scale,travel*.004)`を変更していない。第二DROPの既存twisted-fold（倍率-1.94/inner .38/回転.36）、scale/intensity/cameraSpeedの成長も保持。
- 判断: 今回の明示的な画質指示に従ってDROP用の照明係数を選択。albedo .075/.09/.12→.018/.022/.030、fill .7→.23と.4→.13、Fresnel 3.5→.10。キーpowerは24/(1+距離二乗*.055)に円錐と遮蔽を掛ける。前景は3〜12world単位で光を抑え、遠景霧は18world単位以遠で増やす。定数表のない画質部分の実装選択として記録し、受入閾値を変更していない。
- 判断: 光の筋は別FBOを追加せず既存half-res raymarch内で積分。光源までの4点遮蔽は近似であり、完全な光源方向raymarch/多重散乱ではない。キー/継ぎ目/shaftの色は第一DROPで暖色、第二DROPで寒色へ交換し、第二の弱いfillへ暖色を移す。ambientは冷色のまま。全曲の変奏判定は時刻75秒のハードコードではなく既存(kind,label)契約に従う。
- 判断: キックのflareは指数減衰×既存0.4秒fadeで残し、0.4秒以降は厳密に0（既存BW-4-shellの失効検査を保持）。境界のflareは既存hit.wを使う。shock殻はworldShockFadeと固定中心を維持し、色だけキーの役割へ合わせた。
- 計測細部: 深度層の集計境界12/40world単位は診断用で、層の見え方の合否を数値で代用しない。BW-5-paletteはroleごとの彩度/明度係数を保つため中立成分を除いたRGB色差の単位方向で交換を比較（誤差<1e-5）。wrapperは既存launchChromeのautoplay-policy引数を引き継ぎ、disable-gpuを除去してheaded実GPUを起動すること。
- レビュアー確認: `WORLD_CHROME_WRAPPER=/absolute/path/to/wrapper node tests/world/measure.mjs`で全W/BWとreport.json/PNGを確認。45/90秒の暗い前景・中景hero・遠景霧、shaftの遮蔽、warm accentの面積、白飛び≤2%、kick/境界flare・薄いshock殻、小節頭cut、第二DROPの配色/fold/軌道/強度差を参照画像と比較すること。20/62秒のトンネル/大聖堂の品質保持も確認。特に追加遮蔽を含む1080p GPU p95≤16ms、3帯各≥10%、HDR比≥1000、実曲MFS同期≤1フレーム、全境界、全曲再生完了を実GPUで判定すること。
- 未コミットの変更として納品。コミット・push・PR作成・Chrome起動は行っていない。

# 開発ログ

## 2026-10-04 — [WORLD-4] ワールドモード v4

### 作業内容
- `js/world/form.js`: DROPを専用の滑らかな材質分岐へ分離。fbm法線・刻印・ランダムな屈折/集光模様を撤去し、幾何法線、key/fill照明、march歩数/距離のAO、soft shadow、Fresnel rim、初期box-fold平面の細い発光線、距離霧を使用。DROPの霧は一定密度/中点サンプルとし、空のランダムな星も出さない。INTROは一点の光だけで床/遠い門/柱を照らし、進行に応じて輪郭と光源周囲の体積の霞を出す。BUILDの形状/経路、BREAKの大聖堂の形状/窓の光を保持。大聖堂は暗いalbedo、低周波で小幅なroughness変化、広く弱いspecular、控えめな法線/反射へ変更。
- `js/world/particles.js`: 512×512=262,144のGPU状態と全粒子の更新/描画命令を保持。乱数確率による多数の点の描画を、整数置換で固定した少数の候補へ変更。最大pointSizeと2pxの境界余裕を含む外接正方形の面積和を画面8%以内へ制限。細い速度ストリークとHDR加算を維持し、候補一粒の発光を強める。キックの薄い殻の力/発光は0.4秒で消失。
- `js/world/score.js`: 曲の調性/seedから寒色二色と補色の暖色一色を選ぶ。モチーフ、形態ID、kind/label変奏、パレット回転情報は保持。
- `js/world/gl-util.js`: 回転/反転された色相uniformから寒色base/寒色fill/暖色accentの照明役割を判別する共通関数を追加。描画色の彩度を抑え、baseの明度を下げる。キック経過秒と0.4秒消失の共通関数を追加。80-float UBOと公開hookは不変。
- `js/world/fluid.js`・`js/world/world-engine.js`: 共通の三色照明を媒質にも適用。DROP合成のノイズ密度を除去。第二DROPの既存scale/intensity・twisted-fold・螺旋経路、renderAt/advancePreview/__worldとMFS応答契約を保持。
- `js/world/post.js`: 仕上げのフィルムグレインを撤去。HDR、4段bloom、ACES、露出と白飛びの肩を保持。
- `tests/unit/world-score.test.mjs`: UW-01〜14を保持し、UW-14の予算確認だけ18%から8%へ厳格化。UW-15（間引きの一意性/解像度別面積上限）、UW-16（96曲の設計された三色の色相関係）、UW-17（暖色面積計測）を追加。
- `tests/browser/world.test.js`・`tests/world/measure.mjs`: 既存W-1〜8/BW-2/BW-3とその閾値を保持。BW-4-sparks（各標本で粒子実被覆≤8%）、BW-4-accent（仕上げ後の暖色優勢面積≤15%）、BW-4-shell（固定視点/時刻で殻の0.4秒以降HDR差0）、BW-4-intro（点光源付近を除いた表面の進行による増光）を追加。従来の6参照時刻PNGと実再生GPU性能検査を維持。

### 検証
- `node tests/run.mjs --unit`: 最終147件 / 146成功 / 0失敗 / 1スキップ（想定のU15-00異常系）、124,450ms、終了コード0。初回も146件 / 145成功 / 0失敗 / 1スキップ、116,812msで成功。
- `node --test tests/unit/world-score.test.mjs`: UW-01〜17の17件 / 17成功 / 0失敗 / 0スキップ、3,296.184ms、終了コード0。
- 全`.js`/`.mjs`114ファイルの`node --check`: 114成功 / 0失敗。最後の変更対象の構文検査と`git diff --check`も成功。
- UW-15: 整数置換の一意なrank=262,144。1080pの描画候補は第一DROP171個、第二DROP232個（遮蔽前）。16×16、640×360、1280×720、1920×1080、3840×2160で検査した外接正方形の面積和最大7.9873167438%。これは解析的上限の検査であり、実画素被覆/GPU描画の測定ではない。
- UW-16: 96曲、各曲3色、baseと暖色の色相差180度、寒色二色の差25.2度。UW-12の正規化色相の最小RGB彩度0.985も維持。実描画はworldColorで寒色の色成分68%/暖色78%と明度を調整するため、正規化色相の彩度を仕上げの彩度とは扱わない。
- UW-06/08/11/13: 粒子262,144、流体480×270、環境960×540、全境界6/6、MFS→uniform遅延0フレーム（mock）、反復/逆向きpreviewのuniform差0、120秒7,200固定ステップ、最大sim dt=0.016666668、非キック時の中心移動0。UW-17の合成暖色面積2/8=25%。
- UW-09/14: 第二DROP worldScale=1.75、intensity=1.35、cameraSpeed=1.4。正規化横経路の第一DROP最大半径0.5299、第二DROP最小半径2.8763。BUILD前進距離は初期0.993/後期5.314世界単位。
- ブラウザテストBW-4-sparks/accent/shell/introと既存W/BWを未実行。追加ルールのChrome禁止に従い、GLSL実コンパイル、file://のコンソール、実画素被覆/暖色面積、0.4秒の実GPU消失、INTRO輪郭の画質、GPU性能は未確認。

### spec.md 変更
- なし。WORLDの実装/テスト/logの範囲を守り、共有`doc/spec.md`・`README.md`、SSOT、既存`index.html`、ゴールデンは変更していない。ガイド§8.1の共有仕様書更新は今回の範囲制約により実施しない。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: WORLD-4の明示要求をv2の全面の粒子・ノイズ材質より優先。SSOTのW-1〜9、粒子数、既存変奏/形状/カメラ定数は変更せず、画質指示に数値表がない照明・材質は今回の実装選択として記録。既存テストの削除/skip/閾値緩和なし。UW-14の予算を8%へ厳格化。
- 判断: 発光線はノイズを使わない最初の二回のbox-fold平面。AOは歩数と法線方向の距離、shadowは短いSDFレイの近似。キックの殻はworld座標の固定中心、速度18世界単位/秒、0.08〜0.4秒smoothstepの消失。物理ベースの光輸送ではない。
- 判断: BUILD/BREAKの構図を保ち、三色制約は全環境へ適用。色相メタデータの従来の循環/反転はhookとモチーフ契約のため保持するが、実際の照明の役割は固定する。寒色baseの明度係数0.22、fill0.55、暖色1。暖色は発光線/光点/少数の火花へ限定し、DROPの殻と霧の照明は寒色へ変更。
- 計測細部: 粒子予算は最大サイズの外接正方形に2px余裕を入れ、固定rank候補を割り当てる保守的な面積上限。ブルーム後の広がりはこの上限に含まない。暖色面積は仕上げ後RGB最大値>16/255、R>B×1.15かつR>G×1.05の画素率と定義し、黒の量子化を除外する。BW-4-shellはカメラ/粒子/演出時刻を固定して殻の経過秒だけを変え、HDR読出しで厳密な消失を測る。BW-4-introは同視点で進行0/1を比較し、光点付近を除いたヒット表面の増光を測る。これらは目視を代替しない。
- レビュアー確認: M4 Maxのヘッド付き実GPU Chromeで`node tests/world/measure.mjs`を実行し、report.jsonと7/20/30.3/45/62/90秒のPNGを確認すること。特に滑らかで読み取れるDROP面、薄いsparkと粒子被覆≤8%、暖色面積≤15%、殻の0.4秒消失、INTROの徐々に現れる柱/門/霞、大聖堂の素材感、第二DROPの明確な拡大/別構図を画質審査すること。既存W-1〜8（各帯≥10%、白飛び≤2%、同期≤1フレーム、1080p描画p95≤16ms含む）も必須。file://、全画面、Space/Esc、曲末/再上演、実曲も確認。未測定の画質/性能を合格とは扱わない。
- コミット・push・PR・Chrome起動なし。作業開始時からの未コミット/未追跡ファイルを保持し、このworktreeの対象11ファイルだけを変更。

## 2026-10-04 — [WORLD-3] ワールドモード v3

### 作業内容
- `js/world/particles.js`: 512×512のGPU状態・全262,144粒子の更新/描画を保持。一様な箱内配置を12本の螺旋流線へ変更し、解析的渦・Stable Fluids・慣性で移流する。dropの16%をキック/境界で世界座標の衝撃環へ配置し、速度で広がる環と薄い衝撃殻の力を追加。粒子速度と前カメラから画面速度を計算し、POINTS内で回転した細い先細りストリークを描く。円形blobと遠景を大きくするぼけ加算を撤去。サイズ・輝度は深度で減衰し、外接正方形面積の期待値を画面18%以下に抑える独立hash間引きを追加。
- `js/world/form.js`: dropのMandelboxを覆う全面発光/微細ノイズ面を局所的な刻印・稜線発光へ変更。地色は暗い黒鉛とし、強い補色の局所key light、冷色rim light、AO、ソフトシャドウ、アーチ窓から斜めに差す体積光を追加。fbmの法線・roughness変化・距離でアンチエイリアスする刻印・specularを使用。近い床/柱には一回/最大10歩の反射レイを使用。introは空の方向光（左上blobの原因）を除き、一点の光の周囲へ進行に応じて門/柱/床の暗い輪郭を出す。大聖堂の床・基壇を発光スリットにする判定を撤去し、縦の柱上部だけを発光させる。トンネルの光は壁の連続した螺旋へ限定。
- `js/world/score.js`: 曲ごとの調性/seed・三色制限・モチーフ/変奏契約を保持し、黄緑を避けたcyan/blue、red/orangeの補色、violetの高彩度パレットを生成する。
- `js/world/world-engine.js`: 半解像度環境を深度重み付き4点でアップサンプル。衝撃中心をキック/境界の世界座標へ固定し、カメラ移動で引きずらない。第二dropは第一dropの直進から螺旋軌道と接線を見るカメラへ変更。GPU uniformの未使用w成分に衝撃中心/開始時刻を格納し、metricsに粒子面積予算・fold regimeを追加。renderAt/advancePreview・__world・MFS即時反応契約は保持。
- `js/world/gl-util.js`: 80-float std140 UBOのサイズと既存xyzを保持し、right/up/forward.wとaccent.wの意味をコメントに記載。
- `js/world/post.js`: 深い黒・ACES・ハイライトの肩・4段bloom・控えめなgrainを維持。第二dropの強度を自動露出で相殺しないよう、drop再登場の目標中間輝度を0.08から0.10へ増やす。
- `tests/unit/world-score.test.mjs`: UW-01〜11を保持。UW-12〜14に96種の三色パレットの飽和度/olive排除、キック中心の同フレーム更新/固定と経過秒、第二dropの螺旋経路・拡大・強度・half-res/metricsを追加。
- `tests/browser/world.test.js`・`tests/world/measure.mjs`: W-1〜W-8/BW-2の閾値を保持。BW-3-coverage（合成前後HDR差>0の被覆、標本平均≤25%かつdrop各標本≤25%）、BW-3-hero（dropの環境優勢画素≥75%・環境のHDR積分寄与≥60%）、BW-3-kick（実GPUで同フレームの画素変化・経過秒・中心固定）を追加。section中央と7/20/30.3/45/62/90秒のPNG、実再生同期・1080p timer query計測は既存手順を保持。

### 検証
- `node tests/run.mjs --unit`: 144件 / 143成功 / 0失敗 / 1スキップ（想定のU15-00異常系）、96,738ms、終了コード0。
- `node --test tests/unit/world-score.test.mjs`: UW-01〜14の14件成功、0失敗、最終2,206.105ms（末尾の小画面サイズガード/metrics限定後にも再実行）。
- GPU命令mock: 粒子262,144、圧力射影20反復、流体480×270、環境960×540、全境界6/6、MFS→uniform遅延0フレーム、texture feedbackなし。これは実GPU描画/性能検証ではない。
- UW-12: 96パレット・各曲3色、線形RGBの最小飽和度0.985。UW-13: キック→uniform遅延0フレーム、非キック時の衝撃中心の移動0、キック経過0.10000000149秒。
- UW-14: 正規化した横方向経路の標本半径は第一drop最大0.5299、第二drop最小2.8763。第二dropのworldScale=1.75、intensity=1.35、cameraSpeed=1.4。既存UW-09のbuild前進距離は初期0.993/後期5.314世界単位。
- UW-08/11: 反復/逆向きpreviewのuniform差0、120秒で7,200固定ステップ、最大sim dt=0.016666668、MFSなし、境界6/6。UW-05合成画像の帯域は低64.1307%/中16.6111%/高19.2582%（描画フレームのW-2実測ではない）。
- 全`.js`/`.mjs`114ファイルの`node --check`: 0失敗。`git diff --check`: 成功。GLSLコンパイル・実画素被覆率・輝度・白飛び・実GPU時間は未測定。
- ブラウザテスト: BW-3-coverage/hero/kickおよび既存W-1〜8/BW-2を未実行。CODEX_ADDENDUMのChrome起動禁止に従い、file://コンソール・再生/操作/再上演も今回未確認。

### spec.md 変更
- なし。指定範囲のworld実装・worldテスト・logだけを編集する指示を優先し、共有README.md/spec.md・既存index.html・SSOT・ゴールデンは保持。

### 備考
- 実装: Codex gpt-6.1-sol high
- 判断: 今回の6項目は画質を改善する明示指示として実装。SSOTの受入値/粒子数/既存変奏定数は変更していない。数値表がない材質・照明・カメラ/流線は実装選択として記録する。
- 判断: 画面の25%という要求に対し、保守的な外接正方形面積の期待値を18%へ抑える。各点の可視確率p≤0.18*幅*高さ/(262144*pointSize²)なので、重なり/遮蔽/ストリークdiscard前の面積和の期待値が18%以下。これは実際の画素被覆率の測定値や毎フレームの厳密上限ではない。ブルーム後の広がりは目視審査に残る。粒子総数は減らさない。
- 判断: 第二dropのMandelboxは倍率-1.72→-1.94、sphere-fold内半径二乗0.25→0.38、fold内回転0→0.36rad、反復セル18→24、空洞半径4.8→7へ変える。既存worldScale1.75/intensity1.35と合わせて別の構造と飛行経路にする。第三以降はtwisted-foldを維持し、既存scale/intensity/反復数で成長する。
- 判断: half-res raymarchと既存64〜112段の自動制御/preview96段を維持。反射は近い通常建築の材質だけに一回/10歩で制限し、フラクタルに再帰反射を追加しない。屈折・集光と霧の遮蔽は近似であり、物理ベースの光輸送や完全3D流体/粒子衝突ではない。
- 計測細部: BW-3-heroは粒子寄与≤max(1e-4,環境輝度*0.35)の画素率とHDR輝度積分比を使用する新規補助検査。閾値は今回の構造可視性要求の操作的解釈で、SSOTのW基準を置き換えない。BW-3-kickの合成MFSは実曲同期W-4と別に評価する。
- 自己評価（§1.2）: 光/スケール/奥行き/物理的動き/同期/全曲変化に対応する実装は追加したが、1の実在感・2の3帯エネルギー・3の奥行き・4の60fpsと説得力・5の実GPU同期/輝度比・6の飽きない映像は最終画と実再生で未判定。CPU/mockの成功を完成画の合格としない。
- 自己評価（§2.5）: 全画面環境・kind別世界・三色・暗い材質・再登場の成長を維持し、一様な雪、床の白い破線、introの左上光源を生む処理を修正した。粒子が流線/衝撃環へ見えるか、フラクタルがheroか、濁った色/水平線が消えたか、第二dropの違いは実画面の審査待ち。最終合格は未判定。
- レビュアー確認: M4 Maxのヘッド付き実GPU Chromeで`node tests/world/measure.mjs`を実行し、report.jsonのW-1〜8/BW-2/BW-3と参照6時刻のPNGを確認すること。特にGLSLコンパイル、粒子被覆≤25%、drop環境の可視性、白飛び≤2%、全sectionの3帯≥10%、1080p描画p95≤16ms、世界座標のキック環とストリーク方向、アーチの光/床と柱の反射/刻印、intro輪郭、二度目dropの構造とカメラ差を確認。実曲で曲頭から終端まで鑑賞し、file:///Space/Esc/全画面/再上演も確認すること。画質・性能の不合格が出たら計画書の節・選択肢・推奨を報告し、受入値を緩めない。
- コミット・push・PR・Chrome起動なし。作業開始時の未コミット/未追跡ファイルを保持。

## 2026-10-04 — [WORLD-2] ワールドモード v2

### 作業内容
- `js/world/score.js`: アーキテクト採用の選択肢Aを実装。kindから環境を選び、変奏は `(kind, label)` ごとに1から数える。label単位のformId・paletteRotation、境界・終端・2小節前の予兆・直前1拍の静寂・決定性・入力不変の契約は維持。パレットは曲全体で3色とし、ラベルはその割り当てを変える。
- `js/world/gl-util.js`: 共有std140 UBOを40から80 floatへ拡張。最初の40要素の意味は保持し、現／前カメラの位置と基底、アクセント色、環境パラメーターを追加。再初期化用clearTargetを追加。
- `js/world/form.js`: 中央の単体blobを撤去。半解像度の全画面レイマーチで、虚空／螺旋の光と反復リブのトンネル／box・sphere foldを持つMandelbox反復構造／柱列・基壇・アーチと採光の大聖堂／無限ノイズ高さ場を描画。深度、前カメラへの再投影、体積光、距離霧、微細ノイズの法線摂動、AO・ソフトシャドウ、局所発光・透過と集光を実装。粗い等高線模様は撤去。
- `js/world/particles.js`: 粒子位置xyzと速度xyzをそれぞれRGBA32FのGPUピンポン状態とし、MRTで更新。カメラ基底から投影・深度遮蔽し、塵・雨・稀な大きな火花をHDR加算する。境界で環境の3D領域へ再配置し、カットでは視点だけを変える。可視密度のhashとhero判定を独立させ、heroが密度フィルターで消えないようにした。
- `js/world/fluid.js`: Stable Fluidsの既存射影20反復等は保持し、決定的previewのため全状態textureを消去するresetを追加。
- `js/world/post.js`: GPU内の4×4縮約で平均対数輝度・最大輝度を取得し、自動露出を実装。ACES後のコントラスト・彩度、色相を保つハイライトの肩、控えめな4段bloom・深度ボケ・速度ブラー・色収差・grainを使用。v1の全画面flashによる白飛びを撤去。
- `js/world/world-engine.js`: kind別の前進・加速・側壁への移動・霧の中の低速飛行・地形上空飛行、小節頭でのカットとmotion履歴切替を実装。2回目dropは空間1.75倍、速度1.4倍、三色の役割の循環、密度増、Mandelbox反復6→7、側壁に近い高いカメラ視点へ変奏。媒質は環境深度に結びつけ、旧平面の雷・放射リングを撤去。非同期GPU時間に応じたmarch段数調整と白飛び率readbackを追加。
- `js/world/world-app.js`: `window.__world.renderAt(tSec)`を公開。音声を止め、毎回GPU状態を0から再初期化して固定dt=1/60で積分し、最後に描画する。逆向きの時刻も同じ手順。非整数フレーム時刻では状態を追加積分せずカメラ・演出だけ指定時刻で評価する。preview中のload/start/preview競合を拒否。start(false)はresumeとplayを同時発行し、10秒で明示的に拒否する上限を設け、resume待ちでplayが未発行になる停止を防止。
- `tests/unit/world-score.test.mjs`: 既存UW-01〜06を保持し、UW-03の変奏期待値をアーキテクトの `(kind,label)` 契約へ更新。UW-07〜11で三色制限・kindをまたぐlabel・カメラ基底/加速/cut・固定preview・startの同時発行とtimeout・120秒全曲の固定ステップを追加。
- `tests/browser/world.test.js`・`tests/world/measure.mjs`: W-1/W-2/W-5をrenderAtによる音声不要の固定previewへ移し、W-4/W-6/W-8は実再生で測定。セクション中央に加えて7/20/30.3/45/62/90秒のPNGを保存。白飛び2%以下、3D粒子の合成前後の可視HDR寄与、時間を戻したpreviewの画素差0、環境4種以上を追加検証。GL/consoleエラー・実GPU/timer・旧W閾値の検証は維持。

### 検証
- `node tests/run.mjs --unit`: 最終実行141件 / 140成功 / 0失敗 / 1スキップ（想定のU15-00異常系）、109,580ms、終了コード0。先行の全体実行も140件 / 139成功 / 0失敗 / 1スキップ、183,026ms（UW-11追加前）。
- `node --test tests/unit/world-score.test.mjs`: 最終個別実行UW-01〜11の11件すべて成功、1,108.81ms。最終のoutro距離場と再登場時の三色役割循環の変更後に再実行。6セクション・11イベント、環境5種、変奏列1,1,1,1,2,1。三色だけで配色し、同ラベル/別kindは変奏1へ戻ることを確認。
- GPU命令mock: 粒子262,144、流体480×270、圧力20反復、全境界6/6、MFS→uniform遅延0フレーム、同一textureの読み書きfeedbackなし。出力1920×1080、環境960×540、露出縮約6段で最終1×1。
- 固定previewの時刻/イベント検証: 120秒で7,200ステップ・最大sim dt=0.016666668（Float32量子化）、境界6/6、MFS参照0。0.1秒の反復/逆向き再描画で全80uniformの差0、非整数0.105秒では6固定ステップのみ。実画素の差0はブラウザ検証に残す。
- カメラ基底の長さ/直交誤差<1e-6。buildの1秒区間の前進距離は前半0.993・後半5.314世界単位。2回目dropのworldScale=1.75、cameraSpeed=1.4。start(false)のresume/play同時発行、未完了の10,000ms timeoutとready復帰をmockで検証。実ブラウザの開始確認ではない。
- W-2計測関数の合成画像: 低64.1306677% / 中16.6111166% / 高19.2582157%、Gaussian定数保存誤差<1e-14、帯域合計誤差<1e-12。これは描画画像のW-2合格を示す値ではない。
- 全`.js`/`.mjs`114ファイルの`node --check`: 0失敗。後続のform.js・score.js・world-score.test.mjs変更も個別構文チェック成功。`git diff --check`: 成功。ブラウザテスト・実GPU計測はCODEX_ADDENDUMに従い未実行。

### spec.md 変更
- なし。「チケットで列挙したファイルのみ」の明示指示を優先し、共有README.md/spec.md・既存アプリ・SSOTを編集しない。独立試作の製品定義は指定SSOT §1・§2.5を参照。

### 備考
- 実装: Codex gpt-6.1-sol high
- 前回停止した§2.5原則2の矛盾はアーキテクトの更新で解消。今回はSSOTの意図に合う合理的判断を実装して継続するという最新指示に従った。定数表の変更、既存テストの削除/スキップ、W基準の閾値緩和、ゴールデン再生成なし。
- 判断: intro=void、build=tunnel、drop=fractal、break=cathedral、main=terrain、outro=terrainの崩壊。6形態のIDはlabelモチーフとして維持し、単体形態を中央に置く構成へは戻さない。labelのpaletteRotationは3色の役割の割り当てへ適用し、同kind/labelの再登場ではその役割を循環させて色調も変える。連続した色相回転で曲の色数を増やさない。
- 判断: 環境とカメラの座標を同じ世界単位で共有し、粒子もその座標に置く。流体は§3の2D Stable Fluidsを維持し、深度と3Dノイズで媒質として合成。完全な3D流体への置換はしない。
- 判断: 自動露出の中間輝度目標0.08、ゲイン0.035〜6、grain振幅0.006（一様分布のσ最大約0.001733、指定0.015以下）。露出は毎フレームのGPU統計から直接決定し、previewを過去の露出履歴に依存させない。ライブmarch段数は32標本のGPU平均時間>14msで8段減、<10msで8段増、64〜112段。previewは常に96段。これはSSOTに数値がない実装上の選択で、実GPU合格を示す数値ではない。
- 計測細部: 旧W-2のsRGB Y・4×4平均・Gaussian半径ceil(3σ)・対称折返し・DC除去は維持。W-5はrenderAtで窓先頭まで積分後、同じ状態をadvancePreviewで固定60Hz前進させ窓内平均を取る。白飛びはRGB全チャネルが250/255以上の画素の割合。境界・同期・性能はpreviewではなく実再生で検証し、previewの時間をW-8へ混入させない。
- レビュアー確認: `node tests/world/measure.mjs`を実GPUのヘッド付きmacOS Chromeで実行し、report.json・section-*.png・t-*.pngを確認すること。GLSLの実コンパイル、W-1〜W-8、特に各セクション3帯10%以上・白飛び2%以下・M4 Max 1080p p95≤16msは未検証。参照6時刻と実曲で環境のスケール/奥行き/細部、hero粒子、二度目dropの明確な変奏、前景/中景/霧の遠景、色と露出、滑らかな動きとカットを画質審査すること。file://、ドロップ解析、start(false)、クリック全画面、Space/Esc、終端/再上演も確認すること。
- コミット・push・PR・Chrome起動なし。既存の未コミット/未追跡ファイルを保持し、このworktree内の対象ファイルだけを変更。

## 2026-10-04 — [WORLD-2] ワールドモード v2

### 作業内容
- `log.md`: 指定ルール・構想 §2.5・既存 world 実装とテストを確認し、仕様矛盾による実装停止を記録。WORLD-2 のコード・テスト・仕様書は変更していない。
- 停止箇所: `doc/20261004-concept-world-mode.md` §2.5 原則2。「世界は kind ごとに別物にする」と「同じラベルで戻るときは同じ世界にする」を、同じ label が異なる kind に現れる場合に同時に満たせない。
- 根拠: `tests/fixtures/songmap-128.json` の6セクション・3ラベル中、label A は intro（0秒〜）、break（60.005秒〜）、outro（105.003秒〜）の3 kind に登場する。`js/songmap-analysis.js` も label を類似度で付けた後に kind を独立に判定するため、fixture 特有の不正データではない。
- 選択肢A（推奨）: 環境は kind で選び、環境の再登場を `(kind, label)` で識別する。既存の label 単位の formId・paletteRotation・variation 契約は保持する。同じ label でも kind が違えば異なる環境となる旨をアーキテクトが §2.5 に明記する。
- 選択肢B: 環境を label 単位で固定し、kind は環境内の状態変化だけに使う。「kind ごとに別世界」および intro／break 等の指定を修正する必要がある。

### 検証
- `node tests/run.mjs --unit --filter 'UW-'`: UW-01〜06 の既存6テストは全成功。runner 表示は31件 / 31成功 / 0失敗 / 0スキップ / 2,194ms、終了コード0（うち25件はフィルターで一致テストのないファイルの成功表示）。WORLD-2 の受け入れ検証ではなく、既存契約の確認。
- コード変更なしのため全単体テスト・全 JS 構文チェックは今回未実施。Chrome は CODEX_ADDENDUM に従い未起動。ブラウザテストの追加・変更なし。画質、GLSLコンパイル、HDR、白飛び率、1080p性能、renderAt、start(false) は未検証・未実装。

### spec.md 変更
- なし。仕様矛盾の解消待ち。

### 備考
- 実装: Codex gpt-6.1-sol high
- 指示どおり、曖昧・矛盾した計画を推測して実装せず停止。定数調整、閾値緩和、既存テスト削除、ゴールデン再生成なし。
- レビュアー確認: §2.5 原則2で異なる kind にまたがる同一 label の扱いを確定すること。推奨は選択肢A。回答・設計更新後にWORLD-2本体の実装を再開する。
- コミット・push・PR作成なし。今回の変更はこのworktreeのlog.mdだけ。作業開始時から存在するWORLD-1等の未コミット変更は保持。

## 2026-10-04 — [WORLD-1] ワールドモード試作

### 作業内容
- `world.html`: 独立したclassic-script入口。音声ドロップ→SongMap解析→クリックで全画面再生、Space一時停止、カーソル消去、終端・再上演、debug表示、WebGL2/HDR非対応表示を追加。既存`index.html`と既存JSは変更なし。
- `js/world/gl-util.js`: WebGL2コンパイル・RGBA16F FBO・ピンポン・共有std140 UBO・全画面三角形・資源解放。
- `js/world/fluid.js`: 画面1/4のStable Fluids。半ラグランジュ移流、粘性拡散4反復、渦度閉じ込め、発散計算、Poisson/Jacobi圧力20反復と勾配射影、染料移流・減衰。
- `js/world/particles.js`: 512×512=262,144粒子。RGBA32F位置/速度状態のGPUピンポン更新、流体移流・カールノイズ・慣性・境界衝突、SDF深度遮蔽・視差・発光点のHDR加算。
- `js/world/form.js`: 半解像度SDF。切削結晶・結び目・折り畳みフラクタル・メタ球・ジャイロイド・天体環の6族、細部彫刻、ソフトシャドウ・AO、内部追跡とRGB別屈折率による分散、内部光・集光表現、霧の積分と光の筋、カメラ再投影の速度MRT。
- `js/world/post.js`: 4段ブルーム、深度差によるボケ、速度バッファによるブラー、色収差、露出・周辺減光、ACES、sRGB出力・粒子状グレイン。
- `js/world/score.js`: 純関数`compileWorldScore(songMap, seed)`。全境界・終端・2小節前の予兆・1拍前の静寂、ラベルハッシュによるモチーフ/パレットと1から増える変奏、和音分布からの曲固有パレット。
- `js/world/world-engine.js`: HDR層合成、セクション状態・カメラ、キック衝撃波・ドロップ相転移、先読み減速と完全黒、全境界通過の発火、事前確保ログとMFS即時uniform、CPU/GPU時間・HDR/出力readback。
- `js/world/world-app.js`: 既存AudioEngine/getFeatures/MfsFrameView/MFS_LAYOUTを使用。SongMapService派生クラスで既存解析行のクロマ分布を集計。`window.__world`にscore/engine/events/metrics()と評価用音声・appを公開。debug整形はrAFから分離。
- `tests/unit/world-score.test.mjs`: UW-01〜06。決定性、入力不変、全境界・予兆、モチーフと変奏、6族・和音パレット、W-2の計測数学、WebGL命令mockでtexture feedback禁止・流体射影反復・全粒子・uniform即時更新を検証。
- `tests/browser/world.test.js`・`tests/world/measure.mjs`: 独立したworld.html?debug=1で既存synthSongとencodeWav16を使って120秒の合成曲を解析・実再生。W-1〜W-8、GL/consoleエラーとGPU情報をJSON化し、各セクション中央の最終画像をPNG保存する。既存runnerのapp/harnessテストとしては登録しない。

### 検証
- `node tests/run.mjs --unit`: 136件 / 135成功 / 0失敗 / 1スキップ（想定のU15-00異常系）、86,470ms、終了コード0。UW-01〜06を含め成功。最終のsRGB伝達関数整理後はUW-01〜06と全構文チェックを再実行。
- UW-01〜06の個別実行: 最終再実行6成功 / 0失敗、619.84ms。6セクション・11事前イベント・3モチーフ、変奏列1,1,1,2,2,3。100 seedsで6形態族が選択されることを検証。
- GPU命令mock: 粒子262,144、流体480×270、圧力20反復、境界6/6、uniform反応0フレーム。これは命令・CPU演出の検証値で、実GPU描画の実測値ではない。
- W-2計測関数の合成画像: 低64.1306677% / 中16.6111166% / 高19.2582157%。Gaussian定数保存誤差<1e-14、帯域比率合計誤差<1e-12。描画画像のW-2実測ではない。
- 全`.js`/`.mjs`114ファイルの`node --check`: 成功。world.htmlの20 script参照先はすべて存在。`git diff --check`: 成功。
- ChromeはCODEX_ADDENDUMにより未起動。GLSLの実コンパイル、実GPUのW-1〜W-8、操作・file://動作・W-9、所有者による画質評価は未実行。W-8の16ms達成を含め合格の主張はしない。

### spec.md 変更
- なし。今回は「チケットで列挙したファイルのみ」の指示を優先し、README.md/spec.md・既存アプリ・SSOTを編集しない。独立試作の仕様は指定SSOTを参照。

### 備考
- 実装: Codex gpt-6.1-sol high
- アーキテクトがSSOT §1.3を更新し計測の細部を委任したため、前回のW-2停止を解除。基準値変更・既存テスト削除/緩和・ゴールデン再生成なし。
- 判断: 出力1920×1080固定（CSSで16:9を保持）、流体1/4・SDF1/2、粒子状態32F／描画16F。ライブdtは33ms以下にクランプしbreakは0.3倍。固定dtによる書き出し一致はSSOT §6の第2段階。
- 判断: 既存SongMap v1には平均クロマがないため、world専用のSongMapService派生クラスが解析行を集計し、worldChromaを追加した解析結果をscoreへ渡す。既存JSへの追加helperは不要。
- 計測細部: W-1はセクション中央のHDR画素min/max（ゼロ除算のみ1e-6保護、生値も報告）。W-2はsRGBを線形化せず指定Y、4×4平均、Gaussian半径ceil(3σ)・正規化分離畳込み・端画素を重複する対称折返し。中央を最初に通過した再生フレームを採用。
- 計測細部: W-4はgetFeatures時のフラグと実UBOを照合。W-5は各窓内の全描画フレームを算術平均、完全黒→非ゼロはInfinity、標本0は失敗。W-6は曲頭を含め全セクション開始を対象にし、曲末を別endイベントとして記録。
- 計測細部: W-8は2秒のウォームアップ後、全描画パスのGPU timerとCPU送信の大きい方のp95。GPU完了を非同期に取得し、120標本以上を要求。readback・Gaussian・debug整形は描画区間外。timer非対応や実GPU未確認は合格にしない。既存chrome.mjsの固定--disable-gpuのみを一時起動adapterで除き、同じlaunchChrome APIでheaded起動する。adapterは終了時に削除する。
- 逸脱: 最初の2つのテストstdoutを誤って/private/tmpへ出力した。1つは削除し、実行中の最終ログはworktree内へ移動した。最終ログも記録後に削除済み。ソースの変更は指定worktree内のみ。
- レビュアー確認: `node tests/world/measure.mjs`をヘッド付きmacOS Chromeで実行し、tests/world/output/report.jsonとsection-*.pngを確認。W-1〜W-8の閾値・GL/consoleエラー0、特に各セクションのW-2・16msのW-8と実GPU/timer対応。実曲を使い、六つの描写条件（光・細部・空間・物理・同期・飽きなさ）の見た目、予兆とドロップ・6形態・繰り返し変奏、Space/Esc/終端/再上演、file://と非対応表示を確認すること。
- コミット・push・PR・Chrome起動なし。変更は未コミットで納品。

## 2026-10-03 — [T18-11] アナライザータイプの整理（6タイプ削除）

### 作業内容
- `js/renderer-registry.js`: オーナー決定の6タイプを除去し、空の系統見出しを削除。残存8タイプの描画関数・ケイパビリティは維持。
- `js/renderers/particles.js`（ParticlesRenderer・FlowRenderer・ParticlePool）、`ripple.js`、`metaball.js`、`flower.js`、`voronoi.js` を削除。ParticlePool は削除対象以外に利用者がないことを検索で確認。共有ファイル `js/vis-utils.js` は残存レンダラーが使うため維持。
- `index.html`・`js/ui-controller.js`: 削除対象の5 script タグ、要素量・花弁数の専用UI、バインド・同期・ケイパビリティ表示・演出ロックの参照を除去。タイプ選択とランダム候補はレジストリから残存8タイプを取得。
- `js/settings-io.js`: 削除タイプの旧設定・保存プリセット・インポートJSONを通常読込では bar に戻す。loadPreset の skipRemovedType オプションにより、UI の演出プールでは互換変換より前に旧タイプを除外し、保存データ自体は変更しない。
- `js/director-scenes.js`: 削除対象の内蔵6シーンを除去し、直接渡された旧タイプのプリセット候補も飛ばす。内蔵は calm 2 / build 3 / drop 3。
- `tests/unit/settings-io.test.mjs`: U15-01 を拡張。6旧タイプのデシリアライズ・ファイルインポート・保存読込・演出用除外と、残存8タイプ保持・UI の演出プール・保存データ非破壊を検証。
- `tests/unit/director-timeline.test.mjs`: 内蔵8シーンの期待値を更新し、2/3/3件を確認。削除タイプのプリセットだけ／有効プリセットとの混在で各系統フォールバック・連続回避を追加。`tests/unit/director-state.test.mjs` のテスト用タイプを残存する tunnel に変更し、ランプの式・閾値・丸め検証は維持。
- `tests/shared/golden-cases.js`・`tests/browser/golden.test.js`: 基本32 + 追加10 = 42ケースへ更新。`tests/golden/frames.json` は削除対象の24キーのみ文字列として削除し、再生成・再シリアライズしない。
- `tests/browser/regression.test.js`: B15-03 を8タイプの500ms巡回へ更新し、正確な一覧・専用UIの削除を確認。`tests/browser/b16-05.test.js`・`b16-live.test.js` のタイプ数期待値を8へ、`b18-live.test.js` のロックUI一覧を更新。
- `tests/browser/b15-07.test.js` を削除し、B15-07 を退役。`doc/20260928-plan-phase15-test-foundation-and-frame-pipeline.md` の §3.6.1・B15-03/04/07・T15-10・getLayer 利用者一覧を更新。`doc/20260928-plan-phase18-song-map-and-auto-director.md` §6.3 を8シーンと旧プリセット除外へ更新。「2026-10-04 オーナー決定で削除」を明記。
- `README.md`: 現行8種類・専用パラメーター整理・旧設定の読込互換を反映。

### 検証
- `node tests/run.mjs --unit`: 130件 / 129成功 / 0失敗 / 1スキップ（想定のU15-00異常系）、106,937ms、終了コード0。T18-07/08 の U18-13〜20、T18-09 と T18-10 の既存単体テストを含め成功。
- 全 `.js` / `.mjs` 103ファイルの `node --check`: 成功。追記した単体テスト2ファイルは最終の空行整理後にも構文チェック成功。
- 連続回避: 既存U18-15は3,000組。追加U18-15は3系統 × 2プール × 3強度 × 50 seeds = 900コンパイル、4,500組すべて非重複。定数調整・閾値緩和なし。
- HEAD のゴールデン基準値と文字列比較: 66 → 42エントリ、24エントリだけ削除。残存42エントリ・126サムネイルはバイト一致。index.html の全 script 参照先が存在することも確認。
- `git diff --check`: 成功。英語ID・日本語名・削除クラス名・ParticlePool の全体検索を実施。レジストリ・内蔵シーン・script・ゴールデンに削除タイプなし。残存参照は互換判定・互換テスト・UI削除確認・未変更の旧設定コメントと、編集対象外の過去文書／既存ログ。
- ブラウザは CODEX_ADDENDUM により起動不可。変更した B15-03/B15-04/B16-03/B16-05/B18-02 と、B18-03/04を含むブラウザ全件・file:// コンソールエラー0確認は未実行。B15-07はオーナー指示による退役。

### spec.md 変更
- v2.15、2026-10-04。§11.3 を8タイプの一覧と後方互換へ、§11.1 の削除タイプ専用の白背景 multiply 注記を除去。§20 の現行タイプ数と専用パラメーター説明、および自動演出の利用者向け設定説明を整理。理由は低品質・利用見込みが低く、根本改善には Phase 19 WebGL2 化が必要というオーナー決定。

### 備考
- 実装: Codex gpt-6.1-sol high
- 記録日は依頼の「今日 2026-10-03」に合わせ、製品・計画書の改訂日は指定のオーナー決定日 2026-10-04 を採用。
- 判断: 通常読込の bar 変換が演出候補へ紛れないよう、演出向け読込だけ変換前に除外。loadPreset の既存呼出しは従来の戻り値を維持。既存 DIRECTOR_MANAGED_KEYS・RAMP_PARTICLE_MUL・ランプ式・particleAmount/petalCount の保存互換フィールドは維持し、専用UIのみ削除。
- 範囲: チケットで列挙されていない Phase 6 文書、Phase 16 計画書、進化構想書、過去ログは変更しない。旧タイプ・14タイプの歴史的記述が残る。js/settings.js の petalCount コメントにも旧表示名が残るが、選択・描画・UIの参照ではない。
- レビュアー確認: ブラウザ全件（slowのB18-03/04も含む）、残存42ケースのゴールデン一致、8タイプ巡回・ランダム選択・専用UIなし、旧プリセット/JSONの通常読込がbar・演出候補では除外、マイプリセットの系統別フォールバックとライブ/書き出し一致、黒白・16:9/1:1・file://コンソールエラー0。特にB18-04の3倍条件は未計測で、失敗時は計画書§8.3に従って停止・報告し、定数を調整しない。
- コミット・push・PRなし。変更はこのworktree内の未コミットファイルとして納品。

## 2026-10-03 — [T18-10] 書き出しへの組み込み（songMapTempoAt の呼び出しを含む）

### 作業内容
- `js/offline-exporter.js`: 自動演出 ON 時に opts.songMapService.request(file) を待ち、ライブと同じ4つの演出オプションと名前順の opts.presets で書き出し専用 DirectorController を初期化。各フレームを i / fps で評価し、終了・中断・描画失敗時に dispose する。
- 同ファイル: マップがあれば毎フレーム、描画前に songMapTempoAt を呼ぶ。MfsFrameView と input、前フレーム時刻を使い回し、features=null にも対応。OFF はキャッシュのみ参照、解析失敗はマップなしの従来経路で続行。元のフレーム時刻・timestamp・dt・採取規則・エンコード・音声デコード経路は維持する。
- 同ファイル: 演出でタイプが切り替わる場合は、元設定が selfClear でも動画合成ソースを用意し、各シーンの FramePipeline に selfClear 判定を委ねる。Node テスト用 module.exports を追加。
- `tests/unit/offline-director.test.mjs`: タイムライン一致、参照維持、ON/OFF の拍更新、元 packed 非破壊、マップなしの通常経路、features=null、共有解析待ちと失敗・中断、25/29.97fps、繰り返し書き出し、動画背景の7ケースを追加。WebCodecs・描画はモック、コンパイル・状態評価・拍計算は実コード。
- `tests/browser/b18-export.test.js`: B18-03/B18-04 を追加。B18-02 と同じ合成PCMの32bit float WAVをスロット1に読み込み、ONでライブ再生後、全曲を30fpsで実書き出しする。実際に描画したタイムラインの深い一致と各フレームの拍更新を検証し、出力映像のデコード後に build→drop 境界の平均絶対差を測定する。
- `doc/spec.md`・`README.md`: 書き出しの自動演出・解析待ち・失敗時の通常書き出し・OFF時の解析済みマップ利用を記載。Phase 18 の実装完了を反映。
- `js/ui-controller.js` は T18-09 で必要な opts を渡しているため変更不要。その他の本体、計画書、ゴールデン基準値は未変更。

### 検証
- `node tests/run.mjs --unit --filter T18-10`: 初期追加5ケースすべて成功。ランナー表示29成功（非対象24ファイルの表示を含む）/0失敗/0スキップ、1,906ms、終了コード0。その後追加した2ケースは全件実行で検証。
- `node tests/run.mjs --unit`: 128件/127成功/0失敗/1スキップ（想定のU15-00異常系）、138,268ms、終了コード0。新規T18-10の7ケースすべて成功。
- 全109個の.js/.mjsに対する `node --check`: 失敗0、終了コード0。最後のブラウザテスト変更も個別再チェック成功。`git diff --check`成功。
- タイムライン: 3強度×2候補プールの6条件（flash=false、seedOffset=7）、各1000フレームでライブと深く一致。合計6000フレームで input・MfsFrameView・out・primary.settings の参照変更0。初期化後の連続描画によるシークresetは0。
- 拍: ON/OFF各61フレームで i/fps・前時刻から計算した全raw値と一致、元packed変更0、既存timestampを維持。マップなしのON/OFF各61フレームでraw・timestamp・keyframeが一致。features=nullの演出3フレームも成功。
- 25/29.97fpsで各2回・各61フレーム（合計244フレーム）の時計と繰り返し出力一致、各回の先頭拍フラグ0。サービス結果7条件（成功1・全エラーコード6）で通常完了、OFFのgetは1回、共有解析待ちで中止後の音声解析0回。中止・描画失敗の2条件で専用ControllerとPipelineをdispose。
- 元設定spectrogramで、ONの動画背景取得・描画は各3回、ソースdispose1回。OFFではいずれも0回（従来のselfClear経路を維持）。
- B18-03/B18-04、既存ブラウザテスト全件、B15-04ゴールデン、file://コンソール確認はCODEX_ADDENDUM.mdのChrome禁止に従い未実行。映像の平均絶対差・比率や実ブラウザ書き出し時間・フレーム数・Blobサイズの実測はない。
- Chrome起動・コミット・push・PR作成なし。編集は本worktree内のみ。

### spec.md 変更（あれば）
- v2.13 → v2.14、日付2026-10-04（依頼指定）。§13.4を実装済みの同一タイムラインへ更新、§14.8.4を追加、§20へPhase 18実装済みを反映。依頼の計画書§11照合で未記載と判明した§9.7も、指定済みのソングマップ仕様で補完。

### 備考
- 実装: Codex gpt-6.1-sol high
- 定数調整・アルゴリズム変更・受入閾値変更なし。48000Hzのソングマップデコードは既存SongMapService（SONG_CONST.DECODE_SAMPLE_RATE）を利用し、従来の書き出し音声デコードは変更していない。
- 実装判断: §4.4とライブのOFF時の拍補強に合わせ、OFFはサービスのgetだけを使う。共有のrequestをExporter.cancelから中止せず、結果取得直後のキャンセルチェックで書き出しを止める（共有解析が終わるまでは待つ）。動画合成ソースの準備は演出中のみ元設定のselfClear制限を外し、描画は既存Pipelineの判定に従う。
- テスト判断: B18-03/B18-04は重い全曲書き出しを共有し、どちらか単独のfilterでも実書き出しする。両方slow=true/timeoutMs=900000。B18-04は境界直前のbuild内の隣接2枚を比較基準とし、デコードした全画素のRGB平均絶対差で3倍条件を検証する。フレームの縮小・閾値緩和・seed調整なし。
- レビュアー確認: `node tests/run.mjs --browser --filter 'B18-(03|04)'`（--skip-slowなし）、ブラウザ全件、B15-02・B16-06・B16-06b/c・B15-04、file://コンソールエラー0。B18-04が3倍条件を満たさなければ計画書§8.3の不合格として報告し、定数を調整しないこと。
- §8.4手動確認は未実施: ジャンルの異なるオーナー提供の実楽曲5曲の切替を○/△/×と一言コメントで評価、フラッシュの快適性・控えめで発光なし、書き出しとライブの演出一致、OFF時の操作復帰。併せてマイプリセット・seed/flash変更の一致、黒白/16:9/1:1・動画背景を伴う演出を確認してほしい。

### レビューでの対応（Claude）
- `doc/spec.md` §20 に「Phase 16: 音楽特徴ストリーム（実装済み）」の節が無かったため追加し、計画表を「Phase 15〜18: 進化構想の第1期（2026-10-04 完了）」に改めた
- 検証（macOS / Chrome 154 / Node 26）: `node tests/run.mjs` 169 PASS / 0 FAIL / 1 SKIP（B18-03・B18-04 PASS、B15-02・B16-06/b/c・B15-04 も PASS）。`file://` でコンソールエラー 0
- これで計画書（PR #32）の Phase 15・16・18 の全チケットが完了

- レビュアー検証（Claude, macOS / Chrome 154 / Node 26）: `node tests/run.mjs` 170 PASS / 0 FAIL / 1 SKIP（B15-03 は 8 タイプ、B15-04 は 42 ケース、B18-02〜08 を含む）。`file://` でコンソールエラー 0。ゴールデンは残存 42 キーが main と完全一致、削除は 6 タイプの 24 キーのみであることを照合

---

## 2026-10-03 — [T18-09] ライブへの組み込み（songMapTempoAt を含む）と UI

### 作業内容
- 更新された Phase 18 計画書 §6.8（setEnabled・setAnalysisState・statusDetail と7段階の状態優先順位）を再読し、前回の停止事項はアーキテクト決定で解消。
- `js/director-controller.js`: タイムライン・使い回す状態・DirectorRendererを管理する公開API、再コンパイル、1秒超の時刻ジャンプ・逆行でのreset、resize/disposeを実装。
- `js/visualizer-core.js`: 音声/動画共通のmediaElementとdirectorを追加。演出ON・準備完了・メディアありの描画分岐、OFFでも毎フレームsongMapTempoAtを呼ぶ経路、スロット変更時の前時刻破棄、実シーンのdebug表示を実装。rAFコールバックはconstructorで確保して使い回す。
- `js/ui-controller.js`: アクティブキーのみの進捗・成功・エラー配線、取消・古い結果の無視、スロット/マイク/未選択の状態復帰、設定変更・ON・プリセット保存削除の再コンパイル、状態文言、管理操作の無効化とOFF復帰、セクション帯を実装。書き出し呼出しへsongMapServiceと名前順presetsを渡す（exporter本体は未変更）。
- `js/settings.js`: §7.1の5項目を既定値どおり追加（directorEnabled=false）。既存JSON/プリセット機構で保存・旧JSON補完。
- `index.html`・`style.css`: アナライザー末尾の自動演出UI、シークバー直下の高さ3pxの帯、指定CSS変数、§2.1順のscriptタグを追加。Phase 13のレイアウト規則は維持。
- `tests/unit/director-controller.test.mjs`: 状態優先順位・再コンパイル・シーク・1000フレームの参照維持・ライブ拍更新・非同期配線・JSONの7ケースを追加。
- `tests/browser/b18-live.test.js`: B18-02・B18-05〜07を追加。入力はB18-01と同じ量子化なしの32bit float WAV。B18-02には比例幅・12操作の保護/OFF復帰・3ランダムボタンの5設定維持も含める。
- `tests/browser/b18-performance.test.js`: B18-08を追加。debug=1でフェードを含む10秒再生を計測し、フェード内外のp95・比率・フレーム数・再生秒数を出力。合格条件は計画書の2.5倍以下。
- `README.md`: ライブでの自動演出の使い方・状態・操作・保存を追記。

### 検証
- `node tests/run.mjs --unit`: 121件 / 120成功 / 0失敗 / 1スキップ（想定のU15-00異常系）、112,557ms、終了コード0。
- `node tests/run.mjs --unit --filter T18-09`: 新規7ケースすべて成功。最後のcancelled表示・unavailable詳細の調整後も再実行して成功。ランナー表示30成功（非対象23ファイルの表示を含む）、0失敗、1,987ms、終了コード0。
- 全107個の.js/.mjsに対する`node --check`: 失敗0、終了コード0。最後の変更4ファイルも再チェック成功。`git diff --check`成功。
- シーク確認: [1,2,2,3.001,3]秒の5地点でreset追加は2回（ちょうど1秒/同時刻では0回、1.001秒ジャンプ/逆行で各1回）。drop中央のsceneId一致。
- 1000フレームでout・primary/secondaryのsettings・入力参照の変更0。ライブ経路ではOFFの2フレームで通常pipeline=2回、media切替後の拍フラグ=false、ONでdirector描画、features=nullを処理、media=nullで通常描画を確認。
- B18-02・B18-05〜08、既存ブラウザ全件（B15-04含む）、file://コンソール確認はCODEX_ADDENDUM.mdに従い未実行。描画p95の実測なし。ゴールデン基準値は未変更。
- Chrome起動・コミット・push・PR作成なし。

### spec.md 変更（あれば）
- v2.12 → v2.13、日付2026-10-03。§13.4自動演出と§15.1必須UIを追加。書き出しは同一タイムラインを用いる設計として記載し、経路の実装はT18-10であることを明記。

### 備考
- 実装: Codex gpt-6.1-sol high
- 定数調整・アルゴリズム変更なし。解析進捗はUI側でキー別に保持し、切替時に復元する。古いPromiseの結果はエントリ同一性とアクティブキーで除外。section.kind=mainの帯は指定どおり--section-main、それ以外はKIND_CLASSを参照。
- B18-07は共有ページに永続fallbackを残さないよう別iframeの実アプリを使い、AudioContext未生成を確認してMFS起動前に強制失敗フラグを設定する。
- 検証出力を一時的にworktree外の`/tmp/T18-09-unit.txt`へ保存した点は作業場所制約からの逸脱。報告数値を転記後に削除。ソース・テスト・文書の編集は本worktreeのみ。
- 着手時に存在した計画書§6.8のアーキテクト変更は保持し、こちらでは編集していない。`js/offline-exporter.js`も未変更。
- レビュアー確認: `node tests/run.mjs --browser --filter 'B18-(02|05|06|07|08)'`（--skip-slowなし）、ブラウザ全件とB15-04、file://コンソールエラー0、Phase 13の狭幅レイアウト・チェックボックス/セレクト/ボタンのタッチ操作。B18-08が基準を満たさなければ、定数を調整せず計画書§8.3に従って報告する。
- §8.4手動確認はすべて未実施: (1)ジャンルの異なるオーナー提供の実楽曲5曲で切替を○/△/×と一言コメントで評価、(2)フラッシュの快適性・危険感と控えめで発光なし、(3)書き出しとライブの演出一致（T18-10と連携）、(4)OFF時にすべての操作が元どおり使えること。

### レビューでの対応（Claude）
- アーキテクト判断: DirectorController に `setEnabled`・`setAnalysisState`・`statusDetail` を追加し、状態の決め方（7段階）と UIController の配線を計画書 §6.8 に明記
- B18-02: セクション帯の幅の比較許容差を 1e-6 → 0.01（%）に変更（ブラウザが CSS の % 値を小数第3位で丸めるため。12.506 vs 12.505955）
- 検証（macOS / Chrome 154 / Node 26）: `node tests/run.mjs` 全件で失敗 0（B18-02・B18-05〜08 PASS、B15-04 ゴールデン不変）。`file://` でコンソールエラー 0。375px 幅で横スクロールなし（自動演出 UI 7 要素あり）

---

## 2026-10-03 — [T18-08] 状態の評価と描画

### 着手前の設計要約（★3）
- §6.6: 時刻からセグメントを選び、使い回す設定へユーザー設定・レイヤーを複写し、シーンパッチ・累積変化・ビルドのランプを適用する。フェード中は前セグメントの終端状態も評価し、新シーンの混合率と指数減衰するフラッシュ不透明度を返す。評価は前フレームに依存しない。
- §6.7: オフスクリーン2枚と2つの FramePipeline をセグメント番号の偶奇で割り当て、割当変更時に初期化する。旧シーン、新シーン、背景と反対色のフラッシュの順に合成し、動画背景の入力は両パイプラインへ渡す。

### 作業内容
- `js/director-timeline.js`: 更新済み §6.4 の intensity をコンパイル結果へ保存。§6.6 の directorStateAt、使い回す out を初期確保する createDirectorState を追加。設定・レイヤーを生成せず複写し、パッチ・累積変化・ランプ・クロスフェード・フラッシュを評価。
- `js/director-renderer.js`: §6.7 の DirectorRenderer を追加。2枚の canvas と2つの FramePipeline の割当・リセット・リサイズ・合成・破棄を実装。
- `tests/unit/director-state.test.mjs`: U18-17・U18-18・U18-20（7ケース）。指定境界、全3強度のランプ、クランプと丸め、累積変化、逆行時刻、ユーザー設定の即時反映、1000回の参照維持を検証。
- `tests/unit/director-renderer.test.mjs`: 同IDの補足3ケース。描画と合成の順序、設定/inputの同一参照、動画背景の両側への受け渡し、割当とreset、resize/disposeを検証。
- `tests/unit/director-timeline.test.mjs`: 既存 U18-13 の30条件に intensity 保存のアサーション1行を追加。
- `tests/browser/director-renderer.test.js`: 補足 B18-T18-08 を追加。実Canvasの合成色、黒白背景、16:9/1:1、動画背景、同タイプ別セグメントの固有状態破棄を確認する。T18-09の配線前でもfile://ハーネスで必要スクリプトを順に読み込む。

### 検証
- `node tests/run.mjs --unit --filter 'U18-(13|17|18|20)'`: 対象14ケース全成功。ランナー表示33成功（非対象19ファイルの表示を含む）、0失敗、1,285ms、終了コード0。
- `node tests/run.mjs --unit`: 109件 / 108成功 / 0失敗 / 1スキップ（想定どおり U15-00 異常系）、108,885ms、終了コード0。
- 全100個の `.js` / `.mjs` に対する `node --check`: 失敗0、終了コード0。`git diff --check`も成功。
- U18-17: fixture のフェード3区間 × 開始/中央/終了で mix = 0/0.5/1（許容1e-9）、ドロップ2区間でsecondary=null。全3強度 × 0/50/100% のランプ9地点と上下限クランプ、粒子数の四捨五入、前シーンの終端ランプを確認。
- U18-18: 発光時刻0/30/75.173秒で、経過0/0.12/0.4/0.5秒のalpha = 0.8/約0.294303553/0/0（許容1e-9、終端は厳密0）。fixtureと密なdrop入力の12条件で間隔8組すべて2秒以上、最短2秒。calmまたはflash=falseの8条件で発光なし。
- U18-20: 1000回評価（うちフェード300回）でout・設定2個・レイヤー配列2個・要素8個の参照変更0。Rendererも同割当1000フレームでPipeline生成はconstructorの2個のみ、割当resetは初回1回。
- B18-T18-08、既存ブラウザ全件、file://アプリのコンソール確認は CODEX_ADDENDUM.md に従い未実行。Chromeは起動していない。

### spec.md 変更（あれば）
- なし（チケット表の spec 更新は不要）。README.md・index.html は未変更。

### 備考
- 実装: Codex gpt-6.1-sol high
- 前回停止の3点はアーキテクト決定と更新済み計画書で解決。FramePipelineの設定生成は既存例外のまま、本体は未変更。強度はtimeline.intensityから読み、シーク検出と拍フラグはsongMapTempoAt/DirectorControllerに委ねる。
- 実装上の補助: createDirectorState() とout._secondaryで、公開secondaryをnullにしても事前確保した設定を保持する。T18-09はconstructorでこのヘルパーを1回呼び、同じoutを使い回す。手動でprimary/secondaryを事前確保したoutも対応する。
- 実装上の判断: FramePipeline.reset()だけではタイプ固有インスタンスとcanvas上の残像が残るため、Rendererは公開dispose()とclearRectも使い、割当変更時にfillBackgroundで不透明な背景を初期化する。シーン切替時だけの下流初期化を除き、Renderer自身の毎フレーム経路に配列・オブジェクト・クロージャ生成はない。
- 実装上の判断: フラッシュ終端はt < f + FLASH_DURATION_SECで比較する（式と数学的に同値）。f + durationからfを減算した際の丸めで0.4秒の終端に発光が残らないことを3時刻で確認。定数・受入閾値は変更していない。
- レビュアー確認事項: `node tests/run.mjs --browser --filter B18-T18-08`、T18-09配線後のブラウザ全件・file://コンソールエラー0、同タイプ別セグメントとシーク時の履歴/残像の消去、ControllerのcreateDirectorState利用とシークreset呼出し。
- 追加ルールに従い、コミット・push・PR作成は行っていない。開始時点で変更済みだった計画書は編集していない。

### レビューでの対応（Claude）
- アーキテクト判断（計画書 §6.4・§6.7 に明記）: ① FramePipeline の `{...settings, hue}` は Phase 15 §4.3 の例外のまま ② `intensity` をタイムラインに保存し `directorStateAt` が参照 ③ シーク検出・拍フラグは `songMapTempoAt`／DirectorController の責務で `directorStateAt` は純関数
- ブラウザテスト: ID を予約済みの B18 系から `T18-08` に変更。実 Canvas の半透明合成で 1〜2 単位の丸め差が出るため（mix 0.5 で 126 vs 128）、ピクセル許容差を ±1 → ±3 に変更（計画書の受入基準 U18-17・18・20 は単体テストで合格）
- 検証: macOS（Chrome 154 / Node 26）で `node tests/run.mjs` 全件 0 FAIL

---

## 2026-10-03 — [T18-05] SongMapService

### 作業内容
- `js/songmap-service.js`（新規）: 計画書 §5 の SongMapService を実装。同一キーの実行中・待機中 Promise を共有し、FIFO で1件ずつ解析。最大6件のLRUキャッシュ、進捗、待機中・実行中の中止、各 SongMapError コードを接続
- `js/songmap-service.js`: file.arrayBuffer → AudioContext.decodeAudioData → 長さ判定 → OfflineAudioContext / MFS songmap モード → rows の startHop/count/data に従った収集 → done 待機 → buildSongMap を実装。decode 用コンテキストを閉じ、worklet の port / node / source を解放
- `js/ui-controller.js`: AudioEngine の fallback を含む isAvailable を渡してサービスを生成。読込成功後に全スロットで非同期 request、差し替え成功時・削除時に旧ファイルを cancel。ファイルは slot.file で保持。解析エラーの表示・DirectorController の接続は後続 T18-09
- `index.html`: 計画書 §2.1 の指定どおり、mfs-view.js の直後に songmap-analysis.js → songmap-service.js の2タグを追加。他のタグ・順序は変更なし
- `tests/browser/b18-songmap-service.test.js`（新規）: B18-01c〜g の5件を追加。全経路、U18-08 基準、Node の同一 PCM 結果との比較、FIFO・Promise 共有・LRU、中止・遅延 done、エラー・長さ境界・可否変更を検査
- 既存のこのログエントリを更新。前回停止した §4.3 / §5 の利用不可契約は、アーキテクトが追加した unavailable と isAvailable に従って実装を再開

### 検証
- `node tests/run.mjs --unit`: 86件 / 85成功 / 0失敗 / 1予定SKIP（U15-00 異常系）、79,650ms、終了コード0。U18-08（6条件）・U18-09（2条件）を含む既存解析テストもすべて成功
- 全 .js / .mjs の `node --check`: 最終コードで95ファイル / 95成功 / 0失敗、15.041秒。実装途中の確認も95成功（28.748秒）
- `git diff --check`: 成功（空白エラーなし）
- B18-01c〜g は追加済み・未実行。追加ルールにより Chrome を起動せず、ブラウザの実測値および file:// のコンソールエラー数は未計測

### spec.md 変更（あれば）
- なし（T18-05 の spec 更新列は「不要」。README.md も変更なし）

### 備考
- 実装: Codex gpt-6.1-sol high
- 計画書の定数・アルゴリズム・受入閾値の変更なし。作業開始時から存在するアーキテクトの計画書変更は保持し、こちらでは計画書を編集していない
- 実装上の判断: OfflineAudioContext に中止 API がないため、cancel は Promise を即 reject して以後の進捗・キャッシュを抑止し、実行中の描画の終了を待ってから後続を開始する。done 待機中の中止は待機を解放する
- テスト上の判断: 同一 Float32 PCM の厳密比較に必要な IEEE float 32bit WAV をテスト内で作成。Node 比較対象は既存 tests/fixtures/songmap-128.json の beats / sections を埋め込み、file:// で fetch を使わない。fixture 自体は変更なし
- レビュアー確認事項: `node tests/run.mjs --browser --filter B18-01` で既存の行データ部分と新しいサービス5件を実行。B18-01c はデコード後の sampleRate=48000、beats 差 ≤ 1e-6秒、sections の完全一致を検証する。UI のアクティブ・非アクティブ読込、成功した差し替え・削除の cancel、失敗した差し替えで旧ファイルを保持すること、fallback 時の request、および index.html の file:// 直開き・コンソールエラー0も確認
- コミット・push・PR 作成なし。こちらの変更は指定 worktree 内のチケット対象ファイルと上記テスト・ログのみ

### レビューでの修正（Claude）
- アーキテクト判断: AudioWorklet 不可時は `SongMapError('unavailable')` で即 reject（計画書 §4.3・§5 に明記）
- B18-01c: Node との `sections` 比較を、構造（小節番号・ラベル・種類）は完全一致、実数（秒・energy・slopePerSec）は ±1e-9 に変更。実測の差は `slopePerSec` の 2.4e-18（ブラウザと Node の Math 実装差による最下位ビット）。計画書 §8.3 B18-01 に明記
- スロットのファイル参照は UI 側で書き込まず、`MediaManager.loadFile` がスロットに `file` を持つよう変更
- 検証: macOS（Chrome 154 / Node 26）で `node tests/run.mjs` 119 PASS / 0 FAIL / 1 SKIP。`index.html` を `file://` で開きコンソールエラー 0
- CI（44.1kHz の Chrome）で B18-01c が失敗（デコード時に端末レートへリサンプルされ 48kHz の参照と不一致）。アーキテクト判断で SongMapService のデコードを `SONG_CONST.DECODE_SAMPLE_RATE = 48000` の AudioContext で行うよう変更（端末に依らず同じソングマップになる）。計画書 §4.1・§5 に反映

---

## 2026-10-03 — [T18-06] 拍情報の置き換え（関数のみ）

### 作業内容
- `js/songmap-analysis.js`: §4.4 の `songMapTempoAt(map, tSec, prevTSec, view)` を末尾に追加し Node 用に公開。既存関数は変更せず、拍区間・小節頭を二分探索し、tempo 関連の raw 8 値だけを上書き。毎フレームの配列・オブジェクト・クロージャ生成なし
- `tests/unit/songmap-tempo.test.mjs`: U18-12 の 5 テストを追加。拍の直前・直後・拍上・小節頭・弱起・区間外・初回・逆行・1秒超・ちょうど1秒・区間の開閉端点を検証。格子 fixture と不均等 DP 拍を線形の参照実装と比較し、入力・view の参照・他の特徴値の保持も確認
- ライブ・書き出しの呼び出しは §9 の T18-09 / T18-10 に委ね、接続していない

### 検証
- `node tests/run.mjs --unit --filter U18-12`: U18-12 の 5 件成功。ランナー表示は対象外ファイル19件を含む24件成功、0失敗、245ms
- `node --test tests/unit/songmap-tempo.test.mjs`: 5件成功、0失敗、84.621459ms。比較2,000フレーム、最大位相誤差 `2.976397e-8`（Float32丸め）、raw / tempo の参照と tempo 以外の96値が不変
- `node tests/run.mjs --unit`: 91件中90成功、0失敗、1スキップ（想定どおりの U15-00 異常系）、27,801ms
- 全 `.js` / `.mjs` の `node --check`: 94ファイル成功、0失敗
- `git diff --check`: 成功
- ブラウザテストの追加なし。Chrome・ブラウザ全件・`file://` コンソール確認は追加ルールに従い未実行

### spec.md 変更（あれば）
- なし（§9 T18-06 は spec 更新不要、関数のみの追加）

### 備考
- 実装: Codex gpt-6.1-sol high
- 定数・出力仕様の逸脱なし。二分探索は §4.4 の線形定義と比較して出力一致を確認
- `DIRECTOR_CONST` は T18-07 の成果物で現 worktree には未配置。実装は指定の `DIRECTOR_CONST.SEEK_RESET_SEC` を直接参照し、テストだけで §6.2 の `SEEK_RESET_SEC: 1.0` を注入（本体に代替定数を追加していない）
- レビュアー確認事項: T18-07 の実定数と統合後、呼び出し前の `DIRECTOR_CONST` 読込、ブラウザ全件と `file://` コンソールエラー0を確認してください
- 変更は worktree 内の未コミットファイルとして残す。commit / push / PR は行っていない

- レビューで修正（Claude）: T18-07 マージ後、テストの `DIRECTOR_CONST` 注入をやめて `js/director-timeline.js` の実物を読み込むよう変更。後続ファイルが `module.exports` を上書きするため、公開確認は `songmap-analysis.js` 単独読み込みで行うよう修正
- レビュアーが macOS で `node tests/run.mjs` を全件実行（下記 PR 参照）

---

## 2026-10-03 — [T18-07] シーンカタログとコンパイル

### 作業内容
- `js/director-scenes.js`: 計画書 §6.1・§6.3 の `DIRECTOR_MANAGED_KEYS`、内蔵14シーン、プリセットの系統分類・管理キー抽出・系統ごとの内蔵フォールバック・ID 昇順の候補生成、適用後の capabilities に従う `applyScenePatch` を追加
- `js/director-timeline.js`: §6.2 の `DIRECTOR_CONST` を名前・値ともそのまま定義。§6.4 の UTF-16 単位の `fnv1a32` と `compileDirectorTimeline`、§6.5 の適用条件・累積効果の共通関数を追加。`directorStateAt` の T18-08 追記位置を明記
- `tests/unit/director-timeline.test.mjs`: `tests/fixtures/songmap-128.json` を使用する U18-13〜U18-16・U18-19（13ケース）を追加。定数・14シーンの表との一致、FNV 既知値・サロゲート対、決定性、ラベル＋系統での再利用、連続回避、変化の累積・非対応 op のスキップ、プリセットの保護キーを検証

### 検証
- `node tests/run.mjs --unit`: 99件 / 98成功 / 0失敗 / 1スキップ（想定どおり U15-00 異常系）、34,908ms、終了コード0
- 追加アサーション後の `node tests/run.mjs --unit --filter 'U18-(13|14|15|16|19)'`: 対象13ケースすべて成功。ランナー表示は32件成功（非対象19ファイルの表示を含む）、223ms、終了コード0
- U18-13: 3強度 × seedOffset 0〜9 の30条件で同一入力の深い一致とシーン変更を確認。U18-14: 3強度 × 50 seed の150条件で2つのドロップのシーン再利用を確認
- U18-15: fixture と同系統の新規ラベルの追加ケース × 内蔵/プリセット × 3強度 × seedOffset 0〜49、隣接3,000組すべてでシーンIDの重複なし
- U18-16: 全14タイプで適用条件を確認し、opStart は4種類すべてを通過。3強度で各 op の累積・循環、小節時刻、範囲外小節の durationSec への置き換えを確認
- U18-19: 内蔵14 + 全タイプのプリセット14シーン、プリセットコンパイル50条件で保護キーを保持。型を先に適用して capabilities を判定することも確認
- 全96個の `.js` / `.mjs` に対する `node --check`: 失敗0。Chrome とブラウザ検証は CODEX_ADDENDUM.md に従い未実行。ブラウザテストの新規作成なし

### spec.md 変更（あれば）
- なし（チケット表の spec 更新は不要。README.md・index.html も未変更）

### 備考
- 実装: Codex gpt-6.1-sol high
- 計画書の定数・アルゴリズム・受入基準からの変更なし。実装上の分割として `directorSceneCandidates`・`directorVariationApplicable`・`applyDirectorVariation` を公開。設定適用・変化の共通関数は配列/オブジェクトを生成せず、T18-08 の状態評価で利用できる
- レビュアー確認事項: T18-08 は明記した位置に状態評価と Node 用公開を追記し、共通関数を利用してください。T18-09 の script 配線後にブラウザ全件・`file://` のコンソールエラー0を確認してください
- 追加ルールに従い、コミット・push・PR作成は行っていない

- レビュアーが macOS（Chrome 154 / Node 26）で `node tests/run.mjs` を全件実行: 127 PASS / 0 FAIL / 1 SKIP。`DIRECTOR_CONST` 15 項目が計画書 §6.2 の表と名前・値とも一致することを機械照合

---

## 2026-10-03 — [T18-04] 小節・境界・ラベル・種類・出力（⑥〜⑨、§4.3）

### 作業内容
- `js/songmap-analysis.js`: 計画書 §4.2 の⑥〜⑨（小節、境界、ラベル、展開の種類）を後半へ追記し、`buildSongMap` に `bars` / `sections` を接続。SongMap v1 の `validateSongMap` と各関数を Node テスト向けに公開
- `tests/unit/songmap-structure.test.mjs`: U18-05〜U18-09、U18-11 の単体テストを追加（合成曲は条件ごとにモジュール内で1回だけ生成）
- `tests/fixtures/songmap-128.json`: 128 BPM・48 kHz・seed 11 の SongMap v1 fixture を生成

### 検証
- U18-05 / U18-06 / U18-07 / U18-11 の focused run: 4件成功、約83ms
- 既存 `tests/unit/songmap-beats.test.mjs`: 8件成功、約8.65秒。U18-10 は bpm 119.75、beat F値 1.0000
- 128 BPM・48 kHz の予備測定: bpm 127.75、境界小節 [0, 8, 16, 32, 40, 56, 64]、kind 6/6、ラベル条件合格、`validateSongMap` ok
- 100 BPM・48 kHz: `K=3`、内部境界10個（候補 [8, 16, 24, 28, 32, 40, 44, 48, 52, 56]）となり、U18-08 の「境界5個・kind 6種」に不合格。100 BPM・44.1 kHz も内部境界7個で不合格
- 比較測定: 同じ100 BPM・48 kHz特徴列で `K=4` にすると境界 [0, 8, 16, 32, 40, 56, 64]。ただし §4.2 の `K=round(KERNEL_SEC/barSecA)` と `KERNEL_SEC=8` からは `K=3` であり、定数・擬似コードを変更せず停止
- `node --check`: js/tests の92ファイル成功。Chrome/ブラウザテストは追加ルールに従い未実行

### spec.md 変更（あれば）
- なし

### 備考
- 実装: Codex gpt-5.6-luna xhigh
- U18-08/U18-09 の全8条件 run は上記のSSOT不一致を検出した時点で停止（中断時のテスト実行時間は約119.9秒）
- レビュアー確認事項: §4.2 のK算出式を維持して100 BPMの追加境界を受け入れるか、`KERNEL_SEC`/擬似コード/受入基準のいずれを更新するかを決定してください

### レビューでの修正（Claude）
- 100BPM で境界過多（48kHz 内部境界 10 個、44.1kHz 7 個）の原因を調査。drop 内の 4 小節ごとの偽境界で、K = 3 小節のカーネルが 4 小節のコード進行1周を覆えないため。T16-04 のクロマ変更（ピークビンのみ）でコード変化の新規性が強まったことが背景
- アーキテクト判断で ⑦ の K 下限を `max(2, …)` → `max(4, …)` に変更し、計画書 §4.2 ⑦ と §10 を更新
- テストの不具合を修正: 正解境界の秒換算に存在しない `truth.barSec` を使い NaN になっていた（`synthSong` の戻り値の `barSec` を使うよう修正。判定基準は不変）
- 検証: `tests/unit/songmap-structure.test.mjs` 12 件すべて PASS（U18-05〜U18-09、U18-11。100/128/140BPM × 48k/44.1k と 174BPM の折り返しで境界・種類・ラベル合格）

---

## 2026-10-03 — [T16-10] 設定・UI（音量自動補正・レイヤー分割）

### 作業内容
- `js/settings.js`: `DEFAULT_SETTINGS` に `autoGain: false`・`layerSplit: 'linear'` を追加（計画書 §7。既定値のためゴールデン B15-04 は不変）。`settings-io.js` は既存の汎用処理で往復・旧形式 JSON の既定値補完に対応（変更なし）
- `index.html`: 「感度・形状」セクション先頭にチェックボックス「音量自動補正」（`chk-auto-gain`）、レイヤー数ボタンの下にセレクト「レイヤー分割」（`layer-split`: 均等 / 聴感。`group-layer-split`）を追加
- `js/ui-controller.js`: 2 項目の change ハンドラ、`_syncControlsFromSettings()` への同期（不正値は既定値扱い）、`_updateLayerSplitVisibility()`（layers 対応タイプかつ `layerCount >= 2` のときだけ表示。`_renderLayerSettings`・`_applyCapabilities` から呼ぶ）。ランダムボタンは 2 項目を変更しない
- `tests/browser/b16-07-09.test.js`（新規）: B16-07・B16-09
- `tests/unit/settings-io.test.mjs`: U15-01 に 2 キーの往復・旧形式・型不一致フォールバックを追加
- `doc/spec.md`（v2.12、2026-10-03）§10.2・§12.3、`README.md`

### 検証
- `node tests/run.mjs` 全件: 94 件 / 93 成功 / 0 失敗 / 1 スキップ（U15-00 異常系）。B15-04 ゴールデン・B16-05 合格。なお別のエージェントとの並行実行中の 1 回目で 1 件失敗が出たが、再実行（2 回）で再現せず全件成功
- B16-07: 10 秒時点の lastFreq 全ビン平均 — OFF: -30LUFS 14.74 / -10LUFS 68.22（差 53.48）、ON: 73.39 / 61.15（差 12.24）。差の縮小 77.1%（基準 70% 以上）
- B16-09: プリセット保存/読込、JSON 書き出し/読込、旧形式 JSON（2 項目なし）で既定値、UI 同期を確認
- 狭幅（375px）・広幅（1280px）の headless 表示: 横スクロールなし（documentElement.scrollWidth = 375）、追加コントロール幅 351px で収まる。layers 非対応タイプ（spectrogram）でレイヤー分割は非表示
- `node --check` 全 js/mjs 通過、`index.html` を `file://` で開いてコンソールエラー 0

### spec.md 変更
- §10.2 にレイヤー分割方式（均等 / 聴感）、§12.3 に音量自動補正を追記。version v2.12（v2.11 の次）、date 2026-10-03

---


## 2026-10-03 — U16-17 の計測を CPU 時間に変更

### 作業内容
- `tests/unit/mfs-extractor.test.mjs`: U16-17 の計測を実時間（`process.hrtime`）からプロセスの CPU 時間（`process.cpuUsage`、user + system）に変更。基準 ≤ 6 秒は不変
- 計画書 Phase 16 §9.1 U16-17 に計測方法を明記

### 検証
- `node tests/run.mjs --unit --filter U16-17`: PASS

### 備考
- T15-11 で単体とブラウザを並列実行にし、T18-04 の重い楽曲テストが加わったことで、ローカルの全件実行で U16-17 が実時間の伸びにより断続的に失敗していたため（単独実行・CI では合格）
- 実施: Claude（レビュアー）

---

## 2026-10-03 — [T15-11] テスト実行時間の短縮

### 作業内容
- `tests/lib/load-classic.mjs`: `vm.createContext` + ファイルごとの `runInContext` をやめ、全ファイルを 1 つの関数スコープに連結して `vm.runInThisContext` で評価する方式に変更（`globals` は仮引数、`get(name)` は同スコープの直接 `eval`、未定義は ReferenceError）。API `loadClassic(files, globals) -> { get, context }` は不変。トップレベル束縛と `Math` 等のグローバル参照がコンテキスト経由でなくなり、約 15 倍遅い問題を解消
- `tests/run.mjs`: 単体テスト（`spawnSync` → 非同期 `spawn`）とブラウザテストを並行実行。出力順（単体 → ブラウザ）・report.json・終了コードは不変。`--serial` で従来の逐次実行
- テストの assertion・閾値・サンプルレート・信号長・カバレッジは変更なし
- `doc/20260928-plan-phase15-test-foundation-and-frame-pipeline.md` §3.1・§3.2、`README.md` を更新

### 検証（CPU 時間 user 秒。測定時は他エージェントの実行でマシン負荷が高く、実時間は不安定だったため）
| ファイル | 変更前 | 変更後 |
|---|---|---|
| mfs-tempo | 143.4 | 14.4 |
| song-synth | 115.2 | 5.9 |
| mfs-extractor | 49.3 | 5.2 |
| mfs-onset | 5.4 | 0.7 |
| その他 13 ファイル | 各 0.15〜0.38 | 変更なし |
- 単体のみ（`--unit`）実時間 15.6 秒（65 件 / 64 成功 / 1 スキップ）。ブラウザのみ 50 秒（26 件）。全件（並行）53.7 秒・91 件 / 90 成功 / 0 失敗 / 1 スキップ（U15-00 異常系）、終了コード 0

### 備考
- 実装: Sonnet サブエージェント

---

## 2026-10-02 — [T18-03] 拍・格子・小節頭（①〜⑤）

### 作業内容
- `js/songmap-analysis.js`（新規・前半）: `SONG_CONST`（計画書 §4.1 の全定数）、`SongMapError`、共通ヘルパ `songZ` / `songCos` / `songPct`、段階関数 `songOdf`（①）・`songGlobalTempo`（②）・`songDpBeats`（③）・`songGridBeats`（④）・`songDownbeats`（⑤）、①〜⑤ の結果を返す `buildSongMap` の骨格（長さ判定 `too-short` / `too-long`、`no-rhythm`）。⑥〜⑨ と `validateSongMap` は T18-04 でファイル末尾の「後半」位置に追記する。`index.html` への読み込み追加は T18-05 以降（本チケットではアプリの挙動を変えない）
- `tests/unit/songmap-beats.test.mjs`（新規）: U18-01〜U18-04、U18-10（＋ ⑤ のクロマ経路と `buildSongMap` 骨格の確認）

### 検証
- `node --test tests/unit/songmap-beats.test.mjs`: 8 件成功、約 11.7 秒（うち U18-10 の 48kHz・60 秒の行生成が約 11.5 秒）
- U18-10: bpm 119.75、beatSource = dp、拍 F 値 1.0000（±70ms）
- 参考（テスト外の確認。synthSong の ①〜⑤ を 8 条件で実行）: 100/128/140BPM × 48k/44.1k は全て beatSource = grid、拍 F 値 0.998〜1.000、小節頭 98.5〜100%。174BPM は bpm = 87.00、拍 F 値 1.000（偶数/奇数の良い方）。解析時間（特徴抽出後）143〜380ms

### spec.md 変更（あれば）
- なし

### 備考
- 実装: Sonnet サブエージェント
- 2026-10-03: main（T18-02・T16-07・T16-09）をマージ。全件実行は 99 件中 97 成功 / 1 失敗 / 1 スキップ。失敗は U16-17（性能 ≤6 秒）で、他エージェント並行実行による負荷が原因（単独実行では 1.36 秒で合格）
- `songGridBeats(o, P, dpBeats, sampleRate)` の署名・戻り値 `{ beatHops, beats, beatSource, near }`（beats < 0 の拍は両配列から除く）を計画書 §4.2 ④ に反映（2026-10-03 T18-03 で明記）。sampleRate は必須（当初の任意引数案から変更）
- SSOT: `songmap-analysis.js` の `SONGMAP_ROW` フォールバックを削除し、`js/mfs-const.js`（T18-02）のグローバルのみを使用

---

## 2026-10-03 — [T16-11] デバッグ表示の MFS 項目

### 作業内容
- `js/debug-overlay.js`: `setMfsSource(engine)` / `recordFeatures(features, nowMs)` を追加。`MFS: <status>`、`BPM <値> (<信頼度>) locked|—`、`beat [###.....] n/4`、`LUFS M <値> S <値> AGC <値>dB`、`hops/s`、オンセットランプ `onset: L M H`（発生から 150ms 点灯）を表示。本文は 250ms ごとの更新時にだけ文字列を生成し、ランプは事前生成した 8 通りの文字列から状態変化時のみ DOM 更新（毎フレームの配列・オブジェクト生成なし）。本文とランプは別の子要素
- `js/visualizer-core.js`: `?debug=1` のときだけ overlay へ `audioEngine` を渡し、毎フレーム `recordFeatures(input.features, now)` を呼ぶ（無効時は従来どおり何もしない）
- `tests/browser/b16-10.test.js`（新規、`// @query debug=1`）: B16-10
- `README.md`: デバッグ表示の項目説明を更新

### 検証
- `--filter 'B16-10|B15-06|B15-04'`: B16-10、B15-06、B15-06b、B15-04（ゴールデン 66 ケース）合格
- `index.html` を `file://` で開き（`?debug=1` あり・なし）コンソールエラー 0

### spec.md 変更
- なし（計画書 §8: spec 更新 不要）

### 備考
- 実装: Sonnet サブエージェント
- フォールバック時は `MFS: fallback`、BPM / LUFS は `—` 表示

---

## 2026-10-03 — [T16-09] オフライン経路の統合

### 作業内容
- `js/offline-exporter.js`: `_captureFramesWorklet` を MFS プロセッサ（`mode: 'offline'`、チャンネル指定は §6.2 と同じ）に置き換え。`frame` メッセージを index 順に `freqFrames`（`computeFreqRange` スライス）・`timeFrames`・`frameTimesMs`（`i·1000/fps`）・`featureFrames`（packed）へ格納し、`done` で完了。ScriptProcessor 経路は残し `featureFrames = null`。`_renderAndEncode` は `MfsFrameView` を 1 つ構築して `setPacked` で差し替え、`pipeline.render` の input に `features`・`sampleRate`・`fftSize`（2048）を渡す（`getLayer` は `null`）。MFS 用ワークレットの生成に失敗した場合は従来経路へフォールバック
- `js/mfs-worklet.js`: オフラインのフレーム確定条件を `s_i ≤ totalSamples + 1` に変更（フレーム送出と入力終端のフラッシュの両方）。原因: 48kHz 素材を 44.1kHz のデバイスで復号すると長さが 220499 になり（実測。22.05kHz も 1 サンプル短い）、s_150 = 220500 > totalSamples で最終フレームが落ち 150 フレームになっていた（CI 失敗）。計画書 §6.3 の文言も更新
- `tests/browser/b16-08c.test.js`（新規）: B16-08c — 44.1kHz・totalSamples = 220499・fps 30 のワークレット単体で 151 フレーム（デバイスレート非依存）
- `tests/browser/b16-06.test.js`（新規）: B16-06
- `tests/browser/b16-06b.test.js`（新規）: B16-06b（デコーダー方式）・B16-06c（シーク方式）。MediaRecorder で赤キャンバス + オシレーター音声の WebM を作り、動画合成有効で書き出し。state done、フレーム数 = floor(長さ×fps)+1 ±1、render の features 非 null、`_drawCompositeVideoFrame` の呼び出し回数と描画後の画素が赤であることを確認
- `doc/spec.md`（v2.11、2026-10-03）§14.8.3、`README.md`: 解析粒度がライブと同一になった旨

### 検証
- `node tests/run.mjs` 全件: 75 件中 74 成功相当（初回実行で B16-06 のみ失敗＝アプリページのライブ描画ループの render も数えていたテスト側の誤り。書き出し側の固定 dt のみ数えるよう修正し、`--filter 'B16-06|B15-02|B15-05'` で 3 件成功を確認。他 72 件は初回実行で成功、U15-00 異常系のみ SKIP）
- B16-06: featureFrames/freqFrames/timeFrames/frameTimesMs = 151 件、フレーム 0 の packed 全 0、render 151 回すべて features 非 null。B15-02（90±1）・B15-05・B15-04 ゴールデンも合格
- 全件再実行: 77 件 / 76 成功 / 0 失敗 / 1 スキップ（U15-00 異常系）。B16-06b・B16-06c 合格（動画合成の両方式で実行）
- `node --check` 全 js 通過、`index.html` を `file://` で開いてコンソールエラー 0

### spec.md 変更
- §14.8.3 に Phase 16 以降の解析経路（ライブと同一の解析コード、フォールバック時は音楽特徴なし）を追記。version v2.11、date 2026-10-03（T16-07 の v2.10 の次）

### 備考
- 実装: Sonnet サブエージェント
- `js/analysis-worklet.js` は `index.html`（T16-07 の担当範囲）に script タグが残るため削除せず、未使用のまま残置

---

## 2026-10-01 — [T16-07] ライブ経路の統合

### 作業内容
- `js/audio-engine.js`: MFS AudioWorklet を主経路に統合（計画書 §6.2）。グラフ `source → analyser → destination`（従来）に加え `source → mfsNode → silentGain(0) → destination`。`mfsStatus`（`initializing` / `active` / `fallback`）。AudioWorklet 非対応・`window.__avzForceMfsFailure === true`・`addModule`/ノード生成の例外・`onprocessorerror`・ウォッチドッグ（`LIVE_WATCHDOG_SEC` 秒ホップなし）で `fallback`（`console.warn` のみ、戻らない）。ホップは 32 件のリングへ蓄積し、`captureFrame(nowPerfMs)` で `getOutputTimestamp()`（無効時は `currentTime - baseLatency - outputLatency`）から出力時刻を求めて `t <= target` の最新ホップを選択。フラグ（onset / beat / downbeat）は「前回選択より後〜今回選択以下」のホップの OR に集約し、同じホップの再選択では 0（二重発火なし・リング内 packed は不変）。`getFreqSlice` / `getTimeDomainData` / `getFeatures` / `getMfsDebugInfo`（同一オブジェクトを使い回す）/ `resetAnalysis` / `setSmoothing`（AnalyserNode と smoothing メッセージ）。`connectMedia` / `connectStream` は MFS ノードへも接続して `resetAnalysis()`。ホップ番号が戻ったら（reset 前の未着メッセージ後に reset 後のホップが来た場合）リングを破棄
- `js/visualizer-core.js`: `captureFrame(now)`、`input.getLayer = null`、`features` / `sampleRate` / `fftSize` を FramePipeline へ渡す
- `js/ui-controller.js`: `resetAnalysis()` をシーク `input`、停止ボタン（`mediaManager.stop()` の直後）、`_applyActiveSlot()` 先頭で呼ぶ（読込完了後は `connectMedia` と `_applyActiveSlot` で呼ばれるため `_loadMediaFile` 内の重複呼び出しは置かなかった）
- `index.html`: 変更なし（スクリプト順は T16-05 で対応済み）。`js/mic-input.js`: 変更なし（`connectStream` 経由で MFS に接続される）
- `tests/browser/b16-live.test.js`（新規）: B16-02、B16-02f（フラグ集約・二重発火なし・リセット・ホップ番号の戻り）、B16-02m（フェイクマイクで active とホップ受信）、B16-03（フォールバック。共有ページの AudioEngine を汚さないよう新規 AudioEngine / VisualizerCore で実施）、B16-04（シーク・スロット切替・停止。T16-05 から持ち越した reset の実時間確認を兼ねる）
- `tests/browser/b15-07.test.js`: AudioEngine スタブに `getFeatures()`（null を返す）を追加。VisualizerCore が呼ぶ新メソッドへの追従のみ（閾値・アサーションは不変）
- `doc/spec.md`（v2.9 → v2.10）§9.1〜9.3・§19.2・§19.5、`README.md`

### 検証
- `node tests/run.mjs`（ブラウザ込み全件）: 79 件中 78 成功 / 0 失敗 / 1 スキップ（U15-00 異常系は想定どおり）。B15-03（14 タイプ）・B15-04（ゴールデン 66 ケース、基準値未変更）・B16-05・B16-01 も合格
- B16-02: 10〜12 秒の BPM が 120 ± 1.5% 内、受信ホップ数/秒 約 94
- B16-04: シーク・スロット切替・停止の 200ms 後の `lastHop` は操作前（100 超）より小さく 30 以下
- 補助確認: 一時停止中もホップは届き続ける（約 94/秒）ためウォッチドッグの誤検知なし。ヘッドレス Chrome の `getOutputTimestamp()` は contextTime が currentTime より約 32ms 遅れた値を返す（出力遅延補正が効いている）
- 全 `.js` / `.mjs` で `node --check` 合格。`index.html` を `file://` で開いてコンソールエラー 0

### spec.md 変更
- v2.10: §9.1（AudioWorklet 解析・自動フォールバック・ライブ/オフライン同一コード）、§9.2（音楽特徴）、§9.3（約 94 回/秒・出力遅延補正・解析リセット）、§19.2 / §19.5。理由: 計画書 §10・§1.1 のとおり、ユーザーから見える描画タイミング（10〜40ms 遅れ）と解析方式が変わるため

### 備考
- 実装: Sonnet サブエージェント
- 計画書 §9.3 の手動確認（実楽曲 3 曲以上での BPM、10 分連続再生、体感の遅れ・カクつき）は実施していない（実楽曲・長時間再生・人手の体感が必要）

---

## 2026-10-02 — [T18-02] ワークレット songmap モード

### 作業内容
- `js/mfs-const.js`: `SONGMAP_ROW`（FLUX 0 / BANDS 4 / CHROMA 36 / ENERGY 48 / LENGTH 49。計画書 Phase 18 §3）を追加し `module.exports` に含めた
- `js/mfs-worklet.js`: `processorOptions.mode = 'songmap'`（`totalSamples` 必須）を追加。ホップ完了ごとに 1 行（`ex.flux` 4 + BANDS 32 + CHROMA 12 + `hopEnergy` 1）を constructor で確保した 256 行ぶんのバッファへ積み、256 行ごとに `{type:'rows', startHop, count, data: Float32Array(count*49)}`（transfer）を送る。入力終端で残りを送ってから `{type:'done', hops}`。ワークレットソースに `SONGMAP_ROW` と定数 `MFS_SONGMAP_BATCH = 256` を埋め込む。process() 経路の配列生成は送信時の `slice` のみ（メッセージ用の許可例外）。live / offline の挙動は変更なし
- `tests/lib/songmap-rows.mjs`: `SONGMAP_ROW` のローカル代替定義を削除し `get('SONGMAP_ROW')`（mfs-const.js）に一本化（SSOT）
- `tests/browser/b18-worklet.test.js`（新規）: B18-01a（`synthSong(48000, {bpm:128})` の行データがページ内 MfsExtractor 直接駆動と最大絶対差 1e-6 以内、行数 = ホップ数、startHop 連続、途中メッセージは 256 行、`done.hops`）、B18-01b（端数サンプルの短い信号で rows 1 通 + done）

### 検証
- `node tests/run.mjs`: 82 件中 81 成功 / 0 失敗 / 1 スキップ（U15-00 異常系は想定どおり）。B16-01・B16-08・B16-08b、B15 系も合格
- 全 `.js` / `.mjs` で `node --check` 合格

### spec.md 変更（あれば）
- なし

### 備考
- 実装: Sonnet サブエージェント
- SongMapService（T18-05）がこのメッセージ形式を利用する

## 2026-10-01 — [T18-01] テスト用合成楽曲・行データ生成

### 作業内容
- `tests/shared/song-synth.js`（新規）: `synthSong(sampleRate, { bpm = 128, seed = 11 })`（計画書 §8.1 の手順・乱数消費順どおり。64 小節・6 セクション、ピーク 0.9 に正規化、`truth` 付き）と `synthTempoChange(sampleRate)`（120BPM 30 秒 → 126BPM 30 秒。U18-10 用に拍の真値 `truth.beats` を追加）
- `tests/lib/songmap-rows.mjs`（新規）: `songmapRows(signal)`。Node 上の `MfsExtractor` を 128 サンプルずつ駆動し、ホップ完了ごとに §3 の配置（FLUX 4 / BANDS 32 / CHROMA 12 / ENERGY 1 = 49）の行を作る。`SONGMAP_ROW` は §3 の表どおりにテスト内で定義（`js/mfs-const.js` に `SONGMAP_ROW` が入れば自動でそちらを使う。T18-02 で置き換わる）。アプリ本体は変更していない
- `tests/unit/song-synth.test.mjs`（新規）: U18-S01〜S06（決定性・truth・長さ・ピーク・行数 = ホップ数）

### 検証
- `node tests/run.mjs`: 77 件中 76 成功 / 0 失敗 / 1 スキップ（U15-00 異常系は想定どおり）
- U18-S01: 2 回生成で L/R ビット一致、U18-S06: 行データも 2 回でビット一致・全値有限

### spec.md 変更（あれば）
- なし

### 備考
- 実装: Sonnet サブエージェント
- 合成は Node の vm 上でやや遅い（48kHz・120 秒で約 20 秒）。U18-08 で全 6 条件を生成する際の所要時間に注意

## 2026-10-01 — [T16-05] ワークレット

### 作業内容
- `js/mfs-worklet.js`（新規）: `MFS_PROCESSOR_SOURCE`（`MfsProcessor` のソース文字列）、`buildMfsWorkletSource()`、`createMfsWorkletUrl()`（計画書 §2.2・§6.1・§6.3）。data: URL 方式で `file://` 直開きでも動く。live は hop ごとに `{type:'hop', hop, t, f, freq, time}`（`t = (currentFrame + hopEndSample - ブロック先頭までの入力数)/sampleRate`、3 配列は transfer）、offline は §6.3 の規則で `{type:'frame', index, hop, t, f, freq, time}` と `{type:'done'}` を送る。`reset` / `smoothing` メッセージに対応。`process()` 経路は配列・オブジェクトを生成しない（メッセージ用配列のみ許可例外）
- `index.html`: `fft.js` を `analysis-worklet.js` の前から MFS ブロックの先頭へ移動し、`mfs-dsp` → `mfs-onset` → `mfs-tempo` → `mfs-extractor` → `mfs-worklet` を計画書 §2.1 の順で追加（ハーネスが index.html の script 順から作られるため）。コメントを更新
- `tests/browser/b16-worklet.test.js`（新規）: B16-01（offline 30fps、ドラム 10 秒。ページ内 MfsExtractor 直接駆動 + §6.3 の規則で独立に組んだ期待値と比較）、B16-08（offline フレーム数・index・hop・done）、B16-08b（live の hop 番号・時刻・配列長）

### 検証
- `node tests/run.mjs`: 74 件中 73 成功 / 0 失敗 / 1 スキップ（U15-00 異常系は想定どおり）。B15-02（オフライン書き出し）・B15-04（ゴールデン）も合格
- B16-01: packed 最大絶対差 ≤ 1e-6、freq/time バイト一致、フレーム 301 件
- `index.html` を `file://` で開いてコンソールエラー 0

### spec.md 変更
- なし

### 備考
- 実装: Sonnet サブエージェント
- reset / smoothing メッセージの実時間での挙動は OfflineAudioContext ではメッセージ到着順が不定のため、T16-07 の B16-04 で確認する
- offline フレームの `t` は出力フレーム時刻（`s_i / sampleRate` 秒）とした（計画書に明記なし）

## 2026-10-01 — [T16-04] 統合抽出器（ステレオ・音色・クロマ・ラウドネス含む）と校正の確認

### 作業内容
- `js/mfs-extractor.js`（新規）: `MfsExtractor`（計画書 §5.0〜§5.9）。§5.9 の順で処理し `MFS_LAYOUT` の全フィールドを書く。自己完結、ホップ処理で配列・オブジェクトを生成しない。テスト用 getter `tauHop` を追加。クロマはアーキテクト決定（2026-10-01、§5.7 改訂）に従いスペクトルの山の頂点のビンのみ加算
- `js/mfs-const.js`: `EVENT_LATENCY_FFT_FRACTION` 0.45 → 0.316（計画書 §3 の更新に合わせた。校正）
- `tests/shared/signals.js`: `sigScaleToLufs(buf, targetLufs)` を追加（`MfsBiquad.kWeighting` を使用）
- `tests/unit/mfs-extractor.test.mjs`（新規）: U16-09〜U16-17。実物の `js/mfs-tempo.js` を読み込む（先行用スタブ `tests/stubs/` は削除）
- `tests/unit/mfs-dsp.test.mjs`: `eventLatencySec` の期待値を 0.316 に更新（定数の変更に追従。閾値の緩和ではない）

### 検証
- `node tests/run.mjs`: 71 件中 70 成功 / 0 失敗 / 1 スキップ（U15-00 異常系は想定どおり）
- U16-06（校正）: ノイズなし全条件の符号付き平均誤差 48kHz = +3.89ms、44.1kHz = +5.01ms（0〜+8ms 内）。中央値 最大 14.7 / 16.3ms、p95 最大 18.7 / 21.6ms（基準 20 / 35ms）
- U16-05 全条件合格（最大誤差 0.36%、スイープ 70/70・最大 0.31%）、U16-07 再追従 5.05s / 5.48s、U16-08 downbeat 全テンポ 100% 一致（最大ずれ 15ms）
- U16-11: 48kHz / 44.1kHz とも正弦波・和音合格（和音: 48k C 0.98 E 1.00 G 0.97）
- U16-12: -19.993 / -19.990、-3.010 / -3.007 LUFS。U16-16: AGC_DB 15.89 (期待 16.01)、-3.97 (期待 -3.99)。U16-17: 60 秒 = 2.93 秒
- 校正（ONSET_K=2.0・ONSET_DELTA=0.02 は 7 組の掃引で変更不要、AGC_TARGET_LUFS=-14 も変更不要）。TEMPO_MIN_CONF・PLL_GAIN は U16-05〜08 合格のため変更なし

### spec.md 変更
- なし（振る舞いの変更なし）

### 備考
- 実装: Sonnet サブエージェント
- アーキテクト決定: クロマ（§5.7）をピーク頂点のみに変更、EVENT_LATENCY_FFT_FRACTION=0.316（計画書 7d28a1f）
- `loadClassic`（vm コンテキスト）は `Math` 等の参照が約 15 倍遅いため、U16-17 のみ `vm.runInThisContext` で測定

---

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
---

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
