# Phase 14 開発計画書 — オフライン書き出しの動画デコード高速化

- Repository: `masa-san-jp/Audio-visual-analyzer`
- Document version: `v1.0`
- Date: `2026-07-18`
- 前提: Phase 8〜13 完了済み
- Purpose: `doc/spec.md` §23 残候補「オフライン書き出しの動画デコード高速化」を実装する。
  Phase 10.2 の動画合成は各出力フレームごとに `<video>` を `currentTime` でシークする方式で、
  正確だが実時間シーク待ちが累積する（3分の動画で数分単位のオーバーヘッド）。
  WebCodecs `VideoDecoder` で映像トラックを直接デコードし、シーク待ちを排除する

---

## 1. スコープと段階分け

WebCodecs にはデマルチプレクサ（コンテナ解析）が無いため自前実装が必要。段階を分ける。

| 項目 | 内容 | 状態 |
|---|---|---|
| **14.1** | WebM デマルチプレクサ + `VideoDecoder` 合成経路 + フォールバック | 実装済み |
| **14.2** | MP4（ISOBMFF）デマルチプレクサ対応 | 実装済み |

- WebM を先行する理由: ① `MediaRecorder` の出力（本アプリの録画ファイルを含む）が WebM であり、
  実利用で最も投入されやすい、② VP8/VP9 は Chromium 標準搭載でデコードでき、
  開発環境（H.264 非搭載の Chromium）で実デコードまで E2E 検証できる
- WebM 以外（MP4 等）・デマルチプレクサが解釈できないファイル・`VideoDecoder` 非対応環境は、
  既存の `currentTime` シーク方式へ**自動フォールバック**する（機能低下なし・速度のみ差）

## 2. 設計（14.1）

### 2.1 `js/webm-demuxer.js`（新規）
- EBML を解析し、映像トラックの符号化チャンク列を取り出す
  `WebmDemuxer.parse(bytes) -> { codec, codedWidth, codedHeight, chunks: [{data, timestampUs, keyframe}] }`
- 対応要素: EBML ヘッダー / Segment（不定長対応）/ Info（TimestampScale）/
  Tracks（TrackEntry: TrackNumber・TrackType・CodecID・Video PixelWidth/PixelHeight）/
  Cluster（不定長対応、Timestamp + SimpleBlock / BlockGroup>Block+ReferenceBlock）
- `MediaRecorder` のストリーミング出力は Segment / Cluster が不定長（unknown-size）のため、
  「次の同レベル要素 ID の出現 or EOF まで」を終端とみなす標準的な走査で対応する
- CodecID: `V_VP8` → `'vp8'` / `V_VP9` → `'vp09.00.10.08'`。それ以外は非対応として例外
  （呼び出し側がフォールバックする）

### 2.2 `js/offline-exporter.js` — フレームソース抽象
- 動画合成のフレーム取得を `frameAt(tSec)` インターフェースに抽象化し、2実装を持つ
  1. **デコーダー方式**（優先）: デマルチプレクサの出力を `VideoDecoder` へ供給。
     VP8/VP9（WebM）は B フレームが無く提示順=デコード順のため、
     「目標時刻を超えるフレームが出るまで順次デコードし、直前のフレームを描画対象とする」
     単純な先読みで済む。使い終わった `VideoFrame` は即 `close()` してメモリを抑える
  2. **シーク方式**（既存）: オフスクリーン `<video>` の `currentTime` シーク + `seeked` 待機
- 描画（`_drawCompositeVideoFrame`）は `<video>`（`videoWidth`）と `VideoFrame`
  （`displayWidth`）の両方を扱えるよう寸法取得を一般化する
- 初期化失敗（非WebM・コーデック非対応等）とデコード途中のエラーはどちらも
  シーク方式へ自動フォールバックする

## 3. 検証

- Node 単体: `webm-muxer.js` の出力（既知の合成チャンク）を新デマルチプレクサで解析し、
  チャンクのバイト列・タイムスタンプ・キーフレーム・コーデック・解像度が往復一致すること
- Chromium E2E: `MediaRecorder` 生成の実 WebM（不定長要素を含む）で、
  ①デコーダー方式が実際に選択されること、②合成結果のピクセル検証（Phase 10.2 と同一基準）、
  ③非対応入力でシーク方式へフォールバックして完走すること
- 既存回帰一式に影響なし

## 4. 14.2（MP4）の設計メモ（将来）

- progressive MP4: `moov>trak>mdia>minf>stbl` の `stts/ctts/stss/stsc/stsz/stco(co64)` から
  サンプル列を構築し、`stsd>avc1>avcC` を `description` に渡す（mdat は AVCC 形式のため
  そのまま `EncodedVideoChunk` にできる）
- fragmented MP4: `moof>traf>tfhd/tfdt/trun` を走査（自前 `mp4-muxer.js` の逆操作）
- H.264 は B フレームで提示順≠デコード順になり得るため、提示順への並べ替えバッファが必要
- H.264 デコーダー非搭載環境ではフォールバックが機能することを確認する
