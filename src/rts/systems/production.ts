import type { Building, Soldier, Team, Worker } from '../types'
import type { Vector3 } from '@dcl/sdk/math'
import { CONFIG, SOLDIER_DEFINITION } from '../config'
import { addSupplyUsed, decrementSoldierQueue, decrementWorkerQueue } from '../economy'
import { gameState } from '../state'
import { getTeamSoldierCount, getTeamWorkerCount, soldierProductionOrders, soldiers, workerProductionOrders, workers } from '../world'

export type ProductionDeps = {
  getBuildingById(id: string): Building | undefined
  createWorker(position: Vector3, team: Team): Worker
  createSoldier(position: Vector3, team: Team): Soldier
  getHomesteadExitPosition(homestead: Building, index: number): Vector3
  getBarracksExitPosition(barracks: Building, index: number): Vector3
  getHomesteadRallyPoint(homesteadId: string): Vector3 | undefined
  getBarracksRallyPoint(barracksId: string): Vector3 | undefined
  sendWorkerToRally(worker: Worker, rallyPoint: Vector3): void
  sendSoldierToRally(soldier: Soldier, rallyPoint: Vector3): void
  setStatus(message: string): void
}

export function updateWorkerProduction(dt: number, deps: ProductionDeps): void {
  for (let i = workerProductionOrders.length - 1; i >= 0; i--) {
    const order = workerProductionOrders[i]
    const homestead = deps.getBuildingById(order.homesteadId)

    if (!homestead?.alive || !homestead.isComplete) {
      workerProductionOrders.splice(i, 1)
      decrementWorkerQueue(order.team)
      if (order.team === 'player') deps.setStatus('Worker production cancelled: Homestead unavailable.')
      continue
    }

    order.timer += dt
    if (order.timer < CONFIG.productionTime) continue

    const worker = deps.createWorker(deps.getHomesteadExitPosition(homestead, getTeamWorkerCount(order.team)), order.team)
    const rallyPoint = deps.getHomesteadRallyPoint(homestead.id)

    workers.push(worker)
    gameState.matchStats[order.team].unitsProduced += 1
    if (rallyPoint) {
      deps.sendWorkerToRally(worker, rallyPoint)
    }
    addSupplyUsed(order.team, 1)
    decrementWorkerQueue(order.team)
    workerProductionOrders.splice(i, 1)
    if (order.team === 'player') deps.setStatus(rallyPoint ? 'Worker ready and moving to Homestead spawn point.' : 'Worker ready outside Homestead.')
  }
}

export function updateSoldierProduction(dt: number, deps: ProductionDeps): void {
  for (let i = soldierProductionOrders.length - 1; i >= 0; i--) {
    const order = soldierProductionOrders[i]
    const barracks = deps.getBuildingById(order.barracksId)

    if (!barracks?.alive || !barracks.isComplete) {
      soldierProductionOrders.splice(i, 1)
      decrementSoldierQueue(order.team)
      if (order.team === 'player') deps.setStatus(`${SOLDIER_DEFINITION.name} production cancelled: Barracks unavailable.`)
      continue
    }

    order.timer += dt
    if (order.timer < SOLDIER_DEFINITION.productionTime) continue

    const soldier = deps.createSoldier(deps.getBarracksExitPosition(barracks, getTeamSoldierCount(order.team)), order.team)
    const rallyPoint = deps.getBarracksRallyPoint(barracks.id)

    soldiers.push(soldier)
    gameState.matchStats[order.team].unitsProduced += 1
    if (rallyPoint) {
      deps.sendSoldierToRally(soldier, rallyPoint)
    }
    addSupplyUsed(order.team, SOLDIER_DEFINITION.supply)
    decrementSoldierQueue(order.team)
    soldierProductionOrders.splice(i, 1)
    if (order.team === 'player') deps.setStatus(rallyPoint ? `${SOLDIER_DEFINITION.name} ready and moving to Barracks spawn point.` : `${SOLDIER_DEFINITION.name} ready outside Barracks.`)
  }
}
