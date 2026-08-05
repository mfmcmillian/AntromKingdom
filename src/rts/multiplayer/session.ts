import { Schemas, engine } from '@dcl/sdk/ecs'
import { MessageBus } from '@dcl/sdk/message-bus'
import { isStateSyncronized, syncEntity } from '@dcl/sdk/network'
import { getPlayer, onEnterScene, onLeaveScene } from '@dcl/sdk/src/players'
import {
  BUS_TOPIC_LOBBY_REQUEST,
  BUS_TOPIC_MATCH_START,
  MAX_SEATS,
  PROTOCOL_VERSION,
  createDefaultLobby,
  createDefaultSeat,
  type LobbyConfig,
  type LobbyRequest,
  type LobbyRequestEnvelope,
  type LobbySeat,
  type MatchStartMessage
} from './protocol'
import type { Difficulty, GameMode, RaceId } from '../types'

// Multiplayer session: presence, host election and the shared lobby.
//
// The lobby lives in one synced component (JSON payload + revision counter).
// Only the host writes it; everyone else sends LobbyRequests over the bus and
// waits for the host to publish the result. The host is simply the lowest
// wallet address currently in the scene - if the host walks away, every
// remaining client re-runs the same election and the new lowest address
// takes over, so there is no negotiation round-trip.

const LOBBY_SYNC_ID = 5001

const MpLobbyState = engine.defineComponent('dc-mp-lobby-state', {
  json: Schemas.String,
  revision: Schemas.Int64
})

const bus = new MessageBus()

let lobby: LobbyConfig = createDefaultLobby()
let lobbyEntity = 0 as ReturnType<typeof engine.addEntity>
let lastSeenRevision = -1
let myAddress = ''
let myName = ''
const presentPlayers = new Map<string, string>() // address -> display name

type LobbyListener = (config: LobbyConfig) => void
type MatchStartListener = (config: LobbyConfig) => void
const lobbyListeners: LobbyListener[] = []
const matchStartListeners: MatchStartListener[] = []

let started = false

/** Call once at scene start (safe to call again; no-ops). */
export function initMultiplayerSession(): void {
  if (started) return
  started = true

  lobbyEntity = engine.addEntity()
  MpLobbyState.create(lobbyEntity, { json: JSON.stringify(lobby), revision: 0 })
  syncEntity(lobbyEntity, [MpLobbyState.componentId], LOBBY_SYNC_ID)

  onEnterScene((player) => {
    if (!player.userId) return
    presentPlayers.set(player.userId.toLowerCase(), player.name ?? shortAddress(player.userId))
    if (isHost()) hostSweepLobby()
  })

  onLeaveScene((userId) => {
    presentPlayers.delete(userId.toLowerCase())
    if (isHost()) hostSweepLobby()
  })

  bus.on(BUS_TOPIC_LOBBY_REQUEST, (data: LobbyRequestEnvelope) => {
    if (data.protocol !== PROTOCOL_VERSION) return
    if (!isHost()) return
    hostApplyRequest(data.request)
  })

  bus.on(BUS_TOPIC_MATCH_START, (data: MatchStartMessage) => {
    if (data.protocol !== PROTOCOL_VERSION) return
    if (data.sender.toLowerCase() === myAddress) return // host handled locally
    acceptMatchStart(data.config)
  })

  engine.addSystem(sessionSystem)
}

function sessionSystem(): void {
  // Resolve our own identity as soon as the runtime knows it.
  if (myAddress === '') {
    const me = getPlayer()
    if (me?.userId) {
      myAddress = me.userId.toLowerCase()
      myName = me.name ?? shortAddress(me.userId)
      presentPlayers.set(myAddress, myName)
    }
    return
  }

  if (!isStateSyncronized()) return

  // Pull remote lobby changes.
  const state = MpLobbyState.getOrNull(lobbyEntity)
  if (state && Number(state.revision) !== lastSeenRevision) {
    lastSeenRevision = Number(state.revision)
    try {
      const parsed = JSON.parse(state.json) as LobbyConfig
      if (parsed.version === PROTOCOL_VERSION) {
        lobby = parsed
        notifyLobbyChanged()
      }
    } catch {
      // Malformed payload from an incompatible client; keep our last state.
    }
  }

  // Host election: if the recorded host is gone (or nobody is host yet) and
  // we are the lowest address in the room, take over.
  const currentHost = lobby.hostAddress.toLowerCase()
  const hostPresent = currentHost !== '' && presentPlayers.has(currentHost)
  if (!hostPresent && lowestPresentAddress() === myAddress) {
    lobby.hostAddress = myAddress
    hostSweepLobby()
  }
}

// --- Read API ----------------------------------------------------------------

export function getLobby(): LobbyConfig {
  return lobby
}

export function getMyAddress(): string {
  return myAddress
}

export function isHost(): boolean {
  return myAddress !== '' && lobby.hostAddress.toLowerCase() === myAddress
}

export function getMySeatIndex(): number {
  return lobby.seats.findIndex((seat) => seat.kind === 'human' && seat.address?.toLowerCase() === myAddress)
}

export function getPresentPlayerCount(): number {
  return presentPlayers.size
}

export function onLobbyChanged(listener: LobbyListener): void {
  lobbyListeners.push(listener)
}

export function onMatchStart(listener: MatchStartListener): void {
  matchStartListeners.push(listener)
}

// --- Player actions (host applies directly, others request over the bus) -----

export function claimSeat(seatIndex: number): void {
  sendRequest({ type: 'claimSeat', seat: seatIndex, address: myAddress, name: myName })
}

export function leaveSeat(): void {
  sendRequest({ type: 'leaveSeat', address: myAddress })
}

export function setMyRace(race: RaceId | 'random'): void {
  sendRequest({ type: 'setRace', address: myAddress, race })
}

export function setMyAlliance(allianceId: number): void {
  sendRequest({ type: 'setAlliance', address: myAddress, allianceId })
}

export function setMyReady(ready: boolean): void {
  sendRequest({ type: 'setReady', address: myAddress, ready })
}

function sendRequest(request: LobbyRequest): void {
  if (isHost()) {
    hostApplyRequest(request)
    return
  }
  const envelope: LobbyRequestEnvelope = { protocol: PROTOCOL_VERSION, sender: myAddress, request }
  bus.emit(BUS_TOPIC_LOBBY_REQUEST, envelope)
}

// --- Host-only actions ---------------------------------------------------------

export function hostSetSeat(seatIndex: number, patch: Partial<LobbySeat>): void {
  if (!isHost() || seatIndex < 0 || seatIndex >= MAX_SEATS) return
  const seat = lobby.seats[seatIndex]
  // Turning a human seat into a computer/closed seat evicts the occupant.
  if (patch.kind && patch.kind !== 'human') {
    seat.address = undefined
    seat.name = undefined
    seat.ready = false
  }
  Object.assign(seat, patch)
  publishLobby()
}

export function hostSetGameMode(mode: GameMode): void {
  if (!isHost()) return
  lobby.gameMode = mode
  publishLobby()
}

export function hostSetSeatDifficulty(seatIndex: number, difficulty: Difficulty): void {
  hostSetSeat(seatIndex, { difficulty })
}

/** All humans seated and ready, at least two active seats, at least one human. */
export function canStartMatch(): boolean {
  const active = lobby.seats.filter((seat) => seat.kind !== 'closed')
  const humans = active.filter((seat) => seat.kind === 'human')
  if (active.length < 2 || humans.length === 0) return false
  return humans.every((seat) => seat.ready && seat.address)
}

export function hostStartMatch(): void {
  if (!isHost() || !canStartMatch()) return
  lobby.phase = 'inMatch'
  lobby.seed = Math.floor(Math.random() * 2 ** 31)
  publishLobby()
  const message: MatchStartMessage = { protocol: PROTOCOL_VERSION, sender: myAddress, config: lobby }
  bus.emit(BUS_TOPIC_MATCH_START, message)
  acceptMatchStart(lobby)
}

// --- Host internals -------------------------------------------------------------

function hostApplyRequest(request: LobbyRequest): void {
  const seats = lobby.seats
  const findByAddress = (address: string) =>
    seats.find((seat) => seat.kind === 'human' && seat.address?.toLowerCase() === address.toLowerCase())

  if (request.type === 'claimSeat') {
    const target = seats[request.seat]
    if (!target || target.kind === 'computer') return
    if (target.kind === 'human' && target.address) return // occupied
    // One seat per player: release any seat they already hold.
    const previous = findByAddress(request.address)
    if (previous) resetSeatToClosed(previous)
    target.kind = 'human'
    target.address = request.address.toLowerCase()
    target.name = request.name
    target.ready = false
  } else if (request.type === 'leaveSeat') {
    const seat = findByAddress(request.address)
    if (!seat) return
    resetSeatToClosed(seat)
  } else if (request.type === 'setRace') {
    const seat = findByAddress(request.address)
    if (!seat) return
    seat.race = request.race
  } else if (request.type === 'setAlliance') {
    const seat = findByAddress(request.address)
    if (!seat) return
    seat.allianceId = request.allianceId
  } else if (request.type === 'setReady') {
    const seat = findByAddress(request.address)
    if (!seat) return
    seat.ready = request.ready
  }

  publishLobby()
}

/** Frees seats held by players who left, keeps host address current. */
function hostSweepLobby(): void {
  let dirty = false
  for (const seat of lobby.seats) {
    if (seat.kind === 'human' && seat.address && !presentPlayers.has(seat.address)) {
      resetSeatToClosed(seat)
      dirty = true
    }
  }
  if (lobby.hostAddress.toLowerCase() !== myAddress) {
    lobby.hostAddress = myAddress
    dirty = true
  }
  if (dirty || lobby.revision === 0) publishLobby()
}

function resetSeatToClosed(seat: LobbySeat): void {
  const index = lobby.seats.indexOf(seat)
  Object.assign(seat, createDefaultSeat(index), { kind: 'closed' })
}

function publishLobby(): void {
  lobby.revision += 1
  lastSeenRevision = lobby.revision
  const state = MpLobbyState.getMutable(lobbyEntity)
  state.json = JSON.stringify(lobby)
  state.revision = BigInt(lobby.revision) as unknown as number
  notifyLobbyChanged()
}

function acceptMatchStart(config: LobbyConfig): void {
  lobby = config
  notifyLobbyChanged()
  for (const listener of matchStartListeners) listener(config)
}

function notifyLobbyChanged(): void {
  for (const listener of lobbyListeners) listener(lobby)
}

function lowestPresentAddress(): string {
  let lowest = ''
  for (const address of presentPlayers.keys()) {
    if (lowest === '' || address < lowest) lowest = address
  }
  return lowest
}

function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 6)}..${address.slice(-4)}` : address
}
