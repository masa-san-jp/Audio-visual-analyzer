// ミラー対称型ビジュアライザー（左右対称）
// zeroDbMode: 'bottom' = 底辺から上 / 'center' = 中央から上下
function renderMirror(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity, barWidth, zeroDbMode } = settings;
  const len = dataArray.length;
  const gap = 1;
  const step = barWidth + gap;
  // 中央から左右に展開するため片側のバー数を計算
  const halfCount = Math.floor(canvas.width / 2 / step);
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  for (let i = 0; i < halfCount; i++) {
    const idx = Math.floor(i * len / halfCount);
    const raw = dataArray[idx] / 255;
    const val = Math.min(1, raw * sensitivity);
    const barHeight = Math.round(val * canvas.height * (zeroDbMode === 'center' ? 0.5 : 1));

    if (barHeight < 1) continue;

    const h = Math.round((hue + val * hueRange) % 360);
    const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
    ctx.fillStyle = `hsl(${h},${saturation}%,${l}%)`;

    // 右側
    const xRight = centerX + i * step;
    // 左側（ミラー）
    const xLeft = centerX - (i + 1) * step;

    if (zeroDbMode === 'center') {
      ctx.fillRect(xRight, centerY - barHeight, barWidth, barHeight * 2);
      ctx.fillRect(xLeft,  centerY - barHeight, barWidth, barHeight * 2);
    } else {
      ctx.fillRect(xRight, canvas.height - barHeight, barWidth, barHeight);
      ctx.fillRect(xLeft,  canvas.height - barHeight, barWidth, barHeight);
    }
  }
}
