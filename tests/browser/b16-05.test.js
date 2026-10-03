// @page harness
// 目的 — FramePipeline v2（features あり/なし・音量自動補正・レイヤー分割）で全8タイプが例外なく描画できることを確認する（計画書 §9.2 B16-05）。
// autoGain = false でのゴールデン不変は B15-04（golden.test.js）が担う。

avzTest('B16-05', 'B16-05 features あり・なしの input で全8タイプを描画でき、autoGain=false では freq が不変', async function () {
  const FREQ_LENGTH = 638;
  const TIME_LENGTH = 2048;
  const FRAMES = 6;
  avzAssert.equal(GOLDEN_ANALYZER_TYPES.length, 8, 'タイプ数が8ではありません');

  const features = new MfsFrameView();
  const freq = new Uint8Array(FREQ_LENGTH);
  const time = new Uint8Array(TIME_LENGTH);
  const variants = [
    { name: 'features なし', features: null, autoGain: false, layerSplit: 'linear' },
    { name: 'features あり / autoGain 無効', features: features, autoGain: false, layerSplit: 'linear' },
    { name: 'features あり / autoGain 有効 / 聴感分割', features: features, autoGain: true, layerSplit: 'mel' },
    { name: 'features なし / autoGain 有効（無視される）', features: null, autoGain: true, layerSplit: 'mel' },
  ];

  let rendered = 0;
  for (const type of GOLDEN_ANALYZER_TYPES) {
    for (const v of variants) {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const pipeline = new FramePipeline(canvas, canvas.getContext('2d'));
      const settings = createDefaultSettings();
      Object.assign(settings, { analyzerType: type, layerCount: 3, autoGain: v.autoGain, layerSplit: v.layerSplit });
      features.raw.fill(0);
      features.raw[MFS_LAYOUT.AGC_DB] = 6;
      const input = {
        freq, time, getLayer: null, features: v.features, sampleRate: 48000, fftSize: 2048,
        dtMs: 16.7, nowMs: 0, historyFps: 60, drawBackground: null,
      };
      try {
        pipeline.fillBackground(settings);
        for (let i = 0; i < FRAMES; i++) {
          synthFrame(i, FREQ_LENGTH, TIME_LENGTH, freq, time);
          input.nowMs = i * 16.7;
          pipeline.render(input, settings);
          rendered++;
        }
        // lastFreq: autoGain 無効（または features なし）なら入力そのもの、有効なら +6dB 分（+round(6*255/100)）の補正後
        const gained = v.autoGain && v.features;
        const last = pipeline.lastFreq;
        avzAssert.ok(last && last.length === FREQ_LENGTH, `${type}/${v.name}: lastFreq の長さ`);
        if (!gained) {
          avzAssert.ok(last === freq, `${type}/${v.name}: autoGain 無効時の lastFreq は input.freq のまま`);
        } else {
          avzAssert.ok(last !== freq, `${type}/${v.name}: autoGain 有効時は内部バッファ`);
          const expected = new Uint8Array(FREQ_LENGTH);
          applyAutoGain(freq, 6, expected);
          for (let k = 0; k < FREQ_LENGTH; k++) {
            if (last[k] !== expected[k]) avzAssert.equal(last[k], expected[k], `${type}/${v.name}: lastFreq[${k}]`);
          }
        }
      } finally {
        pipeline.dispose();
      }
    }
  }
  avzAssert.equal(rendered, 8 * variants.length * FRAMES, '描画回数');

  // ステートフルレンダラーへ渡る frame.features（null あり）
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const pipeline = new FramePipeline(canvas, canvas.getContext('2d'));
  const settings = createDefaultSettings();
  Object.assign(settings, { analyzerType: 'terrain' });
  const original = pipeline._frame;
  try {
    pipeline.render({ freq, time, getLayer: null, features, dtMs: 16.7, nowMs: 0, historyFps: 60 }, settings);
    avzAssert.ok(pipeline._frame.features === features, 'frame.features が渡されません');
    pipeline.render({ freq, time, getLayer: null, features: null, dtMs: 16.7, nowMs: 17, historyFps: 60 }, settings);
    avzAssert.equal(pipeline._frame.features, null, 'features なしでは frame.features が null');
    avzAssert.ok(original === pipeline._frame, 'frame オブジェクトは使い回される');
  } finally {
    pipeline.dispose();
  }
});
