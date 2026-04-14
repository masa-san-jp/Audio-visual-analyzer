// 円形放射型ビジュアライザー（全表現方法対応）
// radialTilt: 0|30|45|60, density: 30~100, baseOffset: 0~99
// expressionMethod: 'bar'|'line'|'dot'

function renderRadialBars(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity,
          barWidth, radialTilt, density, baseOffset } = settings;
  const len = dataArray.length;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const maxR = Math.min(cx, cy) * 0.95;
  // baseOffset: 0=小さい中心円, 99=大きい中心円
  const baseR = maxR * (0.1 + (baseOffset / 99) * 0.6);
  const tiltRad = (radialTilt * Math.PI) / 180;

  const gap = 0.5;
  const step = barWidth + gap;
  const maxCount = Math.floor((Math.PI * 2 * baseR) / step);
  const barCount = Math.max(8, Math.floor(maxCount * density / 100));
  const angleStep = (Math.PI * 2) / barCount;

  ctx.lineCap = 'round';
  ctx.lineWidth = barWidth;

  for (let i = 0; i < barCount; i++) {
    const idx = Math.floor(i * len / barCount);
    const raw = dataArray[idx] / 255;
    const val = Math.min(1, raw * sensitivity);
    const barLen = val * (maxR - baseR);
    if (barLen < 1) continue;

    const angle = i * angleStep - Math.PI / 2 + tiltRad;
    const x1 = cx + Math.cos(angle) * baseR;
    const y1 = cy + Math.sin(angle) * baseR;
    const x2 = cx + Math.cos(angle) * (baseR + barLen);
    const y2 = cy + Math.sin(angle) * (baseR + barLen);

    const h = Math.round((hue + val * hueRange) % 360);
    const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
    ctx.strokeStyle = `hsl(${h},${saturation}%,${l}%)`;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

function renderRadialLines(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity,
          barWidth, radialTilt, density, baseOffset } = settings;
  const len = dataArray.length;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const maxR = Math.min(cx, cy) * 0.95;
  const baseR = maxR * (0.1 + (baseOffset / 99) * 0.6);
  const tiltRad = (radialTilt * Math.PI) / 180;

  const maxPoints = Math.min(len, 360);
  const pointCount = Math.max(12, Math.floor(maxPoints * density / 100));
  const angleStep = (Math.PI * 2) / pointCount;

  ctx.lineWidth = Math.max(1, barWidth * 0.8);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 平均値で色を決定
  let sum = 0;
  for (let i = 0; i < len; i++) sum += dataArray[i];
  const avgVal = Math.min(1, (sum / (len * 255)) * sensitivity);
  const h = Math.round((hue + avgVal * hueRange) % 360);
  const l = Math.round(brightness * 0.3 + avgVal * brightness * 0.7);
  ctx.strokeStyle = `hsl(${h},${saturation}%,${l}%)`;

  ctx.beginPath();
  for (let i = 0; i <= pointCount; i++) {
    const idx = Math.floor((i % pointCount) * len / pointCount);
    const raw = dataArray[idx] / 255;
    const val = Math.min(1, raw * sensitivity);
    const r = baseR + val * (maxR - baseR);
    const angle = i * angleStep - Math.PI / 2 + tiltRad;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

function renderRadialDots(ctx, canvas, dataArray, settings) {
  const { hue, hueRange, brightness, saturation, sensitivity,
          barWidth, radialTilt, density, baseOffset } = settings;
  const len = dataArray.length;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const maxR = Math.min(cx, cy) * 0.95;
  const baseR = maxR * (0.1 + (baseOffset / 99) * 0.6);
  const tiltRad = (radialTilt * Math.PI) / 180;
  const dotSize = Math.max(1, barWidth);

  const maxCount = Math.floor((Math.PI * 2 * baseR) / (dotSize + 1));
  const dotCount = Math.max(8, Math.floor(maxCount * density / 100));
  const angleStep = (Math.PI * 2) / dotCount;

  for (let i = 0; i < dotCount; i++) {
    const idx = Math.floor(i * len / dotCount);
    const raw = dataArray[idx] / 255;
    const val = Math.min(1, raw * sensitivity);
    if (val < 0.01) continue;

    const r = baseR + val * (maxR - baseR);
    const angle = i * angleStep - Math.PI / 2 + tiltRad;
    const x = cx + Math.cos(angle) * r - dotSize / 2;
    const y = cy + Math.sin(angle) * r - dotSize / 2;

    const h = Math.round((hue + val * hueRange) % 360);
    const l = Math.round(brightness * 0.3 + val * brightness * 0.7);
    ctx.fillStyle = `hsl(${h},${saturation}%,${l}%)`;
    ctx.fillRect(x, y, dotSize, dotSize);
  }
}
