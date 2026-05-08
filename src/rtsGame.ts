import {
  Animator,
  AudioSource,
  Billboard,
  BillboardMode,
  ColliderLayer,
  Entity,
  GltfContainer,
  InputAction,
  Material,
  MeshCollider,
  MeshRenderer,
  PointerEventType,
  PrimaryPointerInfo,
  TextAlignMode,
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
import { gameState } from './rts/state'
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
  UnitGroupKind,
  UnitProductionOrder,
  Worker,
  WorkerProductionOrder
} from './rts/types'
export type { SelectedSummary } from './rts/types'
export { gameState }

const selectables = new Map<string, Selectable>()
const workers: Worker[] = []
const soldiers: Soldier[] = []
const resources: ResourceNode[] = []
const buildings: Building[] = []
const workerProductionOrders: WorkerProductionOrder[] = []
const soldierProductionOrders: UnitProductionOrder[] = []
type RallyMarker = { root: Entity; pole: Entity; flag: Entity; base: Entity }
type BuildingPreview = { ghostEntity: Entity; ghostFootprintEntity: Entity; ghostModelEntity: Entity }

let placementState: PlacementState = { state: 'none' }
let nextId = 1
let selectionMarker: Entity | undefined
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
const BUILDING_FOOTPRINT_Y = 0.18
const BUILDING_FOOTPRINT_HEIGHT = 0.16
const BUILDING_PREVIEW_PADDING = 1.5
const BUILDING_PLACEMENT_CLICK_COOLDOWN = 0.25
const BUILDING_PLACEMENT_GRID_SIZE = 0.5
const BUILDING_PLACEMENT_PADDING = 0.6
const BUILDING_FOOTPRINT_VALID = Color4.create(0.2, 0.95, 0.35, 0.45)
const BUILDING_FOOTPRINT_BLOCKED = Color4.create(0.95, 0.15, 0.12, 0.5)
const DEPLETED_MEAT_HIDE_DELAY = 180
const SOLDIER_MOVE_COMMAND_CLICK_COOLDOWN = 0.2
const SOLDIER_MOVE_FORMATION_RADIUS = 0.9
const SOLDIER_ATTACK_SPACING = 0.7

let soldierCommandMode: 'none' | 'move' = 'none'
let soldierCommandCooldown = 0
let enemyAiDecisionTimer = 0
let enemyAiAttackTimer = 25

export function initRtsGame(): void {
  createStaticScene()
  createStartingBase()
  engine.addSystem(rtsTickSystem)
}

export function queueWorker(): void {
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

  workerProductionOrders.push({ homesteadId: homestead.id, timer: 0, team: 'player' })
  gameState.workerQueue += 1
  setStatus('Worker queued at Homestead.')
}

export function setWorkerSpawnPoint(): void {
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

  const position = getPlayerPosition()
  if (!position) {
    setStatus('Player position is not ready yet.')
    return
  }

  const rallyPoint = Vector3.create(position.x, 0.25, position.z)
  homesteadRallyPoints.set(homestead.id, rallyPoint)
  setStatus(`Homestead worker spawn set to ${formatPosition(rallyPoint)}.`)
}

export function setBarracksSpawnPoint(): void {
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

  const position = getPlayerPosition()
  if (!position) {
    setStatus('Player position is not ready yet.')
    return
  }

  const rallyPoint = Vector3.create(position.x, 0.25, position.z)
  barracksRallyPoints.set(barracks.id, rallyPoint)
  setStatus(`Barracks spawn set to ${formatPosition(rallyPoint)}.`)
}

export function startWorkerBuildingPlacement(kind: BuildableKind): void {
  const selected = getSelected()
  const worker = selected?.kind === 'worker' ? (selected as Worker) : undefined
  const definition = BUILDING_DEFINITIONS[kind]

  if (!worker || !worker.alive) {
    setStatus('Select a live worker to build.')
    return
  }

  if (worker.state === 'movingToBuild' || worker.state === 'constructing') {
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
  setStatus(`Placing ${definition.name}. Move the cursor to an open area and click to build.`)
}

export function cancelBuildingPlacement(): void {
  if (placementState.state !== 'placing') return

  const definition = BUILDING_DEFINITIONS[placementState.buildingKind]
  cancelPlacement()
  setStatus(`Cancelled ${definition.name} placement.`)
}

export function queueSoldier(): void {
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

  soldierProductionOrders.push({ barracksId: barracks.id, timer: 0, team: 'player' })
  gameState.soldierQueue += 1
  setStatus(`${SOLDIER_DEFINITION.name} queued at Barracks.`)
}

export function selectAllLikeSelected(): void {
  const selected = getSelected()

  if (selected?.kind !== 'worker' && selected?.kind !== 'soldier') {
    setStatus(`Select a worker or ${SOLDIER_DEFINITION.name} first.`)
    return
  }

  gameState.selectedGroupKind = selected.kind
  const count = selected.kind === 'worker' ? getAvailableWorkers().length : getAvailableSoldiers().length
  const unitLabel = selected.kind === 'worker' ? 'workers' : `${SOLDIER_DEFINITION.name}s`
  setStatus(`Selected all ${unitLabel} (${count}). Click a valid target to command them.`)
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
  moveSelectionMarker(building)
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
  moveSelectionMarker(building)
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

function getPlacedResourceCount(resource: ResourceKind): number {
  return resources.filter((node) => node.resource === resource).length
}

function saveResourcePlacement(resource: ResourceKind, position: Vector3): void {
  const location = formatVectorForPaste(position)

  getSavedResourceLocations(resource).push(location)
  printResourcePlacementLists()
}

export function resetRtsGame(): void {
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
  gameState.selectedId = ''
  gameState.selectedKind = ''
  gameState.selectedGroupKind = ''
  gameState.status = 'Reset complete. Select a worker to start gathering.'
  gameState.workerQueue = 0
  gameState.soldierQueue = 0
  gameState.placementMode = 'none'
  gameState.placementBuildingKind = ''
  gameState.savedTreeLocations = []
  gameState.savedRockLocations = []
  gameState.savedMeatLocations = []
  homesteadRallyPoints.clear()
  barracksRallyPoints.clear()
  cancelSoldierCommand()
  cancelPlacement()

  for (const worker of workers) removeSelectable(worker)
  for (const soldier of soldiers) removeSelectable(soldier)
  for (const resource of resources) removeSelectable(resource)
  for (const building of buildings) removeSelectable(building)

  workers.length = 0
  soldiers.length = 0
  resources.length = 0
  buildings.length = 0
  workerProductionOrders.length = 0
  soldierProductionOrders.length = 0
  enemyAiDecisionTimer = 0
  enemyAiAttackTimer = 25
  nextId = 1

  if (selectionMarker) {
    Transform.getMutable(selectionMarker).position = Vector3.create(0, -10, 0)
  }

  createStartingBase()
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

export function getSelectedSummary(): SelectedSummary {
  const selected = getSelected()

  if (!selected) {
    return {
      name: 'None',
      kind: 'none',
      detail: getPlacementInstruction() || 'Select Temple, worker, rock, tree, or building.'
    }
  }

  if (selected.kind === 'worker') {
    const worker = selected as Worker
    return {
      name: worker.name,
      kind: worker.kind,
      team: getTeam(worker),
      hp: worker.hp,
      maxHp: worker.maxHp,
      detail: `${gameState.selectedGroupKind === 'worker' ? `All workers selected (${getAvailableWorkers().length}). ` : ''}State: ${worker.state}${worker.carrying > 0 ? `, carrying ${worker.carrying} ${worker.carryingResource}` : ''}`
    }
  }

  if (selected.kind === 'soldier') {
    const soldier = selected as Soldier
    return {
      name: soldier.name,
      kind: soldier.kind,
      team: getTeam(soldier),
      hp: soldier.hp,
      maxHp: soldier.maxHp,
      detail: `${gameState.selectedGroupKind === 'soldier' ? `All ${SOLDIER_DEFINITION.name}s selected (${getAvailableSoldiers().length}). ` : ''}State: ${soldier.state}`
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
  createSkybox()
  selectionMarker = createVisualBoxEntity({
    position: Vector3.create(0, -10, 0),
    scale: Vector3.create(GRID.plotSize * 0.9, 0.08, GRID.plotSize * 0.9),
    color: COLORS.selected,
    emissive: COLORS.selected
  })
  rallyMarker = createRallyMarker()
}

function createSkybox(): void {
  const skybox = engine.addEntity()

  Transform.create(skybox, {
    position: Vector3.create(SCENE.center, 0, SCENE.center)
  })
  GltfContainer.create(skybox, {
    src: ASSETS.skybox
  })
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
  }

  for (let i = 0; i < POSITIONS.workers.length; i++) {
    const offset = getFormationPosition(Vector3.create(POSITIONS.enemyTemple.x, 0.25, POSITIONS.enemyTemple.z + 5), i, 1)
    workers.push(createWorker(offset, 'enemy'))
    gameState.enemySupplyUsed += 1
  }
}

function spawnResourceNodes(resource: ResourceKind, positions: Vector3[]): void {
  const definition = RESOURCE_DEFINITIONS[resource]

  for (let i = 0; i < positions.length; i++) {
    resources.push(createResourceNode(resource, `${definition.name} ${i + 1}`, positions[i]))
  }
}

function createWorker(position: Vector3, team: Team = 'player'): Worker {
  const worker = createSelectableModel('worker', `${team === 'enemy' ? 'Enemy Worker' : 'Worker'} ${getTeamWorkerCount(team) + 1}`, {
    position,
    scale: Vector3.create(1, 1, 1),
    src: getRandomWorkerModel(),
    colliderScale: Vector3.create(0.55, 1.6, 0.55),
    animations: [
      { clip: 'idle', playing: true, loop: true },
      { clip: 'walk', playing: false, loop: true },
      { clip: 'expression', playing: false, loop: false }
    ]
  }, team === 'player', team) as Worker

  worker.hp = CONFIG.workerHp
  worker.maxHp = CONFIG.workerHp
  worker.state = 'idle'
  worker.timer = 0
  worker.carrying = 0
  worker.activeAnimation = 'idle'
  return worker
}

function getRandomWorkerModel(): string {
  return ASSETS.workers[Math.floor(Math.random() * ASSETS.workers.length)]
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
      { clip: 'attack', playing: false, loop: false },
      { clip: 'impact', playing: false, loop: false }
    ]
  }, team === 'player', team) as Soldier

  soldier.hp = SOLDIER_DEFINITION.hp
  soldier.maxHp = SOLDIER_DEFINITION.hp
  soldier.state = 'idle'
  soldier.attackTimer = 0
  soldier.activeAnimation = 'idle'
  return soldier
}

function createResourceNode(resource: ResourceKind, name: string, position: Vector3): ResourceNode {
  const definition = RESOURCE_DEFINITIONS[resource]
  const patch = createSelectableModel('resource', name, {
    position,
    scale: Vector3.create(1, 1, 1),
    src: definition.src,
    colliderScale: definition.colliderScale,
    animations: definition.animations,
    audioClipUrl: definition.audioClipUrl
  }, false) as ResourceNode

  patch.resource = resource
  patch.amount = definition.amount
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
  const id = `${kind}-${nextId++}`
  const entity = createBoxEntity(box)
  const selectable: Selectable = { id, kind, name, entity, alive: true, team }

  selectables.set(id, selectable)
  registerSelectable(selectable)
  return selectable
}

function createSelectableModel(kind: SelectableKind, name: string, model: ModelConfig, registerOnCreate = true, team: Team = 'player'): Selectable {
  const id = `${kind}-${nextId++}`
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

function createModelEntity(config: ModelConfig): Entity {
  const entity = engine.addEntity()

  Transform.create(entity, {
    position: cloneVector(config.position),
    rotation: Quaternion.fromEulerDegrees(0, config.rotationY ?? 0, 0),
    scale: cloneVector(config.scale)
  })
  GltfContainer.create(entity, {
    src: config.src,
    visibleMeshesCollisionMask: ColliderLayer.CL_POINTER | ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
  })

  if (config.animations) {
    Animator.create(entity, { states: config.animations })
  }

  if (config.audioClipUrl) {
    AudioSource.create(entity, {
      audioClipUrl: config.audioClipUrl,
      playing: false,
      loop: false,
      volume: 0.55
    })
  }

  return entity
}

function createModelColliderEntity(parent: Entity, config: ModelConfig): Entity {
  const collider = engine.addEntity()
  const colliderScale = Vector3.create(
    config.colliderScale?.x ?? config.scale.x,
    config.colliderScale?.y ?? config.scale.y,
    config.colliderScale?.z ?? config.scale.z
  )

  Transform.create(collider, {
    parent,
    position: Vector3.create(0, colliderScale.y / (2 * config.scale.y), 0),
    scale: Vector3.create(colliderScale.x / config.scale.x, colliderScale.y / config.scale.y, colliderScale.z / config.scale.z)
  })
  MeshCollider.setBox(collider)

  return collider
}

function createBoxEntity(config: BoxConfig): Entity {
  const entity = createVisualBoxEntity(config)

  MeshCollider.setBox(entity)
  return entity
}

function createVisualBoxEntity(config: BoxConfig): Entity {
  const entity = engine.addEntity()

  Transform.create(entity, {
    position: cloneVector(config.position),
    scale: cloneVector(config.scale)
  })
  MeshRenderer.setBox(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: config.color,
    emissiveColor: config.emissive ?? Color4.Black(),
    transparencyMode: config.transparent ? 1 : 0
  })

  return entity
}

function createRallyMarker(): RallyMarker {
  const root = engine.addEntity()

  Transform.create(root, {
    position: Vector3.create(0, -10, 0),
    scale: Vector3.create(1, 1, 1)
  })

  return {
    root,
    pole: createRallyMarkerPart(root, Vector3.create(0, 0.75, 0), Vector3.create(0.08, 1.5, 0.08), UIColors.rallyPole),
    flag: createRallyMarkerPart(root, Vector3.create(0.34, 1.35, 0), Vector3.create(0.68, 0.34, 0.06), UIColors.rallyFlag),
    base: createRallyMarkerPart(root, Vector3.create(0, 0.03, 0), Vector3.create(0.55, 0.06, 0.55), UIColors.rallyBase)
  }
}

const UIColors = {
  rallyPole: Color4.create(0.95, 0.9, 0.65, 1),
  rallyFlag: Color4.create(0.2, 0.85, 0.35, 0.95),
  rallyBase: Color4.create(0.2, 0.6, 1, 0.45)
}

function createRallyMarkerPart(parent: Entity, position: Vector3, scale: Vector3, color: Color4): Entity {
  const entity = engine.addEntity()

  Transform.create(entity, { parent, position, scale })
  MeshRenderer.setBox(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: color,
    emissiveColor: color,
    transparencyMode: color.a < 1 ? 1 : 0
  })

  return entity
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

function createLabel(parent: Entity, text: string, offsetY: number): Entity {
  const label = engine.addEntity()

  Transform.create(label, {
    parent,
    position: Vector3.create(0, offsetY, 0),
    scale: Vector3.create(1, 1, 1)
  })
  TextShape.create(label, {
    text,
    fontSize: 2,
    textColor: Color4.White(),
    outlineColor: Color4.Black(),
    outlineWidth: 0.15,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })

  return label
}

function registerSelectable(selectable: Selectable): void {
  const pointerTarget = selectable.colliderEntity ?? selectable.entity

  ensurePointerCollider(pointerTarget)
  pointerEventsSystem.onPointerDown(
    {
      entity: pointerTarget,
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
  const selected = getSelected()

  if (!clicked || !clicked.alive) return

  if (placementState.state === 'placing') {
    confirmBuildingPlacement()
    return
  }

  if (soldierCommandMode === 'move') {
    if (isEnemyAttackTarget(clicked)) {
      assignCommandableSoldiersToAttack(clicked as Building)
    } else {
      cancelSoldierCommand()
      setStatus('Move cancelled. Click open ground after pressing Move.')
    }
    return
  }

  if (gameState.selectedGroupKind === 'worker' && clicked.kind === 'resource') {
    assignWorkersToResource(clicked as ResourceNode)
    return
  }

  if (gameState.selectedGroupKind === 'soldier' && isEnemyAttackTarget(clicked)) {
    assignCommandableSoldiersToAttack(clicked as Building)
    return
  }

  if (selected?.kind === 'worker' && clicked.kind === 'resource') {
    assignWorkerToResource(selected as Worker, clicked as ResourceNode)
    return
  }

  if (selected?.kind === 'soldier' && isEnemyAttackTarget(clicked)) {
    assignCommandableSoldiersToAttack(clicked as Building)
    return
  }

  selectObject(clicked)
}

function selectObject(selectable: Selectable): void {
  gameState.selectedId = selectable.id
  gameState.selectedKind = selectable.kind
  gameState.selectedGroupKind = ''
  moveSelectionMarker(selectable)
  setStatus(`Selected ${selectable.name}.`)
}

function moveSelectionMarker(selectable: Selectable): void {
  if (!selectionMarker) return

  const position = Transform.get(selectable.entity).position
  const scale = Transform.get(selectable.entity).scale
  const markerTransform = Transform.getMutable(selectionMarker)
  const markerPosition = getSelectableAnchorPosition(selectable, position)

  markerTransform.position = Vector3.create(markerPosition.x, 0.05, markerPosition.z)
  markerTransform.scale = Vector3.create(Math.max(scale.x, scale.z) + 0.35, 0.08, Math.max(scale.x, scale.z) + 0.35)
}

function clearSelection(): void {
  gameState.selectedId = ''
  gameState.selectedKind = ''
  gameState.selectedGroupKind = ''
  cancelSoldierCommand()

  if (selectionMarker) {
    Transform.getMutable(selectionMarker).position = Vector3.create(0, -10, 0)
  }
}

function assignWorkerToResource(worker: Worker, resource: ResourceNode, announce = true): void {
  if (!worker.alive || !resource.alive || resource.amount <= 0) return
  if (worker.state === 'movingToBuild' || worker.state === 'constructing') {
    setStatus(`${worker.name} is busy building.`)
    return
  }

  worker.state = 'movingToResource'
  worker.targetResourceId = resource.id
  worker.buildSiteId = undefined
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

function assignWorkersToResource(resource: ResourceNode): void {
  const assignedWorkers = getAvailableWorkers()

  for (const worker of assignedWorkers) {
    assignWorkerToResource(worker, resource)
  }

  clearSelection()
  setStatus(`${assignedWorkers.length} workers gathering ${resource.name}.`)
}

function sendWorkerToRally(worker: Worker, rallyPoint: Vector3): void {
  worker.state = 'movingToRally'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
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

function assignSoldierToAttack(soldier: Soldier, target: Building, slot = 0): void {
  if (!soldier.alive || !target.alive) return

  soldier.state = 'movingToAttack'
  soldier.targetId = target.id
  soldier.attackPosition = getSoldierAttackPosition(target, slot)
  soldier.rallyPoint = undefined
  soldier.attackTimer = 0
  setSoldierAnimation(soldier, 'walk')
  if (getTeam(soldier) === 'player') setStatus(`${soldier.name} attacking ${target.name}.`)
}

function assignCommandableSoldiersToAttack(target: Building): void {
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

  clearSelection()
  setStatus(`${assignedSoldiers.length} ${SOLDIER_DEFINITION.name}${assignedSoldiers.length === 1 ? '' : 's'} moving.`)
}

function confirmBuildingPlacement(hitPosition?: Vector3): void {
  if (placementState.state !== 'placing') return

  const definition = BUILDING_DEFINITIONS[placementState.buildingKind]
  const builder = getWorkerById(placementState.builderWorkerId)
  const position = hitPosition ?? currentBuildingPreviewPosition ?? getCurrentAnchoredBuildingPlacement(definition)?.center

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

function rtsTickSystem(dt: number): void {
  updateCoordinateLogger(dt)
  updateGhostPreview()
  updatePlacementConfirmInput(dt)
  updateSoldierMoveCommandInput(dt)
  updateCancelInput()
  updateRallyMarker()
  updateWorkerProduction(dt)
  updateSoldierProduction(dt)
  updateEnemyAi(dt)
  updateWorkers(dt)
  updateSoldiers(dt)
  updateConstructionSites(dt)
  updateDepletedResources(dt)
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

function updateGhostPreview(): void {
  if (placementState.state !== 'placing') return

  const definition = BUILDING_DEFINITIONS[placementState.buildingKind]
  const placement = getCurrentAnchoredBuildingPlacement(definition)
  if (!placement) return

  currentBuildingPreviewPosition = placement.center
  currentBuildingPreviewCanPlace = canPlaceBuildingAt(definition, placement.center)
  currentBuildingPreviewRotationY = placement.rotationY

  Transform.getMutable(placementState.ghostEntity).position = Vector3.create(placement.center.x, 0, placement.center.z)
  Transform.getMutable(placementState.ghostModelEntity).rotation = Quaternion.fromEulerDegrees(0, currentBuildingPreviewRotationY, 0)
  updateFootprintMaterial(placementState.ghostFootprintEntity, currentBuildingPreviewCanPlace)
}

function updatePlacementConfirmInput(dt: number): void {
  if (placementState.state !== 'placing') return

  placementConfirmCooldown = Math.max(0, placementConfirmCooldown - dt)
  if (placementConfirmCooldown > 0) return
  if (!inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return

  confirmBuildingPlacement()
}

function updateSoldierMoveCommandInput(dt: number): void {
  if (soldierCommandMode !== 'move' || placementState.state === 'placing') return

  soldierCommandCooldown = Math.max(0, soldierCommandCooldown - dt)
  if (soldierCommandCooldown > 0) return
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

function updateWorkerProduction(dt: number): void {
  for (let i = workerProductionOrders.length - 1; i >= 0; i--) {
    const order = workerProductionOrders[i]
    const homestead = getBuildingById(order.homesteadId)

    if (!homestead?.alive || !homestead.isComplete) {
      workerProductionOrders.splice(i, 1)
      decrementWorkerQueue(order.team)
      if (order.team === 'player') setStatus('Worker production cancelled: Homestead unavailable.')
      continue
    }

    order.timer += dt
    if (order.timer < CONFIG.productionTime) continue

    const worker = createWorker(getHomesteadExitPosition(homestead, getTeamWorkerCount(order.team)), order.team)
    const rallyPoint = homesteadRallyPoints.get(homestead.id)

    workers.push(worker)
    if (rallyPoint) {
      sendWorkerToRally(worker, rallyPoint)
    }
    addSupplyUsed(order.team, 1)
    decrementWorkerQueue(order.team)
    workerProductionOrders.splice(i, 1)
    if (order.team === 'player') setStatus(rallyPoint ? 'Worker ready and moving to Homestead spawn point.' : 'Worker ready outside Homestead.')
  }
}

function updateSoldierProduction(dt: number): void {
  for (let i = soldierProductionOrders.length - 1; i >= 0; i--) {
    const order = soldierProductionOrders[i]
    const barracks = getBuildingById(order.barracksId)

    if (!barracks?.alive || !barracks.isComplete) {
      soldierProductionOrders.splice(i, 1)
      decrementSoldierQueue(order.team)
      if (order.team === 'player') setStatus(`${SOLDIER_DEFINITION.name} production cancelled: Barracks unavailable.`)
      continue
    }

    order.timer += dt
    if (order.timer < SOLDIER_DEFINITION.productionTime) continue

    const soldier = createSoldier(getBarracksExitPosition(barracks, getTeamSoldierCount(order.team)), order.team)
    const rallyPoint = barracksRallyPoints.get(barracks.id)

    soldiers.push(soldier)
    if (rallyPoint) {
      sendSoldierToRally(soldier, rallyPoint)
    }
    addSupplyUsed(order.team, SOLDIER_DEFINITION.supply)
    decrementSoldierQueue(order.team)
    soldierProductionOrders.splice(i, 1)
    if (order.team === 'player') setStatus(rallyPoint ? `${SOLDIER_DEFINITION.name} ready and moving to Barracks spawn point.` : `${SOLDIER_DEFINITION.name} ready outside Barracks.`)
  }
}

function updateWorkers(dt: number): void {
  for (const worker of workers) {
    if (!worker.alive) continue

    updateWorkerGathering(worker, dt)
    updateWorkerBuildMovement(worker, dt)
    updateWorkerRallyMovement(worker, dt)
  }
}

function updateSoldiers(dt: number): void {
  for (const soldier of soldiers) {
    if (!soldier.alive) continue

    if (soldier.state === 'movingToRally') {
      updateSoldierRallyMovement(soldier, dt)
      continue
    }

    if (!soldier.targetId) continue

    const target = getBuildingById(soldier.targetId)

    if (!target?.alive) {
      soldier.state = 'idle'
      soldier.targetId = undefined
      soldier.attackPosition = undefined
      setSoldierAnimation(soldier, 'idle')
      continue
    }

    if (soldier.state === 'movingToAttack') {
      const attackPosition = soldier.attackPosition ?? getSoldierAttackPosition(target, 0)
      soldier.attackPosition = attackPosition
      moveTowardPosition(soldier.entity, attackPosition, CONFIG.soldierMoveSpeed, dt)
      setSoldierAnimation(soldier, 'walk')
      if (distanceToPosition(soldier.entity, attackPosition) <= 0.25) {
        soldier.state = 'attacking'
        soldier.attackTimer = 0
        setSoldierAnimation(soldier, 'attack')
      }
    } else if (soldier.state === 'attacking') {
      soldier.attackTimer += dt
      if (soldier.attackTimer >= CONFIG.soldierAttackRate) {
        soldier.attackTimer = 0
        setSoldierAnimation(soldier, 'attack', true)
        damageBuilding(target, CONFIG.soldierDamage)
      }
    }
  }
}

function updateEnemyAi(dt: number): void {
  enemyAiAttackTimer += dt
  enemyAiDecisionTimer += dt

  if (enemyAiAttackTimer >= CONFIG.enemyAiAttackInterval) {
    enemyAiAttackTimer = 0
    sendEnemyAttackWave()
  }

  if (enemyAiDecisionTimer < CONFIG.enemyAiDecisionRate) return
  enemyAiDecisionTimer = 0

  assignIdleEnemyWorkers()
  runEnemyBuildOrder()
  queueEnemyProduction()
}

function assignIdleEnemyWorkers(): void {
  for (const worker of getIdleWorkersForTeam('enemy')) {
    const resourceKind = getEnemyWorkerResourcePriority()
    const resource = getNearestResourceOfKind(Transform.get(worker.entity).position, resourceKind)

    if (resource) {
      assignWorkerToResource(worker, resource, false)
    }
  }
}

function runEnemyBuildOrder(): void {
  const enemyHomesteads = getCompletedTeamBuildings('enemy', 'supplyHouse')
  const enemyBarracks = getCompletedTeamBuildings('enemy', 'barracks')
  const enemyTemples = getCompletedTeamBuildings('enemy', 'temple')
  const enemyWorkers = getTeamWorkerCount('enemy')
  const enemyGuards = getTeamSoldierCount('enemy')

  if (shouldBuildEnemyHomestead(enemyHomesteads.length)) {
    tryStartEnemyConstruction('supplyHouse')
    return
  }

  if (enemyWorkers >= 6 && enemyBarracks.length === 0) {
    tryStartEnemyConstruction('barracks')
    return
  }

  if (enemyWorkers >= 8 && enemyGuards >= CONFIG.enemyAiDefenderCount && enemyTemples.length < 3) {
    tryStartEnemyConstruction('temple')
    return
  }

  if (getSupplyCap('enemy') - getSupplyUsed('enemy') <= 2 && enemyHomesteads.length < 4) {
    tryStartEnemyConstruction('supplyHouse')
  }
}

function queueEnemyProduction(): void {
  const enemyWorkers = getTeamWorkerCount('enemy') + gameState.enemyWorkerQueue
  const enemyGuards = getTeamSoldierCount('enemy') + gameState.enemySoldierQueue
  const enemyHomestead = getCompletedTeamBuildings('enemy', 'supplyHouse')[0]
  const enemyBarracks = getCompletedTeamBuildings('enemy', 'barracks')[0]

  if (enemyHomestead && enemyWorkers < CONFIG.enemyAiTargetWorkers && canQueueUnit('enemy', 1) && spendResources('enemy', { meat: CONFIG.workerCost })) {
    workerProductionOrders.push({ homesteadId: enemyHomestead.id, timer: 0, team: 'enemy' })
    gameState.enemyWorkerQueue += 1
  }

  if (enemyBarracks && enemyGuards < CONFIG.enemyAiTargetGuards && canQueueUnit('enemy', SOLDIER_DEFINITION.supply) && spendResources('enemy', SOLDIER_DEFINITION.cost)) {
    soldierProductionOrders.push({ barracksId: enemyBarracks.id, timer: 0, team: 'enemy' })
    gameState.enemySoldierQueue += 1
  }
}

function tryStartEnemyConstruction(kind: BuildableKind): boolean {
  const definition = BUILDING_DEFINITIONS[kind]
  const builder = getEnemyBuilder()
  const position = getEnemyBuildPosition(kind)

  if (!builder || !position || !hasResources('enemy', definition.cost)) return false
  if (!canPlaceBuildingAt(definition, position)) return false
  if (!spendResources('enemy', definition.cost)) return false

  const site = createConstructionSite(kind, Vector3.create(position.x, definition.placementY, position.z), builder.id, 180, 'enemy')
  builder.state = 'movingToBuild'
  builder.targetResourceId = undefined
  builder.buildSiteId = site.id
  builder.rallyPoint = undefined
  builder.timer = 0
  builder.carrying = 0
  builder.carryingResource = undefined
  setWorkerAnimation(builder, 'walk')
  return true
}

function sendEnemyAttackWave(): void {
  const playerTemple = getNearestTemple(POSITIONS.base, 'player')
  if (!playerTemple) return

  const availableAttackers = soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === 'enemy' && soldier.state === 'idle')
  const attackers = availableAttackers.slice(CONFIG.enemyAiDefenderCount)

  if (attackers.length < 3) return

  for (let i = 0; i < attackers.length; i++) {
    assignSoldierToAttack(attackers[i], playerTemple, i)
  }

  setStatus(`Enemy attack wave incoming: ${attackers.length} guards.`)
}

function updateWorkerGathering(worker: Worker, dt: number): void {
  const resource = worker.targetResourceId ? resources.find((patch) => patch.id === worker.targetResourceId && patch.alive) : undefined

  if (worker.state === 'movingToResource' && resource) {
    const gatherPosition = getWorkerGatherPosition(worker, resource)
    moveTowardPosition(worker.entity, gatherPosition, CONFIG.workerMoveSpeed, dt)
    if (distanceToPosition(worker.entity, gatherPosition) < 0.35) {
      worker.state = 'gathering'
      worker.timer = 0
      setWorkerAnimation(worker, 'idle')
      playResourceGatherFeedback(resource)
    }
  } else if (worker.state === 'gathering' && resource) {
    worker.timer += dt
    if (worker.timer >= CONFIG.workerMineTime) {
      const gathered = Math.min(CONFIG.workerCarryAmount, resource.amount)
      resource.amount -= gathered
      worker.carrying = gathered
      worker.carryingResource = resource.resource
      worker.state = 'returning'
      worker.timer = 0
      setWorkerAnimation(worker, 'walk')

      if (resource.amount <= 0) {
        depleteResourceNode(resource)
      } else {
        updateLabel(resource, `${resource.name}\n${resource.amount}`)
      }
    }
  } else if (worker.state === 'returning') {
    const temple = getNearestTemple(Transform.get(worker.entity).position, getTeam(worker))
    if (!temple) {
      worker.state = 'idle'
      worker.carrying = 0
      worker.carryingResource = undefined
      setWorkerAnimation(worker, 'idle')
      if (getTeam(worker) === 'player') setStatus(`${worker.name} cannot deliver: no Temple is available.`)
      return
    }

    const dropoffPosition = getTempleDropoffPosition(temple, worker)
    moveTowardPosition(worker.entity, dropoffPosition, CONFIG.workerMoveSpeed, dt)
    if (distanceToPosition(worker.entity, dropoffPosition) < 0.35) {
      const deliveredResource = worker.carryingResource ?? 'rocks'
      addResource(getTeam(worker), deliveredResource, worker.carrying)
      worker.carrying = 0
      worker.carryingResource = undefined
      worker.state = resource?.alive ? 'movingToResource' : 'idle'
      setWorkerAnimation(worker, worker.state === 'idle' ? 'idle' : 'walk')
      if (getTeam(worker) === 'player') setStatus(`${worker.name} delivered ${deliveredResource}. Total: ${getResourceAmount(getTeam(worker), deliveredResource)}.`)
    }
  } else if (!resource && ['movingToResource', 'gathering', 'returning'].includes(worker.state)) {
    worker.state = 'idle'
    worker.targetResourceId = undefined
    worker.carrying = 0
    worker.carryingResource = undefined
    setWorkerAnimation(worker, 'idle')
  }
}

function updateWorkerBuildMovement(worker: Worker, dt: number): void {
  if (worker.state !== 'movingToBuild' || !worker.buildSiteId) return

  const site = getBuildingById(worker.buildSiteId)
  if (!site?.alive || site.isComplete) {
    worker.state = 'idle'
    worker.buildSiteId = undefined
    return
  }

  const workPosition = getBuilderWorkPosition(site, Transform.get(worker.entity).position)
  moveTowardPosition(worker.entity, workPosition, CONFIG.builderMoveSpeed, dt)
  if (distanceToPosition(worker.entity, workPosition) <= 0.25) {
    worker.state = 'constructing'
    site.constructionState = 'building'
    setWorkerAnimation(worker, 'expression')
    if (getTeam(worker) === 'player') setStatus(`${worker.name} started constructing ${site.name}.`)
  }
}

function updateWorkerRallyMovement(worker: Worker, dt: number): void {
  if (worker.state !== 'movingToRally') return

  if (!worker.rallyPoint) {
    worker.state = 'idle'
    setWorkerAnimation(worker, 'idle')
    return
  }

  const rallyPosition = getWorkerRallyPosition(worker)
  moveTowardPosition(worker.entity, rallyPosition, CONFIG.workerMoveSpeed, dt)
  if (distanceToPosition(worker.entity, rallyPosition) <= 0.35) {
    worker.state = 'idle'
    worker.rallyPoint = undefined
    setWorkerAnimation(worker, 'idle')
    if (getTeam(worker) === 'player') setStatus(`${worker.name} reached the spawn point.`)
  }
}

function updateSoldierRallyMovement(soldier: Soldier, dt: number): void {
  if (!soldier.rallyPoint) {
    soldier.state = 'idle'
    soldier.attackPosition = undefined
    setSoldierAnimation(soldier, 'idle')
    return
  }

  moveTowardPosition(soldier.entity, soldier.rallyPoint, CONFIG.soldierMoveSpeed, dt)
  if (distanceToPosition(soldier.entity, soldier.rallyPoint) <= 0.35) {
    soldier.state = 'idle'
    soldier.rallyPoint = undefined
    soldier.attackPosition = undefined
    setSoldierAnimation(soldier, 'idle')
    setStatus(`${soldier.name} reached destination.`)
  }
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

function damageBuilding(building: Building, amount: number): void {
  building.hp = Math.max(0, building.hp - amount)

  if (building.hp > 0) {
    if (building.kind === 'enemyBuilding') playAnimation(building.entity, 'impact')
    setStatus(`${building.name} HP: ${building.hp}/${building.maxHp}.`)
    return
  }

  if (building.kind === 'enemyBuilding') playAnimation(building.entity, 'die')
  removeSelectable(building)

  for (const soldier of soldiers) {
    if (soldier.targetId === building.id) {
      soldier.targetId = undefined
      soldier.attackPosition = undefined
      soldier.state = 'idle'
    }
  }

  setStatus(`${building.name} destroyed.`)
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
  if (gameState.selectedGroupKind === 'soldier') return getAvailableSoldiers()

  const selected = getSelected()
  return selected?.kind === 'soldier' && selected.alive ? [selected as Soldier] : []
}

function getTeam(selectable: Selectable): Team {
  return selectable.team ?? 'player'
}

function isEnemyAttackTarget(selectable: Selectable): selectable is Building {
  return selectable.kind !== 'resource' && selectable.kind !== 'worker' && selectable.kind !== 'soldier' && getTeam(selectable) === 'enemy'
}

function getTeamWorkerCount(team: Team): number {
  return workers.filter((worker) => worker.alive && getTeam(worker) === team).length
}

function getTeamSoldierCount(team: Team): number {
  return soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === team).length
}

function getAvailableWorkersForTeam(team: Team): Worker[] {
  return workers.filter((worker) => worker.alive && getTeam(worker) === team && worker.state !== 'movingToBuild' && worker.state !== 'constructing' && worker.state !== 'movingToRally')
}

function getIdleWorkersForTeam(team: Team): Worker[] {
  return workers.filter((worker) => worker.alive && getTeam(worker) === team && worker.state === 'idle')
}

function getTeamBuildings(team: Team, kind?: BuildableKind): Building[] {
  return buildings.filter((building) => building.alive && getTeam(building) === team && (!kind || building.kind === kind))
}

function getCompletedTeamBuildings(team: Team, kind: BuildableKind): Building[] {
  return getTeamBuildings(team, kind).filter((building) => building.isComplete)
}

function canQueueUnit(team: Team, supply: number): boolean {
  const queuedSupply = team === 'enemy' ? gameState.enemyWorkerQueue + gameState.enemySoldierQueue : gameState.workerQueue + gameState.soldierQueue
  return getSupplyUsed(team) + queuedSupply + supply <= getSupplyCap(team)
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

function getEnemyBuildPosition(kind: BuildableKind): Vector3 | undefined {
  const definition = BUILDING_DEFINITIONS[kind]
  const enemyTemple = getNearestTemple(POSITIONS.enemyTemple, 'enemy')
  const center = enemyTemple ? Transform.get(enemyTemple.entity).position : POSITIONS.enemyTemple
  const existingKindCount = getTeamBuildings('enemy', kind).length
  const offsets = getEnemyBuildOffsets(kind)

  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[(existingKindCount + i) % offsets.length]
    const position = getSnappedPlacementPosition(Vector3.create(center.x + offset.x, 0, center.z + offset.z))
    if (canPlaceBuildingAt(definition, position)) return position
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

function getSupplyUsed(team: Team): number {
  return team === 'enemy' ? gameState.enemySupplyUsed : gameState.supplyUsed
}

function getSupplyCap(team: Team): number {
  return team === 'enemy' ? gameState.enemySupplyCap : gameState.supplyCap
}

function addSupplyUsed(team: Team, amount: number): void {
  if (team === 'enemy') gameState.enemySupplyUsed += amount
  else gameState.supplyUsed += amount
}

function addSupplyCap(team: Team, amount: number): void {
  if (team === 'enemy') gameState.enemySupplyCap += amount
  else gameState.supplyCap += amount
}

function decrementWorkerQueue(team: Team): void {
  if (team === 'enemy') gameState.enemyWorkerQueue = Math.max(0, gameState.enemyWorkerQueue - 1)
  else gameState.workerQueue = Math.max(0, gameState.workerQueue - 1)
}

function decrementSoldierQueue(team: Team): void {
  if (team === 'enemy') gameState.enemySoldierQueue = Math.max(0, gameState.enemySoldierQueue - 1)
  else gameState.soldierQueue = Math.max(0, gameState.soldierQueue - 1)
}

function getBuildingById(id: string): Building | undefined {
  return buildings.find((building) => building.id === id)
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

function hasResources(team: Team, cost: ResourceCost): boolean {
  return (cost.rocks ?? 0) <= getResourceAmount(team, 'rocks') && (cost.wood ?? 0) <= getResourceAmount(team, 'wood') && (cost.meat ?? 0) <= getResourceAmount(team, 'meat')
}

function spendResources(team: Team, cost: ResourceCost): boolean {
  if (!hasResources(team, cost)) return false

  addResource(team, 'rocks', -(cost.rocks ?? 0))
  addResource(team, 'wood', -(cost.wood ?? 0))
  addResource(team, 'meat', -(cost.meat ?? 0))
  return true
}

function addResource(team: Team, resource: ResourceKind, amount: number): void {
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

function addResources(team: Team, cost: ResourceCost): void {
  addResource(team, 'rocks', cost.rocks ?? 0)
  addResource(team, 'wood', cost.wood ?? 0)
  addResource(team, 'meat', cost.meat ?? 0)
}

function getConstructionRefund(cost: ResourceCost, progress: number): ResourceCost {
  const refundMultiplier = 1 - clamp(progress, 0, 1)

  return {
    rocks: Math.floor((cost.rocks ?? 0) * refundMultiplier),
    wood: Math.floor((cost.wood ?? 0) * refundMultiplier),
    meat: Math.floor((cost.meat ?? 0) * refundMultiplier)
  }
}

function getResourceAmount(team: Team, resource: ResourceKind): number {
  if (resource === 'rocks') return team === 'enemy' ? gameState.enemyRocks : gameState.rocks
  if (resource === 'wood') return team === 'enemy' ? gameState.enemyWood : gameState.wood
  return team === 'enemy' ? gameState.enemyMeat : gameState.meat
}

function formatCost(cost: ResourceCost): string {
  const parts = []

  if (cost.rocks) parts.push(`${cost.rocks} rocks`)
  if (cost.wood) parts.push(`${cost.wood} wood`)
  if (cost.meat) parts.push(`${cost.meat} meat`)
  return parts.length > 0 ? parts.join(', ') : '0 resources'
}

function depleteResourceNode(resource: ResourceNode): void {
  resource.amount = 0
  if (resource.resource === 'meat') {
    resource.alive = false
    resource.depletionTimer = DEPLETED_MEAT_HIDE_DELAY
    pointerEventsSystem.removeOnPointerDown(resource.entity)
    MeshCollider.deleteFrom(resource.entity)
    playAnimation(resource.entity, RESOURCE_DEFINITIONS.meat.depletionClip ?? 'die')
    selectables.delete(resource.id)
    setStatus(`${resource.name} is depleted.`)
    return
  }

  removeSelectable(resource)

  setStatus(`${resource.name} is depleted and disappeared.`)
}

function setWorkerAnimation(worker: Worker, clipName: string, restart = false): void {
  if (worker.activeAnimation === clipName && !restart) return

  playAnimation(worker.entity, clipName)
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
  playAnimation(resource.entity, RESOURCE_DEFINITIONS[resource.resource].gatherClip)

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

function getPreviewRotationFacingViewer(position: Vector3): number {
  const viewerPosition = Transform.getOrNull(engine.CameraEntity)?.position ?? getPlayerPosition()
  if (!viewerPosition) return currentBuildingPreviewRotationY

  const dx = viewerPosition.x - position.x
  const dz = viewerPosition.z - position.z
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return currentBuildingPreviewRotationY

  return (Math.atan2(dx, dz) * 180) / Math.PI
}

function getCurrentAnchoredBuildingPlacement(definition: BuildingDefinition): { center: Vector3; rotationY: number } | undefined {
  const anchor = getBuildingPreviewPosition(definition)
  if (!anchor) return undefined

  const rotationY = getPreviewRotationFacingViewer(anchor)
  return {
    center: getBuildingCenterFromBackAnchor(definition, anchor, rotationY),
    rotationY
  }
}

function getBuildingCenterFromBackAnchor(definition: BuildingDefinition, anchor: Vector3, rotationY: number): Vector3 {
  const forward = getYawForward(rotationY)
  const halfDepth = definition.scale.z / 2

  return Vector3.create(anchor.x + forward.x * halfDepth, 0, anchor.z + forward.z * halfDepth)
}

function getSelectableAnchorPosition(selectable: Selectable, position: Vector3): Vector3 {
  if (!isBuildableKind(selectable.kind as Building['kind'])) return position

  const transform = Transform.get(selectable.entity)
  const rotationY = getYawFromQuaternion(transform.rotation)
  const definition = BUILDING_DEFINITIONS[selectable.kind as BuildableKind]
  const forward = getYawForward(rotationY)
  const halfDepth = definition.scale.z / 2

  return Vector3.create(position.x - forward.x * halfDepth, position.y, position.z - forward.z * halfDepth)
}

function getYawForward(rotationY: number): Vector3 {
  const radians = (rotationY * Math.PI) / 180
  return Vector3.create(Math.sin(radians), 0, Math.cos(radians))
}

function getYawFromQuaternion(rotation: Quaternion): number {
  const forward = Vector3.rotate(Vector3.Forward(), rotation)
  return (Math.atan2(forward.x, forward.z) * 180) / Math.PI
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

function distanceToPoint(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z

  return Math.sqrt(dx * dx + dz * dz)
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

function formatPosition(position: Vector3): string {
  return `x:${formatNumber(position.x)} y:${formatNumber(position.y)} z:${formatNumber(position.z)}`
}

function formatVectorForPaste(position: Vector3): string {
  return `Vector3.create(${formatNumber(position.x)}, ${formatNumber(position.y)}, ${formatNumber(position.z)})`
}

function formatNumber(value: number): string {
  return value.toFixed(2)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function moveTowardPosition(entity: Entity, target: Vector3, speed: number, dt: number): void {
  const transform = Transform.getMutable(entity)
  const current = transform.position
  const direction = Vector3.create(target.x - current.x, 0, target.z - current.z)
  const distance = Math.sqrt(direction.x * direction.x + direction.z * direction.z)

  if (distance <= 0.01) return

  const step = Math.min(distance, speed * dt)
  transform.position = Vector3.create(current.x + (direction.x / distance) * step, current.y, current.z + (direction.z / distance) * step)
  transform.rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(direction.x, direction.z) * 180) / Math.PI, 0)
}

function distanceBetween(a: Entity, b: Entity): number {
  return distanceToPosition(a, Transform.get(b).position)
}

function distanceToPosition(entity: Entity, position: Vector3): number {
  const current = Transform.get(entity).position
  const dx = current.x - position.x
  const dz = current.z - position.z

  return Math.sqrt(dx * dx + dz * dz)
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
  const targetRadius = Math.max(targetTransform.scale.x, targetTransform.scale.z) * 0.5
  const attackRadius = Math.max(CONFIG.soldierAttackRange * 0.75, targetRadius + SOLDIER_ATTACK_SPACING)
  const position = getFormationPosition(targetTransform.position, slot, attackRadius)

  return Vector3.create(position.x, 0.25, position.z)
}

function getFormationPosition(center: Vector3, slot: number, radius: number): Vector3 {
  const angle = slot * 2.399963229728653
  const ring = Math.floor(slot / 6)
  const slotRadius = radius + ring * 0.45

  return Vector3.create(center.x + Math.cos(angle) * slotRadius, center.y, center.z + Math.sin(angle) * slotRadius)
}

function cancelSoldierCommand(): void {
  soldierCommandMode = 'none'
  soldierCommandCooldown = 0
}

function offsetSpawn(position: Vector3, index: number): Vector3 {
  const offset = (index % 5) * 0.35

  return Vector3.create(position.x + offset, position.y, position.z + Math.floor(index / 5) * 0.35)
}

function hideEntity(entity: Entity): void {
  const transform = Transform.getMutable(entity)
  transform.position = Vector3.create(transform.position.x, -10, transform.position.z)
}

function removeSelectable(selectable: Selectable): void {
  selectable.alive = false
  removeSelectableInteractivity(selectable)
  hideEntity(selectable.entity)
  if (selectable.labelEntity) hideEntity(selectable.labelEntity)
  selectables.delete(selectable.id)

  if (gameState.selectedId === selectable.id) {
    gameState.selectedId = ''
    gameState.selectedKind = ''
    gameState.selectedGroupKind = ''
    if (selectionMarker) {
      Transform.getMutable(selectionMarker).position = Vector3.create(0, -10, 0)
    }
  }
}

function removeBuilding(building: Building): void {
  const index = buildings.findIndex((candidate) => candidate.id === building.id)
  if (index >= 0) buildings.splice(index, 1)
}

function removeSelectableInteractivity(selectable: Selectable): void {
  const pointerTarget = selectable.colliderEntity ?? selectable.entity

  pointerEventsSystem.removeOnPointerDown(pointerTarget)
  MeshCollider.deleteFrom(pointerTarget)
  if (selectable.colliderEntity) {
    engine.removeEntity(selectable.colliderEntity)
  }
  GltfContainer.deleteFrom(selectable.entity)
  MeshRenderer.deleteFrom(selectable.entity)
}

function cloneVector(vector: Vector3): Vector3 {
  return Vector3.create(vector.x, vector.y, vector.z)
}
