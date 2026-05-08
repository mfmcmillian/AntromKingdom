import { Transform } from '@dcl/sdk/ecs'
import type { Vector3 } from '@dcl/sdk/math'
import { CONFIG } from '../config'
import { addResource, getResourceAmount } from '../economy'
import { distanceToPosition, moveTowardPosition } from '../math'
import { gameState } from '../state'
import type { Building, ResourceNode, Worker } from '../types'
import { getTeam, resources, workers } from '../world'

export type WorkerSystemDeps = {
  getBuildingById(id: string): Building | undefined
  getWorkerGatherPosition(worker: Worker, resource: ResourceNode): Vector3
  getNearestTemple(position: Vector3, team: 'player' | 'enemy'): Building | undefined
  getTempleDropoffPosition(temple: Building, worker: Worker): Vector3
  getBuilderWorkPosition(site: Building, workerPosition: Vector3): Vector3
  getWorkerRallyPosition(worker: Worker): Vector3
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
    updateWorkerRallyMovement(worker, dt, deps)
  }
}

function updateWorkerGathering(worker: Worker, dt: number, deps: WorkerSystemDeps): void {
  const resource = worker.targetResourceId ? resources.find((patch) => patch.id === worker.targetResourceId && patch.alive) : undefined

  if (worker.state === 'movingToResource' && resource) {
    const gatherPosition = deps.getWorkerGatherPosition(worker, resource)
    moveTowardPosition(worker.entity, gatherPosition, CONFIG.workerMoveSpeed, dt)
    if (distanceToPosition(worker.entity, gatherPosition) < 0.35) {
      worker.state = 'gathering'
      worker.timer = 0
      deps.setWorkerAnimation(worker, 'idle')
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
      const deliveredResource = worker.carryingResource ?? 'rocks'
      const deliveredAmount = worker.carrying
      addResource(getTeam(worker), deliveredResource, worker.carrying)
      gameState.matchStats[getTeam(worker)].resourcesGathered += deliveredAmount
      worker.carrying = 0
      worker.carryingResource = undefined
      worker.state = resource?.alive ? 'movingToResource' : 'idle'
      deps.setWorkerAnimation(worker, worker.state === 'idle' ? 'idle' : 'walk')
      if (getTeam(worker) === 'player') deps.setStatus(`${worker.name} delivered ${deliveredResource}. Total: ${getResourceAmount(getTeam(worker), deliveredResource)}.`)
    }
  } else if (!resource && ['movingToResource', 'gathering', 'returning'].includes(worker.state)) {
    worker.state = 'idle'
    worker.targetResourceId = undefined
    worker.carrying = 0
    worker.carryingResource = undefined
    deps.setWorkerAnimation(worker, 'idle')
  }
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
    deps.setWorkerAnimation(worker, 'expression')
    if (getTeam(worker) === 'player') deps.setStatus(`${worker.name} started constructing ${site.name}.`)
  }
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
