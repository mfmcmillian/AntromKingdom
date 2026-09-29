// ---------------------------------------------------------------------------
// /api/metrics — the day counters behind the metrics dashboard (metrics.html).
//
//   POST  (from a game's server)  — body { game, version, updated, days: [...] }
//                                   with the METRICS_KEY in x-metrics-key.
//   GET   ?game=antrom            — the last stored summary for that game.
//
// The summary carries no addresses: one row of counters per UTC day (players,
// sessions, funnel, runs, raid, economy). Stored in the same Upstash Redis
// the ladder uses, one key per game, with an in-memory fallback for testing.
// Writes need the key; reads are open, the dashboard is meant to be shown.
// ---------------------------------------------------------------------------

const GAMES = new Set(['antrom', 'decentracraft'])
const MAX_DAYS = 400
const MAX_BODY_BYTES = 2_000_000

const memory = new Map()

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url, token } : null
}

async function redisGet(config, key) {
  const response = await fetch(`${config.url}/get/${key}`, { headers: { Authorization: `Bearer ${config.token}` } })
  const data = await response.json()
  return data.result ? JSON.parse(data.result) : null
}

async function redisSet(config, key, value) {
  const response = await fetch(`${config.url}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
  if (!response.ok) throw new Error(`redis set failed: HTTP ${response.status}`)
  const data = await response.json()
  if (data.error) throw new Error(`redis set failed: ${data.error}`)
}

function cleanGame(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return GAMES.has(value) ? value : ''
}

/** Only rows shaped like a day get through, newest last, capped. */
function cleanDays(raw) {
  if (!Array.isArray(raw)) return null
  const rows = raw.filter((d) => d && typeof d === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(d.day))
  rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return rows.slice(-MAX_DAYS)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-metrics-key')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const redis = redisConfig()

  if (req.method === 'GET') {
    const game = cleanGame(req.query.game) || 'antrom'
    const key = `metrics-${game}`
    try {
      const stored = redis ? await redisGet(redis, key) : memory.get(key)
      if (!stored) return res.status(404).json({ error: 'nothing stored yet for this game' })
      res.setHeader('Cache-Control', 'public, max-age=60')
      return res.status(200).json(stored)
    } catch (error) {
      return res.status(502).json({ error: 'storage read failed' })
    }
  }

  if (req.method === 'POST') {
    const requiredKey = process.env.METRICS_KEY
    if (!requiredKey) return res.status(503).json({ error: 'METRICS_KEY is not set on the site' })
    const provided = req.headers['x-metrics-key']
    if (provided !== requiredKey) return res.status(401).json({ error: 'bad key' })

    const body = req.body
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'expected a JSON body' })
    if (JSON.stringify(body).length > MAX_BODY_BYTES) return res.status(413).json({ error: 'too large' })
    const game = cleanGame(body.game)
    const days = cleanDays(body.days)
    if (!game || !days) return res.status(400).json({ error: 'expected { game, days: [...] }' })
    const stored = {
      game,
      version: typeof body.version === 'string' ? body.version.slice(0, 20) : '',
      updated: Number.isFinite(body.updated) ? body.updated : Date.now(),
      received: Date.now(),
      days
    }
    const key = `metrics-${game}`
    try {
      memory.set(key, stored)
      if (redis) await redisSet(redis, key, stored)
      return res.status(200).json({ ok: true, days: days.length })
    } catch (error) {
      return res.status(502).json({ error: 'storage write failed' })
    }
  }

  return res.status(405).json({ error: 'method not allowed' })
}
