import { Material, MeshRenderer, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { BUILDING_DEFINITIONS } from './config'
import { BUILDING_MODEL_HEIGHTS } from './buildingModels'
import { getRace } from './races'
import { buildings, getTeam } from './world'
import type { BuildableKind, Building } from './types'

// Holographic construction effect, in the owner's race color, on every site
// that is still being built: a slowly rotating base ring marking the footprint,
// a scan ring that sweeps up the partially-grown model like a 3D printer pass,
// and a few "welder sparks" orbiting at the working height. When the building
// finishes, the rig is replaced by a short completion burst (expanding ring +
// light pillar) so the moment reads clearly even from across the map.

const SCAN_SWEEP_SECONDS = 1.9
const BASE_RING_DEGREES_PER_SECOND = 40
const SPARK_ORBIT_DEGREES_PER_SECOND = 150
const SPARK_COUNT = 4
const SPARK_SIZE = 0.22
const BURST_SECONDS = 0.6

type ConstructionRig = {
  root: Entity
  baseRing: Entity
  scanRing: Entity
  sparks: Entity[]
  /** Local animation clock, offset per site so neighboring rigs don't move in lockstep. */
  time: number
  ringRadius: number
  modelHeight: number
}

type CompletionBurst = {
  ring: Entity
  pillar: Entity
  age: number
  maxRadius: number
  height: number
}

const rigs = new Map<string, ConstructionRig>()
const bursts: CompletionBurst[] = []

function isBuildableSite(building: Building): boolean {
  return (building.kind as string) in BUILDING_MODEL_HEIGHTS
}

/** Sites currently under construction (alive, buildable kind, not finished). */
function needsRig(building: Building): boolean {
  return building.alive && !building.isComplete && isBuildableSite(building)
}

function createRig(site: Building): ConstructionRig {
  const kind = site.kind as BuildableKind
  const definition = BUILDING_DEFINITIONS[kind]
  const position = Transform.get(site.entity).position
  const accent = getRace(getTeam(site)).accent

  const ringRadius = Math.max(definition.scale.x, definition.scale.z) / 2 + 0.7
  const modelHeight = BUILDING_MODEL_HEIGHTS[kind]

  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(position.x, 0, position.z) })

  // Footprint ring: flat, semi-transparent, slowly spinning.
  const baseRing = engine.addEntity()
  Transform.create(baseRing, {
    parent: root,
    position: Vector3.create(0, 0.07, 0),
    scale: Vector3.create(ringRadius * 2, 0.06, ringRadius * 2)
  })
  MeshRenderer.setCylinder(baseRing)
  Material.setPbrMaterial(baseRing, {
    albedoColor: Color4.create(accent.r, accent.g, accent.b, 0.28),
    emissiveColor: accent,
    emissiveIntensity: 1.6,
    metallic: 0,
    roughness: 1
  })

  // Printer pass: a thinner ring sweeping bottom-to-top over the grown portion.
  const scanRing = engine.addEntity()
  Transform.create(scanRing, {
    parent: root,
    position: Vector3.create(0, 0.15, 0),
    scale: Vector3.create(ringRadius * 1.5, 0.09, ringRadius * 1.5)
  })
  MeshRenderer.setCylinder(scanRing)
  Material.setPbrMaterial(scanRing, {
    albedoColor: Color4.create(accent.r, accent.g, accent.b, 0.45),
    emissiveColor: accent,
    emissiveIntensity: 3,
    metallic: 0,
    roughness: 1
  })

  const sparks: Entity[] = []
  for (let i = 0; i < SPARK_COUNT; i++) {
    const spark = engine.addEntity()
    Transform.create(spark, {
      parent: root,
      position: Vector3.create(0, 0.3, 0),
      scale: Vector3.create(SPARK_SIZE, SPARK_SIZE, SPARK_SIZE)
    })
    MeshRenderer.setBox(spark)
    Material.setPbrMaterial(spark, {
      albedoColor: accent,
      emissiveColor: accent,
      emissiveIntensity: 4,
      metallic: 0,
      roughness: 1
    })
    sparks.push(spark)
  }

  return { root, baseRing, scanRing, sparks, time: Math.random() * 10, ringRadius, modelHeight }
}

function removeRig(rig: ConstructionRig): void {
  for (const spark of rig.sparks) engine.removeEntity(spark)
  engine.removeEntity(rig.scanRing)
  engine.removeEntity(rig.baseRing)
  engine.removeEntity(rig.root)
}

function animateRig(rig: ConstructionRig, site: Building, dt: number): void {
  rig.time += dt

  // Working height: top of the currently-grown model, never fully at ground level.
  const grownHeight = Math.max(0.6, rig.modelHeight * site.constructionProgress)

  const baseRingTransform = Transform.getMutable(rig.baseRing)
  const baseAngle = ((rig.time * BASE_RING_DEGREES_PER_SECOND) % 360) * (Math.PI / 180)
  baseRingTransform.rotation = { x: 0, y: Math.sin(baseAngle / 2), z: 0, w: Math.cos(baseAngle / 2) }

  // Sawtooth sweep from the ground to the grown top, restarting each pass.
  const sweep = (rig.time % SCAN_SWEEP_SECONDS) / SCAN_SWEEP_SECONDS
  const scanTransform = Transform.getMutable(rig.scanRing)
  scanTransform.position = Vector3.create(0, 0.12 + sweep * grownHeight, 0)
  // Narrow slightly as it climbs so tall buildings read as tapering print passes.
  const scanScale = rig.ringRadius * 1.5 * (1 - sweep * 0.25)
  scanTransform.scale = Vector3.create(scanScale, 0.09, scanScale)

  // Sparks orbit at the working height, bobbing and pulsing out of phase.
  const orbitRadius = rig.ringRadius * 0.85
  for (let i = 0; i < rig.sparks.length; i++) {
    const phase = (i / rig.sparks.length) * Math.PI * 2
    const angle = phase + rig.time * SPARK_ORBIT_DEGREES_PER_SECOND * (Math.PI / 180)
    const bob = Math.sin(rig.time * 5 + phase * 3) * 0.25
    const pulse = 1 + Math.sin(rig.time * 9 + phase * 5) * 0.35
    const sparkTransform = Transform.getMutable(rig.sparks[i])
    sparkTransform.position = Vector3.create(Math.cos(angle) * orbitRadius, grownHeight + 0.25 + bob, Math.sin(angle) * orbitRadius)
    sparkTransform.scale = Vector3.create(SPARK_SIZE * pulse, SPARK_SIZE * pulse, SPARK_SIZE * pulse)
  }
}

/** Bright send-off when a site finishes: ring blasts outward while a light pillar collapses. */
function spawnCompletionBurst(site: Building): void {
  const kind = site.kind as BuildableKind
  const definition = BUILDING_DEFINITIONS[kind]
  const position = Transform.get(site.entity).position
  const accent = getRace(getTeam(site)).accent
  const maxRadius = Math.max(definition.scale.x, definition.scale.z) / 2 + 0.7
  const height = BUILDING_MODEL_HEIGHTS[kind]

  const ring = engine.addEntity()
  Transform.create(ring, {
    position: Vector3.create(position.x, 0.1, position.z),
    scale: Vector3.create(0.5, 0.05, 0.5)
  })
  MeshRenderer.setCylinder(ring)
  Material.setPbrMaterial(ring, {
    albedoColor: Color4.create(accent.r, accent.g, accent.b, 0.5),
    emissiveColor: accent,
    emissiveIntensity: 3.5,
    metallic: 0,
    roughness: 1
  })

  const pillar = engine.addEntity()
  Transform.create(pillar, {
    position: Vector3.create(position.x, height / 2, position.z),
    scale: Vector3.create(0.7, height, 0.7)
  })
  MeshRenderer.setCylinder(pillar)
  Material.setPbrMaterial(pillar, {
    albedoColor: Color4.create(accent.r, accent.g, accent.b, 0.4),
    emissiveColor: accent,
    emissiveIntensity: 3,
    metallic: 0,
    roughness: 1
  })

  bursts.push({ ring, pillar, age: 0, maxRadius, height })
}

function updateBursts(dt: number): void {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const burst = bursts[i]
    burst.age += dt
    const t = burst.age / BURST_SECONDS

    if (t >= 1) {
      engine.removeEntity(burst.ring)
      engine.removeEntity(burst.pillar)
      bursts.splice(i, 1)
      continue
    }

    // Ring races outward and flattens; pillar thins to nothing.
    const eased = 1 - (1 - t) * (1 - t)
    const ringScale = 0.5 + eased * burst.maxRadius * 2 * 1.6
    Transform.getMutable(burst.ring).scale = Vector3.create(ringScale, 0.05 * (1 - t), ringScale)
    const pillarWidth = 0.7 * (1 - eased)
    Transform.getMutable(burst.pillar).scale = Vector3.create(pillarWidth, burst.height * (1 - t * 0.3), pillarWidth)
  }
}

/** Removes every rig and burst immediately (match reset). */
export function clearAllConstructionVfx(): void {
  for (const rig of rigs.values()) removeRig(rig)
  rigs.clear()
  for (const burst of bursts) {
    engine.removeEntity(burst.ring)
    engine.removeEntity(burst.pillar)
  }
  bursts.length = 0
}

// Reconcile rigs with the live building list, then animate. Self-registered so
// AI construction gets the effect too without rtsGame wiring anything per-site.
engine.addSystem((dt: number) => {
  for (const site of buildings) {
    if (!needsRig(site)) continue
    if (!rigs.has(site.id)) rigs.set(site.id, createRig(site))
    animateRig(rigs.get(site.id)!, site, dt)
  }

  for (const [id, rig] of rigs) {
    const site = buildings.find((candidate) => candidate.id === id)
    if (site && needsRig(site)) continue

    // Finished alive sites get the celebration; cancelled/destroyed ones just clean up.
    if (site?.alive && site.isComplete) spawnCompletionBurst(site)
    removeRig(rig)
    rigs.delete(id)
  }

  updateBursts(dt)
})
