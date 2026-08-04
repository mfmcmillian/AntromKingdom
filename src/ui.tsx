import ReactEcs, { Button, Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  cancelBuildingPlacement,
  cancelSelectedConstruction,
  canCancelSelectedConstruction,
  endRtsMatch,
  gameState,
  getIdleWorkerCount,
  getSelectedSummary,
  queueWorker,
  queueSoldier,
  resetRtsGame,
  selectAllLikeSelected,
  selectIdleWorker,
  setBarracksSpawnPoint,
  setWorkerSpawnPoint,
  startRtsMatch,
  startSoldierAttackCommand,
  startSoldierMoveCommand,
  startWorkerBuildingPlacement
} from './rtsGame'
import { getDragScreenRect } from './rts/dragSelect'
import { minimapPanel } from './rts/minimap'
import { isTopDownViewActive, toggleTopDownView } from './rts/topDownCamera'

const UI = {
  panel: Color4.create(0.04, 0.05, 0.08, 0.92),
  panelStrong: Color4.create(0.025, 0.03, 0.045, 0.96),
  card: Color4.create(0.1, 0.12, 0.16, 0.95),
  cardSoft: Color4.create(0.075, 0.085, 0.11, 0.92),
  accent: Color4.create(0.2, 0.6, 1, 1),
  gold: Color4.create(0.95, 0.75, 0.25, 1),
  green: Color4.create(0.2, 0.85, 0.35, 1),
  red: Color4.create(0.9, 0.25, 0.25, 1),
  text: Color4.create(0.96, 0.96, 0.98, 1),
  dim: Color4.create(0.65, 0.68, 0.75, 1)
}

let showSettingsMenu = false

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
}

export const uiMenu = () => {
  const selected = getSelectedSummary()
  const isPlayerSelection = selected.team !== 'enemy'
  const hpText = selected.hp !== undefined && selected.maxHp !== undefined ? `HP ${selected.hp}/${selected.maxHp}` : ''
  const showCancelBuild = isPlayerSelection && canCancelSelectedConstruction()
  const showCancelPlacement = gameState.placementMode === 'placing'

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      {gameState.matchStatus === 'active' ? topResourceStrip() : null}
      {gameState.matchStatus === 'active' ? idleWorkerButton() : null}

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 28, left: 610 },
          width: 700,
          height: 56,
          display: gameState.attackAlert ? 'flex' : 'none',
          justifyContent: 'center',
          alignItems: 'center'
        }}
        uiBackground={{ color: Color4.create(0.12, 0.02, 0.02, 0.9) }}
      >
        <Label
          value={gameState.attackAlert}
          fontSize={30}
          color={UI.red}
          textAlign="middle-center"
          uiTransform={{
            width: '100%',
            height: '100%'
          }}
        />
      </UiEntity>

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: 22, left: 500 },
          width: 920,
          height: 236,
          flexDirection: 'column',
          padding: { top: 16, bottom: 16, left: 18, right: 18 }
        }}
        uiBackground={{ color: UI.panel }}
      >
        <UiEntity uiTransform={{ width: '100%', height: 58, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <UiEntity uiTransform={{ width: 580, height: '100%', flexDirection: 'column' }}>
            <Label value={getCommandTitle(selected.kind)} fontSize={13} color={UI.dim} textAlign="middle-left" />
            <Label value={selected.name} fontSize={26} color={UI.text} textAlign="middle-left" />
          </UiEntity>
          <UiEntity uiTransform={{ width: 280, height: '100%', flexDirection: 'column', alignItems: 'flex-end' }}>
            <Label value={hpText || selected.detail} fontSize={17} color={hpText ? UI.green : UI.dim} textAlign="middle-right" />
            {hpText ? <Label value={selected.detail} fontSize={13} color={UI.dim} textAlign="middle-right" /> : null}
          </UiEntity>
        </UiEntity>

        <UiEntity
          uiTransform={{ width: '100%', height: 30, justifyContent: 'center', padding: { left: 10, right: 10 }, margin: { top: 8 } }}
          uiBackground={{ color: UI.panelStrong }}
        >
          <Label value={gameState.status} fontSize={14} color={gameState.placementMode === 'placing' ? UI.gold : UI.dim} textAlign="middle-left" />
        </UiEntity>

        <UiEntity uiTransform={{ width: '100%', height: 106, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', margin: { top: 14 } }}>
          {showCancelPlacement ? actionButton('Cancel Placement', 'no cost spent', cancelBuildingPlacement, UI.red) : null}
          {isPlayerSelection && selected.kind === 'supplyHouse' ? actionButton('Create Miner', '50 plasma', queueWorker, UI.accent) : null}
          {isPlayerSelection && selected.kind === 'supplyHouse' ? actionButton('Set Spawn', 'current position', setWorkerSpawnPoint, UI.card) : null}
          {isPlayerSelection && selected.kind === 'worker' ? actionButton('Build Temple', '150 ore / 100 crystal', () => startWorkerBuildingPlacement('temple'), UI.accent) : null}
          {isPlayerSelection && selected.kind === 'worker' ? actionButton('Build Homestead', '50 ore', () => startWorkerBuildingPlacement('supplyHouse'), UI.gold) : null}
          {isPlayerSelection && selected.kind === 'worker' ? actionButton('Build Barracks', '100 ore / 75 crystal', () => startWorkerBuildingPlacement('barracks'), UI.green) : null}
          {isPlayerSelection && selected.kind === 'worker' ? actionButton('Build Fireplace', '25 ore / 50 crystal', () => startWorkerBuildingPlacement('fireplace'), UI.red) : null}
          {isPlayerSelection && selected.kind === 'worker' ? actionButton('Select All', 'miners', selectAllLikeSelected, UI.card) : null}
          {isPlayerSelection && selected.kind === 'barracks' ? actionButton('Create Gaurd', '100 ore / 50 plasma', queueSoldier, UI.green) : null}
          {isPlayerSelection && selected.kind === 'barracks' ? actionButton('Set Spawn', 'current position', setBarracksSpawnPoint, UI.card) : null}
          {showCancelBuild ? actionButton('Cancel Build', 'refund unbuilt cost', cancelSelectedConstruction, UI.red) : null}
          {isPlayerSelection && selected.kind === 'soldier' ? actionButton('Attack', 'click enemy', startSoldierAttackCommand, UI.red) : null}
          {isPlayerSelection && selected.kind === 'soldier' ? actionButton('Move', 'click ground', startSoldierMoveCommand, UI.accent) : null}
          {isPlayerSelection && selected.kind === 'soldier' ? actionButton('Select All', 'guards', selectAllLikeSelected, UI.card) : null}
          {selected.kind !== 'temple' && selected.kind !== 'worker' ? infoCard(getContextHint(selected.kind)) : null}
        </UiEntity>
      </UiEntity>

      {minimapPanel()}
      {dragSelectionRect()}

      {gameState.matchStatus === 'notStarted' ? startScreenOverlay() : null}
      {gameState.matchStatus === 'ended' ? endGameOverlay() : null}
      {!showSettingsMenu ? settingsButton() : null}
      {showSettingsMenu ? settingsOverlay() : null}
    </UiEntity>
  )
}

function dragSelectionRect() {
  const rect = getDragScreenRect(1920, 1080)
  if (!rect) return null

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { left: rect.left, top: rect.top },
        width: rect.width,
        height: rect.height
      }}
      uiBackground={{ color: Color4.create(0.2, 1, 0.35, 0.16) }}
    >
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: 2 }}
        uiBackground={{ color: Color4.create(0.2, 1, 0.35, 0.65) }}
      />
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { left: 0, bottom: 0 }, width: '100%', height: 2 }}
        uiBackground={{ color: Color4.create(0.2, 1, 0.35, 0.65) }}
      />
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: 2, height: '100%' }}
        uiBackground={{ color: Color4.create(0.2, 1, 0.35, 0.65) }}
      />
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { right: 0, top: 0 }, width: 2, height: '100%' }}
        uiBackground={{ color: Color4.create(0.2, 1, 0.35, 0.65) }}
      />
    </UiEntity>
  )
}

function topResourceStrip() {
  const supplyCapped = gameState.supplyUsed >= gameState.supplyCap

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 22, right: 282 },
        width: 700,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        padding: { left: 16, right: 16 }
      }}
      uiBackground={{ color: UI.panel }}
    >
      {stripStat('ORE', gameState.rocks.toString(), UI.gold, 136)}
      {stripStat('CRYSTAL', gameState.wood.toString(), UI.gold, 126)}
      {stripStat('PLASMA', gameState.meat.toString(), UI.gold, 122)}
      {stripStat('SUPPLY', `${gameState.supplyUsed}/${gameState.supplyCap}`, supplyCapped ? UI.red : UI.green, 152)}
      {stripStat('TIME', formatMatchTime(gameState.matchTime), UI.dim, 126)}
    </UiEntity>
  )
}

function stripStat(label: string, value: string, color: Color4, width: number) {
  return (
    <UiEntity uiTransform={{ width, height: '100%', flexDirection: 'row', alignItems: 'center' }}>
      <Label
        value={label}
        fontSize={11}
        color={UI.dim}
        textAlign="middle-left"
        textWrap="nowrap"
        uiTransform={{ width: 58, height: '100%' }}
      />
      <Label
        value={value}
        fontSize={20}
        color={color}
        textAlign="middle-left"
        textWrap="nowrap"
        uiTransform={{ width: width - 64, height: '100%' }}
      />
    </UiEntity>
  )
}

function idleWorkerButton() {
  const idleCount = getIdleWorkerCount()
  if (idleCount === 0) return null

  return (
    <Button
      value={`IDLE WORKERS: ${idleCount}`}
      variant="primary"
      fontSize={16}
      uiTransform={{
        positionType: 'absolute',
        // Sits directly below the minimap (top: 22, height: 246).
        position: { top: 276, right: 22 },
        width: 246,
        height: 44
      }}
      uiBackground={{ color: UI.card }}
      onMouseDown={selectIdleWorker}
    />
  )
}

function settingsButton() {
  return (
    <Button
      value="SETTINGS"
      variant="primary"
      fontSize={14}
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: 22, right: 22 },
        width: 150,
        height: 44
      }}
      uiBackground={{ color: UI.panelStrong }}
      onMouseDown={() => {
        showSettingsMenu = true
      }}
    />
  )
}

function settingsOverlay() {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center'
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
    >
      <UiEntity
        uiTransform={{
          width: 420,
          height: 316,
          flexDirection: 'column',
          alignItems: 'center',
          padding: { top: 24, bottom: 24, left: 28, right: 28 }
        }}
        uiBackground={{ color: UI.panelStrong }}
      >
        <Label value="SETTINGS" fontSize={24} color={UI.gold} textAlign="middle-center" />
        <Label
          value="Restarting will reset the current match and begin a fresh game."
          fontSize={14}
          color={UI.dim}
          textAlign="middle-center"
          uiTransform={{ width: 340, height: 58, margin: { top: 14 } }}
        />
        <Button
          value={isTopDownViewActive() ? 'SWITCH TO AVATAR VIEW' : 'SWITCH TO OVERHEAD VIEW'}
          variant="primary"
          fontSize={16}
          uiTransform={{ width: 280, height: 48, margin: { top: 4 } }}
          uiBackground={{ color: UI.accent }}
          onMouseDown={() => {
            toggleTopDownView()
            showSettingsMenu = false
          }}
        />
        <Button
          value="END GAME"
          variant="primary"
          fontSize={18}
          uiTransform={{ width: 240, height: 48, margin: { top: 18 } }}
          uiBackground={{ color: UI.red }}
          onMouseDown={() => {
            showSettingsMenu = false
            endRtsMatch()
          }}
        />
        <Button
          value="CANCEL"
          variant="primary"
          fontSize={16}
          uiTransform={{ width: 180, height: 42, margin: { top: 12 } }}
          uiBackground={{ color: UI.card }}
          onMouseDown={() => {
            showSettingsMenu = false
          }}
        />
      </UiEntity>
    </UiEntity>
  )
}

function startScreenOverlay() {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center'
      }}
      uiBackground={{ color: Color4.create(0.015, 0.012, 0.01, 0.96) }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 0, left: 0 },
          width: '100%',
          height: '100%'
        }}
        uiBackground={{ color: Color4.create(0.05, 0.035, 0.015, 0.24) }}
      />
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          positionType: 'absolute'
        }}
      >
        <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', margin: { bottom: 58 } }}>
          <UiEntity uiTransform={{ width: 140, height: 2, margin: { bottom: 24 } }} uiBackground={{ color: Color4.create(0.85, 0.65, 0.35, 0.45) }} />
          <Label value="KINGDOM OF" fontSize={18} color={Color4.create(0.58, 0.55, 0.5, 0.85)} textAlign="middle-center" uiTransform={{ margin: { bottom: 4 } }} />
          <Label value="ANTROM" fontSize={62} font="serif" color={Color4.create(0.95, 0.92, 0.85, 1)} textAlign="middle-center" />
          <UiEntity uiTransform={{ width: 140, height: 2, margin: { top: 24 } }} uiBackground={{ color: Color4.create(0.85, 0.65, 0.35, 0.45) }} />
        </UiEntity>
        <Label
          value="REAL-TIME STRATEGY"
          fontSize={18}
          color={Color4.create(0.85, 0.65, 0.35, 0.9)}
          textAlign="middle-center"
          uiTransform={{ margin: { bottom: 22 } }}
        />
        <UiEntity
          uiTransform={{
            width: 260,
            height: 58,
            justifyContent: 'center',
            alignItems: 'center'
          }}
          uiBackground={{ color: Color4.create(0.85, 0.65, 0.35, 1) }}
          onMouseDown={startRtsMatch}
        >
          <Label value="PLAY" fontSize={18} color={Color4.create(0.08, 0.06, 0.04, 1)} textAlign="middle-center" />
        </UiEntity>
        <Label
          value="Build. Defend. Conquer."
          fontSize={13}
          color={Color4.create(0.5, 0.48, 0.45, 0.78)}
          textAlign="middle-center"
          uiTransform={{ margin: { top: 34 } }}
        />
        <Label value="RTS Alpha" fontSize={10} color={Color4.create(0.5, 0.48, 0.45, 0.62)} textAlign="middle-center" uiTransform={{ margin: { top: 26 } }} />
      </UiEntity>
    </UiEntity>
  )
}

function endGameOverlay() {
  const didWin = gameState.matchResult === 'win'

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center'
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.72) }}
    >
      <UiEntity
        uiTransform={{
          width: 980,
          height: 560,
          flexDirection: 'column',
          alignItems: 'center',
          padding: { top: 32, bottom: 28, left: 34, right: 34 }
        }}
        uiBackground={{ color: UI.panelStrong }}
      >
        <Label value={didWin ? 'YOU WIN' : 'YOU LOSE'} fontSize={54} color={didWin ? UI.green : UI.red} textAlign="middle-center" />
        <Label value={`Match Time: ${formatMatchTime(gameState.matchTime)}`} fontSize={22} color={UI.gold} textAlign="middle-center" />

        <UiEntity uiTransform={{ width: '100%', height: 56, flexDirection: 'row', margin: { top: 28 } }} uiBackground={{ color: UI.card }}>
          {statsHeader('ARMY')}
          {statsHeader('UNITS MADE')}
          {statsHeader('KILLS')}
          {statsHeader('RESOURCES')}
        </UiEntity>
        {statsRow('PLAYER', gameState.matchStats.player.unitsProduced, gameState.matchStats.player.unitsKilled, gameState.matchStats.player.resourcesGathered, UI.accent)}
        {statsRow('AI', gameState.matchStats.enemy.unitsProduced, gameState.matchStats.enemy.unitsKilled, gameState.matchStats.enemy.resourcesGathered, UI.red)}

        <Button
          value="REPLAY"
          variant="primary"
          fontSize={24}
          uiTransform={{ width: 220, height: 58, margin: { top: 34 } }}
          uiBackground={{ color: UI.accent }}
          onMouseDown={resetRtsGame}
        />
      </UiEntity>
    </UiEntity>
  )
}

function statsHeader(label: string) {
  return <Label value={label} fontSize={15} color={UI.dim} textAlign="middle-center" uiTransform={{ width: 225, height: '100%' }} />
}

function statsRow(team: string, unitsProduced: number, unitsKilled: number, resourcesGathered: number, color: Color4) {
  return (
    <UiEntity uiTransform={{ width: '100%', height: 64, flexDirection: 'row', margin: { top: 8 } }} uiBackground={{ color: UI.cardSoft }}>
      <Label value={team} fontSize={21} color={color} textAlign="middle-center" uiTransform={{ width: 225, height: '100%' }} />
      <Label value={unitsProduced.toString()} fontSize={20} color={UI.text} textAlign="middle-center" uiTransform={{ width: 225, height: '100%' }} />
      <Label value={unitsKilled.toString()} fontSize={20} color={UI.text} textAlign="middle-center" uiTransform={{ width: 225, height: '100%' }} />
      <Label value={resourcesGathered.toString()} fontSize={20} color={UI.text} textAlign="middle-center" uiTransform={{ width: 225, height: '100%' }} />
    </UiEntity>
  )
}

function formatMatchTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
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

function getContextHint(kind: string): string {
  if (kind === 'resource') return 'Select a worker, then click this resource.'
  if (kind === 'supplyHouse') return 'Homesteads create miners and increase your unit cap.'
  if (kind === 'barracks') return 'Create Antrom Gaurds here.'
  if (kind === 'fireplace') return 'A camp utility building.'
  if (kind === 'soldier') return 'Click an enemy building to attack.'
  if (kind === 'enemyBuilding') return 'Select an Antrom Gaurd, then click this building to attack.'
  return 'Select a Homestead to create miners, or a miner to build.'
}

function infoCard(text: string) {
  return (
    <UiEntity
      uiTransform={{ width: 174, height: 78, justifyContent: 'center', alignItems: 'center', padding: 8, margin: { right: 10, bottom: 8 } }}
      uiBackground={{ color: UI.card }}
    >
      <Label value={text} fontSize={12} color={UI.dim} textAlign="middle-center" />
    </UiEntity>
  )
}

function actionButton(label: string, subLabel: string, onClick: () => void, color: Color4) {
  return (
    <UiEntity uiTransform={{ width: 134, height: 78, flexDirection: 'column', margin: { right: 10, bottom: 8 } }}>
      <Button
        value={label}
        variant="primary"
        fontSize={14}
        uiTransform={{ width: 134, height: 46 }}
        uiBackground={{ color }}
        onMouseDown={onClick}
      />
      <Label value={subLabel} fontSize={11} color={UI.dim} textAlign="middle-center" />
    </UiEntity>
  )
}
