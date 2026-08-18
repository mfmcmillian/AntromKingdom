import { engine } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { getPlayer, onEnterScene, onLeaveScene } from '@dcl/sdk/src/players'
import {
  PROTOCOL_VERSION,
  RANKED_START_RATING,
  createDefaultLobbies,
  type GameBoards,
  type LobbyConfig,
  type LobbyRequest,
  type LobbySeat,
  type ProfileBook,
  type PublicProfile,
  type RankedEntry,
  type RankedLadder
} from './protocol'
import { MpBoardsState, MpLobbyState, MpProfilesState, MpRankedState, room } from './transport'
import { getMapById } from '../maps'
import { applyCampaignProgress, bindCampaignWallet, campaignIdsForPortrait, fillSequentialCampaignIds, getCampaignProgress, setCampaignPersistHook } from '../campaign'
import {
  applyRemoteUnlockFlags,
  areCosmeticSourcesReady,
  getEquippedFrameId,
  getEquippedPortraitId,
  hasSovereignLegacy,
  markCosmeticSourceReady,
  rememberedCampaignPortraits,
  restoreEquippedCosmetics,
  setProfilePublishHook
} from '../profile'
import type { Difficulty, GameMode, RaceId } from '../types'

// Client side of the multiplayer session. The authoritative server owns a set
// of lobby rooms so several matches can run at once; this module reads the
// synced room list, tracks which room the player is browsing/seated in, sends
// validated requests (claim seat, pick race, ready up...) scoped to that room
// and surfaces server events to the UI. The "host" is the room leader - the
// earliest-seated human - who manages computer seats and starts the match.

let lobbies: LobbyConfig[] = createDefaultLobbies()
let lastSeenRevision = -1
let rankedLadder: RankedLadder = { entries: [], updated: 0 }
let lastSeenRankedRevision = -1
let gameBoards: GameBoards = { campaign: [], skirmish: [], updated: 0 }
let lastSeenBoardsRevision = -1
let profileBook: ProfileBook = { profiles: [], updated: 0 }
let lastSeenProfilesRevision = -1
let myAddress = ''
let myName = ''
/** Room the lobby UI is inside (-1 = hub / join list). */
let viewedLobbyId = -1
const presentPlayers = new Map<string, string>() // address -> display name

type LobbyListener = (config: LobbyConfig) => void
type MatchStartListener = (config: LobbyConfig) => void
const lobbyListeners: LobbyListener[] = []
const matchStartListeners: MatchStartListener[] = []

let started = false
let sourceWait = 0
let campaignHydrated = false
let campaignSaveAllowed = false
let campaignHydrateWait = 0
let pendingCampaignPush:
  | { address: string; completed: string[]; ready: boolean }
  | undefined
const CAMPAIGN_HYDRATE_TIMEOUT_S = 10

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
      if (lobbies[config.id]) lobbies[config.id] = config
      notifyLobbyChanged(config)
      // Every client hears every room's start; listeners only launch a match
      // if the local player actually holds a seat in that room's config.
      for (const listener of matchStartListeners) listener(config)
    } catch {
      // Malformed payload; ignore.
    }
  })

  room.onMessage('campaignProgress', (data) => {
    try {
      const parsed = JSON.parse(data.json) as { completed?: unknown; ready?: unknown }
      if (!Array.isArray(parsed.completed)) return
      const incoming = parsed.completed.filter((id): id is string => typeof id === 'string')
      const ready = parsed.ready !== false
      applyServerCampaign(data.address, incoming, ready)
    } catch {
      // Malformed payload; ignore.
    }
  })

  setCampaignPersistHook(() => {
    sendCampaignSave()
  })

  setProfilePublishHook(() => {
    sendProfileUpdate()
  })

  engine.addSystem(sessionSystem)
}

function sessionSystem(dt: number): void {
  // Resolve our own identity as soon as the runtime knows it.
  if (myAddress === '') {
    const me = getPlayer()
    if (me?.userId) {
      myAddress = me.userId.toLowerCase()
      myName = me.name ?? shortAddress(me.userId)
      presentPlayers.set(myAddress, myName)
      bindCampaignWallet(myAddress)
      const recovered: string[] = []
      if (hasSovereignLegacy()) recovered.push(...fillSequentialCampaignIds(24))
      for (const portrait of rememberedCampaignPortraits()) {
        recovered.push(...campaignIdsForPortrait(portrait))
      }
      if (recovered.length > 0) applyCampaignProgress(recovered)
      if (pendingCampaignPush) {
        applyServerCampaign(pendingCampaignPush.address, pendingCampaignPush.completed, pendingCampaignPush.ready)
        pendingCampaignPush = undefined
      }
      if (me.isGuest) markCampaignHydrated()
      if (me.isGuest) markCosmeticSourceReady('profiles')
      tryPublishProfile()
    }
    return
  }

  if (!campaignHydrated) {
    campaignHydrateWait += dt
    if (campaignHydrateWait >= CAMPAIGN_HYDRATE_TIMEOUT_S) {
      console.log('[Client] campaign hydrate timed out; using local commander data')
      markCampaignHydrated()
    }
  }

  if (!isStateSyncronized()) return

  sourceWait += dt
  if (sourceWait > 12) {
    markCosmeticSourceReady('campaign')
    markCosmeticSourceReady('profiles')
    tryPublishProfile()
  }

  // Pull room-list updates published by the server.
  for (const [, state] of engine.getEntitiesWith(MpLobbyState)) {
    if (state.revision === lastSeenRevision) continue
    lastSeenRevision = state.revision
    try {
      const parsed = JSON.parse(state.json) as LobbyConfig[]
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].version === PROTOCOL_VERSION) {
        lobbies = parsed
        for (const config of lobbies) notifyLobbyChanged(config)
      }
    } catch {
      // Keep the last good state.
    }
  }

  // Pull ranked ladder updates published by the server.
  for (const [, state] of engine.getEntitiesWith(MpRankedState)) {
    if (state.revision === lastSeenRankedRevision) continue
    lastSeenRankedRevision = state.revision
    try {
      const parsed = JSON.parse(state.json) as RankedLadder
      if (Array.isArray(parsed.entries)) rankedLadder = parsed
    } catch {
      // Keep the last good ladder.
    }
  }

  // Pull campaign / skirmish boards published by the server.
  for (const [, state] of engine.getEntitiesWith(MpBoardsState)) {
    if (state.revision === lastSeenBoardsRevision) continue
    lastSeenBoardsRevision = state.revision
    try {
      const parsed = JSON.parse(state.json) as GameBoards
      if (Array.isArray(parsed.campaign) && Array.isArray(parsed.skirmish)) gameBoards = parsed
    } catch {
      // Keep the last good boards.
    }
  }

  for (const [, state] of engine.getEntitiesWith(MpProfilesState)) {
    if (state.revision === lastSeenProfilesRevision) continue
    lastSeenProfilesRevision = state.revision
    try {
      const parsed = JSON.parse(state.json) as ProfileBook
      if (Array.isArray(parsed.profiles)) {
        profileBook = parsed
        const mine = myAddress ? parsed.profiles.find((profile) => profile.address === myAddress) : undefined
        if (mine) {
          applyRemoteUnlockFlags({
            manaTip: mine.manaTip === true,
            rankedRaceWins: mine.rankedRaceWins,
            sovereignLegacy: mine.sovereignLegacy === true
          })
          restoreEquippedCosmetics(mine.portrait, mine.frame)
        }
        markCosmeticSourceReady('profiles')
        tryPublishProfile()
      }
    } catch {
      // Keep the last good profiles.
    }
  }
}

// --- Read API ----------------------------------------------------------------

/** Every lobby room, in room-id order. */
export function getLobbies(): LobbyConfig[] {
  return lobbies
}

/** The room the lobby UI is currently inside (falls back to room 0). */
export function getLobby(): LobbyConfig {
  return lobbies[viewedLobbyId] ?? lobbies[0]
}

/** Room id the UI is inside (-1 = hub / join list). */
export function getViewedLobbyId(): number {
  return viewedLobbyId
}

export function setViewedLobbyId(id: number): void {
  viewedLobbyId = id
}

/** Room id where I currently hold a seat, or -1. */
export function getMyLobbyId(): number {
  if (myAddress === '') return -1
  return lobbies.findIndex((lobby) => lobby.seats.some((seat) => seat.kind === 'human' && seat.address === myAddress))
}

export function getMyAddress(): string {
  return myAddress
}

export function getMyName(): string {
  return myName
}

/** Am I the leader of the viewed room (manages computer seats, starts the match)? */
export function isHost(): boolean {
  return myAddress !== '' && getLobby().hostAddress === myAddress
}

/** My seat index within the viewed room, or -1. */
export function getMySeatIndex(): number {
  return getLobby().seats.findIndex((seat) => seat.kind === 'human' && seat.address === myAddress)
}

export function getPresentPlayerCount(): number {
  return presentPlayers.size
}

/** Everyone currently in the world (address + display name), for the lobby roster. */
export function getPresentPlayers(): { address: string; name: string }[] {
  return [...presentPlayers.entries()]
    .map(([address, name]) => ({ address, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Is this wallet currently in the scene? Drives mid-match leaver detection. */
export function isPlayerPresent(address: string): boolean {
  return presentPlayers.has(address.toLowerCase())
}

// --- Ranked ladder -------------------------------------------------------------

/** The Elo ladder published by the server (rating-sorted). */
export function getRankedLadder(): RankedLadder {
  return rankedLadder
}

/** A player's ladder entry, or undefined if they've never finished a ranked match. */
export function getRankedEntry(address: string): RankedEntry | undefined {
  const key = address.toLowerCase()
  return rankedLadder.entries.find((entry) => entry.address === key)
}

/** My current rating (everyone starts at the baseline before their first match). */
export function getMyRankedRating(): number {
  return myAddress === '' ? RANKED_START_RATING : (getRankedEntry(myAddress)?.rating ?? RANKED_START_RATING)
}

/** Is this room the ranked ladder room? */
export function isRankedLobby(lobbyId: number): boolean {
  return lobbies[lobbyId]?.ranked === true
}

/**
 * Report a ranked result to the server. Called by the winning client when its
 * sim declares victory; the server validates against the frozen match roster
 * and only the first report per match counts.
 */
export function reportRankedResult(lobbyId: number, winnerAddress: string): void {
  if (myAddress === '' || lobbyId < 0) return
  room.send('lobbyRequest', { lobbyId, json: JSON.stringify({ type: 'reportResult', winnerAddress } satisfies LobbyRequest) })
}

// --- Campaign / skirmish boards ----------------------------------------------

/** Campaign and skirmish standings published by the server. */
export function getGameBoards(): GameBoards {
  return gameBoards
}

/**
 * Report a finished skirmish (not campaign, not multiplayer) so the
 * single-player board can count the win or loss. Guests with no wallet skip.
 */
export function reportSkirmishResult(won: boolean, race: RaceId): void {
  if (myAddress === '') return
  room.send('scoreReport', { json: JSON.stringify({ type: 'skirmish', won, race, name: myName }) })
}

/** Campaign, skirmish, or custom multiplayer: count a race win or loss. Ranked is scored server-side. */
export function reportCareerResult(race: RaceId, won: boolean): void {
  if (myAddress === '') return
  room.send('scoreReport', { json: JSON.stringify({ type: 'career', race, won, name: myName }) })
}

export function getPublicProfile(address: string): PublicProfile | undefined {
  const key = address.toLowerCase()
  return profileBook.profiles.find((profile) => profile.address === key)
}

function tryPublishProfile(): void {
  if (areCosmeticSourcesReady()) sendProfileUpdate()
}

function sendProfileUpdate(): void {
  if (myAddress === '') return
  if (!areCosmeticSourcesReady()) return
  const rankedWins = getRankedEntry(myAddress)?.wins ?? 0
  room.send('profileUpdate', {
    json: JSON.stringify({
      portrait: getEquippedPortraitId(),
      frame: getEquippedFrameId(rankedWins),
      name: myName
    })
  })
}

/** Tell the server this wallet finished a 100 MANA tip so The Patron can unlock. */
export function sendManaTip(): void {
  if (myAddress === '') return
  room.send('manaTip', { json: JSON.stringify({ ok: true }) })
}

export function onLobbyChanged(listener: LobbyListener): void {
  lobbyListeners.push(listener)
}

export function onMatchStart(listener: MatchStartListener): void {
  matchStartListeners.push(listener)
}

// --- Player actions (validated server-side, scoped to the viewed room) --------

export function claimSeat(seatIndex: number, gameName?: string): void {
  sendRequest({ type: 'claimSeat', seat: seatIndex, name: myName, gameName })
}

export function hostSetGameName(name: string): void {
  sendRequest({ type: 'setGameName', name })
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

export function hostSetMap(mapId: string): void {
  sendRequest({ type: 'setMap', mapId })
}

export function hostSetSeatDifficulty(seatIndex: number, difficulty: Difficulty): void {
  hostSetSeat(seatIndex, { difficulty })
}

export function hostStartMatch(): void {
  sendRequest({ type: 'startMatch' })
}

/** Reopen a room after a match. The server accepts this from any seated participant. */
export function requestLobbyReset(lobbyId?: number): void {
  if (lobbyId !== undefined) {
    if (myAddress === '' || lobbyId < 0) return
    room.send('lobbyRequest', { lobbyId, json: JSON.stringify({ type: 'resetLobby' } satisfies LobbyRequest) })
    return
  }
  sendRequest({ type: 'resetLobby' })
}

/** Client-side preview of the server's start check (drives the START button). */
export function canStartMatch(): boolean {
  const lobby = getLobby()
  const active = lobby.seats.filter((seat) => seat.kind !== 'closed')
  const humans = active.filter((seat) => seat.kind === 'human')
  if (active.length < 2 || humans.length === 0) return false
  if (active.length > getMapById(lobby.mapId).maxPlayers) return false
  if (lobby.ranked && humans.length < 2) return false
  return humans.every((seat) => seat.ready && seat.address)
}

function sendRequest(request: LobbyRequest): void {
  if (myAddress === '') return
  const lobbyId = viewedLobbyId >= 0 ? viewedLobbyId : getMyLobbyId()
  if (lobbyId < 0) return
  room.send('lobbyRequest', { lobbyId, json: JSON.stringify(request) })
}

function sendCampaignSave(): void {
  if (myAddress === '') return
  if (!campaignSaveAllowed) return
  room.send('campaignSave', { json: JSON.stringify({ completed: getCampaignProgress().completed, name: myName }) })
}

function applyServerCampaign(address: string, completed: string[], ready: boolean): void {
  if (myAddress === '') {
    pendingCampaignPush = { address, completed, ready }
    return
  }
  if (address !== myAddress) return
  applyCampaignProgress(completed)
  if (ready) markCampaignHydrated()
}

function markCampaignHydrated(): void {
  if (campaignHydrated) {
    sendCampaignSave()
    return
  }
  campaignHydrated = true
  campaignSaveAllowed = true
  markCosmeticSourceReady('campaign')
  sendCampaignSave()
  tryPublishProfile()
}

/** False until the server snapshot is merged (or hydrate times out). Campaign must not start before this. */
export function isCommanderDataReady(): boolean {
  return campaignHydrated
}

function notifyLobbyChanged(config: LobbyConfig): void {
  for (const listener of lobbyListeners) listener(config)
}

function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 6)}..${address.slice(-4)}` : address
}
