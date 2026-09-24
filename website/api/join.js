// ---------------------------------------------------------------------------
// /api/join — "a player entered the scene" relay to Discord.
//
// The scenes' servers are deployed as public code, so they cannot hold the
// webhook URL themselves (the last one was scraped from GitHub and spammed).
// It lives here in the DISCORD_JOIN_WEBHOOK env var, and this endpoint only
// ever posts one fixed shape: a name, a wallet address and a head count. No
// links, no images, no renaming the poster.
//
//   POST { game: 'decentracraft' | 'antrom', name, address, online }
// ---------------------------------------------------------------------------

const GAMES = {
  decentracraft: { username: 'DecentraCraft', color: 0x3d7eff },
  antrom: { username: 'Dungeons of Antrom', color: 0xc9a227 }
}

/** Per-instance throttle: a wallet is announced at most once every two minutes. */
const recent = new Map()
const COOLDOWN_MS = 120000
/** And the endpoint as a whole will not fire more than this often, whatever it is sent. */
const BURST_WINDOW_MS = 60000
const BURST_LIMIT = 20
let burst = []

function cleanName(raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[`*_~|>@#\[\]()\r\n]/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim()
    .slice(0, 32)
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const webhook = process.env.DISCORD_JOIN_WEBHOOK
  if (!webhook) return res.status(503).json({ error: 'no webhook configured' })

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {}
  const game = GAMES[body.game]
  const address = typeof body.address === 'string' ? body.address.toLowerCase() : ''
  if (!game) return res.status(400).json({ error: 'unknown game' })
  if (!/^0x[0-9a-f]{40}$/.test(address)) return res.status(400).json({ error: 'bad address' })
  const online = Math.max(0, Math.min(999, Math.floor(Number(body.online) || 0)))
  const name = cleanName(body.name) || shortAddress(address)

  const now = Date.now()
  burst = burst.filter((t) => now - t < BURST_WINDOW_MS)
  if (burst.length >= BURST_LIMIT) return res.status(429).json({ error: 'too many' })
  const key = `${body.game}:${address}`
  if (now - (recent.get(key) || 0) < COOLDOWN_MS) return res.status(200).json({ ok: true, skipped: 'cooldown' })
  recent.set(key, now)
  burst.push(now)

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: game.username,
        embeds: [
          {
            title: 'Player entered the scene',
            description: `**${name}**\n\`${address}\``,
            color: game.color,
            footer: { text: `${online} in scene` },
            timestamp: new Date(now).toISOString()
          }
        ]
      })
    })
    if (!response.ok) return res.status(502).json({ error: `discord ${response.status}` })
    return res.status(200).json({ ok: true })
  } catch (error) {
    return res.status(502).json({ error: String(error) })
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
