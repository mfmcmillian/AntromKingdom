import { Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { AI_DIFFICULTY, BUILDING_DEFINITIONS, type DifficultySettings } from '../config'
import { getIslandZoneAt, getMapById, isIslandMap, isSameIsland } from '../maps'
import { canQueueUnit, getResourceAmount, getSupplyCap, getSupplyUsed, hasResources, spendResources } from '../economy'
import { distanceToPoint } from '../math'
import { TRANSPORT_CAPACITY, getSoldierDefinition, getWorkerDefinition } from '../races'
import { areHostile, gameState, isPlayerAlly } from '../state'
import { getNextUpgradeCost, getUpgradeLevel, isUpgradeInProgress, startUpgradeResearchOrder } from '../upgrades'
import type { BuildableKind, Building, Difficulty, EnemyTeam, ResourceKind, ResourceNode, Soldier, SoldierVariant, Team, UpgradeKind, Worker } from '../types'
import {
  buildings,
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
  /** Island maps: queue ground units to walk aboard / drop the riders here. */
  orderBoardTransport(units: (Soldier | Worker)[], transport: Soldier): void
  unloadTransport(transport: Soldier): boolean
}

/** A ferry run: ground wave boards transports, flies out, drops, attacks. */
type FerryOperation = {
  phase: 'boarding' | 'flying'
  transportIds: string[]
  attackerIds: string[]
  dropPoint: Vector3
  targetTeam: Team
  /** Safety clock: a stuck phase is abandoned rather than blocking future waves. */
  timer: number
}

/** A colonization run: a worker crew is ferried to an empty island where the
 * first one ashore plants an expansion temple by the fresh crystal line. */
type ExpandOperation = {
  phase: 'boarding' | 'flying' | 'building'
  transportId: string
  workerIds: string[]
  dropPoint: Vector3
  clusterPosition: Vector3
  timer: number
}

/** One computer opponent's brain: its own timers, seat, and difficulty tuning. */
export type EnemyAi = {
  team: EnemyTeam
  difficulty: Difficulty
  settings: DifficultySettings
  home: Vector3
  buildRotationY: number
  decisionTimer: number
  attackTimer: number
  ferry?: FerryOperation
  expand?: ExpandOperation
}

export function createEnemyAi(team: EnemyTeam, difficulty: Difficulty): EnemyAi {
  const settings = AI_DIFFICULTY[difficulty]
  const seat = getMapById(gameState.selectedMapId).anchors[gameState.enemySeatIndex[team]]
  return {
    team,
    difficulty,
    settings,
    home: seat.temple,
    buildRotationY: seat.rotationY,
    decisionTimer: 0,
    attackTimer: settings.initialAttackTimer
  }
}

export function updateEnemyAi(ai: EnemyAi, dt: number, deps: EnemyAiDeps): void {
  ai.attackTimer += dt
  ai.decisionTimer += dt

  updateFerryOperation(ai, dt, deps)
  updateExpandOperation(ai, dt, deps)

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

    // Island maps: wings before wheels - the army lives in the air here, so
    // air research comes straight after the tech lab.
    if (ai.settings.research && isIslandMap() && getCompletedTeamBuildings(team, 'techLab').length > 0 && getTeamBuildings(team, 'airForge').length === 0) {
      tryStartEnemyConstruction(ai, 'airForge', deps)
      return
    }

    if (getCompletedTeamBuildings(team, 'techLab').length > 0 && getTeamBuildings(team, 'forge').length === 0) {
      tryStartEnemyConstruction(ai, 'forge', deps)
      return
    }

    // Air research follows once the ground forge is working: flyers are a
    // steady part of the advanced army mix, so the upgrades pay off.
    if (ai.settings.research && getCompletedTeamBuildings(team, 'forge').length > 0 && getTeamBuildings(team, 'airForge').length === 0) {
      tryStartEnemyConstruction(ai, 'airForge', deps)
      return
    }
  }

  // Base defense: ring the main with turrets once fighter production is up.
  if (barracks.length > 0 && workerCount >= 7 && getTeamBuildings(team, 'turret').length < ai.settings.maxTurrets) {
    tryStartEnemyConstruction(ai, 'turret', deps)
    return
  }

  // Count in-progress temples too: expansions cost 300 and shouldn't stack up.
  if (workerCount >= 8 && guardCount >= ai.settings.defenderCount && getTeamBuildings(team, 'temple').length < ai.settings.maxTemples) {
    if (tryStartEnemyConstruction(ai, 'temple', deps)) return
    // Island maps: no walkable expansion spot left means the next base is
    // across the void - ferry a worker crew to an empty island instead.
    if (isIslandMap() && ai.settings.expands) tryStartIslandExpansion(ai, deps)
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
  const temples = getCompletedTeamBuildings(team, 'temple')
  // Round-robin across every base so expansions staff their own mineral lines.
  const temple = temples.length > 0 ? temples[workerCount % temples.length] : undefined
  const barracks = getCompletedTeamBuildings(team, 'barracks')[0]

  const workerDef = getWorkerDefinition(team)

  if (temple && workerCount < ai.settings.targetWorkers && canQueueUnit(team, workerDef.supply) && spendResources(team, workerDef.cost)) {
    workerProductionOrders.push({ templeId: temple.id, timer: 0, productionTime: workerDef.productionTime, team })
    economy.workerQueue += 1
  }

  // Advanced units first: they cost supply the basic army would otherwise hog.
  queueEnemyAdvancedProduction(ai)

  if (barracks && guardCount < ai.settings.targetGuards) {
    // Roughly one ranged per two melee, one medic per six units; fall back to melee if gas is short.
    let variant: SoldierVariant = guardCount % 6 === 5 ? 'healer' : guardCount % 3 === 2 ? 'ranged' : 'melee'
    let soldierDef = getSoldierDefinition(team, variant)
    if (variant !== 'melee' && !hasResources(team, soldierDef.cost)) {
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

  // Island maps: a small carrier fleet comes before anything fancy, or the
  // ground army can never leave home (expanders keep a spare for colonizing).
  if (isIslandMap()) {
    const wantTransports = ai.settings.expands ? 3 : 2
    const transportCount =
      soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === team && soldier.variant === 'transport').length +
      soldierProductionOrders.filter((order) => order.team === team && order.variant === 'transport').length
    if (transportCount < wantTransports) {
      const transportDef = getSoldierDefinition(team, 'transport')
      if (canQueueUnit(team, transportDef.supply) && hasResources(team, transportDef.cost) && spendResources(team, transportDef.cost)) {
        soldierProductionOrders.push({ barracksId: techLab.id, timer: 0, productionTime: transportDef.productionTime, team, variant: 'transport' })
        gameState.economies[team].soldierQueue += 1
        return
      }
    }
  }

  const advancedCount = soldiers.filter(
    (soldier) =>
      soldier.alive &&
      getTeam(soldier) === team &&
      (soldier.variant === 'caster' || soldier.variant === 'flyer' || soldier.variant === 'siege' || soldier.variant === 'titan')
  ).length
  // Island maps: air power decides the game, so the advanced army runs bigger.
  const advancedCap = isIslandMap() ? Math.ceil(ai.settings.maxAdvancedUnits * 1.5) : ai.settings.maxAdvancedUnits
  if (advancedCount >= advancedCap) return

  const hasForge = getCompletedTeamBuildings(team, 'forge').length > 0
  const slot = advancedCount % 4
  let variant: SoldierVariant
  if (isIslandMap()) {
    // Island cycle leans hard on wings: flyer, caster, flyer, titan. Flyers
    // cross the void on their own; the occasional titan rides the ferry.
    variant = slot === 1 ? 'caster' : slot === 3 ? (hasForge ? 'titan' : 'flyer') : 'flyer'
  } else {
    // Forge-gated cycle: caster, flyer, siege, titan (siege/titan downgrade until the forge stands).
    variant = slot === 3 ? (hasForge ? 'titan' : 'flyer') : slot === 2 ? (hasForge ? 'siege' : 'caster') : slot === 0 ? 'caster' : 'flyer'
  }
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
  if (forge) {
    tryStartResearchTrack(team, 'damage', 'speed', forge.id)
  }

  // Air tracks only matter once the AI actually fields flyers.
  const airForge = getCompletedTeamBuildings(team, 'airForge')[0]
  const hasFlyers = soldiers.some((soldier) => soldier.alive && getTeam(soldier) === team && soldier.variant === 'flyer')
  if (airForge && hasFlyers) {
    tryStartResearchTrack(team, 'airDamage', 'airSpeed', airForge.id)
  }
}

/** Researches whichever of the two tracks is lower, if the bank stays healthy after paying. */
function tryStartResearchTrack(team: EnemyTeam, damageKind: UpgradeKind, speedKind: UpgradeKind, labId: string): void {
  if (isUpgradeInProgress(team, damageKind) || isUpgradeInProgress(team, speedKind)) return

  const kind: UpgradeKind = getUpgradeLevel(team, damageKind) <= getUpgradeLevel(team, speedKind) ? damageKind : speedKind
  const cost = getNextUpgradeCost(team, kind)
  if (!cost) return

  if (getResourceAmount(team, 'minerals') < (cost.minerals ?? 0) + 200) return
  if (getResourceAmount(team, 'gas') < (cost.gas ?? 0) + 50) return

  if (spendResources(team, cost)) {
    startUpgradeResearchOrder(team, kind, labId)
  }
}

function tryStartEnemyConstruction(ai: EnemyAi, kind: BuildableKind, deps: EnemyAiDeps): boolean {
  const definition = BUILDING_DEFINITIONS[kind]
  const builder = getEnemyBuilder(ai)
  const position = getEnemyBuildPosition(ai, kind, deps)

  if (!builder || !position || !hasResources(ai.team, definition.cost)) return false
  if (!deps.canPlaceBuildingAt(definition, position)) return false
  if (!spendResources(ai.team, definition.cost)) return false

  const site = deps.createConstructionSite(kind, Vector3.create(position.x, definition.placementY, position.z), builder.id, ai.buildRotationY, ai.team)
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
  // March on whichever hostile faction is closest: all completed temples of
  // hostile teams, nearest first (in FFA that can be another computer).
  // Elimination requires razing every structure, so once the temples are
  // gone the waves sweep whatever hostile buildings remain.
  let hostileTemples = buildings
    .filter((building) => building.alive && building.isComplete && building.kind === 'temple' && areHostile(getTeam(building), ai.team))
    .sort((a, b) => distanceToPoint(Transform.get(a.entity).position, ai.home) - distanceToPoint(Transform.get(b.entity).position, ai.home))
  if (hostileTemples.length === 0) {
    hostileTemples = buildings
      .filter((building) => building.alive && areHostile(getTeam(building), ai.team))
      .sort((a, b) => distanceToPoint(Transform.get(a.entity).position, ai.home) - distanceToPoint(Transform.get(b.entity).position, ai.home))
  }
  if (hostileTemples.length === 0) return

  // Transports never fight and riders are already spoken for.
  const availableAttackers = soldiers.filter(
    (soldier) => soldier.alive && getTeam(soldier) === ai.team && soldier.state === 'idle' && soldier.variant !== 'transport' && !soldier.inTransportId
  )
  const attackers = availableAttackers.slice(ai.settings.defenderCount)

  if (attackers.length < 3) return

  // Focus on the nearest faction's temples rather than spreading map-wide.
  const targetTeam = getTeam(hostileTemples[0])
  const temples = hostileTemples.filter((temple) => getTeam(temple) === targetTeam)

  // Defense towers shred a wave that ignores them, so part of the wave is
  // always assigned to knock the target's turrets down first.
  const turrets = buildings
    .filter((building) => building.alive && building.isComplete && building.kind === 'turret' && getTeam(building) === targetTeam)
    .sort((a, b) => distanceToPoint(Transform.get(a.entity).position, ai.home) - distanceToPoint(Transform.get(b.entity).position, ai.home))

  const targets = [...turrets, ...temples]

  // Island maps: a target across the void can't be marched to. Flyers go
  // direct; the ground wave boards transports and gets ferried over.
  const primaryTargetPosition = Transform.get(targets[0].entity).position
  if (isIslandMap() && !isSameIsland(ai.home, primaryTargetPosition)) {
    sendFerriedAttackWave(ai, attackers, targets, targetTeam, deps)
    return
  }

  let slot = 0
  for (const attacker of attackers) {
    // Healers can't take attack orders - they escort the wave via attack-move
    // and their own system doctors the wounded once they arrive.
    if (attacker.variant === 'healer') {
      const escortTo = Transform.get(targets[0].entity).position
      attacker.state = 'attackMoving'
      attacker.attackMovePoint = { x: escortTo.x, y: escortTo.y, z: escortTo.z }
      attacker.targetId = undefined
      continue
    }
    deps.assignSoldierToAttack(attacker, targets[slot % targets.length], slot)
    slot++
  }

  if (targetTeam === 'player') {
    deps.setStatus(`Enemy attack wave incoming: ${attackers.length} hostiles heading for your base.`)
  } else if (isPlayerAlly(ai.team)) {
    deps.setStatus(`Your ally is attacking with ${attackers.length} fighters.`)
  }
}

// ---------------------------------------------------------------------------
// Island warfare: the AI ferries its ground army StarCraft-drop style.
// Boarding -> flying -> unload at the target island's rim -> attack.
// ---------------------------------------------------------------------------

/** Kick off a ferry run (flyers attack immediately; ground units board). */
function sendFerriedAttackWave(ai: EnemyAi, attackers: Soldier[], targets: (Building | Soldier | Worker)[], targetTeam: Team, deps: EnemyAiDeps): void {
  const airborne = attackers.filter((soldier) => soldier.variant === 'flyer')
  const ground = attackers.filter((soldier) => soldier.variant !== 'flyer' && soldier.variant !== 'transport')

  let slot = 0
  for (const flyer of airborne) {
    deps.assignSoldierToAttack(flyer, targets[slot % targets.length], slot)
    slot++
  }

  // One ferry run at a time, and only when there is something worth shipping.
  if (ai.ferry || ground.length < 3) return

  const transports = soldiers.filter(
    (soldier) => soldier.alive && getTeam(soldier) === ai.team && soldier.variant === 'transport' && soldier.id !== ai.expand?.transportId
  )
  if (transports.length === 0) return

  const wave = ground.slice(0, transports.length * TRANSPORT_CAPACITY)

  // Drop just inside the target island's rim, pulled toward the island center
  // so nobody lands in the sky.
  const targetPosition = Transform.get(targets[0].entity).position
  const island = getIslandZoneAt(targetPosition.x, targetPosition.z)
  const centerX = island?.x ?? targetPosition.x
  const centerZ = island?.z ?? targetPosition.z
  const towardCenterX = centerX - targetPosition.x
  const towardCenterZ = centerZ - targetPosition.z
  const length = Math.sqrt(towardCenterX * towardCenterX + towardCenterZ * towardCenterZ) || 1
  const dropDistance = Math.min(8, length)
  const dropPoint = Vector3.create(targetPosition.x + (towardCenterX / length) * dropDistance, 0.25, targetPosition.z + (towardCenterZ / length) * dropDistance)

  // Split the wave across the carriers; each carrier flies to meet its riders.
  const usedTransports: Soldier[] = []
  let index = 0
  for (const transport of transports) {
    const chunk = wave.slice(index, index + TRANSPORT_CAPACITY)
    if (chunk.length === 0) break
    index += chunk.length
    deps.orderBoardTransport(chunk, transport)
    const meetX = chunk.reduce((sum, unit) => sum + Transform.get(unit.entity).position.x, 0) / chunk.length
    const meetZ = chunk.reduce((sum, unit) => sum + Transform.get(unit.entity).position.z, 0) / chunk.length
    sendTransportTo(transport, meetX, meetZ)
    usedTransports.push(transport)
  }
  if (usedTransports.length === 0) return

  ai.ferry = {
    phase: 'boarding',
    transportIds: usedTransports.map((transport) => transport.id),
    attackerIds: wave.map((soldier) => soldier.id),
    dropPoint,
    targetTeam,
    timer: 0
  }
}

/** Drives an in-flight ferry run every frame. */
function updateFerryOperation(ai: EnemyAi, dt: number, deps: EnemyAiDeps): void {
  const ferry = ai.ferry
  if (!ferry) return
  ferry.timer += dt

  const transports = ferry.transportIds
    .map((id) => soldiers.find((soldier) => soldier.id === id))
    .filter((soldier): soldier is Soldier => soldier?.alive === true)
  if (transports.length === 0) {
    ai.ferry = undefined
    return
  }

  if (ferry.phase === 'boarding') {
    const stillWalking = ferry.attackerIds.some((id) => {
      const unit = soldiers.find((soldier) => soldier.id === id)
      return unit?.alive === true && !unit.inTransportId
    })
    // Everyone aboard (or 30s passed - stragglers get left behind): take off.
    if (!stillWalking || ferry.timer > 30) {
      ferry.phase = 'flying'
      ferry.timer = 0
      transports.forEach((transport, i) => {
        sendTransportTo(transport, ferry.dropPoint.x + (i % 3) * 3 - 3, ferry.dropPoint.z + Math.floor(i / 3) * 3)
      })
    }
    return
  }

  // Flying: unload each carrier as it reaches the drop zone.
  for (const transport of transports) {
    if ((transport.cargo?.length ?? 0) === 0) continue
    const position = Transform.get(transport.entity).position
    if (distanceToPoint(position, ferry.dropPoint) <= 7) {
      deps.unloadTransport(transport)
    } else if (transport.state !== 'movingToRally') {
      // Something interrupted the flight (retaliation scans etc): re-order it.
      sendTransportTo(transport, ferry.dropPoint.x, ferry.dropPoint.z)
    }
  }

  const anyCargoLeft = transports.some((transport) => (transport.cargo?.length ?? 0) > 0)
  if (!anyCargoLeft || ferry.timer > 75) {
    orderDroppedWave(ai, ferry, deps)
    for (const transport of transports) sendTransportTo(transport, ai.home.x, ai.home.z)
    ai.ferry = undefined
  }
}

/** Post-drop: the landed wave storms the nearest hostile structures. */
function orderDroppedWave(ai: EnemyAi, ferry: FerryOperation, deps: EnemyAiDeps): void {
  const hostileBuildings = buildings
    .filter((building) => building.alive && getTeam(building) === ferry.targetTeam)
    .sort((a, b) => distanceToPoint(Transform.get(a.entity).position, ferry.dropPoint) - distanceToPoint(Transform.get(b.entity).position, ferry.dropPoint))
  if (hostileBuildings.length === 0) return

  // Turrets die first, same doctrine as the classic wave.
  const turrets = hostileBuildings.filter((building) => building.kind === 'turret' && building.isComplete)
  const targets = [...turrets, ...hostileBuildings.filter((building) => building.kind !== 'turret')]

  let slot = 0
  for (const id of ferry.attackerIds) {
    const unit = soldiers.find((soldier) => soldier.id === id)
    if (!unit?.alive || unit.inTransportId) continue
    if (unit.variant === 'healer') {
      const escortTo = Transform.get(targets[0].entity).position
      unit.state = 'attackMoving'
      unit.attackMovePoint = { x: escortTo.x, y: escortTo.y, z: escortTo.z }
      unit.targetId = undefined
      continue
    }
    deps.assignSoldierToAttack(unit, targets[slot % targets.length], slot)
    slot++
  }

  if (ferry.targetTeam === 'player' && slot > 0) {
    deps.setStatus(`Enemy drop! ${slot} hostiles just landed on your island.`)
  }
}

// ---------------------------------------------------------------------------
// Island colonization: when every walkable expansion spot is taken, the AI
// ferries a worker crew to an unclaimed island and plants a temple there.
// ---------------------------------------------------------------------------

/** Kick off a colonization run if a free carrier, a crew and a target island exist. */
function tryStartIslandExpansion(ai: EnemyAi, deps: EnemyAiDeps): void {
  if (ai.expand) return
  const templeDef = BUILDING_DEFINITIONS.temple
  if (!hasResources(ai.team, templeDef.cost)) return

  // A carrier that is empty and not committed to an attack ferry.
  const transport = soldiers.find(
    (soldier) =>
      soldier.alive &&
      getTeam(soldier) === ai.team &&
      soldier.variant === 'transport' &&
      (soldier.cargo?.length ?? 0) === 0 &&
      !ai.ferry?.transportIds.includes(soldier.id)
  )
  if (!transport) return

  const cluster = getRemoteExpansionCluster(ai)
  if (!cluster) return
  const clusterPosition = Transform.get(cluster.entity).position
  const island = getIslandZoneAt(clusterPosition.x, clusterPosition.z)
  if (!island) return

  // Crew of up to 4: one builds, the rest staff the fresh mineral line.
  const idle = getIdleWorkersForTeam(ai.team)
  const extra = getAvailableWorkersForTeam(ai.team).filter((worker) => !idle.includes(worker))
  const crew = [...idle, ...extra].slice(0, 4)
  if (crew.length < 2) return

  deps.orderBoardTransport(crew, transport)
  const meetX = crew.reduce((sum, worker) => sum + Transform.get(worker.entity).position.x, 0) / crew.length
  const meetZ = crew.reduce((sum, worker) => sum + Transform.get(worker.entity).position.z, 0) / crew.length
  sendTransportTo(transport, meetX, meetZ)

  // Drop pulled from the crystals toward the island's center: safe ground.
  const towardCenterX = island.x - clusterPosition.x
  const towardCenterZ = island.z - clusterPosition.z
  const length = Math.sqrt(towardCenterX * towardCenterX + towardCenterZ * towardCenterZ) || 1
  const dropDistance = Math.min(6, length)
  const dropPoint = Vector3.create(
    clusterPosition.x + (towardCenterX / length) * dropDistance,
    0.25,
    clusterPosition.z + (towardCenterZ / length) * dropDistance
  )

  ai.expand = {
    phase: 'boarding',
    transportId: transport.id,
    workerIds: crew.map((worker) => worker.id),
    dropPoint,
    clusterPosition: Vector3.create(clusterPosition.x, clusterPosition.y, clusterPosition.z),
    timer: 0
  }
}

/** The nearest unclaimed crystal cluster on a different, hostile-free island. */
function getRemoteExpansionCluster(ai: EnemyAi): ResourceNode | undefined {
  const claimRadius = 22
  return resources
    .filter((node) => node.alive && node.amount > 0 && node.resource === 'minerals')
    .filter((node) => {
      const position = Transform.get(node.entity).position
      if (isSameIsland(ai.home, position)) return false
      // Never colonize an island someone is defending, and skip clusters a
      // temple (anyone's, finished or not) has already claimed.
      if (buildings.some((building) => building.alive && areHostile(getTeam(building), ai.team) && isSameIsland(position, Transform.get(building.entity).position))) return false
      return !buildings.some(
        (building) => building.alive && building.kind === 'temple' && distanceToPoint(position, Transform.get(building.entity).position) < claimRadius
      )
    })
    .sort((a, b) => distanceToPoint(Transform.get(a.entity).position, ai.home) - distanceToPoint(Transform.get(b.entity).position, ai.home))[0]
}

/** Drives a colonization run: board -> fly -> drop -> plant the temple. */
function updateExpandOperation(ai: EnemyAi, dt: number, deps: EnemyAiDeps): void {
  const op = ai.expand
  if (!op) return
  op.timer += dt

  const transport = soldiers.find((soldier) => soldier.id === op.transportId && soldier.alive)

  if (op.phase === 'boarding') {
    if (!transport) {
      ai.expand = undefined
      return
    }
    const stillWalking = op.workerIds.some((id) => {
      const worker = workers.find((candidate) => candidate.id === id)
      return worker?.alive === true && !worker.inTransportId
    })
    if (!stillWalking || op.timer > 30) {
      if ((transport.cargo?.length ?? 0) === 0) {
        // Nobody made it aboard: abandon rather than flying an empty ship out.
        ai.expand = undefined
        return
      }
      op.phase = 'flying'
      op.timer = 0
      sendTransportTo(transport, op.dropPoint.x, op.dropPoint.z)
    }
    return
  }

  if (op.phase === 'flying') {
    if (!transport) {
      ai.expand = undefined
      return
    }
    const position = Transform.get(transport.entity).position
    if (distanceToPoint(position, op.dropPoint) <= 6) {
      deps.unloadTransport(transport)
      if ((transport.cargo?.length ?? 0) === 0) {
        sendTransportTo(transport, ai.home.x, ai.home.z)
        op.phase = 'building'
        op.timer = 0
      }
    } else if (transport.state !== 'movingToRally') {
      // Something interrupted the flight: re-order it.
      sendTransportTo(transport, op.dropPoint.x, op.dropPoint.z)
    }
    if (op.timer > 60) {
      // Stuck: dump the crew wherever there is land and head home rather
      // than keeping workers imprisoned aboard.
      deps.unloadTransport(transport)
      sendTransportTo(transport, ai.home.x, ai.home.z)
      ai.expand = undefined
    }
    return
  }

  // Building: the first landed worker plants the temple by the crystals. The
  // rest go idle and the worker system puts them on the new mineral line.
  const crew = op.workerIds
    .map((id) => workers.find((worker) => worker.id === id))
    .filter((worker): worker is Worker => worker?.alive === true && !worker.inTransportId)
  if (crew.length === 0) {
    ai.expand = undefined
    return
  }

  const templeDef = BUILDING_DEFINITIONS.temple
  if (hasResources(ai.team, templeDef.cost)) {
    const builder = crew[0]
    for (const offset of EXPANSION_TEMPLE_OFFSETS) {
      const position = deps.getSnappedPlacementPosition(Vector3.create(op.clusterPosition.x + offset.x, 0, op.clusterPosition.z + offset.z))
      if (!deps.canPlaceBuildingAt(templeDef, position)) continue
      if (!spendResources(ai.team, templeDef.cost)) break

      const site = deps.createConstructionSite('temple', Vector3.create(position.x, templeDef.placementY, position.z), builder.id, ai.buildRotationY, ai.team)
      builder.state = 'movingToBuild'
      builder.targetResourceId = undefined
      builder.buildSiteId = site.id
      builder.rallyPoint = undefined
      builder.timer = 0
      builder.carrying = 0
      builder.carryingResource = undefined
      deps.setWorkerAnimation(builder, 'walk')
      ai.expand = undefined
      return
    }
  }

  // Bank or ground not ready: keep waiting a while before giving up.
  if (op.timer > 45) ai.expand = undefined
}

/** Plain fly-to order for an AI carrier. */
function sendTransportTo(transport: Soldier, x: number, z: number): void {
  transport.state = 'movingToRally'
  transport.targetId = undefined
  transport.attackPosition = undefined
  transport.attackMovePoint = undefined
  transport.rallyPoint = { x, y: Transform.get(transport.entity).position.y, z }
}

function shouldBuildEnemyHomestead(ai: EnemyAi, completedHomesteadCount: number): boolean {
  // Workers come from the temple now, so supply houses are only needed when the cap gets tight.
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

    const nodePosition = Transform.get(node.entity).position
    // Island maps: workers can't walk across the void, so only nodes on the
    // same island count (otherwise they pile up on the rim forever).
    if (isIslandMap() && !isSameIsland(position, nodePosition)) continue

    const distance = distanceToPoint(position, nodePosition)
    if (distance < nearestDistance) {
      nearest = node
      nearestDistance = distance
    }
  }

  return nearest
}

function getEnemyBuildPosition(ai: EnemyAi, kind: BuildableKind, deps: EnemyAiDeps): Vector3 | undefined {
  const definition = BUILDING_DEFINITIONS[kind]

  // Expanding AIs put extra temples at fresh mineral clusters, not in the main.
  if (kind === 'temple' && ai.settings.expands) {
    const expansion = getEnemyExpansionPosition(ai, deps)
    if (expansion) return expansion
    // Island maps: never stack macro temples at home - failing here makes the
    // build order launch a colonization ferry to a fresh island instead.
    if (isIslandMap()) return undefined
  }

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

/** Ring of candidate temple spots around an expansion's crystal line. */
const EXPANSION_TEMPLE_OFFSETS = [
  Vector3.create(9, 0, 0),
  Vector3.create(-9, 0, 0),
  Vector3.create(0, 0, 9),
  Vector3.create(0, 0, -9),
  Vector3.create(7, 0, 7),
  Vector3.create(-7, 0, 7),
  Vector3.create(7, 0, -7),
  Vector3.create(-7, 0, -7)
]

/**
 * Picks where an expanding AI plants its next base: the mineral cluster
 * closest to home that still has crystals and no temple (anyone's, finished
 * or under construction) already claiming it. Skipping claimed clusters also
 * keeps the AI from expanding into a hostile main.
 */
function getEnemyExpansionPosition(ai: EnemyAi, deps: EnemyAiDeps): Vector3 | undefined {
  const definition = BUILDING_DEFINITIONS.temple
  const claimRadius = 22

  const openClusters = resources
    .filter((node) => node.alive && node.amount > 0 && node.resource === 'minerals')
    // Island maps: the AI only expands where its builders can walk (no worker
    // ferries yet), which in practice means its own island.
    .filter((node) => !isIslandMap() || isSameIsland(ai.home, Transform.get(node.entity).position))
    .filter((node) => {
      const position = Transform.get(node.entity).position
      return !buildings.some(
        (building) => building.alive && building.kind === 'temple' && distanceToPoint(position, Transform.get(building.entity).position) < claimRadius
      )
    })
    .sort((a, b) => distanceToPoint(Transform.get(a.entity).position, ai.home) - distanceToPoint(Transform.get(b.entity).position, ai.home))

  for (const node of openClusters) {
    const nodePosition = Transform.get(node.entity).position
    for (const offset of EXPANSION_TEMPLE_OFFSETS) {
      const position = deps.getSnappedPlacementPosition(Vector3.create(nodePosition.x + offset.x, 0, nodePosition.z + offset.z))
      if (deps.canPlaceBuildingAt(definition, position)) return position
    }
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

  if (kind === 'airForge') {
    return [
      Vector3.create(-6, 0, -18),
      Vector3.create(20, 0, -2),
      Vector3.create(-20, 0, 10)
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
