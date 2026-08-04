import { Entity, Material, MeshRenderer, ParticleSystem, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { ResourceKind } from './types'

// Procedural StarCraft-style resource nodes: faceted blue mineral crystal fields
// and rocky gas geysers with a glowing green pool and a rising smoke plume.
// Idle nodes are static for performance; only gather pulses and depletion animate.

interface ResourceRig {
  bodyRoot: Entity
  parts: Entity[]
  pulseTimer: number
  dyingTimer: number
  depleted: boolean
  // Gas geysers: glowing pool that collapses on depletion, and the smoke emitter.
  pool?: Entity
  poolBaseScale?: Vector3
  smoke?: Entity
  smokeActive: boolean
}

const rigs = new Map<Entity, ResourceRig>()

const PULSE_DURATION = 0.45
const DIE_DURATION = 1.4
const PARTICLE_BLEND_ALPHA = 0

const ROCK_BROWN = Color4.create(0.32, 0.3, 0.32, 1)
const ROCK_DARK = Color4.create(0.24, 0.23, 0.26, 1)
const CRATER_DARK = Color4.create(0.1, 0.11, 0.1, 1)
const MINERAL_BLUE = Color4.create(0.4, 0.62, 0.95, 1)
const MINERAL_ICE = Color4.create(0.62, 0.8, 1, 1)
const MINERAL_GLOW = Color4.create(0.45, 0.7, 1, 1)
const GAS_GREEN = Color4.create(0.3, 0.85, 0.4, 1)
const GAS_GLOW = Color4.create(0.35, 0.95, 0.45, 1)

export function buildResourceModel(root: Entity, kind: ResourceKind): void {
  const bodyRoot = engine.addEntity()
  Transform.create(bodyRoot, { parent: root })

  const rig: ResourceRig = { bodyRoot, parts: [bodyRoot], pulseTimer: 0, dyingTimer: -1, depleted: false, smokeActive: false }

  if (kind === 'minerals') buildMineralField(rig)
  else buildGasGeyser(rig)

  rigs.set(root, rig)
}

function addPart(
  rig: ResourceRig,
  position: Vector3,
  scale: Vector3,
  color: Color4,
  options: { emissive?: Color4; emissiveIntensity?: number; cylinder?: boolean; rotation?: Quaternion; metallic?: number; roughness?: number } = {}
): Entity {
  const part = engine.addEntity()
  Transform.create(part, {
    parent: rig.bodyRoot,
    position,
    scale,
    rotation: options.rotation ?? Quaternion.Identity()
  })
  if (options.cylinder) MeshRenderer.setCylinder(part)
  else MeshRenderer.setBox(part)
  Material.setPbrMaterial(part, {
    albedoColor: color,
    emissiveColor: options.emissive ?? Color4.Black(),
    emissiveIntensity: options.emissiveIntensity ?? 0,
    metallic: options.metallic ?? 0.2,
    roughness: options.roughness ?? 0.8,
    castShadows: false
  })
  rig.parts.push(part)
  return part
}

/** A shard is a box rotated 45 degrees on its long axis so the corners read as gem facets. */
function addCrystalShard(rig: ResourceRig, position: Vector3, width: number, height: number, yaw: number, lean: number, bright: boolean): void {
  addPart(rig, position, Vector3.create(width, height, width), bright ? MINERAL_ICE : MINERAL_BLUE, {
    emissive: MINERAL_GLOW,
    emissiveIntensity: bright ? 1.2 : 0.85,
    rotation: Quaternion.multiply(Quaternion.fromEulerDegrees(0, yaw, 0), Quaternion.fromEulerDegrees(lean, 45, 0)),
    metallic: 0.1,
    roughness: 0.25
  })
}

function buildMineralField(rig: ResourceRig): void {
  // Regolith mound the crystals grow out of.
  addPart(rig, Vector3.create(0, 0.1, 0), Vector3.create(1.9, 0.2, 1.9), ROCK_DARK, { cylinder: true })
  addPart(rig, Vector3.create(0.55, 0.16, -0.45), Vector3.create(0.4, 0.24, 0.36), ROCK_BROWN, {
    rotation: Quaternion.fromEulerDegrees(6, 40, -8)
  })
  addPart(rig, Vector3.create(-0.6, 0.14, 0.4), Vector3.create(0.34, 0.2, 0.3), ROCK_BROWN, {
    rotation: Quaternion.fromEulerDegrees(-5, 150, 7)
  })

  // Soft ambient glow between the shards.
  addPart(rig, Vector3.create(0, 0.22, 0), Vector3.create(1.1, 0.04, 1.1), MINERAL_BLUE, {
    cylinder: true,
    emissive: MINERAL_GLOW,
    emissiveIntensity: 0.7
  })

  // The crystal cluster: one dominant shard ringed by smaller ones.
  addCrystalShard(rig, Vector3.create(0, 0.75, 0), 0.4, 1.15, 15, 4, true)
  addCrystalShard(rig, Vector3.create(0.45, 0.5, 0.2), 0.28, 0.8, 70, 14, false)
  addCrystalShard(rig, Vector3.create(-0.42, 0.45, -0.15), 0.26, 0.7, 200, -12, false)
  addCrystalShard(rig, Vector3.create(0.1, 0.35, -0.5), 0.2, 0.55, 130, -10, true)
  addCrystalShard(rig, Vector3.create(-0.2, 0.3, 0.48), 0.18, 0.45, 300, 12, false)
  addCrystalShard(rig, Vector3.create(0.55, 0.25, -0.35), 0.14, 0.35, 250, 16, true)
}

function buildGasGeyser(rig: ResourceRig): void {
  // Layered rock mound.
  addPart(rig, Vector3.create(0, 0.2, 0), Vector3.create(2.5, 0.4, 2.5), ROCK_BROWN, { cylinder: true })
  addPart(rig, Vector3.create(0, 0.52, 0), Vector3.create(1.9, 0.3, 1.9), ROCK_DARK, { cylinder: true })
  addPart(rig, Vector3.create(0, 0.76, 0), Vector3.create(1.35, 0.22, 1.35), ROCK_BROWN, { cylinder: true })

  // Crater mouth with the glowing gas pool inside.
  addPart(rig, Vector3.create(0, 0.88, 0), Vector3.create(1.05, 0.06, 1.05), CRATER_DARK, { cylinder: true })
  const pool = addPart(rig, Vector3.create(0, 0.93, 0), Vector3.create(0.85, 0.05, 0.85), GAS_GREEN, {
    cylinder: true,
    emissive: GAS_GLOW,
    emissiveIntensity: 1.6
  })
  rig.pool = pool
  rig.poolBaseScale = Vector3.create(0.85, 0.05, 0.85)

  // Rim rocks and a few green mineral crusts around the mouth.
  addPart(rig, Vector3.create(0.95, 0.45, 0.4), Vector3.create(0.42, 0.5, 0.38), ROCK_DARK, {
    rotation: Quaternion.fromEulerDegrees(8, 30, -10)
  })
  addPart(rig, Vector3.create(-0.9, 0.4, -0.5), Vector3.create(0.38, 0.44, 0.34), ROCK_BROWN, {
    rotation: Quaternion.fromEulerDegrees(-7, 120, 9)
  })
  addPart(rig, Vector3.create(-0.5, 0.42, 0.85), Vector3.create(0.3, 0.36, 0.28), ROCK_DARK, {
    rotation: Quaternion.fromEulerDegrees(6, 220, -6)
  })
  addPart(rig, Vector3.create(0.55, 0.86, -0.55), Vector3.create(0.16, 0.1, 0.14), GAS_GREEN, {
    emissive: GAS_GLOW,
    emissiveIntensity: 1.2,
    rotation: Quaternion.fromEulerDegrees(12, 60, 8)
  })
  addPart(rig, Vector3.create(-0.62, 0.84, 0.3), Vector3.create(0.13, 0.08, 0.12), GAS_GREEN, {
    emissive: GAS_GLOW,
    emissiveIntensity: 1.2,
    rotation: Quaternion.fromEulerDegrees(-10, 160, -6)
  })

  // Rising gas plume.
  const smoke = engine.addEntity()
  Transform.create(smoke, { parent: rig.bodyRoot, position: Vector3.create(0, 1, 0) })
  ParticleSystem.create(smoke, createGeyserSmokeOptions())
  rig.parts.push(smoke)
  rig.smoke = smoke
  rig.smokeActive = true
}

function createGeyserSmokeOptions() {
  return {
    rate: 7,
    maxParticles: 32,
    lifetime: 2.4,
    // Negative gravity makes the plume rise.
    gravity: -0.55,
    initialSize: { start: 0.24, end: 0.5 },
    sizeOverTime: { start: 0.6, end: 1.9 },
    initialVelocitySpeed: { start: 0.3, end: 0.7 },
    initialColor: {
      start: Color4.create(0.5, 0.85, 0.55, 0.42),
      end: Color4.create(0.42, 0.72, 0.46, 0.3)
    },
    colorOverTime: {
      start: Color4.create(0.45, 0.75, 0.5, 0.36),
      end: Color4.create(0.3, 0.4, 0.32, 0)
    },
    blendMode: PARTICLE_BLEND_ALPHA,
    shape: ParticleSystem.Shape.Cone({ angle: 10, radius: 0.28 }),
    loop: true,
    prewarm: true
  }
}

export function isProceduralResource(root: Entity): boolean {
  return rigs.has(root)
}

/** Quick scale punch when a miner works the node. */
export function playResourceGatherPulse(root: Entity): void {
  const rig = rigs.get(root)
  if (!rig || rig.depleted) return

  rig.pulseTimer = PULSE_DURATION
}

/** Gas geysers "die out": the pool collapses and the plume stops until the node is hidden. */
export function playResourceDepletion(root: Entity): void {
  const rig = rigs.get(root)
  if (!rig) return

  rig.pulseTimer = 0
  rig.dyingTimer = DIE_DURATION
  rig.depleted = true
  setSmokeActive(rig, false)
}

/** Visibility doesn't cascade to children, so fog of war toggles every part. */
export function setResourceModelVisible(root: Entity, visible: boolean): void {
  const rig = rigs.get(root)
  if (!rig) return

  for (const part of rig.parts) {
    VisibilityComponent.createOrReplace(part, { visible })
  }
  // Particles ignore VisibilityComponent, so the plume is toggled by removing the emitter.
  setSmokeActive(rig, visible && !rig.depleted)
}

function setSmokeActive(rig: ResourceRig, active: boolean): void {
  if (!rig.smoke || rig.smokeActive === active) return

  rig.smokeActive = active
  if (active) ParticleSystem.createOrReplace(rig.smoke, createGeyserSmokeOptions())
  else ParticleSystem.deleteFrom(rig.smoke)
}

/** Unregisters the rig; optionally removes the part entities (children aren't removed with their root). */
export function disposeResourceModel(root: Entity, removeParts: boolean): void {
  const rig = rigs.get(root)
  if (!rig) return

  setSmokeActive(rig, false)
  if (removeParts) {
    for (const part of rig.parts) engine.removeEntity(part)
  }
  rigs.delete(root)
}

function resourceAnimationSystem(dt: number): void {
  for (const rig of rigs.values()) {
    if (rig.pulseTimer > 0) {
      rig.pulseTimer = Math.max(0, rig.pulseTimer - dt)
      const progress = 1 - rig.pulseTimer / PULSE_DURATION
      const factor = 1 + 0.12 * Math.sin(Math.PI * progress)
      Transform.getMutable(rig.bodyRoot).scale = Vector3.create(factor, factor, factor)
    }

    if (rig.dyingTimer >= 0 && rig.pool && rig.poolBaseScale) {
      rig.dyingTimer -= dt
      const progress = Math.min(1, Math.max(0, 1 - rig.dyingTimer / DIE_DURATION))
      const remaining = Math.max(0.05, 1 - progress)
      Transform.getMutable(rig.pool).scale = Vector3.create(
        rig.poolBaseScale.x * remaining,
        rig.poolBaseScale.y,
        rig.poolBaseScale.z * remaining
      )
      if (rig.dyingTimer < 0) rig.dyingTimer = -1
    }
  }
}

engine.addSystem(resourceAnimationSystem)
