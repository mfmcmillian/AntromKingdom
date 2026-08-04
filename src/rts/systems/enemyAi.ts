import { Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { AI_DIFFICULTY, BUILDING_DEFINITIONS, ENEMY_SEATS, type DifficultySettings } from '../config'
import { canQueueUnit, getResourceAmount, getSupplyCap, getSupplyUsed, hasResources, spendResources } from '../economy'
import { distanceToPoint } from '../math'
import { getSoldierDefinition, getWorkerDefinition } from '../races'
import { gameState } from '../state'
import { getNextUpgradeCost, getUpgradeLevel, isUpgradeInProgress, startUpgradeResearchOrder } from '../upgrades'
import type { BuildableKind, Building, Difficulty, EnemyTeam, ResourceKind, ResourceNode, Soldier, SoldierVariant, Team, UpgradeKind, Worker } from '../types'
import {
  getAvailableWorkersForTeam,
  getCompletedTeamBuildings,
  getIdleWorkersForTeam,
  getTeam,
  getTeamBuildings,
  getTeamSoldierCount,
  getTeamWorkerCount,
  resources,
  soldierProductionOrders,
  soldiers,
  workerProductionOrders,
  workers
} from '../world'

export type EnemyAiDeps = {
  assignWorkerToResource(worker: Worker, resource: ResourceNode, announce?: boolean): void
  createConstructionSite(kind: BuildableKind, position: Vector3, builderWorkerId: string, rotationY: number, team: Team): Building
  canPlaceBuildingAt(definition: (typeof BUILDING_DEFINITIONS)[BuildableKind], position: Vector3): boolean
  setWorkerAnimation(worker: Worker, clipName: string, restart?: boolean): void
  assignSoldierToAttack(soldier: Soldier, target: Building | Soldier | Worker, slot?: number): void
  getNearestTemple(position: Vector3, team: Team): Building | undefined
  getSnappedPlacementPosition(position: Vector3): Vector3
  setStatus(message: string): void
}

/** One computer opponent's brain: its own timers, seat, and difficulty tuning. */
export type EnemyAi = {
  team: EnemyTeam
  difficulty: Difficulty
  settings: DifficultySettings
  home: Vector3
  decisionTimer: number
  attackTimer: number
}

export function createEnemyAi(team: EnemyTeam, difficulty: Difficulty): EnemyAi {
  const settings = AI_DIFFICULTY[difficulty]
  return {
    team,
    difficulty,
    settings,
    home: ENEMY_SEATS[team].temple,
    decisionTimer: 0,
    attackTimer: settings.initialAttackTimer
  }
}

export function updateEnemyAi(ai: EnemyAi, dt: number, deps: EnemyAiDeps): void {
  ai.attackTimer += dt
  ai.decisionTimer += dt

  if (ai.attackTimer >= ai.settings.attackInterval) {
    ai.attackTimer = 0
    sendEnemyAttackWave(ai, deps)
  }

  if (ai.decisionTimer < ai.settings.decisionRate) return
  ai.decisionTimer = 0

  assignIdleEnemyWorkers(ai, deps)
  runEnemyBuildOrder(ai, deps)
  queueEnemyProduction(ai)
  queueEnemyResearch(ai)
}

function assignIdleEnemyWorkers(ai: EnemyAi, deps: EnemyAiDeps): void {
  for (const worker of getIdleWorkersForTeam(ai.team)) {
    const resourceKind = getEnemyWorkerResourcePriority(ai)
    const resource = getNearestResourceOfKind(Transform.get(worker.entity).position, resourceKind)

    if (resource) {
      deps.assignWorkerToResource(worker, resource, false)
    }
  }
}

function runEnemyBuildOrder(ai: EnemyAi, deps: EnemyAiDeps): void {
  const team = ai.team
  const homesteads = getCompletedTeamBuildings(team, 'supplyHouse')
  const barracks = getCompletedTeamBuildings(team, 'barracks')
  const temples = getCompletedTeamBuildings(team, 'temple')
  const workerCount = getTeamWorkerCount(team)
  const guardCount = getTeamSoldierCount(team)

  if (shouldBuildEnemyHomestead(ai, homesteads.length)) {
    tryStartEnemyConstruction(ai, 'supplyHouse', deps)
    return
  }

  if (workerCount >= 6 && barracks.length === 0) {
    tryStartEnemyConstruction(ai, 'barracks', deps)
    return
  }

  // Tech up once the basic army is rolling: advanced structure first, then the forge.
  // Easy AIs never tech past the barracks (maxAdvancedUnits > 2 implies tech).
  if (ai.settings.maxAdvancedUnits > 2) {
    if (workerCount >= 8 && barracks.length > 0 && getTeamBuildings(team, 'techLab').length === 0) {
      tryStartEnemyConstruction(ai, 'techLab', deps)
      return
    }

    if (getCompletedTeamBuildings(team, 'techLab').length > 0 && getTeamBuildings(team, 'forge').length === 0) {
      tryStartEnemyConstruction(ai, 'forge', deps)
      return
    }
  }

  if (workerCount >= 8 && guardCount >= ai.settings.defenderCount && temples.length < ai.settings.maxTemples) {
    tryStartEnemyConstruction(ai, 'temple', deps)
    return
  }

  if (getSupplyCap(team) - getSupplyUsed(team) <= 2 && homesteads.length < ai.settings.maxHomesteads) {
    tryStartEnemyConstruction(ai, 'supplyHouse', deps)
  }
}

function queueEnemyProduction(ai: EnemyAi): void {
  const team = ai.team
  const economy = gameState.economies[team]
  const workerCount = getTeamWorkerCount(team) + economy.workerQueue
  const guardCount = getTeamSoldierCount(team) + economy.soldierQueue
  const homestead = getCompletedTeamBuildings(team, 'supplyHouse')[0]
  const barracks = getCompletedTeamBuildings(team, 'barracks')[0]

  const workerDef = getWorkerDefinition(team)

  if (homestead && workerCount < ai.settings.targetWorkers && canQueueUnit(team, workerDef.supply) && spendResources(team, workerDef.cost)) {
    workerProductionOrders.push({ homesteadId: homestead.id, timer: 0, productionTime: workerDef.productionTime, team })
    economy.workerQueue += 1
  }

  // Advanced units first: they cost supply the basic army would otherwise hog.
  queueEnemyAdvancedProduction(ai)

  if (barracks && guardCount < ai.settings.targetGuards) {
    // Roughly one ranged unit for every two melee; fall back to melee if gas is short.
    let variant: SoldierVariant = guardCount % 3 === 2 ? 'ranged' : 'melee'
    let soldierDef = getSoldierDefinition(team, variant)
    if (variant === 'ranged' && !hasResources(team, soldierDef.cost)) {
      variant = 'melee'
      soldierDef = getSoldierDefinition(team, variant)
    }

    if (canQueueUnit(team, soldierDef.supply) && spendResources(team, soldierDef.cost)) {
      soldierProductionOrders.push({ barracksId: barracks.id, timer: 0, productionTime: soldierDef.productionTime, team, variant })
      economy.soldierQueue += 1
    }
  }
}

/** With the advanced structure up, the AI folds casters, flyers and the occasional titan into its army. */
function queueEnemyAdvancedProduction(ai: EnemyAi): void {
  const team = ai.team
  const techLab = getCompletedTeamBuildings(team, 'techLab')[0]
  if (!techLab) return

  const advancedCount = soldiers.filter(
    (soldier) => soldier.alive && getTeam(soldier) === team && (soldier.variant === 'caster' || soldier.variant === 'flyer' || soldier.variant === 'titan')
  ).length
  if (advancedCount >= ai.settings.maxAdvancedUnits) return

  // Every fourth advanced unit is a titan (tech-gated behind the forge); the rest alternate caster / flyer.
  const hasForge = getCompletedTeamBuildings(team, 'forge').length > 0
  const variant: SoldierVariant = hasForge && advancedCount % 4 === 3 ? 'titan' : advancedCount % 2 === 0 ? 'caster' : 'flyer'
  const soldierDef = getSoldierDefinition(team, variant)

  if (!canQueueUnit(team, soldierDef.supply) || !hasResources(team, soldierDef.cost)) return
  if (!spendResources(team, soldierDef.cost)) return

  soldierProductionOrders.push({ barracksId: techLab.id, timer: 0, productionTime: soldierDef.productionTime, team, variant })
  gameState.economies[team].soldierQueue += 1
}

/** Researches upgrades when the bank is healthy, keeping unit production the priority. */
function queueEnemyResearch(ai: EnemyAi): void {
  if (!ai.settings.research) return
  const team = ai.team
  const forge = getCompletedTeamBuildings(team, 'forge')[0]
  if (!forge) return
  if (isUpgradeInProgress(team, 'damage') || isUpgradeInProgress(team, 'speed')) return

  const kind: UpgradeKind = getUpgradeLevel(team, 'damage') <= getUpgradeLevel(team, 'speed') ? 'damage' : 'speed'
  const cost = getNextUpgradeCost(team, kind)
  if (!cost) return

  if (getResourceAmount(team, 'minerals') < (cost.minerals ?? 0) + 200) return
  if (getResourceAmount(team, 'gas') < (cost.gas ?? 0) + 50) return

  if (spendResources(team, cost)) {
    startUpgradeResearchOrder(team, kind, forge.id)
  }
}

function tryStartEnemyConstruction(ai: EnemyAi, kind: BuildableKind, deps: EnemyAiDeps): boolean {
  const definition = BUILDING_DEFINITIONS[kind]
  const builder = getEnemyBuilder(ai)
  const position = getEnemyBuildPosition(ai, kind, deps)

  if (!builder || !position || !hasResources(ai.team, definition.cost)) return false
  if (!deps.canPlaceBuildingAt(definition, position)) return false
  if (!spendResources(ai.team, definition.cost)) return false

  const site = deps.createConstructionSite(kind, Vector3.create(position.x, definition.placementY, position.z), builder.id, ENEMY_SEATS[ai.team].rotationY, ai.team)
  builder.state = 'movingToBuild'
  builder.targetResourceId = undefined
  builder.buildSiteId = site.id
  builder.rallyPoint = undefined
  builder.timer = 0
  builder.carrying = 0
  builder.carryingResource = undefined
  deps.setWorkerAnimation(builder, 'walk')
  return true
}

function sendEnemyAttackWave(ai: EnemyAi, deps: EnemyAiDeps): void {
  const playerTemples = getCompletedTeamBuildings('player', 'temple')
  if (playerTemples.length === 0) return

  const availableAttackers = soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === ai.team && soldier.state === 'idle')
  const attackers = availableAttackers.slice(ai.settings.defenderCount)

  if (attackers.length < 3) return

  for (let i = 0; i < attackers.length; i++) {
    const target = playerTemples[i % playerTemples.length]
    deps.assignSoldierToAttack(attackers[i], target, i)
  }

  deps.setStatus(`Enemy attack wave incoming: ${attackers.length} hostiles targeting ${playerTemples.length} Temple${playerTemples.length === 1 ? '' : 's'}.`)
}

function shouldBuildEnemyHomestead(ai: EnemyAi, completedHomesteadCount: number): boolean {
  if (completedHomesteadCount === 0) return true
  return getSupplyCap(ai.team) - getSupplyUsed(ai.team) <= 2 && completedHomesteadCount < ai.settings.maxHomesteads
}

function getEnemyBuilder(ai: EnemyAi): Worker | undefined {
  return getIdleWorkersForTeam(ai.team)[0] ?? getAvailableWorkersForTeam(ai.team)[0]
}

function getEnemyWorkerResourcePriority(ai: EnemyAi): ResourceKind {
  const team = ai.team
  const assigned = {
    minerals: getEnemyAssignedResourceCount(team, 'minerals'),
    gas: getEnemyAssignedResourceCount(team, 'gas')
  }

  if (assigned.minerals < 3) return 'minerals'
  // Advanced units and research are gas-hungry, so keep two harvesters on gas.
  if (assigned.gas < 2 && getTeamWorkerCount(team) >= 6) return 'gas'
  if (assigned.gas < 1) return 'gas'
  if (getResourceAmount(team, 'gas') < (getSoldierDefinition(team, 'ranged').cost.gas ?? 0) * 2) return 'gas'
  return 'minerals'
}

function getEnemyAssignedResourceCount(team: EnemyTeam, resource: ResourceKind): number {
  return workers.filter((worker) => worker.alive && getTeam(worker) === team && worker.targetResourceId && resources.find((node) => node.id === worker.targetResourceId)?.resource === resource).length
}

function getNearestResourceOfKind(position: Vector3, resource: ResourceKind): ResourceNode | undefined {
  let nearest: ResourceNode | undefined
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const node of resources) {
    if (!node.alive || node.resource !== resource || node.amount <= 0) continue

    const distance = distanceToPoint(position, Transform.get(node.entity).position)
    if (distance < nearestDistance) {
      nearest = node
      nearestDistance = distance
    }
  }

  return nearest
}

function getEnemyBuildPosition(ai: EnemyAi, kind: BuildableKind, deps: EnemyAiDeps): Vector3 | undefined {
  const definition = BUILDING_DEFINITIONS[kind]
  const homeTemple = deps.getNearestTemple(ai.home, ai.team)
  const center = homeTemple ? Transform.get(homeTemple.entity).position : ai.home
  const existingKindCount = getTeamBuildings(ai.team, kind).length
  const offsets = getEnemyBuildOffsets(kind)

  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[(existingKindCount + i) % offsets.length]
    const position = deps.getSnappedPlacementPosition(Vector3.create(center.x + offset.x, 0, center.z + offset.z))
    if (deps.canPlaceBuildingAt(definition, position)) return position
  }

  return undefined
}

function getEnemyBuildOffsets(kind: BuildableKind): Vector3[] {
  if (kind === 'temple') {
    return [
      Vector3.create(-24, 0, -16),
      Vector3.create(18, 0, -24),
      Vector3.create(-28, 0, 14)
    ]
  }

  if (kind === 'barracks') {
    return [
      Vector3.create(-14, 0, 8),
      Vector3.create(12, 0, 10),
      Vector3.create(-18, 0, -4)
    ]
  }

  if (kind === 'techLab') {
    return [
      Vector3.create(14, 0, -8),
      Vector3.create(-8, 0, -14),
      Vector3.create(18, 0, 4)
    ]
  }

  if (kind === 'forge') {
    return [
      Vector3.create(8, 0, -14),
      Vector3.create(-12, 0, -12),
      Vector3.create(16, 0, 12)
    ]
  }

  return [
    Vector3.create(-10, 0, 0),
    Vector3.create(10, 0, 0),
    Vector3.create(0, 0, -10),
    Vector3.create(0, 0, 10),
    Vector3.create(-10, 0, 18),
    Vector3.create(10, 0, 18),
    Vector3.create(-22, 0, 6),
    Vector3.create(22, 0, -6)
  ]
}
