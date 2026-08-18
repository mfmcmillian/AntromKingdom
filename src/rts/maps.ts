import { MAP_ANCHORS, RESOURCE_FIELDS, ResourceField } from './config'
import { Vector3 } from '@dcl/sdk/math'

// Map registry: groundwork for multiple battlegrounds. Every map bundles its
// base anchors and resource layout; the match setup screen and the MP lobby
// both pick from this list (the lobby syncs the choice via LobbyConfig.mapId).

/**
 * A walkable patch of ground on island maps. Squares use halfSize on both
 * axes; rectangles set halfX / halfZ (each falls back to halfSize).
 * Everything outside every zone is water.
 */
export type IslandZone = { x: number; z: number; halfSize: number; halfX?: number; halfZ?: number }

export function islandHalfX(island: IslandZone): number {
  return island.halfX ?? island.halfSize
}

export function islandHalfZ(island: IslandZone): number {
  return island.halfZ ?? island.halfSize
}

export type MapThemeId = 'moon' | 'ocean' | 'ashen' | 'reliquary' | 'bloom' | 'inferno' | 'storm' | 'rift'

export type MapVisuals = {
  theme: MapThemeId
  ground: string
  water?: string
}

export type MapDefinition = {
  id: string
  name: string
  tagline: string
  /** Top-down layout diagram shown in the map selector. */
  thumbnail: string
  maxPlayers: number
  anchors: { temple: Vector3; rotationY: number }[]
  fields: ResourceField[]
  /**
   * Island maps: ground units can only exist inside these zones. No bridges -
   * crossing the void takes a transport (or wings). Omitted = solid ground.
   */
  islands?: IslandZone[]
  /** Ground, water and horizon pack. Omitted maps use the classic moon look. */
  visuals?: MapVisuals
  /** Hidden from the skirmish / lobby cycle. Campaign can still pick it. */
  campaignOnly?: boolean
}

// ---------------------------------------------------------------------------
// Islands: 6 player islands around the rim (hex ring), 6 neutral expansion
// isles between them, and a rich contested island dead center - all in open
// ocean. No land routes at all: expanding or attacking means transports.
// Layout math: player islands on a ring of radius 56 at 30/90/150/210/270/330
// degrees, expansion isles on a ring of 66 at 0/60/.../300 degrees.
// Islands are SQUARES (flat edges = predictable building placement). Sizes are
// capped so no two squares ever touch: adjacent player/expansion centers sit
// 28-29m apart on one axis, so 16 + 9 leaves a guaranteed 3m+ water strait.
// ---------------------------------------------------------------------------

const SKY_PLAYER_ISLANDS: IslandZone[] = [
  { x: 128.5, z: 108, halfSize: 16 },
  { x: 80, z: 136, halfSize: 16 },
  { x: 31.5, z: 108, halfSize: 16 },
  { x: 31.5, z: 52, halfSize: 16 },
  { x: 80, z: 24, halfSize: 16 },
  { x: 128.5, z: 52, halfSize: 16 }
]

const SKY_EXPANSION_ISLANDS: IslandZone[] = [
  { x: 146, z: 80, halfSize: 9 },
  { x: 113, z: 137, halfSize: 9 },
  { x: 47, z: 137, halfSize: 9 },
  { x: 14, z: 80, halfSize: 9 },
  { x: 47, z: 23, halfSize: 9 },
  { x: 113, z: 23, halfSize: 9 }
]

const SKY_CENTER_ISLAND: IslandZone = { x: 80, z: 80, halfSize: 14 }

export const ISLANDS_ZONES: IslandZone[] = [...SKY_PLAYER_ISLANDS, ...SKY_EXPANSION_ISLANDS, SKY_CENTER_ISLAND]

/** Temple sits slightly outward of each island's center, facing the map middle. */
const ISLANDS_ANCHORS: { temple: Vector3; rotationY: number }[] = [
  { temple: Vector3.create(132, 5, 110), rotationY: -120 },
  { temple: Vector3.create(80, 5, 140), rotationY: 180 },
  { temple: Vector3.create(28, 5, 110), rotationY: 120 },
  { temple: Vector3.create(28, 5, 50), rotationY: 60 },
  { temple: Vector3.create(80, 5, 20), rotationY: 0 },
  { temple: Vector3.create(132, 5, 50), rotationY: -60 }
]

// Field order matters: the 18 main-island entries come first (minerals + two
// vents per start, all fixed), mirroring the classic map's "mains never move"
// rule. Island maps skip position jitter entirely so nodes stay on land.
const ISLANDS_FIELDS: ResourceField[] = [
  // --- Player island mains (minerals behind the temple, vents on the flanks) ---
  // Island 0 (E-NE, 30 deg).
  { kind: 'minerals', center: Vector3.create(139, 0, 114), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(124, 0, 117), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(134, 0, 99), count: 1, radius: 0 },
  // Island 1 (N).
  { kind: 'minerals', center: Vector3.create(80, 0, 148), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(70, 0, 136), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(90, 0, 136), count: 1, radius: 0 },
  // Island 2 (W-NW, 150 deg).
  { kind: 'minerals', center: Vector3.create(21, 0, 114), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(27, 0, 99), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(37, 0, 117), count: 1, radius: 0 },
  // Island 3 (W-SW, 210 deg).
  { kind: 'minerals', center: Vector3.create(21, 0, 46), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(37, 0, 43), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(27, 0, 61), count: 1, radius: 0 },
  // Island 4 (S).
  { kind: 'minerals', center: Vector3.create(80, 0, 12), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(90, 0, 24), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(70, 0, 24), count: 1, radius: 0 },
  // Island 5 (E-SE, 330 deg).
  { kind: 'minerals', center: Vector3.create(139, 0, 46), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(134, 0, 61), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(124, 0, 43), count: 1, radius: 0 },

  // --- Contested center island: RICH gold crystal + cryo plasma ---
  { kind: 'minerals', center: Vector3.create(76, 0, 76), count: 6, radius: 4, rich: true },
  { kind: 'gas', center: Vector3.create(88, 0, 72), count: 1, radius: 0, rich: true },
  { kind: 'gas', center: Vector3.create(72, 0, 88), count: 1, radius: 0, rich: true },

  // --- Neutral expansion isles (crystal cluster + one vent each) ---
  { kind: 'minerals', center: Vector3.create(149, 0, 77), count: 5, radius: 3.2 },
  { kind: 'gas', center: Vector3.create(141, 0, 85), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(116, 0, 140), count: 5, radius: 3.2 },
  { kind: 'gas', center: Vector3.create(108, 0, 131), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(44, 0, 140), count: 5, radius: 3.2 },
  { kind: 'gas', center: Vector3.create(52, 0, 131), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(11, 0, 77), count: 5, radius: 3.2 },
  { kind: 'gas', center: Vector3.create(19, 0, 85), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(44, 0, 20), count: 5, radius: 3.2 },
  { kind: 'gas', center: Vector3.create(52, 0, 29), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(116, 0, 20), count: 5, radius: 3.2 },
  { kind: 'gas', center: Vector3.create(108, 0, 29), count: 1, radius: 0 }
]

// ---------------------------------------------------------------------------
// Ashen Procession (2v2 / 4-player FFA): two land halves joined by a north-
// south road. Water sits on the east and west flanks of the road. Four corner
// starts, each with a natural toward the causeway, and a rich mid on the road.
// ---------------------------------------------------------------------------

const PROCESSION_ZONES: IslandZone[] = [
  { x: 80, z: 26, halfSize: 26, halfX: 80, halfZ: 26 },
  { x: 80, z: 134, halfSize: 26, halfX: 80, halfZ: 26 },
  { x: 80, z: 80, halfSize: 18, halfX: 18, halfZ: 28 }
]

const PROCESSION_ANCHORS: { temple: Vector3; rotationY: number }[] = [
  { temple: Vector3.create(20, 5, 18), rotationY: 45 },
  { temple: Vector3.create(140, 5, 142), rotationY: -135 },
  { temple: Vector3.create(20, 5, 142), rotationY: 135 },
  { temple: Vector3.create(140, 5, 18), rotationY: -45 }
]

const PROCESSION_FIELDS: ResourceField[] = [
  // SW main.
  { kind: 'minerals', center: Vector3.create(10, 0, 10), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(8, 0, 28), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(32, 0, 8), count: 1, radius: 0 },
  // NE main.
  { kind: 'minerals', center: Vector3.create(150, 0, 150), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(152, 0, 132), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(128, 0, 152), count: 1, radius: 0 },
  // NW main.
  { kind: 'minerals', center: Vector3.create(10, 0, 150), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(8, 0, 132), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(32, 0, 152), count: 1, radius: 0 },
  // SE main.
  { kind: 'minerals', center: Vector3.create(150, 0, 10), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(152, 0, 28), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(128, 0, 8), count: 1, radius: 0 },
  // Naturals toward the road.
  { kind: 'minerals', center: Vector3.create(48, 0, 38), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(58, 0, 44), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(112, 0, 122), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(102, 0, 116), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(48, 0, 122), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(58, 0, 116), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(112, 0, 38), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(102, 0, 44), count: 1, radius: 0 },
  // Rich mid on the causeway.
  { kind: 'minerals', center: Vector3.create(80, 0, 80), count: 6, radius: 4, rich: true },
  { kind: 'gas', center: Vector3.create(80, 0, 68), count: 1, radius: 0, rich: true },
  { kind: 'gas', center: Vector3.create(80, 0, 92), count: 1, radius: 0, rich: true },
  // Shared thirds: middle of each land half, between the two corner mains.
  { kind: 'minerals', center: Vector3.create(80, 0, 16), count: 5, radius: 3.2 },
  { kind: 'gas', center: Vector3.create(90, 0, 22), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(80, 0, 144), count: 5, radius: 3.2 },
  { kind: 'gas', center: Vector3.create(70, 0, 138), count: 1, radius: 0 },
  // Road pockets north and south of the rich mid.
  { kind: 'minerals', center: Vector3.create(80, 0, 56), count: 5, radius: 3.2 },
  { kind: 'gas', center: Vector3.create(88, 0, 56), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(80, 0, 104), count: 5, radius: 3.2 },
  { kind: 'gas', center: Vector3.create(72, 0, 104), count: 1, radius: 0 }
]

// ---------------------------------------------------------------------------
// Twin Reliquaries (1v1): solid land, opposite-corner starts, each with a
// natural toward mid and a rich cluster at the center. Flanking around the
// empty NW / SE corners is intended.
// ---------------------------------------------------------------------------

const RELIQUARIES_ANCHORS: { temple: Vector3; rotationY: number }[] = [
  { temple: Vector3.create(18, 5, 16), rotationY: 45 },
  { temple: Vector3.create(142, 5, 144), rotationY: -135 }
]

const RELIQUARIES_FIELDS: ResourceField[] = [
  { kind: 'minerals', center: Vector3.create(16, 0, 10), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(8, 0, 24), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(30, 0, 6), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(144, 0, 150), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(152, 0, 136), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(130, 0, 154), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(46, 0, 46), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(56, 0, 54), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(114, 0, 114), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(104, 0, 106), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(80, 0, 80), count: 6, radius: 4, rich: true },
  { kind: 'gas', center: Vector3.create(70, 0, 88), count: 1, radius: 0, rich: true },
  { kind: 'gas', center: Vector3.create(90, 0, 72), count: 1, radius: 0, rich: true },
  // Contested flanks in the empty NW / SE corners.
  { kind: 'minerals', center: Vector3.create(22, 0, 138), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(32, 0, 148), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(138, 0, 22), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(128, 0, 12), count: 1, radius: 0 },
  // Mid-edge contests, same idea as Crown's west / east expos.
  { kind: 'minerals', center: Vector3.create(16, 0, 80), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(24, 0, 90), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(144, 0, 80), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(136, 0, 70), count: 1, radius: 0 }
]

export const MAPS: MapDefinition[] = [
  {
    id: 'shattered-crown',
    name: 'Shattered Crown',
    tagline: '6 starts on the rim, each with its own natural. Rich gold crystal and cryo plasma at the contested center.',
    thumbnail: 'images/maps/shattered-crown.jpg',
    maxPlayers: 6,
    anchors: MAP_ANCHORS,
    fields: RESOURCE_FIELDS,
    visuals: { theme: 'moon', ground: 'assets/textures/moon_ground.png' }
  },
  {
    id: 'islands',
    name: 'Islands',
    tagline: 'Islands in an open ocean with no land routes. Ferry armies by transport, claim empty isles, and fight for the rich center.',
    thumbnail: 'images/maps/islands.jpg',
    maxPlayers: 6,
    anchors: ISLANDS_ANCHORS,
    fields: ISLANDS_FIELDS,
    islands: ISLANDS_ZONES,
    visuals: { theme: 'ocean', ground: 'assets/textures/grass_ground.png', water: 'assets/textures/water_surface.png' }
  },
  {
    id: 'ashen-procession',
    name: 'Ashen Procession',
    tagline: 'Four corner starts on two land halves, joined by one road. Shared thirds, road pockets, and a rich mid.',
    thumbnail: 'images/maps/ashen-procession.jpg',
    maxPlayers: 4,
    anchors: PROCESSION_ANCHORS,
    fields: PROCESSION_FIELDS,
    islands: PROCESSION_ZONES,
    visuals: { theme: 'ashen', ground: 'assets/textures/ashen_ground.png', water: 'assets/textures/ashen_water.png' }
  },
  {
    id: 'twin-reliquaries',
    name: 'Twin Reliquaries',
    tagline: '1v1 on solid ground. Opposite-corner starts, naturals, flank contests, and a rich cluster at mid.',
    thumbnail: 'images/maps/twin-reliquaries.jpg',
    maxPlayers: 2,
    anchors: RELIQUARIES_ANCHORS,
    fields: RELIQUARIES_FIELDS,
    visuals: { theme: 'reliquary', ground: 'assets/textures/reliquary_ground.png' }
  },
  {
    id: 'bloom-wastes',
    name: 'Bloom Wastes',
    tagline: 'The same rim as the Crown, now living soil. Myriad home ground — six starts, a rich center, and amber veins underfoot.',
    thumbnail: 'images/maps/bloom-wastes.jpg',
    maxPlayers: 6,
    anchors: MAP_ANCHORS,
    fields: RESOURCE_FIELDS,
    visuals: { theme: 'bloom', ground: 'assets/textures/bloom_ground.png' },
    campaignOnly: true
  },
  {
    id: 'blackstone-isles',
    name: 'Blackstone Isles',
    tagline: 'Myriad finale. Blackstone pads over a lava sea. No land routes — ferry or fly.',
    thumbnail: 'images/maps/blackstone-isles.jpg',
    maxPlayers: 6,
    anchors: ISLANDS_ANCHORS,
    fields: ISLANDS_FIELDS,
    islands: ISLANDS_ZONES,
    visuals: { theme: 'inferno', ground: 'assets/textures/blackstone_ground.png', water: 'assets/textures/lava_water.png' },
    campaignOnly: true
  },
  {
    id: 'colony-isles',
    name: 'Colony Isles',
    tagline: 'Vanguard finale. Steel colony pads in a storm sea. Same island layout — ferry or fly.',
    thumbnail: 'images/maps/colony-isles.jpg',
    maxPlayers: 6,
    anchors: ISLANDS_ANCHORS,
    fields: ISLANDS_FIELDS,
    islands: ISLANDS_ZONES,
    visuals: { theme: 'storm', ground: 'assets/textures/colony_ground.png', water: 'assets/textures/storm_water.png' },
    campaignOnly: true
  },
  {
    id: 'rift-isles',
    name: 'Rift Isles',
    tagline: 'Aethyr finale. Gold-crystal pads over a violet rift sea. Same island layout — ferry or fly.',
    thumbnail: 'images/maps/rift-isles.jpg',
    maxPlayers: 6,
    anchors: ISLANDS_ANCHORS,
    fields: ISLANDS_FIELDS,
    islands: ISLANDS_ZONES,
    visuals: { theme: 'rift', ground: 'assets/textures/rift_ground.png', water: 'assets/textures/rift_water.png' },
    campaignOnly: true
  }
]

export const DEFAULT_MAP_ID = MAPS[0].id

export function getLobbyMaps(): MapDefinition[] {
  return MAPS.filter((map) => !map.campaignOnly)
}

export function getMapById(id: string | undefined): MapDefinition {
  return MAPS.find((map) => map.id === id) ?? MAPS[0]
}

/** Cycles the skirmish / lobby maps (skips campaign-only skins). */
export function getNextMapId(id: string | undefined): string {
  const lobby = getLobbyMaps()
  const index = lobby.findIndex((map) => map.id === id)
  return lobby[(index + 1) % lobby.length].id
}

// ---------------------------------------------------------------------------
// Active-map walkability. Set at match start; solid-ground maps clear it.
// Ground units, buildings and AI decisions all consult this so nothing ends
// up standing in the sky.
// ---------------------------------------------------------------------------

let activeIslands: IslandZone[] | undefined
/** Connected-component id per zone. Touching rectangles share a landmass. */
let landmassOf: number[] = []

/** Small tolerance so units hugging an island's rim don't jitter on the edge. */
const EDGE_MARGIN = 0.5

function pointInIsland(island: IslandZone, x: number, z: number, margin = 0): boolean {
  return Math.abs(x - island.x) <= islandHalfX(island) + margin && Math.abs(z - island.z) <= islandHalfZ(island) + margin
}

function zonesTouch(a: IslandZone, b: IslandZone, slack = 1): boolean {
  return Math.abs(a.x - b.x) <= islandHalfX(a) + islandHalfX(b) + slack && Math.abs(a.z - b.z) <= islandHalfZ(a) + islandHalfZ(b) + slack
}

function rebuildLandmasses(islands: IslandZone[]): void {
  const parent = islands.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]]
      index = parent[index]
    }
    return index
  }
  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      if (zonesTouch(islands[i], islands[j])) parent[find(i)] = find(j)
    }
  }
  landmassOf = parent.map((_, index) => find(index))
}

export function setActiveIslands(islands: IslandZone[] | undefined): void {
  activeIslands = islands
  landmassOf = []
  if (islands) rebuildLandmasses(islands)
}

/** Is the current match played on an island map? */
export function isIslandMap(): boolean {
  return activeIslands !== undefined
}

/** Can a ground unit stand here? Solid-ground maps: always yes. Island maps: box test per zone. */
export function isGroundWalkable(x: number, z: number): boolean {
  if (!activeIslands) return true
  return activeIslands.some((island) => pointInIsland(island, x, z, EDGE_MARGIN))
}

/** Index of the island containing this point, or -1 (void / solid-ground map). */
export function islandIndexAt(x: number, z: number): number {
  if (!activeIslands) return -1
  return activeIslands.findIndex((island) => pointInIsland(island, x, z))
}

/** The island zone under this point, if any. */
export function getIslandZoneAt(x: number, z: number): IslandZone | undefined {
  if (!activeIslands) return undefined
  const index = islandIndexAt(x, z)
  return index >= 0 ? activeIslands[index] : undefined
}

/** Are two points on the same patch of land? (Solid maps: always true.) */
export function isSameIsland(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  if (!activeIslands) return true
  const islandA = islandIndexAt(a.x, a.z)
  const islandB = islandIndexAt(b.x, b.z)
  return islandA !== -1 && islandB !== -1 && landmassOf[islandA] === landmassOf[islandB]
}
