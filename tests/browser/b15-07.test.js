// @page harness
// 目的 — 白背景の粒子・フロー・波紋描画と黒背景の加算合成を検証する（計画書 §7.2 B15-07）。

function b1507ThumbnailStddev(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height).data;
  const values = [];
  for (let blockY = 0; blockY < height; blockY += 10) {
    for (let blockX = 0; blockX < width; blockX += 10) {
      const blockWidth = Math.min(10, width - blockX);
      const blockHeight = Math.min(10, height - blockY);
      const sums = [0, 0, 0];
      for (let y = blockY; y < blockY + blockHeight; y++) {
        for (let x = blockX; x < blockX + blockWidth; x++) {
          const offset = (y * width + x) * 4;
          sums[0] += image[offset];
          sums[1] += image[offset + 1];
          sums[2] += image[offset + 2];
        }
      }
      const count = blockWidth * blockHeight;
      values.push(
        Math.floor(sums[0] / count),
        Math.floor(sums[1] / count),
        Math.floor(sums[2] / count),
      );
    }
  }

  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / values.length;
  let squared = 0;
  for (const value of values) squared += (value - mean) ** 2;
  return Math.sqrt(squared / values.length);
}

function b1507InstallCompositeRecorder(ctx) {
  const prototype = Object.getPrototypeOf(ctx);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'globalCompositeOperation');
  if (!descriptor || !descriptor.get || !descriptor.set) {
    throw new Error('CanvasRenderingContext2D.globalCompositeOperation の記録に必要な descriptor がありません');
  }
  const operations = [];
  Object.defineProperty(ctx, 'globalCompositeOperation', {
    configurable: true,
    enumerable: true,
    get() { return descriptor.get.call(this); },
    set(value) {
      operations.push(value);
      descriptor.set.call(this, value);
    },
  });
  return {
    operations,
    restore() { delete ctx.globalCompositeOperation; },
  };
}

function b1507MakeAudioEngine() {
  const freq = new Uint8Array(638);
  const time = new Uint8Array(2048);
  let frameIndex = 0;
  return {
    setFrameIndex(index) { frameIndex = index; },
    captureFrame() { synthFrame(frameIndex, 638, 2048, freq, time); },
    freqSliceLength() { return 638; },
    getFreqSlice() { return freq; },
    getTimeDomainData() { return time; },
    getFeatures() { return null; },   // T16-07: VisualizerCore が features を取得するため（スタブにも用意）
    getLayerData(index, count) {
      const start = Math.floor(index * freq.length / count);
      const end = Math.floor((index + 1) * freq.length / count);
      return freq.subarray(start, end);
    },
  };
}

function b1507DrawFrames(type, bgColor) {
  const width = 320;
  const height = 180;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const recorder = b1507InstallCompositeRecorder(ctx);
  const audioEngine = b1507MakeAudioEngine();
  const visualizer = new VisualizerCore(canvas, audioEngine);
  visualizer.settings.analyzerType = type;
  visualizer.settings.bgColor = bgColor;
  visualizer.settings.afterimageIntensity = 0;
  visualizer.settings.expressionMethod = 'dot';
  visualizer.settings.layerCount = 1;
  visualizer.settings.particleAmount = 100;
  visualizer._fillBackground();

  const previousRaf = window.requestAnimationFrame;
  const previousPerformanceNow = Object.getOwnPropertyDescriptor(performance, 'now');
  let frameIndex = 0;
  window.requestAnimationFrame = function () {};
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: function () { return frameIndex * 16.7; },
  });
  visualizer._lastFrameMs = -16.7;
  visualizer.running = true;
  try {
    for (frameIndex = 0; frameIndex < 60; frameIndex++) {
      audioEngine.setFrameIndex(frameIndex);
      visualizer._loop();
    }
    return {
      stddev: b1507ThumbnailStddev(ctx, width, height),
      operations: recorder.operations.slice(),
    };
  } finally {
    visualizer.running = false;
    window.requestAnimationFrame = previousRaf;
    if (previousPerformanceNow) {
      Object.defineProperty(performance, 'now', previousPerformanceNow);
    } else {
      delete performance.now;
    }
    recorder.restore();
  }
}

function b1507AssertBlendSelection(result, expected) {
  const blendOperations = result.operations.filter((operation) =>
    operation === 'lighter' || operation === 'multiply'
  );
  avzAssert.ok(blendOperations.length > 0, '対象レンダラーの合成モード設定が記録されていません');
  avzAssert.ok(
    blendOperations.every((operation) => operation === expected),
    `合成モードが ${expected} 以外になっています: ${blendOperations.join(', ')}`,
  );
}

avzTest('B15-07', 'B15-07 白背景で particles・flow・ripple が可視で黒背景は lighter', async function () {
  for (const type of ['particles', 'flow', 'ripple']) {
    const white = b1507DrawFrames(type, '#fff');
    avzAssert.ok(
      white.stddev > 0.1,
      `${type} の白背景フレーム59が非空ではありません (stddev: ${white.stddev})`,
    );
    b1507AssertBlendSelection(white, 'multiply');

    const black = b1507DrawFrames(type, '#000');
    b1507AssertBlendSelection(black, 'lighter');
  }
});
