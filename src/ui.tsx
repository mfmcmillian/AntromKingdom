import ReactEcs, { Button, Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  cancelBuildingPlacement,
  cancelSelectedConstruction,
  canCancelSelectedConstruction,
  endRtsMatch,
  gameState,
  getIdleWorkerCount,
  getSelectedProductionQueue,
  getSelectedSummary,
  getSelectedUnitsInfo,
  isBuildingUnlocked,
  isUnitUnlocked,
  queueWorker,
  queueSoldier,
  resetRtsGame,
  selectAllLikeSelected,
  selectIdleWorker,
  selectUnitById,
  setBarracksSpawnPoint,
  setWorkerSpawnPoint,
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
import type { BuildableKind, RaceId, ResourceCost, SelectedSummary, SoldierVariant, UpgradeKind } from './rts/types'

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

// StarCraft-style command card icons (generated art, shared across races).
const ICON = {
  building: {
    temple: 'images/icons/icon-building-temple.png',
    supplyHouse: 'images/icons/icon-building-supply.png',
    barracks: 'images/icons/icon-building-barracks.png',
    techLab: 'images/icons/icon-building-techlab.png',
    forge: 'images/icons/icon-building-forge.png',
    fireplace: 'images/icons/icon-building-fireplace.png'
  } as Record<BuildableKind, string>,
  unit: {
    worker: 'images/icons/icon-unit-worker.png',
    melee: 'images/icons/icon-unit-melee.png',
    ranged: 'images/icons/icon-unit-ranged.png',
    caster: 'images/icons/icon-unit-caster.png',
    flyer: 'images/icons/icon-unit-flyer.png',
    titan: 'images/icons/icon-unit-titan.png'
  } as Record<string, string>,
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
    selectAll: 'images/icons/icon-action-selectall.png'
  }
}

// Bottom console geometry (virtual 1920x1080).
const CONSOLE_HEIGHT = 250
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

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
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

      {minimapPanel()}
      {dragSelectionRect()}

      {gameState.matchStatus === 'notStarted' ? startScreenOverlay() : null}
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
  const supplyCapped = gameState.supplyUsed >= gameState.supplyCap

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
      {resourceCounter(ICON.resource.minerals, gameState.minerals.toString(), UI.text)}
      {resourceCounter(ICON.resource.gas, gameState.gas.toString(), UI.text)}
      {resourceCounter(ICON.resource.supply, `${gameState.supplyUsed}/${gameState.supplyCap}`, supplyCapped ? UI.red : UI.text)}
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
  const isEnemy = selected.team === 'enemy'
  const hpRatio = selected.hp !== undefined && selected.maxHp ? Math.max(0, Math.min(1, selected.hp / selected.maxHp)) : undefined

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: 14, left: 320 },
        width: 1160,
        height: CONSOLE_HEIGHT - 34,
        flexDirection: 'row'
      }}
    >
      {multi ? wireframeGrid(units) : null}

      {portrait ? (
        <UiEntity uiTransform={{ width: 156, height: 156, padding: 3, margin: { top: 20, right: 22 } }} uiBackground={{ color: UI.slotFrame }}>
          <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: portrait } }} />
        </UiEntity>
      ) : null}

      <UiEntity uiTransform={{ flexDirection: 'column', width: 470, height: '100%', padding: { top: 24 } }}>
        <Label value={getCommandTitle(selected.kind)} fontSize={13} color={isEnemy ? UI.red : UI.dim} textAlign="middle-left" />
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

      {multi ? null : productionQueuePanel(selected)}
    </UiEntity>
  )
}

/** SC-style multi-selection wireframes, left of the portrait: unit images whose
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
        margin: { right: 20 },
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
              uiBackground={{ textureMode: 'stretch', texture: { src: unit.kind === 'worker' ? ICON.unit.worker : ICON.unit[unit.variant ?? 'melee'] } }}
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
  if (selected.team === 'enemy') return null
  const queue = getSelectedProductionQueue()
  if (!queue) return null

  const icon = selected.kind === 'supplyHouse' ? ICON.unit.worker : ICON.unit[queue.variant ?? 'melee']

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
  const isPlayerSelection = selected.team !== 'enemy'

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
    const buildOrder: BuildableKind[] = ['temple', 'supplyHouse', 'barracks', 'techLab', 'forge', 'fireplace']
    for (const kind of buildOrder) {
      const definition = BUILDING_DEFINITIONS[kind]
      const displayName = getBuildingDisplayName(kind, 'player')
      slots.push({
        id: `build-${kind}`,
        icon: ICON.building[kind],
        name: `Build ${displayName}`,
        cost: definition.cost,
        description: getBuildingDescription(kind),
        locked: definition.requires && !isBuildingUnlocked(kind) ? `Requires ${getBuildingDisplayName(definition.requires, 'player')}` : undefined,
        onClick: () => startWorkerBuildingPlacement(kind)
      })
    }
    slots.push(selectAllSlot(`all ${getWorkerDefinition('player').name}s`))
  }

  if (selected.kind === 'supplyHouse') {
    const worker = getWorkerDefinition('player')
    slots.push({
      id: 'train-worker',
      icon: ICON.unit.worker,
      name: `Train ${worker.name}`,
      cost: worker.cost,
      description: 'Gathers minerals and gas, builds and repairs structures.',
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
    icon: ICON.unit[variant],
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
  if (selected.kind === 'worker') return ICON.unit.worker
  if (selected.kind === 'soldier') return ICON.unit[selected.variant ?? 'melee']
  if (selected.kind === 'resource') return selected.resourceKind === 'gas' ? ICON.resource.gas : ICON.resource.minerals
  if (selected.kind in ICON.building) return ICON.building[selected.kind as BuildableKind]
  return undefined
}

function getBuildingDescription(kind: BuildableKind): string {
  const race = getRace('player')
  if (kind === 'temple') return 'Main base. Workers deliver resources here. Lose all of them and you lose.'
  if (kind === 'supplyHouse') return `Trains ${race.worker.name}s and raises your supply cap.`
  if (kind === 'barracks') return `Tier 1 production: ${race.melee.name}s and ${race.ranged.name}s.`
  if (kind === 'techLab') return `Tier 2 production: ${race.caster.name}s, ${race.flyer.name}s and ${race.titan.name}s.`
  if (kind === 'forge') return 'Researches Weapons and Propulsion upgrades. Unlocks the titan.'
  return 'A camp utility building.'
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
        // Floats just above the minimap in the bottom-right corner.
        position: { bottom: MINIMAP_SPAN + 20, right: 12 },
        width: 62,
        height: 62,
        padding: 2
      }}
      uiBackground={{ color: UI.slotFrame }}
      onMouseDown={selectIdleWorker}
    >
      <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: ICON.unit.worker } }}>
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

  return (
    <UiEntity
      key={`race-${raceId}`}
      uiTransform={{
        width: 190,
        height: 96,
        margin: { left: 8, right: 8 },
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8
      }}
      uiBackground={{ color: isSelected ? Color4.create(race.color.r * 0.35, race.color.g * 0.35, race.color.b * 0.35, 0.95) : Color4.create(0.07, 0.08, 0.1, 0.9) }}
      onMouseDown={() => {
        gameState.playerRace = raceId
      }}
    >
      <UiEntity uiTransform={{ width: '100%', height: 3, margin: { bottom: 10 } }} uiBackground={{ color: isSelected ? race.accent : Color4.create(0.25, 0.26, 0.3, 0.8) }} />
      <Label value={race.name} fontSize={17} color={isSelected ? Color4.White() : Color4.create(0.7, 0.7, 0.72, 1)} textAlign="middle-center" />
      <Label
        value={`${race.worker.name} + ${race.melee.name} + ${race.ranged.name}`}
        fontSize={11}
        color={isSelected ? race.accent : Color4.create(0.5, 0.5, 0.54, 0.9)}
        textAlign="middle-center"
        uiTransform={{ margin: { top: 6 } }}
      />
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
          uiTransform={{ margin: { bottom: 26 } }}
        />

        <Label value="CHOOSE YOUR RACE" fontSize={13} color={Color4.create(0.58, 0.55, 0.5, 0.85)} textAlign="middle-center" uiTransform={{ margin: { bottom: 12 } }} />
        <UiEntity uiTransform={{ flexDirection: 'row', justifyContent: 'center', margin: { bottom: 10 } }}>
          {RACE_IDS.map((raceId) => raceCard(raceId))}
        </UiEntity>
        <Label
          value={RACES[gameState.playerRace].tagline}
          fontSize={13}
          color={Color4.create(0.75, 0.73, 0.7, 0.9)}
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
        {statsRow(`PLAYER (${RACES[gameState.playerRace].name})`, gameState.matchStats.player.unitsProduced, gameState.matchStats.player.unitsKilled, gameState.matchStats.player.resourcesGathered, UI.accent)}
        {statsRow(`AI (${RACES[gameState.enemyRace].name})`, gameState.matchStats.enemy.unitsProduced, gameState.matchStats.enemy.unitsKilled, gameState.matchStats.enemy.resourcesGathered, UI.red)}

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
  if (kind === 'temple') return 'MAIN BASE'
  if (kind === 'worker') return 'WORKER'
  if (kind === 'resource') return 'RESOURCE'
  if (kind === 'supplyHouse') return 'SUPPLY / WORKERS'
  if (kind === 'barracks') return 'TIER 1 PRODUCTION'
  if (kind === 'techLab') return 'TIER 2 PRODUCTION'
  if (kind === 'forge') return 'RESEARCH'
  if (kind === 'fireplace') return 'UTILITY'
  if (kind === 'soldier') return 'FIGHTER'
  if (kind === 'enemyBuilding') return 'ENEMY'
  return 'COMMANDS'
}
