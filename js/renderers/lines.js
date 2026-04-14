// 棒グラフ型 - 波形線表現
// barDisplayMode: 'normal' | 'mirror-vertical' | 'mirror-horizontal'
// density: 30~100, baseOffset: 0~99
function renderLines(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity,
          barWidth, barDisplayMode, density, baseOffset } = settings;
  const len = dataArray.length;
  const maxSamples = Math.min(len, canvas.width);
  const sampleCount = Math.max(8, Math.floor(maxSamples * density / 100));
  const offsetRatio = baseOffset / 99;

  ctx.lineWidth = Math.max(1, barWidth * 0.8);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 平均値で色を決定
  const avgVal = _linesAvgVal(dataArray, sensitivity);
  const h = Math.round((hue + avgVal * hueRange) % 360);
  const l = Math.round(brightness * 0.3 + avgVal * brightness * 0.7);
  ctx.strokeStyle = `hsl(${h},${saturation}%,${l}%)`;

  if (barDisplayMode === 'mirror-horizontal') {
    const centerX = canvas.width / 2;
    const halfSamples = Math.max(4, Math.floor(sampleCount / 2));
    const baseY = canvas.height - (offsetRatio * canvas.height * 0.5);
    const availHeight = canvas.height * (1 - offsetRatio * 0.5);

    // 右側
    ctx.beginPath();
    for (let i = 0; i < halfSamples; i++) {
      const idx = Math.floor(i * len / halfSamples);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      const x = centerX + (i / (halfSamples - 1)) * (canvas.width / 2);
      const y = baseY - val * availHeight;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 左側（ミラー）
    ctx.beginPath();
    for (let i = 0; i < halfSamples; i++) {
      const idx = Math.floor(i * len / halfSamples);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      const x = centerX - (i / (halfSamples - 1)) * (canvas.width / 2);
      const y = baseY - val * availHeight;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

  } else if (barDisplayMode === 'mirror-vertical') {
    const centerY = canvas.height / 2;

    // 上半分
    ctx.beginPath();
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.floor(i * len / sampleCount);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      const x = (i / (sampleCount - 1)) * canvas.width;
      const y = centerY - val * (canvas.height * 0.5);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 下半分（ミラー）
    ctx.beginPath();
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.floor(i * len / sampleCount);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      const x = (i / (sampleCount - 1)) * canvas.width;
      const y = centerY + val * (canvas.height * 0.5);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

  } else {
    // 通常
    const baseY = canvas.height - (offsetRatio * canvas.height * 0.5);
    const availHeight = canvas.height * (1 - offsetRatio * 0.5);

    ctx.beginPath();
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.floor(i * len / sampleCount);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      const x = (i / (sampleCount - 1)) * canvas.width;
      const y = baseY - val * availHeight;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function _linesAvgVal(dataArray, sensitivity) {
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
  return Math.min(1, (sum / (dataArray.length * 255)) * sensitivity);
}
