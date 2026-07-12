# Phase 6 レンダラー実装契約（実装者向け）

新レンダラーは **classic script**（`import/export` 不可、`#private` フィールド不可、
グローバルにクラス宣言）で書く。`index.html` に `<script>` で直列読み込みされる。

## ステートフルレンダラーのインターフェース

```js
class XxxRenderer {
  constructor(canvas) { /* 状態初期化。オフスクリーンcanvasはここで生成可 */ }
  onResize(canvas) { /* canvasサイズ変更時。レイアウト再計算・オフスクリーン作り直し */ }
  render(ctx, canvas, frame, settings) { /* 毎フレーム描画 */ }
  dispose() { /* 破棄時。オフスクリーン参照解放など。省略可 */ }
}
```

## frame オブジェクト

| フィールド | 内容 |
|---|---|
| `frame.freq` | `Uint8Array`（0..255）。50Hz〜15kHz の全帯域スペクトラム |
| `frame.time` | `Uint8Array`（0..255、中心128）。時間波形。**null の場合あり** |
| `frame.history` | `FrameHistory`。`.get(age)`（age=0が最新、範囲外null）/ `.size` / `.capacity` / `.frameLength` |
| `frame.beat` | `{ isBeat: bool, energy: 0..1, sinceBeatMs: number }` |
| `frame.dtMs` | 前フレームからの経過ミリ秒（実時間基準の動きに使う） |
| `frame.nowMs` | 現在時刻ms（`performance.now` 基準） |
| `frame.getLayer(i, count)` | レイヤー帯域スライス `Uint8Array` を返す |

## settings（全設定・effectiveHue反映済み）

`hue`(0-360), `hueRange`, `brightness`, `saturation`, `sensitivity`, `barWidth`,
`density`(30-100), `baseOffset`(0-99), `expressionMethod`('bar'|'line'|'dot'),
`layerCount`(1-4), `layers`([{hueOffset, sensitivity}]), `bgColor`('#000'|'#fff'),
`afterimageIntensity`(0-10), `historySeconds`(1-8), `motionSpeed`(0.1-3.0),
`particleAmount`(10-100), `physicsAmount`(0-10)

## 利用可能なグローバル（js/vis-utils.js — レンダラーより先に読み込み済み）

- `clamp(v,min,max)`, `lerp(a,b,t)`
- `isoProject(x,y,z,kx?,ky?) -> {x,y}`（既定 kx=0.5, ky=0.35）
- `polarToXy(cx,cy,r,angleRad) -> {x,y}`
- `makeColor(baseHue, amp01, settings, alpha?) -> 'hsl(...)'|'hsla(...)'`
  既存レンダラーと同一の色決定則。**色は必ずこれを使う**。
- `makeRng(seed) -> ()=>0..1`（決定的）
- `new ValueNoise(seed)` … `.noise2(x,y)`（0..1）, `.fbm(x,y,octaves)`（0..1）
- `new Spring(...)`, `new SpringArray(n, params)`, `springParamsFromAmount(amount)`
- `new BeatDetector()`
- `generateJitteredSites(cols,rows,jitter,seed)`, `computeVoronoiCells(sites,w,h)`
- `FrameHistory`（js/history-buffer.js）

## 色の使い方

- 単層タイプ: `makeColor(settings.hue, amp, settings)`
- レイヤー対応タイプ: レイヤー i について
  `baseHue = settings.hue + settings.layers[i].hueOffset`、
  `sens = settings.sensitivity * settings.layers[i].sensitivity` を使う。
  `amp` は 0..1 に正規化した振幅（`clamp(raw/255 * sens, 0, 1)` など）。

## 必須ルール

1. **背景クリアはしない**（コアが `_clearWithAfterimage` で行う）。
   例外: `selfClear: true` を宣言するタイプ（spectrogram 系）は自分で全面塗り＋履歴風残しを行う。
2. `canvas.width`/`height` が 0、`frame.freq` が null/空、`frame.history.size===0`、
   `frame.time` が null のケースを**必ずガード**する（例外を出さない）。
3. 描画要素数は spec §6 の性能予算で**上限クランプ**する（固定長プール推奨）。
4. 毎フレームの配列/オブジェクト新規生成を避ける（プールは constructor / onResize で確保）。
5. 動きは `frame.dtMs` を用いて実時間基準にする（`motionSpeed` はその倍率）。
6. `node --check <file>` が通ること。
7. アスペクト比 16:9 / 1:1、背景 黒/白、リサイズで破綻しないこと。

## スタイル参考

既存の `js/renderers/radial.js` を読み、命名・コメント（日本語）・密度計算の作法に合わせる。
各ファイル冒頭に `// Txx 名称 — doc/spec-phase6.md §6.x` を記載する。
