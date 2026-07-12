// Phase 6 レンダラーレジストリ + ケイパビリティ — doc/spec-phase6.md §4.1 / §4.4
//
// ステートレスレンダラー（既存）: renderX(ctx, canvas, layerData, settings)
// ステートフルレンダラー（Phase 6）: クラス。以下のインターフェースを実装する。
//   constructor(canvas)
//   onResize(canvas)                         // canvas サイズ変更時
//   render(ctx, canvas, frame, settings)     // 毎フレーム描画
//   dispose()                                // 破棄時（任意）
//
// frame = {
//   freq,                 // Uint8Array: 50Hz〜15kHz 全帯域
//   getLayer(i, count),   // レイヤー帯域スライスを返す
//   time,                 // Uint8Array: 時間波形（null の場合あり）
//   history,              // FrameHistory（freq 履歴）
//   beat,                 // { isBeat, energy, sinceBeatMs }
//   dtMs,                 // 前フレームからの経過ms
//   nowMs,                // 現在時刻ms（performance.now 基準）
// }
// settings は effectiveHue 反映済みの全設定。ステートフルレンダラーは
// settings.expressionMethod / layerCount / layers を自分で解釈する。

// ステートレス選択マップ（既存 bar/radial 用）
const BAR_RENDERERS = {
  bar:  renderBars,
  line: renderLines,
  dot:  renderDots,
};
const RADIAL_RENDERERS = {
  bar:  renderRadialBars,
  line: renderRadialLines,
  dot:  renderRadialDots,
};

const RENDERER_REGISTRY = {
  // ── 基本（ステートレス） ──
  bar: {
    label: '棒グラフ', group: '基本', stateful: false,
    methods: BAR_RENDERERS,
    capabilities: { methods: ['bar', 'line', 'dot'], layers: true, barDisplayMode: true, physics: true },
  },
  radial: {
    label: '円形放射', group: '基本', stateful: false,
    methods: RADIAL_RENDERERS,
    capabilities: { methods: ['bar', 'line', 'dot'], layers: true, barDisplayMode: false, physics: true },
  },

  // ── 時間軸系（ステートフル） ──
  spectrogram: {
    label: 'スペクトログラム（滝）', group: '時間軸', stateful: true,
    create: (canvas) => new SpectrogramRenderer(canvas),
    capabilities: { methods: [], layers: false, selfClear: true, sliders: ['history'] },
  },
  terrain: {
    label: '3D地形', group: '時間軸', stateful: true,
    create: (canvas) => new TerrainRenderer(canvas),
    capabilities: { methods: ['line', 'dot'], layers: false, sliders: ['history', 'angle'], physics: true },
  },
  tunnel: {
    label: 'トンネル', group: '時間軸', stateful: true,
    create: (canvas) => new TunnelRenderer(canvas),
    capabilities: { methods: ['line', 'dot'], layers: false, sliders: ['history', 'motion'] },
  },

  // ── 擬似3D系（ステートフル） ──
  bar3d: {
    label: '擬似3Dバー', group: '擬似3D', stateful: true,
    create: (canvas) => new Bar3dRenderer(canvas),
    capabilities: { methods: [], layers: true, sliders: [] },
  },
  ring3d: {
    label: '回転3Dリング', group: '擬似3D', stateful: true,
    create: (canvas) => new Ring3dRenderer(canvas),
    capabilities: { methods: ['bar', 'line', 'dot'], layers: true, sliders: ['motion'], physics: true },
  },

  // ── 流体・粒子系（ステートフル） ──
  particles: {
    label: 'パーティクル放出', group: '流体・粒子', stateful: true,
    create: (canvas) => new ParticlesRenderer(canvas),
    capabilities: { methods: ['dot', 'line'], layers: true, sliders: ['particles'] },
  },
  ripple: {
    label: '波紋', group: '流体・粒子', stateful: true,
    create: (canvas) => new RippleRenderer(canvas),
    capabilities: { methods: [], layers: true, sliders: [] },
  },
  flow: {
    label: 'ノイズフロー', group: '流体・粒子', stateful: true,
    create: (canvas) => new FlowRenderer(canvas),
    capabilities: { methods: ['dot', 'line'], layers: true, sliders: ['motion', 'particles'] },
  },
  metaball: {
    label: 'メタボール', group: '流体・粒子', stateful: true,
    create: (canvas) => new MetaballRenderer(canvas),
    capabilities: { methods: [], layers: true, sliders: [] },
  },

  // ── 幾何系（ステートフル） ──
  lissajous: {
    label: 'オシロスコープ', group: '幾何', stateful: true,
    create: (canvas) => new LissajousRenderer(canvas),
    capabilities: { methods: ['line', 'dot'], layers: false, sliders: [] },
  },
  flower: {
    label: '極座標フラワー', group: '幾何', stateful: true,
    create: (canvas) => new FlowerRenderer(canvas),
    capabilities: { methods: ['bar', 'line', 'dot'], layers: true, sliders: ['motion', 'petals'], physics: true },
  },
  voronoi: {
    label: 'ボロノイ脈動', group: '幾何', stateful: true,
    create: (canvas) => new VoronoiRenderer(canvas),
    capabilities: { methods: [], layers: true, sliders: ['particles', 'motion'] },
  },
};

// タイプ一覧を group 順で返す（UI の optgroup 構築用）
const RENDERER_GROUP_ORDER = ['基本', '時間軸', '擬似3D', '流体・粒子', '幾何'];

function getRendererEntry(type) {
  return RENDERER_REGISTRY[type] || RENDERER_REGISTRY.bar;
}
