# 開発ログ

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
