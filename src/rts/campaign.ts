import type { Difficulty, GameMode, RaceId } from './types'
import type { OpponentSetup } from './state'

// Three single-player campaigns, one per race. Same eight-mission curve
// (boot camp → open war → finale) so the fights stay familiar; names,
// briefings, and locked enemy factions are unique. Progress is tracked
// per campaign so clearing Vanguard does not unlock Aethyr.

export type CampaignWin = 'eliminate' | 'survive'

export type CampaignMission = {
  id: string
  race: RaceId
  act: 1 | 2 | 3
  actName: string
  name: string
  /** Short briefing shown before deploy. */
  briefing: string
  /** One-line hook on the campaign picker. */
  hook: string
  /** One-line objective under the title. */
  objective: string
  mapId: string
  opponents: { race: RaceId; difficulty: Difficulty }[]
  win: CampaignWin
  /** Survive missions: hold out this many seconds (razing the enemy still wins early). */
  surviveSeconds?: number
  /** Extra crystal/plasma granted on top of the normal opening bank. */
  extraMinerals?: number
  extraGas?: number
  /** Pre-built structures so the mission can skip a teaching step. */
  playerBarracks?: boolean
  playerTurrets?: number
  enemyTurrets?: number
  /** Each hostile starts with a completed barracks / spawning pit / rift gate. */
  enemyBarracks?: boolean
  /** Defaults to FFA. Team mode allies every computer against the player. */
  gameMode?: GameMode
}

export type CampaignMeta = {
  race: RaceId
  title: string
  tagline: string
}

export const CAMPAIGN_META: Record<RaceId, CampaignMeta> = {
  human: {
    race: 'human',
    title: 'The Last Colony',
    tagline: 'Vanguard was driven from Antrom. Take it back.'
  },
  alien: {
    race: 'alien',
    title: 'The Rift War',
    tagline: 'Aethyr wakes. The younger races will kneel or burn.'
  },
  bio: {
    race: 'bio',
    title: 'The Bloom',
    tagline: 'Myriad hungers. Every world is a nest.'
  }
}

const VANGUARD_MISSIONS: CampaignMission[] = [
  {
    id: 'vanguard-1',
    race: 'human',
    act: 1,
    actName: 'Reclamation',
    name: 'Dustfall',
    hook: 'Crystal first. Then the Armory. Then the nest burns.',
    briefing:
      'Antrom remembers us as the ones who ran. A Myriad brood nested in the landing struts and turned the old rim into a larder. Take the crystal veins. Raise an Armory. Burn the infestation out before it seeds the next mound. Economy first — an army with empty pockets dies on the march.',
    objective: 'Destroy every Myriad building.',
    mapId: 'shattered-crown',
    opponents: [{ race: 'bio', difficulty: 'easy' }],
    win: 'eliminate',
    extraMinerals: 100
  },
  {
    id: 'vanguard-2',
    race: 'human',
    act: 1,
    actName: 'Reclamation',
    name: 'Foundry Floor',
    hook: 'The Armory is already on the pad. Fill it.',
    briefing:
      'Command dropped an Armory on your pad because the Rift is already humming. Aethyr raiders are warping onto stone that used to be ours. Click the Armory. Queue a fighting force. Roll their camp before the Rift Gate finishes a second wave.',
    objective: 'Destroy every Aethyr building.',
    mapId: 'shattered-crown',
    opponents: [{ race: 'alien', difficulty: 'easy' }],
    win: 'eliminate',
    extraMinerals: 80,
    playerBarracks: true
  },
  {
    id: 'vanguard-3',
    race: 'human',
    act: 2,
    actName: 'Open War',
    name: 'Rift Line',
    hook: 'They will expand. Scout it. Then break it.',
    briefing:
      'This Aethyr commander is no training dummy. They will expand, tech, and hit on a timer. Send a scout. Watch the gold stone. Hold Kael on the line until you have the numbers, then fold their Monolith on their own ground. Vision wins wars. Blind armies walk into guns.',
    objective: 'Destroy every Aethyr building.',
    mapId: 'twin-reliquaries',
    opponents: [{ race: 'alien', difficulty: 'medium' }],
    win: 'eliminate'
  },
  {
    id: 'vanguard-4',
    race: 'human',
    act: 2,
    actName: 'Open War',
    name: 'Two Predators',
    hook: 'Let them bleed. Then finish whoever still stands.',
    briefing:
      'Myriad and Aethyr share the ashen causeway and hate each other almost as much as they hate you. They will fight. Let them. Punish the weaker camp first, then finish the survivor before they remember they have a common enemy. Three armies on one road — do not become the one in the middle.',
    objective: 'Destroy every hostile building.',
    mapId: 'ashen-procession',
    opponents: [
      { race: 'bio', difficulty: 'medium' },
      { race: 'alien', difficulty: 'easy' }
    ],
    win: 'eliminate'
  },
  {
    id: 'vanguard-5',
    race: 'human',
    act: 2,
    actName: 'Open War',
    name: 'Skyhaul',
    hook: 'No bridge. Take the sky, or drown.',
    briefing:
      'The Aethyr isle has no land bridge and the sea does not forgive. Raise a Starforge. Train a Skyhauler. Ferry a wave onto their pad — or win it from the air. Ground troops that walk off the rim fall. Load the carrier. Cross the black water. Plant Vanguard steel on gold stone.',
    objective: 'Destroy every Aethyr building.',
    mapId: 'islands',
    opponents: [{ race: 'alien', difficulty: 'medium' }],
    win: 'eliminate',
    extraMinerals: 120,
    extraGas: 50
  },
  {
    id: 'vanguard-6',
    race: 'human',
    act: 3,
    actName: 'The Last Push',
    name: 'Hold the Line',
    hook: 'Six minutes. The road is already moving.',
    briefing:
      'A Myriad tide is six minutes out along the ashen road. Fortify the Command Post. Keep Kael standing. Weather the waves. Razing the Brood Heart early is a win. Losing your last building is not. Turrets, supply, and a second Armory — this is a siege, not a parade.',
    objective: 'Survive 6:00, or destroy the enemy.',
    mapId: 'ashen-procession',
    opponents: [{ race: 'bio', difficulty: 'medium' }],
    win: 'survive',
    surviveSeconds: 360,
    extraMinerals: 150,
    extraGas: 40,
    playerBarracks: true,
    playerTurrets: 2,
    enemyBarracks: true
  },
  {
    id: 'vanguard-7',
    race: 'human',
    act: 3,
    actName: 'The Last Push',
    name: 'High Command',
    hook: 'Their Riftlord is on the field. Bring everything.',
    briefing:
      'Auren himself holds the high ground. Expect expansions, air, Thunderheads of their own, and a Foundry running hot. Bring a complete army — infantry, guns, sky — or Vanguard will be ground down on the steps of a colony we already lost once. No half-measures. No second exile.',
    objective: 'Destroy every Aethyr building.',
    mapId: 'shattered-crown',
    opponents: [{ race: 'alien', difficulty: 'hard' }],
    win: 'eliminate'
  },
  {
    id: 'vanguard-8',
    race: 'human',
    act: 3,
    actName: 'The Last Push',
    name: 'Last Colony',
    hook: 'They signed a pact. Break both isles, or Antrom is a grave.',
    briefing:
      'Myriad and Aethyr have struck a pact. Two hard commanders share the storm and will not bleed each other. Their pads are already armed. Claim the sea. Break both isles. If either banner still flies at dawn, the last colony is a story we tell in the dark. Kael did not come home to lose it twice.',
    objective: 'Destroy both allied commanders.',
    mapId: 'colony-isles',
    opponents: [
      { race: 'bio', difficulty: 'hard' },
      { race: 'alien', difficulty: 'hard' }
    ],
    win: 'eliminate',
    extraGas: 40,
    enemyTurrets: 2,
    enemyBarracks: true,
    gameMode: 'team'
  }
]

const AETHYR_MISSIONS: CampaignMission[] = [
  {
    id: 'aethyr-1',
    race: 'alien',
    act: 1,
    actName: 'Awakening',
    name: 'First Light',
    hook: 'Sacred stone. Squatters. Open the Gate.',
    briefing:
      'Vanguard squatters raised a Command Post on stone that remembers the first suns. Gather crystal. Open a Rift Gate. Erase their camp. The younger race will learn the old laws — starting with the one that says this world was never theirs. Economy first. A Rift without crystal is a closed door.',
    objective: 'Destroy every Vanguard building.',
    mapId: 'twin-reliquaries',
    opponents: [{ race: 'human', difficulty: 'easy' }],
    win: 'eliminate',
    extraMinerals: 100
  },
  {
    id: 'aethyr-2',
    race: 'alien',
    act: 1,
    actName: 'Awakening',
    name: 'Gate Open',
    hook: 'The Gate already stands. Fill it with Sentinels.',
    briefing:
      'A Rift Gate already stands on the reliquary floor. Myriad grubs are chewing the outer pylons like they own the light. Click the Gate. Train Sentinels. Burn the nest before the Brood Heart seeds a second mound.',
    objective: 'Destroy every Myriad building.',
    mapId: 'twin-reliquaries',
    opponents: [{ race: 'bio', difficulty: 'easy' }],
    win: 'eliminate',
    extraMinerals: 80,
    playerBarracks: true
  },
  {
    id: 'aethyr-3',
    race: 'alien',
    act: 2,
    actName: 'Judgment',
    name: 'Trespassers',
    hook: 'A Warmaster has dug in. Scout it. Fold it.',
    briefing:
      'A Vanguard Warmaster has dug in on stolen ground. They will expand, tech, and hit on a timer. Send a Seeker. Watch their Foundry. Hold Auren on the line until the numbers favor the Rift, then fold their camp. Vision wins wars. Blind Avatars walk into guns.',
    objective: 'Destroy every Vanguard building.',
    mapId: 'shattered-crown',
    opponents: [{ race: 'human', difficulty: 'medium' }],
    win: 'eliminate'
  },
  {
    id: 'aethyr-4',
    race: 'alien',
    act: 2,
    actName: 'Judgment',
    name: 'Split Sky',
    hook: 'Steel and flesh will fight. Let them. Then end it.',
    briefing:
      'Vanguard steel and Myriad flesh share the ashen causeway and will tear each other open. Let them. Punish the weaker camp first, then finish whoever still stands before they remember the Rift is the older enemy. Three banners on one road — do not become the one in the middle.',
    objective: 'Destroy every hostile building.',
    mapId: 'ashen-procession',
    opponents: [
      { race: 'human', difficulty: 'medium' },
      { race: 'bio', difficulty: 'easy' }
    ],
    win: 'eliminate'
  },
  {
    id: 'aethyr-5',
    race: 'alien',
    act: 2,
    actName: 'Judgment',
    name: 'Void Crossing',
    hook: 'Open water. Warp a barge, or the nest lives.',
    briefing:
      'The Myriad nest sits across open water and the void does not carry walkers. Raise a Sanctum. Warp a Riftbarge. Drop on their island — or scour it from the air. Walk off the rim and you fall. Load the barge. Cross. Plant gold light in living soil.',
    objective: 'Destroy every Myriad building.',
    mapId: 'islands',
    opponents: [{ race: 'bio', difficulty: 'medium' }],
    win: 'eliminate',
    extraMinerals: 120,
    extraGas: 50
  },
  {
    id: 'aethyr-6',
    race: 'alien',
    act: 3,
    actName: 'Ascension',
    name: 'Hold the Spire',
    hook: 'Six minutes. Their guns are already rolling.',
    briefing:
      'Vanguard guns are six minutes from the Monolith. Fortify the reliquary. Keep Auren standing. Weather the barrage. Razing their Command Post early is a win. Losing the last pylon is not. Spires, supply, and a second Gate — this is a siege, not a sermon.',
    objective: 'Survive 6:00, or destroy the enemy.',
    mapId: 'twin-reliquaries',
    opponents: [{ race: 'human', difficulty: 'medium' }],
    win: 'survive',
    surviveSeconds: 360,
    extraMinerals: 150,
    extraGas: 40,
    playerBarracks: true,
    playerTurrets: 2,
    enemyBarracks: true
  },
  {
    id: 'aethyr-7',
    race: 'alien',
    act: 3,
    actName: 'Ascension',
    name: 'Warmaster',
    hook: 'Kael himself holds the field. Bring the old weapons.',
    briefing:
      'Kael himself holds the field. Expect Dreadnoughts, Thunderheads, and a Foundry running hot. Bring Avatars and Solar Arks, or the Rift closes for good and Aethyr sleeps another age under their concrete. No half-measures. The younger race came back armed.',
    objective: 'Destroy every Vanguard building.',
    mapId: 'shattered-crown',
    opponents: [{ race: 'human', difficulty: 'hard' }],
    win: 'eliminate'
  },
  {
    id: 'aethyr-8',
    race: 'alien',
    act: 3,
    actName: 'Ascension',
    name: 'Twin Suns',
    hook: 'They stand together. End both, or the Rift closes.',
    briefing:
      'Vanguard and Myriad stand together. Two hard commanders, one war — they will not bleed each other. Their rift isles are already armed. End both in one night. If either banner still flies at dawn, the Rift closes and Aethyr becomes a story the stone tells itself. Auren did not wake to kneel.',
    objective: 'Destroy both allied commanders.',
    mapId: 'rift-isles',
    opponents: [
      { race: 'human', difficulty: 'hard' },
      { race: 'bio', difficulty: 'hard' }
    ],
    win: 'eliminate',
    extraGas: 40,
    enemyTurrets: 2,
    enemyBarracks: true,
    gameMode: 'team'
  }
]

const MYRIAD_MISSIONS: CampaignMission[] = [
  {
    id: 'myriad-1',
    race: 'bio',
    act: 1,
    actName: 'First Brood',
    name: 'First Taste',
    hook: 'Meat on living soil. Grow. Eat. Repeat.',
    briefing:
      'Vanguard meat has landed on living soil and called it a colony. Grow a Spawning Pit. Birth Maulers. Crack their Command Post. The Broodmother wants a first harvest, and harvests begin with crystal. Economy first — a starved brood is just a stain.',
    objective: 'Destroy every Vanguard building.',
    mapId: 'bloom-wastes',
    opponents: [{ race: 'human', difficulty: 'easy' }],
    win: 'eliminate',
    extraMinerals: 100
  },
  {
    id: 'myriad-2',
    race: 'bio',
    act: 1,
    actName: 'First Brood',
    name: 'Nest Rising',
    hook: 'The Pit already beats. Fill it with teeth.',
    briefing:
      'A Spawning Pit already beats under the bloom. Aethyr pylons are seeding the far ridge like gold weeds. Click the Pit. Birth Maulers. Swarm the Monolith before their Rift Gate finishes a second Sentinel.',
    objective: 'Destroy every Aethyr building.',
    mapId: 'bloom-wastes',
    opponents: [{ race: 'alien', difficulty: 'easy' }],
    win: 'eliminate',
    extraMinerals: 80,
    playerBarracks: true
  },
  {
    id: 'myriad-3',
    race: 'bio',
    act: 2,
    actName: 'The Spread',
    name: 'The Hunt',
    hook: 'They will expand. Scout it. Drown it.',
    briefing:
      'This Vanguard commander will expand, tech, and hit on a timer. Scout with Grubs. Watch their Foundry. Hold Szel until the swarm is thick, then eat the camp. Vision wins wars. Blind broods walk into guns and come home as meat.',
    objective: 'Destroy every Vanguard building.',
    mapId: 'shattered-crown',
    opponents: [{ race: 'human', difficulty: 'medium' }],
    win: 'eliminate'
  },
  {
    id: 'myriad-4',
    race: 'bio',
    act: 2,
    actName: 'The Spread',
    name: 'Two Herds',
    hook: 'Steel and gold will fight. Then we eat.',
    briefing:
      'Vanguard and Aethyr graze the ashen causeway and will open each other. Let them. Punish the weaker herd first, then consume whoever is left before they remember the Bloom is the older hunger. Three herds on one road — do not become the one in the middle.',
    objective: 'Destroy every hostile building.',
    mapId: 'ashen-procession',
    opponents: [
      { race: 'human', difficulty: 'medium' },
      { race: 'alien', difficulty: 'easy' }
    ],
    win: 'eliminate'
  },
  {
    id: 'myriad-5',
    race: 'bio',
    act: 2,
    actName: 'The Spread',
    name: 'Across the Water',
    hook: 'No bridge. Hatch a wing, or the gold lives.',
    briefing:
      'The Aethyr isle has no land bridge and water is a mouth that does not chew for us. Grow a Grand Nest. Hatch a Broodwing. Drop the swarm on their pad — or take the sky. Walk off the rim and you drown. Load the wing. Cross. Plant the Bloom on gold stone.',
    objective: 'Destroy every Aethyr building.',
    mapId: 'islands',
    opponents: [{ race: 'alien', difficulty: 'medium' }],
    win: 'eliminate',
    extraMinerals: 120,
    extraGas: 50
  },
  {
    id: 'myriad-6',
    race: 'bio',
    act: 3,
    actName: 'The Swarm',
    name: 'Hold the Heart',
    hook: 'Six minutes. Their steel is already rolling.',
    briefing:
      'Vanguard guns are six minutes from the Brood Heart. Fortify the wastes. Keep Szel alive. Weather the steel. Eating their Command Post early is a win. Losing the last mound is not. Thorns, supply, and a second Pit — this is a siege, not a feast.',
    objective: 'Survive 6:00, or destroy the enemy.',
    mapId: 'bloom-wastes',
    opponents: [{ race: 'human', difficulty: 'medium' }],
    win: 'survive',
    surviveSeconds: 360,
    extraMinerals: 150,
    extraGas: 40,
    playerBarracks: true,
    playerTurrets: 2,
    enemyBarracks: true
  },
  {
    id: 'myriad-7',
    race: 'bio',
    act: 3,
    actName: 'The Swarm',
    name: 'Golden Prey',
    hook: 'A Riftlord holds the high ground. Drown the light.',
    briefing:
      'A Riftlord holds the high ground. Expect Avatars, Solar Arks, and a Sanctum running hot. Drown them in Behemoths or the Bloom dies on gold stone and Szel becomes a dry husk in a pretty ruin. No half-swarms. The old light came back armed.',
    objective: 'Destroy every Aethyr building.',
    mapId: 'twin-reliquaries',
    opponents: [{ race: 'alien', difficulty: 'hard' }],
    win: 'eliminate'
  },
  {
    id: 'myriad-8',
    race: 'bio',
    act: 3,
    actName: 'The Swarm',
    name: 'The Feast',
    hook: 'They allied against the Bloom. Eat both, or starve.',
    briefing:
      'Vanguard steel and Aethyr gold have allied against the Bloom. Two hard commanders share the last blackstone isles and will not fight each other. Their pads are already armed. Eat both. If either banner still flies at dawn, the swarm starves and Antrom goes quiet. Szel did not bloom to go hungry.',
    objective: 'Destroy both allied commanders.',
    mapId: 'blackstone-isles',
    opponents: [
      { race: 'human', difficulty: 'hard' },
      { race: 'alien', difficulty: 'hard' }
    ],
    win: 'eliminate',
    extraGas: 40,
    enemyTurrets: 2,
    enemyBarracks: true,
    gameMode: 'team'
  }
]

const MISSIONS_BY_RACE: Record<RaceId, CampaignMission[]> = {
  human: VANGUARD_MISSIONS,
  alien: AETHYR_MISSIONS,
  bio: MYRIAD_MISSIONS
}

const ALL_MISSIONS: CampaignMission[] = [...VANGUARD_MISSIONS, ...AETHYR_MISSIONS, ...MYRIAD_MISSIONS]

/** All three campaigns combined (8 missions each). Used by the campaign board. */
export const CAMPAIGN_MISSION_COUNT = ALL_MISSIONS.length

export function campaignIdsForRace(race: RaceId): string[] {
  return MISSIONS_BY_RACE[race].map((mission) => mission.id)
}

export function allCampaignMissionIds(): string[] {
  return ALL_MISSIONS.map((mission) => mission.id)
}

/** Best-effort reconstruction when we only know how many missions were finished. */
export function fillSequentialCampaignIds(count: number): string[] {
  const cap = Math.max(0, Math.min(ALL_MISSIONS.length, Math.floor(Number(count) || 0)))
  return allCampaignMissionIds().slice(0, cap)
}

/** Missions implied by a saved portrait unlock (not by the live campaign list). */
export function campaignIdsForPortrait(portrait: string): string[] {
  if (portrait === 'antrom') return allCampaignMissionIds()
  if (portrait === 'kael') return campaignIdsForRace('human')
  if (portrait === 'auren') return campaignIdsForRace('alien')
  if (portrait === 'szel') return campaignIdsForRace('bio')
  return []
}

export type CampaignProgress = {
  completed: string[]
}

const LOCAL_SAVE_KEY = 'decentracraft-campaign-v1'
const LOCAL_MIGRATED_KEY = 'decentracraft-campaign-v1-migrated'

const progress: CampaignProgress = { completed: [] }
/** Wallet (or guest id) whose local save we are writing. Empty until session binds it. */
let boundWallet = ''

type CampaignPersistHook = (completed: string[]) => void
let persistHook: CampaignPersistHook | undefined

/** Server/session registers this so a win is written to player storage. */
export function setCampaignPersistHook(hook: CampaignPersistHook): void {
  persistHook = hook
}

export function getCampaignProgress(): CampaignProgress {
  return progress
}

/**
 * Switch the local cache to this wallet. Clears in-memory progress first so a
 * second wallet on the same browser cannot inherit the previous commander's
 * missions, then loads that wallet's keyed save (migrating the old unkeyed
 * blob once).
 */
export function bindCampaignWallet(address: string): void {
  const key = address.toLowerCase()
  if (boundWallet === key) return
  boundWallet = key
  progress.completed.length = 0
  const keyed = loadFromStorageKey(storageKeyFor(key))
  if (keyed.length > 0) {
    mergeCompleted(keyed)
  } else {
    const storage = getWebStorage()
    const alreadyMigrated = storage?.getItem(LOCAL_MIGRATED_KEY)
    if (!alreadyMigrated) {
      mergeCompleted(loadFromStorageKey(LOCAL_SAVE_KEY))
      try {
        storage?.setItem(LOCAL_MIGRATED_KEY, key)
      } catch {
        // Ignore quota / private-mode failures; server storage is the source of truth.
      }
    }
  }
  writeLocalCampaignProgress()
}

export function getMissionsForRace(race: RaceId): CampaignMission[] {
  return MISSIONS_BY_RACE[race]
}

export function isCampaignMissionCompleted(id: string): boolean {
  return progress.completed.includes(id)
}

export function isCampaignMissionUnlocked(id: string): boolean {
  const list = missionsForId(id)
  if (!list) return false
  const index = list.findIndex((mission) => mission.id === id)
  if (index <= 0) return true
  return isCampaignMissionCompleted(list[index - 1].id)
}

export function getCampaignMission(id: string | undefined): CampaignMission | undefined {
  if (!id) return undefined
  return ALL_MISSIONS.find((mission) => mission.id === id)
}

/** Per-race act art so a Rift Gate briefing never shows Vanguard marines. */
export function getCampaignBriefingArt(mission: CampaignMission): string {
  const index = MISSIONS_BY_RACE[mission.race].findIndex((entry) => entry.id === mission.id)
  return `images/ui/briefings/${mission.race}-m${Math.max(1, index + 1)}.jpg`
}

/** First incomplete unlocked mission in this race's campaign, or the last once it is clear. */
export function getNextCampaignMission(race: RaceId): CampaignMission {
  const list = MISSIONS_BY_RACE[race]
  const next = list.find((mission) => isCampaignMissionUnlocked(mission.id) && !isCampaignMissionCompleted(mission.id))
  return next ?? list[list.length - 1]
}

export function getNextCampaignMissionAfter(id: string): CampaignMission | undefined {
  const list = missionsForId(id)
  if (!list) return undefined
  const index = list.findIndex((mission) => mission.id === id)
  if (index < 0 || index >= list.length - 1) return undefined
  return list[index + 1]
}

export function markCampaignMissionComplete(id: string): void {
  if (!mergeCompleted([id])) return
  writeLocalCampaignProgress()
  persistHook?.(progress.completed.slice())
}

/** Merge a saved list into memory (local cache or server). Does not re-upload. */
export function applyCampaignProgress(completed: string[]): void {
  if (!mergeCompleted(completed)) return
  writeLocalCampaignProgress()
}

export function isCampaignCleared(race: RaceId): boolean {
  return MISSIONS_BY_RACE[race].every((mission) => isCampaignMissionCompleted(mission.id))
}

/** Completed missions in one campaign (0–8). */
export function getCampaignCompletedCount(race: RaceId): number {
  return getMissionsForRace(race).filter((mission) => isCampaignMissionCompleted(mission.id)).length
}

export function campaignOpponentsFor(mission: CampaignMission): OpponentSetup[] {
  return mission.opponents.map((opponent) => ({
    race: opponent.race,
    difficulty: opponent.difficulty,
    team: 2
  }))
}

export function formatSurviveClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

function missionsForId(id: string): CampaignMission[] | undefined {
  const mission = getCampaignMission(id)
  if (!mission) return undefined
  return MISSIONS_BY_RACE[mission.race]
}

function sanitizeCompleted(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const unique: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !getCampaignMission(id) || unique.includes(id)) continue
    unique.push(id)
  }
  return unique
}

function mergeCompleted(ids: string[]): boolean {
  const incoming = sanitizeCompleted(ids)
  let changed = false
  for (const id of incoming) {
    if (progress.completed.includes(id)) continue
    progress.completed.push(id)
    changed = true
  }
  return changed
}

function getWebStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } | undefined {
  try {
    return (globalThis as { localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void } }).localStorage
  } catch {
    return undefined
  }
}

function storageKeyFor(address: string): string {
  return `${LOCAL_SAVE_KEY}:${address}`
}

function loadFromStorageKey(key: string): string[] {
  try {
    const raw = getWebStorage()?.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { completed?: unknown }
    return sanitizeCompleted(parsed.completed)
  } catch {
    return []
  }
}

function loadLocalCampaignProgress(): string[] {
  return loadFromStorageKey(boundWallet ? storageKeyFor(boundWallet) : LOCAL_SAVE_KEY)
}

function writeLocalCampaignProgress(): void {
  try {
    const key = boundWallet ? storageKeyFor(boundWallet) : LOCAL_SAVE_KEY
    getWebStorage()?.setItem(key, JSON.stringify({ version: 1, completed: progress.completed }))
  } catch {
    // Explorer/preview without web storage; the server persist hook still runs.
  }
}

applyCampaignProgress(loadLocalCampaignProgress())
