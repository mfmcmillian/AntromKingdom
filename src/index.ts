import { setupUi } from './ui'
import { initRtsGame } from './rtsGame'
import { initMultiplayerSession } from './rts/multiplayer/session'

export function main() {
  setupUi()
  initRtsGame()
  initMultiplayerSession()
}
