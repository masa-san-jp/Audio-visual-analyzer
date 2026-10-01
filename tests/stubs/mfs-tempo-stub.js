// 目的 — T16-03（js/mfs-tempo.js）マージ前に MfsExtractor を単体テストするための MfsTempo スタブ — doc/20260928-plan-phase16-music-feature-stream.md §5.0 / §8
//
// §5.0 の API（constructor / process / reset / 公開フィールド）だけを持ち、常に locked = 0 を報告する。
// T16-03 のマージ後は、テストの loadClassic 一覧でこのファイルを 'js/mfs-tempo.js' に差し替える（js/mfs-extractor.js は変更しない）。
// 本ファイルはアプリ本体（index.html・ワークレット）からは読み込まない。

class MfsTempo {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.reset();
  }

  reset() {
    this.bpm = 0;
    this.conf = 0;
    this.phase = 0;
    this.barPhase = 0;
    this.beatInBar = 0;
    this.beatFlag = 0;
    this.downbeatFlag = 0;
    this.locked = 0;
  }

  // 何もしない（テンポは確定しない）
  process(odf, odfLow, onsetFlags, envFull, tSec) {}
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MfsTempo };
}
