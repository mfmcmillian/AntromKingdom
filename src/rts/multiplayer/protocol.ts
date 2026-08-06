import type { Difficulty, GameMode, RaceId } from '../types'

// Wire protocol for DecentraCraft multiplayer.
//
// Architecture: the DCL authoritative server owns the lobby and relays match
// commands. Clients never write shared state directly - they send requests,
// the server validates them (seat ownership, leader rights) and publishes the
// result. Each command is tagged with the seat that issued it; each client
// translates the seat into its own local team (your seat is always 'player'
// locally, everyone else fills enemy1..3) and applies the command to its sim.

/** Bump when the protocol changes shape; mismatched clients refuse to join. */
export const PROTOCOL_VERSION = 1

/** Maximum seats per match: one per engine team. */
export const MAX_SEATS = 4

export type SeatKind = 'human' | 'computer' | 'closed'

export type LobbySeat = {
  kind: SeatKind
  /** Wallet address of the human holding the seat (kind === 'human'). */
  address?: string
  /** Display name shown in the lobby. */
  name?: string
  race: RaceId | 'random'
  /** Computer seats only. */
  difficulty: Difficulty
  /** Seats sharing an alliance id fight together (humans and comps can mix). */
  allianceId: number
  /** Humans ready-up; computer and closed seats are always "ready". */
  ready: boolean
}

/** The whole lobby, serialized as JSON into the synced lobby component. */
export type LobbyConfig = {
  version: number
  /** Lobby leader (earliest-seated human): configures computer seats, starts the match. */
  hostAddress: string
  phase: 'lobby' | 'starting' | 'inMatch'
  gameMode: GameMode
  seats: LobbySeat[]
  /** Shared RNG seed rolled by the server at match start. */
  seed: number
  /** Increments on every server write so clients spot changes cheaply. */
  revision: number
}

// --- Match commands (MessageBus, fire-and-forget) ---------------------------

/** Orders a group of units to a map position. */
export type UnitOrderCommand = {
  type: 'move' | 'attackMove' | 'patrol' | 'stop' | 'hold'
  unitIds: string[]
  x: number
  z: number
  /** Patrol second waypoint. */
  x2?: number
  z2?: number
}

export type AttackTargetCommand = {
  type: 'attackTarget'
  unitIds: string[]
  targetId: string
}

export type TrainCommand = {
  type: 'train'
  buildingId: string
  unit: 'worker' | 'melee' | 'ranged' | 'healer' | 'caster' | 'flyer' | 'siege' | 'titan' | 'hero'
}

export type BuildCommand = {
  type: 'build'
  kind: string
  x: number
  z: number
  workerId: string
  /** Placement rotation in degrees (player can rotate the ghost with E). */
  rot?: number
}

export type GatherCommand = {
  type: 'gather'
  workerIds: string[]
  nodeId: string
}

export type RepairCommand = {
  type: 'repair'
  workerIds: string[]
  /** Repair target id: a building, or a mech fighter for human crews. */
  buildingId: string
}

export type ResearchCommand = {
  type: 'research'
  buildingId: string
  /** Ground tracks (forge) or air tracks (air forge). */
  upgrade: 'damage' | 'speed' | 'airDamage' | 'airSpeed'
}

export type StanceCommand = {
  type: 'stance'
  unitIds: string[]
  stance: 'defensive' | 'hold'
}

export type SiegeModeCommand = {
  type: 'siegeMode'
  unitIds: string[]
  /** true = dig in (deploy the cannon), false = pack up into mobile mode. */
  sieged: boolean
}

export type RallyCommand = {
  type: 'rally'
  buildingId: string
  x: number
  z: number
}

export type HeroAbilityCommand = {
  type: 'heroAbility'
  /** The casting hero's unit id. */
  unitId: string
}

/** The sender concedes: their whole team is eliminated on every client. */
export type SurrenderCommand = {
  type: 'surrender'
}

export type MatchCommand =
  | UnitOrderCommand
  | AttackTargetCommand
  | TrainCommand
  | BuildCommand
  | GatherCommand
  | RepairCommand
  | ResearchCommand
  | StanceCommand
  | SiegeModeCommand
  | RallyCommand
  | HeroAbilityCommand
  | SurrenderCommand

// Lobby requests: clients send these to the authoritative server, which
// validates them (sender identity comes from the transport, seat ownership
// and leader rights are checked server-side) and publishes the new lobby.
export type LobbyRequest =
  | { type: 'claimSeat'; seat: number; name: string }
  | { type: 'leaveSeat' }
  | { type: 'setRace'; race: RaceId | 'random' }
  | { type: 'setAlliance'; allianceId: number }
  | { type: 'setReady'; ready: boolean }
  // Leader-only from here down.
  | { type: 'setSeat'; seat: number; patch: Partial<LobbySeat> }
  | { type: 'setGameMode'; gameMode: GameMode }
  | { type: 'startMatch' }
  | { type: 'resetLobby' }

export function createDefaultSeat(index: number): LobbySeat {
  return {
    kind: 'closed',
    race: 'random',
    difficulty: 'medium',
    allianceId: index,
    ready: false
  }
}

export function createDefaultLobby(): LobbyConfig {
  return {
    version: PROTOCOL_VERSION,
    hostAddress: '',
    phase: 'lobby',
    gameMode: 'team',
    seats: [createDefaultSeat(0), createDefaultSeat(1), createDefaultSeat(2), createDefaultSeat(3)],
    seed: 0,
    revision: 0
  }
}
