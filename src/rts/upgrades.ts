import type { ResourceCost, SoldierVariant, Team, UpgradeKind, UpgradeResearch } from './types'

// Team-wide combat upgrades, split by domain:
//   damage / speed       - ground fighters, researched at the forge.
//   airDamage / airSpeed - flyers, researched at the air forge.
// Levels apply at use time (attack tick / movement tick), so upgrades affect
// every unit already on the field the moment research completes.

export const UPGRADE_MAX_LEVEL = 3

export const UPGRADE_KINDS: UpgradeKind[] = ['damage', 'speed', 'airDamage', 'airSpeed']

export const UPGRADE_INFO: Record<UpgradeKind, { name: string; effect: string }> = {
  damage: { name: 'Weapons', effect: '+20% ground damage per level' },
  speed: { name: 'Propulsion', effect: '+10% ground speed per level' },
  airDamage: { name: 'Flight Weapons', effect: '+20% flyer damage per level' },
  airSpeed: { name: 'Flight Propulsion', effect: '+10% flyer speed per level' }
}

const UPGRADE_COSTS: Record<UpgradeKind, ResourceCost[]> = {
  damage: [
    { minerals: 100, gas: 50 },
    { minerals: 175, gas: 100 },
    { minerals: 250, gas: 175 }
  ],
  speed: [
    { minerals: 75, gas: 50 },
    { minerals: 150, gas: 100 },
    { minerals: 225, gas: 150 }
  ],
  // Air tracks cost slightly less: they only affect one unit type.
  airDamage: [
    { minerals: 100, gas: 75 },
    { minerals: 150, gas: 125 },
    { minerals: 200, gas: 175 }
  ],
  airSpeed: [
    { minerals: 75, gas: 50 },
    { minerals: 125, gas: 100 },
    { minerals: 175, gas: 150 }
  ]
}

const RESEARCH_TIMES = [15, 22, 30]

function createLevels(): Record<UpgradeKind, number> {
  return { damage: 0, speed: 0, airDamage: 0, airSpeed: 0 }
}

const levels: Record<Team, Record<UpgradeKind, number>> = {
  player: createLevels(),
  enemy1: createLevels(),
  enemy2: createLevels(),
  enemy3: createLevels(),
  enemy4: createLevels(),
  enemy5: createLevels()
}

export const upgradeResearchQueue: UpgradeResearch[] = []

export function resetUpgrades(): void {
  for (const team of Object.keys(levels) as Team[]) {
    for (const kind of UPGRADE_KINDS) levels[team][kind] = 0
  }
  upgradeResearchQueue.length = 0
}

export function getUpgradeLevel(team: Team, kind: UpgradeKind): number {
  return levels[team][kind]
}

/** Which weapons/engine tracks apply to a unit: flyers use the air tracks. */
export function getUpgradeKindsFor(variant: SoldierVariant): { damage: UpgradeKind; speed: UpgradeKind } {
  return variant === 'flyer' ? { damage: 'airDamage', speed: 'airSpeed' } : { damage: 'damage', speed: 'speed' }
}

export function getDamageMultiplier(team: Team, variant: SoldierVariant): number {
  return 1 + levels[team][getUpgradeKindsFor(variant).damage] * 0.2
}

export function getSpeedMultiplier(team: Team, variant: SoldierVariant): number {
  return 1 + levels[team][getUpgradeKindsFor(variant).speed] * 0.1
}

/** Cost of the next level, or undefined when maxed. */
export function getNextUpgradeCost(team: Team, kind: UpgradeKind): ResourceCost | undefined {
  const level = levels[team][kind]
  return level >= UPGRADE_MAX_LEVEL ? undefined : UPGRADE_COSTS[kind][level]
}

export function getNextUpgradeResearchTime(team: Team, kind: UpgradeKind): number {
  return RESEARCH_TIMES[Math.min(levels[team][kind], RESEARCH_TIMES.length - 1)]
}

export function isUpgradeInProgress(team: Team, kind: UpgradeKind): boolean {
  return upgradeResearchQueue.some((research) => research.team === team && research.kind === kind)
}

export function startUpgradeResearchOrder(team: Team, kind: UpgradeKind, forgeId: string): void {
  upgradeResearchQueue.push({
    team,
    kind,
    forgeId,
    timer: 0,
    researchTime: getNextUpgradeResearchTime(team, kind)
  })
}

export type UpgradeSystemDeps = {
  isForgeAlive(forgeId: string): boolean
  onUpgradeComplete(team: Team, kind: UpgradeKind, newLevel: number): void
}

export function updateUpgradeResearch(dt: number, deps: UpgradeSystemDeps): void {
  for (let i = upgradeResearchQueue.length - 1; i >= 0; i--) {
    const research = upgradeResearchQueue[i]

    if (!deps.isForgeAlive(research.forgeId)) {
      upgradeResearchQueue.splice(i, 1)
      continue
    }

    research.timer += dt
    if (research.timer < research.researchTime) continue

    upgradeResearchQueue.splice(i, 1)
    if (levels[research.team][research.kind] >= UPGRADE_MAX_LEVEL) continue

    levels[research.team][research.kind] += 1
    deps.onUpgradeComplete(research.team, research.kind, levels[research.team][research.kind])
  }
}

/** Research progress 0..1 for UI, or undefined when idle. */
export function getUpgradeProgress(team: Team, kind: UpgradeKind): number | undefined {
  const research = upgradeResearchQueue.find((entry) => entry.team === team && entry.kind === kind)
  return research ? research.timer / research.researchTime : undefined
}
