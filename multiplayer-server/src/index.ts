import { Server } from 'colyseus'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { RtsRoom } from './rooms/RtsRoom.js'

const port = Number(process.env.PORT || 2567)
const gameServer = new Server({
  transport: new WebSocketTransport(),
  express: (app) => {
    app.get('/health', (_request: unknown, response: { json(body: unknown): void }) => {
      response.json({ ok: true })
    })
  }
})
gameServer.define('rts_room', RtsRoom)

await gameServer.listen(port)
console.log(`[multiplayer] Colyseus server listening on ws://localhost:${port}`)
