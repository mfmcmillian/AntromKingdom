import { Transform } from '@dcl/sdk/ecs'
import { BUILDING_DEFINITIONS, SCENE } from '../config'
import { isGroundWalkable } from '../maps'
import type { BuildableKind, Soldier, Worker } from '../types'
import { buildings, soldiers, workers } from '../world'

// ---------------------------------------------------------------------------
// Unit separation: overlapping units gently shove each other apart so armies
// spread into formations instead of stacking into a single point. Flyers only
// collide with other flyers (they are on a different layer than ground units),
// and workers actively mining/building are exempt - like StarCraft harvesters,
// they may clip through the crowd so the economy never jams.
// Buildings are solid too: ground units that step into a footprint get pushed
// out the nearest face, so they slide around structures instead of through.
// ---------------------------------------------------------------------------

type Unit = Soldier | Worker

/** Two ground units closer than this (center to center) get pushed apart. */
const GROUND_RADIUS = 1.4
const FLYER_RADIUS = 2.2
/** Push speed in m/s - firm enough to unstack, gentle enough not to fight orders. */
const PUSH_SPEED = 3
const MAP_MARGIN = 1.5
/** Spatial hash cell; must be >= the largest separation radius. */
const CELL_SIZE = 2.5
/** Building push-out beats walk speed (3 m/s), so units slide along the wall instead of tunneling. */
const BUILDING_PUSH_SPEED = 6
/** Breathing room between a unit's center and a building face. */
const BUILDING_CLEARANCE = 0.45

function isFlyer(unit: Unit): boolean {
  return unit.kind === 'soldier' && (unit.variant === 'flyer' || unit.variant === 'transport' || unit.variant === 'heavyAir')
}

/** Busy harvesters and builders phase through the crowd (SC harvester rule). */
function ignoresCollision(unit: Unit): boolean {
  if (unit.kind !== 'worker') return false
  return unit.state === 'movingToResource' || unit.state === 'gathering' || unit.state === 'returning' || unit.state === 'constructing' || unit.state === 'repairing'
}

/** Builders and repair crews must reach the structure's edge, so walls don't apply to them. */
function ignoresBuildings(unit: Unit): boolean {
  if (unit.kind === 'worker') {
    return unit.state === 'movingToBuild' || unit.state === 'movingToRepair' || ignoresCollision(unit)
  }
  // Dug-in artillery is immobile by design; never shove it.
  return (unit as Soldier).sieged === true
}

/** The building a unit is ordered to attack stays passable, so melee can close to its edge. */
function isAttackingBlocker(unit: Unit, blockerId: string): boolean {
  if (unit.kind === 'worker') return unit.attackTargetId === blockerId
  return (unit as Soldier).targetId === blockerId
}

type BuildingBlocker = { id: string; x: number; z: number; radius: number }

/** Solid footprints (all teams, construction sites included), as circles inscribed in the footprint. */
function collectBuildingBlockers(): BuildingBlocker[] {
  const blockers: BuildingBlocker[] = []
  for (const building of buildings) {
    if (!building.alive) continue
    const definition = BUILDING_DEFINITIONS[building.kind as BuildableKind]
    const footprint = definition ? Math.max(definition.scale.x, definition.scale.z) : 5
    const position = Transform.get(building.entity).position
    blockers.push({ id: building.id, x: position.x, z: position.z, radius: footprint / 2 })
  }
  return blockers
}

/** Push a ground unit radially out of any building footprint it overlaps. */
function pushOutOfBuildings(unit: Unit, blockers: BuildingBlocker[], maxStep: number): void {
  const position = Transform.getMutable(unit.entity).position
  for (const blocker of blockers) {
    if (isAttackingBlocker(unit, blocker.id)) continue

    const dx = position.x - blocker.x
    const dz = position.z - blocker.z
    const bound = blocker.radius + BUILDING_CLEARANCE
    const distanceSq = dx * dx + dz * dz
    if (distanceSq >= bound * bound) continue

    // Dead center (building finished on top of the unit): pick +X deterministically.
    const distance = Math.sqrt(distanceSq)
    const outX = distance > 0.001 ? dx / distance : 1
    const outZ = distance > 0.001 ? dz / distance : 0
    const step = Math.min(bound - distance, maxStep)
    const nextX = position.x + outX * step
    const nextZ = position.z + outZ * step

    // Never shove a unit off an island rim into the sky.
    if (!isGroundWalkable(nextX, nextZ)) continue
    position.x = nextX
    position.z = nextZ
  }
}

/**
 * Project a ground destination out of any building footprint it lands in, so a
 * walk order clicked onto a roof becomes "walk to that building's wall" instead
 * of an unreachable point the unit grinds against forever.
 */
export function clampPointOutsideBuildings(point: { x: number; z: number }): { x: number; z: number } {
  let x = point.x
  let z = point.z
  for (const blocker of collectBuildingBlockers()) {
    const dx = x - blocker.x
    const dz = z - blocker.z
    const bound = blocker.radius + BUILDING_CLEARANCE
    const distanceSq = dx * dx + dz * dz
    if (distanceSq >= bound * bound) continue

    const distance = Math.sqrt(distanceSq)
    const outX = distance > 0.001 ? dx / distance : 1
    const outZ = distance > 0.001 ? dz / distance : 0
    x = blocker.x + outX * (bound + 0.1)
    z = blocker.z + outZ * (bound + 0.1)
  }
  return { x, z }
}

export function updateUnitSeparation(dt: number): void {
  const units: Unit[] = []
  for (const soldier of soldiers) if (soldier.alive && !soldier.inTransportId) units.push(soldier)
  for (const worker of workers) if (worker.alive && !worker.inTransportId && !ignoresCollision(worker)) units.push(worker)

  const blockers = collectBuildingBlockers()
  if (blockers.length > 0) {
    const maxBuildingStep = BUILDING_PUSH_SPEED * dt
    for (const unit of units) {
      if (isFlyer(unit) || ignoresBuildings(unit)) continue
      pushOutOfBuildings(unit, blockers, maxBuildingStep)
    }
  }

  if (units.length < 2) return

  // Spatial hash so big armies stay cheap: only neighboring cells are compared.
  const grid = new Map<number, Unit[]>()
  const cellOf = (x: number, z: number) => Math.floor(x / CELL_SIZE) * 4096 + Math.floor(z / CELL_SIZE)
  for (const unit of units) {
    const position = Transform.get(unit.entity).position
    const key = cellOf(position.x, position.z)
    const bucket = grid.get(key)
    if (bucket) bucket.push(unit)
    else grid.set(key, [unit])
  }

  const maxPush = PUSH_SPEED * dt

  for (const unit of units) {
    const transform = Transform.getMutable(unit.entity)
    const position = transform.position
    const flying = isFlyer(unit)
    const cellX = Math.floor(position.x / CELL_SIZE)
    const cellZ = Math.floor(position.z / CELL_SIZE)

    let pushX = 0
    let pushZ = 0

    for (let gx = cellX - 1; gx <= cellX + 1; gx++) {
      for (let gz = cellZ - 1; gz <= cellZ + 1; gz++) {
        const bucket = grid.get(gx * 4096 + gz)
        if (!bucket) continue

        for (const other of bucket) {
          if (other === unit || isFlyer(other) !== flying) continue

          const otherPosition = Transform.get(other.entity).position
          const dx = position.x - otherPosition.x
          const dz = position.z - otherPosition.z
          const radius = flying ? FLYER_RADIUS : GROUND_RADIUS
          const distanceSq = dx * dx + dz * dz
          if (distanceSq >= radius * radius) continue

          if (distanceSq < 0.0001) {
            // Perfectly stacked: nudge in a direction derived from identity so
            // the pair splits the same way on every client.
            const angle = (hashId(unit.id) % 628) / 100
            pushX += Math.cos(angle)
            pushZ += Math.sin(angle)
            continue
          }

          const distance = Math.sqrt(distanceSq)
          const strength = (radius - distance) / radius
          pushX += (dx / distance) * strength
          pushZ += (dz / distance) * strength
        }
      }
    }

    if (pushX === 0 && pushZ === 0) continue

    const magnitude = Math.sqrt(pushX * pushX + pushZ * pushZ)
    const step = Math.min(magnitude, 1) * maxPush
    const nextX = clamp(position.x + (pushX / magnitude) * step, MAP_MARGIN, SCENE.size - MAP_MARGIN)
    const nextZ = clamp(position.z + (pushZ / magnitude) * step, MAP_MARGIN, SCENE.size - MAP_MARGIN)
    // Ground units never get shoved off an island's rim into the sky.
    if (!flying && !isGroundWalkable(nextX, nextZ)) continue
    position.x = nextX
    position.z = nextZ
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function hashId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return Math.abs(hash)
}
