// Generates campaign briefing VO via ElevenLabs TTS (one clip per mission).
// Reads ELEVENLABS_API_KEY from env, scene .env, or the KoA bots .env.
// Does not print the key.
//
//   node scripts/generate-elevenlabs-briefings.mjs
//   node scripts/generate-elevenlabs-briefings.mjs vanguard-1 aethyr-3
//   node scripts/generate-elevenlabs-briefings.mjs --force

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BOTS_ENV = join(process.env.USERPROFILE ?? '', 'OneDrive', 'Documents', 'GitHub', 'koa', 'bots', '.env')
const OUT_DIR = join(ROOT, 'sounds', 'voice', 'briefings', 'v2')
const MYRIAD_VOICE_CACHE = join(ROOT, 'sounds', 'voice', 'bio', 'voice-id.txt')
const VANGUARD_VOICE_CACHE = join(ROOT, 'sounds', 'voice', 'human', 'voice-id.txt')

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

const VOICES = {
  human: { id: '2EiwWnXFnvU5JabPnv8n', settings: { stability: 0.4, similarity_boost: 0.72, style: 0.45 } },
  alien: { id: 'EXAVITQu4vr4xnSDxMaL', settings: { stability: 0.58, similarity_boost: 0.8, style: 0.2 } },
  bio: { id: 'VR6AewLTigWG4xSOukaG', settings: { stability: 0.32, similarity_boost: 0.62, style: 0.55 } }
}

function loadCachedVoiceId(path, label) {
  try {
    const cached = readFileSync(path, 'utf8').trim()
    if (cached) {
      console.log(`using cached ${label} voice`)
      return cached
    }
  } catch {
    // fall back to the premade id in VOICES
  }
  return ''
}

async function designVanguardCommander() {
  const cached = loadCachedVoiceId(VANGUARD_VOICE_CACHE, 'Vanguard commander')
  if (cached) return cached

  const design = await fetch('https://api.elevenlabs.io/v1/text-to-voice/design', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_description:
        'A rough, tough human military commander. Gravelly weathered male voice, battle-hardened field officer in his fifties, authoritative and blunt, not a polished narrator or radio host. Speaks English clearly.',
      auto_generate_text: true,
      model_id: 'eleven_multilingual_ttv_v2'
    })
  })

  if (!design.ok) {
    const detail = await design.text()
    console.log(`Vanguard voice design unavailable (${design.status}): ${detail.slice(0, 160)}`)
    return ''
  }

  const designed = await design.json()
  const preview = designed.previews?.[0]
  if (!preview?.generated_voice_id) {
    console.log('Vanguard voice design returned no preview')
    return ''
  }

  const created = await fetch('https://api.elevenlabs.io/v1/text-to-voice', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_name: 'DecentraCraft Vanguard Commander',
      voice_description:
        'A rough, tough human military commander. Gravelly weathered male voice, battle-hardened field officer in his fifties, authoritative and blunt, not a polished narrator or radio host. Speaks English clearly.',
      generated_voice_id: preview.generated_voice_id
    })
  })

  if (!created.ok) {
    const detail = await created.text()
    console.log(`Vanguard voice create unavailable (${created.status}): ${detail.slice(0, 160)}`)
    return ''
  }

  const voice = await created.json()
  const id = voice.voice_id
  if (!id) return ''
  mkdirSync(dirname(VANGUARD_VOICE_CACHE), { recursive: true })
  writeFileSync(VANGUARD_VOICE_CACHE, id)
  console.log('created Vanguard commander voice')
  return id
}

function parseMissions() {
  const source = readFileSync(join(ROOT, 'src', 'rts', 'campaign.ts'), 'utf8')
  const missions = []
  const re = /id:\s*'([^']+)',\s*\r?\n\s*race:\s*'([^']+)',[\s\S]*?briefing:\s*\r?\n\s*'([^']+)'/g
  let match
  while ((match = re.exec(source))) {
    missions.push({ id: match[1], race: match[2], text: match[3].replace(/\s+/g, ' ').trim() })
  }
  return missions
}

const args = process.argv.slice(2)
const force = args.includes('--force')
const filters = args.filter((arg) => arg !== '--force')
const missions = parseMissions()

if (missions.length !== 24) {
  console.error(`expected 24 missions, parsed ${missions.length}`)
  process.exit(1)
}

const monsterId = loadCachedVoiceId(MYRIAD_VOICE_CACHE, 'Myriad')
if (monsterId) VOICES.bio = { ...VOICES.bio, id: monsterId }

if (!filters.length || filters.some((name) => name.includes('vanguard') || name.includes('human'))) {
  const commanderId = await designVanguardCommander()
  if (commanderId) VOICES.human = { ...VOICES.human, id: commanderId }
}

mkdirSync(OUT_DIR, { recursive: true })

const jobs = missions
  .filter((mission) => (filters.length ? filters.some((name) => mission.id.includes(name)) : true))
  .map((mission) => ({
    id: mission.id,
    file: join(OUT_DIR, `${mission.id}.mp3`),
    text: mission.text,
    voice: VOICES[mission.race] ?? VOICES.human
  }))
  .filter((job) => {
    if (force || !existsSync(job.file)) return true
    console.log(`skip ${job.id} (exists)`)
    return false
  })

async function generate(job, attempt = 1) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${job.voice.id}?output_format=mp3_44100_128`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      text: job.text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: job.voice.settings
    })
  })

  if (response.status === 429 && attempt < 6) {
    const wait = attempt * 3500
    console.log(`rate limited, retry ${job.id} in ${wait}ms`)
    await new Promise((resolve) => setTimeout(resolve, wait))
    return generate(job, attempt + 1)
  }

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${job.id} HTTP ${response.status}: ${detail.slice(0, 240)}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 800) throw new Error(`${job.id} empty`)
  writeFileSync(job.file, buffer)
  console.log(`wrote sounds/voice/briefings/v2/${job.id}.mp3 (${(buffer.length / 1024).toFixed(1)} KB)`)
}

console.log(`generating ${jobs.length} briefing clips`)
for (const job of jobs) {
  await generate(job)
  await new Promise((resolve) => setTimeout(resolve, 250))
}
console.log('done')
