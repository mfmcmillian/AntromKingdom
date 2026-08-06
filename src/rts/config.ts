import { Color4, Vector3 } from '@dcl/sdk/math'
import type { BuildableKind, BuildingDefinition, Difficulty, ResourceDefinition, ResourceKind, UnitDefinition } from './types'

export const CONFIG = {
  mineralsStart: 50,
  gasStart: 0,
  // Base cap before buildings: the starting temple contributes its supplyAdds
  // on top of this, so matches still open at a 10 cap.
  startSupplyCap: 0,
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

// Two-resource economy (internal keys stay minerals/gas; display names are original lore).
export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  minerals: 'crystal',
  gas: 'plasma'
}

export const RESOURCE_DEFINITIONS: Record<ResourceKind, ResourceDefinition> = {
  minerals: {
    name: 'Crystal Vein',
    amount: 500,
    placementY: 0,
    colliderScale: Vector3.create(1.8, 1.5, 1.8),
    audioClipUrl: ASSETS.rockSound,
    hoverText: 'Harvest crystal'
  },
  gas: {
    name: 'Plasma Vent',
    amount: 1000,
    placementY: 0,
    colliderScale: Vector3.create(2.4, 1.8, 2.4),
    hoverText: 'Siphon plasma'
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
  /** Defense towers the AI protects its base with. */
  maxTurrets: number
  /** Whether the AI researches forge upgrades at all. */
  research: boolean
  /** Whether extra temples go to fresh mineral clusters (expansions) instead of the main base. */
  expands: boolean
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
    maxTurrets: 1,
    research: false,
    expands: false,
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
    maxTurrets: 2,
    research: true,
    expands: false,
    gatherMultiplier: 1
  },
  hard: {
    label: 'Hard',
    decisionRate: 1,
    attackInterval: 70,
    initialAttackTimer: 30,
    defenderCount: 5,
    // High enough to staff the main plus expansion mineral lines.
    targetWorkers: 24,
    targetGuards: 24,
    maxAdvancedUnits: 12,
    maxHomesteads: 8,
    maxTemples: 4,
    maxTurrets: 3,
    research: true,
    expands: true,
    gatherMultiplier: 1.25
  }
}

export const DIFFICULTY_IDS: Difficulty[] = ['easy', 'medium', 'hard']

/**
 * Computer start locations, ordered far-to-near from the player's SW corner:
 * NE corner, north mid-edge, NW corner, SE corner, then south mid-edge.
 * Hostile computers fill seats from the front (far side); allied computers
 * fill from the back so they start next to the player they're defending.
 * Every start sits on the map rim with ~70m+ to its nearest neighbor.
 */
export const COMPUTER_SEATS: { temple: Vector3; rotationY: number }[] = [
  { temple: Vector3.create(142.89, 5, 136.75), rotationY: 180 },
  { temple: Vector3.create(80, 5, 148), rotationY: 180 },
  { temple: Vector3.create(12, 5, 146), rotationY: 135 },
  { temple: Vector3.create(148, 5, 12), rotationY: -45 },
  { temple: Vector3.create(80, 5, 12), rotationY: 0 }
]

/**
 * All six base anchors for multiplayer, indexed by lobby seat: seat 0 is the
 * classic SW player start, seats 1..5 mirror COMPUTER_SEATS. Every client
 * places each lobby seat at the same anchor, so the shared world lines up.
 */
export const MAP_ANCHORS: { temple: Vector3; rotationY: number }[] = [
  { temple: Vector3.create(8.54, 5, 3.48), rotationY: 0 },
  ...COMPUTER_SEATS
]

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

// StarCraft-style layout scaled for six starts: every base anchor gets a main
// (7-crystal line + two plasma vents) and its own natural expansion a short
// march toward the middle (6 crystals + one vent). Two contested mid-edge
// expansions (west/east) and the center cluster round it out, so every player
// has room for multiple expansions without stepping on a neighbor.
export const RESOURCE_FIELDS: ResourceField[] = [
  // --- Mains (matching MAP_ANCHORS order) ---
  // SW player main.
  { kind: 'minerals', center: Vector3.create(21, 0, 13), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(9, 0, 22), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(29, 0, 5), count: 1, radius: 0 },
  // NE main.
  { kind: 'minerals', center: Vector3.create(139, 0, 147), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(151, 0, 138), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(131, 0, 155), count: 1, radius: 0 },
  // North mid-edge main.
  { kind: 'minerals', center: Vector3.create(68, 0, 142), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(93, 0, 152), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(60, 0, 131), count: 1, radius: 0 },
  // NW main.
  { kind: 'minerals', center: Vector3.create(24, 0, 137), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(10, 0, 128), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(32, 0, 150), count: 1, radius: 0 },
  // SE main.
  { kind: 'minerals', center: Vector3.create(135, 0, 21), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(150, 0, 30), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(127, 0, 8), count: 1, radius: 0 },
  // South mid-edge main.
  { kind: 'minerals', center: Vector3.create(92, 0, 18), count: 7, radius: 4.5 },
  { kind: 'gas', center: Vector3.create(67, 0, 8), count: 1, radius: 0 },
  { kind: 'gas', center: Vector3.create(100, 0, 29), count: 1, radius: 0 },

  // --- Naturals (one per start, a short march toward the center) ---
  // SW natural.
  { kind: 'minerals', center: Vector3.create(12, 0, 54), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(21, 0, 63), count: 1, radius: 0 },
  // NE natural.
  { kind: 'minerals', center: Vector3.create(148, 0, 106), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(139, 0, 97), count: 1, radius: 0 },
  // North mid-edge natural.
  { kind: 'minerals', center: Vector3.create(82, 0, 114), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(92, 0, 120), count: 1, radius: 0 },
  // NW natural.
  { kind: 'minerals', center: Vector3.create(40, 0, 118), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(49, 0, 125), count: 1, radius: 0 },
  // SE natural.
  { kind: 'minerals', center: Vector3.create(120, 0, 42), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(111, 0, 35), count: 1, radius: 0 },
  // South mid-edge natural.
  { kind: 'minerals', center: Vector3.create(78, 0, 46), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(68, 0, 40), count: 1, radius: 0 },

  // --- Contested free expansions on the west/east rims ---
  { kind: 'minerals', center: Vector3.create(10, 0, 84), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(18, 0, 92), count: 1, radius: 0 },
  { kind: 'minerals', center: Vector3.create(150, 0, 76), count: 6, radius: 4 },
  { kind: 'gas', center: Vector3.create(142, 0, 68), count: 1, radius: 0 },

  // --- Contested center ---
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
    supplyAdds: 10,
    placementY: MODEL_TRANSFORMS.hq.y,
    scale: MODEL_TRANSFORMS.hq.scale,
    color: COLORS.temple,
    completeStatus: 'Temple complete. Supply cap raised. Train workers and deliver resources here.'
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
    completeStatus: 'Homestead complete. Supply cap raised.'
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
  airForge: {
    kind: 'airForge',
    name: 'Skyharbor',
    cost: { minerals: 150, gas: 100 },
    hp: 220,
    buildTime: 8,
    supplyAdds: 0,
    placementY: 0,
    scale: Vector3.create(5, 5.5, 5),
    color: Color4.create(0.45, 0.75, 1, 1),
    completeStatus: 'Flight structure complete. Research Flight Weapons and Flight Propulsion.',
    requires: 'techLab'
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
  },
  turret: {
    kind: 'turret',
    name: 'Turret',
    cost: { minerals: 100, gas: 25 },
    hp: 260,
    buildTime: 6,
    supplyAdds: 0,
    placementY: 0,
    scale: Vector3.create(2.6, 4.5, 2.6),
    color: Color4.create(0.85, 0.35, 0.3, 1),
    completeStatus: 'Defense tower online. It fires on hostiles automatically.',
    requires: 'barracks'
  }
}

/** Automated defense tower combat stats (shared by all factions). */
export const TURRET_STATS = {
  range: 10,
  // Sized so one tower roughly trades with 1.5x its cost in tier-1 attackers.
  damage: 14,
  attackRate: 1,
  /** Height the bolt fires from, matching the tower head. */
  muzzleHeight: 3.6
}
