// 円形放射型ビジュアライザー（常に中心基準）
// barWidth を棒の幅として使用
function renderRadial(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity, barWidth } = settings;
  const len = dataArray.length;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const maxR = Math.min(cx, cy) * 0.95;
  const baseR = maxR * 0.25;
  const gap = 0.5;
  const step = barWidth + gap;
  const barCount = Math.floor((Math.PI * 2 * baseR) / step);
  const angleStep = (Math.PI * 2) / barCount;

  for (let i = 0; i < barCount; i++) {
    const idx = Math.floor(i * len / barCount);
    const raw = dataArray[idx] / 255;
    const val = Math.min(1, raw * sensitivity);
    const barLen = val * (maxR - baseR);

    if (barLen < 1) continue;

    const angle = i * angleStep - Math.PI / 2;
    const x1 = cx + Math.cos(angle) * baseR;
    const y1 = cy + Math.sin(angle) * baseR;
    const x2 = cx + Math.cos(angle) * (baseR + barLen);
    const y2 = cy + Math.sin(angle) * (baseR + barLen);

    const h = Math.round((hue + val * hueRange) % 360);
    const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
    ctx.strokeStyle = `hsl(${h},${saturation}%,${l}%)`;
    ctx.lineWidth = barWidth;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}
