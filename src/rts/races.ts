import { Color4 } from '@dcl/sdk/math'
import { gameState } from './state'
import type { BuildableKind, RaceId, RaceUnitStats, ResourceCost, SoldierVariant, Team } from './types'

// The three playable races. Units and buildings are fully distinct procedural
// models with their own stats. Every race fields eight unit roles:
//   worker / melee / ranged / healer (support) / caster (AoE splash) /
//   flyer (fast hoverer) / siege (long-range artillery) / titan (giant).
//
// Healer flavor: human = strong single-target beam, alien = beam that also
// mends structures, bio = weaker regeneration aura hitting every nearby ally.
// Siege flavor: human = balanced splash howitzer, alien = heaviest single
// bolt, bio = cheap acid lob that poisons victims. All siege outranges the
// 10m turret and none of them can hit air.
//
// Balance identity (cost-efficiency must order bio > human > alien at every
// tier, raw per-unit power the opposite way; production times likewise):
//   human - baseline all-rounder; crews repair structures 1.75x faster.
//   alien - expensive, durable, hard-hitting, slow to produce; structures
//           self-assemble at half worker speed once seeded.
//   bio   - cheap, fast, fragile, swarms out of quick production cycles;
//           every living unit regenerates 1 HP per second.

const MELEE_RANGE = 1.8

export type RaceDefinition = {
  id: RaceId
  name: string
  tagline: string
  color: Color4
  accent: Color4
  worker: RaceUnitStats
  melee: RaceUnitStats
  ranged: RaceUnitStats
  healer: RaceUnitStats
  caster: RaceUnitStats
  flyer: RaceUnitStats
  /** Unarmed flying carrier: ferries up to 8 ground units across the void on island maps. */
  transport: RaceUnitStats
  siege: RaceUnitStats
  titan: RaceUnitStats
  /** Signature hero: one per match, granted at the start, cannot be rebuilt. */
  hero: RaceUnitStats
  /** Short trait blurb shown when the hero is selected. */
  heroTrait: string
  buildingNames: Record<BuildableKind, string>
}

export const RACES: Record<RaceId, RaceDefinition> = {
  human: {
    id: 'human',
    name: 'VANGUARD',
    tagline: 'Exiled colonists. Balanced units; crews repair structures fast.',
    color: Color4.create(0.35, 0.55, 0.85, 1),
    accent: Color4.create(0.45, 0.7, 1, 1),
    worker: { name: 'Rigger', hp: 35, cost: { minerals: 50 }, productionTime: 2, supply: 1 },
    melee: { name: 'Breacher', hp: 100, damage: 11, moveSpeed: 3, attackRange: MELEE_RANGE, cost: { minerals: 100 }, productionTime: 2, supply: 1 },
    ranged: { name: 'Longshot', hp: 70, damage: 9, moveSpeed: 2.9, attackRange: 6, cost: { minerals: 80, gas: 25 }, productionTime: 2.2, supply: 1 },
    healer: { name: 'Field Medic', hp: 60, damage: 0, moveSpeed: 3.1, attackRange: 2.5, healRate: 9, cost: { minerals: 75, gas: 50 }, productionTime: 2.5, supply: 1 },
    caster: { name: 'Stormcaller', hp: 60, damage: 14, moveSpeed: 2.7, attackRange: 7, attackRate: 1.7, splashRadius: 2.8, cost: { minerals: 100, gas: 100 }, productionTime: 3.5, supply: 2 },
    flyer: { name: 'Kestrel Gunship', hp: 90, damage: 12, moveSpeed: 4.2, attackRange: 6.5, attackRate: 0.9, cost: { minerals: 120, gas: 80 }, productionTime: 3.5, supply: 2 },
    transport: { name: 'Skyhauler', hp: 160, damage: 0, moveSpeed: 3.6, attackRange: 0, cost: { minerals: 150, gas: 75 }, productionTime: 4, supply: 2 },
    siege: { name: 'Thunderhead', hp: 150, damage: 44, moveSpeed: 1.9, attackRange: 11, attackRate: 3.4, splashRadius: 2.6, cost: { minerals: 200, gas: 125 }, productionTime: 5.5, supply: 3 },
    titan: { name: 'Juggernaut', hp: 380, damage: 40, moveSpeed: 2.2, attackRange: 2.8, attackRate: 1.7, splashRadius: 2.2, cost: { minerals: 300, gas: 200 }, productionTime: 8, supply: 4 },
    hero: { name: 'Warmaster Kael', hp: 550, damage: 26, moveSpeed: 3, attackRange: 6.5, attackRate: 1.1, cost: {}, productionTime: 0, supply: 0 },
    heroTrait: 'Battle Standard: allied fighters near Kael deal +25% damage.',
    buildingNames: {
      temple: 'Command Post',
      supplyHouse: 'Habitat',
      barracks: 'Armory',
      techLab: 'Starforge',
      forge: 'Foundry',
      airForge: 'Skyharbor',
      fireplace: 'Beacon',
      turret: 'Sentry Cannon'
    }
  },
  alien: {
    id: 'alien',
    name: 'AETHYR',
    tagline: 'Ancient tech. Devastating units; structures assemble themselves.',
    color: Color4.create(0.75, 0.6, 0.25, 1),
    accent: Color4.create(0.85, 0.65, 1, 1),
    worker: { name: 'Seeker', hp: 35, cost: { minerals: 50 }, productionTime: 2.5, supply: 1 },
    melee: { name: 'Sentinel', hp: 125, damage: 16, moveSpeed: 2.8, attackRange: MELEE_RANGE, cost: { minerals: 125, gas: 50 }, productionTime: 3, supply: 1 },
    ranged: { name: 'Lancer', hp: 85, damage: 13, moveSpeed: 2.7, attackRange: 7, cost: { minerals: 100, gas: 75 }, productionTime: 3.2, supply: 1 },
    healer: { name: 'Lightmender', hp: 85, damage: 0, moveSpeed: 2.7, attackRange: 3, healRate: 7, cost: { minerals: 100, gas: 75 }, productionTime: 3.2, supply: 1 },
    caster: { name: 'Riftweaver', hp: 70, damage: 18, moveSpeed: 2.6, attackRange: 8, attackRate: 1.9, splashRadius: 3.2, cost: { minerals: 125, gas: 125 }, productionTime: 4, supply: 2 },
    flyer: { name: 'Zephyr', hp: 110, damage: 15, moveSpeed: 3.9, attackRange: 7, attackRate: 1.1, cost: { minerals: 150, gas: 100 }, productionTime: 4, supply: 2 },
    transport: { name: 'Riftbarge', hp: 200, damage: 0, moveSpeed: 3.3, attackRange: 0, cost: { minerals: 175, gas: 100 }, productionTime: 4.5, supply: 2 },
    siege: { name: 'Sunlance', hp: 180, damage: 58, moveSpeed: 1.7, attackRange: 12, attackRate: 3.8, splashRadius: 2.2, cost: { minerals: 250, gas: 175 }, productionTime: 6.5, supply: 3 },
    titan: { name: 'Avatar', hp: 450, damage: 50, moveSpeed: 2, attackRange: 3, attackRate: 1.9, splashRadius: 2.4, cost: { minerals: 350, gas: 250 }, productionTime: 9, supply: 4 },
    hero: { name: 'Riftlord Auren', hp: 650, damage: 34, moveSpeed: 2.6, attackRange: 7.5, attackRate: 1.6, splashRadius: 3.5, cost: {}, productionTime: 0, supply: 0 },
    heroTrait: 'Aetheric Ward: Auren constantly regenerates 4 HP per second.',
    buildingNames: {
      temple: 'Monolith',
      supplyHouse: 'Conduit',
      barracks: 'Rift Gate',
      techLab: 'Sanctum',
      forge: 'Ascension Spire',
      airForge: 'Zenith Spire',
      fireplace: 'Obelisk',
      turret: 'Arc Spire'
    }
  },
  bio: {
    id: 'bio',
    name: 'MYRIAD',
    tagline: 'Living horde. Cheap and fast; wounded units regenerate.',
    color: Color4.create(0.65, 0.25, 0.3, 1),
    accent: Color4.create(1, 0.45, 0.3, 1),
    worker: { name: 'Grub', hp: 30, cost: { minerals: 50 }, productionTime: 1.5, supply: 1 },
    melee: { name: 'Mauler', hp: 55, damage: 7, moveSpeed: 3.6, attackRange: MELEE_RANGE, cost: { minerals: 50 }, productionTime: 1.2, supply: 1 },
    ranged: { name: 'Spitter', hp: 45, damage: 6, moveSpeed: 3.2, attackRange: 5.5, cost: { minerals: 50, gas: 25 }, productionTime: 1.4, supply: 1 },
    healer: { name: 'Broodtender', hp: 50, damage: 0, moveSpeed: 3.4, attackRange: 3.5, healRate: 3, cost: { minerals: 60, gas: 25 }, productionTime: 1.6, supply: 1 },
    caster: { name: 'Plague Weaver', hp: 50, damage: 10, moveSpeed: 3, attackRange: 6, attackRate: 1.5, splashRadius: 2.6, cost: { minerals: 80, gas: 60 }, productionTime: 2.5, supply: 2 },
    flyer: { name: 'Shrieker', hp: 70, damage: 9, moveSpeed: 4.5, attackRange: 5.5, attackRate: 0.8, cost: { minerals: 90, gas: 50 }, productionTime: 2.2, supply: 2 },
    transport: { name: 'Broodwing', hp: 130, damage: 0, moveSpeed: 3.9, attackRange: 0, cost: { minerals: 125, gas: 50 }, productionTime: 3, supply: 2 },
    siege: { name: 'Acidmaw', hp: 120, damage: 30, moveSpeed: 2.3, attackRange: 10.5, attackRate: 3, splashRadius: 3, cost: { minerals: 150, gas: 100 }, productionTime: 4, supply: 3 },
    titan: { name: 'Behemoth', hp: 320, damage: 30, moveSpeed: 2.6, attackRange: 2.6, attackRate: 1.5, splashRadius: 2, cost: { minerals: 250, gas: 150 }, productionTime: 6, supply: 4 },
    hero: { name: 'Broodmother Szel', hp: 750, damage: 24, moveSpeed: 3.2, attackRange: 2.2, attackRate: 1.4, splashRadius: 1.6, cost: {}, productionTime: 0, supply: 0 },
    heroTrait: 'Endless Brood: Szel births a free Mauler every 35 seconds.',
    buildingNames: {
      temple: 'Brood Heart',
      supplyHouse: 'Growth Pod',
      barracks: 'Spawning Pit',
      techLab: 'Grand Nest',
      forge: 'Mutation Den',
      airForge: 'Wind Roost',
      fireplace: 'Spore Mound',
      turret: 'Thorn Mound'
    }
  }
}

export const RACE_IDS: RaceId[] = ['human', 'alien', 'bio']

export function getRace(team: Team): RaceDefinition {
  return RACES[team === 'player' ? gameState.playerRace : gameState.enemyRaces[team]]
}

export function getWorkerDefinition(team: Team): RaceUnitStats {
  return getRace(team).worker
}

export function getSoldierDefinition(team: Team, variant: SoldierVariant): RaceUnitStats {
  const race = getRace(team)
  if (variant === 'ranged') return race.ranged
  if (variant === 'healer') return race.healer
  if (variant === 'caster') return race.caster
  if (variant === 'flyer') return race.flyer
  if (variant === 'transport') return race.transport
  if (variant === 'siege') return race.siege
  if (variant === 'titan') return race.titan
  if (variant === 'hero') return race.hero
  return race.melee
}

/** Airborne variants: fly over the void on island maps and only anti-air weapons reach them. */
export function isAirVariant(variant: SoldierVariant): boolean {
  return variant === 'flyer' || variant === 'transport'
}

/** How many ground units fit inside a transport. */
export const TRANSPORT_CAPACITY = 8

/** Variants trained at the advanced structure instead of the barracks. */
export const ADVANCED_VARIANTS: SoldierVariant[] = ['caster', 'flyer', 'transport', 'siege', 'titan']

/** StarCraft-style tech tiers: these variants also need this building to exist before they can be trained. */
export const UNIT_REQUIREMENTS: Partial<Record<SoldierVariant, BuildableKind>> = {
  siege: 'forge',
  titan: 'forge'
}

export function getBuildingDisplayName(kind: BuildableKind, team: Team): string {
  return getRace(team).buildingNames[kind]
}

/** Roll a random race for a computer set to 'random'; any race is fair game. */
export function pickRandomRace(): RaceId {
  return RACE_IDS[Math.floor(Math.random() * RACE_IDS.length)]
}

export function formatRaceCost(cost: ResourceCost): string {
  const parts: string[] = []
  if (cost.minerals) parts.push(`${cost.minerals} crystal`)
  if (cost.gas) parts.push(`${cost.gas} plasma`)
  return parts.join(' / ')
}
