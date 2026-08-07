import { AI_DIFFICULTY, CONFIG } from './config'
import { DEFAULT_MAP_ID } from './maps'
import type { BuildableKind, Difficulty, EnemyTeam, GameMode, PlacementState, RaceId, SelectableKind, Team } from './types'

export const ENEMY_TEAMS: EnemyTeam[] = ['enemy1', 'enemy2', 'enemy3', 'enemy4', 'enemy5']

export type TeamEconomy = {
  minerals: number
  gas: number
  supplyUsed: number
  supplyCap: number
  workerQueue: number
  soldierQueue: number
}

export type TeamStats = {
  unitsProduced: number
  unitsKilled: number
  resourcesGathered: number
}

/** One computer opponent slot on the match setup screen. */
export type OpponentSetup = {
  race: RaceId | 'random'
  difficulty: Difficulty
  /**
   * Team mode only: 1-based team number. Team 1 is the player's side; teams
   * 2-4 are enemy sides that also fight each other.
   */
  team: number
}

function createEconomy(): TeamEconomy {
  return {
    minerals: CONFIG.mineralsStart,
    gas: CONFIG.gasStart,
    supplyUsed: 0,
    supplyCap: CONFIG.startSupplyCap,
    workerQueue: 0,
    soldierQueue: 0
  }
}

function createStats(): TeamStats {
  return { unitsProduced: 0, unitsKilled: 0, resourcesGathered: 0 }
}

export const gameState = {
  playerRace: 'human' as RaceId,
  gameMode: 'team' as GameMode,
  // Battleground picked on the match setup screen (MP: synced via the lobby).
  selectedMapId: DEFAULT_MAP_ID,
  // Match setup chosen on the title screen: 1-5 computers, each with a race, difficulty and side.
  opponents: [{ race: 'random', difficulty: 'medium', team: 2 }] as OpponentSetup[],
  // Resolved at match start from `opponents` (random races rolled here).
  activeEnemyTeams: ['enemy1'] as EnemyTeam[],
  enemyRaces: { enemy1: 'alien', enemy2: 'alien', enemy3: 'alien', enemy4: 'alien', enemy5: 'alien' } as Record<EnemyTeam, RaceId>,
  enemyDifficulties: { enemy1: 'medium', enemy2: 'medium', enemy3: 'medium', enemy4: 'medium', enemy5: 'medium' } as Record<EnemyTeam, Difficulty>,
  // Alliance ids: teams sharing an id never fight each other. Team mode puts
  // allied computers on id 0 with the player; FFA gives every faction its own id.
  alliances: { player: 0, enemy1: 1, enemy2: 2, enemy3: 3, enemy4: 4, enemy5: 5 } as Record<Team, number>,
  // Which map anchor each active enemy team starts on (index into MAP_ANCHORS,
  // where anchor 0 is the classic SW player start). Single-player: allies get
  // anchors near the player, hostiles the far side. Multiplayer: lobby seats.
  enemySeatIndex: { enemy1: 1, enemy2: 2, enemy3: 3, enemy4: 4, enemy5: 5 } as Record<EnemyTeam, number>,
  economies: {
    player: createEconomy(),
    enemy1: createEconomy(),
    enemy2: createEconomy(),
    enemy3: createEconomy(),
    enemy4: createEconomy(),
    enemy5: createEconomy()
  } as Record<Team, TeamEconomy>,
  selectedId: '',
  selectedKind: '' as SelectableKind | '',
  selectedUnitIds: [] as string[],
  status: 'Select a worker, then click a crystal vein or plasma vent.',
  // StarCraft-style transient prompt: the status line fades out after a few seconds.
  statusTimer: 0,
  attackAlert: '',
  attackAlertTimer: 0,
  matchTime: 0,
  matchStatus: 'notStarted' as 'notStarted' | 'active' | 'ended',
  matchResult: 'none' as 'none' | 'win' | 'loss',
  matchStats: {
    player: createStats(),
    enemy1: createStats(),
    enemy2: createStats(),
    enemy3: createStats(),
    enemy4: createStats(),
    enemy5: createStats()
  } as Record<Team, TeamStats>,
  // Cumulative resources gathered, sampled every few seconds for the end-screen graph.
  incomeHistory: {
    player: [] as number[],
    enemy1: [] as number[],
    enemy2: [] as number[],
    enemy3: [] as number[],
    enemy4: [] as number[],
    enemy5: [] as number[]
  } as Record<Team, number[]>,
  placementMode: 'none' as PlacementState['state'],
  placementBuildingKind: '' as BuildableKind | '',
  currentPlayerLocation: '',
  savedMineralLocations: [] as string[],
  savedGasLocations: [] as string[]
}

/** Teams on different alliance ids fight; same id means allied (or self). */
export function areHostile(a: Team, b: Team): boolean {
  return gameState.alliances[a] !== gameState.alliances[b]
}

export function isHostileToPlayer(team: Team): boolean {
  return areHostile('player', team)
}

/** A computer fighting on the player's side (team mode). */
export function isPlayerAlly(team: Team): boolean {
  return team !== 'player' && !isHostileToPlayer(team)
}

/** Hard computers bank extra per delivery (classic RTS difficulty cheat). */
export function getGatherMultiplier(team: Team): number {
  if (team === 'player') return 1
  return AI_DIFFICULTY[gameState.enemyDifficulties[team]].gatherMultiplier
}

export function resetTeamEconomies(): void {
  for (const team of ['player', ...ENEMY_TEAMS] as Team[]) {
    gameState.economies[team] = createEconomy()
  }
}

export function resetTeamStats(): void {
  for (const team of ['player', ...ENEMY_TEAMS] as Team[]) {
    gameState.matchStats[team] = createStats()
    gameState.incomeHistory[team] = []
  }
}
