import { Color4, Vector3 } from '@dcl/sdk/math'
import type { BuildableKind, BuildingDefinition, ResourceDefinition, ResourceKind, UnitDefinition } from './types'

export const CONFIG = {
  rocksStart: 50,
  woodStart: 0,
  meatStart: 0,
  workerCost: 50,
  soldierCost: 100,
  soldierMeatCost: 50,
  startSupplyCap: 5,
  workerMineTime: 3,
  workerCarryAmount: 10,
  workerMoveSpeed: 2.5,
  builderMoveSpeed: 2.2,
  productionTime: 2,
  workerHp: 35,
  soldierHp: 80,
  soldierMoveSpeed: 3,
  soldierDamage: 10,
  soldierAttackRate: 1,
  soldierAttackRange: 1.8,
  soldierUnitEngageRadius: 1.35,
  templeHp: 400,
  repairHpPerSecond: 12,
  repairRockCostPerSecond: 2,
  enemyBuildingHp: 300,
  enemyAiDecisionRate: 1.5,
  enemyAiAttackInterval: 90,
  enemyAiDefenderCount: 4,
  enemyAiTargetWorkers: 14,
  enemyAiTargetGuards: 18,
  // Pointer click distance. Large so everything on screen is clickable from the overhead camera.
  commandRange: 100,
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

// Space re-theme: the internal keys stay rocks/wood/meat so the economy code is
// untouched, but the deposits are procedural ore chunks, crystal veins, and plasma vents.
export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  rocks: 'ore',
  wood: 'crystal',
  meat: 'plasma'
}

export const RESOURCE_DEFINITIONS: Record<ResourceKind, ResourceDefinition> = {
  rocks: {
    name: 'Ore Deposit',
    amount: 400,
    placementY: 0,
    colliderScale: Vector3.create(1.7, 1.2, 1.7),
    audioClipUrl: ASSETS.rockSound,
    hoverText: 'Mine ore'
  },
  wood: {
    name: 'Crystal Vein',
    amount: 300,
    placementY: 0,
    colliderScale: Vector3.create(1.5, 2.5, 1.5),
    audioClipUrl: ASSETS.rockSound,
    hoverText: 'Harvest crystal'
  },
  meat: {
    name: 'Plasma Vent',
    amount: 250,
    placementY: 0,
    colliderScale: Vector3.create(1.7, 1.6, 1.7),
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
  rock: Color4.create(0.45, 0.48, 0.52, 1),
  wood: Color4.create(0.2, 0.55, 0.18, 1),
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

// Classic RTS resource layout: a handful of distinct fields instead of scattered
// clutter. Each side gets an ore, crystal, and plasma field near its base, with
// mirrored expansions and a contested cluster in the middle of the map.
export const RESOURCE_FIELDS: ResourceField[] = [
  // Player side (base in the south-west corner). Starter ore sits right by the Temple.
  { kind: 'rocks', center: Vector3.create(20, 0, 12), count: 5, radius: 3.5 },
  { kind: 'rocks', center: Vector3.create(12, 0, 54), count: 5, radius: 4 },
  { kind: 'wood', center: Vector3.create(24, 0, 21), count: 5, radius: 4 },
  { kind: 'meat', center: Vector3.create(28, 0, 9), count: 4, radius: 3.5 },
  // Enemy side (base in the north-east corner), mirrored.
  { kind: 'rocks', center: Vector3.create(140, 0, 148), count: 5, radius: 3.5 },
  { kind: 'rocks', center: Vector3.create(148, 0, 106), count: 5, radius: 4 },
  { kind: 'wood', center: Vector3.create(136, 0, 139), count: 5, radius: 4 },
  { kind: 'meat', center: Vector3.create(132, 0, 151), count: 4, radius: 3.5 },
  // Mirrored expansions.
  { kind: 'rocks', center: Vector3.create(60, 0, 14), count: 5, radius: 4 },
  { kind: 'rocks', center: Vector3.create(100, 0, 146), count: 5, radius: 4 },
  { kind: 'wood', center: Vector3.create(50, 0, 128), count: 5, radius: 4 },
  { kind: 'wood', center: Vector3.create(110, 0, 32), count: 5, radius: 4 },
  { kind: 'meat', center: Vector3.create(22, 0, 68), count: 4, radius: 3.5 },
  { kind: 'meat', center: Vector3.create(138, 0, 92), count: 4, radius: 3.5 },
  // Contested center.
  { kind: 'rocks', center: Vector3.create(76, 0, 84), count: 6, radius: 4.5 },
  { kind: 'wood', center: Vector3.create(85, 0, 74), count: 5, radius: 4 }
]

export const BUILDING_DEFINITIONS: Record<BuildableKind, BuildingDefinition> = {
  temple: {
    kind: 'temple',
    name: 'Temple',
    cost: { rocks: 150, wood: 100 },
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
    cost: { rocks: 50 },
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
    cost: { rocks: 100, wood: 75 },
    hp: 250,
    buildTime: 8,
    supplyAdds: 0,
    placementY: 3.5,
    scale: Vector3.create(5.85, 4.17, 5.85),
    color: COLORS.barracks,
    completeStatus: 'Barracks complete. Soldier production comes next.'
  },
  fireplace: {
    kind: 'fireplace',
    name: 'Fireplace',
    cost: { rocks: 25, wood: 50 },
    hp: 120,
    buildTime: 4,
    supplyAdds: 0,
    placementY: 0,
    scale: Vector3.create(1, 1, 1),
    color: COLORS.fireplace,
    completeStatus: 'Fireplace complete.'
  }
}

export const SOLDIER_DEFINITION: UnitDefinition = {
  name: 'Antrom Gaurd',
  cost: { rocks: CONFIG.soldierCost, meat: CONFIG.soldierMeatCost },
  supply: 1,
  hp: CONFIG.soldierHp,
  productionTime: 3,
  scale: Vector3.create(0.55, 0.7, 0.55),
  color: COLORS.soldier
}
