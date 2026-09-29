# Phase 15 実装計画書 — テスト基盤と描画パイプライン共通化

- Document version: `v1.0`
- Date: `2026-09-28`
- 前提: Phase 14.2 完了（`main` @ `d71a5c5`）
- 作業ルール: `doc/20260928-implementation-guide-for-contractors.md`（以下「ガイド」）
- 目的: Phase 16・18 の大規模改修を安全に行うための土台を作る
  1. **テスト基盤**: Node 標準機能と Chrome だけで動く自動テスト一式をリポジトリに収める（オーナー決定 D5）
  2. **FramePipeline**: ライブ表示（`js/visualizer-core.js`）とオフライン書き出し（`js/offline-exporter.js`）に**複製されている描画ロジックを1つに統合**し、「プレビュー＝書き出し」をコードで保証する（D4 の前提）
  3. **ゴールデンフレーム**: 全14タイプの見た目を数値で固定し、リファクタによる意図しない見た目の変化を自動検出する

---

## 1. スコープ

| 含む | 含まない |
|---|---|
| `tests/` 一式（ランナー、Node 単体、ブラウザテスト、ゴールデン） | 解析アルゴリズムの変更（Phase 16） |
| `js/frame-pipeline.js` 新設と、`visualizer-core.js`・`offline-exporter.js` の置き換え | レンダラー（`js/renderers/*`）の変更 |
| デバッグ表示（`?debug=1`） | UI の見た目の変更 |
| CI（GitHub Actions）と PR テンプレート | 新機能 |

**このフェーズでユーザーから見える変化は「色相連続変化の速度が画面のリフレッシュレートに依存しなくなる」ことだけ**（§4.4）。

---

## 2. 現状の課題（コード上の根拠）

| 課題 | 場所 | 影響 |
|---|---|---|
| 描画ロジックの複製 | `offline-exporter.js` の `_renderStateless` / `_applyPhysics` / `_clearFrame` / `_sliceLayer` が、`visualizer-core.js` の対応する処理（`_renderStateless` / `_applyPhysics` / `_clearWithAfterimage` / `AudioEngine.getLayerData`）のコピー（コメントに「実時間駆動できないため複製」と明記） | 片方だけ直すとプレビューと書き出しの見た目がずれる |
| 色相連続変化の不一致 | ライブ: `_huePhase += speed * 0.5`（1フレームごと）。オフライン: `+= speed * 0.5 * (dtMs / 16.7)` | 120Hz ディスプレイではライブの色相変化が書き出しの2倍速になる |
| テストがリポジトリにない | `log.md` に記録されたテストスクリプト（`test-mp4-demuxer.mjs`、`phase14-e2e.mjs` 等）が存在しない | 外注実装者が回帰を確認できない |

---

## 3. テスト基盤の設計

### 3.1 ディレクトリ構成とコマンド

```
tests/
├─ run.mjs                    # 唯一のエントリポイント
├─ lib/
│  ├─ load-classic.mjs        # Node で classic script を読み込む
│  ├─ chrome.mjs              # Chrome の検出・起動・CDP 接続
│  ├─ harness-builder.mjs     # index.html からハーネス HTML を生成
│  └─ png.mjs                 # 差分画像の書き出し（RGBA→PNG、zlib は node:zlib）
├─ shared/                    # Node とブラウザの両方で読める classic script
│  ├─ signals.js              # 合成信号（§3.5）
│  ├─ wav.js                  # AudioBuffer 相当 → WAV バイト列
│  └─ golden-cases.js         # ゴールデンのケース定義（§3.6）
├─ unit/                      # Node 単体テスト（*.test.mjs）
├─ browser/
│  ├─ lib/avz-test.js         # ブラウザ側テスト登録・アサーション
│  └─ *.test.js               # ブラウザテスト（classic script）
├─ golden/frames.json         # ゴールデン基準値（コミット対象）
├─ .generated/                # 生成ハーネス（.gitignore）
└─ output/                    # レポート・差分画像（.gitignore）
```

| コマンド | 動作 |
|---|---|
| `node tests/run.mjs` | 全テスト（Node 単体 → ブラウザ） |
| `node tests/run.mjs --unit` | Node 単体のみ |
| `node tests/run.mjs --browser` | ブラウザのみ |
| `node tests/run.mjs --filter <正規表現>` | テスト ID または名前が一致するものだけ |
| `node tests/run.mjs --update-golden` | ゴールデン基準値を再生成して `tests/golden/frames.json` を上書き |
| `node tests/run.mjs --headed` | ブラウザを表示して実行（デバッグ用） |
| `node tests/run.mjs --skip-slow` | `slow: true` 指定のテスト（数分かかる書き出し系）を飛ばす（ローカル用。CI では全件実行） |

- 終了コード: 全件成功 0 / 失敗あり 1 / 実行環境エラー（Chrome が見つからない等）2
- 結果は標準出力に一覧表示し、`tests/output/report.json` に `[{id, name, status: 'pass'|'fail'|'skip', ms, error}]` で保存

### 3.2 `tests/lib/load-classic.mjs`

```js
// files: リポジトリルートからの相対パス配列（読み込み順）
// globals: コンテキストに事前注入するオブジェクト（例: { performance, console }）
// 戻り値: 名前 → 値 を返す関数 get(name)
export function loadClassic(files, globals = {}) -> { get(name), context }
```

- コンテキストへの既定の注入: `console`、`performance`、`Blob`、`TextEncoder`、`TextDecoder`、`URL`（マルチプレクサ・設定入出力が使う）。`globals` 引数で追加・上書きできる
- 実装: `node:vm` の `createContext` で1つのコンテキストを作り、各ファイルを `runInContext` で順に評価する。トップレベルの `class` / `const` は同一コンテキスト内の後続スクリプトから参照でき、`get(name)` は `vm.runInContext(name, context)` で取り出す（動作確認済み）
- アプリ本体には手を入れない

### 3.3 `tests/lib/chrome.mjs`

| 項目 | 仕様 |
|---|---|
| 検出順 | ① 環境変数 `CHROME_PATH` ② `/opt/pw-browsers/chromium-*/chrome-linux/chrome` ③ PATH 上の `google-chrome` / `google-chrome-stable` / `chromium` / `chromium-browser` ④ macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` ⑤ Windows `%ProgramFiles%\Google\Chrome\Application\chrome.exe` |
| 起動引数 | `--headless=new --no-sandbox --disable-gpu --allow-file-access-from-files --autoplay-policy=no-user-gesture-required --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --user-data-dir=<一時ディレクトリ> --remote-debugging-port=0`（フェイクマイクは Phase 18 の B18-06 で使う）（`--headed` 指定時は `--headless=new` を外す） |
| ポート取得 | `<user-data-dir>/DevToolsActivePort` の1行目を読む（出現まで最大10秒ポーリング） |
| 接続 | `fetch('http://127.0.0.1:<port>/json')` でページの `webSocketDebuggerUrl` を取得し、Node 標準の `WebSocket` で接続 |
| 提供 API | `send(method, params) -> Promise<result>`、`on(event, handler)`、`evaluate(expr, {awaitPromise, timeoutMs}) -> 値`、`navigate(fileUrl)`、`close()` |
| エラー収集 | `Runtime.enable` 後、`Runtime.exceptionThrown` と `Runtime.consoleAPICalled`（type `error`）を記録する |

この方式（CDP + Node 22 標準 WebSocket）で、OfflineAudioContext、AudioWorklet（data: URL）、リアルタイム AudioContext、`getOutputTimestamp()`、WebCodecs がヘッドレスで動くことを 2026-09-28 に確認済み。

### 3.4 ブラウザテスト

#### 3.4.1 2種類のページ

| ページ | 生成方法 | 用途 | テストファイル先頭の宣言 |
|---|---|---|---|
| ハーネス | `harness-builder.mjs` が `index.html` の `<script src>` を**出現順に抽出**し、`js/app.js` だけを除いて `tests/.generated/harness.html` を生成。続けて `tests/shared/*.js`、`tests/browser/lib/avz-test.js`、対象テストファイルを読み込む | モジュール単位のテスト（UI なし） | `// @page harness`（既定） |
| アプリ | `index.html` をそのまま開き、読み込み完了後に `tests/shared/*.js`・`avz-test.js`・テストファイルを `Runtime.evaluate` で注入 | UI を含む E2E | `// @page app` |

スクリプトの読み込み順は `index.html` だけが正（SSOT）。ハーネス側に一覧を複製しない。

#### 3.4.2 テスト登録 API（`tests/browser/lib/avz-test.js`）

```js
avzTest(id, name, async () => { ... }, { timeoutMs = 30000, slow = false } = {});
avzAssert.ok(cond, msg);
avzAssert.equal(actual, expected, msg);          // ===
avzAssert.close(actual, expected, tol, msg);     // |a-e| <= tol
avzAssert.deepEqual(actual, expected, msg);      // JSON 比較
avzArtifact(name, dataUrl);                      // 失敗時に tests/output/ へ保存する画像
window.__avzRun(filterRegexSource) -> Promise<Result[]>
```

- ランナーは各テストを順に実行し、実行中に発生したコンソールエラー・未捕捉例外があれば**そのテストを失敗**とする（「コンソールエラー0」を自動判定）

### 3.5 合成信号ライブラリ（`tests/shared/signals.js`）

Node とブラウザの両方で使う classic script。すべて**シード固定の決定的出力**。戻り値は `{ sampleRate, channels: [Float32Array, ...] }`（以下 `PcmBuffer`）。

共通規則:
- 乱数は `makeRng(seed)`（`js/vis-utils.js` と同一の実装を `signals.js` 内に複製してよい）。`rng()` は 0..1
- 時刻 → サンプル位置は `round(秒 × sampleRate)`、音の長さも `len = round(秒 × sampleRate)`
- 合成は加算。範囲外のサンプル位置は無視する。正規化はしない（関数ごとに振幅を明記）
- `pan`（−1..1）は等パワー: `L += v·cos((pan+1)·π/4)·√2`、`R += v·sin((pan+1)·π/4)·√2`（`pan = 0` で両 ch に v）

| 関数 | 定義 |
|---|---|
| `sigSine(sr, sec, freqHz, amp, {pan = 0})` | `v[i] = amp·sin(2π·freqHz·i/sr)` を pan で配置 |
| `sigNoise(sr, sec, amp, seed, {color = 'white', stereo = 'same'})` | 白色: `w = rng()·2 − 1`。ピンク: Paul Kellet の簡易フィルタ `b0 = 0.99765·b0 + w·0.0990460; b1 = 0.96300·b1 + w·0.2965164; b2 = 0.57000·b2 + w·1.0526913; v = (b0 + b1 + b2 + w·0.1848)/3`（状態 0 から開始）。最後に `amp` を掛ける。`stereo = 'same'` は L = R、`'independent'` は L をシード `seed`、R をシード `seed + 1` で別に生成 |
| `sigClickTrack(sr, sec, bpm, {amp = 0.8, accentEvery = 0, accentGain = 2})` | 拍 k（k = 0, 1, …、`k·60/bpm < sec`）の開始 `s = round(k·60/bpm·sr)` に、`len = round(0.005·sr)`、`g = (accentEvery > 0 && k mod accentEvery == 0) ? accentGain : 1`、`i ∈ [0, len)` で `v[s+i] += min(1, amp·g)·(rng()·2 − 1)·exp(−i/(len/4))`。乱数はシード 1 を拍順・サンプル順に消費。L = R |
| `sigDrumPattern(sr, sec, bpm, {kick, hat, snare})` | 各引数は長さ16の 0/1 配列（1小節 = 16分音符 16 個。小節ごとに繰り返す）。既定値: kick = 4つ打ち（0, 4, 8, 12 番が 1）、hat = 8分（偶数番が 1）、snare = 全 0。16分音符 k（`k·15/bpm < sec`）の開始 `s = round(k·15/bpm·sr)`、`st = k mod 16` について、キック → ハット → スネアの順に生成。キック: `len = round(0.12·sr)`、`ph = 0` から `ph += 2π·(60 − 20·i/len)/sr`、`0.9·sin(ph)·exp(−i/(0.04·sr))`。ハット: `len = round(0.03·sr)`、`prev = 0` から `w = rng()·2 − 1`、`0.25·(w − prev)·exp(−i/(0.008·sr))`、`prev = w`（1階差分で高域を強調）。スネア: `len = round(0.08·sr)`、`ph = 0` から `ph += 2π·200/sr`、`(0.3·sin(ph) + 0.3·(rng()·2 − 1))·exp(−i/(0.02·sr))`。乱数はシード 3。L = R |
| `sigChord(sr, sec, midiNotes, amp)` | `v[i] = amp·Σ_m (sin(2π·f_m·i/sr) + 0.5·sin(4π·f_m·i/sr) + 0.25·sin(6π·f_m·i/sr)) / midiNotes.length`、`f_m = 440·2^((m − 69)/12)`。L = R |
| `sigMix(bufs, gains)` | 同じサンプルレートの PcmBuffer を `Σ gains[j]·bufs[j]` で合成（長さは最長に合わせ、短いものは 0 埋め） |
| `sigConcat(bufs)` | 時間方向に連結 |
| `sigScaleToLufs(buf, targetLufs)` | Phase 16 §5.8 の K 特性で全区間の平均二乗からラウドネスを測り、目標になるよう全体に定数を掛ける（Phase 16 のテスト用。T16-04 で追加） |
| `synthFrame(i, freqLen, timeLen, outFreq, outTime)` | **音声を経由しない**描画テスト用の決定的スペクトル（下式） |

Phase 16 の受け入れテストで「ピンクノイズ（振幅 0.25）を加えた」とは、`sigMix([信号, sigNoise(sr, sec, 0.25, 7, {color: 'pink'})], [1, 1])` を指す。

`synthFrame` の定義（ゴールデンの再現性のため式を固定する）:

```
p  = (i % 15 < 3) ? 1.0 : 0.4
c1 = 0.10 + 0.05 * sin(i * 0.07)
c2 = 0.50 + 0.30 * sin(i * 0.023)
freq[k] = clamp(round( 200*exp(-((k/freqLen - c1)^2)/(2*0.02^2))
                     + 150*p*exp(-((k/freqLen - c2)^2)/(2*0.05^2))
                     + 40*(0.5 + 0.5*sin(0.3*k + 0.1*i)) ), 0, 255)
time[n] = clamp(round(128 + 90*(0.5 + 0.5*p)*sin(2π*n*(3 + i%7)/timeLen)), 0, 255)
```

`tests/shared/wav.js`: `encodeWav16(pcmBuffer) -> Uint8Array`（PCM 16bit little-endian、RIFF/WAVE、チャンネル数そのまま）。ブラウザテストでは `new File([bytes], 'x.wav', {type: 'audio/wav'})` にして、アプリのファイル読込経路へ渡す。

### 3.6 ゴールデンフレーム

#### 3.6.1 ケース定義（`tests/shared/golden-cases.js`）

- 基本 56 ケース: 全14タイプ × 背景 `#000`/`#fff` × 解像度 320×180（16:9）/ 180×180（1:1）。設定は `createDefaultSettings()` に `analyzerType` と `bgColor` のみ上書き
- 追加 10 ケース（すべて `#000`・320×180）:

| ID | 上書き設定 |
|---|---|
| `bar-line` | `analyzerType:'bar', expressionMethod:'line'` |
| `bar-dot` | `analyzerType:'bar', expressionMethod:'dot'` |
| `bar-mirror-v` | `analyzerType:'bar', barDisplayMode:'mirror-vertical'` |
| `bar-mirror-h` | `analyzerType:'bar', barDisplayMode:'mirror-horizontal'` |
| `radial-line` | `analyzerType:'radial', expressionMethod:'line'` |
| `radial-dot` | `analyzerType:'radial', expressionMethod:'dot'` |
| `bar-layers4` | `analyzerType:'bar', layerCount:4`、全レイヤー `blendMode:'lighter'` |
| `bar-afterimage` | `analyzerType:'bar', afterimageIntensity:5` |
| `bar-physics` | `analyzerType:'bar', expressionMethod:'line', physicsAmount:5` |
| `radial-huecont` | `analyzerType:'radial', hueContinuousMode:true, hueContinuousSpeed:2` |

- ケース ID の命名: 基本は `<type>-<black|white>-<169|11>`、追加は上表の ID

#### 3.6.2 描画手順（全ケース共通）

1. 指定解像度の canvas を作る
2. フレーム `i = 0..59` について `synthFrame(i, 638, 2048, ...)` で入力を作り、`dtMs = 16.7`、`nowMs = i * 16.7` で1フレームずつ描画する（638 は 48kHz・FFT 2048 での 50Hz〜15kHz スライス長 = `computeFreqRange(48000, 1024)` の `endBin - startBin`）
3. `i = 19, 39, 59` の描画直後に**サムネイル**を採取する: canvas を 10×10 px ブロックに分割し、ブロックごとの R・G・B の算術平均（小数点以下切り捨て）を並べた `Uint8Array`（16:9 は 32×18×3、1:1 は 18×18×3）
4. `tests/golden/frames.json` に `{ "<caseId>": ["<base64>", "<base64>", "<base64>"] }` の形式で保存する

縮小に `drawImage` を使わない（ブラウザ実装差を避けるため `getImageData` から自前で平均する）。

#### 3.6.3 判定

| 判定 | 条件 |
|---|---|
| 一致 | 全要素の平均絶対差 ≤ **2.0** かつ 最大絶対差 ≤ **40** |
| 非空 | フレーム 39・59 のサムネイルの標準偏差 > **1.0**（背景一色でないこと） |

失敗時は `tests/output/golden/<caseId>-<frame>-expected.png` / `-actual.png`（サムネイルを10倍に拡大）と、実描画のフル解像度 `-full.png` を保存する。

#### 3.6.4 描画ドライバ（2段階）

| ドライバ | 使う時期 | 方法 |
|---|---|---|
| `visualizer-core` | T15-05（基準値の作成）と T15-06 の比較用 | `VisualizerCore` を生成し、`audioEngine` に**テスト用の偽オブジェクト**を渡す: `captureFrame()` で `synthFrame(i, …)` を内部配列へ書き、`getFreqSlice()` はその freq、`freqSliceLength()` は 638、`getTimeDomainData()` はその time、`getLayerData(li, count)` は `sliceLayerLinear` と同じ式（`freq.subarray(floor(li·638/count), floor((li+1)·638/count))`）を返す。canvas の `width`/`height` を直接設定し **`resize()` は呼ばない**（親要素の寸法に依存するため）。描画前に `_fillBackground()` で1回全面を塗る。`window.requestAnimationFrame` を何もしない関数に、`performance.now` を `() => i * 16.7` に差し替え、`_lastFrameMs = -16.7`、`running = true` にして、各 i で `_loop()` を1回呼ぶ |
| `pipeline` | T15-06 以降 | `new FramePipeline(canvas)` を作り、`fillBackground(settings)` の後、各 i で §4.2 の `input`（`freq`・`time` は `synthFrame` の結果、`getLayer: null`、`dtMs: 16.7`、`nowMs: i·16.7`、`historyFps: 60`、`drawBackground: null`）で `render` |

T15-06 のマージ条件は「`pipeline` ドライバが T15-05 の基準値に一致すること」。一致を確認したら `visualizer-core` ドライバは削除する。

### 3.7 CI と PR テンプレート

- `.github/workflows/test.yml`: `pull_request` と `main` への `push` で実行。`ubuntu-latest`、`actions/setup-node@v4`（`node-version: 22`）、`CHROME_PATH=$(which google-chrome)` を設定して `node tests/run.mjs`。失敗時は `actions/upload-artifact@v4` で `tests/output/` をアップロード
- `.github/pull_request_template.md`: 見出し「チケット」「変更内容」「検証」「完了の定義」を置き、「完了の定義」にはガイド §7 のチェックリストを貼るよう1行で案内する（チェックリスト本文は複製しない）
- `.gitignore` に `tests/output/` と `tests/.generated/` を追加

---

## 4. FramePipeline の設計（`js/frame-pipeline.js`）

### 4.1 役割

1フレーム分の「背景クリア → 動画合成 → 色相計算 → レンダラー呼び出し」を行う唯一の場所。**時刻・音声取得・エンコードは知らない**（呼び出し側が `input` で渡す）。

### 4.2 API

```js
class FramePipeline {
  constructor(canvas, ctx = canvas.getContext('2d'))
  resize()                 // canvas サイズ変更後に呼ぶ。ステートフルレンダラーの onResize を呼ぶ
  reset()                  // 履歴・BeatDetector・粘性揺らぎ状態・色相位相を初期化
  dispose()                // ステートフルレンダラーの dispose を呼ぶ
  fillBackground(settings) // 背景色で全面を塗る（停止時・リサイズ時用）
  render(input, settings)  // 1フレーム描画
}

// input（呼び出し側が毎フレーム同じオブジェクトを使い回して値だけ更新する）
{
  freq,             // Uint8Array | null — 50Hz〜15kHz スライス
  time,             // Uint8Array | null — 時間波形
  getLayer,         // (i, count) => Uint8Array | null。省略時は sliceLayerLinear(freq, i, count)
  dtMs, nowMs,      // number
  historyFps,       // number — 履歴容量の計算に使う1秒あたりフレーム数（ライブ 60 / オフライン fps）
  drawBackground,   // ((ctx, canvas) => void) | null — 動画合成。selfClear タイプでは呼ばない
}
```

### 4.3 `render(input, settings)` の処理順（現行コードと同一の順序を厳守）

| 順 | 処理 | 移設元 |
|---|---|---|
| 1 | `settings.analyzerType` が前回と違えば、ステートフルレンダラーを破棄・生成し `onResize` を呼び、履歴をクリア | `VisualizerCore._syncRenderer` |
| 2 | `selfClear` でなければ: 残像付きクリア → `input.drawBackground` があれば呼ぶ | `_clearWithAfterimage` / `_drawVideoComposite` の呼び出し位置 |
| 3 | 色相位相を更新（§4.4）して `effectiveHue` を求める | `_loop` 内 |
| 4a | ステートフル: 履歴を確保（容量 = `min(240, max(2, round(clamp(historySeconds, 1, 8) * historyFps))))`、フレーム長 = `freq.length`）→ `freq` が null でなければ push（null なら push しない。現行と同じ）→ `frame`（使い回しオブジェクト）の `freq`・`time`・`history`・`beat`（= `BeatDetector.update(freq, nowMs)`。freq が null のとき BeatDetector は既定値を返す）・`dtMs`・`nowMs`・`getLayer` を更新 → `render(ctx, canvas, frame, {...settings, hue: effectiveHue})` | `_renderStateful` / `_ensureHistory` |
| 4b | ステートレス: レイヤーごとに `getLayer` → 粘性揺らぎ → 合成モード設定 → レンダラー呼び出し | `_renderStateless` / `_applyPhysics` |

- `{...settings, hue}` の毎フレーム生成は現行と同じく許容する（ガイド §9.3 の例外）
- `sliceLayerLinear(freq, i, count)` は `frame-pipeline.js` にトップレベル関数として置く（現 `OfflineExporter._sliceLayer` と同じ式）
- `frame.getLayer` は `bar3d`・`flower`・`metaball`・`particles`・`ring3d`・`ripple` が使う。**constructor で1回だけ作る束縛関数** `this._getLayerBound = (i, count) => this._getLayer(i, count)` を設定し、`_getLayer` は現在の `input.getLayer`（無ければ `sliceLayerLinear(現在の freq, …)`）へ委譲する（毎フレームのクロージャ生成を避ける）
- ステートレス経路のレイヤー取得も同じ `_getLayer` を使う

### 4.4 意図的な振る舞い変更（1件のみ）

色相連続変化を**経過時間基準**に統一する: `huePhase = (huePhase + hueContinuousSpeed * 0.5 * (dtMs / 16.7)) % 360`

- 現行オフラインと同じ式。ライブも 60Hz 表示では従来と同じ速さ（`dtMs ≈ 16.7`）、120Hz では従来の半分（＝書き出しと同じ）になる
- `doc/spec.md` の色相連続変化の記述に「表示のリフレッシュレートに依存しない」と追記する

### 4.5 置き換え後の呼び出し側

| ファイル | 残る責務 | 削除するもの |
|---|---|---|
| `visualizer-core.js` | rAF ループ、`resize()`（キャンバス寸法決定）、`start/stop`、`audioEngine` からの `input` 組み立て、動画要素の描画関数（`drawBackground` として渡す） | `_syncRenderer`、`_clearWithAfterimage`、`_renderStateful`、`_renderStateless`、`_applyPhysics`、`_ensureHistory`、`_huePhase` |
| `offline-exporter.js` | 書き出しごとに `new FramePipeline(書き出し用canvas, ctx)` を作り、終了時に `dispose()`（現行は粘性揺らぎの状態 `_physics` が書き出しをまたいで残っているが、書き出しごとに初期化する形に改める）。解析、エンコード、合成ソースからのフレーム取得（`await frameAt()` で先に取得し、`drawBackground` のクロージャで描く）、`input` 組み立て（`historyFps = fps`） | `_renderStateless`、`_applyPhysics`、`_clearFrame`、`_sliceLayer`、フレームループ内の色相計算 |

- `index.html` の `<script>` に `js/frame-pipeline.js` を `js/renderer-registry.js` の直後に追加
- `VisualizerCore` の公開プロパティ（`settings`、`videoElement`、`canvas`、`resize()`、`start()`、`stop()`）と、`ui-controller.js` から呼ばれている `_fillBackground()` は名前・引数を変えない（中身は `pipeline.fillBackground(this.settings)` へ委譲）。`ui-controller.js` は変更しない

---

## 5. デバッグ表示（`js/debug-overlay.js`）

- URL に `?debug=1` がある場合だけ有効。キャンバス上に重ねた DOM 要素として表示する（録画・書き出しには写らない）
- 表示項目: FPS（直近1秒）、描画時間の平均 / p95 / 最大（直近120フレーム、`FramePipeline.render` の所要時間）、現在のタイプ
- 計測は `VisualizerCore._loop` で `performance.now()` を `render` の前後に呼んで行う（ガイド §9.1 の時刻規則の例外として許可）
- API: `DebugOverlay.create(containerEl) -> overlay | null`（無効時 null）、`overlay.recordFrame(renderMs, nowMs)`、`overlay.setField(key, text)`（Phase 16 以降の項目追加用）
- 表示は 250ms ごとに更新（毎フレーム DOM を書き換えない）

---

## 6. チケット一覧

| ID | タイトル | 難易度 | 前提 | 成果物 | 受け入れテスト | spec 更新 |
|---|---|---|---|---|---|---|
| T15-01 | テストランナー骨格 | ★2 | — | `tests/run.mjs`、`tests/lib/load-classic.mjs`、`tests/lib/chrome.mjs`、`.gitignore` 追記 | U15-00、B15-00 | 不要 |
| T15-02 | Node 単体テストの整備 | ★1 | T15-01 | `tests/unit/*.test.mjs` | U15-01〜U15-06 | 不要 |
| T15-03 | ブラウザテストハーネス | ★2 | T15-01 | `tests/lib/harness-builder.mjs`、`tests/browser/lib/avz-test.js` | B15-00 | 不要 |
| T15-04 | 合成信号・WAV ライブラリ | ★2 | T15-01 | `tests/shared/signals.js`、`tests/shared/wav.js` | U15-07、U15-08 | 不要 |
| T15-05 | ゴールデン基準値の作成 | ★2 | T15-03, T15-04 | `tests/shared/golden-cases.js`、`tests/browser/golden.test.js`（`visualizer-core` ドライバ）、`tests/golden/frames.json`、`tests/lib/png.mjs` | B15-04 | 不要 |
| T15-06 | FramePipeline への統合 | ★3 | T15-05, T15-07 | `js/frame-pipeline.js`、`visualizer-core.js`・`offline-exporter.js`・`index.html` の変更、ゴールデンを `pipeline` ドライバへ切替 | B15-04、B15-05、B15-02、B15-03 | 要（§4.4） |
| T15-07 | 既存機能の回帰テスト | ★2 | T15-03, T15-04 | `tests/browser/regression.test.js` | B15-01〜B15-03 | 不要 |
| T15-08 | デバッグ表示 | ★1 | T15-06 | `js/debug-overlay.js`、`index.html`、`visualizer-core.js` | B15-06 | 要（README に `?debug=1` を追記） |
| T15-09 | CI・PR テンプレート | ★1 | T15-02, T15-07 | `.github/workflows/test.yml`、`.github/pull_request_template.md` | CI 上で全テストが成功すること | 不要 |

- **T15-05 は T15-06 より前に、必ずリファクタ前のコードで基準値を作ること**（基準値が「現行の見た目」を表すため）
- T15-07 は T15-06 と並行可。ただし T15-06 のマージ前に T15-07 がマージされていること（リファクタの回帰検出に使う）

---

## 7. 受け入れテスト

### 7.1 Node 単体（`tests/unit/`）

| ID | 対象 | 内容・合格基準 |
|---|---|---|
| U15-00 | ランナー | 常に成功するテスト1件・常に失敗するテスト1件（`--filter` で個別実行）で、終了コードが 0 / 1 になる |
| U15-01 | `settings-io.js` | `serializeSettings` → `deserializeSettings` の往復で `createDefaultSettings()` と深い一致。不正入力（`null`、`{}`、型違い、未知キー、`layers` 欠損）で例外を出さず既定値へフォールバック |
| U15-02 | `history-buffer.js` | push / get(age) / 容量超過時の上書き / `setFrameLength` でのクリア / 範囲外 `null` |
| U15-03 | `vis-utils.js` | `makeRng(1)` の先頭5値が2回の生成で一致。`computeFreqRange(48000, 1024)` = `{startBin: 2, endBin: 640}`、`computeFreqRange(44100, 1024)` = `{startBin: 2, endBin: 697}` |
| U15-04 | `fft.js` | `SpectrumAnalyzer(256, 0, -100, -30)` の出力と、同じ手順（Blackman 窓→素朴な DFT→1/N→dB→byte）を倍精度で計算した参照値の差が全ビンで ±1 以内、かつ 99% 以上のビンで完全一致（シード固定の乱数入力5種。SpectrumAnalyzer は内部が Float32 のため切り捨て境界で1ずれうる） |
| U15-05 | WebM | `WebmMuxer` に合成チャンク（映像30・キーフレーム間隔10・音声あり）を入れた出力を `WebmDemuxer.parse` で読み戻し、映像チャンクのバイト列・タイムスタンプ・キーフレームフラグが完全一致 |
| U15-06 | MP4 | `Mp4Muxer` → `Mp4Demuxer` で U15-05 と同等の往復一致（pts 誤差 ±1μs） |
| U15-07 | `signals.js` | 同じ引数で2回生成した出力がビット単位で一致。`sigClickTrack(48000, 4, 120)` のクリック開始サンプルが 0, 24000, 48000, … |
| U15-08 | `wav.js` | 44 バイトのヘッダー各フィールドが仕様値。16bit 変換で ±1.0 が ±32767 にクランプ |

### 7.2 ブラウザ（`tests/browser/`）

| ID | ページ | 内容・合格基準 |
|---|---|---|
| B15-00 | 両方 | 成功1件・失敗1件・コンソールエラーを出すテスト1件で、判定がそれぞれ pass / fail / fail になる |
| B15-01 | ハーネス | `OfflineAudioContext`（48kHz・2秒、白色ノイズ＋440Hz＋3kHz 正弦波）で `AnalyserNode.getByteFrequencyData` と `SpectrumAnalyzer.analyze` を同じ 2048 サンプル境界で比較し、全ビンの **99% 以上が ±1 以内** |
| B15-02 | アプリ | 3秒の合成音（`sigDrumPattern`）の WAV を `OfflineExporter.export(file, settings, {fps: 30})` に渡し、状態が `done`、blob サイズ > 0、自前デマルチプレクサで読み戻した映像フレーム数が 90 ± 1 |
| B15-03 | アプリ | 合成音 WAV を読み込み再生した状態で、タイプ選択 UI を全14タイプへ順に切り替え、各タイプで 500ms 描画してコンソールエラー 0 |
| B15-04 | ハーネス | ゴールデン全66ケースが §3.6.3 の判定に合格 |
| B15-05 | ハーネス | （T15-06 以降）`OfflineExporter` の書き出し中に `FramePipeline.prototype.render` が総フレーム数と同じ回数呼ばれる（複製ロジックが残っていないことの確認） |
| B15-06 | アプリ | `index.html?debug=1` でデバッグ表示が存在し、1秒後に FPS 表示が数値。`?debug` なしでは要素が存在しない |

### 7.3 手動確認（T15-06 の PR で実施し結果を PR に記載）

- [ ] `index.html` を `file://` で開き、音声・動画ファイルでそれぞれ再生・録画・オフライン書き出しができる
- [ ] 動画合成 ON で、ライブ表示と書き出し結果の両方に動画が背景として出る
- [ ] 色相連続変化 ON で、ライブと書き出しの色相変化速度が同等に見える

---

## 8. `doc/spec.md` への反映内容（T15-06・T15-08 で実施）

- §12.1（色関連パラメータ）: 色相連続変化の速度は表示のリフレッシュレートに依存しない
- §16.3（保守性）: 描画処理はライブ・書き出しで共通の `FramePipeline` を通る
- §20: 「Phase 15: テスト基盤・描画パイプライン共通化（実装済み）」を追加（フェーズ完了時）
