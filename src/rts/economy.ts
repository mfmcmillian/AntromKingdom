import { gameState, resetTeamEconomies } from './state'
import type { ResourceCost, ResourceKind, Team } from './types'
import { clamp } from './math'

export function hasResources(team: Team, cost: ResourceCost): boolean {
  return (cost.minerals ?? 0) <= getResourceAmount(team, 'minerals') && (cost.gas ?? 0) <= getResourceAmount(team, 'gas')
}

export function spendResources(team: Team, cost: ResourceCost): boolean {
  if (!hasResources(team, cost)) return false

  addResource(team, 'minerals', -(cost.minerals ?? 0))
  addResource(team, 'gas', -(cost.gas ?? 0))
  return true
}

export function addResource(team: Team, resource: ResourceKind, amount: number): void {
  gameState.economies[team][resource] += amount
}

export function addResources(team: Team, cost: ResourceCost): void {
  addResource(team, 'minerals', cost.minerals ?? 0)
  addResource(team, 'gas', cost.gas ?? 0)
}

export function getConstructionRefund(cost: ResourceCost, progress: number): ResourceCost {
  const refundMultiplier = 1 - clamp(progress, 0, 1)

  return {
    minerals: Math.floor((cost.minerals ?? 0) * refundMultiplier),
    gas: Math.floor((cost.gas ?? 0) * refundMultiplier)
  }
}

export function getResourceAmount(team: Team, resource: ResourceKind): number {
  return gameState.economies[team][resource]
}

export function getSupplyUsed(team: Team): number {
  return gameState.economies[team].supplyUsed
}

export function getSupplyCap(team: Team): number {
  return gameState.economies[team].supplyCap
}

export function addSupplyUsed(team: Team, amount: number): void {
  gameState.economies[team].supplyUsed += amount
}

export function addSupplyCap(team: Team, amount: number): void {
  gameState.economies[team].supplyCap += amount
}

export function decrementWorkerQueue(team: Team): void {
  const economy = gameState.economies[team]
  economy.workerQueue = Math.max(0, economy.workerQueue - 1)
}

export function decrementSoldierQueue(team: Team): void {
  const economy = gameState.economies[team]
  economy.soldierQueue = Math.max(0, economy.soldierQueue - 1)
}

export function canQueueUnit(team: Team, supply: number): boolean {
  const economy = gameState.economies[team]
  return economy.supplyUsed + economy.workerQueue + economy.soldierQueue + supply <= economy.supplyCap
}

export function resetEconomy(): void {
  resetTeamEconomies()
}
