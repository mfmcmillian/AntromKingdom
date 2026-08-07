import { DEFAULT_MAP_ID } from '../maps'
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
export const PROTOCOL_VERSION = 4

/** Maximum seats per match: one per engine team. */
export const MAX_SEATS = 6

/** Concurrent lobby rooms per world: casual battle rooms plus the ranked room. */
export const LOBBY_ROOM_COUNT = 5

/** The last room is the ranked ladder: humans only, free-for-all, Elo rated. */
export const RANKED_ROOM_ID = LOBBY_ROOM_COUNT - 1

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

/** One lobby room, serialized (with its siblings) into the synced lobby component. */
export type LobbyConfig = {
  version: number
  /** Room index (0-based): every request and relayed command is scoped to one room. */
  id: number
  /** Lobby leader (earliest-seated human): configures computer seats, starts the match. */
  hostAddress: string
  phase: 'lobby' | 'starting' | 'inMatch'
  gameMode: GameMode
  /** Battleground everyone loads (see rts/maps.ts registry); leader picks it. */
  mapId: string
  /** Ranked ladder room: humans only, FFA locked, results feed the Elo ladder. */
  ranked: boolean
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
  unit: 'worker' | 'melee' | 'ranged' | 'healer' | 'caster' | 'flyer' | 'transport' | 'siege' | 'titan' | 'hero' | 'antiAir' | 'heavyAir'
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

export type LoadTransportCommand = {
  type: 'loadTransport'
  transportId: string
  unitIds: string[]
}

export type UnloadTransportCommand = {
  type: 'unloadTransport'
  transportId: string
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
  | LoadTransportCommand
  | UnloadTransportCommand
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
  | { type: 'setMap'; mapId: string }
  | { type: 'startMatch' }
  | { type: 'resetLobby' }
  // Ranked only: the winning client reports the result; the server checks the
  // reporter and the named winner both held seats when the match started.
  | { type: 'reportResult'; winnerAddress: string }

// --- Ranked ladder ------------------------------------------------------------

/** Everyone starts here; K-factor 32 keeps early placement swings meaningful. */
export const RANKED_START_RATING = 1200

export type RankedEntry = {
  /** Lowercase wallet address (stable identity across name changes). */
  address: string
  /** Latest display name seen in a ranked lobby. */
  name: string
  rating: number
  wins: number
  losses: number
}

/** Rating deltas from the most recent ranked match, for "+16" style badges. */
export type RankedMatchSummary = {
  winner: string
  deltas: { address: string; delta: number }[]
}

/** Published by the server (rating-sorted) after every ranked result. */
export type RankedLadder = {
  entries: RankedEntry[]
  lastMatch?: RankedMatchSummary
  /** Unix ms of the last update. */
  updated: number
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

export function createDefaultLobby(id: number): LobbyConfig {
  const ranked = id === RANKED_ROOM_ID
  return {
    version: PROTOCOL_VERSION,
    id,
    hostAddress: '',
    phase: 'lobby',
    // Ranked is always free-for-all so every result maps to one winner.
    gameMode: ranked ? 'ffa' : 'team',
    mapId: DEFAULT_MAP_ID,
    ranked,
    seats: [createDefaultSeat(0), createDefaultSeat(1), createDefaultSeat(2), createDefaultSeat(3), createDefaultSeat(4), createDefaultSeat(5)],
    seed: 0,
    revision: 0
  }
}

/** The full set of concurrent lobby rooms, in room-id order (ranked room last). */
export function createDefaultLobbies(): LobbyConfig[] {
  const lobbies: LobbyConfig[] = []
  for (let i = 0; i < LOBBY_ROOM_COUNT; i++) lobbies.push(createDefaultLobby(i))
  return lobbies
}

/** Display name for a room ("BATTLE ROOM 1"... plus the ranked ladder room). */
export function lobbyRoomName(id: number): string {
  return id === RANKED_ROOM_ID ? 'RANKED LADDER' : `BATTLE ROOM ${id + 1}`
}
