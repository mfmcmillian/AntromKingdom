import { MAP_ANCHORS, RESOURCE_FIELDS, ResourceField } from './config'
import { Vector3 } from '@dcl/sdk/math'

// Map registry: groundwork for multiple battlegrounds. Every map bundles its
// base anchors and resource layout; the match setup screen and the MP lobby
// both pick from this list (the lobby syncs the choice via LobbyConfig.mapId).

/** A walkable ground disc on island maps; everything outside every zone is void. */
export type IslandZone = { x: number; z: number; radius: number }

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
}

// ---------------------------------------------------------------------------
// Skybridge Islands: 6 floating player islands around the rim (hex ring), 6
// neutral expansion isles between them, and a rich contested island dead
// center. No land routes at all: expanding or attacking means transports.
// Layout math: player islands on a ring of radius 56 at 30/90/150/210/270/330
// degrees, expansion isles on a ring of 66 at 0/60/.../300 degrees.
// ---------------------------------------------------------------------------

const SKY_PLAYER_ISLANDS: IslandZone[] = [
  { x: 128.5, z: 108, radius: 18 },
  { x: 80, z: 136, radius: 18 },
  { x: 31.5, z: 108, radius: 18 },
  { x: 31.5, z: 52, radius: 18 },
  { x: 80, z: 24, radius: 18 },
  { x: 128.5, z: 52, radius: 18 }
]

const SKY_EXPANSION_ISLANDS: IslandZone[] = [
  { x: 146, z: 80, radius: 11 },
  { x: 113, z: 137, radius: 11 },
  { x: 47, z: 137, radius: 11 },
  { x: 14, z: 80, radius: 11 },
  { x: 47, z: 23, radius: 11 },
  { x: 113, z: 23, radius: 11 }
]

const SKY_CENTER_ISLAND: IslandZone = { x: 80, z: 80, radius: 14 }

export const SKYBRIDGE_ISLANDS: IslandZone[] = [...SKY_PLAYER_ISLANDS, ...SKY_EXPANSION_ISLANDS, SKY_CENTER_ISLAND]

/** Temple sits slightly outward of each island's center, facing the map middle. */
const SKYBRIDGE_ANCHORS: { temple: Vector3; rotationY: number }[] = [
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
const SKYBRIDGE_FIELDS: ResourceField[] = [
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

export const MAPS: MapDefinition[] = [
  {
    id: 'shattered-crown',
    name: 'Shattered Crown',
    tagline: '6 starts on the rim, each with its own natural. Rich gold crystal and cryo plasma at the contested center.',
    thumbnail: 'images/maps/shattered-crown.jpg',
    maxPlayers: 6,
    anchors: MAP_ANCHORS,
    fields: RESOURCE_FIELDS
  },
  {
    id: 'skybridge-islands',
    name: 'Skybridge Islands',
    tagline: 'Floating islands with no land routes. Ferry armies by transport, claim empty isles, and fight for the rich center.',
    thumbnail: 'images/maps/skybridge-islands.jpg',
    maxPlayers: 6,
    anchors: SKYBRIDGE_ANCHORS,
    fields: SKYBRIDGE_FIELDS,
    islands: SKYBRIDGE_ISLANDS
  }
]

export const DEFAULT_MAP_ID = MAPS[0].id

export function getMapById(id: string | undefined): MapDefinition {
  return MAPS.find((map) => map.id === id) ?? MAPS[0]
}

/** Cycles through the registry (wraps around; a single map returns itself). */
export function getNextMapId(id: string | undefined): string {
  const index = MAPS.findIndex((map) => map.id === id)
  return MAPS[(index + 1) % MAPS.length].id
}

// ---------------------------------------------------------------------------
// Active-map walkability. Set at match start; solid-ground maps clear it.
// Ground units, buildings and AI decisions all consult this so nothing ends
// up standing in the sky.
// ---------------------------------------------------------------------------

let activeIslands: IslandZone[] | undefined

/** Small tolerance so units hugging an island's rim don't jitter on the edge. */
const EDGE_MARGIN = 0.5

export function setActiveIslands(islands: IslandZone[] | undefined): void {
  activeIslands = islands
}

/** Is the current match played on an island map? */
export function isIslandMap(): boolean {
  return activeIslands !== undefined
}

/** Can a ground unit stand here? Solid-ground maps: always yes. */
export function isGroundWalkable(x: number, z: number): boolean {
  if (!activeIslands) return true
  for (const island of activeIslands) {
    const dx = x - island.x
    const dz = z - island.z
    const reach = island.radius + EDGE_MARGIN
    if (dx * dx + dz * dz <= reach * reach) return true
  }
  return false
}

/** Index of the island containing this point, or -1 (void / solid-ground map). */
export function islandIndexAt(x: number, z: number): number {
  if (!activeIslands) return -1
  for (let i = 0; i < activeIslands.length; i++) {
    const island = activeIslands[i]
    const dx = x - island.x
    const dz = z - island.z
    if (dx * dx + dz * dz <= island.radius * island.radius) return i
  }
  return -1
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
  return islandA !== -1 && islandA === islandIndexAt(b.x, b.z)
}
