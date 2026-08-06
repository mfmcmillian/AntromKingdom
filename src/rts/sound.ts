import { AudioSource, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

// Game audio, all synthesized original clips (see scripts/generate-sfx.mjs):
//   - a player-attached channel for UI/global sounds (order blips, alerts, ambience)
//   - a small pool of positional emitters for combat sounds in the world.
// One-shots are throttled so big fights don't turn into white noise.

const SFX = {
  ack: 'sounds/sfx/ack.wav',
  laser: 'sounds/sfx/laser.wav',
  melee: 'sounds/sfx/melee.wav',
  explosion: 'sounds/sfx/explosion.wav',
  alert: 'sounds/sfx/alert.wav',
  complete: 'sounds/sfx/complete.wav',
  research: 'sounds/sfx/research.wav',
  click: 'sounds/sfx/click.wav',
  ambient: 'sounds/sfx/ambient.wav'
}

/** Race-flavored acknowledgment voices: radio chirp / crystal shimmer / organic squelch. */
const ACK_BY_RACE: Record<string, string> = {
  human: 'sounds/sfx/ack-human.wav',
  alien: 'sounds/sfx/ack-alien.wav',
  bio: 'sounds/sfx/ack-bio.wav'
}

let ackVoice = SFX.ack

/** Called at match start so order blips speak the player's race. */
export function setAckVoice(raceId: string): void {
  ackVoice = ACK_BY_RACE[raceId] ?? SFX.ack
}

let globalChannel: Entity | undefined
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

function playGlobal(clip: string, volume: number): void {
  AudioSource.createOrReplace(getGlobalChannel(), { audioClipUrl: clip, playing: true, loop: false, volume })
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

/** Short confirmation blip when the player issues a move/attack order. */
export function playAcknowledge(): void {
  if (throttled('ack', 180)) return
  playGlobal(ackVoice, 0.7)
}

/** Melee swing landing: thump plus clank at the point of impact. */
export function playMelee(position: Vector3): void {
  if (throttled('melee', 140)) return
  playAt(SFX.melee, position, 0.55)
}

/** Building or unit finished: bright two-note chime. */
export function playComplete(): void {
  if (throttled('complete', 400)) return
  playGlobal(SFX.complete, 0.6)
}

/** Research finished: rising three-note arpeggio. */
export function playResearchComplete(): void {
  if (throttled('research', 400)) return
  playGlobal(SFX.research, 0.65)
}

/** Tiny tick for HUD button presses. */
export function playUiClick(): void {
  if (throttled('click', 70)) return
  playGlobal(SFX.click, 0.5)
}

/** Ranged shot / turret bolt at the shooter's position. */
export function playLaser(position: Vector3): void {
  if (throttled('laser', 130)) return
  playAt(SFX.laser, position, 0.55)
}

/** Unit or building death burst at the victim's position. */
export function playExplosion(position: Vector3): void {
  if (throttled('explosion', 160)) return
  playAt(SFX.explosion, position, 0.8)
}

/** "Under attack" sting; heavily throttled so waves don't spam it. */
export function playUnderAttackAlert(): void {
  if (throttled('alert', 5000)) return
  playGlobal(SFX.alert, 0.85)
}

/** Low looping space-pad bed while a match is running. */
export function startAmbientMusic(): void {
  if (ambientChannel === undefined) {
    ambientChannel = engine.addEntity()
    Transform.create(ambientChannel, { parent: engine.PlayerEntity })
  }
  AudioSource.createOrReplace(ambientChannel, { audioClipUrl: SFX.ambient, playing: true, loop: true, volume: 0.3 })
}

export function stopAmbientMusic(): void {
  if (ambientChannel === undefined) return
  AudioSource.createOrReplace(ambientChannel, { audioClipUrl: SFX.ambient, playing: false, loop: true, volume: 0.3 })
}
