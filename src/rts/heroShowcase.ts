import { Material, MeshRenderer, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { buildUnitModel, disposeUnit } from './unitModels'
import type { RaceId } from './types'

// 3D hero showcase for the match-setup screen: the selected race's actual
// procedural hero model hangs in front of the camera on a slow turntable.
// Screen-space UI always draws over the 3D world, so the screen "background"
// is a big world-space backdrop plane behind the model (also camera-parented)
// carrying the title artwork - it hides the raw map without hiding the hero.

const SHOWCASE_DISTANCE = 3.4
const SHOWCASE_HEIGHT = -1.15
const SHOWCASE_SCALE = 0.42
const SPIN_DEGREES_PER_SECOND = 28

// Far enough behind the model to leave room, big enough to cover the viewport.
const BACKDROP_DISTANCE = 6.8
const BACKDROP_WIDTH = 21
const BACKDROP_HEIGHT = 12

let showcaseRoot: Entity | undefined
let modelRoot: Entity | undefined
let backdrop: Entity | undefined
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

  backdrop = engine.addEntity()
  Transform.create(backdrop, {
    parent: engine.CameraEntity,
    position: Vector3.create(0, 0, BACKDROP_DISTANCE),
    rotation: Quaternion.fromEulerDegrees(0, 180, 0),
    scale: Vector3.create(BACKDROP_WIDTH, BACKDROP_HEIGHT, 1)
  })
  MeshRenderer.setPlane(backdrop)
  // Unlit so the artwork reads evenly; dimmed a touch so the hero pops off it.
  Material.setBasicMaterial(backdrop, {
    texture: Material.Texture.Common({ src: 'images/ui/title-bg-decentracraft.png' }),
    diffuseColor: Color4.create(0.62, 0.62, 0.68, 1)
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
  if (backdrop !== undefined) engine.removeEntity(backdrop)
  modelRoot = undefined
  showcaseRoot = undefined
  backdrop = undefined
  activeRace = undefined
}

// Turntable: spin the model slowly so every side gets seen (180 = facing camera).
engine.addSystem((dt: number) => {
  if (modelRoot === undefined) return
  spinAngle = (spinAngle + dt * SPIN_DEGREES_PER_SECOND) % 360
  Transform.getMutable(modelRoot).rotation = Quaternion.fromEulerDegrees(0, 180 + spinAngle, 0)
})
