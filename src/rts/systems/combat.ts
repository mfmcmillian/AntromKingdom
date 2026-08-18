import { Transform } from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { BUILDING_DEFINITIONS } from '../config'
import { distanceToPoint, distanceToPosition, moveTowardPosition } from '../math'
import { isAirVariant } from '../races'
import { getSpeedMultiplier } from '../upgrades'
import type { BuildableKind, Building, Soldier, Worker } from '../types'
import { areHostile } from '../state'
import { buildings, canAttackTarget, getTeam, soldiers, workers } from '../world'

type CombatTarget = Building | Soldier | Worker

/** Idle combat units engage anything hostile that wanders inside this radius. */
const AUTO_ACQUIRE_RANGE = 12
/** Buildings are spotted from farther out (their center sits deep inside a big
 * footprint), so an army parked in an enemy base razes it without hand-holding. */
const BUILDING_ACQUIRE_RANGE = 18
const AUTO_ACQUIRE_INTERVAL = 0.5
/** Defensive units abandon an auto-acquired chase once this far from their guard point. */
const DEFENSIVE_LEASH_RANGE = 15

let autoAcquireTimer = 0

export type CombatSystemDeps = {
  getCombatTargetById(id: string): CombatTarget | undefined
  setSoldierAnimation(soldier: Soldier, clipName: string, restart?: boolean): void
  damageCombatTarget(target: CombatTarget, amount: number, attacker: Soldier): void
  assignSoldierToAttack(soldier: Soldier, target: CombatTarget, slot?: number, announce?: boolean): void
  setStatus(message: string): void
  onReachedDestination?(soldier: Soldier): void
}

export function updateSoldiers(dt: number, deps: CombatSystemDeps): void {
  autoAcquireTimer += dt
  const scanForTargets = autoAcquireTimer >= AUTO_ACQUIRE_INTERVAL
  if (scanForTargets) autoAcquireTimer = 0

  for (const soldier of soldiers) {
    if (!soldier.alive) continue

    // Riding inside a transport: parked off-map, takes no part in combat.
    if (soldier.inTransportId) continue

    // Weapon cooldown recharges continuously while walking,
    // chasing, or standing idle all count. Without this, every re-chase reset
    // the timer and units visibly shuffled several times before the first hit.
    if (soldier.attackTimer < soldier.attackRate) soldier.attackTimer += dt

    // Mid siege-transform: the unit is locked down until the cannon finishes
    // growing or retracting (the timer itself ticks in the siege system).
    if ((soldier.siegeTransition ?? 0) > 0) continue

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
      // Hold: weapon range only. Aggressive: hunt farther. Defensive: standard scan.
      const acquireRange = holdsGround(soldier) ? soldier.attackRange : soldier.stance === 'aggressive' ? AUTO_ACQUIRE_RANGE + 6 : AUTO_ACQUIRE_RANGE
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
  if (soldier.stance === 'aggressive') {
    const next = findNearestEnemyInRange(soldier, AUTO_ACQUIRE_RANGE + 10)
    if (next) {
      autoEngage(soldier, next, deps)
      return
    }
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

  moveTowardPosition(soldier.entity, soldier.attackMovePoint, getUpgradedMoveSpeed(soldier), dt, isAirVariant(soldier.variant))
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
  moveTowardPosition(soldier.entity, waypoint, getUpgradedMoveSpeed(soldier), dt, isAirVariant(soldier.variant))
  deps.setSoldierAnimation(soldier, 'walk')
  if (distanceToPosition(soldier.entity, waypoint) <= 0.35) {
    soldier.patrolToB = !soldier.patrolToB
  }
}

function clonePosition(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: position.x, y: position.y, z: position.z }
}

/**
 * Distance at which the target counts as "in range": weapon range, plus the
 * target building's footprint radius since building distance is measured to
 * its center but shots land on its walls.
 */
function getEngageRange(soldier: Soldier, target: CombatTarget): number {
  if (isUnitTarget(target)) return soldier.attackRange
  const definition = BUILDING_DEFINITIONS[target.kind as BuildableKind]
  const footprint = definition ? Math.max(definition.scale.x, definition.scale.z) / 2 : 2.5
  return soldier.attackRange + footprint
}

/**
 * All targets are approached head-on and fired on the moment they are in
 * range - no precomputed standoff point. Unit standoffs used to make ranged
 * units orbit as the point slid around, and building ring slots marched
 * attackers around (or past) the structure instead of shooting from where
 * they stood. Rule: stop where you are the moment you can hit.
 */
function updateMovingToAttack(soldier: Soldier, target: CombatTarget, dt: number, deps: CombatSystemDeps): void {
  const targetPosition = Transform.get(target.entity).position
  const engageRange = getEngageRange(soldier, target)

  // Hold-stance and dug-in siege units never leave their spot: fire if in range, otherwise drop the target.
  if (holdsGround(soldier)) {
    if (distanceToPosition(soldier.entity, targetPosition) <= engageRange) {
      startAttacking(soldier, deps)
      faceTarget(soldier, targetPosition)
    } else {
      soldier.targetId = undefined
      soldier.attackPosition = undefined
      soldier.state = 'idle'
      deps.setSoldierAnimation(soldier, 'idle')
    }
    return
  }

  // Defensive units break off auto-acquired chases that stray too far from their post.
  if (isUnitTarget(target) && soldier.autoEngaged && soldier.stance === 'defensive' && soldier.guardPoint && !soldier.attackMovePoint) {
    if (distanceToPosition(soldier.entity, soldier.guardPoint) > DEFENSIVE_LEASH_RANGE) {
      soldier.targetId = undefined
      soldier.attackPosition = undefined
      soldier.state = 'movingToRally'
      soldier.rallyPoint = clonePosition(soldier.guardPoint)
      deps.setSoldierAnimation(soldier, 'walk')
      return
    }
  }

  if (distanceToPosition(soldier.entity, targetPosition) <= engageRange) {
    startAttacking(soldier, deps)
    faceTarget(soldier, targetPosition)
  } else {
    moveTowardPosition(soldier.entity, targetPosition, getUpgradedMoveSpeed(soldier), dt, isAirVariant(soldier.variant))
    deps.setSoldierAnimation(soldier, 'walk')
  }
}

function updateAttacking(soldier: Soldier, target: CombatTarget, dt: number, deps: CombatSystemDeps): void {
  const targetPosition = Transform.get(target.entity).position
  // Re-chase with a small hysteresis buffer so units don't stutter on the
  // range edge (buildings don't move, but separation shoves attackers around).
  if (distanceToPosition(soldier.entity, targetPosition) > getEngageRange(soldier, target) + 0.6) {
    if (holdsGround(soldier)) {
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
  if (isUnitTarget(target)) faceTarget(soldier, targetPosition)

  // Cooldown ticks globally (see updateSoldiers); a unit arriving with a
  // charged weapon fires the moment it's in range.
  if (soldier.attackTimer >= soldier.attackRate) {
    soldier.attackTimer = 0
    deps.setSoldierAnimation(soldier, 'attack', true)
    deps.damageCombatTarget(target, soldier.damage, soldier)
  }
}

/** Hold-stance fighters and dug-in siege guns stand their ground: fire in range, never chase. */
function holdsGround(soldier: Soldier): boolean {
  return soldier.stance === 'hold' || soldier.sieged === true
}

/** Propulsion research speeds up the matching fighters (ground or air); Time Fracture halves it, Obelisk haste boosts it. */
function getUpgradedMoveSpeed(soldier: Soldier): number {
  // Dug-in siege guns are bolted to the ground until they transform back.
  if (soldier.sieged) return 0
  const slowFactor = (soldier.slowRemaining ?? 0) > 0 ? 0.5 : 1
  const hasteFactor = (soldier.hasteRemaining ?? 0) > 0 ? 1.25 : 1
  return soldier.moveSpeed * getSpeedMultiplier(getTeam(soldier), soldier.variant) * slowFactor * hasteFactor
}

function startAttacking(soldier: Soldier, deps: CombatSystemDeps): void {
  // Deliberately keeps attackTimer: the cooldown carried over from the approach
  // decides how soon the first hit lands (usually instantly).
  soldier.state = 'attacking'
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

  moveTowardPosition(soldier.entity, soldier.rallyPoint, getUpgradedMoveSpeed(soldier), dt, isAirVariant(soldier.variant))
  if (distanceToPosition(soldier.entity, soldier.rallyPoint) <= 0.35) {
    soldier.state = 'idle'
    soldier.guardPoint = clonePosition(soldier.rallyPoint)
    soldier.rallyPoint = undefined
    soldier.attackPosition = undefined
    deps.setSoldierAnimation(soldier, 'idle')
    deps.setStatus(`${soldier.name} reached destination.`)
    deps.onReachedDestination?.(soldier)
  }
}

/** Nearest hostile within acquisition range: enemy fighters first, then workers, then buildings. */
function findNearestEnemyInRange(soldier: Soldier, range: number): CombatTarget | undefined {
  // Healers never engage (their own system chases wounded allies) and
  // transports are unarmed haulers.
  if (soldier.variant === 'healer' || soldier.variant === 'transport') return undefined
  const team = getTeam(soldier)
  const position = Transform.get(soldier.entity).position

  // Hold-stance / dug-in units only ever fire at what's in weapon range; everyone
  // else spots buildings from farther out so idle armies keep razing the base.
  const buildingRange = holdsGround(soldier) ? range : Math.max(range, BUILDING_ACQUIRE_RANGE)

  return (
    // Melee scanners skip flyers they could never reach instead of chasing them,
    // and anti-air troopers ignore everything on the ground entirely.
    nearestInRange(position, soldiers, range, (candidate) => candidate.alive && areHostile(getTeam(candidate), team) && canAttackTarget(soldier, candidate)) ??
    nearestInRange(position, workers, range, (candidate) => candidate.alive && areHostile(getTeam(candidate), team) && canAttackTarget(soldier, candidate)) ??
    nearestInRange(position, buildings, buildingRange, (candidate) => candidate.alive && areHostile(getTeam(candidate), team) && canAttackTarget(soldier, candidate))
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
