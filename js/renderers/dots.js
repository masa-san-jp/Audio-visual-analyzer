// 棒グラフ型 - 点表現
// barDisplayMode: 'normal' | 'mirror-vertical' | 'mirror-horizontal'
// density: 30~100, baseOffset: 0~99
function renderDots(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity,
          barWidth, barDisplayMode, density, baseOffset } = settings;
  const len = dataArray.length;
  const dotSize = Math.max(1, barWidth);
  const step = dotSize + 1;
  const maxCount = Math.floor(canvas.width / step);
  const dotCount = Math.max(4, Math.floor(maxCount * density / 100));
  const drawStep = canvas.width / dotCount;
  const offsetRatio = baseOffset / 99;

  if (barDisplayMode === 'mirror-horizontal') {
    const centerX = canvas.width / 2;
    const halfCount = Math.max(2, Math.floor(dotCount / 2));
    const halfStep = (canvas.width / 2) / halfCount;
    const baseY = canvas.height - (offsetRatio * canvas.height * 0.5);
    const availHeight = canvas.height * (1 - offsetRatio * 0.5);

    for (let i = 0; i < halfCount; i++) {
      const idx = Math.floor(i * len / halfCount);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      if (val < 0.01) continue;

      const h = Math.round((hue + val * hueRange) % 360);
      const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
      ctx.fillStyle = `hsl(${h},${saturation}%,${l}%)`;

      const yPos = baseY - val * availHeight;
      const xRight = centerX + i * halfStep;
      const xLeft = centerX - (i + 1) * halfStep;
      ctx.fillRect(xRight, yPos - dotSize / 2, dotSize, dotSize);
      ctx.fillRect(xLeft, yPos - dotSize / 2, dotSize, dotSize);
    }

  } else if (barDisplayMode === 'mirror-vertical') {
    const centerY = canvas.height / 2;

    for (let i = 0; i < dotCount; i++) {
      const idx = Math.floor(i * len / dotCount);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      if (val < 0.01) continue;

      const h = Math.round((hue + val * hueRange) % 360);
      const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
      ctx.fillStyle = `hsl(${h},${saturation}%,${l}%)`;

      const offset = val * centerY;
      const x = i * drawStep;
      ctx.fillRect(x, centerY - offset - dotSize / 2, dotSize, dotSize);
      ctx.fillRect(x, centerY + offset - dotSize / 2, dotSize, dotSize);
    }

  } else {
    // 通常
    const baseY = canvas.height - (offsetRatio * canvas.height * 0.5);
    const availHeight = canvas.height * (1 - offsetRatio * 0.5);

    for (let i = 0; i < dotCount; i++) {
      const idx = Math.floor(i * len / dotCount);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      if (val < 0.01) continue;

      const h = Math.round((hue + val * hueRange) % 360);
      const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
      ctx.fillStyle = `hsl(${h},${saturation}%,${l}%)`;

      const y = baseY - val * availHeight;
      ctx.fillRect(i * drawStep, y - dotSize / 2, dotSize, dotSize);
    }
  }
}
