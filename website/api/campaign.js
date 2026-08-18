// ---------------------------------------------------------------------------
// /api/campaign — per-wallet mission lists. Union-only writes so a short
// client save can never erase a longer one.
//
//   GET  ?address=0x...  — that wallet's completed mission ids
//   GET                  — full { players: { address: { completed, updated } } }
//   POST { address, completed } — merge into that wallet (union of ids)
// ---------------------------------------------------------------------------

const REDIS_KEY = 'decentracraft-campaign'

let memoryBook = { players: {}, updated: 0 }

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

function sanitizeIds(ids) {
  if (!Array.isArray(ids)) return []
  const unique = []
  for (const id of ids) {
    if (typeof id !== 'string' || unique.includes(id)) continue
    if (!/^(vanguard|aethyr|myriad)-\d+$/.test(id)) continue
    unique.push(id)
  }
  return unique.slice(0, 32)
}

function emptyBook() {
  return { players: {}, updated: 0 }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-ladder-key')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const redis = redisConfig()

  if (req.method === 'GET') {
    try {
      const book = (redis ? await redisGet(redis) : memoryBook) || emptyBook()
      const address = typeof req.query.address === 'string' ? req.query.address.toLowerCase() : ''
      res.setHeader('Cache-Control', 'no-store')
      if (address) {
        const row = book.players && book.players[address]
        return res.status(200).json({ address, completed: row ? sanitizeIds(row.completed) : [], updated: row ? row.updated : 0 })
      }
      return res.status(200).json(book)
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
    const address = typeof body?.address === 'string' ? body.address.toLowerCase() : ''
    const incoming = sanitizeIds(body?.completed)
    if (!address || !address.startsWith('0x')) return res.status(400).json({ error: 'expected { address, completed }' })

    try {
      const book = (redis ? await redisGet(redis) : memoryBook) || emptyBook()
      if (!book.players) book.players = {}
      const existing = sanitizeIds(book.players[address] && book.players[address].completed)
      const completed = sanitizeIds([...existing, ...incoming])
      book.players[address] = { completed, updated: Date.now() }
      book.updated = Date.now()
      memoryBook = book
      if (redis) await redisSet(redis, book)
      return res.status(200).json({ ok: true, address, count: completed.length })
    } catch (error) {
      return res.status(502).json({ error: 'storage write failed' })
    }
  }

  return res.status(405).json({ error: 'method not allowed' })
}
