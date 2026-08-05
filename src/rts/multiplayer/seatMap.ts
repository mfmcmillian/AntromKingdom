import type { Difficulty, EnemyTeam, GameMode, RaceId, Team } from '../types'
import type { LobbyConfig } from './protocol'

// Translates a frozen lobby snapshot into the LOCAL view of the match. The
// engine is player-centric (Team = 'player' | 'enemy1..3'), so every client
// maps seats differently: your own seat is always 'player', and the other
// active seats fill enemy1..3 in seat order. Commands travel tagged with seat
// indexes and each client resolves them through this plan.

export type LocalMatchPlan = {
  mySeatIndex: number
  /** Active seat index -> local team on this client. */
  seatToTeam: Record<number, Team>
  /** Local team -> seat index. */
  teamToSeat: Partial<Record<Team, number>>
  races: Record<Team, RaceId>
  difficulties: Record<EnemyTeam, Difficulty>
  alliances: Record<Team, number>
  activeEnemyTeams: EnemyTeam[]
  /** Teams driven by humans on this client's view; their AI must be disabled. */
  humanTeams: Team[]
  gameMode: GameMode
  seed: number
}

const ENEMY_SLOTS: EnemyTeam[] = ['enemy1', 'enemy2', 'enemy3']
const RACES: RaceId[] = ['human', 'alien', 'bio']

/** Deterministic RNG so every client rolls identical "random" races. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildLocalMatchPlan(config: LobbyConfig, myAddress: string): LocalMatchPlan | undefined {
  const address = myAddress.toLowerCase()
  const activeSeats = config.seats
    .map((seat, index) => ({ seat, index }))
    .filter(({ seat }) => seat.kind !== 'closed')

  const mine = activeSeats.find(({ seat }) => seat.kind === 'human' && seat.address?.toLowerCase() === address)
  if (!mine) return undefined // spectator: no seat in this match

  const seatToTeam: Record<number, Team> = { [mine.index]: 'player' }
  const teamToSeat: Partial<Record<Team, number>> = { player: mine.index }
  const activeEnemyTeams: EnemyTeam[] = []

  let slot = 0
  for (const { index } of activeSeats) {
    if (index === mine.index) continue
    const team = ENEMY_SLOTS[slot]
    if (!team) break // more than 4 active seats can't happen (MAX_SEATS = 4)
    seatToTeam[index] = team
    teamToSeat[team] = index
    activeEnemyTeams.push(team)
    slot++
  }

  // Roll shared "random" races off the match seed so all clients agree.
  const races = {} as Record<Team, RaceId>
  const difficulties = { enemy1: 'medium', enemy2: 'medium', enemy3: 'medium' } as Record<EnemyTeam, Difficulty>
  const alliances = { player: 0, enemy1: 1, enemy2: 2, enemy3: 3 } as Record<Team, number>
  const humanTeams: Team[] = []

  for (const { seat, index } of activeSeats) {
    const team = seatToTeam[index]
    if (!team) continue
    const rng = mulberry32(config.seed + index * 7919)
    races[team] = seat.race === 'random' ? RACES[Math.floor(rng() * RACES.length)] : seat.race
    alliances[team] = seat.allianceId
    if (seat.kind === 'human') humanTeams.push(team)
    if (team !== 'player') difficulties[team as EnemyTeam] = seat.difficulty
  }

  return {
    mySeatIndex: mine.index,
    seatToTeam,
    teamToSeat,
    races,
    difficulties,
    alliances,
    activeEnemyTeams,
    humanTeams,
    gameMode: config.gameMode,
    seed: config.seed
  }
}
