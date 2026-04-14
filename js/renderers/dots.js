// 点型ビジュアライザー
// zeroDbMode: 'bottom' = 底辺基準 / 'center' = 中央基準（上下対称）
function renderDots(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity, barWidth, zeroDbMode } = settings;
  const len = dataArray.length;
  const dotSize = Math.max(1, barWidth);
  const step = dotSize + 1;
  const dotCount = Math.floor(canvas.width / step);
  const center = canvas.height / 2;

  for (let i = 0; i < dotCount; i++) {
    const idx = Math.floor(i * len / dotCount);
    const raw = dataArray[idx] / 255;
    const val = Math.min(1, raw * sensitivity);

    if (val < 0.01) continue;

    const x = i * step;
    const h = Math.round((hue + val * hueRange) % 360);
    const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
    ctx.fillStyle = `hsl(${h},${saturation}%,${l}%)`;

    if (zeroDbMode === 'center') {
      const offset = val * center;
      ctx.fillRect(x, center - offset - dotSize / 2, dotSize, dotSize);
      ctx.fillRect(x, center + offset - dotSize / 2, dotSize, dotSize);
    } else {
      const y = canvas.height - val * canvas.height;
      ctx.fillRect(x, y - dotSize / 2, dotSize, dotSize);
    }
  }
}
