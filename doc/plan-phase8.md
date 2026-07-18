# Phase 8〜10 開発計画書 — 機能拡張・書き出し品質強化・動画合成表示

- Repository: `masa-san-jp/Audio-visual-analyzer`
- Document version: `v1.0`
- Date: `2026-07-18`
- 対象仕様: `doc/spec.md` §23「今後の検討項目」
- Purpose: §23 の候補群を実装可能な粒度へ分解し、優先順位・依存関係・タスクを定義する

---

## 1. 全体像

`doc/spec.md` §23 に列挙されていた項目と、Phase 7 の技術的負債（`ScriptProcessorNode`）を、3フェーズに整理する。

| フェーズ | テーマ | 規模 | 依存関係 |
|---|---|---|---|
| **Phase 8** | ユーザー向け機能拡張 | 小〜中（5項目、いずれも独立） | なし。並行実装可 |
| **Phase 9** | 書き出し品質強化 | 中〜大（2項目） | Phase 7（オフライン書き出し）に依存 |
| **Phase 10** | 動画合成表示 | 中（ライブ）〜大（オフライン） | 10.1 はなし。10.2 は 9.1（MP4）との相性を考慮 |

### 実装順序（推奨）

```
Phase 8（全項目・並行可）─┐
                          ├─→ Phase 10.1（ライブ動画合成）
Phase 9.1（MP4マクサー）──┤
                          └─→ Phase 10.2（オフライン動画合成・発展）
Phase 9.2（AudioWorklet移行）── 最後（緊急度低）
```

- Phase 8 は独立した小機能の集合なので最速で価値が出る。最初に着手する。
- Phase 10.1（ライブ）は Phase 9 と無関係に進められるため、Phase 9.1 と並行可能。
- Phase 10.2（オフライン書き出しでの動画合成）は最も難度が高く、10.1 のUXが固まってから着手する。
- Phase 9.2（AudioWorklet 移行）は現状 `ScriptProcessorNode` が正常動作しており緊急性がないため最後に回す。

---

## 2. Phase 8: ユーザー向け機能拡張

### 8.1 設定シリアライズ基盤（プリセット保存/読込 + JSON入出力）

プリセットとJSON入出力は同じシリアライズ形式を共有する共通基盤として実装する。

- **新規ファイル**: `js/settings-io.js`
  - `serializeSettings(settings)`: `{ version: 1, settings: {...} }` 形式のプレーンオブジェクトを返す（`layers` 配列を含む）
  - `deserializeSettings(json)`: バージョンチェック＋各値を `createDefaultSettings()` の既定値でフォールバックしながら安全にマージ（不正値のクランプも行う）
  - `savePreset(name, settings)` / `loadPreset(name)` / `listPresets()` / `deletePreset(name)`: `localStorage` の名前空間キー `avz.presets.v1` を使用
  - `downloadSettingsJson(settings, filename)`: Blob + アンカー要素でダウンロード（`recorder.js`/`offline-exporter.js` の `save()` と同じパターン）
  - `readSettingsJsonFile(file)`: `file.text()` → `JSON.parse` → `deserializeSettings`
- **UI**: 新規セクション「プリセット」
  - プリセット名入力 + 保存ボタン
  - 保存済みプリセットのセレクト + 読込ボタン + 削除ボタン
  - 「設定をJSON保存」「JSON読込」ボタン（ファイル入力）
- **DoD**: 保存→リロード→読込で全設定値（レイヤー含む）が復元される。不正なJSONを読み込んでもクラッシュせずエラー表示

### 8.2 マイク入力対応

- `js/audio-engine.js`: `connectStream(stream)` を追加（`createMediaStreamSource(stream)` を使用、`connectMedia` と同様にダウンストリームは analyser 接続を共有）
- 新規 `js/mic-input.js`: `MicInputManager` — `getUserMedia({audio:true})` の呼び出し・権限拒否時のエラーハンドリング・停止時の `track.stop()` によるリソース解放
- **UI**: ファイルセクション付近に「マイク入力」トグルボタンを追加
  - マイク入力中はファイル再生系ボタン（再生/一時停止/停止）と「音楽ファイルを選択」（オフライン書き出し）を無効化（メディア要素の概念がないため）
  - 録画（Recorder）はマイク入力中も動作する（canvas + analyser 経由のため無関係）
- **DoD**: マイク入力でビジュアライザーが反応する。切替時に前のトラックが確実に停止する（マイクインジケータが消える）。権限拒否時にエラーメッセージが出る

### 8.3 フルスクリーン表示

- `#visualizer-area` に対して `requestFullscreen()` / `exitFullscreen()` をトグルするボタンを追加
- 既存の `visualizer.resize()` が `area.clientWidth/clientHeight` を参照する設計のため、`fullscreenchange` イベントで `resize()` を呼べばそのまま追従する
- **DoD**: フルスクリーン切替でアスペクト比を保ったまま表示が拡大される。Esc キーでの解除（ブラウザ既定）にも追従する

### 8.4 キーボードショートカット

- キーマップ（暫定案。実装時に `index.html` の凡例に反映）:
  | キー | 動作 |
  |---|---|
  | Space | 再生 / 一時停止トグル |
  | R | アナライザーランダム |
  | H | 色相ランダム |
  | S | 形状ランダム |
  | F | フルスクリーン切替 |
  | B | 録画開始 / 停止トグル（録画モード時のみ） |
- `document.addEventListener('keydown', ...)` で実装。フォーカスが `input`/`select`/`textarea` にあるときは無視する（スライダー操作・プリセット名入力を妨げない）
- **UI**: 折りたたみ可能な凡例テキスト（常設は避け、簡素に）
- **DoD**: 各キーで対応動作が発火する。テキスト入力中は発火しない

### 8.5 レイヤーごとのブレンドモード

- `settings.js`: 各 `layers[i]` に `blendMode`（既定 `'source-over'`。候補: `'source-over' | 'lighter' | 'multiply' | 'screen'`）を追加
- `js/visualizer-core.js` の `_renderStateless` で、各レイヤー描画の前後に `ctx.globalCompositeOperation` を設定/復元（bar/radial のみ対象。ステートフルタイプは対象外）
- `js/offline-exporter.js` の `_renderStateless`（複製箇所）にも同様に反映
- **UI**: レイヤー個別設定パネル（`_renderLayerSettings`）に、各レイヤーのブレンドモード選択を追加
- **DoD**: レイヤーごとに異なるブレンドモードを設定すると重ね合わせの見た目が変わる。既定値 `source-over` では従来と完全に同一の描画（回帰なし）

---

## 3. Phase 9: 書き出し品質強化

### 9.1 MP4（fMP4）オフライン書き出し対応

現状のオフライン書き出しは WebM 固定。ライブ録画（`recorder.js`）と同様に MP4 出力を選べるようにする。

- **新規ファイル**: `js/mp4-muxer.js` — フラグメント化 MP4（fMP4）をゼロから構築する
  - Box 構成: `ftyp` → `moov`(`mvhd`, `trak`×2[`tkhd`,`mdia`(`mdhd`,`hdlr`,`minf`(`vmhd`/`smhd`,`dinf`,`stbl`(`stsd`+`avcC`/`esds`, 空の `stts`/`stsc`/`stsz`/`stco`))], `mvex`(`trex`×2)) → `moof`+`mdat` の繰り返し（1フラグメント=1 GOP を目安）→ 末尾に `mfra`（シーク索引。WebM の Cues に相当）
  - コーデック設定: 映像は `VideoEncoder` の `metadata.decoderConfig.description`（AVCDecoderConfigurationRecord）をそのまま `avcC` へ、音声は同様に AAC の `AudioSpecificConfig` を `esds` へ格納する（`js/webm-muxer.js` で Opus の `description` を CodecPrivate に使った手法と同じ考え方）
  - `js/webm-muxer.js` と同様、独立実装の box リーダーで Node 構造テストを書く（`ftyp`/`moov`/`trak`/`mvex`/`moof`/`mdat` の妥当性、`mfra` の各エントリが実際にフラグメントを指しているか）
- **変更**: `js/offline-exporter.js`
  - 映像コーデック候補に `avc1.640028` 等を追加（`recorder.js` の `RECORDER_MIME_CANDIDATES` に準じた優先順位）し、`VideoEncoder.isConfigSupported` で MP4/WebM を自動選択（MP4優先→WebM フォールバック、`recorder.js` の方針を踏襲）
  - 音声コーデックも `mp4a.40.2`（AAC）候補を追加し、`AudioEncoder.isConfigSupported` で判定
  - 選択したコンテナに応じて `WebmMuxer` / `Mp4Muxer` を切り替え、保存拡張子（`.mp4`/`.webm`）も連動させる
- **DoD**: MP4対応環境で `.mp4` が生成され、`<video>` 要素で再生・シークできる。非対応環境は WebM にフォールバックする。Node構造テスト + Chromium E2E（既存 `offline-export-e2e.mjs` と同パターン）で検証

### 9.2 AudioWorklet ベース解析への移行

`OfflineExporter._analyze()` が使う `ScriptProcessorNode` は非推奨API。現状は正常動作しているため緊急度は低いが、置き換える場合の設計を記す。

- 制約: `AudioWorkletProcessor` は別レルム（オーディオレンダリングスレッド）で動作し、メインスレッドの `AnalyserNode` を直接呼び出せない。そのため単純な置換はできず、**FFT自体をワークレット内に自前実装する**必要がある
- **新規ファイル**:
  - `js/fft.js`: 複素FFT（Radix-2 Cooley-Tukey）+ Blackman窓（Web Audio 仕様準拠）+ `smoothingTimeConstant` の指数移動平均（dB領域）+ dB→byte マッピング（`minDecibels`/`maxDecibels` 既定 -100/-30）。**ライブの `AnalyserNode` と出力が実用上一致することを Node テストで検証**（既知の正弦波入力でピークbinの位置・振幅を確認）
  - `js/analysis-worklet.js`: `AudioWorkletProcessor` 実装。`process()` でPCMをリングバッファへ蓄積し、`fftSize` 分たまるごとに `fft.js` で解析、結果を `port.postMessage`（Transferable）でメインスレッドへ送る
- **変更**: `offlineCtx.audioWorklet.addModule('js/analysis-worklet.js')` → `AudioWorkletNode` 経由でメッセージ受信に置き換え
- **DoD**: 同一音源で ScriptProcessorNode版と AudioWorklet版の出力が実用上一致する（既存の `offline-export-e2e.mjs`/variants テストが同様に通過）。優先度低のため、他フェーズ完了後に着手する

---

## 4. Phase 10: 動画合成表示

### 10.1 ライブプレビューでの動画背景合成

`media-manager.js` は動画ファイル読込時に `<video>` 要素を生成済みだが、現状は音声抽出のみに使い映像は描画していない（`doc/spec.md` §13.3 の初版方針）。これを解禁する。

- `js/settings.js`: `videoCompositeEnabled`（既定 `false`）/ `videoCompositeOpacity`（0〜100）/ `videoCompositeBlendMode` を追加
- `js/visualizer-core.js`: `_loop()` 冒頭、背景クリアの前後どちらかに、`mediaManager.isVideo && settings.videoCompositeEnabled` の場合 `ctx.drawImage(mediaManager.mediaElement, ...)` で現在フレームを描画する。動画のネイティブアスペクト比とキャンバスのアスペクト比が異なる場合は cover 方式でフィットさせる（`resize()` の考え方を流用）
- **UI**: 動画ファイル読込中のみ表示される「動画合成」セクション（トグル・不透明度・ブレンドモード）
- **相互作用**: 録画（`Recorder`）は `canvas.captureStream()` を使うため無改修で動画合成込みの録画が可能。オフライン書き出しは対象外（10.2 で扱う）
- **DoD**: 動画ファイル読込時に背景として映像が表示され、不透明度・ブレンドモードが効く。録画にも反映される。音声ファイル読込時はセクション自体が非表示

### 10.2 オフライン書き出しでの動画合成（発展）

オフライン書き出しは現状 `decodeAudioData` による音声デコードのみで、映像フレームのデコード経路を持たない。

- **方式**（初版は簡易版を推奨）: オフスクリーンの `<video>` 要素を各解析フレーム時刻へ `currentTime` でシークし、`requestVideoFrameCallback` でフレーム到着を待ってから `drawImage` する。実装が単純な反面、圧縮動画のシーク精度・速度に制約がある
- **発展案**（将来最適化）: WebCodecs `VideoDecoder` で映像トラックを直接デコードし、タイムスタンプ同期で解析フレームと突き合わせる方式（実装は大きいが書き出し速度が向上する）
- 位置付け: 10.1 のUXが固まり、9.1（MP4）が安定してから着手する発展フェーズ。今回の計画では設計方針の記録に留め、実装着手は別途判断する

---

## 5. 完了定義

- Phase 8: 5項目すべてが個別に動作し、`node --check` 全ファイルパス、既存回帰（foundation/smoke/browser-check）に影響なし
- Phase 9.1: MP4構造テスト（Node）+ Chromium E2E がパスし、MP4/WebM 両方の出力を確認
- Phase 9.2: AudioWorklet版とScriptProcessorNode版の出力比較テストがパス
- Phase 10.1: 動画合成のライブ・録画確認、既存の音声専用フローに回帰なし
- Phase 10.2: 設計方針のみ（本計画時点では実装義務なし）

各フェーズ完了時、`doc/spec.md` の該当セクション・§20（開発フェーズ提案）・`README.md`・`log.md` を更新する（既存 Phase 6/7 と同様の運用）。
