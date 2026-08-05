import type { Difficulty, GameMode, RaceId } from '../types'

// Wire protocol for DecentraCraft multiplayer.
//
// Architecture: every client runs the full simulation (all four teams), and
// only COMMANDS travel over the network. Each command is tagged with the seat
// that issued it; each client translates the seat into its own local team
// (your seat is always 'player' locally, everyone else fills enemy1..3) and
// applies the command to its own sim. Computer seats are simulated by the
// host client, whose AI decisions are broadcast as ordinary commands so all
// sims stay in step at the command level.

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
  /** Wallet address of the current host (lowest address wins election). */
  hostAddress: string
  phase: 'lobby' | 'starting' | 'inMatch'
  gameMode: GameMode
  seats: LobbySeat[]
  /** Shared RNG seed rolled by the host at match start. */
  seed: number
  /** Increments on every host write so stale writes can be discarded. */
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
  unit: 'worker' | 'melee' | 'ranged' | 'caster' | 'flyer' | 'titan'
}

export type BuildCommand = {
  type: 'build'
  kind: string
  x: number
  z: number
  workerId: string
}

export type GatherCommand = {
  type: 'gather'
  workerIds: string[]
  nodeId: string
}

export type RepairCommand = {
  type: 'repair'
  workerIds: string[]
  buildingId: string
}

export type ResearchCommand = {
  type: 'research'
  buildingId: string
  upgrade: 'damage' | 'speed'
}

export type StanceCommand = {
  type: 'stance'
  unitIds: string[]
  stance: 'aggressive' | 'defensive' | 'hold'
}

export type RallyCommand = {
  type: 'rally'
  buildingId: string
  x: number
  z: number
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
  | RallyCommand

/** Envelope for every in-match message on the bus. */
export type CommandEnvelope = {
  protocol: number
  /** Seat index (0..3) whose team this command drives. */
  seat: number
  /** Sender wallet address; receivers drop their own echoes. */
  sender: string
  /** Monotonic per-sender sequence for ordering/debugging. */
  seq: number
  command: MatchCommand
}

// --- Bus topics --------------------------------------------------------------

export const BUS_TOPIC_COMMAND = 'dc-mp-cmd'
export const BUS_TOPIC_MATCH_START = 'dc-mp-start'
export const BUS_TOPIC_MATCH_ABORT = 'dc-mp-abort'
export const BUS_TOPIC_LOBBY_REQUEST = 'dc-mp-lobby-req'

// Non-host players never write the synced lobby directly (concurrent CRDT
// writes would clobber each other). They send requests; the host validates
// and publishes the new lobby state.
export type LobbyRequest =
  | { type: 'claimSeat'; seat: number; address: string; name: string }
  | { type: 'leaveSeat'; address: string }
  | { type: 'setRace'; address: string; race: RaceId | 'random' }
  | { type: 'setAlliance'; address: string; allianceId: number }
  | { type: 'setReady'; address: string; ready: boolean }

export type LobbyRequestEnvelope = {
  protocol: number
  sender: string
  request: LobbyRequest
}

export type MatchStartMessage = {
  protocol: number
  sender: string
  /** Full lobby snapshot frozen at start; every client builds the match from this. */
  config: LobbyConfig
}

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
