import { getCampaignCompletedCount, isCampaignCleared } from './campaign'
import type { FrameId, PortraitId, PublicProfile, RankedRaceWins } from './multiplayer/protocol'
import { emptyRaceRecords, emptyRankedRaceWins } from './multiplayer/protocol'
import type { RaceId } from './types'

export type { FrameId, PortraitId }

/** Equipped portrait / rank-frame cosmetics. Unlocks are derived from
 *  campaign clears, ranked multiplayer wins, and a 100 MANA tip. */

export type PortraitDef = {
  id: PortraitId
  name: string
  src: string
  hint: string
  /** Clear that race's 8-mission campaign. */
  race?: RaceId
  /** Clear all 24 campaign missions. */
  campaignAll?: boolean
  /** Tip 100 MANA to the creator wallet. */
  manaTip?: boolean
}

export type FrameDef = {
  id: FrameId
  name: string
  /** Ranked wins required. Ignored when rankedAllRaces is set. */
  wins: number
  /** Unlock by winning at least one ranked match as each race. */
  rankedAllRaces?: boolean
  src: string
  hint: string
}

const STORAGE_KEY = 'decentracraft-profile-v1'
export const LOCKED_PORTRAIT_SRC = 'images/ui/profile/portrait-locked.jpg'
export const LOCKED_FRAME_SRC = 'images/ui/profile/frame-locked.jpg'
export const RACE_MISSION_COUNT = 8

const PREVIEW_ANTROM = false

/** KOA-style living portrait: one 3x3 sheet, pose locked, only fire / embers /
 *  lightning change. UVs crop one cell; the UI tree re-renders every frame so
 *  Date.now() steps the animation with no extra timer. */
const ANTROM_SHEET_GRID = 3
const ANTROM_SHEET_FRAMES = ANTROM_SHEET_GRID * ANTROM_SHEET_GRID
const ANTROM_FRAME_MS = 130

export function isAntromPortraitSrc(src: string): boolean {
  return src.includes('portrait-antrom-sheet')
}

export function antromPortraitUvs(): number[] {
  const frame = Math.floor(Date.now() / ANTROM_FRAME_MS) % ANTROM_SHEET_FRAMES
  const col = frame % ANTROM_SHEET_GRID
  const row = Math.floor(frame / ANTROM_SHEET_GRID)
  const u0 = col / ANTROM_SHEET_GRID
  const u1 = (col + 1) / ANTROM_SHEET_GRID
  const v1 = 1 - row / ANTROM_SHEET_GRID
  const v0 = 1 - (row + 1) / ANTROM_SHEET_GRID
  return [u0, v0, u0, v1, u1, v1, u1, v0]
}

export const PORTRAITS: PortraitDef[] = [
  {
    id: 'kael',
    race: 'human',
    name: 'Warmaster Kael',
    src: 'images/ui/profile/portrait-kael.jpg',
    hint: 'Clear The Last Colony — 8 / 8 Vanguard missions.'
  },
  {
    id: 'auren',
    race: 'alien',
    name: 'Riftlord Auren',
    src: 'images/ui/profile/portrait-auren.jpg',
    hint: 'Clear The Rift War — 8 / 8 Aethyr missions.'
  },
  {
    id: 'szel',
    race: 'bio',
    name: 'Broodmother Szel',
    src: 'images/ui/profile/portrait-szel.jpg',
    hint: 'Clear The Bloom — 8 / 8 Myriad missions.'
  },
  {
    id: 'antrom',
    campaignAll: true,
    name: 'The Shattered Crown',
    src: 'images/ui/profile/portrait-antrom-sheet.jpg',
    hint: 'The ultimate portrait. Clear every campaign — 24 / 24 missions.'
  },
  {
    id: 'patron',
    manaTip: true,
    name: 'The Patron',
    src: 'images/ui/profile/portrait-patron.jpg',
    hint: 'Tip 100 MANA to DecentraCraft.'
  }
]

export const FRAMES: FrameDef[] = [
  { id: 'iron', name: 'Iron', wins: 0, src: 'images/ui/profile/frame-iron.png', hint: 'Default frame. Always unlocked.' },
  { id: 'bronze', name: 'Bronze', wins: 1, src: 'images/ui/profile/frame-bronze.png', hint: 'Win 1 ranked multiplayer match.' },
  { id: 'silver', name: 'Silver', wins: 5, src: 'images/ui/profile/frame-silver.png', hint: 'Win 5 ranked multiplayer matches.' },
  { id: 'gold', name: 'Gold', wins: 15, src: 'images/ui/profile/frame-gold.png', hint: 'Win 15 ranked multiplayer matches.' },
  { id: 'champion', name: 'Champion', wins: 40, src: 'images/ui/profile/frame-champion.png', hint: 'Win 40 ranked multiplayer matches.' },
  {
    id: 'sovereign',
    name: 'Sovereign',
    wins: 0,
    rankedAllRaces: true,
    src: 'images/ui/profile/frame-sovereign.png',
    hint: 'Win a ranked match as Vanguard, Aethyr, and Myriad.'
  }
]

let equippedPortrait: PortraitId | '' = ''
let equippedFrame: FrameId = 'iron'
let hadLocalPortrait = false
let hadLocalFrame = false
let publishHook: (() => void) | undefined
const seenPortraits = new Set<PortraitId>()
const seenFrames = new Set<FrameId>(['iron'])
let seenSeeded = false
/** This scene load only. Absorb current unlocks once sources have arrived. */
let sessionPrimed = false
let campaignSourceReady = false
let profileSourceReady = false
let localManaTip = false
let localRankedRaceWins: RankedRaceWins = emptyRankedRaceWins()
/** Players who already earned Sovereign under the old 24/24 rule keep it. */
let sovereignLegacy = false

loadEquipped()

export type CosmeticUnlock = {
  kind: 'portrait' | 'frame'
  name: string
  detail: string
  portraitSrc: string
  frameSrc: string
}

/** Session registers this so an equip is published for other players to see. */
export function setProfilePublishHook(hook: () => void): void {
  publishHook = hook
}

/** Portraits this browser has actually unlocked, even if campaign IDs were wiped. */
export function rememberedCampaignPortraits(): PortraitId[] {
  const ids: PortraitId[] = []
  if (equippedPortrait) ids.push(equippedPortrait)
  for (const id of seenPortraits) {
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

export function hasSovereignLegacy(): boolean {
  return sovereignLegacy
}

export function getPortrait(id: PortraitId): PortraitDef | undefined {
  return PORTRAITS.find((portrait) => portrait.id === id)
}

export function getFrame(id: FrameId): FrameDef | undefined {
  return FRAMES.find((frame) => frame.id === id)
}

export function isAllCampaignsCleared(): boolean {
  return isCampaignCleared('human') && isCampaignCleared('alien') && isCampaignCleared('bio')
}

export function isManaTipUnlocked(): boolean {
  return localManaTip
}

export function setManaTipUnlocked(): void {
  localManaTip = true
  writeEquipped()
}

export function hasRankedAllRaces(): boolean {
  return localRankedRaceWins.human >= 1 && localRankedRaceWins.alien >= 1 && localRankedRaceWins.bio >= 1
}

/** Session calls this after campaign progress or the public profile book arrives. */
export function markCosmeticSourceReady(source: 'campaign' | 'profiles'): void {
  if (source === 'campaign') campaignSourceReady = true
  else profileSourceReady = true
}

export function areCosmeticSourcesReady(): boolean {
  return campaignSourceReady && profileSourceReady
}

/** Apply the server's last equipped cosmetics when this client has no local pick. */
export function restoreEquippedCosmetics(portrait: PortraitId | '', frame: FrameId): void {
  let changed = false
  if (!hadLocalPortrait && !equippedPortrait && portrait && PORTRAITS.some((item) => item.id === portrait)) {
    equippedPortrait = portrait
    changed = true
  }
  if (!hadLocalFrame && frame && FRAMES.some((item) => item.id === frame)) {
    equippedFrame = frame
    changed = true
  }
  if (changed) writeEquipped()
}

/** Session applies server-published unlock flags when the profile book updates. */
export function applyRemoteUnlockFlags(flags: { manaTip?: boolean; rankedRaceWins?: RankedRaceWins; sovereignLegacy?: boolean }): void {
  if (flags.manaTip) localManaTip = true
  if (flags.sovereignLegacy) sovereignLegacy = true
  if (flags.rankedRaceWins) {
    localRankedRaceWins = {
      human: Math.max(0, flags.rankedRaceWins.human ?? 0),
      alien: Math.max(0, flags.rankedRaceWins.alien ?? 0),
      bio: Math.max(0, flags.rankedRaceWins.bio ?? 0)
    }
  }
  writeEquipped()
}

export function isPortraitUnlocked(id: PortraitId): boolean {
  const portrait = getPortrait(id)
  if (!portrait) return false
  if (portrait.race) return isCampaignCleared(portrait.race)
  if (portrait.campaignAll) return PREVIEW_ANTROM || isAllCampaignsCleared()
  if (portrait.manaTip) return localManaTip
  return false
}

export function isFrameUnlocked(id: FrameId, rankedWins: number): boolean {
  const frame = getFrame(id)
  if (!frame) return false
  if (frame.rankedAllRaces) return hasRankedAllRaces() || sovereignLegacy
  return rankedWins >= frame.wins
}

export function getEquippedPortraitId(): PortraitId | '' {
  if (equippedPortrait && !isPortraitUnlocked(equippedPortrait)) return ''
  return equippedPortrait
}

export function getEquippedFrameId(rankedWins: number): FrameId {
  if (!isFrameUnlocked(equippedFrame, rankedWins)) return 'iron'
  return equippedFrame
}

export function portraitSrcFor(id: PortraitId | ''): string {
  return id ? (getPortrait(id)?.src ?? LOCKED_PORTRAIT_SRC) : LOCKED_PORTRAIT_SRC
}

export function frameSrcFor(id: FrameId | undefined): string {
  return getFrame(id ?? 'iron')?.src ?? FRAMES[0].src
}

export function getEquippedPortraitSrc(): string {
  return portraitSrcFor(getEquippedPortraitId())
}

export function getEquippedFrameSrc(rankedWins: number): string {
  return frameSrcFor(equippedFrame || getEquippedFrameId(rankedWins))
}

export function emptyCareerRaces(): PublicProfile['races'] {
  return emptyRaceRecords()
}

/** Equip the first unlocked portrait if the player has not chosen one yet. */
export function ensureDefaultPortrait(): void {
  if (equippedPortrait || getEquippedPortraitId()) return
  const first = PORTRAITS.find((portrait) => isPortraitUnlocked(portrait.id))
  if (first) setEquippedPortrait(first.id)
}

export function setEquippedPortrait(id: PortraitId): boolean {
  if (!isPortraitUnlocked(id)) return false
  equippedPortrait = id
  writeEquipped()
  publishHook?.()
  return true
}

export function setEquippedFrame(id: FrameId, rankedWins: number): boolean {
  if (!isFrameUnlocked(id, rankedWins)) return false
  equippedFrame = id
  writeEquipped()
  publishHook?.()
  return true
}

/**
 * Wait until campaign + profile data have arrived, then silently mark
 * everything already owned. After that, only a newly earned reward celebrates.
 */
export function pollCosmeticUnlock(rankedWins: number): CosmeticUnlock | undefined {
  if (!sessionPrimed) {
    if (!campaignSourceReady || !profileSourceReady) return undefined
    absorbOwnedCosmetics(rankedWins)
    sessionPrimed = true
    seenSeeded = true
    writeEquipped()
    return undefined
  }

  for (const portrait of PORTRAITS) {
    if (!isPortraitUnlocked(portrait.id) || seenPortraits.has(portrait.id)) continue
    seenPortraits.add(portrait.id)
    setEquippedPortrait(portrait.id)
    return {
      kind: 'portrait',
      name: portrait.name,
      detail: portrait.hint,
      portraitSrc: portrait.src,
      frameSrc: frameSrcFor(getEquippedFrameId(rankedWins))
    }
  }

  for (const frame of FRAMES) {
    if (frame.id === 'iron' || !isFrameUnlocked(frame.id, rankedWins) || seenFrames.has(frame.id)) continue
    seenFrames.add(frame.id)
    setEquippedFrame(frame.id, rankedWins)
    return {
      kind: 'frame',
      name: `${frame.name} Frame`,
      detail: frame.hint,
      portraitSrc: getEquippedPortraitSrc(),
      frameSrc: frame.src
    }
  }

  return undefined
}

function absorbOwnedCosmetics(rankedWins: number): void {
  if (equippedPortrait && !isPortraitUnlocked(equippedPortrait)) {
    seenPortraits.delete(equippedPortrait)
    equippedPortrait = ''
  }
  for (const portrait of PORTRAITS) {
    if (isPortraitUnlocked(portrait.id)) seenPortraits.add(portrait.id)
  }
  for (const frame of FRAMES) {
    if (isFrameUnlocked(frame.id, rankedWins)) seenFrames.add(frame.id)
  }
  seenFrames.add('iron')
}

export function getRaceCampaignProgress(): { race: RaceId; completed: number; total: number; cleared: boolean }[] {
  return (['human', 'alien', 'bio'] as RaceId[]).map((race) => ({
    race,
    completed: getCampaignCompletedCount(race),
    total: RACE_MISSION_COUNT,
    cleared: isCampaignCleared(race)
  }))
}

function loadEquipped(): void {
  try {
    const raw = getWebStorage()?.getItem(STORAGE_KEY)
    if (!raw) {
      return
    }
    const parsed = JSON.parse(raw) as {
      portrait?: unknown
      frame?: unknown
      seenPortraits?: unknown
      seenFrames?: unknown
      seenSeeded?: unknown
      manaTip?: unknown
      sovereignLegacy?: unknown
    }
    if (typeof parsed.portrait === 'string' && PORTRAITS.some((portrait) => portrait.id === parsed.portrait)) {
      equippedPortrait = parsed.portrait as PortraitId
      hadLocalPortrait = true
    }
    if (typeof parsed.frame === 'string' && FRAMES.some((frame) => frame.id === parsed.frame)) {
      equippedFrame = parsed.frame as FrameId
      hadLocalFrame = true
    }
    if (Array.isArray(parsed.seenPortraits)) {
      for (const id of parsed.seenPortraits) {
        if (typeof id === 'string' && PORTRAITS.some((portrait) => portrait.id === id)) seenPortraits.add(id as PortraitId)
      }
    }
    if (Array.isArray(parsed.seenFrames)) {
      for (const id of parsed.seenFrames) {
        if (typeof id === 'string' && FRAMES.some((frame) => frame.id === id)) seenFrames.add(id as FrameId)
      }
    }
    seenSeeded = parsed.seenSeeded === true
    localManaTip = parsed.manaTip === true
    sovereignLegacy = parsed.sovereignLegacy === true || equippedFrame === 'sovereign' || seenFrames.has('sovereign')
  } catch {
    // Preview without web storage; cosmetics stay at defaults.
  }
}

function writeEquipped(): void {
  try {
    getWebStorage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({
        portrait: equippedPortrait,
        frame: equippedFrame,
        seenPortraits: [...seenPortraits],
        seenFrames: [...seenFrames],
        seenSeeded,
        manaTip: localManaTip,
        sovereignLegacy
      })
    )
  } catch {
    // Explorer/preview without web storage.
  }
}

function getWebStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } | undefined {
  try {
    return (globalThis as { localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void } }).localStorage
  } catch {
    return undefined
  }
}
