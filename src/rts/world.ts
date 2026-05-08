import type { BuildableKind, Building, ResourceNode, Selectable, Soldier, Team, UnitProductionOrder, Worker, WorkerProductionOrder } from './types'

export const selectables = new Map<string, Selectable>()
export const workers: Worker[] = []
export const soldiers: Soldier[] = []
export const resources: ResourceNode[] = []
export const buildings: Building[] = []
export const workerProductionOrders: WorkerProductionOrder[] = []
export const soldierProductionOrders: UnitProductionOrder[] = []

let nextId = 1

export function createEntityId(kind: string): string {
  return `${kind}-${nextId++}`
}

export function resetWorld(): void {
  selectables.clear()
  workers.length = 0
  soldiers.length = 0
  resources.length = 0
  buildings.length = 0
  workerProductionOrders.length = 0
  soldierProductionOrders.length = 0
  nextId = 1
}

export function getTeam(selectable: Selectable): Team {
  return selectable.team ?? 'player'
}

export function getTeamWorkerCount(team: Team): number {
  return workers.filter((worker) => worker.alive && getTeam(worker) === team).length
}

export function getTeamSoldierCount(team: Team): number {
  return soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === team).length
}

export function getAvailableWorkersForTeam(team: Team): Worker[] {
  return workers.filter((worker) => worker.alive && getTeam(worker) === team && worker.state !== 'movingToBuild' && worker.state !== 'constructing' && worker.state !== 'movingToRally')
}

export function getIdleWorkersForTeam(team: Team): Worker[] {
  return workers.filter((worker) => worker.alive && getTeam(worker) === team && worker.state === 'idle')
}

export function getTeamBuildings(team: Team, kind?: BuildableKind): Building[] {
  return buildings.filter((building) => building.alive && getTeam(building) === team && (!kind || building.kind === kind))
}

export function getCompletedTeamBuildings(team: Team, kind: BuildableKind): Building[] {
  return getTeamBuildings(team, kind).filter((building) => building.isComplete)
}
