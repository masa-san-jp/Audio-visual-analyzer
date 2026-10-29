# GPU タイプ追加設計 v1 — テッセラクト／量子のビジョン

- 作成: 2026-10-24
- 対象: `js/world/g-tesseract.js`（新規）、`js/world/g-quantum.js`（新規）と配線
- 実装者は本書の名前・値・式をそのまま使う。見た目の判断を足さない。書いていない細部は意図に最も近い選択をし、log.md に記録する。

## 0. 参照（見た目の根拠）

| タイプ | 参照 | 何を取ったか |
|---|---|---|
| g-tesseract | 参照映像（5分）。全 151 コマを確認 | 全編、黒地に縦の光の筋が画面いっぱいに並ぶ。幅は細いものが多く太いものは少ない。束ごとにまとまり、束の間に黒い隙間がある。色はくすんだ暖色が中心 |
| g-quantum | 「量子のビジョン」の参照画像。公開されている VFX 制作資料の画像（画像 03・06・07・08・12）と制作解説記事 | 03: 黒地と星の中で、白い核を金色の粒子殻が包み、殻に黒いひび。06/08: 暗い青緑の地を、白金の細い光の筋が束になって弧を描く（記事では「回転する弧の上を縦の波がたどる」装置）。07: 金の火花とボケ（テルミット）。12: 金の球とボケ |

### 0.1 実測した色（sRGB。k-means と色相別集計）

テッセラクトの筋（明るい画素を色相ごとに集計。core = その色相の上位 10%、halo = 平均）:

| 族 | 割合 | core | halo |
|---|---|---|---|
| neutral | 42.6% | #C1C5BC | #929388 |
| peach | 41.8% | #F9F7DF | #B0A58A |
| rose | 9.7% | #EEC1AE | #B28B83 |
| cream | 4.3% | #F5F9E8 | #C9CEB8 |
| cyan | 0.9% | #EBF7F3 | #BFD0CC |
| sage | 0.7% | #E1EBE3 | #D2DFD7 |

テッセラクトの地: #080502（隙間の 58.8%）。

量子のビジョン:
- 03 殻の金: #925A05 29.4% / #A66704 25.3% / #BA7704 20.1% / #CE8B07 14.9% / #9D9287 10.2%。地 #060B04
- 06/08 筋: #EBE0C4、#C3C3A8（08 上位 2 つ）。青緑の光の柱 #566B67。地の中央 #0D2226、周辺 #060E0A
- 07 火花（温度順）: #EECA81 → #DEAF5C → #CA913C → #935C25

色はすべて JS 側で sRGB → linear（`c<=.04045 ? c/12.92 : ((c+.055)/1.055)^2.4`）に変換してから uniform/定数にする。変換関数は `worldSrgbToLinear(hex, out)` として両ファイル共通に `js/world/gl-util.js` へ置く。

## 1. 共通

- 2 タイプとも `WorldBandAnalyzer` を継承し、`statelessRender = true`（フレーム間の GPU 履歴なし。renderAt は末尾 1 枚だけ描けばよい）。
- 音のイベントは既存タイプと同じ方式: `if (t !== this.lastEventSec) { flags&1 → キック, flags&4 → 高域オンセット; this.lastEventSec = t; }`。
- 帯域は `this.bandUniforms`（`bands[i].x` = レベル、`.y` = 残光つきレベル）。
- 区間は `input.engine.score.sections[input.engine.sectionIndex]`（`kind` ∈ intro/build/drop/break/main/outro、`variation`、`startSec`、`endSec`）。区間内進行 `p = clamp((t-start)/(end-start))`、`progress = smoothstep(p)`。
- カメラ表は「始点/終点」の対で持ち、`progress` で補間。区間が変わったら `CAMERA_EASE_SECONDS` かけて前ショットから新ショットへ smoothstep で移る（g-attractor と同じ実装パターン。初回は表の値から開始）。`variation >= 3 && variation % 2 === 1` のとき、表に「反転」と書いた列の符号を反転する。
- 露出: `exposure = EXPOSURE_BASE * (EXPOSURE_FLOOR + EXPOSURE_GAIN * loudness)`。各タイプが自分の出力に掛ける（post の exposureMultiplier は使わない）。
- 毎フレーム経路で配列・オブジェクトを作らない。ハッシュは g-attractor の `particleHash` と同じ uint 混合（seed = `score.seed`）。

## 2. g-tesseract「テッセラクト」（key 4）

### 2.1 構造

無限に続く「縦の光の筋の壁」を奥行き方向に等間隔で並べ、カメラがその中を移動する。全画面フラグメントシェーダー 1 パス、出力はフル解像度の HDR target（半解像度にしない。筋が細いため）。

- 壁 k は平面 `z = k * LAYER_DZ`（k は整数、無限）。カメラ位置 `(camX, 0, camZ)`。描くのはカメラより前にある `LAYERS` 枚: `k0 = floor((camZ + NEAR) / LAYER_DZ) + 1`、`k = k0 .. k0+LAYERS-1`。
- 各壁の上で筋は x 方向に `PITCH` 間隔のセル n に 1 本ずつ（存在確率 `PRESENCE`）。筋は y 方向に無限。

### 2.2 定数 `WORLD_TESSERACT`

| 名前 | 値 | 意味 |
|---|---|---|
| PITCH | .02 | セル幅（world） |
| LAYERS | 6 | 描く壁の数 |
| LAYER_DZ | .8 | 壁の間隔 |
| NEAR | .25 | これより近い壁は描かない |
| NEAR_FADE | .35 | 近側のフェード幅 |
| FAR_FADE | 1.2 | 遠側のフェード幅 |
| FOG | 3.5 | 距離減衰 `exp(-t/FOG)` |
| PRESENCE | .8 | セルに筋がある確率 |
| W_MIN / W_MAX / W_POW | .06 / .38 / 2.5 | 筋の幅 `w = PITCH*(W_MIN+(W_MAX-W_MIN)*h^W_POW)`（細いものが多い） |
| JITTER | .6 | セル内の位置ずれ `xs = (n+.5+(h-.5)*JITTER)*PITCH` |
| BUNDLE | .28 | 束の大きさ（world） |
| BUNDLE_LO / BUNDLE_HI / BUNDLE_FLOOR | .30 / .70 / .08 | 束の包絡 `env = max(BUNDLE_FLOOR, smoothstep(LO,HI, vnoise1(xs/BUNDLE + k*17.31)))` |
| HALO_GAIN / HALO_WIDTH | .22 / 3.0 | 筋のにじみ |
| APERTURE | .012 | 被写界深度 |
| NEIGHBOR | 3 | 片側に調べるセル数（計 7 セル） |
| PEAK | 1.6 | 筋の HDR 強度 |
| BAND_BASE / BAND_GAIN | .55 / .9 | `L = BAND_BASE + BAND_GAIN*bands[b].y` |
| KICK_GAIN / KICK_SECONDS | .25 / .18 | キックで全体の光量を持ち上げる |
| FLOW_WAVELENGTH / FLOW_SPEED / FLOW_DEPTH | .9 / .12 / .12 | 筋に沿ってゆっくり流れる明暗 |
| PULSE_FRACTION / PULSE_SPEED / PULSE_LENGTH / PULSE_GAIN / PULSE_SECONDS / PULSE_START | .04 / 2.4 / .12 / 3.0 / 1.6 / 1.6 | 高域オンセットで筋を光が走る |
| PULSE_SLOTS | 4 | 同時に保持するパルス |
| BG | #080502 | 地 |
| EXPOSURE_BASE / EXPOSURE_FLOOR / EXPOSURE_GAIN | 1.0 / .8 / .4 | |
| BLOOM_THRESHOLD / BLOOM_STRENGTH | .8 / .55 | post |
| CAMERA_EASE_SECONDS | 4 | |
| SPEED_LOUD_GAIN / SPEED_MIN / SPEED_MAX | .8 / .5 / 1.6 | 移動速度の音量係数 `clamp(1+GAIN*(loud-.5), MIN, MAX)` |

パレット `WORLD_TESSERACT_PALETTE`: §0.1 の 6 族を `[weight, core, halo]` で、割合の大きい順。重みは cyan+sage を含めそのまま使い、累積で選ぶ（`h` は筋ごとのハッシュ）。

### 2.3 カメラ表 `WORLD_TESSERACT_CAMERA`

列: vx（横移動 world/s、反転）、vz（前進 world/s）、yaw°（反転）、pitch°、roll°（反転）、fov°、focus（焦点距離 world）。各列 始点/終点。

| kind | vx | vz | yaw | pitch | roll | fov | focus |
|---|---|---|---|---|---|---|---|
| intro | .03/.03 | .02/.02 | 0/0 | 0/0 | 0/0 | 40/40 | 2.2/2.2 |
| build | .05/.10 | .05/.35 | 0/6 | 0/4 | 0/-3 | 40/46 | 2.2/1.6 |
| drop | .22/.22 | .30/.30 | 20/26 | -4/-4 | -7/-7 | 52/52 | 1.4/1.4 |
| break | .015/.015 | .03/.03 | 0/0 | 24/30 | 0/0 | 44/44 | 2.6/2.6 |
| main | .08/.08 | .10/.10 | -10/-10 | 3/3 | 3/3 | 42/42 | 1.8/1.8 |
| outro | .02/.01 | -.06/-.06 | 0/0 | 0/0 | 0/0 | 40/36 | 2.4/2.4 |

- `camX += vx * speedFactor * motionSpeed * dt`、`camZ += vz * speedFactor * motionSpeed * dt`（speedFactor は §2.2 の音量係数、motionSpeed は `input.song.motionSpeed`）。reset で 0。
- 基底（yaw ψ、pitch θ、roll φ）: `forward = (sinψ cosθ, sinθ, cosψ cosθ)`、`right0 = (cosψ, 0, -sinψ)`、`up0 = cross(forward, right0)`、`right = cosφ·right0 + sinφ·up0`、`up = -sinφ·right0 + cosφ·up0`。CPU で計算して uniform で渡す。
- 画素の光線: `ray = normalize(forward + ndc.x*aspect*tanH*right + ndc.y*tanH*up)`、`tanH = tan(fov/2)`。

### 2.4 シェーダー（1 画素）

```
sum = 0
for i in 0..LAYERS-1:
  k = k0 + i; D = k*LAYER_DZ - camZ
  if ray.z < .05: continue
  t = D / ray.z; x = camX + ray.x*t; y = ray.y*t
  fade = smoothstep(NEAR, NEAR+NEAR_FADE, D) * (1 - smoothstep(Dfar-FAR_FADE, Dfar, D)) * exp(-t/FOG)
         （Dfar = NEAR + LAYERS*LAYER_DZ）
  coc = APERTURE * |t - focus| / focus
  pix = t * 2*tanH / H / max(ray.z, .25)
  n0 = floor(x / PITCH)
  for dn in -NEIGHBOR..NEIGHBOR:
    n = n0+dn; h1..h6 = hash(n, k, 1..6)
    if h1 >= PRESENCE: continue
    xs = (n+.5+(h2-.5)*JITTER)*PITCH
    w  = PITCH*(W_MIN+(W_MAX-W_MIN)*pow(h3,W_POW))
    we = sqrt(w*w + coc*coc + pix*pix); d = x - xs
    prof = (w/we) * ( exp(-.5*(d/we)^2) * core + HALO_GAIN*exp(-.5*(d/(HALO_WIDTH*we))^2) * halo )   ← core/halo は h4 で選んだパレット族
    env = 束の包絡（§2.2）
    b = 帯域: clamp(int(fract(floor(xs/BUNDLE)*.618034 + k*.31)*32) + int(h5*3.) - 1, 0, 31)
    L = BAND_BASE + BAND_GAIN*bands[b].y
    flow = 1 - FLOW_DEPTH*.5 + FLOW_DEPTH*.5*sin(6.2832*(y/FLOW_WAVELENGTH - FLOW_SPEED*tSec) + 6.2832*h6)
    pulse = Σ_slot（§2.5）
    sum += fade * env * prof * L * flow * (1 + pulse)
out = (BG + sum * PEAK * (1 + KICK_GAIN*kick)) * exposure
```

- `vnoise1(x)`: 整数格子のハッシュ値を smoothstep で補間した 1 次元 value noise（0..1）。
- `env` は筋の中心 `xs` で評価する（画素の x ではない）。

### 2.5 パルス（高域オンセット）

- CPU: 高域オンセットごとに `serial++`、スロット `serial % PULSE_SLOTS` に `(serial, t0=t, dir, 0)` を入れる。`dir = worldAttractorHash(0, serial, seed) < .5 ? 1 : -1`。reset で t0 = -100。
- GPU: 各スロットで、筋が `hash(n*7919+k, serial) < PULSE_FRACTION` のとき、`age = tSec - t0`（0 ≤ age < PULSE_SECONDS）、`yc = dir*(-PULSE_START + PULSE_SPEED*age)`、`dy = y - yc`、後ろ側（`dy*dir < 0`）は長さ `PULSE_LENGTH*3`、前側は `PULSE_LENGTH`。`pulse += PULSE_GAIN * exp(-.5*(dy/len)^2) * (1 - age/PULSE_SECONDS)`。

## 3. g-quantum「量子のビジョン」（key 5）

### 3.1 構造

3 つの「ビジョン」を同時に持ち、区間ごとの重みで出し入れする。1 フレーム = 背景パス（全画面）＋ 点スプライト 1 回の加算描画（ブレンド ONE,ONE）。出力はフル解像度の HDR target。

- 筋（Filaments, 06/08）: 回転する弧の束。弧に沿って縦の波が走る。
- 星（Star, 03）: 白い核と、ひびの入った金の粒子殻。
- 火花（Sparks, 07）: キックで散る金の火花と、手前のボケ。

点の割り当て（`gl_VertexID` の範囲で分岐）:

| 範囲 | 数 | |
|---|---|---|
| 筋 | FIL_BUNDLES*FIL_PER_BUNDLE*FIL_SAMPLES = 6*8*4096 = 196608 | |
| 殻 | SHELL_COUNT = 262144 | |
| 火花 | SPARK_BURSTS*SPARK_PER_BURST*SPARK_TAPS = 16*768*4 = 49152 | |

重みが .002 未満の範囲の点、寿命外の火花は `gl_Position = vec4(2.,2.,2.,1.)` で捨てる。

### 3.2 区間の重み `WORLD_QUANTUM_SCENES`

列: filaments、star、sparks、teal（地を青緑にする割合）。

| kind | fil | star | sparks | teal |
|---|---|---|---|---|
| intro | 0 | 1 | 0 | 0 |
| build | 1 | .35 | 0 | 1 |
| drop | .35 | 1 | 1 | 0 |
| break | 1 | 0 | 0 | 1 |
| main | 1 | 0 | .7 | 1 |
| main（variation 奇数 ≥3） | .5 | 1 | .7 | 0 |
| outro | 0 | 1 | 0 | 0 |

- 区間が変わったら、その時点の重み（補間中ならその値）から新しい重みへ `SCENE_FADE = 2.0` 秒の smoothstep で移る。純関数 `worldQuantumSceneWeights(kind, variation, out)` を公開。

### 3.3 定数 `WORLD_QUANTUM`

| 名前 | 値 | |
|---|---|---|
| FIL_BUNDLES / FIL_PER_BUNDLE / FIL_SAMPLES | 6 / 8 / 4096 | |
| FIL_R_MIN / FIL_R_SPAN | 1.2 / 1.2 | 束の半径 `R = MIN + SPAN*h` |
| FIL_TILT | 70 | 束の面の傾き（°）`(h-.5)*FIL_TILT` |
| FIL_OMEGA_MIN / FIL_OMEGA_SPAN | .12 / .25 | 回転速度 rad/s、偶数番の束は正、奇数番は負 |
| FIL_SPAN | 2.6 | 弧の長さ（rad） |
| FIL_WAVE_M_MIN / FIL_WAVE_M_SPAN | 3 / 4 | 波数 `m = MIN + floor(h*SPAN)` |
| FIL_WAVE_A_MIN / FIL_WAVE_A_SPAN | .06 / .16 | 波の振幅 |
| FIL_WAVE_NU / FIL_WAVE_LOUD | 1.3 / .8 | 波の位相速度 `ν = NU*(1+LOUD*loud)` |
| FIL_WAVE_BAND | .6 | 振幅の音量係数 `A*(1+BAND*bands[b].y)` |
| FIL_BUNDLE_W / FIL_RADIAL_W | .10 / .05 | 束の中の筋の広がり（法線方向／半径方向） |
| FIL_GAIN | .35 | 点 1 個の強度 |
| FIL_CORE / FIL_EDGE | #EBE0C4 / #C3C3A8 | 筋の色 `mix(EDGE, CORE, h)` |
| FIL_PULSE_FRACTION / FIL_PULSE_SPEED / FIL_PULSE_WIDTH / FIL_PULSE_GAIN / FIL_PULSE_SECONDS | .35 / .9 / .03 / 4.0 / 1.4 | 高域オンセットで弧を光が走る。4 スロット |
| SHELL_COUNT / SHELL_R | 262144 / .8 | |
| SHELL_JITTER | .06 | 殻の厚み |
| SHELL_SPRAY / SHELL_SPRAY_MIN / SHELL_SPRAY_SPAN / SHELL_SPRAY_GAIN | .10 / 1.12 / .5 / .45 | 殻の外に散る粒（割合・半径・明るさ） |
| CRACK_FREQ / CRACK_WIDTH / CRACK_FLOOR | 3.2 / .035 / .05 | ひび `vein = max(CRACK_FLOOR, smoothstep(0., CRACK_WIDTH, abs(vnoise3(dir*CRACK_FREQ + seedOffset) - .5)))` |
| SHELL_SPIN | .06 | 殻の自転 rad/s（y 軸） |
| SHELL_GAIN | .5 | |
| SHELL_GOLD | 03 の 5 色と割合 | 粒ごとに累積重みで選ぶ |
| BURST_GROW / BURST_SECONDS | 1.8 / 4 | drop の冒頭で殻が膨らむ |
| IMPLODE | .85 | outro で殻が核へ縮む |
| CORE_RADIUS / CORE_GAIN / CORE_KICK / CORE_HALO | .05 / 6.0 / 1.5 / .15 | 核の光 |
| CORE_COLOR | (1.0, .96, .88)（linear） | 03 の核は白く飛んでいるため、白に近い暖色とする |
| SPARK_BURSTS / SPARK_PER_BURST / SPARK_TAPS | 16 / 768 / 4 | |
| SPARK_SPEED_MIN / SPARK_SPEED_MAX | 1.2 / 4.0 | 速さ `MIN + (MAX-MIN)*h^2` |
| SPARK_LIFE_MIN / SPARK_LIFE_SPAN | .5 / .9 | 寿命 |
| SPARK_DRAG / SPARK_GRAVITY | 1.6 / 2.2 | 位置 `o + dir*speed*(1-exp(-DRAG*a))/DRAG + (0,-.5*G*a²,0)` |
| SPARK_SHUTTER | 1/30 | 尾の長さ（tap s の時刻 `a - s*SHUTTER/TAPS`） |
| SPARK_GAIN | 2.2 | `*(1-u)^1.5`、u = a/life |
| SPARK_COLORS | 07 の 4 色を u = 0, .33, .66, 1 に置く | 冷えていく色 |
| SPARK_BOKEH / SPARK_BOKEH_NEAR | .12 / 1.0 | 12% の火花をカメラ方向へ `NEAR + h` だけ寄せてボケにする |
| STAR_GRID / STAR_PROB / STAR_RADIUS_PX / STAR_GAIN | 420 / .06 / .6 / 1.4 | 星（方向の 3D 格子。半径は 1080p 基準の px） |
| STAR_COLOR | #9D9287 | |
| GROUND_BLACK | #060B04 | |
| GROUND_TEAL_CENTER / GROUND_TEAL_EDGE | #0D2226 / #060E0A | `mix(EDGE, CENTER, exp(-1.6*|uv-.5|²*4))`（uv は 0..1、x はアスペクトで補正） |
| BEAM_COUNT / BEAM_WIDTH / BEAM_GAIN / BEAM_COLOR | 3 / .06 / .35 / #566B67 | 縦の光の柱。中心 `x = .5 + .35*sin(.05*t + j*2.1)`、ガウス幅 BEAM_WIDTH（画面幅比） |
| BASE_SIZE / COC_K / MAX_POINT | 1.6 / 26 / 64 | 点の大きさ（1080p 基準 px） |
| BAND_BASE / BAND_GAIN | .55 / .9 | |
| KICK_SECONDS | .18 | |
| EXPOSURE_BASE / EXPOSURE_FLOOR / EXPOSURE_GAIN | 1.0 / .8 / .4 | |
| BLOOM_THRESHOLD / BLOOM_STRENGTH | .7 / .9 | post（光がにじむ） |
| SCENE_FADE | 2.0 | |
| CAMERA_EASE_SECONDS | 4 | |

### 3.4 カメラ表 `WORLD_QUANTUM_CAMERA`

原点を見る周回カメラ。列: dist、yaw 速度 rad/s（反転）、pitch°、roll°（反転）、fov°、focus（world、原点からではなくカメラからの距離）。

| kind | dist | yawSpd | pitch | roll | fov | focus |
|---|---|---|---|---|---|---|
| intro | 4.2/3.4 | .04/.04 | 6/6 | 0/0 | 34/34 | 4.2/3.4 |
| build | 3.6/3.0 | .10/.10 | 10/18 | -4/-4 | 38/38 | 3.0/3.0 |
| drop | 3.0/3.0 | .22/.22 | 4/4 | 8/8 | 44/44 | 3.0/3.0 |
| break | 3.4/3.8 | .05/.05 | 20/20 | 0/0 | 36/36 | 3.4/3.4 |
| main | 3.2/3.2 | .12/.12 | -6/-6 | -3/-3 | 40/40 | 3.2/3.2 |
| outro | 3.6/5.0 | .03/.03 | 8/14 | 0/0 | 34/34 | 4.0/4.0 |

- yaw は g-attractor と同じく積分（`yaw += yawSpd * speedFactor * dt`、speedFactor は g-tesseract と同じ式・同じ定数値を WORLD_QUANTUM に持つ: SPEED_LOUD_GAIN .8 / SPEED_MIN .5 / SPEED_MAX 1.6）。
- 位置と基底は g-attractor の `_updateCameraBasis` と同じ式（dist、pitch、yaw、roll）。投影も g-attractor と同じ（`projection = (aspect, tanH)`）。

### 3.5 点の共通処理

- ビュー空間の深さ `z = dot(P - camPos, camForward)`。`z <= .05` は捨てる。
- `s1080 = H / 1080`。`coc = COC_K*s1080*|z - focus|/z`、`size = min(MAX_POINT*s1080, sqrt((BASE_SIZE*s1080)² + coc²))`、強度に `(BASE_SIZE*s1080/size)²` を掛ける（エネルギー保存）。`gl_PointSize = size`。
- フラグメント: `r = length(gl_PointCoord*2-1)`、`gauss = exp(-4.5*r*r)`、`disc = .30 * smoothstep(1., .82, r) * (.85 + .25*smoothstep(.55, .95, r))`（縁が少し明るいレンズのボケ）、`mix(gauss, disc, smoothstep(4., 14., size/s1080))`。`r > 1` は 0。
- 出力 `color * profile * exposure`。

### 3.6 筋

束 b（0..5）のハッシュ: `R`、傾き α=(h-.5)*FIL_TILT（x 軸回り）、方位 β=h*360°（y 軸回り）、`ω`（符号は b の偶奇）、`θ0 = h*2π`、`m`、`A`。束の局所座標では弧は xz 平面の円、法線は y。

筋 i（0..7）: 法線方向のずれ `o = (h-.5)*FIL_BUNDLE_W`、半径方向のずれ `ro = (h-.5)*FIL_RADIAL_W`、位相 `φ = h*.6`、色 `mix(FIL_EDGE, FIL_CORE, h)`、帯域 `band = (b*5 + i*4) % 32`。

サンプル j: `u = j/(FIL_SAMPLES-1)`、`θ = θ0 + ω*t + u*FIL_SPAN`、
`local = (R+ro)*(cosθ, 0, sinθ) + (0, o + A*(1+FIL_WAVE_BAND*bands[band].y)*sin(m*θ - ν*t + φ), 0)`、`P = Ry(β)*Rx(α)*local`。
強度 `FIL_GAIN * pow(sin(π u), .8) * (BAND_BASE + BAND_GAIN*bands[band].y) * (1 + pulse) * w_fil`。
`ν*t` の位相は CPU で積分した値を uniform で渡す（音量で速さが変わっても位相が飛ばない）。

パルス: 4 スロット `(serial, t0)`。筋 `(b,i)` が `hash(b*8+i, serial) < FIL_PULSE_FRACTION` のとき、`s = (t-t0)*FIL_PULSE_SPEED`（0..1 を超えたら無し）、`pulse += FIL_PULSE_GAIN*exp(-.5*((u-s)/FIL_PULSE_WIDTH)²)*(1-(t-t0)/FIL_PULSE_SECONDS)`。

### 3.7 星

- 粒 i: 方向 `dir` は一様球面（ハッシュ 2 個から `z=2h-1`、`φ=2πh`）。spray（`h < SHELL_SPRAY`）なら `r = SHELL_R*(SHELL_SPRAY_MIN + SHELL_SPRAY_SPAN*h)`、強度 × SHELL_SPRAY_GAIN。それ以外 `r = SHELL_R*(1 + SHELL_JITTER*(h-.5))`。
- ひび: `vein`（§3.3）を強度に掛ける。`vnoise3` は整数格子ハッシュを smoothstep で三線形補間した値（0..1）。`seedOffset = vec3(float(seed%1024u)*.37)`。
- 膨張係数 `B`（CPU）: drop では `1 + BURST_GROW*(1-(1-q)³)`、`q = clamp((t-start)/BURST_SECONDS)`。outro では `1 - IMPLODE*progress`。それ以外 1。区間が変わった直後は、直前の B から新しい B へ SCENE_FADE の smoothstep で移す。粒ごとに `r *= 1 + (B-1)*(.6 + .8*h)`。B > 1 のとき強度 × `1 - .6*(B-1)/BURST_GROW`。
- 自転: `Ry(SHELL_SPIN*t)`。
- 色: SHELL_GOLD を累積重みで選ぶ。帯域 `band = int((dir.y*.5+.5)*31.99)`（下が低音、上が高音）。強度 `SHELL_GAIN*(BAND_BASE+BAND_GAIN*bands[band].y)*vein*w_star`。
- 核（背景パスで描く）: CPU で原点を画面へ投影した位置 `corePx` と半径 `coreR = CORE_RADIUS * focalPx / dist`（focalPx = H/(2 tanH)）を渡す。`d = |fragPx - corePx|`、`core = CORE_GAIN*(1+CORE_KICK*kick)*(exp(-(d/coreR)²) + CORE_HALO*exp(-d/(coreR*6))) * CORE_COLOR * w_star * B_core`。`B_core = 1/max(B,.3)`（膨らむと核は弱まり、縮むと強まる）。

### 3.8 火花

- キック（flags&1）で、sparks の重み > .05 のときだけバーストを 1 つ作る。スロット `serial % SPARK_BURSTS` に `(t0, origin.xyz)` と serial を入れる。
- origin: drop と「star の重み ≥ .5」のときは殻の上 `dir_h * SHELL_R * B`、それ以外は半径 1.6 の球内の一様点（ハッシュ 3 個）。ハッシュは `worldAttractorHash(k, serial, seed)` 系で決定的に。
- 火花 i、tap s: §3.3 の式で位置、`u = a/life`（a は tap の時刻）、色は SPARK_COLORS を u で線形補間、強度 `SPARK_GAIN*(1-u)^1.5*w_sparks/SPARK_TAPS`。ボケの火花は位置を `-camForward*(SPARK_BOKEH_NEAR + h)` だけずらす（カメラに寄る → 大きくぼける）。

### 3.9 背景パス

`ground = mix(GROUND_BLACK, tealGround + beams, w_teal)` ＋ 星 `*(1-w_teal)` ＋ 核。星は光線方向 `dir*STAR_GRID` の格子セルごとに `hash < STAR_PROB` で 1 個（セル内ずれ ±.3）、角距離を px に直して半径 STAR_RADIUS_PX*s1080 のガウス、明るさ `h³*STAR_GAIN`。

## 4. 配線

- `js/world/analyzer-types.js` の `WORLD_ANALYZER_TYPES` に `{ id: 'g-tesseract', label: 'テッセラクト', key: 4, available: true }`、`{ id: 'g-quantum', label: '量子のビジョン', key: 5, available: true }`。
- `js/world/world-engine.js` の `this.types` に追加。`_draw` で `this.post.tesseract`／`this.post.quantum` を設定。
- `js/world/post.js`: `tesseractMode`／`quantumMode` 分岐を attractor 分岐と同じ形（bloom 4 段の重み .25/.25/.30/.45、`aces((scene + bloom*STRENGTH)*.75)`）で追加。閾値は各タイプの BLOOM_THRESHOLD。露出メーターは使わない。
- `js/renderer-registry.js` に GPU 項目 2 つ（label 同上、group 'GPU'）。
- `index.html` と `tests/browser/harness/world.html` に script タグ（g-attractor.js の後）。
- テストで GPU タイプ数を 3 と決め打ちしている箇所を追従させる。
- README・`doc/spec.md`（v2.24）・log.md を更新。

## 5. テスト（単体）

- UW-T-01: 定数とパレットの値が本書どおり（linear 変換後の値も 1 件以上確認）。
- UW-T-02: カメラ表の補間と、奇数 variation で反転列だけ符号が変わる。
- UW-T-03: 高域オンセットでパルススロットが循環し、同時刻の再呼び出しで二重に入らない。
- UW-Q-01: `worldQuantumSceneWeights` が §3.2 の表どおり。
- UW-Q-02: 重みのクロスフェードが SCENE_FADE で終わり、途中で区間が変わっても値が飛ばない。
- UW-Q-03: 膨張係数 B（drop・outro・その他）と区間切替時の連続性。
- UW-Q-04: キックでバーストが作られるのは sparks の重み > .05 のときだけ。
- 両タイプ: GL モックで init/step/render が例外なく通る。step で新しい配列を作らない（既存テストの方式に合わせる）。

## 6. 検証

実 GPU の Chrome で renderAt の静止画を撮り、§0 の参照と並べて比べる。合格の目安:
- テッセラクト intro: 縦の筋が画面いっぱい、束の間に黒い隙間、細い筋が多数。暖色中心でくすんだ色。
- 量子 intro: 黒地に白い核と金の殻、殻に黒いひび。build/break: 青緑の地を白金の弧の束が横切り、手前の筋は大きくぼける。drop: 殻が膨らみ、金の火花とボケ。

## 7. 実機調整（2026-10-26）

Apple M4 Max の Chrome（ANGLE Metal）で各区間の renderAt を撮影し、§0 の参照と並べて値を変えた。§2.2・§3.3・§3.4 の該当値は本節で置き換える。

### 7.1 g-tesseract

設計値のままでは 6 枚の壁の筋が重なって画面全体が灰色に埋まり（LDR 平均 .50）、束の間の黒い隙間が出ず、被写界深度で筋が溶けた。

| 名前 | 設計値 → 調整値 | 理由 |
|---|---|---|
| LAYERS / LAYER_DZ | 6 / .8 → 3 / 1.2 | 重なりを減らす（奥行きの範囲はほぼ同じ） |
| PRESENCE | .8 → .45 | 筋と筋の間に黒を残す |
| W_MAX | .38 → .30 | 太い筋を減らす |
| BUNDLE_LO / BUNDLE_HI / BUNDLE_FLOOR | .30 / .70 / .08 → .38 / .60 / 0 | 束の間を黒い隙間にする |
| HALO_GAIN | .22 → .08 | にじみによる灰色の霞を消す |
| APERTURE | .012 → .003 | 筋の輪郭を保つ |
| PEAK | 1.6 → 3.0 | 減った筋の分の明るさを補う |

調整後の LDR 平均は .20〜.33、白飛び 0。

### 7.2 g-quantum

設計値では、殻が薄く暗い縁だけになり、核のにじみが灰色の円盤として内側を埋めた。弧は細く暗く、ドロップでは殻（最大半径約 2.5）がカメラ（距離 3.0）を包んで画面全体の塵になった。火花は暗くて見えなかった。

| 名前 | 設計値 → 調整値 | 理由 |
|---|---|---|
| SHELL_JITTER / SHELL_SPRAY | .06 / .10 → .30 / .18 | 03 の厚い金の殻と周りの粒 |
| SHELL_GAIN | .5 → 5.0 | 殻の明るさ |
| CRACK_FREQ / CRACK_WIDTH | 3.2 / .035 → 4.0 / .08 | ひびを見えるようにする |
| CORE_HALO | .15 → .03 | 核の灰色の円盤を消す |
| BLOOM_STRENGTH | .9 → .6 | 同上 |
| FIL_PER_BUNDLE | 8 → 16 | 08 の太い光の束（筋の点は 393216） |
| FIL_BUNDLE_W / FIL_RADIAL_W / FIL_GAIN | .10 / .05 / .35 → .22 / .10 / 2.0 | 同上 |
| BURST_GROW | 1.8 → .4 | 膨らんだ殻がカメラを包まないようにする |
| カメラ drop の dist / focus | 3.0 / 3.0 → 3.8 / 3.8 | 同上 |
| SPARK_GAIN / SPARK_BOKEH | 2.2 / .12 → 12 / .3 | 火花とボケを見えるようにする |

renderAt は音声のタイムラインがないと音のイベントが無いため、火花は撮影スクリプトから `_spawnBurst` を呼んで確認した。ドロップの見た目は静止画ではまだ参照 07 に届いていないため、実曲の再生で確認する。
