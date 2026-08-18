import { Entity, Material, MeshRenderer, ParticleSystem, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { ResourceKind } from './types'

// Procedural resource nodes: faceted blue mineral crystal fields
// and rocky gas geysers with a glowing green pool and a rising smoke plume.
// Idle nodes are static for performance; only gather pulses and depletion animate.

interface ResourceRig {
  bodyRoot: Entity
  parts: Entity[]
  pulseTimer: number
  dyingTimer: number
  depleted: boolean
  /** Rich node (gold crystal / cryo plasma): drives the plume color on re-show. */
  rich: boolean
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

// Rich variants: gold crystal veins and icy cryo plasma at the map center.
const GOLD_DEEP = Color4.create(0.95, 0.62, 0.12, 1)
const GOLD_BRIGHT = Color4.create(1, 0.85, 0.4, 1)
const GOLD_GLOW = Color4.create(1, 0.78, 0.25, 1)
const CRYO_BLUE = Color4.create(0.35, 0.75, 1, 1)
const CRYO_GLOW = Color4.create(0.5, 0.88, 1, 1)

/** Shard/pool palette per node tier, so rich nodes read instantly at a glance. */
type CrystalPalette = { deep: Color4; bright: Color4; glow: Color4 }
type PlasmaPalette = { pool: Color4; glow: Color4 }

const CRYSTAL_PALETTES: Record<'normal' | 'rich', CrystalPalette> = {
  normal: { deep: MINERAL_BLUE, bright: MINERAL_ICE, glow: MINERAL_GLOW },
  rich: { deep: GOLD_DEEP, bright: GOLD_BRIGHT, glow: GOLD_GLOW }
}
const PLASMA_PALETTES: Record<'normal' | 'rich', PlasmaPalette> = {
  normal: { pool: GAS_GREEN, glow: GAS_GLOW },
  rich: { pool: CRYO_BLUE, glow: CRYO_GLOW }
}

export function buildResourceModel(root: Entity, kind: ResourceKind, rich = false): void {
  const bodyRoot = engine.addEntity()
  Transform.create(bodyRoot, { parent: root })

  const rig: ResourceRig = { bodyRoot, parts: [bodyRoot], pulseTimer: 0, dyingTimer: -1, depleted: false, rich, smokeActive: false }

  if (kind === 'minerals') buildMineralField(rig, CRYSTAL_PALETTES[rich ? 'rich' : 'normal'])
  else buildGasGeyser(rig, PLASMA_PALETTES[rich ? 'rich' : 'normal'])

  rigs.set(root, rig)
}

function addPart(
  rig: ResourceRig,
  position: Vector3,
  scale: Vector3,
  color: Color4,
  options: {
    emissive?: Color4
    emissiveIntensity?: number
    cylinder?: boolean
    cone?: boolean
    sphere?: boolean
    rotation?: Quaternion
    metallic?: number
    roughness?: number
  } = {}
): Entity {
  const part = engine.addEntity()
  Transform.create(part, {
    parent: rig.bodyRoot,
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
    metallic: options.metallic ?? 0.2,
    roughness: options.roughness ?? 0.8,
    castShadows: false
  })
  rig.parts.push(part)
  return part
}

/**
 * A shard is a box rotated 45 degrees on its long axis so the corners read as
 * gem facets, capped with a brighter pyramid tip so every spire tapers to a
 * glowing point (the pre-rotated cone rides the same yaw/lean).
 */
function addCrystalShard(rig: ResourceRig, palette: CrystalPalette, position: Vector3, width: number, height: number, yaw: number, lean: number, bright: boolean): void {
  const rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(0, yaw, 0), Quaternion.fromEulerDegrees(lean, 45, 0))
  addPart(rig, position, Vector3.create(width, height, width), bright ? palette.bright : palette.deep, {
    emissive: palette.glow,
    emissiveIntensity: bright ? 1.4 : 0.9,
    rotation,
    metallic: 0.15,
    roughness: 0.2
  })

  // Tip: offset along the shard's local up axis so it caps the leaning column.
  const leanRad = (lean * Math.PI) / 180
  const yawRad = (yaw * Math.PI) / 180
  const tipRise = height / 2 + width * 0.5
  const tipOffset = Vector3.create(
    position.x + Math.sin(leanRad) * Math.sin(yawRad) * tipRise,
    position.y + Math.cos(leanRad) * tipRise,
    position.z + Math.sin(leanRad) * Math.cos(yawRad) * tipRise
  )
  addPart(rig, tipOffset, Vector3.create(width * 0.92, width * 1.5, width * 0.92), palette.bright, {
    cone: true,
    emissive: palette.glow,
    emissiveIntensity: bright ? 2.6 : 1.8,
    rotation: Quaternion.multiply(Quaternion.fromEulerDegrees(0, yaw, 0), Quaternion.fromEulerDegrees(lean, 45, 0)),
    metallic: 0.1,
    roughness: 0.15
  })
}

function buildMineralField(rig: ResourceRig, palette: CrystalPalette): void {
  // Regolith mound the crystals grow out of, with strewn rubble.
  addPart(rig, Vector3.create(0, 0.1, 0), Vector3.create(2.1, 0.2, 2.1), ROCK_DARK, { cylinder: true })
  addPart(rig, Vector3.create(0, 0.24, 0), Vector3.create(1.5, 0.14, 1.5), ROCK_BROWN, { cylinder: true })
  addPart(rig, Vector3.create(0.68, 0.16, -0.5), Vector3.create(0.42, 0.26, 0.38), ROCK_BROWN, {
    rotation: Quaternion.fromEulerDegrees(6, 40, -8)
  })
  addPart(rig, Vector3.create(-0.7, 0.14, 0.45), Vector3.create(0.36, 0.22, 0.32), ROCK_BROWN, {
    rotation: Quaternion.fromEulerDegrees(-5, 150, 7)
  })
  addPart(rig, Vector3.create(-0.15, 0.12, -0.78), Vector3.create(0.3, 0.18, 0.26), ROCK_DARK, {
    rotation: Quaternion.fromEulerDegrees(4, 250, -5)
  })

  // Energy fissures: glowing cracks radiating out from under the cluster.
  addPart(rig, Vector3.create(0, 0.32, 0), Vector3.create(1.05, 0.04, 1.05), palette.deep, {
    cylinder: true,
    emissive: palette.glow,
    emissiveIntensity: 1.1
  })
  for (const [yaw, length] of [
    [15, 1.5],
    [95, 1.3],
    [170, 1.45],
    [265, 1.25]
  ]) {
    addPart(rig, Vector3.create(0, 0.225, 0), Vector3.create(0.09, 0.015, length), palette.bright, {
      emissive: palette.glow,
      emissiveIntensity: 2.2,
      rotation: Quaternion.fromEulerDegrees(0, yaw, 0)
    })
  }

  // The spire cluster: one dominant crystal, a mid ring, and small sprouts,
  // every one tapering to a glowing faceted tip.
  addCrystalShard(rig, palette, Vector3.create(0, 0.85, 0), 0.42, 1.35, 15, 4, true)
  addCrystalShard(rig, palette, Vector3.create(0.48, 0.55, 0.22), 0.3, 0.95, 70, 16, false)
  addCrystalShard(rig, palette, Vector3.create(-0.45, 0.5, -0.18), 0.28, 0.85, 200, -14, false)
  addCrystalShard(rig, palette, Vector3.create(0.12, 0.4, -0.55), 0.22, 0.65, 130, -12, true)
  addCrystalShard(rig, palette, Vector3.create(-0.24, 0.34, 0.52), 0.2, 0.52, 300, 14, false)
  addCrystalShard(rig, palette, Vector3.create(0.6, 0.26, -0.38), 0.15, 0.38, 250, 18, true)
  addCrystalShard(rig, palette, Vector3.create(-0.65, 0.22, 0.05), 0.13, 0.32, 320, -18, false)
}

function buildGasGeyser(rig: ResourceRig, palette: PlasmaPalette): void {
  // Volcanic cone: four strata layers tapering up to the vent mouth.
  addPart(rig, Vector3.create(0, 0.18, 0), Vector3.create(2.7, 0.36, 2.7), ROCK_BROWN, { cylinder: true })
  addPart(rig, Vector3.create(0, 0.5, 0), Vector3.create(2.15, 0.32, 2.15), ROCK_DARK, { cylinder: true })
  addPart(rig, Vector3.create(0, 0.8, 0), Vector3.create(1.65, 0.28, 1.65), ROCK_BROWN, { cylinder: true })
  addPart(rig, Vector3.create(0, 1.06, 0), Vector3.create(1.25, 0.24, 1.25), ROCK_DARK, { cylinder: true })

  // Crater mouth with the glowing plasma pool inside.
  addPart(rig, Vector3.create(0, 1.2, 0), Vector3.create(1.02, 0.06, 1.02), CRATER_DARK, { cylinder: true })
  const pool = addPart(rig, Vector3.create(0, 1.25, 0), Vector3.create(0.82, 0.05, 0.82), palette.pool, {
    cylinder: true,
    emissive: palette.glow,
    emissiveIntensity: 2.2
  })
  rig.pool = pool
  rig.poolBaseScale = Vector3.create(0.82, 0.05, 0.82)
  // Bubble dome rising out of the pool.
  addPart(rig, Vector3.create(0.18, 1.26, -0.12), Vector3.create(0.2, 0.14, 0.2), palette.pool, {
    sphere: true,
    emissive: palette.glow,
    emissiveIntensity: 2.6
  })

  // Rim fangs: rock spikes leaning out from the mouth like a cracked maw.
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.4
    const x = Math.cos(angle) * 0.62
    const z = Math.sin(angle) * 0.62
    addPart(rig, Vector3.create(x, 1.32, z), Vector3.create(0.2, 0.5, 0.2), i % 2 === 0 ? ROCK_DARK : ROCK_BROWN, {
      cone: true,
      rotation: Quaternion.fromEulerDegrees(Math.sin(angle) * 24, (i * 360) / 5, -Math.cos(angle) * 24)
    })
  }

  // Plasma veins bleeding down the cone from the mouth.
  for (const [yaw, drop] of [
    [30, 0.62],
    [140, 0.7],
    [255, 0.55]
  ]) {
    const rad = (yaw * Math.PI) / 180
    addPart(rig, Vector3.create(Math.cos(rad) * 0.85, drop, Math.sin(rad) * 0.85), Vector3.create(0.1, 0.75, 0.08), palette.pool, {
      emissive: palette.glow,
      emissiveIntensity: 1.9,
      rotation: Quaternion.fromEulerDegrees(Math.sin(rad) * 32, yaw, -Math.cos(rad) * 32)
    })
  }

  // Boulders and glowing crust patches around the foot of the cone.
  addPart(rig, Vector3.create(1.15, 0.32, 0.5), Vector3.create(0.44, 0.5, 0.4), ROCK_DARK, {
    rotation: Quaternion.fromEulerDegrees(8, 30, -10)
  })
  addPart(rig, Vector3.create(-1.05, 0.28, -0.6), Vector3.create(0.4, 0.44, 0.36), ROCK_BROWN, {
    rotation: Quaternion.fromEulerDegrees(-7, 120, 9)
  })
  addPart(rig, Vector3.create(-0.6, 0.3, 1), Vector3.create(0.32, 0.38, 0.3), ROCK_DARK, {
    rotation: Quaternion.fromEulerDegrees(6, 220, -6)
  })
  addPart(rig, Vector3.create(0.7, 0.12, -1.05), Vector3.create(0.3, 0.16, 0.26), palette.pool, {
    emissive: palette.glow,
    emissiveIntensity: 1.3,
    rotation: Quaternion.fromEulerDegrees(4, 60, -4)
  })
  addPart(rig, Vector3.create(-1.1, 0.1, 0.35), Vector3.create(0.24, 0.12, 0.2), palette.pool, {
    emissive: palette.glow,
    emissiveIntensity: 1.3,
    rotation: Quaternion.fromEulerDegrees(-6, 160, 5)
  })

  // Rising gas plume out of the crater mouth.
  const smoke = engine.addEntity()
  Transform.create(smoke, { parent: rig.bodyRoot, position: Vector3.create(0, 1.35, 0) })
  ParticleSystem.create(smoke, createGeyserSmokeOptions(rig.rich))
  rig.parts.push(smoke)
  rig.smoke = smoke
  rig.smokeActive = true
}

function createGeyserSmokeOptions(rich: boolean) {
  // Cryo vents breathe an icy blue mist; standard vents a sickly green plume.
  const [start, mid, end] = rich
    ? [Color4.create(0.55, 0.85, 1, 0.45), Color4.create(0.45, 0.75, 1, 0.36), Color4.create(0.3, 0.42, 0.6, 0)]
    : [Color4.create(0.5, 0.85, 0.55, 0.42), Color4.create(0.45, 0.75, 0.5, 0.36), Color4.create(0.3, 0.4, 0.32, 0)]
  return {
    rate: 7,
    maxParticles: 32,
    lifetime: 2.4,
    // Negative gravity makes the plume rise.
    gravity: -0.55,
    initialSize: { start: 0.24, end: 0.5 },
    sizeOverTime: { start: 0.6, end: 1.9 },
    initialVelocitySpeed: { start: 0.3, end: 0.7 },
    initialColor: { start, end: mid },
    colorOverTime: { start: mid, end },
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
  if (active) ParticleSystem.createOrReplace(rig.smoke, createGeyserSmokeOptions(rig.rich))
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
