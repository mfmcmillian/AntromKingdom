import {
  Animator,
  AudioSource,
  AvatarModifierArea,
  AvatarModifierType,
  ColliderLayer,
  Entity,
  GltfContainer,
  InputAction,
  Material,
  MeshCollider,
  MeshRenderer,
  PointerEventType,
  PrimaryPointerInfo,
  TextShape,
  Transform,
  engine,
  inputSystem,
  pointerEventsSystem
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import {
  AI_DIFFICULTY,
  ASSETS,
  BUILDING_DEFINITIONS,
  COLORS,
  CONFIG,
  GRID,
  MAP_ANCHORS,
  MODEL_TRANSFORMS,
  POSITIONS,
  RESOURCE_DEFINITIONS,
  ResourceField,
  SCENE,
  TURRET_STATS
} from './rts/config'
import { getMapById } from './rts/maps'
import {
  addSupplyUsed,
  addResources,
  addSupplyCap,
  canQueueUnit,
  getConstructionRefund,
  getSupplyCap,
  getSupplyUsed,
  hasResources,
  resetEconomy,
  spendResources
} from './rts/economy'
import {
  createBoxEntity,
  createLabel,
  createModelColliderEntity,
  createModelEntity,
  createRallyMarker,
  createVisualBoxEntity,
  hideEntity,
  type RallyMarker
} from './rts/entities'
import { formatNumber, formatPosition, formatVectorForPaste } from './rts/format'
import { clamp, cloneVector, distanceToPoint, distanceToPosition, getFormationPosition, offsetSpawn } from './rts/math'
import { ENEMY_TEAMS, areHostile, gameState, isHostileToPlayer, isPlayerAlly, resetTeamStats } from './rts/state'
import { updateSoldiers as updateSoldiersSystem } from './rts/systems/combat'
import { updateHealers } from './rts/systems/healers'
import { createEnemyAi, updateEnemyAi as updateEnemyAiSystem, type EnemyAi } from './rts/systems/enemyAi'
import { updateSoldierProduction as updateSoldierProductionSystem, updateWorkerProduction as updateWorkerProductionSystem } from './rts/systems/production'
import { addAttackPing, clearAttackPings, updateAttackPings } from './rts/minimap'
import { clearHealthBars, updateHealthBars } from './rts/healthBars'
import { updateUnitSeparation } from './rts/systems/separation'
import { updateWorkers as updateWorkersSystem } from './rts/systems/workers'
import { mulberry32, type LocalMatchPlan } from './rts/multiplayer/seatMap'
import { broadcastMyCommand, isRelayActive, stopCommandRelay } from './rts/multiplayer/commandRelay'
import { isPlayerPresent } from './rts/multiplayer/session'
import type { MatchCommand } from './rts/multiplayer/protocol'
import { updateDragSelect } from './rts/dragSelect'
import { initFogOfWar, resetFogOfWar } from './rts/fogOfWar'
import { isPointerOverHud } from './rts/hud'
import { SelectionMarkerTarget, clearSelectionMarkers, updateSelectionMarkers } from './rts/selectionMarkers'
import { buildEnvironmentEnclosure } from './rts/environment'
import { buildTerrain } from './rts/terrain'
import { buildUnitModel, disposeUnit, getTeamColor, isProceduralUnit, setSiegeDeployProgress, setUnitAnimation, setUnitUpgradeInsignia, updateUnitCargo } from './rts/unitModels'
import { BUILDING_MODEL_HEIGHTS, buildBuildingModel, disposeBuildingModel, isProceduralBuilding, setBuildingModelDamage } from './rts/buildingModels'
import { RACES, UNIT_REQUIREMENTS, getBuildingDisplayName, getRace, getSoldierDefinition, getWorkerDefinition, pickRandomRace } from './rts/races'
import { buildResourceModel, disposeResourceModel, playResourceDepletion, playResourceGatherPulse } from './rts/resourceModels'
import { showMoveMarker } from './rts/moveMarker'
import { fireProjectile } from './rts/projectiles'
import { spawnBlastRing, spawnDeathBurst, spawnImpactFlash } from './rts/impactVfx'
import { clearAllConstructionVfx } from './rts/constructionVfx'
import { playAcknowledge, playComplete, playExplosion, playLaser, playMelee, playResearchComplete, playUnderAttackAlert, setAckVoice, startAmbientMusic, stopAmbientMusic } from './rts/sound'
import {
  getDamageMultiplier,
  getNextUpgradeCost,
  getUpgradeKindsFor,
  getUpgradeLevel,
  isUpgradeInProgress,
  resetUpgrades,
  startUpgradeResearchOrder,
  updateUpgradeResearch,
  UPGRADE_INFO
} from './rts/upgrades'
import { disableTopDownView, enableTopDownView, getCameraFocus, isTopDownViewActive, setCameraFocus } from './rts/topDownCamera'
import { createBuildingDamageVfx, removeBuildingDamageVfx, updateBuildingDamageVfx } from './rts/vfx'
import {
  buildings,
  canAttackTarget,
  createEntityId,
  createScopedEntityId,
  getAvailableWorkersForTeam,
  getTeam,
  getTeamSoldierCount,
  getTeamWorkerCount,
  isEnemyTeam,
  resources,
  resetWorld,
  selectables,
  soldierProductionOrders,
  soldiers,
  workerProductionOrders,
  workers
} from './rts/world'
import type {
  BoxConfig,
  BuildableKind,
  Building,
  BuildingDefinition,
  ConstructionState,
  EnemyTeam,
  ModelConfig,
  PlacementState,
  RaceId,
  ResourceCost,
  ResourceKind,
  ResourceNode,
  Selectable,
  SelectableKind,
  SelectedSummary,
  Soldier,
  SoldierStance,
  SoldierVariant,
  Team,
  UpgradeKind,
  Worker
} from './rts/types'
export type { SelectedSummary } from './rts/types'
export { gameState }

type BuildingPreview = { ghostEntity: Entity; ghostFootprintEntity: Entity; ghostModelEntity: Entity }

let placementState: PlacementState = { state: 'none' }
let rallyMarker: RallyMarker | undefined
let coordinateLogTimer = 0
let currentBuildingPreviewPosition: Vector3 | undefined
let currentBuildingPreviewCanPlace = false
let currentBuildingPreviewRotationY = 0
let placementConfirmCooldown = 0
let secondaryCancelWasPressed = false
const templeRallyPoints = new Map<string, Vector3>()
const barracksRallyPoints = new Map<string, Vector3>()
let rallyPlacementKind: 'temple' | 'barracks' | 'none' = 'none'
let rallyPlacementBuildingId = ''
let rallyPlacementCooldown = 0
const BUILDING_FOOTPRINT_Y = 0.18
const BUILDING_FOOTPRINT_HEIGHT = 0.16
const BUILDING_PREVIEW_PADDING = 1.5
const BUILDING_PLACEMENT_CLICK_COOLDOWN = 0.25
// How long a status prompt stays on screen before fading (StarCraft-style transient messages).
const STATUS_MESSAGE_DURATION = 4
const BUILDING_PLACEMENT_GRID_SIZE = 0.5
const BUILDING_PLACEMENT_PADDING = 0.6
const BUILDING_FOOTPRINT_VALID = Color4.create(0.2, 0.95, 0.35, 0.45)
const BUILDING_FOOTPRINT_BLOCKED = Color4.create(0.95, 0.15, 0.12, 0.5)
const DEPLETED_GAS_HIDE_DELAY = 180
const PLAYER_ATTACK_ALERT_DURATION = 4
const SOLDIER_MOVE_FORMATION_RADIUS = 0.9
const SOLDIER_ATTACK_SPACING = 0.7
const ENEMY_DEFENSE_RADIUS = 20

// One AI brain per computer opponent, rebuilt from the setup each match.
let enemyAis: EnemyAi[] = []
// Set for multiplayer matches: this client's seat-to-team view of the lobby.
let multiplayerPlan: LocalMatchPlan | undefined
const TEMPLE_ATTACK_DISTANCE_PADDING = 3
const MATCH_NOT_STARTED = 'notStarted'
const MATCH_ACTIVE = 'active'
const MATCH_ENDED = 'ended'

export function initRtsGame(): void {
  // Only the static scenery loads up front: bases, units and resource nodes
  // spawn at match start, so nothing pokes through (or hover-hints under) the
  // title and setup menus.
  createStaticScene()
  initFogOfWar()
  engine.addSystem(rtsTickSystem)
}

export function startRtsMatch(): void {
  multiplayerPlan = undefined
  stopCommandRelay()
  launchMatch()
}

/**
 * Multiplayer entry point: the frozen lobby snapshot (translated to this
 * client's seat-to-team view) replaces the title-screen opponent setup.
 * Teams held by other humans get no AI brain; their orders arrive over the
 * command relay instead.
 */
export function startMultiplayerRtsMatch(plan: LocalMatchPlan): void {
  multiplayerPlan = plan
  launchMatch()
}

export function isMultiplayerMatch(): boolean {
  return multiplayerPlan !== undefined
}

/** Lobby display name for a team in a multiplayer match; undefined for computers and single-player. */
export function getMultiplayerTeamName(team: Team): string | undefined {
  return multiplayerPlan?.names[team]
}

/** True when this team is driven by another human, not an AI. */
export function isMultiplayerHumanTeam(team: Team): boolean {
  return multiplayerPlan?.humanTeams.includes(team) ?? false
}

/**
 * Entity ids must match across multiplayer clients so relayed commands can
 * reference units. Team entities scope to the owning seat (identical creation
 * sequence per team everywhere); map resources spawn in one seeded order and
 * share a fixed scope. Single-player keeps the plain global counter.
 */
function mintEntityId(kind: string, team: Team | undefined): string {
  if (!multiplayerPlan) return createEntityId(kind)

  const seat = team !== undefined ? multiplayerPlan.teamToSeat[team] : undefined
  return createScopedEntityId(seat !== undefined ? `s${seat}` : 'map', kind)
}

function launchMatch(): void {
  if (gameState.matchStatus === MATCH_ACTIVE) return

  // Always rebuild the base so the chosen race's units and buildings spawn fresh.
  resetRtsGame()
  gameState.matchResult = 'none'
  const allies = gameState.activeEnemyTeams.filter((team) => isPlayerAlly(team)).map((team) => RACES[gameState.enemyRaces[team]].name)
  const foes = gameState.activeEnemyTeams.filter((team) => isHostileToPlayer(team)).map((team) => RACES[gameState.enemyRaces[team]].name)
  const yourSide = [getRace('player').name, ...allies].join(' + ')
  const versus = gameState.gameMode === 'ffa' ? foes.join(' vs ') : foes.join(' + ')
  gameState.status = `${yourSide} vs ${versus}. Select a worker to gather resources.`
}

export function endRtsMatch(): void {
  if (gameState.matchStatus === MATCH_ENDED) return

  endMatch('loss')
}

/**
 * Back to the title screen from the end-game screen: rebuild a fresh world
 * (so the setup screen sits over a clean map) but leave the match unstarted.
 */
export function returnToMainMenu(): void {
  multiplayerPlan = undefined
  stopCommandRelay()
  // Teardown only - no rebuild. The world stays empty behind the menus until
  // the next match starts.
  clearMatchWorld()
  gameState.matchStatus = MATCH_NOT_STARTED
  gameState.matchResult = 'none'
  gameState.status = ''
  stopAmbientMusic()
  disableTopDownView()
}

export function queueWorker(): void {
  if (!isMatchActive()) return

  const selected = getSelected()
  const temple = selected?.kind === 'temple' ? (selected as Building) : undefined

  const workerDef = getWorkerDefinition('player')
  const templeName = getBuildingDisplayName('temple', 'player')

  if (!temple?.alive || !temple.isComplete) {
    setStatus(`Select a completed ${templeName} to create ${workerDef.name}s.`)
    return
  }

  if (!canQueueUnit('player', workerDef.supply)) {
    setStatus(`Need more supply before creating ${workerDef.name}s.`)
    return
  }

  if (!spendResources('player', workerDef.cost)) {
    setStatus(`Need ${formatCost(workerDef.cost)} for a ${workerDef.name}.`)
    return
  }

  workerProductionOrders.push({ templeId: temple.id, timer: 0, productionTime: workerDef.productionTime, team: 'player' })
  gameState.economies.player.workerQueue += 1
  if (isRelayActive()) broadcastMyCommand({ type: 'train', buildingId: temple.id, unit: 'worker' })
  setStatus(`${workerDef.name} queued at the ${templeName}.`)
}

export function setWorkerSpawnPoint(): void {
  if (!isMatchActive()) return

  const selected = getSelected()

  if (selected?.kind !== 'temple') {
    setStatus('Select your Temple first, then set the worker spawn point.')
    return
  }

  const temple = selected as Building
  if (!temple.isComplete) {
    setStatus('Finish the Temple before setting its spawn point.')
    return
  }

  startRallyPlacement('temple', temple.id)
  setStatus('Click the ground where new workers should gather.')
}

export function setBarracksSpawnPoint(): void {
  if (!isMatchActive()) return

  const selected = getSelected()

  // Both fighter-producing buildings share the rally map, so the same command works for each.
  if (selected?.kind !== 'barracks' && selected?.kind !== 'techLab') {
    setStatus('Select a fighter-producing building first, then set the spawn point.')
    return
  }

  const trainer = selected as Building
  if (!trainer.isComplete) {
    setStatus(`Finish the ${trainer.name} before setting its spawn point.`)
    return
  }

  startRallyPlacement('barracks', trainer.id)
  setStatus('Click the ground where new fighters should gather.')
}

function startRallyPlacement(kind: 'temple' | 'barracks', buildingId: string): void {
  rallyPlacementKind = kind
  rallyPlacementBuildingId = buildingId
  rallyPlacementCooldown = BUILDING_PLACEMENT_CLICK_COOLDOWN
}

function cancelRallyPlacement(): void {
  rallyPlacementKind = 'none'
  rallyPlacementBuildingId = ''
  rallyPlacementCooldown = 0
}

function updateRallyPlacementInput(dt: number): void {
  if (rallyPlacementKind === 'none') return

  rallyPlacementCooldown = Math.max(0, rallyPlacementCooldown - dt)
  if (rallyPlacementCooldown > 0) return
  if (!inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return
  if (isPointerOverHud()) return

  const ground = getPointerGroundPosition()
  if (!ground) {
    setStatus('Spawn point needs a ground click.')
    return
  }

  const rallyPoint = Vector3.create(ground.x, 0.25, ground.z)
  if (rallyPlacementKind === 'temple') {
    templeRallyPoints.set(rallyPlacementBuildingId, rallyPoint)
    setStatus(`Worker spawn point set to ${formatPosition(rallyPoint)}.`)
  } else {
    barracksRallyPoints.set(rallyPlacementBuildingId, rallyPoint)
    setStatus(`Barracks spawn set to ${formatPosition(rallyPoint)}.`)
  }
  if (isRelayActive()) broadcastMyCommand({ type: 'rally', buildingId: rallyPlacementBuildingId, x: rallyPoint.x, z: rallyPoint.z })
  cancelRallyPlacement()
}

// ---------------------------------------------------------------------------
// Attack-move: click the button (or slot), then click the ground. Fighters
// march to the point and engage every hostile they spot along the way.
// ---------------------------------------------------------------------------

let attackMovePending = false
let attackMoveCooldown = 0

/**
 * True from the moment a pending-order handler (attack-move / patrol) uses a
 * ground click until that pointer press is released. Without this, drag-select
 * runs later in the same frame, sees the pending flag already cleared, and
 * re-reads the same press as a plain move order - overwriting the order that
 * was just issued.
 */
let orderClickConsumedUntilRelease = false

export function startAttackMove(): void {
  if (!isMatchActive()) return

  const attackers = getCommandableSoldiers().filter((soldier) => soldier.alive && getTeam(soldier) === 'player')
  if (attackers.length === 0) {
    setStatus('Select fighters first, then order the attack-move.')
    return
  }

  cancelPatrol()
  cancelRepairOrder()
  attackMovePending = true
  attackMoveCooldown = BUILDING_PLACEMENT_CLICK_COOLDOWN
  setStatus('Attack-move: click the ground. Fighters engage everything on the way.')
}

function cancelAttackMove(): void {
  attackMovePending = false
  attackMoveCooldown = 0
}

// ---------------------------------------------------------------------------
// Repair: click the button with workers selected, then click the target.
// Buildings are repairable by every race; human crews can also weld their
// mechanical fighters back together.
// ---------------------------------------------------------------------------

let repairPending = false
let repairCooldown = 0

export function startRepairOrder(): void {
  if (!isMatchActive()) return

  const repairers = getSelectedWorkers().filter((worker) => worker.alive && getTeam(worker) === 'player')
  if (repairers.length === 0) {
    setStatus('Select a worker first, then order the repair.')
    return
  }

  cancelAttackMove()
  cancelPatrol()
  repairPending = true
  repairCooldown = BUILDING_PLACEMENT_CLICK_COOLDOWN
  setStatus(getRace('player').id === 'human' ? 'Repair: click a damaged building or mech fighter.' : 'Repair: click a damaged building.')
}

function cancelRepairOrder(): void {
  repairPending = false
  repairCooldown = 0
}

/** While a repair order is armed, a click on empty ground calls it off. */
function updateRepairOrderInput(dt: number): void {
  if (!repairPending) return

  repairCooldown = Math.max(0, repairCooldown - dt)
  if (repairCooldown > 0) return
  if (!inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return
  if (isPointerOverHud()) return
  // Clicks on selectables run through handleSelectableClick instead.
  if (isPointerPressOnSelectable()) return

  cancelRepairOrder()
  orderClickConsumedUntilRelease = true
  setStatus('Repair cancelled.')
}

function orderWorkersToRepair(repairers: Worker[], target: Building | Soldier): void {
  const assigned: Worker[] = []
  for (const worker of repairers) {
    assignWorkerToRepair(worker, target, false)
    if (worker.repairTargetId === target.id) assigned.push(worker)
  }

  if (assigned.length === 0) {
    setStatus(`No idle workers available to repair ${target.name}.`)
    return
  }

  playAcknowledge()
  setStatus(`${assigned.length} worker${assigned.length === 1 ? '' : 's'} moving to repair ${target.name}.`)
  if (isRelayActive()) broadcastMyCommand({ type: 'repair', workerIds: assigned.map((worker) => worker.id), buildingId: target.id })
}

// ---------------------------------------------------------------------------
// Patrol: click the button, then click the ground. Fighters walk back and
// forth between where they stood and the clicked point, engaging any hostile
// they spot and resuming the route once the fight is over.
// ---------------------------------------------------------------------------

let patrolPending = false
let patrolCooldown = 0

export function startPatrol(): void {
  if (!isMatchActive()) return

  const patrollers = getCommandableSoldiers().filter((soldier) => soldier.alive && getTeam(soldier) === 'player')
  if (patrollers.length === 0) {
    setStatus('Select fighters first, then order the patrol.')
    return
  }

  cancelAttackMove()
  cancelRepairOrder()
  patrolPending = true
  patrolCooldown = BUILDING_PLACEMENT_CLICK_COOLDOWN
  setStatus('Patrol: click the ground. Fighters walk the route and engage hostiles on the way.')
}

function cancelPatrol(): void {
  patrolPending = false
  patrolCooldown = 0
}

function updatePatrolInput(dt: number): void {
  if (!patrolPending) return

  patrolCooldown = Math.max(0, patrolCooldown - dt)
  if (patrolCooldown > 0) return
  if (!inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return
  if (isPointerOverHud()) return

  const ground = getPointerGroundPosition()
  if (!ground) {
    setStatus('Patrol needs a ground click.')
    return
  }

  cancelPatrol()
  orderClickConsumedUntilRelease = true
  const patrollers = getCommandableSoldiers().filter((soldier) => soldier.alive && getTeam(soldier) === 'player' && !isSiegeLocked(soldier))
  if (patrollers.length === 0) return

  const destination = Vector3.create(ground.x, 0.25, ground.z)
  for (let i = 0; i < patrollers.length; i++) {
    const soldier = patrollers[i]
    const here = Transform.get(soldier.entity).position
    const slotPosition = getFormationPosition(destination, i, SOLDIER_MOVE_FORMATION_RADIUS)
    soldier.state = 'patrolling'
    soldier.targetId = undefined
    soldier.attackPosition = undefined
    soldier.rallyPoint = undefined
    soldier.attackMovePoint = undefined
    soldier.autoEngaged = false
    soldier.patrolPointA = Vector3.create(here.x, 0.25, here.z)
    soldier.patrolPointB = Vector3.create(slotPosition.x, 0.25, slotPosition.z)
    soldier.patrolToB = true
    setSoldierAnimation(soldier, 'walk')
  }

  if (isRelayActive()) broadcastMyCommand({ type: 'patrol', unitIds: patrollers.map((soldier) => soldier.id), x: ground.x, z: ground.z })
  showMoveMarker(ground)
  playAcknowledge()
  setStatus(`${patrollers.length} fighter${patrollers.length === 1 ? '' : 's'} patrolling.`)
}

function updateAttackMoveInput(dt: number): void {
  if (!attackMovePending) return

  attackMoveCooldown = Math.max(0, attackMoveCooldown - dt)
  if (attackMoveCooldown > 0) return
  if (!inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return
  if (isPointerOverHud()) return
  // Presses on units/buildings resolve in handleSelectableClick: clicking an
  // enemy while the order is armed target-locks the army instead of a-moving.
  if (isPointerPressOnSelectable()) return

  const ground = getPointerGroundPosition()
  if (!ground) {
    setStatus('Attack-move needs a ground click.')
    return
  }

  cancelAttackMove()
  orderClickConsumedUntilRelease = true
  const attackers = getCommandableSoldiers().filter((soldier) => soldier.alive && getTeam(soldier) === 'player' && !isSiegeLocked(soldier))
  if (attackers.length === 0) return

  const destination = Vector3.create(ground.x, 0.25, ground.z)
  for (let i = 0; i < attackers.length; i++) {
    const soldier = attackers[i]
    const slotPosition = getFormationPosition(destination, i, SOLDIER_MOVE_FORMATION_RADIUS)
    soldier.state = 'attackMoving'
    soldier.targetId = undefined
    soldier.attackPosition = undefined
    soldier.rallyPoint = undefined
    soldier.autoEngaged = false
    soldier.patrolPointA = undefined
    soldier.patrolPointB = undefined
    soldier.attackMovePoint = Vector3.create(slotPosition.x, 0.25, slotPosition.z)
    setSoldierAnimation(soldier, 'walk')
  }

  if (isRelayActive()) broadcastMyCommand({ type: 'attackMove', unitIds: attackers.map((soldier) => soldier.id), x: ground.x, z: ground.z })
  showMoveMarker(ground)
  playAcknowledge()
  setStatus(`${attackers.length} fighter${attackers.length === 1 ? '' : 's'} attack-moving.`)
}

/** Halt a single unit in its tracks, clearing every standing order. */
function haltUnit(unit: Soldier | Worker): void {
  if (unit.kind === 'soldier') {
    const soldier = unit as Soldier
    soldier.state = 'idle'
    soldier.targetId = undefined
    soldier.attackPosition = undefined
    soldier.attackMovePoint = undefined
    soldier.patrolPointA = undefined
    soldier.patrolPointB = undefined
    soldier.rallyPoint = undefined
    soldier.autoEngaged = false
    soldier.guardPoint = cloneVector(Transform.get(soldier.entity).position)
    setSoldierAnimation(soldier, 'idle')
    return
  }

  const worker = unit as Worker
  // Builders and repair crews finish what they're doing; stop only interrupts fighting/walking.
  if (worker.state === 'constructing' || worker.state === 'repairing') return
  worker.state = 'idle'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
  worker.repairTargetId = undefined
  worker.attackTargetId = undefined
  worker.rallyPoint = undefined
  worker.timer = 0
  setWorkerAnimation(worker, 'idle')
}

/** StarCraft Stop: selected units drop every order and stand where they are. */
export function stopSelectedUnits(): void {
  if (!isMatchActive()) return

  const units: (Soldier | Worker)[] = [...getSelectedSoldiers(), ...getSelectedWorkers()].filter((unit) => unit.alive && getTeam(unit) === 'player')
  if (units.length === 0) {
    setStatus('Select units first.')
    return
  }

  for (const unit of units) haltUnit(unit)
  playAcknowledge()
  setStatus(`${units.length} unit${units.length === 1 ? '' : 's'} stopped.`)
  if (isRelayActive()) broadcastMyCommand({ type: 'stop', unitIds: units.map((unit) => unit.id), x: 0, z: 0 })
}

// ---------------------------------------------------------------------------
// Stances: toggle defensive <-> hold for the selected fighters.
// ---------------------------------------------------------------------------

const STANCE_ORDER: SoldierStance[] = ['defensive', 'hold']
export const STANCE_LABELS: Record<SoldierStance, string> = {
  defensive: 'Defensive',
  hold: 'Hold Position'
}

export function cycleSelectedStance(): void {
  if (!isMatchActive()) return

  const selectedSoldiers = getSelectedSoldiers().filter((soldier) => soldier.alive && getTeam(soldier) === 'player')
  if (selectedSoldiers.length === 0) {
    setStatus('Select fighters first.')
    return
  }

  const next = STANCE_ORDER[(STANCE_ORDER.indexOf(selectedSoldiers[0].stance) + 1) % STANCE_ORDER.length]
  for (const soldier of selectedSoldiers) {
    soldier.stance = next
    soldier.guardPoint = cloneVector(Transform.get(soldier.entity).position)
    // Hold means hold: stop any chase or march in its tracks.
    if (next === 'hold' && (soldier.state === 'movingToAttack' || soldier.state === 'attackMoving' || soldier.state === 'movingToRally')) {
      soldier.state = 'idle'
      soldier.targetId = undefined
      soldier.attackPosition = undefined
      soldier.attackMovePoint = undefined
      soldier.rallyPoint = undefined
      setSoldierAnimation(soldier, 'idle')
    }
  }
  if (isRelayActive()) broadcastMyCommand({ type: 'stance', unitIds: selectedSoldiers.map((soldier) => soldier.id), stance: next })
  setStatus(`Stance set to ${STANCE_LABELS[next]} (${selectedSoldiers.length} fighter${selectedSoldiers.length === 1 ? '' : 's'}).`)
}

/** Stance of the first selected fighter, for the command card label. */
export function getSelectedStance(): SoldierStance | undefined {
  return getSelectedSoldiers().find((soldier) => soldier.alive)?.stance
}

// ---------------------------------------------------------------------------
// Siege mode: artillery rolls around weak, then digs in on command. While the
// transform plays the gun is locked down; once deployed the big cannon grows
// out, damage/range jump to full strength and the unit cannot move.
// ---------------------------------------------------------------------------

const SIEGE_TRANSFORM_TIME = 2.5
/** Mobile-mode direct fire: a fraction of the deployed cannon's punch, short range, no splash. */
const SIEGE_MOBILE_DAMAGE_FACTOR = 0.35
const SIEGE_MOBILE_RANGE = 5.5
/** AI packs up after this long with no hostiles in deployed range. */
const AI_UNSIEGE_DELAY = 6
const AI_SIEGE_SCAN_INTERVAL = 0.6

/** Dug in or mid-transform: the gun refuses movement orders. */
function isSiegeLocked(soldier: Soldier): boolean {
  return soldier.variant === 'siege' && (soldier.sieged === true || (soldier.siegeTransition ?? 0) > 0)
}

/** Swaps the live weapon stats between mobile pop-gun and deployed cannon. */
function applySiegeModeStats(soldier: Soldier, sieged: boolean): void {
  const definition = getSoldierDefinition(getTeam(soldier), 'siege')
  if (sieged) {
    soldier.damage = definition.damage ?? soldier.damage
    soldier.attackRange = definition.attackRange ?? soldier.attackRange
    soldier.splashRadius = definition.splashRadius ?? 0
  } else {
    soldier.damage = Math.max(1, Math.round((definition.damage ?? 10) * SIEGE_MOBILE_DAMAGE_FACTOR))
    soldier.attackRange = SIEGE_MOBILE_RANGE
    soldier.splashRadius = 0
  }
}

/** Kicks off the dig-in / pack-up transform: drops every order and locks the unit down. */
function startSiegeTransition(soldier: Soldier, sieged: boolean): void {
  if (!soldier.alive || soldier.variant !== 'siege') return
  if ((soldier.siegeTransition ?? 0) > 0 || soldier.sieged === sieged) return

  soldier.siegeTargetMode = sieged
  soldier.siegeTransition = SIEGE_TRANSFORM_TIME
  soldier.siegeIdleTimer = 0
  soldier.state = 'idle'
  soldier.targetId = undefined
  soldier.attackPosition = undefined
  soldier.attackMovePoint = undefined
  soldier.patrolPointA = undefined
  soldier.patrolPointB = undefined
  soldier.rallyPoint = undefined
  soldier.autoEngaged = false
  soldier.guardPoint = cloneVector(Transform.get(soldier.entity).position)
  setSoldierAnimation(soldier, 'impact')
}

/** Command card toggle: digs in every mobile gun in the selection, or packs them all up. */
export function toggleSelectedSiegeMode(): void {
  if (!isMatchActive()) return

  const siegeUnits = getSelectedSoldiers().filter((soldier) => soldier.alive && soldier.variant === 'siege' && getTeam(soldier) === 'player')
  if (siegeUnits.length === 0) {
    setStatus('Select siege artillery first.')
    return
  }

  const sieged = siegeUnits.some((soldier) => !soldier.sieged)
  const changed = siegeUnits.filter((soldier) => (soldier.siegeTransition ?? 0) <= 0 && soldier.sieged !== sieged)
  if (changed.length === 0) return

  for (const soldier of changed) startSiegeTransition(soldier, sieged)
  if (isRelayActive()) broadcastMyCommand({ type: 'siegeMode', unitIds: changed.map((soldier) => soldier.id), sieged })
  playAcknowledge()
  setStatus(sieged ? `Digging in: the main cannon comes online in ${SIEGE_TRANSFORM_TIME}s.` : 'Packing up: artillery returning to mobile mode.')
}

/** Mode of the first selected siege gun, for the command card label. Undefined when none selected. */
export function getSelectedSiegeMode(): 'mobile' | 'sieged' | 'transforming' | undefined {
  const soldier = getSelectedSoldiers().find((unit) => unit.alive && unit.variant === 'siege')
  if (!soldier) return undefined
  if ((soldier.siegeTransition ?? 0) > 0) return 'transforming'
  return soldier.sieged ? 'sieged' : 'mobile'
}

let aiSiegeScanTimer = 0

/** Ticks transform timers (growing the cannon) and runs the AI's auto dig-in. */
function updateSiegeUnits(dt: number): void {
  aiSiegeScanTimer += dt
  const runAiScan = aiSiegeScanTimer >= AI_SIEGE_SCAN_INTERVAL
  if (runAiScan) aiSiegeScanTimer = 0

  for (const soldier of soldiers) {
    if (!soldier.alive || soldier.variant !== 'siege') continue

    const transition = soldier.siegeTransition ?? 0
    if (transition > 0) {
      const remaining = transition - dt
      soldier.siegeTransition = Math.max(0, remaining)
      const deploying = soldier.siegeTargetMode === true
      const progress = 1 - Math.max(0, remaining) / SIEGE_TRANSFORM_TIME
      setSiegeDeployProgress(soldier.entity, deploying ? progress : 1 - progress)
      if (remaining <= 0) {
        soldier.sieged = deploying
        applySiegeModeStats(soldier, deploying)
        setSiegeDeployProgress(soldier.entity, deploying ? 1 : 0)
        setSoldierAnimation(soldier, 'idle')
      }
      continue
    }

    // AI-owned guns manage their own mode: dig in when hostiles come into the
    // deployed cannon's reach, pack up after the area stays quiet for a while.
    const team = getTeam(soldier)
    if (team === 'player' || isMultiplayerHumanTeam(team) || !runAiScan) continue

    const deployedRange = getSoldierDefinition(team, 'siege').attackRange ?? 11
    const hostileNear = hasHostileWithinRange(soldier, deployedRange - 0.5)
    if (!soldier.sieged) {
      if (hostileNear) startSiegeTransition(soldier, true)
    } else if (hostileNear) {
      soldier.siegeIdleTimer = 0
    } else {
      soldier.siegeIdleTimer = (soldier.siegeIdleTimer ?? 0) + AI_SIEGE_SCAN_INTERVAL
      if (soldier.siegeIdleTimer >= AI_UNSIEGE_DELAY) startSiegeTransition(soldier, false)
    }
  }
}

/** Any enemy ground unit or building inside the radius (air doesn't count: siege can't hit it). */
function hasHostileWithinRange(soldier: Soldier, range: number): boolean {
  const team = getTeam(soldier)
  const position = Transform.get(soldier.entity).position

  for (const other of soldiers) {
    if (!other.alive || other.variant === 'flyer' || !areHostile(team, getTeam(other))) continue
    if (distanceToPoint(position, Transform.get(other.entity).position) <= range) return true
  }
  for (const worker of workers) {
    if (!worker.alive || !areHostile(team, getTeam(worker))) continue
    if (distanceToPoint(position, Transform.get(worker.entity).position) <= range) return true
  }
  for (const building of buildings) {
    if (!building.alive || !areHostile(team, getTeam(building))) continue
    if (distanceToPoint(position, Transform.get(building.entity).position) <= range) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Control groups: save the current selection (units or a building) to a
// numbered slot, recall later. Keyboard 1-4 recalls the matching group.
// ---------------------------------------------------------------------------

export const CONTROL_GROUP_SLOTS = [1, 2, 3, 4]
const controlGroups = new Map<number, string[]>()

export function assignControlGroup(slot: number): void {
  if (!isMatchActive()) return

  const units: (Worker | Soldier)[] = [...getSelectedSoldiers(), ...getSelectedWorkers()].filter((unit) => unit.alive && getTeam(unit) === 'player')

  // A selected building (your barracks, temple...) can be hotkeyed too.
  const selected = getSelected()
  const building = selected?.alive && isBuildableKind(selected.kind as Building['kind']) && getTeam(selected) === 'player' ? (selected as Building) : undefined

  const ids = [...units.map((unit) => unit.id), ...(building ? [building.id] : [])]
  if (ids.length === 0) {
    setStatus('Select units or a building first, then press SET on a group slot.')
    return
  }

  controlGroups.set(slot, ids)
  setStatus(building && units.length === 0 ? `Group ${slot} saved: ${building.name}.` : `Group ${slot} saved: ${ids.length} unit${ids.length === 1 ? '' : 's'}.`)
}

/** Recalling the same group twice quickly (key or button) also snaps the camera to it. */
const GROUP_RECALL_DOUBLE_MS = 450
let lastGroupRecallSlot = 0
let lastGroupRecallTime = 0

export function recallControlGroup(slot: number): void {
  if (!isMatchActive()) return

  const now = Date.now()
  const doubleTap = slot === lastGroupRecallSlot && now - lastGroupRecallTime <= GROUP_RECALL_DOUBLE_MS
  lastGroupRecallSlot = slot
  lastGroupRecallTime = now

  const units = getControlGroupUnits(slot)
  if (units.length > 0) {
    // Fighting selections should command soldiers, so put them first when mixed.
    units.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'soldier' ? -1 : 1))
    setUnitSelection(units)
    if (doubleTap) {
      jumpCameraToUnits(units)
      setStatus(`Group ${slot}: camera on ${units.length} unit${units.length === 1 ? '' : 's'}.`)
    } else {
      setStatus(`Group ${slot}: ${units.length} unit${units.length === 1 ? '' : 's'} selected. Tap again to jump the camera.`)
    }
    return
  }

  // Building-only group: jump straight to the structure (SC-style hotkeyed barracks).
  const building = getControlGroupBuildings(slot)[0]
  if (building) {
    selectObject(building)
    if (doubleTap) {
      const position = Transform.get(building.entity).position
      setCameraFocus(position.x, position.z)
    }
    return
  }

  setStatus(`Group ${slot} is empty. Select units or a building and press SET to fill it.`)
}

/** Center the top-down camera on the group's average position. */
function jumpCameraToUnits(units: (Worker | Soldier)[]): void {
  if (units.length === 0) return
  let x = 0
  let z = 0
  for (const unit of units) {
    const position = Transform.get(unit.entity).position
    x += position.x
    z += position.z
  }
  setCameraFocus(x / units.length, z / units.length)
}

export function getControlGroupCount(slot: number): number {
  return getControlGroupUnits(slot).length + getControlGroupBuildings(slot).length
}

function getControlGroupUnits(slot: number): (Worker | Soldier)[] {
  const ids = controlGroups.get(slot)
  if (!ids) return []

  const units: (Worker | Soldier)[] = []
  for (const id of ids) {
    const unit = soldiers.find((soldier) => soldier.id === id && soldier.alive) ?? workers.find((worker) => worker.id === id && worker.alive)
    if (unit) units.push(unit)
  }
  return units
}

function getControlGroupBuildings(slot: number): Building[] {
  const ids = controlGroups.get(slot)
  if (!ids) return []
  return buildings.filter((building) => building.alive && ids.includes(building.id))
}

/** Keyboard 1-4 (actions 3-6) recall groups 1-4, StarCraft style. */
const CONTROL_GROUP_HOTKEYS: [InputAction, number][] = [
  [InputAction.IA_ACTION_3, 1],
  [InputAction.IA_ACTION_4, 2],
  [InputAction.IA_ACTION_5, 3],
  [InputAction.IA_ACTION_6, 4]
]

function updateControlGroupHotkeys(): void {
  if (!isMatchActive()) return
  for (const [action, slot] of CONTROL_GROUP_HOTKEYS) {
    if (inputSystem.isTriggered(action, PointerEventType.PET_DOWN)) {
      recallControlGroup(slot)
    }
  }
}

export function startWorkerBuildingPlacement(kind: BuildableKind): void {
  if (!isMatchActive()) return

  const selected = getSelected()
  const worker = selected?.kind === 'worker' ? (selected as Worker) : undefined
  const definition = BUILDING_DEFINITIONS[kind]

  if (!worker || !worker.alive) {
    setStatus('Select a live worker to build.')
    return
  }

  if (worker.state === 'movingToBuild' || worker.state === 'constructing' || worker.state === 'movingToRepair' || worker.state === 'repairing') {
    setStatus(`${worker.name} is already building.`)
    return
  }

  if (definition.requires && !hasCompletedBuilding('player', definition.requires)) {
    setStatus(`${getBuildingDisplayName(kind, 'player')} requires a completed ${getBuildingDisplayName(definition.requires, 'player')}.`)
    return
  }

  if (!hasResources(worker.team ?? 'player', definition.cost)) {
    setStatus(`Need ${formatCost(definition.cost)} to build the ${getBuildingDisplayName(kind, 'player')}.`)
    return
  }

  cancelPlacement()
  placementState = {
    state: 'placing',
    buildingKind: kind,
    builderWorkerId: worker.id,
    cost: definition.cost,
    ...createGhostBuilding(definition, Transform.get(worker.entity).position)
  }
  gameState.placementMode = 'placing'
  gameState.placementBuildingKind = kind
  placementConfirmCooldown = BUILDING_PLACEMENT_CLICK_COOLDOWN
  setStatus(`Placing ${getBuildingDisplayName(kind, 'player')}. Click open ground to build. Press E to rotate.`)
}

export function cancelBuildingPlacement(): void {
  if (placementState.state !== 'placing') return

  const kind = placementState.buildingKind
  cancelPlacement()
  setStatus(`Cancelled ${getBuildingDisplayName(kind, 'player')} placement.`)
}

export function queueSoldier(variant: SoldierVariant = 'melee'): void {
  if (!isMatchActive()) return

  // Melee/ranged/healer train at the barracks; caster/flyer/siege/titan need the advanced structure.
  const trainerKind: BuildableKind = variant === 'melee' || variant === 'ranged' || variant === 'healer' ? 'barracks' : 'techLab'
  const selected = getSelected()
  const trainer = selected?.kind === trainerKind ? (selected as Building) : undefined
  const soldierDef = getSoldierDefinition('player', variant)
  const trainerName = getBuildingDisplayName(trainerKind, 'player')

  if (!trainer?.alive || !trainer.isComplete) {
    setStatus(`Select a completed ${trainerName} to create ${soldierDef.name}s.`)
    return
  }

  const requiredKind = UNIT_REQUIREMENTS[variant]
  if (requiredKind && !hasCompletedBuilding('player', requiredKind)) {
    setStatus(`Cannot train ${soldierDef.name}: requires a completed ${getBuildingDisplayName(requiredKind, 'player')}.`)
    return
  }

  if (getSupplyUsed('player') + gameState.economies.player.workerQueue + gameState.economies.player.soldierQueue + soldierDef.supply > getSupplyCap('player')) {
    setStatus(`Need more supply before creating ${soldierDef.name}s.`)
    return
  }

  if (!spendResources('player', soldierDef.cost)) {
    setStatus(`Need ${formatCost(soldierDef.cost)} for a ${soldierDef.name}.`)
    return
  }

  soldierProductionOrders.push({ barracksId: trainer.id, timer: 0, productionTime: soldierDef.productionTime, team: 'player', variant })
  gameState.economies.player.soldierQueue += 1
  if (isRelayActive()) broadcastMyCommand({ type: 'train', buildingId: trainer.id, unit: variant })
  setStatus(`${soldierDef.name} queued at the ${trainerName}.`)
}

/** Starts researching the next level of a team-wide upgrade at the selected forge / air forge. */
export function startUpgradeResearch(kind: UpgradeKind): void {
  if (!isMatchActive()) return

  // Ground tracks research at the forge, air tracks at the air forge.
  const labKind: BuildableKind = kind === 'airDamage' || kind === 'airSpeed' ? 'airForge' : 'forge'
  const selected = getSelected()
  const forge = selected?.kind === labKind ? (selected as Building) : undefined
  const forgeName = getBuildingDisplayName(labKind, 'player')
  const info = UPGRADE_INFO[kind]

  if (!forge?.alive || !forge.isComplete || getTeam(forge) !== 'player') {
    setStatus(`Select a completed ${forgeName} to research upgrades.`)
    return
  }

  if (isUpgradeInProgress('player', kind)) {
    setStatus(`${info.name} research is already in progress.`)
    return
  }

  const cost = getNextUpgradeCost('player', kind)
  if (!cost) {
    setStatus(`${info.name} is already at maximum level.`)
    return
  }

  if (!spendResources('player', cost)) {
    setStatus(`Need ${formatCost(cost)} to research ${info.name} level ${getUpgradeLevel('player', kind) + 1}.`)
    return
  }

  startUpgradeResearchOrder('player', kind, forge.id)
  if (isRelayActive()) broadcastMyCommand({ type: 'research', buildingId: forge.id, upgrade: kind })
  setStatus(`Researching ${info.name} level ${getUpgradeLevel('player', kind) + 1} (${info.effect}).`)
}

export function selectAllLikeSelected(): void {
  const selected = getSelected()

  if (selected?.kind !== 'worker' && selected?.kind !== 'soldier') {
    setStatus(`Select a ${getWorkerDefinition('player').name} or fighter first.`)
    return
  }

  const units = selected.kind === 'worker' ? getAvailableWorkers() : getAvailableSoldiers()
  setUnitSelection(units)
  const unitLabel = selected.kind === 'worker' ? `${getWorkerDefinition('player').name}s` : 'fighters'
  setStatus(`Selected all ${unitLabel} (${units.length}). Click a valid target to command them.`)
}

export function selectIdleWorker(): void {
  const idleWorker = getIdleWorkers()[0]

  if (!idleWorker) {
    setStatus('No idle workers available.')
    return
  }

  selectObject(idleWorker)
}

export function placeMineralResource(): void {
  placeResourceAtPlayer('minerals')
}

export function placeGasResource(): void {
  placeResourceAtPlayer('gas')
}

export function moveSelectedBuilding(deltaX: number, deltaY: number, deltaZ: number): void {
  const building = getSelectedAdjustableBuilding()

  if (!building) {
    setStatus('Select Temple, Homestead, or Barracks first, then use the building tools.')
    return
  }

  const transform = Transform.getMutable(building.entity)
  transform.position = Vector3.create(transform.position.x + deltaX, Math.max(0, transform.position.y + deltaY), transform.position.z + deltaZ)
  printBuildingTransform(building)
  setStatus(`${building.name} moved to ${formatPosition(transform.position)}.`)
}

export function scaleSelectedBuilding(multiplier: number): void {
  const building = getSelectedAdjustableBuilding()

  if (!building) {
    setStatus('Select Temple, Homestead, or Barracks first, then use the building tools.')
    return
  }

  const transform = Transform.getMutable(building.entity)
  transform.scale = Vector3.create(
    clamp(transform.scale.x * multiplier, 0.1, 20),
    clamp(transform.scale.y * multiplier, 0.1, 20),
    clamp(transform.scale.z * multiplier, 0.1, 20)
  )
  printBuildingTransform(building)
  setStatus(`${building.name} scaled to ${formatVectorForPaste(transform.scale)}.`)
}

export function printSelectedBuildingTransform(): void {
  const building = getSelectedAdjustableBuilding()

  if (!building) {
    setStatus('Select Temple, Homestead, or Barracks first, then print its transform.')
    return
  }

  printBuildingTransform(building)
  setStatus(`${building.name} transform printed.`)
}

export function canCancelSelectedConstruction(): boolean {
  const selected = getSelected()
  return isCancellableConstruction(selected)
}

export function cancelSelectedConstruction(): void {
  const selected = getSelected()

  if (!isCancellableConstruction(selected)) {
    setStatus('Select a building under construction to cancel it.')
    return
  }

  cancelConstruction(selected)
}

function placeResourceAtPlayer(resource: ResourceKind): void {
  const playerPosition = getPlayerPosition()
  const definition = RESOURCE_DEFINITIONS[resource]

  if (!playerPosition) {
    setStatus('Player position is not ready yet.')
    return
  }

  const position = getResourcePlacementPosition(resource, playerPosition)
  const resourceNumber = getPlacedResourceCount(resource) + 1
  const name = `${definition.name} ${resourceNumber}`
  const node = createResourceNode(resource, name, position)

  resources.push(node)
  saveResourcePlacement(resource, position)
  selectObject(node)
  setStatus(`Placed ${name} at ${formatPosition(position)}.`)
}

function getResourcePlacementPosition(resource: ResourceKind, position: Vector3): Vector3 {
  return Vector3.create(position.x, RESOURCE_DEFINITIONS[resource].placementY, position.z)
}

function resetMatchState(status: typeof MATCH_NOT_STARTED | typeof MATCH_ACTIVE = MATCH_NOT_STARTED): void {
  gameState.matchTime = 0
  gameState.matchStatus = status
  gameState.matchResult = 'none'
  resetTeamStats()
}

function formatRuntimeMatchTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function getPlacedResourceCount(resource: ResourceKind): number {
  return resources.filter((node) => node.resource === resource).length
}

function saveResourcePlacement(resource: ResourceKind, position: Vector3): void {
  const location = formatVectorForPaste(position)

  getSavedResourceLocations(resource).push(location)
  printResourcePlacementLists()
}

/**
 * Tears down every match entity and per-match state: units, buildings,
 * resources, VFX, selections, fog. Leaves the static scenery in place and
 * does NOT rebuild anything - callers decide whether a new base spawns.
 */
function clearMatchWorld(): void {
  gameState.selectedId = ''
  gameState.selectedKind = ''
  gameState.selectedUnitIds = []
  gameState.attackAlert = ''
  gameState.attackAlertTimer = 0
  gameState.placementMode = 'none'
  gameState.placementBuildingKind = ''
  gameState.savedMineralLocations = []
  gameState.savedGasLocations = []
  templeRallyPoints.clear()
  barracksRallyPoints.clear()
  controlGroups.clear()
  eliminatedTeams.clear()
  turretFireTimers.clear()
  broodTimers.clear()
  incomeSampleTimer = 0
  cancelRallyPlacement()
  cancelAttackMove()
  cancelPatrol()
  orderClickConsumedUntilRelease = false
  cancelPlacement()

  for (const worker of workers) destroySelectable(worker)
  for (const soldier of soldiers) destroySelectable(soldier)
  for (const resource of resources) destroySelectable(resource)
  for (const building of buildings) {
    clearBuildingDamageVfx(building)
    destroySelectable(building)
  }
  clearAllConstructionVfx()

  resetWorld()
  resetUpgrades()
  clearSelectionMarkers()
  clearHealthBars()
  resetFogOfWar()
}

export function resetRtsGame(): void {
  applyOpponentSetup()
  resetEconomy()
  resetMatchState(MATCH_ACTIVE)
  gameState.status = 'Reset complete. Select a worker to start gathering.'
  clearMatchWorld()

  createStartingBase()
  enableTopDownView()
  // Multiplayer: open the camera over your own corner, wherever your seat is.
  if (multiplayerPlan) {
    const anchor = getTeamAnchor('player')
    setCameraFocus(anchor.temple.x, anchor.temple.z)
  }
  setAckVoice(gameState.playerRace)
  startAmbientMusic()
}

/**
 * Locks in the title-screen opponent choices: resolves alliances for the game
 * mode, seats each computer (allies near the player, hostiles far), rolls
 * 'random' races, and spins up one AI brain per computer.
 */
function applyOpponentSetup(): void {
  if (multiplayerPlan) {
    applyMultiplayerSetup(multiplayerPlan)
    return
  }

  const opponents = gameState.opponents.slice(0, ENEMY_TEAMS.length)
  gameState.activeEnemyTeams = ENEMY_TEAMS.slice(0, Math.max(1, opponents.length))

  // Anchors are ordered far-to-near from the player (anchor 0 is the player's
  // own SW corner): hostiles take the far ones first, allies claim the near
  // ones so they actually cover the player's flank.
  const openAnchors = [1, 2, 3, 4, 5]

  for (let i = 0; i < gameState.activeEnemyTeams.length; i++) {
    const team = gameState.activeEnemyTeams[i]
    const setup = opponents[i] ?? { race: 'random' as const, difficulty: 'medium' as const, team: 2 }
    const isAlly = gameState.gameMode === 'team' && setup.team === 1

    gameState.enemyRaces[team] = setup.race === 'random' ? pickRandomRace() : setup.race
    gameState.enemyDifficulties[team] = setup.difficulty
    // FFA: everyone for themselves. Team mode: setup team N maps straight to
    // alliance id N-1, so team 1 joins the player (id 0) and teams 2-4 are
    // mutually hostile enemy sides.
    gameState.alliances[team] = gameState.gameMode === 'ffa' ? i + 1 : setup.team - 1
    gameState.enemySeatIndex[team] = isAlly ? openAnchors.pop()! : openAnchors.shift()!
  }

  // A match needs someone to fight: if every computer was marked ally, the
  // last one flips hostile (the UI prevents this, this is the safety net).
  if (!gameState.activeEnemyTeams.some((team) => isHostileToPlayer(team))) {
    const lastTeam = gameState.activeEnemyTeams[gameState.activeEnemyTeams.length - 1]
    gameState.alliances[lastTeam] = 1
    gameState.enemySeatIndex[lastTeam] = 1
  }

  enemyAis = gameState.activeEnemyTeams.map((team) => createEnemyAi(team, gameState.enemyDifficulties[team]))
}

/**
 * Multiplayer variant of applyOpponentSetup: races, difficulties and alliance
 * ids come pre-resolved from the shared lobby snapshot (identical on every
 * client thanks to the seeded race rolls). Only computer-held seats get an AI
 * brain; human-held teams are driven by remote commands.
 */
function applyMultiplayerSetup(plan: LocalMatchPlan): void {
  gameState.playerRace = plan.races.player
  gameState.gameMode = plan.gameMode
  gameState.selectedMapId = plan.mapId
  gameState.activeEnemyTeams = plan.activeEnemyTeams.slice()
  gameState.alliances.player = plan.alliances.player

  for (const team of plan.activeEnemyTeams) {
    gameState.enemyRaces[team] = plan.races[team]
    gameState.enemyDifficulties[team] = plan.difficulties[team]
    gameState.alliances[team] = plan.alliances[team]
  }

  // Multiplayer bases anchor to LOBBY seats so the shared world is identical
  // on every client: seat 2's base is at anchor 2 for everyone.
  for (const team of plan.activeEnemyTeams) {
    gameState.enemySeatIndex[team] = plan.teamToSeat[team] ?? 1
  }

  enemyAis = plan.activeEnemyTeams
    .filter((team) => !plan.humanTeams.includes(team))
    .map((team) => createEnemyAi(team, gameState.enemyDifficulties[team]))
}

export function getWorkerCount(): number {
  return workers.filter((worker) => worker.alive && getTeam(worker) === 'player').length
}

export function getIdleWorkerCount(): number {
  return getIdleWorkers().length
}

export function getSoldierCount(): number {
  return soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === 'player').length
}

export function hasCompletedBuilding(team: Team, kind: BuildableKind): boolean {
  return buildings.some((building) => building.alive && building.isComplete && building.kind === kind && getTeam(building) === team)
}

/** Whether the player's tech tier allows placing this building (see BuildingDefinition.requires). */
export function isBuildingUnlocked(kind: BuildableKind): boolean {
  const requires = BUILDING_DEFINITIONS[kind].requires
  return !requires || hasCompletedBuilding('player', requires)
}

/** Whether the player's tech tier allows training this unit variant (see UNIT_REQUIREMENTS). */
export function isUnitUnlocked(variant: SoldierVariant): boolean {
  const requires = UNIT_REQUIREMENTS[variant]
  return !requires || hasCompletedBuilding('player', requires)
}

/** Selects a single unit out of a multi-selection (clicking a wireframe in the info panel). */
export function selectUnitById(id: string): void {
  const selectable = selectables.get(id)
  if (selectable?.alive && (selectable.kind === 'worker' || selectable.kind === 'soldier')) {
    selectObject(selectable)
  }
}

export type SelectedUnitInfo = {
  id: string
  kind: 'worker' | 'soldier'
  variant?: SoldierVariant
  name: string
  hp: number
  maxHp: number
}

/** Per-unit data for the StarCraft-style multi-selection wireframe grid. */
export function getSelectedUnitsInfo(): SelectedUnitInfo[] {
  return getSelectedUnits().map((unit) => ({
    id: unit.id,
    kind: unit.kind as 'worker' | 'soldier',
    variant: unit.kind === 'soldier' ? (unit as Soldier).variant : undefined,
    name: unit.name,
    hp: unit.hp,
    maxHp: unit.maxHp
  }))
}

export type ProductionQueueInfo = {
  count: number
  progress: number
  variant?: SoldierVariant
  /** Every queued order in sequence ('worker' or the fighter variant), for the icon strip. */
  entries: (SoldierVariant | 'worker')[]
}

/** Production queue of the selected building, for the info panel (count + progress of the active order). */
export function getSelectedProductionQueue(): ProductionQueueInfo | undefined {
  const selected = getSelected()
  if (!selected) return undefined

  if (selected.kind === 'temple') {
    const orders = workerProductionOrders.filter((order) => order.templeId === selected.id)
    if (orders.length === 0) return undefined
    return { count: orders.length, progress: clamp(orders[0].timer / orders[0].productionTime, 0, 1), entries: orders.map(() => 'worker' as const) }
  }

  if (selected.kind === 'barracks' || selected.kind === 'techLab') {
    const orders = soldierProductionOrders.filter((order) => order.barracksId === selected.id)
    if (orders.length === 0) return undefined
    return {
      count: orders.length,
      progress: clamp(orders[0].timer / orders[0].productionTime, 0, 1),
      variant: orders[0].variant,
      entries: orders.map((order) => order.variant)
    }
  }

  return undefined
}

function getGroupSelectionPrefix(): string {
  const workerCount = getSelectedWorkers().length
  const soldierCount = getSelectedSoldiers().length
  if (workerCount + soldierCount <= 1) return ''

  const parts: string[] = []
  if (workerCount > 0) parts.push(`${workerCount} ${getWorkerDefinition('player').name}${workerCount === 1 ? '' : 's'}`)
  if (soldierCount > 0) parts.push(`${soldierCount} fighter${soldierCount === 1 ? '' : 's'}`)
  return `Selected ${parts.join(' + ')}. `
}

export function getSelectedSummary(): SelectedSummary {
  const selected = getSelected()

  if (!selected) {
    return {
      name: 'None',
      kind: 'none',
      detail: getPlacementInstruction() || 'Select the Temple, a miner, a resource, or a building.'
    }
  }

  const selectedUnitCount = getSelectedUnits().length

  if (selected.kind === 'worker') {
    const worker = selected as Worker
    const killLine = selectedUnitCount <= 1 && (worker.kills ?? 0) > 0 ? ` · Kills: ${worker.kills}` : ''
    return {
      name: selectedUnitCount > 1 ? `${selectedUnitCount} Units` : worker.name,
      kind: worker.kind,
      team: getTeam(worker),
      hp: worker.hp,
      maxHp: worker.maxHp,
      detail: `${getGroupSelectionPrefix()}State: ${worker.state}${worker.carrying > 0 ? `, carrying ${worker.carrying} ${worker.carryingResource}` : ''}${killLine}`
    }
  }

  if (selected.kind === 'soldier') {
    const soldier = selected as Soldier
    // A lone hero or caster shows its signature perk so it's discoverable in-game.
    const heroLine = selectedUnitCount <= 1 && soldier.variant === 'hero' ? `${getRace(getTeam(soldier)).heroTrait} ` : ''
    const casterLine = selectedUnitCount <= 1 && soldier.variant === 'caster' ? `${CASTER_ABILITY[getRace(getTeam(soldier)).id].describe} ` : ''
    const healerLine = selectedUnitCount <= 1 && soldier.variant === 'healer' ? `${getHealerTraitLine(soldier)} ` : ''
    const siegeLine = selectedUnitCount <= 1 && soldier.variant === 'siege' ? `${getSiegeModeLine(soldier)} ` : ''
    // Close-quarters units can't reach flyers - surface that in the panel (healers never attack at all).
    const airLine =
      selectedUnitCount <= 1 && soldier.variant !== 'healer' && !canAttackTarget(soldier, { kind: 'soldier', variant: 'flyer' } as Soldier) ? 'Cannot attack air. ' : ''
    const killLine = selectedUnitCount <= 1 ? ` · Kills: ${soldier.kills ?? 0}` : ''
    return {
      name: selectedUnitCount > 1 ? `${selectedUnitCount} Units` : soldier.name,
      kind: soldier.kind,
      team: getTeam(soldier),
      hp: soldier.hp,
      maxHp: soldier.maxHp,
      variant: soldier.variant,
      detail: `${getGroupSelectionPrefix()}${heroLine}${casterLine}${healerLine}${siegeLine}${airLine}State: ${soldier.state}${killLine}`
    }
  }

  if (selected.kind === 'resource') {
    const resource = selected as ResourceNode
    const richLine = resource.rich ? 'RICH: workers haul 1.5x per trip. ' : ''
    return {
      name: resource.name,
      kind: resource.kind,
      resourceKind: resource.resource,
      detail: `${richLine}${resource.amount} ${resource.resource} remaining`
    }
  }

  const building = selected as Building
  return {
    name: building.name,
    kind: building.kind,
    team: getTeam(building),
    hp: building.hp,
    maxHp: building.maxHp,
    detail: getBuildingDetail(building)
  }
}

function createStaticScene(): void {
  buildTerrain()
  buildEnvironmentEnclosure()
  hideAvatarsEverywhere()
  rallyMarker = createRallyMarker()
}

/**
 * This is an RTS: the camera is a detached top-down rig and every player is a
 * commander, not a body on the field. One modifier area covering the whole map
 * hides all Decentraland avatars (yours included) so nobody's avatar stands
 * around photobombing a base.
 */
function hideAvatarsEverywhere(): void {
  const hider = engine.addEntity()
  Transform.create(hider, {
    position: Vector3.create(SCENE.center, 0, SCENE.center)
  })
  // Deliberately absurd size: players reported avatars peeking through with a
  // scene-sized box (spawn points and explorer quirks can park bodies at the
  // fringes), so the volume dwarfs the scene in every direction, floor included.
  AvatarModifierArea.create(hider, {
    area: Vector3.create(SCENE.size * 10, 1000, SCENE.size * 10),
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS],
    excludeIds: []
  })
}

/**
 * Where a team's main base sits. Single-player keeps the classic layout
 * (player SW, computers on their picked seats). Multiplayer anchors every
 * team to its LOBBY seat index so the shared world is identical for all
 * players - your base is wherever your seat is, not always the SW corner.
 */
function getTeamAnchor(team: Team): { temple: Vector3; rotationY: number } {
  if (team === 'player') {
    return MAP_ANCHORS[multiplayerPlan ? multiplayerPlan.mySeatIndex : 0]
  }
  return MAP_ANCHORS[gameState.enemySeatIndex[team]]
}

function createStartingBase(): void {
  const playerAnchor = getTeamAnchor('player')
  // The hand-placed SW start is kept verbatim for the classic layout.
  const playerAtClassicStart = playerAnchor === MAP_ANCHORS[0]

  buildings.push(createBuilding('temple', getBuildingDisplayName('temple', 'player'), playerAnchor.temple, CONFIG.templeHp, 'complete', playerAnchor.rotationY, 'player'))
  // Pre-built temples skip completeConstruction, so grant their supply here.
  addSupplyCap('player', BUILDING_DEFINITIONS.temple.supplyAdds)

  spawnResourceFields()

  if (playerAtClassicStart) {
    for (const position of POSITIONS.workers) {
      const worker = createWorker(position, 'player')
      workers.push(worker)
      gameState.economies.player.supplyUsed += 1
      gameState.matchStats.player.unitsProduced += 1
      // Auto-split: starting workers head straight for the crystal line.
      const startingDeposit = getNearestResourceOfKind(position, 'minerals')
      if (startingDeposit) assignWorkerToResource(worker, startingDeposit, false)
    }
    // Every faction opens with its unique hero standing guard by the main base.
    spawnStartingHero('player', Vector3.create(playerAnchor.temple.x + 3.5, 0.25, playerAnchor.temple.z + 8.5))
  } else {
    // Seated elsewhere (multiplayer): spawn like the computer bases do.
    const towardCenter = playerAnchor.temple.x < SCENE.center ? 5 : -5
    for (let i = 0; i < POSITIONS.workers.length; i++) {
      const offset = getFormationPosition(Vector3.create(playerAnchor.temple.x, 0.25, playerAnchor.temple.z + towardCenter), i, 1)
      const worker = createWorker(offset, 'player')
      workers.push(worker)
      gameState.economies.player.supplyUsed += 1
      gameState.matchStats.player.unitsProduced += 1
      const startingDeposit = getNearestResourceOfKind(offset, 'minerals')
      if (startingDeposit) assignWorkerToResource(worker, startingDeposit, false)
    }
    const towardCenterZ = playerAnchor.temple.z < SCENE.center ? 8 : -8
    spawnStartingHero('player', Vector3.create(playerAnchor.temple.x + towardCenter, 0.25, playerAnchor.temple.z + towardCenterZ))
  }

  for (const team of gameState.activeEnemyTeams) {
    const seat = getTeamAnchor(team)
    buildings.push(createBuilding('temple', `${teamNamePrefix(team)}${getBuildingDisplayName('temple', team)}`, seat.temple, CONFIG.templeHp, 'complete', seat.rotationY, team))
    addSupplyCap(team, BUILDING_DEFINITIONS.temple.supplyAdds)

    // Workers spawn toward the map center so they don't clip the border highlands.
    const towardCenter = seat.temple.x < SCENE.center ? 5 : -5
    for (let i = 0; i < POSITIONS.workers.length; i++) {
      const offset = getFormationPosition(Vector3.create(seat.temple.x, 0.25, seat.temple.z + towardCenter), i, 1)
      const worker = createWorker(offset, team)
      workers.push(worker)
      gameState.economies[team].supplyUsed += 1
      gameState.matchStats[team].unitsProduced += 1
      // Computers auto-split too, so every faction's economy starts hot.
      const startingDeposit = getNearestResourceOfKind(offset, 'minerals')
      if (startingDeposit) assignWorkerToResource(worker, startingDeposit, false)
    }

    const towardCenterZ = seat.temple.z < SCENE.center ? 8 : -8
    spawnStartingHero(team, Vector3.create(seat.temple.x + towardCenter, 0.25, seat.temple.z + towardCenterZ))
  }
}

/** Heroes are free and take no supply, but they never come back once slain. */
function spawnStartingHero(team: Team, position: Vector3): void {
  const hero = createSoldier(position, team, 'hero')
  soldiers.push(hero)
  gameState.matchStats[team].unitsProduced += 1
}

/** "Ally " / "Enemy " label prefix so computer units read as friend or foe. */
function teamNamePrefix(team: Team): string {
  if (team === 'player') return ''
  return isPlayerAlly(team) ? 'Ally ' : 'Enemy '
}

/**
 * Per-match resource layout variant: the six main-base entries stay put so every
 * faction's start is fair, but expansions and the contested center drift a few
 * meters and vary in richness, so scouting routes differ between matches.
 */
function getResourceFieldsForMatch(): ResourceField[] {
  // Multiplayer rolls the layout off the shared lobby seed so every client
  // generates the exact same resource map; single-player stays truly random.
  const random = multiplayerPlan ? mulberry32(multiplayerPlan.seed ^ 0x5eed) : Math.random

  return getMapById(gameState.selectedMapId).fields.map((field, index) => {
    // The six mains (3 entries each: crystal line + two vents) never move -
    // every start must be identical. Naturals and contested fields shuffle.
    if (index < 18) return field

    const jitter = () => (random() - 0.5) * 10
    const countShift = field.count > 1 ? (random() < 0.3 ? -1 : random() > 0.7 ? 1 : 0) : 0
    return {
      ...field,
      center: Vector3.create(clamp(field.center.x + jitter(), 10, SCENE.size - 10), field.center.y, clamp(field.center.z + jitter(), 10, SCENE.size - 10)),
      count: Math.max(1, field.count + countShift)
    }
  })
}

function spawnResourceFields(): void {
  const counters: Record<ResourceKind, number> = { minerals: 0, gas: 0 }

  getResourceFieldsForMatch().forEach((field, fieldIndex) => {
    const definition = RESOURCE_DEFINITIONS[field.kind]
    for (const position of generateFieldPositions(field, fieldIndex)) {
      counters[field.kind] += 1
      const baseName = field.rich ? (field.kind === 'minerals' ? 'Gold Vein' : 'Cryo Vent') : definition.name
      resources.push(createResourceNode(field.kind, `${baseName} ${counters[field.kind]}`, position, field.rich === true))
    }
  })
}

/** Deterministic ring of node positions around a field center: evenly spaced angle slots with jitter. */
function generateFieldPositions(field: ResourceField, fieldIndex: number): Vector3[] {
  let seed = 4241 + fieldIndex * 131
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }

  const positions: Vector3[] = []
  for (let i = 0; i < field.count; i++) {
    const angle = ((i + random() * 0.5) / field.count) * Math.PI * 2
    const radius = field.radius * (0.45 + random() * 0.55)
    positions.push(
      Vector3.create(
        Math.min(SCENE.size - 4, Math.max(4, field.center.x + Math.cos(angle) * radius)),
        0,
        Math.min(SCENE.size - 4, Math.max(4, field.center.z + Math.sin(angle) * radius))
      )
    )
  }
  return positions
}

function createWorker(position: Vector3, team: Team = 'player'): Worker {
  const definition = getWorkerDefinition(team)
  const worker = createProceduralUnitSelectable(
    'worker',
    `${teamNamePrefix(team)}${definition.name} ${getTeamWorkerCount(team) + 1}`,
    position,
    team,
    // Generous click box: units are small targets from the overhead camera.
    Vector3.create(1.1, 1.8, 1.1)
  ) as Worker

  worker.hp = definition.hp
  worker.maxHp = definition.hp
  worker.state = 'idle'
  worker.timer = 0
  worker.carrying = 0
  worker.activeAnimation = 'idle'
  return worker
}

function createSoldier(position: Vector3, team: Team = 'player', variant: SoldierVariant = 'melee'): Soldier {
  const definition = getSoldierDefinition(team, variant)
  // Heroes are one-of-a-kind, so they carry their name without a roster number.
  const displayName = variant === 'hero' ? `${teamNamePrefix(team)}${definition.name}` : `${teamNamePrefix(team)}${definition.name} ${getTeamSoldierCount(team) + 1}`
  const soldier = createProceduralUnitSelectable(
    'soldier',
    displayName,
    position,
    team,
    getSoldierColliderScale(variant),
    variant
  ) as Soldier

  soldier.variant = variant
  soldier.hp = definition.hp
  soldier.maxHp = definition.hp
  soldier.damage = definition.damage ?? CONFIG.soldierDamage
  soldier.moveSpeed = definition.moveSpeed ?? CONFIG.soldierMoveSpeed
  soldier.attackRange = definition.attackRange ?? CONFIG.soldierAttackRange
  soldier.attackRate = definition.attackRate ?? CONFIG.soldierAttackRate
  soldier.splashRadius = definition.splashRadius ?? 0
  soldier.healRate = definition.healRate
  // Artillery rolls off the line in mobile mode: weak pop-gun until it digs in.
  if (variant === 'siege') {
    soldier.sieged = false
    applySiegeModeStats(soldier, false)
  }
  soldier.state = 'idle'
  soldier.stance = 'defensive'
  soldier.attackTimer = 0
  soldier.activeAnimation = 'idle'
  // Fresh recruits wear whatever rank their team has already researched
  // (flyers wear the air tracks, everyone else the ground tracks).
  const tracks = getUpgradeKindsFor(variant)
  setUnitUpgradeInsignia(soldier.entity, getUpgradeLevel(team, tracks.damage), getUpgradeLevel(team, tracks.speed))
  return soldier
}

/** Generous click boxes sized to each silhouette: flyers hover high, titans are huge. */
function getSoldierColliderScale(variant: SoldierVariant): Vector3 {
  if (variant === 'hero') return Vector3.create(3, 4.2, 3)
  if (variant === 'titan') return Vector3.create(2.4, 3.2, 2.4)
  if (variant === 'flyer') return Vector3.create(1.8, 3.2, 1.8)
  if (variant === 'siege') return Vector3.create(2, 2.4, 2)
  return Vector3.create(1.4, 2, 1.4)
}

/** Info-panel blurb for siege artillery, reflecting its current mode. */
function getSiegeModeLine(soldier: Soldier): string {
  if ((soldier.siegeTransition ?? 0) > 0) return soldier.siegeTargetMode ? 'Transforming: digging in...' : 'Transforming: packing up...'
  if (soldier.sieged) return 'DUG IN: main cannon online, outranges defense towers. Immobile.'
  return 'Mobile: weak pop-gun. Dig in to unleash the main cannon.'
}

/** Info-panel blurb for the race's support unit (each heals differently). */
function getHealerTraitLine(soldier: Soldier): string {
  const race = getRace(getTeam(soldier)).id
  if (race === 'bio') return `Regeneration aura: heals all nearby allies ${soldier.healRate ?? 3} HP/s.`
  if (race === 'alien') return `Heal beam: mends wounded fighters and structures ${soldier.healRate ?? 7} HP/s.`
  return `Heal beam: mends a wounded fighter ${soldier.healRate ?? 9} HP/s.`
}

/** Units are procedurally built per race (no GLBs), so this replaces createSelectableModel for them. */
function createProceduralUnitSelectable(kind: 'worker' | 'soldier', name: string, position: Vector3, team: Team, colliderScale: Vector3, variant?: SoldierVariant): Selectable {
  const id = mintEntityId(kind, team)
  const entity = engine.addEntity()
  Transform.create(entity, { position: cloneVector(position) })
  buildUnitModel(entity, getRace(team).id, kind === 'worker' ? 'worker' : variant ?? 'melee', team)

  const selectable: Selectable = { id, kind, name, entity, alive: true, team }
  selectable.colliderEntity = createModelColliderEntity(entity, {
    position,
    scale: Vector3.create(1, 1, 1),
    src: '',
    colliderScale
  })
  selectables.set(id, selectable)
  registerSelectable(selectable)
  return selectable
}

function createResourceNode(resource: ResourceKind, name: string, position: Vector3, rich = false): ResourceNode {
  const definition = RESOURCE_DEFINITIONS[resource]
  const id = mintEntityId('resource', undefined)
  const entity = engine.addEntity()
  Transform.create(entity, { position: cloneVector(position) })
  buildResourceModel(entity, resource, rich)

  if (definition.audioClipUrl) {
    AudioSource.create(entity, {
      audioClipUrl: definition.audioClipUrl,
      playing: false,
      loop: false,
      volume: 0.55
    })
  }

  // Rich nodes hold more total and workers haul more per trip.
  const amount = Math.round(definition.amount * (rich ? CONFIG.richYieldMultiplier : 1))
  const patch: ResourceNode = {
    id,
    kind: 'resource',
    name,
    entity,
    alive: true,
    resource,
    amount,
    rich
  }
  patch.colliderEntity = createModelColliderEntity(entity, {
    position,
    scale: Vector3.create(1, 1, 1),
    src: '',
    colliderScale: definition.colliderScale
  })
  selectables.set(id, patch)
  registerSelectable(patch)
  updateLabel(patch, `${name}\n${amount}`)
  return patch
}

function createConstructionSite(kind: BuildableKind, position: Vector3, builderWorkerId: string, rotationY = 0, team: Team = 'player'): Building {
  const definition = BUILDING_DEFINITIONS[kind]
  const site = createBuilding(kind, `${teamNamePrefix(team)}${getBuildingDisplayName(kind, team)} (Building)`, position, definition.hp, 'movingBuilder', rotationY, team)

  site.builderWorkerId = builderWorkerId
  site.buildTime = definition.buildTime
  site.constructionProgress = 0
  site.isComplete = false
  updateConstructionVisual(site)
  buildings.push(site)
  return site
}

function createBuilding(kind: Building['kind'], name: string, position: Vector3, hp: number, constructionState: ConstructionState, rotationY = 0, team: Team = 'player'): Building {
  const definition = isBuildableKind(kind) ? BUILDING_DEFINITIONS[kind] : undefined
  const scale = getBuildingScale(kind, definition)
  const color = getBuildingColor(kind, definition)
  const building =
    kind === 'enemyBuilding'
      ? (createSelectableModel(kind, name, {
          position,
          scale: Vector3.create(1, 1, 1),
          src: ASSETS.enemyFighter,
          colliderScale: Vector3.create(1.5, 2, 1.5),
          animations: [
            { clip: 'idle', playing: true, loop: true },
            { clip: 'walk', playing: false, loop: true },
            { clip: 'attack', playing: false, loop: false },
            { clip: 'impact', playing: false, loop: false },
            { clip: 'die', playing: false, loop: false }
          ]
        }, true, team) as Building)
      : definition
      ? (createProceduralBuildingSelectable(kind as BuildableKind, name, position, team, definition, rotationY) as Building)
      : (createSelectableBox(kind, name, {
          position,
          scale,
          color,
          emissive: Color4.create(color.r * 0.25, color.g * 0.25, color.b * 0.25, 1)
        }, team) as Building)

  building.hp = hp
  building.maxHp = hp
  building.constructionState = constructionState
  building.constructionProgress = constructionState === 'complete' ? 1 : 0
  building.buildTime = definition?.buildTime ?? 0
  building.isComplete = constructionState === 'complete'
  building.team = team
  if (building.isComplete) ensureBuildingBeacon(building)
  return building
}

// Race identity marker: a floating glowing orb in the owner's race color above the roof.
const BEACON_HEIGHTS: Record<BuildableKind, number> = {
  temple: 13.5,
  supplyHouse: 5.5,
  barracks: 7.5,
  techLab: 8.5,
  forge: 6.5,
  airForge: 7.5,
  fireplace: 3.5,
  turret: 5.5
}

// Ownership marker, not race identity: the architecture already says which
// race built it, the beacon says whose side it fights for.
function ensureBuildingBeacon(building: Building): void {
  if (building.beaconEntity || !isBuildableKind(building.kind)) return

  const teamColor = getTeamColor(getTeam(building))
  const position = Transform.get(building.entity).position
  const beacon = engine.addEntity()
  Transform.create(beacon, {
    position: Vector3.create(position.x, position.y + BEACON_HEIGHTS[building.kind], position.z),
    scale: Vector3.create(0.55, 0.55, 0.55)
  })
  MeshRenderer.setSphere(beacon)
  Material.setPbrMaterial(beacon, {
    albedoColor: teamColor,
    emissiveColor: teamColor,
    emissiveIntensity: 2.4,
    metallic: 0.2,
    roughness: 0.4,
    castShadows: false
  })
  building.beaconEntity = beacon
}

function removeBuildingBeacon(selectable: Selectable): void {
  const building = selectable as Building
  if (!building.beaconEntity) return

  engine.removeEntity(building.beaconEntity)
  building.beaconEntity = undefined
}

function getBuildingScale(kind: Building['kind'], definition?: BuildingDefinition): Vector3 {
  if (definition) return definition.scale
  if (kind === 'enemyBuilding') return Vector3.create(1.6, 1.6, 1.6)

  return Vector3.create(1.8, 1.2, 1.8)
}

function getBuildingColor(kind: Building['kind'], definition?: BuildingDefinition): Color4 {
  if (definition) return definition.color
  if (kind === 'enemyBuilding') return COLORS.enemy

  return COLORS.temple
}

/**
 * Race-styled procedural building: parts hang off a root at ground level with
 * scale (1,1,1), plus an invisible footprint-sized box for clicks. Construction
 * growth and death handling scale/hide the root, which carries the parts.
 */
function createProceduralBuildingSelectable(kind: BuildableKind, name: string, position: Vector3, team: Team, definition: BuildingDefinition, rotationY: number): Selectable {
  const id = mintEntityId(kind, team)
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(position.x, 0, position.z),
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0)
  })
  buildBuildingModel(entity, getRace(team).id, kind)

  const height = BUILDING_MODEL_HEIGHTS[kind]
  const collider = engine.addEntity()
  Transform.create(collider, {
    parent: entity,
    position: Vector3.create(0, height / 2, 0),
    scale: Vector3.create(definition.scale.x, height, definition.scale.z)
  })

  const selectable: Selectable = { id, kind, name, entity, alive: true, team, colliderEntity: collider }
  selectables.set(id, selectable)
  registerSelectable(selectable)
  return selectable
}

function createSelectableBox(kind: SelectableKind, name: string, box: BoxConfig, team: Team = 'player'): Selectable {
  const id = mintEntityId(kind, team)
  const entity = createBoxEntity(box)
  const selectable: Selectable = { id, kind, name, entity, alive: true, team }

  selectables.set(id, selectable)
  registerSelectable(selectable)
  return selectable
}

function createSelectableModel(kind: SelectableKind, name: string, model: ModelConfig, registerOnCreate = true, team: Team = 'player'): Selectable {
  const id = mintEntityId(kind, team)
  const entity = createModelEntity(model)
  const selectable: Selectable = { id, kind, name, entity, alive: true, team }

  if (kind === 'worker' || kind === 'soldier') {
    selectable.colliderEntity = createModelColliderEntity(entity, model)
  }
  selectables.set(id, selectable)
  if (registerOnCreate) {
    registerSelectable(selectable)
  }
  return selectable
}

function createGhostBuilding(definition: BuildingDefinition, position: Vector3): BuildingPreview {
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(position.x, 0, position.z),
    scale: Vector3.create(1, 1, 1)
  })

  const footprint = createVisualBoxEntity({
    position: Vector3.create(0, BUILDING_FOOTPRINT_Y, 0),
    scale: Vector3.create(definition.scale.x, BUILDING_FOOTPRINT_HEIGHT, definition.scale.z),
    color: BUILDING_FOOTPRINT_VALID,
    emissive: Color4.create(0.04, 0.22, 0.08, 1),
    transparent: true
  })
  Transform.getMutable(footprint).parent = root

  // Preview model: the player's race-styled building, parts parented to this entity.
  const model = engine.addEntity()
  Transform.create(model, {
    parent: root,
    position: Vector3.create(0, 0, 0),
    rotation: Quaternion.fromEulerDegrees(0, 0, 0),
    scale: Vector3.create(1, 1, 1)
  })
  buildBuildingModel(model, getRace('player').id, definition.kind)

  return {
    ghostEntity: root,
    ghostFootprintEntity: footprint,
    ghostModelEntity: model
  }
}

function registerSelectable(selectable: Selectable): void {
  const pointerTarget = selectable.colliderEntity ?? selectable.entity

  ensurePointerCollider(pointerTarget)
  registerPointerHandler(pointerTarget, selectable)
  // GLB units click via an invisible collider box, which the client can't outline on hover.
  // Registering the visible model too makes the character glow like other selectables.
  // Procedural roots have no mesh of their own, so registering them only triggers warnings.
  if (selectable.colliderEntity && (GltfContainer.has(selectable.entity) || MeshRenderer.has(selectable.entity))) {
    registerPointerHandler(selectable.entity, selectable)
  }
}

function registerPointerHandler(target: Entity, selectable: Selectable): void {
  pointerEventsSystem.onPointerDown(
    {
      entity: target,
      opts: {
        button: InputAction.IA_POINTER,
        hoverText: getHoverText(selectable),
        maxDistance: CONFIG.commandRange
      }
    },
    () => handleSelectableClick(selectable.id)
  )
}

function ensurePointerCollider(entity: Entity): void {
  if (!MeshCollider.has(entity)) {
    MeshCollider.setBox(entity)
  }
}

function handleSelectableClick(id: string): void {
  const clicked = selectables.get(id)

  if (!clicked || !clicked.alive) return
  // The click landed on a HUD panel; the raycast into the world behind it doesn't count.
  if (isPointerOverHud()) return

  if (placementState.state === 'placing') {
    confirmBuildingPlacement()
    return
  }

  // An armed repair order consumes this click: valid target = repair, anything else calls it off.
  if (repairPending) {
    cancelRepairOrder()
    orderClickConsumedUntilRelease = true
    const repairers = getSelectedWorkers().filter((worker) => worker.alive)
    if (repairers.length > 0 && isPlayerRepairableTarget(clicked)) {
      orderWorkersToRepair(repairers, clicked)
    } else {
      setStatus(getRace('player').id === 'human' ? 'Cannot repair that. Pick a damaged friendly building or mech fighter.' : 'Cannot repair that. Pick a damaged friendly building.')
    }
    return
  }

  // An armed attack order: clicking an enemy locks the whole army onto that
  // exact target; clicking anything else leaves the order armed for a ground click.
  if (attackMovePending) {
    if (isEnemyAttackTarget(clicked)) {
      cancelAttackMove()
      orderClickConsumedUntilRelease = true
      orderSelectedAttackOn(clicked)
    }
    return
  }

  // Pending spawn-point / patrol clicks are handled globally; don't also run selection commands.
  if (rallyPlacementKind !== 'none' || patrolPending) return

  const selectedWorkers = getSelectedWorkers()

  if (selectedWorkers.length > 0 && clicked.kind === 'resource') {
    assignWorkersToResource(selectedWorkers, clicked as ResourceNode)
    if (isRelayActive()) broadcastMyCommand({ type: 'gather', workerIds: selectedWorkers.map((worker) => worker.id), nodeId: clicked.id })
    return
  }

  if (selectedWorkers.length > 0 && isPlayerRepairTarget(clicked)) {
    assignWorkerToRepair(selectedWorkers[0], clicked)
    if (isRelayActive()) broadcastMyCommand({ type: 'repair', workerIds: [selectedWorkers[0].id], buildingId: clicked.id })
    return
  }

  if (isEnemyAttackTarget(clicked)) {
    if (orderSelectedAttackOn(clicked)) return
  }

  // Shift-click on your own unit toggles it in/out of the current selection.
  if (isShiftDown() && getTeam(clicked) === 'player' && (clicked.kind === 'worker' || clicked.kind === 'soldier')) {
    toggleUnitInSelection(clicked as Worker | Soldier)
    return
  }

  // Double-clicking one of your own units grabs every unit of that type,
  // classic RTS style: all workers, or all fighters of the same variant.
  const now = Date.now()
  const isDoubleClick = clicked.id === lastClickedSelectableId && now - lastClickedSelectableTime <= DOUBLE_CLICK_MS
  lastClickedSelectableId = clicked.id
  lastClickedSelectableTime = now

  if (isDoubleClick && getTeam(clicked) === 'player' && (clicked.kind === 'worker' || clicked.kind === 'soldier')) {
    selectAllOfSameType(clicked as Worker | Soldier)
    return
  }

  selectObject(clicked)
}

const DOUBLE_CLICK_MS = 400
let lastClickedSelectableId = ''
let lastClickedSelectableTime = 0

/**
 * Order the current selection (fighters plus any pulled workers) onto one enemy
 * target. Returns false when nothing commandable is selected.
 */
function orderSelectedAttackOn(target: Building | Soldier | Worker): boolean {
  const attackSoldiers = getSelectedSoldiers()
  const attackWorkers = getSelectedWorkers().filter((worker) => worker.alive)
  if (attackSoldiers.length === 0 && attackWorkers.length === 0) return false

  if (attackSoldiers.length > 0) {
    assignCommandableSoldiersToAttack(target)
  }
  for (const worker of attackWorkers) {
    assignWorkerToAttack(worker, target)
  }
  if (attackSoldiers.length === 0) {
    setStatus(`${attackWorkers.length} worker${attackWorkers.length === 1 ? '' : 's'} attacking ${target.name}. They are weak fighters!`)
  }
  if (isRelayActive()) {
    broadcastMyCommand({
      type: 'attackTarget',
      unitIds: [...attackSoldiers.map((soldier) => soldier.id), ...attackWorkers.map((worker) => worker.id)],
      targetId: target.id
    })
  }
  return true
}

/** Shift-click membership toggle: add the unit to the selection, or drop it if already in. */
function toggleUnitInSelection(unit: Worker | Soldier): void {
  const current = getSelectedUnits().filter((selected) => selected.alive)
  const index = current.findIndex((selected) => selected.id === unit.id)
  const removing = index >= 0

  if (removing) current.splice(index, 1)
  else current.push(unit)

  if (current.length === 0) {
    clearSelection()
    setStatus(`${unit.name} removed. Selection empty.`)
    return
  }

  // Fighting selections should command soldiers, so put them first when mixed.
  current.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'soldier' ? -1 : 1))
  setUnitSelection(current)
  setStatus(removing ? `${unit.name} removed from selection (${current.length}).` : `${unit.name} added to selection (${current.length}).`)
}

function selectAllOfSameType(unit: Worker | Soldier): void {
  if (unit.kind === 'worker') {
    const allWorkers = workers.filter((worker) => worker.alive && getTeam(worker) === 'player')
    setUnitSelection(allWorkers)
    setStatus(`Selected all ${getWorkerDefinition('player').name}s (${allWorkers.length}).`)
    return
  }

  const variant = (unit as Soldier).variant
  const matches = soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === 'player' && soldier.variant === variant)
  setUnitSelection(matches)
  setStatus(`Selected all ${getSoldierDefinition('player', variant).name}s (${matches.length}).`)
}

function selectObject(selectable: Selectable): void {
  gameState.selectedId = selectable.id
  gameState.selectedKind = selectable.kind
  gameState.selectedUnitIds = selectable.kind === 'worker' || selectable.kind === 'soldier' ? [selectable.id] : []
  setStatus(`Selected ${selectable.name}.`)
}

function clearSelection(): void {
  gameState.selectedId = ''
  gameState.selectedKind = ''
  gameState.selectedUnitIds = []
  clearSelectionMarkers()
}

function assignWorkerToResource(worker: Worker, resource: ResourceNode, announce = true): void {
  if (!worker.alive || !resource.alive || resource.amount <= 0) return
  if (worker.state === 'movingToBuild' || worker.state === 'constructing' || worker.state === 'movingToRepair' || worker.state === 'repairing') {
    if (announce) setStatus(`${worker.name} is busy.`)
    return
  }

  worker.state = 'movingToResource'
  worker.targetResourceId = resource.id
  worker.lastResourceId = resource.id
  worker.lastResourceKind = resource.resource
  worker.buildSiteId = undefined
  worker.repairTargetId = undefined
  worker.attackTargetId = undefined
  worker.rallyPoint = undefined
  worker.timer = 0
  worker.carrying = 0
  worker.carryingResource = undefined
  setWorkerAnimation(worker, 'walk')
  if (announce) {
    setStatus(`${worker.name} gathering ${resource.name}.`)
    clearSelection()
  }
}

function assignWorkersToResource(assignedWorkers: Worker[], resource: ResourceNode): void {
  for (const worker of assignedWorkers) {
    assignWorkerToResource(worker, resource, false)
  }

  clearSelection()
  playAcknowledge()
  setStatus(`${assignedWorkers.length} worker${assignedWorkers.length === 1 ? '' : 's'} gathering ${resource.name}.`)
}

function sendWorkerToRally(worker: Worker, rallyPoint: Vector3): void {
  worker.state = 'movingToRally'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
  worker.repairTargetId = undefined
  worker.attackTargetId = undefined
  worker.timer = 0
  worker.carrying = 0
  worker.carryingResource = undefined
  worker.rallyPoint = cloneVector(rallyPoint)
  setWorkerAnimation(worker, 'walk')
}

function sendSoldierToRally(soldier: Soldier, rallyPoint: Vector3): void {
  // Dug-in artillery is bolted down: it must pack up before it can move.
  if (isSiegeLocked(soldier)) {
    if (getTeam(soldier) === 'player') setStatus(`${soldier.name} is dug in: switch to mobile mode to move.`)
    return
  }
  soldier.state = 'movingToRally'
  soldier.targetId = undefined
  soldier.attackPosition = undefined
  soldier.attackMovePoint = undefined
  soldier.patrolPointA = undefined
  soldier.patrolPointB = undefined
  soldier.autoEngaged = false
  soldier.rallyPoint = cloneVector(rallyPoint)
  soldier.attackTimer = 0
  setSoldierAnimation(soldier, 'walk')
}

function assignSoldierToAttack(soldier: Soldier, target: Building | Soldier | Worker, slot = 0, announce = true): void {
  if (!soldier.alive || !target.alive) return
  if (getTeam(soldier) === getTeam(target)) return
  if (!canAttackTarget(soldier, target)) {
    if (announce && getTeam(soldier) === 'player') setStatus(`${soldier.name} can't reach ${target.name}: only ranged weapons hit air.`)
    return
  }

  soldier.state = 'movingToAttack'
  soldier.targetId = target.id
  soldier.attackPosition = target.kind === 'soldier' || target.kind === 'worker' ? undefined : getSoldierAttackPosition(target, slot, soldier)
  soldier.rallyPoint = undefined
  // Ordered attacks chase without a leash; the combat system re-marks auto-acquired
  // ones and restores their standing attack-move / patrol orders afterwards.
  soldier.attackMovePoint = undefined
  soldier.patrolPointA = undefined
  soldier.patrolPointB = undefined
  soldier.autoEngaged = false
  soldier.attackTimer = 0
  setSoldierAnimation(soldier, 'walk')
  if (announce && getTeam(soldier) === 'player') setStatus(`${soldier.name} attacking ${target.name}.`)
}

function assignWorkerToAttack(worker: Worker, target: Building | Soldier | Worker): void {
  if (!worker.alive || !target.alive) return
  if (worker.state === 'movingToBuild' || worker.state === 'constructing' || worker.state === 'movingToRepair' || worker.state === 'repairing') return
  // Workers fight in close quarters and cannot reach airborne units.
  if (!canAttackTarget(worker, target)) {
    if (getTeam(worker) === 'player') setStatus(`${worker.name} can't reach ${target.name}: only ranged weapons hit air.`)
    return
  }

  worker.state = 'movingToAttack'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
  worker.repairTargetId = undefined
  worker.attackTargetId = target.id
  worker.rallyPoint = undefined
  worker.timer = 0
  worker.carrying = 0
  worker.carryingResource = undefined
  setWorkerAnimation(worker, 'walk')
}

function assignWorkerToRepair(worker: Worker, target: Building | Soldier, announce = true): void {
  if (!worker.alive || !target.alive) return
  if (target.kind !== 'soldier' && !(target as Building).isComplete) return
  if (getTeam(worker) !== getTeam(target)) return
  // Only human mech fighters (gunships, juggernauts) can be field-repaired;
  // infantry and other races' flesh heal on their own or not at all.
  if (target.kind === 'soldier' && !isMechSoldier(worker, target as Soldier)) {
    if (announce) setStatus('Only mechanical fighters can be repaired.')
    return
  }
  if (target.hp >= target.maxHp) {
    if (announce) setStatus(`${target.name} does not need repairs.`)
    return
  }
  if (worker.state === 'movingToBuild' || worker.state === 'constructing' || worker.state === 'movingToRepair' || worker.state === 'repairing') {
    if (announce) setStatus(`${worker.name} is busy.`)
    return
  }

  worker.state = 'movingToRepair'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
  worker.repairTargetId = target.id
  worker.attackTargetId = undefined
  worker.rallyPoint = undefined
  worker.timer = 0
  worker.carrying = 0
  worker.carryingResource = undefined
  setWorkerAnimation(worker, 'walk')
  if (announce) {
    clearSelection()
    setStatus(`${worker.name} moving to repair ${target.name}.`)
  }
}

function assignCommandableSoldiersToAttack(target: Building | Soldier | Worker): void {
  const assignedSoldiers = getCommandableSoldiers()

  if (assignedSoldiers.length === 0) {
    setStatus('Select a fighter first.')
    return
  }

  for (let i = 0; i < assignedSoldiers.length; i++) {
    assignSoldierToAttack(assignedSoldiers[i], target, i)
  }

  // Selection persists so the player can keep issuing commands to the same group.
  playAcknowledge()
  setStatus(`${assignedSoldiers.length} fighter${assignedSoldiers.length === 1 ? '' : 's'} attacking ${target.name}.`)
}

function confirmBuildingPlacement(hitPosition?: Vector3): void {
  if (placementState.state !== 'placing') return

  const definition = BUILDING_DEFINITIONS[placementState.buildingKind]
  const builder = getWorkerById(placementState.builderWorkerId)
  const position = hitPosition ?? currentBuildingPreviewPosition ?? getCurrentBuildingPlacement(definition)?.center

  if (!builder?.alive) {
    cancelPlacement()
    setStatus('Builder is no longer available.')
    return
  }

  if (!position) {
    setStatus('Player position is not ready yet.')
    return
  }

  if (!canPlaceBuildingAt(definition, position)) {
    setStatus(`Cannot place ${getBuildingDisplayName(definition.kind, 'player')} there. Move the footprint to an open area.`)
    return
  }

  if (!spendResources(builder.team ?? 'player', definition.cost)) {
    cancelPlacement()
    setStatus(`Need ${formatCost(definition.cost)} to build the ${getBuildingDisplayName(definition.kind, 'player')}.`)
    return
  }

  const buildPosition = Vector3.create(position.x, definition.placementY, position.z)
  const site = createConstructionSite(definition.kind, buildPosition, builder.id, currentBuildingPreviewRotationY, builder.team ?? 'player')
  if (isRelayActive()) {
    broadcastMyCommand({ type: 'build', kind: definition.kind, x: buildPosition.x, z: buildPosition.z, workerId: builder.id, rot: currentBuildingPreviewRotationY })
  }

  builder.state = 'movingToBuild'
  builder.targetResourceId = undefined
  builder.buildSiteId = site.id
  builder.repairTargetId = undefined
  builder.attackTargetId = undefined
  builder.rallyPoint = undefined
  builder.timer = 0
  builder.carrying = 0
  builder.carryingResource = undefined
  setWorkerAnimation(builder, 'walk')
  cancelPlacement()
  clearSelection()
  setStatus(`${builder.name} moving to build the ${getBuildingDisplayName(definition.kind, 'player')}.`)
}

function cancelPlacement(): void {
  if (placementState.state === 'placing') {
    hideEntity(placementState.ghostEntity)
  }

  placementState = { state: 'none' }
  gameState.placementMode = 'none'
  gameState.placementBuildingKind = ''
  currentBuildingPreviewPosition = undefined
  currentBuildingPreviewCanPlace = false
  currentBuildingPreviewRotationY = 0
  placementConfirmCooldown = 0
}

const productionDeps = {
  getBuildingById,
  createWorker,
  createSoldier,
  getTempleExitPosition,
  getBarracksExitPosition,
  getTempleRallyPoint: (templeId: string) => templeRallyPoints.get(templeId),
  getBarracksRallyPoint: (barracksId: string) => barracksRallyPoints.get(barracksId),
  sendWorkerToRally,
  sendSoldierToRally,
  setStatus
}

const enemyAiDeps = {
  assignWorkerToResource,
  createConstructionSite,
  canPlaceBuildingAt,
  setWorkerAnimation,
  assignSoldierToAttack,
  getNearestTemple,
  getSnappedPlacementPosition,
  setStatus
}

const workerSystemDeps = {
  getBuildingById,
  getWorkerGatherPosition,
  getNearestTemple,
  getTempleDropoffPosition,
  getBuilderWorkPosition,
  getRepairWorkPosition: getBuilderWorkPosition,
  getWorkerRallyPosition,
  getCombatTargetById,
  damageCombatTarget,
  setWorkerAnimation,
  playResourceGatherFeedback,
  depleteResourceNode,
  updateLabel,
  setStatus
}

const combatSystemDeps = {
  getCombatTargetById,
  getSoldierAttackPosition,
  setSoldierAnimation,
  damageCombatTarget,
  assignSoldierToAttack,
  setStatus
}

const upgradeSystemDeps = {
  isForgeAlive: (forgeId: string) => {
    const forge = getBuildingById(forgeId)
    return !!forge?.alive && forge.isComplete
  },
  onUpgradeComplete: (team: Team, kind: UpgradeKind, newLevel: number) => {
    if (team === 'player') {
      playResearchComplete()
      setStatus(`${UPGRADE_INFO[kind].name} level ${newLevel} research complete (${UPGRADE_INFO[kind].effect}).`)
    }
    // Pin the new rank on every fighter already in the field, each wearing
    // the tracks that apply to it (air vs ground).
    for (const soldier of soldiers) {
      if (soldier.alive && getTeam(soldier) === team) {
        const tracks = getUpgradeKindsFor(soldier.variant)
        setUnitUpgradeInsignia(soldier.entity, getUpgradeLevel(team, tracks.damage), getUpgradeLevel(team, tracks.speed))
      }
    }
  }
}

const dragSelectDeps = {
  isBlocked: () =>
    placementState.state === 'placing' ||
    rallyPlacementKind !== 'none' ||
    attackMovePending ||
    patrolPending ||
    repairPending ||
    orderClickConsumedUntilRelease ||
    gameState.matchStatus !== MATCH_ACTIVE,
  onBoxSelect: selectPlayerUnitsInRect,
  isPressOnSelectable: isPointerPressOnSelectable,
  onGroundClick: moveSelectedUnitsTo
}

function isPointerPressOnSelectable(): boolean {
  const command = inputSystem.getInputCommand(InputAction.IA_POINTER, PointerEventType.PET_DOWN)
  const hitEntityId = command?.hit?.entityId
  if (hitEntityId === undefined) return false

  for (const selectable of selectables.values()) {
    if (selectable.entity === hitEntityId) return true
    if (selectable.colliderEntity === hitEntityId) return true
  }
  return false
}

/** Plain ground click with units selected = walk there, classic RTS style. */
function moveSelectedUnitsTo(point: { x: number; z: number }): void {
  const movableWorkers = getSelectedWorkers().filter(
    (worker) =>
      worker.alive &&
      getTeam(worker) === 'player' &&
      worker.state !== 'movingToBuild' &&
      worker.state !== 'constructing' &&
      worker.state !== 'movingToRepair' &&
      worker.state !== 'repairing'
  )
  const movableSoldiers = getSelectedSoldiers().filter((soldier) => soldier.alive && getTeam(soldier) === 'player')
  const unitCount = movableWorkers.length + movableSoldiers.length
  if (unitCount === 0) return

  const destination = Vector3.create(point.x, 0.25, point.z)
  // Workers spread around a shared rally point on arrival; soldiers get explicit formation slots.
  for (const worker of movableWorkers) {
    sendWorkerToRally(worker, destination)
  }
  for (let i = 0; i < movableSoldiers.length; i++) {
    const slotPosition = getFormationPosition(destination, i, SOLDIER_MOVE_FORMATION_RADIUS)
    sendSoldierToRally(movableSoldiers[i], Vector3.create(slotPosition.x, 0.25, slotPosition.z))
  }

  if (isRelayActive()) {
    // Workers first, soldiers after: the remote applier assigns formation slots
    // in list order, so this order must match the loops above.
    broadcastMyCommand({
      type: 'move',
      unitIds: [...movableWorkers.map((worker) => worker.id), ...movableSoldiers.map((soldier) => soldier.id)],
      x: point.x,
      z: point.z
    })
  }
  showMoveMarker(point)
  playAcknowledge()
  setStatus(`${unitCount} unit${unitCount === 1 ? '' : 's'} moving.`)
}

// ---------------------------------------------------------------------------
// Multiplayer command sync: remote players' orders arrive through the server
// relay tagged with their seat, get translated to a local enemy team, and are
// replayed here with the same primitives the local player uses. Costs are
// force-spent (clamped at zero) instead of validated - the sender already
// validated against their own economy, and rejecting on small drift would
// desync the sims much worse than a slightly negative wallet.
// ---------------------------------------------------------------------------

function forceSpendResources(team: Team, cost: ResourceCost): void {
  const economy = gameState.economies[team]
  economy.minerals = Math.max(0, economy.minerals - (cost.minerals ?? 0))
  economy.gas = Math.max(0, economy.gas - (cost.gas ?? 0))
}

function getRemoteUnit(id: string, team: Team): Worker | Soldier | undefined {
  const unit = selectables.get(id)
  if (!unit || !unit.alive || getTeam(unit) !== team) return undefined
  return unit.kind === 'worker' || unit.kind === 'soldier' ? (unit as Worker | Soldier) : undefined
}

export function applyRemoteCommand(team: Team, command: MatchCommand): void {
  if (gameState.matchStatus !== MATCH_ACTIVE) return

  switch (command.type) {
    case 'move': {
      const destination = Vector3.create(command.x, 0.25, command.z)
      let soldierSlot = 0
      for (const id of command.unitIds) {
        const unit = getRemoteUnit(id, team)
        if (!unit) continue
        if (unit.kind === 'worker') {
          const worker = unit as Worker
          if (worker.state === 'movingToBuild' || worker.state === 'constructing' || worker.state === 'movingToRepair' || worker.state === 'repairing') continue
          sendWorkerToRally(worker, destination)
        } else {
          const slotPosition = getFormationPosition(destination, soldierSlot++, SOLDIER_MOVE_FORMATION_RADIUS)
          sendSoldierToRally(unit as Soldier, Vector3.create(slotPosition.x, 0.25, slotPosition.z))
        }
      }
      break
    }

    case 'attackMove': {
      const destination = Vector3.create(command.x, 0.25, command.z)
      let slot = 0
      for (const id of command.unitIds) {
        const unit = getRemoteUnit(id, team)
        if (unit?.kind !== 'soldier') continue
        const soldier = unit as Soldier
        if (isSiegeLocked(soldier)) continue
        const slotPosition = getFormationPosition(destination, slot++, SOLDIER_MOVE_FORMATION_RADIUS)
        soldier.state = 'attackMoving'
        soldier.targetId = undefined
        soldier.attackPosition = undefined
        soldier.rallyPoint = undefined
        soldier.autoEngaged = false
        soldier.patrolPointA = undefined
        soldier.patrolPointB = undefined
        soldier.attackMovePoint = Vector3.create(slotPosition.x, 0.25, slotPosition.z)
        setSoldierAnimation(soldier, 'walk')
      }
      break
    }

    case 'patrol': {
      const destination = Vector3.create(command.x, 0.25, command.z)
      let slot = 0
      for (const id of command.unitIds) {
        const unit = getRemoteUnit(id, team)
        if (unit?.kind !== 'soldier') continue
        const soldier = unit as Soldier
        if (isSiegeLocked(soldier)) continue
        const here = Transform.get(soldier.entity).position
        const slotPosition = getFormationPosition(destination, slot++, SOLDIER_MOVE_FORMATION_RADIUS)
        soldier.state = 'patrolling'
        soldier.targetId = undefined
        soldier.attackPosition = undefined
        soldier.rallyPoint = undefined
        soldier.attackMovePoint = undefined
        soldier.autoEngaged = false
        soldier.patrolPointA = Vector3.create(here.x, 0.25, here.z)
        soldier.patrolPointB = Vector3.create(slotPosition.x, 0.25, slotPosition.z)
        soldier.patrolToB = true
        setSoldierAnimation(soldier, 'walk')
      }
      break
    }

    case 'attackTarget': {
      const target = selectables.get(command.targetId)
      if (!target || !target.alive || target.kind === 'resource') break
      let slot = 0
      for (const id of command.unitIds) {
        const unit = getRemoteUnit(id, team)
        if (!unit) continue
        if (unit.kind === 'soldier') assignSoldierToAttack(unit as Soldier, target as Building | Soldier | Worker, slot++, false)
        else assignWorkerToAttack(unit as Worker, target as Building | Soldier | Worker)
      }
      break
    }

    case 'train': {
      const trainer = selectables.get(command.buildingId) as Building | undefined
      if (!trainer?.alive || !trainer.isComplete || getTeam(trainer) !== team) break
      if (command.unit === 'worker') {
        const workerDef = getWorkerDefinition(team)
        forceSpendResources(team, workerDef.cost)
        workerProductionOrders.push({ templeId: trainer.id, timer: 0, productionTime: workerDef.productionTime, team })
        gameState.economies[team].workerQueue += 1
      } else {
        const soldierDef = getSoldierDefinition(team, command.unit)
        forceSpendResources(team, soldierDef.cost)
        soldierProductionOrders.push({ barracksId: trainer.id, timer: 0, productionTime: soldierDef.productionTime, team, variant: command.unit })
        gameState.economies[team].soldierQueue += 1
      }
      break
    }

    case 'build': {
      const definition = BUILDING_DEFINITIONS[command.kind as BuildableKind]
      const builder = getRemoteUnit(command.workerId, team)
      if (!definition || builder?.kind !== 'worker') break
      const worker = builder as Worker
      forceSpendResources(team, definition.cost)
      const buildPosition = Vector3.create(command.x, definition.placementY, command.z)
      const site = createConstructionSite(definition.kind, buildPosition, worker.id, command.rot ?? 0, team)
      worker.state = 'movingToBuild'
      worker.targetResourceId = undefined
      worker.buildSiteId = site.id
      worker.repairTargetId = undefined
      worker.attackTargetId = undefined
      worker.rallyPoint = undefined
      worker.timer = 0
      worker.carrying = 0
      worker.carryingResource = undefined
      setWorkerAnimation(worker, 'walk')
      break
    }

    case 'gather': {
      const node = selectables.get(command.nodeId)
      if (node?.kind !== 'resource') break
      for (const id of command.workerIds) {
        const unit = getRemoteUnit(id, team)
        if (unit?.kind === 'worker') assignWorkerToResource(unit as Worker, node as ResourceNode, false)
      }
      break
    }

    case 'repair': {
      const target = selectables.get(command.buildingId)
      if (!target?.alive || target.kind === 'resource' || target.kind === 'worker') break
      for (const id of command.workerIds) {
        const unit = getRemoteUnit(id, team)
        if (unit?.kind === 'worker') assignWorkerToRepair(unit as Worker, target as Building | Soldier, false)
      }
      break
    }

    case 'research': {
      const forge = selectables.get(command.buildingId) as Building | undefined
      if (!forge?.alive || getTeam(forge) !== team) break
      if (isUpgradeInProgress(team, command.upgrade)) break
      const cost = getNextUpgradeCost(team, command.upgrade)
      if (!cost) break
      forceSpendResources(team, cost)
      startUpgradeResearchOrder(team, command.upgrade, forge.id)
      break
    }

    case 'stance': {
      for (const id of command.unitIds) {
        const unit = getRemoteUnit(id, team)
        if (unit?.kind !== 'soldier') continue
        const soldier = unit as Soldier
        soldier.stance = command.stance
        soldier.guardPoint = cloneVector(Transform.get(soldier.entity).position)
        if (command.stance === 'hold' && (soldier.state === 'movingToAttack' || soldier.state === 'attackMoving' || soldier.state === 'movingToRally')) {
          soldier.state = 'idle'
          soldier.targetId = undefined
          soldier.attackPosition = undefined
          soldier.attackMovePoint = undefined
          soldier.rallyPoint = undefined
          setSoldierAnimation(soldier, 'idle')
        }
      }
      break
    }

    case 'rally': {
      const building = selectables.get(command.buildingId) as Building | undefined
      if (!building?.alive || getTeam(building) !== team) break
      const point = Vector3.create(command.x, 0.25, command.z)
      if (building.kind === 'temple') templeRallyPoints.set(building.id, point)
      else barracksRallyPoints.set(building.id, point)
      break
    }

    case 'heroAbility': {
      const unit = getRemoteUnit(command.unitId, team)
      if (unit?.kind === 'soldier') castHeroAbility(unit as Soldier, false)
      break
    }

    case 'siegeMode': {
      for (const id of command.unitIds) {
        const unit = getRemoteUnit(id, team)
        if (unit?.kind !== 'soldier') continue
        startSiegeTransition(unit as Soldier, command.sieged)
      }
      break
    }

    case 'surrender': {
      eliminateTeam(team, true)
      break
    }

    case 'stop':
    case 'hold': {
      for (const id of command.unitIds) {
        const unit = getRemoteUnit(id, team)
        if (!unit) continue
        haltUnit(unit)
        if (command.type === 'hold' && unit.kind === 'soldier') (unit as Soldier).stance = 'hold'
      }
      break
    }
  }
}

let autoGatherTimer = 0

/** Idle player workers pick up the nearest resource within range, so parking workers near a forest puts them to work. */
function updateWorkerAutoGather(dt: number): void {
  autoGatherTimer += dt
  if (autoGatherTimer < 1) return
  autoGatherTimer = 0

  for (const worker of workers) {
    if (!worker.alive || getTeam(worker) !== 'player' || worker.state !== 'idle') continue

    const resource = getNearestGatherableResource(Transform.get(worker.entity).position)
    if (resource) assignWorkerToResource(worker, resource, false)
  }
}

function getNearestResourceOfKind(position: Vector3, kind: ResourceKind): ResourceNode | undefined {
  let nearest: ResourceNode | undefined
  let nearestDistance = Infinity

  for (const resource of resources) {
    if (!resource.alive || resource.amount <= 0 || resource.resource !== kind) continue

    const distance = distanceToPoint(Transform.get(resource.entity).position, position)
    if (distance < nearestDistance) {
      nearest = resource
      nearestDistance = distance
    }
  }
  return nearest
}

function getNearestGatherableResource(position: Vector3): ResourceNode | undefined {
  let nearest: ResourceNode | undefined
  let nearestDistance = CONFIG.workerAutoGatherRange

  for (const resource of resources) {
    if (!resource.alive || resource.amount <= 0) continue

    const distance = distanceToPoint(Transform.get(resource.entity).position, position)
    if (distance < nearestDistance) {
      nearest = resource
      nearestDistance = distance
    }
  }
  return nearest
}

/** DCL binds Shift to IA_WALK, which doubles as the classic add-to-selection modifier. */
function isShiftDown(): boolean {
  return inputSystem.isPressed(InputAction.IA_WALK)
}

function selectPlayerUnitsInRect(min: { x: number; z: number }, max: { x: number; z: number }): void {
  const unitsInRect: (Worker | Soldier)[] = []

  for (const worker of workers) {
    if (worker.alive && getTeam(worker) === 'player' && isInRect(worker, min, max)) unitsInRect.push(worker)
  }
  for (const soldier of soldiers) {
    if (soldier.alive && getTeam(soldier) === 'player' && isInRect(soldier, min, max)) unitsInRect.push(soldier)
  }

  // Shift-drag adds the boxed units to the current selection instead of replacing it.
  if (isShiftDown()) {
    for (const unit of getSelectedUnits()) {
      if (unit.alive && !unitsInRect.some((boxed) => boxed.id === unit.id)) unitsInRect.push(unit)
    }
  }

  if (unitsInRect.length === 0) {
    clearSelection()
    setStatus('Nothing selected.')
    return
  }

  // Fighting selections should command soldiers, so put them first when mixed.
  unitsInRect.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'soldier' ? -1 : 1))
  setUnitSelection(unitsInRect)
  setStatus(`Selected ${unitsInRect.length} unit${unitsInRect.length === 1 ? '' : 's'}.`)
}

function isInRect(unit: Worker | Soldier, min: { x: number; z: number }, max: { x: number; z: number }): boolean {
  const position = Transform.get(unit.entity).position
  return position.x >= min.x && position.x <= max.x && position.z >= min.z && position.z <= max.z
}

function rtsTickSystem(dt: number): void {
  updateMatchTimer(dt)
  updateAttackAlert(dt)
  if (gameState.statusTimer > 0) gameState.statusTimer = Math.max(0, gameState.statusTimer - dt)
  if (gameState.matchStatus !== MATCH_ACTIVE) return

  updateCoordinateLogger(dt)
  updateGhostPreview()
  updatePlacementConfirmInput(dt)
  updateRallyPlacementInput(dt)
  updateAttackMoveInput(dt)
  updatePatrolInput(dt)
  updateRepairOrderInput(dt)
  updateCancelInput()
  updateControlGroupHotkeys()
  if (orderClickConsumedUntilRelease && !inputSystem.isPressed(InputAction.IA_POINTER)) {
    orderClickConsumedUntilRelease = false
  }
  updateDragSelect(dragSelectDeps)
  updateWorkerAutoGather(dt)
  updateRallyMarker()
  updateSelectionMarkers(getSelectionMarkerTargets())
  updateWorkerProductionSystem(dt, productionDeps)
  updateSoldierProductionSystem(dt, productionDeps)
  updateUpgradeResearch(dt, upgradeSystemDeps)
  updateLeaverTakeover(dt)
  for (const ai of enemyAis) updateEnemyAiSystem(ai, dt, enemyAiDeps)
  updateWorkersSystem(dt, workerSystemDeps)
  updateWorkerCargoVisuals()
  updateSoldiersSystem(dt, combatSystemDeps)
  updateHealers(dt, { setSoldierAnimation })
  updateSiegeUnits(dt)
  updateUnitSeparation(dt)
  updateFireplaceAuras(dt)
  updateStatusEffects(dt)
  updateConstructionSites(dt)
  updateTurrets(dt)
  updateBioRegeneration(dt)
  updateHeroBrood(dt)
  updateIncomeSampling(dt)
  updateBuildingDamageVfxSystem()
  updateHealthBars()
  updateAttackPings(dt)
  updateDepletedResources(dt)
  updateMatchEndState()
}

/** Keeps the robots' back-mounted cargo bundle in sync with what they're carrying. */
function updateWorkerCargoVisuals(): void {
  for (const worker of workers) {
    if (!worker.alive) continue
    updateUnitCargo(worker.entity, worker.carrying > 0 ? worker.carryingResource : undefined)
  }
}

function getSelectionMarkerTargets(): SelectionMarkerTarget[] {
  const units = getSelectedUnits()
  if (units.length > 0) {
    return units.map(getSelectionMarkerTarget)
  }

  const selected = getSelected()
  return selected?.alive ? [getSelectionMarkerTarget(selected)] : []
}

function getSelectionMarkerTarget(selectable: Selectable): SelectionMarkerTarget {
  const transform = Transform.get(selectable.entity)
  // Procedural building roots have unit scale, so size the ring from the footprint definition.
  const definition = isBuildableKind(selectable.kind as Building['kind']) ? BUILDING_DEFINITIONS[selectable.kind as BuildableKind] : undefined
  const footprint = definition ? Math.max(definition.scale.x, definition.scale.z) : Math.max(transform.scale.x, transform.scale.z)

  return {
    position: transform.position,
    diameter: footprint + 0.55
  }
}

function updateMatchTimer(dt: number): void {
  if (gameState.matchStatus === MATCH_ACTIVE) {
    gameState.matchTime += dt
  }
}

function isMatchActive(): boolean {
  if (gameState.matchStatus === MATCH_ACTIVE) return true

  setStatus('The match is over. Use Replay to start again.')
  return false
}

function updateCoordinateLogger(dt: number): void {
  coordinateLogTimer += dt
  if (coordinateLogTimer < 1) return

  coordinateLogTimer = 0
  const position = getPlayerPosition()
  if (!position) return

  gameState.currentPlayerLocation = formatPosition(position)
  console.log(`[coords] player ${gameState.currentPlayerLocation}`)
}

function updateAttackAlert(dt: number): void {
  if (gameState.attackAlertTimer <= 0) return

  gameState.attackAlertTimer = Math.max(0, gameState.attackAlertTimer - dt)
  if (gameState.attackAlertTimer === 0) {
    gameState.attackAlert = ''
  }
}

/** Teams whose last building already fell; drives elimination announcements and the roster. */
const eliminatedTeams = new Set<Team>()

function updateMatchEndState(): void {
  if (gameState.matchStatus === MATCH_ENDED) return

  // Announce factions the moment their last building falls (the roster flips to OUT too).
  for (const team of ['player' as Team, ...gameState.activeEnemyTeams]) {
    if (eliminatedTeams.has(team)) continue
    if (buildings.some((building) => building.alive && getTeam(building) === team)) continue
    eliminatedTeams.add(team)
    if (team !== 'player') announceMatchEvent(`${getTeamDisplayName(team)} has been eliminated!`)
  }

  // StarCraft elimination rule: a faction is out when it has no buildings left
  // at all - temples, production, defenses, even unfinished foundations.
  // Surviving allies don't block the win, and losing your own last building is
  // a loss even if an ally still stands - you are out of the game.
  const playerBuildingsAlive = buildings.some((building) => building.alive && getTeam(building) === 'player')
  const hostileBuildingsAlive = buildings.some((building) => building.alive && isHostileToPlayer(getTeam(building)))

  if (!playerBuildingsAlive) {
    endMatch('loss')
  } else if (!hostileBuildingsAlive) {
    endMatch('win')
  }
}

/** Big-banner announcement (same slot as the under-attack alert) plus the console line. */
function announceMatchEvent(message: string): void {
  gameState.attackAlert = message
  gameState.attackAlertTimer = PLAYER_ATTACK_ALERT_DURATION
  setStatus(message)
}

/** Display name for a team: your lobby name, another human's name, or a CPU tag. */
export function getTeamDisplayName(team: Team): string {
  if (team === 'player') return multiplayerPlan?.names.player ?? 'You'
  const humanName = getMultiplayerTeamName(team)
  if (humanName) return humanName
  const index = gameState.activeEnemyTeams.indexOf(team as EnemyTeam)
  return `CPU ${index + 1} (${AI_DIFFICULTY[gameState.enemyDifficulties[team as EnemyTeam]].label})`
}

export type MatchRosterEntry = {
  team: Team
  name: string
  race: RaceId
  /** Map seat, for the seat-color swatch in the HUD roster. */
  seat: number
  isHuman: boolean
  ally: boolean
  eliminated: boolean
}

/** Everyone in the match and whether they're still standing, for the HUD roster. */
export function getMatchRoster(): MatchRosterEntry[] {
  const teams: Team[] = ['player', ...gameState.activeEnemyTeams]
  return teams.map((team) => ({
    team,
    name: getTeamDisplayName(team),
    race: team === 'player' ? gameState.playerRace : gameState.enemyRaces[team as EnemyTeam],
    seat: team === 'player' ? (multiplayerPlan?.mySeatIndex ?? 0) : gameState.enemySeatIndex[team as EnemyTeam],
    isHuman: team === 'player' || isMultiplayerHumanTeam(team),
    ally: team !== 'player' && isPlayerAlly(team),
    eliminated: eliminatedTeams.has(team)
  }))
}

function endMatch(result: 'win' | 'loss'): void {
  if (gameState.matchStatus === MATCH_ENDED) return

  gameState.matchStatus = MATCH_ENDED
  gameState.matchResult = result
  gameState.attackAlert = ''
  gameState.attackAlertTimer = 0
  clearHealthBars()
  clearAttackPings()
  stopAmbientMusic()
  disableTopDownView()
  cancelPlacement()
  clearSelection()
  const time = formatRuntimeMatchTime(gameState.matchTime)
  setStatus(result === 'win' ? `You destroyed every enemy structure in ${time}. Victory!` : `All of your structures were destroyed after ${time}. You lose.`)
}

function updateGhostPreview(): void {
  if (placementState.state !== 'placing') return

  const definition = BUILDING_DEFINITIONS[placementState.buildingKind]
  const placement = getCurrentBuildingPlacement(definition)
  if (!placement) return

  currentBuildingPreviewPosition = placement.center
  currentBuildingPreviewCanPlace = canPlaceBuildingAt(definition, placement.center)

  const ghostRoot = Transform.getMutable(placementState.ghostEntity)
  ghostRoot.position = Vector3.create(placement.center.x, 0, placement.center.z)
  ghostRoot.rotation = Quaternion.fromEulerDegrees(0, currentBuildingPreviewRotationY, 0)
  Transform.getMutable(placementState.ghostModelEntity).rotation = Quaternion.fromEulerDegrees(0, 0, 0)
  updateFootprintMaterial(placementState.ghostFootprintEntity, currentBuildingPreviewCanPlace)
}

function updatePlacementConfirmInput(dt: number): void {
  if (placementState.state !== 'placing') return

  if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) {
    currentBuildingPreviewRotationY = (currentBuildingPreviewRotationY + 90) % 360
  }

  placementConfirmCooldown = Math.max(0, placementConfirmCooldown - dt)
  if (placementConfirmCooldown > 0) return
  if (!inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return
  if (isPointerOverHud()) return

  confirmBuildingPlacement()
}

// Cancel lives on F only: the number keys 1-4 belong to control groups.
function updateCancelInput(): void {
  const secondaryIsPressed = inputSystem.isPressed(InputAction.IA_SECONDARY)
  const secondaryWasTriggered =
    inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN) ||
    (secondaryIsPressed && !secondaryCancelWasPressed)

  secondaryCancelWasPressed = secondaryIsPressed
  if (!secondaryWasTriggered) return

  if (placementState.state === 'placing') {
    cancelBuildingPlacement()
    return
  }

  if (rallyPlacementKind !== 'none') {
    cancelRallyPlacement()
    setStatus('Spawn point placement cancelled.')
    return
  }

  if (repairPending) {
    cancelRepairOrder()
    setStatus('Repair cancelled.')
    return
  }

  const selected = getSelected()
  if (isCancellableConstruction(selected)) {
    cancelConstruction(selected)
  }
}

function updateRallyMarker(): void {
  if (!rallyMarker) return

  const position = getSelectedRallyPoint()
  if (!position) {
    hideEntity(rallyMarker.root)
    return
  }

  Transform.getMutable(rallyMarker.root).position = Vector3.create(position.x, 0, position.z)
}

/** AETHYR signature perk: seeded structures assemble themselves at this fraction of worker speed. */
const ALIEN_SELF_BUILD_RATE = 0.5

/** MYRIAD signature perk: living units knit themselves back together out of combat or in it. */
const BIO_REGEN_PER_SECOND = 1
let bioRegenTimer = 0

// ---------------------------------------------------------------------------
// Heroes: each faction fields one unique champion from the opening second.
//   VANGUARD  - Warmaster Kael: nearby allied fighters deal bonus damage.
//   AETHYR    - Riftlord Auren: constantly regenerates.
//   MYRIAD    - Broodmother Szel: periodically births a free Mauler.
// Heroes cost nothing, take no supply, and cannot be rebuilt once slain.
// ---------------------------------------------------------------------------

const HERO_AURA_RANGE = 9
const HERO_AURA_MULTIPLIER = 1.25
const AETHYR_HERO_REGEN_PER_SECOND = 4
const BROOD_SPAWN_INTERVAL = 35

const broodTimers = new Map<string, number>()

/** VANGUARD hero perk: fighters standing near Kael's battle standard hit harder. */
function getHeroAuraMultiplier(attacker: Soldier | Worker): number {
  if (attacker.kind !== 'soldier') return 1
  const team = getTeam(attacker)
  if (getRace(team).id !== 'human') return 1

  const attackerPosition = Transform.get(attacker.entity).position
  for (const soldier of soldiers) {
    if (!soldier.alive || soldier.variant !== 'hero' || getTeam(soldier) !== team) continue
    if (distanceToPoint(Transform.get(soldier.entity).position, attackerPosition) <= HERO_AURA_RANGE) {
      return HERO_AURA_MULTIPLIER
    }
  }
  return 1
}

/** MYRIAD hero perk: the Broodmother births free Maulers as long as supply allows. */
function updateHeroBrood(dt: number): void {
  for (const hero of soldiers) {
    if (!hero.alive || hero.variant !== 'hero') continue
    const team = getTeam(hero)
    if (getRace(team).id !== 'bio') continue

    const timer = (broodTimers.get(hero.id) ?? 0) + dt
    const meleeDef = getSoldierDefinition(team, 'melee')

    // Hold the timer at "ready" while supply-blocked so a freed slot pops instantly.
    if (timer < BROOD_SPAWN_INTERVAL || getSupplyUsed(team) + meleeDef.supply > getSupplyCap(team)) {
      broodTimers.set(hero.id, Math.min(timer, BROOD_SPAWN_INTERVAL))
      continue
    }

    broodTimers.set(hero.id, 0)
    const heroPosition = Transform.get(hero.entity).position
    const spawn = createSoldier(Vector3.create(heroPosition.x + 1.5, 0.25, heroPosition.z + 1.5), team, 'melee')
    soldiers.push(spawn)
    addSupplyUsed(team, meleeDef.supply)
    gameState.matchStats[team].unitsProduced += 1
    if (team === 'player') setStatus(`${hero.name} birthed a free ${meleeDef.name}.`)
  }
}

// ---------------------------------------------------------------------------
// Defense towers: completed turrets automatically fire on hostile units in range.
// ---------------------------------------------------------------------------

const turretFireTimers = new Map<string, number>()

function updateTurrets(dt: number): void {
  for (const turret of buildings) {
    if (!turret.alive || !turret.isComplete || turret.kind !== 'turret') continue

    const team = getTeam(turret)
    const origin = Transform.get(turret.entity).position
    const target = findTurretTarget(origin, team)
    const timer = (turretFireTimers.get(turret.id) ?? 0) + dt

    if (!target || timer < TURRET_STATS.attackRate) {
      turretFireTimers.set(turret.id, Math.min(timer, TURRET_STATS.attackRate))
      continue
    }

    turretFireTimers.set(turret.id, 0)
    const targetPosition = cloneVector(Transform.get(target.entity).position)
    if (getTeam(target) === 'player') addAttackPing(targetPosition.x, targetPosition.z)
    fireProjectile(Vector3.create(origin.x, origin.y + TURRET_STATS.muzzleHeight, origin.z), targetPosition, team)
    spawnImpactFlash(targetPosition, getRace(team).accent)
    playLaser(origin)
    if (target.kind === 'soldier') damageSoldier(target, TURRET_STATS.damage)
    else damageWorker(target, TURRET_STATS.damage)
    // Credit the kill only once the damage has actually landed.
    if (!target.alive) gameState.matchStats[team].unitsKilled += 1
  }
}

/** Nearest hostile fighter in range, then workers - turrets don't shoot buildings. */
function findTurretTarget(origin: Vector3, team: Team): Soldier | Worker | undefined {
  let best: Soldier | Worker | undefined
  let bestDistance = TURRET_STATS.range

  for (const soldier of soldiers) {
    if (!soldier.alive || !areHostile(getTeam(soldier), team)) continue
    const distance = distanceToPoint(Transform.get(soldier.entity).position, origin)
    if (distance < bestDistance) {
      best = soldier
      bestDistance = distance
    }
  }
  if (best) return best

  for (const worker of workers) {
    if (!worker.alive || !areHostile(getTeam(worker), team)) continue
    const distance = distanceToPoint(Transform.get(worker.entity).position, origin)
    if (distance < bestDistance) {
      best = worker
      bestDistance = distance
    }
  }
  return best
}

/** End-screen graph data: sample each faction's cumulative harvest on a fixed cadence. */
const INCOME_SAMPLE_INTERVAL = 10
let incomeSampleTimer = 0

function updateIncomeSampling(dt: number): void {
  incomeSampleTimer += dt
  if (incomeSampleTimer < INCOME_SAMPLE_INTERVAL) return
  incomeSampleTimer -= INCOME_SAMPLE_INTERVAL

  gameState.incomeHistory.player.push(gameState.matchStats.player.resourcesGathered)
  for (const team of gameState.activeEnemyTeams) {
    gameState.incomeHistory[team].push(gameState.matchStats[team].resourcesGathered)
  }
}

function updateBioRegeneration(dt: number): void {
  bioRegenTimer += dt
  if (bioRegenTimer < 1) return
  bioRegenTimer -= 1

  for (const worker of workers) {
    if (!worker.alive || worker.hp >= worker.maxHp || getRace(getTeam(worker)).id !== 'bio') continue
    worker.hp = Math.min(worker.maxHp, worker.hp + BIO_REGEN_PER_SECOND)
  }
  for (const soldier of soldiers) {
    if (!soldier.alive || soldier.hp >= soldier.maxHp) continue
    const raceId = getRace(getTeam(soldier)).id
    let regen = raceId === 'bio' ? BIO_REGEN_PER_SECOND : 0
    // AETHYR hero perk: Riftlord Auren's ward constantly knits him back together.
    if (soldier.variant === 'hero' && raceId === 'alien') regen += AETHYR_HERO_REGEN_PER_SECOND
    if (regen > 0) soldier.hp = Math.min(soldier.maxHp, soldier.hp + regen)
  }
}

function updateConstructionSites(dt: number): void {
  for (const site of buildings) {
    if (site.isComplete) continue
    if (site.constructionState !== 'movingBuilder' && site.constructionState !== 'building' && site.constructionState !== 'paused') continue

    const builder = site.builderWorkerId ? getWorkerById(site.builderWorkerId) : undefined
    const builderAssigned = !!builder?.alive && builder.buildSiteId === site.id
    const builderOnSite = builderAssigned && builder !== undefined && distanceToPosition(builder.entity, getBuilderWorkPosition(site, Transform.get(builder.entity).position)) <= 0.8

    if (builderOnSite && builder) {
      site.constructionState = 'building'
      builder.state = 'constructing'
      site.constructionProgress = Math.min(1, site.constructionProgress + dt / site.buildTime)
      updateConstructionVisual(site)
      if (site.constructionProgress >= 1) completeConstruction(site, builder)
      continue
    }

    // AETHYR structures keep assembling themselves once seeded, builder or not.
    if (isBuildableKind(site.kind) && getRace(getTeam(site)).id === 'alien') {
      if (builderAssigned && builder) {
        builder.state = 'movingToBuild'
        setWorkerAnimation(builder, 'walk')
      }
      site.constructionState = 'building'
      site.constructionProgress = Math.min(1, site.constructionProgress + (dt * ALIEN_SELF_BUILD_RATE) / site.buildTime)
      updateConstructionVisual(site)
      if (site.constructionProgress >= 1) completeConstruction(site, builderAssigned ? builder : undefined)
      continue
    }

    pauseConstruction(site, builderAssigned ? builder : undefined)
  }
}

function updateDepletedResources(dt: number): void {
  for (const resource of resources) {
    if (resource.depletionTimer === undefined) continue

    resource.depletionTimer -= dt
    if (resource.depletionTimer <= 0) {
      hideEntity(resource.entity)
      resource.depletionTimer = undefined
    }
  }
}

function updateBuildingDamageVfxSystem(): void {
  for (const building of buildings) {
    updateBuildingDamageVfxForBuilding(building)
  }
}

function updateBuildingDamageVfxForBuilding(building: Building): void {
  if (!building.alive || !building.isComplete || building.hp <= 0) {
    clearBuildingDamageVfx(building)
    return
  }

  // Char the model itself; repairs restore the original materials.
  setBuildingModelDamage(building.entity, building.hp / building.maxHp)

  const level = getBuildingDamageVfxLevel(building)
  if (level === 0) {
    clearBuildingDamageVfx(building)
    return
  }

  const position = getBuildingDamageVfxPosition(building)
  if (!building.damageVfxEntity) {
    building.damageVfxEntity = createBuildingDamageVfx(position, level)
  } else {
    updateBuildingDamageVfx(building.damageVfxEntity, position, level)
  }
  building.damageVfxLevel = level
}

function getBuildingDamageVfxLevel(building: Building): number {
  const hpPercent = building.hp / building.maxHp
  if (hpPercent <= 0.2) return 2.2
  if (hpPercent <= 0.4) return 1.55
  if (hpPercent <= 0.7) return 1
  return 0
}

function getBuildingDamageVfxPosition(building: Building): Vector3 {
  const transform = Transform.get(building.entity)
  const height = isBuildableKind(building.kind) && isProceduralBuilding(building.entity)
    ? BUILDING_MODEL_HEIGHTS[building.kind] * 0.5
    : Math.max(transform.scale.y * 0.45, 1.4)

  return Vector3.create(transform.position.x, transform.position.y + height, transform.position.z)
}

function clearBuildingDamageVfx(building: Building): void {
  removeBuildingDamageVfx(building.damageVfxEntity)
  building.damageVfxEntity = undefined
  building.damageVfxLevel = undefined
}

function pauseConstruction(site: Building, builder?: Worker): void {
  if (site.constructionState !== 'paused') {
    site.constructionState = 'paused'
    updateLabel(site, `${site.name}\nNeeds worker`)
  }

  if (builder?.alive) {
    builder.state = 'movingToBuild'
    setWorkerAnimation(builder, 'walk')
  }
}

function completeConstruction(site: Building, builder?: Worker): void {
  const definition = BUILDING_DEFINITIONS[site.kind as BuildableKind]
  const displayName = `${teamNamePrefix(getTeam(site))}${getBuildingDisplayName(site.kind as BuildableKind, getTeam(site))}`

  site.constructionState = 'complete'
  site.constructionProgress = 1
  site.isComplete = true
  site.name = displayName
  if (builder?.alive) {
    builder.state = 'idle'
    builder.buildSiteId = undefined
    builder.repairTargetId = undefined
    setWorkerAnimation(builder, 'idle')
    // Builders head straight back to their last deposit instead of standing around.
    const previousDeposit = resources.find((node) => node.id === builder.lastResourceId && node.alive && node.amount > 0)
    if (previousDeposit) assignWorkerToResource(builder, previousDeposit, false)
  }
  updateConstructionVisual(site)
  updateLabel(site, displayName)
  ensureBuildingBeacon(site)

  if (definition.supplyAdds > 0) {
    addSupplyCap(getTeam(site), definition.supplyAdds)
  }

  if (getTeam(site) === 'player') {
    playComplete()
    setStatus(definition.completeStatus)
  }
}

function damageCombatTarget(target: Building | Soldier | Worker, amount: number, attacker: Soldier | Worker): void {
  const attackerTeam = getTeam(attacker)
  const targetPosition = cloneVector(Transform.get(target.entity).position)
  // Red flash on the minimap wherever the player's own stuff is getting hit.
  if (getTeam(target) === 'player') addAttackPing(targetPosition.x, targetPosition.z)
  // Weapon upgrades scale every fighter's damage team-wide the moment research lands,
  // and the VANGUARD hero's banner boosts anyone fighting beside him.
  const damage = attacker.kind === 'soldier' ? Math.round(amount * getDamageMultiplier(attackerTeam, attacker.variant) * getHeroAuraMultiplier(attacker)) : amount

  if (attacker.kind === 'soldier' && attacker.alive && target.alive) {
    const accent = getRace(attackerTeam).accent
    const isRangedShot =
      attacker.variant === 'ranged' ||
      attacker.variant === 'caster' ||
      attacker.variant === 'flyer' ||
      attacker.variant === 'siege' ||
      (attacker.variant === 'hero' && attacker.attackRange > 3)

    if (isRangedShot) {
      // Visible tracer plus a flash where the shot lands.
      fireProjectile(Transform.get(attacker.entity).position, targetPosition, attackerTeam)
      spawnImpactFlash(targetPosition, accent)
      playLaser(Transform.get(attacker.entity).position)
    } else {
      // Melee swings land with a clank and a flash so close combat reads clearly.
      spawnImpactFlash(targetPosition, accent)
      playMelee(targetPosition)
    }
    if (attacker.splashRadius > 0) {
      // Caster blasts and titan stomps ripple outward.
      spawnBlastRing(targetPosition, accent, attacker.splashRadius)
    }
  } else if (attacker.kind === 'worker' && attacker.alive && target.alive) {
    spawnImpactFlash(targetPosition, getRace(attackerTeam).accent)
    playMelee(targetPosition)
  }

  applyCombatDamage(target, damage, attacker)

  // Casters weave their signature ability into the attack cycle whenever it is
  // off cooldown - no micro needed, the skill fires as part of normal combat.
  if (attacker.kind === 'soldier' && attacker.variant === 'caster' && (attacker.abilityTimer ?? 0) <= 0) {
    castCasterAbility(attacker, target, targetPosition)
  }

  // Acidmaw shells coat their victims in lingering acid (MYRIAD siege flavor).
  if (attacker.kind === 'soldier' && attacker.variant === 'siege' && getRace(attackerTeam).id === 'bio' && (target.kind === 'soldier' || target.kind === 'worker')) {
    target.poisonRemaining = Math.max(target.poisonRemaining ?? 0, 4)
    target.poisonDamagePerSecond = Math.max(target.poisonDamagePerSecond ?? 0, 4)
    target.poisonAttackerId = attacker.id
    target.poisonTick = target.poisonTick ?? 0
  }

  // Area damage: splash hits every enemy unit near the impact at reduced power.
  if (attacker.kind === 'soldier' && attacker.splashRadius > 0) {
    const splashDamage = Math.max(1, Math.round(damage * 0.6))

    for (const soldier of soldiers) {
      if (!soldier.alive || soldier.id === target.id || !areHostile(getTeam(soldier), attackerTeam)) continue
      if (distanceToPoint(Transform.get(soldier.entity).position, targetPosition) <= attacker.splashRadius) {
        damageSoldier(soldier, splashDamage, attacker)
      }
    }
    for (const worker of workers) {
      if (!worker.alive || worker.id === target.id || !areHostile(getTeam(worker), attackerTeam)) continue
      if (distanceToPoint(Transform.get(worker.entity).position, targetPosition) <= attacker.splashRadius) {
        damageWorker(worker, splashDamage, attacker)
      }
    }
  }
}

function applyCombatDamage(target: Building | Soldier | Worker, amount: number, attacker: Soldier | Worker): void {
  if (target.kind === 'soldier') {
    damageSoldier(target, amount, attacker)
    return
  }

  if (target.kind === 'worker') {
    damageWorker(target, amount, attacker)
    return
  }

  damageBuilding(target, amount, attacker)
}

function damageBuilding(building: Building, amount: number, attacker?: Soldier | Worker): void {
  building.hp = Math.max(0, building.hp - amount)
  if (attacker && isPlayerTempleUnderAttack(building, attacker)) {
    showPlayerAttackAlert()
  }
  if (attacker) alertDefenders(building, attacker)

  if (building.hp > 0) {
    if (building.kind === 'enemyBuilding') playAnimation(building.entity, 'impact')
    if (!isPlayerTempleUnderAttack(building, attacker)) setStatus(`${building.name} HP: ${building.hp}/${building.maxHp}.`)
    return
  }

  if (building.kind === 'enemyBuilding') playAnimation(building.entity, 'die')
  spawnDeathBurst(cloneVector(Transform.get(building.entity).position), getRace(getTeam(building)).accent, 3)
  playExplosion(Transform.get(building.entity).position)
  removeSelectable(building)
  removeBuilding(building)
  clearAttackersTargeting(building.id)

  setStatus(`${building.name} destroyed.`)
  updateMatchEndState()
}

/** Multiplayer surrender: broadcast the concession, then fall on your sword locally. */
export function surrenderMatch(): void {
  if (!isMatchActive() || !isMultiplayerMatch()) return
  if (isRelayActive()) broadcastMyCommand({ type: 'surrender' })
  setStatus('You surrendered the match.')
  eliminateTeam('player', false)
}

// Leaver handling: if a human player disappears from the scene mid-match,
// every remaining client hands their team to a local computer so the match
// can be finished instead of fighting a frozen ghost army.
let leaverCheckTimer = 0

function updateLeaverTakeover(dt: number): void {
  if (!multiplayerPlan) return
  leaverCheckTimer += dt
  if (leaverCheckTimer < 2) return
  leaverCheckTimer = 0

  for (const team of multiplayerPlan.humanTeams.slice()) {
    if (team === 'player') continue
    const address = multiplayerPlan.addresses[team]
    if (!address || isPlayerPresent(address)) continue

    multiplayerPlan.humanTeams = multiplayerPlan.humanTeams.filter((humanTeam) => humanTeam !== team)
    enemyAis.push(createEnemyAi(team as EnemyTeam, 'medium'))
    announceMatchEvent(`${getMultiplayerTeamName(team) ?? 'A commander'} left the match. A computer took over their forces.`)
  }
}

/** Wipe a team from the field: units die, buildings collapse, elimination check runs. */
function eliminateTeam(team: Team, surrendered: boolean): void {
  if (surrendered) announceMatchEvent(`${getTeamDisplayName(team)} surrendered!`)
  for (const soldier of soldiers) {
    if (soldier.alive && getTeam(soldier) === team) damageSoldier(soldier, soldier.hp)
  }
  for (const worker of workers) {
    if (worker.alive && getTeam(worker) === team) damageWorker(worker, worker.hp)
  }
  for (const building of [...buildings]) {
    if (building.alive && getTeam(building) === team) damageBuilding(building, building.hp)
  }
  updateMatchEndState()
}

function isPlayerTempleUnderAttack(building: Building, attacker?: Soldier | Worker): boolean {
  return building.kind === 'temple' && getTeam(building) === 'player' && attacker !== undefined && isHostileToPlayer(getTeam(attacker))
}

function showPlayerAttackAlert(): void {
  playUnderAttackAlert()
  gameState.attackAlert = 'Your HQ is under attack!'
  gameState.attackAlertTimer = PLAYER_ATTACK_ALERT_DURATION
  setStatus(gameState.attackAlert)
}

function damageSoldier(soldier: Soldier, amount: number, attacker?: Soldier | Worker): void {
  soldier.hp = Math.max(0, soldier.hp - amount)

  if (soldier.hp > 0) {
    if (attacker?.alive && shouldRetaliate(soldier)) {
      assignSoldierToAttack(soldier, attacker, 0, false)
    }
    return
  }

  creditUnitKill(attacker, soldier)
  const deathScale =
    soldier.variant === 'hero' ? 2.6 : soldier.variant === 'titan' ? 2.2 : soldier.variant === 'siege' ? 1.6 : soldier.variant === 'flyer' || soldier.variant === 'caster' ? 1.2 : 1
  spawnDeathBurst(cloneVector(Transform.get(soldier.entity).position), getRace(getTeam(soldier)).accent, deathScale)
  playExplosion(Transform.get(soldier.entity).position)
  if (soldier.variant === 'hero') {
    setStatus(getTeam(soldier) === 'player' ? `${soldier.name} has fallen! Heroes do not return.` : `${soldier.name} has been slain.`)
  }
  soldier.state = 'dead'
  soldier.targetId = undefined
  soldier.attackPosition = undefined
  soldier.rallyPoint = undefined
  addSupplyUsed(getTeam(soldier), -getSoldierDefinition(getTeam(soldier), soldier.variant).supply)
  removeSelectable(soldier)
  clearAttackersTargeting(soldier.id)
}

/**
 * Idle victims always fight back. Units busy hitting a building turn on the unit
 * shooting them; units already fighting another unit stay locked on. Move orders
 * (movingToRally) are never interrupted.
 */
function shouldRetaliate(victim: Soldier): boolean {
  if (victim.state === 'idle') return true
  if (victim.state !== 'movingToAttack' && victim.state !== 'attacking') return false

  const currentTarget = victim.targetId ? getCombatTargetById(victim.targetId) : undefined
  return !currentTarget || (currentTarget.kind !== 'soldier' && currentTarget.kind !== 'worker')
}

function damageWorker(worker: Worker, amount: number, attacker?: Soldier | Worker): void {
  worker.hp = Math.max(0, worker.hp - amount)

  if (worker.hp > 0) return

  creditUnitKill(attacker, worker)
  spawnDeathBurst(cloneVector(Transform.get(worker.entity).position), getRace(getTeam(worker)).accent, 0.8)
  playExplosion(Transform.get(worker.entity).position)

  worker.state = 'dead'
  worker.targetResourceId = undefined
  worker.buildSiteId = undefined
  worker.repairTargetId = undefined
  worker.attackTargetId = undefined
  worker.rallyPoint = undefined
  worker.carrying = 0
  worker.carryingResource = undefined
  addSupplyUsed(getTeam(worker), -1)
  removeSelectable(worker)
  clearAttackersTargeting(worker.id)
}

function creditUnitKill(attacker: Soldier | Worker | undefined, target: Soldier | Worker): void {
  if (!attacker || getTeam(attacker) === getTeam(target)) return

  gameState.matchStats[getTeam(attacker)].unitsKilled += 1
  attacker.kills = (attacker.kills ?? 0) + 1
}

// ---------------------------------------------------------------------------
// Caster signature abilities: one auto-cast skill per race, fired as part of
// the normal attack whenever the cooldown is ready.
//   Stormcaller (human) - Chain Lightning: the bolt arcs to extra targets.
//   Riftweaver (alien)  - Time Fracture: nearby enemies move at half speed.
//   Plague Weaver (bio) - Spore Plague: nearby enemies take poison over time.
// ---------------------------------------------------------------------------

const CASTER_ABILITY = {
  human: { name: 'Chain Lightning', cooldown: 8, describe: 'Chain Lightning: every 8s the bolt arcs to 3 extra enemies.' },
  alien: { name: 'Time Fracture', cooldown: 10, describe: 'Time Fracture: every 10s nearby enemies move at half speed for 3s.' },
  bio: { name: 'Spore Plague', cooldown: 9, describe: 'Spore Plague: every 9s poisons nearby enemies for 4/s over 5s.' }
} as const

const CHAIN_LIGHTNING_ARC_RANGE = 7
const CHAIN_LIGHTNING_MAX_ARCS = 3
const TIME_FRACTURE_RADIUS = 5
const TIME_FRACTURE_DURATION = 3
const SPORE_PLAGUE_RADIUS = 5
const SPORE_PLAGUE_DURATION = 5
const SPORE_PLAGUE_DPS = 4

/** Hostile units (not buildings) within `radius` of a point, nearest first. */
function getHostileUnitsNear(position: Vector3, radius: number, attackerTeam: Team, excludeId: string): (Soldier | Worker)[] {
  const hits: { unit: Soldier | Worker; distance: number }[] = []
  for (const unit of [...soldiers, ...workers]) {
    if (!unit.alive || unit.id === excludeId || !areHostile(getTeam(unit), attackerTeam)) continue
    const distance = distanceToPoint(Transform.get(unit.entity).position, position)
    if (distance <= radius) hits.push({ unit, distance })
  }
  return hits.sort((a, b) => a.distance - b.distance).map((hit) => hit.unit)
}

function castCasterAbility(caster: Soldier, target: Building | Soldier | Worker, targetPosition: Vector3): void {
  const team = getTeam(caster)
  const race = getRace(team).id
  const ability = CASTER_ABILITY[race]
  caster.abilityTimer = ability.cooldown
  const accent = getRace(team).accent

  if (race === 'human') {
    // Chain Lightning: arc from the impact point to the nearest extra enemies.
    const arcs = getHostileUnitsNear(targetPosition, CHAIN_LIGHTNING_ARC_RANGE, team, target.id).slice(0, CHAIN_LIGHTNING_MAX_ARCS)
    const arcDamage = Math.max(1, Math.round(caster.damage * getDamageMultiplier(team, caster.variant) * 0.7))
    for (const unit of arcs) {
      const unitPosition = cloneVector(Transform.get(unit.entity).position)
      fireProjectile(targetPosition, unitPosition, team)
      spawnImpactFlash(unitPosition, accent)
      if (unit.kind === 'soldier') damageSoldier(unit, arcDamage, caster)
      else damageWorker(unit, arcDamage, caster)
    }
    return
  }

  if (race === 'alien') {
    // Time Fracture: soldiers caught in the rift move at half speed.
    spawnBlastRing(targetPosition, accent, TIME_FRACTURE_RADIUS)
    for (const unit of getHostileUnitsNear(targetPosition, TIME_FRACTURE_RADIUS, team, '')) {
      if (unit.kind === 'soldier') (unit as Soldier).slowRemaining = TIME_FRACTURE_DURATION
    }
    return
  }

  // Spore Plague: poison everything near the impact; refreshes on re-application.
  spawnBlastRing(targetPosition, Color4.create(0.45, 0.9, 0.3, 1), SPORE_PLAGUE_RADIUS)
  for (const unit of getHostileUnitsNear(targetPosition, SPORE_PLAGUE_RADIUS, team, '')) {
    unit.poisonRemaining = SPORE_PLAGUE_DURATION
    unit.poisonDamagePerSecond = SPORE_PLAGUE_DPS
    unit.poisonAttackerId = caster.id
    unit.poisonTick = unit.poisonTick ?? 0
  }
}

// ---------------------------------------------------------------------------
// Hero active abilities: one signature button per hero on a long cooldown,
// cast from the command card (and relayed in multiplayer).
//   Warmaster Kael (human) - Rally Cry: heals nearby allied fighters.
//   Riftlord Auren (alien) - Rift Nova: damages every enemy around him.
//   Broodmother Szel (bio)  - Birth Surge: instantly births free Maulers.
// ---------------------------------------------------------------------------

export const HERO_ABILITY = {
  human: { name: 'Rally Cry', cooldown: 45, describe: 'Heals allied fighters within 10m of Kael for 60 HP.' },
  alien: { name: 'Rift Nova', cooldown: 45, describe: 'Deals 45 damage to every enemy within 8m of Auren.' },
  bio: { name: 'Birth Surge', cooldown: 60, describe: 'Szel instantly births 3 free Maulers (supply permitting).' }
} as const

const RALLY_CRY_RADIUS = 10
const RALLY_CRY_HEAL = 60
const RIFT_NOVA_RADIUS = 8
const RIFT_NOVA_DAMAGE = 45
const BIRTH_SURGE_COUNT = 3
const HEAL_FLASH_COLOR = Color4.create(0.4, 1, 0.55, 1)

export type HeroAbilityStatus = {
  name: string
  description: string
  cooldownRemaining: number
  cooldownTotal: number
}

/** The lone selected player hero, if any - drives the ability button on the command card. */
export function getSelectedHeroAbility(): HeroAbilityStatus | undefined {
  const hero = getSelectedSoldiers().find((soldier) => soldier.alive && soldier.variant === 'hero' && getTeam(soldier) === 'player')
  if (!hero) return undefined

  const ability = HERO_ABILITY[getRace('player').id]
  return {
    name: ability.name,
    description: ability.describe,
    cooldownRemaining: Math.max(0, hero.heroAbilityCooldown ?? 0),
    cooldownTotal: ability.cooldown
  }
}

export function castSelectedHeroAbility(): void {
  if (!isMatchActive()) return
  const hero = getSelectedSoldiers().find((soldier) => soldier.alive && soldier.variant === 'hero' && getTeam(soldier) === 'player')
  if (!hero) return

  const ability = HERO_ABILITY[getRace('player').id]
  if ((hero.heroAbilityCooldown ?? 0) > 0) {
    setStatus(`${ability.name} ready in ${Math.ceil(hero.heroAbilityCooldown ?? 0)}s.`)
    return
  }

  castHeroAbility(hero, true)
  if (isRelayActive()) broadcastMyCommand({ type: 'heroAbility', unitId: hero.id })
}

function castHeroAbility(hero: Soldier, announce: boolean): void {
  if (!hero.alive || hero.variant !== 'hero' || (hero.heroAbilityCooldown ?? 0) > 0) return

  const team = getTeam(hero)
  const race = getRace(team).id
  const ability = HERO_ABILITY[race]
  hero.heroAbilityCooldown = ability.cooldown
  const origin = cloneVector(Transform.get(hero.entity).position)

  if (race === 'human') {
    spawnBlastRing(origin, HEAL_FLASH_COLOR, RALLY_CRY_RADIUS)
    let healed = 0
    for (const unit of soldiers) {
      if (!unit.alive || getTeam(unit) !== team || unit.id === hero.id || unit.hp >= unit.maxHp) continue
      if (distanceToPoint(Transform.get(unit.entity).position, origin) > RALLY_CRY_RADIUS) continue
      unit.hp = Math.min(unit.maxHp, unit.hp + RALLY_CRY_HEAL)
      spawnImpactFlash(cloneVector(Transform.get(unit.entity).position), HEAL_FLASH_COLOR)
      healed += 1
    }
    if (announce) setStatus(`${ability.name}: healed ${healed} fighter${healed === 1 ? '' : 's'}.`)
    return
  }

  if (race === 'alien') {
    spawnBlastRing(origin, getRace(team).accent, RIFT_NOVA_RADIUS)
    const hits = getHostileUnitsNear(origin, RIFT_NOVA_RADIUS, team, hero.id)
    for (const unit of hits) {
      spawnImpactFlash(cloneVector(Transform.get(unit.entity).position), getRace(team).accent)
      if (unit.kind === 'soldier') damageSoldier(unit, RIFT_NOVA_DAMAGE, hero)
      else damageWorker(unit, RIFT_NOVA_DAMAGE, hero)
    }
    if (announce) setStatus(`${ability.name}: hit ${hits.length} enem${hits.length === 1 ? 'y' : 'ies'}.`)
    return
  }

  // Bio - Birth Surge: free Maulers pop out around Szel, supply permitting.
  const meleeDef = getSoldierDefinition(team, 'melee')
  let spawned = 0
  for (let i = 0; i < BIRTH_SURGE_COUNT; i++) {
    if (getSupplyUsed(team) + meleeDef.supply > getSupplyCap(team)) break
    const angle = (i / BIRTH_SURGE_COUNT) * Math.PI * 2
    const spawn = createSoldier(Vector3.create(origin.x + Math.cos(angle) * 1.8, 0.25, origin.z + Math.sin(angle) * 1.8), team, 'melee')
    soldiers.push(spawn)
    addSupplyUsed(team, meleeDef.supply)
    gameState.matchStats[team].unitsProduced += 1
    spawned += 1
  }
  spawnBlastRing(origin, Color4.create(0.45, 0.9, 0.3, 1), 4)
  if (announce) setStatus(spawned > 0 ? `${ability.name}: ${spawned} free ${meleeDef.name}${spawned === 1 ? '' : 's'} birthed.` : `${ability.name}: no supply for new broodlings.`)
}

// ---------------------------------------------------------------------------
// Fireplace utility: the cheap camp building does something different per race.
//   Beacon (human)      - signal fire: huge vision radius (handled in fogOfWar).
//   Obelisk (alien)     - haste aura: nearby allied units move +25% faster.
//   Spore Mound (bio)   - spore field: nearby hostiles take light poison.
// ---------------------------------------------------------------------------

const FIREPLACE_AURA_INTERVAL = 0.5
const OBELISK_HASTE_RADIUS = 9
const SPORE_MOUND_RADIUS = 8
const SPORE_MOUND_DPS = 3
const SPORE_MOUND_DURATION = 2.5

let fireplaceAuraTimer = 0

function updateFireplaceAuras(dt: number): void {
  fireplaceAuraTimer += dt
  if (fireplaceAuraTimer < FIREPLACE_AURA_INTERVAL) return
  fireplaceAuraTimer = 0

  for (const fireplace of buildings) {
    if (!fireplace.alive || !fireplace.isComplete || fireplace.kind !== 'fireplace') continue

    const team = getTeam(fireplace)
    const race = getRace(team).id
    if (race === 'human') continue // Beacon vision is applied by the fog system.

    const origin = Transform.get(fireplace.entity).position

    if (race === 'alien') {
      // Refresh the haste window; it expires shortly after leaving the aura.
      for (const unit of [...soldiers, ...workers]) {
        if (!unit.alive || getTeam(unit) !== team) continue
        if (distanceToPoint(Transform.get(unit.entity).position, origin) > OBELISK_HASTE_RADIUS) continue
        unit.hasteRemaining = FIREPLACE_AURA_INTERVAL + 0.5
      }
      continue
    }

    // Bio: creeping spores poison whatever hostile stands near the mound.
    for (const unit of getHostileUnitsNear(cloneVector(origin), SPORE_MOUND_RADIUS, team, fireplace.id)) {
      unit.poisonRemaining = Math.max(unit.poisonRemaining ?? 0, SPORE_MOUND_DURATION)
      unit.poisonDamagePerSecond = Math.max(unit.poisonDamagePerSecond ?? 0, SPORE_MOUND_DPS)
      unit.poisonTick = unit.poisonTick ?? 0
    }
  }
}

/** Ticks ability cooldowns, slow durations, and poison damage-over-time. */
function updateStatusEffects(dt: number): void {
  for (const soldier of soldiers) {
    if (!soldier.alive) continue
    if (soldier.abilityTimer !== undefined && soldier.abilityTimer > 0) soldier.abilityTimer -= dt
    if (soldier.heroAbilityCooldown !== undefined && soldier.heroAbilityCooldown > 0) soldier.heroAbilityCooldown -= dt
    if (soldier.slowRemaining !== undefined && soldier.slowRemaining > 0) soldier.slowRemaining -= dt
    if (soldier.hasteRemaining !== undefined && soldier.hasteRemaining > 0) soldier.hasteRemaining -= dt
    tickPoison(soldier, dt)
  }
  for (const worker of workers) {
    if (!worker.alive) continue
    if (worker.hasteRemaining !== undefined && worker.hasteRemaining > 0) worker.hasteRemaining -= dt
    tickPoison(worker, dt)
  }
}

function tickPoison(unit: Soldier | Worker, dt: number): void {
  if (!unit.poisonRemaining || unit.poisonRemaining <= 0) return

  unit.poisonRemaining -= dt
  unit.poisonTick = (unit.poisonTick ?? 0) + dt
  if (unit.poisonTick < 1) return
  unit.poisonTick -= 1

  // Kill credit goes to the caster if they're still on the field.
  const attacker = unit.poisonAttackerId ? getCombatTargetById(unit.poisonAttackerId) : undefined
  const credit = attacker && (attacker.kind === 'soldier' || attacker.kind === 'worker') ? attacker : undefined
  spawnImpactFlash(cloneVector(Transform.get(unit.entity).position), Color4.create(0.45, 0.9, 0.3, 1))
  if (unit.kind === 'soldier') damageSoldier(unit, unit.poisonDamagePerSecond ?? 0, credit)
  else damageWorker(unit, unit.poisonDamagePerSecond ?? 0, credit)
}

function clearAttackersTargeting(targetId: string): void {
  for (const attacker of soldiers) {
    if (attacker.targetId !== targetId) continue

    attacker.targetId = undefined
    attacker.attackPosition = undefined
    attacker.state = 'idle'
    setSoldierAnimation(attacker, 'idle')
  }
}

function alertDefenders(building: Building, attacker: Soldier | Worker): void {
  // Any computer rallies nearby idle soldiers when a hostile hits its buildings
  // (the player's own defense stays manual - that's the game).
  const buildingTeam = getTeam(building)
  if (!isEnemyTeam(buildingTeam) || !attacker.alive || !areHostile(buildingTeam, getTeam(attacker))) return

  const buildingPosition = Transform.get(building.entity).position
  const defenders = soldiers.filter((soldier) => {
    if (!soldier.alive || getTeam(soldier) !== buildingTeam) return false
    if (soldier.state !== 'idle' && soldier.state !== 'movingToRally') return false
    return distanceToPoint(Transform.get(soldier.entity).position, buildingPosition) <= ENEMY_DEFENSE_RADIUS
  })

  for (let i = 0; i < defenders.length; i++) {
    assignSoldierToAttack(defenders[i], attacker, i)
  }
}

function cancelConstruction(site: Building): void {
  if (!isCancellableConstruction(site)) return

  const definition = BUILDING_DEFINITIONS[site.kind]
  const refundedCost = getConstructionRefund(definition.cost, site.constructionProgress)
  const builder = site.builderWorkerId ? getWorkerById(site.builderWorkerId) : undefined

  addResources(getTeam(site), refundedCost)
  if (builder?.alive && builder.buildSiteId === site.id) {
    builder.state = 'idle'
    builder.buildSiteId = undefined
    setWorkerAnimation(builder, 'idle')
  }

  removeSelectable(site)
  removeBuilding(site)
  setStatus(`Cancelled ${definition.name}. Refunded ${formatCost(refundedCost)}.`)
}

function updateConstructionVisual(site: Building): void {
  if (!isBuildableKind(site.kind)) return

  const definition = BUILDING_DEFINITIONS[site.kind]
  const progress = site.isComplete ? 1 : Math.max(0.05, site.constructionProgress)
  const transform = Transform.getMutable(site.entity)

  if (isProceduralBuilding(site.entity)) {
    // Parts are children of a ground-level root, so squashing the root's Y grows the model out of the ground.
    transform.position = Vector3.create(transform.position.x, 0, transform.position.z)
    transform.scale = Vector3.create(1, progress, 1)
  } else {
    transform.position = Vector3.create(transform.position.x, definition.placementY * progress, transform.position.z)
    transform.scale = Vector3.create(definition.scale.x, definition.scale.y * progress, definition.scale.z)
  }

  if (MeshRenderer.has(site.entity)) {
    Material.setPbrMaterial(site.entity, {
      albedoColor: site.isComplete ? definition.color : COLORS.construction,
      emissiveColor: site.isComplete ? Color4.create(definition.color.r * 0.25, definition.color.g * 0.25, definition.color.b * 0.25, 1) : Color4.Black()
    })
  }

  if (!site.isComplete) {
    updateLabel(site, `${definition.name}\n${Math.floor(site.constructionProgress * 100)}%`)
  }
}

function isBuildableKind(kind: Building['kind']): kind is BuildableKind {
  return kind === 'temple' || kind === 'supplyHouse' || kind === 'barracks' || kind === 'techLab' || kind === 'forge' || kind === 'airForge' || kind === 'fireplace' || kind === 'turret'
}

function isCancellableConstruction(selectable: Selectable | undefined): selectable is Building & { kind: BuildableKind } {
  return !!selectable && isBuildableKind(selectable.kind as Building['kind']) && !(selectable as Building).isComplete
}

function getSelected(): Selectable | undefined {
  return gameState.selectedId ? selectables.get(gameState.selectedId) : undefined
}

function getSelectedUnits(): (Worker | Soldier)[] {
  const units: (Worker | Soldier)[] = []
  for (const id of gameState.selectedUnitIds) {
    const selectable = selectables.get(id)
    if (selectable?.alive && (selectable.kind === 'worker' || selectable.kind === 'soldier')) {
      units.push(selectable as Worker | Soldier)
    }
  }
  return units
}

function getSelectedWorkers(): Worker[] {
  return getSelectedUnits().filter((unit): unit is Worker => unit.kind === 'worker')
}

function getSelectedSoldiers(): Soldier[] {
  return getSelectedUnits().filter((unit): unit is Soldier => unit.kind === 'soldier')
}

function setUnitSelection(units: (Worker | Soldier)[]): void {
  gameState.selectedUnitIds = units.map((unit) => unit.id)
  gameState.selectedId = units[0]?.id ?? ''
  gameState.selectedKind = units[0]?.kind ?? ''
}

function getWorkerById(id: string): Worker | undefined {
  return workers.find((worker) => worker.id === id)
}

function getAvailableWorkers(): Worker[] {
  return getAvailableWorkersForTeam('player')
}

function getIdleWorkers(): Worker[] {
  return workers.filter((worker) => worker.alive && worker.state === 'idle' && getTeam(worker) === 'player')
}

function getAvailableSoldiers(): Soldier[] {
  return soldiers.filter((soldier) => soldier.alive && getTeam(soldier) === 'player')
}

function getCommandableSoldiers(): Soldier[] {
  return getSelectedSoldiers()
}

function isEnemyAttackTarget(selectable: Selectable): selectable is Building | Soldier | Worker {
  return selectable.kind !== 'resource' && isHostileToPlayer(getTeam(selectable))
}

/** Anything the armed repair order accepts: damaged friendly buildings, plus damaged mech fighters for humans. */
/** The Vanguard's machines: the units a repair crew can actually weld back together. */
function isMechSoldier(worker: Worker, soldier: Soldier): boolean {
  return getRace(getTeam(worker)).id === 'human' && (soldier.variant === 'flyer' || soldier.variant === 'titan')
}

function isPlayerRepairableTarget(selectable: Selectable): selectable is Building | Soldier {
  if (isPlayerRepairTarget(selectable)) return true
  if (selectable.kind !== 'soldier') return false
  const soldier = selectable as Soldier

  return getTeam(soldier) === 'player' && getRace('player').id === 'human' && (soldier.variant === 'flyer' || soldier.variant === 'titan') && soldier.hp < soldier.maxHp
}

function isPlayerRepairTarget(selectable: Selectable): selectable is Building {
  if (selectable.kind === 'resource' || selectable.kind === 'worker' || selectable.kind === 'soldier') return false
  const building = selectable as Building

  return getTeam(building) === 'player' && building.isComplete && building.hp < building.maxHp
}

function getBuildingById(id: string): Building | undefined {
  return buildings.find((building) => building.id === id)
}

function getCombatTargetById(id: string): Building | Soldier | Worker | undefined {
  return getBuildingById(id) ?? soldiers.find((soldier) => soldier.id === id) ?? workers.find((worker) => worker.id === id)
}

function getSelectedAdjustableBuilding(): Building | undefined {
  const selected = getSelected()

  return selected?.kind === 'temple' || selected?.kind === 'supplyHouse' || selected?.kind === 'barracks' || selected?.kind === 'fireplace' ? (selected as Building) : undefined
}

function getSelectedRallyPoint(): Vector3 | undefined {
  const selected = getSelected()

  if (selected?.kind === 'temple') return templeRallyPoints.get(selected.id)
  if (selected?.kind === 'barracks' || selected?.kind === 'techLab') return barracksRallyPoints.get(selected.id)
  return undefined
}

function getStartingTemple(): Building | undefined {
  return buildings.find((building) => building.kind === 'temple' && building.alive && getTeam(building) === 'player')
}

function getBuildingDetail(building: Building): string {
  if (!building.isComplete) {
    const progress = Math.floor(building.constructionProgress * 100)
    return building.constructionState === 'paused' ? `Construction paused: needs worker (${progress}%)` : `Building: ${progress}%`
  }

  if (building.kind === 'temple') {
    const templePosition = Transform.get(building.entity).position
    const templeName = getBuildingDisplayName('temple', getTeam(building))
    if (isEnemyTeam(getTeam(building))) return `${teamNamePrefix(getTeam(building))}${templeName}: AI headquarters. Location ${formatPosition(templePosition)}.`
    const rallyPoint = templeRallyPoints.get(building.id)
    const base = `${templeName}: trains workers, receives resources, +${BUILDING_DEFINITIONS.temple.supplyAdds} supply.`
    return rallyPoint ? `${base} Spawn ${formatPosition(rallyPoint)}.` : `${base} Location ${formatPosition(templePosition)}.`
  }
  if (building.kind === 'supplyHouse') {
    const supplyName = getBuildingDisplayName('supplyHouse', getTeam(building))
    return `${supplyName}: raises the supply cap by ${BUILDING_DEFINITIONS.supplyHouse.supplyAdds}.`
  }
  if (building.kind === 'barracks') {
    const rallyPoint = barracksRallyPoints.get(building.id)
    const race = getRace(getTeam(building))
    const soldierNames = `${race.melee.name}s and ${race.ranged.name}s`
    return rallyPoint ? `Complete: creates ${soldierNames}. Spawn ${formatPosition(rallyPoint)}.` : `Complete: creates ${soldierNames}`
  }
  if (building.kind === 'techLab') {
    const rallyPoint = barracksRallyPoints.get(building.id)
    const race = getRace(getTeam(building))
    const advancedNames = `${race.caster.name}s, ${race.flyer.name}s and ${race.titan.name}s`
    return rallyPoint ? `Complete: creates ${advancedNames}. Spawn ${formatPosition(rallyPoint)}.` : `Complete: creates ${advancedNames}`
  }
  if (building.kind === 'forge') {
    const damageLevel = getUpgradeLevel(getTeam(building), 'damage')
    const speedLevel = getUpgradeLevel(getTeam(building), 'speed')
    return `Complete: researches ground upgrades. Weapons Lv${damageLevel}, Propulsion Lv${speedLevel}.`
  }
  if (building.kind === 'airForge') {
    const damageLevel = getUpgradeLevel(getTeam(building), 'airDamage')
    const speedLevel = getUpgradeLevel(getTeam(building), 'airSpeed')
    return `Complete: researches flyer upgrades. Flight Weapons Lv${damageLevel}, Flight Propulsion Lv${speedLevel}.`
  }
  if (building.kind === 'turret') return `Automated defense: fires on hostile units within ${TURRET_STATS.range}m.`
  if (building.kind === 'fireplace') {
    const raceId = getRace(getTeam(building)).id
    if (raceId === 'human') return 'Signal fire: lights up a huge area of the map.'
    if (raceId === 'alien') return `Haste aura: allied units within ${OBELISK_HASTE_RADIUS}m move +25% faster.`
    return `Spore field: hostiles within ${SPORE_MOUND_RADIUS}m take ${SPORE_MOUND_DPS}/s poison.`
  }
  if (building.kind === 'enemyBuilding') return 'Enemy structure'

  return 'Complete'
}

function getPlacementInstruction(): string {
  if (placementState.state !== 'placing') return ''

  return `Placing ${getBuildingDisplayName(placementState.buildingKind, 'player')}. Click ground to place.`
}

function getHoverText(selectable: Selectable): string {
  if (selectable.kind === 'resource') {
    const resource = selectable as ResourceNode
    return resource.resource ? RESOURCE_DEFINITIONS[resource.resource].hoverText : `Select ${selectable.name}`
  }
  // Someone else's forces carry the owner's tag so you know whose army you're poking.
  const owner = getTeamOwnerLabel(getTeam(selectable))
  const ownerTag = owner ? ` [${owner}]` : ''
  if (isHostileToPlayer(getTeam(selectable))) return `Attack ${selectable.name}${ownerTag}`
  return `Select ${selectable.name}${ownerTag}`
}

/** Owner tag for hovers: the human's lobby name in multiplayer, or the CPU difficulty. */
function getTeamOwnerLabel(team: Team): string | undefined {
  if (team === 'player') return undefined
  const humanName = getMultiplayerTeamName(team)
  if (humanName) return humanName
  return `CPU ${AI_DIFFICULTY[gameState.enemyDifficulties[team as EnemyTeam]].label}`
}

function formatCost(cost: ResourceCost): string {
  const parts = []

  if (cost.minerals) parts.push(`${cost.minerals} crystal`)
  if (cost.gas) parts.push(`${cost.gas} plasma`)
  return parts.length > 0 ? parts.join(', ') : '0 resources'
}

function depleteResourceNode(resource: ResourceNode): void {
  resource.amount = 0
  if (resource.resource === 'gas') {
    resource.alive = false
    resource.depletionTimer = DEPLETED_GAS_HIDE_DELAY
    removeSelectableInteractivity(resource)
    playResourceDepletion(resource.entity)
    selectables.delete(resource.id)
    setStatus(`${resource.name} is depleted.`)
    return
  }

  removeSelectable(resource)

  setStatus(`${resource.name} is depleted and disappeared.`)
}

function setWorkerAnimation(worker: Worker, clipName: string, restart = false): void {
  if (worker.activeAnimation === clipName && !restart) return

  if (isProceduralUnit(worker.entity)) setUnitAnimation(worker.entity, clipName)
  else playAnimation(worker.entity, clipName)
  worker.activeAnimation = clipName
}

function setSoldierAnimation(soldier: Soldier, clipName: string, restart = false): void {
  if (soldier.activeAnimation === clipName && !restart) return

  if (isProceduralUnit(soldier.entity)) setUnitAnimation(soldier.entity, clipName)
  else playAnimation(soldier.entity, clipName)
  soldier.activeAnimation = clipName
}

function playAnimation(entity: Entity, clipName: string): void {
  Animator.playSingleAnimation(entity, clipName, true)
}

function playResourceGatherFeedback(resource: ResourceNode): void {
  playResourceGatherPulse(resource.entity)

  const audio = AudioSource.getMutableOrNull(resource.entity)
  if (!audio) return

  audio.playing = false
  audio.playing = true
}

function updateLabel(selectable: Selectable, text: string): void {
  if (!selectable.labelEntity) return

  TextShape.getMutable(selectable.labelEntity).text = text
}

function setStatus(message: string): void {
  gameState.status = message
  gameState.statusTimer = STATUS_MESSAGE_DURATION
}

function updateFootprintMaterial(entity: Entity, canPlace: boolean): void {
  const color = canPlace ? BUILDING_FOOTPRINT_VALID : BUILDING_FOOTPRINT_BLOCKED
  Material.setPbrMaterial(entity, {
    albedoColor: color,
    emissiveColor: canPlace ? Color4.create(0.04, 0.22, 0.08, 1) : Color4.create(0.22, 0.02, 0.02, 1),
    transparencyMode: 1
  })
}

function getPlayerPosition(): Vector3 | undefined {
  if (!Transform.has(engine.PlayerEntity)) return undefined

  return Transform.get(engine.PlayerEntity).position
}

function getBuildingPreviewPosition(definition: BuildingDefinition): Vector3 | undefined {
  const pointerGroundPosition = getPointerGroundPosition()
  if (pointerGroundPosition) return pointerGroundPosition

  // Free-camera mode: fall back to the center of the view instead of the parked avatar.
  if (isTopDownViewActive()) {
    const focus = getCameraFocus()
    return getSnappedPlacementPosition(Vector3.create(focus.x, 0, focus.z))
  }

  if (!Transform.has(engine.PlayerEntity)) return undefined

  const playerTransform = Transform.get(engine.PlayerEntity)
  const rotatedForward = Vector3.rotate(Vector3.Forward(), playerTransform.rotation)
  const length = Math.sqrt(rotatedForward.x * rotatedForward.x + rotatedForward.z * rotatedForward.z)
  const forward = length > 0.001 ? Vector3.create(rotatedForward.x / length, 0, rotatedForward.z / length) : Vector3.Forward()
  const distance = Math.max(definition.scale.x, definition.scale.z) / 2 + BUILDING_PREVIEW_PADDING

  return getSnappedPlacementPosition(Vector3.create(playerTransform.position.x + forward.x * distance, 0, playerTransform.position.z + forward.z * distance))
}

function getPointerGroundPosition(): Vector3 | undefined {
  const pointerInfo = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const cameraTransform = Transform.getOrNull(engine.CameraEntity)
  const direction = pointerInfo?.worldRayDirection

  if (!direction || !cameraTransform) return undefined
  if (Math.abs(direction.y) < 0.001) return undefined

  const distanceToGround = (0 - cameraTransform.position.y) / direction.y
  if (distanceToGround < 0) return undefined

  return getSnappedPlacementPosition(
    Vector3.create(
      cameraTransform.position.x + direction.x * distanceToGround,
      0,
      cameraTransform.position.z + direction.z * distanceToGround
    )
  )
}

/** The cursor's ground point (grid-snapped) is used directly as the building center, RTS style. */
function getCurrentBuildingPlacement(definition: BuildingDefinition): { center: Vector3; rotationY: number } | undefined {
  const center = getBuildingPreviewPosition(definition)
  if (!center) return undefined

  return { center, rotationY: currentBuildingPreviewRotationY }
}

function getSnappedPlacementPosition(position: Vector3): Vector3 {
  return Vector3.create(snapToGrid(position.x), 0, snapToGrid(position.z))
}

function snapToGrid(value: number): number {
  return Math.round(value / BUILDING_PLACEMENT_GRID_SIZE) * BUILDING_PLACEMENT_GRID_SIZE
}

function canPlaceBuildingAt(definition: BuildingDefinition, position: Vector3): boolean {
  const footprintHalfSize = Math.max(definition.scale.x, definition.scale.z) / 2
  const footprintRadius = footprintHalfSize + BUILDING_PLACEMENT_PADDING

  if (!isPlacementInsideMap(position, footprintHalfSize)) return false

  for (const building of buildings) {
    if (!building.alive) continue
    if (distanceToPoint(Transform.get(building.entity).position, position) < footprintRadius + Math.max(Transform.get(building.entity).scale.x, Transform.get(building.entity).scale.z) / 2) {
      return false
    }
  }

  for (const resource of resources) {
    if (!resource.alive) continue
    if (distanceToPoint(Transform.get(resource.entity).position, position) < footprintRadius + 0.8) return false
  }

  for (const worker of workers) {
    if (!worker.alive) continue
    if (distanceToPoint(Transform.get(worker.entity).position, position) < footprintRadius + 0.35) return false
  }

  for (const soldier of soldiers) {
    if (!soldier.alive) continue
    if (distanceToPoint(Transform.get(soldier.entity).position, position) < footprintRadius + 0.45) return false
  }

  return true
}

function isPlacementInsideMap(position: Vector3, footprintRadius: number): boolean {
  return (
    position.x - footprintRadius >= 0 &&
    position.z - footprintRadius >= 0 &&
    position.x + footprintRadius <= SCENE.size &&
    position.z + footprintRadius <= SCENE.size
  )
}

function printResourcePlacementLists(): void {
  const minerals = gameState.savedMineralLocations.map((location) => `  ${location}`).join(',\n')
  const gas = gameState.savedGasLocations.map((location) => `  ${location}`).join(',\n')
  const temple = getStartingTemple()
  const templeLocation = temple ? formatVectorForPaste(Transform.get(temple.entity).position) : 'undefined'

  console.log(`Saved RTS resource locations:\nconst templeLocation = ${templeLocation}\n\nconst mineralLocations = [\n${minerals}\n]\n\nconst gasLocations = [\n${gas}\n]`)
}

function printBuildingTransform(building: Building): void {
  const transform = Transform.get(building.entity)

  console.log(
    `Saved RTS building transform:\nconst selectedBuildingTransform = {\n  kind: '${building.kind}',\n  name: '${building.name}',\n  position: ${formatVectorForPaste(transform.position)},\n  scale: ${formatVectorForPaste(transform.scale)}\n}`
  )
}

function getSavedResourceLocations(resource: ResourceKind): string[] {
  return resource === 'gas' ? gameState.savedGasLocations : gameState.savedMineralLocations
}

function getWorkerGatherPosition(worker: Worker, resource: ResourceNode): Vector3 {
  const resourcePosition = Transform.get(resource.entity).position
  const targetWorkers = workers.filter((otherWorker) => otherWorker.alive && otherWorker.targetResourceId === resource.id)
  const slot = Math.max(0, targetWorkers.findIndex((targetWorker) => targetWorker.id === worker.id))
  // Geysers are wide mounds, so miners work them from further out.
  const radius = resource.resource === 'gas' ? 1.7 : 1.1

  return getFormationPosition(resourcePosition, slot, radius)
}

function getWorkerRallyPosition(worker: Worker): Vector3 {
  if (!worker.rallyPoint) return Transform.get(worker.entity).position

  const slot = Math.max(0, workers.filter((otherWorker) => otherWorker.alive).findIndex((targetWorker) => targetWorker.id === worker.id))
  return getFormationPosition(worker.rallyPoint, slot, 0.75)
}

function getNearestTemple(position: Vector3, team: Team): Building | undefined {
  let nearestTemple: Building | undefined
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const temple of buildings) {
    if (temple.kind !== 'temple' || !temple.alive || !temple.isComplete || getTeam(temple) !== team) continue

    const distance = distanceToPoint(Transform.get(temple.entity).position, position)
    if (distance < nearestDistance) {
      nearestTemple = temple
      nearestDistance = distance
    }
  }

  return nearestTemple
}

function getTempleDropoffPosition(temple: Building, worker: Worker): Vector3 {
  const templePosition = Transform.get(temple.entity).position
  const workerPosition = Transform.get(worker.entity).position
  const radius = Math.max(MODEL_TRANSFORMS.hq.colliderScale.x, MODEL_TRANSFORMS.hq.colliderScale.z) / 2 + 0.75
  const dx = workerPosition.x - templePosition.x
  const dz = workerPosition.z - templePosition.z
  const length = Math.sqrt(dx * dx + dz * dz)
  const direction = length > 0.001 ? Vector3.create(dx / length, 0, dz / length) : Vector3.Backward()

  return Vector3.create(templePosition.x + direction.x * radius, 0.25, templePosition.z + direction.z * radius)
}

function getBarracksExitPosition(barracks: Building, index: number): Vector3 {
  const transform = Transform.get(barracks.entity)
  const exitDistance = Math.max(transform.scale.x, transform.scale.z) * 0.55 + 1
  const exitPosition = Vector3.create(transform.position.x, 0.25, transform.position.z + exitDistance)

  return offsetSpawn(exitPosition, index)
}

function getTempleExitPosition(temple: Building, index: number): Vector3 {
  const transform = Transform.get(temple.entity)
  // The temple's collider is roughly twice its transform scale, so push new
  // workers out past it instead of spawning them inside the model.
  const exitDistance = Math.max(MODEL_TRANSFORMS.hq.colliderScale.x, MODEL_TRANSFORMS.hq.colliderScale.z) * 0.55 + 1
  const exitPosition = Vector3.create(transform.position.x, 0.25, transform.position.z + exitDistance)

  return offsetSpawn(exitPosition, index)
}

function getBuilderWorkPosition(site: Building, workerPosition: Vector3): Vector3 {
  const siteTransform = Transform.get(site.entity)
  const definition = isBuildableKind(site.kind) ? BUILDING_DEFINITIONS[site.kind] : undefined
  const footprintRadius = Math.max(definition?.scale.x ?? siteTransform.scale.x, definition?.scale.z ?? siteTransform.scale.z) / 2
  const stopDistance = footprintRadius + 0.75
  const dx = workerPosition.x - siteTransform.position.x
  const dz = workerPosition.z - siteTransform.position.z
  const length = Math.sqrt(dx * dx + dz * dz)
  const direction = length > 0.001 ? Vector3.create(dx / length, 0, dz / length) : Vector3.Backward()

  return Vector3.create(siteTransform.position.x + direction.x * stopDistance, 0.25, siteTransform.position.z + direction.z * stopDistance)
}

function getSoldierAttackPosition(target: Building, slot: number, attacker?: Soldier): Vector3 {
  const targetTransform = Transform.get(target.entity)
  const definition = isBuildableKind(target.kind) ? BUILDING_DEFINITIONS[target.kind] : undefined
  const modelRadius = Math.max(targetTransform.scale.x, targetTransform.scale.z) * 0.5
  const footprintRadius = definition ? Math.max(definition.scale.x, definition.scale.z) * 0.5 : modelRadius
  const buildingPadding = target.kind === 'temple' ? TEMPLE_ATTACK_DISTANCE_PADDING : 1
  // Ranged units stand off at their attack range; melee closes to the footprint edge.
  const attackerRange = attacker?.attackRange ?? CONFIG.soldierAttackRange
  const attackRadius = Math.max(footprintRadius + buildingPadding + Math.max(attackerRange - CONFIG.soldierAttackRange, 0), footprintRadius + SOLDIER_ATTACK_SPACING + buildingPadding)
  const position = getApproachSidePosition(targetTransform.position, attacker ? Transform.get(attacker.entity).position : undefined, slot, attackRadius)

  return Vector3.create(position.x, 0.25, position.z)
}

/**
 * Ring position on the attacker's side of the target, so units stop where they
 * approach from instead of marching past (or through) the target to a fixed slot.
 * Slots fan out left/right of the approach line; every 6 slots start a wider ring.
 */
function getApproachSidePosition(center: Vector3, attackerPosition: Vector3 | undefined, slot: number, radius: number): Vector3 {
  if (!attackerPosition) return getFormationPosition(center, slot, radius)

  const dx = attackerPosition.x - center.x
  const dz = attackerPosition.z - center.z
  const baseAngle = dx * dx + dz * dz > 0.001 ? Math.atan2(dz, dx) : slot * 2.399963229728653
  const fan = Math.ceil(slot / 2) * 0.45 * (slot % 2 === 0 ? -1 : 1)
  const ringRadius = radius + Math.floor(slot / 6) * 0.45
  const angle = baseAngle + fan

  return Vector3.create(center.x + Math.cos(angle) * ringRadius, center.y, center.z + Math.sin(angle) * ringRadius)
}

function removeSelectable(selectable: Selectable): void {
  selectable.alive = false
  removeSelectableInteractivity(selectable)
  // Procedural model parts follow the hidden root, so only the registries need unregistering.
  disposeUnit(selectable.entity, false)
  disposeResourceModel(selectable.entity, false)
  disposeBuildingModel(selectable.entity, false)
  removeBuildingBeacon(selectable)
  hideEntity(selectable.entity)
  if (selectable.labelEntity) hideEntity(selectable.labelEntity)
  selectables.delete(selectable.id)

  gameState.selectedUnitIds = gameState.selectedUnitIds.filter((id) => id !== selectable.id)
  if (gameState.selectedId === selectable.id) {
    const nextSelected = gameState.selectedUnitIds[0] ? selectables.get(gameState.selectedUnitIds[0]) : undefined
    gameState.selectedId = nextSelected?.id ?? ''
    gameState.selectedKind = nextSelected?.kind ?? ''
    clearSelectionMarkers()
  }
}

function destroySelectable(selectable: Selectable): void {
  selectable.alive = false
  removeSelectableInteractivity(selectable)
  disposeUnit(selectable.entity, true)
  disposeResourceModel(selectable.entity, true)
  disposeBuildingModel(selectable.entity, true)
  removeBuildingBeacon(selectable)
  if (selectable.labelEntity) engine.removeEntity(selectable.labelEntity)
  engine.removeEntity(selectable.entity)
  selectables.delete(selectable.id)
}

function removeBuilding(building: Building): void {
  clearBuildingDamageVfx(building)
  const index = buildings.findIndex((candidate) => candidate.id === building.id)
  if (index >= 0) buildings.splice(index, 1)
}

function removeSelectableInteractivity(selectable: Selectable): void {
  const pointerTarget = selectable.colliderEntity ?? selectable.entity

  pointerEventsSystem.removeOnPointerDown(pointerTarget)
  MeshCollider.deleteFrom(pointerTarget)
  if (selectable.colliderEntity) {
    pointerEventsSystem.removeOnPointerDown(selectable.entity)
    engine.removeEntity(selectable.colliderEntity)
  }
  GltfContainer.deleteFrom(selectable.entity)
  MeshRenderer.deleteFrom(selectable.entity)
}

// Test hook: the headless harness (scripts/headless-test.js) sets __RTS_TEST__
// before main() runs so simulations can spawn units and inspect state directly.
// Never set in the real client, so this stays inert in production.
if ((globalThis as unknown as { __RTS_TEST__?: boolean }).__RTS_TEST__) {
  ;(globalThis as unknown as Record<string, unknown>).__rtsTest = {
    gameState,
    buildings,
    soldiers,
    workers,
    selectables,
    createSoldier,
    createWorker,
    createBuilding,
    assignSoldierToAttack,
    damageCombatTarget,
    getUpgradeLevel,
    startUpgradeResearchOrder,
    startRtsMatch,
    queueSoldier,
    startUpgradeResearch,
    setStatus,
    hasCompletedBuilding,
    isBuildingUnlocked,
    isUnitUnlocked,
    startWorkerBuildingPlacement
  }
}

