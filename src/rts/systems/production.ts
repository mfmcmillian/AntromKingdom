import type { Building, Soldier, SoldierVariant, Team, Worker } from '../types'
import type { Vector3 } from '@dcl/sdk/math'
import { addResources, addSupplyUsed, decrementSoldierQueue, decrementWorkerQueue } from '../economy'
import { getBuildingDisplayName, getSoldierDefinition, getWorkerDefinition } from '../races'
import { playComplete, playUnitReady } from '../sound'
import { gameState } from '../state'
import { getTeamSoldierCount, getTeamWorkerCount, soldierProductionOrders, soldiers, workerProductionOrders, workers } from '../world'

export type ProductionDeps = {
  getBuildingById(id: string): Building | undefined
  createWorker(position: Vector3, team: Team): Worker
  createSoldier(position: Vector3, team: Team, variant: SoldierVariant): Soldier
  getTempleExitPosition(temple: Building, index: number): Vector3
  getBarracksExitPosition(barracks: Building, index: number): Vector3
  getTempleRallyPoint(templeId: string): Vector3 | undefined
  getBarracksRallyPoint(barracksId: string): Vector3 | undefined
  sendWorkerToRally(worker: Worker, rallyPoint: Vector3): void
  sendSoldierToRally(soldier: Soldier, rallyPoint: Vector3): void
  /** No rally set: send the new worker to the nearest crystal line. */
  assignIdleWorkerToMinerals(worker: Worker): boolean
  setStatus(message: string): void
}

export function updateWorkerProduction(dt: number, deps: ProductionDeps): void {
  const activeOrders = getActiveWorkerOrderIndexes()

  for (let i = workerProductionOrders.length - 1; i >= 0; i--) {
    const order = workerProductionOrders[i]
    const temple = deps.getBuildingById(order.templeId)

    if (!temple?.alive || !temple.isComplete) {
      workerProductionOrders.splice(i, 1)
      decrementWorkerQueue(order.team)
      // The building died with the order unfinished: give the resources back.
      addResources(order.team, getWorkerDefinition(order.team).cost)
      if (order.team === 'player') deps.setStatus(`${getWorkerDefinition('player').name} production cancelled: ${getBuildingDisplayName('temple', 'player')} unavailable. Cost refunded.`)
      continue
    }

    if (!activeOrders.has(i)) {
      order.timer = 0
      continue
    }

    order.timer += dt
    if (order.timer < order.productionTime) continue

    const worker = deps.createWorker(deps.getTempleExitPosition(temple, getTeamWorkerCount(order.team)), order.team)
    const rallyPoint = deps.getTempleRallyPoint(temple.id)

    workers.push(worker)
    gameState.matchStats[order.team].unitsProduced += 1
    const gathering = !rallyPoint && deps.assignIdleWorkerToMinerals(worker)
    if (rallyPoint) {
      deps.sendWorkerToRally(worker, rallyPoint)
    }
    addSupplyUsed(order.team, 1)
    decrementWorkerQueue(order.team)
    workerProductionOrders.splice(i, 1)
    if (order.team === 'player') {
      const workerName = getWorkerDefinition('player').name
      const templeName = getBuildingDisplayName('temple', 'player')
      playComplete()
      playUnitReady('worker')
      deps.setStatus(
        rallyPoint
          ? `${workerName} ready and moving to the ${templeName} spawn point.`
          : gathering
            ? `${workerName} ready and gathering crystal.`
            : `${workerName} ready outside the ${templeName}.`
      )
    }
  }
}

export function updateSoldierProduction(dt: number, deps: ProductionDeps): void {
  const activeOrders = getActiveSoldierOrderIndexes()

  for (let i = soldierProductionOrders.length - 1; i >= 0; i--) {
    const order = soldierProductionOrders[i]
    const barracks = deps.getBuildingById(order.barracksId)

    if (!barracks?.alive || !barracks.isComplete) {
      soldierProductionOrders.splice(i, 1)
      decrementSoldierQueue(order.team)
      // The building died with the order unfinished: give the resources back.
      addResources(order.team, getSoldierDefinition(order.team, order.variant).cost)
      if (order.team === 'player') deps.setStatus(`${getSoldierDefinition('player', order.variant).name} production cancelled: production building unavailable. Cost refunded.`)
      continue
    }

    if (!activeOrders.has(i)) {
      order.timer = 0
      continue
    }

    order.timer += dt
    if (order.timer < order.productionTime) continue

    const soldier = deps.createSoldier(deps.getBarracksExitPosition(barracks, getTeamSoldierCount(order.team)), order.team, order.variant)
    const rallyPoint = deps.getBarracksRallyPoint(barracks.id)

    soldiers.push(soldier)
    gameState.matchStats[order.team].unitsProduced += 1
    if (rallyPoint) {
      deps.sendSoldierToRally(soldier, rallyPoint)
    }
    addSupplyUsed(order.team, getSoldierDefinition(order.team, order.variant).supply)
    decrementSoldierQueue(order.team)
    soldierProductionOrders.splice(i, 1)
    if (order.team === 'player') {
      const soldierName = getSoldierDefinition('player', order.variant).name
      playComplete()
      playUnitReady(order.variant)
      deps.setStatus(rallyPoint ? `${soldierName} ready and moving to the spawn point.` : `${soldierName} ready outside the ${barracks.name}.`)
    }
  }
}

function getActiveWorkerOrderIndexes(): Set<number> {
  const activeBuildings = new Set<string>()
  const activeOrders = new Set<number>()

  for (let i = 0; i < workerProductionOrders.length; i++) {
    const buildingId = workerProductionOrders[i].templeId
    if (activeBuildings.has(buildingId)) continue

    activeBuildings.add(buildingId)
    activeOrders.add(i)
  }

  return activeOrders
}

function getActiveSoldierOrderIndexes(): Set<number> {
  const activeBuildings = new Set<string>()
  const activeOrders = new Set<number>()

  for (let i = 0; i < soldierProductionOrders.length; i++) {
    const buildingId = soldierProductionOrders[i].barracksId
    if (activeBuildings.has(buildingId)) continue

    activeBuildings.add(buildingId)
    activeOrders.add(i)
  }

  return activeOrders
}
