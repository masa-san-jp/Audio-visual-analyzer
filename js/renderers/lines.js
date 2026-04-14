// 波形線型ビジュアライザー
// zeroDbMode: 'bottom' = 底辺から上に描画 / 'center' = 中央から上下に対称描画
function renderLines(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity, barWidth, zeroDbMode } = settings;
  const len = dataArray.length;
  const sampleCount = Math.min(len, canvas.width);
  const center = canvas.height / 2;

  // 線の太さに barWidth を流用
  ctx.lineWidth = Math.max(1, barWidth * 0.5);
  ctx.lineJoin = 'round';

  if (zeroDbMode === 'center') {
    // 上下対称: 上半分と下半分を別パスで描く
    const drawPath = (sign) => {
      ctx.beginPath();
      for (let i = 0; i < sampleCount; i++) {
        const idx = Math.floor(i * len / sampleCount);
        const raw = dataArray[idx] / 255;
        const val = Math.min(1, raw * sensitivity);
        const x = (i / (sampleCount - 1)) * canvas.width;
        const y = center + sign * val * center;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);

        // 線色は中央値で決める
        if (i === Math.floor(sampleCount / 2)) {
          const h = Math.round((hue + val * hueRange) % 360);
          const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
          ctx.strokeStyle = `hsl(${h},${saturation}%,${l}%)`;
        }
      }
      ctx.stroke();
    };
    drawPath(-1);
    drawPath(1);
  } else {
    // 底辺基準: グラデーション付き単一パス
    ctx.beginPath();
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.floor(i * len / sampleCount);
      const raw = dataArray[idx] / 255;
      const val = Math.min(1, raw * sensitivity);
      const x = (i / (sampleCount - 1)) * canvas.width;
      const y = canvas.height - val * canvas.height;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    // 全体の色は平均値で設定
    const avgVal = Array.from(dataArray).reduce((s, v) => s + v, 0) / (dataArray.length * 255);
    const val = Math.min(1, avgVal * sensitivity);
    const h = Math.round((hue + val * hueRange) % 360);
    const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
    ctx.strokeStyle = `hsl(${h},${saturation}%,${l}%)`;
    ctx.stroke();
  }
}
