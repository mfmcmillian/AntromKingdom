import { Color4 } from '@dcl/sdk/math'
import { gameState } from './state'
import type { BuildableKind, RaceId, RaceUnitStats, ResourceCost, Team } from './types'

// The three playable races. Buildings share models for now (names + beacon color
// differ per race); units are fully distinct procedural models with their own stats.
//
// Balance identity:
//   human - baseline all-rounder.
//   alien - expensive, durable, hard-hitting, slow to produce.
//   bio   - cheap, fast, fragile, swarms out of quick production cycles.

export type RaceDefinition = {
  id: RaceId
  name: string
  tagline: string
  color: Color4
  accent: Color4
  worker: RaceUnitStats
  soldier: RaceUnitStats
  buildingNames: Record<BuildableKind, string>
}

export const RACES: Record<RaceId, RaceDefinition> = {
  human: {
    id: 'human',
    name: 'HUMANS',
    tagline: 'Versatile colonists. Balanced units and steady production.',
    color: Color4.create(0.35, 0.55, 0.85, 1),
    accent: Color4.create(0.45, 0.7, 1, 1),
    worker: { name: 'Miner', hp: 35, cost: { minerals: 50 }, productionTime: 2, supply: 1 },
    soldier: { name: 'Marine', hp: 80, damage: 10, moveSpeed: 3, cost: { minerals: 100, gas: 25 }, productionTime: 2, supply: 1 },
    buildingNames: {
      temple: 'Command Post',
      supplyHouse: 'Habitat',
      barracks: 'Armory',
      fireplace: 'Beacon'
    }
  },
  alien: {
    id: 'alien',
    name: 'ALIENS',
    tagline: 'Ancient tech. Costly, slow to build, devastating in battle.',
    color: Color4.create(0.75, 0.6, 0.25, 1),
    accent: Color4.create(0.85, 0.65, 1, 1),
    worker: { name: 'Probe', hp: 30, cost: { minerals: 50 }, productionTime: 2.5, supply: 1 },
    soldier: { name: 'Stalker', hp: 115, damage: 15, moveSpeed: 2.8, cost: { minerals: 125, gas: 50 }, productionTime: 3, supply: 1 },
    buildingNames: {
      temple: 'Nexus',
      supplyHouse: 'Pylon',
      barracks: 'Warp Gate',
      fireplace: 'Obelisk'
    }
  },
  bio: {
    id: 'bio',
    name: 'BIO SWARM',
    tagline: 'Living horde. Cheap, fast, fragile - drown them in bodies.',
    color: Color4.create(0.65, 0.25, 0.3, 1),
    accent: Color4.create(1, 0.45, 0.3, 1),
    worker: { name: 'Drone', hp: 40, cost: { minerals: 50 }, productionTime: 1.5, supply: 1 },
    soldier: { name: 'Ravager', hp: 55, damage: 7, moveSpeed: 3.6, cost: { minerals: 60, gas: 10 }, productionTime: 1.2, supply: 1 },
    buildingNames: {
      temple: 'Hive',
      supplyHouse: 'Growth Pod',
      barracks: 'Spawning Pit',
      fireplace: 'Spore Mound'
    }
  }
}

export const RACE_IDS: RaceId[] = ['human', 'alien', 'bio']

export function getRace(team: Team): RaceDefinition {
  return RACES[team === 'enemy' ? gameState.enemyRace : gameState.playerRace]
}

export function getWorkerDefinition(team: Team): RaceUnitStats {
  return getRace(team).worker
}

export function getSoldierDefinition(team: Team): RaceUnitStats {
  return getRace(team).soldier
}

export function getBuildingDisplayName(kind: BuildableKind, team: Team): string {
  return getRace(team).buildingNames[kind]
}

/** Random race for the AI that differs from the player's pick. */
export function pickEnemyRace(playerRace: RaceId): RaceId {
  const options = RACE_IDS.filter((race) => race !== playerRace)
  return options[Math.floor(Math.random() * options.length)]
}

export function formatRaceCost(cost: ResourceCost): string {
  const parts: string[] = []
  if (cost.minerals) parts.push(`${cost.minerals} minerals`)
  if (cost.gas) parts.push(`${cost.gas} gas`)
  return parts.join(' / ')
}
