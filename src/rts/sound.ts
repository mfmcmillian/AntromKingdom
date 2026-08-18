import { AudioSource, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { getResourceAmount } from './economy'
import { gameState } from './state'
import type { BuildableKind, RaceId, ResourceCost, SoldierVariant } from './types'

// Game audio:
//   - SFX stay on a player-attached channel and a small positional pool
//   - Voices use a second channel so a laser shot does not cut an advisor line
// One-shots are throttled so big fights don't turn into white noise.

const SFX = {
  ack: 'sounds/sfx/v2/ack.mp3',
  laser: 'sounds/sfx/v2/laser.mp3',
  melee: 'sounds/sfx/v2/melee.mp3',
  explosion: 'sounds/sfx/v2/explosion.mp3',
  alert: 'sounds/sfx/v2/alert.mp3',
  complete: 'sounds/sfx/v2/complete.mp3',
  research: 'sounds/sfx/v2/research.mp3',
  click: 'sounds/sfx/v2/click.mp3'
}

const ACK_BY_RACE: Record<string, string> = {
  human: 'sounds/sfx/v2/ack-human.mp3',
  alien: 'sounds/sfx/v2/ack-alien.mp3',
  bio: 'sounds/sfx/v2/ack-bio.mp3'
}

const MUSIC = {
  hub: 'sounds/music/hub.mp3',
  match: 'sounds/music/match.mp3',
  victory: 'sounds/music/victory.mp3',
  defeat: 'sounds/music/defeat.mp3'
}

/** Race-flavored acknowledgment chirps (used when no unit voice applies). */

export type AdvisorLine =
  | 'more-crystal'
  | 'more-plasma'
  | 'more-supply'
  | 'scout-first'
  | 'building-complete'
  | 'unit-ready'
  | 'research-complete'
  | 'base-under-attack'
  | 'forces-under-attack'
  | 'victory'
  | 'defeat'

export type UnitVoiceClass = 'worker' | 'infantry' | 'caster' | 'air' | 'siege' | 'titan' | 'hero'
export type UnitVoiceIntent = 'select' | 'move' | 'attack'

let ackVoice = SFX.ack

/** Called at match start so order blips speak the player's race. */
export function setAckVoice(raceId: string): void {
  ackVoice = ACK_BY_RACE[raceId] ?? SFX.ack
}

let globalChannel: Entity | undefined
let voiceChannel: Entity | undefined
let ambientChannel: Entity | undefined

const POSITIONAL_POOL_SIZE = 6
const positionalPool: Entity[] = []
let poolIndex = 0

const lastPlayed = new Map<string, number>()

function throttled(key: string, minIntervalMs: number): boolean {
  const now = Date.now()
  if (now - (lastPlayed.get(key) ?? 0) < minIntervalMs) return true
  lastPlayed.set(key, now)
  return false
}

function getGlobalChannel(): Entity {
  if (globalChannel === undefined) {
    globalChannel = engine.addEntity()
    Transform.create(globalChannel, { parent: engine.PlayerEntity })
  }
  return globalChannel
}

function getVoiceChannel(): Entity {
  if (voiceChannel === undefined) {
    voiceChannel = engine.addEntity()
    Transform.create(voiceChannel, { parent: engine.PlayerEntity })
  }
  return voiceChannel
}

function playGlobal(clip: string, volume: number): void {
  AudioSource.createOrReplace(getGlobalChannel(), { audioClipUrl: clip, playing: true, loop: false, volume })
}

function playVoice(clip: string, volume: number): void {
  AudioSource.createOrReplace(getVoiceChannel(), { audioClipUrl: clip, playing: true, loop: false, volume })
}

/** Campaign briefing read by the race advisor. Stops any line already playing. */
export function playBriefing(missionId: string): void {
  playVoice(`sounds/voice/briefings/v2/${missionId}.mp3`, 1.35)
}

export function stopBriefing(): void {
  if (voiceChannel === undefined) return
  const audio = AudioSource.getMutableOrNull(voiceChannel)
  if (audio) audio.playing = false
}

function playAt(clip: string, position: Vector3, volume: number): void {
  if (positionalPool.length < POSITIONAL_POOL_SIZE) {
    const entity = engine.addEntity()
    Transform.create(entity, { position: Vector3.create(position.x, position.y, position.z) })
    positionalPool.push(entity)
  }
  const emitter = positionalPool[poolIndex]
  poolIndex = (poolIndex + 1) % positionalPool.length
  Transform.createOrReplace(emitter, { position: Vector3.create(position.x, position.y + 1, position.z) })
  AudioSource.createOrReplace(emitter, { audioClipUrl: clip, playing: true, loop: false, volume })
}

function voiceFolder(race: string): string {
  // Myriad v2: new monster voice. New path so the preview cannot keep the old "We run" clip.
  return race === 'bio' ? 'sounds/voice/bio/v2' : `sounds/voice/${race}`
}

function advisorFolder(race: string): string {
  // Vanguard v2: gravelly field commander, not the original polished narrator.
  return race === 'human' ? 'sounds/voice/human/v2' : voiceFolder(race)
}

function advisorClip(line: AdvisorLine): string {
  return `${advisorFolder(gameState.playerRace)}/advisor-${line}.mp3`
}

function unitClip(unitClass: UnitVoiceClass, intent: UnitVoiceIntent): string {
  return `${voiceFolder(gameState.playerRace)}/unit-${unitClass}-${intent}.mp3`
}

/** Race advisor line. Does not touch SFX, so a chime can play under it. */
export function playAdvisor(line: AdvisorLine): void {
  const gap = line.endsWith('under-attack') || line === 'victory' || line === 'defeat' ? 5000 : 850
  if (throttled(`advisor-${line}`, gap)) return
  playVoice(advisorClip(line), 1.35)
}

/** Production finished: advisor says the unit's name, not a generic "vessel / spawn". */
export function playUnitReady(unit: 'worker' | SoldierVariant): void {
  if (throttled('advisor-unit-ready', 850)) return
  const clip =
    unit === 'hero'
      ? advisorClip('unit-ready')
      : `${advisorFolder(gameState.playerRace)}/advisor-ready-${unit}.mp3`
  playVoice(clip, 1.35)
}

/** Construction finished: advisor says the building's name, not a generic "building complete". */
export function playBuildingComplete(kind: BuildableKind): void {
  if (throttled('advisor-building-complete', 850)) return
  playVoice(`${advisorFolder(gameState.playerRace)}/advisor-complete-${kind}.mp3`, 1.35)
}

/** Which resource the player is actually short on (crystal first). */
export function playMissingCost(cost: ResourceCost): void {
  if ((cost.minerals ?? 0) > getResourceAmount('player', 'minerals')) {
    playAdvisor('more-crystal')
    return
  }
  if ((cost.gas ?? 0) > getResourceAmount('player', 'gas')) {
    playAdvisor('more-plasma')
  }
}

/** Confirmation: one speaker per order, classic RTS. Repeat clicks stay quiet. */
export function playAcknowledge(intent: UnitVoiceIntent = 'move', unitClass?: UnitVoiceClass): void {
  // Select can talk again sooner; move/attack need a long gap so click-moving
  // through a fight does not restart a new line every step.
  if (throttled(`ack-${intent}`, intent === 'select' ? 700 : 2200)) return
  if (unitClass) {
    playVoice(unitClip(unitClass, intent), 1.05)
    return
  }
  playGlobal(ackVoice, 0.7)
}

function combatClip(kind: 'melee' | 'ranged' | 'death', race?: string): string {
  const id: RaceId = race === 'alien' || race === 'bio' ? race : 'human'
  return `sounds/sfx/v2/${kind}-${id}.mp3`
}

/** Melee / claw / energy-blade hit at the point of impact. */
export function playMelee(position: Vector3, race?: RaceId): void {
  if (throttled('melee', 140)) return
  playAt(combatClip('melee', race), position, 0.28)
}

/** Building or unit finished: bright two-note chime. */
export function playComplete(): void {
  if (throttled('complete', 400)) return
  playGlobal(SFX.complete, 0.75)
}

/** Research finished: rising three-note arpeggio plus advisor. */
export function playResearchComplete(): void {
  if (throttled('research', 400)) return
  playGlobal(SFX.research, 0.8)
  playAdvisor('research-complete')
}

/** Tiny tick for HUD button presses. */
export function playUiClick(): void {
  if (throttled('click', 70)) return
  playGlobal(SFX.click, 0.6)
}

/** Ranged shot / spit / beam at the shooter's position. */
export function playLaser(position: Vector3, race?: RaceId): void {
  if (throttled('laser', 130)) return
  playAt(combatClip('ranged', race), position, 0.26)
}

/** Unit or building death burst at the victim's position. */
export function playExplosion(position: Vector3, race?: RaceId): void {
  if (throttled('explosion', 160)) return
  playAt(combatClip('death', race), position, 0.34)
}

/** "Under attack" sting plus advisor. Heavily throttled so waves don't spam it. */
export function playUnderAttackAlert(): void {
  if (throttled('alert', 5000)) return
  playGlobal(SFX.alert, 0.4)
  playAdvisor('base-under-attack')
}

function playMusic(clip: string, loop: boolean, volume: number): void {
  if (ambientChannel === undefined) {
    ambientChannel = engine.addEntity()
    Transform.create(ambientChannel, { parent: engine.PlayerEntity })
  }
  AudioSource.createOrReplace(ambientChannel, { audioClipUrl: clip, playing: true, loop, volume })
}

/** Title and setup menus. */
export function startHubMusic(): void {
  playMusic(MUSIC.hub, true, 0.28)
}

/** Match bed while a game is running. */
export function startAmbientMusic(): void {
  playMusic(MUSIC.match, true, 0.48)
}

export function stopAmbientMusic(): void {
  if (ambientChannel === undefined) return
  const audio = AudioSource.getMutableOrNull(ambientChannel)
  if (audio) audio.playing = false
}

/** End-screen sting. Replaces the match bed. */
export function playResultMusic(result: 'win' | 'loss'): void {
  playMusic(result === 'win' ? MUSIC.victory : MUSIC.defeat, false, 0.45)
}
