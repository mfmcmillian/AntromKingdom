import { CONFIG } from './config'
import { gameState } from './state'
import type { ResourceCost, ResourceKind, Team } from './types'
import { clamp } from './math'

export function hasResources(team: Team, cost: ResourceCost): boolean {
  return (cost.rocks ?? 0) <= getResourceAmount(team, 'rocks') && (cost.wood ?? 0) <= getResourceAmount(team, 'wood') && (cost.meat ?? 0) <= getResourceAmount(team, 'meat')
}

export function spendResources(team: Team, cost: ResourceCost): boolean {
  if (!hasResources(team, cost)) return false

  addResource(team, 'rocks', -(cost.rocks ?? 0))
  addResource(team, 'wood', -(cost.wood ?? 0))
  addResource(team, 'meat', -(cost.meat ?? 0))
  return true
}

export function addResource(team: Team, resource: ResourceKind, amount: number): void {
  if (resource === 'rocks') {
    if (team === 'enemy') gameState.enemyRocks += amount
    else gameState.rocks += amount
    return
  }

  if (resource === 'wood') {
    if (team === 'enemy') gameState.enemyWood += amount
    else gameState.wood += amount
    return
  }

  if (team === 'enemy') gameState.enemyMeat += amount
  else gameState.meat += amount
}

export function addResources(team: Team, cost: ResourceCost): void {
  addResource(team, 'rocks', cost.rocks ?? 0)
  addResource(team, 'wood', cost.wood ?? 0)
  addResource(team, 'meat', cost.meat ?? 0)
}

export function getConstructionRefund(cost: ResourceCost, progress: number): ResourceCost {
  const refundMultiplier = 1 - clamp(progress, 0, 1)

  return {
    rocks: Math.floor((cost.rocks ?? 0) * refundMultiplier),
    wood: Math.floor((cost.wood ?? 0) * refundMultiplier),
    meat: Math.floor((cost.meat ?? 0) * refundMultiplier)
  }
}

export function getResourceAmount(team: Team, resource: ResourceKind): number {
  if (resource === 'rocks') return team === 'enemy' ? gameState.enemyRocks : gameState.rocks
  if (resource === 'wood') return team === 'enemy' ? gameState.enemyWood : gameState.wood
  return team === 'enemy' ? gameState.enemyMeat : gameState.meat
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
  gameState.rocks = CONFIG.rocksStart
  gameState.wood = CONFIG.woodStart
  gameState.meat = CONFIG.meatStart
  gameState.supplyUsed = 0
  gameState.supplyCap = CONFIG.startSupplyCap
  gameState.enemyRocks = CONFIG.rocksStart
  gameState.enemyWood = CONFIG.woodStart
  gameState.enemyMeat = CONFIG.meatStart
  gameState.enemySupplyUsed = 0
  gameState.enemySupplyCap = CONFIG.startSupplyCap
  gameState.enemyWorkerQueue = 0
  gameState.enemySoldierQueue = 0
}
