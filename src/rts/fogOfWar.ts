import { Entity, Material, MaterialTransparencyMode, MeshCollider, MeshRenderer, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { SCENE } from './config'
import { gameState, isHostileToPlayer } from './state'
import { getRace } from './races'
import { isProceduralBuilding, setBuildingModelVisible } from './buildingModels'
import { isProceduralResource, setResourceModelVisible } from './resourceModels'
import { isProceduralUnit, setUnitVisible } from './unitModels'
import type { Selectable } from './types'
import { buildings, getTeam, resources, soldiers, workers } from './world'

export const FOG_GRID_SIZE = 10

const CELL_SIZE = SCENE.size / FOG_GRID_SIZE
// Fog is a flat dark tile covering the ground of unexplored cells (entities standing on
// them are hidden separately). Tall fog volumes don't work with the overhead camera:
// they end up between the camera and the ground and black out the whole screen.
const FOG_TILE_THICKNESS = 0.12
const UNIT_VISION_RADIUS = 18
const BUILDING_VISION_RADIUS = 24
/** Vanguard Beacons are signal fires: they light up a huge patch of the map. */
export const BEACON_VISION_RADIUS = 42
const UPDATE_INTERVAL = 0.25
// Dark blue-gray "night side" tone: clearly unexplored, but tuned to the light
// regolith surface so the boundary doesn't look like a hole in the world.
const FOG_COLOR = Color4.create(0.055, 0.055, 0.085, 1)
// Explored shroud: you've scouted it and remember the terrain, but nobody is
// watching it right now - a translucent dusk instead of full daylight.
const SHROUD_COLOR = Color4.create(0.04, 0.04, 0.07, 0.45)

type VisionSource = { x: number; z: number; radius: number }
export type FogCellState = 'hidden' | 'explored' | 'visible'

const explored: boolean[] = new Array(FOG_GRID_SIZE * FOG_GRID_SIZE).fill(false)
const cellStates: FogCellState[] = new Array(FOG_GRID_SIZE * FOG_GRID_SIZE).fill('hidden')
const fogTiles: (Entity | null)[] = new Array(FOG_GRID_SIZE * FOG_GRID_SIZE).fill(null)
const lastFogVisible = new Map<string, boolean>()
let visionSources: VisionSource[] = []
let updateTimer = 0

export function initFogOfWar(): void {
  createMissingFogTiles()
  engine.addSystem(fogOfWarSystem)
}

export function resetFogOfWar(): void {
  explored.fill(false)
  visionSources = []
  updateTimer = 0
  // Recreate tiles instead of mutating materials: DCL often keeps the old
  // alpha-blend shroud when a tile is told to go opaque, which looks like
  // leftover vision from the previous match.
  for (let index = 0; index < fogTiles.length; index++) {
    const tile = fogTiles[index]
    if (tile) engine.removeEntity(tile)
    fogTiles[index] = null
    cellStates[index] = 'hidden'
  }
  lastFogVisible.clear()
  createMissingFogTiles()
}

/** True when the position is currently inside a player unit/building vision radius. */
export function isPositionVisibleToPlayer(position: { x: number; z: number }): boolean {
  for (const source of visionSources) {
    const dx = position.x - source.x
    const dz = position.z - source.z
    if (dx * dx + dz * dz <= source.radius * source.radius) return true
  }
  return false
}

/** True once the fog cell containing the position has been revealed. */
export function isPositionExplored(position: { x: number; z: number }): boolean {
  const column = Math.floor(position.x / CELL_SIZE)
  const row = Math.floor(position.z / CELL_SIZE)
  return isCellExplored(column, row)
}

/** Whether this object should accept hover/clicks. Hostiles in the fog do not. */
export function isSelectableRevealedToPlayer(selectable: Selectable): boolean {
  const position = Transform.getOrNull(selectable.entity)?.position
  if (!position) return false
  if (selectable.kind === 'resource') return isPositionExplored(position)
  if (!isHostileToPlayer(getTeam(selectable))) return true
  if (selectable.kind === 'worker' || selectable.kind === 'soldier') return isPositionVisibleToPlayer(position)
  return isPositionExplored(position)
}

export function isCellExplored(column: number, row: number): boolean {
  if (column < 0 || row < 0 || column >= FOG_GRID_SIZE || row >= FOG_GRID_SIZE) return true
  return explored[row * FOG_GRID_SIZE + column]
}

/** Current three-state fog status of a cell (for the minimap shroud). */
export function getFogCellState(column: number, row: number): FogCellState {
  if (column < 0 || row < 0 || column >= FOG_GRID_SIZE || row >= FOG_GRID_SIZE) return 'visible'
  return cellStates[row * FOG_GRID_SIZE + column]
}

function fogOfWarSystem(dt: number): void {
  // No match, no scouting: keep the grid sealed under menus and end screens.
  if (gameState.matchStatus !== 'active') return

  updateTimer += dt
  if (updateTimer < UPDATE_INTERVAL) return
  updateTimer = 0

  visionSources = collectPlayerVisionSources()
  revealExploredCells()
  updateEnemyVisibility()
}

function collectPlayerVisionSources(): VisionSource[] {
  const sources: VisionSource[] = []

  // Allied computers share vision with the player, like team games in classic RTS.
  for (const worker of workers) {
    if (!worker.alive || isHostileToPlayer(getTeam(worker))) continue
    const position = Transform.get(worker.entity).position
    sources.push({ x: position.x, z: position.z, radius: UNIT_VISION_RADIUS })
  }
  for (const soldier of soldiers) {
    if (!soldier.alive || isHostileToPlayer(getTeam(soldier))) continue
    const position = Transform.get(soldier.entity).position
    sources.push({ x: position.x, z: position.z, radius: UNIT_VISION_RADIUS })
  }
  for (const building of buildings) {
    if (!building.alive || isHostileToPlayer(getTeam(building))) continue
    const position = Transform.get(building.entity).position
    const isBeacon = building.kind === 'fireplace' && building.isComplete && getRace(getTeam(building)).id === 'human'
    sources.push({ x: position.x, z: position.z, radius: isBeacon ? BEACON_VISION_RADIUS : BUILDING_VISION_RADIUS })
  }

  return sources
}

function revealExploredCells(): void {
  for (let row = 0; row < FOG_GRID_SIZE; row++) {
    for (let column = 0; column < FOG_GRID_SIZE; column++) {
      const index = row * FOG_GRID_SIZE + column

      const centerX = column * CELL_SIZE + CELL_SIZE / 2
      const centerZ = row * CELL_SIZE + CELL_SIZE / 2
      const visibleNow = isPositionVisibleToPlayer({ x: centerX, z: centerZ })
      if (visibleNow) explored[index] = true

      const nextState: FogCellState = visibleNow ? 'visible' : explored[index] ? 'explored' : 'hidden'
      if (cellStates[index] === nextState) continue

      cellStates[index] = nextState
      applyCellVisual(index, nextState)
    }
  }
}

/** Swap the tile's look for its fog state: opaque night, translucent shroud, or gone. */
function applyCellVisual(index: number, state: FogCellState): void {
  const tile = fogTiles[index]
  if (!tile) return

  if (state === 'visible') {
    VisibilityComponent.createOrReplace(tile, { visible: false })
    return
  }

  VisibilityComponent.createOrReplace(tile, { visible: true })
  Material.deleteFrom(tile)
  Material.setPbrMaterial(tile, {
    albedoColor: state === 'hidden' ? FOG_COLOR : SHROUD_COLOR,
    transparencyMode: state === 'hidden' ? MaterialTransparencyMode.MTM_OPAQUE : MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
}

function updateEnemyVisibility(): void {
  // Only hostiles hide in the fog; the player's own and allied units stay visible.
  for (const worker of workers) {
    if (!worker.alive || !isHostileToPlayer(getTeam(worker))) continue
    setSelectableVisible(worker, isEntityVisibleToPlayer(worker.entity))
  }
  for (const soldier of soldiers) {
    if (!soldier.alive || !isHostileToPlayer(getTeam(soldier))) continue
    setSelectableVisible(soldier, isEntityVisibleToPlayer(soldier.entity))
  }
  for (const building of buildings) {
    if (!building.alive || !isHostileToPlayer(getTeam(building))) continue
    // Buildings stay discovered once their cell is explored, like classic RTS fog.
    const position = Transform.get(building.entity).position
    setSelectableVisible(building, isPositionExplored(position))
  }
  // Resources sit above the flat fog tiles, so hide them until their cell is scouted.
  for (const resource of resources) {
    if (!resource.alive) continue
    const position = Transform.get(resource.entity).position
    setSelectableVisible(resource, isPositionExplored(position))
  }
}

function isEntityVisibleToPlayer(entity: Entity): boolean {
  const position = Transform.get(entity).position
  return isPositionVisibleToPlayer(position)
}

function setEntityVisible(entity: Entity, visible: boolean): void {
  VisibilityComponent.createOrReplace(entity, { visible })
}

/** Visibility doesn't cascade to children, so hide the floating name label along with the model. */
function setSelectableVisible(selectable: Selectable, visible: boolean): void {
  if (lastFogVisible.get(selectable.id) === visible) return
  lastFogVisible.set(selectable.id, visible)

  if (isProceduralUnit(selectable.entity)) setUnitVisible(selectable.entity, visible)
  else if (isProceduralResource(selectable.entity)) setResourceModelVisible(selectable.entity, visible)
  else if (isProceduralBuilding(selectable.entity)) setBuildingModelVisible(selectable.entity, visible)
  else setEntityVisible(selectable.entity, visible)
  if (selectable.labelEntity) setEntityVisible(selectable.labelEntity, visible)
  const beacon = (selectable as { beaconEntity?: Entity }).beaconEntity
  if (beacon) setEntityVisible(beacon, visible)
  // Visibility hides the mesh, not the click box. A live collider still shows
  // hover text and eats clicks through the fog.
  setSelectablePointerEnabled(selectable, visible)
}

function setSelectablePointerEnabled(selectable: Selectable, enabled: boolean): void {
  const targets = selectable.colliderEntity ? [selectable.colliderEntity] : [selectable.entity]
  for (const entity of targets) {
    if (enabled) MeshCollider.setBox(entity)
    else MeshCollider.deleteFrom(entity)
  }
}

function createMissingFogTiles(): void {
  for (let row = 0; row < FOG_GRID_SIZE; row++) {
    for (let column = 0; column < FOG_GRID_SIZE; column++) {
      const index = row * FOG_GRID_SIZE + column
      if (fogTiles[index]) continue

      const tile = engine.addEntity()
      Transform.create(tile, {
        position: Vector3.create(column * CELL_SIZE + CELL_SIZE / 2, FOG_TILE_THICKNESS, row * CELL_SIZE + CELL_SIZE / 2),
        scale: Vector3.create(CELL_SIZE, FOG_TILE_THICKNESS, CELL_SIZE)
      })
      MeshRenderer.setBox(tile)
      VisibilityComponent.create(tile, { visible: true })
      Material.setPbrMaterial(tile, {
        albedoColor: FOG_COLOR,
        transparencyMode: MaterialTransparencyMode.MTM_OPAQUE,
        castShadows: false
      })
      fogTiles[index] = tile
    }
  }
}
