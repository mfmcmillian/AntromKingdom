import { Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { buildUnitModel, disposeUnit } from './unitModels'
import type { RaceId } from './types'

// 3D hero showcase for the match-setup screen: the selected race's actual
// procedural hero model hangs in front of the camera on a slow turntable,
// framed by the transparent middle of the setup UI.

const SHOWCASE_DISTANCE = 3.4
const SHOWCASE_HEIGHT = -1.15
const SHOWCASE_SCALE = 0.42
const SPIN_DEGREES_PER_SECOND = 28

let showcaseRoot: Entity | undefined
let modelRoot: Entity | undefined
let activeRace: RaceId | undefined
let spinAngle = 0

/** Idempotent: re-calling with the same race keeps the current model. */
export function showHeroShowcase(race: RaceId): void {
  if (activeRace === race && showcaseRoot !== undefined) return
  hideHeroShowcase()

  // Camera-parented so the model stays centered no matter where the player looks.
  showcaseRoot = engine.addEntity()
  Transform.create(showcaseRoot, {
    parent: engine.CameraEntity,
    position: Vector3.create(0, SHOWCASE_HEIGHT, SHOWCASE_DISTANCE),
    scale: Vector3.create(SHOWCASE_SCALE, SHOWCASE_SCALE, SHOWCASE_SCALE)
  })

  modelRoot = engine.addEntity()
  Transform.create(modelRoot, { parent: showcaseRoot, rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  buildUnitModel(modelRoot, race, 'hero', 'player')
  activeRace = race
}

export function hideHeroShowcase(): void {
  if (modelRoot !== undefined) {
    disposeUnit(modelRoot, true)
    engine.removeEntity(modelRoot)
  }
  if (showcaseRoot !== undefined) engine.removeEntity(showcaseRoot)
  modelRoot = undefined
  showcaseRoot = undefined
  activeRace = undefined
}

// Turntable: spin the model slowly so every side gets seen (180 = facing camera).
engine.addSystem((dt: number) => {
  if (modelRoot === undefined) return
  spinAngle = (spinAngle + dt * SPIN_DEGREES_PER_SECOND) % 360
  Transform.getMutable(modelRoot).rotation = Quaternion.fromEulerDegrees(0, 180 + spinAngle, 0)
})
