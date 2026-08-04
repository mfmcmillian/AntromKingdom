import { AI_DIFFICULTY, CONFIG } from './config'
import type { BuildableKind, Difficulty, EnemyTeam, GameMode, PlacementState, RaceId, SelectableKind, Team } from './types'

export const ENEMY_TEAMS: EnemyTeam[] = ['enemy1', 'enemy2', 'enemy3']

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
  /** Team mode only: this computer fights on the player's side. */
  ally: boolean
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
  // Match setup chosen on the title screen: 1-3 computers, each with a race, difficulty and side.
  opponents: [{ race: 'random', difficulty: 'medium', ally: false }] as OpponentSetup[],
  // Resolved at match start from `opponents` (random races rolled here).
  activeEnemyTeams: ['enemy1'] as EnemyTeam[],
  enemyRaces: { enemy1: 'alien', enemy2: 'alien', enemy3: 'alien' } as Record<EnemyTeam, RaceId>,
  enemyDifficulties: { enemy1: 'medium', enemy2: 'medium', enemy3: 'medium' } as Record<EnemyTeam, Difficulty>,
  // Alliance ids: teams sharing an id never fight each other. Team mode puts
  // allied computers on id 0 with the player; FFA gives every faction its own id.
  alliances: { player: 0, enemy1: 1, enemy2: 2, enemy3: 3 } as Record<Team, number>,
  // Which map seat each active computer starts on (index into COMPUTER_SEATS);
  // allies get seats near the player, hostiles the far side.
  enemySeatIndex: { enemy1: 0, enemy2: 1, enemy3: 2 } as Record<EnemyTeam, number>,
  economies: {
    player: createEconomy(),
    enemy1: createEconomy(),
    enemy2: createEconomy(),
    enemy3: createEconomy()
  } as Record<Team, TeamEconomy>,
  selectedId: '',
  selectedKind: '' as SelectableKind | '',
  selectedUnitIds: [] as string[],
  status: 'Select a miner, then click a mineral field or gas geyser.',
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
    enemy3: createStats()
  } as Record<Team, TeamStats>,
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
  }
}
