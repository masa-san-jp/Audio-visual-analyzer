// 目的 — OfflineAudioContext と SpectrumAnalyzer の解析結果を回帰比較する（計画書 §7.2 B15-01）。
// @page harness

function b1501CreateAudioBuffer(context, pcm) {
  const buffer = context.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate);
  for (let channel = 0; channel < pcm.channels.length; channel++) {
    buffer.getChannelData(channel).set(pcm.channels[channel]);
  }
  return buffer;
}

avzTest('B15-01', 'B15-01 AnalyserNode と SpectrumAnalyzer の周波数データ一致', async function () {
  const sampleRate = 48000;
  const seconds = 2;
  const fftSize = 2048;
  const pcm = sigMix([
    sigNoise(sampleRate, seconds, 0.08, 7, { color: 'white' }),
    sigSine(sampleRate, seconds, 440, 0.25),
    sigSine(sampleRate, seconds, 3000, 0.20),
  ], [1, 1, 1]);
  const context = new OfflineAudioContext(2, Math.round(sampleRate * seconds), sampleRate);
  const source = context.createBufferSource();
  source.buffer = b1501CreateAudioBuffer(context, pcm);

  const analyser = context.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0.8;
  const processor = context.createScriptProcessor(fftSize, 2, 2);
  const nativeData = new Uint8Array(analyser.frequencyBinCount);
  const referenceData = new Uint8Array(analyser.frequencyBinCount);
  const reference = new SpectrumAnalyzer(
    fftSize,
    analyser.smoothingTimeConstant,
    analyser.minDecibels,
    analyser.maxDecibels,
  );
  let blockCount = 0;
  let comparedBins = 0;
  let closeBins = 0;
  let maxDifference = 0;

  processor.onaudioprocess = function (event) {
    const input = event.inputBuffer.getChannelData(0);
    if (input.length !== fftSize) return;
    analyser.getByteFrequencyData(nativeData);
    reference.analyze(input, referenceData);
    blockCount++;
    for (let bin = 0; bin < nativeData.length; bin++) {
      const difference = Math.abs(nativeData[bin] - referenceData[bin]);
      comparedBins++;
      if (difference <= 1) closeBins++;
      if (difference > maxDifference) maxDifference = difference;
    }
  };

  source.connect(analyser);
  analyser.connect(processor);
  processor.connect(context.destination);
  source.start(0);
  await context.startRendering();
  try {
    processor.disconnect();
    analyser.disconnect();
    source.disconnect();
  } catch (_) {}

  avzAssert.ok(blockCount > 0, '2048サンプル境界の比較ブロックがありません');
  avzAssert.ok(comparedBins > 0, '比較した周波数ビンがありません');
  avzAssert.ok(
    closeBins / comparedBins >= 0.99,
    `±1以内のビンが99%未満です (ratio: ${closeBins / comparedBins}, max: ${maxDifference})`,
  );
});
