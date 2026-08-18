import { Entity, Material, MeshRenderer, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { spawnBlastRing } from './impactVfx'
import { getRace } from './races'
import type { SoldierVariant, Team } from './types'

// Race-flavored combat projectiles, all pooled so battles never allocate
// entities mid-fight:
//   human (Vanguard) - trailing fireballs: a blazing head towing a tail of
//     shrinking embers, bursting into sparks on arrival.
//   alien (Aethyr)   - lightning strikes: an instant jagged arc that re-jolts
//     twice while it flickers out, with stray branch forks.
//   bio (Myriad)     - acid globs: a lobbed gob of goo on a gravity arc with
//     dripping trail, splashing into droplets and a ground ring on impact.

export type ProjectileStyle = 'fireball' | 'lightning' | 'acid'

export type ShotPalette = {
  core: Color4
  glow: Color4
  smoke: Color4
}

const MUZZLE_HEIGHT = 0.85
const IMPACT_HEIGHT = 0.7

function c(r: number, g: number, b: number): Color4 {
  return Color4.create(r, g, b, 1)
}

/** Per-role tints inside a race so a Longshot and a Thunderhead do not share one orange blob. */
export function shotPalette(raceId: string, variant?: SoldierVariant): ShotPalette {
  if (raceId === 'alien') {
    switch (variant) {
      case 'flyer':
        return { core: c(0.95, 0.7, 1), glow: c(0.72, 0.4, 1), smoke: c(0.45, 0.22, 0.7) }
      case 'antiAir':
        return { core: c(0.55, 1, 0.95), glow: c(0.2, 0.85, 0.9), smoke: c(0.1, 0.45, 0.55) }
      case 'siege':
        return { core: c(1, 0.95, 0.7), glow: c(1, 0.78, 0.25), smoke: c(0.75, 0.45, 0.1) }
      case 'heavyAir':
        return { core: c(1, 0.75, 0.95), glow: c(0.95, 0.35, 0.85), smoke: c(0.55, 0.12, 0.5) }
      case 'caster':
        return { core: c(0.55, 1, 0.85), glow: c(0.2, 0.85, 0.7), smoke: c(0.08, 0.45, 0.4) }
      case 'hero':
        return { core: c(1, 0.98, 0.85), glow: c(1, 0.85, 0.45), smoke: c(0.7, 0.5, 0.2) }
      case 'titan':
        return { core: c(0.7, 0.55, 1), glow: c(0.4, 0.25, 0.95), smoke: c(0.22, 0.1, 0.55) }
      default:
        return { core: c(0.85, 0.95, 1), glow: c(0.45, 0.75, 1), smoke: c(0.25, 0.4, 0.75) }
    }
  }
  if (raceId === 'bio') {
    switch (variant) {
      case 'flyer':
        return { core: c(0.85, 1, 0.35), glow: c(0.65, 0.9, 0.12), smoke: c(0.35, 0.5, 0.05) }
      case 'antiAir':
        return { core: c(1, 0.95, 0.35), glow: c(0.9, 0.75, 0.1), smoke: c(0.5, 0.4, 0.05) }
      case 'siege':
        return { core: c(0.75, 0.35, 1), glow: c(0.5, 0.12, 0.75), smoke: c(0.28, 0.05, 0.4) }
      case 'heavyAir':
        return { core: c(1, 0.45, 0.28), glow: c(0.85, 0.2, 0.12), smoke: c(0.45, 0.08, 0.05) }
      case 'caster':
        return { core: c(0.45, 1, 0.7), glow: c(0.2, 0.8, 0.5), smoke: c(0.08, 0.4, 0.25) }
      case 'hero':
        return { core: c(0.95, 1, 0.45), glow: c(0.75, 0.95, 0.15), smoke: c(0.4, 0.5, 0.05) }
      case 'titan':
        return { core: c(1, 0.55, 0.2), glow: c(0.85, 0.3, 0.08), smoke: c(0.45, 0.12, 0.04) }
      default:
        return { core: c(0.62, 0.95, 0.2), glow: c(0.45, 0.85, 0.12), smoke: c(0.22, 0.45, 0.06) }
    }
  }
  switch (variant) {
    case 'flyer':
      return { core: c(1, 0.95, 0.55), glow: c(1, 0.75, 0.2), smoke: c(0.85, 0.4, 0.08) }
    case 'antiAir':
      return { core: c(0.65, 0.95, 1), glow: c(0.25, 0.7, 1), smoke: c(0.1, 0.35, 0.7) }
    case 'siege':
      return { core: c(1, 0.4, 0.18), glow: c(0.95, 0.15, 0.05), smoke: c(0.45, 0.06, 0.04) }
    case 'heavyAir':
      return { core: c(1, 0.92, 0.75), glow: c(1, 0.7, 0.35), smoke: c(0.7, 0.3, 0.08) }
    case 'caster':
      return { core: c(0.75, 0.55, 1), glow: c(0.5, 0.28, 1), smoke: c(0.28, 0.1, 0.55) }
    case 'hero':
      return { core: c(1, 0.9, 0.45), glow: c(1, 0.7, 0.15), smoke: c(0.75, 0.4, 0.08) }
    case 'titan':
      return { core: c(1, 0.85, 0.55), glow: c(1, 0.5, 0.15), smoke: c(0.7, 0.22, 0.06) }
    case 'melee':
      return { core: c(1, 0.65, 0.3), glow: c(1, 0.35, 0.08), smoke: c(0.7, 0.18, 0.05) }
    default:
      return { core: c(1, 0.72, 0.22), glow: c(1, 0.42, 0.08), smoke: c(0.85, 0.25, 0.08) }
  }
}

const STYLE_BY_RACE: Record<string, ProjectileStyle> = {
  human: 'fireball',
  alien: 'lightning',
  bio: 'acid'
}

type ShotProfile = {
  count: number
  spread: number
  scale: number
  speed: number
  arc: number
}

function shotProfile(variant?: SoldierVariant): ShotProfile {
  switch (variant) {
    case 'flyer':
      return { count: 2, spread: 0.32, scale: 0.55, speed: 1.45, arc: 0 }
    case 'titan':
      return { count: 2, spread: 0.4, scale: 0.65, speed: 1.35, arc: 0 }
    case 'heavyAir':
      return { count: 2, spread: 0.7, scale: 1.9, speed: 0.48, arc: 0.2 }
    case 'siege':
      return { count: 1, spread: 0, scale: 1.6, speed: 0.4, arc: 1.15 }
    case 'antiAir':
      return { count: 1, spread: 0, scale: 0.7, speed: 1.35, arc: 0 }
    case 'caster':
      return { count: 1, spread: 0, scale: 1.3, speed: 0.85, arc: 0.25 }
    case 'hero':
      return { count: 2, spread: 0.28, scale: 0.95, speed: 1.1, arc: 0 }
    default:
      return { count: 1, spread: 0, scale: 1, speed: 1, arc: 0 }
  }
}

export function shotImpactScale(variant?: SoldierVariant): number {
  switch (variant) {
    case 'heavyAir':
      return 2.3
    case 'siege':
      return 2.5
    case 'titan':
      return 1.4
    case 'caster':
      return 1.6
    case 'hero':
      return 1.35
    case 'antiAir':
      return 1.25
    case 'flyer':
      return 0.7
    default:
      return 1
  }
}

/**
 * Fires a shot from muzzle to target. Style follows the shooter's race;
 * pass `style` to override (e.g. the human caster's Chain Lightning).
 * `variant` changes count, size, and speed: dual MGs, heavy cannons, arcing shells.
 */
export function fireProjectile(from: Vector3, to: Vector3, team: Team, style?: ProjectileStyle, variant?: SoldierVariant): void {
  const raceId = getRace(team).id
  const resolved = style ?? STYLE_BY_RACE[raceId] ?? 'fireball'
  const palette = shotPalette(raceId, variant)
  const profile = shotProfile(variant)
  const start = Vector3.create(from.x, from.y + MUZZLE_HEIGHT, from.z)
  const end = Vector3.create(to.x, to.y + IMPACT_HEIGHT, to.z)
  const lanes = offsetLanes(start, end, profile.count, profile.spread)

  for (const lane of lanes) {
    if (resolved === 'lightning') strikeLightning(lane.from, lane.to, profile.scale, palette)
    else if (resolved === 'acid') lobAcid(lane.from, lane.to, profile.scale, profile.speed, profile.arc, palette)
    else launchFireball(lane.from, lane.to, profile.scale, profile.speed, profile.arc, palette)
  }
}

function offsetLanes(from: Vector3, to: Vector3, count: number, spread: number): { from: Vector3; to: Vector3 }[] {
  if (count <= 1 || spread <= 0) return [{ from, to }]
  const dx = to.x - from.x
  const dz = to.z - from.z
  const length = Math.hypot(dx, dz) || 1
  const px = (-dz / length) * spread
  const pz = (dx / length) * spread
  const lanes: { from: Vector3; to: Vector3 }[] = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1
    lanes.push({
      from: Vector3.create(from.x + px * t, from.y, from.z + pz * t),
      to: Vector3.create(to.x + px * t, to.y, to.z + pz * t)
    })
  }
  return lanes
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

function hide(entity: Entity): void {
  VisibilityComponent.createOrReplace(entity, { visible: false })
}

function show(entity: Entity): void {
  VisibilityComponent.createOrReplace(entity, { visible: true })
}

function glowMaterial(entity: Entity, color: Color4, emissive: Color4, intensity: number, alpha = 1): void {
  Material.setPbrMaterial(entity, {
    albedoColor: Color4.create(color.r, color.g, color.b, alpha),
    emissiveColor: emissive,
    emissiveIntensity: intensity,
    metallic: 0,
    roughness: 0.4,
    castShadows: false
  })
}

/** Orientation for a +Z-long box laid along `direction` (already normalized-ish). */
function lookAlong(direction: Vector3, length: number): Quaternion {
  const yaw = (Math.atan2(direction.x, direction.z) * 180) / Math.PI
  const pitch = (-Math.asin(Math.max(-1, Math.min(1, direction.y / Math.max(0.0001, length)))) * 180) / Math.PI
  return Quaternion.fromEulerDegrees(pitch, yaw, 0)
}

// ---------------------------------------------------------------------------
// Spark pool: tiny ballistic particles with gravity, shared by fireball bursts
// and acid splashes.
// ---------------------------------------------------------------------------

type Spark = {
  entity: Entity
  velocity: Vector3
  position: Vector3
  age: number
  duration: number
  baseScale: number
  active: boolean
}

const sparks: Spark[] = []
const MAX_SPARKS = 48
const SPARK_GRAVITY = -10

function burstSparks(origin: Vector3, count: number, color: Color4, emissive: Color4, speed: number, upBias: number): void {
  for (let i = 0; i < count; i++) {
    const spark = obtainFromPool(sparks, MAX_SPARKS, createSpark)
    if (!spark) break
    const angle = Math.random() * Math.PI * 2
    const lateral = speed * (0.4 + Math.random() * 0.6)
    spark.velocity = Vector3.create(Math.cos(angle) * lateral, upBias * (0.6 + Math.random() * 0.8), Math.sin(angle) * lateral)
    spark.position = Vector3.create(origin.x, origin.y, origin.z)
    spark.age = 0
    spark.duration = 0.35 + Math.random() * 0.25
    spark.baseScale = 0.1 + Math.random() * 0.08
    spark.active = true
    glowMaterial(spark.entity, color, emissive, 3.5)
    Transform.getMutable(spark.entity).position = spark.position
    show(spark.entity)
  }
}

function createSpark(): Spark {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(0, -10, 0), scale: Vector3.create(0.1, 0.1, 0.1) })
  MeshRenderer.setSphere(entity)
  VisibilityComponent.create(entity, { visible: false })
  return { entity, velocity: Vector3.Zero(), position: Vector3.Zero(), age: 0, duration: 0.4, baseScale: 0.1, active: false }
}

function updateSparks(dt: number): void {
  for (const spark of sparks) {
    if (!spark.active) continue
    spark.age += dt
    if (spark.age >= spark.duration) {
      spark.active = false
      hide(spark.entity)
      continue
    }
    spark.velocity = Vector3.create(spark.velocity.x, spark.velocity.y + SPARK_GRAVITY * dt, spark.velocity.z)
    spark.position = Vector3.create(
      spark.position.x + spark.velocity.x * dt,
      spark.position.y + spark.velocity.y * dt,
      spark.position.z + spark.velocity.z * dt
    )
    const fade = 1 - spark.age / spark.duration
    const transform = Transform.getMutable(spark.entity)
    transform.position = spark.position
    const scale = spark.baseScale * fade
    transform.scale = Vector3.create(scale, scale, scale)
  }
}

// ---------------------------------------------------------------------------
// Fireballs (human): straight, fast, blazing head + ember tail.
// ---------------------------------------------------------------------------

const FIREBALL_SPEED = 18
const TRAIL_COUNT = 4
/** Trail pieces lag this fraction of total flight behind the head, per index. */
const TRAIL_LAG = 0.08

type Fireball = {
  head: Entity
  trail: Entity[]
  from: Vector3
  to: Vector3
  progress: number
  duration: number
  scale: number
  arcHeight: number
  palette: ShotPalette
  active: boolean
}

const fireballs: Fireball[] = []
const MAX_FIREBALLS = 32

function launchFireball(from: Vector3, to: Vector3, scale = 1, speedMul = 1, arc = 0, palette: ShotPalette): void {
  const ball = obtainFromPool(fireballs, MAX_FIREBALLS, createFireball)
  if (!ball) return
  const distance = Vector3.distance(from, to)
  ball.from = from
  ball.to = to
  ball.progress = 0
  ball.duration = Math.max(0.08, distance / (FIREBALL_SPEED * speedMul))
  ball.scale = scale
  ball.arcHeight = arc * (0.7 + distance * 0.12)
  ball.palette = palette
  ball.active = true
  paintFireball(ball)

  const headSize = 0.3 * scale
  Transform.getMutable(ball.head).position = from
  Transform.getMutable(ball.head).scale = Vector3.create(headSize, headSize, headSize)
  show(ball.head)
  for (let i = 0; i < ball.trail.length; i++) {
    const size = (0.2 - i * 0.035) * scale
    Transform.getMutable(ball.trail[i]).position = from
    Transform.getMutable(ball.trail[i]).scale = Vector3.create(size, size, size)
    show(ball.trail[i])
  }
}

function paintFireball(ball: Fireball): void {
  glowMaterial(ball.head, ball.palette.core, ball.palette.glow, 4)
  for (let i = 0; i < ball.trail.length; i++) {
    const t = (i + 1) / (TRAIL_COUNT + 1)
    const color = Color4.create(
      ball.palette.glow.r + (ball.palette.smoke.r - ball.palette.glow.r) * t,
      ball.palette.glow.g + (ball.palette.smoke.g - ball.palette.glow.g) * t,
      ball.palette.glow.b + (ball.palette.smoke.b - ball.palette.glow.b) * t,
      1
    )
    glowMaterial(ball.trail[i], color, color, 3 * (1 - t), 0.85 - t * 0.45)
  }
}

function createFireball(): Fireball {
  const head = engine.addEntity()
  Transform.create(head, { position: Vector3.create(0, -10, 0), scale: Vector3.create(0.3, 0.3, 0.3) })
  MeshRenderer.setSphere(head)
  VisibilityComponent.create(head, { visible: false })

  const trail: Entity[] = []
  for (let i = 0; i < TRAIL_COUNT; i++) {
    const piece = engine.addEntity()
    const size = 0.2 - i * 0.035
    Transform.create(piece, { position: Vector3.create(0, -10, 0), scale: Vector3.create(size, size, size) })
    MeshRenderer.setSphere(piece)
    VisibilityComponent.create(piece, { visible: false })
    trail.push(piece)
  }

  return {
    head,
    trail,
    from: Vector3.Zero(),
    to: Vector3.Zero(),
    progress: 0,
    duration: 0.1,
    scale: 1,
    arcHeight: 0,
    palette: shotPalette('human'),
    active: false
  }
}

function fireballPoint(ball: Fireball, t: number): Vector3 {
  const point = Vector3.lerp(ball.from, ball.to, t)
  if (ball.arcHeight > 0) point.y += ball.arcHeight * 4 * t * (1 - t)
  return point
}

function updateFireballs(dt: number): void {
  for (const ball of fireballs) {
    if (!ball.active) continue

    ball.progress += dt / ball.duration
    if (ball.progress >= 1) {
      ball.active = false
      hide(ball.head)
      for (const piece of ball.trail) hide(piece)
      // Arrival: embers spray off the impact.
      burstSparks(ball.to, Math.round(5 * Math.max(1, ball.scale)), ball.palette.core, ball.palette.glow, 2.2 * ball.scale, 2.6)
      if (ball.scale >= 1.3) spawnBlastRing(ball.to, ball.palette.glow, 0.7 * ball.scale)
      continue
    }

    Transform.getMutable(ball.head).position = fireballPoint(ball, ball.progress)
    for (let i = 0; i < ball.trail.length; i++) {
      const lag = Math.max(0, ball.progress - (i + 1) * TRAIL_LAG)
      Transform.getMutable(ball.trail[i]).position = fireballPoint(ball, lag)
    }
  }
}

// ---------------------------------------------------------------------------
// Lightning (alien): instant jagged strike that re-jolts as it fades.
// ---------------------------------------------------------------------------

const SEGMENT_COUNT = 7
const BRANCH_COUNT = 2
const STRIKE_SECONDS = 0.26
const REJOLT_SECONDS = 0.07

type Lightning = {
  segments: Entity[]
  branches: Entity[]
  from: Vector3
  to: Vector3
  age: number
  rejoltTimer: number
  scale: number
  palette: ShotPalette
  active: boolean
}

const strikes: Lightning[] = []
const MAX_STRIKES = 16

function strikeLightning(from: Vector3, to: Vector3, scale = 1, palette: ShotPalette): void {
  const strike = obtainFromPool(strikes, MAX_STRIKES, createLightning)
  if (!strike) return
  strike.from = from
  strike.to = to
  strike.age = 0
  strike.rejoltTimer = 0
  strike.scale = scale
  strike.palette = palette
  strike.active = true
  for (const segment of strike.segments) show(segment)
  for (const branch of strike.branches) show(branch)
  jolt(strike, 1)
  burstSparks(to, Math.round(4 * Math.max(1, scale)), palette.core, palette.glow, 1.8 * scale, 1.6)
}

function createLightning(): Lightning {
  const make = () => {
    const entity = engine.addEntity()
    Transform.create(entity, { position: Vector3.create(0, -10, 0), scale: Vector3.create(0.06, 0.06, 1) })
    MeshRenderer.setBox(entity)
    glowMaterial(entity, Color4.create(0.85, 0.95, 1, 1), Color4.create(0.45, 0.75, 1, 1), 5)
    VisibilityComponent.create(entity, { visible: false })
    return entity
  }
  const segments: Entity[] = []
  for (let i = 0; i < SEGMENT_COUNT; i++) segments.push(make())
  const branches: Entity[] = []
  for (let i = 0; i < BRANCH_COUNT; i++) branches.push(make())
  return { segments, branches, from: Vector3.Zero(), to: Vector3.Zero(), age: 0, rejoltTimer: 0, scale: 1, palette: shotPalette('alien'), active: false }
}

/** Re-randomizes the arc path: joints pinned at both ends, jitter peaking mid-arc. */
function jolt(strike: Lightning, fade: number): void {
  const direction = Vector3.subtract(strike.to, strike.from)
  const length = Math.max(0.0001, Vector3.length(direction))
  // Perpendicular basis for jitter offsets.
  const dir = Vector3.scale(direction, 1 / length)
  const up = Math.abs(dir.y) > 0.9 ? Vector3.create(1, 0, 0) : Vector3.create(0, 1, 0)
  const u = Vector3.normalize(Vector3.cross(dir, up))
  const v = Vector3.cross(dir, u)
  const amplitude = Math.min(0.7, length * 0.14)

  const joints: Vector3[] = [strike.from]
  for (let k = 1; k < SEGMENT_COUNT; k++) {
    const t = k / SEGMENT_COUNT
    const wave = Math.sin(Math.PI * t) * amplitude
    const base = Vector3.lerp(strike.from, strike.to, t)
    const offsetU = (Math.random() * 2 - 1) * wave
    const offsetV = (Math.random() * 2 - 1) * wave
    joints.push(Vector3.create(base.x + u.x * offsetU + v.x * offsetV, base.y + u.y * offsetU + v.y * offsetV, base.z + u.z * offsetU + v.z * offsetV))
  }
  joints.push(strike.to)

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    placeSegment(strike.segments[i], joints[i], joints[i + 1], 0.06 * fade * strike.scale)
    glowMaterial(strike.segments[i], strike.palette.core, strike.palette.glow, 5 * fade, fade)
  }

  // Stray forks off random mid joints, flying outward and slightly down.
  for (const branch of strike.branches) {
    const joint = joints[1 + Math.floor(Math.random() * (SEGMENT_COUNT - 1))]
    const tip = Vector3.create(joint.x + (Math.random() * 2 - 1) * 1.1, joint.y - 0.3 - Math.random() * 0.5, joint.z + (Math.random() * 2 - 1) * 1.1)
    placeSegment(branch, joint, tip, 0.04 * fade * strike.scale)
    glowMaterial(branch, strike.palette.core, strike.palette.glow, 4 * fade, fade * 0.8)
  }
}

function placeSegment(entity: Entity, a: Vector3, b: Vector3, thickness: number): void {
  const delta = Vector3.subtract(b, a)
  const length = Vector3.length(delta)
  const transform = Transform.getMutable(entity)
  transform.position = Vector3.create((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  transform.scale = Vector3.create(thickness, thickness, length)
  transform.rotation = lookAlong(delta, length)
}

function updateLightning(dt: number): void {
  for (const strike of strikes) {
    if (!strike.active) continue

    strike.age += dt
    if (strike.age >= STRIKE_SECONDS) {
      strike.active = false
      for (const segment of strike.segments) hide(segment)
      for (const branch of strike.branches) hide(branch)
      continue
    }

    strike.rejoltTimer += dt
    if (strike.rejoltTimer >= REJOLT_SECONDS) {
      strike.rejoltTimer = 0
      jolt(strike, 1 - strike.age / STRIKE_SECONDS)
    }
  }
}

// ---------------------------------------------------------------------------
// Acid globs (bio): lobbed on a gravity arc, dripping, splashing on impact.
// ---------------------------------------------------------------------------

const ACID_SPEED = 13
const DRIP_COUNT = 3
const DRIP_LAG = 0.09

type AcidGlob = {
  head: Entity
  drips: Entity[]
  from: Vector3
  to: Vector3
  progress: number
  duration: number
  arcHeight: number
  scale: number
  palette: ShotPalette
  active: boolean
}

const globs: AcidGlob[] = []
const MAX_GLOBS = 32

function lobAcid(from: Vector3, to: Vector3, scale = 1, speedMul = 1, arc = 1, palette: ShotPalette): void {
  const glob = obtainFromPool(globs, MAX_GLOBS, createGlob)
  if (!glob) return
  const distance = Vector3.distance(from, to)
  glob.from = from
  glob.to = to
  glob.progress = 0
  glob.duration = Math.max(0.12, distance / (ACID_SPEED * speedMul))
  glob.arcHeight = (0.9 + distance * 0.16) * Math.max(0.35, arc)
  glob.scale = scale
  glob.palette = palette
  glob.active = true
  glowMaterial(glob.head, palette.core, palette.glow, 2.6)
  for (let i = 0; i < glob.drips.length; i++) {
    glowMaterial(glob.drips[i], palette.core, palette.glow, 2, 0.8 - i * 0.18)
  }

  const headSize = 0.3 * scale
  Transform.getMutable(glob.head).position = from
  Transform.getMutable(glob.head).scale = Vector3.create(headSize, headSize * 1.13, headSize)
  show(glob.head)
  for (let i = 0; i < glob.drips.length; i++) {
    const size = (0.13 - i * 0.03) * scale
    Transform.getMutable(glob.drips[i]).position = from
    Transform.getMutable(glob.drips[i]).scale = Vector3.create(size, size * 1.4, size)
    show(glob.drips[i])
  }
}

function createGlob(): AcidGlob {
  const head = engine.addEntity()
  Transform.create(head, { position: Vector3.create(0, -10, 0), scale: Vector3.create(0.3, 0.34, 0.3) })
  MeshRenderer.setSphere(head)
  VisibilityComponent.create(head, { visible: false })

  const drips: Entity[] = []
  for (let i = 0; i < DRIP_COUNT; i++) {
    const drip = engine.addEntity()
    const size = 0.13 - i * 0.03
    Transform.create(drip, { position: Vector3.create(0, -10, 0), scale: Vector3.create(size, size * 1.4, size) })
    MeshRenderer.setSphere(drip)
    VisibilityComponent.create(drip, { visible: false })
    drips.push(drip)
  }

  return { head, drips, from: Vector3.Zero(), to: Vector3.Zero(), progress: 0, duration: 0.2, arcHeight: 1, scale: 1, palette: shotPalette('bio'), active: false }
}

/** Point on the lob arc: straight lerp plus a parabolic vertical bulge. */
function arcPoint(glob: AcidGlob, t: number): Vector3 {
  const point = Vector3.lerp(glob.from, glob.to, t)
  point.y += glob.arcHeight * 4 * t * (1 - t)
  return point
}

function updateAcid(dt: number): void {
  for (const glob of globs) {
    if (!glob.active) continue

    glob.progress += dt / glob.duration
    if (glob.progress >= 1) {
      glob.active = false
      hide(glob.head)
      for (const drip of glob.drips) hide(drip)
      // Splat: droplets fly, a caustic ring spreads on the ground.
      burstSparks(glob.to, Math.round(6 * Math.max(1, glob.scale)), glob.palette.core, glob.palette.glow, 2.6 * glob.scale, 2.2)
      spawnBlastRing(glob.to, glob.palette.glow, 0.9 * glob.scale)
      continue
    }

    Transform.getMutable(glob.head).position = arcPoint(glob, glob.progress)
    for (let i = 0; i < glob.drips.length; i++) {
      const lag = Math.max(0, glob.progress - (i + 1) * DRIP_LAG)
      Transform.getMutable(glob.drips[i]).position = arcPoint(glob, lag)
    }
  }
}

// ---------------------------------------------------------------------------
// Pooling + system.
// ---------------------------------------------------------------------------

/** Reuses an idle entry, grows the pool up to `max`, else drops the shot (invisible in a fight that big). */
function obtainFromPool<T extends { active: boolean }>(pool: T[], max: number, create: () => T): T | undefined {
  const idle = pool.find((candidate) => !candidate.active)
  if (idle) return idle
  if (pool.length >= max) return undefined
  const fresh = create()
  pool.push(fresh)
  return fresh
}

function projectileSystem(dt: number): void {
  updateFireballs(dt)
  updateLightning(dt)
  updateAcid(dt)
  updateSparks(dt)
}

function park(entity: Entity): void {
  hide(entity)
  Transform.getMutable(entity).position = Vector3.create(0, -10, 0)
}

/** Match teardown: hide every in-flight shot so the next mission starts clean. */
export function clearAllProjectiles(): void {
  for (const ball of fireballs) {
    ball.active = false
    park(ball.head)
    for (const piece of ball.trail) park(piece)
  }
  for (const strike of strikes) {
    strike.active = false
    for (const segment of strike.segments) park(segment)
    for (const branch of strike.branches) park(branch)
  }
  for (const glob of globs) {
    glob.active = false
    park(glob.head)
    for (const drip of glob.drips) park(drip)
  }
  for (const spark of sparks) {
    spark.active = false
    park(spark.entity)
  }
}

engine.addSystem(projectileSystem)
