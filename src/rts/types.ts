import type { Entity } from '@dcl/sdk/ecs'
import type { Color4, Vector3 } from '@dcl/sdk/math'

export type ResourceKind = 'rocks' | 'wood' | 'meat'
export type Team = 'player' | 'enemy'
export type SelectableKind = 'temple' | 'worker' | 'resource' | 'supplyHouse' | 'barracks' | 'fireplace' | 'soldier' | 'enemyBuilding'
export type WorkerState =
  | 'idle'
  | 'movingToResource'
  | 'gathering'
  | 'returning'
  | 'movingToBuild'
  | 'constructing'
  | 'movingToRally'
  | 'dead'
export type SoldierState = 'idle' | 'movingToAttack' | 'attacking' | 'movingToRally' | 'dead'
export type UnitGroupKind = 'worker' | 'soldier'
export type BuildableKind = 'temple' | 'supplyHouse' | 'barracks' | 'fireplace'
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
  rallyPoint?: Vector3
  timer: number
  carrying: number
  carryingResource?: ResourceKind
  activeAnimation: string
}

export type Soldier = Selectable & {
  kind: 'soldier'
  hp: number
  maxHp: number
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

export type ResourceDefinition = {
  name: string
  amount: number
  placementY: number
  src: string
  colliderScale: Vector3
  animations: AnimationStateConfig[]
  gatherClip: string
  depletionClip?: string
  audioClipUrl?: string
  hoverText: string
}

export type UnitProductionOrder = {
  barracksId: string
  timer: number
  team: Team
}

export type WorkerProductionOrder = {
  homesteadId: string
  timer: number
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
