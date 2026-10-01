// 目的 — 現行 VisualizerCore の描画を66ケースで固定し、ゴールデンと比較する（計画書 §3.6）。
// @page harness

(function (global) {
  'use strict';

  var FREQ_LENGTH = 638;
  var TIME_LENGTH = 2048;
  var FRAME_COUNT = 60;
  var SAMPLE_FRAMES = [19, 39, 59];
  var THUMB_BLOCK = 10;
  var NON_EMPTY_MIN_STDDEV = 0.1; // 計画書 §3.6.3（2026-09-30 オーナー決定で 1.0 → 0.1）
  var goldenCases = createGoldenCases();

  function base64FromBytes(bytes) {
    var parts = [];
    var chunkSize = 0x8000;
    for (var i = 0; i < bytes.length; i += chunkSize) {
      var end = Math.min(i + chunkSize, bytes.length);
      var part = '';
      for (var j = i; j < end; j += 1) part += String.fromCharCode(bytes[j]);
      parts.push(part);
    }
    return global.btoa(parts.join(''));
  }

  function bytesFromBase64(value) {
    var decoded = global.atob(value);
    var bytes = new Uint8Array(decoded.length);
    for (var i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
    return bytes;
  }

  function takeThumbnail(imageData, width, height) {
    var thumbWidth = width / THUMB_BLOCK;
    var thumbHeight = height / THUMB_BLOCK;
    var thumbnail = new Uint8Array(thumbWidth * thumbHeight * 3);
    var outputIndex = 0;
    for (var blockY = 0; blockY < thumbHeight; blockY += 1) {
      for (var blockX = 0; blockX < thumbWidth; blockX += 1) {
        var sumR = 0;
        var sumG = 0;
        var sumB = 0;
        for (var y = 0; y < THUMB_BLOCK; y += 1) {
          for (var x = 0; x < THUMB_BLOCK; x += 1) {
            var pixel = ((blockY * THUMB_BLOCK + y) * width + blockX * THUMB_BLOCK + x) * 4;
            sumR += imageData.data[pixel];
            sumG += imageData.data[pixel + 1];
            sumB += imageData.data[pixel + 2];
          }
        }
        thumbnail[outputIndex++] = Math.floor(sumR / 100);
        thumbnail[outputIndex++] = Math.floor(sumG / 100);
        thumbnail[outputIndex++] = Math.floor(sumB / 100);
      }
    }
    return { width: thumbWidth, height: thumbHeight, rgb: thumbnail };
  }

  function compareThumbnail(actual, expected) {
    if (!expected || expected.length !== actual.length) {
      return { mean: Infinity, max: Infinity };
    }
    var sum = 0;
    var max = 0;
    for (var i = 0; i < actual.length; i += 1) {
      var difference = Math.abs(actual[i] - expected[i]);
      sum += difference;
      if (difference > max) max = difference;
    }
    return { mean: sum / actual.length, max: max };
  }

  function standardDeviation(bytes) {
    var sum = 0;
    for (var i = 0; i < bytes.length; i += 1) sum += bytes[i];
    var mean = sum / bytes.length;
    var variance = 0;
    for (var j = 0; j < bytes.length; j += 1) {
      var delta = bytes[j] - mean;
      variance += delta * delta;
    }
    return Math.sqrt(variance / bytes.length);
  }

  function createTestAudioEngine(frameIndex) {
    var freq = new Uint8Array(FREQ_LENGTH);
    var time = new Uint8Array(TIME_LENGTH);
    return {
      captureFrame: function () {
        synthFrame(frameIndex.value, FREQ_LENGTH, TIME_LENGTH, freq, time);
      },
      getFreqSlice: function () { return freq; },
      freqSliceLength: function () { return FREQ_LENGTH; },
      getTimeDomainData: function () { return time; },
      getLayerData: function (layerIndex, layerCount) {
        var start = Math.floor(layerIndex * FREQ_LENGTH / layerCount);
        var end = Math.floor((layerIndex + 1) * FREQ_LENGTH / layerCount);
        return freq.subarray(start, end);
      },
    };
  }

  // T15-06 では、この関数だけを FramePipeline ドライバへ差し替える。
  function drawCaseWithVisualizerCore(goldenCase, clock) {
    var canvas = document.createElement('canvas');
    canvas.width = goldenCase.width;
    canvas.height = goldenCase.height;
    var frameIndex = { value: 0 };
    var core = new VisualizerCore(canvas, createTestAudioEngine(frameIndex));
    core.settings = goldenCase.settings;
    core._fillBackground();
    core._lastFrameMs = -16.7;
    core.running = true;
    var samples = {};
    for (var i = 0; i < FRAME_COUNT; i += 1) {
      clock.frame = i;
      frameIndex.value = i;
      core._loop();
      if (SAMPLE_FRAMES.indexOf(i) !== -1) {
        var imageData = core.ctx.getImageData(0, 0, canvas.width, canvas.height);
        var thumbnail = takeThumbnail(imageData, canvas.width, canvas.height);
        samples[i] = {
          thumbnail: thumbnail,
          fullRgba: imageData.data,
        };
      }
    }
    return { samples: samples, width: canvas.width, height: canvas.height };
  }

  function diffArtifact(goldenCase, frame, rendered, expected) {
    var sample = rendered.samples[frame];
    return {
      caseId: goldenCase.id,
      frame: frame,
      thumbWidth: sample.thumbnail.width,
      thumbHeight: sample.thumbnail.height,
      expectedThumb: expected || '',
      actualThumb: base64FromBytes(sample.thumbnail.rgb),
      fullWidth: rendered.width,
      fullHeight: rendered.height,
      fullActual: base64FromBytes(sample.fullRgba),
    };
  }

  function verifyCase(goldenCase, rendered, expectedFrames, diffs) {
    var failures = [];
    var expected = expectedFrames && expectedFrames[goldenCase.id];
    if (!expected || expected.length !== SAMPLE_FRAMES.length) {
      failures.push(`${goldenCase.id}: ゴールデン基準値がありません`);
      return failures;
    }
    for (var index = 0; index < SAMPLE_FRAMES.length; index += 1) {
      var frame = SAMPLE_FRAMES[index];
      var expectedBase64 = expected[index];
      var expectedBytes = bytesFromBase64(expectedBase64);
      var actual = rendered.samples[frame].thumbnail.rgb;
      var comparison = compareThumbnail(actual, expectedBytes);
      if (comparison.mean > 2 || comparison.max > 40) {
        failures.push(`${goldenCase.id} frame ${frame}: mean=${comparison.mean.toFixed(3)}, max=${comparison.max}`);
        diffs.push(diffArtifact(goldenCase, frame, rendered, expectedBase64));
      }
      if ((frame === 39 || frame === 59) && standardDeviation(actual) <= NON_EMPTY_MIN_STDDEV) {
        failures.push(`${goldenCase.id} frame ${frame}: 標準偏差が${NON_EMPTY_MIN_STDDEV}以下です`);
      }
    }
    return failures;
  }

  function collectGoldenFrames(renderedCases) {
    var frames = {};
    for (var i = 0; i < goldenCases.length; i += 1) {
      var goldenCase = goldenCases[i];
      var rendered = renderedCases[goldenCase.id];
      frames[goldenCase.id] = SAMPLE_FRAMES.map(function (frame) {
        return base64FromBytes(rendered.samples[frame].thumbnail.rgb);
      });
    }
    return frames;
  }

  avzTest('B15-04', 'ゴールデン全66ケースが現行描画と一致する', async function () {
    var renderedCases = {};
    var allFailures = [];
    var diffs = [];
    var originalRequestAnimationFrame = global.requestAnimationFrame;
    var originalPerformanceNow = global.performance.now;
    var clock = { frame: 0 };
    global.requestAnimationFrame = function () {};
    Object.defineProperty(global.performance, 'now', {
      configurable: true,
      value: function () { return clock.frame * 16.7; },
    });
    try {
      for (var i = 0; i < goldenCases.length; i += 1) {
        clock.frame = 0;
        var rendered = drawCaseWithVisualizerCore(goldenCases[i], clock);
        renderedCases[goldenCases[i].id] = rendered;
        if (!global.__avzUpdateGolden) {
          allFailures.push.apply(allFailures, verifyCase(
            goldenCases[i], rendered, global.__avzGoldenExpectedFrames, diffs));
        }
      }
      global.__avzGoldenFrames = collectGoldenFrames(renderedCases);
      global.__avzGoldenDiffs = diffs;
    } finally {
      global.requestAnimationFrame = originalRequestAnimationFrame;
      Object.defineProperty(global.performance, 'now', {
        configurable: true,
        value: originalPerformanceNow,
      });
    }
    if (allFailures.length) throw new Error(allFailures.slice(0, 12).join('; '));
  }, { timeoutMs: 120000 });
})(window);
