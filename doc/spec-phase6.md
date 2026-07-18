# Phase 6 設計仕様書 — 拡張表現（時間軸・擬似3D・流体・幾何）

- Repository: `masa-san-jp/Audio-visual-analyzer`
- Document version: `v1.1`
- Date: `2026-07-12`
- 親仕様書: `doc/spec.md`（v1.4）
- 関連文書: `doc/plan-phase6.md`（実装計画書）/ `doc/test-phase6.md`（テスト設計書）
- Purpose: Phase 6「拡張表現」の実装委託用 詳細設計仕様

---

## 1. 目的・位置付け

Phase 5 までのアナライザー表現（棒グラフ / 円形放射 × 棒 / 波形線 / 点）に加え、
**時間軸系・擬似3D系・パーティクル/流体系・幾何系** の新表現 13 タイプ + 共通修飾 1 種を追加する。

本書は `doc/spec.md` の固定方針（ブラウザ中心・外部ライブラリなし・ビルド不要・
Canvas 2D API）を**すべて維持**した上での詳細設計である。WebGL は使用しない。

### 1.1 追加する表現一覧

| # | ID | 名称 | 系統 |
|---|----|------|------|
| T1 | `spectrogram` | スペクトログラム（滝） | 時間軸 |
| ~~T2~~ | ~~`spectrogram-radial`~~ | ~~円形スペクトログラム（年輪）~~ | 削除（v1.1） |
| T3 | `terrain` | 3D地形（時間×周波数メッシュ） | 時間軸×擬似3D |
| T4 | `tunnel` | トンネル（奥行き放射） | 時間軸×擬似3D |
| T5 | `bar3d` | 擬似3Dバー（アイソメトリック） | 擬似3D |
| T6 | `ring3d` | 回転3Dリング | 擬似3D |
| T7 | `particles` | パーティクル放出 | 粒子/流体 |
| T8 | `ripple` | 波紋（リップル） | 粒子/流体 |
| T9 | `flow` | ノイズフロー（煙） | 粒子/流体 |
| T10 | `metaball` | メタボール | 粒子/流体 |
| T11 | `lissajous` | オシロスコープ（XY / リサージュ） | 幾何 |
| T12 | `flower` | 極座標フラワー | 幾何 |
| T13 | `voronoi` | ボロノイ脈動 | 幾何 |
| M1 | `physicsAmount` | 粘性揺らぎ（バネ物理修飾） | 共通修飾 |

※ 「ミラー山脈」は既存機能の組み合わせ（`bar` タイプ × `line` 表現 ×
`mirror-vertical`）で実現済みのため、新規タイプとしては追加しない。

---

## 2. 全体方針

1. **既存の2軸構造を拡張する**: `analyzerType` の選択肢を 2 → 15 に拡張する。
   `expressionMethod`（棒/波形線/点）は対応可能なタイプのみに適用する（§4.4 ケイパビリティマップ）。
2. **ステートフルレンダラーの導入**: 時間軸系・粒子系は「フレームをまたぐ状態」
  （履歴・粒子配列・バネ状態）を持つ。既存の純関数レンダラーと共存できる
   レジストリ構造を導入する（§4.1）。
3. **ロジックとCanvas描画の分離**: 射影計算・ノイズ・バネ・ビート検出・ボロノイ分割
   などのロジックは**純関数/純クラスとして分離**し、Node で単体テスト可能にする
  （`doc/test-phase6.md` §3）。
4. **性能予算の明文化**: すべてのタイプに描画要素数の上限と目標フレーム時間を定める（§8）。
5. **既存機構の再利用**: 残像（`afterimageIntensity`）・レイヤー帯域分割・色相連続変化・
   ランダマイズ・録画は新タイプでも一貫して機能させる。

---

## 3. 用語

| 用語 | 定義 |
|---|---|
| フレームデータ | 1描画フレーム分の解析データ一式（周波数配列・時間波形・ビート情報） |
| 履歴バッファ | 直近 N フレーム分の周波数データを保持するリングバッファ |
| ステートフルレンダラー | フレーム間で内部状態を持つレンダラー（クラスインスタンス） |
| ビート | 低域エネルギーが移動平均を一定比率超えた瞬間（§5.4） |
| ケイパビリティ | タイプごとの対応機能（表現方法・レイヤー・表示モード等）の宣言 |

---

## 4. アーキテクチャ変更

### 4.1 レンダラーインターフェース v2

#### 4.1.1 レジストリ

`js/visualizer-core.js` のレンダラー選択マップを、次のレジストリ構造に置き換える。

```js
// js/renderer-registry.js（新規）
const RENDERER_REGISTRY = {
  // 既存（純関数・ステートレス）
  bar: {
    label: '棒グラフ',
    stateful: false,
    methods: { bar: renderBars, line: renderLines, dot: renderDots },
    capabilities: { layers: true, barDisplayMode: true, needs: ['freq'] },
  },
  radial: { /* 同様 */ },

  // 新規（ステートフル）
  spectrogram: {
    label: 'スペクトログラム',
    stateful: true,
    create: (canvas) => new SpectrogramRenderer(canvas),
    capabilities: { layers: false, barDisplayMode: false,
                    needs: ['freq', 'history'] },
  },
  // ... T2〜T13 同様
};
```

#### 4.1.2 ステートフルレンダラーの共通インターフェース

```js
class BaseStatefulRenderer {
  constructor(canvas) {}          // 状態初期化（粒子配列・オフスクリーン等）
  onResize(canvas) {}             // canvas サイズ変更時（レイアウト再計算）
  render(ctx, canvas, frame, settings) {}  // 毎フレーム描画
  dispose() {}                    // オフスクリーン解放等（省略可）
}
```

- `frame` は §4.2.3 のフレームデータオブジェクト。
- `VisualizerCore` はタイプ切替時に旧インスタンスを `dispose()` → 新タイプを生成する。
- `resize()` 時は `onResize()` を呼ぶ（インスタンスは維持。履歴等はレンダラー判断でリセット可）。
- ステートフルレンダラーは**自前で背景クリアしない**。クリア・残像は従来どおり
  `VisualizerCore._clearWithAfterimage()` が行う。
  例外: `spectrogram` / `spectrogram-radial` は全面を自分で塗るため、
  ケイパビリティ `selfClear: true` を宣言し、コアはクリアをスキップする。

#### 4.1.3 VisualizerCore の描画ループ変更

```
_loop():
  1. captureFrame()（freq + time を1回ずつ取得）
  2. frame オブジェクト組み立て（history.push、beat 更新を含む）
  3. クリア（selfClear タイプはスキップ）
  4. ステートレス: レイヤーループで従来どおり renderer(ctx, canvas, layerData, layerSettings)
     ステートフル : activeRenderer.render(ctx, canvas, frame, effectiveSettings) を1回呼ぶ
                    （レイヤー処理はレンダラー内部で行う。§4.4 layers=false のタイプは全帯域を使う）
```

### 4.2 AudioEngine 拡張

#### 4.2.1 時間波形データ

```js
// js/audio-engine.js に追加
captureFrame() {
  this.analyser.getByteFrequencyData(this.dataArray);
  this.analyser.getByteTimeDomainData(this.timeArray);  // 追加（fftSize 長）
}
getTimeDomainData()  // timeArray を返す（T11 リサージュが使用）
```

#### 4.2.2 履歴バッファ `FrameHistory`（新規 `js/history-buffer.js`）

- 固定容量リングバッファ。`capacity` フレーム分の `Uint8Array` を**事前確保**し、
  `push()` はコピーのみ行う（GC 回避）。
- API: `constructor(capacity, frameLength)` / `push(data)` / `get(age)`（age=0 が最新）/
  `size` / `clear()` / `setFrameLength(len)`（レイアウト変更時に全消去して作り直し）
- 容量は `historySeconds`（§4.3）× 60fps 換算で決定し、上限 **240 フレーム**。

#### 4.2.3 フレームデータオブジェクト

```js
frame = {
  freq,        // Uint8Array: 50Hz〜15kHz スライス（全帯域）
  getLayer(i, count),  // 既存 getLayerData 相当
  time,        // Uint8Array: 時間波形（fftSize 長）
  history,     // FrameHistory（freq の履歴）
  beat,        // { isBeat: bool, energy: 0..1, sinceBeatMs: number }
  dtMs,        // 前フレームからの経過時間（性能変動の吸収に使用）
}
```

#### 4.2.4 ビート検出 `BeatDetector`（新規 `js/vis-utils.js` 内）

§5.4 参照。`VisualizerCore` が毎フレーム `update(freq)` を呼ぶ。

### 4.3 設定追加（`js/settings.js`）

| キー | 範囲 / 既定値 | 用途（使用タイプ） |
|---|---|---|
| `historySeconds` | 1〜8 / **4** | 履歴の長さ（T1,T2,T3,T4） |
| `motionSpeed` | 0.1〜3.0 / **1.0** | 回転・流れ・脈動の速度（T2,T4,T6,T9,T12） |
| `particleAmount` | 10〜100 / **50** | 粒子・要素の量（T7,T9,T8,T10,T13） |
| `physicsAmount` | 0〜10 / **0** | 粘性揺らぎ量（M1。line/dot 系表現全般） |

- 既存パラメーターの流用: `barWidth`（線・粒の太さ）、`density`（要素密度）、
  `sensitivity`（反応量）、`baseOffset`（基準点/半径オフセット）、
  `afterimageIntensity`（残像）は新タイプでも同じ意味論で適用する。
- 追加スライダーは4本のみとし、UI の肥大化を避ける（§7）。

### 4.4 ケイパビリティマップ

| タイプ | 表現方法 (bar/line/dot) | レイヤー | 表示モード(ミラー) | selfClear | 使用データ |
|---|---|---|---|---|---|
| `bar`（既存） | ✓ 3種 | ✓ | ✓ | – | freq |
| `radial`（既存） | ✓ 3種 | ✓ | – | – | freq |
| T1 `spectrogram` | –（固有描画） | – | – | ✓ | freq, history |
| T2 `spectrogram-radial` | – | – | – | ✓ | freq, history |
| T3 `terrain` | ✓ line/dot | – | – | – | freq, history |
| T4 `tunnel` | ✓ line/dot | – | – | – | freq, history |
| T5 `bar3d` | –（固有描画） | ✓ | – | – | freq |
| T6 `ring3d` | ✓ bar/line/dot | ✓ | – | – | freq |
| T7 `particles` | ✓ dot/line(軌跡) | ✓ | – | – | freq, beat |
| T8 `ripple` | –（固有描画） | ✓ | – | – | freq, beat |
| T9 `flow` | ✓ dot/line(軌跡) | ✓ | – | – | freq |
| T10 `metaball` | – | ✓ | – | – | freq |
| T11 `lissajous` | ✓ line/dot | – | – | – | time |
| T12 `flower` | ✓ bar/line/dot | ✓ | – | – | freq |
| T13 `voronoi` | – | ✓ | – | – | freq |

- UI は選択タイプのケイパビリティに応じて、非対応コントロールを**非表示**にする。
- 「アナライザーランダマイズ」はこの表に従い、対応組み合わせのみ選ぶ。
- レイヤー「–」のタイプ選択中はレイヤー数UIを無効化し、実効レイヤー数1で動作する
 （設定値自体は保持し、対応タイプへ戻したとき復元される）。

### 4.5 ファイル構成（追加・変更）

```text
/js
├─ vis-utils.js          # 新規: 純ロジック集（§5）
├─ history-buffer.js     # 新規: FrameHistory
├─ renderer-registry.js  # 新規: レジストリ + ケイパビリティ
├─ visualizer-core.js    # 変更: ループv2・frame組立・ステートフル対応
├─ audio-engine.js       # 変更: time波形取得
├─ settings.js           # 変更: 新設定4種
├─ ui-controller.js      # 変更: タイプ選択拡張・動的表示・ランダマイズ対応
└─ /renderers
   ├─ bars.js / lines.js / dots.js / radial.js   # 既存（変更なし〜微修正）
   ├─ spectrogram.js     # 新規: T1 + T2
   ├─ terrain.js         # 新規: T3
   ├─ tunnel.js          # 新規: T4
   ├─ bar3d.js           # 新規: T5
   ├─ ring3d.js          # 新規: T6
   ├─ particles.js       # 新規: T7 + T9（粒子基盤を共有）
   ├─ ripple.js          # 新規: T8
   ├─ metaball.js        # 新規: T10
   ├─ lissajous.js       # 新規: T11
   ├─ flower.js          # 新規: T12
   └─ voronoi.js         # 新規: T13
/test                    # doc/test-phase6.md 参照
```

`index.html` の `<script>` は 依存順（vis-utils → history-buffer → renderers →
renderer-registry → visualizer-core）で読み込む。

---

## 5. 共通ユーティリティ仕様（`js/vis-utils.js`）

すべて**純関数または純クラス**とし、DOM / Canvas に依存しないこと（単体テスト対象）。

### 5.1 ValueNoise（値ノイズ）

- `class ValueNoise { constructor(seed); noise2(x, y): number /* 0..1 */ }`
- 格子点ハッシュ + スムーズ補間（smoothstep）による 2D 値ノイズ。オクターブ合成
  `fbm(x, y, octaves=3)` を持つ。seed 固定で**決定的**（テスト可能）。
- 用途: T9 flow の流れ場、T12 flower の揺らぎ。

### 5.2 Spring（バネ・粘性）

- `class Spring { constructor(stiffness, damping); target(v); update(dtMs): number }`
- 臨界減衰近傍の1次元バネ。`physicsAmount`(0〜10) を
  stiffness/damping にマップする変換関数 `springParamsFromAmount(amount)` を提供。
- `class SpringArray`: N 本のバネをフラット `Float32Array` で一括更新（波形線の頂点用）。
- 用途: M1 粘性揺らぎ、T10 metaball の半径揺れ。

### 5.3 射影・座標系

- `isoProject(x, y, z) -> {x, y}`: 平行投影。`x' = x + z*ISO_KX, y' = y - z*ISO_KY`
 （既定 `ISO_KX=0.5, ISO_KY=0.35`。定数はレンダラー側で上書き可）。
- `polarToXy(cx, cy, r, angleRad) -> {x, y}`
- `clamp(v, min, max)` / `lerp(a, b, t)`

### 5.4 BeatDetector

- `class BeatDetector { update(freq, nowMs): {isBeat, energy, sinceBeatMs} }`
- アルゴリズム: 低域（データ先頭から全長の 1/8 分）の平均振幅 `e` を計算し、
  指数移動平均 `ema`（係数 0.03）と比較。`e > ema * 1.4` かつ前回ビートから
  200ms 以上経過でビート判定。`energy = e / 255`。
- 決定的（`nowMs` を引数で受け取り、内部で `Date.now()` を使わない）。

### 5.5 Voronoi 分割

- `computeVoronoiCells(sites, width, height) -> Array<{site, polygon: [{x,y}...]}>`
- 各サイトの初期セル = キャンバス矩形。他サイトとの垂直二等分線で半平面クリップ
 （Sutherland–Hodgman）を繰り返す O(n²) 実装。n ≤ 80 のためリサイズ時のみ実行で十分。
- サイト生成 `generateJitteredSites(cols, rows, jitter, seed)`（決定的）。

---

## 6. 各アナライザータイプ仕様

各タイプ共通の記載項目: **概要 / アルゴリズム / パラメーター対応 / 性能予算 / 受け入れ条件**。
色は既存の HSL 決定則（`hue` + 帯域・振幅による `hueRange`/`brightness`/`saturation` 変調、
レイヤー `hueOffset`）を踏襲する。

### 6.1 T1 `spectrogram` — スペクトログラム（滝）

- **概要**: 横軸=時間（右端が現在）、縦軸=周波数（下=低域）、色=強度のヒートマップ。
- **アルゴリズム**:
  1. オフスクリーンキャンバス（メイン同サイズ）を保持。
  2. 毎フレーム、オフスクリーン全体を `drawImage` で左へ `shiftPx` ずらす
     （`shiftPx = max(1, round(canvas.width / (historySeconds * 60)))`）。
  3. 右端 `shiftPx` 幅に現在の `freq` を縦1列描画。ビン→ y は**対数周波数スケール**、
     強度→色は `hue`（低強度=暗/背景色、高強度=明・彩度高）。
  4. メインへ `drawImage`。`selfClear: true`。
- **パラメーター**: `historySeconds`(時間幅) / `sensitivity`(強度ゲイン) /
  `density`(縦解像度: 使用ビン数を 30〜100% に間引き)。
- **性能予算**: 1フレームあたり drawImage×2 + fillRect ≤ 512。60fps 維持。
- **受け入れ条件**: 再生中に模様が右→左へ流れる。無音で背景色になる。
  リサイズ後も破綻しない（履歴はクリアされてよい）。

### 6.2 T2 `spectrogram-radial` — 円形スペクトログラム（年輪）

- **概要**: 中心=現在、外周=過去。角度=周波数、半径=時間の年輪状ヒートマップ。
- **アルゴリズム**: `FrameHistory` から各リング（age t）を読み、半径
  `r(t) = rMin + (rMax - rMin) * t / N` の円弧セグメント（角度分割 ≤ 128）で描画。
  1フレームに全リングを描き直すのではなく、オフスクリーンを毎フレーム
  中心へ縮小 `drawImage`（スケール `rNext/r`）+ 最内周のみ新規描画する方式を推奨。
  `motionSpeed` で縮小速度（=時間の流れ）を可変。`selfClear: true`。
- **性能予算**: 円弧描画 ≤ 128 セグメント + drawImage×2。
- **受け入れ条件**: 年輪が外側へ流れる。1:1 と 16:9 の両方で中心が正しい。

### 6.3 T3 `terrain` — 3D地形（時間×周波数メッシュ）

- **概要**: 過去 N フレームの周波数列を奥行き方向に並べ、平行投影で描く地形。
- **アルゴリズム**:
  1. `FrameHistory` から `rows = min(size, 90)` 行を等間隔サンプル。
  2. 各行を `cols = 32 + round(density/100 * 64)` 点に間引き。
  3. 点 `(col, row)` の高さ `h = freq * sensitivity * 高さ係数`、
     `isoProject(colX, baseY, rowZ)` で 2D へ。行は奥ほど**上へ + 中央へ縮小 + 暗く**。
  4. `expressionMethod = line`: 行ごとにポリライン（稜線）。**奥→手前**の順に、
     各稜線の下側を背景色で塗りつぶしてから線を描く（隠面処理の代替）。
     `dot`: 頂点のみ点描（塗りつぶし遮蔽なし）。
- **パラメーター**: `historySeconds`(奥行き) / `density`(列数) / `barWidth`(線幅) /
  `baseOffset`(全体の縦位置)。
- **性能予算**: 頂点 ≤ 90×96 = 8,640。パス結合で stroke 呼び出し ≤ 行数。
- **受け入れ条件**: 山が奥から手前へ流れて見える。手前の稜線が奥を正しく隠す（line時）。

### 6.4 T4 `tunnel` — トンネル（奥行き放射）

- **概要**: radial の各リングが時間経過で奥（中心）から手前（外周）へ拡大してくるトンネル。
- **アルゴリズム**: リング状態 `{scale, freqSnapshot}` の配列（≤ 24 本）を保持。
  一定間隔（`historySeconds` と `motionSpeed` から算出）で現在の freq を持つ新リングを
  scale=0.05 で生成し、毎フレーム scale を指数的に拡大、scale>1.6 で破棄。
  各リングは radial と同じ形状描画（半径 = scale × 基準半径 + freq 変位）。
  奥ほど暗く・細く。`line`/`dot` 表現対応。
- **性能予算**: リング ≤ 24 × セグメント ≤ 96。
- **受け入れ条件**: リングが連続的に湧き出て手前へ抜ける。残像併用で破綻しない。

### 6.5 T5 `bar3d` — 擬似3Dバー（アイソメトリック）

- **概要**: 各帯域バーを上面+右側面付きの直方体として描く立体棒グラフ。
- **アルゴリズム**: バー数 = 既存 bar と同じ `density` 準拠（≤ 96）。
  各バーで前面（既存色）→ 右側面（明度 -20%）→ 上面（明度 +15%）の順に
  平行四辺形を描画。**左から右へ**描き重ね順を保つ。レイヤーは奥行き方向に
  `isoProject` で 1 レイヤーずつ後退させて重ねる（レイヤー対応 ✓）。
- **性能予算**: バー ≤ 96 × 面 3 × レイヤー ≤ 4。
- **受け入れ条件**: 立体に見える（3面の明度差）。4レイヤー時に階段状に並ぶ。

### 6.6 T6 `ring3d` — 回転3Dリング

- **概要**: 水平に置いた円環にバーを立て、環がY軸回転して見える表現。
- **アルゴリズム**: 角度 `θ_i` に等配置した要素（≤ 96）を位相 `φ += motionSpeed * dt`
  で回転。楕円写像 `x = cx + R cosθ`, `y = cy + R sinθ * TILT`（TILT≈0.35）。
  `sinθ`（奥行き）で描画順ソート（奥→手前）、奥は明度・太さを減衰。
  高さ = freq 変位を上方向に描く。bar=縦線 / line=頂点を結ぶ帯 / dot=点。
- **性能予算**: 要素 ≤ 96 × レイヤー ≤ 4（レイヤーは半径を段階化）。
- **受け入れ条件**: 回転して見える。奥の要素が手前より暗い。`motionSpeed` 0.1〜3.0 が効く。

### 6.7 T7 `particles` — パーティクル放出

- **概要**: 帯域ごとの発生源から音の強さに応じて粒子を放出。重力・減衰で舞う。
- **アルゴリズム**: 粒子プール（**固定長 `Float32Array` 群、最大 600**）。
  発生源はレイヤー帯域ごとに横軸配置（レイヤー1なら全帯域を 8 分割）。
  毎フレーム、各源の振幅に比例した数を放出（`particleAmount` でスケール、
  ビート時は 2 倍バースト）。初速は上向き + ランダム散乱、重力 g、寿命 1〜2s、
  寿命でフェードアウト。`dot`=円 / `line`=前位置との線分（軌跡）。
- **性能予算**: 生存粒子 ≤ 600。1フレームの新規放出 ≤ 60。プール枯渇時は放出を間引く。
- **受け入れ条件**: 音が大きいほど粒子が増える。上限を超えない（開発用カウンタで確認）。
  無音時は自然に消滅していく。

### 6.8 T8 `ripple` — 波紋（リップル）

- **概要**: ビートで中心（またはレイヤーごとの点）から同心円の波が広がり干渉する。
- **アルゴリズム**: 波オブジェクト `{x, y, r, amp, born}` の配列（≤ 32）。
  `beat.isBeat` で生成（amp = beat.energy）。毎フレーム r += 速度、amp 指数減衰、
  amp < 0.02 で破棄。円は太さ `barWidth`、透明度 = amp で描画。
  レイヤー ≥ 2 のときは発生点を横に等配置し、帯域エネルギーの
  ローカルピーク（前フレーム比 +30%）でも生成する。
- **性能予算**: 波 ≤ 32 本 / フレーム。
- **受け入れ条件**: ビートに同期して波が出る。連打でも 32 本を超えない。

### 6.9 T9 `flow` — ノイズフロー（煙）

- **概要**: パーリンノイズ場に沿って粒子が流れる煙状表現。低域=太く遅い流れ、
  高域=細く速い乱流。
- **アルゴリズム**: 粒子プール（≤ 400、T7 と実装共有）。粒子は画面内ランダム配置で
  常時生存（寿命でリスポーン）。速度 = `ValueNoise.fbm(x*s, y*s + t)` から角度場を作り
  追従。ノイズの時間発展 t は `motionSpeed`、変位量は担当帯域の振幅 × `sensitivity`。
  レイヤーごとに帯域を割り当て、線分（前位置→現位置）で描く。
  **残像（afterimage）併用を既定の見せ方とする**（UI 側で本タイプ選択時に
  `afterimageIntensity` が 0 なら 4 を推奨初期値として設定してよい）。
- **性能予算**: 粒子 ≤ 400。ノイズ評価 ≤ 400 回/フレーム。
- **受け入れ条件**: 流れが有機的に変化する。音量で流速が変わる。60fps を維持する。

### 6.10 T10 `metaball` — メタボール

- **概要**: 帯域ごとの「音で膨らむ円」が近づくと融合して見える流体塊。
- **アルゴリズム**（Canvas 2D の blur+contrast 方式）:
  1. オフスクリーンに、ブロブ（レイヤー/帯域ごと ≤ 12 個）を放射状グラデーション
    （中心不透明→外周透明）で `globalCompositeOperation='lighter'` 描画。
     半径 = 基準 + 帯域振幅 × `sensitivity`（Spring で揺らす）。位置はゆっくり周回。
  2. メインへ `ctx.filter = 'blur(12px) contrast(24)'` で転写 → 輪郭が融合した
     しきい値形状になる。転写後 filter をリセット。
  3. 色は転写時 `globalCompositeOperation='source-in'` で単色→HSL 適用、
     またはブロブ自体を色分けし filter 転写のみ（実装選択可。既定は後者）。
- **フォールバック**: `ctx.filter` 非対応環境（保証対象外ブラウザ）では
  ブロブを通常の半透明円として描画する（融合なし）。
- **性能予算**: ブロブ ≤ 12。オフスクリーン解像度はメインの 1/2（filter コスト削減）。
- **受け入れ条件**: 2つ以上のブロブが接近時に融合して見える。1080p 相当で 60fps。

### 6.11 T11 `lissajous` — オシロスコープ（XY / リサージュ）

- **概要**: 時間波形をアナログオシロ風に描く。モードは XY（位相遅延埋め込み）を既定とし、
  X-t（横軸掃引）も `barDisplayMode` 相当の内部オプションで切替可能な設計とする。
- **アルゴリズム**（XY）: `time` 配列（fftSize=2048 点）から
  `x_i = time[i]`, `y_i = time[i + delay]`（`delay = 128 + baseOffset*4`）を
  [-1,1] 正規化してキャンバス中央にプロット。`line`=ポリライン / `dot`=点描。
  点数は `density` で 256〜2048 に間引き。輝線らしさのため
  `barWidth` + 残像併用を推奨（flow と同じ推奨初期値の扱い）。
- **性能予算**: 頂点 ≤ 2048 / フレーム（単一ポリライン）。
- **受け入れ条件**: 正弦波入力（テストハーネス）で楕円〜リサージュ形状になる。
  無音時は中央の点/横線に収束する。

### 6.12 T12 `flower` — 極座標フラワー

- **概要**: 帯域を花弁に写像し、音で開閉する曼荼羅状の花。
- **アルゴリズム**: 花弁数 `k = 4 + round(density/100 * 12)`。
  輪郭 `r(θ) = R0 + A * |sin(kθ/2 + φ)| * env(θ)`、`env(θ)` は θ に対応する帯域の振幅。
  `φ += motionSpeed * dt` でゆっくり回転。ValueNoise で輪郭に微揺らぎを加える。
  レイヤー = 花弁の重ね（半径段階 + hueOffset）。bar=花弁を扇形塗り /
  line=輪郭線 / dot=輪郭上の点。
- **性能予算**: 輪郭サンプル ≤ 256 点 × レイヤー ≤ 4。
- **受け入れ条件**: 音に応じて花弁が開閉する。レイヤーで多重の花になる。

### 6.13 T13 `voronoi` — ボロノイ脈動

- **概要**: 画面をボロノイ分割し、各セルの明度・スケールが帯域に反応して脈打つモザイク。
- **アルゴリズム**:
  1. リサイズ時のみ `generateJitteredSites`（`particleAmount` → セル数 20〜80）
     → `computeVoronoiCells` でセルポリゴン確定。
  2. セルを x 座標順に帯域へ割当（左=低域）。毎フレーム、担当帯域振幅から
     明度・彩度と**セル縮小率**（重心へ 0〜15% 縮小）を決めて塗る。
     セル境界線は `barWidth`。ビートで全セルを一瞬増光（+15%）。
- **性能予算**: セル ≤ 80。ポリゴン再計算はリサイズ/セル数変更時のみ。
- **受け入れ条件**: セルが個別に脈動する。リサイズで分割が再生成される。
  セル数変更（`particleAmount`）が反映される。

### 6.14 M1 粘性揺らぎ（共通修飾 `physicsAmount`）

- **概要**: line/dot 系表現の各頂点にバネ物理を入れ、水面のような粘りとオーバーシュートを与える。
- **アルゴリズム**: 対象レンダラーは頂点値の直前に `SpringArray` を通す。
  `physicsAmount=0` で完全バイパス（既存挙動と同一）。1〜10 で
  stiffness を下げ・オーバーシュートを増やす（`springParamsFromAmount`）。
- **適用対象**: 既存 `bar`/`radial` の line・dot、T3 terrain（最前列）、T6 ring3d、T12 flower。
  ステートレスな既存レンダラーへの導入は、`VisualizerCore` が保持する
  `SpringArray` を settings 経由で渡す方式とする（既存レンダラーの純関数性を維持）。
- **受け入れ条件**: `physicsAmount=0` で従来と完全同一の描画。値を上げると
  波形が「遅れて追従し、揺り戻す」。急峻な音でも発散しない（damping 下限で保証）。

---

## 7. UI 仕様

### 7.1 タイプ選択

- `<select id="analyzer-type">` を `<optgroup>` で系統別にグループ化する:
  「基本」（棒グラフ/円形放射）「時間軸」「擬似3D」「流体・粒子」「幾何」。
- 選択時、ケイパビリティマップ（§4.4）に基づき以下を動的に表示/非表示:
  表現方法 select（対応 method のみ option を残す）/ 表示モード / レイヤー数ボタン。

### 7.2 追加コントロール（感度・形状セクションに追加）

| ID | ラベル | 対応キー |
|---|---|---|
| `slider-history` | 時間幅（秒）1〜8 | `historySeconds` |
| `slider-motion` | 動きの速さ 0.1〜3.0 | `motionSpeed` |
| `slider-particles` | 要素量 10〜100 | `particleAmount` |
| `slider-physics` | 粘性揺らぎ 0〜10 | `physicsAmount` |

- 各スライダーは**それを使用するタイプ選択時のみ表示**する（ケイパビリティ連動）。

### 7.3 ランダマイズ

- アナライザーランダマイズ: タイプは全 15 種から選択。表現方法・表示モード・
  レイヤー数はケイパビリティ準拠で選ぶ。
- 形状ランダマイズ: 既存項目に `motionSpeed` / `particleAmount` / `physicsAmount` を追加
 （`historySeconds` はランダマイズ対象外＝視認性への影響が大きいため）。

### 7.4 リセット・既定値

- タイプ切替時に内部状態（履歴・粒子）はリセットする。設定値はリセットしない。
- flow / lissajous 選択時、`afterimageIntensity === 0` なら推奨値 4 を設定して
  スライダー表示も同期する（ユーザーが変更したら以後は触らない）。

---

## 8. 非機能要件

### 8.1 性能

- 目標: 一般的なデスクトップ（2020年以降の内蔵GPU機）・1080p 相当キャンバスで
  **描画ループ 16.7ms 以内（60fps）**、録画中も **33ms 以内（30fps）** を維持。
- 各タイプは §6 の性能予算（要素数上限）を実装でクランプする。
- 粒子・波・リングなどの動的オブジェクトは**固定長プール**で管理し、
  フレーム中の配列生成・クロージャ生成を避ける。
- `dtMs` を用い、フレーム落ち時も動きの速度が実時間基準で一定になるようにする。

### 8.2 メモリ

- FrameHistory は最大 240 フレーム × ビン数 ≤ 1024 = 約 240KB（Uint8Array）以内。
- オフスクリーンキャンバスは タイプ 1 つあたり最大 2 枚。`dispose()` で参照を破棄。

### 8.3 録画との整合

- 全タイプで録画（Phase 5 仕様: MP4/WebM・ビットレート自動・Duration パッチ）が
  正常動作すること。`ctx.filter` 使用タイプ（T10）も captureStream に反映されることを確認する。

### 8.4 後方互換

- 既存 2 タイプ（bar/radial）の描画結果は Phase 6 実装後も**ピクセル同等**であること
 （`physicsAmount=0` のとき）。設定 JSON に未知キーが増えるのみ。

---

## 9. 制約・割り切り

- 真の 3D（透視投影・深度バッファ）は行わない。平行投影 + 描画順制御で表現する。
- T10 metaball の融合表現は `ctx.filter` に依存する（Chrome/Edge = 主対象ブラウザで動作）。
  非対応環境はフォールバック描画（§6.10）とし、受け入れ条件から除外する。
- T11 lissajous はモノラル解析（既存 AnalyserNode 構成）のため、真のステレオ XY ではなく
  位相遅延埋め込みで代替する。ステレオ対応は将来検討（spec.md §23 に追記済み扱い）。
- スマホ最適化は引き続き対象外。

---

## 10. 受け入れ条件サマリー

1. アナライザータイプとして計 14 種（既存2 + 新規12）を選択できる
2. 各タイプで §6 の個別受け入れ条件を満たす
3. ケイパビリティ非対応の UI が選択タイプに応じて隠れる
4. ランダマイズが不正な組み合わせを生成しない
5. 全タイプで録画→保存→再生が成立する
6. 全タイプで背景色切替・アスペクト比切替・リサイズ後に描画が破綻しない
7. `physicsAmount=0` で既存タイプの描画が従来と同一
8. 性能予算内で 60fps（録画中 30fps）を維持する（測定手順は test-phase6.md §6）
9. 追加ライブラリ・ビルド工程が導入されていない

---

## 11. 改訂履歴

### v1.1（2026-07-12）— 実機レビューによる表現調整（Phase 6.1）

実機での目視レビューを受け、各タイプの見た目・操作性を改善した。基盤アーキテクチャ
（レジストリ・ステートフル機構・履歴・ビート検出）に変更はない。

| 対象 | 変更内容 |
|---|---|
| T1 スペクトログラム | 縦解像度を高め（1px行）、対数強度＋隣接ビン平均＋γ補正で微弱成分を繊細に表示。横送りを1〜2pxに抑え時間分解能を向上 |
| T2 円形スペクトログラム | **削除**（可読性が低いため）。レジストリ・クラスとも除去 |
| T3 3D地形 | 基準位置を画面**底辺基準**に変更し、`baseOffset` で上方向へ持ち上げる方式に。**奥行き角度**パラメーター（`depthAngle` 0〜100）を追加 |
| T4 トンネル | 16:9 で画面横幅いっぱいに広がるよう、リング半径基準を対角基準に変更 |
| T5 擬似3Dバー | 奥行き量を大幅に増やし、棒グラフとの差（立体感）を明確化 |
| T6 回転3Dリング | 環半径・高さ・画面占有を拡大し、画面を大きく使うよう変更 |
| T7 パーティクル | 加算合成のグロー描画に。点＝放射グラデーションの光球／線＝速度方向の流れ星状ストリークで明確に描き分け |
| T8 波紋 | ビートに加え**全体エネルギーの立ち上がり**でも発生させ、サウンド追従を明確化。線幅・輝度を音量に連動、加算合成で干渉を可視化 |
| T9 ノイズフロー | 点＝光点／線＝流線で明確に描き分け（従来は常に線）。加算合成でグロー |
| T10 メタボール | 中心をノイズで徘徊させ形状のランダム性を強化。個体差（半径・速度）を拡大、blur を画面比例・contrast を上げて融合を滑らかに |
| T11 オシロスコープ | `baseOffset` を位相遅延から**中心からの距離（広がり）**の制御に変更 |
| T12 極座標フラワー | **花弁数**の専用パラメーター（`petalCount` 2〜16）を追加。密度は輪郭解像度のみに |
| T13 ボロノイ脈動 | サイトをノイズで動的に移動＋音量で移動量を増幅し、形状が常に変化・音追従するよう変更（毎フレーム再計算）。`motionSpeed` で動作速度制御 |

追加設定: `depthAngle`(0〜100, 既定50) / `petalCount`(2〜16, 既定6)。
ケイパビリティ `sliders` に `angle` / `petals` を追加。
