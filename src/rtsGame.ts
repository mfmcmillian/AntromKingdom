import {
  Animator,
  AudioSource,
  ColliderLayer,
  Entity,
  GltfContainer,
  InputAction,
  Material,
  MeshCollider,
  MeshRenderer,
  PointerEventType,
  PrimaryPointerInfo,
  TextShape,
  Transform,
  engine,
  inputSystem,
  pointerEventsSystem
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import {
  ASSETS,
  BUILDING_DEFINITIONS,
  COLORS,
  CONFIG,
  GRID,
  MODEL_TRANSFORMS,
  POSITIONS,
  RESOURCE_DEFINITIONS,
  SCENE,
  SOLDIER_DEFINITION
} from './rts/config'
import {
  addSupplyUsed,
  addResources,
  addSupplyCap,
  getConstructionRefund,
  getSupplyCap,
  getSupplyUsed,
  hasResources,
  resetEconomy,
  spendResources
} from './rts/economy'
import {
  createBoxEntity,
  createLabel,
  createModelColliderEntity,
  createModelEntity,
  createRallyMarker,
  createVisualBoxEntity,
  hideEntity,
  type RallyMarker
} from './rts/entities'
import { formatNumber, formatPosition, formatVectorForPaste } from './rts/format'
import { clamp, cloneVector, distanceToPoint, distanceToPosition, getFormationPosition, offsetSpawn } from './rts/math'
import { gameState } from './rts/state'
import { updateSoldiers as updateSoldiersSystem } from './rts/systems/combat'
import { resetEnemyAiTimers, updateEnemyAi as updateEnemyAiSystem } from './rts/systems/enemyAi'
import { updateSoldierProduction as updateSoldierProductionSystem, updateWorkerProduction as updateWorkerProductionSystem } from './rts/systems/production'
import { updateWorkers as updateWorkersSystem } from './rts/systems/workers'
import { updateDragSelect } from './rts/dragSelect'
import { initFogOfWar, resetFogOfWar } from './rts/fogOfWar'
import { SelectionMarkerTarget, clearSelectionMarkers, updateSelectionMarkers } from './rts/selectionMarkers'
import { buildEnvironmentEnclosure } from './rts/environment'
import { buildMinerRobot, disposeRobot, isRobot, setRobotAnimation } from './rts/robotModel'
import { buildResourceModel, disposeResourceModel, playResourceDepletion, playResourceGatherPulse } from './rts/resourceModels'
import { showMoveMarker } from './rts/moveMarker'
import { disableTopDownView, enableTopDownView, getCameraFocus, isTopDownViewActive } from './rts/topDownCamera'
import { createBuildingDamageVfx, removeBuildingDamageVfx, updateBuildingDamageVfx } from './rts/vfx'
import {
  buildings,
  createEntityId,
  getAvailableWorkersForTeam,
  getTeam,
  getTeamSoldierCount,
  getTeamWorkerCount,
  resources,
  resetWorld,
  selectables,
  soldierProductionOrders,
  soldiers,
  workerProductionOrders,
  workers
} from './rts/world'
import type {
  BoxConfig,
  BuildableKind,
  Building,
  BuildingDefinition,
  ConstructionState,
  ModelConfig,
  PlacementState,
  ResourceCost,
  ResourceKind,
  ResourceNode,
  Selectable,
  SelectableKind,
  SelectedSummary,
  Soldier,
  Team,
  Worker
} from './rts/types'
export type { SelectedSummary } from './rts/types'
export { gameState }

type BuildingPreview = { ghostEntity: Entity; ghostFootprintEntity: Entity; ghostModelEntity: Entity }

let placementState: PlacementState = { state: 'none' }
let rallyMarker: RallyMarker | undefined
let coordinateLogTimer = 0
let currentBuildingPreviewPosition: Vector3 | undefined
let currentBuildingPreviewCanPlace = false
let currentBuildingPreviewRotationY = 0
let placementConfirmCooldown = 0
let secondaryCancelWasPressed = false
let actionCancelWasPressed = false
const homesteadRallyPoints = new Map<string, Vector3>()
const barracksRallyPoints = new Map<string, Vector3>()
let rallyPlacementKind: 'supplyHouse' | 'barracks' | 'none' = 'none'
let rallyPlacementBuildingId = ''
let rallyPlacementCooldown = 0
const BUILDING_FOOTPRINT_Y = 0.18
const BUILDING_FOOTPRINT_HEIGHT = 0.16
const BUILDING_PREVIEW_PADDING = 1.5
const BUILDING_PLACEMENT_CLICK_COOLDOWN = 0.25
const BUILDING_PLACEMENT_GRID_SIZE = 0.5
const BUILDING_PLACEMENT_PADDING = 0.6
const BUILDING_FOOTPRINT_VALID = Color4.create(0.2, 0.95, 0.35, 0.45)
const BUILDING_FOOTPRINT_BLOCKED = Color4.create(0.95, 0.15, 0.12, 0.5)
const DEPLETED_MEAT_HIDE_DELAY = 180
const PLAYER_ATTACK_ALERT_DURATION = 4
const SOLDIER_MOVE_COMMAND_CLICK_COOLDOWN = 0.2
const SOLDIER_MOVE_FORMATION_RADIUS = 0.9
const SOLDIER_ATTACK_SPACING = 0.7
const SOLDIER_UNIT_ATTACK_SPACING = 1.2
const ENEMY_DEFENSE_RADIUS = 20
const TEMPLE_ATTACK_DISTANCE_PADDING = 3
const MATCH_NOT_STARTED = 'notStarted'
const MATCH_ACTIVE = 'active'
const MATCH_ENDED = 'ended'

let soldierCommandMode: 'none' | 'move' | 'attack' = 'none'
let soldierCommandCooldown = 0

export function initRtsGame(): void {
  createStaticScene()
  createStartingBase()
  initFogOfWar()
  engine.addSystem(rtsTickSystem)
}

export function startRtsMatch(): void {
  if (gameState.matchStatus === MATCH_ACTIVE) return

  if (gameState.matchStatus === MATCH_ENDED) {
    resetRtsGame()
    return
  }

  gameState.matchStatus = MATCH_ACTIVE
  gameState.matchResult = 'none'
  gameState.status = 'Match started. Select a worker to gather resources.'
  enableTopDownView()
}

export function endRtsMatch(): void {
  if (gameState.matchStatus === MATCH_ENDED) return

  endMatch('loss')
}

export function queueWorker(): void {
  if (!isMatchActive()) return

  const selected = getSelected()
  const homestead = selected?.kind === 'supplyHouse' ? (selected as Building) : undefined

  if (!homestead?.alive || !homestead.isComplete) {
    setStatus('Select a completed Homestead to create workers.')
    return
  }

  if (getSupplyUsed('player') + gameState.workerQueue >= getSupplyCap('player')) {
    setStatus('Need more supply before creating workers.')
    return
  }

  const workerCost = { meat: CONFIG.workerCost }
  if (!spendResources('player', workerCost)) {
    setStatus(`Need ${formatCost(workerCost)} for a worker.`)
    return
  }

  workerProductionOrders.push({ homesteadId: homestead.id, timer: 0, productionTime: CONFIG.productionTime, team: 'player' })
  gameState.workerQueue += 1
  setStatus('Worker queued at Homestead.')
}

export function setWorkerSpawnPoint(): void {
  if (!isMatchActive()) return

  const selected = getSelected()

  if (selected?.kind !== 'supplyHouse') {
    setStatus('Select a Homestead first, then set the worker spawn point.')
    return
  }

  const homestead = selected as Building
  if (!homestead.isComplete) {
    setStatus('Finish the Homestead before setting its spawn point.')
    return
  }

  startRallyPlacement('supplyHouse', homestead.id)
  setStatus('Click the ground where new workers should gather.')
}

export function setBarracksSpawnPoint(): void {
  if (!isMatchActive()) return

  const selected = getSelected()

  if (selected?.kind !== 'barracks') {
    setStatus('Select a Barracks first, then set the fighter spawn point.')
    return
  }

  const barracks = selected as Building
  if (!barracks.isComplete) {
    setStatus('Finish the Barracks before setting its spawn point.')
    return
  }

  startRallyPlacement('barracks', barracks.id)
  setStatus('Click the ground where new fighters should gather.')
}

function startRallyPlacement(kind: 'supplyHouse' | 'barracks', buildingId: string): void {
  rallyPlacementKind = kind
  rallyPlacementBuildingId = buildingId
  rallyPlacementCooldown = BUILDING_PLACEMENT_CLICK_COOLDOWN
}

function cancelRallyPlacement(): void {
  rallyPlacementKind = 'none'
  rallyPlacementBuildingId = ''
  rallyPlacementCooldown = 0
}

function updateRallyPlacementInput(dt: number): void {
  if (rallyPlacementKind === 'none') return

  rallyPlacementCooldown = Math.max(0, rallyPlacementCooldown - dt)
  if (rallyPlacementCooldown > 0) return
  if (!inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return

  const ground = getPointerGroundPosition()
  if (!ground) {
    setStatus('Spawn point needs a ground click.')
    return
  }

  const rallyPoint = Vector3.create(ground.x, 0.25, ground.z)
  if (rallyPlacementKind === 'supplyHouse') {
    homesteadRallyPoints.set(rallyPlacementBuildingId, rallyPoint)
    setStatus(`Homestead worker spawn set to ${formatPosition(rallyPoint)}.`)
  } else {
    barracksRallyPoints.set(rallyPlacementBuildingId, rallyPoint)
    setStatus(`Barracks spawn set to ${formatPosition(rallyPoint)}.`)
  }
  cancelRallyPlacement()
}

export function startWorkerBuildingPlacement(kind: BuildableKind): void {
  if (!isMatchActive()) return

  const selected = getSelected()
  const worker = selected?.kind === 'worker' ? (selected as Worker) : undefined
  const definition = BUILDING_DEFINITIONS[kind]

  if (!worker || !worker.alive) {
    setStatus('Select a live worker to build.')
    return
  }

  if (worker.state === 'movingToBuild' || worker.state === 'constructing' || worker.state === 'movingToRepair' || worker.state === 'repairing') {
    setStatus(`${worker.name} is already building.`)
    return
  }

  if (!hasResources(worker.team ?? 'player', definition.cost)) {
    setStatus(`Need ${formatCost(definition.cost)} to build ${definition.name}.`)
    return
  }

  cancelPlacement()
  placementState = {
    state: 'placing',
    buildingKind: kind,
    builderWorkerId: worker.id,
    cost: definition.cost,
    ...createGhostBuilding(definition, Transform.get(worker.entity).position)
  }
  gameState.placementMode = 'placing'
  gameState.placementBuildingKind = kind
  placementConfirmCooldown = BUILDING_PLACEMENT_CLICK_COOLDOWN
  setStatus(`Placing ${definition.name}. Click open ground to build. Press E to rotate.`)
}

export function cancelBuildingPlacement(): void {
  if (placementState.state !== 'placing') return

  const definition = BUILDING_DEFINITIONS[placementState.buildingKind]
  cancelPlacement()
  setStatus(`Cancelled ${definition.name} placement.`)
}

export function queueSoldier(): void {
  if (!isMatchActive()) return

  const selected = getSelected()
  const barracks = selected?.kind === 'barracks' ? (selected as Building) : undefined

  if (!barracks?.alive || !barracks.isComplete) {
    setStatus(`Select a completed Barracks to create ${SOLDIER_DEFINITION.name}s.`)
    return
  }

  if (getSupplyUsed('player') + gameState.workerQueue + gameState.soldierQueue >= getSupplyCap('player')) {
    setStatus(`Need more supply before creating ${SOLDIER_DEFINITION.name}s.`)
    return
  }

  if (!spendResources('player', SOLDIER_DEFINITION.cost)) {
    setStatus(`Need ${formatCost(SOLDIER_DEFINITION.cost)} for an ${SOLDIER_DEFINITION.name}.`)
    return
  }

  soldierProductionOrders.push({ barracksId: barracks.id, timer: 0, productionTime: SOLDIER_DEFINITION.productionTime, team: 'player' })
  gameState.soldierQueue += 1
  setStatus(`${SOLDIER_DEFINITION.name} queued at Barracks.`)
}

export function selectAllLikeSelected(): void {
  const selected = getSelected()

  if (selected?.kind !== 'worker' && selected?.kind !== 'soldier') {
    setStatus(`Select a worker or ${SOLDIER_DEFINITION.name} first.`)
    return
  }

  const units = selected.kind === 'worker' ? getAvailableWorkers() : getAvailableSoldiers()
  setUnitSelection(units)
  const unitLabel = selected.kind === 'worker' ? 'workers' : `${SOLDIER_DEFINITION.name}s`
  setStatus(`Selected all ${unitLabel} (${units.length}). Click a valid target to command them.`)
}

export function startSoldierMoveCommand(): void {
  const commandableSoldiers = getCommandableSoldiers()

  if (commandableSoldiers.length === 0) {
    setStatus(`Select an ${SOLDIER_DEFINITION.name} first.`)
    return
  }

  soldierCommandMode = 'move'
  soldierCommandCooldown = SOLDIER_MOVE_COMMAND_CLICK_COOLDOWN
  setStatus(`Move ${commandableSoldiers.length} ${SOLDIER_DEFINITION.name}${commandableSoldiers.length === 1 ? '' : 's'}: click open ground.`)
}

export function startSoldierAttackCommand(): void {
  const commandableSoldiers = getCommandableSoldiers()

  if (commandableSoldiers.length === 0) {
    setStatus(`Select an ${SOLDIER_DEFINITION.name} first.`)
    return
  }

  soldierCommandMode = 'attack'
  soldierCommandCooldown = SOLDIER_MOVE_COMMAND_CLICK_COOLDOWN
  setStatus(`Attack with ${commandableSoldiers.length} ${SOLDIER_DEFINITION.name}${commandableSoldiers.length === 1 ? '' : 's'}: click an enemy.`)
}

export function selectIdleWorker(): void {
  const idleWorker = getIdleWorkers()[0]

  if (!idleWorker) {
    setStatus('No idle workers available.')
    return
  }

  selectObject(idleWorker)
}

export function placeTreeResource(): void {
  placeResourceAtPlayer('wood')
}

export function placeRockResource(): void {
  placeResourceAtPlayer('rocks')
}

export function placeMeatResource(): void {
  placeResourceAtPlayer('meat')
}

export function moveSelectedBuilding(deltaX: number, deltaY: number, deltaZ: number): void {
  const building = getSelectedAdjustableBuilding()

  if (!building) {
    setStatus('Select Temple, Homestead, or Barracks first, then use the building tools.')
    return
  }

  const transform = Transform.getMutable(building.entity)
  transform.position = Vector3.create(transform.position.x + deltaX, Math.max(0, transform.position.y + deltaY), transform.position.z + deltaZ)
  printBuildingTransform(building)
  setStatus(`${building.name} moved to ${formatPosition(transform.position)}.`)
}

export function scaleSelectedBuilding(multiplier: number): void {
  const building = getSelectedAdjustableBuilding()

  if (!building) {
    setStatus('Select Temple, Homestead, or Barracks first, then use the building tools.')
    return
  }

  const transform = Transform.getMutable(building.entity)
  transform.scale = Vector3.create(
    clamp(transform.scale.x * multiplier, 0.1, 20),
    clamp(transform.scale.y * multiplier, 0.1, 20),
    clamp(transform.scale.z * multiplier, 0.1, 20)
  )
  printBuildingTransform(building)
  setStatus(`${building.name} scaled to ${formatVectorForPaste(transform.scale)}.`)
}

export function printSelectedBuildingTransform(): void {
  const building = getSelectedAdjustableBuilding()

  if (!building) {
    setStatus('Select Temple, Homestead, or Barracks first, then print its transform.')
    return
  }

  printBuildingTransform(building)
  setStatus(`${building.name} transform printed.`)
}

export function canCancelSelectedConstruction(): boolean {
  const selected = getSelected()
  return isCancellableConstruction(selected)
}

export function cancelSelectedConstruction(): void {
  const selected = getSelected()

  if (!isCancellableConstruction(selected)) {
    setStatus('Select a building under construction to cancel it.')
    return
  }

  cancelConstruction(selected)
}

function placeResourceAtPlayer(resource: ResourceKind): void {
  const playerPosition = getPlayerPosition()
  const definition = RESOURCE_DEFINITIONS[resource]

  if (!playerPosition) {
    setStatus('Player position is not ready yet.')
    return
  }

  const position = getResourcePlacementPosition(resource, playerPosition)
  const resourceNumber = getPlacedResourceCount(resource) + 1
  const name = `${definition.name} ${resourceNumber}`
  const node = createResourceNode(resource, name, position)

  resources.push(node)
  saveResourcePlacement(resource, position)
  selectObject(node)
  setStatus(`Placed ${name} at ${formatPosition(position)}.`)
}

function getResourcePlacementPosition(resource: ResourceKind, position: Vector3): Vector3 {
  return Vector3.create(position.x, RESOURCE_DEFINITIONS[resource].placementY, position.z)
}

function resetMatchState(status: typeof MATCH_NOT_STARTED | typeof MATCH_ACTIVE = MATCH_NOT_STARTED): void {
  gameState.matchTime = 0
  gameState.matchStatus = status
  gameState.matchResult = 'none'
  gameState.matchStats.player.unitsProduced = 0
  gameState.matchStats.player.unitsKilled = 0
  gameState.matchStats.player.resourcesGathered = 0
  gameState.matchStats.enemy.unitsProduced = 0
  gameState.matchStats.enemy.unitsKilled = 0
  gameState.matchStats.enemy.resourcesGathered = 0
}

function formatRuntimeMatchTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function getPlacedResourceCount(resource: ResourceKind): number {
  return resources.filter((node) => node.resource === resource).length
}

function saveResourcePlacement(resource: ResourceKind, position: Vector3): void {
  const location = formatVectorForPaste(position)

  getSavedResourceLocations(resource).push(location)
  printResourcePlacementLists()
}

export function resetRtsGame(): void {
  resetEconomy()
  resetMatchState(MATCH_ACTIVE)
  gameState.selectedId = ''
  gameState.selectedKind = ''
  gameState.selectedUnitIds = []
  gameState.status = 'Reset complete. Select a worker to start gathering.'
  gameState.attackAlert = ''
  gameState.attackAlertTimer = 0
  gameState.workerQueue = 0
  gameState.soldierQueue = 0
  gameState.placementMode = 'none'
  gameState.placementBuildingKind = ''
  gameState.savedTreeLocations = []
  gameState.savedRockLocations = []
  gameState.savedMeatLocations = []
  homesteadRallyPoints.clear()
  barracksRallyPoints.clear()
  cancelRallyPlacement()
  cancelSoldierCommand()
  cancelPlacement()

  for (const worker of workers) destroySelectable(worker)
  for (const soldier of soldiers) destroySelectable(soldier)
  for (const resource of resources) destroySelectable(resource)
  for (const building of buildings) {
    clearBuildingDamageVfx(building)
    destroySelectable(building)
  }

  resetWorld()
  resetEnemyAiTimers()
  clearSelectionMarkers()
  resetFogOfWar()

  createStartingBase()
  enableTopDownView()
}

export function getWorkerCount(): number {
  return workers.filter((worker) => worker.alive && getTeam(worker) === 'player').length
}

export function getIdleWorkerCount(): number {
  return getIdleWorkers().length
}

export function getSoldierCount(): number {
  return soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === 'player').length
}

function getGroupSelectionPrefix(): string {
  const workerCount = getSelectedWorkers().length
  const soldierCount = getSelectedSoldiers().length
  if (workerCount + soldierCount <= 1) return ''

  const parts: string[] = []
  if (workerCount > 0) parts.push(`${workerCount} worker${workerCount === 1 ? '' : 's'}`)
  if (soldierCount > 0) parts.push(`${soldierCount} ${SOLDIER_DEFINITION.name}${soldierCount === 1 ? '' : 's'}`)
  return `Selected ${parts.join(' + ')}. `
}

export function getSelectedSummary(): SelectedSummary {
  const selected = getSelected()

  if (!selected) {
    return {
      name: 'None',
      kind: 'none',
      detail: getPlacementInstruction() || 'Select Temple, miner, ore, crystal, or building.'
    }
  }

  const selectedUnitCount = getSelectedUnits().length

  if (selected.kind === 'worker') {
    const worker = selected as Worker
    return {
      name: selectedUnitCount > 1 ? `${selectedUnitCount} Units` : worker.name,
      kind: worker.kind,
      team: getTeam(worker),
      hp: worker.hp,
      maxHp: worker.maxHp,
      detail: `${getGroupSelectionPrefix()}State: ${worker.state}${worker.carrying > 0 ? `, carrying ${worker.carrying} ${worker.carryingResource}` : ''}`
    }
  }

  if (selected.kind === 'soldier') {
    const soldier = selected as Soldier
    return {
      name: selectedUnitCount > 1 ? `${selectedUnitCount} Units` : soldier.name,
      kind: soldier.kind,
      team: getTeam(soldier),
      hp: soldier.hp,
      maxHp: soldier.maxHp,
      detail: `${getGroupSelectionPrefix()}State: ${soldier.state}`
    }
  }

  if (selected.kind === 'resource') {
    const resource = selected as ResourceNode
    return {
      name: resource.name,
      kind: resource.kind,
      detail: `${resource.amount} ${resource.resource} remaining`
    }
  }

  const building = selected as Building
  return {
    name: building.name,
    kind: building.kind,
    team: getTeam(building),
    hp: building.hp,
    maxHp: building.maxHp,
    detail: getBuildingDetail(building)
  }
}

function createStaticScene(): void {
  createGround()
  buildEnvironmentEnclosure()
  rallyMarker = createRallyMarker()
}

function createGround(): void {
  const ground = engine.addEntity()

  Transform.create(ground, {
    position: Vector3.create(SCENE.center, 0.01, SCENE.center),
    scale: Vector3.create(SCENE.size, 0.02, SCENE.size)
  })
  MeshRenderer.setBox(ground)
  Material.setPbrMaterial(ground, {
    albedoColor: COLORS.ground,
    castShadows: false
  })

  scatterGroundDecorations()
}

/** Deterministic scatter of moon rocks, craters, and glowing crystals so the surface doesn't read as one flat color. */
function scatterGroundDecorations(): void {
  let seed = 1337
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }

  for (let i = 0; i < 130; i++) {
    const x = 3 + random() * (SCENE.size - 6)
    const z = 3 + random() * (SCENE.size - 6)
    const entity = engine.addEntity()
    const roll = random()

    if (roll < 0.35) {
      // Moon rock. Kept low so it stays under the fog tiles of unexplored cells.
      const size = 0.35 + random() * 0.8
      Transform.create(entity, {
        position: Vector3.create(x, 0.06, z),
        rotation: Quaternion.fromEulerDegrees(random() * 14, random() * 360, random() * 14),
        scale: Vector3.create(size, 0.12 + random() * 0.14, size * (0.65 + random() * 0.55))
      })
      MeshRenderer.setBox(entity)
      Material.setPbrMaterial(entity, {
        albedoColor: Color4.create(0.53, 0.54, 0.59, 1),
        roughness: 1,
        castShadows: false
      })
    } else if (roll < 0.85) {
      // Crater patch, only slightly darker than the ground so it doesn't read as a hole.
      const size = 1.4 + random() * 3
      Transform.create(entity, {
        position: Vector3.create(x, 0.03, z),
        scale: Vector3.create(size, 0.015, size)
      })
      MeshRenderer.setCylinder(entity)
      Material.setPbrMaterial(entity, {
        albedoColor: Color4.create(0.33, 0.33, 0.38, 1),
        roughness: 1,
        castShadows: false
      })
    } else {
      // Glowing crystal shard poking out of the regolith.
      const height = 0.25 + random() * 0.45
      Transform.create(entity, {
        position: Vector3.create(x, height / 2, z),
        rotation: Quaternion.fromEulerDegrees(random() * 18 - 9, random() * 360, random() * 18 - 9),
        scale: Vector3.create(0.12 + random() * 0.1, height, 0.12 + random() * 0.1)
      })
      MeshRenderer.setBox(entity)
      Material.setPbrMaterial(entity, {
        albedoColor: Color4.create(0.12, 0.55, 0.62, 1),
        emissiveColor: Color4.create(0.12, 0.65, 0.75, 1),
        emissiveIntensity: 1,
        castShadows: false
      })
    }
  }
}

function createStartingBase(): void {
  buildings.push(createBuilding('temple', 'Temple', POSITIONS.base, CONFIG.templeHp, 'complete', 0, 'player'))
  buildings.push(createBuilding('temple', 'Enemy Temple', POSITIONS.enemyTemple, CONFIG.templeHp, 'complete', 180, 'enemy'))

  spawnResourceNodes('rocks', POSITIONS.rocks)
  spawnResourceNodes('wood', POSITIONS.trees)
  spawnResourceNodes('meat', POSITIONS.pigs)

  for (const position of POSITIONS.workers) {
    workers.push(createWorker(position, 'player'))
    gameState.supplyUsed += 1
    gameState.matchStats.player.unitsProduced += 1
  }

  for (let i = 0; i < POSITIONS.workers.length; i++) {
    const offset = getFormationPosition(Vector3.create(POSITIONS.enemyTemple.x, 0.25, POSITIONS.enemyTemple.z + 5), i, 1)
    workers.push(createWorker(offset, 'enemy'))
    gameState.enemySupplyUsed += 1
    gameState.matchStats.enemy.unitsProduced += 1
  }
}

function spawnResourceNodes(resource: ResourceKind, positions: Vector3[]): void {
  const definition = RESOURCE_DEFINITIONS[resource]

  for (let i = 0; i < positions.length; i++) {
    resources.push(createResourceNode(resource, `${definition.name} ${i + 1}`, positions[i]))
  }
}

function createWorker(position: Vector3, team: Team = 'player'): Worker {
  const worker = createRobotWorkerSelectable(
    `${team === 'enemy' ? 'Enemy Miner' : 'Miner'} ${getTeamWorkerCount(team) + 1}`,
    position,
    team
  ) as Worker

  worker.hp = CONFIG.workerHp
  worker.maxHp = CONFIG.workerHp
  worker.state = 'idle'
  worker.timer = 0
  worker.carrying = 0
  worker.activeAnimation = 'idle'
  return worker
}

/** Workers on the space branch are procedurally built mining robots instead of GLB villagers. */
function createRobotWorkerSelectable(name: string, position: Vector3, team: Team): Selectable {
  const id = createEntityId('worker')
  const entity = engine.addEntity()
  Transform.create(entity, { position: cloneVector(position) })
  buildMinerRobot(entity, team)

  const selectable: Selectable = { id, kind: 'worker', name, entity, alive: true, team }
  selectable.colliderEntity = createModelColliderEntity(entity, {
    position,
    scale: Vector3.create(1, 1, 1),
    src: '',
    colliderScale: Vector3.create(0.55, 1.6, 0.55)
  })
  selectables.set(id, selectable)
  registerSelectable(selectable)
  return selectable
}

function createSoldier(position: Vector3, team: Team = 'player'): Soldier {
  const soldier = createSelectableModel('soldier', `${team === 'enemy' ? 'Enemy Guard' : SOLDIER_DEFINITION.name} ${getTeamSoldierCount(team) + 1}`, {
    position,
    scale: Vector3.create(1, 1, 1),
    src: team === 'enemy' ? ASSETS.enemyFighter : ASSETS.playerFighter,
    colliderScale: Vector3.create(0.7, 1.8, 0.7),
    animations: [
      { clip: 'idle', playing: true, loop: true },
      { clip: 'walk', playing: false, loop: true },
      { clip: 'attack', playing: false, loop: true },
      { clip: 'impact', playing: false, loop: false }
    ]
  }, true, team) as Soldier

  soldier.hp = SOLDIER_DEFINITION.hp
  soldier.maxHp = SOLDIER_DEFINITION.hp
  soldier.state = 'idle'
  soldier.attackTimer = 0
  soldier.activeAnimation = 'idle'
  return soldier
}

function createResourceNode(resource: ResourceKind, name: string, position: Vector3): ResourceNode {
  const definition = RESOURCE_DEFINITIONS[resource]
  const id = createEntityId('resource')
  const entity = engine.addEntity()
  Transform.create(entity, { position: cloneVector(position) })
  buildResourceModel(entity, resource)

  if (definition.audioClipUrl) {
    AudioSource.create(entity, {
      audioClipUrl: definition.audioClipUrl,
      playing: false,
      loop: false,
      volume: 0.55
    })
  }

  const patch: ResourceNode = {
    id,
    kind: 'resource',
    name,
    entity,
    alive: true,
    resource,
    amount: definition.amount
  }
  patch.colliderEntity = createModelColliderEntity(entity, {
    position,
    scale: Vector3.create(1, 1, 1),
    src: '',
    colliderScale: definition.colliderScale
  })
  selectables.set(id, patch)
  registerSelectable(patch)
  updateLabel(patch, `${name}\n${definition.amount}`)
  return patch
}

function createConstructionSite(kind: BuildableKind, position: Vector3, builderWorkerId: string, rotationY = 0, team: Team = 'player'): Building {
  const definition = BUILDING_DEFINITIONS[kind]
  const site = createBuilding(kind, `${team === 'enemy' ? 'Enemy ' : ''}${definition.name} (Building)`, position, definition.hp, 'movingBuilder', rotationY, team)

  site.builderWorkerId = builderWorkerId
  site.buildTime = definition.buildTime
  site.constructionProgress = 0
  site.isComplete = false
  updateConstructionVisual(site)
  buildings.push(site)
  return site
}

function createBuilding(kind: Building['kind'], name: string, position: Vector3, hp: number, constructionState: ConstructionState, rotationY = 0, team: Team = 'player'): Building {
  const definition = isBuildableKind(kind) ? BUILDING_DEFINITIONS[kind] : undefined
  const scale = getBuildingScale(kind, definition)
  const color = getBuildingColor(kind, definition)
  const building =
    kind === 'enemyBuilding'
      ? (createSelectableModel(kind, name, {
          position,
          scale: Vector3.create(1, 1, 1),
          src: ASSETS.enemyFighter,
          colliderScale: Vector3.create(1.5, 2, 1.5),
          animations: [
            { clip: 'idle', playing: true, loop: true },
            { clip: 'walk', playing: false, loop: true },
            { clip: 'attack', playing: false, loop: false },
            { clip: 'impact', playing: false, loop: false },
            { clip: 'die', playing: false, loop: false }
          ]
        }, true, team) as Building)
      : definition
      ? (createSelectableModel(kind, name, {
          position,
          scale,
          src: getBuildableModelSrc(kind),
          colliderScale: kind === 'temple' ? MODEL_TRANSFORMS.hq.colliderScale : undefined,
          rotationY
        }, true, team) as Building)
      : (createSelectableBox(kind, name, {
          position,
          scale,
          color,
          emissive: Color4.create(color.r * 0.25, color.g * 0.25, color.b * 0.25, 1)
        }, team) as Building)

  building.hp = hp
  building.maxHp = hp
  building.constructionState = constructionState
  building.constructionProgress = constructionState === 'complete' ? 1 : 0
  building.buildTime = definition?.buildTime ?? 0
  building.isComplete = constructionState === 'complete'
  building.team = team
  return building
}

function getBuildingScale(kind: Building['kind'], definition?: BuildingDefinition): Vector3 {
  if (definition) return definition.scale
  if (kind === 'enemyBuilding') return Vector3.create(1.6, 1.6, 1.6)

  return Vector3.create(1.8, 1.2, 1.8)
}

function getBuildingColor(kind: Building['kind'], definition?: BuildingDefinition): Color4 {
  if (definition) return definition.color
  if (kind === 'enemyBuilding') return COLORS.enemy

  return COLORS.temple
}

function createSelectableBox(kind: SelectableKind, name: string, box: BoxConfig, team: Team = 'player'): Selectable {
  const id = createEntityId(kind)
  const entity = createBoxEntity(box)
  const selectable: Selectable = { id, kind, name, entity, alive: true, team }

  selectables.set(id, selectable)
  registerSelectable(selectable)
  return selectable
}

function createSelectableModel(kind: SelectableKind, name: string, model: ModelConfig, registerOnCreate = true, team: Team = 'player'): Selectable {
  const id = createEntityId(kind)
  const entity = createModelEntity(model)
  const selectable: Selectable = { id, kind, name, entity, alive: true, team }

  if (kind === 'worker' || kind === 'soldier') {
    selectable.colliderEntity = createModelColliderEntity(entity, model)
  }
  selectables.set(id, selectable)
  if (registerOnCreate) {
    registerSelectable(selectable)
  }
  return selectable
}

function createGhostBuilding(definition: BuildingDefinition, position: Vector3): BuildingPreview {
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(position.x, 0, position.z),
    scale: Vector3.create(1, 1, 1)
  })

  const footprint = createVisualBoxEntity({
    position: Vector3.create(0, BUILDING_FOOTPRINT_Y, 0),
    scale: Vector3.create(definition.scale.x, BUILDING_FOOTPRINT_HEIGHT, definition.scale.z),
    color: BUILDING_FOOTPRINT_VALID,
    emissive: Color4.create(0.04, 0.22, 0.08, 1),
    transparent: true
  })
  Transform.getMutable(footprint).parent = root

  const model = engine.addEntity()
  Transform.create(model, {
    parent: root,
    position: Vector3.create(0, definition.placementY, 0),
    rotation: Quaternion.fromEulerDegrees(0, 0, 0),
    scale: cloneVector(definition.scale)
  })
  GltfContainer.create(model, {
    src: getBuildableModelSrc(definition.kind),
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })

  return {
    ghostEntity: root,
    ghostFootprintEntity: footprint,
    ghostModelEntity: model
  }
}

function getBuildableModelSrc(kind: BuildableKind): string {
  if (kind === 'temple') return ASSETS.hq
  if (kind === 'fireplace') return ASSETS.fireplace
  return kind === 'supplyHouse' ? ASSETS.supply : ASSETS.barracks
}

function registerSelectable(selectable: Selectable): void {
  const pointerTarget = selectable.colliderEntity ?? selectable.entity

  ensurePointerCollider(pointerTarget)
  registerPointerHandler(pointerTarget, selectable)
  // Units click via an invisible collider box, which the client can't outline on hover.
  // Registering the visible model too makes the character glow like other selectables.
  if (selectable.colliderEntity) {
    registerPointerHandler(selectable.entity, selectable)
  }
}

function registerPointerHandler(target: Entity, selectable: Selectable): void {
  pointerEventsSystem.onPointerDown(
    {
      entity: target,
      opts: {
        button: InputAction.IA_POINTER,
        hoverText: getHoverText(selectable),
        maxDistance: CONFIG.commandRange
      }
    },
    () => handleSelectableClick(selectable.id)
  )
}

function ensurePointerCollider(entity: Entity): void {
  if (!MeshCollider.has(entity)) {
    MeshCollider.setBox(entity)
  }
}

function handleSelectableClick(id: string): void {
  const clicked = selectables.get(id)

  if (!clicked || !clicked.alive) return

  if (placementState.state === 'placing') {
    confirmBuildingPlacement()
    return
  }

  // The pending spawn-point click is handled globally; don't also run selection commands.
  if (rallyPlacementKind !== 'none') return

  if (soldierCommandMode === 'move') {
    if (isEnemyAttackTarget(clicked)) {
      assignCommandableSoldiersToAttack(clicked)
    } else {
      cancelSoldierCommand()
      setStatus('Move cancelled. Click open ground after pressing Move.')
    }
    return
  }

  if (soldierCommandMode === 'attack') {
    if (isEnemyAttackTarget(clicked)) {
      assignCommandableSoldiersToAttack(clicked)
    } else {
      cancelSoldierCommand()
      setStatus('Attack cancelled. Click an enemy building, guard, or worker after pressing Attack.')
    }
    return
  }

  const selectedWorkers = getSelectedWorkers()

  if (selectedWorkers.length > 0 && clicked.kind === 'resource') {
    assignWorkersToResource(selectedWorkers, clicked as ResourceNode)
    return
  }

  if (selectedWorkers.length > 0 && isPlayerRepairTarget(clicked)) {
    assignWorkerToRepair(selectedWorkers[0], clicked)
    return
  }

  if (getSelectedSoldiers().length > 0 && isEnemyAttackTarget(clicked)) {
    assignCommandableSoldiersToAttack(clicked)
    return
  }

  selectObject(clicked)
}

function selectObject(selectable: Selectable): void {
  gameState.selectedId = selectable.id
  gameState.selectedKind = selectable.kind
  gameState.selectedUnitIds = selectable.kind === 'worker' || selectable.kind === 'soldier' ? [selectable.id] : []
  setStatus(`Selected ${selectable.name}.`)
}

function clearSelection(): void {
  gameState.selectedId = ''
  gameState.selectedKind = ''
  gameState.selectedUnitIds = []
  cancelSoldierCommand()
  clearSelectionMarkers()
}

function assignWorkerToResource(worker: Worker, resource: ResourceNode, announce = true): void {
  if (!worker.alive || !resource.alive || resource.amount <= 0) return
  if (worker.state === 'movingToBuild' || worker.state === 'constructing' || worker.state === 'movingToRepair' || worker.state === 'repairing') {
    setStatus(`${worker.name} is busy.`)
    return
  }

  worker.state = 'movingToResource'
  worker.targetResourceId = resource.id
  worker.buildSiteId = undefined
  worker.repairTargetId = undefined
  worker.rallyPoint = undefined
  worker.timer = 0
  worker.carrying = 0
  worker.carryingResource = undefined
  setWorkerAnimation(worker, 'walk')
  if (announce) {
    setStatus(`${worker.name} gathering ${resource.name}.`)
    clearSelection()
  }
}

function assignWorkersToResource(assignedWorkers: Worker[], resource: ResourceNode): void {
  for (const worker of assignedWorkers) {
    assignWorkerToResource(worker, resource, false)
  }

  clearSelection()
  setStatus(`${assignedWorkers.length} worker${assignedWorkers.length === 1 ? '' : 's'} gathering ${resource.name}.`)
}

function sendWorkerToRally(worker: Worker, rallyPoint: Vector3): void {
  worker.state = 'movingToRally'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
  worker.repairTargetId = undefined
  worker.timer = 0
  worker.carrying = 0
  worker.carryingResource = undefined
  worker.rallyPoint = cloneVector(rallyPoint)
  setWorkerAnimation(worker, 'walk')
}

function sendSoldierToRally(soldier: Soldier, rallyPoint: Vector3): void {
  soldier.state = 'movingToRally'
  soldier.targetId = undefined
  soldier.attackPosition = undefined
  soldier.rallyPoint = cloneVector(rallyPoint)
  soldier.attackTimer = 0
  setSoldierAnimation(soldier, 'walk')
}

function assignSoldierToAttack(soldier: Soldier, target: Building | Soldier | Worker, slot = 0): void {
  if (!soldier.alive || !target.alive) return
  if (getTeam(soldier) === getTeam(target)) return

  soldier.state = 'movingToAttack'
  soldier.targetId = target.id
  soldier.attackPosition = target.kind === 'soldier' || target.kind === 'worker' ? undefined : getSoldierAttackPosition(target, slot)
  soldier.rallyPoint = undefined
  soldier.attackTimer = 0
  setSoldierAnimation(soldier, 'walk')
  if (getTeam(soldier) === 'player') setStatus(`${soldier.name} attacking ${target.name}.`)
}

function assignWorkerToRepair(worker: Worker, building: Building): void {
  if (!worker.alive || !building.alive || !building.isComplete) return
  if (getTeam(worker) !== getTeam(building)) return
  if (building.hp >= building.maxHp) {
    setStatus(`${building.name} does not need repairs.`)
    return
  }
  if (worker.state === 'movingToBuild' || worker.state === 'constructing' || worker.state === 'movingToRepair' || worker.state === 'repairing') {
    setStatus(`${worker.name} is busy.`)
    return
  }

  worker.state = 'movingToRepair'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
  worker.repairTargetId = building.id
  worker.rallyPoint = undefined
  worker.timer = 0
  worker.carrying = 0
  worker.carryingResource = undefined
  setWorkerAnimation(worker, 'walk')
  clearSelection()
  setStatus(`${worker.name} moving to repair ${building.name}.`)
}

function assignCommandableSoldiersToAttack(target: Building | Soldier | Worker): void {
  const assignedSoldiers = getCommandableSoldiers()

  if (assignedSoldiers.length === 0) {
    setStatus(`Select an ${SOLDIER_DEFINITION.name} first.`)
    return
  }

  for (let i = 0; i < assignedSoldiers.length; i++) {
    assignSoldierToAttack(assignedSoldiers[i], target, i)
  }

  clearSelection()
  setStatus(`${assignedSoldiers.length} ${SOLDIER_DEFINITION.name}s attacking ${target.name}.`)
}

function moveCommandableSoldiersTo(destination: Vector3): void {
  const assignedSoldiers = getCommandableSoldiers()

  if (assignedSoldiers.length === 0) {
    cancelSoldierCommand()
    setStatus(`Select an ${SOLDIER_DEFINITION.name} first.`)
    return
  }

  for (let i = 0; i < assignedSoldiers.length; i++) {
    const soldier = assignedSoldiers[i]
    const movePosition = getFormationPosition(destination, i, SOLDIER_MOVE_FORMATION_RADIUS)
    sendSoldierToRally(soldier, Vector3.create(movePosition.x, 0.25, movePosition.z))
  }

  showMoveMarker(destination)
  clearSelection()
  setStatus(`${assignedSoldiers.length} ${SOLDIER_DEFINITION.name}${assignedSoldiers.length === 1 ? '' : 's'} moving.`)
}

function confirmBuildingPlacement(hitPosition?: Vector3): void {
  if (placementState.state !== 'placing') return

  const definition = BUILDING_DEFINITIONS[placementState.buildingKind]
  const builder = getWorkerById(placementState.builderWorkerId)
  const position = hitPosition ?? currentBuildingPreviewPosition ?? getCurrentBuildingPlacement(definition)?.center

  if (!builder?.alive) {
    cancelPlacement()
    setStatus('Builder is no longer available.')
    return
  }

  if (!position) {
    setStatus('Player position is not ready yet.')
    return
  }

  if (!canPlaceBuildingAt(definition, position)) {
    setStatus(`Cannot place ${definition.name} there. Move the footprint to an open area.`)
    return
  }

  if (!spendResources(builder.team ?? 'player', definition.cost)) {
    cancelPlacement()
    setStatus(`Need ${formatCost(definition.cost)} to build ${definition.name}.`)
    return
  }

  const buildPosition = Vector3.create(position.x, definition.placementY, position.z)
  const site = createConstructionSite(definition.kind, buildPosition, builder.id, currentBuildingPreviewRotationY, builder.team ?? 'player')

  builder.state = 'movingToBuild'
  builder.targetResourceId = undefined
  builder.buildSiteId = site.id
  builder.repairTargetId = undefined
  builder.rallyPoint = undefined
  builder.timer = 0
  builder.carrying = 0
  builder.carryingResource = undefined
  setWorkerAnimation(builder, 'walk')
  cancelPlacement()
  clearSelection()
  setStatus(`${builder.name} moving to build ${definition.name}.`)
}

function cancelPlacement(): void {
  if (placementState.state === 'placing') {
    hideEntity(placementState.ghostEntity)
  }

  placementState = { state: 'none' }
  gameState.placementMode = 'none'
  gameState.placementBuildingKind = ''
  currentBuildingPreviewPosition = undefined
  currentBuildingPreviewCanPlace = false
  currentBuildingPreviewRotationY = 0
  placementConfirmCooldown = 0
}

const productionDeps = {
  getBuildingById,
  createWorker,
  createSoldier,
  getHomesteadExitPosition,
  getBarracksExitPosition,
  getHomesteadRallyPoint: (homesteadId: string) => homesteadRallyPoints.get(homesteadId),
  getBarracksRallyPoint: (barracksId: string) => barracksRallyPoints.get(barracksId),
  sendWorkerToRally,
  sendSoldierToRally,
  setStatus
}

const enemyAiDeps = {
  assignWorkerToResource,
  createConstructionSite,
  canPlaceBuildingAt,
  setWorkerAnimation,
  assignSoldierToAttack,
  getNearestTemple,
  getSnappedPlacementPosition,
  setStatus
}

const workerSystemDeps = {
  getBuildingById,
  getWorkerGatherPosition,
  getNearestTemple,
  getTempleDropoffPosition,
  getBuilderWorkPosition,
  getRepairWorkPosition: getBuilderWorkPosition,
  getWorkerRallyPosition,
  setWorkerAnimation,
  playResourceGatherFeedback,
  depleteResourceNode,
  updateLabel,
  setStatus
}

const combatSystemDeps = {
  getCombatTargetById,
  getSoldierAttackPosition,
  getUnitAttackPosition,
  setSoldierAnimation,
  damageCombatTarget,
  setStatus
}

const dragSelectDeps = {
  isBlocked: () =>
    placementState.state === 'placing' ||
    soldierCommandMode !== 'none' ||
    rallyPlacementKind !== 'none' ||
    gameState.matchStatus !== MATCH_ACTIVE,
  onBoxSelect: selectPlayerUnitsInRect,
  isPressOnSelectable: isPointerPressOnSelectable,
  onGroundClick: moveSelectedUnitsTo
}

function isPointerPressOnSelectable(): boolean {
  const command = inputSystem.getInputCommand(InputAction.IA_POINTER, PointerEventType.PET_DOWN)
  const hitEntityId = command?.hit?.entityId
  if (hitEntityId === undefined) return false

  for (const selectable of selectables.values()) {
    if (selectable.entity === hitEntityId) return true
    if (selectable.colliderEntity === hitEntityId) return true
  }
  return false
}

/** Plain ground click with units selected = walk there, classic RTS style. */
function moveSelectedUnitsTo(point: { x: number; z: number }): void {
  const movableWorkers = getSelectedWorkers().filter(
    (worker) =>
      worker.alive &&
      getTeam(worker) === 'player' &&
      worker.state !== 'movingToBuild' &&
      worker.state !== 'constructing' &&
      worker.state !== 'movingToRepair' &&
      worker.state !== 'repairing'
  )
  const movableSoldiers = getSelectedSoldiers().filter((soldier) => soldier.alive && getTeam(soldier) === 'player')
  const unitCount = movableWorkers.length + movableSoldiers.length
  if (unitCount === 0) return

  const destination = Vector3.create(point.x, 0.25, point.z)
  // Workers spread around a shared rally point on arrival; soldiers get explicit formation slots.
  for (const worker of movableWorkers) {
    sendWorkerToRally(worker, destination)
  }
  for (let i = 0; i < movableSoldiers.length; i++) {
    const slotPosition = getFormationPosition(destination, i, SOLDIER_MOVE_FORMATION_RADIUS)
    sendSoldierToRally(movableSoldiers[i], Vector3.create(slotPosition.x, 0.25, slotPosition.z))
  }

  showMoveMarker(point)
  setStatus(`${unitCount} unit${unitCount === 1 ? '' : 's'} moving.`)
}

let autoGatherTimer = 0

/** Idle player workers pick up the nearest resource within range, so parking workers near a forest puts them to work. */
function updateWorkerAutoGather(dt: number): void {
  autoGatherTimer += dt
  if (autoGatherTimer < 1) return
  autoGatherTimer = 0

  for (const worker of workers) {
    if (!worker.alive || getTeam(worker) !== 'player' || worker.state !== 'idle') continue

    const resource = getNearestGatherableResource(Transform.get(worker.entity).position)
    if (resource) assignWorkerToResource(worker, resource, false)
  }
}

function getNearestGatherableResource(position: Vector3): ResourceNode | undefined {
  let nearest: ResourceNode | undefined
  let nearestDistance = CONFIG.workerAutoGatherRange

  for (const resource of resources) {
    if (!resource.alive || resource.amount <= 0) continue

    const distance = distanceToPoint(Transform.get(resource.entity).position, position)
    if (distance < nearestDistance) {
      nearest = resource
      nearestDistance = distance
    }
  }
  return nearest
}

function selectPlayerUnitsInRect(min: { x: number; z: number }, max: { x: number; z: number }): void {
  const unitsInRect: (Worker | Soldier)[] = []

  for (const worker of workers) {
    if (worker.alive && getTeam(worker) === 'player' && isInRect(worker, min, max)) unitsInRect.push(worker)
  }
  for (const soldier of soldiers) {
    if (soldier.alive && getTeam(soldier) === 'player' && isInRect(soldier, min, max)) unitsInRect.push(soldier)
  }

  if (unitsInRect.length === 0) {
    clearSelection()
    setStatus('Nothing selected.')
    return
  }

  // Fighting selections should command soldiers, so put them first when mixed.
  unitsInRect.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'soldier' ? -1 : 1))
  setUnitSelection(unitsInRect)
  setStatus(`Selected ${unitsInRect.length} unit${unitsInRect.length === 1 ? '' : 's'}.`)
}

function isInRect(unit: Worker | Soldier, min: { x: number; z: number }, max: { x: number; z: number }): boolean {
  const position = Transform.get(unit.entity).position
  return position.x >= min.x && position.x <= max.x && position.z >= min.z && position.z <= max.z
}

function rtsTickSystem(dt: number): void {
  updateMatchTimer(dt)
  updateAttackAlert(dt)
  if (gameState.matchStatus !== MATCH_ACTIVE) return

  updateCoordinateLogger(dt)
  updateGhostPreview()
  updatePlacementConfirmInput(dt)
  updateSoldierMoveCommandInput(dt)
  updateRallyPlacementInput(dt)
  updateCancelInput()
  updateDragSelect(dragSelectDeps)
  updateWorkerAutoGather(dt)
  updateRallyMarker()
  updateSelectionMarkers(getSelectionMarkerTargets())
  updateWorkerProductionSystem(dt, productionDeps)
  updateSoldierProductionSystem(dt, productionDeps)
  updateEnemyAiSystem(dt, enemyAiDeps)
  updateWorkersSystem(dt, workerSystemDeps)
  updateSoldiersSystem(dt, combatSystemDeps)
  updateConstructionSites(dt)
  updateBuildingDamageVfxSystem()
  updateDepletedResources(dt)
  updateMatchEndState()
}

function getSelectionMarkerTargets(): SelectionMarkerTarget[] {
  const units = getSelectedUnits()
  if (units.length > 0) {
    return units.map(getSelectionMarkerTarget)
  }

  const selected = getSelected()
  return selected?.alive ? [getSelectionMarkerTarget(selected)] : []
}

function getSelectionMarkerTarget(selectable: Selectable): SelectionMarkerTarget {
  const transform = Transform.get(selectable.entity)

  return {
    position: transform.position,
    diameter: Math.max(transform.scale.x, transform.scale.z) + 0.55
  }
}

function updateMatchTimer(dt: number): void {
  if (gameState.matchStatus === MATCH_ACTIVE) {
    gameState.matchTime += dt
  }
}

function isMatchActive(): boolean {
  if (gameState.matchStatus === MATCH_ACTIVE) return true

  setStatus('The match is over. Use Replay to start again.')
  return false
}

function updateCoordinateLogger(dt: number): void {
  coordinateLogTimer += dt
  if (coordinateLogTimer < 1) return

  coordinateLogTimer = 0
  const position = getPlayerPosition()
  if (!position) return

  gameState.currentPlayerLocation = formatPosition(position)
  console.log(`[coords] player ${gameState.currentPlayerLocation}`)
}

function updateAttackAlert(dt: number): void {
  if (gameState.attackAlertTimer <= 0) return

  gameState.attackAlertTimer = Math.max(0, gameState.attackAlertTimer - dt)
  if (gameState.attackAlertTimer === 0) {
    gameState.attackAlert = ''
  }
}

function updateMatchEndState(): void {
  if (gameState.matchStatus === MATCH_ENDED) return

  const playerTemplesAlive = buildings.some((building) => building.alive && building.kind === 'temple' && getTeam(building) === 'player')
  const enemyTemplesAlive = buildings.some((building) => building.alive && building.kind === 'temple' && getTeam(building) === 'enemy')

  if (!playerTemplesAlive) {
    endMatch('loss')
  } else if (!enemyTemplesAlive) {
    endMatch('win')
  }
}

function endMatch(result: 'win' | 'loss'): void {
  if (gameState.matchStatus === MATCH_ENDED) return

  gameState.matchStatus = MATCH_ENDED
  gameState.matchResult = result
  gameState.attackAlert = ''
  gameState.attackAlertTimer = 0
  disableTopDownView()
  cancelSoldierCommand()
  cancelPlacement()
  clearSelection()
  const time = formatRuntimeMatchTime(gameState.matchTime)
  setStatus(result === 'win' ? `You destroyed every AI Temple in ${time}. Victory!` : `All player Temples were destroyed after ${time}. You lose.`)
}

function updateGhostPreview(): void {
  if (placementState.state !== 'placing') return

  const definition = BUILDING_DEFINITIONS[placementState.buildingKind]
  const placement = getCurrentBuildingPlacement(definition)
  if (!placement) return

  currentBuildingPreviewPosition = placement.center
  currentBuildingPreviewCanPlace = canPlaceBuildingAt(definition, placement.center)

  const ghostRoot = Transform.getMutable(placementState.ghostEntity)
  ghostRoot.position = Vector3.create(placement.center.x, 0, placement.center.z)
  ghostRoot.rotation = Quaternion.fromEulerDegrees(0, currentBuildingPreviewRotationY, 0)
  Transform.getMutable(placementState.ghostModelEntity).rotation = Quaternion.fromEulerDegrees(0, 0, 0)
  updateFootprintMaterial(placementState.ghostFootprintEntity, currentBuildingPreviewCanPlace)
}

function updatePlacementConfirmInput(dt: number): void {
  if (placementState.state !== 'placing') return

  if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) {
    currentBuildingPreviewRotationY = (currentBuildingPreviewRotationY + 90) % 360
  }

  placementConfirmCooldown = Math.max(0, placementConfirmCooldown - dt)
  if (placementConfirmCooldown > 0) return
  if (!inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return

  confirmBuildingPlacement()
}

function updateSoldierMoveCommandInput(dt: number): void {
  if (soldierCommandMode !== 'move' && soldierCommandMode !== 'attack') return
  if (placementState.state === 'placing') return

  soldierCommandCooldown = Math.max(0, soldierCommandCooldown - dt)
  if (soldierCommandCooldown > 0) return
  if (soldierCommandMode === 'attack') return
  if (!inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return

  const destination = getPointerGroundPosition()
  if (!destination) {
    setStatus('Move command needs a ground click.')
    return
  }

  moveCommandableSoldiersTo(Vector3.create(destination.x, 0.25, destination.z))
}

function updateCancelInput(): void {
  const secondaryIsPressed = inputSystem.isPressed(InputAction.IA_SECONDARY)
  const actionIsPressed = inputSystem.isPressed(InputAction.IA_ACTION_3)
  const secondaryWasTriggered =
    inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN) ||
    (secondaryIsPressed && !secondaryCancelWasPressed)
  const actionWasTriggered =
    inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN) ||
    (actionIsPressed && !actionCancelWasPressed)

  secondaryCancelWasPressed = secondaryIsPressed
  actionCancelWasPressed = actionIsPressed
  if (!secondaryWasTriggered && !actionWasTriggered) return

  if (placementState.state === 'placing') {
    cancelBuildingPlacement()
    return
  }

  if (soldierCommandMode !== 'none') {
    cancelSoldierCommand()
    setStatus(`${SOLDIER_DEFINITION.name} command cancelled.`)
    return
  }

  if (rallyPlacementKind !== 'none') {
    cancelRallyPlacement()
    setStatus('Spawn point placement cancelled.')
    return
  }

  const selected = getSelected()
  if (isCancellableConstruction(selected)) {
    cancelConstruction(selected)
  }
}

function updateRallyMarker(): void {
  if (!rallyMarker) return

  const position = getSelectedRallyPoint()
  if (!position) {
    hideEntity(rallyMarker.root)
    return
  }

  Transform.getMutable(rallyMarker.root).position = Vector3.create(position.x, 0, position.z)
}

function updateConstructionSites(dt: number): void {
  for (const site of buildings) {
    if (site.isComplete || !site.builderWorkerId) continue

    const builder = getWorkerById(site.builderWorkerId)

    if (!builder?.alive || builder.buildSiteId !== site.id) {
      pauseConstruction(site)
      continue
    }

    if (distanceToPosition(builder.entity, getBuilderWorkPosition(site, Transform.get(builder.entity).position)) > 0.8) {
      pauseConstruction(site, builder)
      continue
    }

    site.constructionState = 'building'
    builder.state = 'constructing'
    site.constructionProgress = Math.min(1, site.constructionProgress + dt / site.buildTime)
    updateConstructionVisual(site)

    if (site.constructionProgress >= 1) {
      completeConstruction(site, builder)
    }
  }
}

function updateDepletedResources(dt: number): void {
  for (const resource of resources) {
    if (resource.depletionTimer === undefined) continue

    resource.depletionTimer -= dt
    if (resource.depletionTimer <= 0) {
      hideEntity(resource.entity)
      resource.depletionTimer = undefined
    }
  }
}

function updateBuildingDamageVfxSystem(): void {
  for (const building of buildings) {
    updateBuildingDamageVfxForBuilding(building)
  }
}

function updateBuildingDamageVfxForBuilding(building: Building): void {
  if (!building.alive || !building.isComplete || building.hp <= 0) {
    clearBuildingDamageVfx(building)
    return
  }

  const level = getBuildingDamageVfxLevel(building)
  if (level === 0) {
    clearBuildingDamageVfx(building)
    return
  }

  const position = getBuildingDamageVfxPosition(building)
  if (!building.damageVfxEntity) {
    building.damageVfxEntity = createBuildingDamageVfx(position, level)
  } else {
    updateBuildingDamageVfx(building.damageVfxEntity, position, level)
  }
  building.damageVfxLevel = level
}

function getBuildingDamageVfxLevel(building: Building): number {
  const hpPercent = building.hp / building.maxHp
  if (hpPercent <= 0.2) return 2.2
  if (hpPercent <= 0.4) return 1.55
  if (hpPercent <= 0.7) return 1
  return 0
}

function getBuildingDamageVfxPosition(building: Building): Vector3 {
  const transform = Transform.get(building.entity)
  const height = Math.max(transform.scale.y * 0.45, 1.4)

  return Vector3.create(transform.position.x, transform.position.y + height, transform.position.z)
}

function clearBuildingDamageVfx(building: Building): void {
  removeBuildingDamageVfx(building.damageVfxEntity)
  building.damageVfxEntity = undefined
  building.damageVfxLevel = undefined
}

function pauseConstruction(site: Building, builder?: Worker): void {
  if (site.constructionState !== 'paused') {
    site.constructionState = 'paused'
    updateLabel(site, `${site.name}\nNeeds worker`)
  }

  if (builder?.alive) {
    builder.state = 'movingToBuild'
    setWorkerAnimation(builder, 'walk')
  }
}

function completeConstruction(site: Building, builder: Worker): void {
  const definition = BUILDING_DEFINITIONS[site.kind as BuildableKind]

  site.constructionState = 'complete'
  site.constructionProgress = 1
  site.isComplete = true
  site.name = definition.name
  builder.state = 'idle'
  builder.buildSiteId = undefined
  builder.repairTargetId = undefined
  setWorkerAnimation(builder, 'idle')
  updateConstructionVisual(site)
  updateLabel(site, definition.name)

  if (definition.supplyAdds > 0) {
    addSupplyCap(getTeam(site), definition.supplyAdds)
  }

  if (getTeam(site) === 'player') {
    setStatus(definition.completeStatus)
  }
}

function damageCombatTarget(target: Building | Soldier | Worker, amount: number, attacker: Soldier): void {
  if (target.kind === 'soldier') {
    damageSoldier(target, amount, attacker)
    return
  }

  if (target.kind === 'worker') {
    damageWorker(target, amount, attacker)
    return
  }

  damageBuilding(target, amount, attacker)
}

function damageBuilding(building: Building, amount: number, attacker?: Soldier): void {
  building.hp = Math.max(0, building.hp - amount)
  if (attacker && isPlayerTempleUnderAttack(building, attacker)) {
    showPlayerAttackAlert()
  }
  if (attacker) alertDefenders(building, attacker)

  if (building.hp > 0) {
    if (building.kind === 'enemyBuilding') playAnimation(building.entity, 'impact')
    if (!isPlayerTempleUnderAttack(building, attacker)) setStatus(`${building.name} HP: ${building.hp}/${building.maxHp}.`)
    return
  }

  if (building.kind === 'enemyBuilding') playAnimation(building.entity, 'die')
  removeSelectable(building)
  removeBuilding(building)
  clearAttackersTargeting(building.id)

  setStatus(`${building.name} destroyed.`)
  updateMatchEndState()
}

function isPlayerTempleUnderAttack(building: Building, attacker?: Soldier): boolean {
  return building.kind === 'temple' && getTeam(building) === 'player' && attacker !== undefined && getTeam(attacker) === 'enemy'
}

function showPlayerAttackAlert(): void {
  gameState.attackAlert = 'Your HQ is under attack!'
  gameState.attackAlertTimer = PLAYER_ATTACK_ALERT_DURATION
  setStatus(gameState.attackAlert)
}

function damageSoldier(soldier: Soldier, amount: number, attacker?: Soldier): void {
  soldier.hp = Math.max(0, soldier.hp - amount)

  if (soldier.hp > 0) return

  creditUnitKill(attacker, soldier)
  soldier.state = 'dead'
  soldier.targetId = undefined
  soldier.attackPosition = undefined
  soldier.rallyPoint = undefined
  addSupplyUsed(getTeam(soldier), -SOLDIER_DEFINITION.supply)
  removeSelectable(soldier)
  clearAttackersTargeting(soldier.id)
}

function damageWorker(worker: Worker, amount: number, attacker?: Soldier): void {
  worker.hp = Math.max(0, worker.hp - amount)

  if (worker.hp > 0) return

  creditUnitKill(attacker, worker)

  worker.state = 'dead'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
  worker.repairTargetId = undefined
  worker.rallyPoint = undefined
  worker.carrying = 0
  worker.carryingResource = undefined
  addSupplyUsed(getTeam(worker), -1)
  removeSelectable(worker)
  clearAttackersTargeting(worker.id)
}

function creditUnitKill(attacker: Soldier | undefined, target: Soldier | Worker): void {
  if (!attacker || getTeam(attacker) === getTeam(target)) return

  gameState.matchStats[getTeam(attacker)].unitsKilled += 1
}

function clearAttackersTargeting(targetId: string): void {
  for (const attacker of soldiers) {
    if (attacker.targetId !== targetId) continue

    attacker.targetId = undefined
    attacker.attackPosition = undefined
    attacker.state = 'idle'
    setSoldierAnimation(attacker, 'idle')
  }
}

function alertDefenders(building: Building, attacker: Soldier): void {
  if (getTeam(building) !== 'enemy' || getTeam(attacker) !== 'player' || !attacker.alive) return

  const buildingPosition = Transform.get(building.entity).position
  const defenders = soldiers.filter((soldier) => {
    if (!soldier.alive || getTeam(soldier) !== 'enemy') return false
    if (soldier.state !== 'idle' && soldier.state !== 'movingToRally') return false
    return distanceToPoint(Transform.get(soldier.entity).position, buildingPosition) <= ENEMY_DEFENSE_RADIUS
  })

  for (let i = 0; i < defenders.length; i++) {
    assignSoldierToAttack(defenders[i], attacker, i)
  }
}

function cancelConstruction(site: Building): void {
  if (!isCancellableConstruction(site)) return

  const definition = BUILDING_DEFINITIONS[site.kind]
  const refundedCost = getConstructionRefund(definition.cost, site.constructionProgress)
  const builder = site.builderWorkerId ? getWorkerById(site.builderWorkerId) : undefined

  addResources(getTeam(site), refundedCost)
  if (builder?.alive && builder.buildSiteId === site.id) {
    builder.state = 'idle'
    builder.buildSiteId = undefined
    setWorkerAnimation(builder, 'idle')
  }

  removeSelectable(site)
  removeBuilding(site)
  setStatus(`Cancelled ${definition.name}. Refunded ${formatCost(refundedCost)}.`)
}

function updateConstructionVisual(site: Building): void {
  if (!isBuildableKind(site.kind)) return

  const definition = BUILDING_DEFINITIONS[site.kind]
  const progress = site.isComplete ? 1 : Math.max(0.05, site.constructionProgress)
  const transform = Transform.getMutable(site.entity)

  transform.position = Vector3.create(transform.position.x, definition.placementY * progress, transform.position.z)
  transform.scale = Vector3.create(definition.scale.x, definition.scale.y * progress, definition.scale.z)
  if (MeshRenderer.has(site.entity)) {
    Material.setPbrMaterial(site.entity, {
      albedoColor: site.isComplete ? definition.color : COLORS.construction,
      emissiveColor: site.isComplete ? Color4.create(definition.color.r * 0.25, definition.color.g * 0.25, definition.color.b * 0.25, 1) : Color4.Black()
    })
  }

  if (!site.isComplete) {
    updateLabel(site, `${definition.name}\n${Math.floor(site.constructionProgress * 100)}%`)
  }
}

function isBuildableKind(kind: Building['kind']): kind is BuildableKind {
  return kind === 'temple' || kind === 'supplyHouse' || kind === 'barracks' || kind === 'fireplace'
}

function isCancellableConstruction(selectable: Selectable | undefined): selectable is Building & { kind: BuildableKind } {
  return !!selectable && isBuildableKind(selectable.kind as Building['kind']) && !(selectable as Building).isComplete
}

function getSelected(): Selectable | undefined {
  return gameState.selectedId ? selectables.get(gameState.selectedId) : undefined
}

function getSelectedUnits(): (Worker | Soldier)[] {
  const units: (Worker | Soldier)[] = []
  for (const id of gameState.selectedUnitIds) {
    const selectable = selectables.get(id)
    if (selectable?.alive && (selectable.kind === 'worker' || selectable.kind === 'soldier')) {
      units.push(selectable as Worker | Soldier)
    }
  }
  return units
}

function getSelectedWorkers(): Worker[] {
  return getSelectedUnits().filter((unit): unit is Worker => unit.kind === 'worker')
}

function getSelectedSoldiers(): Soldier[] {
  return getSelectedUnits().filter((unit): unit is Soldier => unit.kind === 'soldier')
}

function setUnitSelection(units: (Worker | Soldier)[]): void {
  gameState.selectedUnitIds = units.map((unit) => unit.id)
  gameState.selectedId = units[0]?.id ?? ''
  gameState.selectedKind = units[0]?.kind ?? ''
}

function getWorkerById(id: string): Worker | undefined {
  return workers.find((worker) => worker.id === id)
}

function getAvailableWorkers(): Worker[] {
  return getAvailableWorkersForTeam('player')
}

function getIdleWorkers(): Worker[] {
  return workers.filter((worker) => worker.alive && worker.state === 'idle' && getTeam(worker) === 'player')
}

function getAvailableSoldiers(): Soldier[] {
  return soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === 'player')
}

function getCommandableSoldiers(): Soldier[] {
  return getSelectedSoldiers()
}

function isEnemyAttackTarget(selectable: Selectable): selectable is Building | Soldier | Worker {
  return selectable.kind !== 'resource' && getTeam(selectable) === 'enemy'
}

function isPlayerRepairTarget(selectable: Selectable): selectable is Building {
  if (selectable.kind === 'resource' || selectable.kind === 'worker' || selectable.kind === 'soldier') return false
  const building = selectable as Building

  return getTeam(building) === 'player' && building.isComplete && building.hp < building.maxHp
}

function getBuildingById(id: string): Building | undefined {
  return buildings.find((building) => building.id === id)
}

function getCombatTargetById(id: string): Building | Soldier | Worker | undefined {
  return getBuildingById(id) ?? soldiers.find((soldier) => soldier.id === id) ?? workers.find((worker) => worker.id === id)
}

function getSelectedAdjustableBuilding(): Building | undefined {
  const selected = getSelected()

  return selected?.kind === 'temple' || selected?.kind === 'supplyHouse' || selected?.kind === 'barracks' || selected?.kind === 'fireplace' ? (selected as Building) : undefined
}

function getSelectedRallyPoint(): Vector3 | undefined {
  const selected = getSelected()

  if (selected?.kind === 'supplyHouse') return homesteadRallyPoints.get(selected.id)
  if (selected?.kind === 'barracks') return barracksRallyPoints.get(selected.id)
  return undefined
}

function getStartingTemple(): Building | undefined {
  return buildings.find((building) => building.kind === 'temple' && building.alive && getTeam(building) === 'player')
}

function getBuildingDetail(building: Building): string {
  if (!building.isComplete) {
    const progress = Math.floor(building.constructionProgress * 100)
    return building.constructionState === 'paused' ? `Construction paused: needs worker (${progress}%)` : `Building: ${progress}%`
  }

  if (building.kind === 'temple') {
    const templePosition = Transform.get(building.entity).position
    if (getTeam(building) === 'enemy') return `Enemy Temple: AI resource dropoff. Location ${formatPosition(templePosition)}.`
    return `Temple: workers deliver resources here. Location ${formatPosition(templePosition)}.`
  }
  if (building.kind === 'supplyHouse') {
    const rallyPoint = homesteadRallyPoints.get(building.id)
    return rallyPoint ? `Homestead: creates workers and adds supply. Spawn ${formatPosition(rallyPoint)}.` : 'Homestead: creates workers and adds supply.'
  }
  if (building.kind === 'barracks') {
    const rallyPoint = barracksRallyPoints.get(building.id)
    return rallyPoint ? `Complete: creates soldiers. Spawn ${formatPosition(rallyPoint)}.` : 'Complete: creates soldiers'
  }
  if (building.kind === 'fireplace') return 'Complete: camp utility building.'
  if (building.kind === 'enemyBuilding') return 'Enemy structure'

  return 'Complete'
}

function getPlacementInstruction(): string {
  if (placementState.state !== 'placing') return ''

  return `Placing ${BUILDING_DEFINITIONS[placementState.buildingKind].name}. Click ground to place.`
}

function getHoverText(selectable: Selectable): string {
  if (selectable.kind === 'resource') {
    const resource = selectable as ResourceNode
    return resource.resource ? RESOURCE_DEFINITIONS[resource.resource].hoverText : `Select ${selectable.name}`
  }
  return `Select ${selectable.name}`
}

function formatCost(cost: ResourceCost): string {
  const parts = []

  if (cost.rocks) parts.push(`${cost.rocks} ore`)
  if (cost.wood) parts.push(`${cost.wood} crystal`)
  if (cost.meat) parts.push(`${cost.meat} plasma`)
  return parts.length > 0 ? parts.join(', ') : '0 resources'
}

function depleteResourceNode(resource: ResourceNode): void {
  resource.amount = 0
  if (resource.resource === 'meat') {
    resource.alive = false
    resource.depletionTimer = DEPLETED_MEAT_HIDE_DELAY
    removeSelectableInteractivity(resource)
    playResourceDepletion(resource.entity)
    selectables.delete(resource.id)
    setStatus(`${resource.name} is depleted.`)
    return
  }

  removeSelectable(resource)

  setStatus(`${resource.name} is depleted and disappeared.`)
}

function setWorkerAnimation(worker: Worker, clipName: string, restart = false): void {
  if (worker.activeAnimation === clipName && !restart) return

  if (isRobot(worker.entity)) setRobotAnimation(worker.entity, clipName)
  else playAnimation(worker.entity, clipName)
  worker.activeAnimation = clipName
}

function setSoldierAnimation(soldier: Soldier, clipName: string, restart = false): void {
  if (soldier.activeAnimation === clipName && !restart) return

  playAnimation(soldier.entity, clipName)
  soldier.activeAnimation = clipName
}

function playAnimation(entity: Entity, clipName: string): void {
  Animator.playSingleAnimation(entity, clipName, true)
}

function playResourceGatherFeedback(resource: ResourceNode): void {
  playResourceGatherPulse(resource.entity)

  const audio = AudioSource.getMutableOrNull(resource.entity)
  if (!audio) return

  audio.playing = false
  audio.playing = true
}

function updateLabel(selectable: Selectable, text: string): void {
  if (!selectable.labelEntity) return

  TextShape.getMutable(selectable.labelEntity).text = text
}

function setStatus(message: string): void {
  gameState.status = message
}

function updateFootprintMaterial(entity: Entity, canPlace: boolean): void {
  const color = canPlace ? BUILDING_FOOTPRINT_VALID : BUILDING_FOOTPRINT_BLOCKED
  Material.setPbrMaterial(entity, {
    albedoColor: color,
    emissiveColor: canPlace ? Color4.create(0.04, 0.22, 0.08, 1) : Color4.create(0.22, 0.02, 0.02, 1),
    transparencyMode: 1
  })
}

function getPlayerPosition(): Vector3 | undefined {
  if (!Transform.has(engine.PlayerEntity)) return undefined

  return Transform.get(engine.PlayerEntity).position
}

function getBuildingPreviewPosition(definition: BuildingDefinition): Vector3 | undefined {
  const pointerGroundPosition = getPointerGroundPosition()
  if (pointerGroundPosition) return pointerGroundPosition

  // Free-camera mode: fall back to the center of the view instead of the parked avatar.
  if (isTopDownViewActive()) {
    const focus = getCameraFocus()
    return getSnappedPlacementPosition(Vector3.create(focus.x, 0, focus.z))
  }

  if (!Transform.has(engine.PlayerEntity)) return undefined

  const playerTransform = Transform.get(engine.PlayerEntity)
  const rotatedForward = Vector3.rotate(Vector3.Forward(), playerTransform.rotation)
  const length = Math.sqrt(rotatedForward.x * rotatedForward.x + rotatedForward.z * rotatedForward.z)
  const forward = length > 0.001 ? Vector3.create(rotatedForward.x / length, 0, rotatedForward.z / length) : Vector3.Forward()
  const distance = Math.max(definition.scale.x, definition.scale.z) / 2 + BUILDING_PREVIEW_PADDING

  return getSnappedPlacementPosition(Vector3.create(playerTransform.position.x + forward.x * distance, 0, playerTransform.position.z + forward.z * distance))
}

function getPointerGroundPosition(): Vector3 | undefined {
  const pointerInfo = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const cameraTransform = Transform.getOrNull(engine.CameraEntity)
  const direction = pointerInfo?.worldRayDirection

  if (!direction || !cameraTransform) return undefined
  if (Math.abs(direction.y) < 0.001) return undefined

  const distanceToGround = (0 - cameraTransform.position.y) / direction.y
  if (distanceToGround < 0) return undefined

  return getSnappedPlacementPosition(
    Vector3.create(
      cameraTransform.position.x + direction.x * distanceToGround,
      0,
      cameraTransform.position.z + direction.z * distanceToGround
    )
  )
}

/** The cursor's ground point (grid-snapped) is used directly as the building center, RTS style. */
function getCurrentBuildingPlacement(definition: BuildingDefinition): { center: Vector3; rotationY: number } | undefined {
  const center = getBuildingPreviewPosition(definition)
  if (!center) return undefined

  return { center, rotationY: currentBuildingPreviewRotationY }
}

function getSnappedPlacementPosition(position: Vector3): Vector3 {
  return Vector3.create(snapToGrid(position.x), 0, snapToGrid(position.z))
}

function snapToGrid(value: number): number {
  return Math.round(value / BUILDING_PLACEMENT_GRID_SIZE) * BUILDING_PLACEMENT_GRID_SIZE
}

function canPlaceBuildingAt(definition: BuildingDefinition, position: Vector3): boolean {
  const footprintHalfSize = Math.max(definition.scale.x, definition.scale.z) / 2
  const footprintRadius = footprintHalfSize + BUILDING_PLACEMENT_PADDING

  if (!isPlacementInsideMap(position, footprintHalfSize)) return false

  for (const building of buildings) {
    if (!building.alive) continue
    if (distanceToPoint(Transform.get(building.entity).position, position) < footprintRadius + Math.max(Transform.get(building.entity).scale.x, Transform.get(building.entity).scale.z) / 2) {
      return false
    }
  }

  for (const resource of resources) {
    if (!resource.alive) continue
    if (distanceToPoint(Transform.get(resource.entity).position, position) < footprintRadius + 0.8) return false
  }

  for (const worker of workers) {
    if (!worker.alive) continue
    if (distanceToPoint(Transform.get(worker.entity).position, position) < footprintRadius + 0.35) return false
  }

  for (const soldier of soldiers) {
    if (!soldier.alive) continue
    if (distanceToPoint(Transform.get(soldier.entity).position, position) < footprintRadius + 0.45) return false
  }

  return true
}

function isPlacementInsideMap(position: Vector3, footprintRadius: number): boolean {
  return (
    position.x - footprintRadius >= 0 &&
    position.z - footprintRadius >= 0 &&
    position.x + footprintRadius <= SCENE.size &&
    position.z + footprintRadius <= SCENE.size
  )
}

function printResourcePlacementLists(): void {
  const trees = gameState.savedTreeLocations.map((location) => `  ${location}`).join(',\n')
  const rocks = gameState.savedRockLocations.map((location) => `  ${location}`).join(',\n')
  const pigs = gameState.savedMeatLocations.map((location) => `  ${location}`).join(',\n')
  const temple = getStartingTemple()
  const templeLocation = temple ? formatVectorForPaste(Transform.get(temple.entity).position) : 'undefined'

  console.log(`Saved RTS resource locations:\nconst templeLocation = ${templeLocation}\n\nconst treeLocations = [\n${trees}\n]\n\nconst rockLocations = [\n${rocks}\n]\n\nconst pigLocations = [\n${pigs}\n]`)
}

function printBuildingTransform(building: Building): void {
  const transform = Transform.get(building.entity)

  console.log(
    `Saved RTS building transform:\nconst selectedBuildingTransform = {\n  kind: '${building.kind}',\n  name: '${building.name}',\n  position: ${formatVectorForPaste(transform.position)},\n  scale: ${formatVectorForPaste(transform.scale)}\n}`
  )
}

function getSavedResourceLocations(resource: ResourceKind): string[] {
  if (resource === 'wood') return gameState.savedTreeLocations
  if (resource === 'meat') return gameState.savedMeatLocations
  return gameState.savedRockLocations
}

function getWorkerGatherPosition(worker: Worker, resource: ResourceNode): Vector3 {
  const resourcePosition = Transform.get(resource.entity).position
  const targetWorkers = workers.filter((otherWorker) => otherWorker.alive && otherWorker.targetResourceId === resource.id)
  const slot = Math.max(0, targetWorkers.findIndex((targetWorker) => targetWorker.id === worker.id))
  const radius = resource.resource === 'wood' ? 1.25 : resource.resource === 'meat' ? 1.1 : 0.95

  return getFormationPosition(resourcePosition, slot, radius)
}

function getWorkerRallyPosition(worker: Worker): Vector3 {
  if (!worker.rallyPoint) return Transform.get(worker.entity).position

  const slot = Math.max(0, workers.filter((otherWorker) => otherWorker.alive).findIndex((targetWorker) => targetWorker.id === worker.id))
  return getFormationPosition(worker.rallyPoint, slot, 0.75)
}

function getNearestTemple(position: Vector3, team: Team): Building | undefined {
  let nearestTemple: Building | undefined
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const temple of buildings) {
    if (temple.kind !== 'temple' || !temple.alive || !temple.isComplete || getTeam(temple) !== team) continue

    const distance = distanceToPoint(Transform.get(temple.entity).position, position)
    if (distance < nearestDistance) {
      nearestTemple = temple
      nearestDistance = distance
    }
  }

  return nearestTemple
}

function getTempleDropoffPosition(temple: Building, worker: Worker): Vector3 {
  const templePosition = Transform.get(temple.entity).position
  const workerPosition = Transform.get(worker.entity).position
  const radius = Math.max(MODEL_TRANSFORMS.hq.colliderScale.x, MODEL_TRANSFORMS.hq.colliderScale.z) / 2 + 0.75
  const dx = workerPosition.x - templePosition.x
  const dz = workerPosition.z - templePosition.z
  const length = Math.sqrt(dx * dx + dz * dz)
  const direction = length > 0.001 ? Vector3.create(dx / length, 0, dz / length) : Vector3.Backward()

  return Vector3.create(templePosition.x + direction.x * radius, 0.25, templePosition.z + direction.z * radius)
}

function getBarracksExitPosition(barracks: Building, index: number): Vector3 {
  const transform = Transform.get(barracks.entity)
  const exitDistance = Math.max(transform.scale.x, transform.scale.z) * 0.55 + 1
  const exitPosition = Vector3.create(transform.position.x, 0.25, transform.position.z + exitDistance)

  return offsetSpawn(exitPosition, index)
}

function getHomesteadExitPosition(homestead: Building, index: number): Vector3 {
  const transform = Transform.get(homestead.entity)
  const exitDistance = Math.max(transform.scale.x, transform.scale.z) * 0.55 + 1
  const exitPosition = Vector3.create(transform.position.x, 0.25, transform.position.z + exitDistance)

  return offsetSpawn(exitPosition, index)
}

function getBuilderWorkPosition(site: Building, workerPosition: Vector3): Vector3 {
  const siteTransform = Transform.get(site.entity)
  const definition = isBuildableKind(site.kind) ? BUILDING_DEFINITIONS[site.kind] : undefined
  const footprintRadius = Math.max(definition?.scale.x ?? siteTransform.scale.x, definition?.scale.z ?? siteTransform.scale.z) / 2
  const stopDistance = footprintRadius + 0.75
  const dx = workerPosition.x - siteTransform.position.x
  const dz = workerPosition.z - siteTransform.position.z
  const length = Math.sqrt(dx * dx + dz * dz)
  const direction = length > 0.001 ? Vector3.create(dx / length, 0, dz / length) : Vector3.Backward()

  return Vector3.create(siteTransform.position.x + direction.x * stopDistance, 0.25, siteTransform.position.z + direction.z * stopDistance)
}

function getSoldierAttackPosition(target: Building, slot: number): Vector3 {
  const targetTransform = Transform.get(target.entity)
  const definition = isBuildableKind(target.kind) ? BUILDING_DEFINITIONS[target.kind] : undefined
  const modelRadius = Math.max(targetTransform.scale.x, targetTransform.scale.z) * 0.5
  const footprintRadius = definition ? Math.max(definition.scale.x, definition.scale.z) * 0.5 : modelRadius
  const buildingPadding = target.kind === 'temple' ? TEMPLE_ATTACK_DISTANCE_PADDING : 1
  const attackRadius = Math.max(CONFIG.soldierAttackRange + buildingPadding, footprintRadius + SOLDIER_ATTACK_SPACING + buildingPadding)
  const position = getFormationPosition(targetTransform.position, slot, attackRadius)

  return Vector3.create(position.x, 0.25, position.z)
}

function getUnitAttackPosition(target: Soldier | Worker, attacker: Soldier): Vector3 {
  const targetPosition = Transform.get(target.entity).position
  const slot = getAttackSlotForTarget(target.id, attacker.id)
  const position = getFormationPosition(targetPosition, slot, SOLDIER_UNIT_ATTACK_SPACING)

  return Vector3.create(position.x, 0.25, position.z)
}

function getAttackSlotForTarget(targetId: string, attackerId: string): number {
  const attackers = soldiers
    .filter((soldier) => soldier.alive && soldier.targetId === targetId)
    .sort((a, b) => a.id.localeCompare(b.id))
  const slot = attackers.findIndex((soldier) => soldier.id === attackerId)

  return slot >= 0 ? slot : attackers.length
}

function cancelSoldierCommand(): void {
  soldierCommandMode = 'none'
  soldierCommandCooldown = 0
}

function removeSelectable(selectable: Selectable): void {
  selectable.alive = false
  removeSelectableInteractivity(selectable)
  // Procedural model parts follow the hidden root, so only the animation rigs need unregistering.
  disposeRobot(selectable.entity, false)
  disposeResourceModel(selectable.entity, false)
  hideEntity(selectable.entity)
  if (selectable.labelEntity) hideEntity(selectable.labelEntity)
  selectables.delete(selectable.id)

  gameState.selectedUnitIds = gameState.selectedUnitIds.filter((id) => id !== selectable.id)
  if (gameState.selectedId === selectable.id) {
    const nextSelected = gameState.selectedUnitIds[0] ? selectables.get(gameState.selectedUnitIds[0]) : undefined
    gameState.selectedId = nextSelected?.id ?? ''
    gameState.selectedKind = nextSelected?.kind ?? ''
    clearSelectionMarkers()
  }
}

function destroySelectable(selectable: Selectable): void {
  selectable.alive = false
  removeSelectableInteractivity(selectable)
  disposeRobot(selectable.entity, true)
  disposeResourceModel(selectable.entity, true)
  if (selectable.labelEntity) engine.removeEntity(selectable.labelEntity)
  engine.removeEntity(selectable.entity)
  selectables.delete(selectable.id)
}

function removeBuilding(building: Building): void {
  clearBuildingDamageVfx(building)
  const index = buildings.findIndex((candidate) => candidate.id === building.id)
  if (index >= 0) buildings.splice(index, 1)
}

function removeSelectableInteractivity(selectable: Selectable): void {
  const pointerTarget = selectable.colliderEntity ?? selectable.entity

  pointerEventsSystem.removeOnPointerDown(pointerTarget)
  MeshCollider.deleteFrom(pointerTarget)
  if (selectable.colliderEntity) {
    pointerEventsSystem.removeOnPointerDown(selectable.entity)
    engine.removeEntity(selectable.colliderEntity)
  }
  GltfContainer.deleteFrom(selectable.entity)
  MeshRenderer.deleteFrom(selectable.entity)
}

