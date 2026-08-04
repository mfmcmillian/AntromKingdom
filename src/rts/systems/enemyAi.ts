import { Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { BUILDING_DEFINITIONS, CONFIG, POSITIONS } from '../config'
import { canQueueUnit, getResourceAmount, getSupplyCap, getSupplyUsed, hasResources, spendResources } from '../economy'
import { distanceToPoint } from '../math'
import { getSoldierDefinition, getWorkerDefinition } from '../races'
import { gameState } from '../state'
import { getNextUpgradeCost, getUpgradeLevel, isUpgradeInProgress, startUpgradeResearchOrder } from '../upgrades'
import type { BuildableKind, Building, ResourceKind, ResourceNode, Soldier, SoldierVariant, UpgradeKind, Worker } from '../types'
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
  createConstructionSite(kind: BuildableKind, position: Vector3, builderWorkerId: string, rotationY: number, team: 'enemy'): Building
  canPlaceBuildingAt(definition: (typeof BUILDING_DEFINITIONS)[BuildableKind], position: Vector3): boolean
  setWorkerAnimation(worker: Worker, clipName: string, restart?: boolean): void
  assignSoldierToAttack(soldier: Soldier, target: Building | Soldier | Worker, slot?: number): void
  getNearestTemple(position: Vector3, team: 'player' | 'enemy'): Building | undefined
  getSnappedPlacementPosition(position: Vector3): Vector3
  setStatus(message: string): void
}

let enemyAiDecisionTimer = 0
let enemyAiAttackTimer = 25

export function resetEnemyAiTimers(): void {
  enemyAiDecisionTimer = 0
  enemyAiAttackTimer = 25
}

export function updateEnemyAi(dt: number, deps: EnemyAiDeps): void {
  enemyAiAttackTimer += dt
  enemyAiDecisionTimer += dt

  if (enemyAiAttackTimer >= CONFIG.enemyAiAttackInterval) {
    enemyAiAttackTimer = 0
    sendEnemyAttackWave(deps)
  }

  if (enemyAiDecisionTimer < CONFIG.enemyAiDecisionRate) return
  enemyAiDecisionTimer = 0

  assignIdleEnemyWorkers(deps)
  runEnemyBuildOrder(deps)
  queueEnemyProduction()
  queueEnemyResearch()
}

function assignIdleEnemyWorkers(deps: EnemyAiDeps): void {
  for (const worker of getIdleWorkersForTeam('enemy')) {
    const resourceKind = getEnemyWorkerResourcePriority()
    const resource = getNearestResourceOfKind(Transform.get(worker.entity).position, resourceKind)

    if (resource) {
      deps.assignWorkerToResource(worker, resource, false)
    }
  }
}

function runEnemyBuildOrder(deps: EnemyAiDeps): void {
  const enemyHomesteads = getCompletedTeamBuildings('enemy', 'supplyHouse')
  const enemyBarracks = getCompletedTeamBuildings('enemy', 'barracks')
  const enemyTemples = getCompletedTeamBuildings('enemy', 'temple')
  const enemyWorkers = getTeamWorkerCount('enemy')
  const enemyGuards = getTeamSoldierCount('enemy')

  if (shouldBuildEnemyHomestead(enemyHomesteads.length)) {
    tryStartEnemyConstruction('supplyHouse', deps)
    return
  }

  if (enemyWorkers >= 6 && enemyBarracks.length === 0) {
    tryStartEnemyConstruction('barracks', deps)
    return
  }

  // Tech up once the basic army is rolling: advanced structure first, then the forge.
  if (enemyWorkers >= 8 && enemyBarracks.length > 0 && getTeamBuildings('enemy', 'techLab').length === 0) {
    tryStartEnemyConstruction('techLab', deps)
    return
  }

  if (getCompletedTeamBuildings('enemy', 'techLab').length > 0 && getTeamBuildings('enemy', 'forge').length === 0) {
    tryStartEnemyConstruction('forge', deps)
    return
  }

  if (enemyWorkers >= 8 && enemyGuards >= CONFIG.enemyAiDefenderCount && enemyTemples.length < 3) {
    tryStartEnemyConstruction('temple', deps)
    return
  }

  if (getSupplyCap('enemy') - getSupplyUsed('enemy') <= 2 && enemyHomesteads.length < ENEMY_MAX_HOMESTEADS) {
    tryStartEnemyConstruction('supplyHouse', deps)
  }
}

// Advanced units cost 2-4 supply each, so the AI needs a bigger supply farm than before.
const ENEMY_MAX_HOMESTEADS = 7

function queueEnemyProduction(): void {
  const enemyWorkers = getTeamWorkerCount('enemy') + gameState.enemyWorkerQueue
  const enemyGuards = getTeamSoldierCount('enemy') + gameState.enemySoldierQueue
  const enemyHomestead = getCompletedTeamBuildings('enemy', 'supplyHouse')[0]
  const enemyBarracks = getCompletedTeamBuildings('enemy', 'barracks')[0]

  const workerDef = getWorkerDefinition('enemy')

  if (enemyHomestead && enemyWorkers < CONFIG.enemyAiTargetWorkers && canQueueUnit('enemy', workerDef.supply) && spendResources('enemy', workerDef.cost)) {
    workerProductionOrders.push({ homesteadId: enemyHomestead.id, timer: 0, productionTime: workerDef.productionTime, team: 'enemy' })
    gameState.enemyWorkerQueue += 1
  }

  // Advanced units first: they cost supply the basic army would otherwise hog.
  queueEnemyAdvancedProduction()

  if (enemyBarracks && enemyGuards < CONFIG.enemyAiTargetGuards) {
    // Roughly one ranged unit for every two melee; fall back to melee if gas is short.
    let variant: SoldierVariant = enemyGuards % 3 === 2 ? 'ranged' : 'melee'
    let soldierDef = getSoldierDefinition('enemy', variant)
    if (variant === 'ranged' && !hasResources('enemy', soldierDef.cost)) {
      variant = 'melee'
      soldierDef = getSoldierDefinition('enemy', variant)
    }

    if (canQueueUnit('enemy', soldierDef.supply) && spendResources('enemy', soldierDef.cost)) {
      soldierProductionOrders.push({ barracksId: enemyBarracks.id, timer: 0, productionTime: soldierDef.productionTime, team: 'enemy', variant })
      gameState.enemySoldierQueue += 1
    }
  }
}

/** With the advanced structure up, the AI folds casters, flyers and the occasional titan into its army. */
function queueEnemyAdvancedProduction(): void {
  const techLab = getCompletedTeamBuildings('enemy', 'techLab')[0]
  if (!techLab) return

  const advancedCount = soldiers.filter(
    (soldier) => soldier.alive && getTeam(soldier) === 'enemy' && (soldier.variant === 'caster' || soldier.variant === 'flyer' || soldier.variant === 'titan')
  ).length
  if (advancedCount >= 8) return

  // Every fourth advanced unit is a titan (tech-gated behind the forge); the rest alternate caster / flyer.
  const hasForge = getCompletedTeamBuildings('enemy', 'forge').length > 0
  const variant: SoldierVariant = hasForge && advancedCount % 4 === 3 ? 'titan' : advancedCount % 2 === 0 ? 'caster' : 'flyer'
  const soldierDef = getSoldierDefinition('enemy', variant)

  if (!canQueueUnit('enemy', soldierDef.supply) || !hasResources('enemy', soldierDef.cost)) return
  if (!spendResources('enemy', soldierDef.cost)) return

  soldierProductionOrders.push({ barracksId: techLab.id, timer: 0, productionTime: soldierDef.productionTime, team: 'enemy', variant })
  gameState.enemySoldierQueue += 1
}

/** Researches upgrades when the bank is healthy, keeping unit production the priority. */
function queueEnemyResearch(): void {
  const forge = getCompletedTeamBuildings('enemy', 'forge')[0]
  if (!forge) return
  if (isUpgradeInProgress('enemy', 'damage') || isUpgradeInProgress('enemy', 'speed')) return

  const kind: UpgradeKind = getUpgradeLevel('enemy', 'damage') <= getUpgradeLevel('enemy', 'speed') ? 'damage' : 'speed'
  const cost = getNextUpgradeCost('enemy', kind)
  if (!cost) return

  if (getResourceAmount('enemy', 'minerals') < (cost.minerals ?? 0) + 200) return
  if (getResourceAmount('enemy', 'gas') < (cost.gas ?? 0) + 50) return

  if (spendResources('enemy', cost)) {
    startUpgradeResearchOrder('enemy', kind, forge.id)
  }
}

function tryStartEnemyConstruction(kind: BuildableKind, deps: EnemyAiDeps): boolean {
  const definition = BUILDING_DEFINITIONS[kind]
  const builder = getEnemyBuilder()
  const position = getEnemyBuildPosition(kind, deps)

  if (!builder || !position || !hasResources('enemy', definition.cost)) return false
  if (!deps.canPlaceBuildingAt(definition, position)) return false
  if (!spendResources('enemy', definition.cost)) return false

  const site = deps.createConstructionSite(kind, Vector3.create(position.x, definition.placementY, position.z), builder.id, 180, 'enemy')
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

function sendEnemyAttackWave(deps: EnemyAiDeps): void {
  const playerTemples = getCompletedTeamBuildings('player', 'temple')
  if (playerTemples.length === 0) return

  const availableAttackers = soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === 'enemy' && soldier.state === 'idle')
  const attackers = availableAttackers.slice(CONFIG.enemyAiDefenderCount)

  if (attackers.length < 3) return

  for (let i = 0; i < attackers.length; i++) {
    const target = playerTemples[i % playerTemples.length]
    deps.assignSoldierToAttack(attackers[i], target, i)
  }

  deps.setStatus(`Enemy attack wave incoming: ${attackers.length} guards targeting ${playerTemples.length} Temple${playerTemples.length === 1 ? '' : 's'}.`)
}

function shouldBuildEnemyHomestead(completedHomesteadCount: number): boolean {
  if (completedHomesteadCount === 0) return true
  return getSupplyCap('enemy') - getSupplyUsed('enemy') <= 2 && completedHomesteadCount < ENEMY_MAX_HOMESTEADS
}

function getEnemyBuilder(): Worker | undefined {
  return getIdleWorkersForTeam('enemy')[0] ?? getAvailableWorkersForTeam('enemy')[0]
}

function getEnemyWorkerResourcePriority(): ResourceKind {
  const assigned = {
    minerals: getEnemyAssignedResourceCount('minerals'),
    gas: getEnemyAssignedResourceCount('gas')
  }

  if (assigned.minerals < 3) return 'minerals'
  // Advanced units and research are gas-hungry, so keep two harvesters on gas.
  if (assigned.gas < 2 && getTeamWorkerCount('enemy') >= 6) return 'gas'
  if (assigned.gas < 1) return 'gas'
  if (getResourceAmount('enemy', 'gas') < (getSoldierDefinition('enemy', 'ranged').cost.gas ?? 0) * 2) return 'gas'
  return 'minerals'
}

function getEnemyAssignedResourceCount(resource: ResourceKind): number {
  return workers.filter((worker) => worker.alive && getTeam(worker) === 'enemy' && worker.targetResourceId && resources.find((node) => node.id === worker.targetResourceId)?.resource === resource).length
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

function getEnemyBuildPosition(kind: BuildableKind, deps: EnemyAiDeps): Vector3 | undefined {
  const definition = BUILDING_DEFINITIONS[kind]
  const enemyTemple = deps.getNearestTemple(POSITIONS.enemyTemple, 'enemy')
  const center = enemyTemple ? Transform.get(enemyTemple.entity).position : POSITIONS.enemyTemple
  const existingKindCount = getTeamBuildings('enemy', kind).length
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
