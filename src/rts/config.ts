import { Color4, Vector3 } from '@dcl/sdk/math'
import type { BuildableKind, BuildingDefinition, Difficulty, EnemyTeam, ResourceDefinition, ResourceKind, UnitDefinition } from './types'

export const CONFIG = {
  mineralsStart: 50,
  gasStart: 0,
  startSupplyCap: 5,
  workerMineTime: 3,
  workerCarryAmount: 10,
  workerMoveSpeed: 2.5,
  // Workers can fight when commanded, but poorly - pulling them is a last resort.
  workerDamage: 3,
  workerAttackRange: 1.6,
  builderMoveSpeed: 2.2,
  // Per-race unit stats live in races.ts; these are engine-level fallbacks.
  soldierMoveSpeed: 3,
  soldierDamage: 10,
  soldierAttackRate: 1,
  soldierAttackRange: 1.8,
  soldierUnitEngageRadius: 1.35,
  templeHp: 400,
  repairHpPerSecond: 12,
  repairMineralCostPerSecond: 2,
  enemyBuildingHp: 300,
  // Pointer click distance, measured from the (parked) avatar - must exceed the
  // map diagonal (~226m) so the far enemy base stays clickable from the free camera.
  commandRange: 300,
  // Idle workers automatically start gathering resources within this range.
  workerAutoGatherRange: 12,
  placementRange: 100,
  buildRange: 1
}

export const ASSETS = {
  hq: 'models/hq.glb',
  supply: 'models/supply.glb',
  barracks: 'models/barracks.glb',
  fireplace: 'models/Fireplace.glb',
  workers: ['models/FarmerFemale2.glb', 'models/FarmerMale1.glb'],
  playerFighter: 'models/KnightwSwordNPC.glb',
  enemyFighter: 'models/ExecutionerAxe.glb',
  rock: 'models/mining.glb',
  tree: 'models/LeafyTree.glb',
  pig: 'models/Pig.glb',
  rockSound: 'sounds/gathering/mining.mp3',
  treeSound: 'sounds/gathering/tree.mp3'
}

export const MODEL_TRANSFORMS = {
  hq: {
    y: 5,
    scale: Vector3.create(5, 5, 5),
    colliderScale: Vector3.create(10, 14, 10)
  }
}

// StarCraft-style two-resource economy: mineral crystal fields and gas geysers.
export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  minerals: 'minerals',
  gas: 'gas'
}

export const RESOURCE_DEFINITIONS: Record<ResourceKind, ResourceDefinition> = {
  minerals: {
    name: 'Mineral Field',
    amount: 500,
    placementY: 0,
    colliderScale: Vector3.create(1.8, 1.5, 1.8),
    audioClipUrl: ASSETS.rockSound,
    hoverText: 'Mine minerals'
  },
  gas: {
    name: 'Gas Geyser',
    amount: 1000,
    placementY: 0,
    colliderScale: Vector3.create(2.4, 1.8, 2.4),
    hoverText: 'Harvest gas'
  }
}

export const SCENE = {
  size: 160,
  center: 80
}

export const COLORS = {
  ground: Color4.create(0.42, 0.42, 0.47, 1),
  temple: Color4.create(0.1, 0.35, 1, 1),
  worker: Color4.create(0.3, 0.75, 1, 1),
  supply: Color4.create(0.95, 0.75, 0.25, 1),
  barracks: Color4.create(0.45, 0.35, 0.95, 1),
  fireplace: Color4.create(1, 0.35, 0.12, 1),
  soldier: Color4.create(0.15, 0.9, 0.35, 1),
  enemy: Color4.create(0.9, 0.2, 0.2, 1),
  construction: Color4.create(0.55, 0.55, 0.55, 1),
  selected: Color4.create(0.2, 1, 0.35, 0.9),
  ghost: Color4.create(0.7, 0.9, 1, 0.35)
}

export const GRID = {
  plotCount: 10,
  sceneSize: 16,
  origin: 0,
  get plotSize() {
    return this.sceneSize / this.plotCount
  }
}

function plotPosition(column: number, row: number, y: number): Vector3 {
  return Vector3.create(
    GRID.origin + column * GRID.plotSize + GRID.plotSize / 2,
    y,
    GRID.origin + row * GRID.plotSize + GRID.plotSize / 2
  )
}

// -----------------------------------------------------------------------------
// Computer opponents: difficulty presets and starting seats.
// -----------------------------------------------------------------------------

export type DifficultySettings = {
  label: string
  /** Seconds between AI macro decisions (build/train/research). */
  decisionRate: number
  /** Seconds between attack waves. */
  attackInterval: number
  /** Head start on the first attack wave timer (higher = earlier first attack). */
  initialAttackTimer: number
  /** Soldiers held back to defend the base. */
  defenderCount: number
  targetWorkers: number
  targetGuards: number
  maxAdvancedUnits: number
  maxHomesteads: number
  maxTemples: number
  /** Whether the AI researches forge upgrades at all. */
  research: boolean
  /** Income multiplier on delivered resources (classic hard-AI cheat). */
  gatherMultiplier: number
}

export const AI_DIFFICULTY: Record<Difficulty, DifficultySettings> = {
  easy: {
    label: 'Easy',
    decisionRate: 3,
    attackInterval: 150,
    initialAttackTimer: 0,
    defenderCount: 2,
    targetWorkers: 9,
    targetGuards: 8,
    maxAdvancedUnits: 2,
    maxHomesteads: 4,
    maxTemples: 1,
    research: false,
    gatherMultiplier: 1
  },
  medium: {
    label: 'Medium',
    decisionRate: 1.5,
    attackInterval: 90,
    initialAttackTimer: 25,
    defenderCount: 4,
    targetWorkers: 14,
    targetGuards: 18,
    maxAdvancedUnits: 8,
    maxHomesteads: 7,
    maxTemples: 3,
    research: true,
    gatherMultiplier: 1
  },
  hard: {
    label: 'Hard',
    decisionRate: 1,
    attackInterval: 70,
    initialAttackTimer: 30,
    defenderCount: 5,
    targetWorkers: 18,
    targetGuards: 24,
    maxAdvancedUnits: 12,
    maxHomesteads: 8,
    maxTemples: 3,
    research: true,
    gatherMultiplier: 1.25
  }
}

export const DIFFICULTY_IDS: Difficulty[] = ['easy', 'medium', 'hard']

/**
 * Starting temple per computer slot. Slot 1 is the mirrored NE main; slots 2
 * and 3 seat at the gas expansions (NE-side, then SW-side - a third computer
 * starts uncomfortably close to the player on purpose).
 */
export const ENEMY_SEATS: Record<EnemyTeam, { temple: Vector3; rotationY: number }> = {
  enemy1: { temple: Vector3.create(142.89, 5, 136.75), rotationY: 180 },
  enemy2: { temple: Vector3.create(137, 5, 114), rotationY: 200 },
  enemy3: { temple: Vector3.create(23, 5, 46), rotationY: 160 }
}

export const POSITIONS = {
  base: Vector3.create(8.54, 5, 3.48),
  enemyTemple: Vector3.create(142.89, 5, 136.75),
  enemyBuilding: Vector3.create(15.06, 0.8, 24.15),
  workerSpawn: plotPosition(3, 3, 0.25),
  workers: [
    Vector3.create(7.75, 0.25, 7.74),
    Vector3.create(8.54, 0.25, 8.07),
    Vector3.create(7.73, 0.25, 10.03),
    Vector3.create(5.26, 0.25, 9.77),
    Vector3.create(6.93, 0.25, 10.47)
  ]
}

export type ResourceField = {
  kind: ResourceKind
  center: Vector3
  count: number
  radius: number
}

// StarCraft-style layout: each base gets a mineral line plus two gas geysers,
// with mirrored expansions and a contested cluster in the middle of the map.
export const RESOURCE_FIELDS: ResourceField[] = [
  // Player main (base in the south-west corner).
  { kind: 'minerals', center: Vector3.create(21, 0, 13), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(9, 0, 22), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(29, 0, 5), count: 1, radius: 0 },
  // Enemy main (base in the north-east corner), mirrored.
  { kind: 'minerals', center: Vector3.create(139, 0, 147), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(151, 0, 138), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(131, 0, 155), count: 1, radius: 0 },
  // Mirrored expansions.
  { kind: 'minerals', center: Vector3.create(12, 0, 54), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(21, 0, 63), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(148, 0, 106), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(139, 0, 97), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(110, 0, 32), count: 6, radius: 4 },
  { kind: 'minerals', center: Vector3.create(50, 0, 128), count: 6, radius: 4 },
  // Contested center.
  { kind: 'minerals', center: Vector3.create(80, 0, 80), count: 7, radius: 5 },
  { kind: 'gas', center: Vector3.create(70, 0, 90), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(90, 0, 70), count: 1, radius: 0 }
]

export const BUILDING_DEFINITIONS: Record<BuildableKind, BuildingDefinition> = {
  temple: {
    kind: 'temple',
    name: 'Temple',
    cost: { minerals: 300 },
    hp: CONFIG.templeHp,
    buildTime: 10,
    supplyAdds: 0,
    placementY: MODEL_TRANSFORMS.hq.y,
    scale: MODEL_TRANSFORMS.hq.scale,
    color: COLORS.temple,
    completeStatus: 'Temple complete. Workers can deliver resources here.'
  },
  supplyHouse: {
    kind: 'supplyHouse',
    name: 'Homestead',
    cost: { minerals: 100 },
    hp: 150,
    buildTime: 5,
    supplyAdds: 5,
    placementY: 2.65,
    scale: Vector3.create(6.04, 4.72, 6.04),
    color: COLORS.supply,
    completeStatus: 'Homestead complete. Workers can be trained here.'
  },
  barracks: {
    kind: 'barracks',
    name: 'Barracks',
    cost: { minerals: 150 },
    hp: 250,
    buildTime: 8,
    supplyAdds: 0,
    placementY: 3.5,
    scale: Vector3.create(5.85, 4.17, 5.85),
    color: COLORS.barracks,
    completeStatus: 'Barracks complete. Soldier production comes next.'
  },
  techLab: {
    kind: 'techLab',
    name: 'Tech Lab',
    cost: { minerals: 200, gas: 100 },
    hp: 220,
    buildTime: 9,
    supplyAdds: 0,
    placementY: 0,
    scale: Vector3.create(5.5, 5, 5.5),
    color: Color4.create(0.35, 0.75, 0.9, 1),
    completeStatus: 'Advanced structure complete. Casters, flyers and titans unlocked.',
    requires: 'barracks'
  },
  forge: {
    kind: 'forge',
    name: 'Forge',
    cost: { minerals: 150, gas: 50 },
    hp: 200,
    buildTime: 7,
    supplyAdds: 0,
    placementY: 0,
    scale: Vector3.create(4.5, 4, 4.5),
    color: Color4.create(0.9, 0.55, 0.2, 1),
    completeStatus: 'Upgrade structure complete. Research weapon and speed upgrades.',
    requires: 'barracks'
  },
  fireplace: {
    kind: 'fireplace',
    name: 'Fireplace',
    cost: { minerals: 50 },
    hp: 120,
    buildTime: 4,
    supplyAdds: 0,
    placementY: 0,
    scale: Vector3.create(1, 1, 1),
    color: COLORS.fireplace,
    completeStatus: 'Fireplace complete.'
  }
}
