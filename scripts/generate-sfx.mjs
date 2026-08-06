// Synthesizes the game's sound effects as 16-bit PCM WAV files (no deps).
// Run: node scripts/generate-sfx.mjs
// Outputs into sounds/sfx/.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'sounds', 'sfx')
const SAMPLE_RATE = 22050

mkdirSync(OUT_DIR, { recursive: true })

function writeWav(name, samples) {
  const dataSize = samples.length * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2)
  }
  writeFileSync(join(OUT_DIR, name), buffer)
  console.log(`wrote sounds/sfx/${name} (${(buffer.length / 1024).toFixed(0)} KB)`)
}

const seconds = (s) => Math.floor(s * SAMPLE_RATE)

// Acknowledgment blip: quick rising two-tone chirp.
{
  const n = seconds(0.09)
  const out = new Float64Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const freq = 900 + 700 * t
    phase += (2 * Math.PI * freq) / SAMPLE_RATE
    const env = Math.sin(Math.PI * t) ** 0.6
    out[i] = Math.sin(phase) * env * 0.4
  }
  writeWav('ack.wav', out)
}

// Laser shot: fast falling chirp with a metallic edge.
{
  const n = seconds(0.16)
  const out = new Float64Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const freq = 1900 * Math.pow(0.16, t) + 120
    phase += (2 * Math.PI * freq) / SAMPLE_RATE
    const env = Math.exp(-5 * t)
    out[i] = (Math.sin(phase) * 0.8 + Math.sin(phase * 2.02) * 0.3) * env * 0.42
  }
  writeWav('laser.wav', out)
}

// Explosion: filtered noise burst with a deep thump.
{
  const n = seconds(0.65)
  const out = new Float64Array(n)
  let lowpass = 0
  let thumpPhase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const noise = (Math.random() * 2 - 1) * Math.exp(-6 * t)
    lowpass += (noise - lowpass) * (0.35 - 0.3 * t)
    const thumpFreq = 90 * Math.pow(0.4, t)
    thumpPhase += (2 * Math.PI * thumpFreq) / SAMPLE_RATE
    const thump = Math.sin(thumpPhase) * Math.exp(-8 * t)
    out[i] = (lowpass * 1.4 + thump * 0.9) * 0.55
  }
  writeWav('explosion.wav', out)
}

// Under-attack sting: urgent alternating two-tone alarm.
{
  const n = seconds(0.95)
  const out = new Float64Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const step = Math.floor(t * 6) % 2
    const freq = step === 0 ? 640 : 470
    phase += (2 * Math.PI * freq) / SAMPLE_RATE
    const env = Math.min(1, t * 20) * Math.min(1, (1 - t) * 6)
    out[i] = (Math.sin(phase) * 0.7 + Math.sin(phase * 2) * 0.2) * env * 0.4
  }
  writeWav('alert.wav', out)
}

// Melee hit: dull low thump plus a fast metallic clank ring.
{
  const n = seconds(0.13)
  const out = new Float64Array(n)
  let thumpPhase = 0
  let ringPhase = 0
  let lowpass = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const thumpFreq = 170 * Math.pow(0.4, t) + 40
    thumpPhase += (2 * Math.PI * thumpFreq) / SAMPLE_RATE
    ringPhase += (2 * Math.PI * 2400) / SAMPLE_RATE
    const noise = (Math.random() * 2 - 1) * Math.exp(-14 * t)
    lowpass += (noise - lowpass) * 0.5
    const thump = Math.sin(thumpPhase) * Math.exp(-9 * t)
    const clank = Math.sin(ringPhase) * Math.exp(-26 * t)
    out[i] = (thump * 0.9 + clank * 0.35 + lowpass * 0.6) * 0.5
  }
  writeWav('melee.wav', out)
}

// Production/building complete: bright two-note ascending chime.
{
  const n = seconds(0.34)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / n
    const note = t < 0.45 ? 660 : 880
    const local = t < 0.45 ? t / 0.45 : (t - 0.45) / 0.55
    const env = Math.sin(Math.PI * Math.min(1, local)) ** 0.8
    const time = i / SAMPLE_RATE
    out[i] = (Math.sin(2 * Math.PI * note * time) * 0.7 + Math.sin(2 * Math.PI * note * 2 * time) * 0.18) * env * 0.36
  }
  writeWav('complete.wav', out)
}

// Research complete: three-note rising arpeggio, more ceremonial.
{
  const n = seconds(0.55)
  const out = new Float64Array(n)
  const notes = [523.25, 659.25, 783.99]
  for (let i = 0; i < n; i++) {
    const t = i / n
    const step = Math.min(notes.length - 1, Math.floor(t * notes.length))
    const local = t * notes.length - step
    const env = Math.sin(Math.PI * Math.min(1, local)) ** 0.7
    const time = i / SAMPLE_RATE
    const freq = notes[step]
    out[i] = (Math.sin(2 * Math.PI * freq * time) * 0.65 + Math.sin(2 * Math.PI * freq * 2 * time) * 0.2) * env * 0.34
  }
  writeWav('research.wav', out)
}

// UI click: tiny dry tick.
{
  const n = seconds(0.035)
  const out = new Float64Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    phase += (2 * Math.PI * 1800) / SAMPLE_RATE
    out[i] = (Math.sin(phase) * 0.5 + (Math.random() * 2 - 1) * 0.3) * Math.exp(-18 * t) * 0.3
  }
  writeWav('click.wav', out)
}

// Vanguard ack: crisp military radio chirp with a static click at the front.
{
  const n = seconds(0.11)
  const out = new Float64Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const freq = 950 + 650 * t
    phase += (2 * Math.PI * freq) / SAMPLE_RATE
    // Square-ish radio texture.
    const square = Math.tanh(Math.sin(phase) * 3)
    const staticNoise = i < seconds(0.012) ? (Math.random() * 2 - 1) * 0.4 : 0
    const env = Math.sin(Math.PI * t) ** 0.5
    out[i] = (square * 0.35 + staticNoise) * env
  }
  writeWav('ack-human.wav', out)
}

// Aetherborn ack: crystalline bell shimmer, slightly detuned partials.
{
  const n = seconds(0.22)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / n
    const time = i / SAMPLE_RATE
    const env = Math.exp(-6 * t) * Math.min(1, t * 30)
    out[i] =
      (Math.sin(2 * Math.PI * 720 * time) * 0.45 +
        Math.sin(2 * Math.PI * 726 * time) * 0.3 +
        Math.sin(2 * Math.PI * 1440 * time) * 0.18 +
        Math.sin(2 * Math.PI * 2160 * time) * 0.08) *
      env *
      0.5
  }
  writeWav('ack-alien.wav', out)
}

// Swarm ack: wet organic squelch, wobbling downward croak.
{
  const n = seconds(0.16)
  const out = new Float64Array(n)
  let phase = 0
  let lowpass = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const wobble = Math.sin(2 * Math.PI * 26 * t) * 60
    const freq = 380 - 160 * t + wobble
    phase += (2 * Math.PI * freq) / SAMPLE_RATE
    const noise = (Math.random() * 2 - 1) * 0.5
    lowpass += (noise - lowpass) * 0.18
    const env = Math.sin(Math.PI * t) ** 0.7
    out[i] = (Math.sin(phase) * 0.6 + lowpass * Math.sin(phase * 0.5) * 0.8) * env * 0.5
  }
  writeWav('ack-bio.wav', out)
}

// Ambient bed: a slow, dark space pad that loops seamlessly (integer cycles).
{
  const duration = 12
  const n = seconds(duration)
  const out = new Float64Array(n)
  // All frequencies chosen so an integer number of cycles fits the loop.
  const voices = [
    { freq: 55, gain: 0.30 },
    { freq: 82.5, gain: 0.22 },
    { freq: 110, gain: 0.16 },
    { freq: 165, gain: 0.08 }
  ]
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    let sample = 0
    for (const voice of voices) {
      const lfo = 0.65 + 0.35 * Math.sin(2 * Math.PI * (1 / 6) * t + voice.freq)
      sample += Math.sin(2 * Math.PI * voice.freq * t) * voice.gain * lfo
    }
    // A faint shimmering top note drifting in and out twice per loop.
    sample += Math.sin(2 * Math.PI * 330 * t) * 0.03 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (1 / 6) * t + 2))
    out[i] = sample * 0.5
  }
  writeWav('ambient.wav', out)
}
