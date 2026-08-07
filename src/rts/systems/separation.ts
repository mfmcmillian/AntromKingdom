import { Transform } from '@dcl/sdk/ecs'
import { SCENE } from '../config'
import { isGroundWalkable } from '../maps'
import type { Soldier, Worker } from '../types'
import { soldiers, workers } from '../world'

// ---------------------------------------------------------------------------
// Unit separation: overlapping units gently shove each other apart so armies
// spread into formations instead of stacking into a single point. Flyers only
// collide with other flyers (they are on a different layer than ground units),
// and workers actively mining/building are exempt - like StarCraft harvesters,
// they may clip through the crowd so the economy never jams.
// ---------------------------------------------------------------------------

type Unit = Soldier | Worker

/** Two ground units closer than this (center to center) get pushed apart. */
const GROUND_RADIUS = 1.15
const FLYER_RADIUS = 1.8
/** Push speed in m/s - firm enough to unstack, gentle enough not to fight orders. */
const PUSH_SPEED = 3
const MAP_MARGIN = 1.5
/** Spatial hash cell; must be >= the largest separation radius. */
const CELL_SIZE = 2

function isFlyer(unit: Unit): boolean {
  return unit.kind === 'soldier' && (unit.variant === 'flyer' || unit.variant === 'transport')
}

/** Busy harvesters and builders phase through the crowd (SC harvester rule). */
function ignoresCollision(unit: Unit): boolean {
  if (unit.kind !== 'worker') return false
  return unit.state === 'movingToResource' || unit.state === 'gathering' || unit.state === 'returning' || unit.state === 'constructing' || unit.state === 'repairing'
}

export function updateUnitSeparation(dt: number): void {
  const units: Unit[] = []
  for (const soldier of soldiers) if (soldier.alive && !soldier.inTransportId) units.push(soldier)
  for (const worker of workers) if (worker.alive && !worker.inTransportId && !ignoresCollision(worker)) units.push(worker)
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
