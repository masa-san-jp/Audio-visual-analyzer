# Phase 6 実装計画書 — 拡張表現の実装・委託計画

- Repository: `masa-san-jp/Audio-visual-analyzer`
- Document version: `v1.0`
- Date: `2026-07-09`
- 対象仕様: `doc/spec-phase6.md`（設計仕様書）
- テスト設計: `doc/test-phase6.md`
- Purpose: 実装担当者への委託を前提とした、マイルストーン・タスク分解・運用ルールの定義

---

## 1. 前提

- 実装は `doc/spec-phase6.md` に従う。仕様と実装が乖離する場合は**仕様書を先に更新**して
  合意を得る（`CLAUDE.md` の開発基本方針に従い `doc/spec.md` / `log.md` も更新する）。
- 技術制約: Vanilla JS / Canvas 2D / 外部ライブラリなし / ビルド工程なし。
  `<script>` タグ直列読み込みのため、**モジュールシステム（import/export）は使わない**。
- 対象ブラウザ: Chrome / Edge（最新）。
- 規模表記: S（〜半日）/ M（〜1日）/ L（2〜3日）。1日 = 実装+単体テスト+自己確認込み。

---

## 2. マイルストーン構成

依存関係順。**M1 完了までは他マイルストーンに着手しない**（全タイプが基盤に依存するため）。
M2〜M5 は相互独立で、**並行委託が可能**。

```
M1 基盤          ──┬── M2 時間軸系 (T1,T2,T3,T4)
（全員の前提）      ├── M3 擬似3D系 (T5,T6)
                   ├── M4 粒子・流体系 (T7,T8,T9,T10) + M1修飾(粘性)
                   └── M5 幾何系 (T11,T12,T13)
                              ↓
                   M6 統合・仕上げ（UI最終調整・ランダマイズ・性能・録画検証）
```

| MS | 内容 | 主な成果物 | 規模合計 |
|----|------|-----------|---------|
| M1 | 基盤整備 | vis-utils / history-buffer / registry / core v2 / settings / テスト土台 | 4〜5日 |
| M2 | 時間軸系 4 タイプ | spectrogram.js / terrain.js / tunnel.js | 5〜6日 |
| M3 | 擬似3D系 2 タイプ | bar3d.js / ring3d.js | 2〜3日 |
| M4 | 粒子・流体系 4 タイプ + 粘性修飾 | particles.js / ripple.js / metaball.js + Spring統合 | 5〜6日 |
| M5 | 幾何系 3 タイプ | lissajous.js / flower.js / voronoi.js | 3〜4日 |
| M6 | 統合・仕上げ | UI 統合 / ランダマイズ / 性能チューニング / ドキュメント | 3〜4日 |

順次実施なら約 4〜5 週間、M2〜M5 を 2 名で並行すれば約 3 週間が目安。

---

## 3. タスク分解

### M1: 基盤整備（先行必須）

| ID | タスク | 対象ファイル | 内容 / 完了条件（DoD） | 規模 |
|----|--------|-------------|----------------------|------|
| M1-1 | テスト土台 | `test/lib/tester.mjs`, `test/run-all.mjs` | test-phase6.md §2 のミニテストランナー。`node test/run-all.mjs` が動く | S |
| M1-2 | vis-utils: 数学系 | `js/vis-utils.js` | `clamp/lerp/isoProject/polarToXy` + 単体テスト green | S |
| M1-3 | vis-utils: ValueNoise | 同上 | seed 決定性・値域 0..1・fbm。単体テスト green | S |
| M1-4 | vis-utils: Spring / SpringArray | 同上 | 収束・無発散（damping 下限）・`amount=0` バイパス。単体テスト green | M |
| M1-5 | vis-utils: BeatDetector | 同上 | 合成データ（周期パルス）でビート検出・不応期 200ms。単体テスト green | M |
| M1-6 | vis-utils: Voronoi | 同上 | `computeVoronoiCells` 面積和=キャンバス面積（誤差1%）等。単体テスト green | M |
| M1-7 | FrameHistory | `js/history-buffer.js` | リング動作・事前確保・`setFrameLength` 再構築。単体テスト green | S |
| M1-8 | AudioEngine 拡張 | `js/audio-engine.js` | `getByteTimeDomainData` 取得、`captureFrame` 拡張。既存動作の回帰なし | S |
| M1-9 | レジストリ + ケイパビリティ | `js/renderer-registry.js` | spec §4.1/§4.4 の構造。既存 bar/radial を登録し従来同等に動作 | M |
| M1-10 | VisualizerCore v2 | `js/visualizer-core.js` | frame 組立（history/beat/dtMs）、ステートフル対応、selfClear、タイプ切替時 dispose/リセット。既存2タイプがピクセル同等 | L |
| M1-11 | settings 追加 | `js/settings.js` | 新4キー追加・既定値。リセットで復元 | S |
| M1-12 | UI: タイプ選択拡張 + 動的表示の骨格 | `js/ui-controller.js`, `index.html` | optgroup 化・ケイパビリティ連動表示の仕組み（新タイプの option は各MSで追加） | M |
| M1-13 | ビジュアルハーネス骨格 | `test/visual-harness.html`, `test/lib/mock-audio.js` | test-phase6.md §4。既存2タイプで全組み合わせ巡回が green | M |

**M1 完了条件**: 既存機能の回帰ゼロ（手動チェックリスト §5.1 パス）+ 単体テスト全 green +
ハーネスが既存タイプで動作。

### M2: 時間軸系

| ID | タスク | 対象 | DoD | 規模 |
|----|--------|------|-----|------|
| M2-1 | T1 spectrogram | `js/renderers/spectrogram.js` | spec §6.1 受け入れ条件 + ハーネス green | M |
| M2-2 | T2 spectrogram-radial | 同上（同ファイル内） | spec §6.2 受け入れ条件 + ハーネス green | M |
| M2-3 | T3 terrain | `js/renderers/terrain.js` | spec §6.3 受け入れ条件（隠面処理含む）+ 射影は vis-utils を使用 | L |
| M2-4 | T4 tunnel | `js/renderers/tunnel.js` | spec §6.4 受け入れ条件 + リング数上限クランプ | M |
| M2-5 | UI 統合 | `ui-controller.js`, `index.html` | 4タイプの option 追加・`slider-history` 表示連動 | S |

### M3: 擬似3D系

| ID | タスク | 対象 | DoD | 規模 |
|----|--------|------|-----|------|
| M3-1 | T5 bar3d | `js/renderers/bar3d.js` | spec §6.5 受け入れ条件（4レイヤー階段）| M |
| M3-2 | T6 ring3d | `js/renderers/ring3d.js` | spec §6.6 受け入れ条件（奥行きソート）| M |
| M3-3 | UI 統合 | 同上 | option 追加・`slider-motion` 連動 | S |

### M4: 粒子・流体系 + 粘性修飾

| ID | タスク | 対象 | DoD | 規模 |
|----|--------|------|-----|------|
| M4-1 | 粒子プール基盤 | `js/renderers/particles.js` | 固定長プール（Float32Array）・spawn/update/寿命。プールのロジックは純関数化し単体テスト green | M |
| M4-2 | T7 particles | 同上 | spec §6.7 受け入れ条件（上限 600・ビートバースト）| M |
| M4-3 | T9 flow | 同上（プール共有） | spec §6.9 受け入れ条件（ノイズ場追従・残像推奨値）| M |
| M4-4 | T8 ripple | `js/renderers/ripple.js` | spec §6.8 受け入れ条件（ビート同期・32本上限）| S |
| M4-5 | T10 metaball | `js/renderers/metaball.js` | spec §6.10 受け入れ条件 + `ctx.filter` フォールバック | L |
| M4-6 | M1 粘性揺らぎ統合 | `visualizer-core.js`, 既存 renderers | spec §6.14。`physicsAmount=0` でピクセル同等（回帰確認必須）| M |
| M4-7 | UI 統合 | 同上 | option 追加・`slider-particles`/`slider-physics` 連動 | S |

### M5: 幾何系

| ID | タスク | 対象 | DoD | 規模 |
|----|--------|------|-----|------|
| M5-1 | T11 lissajous | `js/renderers/lissajous.js` | spec §6.11 受け入れ条件（ハーネスの正弦波でリサージュ形状）| M |
| M5-2 | T12 flower | `js/renderers/flower.js` | spec §6.12 受け入れ条件 | M |
| M5-3 | T13 voronoi | `js/renderers/voronoi.js` | spec §6.13 受け入れ条件（再計算はリサイズ時のみ）| M |
| M5-4 | UI 統合 | 同上 | option 追加・スライダー連動 | S |

### M6: 統合・仕上げ

| ID | タスク | 対象 | DoD | 規模 |
|----|--------|------|-----|------|
| M6-1 | ランダマイズ対応 | `ui-controller.js` | ケイパビリティ準拠の選択（不正組み合わせゼロ）。100回連打テスト（test §5.4）パス | M |
| M6-2 | 性能チューニング | 全 renderers | test §6 の測定で全タイプ基準内。予算超過タイプは要素数を調整 | M |
| M6-3 | 録画統合検証 | – | 全15タイプ × MP4/WebM で 10 秒録画→再生・Duration 確認（test §5.3）| M |
| M6-4 | ドキュメント | `doc/spec.md`, `README.md`, `log.md` | spec.md へ Phase 6 完了反映・README 機能追記・log 記録 | S |
| M6-5 | 最終回帰 | – | test-phase6.md §7 全項目 + 受け入れ条件サマリー（spec §10）全項目パス | M |

---

## 4. 委託パッケージング（担当分け案）

| パッケージ | 範囲 | 前提知識 | 並行可否 |
|-----------|------|---------|---------|
| P0（リード） | M1 全部 + M6 | 既存コード全体・アーキテクチャ判断 | 先行必須 |
| P1 | M2（時間軸系） | FrameHistory・オフスクリーンキャンバス | M1 後、P2/P3 と並行可 |
| P2 | M3 + M5（擬似3D・幾何） | 座標変換・vis-utils | M1 後、並行可 |
| P3 | M4（粒子・流体） | パーティクル設計・合成モード・filter | M1 後、並行可 |

- 各パッケージは **仕様書該当節 + 本計画のタスク表 + テスト設計該当節** の3点を渡せば
  自己完結する構成になっている。
- 担当者間のインターフェース衝突点は `renderer-registry.js`（各自が自タイプを追記）と
  `index.html` の script タグ/option 追加のみ。**登録は1タイプ1ブロック**とし、
  コンフリクトを小さくする。

## 5. ブランチ・PR 運用

- ベース: `main`。ブランチ命名: `phase6/m1-foundation`, `phase6/m2-time-axis` など
  **マイルストーン単位で1 PR**。
- PR 必須要件:
  1. `node test/run-all.mjs` green（CI がないため PR 説明にログを貼る）
  2. `node --check` 全ファイルパス
  3. ビジュアルハーネスの結果 JSON（test §4.4）を PR 説明に添付
  4. 該当する手動チェックリスト項目の実施結果
  5. `log.md` にエントリ追記（CLAUDE.md の方針どおり）
- レビュー観点チェックリスト:
  - [ ] 性能予算（要素数上限）がコードでクランプされているか
  - [ ] フレーム内で配列/オブジェクトを生成し続けていないか（プール化）
  - [ ] `dispose()`/`onResize()` が正しく実装されているか
  - [ ] ロジックが vis-utils 等の純関数に分離され、テストがあるか
  - [ ] 既存タイプへの回帰がないか（M4-6 は特に注意）

## 6. コーディング規約（本リポジトリ固有）

- ES2020 まで。クラス構文可・`import/export` 不可（script タグ直列）。
- 命名: クラス PascalCase / 関数・変数 camelCase / モジュール内定数 UPPER_SNAKE。
- プライベート相当は `_` プレフィックス（既存踏襲）。`#` プライベートフィールドは使わない。
- コメントは日本語。各レンダラーファイル冒頭に仕様書該当節を記載
 （例: `// T3 3D地形 — doc/spec-phase6.md §6.3`）。
- 乱数はシード指定可能なユーティリティ経由とし、テスト対象ロジックでは
  `Math.random()` を直接使わない（描画のみの散らしは可）。
- `console.log` は残さない（ハーネス・テストコードは除く）。

## 7. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| T10 metaball の `ctx.filter` が録画キャプチャに反映されない環境差 | 中 | M4-5 の最初に録画スパイクテストを行い、NG ならしきい値処理を ImageData 方式（1/4 解像度）へ切替。判断は仕様書更新で確定 |
| terrain の隠面処理（塗り遮蔽）が重い | 中 | 行数を 90→60 に落とす調整余地を仕様に確保済み。M6-2 で実測調整 |
| ステートフル化による既存回帰 | 高 | M1-10 で既存2タイプのピクセル同等性をハーネスで検証（test §4.3）。M1 完了ゲートで担保 |
| 並行開発での registry/index.html コンフリクト | 低 | 1タイプ1ブロック規約 + マイルストーン単位 PR で分離 |
| 60fps 未達タイプの発生 | 中 | 各タイプに要素数クランプを必須化。未達時は予算値を下げる（仕様の予算は上限であり品質目標は fps 優先）|
| ランダマイズが重いタイプ連発で録画中に負荷急変 | 低 | 録画中はタイプ切替を許容しつつ、test §5.3 で録画中切替の安定性を確認 |

## 8. スケジュール目安（2名体制の例）

| 週 | 担当A（リード） | 担当B |
|----|----------------|-------|
| W1 | M1-1〜M1-13（基盤） | （待機 or 仕様レビュー・ハーネス試用） |
| W2 | M4（粒子・流体） | M2（時間軸系） |
| W3 | M4 続き + M3 | M5（幾何系） |
| W4 | M6 統合・性能・録画検証 | M6 手動テスト・ドキュメント |

---

## 9. 完了定義（Phase 6 全体）

1. `doc/spec-phase6.md` §10 受け入れ条件サマリー 9 項目すべてパス
2. `doc/test-phase6.md` の単体テスト全 green・手動チェックリスト全項目パス・性能基準達成
3. `doc/spec.md` / `README.md` / `log.md` が実装に同期している
4. main へ全マイルストーン PR がマージ済み
