# g-attractor（ストレンジアトラクター）設計 v1

- 作成：2026-10-08。設計は Opus、実装は Codex。
- 状態：SSOT（実装はこの文書に従う）。
- 前提：
  - オーナーは、4 案のモックアップの中から「4 ストレンジアトラクター」だけを選んだ。
  - モックアップ：`~/worktrees/avz-tools/mock/mockups.png` の右下と、`attractor3d.png`。
  - 分析スクリプト：`~/worktrees/avz-tools/attractor/survey.mjs`、`robust.mjs`。

## 0. 調査結果（Opus の数値実験。実装の前提）

1. **Clifford 写像** `x' = sin(a·y) + c·cos(a·x)`、`y' = sin(b·x) + d·cos(b·y)` で検証した。
   - 候補 12 形のうち 10 形は、200×200 の格子の 12% 以上を覆う（きれいな形になる）。
   - しかし、2 形の係数を smoothstep で補間すると、**ほぼすべての経路の途中で軌道が不動点（1 画素）に潰れる**（45 対のうち 42 対で被覆率 0.000）。
   - → **形の変身に係数の補間は使わない。**（§4 の再組み立て方式にする）
2. **係数のゆらぎに対する頑健さ**：40 回のランダムなずれ（各係数 ±δ）のうち最悪の被覆率比。
   - δ=.02 でもほとんどの形は崩れる（E は 0.00）。崩れないのは H（.04 まで .99）、L（.10 まで .93）、J（.02 で .98）だけ。
   - → **区間の中で係数を動かさない。** 形は固定し、動きはカメラ、光、キックの散乱（表示だけ）、変身で作る。
3. **遅延座標による 3 次元化**：`(X, Y, Z) = (y_n/ey, x_n/ex, x_{n+1}/ex·Z_SCALE)` とすると、平面の模様が、空間に折り畳まれた 1 枚の膜として立ち上がる。
   - H と L は、絹のヴェールのようで特に美しい（`attractor3d.png` の下段）。
   - E は針金が絡まったようで、美しくない。→ 形の表から外す。

## 1. 形の表（固定。係数は変えない）

| 名前 | a | b | c | d | 被覆率 |
|---|---|---|---|---|---|
| L | -2.0 | -1.9 | -1.2 | 2.0 | .79 |
| H | -1.24 | -1.25 | -1.81 | -1.91 | .72 |
| J | -1.9 | 1.9 | 0.9 | 0.5 | .64 |
| F | -1.8 | -2.0 | -0.5 | -0.9 | .54 |
| D | 1.5 | -1.8 | 1.6 | 0.9 | .70 |
| A | -1.4 | 1.6 | 1.0 | 0.7 | .35 |
| Cc | 1.7 | 1.7 | 0.6 | 1.2 | .48 |

- `ex = 1 + |c|`、`ey = 1 + |d|`（軌道の範囲。表示の正規化に使う）。
- 区間の種類から形への割り当て：
  - intro → L
  - build → J
  - drop → H
  - break → A
  - main → D
  - outro → L
  - 2 回目以降の同じ種類（`variation` が奇数）は、drop → F、main → Cc、それ以外は同じ形。

## 2. 粒子と更新

- 粒子数：PARTICLE_W × PARTICLE_H = 2048 × 1024（2,097,152 個）。
- 状態テクスチャ：RGBA32F の ping-pong。各 texel は `(x_{n+1}, y_{n+1}, x_n, y_n)`。
- 更新パス（毎フレーム 1 回）：直前の (x, y) に写像を 1 回掛け、`(x', y', x, y)` を書く。
  - 写像の係数は uniform `vec4 shapeA`。
  - 発散を防ぐため、`|x|、|y| > 4` になった粒子は `hash` から再初期化する。
- 初期化（`reset`、または §6 の暖機）：
  - 粒子 i の (x, y) を `(hash2(i) * 2 - 1) * .5` で決める。
  - 暖機として WARM_ITERS = 40 回の更新パスを回す（描画はしない）。
  - hash は、曲の seed と粒子番号から作る決定的な値にする。

## 3. 描画（点の加算で密度を作る）

- **密度バッファ**：RGBA16F、出力の解像度。
  - 毎フレーム、最初に `D *= DECAY`（DECAY = .82）を掛ける。全画面パスで乗算する。
  - 次に、全粒子を `gl.POINTS`（1 画素）で加算合成する（blendFunc ONE, ONE）。
- **点の位置**（頂点シェーダーで、gl_VertexID から状態テクスチャを読む）：
  - `P = vec3(y_n/ey, x_n/ex, x_{n+1}/ex*Z_SCALE) * SHAPE_SCALE`
    - Z_SCALE = .9
    - SHAPE_SCALE = 1.0
  - 変身の間は §4 のとおりにする。キックの散乱は §5 で加える。
  - カメラ（§7）で透視投影する。
- **点の色**：
  - 運動の向き `ang = atan(y_{n+1} - y_n, x_{n+1} - x_n)` を [0,1) に写して `u` とする。
  - 帯域の番号 `k = int(u*32.)`。
  - `bandGain = BAND_BASE + BAND_GAIN * L_k`。
    - BAND_BASE = .35、BAND_GAIN = 1.6
    - L_k は WorldBandAnalyzer の帯域レベル `bands[k].x`
  - 色相の重み（モックアップと同じ）：
    - `w1 = .5+.5cos(ang)`、`w2 = .5+.5cos(ang-2.1)`、`w3 = .5+.5cos(ang+2.1)`
    - `rgb = (.55+.45w1, .35+.4w2+.1w1, .12+.55w3)`
  - パレットの混合：`rgb = mix(rgb, rgb*primary*1.6, PALETTE_TINT)`、PALETTE_TINT = .25。
  - 奥行きの減衰：`depthGain = clamp(DEPTH_REF / z_view, .2, 1.6)`、DEPTH_REF = 3.2。
  - 点の重み：`rgb * bandGain * depthGain * POINT_GAIN`。POINT_GAIN は §3 末尾の正規化で決める。
  - → 低域が鳴ると、ある向きに流れる筋が光る。高域が鳴ると、別の向きの筋が光る。
- **トーンマッピング**（全画面パス。シーンのターゲットへ出力し、その後は既存の post を使う）：
  - `c = 1. - exp(-D * EXPOSURE)`
  - `EXPOSURE = EXPOSURE_BASE * (EXPOSURE_FLOOR + EXPOSURE_GAIN * loudness)`
    - EXPOSURE_BASE = 2.5、EXPOSURE_FLOOR = .75、EXPOSURE_GAIN = .5
  - POINT_GAIN は `(W*H*.08) / (PARTICLE_COUNT/(1.-DECAY))` とする（平均的な被覆の画素で D ≈ 1 になる）。
  - 調整は Opus が撮影して行うので、定数として外に出しておく。
- **post**：
  - bloom の閾値 .6、強さ .8。
  - gargantua 分岐と同じく、feedback（残像の再注入）は使わない。
  - post.js にタイプ別の分岐を追加する。

## 4. 変身（区間の切り替えでの再組み立て）

- 区間の切り替えで形が変わるとき（同じ形なら何もしない）、変身を始める。
  - TRANS_SECONDS = 3.0
  - 開始時刻 t0
- **状態**：状態テクスチャをもう 1 組（B）用意する。
  - 開始時に、B を現在の A の (x, y) で初期化し、新しい係数 shapeB で WARM_ITERS 回の暖機をする。
  - 変身中は、A（旧係数）と B（新係数）の両方を毎フレーム更新する。
- **表示位置**：
  - 粒子 i ごとに `delay_i = hash(i) * TRANS_STAGGER`、TRANS_STAGGER = 1.2 秒。
  - `e_i = smoothstep(0, 1, clamp((t - t0 - delay_i) / TRANS_FLIGHT, 0, 1))`、TRANS_FLIGHT = 1.8 秒。
  - `P = mix(P_A, P_B, e_i)` とし、飛行中は渦を巻かせる：`P = rotateY(P, SWIRL * sin(PI*e_i))`、SWIRL = 1.1 rad。
  - 色も `mix` する。
- **終了**：`t ≥ t0 + TRANS_SECONDS` で B を A に入れ替え、B を解放せずに保持する（次回に再利用する）。

## 5. 音楽への反応（形の係数は動かさない）

- **キックの散乱**（表示だけ。状態には触れない）：
  - `P += KICK_SCATTER * kickEnv * dir_i`
  - dir_i は粒子ごとの hash から作る単位ベクトル。
  - KICK_SCATTER = .07
  - `kickEnv = exp(-(t - lastKick)/KICK_SECONDS)`、KICK_SECONDS = .18。キックの検出は g-gargantua と同じ低域オンセットを使う。
  - 形全体が一瞬ふわっと膨らみ、すぐ戻る。
- **高域のきらめき**：
  - 高域のオンセットごとに `glintSerial++` とする。
  - `hash(i, glintSerial) < GLINT_FRACTION` の粒子は、`GLINT_GAIN * exp(-(t - lastHigh)/GLINT_SECONDS)` 倍に明るくする。
    - GLINT_FRACTION = .004
    - GLINT_GAIN = 10
    - GLINT_SECONDS = .25
  - 筋の上に光の粒が散る。
- **帯域の光**：§3 の bandGain。
- **音量**：露出（§3）と、カメラの周回速度（§7）に使う。

## 6. renderAt（決定性と速度）

- このタイプは状態を持つ。ただし、アトラクターは 40 回の反復で初期値を忘れ、密度は DECAY^90 ≈ 0 で過去を忘れる。
- そこで、タイプに `warmFrames = 90` を持たせる。
  - `advanceTo` で、`i ≤ steps - warmFrames` のステップは CPU 側の step（カメラ、変身の時刻管理、キックやグリントの時刻）だけを行い、GPU の更新と描画を省く。
  - 暖機の窓の最初のステップで、粒子を §2 の初期化（seed による決定的な値）からやり直す。その時点で変身中なら、A と B を両方初期化する。
- engine の一般化：
  - §10.12（g-gargantua）の `statelessRender` は、`warmFrames = 1` と同じ意味になる。
  - `drawMatter = (i > steps - (type.warmFrames || (type.statelessRender ? 1 : Infinity))) || fadeElapsed < .5`。
  - 暖機窓に入った最初のステップでは、`type.warmStart(tSec)` を呼ぶ（定義されていれば）。
  - g-fluid（warmFrames なし）の挙動は変えない。
- ライブ再生と export は 1 ステップずつ進むので、変わらない。

## 7. カメラ（形の周りを回るショット）

- 注視点は原点。カメラは `dist`、`pitch`（度）、`yaw`（積分する）、`roll`（度）、`fov`（度）で決める。
- 区間ごとのショット（始点→終点、区間の中で smoothstep）：
  - intro：dist 5.2→4.0、pitch 12→18、yaw 速度 .05、roll 0、fov 34
  - build：dist 3.8→2.8、pitch 28→6、yaw 速度 .09、roll 0→-6、fov 34
  - drop：dist 2.5→2.3、pitch 10→14、yaw 速度 .24、roll 8、fov 38
  - break：dist 4.2、pitch 58→64（真上に近い俯瞰）、yaw 速度 .03、roll 0、fov 30
  - main：dist 3.2、pitch 16、yaw 速度 .11、roll -4、fov 34
  - outro：dist 3.4→6.5、pitch 18→30、yaw 速度 .04、roll 0、fov 34
- 区間の切り替えは、全項目を 4 秒の smoothstep で補間する（g-gargantua と同じ方式）。
- `variation` が奇数なら、roll の符号と yaw の向きを反転する。
- yaw の積分：`yaw += yawSpeed * clamp(1 + .8*(loudness - .5), .5, 1.6) * dt`（g-gargantua の §10.20 と同じ式）。

## 8. 統合

- 新規ファイル `js/world/g-attractor.js`（g-gargantua.js の構造に倣う）。
  - 定数は `WORLD_ATTRACTOR` に Object.freeze でまとめる。
  - 形の表は `WORLD_ATTRACTOR_SHAPES` に置く。
- analyzer-types.js の `g-terrain`（準備中）の枠を、`{ id: 'g-attractor', label: 'ストレンジアトラクター', key: 3, available: true }` に置き換える。
- world.html に script タグを追加する。engine のタイプ一覧に登録する。
- 書き出し（world-exporter）でも同じタイプが選べること（typeId を渡すだけで動くこと）。
- 毎フレームの経路で配列やオブジェクトを新しく作らない。乱数は hash だけを使う。

## 9. 受け入れ条件

- **単体テスト**：
  - 形の表と区間の割り当て。
  - 変身の e_i（端点、単調、遅れ）。
  - グリントの部分集合の決定性。
  - warmFrames による advanceTo の GPU 呼び出し回数（mock）。
  - カメラ表と補間。
  - 定数の表。
  - 既存の全テストも合格すること。
- **Opus の撮影による判定**：
  - renderAt の 1280×720 で、各区間の静止画がモックアップと同程度に美しい。
  - 変身中の連続フレームで、粒子が渦を巻いて新しい形に組み上がる。
  - キックの直後に形が膨らんで戻る。
- **GPU**：1920×1080 で p95 ≤ 16ms（w13sync 方式で計測する）。
