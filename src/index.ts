import { isServer } from '@dcl/sdk/network'

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
