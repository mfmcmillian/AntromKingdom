import { AvatarBase, PlayerIdentityData, engine } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { EnvVar, Storage } from '@dcl/sdk/server'
import {
  MAX_SEATS,
  PROTOCOL_VERSION,
  RANKED_START_RATING,
  createDefaultLobbies,
  createDefaultSeat,
  sanitizeGameName,
  emptyRaceRecords,
  emptyRankedRaceWins,
  type BoardEntry,
  type FrameId,
  type GameBoards,
  type LobbyConfig,
  type LobbyRequest,
  type LobbySeat,
  type MatchCommand,
  type PortraitId,
  type ProfileBook,
  type PublicProfile,
  type RankedEntry,
  type RankedLadder,
  type RankedMatchSummary
} from '../rts/multiplayer/protocol'
import { DEFAULT_MAP_ID, MAPS, getMapById } from '../rts/maps'
import { mulberry32 } from '../rts/multiplayer/seatMap'
import { FRAMES, PORTRAITS } from '../rts/profile'
import { campaignIdsForPortrait, fillSequentialCampaignIds } from '../rts/campaign'
import { BOARDS_SYNC_ID, LOBBY_SYNC_ID, MpBoardsState, MpLobbyState, MpProfilesState, MpRankedState, PROFILES_SYNC_ID, RANKED_SYNC_ID, room } from '../rts/multiplayer/transport'
import type { RaceId } from '../rts/types'

// DecentraCraft authoritative server. Runs headlessly alongside the world and
// owns everything the clients must agree on:
//   - the lobby rooms (seats, races, teams, ready flags, the leader of each)
//   - match starts (freezes a room's lobby, rolls its shared seed)
//   - the command relay (validates seat ownership, rebroadcasts in one
//     canonical order, scoped to the room so concurrent matches don't mix)
//   - the ranked ladder (Elo ratings persisted in world Storage, published to
//     clients and optionally pushed to the website leaderboard endpoint)
//   - campaign / skirmish boards (same persistence + website push)

const lobbies: LobbyConfig[] = createDefaultLobbies()

/** Players currently in the scene (lowercase addresses). */
const present = new Set<string>()
/** Completed campaign mission ids, keyed by lowercase wallet. */
const campaignByPlayer = new Map<string, string[]>()
const worldCampaign = new Map<string, string[]>()

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
const DEFAULT_BOARDS_PUSH_URL = 'https://decentracraft-nine.vercel.app/api/boards'
const DEFAULT_CAMPAIGN_PUSH_URL = 'https://decentracraft-nine.vercel.app/api/campaign'
/**
 * Join notices go through the website (website/api/join.js), which holds the
 * Discord webhook in a Vercel env var. This code is public; a webhook URL
 * committed here was scraped from GitHub and spammed.
 */
const DEFAULT_JOIN_RELAY_URL = 'https://decentracraft-nine.vercel.app/api/join'
const JOIN_NOTIFY_COOLDOWN_MS = 120000
const JOIN_NOTIFY_NAME_WAIT_S = 4
const BOARDS_STORAGE_KEY = 'leaderboards-v1'
const BOARD_CAP = 100
const SKIRMISH_REPORT_COOLDOWN_MS = 20000

async function getLeaderboardPushUrl(): Promise<string> {
  try {
    return (await EnvVar.get('LEADERBOARD_PUSH_URL')) || DEFAULT_LEADERBOARD_PUSH_URL
  } catch {
    return DEFAULT_LEADERBOARD_PUSH_URL
  }
}

async function getBoardsPushUrl(): Promise<string> {
  try {
    return (await EnvVar.get('BOARDS_PUSH_URL')) || DEFAULT_BOARDS_PUSH_URL
  } catch {
    return DEFAULT_BOARDS_PUSH_URL
  }
}

async function getCampaignPushUrl(): Promise<string> {
  try {
    return (await EnvVar.get('CAMPAIGN_PUSH_URL')) || DEFAULT_CAMPAIGN_PUSH_URL
  } catch {
    return DEFAULT_CAMPAIGN_PUSH_URL
  }
}

async function getJoinRelayUrl(): Promise<string> {
  try {
    return (await EnvVar.get('JOIN_RELAY_URL')) || DEFAULT_JOIN_RELAY_URL
  } catch {
    return DEFAULT_JOIN_RELAY_URL
  }
}

function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 6)}..${address.slice(-4)}` : address
}

function sanitizeDisplayName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') return fallback
  const trimmed = name.trim().slice(0, 24)
  return trimmed || fallback
}

function sanitizeCampaignIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const unique: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || unique.includes(id)) continue
    if (!/^(vanguard|aethyr|myriad)-\d+$/.test(id)) continue
    unique.push(id)
  }
  return unique.slice(0, 32)
}

function unionCampaignIds(...lists: Array<string[] | undefined>): string[] {
  const merged: string[] = []
  for (const list of lists) {
    if (!list) continue
    for (const id of list) {
      if (!merged.includes(id)) merged.push(id)
    }
  }
  return sanitizeCampaignIds(merged)
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
const rankedRosters = new Map<number, { address: string; name: string; race: RaceId }[]>()

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

  // --- Campaign / skirmish boards --------------------------------------------
  const displayNames = new Map<string, string>()
  const campaignBoard = new Map<string, BoardEntry>()
  const skirmishBoard = new Map<string, BoardEntry>()
  const lastSkirmishReport = new Map<string, number>()

  const boardsEntity = engine.addEntity()
  let boardsRevision = 0
  MpBoardsState.create(boardsEntity, { json: JSON.stringify(buildGameBoards()), revision: boardsRevision })
  syncEntity(boardsEntity, [MpBoardsState.componentId], BOARDS_SYNC_ID)

  function rememberDisplayName(address: string, name: string): void {
    const cleaned = sanitizeDisplayName(name, '')
    if (!cleaned) return
    if (cleaned.toLowerCase() === address.toLowerCase()) return
    if (/^0x[0-9a-f]/i.test(cleaned)) return
    displayNames.set(address, cleaned)
  }

  function nameFor(address: string): string {
    const rankedName = rankedRatings.get(address)?.name
    return (
      displayNames.get(address) ||
      campaignBoard.get(address)?.name ||
      skirmishBoard.get(address)?.name ||
      (rankedName && rankedName !== shortAddress(address) ? rankedName : '') ||
      shortAddress(address)
    )
  }

  function hasResolvedName(address: string): boolean {
    const name = nameFor(address)
    return !!name && name !== shortAddress(address) && name.toLowerCase() !== address.toLowerCase()
  }

  const joinNotifyAt = new Map<string, number>()
  const pendingJoinDiscord = new Map<string, number>()

  function queueDiscordJoin(address: string): void {
    const now = Date.now()
    if (now - (joinNotifyAt.get(address) ?? 0) < JOIN_NOTIFY_COOLDOWN_MS) return
    joinNotifyAt.set(address, now)
    if (hasResolvedName(address)) {
      postDiscordJoin(address)
      return
    }
    pendingJoinDiscord.set(address, 0)
  }

  function flushPendingDiscordJoins(dt: number): void {
    for (const [address, waited] of [...pendingJoinDiscord]) {
      const next = waited + dt
      if (hasResolvedName(address) || next >= JOIN_NOTIFY_NAME_WAIT_S) {
        pendingJoinDiscord.delete(address)
        postDiscordJoin(address)
      } else {
        pendingJoinDiscord.set(address, next)
      }
    }
  }

  function postDiscordJoin(address: string): void {
    const name = nameFor(address)
    const online = present.size
    void (async () => {
      try {
        const url = await getJoinRelayUrl()
        if (!url) return
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game: 'decentracraft', name, address, online })
        })
        if (!response.ok) console.log(`[Server] discord join notify failed: ${response.status}`)
      } catch (error) {
        console.log(`[Server] discord join notify failed: ${error}`)
      }
    })()
  }

  function sortBoard(entries: BoardEntry[]): BoardEntry[] {
    return entries
      .sort((a, b) => b.score - a.score || b.wins - a.wins || a.name.localeCompare(b.name))
      .slice(0, BOARD_CAP)
  }

  function buildGameBoards(): GameBoards {
    return {
      campaign: sortBoard([...campaignBoard.values()]),
      skirmish: sortBoard([...skirmishBoard.values()]),
      updated: Date.now()
    }
  }

  function publishBoards(): void {
    boardsRevision += 1
    const state = MpBoardsState.getMutable(boardsEntity)
    state.json = JSON.stringify(buildGameBoards())
    state.revision = boardsRevision
  }

  function sanitizeBoardEntries(raw: unknown): BoardEntry[] {
    if (!Array.isArray(raw)) return []
    const out: BoardEntry[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const row = item as Partial<BoardEntry>
      if (typeof row.address !== 'string' || !row.address) continue
      const address = row.address.toLowerCase()
      out.push({
        address,
        name: sanitizeDisplayName(row.name, shortAddress(address)),
        score: Math.max(0, Math.floor(Number(row.score) || 0)),
        wins: Math.max(0, Math.floor(Number(row.wins) || 0)),
        losses: Math.max(0, Math.floor(Number(row.losses) || 0))
      })
    }
    return out
  }

  function applyLoadedBoards(boards: GameBoards, source: string): void {
    for (const entry of sanitizeBoardEntries(boards.campaign)) {
      const existing = campaignBoard.get(entry.address)
      campaignBoard.set(entry.address, {
        address: entry.address,
        name: entry.name || existing?.name || shortAddress(entry.address),
        score: Math.max(existing?.score ?? 0, entry.score),
        wins: Math.max(existing?.wins ?? 0, entry.wins),
        losses: Math.max(existing?.losses ?? 0, entry.losses)
      })
      rememberDisplayName(entry.address, entry.name)
    }
    for (const entry of sanitizeBoardEntries(boards.skirmish)) {
      const existing = skirmishBoard.get(entry.address)
      skirmishBoard.set(entry.address, {
        address: entry.address,
        name: entry.name || existing?.name || shortAddress(entry.address),
        score: Math.max(existing?.score ?? 0, entry.score),
        wins: Math.max(existing?.wins ?? 0, entry.wins),
        losses: Math.max(existing?.losses ?? 0, entry.losses)
      })
      rememberDisplayName(entry.address, entry.name)
    }
    publishBoards()
    console.log(`[Server] boards loaded from ${source}: ${campaignBoard.size} campaign, ${skirmishBoard.size} skirmish`)
  }

  async function loadBoards(): Promise<void> {
    try {
      const stored = await Storage.get<GameBoards>(BOARDS_STORAGE_KEY)
      if (stored) applyLoadedBoards(stored, 'storage')
    } catch (error) {
      console.log(`[Server] boards storage load failed: ${error}`)
    }

    try {
      const url = await getBoardsPushUrl()
      const response = await fetch(url)
      if (response.ok) applyLoadedBoards((await response.json()) as GameBoards, 'website endpoint')
    } catch (error) {
      console.log(`[Server] boards endpoint load failed: ${error}`)
    }
  }
  void loadBoards()

  function saveBoards(): void {
    const boards = buildGameBoards()
    const json = JSON.stringify(boards)
    try {
      Storage.set(BOARDS_STORAGE_KEY, boards).catch((error: unknown) => {
        console.log(`[Server] boards storage save failed: ${error}`)
      })
    } catch (error) {
      console.log(`[Server] boards storage save failed: ${error}`)
    }
    void (async () => {
      try {
        const url = await getBoardsPushUrl()
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json })
        if (!response.ok) {
          console.log(`[Server] boards website push failed: HTTP ${response.status}`)
          return
        }
        console.log(`[Server] boards pushed to website endpoint (${boards.campaign.length} campaign, ${boards.skirmish.length} skirmish)`)
      } catch (error) {
        console.log(`[Server] boards website push failed: ${error}`)
      }
    })()
  }

  function upsertCampaignBoard(address: string, missions: number): void {
    const existing = campaignBoard.get(address)
    const score = Math.max(existing?.score ?? 0, missions)
    if (score <= 0) return
    const name = nameFor(address)
    campaignBoard.set(address, {
      address,
      name: name || existing?.name || shortAddress(address),
      score,
      wins: Math.max(existing?.wins ?? 0, missions),
      losses: existing?.losses ?? 0
    })
    publishBoards()
    saveBoards()
  }

  const PROFILES_STORAGE_KEY = 'profiles-v1'
  const publicProfiles = new Map<string, PublicProfile>()
  const profilesEntity = engine.addEntity()
  let profilesRevision = 0
  MpProfilesState.create(profilesEntity, { json: JSON.stringify(buildProfileBook()), revision: profilesRevision })
  syncEntity(profilesEntity, [MpProfilesState.componentId], PROFILES_SYNC_ID)

  function buildProfileBook(): ProfileBook {
    return { profiles: [...publicProfiles.values()], updated: Date.now() }
  }

  function publishProfiles(): void {
    profilesRevision += 1
    const state = MpProfilesState.getMutable(profilesEntity)
    state.json = JSON.stringify(buildProfileBook())
    state.revision = profilesRevision
  }

  function saveProfiles(): void {
    const book = buildProfileBook()
    try {
      Storage.set(PROFILES_STORAGE_KEY, book).catch((error: unknown) => {
        console.log(`[Server] profiles storage save failed: ${error}`)
      })
    } catch (error) {
      console.log(`[Server] profiles storage save failed: ${error}`)
    }
  }

  function getOrCreateProfile(address: string, name: string): PublicProfile {
    let profile = publicProfiles.get(address)
    if (!profile) {
      profile = {
        address,
        name: name || shortAddress(address),
        portrait: '',
        frame: 'iron',
        races: emptyRaceRecords(),
        rankedRaceWins: emptyRankedRaceWins(),
        manaTip: false
      }
      publicProfiles.set(address, profile)
    }
    if (!profile.rankedRaceWins) profile.rankedRaceWins = emptyRankedRaceWins()
    if (typeof profile.manaTip !== 'boolean') profile.manaTip = false
    if (name) profile.name = name.slice(0, 24)
    return profile
  }

  function isPortraitAllowed(address: string, portrait: PortraitId, profile: PublicProfile): boolean {
    const def = PORTRAITS.find((item) => item.id === portrait)
    if (!def) return false
    if (def.campaignAll) {
      return isRaceCampaignCleared(address, 'human') && isRaceCampaignCleared(address, 'alien') && isRaceCampaignCleared(address, 'bio')
    }
    if (def.manaTip) return profile.manaTip === true
    if (def.race) return isRaceCampaignCleared(address, def.race)
    return false
  }

  function isFrameAllowed(address: string, frame: FrameId, profile: PublicProfile): boolean {
    const def = FRAMES.find((item) => item.id === frame)
    if (!def) return false
    if (def.rankedAllRaces) {
      const wins = profile.rankedRaceWins ?? emptyRankedRaceWins()
      return (wins.human >= 1 && wins.alien >= 1 && wins.bio >= 1) || profile.sovereignLegacy === true
    }
    const rankedWins = rankedRatings.get(address)?.wins ?? 0
    return rankedWins >= def.wins
  }

  function applyCareerRace(address: string, race: RaceId, won: boolean, name: string): void {
    rememberDisplayName(address, name)
    const profile = getOrCreateProfile(address, nameFor(address))
    if (won) profile.races[race].wins += 1
    else profile.races[race].losses += 1
    publishProfiles()
    saveProfiles()
  }

  async function loadProfiles(): Promise<void> {
    try {
      const stored = await Storage.get<ProfileBook>(PROFILES_STORAGE_KEY)
      if (!stored || !Array.isArray(stored.profiles)) return
      for (const row of stored.profiles) {
        if (!row?.address) continue
        const address = row.address.toLowerCase()
        const name = sanitizeDisplayName(row.name, shortAddress(row.address))
        rememberDisplayName(address, name)
        publicProfiles.set(address, {
          address,
          name,
          portrait: PORTRAITS.some((portrait) => portrait.id === row.portrait) ? (row.portrait as PortraitId) : '',
          frame: FRAMES.some((frame) => frame.id === row.frame) ? (row.frame as FrameId) : 'iron',
          races: {
            human: { wins: Math.max(0, row.races?.human?.wins ?? 0), losses: Math.max(0, row.races?.human?.losses ?? 0) },
            alien: { wins: Math.max(0, row.races?.alien?.wins ?? 0), losses: Math.max(0, row.races?.alien?.losses ?? 0) },
            bio: { wins: Math.max(0, row.races?.bio?.wins ?? 0), losses: Math.max(0, row.races?.bio?.losses ?? 0) }
          },
          rankedRaceWins: {
            human: Math.max(0, row.rankedRaceWins?.human ?? 0),
            alien: Math.max(0, row.rankedRaceWins?.alien ?? 0),
            bio: Math.max(0, row.rankedRaceWins?.bio ?? 0)
          },
          manaTip: row.manaTip === true,
          sovereignLegacy: row.sovereignLegacy === true || row.frame === 'sovereign',
          campaignCompleted: Array.isArray(row.campaignCompleted) ? sanitizeCampaignIds(row.campaignCompleted) : undefined
        })
        const loadedMissions = sanitizeCampaignIds(row.campaignCompleted)
        if (loadedMissions.length > 0) campaignByPlayer.set(address, loadedMissions)
      }
      publishProfiles()
      console.log(`[Server] profiles loaded: ${publicProfiles.size}`)
    } catch (error) {
      console.log(`[Server] profiles storage load failed: ${error}`)
    }
  }

  function applySkirmishResult(address: string, won: boolean, name: string): void {
    rememberDisplayName(address, name)
    const existing = skirmishBoard.get(address) ?? {
      address,
      name: nameFor(address),
      score: 0,
      wins: 0,
      losses: 0
    }
    if (won) {
      existing.wins += 1
      existing.score = existing.wins
    } else {
      existing.losses += 1
    }
    existing.name = nameFor(address)
    skirmishBoard.set(address, existing)
    publishBoards()
    saveBoards()
    console.log(`[Server] skirmish ${won ? 'win' : 'loss'}: ${existing.name} now ${existing.wins}-${existing.losses}`)
  }

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
  function resolveSeatRace(lobby: LobbyConfig, seatIndex: number, race: LobbySeat['race']): RaceId {
    if (race !== 'random') return race
    const rng = mulberry32(lobby.seed + seatIndex * 7919)
    const races: RaceId[] = ['human', 'alien', 'bio']
    return races[Math.floor(rng() * races.length)]
  }

  function applyRankedResult(lobby: LobbyConfig, roster: { address: string; name: string; race: RaceId }[], winnerAddress: string): void {
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

    for (const member of roster) {
      if (member.address === winnerAddress) {
        const profile = getOrCreateProfile(member.address, member.name)
        profile.rankedRaceWins[member.race] += 1
      }
      applyCareerRace(member.address, member.race, member.address === winnerAddress, member.name)
    }

    rankedLastMatch = {
      winner: winner.address,
      deltas: [...deltas.entries()].map(([address, delta]) => ({ address, delta }))
    }
    rankedRosters.delete(lobby.id)
    lobby.phase = 'lobby'
    for (const seat of lobby.seats) seat.ready = false
    publishRankedLadder()
    saveRankedLadder()
    publishLobbies()
    console.log(`[Server] ranked result: ${winner.name} wins (${roster.length} players), new rating ${winner.rating}`)
  }

  function seatOf(lobby: LobbyConfig, address: string): LobbySeat | undefined {
    return lobby.seats.find((seat) => seat.kind === 'human' && seat.address === address)
  }

  function resetSeat(lobby: LobbyConfig, seat: LobbySeat): void {
    const index = lobby.seats.indexOf(seat)
    Object.assign(seat, createDefaultSeat(index))
  }

  /** When the last human leaves a custom game, wipe leftover computers so the slot is free again. */
  function dissolveEmptyCustomGame(lobby: LobbyConfig): void {
    if (lobby.ranked) return
    if (lobby.seats.some((seat) => seat.kind === 'human')) return
    for (let i = 0; i < lobby.seats.length; i++) {
      Object.assign(lobby.seats[i], createDefaultSeat(i))
    }
    lobby.phase = 'lobby'
    lobby.hostAddress = ''
    lobby.gameMode = 'team'
    lobby.mapId = DEFAULT_MAP_ID
    lobby.gameName = ''
    lobby.seed = 0
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
    if (active.length > getMapById(lobby.mapId).maxPlayers) return false
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
      dissolveEmptyCustomGame(lobby)
      dirty = true
    }
    return dirty
  }

  // --- Presence: free seats when their owner leaves the scene ---------------
  engine.addSystem((dt) => {
    const inScene = new Set<string>()
    for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
      const address = identity.address.toLowerCase()
      inScene.add(address)
      if (AvatarBase.has(entity)) {
        rememberDisplayName(address, AvatarBase.get(entity).name)
      }
    }

    let dirty = false
    for (const address of present) {
      if (inScene.has(address)) continue
      for (const lobby of lobbies) {
        const seat = seatOf(lobby, address)
        if (!seat) continue
        console.log(`[Server] room ${lobby.id}: freeing seat of departed player ${address}`)
        resetSeat(lobby, seat)
        dissolveEmptyCustomGame(lobby)
        dirty = true
      }
    }
    const previous = new Set(present)
    present.clear()
    for (const address of inScene) {
      present.add(address)
      if (!previous.has(address)) {
        pushCampaignOnArrive(address)
        queueDiscordJoin(address)
      }
    }
    flushPendingDiscordJoins(dt)

    for (const lobby of lobbies) {
      // Every human participant left mid-match: reopen the room so the next
      // visitors aren't locked out by a match nobody is playing.
      if (lobby.phase === 'inMatch' && !lobby.seats.some((seat) => seat.kind === 'human')) {
        console.log(`[Server] room ${lobby.id}: all players left during a match; reopening`)
        lobby.phase = 'lobby'
        for (const seat of lobby.seats) seat.ready = false
        // Nobody is left to report an abandoned ranked match: void it.
        rankedRosters.delete(lobby.id)
        dissolveEmptyCustomGame(lobby)
        dirty = true
      }
      if (ensureLeader(lobby)) dirty = true
      dissolveEmptyCustomGame(lobby)
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
        if (request.seat >= getMapById(lobby.mapId).maxPlayers) return
        if (lobby.phase === 'inMatch') return
        const becomingHost = !lobby.ranked && !lobby.seats.some((seat) => seat.kind === 'human')
        if (mySeat) resetSeat(lobby, mySeat) // one seat per player in this room
        evictFromOtherRooms(sender, lobby) // ...and none anywhere else
        target.kind = 'human'
        target.address = sender
        target.name = request.name.slice(0, 24)
        rememberDisplayName(sender, target.name)
        target.ready = false
        if (becomingHost) {
          const named = sanitizeGameName(request.gameName ?? '')
          lobby.gameName = named || `${target.name}'s Game`
        }
        break
      }
      case 'setGameName': {
        if (!isLeader || lobby.ranked || lobby.phase === 'inMatch') return
        const named = sanitizeGameName(request.name)
        if (named) lobby.gameName = named
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
        if (request.seat >= getMapById(lobby.mapId).maxPlayers) return
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
        const cap = getMapById(request.mapId).maxPlayers
        for (let i = cap; i < lobby.seats.length; i++) {
          if (lobby.seats[i].kind === 'human') resetSeat(lobby, lobby.seats[i])
          else Object.assign(lobby.seats[i], createDefaultSeat(i))
        }
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
              .map((seat, seatIndex) => ({ seat, seatIndex }))
              .filter((row): row is { seat: LobbySeat & { address: string }; seatIndex: number } => row.seat.kind === 'human' && !!row.seat.address)
              .map(({ seat, seatIndex }) => ({
                address: seat.address.toLowerCase(),
                name: seat.name ?? seat.address.slice(0, 8),
                race: resolveSeatRace(lobby, seatIndex, seat.race)
              }))
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
    dissolveEmptyCustomGame(lobby)
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

  // --- Campaign progress: world book + profile book (LAND-safe), player Storage optional --------
  const CAMPAIGN_PLAYER_KEY = 'campaign-v1'
  const CAMPAIGN_BOOK_KEY = 'campaign-players-v1'
  const campaignChain = new Map<string, Promise<void>>()

  function enqueueCampaign(address: string, work: () => Promise<void>): void {
    const previous = campaignChain.get(address) ?? Promise.resolve()
    const next = previous.then(work, work)
    campaignChain.set(
      address,
      next.catch((error: unknown) => {
        console.log(`[Server] campaign task failed for ${address}: ${error}`)
      })
    )
  }

  function inferredCampaign(address: string): string[] {
    const profile = publicProfiles.get(address)
    const ids: string[] = []
    if (profile?.sovereignLegacy) ids.push(...fillSequentialCampaignIds(24))
    ids.push(...campaignIdsForPortrait(profile?.portrait ?? ''))
    const boardScore = campaignBoard.get(address)?.score ?? 0
    if (boardScore > 0) ids.push(...fillSequentialCampaignIds(boardScore))
    return unionCampaignIds(ids)
  }

  function snapshotCampaign(address: string): string[] {
    return unionCampaignIds(
      campaignByPlayer.get(address),
      worldCampaign.get(address),
      publicProfiles.get(address)?.campaignCompleted,
      inferredCampaign(address)
    )
  }

  function saveCampaignBook(): void {
    const players: Record<string, string[]> = {}
    for (const [address, ids] of worldCampaign) {
      if (ids.length > 0) players[address] = ids
    }
    try {
      Storage.set(CAMPAIGN_BOOK_KEY, { players, updated: Date.now() }).catch((error: unknown) => {
        console.log(`[Server] campaign book storage save failed: ${error}`)
      })
    } catch (error) {
      console.log(`[Server] campaign book storage save failed: ${error}`)
    }
  }

  async function loadCampaignBook(): Promise<void> {
    try {
      const stored = await Storage.get<{ players?: Record<string, unknown> }>(CAMPAIGN_BOOK_KEY)
      if (!stored?.players) return
      for (const [address, ids] of Object.entries(stored.players)) {
        const completed = sanitizeCampaignIds(ids)
        if (completed.length === 0) continue
        const key = address.toLowerCase()
        worldCampaign.set(key, completed)
        campaignByPlayer.set(key, unionCampaignIds(campaignByPlayer.get(key), completed))
      }
      console.log(`[Server] campaign book loaded: ${worldCampaign.size} commanders`)
    } catch (error) {
      console.log(`[Server] campaign book storage load failed: ${error}`)
    }
  }

  function persistCampaignMirrors(address: string, completed: string[]): void {
    try {
      Storage.player.set(address, CAMPAIGN_PLAYER_KEY, { completed }).catch((error: unknown) => {
        console.log(`[Server] campaign storage save failed for ${address}: ${error}`)
      })
    } catch (error) {
      console.log(`[Server] campaign storage save failed for ${address}: ${error}`)
    }
    void (async () => {
      try {
        const url = await getCampaignPushUrl()
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, completed })
        })
        if (!response.ok) {
          console.log(`[Server] campaign website push failed for ${address}: HTTP ${response.status}`)
          return
        }
        console.log(`[Server] campaign pushed to website for ${address}: ${completed.length} missions`)
      } catch (error) {
        console.log(`[Server] campaign website push failed for ${address}: ${error}`)
      }
    })()
  }

  /** Write missions to the same world/profile path that already survives LAND. Never waits on player Storage. */
  function commitCampaign(address: string, extra?: string[]): string[] {
    const merged = unionCampaignIds(snapshotCampaign(address), extra)
    const previous = campaignByPlayer.get(address) ?? []
    const profile = getOrCreateProfile(address, nameFor(address))
    const alreadyStored =
      previous.length === merged.length &&
      merged.every((id) => previous.includes(id)) &&
      (profile.campaignCompleted?.length ?? 0) === merged.length &&
      merged.every((id) => (profile.campaignCompleted ?? []).includes(id)) &&
      (worldCampaign.get(address)?.length ?? 0) === merged.length
    campaignByPlayer.set(address, merged)
    worldCampaign.set(address, merged)
    profile.campaignCompleted = merged
    // Publish only on change: the client re-uploads when it sees a list missing
    // its local missions, so an unconditional echo here would ping-pong forever.
    if (alreadyStored) return merged
    publishCampaignProgress(address, merged, true)
    if (merged.length > 0) upsertCampaignBoard(address, merged.length)
    saveCampaignBook()
    publishProfiles()
    saveProfiles()
    persistCampaignMirrors(address, merged)
    return merged
  }

  function restoreWipedCampaigns(): void {
    const addresses = new Set<string>([...publicProfiles.keys(), ...campaignBoard.keys(), ...worldCampaign.keys()])
    for (const address of addresses) {
      const inferred = inferredCampaign(address)
      const current = snapshotCampaign(address)
      if (inferred.length === 0 && current.length === 0) continue
      const merged = unionCampaignIds(current, inferred)
      if (merged.length === 0) continue
      if (merged.length === current.length && merged.every((id) => current.includes(id)) && worldCampaign.get(address)?.length === merged.length) {
        continue
      }
      commitCampaign(address, merged)
      console.log(`[Server] restored campaign for ${address}: ${current.length} -> ${merged.length}`)
    }
  }

  function publishCampaignProgress(address: string, completed: string[], ready: boolean): void {
    room.send('campaignProgress', { address, json: JSON.stringify({ completed, ready }) })
  }

  function pushCampaignOnArrive(address: string): void {
    const immediate = snapshotCampaign(address)
    campaignByPlayer.set(address, immediate)
    publishCampaignProgress(address, immediate, true)
    enqueueCampaign(address, async () => {
      const read = await readStoredCampaign(address)
      const merged = unionCampaignIds(campaignByPlayer.get(address), read.completed, inferredCampaign(address))
      if (merged.length <= immediate.length) return
      commitCampaign(address, merged)
      console.log(`[Server] campaign arrived for ${address}: ${immediate.length} -> ${merged.length}`)
    })
  }

  async function readWebsiteCampaign(address: string): Promise<string[]> {
    try {
      const url = await getCampaignPushUrl()
      const response = await fetch(`${url}?address=${encodeURIComponent(address)}`)
      if (!response.ok) return []
      const body = (await response.json()) as { completed?: unknown }
      return sanitizeCampaignIds(body.completed)
    } catch {
      return []
    }
  }

  /** Best-effort recovery of older saves. Runs off the hot path; a hung player Storage only stalls this address's chain. */
  async function readStoredCampaign(address: string): Promise<{ completed: string[] }> {
    const fromSite = await readWebsiteCampaign(address)
    let fromPlayer: string[] = []
    try {
      const stored = await Storage.player.get<{ completed?: unknown }>(address, CAMPAIGN_PLAYER_KEY)
      fromPlayer = sanitizeCampaignIds(stored?.completed)
    } catch (error) {
      console.log(`[Server] campaign storage load failed for ${address}: ${error}`)
    }
    return { completed: unionCampaignIds(fromPlayer, fromSite, worldCampaign.get(address)) }
  }

  function loadCampaignProgress(address: string): string[] {
    const merged = snapshotCampaign(address)
    campaignByPlayer.set(address, merged)
    return merged
  }

  room.onMessage('campaignSave', (data, context) => {
    if (!context) return
    const sender = context.from.toLowerCase()
    if (!sender) return

    let incoming: string[] = []
    let incomingName = ''
    try {
      const parsed = JSON.parse(data.json) as { completed?: unknown; name?: unknown }
      incoming = sanitizeCampaignIds(parsed.completed)
      incomingName = sanitizeDisplayName(parsed.name, '')
    } catch {
      return
    }

    if (incomingName) rememberDisplayName(sender, incomingName)
    const merged = commitCampaign(sender, incoming)
    console.log(`[Server] campaign save ${sender}: ${merged.length} missions`)
  })

  const RACE_PREFIX: Record<RaceId, string> = { human: 'vanguard', alien: 'aethyr', bio: 'myriad' }

  function isRaceCampaignCleared(address: string, race: RaceId): boolean {
    const completed = campaignByPlayer.get(address) ?? []
    const prefix = RACE_PREFIX[race]
    for (let i = 1; i <= 8; i++) {
      if (!completed.includes(`${prefix}-${i}`)) return false
    }
    return true
  }

  // --- Skirmish + career race reports ----------------------------------------
  room.onMessage('scoreReport', (data, context) => {
    if (!context) return
    const sender = context.from.toLowerCase()
    if (!sender) return

    let type = ''
    let won = false
    let name = ''
    let race: RaceId | undefined
    try {
      const parsed = JSON.parse(data.json) as { type?: unknown; won?: unknown; name?: unknown; race?: unknown }
      if (parsed.type !== 'skirmish' && parsed.type !== 'career') return
      if (typeof parsed.won !== 'boolean') return
      type = parsed.type
      won = parsed.won
      name = sanitizeDisplayName(parsed.name, '')
      if (parsed.race === 'human' || parsed.race === 'alien' || parsed.race === 'bio') race = parsed.race
    } catch {
      return
    }

    const now = Date.now()
    const last = lastSkirmishReport.get(sender) ?? 0
    if (now - last < SKIRMISH_REPORT_COOLDOWN_MS) return
    lastSkirmishReport.set(sender, now)

    if (type === 'skirmish') {
      applySkirmishResult(sender, won, name)
      if (race) applyCareerRace(sender, race, won, name)
    } else if (type === 'career' && race) {
      applyCareerRace(sender, race, won, name)
    }
  })

  room.onMessage('profileUpdate', (data, context) => {
    if (!context) return
    const sender = context.from.toLowerCase()
    if (!sender) return

    let portrait: PortraitId | '' = ''
    let frame: FrameId = 'iron'
    let name = ''
    let incomingCompleted: string[] | undefined
    try {
      const parsed = JSON.parse(data.json) as { portrait?: unknown; frame?: unknown; name?: unknown; completed?: unknown }
      if (typeof parsed.portrait === 'string' && PORTRAITS.some((item) => item.id === parsed.portrait)) {
        portrait = parsed.portrait as PortraitId
      }
      if (typeof parsed.frame === 'string' && FRAMES.some((item) => item.id === parsed.frame)) {
        frame = parsed.frame as FrameId
      }
      name = sanitizeDisplayName(parsed.name, '')
      if (Array.isArray(parsed.completed)) incomingCompleted = sanitizeCampaignIds(parsed.completed)
    } catch {
      return
    }

    if (name) rememberDisplayName(sender, name)
    const isNewProfile = !publicProfiles.has(sender)
    if (incomingCompleted) commitCampaign(sender, incomingCompleted)
    else loadCampaignProgress(sender)
    const profile = getOrCreateProfile(sender, nameFor(sender))
    const beforePortrait = profile.portrait
    const beforeFrame = profile.frame
    const beforeName = profile.name
    const keepPortrait = portrait || profile.portrait
    if (keepPortrait && !isPortraitAllowed(sender, keepPortrait, profile)) {
      const restored = unionCampaignIds(campaignByPlayer.get(sender), inferredCampaign(sender), campaignIdsForPortrait(keepPortrait))
      if (restored.length > 0) commitCampaign(sender, restored)
    }
    if (portrait && isPortraitAllowed(sender, portrait, profile)) profile.portrait = portrait
    if (isFrameAllowed(sender, frame, profile)) profile.frame = frame
    // Republish only on change - an unconditional publish re-triggers every
    // client's profile pull, which answers with another profileUpdate: a loop.
    const changed = isNewProfile || profile.portrait !== beforePortrait || profile.frame !== beforeFrame || profile.name !== beforeName
    if (changed) {
      publishProfiles()
      saveProfiles()
    }
  })

  room.onMessage('manaTip', (_data, context) => {
    if (!context) return
    const sender = context.from.toLowerCase()
    if (!sender) return
    const profile = getOrCreateProfile(sender, nameFor(sender))
    if (profile.manaTip) return
    profile.manaTip = true
    publishProfiles()
    saveProfiles()
    console.log(`[Server] mana tip: ${profile.name} unlocked The Patron`)
  })

  void loadProfiles()
    .then(() => loadCampaignBook())
    .then(() => restoreWipedCampaigns())

  console.log(`[Server] ready (protocol v${PROTOCOL_VERSION}, ${lobbies.length} rooms)`)
}
