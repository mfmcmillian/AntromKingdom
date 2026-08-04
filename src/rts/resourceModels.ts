import { Entity, Material, MeshRenderer, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { ResourceKind } from './types'

// Procedural space resource deposits, in the same primitive style as the mining robot:
// ore (was rocks), crystal veins (was trees), and plasma vents (was pigs).
// Idle nodes are static for performance; only gather pulses and depletion animate.

interface ResourceRig {
  bodyRoot: Entity
  parts: Entity[]
  pulseTimer: number
  dyingTimer: number
  column?: Entity
  columnBaseScale?: Vector3
}

const rigs = new Map<Entity, ResourceRig>()

const PULSE_DURATION = 0.45
const DIE_DURATION = 1.4

// Muted albedos with restrained emissive so deposits read as colored shapes
// from the overhead camera instead of blown-out white blobs.
const ROCK_DARK = Color4.create(0.3, 0.3, 0.35, 1)
const ROCK_DARKER = Color4.create(0.24, 0.24, 0.28, 1)
const ORE_VEIN = Color4.create(1, 0.58, 0.16, 1)
const CRYSTAL_TEAL = Color4.create(0.1, 0.52, 0.6, 1)
const CRYSTAL_GLOW = Color4.create(0.1, 0.7, 0.8, 1)
const PLASMA_ORANGE = Color4.create(1, 0.38, 0.1, 1)
const PLASMA_CORE = Color4.create(1, 0.45, 0.15, 1)

export function buildResourceModel(root: Entity, kind: ResourceKind): void {
  const bodyRoot = engine.addEntity()
  Transform.create(bodyRoot, { parent: root })

  const rig: ResourceRig = { bodyRoot, parts: [bodyRoot], pulseTimer: 0, dyingTimer: -1 }

  if (kind === 'rocks') buildOreDeposit(rig)
  else if (kind === 'wood') buildCrystalFormation(rig)
  else buildPlasmaVent(rig)

  rigs.set(root, rig)
}

function addPart(
  rig: ResourceRig,
  position: Vector3,
  scale: Vector3,
  color: Color4,
  options: { emissive?: Color4; emissiveIntensity?: number; cylinder?: boolean; rotation?: Quaternion } = {}
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
    metallic: 0.2,
    roughness: 0.85,
    castShadows: false
  })
  rig.parts.push(part)
  return part
}

function buildOreDeposit(rig: ResourceRig): void {
  // Low cluster of angular chunks with glinting ore veins.
  addPart(rig, Vector3.create(0, 0.3, 0), Vector3.create(1, 0.6, 0.95), ROCK_DARK, {
    rotation: Quaternion.fromEulerDegrees(4, 25, -3)
  })
  addPart(rig, Vector3.create(0.5, 0.22, -0.35), Vector3.create(0.65, 0.45, 0.6), ROCK_DARKER, {
    rotation: Quaternion.fromEulerDegrees(-6, 70, 5)
  })
  addPart(rig, Vector3.create(-0.5, 0.2, 0.4), Vector3.create(0.55, 0.4, 0.5), ROCK_DARKER, {
    rotation: Quaternion.fromEulerDegrees(8, 130, -4)
  })
  addPart(rig, Vector3.create(0.15, 0.62, 0.18), Vector3.create(0.28, 0.18, 0.22), ORE_VEIN, {
    emissive: ORE_VEIN,
    emissiveIntensity: 1.1,
    rotation: Quaternion.fromEulerDegrees(15, 40, 10)
  })
  addPart(rig, Vector3.create(-0.35, 0.42, -0.25), Vector3.create(0.22, 0.16, 0.18), ORE_VEIN, {
    emissive: ORE_VEIN,
    emissiveIntensity: 1.1,
    rotation: Quaternion.fromEulerDegrees(-10, 100, 20)
  })
  addPart(rig, Vector3.create(0.55, 0.42, 0.3), Vector3.create(0.18, 0.14, 0.16), ORE_VEIN, {
    emissive: ORE_VEIN,
    emissiveIntensity: 1.1,
    rotation: Quaternion.fromEulerDegrees(20, 160, -12)
  })
}

function buildCrystalFormation(rig: ResourceRig): void {
  // Rock base with a stocky pyramid-like cluster of teal shards. Kept short and
  // wide: tall thin spikes lean badly at the screen edges of the overhead camera.
  addPart(rig, Vector3.create(0, 0.14, 0), Vector3.create(1.35, 0.28, 1.35), ROCK_DARKER, { cylinder: true })
  addPart(rig, Vector3.create(0, 0.8, 0), Vector3.create(0.46, 1.4, 0.46), CRYSTAL_TEAL, {
    emissive: CRYSTAL_GLOW,
    emissiveIntensity: 0.9,
    rotation: Quaternion.fromEulerDegrees(3, 20, -4)
  })
  addPart(rig, Vector3.create(0.42, 0.55, 0.15), Vector3.create(0.3, 0.95, 0.3), CRYSTAL_TEAL, {
    emissive: CRYSTAL_GLOW,
    emissiveIntensity: 0.8,
    rotation: Quaternion.fromEulerDegrees(6, 65, -16)
  })
  addPart(rig, Vector3.create(-0.38, 0.45, -0.2), Vector3.create(0.26, 0.75, 0.26), CRYSTAL_TEAL, {
    emissive: CRYSTAL_GLOW,
    emissiveIntensity: 0.8,
    rotation: Quaternion.fromEulerDegrees(-8, 140, 14)
  })
  addPart(rig, Vector3.create(0.1, 0.32, -0.45), Vector3.create(0.2, 0.55, 0.2), CRYSTAL_TEAL, {
    emissive: CRYSTAL_GLOW,
    emissiveIntensity: 0.8,
    rotation: Quaternion.fromEulerDegrees(-12, 200, -10)
  })
}

function buildPlasmaVent(rig: ResourceRig): void {
  // Rock ring with a glowing plasma column rising out of it.
  addPart(rig, Vector3.create(0, 0.16, 0), Vector3.create(1.5, 0.32, 1.5), ROCK_DARK, { cylinder: true })
  addPart(rig, Vector3.create(0, 0.34, 0), Vector3.create(0.9, 0.06, 0.9), PLASMA_ORANGE, {
    cylinder: true,
    emissive: PLASMA_ORANGE,
    emissiveIntensity: 1.4
  })

  const column = addPart(rig, Vector3.create(0, 0.72, 0), Vector3.create(0.5, 0.85, 0.5), PLASMA_CORE, {
    cylinder: true,
    emissive: PLASMA_CORE,
    emissiveIntensity: 1.2
  })
  rig.column = column
  rig.columnBaseScale = Vector3.create(0.5, 0.85, 0.5)

  // A few chunks around the rim.
  addPart(rig, Vector3.create(0.7, 0.28, 0.35), Vector3.create(0.3, 0.32, 0.28), ROCK_DARKER, {
    rotation: Quaternion.fromEulerDegrees(5, 45, -8)
  })
  addPart(rig, Vector3.create(-0.65, 0.24, -0.4), Vector3.create(0.26, 0.26, 0.24), ROCK_DARKER, {
    rotation: Quaternion.fromEulerDegrees(-6, 120, 10)
  })
}

export function isProceduralResource(root: Entity): boolean {
  return rigs.has(root)
}

/** Quick scale punch when a miner drills the node. */
export function playResourceGatherPulse(root: Entity): void {
  const rig = rigs.get(root)
  if (!rig || rig.dyingTimer >= 0) return

  rig.pulseTimer = PULSE_DURATION
}

/** Plasma vents "die out": the column collapses and stays dark until the node is hidden. */
export function playResourceDepletion(root: Entity): void {
  const rig = rigs.get(root)
  if (!rig) return

  rig.pulseTimer = 0
  rig.dyingTimer = DIE_DURATION
}

/** Visibility doesn't cascade to children, so fog of war toggles every part. */
export function setResourceModelVisible(root: Entity, visible: boolean): void {
  const rig = rigs.get(root)
  if (!rig) return

  for (const part of rig.parts) {
    VisibilityComponent.createOrReplace(part, { visible })
  }
}

/** Unregisters the rig; optionally removes the part entities (children aren't removed with their root). */
export function disposeResourceModel(root: Entity, removeParts: boolean): void {
  const rig = rigs.get(root)
  if (!rig) return

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
      const factor = 1 + 0.14 * Math.sin(Math.PI * progress)
      Transform.getMutable(rig.bodyRoot).scale = Vector3.create(factor, factor, factor)
    }

    if (rig.dyingTimer >= 0 && rig.column && rig.columnBaseScale) {
      rig.dyingTimer -= dt
      const progress = Math.min(1, Math.max(0, 1 - rig.dyingTimer / DIE_DURATION))
      const remaining = Math.max(0.02, 1 - progress)
      Transform.getMutable(rig.column).scale = Vector3.create(
        rig.columnBaseScale.x * remaining,
        rig.columnBaseScale.y * remaining,
        rig.columnBaseScale.z * remaining
      )
      if (rig.dyingTimer < 0) rig.dyingTimer = -1
    }
  }
}

engine.addSystem(resourceAnimationSystem)
