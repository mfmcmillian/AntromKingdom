import type { Entity } from '@dcl/sdk/ecs'
import type { Color4, Vector3 } from '@dcl/sdk/math'

export type ResourceKind = 'minerals' | 'gas'
/** Non-player team slots (computers or remote humans), up to five opponents. */
export type EnemyTeam = 'enemy1' | 'enemy2' | 'enemy3' | 'enemy4' | 'enemy5'
export type Team = 'player' | EnemyTeam
export type Difficulty = 'easy' | 'medium' | 'hard'
/** team: computers can join the player's side; ffa: every faction fights everyone. */
export type GameMode = 'team' | 'ffa'
export type RaceId = 'human' | 'alien' | 'bio'
export type SelectableKind = 'temple' | 'worker' | 'resource' | 'supplyHouse' | 'barracks' | 'techLab' | 'forge' | 'airForge' | 'fireplace' | 'turret' | 'soldier' | 'enemyBuilding'
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
export type SoldierState = 'idle' | 'movingToAttack' | 'attacking' | 'movingToRally' | 'attackMoving' | 'patrolling' | 'dead'
/** defensive: chase a short leash then return to post; hold: never move, only fire in range. */
export type SoldierStance = 'defensive' | 'hold'
export type SoldierVariant = 'melee' | 'ranged' | 'caster' | 'flyer' | 'titan' | 'hero' | 'healer' | 'siege' | 'transport'
export type BuildableKind = 'temple' | 'supplyHouse' | 'barracks' | 'techLab' | 'forge' | 'airForge' | 'fireplace' | 'turret'
/** damage/speed are ground-only (forge); airDamage/airSpeed apply to flyers (air forge). */
export type UpgradeKind = 'damage' | 'speed' | 'airDamage' | 'airSpeed'
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
  /** Last gathering assignment, so the worker can resume after repairs, builds, or node depletion. */
  lastResourceId?: string
  lastResourceKind?: ResourceKind
  buildSiteId?: string
  repairTargetId?: string
  attackTargetId?: string
  rallyPoint?: Vector3
  timer: number
  carrying: number
  carryingResource?: ResourceKind
  activeAnimation: string
  /** Lifetime enemy units this worker has finished off. */
  kills?: number
  /** Set while this worker rides inside a transport (it is parked off-map). */
  inTransportId?: string
  /** Obelisk haste aura (seconds remaining at +25% move speed). */
  hasteRemaining?: number
  /** Spore Plague damage-over-time (seconds remaining, damage rate, credit). */
  poisonRemaining?: number
  poisonDamagePerSecond?: number
  poisonAttackerId?: string
  poisonTick?: number
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
  stance: SoldierStance
  targetId?: string
  attackPosition?: Vector3
  rallyPoint?: Vector3
  /** Attack-move destination; the unit resumes marching here after clearing hostiles. */
  attackMovePoint?: Vector3
  /** Patrol route endpoints; the unit ping-pongs between them, engaging hostiles on the way. */
  patrolPointA?: Vector3
  patrolPointB?: Vector3
  /** True while walking toward patrolPointB, false toward patrolPointA. */
  patrolToB?: boolean
  /** Where a defensive unit returns to after a leash-limited chase. */
  guardPoint?: Vector3
  /** True when the current target was auto-acquired rather than player/AI ordered. */
  autoEngaged?: boolean
  attackTimer: number
  activeAnimation: string
  /** Lifetime enemy units this fighter has finished off. */
  kills?: number
  /** Caster signature ability cooldown (seconds until the next auto-cast). */
  abilityTimer?: number
  /** Healer variants: HP restored per second, current patient, and FX/scan tick. */
  healRate?: number
  healTargetId?: string
  healTimer?: number
  /** Siege variants: deployed (dug in) state, transform countdown with the
   * mode being transitioned into, and the AI's out-of-combat un-siege timer. */
  sieged?: boolean
  siegeTransition?: number
  siegeTargetMode?: boolean
  siegeIdleTimer?: number
  /** Transport variants: ids of the ground units riding inside. */
  cargo?: string[]
  /** Set while this unit rides inside a transport (it is parked off-map). */
  inTransportId?: string
  /** Hero active ability cooldown (seconds until the button is ready again). */
  heroAbilityCooldown?: number
  /** Time Fracture slow (seconds remaining at half move speed). */
  slowRemaining?: number
  /** Obelisk haste aura (seconds remaining at +25% move speed). */
  hasteRemaining?: number
  /** Spore Plague damage-over-time (seconds remaining, damage rate, credit). */
  poisonRemaining?: number
  poisonDamagePerSecond?: number
  poisonAttackerId?: string
  poisonTick?: number
}

export type ResourceNode = Selectable & {
  kind: 'resource'
  resource: ResourceKind
  amount: number
  /** Gold crystal / cryo plasma: workers haul 1.5x per trip. */
  rich?: boolean
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
  /** Tech tier gate: this building can only be placed once the team owns a completed building of this kind. */
  requires?: BuildableKind
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
  /** Healer variants: HP restored per second (beam per target, aura per ally in range). */
  healRate?: number
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
  /** Workers train at the HQ temple (Command Post / Nexus / Hive). */
  templeId: string
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
  /** Soldier variant of the primary selection, for portrait icons. */
  variant?: SoldierVariant
  /** Which resource a selected resource node yields, for portrait icons. */
  resourceKind?: ResourceKind
}
