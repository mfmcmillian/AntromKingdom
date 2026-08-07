import { PrimaryPointerInfo, Transform, UiCanvasInformation, engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { SCENE } from './config'
import { FOG_GRID_SIZE, getFogCellState, isPositionExplored, isPositionVisibleToPlayer } from './fogOfWar'
import { getMapById } from './maps'
import { gameState, isHostileToPlayer } from './state'
import type { EnemyTeam, Team } from './types'
import { BASIN_PATCHES, CRATERS } from './terrain'
import { getCameraFocus, isTopDownViewActive, setCameraFocus } from './topDownCamera'
import { buildings, getTeam, resources, soldiers, workers } from './world'

// Must match the virtual resolution passed to ReactEcsRenderer.setUiRenderer.
const VIRTUAL_WIDTH = 1920
const VIRTUAL_HEIGHT = 1080
// Screen-space rect of the panel (see uiTransform below): anchored bottom-right,
// inside the console - Decentraland's chat window owns the bottom-left corner.
const PANEL_BOTTOM = 12
const PANEL_RIGHT = 12

const MAP_SIZE = 236
const BORDER = 5
const FOG_CELL_SIZE = MAP_SIZE / FOG_GRID_SIZE

const MINIMAP_COLORS = {
  border: Color4.create(0.3, 0.55, 0.85, 1),
  frame: Color4.create(0.03, 0.035, 0.05, 0.95),
  // Muted echo of the regolith surface so the minimap reads as the same world.
  ground: Color4.create(0.3, 0.3, 0.33, 1),
  groundDark: Color4.create(0.24, 0.24, 0.28, 1),
  borderRock: Color4.create(0.38, 0.38, 0.42, 1),
  fog: Color4.create(0.045, 0.045, 0.07, 0.96),
  // Explored but nobody watching: a lighter dusk than full fog.
  shroud: Color4.create(0.045, 0.045, 0.07, 0.45),
  playerUnit: Color4.create(0.3, 0.75, 1, 1),
  playerBuilding: Color4.create(0.2, 0.9, 0.4, 1),
  // One hostile hue per computer slot, matching the in-world team glow.
  enemy: {
    enemy1: Color4.create(0.95, 0.2, 0.2, 1),
    enemy2: Color4.create(1, 0.6, 0.12, 1),
    enemy3: Color4.create(0.82, 0.3, 0.95, 1),
    enemy4: Color4.create(0.35, 0.9, 0.25, 1),
    enemy5: Color4.create(1, 0.35, 0.7, 1)
  } as Record<EnemyTeam, Color4>,
  ally: Color4.create(0.95, 0.85, 0.3, 1),
  minerals: Color4.create(0.45, 0.7, 1, 1),
  gas: Color4.create(0.35, 0.9, 0.45, 1),
  // Rich center nodes: gold crystal and icy cryo plasma.
  goldMinerals: Color4.create(1, 0.8, 0.25, 1),
  cryoGas: Color4.create(0.55, 0.88, 1, 1),
  avatar: Color4.create(1, 1, 1, 1),
  // Island maps: bright void between floating rock islands.
  sky: Color4.create(0.16, 0.32, 0.55, 1),
  island: Color4.create(0.32, 0.32, 0.36, 1)
}

/** World meters -> minimap pixels. */
const MAP_SCALE = MAP_SIZE / SCENE.size

// ---------------------------------------------------------------------------
// Attack pings: a red flash on the minimap wherever friendly units or
// buildings are taking damage, so off-screen fights are impossible to miss.
// ---------------------------------------------------------------------------

const PING_DURATION = 3
/** New damage near an existing ping refreshes it instead of stacking flashes. */
const PING_MERGE_RADIUS = 14
const PING_COLOR = Color4.create(1, 0.15, 0.1, 0.85)

type AttackPing = { x: number; z: number; age: number }
const attackPings: AttackPing[] = []

export function addAttackPing(x: number, z: number): void {
  for (const ping of attackPings) {
    const dx = ping.x - x
    const dz = ping.z - z
    if (dx * dx + dz * dz < PING_MERGE_RADIUS * PING_MERGE_RADIUS) {
      ping.age = 0
      return
    }
  }
  attackPings.push({ x, z, age: 0 })
}

export function updateAttackPings(dt: number): void {
  for (let i = attackPings.length - 1; i >= 0; i--) {
    attackPings[i].age += dt
    if (attackPings[i].age >= PING_DURATION) attackPings.splice(i, 1)
  }
}

export function clearAttackPings(): void {
  attackPings.length = 0
}

function pingMarkers() {
  const markers = []
  for (let i = 0; i < attackPings.length; i++) {
    const ping = attackPings[i]
    // 4 Hz blink, shrinking slightly as it ages out.
    if (Math.floor(ping.age * 8) % 2 === 1) continue
    const size = 18 - (ping.age / PING_DURATION) * 8
    const left = clamp((ping.x / SCENE.size) * MAP_SIZE - size / 2, 0, MAP_SIZE - size)
    const top = clamp(MAP_SIZE - (ping.z / SCENE.size) * MAP_SIZE - size / 2, 0, MAP_SIZE - size)
    markers.push(
      <UiEntity
        key={`ping-${i}`}
        uiTransform={{ positionType: 'absolute', position: { left, top }, width: size, height: size, padding: 3 }}
        uiBackground={{ color: PING_COLOR }}
      >
        <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ color: MINIMAP_COLORS.frame }} />
      </UiEntity>
    )
  }
  return markers
}

export function minimapPanel() {
  if (gameState.matchStatus !== 'active') return null

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: PANEL_BOTTOM, right: PANEL_RIGHT },
        width: MAP_SIZE + BORDER * 2,
        height: MAP_SIZE + BORDER * 2,
        padding: 2
      }}
      uiBackground={{ color: MINIMAP_COLORS.border }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: '100%', padding: BORDER - 2 }}
        uiBackground={{ color: MINIMAP_COLORS.frame }}
      >
      <UiEntity
        uiTransform={{ width: MAP_SIZE, height: MAP_SIZE }}
        uiBackground={{ color: MINIMAP_COLORS.ground }}
        onMouseDown={jumpCameraToClickedPoint}
      >
        {terrainLayer()}
        {resourceDots()}
        {buildingDots()}
        {unitDots()}
        {viewDot()}
        {fogOverlay()}
        {pingMarkers()}
      </UiEntity>
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
  const mapTop = VIRTUAL_HEIGHT - PANEL_BOTTOM - BORDER - MAP_SIZE

  const u = clamp((virtualX - mapLeft) / MAP_SIZE, 0, 1)
  const v = clamp((virtualYFromTop - mapTop) / MAP_SIZE, 0, 1)

  // Minimap top edge is the map's far side (high z).
  setCameraFocus(u * SCENE.size, (1 - v) * SCENE.size)
}

/**
 * Static terrain features under the dots: rocky border ring, the darker center
 * basin, and the landmark craters, so the minimap matches the actual map.
 */
function terrainLayer() {
  // Island maps swap the whole layer: sky background with one blob per island.
  const islands = getMapById(gameState.selectedMapId).islands
  if (islands) {
    const elements = [
      <UiEntity key="sky" uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: MAP_SIZE, height: MAP_SIZE }} uiBackground={{ color: MINIMAP_COLORS.sky }} />
    ]
    for (let i = 0; i < islands.length; i++) {
      const island = islands[i]
      const diameter = island.radius * 2 * MAP_SCALE
      // Three overlapping rects fake a rounded island (UI has no circles).
      elements.push(terrainRectSized(`isle-${i}-a`, island.x, island.z, diameter * 0.94, diameter * 0.62, MINIMAP_COLORS.island))
      elements.push(terrainRectSized(`isle-${i}-b`, island.x, island.z, diameter * 0.62, diameter * 0.94, MINIMAP_COLORS.island))
      elements.push(terrainRectSized(`isle-${i}-c`, island.x, island.z, diameter * 0.8, diameter * 0.8, MINIMAP_COLORS.island))
    }
    return elements
  }

  const RIM = 6
  const elements = [
    // Border highland ring.
    <UiEntity key="rim-n" uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: MAP_SIZE, height: RIM }} uiBackground={{ color: MINIMAP_COLORS.borderRock }} />,
    <UiEntity key="rim-s" uiTransform={{ positionType: 'absolute', position: { left: 0, top: MAP_SIZE - RIM }, width: MAP_SIZE, height: RIM }} uiBackground={{ color: MINIMAP_COLORS.borderRock }} />,
    <UiEntity key="rim-w" uiTransform={{ positionType: 'absolute', position: { left: 0, top: RIM }, width: RIM, height: MAP_SIZE - RIM * 2 }} uiBackground={{ color: MINIMAP_COLORS.borderRock }} />,
    <UiEntity key="rim-e" uiTransform={{ positionType: 'absolute', position: { left: MAP_SIZE - RIM, top: RIM }, width: RIM, height: MAP_SIZE - RIM * 2 }} uiBackground={{ color: MINIMAP_COLORS.borderRock }} />
  ]

  for (let i = 0; i < BASIN_PATCHES.length; i++) {
    elements.push(terrainRect(`basin-${i}`, BASIN_PATCHES[i].x, BASIN_PATCHES[i].z, BASIN_PATCHES[i].size, MINIMAP_COLORS.groundDark))
  }
  for (let i = 0; i < CRATERS.length; i++) {
    elements.push(terrainRect(`crater-${i}`, CRATERS[i].x, CRATERS[i].z, CRATERS[i].radius * 2, MINIMAP_COLORS.groundDark))
  }
  return elements
}

function terrainRect(key: string, worldX: number, worldZ: number, worldSize: number, color: Color4) {
  const size = worldSize * MAP_SCALE
  return terrainRectSized(key, worldX, worldZ, size, size, color)
}

/** Rect centered on a world point, already sized in minimap pixels. */
function terrainRectSized(key: string, worldX: number, worldZ: number, width: number, height: number, color: Color4) {
  return (
    <UiEntity
      key={key}
      uiTransform={{
        positionType: 'absolute',
        position: { left: worldX * MAP_SCALE - width / 2, top: MAP_SIZE - worldZ * MAP_SCALE - height / 2 },
        width,
        height
      }}
      uiBackground={{ color }}
    />
  )
}

function resourceDots() {
  const dots = []
  for (const resource of resources) {
    if (!resource.alive) continue
    const position = Transform.get(resource.entity).position
    if (!isPositionExplored(position)) continue
    const isGas = resource.resource === 'gas'
    const color = resource.rich ? (isGas ? MINIMAP_COLORS.cryoGas : MINIMAP_COLORS.goldMinerals) : isGas ? MINIMAP_COLORS.gas : MINIMAP_COLORS.minerals
    dots.push(dot(`res-${resource.id}`, position, isGas ? 6 : 5, color))
  }
  return dots
}

/** Player is cyan/green, allies gold, hostiles their slot color. */
function dotColor(team: Team, isBuilding: boolean): Color4 {
  if (team === 'player') return isBuilding ? MINIMAP_COLORS.playerBuilding : MINIMAP_COLORS.playerUnit
  if (!isHostileToPlayer(team)) return MINIMAP_COLORS.ally
  return MINIMAP_COLORS.enemy[team]
}

function buildingDots() {
  const dots = []
  for (const building of buildings) {
    if (!building.alive) continue
    const position = Transform.get(building.entity).position
    const team = getTeam(building)
    if (isHostileToPlayer(team) && !isPositionExplored(position)) continue
    dots.push(dot(`bld-${building.id}`, position, 11, dotColor(team, true)))
  }
  return dots
}

function unitDots() {
  const dots = []
  for (const worker of workers) {
    // Riders inside a transport are parked off-map: no dot until they unload.
    if (!worker.alive || worker.inTransportId) continue
    const position = Transform.get(worker.entity).position
    const team = getTeam(worker)
    if (isHostileToPlayer(team) && !isPositionVisibleToPlayer(position)) continue
    dots.push(dot(`wrk-${worker.id}`, position, 6, dotColor(team, false)))
  }
  for (const soldier of soldiers) {
    if (!soldier.alive || soldier.inTransportId) continue
    const position = Transform.get(soldier.entity).position
    const team = getTeam(soldier)
    if (isHostileToPlayer(team) && !isPositionVisibleToPlayer(position)) continue
    dots.push(dot(`sld-${soldier.id}`, position, 7, dotColor(team, false)))
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
      const state = getFogCellState(column, row)
      if (state === 'visible') continue
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
          uiBackground={{ color: state === 'hidden' ? MINIMAP_COLORS.fog : MINIMAP_COLORS.shroud }}
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
