import { Transform } from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { distanceToPoint, distanceToPosition, moveTowardPosition } from '../math'
import { getSpeedMultiplier } from '../upgrades'
import type { Building, Soldier, Worker } from '../types'
import { buildings, getTeam, soldiers, workers } from '../world'

type CombatTarget = Building | Soldier | Worker

/** Idle combat units engage anything hostile that wanders inside this radius. */
const AUTO_ACQUIRE_RANGE = 12
const AUTO_ACQUIRE_INTERVAL = 0.5

let autoAcquireTimer = 0

export type CombatSystemDeps = {
  getCombatTargetById(id: string): CombatTarget | undefined
  getSoldierAttackPosition(target: Building, slot: number, attacker: Soldier): { x: number; y: number; z: number }
  setSoldierAnimation(soldier: Soldier, clipName: string, restart?: boolean): void
  damageCombatTarget(target: CombatTarget, amount: number, attacker: Soldier): void
  assignSoldierToAttack(soldier: Soldier, target: CombatTarget, slot?: number, announce?: boolean): void
  setStatus(message: string): void
}

export function updateSoldiers(dt: number, deps: CombatSystemDeps): void {
  autoAcquireTimer += dt
  const scanForTargets = autoAcquireTimer >= AUTO_ACQUIRE_INTERVAL
  if (scanForTargets) autoAcquireTimer = 0

  for (const soldier of soldiers) {
    if (!soldier.alive) continue

    if (soldier.state === 'movingToRally') {
      updateSoldierRallyMovement(soldier, dt, deps)
      continue
    }

    if (scanForTargets && soldier.state === 'idle') {
      const target = findNearestEnemyInRange(soldier)
      if (target) deps.assignSoldierToAttack(soldier, target, 0, false)
    }

    if (!soldier.targetId) continue

    const target = deps.getCombatTargetById(soldier.targetId)

    if (!target?.alive) {
      soldier.state = 'idle'
      soldier.targetId = undefined
      soldier.attackPosition = undefined
      deps.setSoldierAnimation(soldier, 'idle')
      continue
    }

    if (soldier.state === 'movingToAttack') {
      updateMovingToAttack(soldier, target, dt, deps)
    } else if (soldier.state === 'attacking') {
      updateAttacking(soldier, target, dt, deps)
    }
  }
}

/**
 * Unit targets are chased directly and fired on the moment they are in range -
 * no precomputed standoff point, which previously made ranged units orbit their
 * target as the point slid around them. Buildings keep a fixed approach-side spot.
 */
function updateMovingToAttack(soldier: Soldier, target: CombatTarget, dt: number, deps: CombatSystemDeps): void {
  if (isUnitTarget(target)) {
    const targetPosition = Transform.get(target.entity).position
    if (distanceToPosition(soldier.entity, targetPosition) <= soldier.attackRange) {
      startAttacking(soldier, deps)
      faceTarget(soldier, targetPosition)
    } else {
      moveTowardPosition(soldier.entity, targetPosition, getUpgradedMoveSpeed(soldier), dt)
      deps.setSoldierAnimation(soldier, 'walk')
    }
    return
  }

  const attackPosition = soldier.attackPosition ?? deps.getSoldierAttackPosition(target, 0, soldier)
  soldier.attackPosition = attackPosition
  moveTowardPosition(soldier.entity, attackPosition, getUpgradedMoveSpeed(soldier), dt)
  deps.setSoldierAnimation(soldier, 'walk')
  if (distanceToPosition(soldier.entity, attackPosition) <= 0.25) {
    startAttacking(soldier, deps)
    faceTarget(soldier, Transform.get(target.entity).position)
  }
}

function updateAttacking(soldier: Soldier, target: CombatTarget, dt: number, deps: CombatSystemDeps): void {
  if (isUnitTarget(target)) {
    const targetPosition = Transform.get(target.entity).position
    // Re-chase with a small hysteresis buffer so units don't stutter on the range edge.
    if (distanceToPosition(soldier.entity, targetPosition) > soldier.attackRange + 0.6) {
      soldier.state = 'movingToAttack'
      deps.setSoldierAnimation(soldier, 'walk')
      return
    }
    faceTarget(soldier, targetPosition)
  }

  soldier.attackTimer += dt
  if (soldier.attackTimer >= soldier.attackRate) {
    soldier.attackTimer = 0
    deps.setSoldierAnimation(soldier, 'attack', true)
    deps.damageCombatTarget(target, soldier.damage, soldier)
  }
}

/** Propulsion research speeds up every fighter on the team. */
function getUpgradedMoveSpeed(soldier: Soldier): number {
  return soldier.moveSpeed * getSpeedMultiplier(getTeam(soldier))
}

function startAttacking(soldier: Soldier, deps: CombatSystemDeps): void {
  soldier.state = 'attacking'
  soldier.attackTimer = 0
  deps.setSoldierAnimation(soldier, 'attack', true)
}

function isUnitTarget(target: CombatTarget): target is Soldier | Worker {
  return target.kind === 'soldier' || target.kind === 'worker'
}

function faceTarget(soldier: Soldier, targetPosition: { x: number; y: number; z: number }): void {
  const transform = Transform.getMutable(soldier.entity)
  const dx = targetPosition.x - transform.position.x
  const dz = targetPosition.z - transform.position.z
  if (dx * dx + dz * dz < 0.0001) return

  transform.rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0)
}

function updateSoldierRallyMovement(soldier: Soldier, dt: number, deps: CombatSystemDeps): void {
  if (!soldier.rallyPoint) {
    soldier.state = 'idle'
    soldier.attackPosition = undefined
    deps.setSoldierAnimation(soldier, 'idle')
    return
  }

  moveTowardPosition(soldier.entity, soldier.rallyPoint, getUpgradedMoveSpeed(soldier), dt)
  if (distanceToPosition(soldier.entity, soldier.rallyPoint) <= 0.35) {
    soldier.state = 'idle'
    soldier.rallyPoint = undefined
    soldier.attackPosition = undefined
    deps.setSoldierAnimation(soldier, 'idle')
    deps.setStatus(`${soldier.name} reached destination.`)
  }
}

/** Nearest hostile within acquisition range: enemy fighters first, then workers, then buildings. */
function findNearestEnemyInRange(soldier: Soldier): CombatTarget | undefined {
  const team = getTeam(soldier)
  const position = Transform.get(soldier.entity).position

  return (
    nearestInRange(position, soldiers, (candidate) => candidate.alive && getTeam(candidate) !== team) ??
    nearestInRange(position, workers, (candidate) => candidate.alive && getTeam(candidate) !== team) ??
    nearestInRange(position, buildings, (candidate) => candidate.alive && getTeam(candidate) !== team)
  )
}

function nearestInRange<T extends CombatTarget>(position: { x: number; y: number; z: number }, candidates: T[], isValid: (candidate: T) => boolean): T | undefined {
  let best: T | undefined
  let bestDistance = AUTO_ACQUIRE_RANGE

  for (const candidate of candidates) {
    if (!isValid(candidate)) continue
    const distance = distanceToPoint(position, Transform.get(candidate.entity).position)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }

  return best
}
