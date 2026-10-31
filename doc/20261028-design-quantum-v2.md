# g-quantum 設計 v2 — 実写のレンズの質感で描く、量子のビジョンのモンタージュ

v1（doc/20261024-design-visions-v1.md §3「殻・弧・火花の点群」）を置き換える。v1 は CG らしさが強く、実写の質感が出ていなかった。
v2 は、試作を重ねて決めた見た目を、そのままエンジンへ移す。
試作と同じ見た目になることが受け入れ条件。式・定数・色は本書と付属のシェーダー本文のとおりに実装し、勝手に変えない。

## 0. 根拠と経緯

### 0.1 参照
- 公開されている VFX 制作資料の画像 11 枚と、動画 8 本のストーリーボード（約 700 コマ）を集めた。中心は量子のビジョンの場面。
- 制作の事実: 量子のビジョンは CG を使わず、実写の素材だけで作られた。特殊効果の工房で 400 以上の実験をした（回転するビーズ、テルミットの火、水中のインク、長時間露光など）。
- 光の糸の束・金の渦・流体・二つの球・星雲・水面の場面は、参照に使わない。

### 0.2 構造
- ひとつの絵ではなく、寒色と暖色の場面が入れ替わるモンタージュ。
- どの場面も実写のレンズの質感でできている: 浅いピントの大きなぼけ、長時間露光の光跡、細かい粉、フィルムの粒子とにじみ。硬い輪郭や幾何学的な形は使わない。

### 0.3 決定事項（2026-10-28）
- 水面（雨の波紋）の場面は入れない。
- カメラは動かす。最初の案は動きがカクカクして見え、ダイナミックさもなかった。原因は 2 つあった。フィルム粒子が 24 fps で量子化されていたことと、カメラの動きが小さすぎたこと。そこで、前進・視差・放射状の動きのぶれ・手前の塵・回転を入れた。

### 0.4 試作での実測（1280×720、128 BPM のテスト曲 14〜44 秒）
- 拍のフレームでは画面の平均輝度が 13.1 上がる。拍以外のフレームの変化は約 ±3.8。
- 前後のフレームの差の中央値は 7.9。静かな区間でも約 4.5 ある。

## 1. 場面（シェーダーの `scene` 番号）

| 番号 | 場面 | 参照 | 拍の反応 | カメラ（§6.3） |
|---|---|---|---|---|
| 0 | 青緑の闇に漂う塵とぼけ | 5・6 | ぼけが瞬く | 前進のみ |
| 4 | 青い粒子の光跡（2 本の柱） | 7・8 | 光跡が明るむ | 流れを追って振り上げる |
| 6 | ミントの光（露出の飛んだ淡い緑） | 15 | （全体の露出） | 横に流れる |
| 1 | 白い核を包む金の粒子殻 | 1 | 殻が膨らみ、核が光る | 遠くから寄りながら回り込む |
| 3 | 火花の噴出と金のぼけ | 4・12 | 噴出が強まる | 噴出へ突っ込む |
| 2 | 泡の浮く太陽面 | 11 | 泡が明るむ | 表面を横へなめる |

番号 5 は欠番（水面。不使用）。

## 2. 定数 `WORLD_QUANTUM`（js/world/g-quantum.js）

v1 の定数・表（`WORLD_QUANTUM_SCENES`、`WORLD_QUANTUM_CAMERA`、`worldQuantumSceneWeights`、`worldQuantumShellFactor` など）はすべて削除し、次に置き換える。

```js
const WORLD_QUANTUM = Object.freeze({
  FADE: 2.5,                     // 場面の切り替えにかける秒数（次の場面の開始時刻の FADE 秒前から溶かし始める）
  MINT_LEAD: 3,                  // drop の直前の build で、最後のこの秒数をミントの光にする
  DROP_SPLIT: 3,                 // drop 区間を 3 等分して、殻 → 火花 → 太陽面
  CAM_BASE: .14, CAM_LOUD: .5, CAM_PUSH: .45,   // 前進の速さの目標 = CAM_BASE + CAM_LOUD*loud + CAM_PUSH*push（層/秒）
  CAM_TAU: .35,                  // 速さが目標へ追いつく時定数（秒）
  PUSH_ATTACK: .08, PUSH_RELEASE: .6,           // 拍の押し出しの立ち上がりと減衰の時定数（秒）
  PAN_RATE_X: .23, PAN_X: .05, PAN_X_LOUD: .2,  // 横のパンの速度 = sin(t*PAN_RATE_X)*(PAN_X+PAN_X_LOUD*loud)
  PAN_RATE_Y: .17, PAN_PHASE_Y: 1, PAN_Y: .04, PAN_Y_LOUD: .14,
  ROLL_SWAY: .25, ROLL_SWAY_RATE: .09, ROLL_RATE: .02,   // 回転 = ROLL_SWAY*sin(t*ROLL_SWAY_RATE) + ROLL_RATE*t
  // 音の状態（テッセラクトと同じ。§5）
  LEVEL_ATTACK: .048, LEVEL_RELEASE: .26, LOUD_ATTACK: .065, LOUD_RELEASE: .4, LOUD_LO: .33, LOUD_HI: .93,
  AGE_MAX: 9, REFRACTORY: .12, BEAT_HOLD: 2,
  EXPOSURE: 1.47,                // 試作の後処理（ACES の前に ×1.1）と、エンジンの後処理（×.75）の差を埋める
  VIGNETTE: .4,
  GRAIN: .035,                   // フィルム粒子（後処理で毎フレーム更新。§7）
  HALATION: .25,                 // 明るい所のまわりの暖色のにじみ（後処理。§7）
  BLOOM_THRESHOLD: .02, BLOOM_STRENGTH: .55
});
```

## 3. 色（sRGB。JS で worldSrgbToLinear してから GLSL の定数配列にする）

参照フレームの k-means による実測。

| 名前 | 値 |
|---|---|
| TEAL | #1D5953 #266B61 #44A69B #3B796E #A3D3BE #1A6287 #39A1B8 #93B0BA |
| TEAL_BG | #041104 #06150D #071515 #08212A |
| SHELL | #72470B #885206 #9F6105 #B87405 #D18D05 #CABBA5 |
| SUN | #7B4402 #884B01 #935601 #9F6401 #AE7C01 #BE9715 #DBCC97 |
| SPARK | #A33C09 #B95113 #D47228 #E89B51 #F9D289 |
| GOLDB | #8C5522 #A56C2D #C48939 #DCA954 #EDC67C |
| STREAK | #285668 #457688 #719FAD #B3DEDA #155792 #3785BE #5FA0D2 |
| MINT | #A7ECCD #B3F0CF #C1F0C4 #CAF3CE #3A5148 |

## 4. シェーダー

### 4.1 ヘッダー（この順に並べる）
```glsl
#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 frag;
uniform vec2 res;               // 描画先の幅・高さ（画素）
uniform float time;             // 曲の時刻（秒）
uniform int scene; uniform int sceneB; uniform float mixW;   // 今の場面、次の場面、溶かす量（0..1）
uniform float camZ; uniform float tA; uniform float tB;       // 前進量（層）、今の場面と次の場面の経過秒
uniform float camV; uniform vec2 camPan; uniform float camRoll;
uniform vec4 lvl; uniform vec4 sm; uniform vec4 age; uniform float loud;
const float EXPOSURE=...; const float VIGNETTE=...;
const vec3 TEAL[8]=vec3[](...); const vec3 TEAL_BG[4]=...; const vec3 SHELL[6]=...; const vec3 SUN[7]=...;
const vec3 SPARK[5]=...; const vec3 GOLDB[5]=...; const vec3 STREAK[7]=...; const vec3 MINT[5]=...;
```

### 4.2 本文
付属の `doc/20261028-quantum-v2-shader.glsl` の本文を、そのまま使う（`uint hu(` から最後の `sceneOf` の終わりまで）。
これは試作から水面の場面を除いたもので、変更点は次の 1 か所だけ。
- `main()` の最後の `frag=vec4(c,1.);` を `c*=1.-VIGNETTE*dot(ndc*.8,ndc*.8); if(any(isnan(c))||any(isinf(c)))c=vec3(0.); frag=vec4(min(c,vec3(60.))*EXPOSURE,1.);` にする。`ndc` は `vec2 ndc=gl_FragCoord.xy/res*2.-1.;`。

`main()` は `gl_FragCoord` を使う（エンジンの描画先の大きさ = `res`）。

## 5. 音の状態（`step(input)`）

g-tesseract v2（doc/20261027-design-tesseract-v2.md §5）と同じものを使う。帯域群の lvl・sm、全体音量 loud、立ち上がり（拍があるあいだは拍で 4 群、拍が BEAT_HOLD 秒ないときだけ帯域ごとの立ち上がり、preview では拍格子と小節頭、REFRACTORY）、age を作る。
共通化はしない（テッセラクトのコードは変えない）。g-quantum.js に同じ処理を書く。energy・cen・phase は使わないので作らない。

## 6. カメラと場面の進行（`step(input)` の続き）

### 6.1 前進・パン・回転（毎ステップ、dt = input.dt、t = input.tSec）
- `hit` は、このステップで群 0 が立ち上がったときに 1、それ以外は 0。
- `push += (hit-push)*(1-exp(-dt/τ))`。τ は `hit>push` なら PUSH_ATTACK、それ以外は PUSH_RELEASE。
- `target = CAM_BASE + CAM_LOUD*loud + CAM_PUSH*push`。`v += (target-v)*(1-exp(-dt/CAM_TAU))`。`camZ += v*dt`。
- `panX += sin(t*PAN_RATE_X)*(PAN_X+PAN_X_LOUD*loud)*dt`。`panY += cos(t*PAN_RATE_Y+PAN_PHASE_Y)*(PAN_Y+PAN_Y_LOUD*loud)*dt`。
- `camRoll = ROLL_SWAY*sin(t*ROLL_SWAY_RATE) + ROLL_RATE*t`。
- シェーダーへは camZ、camV = v、camPan = (panX, panY)、camRoll を渡す。
- `reset()` で camZ・v・push・panX・panY を 0 に戻す。

### 6.2 場面の予定表
曲（`engine.score`）が変わったときに 1 回だけ作る。`[開始秒, 場面]` を並べた配列で、曲の区間（`score.sections`）から次のとおり作る。

| 区間の kind | 並べる場面 |
|---|---|
| intro | 0 |
| build | 4。次の区間が drop なら、区間の終わりの MINT_LEAD 秒前から 6 |
| drop | 区間を DROP_SPLIT 等分して 1、3、2 |
| break | 前半 0、後半 4 |
| main | variation が奇数なら 1、偶数なら 2 |
| outro | 0 |

- 直前と同じ場面が続くときは並べない（同じ場面のまま続く）。
- 配列は `Float64Array` などで確保して再利用する。step では作らない。

### 6.3 今の場面と溶かす量（毎ステップ）
- 予定表で `start <= t` を満たす最後の行を i とする。`sA = 場面[i]`、`sB = sA`、`w = 0`。
- 次の行があり、`t > start[i+1] - FADE` なら `sB = 場面[i+1]`、`x = (t-(start[i+1]-FADE))/FADE`、`w = x*x*(3-2x)`。
- `tA = t - start[i]`、`tB = t - (start[i+1]-FADE)`（次の行がなければ 0）。
- 場面ごとのカメラ（シェーダーの `camera()`）は tA・tB で動く。予定表が試作の固定の時刻表に代わるだけで、場面の中の動きは試作と同じ。

`statelessRender = true` のまま（GPU の履歴は持たない）。renderAt は時刻 0 から全ステップを進めるので、状態は決定的になる。

## 7. 後処理（js/world/post.js の quantumMode 枝）

試作の後処理に合わせる。
```glsl
 if(quantumMode>.5){
  vec3 b0=texture(bloom0,vUv).rgb,b1=texture(bloom1,vUv).rgb,b2=texture(bloom2,vUv).rgb,b3=texture(bloom3,vUv).rgb;
  vec3 bloom=b0*.25+b1*.25+b2*.30+b3*.45;
  vec3 c=texture(scene,vUv).rgb+bloom*QUANTUM_BLOOM_STRENGTH;
  c+=vec3(1.,.32,.08)*QUANTUM_HALATION*max(dot(b2,vec3(.33))-.05,0.);   // ハレーション（暖色のにじみ）
  c=aces(c*.75);
  // フィルム粒子: 毎フレーム変わる（grainFrame は整数のフレーム番号）。暗部にも明部にも少し
  float g=float(hash(uvec3(gl_FragCoord.xy,uint(grainFrame))))-.5;   // hash は 0..1
  c+=g*QUANTUM_GRAIN*(.3+c);
  c=mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));
  frag=vec4(c,1.);return;
 }
```
- `QUANTUM_HALATION`、`QUANTUM_GRAIN` は WORLD_QUANTUM.HALATION、GRAIN から作る GLSL 定数。
- `grainFrame` は WorldPost の uniform（int）。WorldEngine が `_draw()` で `Math.round(latestSec*60)` を渡す（拍子に依存しない、毎フレーム変わる値）。
- `hash` はシェーダー内に書く 32bit の整数ハッシュ（試作の `hu` と同じ混ぜ方で、`(x*1973)^(y*9277)^(frame*26699)` を `hu` に通して 0..1）。

## 8. 配線
- `js/world/g-quantum.js` を本書のとおりに書き換える。クラス名・id（`g-quantum`）・label（量子のビジョン）は変えない。キーは 3（2026-10-30 に振り直し）。
- UI に戻す: `WORLD_ANALYZER_TYPES` の g-quantum を `available: true` にし、`js/renderer-registry.js` の UI 一覧に戻す（テッセラクトの次）。
- 影響するテスト（GPU タイプ一覧、キー割り当て、integration の GPU ID）を、v2.24 のとき（量子のビジョンが選べた状態）に戻す。

## 9. テスト（tests/unit/world-quantum.test.mjs を書き換え）
- 定数・色: 表の値、色の linear 変換、シェーダーに場面の関数（sceneDust、sceneShell、sceneSun、sceneSparks、sceneStreams、sceneMint）があり、水面（sceneRipples、WATER）が無いこと。
- 予定表: intro→0、build→4（drop の前なら最後の 3 秒が 6）、drop→1・3・2 の 3 等分、break→0・4、main の variation、outro→0、同じ場面が続かないこと。
- 溶かし: 境目の FADE 秒前から w が 0→1 へ連続して変わり、境目で w=1、次のステップで sA が次の場面になって w=0 に戻ること（画面としては連続）。
- カメラ: camZ が単調に増える。拍の直後に v が増え、0.6 秒の時定数で戻る。60 fps で 60 秒進めたとき、1 ステップの camZ の増分の最大と最小の比が 10 未満（跳ばない）。
- 音の状態: テッセラクトと同じ項目（立ち上がり・二重カウントなし・REFRACTORY・BEAT_HOLD・preview）。
- 後処理: post の quantum 枝に grainFrame とハレーションがあること。
- 量子のビジョンが available:true で UI 一覧に出ること。キー 3 で選べること。
- GL モック: init/step/render が通り、step で新しい配列を作らない。

## 10. 検証
- 実 GPU の Chrome で world ハーネスの renderAt を撮り、試作の同じ場面と比べる。
- 実曲で連続フレームを撮り、拍での平均輝度の上昇と、前後のフレームの差を測る（§0.4 と比べる）。
- 1920×1080 の GPU 時間を測る。重い場合（p95 が 12 ms を超える場合）は、火花の本数などを設計を直して減らす。

## 11. 実機での調整（2026-10-29、M4 Max・Chrome ヘッドレス・ANGLE Metal・1920×1080）
§1〜§8 の値のうち、次をこの節で上書きする。

### 11.1 性能（本体の基準 p95 ≤ 16 ms。§10 の 12 ms は試作の時点の目標）
最初の組み込みでは p95 が 44〜227 ms だった。次の順で下げた。
- **場面ごとの program：** `#define QSCENE <場面番号>` を置き換えて、場面ごとに program を作る（`worldQuantumSceneSource`）。全場面を 1 本のシェーダーにまとめていたときは、火花の場面だけ GPU 時間が 3 倍になった。コードが大きくなりすぎたことが原因で、部品を 1 つ外すだけで 7 ms に戻った。
- **内部解像度：** `RENDER_SCALE` .67 で描き、拡大用のシェーダーで出力の大きさへ線形補間する（ブラックホールと同じ方式）。
- **線と点の幅：** 単位 `PX = max(1/PXREF, PX_MIN/res.y)`。`PXREF` 1440 は試作の内部解像度（720p の 2 倍で描いて縮めていた）、`PX_MIN` は .5。下限で太らせた分は、明るさを `PXE = 1/(PXREF*PX)` 倍にして補う。
- **火花：** 軌道を CPU で毎フレーム計算する（`worldQuantumSparks`）。3 群 × `SPARK_COUNT` 128 本。試作の `sparks2` の引数のまま（`WORLD_QUANTUM_SPARK_BURSTS`）。
  - 線分と性質は float テクスチャ（384×2）で渡す。
  - 火花は升目（`SPARK_GRID` 48²、`CELL` .1、範囲 [-2.4, 2.4]²、`MARGIN` .03）に登録し、1 升あたり最大 `SPARK_GRID_CAP` 32 本。画素は自分の升に登録された火花だけを見る（`worldQuantumSparkGrid`）。
  - 色は分岐なしの 3 段の `mix` で決める。GPU では、分岐と途中の `continue` のほうが遅かった。
- **溶かし：** GPU の blend で重ねると 6 倍遅くなった。そこで 2 つの場面を別々の描画先へ描き、拡大のシェーダーで `mixW` の割合で混ぜる。後段の処理は線形なので、1 本のシェーダーで `mix` するのと同じ絵になる。溶かしの 2.5 秒の間は 2 場面とも `FADE_SCALE` .5 で描く。
- **乱数：** 1 回のハッシュを 8 ビットずつ 4 つに分ける `h4` を使う。低周波のノイズ（`clump`・火の歪み・光跡の揺れ）は 3 オクターブの `fbm3` にする。
- **火花の場面のぼけ：** 発生点のまわりの金のぼけの層を 5 から 3 に減らす。

結果（240 フレームの p95、ms）は次のとおり。

| 場面 | 計測した時刻（秒） | p95 |
|---|---|---|
| 塵 | 5 | 10.5 |
| 光跡 | 13〜20 | 11.7〜12.1 |
| ミント | 26 | 9.8 |
| 殻 | 33 | 10.0 |
| 殻 → 火花の溶かし | 38 | 14.4 |
| 火花 | 41・90 | 14.1・14.5 |
| 太陽面 | 53・58 | 6.8・9.8 |
| ブレイク・2 回目の drop | 74 | 11.6 |
| 終わり | 104 | 11.2 |

### 11.2 見た目
- **光跡の柱の NaN：** 光跡の柱と横の帯の式は `pow(x, 2.)` を使っていた。x が負だと結果は未定義で NaN になり、NaN を消す行がその画素を黒にしていた。試作ではたまたま通っていた。`sq(x) = x*x` に置き換えた。
- **カメラ（区間が長くても外れないよう、上限のある動きにする。`sat = 1 - exp(-ts/6)`）：**
  - 光跡：`rot(.25*sin(camRoll) + .12*sin(ts*.3)) * (uv + (0, -.35 + .5*(1 - exp(-ts/5))))`
  - 殻：`/(.75 + .6*sat)`
  - 火花：`/(.8 + .6*sat)`
  - 太陽面：`uv/(1 + .3*sat) + (.8*sat - .35, .18*sat)`
  - 寄りの上限は約 1.35〜1.4 倍で、試作の場面の長さ（数秒）で見えていた寄りと同じ。
- **ミントの場面：** 火花（`sparks2`）を、光跡の場（`dashField`）に置き換えた（性能のため）。
- **火花の場面：** 3 群の火花は、§11.1 の方法で試作どおりに戻した。途中で一時的に足した `dashField`（`seed` 85）は残している。

### 11.3 拍への反応（実曲 14〜46 秒をエンジンで 30 fps 撮影）
- 拍のフレームでは平均輝度が +14.0 上がる。それ以外のフレームの変化は ±3.8 だった（試作は 13.1）。
- 前のフレームとの差の中央値は 11.3（試作は 7.9）。
