import { PlayerIdentityData, engine } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import {
  MAX_SEATS,
  PROTOCOL_VERSION,
  createDefaultLobbies,
  createDefaultSeat,
  type LobbyConfig,
  type LobbyRequest,
  type LobbySeat,
  type MatchCommand
} from '../rts/multiplayer/protocol'
import { MAPS } from '../rts/maps'
import { LOBBY_SYNC_ID, MpLobbyState, room } from '../rts/multiplayer/transport'

// DecentraCraft authoritative server. Runs headlessly alongside the world and
// owns everything the clients must agree on:
//   - the lobby rooms (seats, races, teams, ready flags, the leader of each)
//   - match starts (freezes a room's lobby, rolls its shared seed)
//   - the command relay (validates seat ownership, rebroadcasts in one
//     canonical order, scoped to the room so concurrent matches don't mix)

const lobbies: LobbyConfig[] = createDefaultLobbies()

/** Players currently in the scene (lowercase addresses). */
const present = new Set<string>()

export function startServer(): void {
  console.log('[Server] DecentraCraft authoritative server starting')

  const lobbyEntity = engine.addEntity()
  let revision = 0
  MpLobbyState.create(lobbyEntity, { json: JSON.stringify(lobbies), revision })
  syncEntity(lobbyEntity, [MpLobbyState.componentId], LOBBY_SYNC_ID)

  function publishLobbies(): void {
    revision += 1
    const state = MpLobbyState.getMutable(lobbyEntity)
    state.json = JSON.stringify(lobbies)
    state.revision = revision
  }

  function seatOf(lobby: LobbyConfig, address: string): LobbySeat | undefined {
    return lobby.seats.find((seat) => seat.kind === 'human' && seat.address === address)
  }

  function resetSeat(lobby: LobbyConfig, seat: LobbySeat): void {
    const index = lobby.seats.indexOf(seat)
    Object.assign(seat, createDefaultSeat(index))
  }

  /** Leader = earliest-seated human still present; re-pick when they leave. */
  function ensureLeader(lobby: LobbyConfig): boolean {
    if (lobby.hostAddress !== '' && seatOf(lobby, lobby.hostAddress)) return false
    const firstHuman = lobby.seats.find((seat) => seat.kind === 'human' && seat.address)
    lobby.hostAddress = firstHuman?.address ?? ''
    return true
  }

  function canStart(lobby: LobbyConfig): boolean {
    const active = lobby.seats.filter((seat) => seat.kind !== 'closed')
    const humans = active.filter((seat) => seat.kind === 'human')
    if (active.length < 2 || humans.length === 0) return false
    return humans.every((seat) => seat.ready && seat.address)
  }

  /** One seat per player across ALL rooms: claiming somewhere frees them everywhere else. */
  function evictFromOtherRooms(address: string, keep: LobbyConfig): boolean {
    let dirty = false
    for (const lobby of lobbies) {
      if (lobby === keep) continue
      const seat = seatOf(lobby, address)
      if (!seat) continue
      resetSeat(lobby, seat)
      ensureLeader(lobby)
      dirty = true
    }
    return dirty
  }

  // --- Presence: free seats when their owner leaves the scene ---------------
  engine.addSystem(() => {
    const inScene = new Set<string>()
    for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
      inScene.add(identity.address.toLowerCase())
    }

    let dirty = false
    for (const address of present) {
      if (inScene.has(address)) continue
      for (const lobby of lobbies) {
        const seat = seatOf(lobby, address)
        if (!seat) continue
        console.log(`[Server] room ${lobby.id}: freeing seat of departed player ${address}`)
        resetSeat(lobby, seat)
        dirty = true
      }
    }
    present.clear()
    for (const address of inScene) present.add(address)

    for (const lobby of lobbies) {
      // Every human participant left mid-match: reopen the room so the next
      // visitors aren't locked out by a match nobody is playing.
      if (lobby.phase === 'inMatch' && !lobby.seats.some((seat) => seat.kind === 'human')) {
        console.log(`[Server] room ${lobby.id}: all players left during a match; reopening`)
        lobby.phase = 'lobby'
        for (const seat of lobby.seats) seat.ready = false
        dirty = true
      }
      if (ensureLeader(lobby)) dirty = true
    }

    if (dirty) publishLobbies()
  })

  // --- Lobby requests --------------------------------------------------------
  room.onMessage('lobbyRequest', (data, context) => {
    if (!context) return
    const sender = context.from.toLowerCase()
    const lobby = lobbies[data.lobbyId]
    if (!lobby) return

    let request: LobbyRequest
    try {
      request = JSON.parse(data.json) as LobbyRequest
    } catch {
      return
    }

    const isLeader = sender !== '' && sender === lobby.hostAddress
    const mySeat = seatOf(lobby, sender)

    switch (request.type) {
      case 'claimSeat': {
        const target = lobby.seats[request.seat]
        if (!target || target.kind !== 'closed') return
        if (lobby.phase === 'inMatch') return
        if (mySeat) resetSeat(lobby, mySeat) // one seat per player in this room
        evictFromOtherRooms(sender, lobby) // ...and none anywhere else
        target.kind = 'human'
        target.address = sender
        target.name = request.name.slice(0, 24)
        target.ready = false
        break
      }
      case 'leaveSeat': {
        if (!mySeat) return
        resetSeat(lobby, mySeat)
        break
      }
      case 'setRace': {
        if (!mySeat) return
        mySeat.race = request.race
        break
      }
      case 'setAlliance': {
        if (!mySeat) return
        mySeat.allianceId = Math.max(0, Math.min(MAX_SEATS - 1, request.allianceId | 0))
        break
      }
      case 'setReady': {
        if (!mySeat) return
        mySeat.ready = request.ready
        break
      }
      case 'setSeat': {
        // Leader manages computer/closed seats; humans manage themselves.
        if (!isLeader) return
        const target = lobby.seats[request.seat]
        if (!target || target.kind === 'human') return
        const patch = request.patch
        if (patch.kind === 'human') return // humans join by claiming, never by patch
        Object.assign(target, patch, { address: undefined, name: undefined, ready: false })
        break
      }
      case 'setGameMode': {
        if (!isLeader) return
        lobby.gameMode = request.gameMode
        break
      }
      case 'setMap': {
        // Leader picks the battleground; reject ids not in the map registry.
        if (!isLeader || lobby.phase !== 'lobby') return
        if (!MAPS.some((map) => map.id === request.mapId)) return
        lobby.mapId = request.mapId
        break
      }
      case 'startMatch': {
        if (!isLeader || lobby.phase === 'inMatch' || !canStart(lobby)) return
        lobby.phase = 'inMatch'
        lobby.seed = Math.floor(Math.random() * 2 ** 31)
        publishLobbies()
        console.log(`[Server] room ${lobby.id}: match starting, seed ${lobby.seed}`)
        room.send('matchStart', { lobbyId: lobby.id, json: JSON.stringify(lobby) })
        return
      }
      case 'resetLobby': {
        // Any seated participant may reopen the room, not just the leader:
        // matches end client-side, and if only the host could reset, a host
        // lingering on the end screen would lock everyone else out.
        if (!isLeader && !mySeat) return
        lobby.phase = 'lobby'
        for (const seat of lobby.seats) seat.ready = false
        break
      }
      default:
        return
    }

    ensureLeader(lobby)
    publishLobbies()
  })

  // --- Match command relay ----------------------------------------------------
  room.onMessage('matchCommand', (data, context) => {
    if (!context) return
    const sender = context.from.toLowerCase()
    const lobby = lobbies[data.lobbyId]
    if (!lobby) return
    const seat = lobby.seats[data.seat]
    if (!seat || lobby.phase !== 'inMatch') return

    // A player may drive their own seat; the leader also drives computer seats.
    const ownSeat = seat.kind === 'human' && seat.address === sender
    const leaderDrivingCpu = seat.kind === 'computer' && sender === lobby.hostAddress
    if (!ownSeat && !leaderDrivingCpu) return

    // Sanity-parse so malformed payloads never reach clients.
    try {
      const command = JSON.parse(data.json) as MatchCommand
      if (typeof command.type !== 'string') return
    } catch {
      return
    }

    room.send('commandRelayed', { lobbyId: lobby.id, seat: data.seat, sender, json: data.json })
  })

  console.log(`[Server] ready (protocol v${PROTOCOL_VERSION}, ${lobbies.length} rooms)`)
}
