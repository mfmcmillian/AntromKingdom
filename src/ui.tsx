import ReactEcs, { Button, Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { InputModifier, engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  assignControlGroup,
  cancelBuildingPlacement,
  cancelSelectedConstruction,
  canCancelSelectedConstruction,
  CONTROL_GROUP_SLOTS,
  cycleSelectedStance,
  endRtsMatch,
  gameState,
  getControlGroupCount,
  getIdleWorkerCount,
  getSelectedProductionQueue,
  getSelectedStance,
  getSelectedSummary,
  getSelectedUnitsInfo,
  isBuildingUnlocked,
  isUnitUnlocked,
  queueWorker,
  queueSoldier,
  recallControlGroup,
  resetRtsGame,
  returnToMainMenu,
  selectAllLikeSelected,
  selectIdleWorker,
  selectUnitById,
  setBarracksSpawnPoint,
  setWorkerSpawnPoint,
  STANCE_LABELS,
  startAttackMove,
  startRtsMatch,
  startUpgradeResearch,
  startWorkerBuildingPlacement
} from './rtsGame'
import { getDragScreenRect } from './rts/dragSelect'
import { minimapPanel } from './rts/minimap'
import { BUILDING_DEFINITIONS } from './rts/config'
import { RACES, RACE_IDS, getBuildingDisplayName, getRace, getSoldierDefinition, getWorkerDefinition } from './rts/races'
import { UPGRADE_INFO, UPGRADE_MAX_LEVEL, getNextUpgradeCost, getUpgradeLevel, isUpgradeInProgress } from './rts/upgrades'
import { isTopDownViewActive, toggleTopDownView } from './rts/topDownCamera'
import { CONSOLE_HEIGHT } from './rts/hud'
import { DIFFICULTY_IDS, AI_DIFFICULTY } from './rts/config'
import { isPlayerAlly } from './rts/state'
import { hideHeroShowcase, showHeroShowcase } from './rts/heroShowcase'
import type { BuildableKind, GameMode, RaceId, ResourceCost, SelectedSummary, SoldierVariant, Team, UpgradeKind } from './rts/types'

const UI = {
  console: Color4.create(0.03, 0.04, 0.06, 0.94),
  consoleEdge: Color4.create(0.16, 0.32, 0.5, 0.9),
  panel: Color4.create(0.04, 0.05, 0.08, 0.92),
  panelStrong: Color4.create(0.025, 0.03, 0.045, 0.96),
  card: Color4.create(0.1, 0.12, 0.16, 0.95),
  cardSoft: Color4.create(0.075, 0.085, 0.11, 0.92),
  slotFrame: Color4.create(0.22, 0.3, 0.42, 0.9),
  accent: Color4.create(0.2, 0.6, 1, 1),
  gold: Color4.create(0.95, 0.75, 0.25, 1),
  green: Color4.create(0.2, 0.85, 0.35, 1),
  red: Color4.create(0.9, 0.25, 0.25, 1),
  text: Color4.create(0.96, 0.96, 0.98, 1),
  dim: Color4.create(0.65, 0.68, 0.75, 1)
}

// StarCraft-style command card icons (generated art). Buildings and units have
// one image per race; the human set keeps the original unsuffixed filenames.
const BUILDING_ICON_FILES: Record<BuildableKind, string> = {
  temple: 'icon-building-temple',
  supplyHouse: 'icon-building-supply',
  barracks: 'icon-building-barracks',
  techLab: 'icon-building-techlab',
  forge: 'icon-building-forge',
  fireplace: 'icon-building-fireplace',
  turret: 'icon-building-turret'
}

const UNIT_ICON_FILES: Record<SoldierVariant | 'worker', string> = {
  worker: 'icon-unit-worker',
  melee: 'icon-unit-melee',
  ranged: 'icon-unit-ranged',
  caster: 'icon-unit-caster',
  flyer: 'icon-unit-flyer',
  titan: 'icon-unit-titan',
  hero: 'icon-unit-hero'
}

const RACE_ICON_SUFFIX: Record<RaceId, string> = { human: '', alien: '-alien', bio: '-bio' }

function raceIdFor(team: Team | undefined): RaceId {
  if (!team || team === 'player') return gameState.playerRace
  return gameState.enemyRaces[team]
}

function buildingIcon(kind: BuildableKind, team?: Team): string {
  return `images/icons/${BUILDING_ICON_FILES[kind]}${RACE_ICON_SUFFIX[raceIdFor(team)]}.png`
}

function unitIcon(unit: SoldierVariant | 'worker', team?: Team): string {
  return `images/icons/${UNIT_ICON_FILES[unit]}${RACE_ICON_SUFFIX[raceIdFor(team)]}.png`
}

const ICON = {
  upgrade: {
    damage: 'images/icons/icon-upgrade-damage.png',
    speed: 'images/icons/icon-upgrade-speed.png'
  } as Record<UpgradeKind, string>,
  resource: {
    minerals: 'images/icons/icon-res-minerals.png',
    gas: 'images/icons/icon-res-gas.png',
    supply: 'images/icons/icon-res-supply.png'
  },
  action: {
    rally: 'images/icons/icon-action-rally.png',
    cancel: 'images/icons/icon-action-cancel.png',
    selectAll: 'images/icons/icon-action-selectall.png',
    attackMove: 'images/icons/icon-action-attackmove.png',
    stance: 'images/icons/icon-action-stance.png'
  }
}

// Bottom console geometry (virtual 1920x1080).
const SLOT_SIZE = 66
const SLOT_GAP = 6
const CARD_COLUMNS = 3
const CARD_WIDTH = CARD_COLUMNS * (SLOT_SIZE + SLOT_GAP) + 12
// Minimap sits in the bottom-right corner (DCL chat owns the bottom-left);
// the command card is anchored just left of it.
const MINIMAP_SPAN = 246 + 10
const CARD_RIGHT = 12 + MINIMAP_SPAN + 8

type CommandSlot = {
  id: string
  icon: string
  name: string
  description: string
  cost?: ResourceCost
  /** Requirement text shown when the slot is tech-locked. */
  locked?: string
  badge?: string
  onClick: () => void
}

let showSettingsMenu = false
let hoveredSlot: CommandSlot | undefined
/** Clock driving the title screen ambience (shooting stars, twinkles). */
let titleTime = 0

// Pre-match menu flow: title screen (race pick) -> match setup (opponents + hero).
let titleStage: 'title' | 'setup' = 'title'

/** Avatar movement is frozen on menu screens so the player can't wander under the UI. */
let menuMovementLocked = false

function updateMenuMovementLock(): void {
  const shouldLock = gameState.matchStatus !== 'active'
  if (shouldLock === menuMovementLocked) return

  menuMovementLocked = shouldLock
  if (shouldLock) {
    InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  } else {
    InputModifier.deleteFrom(engine.PlayerEntity)
  }
}

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
  engine.addSystem((dt: number) => {
    if (gameState.matchStatus === 'notStarted') titleTime += dt
    updateMenuMovementLock()
  })
}

export const uiMenu = () => {
  const selected = getSelectedSummary()

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      {gameState.matchStatus === 'active' ? resourceBar() : null}
      {gameState.matchStatus === 'active' ? attackAlertBanner() : null}
      {gameState.matchStatus === 'active' ? statusPrompt() : null}
      {gameState.matchStatus === 'active' ? bottomConsole(selected) : null}
      {gameState.matchStatus === 'active' ? idleWorkerButton() : null}
      {gameState.matchStatus === 'active' ? controlGroupsBar() : null}

      {minimapPanel()}
      {dragSelectionRect()}

      {gameState.matchStatus === 'notStarted' ? (titleStage === 'title' ? startScreenOverlay() : matchSetupOverlay()) : null}
      {gameState.matchStatus === 'ended' ? endGameOverlay() : null}
      {!showSettingsMenu ? menuButton() : null}
      {showSettingsMenu ? settingsOverlay() : null}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Top HUD: resources (SC style: icon + count, top-right) and alerts.
// ---------------------------------------------------------------------------

function resourceBar() {
  const playerEconomy = gameState.economies.player
  const supplyCapped = playerEconomy.supplyUsed >= playerEconomy.supplyCap

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 12, right: 12 },
        width: 520,
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: { left: 12, right: 12 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.78) }}
    >
      <Label value={formatMatchTime(gameState.matchTime)} fontSize={15} color={UI.dim} textAlign="middle-right" textWrap="nowrap" uiTransform={{ width: 66, height: '100%', margin: { right: 18 } }} />
      {resourceCounter(ICON.resource.minerals, playerEconomy.minerals.toString(), UI.text)}
      {resourceCounter(ICON.resource.gas, playerEconomy.gas.toString(), UI.text)}
      {resourceCounter(ICON.resource.supply, `${playerEconomy.supplyUsed}/${playerEconomy.supplyCap}`, supplyCapped ? UI.red : UI.text)}
    </UiEntity>
  )
}

function resourceCounter(icon: string, value: string, color: Color4) {
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: '100%', margin: { left: 14 } }}>
      <UiEntity uiTransform={{ width: 30, height: 30, margin: { right: 7 } }} uiBackground={{ textureMode: 'stretch', texture: { src: icon } }} />
      <Label value={value} fontSize={20} color={color} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: 86, height: '100%' }} />
    </UiEntity>
  )
}

function attackAlertBanner() {
  if (!gameState.attackAlert) return null

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 26, left: 610 },
        width: 700,
        height: 52,
        justifyContent: 'center',
        alignItems: 'center'
      }}
      uiBackground={{ color: Color4.create(0.12, 0.02, 0.02, 0.9) }}
    >
      <Label value={gameState.attackAlert} fontSize={28} color={UI.red} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
    </UiEntity>
  )
}

/** Transient SC-style prompt above the console ("Not enough minerals" etc). */
function statusPrompt() {
  const placing = gameState.placementMode === 'placing'
  if (!placing && gameState.statusTimer <= 0) return null
  if (!gameState.status) return null

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: CONSOLE_HEIGHT + 30, left: 460 },
        width: 1000,
        height: 34,
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      <Label value={gameState.status} fontSize={18} color={placing ? UI.gold : Color4.create(1, 0.85, 0.55, 0.95)} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Bottom console: minimap wing (left) | info panel (center) | command card (right).
// ---------------------------------------------------------------------------

function bottomConsole(selected: SelectedSummary) {
  const slots = getCommandSlots(selected)
  // Re-resolve the hovered slot each frame so the tooltip clears when the card
  // changes under the cursor and always shows fresh cost / lock state.
  const hovered = hoveredSlot ? slots.find((slot) => slot.id === hoveredSlot?.id) : undefined
  if (hoveredSlot && !hovered) hoveredSlot = undefined

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: 0, left: 0 },
        width: '100%',
        height: CONSOLE_HEIGHT
      }}
      uiBackground={{ color: UI.console }}
    >
      <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: 2 }} uiBackground={{ color: UI.consoleEdge }} />
      {infoPanel(selected)}
      {commandCard(slots)}
      {hovered ? commandTooltip(hovered) : null}
    </UiEntity>
  )
}

function infoPanel(selected: SelectedSummary) {
  if (selected.kind === 'none') return null

  const units = getSelectedUnitsInfo()
  const multi = units.length > 1
  const race = getRace(selected.team ?? 'player')
  const portrait = getPortraitIcon(selected)
  const isEnemy = selected.team !== undefined && selected.team !== 'player'
  const isAlly = selected.team !== undefined && isPlayerAlly(selected.team)
  const hpRatio = selected.hp !== undefined && selected.maxHp ? Math.max(0, Math.min(1, selected.hp / selected.maxHp)) : undefined

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        // Starts right of Decentraland's chat window / sidebar so nothing hides it.
        position: { bottom: 14, left: 500 },
        width: 900,
        height: CONSOLE_HEIGHT - 34,
        flexDirection: 'row'
      }}
    >
      {portrait ? (
        <UiEntity uiTransform={{ width: 156, height: 156, padding: 3, margin: { top: 20, right: 22 } }} uiBackground={{ color: UI.slotFrame }}>
          <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: portrait } }} />
        </UiEntity>
      ) : null}

      <UiEntity uiTransform={{ flexDirection: 'column', width: 380, height: '100%', padding: { top: 24 } }}>
        <Label value={!multi && selected.variant === 'hero' ? 'HERO' : getCommandTitle(selected.kind)} fontSize={13} color={isAlly ? ALLY_UI_COLOR : isEnemy ? UI.red : UI.dim} textAlign="middle-left" />
        <Label value={selected.name} fontSize={30} color={UI.text} textAlign="middle-left" uiTransform={{ margin: { top: 2, bottom: 8 } }} />

        {!multi && hpRatio !== undefined ? (
          <UiEntity uiTransform={{ flexDirection: 'column', width: 340 }}>
            <UiEntity uiTransform={{ width: 340, height: 16, padding: 2 }} uiBackground={{ color: UI.panelStrong }}>
              <UiEntity
                uiTransform={{ width: Math.max(2, 336 * hpRatio), height: '100%' }}
                uiBackground={{ color: hpRatio > 0.55 ? UI.green : hpRatio > 0.25 ? UI.gold : UI.red }}
              />
            </UiEntity>
            <Label value={`${selected.hp} / ${selected.maxHp}`} fontSize={14} color={UI.dim} textAlign="middle-left" uiTransform={{ margin: { top: 4 } }} />
          </UiEntity>
        ) : null}

        <Label value={selected.detail} fontSize={14} color={UI.dim} textAlign="middle-left" uiTransform={{ margin: { top: 8 } }} />
        {selected.kind === 'forge' && !isEnemy ? (
          <Label
            value={`${UPGRADE_INFO.damage.name} Lv${getUpgradeLevel('player', 'damage')}  |  ${UPGRADE_INFO.speed.name} Lv${getUpgradeLevel('player', 'speed')}`}
            fontSize={14}
            color={race.accent}
            textAlign="middle-left"
            uiTransform={{ margin: { top: 6 } }}
          />
        ) : null}
      </UiEntity>

      {multi ? wireframeGrid(units) : productionQueuePanel(selected)}
    </UiEntity>
  )
}

/** SC-style multi-selection wireframes beside the unit info: unit images whose
 * frame color shows their HP (green / gold / red). Clicking one selects it. */
function wireframeGrid(units: ReturnType<typeof getSelectedUnitsInfo>) {
  const shown = units.slice(0, 15)
  const extra = units.length - shown.length

  return (
    <UiEntity
      uiTransform={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignContent: 'flex-start',
        width: 305,
        height: '100%',
        margin: { left: 10 },
        padding: { top: 20 }
      }}
    >
      {shown.map((unit) => {
        const ratio = unit.maxHp > 0 ? Math.max(0, Math.min(1, unit.hp / unit.maxHp)) : 0
        const outline = ratio > 0.55 ? UI.green : ratio > 0.25 ? UI.gold : UI.red
        return (
          <UiEntity
            key={`sel-${unit.id}`}
            uiTransform={{ width: 54, height: 54, margin: { right: 6, bottom: 6 }, padding: 2 }}
            uiBackground={{ color: outline }}
            onMouseDown={() => selectUnitById(unit.id)}
          >
            <UiEntity
              uiTransform={{ width: '100%', height: '100%' }}
              uiBackground={{ textureMode: 'stretch', texture: { src: unit.kind === 'worker' ? unitIcon('worker') : unitIcon(unit.variant ?? 'melee') } }}
            />
          </UiEntity>
        )
      })}
      {extra > 0 ? (
        <UiEntity uiTransform={{ width: 54, height: 54, justifyContent: 'center', alignItems: 'center', margin: { right: 6, bottom: 6 } }} uiBackground={{ color: UI.cardSoft }}>
          <Label value={`+${extra}`} fontSize={16} color={UI.text} textAlign="middle-center" />
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

/** SC-style production readout: queued unit icon, progress bar of the active order, queue count. */
function productionQueuePanel(selected: SelectedSummary) {
  if (selected.team !== undefined && selected.team !== 'player') return null
  const queue = getSelectedProductionQueue()
  if (!queue) return null

  const icon = selected.kind === 'temple' ? unitIcon('worker') : unitIcon(queue.variant ?? 'melee')

  return (
    <UiEntity uiTransform={{ flexDirection: 'column', width: 300, height: '100%', padding: { top: 30 } }}>
      <Label value="PRODUCTION" fontSize={13} color={UI.dim} textAlign="middle-left" uiTransform={{ margin: { bottom: 8 } }} />
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
        <UiEntity uiTransform={{ width: 56, height: 56, padding: 2, margin: { right: 12 } }} uiBackground={{ color: UI.slotFrame }}>
          <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: icon } }} />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'column', width: 200 }}>
          <UiEntity uiTransform={{ width: 200, height: 12, padding: 2 }} uiBackground={{ color: UI.panelStrong }}>
            <UiEntity uiTransform={{ width: Math.max(2, 196 * queue.progress), height: '100%' }} uiBackground={{ color: UI.accent }} />
          </UiEntity>
          <Label value={`In queue: ${queue.count}`} fontSize={14} color={UI.text} textAlign="middle-left" uiTransform={{ margin: { top: 6 } }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Command card: SC-style 3-wide grid of icon buttons, bottom-right.
// ---------------------------------------------------------------------------

function commandCard(slots: CommandSlot[]) {
  if (slots.length === 0) return null

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: 6, right: CARD_RIGHT },
        width: CARD_WIDTH,
        height: CONSOLE_HEIGHT - 12,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignContent: 'flex-start',
        padding: 6
      }}
      uiBackground={{ color: UI.panelStrong }}
    >
      {slots.map((slot) => commandButton(slot))}
    </UiEntity>
  )
}

function commandButton(slot: CommandSlot) {
  const locked = slot.locked !== undefined

  return (
    <UiEntity
      key={slot.id}
      uiTransform={{ width: SLOT_SIZE, height: SLOT_SIZE, margin: { right: SLOT_GAP, bottom: SLOT_GAP }, padding: 2 }}
      uiBackground={{ color: locked ? Color4.create(0.12, 0.12, 0.15, 0.9) : UI.slotFrame }}
      onMouseEnter={() => {
        hoveredSlot = slot
      }}
      onMouseLeave={() => {
        if (hoveredSlot?.id === slot.id) hoveredSlot = undefined
      }}
      onMouseDown={() => {
        if (!locked) slot.onClick()
      }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: '100%' }}
        uiBackground={{
          textureMode: 'stretch',
          texture: { src: slot.icon },
          color: locked ? Color4.create(0.3, 0.3, 0.35, 1) : Color4.White()
        }}
      >
        {slot.badge ? (
          <UiEntity
            uiTransform={{ positionType: 'absolute', position: { bottom: 2, right: 2 }, width: 30, height: 18, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0, 0, 0, 0.75) }}
          >
            <Label value={slot.badge} fontSize={11} color={UI.gold} textAlign="middle-center" />
          </UiEntity>
        ) : null}
        {locked ? (
          <UiEntity
            uiTransform={{ positionType: 'absolute', position: { top: 2, right: 2 }, width: 16, height: 16, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.35, 0.05, 0.05, 0.9) }}
          >
            <Label value="!" fontSize={12} color={UI.red} textAlign="middle-center" />
          </UiEntity>
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

/** Hover tooltip above the command card: name, cost with resource icons, requirement / description. */
function commandTooltip(slot: CommandSlot) {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: CONSOLE_HEIGHT - 8, right: CARD_RIGHT },
        width: 380,
        flexDirection: 'column',
        padding: { top: 10, bottom: 10, left: 14, right: 14 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.025, 0.045, 0.96) }}
    >
      <Label value={slot.name} fontSize={17} color={UI.text} textAlign="middle-left" />
      {slot.cost ? (
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: 26, margin: { top: 4 } }}>
          {slot.cost.minerals ? tooltipCost(ICON.resource.minerals, slot.cost.minerals) : null}
          {slot.cost.gas ? tooltipCost(ICON.resource.gas, slot.cost.gas) : null}
        </UiEntity>
      ) : null}
      {slot.locked ? (
        <Label value={slot.locked} fontSize={14} color={UI.red} textAlign="middle-left" uiTransform={{ margin: { top: 4 } }} />
      ) : null}
      <Label value={slot.description} fontSize={13} color={UI.dim} textAlign="middle-left" uiTransform={{ margin: { top: 4 }, width: 350 }} />
    </UiEntity>
  )
}

function tooltipCost(icon: string, amount: number) {
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { right: 16 } }}>
      <UiEntity uiTransform={{ width: 20, height: 20, margin: { right: 5 } }} uiBackground={{ textureMode: 'stretch', texture: { src: icon } }} />
      <Label value={amount.toString()} fontSize={15} color={UI.text} textAlign="middle-left" />
    </UiEntity>
  )
}

function getCommandSlots(selected: SelectedSummary): CommandSlot[] {
  const slots: CommandSlot[] = []
  const isPlayerSelection = selected.team === undefined || selected.team === 'player'

  if (gameState.placementMode === 'placing') {
    slots.push({
      id: 'cancel-placement',
      icon: ICON.action.cancel,
      name: 'Cancel Placement',
      description: 'Stop placing this building. No resources are spent.',
      onClick: cancelBuildingPlacement
    })
    return slots
  }

  if (!isPlayerSelection) return slots

  if (selected.kind === 'worker') {
    const buildOrder: BuildableKind[] = ['temple', 'supplyHouse', 'barracks', 'techLab', 'forge', 'turret', 'fireplace']
    for (const kind of buildOrder) {
      const definition = BUILDING_DEFINITIONS[kind]
      const displayName = getBuildingDisplayName(kind, 'player')
      slots.push({
        id: `build-${kind}`,
        icon: buildingIcon(kind),
        name: `Build ${displayName}`,
        cost: definition.cost,
        description: getBuildingDescription(kind),
        locked: definition.requires && !isBuildingUnlocked(kind) ? `Requires ${getBuildingDisplayName(definition.requires, 'player')}` : undefined,
        onClick: () => startWorkerBuildingPlacement(kind)
      })
    }
    slots.push(selectAllSlot(`all ${getWorkerDefinition('player').name}s`))
  }

  if (selected.kind === 'temple') {
    const worker = getWorkerDefinition('player')
    slots.push({
      id: 'train-worker',
      icon: unitIcon('worker'),
      name: `Train ${worker.name}`,
      cost: worker.cost,
      description: 'Gathers crystal and plasma, builds and repairs structures.',
      onClick: queueWorker
    })
    slots.push({
      id: 'rally-worker',
      icon: ICON.action.rally,
      name: 'Set Rally Point',
      description: `New ${worker.name}s walk to this spot. Click ground after pressing.`,
      onClick: setWorkerSpawnPoint
    })
  }

  if (selected.kind === 'barracks') {
    slots.push(trainSlot('melee', 'Frontline melee fighter.'))
    slots.push(trainSlot('ranged', 'Ranged attacker. Fires from a distance.'))
    slots.push(rallySlot())
  }

  if (selected.kind === 'techLab') {
    slots.push(trainSlot('caster', 'Spellcaster. Slow blasts that splash nearby enemies.'))
    slots.push(trainSlot('flyer', 'Fast flyer. Hovers over the battlefield.'))
    slots.push(trainSlot('titan', 'Giant assault monster. Splash stomps, huge HP.'))
    slots.push(rallySlot())
  }

  if (selected.kind === 'forge') {
    slots.push(upgradeSlot('damage'))
    slots.push(upgradeSlot('speed'))
  }

  if (selected.kind === 'soldier') {
    slots.push({
      id: 'attack-move',
      icon: ICON.action.attackMove,
      name: 'Attack-Move',
      description: 'March to a point, engaging every hostile on the way. Click ground after pressing.',
      onClick: startAttackMove
    })
    const stance = getSelectedStance() ?? 'defensive'
    slots.push({
      id: 'stance',
      icon: ICON.action.stance,
      name: `Stance: ${STANCE_LABELS[stance]}`,
      description: 'Cycle stance. Defensive: short chase, returns to post. Aggressive: chases forever. Hold: never moves.',
      onClick: cycleSelectedStance
    })
    slots.push(selectAllSlot('all fighters'))
  }

  if (canCancelSelectedConstruction()) {
    slots.push({
      id: 'cancel-build',
      icon: ICON.action.cancel,
      name: 'Cancel Construction',
      description: 'Tear down this construction site and refund the unbuilt cost.',
      onClick: cancelSelectedConstruction
    })
  }

  return slots
}

function trainSlot(variant: SoldierVariant, description: string): CommandSlot {
  const definition = getSoldierDefinition('player', variant)
  const unlocked = isUnitUnlocked(variant)
  const requiredKind = variant === 'titan' ? 'forge' : undefined

  return {
    id: `train-${variant}`,
    icon: unitIcon(variant),
    name: `Train ${definition.name}`,
    cost: definition.cost,
    description: `${description} Supply ${definition.supply}.`,
    locked: !unlocked && requiredKind ? `Requires ${getBuildingDisplayName(requiredKind, 'player')}` : undefined,
    onClick: () => queueSoldier(variant)
  }
}

function rallySlot(): CommandSlot {
  return {
    id: 'rally',
    icon: ICON.action.rally,
    name: 'Set Rally Point',
    description: 'New units walk to this spot. Click ground after pressing.',
    onClick: setBarracksSpawnPoint
  }
}

function selectAllSlot(label: string): CommandSlot {
  return {
    id: 'select-all',
    icon: ICON.action.selectAll,
    name: 'Select All',
    description: `Selects ${label} on the map.`,
    onClick: selectAllLikeSelected
  }
}

function upgradeSlot(kind: UpgradeKind): CommandSlot {
  const info = UPGRADE_INFO[kind]
  const level = getUpgradeLevel('player', kind)
  const inProgress = isUpgradeInProgress('player', kind)
  const cost = getNextUpgradeCost('player', kind)

  if (!cost) {
    return {
      id: `upgrade-${kind}`,
      icon: ICON.upgrade[kind],
      name: `${info.name} (Maxed)`,
      description: `${info.effect}. Fully researched.`,
      badge: 'MAX',
      locked: `Already at level ${UPGRADE_MAX_LEVEL}.`,
      onClick: () => {}
    }
  }

  if (inProgress) {
    return {
      id: `upgrade-${kind}`,
      icon: ICON.upgrade[kind],
      name: `${info.name} Lv${level + 1}`,
      description: `${info.effect}. Research in progress...`,
      badge: '...',
      locked: 'Research already in progress.',
      onClick: () => {}
    }
  }

  return {
    id: `upgrade-${kind}`,
    icon: ICON.upgrade[kind],
    name: `Research ${info.name} Lv${level + 1}`,
    cost,
    description: `${info.effect}. Applies to every fighter instantly.`,
    badge: level > 0 ? `Lv${level}` : undefined,
    onClick: () => startUpgradeResearch(kind)
  }
}

function getPortraitIcon(selected: SelectedSummary): string | undefined {
  if (selected.kind === 'worker') return unitIcon('worker', selected.team)
  if (selected.kind === 'soldier') return unitIcon(selected.variant ?? 'melee', selected.team)
  if (selected.kind === 'resource') return selected.resourceKind === 'gas' ? ICON.resource.gas : ICON.resource.minerals
  if (selected.kind in BUILDING_ICON_FILES) return buildingIcon(selected.kind as BuildableKind, selected.team)
  return undefined
}

function getBuildingDescription(kind: BuildableKind): string {
  const race = getRace('player')
  if (kind === 'temple') return `Main base. Trains ${race.worker.name}s and receives resources. Lose all of them and you lose.`
  if (kind === 'supplyHouse') return 'Raises your supply cap so you can field more units.'
  if (kind === 'barracks') return `Tier 1 production: ${race.melee.name}s and ${race.ranged.name}s.`
  if (kind === 'techLab') return `Tier 2 production: ${race.caster.name}s, ${race.flyer.name}s and ${race.titan.name}s.`
  if (kind === 'forge') return 'Researches Weapons and Propulsion upgrades. Unlocks the titan.'
  if (kind === 'turret') return 'Automated defense tower. Fires on hostile units in range.'
  return 'A camp utility building.'
}

// ---------------------------------------------------------------------------
// Control groups: numbered slots sitting on top of the minimap. Click to
// recall the saved units, press SET to store the current selection.
// ---------------------------------------------------------------------------

function controlGroupsBar() {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: MINIMAP_SPAN + 16, right: 12 },
        flexDirection: 'row'
      }}
    >
      {CONTROL_GROUP_SLOTS.map((slot) => {
        const count = getControlGroupCount(slot)
        return (
          <UiEntity key={`cgroup-${slot}`} uiTransform={{ flexDirection: 'column', width: 44, margin: { left: 5 } }}>
            <UiEntity
              uiTransform={{ width: 44, height: 32, justifyContent: 'center', alignItems: 'center' }}
              uiBackground={{ color: count > 0 ? UI.card : UI.panelStrong }}
              onMouseDown={() => recallControlGroup(slot)}
            >
              <Label value={count > 0 ? `${slot} · ${count}` : `${slot}`} fontSize={12} color={count > 0 ? UI.text : UI.dim} textAlign="middle-center" />
            </UiEntity>
            <UiEntity
              uiTransform={{ width: 44, height: 15, margin: { top: 2 }, justifyContent: 'center', alignItems: 'center' }}
              uiBackground={{ color: UI.cardSoft }}
              onMouseDown={() => assignControlGroup(slot)}
            >
              <Label value="SET" fontSize={8} color={UI.dim} textAlign="middle-center" />
            </UiEntity>
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Idle worker button (above the minimap, SC2 style).
// ---------------------------------------------------------------------------

function idleWorkerButton() {
  const idleCount = getIdleWorkerCount()
  if (idleCount === 0) return null

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        // Floats above the control group slots, which sit on the minimap.
        position: { bottom: MINIMAP_SPAN + 76, right: 12 },
        width: 62,
        height: 62,
        padding: 2
      }}
      uiBackground={{ color: UI.slotFrame }}
      onMouseDown={selectIdleWorker}
    >
      <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: unitIcon('worker') } }}>
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { bottom: -4, right: -4 }, width: 24, height: 24, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: UI.gold }}
        >
          <Label value={idleCount.toString()} fontSize={13} color={Color4.create(0.1, 0.08, 0.02, 1)} textAlign="middle-center" />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Drag selection rectangle.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Menus and overlays.
// ---------------------------------------------------------------------------

function menuButton() {
  return (
    <Button
      value="MENU"
      variant="primary"
      fontSize={14}
      uiTransform={{
        positionType: 'absolute',
        position: { top: 12, left: 12 },
        width: 110,
        height: 40
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
        <Label value="MENU" fontSize={24} color={UI.gold} textAlign="middle-center" />
        <Label
          value="Ending the game shows the final stats and lets you start a fresh match."
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

function raceCard(raceId: RaceId) {
  const race = RACES[raceId]
  const isSelected = gameState.playerRace === raceId
  const portrait = `images/icons/${UNIT_ICON_FILES.melee}${RACE_ICON_SUFFIX[raceId]}.png`

  return (
    <UiEntity
      key={`race-${raceId}`}
      uiTransform={{
        width: 216,
        height: 268,
        margin: { left: 12, right: 12 },
        padding: 3,
        flexDirection: 'column'
      }}
      uiBackground={{ color: isSelected ? race.accent : Color4.create(0.2, 0.22, 0.27, 0.75) }}
      onMouseDown={() => {
        gameState.playerRace = raceId
      }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center' }}
        uiBackground={{ color: Color4.create(0.02, 0.025, 0.04, 0.95) }}
      >
        <UiEntity
          uiTransform={{ width: 186, height: 186, margin: { top: 12 } }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: portrait },
            // Unselected races dim slightly; the new portraits are dark, so keep them readable.
            color: isSelected ? Color4.White() : Color4.create(0.72, 0.72, 0.78, 1)
          }}
        />
        <Label
          value={race.name.toUpperCase()}
          fontSize={17}
          color={isSelected ? Color4.White() : Color4.create(0.62, 0.62, 0.66, 1)}
          textAlign="middle-center"
          uiTransform={{ margin: { top: 10 } }}
        />
        <Label
          value={`${race.worker.name} · ${race.melee.name} · ${race.ranged.name}`}
          fontSize={11}
          color={isSelected ? race.accent : Color4.create(0.45, 0.45, 0.5, 0.9)}
          textAlign="middle-center"
          uiTransform={{ margin: { top: 4 } }}
        />
      </UiEntity>
    </UiEntity>
  )
}

// -----------------------------------------------------------------------------
// Opponents panel: 1-3 computers, each with a race and difficulty picker.
// -----------------------------------------------------------------------------

const OPPONENT_RACE_OPTIONS: (RaceId | 'random')[] = ['random', 'human', 'alien', 'bio']
const OPPONENT_SLOT_COLORS = [Color4.create(0.95, 0.3, 0.25, 1), Color4.create(1, 0.62, 0.15, 1), Color4.create(0.82, 0.35, 0.95, 1)]
const ALLY_UI_COLOR = Color4.create(0.95, 0.85, 0.3, 1)

const GAME_MODES: { id: GameMode; label: string; hint: string }[] = [
  { id: 'team', label: 'TEAM', hint: 'Pick each computer\'s side. Allies fight with you and share vision.' },
  { id: 'ffa', label: 'FFA', hint: 'Free-for-all: every computer fights everyone, including each other.' }
]

function opponentRaceLabel(race: RaceId | 'random'): string {
  return race === 'random' ? 'RANDOM' : RACES[race].name
}

function cycleOpponentRace(index: number): void {
  const setup = gameState.opponents[index]
  const next = (OPPONENT_RACE_OPTIONS.indexOf(setup.race) + 1) % OPPONENT_RACE_OPTIONS.length
  setup.race = OPPONENT_RACE_OPTIONS[next]
}

function cycleOpponentDifficulty(index: number): void {
  const setup = gameState.opponents[index]
  const next = (DIFFICULTY_IDS.indexOf(setup.difficulty) + 1) % DIFFICULTY_IDS.length
  setup.difficulty = DIFFICULTY_IDS[next]
}

function toggleOpponentSide(index: number): void {
  const setup = gameState.opponents[index]
  // Someone has to be the enemy: block turning the last foe into an ally.
  if (!setup.ally && gameState.opponents.filter((opponent) => !opponent.ally).length <= 1) return
  setup.ally = !setup.ally
}

/** A click-to-cycle setting chip: shows the current value, advances on click. */
function opponentChip(key: string, value: string, width: number, onClick: () => void) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ width, height: 34, margin: { right: 6 }, padding: 2, justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color: Color4.create(0.25, 0.32, 0.45, 0.9) }}
      onMouseDown={onClick}
    >
      <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.05, 0.07, 0.11, 0.96) }}>
        <Label value={value} fontSize={12} color={UI.text} textAlign="middle-center" />
      </UiEntity>
    </UiEntity>
  )
}

function opponentRow(index: number) {
  const setup = gameState.opponents[index]
  const isAlly = gameState.gameMode === 'team' && setup.ally
  const slotColor = isAlly ? ALLY_UI_COLOR : OPPONENT_SLOT_COLORS[index]

  return (
    <UiEntity key={`opponent-${index}`} uiTransform={{ width: '100%', height: 40, flexDirection: 'row', alignItems: 'center', margin: { bottom: 6 } }}>
      <UiEntity uiTransform={{ width: 10, height: 10, margin: { right: 8 } }} uiBackground={{ color: slotColor }} />
      <Label value={`CPU ${index + 1}`} fontSize={13} color={UI.dim} textAlign="middle-left" uiTransform={{ width: 52 }} />
      {gameState.gameMode === 'team' ? opponentChip(`opp-side-${index}`, isAlly ? 'ALLY' : 'FOE', 62, () => toggleOpponentSide(index)) : null}
      {opponentChip(`opp-race-${index}`, opponentRaceLabel(setup.race), gameState.gameMode === 'team' ? 96 : 120, () => cycleOpponentRace(index))}
      {opponentChip(`opp-diff-${index}`, AI_DIFFICULTY[setup.difficulty].label.toUpperCase(), 78, () => cycleOpponentDifficulty(index))}
      {gameState.opponents.length > 1 ? (
        <UiEntity
          uiTransform={{ width: 30, height: 34, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.45, 0.12, 0.12, 0.9) }}
          onMouseDown={() => {
            gameState.opponents.splice(index, 1)
            // Never leave the roster without a foe after a removal.
            if (gameState.opponents.every((opponent) => opponent.ally)) gameState.opponents[0].ally = false
          }}
        >
          <Label value="X" fontSize={13} color={UI.text} textAlign="middle-center" />
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

/** TEAM / FFA selector chips. */
function gameModeToggle() {
  return (
    <UiEntity uiTransform={{ width: '100%', height: 36, flexDirection: 'row', margin: { bottom: 10 } }}>
      {GAME_MODES.map((mode) => {
        const isActive = gameState.gameMode === mode.id
        return (
          <UiEntity
            key={`mode-${mode.id}`}
            uiTransform={{ width: 92, height: 34, margin: { right: 8 }, padding: 2, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: isActive ? UI.accent : Color4.create(0.25, 0.32, 0.45, 0.9) }}
            onMouseDown={() => {
              gameState.gameMode = mode.id
            }}
          >
            <UiEntity
              uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
              uiBackground={{ color: isActive ? Color4.create(0.08, 0.18, 0.32, 0.98) : Color4.create(0.05, 0.07, 0.11, 0.96) }}
            >
              <Label value={mode.label} fontSize={13} color={isActive ? Color4.White() : UI.dim} textAlign="middle-center" />
            </UiEntity>
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}


// Deterministic star field for the title screen sky (kept above the race picker band).
const TITLE_STARS: { x: number; y: number; size: number; phase: number; speed: number }[] = []
{
  let starSeed = 99
  const starRandom = () => {
    starSeed = (starSeed * 16807) % 2147483647
    return starSeed / 2147483647
  }
  for (let i = 0; i < 26; i++) {
    TITLE_STARS.push({
      x: starRandom() * 1920,
      y: starRandom() * 520,
      size: 2 + starRandom() * 3,
      phase: starRandom() * Math.PI * 2,
      speed: 0.8 + starRandom() * 1.6
    })
  }
}

// Shooting stars: staggered diagonal streaks, each a bright head plus a fading dot trail.
const SHOOTING_STARS = [
  { startX: 320, startY: 40, dx: 620, dy: 300, period: 7.3, duration: 1.1, delay: 0 },
  { startX: 1500, startY: 30, dx: -540, dy: 260, period: 9.1, duration: 1.25, delay: 3.4 },
  { startX: 900, startY: 10, dx: 480, dy: 340, period: 11.7, duration: 1.05, delay: 6.2 }
]

function titleSkyAmbience() {
  const elements: ReactEcs.JSX.Element[] = []

  for (let i = 0; i < TITLE_STARS.length; i++) {
    const star = TITLE_STARS[i]
    const alpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(titleTime * star.speed + star.phase))
    elements.push(
      <UiEntity
        key={`star-${i}`}
        uiTransform={{ positionType: 'absolute', position: { left: star.x, top: star.y }, width: star.size, height: star.size }}
        uiBackground={{ color: Color4.create(0.9, 0.95, 1, alpha) }}
      />
    )
  }

  for (let i = 0; i < SHOOTING_STARS.length; i++) {
    const meteor = SHOOTING_STARS[i]
    const cycle = (titleTime + meteor.period - meteor.delay) % meteor.period
    if (cycle > meteor.duration) continue
    const progress = cycle / meteor.duration
    // Bright at launch, burning out at the end of the streak.
    const burn = progress < 0.15 ? progress / 0.15 : 1 - (progress - 0.15) / 0.85

    for (let segment = 0; segment < 7; segment++) {
      const segmentProgress = progress - segment * 0.035
      if (segmentProgress < 0) continue
      const size = segment === 0 ? 5 : 4 - segment * 0.45
      const alpha = burn * (segment === 0 ? 1 : 0.65 - segment * 0.09)
      if (alpha <= 0.02) continue
      elements.push(
        <UiEntity
          key={`meteor-${i}-${segment}`}
          uiTransform={{
            positionType: 'absolute',
            position: { left: meteor.startX + meteor.dx * segmentProgress, top: meteor.startY + meteor.dy * segmentProgress },
            width: size,
            height: size
          }}
          uiBackground={{ color: Color4.create(1, 1, segment === 0 ? 0.92 : 1, Math.min(1, alpha)) }}
        />
      )
    }
  }

  return elements
}

function startScreenOverlay() {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%'
      }}
      uiBackground={{ textureMode: 'stretch', texture: { src: 'images/ui/title-bg-decentracraft.png' } }}
    >
      {titleSkyAmbience()}

      {/* Darkens the artwork behind the race picker so text stays readable. */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { bottom: 0, left: 0 }, width: '100%', height: 470 }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.52) }}
      />

      {/* Logo (transparent PNG) floating over the sky, with a slow breathing drift. */}
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: -34 + Math.sin(titleTime * 0.6) * 7, left: 0 },
          width: '100%',
          height: 560,
          justifyContent: 'center'
        }}
      >
        <UiEntity uiTransform={{ width: 840, height: 560 }} uiBackground={{ textureMode: 'stretch', texture: { src: 'images/ui/logo-decentracraft.png' } }} />
      </UiEntity>

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: 30, left: 0 },
          width: '100%',
          flexDirection: 'column',
          alignItems: 'center'
        }}
      >
        {/* Full-width labels + centered rows: auto-sized children drift left in this UI runtime. */}
        <Label value="CHOOSE YOUR RACE" fontSize={14} color={Color4.create(0.75, 0.78, 0.85, 0.9)} textAlign="middle-center" uiTransform={{ width: '100%', height: 18, margin: { bottom: 14 } }} />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { bottom: 12 } }}>
          {RACE_IDS.map((raceId) => raceCard(raceId))}
        </UiEntity>
        <Label
          value={RACES[gameState.playerRace].tagline}
          fontSize={14}
          color={Color4.create(0.85, 0.87, 0.92, 0.95)}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 18, margin: { bottom: 18 } }}
        />

        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center' }}>
          <UiEntity
            uiTransform={{ width: 300, height: 62, justifyContent: 'center', alignItems: 'center', padding: 3 }}
            uiBackground={{ color: Color4.create(0.35, 0.65, 1, 1) }}
            onMouseDown={() => {
              titleStage = 'setup'
            }}
          >
            <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.06, 0.14, 0.28, 1) }}>
              <Label value="CONTINUE" fontSize={22} color={Color4.create(0.85, 0.93, 1, 1)} textAlign="middle-center" />
            </UiEntity>
          </UiEntity>
        </UiEntity>
        <Label value="Build. Defend. Conquer." fontSize={12} color={Color4.create(0.6, 0.64, 0.72, 0.85)} textAlign="middle-center" uiTransform={{ width: '100%', height: 16, margin: { top: 14 } }} />
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Match setup screen: computers and game mode on the left, hero stats on the
// right, and the middle left transparent so the actual 3D hero model shows
// through - staged on a locked VirtualCamera shot (see rts/heroShowcase.ts).
// ---------------------------------------------------------------------------

function matchSetupOverlay() {
  const race = RACES[gameState.playerRace]

  // Idempotent world-side call: builds the model once per race, swaps on change.
  showHeroShowcase(gameState.playerRace)

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%'
      }}
    >
      {/* Centered header on its own translucent band so it reads over the sky. */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: 44, left: 0 }, width: '100%', flexDirection: 'column', alignItems: 'center' }}
      >
        {/* Explicit heights: auto-sized labels collapse and overlap in this UI runtime. */}
        <Label value="MATCH SETUP" fontSize={44} color={UI.gold} textAlign="middle-center" uiTransform={{ width: '100%', height: 54 }} />
        <Label
          value={`Playing as ${race.name}  ·  ${race.hero.name}`}
          fontSize={16}
          color={Color4.create(0.75, 0.78, 0.85, 0.9)}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 22, margin: { top: 8 } }}
        />
      </UiEntity>

      {/* Left panel: game mode + computer roster. */}
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 200, left: 70 },
          width: 540,
          height: 600,
          flexDirection: 'column',
          padding: { top: 26, bottom: 26, left: 30, right: 30 }
        }}
        uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.9) }}
      >
        <Label value="OPPONENTS" fontSize={22} color={UI.text} textAlign="middle-left" uiTransform={{ margin: { bottom: 18 } }} />
        <Label value="GAME MODE" fontSize={14} color={Color4.create(0.75, 0.78, 0.85, 0.9)} textAlign="middle-left" uiTransform={{ margin: { bottom: 8 } }} />
        {gameModeToggle()}
        <Label value={GAME_MODES.find((mode) => mode.id === gameState.gameMode)?.hint ?? ''} fontSize={12} color={Color4.create(0.55, 0.58, 0.66, 0.9)} textAlign="middle-left" uiTransform={{ margin: { bottom: 18 } }} />
        <Label value="COMPUTERS" fontSize={14} color={Color4.create(0.75, 0.78, 0.85, 0.9)} textAlign="middle-left" uiTransform={{ margin: { bottom: 10 } }} />
        {gameState.opponents.map((_, index) => opponentRow(index))}
        {gameState.opponents.length < 3 ? (
          <UiEntity
            uiTransform={{ width: 180, height: 34, margin: { top: 6 }, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.12, 0.3, 0.16, 0.95) }}
            onMouseDown={() => {
              gameState.opponents.push({ race: 'random', difficulty: 'medium', ally: false })
            }}
          >
            <Label value="+ ADD COMPUTER" fontSize={12} color={UI.text} textAlign="middle-center" />
          </UiEntity>
        ) : null}
      </UiEntity>

      {/* Right panel: hero name, trait and stat sheet (the model itself spins mid-screen). */}
      {heroStatsPanel()}

      {/* Bottom bar: back to race select, or launch the match. */}
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: 46, left: 0 },
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'center'
        }}
      >
        <UiEntity
          uiTransform={{ width: 220, height: 60, margin: { right: 16 }, padding: 3, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.3, 0.36, 0.48, 1) }}
          onMouseDown={() => {
            hideHeroShowcase()
            titleStage = 'title'
          }}
        >
          <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.07, 0.09, 0.14, 1) }}>
            <Label value="BACK" fontSize={20} color={UI.dim} textAlign="middle-center" />
          </UiEntity>
        </UiEntity>
        <UiEntity
          uiTransform={{ width: 320, height: 60, margin: { left: 16 }, padding: 3, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.35, 0.65, 1, 1) }}
          onMouseDown={() => {
            hideHeroShowcase()
            titleStage = 'title'
            startRtsMatch()
          }}
        >
          <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.06, 0.14, 0.28, 1) }}>
            <Label value="START MATCH" fontSize={22} color={Color4.create(0.85, 0.93, 1, 1)} textAlign="middle-center" />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

/** One stat line in the hero panel: label left, value right. */
function heroStatRow(label: string, value: string) {
  return (
    <UiEntity uiTransform={{ width: '100%', height: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Label value={label} fontSize={14} color={UI.dim} textAlign="middle-left" />
      <Label value={value} fontSize={16} color={UI.text} textAlign="middle-right" />
    </UiEntity>
  )
}

function heroStatsPanel() {
  const race = RACES[gameState.playerRace]
  const hero = race.hero
  const portrait = `images/icons/icon-unit-hero${RACE_ICON_SUFFIX[gameState.playerRace]}.png`

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 200, right: 70 },
        width: 540,
        height: 640,
        flexDirection: 'column',
        alignItems: 'center',
        padding: { top: 26, bottom: 26, left: 40, right: 40 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.9) }}
    >
      <Label value="YOUR HERO" fontSize={22} color={UI.text} textAlign="middle-center" uiTransform={{ width: '100%', height: 26 }} />

      <UiEntity uiTransform={{ width: 170, height: 170, margin: { top: 14 }, padding: 3 }} uiBackground={{ color: race.accent }}>
        <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: portrait } }} />
      </UiEntity>

      <Label value={hero.name.toUpperCase()} fontSize={30} color={race.accent} textAlign="middle-center" uiTransform={{ width: '100%', height: 36, margin: { top: 14 } }} />
      <Label
        value={race.heroTrait}
        fontSize={14}
        color={Color4.create(0.85, 0.87, 0.92, 0.95)}
        textAlign="middle-center"
        textWrap="wrap"
        uiTransform={{ width: 440, height: 40, margin: { top: 10, bottom: 14 } }}
      />

      <UiEntity uiTransform={{ width: 420, flexDirection: 'column' }}>
        {heroStatRow('HIT POINTS', `${hero.hp}`)}
        {heroStatRow('DAMAGE', `${hero.damage ?? 0}`)}
        {heroStatRow('ATTACK RANGE', hero.attackRange !== undefined && hero.attackRange > 3 ? `${hero.attackRange} (ranged)` : 'Melee')}
        {heroStatRow('ATTACK SPEED', `every ${hero.attackRate ?? 1}s`)}
        {heroStatRow('MOVE SPEED', `${hero.moveSpeed ?? 0}`)}
        {hero.splashRadius ? heroStatRow('SPLASH RADIUS', `${hero.splashRadius}`) : null}
      </UiEntity>

      <Label
        value="Free at match start. Takes no supply. Cannot be rebuilt if slain."
        fontSize={12}
        color={Color4.create(0.55, 0.58, 0.66, 0.9)}
        textAlign="middle-center"
        uiTransform={{ width: '100%', margin: { top: 26 } }}
      />
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
          // Grows with one stats row per computer opponent, plus the income graph.
          height: 690 + gameState.activeEnemyTeams.length * 72,
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
        {statsRow(`PLAYER (${RACES[gameState.playerRace].name})`, gameState.matchStats.player.unitsProduced, gameState.matchStats.player.unitsKilled, gameState.matchStats.player.resourcesGathered, UI.accent)}
        {gameState.activeEnemyTeams.map((team, index) => {
          const stats = gameState.matchStats[team]
          const ally = isPlayerAlly(team)
          const label = `${ally ? 'ALLY' : 'CPU'} ${index + 1} (${RACES[gameState.enemyRaces[team]].name} · ${AI_DIFFICULTY[gameState.enemyDifficulties[team]].label.toUpperCase()})`
          return statsRow(label, stats.unitsProduced, stats.unitsKilled, stats.resourcesGathered, ally ? ALLY_UI_COLOR : OPPONENT_SLOT_COLORS[index])
        })}

        {incomeGraph()}

        <UiEntity uiTransform={{ width: '100%', height: 58, flexDirection: 'row', justifyContent: 'center', margin: { top: 34 } }}>
          <Button
            value="PLAY AGAIN"
            variant="primary"
            fontSize={24}
            uiTransform={{ width: 240, height: 58, margin: { right: 12 } }}
            uiBackground={{ color: UI.accent }}
            onMouseDown={resetRtsGame}
          />
          <Button
            value="MAIN MENU"
            variant="secondary"
            fontSize={24}
            uiTransform={{ width: 240, height: 58, margin: { left: 12 } }}
            uiBackground={{ color: Color4.create(0.25, 0.32, 0.45, 0.95) }}
            onMouseDown={() => {
              titleStage = 'title'
              returnToMainMenu()
            }}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// End-screen income graph: each faction's cumulative harvest plotted over time
// from the per-team samples recorded during the match.
// ---------------------------------------------------------------------------

const GRAPH_WIDTH = 880
const GRAPH_HEIGHT = 140
/** Cap plotted points per team so long matches don't flood the UI with entities. */
const GRAPH_MAX_POINTS = 40

function incomeGraph() {
  const teams: { team: Team; color: Color4 }[] = [
    { team: 'player', color: UI.accent },
    ...gameState.activeEnemyTeams.map((team, index) => ({
      team: team as Team,
      color: isPlayerAlly(team) ? ALLY_UI_COLOR : OPPONENT_SLOT_COLORS[index]
    }))
  ]

  const maxSamples = Math.max(...teams.map(({ team }) => gameState.incomeHistory[team].length))
  const maxValue = Math.max(1, ...teams.map(({ team }) => gameState.incomeHistory[team][gameState.incomeHistory[team].length - 1] ?? 0))
  const stride = Math.max(1, Math.ceil(maxSamples / GRAPH_MAX_POINTS))

  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center', margin: { top: 18 } }}>
      <Label value="RESOURCES GATHERED OVER TIME" fontSize={14} color={UI.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: 18 }} />
      <UiEntity uiTransform={{ width: GRAPH_WIDTH, height: GRAPH_HEIGHT, margin: { top: 6 } }} uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.95) }}>
        {maxSamples < 2 ? (
          <Label value="Match too short to graph." fontSize={14} color={UI.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
        ) : (
          teams.map(({ team, color }) => {
            const samples = gameState.incomeHistory[team]
            const dots = []
            for (let i = 0; i < samples.length; i += stride) {
              // Always keep the final sample so every line ends at its true total.
              const index = i + stride >= samples.length ? samples.length - 1 : i
              const x = 3 + (index / Math.max(1, maxSamples - 1)) * (GRAPH_WIDTH - 11)
              const y = 3 + (1 - samples[index] / maxValue) * (GRAPH_HEIGHT - 11)
              dots.push(
                <UiEntity
                  key={`income-${team}-${index}`}
                  uiTransform={{ positionType: 'absolute', position: { left: x, top: y }, width: 5, height: 5 }}
                  uiBackground={{ color }}
                />
              )
            }
            return (
              <UiEntity key={`income-line-${team}`} uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%' }}>
                {dots}
              </UiEntity>
            )
          })
        )}
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
      <Label value={team} fontSize={team.length > 20 ? 15 : 21} color={color} textAlign="middle-center" uiTransform={{ width: 225, height: '100%' }} />
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
  if (kind === 'temple') return 'MAIN BASE / WORKERS'
  if (kind === 'worker') return 'WORKER'
  if (kind === 'resource') return 'RESOURCE'
  if (kind === 'supplyHouse') return 'SUPPLY'
  if (kind === 'barracks') return 'TIER 1 PRODUCTION'
  if (kind === 'techLab') return 'TIER 2 PRODUCTION'
  if (kind === 'forge') return 'RESEARCH'
  if (kind === 'turret') return 'DEFENSE'
  if (kind === 'fireplace') return 'UTILITY'
  if (kind === 'soldier') return 'FIGHTER'
  if (kind === 'enemyBuilding') return 'ENEMY'
  return 'COMMANDS'
}
