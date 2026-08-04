import { Transform } from '@dcl/sdk/ecs'
import { CONFIG } from '../config'
import { distanceToPoint, distanceToPosition, moveTowardPosition } from '../math'
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
  getUnitAttackPosition(target: Soldier | Worker, attacker: Soldier): { x: number; y: number; z: number }
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
      const attackPosition = getAttackPosition(soldier, target, deps)
      soldier.attackPosition = attackPosition
      moveTowardPosition(soldier.entity, attackPosition, soldier.moveSpeed, dt)
      deps.setSoldierAnimation(soldier, 'walk')
      if (distanceToPosition(soldier.entity, attackPosition) <= 0.25) {
        soldier.state = 'attacking'
        soldier.attackTimer = 0
        deps.setSoldierAnimation(soldier, 'attack', true)
      }
    } else if (soldier.state === 'attacking') {
      soldier.attackTimer += dt
      if (soldier.attackTimer >= CONFIG.soldierAttackRate) {
        soldier.attackTimer = 0
        deps.setSoldierAnimation(soldier, 'attack', true)
        deps.damageCombatTarget(target, soldier.damage, soldier)
      }
    }
  }
}

function updateSoldierRallyMovement(soldier: Soldier, dt: number, deps: CombatSystemDeps): void {
  if (!soldier.rallyPoint) {
    soldier.state = 'idle'
    soldier.attackPosition = undefined
    deps.setSoldierAnimation(soldier, 'idle')
    return
  }

  moveTowardPosition(soldier.entity, soldier.rallyPoint, soldier.moveSpeed, dt)
  if (distanceToPosition(soldier.entity, soldier.rallyPoint) <= 0.35) {
    soldier.state = 'idle'
    soldier.rallyPoint = undefined
    soldier.attackPosition = undefined
    deps.setSoldierAnimation(soldier, 'idle')
    deps.setStatus(`${soldier.name} reached destination.`)
  }
}

function getAttackPosition(soldier: Soldier, target: CombatTarget, deps: CombatSystemDeps): { x: number; y: number; z: number } {
  if (target.kind === 'soldier' || target.kind === 'worker') {
    return deps.getUnitAttackPosition(target, soldier)
  }

  return soldier.attackPosition ?? deps.getSoldierAttackPosition(target, 0, soldier)
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
