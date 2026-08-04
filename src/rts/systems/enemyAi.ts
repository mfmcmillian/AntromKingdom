import { Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { BUILDING_DEFINITIONS, CONFIG, POSITIONS, SOLDIER_DEFINITION } from '../config'
import { canQueueUnit, getResourceAmount, getSupplyCap, getSupplyUsed, hasResources, spendResources } from '../economy'
import { distanceToPoint } from '../math'
import { gameState } from '../state'
import type { BuildableKind, Building, ResourceKind, ResourceNode, Soldier, Worker } from '../types'
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

  if (enemyWorkers >= 8 && enemyGuards >= CONFIG.enemyAiDefenderCount && enemyTemples.length < 3) {
    tryStartEnemyConstruction('temple', deps)
    return
  }

  if (getSupplyCap('enemy') - getSupplyUsed('enemy') <= 2 && enemyHomesteads.length < 4) {
    tryStartEnemyConstruction('supplyHouse', deps)
  }
}

function queueEnemyProduction(): void {
  const enemyWorkers = getTeamWorkerCount('enemy') + gameState.enemyWorkerQueue
  const enemyGuards = getTeamSoldierCount('enemy') + gameState.enemySoldierQueue
  const enemyHomestead = getCompletedTeamBuildings('enemy', 'supplyHouse')[0]
  const enemyBarracks = getCompletedTeamBuildings('enemy', 'barracks')[0]

  if (enemyHomestead && enemyWorkers < CONFIG.enemyAiTargetWorkers && canQueueUnit('enemy', 1) && spendResources('enemy', { meat: CONFIG.workerCost })) {
    workerProductionOrders.push({ homesteadId: enemyHomestead.id, timer: 0, productionTime: CONFIG.productionTime, team: 'enemy' })
    gameState.enemyWorkerQueue += 1
  }

  if (enemyBarracks && enemyGuards < CONFIG.enemyAiTargetGuards && canQueueUnit('enemy', SOLDIER_DEFINITION.supply) && spendResources('enemy', SOLDIER_DEFINITION.cost)) {
    soldierProductionOrders.push({ barracksId: enemyBarracks.id, timer: 0, productionTime: SOLDIER_DEFINITION.productionTime, team: 'enemy' })
    gameState.enemySoldierQueue += 1
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
  return getSupplyCap('enemy') - getSupplyUsed('enemy') <= 2 && completedHomesteadCount < 4
}

function getEnemyBuilder(): Worker | undefined {
  return getIdleWorkersForTeam('enemy')[0] ?? getAvailableWorkersForTeam('enemy')[0]
}

function getEnemyWorkerResourcePriority(): ResourceKind {
  const assigned = {
    rocks: getEnemyAssignedResourceCount('rocks'),
    wood: getEnemyAssignedResourceCount('wood'),
    meat: getEnemyAssignedResourceCount('meat')
  }

  if (assigned.rocks < 2) return 'rocks'
  if (assigned.wood < 2) return 'wood'
  if (assigned.meat < 1) return 'meat'
  if (getResourceAmount('enemy', 'meat') < CONFIG.workerCost) return 'meat'
  if (getResourceAmount('enemy', 'wood') < 100) return 'wood'
  return 'rocks'
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

  return [
    Vector3.create(-10, 0, 0),
    Vector3.create(10, 0, 0),
    Vector3.create(0, 0, -10),
    Vector3.create(0, 0, 10)
  ]
}
