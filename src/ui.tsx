import ReactEcs, { Button, Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { playUiClick } from './rts/sound'
import { InputModifier, UiCanvasInformation, engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  assignControlGroup,
  cancelBuildingPlacement,
  cancelSelectedConstruction,
  canCancelSelectedConstruction,
  castSelectedHeroAbility,
  getSelectedHeroAbility,
  getSelectedSiegeMode,
  getSelectedTransportCargo,
  toggleSelectedSiegeMode,
  unloadSelectedTransport,
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
  getMatchRoster,
  getMultiplayerTeamName,
  isBuildingUnlocked,
  isMultiplayerHumanTeam,
  isMultiplayerMatch,
  isRankedMultiplayerMatch,
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
  applyRemoteCommand,
  startAttackMove,
  startPatrol,
  startRepairOrder,
  startRtsMatch,
  stopSelectedUnits,
  surrenderMatch,
  startMultiplayerRtsMatch,
  startUpgradeResearch,
  startWorkerBuildingPlacement
} from './rtsGame'
import {
  canStartMatch as canStartMultiplayerMatch,
  claimSeat,
  getLobbies,
  getLobby,
  getMyAddress,
  getMyLobbyId,
  getMyRankedRating,
  getMySeatIndex,
  getPresentPlayerCount,
  getPresentPlayers,
  getRankedEntry,
  getRankedLadder,
  getViewedLobbyId,
  requestLobbyReset,
  hostSetMap,
  hostSetSeat,
  hostStartMatch,
  isHost,
  leaveSeat,
  onMatchStart,
  setMyAlliance,
  setMyRace,
  setMyReady,
  setViewedLobbyId
} from './rts/multiplayer/session'
import { buildLocalMatchPlan } from './rts/multiplayer/seatMap'
import { startCommandRelay } from './rts/multiplayer/commandRelay'
import { RANKED_START_RATING, lobbyRoomName, type LobbyConfig, type LobbySeat } from './rts/multiplayer/protocol'
import { getDragScreenRect } from './rts/dragSelect'
import { MAPS, getMapById, getNextMapId } from './rts/maps'
import { minimapPanel } from './rts/minimap'
import { BUILDING_DEFINITIONS } from './rts/config'
import { RACES, RACE_IDS, TRANSPORT_CAPACITY, UNIT_REQUIREMENTS, getBuildingDisplayName, getRace, getSoldierDefinition, getWorkerDefinition, isAirVariant } from './rts/races'
import { UPGRADE_INFO, UPGRADE_MAX_LEVEL, getNextUpgradeCost, getUpgradeLevel, getUpgradeProgress, isUpgradeInProgress } from './rts/upgrades'
import { isTopDownViewActive, toggleTopDownView } from './rts/topDownCamera'
import { CONSOLE_HEIGHT } from './rts/hud'
import { DIFFICULTY_IDS, AI_DIFFICULTY } from './rts/config'
import { isPlayerAlly } from './rts/state'
import { hideHeroShowcase } from './rts/heroShowcase'
import type { BuildableKind, EnemyTeam, GameMode, RaceId, ResourceCost, SelectedSummary, SoldierVariant, Team, UpgradeKind } from './rts/types'

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
  airForge: 'icon-building-airforge',
  fireplace: 'icon-building-fireplace',
  turret: 'icon-building-turret'
}

const UNIT_ICON_FILES: Record<SoldierVariant | 'worker', string> = {
  worker: 'icon-unit-worker',
  melee: 'icon-unit-melee',
  ranged: 'icon-unit-ranged',
  healer: 'icon-unit-healer',
  caster: 'icon-unit-caster',
  antiAir: 'icon-unit-antiair',
  flyer: 'icon-unit-flyer',
  transport: 'icon-unit-transport',
  heavyAir: 'icon-unit-heavyair',
  siege: 'icon-unit-siege',
  titan: 'icon-unit-titan',
  hero: 'icon-unit-hero'
}

const RACE_ICON_SUFFIX: Record<RaceId, string> = { human: '', alien: '-alien', bio: '-bio' }

function raceIdFor(team: Team | undefined): RaceId {
  if (!team || team === 'player') return gameState.playerRace
  return gameState.enemyRaces[team]
}

function buildingIcon(kind: BuildableKind, team?: Team): string {
  return `images/icons/${BUILDING_ICON_FILES[kind]}${RACE_ICON_SUFFIX[raceIdFor(team)]}.jpg`
}

function unitIcon(unit: SoldierVariant | 'worker', team?: Team): string {
  return `images/icons/${UNIT_ICON_FILES[unit]}${RACE_ICON_SUFFIX[raceIdFor(team)]}.jpg`
}

const ICON = {
  upgrade: {
    damage: 'images/icons/icon-upgrade-damage.jpg',
    speed: 'images/icons/icon-upgrade-speed.jpg',
    airDamage: 'images/icons/icon-upgrade-airdamage.jpg',
    airSpeed: 'images/icons/icon-upgrade-airspeed.jpg'
  } as Record<UpgradeKind, string>,
  resource: {
    minerals: 'images/icons/icon-res-minerals.jpg',
    gas: 'images/icons/icon-res-gas.jpg',
    supply: 'images/icons/icon-res-supply.jpg'
  },
  action: {
    rally: 'images/icons/icon-action-rally.jpg',
    cancel: 'images/icons/icon-action-cancel.jpg',
    selectAll: 'images/icons/icon-action-selectall.jpg',
    attackMove: 'images/icons/icon-action-attackmove.jpg',
    patrol: 'images/icons/icon-action-patrol.jpg',
    stance: 'images/icons/icon-action-stance.jpg',
    siegeMode: 'images/icons/icon-action-siegemode.jpg',
    unload: 'images/icons/icon-action-unload.jpg',
    repair: 'images/icons/icon-action-repair.jpg',
    build: 'images/icons/icon-action-build.jpg',
    buildAdvanced: 'images/icons/icon-action-buildadvanced.jpg'
  },
  heroAbility: {
    human: 'images/icons/icon-hero-rallycry.jpg',
    alien: 'images/icons/icon-hero-riftnova.jpg',
    bio: 'images/icons/icon-hero-birthsurge.jpg'
  } as Record<string, string>,
  endgame: {
    victory: 'images/icons/icon-endgame-victory.jpg',
    defeat: 'images/icons/icon-endgame-defeat.jpg',
    units: 'images/icons/icon-stat-units.jpg',
    kills: 'images/icons/icon-stat-kills.jpg',
    resources: 'images/icons/icon-stat-resources.jpg'
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

// Pre-match menu flow: title screen (race pick) -> match setup (opponents + hero),
// or title -> multiplayer lobby when playing against other people.
let titleStage: 'title' | 'setup' | 'lobby' = 'title'

// Screen-transition fade: snaps to black on every screen change, holds a beat
// while the next screen stages itself (camera moves, showcase builds), then
// fades out - hiding the split-second flash of the raw world between screens.
const FADE_SECONDS = 0.8
let screenFade = 0

function triggerScreenFade(): void {
  screenFade = 1
}

function screenFadeOverlay() {
  // Hold fully black for the first ~30% of the fade, then ease out.
  const alpha = Math.min(1, screenFade / 0.7)
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%' }}
      uiBackground={{ color: Color4.create(0, 0, 0, alpha) }}
    />
  )
}

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

// The whole HUD is laid out on a 1920x1080 virtual canvas.
const VIRTUAL_WIDTH = 1920
const VIRTUAL_HEIGHT = 1080

// react-ecs 7.25 divides the UI scale factor by devicePixelRatio (a mobile
// fix); this layout was tuned under the 7.23 formula (no dpr). Shrinking the
// virtual canvas by the same ratio cancels the division exactly, so the UI
// renders at the size it was designed for on any display scaling.
let appliedDpr = 0

function applyUiScaleCompensation(): void {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const dpr = canvas?.devicePixelRatio || 1
  if (dpr === appliedDpr) return
  appliedDpr = dpr
  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: VIRTUAL_WIDTH / dpr, virtualHeight: VIRTUAL_HEIGHT / dpr })
}

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: VIRTUAL_WIDTH, virtualHeight: VIRTUAL_HEIGHT })
  engine.addSystem((dt: number) => {
    applyUiScaleCompensation()
    if (gameState.matchStatus === 'notStarted') titleTime += dt
    screenFade = Math.max(0, screenFade - dt / FADE_SECONDS)
    updateMenuMovementLock()
  })

  // Host pressed start in the multiplayer lobby: every seated client builds
  // its own seat-to-team view of the frozen lobby and launches the match.
  onMatchStart((config) => {
    const plan = buildLocalMatchPlan(config, getMyAddress())
    if (!plan) return // no seat: stay in the lobby as a spectator
    if (gameState.matchStatus === 'active') return
    triggerScreenFade()
    hideHeroShowcase()
    titleStage = 'title'
    startMultiplayerRtsMatch(plan)
    // Remote players' orders (relayed by the server) replay on our sim here.
    startCommandRelay(plan, getMyAddress(), applyRemoteCommand)
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
      {gameState.matchStatus === 'active' ? matchRosterButton() : null}
      {gameState.matchStatus === 'active' ? matchRosterPanel() : null}

      {minimapPanel()}
      {dragSelectionRect()}

      {gameState.matchStatus === 'notStarted'
        ? titleStage === 'title'
          ? startScreenOverlay()
          : titleStage === 'setup'
            ? matchSetupOverlay()
            : multiplayerLobbyOverlay()
        : null}
      {gameState.matchStatus === 'ended' ? endGameOverlay() : null}
      {!showSettingsMenu ? menuButton() : null}
      {showSettingsMenu ? settingsOverlay() : null}
      {screenFade > 0 ? screenFadeOverlay() : null}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Top HUD: resources (SC style: icon + count, top-right) and alerts.
// ---------------------------------------------------------------------------

let supplyTooltipHovered = false

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
      <UiEntity
        uiTransform={{ flexDirection: 'row', alignItems: 'center', height: '100%' }}
        onMouseEnter={() => {
          supplyTooltipHovered = true
        }}
        onMouseLeave={() => {
          supplyTooltipHovered = false
        }}
      >
        {resourceCounter(ICON.resource.supply, `${playerEconomy.supplyUsed}/${playerEconomy.supplyCap}`, supplyCapped ? UI.red : UI.text)}
      </UiEntity>
      {supplyTooltipHovered ? supplyTooltip(playerEconomy.supplyUsed, playerEconomy.supplyCap, supplyCapped) : null}
    </UiEntity>
  )
}

/** Hover tooltip for the supply counter: what the numbers mean and how to raise the cap. */
function supplyTooltip(used: number, cap: number, capped: boolean) {
  const supplyHouseName = getBuildingDisplayName('supplyHouse', 'player')
  const supplyHouseAdds = BUILDING_DEFINITIONS.supplyHouse.supplyAdds
  const templeName = getBuildingDisplayName('temple', 'player')
  const templeAdds = BUILDING_DEFINITIONS.temple.supplyAdds

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 50, right: 0 },
        width: 360,
        flexDirection: 'column',
        padding: { top: 10, bottom: 10, left: 14, right: 14 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.04, 0.07, 0.95) }}
    >
      <Label value="SUPPLY" fontSize={15} color={UI.gold} textAlign="middle-left" uiTransform={{ width: '100%', height: 20 }} />
      <Label
        value={`Army size: ${used} supply used of a ${cap} cap. Every unit you train takes supply.`}
        fontSize={13}
        color={UI.text}
        textAlign="top-left"
        textWrap="wrap"
        uiTransform={{ width: '100%', height: 36, margin: { top: 4 } }}
      />
      <Label
        value={`Build ${supplyHouseName}s (+${supplyHouseAdds} each) or ${templeName}s (+${templeAdds} each) to raise the cap and field a bigger army.`}
        fontSize={13}
        color={UI.dim}
        textAlign="top-left"
        textWrap="wrap"
        uiTransform={{ width: '100%', height: 36, margin: { top: 2 } }}
      />
      {capped ? (
        <Label
          value="Supply capped! You cannot train more units until you add supply."
          fontSize={13}
          color={UI.red}
          textAlign="top-left"
          textWrap="wrap"
          uiTransform={{ width: '100%', height: 34, margin: { top: 2 } }}
        />
      ) : null}
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

/** Whether the mid-screen commanders panel is open (toggled by the HUD button). */
let showRosterPanel = false

/** Small HUD button under the resource bar that opens the commanders panel. */
function matchRosterButton() {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 64, right: 12 },
        width: 130,
        height: 32,
        justifyContent: 'center',
        alignItems: 'center'
      }}
      uiBackground={{ color: showRosterPanel ? Color4.create(0.12, 0.2, 0.32, 0.95) : Color4.create(0.02, 0.03, 0.05, 0.78) }}
      onMouseDown={() => {
        playUiClick()
        showRosterPanel = !showRosterPanel
      }}
    >
      <Label value="PLAYERS" fontSize={14} color={UI.text} textAlign="middle-center" />
    </UiEntity>
  )
}

/**
 * StarCraft-style mid-screen commanders panel: everyone in the match with seat
 * color, race, human/CPU, ally tag, and OUT the moment their last building falls.
 */
function matchRosterPanel() {
  if (!showRosterPanel) return null
  const roster = getMatchRoster()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 240, left: '50%' },
        margin: { left: -280 },
        width: 560,
        flexDirection: 'column',
        padding: { top: 20, bottom: 20, left: 26, right: 26 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.94) }}
    >
      <UiEntity uiTransform={{ width: '100%', height: 30, flexDirection: 'row', alignItems: 'center', margin: { bottom: 14 } }}>
        <Label value="COMMANDERS" fontSize={22} color={UI.gold} textAlign="middle-left" uiTransform={{ width: 420, height: '100%' }} />
        <UiEntity
          uiTransform={{ width: 34, height: 30, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.45, 0.12, 0.12, 0.9) }}
          onMouseDown={() => {
            showRosterPanel = false
          }}
        >
          <Label value="X" fontSize={14} color={UI.text} textAlign="middle-center" />
        </UiEntity>
      </UiEntity>

      {roster.map((entry) => (
        <UiEntity
          key={`roster-${entry.team}`}
          uiTransform={{ width: '100%', height: 42, flexDirection: 'row', alignItems: 'center', margin: { bottom: 6 }, padding: { left: 12, right: 12 } }}
          uiBackground={{ color: entry.team === 'player' ? Color4.create(0.08, 0.11, 0.17, 0.95) : Color4.create(0.05, 0.06, 0.09, 0.92) }}
        >
          <UiEntity uiTransform={{ width: 14, height: 14, margin: { right: 12 } }} uiBackground={{ color: LOBBY_SEAT_COLORS[entry.seat] ?? UI.dim }} />
          <Label
            value={entry.name}
            fontSize={16}
            color={entry.eliminated ? Color4.create(0.5, 0.38, 0.38, 0.85) : UI.text}
            textAlign="middle-left"
            textWrap="nowrap"
            uiTransform={{ width: 200, height: '100%' }}
          />
          <Label value={RACES[entry.race].name.toUpperCase()} fontSize={12} color={RACES[entry.race].accent} textAlign="middle-left" uiTransform={{ width: 120, height: '100%' }} />
          <Label
            value={entry.team === 'player' ? 'YOU' : entry.ally ? 'ALLY' : entry.isHuman ? 'HUMAN' : 'CPU'}
            fontSize={12}
            color={entry.team === 'player' || entry.ally ? UI.gold : UI.dim}
            textAlign="middle-left"
            uiTransform={{ width: 80, height: '100%' }}
          />
          <Label
            value={entry.eliminated ? 'ELIMINATED' : 'IN COMMAND'}
            fontSize={12}
            color={entry.eliminated ? UI.red : UI.green}
            textAlign="middle-right"
            uiTransform={{ width: 90, height: '100%' }}
          />
        </UiEntity>
      ))}
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
        {selected.kind === 'soldier' ? upgradeBadgesRow(selected.team ?? 'player', selected.variant) : null}
        {(selected.kind === 'forge' || selected.kind === 'airForge') && !isEnemy ? (
          <Label
            value={
              selected.kind === 'forge'
                ? `${UPGRADE_INFO.damage.name} Lv${getUpgradeLevel('player', 'damage')}  |  ${UPGRADE_INFO.speed.name} Lv${getUpgradeLevel('player', 'speed')}`
                : `${UPGRADE_INFO.airDamage.name} Lv${getUpgradeLevel('player', 'airDamage')}  |  ${UPGRADE_INFO.airSpeed.name} Lv${getUpgradeLevel('player', 'airSpeed')}`
            }
            fontSize={14}
            color={race.accent}
            textAlign="middle-left"
            uiTransform={{ margin: { top: 6 } }}
          />
        ) : null}
      </UiEntity>

      {multi ? wireframeGrid(units) : selected.kind === 'forge' || selected.kind === 'airForge' ? researchQueuePanel(selected) : transportCargoPanel() ?? productionQueuePanel(selected)}
    </UiEntity>
  )
}

/** Research readout for the forge / air forge, mirroring the unit production panel:
 * upgrade icon, progress bar, and the level being researched. */
function researchQueuePanel(selected: SelectedSummary) {
  if (selected.team !== undefined && selected.team !== 'player') return null

  const kinds: UpgradeKind[] = selected.kind === 'airForge' ? ['airDamage', 'airSpeed'] : ['damage', 'speed']
  const active = kinds
    .map((kind) => ({ kind, progress: getUpgradeProgress('player', kind) }))
    .filter((entry) => entry.progress !== undefined)
  if (active.length === 0) return null

  return (
    <UiEntity uiTransform={{ flexDirection: 'column', width: 300, height: '100%', padding: { top: 30 } }}>
      <Label value="RESEARCH" fontSize={13} color={UI.dim} textAlign="middle-left" uiTransform={{ margin: { bottom: 8 } }} />
      {active.map((entry) => (
        <UiEntity key={`research-${entry.kind}`} uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { bottom: 8 } }}>
          <UiEntity uiTransform={{ width: 56, height: 56, padding: 2, margin: { right: 12 } }} uiBackground={{ color: UI.slotFrame }}>
            <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: ICON.upgrade[entry.kind] } }} />
          </UiEntity>
          <UiEntity uiTransform={{ flexDirection: 'column', width: 200 }}>
            <UiEntity uiTransform={{ width: 200, height: 12, padding: 2 }} uiBackground={{ color: UI.panelStrong }}>
              <UiEntity uiTransform={{ width: Math.max(2, 196 * (entry.progress ?? 0)), height: '100%' }} uiBackground={{ color: UI.accent }} />
            </UiEntity>
            <Label
              value={`${UPGRADE_INFO[entry.kind].name} Lv${getUpgradeLevel('player', entry.kind) + 1}`}
              fontSize={14}
              color={UI.text}
              textAlign="middle-left"
              uiTransform={{ margin: { top: 6 } }}
            />
          </UiEntity>
        </UiEntity>
      ))}
    </UiEntity>
  )
}

/** SC-style upgrade icons under the unit details: the researched weapon /
 * propulsion levels that apply to this unit (air tracks for flyers). */
function upgradeBadgesRow(team: Team, variant?: SoldierVariant) {
  const kinds: UpgradeKind[] = variant && isAirVariant(variant) ? ['airDamage', 'airSpeed'] : ['damage', 'speed']
  const upgrades = kinds
    .map((kind) => ({ kind, level: getUpgradeLevel(team, kind) }))
    .filter((upgrade) => upgrade.level > 0)
  if (upgrades.length === 0) return null

  return (
    <UiEntity uiTransform={{ flexDirection: 'row', margin: { top: 8 } }}>
      {upgrades.map((upgrade) => (
        <UiEntity
          key={`upg-${upgrade.kind}`}
          uiTransform={{ width: 40, height: 40, padding: 2, margin: { right: 8 } }}
          uiBackground={{ color: UI.slotFrame }}
        >
          <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: ICON.upgrade[upgrade.kind] } }} />
          <UiEntity
            uiTransform={{ positionType: 'absolute', position: { bottom: 1, right: 1 }, width: 16, height: 16, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0, 0, 0, 0.75) }}
          >
            <Label value={`${upgrade.level}`} fontSize={12} color={UI.gold} textAlign="middle-center" />
          </UiEntity>
        </UiEntity>
      ))}
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

/** Cargo hold readout for a selected transport: one portrait per rider, plus
 * empty frames so the remaining capacity is visible at a glance. */
function transportCargoPanel() {
  const cargo = getSelectedTransportCargo()
  if (!cargo) return null

  const emptySlots = Math.max(0, cargo.capacity - cargo.units.length)
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', width: 300, height: '100%', padding: { top: 30 } }}>
      <Label value={`CARGO  ${cargo.count}/${cargo.capacity}`} fontSize={13} color={UI.dim} textAlign="middle-left" uiTransform={{ margin: { bottom: 8 } }} />
      <UiEntity uiTransform={{ flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start', width: 300 }}>
        {cargo.units.map((rider) => (
          <UiEntity key={`cargo-${rider.id}`} uiTransform={{ width: 54, height: 54, margin: { right: 6, bottom: 6 }, padding: 2 }} uiBackground={{ color: UI.slotFrame }}>
            <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: unitIcon(rider.variant) } }} />
          </UiEntity>
        ))}
        {Array.from({ length: emptySlots }).map((_, index) => (
          <UiEntity key={`cargo-empty-${index}`} uiTransform={{ width: 54, height: 54, margin: { right: 6, bottom: 6 } }} uiBackground={{ color: UI.cardSoft }} />
        ))}
      </UiEntity>
    </UiEntity>
  )
}

/**
 * SC-style production readout: the active order's icon with its progress bar,
 * then the rest of the queue as an icon strip so you can see what's coming.
 */
function productionQueuePanel(selected: SelectedSummary) {
  if (selected.team !== undefined && selected.team !== 'player') return null
  const queue = getSelectedProductionQueue()
  if (!queue || queue.entries.length === 0) return null

  const entryIcon = (entry: SoldierVariant | 'worker') => unitIcon(entry)
  const waiting = queue.entries.slice(1, 6)
  const overflow = queue.entries.length - 1 - waiting.length

  return (
    <UiEntity uiTransform={{ flexDirection: 'column', width: 300, height: '100%', padding: { top: 30 } }}>
      <Label value="PRODUCTION" fontSize={13} color={UI.dim} textAlign="middle-left" uiTransform={{ margin: { bottom: 8 } }} />
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
        <UiEntity uiTransform={{ width: 56, height: 56, padding: 2, margin: { right: 12 } }} uiBackground={{ color: UI.accent }}>
          <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: entryIcon(queue.entries[0]) } }} />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'column', width: 200 }}>
          <UiEntity uiTransform={{ width: 200, height: 12, padding: 2 }} uiBackground={{ color: UI.panelStrong }}>
            <UiEntity uiTransform={{ width: Math.max(2, 196 * queue.progress), height: '100%' }} uiBackground={{ color: UI.accent }} />
          </UiEntity>
          <Label value={`In queue: ${queue.count}`} fontSize={14} color={UI.text} textAlign="middle-left" uiTransform={{ margin: { top: 6 } }} />
        </UiEntity>
      </UiEntity>
      {waiting.length > 0 ? (
        <UiEntity uiTransform={{ flexDirection: 'row', margin: { top: 8 } }}>
          {waiting.map((entry, index) => (
            <UiEntity key={`queue-${index}`} uiTransform={{ width: 36, height: 36, margin: { right: 5 }, padding: 2 }} uiBackground={{ color: UI.slotFrame }}>
              <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: entryIcon(entry) } }} />
            </UiEntity>
          ))}
          {overflow > 0 ? (
            <UiEntity uiTransform={{ width: 36, height: 36, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: UI.cardSoft }}>
              <Label value={`+${overflow}`} fontSize={13} color={UI.text} textAlign="middle-center" />
            </UiEntity>
          ) : null}
        </UiEntity>
      ) : null}
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
        if (locked) return
        playUiClick()
        slot.onClick()
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

/** StarCraft-style build submenus: the worker's root card only holds two build
 * buttons; each opens a page of structures so the card never overflows. */
let workerBuildMenu: 'basic' | 'advanced' | null = null

const BUILD_MENU_PAGES: Record<'basic' | 'advanced', BuildableKind[]> = {
  basic: ['temple', 'supplyHouse', 'barracks', 'fireplace'],
  advanced: ['techLab', 'forge', 'airForge', 'turret']
}

function getCommandSlots(selected: SelectedSummary): CommandSlot[] {
  const slots: CommandSlot[] = []
  const isPlayerSelection = selected.team === undefined || selected.team === 'player'

  // Selecting anything else closes an open build page.
  if (selected.kind !== 'worker' && workerBuildMenu) workerBuildMenu = null

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
    // Inside a build page: that page's structures plus a Back button.
    if (workerBuildMenu) {
      for (const kind of BUILD_MENU_PAGES[workerBuildMenu]) {
        const definition = BUILDING_DEFINITIONS[kind]
        const displayName = getBuildingDisplayName(kind, 'player')
        slots.push({
          id: `build-${kind}`,
          icon: buildingIcon(kind),
          name: `Build ${displayName}`,
          cost: definition.cost,
          description: getBuildingDescription(kind),
          locked: definition.requires && !isBuildingUnlocked(kind) ? `Requires ${getBuildingDisplayName(definition.requires, 'player')}` : undefined,
          onClick: () => {
            workerBuildMenu = null
            startWorkerBuildingPlacement(kind)
          }
        })
      }
      slots.push({
        id: 'build-back',
        icon: ICON.action.cancel,
        name: 'Back',
        description: 'Return to the worker commands.',
        onClick: () => {
          workerBuildMenu = null
        }
      })
      return slots
    }

    slots.push({
      id: 'build-basic',
      icon: ICON.action.build,
      name: 'Build Structure',
      description: `Basic structures: ${BUILD_MENU_PAGES.basic.map((kind) => getBuildingDisplayName(kind, 'player')).join(', ')}.`,
      onClick: () => {
        workerBuildMenu = 'basic'
      }
    })
    slots.push({
      id: 'build-advanced',
      icon: ICON.action.buildAdvanced,
      name: 'Build Advanced Structure',
      description: `Advanced structures: ${BUILD_MENU_PAGES.advanced.map((kind) => getBuildingDisplayName(kind, 'player')).join(', ')}.`,
      onClick: () => {
        workerBuildMenu = 'advanced'
      }
    })
    slots.push({
      id: 'repair',
      icon: ICON.action.repair,
      name: 'Repair',
      description:
        gameState.playerRace === 'human'
          ? `Click a damaged building, ${getRace('player').flyer.name} or ${getRace('player').titan.name} after pressing. Costs crystal; Vanguard crews repair 75% faster.`
          : 'Click a damaged building after pressing. Costs crystal while repairing.',
      onClick: startRepairOrder
    })
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
    slots.push(trainSlot('healer', getHealerDescription()))
    slots.push(trainSlot('caster', 'Spellcaster. Slow blasts that splash nearby enemies.'))
    slots.push(trainSlot('antiAir', 'Anti-air trooper. Long-range weapon that ONLY hits flyers.'))
    slots.push(rallySlot())
  }

  if (selected.kind === 'techLab') {
    slots.push(trainSlot('flyer', 'Fast flyer. Hovers over the battlefield.'))
    slots.push(trainSlot('transport', `Unarmed air carrier. Ferries ${TRANSPORT_CAPACITY} ground units across the water.`))
    slots.push(trainSlot('heavyAir', 'Capital ship. Slow, heavily armored, splash damage against ground and air.'))
    slots.push(trainSlot('siege', getSiegeDescription()))
    slots.push(trainSlot('titan', 'Giant assault monster. Splash stomps, huge HP.'))
    slots.push(rallySlot())
  }

  if (selected.kind === 'forge') {
    slots.push(upgradeSlot('damage'))
    slots.push(upgradeSlot('speed'))
  }

  if (selected.kind === 'airForge') {
    slots.push(upgradeSlot('airDamage'))
    slots.push(upgradeSlot('airSpeed'))
  }

  if (selected.kind === 'soldier') {
    // A lone selected hero gets its signature ability button, with cooldown badge.
    const heroAbility = getSelectedHeroAbility()
    if (heroAbility) {
      slots.push({
        id: 'hero-ability',
        icon: ICON.heroAbility[gameState.playerRace] ?? ICON.action.attackMove,
        name: heroAbility.name,
        description: heroAbility.description,
        badge: heroAbility.cooldownRemaining > 0 ? `${Math.ceil(heroAbility.cooldownRemaining)}s` : undefined,
        onClick: castSelectedHeroAbility
      })
    }
    slots.push({
      id: 'attack-move',
      icon: ICON.action.attackMove,
      name: 'Attack-Move',
      description: 'March to a point, engaging every hostile on the way. Click ground after pressing.',
      onClick: startAttackMove
    })
    slots.push({
      id: 'patrol',
      icon: ICON.action.patrol,
      name: 'Patrol',
      description: 'Walk back and forth between here and a point, engaging hostiles on the way. Click ground after pressing.',
      onClick: startPatrol
    })
    slots.push({
      id: 'stop',
      icon: ICON.action.cancel,
      name: 'Stop',
      description: 'Halt immediately and drop every standing order.',
      onClick: stopSelectedUnits
    })
    const stance = getSelectedStance() ?? 'defensive'
    slots.push({
      id: 'stance',
      icon: ICON.action.stance,
      name: `Stance: ${STANCE_LABELS[stance]}`,
      description: 'Toggle stance. Defensive: short chase, returns to post. Hold: never moves, fires in range.',
      onClick: cycleSelectedStance
    })
    // Artillery in the selection gets the dig-in / pack-up transform toggle.
    const siegeMode = getSelectedSiegeMode()
    if (siegeMode) {
      slots.push({
        id: 'siege-mode',
        icon: ICON.action.siegeMode,
        name: siegeMode === 'sieged' ? 'Pack Up' : siegeMode === 'transforming' ? 'Transforming...' : 'Siege Mode',
        description:
          siegeMode === 'sieged'
            ? 'Retract the main cannon and return to mobile mode so the artillery can move.'
            : 'Dig in and grow the main cannon: huge damage and range, but the gun cannot move.',
        onClick: toggleSelectedSiegeMode
      })
    }
    // A lone selected transport gets the drop-cargo button.
    const cargo = getSelectedTransportCargo()
    if (cargo) {
      slots.push({
        id: 'unload-transport',
        icon: ICON.action.unload,
        name: `Unload All (${cargo.count}/${cargo.capacity})`,
        description: 'Drop every carried unit onto the ground below. The transport must hover over land.',
        badge: `${cargo.count}`,
        locked: cargo.count === 0 ? 'Nothing aboard. Right-click the transport with ground units selected to load them.' : undefined,
        onClick: unloadSelectedTransport
      })
    }
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

/** Support unit blurb, flavored per race since each heals differently. */
function getHealerDescription(): string {
  const race = gameState.playerRace
  if (race === 'bio') return 'Support. Regeneration aura heals all nearby allies.'
  if (race === 'alien') return 'Support. Heal beam mends wounded fighters and structures.'
  return 'Support. Heal beam mends one wounded fighter at a time.'
}

/** Siege blurb, flavored per race. */
function getSiegeDescription(): string {
  const race = gameState.playerRace
  if (race === 'bio') return 'Acid artillery. Weak while mobile; dig in to grow the mortar: outranges towers, splash poisons victims. Cannot hit air.'
  if (race === 'alien') return 'Beam artillery. Weak while mobile; dig in to grow the lance: heaviest single hit in the game, outranges towers. Cannot hit air.'
  return 'Splash artillery. Weak while mobile; dig in to grow the cannon: outranges defense towers. Cannot hit air.'
}

function trainSlot(variant: SoldierVariant, description: string): CommandSlot {
  const definition = getSoldierDefinition('player', variant)
  const unlocked = isUnitUnlocked(variant)
  const requiredKind = UNIT_REQUIREMENTS[variant]

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
    description: `${info.effect}. Applies instantly to every matching fighter.`,
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
  if (kind === 'barracks') return `Tier 1 production: ${race.melee.name}s, ${race.ranged.name}s and ${race.healer.name}s.`
  if (kind === 'techLab') return `Tier 2 production: ${race.caster.name}s, ${race.flyer.name}s, ${race.siege.name}s and ${race.titan.name}s.`
  if (kind === 'forge') return 'Researches ground Weapons and Propulsion upgrades. Unlocks the titan.'
  if (kind === 'airForge') return `Researches Flight Weapons and Flight Propulsion for your ${race.flyer.name}s.`
  if (kind === 'turret') return 'Automated defense tower. Fires on hostile units in range.'
  // Fireplace: each race's camp building does something different.
  if (race.id === 'human') return 'Signal fire. Lights up a huge area of the map through the fog.'
  if (race.id === 'alien') return 'Haste aura. Allied units near it move 25% faster.'
  return 'Spore field. Poisons hostile units that come near it.'
}

// ---------------------------------------------------------------------------
// Control groups: numbered slots sitting on top of the minimap. Click (or
// press keys 1-4) to recall the saved units or building, press SET to store
// the current selection.
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
          value={isMultiplayerMatch() ? 'SURRENDER' : 'END GAME'}
          variant="primary"
          fontSize={18}
          uiTransform={{ width: 240, height: 48, margin: { top: 18 } }}
          uiBackground={{ color: UI.red }}
          onMouseDown={() => {
            showSettingsMenu = false
            // Multiplayer concessions are networked: everyone sees the team fall.
            if (isMultiplayerMatch()) surrenderMatch()
            else endRtsMatch()
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

/** Compact race card for the match-setup panel (race choice moved off the title screen). */
function raceCard(raceId: RaceId) {
  const race = RACES[raceId]
  const isSelected = gameState.playerRace === raceId
  const portrait = `images/icons/${UNIT_ICON_FILES.melee}${RACE_ICON_SUFFIX[raceId]}.jpg`

  return (
    <UiEntity
      key={`race-${raceId}`}
      uiTransform={{
        width: 148,
        height: 196,
        margin: { left: 6, right: 6 },
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
          uiTransform={{ width: 122, height: 122, margin: { top: 10 } }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: portrait },
            // Unselected races dim slightly; the new portraits are dark, so keep them readable.
            color: isSelected ? Color4.White() : Color4.create(0.72, 0.72, 0.78, 1)
          }}
        />
        <Label
          value={race.name.toUpperCase()}
          fontSize={14}
          color={isSelected ? Color4.White() : Color4.create(0.62, 0.62, 0.66, 1)}
          textAlign="middle-center"
          uiTransform={{ margin: { top: 8 } }}
        />
        <Label
          value={race.hero.name}
          fontSize={10}
          color={isSelected ? race.accent : Color4.create(0.45, 0.45, 0.5, 0.9)}
          textAlign="middle-center"
          uiTransform={{ margin: { top: 3 } }}
        />
      </UiEntity>
    </UiEntity>
  )
}

// -----------------------------------------------------------------------------
// Opponents panel: 1-5 computers, each with a race and difficulty picker.
// -----------------------------------------------------------------------------

const OPPONENT_RACE_OPTIONS: (RaceId | 'random')[] = ['random', 'human', 'alien', 'bio']
const OPPONENT_SLOT_COLORS = [Color4.create(0.95, 0.3, 0.25, 1), Color4.create(1, 0.62, 0.15, 1), Color4.create(0.82, 0.35, 0.95, 1)]
const ALLY_UI_COLOR = Color4.create(0.95, 0.85, 0.3, 1)

const GAME_MODES: { id: GameMode; label: string; hint: string }[] = [
  { id: 'team', label: 'TEAM', hint: 'You are Team 1. Computers on Team 1 fight beside you; Teams 2-4 are enemies and also fight each other.' },
  { id: 'ffa', label: 'FFA', hint: 'Free-for-all: every computer fights everyone, including each other.' }
]

/** Highest team number selectable on the setup screen (Team 1 = the player's). */
const MAX_SETUP_TEAM = 4

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

function cycleOpponentTeam(index: number): void {
  const setup = gameState.opponents[index]
  let next = setup.team >= MAX_SETUP_TEAM ? 1 : setup.team + 1
  // Someone has to be the enemy: skip Team 1 if this is the last hostile computer.
  const otherHostiles = gameState.opponents.filter((opponent, i) => i !== index && opponent.team !== 1).length
  if (next === 1 && otherHostiles === 0) next = 2
  setup.team = next
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

/** The player's own fixed row above the computers: always Team 1. */
function playerSetupRow() {
  return (
    <UiEntity key="setup-you" uiTransform={{ width: '100%', height: 40, flexDirection: 'row', alignItems: 'center', margin: { bottom: 6 } }}>
      <UiEntity uiTransform={{ width: 10, height: 10, margin: { right: 8 } }} uiBackground={{ color: ALLY_UI_COLOR }} />
      <Label value="YOU" fontSize={13} color={UI.gold} textAlign="middle-left" uiTransform={{ width: 52 }} />
      {gameState.gameMode === 'team' ? (
        <UiEntity uiTransform={{ width: 74, height: 34, margin: { right: 6 }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.05, 0.07, 0.11, 0.96) }}>
          <Label value="TEAM 1" fontSize={12} color={UI.gold} textAlign="middle-center" />
        </UiEntity>
      ) : null}
      <Label value={RACES[gameState.playerRace].name} fontSize={13} color={UI.text} textAlign="middle-left" uiTransform={{ width: 120 }} />
    </UiEntity>
  )
}

function opponentRow(index: number) {
  const setup = gameState.opponents[index]
  const isAlly = gameState.gameMode === 'team' && setup.team === 1
  const slotColor = isAlly ? ALLY_UI_COLOR : OPPONENT_SLOT_COLORS[index % OPPONENT_SLOT_COLORS.length]

  return (
    <UiEntity key={`opponent-${index}`} uiTransform={{ width: '100%', height: 40, flexDirection: 'row', alignItems: 'center', margin: { bottom: 6 } }}>
      <UiEntity uiTransform={{ width: 10, height: 10, margin: { right: 8 } }} uiBackground={{ color: slotColor }} />
      <Label value={`CPU ${index + 1}`} fontSize={13} color={UI.dim} textAlign="middle-left" uiTransform={{ width: 52 }} />
      {gameState.gameMode === 'team' ? opponentChip(`opp-team-${index}`, `TEAM ${setup.team}`, 74, () => cycleOpponentTeam(index)) : null}
      {opponentChip(`opp-race-${index}`, opponentRaceLabel(setup.race), gameState.gameMode === 'team' ? 90 : 120, () => cycleOpponentRace(index))}
      {opponentChip(`opp-diff-${index}`, AI_DIFFICULTY[setup.difficulty].label.toUpperCase(), 78, () => cycleOpponentDifficulty(index))}
      {gameState.opponents.length > 1 ? (
        <UiEntity
          uiTransform={{ width: 30, height: 34, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.45, 0.12, 0.12, 0.9) }}
          onMouseDown={() => {
            gameState.opponents.splice(index, 1)
            // Never leave the roster without a foe after a removal.
            if (gameState.opponents.every((opponent) => opponent.team === 1)) gameState.opponents[0].team = 2
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
      uiBackground={{ textureMode: 'stretch', texture: { src: 'images/ui/title-bg-decentracraft.jpg' } }}
    >
      {titleSkyAmbience()}

      {/* Darkens the artwork behind the menu buttons so text stays readable. */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { bottom: 0, left: 0 }, width: '100%', height: 190 }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.45) }}
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
        {/* Race choice lives on the next screen (and in the MP lobby), so the
            title stays clean: logo, two buttons, done. */}
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center' }}>
          <UiEntity
            uiTransform={{ width: 300, height: 62, margin: { right: 12 }, justifyContent: 'center', alignItems: 'center', padding: 3 }}
            uiBackground={{ color: Color4.create(0.35, 0.65, 1, 1) }}
          onMouseDown={() => {
            triggerScreenFade()
            titleStage = 'setup'
          }}
        >
          <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.06, 0.14, 0.28, 1) }}>
              <Label value="SINGLE PLAYER" fontSize={22} color={Color4.create(0.85, 0.93, 1, 1)} textAlign="middle-center" />
            </UiEntity>
          </UiEntity>
          <UiEntity
            uiTransform={{ width: 300, height: 62, margin: { left: 12 }, justifyContent: 'center', alignItems: 'center', padding: 3 }}
            uiBackground={{ color: Color4.create(0.95, 0.75, 0.25, 1) }}
            onMouseDown={() => {
              triggerScreenFade()
              // Land straight in our room if we're already seated somewhere,
              // otherwise open the room browser.
              setViewedLobbyId(getMyLobbyId())
              titleStage = 'lobby'
            }}
          >
            <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.2, 0.14, 0.04, 1) }}>
              <Label value="MULTIPLAYER" fontSize={22} color={Color4.create(1, 0.9, 0.65, 1)} textAlign="middle-center" />
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
// right, over the title background. The 3D hero showcase (VirtualCamera +
// world-staged model) is disabled for now: Genesis City clips world entities
// to scene bounds, which breaks the staged shot that worked in Worlds.
// ---------------------------------------------------------------------------

function matchSetupOverlay() {
  const race = RACES[gameState.playerRace]

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%'
      }}
      uiBackground={{ textureMode: 'stretch', texture: { src: 'images/ui/title-bg-decentracraft.jpg' } }}
    >
      {titleSkyAmbience()}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%' }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
      />
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

      {/* Race choice: stacked directly above the hero panel on the right, so
          picking a race and seeing its hero read as one column. */}
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 130, right: 70 },
          width: 540,
          height: 324,
          flexDirection: 'column',
          alignItems: 'center',
          padding: { top: 20, bottom: 20, left: 30, right: 30 }
        }}
        uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.9) }}
      >
        <Label value="YOUR RACE" fontSize={22} color={UI.text} textAlign="middle-center" uiTransform={{ width: '100%', height: 26, margin: { bottom: 12 } }} />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { bottom: 8 } }}>
          {RACE_IDS.map((raceId) => raceCard(raceId))}
        </UiEntity>
        <Label
          value={race.tagline}
          fontSize={13}
          color={Color4.create(0.85, 0.87, 0.92, 0.95)}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 36 }}
        />
      </UiEntity>

      {/* Battleground selector: single map today, but the registry, the
          arrows and the lobby sync are the groundwork for more. */}
      {mapSelectorPanel()}

      {/* Opponents panel: centered where the 3D hero used to spin, clear of the
          explorer's own minimap/chat overlays on the left edge. */}
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 200, left: '50%' },
          margin: { left: -270 },
          width: 540,
          height: 600,
          flexDirection: 'column',
          padding: { top: 26, bottom: 26, left: 30, right: 30 }
        }}
        uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.9) }}
      >
        <Label value="TEAMS" fontSize={22} color={UI.text} textAlign="middle-left" uiTransform={{ margin: { bottom: 18 } }} />
        <Label value="GAME MODE" fontSize={14} color={Color4.create(0.75, 0.78, 0.85, 0.9)} textAlign="middle-left" uiTransform={{ margin: { bottom: 8 } }} />
        {gameModeToggle()}
        <Label value={GAME_MODES.find((mode) => mode.id === gameState.gameMode)?.hint ?? ''} fontSize={12} color={Color4.create(0.55, 0.58, 0.66, 0.9)} textAlign="middle-left" uiTransform={{ margin: { bottom: 18 } }} />
        <Label value="PLAYERS" fontSize={14} color={Color4.create(0.75, 0.78, 0.85, 0.9)} textAlign="middle-left" uiTransform={{ margin: { bottom: 10 } }} />
        {playerSetupRow()}
        {gameState.opponents.map((_, index) => opponentRow(index))}
        {gameState.opponents.length < 5 ? (
          <UiEntity
            uiTransform={{ width: 180, height: 34, margin: { top: 6 }, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.12, 0.3, 0.16, 0.95) }}
            onMouseDown={() => {
              gameState.opponents.push({ race: 'random', difficulty: 'medium', team: 2 })
            }}
          >
            <Label value="+ ADD COMPUTER" fontSize={12} color={UI.text} textAlign="middle-center" />
          </UiEntity>
        ) : null}
      </UiEntity>

      {/* Right panel: hero name, trait and stat sheet. */}
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
            triggerScreenFade()
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
            triggerScreenFade()
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

/**
 * Battleground picker on the match setup screen. One map ships today, but the
 * arrows cycle the registry so extra maps drop straight in. The thumbnail is
 * the rendered top-down layout diagram (bases, naturals, rich center).
 */
function mapSelectorPanel() {
  const map = getMapById(gameState.selectedMapId)
  const mapIndex = Math.max(0, MAPS.findIndex((entry) => entry.id === map.id))
  const cycleMap = () => {
    gameState.selectedMapId = getNextMapId(gameState.selectedMapId)
  }

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 200, left: 70 },
        width: 540,
        height: 640,
        flexDirection: 'column',
        alignItems: 'center',
        padding: { top: 22, bottom: 18, left: 30, right: 30 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.9) }}
    >
      <Label value="BATTLEGROUND" fontSize={22} color={UI.text} textAlign="middle-center" uiTransform={{ width: '100%', height: 26 }} />

      {/* Layout diagram, framed in the gold accent. */}
      <UiEntity uiTransform={{ width: 406, height: 435, margin: { top: 12 }, padding: 3 }} uiBackground={{ color: Color4.create(0.65, 0.55, 0.3, 1) }}>
        <UiEntity
          uiTransform={{ width: '100%', height: '100%' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: map.thumbnail } }}
        />
      </UiEntity>

      {/* Name row with cycle arrows: no-ops with one map, ready for more. */}
      <UiEntity uiTransform={{ width: '100%', height: 40, margin: { top: 10 }, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
        <UiEntity
          uiTransform={{ width: 40, height: 34, margin: { right: 10 }, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.12, 0.16, 0.24, 0.95) }}
          onMouseDown={cycleMap}
        >
          <Label value="<" fontSize={18} color={UI.dim} textAlign="middle-center" />
        </UiEntity>
        <Label value={map.name.toUpperCase()} fontSize={22} color={UI.gold} textAlign="middle-center" uiTransform={{ width: 300, height: 34 }} />
        <UiEntity
          uiTransform={{ width: 40, height: 34, margin: { left: 10 }, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.12, 0.16, 0.24, 0.95) }}
          onMouseDown={cycleMap}
        >
          <Label value=">" fontSize={18} color={UI.dim} textAlign="middle-center" />
        </UiEntity>
      </UiEntity>

      <Label
        value={`MAP ${mapIndex + 1} OF ${MAPS.length}  ·  UP TO ${map.maxPlayers} PLAYERS`}
        fontSize={12}
        color={Color4.create(0.55, 0.58, 0.66, 0.9)}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: 16, margin: { top: 2 } }}
      />
      <Label
        value={map.tagline}
        fontSize={13}
        color={Color4.create(0.85, 0.87, 0.92, 0.95)}
        textAlign="middle-center"
        textWrap="wrap"
        uiTransform={{ width: 460, height: 52, margin: { top: 8 } }}
      />
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Multiplayer lobby: four seats shared by everyone in the world. Players claim
// a seat, pick a race and a team; the host can fill empty seats with computers
// and launches the match for everyone at once.
// ---------------------------------------------------------------------------

const LOBBY_SEAT_COLORS = [
  Color4.create(0.35, 0.65, 1, 1),
  Color4.create(0.95, 0.3, 0.25, 1),
  Color4.create(1, 0.62, 0.15, 1),
  Color4.create(0.82, 0.35, 0.95, 1),
  Color4.create(0.35, 0.9, 0.25, 1),
  Color4.create(1, 0.35, 0.7, 1)
]

function lobbyRaceLabel(race: RaceId | 'random'): string {
  return race === 'random' ? 'RANDOM' : RACES[race].name.toUpperCase()
}

function nextLobbyRace(race: RaceId | 'random'): RaceId | 'random' {
  const next = (OPPONENT_RACE_OPTIONS.indexOf(race) + 1) % OPPONENT_RACE_OPTIONS.length
  return OPPONENT_RACE_OPTIONS[next]
}

/** Small action button used inside lobby seat rows. */
function lobbyButton(key: string, label: string, color: Color4, onClick: () => void) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ width: 96, height: 34, margin: { right: 6 }, justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color }}
      onMouseDown={onClick}
    >
      <Label value={label} fontSize={12} color={UI.text} textAlign="middle-center" />
    </UiEntity>
  )
}

function lobbySeatRow(seat: LobbySeat, index: number) {
  const iAmHost = isHost()
  const mySeat = getMySeatIndex()
  const isMine = mySeat === index
  const ranked = getLobby().ranked

  const chips: ReactEcs.JSX.Element[] = []

  if (seat.kind === 'human') {
    const name = `${seat.name ?? '???'}${isMine ? '  (YOU)' : ''}`
    chips.push(
      <Label key={`seat-name-${index}`} value={name} fontSize={14} color={isMine ? UI.gold : UI.text} textAlign="middle-left" uiTransform={{ width: 240 }} />
    )
    chips.push(
      opponentChip(`seat-race-${index}`, lobbyRaceLabel(seat.race), 110, () => {
        if (isMine) setMyRace(nextLobbyRace(seat.race))
      })
    )
    if (ranked) {
      // Alliances are locked in ranked; the interesting number is the rating.
      const rating = seat.address ? (getRankedEntry(seat.address)?.rating ?? RANKED_START_RATING) : RANKED_START_RATING
      chips.push(
        <Label key={`seat-elo-${index}`} value={`${rating} ELO`} fontSize={13} color={UI.gold} textAlign="middle-left" uiTransform={{ width: 92 }} />
      )
    } else {
      chips.push(
        opponentChip(`seat-team-${index}`, `TEAM ${seat.allianceId + 1}`, 92, () => {
          if (isMine) setMyAlliance((seat.allianceId + 1) % 6)
        })
      )
    }
    chips.push(
      <Label
        key={`seat-ready-${index}`}
        value={seat.ready ? 'READY' : 'NOT READY'}
        fontSize={13}
        color={seat.ready ? UI.green : UI.dim}
        textAlign="middle-left"
        uiTransform={{ width: 110, margin: { left: 8 } }}
      />
    )
  } else if (seat.kind === 'computer') {
    chips.push(<Label key={`seat-name-${index}`} value="COMPUTER" fontSize={14} color={UI.dim} textAlign="middle-left" uiTransform={{ width: 240 }} />)
    chips.push(
      opponentChip(`seat-race-${index}`, lobbyRaceLabel(seat.race), 110, () => {
        if (iAmHost) hostSetSeat(index, { race: nextLobbyRace(seat.race) })
      })
    )
    chips.push(
      opponentChip(`seat-team-${index}`, `TEAM ${seat.allianceId + 1}`, 92, () => {
        if (iAmHost) hostSetSeat(index, { allianceId: (seat.allianceId + 1) % 6 })
      })
    )
    chips.push(
      opponentChip(`seat-diff-${index}`, AI_DIFFICULTY[seat.difficulty].label.toUpperCase(), 92, () => {
        const next = (DIFFICULTY_IDS.indexOf(seat.difficulty) + 1) % DIFFICULTY_IDS.length
        if (iAmHost) hostSetSeat(index, { difficulty: DIFFICULTY_IDS[next] })
      })
    )
    if (iAmHost) {
      chips.push(
        <UiEntity
          key={`seat-close-${index}`}
          uiTransform={{ width: 34, height: 34, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.45, 0.12, 0.12, 0.9) }}
          onMouseDown={() => hostSetSeat(index, { kind: 'closed' })}
        >
          <Label value="X" fontSize={13} color={UI.text} textAlign="middle-center" />
        </UiEntity>
      )
    }
  } else {
    chips.push(<Label key={`seat-name-${index}`} value="OPEN SEAT" fontSize={14} color={Color4.create(0.45, 0.48, 0.55, 0.9)} textAlign="middle-left" uiTransform={{ width: 240 }} />)
    if (getMyAddress() !== '') {
      chips.push(lobbyButton(`seat-join-${index}`, isMine ? 'JOINED' : mySeat >= 0 ? 'MOVE HERE' : 'JOIN', Color4.create(0.12, 0.3, 0.16, 0.95), () => claimSeat(index)))
    }
    if (iAmHost && !ranked) {
      // No computer seats on the ladder: only human results are rated.
      chips.push(lobbyButton(`seat-cpu-${index}`, '+ COMPUTER', Color4.create(0.25, 0.32, 0.45, 0.9), () => hostSetSeat(index, { kind: 'computer', ready: false })))
    }
  }

  return (
    <UiEntity
      key={`lobby-seat-${index}`}
      uiTransform={{ width: '100%', height: 52, flexDirection: 'row', alignItems: 'center', margin: { bottom: 8 }, padding: { left: 14, right: 14 } }}
      uiBackground={{ color: isMine ? Color4.create(0.08, 0.11, 0.17, 0.95) : Color4.create(0.05, 0.06, 0.09, 0.92) }}
    >
      <UiEntity uiTransform={{ width: 12, height: 12, margin: { right: 10 } }} uiBackground={{ color: LOBBY_SEAT_COLORS[index] }} />
      <Label value={`SEAT ${index + 1}`} fontSize={13} color={UI.dim} textAlign="middle-left" uiTransform={{ width: 70 }} />
      {chips}
    </UiEntity>
  )
}

/**
 * Battleground row at the top of the lobby: everyone sees the synced map pick,
 * the host can cycle it (server validates against the registry). One map for
 * now, so the button just wraps back to it.
 */
function lobbyMapRow(iAmHost: boolean) {
  const lobby = getLobby()
  const map = getMapById(lobby.mapId)

  return (
    <UiEntity
      uiTransform={{ width: '100%', height: 76, flexDirection: 'row', alignItems: 'center', margin: { bottom: 16 }, padding: { left: 14, right: 14 } }}
      uiBackground={{ color: Color4.create(0.05, 0.06, 0.09, 0.92) }}
    >
      <UiEntity uiTransform={{ width: 58, height: 62, margin: { right: 14 }, padding: 2 }} uiBackground={{ color: Color4.create(0.65, 0.55, 0.3, 1) }}>
        <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: map.thumbnail } }} />
      </UiEntity>
      <UiEntity uiTransform={{ flexDirection: 'column', width: 480 }}>
        <Label value={`BATTLEGROUND: ${map.name.toUpperCase()}`} fontSize={16} color={UI.gold} textAlign="middle-left" uiTransform={{ width: '100%', height: 20 }} />
        <Label
          value={`Up to ${map.maxPlayers} players  ·  rich gold + cryo center`}
          fontSize={12}
          color={Color4.create(0.55, 0.58, 0.66, 0.9)}
          textAlign="middle-left"
          uiTransform={{ width: '100%', height: 16, margin: { top: 4 } }}
        />
      </UiEntity>
      {iAmHost && getLobby().phase === 'lobby' ? (
        <UiEntity
          uiTransform={{ width: 150, height: 34, margin: { left: 20 }, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.25, 0.32, 0.45, 0.9) }}
          onMouseDown={() => hostSetMap(getNextMapId(lobby.mapId))}
        >
          <Label value="CHANGE MAP" fontSize={12} color={UI.text} textAlign="middle-center" />
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

/** Who's in the world right now, docked to the right of the seats box. */
function lobbyOnlinePlayersPanel() {
  const players = getPresentPlayers()
  const myAddress = getMyAddress()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 240, left: '50%' },
        margin: { left: 450 },
        width: 260,
        flexDirection: 'column',
        padding: { top: 24, bottom: 24, left: 20, right: 20 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.9) }}
    >
      <Label value={`ONLINE (${players.length})`} fontSize={18} color={UI.text} textAlign="middle-left" uiTransform={{ width: '100%', height: 22, margin: { bottom: 12 } }} />
      {players.slice(0, 14).map((player) => (
        <UiEntity key={`online-${player.address}`} uiTransform={{ width: '100%', height: 26, flexDirection: 'row', alignItems: 'center', margin: { bottom: 4 } }}>
          <UiEntity uiTransform={{ width: 8, height: 8, margin: { right: 10 } }} uiBackground={{ color: Color4.create(0.35, 0.9, 0.45, 1) }} />
          <Label
            value={player.address === myAddress ? `${player.name} (you)` : player.name}
            fontSize={14}
            color={player.address === myAddress ? UI.gold : UI.text}
            textAlign="middle-left"
            textWrap="nowrap"
            uiTransform={{ width: 190, height: '100%' }}
          />
        </UiEntity>
      ))}
      {players.length > 14 ? (
        <Label value={`+ ${players.length - 14} more`} fontSize={12} color={UI.dim} textAlign="middle-left" uiTransform={{ width: '100%', height: 16 }} />
      ) : null}
      {players.length === 0 ? <Label value="Connecting..." fontSize={13} color={UI.dim} textAlign="middle-left" uiTransform={{ width: '100%', height: 18 }} /> : null}
    </UiEntity>
  )
}

function multiplayerLobbyOverlay() {
  return getViewedLobbyId() < 0 ? lobbyBrowserOverlay() : lobbyRoomOverlay()
}

/** Elo leaderboard docked to the left of the room browser (mirrors the online panel). */
function rankedLadderPanel() {
  const ladder = getRankedLadder()
  const myAddress = getMyAddress()
  const top = ladder.entries.slice(0, 12)
  const myEntry = myAddress ? getRankedEntry(myAddress) : undefined
  const myRank = myEntry ? ladder.entries.indexOf(myEntry) + 1 : 0

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 240, left: '50%' },
        margin: { left: -740 },
        width: 270,
        flexDirection: 'column',
        padding: { top: 24, bottom: 24, left: 20, right: 20 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.9) }}
    >
      <Label value="RANKED LADDER" fontSize={18} color={UI.gold} textAlign="middle-left" uiTransform={{ width: '100%', height: 22, margin: { bottom: 12 } }} />
      {top.map((entry, index) => {
        const isMe = entry.address === myAddress
        return (
          <UiEntity key={`ladder-${entry.address}`} uiTransform={{ width: '100%', height: 26, flexDirection: 'row', alignItems: 'center', margin: { bottom: 4 } }}>
            <Label value={`${index + 1}.`} fontSize={13} color={index < 3 ? UI.gold : UI.dim} textAlign="middle-left" uiTransform={{ width: 26, height: '100%' }} />
            <Label
              value={isMe ? `${entry.name} (you)` : entry.name}
              fontSize={13}
              color={isMe ? UI.gold : UI.text}
              textAlign="middle-left"
              textWrap="nowrap"
              uiTransform={{ width: 130, height: '100%' }}
            />
            <Label value={`${entry.rating}`} fontSize={14} color={UI.text} textAlign="middle-right" uiTransform={{ width: 44, height: '100%' }} />
            <Label value={`${entry.wins}-${entry.losses}`} fontSize={11} color={UI.dim} textAlign="middle-right" uiTransform={{ width: 40, height: '100%' }} />
          </UiEntity>
        )
      })}
      {top.length === 0 ? (
        <Label
          value="No rated matches yet. Win in the RANKED LADDER room to claim the first spot."
          fontSize={12}
          color={UI.dim}
          textAlign="middle-left"
          textWrap="wrap"
          uiTransform={{ width: '100%', height: 48 }}
        />
      ) : null}
      <Label
        value={myEntry ? `You: #${myRank}  ·  ${myEntry.rating} Elo  ·  ${myEntry.wins}-${myEntry.losses}` : `You: unranked  ·  ${RANKED_START_RATING} Elo`}
        fontSize={12}
        color={UI.gold}
        textAlign="middle-left"
        uiTransform={{ width: '100%', height: 18, margin: { top: 10 } }}
      />
    </UiEntity>
  )
}

/** One row per room in the browser: name, occupancy, phase, and an enter button. */
function lobbyBrowserRoomRow(config: LobbyConfig) {
  const humans = config.seats.filter((seat) => seat.kind === 'human').length
  const computers = config.seats.filter((seat) => seat.kind === 'computer').length
  const inMatch = config.phase === 'inMatch'
  const occupancy = humans === 0 && computers === 0 ? 'Empty' : `${humans} player${humans === 1 ? '' : 's'}${computers > 0 ? ` + ${computers} comp${computers === 1 ? '' : 's'}` : ''}`

  return (
    <UiEntity
      key={`room-${config.id}`}
      uiTransform={{ width: '100%', height: 66, flexDirection: 'row', alignItems: 'center', margin: { bottom: 10 }, padding: { left: 18, right: 14 } }}
      uiBackground={{ color: config.ranked ? Color4.create(0.09, 0.075, 0.03, 0.94) : Color4.create(0.05, 0.06, 0.09, 0.92) }}
    >
      <Label value={lobbyRoomName(config.id)} fontSize={18} color={config.ranked ? UI.gold : UI.text} textAlign="middle-left" uiTransform={{ width: 220, height: '100%' }} />
      <Label
        value={config.ranked ? `${occupancy}  ·  Elo rated FFA` : occupancy}
        fontSize={13}
        color={UI.dim}
        textAlign="middle-left"
        uiTransform={{ width: 200, height: '100%' }}
      />
      <UiEntity uiTransform={{ width: 110, height: 26, justifyContent: 'center', alignItems: 'center', margin: { right: 16 } }} uiBackground={{ color: inMatch ? Color4.create(0.35, 0.1, 0.1, 0.95) : Color4.create(0.08, 0.25, 0.12, 0.95) }}>
        <Label value={inMatch ? 'IN MATCH' : 'OPEN'} fontSize={12} color={inMatch ? UI.red : UI.green} textAlign="middle-center" />
      </UiEntity>
      <UiEntity
        uiTransform={{ width: 110, height: 38, justifyContent: 'center', alignItems: 'center' }}
        uiBackground={{ color: inMatch ? Color4.create(0.2, 0.24, 0.3, 1) : Color4.create(0.35, 0.65, 1, 1) }}
        onMouseDown={() => {
          playUiClick()
          setViewedLobbyId(config.id)
        }}
      >
        <Label value={inMatch ? 'VIEW' : 'ENTER'} fontSize={14} color={inMatch ? UI.dim : Color4.create(0.06, 0.14, 0.28, 1)} textAlign="middle-center" />
      </UiEntity>
    </UiEntity>
  )
}

/** Room browser: pick one of the concurrent battle rooms (or go back to the title). */
function lobbyBrowserOverlay() {
  const connected = getMyAddress() !== ''

  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%' }}
      uiBackground={{ textureMode: 'stretch', texture: { src: 'images/ui/title-bg-decentracraft.jpg' } }}
    >
      {titleSkyAmbience()}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%' }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
      />

      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: 70, left: 0 }, width: '100%', flexDirection: 'column', alignItems: 'center' }}
      >
        <Label value="MULTIPLAYER" fontSize={44} color={UI.gold} textAlign="middle-center" uiTransform={{ width: '100%', height: 54 }} />
        <Label
          value={connected ? `${getPresentPlayerCount()} player(s) in world  ·  pick a battle room` : 'Connecting to world...'}
          fontSize={16}
          color={Color4.create(0.75, 0.78, 0.85, 0.9)}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 22, margin: { top: 8 } }}
        />
      </UiEntity>

      {rankedLadderPanel()}
      {lobbyOnlinePlayersPanel()}

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 240, left: '50%' },
          margin: { left: -430 },
          width: 860,
          flexDirection: 'column',
          padding: { top: 24, bottom: 24, left: 26, right: 26 }
        }}
        uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.9) }}
      >
        <Label value="BATTLE ROOMS" fontSize={18} color={UI.text} textAlign="middle-left" uiTransform={{ margin: { bottom: 14 } }} />
        {getLobbies().map((config) => lobbyBrowserRoomRow(config))}
      </UiEntity>

      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { bottom: 46, left: 0 }, width: '100%', flexDirection: 'row', justifyContent: 'center' }}
      >
        <UiEntity
          uiTransform={{ width: 220, height: 60, padding: 3, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.3, 0.36, 0.48, 1) }}
          onMouseDown={() => {
            triggerScreenFade()
            titleStage = 'title'
          }}
        >
          <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.07, 0.09, 0.14, 1) }}>
            <Label value="BACK" fontSize={20} color={UI.dim} textAlign="middle-center" />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function lobbyRoomOverlay() {
  const lobby = getLobby()
  const connected = getMyAddress() !== ''
  const mySeat = getMySeatIndex()
  const iAmHost = isHost()
  const hostSeat = lobby.seats.find((seat) => seat.kind === 'human' && seat.address?.toLowerCase() === lobby.hostAddress.toLowerCase())
  // No host until someone sits down: the server crowns the first seated player.
  const hostLabel = lobby.hostAddress === '' ? 'first player to join a seat becomes host' : iAmHost ? 'you are the host' : `host: ${hostSeat?.name ?? 'in world'}`
  const canStart = canStartMultiplayerMatch()

  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%' }}
      uiBackground={{ textureMode: 'stretch', texture: { src: 'images/ui/title-bg-decentracraft.jpg' } }}
    >
      {titleSkyAmbience()}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%' }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
      />

      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: 70, left: 0 }, width: '100%', flexDirection: 'column', alignItems: 'center' }}
      >
        <Label value={lobbyRoomName(lobby.id)} fontSize={44} color={UI.gold} textAlign="middle-center" uiTransform={{ width: '100%', height: 54 }} />
        <Label
          value={connected ? `${getPresentPlayerCount()} player(s) in world  ·  ${hostLabel}` : 'Connecting to world...'}
          fontSize={16}
          color={Color4.create(0.75, 0.78, 0.85, 0.9)}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 22, margin: { top: 8 } }}
        />
      </UiEntity>

      {/* Everyone currently in the world, so you know who you're waiting on. */}
      {lobby.ranked ? rankedLadderPanel() : null}
      {lobbyOnlinePlayersPanel()}

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 240, left: '50%' },
          margin: { left: -430 },
          width: 860,
          flexDirection: 'column',
          padding: { top: 24, bottom: 24, left: 26, right: 26 }
        }}
        uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.9) }}
      >
        {lobbyMapRow(iAmHost)}
        <Label value="SEATS" fontSize={18} color={UI.text} textAlign="middle-left" uiTransform={{ margin: { bottom: 14 } }} />
        {lobby.seats.map((seat, index) => lobbySeatRow(seat, index))}
        <Label
          value={
            lobby.ranked
              ? 'Ranked free-for-all: humans only, no alliances. The last commander standing wins Elo from every opponent.'
              : 'Seats on the same team fight together. Mix players and computers on any side.'
          }
          fontSize={12}
          color={lobby.ranked ? UI.gold : Color4.create(0.55, 0.58, 0.66, 0.9)}
          textAlign="middle-left"
          uiTransform={{ margin: { top: 8 } }}
        />
        {lobby.phase === 'inMatch' ? (
          <Label value="A match is currently in progress in this room." fontSize={13} color={UI.red} textAlign="middle-left" uiTransform={{ margin: { top: 6 } }} />
        ) : null}
      </UiEntity>

      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { bottom: 46, left: 0 }, width: '100%', flexDirection: 'row', justifyContent: 'center' }}
      >
        <UiEntity
          uiTransform={{ width: 220, height: 60, margin: { right: 16 }, padding: 3, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.3, 0.36, 0.48, 1) }}
          onMouseDown={() => {
            // Give up the seat and drop back to the room browser.
            leaveSeat()
            setViewedLobbyId(-1)
          }}
        >
          <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.07, 0.09, 0.14, 1) }}>
            <Label value="LEAVE ROOM" fontSize={18} color={UI.dim} textAlign="middle-center" />
          </UiEntity>
        </UiEntity>

        {mySeat >= 0 ? (
          <UiEntity
            uiTransform={{ width: 220, height: 60, margin: { right: 16 }, padding: 3, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: lobby.seats[mySeat].ready ? UI.green : Color4.create(0.35, 0.65, 1, 1) }}
            onMouseDown={() => setMyReady(!lobby.seats[mySeat].ready)}
          >
            <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.06, 0.14, 0.1, 1) }}>
              <Label value={lobby.seats[mySeat].ready ? 'UNREADY' : 'READY UP'} fontSize={20} color={UI.text} textAlign="middle-center" />
            </UiEntity>
          </UiEntity>
        ) : null}

        {iAmHost ? (
          <UiEntity
            uiTransform={{ width: 320, height: 60, padding: 3, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: canStart ? Color4.create(0.35, 0.65, 1, 1) : Color4.create(0.2, 0.24, 0.3, 1) }}
            onMouseDown={() => {
              if (canStart) hostStartMatch()
            }}
          >
            <UiEntity uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.06, 0.14, 0.28, 1) }}>
              <Label
                value={
                  canStart
                    ? 'START MATCH'
                    : // Ranked can't be padded with computers, so tell the host what's actually missing.
                      lobby.ranked && lobby.seats.filter((seat) => seat.kind === 'human').length < 2
                      ? 'NEEDS 2+ HUMANS (NO COMPS)'
                      : 'WAITING FOR PLAYERS'
                }
                fontSize={canStart ? 22 : 16}
                color={canStart ? Color4.create(0.85, 0.93, 1, 1) : UI.dim}
                textAlign="middle-center"
              />
            </UiEntity>
          </UiEntity>
        ) : (
          <Label
            value={
              mySeat < 0
                ? 'Join a seat to play. The first player seated becomes the host.'
                : lobby.seats[mySeat].ready
                  ? 'Waiting for the host to start the match...'
                  : 'Press READY UP so the host can start the match.'
            }
            fontSize={15}
            color={UI.dim}
            textAlign="middle-center"
            uiTransform={{ width: 380, height: 60 }}
          />
        )}
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
  const portrait = `images/icons/icon-unit-hero${RACE_ICON_SUFFIX[gameState.playerRace]}.jpg`

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 470, right: 70 },
        width: 540,
        height: 490,
        flexDirection: 'column',
        alignItems: 'center',
        padding: { top: 20, bottom: 16, left: 40, right: 40 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.9) }}
    >
      <Label value="YOUR HERO" fontSize={22} color={UI.text} textAlign="middle-center" uiTransform={{ width: '100%', height: 26 }} />

      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: 10 } }}>
        <UiEntity uiTransform={{ width: 120, height: 120, padding: 3 }} uiBackground={{ color: race.accent }}>
          <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: portrait } }} />
        </UiEntity>
      </UiEntity>

      <Label value={hero.name.toUpperCase()} fontSize={26} color={race.accent} textAlign="middle-center" uiTransform={{ width: '100%', height: 32, margin: { top: 10 } }} />
      <Label
        value={race.heroTrait}
        fontSize={14}
        color={Color4.create(0.85, 0.87, 0.92, 0.95)}
        textAlign="middle-center"
        textWrap="wrap"
        uiTransform={{ width: 440, height: 36, margin: { top: 6, bottom: 8 } }}
      />

      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center' }}>
        <UiEntity uiTransform={{ width: 420, flexDirection: 'column' }}>
          {heroStatRow('HIT POINTS', `${hero.hp}`)}
          {heroStatRow('DAMAGE', `${hero.damage ?? 0}`)}
          {heroStatRow('ATTACK RANGE', hero.attackRange !== undefined && hero.attackRange > 3 ? `${hero.attackRange} (ranged)` : 'Melee')}
          {heroStatRow('ATTACK SPEED', `every ${hero.attackRate ?? 1}s`)}
          {heroStatRow('MOVE SPEED', `${hero.moveSpeed ?? 0}`)}
          {hero.splashRadius ? heroStatRow('SPLASH RADIUS', `${hero.splashRadius}`) : null}
        </UiEntity>
      </UiEntity>

      <Label
        value="Free at match start. Takes no supply. Cannot be rebuilt if slain."
        fontSize={12}
        color={Color4.create(0.55, 0.58, 0.66, 0.9)}
        textAlign="middle-center"
        uiTransform={{ width: '100%', margin: { top: 12 } }}
      />
    </UiEntity>
  )
}

/** Every faction shown on the end screen: display label, race (for the avatar) and line color. */
type ScoreboardEntry = { team: Team; label: string; race: RaceId; color: Color4 }

function getScoreboardEntries(): ScoreboardEntry[] {
  return [
    { team: 'player' as Team, label: 'YOU', race: gameState.playerRace, color: UI.accent },
    ...gameState.activeEnemyTeams.map((team, index) => {
      const ally = isPlayerAlly(team)
      // Human opponents show their lobby name; computers keep the CPU/ALLY tag.
      const playerName = getMultiplayerTeamName(team)
      return {
        team: team as Team,
        label: playerName ?? `${ally ? 'ALLY' : 'CPU'} ${index + 1}`,
        race: gameState.enemyRaces[team],
        color: ally ? ALLY_UI_COLOR : OPPONENT_SLOT_COLORS[index]
      }
    })
  ]
}

/**
 * Ranked footer under the result: my rating change once the server has scored
 * the match (the ladder syncs back with per-player deltas), a waiting note
 * until then. Losers see their delta as soon as the winner's report lands.
 */
function rankedEndScreenLine(): string {
  const myAddress = getMyAddress()
  const lastMatch = getRankedLadder().lastMatch
  const myDelta = lastMatch?.deltas.find((entry) => entry.address === myAddress)
  if (!myDelta) return 'RANKED MATCH  ·  awaiting ladder update...'
  const sign = myDelta.delta >= 0 ? '+' : ''
  return `RANKED MATCH  ·  ${sign}${myDelta.delta} ELO  ·  now ${getMyRankedRating()}`
}

function endGameOverlay() {
  const didWin = gameState.matchResult === 'win'
  const entries = getScoreboardEntries()

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
      uiBackground={{ color: Color4.create(0, 0, 0, 0.78) }}
    >
      <UiEntity
        uiTransform={{
          width: 980,
          // Grows with one stats row per computer opponent, plus the income graph.
          height: 758 + gameState.activeEnemyTeams.length * 72,
          flexDirection: 'column',
          alignItems: 'center',
          padding: { top: 26, bottom: 26, left: 34, right: 34 }
        }}
        uiBackground={{ color: UI.panelStrong }}
      >
        {/* Result-colored accent stripe along the top edge. */}
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: 4 }} uiBackground={{ color: didWin ? UI.gold : UI.red }} />

        <UiEntity uiTransform={{ width: 96, height: 96, padding: 2 }} uiBackground={{ color: UI.slotFrame }}>
          <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: didWin ? ICON.endgame.victory : ICON.endgame.defeat } }} />
        </UiEntity>
        <Label value={didWin ? 'VICTORY' : 'DEFEAT'} fontSize={52} color={didWin ? UI.green : UI.red} textAlign="middle-center" uiTransform={{ width: '100%', height: 62, margin: { top: 6 } }} />
        <Label value={`MATCH TIME  ${formatMatchTime(gameState.matchTime)}`} fontSize={17} color={UI.gold} textAlign="middle-center" uiTransform={{ width: '100%', height: 22 }} />
        {isRankedMultiplayerMatch() ? <Label value={rankedEndScreenLine()} fontSize={15} color={UI.gold} textAlign="middle-center" uiTransform={{ width: '100%', height: 20, margin: { top: 4 } }} /> : null}

        <UiEntity uiTransform={{ width: '100%', height: 50, flexDirection: 'row', alignItems: 'center', margin: { top: 22 } }} uiBackground={{ color: UI.card }}>
          <Label value="ARMY" fontSize={15} color={UI.dim} textAlign="middle-left" uiTransform={{ width: 312, height: '100%', padding: { left: 18 } }} />
          {statsHeader('UNITS MADE', ICON.endgame.units)}
          {statsHeader('KILLS', ICON.endgame.kills)}
          {statsHeader('RESOURCES', ICON.endgame.resources)}
        </UiEntity>
        {entries.map((entry, index) => statsRow(entry, gameState.matchStats[entry.team], index))}

        {incomeGraph(entries)}

        <UiEntity uiTransform={{ width: '100%', height: 58, flexDirection: 'row', justifyContent: 'center', margin: { top: 26 } }}>
          {/* A multiplayer rematch goes through the lobby (everyone re-readies);
              only single-player can restart on the spot. */}
          <Button
            value={isMultiplayerMatch() ? 'BACK TO LOBBY' : 'PLAY AGAIN'}
            variant="primary"
            fontSize={24}
            uiTransform={{ width: 240, height: 58, margin: { right: 12 } }}
            uiBackground={{ color: UI.accent }}
            onMouseDown={() => {
              triggerScreenFade()
              if (isMultiplayerMatch()) {
                requestLobbyReset()
                setViewedLobbyId(getMyLobbyId())
                titleStage = 'lobby'
                returnToMainMenu()
              } else {
                resetRtsGame()
              }
            }}
          />
          <Button
            value="MAIN MENU"
            variant="secondary"
            fontSize={24}
            uiTransform={{ width: 240, height: 58, margin: { left: 12 } }}
            uiBackground={{ color: Color4.create(0.25, 0.32, 0.45, 0.95) }}
            onMouseDown={() => {
              triggerScreenFade()
              titleStage = 'title'
              if (isMultiplayerMatch()) requestLobbyReset() // reopen the lobby for everyone
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
const GRAPH_HEIGHT = 150
/** Horizontal pixel step between plotted dots; dots are sized to touch so each series reads as a line. */
const GRAPH_PIXEL_STEP = 7
const GRAPH_DOT_SIZE = 6
const GRAPH_GRID_COLOR = Color4.create(1, 1, 1, 0.07)

function incomeGraph(entries: ScoreboardEntry[]) {
  const maxSamples = Math.max(...entries.map(({ team }) => gameState.incomeHistory[team].length))
  const maxValue = Math.max(1, ...entries.map(({ team }) => gameState.incomeHistory[team][gameState.incomeHistory[team].length - 1] ?? 0))

  const plotWidth = GRAPH_WIDTH - 14
  const plotHeight = GRAPH_HEIGHT - 14

  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center', margin: { top: 20 } }}>
      <UiEntity uiTransform={{ width: GRAPH_WIDTH, height: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label value="RESOURCES GATHERED OVER TIME" fontSize={14} color={UI.dim} textAlign="middle-left" textWrap="nowrap" />
        <Label value={formatNumber(maxValue)} fontSize={13} color={UI.dim} textAlign="middle-right" textWrap="nowrap" />
      </UiEntity>
      <UiEntity uiTransform={{ width: GRAPH_WIDTH, height: GRAPH_HEIGHT, margin: { top: 6 } }} uiBackground={{ color: Color4.create(0.02, 0.03, 0.05, 0.95) }}>
        {/* Quarter gridlines plus a baseline give the plot scale at a glance. */}
        {[0.25, 0.5, 0.75].map((fraction) => (
          <UiEntity
            key={`grid-${fraction}`}
            uiTransform={{ positionType: 'absolute', position: { left: 0, top: 7 + fraction * plotHeight }, width: '100%', height: 1 }}
            uiBackground={{ color: GRAPH_GRID_COLOR }}
          />
        ))}
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, bottom: 6 }, width: '100%', height: 1 }} uiBackground={{ color: Color4.create(1, 1, 1, 0.16) }} />

        {maxSamples < 2 ? (
          <Label value="Match too short to graph." fontSize={14} color={UI.dim} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
        ) : (
          entries.map(({ team, color }) => {
            const samples = gameState.incomeHistory[team]
            if (samples.length < 2) return null

            // Interpolate between samples at a fixed pixel step so each series
            // renders as a continuous line instead of scattered points.
            const seriesWidth = ((samples.length - 1) / (maxSamples - 1)) * plotWidth
            const dots = []
            for (let x = 0; x <= seriesWidth; x += GRAPH_PIXEL_STEP) {
              const u = (x / plotWidth) * (maxSamples - 1)
              const i0 = Math.min(samples.length - 1, Math.floor(u))
              const i1 = Math.min(samples.length - 1, i0 + 1)
              const value = samples[i0] + (samples[i1] - samples[i0]) * (u - i0)
              const y = 7 + (1 - value / maxValue) * plotHeight
              dots.push(
                <UiEntity
                  key={`income-${team}-${x}`}
                  uiTransform={{ positionType: 'absolute', position: { left: 7 + x - GRAPH_DOT_SIZE / 2, top: y - GRAPH_DOT_SIZE / 2 }, width: GRAPH_DOT_SIZE, height: GRAPH_DOT_SIZE }}
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
      {/* Legend: color chip + faction label per series. */}
      <UiEntity uiTransform={{ width: GRAPH_WIDTH, height: 22, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', margin: { top: 8 } }}>
        {entries.map((entry) => (
          <UiEntity key={`legend-${entry.team}`} uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { left: 14, right: 14 } }}>
            <UiEntity uiTransform={{ width: 12, height: 12, margin: { right: 7 } }} uiBackground={{ color: entry.color }} />
            <Label value={entry.label} fontSize={13} color={UI.dim} textAlign="middle-left" textWrap="nowrap" />
          </UiEntity>
        ))}
      </UiEntity>
    </UiEntity>
  )
}

function statsHeader(label: string, icon: string) {
  return (
    <UiEntity uiTransform={{ width: 200, height: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: 26, height: 26, margin: { right: 8 } }} uiBackground={{ textureMode: 'stretch', texture: { src: icon } }} />
      <Label value={label} fontSize={15} color={UI.dim} textAlign="middle-left" textWrap="nowrap" />
    </UiEntity>
  )
}

function statsRow(entry: ScoreboardEntry, stats: { unitsProduced: number; unitsKilled: number; resourcesGathered: number }, index: number) {
  const avatar = `images/icons/${UNIT_ICON_FILES.melee}${RACE_ICON_SUFFIX[entry.race]}.jpg`
  // Difficulty is an AI concept: human teams (you and other players) never show one.
  const isHumanTeam = entry.team === 'player' || isMultiplayerHumanTeam(entry.team)
  const difficulty = isHumanTeam ? undefined : AI_DIFFICULTY[gameState.enemyDifficulties[entry.team as EnemyTeam]].label.toUpperCase()
  const subtitle = `${RACES[entry.race].name}${difficulty ? ` · ${difficulty}` : ''}`

  return (
    <UiEntity
      key={`score-${entry.team}`}
      uiTransform={{ width: '100%', height: 64, flexDirection: 'row', alignItems: 'center', margin: { top: 8 } }}
      uiBackground={{ color: index % 2 === 0 ? UI.cardSoft : UI.card }}
    >
      {/* Team color stripe on the leading edge. */}
      <UiEntity uiTransform={{ width: 4, height: '100%' }} uiBackground={{ color: entry.color }} />
      <UiEntity uiTransform={{ width: 308, height: '100%', flexDirection: 'row', alignItems: 'center', padding: { left: 12 } }}>
        <UiEntity uiTransform={{ width: 46, height: 46, padding: 2, margin: { right: 12 } }} uiBackground={{ color: UI.slotFrame }}>
          <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ textureMode: 'stretch', texture: { src: avatar } }} />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'column', width: 220 }}>
          <Label value={entry.label} fontSize={19} color={entry.color} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 24 }} />
          <Label value={subtitle} fontSize={13} color={UI.dim} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 18 }} />
        </UiEntity>
      </UiEntity>
      <Label value={formatNumber(stats.unitsProduced)} fontSize={21} color={UI.text} textAlign="middle-center" uiTransform={{ width: 200, height: '100%' }} />
      <Label value={formatNumber(stats.unitsKilled)} fontSize={21} color={UI.text} textAlign="middle-center" uiTransform={{ width: 200, height: '100%' }} />
      <Label value={formatNumber(stats.resourcesGathered)} fontSize={21} color={UI.text} textAlign="middle-center" uiTransform={{ width: 200, height: '100%' }} />
    </UiEntity>
  )
}

function formatNumber(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
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
  if (kind === 'airForge') return 'AIR RESEARCH'
  if (kind === 'turret') return 'DEFENSE'
  if (kind === 'fireplace') return 'UTILITY'
  if (kind === 'soldier') return 'FIGHTER'
  if (kind === 'enemyBuilding') return 'ENEMY'
  return 'COMMANDS'
}
