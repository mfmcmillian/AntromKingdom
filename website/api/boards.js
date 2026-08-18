// ---------------------------------------------------------------------------
// /api/boards — Vercel serverless function that stores and serves the
// campaign + skirmish leaderboards, connecting the DecentraCraft game
// server to the website.
//
//   POST  (from the game server) — body is { campaign, skirmish, updated }.
//   GET   (from the website)     — returns the last stored boards JSON.
//
// Persistence: same Upstash Redis integration as /api/ladder. Without Redis
// it falls back to in-memory storage (resets on cold start).
//
// Optional write protection: set a LADDER_KEY env var in Vercel, then point
// the game server at  https://<site>/api/boards?key=<same value>.
// ---------------------------------------------------------------------------

const REDIS_KEY = 'decentracraft-boards'

/** In-memory fallback when Redis isn't configured (survives warm invocations only). */
let memoryBoards = null

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url, token } : null
}

async function redisGet(config) {
  const response = await fetch(`${config.url}/get/${REDIS_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` }
  })
  const data = await response.json()
  return data.result ? JSON.parse(data.result) : null
}

async function redisSet(config, value) {
  await fetch(`${config.url}/set/${REDIS_KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
    body: JSON.stringify(value)
  })
}

function trimEntries(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, 200)
}

function mergeBoardList(previous, incoming) {
  const map = new Map()
  for (const row of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!row || typeof row.address !== 'string' || !row.address) continue
    const address = row.address.toLowerCase()
    const existing = map.get(address)
    const score = Math.max(0, Math.floor(Number(row.score) || 0))
    const wins = Math.max(0, Math.floor(Number(row.wins) || 0))
    const losses = Math.max(0, Math.floor(Number(row.losses) || 0))
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 24) : ''
    if (!existing) {
      map.set(address, { address, name, score, wins, losses })
      continue
    }
    map.set(address, {
      address,
      name: name || existing.name,
      score: Math.max(existing.score, score),
      wins: Math.max(existing.wins, wins),
      losses: Math.max(existing.losses, losses)
    })
  }
  return [...map.values()].sort((a, b) => b.score - a.score || b.wins - a.wins)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-ladder-key')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const redis = redisConfig()

  if (req.method === 'GET') {
    try {
      const boards = redis ? await redisGet(redis) : memoryBoards
      if (!boards) return res.status(404).json({ error: 'no boards stored yet' })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(boards)
    } catch (error) {
      return res.status(502).json({ error: 'storage read failed' })
    }
  }

  if (req.method === 'POST') {
    const requiredKey = process.env.LADDER_KEY
    if (requiredKey) {
      const providedKey = req.query.key || req.headers['x-ladder-key']
      if (providedKey !== requiredKey) return res.status(401).json({ error: 'bad key' })
    }

    const body = req.body
    if (!body || !Array.isArray(body.campaign) || !Array.isArray(body.skirmish)) {
      return res.status(400).json({ error: 'expected { campaign: [...], skirmish: [...], updated }' })
    }

    const previous = redis ? await redisGet(redis) : memoryBoards
    const trimmed = {
      campaign: trimEntries(mergeBoardList(previous && previous.campaign, body.campaign)),
      skirmish: trimEntries(mergeBoardList(previous && previous.skirmish, body.skirmish)),
      updated: body.updated || Date.now()
    }

    try {
      memoryBoards = trimmed
      if (redis) await redisSet(redis, trimmed)
      return res.status(200).json({ ok: true, campaign: trimmed.campaign.length, skirmish: trimmed.skirmish.length })
    } catch (error) {
      return res.status(502).json({ error: 'storage write failed' })
    }
  }

  return res.status(405).json({ error: 'method not allowed' })
}
