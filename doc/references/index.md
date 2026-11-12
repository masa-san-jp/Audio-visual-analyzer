# ビジュアライザー・リファレンスDB

- 初期調査 v0.1 / 確認日: 2026-11-12 JST
- 対象: 音反応型描画、映像合成、スペクトル表示、音特徴抽出の代表的な5製品・ライブラリと、計算規約の根拠2件。
- 確認水準: 公開一次資料のREADME/API/仕様/ライセンスを読んだ。インストール・実機比較・性能計測はしていない。全製品を網羅するDBではない。
- 位置づけ: 比較資料。採用決定や実装済み機能を意味しない。[共通機能モデル](../common-capabilities.md)と[改善仕様案](../improvement-spec.md)へつなぐ。
- 書誌の版: REF-01〜06は確認日の公開文書で、特定release/commitに固定した実装比較ではない。実装採用前に対象版を固定して再確認する。REF-07のみ規格の確定版を固定する。

## 1. レコードの管理規則

各レコードは、識別子、対象、原文URL、確認日・版、読んだ範囲、確認した機能、制約、再利用条件、未確認事項、共通仕様との関係を持つ。URLだけで「確認済み」にしない。将来の追記では既存IDを再利用せず、訂正理由と確認範囲を残す。公開文書を要約し、原文・プリセット・画像・コードを無断転載しない。

| ID | 対象と一次資料 | 確認できた機能 | 抽象化できる点（本プロジェクトの解釈） | 制約・確認範囲 |
|---|---|---|---|---|
| REF-01 | [Butterchurn](https://github.com/jberg/butterchurn) README/API例 | WebGL2のMilkDrop系描画、外部AudioNode接続、プリセット読込、秒単位の遷移、サイズ変更、明示的render呼出し | 音源取得と描画の分離、プリセット遷移、1フレーム描画契約（CAP-01/02/05/06） | 文書のみ。実測・全プリセット互換性は未確認 |
| REF-02 | [projectM](https://github.com/projectM-visualizer/projectm) README、[LICENSE](https://github.com/projectM-visualizer/projectm/blob/master/LICENSE.txt) | 音声からMilkDrop互換映像を生成する再利用ライブラリ。フロントエンドは別リポジトリ | コア処理とアプリ、音声・描画・プリセット管理の境界（CAP-01/05/06） | ライブラリ機能と各フロントエンド機能を混同しない。文書のみ |
| REF-03 | [Hydra](https://github.com/hydra-synth/hydra) README、[hydra-synth](https://github.com/hydra-synth/hydra-synth) 埋込みAPI | ブラウザの映像合成、複数出力バッファ、画像・動画・カメラ、変形・合成・フィードバック、自動描画を止めtick(dt)で進行 | 生成→変形→合成の分割と時間の明示（CAP-02/04/05/06） | 映像合成環境であり音解析精度の保証ではない。文書・例のみ |
| REF-04 | [TouchDesigner Audio Spectrum CHOP](https://derivative.ca/UserGuide/Audio_Spectrum_CHOP) 公式仕様 | 表示用スペクトルと生の振幅・位相変換の区別、FFT長、対数軸、高域強調、出力長 | 分析値と表示加工を分離。周波数分解能と時間応答のトレードオフ（CAP-03/04/05） | 商用製品の公開仕様比較。コード実装や実測は未確認 |
| REF-05 | [audioMotion-analyzer API](https://audiomotion.dev/)、[LICENSE](https://github.com/hvianna/audioMotion-analyzer/blob/master/LICENSE) | 外部音源、周波数尺度、オクターブ帯域、平滑化、ピーク保持、ステレオ表示、周波数範囲のエネルギー取得 | 帯域・単位・尺度・平滑化の設定契約、音声出力接続の有無（CAP-01/03/04/05） | 文書のみ。既存製品の描画品質を置き換えられるとの主張ではない |
| REF-06 | [Meyda特徴量説明](https://meyda.js.org/audio-features)、[LICENSE](https://github.com/meyda/meyda/blob/main/LICENSE.md) | RMS、振幅スペクトル、重心・平坦度・変化量。窓関数で値が変わる旨、既定Hanningの説明 | 特徴名だけで同値とみなさず、窓・単位・正規化を固定（CAP-03） | 音特徴抽出ライブラリであり描画製品ではない。対象版の実装再現は未実施 |
| REF-07 | [Web Audio API W3C Recommendation 2021-06-17 §1.8.6](https://www.w3.org/TR/2021/REC-webaudio-20210617/#fft-windowing-and-smoothing-over-time) | AnalyserNodeのBlackman窓→フーリエ変換→時間平滑化→dB変換 | MFSとフォールバックの計算過程を比較する根拠（CAP-03/09） | 2021確定版。最新入口のWorking Draftとは区別。ブラウザ実装の適合試験は未実施 |

## 2. ライセンスと採用の境界

| 対象 | 今回確認した表記 | 採用前に必要な再確認 |
|---|---|---|
| Butterchurn | コアMIT | プリセット・画像・依存物は別途。コアの許諾をすべての素材へ拡張しない |
| projectM | LGPL-2.1 | 対象版、リンク方式、配布物、依存ライセンス |
| Hydra / hydra-synth | AGPL-3.0 | 対象リポジトリ・版・提供形態と義務 |
| audioMotion-analyzer | AGPL v3 | MITと誤認しない。対象版と配布・提供形態 |
| Meyda | MIT | 対象版・依存物・表記保持 |
| TouchDesigner | 商用製品の公開文書 | コード・素材利用の許諾は今回確認していない |
| W3C文書 | 規格参照 | 原文の利用条件。規格本文の転載ではなく出典参照とする |

ライセンス情報は法的な個別助言ではない。今回は外部コードを導入していない。現行製品の「外部ライブラリなし」を変更する提案でもない。

## 3. 共通性と方式固有性

- 共通化候補: 入力の責務分離、時刻、特徴の単位、写像、描画のライフサイクル、設定保存、出力、能力検出。
- 方式固有: MilkDropプリセット、Hydraの合成グラフ、TouchDesignerのCHOP、audioMotionのスペクトル表示、現行GPUの全曲解析。これらを同一APIへ無理に統一しない。
- 特徴量は同名でも計算規約が違えば同じ値にならない。REF-06の窓とREF-07の窓の違いはその例であり、実装の誤りを意味しない。
- リアルタイムに描けることと、未来の音を参照せず描けることは別。全曲先読みが必要な方式は入力モードの制約として扱う。

## 4. 未確認と調査の終点

- 各製品の実機挙動・性能・映像品質・最新ブラウザ互換性・全プリセット権利は未確認。
- Resolumeの公式FFTページは取得できず、確定比較に含めていない。
- 初期調査は上の7レコードの機能・出典・確認範囲の整理で区切る。以後は改善項目の具体的な不足を埋める追加調査とし、際限なく事例数を増やさない。
- 調査結果と本プロジェクトへの採用判断は別。採否は改善仕様案で明記する。
