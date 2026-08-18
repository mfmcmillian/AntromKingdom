// Generates SFX and music from ElevenLabs. Reads ELEVENLABS_API_KEY from the
// environment, this scene's .env, or the KoA bots .env. Does not print the key.
//
//   node scripts/generate-elevenlabs-audio.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SFX_DIR = join(ROOT, 'sounds', 'sfx')
const GATHER_DIR = join(ROOT, 'sounds', 'gathering')
const MUSIC_DIR = join(ROOT, 'sounds', 'music')
const BOTS_ENV = join(process.env.USERPROFILE ?? '', 'OneDrive', 'Documents', 'GitHub', 'koa', 'bots', '.env')

mkdirSync(SFX_DIR, { recursive: true })
mkdirSync(GATHER_DIR, { recursive: true })
mkdirSync(MUSIC_DIR, { recursive: true })

function readKeyFromEnvFile(path) {
  try {
    const text = readFileSync(path, 'utf8')
    const match = text.match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.+)\s*$/m)
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : ''
  } catch {
    return ''
  }
}

const apiKey =
  process.env.ELEVENLABS_API_KEY ||
  readKeyFromEnvFile(join(ROOT, '.env')) ||
  readKeyFromEnvFile(BOTS_ENV)

if (!apiKey) {
  console.error('No ELEVENLABS_API_KEY found')
  process.exit(1)
}

const SFX_V2 = join(SFX_DIR, 'v2')
mkdirSync(SFX_V2, { recursive: true })

const SFX_JOBS = [
  {
    file: join(SFX_V2, 'ack.mp3'),
    text: 'AAA RTS order confirmation, crisp two-tone radio chirp, loud and clean, 200 milliseconds of sound then silence, no voice, no music',
    duration: 0.5
  },
  {
    file: join(SFX_V2, 'ack-human.mp3'),
    text: 'AAA military radio squelch click then a sharp confirmation beep, close-mic, loud, no voice, no music',
    duration: 0.5
  },
  {
    file: join(SFX_V2, 'ack-alien.mp3'),
    text: 'AAA sci-fi crystalline confirmation chime, bright glass harmonic ping, loud and polished, no voice, no music',
    duration: 0.5
  },
  {
    file: join(SFX_V2, 'ack-bio.mp3'),
    text: 'AAA creature acknowledgement, wet organic click and low insect rasp, loud, no spoken words, no music',
    duration: 0.5
  },
  {
    file: join(SFX_V2, 'laser.mp3'),
    text: 'AAA sci-fi plasma rifle shot for a real-time strategy game. Single bolt: hot electrical crack, sizzle, tight bass punch, very short tail. Close and loud. No explosion, no voice, no music, not a movie trailer.',
    duration: 0.55
  },
  {
    file: join(SFX_V2, 'melee.mp3'),
    text: 'AAA melee combat hit for a strategy game. Heavy steel blade chopping into plate armor, thick meaty impact, metal clang and bone crunch in one hit. Loud, close, short decay. No scream, no voice, no music, not cinematic.',
    duration: 0.65
  },
  {
    file: join(SFX_V2, 'explosion.mp3'),
    text: 'AAA unit death explosion for a strategy game. Deep bass thump, fire burst, metal debris, compact and loud, under one second. Game mix, not a movie trailer, no voice, no music.',
    duration: 0.85
  },
  {
    file: join(SFX_V2, 'alert.mp3'),
    text: 'AAA real-time strategy base alarm. Harsh two-tone klaxon, urgent and loud, analog siren bite. No voice, no music bed.',
    duration: 1.1
  },
  {
    file: join(SFX_V2, 'complete.mp3'),
    text: 'AAA RTS building complete UI chime. Two bright major notes, polished, satisfying, loud enough to cut through battle. No voice.',
    duration: 0.8
  },
  {
    file: join(SFX_V2, 'research.mp3'),
    text: 'AAA sci-fi research complete sting. Rising three-note crystal arpeggio, shimmering and finished, loud and clear. No voice.',
    duration: 1.0
  },
  {
    file: join(SFX_V2, 'click.mp3'),
    text: 'AAA user interface button click, crisp tactile plastic tick, short and clean, no voice',
    duration: 0.5
  },
  {
    file: join(SFX_V2, 'melee-human.mp3'),
    text: 'AAA colonial marine melee hit. Boarding axe and combat knife slamming into metal armor, heavy steel clang and meat, loud, short. No sword ring, no voice, no music.',
    duration: 0.65
  },
  {
    file: join(SFX_V2, 'ranged-human.mp3'),
    text: 'AAA sci-fi slug rifle shot. Kinetic gunfire, mechanical bolt, muzzle crack and bass punch, tight tail. Not a laser sword. No voice, no music.',
    duration: 0.55
  },
  {
    file: join(SFX_V2, 'death-human.mp3'),
    text: 'AAA military vehicle wreck explosion. Metal tear, fire thump, debris, compact game death, loud. No voice, no music, not a trailer.',
    duration: 0.85
  },
  {
    file: join(SFX_V2, 'melee-alien.mp3'),
    text: 'AAA energy blade hit. Crystalline psi-blade slicing armor, electric crackle and glass shatter, no steel sword, no voice, no music. Loud, short.',
    duration: 0.65
  },
  {
    file: join(SFX_V2, 'ranged-alien.mp3'),
    text: 'AAA void beam shot. Searing light lance, harmonic zap, rift crackle, no gunshot, no slug. Loud, tight, no voice, no music.',
    duration: 0.55
  },
  {
    file: join(SFX_V2, 'death-alien.mp3'),
    text: 'AAA crystal construct implosion. Glass shatter inward, light collapse, harmonic boom, not a fireball. Loud, compact, no voice, no music.',
    duration: 0.85
  },
  {
    file: join(SFX_V2, 'melee-bio.mp3'),
    text: 'AAA monster claw hit. Chitin talons ripping flesh, wet tear, bone crunch, insect rasp. No swords, no metal, no voice, no music. Loud, short, disgusting.',
    duration: 0.65
  },
  {
    file: join(SFX_V2, 'ranged-bio.mp3'),
    text: 'AAA acid spit projectile. Wet glob launched, hissing bile, organic spray, no gun, no laser. Loud, short, no voice, no music.',
    duration: 0.55
  },
  {
    file: join(SFX_V2, 'death-bio.mp3'),
    text: 'AAA creature death burst. Wet flesh pop, ichor splash, carapace crack, no fire explosion, no metal. Loud, compact, no voice, no music.',
    duration: 0.85
  }
]

const MUSIC_JOBS = [
  {
    file: join(MUSIC_DIR, 'match.mp3'),
    prompt:
      'Instrumental dark sci-fi strategy game soundtrack on a shattered moon. Low pulse, sparse synths, distant percussion, tense but not frantic. No vocals, no lyrics, loop-friendly ending.',
    lengthMs: 45000
  },
  {
    file: join(MUSIC_DIR, 'hub.mp3'),
    prompt:
      'Instrumental sci-fi menu theme for a colony on a broken moon. Warm pads, light percussion, hopeful and calm. No vocals, no lyrics, loop-friendly ending.',
    lengthMs: 36000
  },
  {
    file: join(MUSIC_DIR, 'victory.mp3'),
    prompt:
      'Instrumental short sci-fi victory fanfare. Brass and glowing pads, triumphant then resolve. No vocals, no lyrics.',
    lengthMs: 12000
  },
  {
    file: join(MUSIC_DIR, 'defeat.mp3'),
    prompt:
      'Instrumental short sci-fi defeat cue. Low brass and a fading drone, somber and final. No vocals, no lyrics.',
    lengthMs: 12000
  }
]

async function generateSfx(job, attempt = 1) {
  const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      text: job.text,
      duration_seconds: job.duration,
      loop: job.loop === true,
      prompt_influence: 0.72,
      model_id: 'eleven_text_to_sound_v2'
    })
  })

  if (response.status === 429 && attempt < 6) {
    const wait = attempt * 4000
    console.log(`rate limited, retry SFX in ${wait}ms`)
    await new Promise((resolve) => setTimeout(resolve, wait))
    return generateSfx(job, attempt + 1)
  }

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${job.file} SFX HTTP ${response.status}: ${detail.slice(0, 280)}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 500) throw new Error(`${job.file} empty SFX`)
  writeFileSync(job.file, buffer)
  console.log(`sfx  ${job.file.slice(ROOT.length + 1)} (${(buffer.length / 1024).toFixed(1)} KB)`)
}

async function generateMusic(job, attempt = 1) {
  const response = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      prompt: job.prompt,
      music_length_ms: job.lengthMs,
      model_id: 'music_v2',
      force_instrumental: true
    })
  })

  if (response.status === 429 && attempt < 6) {
    const wait = attempt * 8000
    console.log(`rate limited, retry music in ${wait}ms`)
    await new Promise((resolve) => setTimeout(resolve, wait))
    return generateMusic(job, attempt + 1)
  }

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${job.file} music HTTP ${response.status}: ${detail.slice(0, 280)}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 2000) throw new Error(`${job.file} empty music`)
  writeFileSync(job.file, buffer)
  console.log(`music ${job.file.slice(ROOT.length + 1)} (${(buffer.length / 1024).toFixed(1)} KB)`)
}

const only = process.argv.slice(2)
const sfxJobs = only.length ? SFX_JOBS.filter((job) => only.some((name) => job.file.includes(name))) : SFX_JOBS
const musicJobs = only.length ? MUSIC_JOBS.filter((job) => only.some((name) => job.file.includes(name))) : MUSIC_JOBS

console.log(`generating ${sfxJobs.length} sfx + ${musicJobs.length} music`)
for (const job of sfxJobs) {
  await generateSfx(job)
  await new Promise((resolve) => setTimeout(resolve, 350))
}
for (const job of musicJobs) {
  await generateMusic(job)
  await new Promise((resolve) => setTimeout(resolve, 800))
}
console.log('done')
