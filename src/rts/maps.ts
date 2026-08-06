import { MAP_ANCHORS, RESOURCE_FIELDS, ResourceField } from './config'
import type { Vector3 } from '@dcl/sdk/math'

// Map registry: groundwork for multiple battlegrounds. Every map bundles its
// base anchors and resource layout; the match setup screen and the MP lobby
// both pick from this list (the lobby syncs the choice via LobbyConfig.mapId).

export type MapDefinition = {
  id: string
  name: string
  tagline: string
  /** Top-down layout diagram shown in the map selector. */
  thumbnail: string
  maxPlayers: number
  anchors: { temple: Vector3; rotationY: number }[]
  fields: ResourceField[]
}

export const MAPS: MapDefinition[] = [
  {
    id: 'shattered-crown',
    name: 'Shattered Crown',
    tagline: '6 starts on the rim, each with its own natural. Rich gold crystal and cryo plasma at the contested center.',
    thumbnail: 'images/maps/shattered-crown.jpg',
    maxPlayers: 6,
    anchors: MAP_ANCHORS,
    fields: RESOURCE_FIELDS
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
