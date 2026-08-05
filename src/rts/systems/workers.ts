import { Transform } from '@dcl/sdk/ecs'
import { Quaternion, type Vector3 } from '@dcl/sdk/math'
import { CONFIG } from '../config'
import { addResource, spendResources } from '../economy'
import { distanceToPosition, moveTowardPosition } from '../math'
import { gameState, getGatherMultiplier } from '../state'
import { getRace } from '../races'
import type { Building, ResourceKind, ResourceNode, Soldier, Team, Worker } from '../types'
import { getTeam, resources, workers } from '../world'

/** How far a worker will walk to a replacement deposit when its node runs dry. */
const RESOURCE_REASSIGN_RANGE = 45

type WorkerCombatTarget = Building | Soldier | Worker

export type WorkerSystemDeps = {
  getBuildingById(id: string): Building | undefined
  getWorkerGatherPosition(worker: Worker, resource: ResourceNode): Vector3
  getNearestTemple(position: Vector3, team: Team): Building | undefined
  getTempleDropoffPosition(temple: Building, worker: Worker): Vector3
  getBuilderWorkPosition(site: Building, workerPosition: Vector3): Vector3
  getRepairWorkPosition(site: Building, workerPosition: Vector3): Vector3
  getWorkerRallyPosition(worker: Worker): Vector3
  getCombatTargetById(id: string): WorkerCombatTarget | undefined
  damageCombatTarget(target: WorkerCombatTarget, amount: number, attacker: Worker): void
  setWorkerAnimation(worker: Worker, clipName: string, restart?: boolean): void
  playResourceGatherFeedback(resource: ResourceNode): void
  depleteResourceNode(resource: ResourceNode): void
  updateLabel(selectable: ResourceNode, text: string): void
  setStatus(message: string): void
}

export function updateWorkers(dt: number, deps: WorkerSystemDeps): void {
  for (const worker of workers) {
    if (!worker.alive) continue

    updateWorkerGathering(worker, dt, deps)
    updateWorkerBuildMovement(worker, dt, deps)
    updateWorkerRepairMovement(worker, dt, deps)
    updateWorkerRallyMovement(worker, dt, deps)
    updateWorkerCombat(worker, dt, deps)
  }
}

/**
 * Commanded worker attacks: weak melee jabs, no auto-aggro. Workers chase the
 * target directly and swing at close range, mirroring the soldier chase logic.
 */
function updateWorkerCombat(worker: Worker, dt: number, deps: WorkerSystemDeps): void {
  if ((worker.state !== 'movingToAttack' && worker.state !== 'attacking') || !worker.attackTargetId) return

  const target = deps.getCombatTargetById(worker.attackTargetId)
  if (!target?.alive) {
    worker.state = 'idle'
    worker.attackTargetId = undefined
    deps.setWorkerAnimation(worker, 'idle')
    return
  }

  const targetPosition = Transform.get(target.entity).position
  const range = target.kind === 'soldier' || target.kind === 'worker' ? CONFIG.workerAttackRange : CONFIG.workerAttackRange + 1.6

  if (worker.state === 'movingToAttack') {
    if (distanceToPosition(worker.entity, targetPosition) <= range) {
      worker.state = 'attacking'
      worker.timer = 0
      faceWorkerTarget(worker, targetPosition)
      deps.setWorkerAnimation(worker, 'talk', true)
    } else {
      moveTowardPosition(worker.entity, targetPosition, CONFIG.workerMoveSpeed, dt)
      deps.setWorkerAnimation(worker, 'walk')
    }
    return
  }

  if (distanceToPosition(worker.entity, targetPosition) > range + 0.6) {
    worker.state = 'movingToAttack'
    deps.setWorkerAnimation(worker, 'walk')
    return
  }

  faceWorkerTarget(worker, targetPosition)
  worker.timer += dt
  if (worker.timer >= CONFIG.soldierAttackRate) {
    worker.timer = 0
    deps.setWorkerAnimation(worker, 'talk', true)
    deps.damageCombatTarget(target, CONFIG.workerDamage, worker)
  }
}

function faceWorkerTarget(worker: Worker, targetPosition: Vector3): void {
  const transform = Transform.getMutable(worker.entity)
  const dx = targetPosition.x - transform.position.x
  const dz = targetPosition.z - transform.position.z
  if (dx * dx + dz * dz < 0.0001) return

  transform.rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0)
}

function updateWorkerGathering(worker: Worker, dt: number, deps: WorkerSystemDeps): void {
  const resource = worker.targetResourceId ? resources.find((patch) => patch.id === worker.targetResourceId && patch.alive) : undefined

  if (worker.state === 'movingToResource' && resource) {
    const gatherPosition = deps.getWorkerGatherPosition(worker, resource)
    moveTowardPosition(worker.entity, gatherPosition, CONFIG.workerMoveSpeed, dt)
    if (distanceToPosition(worker.entity, gatherPosition) < 0.35) {
      worker.state = 'gathering'
      worker.timer = 0
      deps.setWorkerAnimation(worker, 'talk')
      deps.playResourceGatherFeedback(resource)
    }
  } else if (worker.state === 'gathering' && resource) {
    worker.timer += dt
    if (worker.timer >= CONFIG.workerMineTime) {
      const gathered = Math.min(CONFIG.workerCarryAmount, resource.amount)
      resource.amount -= gathered
      worker.carrying = gathered
      worker.carryingResource = resource.resource
      worker.state = 'returning'
      worker.timer = 0
      deps.setWorkerAnimation(worker, 'walk')

      if (resource.amount <= 0) {
        deps.depleteResourceNode(resource)
        if (getTeam(worker) === 'player') deps.setStatus(`${resource.name} depleted! Workers will move to nearby deposits.`)
      } else {
        deps.updateLabel(resource, `${resource.name}\n${resource.amount}`)
      }
    }
  } else if (worker.state === 'returning') {
    const temple = deps.getNearestTemple(Transform.get(worker.entity).position, getTeam(worker))
    if (!temple) {
      worker.state = 'idle'
      worker.carrying = 0
      worker.carryingResource = undefined
      deps.setWorkerAnimation(worker, 'idle')
      if (getTeam(worker) === 'player') deps.setStatus(`${worker.name} cannot deliver: no Temple is available.`)
      return
    }

    const dropoffPosition = deps.getTempleDropoffPosition(temple, worker)
    moveTowardPosition(worker.entity, dropoffPosition, CONFIG.workerMoveSpeed, dt)
    if (distanceToPosition(worker.entity, dropoffPosition) < 0.35) {
      const deliveredResource = worker.carryingResource ?? 'minerals'
      const deliveredAmount = Math.round(worker.carrying * getGatherMultiplier(getTeam(worker)))
      addResource(getTeam(worker), deliveredResource, deliveredAmount)
      gameState.matchStats[getTeam(worker)].resourcesGathered += deliveredAmount
      worker.carrying = 0
      worker.carryingResource = undefined
      if (resource?.alive) {
        worker.state = 'movingToResource'
        deps.setWorkerAnimation(worker, 'walk')
      } else if (!resumeGathering(worker, deps)) {
        worker.state = 'idle'
        worker.targetResourceId = undefined
        deps.setWorkerAnimation(worker, 'idle')
      }
      // No status message: deliveries happen constantly and the HUD resource counters already show the income.
    }
  } else if (!resource && ['movingToResource', 'gathering', 'returning'].includes(worker.state)) {
    worker.targetResourceId = undefined
    worker.carrying = 0
    worker.carryingResource = undefined
    if (!resumeGathering(worker, deps)) {
      worker.state = 'idle'
      deps.setWorkerAnimation(worker, 'idle')
    }
  }
}

/**
 * Send the worker back to its remembered deposit, or the nearest live deposit
 * of the same kind if that one is gone. Returns false when nothing is in range.
 */
export function resumeGathering(worker: Worker, deps: WorkerSystemDeps): boolean {
  const remembered = worker.lastResourceId ? resources.find((node) => node.id === worker.lastResourceId && node.alive && node.amount > 0) : undefined
  const target = remembered ?? findNearestResourceOfKind(worker, worker.lastResourceKind)
  if (!target) return false

  worker.state = 'movingToResource'
  worker.targetResourceId = target.id
  worker.lastResourceId = target.id
  worker.lastResourceKind = target.resource
  worker.timer = 0
  deps.setWorkerAnimation(worker, 'walk')
  return true
}

function findNearestResourceOfKind(worker: Worker, kind: ResourceKind | undefined): ResourceNode | undefined {
  if (!kind) return undefined

  let best: ResourceNode | undefined
  let bestDistance = RESOURCE_REASSIGN_RANGE
  for (const node of resources) {
    if (!node.alive || node.amount <= 0 || node.resource !== kind) continue
    const distance = distanceToPosition(worker.entity, Transform.get(node.entity).position)
    if (distance < bestDistance) {
      best = node
      bestDistance = distance
    }
  }
  return best
}

function updateWorkerBuildMovement(worker: Worker, dt: number, deps: WorkerSystemDeps): void {
  if (worker.state !== 'movingToBuild' || !worker.buildSiteId) return

  const site = deps.getBuildingById(worker.buildSiteId)
  if (!site?.alive || site.isComplete) {
    worker.state = 'idle'
    worker.buildSiteId = undefined
    return
  }

  const workPosition = deps.getBuilderWorkPosition(site, Transform.get(worker.entity).position)
  moveTowardPosition(worker.entity, workPosition, CONFIG.builderMoveSpeed, dt)
  if (distanceToPosition(worker.entity, workPosition) <= 0.25) {
    worker.state = 'constructing'
    site.constructionState = 'building'
    deps.setWorkerAnimation(worker, 'talk')
    if (getTeam(worker) === 'player') deps.setStatus(`${worker.name} started constructing ${site.name}.`)
  }
}

function updateWorkerRepairMovement(worker: Worker, dt: number, deps: WorkerSystemDeps): void {
  if ((worker.state !== 'movingToRepair' && worker.state !== 'repairing') || !worker.repairTargetId) return

  const site = deps.getBuildingById(worker.repairTargetId)
  if (!site?.alive || !site.isComplete || site.hp >= site.maxHp) {
    stopRepairing(worker, deps)
    return
  }

  const workPosition = deps.getRepairWorkPosition(site, Transform.get(worker.entity).position)
  if (worker.state === 'movingToRepair') {
    moveTowardPosition(worker.entity, workPosition, CONFIG.builderMoveSpeed, dt)
    if (distanceToPosition(worker.entity, workPosition) <= 0.25) {
      worker.state = 'repairing'
      worker.timer = 0
      deps.setWorkerAnimation(worker, 'talk')
      if (getTeam(worker) === 'player') deps.setStatus(`${worker.name} started repairing ${site.name}.`)
    }
    return
  }

  if (distanceToPosition(worker.entity, workPosition) > 0.8) {
    worker.state = 'movingToRepair'
    deps.setWorkerAnimation(worker, 'walk')
    return
  }

  worker.timer += dt
  if (worker.timer < 1) return
  worker.timer -= 1

  // VANGUARD signature perk: veteran crews repair much faster for the same cost per second.
  const repairRate = CONFIG.repairHpPerSecond * (getRace(getTeam(worker)).id === 'human' ? 1.75 : 1)
  const repairAmount = Math.min(repairRate, site.maxHp - site.hp)
  const repairCost = Math.max(1, Math.ceil((repairAmount / repairRate) * CONFIG.repairMineralCostPerSecond))
  if (!spendResources(getTeam(worker), { minerals: repairCost })) {
    stopRepairing(worker, deps)
    if (getTeam(worker) === 'player') deps.setStatus(`Need crystal to keep repairing ${site.name}.`)
    return
  }

  site.hp = Math.min(site.maxHp, site.hp + repairAmount)
  if (getTeam(worker) === 'player') deps.setStatus(`${worker.name} repairing ${site.name}: ${site.hp}/${site.maxHp} HP.`)
  if (site.hp >= site.maxHp) {
    stopRepairing(worker, deps)
    if (getTeam(worker) === 'player') deps.setStatus(`${site.name} fully repaired.`)
  }
}

function stopRepairing(worker: Worker, deps: WorkerSystemDeps): void {
  worker.repairTargetId = undefined
  worker.timer = 0
  // Back to work: repairs done (or unaffordable), so return to the last deposit.
  if (resumeGathering(worker, deps)) return
  worker.state = 'idle'
  deps.setWorkerAnimation(worker, 'idle')
}

function updateWorkerRallyMovement(worker: Worker, dt: number, deps: WorkerSystemDeps): void {
  if (worker.state !== 'movingToRally') return

  if (!worker.rallyPoint) {
    worker.state = 'idle'
    deps.setWorkerAnimation(worker, 'idle')
    return
  }

  const rallyPosition = deps.getWorkerRallyPosition(worker)
  moveTowardPosition(worker.entity, rallyPosition, CONFIG.workerMoveSpeed, dt)
  if (distanceToPosition(worker.entity, rallyPosition) <= 0.35) {
    worker.state = 'idle'
    worker.rallyPoint = undefined
    deps.setWorkerAnimation(worker, 'idle')
    if (getTeam(worker) === 'player') deps.setStatus(`${worker.name} reached the spawn point.`)
  }
}
