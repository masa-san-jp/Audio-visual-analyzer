# Phase 6 設計仕様書 — 拡張表現（時間軸・幾何）

- Repository: `masa-san-jp/Audio-visual-analyzer`
- Document version: `v1.1`
- Date: `2026-07-12`
- 親仕様書: `doc/spec.md`（v1.4）
- 関連文書: `doc/plan-phase6.md`（実装計画書）/ `doc/test-phase6.md`（テスト設計書）
- Purpose: Phase 6「拡張表現」の詳細設計仕様

---

## 1. 目的・位置付け

Phase 5 までのアナライザー表現（棒グラフ / 円形放射 × 棒 / 波形線 / 点）に加え、
**時間軸系・幾何系** の新表現 4 タイプ + 共通修飾 1 種を追加する。

本書は `doc/spec.md` の固定方針（ブラウザ中心・外部ライブラリなし・ビルド不要・
Canvas 2D API）を**すべて維持**した上での詳細設計である。WebGL は使用しない。

### 1.1 追加する表現一覧

| # | ID | 名称 | 系統 |
|---|----|------|------|
| T1 | `spectrogram` | スペクトログラム（滝） | 時間軸 |
| T3 | `terrain` | 3D地形（時間×周波数メッシュ） | 時間軸 |
| T4 | `tunnel` | トンネル（奥行き放射） | 時間軸 |
| T11 | `lissajous` | オシロスコープ（XY / リサージュ） | 幾何 |
| M1 | `physicsAmount` | 粘性揺らぎ（バネ物理修飾） | 共通修飾 |

※ 「ミラー山脈」は既存機能の組み合わせ（`bar` タイプ × `line` 表現 ×
`mirror-vertical`）で実現済みのため、新規タイプとしては追加しない。

---

## 2. 全体方針

1. **既存の2軸構造を拡張する**: `analyzerType` の選択肢を 2 → 6 に拡張する。
   `expressionMethod`（棒/波形線/点）は対応可能なタイプのみに適用する（§4.4 ケイパビリティマップ）。
2. **ステートフルレンダラーの導入**: 時間軸系・幾何系は「フレームをまたぐ状態」
  （履歴・リング配列・バネ状態）を持つ。既存の純関数レンダラーと共存できる
   レジストリ構造を導入する（§4.1）。
3. **ロジックとCanvas描画の分離**: 射影計算・バネ・ビート検出
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
  // ... T3・T4・T11 同様
};
```

#### 4.1.2 ステートフルレンダラーの共通インターフェース

```js
class BaseStatefulRenderer {
  constructor(canvas) {}          // 状態初期化（履歴・オフスクリーン等）
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
  例外: `spectrogram` は全面を自分で塗るため、
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
| `historySeconds` | 1〜8 / **4** | 履歴の長さ（T1,T3,T4） |
| `motionSpeed` | 0.1〜3.0 / **1.0** | リングの湧き出し速度（T4） |
| `physicsAmount` | 0〜10 / **0** | 粘性揺らぎ量（M1。line/dot 系表現全般） |

- 既存パラメーターの流用: `barWidth`（線・粒の太さ）、`density`（要素密度）、
  `sensitivity`（反応量）、`baseOffset`（基準点/半径オフセット）、
  `afterimageIntensity`（残像）は新タイプでも同じ意味論で適用する。
- 追加スライダーは3本のみとし、UI の肥大化を避ける（§7）。

### 4.4 ケイパビリティマップ

| タイプ | 表現方法 (bar/line/dot) | レイヤー | 表示モード(ミラー) | selfClear | 使用データ |
|---|---|---|---|---|---|
| `bar`（既存） | ✓ 3種 | ✓ | ✓ | – | freq |
| `radial`（既存） | ✓ 3種 | ✓ | – | – | freq |
| T1 `spectrogram` | –（固有描画） | – | – | ✓ | freq, history |
| T3 `terrain` | ✓ line/dot | – | – | – | freq, history |
| T4 `tunnel` | ✓ line/dot | – | – | – | freq, history |
| T11 `lissajous` | ✓ line/dot | – | – | – | time |

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
├─ settings.js           # 変更: 新設定3種
├─ ui-controller.js      # 変更: タイプ選択拡張・動的表示・ランダマイズ対応
└─ /renderers
   ├─ bars.js / lines.js / dots.js / radial.js   # 既存（変更なし〜微修正）
   ├─ spectrogram.js     # 新規: T1
   ├─ terrain.js         # 新規: T3
   ├─ tunnel.js          # 新規: T4
   └─ lissajous.js       # 新規: T11
/test                    # doc/test-phase6.md 参照
```

`index.html` の `<script>` は 依存順（vis-utils → history-buffer → renderers →
renderer-registry → visualizer-core）で読み込む。

---

## 5. 共通ユーティリティ仕様（`js/vis-utils.js`）

すべて**純関数または純クラス**とし、DOM / Canvas に依存しないこと（単体テスト対象）。

### 5.2 Spring（バネ・粘性）

- `class SpringArray`: 臨界減衰近傍の1次元バネ N 本をフラット `Float32Array` で一括更新（波形線の頂点用）。
- `physicsAmount`(0〜10) を stiffness/damping にマップする変換関数
  `springParamsFromAmount(amount)` を提供。
- 用途: M1 粘性揺らぎ。

### 5.3 射影・座標系

- `isoProject(x, y, z) -> {x, y}`: 平行投影。`x' = x + z*ISO_KX, y' = y - z*ISO_KY`
 （既定 `ISO_KX=0.5, ISO_KY=0.35`。定数はレンダラー側で上書き可）。
- `clamp(v, min, max)` / `lerp(a, b, t)`

### 5.4 BeatDetector

- `class BeatDetector { update(freq, nowMs): {isBeat, energy, sinceBeatMs} }`
- アルゴリズム: 低域（データ先頭から全長の 1/8 分）の平均振幅 `e` を計算し、
  指数移動平均 `ema`（係数 0.03）と比較。`e > ema * 1.4` かつ前回ビートから
  200ms 以上経過でビート判定。`energy = e / 255`。
- 決定的（`nowMs` を引数で受け取り、内部で `Date.now()` を使わない）。

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

### 6.11 T11 `lissajous` — オシロスコープ（XY / リサージュ）

- **概要**: 時間波形をアナログオシロ風に描く。モードは XY（位相遅延埋め込み）を既定とし、
  X-t（横軸掃引）も `barDisplayMode` 相当の内部オプションで切替可能な設計とする。
- **アルゴリズム**（XY）: `time` 配列（fftSize=2048 点）から
  `x_i = time[i]`, `y_i = time[i + delay]`（`delay = 128 + baseOffset*4`）を
  [-1,1] 正規化してキャンバス中央にプロット。`line`=ポリライン / `dot`=点描。
  点数は `density` で 256〜2048 に間引き。輝線らしさのため
  `barWidth` + 残像併用を推奨（推奨初期値は §7.4）。
- **性能予算**: 頂点 ≤ 2048 / フレーム（単一ポリライン）。
- **受け入れ条件**: 正弦波入力（テストハーネス）で楕円〜リサージュ形状になる。
  無音時は中央の点/横線に収束する。

### 6.14 M1 粘性揺らぎ（共通修飾 `physicsAmount`）

- **概要**: line/dot 系表現の各頂点にバネ物理を入れ、水面のような粘りとオーバーシュートを与える。
- **アルゴリズム**: 対象レンダラーは頂点値の直前に `SpringArray` を通す。
  `physicsAmount=0` で完全バイパス（既存挙動と同一）。1〜10 で
  stiffness を下げ・オーバーシュートを増やす（`springParamsFromAmount`）。
- **適用対象**: `bar`/`radial` の line・dot。`FramePipeline` が保持する
  `SpringArray` でレイヤー帯域を平滑してから渡す（レンダラーの純関数性を維持）。
- **受け入れ条件**: `physicsAmount=0` で従来と完全同一の描画。値を上げると
  波形が「遅れて追従し、揺り戻す」。急峻な音でも発散しない（damping 下限で保証）。

---

## 7. UI 仕様

### 7.1 タイプ選択

- `<select id="analyzer-type">` を `<optgroup>` で系統別にグループ化する:
  「基本」（棒グラフ/円形放射）「時間軸」「幾何」。
- 選択時、ケイパビリティマップ（§4.4）に基づき以下を動的に表示/非表示:
  表現方法 select（対応 method のみ option を残す）/ 表示モード / レイヤー数ボタン。

### 7.2 追加コントロール（感度・形状セクションに追加）

| ID | ラベル | 対応キー |
|---|---|---|
| `slider-history` | 時間幅（秒）1〜8 | `historySeconds` |
| `slider-motion` | 動きの速さ 0.1〜3.0 | `motionSpeed` |
| `slider-physics` | 粘性揺らぎ 0〜10 | `physicsAmount` |

- 各スライダーは**それを使用するタイプ選択時のみ表示**する（ケイパビリティ連動）。

### 7.3 ランダマイズ

- アナライザーランダマイズ: タイプは全 6 種から選択。表現方法・表示モード・
  レイヤー数はケイパビリティ準拠で選ぶ。
- 形状ランダマイズ: 対象は感度・スムージング・バー幅・密度・ベースオフセット・残像。
  `motionSpeed` / `physicsAmount` / `historySeconds` は対象外（視認性への影響が大きいため）。

### 7.4 リセット・既定値

- タイプ切替時に内部状態（履歴・リング）はリセットする。設定値はリセットしない。
- lissajous 選択時、`afterimageIntensity === 0` なら推奨値 4 を設定して
  スライダー表示も同期する（ユーザーが変更したら以後は触らない）。

---

## 8. 非機能要件

### 8.1 性能

- 目標: 一般的なデスクトップ（2020年以降の内蔵GPU機）・1080p 相当キャンバスで
  **描画ループ 16.7ms 以内（60fps）**、録画中も **33ms 以内（30fps）** を維持。
- 各タイプは §6 の性能予算（要素数上限）を実装でクランプする。
- リングなどの動的オブジェクトは**固定長プール**で管理し、
  フレーム中の配列生成・クロージャ生成を避ける。
- `dtMs` を用い、フレーム落ち時も動きの速度が実時間基準で一定になるようにする。

### 8.2 メモリ

- FrameHistory は最大 240 フレーム × ビン数 ≤ 1024 = 約 240KB（Uint8Array）以内。
- オフスクリーンキャンバスは タイプ 1 つあたり最大 2 枚。`dispose()` で参照を破棄。

### 8.3 録画との整合

- 全タイプで録画（Phase 5 仕様: MP4/WebM・ビットレート自動・Duration パッチ）が
  正常動作すること。

### 8.4 後方互換

- 既存 2 タイプ（bar/radial）の描画結果は Phase 6 実装後も**ピクセル同等**であること
 （`physicsAmount=0` のとき）。設定 JSON に未知キーが増えるのみ。

---

## 9. 制約・割り切り

- 真の 3D（透視投影・深度バッファ）は行わない。平行投影 + 描画順制御で表現する。
- T11 lissajous はモノラル解析（既存 AnalyserNode 構成）のため、真のステレオ XY ではなく
  位相遅延埋め込みで代替する。ステレオ対応は将来検討（spec.md §23 に追記済み扱い）。
- スマホ最適化は引き続き対象外。

---

## 10. 受け入れ条件サマリー

1. アナライザータイプとして計 6 種（既存2 + 新規4）を選択できる
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

### v1.1（2026-07-12）— 実機での表示確認にもとづく表現調整（Phase 6.1）

実機での目視確認にもとづき、各タイプの見た目・操作性を改善した。基盤アーキテクチャ
（レジストリ・ステートフル機構・履歴・ビート検出）に変更はない。

| 対象 | 変更内容 |
|---|---|
| T1 スペクトログラム | 縦解像度を高め（1px行）、対数強度＋隣接ビン平均＋γ補正で微弱成分を繊細に表示。横送りを1〜2pxに抑え時間分解能を向上 |
| T3 3D地形 | 基準位置を画面**底辺基準**に変更し、`baseOffset` で上方向へ持ち上げる方式に。**奥行き角度**パラメーター（`depthAngle` 0〜100）を追加 |
| T4 トンネル | 16:9 で画面横幅いっぱいに広がるよう、リング半径基準を対角基準に変更 |
| T11 オシロスコープ | `baseOffset` を位相遅延から**中心からの距離（広がり）**の制御に変更 |

追加設定: `depthAngle`(0〜100, 既定50)。
ケイパビリティ `sliders` に `angle` を追加。
