import { InputAction, PrimaryPointerInfo, Transform, UiCanvasInformation, engine, inputSystem } from '@dcl/sdk/ecs'

export type DragSelectDeps = {
  /** Returns true while other click-driven modes own the pointer (placement, move/attack command). */
  isBlocked(): boolean
  onBoxSelect(min: { x: number; z: number }, max: { x: number; z: number }): void
  /** True when the current pointer press started on a clickable object (unit, building, resource). */
  isPressOnSelectable?(): boolean
  /** Fired when a press releases without dragging and without having hit a clickable object. */
  onGroundClick?(point: { x: number; z: number }): void
}

export type DragScreenRect = { left: number; top: number; width: number; height: number }

/** Minimum cursor travel (screen px) before a press counts as a drag instead of a click. */
const DRAG_THRESHOLD_PX = 14

type ScreenPoint = { x: number; y: number }

let pressActive = false
let dragging = false
let pressOnSelectable = false
let startScreen: ScreenPoint = { x: 0, y: 0 }
let currentScreen: ScreenPoint = { x: 0, y: 0 }
let startGround: { x: number; z: number } | null = null

export function updateDragSelect(deps: DragSelectDeps): void {
  if (deps.isBlocked()) {
    resetDragState()
    return
  }

  const pointerPressed = inputSystem.isPressed(InputAction.IA_POINTER)
  const screen = getPointerScreenPosition()

  if (pointerPressed && !pressActive) {
    if (!screen) return
    pressActive = true
    dragging = false
    pressOnSelectable = deps.isPressOnSelectable?.() ?? false
    startScreen = screen
    currentScreen = screen
    startGround = getPointerGroundPoint()
    return
  }

  if (pointerPressed && pressActive) {
    if (!screen) return
    currentScreen = screen
    if (!dragging && startGround) {
      const dx = currentScreen.x - startScreen.x
      const dy = currentScreen.y - startScreen.y
      dragging = dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
    }
    return
  }

  if (!pointerPressed && pressActive) {
    const endGround = getPointerGroundPoint()
    if (dragging && startGround && endGround) {
      deps.onBoxSelect(
        { x: Math.min(startGround.x, endGround.x), z: Math.min(startGround.z, endGround.z) },
        { x: Math.max(startGround.x, endGround.x), z: Math.max(startGround.z, endGround.z) }
      )
    } else if (!dragging && !pressOnSelectable) {
      const point = endGround ?? startGround
      if (point) deps.onGroundClick?.(point)
    }
    resetDragState()
  }
}

/** Rectangle currently being dragged, in UI virtual coordinates. Null when not dragging. */
export function getDragScreenRect(virtualWidth: number, virtualHeight: number): DragScreenRect | null {
  if (!dragging) return null

  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null

  const scaleX = virtualWidth / canvas.width
  const scaleY = virtualHeight / canvas.height

  // Pointer Y is measured from the bottom of the screen; UI "top" from the top.
  const startYFromTop = canvas.height - startScreen.y
  const currentYFromTop = canvas.height - currentScreen.y

  const left = Math.min(startScreen.x, currentScreen.x) * scaleX
  const top = Math.min(startYFromTop, currentYFromTop) * scaleY
  const width = Math.abs(currentScreen.x - startScreen.x) * scaleX
  const height = Math.abs(currentYFromTop - startYFromTop) * scaleY

  return { left, top, width, height }
}

function resetDragState(): void {
  pressActive = false
  dragging = false
  pressOnSelectable = false
  startGround = null
}

function getPointerScreenPosition(): ScreenPoint | null {
  const info = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  if (!info?.screenCoordinates) return null
  return { x: info.screenCoordinates.x, y: info.screenCoordinates.y }
}

/** Intersects the cursor's world ray with the ground plane (y = 0). */
function getPointerGroundPoint(): { x: number; z: number } | null {
  const info = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const cameraTransform = Transform.getOrNull(engine.CameraEntity)
  if (!info?.worldRayDirection || !cameraTransform) return null

  const origin = cameraTransform.position
  const direction = info.worldRayDirection
  if (direction.y >= -0.0001) return null

  const t = -origin.y / direction.y
  return { x: origin.x + direction.x * t, z: origin.z + direction.z * t }
}
