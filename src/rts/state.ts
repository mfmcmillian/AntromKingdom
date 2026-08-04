import { CONFIG } from './config'
import type { BuildableKind, PlacementState, SelectableKind } from './types'

export const gameState = {
  minerals: CONFIG.mineralsStart,
  gas: CONFIG.gasStart,
  supplyUsed: 0,
  supplyCap: CONFIG.startSupplyCap,
  enemyMinerals: CONFIG.mineralsStart,
  enemyGas: CONFIG.gasStart,
  enemySupplyUsed: 0,
  enemySupplyCap: CONFIG.startSupplyCap,
  enemyWorkerQueue: 0,
  enemySoldierQueue: 0,
  selectedId: '',
  selectedKind: '' as SelectableKind | '',
  selectedUnitIds: [] as string[],
  status: 'Select a miner, then click a mineral field or gas geyser.',
  attackAlert: '',
  attackAlertTimer: 0,
  matchTime: 0,
  matchStatus: 'notStarted' as 'notStarted' | 'active' | 'ended',
  matchResult: 'none' as 'none' | 'win' | 'loss',
  matchStats: {
    player: {
      unitsProduced: 0,
      unitsKilled: 0,
      resourcesGathered: 0
    },
    enemy: {
      unitsProduced: 0,
      unitsKilled: 0,
      resourcesGathered: 0
    }
  },
  workerQueue: 0,
  soldierQueue: 0,
  placementMode: 'none' as PlacementState['state'],
  placementBuildingKind: '' as BuildableKind | '',
  currentPlayerLocation: '',
  savedMineralLocations: [] as string[],
  savedGasLocations: [] as string[]
}
