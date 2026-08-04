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
  RESOURCE_FIELDS,
  ResourceField,
  SCENE
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
import { buildUnitModel, disposeUnit, isProceduralUnit, setUnitAnimation, updateUnitCargo } from './rts/unitModels'
import { BUILDING_MODEL_HEIGHTS, buildBuildingModel, disposeBuildingModel, isProceduralBuilding, setBuildingModelDamage } from './rts/buildingModels'
import { getBuildingDisplayName, getRace, getSoldierDefinition, getWorkerDefinition, pickEnemyRace } from './rts/races'
import { buildResourceModel, disposeResourceModel, playResourceDepletion, playResourceGatherPulse } from './rts/resourceModels'
import { showMoveMarker } from './rts/moveMarker'
import { fireProjectile } from './rts/projectiles'
import { spawnBlastRing, spawnImpactFlash } from './rts/impactVfx'
import {
  getDamageMultiplier,
  getNextUpgradeCost,
  getUpgradeLevel,
  isUpgradeInProgress,
  resetUpgrades,
  startUpgradeResearchOrder,
  updateUpgradeResearch,
  UPGRADE_INFO
} from './rts/upgrades'
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
  SoldierVariant,
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
const DEPLETED_GAS_HIDE_DELAY = 180
const PLAYER_ATTACK_ALERT_DURATION = 4
const SOLDIER_MOVE_FORMATION_RADIUS = 0.9
const SOLDIER_ATTACK_SPACING = 0.7
const ENEMY_DEFENSE_RADIUS = 20
const TEMPLE_ATTACK_DISTANCE_PADDING = 3
const MATCH_NOT_STARTED = 'notStarted'
const MATCH_ACTIVE = 'active'
const MATCH_ENDED = 'ended'

export function initRtsGame(): void {
  createStaticScene()
  createStartingBase()
  initFogOfWar()
  engine.addSystem(rtsTickSystem)
}

export function startRtsMatch(): void {
  if (gameState.matchStatus === MATCH_ACTIVE) return

  // Always rebuild the base so the chosen race's units and buildings spawn fresh.
  resetRtsGame()
  gameState.matchResult = 'none'
  gameState.status = `${getRace('player').name} vs ${getRace('enemy').name}. Select a worker to gather resources.`
}

export function endRtsMatch(): void {
  if (gameState.matchStatus === MATCH_ENDED) return

  endMatch('loss')
}

export function queueWorker(): void {
  if (!isMatchActive()) return

  const selected = getSelected()
  const homestead = selected?.kind === 'supplyHouse' ? (selected as Building) : undefined

  const workerDef = getWorkerDefinition('player')
  const supplyName = getBuildingDisplayName('supplyHouse', 'player')

  if (!homestead?.alive || !homestead.isComplete) {
    setStatus(`Select a completed ${supplyName} to create ${workerDef.name}s.`)
    return
  }

  if (getSupplyUsed('player') + gameState.workerQueue >= getSupplyCap('player')) {
    setStatus(`Need more supply before creating ${workerDef.name}s.`)
    return
  }

  if (!spendResources('player', workerDef.cost)) {
    setStatus(`Need ${formatCost(workerDef.cost)} for a ${workerDef.name}.`)
    return
  }

  workerProductionOrders.push({ homesteadId: homestead.id, timer: 0, productionTime: workerDef.productionTime, team: 'player' })
  gameState.workerQueue += 1
  setStatus(`${workerDef.name} queued at the ${supplyName}.`)
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

  // Both fighter-producing buildings share the rally map, so the same command works for each.
  if (selected?.kind !== 'barracks' && selected?.kind !== 'techLab') {
    setStatus('Select a fighter-producing building first, then set the spawn point.')
    return
  }

  const trainer = selected as Building
  if (!trainer.isComplete) {
    setStatus(`Finish the ${trainer.name} before setting its spawn point.`)
    return
  }

  startRallyPlacement('barracks', trainer.id)
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
    setStatus(`Need ${formatCost(definition.cost)} to build the ${getBuildingDisplayName(kind, 'player')}.`)
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
  setStatus(`Placing ${getBuildingDisplayName(kind, 'player')}. Click open ground to build. Press E to rotate.`)
}

export function cancelBuildingPlacement(): void {
  if (placementState.state !== 'placing') return

  const kind = placementState.buildingKind
  cancelPlacement()
  setStatus(`Cancelled ${getBuildingDisplayName(kind, 'player')} placement.`)
}

export function queueSoldier(variant: SoldierVariant = 'melee'): void {
  if (!isMatchActive()) return

  // Melee/ranged train at the barracks; caster/flyer/titan need the advanced structure.
  const trainerKind: BuildableKind = variant === 'melee' || variant === 'ranged' ? 'barracks' : 'techLab'
  const selected = getSelected()
  const trainer = selected?.kind === trainerKind ? (selected as Building) : undefined
  const soldierDef = getSoldierDefinition('player', variant)
  const trainerName = getBuildingDisplayName(trainerKind, 'player')

  if (!trainer?.alive || !trainer.isComplete) {
    setStatus(`Select a completed ${trainerName} to create ${soldierDef.name}s.`)
    return
  }

  if (getSupplyUsed('player') + gameState.workerQueue + gameState.soldierQueue + soldierDef.supply > getSupplyCap('player')) {
    setStatus(`Need more supply before creating ${soldierDef.name}s.`)
    return
  }

  if (!spendResources('player', soldierDef.cost)) {
    setStatus(`Need ${formatCost(soldierDef.cost)} for a ${soldierDef.name}.`)
    return
  }

  soldierProductionOrders.push({ barracksId: trainer.id, timer: 0, productionTime: soldierDef.productionTime, team: 'player', variant })
  gameState.soldierQueue += 1
  setStatus(`${soldierDef.name} queued at the ${trainerName}.`)
}

/** Starts researching the next level of a team-wide upgrade at the selected forge. */
export function startUpgradeResearch(kind: 'damage' | 'speed'): void {
  if (!isMatchActive()) return

  const selected = getSelected()
  const forge = selected?.kind === 'forge' ? (selected as Building) : undefined
  const forgeName = getBuildingDisplayName('forge', 'player')
  const info = UPGRADE_INFO[kind]

  if (!forge?.alive || !forge.isComplete || getTeam(forge) !== 'player') {
    setStatus(`Select a completed ${forgeName} to research upgrades.`)
    return
  }

  if (isUpgradeInProgress('player', kind)) {
    setStatus(`${info.name} research is already in progress.`)
    return
  }

  const cost = getNextUpgradeCost('player', kind)
  if (!cost) {
    setStatus(`${info.name} is already at maximum level.`)
    return
  }

  if (!spendResources('player', cost)) {
    setStatus(`Need ${formatCost(cost)} to research ${info.name} level ${getUpgradeLevel('player', kind) + 1}.`)
    return
  }

  startUpgradeResearchOrder('player', kind, forge.id)
  setStatus(`Researching ${info.name} level ${getUpgradeLevel('player', kind) + 1} (${info.effect}).`)
}

export function selectAllLikeSelected(): void {
  const selected = getSelected()

  if (selected?.kind !== 'worker' && selected?.kind !== 'soldier') {
    setStatus(`Select a ${getWorkerDefinition('player').name} or fighter first.`)
    return
  }

  const units = selected.kind === 'worker' ? getAvailableWorkers() : getAvailableSoldiers()
  setUnitSelection(units)
  const unitLabel = selected.kind === 'worker' ? `${getWorkerDefinition('player').name}s` : 'fighters'
  setStatus(`Selected all ${unitLabel} (${units.length}). Click a valid target to command them.`)
}

export function selectIdleWorker(): void {
  const idleWorker = getIdleWorkers()[0]

  if (!idleWorker) {
    setStatus('No idle workers available.')
    return
  }

  selectObject(idleWorker)
}

export function placeMineralResource(): void {
  placeResourceAtPlayer('minerals')
}

export function placeGasResource(): void {
  placeResourceAtPlayer('gas')
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
  gameState.enemyRace = pickEnemyRace(gameState.playerRace)
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
  gameState.savedMineralLocations = []
  gameState.savedGasLocations = []
  homesteadRallyPoints.clear()
  barracksRallyPoints.clear()
  cancelRallyPlacement()
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
  resetUpgrades()
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
  if (workerCount > 0) parts.push(`${workerCount} ${getWorkerDefinition('player').name}${workerCount === 1 ? '' : 's'}`)
  if (soldierCount > 0) parts.push(`${soldierCount} fighter${soldierCount === 1 ? '' : 's'}`)
  return `Selected ${parts.join(' + ')}. `
}

export function getSelectedSummary(): SelectedSummary {
  const selected = getSelected()

  if (!selected) {
    return {
      name: 'None',
      kind: 'none',
      detail: getPlacementInstruction() || 'Select the Temple, a miner, a resource, or a building.'
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
  // Fully matte so the noon sun doesn't wash the whole surface out from the overhead camera.
  Material.setPbrMaterial(ground, {
    albedoColor: COLORS.ground,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
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
        metallic: 0,
        roughness: 1,
        specularIntensity: 0,
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
        metallic: 0,
        roughness: 1,
        specularIntensity: 0,
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
  buildings.push(createBuilding('temple', getBuildingDisplayName('temple', 'player'), POSITIONS.base, CONFIG.templeHp, 'complete', 0, 'player'))
  buildings.push(createBuilding('temple', `Enemy ${getBuildingDisplayName('temple', 'enemy')}`, POSITIONS.enemyTemple, CONFIG.templeHp, 'complete', 180, 'enemy'))

  spawnResourceFields()

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

function spawnResourceFields(): void {
  const counters: Record<ResourceKind, number> = { minerals: 0, gas: 0 }

  RESOURCE_FIELDS.forEach((field, fieldIndex) => {
    const definition = RESOURCE_DEFINITIONS[field.kind]
    for (const position of generateFieldPositions(field, fieldIndex)) {
      counters[field.kind] += 1
      resources.push(createResourceNode(field.kind, `${definition.name} ${counters[field.kind]}`, position))
    }
  })
}

/** Deterministic ring of node positions around a field center: evenly spaced angle slots with jitter. */
function generateFieldPositions(field: ResourceField, fieldIndex: number): Vector3[] {
  let seed = 4241 + fieldIndex * 131
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }

  const positions: Vector3[] = []
  for (let i = 0; i < field.count; i++) {
    const angle = ((i + random() * 0.5) / field.count) * Math.PI * 2
    const radius = field.radius * (0.45 + random() * 0.55)
    positions.push(
      Vector3.create(
        Math.min(SCENE.size - 4, Math.max(4, field.center.x + Math.cos(angle) * radius)),
        0,
        Math.min(SCENE.size - 4, Math.max(4, field.center.z + Math.sin(angle) * radius))
      )
    )
  }
  return positions
}

function createWorker(position: Vector3, team: Team = 'player'): Worker {
  const definition = getWorkerDefinition(team)
  const worker = createProceduralUnitSelectable(
    'worker',
    `${team === 'enemy' ? 'Enemy ' : ''}${definition.name} ${getTeamWorkerCount(team) + 1}`,
    position,
    team,
    // Generous click box: units are small targets from the overhead camera.
    Vector3.create(1.1, 1.8, 1.1)
  ) as Worker

  worker.hp = definition.hp
  worker.maxHp = definition.hp
  worker.state = 'idle'
  worker.timer = 0
  worker.carrying = 0
  worker.activeAnimation = 'idle'
  return worker
}

function createSoldier(position: Vector3, team: Team = 'player', variant: SoldierVariant = 'melee'): Soldier {
  const definition = getSoldierDefinition(team, variant)
  const soldier = createProceduralUnitSelectable(
    'soldier',
    `${team === 'enemy' ? 'Enemy ' : ''}${definition.name} ${getTeamSoldierCount(team) + 1}`,
    position,
    team,
    getSoldierColliderScale(variant),
    variant
  ) as Soldier

  soldier.variant = variant
  soldier.hp = definition.hp
  soldier.maxHp = definition.hp
  soldier.damage = definition.damage ?? CONFIG.soldierDamage
  soldier.moveSpeed = definition.moveSpeed ?? CONFIG.soldierMoveSpeed
  soldier.attackRange = definition.attackRange ?? CONFIG.soldierAttackRange
  soldier.attackRate = definition.attackRate ?? CONFIG.soldierAttackRate
  soldier.splashRadius = definition.splashRadius ?? 0
  soldier.state = 'idle'
  soldier.attackTimer = 0
  soldier.activeAnimation = 'idle'
  return soldier
}

/** Generous click boxes sized to each silhouette: flyers hover high, titans are huge. */
function getSoldierColliderScale(variant: SoldierVariant): Vector3 {
  if (variant === 'titan') return Vector3.create(2.4, 3.2, 2.4)
  if (variant === 'flyer') return Vector3.create(1.8, 3.2, 1.8)
  return Vector3.create(1.4, 2, 1.4)
}

/** Units are procedurally built per race (no GLBs), so this replaces createSelectableModel for them. */
function createProceduralUnitSelectable(kind: 'worker' | 'soldier', name: string, position: Vector3, team: Team, colliderScale: Vector3, variant?: SoldierVariant): Selectable {
  const id = createEntityId(kind)
  const entity = engine.addEntity()
  Transform.create(entity, { position: cloneVector(position) })
  buildUnitModel(entity, getRace(team).id, kind === 'worker' ? 'worker' : variant ?? 'melee', team)

  const selectable: Selectable = { id, kind, name, entity, alive: true, team }
  selectable.colliderEntity = createModelColliderEntity(entity, {
    position,
    scale: Vector3.create(1, 1, 1),
    src: '',
    colliderScale
  })
  selectables.set(id, selectable)
  registerSelectable(selectable)
  return selectable
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
  const site = createBuilding(kind, `${team === 'enemy' ? 'Enemy ' : ''}${getBuildingDisplayName(kind, team)} (Building)`, position, definition.hp, 'movingBuilder', rotationY, team)

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
      ? (createProceduralBuildingSelectable(kind as BuildableKind, name, position, team, definition, rotationY) as Building)
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
  if (building.isComplete) ensureBuildingBeacon(building)
  return building
}

// Race identity marker: a floating glowing orb in the owner's race color above the roof.
const BEACON_HEIGHTS: Record<BuildableKind, number> = {
  temple: 13.5,
  supplyHouse: 5.5,
  barracks: 7.5,
  techLab: 8.5,
  forge: 6.5,
  fireplace: 3.5
}

function ensureBuildingBeacon(building: Building): void {
  if (building.beaconEntity || !isBuildableKind(building.kind)) return

  const race = getRace(getTeam(building))
  const position = Transform.get(building.entity).position
  const beacon = engine.addEntity()
  Transform.create(beacon, {
    position: Vector3.create(position.x, position.y + BEACON_HEIGHTS[building.kind], position.z),
    scale: Vector3.create(0.55, 0.55, 0.55)
  })
  MeshRenderer.setSphere(beacon)
  Material.setPbrMaterial(beacon, {
    albedoColor: race.color,
    emissiveColor: race.accent,
    emissiveIntensity: 2.4,
    metallic: 0.2,
    roughness: 0.4,
    castShadows: false
  })
  building.beaconEntity = beacon
}

function removeBuildingBeacon(selectable: Selectable): void {
  const building = selectable as Building
  if (!building.beaconEntity) return

  engine.removeEntity(building.beaconEntity)
  building.beaconEntity = undefined
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

/**
 * Race-styled procedural building: parts hang off a root at ground level with
 * scale (1,1,1), plus an invisible footprint-sized box for clicks. Construction
 * growth and death handling scale/hide the root, which carries the parts.
 */
function createProceduralBuildingSelectable(kind: BuildableKind, name: string, position: Vector3, team: Team, definition: BuildingDefinition, rotationY: number): Selectable {
  const id = createEntityId(kind)
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(position.x, 0, position.z),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0)
  })
  buildBuildingModel(entity, getRace(team).id, kind)

  const height = BUILDING_MODEL_HEIGHTS[kind]
  const collider = engine.addEntity()
  Transform.create(collider, {
    parent: entity,
    position: Vector3.create(0, height / 2, 0),
    scale: Vector3.create(definition.scale.x, height, definition.scale.z)
  })

  const selectable: Selectable = { id, kind, name, entity, alive: true, team, colliderEntity: collider }
  selectables.set(id, selectable)
  registerSelectable(selectable)
  return selectable
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

  // Preview model: the player's race-styled building, parts parented to this entity.
  const model = engine.addEntity()
  Transform.create(model, {
    parent: root,
    position: Vector3.create(0, 0, 0),
    rotation: Quaternion.fromEulerDegrees(0, 0, 0),
    scale: Vector3.create(1, 1, 1)
  })
  buildBuildingModel(model, getRace('player').id, definition.kind)

  return {
    ghostEntity: root,
    ghostFootprintEntity: footprint,
    ghostModelEntity: model
  }
}

function registerSelectable(selectable: Selectable): void {
  const pointerTarget = selectable.colliderEntity ?? selectable.entity

  ensurePointerCollider(pointerTarget)
  registerPointerHandler(pointerTarget, selectable)
  // GLB units click via an invisible collider box, which the client can't outline on hover.
  // Registering the visible model too makes the character glow like other selectables.
  // Procedural roots have no mesh of their own, so registering them only triggers warnings.
  if (selectable.colliderEntity && (GltfContainer.has(selectable.entity) || MeshRenderer.has(selectable.entity))) {
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

  const selectedWorkers = getSelectedWorkers()

  if (selectedWorkers.length > 0 && clicked.kind === 'resource') {
    assignWorkersToResource(selectedWorkers, clicked as ResourceNode)
    return
  }

  if (selectedWorkers.length > 0 && isPlayerRepairTarget(clicked)) {
    assignWorkerToRepair(selectedWorkers[0], clicked)
    return
  }

  if (isEnemyAttackTarget(clicked)) {
    const attackSoldiers = getSelectedSoldiers()
    const attackWorkers = selectedWorkers.filter((worker) => worker.alive)

    if (attackSoldiers.length > 0) {
      assignCommandableSoldiersToAttack(clicked)
    }
    if (attackWorkers.length > 0) {
      for (const worker of attackWorkers) {
        assignWorkerToAttack(worker, clicked)
      }
      if (attackSoldiers.length === 0) {
        setStatus(`${attackWorkers.length} worker${attackWorkers.length === 1 ? '' : 's'} attacking ${clicked.name}. They are weak fighters!`)
      }
    }
    if (attackSoldiers.length + attackWorkers.length > 0) return
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
  worker.attackTargetId = undefined
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
  worker.attackTargetId = undefined
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

function assignSoldierToAttack(soldier: Soldier, target: Building | Soldier | Worker, slot = 0, announce = true): void {
  if (!soldier.alive || !target.alive) return
  if (getTeam(soldier) === getTeam(target)) return

  soldier.state = 'movingToAttack'
  soldier.targetId = target.id
  soldier.attackPosition = target.kind === 'soldier' || target.kind === 'worker' ? undefined : getSoldierAttackPosition(target, slot, soldier)
  soldier.rallyPoint = undefined
  soldier.attackTimer = 0
  setSoldierAnimation(soldier, 'walk')
  if (announce && getTeam(soldier) === 'player') setStatus(`${soldier.name} attacking ${target.name}.`)
}

function assignWorkerToAttack(worker: Worker, target: Building | Soldier | Worker): void {
  if (!worker.alive || !target.alive) return
  if (worker.state === 'movingToBuild' || worker.state === 'constructing' || worker.state === 'movingToRepair' || worker.state === 'repairing') return

  worker.state = 'movingToAttack'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
  worker.repairTargetId = undefined
  worker.attackTargetId = target.id
  worker.rallyPoint = undefined
  worker.timer = 0
  worker.carrying = 0
  worker.carryingResource = undefined
  setWorkerAnimation(worker, 'walk')
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
  worker.attackTargetId = undefined
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
    setStatus('Select a fighter first.')
    return
  }

  for (let i = 0; i < assignedSoldiers.length; i++) {
    assignSoldierToAttack(assignedSoldiers[i], target, i)
  }

  // Selection persists so the player can keep issuing commands to the same group.
  setStatus(`${assignedSoldiers.length} fighter${assignedSoldiers.length === 1 ? '' : 's'} attacking ${target.name}.`)
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
    setStatus(`Cannot place ${getBuildingDisplayName(definition.kind, 'player')} there. Move the footprint to an open area.`)
    return
  }

  if (!spendResources(builder.team ?? 'player', definition.cost)) {
    cancelPlacement()
    setStatus(`Need ${formatCost(definition.cost)} to build the ${getBuildingDisplayName(definition.kind, 'player')}.`)
    return
  }

  const buildPosition = Vector3.create(position.x, definition.placementY, position.z)
  const site = createConstructionSite(definition.kind, buildPosition, builder.id, currentBuildingPreviewRotationY, builder.team ?? 'player')

  builder.state = 'movingToBuild'
  builder.targetResourceId = undefined
  builder.buildSiteId = site.id
  builder.repairTargetId = undefined
  builder.attackTargetId = undefined
  builder.rallyPoint = undefined
  builder.timer = 0
  builder.carrying = 0
  builder.carryingResource = undefined
  setWorkerAnimation(builder, 'walk')
  cancelPlacement()
  clearSelection()
  setStatus(`${builder.name} moving to build the ${getBuildingDisplayName(definition.kind, 'player')}.`)
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
  getCombatTargetById,
  damageCombatTarget,
  setWorkerAnimation,
  playResourceGatherFeedback,
  depleteResourceNode,
  updateLabel,
  setStatus
}

const combatSystemDeps = {
  getCombatTargetById,
  getSoldierAttackPosition,
  setSoldierAnimation,
  damageCombatTarget,
  assignSoldierToAttack,
  setStatus
}

const upgradeSystemDeps = {
  isForgeAlive: (forgeId: string) => {
    const forge = getBuildingById(forgeId)
    return !!forge?.alive && forge.isComplete
  },
  onUpgradeComplete: (team: Team, kind: 'damage' | 'speed', newLevel: number) => {
    if (team === 'player') {
      setStatus(`${UPGRADE_INFO[kind].name} level ${newLevel} research complete (${UPGRADE_INFO[kind].effect}).`)
    }
  }
}

const dragSelectDeps = {
  isBlocked: () =>
    placementState.state === 'placing' ||
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
  updateRallyPlacementInput(dt)
  updateCancelInput()
  updateDragSelect(dragSelectDeps)
  updateWorkerAutoGather(dt)
  updateRallyMarker()
  updateSelectionMarkers(getSelectionMarkerTargets())
  updateWorkerProductionSystem(dt, productionDeps)
  updateSoldierProductionSystem(dt, productionDeps)
  updateUpgradeResearch(dt, upgradeSystemDeps)
  updateEnemyAiSystem(dt, enemyAiDeps)
  updateWorkersSystem(dt, workerSystemDeps)
  updateWorkerCargoVisuals()
  updateSoldiersSystem(dt, combatSystemDeps)
  updateConstructionSites(dt)
  updateBuildingDamageVfxSystem()
  updateDepletedResources(dt)
  updateMatchEndState()
}

/** Keeps the robots' back-mounted cargo bundle in sync with what they're carrying. */
function updateWorkerCargoVisuals(): void {
  for (const worker of workers) {
    if (!worker.alive) continue
    updateUnitCargo(worker.entity, worker.carrying > 0 ? worker.carryingResource : undefined)
  }
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
  // Procedural building roots have unit scale, so size the ring from the footprint definition.
  const definition = isBuildableKind(selectable.kind as Building['kind']) ? BUILDING_DEFINITIONS[selectable.kind as BuildableKind] : undefined
  const footprint = definition ? Math.max(definition.scale.x, definition.scale.z) : Math.max(transform.scale.x, transform.scale.z)

  return {
    position: transform.position,
    diameter: footprint + 0.55
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

  // Char the model itself; repairs restore the original materials.
  setBuildingModelDamage(building.entity, building.hp / building.maxHp)

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
  const height = isBuildableKind(building.kind) && isProceduralBuilding(building.entity)
    ? BUILDING_MODEL_HEIGHTS[building.kind] * 0.5
    : Math.max(transform.scale.y * 0.45, 1.4)

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
  const displayName = `${getTeam(site) === 'enemy' ? 'Enemy ' : ''}${getBuildingDisplayName(site.kind as BuildableKind, getTeam(site))}`

  site.constructionState = 'complete'
  site.constructionProgress = 1
  site.isComplete = true
  site.name = displayName
  builder.state = 'idle'
  builder.buildSiteId = undefined
  builder.repairTargetId = undefined
  setWorkerAnimation(builder, 'idle')
  updateConstructionVisual(site)
  updateLabel(site, displayName)
  ensureBuildingBeacon(site)

  if (definition.supplyAdds > 0) {
    addSupplyCap(getTeam(site), definition.supplyAdds)
  }

  if (getTeam(site) === 'player') {
    setStatus(definition.completeStatus)
  }
}

function damageCombatTarget(target: Building | Soldier | Worker, amount: number, attacker: Soldier | Worker): void {
  const attackerTeam = getTeam(attacker)
  const targetPosition = cloneVector(Transform.get(target.entity).position)
  // Weapon upgrades scale every fighter's damage team-wide the moment research lands.
  const damage = attacker.kind === 'soldier' ? Math.round(amount * getDamageMultiplier(attackerTeam)) : amount

  if (attacker.kind === 'soldier' && attacker.alive && target.alive) {
    const accent = getRace(attackerTeam).accent
    const isRangedShot = attacker.variant === 'ranged' || attacker.variant === 'caster' || attacker.variant === 'flyer'

    if (isRangedShot) {
      // Visible tracer plus a flash where the shot lands.
      fireProjectile(Transform.get(attacker.entity).position, targetPosition, attackerTeam)
      spawnImpactFlash(targetPosition, accent)
    }
    if (attacker.splashRadius > 0) {
      // Caster blasts and titan stomps ripple outward.
      spawnBlastRing(targetPosition, accent, attacker.splashRadius)
    }
  }

  applyCombatDamage(target, damage, attacker)

  // Area damage: splash hits every enemy unit near the impact at reduced power.
  if (attacker.kind === 'soldier' && attacker.splashRadius > 0) {
    const splashDamage = Math.max(1, Math.round(damage * 0.6))

    for (const soldier of soldiers) {
      if (!soldier.alive || soldier.id === target.id || getTeam(soldier) === attackerTeam) continue
      if (distanceToPoint(Transform.get(soldier.entity).position, targetPosition) <= attacker.splashRadius) {
        damageSoldier(soldier, splashDamage, attacker)
      }
    }
    for (const worker of workers) {
      if (!worker.alive || worker.id === target.id || getTeam(worker) === attackerTeam) continue
      if (distanceToPoint(Transform.get(worker.entity).position, targetPosition) <= attacker.splashRadius) {
        damageWorker(worker, splashDamage, attacker)
      }
    }
  }
}

function applyCombatDamage(target: Building | Soldier | Worker, amount: number, attacker: Soldier | Worker): void {
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

function damageBuilding(building: Building, amount: number, attacker?: Soldier | Worker): void {
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

function isPlayerTempleUnderAttack(building: Building, attacker?: Soldier | Worker): boolean {
  return building.kind === 'temple' && getTeam(building) === 'player' && attacker !== undefined && getTeam(attacker) === 'enemy'
}

function showPlayerAttackAlert(): void {
  gameState.attackAlert = 'Your HQ is under attack!'
  gameState.attackAlertTimer = PLAYER_ATTACK_ALERT_DURATION
  setStatus(gameState.attackAlert)
}

function damageSoldier(soldier: Soldier, amount: number, attacker?: Soldier | Worker): void {
  soldier.hp = Math.max(0, soldier.hp - amount)

  if (soldier.hp > 0) {
    if (attacker?.alive && shouldRetaliate(soldier)) {
      assignSoldierToAttack(soldier, attacker, 0, false)
    }
    return
  }

  creditUnitKill(attacker, soldier)
  soldier.state = 'dead'
  soldier.targetId = undefined
  soldier.attackPosition = undefined
  soldier.rallyPoint = undefined
  addSupplyUsed(getTeam(soldier), -getSoldierDefinition(getTeam(soldier), soldier.variant).supply)
  removeSelectable(soldier)
  clearAttackersTargeting(soldier.id)
}

/**
 * Idle victims always fight back. Units busy hitting a building turn on the unit
 * shooting them; units already fighting another unit stay locked on. Move orders
 * (movingToRally) are never interrupted.
 */
function shouldRetaliate(victim: Soldier): boolean {
  if (victim.state === 'idle') return true
  if (victim.state !== 'movingToAttack' && victim.state !== 'attacking') return false

  const currentTarget = victim.targetId ? getCombatTargetById(victim.targetId) : undefined
  return !currentTarget || (currentTarget.kind !== 'soldier' && currentTarget.kind !== 'worker')
}

function damageWorker(worker: Worker, amount: number, attacker?: Soldier | Worker): void {
  worker.hp = Math.max(0, worker.hp - amount)

  if (worker.hp > 0) return

  creditUnitKill(attacker, worker)

  worker.state = 'dead'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
  worker.repairTargetId = undefined
  worker.attackTargetId = undefined
  worker.rallyPoint = undefined
  worker.carrying = 0
  worker.carryingResource = undefined
  addSupplyUsed(getTeam(worker), -1)
  removeSelectable(worker)
  clearAttackersTargeting(worker.id)
}

function creditUnitKill(attacker: Soldier | Worker | undefined, target: Soldier | Worker): void {
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

function alertDefenders(building: Building, attacker: Soldier | Worker): void {
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

  if (isProceduralBuilding(site.entity)) {
    // Parts are children of a ground-level root, so squashing the root's Y grows the model out of the ground.
    transform.position = Vector3.create(transform.position.x, 0, transform.position.z)
    transform.scale = Vector3.create(1, progress, 1)
  } else {
    transform.position = Vector3.create(transform.position.x, definition.placementY * progress, transform.position.z)
    transform.scale = Vector3.create(definition.scale.x, definition.scale.y * progress, definition.scale.z)
  }

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
  return kind === 'temple' || kind === 'supplyHouse' || kind === 'barracks' || kind === 'techLab' || kind === 'forge' || kind === 'fireplace'
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
  if (selected?.kind === 'barracks' || selected?.kind === 'techLab') return barracksRallyPoints.get(selected.id)
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
    const templeName = getBuildingDisplayName('temple', getTeam(building))
    if (getTeam(building) === 'enemy') return `Enemy ${templeName}: AI resource dropoff. Location ${formatPosition(templePosition)}.`
    return `${templeName}: workers deliver resources here. Location ${formatPosition(templePosition)}.`
  }
  if (building.kind === 'supplyHouse') {
    const rallyPoint = homesteadRallyPoints.get(building.id)
    const supplyName = getBuildingDisplayName('supplyHouse', getTeam(building))
    return rallyPoint ? `${supplyName}: creates workers and adds supply. Spawn ${formatPosition(rallyPoint)}.` : `${supplyName}: creates workers and adds supply.`
  }
  if (building.kind === 'barracks') {
    const rallyPoint = barracksRallyPoints.get(building.id)
    const race = getRace(getTeam(building))
    const soldierNames = `${race.melee.name}s and ${race.ranged.name}s`
    return rallyPoint ? `Complete: creates ${soldierNames}. Spawn ${formatPosition(rallyPoint)}.` : `Complete: creates ${soldierNames}`
  }
  if (building.kind === 'techLab') {
    const rallyPoint = barracksRallyPoints.get(building.id)
    const race = getRace(getTeam(building))
    const advancedNames = `${race.caster.name}s, ${race.flyer.name}s and ${race.titan.name}s`
    return rallyPoint ? `Complete: creates ${advancedNames}. Spawn ${formatPosition(rallyPoint)}.` : `Complete: creates ${advancedNames}`
  }
  if (building.kind === 'forge') {
    const damageLevel = getUpgradeLevel(getTeam(building), 'damage')
    const speedLevel = getUpgradeLevel(getTeam(building), 'speed')
    return `Complete: researches upgrades. Weapons Lv${damageLevel}, Propulsion Lv${speedLevel}.`
  }
  if (building.kind === 'fireplace') return 'Complete: camp utility building.'
  if (building.kind === 'enemyBuilding') return 'Enemy structure'

  return 'Complete'
}

function getPlacementInstruction(): string {
  if (placementState.state !== 'placing') return ''

  return `Placing ${getBuildingDisplayName(placementState.buildingKind, 'player')}. Click ground to place.`
}

function getHoverText(selectable: Selectable): string {
  if (selectable.kind === 'resource') {
    const resource = selectable as ResourceNode
    return resource.resource ? RESOURCE_DEFINITIONS[resource.resource].hoverText : `Select ${selectable.name}`
  }
  if (getTeam(selectable) === 'enemy') return `Attack ${selectable.name}`
  return `Select ${selectable.name}`
}

function formatCost(cost: ResourceCost): string {
  const parts = []

  if (cost.minerals) parts.push(`${cost.minerals} minerals`)
  if (cost.gas) parts.push(`${cost.gas} gas`)
  return parts.length > 0 ? parts.join(', ') : '0 resources'
}

function depleteResourceNode(resource: ResourceNode): void {
  resource.amount = 0
  if (resource.resource === 'gas') {
    resource.alive = false
    resource.depletionTimer = DEPLETED_GAS_HIDE_DELAY
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

  if (isProceduralUnit(worker.entity)) setUnitAnimation(worker.entity, clipName)
  else playAnimation(worker.entity, clipName)
  worker.activeAnimation = clipName
}

function setSoldierAnimation(soldier: Soldier, clipName: string, restart = false): void {
  if (soldier.activeAnimation === clipName && !restart) return

  if (isProceduralUnit(soldier.entity)) setUnitAnimation(soldier.entity, clipName)
  else playAnimation(soldier.entity, clipName)
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
  const minerals = gameState.savedMineralLocations.map((location) => `  ${location}`).join(',\n')
  const gas = gameState.savedGasLocations.map((location) => `  ${location}`).join(',\n')
  const temple = getStartingTemple()
  const templeLocation = temple ? formatVectorForPaste(Transform.get(temple.entity).position) : 'undefined'

  console.log(`Saved RTS resource locations:\nconst templeLocation = ${templeLocation}\n\nconst mineralLocations = [\n${minerals}\n]\n\nconst gasLocations = [\n${gas}\n]`)
}

function printBuildingTransform(building: Building): void {
  const transform = Transform.get(building.entity)

  console.log(
    `Saved RTS building transform:\nconst selectedBuildingTransform = {\n  kind: '${building.kind}',\n  name: '${building.name}',\n  position: ${formatVectorForPaste(transform.position)},\n  scale: ${formatVectorForPaste(transform.scale)}\n}`
  )
}

function getSavedResourceLocations(resource: ResourceKind): string[] {
  return resource === 'gas' ? gameState.savedGasLocations : gameState.savedMineralLocations
}

function getWorkerGatherPosition(worker: Worker, resource: ResourceNode): Vector3 {
  const resourcePosition = Transform.get(resource.entity).position
  const targetWorkers = workers.filter((otherWorker) => otherWorker.alive && otherWorker.targetResourceId === resource.id)
  const slot = Math.max(0, targetWorkers.findIndex((targetWorker) => targetWorker.id === worker.id))
  // Geysers are wide mounds, so miners work them from further out.
  const radius = resource.resource === 'gas' ? 1.7 : 1.1

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

function getSoldierAttackPosition(target: Building, slot: number, attacker?: Soldier): Vector3 {
  const targetTransform = Transform.get(target.entity)
  const definition = isBuildableKind(target.kind) ? BUILDING_DEFINITIONS[target.kind] : undefined
  const modelRadius = Math.max(targetTransform.scale.x, targetTransform.scale.z) * 0.5
  const footprintRadius = definition ? Math.max(definition.scale.x, definition.scale.z) * 0.5 : modelRadius
  const buildingPadding = target.kind === 'temple' ? TEMPLE_ATTACK_DISTANCE_PADDING : 1
  // Ranged units stand off at their attack range; melee closes to the footprint edge.
  const attackerRange = attacker?.attackRange ?? CONFIG.soldierAttackRange
  const attackRadius = Math.max(footprintRadius + buildingPadding + Math.max(attackerRange - CONFIG.soldierAttackRange, 0), footprintRadius + SOLDIER_ATTACK_SPACING + buildingPadding)
  const position = getApproachSidePosition(targetTransform.position, attacker ? Transform.get(attacker.entity).position : undefined, slot, attackRadius)

  return Vector3.create(position.x, 0.25, position.z)
}

/**
 * Ring position on the attacker's side of the target, so units stop where they
 * approach from instead of marching past (or through) the target to a fixed slot.
 * Slots fan out left/right of the approach line; every 6 slots start a wider ring.
 */
function getApproachSidePosition(center: Vector3, attackerPosition: Vector3 | undefined, slot: number, radius: number): Vector3 {
  if (!attackerPosition) return getFormationPosition(center, slot, radius)

  const dx = attackerPosition.x - center.x
  const dz = attackerPosition.z - center.z
  const baseAngle = dx * dx + dz * dz > 0.001 ? Math.atan2(dz, dx) : slot * 2.399963229728653
  const fan = Math.ceil(slot / 2) * 0.45 * (slot % 2 === 0 ? -1 : 1)
  const ringRadius = radius + Math.floor(slot / 6) * 0.45
  const angle = baseAngle + fan

  return Vector3.create(center.x + Math.cos(angle) * ringRadius, center.y, center.z + Math.sin(angle) * ringRadius)
}

function removeSelectable(selectable: Selectable): void {
  selectable.alive = false
  removeSelectableInteractivity(selectable)
  // Procedural model parts follow the hidden root, so only the registries need unregistering.
  disposeUnit(selectable.entity, false)
  disposeResourceModel(selectable.entity, false)
  disposeBuildingModel(selectable.entity, false)
  removeBuildingBeacon(selectable)
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
  disposeUnit(selectable.entity, true)
  disposeResourceModel(selectable.entity, true)
  disposeBuildingModel(selectable.entity, true)
  removeBuildingBeacon(selectable)
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

// Test hook: the headless harness (scripts/headless-test.js) sets __RTS_TEST__
// before main() runs so simulations can spawn units and inspect state directly.
// Never set in the real client, so this stays inert in production.
if ((globalThis as unknown as { __RTS_TEST__?: boolean }).__RTS_TEST__) {
  ;(globalThis as unknown as Record<string, unknown>).__rtsTest = {
    gameState,
    buildings,
    soldiers,
    workers,
    selectables,
    createSoldier,
    createWorker,
    createBuilding,
    assignSoldierToAttack,
    damageCombatTarget,
    getUpgradeLevel,
    startUpgradeResearchOrder,
    startRtsMatch,
    queueSoldier,
    startUpgradeResearch,
    setStatus
  }
}

