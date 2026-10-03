// @page harness
// SongMapService の全経路とキュー契約 — doc/20260928-plan-phase18-song-map-and-auto-director.md §5・§8.3 B18-01
// Node の songmapRows(synthSong(48000, { bpm: 128, seed: 11 })) → buildSongMap による
// tests/fixtures/songmap-128.json の比較対象を埋め込む（file:// でも fetch は不要）。
const B18_SERVICE_NODE_REFERENCE = {
  "sampleRate": 48000,
  "durationSec": 120,
  "beats": [
    0.007850666666666666,
    0.47657865101108937,
    0.9453066353555121,
    1.4140346196999347,
    1.8827626040443575,
    2.3514905883887804,
    2.820218572733203,
    3.2889465570776255,
    3.7576745414220483,
    4.2264025257664715,
    4.695130510110894,
    5.163858494455316,
    5.632586478799739,
    6.1013144631441625,
    6.570042447488584,
    7.038770431833007,
    7.50749841617743,
    7.976226400521853,
    8.444954384866277,
    8.913682369210697,
    9.382410353555121,
    9.851138337899544,
    10.319866322243966,
    10.788594306588388,
    11.257322290932812,
    11.726050275277233,
    12.194778259621657,
    12.66350624396608,
    13.132234228310502,
    13.600962212654926,
    14.069690196999348,
    14.538418181343772,
    15.007146165688193,
    15.475874150032615,
    15.944602134377039,
    16.413330118721458,
    16.882058103065884,
    17.350786087410306,
    17.81951407175473,
    18.28824205609915,
    18.756970040443573,
    19.225698024787995,
    19.694426009132417,
    20.16315399347684,
    20.631881977821262,
    21.100609962165688,
    21.56933794651011,
    22.038065930854533,
    22.506793915198955,
    22.975521899543377,
    23.4442498838878,
    23.912977868232225,
    24.381705852576648,
    24.85043383692107,
    25.31916182126549,
    25.78788980560991,
    26.256617789954333,
    26.72534577429876,
    27.19407375864318,
    27.662801742987604,
    28.131529727332026,
    28.60025771167645,
    29.068985696020874,
    29.537713680365297,
    30.00644166470972,
    30.47516964905414,
    30.94389763339856,
    31.41262561774299,
    31.88135360208741,
    32.350081586431834,
    32.81880957077625,
    33.28753755512068,
    33.756265539465105,
    34.22499352380952,
    34.69372150815394,
    35.16244949249837,
    35.63117747684279,
    36.09990546118721,
    36.56863344553164,
    37.03736142987606,
    37.50608941422048,
    37.9748173985649,
    38.44354538290933,
    38.91227336725375,
    39.38100135159817,
    39.8497293359426,
    40.31845732028702,
    40.787185304631436,
    41.25591328897586,
    41.72464127332029,
    42.193369257664706,
    42.66209724200913,
    43.13082522635355,
    43.59955321069798,
    44.0682811950424,
    44.53700917938682,
    45.00573716373125,
    45.474465148075666,
    45.943193132420085,
    46.41192111676451,
    46.88064910110893,
    47.349377085453355,
    47.81810506979779,
    48.28683305414221,
    48.755561038486626,
    49.22428902283105,
    49.69301700717547,
    50.161744991519896,
    50.630472975864315,
    51.09920096020874,
    51.56792894455316,
    52.03665692889758,
    52.505384913242004,
    52.97411289758644,
    53.442840881930856,
    53.911568866275275,
    54.3802968506197,
    54.84902483496412,
    55.317752819308545,
    55.786480803652964,
    56.25520878799739,
    56.72393677234181,
    57.19266475668623,
    57.66139274103066,
    58.130120725375086,
    58.598848709719505,
    59.06757669406393,
    59.53630467840835,
    60.00503266275277,
    60.473760647097194,
    60.94248863144161,
    61.41121661578604,
    61.87994460013046,
    62.34867258447488,
    62.81740056881931,
    63.286128553163735,
    63.754856537508154,
    64.22358452185259,
    64.69231250619701,
    65.16104049054142,
    65.62976847488585,
    66.09849645923028,
    66.56722444357469,
    67.03595242791911,
    67.50468041226354,
    67.97340839660797,
    68.44213638095239,
    68.91086436529682,
    69.37959234964123,
    69.84832033398565,
    70.31704831833008,
    70.78577630267449,
    71.25450428701892,
    71.72323227136334,
    72.19196025570777,
    72.6606882400522,
    73.12941622439662,
    73.59814420874103,
    74.06687219308546,
    74.53560017742988,
    75.00432816177431,
    75.47305614611872,
    75.94178413046315,
    76.41051211480757,
    76.87924009915199,
    77.34796808349641,
    77.81669606784085,
    78.28542405218526,
    78.75415203652969,
    79.22288002087411,
    79.69160800521853,
    80.16033598956295,
    80.62906397390738,
    81.0977919582518,
    81.56651994259622,
    82.03524792694064,
    82.50397591128507,
    82.9727038956295,
    83.44143187997392,
    83.91015986431833,
    84.37888784866276,
    84.84761583300718,
    85.31634381735161,
    85.78507180169602,
    86.25379978604045,
    86.72252777038487,
    87.19125575472928,
    87.65998373907371,
    88.12871172341815,
    88.59743970776256,
    89.06616769210699,
    89.5348956764514,
    90.00362366079582,
    90.47235164514026,
    90.94107962948468,
    91.4098076138291,
    91.87853559817351,
    92.34726358251795,
    92.81599156686237,
    93.28471955120679,
    93.7534475355512,
    94.22217551989564,
    94.69090350424005,
    95.15963148858448,
    95.6283594729289,
    96.09708745727332,
    96.56581544161776,
    97.03454342596217,
    97.5032714103066,
    97.97199939465101,
    98.44072737899545,
    98.90945536333986,
    99.37818334768428,
    99.8469113320287,
    100.31563931637314,
    100.78436730071756,
    101.25309528506197,
    101.7218232694064,
    102.19055125375081,
    102.65927923809525,
    103.12800722243966,
    103.59673520678409,
    104.0654631911285,
    104.53419117547294,
    105.00291915981735,
    105.47164714416178,
    105.9403751285062,
    106.40910311285062,
    106.87783109719506,
    107.34655908153947,
    107.8152870658839,
    108.2840150502283,
    108.75274303457275,
    109.22147101891716,
    109.69019900326158,
    110.15892698760602,
    110.62765497195043,
    111.09638295629486,
    111.56511094063927,
    112.0338389249837,
    112.50256690932811,
    112.97129489367255,
    113.44002287801696,
    113.90875086236139,
    114.3774788467058,
    114.84620683105024,
    115.31493481539466,
    115.78366279973908,
    116.25239078408352,
    116.72111876842793,
    117.18984675277235,
    117.65857473711677,
    118.12730272146119,
    118.5960307058056,
    119.06475869015004,
    119.53348667449445
  ],
  "sections": [
    {
      "startBar": 0,
      "endBar": 8,
      "startSec": 0,
      "endSec": 15.007146165688193,
      "label": "A",
      "kind": "intro",
      "energy": 0.2530609287289498,
      "slopePerSec": 4.4911453531240546e-07
    },
    {
      "startBar": 8,
      "endBar": 16,
      "startSec": 15.007146165688193,
      "endSec": 30.00644166470972,
      "label": "B",
      "kind": "build",
      "energy": 0.7476436155671874,
      "slopePerSec": 0.050251139946065664
    },
    {
      "startBar": 16,
      "endBar": 32,
      "startSec": 30.00644166470972,
      "endSec": 60.00503266275277,
      "label": "C",
      "kind": "drop",
      "energy": 0.9296555832638865,
      "slopePerSec": -0.0007368674417915506
    },
    {
      "startBar": 32,
      "endBar": 40,
      "startSec": 60.00503266275277,
      "endSec": 75.00432816177431,
      "label": "A",
      "kind": "break",
      "energy": 0.39871523644782525,
      "slopePerSec": 0.004078656341585049
    },
    {
      "startBar": 40,
      "endBar": 56,
      "startSec": 75.00432816177431,
      "endSec": 105.00291915981735,
      "label": "C",
      "kind": "drop",
      "energy": 0.9281479512103469,
      "slopePerSec": -0.0006166694425683221
    },
    {
      "startBar": 56,
      "endBar": 64,
      "startSec": 105.00291915981735,
      "endSec": 120,
      "label": "A",
      "kind": "outro",
      "energy": 0.08509193893261793,
      "slopePerSec": -0.020971093488084076
    }
  ]
};

// 合成曲の Float32 PCM を変えずに渡すため IEEE float 32bit WAV とする。
function b18ServiceWav(signal) {
  const channels = signal.channels;
  const frames = channels[0].length;
  const align = channels.length * 4;
  const bytes = new Uint8Array(44 + frames * align);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true);
  ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, signal.sampleRate, true);
  view.setUint32(28, signal.sampleRate * align, true);
  view.setUint16(32, align, true); view.setUint16(34, 32, true);
  ascii(36, 'data'); view.setUint32(40, frames * align, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      view.setFloat32(offset, channel[i], true);
      offset += 4;
    }
  }
  return bytes;
}

function b18ServiceFMeasure(estimated, truth) {
  let i = 0, j = 0, hits = 0;
  while (i < estimated.length && j < truth.length) {
    const delta = estimated[i] - truth[j];
    if (Math.abs(delta) <= 0.07) { hits++; i++; j++; }
    else if (delta < 0) i++;
    else j++;
  }
  return 2 * hits / (estimated.length + truth.length);
}

avzTest('B18-01c', 'B18-01 SongMapService: WAV の全経路・U18-08 基準・Node の同一 PCM 結果との一致', async function () {
  const signal = synthSong(48000, { bpm: 128 });
  const file = new File([b18ServiceWav(signal)], 'b18-service-128.wav', {
    type: 'audio/wav', lastModified: 18,
  });
  const service = new SongMapService();
  const progress = [];
  const key = service.keyOf(file);
  service.onProgress = (receivedKey, ratio) => {
    avzAssert.equal(receivedKey, key, '進捗キー');
    progress.push(ratio);
  };
  try {
    const pending = service.request(file);
    avzAssert.equal(service.request(file), pending, '実行中は同一 Promise');
    const map = await pending;
    avzAssert.equal(service.get(file), map, '結果をキャッシュ');
    avzAssert.equal(await service.request(file), map, '再 request は同じ SongMap');
    avzAssert.equal(map.sampleRate, 48000, '同じサンプルレートの PCM を比較');
    avzAssert.equal(map.durationSec, 120, '曲長');
    avzAssert.ok(Math.abs(map.bpm - 128) / 128 <= 0.01, 'BPM 誤差 ±1%');
    const f = b18ServiceFMeasure(map.beats, signal.truth.beats);
    avzAssert.ok(f >= 0.95, '拍 F 値 ≥ 0.95: ' + f);
    const downbeats = map.downbeatIndices.map((i) => map.beats[i]);
    const downbeatFraction = downbeats.filter((beat) =>
      signal.truth.downbeats.some((target) => Math.abs(beat - target) <= 0.07)
    ).length / downbeats.length;
    avzAssert.ok(downbeatFraction >= 0.9, '小節頭一致率 ≥ 90%: ' + downbeatFraction);
    const boundaries = map.sections.slice(1).map((section) => section.startSec);
    const truth = signal.truth.boundariesBars.slice(1, -1).map((bar) => bar * signal.barSec);
    avzAssert.equal(boundaries.length, 5, '内部境界 5 個');
    let boundaryMaxError = 0;
    for (let i = 0; i < truth.length; i++) {
      const error = Math.abs(boundaries[i] - truth[i]);
      boundaryMaxError = Math.max(boundaryMaxError, error);
      avzAssert.ok(error <= signal.barSec + 0.07, '境界 ±(1 小節 + 70ms): ' + i);
    }
    avzAssert.deepEqual(map.sections.map((section) => section.kind),
      ['intro', 'build', 'drop', 'break', 'drop', 'outro'], 'kind 6/6');
    avzAssert.equal(map.sections[2].label, map.sections[4].label, 'ドロップのラベル再利用');
    avzAssert.ok(map.sections[2].label !== map.sections[0].label, 'イントロとドロップは別ラベル');
    avzAssert.ok(validateSongMap(map).ok, 'validateSongMap');
    const reference = B18_SERVICE_NODE_REFERENCE;
    avzAssert.equal(map.beats.length, reference.beats.length, 'Node と拍数一致');
    let maxBeatDiff = 0;
    for (let i = 0; i < map.beats.length; i++) {
      maxBeatDiff = Math.max(maxBeatDiff, Math.abs(map.beats[i] - reference.beats[i]));
    }
    avzAssert.ok(maxBeatDiff <= 1e-6, 'Node との拍差 ≤ 1e-6 秒: ' + maxBeatDiff);
    // sections 一致: 小節番号・ラベル・種類は完全一致、実数（秒・energy・slopePerSec）は ±1e-9
    // （ブラウザと Node の Math 実装差で最下位ビットが異なりうるため。計画書 §8.3 B18-01 に明記）
    avzAssert.equal(map.sections.length, reference.sections.length, 'Node と sections 数一致');
    for (let i = 0; i < map.sections.length; i++) {
      const a = map.sections[i], b = reference.sections[i];
      avzAssert.deepEqual([a.startBar, a.endBar, a.label, a.kind], [b.startBar, b.endBar, b.label, b.kind],
        'Node と section ' + i + ' の構造一致');
      for (const key of ['startSec', 'endSec', 'energy', 'slopePerSec']) {
        avzAssert.close(a[key], b[key], 1e-9, 'Node と section ' + i + ' の ' + key + ' 一致');
      }
    }
    avzAssert.equal(progress[0], 0, '進捗開始 0');
    avzAssert.equal(progress[progress.length - 2], 0.9, '全行受信時 0.9');
    avzAssert.equal(progress[progress.length - 1], 1, 'buildSongMap 完了時 1');
    for (let i = 0; i < progress.length; i++) {
      avzAssert.ok(Number.isFinite(progress[i]) && progress[i] >= 0 && progress[i] <= 1, '進捗 0..1');
      if (i) avzAssert.ok(progress[i] >= progress[i - 1], '進捗は単調');
    }
    console.log('B18-01c bpm=' + map.bpm + ' beats=' + map.beats.length + ' F=' + f
      + ' downbeatFraction=' + downbeatFraction + ' boundaryMaxErrorSec=' + boundaryMaxError
      + ' maxNodeBeatDiffSec=' + maxBeatDiff + ' progressEvents=' + progress.length);
  } finally {
    service.cancel(file);
  }
}, { timeoutMs: 120000 });

async function b18ServiceRejects(promise, code) {
  let error;
  try { await promise; } catch (caught) { error = caught; }
  avzAssert.ok(error instanceof SongMapError, 'SongMapError を reject');
  avzAssert.equal(error.code, code, 'エラーコード');
}

// キューの待ち時間を制御し、処理中・待機中・再 request の競合を決定的に検査する。
class B18ControlledService extends SongMapService {
  constructor() {
    super({ isAvailable: () => true });
    this.started = [];
    this.finish = [];
  }
  async _run(job) {
    this.started.push(job.key);
    return new Promise((resolve) => this.finish.push(resolve));
  }
}

avzTest('B18-01d', 'B18-01 SongMapService: 利用不可・同一キー・FIFO・中止・6件 LRU', async function () {
  const file = (name) => ({ name, size: 18, lastModified: 5 });
  const a = file('a'), b = file('b'), c = file('c');
  const unavailable = new SongMapService({ isAvailable: () => false });
  await b18ServiceRejects(unavailable.request(a), 'unavailable');
  avzAssert.equal(unavailable.get(a), null, '利用不可結果はキャッシュしない');
  avzAssert.equal(unavailable._pending.size, 0, '利用不可時は待機しない');

  const service = new B18ControlledService();
  const first = service.request(a);
  avzAssert.equal(service.keyOf(a), 'a|18|5', 'keyOf');
  avzAssert.equal(service.request(file('a')), first, '同一キーの Promise');
  const second = service.request(b);
  const third = service.request(c);
  avzAssert.equal(service.started.length, 1, '処理は1件ずつ');
  const secondRejected = b18ServiceRejects(second, 'cancelled');
  service.cancel(b);
  await secondRejected;
  const firstRejected = b18ServiceRejects(first, 'cancelled');
  service.cancel(a);
  await firstRejected;
  const replacement = service.request(a);
  avzAssert.ok(replacement !== first, '中止直後の同一キーは新規 Promise');
  avzAssert.equal(service.started.length, 1, '中止した処理の終了まで後続は待つ');
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  service.finish.shift()({ name: 'cancelled-result' });
  await tick();
  avzAssert.equal(service.get(a), null, '中止結果をキャッシュしない');
  avzAssert.deepEqual(service.started, [service.keyOf(a), service.keyOf(c)], '待機順と待機中止');
  const cMap = { name: 'c-map' };
  service.finish.shift()(cMap);
  avzAssert.equal(await third, cMap, '次の結果');
  await tick();
  avzAssert.equal(service.started[2], service.keyOf(a), '同一キー再 request は末尾で実行');
  const aMap = { name: 'a-map' };
  service.finish.shift()(aMap);
  avzAssert.equal(await replacement, aMap, '古い中止処理が新しい request を壊さない');
  await tick();
  const additions = [];
  for (let i = 0; i < 4; i++) {
    const entry = file('entry-' + i);
    additions.push(entry);
    const request = service.request(entry);
    service.finish.shift()({ name: entry.name });
    await request;
    await tick();
  }
  avzAssert.equal(service.get(c), cMap, 'get で参照順を更新');
  avzAssert.equal(await service.request(a), aMap, 'request で参照順を更新');
  const seventh = service.request(file('seventh'));
  service.finish.shift()({ name: 'seventh' });
  await seventh;
  avzAssert.equal(service._cache.size, 6, '最大6件');
  avzAssert.equal(service.get(additions[0]), null, '最も古く参照された結果を破棄');
  avzAssert.equal(service.get(c), cMap, '参照済みの結果は残る');
  service.cancel(c);
  avzAssert.equal(service.get(c), cMap, '完了済みキャッシュは cancel の対象外');
  console.log('B18-01d started=' + service.started.length + ' cacheSize=' + service._cache.size);
});

avzTest('B18-01e', 'B18-01 SongMapService: decode・長さ判定・no-rhythm はキャッシュせず再試行可能', async function () {
  const service = new SongMapService();
  const invalid = new File(['invalid audio'], 'b18-invalid.wav', { lastModified: 1 });
  await b18ServiceRejects(service.request(invalid), 'decode');
  await b18ServiceRejects(service.request(invalid), 'decode');
  avzAssert.equal(service.get(invalid), null, 'デコードエラーのキャッシュなし');
  const shortSignal = { sampleRate: 48000, channels: [new Float32Array(48000 * 10)] };
  const short = new File([b18ServiceWav(shortSignal)], 'b18-short.wav', { lastModified: 2 });
  let progressCount = 0;
  service.onProgress = () => progressCount++;
  await b18ServiceRejects(service.request(short), 'too-short');
  avzAssert.equal(progressCount, 0, '短い音声はワークレット処理前に拒否');
  avzAssert.equal(service.get(short), null, '長さエラーのキャッシュなし');
  const silentSignal = { sampleRate: 48000, channels: [new Float32Array(48000 * 30)] };
  const silent = new File([b18ServiceWav(silentSignal)], 'b18-silent.wav', { lastModified: 3 });
  await b18ServiceRejects(service.request(silent), 'no-rhythm');
  avzAssert.equal(service.get(silent), null, 'リズムなし結果のキャッシュなし');
}, { timeoutMs: 120000 });


avzTest('B18-01f', 'B18-01 SongMapService: 行受信中の中止と後続処理・遅い done を待つ処理の中止', async function () {
  const service = new SongMapService();
  const signal = sigDrumPattern(48000, 30, 120);
  const cancelledFile = new File([b18ServiceWav(signal)], 'b18-cancel.wav', { lastModified: 6 });
  const shortSignal = { sampleRate: 48000, channels: [new Float32Array(48000)] };
  const nextFile = new File([b18ServiceWav(shortSignal)], 'b18-after-cancel.wav', { lastModified: 7 });
  let cancelRatio = null;
  let cancelledProgressCount = 0;
  service.onProgress = (key, ratio) => {
    if (key !== service.keyOf(cancelledFile)) return;
    cancelledProgressCount++;
    if (ratio > 0 && cancelRatio === null) {
      cancelRatio = ratio;
      service.cancel(cancelledFile);
    }
  };
  const pending = service.request(cancelledFile);
  const cancelled = b18ServiceRejects(pending, 'cancelled');
  const next = b18ServiceRejects(service.request(nextFile), 'too-short');
  await cancelled;
  const countAtCancel = cancelledProgressCount;
  await next;
  avzAssert.ok(cancelRatio > 0 && cancelRatio < 0.9, '最初の rows で中止');
  avzAssert.equal(cancelledProgressCount, countAtCancel, '中止後の進捗なし');
  avzAssert.equal(service.get(cancelledFile), null, '中止結果のキャッシュなし');
  console.log('B18-01f cancelRatio=' + cancelRatio + ' cancelledProgressEvents=' + cancelledProgressCount);

  // startRendering が先に終わり、port の done がまだ届かない状態を作る。
  const Context = window.OfflineAudioContext;
  const Worklet = window.AudioWorkletNode;
  let rendered;
  const renderingReached = new Promise((resolve) => { rendered = resolve; });
  let portClosed = false;
  let disconnected = 0;
  window.OfflineAudioContext = class {
    constructor() { this.audioWorklet = { addModule: async () => {} }; this.destination = {}; }
    createBufferSource() { return { connect() {}, start() {}, disconnect() { disconnected++; } }; }
    async startRendering() { rendered(); }
  };
  window.AudioWorkletNode = class {
    constructor() { this.port = { close() { portClosed = true; } }; }
    connect() {}
    disconnect() { disconnected++; }
  };
  const lateDone = new SongMapService();
  try {
    const waiting = lateDone.request(cancelledFile);
    const rejected = b18ServiceRejects(waiting, 'cancelled');
    await renderingReached;
    // _collectRows の await startRendering の後まで進める。
    await new Promise((resolve) => setTimeout(resolve, 0));
    lateDone.cancel(cancelledFile);
    await rejected;
    await new Promise((resolve) => setTimeout(resolve, 0));
    avzAssert.equal(lateDone._active, null, 'done 待機中の中止でキューを解放');
    avzAssert.equal(portClosed, true, 'port を閉じる');
    avzAssert.equal(disconnected, 2, 'ノードと source を切断');
  } finally {
    lateDone.cancel(cancelledFile);
    window.OfflineAudioContext = Context;
    window.AudioWorkletNode = Worklet;
  }
}, { timeoutMs: 120000 });


avzTest('B18-01g', 'B18-01 SongMapService: 長さの上下限・既定の可否判定・待機中の可否変更', async function () {
  const Context = window.AudioContext;
  const Worklet = window.AudioWorkletNode;
  let durationSec = 0;
  let closeCount = 0;
  window.AudioContext = class {
    async decodeAudioData() { return { duration: durationSec }; }
    async close() { closeCount++; }
  };
  const file = (name) => ({ name, size: 1, lastModified: 18, arrayBuffer: async () => new ArrayBuffer(1) });
  const reachedRows = new Error('長さ判定を通過');
  class DurationService extends SongMapService {
    async _collectRows() { throw reachedRows; }
  }
  try {
    const service = new DurationService({ isAvailable: () => true });
    for (const [duration, expected] of [
      [SONG_CONST.MIN_DURATION_SEC - 0.001, 'too-short'],
      [SONG_CONST.MAX_DURATION_SEC + 0.001, 'too-long'],
    ]) {
      durationSec = duration;
      const input = file(String(duration));
      await b18ServiceRejects(service.request(input), expected);
      avzAssert.equal(service.get(input), null, '長さエラーはキャッシュしない');
    }
    for (const duration of [SONG_CONST.MIN_DURATION_SEC, SONG_CONST.MAX_DURATION_SEC]) {
      durationSec = duration;
      let error;
      try { await service.request(file(String(duration))); } catch (caught) { error = caught; }
      avzAssert.equal(error, reachedRows, '上下限ぴったりは解析へ進む');
    }
    avzAssert.equal(closeCount, 4, '全 probe を閉じる');
    window.AudioWorkletNode = undefined;
    await b18ServiceRejects(new SongMapService().request(file('default')), 'unavailable');
    window.AudioWorkletNode = Worklet;

    let available = true;
    let release;
    const held = file('held');
    held.arrayBuffer = () => new Promise((resolve) => { release = resolve; });
    const changing = new SongMapService({ isAvailable: () => available });
    const first = b18ServiceRejects(changing.request(held), 'unavailable');
    const next = b18ServiceRejects(changing.request(file('queued')), 'unavailable');
    available = false;
    release(new ArrayBuffer(1));
    await Promise.all([first, next]);
    avzAssert.equal(changing.get(held), null, '可否変更時もキャッシュなし');
    console.log('B18-01g durationGuards=4 probeCloses=' + closeCount);
  } finally {
    window.AudioContext = Context;
    window.AudioWorkletNode = Worklet;
  }
});
