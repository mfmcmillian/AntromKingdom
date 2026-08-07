// ---------------------------------------------------------------------------
// Ranked ladder — live standings from the DecentraCraft game server.
//
// How the pipeline works:
//   1. The authoritative world server keeps Elo ratings in persistent world
//      Storage and rescoreboards after every ranked match.
//   2. If the server's LEADERBOARD_PUSH_URL env var is set (via
//      `npx sdk-commands deploy-env LEADERBOARD_PUSH_URL --value <url>`), it
//      POSTs the full ladder JSON there after each rated result.
//   3. This page GETs the same document from LADDER_ENDPOINT below and renders
//      it. Any endpoint that stores the POSTed JSON and serves it back works
//      (a JSON bin, a tiny worker, a bucket with public read...).
//
// Expected JSON shape (exactly what the server pushes):
//   { "updated": 1730000000000,
//     "entries": [ { "address": "0x..", "name": "Player", "rating": 1216,
//                    "wins": 3, "losses": 1 } ] }
// ---------------------------------------------------------------------------

/**
 * Endpoint that receives the game server's ladder pushes — the Vercel
 * serverless function bundled with this site (website/api/ladder.js).
 * Absolute URL so the GitHub Pages copy of the site reads the same feed.
 */
const LADDER_ENDPOINT = 'https://decentracraft-nine.vercel.app/api/ladder'

;(function initLadder() {
  const table = document.getElementById('ladderTable')
  const rows = document.getElementById('ladderRows')
  const note = document.getElementById('ladderNote')
  const updatedEl = document.getElementById('ladderUpdated')
  if (!table || !rows || !note) return

  const OFFLINE_MESSAGE =
    'The live feed is not wired up yet — current standings are always visible in-game: ' +
    'enter the RANKED LADDER battle room from the multiplayer menu.'

  function shortAddress(address) {
    return address && address.length > 10 ? address.slice(0, 6) + '..' + address.slice(-4) : address || ''
  }

  function render(ladder) {
    const entries = Array.isArray(ladder.entries) ? ladder.entries.slice(0, 50) : []
    if (entries.length === 0) {
      note.textContent = 'No rated matches played yet. The first ranked win claims the top of the ladder.'
      return
    }

    rows.innerHTML = ''
    entries.forEach((entry, index) => {
      const games = (entry.wins || 0) + (entry.losses || 0)
      const winRate = games > 0 ? Math.round((entry.wins / games) * 100) + '%' : '—'
      const tr = document.createElement('tr')
      if (index < 3) tr.className = 'ladder-top'

      const cells = [
        String(index + 1),
        entry.name || shortAddress(entry.address),
        String(entry.rating),
        String(entry.wins || 0),
        String(entry.losses || 0),
        winRate
      ]
      cells.forEach((text, cellIndex) => {
        const td = document.createElement('td')
        td.textContent = text // textContent: player names are untrusted input
        if (cellIndex === 1) td.title = entry.address || ''
        tr.appendChild(td)
      })
      rows.appendChild(tr)
    })

    table.hidden = false
    note.hidden = true
    if (updatedEl && ladder.updated) {
      updatedEl.textContent = 'Last updated ' + new Date(ladder.updated).toLocaleString()
    }
  }

  if (!LADDER_ENDPOINT) {
    note.textContent = OFFLINE_MESSAGE
    return
  }

  fetch(LADDER_ENDPOINT, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    })
    .then(render)
    .catch(() => {
      note.textContent = OFFLINE_MESSAGE
    })
})()
