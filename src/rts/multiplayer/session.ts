import { engine } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { getPlayer, onEnterScene, onLeaveScene } from '@dcl/sdk/src/players'
import {
  PROTOCOL_VERSION,
  createDefaultLobby,
  type LobbyConfig,
  type LobbyRequest,
  type LobbySeat
} from './protocol'
import { MpLobbyState, room } from './transport'
import type { Difficulty, GameMode, RaceId } from '../types'

// Client side of the multiplayer session. The authoritative server owns the
// lobby; this module reads the synced lobby state, sends validated requests
// (claim seat, pick race, ready up...) and surfaces server events to the UI.
// The "host" here is the lobby leader - the earliest-seated human - who the
// server allows to manage computer seats and start the match.

let lobby: LobbyConfig = createDefaultLobby()
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

  onEnterScene((player) => {
    if (!player.userId) return
    presentPlayers.set(player.userId.toLowerCase(), player.name ?? shortAddress(player.userId))
  })

  onLeaveScene((userId) => {
    presentPlayers.delete(userId.toLowerCase())
  })

  room.onMessage('matchStart', (data) => {
    try {
      const config = JSON.parse(data.json) as LobbyConfig
      if (config.version !== PROTOCOL_VERSION) return
      lobby = config
      notifyLobbyChanged()
      for (const listener of matchStartListeners) listener(config)
    } catch {
      // Malformed payload; ignore.
    }
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

  // Pull lobby updates published by the server.
  for (const [, state] of engine.getEntitiesWith(MpLobbyState)) {
    if (state.revision === lastSeenRevision) continue
    lastSeenRevision = state.revision
    try {
      const parsed = JSON.parse(state.json) as LobbyConfig
      if (parsed.version === PROTOCOL_VERSION) {
        lobby = parsed
        notifyLobbyChanged()
      }
    } catch {
      // Keep the last good state.
    }
  }
}

// --- Read API ----------------------------------------------------------------

export function getLobby(): LobbyConfig {
  return lobby
}

export function getMyAddress(): string {
  return myAddress
}

/** Am I the lobby leader (manages computer seats, starts the match)? */
export function isHost(): boolean {
  return myAddress !== '' && lobby.hostAddress === myAddress
}

export function getMySeatIndex(): number {
  return lobby.seats.findIndex((seat) => seat.kind === 'human' && seat.address === myAddress)
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

// --- Player actions (validated server-side) -----------------------------------

export function claimSeat(seatIndex: number): void {
  sendRequest({ type: 'claimSeat', seat: seatIndex, name: myName })
}

export function leaveSeat(): void {
  sendRequest({ type: 'leaveSeat' })
}

export function setMyRace(race: RaceId | 'random'): void {
  sendRequest({ type: 'setRace', race })
}

export function setMyAlliance(allianceId: number): void {
  sendRequest({ type: 'setAlliance', allianceId })
}

export function setMyReady(ready: boolean): void {
  sendRequest({ type: 'setReady', ready })
}

// --- Leader actions (server rejects them from anyone else) ---------------------

export function hostSetSeat(seatIndex: number, patch: Partial<LobbySeat>): void {
  sendRequest({ type: 'setSeat', seat: seatIndex, patch })
}

export function hostSetGameMode(mode: GameMode): void {
  sendRequest({ type: 'setGameMode', gameMode: mode })
}

export function hostSetSeatDifficulty(seatIndex: number, difficulty: Difficulty): void {
  hostSetSeat(seatIndex, { difficulty })
}

export function hostStartMatch(): void {
  sendRequest({ type: 'startMatch' })
}

export function hostResetLobby(): void {
  if (!isHost()) return
  sendRequest({ type: 'resetLobby' })
}

/** Client-side preview of the server's start check (drives the START button). */
export function canStartMatch(): boolean {
  const active = lobby.seats.filter((seat) => seat.kind !== 'closed')
  const humans = active.filter((seat) => seat.kind === 'human')
  if (active.length < 2 || humans.length === 0) return false
  return humans.every((seat) => seat.ready && seat.address)
}

function sendRequest(request: LobbyRequest): void {
  if (myAddress === '') return
  room.send('lobbyRequest', { json: JSON.stringify(request) })
}

function notifyLobbyChanged(): void {
  for (const listener of lobbyListeners) listener(lobby)
}

function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 6)}..${address.slice(-4)}` : address
}
