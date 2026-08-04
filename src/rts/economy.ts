import { CONFIG } from './config'
import { gameState } from './state'
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
  if (resource === 'minerals') {
    if (team === 'enemy') gameState.enemyMinerals += amount
    else gameState.minerals += amount
    return
  }

  if (team === 'enemy') gameState.enemyGas += amount
  else gameState.gas += amount
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
  if (resource === 'minerals') return team === 'enemy' ? gameState.enemyMinerals : gameState.minerals
  return team === 'enemy' ? gameState.enemyGas : gameState.gas
}

export function getSupplyUsed(team: Team): number {
  return team === 'enemy' ? gameState.enemySupplyUsed : gameState.supplyUsed
}

export function getSupplyCap(team: Team): number {
  return team === 'enemy' ? gameState.enemySupplyCap : gameState.supplyCap
}

export function addSupplyUsed(team: Team, amount: number): void {
  if (team === 'enemy') gameState.enemySupplyUsed += amount
  else gameState.supplyUsed += amount
}

export function addSupplyCap(team: Team, amount: number): void {
  if (team === 'enemy') gameState.enemySupplyCap += amount
  else gameState.supplyCap += amount
}

export function decrementWorkerQueue(team: Team): void {
  if (team === 'enemy') gameState.enemyWorkerQueue = Math.max(0, gameState.enemyWorkerQueue - 1)
  else gameState.workerQueue = Math.max(0, gameState.workerQueue - 1)
}

export function decrementSoldierQueue(team: Team): void {
  if (team === 'enemy') gameState.enemySoldierQueue = Math.max(0, gameState.enemySoldierQueue - 1)
  else gameState.soldierQueue = Math.max(0, gameState.soldierQueue - 1)
}

export function canQueueUnit(team: Team, supply: number): boolean {
  const queuedSupply = team === 'enemy' ? gameState.enemyWorkerQueue + gameState.enemySoldierQueue : gameState.workerQueue + gameState.soldierQueue
  return getSupplyUsed(team) + queuedSupply + supply <= getSupplyCap(team)
}

export function resetEconomy(): void {
  gameState.minerals = CONFIG.mineralsStart
  gameState.gas = CONFIG.gasStart
  gameState.supplyUsed = 0
  gameState.supplyCap = CONFIG.startSupplyCap
  gameState.enemyMinerals = CONFIG.mineralsStart
  gameState.enemyGas = CONFIG.gasStart
  gameState.enemySupplyUsed = 0
  gameState.enemySupplyCap = CONFIG.startSupplyCap
  gameState.enemyWorkerQueue = 0
  gameState.enemySoldierQueue = 0
}
