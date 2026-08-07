// ---------------------------------------------------------------------------
// /api/ladder — Vercel serverless function that stores and serves the ranked
// ladder, connecting the DecentraCraft game server to the website.
//
//   POST  (from the game server) — body is the full ladder JSON; stored as-is.
//   GET   (from the website)     — returns the last stored ladder JSON.
//
// Persistence: add the "Upstash for Redis" integration in the Vercel
// dashboard (Storage tab, free tier is plenty) — it injects KV_REST_API_URL /
// KV_REST_API_TOKEN automatically and this function picks them up. Without
// Redis it falls back to in-memory storage, which works for testing but
// resets whenever the function cold-starts.
//
// Optional write protection: set a LADDER_KEY env var in Vercel, then point
// the game server at  https://<site>/api/ladder?key=<same value>  so random
// visitors can't overwrite the standings.
// ---------------------------------------------------------------------------

const REDIS_KEY = 'decentracraft-ladder'

/** In-memory fallback when Redis isn't configured (survives warm invocations only). */
let memoryLadder = null

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

export default async function handler(req, res) {
  // CORS: lets the ladder render even when the site is hosted elsewhere
  // (e.g. GitHub Pages) while the API lives on Vercel.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-ladder-key')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const redis = redisConfig()

  if (req.method === 'GET') {
    try {
      const ladder = redis ? await redisGet(redis) : memoryLadder
      if (!ladder) return res.status(404).json({ error: 'no ladder stored yet' })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(ladder)
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

    const ladder = req.body
    if (!ladder || !Array.isArray(ladder.entries)) {
      return res.status(400).json({ error: 'expected { entries: [...], updated }' })
    }
    // Cap stored size so a bad payload can't balloon the record.
    const trimmed = { entries: ladder.entries.slice(0, 200), lastMatch: ladder.lastMatch, updated: ladder.updated || Date.now() }

    try {
      memoryLadder = trimmed
      if (redis) await redisSet(redis, trimmed)
      return res.status(200).json({ ok: true, stored: trimmed.entries.length })
    } catch (error) {
      return res.status(502).json({ error: 'storage write failed' })
    }
  }

  return res.status(405).json({ error: 'method not allowed' })
}
