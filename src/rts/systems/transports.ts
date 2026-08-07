import { Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { distanceToPoint, getFormationPosition } from '../math'
import { isGroundWalkable } from '../maps'
import { TRANSPORT_CAPACITY } from '../races'
import type { Soldier, Worker } from '../types'
import { getTeam, soldiers, workers } from '../world'

// ---------------------------------------------------------------------------
// Transports: unarmed flying carriers that ferry ground units across the void
// on island maps (StarCraft dropship style). Boarding walks the unit to the
// carrier; riders are parked far off-map (invisible, untargetable, out of every
// distance scan) until the transport unloads them over solid ground.
// ---------------------------------------------------------------------------

type GroundUnit = Soldier | Worker

/** Riders wait here, far outside the playable area and everyone's weapon range. */
const PARKED_POSITION = Vector3.create(-80, -60, -80)
/** A unit this close to its carrier climbs aboard. */
const BOARD_RANGE = 3.5

export type TransportDeps = {
  setSoldierAnimation(soldier: Soldier, clipName: string, restart?: boolean): void
  setWorkerAnimation(worker: Worker, clipName: string, restart?: boolean): void
  /** Boarding removes the rider from the local selection / control surfaces. */
  onUnitBoarded(unit: GroundUnit): void
  setStatus(message: string): void
}

/** unit id -> transport id, for units currently walking to their carrier. */
const pendingBoards = new Map<string, string>()
/** Ground y per rider, captured at board time and restored on unload. */
const riderGroundY = new Map<string, number>()

export function isTransport(unit: GroundUnit): unit is Soldier {
  return unit.kind === 'soldier' && unit.variant === 'transport'
}

export function getTransportById(id: string): Soldier | undefined {
  const transport = soldiers.find((soldier) => soldier.id === id)
  return transport?.alive && transport.variant === 'transport' ? transport : undefined
}

export function getCargoCount(transport: Soldier): number {
  return transport.cargo?.length ?? 0
}

export function getCargoUnits(transport: Soldier): GroundUnit[] {
  const units: GroundUnit[] = []
  for (const id of transport.cargo ?? []) {
    const unit = soldiers.find((soldier) => soldier.id === id) ?? workers.find((worker) => worker.id === id)
    if (unit?.alive) units.push(unit)
  }
  return units
}

function isBoardable(unit: GroundUnit, transport: Soldier): boolean {
  if (!unit.alive || unit.inTransportId) return false
  if (unit.kind === 'soldier' && (unit.variant === 'flyer' || unit.variant === 'transport')) return false
  return getTeam(unit) === getTeam(transport)
}

/**
 * Send ground units to climb into a transport. Queues as many as still fit
 * (current cargo + everyone already walking over); the rest stay put.
 * Returns the units that were actually queued.
 */
export function orderBoardTransport(units: GroundUnit[], transport: Soldier, deps: TransportDeps, announce = true): GroundUnit[] {
  if (!transport.alive || transport.variant !== 'transport') return []

  let claimed = getCargoCount(transport)
  for (const id of pendingBoards.values()) if (id === transport.id) claimed++

  const queued: GroundUnit[] = []
  for (const unit of units) {
    if (!isBoardable(unit, transport)) continue
    if (claimed >= TRANSPORT_CAPACITY) break
    pendingBoards.set(unit.id, transport.id)
    steerTowardTransport(unit, transport, deps)
    claimed++
    queued.push(unit)
  }

  if (announce) {
    if (queued.length > 0) deps.setStatus(`${queued.length} unit${queued.length === 1 ? '' : 's'} boarding ${transport.name} (${claimed}/${TRANSPORT_CAPACITY}).`)
    else if (claimed >= TRANSPORT_CAPACITY) deps.setStatus(`${transport.name} is full (${TRANSPORT_CAPACITY} slots).`)
  }
  return queued
}

function steerTowardTransport(unit: GroundUnit, transport: Soldier, deps: TransportDeps): void {
  const destination = Transform.get(transport.entity).position
  unit.rallyPoint = { x: destination.x, y: Transform.get(unit.entity).position.y, z: destination.z }
  if (unit.kind === 'soldier') {
    unit.state = 'movingToRally'
    unit.targetId = undefined
    unit.attackPosition = undefined
    unit.attackMovePoint = undefined
    unit.patrolPointA = undefined
    unit.patrolPointB = undefined
    deps.setSoldierAnimation(unit, 'walk')
  } else {
    unit.state = 'movingToRally'
    unit.targetResourceId = undefined
    unit.buildSiteId = undefined
    unit.repairTargetId = undefined
    unit.attackTargetId = undefined
    deps.setWorkerAnimation(unit, 'walk')
  }
}

/** Per-frame: walk pending riders to their carrier and load them on arrival. */
export function updateTransportBoarding(deps: TransportDeps): void {
  if (pendingBoards.size === 0) return

  for (const [unitId, transportId] of [...pendingBoards]) {
    const unit = soldiers.find((soldier) => soldier.id === unitId) ?? workers.find((worker) => worker.id === unitId)
    const transport = getTransportById(transportId)

    if (!unit?.alive || !transport || unit.inTransportId) {
      pendingBoards.delete(unitId)
      continue
    }

    if (getCargoCount(transport) >= TRANSPORT_CAPACITY) {
      pendingBoards.delete(unitId)
      continue
    }

    const unitPosition = Transform.get(unit.entity).position
    const transportPosition = Transform.get(transport.entity).position

    if (distanceToPoint(unitPosition, transportPosition) <= BOARD_RANGE) {
      loadUnit(unit, transport, deps)
      continue
    }

    // Any new order (attack, gather, hold...) knocks the unit out of its
    // walk-to-carrier state and cancels the boarding.
    if (unit.state !== 'movingToRally' && unit.state !== 'idle') {
      pendingBoards.delete(unitId)
      continue
    }

    // Keep tracking the carrier: it may be moving.
    unit.state = 'movingToRally'
    unit.rallyPoint = { x: transportPosition.x, y: unitPosition.y, z: transportPosition.z }
  }
}

/** Instantly stow a unit inside the transport (arrival, or AI/remote command). */
export function loadUnit(unit: GroundUnit, transport: Soldier, deps: TransportDeps): void {
  if (!isBoardable(unit, transport) || getCargoCount(transport) >= TRANSPORT_CAPACITY) return

  pendingBoards.delete(unit.id)
  const transform = Transform.getMutable(unit.entity)
  riderGroundY.set(unit.id, transform.position.y)
  transform.position = Vector3.create(PARKED_POSITION.x, PARKED_POSITION.y, PARKED_POSITION.z)

  unit.inTransportId = transport.id
  unit.rallyPoint = undefined
  unit.state = 'idle'
  if (unit.kind === 'soldier') {
    unit.targetId = undefined
    unit.attackPosition = undefined
    unit.attackMovePoint = undefined
    unit.guardPoint = undefined
  }

  // Nobody keeps shooting at (or healing toward) a unit that just flew away.
  clearReferencesTo(unit.id)

  transport.cargo = transport.cargo ?? []
  transport.cargo.push(unit.id)
  deps.onUnitBoarded(unit)
}

/**
 * Drop every rider in a ring around the transport. Fails (false) unless the
 * carrier is hovering over solid ground.
 */
export function unloadTransport(transport: Soldier, deps: TransportDeps, announce = true): boolean {
  const cargo = getCargoUnits(transport)
  if (cargo.length === 0) return false

  const hover = Transform.get(transport.entity).position
  const center = findDropCenter(hover.x, hover.z)
  if (!center) {
    if (announce && getTeam(transport) === 'player') deps.setStatus(`${transport.name}: move over an island to unload.`)
    return false
  }

  cargo.forEach((unit, index) => {
    const slot = getFormationPosition(Vector3.create(center.x, hover.y, center.z), index, 2.4)
    const dropX = isGroundWalkable(slot.x, slot.z) ? slot.x : center.x
    const dropZ = isGroundWalkable(slot.x, slot.z) ? slot.z : center.z
    const transform = Transform.getMutable(unit.entity)
    transform.position = Vector3.create(dropX, riderGroundY.get(unit.id) ?? 0.25, dropZ)
    riderGroundY.delete(unit.id)

    unit.inTransportId = undefined
    unit.state = 'idle'
    unit.rallyPoint = undefined
    if (unit.kind === 'soldier') {
      unit.guardPoint = { x: dropX, y: transform.position.y, z: dropZ }
      deps.setSoldierAnimation(unit, 'idle')
    } else {
      deps.setWorkerAnimation(unit, 'idle')
    }
  })

  transport.cargo = []
  if (announce && getTeam(transport) === 'player') deps.setStatus(`${transport.name} unloaded ${cargo.length} unit${cargo.length === 1 ? '' : 's'}.`)
  return true
}

/**
 * Where to actually put the riders: the hover point itself if it is over
 * land, otherwise the nearest walkable spot within a few meters (covers small
 * position drift between multiplayer clients and sloppy AI hovering).
 */
function findDropCenter(x: number, z: number): { x: number; z: number } | undefined {
  if (isGroundWalkable(x, z)) return { x, z }
  for (let reach = 2; reach <= 8; reach += 2) {
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * Math.PI * 2
      const candidateX = x + Math.cos(angle) * reach
      const candidateZ = z + Math.sin(angle) * reach
      if (isGroundWalkable(candidateX, candidateZ)) return { x: candidateX, z: candidateZ }
    }
  }
  return undefined
}

/** Clear stale combat/heal references pointing at a unit that just boarded. */
function clearReferencesTo(unitId: string): void {
  for (const soldier of soldiers) {
    if (soldier.targetId === unitId) {
      soldier.targetId = undefined
      soldier.attackPosition = undefined
      if (soldier.state === 'movingToAttack' || soldier.state === 'attacking') soldier.state = 'idle'
    }
    if (soldier.healTargetId === unitId) soldier.healTargetId = undefined
  }
  for (const worker of workers) {
    if (worker.attackTargetId === unitId) {
      worker.attackTargetId = undefined
      if (worker.state === 'movingToAttack' || worker.state === 'attacking') worker.state = 'idle'
    }
  }
}

/** Match teardown: forget every pending walk and stored rider height. */
export function resetTransports(): void {
  pendingBoards.clear()
  riderGroundY.clear()
}
