import { PlayerIdentityData, engine } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { EnvVar, Storage } from '@dcl/sdk/server'
import {
  MAX_SEATS,
  PROTOCOL_VERSION,
  RANKED_START_RATING,
  createDefaultLobbies,
  createDefaultSeat,
  type LobbyConfig,
  type LobbyRequest,
  type LobbySeat,
  type MatchCommand,
  type RankedEntry,
  type RankedLadder,
  type RankedMatchSummary
} from '../rts/multiplayer/protocol'
import { MAPS } from '../rts/maps'
import { LOBBY_SYNC_ID, MpLobbyState, MpRankedState, RANKED_SYNC_ID, room } from '../rts/multiplayer/transport'

// DecentraCraft authoritative server. Runs headlessly alongside the world and
// owns everything the clients must agree on:
//   - the lobby rooms (seats, races, teams, ready flags, the leader of each)
//   - match starts (freezes a room's lobby, rolls its shared seed)
//   - the command relay (validates seat ownership, rebroadcasts in one
//     canonical order, scoped to the room so concurrent matches don't mix)
//   - the ranked ladder (Elo ratings persisted in world Storage, published to
//     clients and optionally pushed to the website leaderboard endpoint)

const lobbies: LobbyConfig[] = createDefaultLobbies()

/** Players currently in the scene (lowercase addresses). */
const present = new Set<string>()

// --- Ranked ladder state ------------------------------------------------------

const RANKED_STORAGE_KEY = 'ranked-ladder-v1'
const ELO_K = 32

/**
 * Website leaderboard endpoint (website/api/ladder.js on Vercel). The server
 * POSTs the ladder here after every rated match and can restore from it on
 * boot. EnvVar LEADERBOARD_PUSH_URL overrides it, but the env service only
 * exists for Worlds - this Genesis City LAND deploy relies on the default.
 */
const DEFAULT_LEADERBOARD_PUSH_URL = 'https://decentracraft-nine.vercel.app/api/ladder'

async function getLeaderboardPushUrl(): Promise<string> {
  try {
    return (await EnvVar.get('LEADERBOARD_PUSH_URL')) || DEFAULT_LEADERBOARD_PUSH_URL
  } catch {
    return DEFAULT_LEADERBOARD_PUSH_URL
  }
}

/** All rated players, keyed by lowercase wallet address. */
const rankedRatings = new Map<string, RankedEntry>()
let rankedLastMatch: RankedMatchSummary | undefined

/**
 * Human rosters frozen at ranked match start, keyed by room id. Presence
 * eviction frees seats when players leave mid-match, so results validate
 * against this snapshot instead of the live seats. Deleting a roster marks
 * the match as scored (one result per match).
 */
const rankedRosters = new Map<number, { address: string; name: string }[]>()

function eloExpected(rating: number, opponent: number): number {
  return 1 / (1 + Math.pow(10, (opponent - rating) / 400))
}

function getOrCreateRankedEntry(address: string, name: string): RankedEntry {
  let entry = rankedRatings.get(address)
  if (!entry) {
    entry = { address, name, rating: RANKED_START_RATING, wins: 0, losses: 0 }
    rankedRatings.set(address, entry)
  }
  if (name) entry.name = name
  return entry
}

function buildRankedLadder(): RankedLadder {
  const entries = [...rankedRatings.values()].sort((a, b) => b.rating - a.rating)
  return { entries, lastMatch: rankedLastMatch, updated: Date.now() }
}

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

  // --- Ranked ladder: load from Storage, publish to clients, push to the site --
  const rankedEntity = engine.addEntity()
  let rankedRevision = 0
  MpRankedState.create(rankedEntity, { json: JSON.stringify(buildRankedLadder()), revision: rankedRevision })
  syncEntity(rankedEntity, [MpRankedState.componentId], RANKED_SYNC_ID)

  function publishRankedLadder(): void {
    rankedRevision += 1
    const state = MpRankedState.getMutable(rankedEntity)
    state.json = JSON.stringify(buildRankedLadder())
    state.revision = rankedRevision
  }

  async function loadRankedLadder(): Promise<void> {
    // First choice: the Server Side Storage service (values JSON round-trip
    // automatically). Worlds have it; the Genesis City LAND deploy may not.
    try {
      const stored = await Storage.get<RankedLadder>(RANKED_STORAGE_KEY)
      if (stored) {
        applyLoadedLadder(stored, 'storage')
        return
      }
    } catch (error) {
      console.log(`[Server] ranked ladder storage load failed: ${error}`)
    }

    // Fallback: restore the last ladder the server pushed to the website
    // endpoint, so ratings survive restarts even without world Storage.
    try {
      const url = await getLeaderboardPushUrl()
      const response = await fetch(url)
      if (!response.ok) return
      applyLoadedLadder((await response.json()) as RankedLadder, 'website endpoint')
    } catch (error) {
      console.log(`[Server] ranked ladder endpoint load failed: ${error}`)
    }
  }

  function applyLoadedLadder(ladder: RankedLadder, source: string): void {
    for (const entry of ladder.entries ?? []) {
      if (entry.address) rankedRatings.set(entry.address, entry)
    }
    rankedLastMatch = ladder.lastMatch
    publishRankedLadder()
    console.log(`[Server] ranked ladder loaded from ${source}: ${rankedRatings.size} rated player(s)`)
  }
  void loadRankedLadder()

  /** Persist the ladder (best effort) and mirror it to the website endpoint. */
  function saveRankedLadder(): void {
    const ladder = buildRankedLadder()
    const json = JSON.stringify(ladder)
    try {
      Storage.set(RANKED_STORAGE_KEY, ladder).catch((error: unknown) => {
        console.log(`[Server] ranked ladder storage save failed: ${error}`)
      })
    } catch (error) {
      console.log(`[Server] ranked ladder storage save failed: ${error}`)
    }
    void (async () => {
      try {
        const url = await getLeaderboardPushUrl()
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json })
        console.log('[Server] ranked ladder pushed to website endpoint')
      } catch (error) {
        console.log(`[Server] ranked ladder website push failed: ${error}`)
      }
    })()
  }

  /**
   * Score a ranked free-for-all: the winner takes a pairwise Elo exchange
   * against every opponent in the frozen roster; opponents don't exchange
   * points among themselves (their finishing order is unknown).
   */
  function applyRankedResult(lobby: LobbyConfig, roster: { address: string; name: string }[], winnerAddress: string): void {
    const winnerSeat = roster.find((member) => member.address === winnerAddress)
    if (!winnerSeat) return
    const winner = getOrCreateRankedEntry(winnerSeat.address, winnerSeat.name)
    const deltas = new Map<string, number>([[winner.address, 0]])

    for (const member of roster) {
      if (member.address === winnerAddress) continue
      const loser = getOrCreateRankedEntry(member.address, member.name)
      const winnerGain = Math.round(ELO_K * (1 - eloExpected(winner.rating, loser.rating)))
      const loserLoss = Math.round(ELO_K * eloExpected(loser.rating, winner.rating))
      winner.rating += winnerGain
      loser.rating = Math.max(0, loser.rating - loserLoss)
      loser.losses += 1
      deltas.set(winner.address, (deltas.get(winner.address) ?? 0) + winnerGain)
      deltas.set(loser.address, -loserLoss)
    }
    winner.wins += 1

    rankedLastMatch = {
      winner: winner.address,
      deltas: [...deltas.entries()].map(([address, delta]) => ({ address, delta }))
    }
    rankedRosters.delete(lobby.id)
    publishRankedLadder()
    saveRankedLadder()
    console.log(`[Server] ranked result: ${winner.name} wins (${roster.length} players), new rating ${winner.rating}`)
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
    // Rated matches need at least two humans; AI wins mean nothing on a ladder.
    if (lobby.ranked && humans.length < 2) return false
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
        // Nobody is left to report an abandoned ranked match: void it.
        rankedRosters.delete(lobby.id)
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
        if (lobby.ranked) return // ranked is strict FFA: alliances stay locked to seats
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
        if (lobby.ranked) return // no computer seats on the ladder
        const target = lobby.seats[request.seat]
        if (!target || target.kind === 'human') return
        const patch = request.patch
        if (patch.kind === 'human') return // humans join by claiming, never by patch
        Object.assign(target, patch, { address: undefined, name: undefined, ready: false })
        break
      }
      case 'setGameMode': {
        if (!isLeader) return
        if (lobby.ranked) return // ranked mode is locked to FFA
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
        if (lobby.ranked) {
          // Freeze the human roster now: presence eviction may free seats
          // mid-match, but the result must still rate everyone who started.
          rankedRosters.set(
            lobby.id,
            lobby.seats
              .filter((seat): seat is LobbySeat & { address: string } => seat.kind === 'human' && !!seat.address)
              .map((seat) => ({ address: seat.address.toLowerCase(), name: seat.name ?? seat.address.slice(0, 8) }))
          )
        }
        publishLobbies()
        console.log(`[Server] room ${lobby.id}: match starting, seed ${lobby.seed}`)
        room.send('matchStart', { lobbyId: lobby.id, json: JSON.stringify(lobby) })
        return
      }
      case 'reportResult': {
        // Ranked only. The roster snapshot doubles as the "not yet scored"
        // flag, and both the reporter and the named winner must be on it -
        // so late duplicates and reports from spectators are all rejected.
        if (!lobby.ranked) return
        const roster = rankedRosters.get(lobby.id)
        if (!roster || !roster.some((member) => member.address === sender)) return
        applyRankedResult(lobby, roster, request.winnerAddress.toLowerCase())
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
