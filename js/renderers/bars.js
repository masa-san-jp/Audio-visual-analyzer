// 棒グラフ型ビジュアライザー
// zeroDbMode: 'bottom' = 底辺基準 / 'center' = 中央基準（上下対称）
function renderBars(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity, barWidth, zeroDbMode } = settings;
  const len = dataArray.length;
  const gap = 1;
  const step = barWidth + gap;
  const barCount = Math.floor(canvas.width / step);
  const center = Math.round(canvas.height / 2);

  for (let i = 0; i < barCount; i++) {
    const idx = Math.floor(i * len / barCount);
    const raw = dataArray[idx] / 255;
    const val = Math.min(1, raw * sensitivity);
    const barHeight = Math.round(val * canvas.height * (zeroDbMode === 'center' ? 0.5 : 1));

    if (barHeight < 1) continue;

    const h = Math.round((hue + val * hueRange) % 360);
    const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
    ctx.fillStyle = `hsl(${h},${saturation}%,${l}%)`;

    if (zeroDbMode === 'center') {
      ctx.fillRect(i * step, center - barHeight, barWidth, barHeight * 2);
    } else {
      ctx.fillRect(i * step, canvas.height - barHeight, barWidth, barHeight);
    }
  }
}
