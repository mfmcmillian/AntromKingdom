import { Entity, Material, MeshRenderer, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import type { BuildableKind, RaceId } from './types'

// Procedural race-styled buildings, replacing the shared GLB models so each
// faction reads instantly on the battlefield:
//   human - blocky metal structures with cyan light strips.
//   alien - golden monoliths with floating purple crystals.
//   bio   - fleshy mounds with glowing sacs and bone spikes.
// Parts are children of the building root: rotating/scaling/hiding the root
// (placement rotation, construction growth, death) carries every part along.
// Parts tagged with a motion (spin / bob / pulse) are animated continuously,
// so every base reads as a living, working machine.

/** Approximate model heights, used for click colliders and damage VFX anchors. */
export const BUILDING_MODEL_HEIGHTS: Record<BuildableKind, number> = {
  temple: 11,
  supplyHouse: 5,
  barracks: 7,
  techLab: 8,
  forge: 6,
  fireplace: 3
}

const HUMAN_HULL = Color4.create(0.62, 0.66, 0.72, 1)
const HUMAN_DARK = Color4.create(0.28, 0.3, 0.35, 1)
const HUMAN_GLOW = Color4.create(0.45, 0.7, 1, 1)

const ALIEN_GOLD = Color4.create(0.72, 0.58, 0.28, 1)
const ALIEN_DARK = Color4.create(0.24, 0.2, 0.34, 1)
const ALIEN_CRYSTAL = Color4.create(0.8, 0.6, 1, 1)

const BIO_FLESH = Color4.create(0.55, 0.31, 0.28, 1)
const BIO_CARAPACE = Color4.create(0.32, 0.19, 0.17, 1)
const BIO_SAC = Color4.create(1, 0.5, 0.3, 1)
const BIO_ACID = Color4.create(0.55, 0.85, 0.2, 1)

type PartMotion = {
  mode: 'spin' | 'bob' | 'pulse'
  /** Degrees/second for spin, cycles-modulating speed for bob/pulse. */
  speed: number
  /** Bob: meters of travel. Pulse: fraction of base scale. */
  amplitude?: number
  axis?: 'y' | 'z'
}

type PartOptions = {
  rotation?: Quaternion
  cylinder?: boolean
  sphere?: boolean
  cone?: boolean
  emissive?: Color4
  emissiveIntensity?: number
  metallic?: number
  roughness?: number
  motion?: PartMotion
}

type PartAdder = (position: Vector3, scale: Vector3, color: Color4, options?: PartOptions) => Entity

type BuildingPart = {
  entity: Entity
  color: Color4
  emissive: Color4
  emissiveIntensity: number
  metallic: number
  roughness: number
}

type AnimatedPart = {
  entity: Entity
  motion: PartMotion
  basePosition: Vector3
  baseScale: Vector3
  baseRotation: Quaternion
}

type BuildingRig = {
  parts: BuildingPart[]
  animated: AnimatedPart[]
  time: number
  damageLevel: number
}

const buildingRigs = new Map<Entity, BuildingRig>()

export function buildBuildingModel(root: Entity, race: RaceId, kind: BuildableKind): void {
  const parts: BuildingPart[] = []
  const animated: AnimatedPart[] = []
  const addPart: PartAdder = (position, scale, color, options = {}) => {
    const part = engine.addEntity()
    const rotation = options.rotation ?? Quaternion.Identity()
    Transform.create(part, {
      parent: root,
      position,
      scale,
      rotation
    })

    if (options.sphere) MeshRenderer.setSphere(part)
    else if (options.cone) MeshRenderer.setCylinder(part, 1, 0)
    else if (options.cylinder) MeshRenderer.setCylinder(part)
    else MeshRenderer.setBox(part)

    const material: BuildingPart = {
      entity: part,
      color,
      emissive: options.emissive ?? Color4.Black(),
      emissiveIntensity: options.emissiveIntensity ?? 0,
      metallic: options.metallic ?? 0.2,
      roughness: options.roughness ?? 0.75
    }
    applyPartMaterial(material, 0)

    parts.push(material)
    if (options.motion) {
      animated.push({
        entity: part,
        motion: options.motion,
        basePosition: Vector3.create(position.x, position.y, position.z),
        baseScale: Vector3.create(scale.x, scale.y, scale.z),
        baseRotation: rotation
      })
    }
    return part
  }

  if (race === 'human') buildHumanBuilding(kind, addPart)
  else if (race === 'alien') buildAlienBuilding(kind, addPart)
  else buildBioBuilding(kind, addPart)

  buildingRigs.set(root, { parts, animated, time: Math.random() * 20, damageLevel: 0 })
}

/** Drives the moving parts (radar dishes, floating crystals, pulsing sacs) on every building. */
function buildingAnimationSystem(dt: number): void {
  for (const rig of buildingRigs.values()) {
    if (rig.animated.length === 0) continue
    rig.time += dt

    for (const part of rig.animated) {
      const transform = Transform.getMutable(part.entity)
      const motion = part.motion

      if (motion.mode === 'spin') {
        const angle = (rig.time * motion.speed) % 360
        const spinRotation = motion.axis === 'z' ? Quaternion.fromEulerDegrees(0, 0, angle) : Quaternion.fromEulerDegrees(0, angle, 0)
        transform.rotation = Quaternion.multiply(part.baseRotation, spinRotation)
      } else if (motion.mode === 'bob') {
        const offset = (motion.amplitude ?? 0.3) * Math.sin(rig.time * motion.speed)
        transform.position = Vector3.create(part.basePosition.x, part.basePosition.y + offset, part.basePosition.z)
      } else {
        const scale = 1 + (motion.amplitude ?? 0.1) * Math.sin(rig.time * motion.speed)
        transform.scale = Vector3.create(part.baseScale.x * scale, part.baseScale.y * scale, part.baseScale.z * scale)
      }
    }
  }
}

engine.addSystem(buildingAnimationSystem)

export function isProceduralBuilding(entity: Entity): boolean {
  return buildingRigs.has(entity)
}

export function setBuildingModelVisible(entity: Entity, visible: boolean): void {
  const rig = buildingRigs.get(entity)
  if (!rig) return

  for (const part of rig.parts) {
    VisibilityComponent.createOrReplace(part.entity, { visible })
  }
}

/**
 * Chars the building as HP drops: albedo darkens toward soot and glow parts
 * dim, in steps matching the smoke VFX thresholds. Repairs restore the paint.
 */
export function setBuildingModelDamage(entity: Entity, hpRatio: number): void {
  const rig = buildingRigs.get(entity)
  if (!rig) return

  const level = hpRatio <= 0.2 ? 3 : hpRatio <= 0.4 ? 2 : hpRatio <= 0.7 ? 1 : 0
  if (level === rig.damageLevel) return

  rig.damageLevel = level
  const char = [0, 0.35, 0.6, 0.82][level]
  for (const part of rig.parts) {
    applyPartMaterial(part, char)
  }
}

function applyPartMaterial(part: BuildingPart, char: number): void {
  const soot = (channel: number) => channel * (1 - char) + 0.04 * char
  const glowFade = 1 - char * 0.9

  Material.setPbrMaterial(part.entity, {
    albedoColor: Color4.create(soot(part.color.r), soot(part.color.g), soot(part.color.b), part.color.a),
    emissiveColor: Color4.create(part.emissive.r * glowFade, part.emissive.g * glowFade, part.emissive.b * glowFade, 1),
    emissiveIntensity: part.emissiveIntensity * glowFade,
    metallic: part.metallic * (1 - char),
    roughness: Math.min(1, part.roughness + char * 0.4)
  })
}

export function disposeBuildingModel(entity: Entity, removeParts: boolean): void {
  const rig = buildingRigs.get(entity)
  if (!rig) return

  if (removeParts) {
    for (const part of rig.parts) engine.removeEntity(part.entity)
  }
  buildingRigs.delete(entity)
}

// ---------------------------------------------------------------------------
// Humans: stacked metal blocks, corner pylons, antennas, cyan light strips.

function buildHumanBuilding(kind: BuildableKind, addPart: PartAdder): void {
  if (kind === 'temple') {
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(8, 0.6, 8), HUMAN_DARK)
    addPart(Vector3.create(0, 2.4, 0), Vector3.create(5.6, 3.6, 5.6), HUMAN_HULL)
    addPart(Vector3.create(0, 5.2, 0), Vector3.create(4, 2.2, 4), HUMAN_HULL)
    addPart(Vector3.create(0, 6.9, 0), Vector3.create(3, 1.6, 3), HUMAN_DARK, { sphere: true })
    // Light strips around the main block.
    addPart(Vector3.create(0, 3.4, 2.85), Vector3.create(4.6, 0.22, 0.1), HUMAN_GLOW, { emissive: HUMAN_GLOW, emissiveIntensity: 2 })
    addPart(Vector3.create(0, 3.4, -2.85), Vector3.create(4.6, 0.22, 0.1), HUMAN_GLOW, { emissive: HUMAN_GLOW, emissiveIntensity: 2 })
    addPart(Vector3.create(2.85, 3.4, 0), Vector3.create(0.1, 0.22, 4.6), HUMAN_GLOW, { emissive: HUMAN_GLOW, emissiveIntensity: 2 })
    addPart(Vector3.create(-2.85, 3.4, 0), Vector3.create(0.1, 0.22, 4.6), HUMAN_GLOW, { emissive: HUMAN_GLOW, emissiveIntensity: 2 })
    // Corner pylons with glow caps.
    for (const x of [-3.3, 3.3]) {
      for (const z of [-3.3, 3.3]) {
        addPart(Vector3.create(x, 2.4, z), Vector3.create(0.75, 4.4, 0.75), HUMAN_DARK)
        addPart(Vector3.create(x, 4.75, z), Vector3.create(0.5, 0.3, 0.5), HUMAN_GLOW, { emissive: HUMAN_GLOW, emissiveIntensity: 2.4 })
      }
    }
    addPart(Vector3.create(0, 9.2, 0), Vector3.create(0.16, 3.2, 0.16), HUMAN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 10.8, 0), Vector3.create(0.4, 0.4, 0.4), HUMAN_GLOW, {
      sphere: true,
      emissive: HUMAN_GLOW,
      emissiveIntensity: 3,
      motion: { mode: 'pulse', speed: 3, amplitude: 0.25 }
    })
    // Rotating radar dish sweeping the horizon.
    addPart(Vector3.create(1.4, 8.2, 0), Vector3.create(1.6, 0.14, 0.5), HUMAN_HULL, {
      motion: { mode: 'spin', speed: 40 }
    })
    return
  }

  if (kind === 'supplyHouse') {
    addPart(Vector3.create(0, 0.25, 0), Vector3.create(5.4, 0.5, 5.4), HUMAN_DARK)
    addPart(Vector3.create(0, 1.5, 0), Vector3.create(4.2, 2.2, 4.2), HUMAN_HULL)
    addPart(Vector3.create(0, 3, 0), Vector3.create(3.6, 1.8, 3.6), HUMAN_DARK, { sphere: true })
    addPart(Vector3.create(0, 1.4, 2.12), Vector3.create(1.2, 1.7, 0.1), HUMAN_GLOW, { emissive: HUMAN_GLOW, emissiveIntensity: 1.8 })
    addPart(Vector3.create(1.6, 2.75, 1.6), Vector3.create(0.35, 0.9, 0.35), HUMAN_DARK, { cylinder: true })
    addPart(Vector3.create(-1.6, 2.75, 1.6), Vector3.create(0.35, 0.9, 0.35), HUMAN_DARK, { cylinder: true })
    return
  }

  if (kind === 'barracks') {
    addPart(Vector3.create(0, 0.25, 0), Vector3.create(5.6, 0.5, 5.6), HUMAN_DARK)
    addPart(Vector3.create(0, 2, 0), Vector3.create(5, 3.2, 4.4), HUMAN_HULL)
    addPart(Vector3.create(0, 4, 0), Vector3.create(5.4, 0.9, 4.8), HUMAN_DARK)
    // Hangar door glow.
    addPart(Vector3.create(0, 1.7, 2.25), Vector3.create(2.4, 2.4, 0.1), HUMAN_GLOW, { emissive: HUMAN_GLOW, emissiveIntensity: 1.6 })
    // Side watch towers.
    for (const x of [-2.2, 2.2]) {
      addPart(Vector3.create(x, 4.9, -1.4), Vector3.create(0.9, 2.4, 0.9), HUMAN_HULL)
      addPart(Vector3.create(x, 6.2, -1.4), Vector3.create(0.6, 0.25, 0.6), HUMAN_GLOW, {
        emissive: HUMAN_GLOW,
        emissiveIntensity: 2.2,
        motion: { mode: 'pulse', speed: 4, amplitude: 0.18 }
      })
    }
    return
  }

  if (kind === 'techLab') {
    // Starforge: a research spire with a spinning gyro ring and a floating reactor core.
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(5.2, 0.6, 5.2), HUMAN_DARK)
    addPart(Vector3.create(0, 1.9, 0), Vector3.create(3.6, 2.6, 3.6), HUMAN_HULL)
    addPart(Vector3.create(0, 3.5, 0), Vector3.create(2.6, 0.7, 2.6), HUMAN_DARK)
    addPart(Vector3.create(0, 4.6, 0), Vector3.create(1.8, 1.6, 1.8), HUMAN_HULL, { cylinder: true })
    // Window strips.
    addPart(Vector3.create(0, 2, 1.85), Vector3.create(2.6, 0.4, 0.1), HUMAN_GLOW, { emissive: HUMAN_GLOW, emissiveIntensity: 1.8 })
    addPart(Vector3.create(0, 2, -1.85), Vector3.create(2.6, 0.4, 0.1), HUMAN_GLOW, { emissive: HUMAN_GLOW, emissiveIntensity: 1.8 })
    // Spinning gyro ring around the tower neck.
    addPart(Vector3.create(0, 4.6, 0), Vector3.create(3.2, 0.18, 0.6), HUMAN_DARK, {
      motion: { mode: 'spin', speed: 70 }
    })
    // Floating reactor core above the spire.
    addPart(Vector3.create(0, 6.6, 0), Vector3.create(0.9, 0.9, 0.9), HUMAN_GLOW, {
      sphere: true,
      emissive: HUMAN_GLOW,
      emissiveIntensity: 2.6,
      motion: { mode: 'bob', speed: 1.6, amplitude: 0.4 }
    })
    // Support pylons.
    for (const x of [-2.1, 2.1]) {
      addPart(Vector3.create(x, 1.6, 0), Vector3.create(0.5, 3, 0.5), HUMAN_DARK)
    }
    return
  }

  if (kind === 'forge') {
    // Engineering Bay: furnace block with a huge spinning gear and a pulsing forge glow.
    addPart(Vector3.create(0, 0.25, 0), Vector3.create(4.4, 0.5, 4.4), HUMAN_DARK)
    addPart(Vector3.create(0, 1.7, 0), Vector3.create(3.6, 2.4, 3.2), HUMAN_HULL)
    addPart(Vector3.create(0, 3.1, 0), Vector3.create(3.9, 0.5, 3.5), HUMAN_DARK)
    // Furnace mouth glowing hot.
    addPart(Vector3.create(0, 1.3, 1.65), Vector3.create(1.6, 1.2, 0.1), Color4.create(1, 0.55, 0.2, 1), {
      emissive: Color4.create(1, 0.5, 0.15, 1),
      emissiveIntensity: 2.2,
      motion: { mode: 'pulse', speed: 5, amplitude: 0.12 }
    })
    // Big side gear turning slowly.
    addPart(Vector3.create(2.05, 1.9, 0), Vector3.create(0.3, 1.8, 1.8), HUMAN_DARK, {
      cylinder: true,
      rotation: Quaternion.fromEulerDegrees(0, 0, 90),
      motion: { mode: 'spin', speed: 50, axis: 'y' }
    })
    addPart(Vector3.create(2.2, 1.9, 0), Vector3.create(0.2, 2.3, 0.5), HUMAN_HULL, {
      rotation: Quaternion.fromEulerDegrees(0, 0, 0),
      motion: { mode: 'spin', speed: 50, axis: 'z' }
    })
    // Smokestacks.
    addPart(Vector3.create(-1.4, 3.9, -1), Vector3.create(0.5, 1.6, 0.5), HUMAN_DARK, { cylinder: true })
    addPart(Vector3.create(-0.5, 4.2, -1), Vector3.create(0.4, 2.2, 0.4), HUMAN_DARK, { cylinder: true })
    return
  }

  // Beacon (fireplace slot): tripod mast with a bright signal light.
  addPart(Vector3.create(0, 0.15, 0), Vector3.create(1.8, 0.3, 1.8), HUMAN_DARK, { cylinder: true })
  addPart(Vector3.create(0, 1.3, 0), Vector3.create(0.22, 2.2, 0.22), HUMAN_HULL, { cylinder: true })
  addPart(Vector3.create(0, 2.6, 0), Vector3.create(0.55, 0.55, 0.55), HUMAN_GLOW, {
    sphere: true,
    emissive: HUMAN_GLOW,
    emissiveIntensity: 3,
    motion: { mode: 'pulse', speed: 4, amplitude: 0.2 }
  })
}

// ---------------------------------------------------------------------------
// Aliens: tapered golden tiers, floating crystals, glowing portals.

function buildAlienBuilding(kind: BuildableKind, addPart: PartAdder): void {
  // Floating crystals bob and slowly rotate - the alien signature moving part.
  const crystalDiamond = (x: number, y: number, z: number, size: number) => {
    addPart(Vector3.create(x, y + size * 0.5, z), Vector3.create(size, size, size), ALIEN_CRYSTAL, {
      cone: true,
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 1.8,
      motion: { mode: 'bob', speed: 1.4, amplitude: size * 0.18 }
    })
    addPart(Vector3.create(x, y - size * 0.5, z), Vector3.create(size, size, size), ALIEN_CRYSTAL, {
      cone: true,
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 1.8,
      rotation: Quaternion.fromEulerDegrees(180, 0, 0),
      motion: { mode: 'bob', speed: 1.4, amplitude: size * 0.18 }
    })
  }

  if (kind === 'temple') {
    addPart(Vector3.create(0, 0.4, 0), Vector3.create(8.2, 0.8, 8.2), ALIEN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 1.9, 0), Vector3.create(6.4, 2.2, 6.4), ALIEN_GOLD, { metallic: 0.7, roughness: 0.3 })
    addPart(Vector3.create(0, 3.1, 0), Vector3.create(5.2, 0.35, 5.2), ALIEN_DARK)
    addPart(Vector3.create(0, 4.3, 0), Vector3.create(4.6, 2, 4.6), ALIEN_GOLD, { metallic: 0.7, roughness: 0.3 })
    addPart(Vector3.create(0, 5.4, 0), Vector3.create(3.6, 0.35, 3.6), ALIEN_DARK)
    addPart(Vector3.create(0, 6.4, 0), Vector3.create(3, 1.8, 3), ALIEN_GOLD, { metallic: 0.7, roughness: 0.3 })
    // Floating power crystal above the spire.
    crystalDiamond(0, 9.4, 0, 1.7)
    // Corner spikes.
    for (const x of [-3.4, 3.4]) {
      for (const z of [-3.4, 3.4]) {
        addPart(Vector3.create(x, 1.8, z), Vector3.create(0.6, 2.6, 0.6), ALIEN_GOLD, { cone: true, metallic: 0.7, roughness: 0.3 })
      }
    }
    return
  }

  if (kind === 'supplyHouse') {
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(4.6, 0.6, 4.6), ALIEN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 1.7, 0), Vector3.create(1.9, 2.4, 1.9), ALIEN_GOLD, { metallic: 0.7, roughness: 0.3 })
    addPart(Vector3.create(0, 3.15, 0), Vector3.create(1.3, 0.7, 1.3), ALIEN_DARK)
    crystalDiamond(0, 4.4, 0, 1.1)
    return
  }

  if (kind === 'barracks') {
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(5.6, 0.6, 5.6), ALIEN_DARK)
    // Two pillars and a lintel form the warp gate.
    for (const x of [-2, 2]) {
      addPart(Vector3.create(x, 2.9, 0), Vector3.create(1.2, 4.8, 1.2), ALIEN_GOLD, { metallic: 0.7, roughness: 0.3 })
      addPart(Vector3.create(x, 5.35, 0), Vector3.create(1.5, 0.4, 1.5), ALIEN_DARK)
    }
    addPart(Vector3.create(0, 5.9, 0), Vector3.create(5.6, 0.9, 1.4), ALIEN_GOLD, { metallic: 0.7, roughness: 0.3 })
    // Glowing portal sheet between the pillars, shimmering.
    addPart(Vector3.create(0, 3, 0), Vector3.create(2.9, 4, 0.18), ALIEN_CRYSTAL, {
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2.2,
      motion: { mode: 'pulse', speed: 2.4, amplitude: 0.06 }
    })
    return
  }

  if (kind === 'techLab') {
    // Sanctum: a levitation temple with a huge crystal held in a rotating claw crown.
    addPart(Vector3.create(0, 0.35, 0), Vector3.create(6, 0.7, 6), ALIEN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 1.6, 0), Vector3.create(4.4, 1.6, 4.4), ALIEN_GOLD, { cylinder: true, metallic: 0.7, roughness: 0.3 })
    addPart(Vector3.create(0, 2.6, 0), Vector3.create(3.2, 0.4, 3.2), ALIEN_DARK, { cylinder: true })
    // Three claw prongs curving inward, rotating as a crown.
    addPart(Vector3.create(0, 4.1, 0), Vector3.create(3.4, 0.3, 0.7), ALIEN_GOLD, {
      metallic: 0.7,
      roughness: 0.3,
      motion: { mode: 'spin', speed: 26 }
    })
    addPart(Vector3.create(0, 4.7, 0), Vector3.create(0.7, 0.3, 3.4), ALIEN_GOLD, {
      metallic: 0.7,
      roughness: 0.3,
      motion: { mode: 'spin', speed: -26 }
    })
    // The grand crystal floats in the middle of the crown.
    crystalDiamond(0, 5.8, 0, 1.5)
    // Ring of small pillars.
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2
      addPart(Vector3.create(Math.cos(angle) * 2.4, 1.9, Math.sin(angle) * 2.4), Vector3.create(0.45, 2.4, 0.45), ALIEN_DARK)
    }
    return
  }

  if (kind === 'forge') {
    // Ascension Spire: a needle with a spinning halo ring and a blazing tip gem.
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(4.4, 0.6, 4.4), ALIEN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 1.2, 0), Vector3.create(2.4, 1.4, 2.4), ALIEN_GOLD, { metallic: 0.7, roughness: 0.3 })
    addPart(Vector3.create(0, 3.2, 0), Vector3.create(1, 3.4, 1), ALIEN_GOLD, { cone: true, metallic: 0.7, roughness: 0.3 })
    // Halo ring orbiting the needle.
    addPart(Vector3.create(0, 3.4, 0), Vector3.create(2.6, 0.14, 0.4), ALIEN_CRYSTAL, {
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 1.6,
      motion: { mode: 'spin', speed: 60 }
    })
    // Blazing gem at the tip.
    addPart(Vector3.create(0, 5.3, 0), Vector3.create(0.55, 0.55, 0.55), ALIEN_CRYSTAL, {
      sphere: true,
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2.8,
      motion: { mode: 'pulse', speed: 3.2, amplitude: 0.22 }
    })
    return
  }

  // Obelisk (fireplace slot): a small golden spike with a crystal tip.
  addPart(Vector3.create(0, 0.2, 0), Vector3.create(1.7, 0.4, 1.7), ALIEN_DARK, { cylinder: true })
  addPart(Vector3.create(0, 1.5, 0), Vector3.create(0.8, 2.4, 0.8), ALIEN_GOLD, { cone: true, metallic: 0.7, roughness: 0.3 })
  crystalDiamond(0, 3, 0, 0.6)
}

// ---------------------------------------------------------------------------
// Bio Swarm: fleshy mounds, bone spikes, glowing sacs and acid pools.

function buildBioBuilding(kind: BuildableKind, addPart: PartAdder): void {
  // Sacs breathe - the bio signature moving part.
  const sac = (x: number, y: number, z: number, size: number) => {
    addPart(Vector3.create(x, y, z), Vector3.create(size, size, size), BIO_SAC, {
      sphere: true,
      emissive: BIO_SAC,
      emissiveIntensity: 1.4,
      metallic: 0,
      roughness: 0.6,
      motion: { mode: 'pulse', speed: 2.2, amplitude: 0.1 }
    })
  }
  const spike = (x: number, y: number, z: number, height: number, tiltX: number, tiltZ: number) => {
    addPart(Vector3.create(x, y, z), Vector3.create(height * 0.28, height, height * 0.28), BIO_CARAPACE, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(tiltX, 0, tiltZ),
      roughness: 0.5
    })
  }

  if (kind === 'temple') {
    // Main hive mound with smaller growths around it.
    addPart(Vector3.create(0, 2.4, 0), Vector3.create(8, 5.6, 8), BIO_FLESH, { sphere: true, roughness: 0.85 })
    addPart(Vector3.create(2.9, 1.1, 2.4), Vector3.create(3.2, 2.6, 3.2), BIO_FLESH, { sphere: true, roughness: 0.85 })
    addPart(Vector3.create(-2.7, 1, -2.5), Vector3.create(2.8, 2.2, 2.8), BIO_FLESH, { sphere: true, roughness: 0.85 })
    // Top orifice with an inner glow that swells like breathing.
    addPart(Vector3.create(0, 5.2, 0), Vector3.create(2.4, 1.2, 2.4), BIO_CARAPACE, { cylinder: true })
    addPart(Vector3.create(0, 5.6, 0), Vector3.create(1.7, 0.5, 1.7), BIO_ACID, {
      cylinder: true,
      emissive: BIO_ACID,
      emissiveIntensity: 2,
      motion: { mode: 'pulse', speed: 1.8, amplitude: 0.12 }
    })
    spike(3.1, 4, -1.6, 3.4, 12, -24)
    spike(-3, 4.2, 1.4, 3.8, -10, 22)
    spike(1.6, 5.6, 2.7, 3, 20, 10)
    sac(2.3, 2.6, -2.9, 1.2)
    sac(-3.1, 2.2, 1.9, 1)
    sac(-1.4, 3.6, -3, 0.9)
    return
  }

  if (kind === 'supplyHouse') {
    addPart(Vector3.create(0, 1.3, 0), Vector3.create(4.4, 3, 4.4), BIO_FLESH, { sphere: true, roughness: 0.85 })
    addPart(Vector3.create(1.5, 0.9, 1.5), Vector3.create(2.2, 1.8, 2.2), BIO_FLESH, { sphere: true, roughness: 0.85 })
    sac(0, 3.2, 0, 1.5)
    sac(-1.7, 1.6, 1.2, 0.9)
    spike(-1.4, 2.2, -1.5, 2.4, -14, -16)
    return
  }

  if (kind === 'barracks') {
    // Low crater rim with a glowing spawning pool that churns.
    addPart(Vector3.create(0, 0.8, 0), Vector3.create(5.6, 2, 5.6), BIO_FLESH, { sphere: true, roughness: 0.85 })
    addPart(Vector3.create(0, 1.55, 0), Vector3.create(3.4, 0.5, 3.4), BIO_CARAPACE, { cylinder: true })
    addPart(Vector3.create(0, 1.85, 0), Vector3.create(2.6, 0.3, 2.6), BIO_ACID, {
      cylinder: true,
      emissive: BIO_ACID,
      emissiveIntensity: 2.4,
      motion: { mode: 'pulse', speed: 2.6, amplitude: 0.1 }
    })
    spike(2.4, 2, 1.3, 3, 16, -18)
    spike(-2.3, 2.1, -1.2, 3.2, -14, 20)
    spike(-1.2, 2, 2.3, 2.6, 18, 12)
    spike(1.4, 1.9, -2.4, 2.8, -20, -10)
    sac(2.6, 1, -1.8, 1)
    return
  }

  if (kind === 'techLab') {
    // Grand Nest: a towering egg chamber - the great egg throbs inside a bone cradle.
    addPart(Vector3.create(0, 1.4, 0), Vector3.create(5.8, 3.2, 5.8), BIO_FLESH, { sphere: true, roughness: 0.85 })
    addPart(Vector3.create(2.2, 0.9, -1.9), Vector3.create(2.4, 2, 2.4), BIO_FLESH, { sphere: true, roughness: 0.85 })
    // The great egg.
    addPart(Vector3.create(0, 4.2, 0), Vector3.create(2.6, 3.2, 2.6), Color4.create(0.75, 0.55, 0.45, 1), {
      sphere: true,
      emissive: BIO_SAC,
      emissiveIntensity: 0.7,
      roughness: 0.6,
      motion: { mode: 'pulse', speed: 1.6, amplitude: 0.07 }
    })
    // Bone cradle fingers around the egg.
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + 0.4
      addPart(
        Vector3.create(Math.cos(angle) * 1.7, 4, Math.sin(angle) * 1.7),
        Vector3.create(0.3, 2.8, 0.3),
        Color4.create(0.75, 0.68, 0.55, 1),
        { cone: true, rotation: Quaternion.fromEulerDegrees(Math.sin(angle) * -18, 0, Math.cos(angle) * 18), roughness: 0.5 }
      )
    }
    spike(2.6, 3, 1.6, 3.4, 18, -16)
    spike(-2.5, 3.1, -1.4, 3.6, -14, 18)
    sac(-2.2, 1.8, 2, 1.1)
    sac(2.8, 1.5, 0.4, 0.9)
    return
  }

  if (kind === 'forge') {
    // Evolution Chamber: a chrysalis pod suspended in a rib cage, pulsing with change.
    addPart(Vector3.create(0, 0.9, 0), Vector3.create(4.6, 2.2, 4.6), BIO_FLESH, { sphere: true, roughness: 0.85 })
    // Rib cage arcs.
    for (const side of [-1, 1]) {
      addPart(Vector3.create(side * 1.5, 2.6, 0), Vector3.create(0.26, 2.6, 0.26), Color4.create(0.75, 0.68, 0.55, 1), {
        cone: true,
        rotation: Quaternion.fromEulerDegrees(0, 0, side * -22),
        roughness: 0.5
      })
      addPart(Vector3.create(0, 2.6, side * 1.5), Vector3.create(0.26, 2.6, 0.26), Color4.create(0.75, 0.68, 0.55, 1), {
        cone: true,
        rotation: Quaternion.fromEulerDegrees(side * 22, 0, 0),
        roughness: 0.5
      })
    }
    // The chrysalis, glowing and throbbing.
    addPart(Vector3.create(0, 3, 0), Vector3.create(1.6, 2.2, 1.6), BIO_ACID, {
      sphere: true,
      emissive: BIO_ACID,
      emissiveIntensity: 1.8,
      roughness: 0.6,
      motion: { mode: 'pulse', speed: 2.8, amplitude: 0.12 }
    })
    sac(1.9, 1.2, 1.4, 0.9)
    return
  }

  // Spore Mound (fireplace slot): a small mound with one bright sac.
  addPart(Vector3.create(0, 0.7, 0), Vector3.create(2.2, 1.6, 2.2), BIO_FLESH, { sphere: true, roughness: 0.85 })
  spike(0.6, 1.4, 0.5, 1.8, 14, -12)
  sac(0, 1.9, 0, 1)
}
