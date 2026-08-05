import { isServer } from '@dcl/sdk/network'
// Synced components and room messages must register during initial module
// evaluation - the engine seals component definitions before main() runs.
// The transport module therefore loads statically on both server and client.
import './rts/multiplayer/transport'

export async function main() {
  if (isServer()) {
    // Headless authoritative server: owns the multiplayer lobby and relays
    // validated match commands. No rendering, UI or camera code loads here.
    const { startServer } = await import('./server/main')
    startServer()
    return
  }

  const { setupUi } = await import('./ui')
  const { initRtsGame } = await import('./rtsGame')
  const { initMultiplayerSession } = await import('./rts/multiplayer/session')
  setupUi()
  initRtsGame()
  initMultiplayerSession()
}
