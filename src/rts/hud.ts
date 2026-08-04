import { PrimaryPointerInfo, UiCanvasInformation, engine } from '@dcl/sdk/ecs'

// Screen regions owned by the HUD, in the UI's virtual resolution. World input
// (unit selection, move commands, placement clicks, drag select) checks this so
// pressing a UI button never doubles as a command to the units behind it.

export const VIRTUAL_WIDTH = 1920
export const VIRTUAL_HEIGHT = 1080
/** Height of the StarCraft-style bottom console bar. Keep in sync with ui.tsx. */
export const CONSOLE_HEIGHT = 250

export function isPointerOverHud(): boolean {
  const info = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const coordinates = info?.screenCoordinates
  if (!coordinates || !canvas || canvas.width === 0 || canvas.height === 0) return false

  const x = coordinates.x * (VIRTUAL_WIDTH / canvas.width)
  const yFromTop = (canvas.height - coordinates.y) * (VIRTUAL_HEIGHT / canvas.height)

  // Bottom console bar (info panel, command card, minimap).
  if (yFromTop >= VIRTUAL_HEIGHT - CONSOLE_HEIGHT) return true
  // Minimap frame and idle-worker button rising above the console (bottom-right).
  if (x >= VIRTUAL_WIDTH - 300 && yFromTop >= VIRTUAL_HEIGHT - 370) return true
  // Control group slots above the command card.
  if (x >= VIRTUAL_WIDTH - 560 && x <= VIRTUAL_WIDTH - 260 && yFromTop >= VIRTUAL_HEIGHT - CONSOLE_HEIGHT - 60) return true
  // Top-right resource bar.
  if (yFromTop <= 64 && x >= VIRTUAL_WIDTH - 560) return true
  // Top-left menu button.
  if (yFromTop <= 64 && x <= 140) return true

  return false
}
