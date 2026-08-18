// Generates advisor and unit voices via ElevenLabs TTS.
// Reads ELEVENLABS_API_KEY from env, scene .env, or the KoA bots .env.
// Does not print the key.
//
//   node scripts/generate-elevenlabs-voices.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BOTS_ENV = join(process.env.USERPROFILE ?? '', 'OneDrive', 'Documents', 'GitHub', 'koa', 'bots', '.env')

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
  humanAdvisor: { id: '2EiwWnXFnvU5JabPnv8n', settings: { stability: 0.4, similarity_boost: 0.72, style: 0.45 } },
  humanUnit: { id: 'TxGEqnHWrfWFTfGW9XjX', settings: { stability: 0.42, similarity_boost: 0.72, style: 0.35 } },
  alienAdvisor: { id: 'EXAVITQu4vr4xnSDxMaL', settings: { stability: 0.58, similarity_boost: 0.8, style: 0.2 } },
  alienUnit: { id: 'ErXwobaYiN019PkySvjV', settings: { stability: 0.5, similarity_boost: 0.76, style: 0.25 } },
  bioAdvisor: { id: 'VR6AewLTigWG4xSOukaG', settings: { stability: 0.32, similarity_boost: 0.62, style: 0.55 } },
  bioUnit: { id: 'VR6AewLTigWG4xSOukaG', settings: { stability: 0.22, similarity_boost: 0.55, style: 0.7 } }
}

const MYRIAD_VOICE_CACHE = join(ROOT, 'sounds', 'voice', 'bio', 'voice-id.txt')
const MYRIAD_VOICE_DESCRIPTION =
  'A monstrous hive creature speaking English. Wet guttural growls, deep, rasping, insect and flesh, not a human actor, still clearly understandable.'
const VANGUARD_VOICE_CACHE = join(ROOT, 'sounds', 'voice', 'human', 'voice-id.txt')
const VANGUARD_VOICE_DESCRIPTION =
  'A rough, tough human military commander. Gravelly weathered male voice, battle-hardened field officer in his fifties, authoritative and blunt, not a polished narrator or radio host. Speaks English clearly.'

async function designMyriadVoice() {
  try {
    const cached = readFileSync(MYRIAD_VOICE_CACHE, 'utf8').trim()
    if (cached) {
      console.log('using cached Myriad voice')
      return cached
    }
  } catch {
    // first run
  }

  const design = await fetch('https://api.elevenlabs.io/v1/text-to-voice/design', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_description: MYRIAD_VOICE_DESCRIPTION,
      auto_generate_text: true,
      model_id: 'eleven_multilingual_ttv_v2'
    })
  })

  if (!design.ok) {
    const detail = await design.text()
    console.log(`voice design unavailable (${design.status}): ${detail.slice(0, 160)}`)
    return ''
  }

  const designed = await design.json()
  const preview = designed.previews?.[0]
  if (!preview?.generated_voice_id) {
    console.log('voice design returned no preview')
    return ''
  }

  const created = await fetch('https://api.elevenlabs.io/v1/text-to-voice', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_name: 'DecentraCraft Myriad',
      voice_description: MYRIAD_VOICE_DESCRIPTION,
      generated_voice_id: preview.generated_voice_id
    })
  })

  if (!created.ok) {
    const detail = await created.text()
    console.log(`voice create unavailable (${created.status}): ${detail.slice(0, 160)}`)
    return ''
  }

  const voice = await created.json()
  const id = voice.voice_id
  if (!id) return ''
  mkdirSync(dirname(MYRIAD_VOICE_CACHE), { recursive: true })
  writeFileSync(MYRIAD_VOICE_CACHE, id)
  console.log('created Myriad monster voice')
  return id
}

async function designVanguardCommander() {
  try {
    const cached = readFileSync(VANGUARD_VOICE_CACHE, 'utf8').trim()
    if (cached) {
      console.log('using cached Vanguard commander voice')
      return cached
    }
  } catch {
    // first run
  }

  const design = await fetch('https://api.elevenlabs.io/v1/text-to-voice/design', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_description: VANGUARD_VOICE_DESCRIPTION,
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
      voice_description: VANGUARD_VOICE_DESCRIPTION,
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

const ADVISOR = {
  human: {
    'more-crystal': 'We require more crystal.',
    'more-plasma': 'We require more plasma.',
    'more-supply': 'Additional Habitats required.',
    'scout-first': 'Scout this ground first.',
    'building-complete': 'Building complete.',
    'unit-ready': 'Unit ready.',
    'research-complete': 'Research complete.',
    'base-under-attack': 'Our base is under attack.',
    'forces-under-attack': 'Our forces are under attack.',
    victory: 'Victory.',
    defeat: 'Defeat.'
  },
  alien: {
    'more-crystal': 'The crystal is insufficient.',
    'more-plasma': 'The plasma is insufficient.',
    'more-supply': 'Additional Conduits required.',
    'scout-first': 'This ground is unseen.',
    'building-complete': 'Assembly complete.',
    'unit-ready': 'The vessel is ready.',
    'research-complete': 'The rite is complete.',
    'base-under-attack': 'The Monolith is under assault.',
    'forces-under-attack': 'Our host is under assault.',
    victory: 'The Rift prevails.',
    defeat: 'The light fails.'
  },
  bio: {
    'more-crystal': 'The brood needs more crystal.',
    'more-plasma': 'The brood needs more plasma.',
    'more-supply': 'Additional Growth Pods required.',
    'scout-first': 'Hunt this ground first.',
    'building-complete': 'The nest is grown.',
    'unit-ready': 'The spawn is ready.',
    'research-complete': 'The flesh learns.',
    'base-under-attack': 'The Heart is under attack.',
    'forces-under-attack': 'The swarm is under attack.',
    victory: 'The feast is ours.',
    defeat: 'The brood is broken.'
  }
}

// Production-finished lines: advisor names the unit instead of "vessel / spawn".
const READY_UNITS = ['worker', 'melee', 'ranged', 'healer', 'caster', 'antiAir', 'flyer', 'transport', 'heavyAir', 'siege', 'titan']
const READY_NAMES = {
  human: {
    worker: 'Rigger',
    melee: 'Breacher',
    ranged: 'Longshot',
    healer: 'Field Medic',
    caster: 'Stormcaller',
    antiAir: 'Flakgunner',
    flyer: 'Kestrel Gunship',
    transport: 'Skyhauler',
    heavyAir: 'Dreadnought',
    siege: 'Thunderhead',
    titan: 'Juggernaut'
  },
  alien: {
    worker: 'Seeker',
    melee: 'Sentinel',
    ranged: 'Lancer',
    healer: 'Lightmender',
    caster: 'Riftweaver',
    antiAir: 'Starlance',
    flyer: 'Zephyr',
    transport: 'Riftbarge',
    heavyAir: 'Solar Ark',
    siege: 'Sunlance',
    titan: 'Avatar'
  },
  bio: {
    worker: 'Grub',
    melee: 'Mauler',
    ranged: 'Spitter',
    healer: 'Broodtender',
    caster: 'Plague Weaver',
    antiAir: 'Spore Lasher',
    flyer: 'Shrieker',
    transport: 'Broodwing',
    heavyAir: 'Sky Leviathan',
    siege: 'Acidmaw',
    titan: 'Behemoth'
  }
}

function advisorOutDir(race) {
  if (race === 'human') return join(ROOT, 'sounds', 'voice', 'human', 'v2')
  if (race === 'bio') return join(ROOT, 'sounds', 'voice', 'bio', 'v2')
  return join(ROOT, 'sounds', 'voice', race)
}

function readyLine(race, name) {
  if (race === 'alien') return `${name} is ready.`
  if (race === 'bio') return `${name} ready.`
  return `${name} ready.`
}

const COMPLETE_BUILDINGS = ['temple', 'supplyHouse', 'barracks', 'techLab', 'forge', 'airForge', 'fireplace', 'turret']
const COMPLETE_NAMES = {
  human: {
    temple: 'Command Post',
    supplyHouse: 'Habitat',
    barracks: 'Armory',
    techLab: 'Starforge',
    forge: 'Foundry',
    airForge: 'Skyharbor',
    fireplace: 'Beacon',
    turret: 'Sentry Cannon'
  },
  alien: {
    temple: 'Monolith',
    supplyHouse: 'Conduit',
    barracks: 'Rift Gate',
    techLab: 'Sanctum',
    forge: 'Ascension Spire',
    airForge: 'Zenith Spire',
    fireplace: 'Obelisk',
    turret: 'Arc Spire'
  },
  bio: {
    temple: 'Brood Heart',
    supplyHouse: 'Growth Pod',
    barracks: 'Spawning Pit',
    techLab: 'Grand Nest',
    forge: 'Mutation Den',
    airForge: 'Wind Roost',
    fireplace: 'Spore Mound',
    turret: 'Thorn Mound'
  }
}

function completeLine(race, name) {
  if (race === 'alien') return `${name} is complete.`
  if (race === 'bio') return `${name} grown.`
  return `${name} complete.`
}

const UNITS = {
  human: {
    worker: { select: 'Rigger ready.', move: 'Heading out.', attack: "We'll crack it." },
    infantry: { select: 'In position.', move: 'Moving.', attack: 'Weapons free.' },
    caster: { select: 'Stormcaller.', move: 'Relocating.', attack: 'Calling the storm.' },
    air: { select: 'Airborne.', move: 'On vector.', attack: 'Target locked.' },
    siege: { select: 'Thunderhead ready.', move: 'Repositioning.', attack: 'Firing solution.' },
    titan: { select: 'Juggernaut online.', move: 'Advancing.', attack: 'Crush them.' },
    hero: { select: 'Kael here.', move: 'With me.', attack: 'For the colony.' }
  },
  alien: {
    worker: { select: 'Seeker attends.', move: 'I go.', attack: 'It will yield.' },
    infantry: { select: 'We stand.', move: 'We move.', attack: 'We strike.' },
    caster: { select: 'The rift listens.', move: 'I shift.', attack: 'Unmake them.' },
    air: { select: 'Aloft.', move: 'On the wind.', attack: 'Their sky falls.' },
    siege: { select: 'Sunlance ready.', move: 'I take the high ground.', attack: 'Light descends.' },
    titan: { select: 'The Avatar walks.', move: 'I approach.', attack: 'Judgment.' },
    hero: { select: 'Auren hears.', move: 'The path opens.', attack: 'By the Rift.' }
  },
  bio: {
    worker: { select: 'Hungry.', move: 'Feed.', attack: 'Mine.' },
    infantry: { select: 'Yes.', move: 'Go.', attack: 'Kill.' },
    caster: { select: 'Plague.', move: 'Near.', attack: 'Rot.' },
    air: { select: 'Sky.', move: 'Hunt.', attack: 'Fall.' },
    siege: { select: 'Ready.', move: 'Aim.', attack: 'Burn.' },
    titan: { select: 'Awake.', move: 'Come.', attack: 'Crush.' },
    hero: { select: 'Szel.', move: 'Follow.', attack: 'Feast.' }
  }
}

const jobs = []

for (const race of ['human', 'alien', 'bio']) {
  const dir = join(ROOT, 'sounds', 'voice', race)
  mkdirSync(dir, { recursive: true })
  const advisorDir = race === 'human' ? join(dir, 'v2') : dir
  mkdirSync(advisorDir, { recursive: true })
  const advisorVoice = VOICES[`${race}Advisor`]
  for (const [id, text] of Object.entries(ADVISOR[race])) {
    jobs.push({ file: join(advisorDir, `advisor-${id}.mp3`), text, voice: advisorVoice })
  }
  const readyDir = advisorOutDir(race)
  mkdirSync(readyDir, { recursive: true })
  for (const unit of READY_UNITS) {
    jobs.push({
      file: join(readyDir, `advisor-ready-${unit}.mp3`),
      text: readyLine(race, READY_NAMES[race][unit]),
      voice: advisorVoice
    })
  }
  for (const kind of COMPLETE_BUILDINGS) {
    jobs.push({
      file: join(readyDir, `advisor-complete-${kind}.mp3`),
      text: completeLine(race, COMPLETE_NAMES[race][kind]),
      voice: advisorVoice
    })
  }
  const unitVoice = VOICES[`${race}Unit`]
  for (const [unitClass, lines] of Object.entries(UNITS[race])) {
    for (const [intent, text] of Object.entries(lines)) {
      // Myriad playback reads bio/v2. Hero lines live there so Szel matches the hive advisor.
      const unitDir = race === 'bio' && unitClass === 'hero' ? join(dir, 'v2') : dir
      jobs.push({ file: join(unitDir, `unit-${unitClass}-${intent}.mp3`), text, voice: unitVoice })
    }
  }
}

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
    console.log(`rate limited, retry ${job.file} in ${wait}ms`)
    await new Promise((resolve) => setTimeout(resolve, wait))
    return generate(job, attempt + 1)
  }

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${job.file} HTTP ${response.status}: ${detail.slice(0, 240)}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 800) throw new Error(`${job.file} empty`)
  writeFileSync(job.file, buffer)
  console.log(`wrote ${job.file.slice(ROOT.length + 1)} (${(buffer.length / 1024).toFixed(1)} KB)`)
}

const only = process.argv.slice(2)
const selected = only.length ? jobs.filter((job) => only.some((name) => job.file.includes(name))) : jobs

if (selected.some((job) => job.file.includes(`${sep}bio${sep}`) || job.file.includes('/bio/') || job.file.includes('\\bio\\'))) {
  const monsterId = await designMyriadVoice()
  if (monsterId) {
    for (const job of selected) {
      if (job.file.includes(`${sep}bio${sep}`) || job.file.includes('/bio/') || job.file.includes('\\bio\\')) {
        job.voice = { ...job.voice, id: monsterId }
      }
    }
  }
}

function isRaceVoiceJob(job, race) {
  return job.file.includes(`${sep}${race}${sep}`) || job.file.includes(`/${race}/`) || job.file.includes(`\\${race}\\`)
}

function isHumanVoiceJob(job) {
  return isRaceVoiceJob(job, 'human')
}

function isVanguardCommanderJob(job) {
  return isHumanVoiceJob(job) && (job.file.includes('advisor-') || job.file.includes('unit-hero-'))
}

function isAethyrHeroJob(job) {
  return isRaceVoiceJob(job, 'alien') && job.file.includes('unit-hero-')
}

if (selected.some(isVanguardCommanderJob)) {
  const commanderId = await designVanguardCommander()
  if (commanderId) {
    for (const job of selected) {
      if (isVanguardCommanderJob(job)) job.voice = { ...job.voice, id: commanderId }
    }
  }
}

// Auren uses the Aethyr advisor (Bella), not the troop voice — same split as Kael.
if (selected.some(isAethyrHeroJob)) {
  for (const job of selected) {
    if (isAethyrHeroJob(job)) job.voice = VOICES.alienAdvisor
  }
}

console.log(`generating ${selected.length} voice clips`)
for (const job of selected) {
  await generate(job)
  await new Promise((resolve) => setTimeout(resolve, 250))
}
console.log('done')
