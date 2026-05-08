import ReactEcs, { Button, Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  cancelBuildingPlacement,
  cancelSelectedConstruction,
  canCancelSelectedConstruction,
  gameState,
  getIdleWorkerCount,
  getSelectedSummary,
  getSoldierCount,
  getWorkerCount,
  placeMeatResource,
  moveSelectedBuilding,
  placeRockResource,
  placeTreeResource,
  printSelectedBuildingTransform,
  queueWorker,
  queueSoldier,
  resetRtsGame,
  scaleSelectedBuilding,
  selectAllLikeSelected,
  selectIdleWorker,
  setBarracksSpawnPoint,
  setWorkerSpawnPoint,
  startSoldierMoveCommand,
  startWorkerBuildingPlacement
} from './rtsGame'

const UI = {
  panel: Color4.create(0.04, 0.05, 0.08, 0.92),
  card: Color4.create(0.1, 0.12, 0.16, 0.95),
  accent: Color4.create(0.2, 0.6, 1, 1),
  gold: Color4.create(0.95, 0.75, 0.25, 1),
  green: Color4.create(0.2, 0.85, 0.35, 1),
  red: Color4.create(0.9, 0.25, 0.25, 1),
  text: Color4.create(0.96, 0.96, 0.98, 1),
  dim: Color4.create(0.65, 0.68, 0.75, 1)
}

const BUILDING_MOVE_STEP = 0.5
const BUILDING_HEIGHT_STEP = 0.25
const BUILDING_SCALE_STEP = 1.1

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
}

export const uiMenu = () => {
  const selected = getSelectedSummary()
  const isPlayerSelection = selected.team !== 'enemy'
  const hpText = selected.hp !== undefined && selected.maxHp !== undefined ? `HP ${selected.hp}/${selected.maxHp}` : ''
  const showBuildingTools = isPlayerSelection && hasBuildingTools(selected.kind)
  const showCancelBuild = isPlayerSelection && canCancelSelectedConstruction()
  const showCancelPlacement = gameState.placementMode === 'placing'

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 22, right: 22 },
          width: 300,
          height: 120,
          flexDirection: 'column',
          padding: { top: 12, bottom: 12, left: 16, right: 16 }
        }}
        uiBackground={{ color: UI.panel }}
      >
        <Label value={`Rocks: ${gameState.rocks}   Wood: ${gameState.wood}   Meat: ${gameState.meat}`} fontSize={20} color={UI.gold} textAlign="middle-right" />
        <Label value={`Supply: ${gameState.supplyUsed}/${gameState.supplyCap}`} fontSize={22} color={UI.green} textAlign="middle-right" />
        <UiEntity uiTransform={{ width: '100%', height: 24, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Label value={`Workers: ${getWorkerCount()}  `} fontSize={18} color={UI.text} textAlign="middle-right" />
          <Button
            value={`Idle: ${getIdleWorkerCount()}`}
            variant="primary"
            fontSize={14}
            uiTransform={{ width: 78, height: 24 }}
            uiBackground={{ color: UI.card }}
            onMouseDown={selectIdleWorker}
          />
          <Label value={`  Guards: ${getSoldierCount()}`} fontSize={18} color={UI.text} textAlign="middle-right" />
        </UiEntity>
        <Label
          value={`Placed Trees: ${gameState.savedTreeLocations.length}  Rocks: ${gameState.savedRockLocations.length}  Pigs: ${gameState.savedMeatLocations.length}`}
          fontSize={12}
          color={UI.dim}
          textAlign="middle-right"
        />
      </UiEntity>

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: 22, left: 610 },
          width: 700,
          height: 220,
          flexDirection: 'column',
          padding: { top: 14, bottom: 14, left: 16, right: 16 }
        }}
        uiBackground={{ color: UI.panel }}
      >
        <Label value={getCommandTitle(selected.kind)} fontSize={13} color={UI.dim} textAlign="middle-left" />
        <Label value={selected.name} fontSize={24} color={UI.text} textAlign="middle-left" />
        <Label value={hpText || selected.detail} fontSize={16} color={hpText ? UI.green : UI.dim} textAlign="middle-left" />
        {hpText ? <Label value={selected.detail} fontSize={14} color={UI.dim} textAlign="middle-left" /> : null}
        <Label value={gameState.status} fontSize={14} color={gameState.placementMode === 'placing' ? UI.gold : UI.dim} textAlign="middle-left" />

        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { top: 12 } }}>
          {showCancelPlacement ? actionButton('Cancel Placement', 'no cost spent', cancelBuildingPlacement, UI.red) : null}
          {isPlayerSelection && selected.kind === 'supplyHouse' ? actionButton('Create Worker', '50 meat', queueWorker, UI.accent) : null}
          {isPlayerSelection && selected.kind === 'supplyHouse' ? actionButton('Set Spawn', 'current position', setWorkerSpawnPoint, UI.card) : null}
          {isPlayerSelection && selected.kind === 'worker' ? actionButton('Build Temple', '150 rocks / 100 wood', () => startWorkerBuildingPlacement('temple'), UI.accent) : null}
          {isPlayerSelection && selected.kind === 'worker' ? actionButton('Build Homestead', '50 rocks', () => startWorkerBuildingPlacement('supplyHouse'), UI.gold) : null}
          {isPlayerSelection && selected.kind === 'worker' ? actionButton('Build Barracks', '100 rocks / 75 wood', () => startWorkerBuildingPlacement('barracks'), UI.green) : null}
          {isPlayerSelection && selected.kind === 'worker' ? actionButton('Build Fireplace', '25 rocks / 50 wood', () => startWorkerBuildingPlacement('fireplace'), UI.red) : null}
          {isPlayerSelection && selected.kind === 'worker' ? actionButton('Select All', 'workers', selectAllLikeSelected, UI.card) : null}
          {isPlayerSelection && selected.kind === 'barracks' ? actionButton('Create Gaurd', '100 rocks / 50 meat', queueSoldier, UI.green) : null}
          {isPlayerSelection && selected.kind === 'barracks' ? actionButton('Set Spawn', 'current position', setBarracksSpawnPoint, UI.card) : null}
          {showCancelBuild ? actionButton('Cancel Build', 'refund unbuilt cost', cancelSelectedConstruction, UI.red) : null}
          {isPlayerSelection && selected.kind === 'soldier' ? actionButton('Move', 'click ground', startSoldierMoveCommand, UI.accent) : null}
          {isPlayerSelection && selected.kind === 'soldier' ? actionButton('Select All', 'guards', selectAllLikeSelected, UI.card) : null}
          {selected.kind !== 'temple' && selected.kind !== 'worker' ? infoCard(getContextHint(selected.kind)) : null}
        </UiEntity>
      </UiEntity>

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: 22, right: 22 },
          width: 300,
          height: showBuildingTools ? 380 : 204,
          flexDirection: 'column',
          padding: { top: 12, bottom: 12, left: 12, right: 12 }
        }}
        uiBackground={{ color: UI.panel }}
      >
        <Label value="TOOLS" fontSize={12} color={UI.dim} textAlign="middle-left" />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { top: 8 } }}>
          {utilityButton('Place Tree', placeTreeResource, UI.green)}
          {utilityButton('Place Rock', placeRockResource, UI.card)}
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-start', margin: { top: 8 } }}>
          {utilityButton('Place Pig', placeMeatResource, UI.gold)}
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-end', margin: { top: 8 } }}>
          {utilityButton('Reset', resetRtsGame, UI.red)}
        </UiEntity>
        {showBuildingTools ? (
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: 10 } }}>
            <Label value="BUILDING TRANSFORM" fontSize={12} color={UI.dim} textAlign="middle-left" />
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { top: 6 } }}>
              {buildingToolButton('X -', () => moveSelectedBuilding(-BUILDING_MOVE_STEP, 0, 0), UI.card)}
              {buildingToolButton('X +', () => moveSelectedBuilding(BUILDING_MOVE_STEP, 0, 0), UI.card)}
              {buildingToolButton('Print', printSelectedBuildingTransform, UI.gold)}
            </UiEntity>
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { top: 6 } }}>
              {buildingToolButton('Z -', () => moveSelectedBuilding(0, 0, -BUILDING_MOVE_STEP), UI.card)}
              {buildingToolButton('Z +', () => moveSelectedBuilding(0, 0, BUILDING_MOVE_STEP), UI.card)}
              {buildingToolButton('Y +', () => moveSelectedBuilding(0, BUILDING_HEIGHT_STEP, 0), UI.green)}
            </UiEntity>
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { top: 6 } }}>
              {buildingToolButton('Y -', () => moveSelectedBuilding(0, -BUILDING_HEIGHT_STEP, 0), UI.card)}
              {buildingToolButton('Size +', () => scaleSelectedBuilding(BUILDING_SCALE_STEP), UI.green)}
              {buildingToolButton('Size -', () => scaleSelectedBuilding(1 / BUILDING_SCALE_STEP), UI.card)}
            </UiEntity>
          </UiEntity>
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

function getCommandTitle(kind: string): string {
  if (kind === 'temple') return 'TEMPLE'
  if (kind === 'worker') return 'WORKER'
  if (kind === 'resource') return 'RESOURCE'
  if (kind === 'supplyHouse') return 'HOMESTEAD'
  if (kind === 'barracks') return 'BARRACKS'
  if (kind === 'fireplace') return 'FIREPLACE'
  if (kind === 'soldier') return 'ANTROM GAURD'
  if (kind === 'enemyBuilding') return 'ENEMY'
  if (kind === 'none') return 'COMMANDS'
  return 'COMMANDS'
}

function hasBuildingTools(kind: string): boolean {
  return kind === 'temple' || kind === 'supplyHouse' || kind === 'barracks' || kind === 'fireplace'
}

function getContextHint(kind: string): string {
  if (kind === 'resource') return 'Select a worker, then click this resource.'
  if (kind === 'supplyHouse') return 'Homesteads create workers and increase your unit cap.'
  if (kind === 'barracks') return 'Create Antrom Gaurds here.'
  if (kind === 'fireplace') return 'A camp utility building.'
  if (kind === 'soldier') return 'Click an enemy building to attack.'
  if (kind === 'enemyBuilding') return 'Select an Antrom Gaurd, then click this building to attack.'
  return 'Select a Homestead to create workers, or a worker to build.'
}

function infoCard(text: string) {
  return (
    <UiEntity
      uiTransform={{ width: 160, height: 76, justifyContent: 'center', alignItems: 'center', padding: 8 }}
      uiBackground={{ color: UI.card }}
    >
      <Label value={text} fontSize={12} color={UI.dim} textAlign="middle-center" />
    </UiEntity>
  )
}

function actionButton(label: string, subLabel: string, onClick: () => void, color: Color4) {
  return (
    <UiEntity uiTransform={{ width: 140, height: 76, flexDirection: 'column' }}>
      <Button
        value={label}
        variant="primary"
        fontSize={14}
        uiTransform={{ width: 140, height: 44 }}
        uiBackground={{ color }}
        onMouseDown={onClick}
      />
      <Label value={subLabel} fontSize={11} color={UI.dim} textAlign="middle-center" />
    </UiEntity>
  )
}

function utilityButton(label: string, onClick: () => void, color: Color4) {
  return (
    <Button
      value={label}
      variant="primary"
      fontSize={13}
      uiTransform={{ width: 132, height: 42 }}
      uiBackground={{ color }}
      onMouseDown={onClick}
    />
  )
}

function buildingToolButton(label: string, onClick: () => void, color: Color4) {
  return (
    <Button
      value={label}
      variant="primary"
      fontSize={12}
      uiTransform={{ width: 84, height: 34 }}
      uiBackground={{ color }}
      onMouseDown={onClick}
    />
  )
}