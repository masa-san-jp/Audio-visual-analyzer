// T8 波紋 — doc/spec-phase6.md §6.8
// ビート（およびレイヤー時の帯域ローカルピーク）で中心/各点から
// 同心円の波が広がり、指数減衰しながら干渉する表現。
// ステートフルレンダラー（背景クリアはコアが担当。selfClear ではない）。

class RippleRenderer {
  constructor(canvas) {
    // ── 波プール（固定長・上限32）を事前確保。毎フレームの新規生成を避ける ──
    this.MAX_WAVES = 32;
    this.waves = new Array(this.MAX_WAVES);
    for (let i = 0; i < this.MAX_WAVES; i++) {
      // active=false のスロットは未使用。x,y は発生点、r 半径、amp 振幅(=透明度)
      // hue 色相、colorAmp 誕生時振幅（色の明度/色相を安定させるため保持）
      this.waves[i] = { x: 0, y: 0, r: 0, amp: 0, active: false, hue: 0, colorAmp: 0 };
    }

    // ── 帯域ローカルピーク検出用: 前フレームのレイヤー帯域振幅（最大4レイヤー）──
    this.prevBand = new Float32Array(4);
    this.prevBandValid = false;

    // 単層時の全体エネルギー追従用（立ち上がり検出）
    this.prevEnergy = 0;
    this.energyEma = 0;
    this._emaInit = false;
  }

  onResize() {
    // レイアウトはフレームごとに canvas から算出するため、ここでの再計算は不要。
    // リサイズ時に既存の波を残しても破綻しないのでプールは維持する。
  }

  // 空きスロットを返す。満杯なら最も弱い（amp最小の）波を再利用して
  // 常に MAX_WAVES を超えないようにする。
  _acquire() {
    let minIdx = 0;
    let minAmp = Infinity;
    for (let i = 0; i < this.MAX_WAVES; i++) {
      const w = this.waves[i];
      if (!w.active) return w;
      if (w.amp < minAmp) { minAmp = w.amp; minIdx = i; }
    }
    return this.waves[minIdx];
  }

  // 波を1本生成（発生点 x,y / 色相 hue / 振幅 amp）
  _spawn(x, y, hue, amp) {
    const w = this._acquire();
    w.x = x;
    w.y = y;
    w.r = 0;
    w.amp = clamp(amp, 0, 1);
    w.colorAmp = w.amp;
    w.hue = hue;
    w.active = true;
  }

  render(ctx, canvas, frame, settings) {
    const W = canvas.width;
    const H = canvas.height;
    // ── ガード: キャンバス0サイズ ──
    if (!W || !H) return;

    const cx = W / 2;
    const cy = H / 2;

    // ── 実時間基準の経過ms（欠損・異常値をガード）──
    let dt = frame && frame.dtMs != null ? frame.dtMs : 16.7;
    dt = clamp(dt, 0, 100);

    const motion = settings.motionSpeed != null ? settings.motionSpeed : 1.0;
    // 波の伝播速度: 画面最大辺を約1.6秒で横断する速度に motionSpeed を掛ける(px/ms)
    const maxDim = Math.max(W, H);
    const speed = (maxDim / 1600) * motion;
    // 振幅の指数減衰係数(1/ms)。amp が 1→0.02 になるまで約2.2秒。
    const decay = Math.exp(-0.0018 * dt);

    const beat = frame ? frame.beat : null;
    const layerCount = clamp(settings.layerCount || 1, 1, 4);
    const layersOn = layerCount >= 2;
    const baseSens = settings.sensitivity != null ? settings.sensitivity : 1.0;
    const layerDefs = settings.layers || [];

    // ── 全体エネルギー（freq 全帯域平均）を算出。単層のサウンド追従に使う ──
    let energyNow = 0;
    if (frame && frame.freq && frame.freq.length > 0) {
      const f = frame.freq;
      let sum = 0;
      for (let b = 0; b < f.length; b++) sum += f[b];
      energyNow = clamp((sum / f.length) / 255 * baseSens, 0, 1);
    }
    if (!this._emaInit) { this.energyEma = energyNow; this._emaInit = true; }

    // ── 発生: ビート ──
    if (beat && beat.isBeat) {
      const energy = clamp(beat.energy != null ? beat.energy : 0, 0, 1);
      if (layersOn) {
        for (let i = 0; i < layerCount; i++) {
          const px = W * (i + 1) / (layerCount + 1);
          const off = layerDefs[i] ? layerDefs[i].hueOffset : 0;
          this._spawn(px, cy, settings.hue + off, Math.max(0.4, energy));
        }
      } else {
        this._spawn(cx, cy, settings.hue, Math.max(0.4, energy));
      }
    }

    // ── 発生: 単層の全体エネルギー立ち上がり（ビートが無い曲でも追従させる）──
    // 現在値が移動平均を一定比率超え、かつ前フレームより増加していれば波を出す。
    if (!layersOn) {
      if (energyNow > this.energyEma * 1.18 && energyNow > this.prevEnergy && energyNow > 0.06) {
        this._spawn(cx, cy, settings.hue, clamp(energyNow * 1.2, 0.25, 1));
      }
      this.energyEma = this.energyEma * 0.9 + energyNow * 0.1;
      this.prevEnergy = energyNow;
    }

    // ── 発生: レイヤー帯域のローカルピーク（前フレーム比 +30%）──
    // freq が null/空のときは帯域解析をスキップ（既存の波の更新は続行）
    const freqOk = frame && frame.freq && frame.freq.length > 0 &&
                   typeof frame.getLayer === 'function';
    if (layersOn && freqOk) {
      for (let i = 0; i < layerCount; i++) {
        const band = frame.getLayer(i, layerCount);
        if (!band || band.length === 0) continue;
        // 帯域平均振幅
        let sum = 0;
        for (let b = 0; b < band.length; b++) sum += band[b];
        const avg = sum / band.length; // 0..255
        const sens = baseSens * (layerDefs[i] ? layerDefs[i].sensitivity : 1.0);
        const amp01 = clamp((avg / 255) * sens, 0, 1);

        const prev = this.prevBand[i];
        // 前フレーム比 +30% かつ一定以上の強さでピーク発生
        if (this.prevBandValid && avg > prev * 1.3 && amp01 > 0.08) {
          const px = W * (i + 1) / (layerCount + 1);
          const off = layerDefs[i] ? layerDefs[i].hueOffset : 0;
          this._spawn(px, cy, settings.hue + off, amp01);
        }
        this.prevBand[i] = avg;
      }
      this.prevBandValid = true;
    } else if (!layersOn) {
      // 単層時はピーク検出を使わないので前値を無効化
      this.prevBandValid = false;
    }

    // ── 更新 + 描画 ──
    // 線幅は波の強さ（誕生時振幅）に比例させ、強い音ほど太い波にする。
    const baseW = Math.max(1, settings.barWidth || 2);
    ctx.lineCap = 'round';
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter'; // 干渉部が明るく重なる
    for (let i = 0; i < this.MAX_WAVES; i++) {
      const w = this.waves[i];
      if (!w.active) continue;

      // 半径拡大・振幅減衰
      w.r += speed * dt;
      w.amp *= decay;

      // 破棄
      if (w.amp < 0.02) { w.active = false; continue; }
      if (w.r < 0.5) continue;

      const alpha = clamp(w.amp * 1.2, 0, 1);
      ctx.lineWidth = baseW * (0.6 + w.colorAmp * 2.4);
      ctx.strokeStyle = makeColor(w.hue, clamp(0.4 + w.colorAmp, 0, 1), settings, alpha);
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = prevOp;
  }

  dispose() {
    // 保持リソースなし。プール参照はGC任せ。
  }
}
