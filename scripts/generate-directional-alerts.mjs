import { readFileSync, writeFileSync } from 'node:fs';

const sourceUrl = new URL('../native-app/assets/alert.wav', import.meta.url);
const leftUrl = new URL('../native-app/assets/alert-left.wav', import.meta.url);
const rightUrl = new URL('../native-app/assets/alert-right.wav', import.meta.url);
const quieterChannelGain = 0.28;

function readMonoPcm16Wave(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('alert.wav must be a RIFF/WAVE file');
  }

  let format;
  let dataOffset;
  let dataSize;

  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;

    if (id === 'fmt ') {
      format = {
        audioFormat: buffer.readUInt16LE(payloadOffset),
        channels: buffer.readUInt16LE(payloadOffset + 2),
        sampleRate: buffer.readUInt32LE(payloadOffset + 4),
        bitsPerSample: buffer.readUInt16LE(payloadOffset + 14),
      };
    } else if (id === 'data') {
      dataOffset = payloadOffset;
      dataSize = size;
    }

    offset = payloadOffset + size + (size % 2);
  }

  if (!format || dataOffset == null || dataSize == null) {
    throw new Error('alert.wav is missing a format or data chunk');
  }
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error('alert.wav must be mono 16-bit PCM');
  }

  return { ...format, dataOffset, dataSize };
}

function scaleSample(sample, gain) {
  return Math.max(-32_768, Math.min(32_767, Math.round(sample * gain)));
}

function createStereoWave(source, metadata, leftGain, rightGain) {
  const frameCount = metadata.dataSize / 2;
  const dataSize = frameCount * 4;
  const output = Buffer.alloc(44 + dataSize);

  output.write('RIFF', 0, 'ascii');
  output.writeUInt32LE(36 + dataSize, 4);
  output.write('WAVE', 8, 'ascii');
  output.write('fmt ', 12, 'ascii');
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(2, 22);
  output.writeUInt32LE(metadata.sampleRate, 24);
  output.writeUInt32LE(metadata.sampleRate * 4, 28);
  output.writeUInt16LE(4, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36, 'ascii');
  output.writeUInt32LE(dataSize, 40);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = source.readInt16LE(metadata.dataOffset + frame * 2);
    const outputOffset = 44 + frame * 4;
    output.writeInt16LE(scaleSample(sample, leftGain), outputOffset);
    output.writeInt16LE(scaleSample(sample, rightGain), outputOffset + 2);
  }

  return output;
}

const source = readFileSync(sourceUrl);
const metadata = readMonoPcm16Wave(source);
writeFileSync(leftUrl, createStereoWave(source, metadata, 1, quieterChannelGain));
writeFileSync(rightUrl, createStereoWave(source, metadata, quieterChannelGain, 1));
