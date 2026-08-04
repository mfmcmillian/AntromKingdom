import {
  AvatarModifierArea,
  AvatarModifierType,
  Entity,
  InputAction,
  InputModifier,
  MainCamera,
  PrimaryPointerInfo,
  Transform,
  UiCanvasInformation,
  VirtualCamera,
  engine,
  inputSystem
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { SCENE } from './config'

const TOP_DOWN_HEIGHT = 26
// Near-vertical RTS pitch. The camera no longer drives avatar movement, so it can look
// almost straight down; the slight tilt keeps some 3D depth on buildings and units.
const TOP_DOWN_PITCH_DEGREES = 80
// Distance behind the focus point so the focus lands at the center of the screen.
const TOP_DOWN_BACK_OFFSET = TOP_DOWN_HEIGHT / Math.tan((TOP_DOWN_PITCH_DEGREES * Math.PI) / 180)
/** WASD camera pan speed in meters per second. */
const PAN_SPEED = 26
/** Pan speed when the cursor pushes against a screen edge. */
const EDGE_SCROLL_SPEED = 22
/** Cursor distance from a screen edge (physical pixels) that triggers edge scrolling. */
const EDGE_SCROLL_MARGIN = 10
/** Keep the camera focus this far inside the map bounds. */
const FOCUS_CLAMP_MARGIN = 6

let topDownCameraEntity: Entity | null = null
let hideAvatarEntity: Entity | null = null
let topDownActive = false
// Ground point at the center of the view. This is "the camera" as far as the game is concerned.
const focus = { x: SCENE.center, z: SCENE.center }

export function isTopDownViewActive(): boolean {
  return topDownActive
}

/** Ground point the RTS camera is looking at. Valid while the top-down view is active. */
export function getCameraFocus(): { x: number; z: number } {
  return focus
}

/** Instantly move the RTS camera to look at a world position (minimap jumps). */
export function setCameraFocus(x: number, z: number): void {
  focus.x = clamp(x, FOCUS_CLAMP_MARGIN, SCENE.size - FOCUS_CLAMP_MARGIN)
  focus.z = clamp(z, FOCUS_CLAMP_MARGIN, SCENE.size - FOCUS_CLAMP_MARGIN)
  applyFocusToCamera()
}

export function toggleTopDownView(): void {
  if (topDownActive) {
    disableTopDownView()
  } else {
    enableTopDownView()
  }
}

export function enableTopDownView(): void {
  if (topDownActive) return

  // Start the view where the avatar is standing.
  const playerTransform = Transform.getOrNull(engine.PlayerEntity)
  const start = playerTransform ? playerTransform.position : Vector3.create(SCENE.center, 0, SCENE.center)
  focus.x = clamp(start.x, FOCUS_CLAMP_MARGIN, SCENE.size - FOCUS_CLAMP_MARGIN)
  focus.z = clamp(start.z, FOCUS_CLAMP_MARGIN, SCENE.size - FOCUS_CLAMP_MARGIN)

  const cameraEntity = getOrCreateTopDownCamera()
  Transform.getMutable(cameraEntity).position = getCameraPositionForFocus()
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: cameraEntity })

  // The camera is free-flying now: freeze the avatar and hide it.
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({ disableAll: true })
  })
  createAvatarHideArea()

  topDownActive = true
}

export function disableTopDownView(): void {
  if (!topDownActive) return

  topDownActive = false
  const mainCamera = MainCamera.getMutableOrNull(engine.CameraEntity)
  if (mainCamera) mainCamera.virtualCameraEntity = undefined

  InputModifier.deleteFrom(engine.PlayerEntity)
  removeAvatarHideArea()
}

function getOrCreateTopDownCamera(): Entity {
  if (topDownCameraEntity) return topDownCameraEntity

  topDownCameraEntity = engine.addEntity()
  Transform.create(topDownCameraEntity, {
    position: getCameraPositionForFocus(),
    rotation: Quaternion.fromEulerDegrees(TOP_DOWN_PITCH_DEGREES, 0, 0)
  })
  VirtualCamera.create(topDownCameraEntity, {
    defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.6) }
  })
  return topDownCameraEntity
}

function createAvatarHideArea(): void {
  if (hideAvatarEntity) return

  hideAvatarEntity = engine.addEntity()
  Transform.create(hideAvatarEntity, {
    position: Vector3.create(SCENE.center, 0, SCENE.center)
  })
  AvatarModifierArea.create(hideAvatarEntity, {
    area: Vector3.create(SCENE.size, 80, SCENE.size),
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS],
    excludeIds: []
  })
}

function removeAvatarHideArea(): void {
  if (!hideAvatarEntity) return

  engine.removeEntity(hideAvatarEntity)
  hideAvatarEntity = null
}

function getCameraPositionForFocus(): Vector3 {
  return Vector3.create(focus.x, TOP_DOWN_HEIGHT, focus.z - TOP_DOWN_BACK_OFFSET)
}

function applyFocusToCamera(): void {
  if (!topDownCameraEntity) return
  Transform.getMutable(topDownCameraEntity).position = getCameraPositionForFocus()
}

function freeCameraSystem(dt: number): void {
  if (!topDownActive || !topDownCameraEntity) return

  let moveX = 0
  let moveZ = 0

  if (inputSystem.isPressed(InputAction.IA_FORWARD)) moveZ += 1
  if (inputSystem.isPressed(InputAction.IA_BACKWARD)) moveZ -= 1
  if (inputSystem.isPressed(InputAction.IA_LEFT)) moveX -= 1
  if (inputSystem.isPressed(InputAction.IA_RIGHT)) moveX += 1

  let speed = PAN_SPEED
  if (moveX === 0 && moveZ === 0) {
    const edge = getEdgeScrollDirection()
    moveX = edge.x
    moveZ = edge.z
    speed = EDGE_SCROLL_SPEED
  }

  if (moveX === 0 && moveZ === 0) return

  // Keep diagonal panning at the same speed as straight panning.
  const scale = moveX !== 0 && moveZ !== 0 ? Math.SQRT1_2 : 1
  focus.x = clamp(focus.x + moveX * speed * scale * dt, FOCUS_CLAMP_MARGIN, SCENE.size - FOCUS_CLAMP_MARGIN)
  focus.z = clamp(focus.z + moveZ * speed * scale * dt, FOCUS_CLAMP_MARGIN, SCENE.size - FOCUS_CLAMP_MARGIN)
  applyFocusToCamera()
}

function getEdgeScrollDirection(): { x: number; z: number } {
  const info = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const coordinates = info?.screenCoordinates

  if (!coordinates || !canvas || canvas.width === 0 || canvas.height === 0) return { x: 0, z: 0 }
  // Ignore the uninitialized (0,0) pointer state before the cursor first moves.
  if (coordinates.x === 0 && coordinates.y === 0) return { x: 0, z: 0 }

  let x = 0
  let z = 0
  if (coordinates.x <= EDGE_SCROLL_MARGIN) x -= 1
  if (coordinates.x >= canvas.width - EDGE_SCROLL_MARGIN) x += 1
  // Pointer Y is measured from the bottom of the screen.
  if (coordinates.y <= EDGE_SCROLL_MARGIN) z -= 1
  if (coordinates.y >= canvas.height - EDGE_SCROLL_MARGIN) z += 1

  return { x, z }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

engine.addSystem(freeCameraSystem)
