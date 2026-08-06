import { Transform } from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { distanceToPoint, distanceToPosition, moveTowardPosition } from '../math'
import { getSpeedMultiplier } from '../upgrades'
import type { Building, Soldier, Worker } from '../types'
import { areHostile } from '../state'
import { buildings, canAttackTarget, getTeam, soldiers, workers } from '../world'

type CombatTarget = Building | Soldier | Worker

/** Idle combat units engage anything hostile that wanders inside this radius. */
const AUTO_ACQUIRE_RANGE = 12
const AUTO_ACQUIRE_INTERVAL = 0.5
/** Defensive units abandon an auto-acquired chase once this far from their guard point. */
const DEFENSIVE_LEASH_RANGE = 15

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

    if (soldier.state === 'attackMoving') {
      updateAttackMove(soldier, dt, scanForTargets, deps)
      continue
    }

    if (soldier.state === 'patrolling') {
      updatePatrol(soldier, dt, scanForTargets, deps)
      continue
    }

    if (scanForTargets && soldier.state === 'idle') {
      // Hold-stance units only fire at what is already in weapon range; others scan wider and chase.
      const acquireRange = soldier.stance === 'hold' ? soldier.attackRange : AUTO_ACQUIRE_RANGE
      const target = findNearestEnemyInRange(soldier, acquireRange)
      if (target) autoEngage(soldier, target, deps)
    }

    if (!soldier.targetId) continue

    const target = deps.getCombatTargetById(soldier.targetId)

    if (!target?.alive) {
      finishEngagement(soldier, deps)
      continue
    }

    if (soldier.state === 'movingToAttack') {
      updateMovingToAttack(soldier, target, dt, deps)
    } else if (soldier.state === 'attacking') {
      updateAttacking(soldier, target, dt, deps)
    }
  }
}

/** Assign a target found by the auto-scan, preserving the standing orders (attack-move / patrol) and marking it leashable. */
function autoEngage(soldier: Soldier, target: CombatTarget, deps: CombatSystemDeps): void {
  const destination = soldier.attackMovePoint
  const patrolA = soldier.patrolPointA
  const patrolB = soldier.patrolPointB
  const patrolToB = soldier.patrolToB
  if (!soldier.guardPoint) soldier.guardPoint = clonePosition(Transform.get(soldier.entity).position)
  deps.assignSoldierToAttack(soldier, target, 0, false)
  soldier.attackMovePoint = destination
  soldier.patrolPointA = patrolA
  soldier.patrolPointB = patrolB
  soldier.patrolToB = patrolToB
  soldier.autoEngaged = true
}

/** Target destroyed: resume the attack-move march or patrol route if one is pending, otherwise stand guard here. */
function finishEngagement(soldier: Soldier, deps: CombatSystemDeps): void {
  soldier.targetId = undefined
  soldier.attackPosition = undefined
  if (soldier.attackMovePoint) {
    soldier.state = 'attackMoving'
    deps.setSoldierAnimation(soldier, 'walk')
    return
  }
  if (soldier.patrolPointA && soldier.patrolPointB) {
    soldier.state = 'patrolling'
    deps.setSoldierAnimation(soldier, 'walk')
    return
  }
  soldier.state = 'idle'
  soldier.guardPoint = clonePosition(Transform.get(soldier.entity).position)
  deps.setSoldierAnimation(soldier, 'idle')
}

/** March toward the ordered point, engaging any hostile spotted along the way. */
function updateAttackMove(soldier: Soldier, dt: number, scanForTargets: boolean, deps: CombatSystemDeps): void {
  if (!soldier.attackMovePoint) {
    soldier.state = 'idle'
    deps.setSoldierAnimation(soldier, 'idle')
    return
  }

  if (scanForTargets) {
    const target = findNearestEnemyInRange(soldier, AUTO_ACQUIRE_RANGE)
    if (target) {
      autoEngage(soldier, target, deps)
      return
    }
  }

  moveTowardPosition(soldier.entity, soldier.attackMovePoint, getUpgradedMoveSpeed(soldier), dt)
  deps.setSoldierAnimation(soldier, 'walk')
  if (distanceToPosition(soldier.entity, soldier.attackMovePoint) <= 0.35) {
    soldier.state = 'idle'
    soldier.guardPoint = clonePosition(soldier.attackMovePoint)
    soldier.attackMovePoint = undefined
    deps.setSoldierAnimation(soldier, 'idle')
  }
}

/** Walk the patrol route, flipping direction at each endpoint, engaging anything spotted. */
function updatePatrol(soldier: Soldier, dt: number, scanForTargets: boolean, deps: CombatSystemDeps): void {
  if (!soldier.patrolPointA || !soldier.patrolPointB) {
    soldier.state = 'idle'
    deps.setSoldierAnimation(soldier, 'idle')
    return
  }

  if (scanForTargets) {
    const target = findNearestEnemyInRange(soldier, AUTO_ACQUIRE_RANGE)
    if (target) {
      autoEngage(soldier, target, deps)
      return
    }
  }

  const waypoint = soldier.patrolToB ? soldier.patrolPointB : soldier.patrolPointA
  moveTowardPosition(soldier.entity, waypoint, getUpgradedMoveSpeed(soldier), dt)
  deps.setSoldierAnimation(soldier, 'walk')
  if (distanceToPosition(soldier.entity, waypoint) <= 0.35) {
    soldier.patrolToB = !soldier.patrolToB
  }
}

function clonePosition(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: position.x, y: position.y, z: position.z }
}

/**
 * Unit targets are chased directly and fired on the moment they are in range -
 * no precomputed standoff point, which previously made ranged units orbit their
 * target as the point slid around them. Buildings keep a fixed approach-side spot.
 */
function updateMovingToAttack(soldier: Soldier, target: CombatTarget, dt: number, deps: CombatSystemDeps): void {
  // Hold-stance units never leave their spot: fire if in range, otherwise drop the target.
  if (soldier.stance === 'hold') {
    if (distanceToPosition(soldier.entity, Transform.get(target.entity).position) <= soldier.attackRange) {
      startAttacking(soldier, deps)
      faceTarget(soldier, Transform.get(target.entity).position)
    } else {
      soldier.targetId = undefined
      soldier.attackPosition = undefined
      soldier.state = 'idle'
      deps.setSoldierAnimation(soldier, 'idle')
    }
    return
  }

  if (isUnitTarget(target)) {
    const targetPosition = Transform.get(target.entity).position

    // Defensive units break off auto-acquired chases that stray too far from their post.
    if (soldier.autoEngaged && soldier.stance === 'defensive' && soldier.guardPoint && !soldier.attackMovePoint) {
      if (distanceToPosition(soldier.entity, soldier.guardPoint) > DEFENSIVE_LEASH_RANGE) {
        soldier.targetId = undefined
        soldier.attackPosition = undefined
        soldier.state = 'movingToRally'
        soldier.rallyPoint = clonePosition(soldier.guardPoint)
        deps.setSoldierAnimation(soldier, 'walk')
        return
      }
    }

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
      if (soldier.stance === 'hold') {
        soldier.targetId = undefined
        soldier.attackPosition = undefined
        soldier.state = 'idle'
        deps.setSoldierAnimation(soldier, 'idle')
        return
      }
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

/** Propulsion research speeds up every fighter on the team; Time Fracture halves it. */
function getUpgradedMoveSpeed(soldier: Soldier): number {
  const slowFactor = (soldier.slowRemaining ?? 0) > 0 ? 0.5 : 1
  return soldier.moveSpeed * getSpeedMultiplier(getTeam(soldier)) * slowFactor
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
    soldier.guardPoint = clonePosition(soldier.rallyPoint)
    soldier.rallyPoint = undefined
    soldier.attackPosition = undefined
    deps.setSoldierAnimation(soldier, 'idle')
    deps.setStatus(`${soldier.name} reached destination.`)
  }
}

/** Nearest hostile within acquisition range: enemy fighters first, then workers, then buildings. */
function findNearestEnemyInRange(soldier: Soldier, range: number): CombatTarget | undefined {
  const team = getTeam(soldier)
  const position = Transform.get(soldier.entity).position

  return (
    // Melee scanners skip flyers they could never reach instead of chasing them.
    nearestInRange(position, soldiers, range, (candidate) => candidate.alive && areHostile(getTeam(candidate), team) && canAttackTarget(soldier, candidate)) ??
    nearestInRange(position, workers, range, (candidate) => candidate.alive && areHostile(getTeam(candidate), team)) ??
    nearestInRange(position, buildings, range, (candidate) => candidate.alive && areHostile(getTeam(candidate), team))
  )
}

function nearestInRange<T extends CombatTarget>(position: { x: number; y: number; z: number }, candidates: T[], range: number, isValid: (candidate: T) => boolean): T | undefined {
  let best: T | undefined
  let bestDistance = range

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
