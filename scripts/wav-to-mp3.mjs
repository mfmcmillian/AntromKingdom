// Converts the synthesized WAVs in sounds/sfx/ to much smaller MP3s and
// deletes the WAV originals. Run after scripts/generate-sfx.mjs:
//   node scripts/generate-sfx.mjs && node scripts/wav-to-mp3.mjs
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import lamejs from '@breezystack/lamejs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'sounds', 'sfx')
const KBPS = 48

for (const file of readdirSync(DIR)) {
  if (!file.endsWith('.wav')) continue

  const buffer = readFileSync(join(DIR, file))
  // Our generator writes canonical 44-byte-header mono 16-bit PCM.
  const sampleRate = buffer.readUInt32LE(24)
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset + 44, (buffer.length - 44) / 2)

  const encoder = new lamejs.Mp3Encoder(1, sampleRate, KBPS)
  const chunks = []
  const BLOCK = 1152
  for (let i = 0; i < samples.length; i += BLOCK) {
    const chunk = encoder.encodeBuffer(samples.subarray(i, i + BLOCK))
    if (chunk.length > 0) chunks.push(Buffer.from(chunk))
  }
  const flush = encoder.flush()
  if (flush.length > 0) chunks.push(Buffer.from(flush))

  const outName = file.replace(/\.wav$/, '.mp3')
  const out = Buffer.concat(chunks)
  writeFileSync(join(DIR, outName), out)
  unlinkSync(join(DIR, file))
  console.log(`sounds/sfx/${outName} (${(out.length / 1024).toFixed(0)} KB, was ${(buffer.length / 1024).toFixed(0)} KB wav)`)
}
