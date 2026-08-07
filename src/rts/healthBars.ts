import { Billboard, Entity, Material, MeshRenderer, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { BUILDING_MODEL_HEIGHTS } from './buildingModels'
import { isPositionVisibleToPlayer } from './fogOfWar'
import { isHostileToPlayer } from './state'
import type { Building, Selectable, Soldier, Worker } from './types'
import { buildings, getTeam, soldiers, workers } from './world'

// ---------------------------------------------------------------------------
// World-space health bars: a billboarded bar floats over any damaged unit or
// building and disappears again at full HP - StarCraft-style info on demand.
// ---------------------------------------------------------------------------

const BAR_HEIGHT = 0.16
const BACK_COLOR = Color4.create(0.08, 0.08, 0.1, 1)
const HIGH_COLOR = Color4.create(0.2, 0.9, 0.3, 1)
const MID_COLOR = Color4.create(0.95, 0.75, 0.15, 1)
const LOW_COLOR = Color4.create(0.95, 0.25, 0.15, 1)

// The fill and the dark remainder sit side by side at the SAME depth instead
// of stacked planes: billboards flip their z toward or away from the camera
// depending on the explorer, and a stacked fill can end up hidden behind the
// backing plane (bars rendered all-black). Side-by-side can't be occluded.
type BarEntry = { root: Entity; fill: Entity; rest: Entity; lastRatio: number; lastColor: Color4 }

const bars = new Map<string, BarEntry>()
const seenThisPass = new Set<string>()

export function updateHealthBars(): void {
  seenThisPass.clear()

  for (const soldier of soldiers) trackBar(soldier, unitBarWidth(soldier), unitBarHeight(soldier))
  for (const worker of workers) trackBar(worker, 1.1, 2.3)
  for (const building of buildings) {
    const modelHeight = BUILDING_MODEL_HEIGHTS[building.kind as keyof typeof BUILDING_MODEL_HEIGHTS] ?? 6
    trackBar(building, 2.6, modelHeight + 0.8)
  }

  // Anything that died or healed to full since last pass loses its bar.
  for (const [id, entry] of bars) {
    if (seenThisPass.has(id)) continue
    engine.removeEntity(entry.root)
    bars.delete(id)
  }
}

/** Match teardown: sweep every remaining bar off the field. */
export function clearHealthBars(): void {
  for (const entry of bars.values()) engine.removeEntity(entry.root)
  bars.clear()
}

function trackBar(target: Building | Soldier | Worker, width: number, height: number): void {
  if (!target.alive || target.hp >= target.maxHp || target.hp <= 0) return
  // Hostiles hidden by the fog must not leak their position through a bar.
  const position = Transform.get(target.entity).position
  if (isHostileToPlayer(getTeam(target as Selectable)) && !isPositionVisibleToPlayer(position)) return

  seenThisPass.add(target.id)
  const entry = bars.get(target.id) ?? createBar(target.id, width)
  bars.set(target.id, entry)

  Transform.getMutable(entry.root).position = Vector3.create(position.x, position.y + height, position.z)

  const ratio = Math.max(0.02, target.hp / target.maxHp)
  if (Math.abs(ratio - entry.lastRatio) > 0.005) {
    entry.lastRatio = ratio

    const fillTransform = Transform.getMutable(entry.fill)
    fillTransform.scale = Vector3.create(width * ratio, BAR_HEIGHT, 1)
    fillTransform.position = Vector3.create(-width / 2 + (width * ratio) / 2, 0, 0)

    const restWidth = Math.max(0.001, width * (1 - ratio))
    const restTransform = Transform.getMutable(entry.rest)
    restTransform.scale = Vector3.create(restWidth, BAR_HEIGHT, 1)
    restTransform.position = Vector3.create(width / 2 - restWidth / 2, 0, 0)

    const color = ratio > 0.5 ? HIGH_COLOR : ratio > 0.25 ? MID_COLOR : LOW_COLOR
    if (color !== entry.lastColor) {
      entry.lastColor = color
      Material.setBasicMaterial(entry.fill, { diffuseColor: color })
    }
  }
}

function createBar(id: string, width: number): BarEntry {
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.Zero() })
  Billboard.create(root)

  const fill = engine.addEntity()
  Transform.create(fill, { parent: root, position: Vector3.create(0, 0, 0), scale: Vector3.create(width, BAR_HEIGHT, 1) })
  MeshRenderer.setPlane(fill)
  Material.setBasicMaterial(fill, { diffuseColor: HIGH_COLOR })

  const rest = engine.addEntity()
  Transform.create(rest, { parent: root, position: Vector3.create(width / 2, 0, 0), scale: Vector3.create(0.001, BAR_HEIGHT, 1) })
  MeshRenderer.setPlane(rest)
  Material.setBasicMaterial(rest, { diffuseColor: BACK_COLOR })

  return { root, fill, rest, lastRatio: -1, lastColor: BACK_COLOR }
}

function unitBarWidth(soldier: Soldier): number {
  if (soldier.variant === 'hero') return 2.2
  if (soldier.variant === 'titan' || soldier.variant === 'heavyAir') return 2
  if (soldier.variant === 'siege') return 1.6
  return 1.3
}

function unitBarHeight(soldier: Soldier): number {
  switch (soldier.variant) {
    case 'hero':
      return 4.4
    case 'titan':
      return 4.8
    case 'flyer':
      return 4.6
    case 'heavyAir':
      return 5.4
    case 'caster':
      return 3
    case 'siege':
      return 3
    default:
      return 2.6
  }
}
