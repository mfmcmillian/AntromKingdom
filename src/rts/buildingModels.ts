import { Entity, GltfContainer, Material, MeshRenderer, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { BUILDING_DEFINITIONS } from './config'
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

/**
 * Meshy-generated building models (optimized by scripts/optimize-unit-models.mjs:
 * feet at y=0, XZ-centered, pre-scaled to fit the collider height and placement
 * footprint). When a race/kind pair is listed here it replaces the procedural
 * build; anything missing falls back to the primitive-part version below.
 * yaw turns the model so its front door faces the building's +Z.
 */
const GLB_BUILDINGS: Record<RaceId, Partial<Record<BuildableKind, { src: string; yaw?: number }>>> = {
  human: {
    temple: { src: 'models/buildings/human/temple.glb' },
    supplyHouse: { src: 'models/buildings/human/supplyHouse.glb' },
    barracks: { src: 'models/buildings/human/barracks.glb' },
    techLab: { src: 'models/buildings/human/techLab.glb' },
    forge: { src: 'models/buildings/human/forge.glb' },
    airForge: { src: 'models/buildings/human/airForge.glb' },
    fireplace: { src: 'models/buildings/human/fireplace.glb' },
    turret: { src: 'models/buildings/human/turret.glb' }
  },
  alien: {
    temple: { src: 'models/buildings/alien/temple.glb' },
    supplyHouse: { src: 'models/buildings/alien/supplyHouse.glb' },
    barracks: { src: 'models/buildings/alien/barracks.glb' },
    techLab: { src: 'models/buildings/alien/techLab.glb' },
    forge: { src: 'models/buildings/alien/forge.glb' },
    airForge: { src: 'models/buildings/alien/airForge.glb' },
    fireplace: { src: 'models/buildings/alien/fireplace.glb' },
    turret: { src: 'models/buildings/alien/turret.glb' }
  },
  bio: {
    temple: { src: 'models/buildings/bio/temple.glb' },
    supplyHouse: { src: 'models/buildings/bio/supplyHouse.glb' },
    barracks: { src: 'models/buildings/bio/barracks.glb' },
    techLab: { src: 'models/buildings/bio/techLab.glb' },
    forge: { src: 'models/buildings/bio/forge.glb' },
    airForge: { src: 'models/buildings/bio/airForge.glb' },
    fireplace: { src: 'models/buildings/bio/fireplace.glb' },
    turret: { src: 'models/buildings/bio/turret.glb' }
  }
}

/** Approximate model heights, used for click colliders and damage VFX anchors. */
export const BUILDING_MODEL_HEIGHTS: Record<BuildableKind, number> = {
  temple: 11,
  supplyHouse: 5,
  barracks: 7,
  techLab: 8,
  forge: 6,
  airForge: 7,
  fireplace: 3,
  turret: 5
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
  mode: 'spin' | 'bob' | 'pulse' | 'orbit' | 'ember'
  /** Degrees/second for spin, cycles-modulating speed for bob/pulse/orbit, cycles/second for ember. */
  speed: number
  /** Bob: meters of travel. Pulse: fraction of base scale. */
  amplitude?: number
  axis?: 'y' | 'z'
  /** Orbit: circle radius around the base position. Ember: lateral drift radius. */
  radius?: number
  /** Orbit: vertical wobble. Ember: rise distance before looping. */
  height?: number
  /** Stagger offset so groups of parts don't move in lockstep. */
  phase?: number
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
  /** Translucent FX parts (smoke, light rays) must not throw shadows. */
  castShadows?: boolean
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
  castShadows: boolean
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
  /** GLB container entities (Meshy buildings). Visibility toggles cover them; damage charring does not. */
  glbEntities: Entity[]
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
      roughness: options.roughness ?? 0.75,
      castShadows: options.castShadows ?? true
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

  const glbEntities: Entity[] = []
  const glb = GLB_BUILDINGS[race]?.[kind]
  if (glb) {
    const rotation = Quaternion.fromEulerDegrees(0, glb.yaw ?? 0, 0)
    const model = engine.addEntity()
    Transform.create(model, { parent: root, rotation })
    GltfContainer.create(model, { src: glb.src })
    glbEntities.push(model)
    addGlbAmbientFx(race, kind, addPart, animated, model, rotation)
  } else if (race === 'human') buildHumanBuilding(kind, addPart)
  else if (race === 'alien') buildAlienBuilding(kind, addPart)
  else buildBioBuilding(kind, addPart)

  buildingRigs.set(root, { parts, animated, glbEntities, time: Math.random() * 20, damageLevel: 0 })
}

// ---------------------------------------------------------------------------
// Ambient life for the Meshy GLB buildings. The models themselves are static,
// so each race gets a signature idle effect layered on top:
//   human - black industrial smoke coughing out of the roofline.
//   alien - a soft light pillar plus glowing rays slowly orbiting the spire.
//   bio   - the whole structure breathes, swelling in and out like a lung.
// ---------------------------------------------------------------------------

const SMOKE_DARK = Color4.create(0.12, 0.12, 0.14, 0.55)

function addGlbAmbientFx(
  race: RaceId,
  kind: BuildableKind,
  addPart: PartAdder,
  animated: AnimatedPart[],
  model: Entity,
  modelRotation: Quaternion
): void {
  const definition = BUILDING_DEFINITIONS[kind]
  const width = Math.max(definition.scale.x, definition.scale.z)
  const height = BUILDING_MODEL_HEIGHTS[kind]

  if (race === 'bio') {
    // Breathing: pulse the GLB container itself. Slow, shallow, phase-offset so
    // a base full of mounds heaves like a sleeping herd instead of a metronome.
    animated.push({
      entity: model,
      motion: { mode: 'pulse', speed: 1.05, amplitude: 0.035, phase: Math.random() * Math.PI * 2 },
      basePosition: Vector3.Zero(),
      baseScale: Vector3.One(),
      baseRotation: modelRotation
    })
    return
  }

  // Turrets are small military hardware; smokestacks and light shows read wrong on them.
  if (kind === 'turret') return

  if (race === 'human') {
    // Chimney smoke: fat dark puffs rising off the roofline, dissolving as they
    // climb. Two stacks on the big buildings so the skyline looks industrial.
    const stacks = height >= 7 ? 2 : 1
    for (let s = 0; s < stacks; s++) {
      const side = s === 0 ? 1 : -1
      const anchor = Vector3.create(width * 0.16 * side, height * 0.8, -width * 0.12 * side)
      for (let i = 0; i < 4; i++) {
        addPart(anchor, Vector3.create(0.5, 0.5, 0.5), SMOKE_DARK, {
          sphere: true,
          metallic: 0,
          roughness: 1,
          castShadows: false,
          motion: { mode: 'ember', speed: 0.22, radius: 0.4, height: 2.8, phase: i / 4 + s * 0.37 }
        })
      }
    }
    return
  }

  // Alien: a translucent light pillar rising through the structure, ringed by
  // thin glowing rays that drift around the spire and pulse out of phase.
  addPart(Vector3.create(0, height * 0.72, 0), Vector3.create(0.4, height * 0.85, 0.4), Color4.create(ALIEN_CRYSTAL.r, ALIEN_CRYSTAL.g, ALIEN_CRYSTAL.b, 0.2), {
    cylinder: true,
    emissive: ALIEN_CRYSTAL,
    emissiveIntensity: 1.5,
    metallic: 0,
    roughness: 1,
    castShadows: false,
    motion: { mode: 'pulse', speed: 1.5, amplitude: 0.16 }
  })
  for (let i = 0; i < 3; i++) {
    addPart(Vector3.create(0, height * 0.68, 0), Vector3.create(0.09, height * 0.5, 0.09), Color4.create(ALIEN_CRYSTAL.r, ALIEN_CRYSTAL.g, ALIEN_CRYSTAL.b, 0.5), {
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2.4,
      metallic: 0,
      roughness: 1,
      castShadows: false,
      motion: { mode: 'orbit', speed: 0.45, radius: width * 0.24, height: 0.35, phase: (i / 3) * Math.PI * 2 }
    })
  }
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
        const offset = (motion.amplitude ?? 0.3) * Math.sin(rig.time * motion.speed + (motion.phase ?? 0))
        transform.position = Vector3.create(part.basePosition.x, part.basePosition.y + offset, part.basePosition.z)
      } else if (motion.mode === 'orbit') {
        const t = rig.time * motion.speed + (motion.phase ?? 0)
        transform.position = Vector3.create(
          part.basePosition.x + Math.cos(t) * (motion.radius ?? 1),
          part.basePosition.y + Math.sin(t * 2.1) * (motion.height ?? 0),
          part.basePosition.z + Math.sin(t) * (motion.radius ?? 1)
        )
      } else if (motion.mode === 'ember') {
        // Rise, drift sideways and shrink to nothing, then respawn at the anchor.
        const cycle = (rig.time * motion.speed + (motion.phase ?? 0)) % 1
        const wobble = rig.time * 1.2 + (motion.phase ?? 0) * 17
        const fade = 1 - cycle
        transform.position = Vector3.create(
          part.basePosition.x + Math.sin(wobble) * (motion.radius ?? 0.2),
          part.basePosition.y + cycle * (motion.height ?? 1.5),
          part.basePosition.z + Math.cos(wobble * 0.9) * (motion.radius ?? 0.2)
        )
        transform.scale = Vector3.create(part.baseScale.x * fade, part.baseScale.y * fade, part.baseScale.z * fade)
      } else {
        const scale = 1 + (motion.amplitude ?? 0.1) * Math.sin(rig.time * motion.speed + (motion.phase ?? 0))
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
  for (const entity of rig.glbEntities) {
    VisibilityComponent.createOrReplace(entity, { visible })
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
    roughness: Math.min(1, part.roughness + char * 0.4),
    castShadows: part.castShadows
  })
}

export function disposeBuildingModel(entity: Entity, removeParts: boolean): void {
  const rig = buildingRigs.get(entity)
  if (!rig) return

  if (removeParts) {
    for (const part of rig.parts) engine.removeEntity(part.entity)
    for (const glbEntity of rig.glbEntities) engine.removeEntity(glbEntity)
  }
  buildingRigs.delete(entity)
}

// ---------------------------------------------------------------------------
// Humans: layered military-industrial metal, cyan light strips, hazard trim,
// blinking beacons, working machinery.

const HUMAN_STEEL = Color4.create(0.45, 0.48, 0.55, 1)
const HAZARD_YELLOW = Color4.create(0.92, 0.72, 0.18, 1)
const MOLTEN = Color4.create(1, 0.5, 0.15, 1)
const WARN_RED = Color4.create(1, 0.28, 0.22, 1)

function buildHumanBuilding(kind: BuildableKind, addPart: PartAdder): void {
  const steel = { metallic: 0.6, roughness: 0.35 }
  const strip = (position: Vector3, scale: Vector3, intensity = 2) =>
    addPart(position, scale, HUMAN_GLOW, { emissive: HUMAN_GLOW, emissiveIntensity: intensity })
  const blinker = (position: Vector3, size: number, color = HUMAN_GLOW, phase = 0) =>
    addPart(position, Vector3.create(size, size, size), color, {
      sphere: true,
      emissive: color,
      emissiveIntensity: 3,
      motion: { mode: 'pulse', speed: 3.4, amplitude: 0.3, phase }
    })

  if (kind === 'temple') {
    // Bastion HQ: tiered command tower with a fusion core, landing pad,
    // double radar and a holo-drone belt circling the spire.
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(8.4, 0.6, 8.4), HUMAN_DARK)
    addPart(Vector3.create(0, 0.75, 0), Vector3.create(7, 0.4, 7), HUMAN_STEEL, steel)
    // Hazard-striped apron edges.
    addPart(Vector3.create(0, 0.62, 3.6), Vector3.create(7.2, 0.14, 0.3), HAZARD_YELLOW)
    addPart(Vector3.create(0, 0.62, -3.6), Vector3.create(7.2, 0.14, 0.3), HAZARD_YELLOW)
    // Main tier with window bands on all faces.
    addPart(Vector3.create(0, 2.5, 0), Vector3.create(5.6, 3.4, 5.6), HUMAN_HULL, steel)
    strip(Vector3.create(0, 3.2, 2.85), Vector3.create(4.6, 0.24, 0.1))
    strip(Vector3.create(0, 3.2, -2.85), Vector3.create(4.6, 0.24, 0.1))
    strip(Vector3.create(2.85, 3.2, 0), Vector3.create(0.1, 0.24, 4.6))
    strip(Vector3.create(-2.85, 3.2, 0), Vector3.create(0.1, 0.24, 4.6))
    strip(Vector3.create(0, 2.2, 2.85), Vector3.create(3.4, 0.16, 0.1), 1.5)
    strip(Vector3.create(0, 2.2, -2.85), Vector3.create(3.4, 0.16, 0.1), 1.5)
    // Exposed fusion core ring between the tiers.
    addPart(Vector3.create(0, 4.5, 0), Vector3.create(4.4, 0.5, 4.4), HUMAN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 4.5, 0), Vector3.create(4.05, 0.3, 4.05), HUMAN_GLOW, {
      cylinder: true,
      emissive: HUMAN_GLOW,
      emissiveIntensity: 2.4,
      motion: { mode: 'pulse', speed: 2.2, amplitude: 0.05 }
    })
    // Upper tier and command dome.
    addPart(Vector3.create(0, 5.9, 0), Vector3.create(4, 2.2, 4), HUMAN_HULL, steel)
    strip(Vector3.create(0, 6.1, 2.05), Vector3.create(2.8, 0.2, 0.1))
    strip(Vector3.create(0, 6.1, -2.05), Vector3.create(2.8, 0.2, 0.1))
    addPart(Vector3.create(0, 7.5, 0), Vector3.create(3, 1.6, 3), HUMAN_DARK, { sphere: true, ...steel })
    // Corner buttress towers with staggered blinkers.
    let corner = 0
    for (const x of [-3.3, 3.3]) {
      for (const z of [-3.3, 3.3]) {
        addPart(Vector3.create(x, 2.5, z), Vector3.create(0.8, 4.6, 0.8), HUMAN_DARK)
        addPart(Vector3.create(x, 4.95, z), Vector3.create(1, 0.3, 1), HUMAN_STEEL, steel)
        blinker(Vector3.create(x, 5.35, z), 0.34, HUMAN_GLOW, corner * 1.6)
        corner++
      }
    }
    // Comm mast: main dish, counter-spinning short-range dish, beacon.
    addPart(Vector3.create(0, 9.4, 0), Vector3.create(0.18, 3.4, 0.18), HUMAN_DARK, { cylinder: true })
    addPart(Vector3.create(1.5, 8.4, 0), Vector3.create(1.8, 0.14, 0.5), HUMAN_HULL, { ...steel, motion: { mode: 'spin', speed: 40 } })
    addPart(Vector3.create(-0.9, 9.6, 0), Vector3.create(1.1, 0.1, 0.34), HUMAN_STEEL, { ...steel, motion: { mode: 'spin', speed: -70 } })
    blinker(Vector3.create(0, 11.2, 0), 0.42, WARN_RED)
    // Holo-drone belt circling the spire.
    for (let i = 0; i < 3; i++) {
      addPart(Vector3.create(0, 7.2, 0), Vector3.create(0.16, 0.16, 0.16), HUMAN_GLOW, {
        emissive: HUMAN_GLOW,
        emissiveIntensity: 3.2,
        motion: { mode: 'orbit', speed: 0.9, radius: 3.1, height: 0.25, phase: (i / 3) * Math.PI * 2 }
      })
    }
    return
  }

  if (kind === 'supplyHouse') {
    // Depot: a silo farm - three storage tanks with glowing fill gauges,
    // linked by pipes, topped with a spinning vent fan.
    addPart(Vector3.create(0, 0.25, 0), Vector3.create(5.6, 0.5, 5.6), HUMAN_DARK)
    addPart(Vector3.create(0, 0.58, 2.6), Vector3.create(5.6, 0.16, 0.3), HAZARD_YELLOW)
    const silos: [number, number, number, number][] = [
      [-1.5, 1.3, 1.9, 3.4],
      [1.6, -1.3, 1.75, 3.0],
      [-1.4, -1.5, 1.5, 2.5]
    ]
    let s = 0
    for (const [x, z, r, h] of silos) {
      addPart(Vector3.create(x, h / 2 + 0.4, z), Vector3.create(r, h, r), HUMAN_HULL, steel)
      addPart(Vector3.create(x, h + 0.55, z), Vector3.create(r * 0.92, 0.5, r * 0.92), HUMAN_DARK, { sphere: true })
      // Vertical fill gauge, pulsing as stock moves.
      addPart(Vector3.create(x, h / 2 + 0.4, z + r / 2 + 0.04), Vector3.create(0.18, h * 0.7, 0.08), HUMAN_GLOW, {
        emissive: HUMAN_GLOW,
        emissiveIntensity: 2.2,
        motion: { mode: 'pulse', speed: 2 + s * 0.5, amplitude: 0.08, phase: s * 2 }
      })
      s++
    }
    // Transfer pipes linking the tanks.
    addPart(Vector3.create(0, 1.5, 0.2), Vector3.create(0.3, 3.4, 0.3), HUMAN_STEEL, { cylinder: true, ...steel, rotation: Quaternion.fromEulerDegrees(0, 0, 62) })
    addPart(Vector3.create(0.2, 1.1, -1.4), Vector3.create(0.26, 3, 0.26), HUMAN_STEEL, { cylinder: true, ...steel, rotation: Quaternion.fromEulerDegrees(0, 30, 90) })
    // Roof vent fan on the tall silo.
    addPart(Vector3.create(-1.5, 4.35, 1.9), Vector3.create(2, 0.1, 0.34), HUMAN_STEEL, { ...steel, motion: { mode: 'spin', speed: 120 } })
    // Crate stack and a blinker.
    addPart(Vector3.create(2.1, 0.9, 1.7), Vector3.create(1.1, 0.9, 1.1), HUMAN_STEEL, steel)
    addPart(Vector3.create(2.3, 1.7, 1.5), Vector3.create(0.8, 0.7, 0.8), HUMAN_DARK)
    blinker(Vector3.create(1.6, 4.0, -1.3), 0.3)
    return
  }

  if (kind === 'barracks') {
    // War Hall: armored hangar with a blast door, floodlit entry, watch
    // towers and a sweeping roof scanner.
    addPart(Vector3.create(0, 0.25, 0), Vector3.create(6, 0.5, 6), HUMAN_DARK)
    addPart(Vector3.create(0, 2, 0), Vector3.create(5.2, 3.2, 4.6), HUMAN_HULL, steel)
    addPart(Vector3.create(0, 3.9, 0), Vector3.create(5.6, 1, 5), HUMAN_DARK)
    addPart(Vector3.create(0, 4.55, 0), Vector3.create(4.2, 0.4, 3.8), HUMAN_STEEL, steel)
    // Blast door: glow sheet, dark frame, hazard lintel, floodlights.
    addPart(Vector3.create(0, 1.75, 2.32), Vector3.create(2.6, 2.5, 0.12), HUMAN_GLOW, {
      emissive: HUMAN_GLOW,
      emissiveIntensity: 1.7,
      motion: { mode: 'pulse', speed: 1.8, amplitude: 0.04 }
    })
    addPart(Vector3.create(-1.55, 1.75, 2.34), Vector3.create(0.35, 2.5, 0.12), HUMAN_DARK)
    addPart(Vector3.create(1.55, 1.75, 2.34), Vector3.create(0.35, 2.5, 0.12), HUMAN_DARK)
    addPart(Vector3.create(0, 3.25, 2.34), Vector3.create(3.5, 0.3, 0.14), HAZARD_YELLOW)
    blinker(Vector3.create(-1.9, 3.6, 2.4), 0.26, HUMAN_GLOW, 0)
    blinker(Vector3.create(1.9, 3.6, 2.4), 0.26, HUMAN_GLOW, 1.5)
    // Watch towers with pulsing lamps.
    for (const x of [-2.3, 2.3]) {
      addPart(Vector3.create(x, 4.9, -1.5), Vector3.create(1, 2.6, 1), HUMAN_HULL, steel)
      addPart(Vector3.create(x, 6.3, -1.5), Vector3.create(1.2, 0.24, 1.2), HUMAN_DARK)
      blinker(Vector3.create(x, 6.65, -1.5), 0.4, HUMAN_GLOW, x > 0 ? 2.4 : 0.6)
    }
    // Roof scanner bar sweeping for hostiles.
    addPart(Vector3.create(0, 5.2, 0.8), Vector3.create(0.14, 0.9, 0.14), HUMAN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 5.7, 0.8), Vector3.create(1.7, 0.12, 0.3), HUMAN_STEEL, { ...steel, motion: { mode: 'spin', speed: 55 } })
    // Munition crates by the door.
    addPart(Vector3.create(2.4, 0.85, 1.4), Vector3.create(0.9, 0.7, 0.9), HUMAN_STEEL, steel)
    addPart(Vector3.create(-2.5, 0.8, 1.6), Vector3.create(0.8, 0.6, 0.8), HUMAN_DARK)
    return
  }

  if (kind === 'techLab') {
    // Starforge: research spire with counter-rotating gyro rings, a floating
    // reactor core inside a pylon cradle, and data conduits climbing the hull.
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(5.4, 0.6, 5.4), HUMAN_DARK)
    addPart(Vector3.create(0, 0.72, 0), Vector3.create(4.4, 0.35, 4.4), HUMAN_STEEL, steel)
    addPart(Vector3.create(0, 1.95, 0), Vector3.create(3.6, 2.6, 3.6), HUMAN_HULL, steel)
    addPart(Vector3.create(0, 3.55, 0), Vector3.create(2.6, 0.7, 2.6), HUMAN_DARK)
    addPart(Vector3.create(0, 4.65, 0), Vector3.create(1.8, 1.6, 1.8), HUMAN_HULL, { cylinder: true, ...steel })
    // Window bands and rising data conduits.
    strip(Vector3.create(0, 2.1, 1.85), Vector3.create(2.6, 0.4, 0.1), 1.8)
    strip(Vector3.create(0, 2.1, -1.85), Vector3.create(2.6, 0.4, 0.1), 1.8)
    strip(Vector3.create(1.4, 2.6, 1.82), Vector3.create(0.14, 1.4, 0.08), 1.6)
    strip(Vector3.create(-1.4, 2.6, -1.82), Vector3.create(0.14, 1.4, 0.08), 1.6)
    // Counter-rotating gyro rings.
    addPart(Vector3.create(0, 4.65, 0), Vector3.create(3.4, 0.18, 0.6), HUMAN_DARK, { motion: { mode: 'spin', speed: 70 } })
    addPart(Vector3.create(0, 5.15, 0), Vector3.create(2.6, 0.14, 0.45), HUMAN_STEEL, { ...steel, motion: { mode: 'spin', speed: -45 } })
    // Reactor core floating in a four-pylon cradle, orbited by spark motes.
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
      addPart(Vector3.create(Math.cos(angle) * 1.15, 6.3, Math.sin(angle) * 1.15), Vector3.create(0.22, 1.7, 0.22), HUMAN_DARK, {
        rotation: Quaternion.fromEulerDegrees(Math.sin(angle) * 14, 0, -Math.cos(angle) * 14)
      })
    }
    addPart(Vector3.create(0, 6.7, 0), Vector3.create(0.95, 0.95, 0.95), HUMAN_GLOW, {
      sphere: true,
      emissive: HUMAN_GLOW,
      emissiveIntensity: 2.8,
      motion: { mode: 'bob', speed: 1.6, amplitude: 0.35 }
    })
    for (let i = 0; i < 3; i++) {
      addPart(Vector3.create(0, 6.7, 0), Vector3.create(0.13, 0.13, 0.13), HUMAN_GLOW, {
        emissive: HUMAN_GLOW,
        emissiveIntensity: 3.4,
        motion: { mode: 'orbit', speed: 1.8, radius: 1.05, height: 0.3, phase: (i / 3) * Math.PI * 2 }
      })
    }
    // Support pylons.
    for (const x of [-2.15, 2.15]) {
      addPart(Vector3.create(x, 1.7, 0), Vector3.create(0.5, 3.1, 0.5), HUMAN_DARK)
      addPart(Vector3.create(x, 3.3, 0), Vector3.create(0.6, 0.2, 0.6), HAZARD_YELLOW)
    }
    return
  }

  if (kind === 'forge') {
    // Engineering Bay: furnace works - molten channels in the apron, a huge
    // drive gear, twin stacks coughing embers, and a loading crane.
    addPart(Vector3.create(0, 0.25, 0), Vector3.create(4.8, 0.5, 4.8), HUMAN_DARK)
    addPart(Vector3.create(0, 1.75, 0), Vector3.create(3.6, 2.5, 3.2), HUMAN_HULL, steel)
    addPart(Vector3.create(0, 3.2, 0), Vector3.create(3.9, 0.5, 3.5), HUMAN_DARK)
    // Furnace mouth and molten feed channels glowing in the apron.
    addPart(Vector3.create(0, 1.3, 1.66), Vector3.create(1.6, 1.2, 0.1), MOLTEN, {
      emissive: MOLTEN,
      emissiveIntensity: 2.4,
      motion: { mode: 'pulse', speed: 5, amplitude: 0.12 }
    })
    addPart(Vector3.create(0, 0.54, 2.05), Vector3.create(1.1, 0.08, 0.9), MOLTEN, {
      emissive: MOLTEN,
      emissiveIntensity: 2,
      motion: { mode: 'pulse', speed: 3.4, amplitude: 0.1, phase: 1 }
    })
    addPart(Vector3.create(1.6, 0.54, 1.2), Vector3.create(0.5, 0.08, 1.6), MOLTEN, {
      emissive: MOLTEN,
      emissiveIntensity: 1.8,
      motion: { mode: 'pulse', speed: 3.4, amplitude: 0.1, phase: 2.4 }
    })
    // Drive gear with counter-spinning spokes.
    addPart(Vector3.create(2.05, 1.9, 0), Vector3.create(0.3, 1.9, 1.9), HUMAN_DARK, {
      cylinder: true,
      rotation: Quaternion.fromEulerDegrees(0, 0, 90),
      motion: { mode: 'spin', speed: 50, axis: 'y' }
    })
    addPart(Vector3.create(2.2, 1.9, 0), Vector3.create(0.2, 2.4, 0.5), HUMAN_HULL, { ...steel, motion: { mode: 'spin', speed: 50, axis: 'z' } })
    addPart(Vector3.create(2.2, 1.9, 0), Vector3.create(0.2, 0.5, 2.4), HUMAN_STEEL, { ...steel, motion: { mode: 'spin', speed: 50, axis: 'z' } })
    // Twin stacks with rising embers.
    addPart(Vector3.create(-1.4, 4.0, -1), Vector3.create(0.5, 1.7, 0.5), HUMAN_DARK, { cylinder: true })
    addPart(Vector3.create(-0.5, 4.3, -1), Vector3.create(0.4, 2.3, 0.4), HUMAN_DARK, { cylinder: true })
    for (let i = 0; i < 4; i++) {
      addPart(Vector3.create(i % 2 === 0 ? -1.4 : -0.5, 5.1, -1), Vector3.create(0.14, 0.14, 0.14), MOLTEN, {
        emissive: MOLTEN,
        emissiveIntensity: 3.2,
        motion: { mode: 'ember', speed: 0.5, radius: 0.25, height: 1.7, phase: i / 4 }
      })
    }
    // Loading crane leaning over the works.
    addPart(Vector3.create(-1.9, 2.6, 1.2), Vector3.create(0.24, 3.4, 0.24), HUMAN_STEEL, { ...steel, rotation: Quaternion.fromEulerDegrees(0, 0, 18) })
    addPart(Vector3.create(-1.15, 4.2, 1.2), Vector3.create(1.9, 0.2, 0.2), HUMAN_STEEL, steel)
    addPart(Vector3.create(-0.35, 3.7, 1.2), Vector3.create(0.08, 0.9, 0.08), HUMAN_DARK)
    addPart(Vector3.create(-0.35, 3.2, 1.2), Vector3.create(0.24, 0.2, 0.24), HAZARD_YELLOW)
    return
  }

  if (kind === 'airForge') {
    // Skyharbor: flight-control tower beside a raised landing pad with hazard
    // trim, a spinning radar, pulsing landing lights and a drone on approach.
    addPart(Vector3.create(0, 0.25, 0), Vector3.create(5, 0.5, 5), HUMAN_DARK)
    // Control tower with a glass band and radar mast.
    addPart(Vector3.create(-1.5, 1.9, -1.2), Vector3.create(1.7, 3, 1.7), HUMAN_HULL, steel)
    strip(Vector3.create(-1.5, 2.9, -0.32), Vector3.create(1.5, 0.4, 0.1), 1.8)
    addPart(Vector3.create(-1.5, 3.6, -1.2), Vector3.create(2, 0.3, 2), HUMAN_DARK)
    addPart(Vector3.create(-1.5, 4.4, -1.2), Vector3.create(0.14, 1.4, 0.14), HUMAN_STEEL, steel)
    addPart(Vector3.create(-1.5, 5.1, -1.2), Vector3.create(1.5, 0.12, 0.3), HUMAN_STEEL, { ...steel, motion: { mode: 'spin', speed: 110 } })
    blinker(Vector3.create(-1.5, 5.35, -1.2), 0.26, WARN_RED)
    // Landing pad on four pylons, hazard-striped rim, glowing pad ring.
    for (const [px, pz] of [[0.4, 0.2], [2.4, 0.2], [0.4, 2.2], [2.4, 2.2]]) {
      addPart(Vector3.create(px, 1, pz), Vector3.create(0.4, 2, 0.4), HUMAN_DARK)
    }
    addPart(Vector3.create(1.4, 2.1, 1.2), Vector3.create(3, 0.25, 3), HUMAN_STEEL, steel)
    addPart(Vector3.create(1.4, 2.26, 1.2), Vector3.create(3.1, 0.08, 3.1), HAZARD_YELLOW)
    addPart(Vector3.create(1.4, 2.34, 1.2), Vector3.create(1.9, 0.06, 1.9), HUMAN_GLOW, {
      cylinder: true,
      emissive: HUMAN_GLOW,
      emissiveIntensity: 2,
      motion: { mode: 'pulse', speed: 2.6, amplitude: 0.1 }
    })
    // A maintenance drone hovering over the pad.
    addPart(Vector3.create(1.4, 3.6, 1.2), Vector3.create(0.8, 0.3, 0.6), HUMAN_HULL, {
      ...steel,
      motion: { mode: 'bob', speed: 1.8, amplitude: 0.45 }
    })
    blinker(Vector3.create(1.4, 3.95, 1.2), 0.18, HUMAN_GLOW, 0.9)
    return
  }

  if (kind === 'turret') {
    // Sentry Cannon: armored pedestal, skirt plates, sweeping twin-barrel
    // head with muzzle glows and a blinking target designator.
    addPart(Vector3.create(0, 0.25, 0), Vector3.create(3, 0.5, 3), HUMAN_DARK)
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
      addPart(Vector3.create(Math.cos(angle) * 1.15, 0.8, Math.sin(angle) * 1.15), Vector3.create(0.7, 0.8, 0.2), HUMAN_STEEL, {
        ...steel,
        rotation: Quaternion.fromEulerDegrees(-16, (-angle * 180) / Math.PI + 90, 0)
      })
    }
    addPart(Vector3.create(0, 1.5, 0), Vector3.create(1.2, 2.2, 1.2), HUMAN_HULL, { cylinder: true, ...steel })
    addPart(Vector3.create(0, 2.75, 0), Vector3.create(1.8, 0.9, 1.8), HUMAN_DARK)
    addPart(Vector3.create(0, 2.75, 0), Vector3.create(1.9, 0.2, 1.9), HAZARD_YELLOW, { cylinder: true })
    // Rotating head: armored block, twin barrels with glowing muzzles, ammo drum.
    addPart(Vector3.create(0, 3.5, 0), Vector3.create(1.5, 0.85, 2), HUMAN_HULL, { ...steel, motion: { mode: 'spin', speed: 25 } })
    addPart(Vector3.create(0, 3.6, 0), Vector3.create(0.18, 0.18, 3), HUMAN_DARK, { motion: { mode: 'spin', speed: 25 } })
    addPart(Vector3.create(0, 3.38, 0), Vector3.create(0.18, 0.18, 3), HUMAN_DARK, { motion: { mode: 'spin', speed: 25 } })
    addPart(Vector3.create(0, 4.05, 0), Vector3.create(0.8, 0.5, 0.8), HUMAN_STEEL, { cylinder: true, ...steel, motion: { mode: 'spin', speed: 25 } })
    blinker(Vector3.create(0, 4.5, 0), 0.32, WARN_RED)
    return
  }

  // Beacon (fireplace slot): tripod signal mast with a sweeping light bar.
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2
    addPart(Vector3.create(Math.cos(angle) * 0.7, 0.8, Math.sin(angle) * 0.7), Vector3.create(0.16, 1.7, 0.16), HUMAN_DARK, {
      rotation: Quaternion.fromEulerDegrees(Math.sin(angle) * 22, 0, -Math.cos(angle) * 22)
    })
  }
  addPart(Vector3.create(0, 1.7, 0), Vector3.create(0.2, 1.8, 0.2), HUMAN_HULL, { cylinder: true, ...steel })
  addPart(Vector3.create(0, 2.75, 0), Vector3.create(1.3, 0.1, 0.24), HUMAN_STEEL, { ...steel, motion: { mode: 'spin', speed: 90 } })
  blinker(Vector3.create(0, 2.95, 0), 0.5)
}

// ---------------------------------------------------------------------------
// Aliens: golden tiers that levitate apart, rune light, belts of orbiting
// crystal shards, floating diamonds.

function buildAlienBuilding(kind: BuildableKind, addPart: PartAdder): void {
  const gild = { metallic: 0.7, roughness: 0.3 }
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
  // A horizontal rune band that shimmers.
  const runeBand = (y: number, width: number, phase = 0) =>
    addPart(Vector3.create(0, y, 0), Vector3.create(width, 0.14, width), ALIEN_CRYSTAL, {
      cylinder: true,
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 1.6,
      motion: { mode: 'pulse', speed: 1.8, amplitude: 0.04, phase }
    })
  // A belt of shards circling a point.
  const shardBelt = (y: number, radius: number, count: number, speed: number, size = 0.14) => {
    for (let i = 0; i < count; i++) {
      addPart(Vector3.create(0, y, 0), Vector3.create(size, size * 2.6, size), ALIEN_CRYSTAL, {
        emissive: ALIEN_CRYSTAL,
        emissiveIntensity: 2.6,
        motion: { mode: 'orbit', speed, radius, height: 0.16, phase: (i / count) * Math.PI * 2 }
      })
    }
  }

  if (kind === 'temple') {
    // Grand Ziggurat: three golden tiers separated by rune light, the top
    // tier levitating free, crowned by the power crystal and a shard belt.
    addPart(Vector3.create(0, 0.4, 0), Vector3.create(8.4, 0.8, 8.4), ALIEN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 0.95, 0), Vector3.create(7.2, 0.35, 7.2), ALIEN_GOLD, { cylinder: true, ...gild })
    addPart(Vector3.create(0, 2.1, 0), Vector3.create(6.4, 2.2, 6.4), ALIEN_GOLD, gild)
    runeBand(3.35, 5.4)
    addPart(Vector3.create(0, 4.5, 0), Vector3.create(4.6, 2, 4.6), ALIEN_GOLD, gild)
    runeBand(5.65, 3.9, 1.2)
    // The floating crown tier.
    addPart(Vector3.create(0, 7.0, 0), Vector3.create(3, 1.8, 3), ALIEN_GOLD, {
      ...gild,
      motion: { mode: 'bob', speed: 1.1, amplitude: 0.22 }
    })
    crystalDiamond(0, 9.7, 0, 1.7)
    shardBelt(6.4, 3.6, 4, 0.8)
    // Corner obelisks with lit tips.
    for (const x of [-3.5, 3.5]) {
      for (const z of [-3.5, 3.5]) {
        addPart(Vector3.create(x, 1.9, z), Vector3.create(0.65, 2.8, 0.65), ALIEN_GOLD, { cone: true, ...gild })
        addPart(Vector3.create(x, 3.4, z), Vector3.create(0.2, 0.2, 0.2), ALIEN_CRYSTAL, {
          sphere: true,
          emissive: ALIEN_CRYSTAL,
          emissiveIntensity: 2.8,
          motion: { mode: 'pulse', speed: 2.6, amplitude: 0.2, phase: x + z }
        })
      }
    }
    return
  }

  if (kind === 'supplyHouse') {
    // Crystal Battery: a gold pylon feeding three small crystals that circle it.
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(4.8, 0.6, 4.8), ALIEN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 0.75, 0), Vector3.create(3.6, 0.3, 3.6), ALIEN_GOLD, { cylinder: true, ...gild })
    addPart(Vector3.create(0, 1.9, 0), Vector3.create(1.9, 2.6, 1.9), ALIEN_GOLD, gild)
    runeBand(2.1, 2.2)
    addPart(Vector3.create(0, 3.45, 0), Vector3.create(1.3, 0.7, 1.3), ALIEN_DARK)
    crystalDiamond(0, 4.7, 0, 1.1)
    shardBelt(2.4, 2.1, 3, 1.2, 0.12)
    return
  }

  if (kind === 'barracks') {
    // Warp Gate: horned pillars around a shimmering portal, sparks circling
    // the crown, kneeling side pylons.
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(6, 0.6, 6), ALIEN_DARK)
    addPart(Vector3.create(0, 0.72, 0), Vector3.create(4.8, 0.3, 3), ALIEN_GOLD, gild)
    for (const x of [-2, 2]) {
      addPart(Vector3.create(x, 2.9, 0), Vector3.create(1.2, 4.8, 1.2), ALIEN_GOLD, gild)
      addPart(Vector3.create(x, 5.35, 0), Vector3.create(1.5, 0.4, 1.5), ALIEN_DARK)
      // Gate horns curving outward.
      addPart(Vector3.create(x * 1.25, 6.1, 0), Vector3.create(0.35, 1.4, 0.35), ALIEN_GOLD, {
        cone: true,
        ...gild,
        rotation: Quaternion.fromEulerDegrees(0, 0, x > 0 ? -24 : 24)
      })
      // Kneeling side pylons with crystal tips.
      addPart(Vector3.create(x * 1.4, 1.3, 1.9), Vector3.create(0.5, 1.7, 0.5), ALIEN_GOLD, { cone: true, ...gild, rotation: Quaternion.fromEulerDegrees(14, 0, x > 0 ? -10 : 10) })
      addPart(Vector3.create(x * 1.45, 2.25, 2.1), Vector3.create(0.18, 0.18, 0.18), ALIEN_CRYSTAL, { sphere: true, emissive: ALIEN_CRYSTAL, emissiveIntensity: 2.6 })
    }
    addPart(Vector3.create(0, 5.9, 0), Vector3.create(5.6, 0.9, 1.4), ALIEN_GOLD, gild)
    // The portal sheet, shimmering, with sparks circling its crown.
    addPart(Vector3.create(0, 3, 0), Vector3.create(2.9, 4, 0.18), ALIEN_CRYSTAL, {
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2.2,
      motion: { mode: 'pulse', speed: 2.4, amplitude: 0.06 }
    })
    shardBelt(5.4, 1.7, 3, 1.9, 0.11)
    return
  }

  if (kind === 'techLab') {
    // Sanctum: the grand crystal in a counter-rotating claw crown, ringed by
    // mini-crystal pillars and an orbit of motes.
    addPart(Vector3.create(0, 0.35, 0), Vector3.create(6.2, 0.7, 6.2), ALIEN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 0.85, 0), Vector3.create(5.2, 0.3, 5.2), ALIEN_GOLD, { cylinder: true, ...gild })
    addPart(Vector3.create(0, 1.7, 0), Vector3.create(4.4, 1.6, 4.4), ALIEN_GOLD, { cylinder: true, ...gild })
    runeBand(2.55, 3.5)
    addPart(Vector3.create(0, 2.7, 0), Vector3.create(3.2, 0.4, 3.2), ALIEN_DARK, { cylinder: true })
    // Counter-rotating claw crown.
    addPart(Vector3.create(0, 4.2, 0), Vector3.create(3.4, 0.3, 0.7), ALIEN_GOLD, { ...gild, motion: { mode: 'spin', speed: 26 } })
    addPart(Vector3.create(0, 4.8, 0), Vector3.create(0.7, 0.3, 3.4), ALIEN_GOLD, { ...gild, motion: { mode: 'spin', speed: -26 } })
    crystalDiamond(0, 5.9, 0, 1.5)
    shardBelt(5.9, 2.4, 3, 1.5, 0.12)
    // Ring of pillars, each holding a bobbing mini crystal.
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2
      const px = Math.cos(angle) * 2.5
      const pz = Math.sin(angle) * 2.5
      addPart(Vector3.create(px, 2, pz), Vector3.create(0.45, 2.6, 0.45), ALIEN_DARK)
      addPart(Vector3.create(px, 3.6, pz), Vector3.create(0.24, 0.44, 0.24), ALIEN_CRYSTAL, {
        cone: true,
        emissive: ALIEN_CRYSTAL,
        emissiveIntensity: 2.2,
        motion: { mode: 'bob', speed: 1.6, amplitude: 0.12, phase: i * 1.4 }
      })
    }
    return
  }

  if (kind === 'forge') {
    // Ascension Spire: the needle with twin counter-spinning halos, a blazing
    // tip gem and motes streaming up its length.
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(4.6, 0.6, 4.6), ALIEN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 0.75, 0), Vector3.create(3.4, 0.3, 3.4), ALIEN_GOLD, { cylinder: true, ...gild })
    addPart(Vector3.create(0, 1.35, 0), Vector3.create(2.4, 1.4, 2.4), ALIEN_GOLD, gild)
    runeBand(1.6, 2.7)
    addPart(Vector3.create(0, 3.35, 0), Vector3.create(1, 3.4, 1), ALIEN_GOLD, { cone: true, ...gild })
    // Twin halos, counter-spinning at different heights.
    addPart(Vector3.create(0, 3.4, 0), Vector3.create(2.6, 0.14, 0.4), ALIEN_CRYSTAL, { emissive: ALIEN_CRYSTAL, emissiveIntensity: 1.6, motion: { mode: 'spin', speed: 60 } })
    addPart(Vector3.create(0, 4.3, 0), Vector3.create(1.8, 0.12, 0.3), ALIEN_CRYSTAL, { emissive: ALIEN_CRYSTAL, emissiveIntensity: 1.8, motion: { mode: 'spin', speed: -85 } })
    // Blazing gem and rising motes.
    addPart(Vector3.create(0, 5.45, 0), Vector3.create(0.55, 0.55, 0.55), ALIEN_CRYSTAL, {
      sphere: true,
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2.8,
      motion: { mode: 'pulse', speed: 3.2, amplitude: 0.22 }
    })
    for (let i = 0; i < 3; i++) {
      addPart(Vector3.create(0, 1.6, 0), Vector3.create(0.11, 0.11, 0.11), ALIEN_CRYSTAL, {
        sphere: true,
        emissive: ALIEN_CRYSTAL,
        emissiveIntensity: 3,
        motion: { mode: 'ember', speed: 0.4, radius: 0.5, height: 3.4, phase: i / 3 }
      })
    }
    return
  }

  if (kind === 'airForge') {
    // Zenith Spire: a wind-carved needle crowned with tilted flight halos,
    // a soaring diamond and a wide belt of gliding shards.
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(4.4, 0.6, 4.4), ALIEN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 0.75, 0), Vector3.create(3.2, 0.3, 3.2), ALIEN_GOLD, { cylinder: true, ...gild })
    addPart(Vector3.create(0, 1.5, 0), Vector3.create(2, 1.6, 2), ALIEN_GOLD, gild)
    runeBand(1.9, 2.3)
    addPart(Vector3.create(0, 3.6, 0), Vector3.create(0.85, 3.6, 0.85), ALIEN_GOLD, { cone: true, ...gild })
    // Tilted flight halos, like banked contrails around the needle.
    addPart(Vector3.create(0, 4.2, 0), Vector3.create(3, 0.12, 0.4), ALIEN_CRYSTAL, {
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 1.7,
      rotation: Quaternion.fromEulerDegrees(0, 0, 14),
      motion: { mode: 'spin', speed: 75 }
    })
    addPart(Vector3.create(0, 5, 0), Vector3.create(2.2, 0.12, 0.32), ALIEN_CRYSTAL, {
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 1.9,
      rotation: Quaternion.fromEulerDegrees(12, 0, 0),
      motion: { mode: 'spin', speed: -95 }
    })
    // The soaring diamond and a wide glide belt.
    crystalDiamond(0, 6.2, 0, 0.8)
    shardBelt(5.6, 1.9, 4, 2.2, 0.12)
    return
  }

  if (kind === 'turret') {
    // Arc Spire: a charged needle, whipping halo, wrathful crystal and a
    // crackle of orbiting sparks.
    addPart(Vector3.create(0, 0.3, 0), Vector3.create(3.2, 0.6, 3.2), ALIEN_DARK, { cylinder: true })
    addPart(Vector3.create(0, 0.72, 0), Vector3.create(2.4, 0.3, 2.4), ALIEN_GOLD, { cylinder: true, ...gild })
    addPart(Vector3.create(0, 2.0, 0), Vector3.create(1, 2.8, 1), ALIEN_GOLD, { cone: true, ...gild })
    addPart(Vector3.create(0, 2.8, 0), Vector3.create(2.4, 0.14, 0.4), ALIEN_CRYSTAL, {
      emissive: ALIEN_CRYSTAL,
      emissiveIntensity: 2,
      motion: { mode: 'spin', speed: 140 }
    })
    crystalDiamond(0, 4.2, 0, 0.9)
    shardBelt(4.2, 1.3, 3, 2.6, 0.1)
    return
  }

  // Obelisk (fireplace slot): a golden spike, crystal tip and one circling mote.
  addPart(Vector3.create(0, 0.2, 0), Vector3.create(1.8, 0.4, 1.8), ALIEN_DARK, { cylinder: true })
  addPart(Vector3.create(0, 1.5, 0), Vector3.create(0.8, 2.4, 0.8), ALIEN_GOLD, { cone: true, ...gild })
  crystalDiamond(0, 3, 0, 0.6)
  shardBelt(2.6, 0.9, 2, 2, 0.08)
}

// ---------------------------------------------------------------------------
// Bio Swarm: breathing flesh mounds ringed by creep, bone teeth, swaying
// tendrils, glowing sacs and drifting spores.

const BIO_BONE_COLOR = Color4.create(0.75, 0.68, 0.55, 1)
const BIO_CREEP = Color4.create(0.24, 0.13, 0.13, 1)

function buildBioBuilding(kind: BuildableKind, addPart: PartAdder): void {
  // Sacs breathe - the bio signature moving part.
  const sac = (x: number, y: number, z: number, size: number, phase = 0) => {
    addPart(Vector3.create(x, y, z), Vector3.create(size, size, size), BIO_SAC, {
      sphere: true,
      emissive: BIO_SAC,
      emissiveIntensity: 1.4,
      metallic: 0,
      roughness: 0.6,
      motion: { mode: 'pulse', speed: 2.2, amplitude: 0.1, phase }
    })
  }
  const spike = (x: number, y: number, z: number, height: number, tiltX: number, tiltZ: number) => {
    addPart(Vector3.create(x, y, z), Vector3.create(height * 0.28, height, height * 0.28), BIO_CARAPACE, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(tiltX, 0, tiltZ),
      roughness: 0.5
    })
  }
  // Bone teeth ringing an orifice, leaning inward.
  const teethRing = (y: number, radius: number, count: number, size: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      addPart(
        Vector3.create(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
        Vector3.create(size * 0.35, size, size * 0.35),
        BIO_BONE_COLOR,
        { cone: true, roughness: 0.5, rotation: Quaternion.fromEulerDegrees(Math.sin(angle) * 24, 0, -Math.cos(angle) * 24) }
      )
    }
  }
  // Flat creep blobs spreading from the base.
  const creepSkirt = (radius: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + i * 0.7
      const r = radius + (i % 2) * 0.5
      addPart(
        Vector3.create(Math.cos(angle) * r, 0.06, Math.sin(angle) * r),
        Vector3.create(1.6 + (i % 3) * 0.5, 0.12, 1.3 + ((i + 1) % 3) * 0.5),
        BIO_CREEP,
        { sphere: true, roughness: 1 }
      )
    }
  }
  // A swaying tendril: a thin cone that bobs at the tip.
  const tendril = (x: number, y: number, z: number, height: number, tiltX: number, tiltZ: number, phase = 0) => {
    addPart(Vector3.create(x, y, z), Vector3.create(height * 0.14, height, height * 0.14), BIO_FLESH, {
      cone: true,
      roughness: 0.9,
      rotation: Quaternion.fromEulerDegrees(tiltX, 0, tiltZ),
      motion: { mode: 'bob', speed: 1.3, amplitude: 0.14, phase }
    })
  }
  // Glowing spores drifting up.
  const spores = (x: number, y: number, z: number, count: number, height: number) => {
    for (let i = 0; i < count; i++) {
      addPart(Vector3.create(x, y, z), Vector3.create(0.12, 0.12, 0.12), BIO_ACID, {
        sphere: true,
        emissive: BIO_ACID,
        emissiveIntensity: 2.6,
        motion: { mode: 'ember', speed: 0.3, radius: 0.5, height, phase: i / count }
      })
    }
  }

  if (kind === 'temple') {
    // Great Hive: a breathing mound city - orifice ringed with bone teeth,
    // swaying tendrils, vein glow, spores drifting from the crown.
    creepSkirt(4.4, 6)
    addPart(Vector3.create(0, 2.4, 0), Vector3.create(8, 5.6, 8), BIO_FLESH, {
      sphere: true,
      roughness: 0.85,
      motion: { mode: 'pulse', speed: 1.2, amplitude: 0.02 }
    })
    addPart(Vector3.create(2.9, 1.1, 2.4), Vector3.create(3.2, 2.6, 3.2), BIO_FLESH, { sphere: true, roughness: 0.85 })
    addPart(Vector3.create(-2.7, 1, -2.5), Vector3.create(2.8, 2.2, 2.8), BIO_FLESH, { sphere: true, roughness: 0.85 })
    // Acid veins crawling up the flanks.
    addPart(Vector3.create(1.9, 2.6, 3.1), Vector3.create(0.16, 2.6, 0.1), BIO_ACID, { emissive: BIO_ACID, emissiveIntensity: 1.6, rotation: Quaternion.fromEulerDegrees(18, 0, -22) })
    addPart(Vector3.create(-2.6, 2.8, 2.2), Vector3.create(0.14, 2.2, 0.1), BIO_ACID, { emissive: BIO_ACID, emissiveIntensity: 1.6, rotation: Quaternion.fromEulerDegrees(14, 0, 26) })
    // Crown orifice: carapace lip, bone teeth, breathing glow, spore plume.
    addPart(Vector3.create(0, 5.2, 0), Vector3.create(2.4, 1.2, 2.4), BIO_CARAPACE, { cylinder: true })
    teethRing(5.9, 1.15, 6, 0.75)
    addPart(Vector3.create(0, 5.6, 0), Vector3.create(1.7, 0.5, 1.7), BIO_ACID, {
      cylinder: true,
      emissive: BIO_ACID,
      emissiveIntensity: 2,
      motion: { mode: 'pulse', speed: 1.8, amplitude: 0.12 }
    })
    spores(0, 5.9, 0, 4, 2.6)
    // Great spikes and swaying tendrils.
    spike(3.1, 4, -1.6, 3.4, 12, -24)
    spike(-3, 4.2, 1.4, 3.8, -10, 22)
    spike(1.6, 5.6, 2.7, 3, 20, 10)
    tendril(3.6, 2.6, 1.2, 2.6, 10, -32, 0)
    tendril(-3.4, 2.8, -1.6, 2.9, -12, 30, 1.7)
    tendril(-1.8, 4.6, 2.8, 2.4, 26, 14, 3.1)
    // Egg cluster nestled by the entrance.
    sac(2.3, 2.6, -2.9, 1.2, 0)
    sac(-3.1, 2.2, 1.9, 1, 1.3)
    sac(-1.4, 3.6, -3, 0.9, 2.6)
    addPart(Vector3.create(3.4, 0.55, 0.6), Vector3.create(0.8, 0.95, 0.8), Color4.create(0.72, 0.58, 0.5, 1), { sphere: true, roughness: 0.7, motion: { mode: 'pulse', speed: 1.9, amplitude: 0.05, phase: 0.8 } })
    addPart(Vector3.create(4, 0.45, 1.4), Vector3.create(0.6, 0.75, 0.6), Color4.create(0.72, 0.58, 0.5, 1), { sphere: true, roughness: 0.7, motion: { mode: 'pulse', speed: 1.9, amplitude: 0.05, phase: 2 } })
    return
  }

  if (kind === 'supplyHouse') {
    // Storage Sac: a swollen larder mound crowned by the mother-sac, ringed
    // with creep and drip tendrils.
    creepSkirt(2.7, 4)
    addPart(Vector3.create(0, 1.3, 0), Vector3.create(4.4, 3, 4.4), BIO_FLESH, {
      sphere: true,
      roughness: 0.85,
      motion: { mode: 'pulse', speed: 1.5, amplitude: 0.03 }
    })
    addPart(Vector3.create(1.5, 0.9, 1.5), Vector3.create(2.2, 1.8, 2.2), BIO_FLESH, { sphere: true, roughness: 0.85 })
    addPart(Vector3.create(-1.3, 0.7, -1.6), Vector3.create(1.7, 1.4, 1.7), BIO_FLESH, { sphere: true, roughness: 0.85 })
    sac(0, 3.2, 0, 1.5, 0)
    sac(-1.7, 1.6, 1.2, 0.9, 1.5)
    sac(1.9, 2.1, -1.2, 0.8, 2.8)
    addPart(Vector3.create(0.4, 2.5, 1.7), Vector3.create(0.14, 1.6, 0.09), BIO_ACID, { emissive: BIO_ACID, emissiveIntensity: 1.5, rotation: Quaternion.fromEulerDegrees(24, 0, -12) })
    spike(-1.4, 2.2, -1.5, 2.4, -14, -16)
    tendril(1.2, 3.3, 0.8, 1.9, 18, -20, 0.9)
    spores(0, 3.9, 0, 2, 1.6)
    return
  }

  if (kind === 'barracks') {
    // Spawning Pool: a crater of churning acid ringed by teeth, birth
    // bubbles rising, thorn palisade around the rim.
    creepSkirt(3.6, 5)
    addPart(Vector3.create(0, 0.8, 0), Vector3.create(5.6, 2, 5.6), BIO_FLESH, {
      sphere: true,
      roughness: 0.85,
      motion: { mode: 'pulse', speed: 1.4, amplitude: 0.025 }
    })
    addPart(Vector3.create(0, 1.55, 0), Vector3.create(3.4, 0.5, 3.4), BIO_CARAPACE, { cylinder: true })
    teethRing(2.1, 1.62, 7, 0.6)
    addPart(Vector3.create(0, 1.85, 0), Vector3.create(2.6, 0.3, 2.6), BIO_ACID, {
      cylinder: true,
      emissive: BIO_ACID,
      emissiveIntensity: 2.4,
      motion: { mode: 'pulse', speed: 2.6, amplitude: 0.1 }
    })
    // Birth bubbles breaking the surface.
    for (let i = 0; i < 3; i++) {
      addPart(Vector3.create(-0.7 + i * 0.7, 1.95, 0.5 - i * 0.6), Vector3.create(0.3, 0.3, 0.3), BIO_ACID, {
        sphere: true,
        emissive: BIO_ACID,
        emissiveIntensity: 2,
        motion: { mode: 'bob', speed: 2.2 + i * 0.6, amplitude: 0.16, phase: i * 2.1 }
      })
    }
    spike(2.4, 2, 1.3, 3, 16, -18)
    spike(-2.3, 2.1, -1.2, 3.2, -14, 20)
    spike(-1.2, 2, 2.3, 2.6, 18, 12)
    spike(1.4, 1.9, -2.4, 2.8, -20, -10)
    tendril(2.7, 1.6, -0.6, 2.2, -8, -30, 1.2)
    sac(2.6, 1, -1.8, 1, 0.6)
    return
  }

  if (kind === 'techLab') {
    // Grand Nest: the great egg throbbing in a bone cradle, watched by
    // tendrils, spores drifting from its crown.
    creepSkirt(3.8, 5)
    addPart(Vector3.create(0, 1.4, 0), Vector3.create(5.8, 3.2, 5.8), BIO_FLESH, {
      sphere: true,
      roughness: 0.85,
      motion: { mode: 'pulse', speed: 1.3, amplitude: 0.02 }
    })
    addPart(Vector3.create(2.2, 0.9, -1.9), Vector3.create(2.4, 2, 2.4), BIO_FLESH, { sphere: true, roughness: 0.85 })
    // The great egg with a glowing seam.
    addPart(Vector3.create(0, 4.2, 0), Vector3.create(2.6, 3.2, 2.6), Color4.create(0.75, 0.55, 0.45, 1), {
      sphere: true,
      emissive: BIO_SAC,
      emissiveIntensity: 0.7,
      roughness: 0.6,
      motion: { mode: 'pulse', speed: 1.6, amplitude: 0.07 }
    })
    addPart(Vector3.create(0, 4.4, 1.16), Vector3.create(0.18, 1.7, 0.12), BIO_SAC, {
      emissive: BIO_SAC,
      emissiveIntensity: 2.2,
      motion: { mode: 'pulse', speed: 1.6, amplitude: 0.12, phase: 1 }
    })
    // Bone cradle fingers around the egg.
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + 0.4
      addPart(
        Vector3.create(Math.cos(angle) * 1.7, 4, Math.sin(angle) * 1.7),
        Vector3.create(0.3, 2.8, 0.3),
        BIO_BONE_COLOR,
        { cone: true, rotation: Quaternion.fromEulerDegrees(Math.sin(angle) * -18, 0, Math.cos(angle) * 18), roughness: 0.5 }
      )
    }
    spores(0, 5.6, 0, 3, 2)
    spike(2.6, 3, 1.6, 3.4, 18, -16)
    spike(-2.5, 3.1, -1.4, 3.6, -14, 18)
    tendril(-2.9, 2.4, 0.6, 2.5, -6, 34, 0.5)
    tendril(1.4, 3.4, 2.5, 2.1, 24, -12, 2.2)
    sac(-2.2, 1.8, 2, 1.1, 0.4)
    sac(2.8, 1.5, 0.4, 0.9, 1.9)
    return
  }

  if (kind === 'forge') {
    // Evolution Chamber: a chrysalis in a full rib cage, acid veins feeding
    // it, spores leaking from the seams.
    creepSkirt(3, 4)
    addPart(Vector3.create(0, 0.9, 0), Vector3.create(4.6, 2.2, 4.6), BIO_FLESH, {
      sphere: true,
      roughness: 0.85,
      motion: { mode: 'pulse', speed: 1.5, amplitude: 0.03 }
    })
    // Full rib cage: eight bones arcing over the pod.
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      addPart(
        Vector3.create(Math.cos(angle) * 1.55, 2.6, Math.sin(angle) * 1.55),
        Vector3.create(0.24, 2.6, 0.24),
        BIO_BONE_COLOR,
        { cone: true, rotation: Quaternion.fromEulerDegrees(Math.sin(angle) * 24, 0, -Math.cos(angle) * 24), roughness: 0.5 }
      )
    }
    // The chrysalis, glowing and throbbing, fed by a vein.
    addPart(Vector3.create(0, 3, 0), Vector3.create(1.6, 2.2, 1.6), BIO_ACID, {
      sphere: true,
      emissive: BIO_ACID,
      emissiveIntensity: 1.8,
      roughness: 0.6,
      motion: { mode: 'pulse', speed: 2.8, amplitude: 0.12 }
    })
    addPart(Vector3.create(0.9, 1.7, 1.1), Vector3.create(0.14, 1.9, 0.1), BIO_ACID, {
      emissive: BIO_ACID,
      emissiveIntensity: 1.6,
      rotation: Quaternion.fromEulerDegrees(28, 0, -30)
    })
    spores(0, 4.2, 0, 3, 1.8)
    tendril(-1.9, 1.6, -1.1, 2.1, -12, 26, 1.1)
    sac(1.9, 1.2, 1.4, 0.9, 0.7)
    return
  }

  if (kind === 'airForge') {
    // Wind Roost: a tall perch stalk with membrane wings that flex in the
    // wind, hatching sacs, and spores streaming off the crown.
    creepSkirt(2.6, 4)
    addPart(Vector3.create(0, 0.8, 0), Vector3.create(3.6, 1.9, 3.6), BIO_FLESH, {
      sphere: true,
      roughness: 0.85,
      motion: { mode: 'pulse', speed: 1.6, amplitude: 0.03 }
    })
    // The perch stalk, leaning slightly into the wind.
    addPart(Vector3.create(0, 2.9, 0), Vector3.create(1.1, 3.4, 1.1), BIO_FLESH, {
      cone: true,
      roughness: 0.85,
      rotation: Quaternion.fromEulerDegrees(0, 0, 6)
    })
    teethRing(1.7, 1.5, 6, 0.7)
    // Membrane wings: thin carapace vanes that sway like sails.
    for (const side of [-1, 1]) {
      addPart(Vector3.create(side * 1.15, 3.9, 0), Vector3.create(1.9, 1.5, 0.08), BIO_CARAPACE, {
        roughness: 0.55,
        rotation: Quaternion.fromEulerDegrees(0, side * 18, side * 26),
        motion: { mode: 'pulse', speed: 1.4, amplitude: 0.08, phase: side > 0 ? 0 : 1.5 }
      })
    }
    // Hatching sacs clinging to the stalk and the glowing crown.
    sac(0.85, 2.4, 0.6, 0.8, 0.4)
    sac(-0.8, 1.9, -0.7, 0.7, 1.2)
    addPart(Vector3.create(0, 4.9, 0), Vector3.create(1, 1, 1), BIO_ACID, {
      sphere: true,
      emissive: BIO_ACID,
      emissiveIntensity: 2,
      roughness: 0.6,
      motion: { mode: 'pulse', speed: 2.6, amplitude: 0.12 }
    })
    spores(0, 5.3, 0, 3, 1.9)
    tendril(1.6, 1.4, -1.2, 1.9, -14, -22, 0.6)
    return
  }

  if (kind === 'turret') {
    // Thorn Mound: a muscular acid-spitter - thorn crown, launcher sac,
    // warning spores hissing out.
    creepSkirt(2.1, 4)
    addPart(Vector3.create(0, 1, 0), Vector3.create(3, 2.4, 3), BIO_FLESH, {
      sphere: true,
      roughness: 0.85,
      motion: { mode: 'pulse', speed: 1.7, amplitude: 0.03 }
    })
    addPart(Vector3.create(0, 2.4, 0), Vector3.create(1.4, 1.6, 1.4), BIO_CARAPACE, { cylinder: true })
    teethRing(3.2, 0.75, 5, 0.5)
    // Crown of thorns aimed outward.
    spike(0.9, 2.9, 0.7, 2.6, 24, -26)
    spike(-0.9, 2.9, -0.6, 2.6, -22, 24)
    spike(-0.7, 2.9, 0.9, 2.4, 24, 20)
    spike(0.7, 2.9, -0.9, 2.4, -24, -18)
    // The launcher sac, glowing and throbbing.
    addPart(Vector3.create(0, 3.6, 0), Vector3.create(1.2, 1.2, 1.2), BIO_ACID, {
      sphere: true,
      emissive: BIO_ACID,
      emissiveIntensity: 2.4,
      roughness: 0.6,
      motion: { mode: 'pulse', speed: 3.4, amplitude: 0.16 }
    })
    spores(0, 4.1, 0, 2, 1.4)
    return
  }

  // Spore Mound (fireplace slot): a small mound with one bright sac and a
  // wisp of spores.
  creepSkirt(1.5, 3)
  addPart(Vector3.create(0, 0.7, 0), Vector3.create(2.2, 1.6, 2.2), BIO_FLESH, {
    sphere: true,
    roughness: 0.85,
    motion: { mode: 'pulse', speed: 1.8, amplitude: 0.04 }
  })
  spike(0.6, 1.4, 0.5, 1.8, 14, -12)
  tendril(-0.6, 1.3, -0.4, 1.5, -14, 18, 0.8)
  sac(0, 1.9, 0, 1)
  spores(0, 2.3, 0, 2, 1.3)
}
