import { Transform } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { distanceToPoint, moveTowardPosition } from '../math'
import { spawnImpactFlash } from '../impactVfx'
import { getRace } from '../races'
import { areHostile } from '../state'
import type { Building, Soldier, Worker } from '../types'
import { buildings, getTeam, soldiers, workers } from '../world'

// Support units. Per-race behavior:
//   human Field Medic  - strong single-target heal beam (fighters and workers).
//   alien Lightmender  - slower beam that also mends completed structures.
//   bio   Broodtender  - passive regeneration aura for every nearby ally.
// Beam healers only doctor while standing (idle); ordered moves take priority.

type HealTarget = Building | Soldier | Worker

const HEAL_GLOW = Color4.create(0.35, 1, 0.55, 1)
/** How far a beam healer will look for (and chase) wounded allies. */
const SCAN_RANGE = 12
const SCAN_INTERVAL = 0.5
/** Pace of the green heal flashes, so VFX don't spam every frame. */
const FX_INTERVAL = 0.9

export type HealerSystemDeps = {
  setSoldierAnimation(soldier: Soldier, clipName: string, restart?: boolean): void
}

export function updateHealers(dt: number, deps: HealerSystemDeps): void {
  for (const healer of soldiers) {
    if (!healer.alive || healer.variant !== 'healer' || healer.inTransportId) continue
    if (getRace(getTeam(healer)).id === 'bio') updateAuraHealer(healer, dt)
    else updateBeamHealer(healer, dt, deps)
  }
}

/** Broodtender: mends every friendly unit inside the aura, even while walking. */
function updateAuraHealer(healer: Soldier, dt: number): void {
  const team = getTeam(healer)
  const position = Transform.get(healer.entity).position
  const radius = healer.attackRange
  const amount = (healer.healRate ?? 3) * dt
  let healedAnyone = false

  for (const ally of [...soldiers, ...workers]) {
    if (!ally.alive || ally.hp >= ally.maxHp || ally.id === healer.id) continue
    if (areHostile(getTeam(ally), team)) continue
    if (distanceToPoint(position, Transform.get(ally.entity).position) > radius) continue
    ally.hp = Math.min(ally.maxHp, ally.hp + amount)
    healedAnyone = true
  }

  healer.healTimer = (healer.healTimer ?? 0) + dt
  if (healedAnyone && healer.healTimer >= FX_INTERVAL) {
    healer.healTimer = 0
    spawnImpactFlash(Vector3.create(position.x, position.y + 0.4, position.z), HEAL_GLOW)
  }
}

/** Field Medic / Lightmender: chase the nearest wounded ally and beam-heal it. */
function updateBeamHealer(healer: Soldier, dt: number, deps: HealerSystemDeps): void {
  // Ordered movement (rally / attack-move / patrol) always takes priority.
  if (healer.state !== 'idle') return

  const healsBuildings = getRace(getTeam(healer)).id === 'alien'
  healer.healTimer = (healer.healTimer ?? 0) + dt

  let target = healer.healTargetId ? findFriendlyById(healer.healTargetId) : undefined
  if (!target?.alive || target.hp >= target.maxHp) {
    target = undefined
    healer.healTargetId = undefined
  }

  if (!target) {
    if (healer.healTimer < SCAN_INTERVAL) return
    healer.healTimer = 0
    target = findWoundedAlly(healer, healsBuildings)
    if (!target) {
      deps.setSoldierAnimation(healer, 'idle')
      return
    }
    healer.healTargetId = target.id
  }

  const position = Transform.get(healer.entity).position
  const targetPosition = Transform.get(target.entity).position

  if (distanceToPoint(position, targetPosition) > healer.attackRange) {
    moveTowardPosition(healer.entity, targetPosition, healer.moveSpeed, dt)
    deps.setSoldierAnimation(healer, 'walk')
    return
  }

  target.hp = Math.min(target.maxHp, target.hp + (healer.healRate ?? 5) * dt)
  deps.setSoldierAnimation(healer, 'attack')
  if (healer.healTimer >= FX_INTERVAL) {
    healer.healTimer = 0
    spawnImpactFlash(Vector3.create(targetPosition.x, targetPosition.y + 0.5, targetPosition.z), HEAL_GLOW)
  }
  if (target.hp >= target.maxHp) {
    healer.healTargetId = undefined
    deps.setSoldierAnimation(healer, 'idle')
  }
}

function findFriendlyById(id: string): HealTarget | undefined {
  return (
    soldiers.find((soldier) => soldier.id === id) ??
    workers.find((worker) => worker.id === id) ??
    buildings.find((building) => building.id === id)
  )
}

/** Nearest wounded non-hostile unit (and structures, for the Lightmender). */
function findWoundedAlly(healer: Soldier, healsBuildings: boolean): HealTarget | undefined {
  const team = getTeam(healer)
  const position = Transform.get(healer.entity).position
  let best: HealTarget | undefined
  let bestDistance = SCAN_RANGE

  const consider = (candidate: HealTarget): void => {
    if (!candidate.alive || candidate.hp >= candidate.maxHp || candidate.id === healer.id) return
    if (areHostile(getTeam(candidate), team)) return
    const distance = distanceToPoint(position, Transform.get(candidate.entity).position)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }

  for (const soldier of soldiers) consider(soldier)
  for (const worker of workers) consider(worker)
  if (healsBuildings) {
    for (const building of buildings) {
      if (building.isComplete) consider(building)
    }
  }
  return best
}
