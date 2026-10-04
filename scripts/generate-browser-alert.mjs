// Original synthesized alert. Never regenerate a published URL with new bytes.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function browserAlertBytes() {
  const rate = 16_000, samples = rate * 0.9;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const edge = Math.min(1, i / 160, (samples - i - 1) / 160);
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 880 * i / rate) * edge * 26_000), 44 + i * 2);
  }
  return wav;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../audio/alert.v1.wav', import.meta.url), browserAlertBytes());
}
