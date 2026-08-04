import { CONFIG } from '../config'
import { distanceToPosition, moveTowardPosition } from '../math'
import type { Building, Soldier, Worker } from '../types'
import { soldiers } from '../world'

type CombatTarget = Building | Soldier | Worker

export type CombatSystemDeps = {
  getCombatTargetById(id: string): CombatTarget | undefined
  getSoldierAttackPosition(target: Building, slot: number): { x: number; y: number; z: number }
  getUnitAttackPosition(target: Soldier | Worker, attacker: Soldier): { x: number; y: number; z: number }
  setSoldierAnimation(soldier: Soldier, clipName: string, restart?: boolean): void
  damageCombatTarget(target: CombatTarget, amount: number, attacker: Soldier): void
  setStatus(message: string): void
}

export function updateSoldiers(dt: number, deps: CombatSystemDeps): void {
  for (const soldier of soldiers) {
    if (!soldier.alive) continue

    if (soldier.state === 'movingToRally') {
      updateSoldierRallyMovement(soldier, dt, deps)
      continue
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
      moveTowardPosition(soldier.entity, attackPosition, CONFIG.soldierMoveSpeed, dt)
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
        deps.damageCombatTarget(target, CONFIG.soldierDamage, soldier)
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

  moveTowardPosition(soldier.entity, soldier.rallyPoint, CONFIG.soldierMoveSpeed, dt)
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

  return soldier.attackPosition ?? deps.getSoldierAttackPosition(target, 0)
}
