// 目的 — Phase 15 §3.5 の PcmBuffer を RIFF/WAVE PCM 16bit little-endian に変換する。

function encodeWav16(pcmBuffer) {
  const channels = pcmBuffer.channels;
  const channelCount = channels.length;
  const sampleRate = pcmBuffer.sampleRate;
  const frameCount = channels.reduce((max, channel) => Math.max(max, channel.length), 0);
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  const pcm16 = (value) => Math.round(_wavClamp(value, -1, 1) * 32767);

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const value = frame < channels[channel].length ? channels[channel][frame] : 0;
      view.setInt16(offset, pcm16(value), true);
      offset += 2;
    }
  }
  return bytes;
}

function _wavClamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { encodeWav16 };
}
