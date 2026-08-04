import type { Entity } from '@dcl/sdk/ecs'
import type { Color4, Vector3 } from '@dcl/sdk/math'

export type ResourceKind = 'minerals' | 'gas'
export type Team = 'player' | 'enemy'
export type RaceId = 'human' | 'alien' | 'bio'
export type SelectableKind = 'temple' | 'worker' | 'resource' | 'supplyHouse' | 'barracks' | 'techLab' | 'forge' | 'fireplace' | 'soldier' | 'enemyBuilding'
export type WorkerState =
  | 'idle'
  | 'movingToResource'
  | 'gathering'
  | 'returning'
  | 'movingToBuild'
  | 'constructing'
  | 'movingToRepair'
  | 'repairing'
  | 'movingToRally'
  | 'movingToAttack'
  | 'attacking'
  | 'dead'
export type SoldierState = 'idle' | 'movingToAttack' | 'attacking' | 'movingToRally' | 'dead'
export type SoldierVariant = 'melee' | 'ranged' | 'caster' | 'flyer' | 'titan'
export type BuildableKind = 'temple' | 'supplyHouse' | 'barracks' | 'techLab' | 'forge' | 'fireplace'
export type UpgradeKind = 'damage' | 'speed'
export type ConstructionState = 'none' | 'placing' | 'movingBuilder' | 'building' | 'paused' | 'complete'

export type BoxConfig = {
  position: Vector3
  scale: Vector3
  color: Color4
  emissive?: Color4
  transparent?: boolean
}

export type AnimationStateConfig = {
  clip: string
  playing: boolean
  loop: boolean
  speed?: number
}

export type ModelConfig = {
  position: Vector3
  scale: Vector3
  src: string
  rotationY?: number
  colliderScale?: Vector3
  animations?: AnimationStateConfig[]
  audioClipUrl?: string
}

export type ResourceCost = Partial<Record<ResourceKind, number>>

export type Selectable = {
  id: string
  kind: SelectableKind
  name: string
  entity: Entity
  colliderEntity?: Entity
  labelEntity?: Entity
  alive: boolean
  team?: Team
}

export type Worker = Selectable & {
  kind: 'worker'
  hp: number
  maxHp: number
  state: WorkerState
  targetResourceId?: string
  buildSiteId?: string
  repairTargetId?: string
  attackTargetId?: string
  rallyPoint?: Vector3
  timer: number
  carrying: number
  carryingResource?: ResourceKind
  activeAnimation: string
}

export type Soldier = Selectable & {
  kind: 'soldier'
  variant: SoldierVariant
  hp: number
  maxHp: number
  damage: number
  moveSpeed: number
  attackRange: number
  attackRate: number
  /** Radius of area damage around the primary target; 0 = single-target. */
  splashRadius: number
  state: SoldierState
  targetId?: string
  attackPosition?: Vector3
  rallyPoint?: Vector3
  attackTimer: number
  activeAnimation: string
}

export type ResourceNode = Selectable & {
  kind: 'resource'
  resource: ResourceKind
  amount: number
  depletionTimer?: number
}

export type Building = Selectable & {
  kind: BuildableKind | 'enemyBuilding'
  hp: number
  maxHp: number
  constructionState: ConstructionState
  constructionProgress: number
  buildTime: number
  builderWorkerId?: string
  isComplete: boolean
  damageVfxEntity?: Entity
  damageVfxLevel?: number
  beaconEntity?: Entity
}

export type BuildingDefinition = {
  kind: BuildableKind
  name: string
  cost: ResourceCost
  hp: number
  buildTime: number
  supplyAdds: number
  placementY: number
  scale: Vector3
  color: Color4
  completeStatus: string
}

export type UnitDefinition = {
  name: string
  cost: ResourceCost
  supply: number
  hp: number
  productionTime: number
  scale: Vector3
  color: Color4
}

export type RaceUnitStats = {
  name: string
  hp: number
  cost: ResourceCost
  productionTime: number
  supply: number
  damage?: number
  moveSpeed?: number
  attackRange?: number
  attackRate?: number
  splashRadius?: number
}

export type UpgradeResearch = {
  team: Team
  kind: UpgradeKind
  forgeId: string
  timer: number
  researchTime: number
}

export type ResourceDefinition = {
  name: string
  amount: number
  placementY: number
  colliderScale: Vector3
  audioClipUrl?: string
  hoverText: string
}

export type UnitProductionOrder = {
  barracksId: string
  timer: number
  productionTime: number
  team: Team
  variant: SoldierVariant
}

export type WorkerProductionOrder = {
  homesteadId: string
  timer: number
  productionTime: number
  team: Team
}

export type PlacementState =
  | { state: 'none' }
  | {
      state: 'placing'
      buildingKind: BuildableKind
      builderWorkerId: string
      cost: ResourceCost
      ghostEntity: Entity
      ghostFootprintEntity: Entity
      ghostModelEntity: Entity
    }

export type SelectedSummary = {
  name: string
  kind: SelectableKind | 'none'
  team?: Team
  hp?: number
  maxHp?: number
  detail: string
}
