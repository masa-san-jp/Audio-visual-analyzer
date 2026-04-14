// 棒グラフ型 - 棒表現
// barDisplayMode: 'normal' | 'mirror-vertical' | 'mirror-horizontal'
// density: 30~100, baseOffset: 0~99
function renderBars(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity,
          barWidth, barDisplayMode, density, baseOffset } = settings;
  const len = dataArray.length;
  const gap = 1;
  const step = barWidth + gap;
  const maxCount = Math.floor(canvas.width / step);
  const barCount = Math.max(4, Math.floor(maxCount * density / 100));
  const drawStep = canvas.width / barCount;

  // baseOffset: 0=底辺, 99=中央付近
  const offsetRatio = baseOffset / 99;

  if (barDisplayMode === 'mirror-horizontal') {
    // 左右対称
    const centerX = canvas.width / 2;
    const halfCount = Math.max(2, Math.floor(barCount / 2));
    const halfStep = (canvas.width / 2) / halfCount;

    for (let i = 0; i < halfCount; i++) {
      const idx = Math.floor(i * len / halfCount);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      const availHeight = canvas.height * (1 - offsetRatio * 0.5);
      const barHeight = Math.round(val * availHeight);
      if (barHeight < 1) continue;

      const h = Math.round((hue + val * hueRange) % 360);
      const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
      ctx.fillStyle = `hsl(${h},${saturation}%,${l}%)`;

      const baseY = canvas.height - (offsetRatio * canvas.height * 0.5);
      const xRight = centerX + i * halfStep;
      const xLeft = centerX - (i + 1) * halfStep;
      ctx.fillRect(xRight, baseY - barHeight, barWidth, barHeight);
      ctx.fillRect(xLeft, baseY - barHeight, barWidth, barHeight);
    }
  } else if (barDisplayMode === 'mirror-vertical') {
    // 上下対称: 中心線は常にcanvasの垂直中央
    const centerY = Math.floor(canvas.height / 2);
    const halfHeight = centerY;
    for (let i = 0; i < barCount; i++) {
      const idx = Math.floor(i * len / barCount);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      const barHeight = Math.round(val * halfHeight);
      if (barHeight < 1) continue;

      const h = Math.round((hue + val * hueRange) % 360);
      const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
      ctx.fillStyle = `hsl(${h},${saturation}%,${l}%)`;

      const x = i * drawStep;
      ctx.fillRect(x, centerY - barHeight, barWidth, barHeight * 2);
    }
  } else {
    // 通常
    for (let i = 0; i < barCount; i++) {
      const idx = Math.floor(i * len / barCount);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      const availHeight = canvas.height * (1 - offsetRatio * 0.5);
      const barHeight = Math.round(val * availHeight);
      if (barHeight < 1) continue;

      const h = Math.round((hue + val * hueRange) % 360);
      const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
      ctx.fillStyle = `hsl(${h},${saturation}%,${l}%)`;

      const baseY = canvas.height - (offsetRatio * canvas.height * 0.5);
      ctx.fillRect(i * drawStep, baseY - barHeight, barWidth, barHeight);
    }
  }
}
