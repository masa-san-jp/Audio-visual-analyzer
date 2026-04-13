// 棒グラフ型ビジュアライザー
// 0dB 基準: 長方形の底辺
function renderBars(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity, barWidth } = settings;
  const len = dataArray.length;
  const gap = 1;
  const step = barWidth + gap;
  const barCount = Math.floor(canvas.width / step);

  for (let i = 0; i < barCount; i++) {
    const idx = Math.floor(i * len / barCount);
    const raw = dataArray[idx] / 255;
    const val = Math.min(1, raw * sensitivity);
    const barHeight = Math.round(val * canvas.height);

    if (barHeight < 1) continue;

    const h = Math.round((hue + val * hueRange) % 360);
    const s = saturation;
    // 静かなバーは暗く、大きいバーほど明るくなる
    const l = Math.round(brightness * 0.3 + val * brightness * 0.7);

    ctx.fillStyle = `hsl(${h},${s}%,${l}%)`;
    ctx.fillRect(i * step, canvas.height - barHeight, barWidth, barHeight);
  }
}
