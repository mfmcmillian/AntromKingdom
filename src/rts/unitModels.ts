import { Entity, Material, MeshRenderer, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { isPlayerAlly } from './state'
import { RaceId, ResourceKind, Team } from './types'

// Procedural units for all three races, built from primitives so each race gets a
// distinct silhouette without GLBs or rigged animations. A small system drives
// per-state motion (hover bob, tilt, spinners, attack lunges) to mirror the
// animation clips the game logic requests (idle / walk / talk / attack / impact).

export type UnitRole = 'worker' | 'melee' | 'ranged' | 'caster' | 'flyer' | 'titan' | 'hero' | 'healer' | 'siege'

type UnitAnimState = 'idle' | 'walk' | 'talk' | 'attack' | 'impact'

type MotionProfile = {
  amplitude: number
  speed: number
  tilt: number
  spin: number
  lunge: number
}

/**
 * Procedural particle effects animated by the unit system (transform-only, so
 * they cost nothing in per-frame material writes):
 *   orbit - circles the anchor with a gentle vertical wobble.
 *   ember - rises from the anchor while shrinking to nothing, then loops.
 *   pulse - breathes its XZ scale and slowly rotates in place (ground rings).
 *   flap  - oscillating roll around Z for wing pivots (radius = amplitude in
 *           degrees, height = rest angle; signs mirror the two wings).
 */
type UnitFx = {
  entity: Entity
  mode: 'orbit' | 'ember' | 'pulse' | 'flap'
  anchor: Vector3
  radius: number
  height: number
  /** Cycles (ember) or radians (orbit) or pulses per second. */
  speed: number
  phase: number
  size: number
}

interface UnitRig {
  bodyRoot: Entity
  spinner?: Entity
  spinAxis: 'y' | 'z'
  /** Constant hover offset for flyers; the bob animation rides on top of it. */
  baseHeight: number
  mineralCargo: Entity[]
  gasCargo: Entity[]
  cargoKind?: ResourceKind
  fogHidden: boolean
  parts: Entity[]
  /** Upgrade rank pips floating above the unit; rebuilt whenever research completes. */
  insignia: Entity[]
  /** Animated particle effects (hero auras, embers, orbiting motes). */
  fx: UnitFx[]
  /** Limb pivots keyframed over the attack cycle (step-then-swing choreography). */
  attackTracks?: AttackTrack[]
  /** When set, replaces the profile's body tilt (showcase turntable wants him upright). */
  tiltOverride?: number
  /** Ground rings/discs under hero feet - hidden on the map, shown as a showcase pedestal. */
  groundFx: Entity[]
  groundFxVisible: boolean
  /** Siege units: the deployed-mode cannon group, grown from scale 0 while digging in. */
  siegeCannon?: Entity
  state: UnitAnimState
  time: number
  profiles: Record<UnitAnimState, MotionProfile>
}

/**
 * One choreographed limb: a pivot entity plus keyframes of
 * [phase, xDeg, yDeg, zDeg]. Phase runs 0..1 over the attack cycle and the
 * sampled angles are added on top of the pivot's rest orientation. Outside
 * the attack state the pivot sits at rest.
 */
type AttackTrack = {
  entity: Entity
  rest: Vector3
  keys: [number, number, number, number][]
}

const rigs = new Map<Entity, UnitRig>()

const MINERAL_CARGO_BLUE = Color4.create(0.45, 0.65, 0.95, 1)
const MINERAL_CARGO_GLOW = Color4.create(0.45, 0.7, 1, 1)
const GAS_BARREL_GREEN = Color4.create(0.2, 0.55, 0.28, 1)
const GAS_BARREL_GLOW = Color4.create(0.35, 0.95, 0.45, 1)
const METAL_DARK = Color4.create(0.16, 0.17, 0.2, 1)
const METAL_LIGHT = Color4.create(0.42, 0.44, 0.5, 1)
const DRILL_STEEL = Color4.create(0.55, 0.5, 0.42, 1)

// Race palettes: hull is the race identity, the team glow marks friend or foe.
const HUMAN_HULL = Color4.create(0.28, 0.36, 0.48, 1)
const ALIEN_GOLD = Color4.create(0.62, 0.5, 0.22, 1)
const ALIEN_DARK = Color4.create(0.24, 0.16, 0.34, 1)
const ALIEN_CRYSTAL = Color4.create(0.75, 0.55, 1, 1)
const BIO_FLESH = Color4.create(0.48, 0.18, 0.16, 1)
const BIO_CARAPACE = Color4.create(0.22, 0.1, 0.13, 1)
const BIO_BONE = Color4.create(0.75, 0.68, 0.55, 1)

// Hero regalia palette, shared across the champion models.
const HERO_GOLD = Color4.create(0.92, 0.76, 0.32, 1)
const CAPE_CRIMSON = Color4.create(0.4, 0.07, 0.1, 1)
const BLADE_STEEL = Color4.create(0.78, 0.84, 0.92, 1)

// Player is cyan, allied computers glow friendly gold, and each hostile
// computer gets its own hue so mixed armies read at a glance.
const TEAM_GLOW: Record<Team, Color4> = {
  player: Color4.create(0.2, 0.85, 0.95, 1),
  enemy1: Color4.create(1, 0.3, 0.2, 1),
  enemy2: Color4.create(1, 0.6, 0.12, 1),
  enemy3: Color4.create(0.82, 0.3, 0.95, 1)
}
const ALLY_GLOW = Color4.create(0.95, 0.85, 0.3, 1)

function getTeamGlow(team: Team): Color4 {
  return isPlayerAlly(team) ? ALLY_GLOW : TEAM_GLOW[team]
}

/** Ownership color for anything outside the unit builder (building beacons, markers). */
export function getTeamColor(team: Team): Color4 {
  return getTeamGlow(team)
}

const STILL: MotionProfile = { amplitude: 0.03, speed: 2, tilt: 0, spin: 0, lunge: 0 }

type PartOptions = {
  emissive?: Color4
  emissiveIntensity?: number
  cylinder?: boolean
  cone?: boolean
  sphere?: boolean
  rotation?: Quaternion
  metallic?: number
  roughness?: number
}

type PartAdder = (position: Vector3, scale: Vector3, color: Color4, options?: PartOptions) => Entity

/** Like addPart but parented to an arbitrary pivot/carrier instead of the body root. */
function addChildPart(rig: UnitRig, parent: Entity, position: Vector3, scale: Vector3, color: Color4, options: PartOptions = {}): Entity {
  const part = engine.addEntity()
  Transform.create(part, { parent, position, scale, rotation: options.rotation ?? Quaternion.Identity() })
  if (options.cone) MeshRenderer.setCylinder(part, 0.5, 0.03)
  else if (options.cylinder) MeshRenderer.setCylinder(part)
  else if (options.sphere) MeshRenderer.setSphere(part)
  else MeshRenderer.setBox(part)
  applyPartMaterial(part, color, options)
  rig.parts.push(part)
  return part
}

/** Shared PBR setup for every unit part. */
function applyPartMaterial(part: Entity, color: Color4, options: PartOptions): void {
  Material.setPbrMaterial(part, {
    albedoColor: color,
    emissiveColor: options.emissive ?? Color4.Black(),
    emissiveIntensity: options.emissiveIntensity ?? 0,
    metallic: options.metallic ?? 0.6,
    roughness: options.roughness ?? 0.4,
    castShadows: false
  })
}

export function buildUnitModel(root: Entity, race: RaceId, role: UnitRole, team: Team): void {
  const bodyRoot = engine.addEntity()
  Transform.create(bodyRoot, { parent: root })

  const rig: UnitRig = {
    bodyRoot,
    spinAxis: 'z',
    baseHeight: 0,
    mineralCargo: [],
    gasCargo: [],
    fogHidden: false,
    parts: [bodyRoot],
    insignia: [],
    fx: [],
    groundFx: [],
    groundFxVisible: false,
    state: 'idle',
    time: Math.random() * 10,
    profiles: { idle: STILL, walk: STILL, talk: STILL, attack: STILL, impact: STILL }
  }

  const addPart: PartAdder = (position, scale, color, options = {}) => {
    const part = engine.addEntity()
    Transform.create(part, {
      parent: bodyRoot,
      position,
      scale,
      rotation: options.rotation ?? Quaternion.Identity()
    })
    if (options.cone) MeshRenderer.setCylinder(part, 0.5, 0.03)
    else if (options.cylinder) MeshRenderer.setCylinder(part)
    else if (options.sphere) MeshRenderer.setSphere(part)
    else MeshRenderer.setBox(part)
    applyPartMaterial(part, color, options)
    rig.parts.push(part)
    return part
  }

  const glow = getTeamGlow(team)

  if (race === 'human') {
    if (role === 'worker') buildHumanMiner(rig, addPart, glow)
    else if (role === 'melee') buildHumanVanguard(rig, addPart, glow)
    else if (role === 'ranged') buildHumanGunner(rig, addPart, glow)
    else if (role === 'caster') buildHumanStormcaller(rig, addPart, glow)
    else if (role === 'flyer') buildHumanRaptor(rig, addPart, glow)
    else if (role === 'hero') buildHumanHero(rig, addPart, glow)
    else if (role === 'healer') buildHumanMedic(rig, addPart, glow)
    else if (role === 'siege') buildHumanThunderhead(rig, addPart, glow)
    else buildHumanColossus(rig, addPart, glow)
  } else if (race === 'alien') {
    if (role === 'worker') buildAlienProbe(rig, addPart, glow)
    else if (role === 'melee') buildAlienStalker(rig, addPart, glow)
    else if (role === 'ranged') buildAlienDisruptor(rig, addPart, glow)
    else if (role === 'caster') buildAlienOracle(rig, addPart, glow)
    else if (role === 'flyer') buildAlienTempest(rig, addPart, glow)
    else if (role === 'hero') buildAlienHero(rig, addPart, glow)
    else if (role === 'healer') buildAlienLightmender(rig, addPart, glow)
    else if (role === 'siege') buildAlienSunlance(rig, addPart, glow)
    else buildAlienAvatar(rig, addPart, glow)
  } else {
    if (role === 'worker') buildBioDrone(rig, addPart, glow)
    else if (role === 'melee') buildBioRavager(rig, addPart, glow)
    else if (role === 'ranged') buildBioSpitter(rig, addPart, glow)
    else if (role === 'caster') buildBioPlagueWeaver(rig, addPart, glow)
    else if (role === 'flyer') buildBioShrieker(rig, addPart, glow)
    else if (role === 'hero') buildBioHero(rig, addPart, glow)
    else if (role === 'healer') buildBioBroodtender(rig, addPart, glow)
    else if (role === 'siege') buildBioAcidmaw(rig, addPart, glow)
    else buildBioBehemoth(rig, addPart, glow)
  }

  if (role === 'worker') addWorkerCargo(rig, addPart)

  // Always-on ownership disc underfoot: race decides the silhouette, but this
  // is what tells armies apart when two factions field the same race.
  const ringSize = TEAM_RING_SIZE[role]
  addPart(Vector3.create(0, 0.02, 0), Vector3.create(ringSize, 0.015, ringSize), Color4.create(glow.r, glow.g, glow.b, 0.32), {
    cylinder: true,
    emissive: glow,
    emissiveIntensity: 1.5
  })

  // Ground rings start hidden; only the showcase pedestal turns them on.
  applyGroundFxVisibility(rig)
  rigs.set(root, rig)
}

// Team disc diameter per role, scaled to each silhouette's footprint.
const TEAM_RING_SIZE: Record<UnitRole, number> = {
  worker: 0.95,
  melee: 1.15,
  ranged: 1.15,
  healer: 1.15,
  caster: 1.25,
  flyer: 1.25,
  siege: 1.6,
  titan: 1.9,
  hero: 2.2
}

function applyGroundFxVisibility(rig: UnitRig): void {
  for (const entity of rig.groundFx) {
    VisibilityComponent.createOrReplace(entity, { visible: rig.groundFxVisible && !rig.fogHidden })
  }
}

/** Shows/hides the pulsing ground ring under hero models (showcase pedestal only). */
export function setUnitGroundFxVisible(root: Entity, visible: boolean): void {
  const rig = rigs.get(root)
  if (!rig) return
  rig.groundFxVisible = visible
  applyGroundFxVisibility(rig)
}

/** Boxy mining robot with a hover base and a spinning drill arm. */
function buildHumanMiner(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  addPart(Vector3.create(0, 0.16, 0), Vector3.create(0.46, 0.05, 0.46), glow, { cylinder: true, emissive: glow, emissiveIntensity: 2.2 })
  addPart(Vector3.create(0, 0.32, 0), Vector3.create(0.56, 0.2, 0.56), METAL_DARK, { cylinder: true })

  addPart(Vector3.create(0, 0.78, 0), Vector3.create(0.52, 0.55, 0.38), HUMAN_HULL)
  addPart(Vector3.create(0, 0.84, 0.18), Vector3.create(0.14, 0.14, 0.05), glow, { emissive: glow, emissiveIntensity: 2 })

  addPart(Vector3.create(0, 1.22, 0), Vector3.create(0.36, 0.26, 0.32), METAL_LIGHT)
  addPart(Vector3.create(0, 1.24, 0.15), Vector3.create(0.26, 0.07, 0.05), glow, { emissive: glow, emissiveIntensity: 2.6 })
  addPart(Vector3.create(0.12, 1.46, 0), Vector3.create(0.03, 0.2, 0.03), METAL_DARK)
  addPart(Vector3.create(0.12, 1.58, 0), Vector3.create(0.07, 0.07, 0.07), glow, { cylinder: true, emissive: glow, emissiveIntensity: 2.6 })

  addPart(Vector3.create(-0.34, 0.82, 0), Vector3.create(0.13, 0.42, 0.15), METAL_DARK)

  addPart(Vector3.create(0.34, 0.9, 0), Vector3.create(0.16, 0.22, 0.18), METAL_DARK)
  addPart(Vector3.create(0.34, 0.72, 0.1), Vector3.create(0.13, 0.13, 0.3), METAL_LIGHT)
  rig.spinner = addPart(Vector3.create(0.34, 0.72, 0.28), Vector3.create(0.18, 0.18, 0.08), HUMAN_HULL, {
    emissive: glow,
    emissiveIntensity: 0.8
  })
  addPart(Vector3.create(0.34, 0.72, 0.5), Vector3.create(0.12, 0.34, 0.12), DRILL_STEEL, {
    cone: true,
    rotation: Quaternion.fromEulerDegrees(90, 0, 0)
  })

  rig.spinAxis = 'z'
  rig.profiles = {
    idle: { amplitude: 0.03, speed: 2, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.06, speed: 7, tilt: 6, spin: 90, lunge: 0 },
    talk: { amplitude: 0.02, speed: 16, tilt: 14, spin: 720, lunge: 0 },
    attack: { amplitude: 0.02, speed: 16, tilt: 14, spin: 720, lunge: 0 },
    impact: { amplitude: 0.05, speed: 20, tilt: -6, spin: 0, lunge: 0 }
  }
}

/** Shielded melee robot: a tower shield on the left and a glowing energy blade on the right. */
function buildHumanVanguard(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  addPart(Vector3.create(0, 0.16, 0), Vector3.create(0.54, 0.05, 0.54), glow, { cylinder: true, emissive: glow, emissiveIntensity: 2 })
  addPart(Vector3.create(0, 0.34, 0), Vector3.create(0.62, 0.24, 0.62), METAL_DARK, { cylinder: true })

  // Extra-heavy torso and helm.
  addPart(Vector3.create(0, 0.84, 0), Vector3.create(0.64, 0.56, 0.46), HUMAN_HULL)
  addPart(Vector3.create(0, 0.94, 0.22), Vector3.create(0.16, 0.09, 0.05), glow, { emissive: glow, emissiveIntensity: 2.2 })
  addPart(Vector3.create(0, 1.32, 0), Vector3.create(0.32, 0.26, 0.32), METAL_DARK)
  addPart(Vector3.create(0, 1.34, 0.15), Vector3.create(0.24, 0.08, 0.05), glow, { emissive: glow, emissiveIntensity: 2.8 })
  addPart(Vector3.create(0, 1.5, 0), Vector3.create(0.1, 0.12, 0.26), METAL_LIGHT)

  // Tower shield on the left arm with a glowing trim line.
  addPart(Vector3.create(-0.46, 0.82, 0.12), Vector3.create(0.08, 0.72, 0.5), METAL_LIGHT, { rotation: Quaternion.fromEulerDegrees(0, 8, 0) })
  addPart(Vector3.create(-0.5, 0.82, 0.12), Vector3.create(0.02, 0.6, 0.08), glow, {
    emissive: glow,
    emissiveIntensity: 2,
    rotation: Quaternion.fromEulerDegrees(0, 8, 0)
  })

  // Energy blade on the right arm.
  addPart(Vector3.create(0.42, 0.86, 0), Vector3.create(0.15, 0.34, 0.17), METAL_DARK)
  rig.spinner = addPart(Vector3.create(0.44, 0.72, 0.3), Vector3.create(0.05, 0.09, 0.62), glow, {
    emissive: glow,
    emissiveIntensity: 2.6,
    rotation: Quaternion.fromEulerDegrees(30, 0, 0)
  })

  rig.spinAxis = 'z'
  rig.profiles = {
    idle: { amplitude: 0.025, speed: 2, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.055, speed: 7, tilt: 7, spin: 0, lunge: 0 },
    talk: { amplitude: 0.03, speed: 10, tilt: 6, spin: 0, lunge: 0 },
    attack: { amplitude: 0.03, speed: 13, tilt: 10, spin: 0, lunge: 0.16 },
    impact: { amplitude: 0.05, speed: 20, tilt: -8, spin: 0, lunge: 0 }
  }
}

/** Ranged assault robot: armored shoulders and a forward rifle that kicks when firing. */
function buildHumanGunner(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  addPart(Vector3.create(0, 0.16, 0), Vector3.create(0.52, 0.05, 0.52), glow, { cylinder: true, emissive: glow, emissiveIntensity: 2 })
  addPart(Vector3.create(0, 0.34, 0), Vector3.create(0.6, 0.24, 0.6), METAL_DARK, { cylinder: true })

  // Broad armored torso with chest light.
  addPart(Vector3.create(0, 0.82, 0), Vector3.create(0.62, 0.52, 0.44), HUMAN_HULL)
  addPart(Vector3.create(0, 0.9, 0.21), Vector3.create(0.18, 0.1, 0.05), glow, { emissive: glow, emissiveIntensity: 2.2 })

  // Shoulder pauldrons.
  addPart(Vector3.create(-0.42, 1.06, 0), Vector3.create(0.22, 0.16, 0.3), METAL_LIGHT, { rotation: Quaternion.fromEulerDegrees(0, 0, 12) })
  addPart(Vector3.create(0.42, 1.06, 0), Vector3.create(0.22, 0.16, 0.3), METAL_LIGHT, { rotation: Quaternion.fromEulerDegrees(0, 0, -12) })

  // Helmet with a full-width visor.
  addPart(Vector3.create(0, 1.28, 0), Vector3.create(0.34, 0.28, 0.34), METAL_DARK)
  addPart(Vector3.create(0, 1.3, 0.16), Vector3.create(0.28, 0.09, 0.05), glow, { emissive: glow, emissiveIntensity: 2.8 })

  // Left arm plate.
  addPart(Vector3.create(-0.4, 0.76, 0), Vector3.create(0.15, 0.4, 0.17), METAL_DARK)

  // Right arm rifle: housing, barrel, and a glowing muzzle.
  addPart(Vector3.create(0.4, 0.82, 0.08), Vector3.create(0.17, 0.2, 0.34), METAL_DARK)
  addPart(Vector3.create(0.4, 0.82, 0.4), Vector3.create(0.09, 0.09, 0.5), METAL_LIGHT, {
    cylinder: true,
    rotation: Quaternion.fromEulerDegrees(90, 0, 0)
  })
  rig.spinner = addPart(Vector3.create(0.4, 0.82, 0.66), Vector3.create(0.11, 0.11, 0.06), glow, {
    cylinder: true,
    emissive: glow,
    emissiveIntensity: 2.4,
    rotation: Quaternion.fromEulerDegrees(90, 0, 0)
  })

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.025, speed: 2, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.055, speed: 7.5, tilt: 7, spin: 0, lunge: 0 },
    talk: { amplitude: 0.03, speed: 10, tilt: 6, spin: 0, lunge: 0 },
    attack: { amplitude: 0.02, speed: 14, tilt: 3, spin: 600, lunge: -0.08 },
    impact: { amplitude: 0.05, speed: 20, tilt: -8, spin: 0, lunge: 0 }
  }
}

/** Floating golden saucer with a spinning halo ring and a crystal keel. */
function buildAlienProbe(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  // Crystal keel hanging under the saucer.
  addPart(Vector3.create(0, 0.32, 0), Vector3.create(0.16, 0.4, 0.16), ALIEN_CRYSTAL, {
    cone: true,
    emissive: ALIEN_CRYSTAL,
    emissiveIntensity: 1.6,
    rotation: Quaternion.fromEulerDegrees(180, 0, 0)
  })

  // Saucer hull.
  addPart(Vector3.create(0, 0.72, 0), Vector3.create(0.72, 0.16, 0.72), ALIEN_GOLD, { cylinder: true, metallic: 0.8, roughness: 0.25 })
  addPart(Vector3.create(0, 0.86, 0), Vector3.create(0.4, 0.22, 0.4), ALIEN_DARK, { sphere: true })

  // Team-glow eye on the dome front.
  addPart(Vector3.create(0, 0.88, 0.19), Vector3.create(0.1, 0.1, 0.06), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })

  // Spinning halo ring segments.
  const halo = engine.addEntity()
  Transform.create(halo, { parent: rig.bodyRoot, position: Vector3.create(0, 0.72, 0) })
  rig.parts.push(halo)
  rig.spinner = halo
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2
    const orb = engine.addEntity()
    Transform.create(orb, {
      parent: halo,
      position: Vector3.create(Math.cos(angle) * 0.52, 0, Math.sin(angle) * 0.52),
      scale: Vector3.create(0.09, 0.09, 0.09)
    })
    MeshRenderer.setSphere(orb)
    Material.setPbrMaterial(orb, {
      albedoColor: ALIEN_CRYSTAL,
      emissiveColor: ALIEN_CRYSTAL,
      emissiveIntensity: 2,
      metallic: 0.2,
      roughness: 0.3,
      castShadows: false
    })
    rig.parts.push(orb)
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.07, speed: 1.6, tilt: 0, spin: 40, lunge: 0 },
    walk: { amplitude: 0.05, speed: 5, tilt: 10, spin: 140, lunge: 0 },
    talk: { amplitude: 0.03, speed: 10, tilt: -6, spin: 420, lunge: 0 },
    attack: { amplitude: 0.03, speed: 10, tilt: -6, spin: 420, lunge: 0 },
    impact: { amplitude: 0.08, speed: 18, tilt: 8, spin: 40, lunge: 0 }
  }
}

/** Tall gliding warrior with twin energy blades and an elongated crest. */
function buildAlienStalker(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  addPart(Vector3.create(0, 0.14, 0), Vector3.create(0.44, 0.04, 0.44), ALIEN_CRYSTAL, { cylinder: true, emissive: ALIEN_CRYSTAL, emissiveIntensity: 1.8 })

  // Flared robe-like lower body.
  addPart(Vector3.create(0, 0.5, 0), Vector3.create(0.4, 0.62, 0.4), ALIEN_DARK, {
    cone: true,
    rotation: Quaternion.fromEulerDegrees(180, 0, 0)
  })

  // Slim golden torso and shoulder cowl.
  addPart(Vector3.create(0, 1.02, 0), Vector3.create(0.3, 0.5, 0.24), ALIEN_GOLD, { metallic: 0.8, roughness: 0.25 })
  addPart(Vector3.create(0, 1.28, 0), Vector3.create(0.52, 0.1, 0.3), ALIEN_DARK)

  // Elongated head crest with team-glow eyes.
  addPart(Vector3.create(0, 1.48, 0.02), Vector3.create(0.18, 0.24, 0.3), ALIEN_GOLD, { metallic: 0.8, roughness: 0.25 })
  addPart(Vector3.create(0, 1.6, -0.14), Vector3.create(0.1, 0.1, 0.34), ALIEN_DARK, { rotation: Quaternion.fromEulerDegrees(-18, 0, 0) })
  addPart(Vector3.create(0, 1.5, 0.17), Vector3.create(0.16, 0.05, 0.04), glow, { emissive: glow, emissiveIntensity: 3 })

  // Twin energy blades angled forward from the arms.
  addPart(Vector3.create(-0.36, 1.06, 0.1), Vector3.create(0.09, 0.34, 0.1), ALIEN_DARK, { rotation: Quaternion.fromEulerDegrees(20, 0, 15) })
  addPart(Vector3.create(0.36, 1.06, 0.1), Vector3.create(0.09, 0.34, 0.1), ALIEN_DARK, { rotation: Quaternion.fromEulerDegrees(20, 0, -15) })
  addPart(Vector3.create(-0.42, 0.86, 0.3), Vector3.create(0.04, 0.5, 0.09), ALIEN_CRYSTAL, {
    emissive: ALIEN_CRYSTAL,
    emissiveIntensity: 2.2,
    rotation: Quaternion.fromEulerDegrees(55, 0, 0)
  })
  addPart(Vector3.create(0.42, 0.86, 0.3), Vector3.create(0.04, 0.5, 0.09), ALIEN_CRYSTAL, {
    emissive: ALIEN_CRYSTAL,
    emissiveIntensity: 2.2,
    rotation: Quaternion.fromEulerDegrees(55, 0, 0)
  })

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.05, speed: 1.8, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.04, speed: 5.5, tilt: 9, spin: 0, lunge: 0 },
    talk: { amplitude: 0.03, speed: 8, tilt: 5, spin: 0, lunge: 0 },
    attack: { amplitude: 0.03, speed: 13, tilt: 10, spin: 0, lunge: 0.16 },
    impact: { amplitude: 0.07, speed: 18, tilt: -8, spin: 0, lunge: 0 }
  }
}

/** Floating caster that channels a crackling orb held between two arms. */
function buildAlienDisruptor(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  addPart(Vector3.create(0, 0.14, 0), Vector3.create(0.48, 0.04, 0.48), ALIEN_CRYSTAL, { cylinder: true, emissive: ALIEN_CRYSTAL, emissiveIntensity: 1.8 })

  // Long robe tapering to nothing - the unit floats.
  addPart(Vector3.create(0, 0.62, 0), Vector3.create(0.46, 0.85, 0.46), ALIEN_DARK, {
    cone: true,
    rotation: Quaternion.fromEulerDegrees(180, 0, 0)
  })
  addPart(Vector3.create(0, 1.12, 0), Vector3.create(0.34, 0.3, 0.28), ALIEN_GOLD, { metallic: 0.8, roughness: 0.25 })

  // Hooded head with team-glow eyes and a golden crown fin.
  addPart(Vector3.create(0, 1.42, 0), Vector3.create(0.24, 0.24, 0.26), ALIEN_DARK, { sphere: true })
  addPart(Vector3.create(0, 1.44, 0.12), Vector3.create(0.14, 0.05, 0.05), glow, { emissive: glow, emissiveIntensity: 3 })
  addPart(Vector3.create(0, 1.62, -0.04), Vector3.create(0.06, 0.22, 0.18), ALIEN_GOLD, { metallic: 0.8, roughness: 0.25 })

  // Two arms cradling the casting orb out front.
  addPart(Vector3.create(-0.24, 1.08, 0.26), Vector3.create(0.08, 0.09, 0.34), ALIEN_GOLD, { rotation: Quaternion.fromEulerDegrees(-14, -18, 0) })
  addPart(Vector3.create(0.24, 1.08, 0.26), Vector3.create(0.08, 0.09, 0.34), ALIEN_GOLD, { rotation: Quaternion.fromEulerDegrees(-14, 18, 0) })

  // The orb spins while channeling and firing.
  rig.spinner = addPart(Vector3.create(0, 1.14, 0.46), Vector3.create(0.22, 0.22, 0.22), ALIEN_CRYSTAL, {
    sphere: true,
    emissive: ALIEN_CRYSTAL,
    emissiveIntensity: 2.6
  })

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.06, speed: 1.7, tilt: 0, spin: 60, lunge: 0 },
    walk: { amplitude: 0.04, speed: 5, tilt: 9, spin: 120, lunge: 0 },
    talk: { amplitude: 0.03, speed: 8, tilt: 5, spin: 200, lunge: 0 },
    attack: { amplitude: 0.03, speed: 12, tilt: 6, spin: 900, lunge: -0.07 },
    impact: { amplitude: 0.07, speed: 18, tilt: -8, spin: 60, lunge: 0 }
  }
}

/** Segmented grub that scuttles on stubby legs and chews with glowing mandibles. */
function buildBioDrone(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  // Three body segments, rear largest.
  addPart(Vector3.create(0, 0.42, -0.32), Vector3.create(0.52, 0.44, 0.5), BIO_FLESH, { sphere: true, metallic: 0.05, roughness: 0.85 })
  addPart(Vector3.create(0, 0.4, 0.02), Vector3.create(0.44, 0.4, 0.42), BIO_FLESH, { sphere: true, metallic: 0.05, roughness: 0.85 })
  addPart(Vector3.create(0, 0.38, 0.32), Vector3.create(0.34, 0.32, 0.32), BIO_CARAPACE, { sphere: true, metallic: 0.1, roughness: 0.7 })

  // Carapace ridge plates along the back.
  addPart(Vector3.create(0, 0.66, -0.3), Vector3.create(0.3, 0.1, 0.3), BIO_CARAPACE, { rotation: Quaternion.fromEulerDegrees(0, 45, 0) })
  addPart(Vector3.create(0, 0.62, 0), Vector3.create(0.24, 0.08, 0.24), BIO_CARAPACE, { rotation: Quaternion.fromEulerDegrees(0, 45, 0) })

  // Team-glow eyes and bone mandibles.
  addPart(Vector3.create(-0.09, 0.46, 0.44), Vector3.create(0.07, 0.07, 0.05), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })
  addPart(Vector3.create(0.09, 0.46, 0.44), Vector3.create(0.07, 0.07, 0.05), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })
  addPart(Vector3.create(-0.1, 0.3, 0.46), Vector3.create(0.05, 0.16, 0.05), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(115, 0, 12) })
  addPart(Vector3.create(0.1, 0.3, 0.46), Vector3.create(0.05, 0.16, 0.05), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(115, 0, -12) })

  // Stubby legs.
  for (const side of [-1, 1]) {
    for (const offset of [-0.28, 0, 0.24]) {
      addPart(Vector3.create(side * 0.26, 0.14, offset), Vector3.create(0.07, 0.24, 0.07), BIO_CARAPACE, {
        rotation: Quaternion.fromEulerDegrees(0, 0, side * 24)
      })
    }
  }

  rig.profiles = {
    idle: { amplitude: 0.03, speed: 3, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.05, speed: 11, tilt: 4, spin: 0, lunge: 0 },
    talk: { amplitude: 0.04, speed: 15, tilt: 8, spin: 0, lunge: 0.05 },
    attack: { amplitude: 0.04, speed: 15, tilt: 8, spin: 0, lunge: 0.05 },
    impact: { amplitude: 0.06, speed: 20, tilt: -6, spin: 0, lunge: 0 }
  }
}

/** Hulking beast with scythe claws and armored back spikes that pounces on prey. */
function buildBioRavager(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  // Massive body with armored hump.
  addPart(Vector3.create(0, 0.56, -0.1), Vector3.create(0.68, 0.56, 0.72), BIO_FLESH, { sphere: true, metallic: 0.05, roughness: 0.85 })
  addPart(Vector3.create(0, 0.82, -0.2), Vector3.create(0.5, 0.34, 0.5), BIO_CARAPACE, { sphere: true, metallic: 0.1, roughness: 0.7 })

  // Back spikes.
  addPart(Vector3.create(0, 1.05, -0.3), Vector3.create(0.08, 0.34, 0.08), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(-16, 0, 0) })
  addPart(Vector3.create(-0.18, 0.98, -0.12), Vector3.create(0.07, 0.28, 0.07), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(-10, 0, -14) })
  addPart(Vector3.create(0.18, 0.98, -0.12), Vector3.create(0.07, 0.28, 0.07), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(-10, 0, 14) })

  // Head low and forward with team-glow eyes.
  addPart(Vector3.create(0, 0.5, 0.42), Vector3.create(0.4, 0.32, 0.36), BIO_CARAPACE, { sphere: true })
  addPart(Vector3.create(-0.1, 0.56, 0.56), Vector3.create(0.08, 0.08, 0.05), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })
  addPart(Vector3.create(0.1, 0.56, 0.56), Vector3.create(0.08, 0.08, 0.05), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })

  // Scythe claws sweeping forward.
  addPart(Vector3.create(-0.42, 0.6, 0.28), Vector3.create(0.1, 0.5, 0.12), BIO_FLESH, { rotation: Quaternion.fromEulerDegrees(35, 0, 18) })
  addPart(Vector3.create(0.42, 0.6, 0.28), Vector3.create(0.1, 0.5, 0.12), BIO_FLESH, { rotation: Quaternion.fromEulerDegrees(35, 0, -18) })
  addPart(Vector3.create(-0.5, 0.44, 0.52), Vector3.create(0.06, 0.42, 0.08), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(125, 0, 8) })
  addPart(Vector3.create(0.5, 0.44, 0.52), Vector3.create(0.06, 0.42, 0.08), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(125, 0, -8) })

  // Haunches.
  addPart(Vector3.create(-0.3, 0.3, -0.3), Vector3.create(0.2, 0.3, 0.26), BIO_CARAPACE, { sphere: true })
  addPart(Vector3.create(0.3, 0.3, -0.3), Vector3.create(0.2, 0.3, 0.26), BIO_CARAPACE, { sphere: true })

  rig.profiles = {
    idle: { amplitude: 0.035, speed: 2.6, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.09, speed: 9, tilt: 6, spin: 0, lunge: 0 },
    talk: { amplitude: 0.05, speed: 12, tilt: 6, spin: 0, lunge: 0 },
    attack: { amplitude: 0.06, speed: 14, tilt: 12, spin: 0, lunge: 0.2 },
    impact: { amplitude: 0.08, speed: 20, tilt: -8, spin: 0, lunge: 0 }
  }
}

/** Squat artillery bug: a swollen acid sac feeding a tail cannon arched over its back. */
function buildBioSpitter(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  // Low wide body with a glowing acid sac at the rear.
  addPart(Vector3.create(0, 0.4, 0.06), Vector3.create(0.52, 0.4, 0.56), BIO_FLESH, { sphere: true, metallic: 0.05, roughness: 0.85 })
  addPart(Vector3.create(0, 0.44, -0.34), Vector3.create(0.44, 0.42, 0.44), Color4.create(0.4, 0.55, 0.16, 1), {
    sphere: true,
    emissive: Color4.create(0.55, 0.85, 0.2, 1),
    emissiveIntensity: 1.2,
    metallic: 0.05,
    roughness: 0.7
  })

  // Carapace plates over the sac.
  addPart(Vector3.create(0, 0.66, -0.3), Vector3.create(0.3, 0.12, 0.3), BIO_CARAPACE, { rotation: Quaternion.fromEulerDegrees(0, 45, 0) })

  // Head with team-glow eyes.
  addPart(Vector3.create(0, 0.4, 0.42), Vector3.create(0.3, 0.26, 0.28), BIO_CARAPACE, { sphere: true })
  addPart(Vector3.create(-0.08, 0.46, 0.54), Vector3.create(0.06, 0.06, 0.04), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })
  addPart(Vector3.create(0.08, 0.46, 0.54), Vector3.create(0.06, 0.06, 0.04), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })

  // Tail cannon arched over the back, aiming forward, with a glowing muzzle.
  addPart(Vector3.create(0, 0.78, -0.18), Vector3.create(0.13, 0.13, 0.5), BIO_CARAPACE, {
    cylinder: true,
    rotation: Quaternion.fromEulerDegrees(64, 0, 0)
  })
  addPart(Vector3.create(0, 1.02, 0.06), Vector3.create(0.11, 0.11, 0.42), BIO_BONE, {
    cylinder: true,
    rotation: Quaternion.fromEulerDegrees(104, 0, 0)
  })
  rig.spinner = addPart(Vector3.create(0, 0.98, 0.28), Vector3.create(0.13, 0.13, 0.07), Color4.create(0.55, 0.85, 0.2, 1), {
    cylinder: true,
    emissive: Color4.create(0.55, 0.85, 0.2, 1),
    emissiveIntensity: 2.4,
    rotation: Quaternion.fromEulerDegrees(104, 0, 0)
  })

  // Legs splayed for a stable firing stance.
  for (const side of [-1, 1]) {
    for (const offset of [-0.2, 0.22]) {
      addPart(Vector3.create(side * 0.3, 0.16, offset), Vector3.create(0.07, 0.28, 0.07), BIO_CARAPACE, {
        rotation: Quaternion.fromEulerDegrees(0, 0, side * 28)
      })
    }
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.03, speed: 2.8, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.06, speed: 10, tilt: 5, spin: 0, lunge: 0 },
    talk: { amplitude: 0.04, speed: 12, tilt: 6, spin: 0, lunge: 0 },
    attack: { amplitude: 0.03, speed: 14, tilt: -6, spin: 500, lunge: -0.08 },
    impact: { amplitude: 0.06, speed: 20, tilt: -8, spin: 0, lunge: 0 }
  }
}

// ---------------------------------------------------------------------------
// Advanced units: casters (AoE), flyers (hover high), titans (giants).

/** Human caster: coil-backed tesla trooper crackling with an arc sphere between antenna prongs. */
function buildHumanStormcaller(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const STORM = Color4.create(0.55, 0.75, 1, 1)

  addPart(Vector3.create(0, 0.16, 0), Vector3.create(0.5, 0.05, 0.5), STORM, { cylinder: true, emissive: STORM, emissiveIntensity: 2 })
  addPart(Vector3.create(0, 0.34, 0), Vector3.create(0.56, 0.24, 0.56), METAL_DARK, { cylinder: true })

  // Slim armored torso with a capacitor core.
  addPart(Vector3.create(0, 0.84, 0), Vector3.create(0.5, 0.54, 0.4), HUMAN_HULL)
  addPart(Vector3.create(0, 0.9, 0.19), Vector3.create(0.16, 0.22, 0.05), STORM, { emissive: STORM, emissiveIntensity: 2.6 })

  // Backpack coil stack.
  addPart(Vector3.create(0, 0.94, -0.28), Vector3.create(0.3, 0.42, 0.16), METAL_DARK)
  addPart(Vector3.create(0, 1.2, -0.28), Vector3.create(0.14, 0.14, 0.14), STORM, { sphere: true, emissive: STORM, emissiveIntensity: 2.4 })

  // Hooded helm with a glowing visor slit.
  addPart(Vector3.create(0, 1.3, 0), Vector3.create(0.3, 0.26, 0.3), METAL_DARK)
  addPart(Vector3.create(0, 1.32, 0.14), Vector3.create(0.22, 0.06, 0.05), glow, { emissive: glow, emissiveIntensity: 3 })

  // Twin antenna prongs cradling the storm orb overhead - the orb spins when casting.
  addPart(Vector3.create(-0.12, 1.56, 0), Vector3.create(0.04, 0.3, 0.04), METAL_LIGHT, { rotation: Quaternion.fromEulerDegrees(0, 0, 14) })
  addPart(Vector3.create(0.12, 1.56, 0), Vector3.create(0.04, 0.3, 0.04), METAL_LIGHT, { rotation: Quaternion.fromEulerDegrees(0, 0, -14) })
  rig.spinner = addPart(Vector3.create(0, 1.78, 0), Vector3.create(0.2, 0.2, 0.2), STORM, {
    sphere: true,
    emissive: STORM,
    emissiveIntensity: 3
  })

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.03, speed: 2, tilt: 0, spin: 80, lunge: 0 },
    walk: { amplitude: 0.05, speed: 7, tilt: 6, spin: 160, lunge: 0 },
    talk: { amplitude: 0.03, speed: 10, tilt: 5, spin: 240, lunge: 0 },
    attack: { amplitude: 0.03, speed: 14, tilt: -4, spin: 1000, lunge: -0.08 },
    impact: { amplitude: 0.05, speed: 20, tilt: -8, spin: 80, lunge: 0 }
  }
}

/** Human flyer: the Kestrel Gunship - an attack VTOL with a four-blade rotor,
 * tail boom, twin engine nacelles, underwing missile pods and a tri-barrel chin gatling. */
function buildHumanRaptor(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  rig.baseHeight = 2.0

  // --- Fuselage: layered hull, armored belly, framed cockpit canopy. -------
  addPart(Vector3.create(0, 0.5, 0.05), Vector3.create(0.52, 0.36, 1.05), HUMAN_HULL)
  addPart(Vector3.create(0, 0.48, 0.62), Vector3.create(0.38, 0.26, 0.3), METAL_LIGHT)
  addPart(Vector3.create(0, 0.34, 0.1), Vector3.create(0.44, 0.12, 0.9), METAL_DARK)
  addPart(Vector3.create(0, 0.62, 0.42), Vector3.create(0.3, 0.15, 0.26), glow, { emissive: glow, emissiveIntensity: 2.6 })
  addPart(Vector3.create(0, 0.67, 0.3), Vector3.create(0.34, 0.06, 0.12), METAL_DARK)
  addPart(Vector3.create(0, 0.7, -0.12), Vector3.create(0.22, 0.12, 0.66), METAL_DARK)

  // --- Tail boom with fin, planes and a small tail rotor cross. ------------
  addPart(Vector3.create(0, 0.56, -0.78), Vector3.create(0.15, 0.13, 0.62), METAL_LIGHT)
  addPart(Vector3.create(0, 0.8, -1.02), Vector3.create(0.05, 0.36, 0.28), HUMAN_HULL)
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.19, 0.6, -0.98), Vector3.create(0.3, 0.04, 0.16), METAL_LIGHT)
  }
  addPart(Vector3.create(0.06, 0.78, -1.04), Vector3.create(0.02, 0.34, 0.05), METAL_DARK)
  addPart(Vector3.create(0.06, 0.78, -1.04), Vector3.create(0.02, 0.05, 0.34), METAL_DARK)
  // Tail beacon.
  addPart(Vector3.create(0, 1.0, -1.02), Vector3.create(0.05, 0.05, 0.05), glow, { sphere: true, emissive: glow, emissiveIntensity: 3.5 })

  // --- Stub wings: engine nacelles, intake rings, exhausts, missile pods. --
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.55, 0.52, 0), Vector3.create(0.55, 0.07, 0.36), METAL_LIGHT)
    // Nacelle with a bright intake ring and glowing exhaust.
    addPart(Vector3.create(side * 0.86, 0.5, -0.02), Vector3.create(0.2, 0.2, 0.56), METAL_DARK, { cylinder: true, rotation: Quaternion.fromEulerDegrees(90, 0, 0) })
    addPart(Vector3.create(side * 0.86, 0.5, 0.28), Vector3.create(0.23, 0.23, 0.05), METAL_LIGHT, { cylinder: true, rotation: Quaternion.fromEulerDegrees(90, 0, 0) })
    addPart(Vector3.create(side * 0.86, 0.5, -0.32), Vector3.create(0.15, 0.15, 0.06), glow, {
      cylinder: true,
      emissive: glow,
      emissiveIntensity: 3,
      rotation: Quaternion.fromEulerDegrees(90, 0, 0)
    })
    // Wingtip navigation light.
    addPart(Vector3.create(side * 1.02, 0.56, 0.05), Vector3.create(0.05, 0.05, 0.05), glow, { sphere: true, emissive: glow, emissiveIntensity: 3.5 })
    // Missile pod: rack plus two visible warheads.
    addPart(Vector3.create(side * 0.58, 0.38, 0.08), Vector3.create(0.17, 0.14, 0.42), METAL_DARK)
    for (const slot of [-0.045, 0.045]) {
      addPart(Vector3.create(side * 0.58 + slot, 0.38, 0.33), Vector3.create(0.05, 0.13, 0.05), BLADE_STEEL, {
        cone: true,
        metallic: 0.7,
        roughness: 0.3,
        rotation: Quaternion.fromEulerDegrees(90, 0, 0)
      })
    }
    // Engine heat shimmer sinking from the exhaust.
    const heat = addPart(Vector3.create(side * 0.86, 0.42, -0.34), Vector3.create(0.07, 0.07, 0.07), glow, { sphere: true, emissive: glow, emissiveIntensity: 2.8 })
    rig.fx.push({ entity: heat, mode: 'ember', anchor: Vector3.create(side * 0.86, 0.42, -0.34), radius: 0.03, height: -0.45, speed: 1.7, phase: side, size: 0.07 })
  }

  // --- Main rotor: mast, hub and four coned blades on a spinning carrier. --
  addPart(Vector3.create(0, 0.8, 0), Vector3.create(0.09, 0.14, 0.09), METAL_DARK, { cylinder: true })
  const rotor = engine.addEntity()
  Transform.create(rotor, { parent: rig.bodyRoot, position: Vector3.create(0, 0.9, 0) })
  rig.parts.push(rotor)
  rig.spinner = rotor
  addChildPart(rig, rotor, Vector3.create(0, 0, 0), Vector3.create(0.16, 0.06, 0.16), METAL_DARK, { cylinder: true })
  for (const angle of [0, 90]) {
    addChildPart(rig, rotor, Vector3.create(0, 0.02, 0), Vector3.create(2.3, 0.022, 0.14), METAL_LIGHT, {
      rotation: Quaternion.fromEulerDegrees(0, angle, 2.5)
    })
  }

  // --- Chin gatling: swivel mount, three barrels, muzzle glow. -------------
  addPart(Vector3.create(0, 0.3, 0.44), Vector3.create(0.13, 0.12, 0.13), METAL_DARK, { cylinder: true })
  for (const [bx, by] of [[0, 0.035], [-0.03, -0.02], [0.03, -0.02]] as const) {
    addPart(Vector3.create(bx, 0.27 + by, 0.64), Vector3.create(0.045, 0.045, 0.36), METAL_LIGHT, {
      cylinder: true,
      rotation: Quaternion.fromEulerDegrees(90, 0, 0)
    })
  }
  addPart(Vector3.create(0, 0.27, 0.82), Vector3.create(0.07, 0.07, 0.07), glow, { sphere: true, emissive: glow, emissiveIntensity: 2.8 })

  // --- Landing skids. -------------------------------------------------------
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.24, 0.14, 0.05), Vector3.create(0.05, 0.04, 0.9), METAL_LIGHT)
    for (const off of [-0.28, 0.32]) {
      addPart(Vector3.create(side * 0.24, 0.23, off), Vector3.create(0.04, 0.15, 0.04), METAL_DARK, {
        rotation: Quaternion.fromEulerDegrees(0, 0, side * -14)
      })
    }
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.1, speed: 1.6, tilt: 0, spin: 900, lunge: 0 },
    walk: { amplitude: 0.07, speed: 3.5, tilt: 12, spin: 1300, lunge: 0 },
    talk: { amplitude: 0.08, speed: 4, tilt: 4, spin: 1000, lunge: 0 },
    attack: { amplitude: 0.05, speed: 12, tilt: 7, spin: 1400, lunge: -0.06 },
    impact: { amplitude: 0.12, speed: 16, tilt: -8, spin: 900, lunge: 0 }
  }
}

/** Human titan: a towering siege mech with piston legs, a furnace core and crushing fists. */
function buildHumanColossus(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const FURNACE = Color4.create(1, 0.55, 0.2, 1)

  // Wide stance piston legs on armored feet.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.42, 0.16, 0), Vector3.create(0.44, 0.22, 0.6), METAL_DARK)
    addPart(Vector3.create(side * 0.42, 0.62, 0), Vector3.create(0.24, 0.75, 0.28), METAL_LIGHT)
    addPart(Vector3.create(side * 0.42, 0.62, 0.13), Vector3.create(0.08, 0.6, 0.06), glow, { emissive: glow, emissiveIntensity: 1.4 })
  }

  // Hip block and massive torso with a glowing furnace core.
  addPart(Vector3.create(0, 1.1, 0), Vector3.create(0.95, 0.3, 0.6), METAL_DARK)
  addPart(Vector3.create(0, 1.7, 0), Vector3.create(1.15, 0.95, 0.75), HUMAN_HULL)
  addPart(Vector3.create(0, 1.72, 0.39), Vector3.create(0.36, 0.36, 0.06), FURNACE, { emissive: FURNACE, emissiveIntensity: 3 })
  addPart(Vector3.create(0, 2.24, 0), Vector3.create(1.3, 0.2, 0.85), METAL_DARK)

  // Shoulder towers with warning lights.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.72, 2.1, 0), Vector3.create(0.38, 0.5, 0.5), METAL_LIGHT)
    addPart(Vector3.create(side * 0.72, 2.42, 0), Vector3.create(0.12, 0.12, 0.12), glow, { sphere: true, emissive: glow, emissiveIntensity: 2.6 })
  }

  // Small armored head with a heavy visor.
  addPart(Vector3.create(0, 2.44, 0.1), Vector3.create(0.34, 0.26, 0.34), METAL_DARK)
  addPart(Vector3.create(0, 2.46, 0.28), Vector3.create(0.26, 0.08, 0.05), glow, { emissive: glow, emissiveIntensity: 3 })

  // Crushing fists on thick arms - the right fist is the lunge weapon.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.95, 1.6, 0.1), Vector3.create(0.26, 0.7, 0.3), METAL_DARK)
    addPart(Vector3.create(side * 0.95, 1.15, 0.22), Vector3.create(0.36, 0.34, 0.38), METAL_LIGHT)
  }
  rig.spinner = addPart(Vector3.create(0, 1.7, -0.42), Vector3.create(0.5, 0.5, 0.14), FURNACE, {
    cylinder: true,
    emissive: FURNACE,
    emissiveIntensity: 1.6,
    rotation: Quaternion.fromEulerDegrees(90, 0, 0)
  })

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.02, speed: 1.4, tilt: 0, spin: 30, lunge: 0 },
    walk: { amplitude: 0.08, speed: 4.5, tilt: 4, spin: 60, lunge: 0 },
    talk: { amplitude: 0.03, speed: 6, tilt: 3, spin: 40, lunge: 0 },
    attack: { amplitude: 0.06, speed: 9, tilt: 10, spin: 200, lunge: 0.3 },
    impact: { amplitude: 0.06, speed: 16, tilt: -6, spin: 30, lunge: 0 }
  }
}

/** Alien caster: a levitating seer ringed by orbiting prophecy shards. */
function buildAlienOracle(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  addPart(Vector3.create(0, 0.16, 0), Vector3.create(0.52, 0.04, 0.52), ALIEN_CRYSTAL, { cylinder: true, emissive: ALIEN_CRYSTAL, emissiveIntensity: 2 })

  // Regal floating robe with golden bands.
  addPart(Vector3.create(0, 0.66, 0), Vector3.create(0.5, 0.9, 0.5), ALIEN_DARK, {
    cone: true,
    rotation: Quaternion.fromEulerDegrees(180, 0, 0)
  })
  addPart(Vector3.create(0, 0.94, 0), Vector3.create(0.4, 0.08, 0.4), ALIEN_GOLD, { cylinder: true, metallic: 0.8, roughness: 0.25 })
  addPart(Vector3.create(0, 1.2, 0), Vector3.create(0.34, 0.34, 0.3), ALIEN_GOLD, { metallic: 0.8, roughness: 0.25 })

  // Crowned head with a third-eye gem.
  addPart(Vector3.create(0, 1.52, 0), Vector3.create(0.26, 0.26, 0.26), ALIEN_DARK, { sphere: true })
  addPart(Vector3.create(0, 1.58, 0.13), Vector3.create(0.09, 0.09, 0.06), glow, { sphere: true, emissive: glow, emissiveIntensity: 3.2 })
  addPart(Vector3.create(0, 1.76, 0), Vector3.create(0.34, 0.16, 0.06), ALIEN_GOLD, { metallic: 0.8, roughness: 0.25 })

  // Orbiting prophecy shards on a spinning carrier ring.
  const carrier = engine.addEntity()
  Transform.create(carrier, { parent: rig.bodyRoot, position: Vector3.create(0, 1.16, 0) })
  rig.parts.push(carrier)
  rig.spinner = carrier
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2
    const shard = engine.addEntity()
    Transform.create(shard, {
      parent: carrier,
      position: Vector3.create(Math.cos(angle) * 0.55, 0, Math.sin(angle) * 0.55),
      scale: Vector3.create(0.09, 0.26, 0.09),
      rotation: Quaternion.fromEulerDegrees(0, 0, 18)
    })
    MeshRenderer.setBox(shard)
    Material.setPbrMaterial(shard, {
      albedoColor: ALIEN_CRYSTAL,
      emissiveColor: ALIEN_CRYSTAL,
      emissiveIntensity: 2.2,
      metallic: 0.2,
      roughness: 0.3,
      castShadows: false
    })
    rig.parts.push(shard)
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.08, speed: 1.5, tilt: 0, spin: 70, lunge: 0 },
    walk: { amplitude: 0.05, speed: 5, tilt: 8, spin: 130, lunge: 0 },
    talk: { amplitude: 0.04, speed: 8, tilt: 4, spin: 220, lunge: 0 },
    attack: { amplitude: 0.04, speed: 12, tilt: 5, spin: 1100, lunge: -0.06 },
    impact: { amplitude: 0.08, speed: 18, tilt: -8, spin: 70, lunge: 0 }
  }
}

/** Alien flyer: the Tempest - a crystalline sky-ray with layered swept wings,
 * glowing crystal veins, a halo drive ring and a prow of orbiting beam shards. */
function buildAlienTempest(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  rig.baseHeight = 2.2
  const gild = { metallic: 0.8, roughness: 0.25 }

  // --- Antigrav disc pulsing beneath the hull. -----------------------------
  const grav = addPart(Vector3.create(0, 0.16, 0), Vector3.create(0.85, 0.03, 0.85), Color4.create(ALIEN_CRYSTAL.r, ALIEN_CRYSTAL.g, ALIEN_CRYSTAL.b, 0.5), {
    cylinder: true,
    emissive: ALIEN_CRYSTAL,
    emissiveIntensity: 1.8
  })
  rig.fx.push({ entity: grav, mode: 'pulse', anchor: Vector3.create(0, 0.16, 0), radius: 0, height: 0, speed: 2.6, phase: 0, size: 0.85 })

  // --- Central hull: gold pod, dark armor plates, canopy slit. -------------
  addPart(Vector3.create(0, 0.52, 0.05), Vector3.create(0.5, 0.28, 0.92), ALIEN_GOLD, { sphere: true, ...gild })
  addPart(Vector3.create(0, 0.64, -0.02), Vector3.create(0.34, 0.1, 0.6), ALIEN_DARK, { sphere: true })
  addPart(Vector3.create(0, 0.55, 0.52), Vector3.create(0.26, 0.14, 0.32), ALIEN_DARK, { sphere: true })
  addPart(Vector3.create(0, 0.62, 0.34), Vector3.create(0.2, 0.055, 0.16), glow, { emissive: glow, emissiveIntensity: 3.2 })

  // --- Halo drive ring standing behind the hull. ---------------------------
  addPart(Vector3.create(0, 0.78, -0.36), Vector3.create(0.55, 0.03, 0.55), ALIEN_GOLD, {
    cylinder: true,
    ...gild,
    rotation: Quaternion.fromEulerDegrees(90, 0, 0)
  })
  addPart(Vector3.create(0, 0.78, -0.36), Vector3.create(0.4, 0.015, 0.4), ALIEN_CRYSTAL, {
    cylinder: true,
    emissive: ALIEN_CRYSTAL,
    emissiveIntensity: 2.2,
    rotation: Quaternion.fromEulerDegrees(90, 0, 0)
  })

  // --- Two-segment swept wings with crystal veins and tip prisms. ----------
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.58, 0.52, -0.08), Vector3.create(0.72, 0.06, 0.56), ALIEN_GOLD, {
      ...gild,
      rotation: Quaternion.fromEulerDegrees(0, side * -14, side * 6)
    })
    addPart(Vector3.create(side * 1.08, 0.58, -0.26), Vector3.create(0.52, 0.045, 0.4), ALIEN_DARK, {
      rotation: Quaternion.fromEulerDegrees(0, side * -28, side * 12)
    })
    // Emissive crystal vein tracing the leading edge.
    addPart(Vector3.create(side * 0.62, 0.56, 0.06), Vector3.create(0.52, 0.02, 0.07), ALIEN_CRYSTAL, {
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2.4,
      rotation: Quaternion.fromEulerDegrees(0, side * -14, side * 6)
    })
    // Wingtip prism pointing outward.
    addPart(Vector3.create(side * 1.36, 0.62, -0.4), Vector3.create(0.09, 0.28, 0.09), ALIEN_CRYSTAL, {
      cone: true,
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2.8,
      rotation: Quaternion.fromEulerDegrees(0, 0, side * -95)
    })
  }

  // --- Twin trailing keel fins. --------------------------------------------
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.1, 0.38, -0.52), Vector3.create(0.05, 0.3, 0.4), ALIEN_DARK, {
      rotation: Quaternion.fromEulerDegrees(-26, 0, side * 12)
    })
  }

  // --- Beam prow: emitter housing plus a carrier of orbiting focus shards. -
  addPart(Vector3.create(0, 0.46, 0.62), Vector3.create(0.18, 0.14, 0.2), ALIEN_DARK)
  const prow = engine.addEntity()
  Transform.create(prow, { parent: rig.bodyRoot, position: Vector3.create(0, 0.46, 0.8) })
  rig.parts.push(prow)
  rig.spinner = prow
  addChildPart(rig, prow, Vector3.create(0, 0, 0), Vector3.create(0.14, 0.14, 0.14), glow, { sphere: true, emissive: glow, emissiveIntensity: 3.4 })
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2
    addChildPart(rig, prow, Vector3.create(Math.cos(angle) * 0.18, 0, Math.sin(angle) * 0.18), Vector3.create(0.05, 0.16, 0.05), ALIEN_CRYSTAL, {
      cone: true,
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2.6,
      rotation: Quaternion.fromEulerDegrees(0, 0, 180)
    })
  }

  // --- Energy motes circling the hull. -------------------------------------
  for (let i = 0; i < 3; i++) {
    const mote = addPart(Vector3.create(0, 0.62, 0), Vector3.create(0.05, 0.05, 0.05), glow, { sphere: true, emissive: glow, emissiveIntensity: 3.6 })
    rig.fx.push({ entity: mote, mode: 'orbit', anchor: Vector3.create(0, 0.62, 0), radius: 0.72, height: 0.12, speed: 1.9, phase: (i / 3) * Math.PI * 2, size: 0.05 })
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.12, speed: 1.4, tilt: 0, spin: 90, lunge: 0 },
    walk: { amplitude: 0.08, speed: 3, tilt: 12, spin: 160, lunge: 0 },
    talk: { amplitude: 0.09, speed: 4, tilt: 5, spin: 120, lunge: 0 },
    attack: { amplitude: 0.05, speed: 11, tilt: 8, spin: 1000, lunge: -0.07 },
    impact: { amplitude: 0.14, speed: 16, tilt: -10, spin: 90, lunge: 0 }
  }
}

/** Alien titan: a colossal energy being - armored shell around a blazing core, no legs, pure levitation. */
function buildAlienAvatar(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const CORE = Color4.create(0.85, 0.65, 1, 1)

  // Levitation base glow.
  addPart(Vector3.create(0, 0.2, 0), Vector3.create(1.3, 0.08, 1.3), ALIEN_CRYSTAL, { cylinder: true, emissive: ALIEN_CRYSTAL, emissiveIntensity: 2 })

  // Tapered lower shell hovering above the ground.
  addPart(Vector3.create(0, 1, 0), Vector3.create(1.05, 1.2, 1.05), ALIEN_DARK, {
    cone: true,
    rotation: Quaternion.fromEulerDegrees(180, 0, 0)
  })

  // Massive torso shell with the exposed core - the core spins.
  addPart(Vector3.create(0, 2, 0), Vector3.create(1.5, 1.1, 1.1), ALIEN_GOLD, { metallic: 0.8, roughness: 0.25 })
  rig.spinner = addPart(Vector3.create(0, 2.05, 0.5), Vector3.create(0.45, 0.45, 0.45), CORE, {
    sphere: true,
    emissive: CORE,
    emissiveIntensity: 3.2
  })

  // Crowned helm.
  addPart(Vector3.create(0, 2.85, 0), Vector3.create(0.5, 0.45, 0.5), ALIEN_DARK)
  addPart(Vector3.create(0, 2.9, 0.26), Vector3.create(0.34, 0.08, 0.05), glow, { emissive: glow, emissiveIntensity: 3.4 })
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.34, 3.2, 0), Vector3.create(0.12, 0.5, 0.12), ALIEN_GOLD, {
      cone: true,
      metallic: 0.8,
      roughness: 0.25,
      rotation: Quaternion.fromEulerDegrees(0, 0, side * 12)
    })
  }

  // Floating pauldron slabs and energy blade arms.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 1.05, 2.5, 0), Vector3.create(0.55, 0.28, 0.7), ALIEN_GOLD, {
      metallic: 0.8,
      roughness: 0.25,
      rotation: Quaternion.fromEulerDegrees(0, 0, side * -10)
    })
    addPart(Vector3.create(side * 1.15, 1.8, 0.15), Vector3.create(0.2, 0.85, 0.2), ALIEN_DARK)
    addPart(Vector3.create(side * 1.18, 1.2, 0.4), Vector3.create(0.08, 0.9, 0.14), ALIEN_CRYSTAL, {
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2.6,
      rotation: Quaternion.fromEulerDegrees(40, 0, 0)
    })
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.06, speed: 1.2, tilt: 0, spin: 50, lunge: 0 },
    walk: { amplitude: 0.05, speed: 3.5, tilt: 5, spin: 90, lunge: 0 },
    talk: { amplitude: 0.04, speed: 5, tilt: 3, spin: 70, lunge: 0 },
    attack: { amplitude: 0.05, speed: 9, tilt: 9, spin: 600, lunge: 0.26 },
    impact: { amplitude: 0.07, speed: 15, tilt: -6, spin: 50, lunge: 0 }
  }
}

/** Bio caster: a bloated toxin sac walker that brews plague in a bubbling dorsal cauldron. */
function buildBioPlagueWeaver(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const ACID = Color4.create(0.55, 0.85, 0.2, 1)
  const ACID_DARK = Color4.create(0.4, 0.55, 0.16, 1)

  // Bloated body dragging low.
  addPart(Vector3.create(0, 0.42, -0.05), Vector3.create(0.56, 0.44, 0.62), BIO_FLESH, { sphere: true, metallic: 0.05, roughness: 0.85 })

  // Dorsal cauldron sac with a glowing plague brew - it pulses via spin on the lid.
  addPart(Vector3.create(0, 0.72, -0.16), Vector3.create(0.4, 0.34, 0.4), ACID_DARK, {
    sphere: true,
    emissive: ACID,
    emissiveIntensity: 1.4,
    metallic: 0.05,
    roughness: 0.7
  })
  rig.spinner = addPart(Vector3.create(0, 0.92, -0.16), Vector3.create(0.22, 0.08, 0.22), ACID, {
    cylinder: true,
    emissive: ACID,
    emissiveIntensity: 2.6
  })

  // Bone chimney vents leaking glow.
  addPart(Vector3.create(-0.16, 0.9, -0.3), Vector3.create(0.06, 0.22, 0.06), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(-14, 0, -10) })
  addPart(Vector3.create(0.18, 0.86, -0.26), Vector3.create(0.05, 0.18, 0.05), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(-10, 0, 12) })

  // Head with team-glow eyes and drooping feeler tendrils.
  addPart(Vector3.create(0, 0.44, 0.4), Vector3.create(0.3, 0.24, 0.26), BIO_CARAPACE, { sphere: true })
  addPart(Vector3.create(-0.08, 0.5, 0.52), Vector3.create(0.06, 0.06, 0.04), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })
  addPart(Vector3.create(0.08, 0.5, 0.52), Vector3.create(0.06, 0.06, 0.04), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })
  addPart(Vector3.create(-0.12, 0.3, 0.5), Vector3.create(0.04, 0.2, 0.04), BIO_FLESH, { rotation: Quaternion.fromEulerDegrees(24, 0, 10) })
  addPart(Vector3.create(0.12, 0.3, 0.5), Vector3.create(0.04, 0.2, 0.04), BIO_FLESH, { rotation: Quaternion.fromEulerDegrees(24, 0, -10) })

  // Six stubby legs.
  for (const side of [-1, 1]) {
    for (const offset of [-0.26, 0, 0.26]) {
      addPart(Vector3.create(side * 0.28, 0.14, offset), Vector3.create(0.06, 0.24, 0.06), BIO_CARAPACE, {
        rotation: Quaternion.fromEulerDegrees(0, 0, side * 26)
      })
    }
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.04, speed: 2.4, tilt: 0, spin: 60, lunge: 0 },
    walk: { amplitude: 0.06, speed: 10, tilt: 4, spin: 120, lunge: 0 },
    talk: { amplitude: 0.04, speed: 12, tilt: 5, spin: 160, lunge: 0 },
    attack: { amplitude: 0.04, speed: 14, tilt: -5, spin: 900, lunge: -0.06 },
    impact: { amplitude: 0.07, speed: 20, tilt: -8, spin: 60, lunge: 0 }
  }
}

/** Bio flyer: the Shrieker - a winged terror with a segmented body, horned
 * four-eyed skull, truly beating two-segment membrane wings, a pulsing venom
 * sac and a barbed three-segment tail dripping toxin. */
function buildBioShrieker(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  rig.baseHeight = 1.9
  const ACID = Color4.create(0.55, 0.85, 0.2, 1)
  const flesh = { metallic: 0.05, roughness: 0.85 }

  // --- Segmented body: thorax, abdomen, carapace saddle, dorsal spines. ----
  addPart(Vector3.create(0, 0.52, 0.15), Vector3.create(0.42, 0.34, 0.52), BIO_FLESH, { sphere: true, ...flesh })
  addPart(Vector3.create(0, 0.48, -0.24), Vector3.create(0.32, 0.27, 0.46), BIO_FLESH, { sphere: true, ...flesh })
  addPart(Vector3.create(0, 0.66, 0), Vector3.create(0.36, 0.16, 0.54), BIO_CARAPACE, { sphere: true })
  for (const [sz, sx] of [[0.16, 0], [-0.04, 0.04], [-0.24, -0.04]] as const) {
    addPart(Vector3.create(sx, 0.79, sz), Vector3.create(0.055, 0.2, 0.055), BIO_BONE, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(-24, 0, sx * 90)
    })
  }

  // --- Pulsing venom sac slung under the thorax. ---------------------------
  const sac = addPart(Vector3.create(0, 0.33, 0.08), Vector3.create(0.24, 0.18, 0.28), ACID, {
    sphere: true,
    emissive: ACID,
    emissiveIntensity: 1.8,
    ...flesh
  })
  rig.fx.push({ entity: sac, mode: 'pulse', anchor: Vector3.create(0, 0.33, 0.08), radius: 0, height: 0, speed: 3.2, phase: 0, size: 0.24 })
  // Toxin drip falling from the sac.
  const drip = addPart(Vector3.create(0, 0.26, 0.08), Vector3.create(0.05, 0.05, 0.05), ACID, { sphere: true, emissive: ACID, emissiveIntensity: 2.8 })
  rig.fx.push({ entity: drip, mode: 'ember', anchor: Vector3.create(0, 0.26, 0.08), radius: 0.03, height: -0.4, speed: 1.3, phase: 0, size: 0.05 })

  // --- Horned skull: four glow eyes, jaw, fangs, swept crest horns. --------
  addPart(Vector3.create(0, 0.6, 0.55), Vector3.create(0.3, 0.26, 0.34), BIO_CARAPACE, { sphere: true })
  addPart(Vector3.create(0, 0.48, 0.66), Vector3.create(0.2, 0.1, 0.24), BIO_FLESH, { sphere: true, ...flesh })
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.09, 0.66, 0.68), Vector3.create(0.06, 0.06, 0.04), glow, { sphere: true, emissive: glow, emissiveIntensity: 3.4 })
    addPart(Vector3.create(side * 0.16, 0.62, 0.62), Vector3.create(0.035, 0.035, 0.03), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })
    addPart(Vector3.create(side * 0.05, 0.42, 0.72), Vector3.create(0.035, 0.12, 0.035), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(165, 0, side * 6) })
    addPart(Vector3.create(side * 0.11, 0.44, 0.68), Vector3.create(0.03, 0.09, 0.03), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(165, 0, side * 10) })
    // Crest horns sweeping back over the shoulders.
    addPart(Vector3.create(side * 0.12, 0.76, 0.42), Vector3.create(0.05, 0.3, 0.05), BIO_BONE, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(-125, 0, side * 14)
    })
  }

  // --- Beating wings: pivot per side driven by the flap FX mode. -----------
  for (const side of [-1, 1]) {
    const pivot = engine.addEntity()
    Transform.create(pivot, { parent: rig.bodyRoot, position: Vector3.create(side * 0.14, 0.68, 0.05) })
    rig.parts.push(pivot)
    // Inner and outer membrane panels.
    addChildPart(rig, pivot, Vector3.create(side * 0.42, 0.05, -0.04), Vector3.create(0.8, 0.035, 0.62), BIO_FLESH, {
      ...flesh,
      emissive: Color4.create(0.4, 0.1, 0.1, 1),
      emissiveIntensity: 0.5,
      rotation: Quaternion.fromEulerDegrees(0, side * -10, 0)
    })
    addChildPart(rig, pivot, Vector3.create(side * 0.95, 0.1, -0.16), Vector3.create(0.6, 0.03, 0.46), BIO_FLESH, {
      ...flesh,
      emissive: Color4.create(0.45, 0.12, 0.1, 1),
      emissiveIntensity: 0.6,
      rotation: Quaternion.fromEulerDegrees(0, side * -24, side * 4)
    })
    // Bone wing fingers raking through the membrane.
    addChildPart(rig, pivot, Vector3.create(side * 0.52, 0.08, 0.2), Vector3.create(0.045, 0.04, 0.6), BIO_BONE, {
      metallic: 0.1,
      roughness: 0.6,
      rotation: Quaternion.fromEulerDegrees(0, side * -12, 0)
    })
    addChildPart(rig, pivot, Vector3.create(side * 0.62, 0.08, -0.05), Vector3.create(0.045, 0.04, 0.55), BIO_BONE, {
      metallic: 0.1,
      roughness: 0.6,
      rotation: Quaternion.fromEulerDegrees(0, side * -22, 0)
    })
    addChildPart(rig, pivot, Vector3.create(side * 0.66, 0.08, -0.28), Vector3.create(0.04, 0.035, 0.45), BIO_BONE, {
      metallic: 0.1,
      roughness: 0.6,
      rotation: Quaternion.fromEulerDegrees(0, side * -34, 0)
    })
    // Wing claw at the joint.
    addChildPart(rig, pivot, Vector3.create(side * 0.5, 0.12, 0.34), Vector3.create(0.04, 0.14, 0.04), BIO_BONE, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(30, 0, side * -20)
    })
    rig.fx.push({ entity: pivot, mode: 'flap', anchor: Vector3.Zero(), radius: side * -24, height: side * 10, speed: 7.5, phase: 0, size: 0 })
  }

  // --- Barbed tail: three tapering segments, stinger, venom tip. -----------
  addPart(Vector3.create(0, 0.44, -0.56), Vector3.create(0.16, 0.13, 0.32), BIO_CARAPACE, { sphere: true })
  addPart(Vector3.create(0, 0.42, -0.82), Vector3.create(0.11, 0.1, 0.28), BIO_CARAPACE, { sphere: true })
  addPart(Vector3.create(0, 0.42, -1.04), Vector3.create(0.08, 0.07, 0.22), BIO_FLESH, { sphere: true, ...flesh })
  addPart(Vector3.create(0, 0.46, -1.2), Vector3.create(0.055, 0.24, 0.055), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(115, 0, 0) })
  addPart(Vector3.create(0, 0.5, -1.3), Vector3.create(0.045, 0.045, 0.045), ACID, { sphere: true, emissive: ACID, emissiveIntensity: 3 })
  // Tail barbs.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.08, 0.5, -0.7), Vector3.create(0.035, 0.12, 0.035), BIO_BONE, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(-30, 0, side * 40)
    })
  }

  // --- Dangling talons, front and rear pairs. ------------------------------
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.11, 0.28, 0.24), Vector3.create(0.05, 0.18, 0.05), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(170, 0, side * 8) })
    addPart(Vector3.create(side * 0.09, 0.28, -0.1), Vector3.create(0.04, 0.15, 0.04), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(172, 0, side * 12) })
  }

  // Spore motes buzzing around the body.
  for (let i = 0; i < 3; i++) {
    const spore = addPart(Vector3.create(0, 0.55, 0), Vector3.create(0.04, 0.04, 0.04), ACID, { sphere: true, emissive: ACID, emissiveIntensity: 3 })
    rig.fx.push({ entity: spore, mode: 'orbit', anchor: Vector3.create(0, 0.55, 0), radius: 0.6, height: 0.14, speed: 2.4, phase: (i / 3) * Math.PI * 2, size: 0.04 })
  }

  rig.spinAxis = 'z'
  rig.profiles = {
    idle: { amplitude: 0.14, speed: 3, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.12, speed: 6, tilt: 12, spin: 0, lunge: 0 },
    talk: { amplitude: 0.1, speed: 6, tilt: 5, spin: 0, lunge: 0 },
    attack: { amplitude: 0.08, speed: 14, tilt: 14, spin: 0, lunge: 0.12 },
    impact: { amplitude: 0.16, speed: 18, tilt: -10, spin: 0, lunge: 0 }
  }
}

/** Bio titan: a mountain of muscle and carapace with tusks, crushing arms and a spiked shell. */
function buildBioBehemoth(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  // Elephantine legs.
  for (const side of [-1, 1]) {
    for (const offset of [-0.35, 0.4]) {
      addPart(Vector3.create(side * 0.5, 0.35, offset), Vector3.create(0.3, 0.7, 0.3), BIO_CARAPACE, { cylinder: true })
    }
  }

  // Massive body with an armored spiked shell.
  addPart(Vector3.create(0, 1.25, -0.05), Vector3.create(1.5, 1.15, 1.7), BIO_FLESH, { sphere: true, metallic: 0.05, roughness: 0.85 })
  addPart(Vector3.create(0, 1.85, -0.25), Vector3.create(1.1, 0.6, 1.2), BIO_CARAPACE, { sphere: true, metallic: 0.1, roughness: 0.7 })

  // Shell spikes.
  addPart(Vector3.create(0, 2.35, -0.3), Vector3.create(0.14, 0.65, 0.14), BIO_BONE, { cone: true })
  addPart(Vector3.create(-0.4, 2.2, -0.1), Vector3.create(0.11, 0.5, 0.11), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(0, 0, -18) })
  addPart(Vector3.create(0.4, 2.2, -0.1), Vector3.create(0.11, 0.5, 0.11), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(0, 0, 18) })
  addPart(Vector3.create(0, 2.15, -0.75), Vector3.create(0.11, 0.5, 0.11), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(-24, 0, 0) })

  // Head slung low with giant tusks and team-glow eyes.
  addPart(Vector3.create(0, 1.05, 0.85), Vector3.create(0.66, 0.5, 0.5), BIO_CARAPACE, { sphere: true })
  addPart(Vector3.create(-0.16, 1.2, 1.06), Vector3.create(0.1, 0.1, 0.06), glow, { sphere: true, emissive: glow, emissiveIntensity: 3.2 })
  addPart(Vector3.create(0.16, 1.2, 1.06), Vector3.create(0.1, 0.1, 0.06), glow, { sphere: true, emissive: glow, emissiveIntensity: 3.2 })
  addPart(Vector3.create(-0.3, 0.85, 1.05), Vector3.create(0.09, 0.55, 0.09), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(135, 0, 14) })
  addPart(Vector3.create(0.3, 0.85, 1.05), Vector3.create(0.09, 0.55, 0.09), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(135, 0, -14) })

  // Crushing forearms ending in bone cleavers.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.95, 1.1, 0.45), Vector3.create(0.3, 0.8, 0.34), BIO_FLESH, { rotation: Quaternion.fromEulerDegrees(18, 0, side * 8) })
    addPart(Vector3.create(side * 1.05, 0.6, 0.75), Vector3.create(0.1, 0.6, 0.14), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(130, 0, side * 6) })
  }

  rig.profiles = {
    idle: { amplitude: 0.03, speed: 1.6, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.1, speed: 5, tilt: 4, spin: 0, lunge: 0 },
    talk: { amplitude: 0.05, speed: 7, tilt: 4, spin: 0, lunge: 0 },
    attack: { amplitude: 0.08, speed: 9, tilt: 12, spin: 0, lunge: 0.3 },
    impact: { amplitude: 0.09, speed: 16, tilt: -7, spin: 0, lunge: 0 }
  }
}

// ---------------------------------------------------------------------------
// Heroes: one-of-a-kind champions built on the titan chassis, scaled up with
// unique regalia so they read instantly as "the" unit on the field.
// ---------------------------------------------------------------------------

/** Heroes tower over titans; the animation system never touches scale, so this sticks. */
function applyHeroScale(rig: UnitRig, scale = 1.3): void {
  Transform.getMutable(rig.bodyRoot).scale = Vector3.create(scale, scale, scale)
}

/** An empty animation joint parented to the body root; limbs hung from it rotate as one. */
function heroPivot(rig: UnitRig, position: Vector3): Entity {
  const pivot = engine.addEntity()
  Transform.create(pivot, { parent: rig.bodyRoot, position })
  rig.parts.push(pivot)
  return pivot
}

/** Same as addPart but hangs the piece off an animation pivot instead of the body root. */
function heroChildPart(rig: UnitRig, parent: Entity, position: Vector3, scale: Vector3, color: Color4, options: PartOptions = {}): Entity {
  const part = engine.addEntity()
  Transform.create(part, { parent, position, scale, rotation: options.rotation ?? Quaternion.Identity() })
  if (options.cone) MeshRenderer.setCylinder(part, 0.5, 0.03)
  else if (options.cylinder) MeshRenderer.setCylinder(part)
  else if (options.sphere) MeshRenderer.setSphere(part)
  else MeshRenderer.setBox(part)
  applyPartMaterial(part, color, options)
  rig.parts.push(part)
  return part
}

/**
 * Warmaster Kael: a bespoke armored warlord - layered gold-trimmed plate, a
 * crimson command cape, a back-mounted battle standard and an energy
 * greatsword. Particle FX sell the Battle Standard trait: a pulsing aura ring
 * underfoot, energy motes orbiting the chest core, and gold embers rising off
 * the banner.
 */
function buildHumanHero(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const gild = { metallic: 0.95, roughness: 0.15 }

  const childPart = (parent: Entity, position: Vector3, scale: Vector3, color: Color4, options: PartOptions = {}): Entity =>
    heroChildPart(rig, parent, position, scale, color, options)
  const makePivot = (position: Vector3): Entity => heroPivot(rig, position)

  // --- Legs: boots, greaves and knee guards hung from hip pivots so the ---
  // attack cycle can take a real step. legPivots[0] = left, [1] = right.
  const legPivots: Entity[] = []
  for (const side of [-1, 1]) {
    const hip = makePivot(Vector3.create(side * 0.22, 0.85, 0))
    legPivots.push(hip)
    childPart(hip, Vector3.create(0, -0.76, 0.03), Vector3.create(0.26, 0.18, 0.42), METAL_DARK)
    childPart(hip, Vector3.create(0, -0.43, 0), Vector3.create(0.2, 0.52, 0.24), METAL_LIGHT)
    childPart(hip, Vector3.create(0, -0.15, 0.06), Vector3.create(0.2, 0.16, 0.22), HERO_GOLD, { ...gild, rotation: Quaternion.fromEulerDegrees(-12, 0, 0) })
  }

  // --- Hips: pelvis block, command belt and hanging tasset plates. --------
  addPart(Vector3.create(0, 0.88, 0), Vector3.create(0.5, 0.22, 0.32), METAL_DARK)
  addPart(Vector3.create(0, 1, 0), Vector3.create(0.56, 0.09, 0.38), HERO_GOLD, gild)
  addPart(Vector3.create(0, 1.02, 0.2), Vector3.create(0.14, 0.12, 0.05), glow, { emissive: glow, emissiveIntensity: 3 })
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.3, 0.8, 0), Vector3.create(0.1, 0.34, 0.3), HUMAN_HULL, { rotation: Quaternion.fromEulerDegrees(0, 0, side * 10) })
  }
  addPart(Vector3.create(0, 0.78, 0.17), Vector3.create(0.24, 0.32, 0.06), HUMAN_HULL, { rotation: Quaternion.fromEulerDegrees(8, 0, 0) })

  // --- Torso: abdomen, broad chest plate, glowing core, back armor. -------
  addPart(Vector3.create(0, 1.16, 0), Vector3.create(0.42, 0.24, 0.3), METAL_LIGHT)
  addPart(Vector3.create(0, 1.44, 0), Vector3.create(0.62, 0.44, 0.4), HUMAN_HULL)
  addPart(Vector3.create(0, 1.62, 0), Vector3.create(0.66, 0.1, 0.44), METAL_DARK)
  // Reactor core - the visual anchor of the Battle Standard aura.
  addPart(Vector3.create(0, 1.48, 0.19), Vector3.create(0.2, 0.2, 0.07), glow, { cylinder: true, emissive: glow, emissiveIntensity: 4, rotation: Quaternion.fromEulerDegrees(90, 0, 0) })
  // Gold trim chevrons running from the core up to each shoulder.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.18, 1.56, 0.2), Vector3.create(0.22, 0.05, 0.04), HERO_GOLD, { ...gild, rotation: Quaternion.fromEulerDegrees(0, 0, side * 24) })
  }
  addPart(Vector3.create(0, 1.44, -0.19), Vector3.create(0.5, 0.38, 0.1), METAL_DARK)

  // --- Pauldrons: double-layered with a glowing rim light. ----------------
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.44, 1.6, 0), Vector3.create(0.34, 0.18, 0.42), METAL_LIGHT, { rotation: Quaternion.fromEulerDegrees(0, 0, side * -8) })
    addPart(Vector3.create(side * 0.47, 1.72, 0), Vector3.create(0.38, 0.12, 0.46), HUMAN_HULL, { rotation: Quaternion.fromEulerDegrees(0, 0, side * -12) })
    addPart(Vector3.create(side * 0.56, 1.78, 0), Vector3.create(0.05, 0.05, 0.42), glow, { emissive: glow, emissiveIntensity: 2.4, rotation: Quaternion.fromEulerDegrees(0, 0, side * -12) })
  }

  // --- Left arm: fixed at his side, fist clenched. -------------------------
  addPart(Vector3.create(-0.5, 1.36, 0.02), Vector3.create(0.15, 0.32, 0.17), METAL_DARK)
  addPart(Vector3.create(-0.54, 1.06, 0.06), Vector3.create(0.18, 0.3, 0.2), METAL_LIGHT)
  addPart(Vector3.create(-0.54, 0.94, 0.1), Vector3.create(0.16, 0.12, 0.16), HERO_GOLD, gild)

  // --- Right arm + greatsword: one limb hanging from a shoulder pivot. The
  // attack track winds the whole arm back, then chops it through the front.
  const shoulder = makePivot(Vector3.create(0.5, 1.62, 0))
  childPart(shoulder, Vector3.create(0, -0.26, 0.02), Vector3.create(0.15, 0.32, 0.17), METAL_DARK)
  childPart(shoulder, Vector3.create(0.04, -0.56, 0.06), Vector3.create(0.18, 0.3, 0.2), METAL_LIGHT)
  childPart(shoulder, Vector3.create(0.04, -0.68, 0.1), Vector3.create(0.16, 0.12, 0.16), HERO_GOLD, gild)

  // Sword seated in the fist, leaning slightly forward and outward at rest.
  const swordRoot = engine.addEntity()
  Transform.create(swordRoot, {
    parent: shoulder,
    position: Vector3.create(0.06, -0.62, 0.1),
    rotation: Quaternion.fromEulerDegrees(14, 0, -9)
  })
  rig.parts.push(swordRoot)

  childPart(swordRoot, Vector3.create(0, 0, 0), Vector3.create(0.055, 0.3, 0.055), METAL_DARK, { cylinder: true })
  childPart(swordRoot, Vector3.create(0, -0.17, 0), Vector3.create(0.09, 0.09, 0.09), HERO_GOLD, { ...gild, sphere: true })
  childPart(swordRoot, Vector3.create(0, 0.16, 0), Vector3.create(0.32, 0.07, 0.12), HERO_GOLD, gild)
  childPart(swordRoot, Vector3.create(0, 0.76, 0), Vector3.create(0.1, 1.14, 0.05), BLADE_STEEL, { metallic: 0.85, roughness: 0.25 })
  childPart(swordRoot, Vector3.create(0, 0.76, 0), Vector3.create(0.045, 1.1, 0.06), glow, { emissive: glow, emissiveIntensity: 5 })
  childPart(swordRoot, Vector3.create(0, 1.42, 0), Vector3.create(0.09, 0.22, 0.05), glow, { cone: true, emissive: glow, emissiveIntensity: 5 })

  // --- Attack choreography: forward-only cleave. ----------------------------
  // Every cycle STARTS with the blade already cocked overhead (no visible
  // backswing) and chops immediately; the slow tail of the cycle just raises
  // the sword back up ready for the next blow. Shoulder and wrist X-rotations
  // share a world axis, so blade pitch = shoulder + wrist + 14 (rest lean).
  //   0.00       ready: arm slightly raised, blade dead vertical (never
  //              behind his head - keeps the loop free of any backswing)
  //   0.00-0.16  the cleave: arm whips forward-down, wrist snaps through -
  //              the blade sweeps ~100 degrees forward and lands pointing
  //              at the target (~+100); the stride plants here too
  //   0.16-0.50  follow-through hold at full extension
  //   0.50-0.95  slow recovery: sword rises straight back up to vertical
  rig.attackTracks = [
    { entity: legPivots[0], rest: Vector3.Zero(), keys: [[0, 0, 0, 0], [0.12, -36, 0, 0], [0.5, -30, 0, 0], [0.9, 0, 0, 0], [1, 0, 0, 0]] },
    { entity: legPivots[1], rest: Vector3.Zero(), keys: [[0, 0, 0, 0], [0.12, 20, 0, 0], [0.5, 16, 0, 0], [0.9, 0, 0, 0], [1, 0, 0, 0]] },
    { entity: shoulder, rest: Vector3.Zero(), keys: [[0, 10, 0, -6], [0.16, -60, 0, 10], [0.3, -48, 0, 6], [0.5, -48, 0, 6], [0.95, 10, 0, -6], [1, 10, 0, -6]] },
    { entity: swordRoot, rest: Vector3.create(14, 0, -9), keys: [[0, -24, 0, 2], [0.16, 146, 0, -4], [0.3, 120, 0, 0], [0.5, 120, 0, 0], [0.95, -24, 0, 2], [1, -24, 0, 2]] }
  ]

  // --- Head: commander helm, glowing T-visor, cheek guards, gold crest. ---
  addPart(Vector3.create(0, 1.72, 0), Vector3.create(0.12, 0.1, 0.12), METAL_DARK, { cylinder: true })
  addPart(Vector3.create(0, 1.9, 0.02), Vector3.create(0.27, 0.28, 0.3), METAL_DARK)
  addPart(Vector3.create(0, 1.94, 0.17), Vector3.create(0.21, 0.055, 0.04), glow, { emissive: glow, emissiveIntensity: 4 })
  addPart(Vector3.create(0, 1.86, 0.17), Vector3.create(0.055, 0.12, 0.04), glow, { emissive: glow, emissiveIntensity: 4 })
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.15, 1.85, 0.1), Vector3.create(0.04, 0.16, 0.14), HERO_GOLD, gild)
  }
  addPart(Vector3.create(0, 2.1, 0), Vector3.create(0.06, 0.14, 0.4), HERO_GOLD, gild)
  addPart(Vector3.create(0, 2.2, -0.06), Vector3.create(0.03, 0.08, 0.26), glow, { emissive: glow, emissiveIntensity: 2.2 })

  // --- Command cape: two draped crimson segments with a gold hem. ---------
  addPart(Vector3.create(0, 1.5, -0.3), Vector3.create(0.56, 0.5, 0.05), CAPE_CRIMSON, { roughness: 0.95, metallic: 0.05, rotation: Quaternion.fromEulerDegrees(-7, 0, 0) })
  addPart(Vector3.create(0, 1.02, -0.37), Vector3.create(0.5, 0.55, 0.04), CAPE_CRIMSON, { roughness: 0.95, metallic: 0.05, rotation: Quaternion.fromEulerDegrees(-11, 0, 0) })
  addPart(Vector3.create(0, 0.74, -0.42), Vector3.create(0.5, 0.06, 0.05), HERO_GOLD, { ...gild, rotation: Quaternion.fromEulerDegrees(-11, 0, 0) })

  // --- Battle standard: pole, crossbar, sigil banner, glowing finial. -----
  addPart(Vector3.create(-0.32, 1.95, -0.28), Vector3.create(0.05, 1.75, 0.05), METAL_LIGHT, { cylinder: true })
  addPart(Vector3.create(-0.32, 2.72, -0.28), Vector3.create(0.52, 0.045, 0.045), HERO_GOLD, gild)
  addPart(Vector3.create(-0.15, 2.42, -0.28), Vector3.create(0.36, 0.55, 0.03), CAPE_CRIMSON, { roughness: 0.95, metallic: 0.05 })
  addPart(Vector3.create(-0.15, 2.42, -0.26), Vector3.create(0.13, 0.13, 0.02), glow, { emissive: glow, emissiveIntensity: 3.2, rotation: Quaternion.fromEulerDegrees(0, 0, 45) })
  addPart(Vector3.create(-0.15, 2.12, -0.28), Vector3.create(0.36, 0.05, 0.035), HERO_GOLD, gild)
  addPart(Vector3.create(-0.32, 2.86, -0.28), Vector3.create(0.1, 0.1, 0.1), glow, { sphere: true, emissive: glow, emissiveIntensity: 4 })

  // --- Particle FX -------------------------------------------------------
  // Battle Standard aura: a pulsing ground ring in the team color.
  const auraRing = addPart(Vector3.create(0, 0.04, 0), Vector3.create(1.5, 0.025, 1.5), Color4.create(glow.r, glow.g, glow.b, 0.22), { cylinder: true, emissive: glow, emissiveIntensity: 1.0 })
  rig.fx.push({ entity: auraRing, mode: 'pulse', anchor: Vector3.create(0, 0.04, 0), radius: 0, height: 0, speed: 2.4, phase: 0, size: 1.5 })
  const auraCore = addPart(Vector3.create(0, 0.07, 0), Vector3.create(0.9, 0.02, 0.9), Color4.create(glow.r, glow.g, glow.b, 0.12), { cylinder: true, emissive: glow, emissiveIntensity: 0.6 })
  rig.fx.push({ entity: auraCore, mode: 'pulse', anchor: Vector3.create(0, 0.07, 0), radius: 0, height: 0, speed: 2.4, phase: Math.PI, size: 0.9 })
  rig.groundFx.push(auraRing, auraCore)

  // Energy motes circling the reactor core.
  for (let i = 0; i < 3; i++) {
    const mote = addPart(Vector3.create(0, 1.45, 0), Vector3.create(0.06, 0.06, 0.06), glow, { sphere: true, emissive: glow, emissiveIntensity: 4 })
    rig.fx.push({ entity: mote, mode: 'orbit', anchor: Vector3.create(0, 1.45, 0), radius: 0.55, height: 0.14, speed: 1.7, phase: (i / 3) * Math.PI * 2, size: 0.06 })
  }

  // Gold embers drifting up from the battle standard.
  for (let i = 0; i < 4; i++) {
    const ember = addPart(Vector3.create(-0.2, 2.3, -0.28), Vector3.create(0.045, 0.045, 0.045), HERO_GOLD, { emissive: HERO_GOLD, emissiveIntensity: 3.4 })
    rig.fx.push({ entity: ember, mode: 'ember', anchor: Vector3.create(-0.2, 2.3, -0.28), radius: 0.1, height: 0.85, speed: 0.42, phase: i / 4, size: 0.045 })
  }

  rig.profiles = {
    idle: { amplitude: 0.025, speed: 1.6, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.055, speed: 5, tilt: 5, spin: 0, lunge: 0 },
    talk: { amplitude: 0.03, speed: 7, tilt: 3, spin: 0, lunge: 0 },
    // Speed 7 = a ~0.9s step-windup-chop cycle; the lunge peak lands on the stride.
    // Positive tilt = leaning into the strike (negative would rock him back on his heels).
    attack: { amplitude: 0.04, speed: 7, tilt: 7, spin: 0, lunge: 0.22 },
    impact: { amplitude: 0.06, speed: 16, tilt: -8, spin: 0, lunge: 0 }
  }

  applyHeroScale(rig, 1.35)
}

/**
 * Riftlord Auren: a levitating psionic archon dragging a torn-open rift
 * behind him. No legs - a void shroud with floating gold rings and a glowing
 * tip. Four arms (two casting orbs, one raised orb hand, one commanding a
 * double-bladed rift glaive), crystal energy wings that flare when he
 * strikes, a triple halo that tilts with the attack, and a vertical void
 * tear crackling at his back. FX: two counter-rotating belts of void shards,
 * embers off the halo and portal, and a pulsing rift ring underfoot
 * (showcase only).
 */
function buildAlienHero(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const gild = { metallic: 0.9, roughness: 0.2 }
  const flipped = Quaternion.fromEulerDegrees(180, 0, 0)

  // --- Void tear: a torn rift floating at his back. -------------------------
  addPart(Vector3.create(0, 2.05, -0.62), Vector3.create(1.0, 1.7, 0.1), ALIEN_CRYSTAL, { sphere: true, emissive: glow, emissiveIntensity: 2.6 })
  addPart(Vector3.create(0, 2.05, -0.58), Vector3.create(0.64, 1.2, 0.09), ALIEN_DARK, { sphere: true, emissive: ALIEN_DARK, emissiveIntensity: 0.4 })

  // --- Hover shroud: point-down robe cone, glowing tip, floating gold rings.
  addPart(Vector3.create(0, 1.0, 0), Vector3.create(0.95, 1.1, 0.95), ALIEN_DARK, { cone: true, rotation: flipped })
  addPart(Vector3.create(0, 0.46, 0), Vector3.create(0.28, 0.5, 0.28), ALIEN_CRYSTAL, { cone: true, rotation: flipped, emissive: glow, emissiveIntensity: 2.6 })
  const ringA = addPart(Vector3.create(0, 1.32, 0), Vector3.create(0.58, 0.05, 0.58), ALIEN_GOLD, { cylinder: true, ...gild })
  rig.fx.push({ entity: ringA, mode: 'pulse', anchor: Vector3.create(0, 1.32, 0), radius: 0, height: 0, speed: 1.9, phase: 0, size: 0.58 })
  const ringB = addPart(Vector3.create(0, 0.92, 0), Vector3.create(0.74, 0.045, 0.74), ALIEN_GOLD, { cylinder: true, ...gild })
  rig.fx.push({ entity: ringB, mode: 'pulse', anchor: Vector3.create(0, 0.92, 0), radius: 0, height: 0, speed: 1.9, phase: Math.PI, size: 0.74 })
  addPart(Vector3.create(0, 1.52, 0), Vector3.create(0.64, 0.12, 0.64), ALIEN_GOLD, { cylinder: true, ...gild })

  // --- Torso: slender chest, blazing psi core, gold collar. -----------------
  addPart(Vector3.create(0, 1.82, 0), Vector3.create(0.52, 0.55, 0.38), ALIEN_DARK)
  addPart(Vector3.create(0, 2.0, 0.16), Vector3.create(0.18, 0.18, 0.12), glow, { sphere: true, emissive: glow, emissiveIntensity: 5 })
  addPart(Vector3.create(0, 2.14, 0), Vector3.create(0.6, 0.1, 0.44), ALIEN_GOLD, gild)

  // --- Pauldrons with detached ward crystals hovering above. ----------------
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.42, 2.2, 0), Vector3.create(0.3, 0.14, 0.36), ALIEN_GOLD, { ...gild, rotation: Quaternion.fromEulerDegrees(0, 0, side * -18) })
    addPart(Vector3.create(side * 0.52, 2.54, 0), Vector3.create(0.1, 0.38, 0.1), ALIEN_CRYSTAL, { cone: true, emissive: ALIEN_CRYSTAL, emissiveIntensity: 2.6 })
  }

  // --- Crystal energy wings: fans of shards on flare pivots. ----------------
  const wingPivots: Entity[] = []
  for (const side of [-1, 1]) {
    const wing = heroPivot(rig, Vector3.create(side * 0.4, 2.05, -0.28))
    wingPivots.push(wing)
    for (let i = 0; i < 3; i++) {
      heroChildPart(
        rig,
        wing,
        Vector3.create(side * (0.16 + 0.2 * i), 0.3 + 0.16 * i, -0.04),
        Vector3.create(0.08, 0.52 + 0.14 * i, 0.08),
        ALIEN_CRYSTAL,
        { cone: true, emissive: ALIEN_CRYSTAL, emissiveIntensity: 2.8, rotation: Quaternion.fromEulerDegrees(0, 0, side * -(16 + 15 * i)) }
      )
    }
  }

  // --- Four arms: raised orb hand, glaive hand, and two lower casting arms. -
  addPart(Vector3.create(-0.5, 1.9, 0.04), Vector3.create(0.13, 0.5, 0.15), ALIEN_DARK, { rotation: Quaternion.fromEulerDegrees(0, 0, 16) })
  addPart(Vector3.create(-0.62, 1.54, 0.1), Vector3.create(0.14, 0.14, 0.14), ALIEN_CRYSTAL, { sphere: true, emissive: glow, emissiveIntensity: 3.6 })
  addPart(Vector3.create(0.48, 1.88, 0.02), Vector3.create(0.13, 0.5, 0.15), ALIEN_DARK)
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.34, 1.56, 0.16), Vector3.create(0.1, 0.38, 0.12), ALIEN_DARK, { rotation: Quaternion.fromEulerDegrees(-14, 0, side * 10) })
    addPart(Vector3.create(side * 0.4, 1.3, 0.24), Vector3.create(0.09, 0.09, 0.09), ALIEN_CRYSTAL, { sphere: true, emissive: glow, emissiveIntensity: 3 })
  }

  // --- Head: sleek helm, burning eye slit, three-pronged gold crown. --------
  addPart(Vector3.create(0, 2.4, 0), Vector3.create(0.24, 0.3, 0.28), ALIEN_DARK)
  addPart(Vector3.create(0, 2.44, 0.15), Vector3.create(0.15, 0.045, 0.04), glow, { emissive: glow, emissiveIntensity: 5 })
  addPart(Vector3.create(0, 2.72, -0.02), Vector3.create(0.07, 0.42, 0.07), ALIEN_GOLD, { cone: true, ...gild })
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.13, 2.62, -0.02), Vector3.create(0.06, 0.3, 0.06), ALIEN_GOLD, { cone: true, ...gild, rotation: Quaternion.fromEulerDegrees(0, 0, side * 16) })
  }

  // --- Triple rift halo on a tilting pivot (pulse fx spins the outer ring). -
  const haloPivot = heroPivot(rig, Vector3.create(0, 3.1, 0))
  const haloOuter = heroChildPart(rig, haloPivot, Vector3.create(0, 0, 0), Vector3.create(1.15, 0.05, 1.15), ALIEN_CRYSTAL, { cylinder: true, emissive: ALIEN_CRYSTAL, emissiveIntensity: 2.8 })
  rig.fx.push({ entity: haloOuter, mode: 'pulse', anchor: Vector3.create(0, 0, 0), radius: 0, height: 0, speed: 1.7, phase: 0, size: 1.15 })
  heroChildPart(rig, haloPivot, Vector3.create(0, 0.09, 0), Vector3.create(0.72, 0.06, 0.72), ALIEN_GOLD, { cylinder: true, ...gild })
  heroChildPart(rig, haloPivot, Vector3.create(0, 0.16, 0), Vector3.create(0.4, 0.07, 0.4), ALIEN_DARK, { cylinder: true })

  // --- Double-bladed rift glaive floating at the right hand. ----------------
  const glaivePivot = heroPivot(rig, Vector3.create(0.56, 1.92, 0.06))
  heroChildPart(rig, glaivePivot, Vector3.create(0.04, -0.3, 0.04), Vector3.create(0.05, 2.2, 0.05), ALIEN_GOLD, { cylinder: true, ...gild })
  heroChildPart(rig, glaivePivot, Vector3.create(0.04, 0.92, 0.04), Vector3.create(0.14, 0.64, 0.05), ALIEN_CRYSTAL, { emissive: glow, emissiveIntensity: 5 })
  heroChildPart(rig, glaivePivot, Vector3.create(0.04, 1.4, 0.04), Vector3.create(0.11, 0.34, 0.05), ALIEN_CRYSTAL, { cone: true, emissive: glow, emissiveIntensity: 5 })
  heroChildPart(rig, glaivePivot, Vector3.create(0.04, -1.32, 0.04), Vector3.create(0.11, 0.42, 0.05), ALIEN_CRYSTAL, { emissive: glow, emissiveIntensity: 4 })
  heroChildPart(rig, glaivePivot, Vector3.create(0.04, -1.62, 0.04), Vector3.create(0.09, 0.26, 0.05), ALIEN_CRYSTAL, { cone: true, emissive: glow, emissiveIntensity: 4, rotation: flipped })

  // --- Particle FX -----------------------------------------------------------
  // Rift ring underfoot (showcase pedestal only).
  const riftRing = addPart(Vector3.create(0, 0.04, 0), Vector3.create(1.4, 0.02, 1.4), Color4.create(glow.r, glow.g, glow.b, 0.2), { cylinder: true, emissive: glow, emissiveIntensity: 0.9 })
  rig.fx.push({ entity: riftRing, mode: 'pulse', anchor: Vector3.create(0, 0.04, 0), radius: 0, height: 0, speed: 2.2, phase: 0, size: 1.4 })
  rig.groundFx.push(riftRing)

  // Two belts of void shards: a slow wide belt around the shroud and a
  // faster, higher belt streaking around the halo.
  for (let i = 0; i < 4; i++) {
    const shard = addPart(Vector3.create(0, 1.2, 0), Vector3.create(0.07, 0.26, 0.07), ALIEN_CRYSTAL, { emissive: ALIEN_CRYSTAL, emissiveIntensity: 2.8 })
    rig.fx.push({ entity: shard, mode: 'orbit', anchor: Vector3.create(0, 1.2, 0), radius: 0.85, height: 0.22, speed: 1.3, phase: (i / 4) * Math.PI * 2, size: 0.07 })
  }
  for (let i = 0; i < 3; i++) {
    const shard = addPart(Vector3.create(0, 2.6, 0), Vector3.create(0.06, 0.2, 0.06), ALIEN_CRYSTAL, { emissive: ALIEN_CRYSTAL, emissiveIntensity: 3.2 })
    rig.fx.push({ entity: shard, mode: 'orbit', anchor: Vector3.create(0, 2.6, 0), radius: 1.05, height: 0.14, speed: 2.3, phase: (i / 3) * Math.PI * 2 + 1, size: 0.06 })
  }

  // Embers rising off the halo and streaming up the void tear.
  for (let i = 0; i < 3; i++) {
    const mote = addPart(Vector3.create(0, 3.15, 0), Vector3.create(0.05, 0.05, 0.05), ALIEN_CRYSTAL, { sphere: true, emissive: ALIEN_CRYSTAL, emissiveIntensity: 3.4 })
    rig.fx.push({ entity: mote, mode: 'ember', anchor: Vector3.create(0, 3.15, 0), radius: 0.3, height: 0.6, speed: 0.42, phase: i / 3, size: 0.05 })
  }
  for (let i = 0; i < 4; i++) {
    const spark = addPart(Vector3.create(0, 1.4, -0.6), Vector3.create(0.045, 0.045, 0.045), glow, { emissive: glow, emissiveIntensity: 3.6 })
    rig.fx.push({ entity: spark, mode: 'ember', anchor: Vector3.create(0, 1.4, -0.6), radius: 0.4, height: 1.3, speed: 0.5, phase: i / 4, size: 0.045 })
  }

  // --- Attack: the glaive windmills - two full forward rotations, easing ---
  // in and out of the spin, while both wings snap open and the halo tips
  // forward. 720 degrees lands the glaive exactly back at its vertical rest.
  rig.attackTracks = [
    { entity: glaivePivot, rest: Vector3.Zero(), keys: [[0, 0, 0, 0], [0.6, 720, 0, 0], [1, 720, 0, 0]] },
    { entity: wingPivots[0], rest: Vector3.Zero(), keys: [[0, 0, 0, 0], [0.14, 0, 0, 24], [0.5, 0, 0, 18], [0.95, 0, 0, 0], [1, 0, 0, 0]] },
    { entity: wingPivots[1], rest: Vector3.Zero(), keys: [[0, 0, 0, 0], [0.14, 0, 0, -24], [0.5, 0, 0, -18], [0.95, 0, 0, 0], [1, 0, 0, 0]] },
    { entity: haloPivot, rest: Vector3.Zero(), keys: [[0, 0, 0, 0], [0.14, 26, 0, 0], [0.55, 18, 0, 0], [0.95, 0, 0, 0], [1, 0, 0, 0]] }
  ]

  rig.baseHeight = 0.3
  rig.profiles = {
    idle: { amplitude: 0.09, speed: 1.5, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.11, speed: 3.2, tilt: 6, spin: 0, lunge: 0 },
    talk: { amplitude: 0.06, speed: 6, tilt: 3, spin: 0, lunge: 0 },
    attack: { amplitude: 0.07, speed: 7, tilt: 5, spin: 0, lunge: 0.26 },
    impact: { amplitude: 0.09, speed: 15, tilt: -7, spin: 0, lunge: 0 }
  }

  applyHeroScale(rig, 1.25)
}

/**
 * Broodmother Szel: a hulking brood queen. Four chitin legs under a raised
 * thorax, a swollen abdomen dragging behind under overlapping carapace
 * shells, pulsing egg sacs, a tusk-crowned head with four burning eyes, and
 * two raised mantis scythes that slash forward in an alternating one-two
 * when she attacks. FX: pulsing egg sacs, spores drifting off the abdomen
 * and a brood ring underfoot.
 */
function buildBioHero(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const meat = { roughness: 0.95, metallic: 0.05 }

  // --- Legs: four splayed chitin legs; the front pair stomps on the kill. --
  const frontLegPivots: Entity[] = []
  for (const side of [-1, 1]) {
    // Front leg on an animation pivot.
    const hip = heroPivot(rig, Vector3.create(side * 0.5, 0.75, 0.35))
    frontLegPivots.push(hip)
    heroChildPart(rig, hip, Vector3.create(side * 0.12, -0.32, 0.02), Vector3.create(0.16, 0.55, 0.16), BIO_CARAPACE, { ...meat, rotation: Quaternion.fromEulerDegrees(0, 0, side * 22) })
    heroChildPart(rig, hip, Vector3.create(side * 0.24, -0.66, 0.02), Vector3.create(0.11, 0.3, 0.11), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(180, 0, side * 10) })
    // Rear leg welded to the body.
    addPart(Vector3.create(side * 0.62, 0.42, -0.35), Vector3.create(0.16, 0.55, 0.16), BIO_CARAPACE, { ...meat, rotation: Quaternion.fromEulerDegrees(0, 0, side * 30) })
    addPart(Vector3.create(side * 0.78, 0.1, -0.35), Vector3.create(0.11, 0.28, 0.11), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(180, 0, side * 14) })
  }

  // --- Body: raised thorax up front, swollen abdomen dragging behind. ------
  addPart(Vector3.create(0, 1.0, 0.3), Vector3.create(0.75, 0.62, 0.7), BIO_FLESH, meat)
  addPart(Vector3.create(0, 1.18, 0.58), Vector3.create(0.5, 0.42, 0.22), BIO_CARAPACE, meat)
  addPart(Vector3.create(0, 0.92, -0.6), Vector3.create(1.05, 0.8, 1.15), BIO_FLESH, { sphere: true, ...meat })

  // Overlapping carapace shells armoring the abdomen, each ridged with bone.
  const shells: [Vector3, Vector3, number][] = [
    [Vector3.create(0, 1.32, -0.3), Vector3.create(0.85, 0.16, 0.55), -8],
    [Vector3.create(0, 1.26, -0.72), Vector3.create(0.75, 0.15, 0.5), -22],
    [Vector3.create(0, 1.06, -1.08), Vector3.create(0.6, 0.14, 0.45), -38]
  ]
  for (const [position, scale, pitch] of shells) {
    addPart(position, scale, BIO_CARAPACE, { ...meat, rotation: Quaternion.fromEulerDegrees(pitch, 0, 0) })
    addPart(Vector3.create(position.x, position.y + 0.14, position.z), Vector3.create(0.09, 0.3, 0.09), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(pitch, 0, 0) })
  }

  // Egg sacs glowing with the next brood (pulse fx breathes them).
  const sacSpots: [Vector3, number][] = [
    [Vector3.create(-0.6, 0.62, -0.78), 0.5],
    [Vector3.create(0.56, 0.58, -0.86), 0.42],
    [Vector3.create(0, 0.55, -1.18), 0.48]
  ]
  for (let i = 0; i < sacSpots.length; i++) {
    const [spot, size] = sacSpots[i]
    const sac = addPart(spot, Vector3.create(size, size, size), BIO_FLESH, { sphere: true, ...meat, emissive: glow, emissiveIntensity: 1.1 })
    rig.fx.push({ entity: sac, mode: 'pulse', anchor: spot, radius: 0, height: 0, speed: 1.6, phase: (i / 3) * Math.PI * 2, size })
  }

  // --- Head: low-slung, four burning eyes, bone mandibles, tusk crown. -----
  addPart(Vector3.create(0, 1.12, 0.88), Vector3.create(0.42, 0.36, 0.4), BIO_CARAPACE, meat)
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.1, 1.2, 1.08), Vector3.create(0.055, 0.055, 0.03), glow, { sphere: true, emissive: glow, emissiveIntensity: 4.5 })
    addPart(Vector3.create(side * 0.17, 1.12, 1.07), Vector3.create(0.045, 0.045, 0.03), glow, { sphere: true, emissive: glow, emissiveIntensity: 4.5 })
    addPart(Vector3.create(side * 0.14, 0.96, 1.05), Vector3.create(0.07, 0.26, 0.07), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(150, 0, side * -16) })
    addPart(Vector3.create(side * 0.3, 1.42, 0.8), Vector3.create(0.11, 0.6, 0.11), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(-12, 0, side * 26) })
  }

  // --- Scythe forelimbs: raised mantis arms that slash down and forward. ---
  const scythePivots: Entity[] = []
  for (const side of [-1, 1]) {
    const shoulderJoint = heroPivot(rig, Vector3.create(side * 0.52, 1.32, 0.52))
    scythePivots.push(shoulderJoint)
    heroChildPart(rig, shoulderJoint, Vector3.create(side * 0.06, -0.05, 0.28), Vector3.create(0.14, 0.65, 0.14), BIO_CARAPACE, { ...meat, rotation: Quaternion.fromEulerDegrees(58, 0, side * 8) })
    heroChildPart(rig, shoulderJoint, Vector3.create(side * 0.1, 0.32, 0.62), Vector3.create(0.1, 0.85, 0.1), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(38, 0, side * 4) })
    heroChildPart(rig, shoulderJoint, Vector3.create(side * 0.11, 0.55, 0.78), Vector3.create(0.05, 0.05, 0.05), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })
  }

  // --- Particle FX ---------------------------------------------------------
  const broodRing = addPart(Vector3.create(0, 0.04, 0), Vector3.create(1.6, 0.02, 1.6), Color4.create(glow.r, glow.g, glow.b, 0.2), { cylinder: true, emissive: glow, emissiveIntensity: 0.9 })
  rig.fx.push({ entity: broodRing, mode: 'pulse', anchor: Vector3.create(0, 0.04, 0), radius: 0, height: 0, speed: 2, phase: 0, size: 1.6 })
  rig.groundFx.push(broodRing)

  // Spores drifting up off the abdomen.
  for (let i = 0; i < 4; i++) {
    const spore = addPart(Vector3.create(0, 1.3, -0.7), Vector3.create(0.05, 0.05, 0.05), glow, { sphere: true, emissive: glow, emissiveIntensity: 2.8 })
    rig.fx.push({ entity: spore, mode: 'ember', anchor: Vector3.create(0, 1.3, -0.7), radius: 0.45, height: 0.75, speed: 0.35, phase: i / 4, size: 0.05 })
  }

  // --- Attack: alternating forward-only scythe slashes. --------------------
  // Right scythe rips down-forward on the first beat, left follows half a
  // beat later, front legs stomp with the hits, then both arms rise slowly
  // back to the mantis guard - nothing ever swings behind her.
  rig.attackTracks = [
    { entity: scythePivots[1], rest: Vector3.Zero(), keys: [[0, 0, 0, 0], [0.12, 78, 0, -6], [0.3, 72, 0, -4], [0.5, 72, 0, -4], [0.95, 0, 0, 0], [1, 0, 0, 0]] },
    { entity: scythePivots[0], rest: Vector3.Zero(), keys: [[0, 0, 0, 0], [0.16, 0, 0, 0], [0.3, 78, 0, 6], [0.48, 70, 0, 4], [0.62, 70, 0, 4], [0.95, 0, 0, 0], [1, 0, 0, 0]] },
    { entity: frontLegPivots[0], rest: Vector3.Zero(), keys: [[0, 0, 0, 0], [0.12, -14, 0, 0], [0.5, -10, 0, 0], [0.9, 0, 0, 0], [1, 0, 0, 0]] },
    { entity: frontLegPivots[1], rest: Vector3.Zero(), keys: [[0, 0, 0, 0], [0.3, -14, 0, 0], [0.6, -10, 0, 0], [0.9, 0, 0, 0], [1, 0, 0, 0]] }
  ]

  rig.profiles = {
    idle: { amplitude: 0.035, speed: 1.4, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.07, speed: 4.5, tilt: 4, spin: 0, lunge: 0 },
    talk: { amplitude: 0.04, speed: 6, tilt: 2, spin: 0, lunge: 0 },
    attack: { amplitude: 0.05, speed: 7, tilt: 6, spin: 0, lunge: 0.26 },
    impact: { amplitude: 0.07, speed: 14, tilt: -6, spin: 0, lunge: 0 }
  }

  applyHeroScale(rig, 1.35)
}

/** Cargo strapped to a worker's back: faceted mineral crystals or a banded gas barrel. */
function addWorkerCargo(rig: UnitRig, addPart: PartAdder): void {
  rig.mineralCargo = [
    addPart(Vector3.create(0, 0.95, -0.42), Vector3.create(0.24, 0.34, 0.24), MINERAL_CARGO_BLUE, {
      emissive: MINERAL_CARGO_GLOW,
      emissiveIntensity: 1,
      rotation: Quaternion.fromEulerDegrees(18, 45, 0)
    }),
    addPart(Vector3.create(0.12, 0.82, -0.4), Vector3.create(0.14, 0.2, 0.14), MINERAL_CARGO_BLUE, {
      emissive: MINERAL_CARGO_GLOW,
      emissiveIntensity: 1,
      rotation: Quaternion.fromEulerDegrees(-12, 70, 8)
    })
  ]
  rig.gasCargo = [
    addPart(Vector3.create(0, 0.9, -0.42), Vector3.create(0.22, 0.34, 0.22), GAS_BARREL_GREEN, {
      cylinder: true,
      emissive: GAS_BARREL_GLOW,
      emissiveIntensity: 0.5,
      rotation: Quaternion.fromEulerDegrees(10, 0, 0)
    }),
    addPart(Vector3.create(0, 0.99, -0.445), Vector3.create(0.24, 0.04, 0.24), METAL_LIGHT, {
      cylinder: true,
      rotation: Quaternion.fromEulerDegrees(10, 0, 0)
    }),
    addPart(Vector3.create(0, 0.81, -0.415), Vector3.create(0.24, 0.04, 0.24), METAL_LIGHT, {
      cylinder: true,
      rotation: Quaternion.fromEulerDegrees(10, 0, 0)
    })
  ]
  for (const part of [...rig.mineralCargo, ...rig.gasCargo]) {
    VisibilityComponent.createOrReplace(part, { visible: false })
  }
}

export function isProceduralUnit(root: Entity): boolean {
  return rigs.has(root)
}

/** Forces a fixed body tilt regardless of animation state (pass undefined to restore). */
export function setUnitBodyTilt(root: Entity, tilt: number | undefined): void {
  const rig = rigs.get(root)
  if (rig) rig.tiltOverride = tilt
}

/** Maps animation clip names onto the rig's procedural motion profiles. */
/** Grows (or retracts) a siege unit's deployed cannon: 0 = mobile, 1 = fully dug in. */
export function setSiegeDeployProgress(root: Entity, progress: number): void {
  const rig = rigs.get(root)
  if (!rig?.siegeCannon) return
  const clamped = Math.max(0.0001, Math.min(1, progress))
  Transform.getMutable(rig.siegeCannon).scale = Vector3.create(clamped, clamped, clamped)
}

/** Creates the (initially retracted) deployed-mode group for a siege builder. */
function createSiegeCannonGroup(rig: UnitRig): Entity {
  const group = engine.addEntity()
  Transform.create(group, { parent: rig.bodyRoot, position: Vector3.create(0, 0, 0), scale: Vector3.create(0.0001, 0.0001, 0.0001) })
  rig.parts.push(group)
  rig.siegeCannon = group
  return group
}

export function setUnitAnimation(root: Entity, clipName: string): void {
  const rig = rigs.get(root)
  if (!rig) return

  let next: UnitAnimState = 'idle'
  if (clipName === 'walk') next = 'walk'
  else if (clipName === 'talk') next = 'talk'
  else if (clipName === 'attack') next = 'attack'
  else if (clipName === 'impact') next = 'impact'

  if (rig.state !== next) {
    rig.state = next
    // Restart the clock so choreographed cycles (step-then-swing) begin on
    // their first beat instead of joining mid-swing.
    rig.time = 0
  }
}

/** Shows the mineral crystal or gas barrel on a worker's back while it hauls cargo. Idempotent per kind. */
export function updateUnitCargo(root: Entity, kind: ResourceKind | undefined): void {
  const rig = rigs.get(root)
  if (!rig || rig.cargoKind === kind) return

  rig.cargoKind = kind
  applyCargoVisibility(rig)
}

function applyCargoVisibility(rig: UnitRig): void {
  const showMinerals = rig.cargoKind === 'minerals' && !rig.fogHidden
  const showGas = rig.cargoKind === 'gas' && !rig.fogHidden

  for (const part of rig.mineralCargo) {
    VisibilityComponent.createOrReplace(part, { visible: showMinerals })
  }
  for (const part of rig.gasCargo) {
    VisibilityComponent.createOrReplace(part, { visible: showGas })
  }
}

/** Visibility doesn't cascade to children, so fog of war toggles every part. */
export function setUnitVisible(root: Entity, visible: boolean): void {
  const rig = rigs.get(root)
  if (!rig) return

  rig.fogHidden = !visible
  const cargoParts = new Set([...rig.mineralCargo, ...rig.gasCargo])
  const groundParts = new Set(rig.groundFx)
  for (const part of rig.parts) {
    if (cargoParts.has(part) || groundParts.has(part)) continue
    VisibilityComponent.createOrReplace(part, { visible })
  }
  for (const pip of rig.insignia) {
    VisibilityComponent.createOrReplace(pip, { visible })
  }
  // Cargo pieces stay hidden unless the worker is actually carrying that resource.
  applyCargoVisibility(rig)
  // Ground rings stay hidden on the map regardless of fog.
  applyGroundFxVisibility(rig)
}

// Upgrade rank pips: orange diamonds for Weapons levels, cyan for Propulsion.
const WEAPON_PIP_COLOR = Color4.create(1, 0.5, 0.15, 1)
const SPEED_PIP_COLOR = Color4.create(0.3, 0.85, 1, 1)
const PIP_SPACING = 0.2
const PIP_SIZE = 0.1

/**
 * Shows the team's research on the unit itself: one orange diamond per Weapons
 * level and one cyan diamond per Propulsion level, floating above the model.
 * Called on spawn and re-called for fielded units when research completes.
 */
export function setUnitUpgradeInsignia(root: Entity, damageLevel: number, speedLevel: number): void {
  const rig = rigs.get(root)
  if (!rig) return

  for (const pip of rig.insignia) engine.removeEntity(pip)
  rig.insignia = []
  if (damageLevel <= 0 && speedLevel <= 0) return

  const rows: { level: number; color: Color4 }[] = [
    { level: damageLevel, color: WEAPON_PIP_COLOR },
    { level: speedLevel, color: SPEED_PIP_COLOR }
  ]

  let rowY = getRigTopY(rig) + 0.28
  for (const row of rows) {
    if (row.level <= 0) continue
    for (let i = 0; i < row.level; i++) {
      const pip = engine.addEntity()
      Transform.create(pip, {
        parent: rig.bodyRoot,
        position: Vector3.create((i - (row.level - 1) / 2) * PIP_SPACING, rowY, 0),
        scale: Vector3.create(PIP_SIZE, PIP_SIZE, PIP_SIZE),
        rotation: Quaternion.fromEulerDegrees(0, 0, 45)
      })
      MeshRenderer.setBox(pip)
      Material.setPbrMaterial(pip, {
        albedoColor: row.color,
        emissiveColor: row.color,
        emissiveIntensity: 3,
        metallic: 0,
        roughness: 1,
        castShadows: false
      })
      VisibilityComponent.createOrReplace(pip, { visible: !rig.fogHidden })
      rig.insignia.push(pip)
    }
    rowY += 0.24
  }
}

/** Approximate top of the model in bodyRoot-local space, so pips sit above any silhouette. */
function getRigTopY(rig: UnitRig): number {
  let top = 1.2
  for (const part of rig.parts) {
    const transform = Transform.getOrNull(part)
    if (!transform) continue
    top = Math.max(top, transform.position.y + transform.scale.y / 2)
  }
  return top
}

/** Unregisters the rig; optionally removes the part entities (children aren't removed with their root). */
export function disposeUnit(root: Entity, removeParts: boolean): void {
  const rig = rigs.get(root)
  if (!rig) return

  if (removeParts) {
    for (const part of rig.parts) engine.removeEntity(part)
    for (const pip of rig.insignia) engine.removeEntity(pip)
  }
  rigs.delete(root)
}

// ---------------------------------------------------------------------------
// Support and siege units (healer / siege roles), one flavor per race.
// ---------------------------------------------------------------------------

const HEAL_GREEN = Color4.create(0.35, 1, 0.55, 1)
const MEDIC_WHITE = Color4.create(0.85, 0.87, 0.9, 1)

/** Human healer: a hover-drone field medic - white chassis, glowing cross, syringe arm. */
function buildHumanMedic(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  // Hover pad glow.
  addPart(Vector3.create(0, 0.16, 0), Vector3.create(0.44, 0.05, 0.44), HEAL_GREEN, { cylinder: true, emissive: HEAL_GREEN, emissiveIntensity: 1.8 })

  // White medical chassis with dark trim.
  addPart(Vector3.create(0, 0.52, 0), Vector3.create(0.44, 0.4, 0.5), MEDIC_WHITE, { roughness: 0.3 })
  addPart(Vector3.create(0, 0.3, 0), Vector3.create(0.36, 0.12, 0.42), METAL_DARK)
  addPart(Vector3.create(0, 0.78, 0), Vector3.create(0.34, 0.14, 0.4), METAL_LIGHT)

  // Medical cross on both flanks.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.23, 0.54, 0), Vector3.create(0.02, 0.22, 0.08), HEAL_GREEN, { emissive: HEAL_GREEN, emissiveIntensity: 2.6 })
    addPart(Vector3.create(side * 0.23, 0.54, 0), Vector3.create(0.02, 0.08, 0.22), HEAL_GREEN, { emissive: HEAL_GREEN, emissiveIntensity: 2.6 })
  }

  // Optic visor in the team color.
  addPart(Vector3.create(0, 0.6, 0.26), Vector3.create(0.26, 0.07, 0.05), glow, { emissive: glow, emissiveIntensity: 2.8 })

  // Syringe arm: hinge, boom, needle and a green serum vial.
  addPart(Vector3.create(0.26, 0.46, 0.18), Vector3.create(0.09, 0.09, 0.09), METAL_DARK, { sphere: true })
  addPart(Vector3.create(0.3, 0.44, 0.36), Vector3.create(0.05, 0.05, 0.32), METAL_LIGHT, { cylinder: true, rotation: Quaternion.fromEulerDegrees(90, 0, 0) })
  addPart(Vector3.create(0.3, 0.44, 0.56), Vector3.create(0.02, 0.14, 0.02), BLADE_STEEL, { cone: true, rotation: Quaternion.fromEulerDegrees(90, 0, 0) })
  addPart(Vector3.create(0.3, 0.52, 0.3), Vector3.create(0.07, 0.1, 0.07), HEAL_GREEN, { cylinder: true, emissive: HEAL_GREEN, emissiveIntensity: 2.2 })

  // Supply canisters on the back.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.12, 0.6, -0.28), Vector3.create(0.1, 0.24, 0.1), MEDIC_WHITE, { cylinder: true, roughness: 0.35 })
    addPart(Vector3.create(side * 0.12, 0.74, -0.28), Vector3.create(0.06, 0.04, 0.06), HEAL_GREEN, { cylinder: true, emissive: HEAL_GREEN, emissiveIntensity: 2 })
  }

  // Rotating rescue beacon.
  rig.spinner = addPart(Vector3.create(0, 0.92, 0), Vector3.create(0.16, 0.04, 0.05), HEAL_GREEN, { emissive: HEAL_GREEN, emissiveIntensity: 3 })

  // Serum motes drifting up while it works.
  for (let i = 0; i < 2; i++) {
    const mote = addPart(Vector3.create(0.3, 0.5, 0.4), Vector3.create(0.035, 0.035, 0.035), HEAL_GREEN, { sphere: true, emissive: HEAL_GREEN, emissiveIntensity: 3 })
    rig.fx.push({ entity: mote, mode: 'ember', anchor: Vector3.create(0.3, 0.5, 0.4), radius: 0.05, height: 0.4, speed: 0.9, phase: i * 1.7, size: 0.035 })
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.06, speed: 1.8, tilt: 0, spin: 160, lunge: 0 },
    walk: { amplitude: 0.05, speed: 6, tilt: 8, spin: 240, lunge: 0 },
    talk: { amplitude: 0.04, speed: 8, tilt: 4, spin: 320, lunge: 0 },
    attack: { amplitude: 0.03, speed: 6, tilt: 6, spin: 420, lunge: 0.05 },
    impact: { amplitude: 0.08, speed: 16, tilt: -8, spin: 160, lunge: 0 }
  }
}

/** Human siege: the Thunderhead - a tracked howitzer with a long elevated barrel. */
function buildHumanThunderhead(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  // Tread blocks with drive wheels.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.42, 0.22, 0), Vector3.create(0.3, 0.3, 1.05), METAL_DARK)
    for (const off of [-0.35, 0, 0.35]) {
      addPart(Vector3.create(side * 0.58, 0.2, off), Vector3.create(0.18, 0.18, 0.08), METAL_LIGHT, {
        cylinder: true,
        rotation: Quaternion.fromEulerDegrees(0, 0, 90)
      })
    }
  }

  // Hull deck and armored glacis.
  addPart(Vector3.create(0, 0.46, 0), Vector3.create(0.85, 0.22, 1.1), HUMAN_HULL)
  addPart(Vector3.create(0, 0.5, 0.5), Vector3.create(0.7, 0.16, 0.3), METAL_LIGHT, { rotation: Quaternion.fromEulerDegrees(-24, 0, 0) })

  // Turret with crew hatch.
  addPart(Vector3.create(0, 0.72, -0.15), Vector3.create(0.6, 0.3, 0.62), METAL_LIGHT)
  addPart(Vector3.create(0.18, 0.9, -0.2), Vector3.create(0.16, 0.05, 0.16), METAL_DARK, { cylinder: true })

  // Long howitzer barrel, elevated for the arcing shot, with muzzle brake.
  addPart(Vector3.create(0, 0.86, 0.45), Vector3.create(0.1, 0.1, 1.15), METAL_DARK, {
    cylinder: true,
    rotation: Quaternion.fromEulerDegrees(78, 0, 0)
  })
  addPart(Vector3.create(0, 1.02, 0.98), Vector3.create(0.13, 0.13, 0.14), METAL_LIGHT, {
    cylinder: true,
    rotation: Quaternion.fromEulerDegrees(78, 0, 0)
  })
  addPart(Vector3.create(0, 1.06, 1.1), Vector3.create(0.1, 0.1, 0.04), glow, {
    cylinder: true,
    emissive: glow,
    emissiveIntensity: 2.6,
    rotation: Quaternion.fromEulerDegrees(78, 0, 0)
  })

  // Recoil spade dug in at the rear plus shell rack.
  addPart(Vector3.create(0, 0.3, -0.62), Vector3.create(0.5, 0.24, 0.12), METAL_DARK, { rotation: Quaternion.fromEulerDegrees(30, 0, 0) })
  for (const off of [-0.12, 0, 0.12]) {
    addPart(Vector3.create(off, 0.62, -0.5), Vector3.create(0.06, 0.06, 0.2), DRILL_STEEL, {
      cylinder: true,
      rotation: Quaternion.fromEulerDegrees(90, 0, 0)
    })
  }

  // Warning light and radar dish spinning on the turret.
  rig.spinner = addPart(Vector3.create(-0.18, 0.94, -0.28), Vector3.create(0.2, 0.03, 0.08), METAL_LIGHT)
  addPart(Vector3.create(-0.18, 0.9, -0.28), Vector3.create(0.04, 0.06, 0.04), METAL_DARK, { cylinder: true })
  addPart(Vector3.create(0, 0.6, 0.56), Vector3.create(0.07, 0.07, 0.07), glow, { sphere: true, emissive: glow, emissiveIntensity: 2.8 })

  // Deployed mode: a second, far bigger howitzer grows out of the turret and
  // outrigger spades slam into the ground for the recoil.
  const deployed = createSiegeCannonGroup(rig)
  addChildPart(rig, deployed, Vector3.create(0, 1.15, 0.55), Vector3.create(0.17, 0.17, 2.1), METAL_DARK, {
    cylinder: true,
    rotation: Quaternion.fromEulerDegrees(68, 0, 0)
  })
  addChildPart(rig, deployed, Vector3.create(0, 1.5, 1.4), Vector3.create(0.22, 0.22, 0.24), METAL_LIGHT, {
    cylinder: true,
    rotation: Quaternion.fromEulerDegrees(68, 0, 0)
  })
  addChildPart(rig, deployed, Vector3.create(0, 1.58, 1.6), Vector3.create(0.15, 0.15, 0.05), glow, {
    cylinder: true,
    emissive: glow,
    emissiveIntensity: 3,
    rotation: Quaternion.fromEulerDegrees(68, 0, 0)
  })
  addChildPart(rig, deployed, Vector3.create(0, 0.9, -0.3), Vector3.create(0.3, 0.26, 0.4), METAL_LIGHT)
  for (const side of [-1, 1]) {
    addChildPart(rig, deployed, Vector3.create(side * 0.72, 0.22, -0.2), Vector3.create(0.14, 0.4, 0.24), METAL_DARK, {
      rotation: Quaternion.fromEulerDegrees(0, 0, side * 35)
    })
    addChildPart(rig, deployed, Vector3.create(side * 0.9, 0.06, -0.2), Vector3.create(0.26, 0.08, 0.34), METAL_LIGHT)
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.015, speed: 1.2, tilt: 0, spin: 60, lunge: 0 },
    walk: { amplitude: 0.04, speed: 5, tilt: 3, spin: 100, lunge: 0 },
    talk: { amplitude: 0.02, speed: 6, tilt: 2, spin: 80, lunge: 0 },
    attack: { amplitude: 0.05, speed: 10, tilt: -6, spin: 200, lunge: -0.14 },
    impact: { amplitude: 0.05, speed: 16, tilt: -5, spin: 60, lunge: 0 }
  }
}

/** Alien healer: the Lightmender - a floating white-gold acolyte with a halo and orbiting light prisms. */
function buildAlienLightmender(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const gild = { metallic: 0.8, roughness: 0.25 }

  // Levitation glow.
  addPart(Vector3.create(0, 0.16, 0), Vector3.create(0.5, 0.04, 0.5), HEAL_GREEN, { cylinder: true, emissive: HEAL_GREEN, emissiveIntensity: 1.8 })

  // White floating robe with gold bands.
  addPart(Vector3.create(0, 0.64, 0), Vector3.create(0.48, 0.85, 0.48), MEDIC_WHITE, {
    cone: true,
    roughness: 0.4,
    rotation: Quaternion.fromEulerDegrees(180, 0, 0)
  })
  addPart(Vector3.create(0, 0.92, 0), Vector3.create(0.38, 0.07, 0.38), ALIEN_GOLD, { cylinder: true, ...gild })
  addPart(Vector3.create(0, 1.16, 0), Vector3.create(0.3, 0.3, 0.26), MEDIC_WHITE, { roughness: 0.4 })

  // Hooded head with a healing third eye and golden halo.
  addPart(Vector3.create(0, 1.46, 0), Vector3.create(0.24, 0.24, 0.24), ALIEN_DARK, { sphere: true })
  addPart(Vector3.create(0, 1.5, 0.12), Vector3.create(0.08, 0.08, 0.05), HEAL_GREEN, { sphere: true, emissive: HEAL_GREEN, emissiveIntensity: 3.2 })
  addPart(Vector3.create(0, 1.72, 0), Vector3.create(0.34, 0.02, 0.34), ALIEN_GOLD, { cylinder: true, ...gild, emissive: ALIEN_GOLD, emissiveIntensity: 1.4 })

  // Mending staff topped with a green focus crystal.
  addPart(Vector3.create(0.3, 0.95, 0.1), Vector3.create(0.04, 1, 0.04), ALIEN_GOLD, { cylinder: true, ...gild })
  addPart(Vector3.create(0.3, 1.5, 0.1), Vector3.create(0.09, 0.2, 0.09), HEAL_GREEN, { cone: true, emissive: HEAL_GREEN, emissiveIntensity: 2.8 })

  // Orbiting light prisms on a spinning carrier.
  const carrier = engine.addEntity()
  Transform.create(carrier, { parent: rig.bodyRoot, position: Vector3.create(0, 1.1, 0) })
  rig.parts.push(carrier)
  rig.spinner = carrier
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2
    addChildPart(rig, carrier, Vector3.create(Math.cos(angle) * 0.5, 0, Math.sin(angle) * 0.5), Vector3.create(0.07, 0.2, 0.07), MEDIC_WHITE, {
      emissive: HEAL_GREEN,
      emissiveIntensity: 1.8,
      rotation: Quaternion.fromEulerDegrees(0, 0, 14)
    })
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.08, speed: 1.4, tilt: 0, spin: 60, lunge: 0 },
    walk: { amplitude: 0.05, speed: 4.5, tilt: 7, spin: 110, lunge: 0 },
    talk: { amplitude: 0.04, speed: 7, tilt: 4, spin: 180, lunge: 0 },
    attack: { amplitude: 0.04, speed: 6, tilt: 4, spin: 500, lunge: 0.04 },
    impact: { amplitude: 0.08, speed: 16, tilt: -8, spin: 60, lunge: 0 }
  }
}

/** Alien siege: the Sunlance - a hovering tripod platform aiming one immense crystal lance. */
function buildAlienSunlance(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const gild = { metallic: 0.8, roughness: 0.25 }

  // Antigrav base disc and three landing prongs.
  addPart(Vector3.create(0, 0.2, 0), Vector3.create(1, 0.06, 1), ALIEN_CRYSTAL, { cylinder: true, emissive: ALIEN_CRYSTAL, emissiveIntensity: 1.6 })
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6
    addPart(Vector3.create(Math.cos(angle) * 0.5, 0.34, Math.sin(angle) * 0.5), Vector3.create(0.1, 0.5, 0.1), ALIEN_DARK, {
      rotation: Quaternion.fromEulerDegrees(Math.sin(angle) * 24, 0, -Math.cos(angle) * 24)
    })
  }

  // Core platform and armored crown.
  addPart(Vector3.create(0, 0.66, 0), Vector3.create(0.72, 0.3, 0.72), ALIEN_GOLD, { cylinder: true, ...gild })
  addPart(Vector3.create(0, 0.88, -0.1), Vector3.create(0.42, 0.3, 0.5), ALIEN_DARK)
  addPart(Vector3.create(0, 1.02, -0.28), Vector3.create(0.2, 0.2, 0.2), glow, { sphere: true, emissive: glow, emissiveIntensity: 2.8 })

  // The lance: a long crystal beam cannon angled slightly upward.
  addPart(Vector3.create(0, 0.98, 0.5), Vector3.create(0.12, 0.12, 1.5), ALIEN_GOLD, {
    cylinder: true,
    ...gild,
    rotation: Quaternion.fromEulerDegrees(82, 0, 0)
  })
  addPart(Vector3.create(0, 1.08, 1.15), Vector3.create(0.08, 0.4, 0.08), ALIEN_CRYSTAL, {
    cone: true,
    emissive: ALIEN_CRYSTAL,
    emissiveIntensity: 3,
    rotation: Quaternion.fromEulerDegrees(82, 0, 0)
  })

  // Spinning charge ring around the lance mid-section.
  const ring = engine.addEntity()
  Transform.create(ring, { parent: rig.bodyRoot, position: Vector3.create(0, 1.0, 0.62), rotation: Quaternion.fromEulerDegrees(82, 0, 0) })
  rig.parts.push(ring)
  rig.spinner = ring
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2
    addChildPart(rig, ring, Vector3.create(Math.cos(angle) * 0.24, 0, Math.sin(angle) * 0.24), Vector3.create(0.07, 0.07, 0.07), ALIEN_CRYSTAL, {
      sphere: true,
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2.8
    })
  }

  // Counterweight fins at the rear.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.16, 0.84, -0.5), Vector3.create(0.05, 0.3, 0.3), ALIEN_DARK, { rotation: Quaternion.fromEulerDegrees(-20, 0, side * 10) })
  }

  // Deployed mode: the lance extends into a colossal beam cannon with a
  // second focusing crystal, and anchor prongs spike into the ground.
  const deployed = createSiegeCannonGroup(rig)
  addChildPart(rig, deployed, Vector3.create(0, 1.2, 1.1), Vector3.create(0.15, 0.15, 1.7), ALIEN_GOLD, {
    cylinder: true,
    metallic: 0.8,
    roughness: 0.25,
    rotation: Quaternion.fromEulerDegrees(78, 0, 0)
  })
  addChildPart(rig, deployed, Vector3.create(0, 1.45, 1.95), Vector3.create(0.14, 0.6, 0.14), ALIEN_CRYSTAL, {
    cone: true,
    emissive: ALIEN_CRYSTAL,
    emissiveIntensity: 3.4,
    rotation: Quaternion.fromEulerDegrees(78, 0, 0)
  })
  addChildPart(rig, deployed, Vector3.create(0, 1.3, 1.45), Vector3.create(0.34, 0.06, 0.34), ALIEN_CRYSTAL, {
    cylinder: true,
    emissive: ALIEN_CRYSTAL,
    emissiveIntensity: 2.4,
    rotation: Quaternion.fromEulerDegrees(78, 0, 0)
  })
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6
    addChildPart(rig, deployed, Vector3.create(Math.cos(angle) * 0.62, 0.14, Math.sin(angle) * 0.62), Vector3.create(0.1, 0.5, 0.1), ALIEN_CRYSTAL, {
      cone: true,
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 1.8,
      rotation: Quaternion.fromEulerDegrees(180 + Math.sin(angle) * 14, 0, Math.cos(angle) * 14)
    })
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.05, speed: 1.3, tilt: 0, spin: 80, lunge: 0 },
    walk: { amplitude: 0.05, speed: 4, tilt: 4, spin: 140, lunge: 0 },
    talk: { amplitude: 0.03, speed: 5, tilt: 2, spin: 100, lunge: 0 },
    attack: { amplitude: 0.04, speed: 9, tilt: -5, spin: 700, lunge: -0.12 },
    impact: { amplitude: 0.06, speed: 15, tilt: -6, spin: 80, lunge: 0 }
  }
}

/** Bio healer: the Broodtender - a pale grub-mother oozing regenerative spores. */
function buildBioBroodtender(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const PALE = Color4.create(0.78, 0.72, 0.6, 1)
  const flesh = { metallic: 0.05, roughness: 0.85 }

  // Soft segmented grub body.
  addPart(Vector3.create(0, 0.4, 0.1), Vector3.create(0.5, 0.4, 0.55), PALE, { sphere: true, ...flesh })
  addPart(Vector3.create(0, 0.38, -0.3), Vector3.create(0.42, 0.34, 0.45), PALE, { sphere: true, ...flesh })
  addPart(Vector3.create(0, 0.36, -0.6), Vector3.create(0.3, 0.26, 0.35), BIO_FLESH, { sphere: true, ...flesh })

  // Glowing spore sacs along the back - these pulse like a heartbeat.
  for (const [sx, sz, size] of [[-0.16, 0, 0.16], [0.14, -0.2, 0.14], [0, -0.42, 0.12]] as const) {
    const sac = addPart(Vector3.create(sx, 0.66, sz), Vector3.create(size, size * 0.85, size), HEAL_GREEN, {
      sphere: true,
      emissive: HEAL_GREEN,
      emissiveIntensity: 1.8,
      ...flesh
    })
    rig.fx.push({ entity: sac, mode: 'pulse', anchor: Vector3.create(sx, 0.66, sz), radius: 0, height: 0, speed: 2.8, phase: sx * 9, size })
  }

  // Gentle face: two calm eyes and drooping antennae.
  addPart(Vector3.create(0, 0.5, 0.42), Vector3.create(0.26, 0.22, 0.24), BIO_CARAPACE, { sphere: true })
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.08, 0.56, 0.52), Vector3.create(0.05, 0.05, 0.04), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })
    addPart(Vector3.create(side * 0.1, 0.68, 0.44), Vector3.create(0.03, 0.22, 0.03), PALE, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(-40, 0, side * 24)
    })
  }

  // Six stubby caterpillar legs.
  for (const side of [-1, 1]) {
    for (const off of [-0.3, -0.05, 0.2]) {
      addPart(Vector3.create(side * 0.26, 0.12, off), Vector3.create(0.06, 0.2, 0.06), BIO_CARAPACE, {
        rotation: Quaternion.fromEulerDegrees(0, 0, side * 24)
      })
    }
  }

  // Regeneration aura ring pulsing on the ground - sells the AoE heal radius.
  const aura = addPart(Vector3.create(0, 0.04, 0), Vector3.create(2.2, 0.02, 2.2), Color4.create(HEAL_GREEN.r, HEAL_GREEN.g, HEAL_GREEN.b, 0.18), {
    cylinder: true,
    emissive: HEAL_GREEN,
    emissiveIntensity: 0.9
  })
  rig.fx.push({ entity: aura, mode: 'pulse', anchor: Vector3.create(0, 0.04, 0), radius: 0, height: 0, speed: 2.2, phase: 0, size: 2.2 })

  // Spore motes drifting up from the sacs.
  for (let i = 0; i < 3; i++) {
    const spore = addPart(Vector3.create(0, 0.72, -0.12), Vector3.create(0.04, 0.04, 0.04), HEAL_GREEN, { sphere: true, emissive: HEAL_GREEN, emissiveIntensity: 3 })
    rig.fx.push({ entity: spore, mode: 'ember', anchor: Vector3.create(0, 0.72, -0.12), radius: 0.14, height: 0.55, speed: 0.7, phase: i * 2.1, size: 0.04 })
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.04, speed: 2.2, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.07, speed: 9, tilt: 4, spin: 0, lunge: 0 },
    talk: { amplitude: 0.04, speed: 10, tilt: 4, spin: 0, lunge: 0 },
    attack: { amplitude: 0.05, speed: 6, tilt: 3, spin: 0, lunge: 0.04 },
    impact: { amplitude: 0.08, speed: 18, tilt: -8, spin: 0, lunge: 0 }
  }
}

/** Bio siege: the Acidmaw - a squat beast with a dorsal lobber-maw that hurls acid. */
function buildBioAcidmaw(rig: UnitRig, addPart: PartAdder, glow: Color4): void {
  const ACID = Color4.create(0.55, 0.85, 0.2, 1)
  const flesh = { metallic: 0.05, roughness: 0.85 }

  // Four thick legs planted wide.
  for (const side of [-1, 1]) {
    for (const off of [-0.3, 0.35]) {
      addPart(Vector3.create(side * 0.42, 0.24, off), Vector3.create(0.2, 0.48, 0.2), BIO_CARAPACE, { cylinder: true })
    }
  }

  // Low-slung armored body.
  addPart(Vector3.create(0, 0.62, 0), Vector3.create(1.05, 0.6, 1.2), BIO_FLESH, { sphere: true, ...flesh })
  addPart(Vector3.create(0, 0.92, -0.1), Vector3.create(0.8, 0.34, 0.9), BIO_CARAPACE, { sphere: true, metallic: 0.1, roughness: 0.7 })

  // Dorsal lobber-maw: a bone mortar tube angled skyward with an acid-glow throat.
  addPart(Vector3.create(0, 1.2, -0.2), Vector3.create(0.32, 0.7, 0.32), BIO_BONE, {
    cylinder: true,
    metallic: 0.1,
    roughness: 0.6,
    rotation: Quaternion.fromEulerDegrees(-38, 0, 0)
  })
  addPart(Vector3.create(0, 1.48, 0.02), Vector3.create(0.24, 0.06, 0.24), ACID, {
    cylinder: true,
    emissive: ACID,
    emissiveIntensity: 3,
    rotation: Quaternion.fromEulerDegrees(-38, 0, 0)
  })
  // Bone lips around the muzzle.
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.16, 1.52, 0.06), Vector3.create(0.05, 0.18, 0.05), BIO_BONE, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(-20, 0, side * 26)
    })
  }

  // Acid reservoir sacs feeding the maw - pulsing.
  for (const side of [-1, 1]) {
    const sac = addPart(Vector3.create(side * 0.34, 0.9, -0.44), Vector3.create(0.2, 0.18, 0.2), ACID, {
      sphere: true,
      emissive: ACID,
      emissiveIntensity: 1.6,
      ...flesh
    })
    rig.fx.push({ entity: sac, mode: 'pulse', anchor: Vector3.create(side * 0.34, 0.9, -0.44), radius: 0, height: 0, speed: 3, phase: side, size: 0.2 })
  }

  // Head: low jaw with fangs and team-glow eyes.
  addPart(Vector3.create(0, 0.56, 0.62), Vector3.create(0.34, 0.26, 0.3), BIO_CARAPACE, { sphere: true })
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.1, 0.62, 0.74), Vector3.create(0.05, 0.05, 0.04), glow, { sphere: true, emissive: glow, emissiveIntensity: 3 })
    addPart(Vector3.create(side * 0.07, 0.44, 0.72), Vector3.create(0.035, 0.1, 0.035), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(165, 0, side * 8) })
  }

  // Armor spikes along the shell.
  addPart(Vector3.create(0, 1.14, 0.3), Vector3.create(0.09, 0.34, 0.09), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(18, 0, 0) })
  for (const side of [-1, 1]) {
    addPart(Vector3.create(side * 0.5, 1.02, 0.1), Vector3.create(0.08, 0.3, 0.08), BIO_BONE, { cone: true, rotation: Quaternion.fromEulerDegrees(0, 0, side * 30) })
  }

  // Acid drip from the maw.
  const drip = addPart(Vector3.create(0, 1.44, 0.1), Vector3.create(0.045, 0.045, 0.045), ACID, { sphere: true, emissive: ACID, emissiveIntensity: 3 })
  rig.fx.push({ entity: drip, mode: 'ember', anchor: Vector3.create(0, 1.44, 0.1), radius: 0.04, height: -0.5, speed: 1.1, phase: 0, size: 0.045 })

  // Deployed mode: the maw erupts into a towering bone mortar and root spurs
  // burrow into the soil to brace the recoil.
  const deployed = createSiegeCannonGroup(rig)
  addChildPart(rig, deployed, Vector3.create(0, 1.75, 0.15), Vector3.create(0.4, 0.85, 0.4), BIO_BONE, {
    cylinder: true,
    metallic: 0.1,
    roughness: 0.6,
    rotation: Quaternion.fromEulerDegrees(-32, 0, 0)
  })
  addChildPart(rig, deployed, Vector3.create(0, 2.14, 0.42), Vector3.create(0.34, 0.08, 0.34), ACID, {
    cylinder: true,
    emissive: ACID,
    emissiveIntensity: 3.4,
    rotation: Quaternion.fromEulerDegrees(-32, 0, 0)
  })
  for (const side of [-1, 1]) {
    addChildPart(rig, deployed, Vector3.create(side * 0.24, 2.1, 0.5), Vector3.create(0.06, 0.24, 0.06), BIO_BONE, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(-16, 0, side * 30)
    })
  }
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
    addChildPart(rig, deployed, Vector3.create(Math.cos(angle) * 0.7, 0.16, Math.sin(angle) * 0.7), Vector3.create(0.12, 0.45, 0.12), BIO_CARAPACE, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(180 + Math.sin(angle) * 20, 0, Math.cos(angle) * 20)
    })
  }

  rig.spinAxis = 'y'
  rig.profiles = {
    idle: { amplitude: 0.03, speed: 1.8, tilt: 0, spin: 0, lunge: 0 },
    walk: { amplitude: 0.06, speed: 7, tilt: 3, spin: 0, lunge: 0 },
    talk: { amplitude: 0.03, speed: 8, tilt: 3, spin: 0, lunge: 0 },
    attack: { amplitude: 0.06, speed: 10, tilt: -8, spin: 0, lunge: -0.12 },
    impact: { amplitude: 0.07, speed: 16, tilt: -6, spin: 0, lunge: 0 }
  }
}

function unitAnimationSystem(dt: number): void {
  for (const rig of rigs.values()) {
    rig.time += dt
    const profile = rig.profiles[rig.state]

    const bodyTransform = Transform.getMutable(rig.bodyRoot)
    const lungeOffset = profile.lunge === 0 ? 0 : profile.lunge * Math.max(0, Math.sin(rig.time * profile.speed))
    bodyTransform.position = Vector3.create(0, rig.baseHeight + profile.amplitude * Math.sin(rig.time * profile.speed) + profile.amplitude, lungeOffset)
    bodyTransform.rotation = Quaternion.fromEulerDegrees(rig.tiltOverride ?? profile.tilt, 0, 0)

    if (profile.spin > 0 && rig.spinner) {
      const spinnerTransform = Transform.getMutable(rig.spinner)
      const angle = (rig.time * profile.spin) % 360
      spinnerTransform.rotation = rig.spinAxis === 'y' ? Quaternion.fromEulerDegrees(0, angle, 0) : Quaternion.fromEulerDegrees(0, 0, angle)
    }

    for (const fx of rig.fx) {
      animateFx(fx, rig.time)
    }

    // Attack choreography: sample each limb's keyframe track over the cycle
    // (one cycle = one full sine period of the profile, same clock the lunge
    // uses), so the step and the sword swing land on consistent beats.
    if (rig.attackTracks) {
      const attacking = rig.state === 'attack'
      const phase = attacking ? ((rig.time * profile.speed) / (Math.PI * 2)) % 1 : 0
      for (const track of rig.attackTracks) {
        let x = track.rest.x
        let y = track.rest.y
        let z = track.rest.z
        if (attacking) {
          const [ex, ey, ez] = sampleTrack(track.keys, phase)
          x += ex
          y += ey
          z += ez
        }
        Transform.getMutable(track.entity).rotation = Quaternion.fromEulerDegrees(x, y, z)
      }
    }
  }
}

/** Linear scan over sorted keyframes with smoothstep easing between neighbours. */
function sampleTrack(keys: [number, number, number, number][], phase: number): [number, number, number] {
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i]
    const k1 = keys[i + 1]
    if (phase >= k0[0] && phase <= k1[0]) {
      const span = k1[0] - k0[0]
      const t = span === 0 ? 0 : (phase - k0[0]) / span
      const s = t * t * (3 - 2 * t)
      return [k0[1] + (k1[1] - k0[1]) * s, k0[2] + (k1[2] - k0[2]) * s, k0[3] + (k1[3] - k0[3]) * s]
    }
  }
  const last = keys[keys.length - 1]
  return [last[1], last[2], last[3]]
}

function animateFx(fx: UnitFx, time: number): void {
  const t = time * fx.speed + fx.phase
  const transform = Transform.getMutable(fx.entity)

  if (fx.mode === 'orbit') {
    transform.position = Vector3.create(
      fx.anchor.x + Math.cos(t) * fx.radius,
      fx.anchor.y + Math.sin(t * 2.3) * fx.height,
      fx.anchor.z + Math.sin(t) * fx.radius
    )
    return
  }

  if (fx.mode === 'flap') {
    // Wing beat: eased sine roll around the pivot's Z, mirrored by sign.
    transform.rotation = Quaternion.fromEulerDegrees(0, 0, fx.height + Math.sin(t) * fx.radius)
    return
  }

  if (fx.mode === 'ember') {
    // Rise, shrink to nothing, respawn at the anchor - a looping spark.
    const cycle = t - Math.floor(t)
    const fade = 1 - cycle
    transform.position = Vector3.create(
      fx.anchor.x + Math.sin(t * 6.7) * fx.radius,
      fx.anchor.y + cycle * fx.height,
      fx.anchor.z + Math.cos(t * 5.3) * fx.radius
    )
    transform.scale = Vector3.create(fx.size * fade, fx.size * fade, fx.size * fade)
    return
  }

  // pulse: breathe in XZ while slowly turning - reads as a live energy field.
  const pulse = 1 + Math.sin(t) * 0.13
  transform.scale = Vector3.create(fx.size * pulse, transform.scale.y, fx.size * pulse)
  transform.rotation = Quaternion.fromEulerDegrees(0, (time * 24) % 360, 0)
}

engine.addSystem(unitAnimationSystem)
