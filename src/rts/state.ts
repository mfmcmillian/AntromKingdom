import { CONFIG } from './config'
import type { BuildableKind, PlacementState, SelectableKind, UnitGroupKind } from './types'

export const gameState = {
  rocks: CONFIG.rocksStart,
  wood: CONFIG.woodStart,
  meat: CONFIG.meatStart,
  supplyUsed: 0,
  supplyCap: CONFIG.startSupplyCap,
  enemyRocks: CONFIG.rocksStart,
  enemyWood: CONFIG.woodStart,
  enemyMeat: CONFIG.meatStart,
  enemySupplyUsed: 0,
  enemySupplyCap: CONFIG.startSupplyCap,
  enemyWorkerQueue: 0,
  enemySoldierQueue: 0,
  selectedId: '',
  selectedKind: '' as SelectableKind | '',
  selectedGroupKind: '' as UnitGroupKind | '',
  status: 'Select a worker, then click a rock or tree.',
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
  savedTreeLocations: [] as string[],
  savedRockLocations: [] as string[],
  savedMeatLocations: [] as string[]
}
