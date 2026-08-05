import { MainCamera, Material, MeshRenderer, Transform, VirtualCamera, engine, type Entity } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { SCENE } from './config'
import { buildUnitModel, disposeUnit, setUnitAnimation, setUnitBodyTilt, setUnitGroundFxVisible } from './unitModels'
import type { RaceId } from './types'

// 3D hero showcase for the match-setup screen. The stage floats in empty air
// high above the map center: a fixed VirtualCamera looks at the hero model
// spinning on a turntable in front of a backdrop plane carrying the title
// artwork. Because the camera is scripted, mouse drag can't move the view -
// the whole shot is locked until the showcase is dismissed.

const CAMERA_HEIGHT = 45
const MODEL_DISTANCE = 3.4
const MODEL_DROP = 1.15
const MODEL_SCALE = 0.42
const SPIN_DEGREES_PER_SECOND = 28

// Far enough behind the model to leave room, big enough to cover the viewport.
const BACKDROP_DISTANCE = 6.8
const BACKDROP_WIDTH = 21
const BACKDROP_HEIGHT = 12

let virtualCam: Entity | undefined
let showcaseRoot: Entity | undefined
let modelRoot: Entity | undefined
let backdrop: Entity | undefined
let activeRace: RaceId | undefined
let spinAngle = 0

/** Idempotent: re-calling with the same race keeps the current model. */
export function showHeroShowcase(race: RaceId): void {
  if (activeRace === race && showcaseRoot !== undefined) return
  hideHeroShowcase()

  // Camera sits south of the stage looking north (+Z, identity rotation).
  const camX = SCENE.center
  const camZ = SCENE.center - BACKDROP_DISTANCE

  virtualCam = engine.addEntity()
  Transform.create(virtualCam, { position: Vector3.create(camX, CAMERA_HEIGHT, camZ) })
  VirtualCamera.create(virtualCam, {
    defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0) }
  })

  showcaseRoot = engine.addEntity()
  Transform.create(showcaseRoot, {
    position: Vector3.create(camX, CAMERA_HEIGHT - MODEL_DROP, camZ + MODEL_DISTANCE),
    scale: Vector3.create(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE)
  })

  backdrop = engine.addEntity()
  Transform.create(backdrop, {
    position: Vector3.create(camX, CAMERA_HEIGHT, camZ + BACKDROP_DISTANCE),
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
  // Battle-ready pose: loop the attack motion (lunge, weapon swing) while
  // the turntable spins - but stand upright; the combat lean-in looks odd
  // on a pedestal.
  setUnitAnimation(modelRoot, 'attack')
  setUnitBodyTilt(modelRoot, 0)
  // The pulsing ground ring doubles as the display pedestal here (it stays
  // hidden on the actual map).
  setUnitGroundFxVisible(modelRoot, true)
  activeRace = race

  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: virtualCam })
}

export function hideHeroShowcase(): void {
  if (virtualCam !== undefined) {
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
    engine.removeEntity(virtualCam)
  }
  if (modelRoot !== undefined) {
    disposeUnit(modelRoot, true)
    engine.removeEntity(modelRoot)
  }
  if (showcaseRoot !== undefined) engine.removeEntity(showcaseRoot)
  if (backdrop !== undefined) engine.removeEntity(backdrop)
  virtualCam = undefined
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
