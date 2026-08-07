import type { BuildableKind, Building, EnemyTeam, ResourceNode, Selectable, Soldier, Team, UnitProductionOrder, Worker, WorkerProductionOrder } from './types'

export const selectables = new Map<string, Selectable>()
export const workers: Worker[] = []
export const soldiers: Soldier[] = []
export const resources: ResourceNode[] = []
export const buildings: Building[] = []
export const workerProductionOrders: WorkerProductionOrder[] = []
export const soldierProductionOrders: UnitProductionOrder[] = []

let nextId = 1
const scopedCounters = new Map<string, number>()

export function createEntityId(kind: string): string {
  return `${kind}-${nextId++}`
}

/** Weapons shorter than this are close-quarters and cannot reach airborne units. */
const MIN_ANTI_AIR_RANGE = 4

/**
 * Flyers can only be hit by ranged weapons or titans (big enough to swat them):
 * melee fighters, close-combat heroes and workers can't touch them. Siege
 * artillery arcs along the ground and can't elevate; healers never attack.
 */
export function canAttackTarget(attacker: Soldier | Worker, target: Building | Soldier | Worker): boolean {
  if (attacker.kind === 'soldier' && (attacker.variant === 'healer' || attacker.variant === 'transport')) return false
  if (target.kind !== 'soldier' || (target.variant !== 'flyer' && target.variant !== 'transport')) return true
  if (attacker.kind !== 'soldier' || attacker.variant === 'siege') return false
  return attacker.variant === 'titan' || attacker.attackRange >= MIN_ANTI_AIR_RANGE
}

/**
 * Multiplayer ids: one counter per (scope, kind) instead of a global counter.
 * Clients create entities in different orders (each builds its own base first),
 * so a global counter would mint different ids for the same unit. Scoping by
 * owning seat keeps every team's sequence identical on all clients, which is
 * what lets relayed commands reference units by id.
 */
export function createScopedEntityId(scope: string, kind: string): string {
  const key = `${scope}/${kind}`
  const count = (scopedCounters.get(key) ?? 0) + 1
  scopedCounters.set(key, count)
  return `${scope}-${kind}-${count}`
}

export function resetWorld(): void {
  selectables.clear()
  workers.length = 0
  soldiers.length = 0
  resources.length = 0
  buildings.length = 0
  workerProductionOrders.length = 0
  soldierProductionOrders.length = 0
  nextId = 1
  scopedCounters.clear()
}

export function getTeam(selectable: Selectable): Team {
  return selectable.team ?? 'player'
}

export function isEnemyTeam(team: Team): team is EnemyTeam {
  return team !== 'player'
}

export function getTeamWorkerCount(team: Team): number {
  return workers.filter((worker) => worker.alive && getTeam(worker) === team).length
}

export function getTeamSoldierCount(team: Team): number {
  return soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === team).length
}

export function getAvailableWorkersForTeam(team: Team): Worker[] {
  return workers.filter(
    (worker) =>
      worker.alive &&
      getTeam(worker) === team &&
      worker.state !== 'movingToBuild' &&
      worker.state !== 'constructing' &&
      worker.state !== 'movingToRepair' &&
      worker.state !== 'repairing' &&
      worker.state !== 'movingToRally'
  )
}

export function getIdleWorkersForTeam(team: Team): Worker[] {
  return workers.filter((worker) => worker.alive && getTeam(worker) === team && worker.state === 'idle')
}

export function getTeamBuildings(team: Team, kind?: BuildableKind): Building[] {
  return buildings.filter((building) => building.alive && getTeam(building) === team && (!kind || building.kind === kind))
}

export function getCompletedTeamBuildings(team: Team, kind: BuildableKind): Building[] {
  return getTeamBuildings(team, kind).filter((building) => building.isComplete)
}
