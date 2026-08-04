import { Entity, Material, MeshRenderer, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { RaceId, ResourceKind, Team } from './types'

// Procedural units for all three races, built from primitives so each race gets a
// distinct silhouette without GLBs or rigged animations. A small system drives
// per-state motion (hover bob, tilt, spinners, attack lunges) to mirror the
// animation clips the game logic requests (idle / walk / talk / attack / impact).

export type UnitRole = 'worker' | 'melee' | 'ranged'

type UnitAnimState = 'idle' | 'walk' | 'talk' | 'attack' | 'impact'

type MotionProfile = {
  amplitude: number
  speed: number
  tilt: number
  spin: number
  lunge: number
}

interface UnitRig {
  bodyRoot: Entity
  spinner?: Entity
  spinAxis: 'y' | 'z'
  mineralCargo: Entity[]
  gasCargo: Entity[]
  cargoKind?: ResourceKind
  fogHidden: boolean
  parts: Entity[]
  state: UnitAnimState
  time: number
  profiles: Record<UnitAnimState, MotionProfile>
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

const TEAM_GLOW: Record<Team, Color4> = {
  player: Color4.create(0.2, 0.85, 0.95, 1),
  enemy: Color4.create(1, 0.3, 0.2, 1)
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

export function buildUnitModel(root: Entity, race: RaceId, role: UnitRole, team: Team): void {
  const bodyRoot = engine.addEntity()
  Transform.create(bodyRoot, { parent: root })

  const rig: UnitRig = {
    bodyRoot,
    spinAxis: 'z',
    mineralCargo: [],
    gasCargo: [],
    fogHidden: false,
    parts: [bodyRoot],
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
    Material.setPbrMaterial(part, {
      albedoColor: color,
      emissiveColor: options.emissive ?? Color4.Black(),
      emissiveIntensity: options.emissiveIntensity ?? 0,
      metallic: options.metallic ?? 0.6,
      roughness: options.roughness ?? 0.4,
      castShadows: false
    })
    rig.parts.push(part)
    return part
  }

  const glow = TEAM_GLOW[team]

  if (race === 'human') {
    if (role === 'worker') buildHumanMiner(rig, addPart, glow)
    else if (role === 'melee') buildHumanVanguard(rig, addPart, glow)
    else buildHumanGunner(rig, addPart, glow)
  } else if (race === 'alien') {
    if (role === 'worker') buildAlienProbe(rig, addPart, glow)
    else if (role === 'melee') buildAlienStalker(rig, addPart, glow)
    else buildAlienDisruptor(rig, addPart, glow)
  } else {
    if (role === 'worker') buildBioDrone(rig, addPart, glow)
    else if (role === 'melee') buildBioRavager(rig, addPart, glow)
    else buildBioSpitter(rig, addPart, glow)
  }

  if (role === 'worker') addWorkerCargo(rig, addPart)

  rigs.set(root, rig)
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

/** Maps animation clip names onto the rig's procedural motion profiles. */
export function setUnitAnimation(root: Entity, clipName: string): void {
  const rig = rigs.get(root)
  if (!rig) return

  if (clipName === 'walk') rig.state = 'walk'
  else if (clipName === 'talk') rig.state = 'talk'
  else if (clipName === 'attack') rig.state = 'attack'
  else if (clipName === 'impact') rig.state = 'impact'
  else rig.state = 'idle'
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
  for (const part of rig.parts) {
    if (cargoParts.has(part)) continue
    VisibilityComponent.createOrReplace(part, { visible })
  }
  // Cargo pieces stay hidden unless the worker is actually carrying that resource.
  applyCargoVisibility(rig)
}

/** Unregisters the rig; optionally removes the part entities (children aren't removed with their root). */
export function disposeUnit(root: Entity, removeParts: boolean): void {
  const rig = rigs.get(root)
  if (!rig) return

  if (removeParts) {
    for (const part of rig.parts) engine.removeEntity(part)
  }
  rigs.delete(root)
}

function unitAnimationSystem(dt: number): void {
  for (const rig of rigs.values()) {
    rig.time += dt
    const profile = rig.profiles[rig.state]

    const bodyTransform = Transform.getMutable(rig.bodyRoot)
    const lungeOffset = profile.lunge === 0 ? 0 : profile.lunge * Math.max(0, Math.sin(rig.time * profile.speed))
    bodyTransform.position = Vector3.create(0, profile.amplitude * Math.sin(rig.time * profile.speed) + profile.amplitude, lungeOffset)
    bodyTransform.rotation = Quaternion.fromEulerDegrees(profile.tilt, 0, 0)

    if (profile.spin > 0 && rig.spinner) {
      const spinnerTransform = Transform.getMutable(rig.spinner)
      const angle = (rig.time * profile.spin) % 360
      spinnerTransform.rotation = rig.spinAxis === 'y' ? Quaternion.fromEulerDegrees(0, angle, 0) : Quaternion.fromEulerDegrees(0, 0, angle)
    }
  }
}

engine.addSystem(unitAnimationSystem)
