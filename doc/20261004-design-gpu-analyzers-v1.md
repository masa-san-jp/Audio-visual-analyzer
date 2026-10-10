# GPU アナライザー詳細設計 v1（Opus 設計・Codex 実装）

- Date: `2026-10-04`
- 位置づけ: 構想 §2.8 の GPU アナライザー群について、**見た目・数式・定数の唯一の正（SSOT）**。
- 実装者は書かれたとおりに実装する。本書にない見た目の判断をしない。数値は名前つき定数として、本書と同じ値で定義する。
- 座標の規約:
  - 画面座標は `p = (uv - .5) * vec2(aspect, 1)`。高さ 1 が単位。
  - 時刻 `t` は音声時刻（秒）。
  - 色はすべて線形 HDR で、トーンマップは既存の post に任せる。

---

## 1. 共通

### 1.1 パレット（12 組。曲の主音のクロマで選ぶ）

`palette = WORLD_PALETTES[dominantChroma]`。値は線形 RGB。

| index（主音） | 名前 | primary | secondary | accent |
|---|---|---|---|---|
| 0 (C) | Aurora | (0.10, 0.85, 0.75) | (0.45, 0.25, 1.00) | (1.00, 0.85, 0.60) |
| 1 (C#) | Ember | (1.00, 0.55, 0.15) | (0.90, 0.12, 0.25) | (1.00, 0.90, 0.75) |
| 2 (D) | Glacier | (0.35, 0.70, 1.00) | (0.12, 0.25, 0.90) | (0.90, 0.95, 1.00) |
| 3 (D#) | Sakura | (1.00, 0.45, 0.70) | (0.60, 0.50, 1.00) | (1.00, 0.85, 0.55) |
| 4 (E) | Solar | (1.00, 0.75, 0.25) | (1.00, 0.40, 0.10) | (1.00, 0.95, 0.85) |
| 5 (F) | Abyss | (0.00, 0.80, 1.00) | (0.25, 0.15, 0.80) | (1.00, 0.30, 0.80) |
| 6 (F#) | Canopy | (0.60, 1.00, 0.40) | (0.10, 0.70, 0.45) | (1.00, 0.85, 0.40) |
| 7 (G) | Nebula | (0.95, 0.25, 0.75) | (0.20, 0.40, 1.00) | (0.40, 0.95, 1.00) |
| 8 (G#) | Sunset | (1.00, 0.45, 0.35) | (0.55, 0.20, 0.80) | (1.00, 0.75, 0.50) |
| 9 (A) | Neon | (0.15, 0.50, 1.00) | (1.00, 0.20, 0.60) | (0.95, 0.95, 1.00) |
| 10 (A#) | Copper | (0.95, 0.50, 0.25) | (0.10, 0.60, 0.60) | (1.00, 0.92, 0.80) |
| 11 (B) | Twilight | (0.55, 0.30, 1.00) | (1.00, 0.40, 0.55) | (0.50, 0.80, 1.00) |

- `worldSongVariation` の `palette` はこの表から取る。補色の自動生成（`worldHue(hue + π)`）は廃止する。
- 同じ曲の中での色の役割の回転（`(kind, label)` の変奏）は残す。

### 1.2 帯域の色の傾斜

`x = band / 31`（0 = 低域、1 = 高域）。

```
vec3 bandRamp(float x) = mix( mix(primary, secondary, smoothstep(0., .65, x)), accent, smoothstep(.78, 1., x) )
```

既存の `bandColor(i)`（3 段の階段）は廃止する。

### 1.3 帯域レベルの整形（全タイプ共通。CPU 側で uniform にする前に計算する）

```
raw  = features.bandsSmooth[i]                    // 0..1
L_i  = pow(clamp((raw - .12) / .70, 0., 1.), .8)  // 下限を切り、広がりを出す
G_i  = L_i の残光: G_i = max(L_i, G_i_prev * exp(-dt * 6.))
bass = (L_0 + L_1 + L_2 + L_3) / 4
mid  = mean(L_8 .. L_20)
high = mean(L_24 .. L_31)
```

- **拍のパルス**：`beatEnv = exp(-ageSinceBeat / .16)`（直近の拍）
- **小節頭のパルス**：`barEnv = exp(-ageSinceDownbeat / .35)`
- uniform（追加・置換）：
  - `bands[32]` は vec4 で、`(L_i, G_i, phase_i, onsetEnvGroup)` を入れる。
  - `pulse` は vec4 で、`(beatEnv, barEnv, bass, high)` を入れる。
  - `mids` は float で、`mid` を入れる。

### 1.4 明るさの目安（HDR）

- 背景：輝度 ≤ 0.02
- 静かなとき：主要素の輝度 0.3〜0.8
- 最大の音量：主要素の芯の輝度 4〜8（ブルームでにじむ）
- 画面全体が白飛びする状態にはしない（BW-2-exposure を守る）

---

## 2. `g-rings` 光の放射リング（Spectral Corona）

全画面フラグメントシェーダー 1 枚で描く。上から順に加算していく。

```
// 回転：テンポに比例した基準回転 ＋ 拍ごとの小さな回り込み
rotA = t * .04 * song.x + beatEnv * .025
q    = rot(rotA) * p
r    = length(q);  a = atan(q.y, q.x) + PI          // a: 0..2π

// 1) 背景（宇宙の塵と放射状の筋）
dust   = step(.9975, hash(floor(p * 900.))) * .6           // 微細な星（1 画素）
streak = pow(noise3(vec3(a * 6., r * 1.5 - t * .15, 3.)), 6.) * smoothstep(1.2, .15, r)
col    = secondary * (.006 + streak * .05) + vec3(dust) * .35

// 2) 光の核（コア）
R0   = .075 + bass * .035 + beatEnv * .02                // 光線の根元の半径
core = exp(-r / (R0 * .55)) * (1.2 + bass * 4. + beatEnv * 2.)
corona = core * (.6 + .4 * noise3(vec3(cos(a) * 3., sin(a) * 3., t * .6)))
col += mix(accent, vec3(1.), .5) * corona

// 3) 64 本の光線（左右対称：帯域 0..31 を右半分、31..0 を左半分へ鏡像に並べる）
u    = a / TAU * 64.
idx  = floor(u);  f = fract(u) - .5
band = idx < 32. ? idx : 63. - idx
L = bands[band].x;  G = bands[band].y
len  = .06 + L * .40 + bass * .05                         // 光線の長さ
s    = (r - R0) / len                                     // 根元 0 → 先端 1
dAng = f * TAU / 64.;  d = abs(sin(dAng)) * r              // 光線中心線からの距離
w    = .0016 + .0040 * clamp(s, 0., 1.)                    // 根元から先へ少し広がる
beam = exp(-pow(d / w, 2.)) + .12 * exp(-d / (w * 5.))    // 芯 ＋ 柔らかい光暈
along = smoothstep(0., .04, s) * (1. - smoothstep(.85, 1., s))
tip   = exp(-pow((s - 1.) * len / .012, 2.)) * L          // 先端の光点
heat  = mix(vec3(1.), bandRamp(band / 31.), smoothstep(.0, .55, s))  // 根元は白熱
I     = (.25 + L * 5.) * (1. + bands[band].w * .5)
col  += heat * beam * along * I + bandRamp(band / 31.) * tip * 3.

// 4) 残光（光線が縮んだあとに薄く残る）
lenG  = .06 + G * .40
trail = exp(-pow(d / (w * 1.6), 2.)) * smoothstep(R0, R0 + .02, r) * (1. - smoothstep(R0 + lenG - .02, R0 + lenG, r))
col  += bandRamp(band / 31.) * trail * G * .35

// 5) 拍の衝撃リング（直近 4 拍。色収差つき）
for each beat k with age α < .7:
  rad = R0 + α * (.95 * song.x + .3)
  wid = .003 + α * .012;  amp = pow(1. - α / .7, 2.) * 2.5
  col.r += accent.r * amp * exp(-pow((r - rad * 1.006) / wid, 2.))
  col.g += accent.g * amp * exp(-pow((r - rad)         / wid, 2.))
  col.b += accent.b * amp * exp(-pow((r - rad * .994)  / wid, 2.))

// 6) 小節頭：画面全体の露出をわずかに上げる
col *= 1. + barEnv * .25
```

- 粒子の火花：帯域のオンセット（`bands[band].w > .6`）があった光線の先端から、粒子を 8 個放つ。
  - 初速は光線の向き × `(.25 + L * .5)`。寿命は 0.5 秒。
  - 既存の GPU 粒子の仕組みを使う（新しい描画パスは作らない）。
  - 色は `bandRamp`、HDR の明るさは 2.0。

---

## 3. `g-galaxy` 周波数の銀河

点の描画（加算合成）と、背景・核のための全画面パス 1 枚で描く。

```
// 視点：円盤を 62° 傾けて見下ろす。ゆっくり回す
tilt = radians(62.);  spin = t * .03 * song.x
円盤座標 (x, y) → 画面: X = x, Y = y * cos(tilt)
（円盤全体を spin で回してから投影する）

// 軌道（帯域 i = 0..31）
r_i   = .10 + .78 * pow(i / 31., .9)
omega = (.25 + 1.2 * (1. - i / 31.)) * song.x            // 内側ほど速い
phase_i は CPU で積分する: phase_i += dt * omega * (1. + L_i * 1.5)

// 粒子：軌道ごとに 1024 個（合計 32,768）。粒子 j の値
θ  = TAU * j / 1024. + phase_i + hash(i, j) * .02
腕 = .55 + .45 * cos(2. * (θ - log(r_i) * 3.2 - t * .05))  // 2 本の渦巻き腕
rr = r_i * (1. + .05 * L_i * sin(3. * θ + t * 2.)) + (hash(i, j, 1) - .5) * .012
pos   = (cos θ, sin θ) * rr → spin で回転 → tilt で投影
size  = (1.4 + L_i * 3.2 + pulse.x * 1.) px（1080p 基準。解像度に比例させる）
I     = (.10 + pow(L_i, 1.2) * 3.2) * 腕 * (1. + pulse.x * .6)
color = bandRamp(i / 31.)
奥行きの明るさ：Y が奥（画面上方向）ほど 0.75 倍まで暗くする
```

- **銀河の核**（全画面パス）：
  - `bulge = exp(-length(vec2(X, Y / cos(tilt))) / .07) * (.8 + bass * 3.5 + pulse.x * 1.5)`
  - 色は `mix(accent, vec3(1.), .6)`。
- **暗黒帯（ダストレーン）**：
  - 円盤座標で `lane = smoothstep(.45, .55, noise3(vec3(θ * 2., rr * 8., 1.)))` を求める。
  - 点の明るさに `(1. - lane * .5)` を掛ける。
- **拍**：円盤全体のスケールを `1 + pulse.x * .035` にする。さらに、核から円盤面に沿って衝撃リング（§2 の 5 と同じ式）を楕円に投影して描く。
- **背景**：§2 の 1 と同じもの。

---

## 4. `g-fluid` スペクトル流体の修正

1. 色は §1.1 のパレットを使う。単色で画面を覆わない。染料には `bandRamp(band / 31.)` を注入する。
2. **くし状の縞の禁止**：噴出点を規則的な列に並べない。
   - 帯域 i の噴出点を、曲線上の点 `C(s_i)` に置く。曲線は半径 0.32 の円弧（中心角 220°）で、`s_i = i / 31`。
   - 曲線全体を、流体の大域の流れで毎フレーム移流させる（最大 0.02 /s）。
   - 注入は、半径 `.010 + L_i * .018` のガウス形の「ひと吹き」にする。量は `pow(L_i, 1.5) * 6.0`。
   - 注入点には、毎フレーム小さなランダムなずれ（±0.006、決定的なハッシュ）を加える。
3. **拍のパルス**：露出を `1 + pulse.x * .30`、流体の速度に放射状の加速 `pulse.x * 40.`（格子セル/秒）を加える。
4. 低域：`bass` に比例して、画面中心の渦の強さを 1〜3 倍にする。

---

## 5. 実音での撮影と計測（`tests/world/shoot-live.mjs`）

renderAt（拍の格子による簡易の特徴量）では、帯域の反応を確かめられない。そこで実際に再生して撮影する。

- **起動**
  - 起動は `node tests/world/shoot-live.mjs [--types g-rings,g-galaxy,g-fluid] [--times 20,31,45,90] [--wav path]`。
  - Chrome は、環境変数 `WORLD_CHROME_WRAPPER` で指定された起動ラッパー（実 GPU）で開く。
- **曲**：`--wav` を省略したときは、`synthSong(48000, {bpm:128, seed:11})` を使う。
- **撮影**
  - タイプと時刻 t ごとに、`audio.currentTime = t - 1.5` にシークして再生する。
  - `currentTime ≥ t` になった最初の rAF の後に、画面を撮影する。
  - 保存先は `tests/world/output/live/<type>-<t>.png`。
- **G-1 の計測**（同じ再生の中で行う）
  - 各帯域に対応する画面領域を決める。g-rings ではその帯域の光線の扇形、g-galaxy ではその帯域の軌道の環。
  - 各フレームで、その領域の平均輝度と `L_i` を記録する。
  - 全帯域を通した相関係数の中央値を出力する（基準 ≥ 0.6）。

---

## 6. 受け入れ（実装者が満たすこと）

- §2〜§4 の数式と定数を、名前つき定数としてそのまま実装する。
- §5 の撮影スクリプトを作る。
- 既存の G-2〜G-4 と W/BW のうち、引き続き当てはまるものを通す。
