import { PrimaryPointerInfo, Transform, UiCanvasInformation, engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { SCENE } from './config'
import { FOG_GRID_SIZE, isCellExplored, isPositionExplored, isPositionVisibleToPlayer } from './fogOfWar'
import { gameState } from './state'
import { getCameraFocus, isTopDownViewActive, setCameraFocus } from './topDownCamera'
import { buildings, getTeam, resources, soldiers, workers } from './world'

// Must match the virtual resolution passed to ReactEcsRenderer.setUiRenderer.
const VIRTUAL_WIDTH = 1920
const VIRTUAL_HEIGHT = 1080
// Screen-space rect of the panel (see uiTransform below): anchored top-right.
const PANEL_TOP = 22
const PANEL_RIGHT = 22

const MAP_SIZE = 236
const BORDER = 5
const FOG_CELL_SIZE = MAP_SIZE / FOG_GRID_SIZE

const MINIMAP_COLORS = {
  frame: Color4.create(0.03, 0.035, 0.05, 0.95),
  ground: Color4.create(0.13, 0.13, 0.17, 1),
  fog: Color4.create(0.02, 0.02, 0.035, 0.94),
  playerUnit: Color4.create(0.3, 0.75, 1, 1),
  playerBuilding: Color4.create(0.2, 0.9, 0.4, 1),
  enemy: Color4.create(0.95, 0.2, 0.2, 1),
  resource: Color4.create(0.85, 0.7, 0.3, 1),
  avatar: Color4.create(1, 1, 1, 1)
}

export function minimapPanel() {
  if (gameState.matchStatus !== 'active') return null

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: PANEL_TOP, right: PANEL_RIGHT },
        width: MAP_SIZE + BORDER * 2,
        height: MAP_SIZE + BORDER * 2,
        padding: BORDER
      }}
      uiBackground={{ color: MINIMAP_COLORS.frame }}
    >
      <UiEntity
        uiTransform={{ width: MAP_SIZE, height: MAP_SIZE }}
        uiBackground={{ color: MINIMAP_COLORS.ground }}
        onMouseDown={jumpCameraToClickedPoint}
      >
        {resourceDots()}
        {buildingDots()}
        {unitDots()}
        {viewDot()}
        {fogOverlay()}
      </UiEntity>
    </UiEntity>
  )
}

/** Maps the cursor's position inside the minimap to world coordinates and jumps the RTS camera there. */
function jumpCameraToClickedPoint(): void {
  if (!isTopDownViewActive()) return

  const info = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const coordinates = info?.screenCoordinates
  if (!coordinates || !canvas || canvas.width === 0 || canvas.height === 0) return

  // Physical pixels -> UI virtual coordinates (pointer Y is bottom-origin, UI top is top-origin).
  const virtualX = coordinates.x * (VIRTUAL_WIDTH / canvas.width)
  const virtualYFromTop = (canvas.height - coordinates.y) * (VIRTUAL_HEIGHT / canvas.height)

  const mapLeft = VIRTUAL_WIDTH - PANEL_RIGHT - BORDER - MAP_SIZE
  const mapTop = PANEL_TOP + BORDER

  const u = clamp((virtualX - mapLeft) / MAP_SIZE, 0, 1)
  const v = clamp((virtualYFromTop - mapTop) / MAP_SIZE, 0, 1)

  // Minimap top edge is the map's far side (high z).
  setCameraFocus(u * SCENE.size, (1 - v) * SCENE.size)
}

function resourceDots() {
  const dots = []
  for (const resource of resources) {
    if (!resource.alive) continue
    const position = Transform.get(resource.entity).position
    if (!isPositionExplored(position)) continue
    dots.push(dot(`res-${resource.id}`, position, 5, MINIMAP_COLORS.resource))
  }
  return dots
}

function buildingDots() {
  const dots = []
  for (const building of buildings) {
    if (!building.alive) continue
    const position = Transform.get(building.entity).position
    const isEnemy = getTeam(building) === 'enemy'
    if (isEnemy && !isPositionExplored(position)) continue
    dots.push(dot(`bld-${building.id}`, position, 11, isEnemy ? MINIMAP_COLORS.enemy : MINIMAP_COLORS.playerBuilding))
  }
  return dots
}

function unitDots() {
  const dots = []
  for (const worker of workers) {
    if (!worker.alive) continue
    const position = Transform.get(worker.entity).position
    const isEnemy = getTeam(worker) === 'enemy'
    if (isEnemy && !isPositionVisibleToPlayer(position)) continue
    dots.push(dot(`wrk-${worker.id}`, position, 6, isEnemy ? MINIMAP_COLORS.enemy : MINIMAP_COLORS.playerUnit))
  }
  for (const soldier of soldiers) {
    if (!soldier.alive) continue
    const position = Transform.get(soldier.entity).position
    const isEnemy = getTeam(soldier) === 'enemy'
    if (isEnemy && !isPositionVisibleToPlayer(position)) continue
    dots.push(dot(`sld-${soldier.id}`, position, 7, isEnemy ? MINIMAP_COLORS.enemy : MINIMAP_COLORS.playerUnit))
  }
  return dots
}

/** White marker showing where the view is: camera focus in overhead mode, the avatar otherwise. */
function viewDot() {
  if (isTopDownViewActive()) {
    const focus = getCameraFocus()
    return dot('view', focus, 8, MINIMAP_COLORS.avatar)
  }

  const playerTransform = Transform.getOrNull(engine.PlayerEntity)
  if (!playerTransform) return null
  return dot('view', playerTransform.position, 8, MINIMAP_COLORS.avatar)
}

function fogOverlay() {
  const cells = []
  for (let row = 0; row < FOG_GRID_SIZE; row++) {
    for (let column = 0; column < FOG_GRID_SIZE; column++) {
      if (isCellExplored(column, row)) continue
      cells.push(
        <UiEntity
          key={`fog-${column}-${row}`}
          uiTransform={{
            positionType: 'absolute',
            position: {
              left: column * FOG_CELL_SIZE,
              top: MAP_SIZE - (row + 1) * FOG_CELL_SIZE
            },
            width: FOG_CELL_SIZE + 0.5,
            height: FOG_CELL_SIZE + 0.5
          }}
          uiBackground={{ color: MINIMAP_COLORS.fog }}
        />
      )
    }
  }
  return cells
}

function dot(key: string, worldPosition: { x: number; z: number }, size: number, color: Color4) {
  const left = clamp((worldPosition.x / SCENE.size) * MAP_SIZE - size / 2, 0, MAP_SIZE - size)
  const top = clamp(MAP_SIZE - (worldPosition.z / SCENE.size) * MAP_SIZE - size / 2, 0, MAP_SIZE - size)

  return (
    <UiEntity
      key={key}
      uiTransform={{
        positionType: 'absolute',
        position: { left, top },
        width: size,
        height: size
      }}
      uiBackground={{ color }}
    />
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
