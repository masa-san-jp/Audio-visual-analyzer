# 開発ログ

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
