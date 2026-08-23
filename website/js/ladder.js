// ---------------------------------------------------------------------------
// Leaderboards — campaign, ranked multiplayer, and skirmish standings.
//
// Ranked Elo still comes from /api/ladder (unchanged). Campaign and
// skirmish rows come from /api/boards, which the game server POSTs after
// campaign saves and skirmish results.
// ---------------------------------------------------------------------------

const LADDER_ENDPOINT = '/api/ladder'
const BOARDS_ENDPOINT = '/api/boards'
const CAMPAIGN_MISSION_COUNT = 24

;(function initBoards() {
  const table = document.getElementById('ladderTable')
  const head = document.getElementById('ladderHead')
  const rows = document.getElementById('ladderRows')
  const note = document.getElementById('ladderNote')
  const updatedEl = document.getElementById('ladderUpdated')
  const intro = document.getElementById('ladderIntro')
  const tabs = document.querySelectorAll('[data-board]')
  if (!table || !head || !rows || !note || tabs.length === 0) return

  const INTROS = {
    campaign:
      'Campaign standings count <strong>missions completed</strong> across all three factions — 8 missions each, 24 in total. Progress syncs from your in-game campaign save.',
    multiplayer:
      'The <strong>RANKED LADDER</strong> battle room is a strict free-for-all — humans only, no alliances, no computers. Win and you take Elo from every commander you buried. Everyone starts at 1200.',
    skirmish:
      'Single-player <strong>skirmish</strong> wins and losses against the computer. Campaign missions and multiplayer matches are counted on their own boards.'
  }

  const EMPTY = {
    campaign: 'No campaign progress on the board yet. Finish a mission in-game to claim a spot.',
    multiplayer: 'No rated matches played yet. The first ranked win claims the top of the ladder.',
    skirmish: 'No skirmish results yet. Beat the computer in Single Player to take the top of the board.'
  }

  const OFFLINE =
    'The live feed is not wired up yet — current standings are always visible in-game from the title screen LEADERBOARDS button.'

  // Campaign is the board with live traffic; ranked may be empty for a long time.
  let currentTab = 'campaign'
  let ranked = null
  let boards = null
  let rankedFailed = false
  let boardsFailed = false

  function shortAddress(address) {
    return address && address.length > 10 ? address.slice(0, 6) + '..' + address.slice(-4) : address || ''
  }

  function setNote(text, offline) {
    table.hidden = true
    note.hidden = false
    note.textContent = text
    if (updatedEl && offline) updatedEl.textContent = ''
  }

  function fillRows(entries, cellsFor) {
    rows.innerHTML = ''
    entries.forEach((entry, index) => {
      const tr = document.createElement('tr')
      if (index < 3) tr.className = 'ladder-top'
      cellsFor(entry, index).forEach((text, cellIndex) => {
        const td = document.createElement('td')
        td.textContent = text
        if (cellIndex === 1) td.title = entry.address || ''
        tr.appendChild(td)
      })
      rows.appendChild(tr)
    })
    table.hidden = false
    note.hidden = true
  }

  function setHead(labels) {
    head.innerHTML = ''
    const tr = document.createElement('tr')
    labels.forEach((label) => {
      const th = document.createElement('th')
      th.textContent = label
      tr.appendChild(th)
    })
    head.appendChild(tr)
  }

  function render() {
    if (intro) intro.innerHTML = INTROS[currentTab] || INTROS.campaign
    tabs.forEach((tab) => {
      tab.classList.toggle('is-active', tab.getAttribute('data-board') === currentTab)
    })

    if (currentTab === 'multiplayer') {
      setHead(['#', 'Commander', 'Rating', 'W', 'L', 'Win %'])
      if (rankedFailed) {
        setNote(OFFLINE, true)
        return
      }
      const entries = ranked && Array.isArray(ranked.entries) ? ranked.entries.slice(0, 50) : []
      if (entries.length === 0) {
        setNote(EMPTY.multiplayer, false)
        return
      }
      fillRows(entries, (entry, index) => {
        const games = (entry.wins || 0) + (entry.losses || 0)
        const winRate = games > 0 ? Math.round((entry.wins / games) * 100) + '%' : '—'
        return [
          String(index + 1),
          entry.name || shortAddress(entry.address),
          String(entry.rating),
          String(entry.wins || 0),
          String(entry.losses || 0),
          winRate
        ]
      })
      if (updatedEl && ranked && ranked.updated) {
        updatedEl.textContent = 'Last updated ' + new Date(ranked.updated).toLocaleString()
      }
      return
    }

    if (boardsFailed) {
      setNote(OFFLINE, true)
      return
    }
    if (!boards) {
      setNote(EMPTY[currentTab] || EMPTY.campaign, false)
      return
    }

    const list = currentTab === 'campaign' ? boards.campaign : boards.skirmish

    if (currentTab === 'campaign') {
      setHead(['#', 'Commander', 'Missions'])
      const entries = Array.isArray(list) ? list.slice(0, 50) : []
      if (entries.length === 0) {
        setNote(EMPTY.campaign, false)
        return
      }
      fillRows(entries, (entry, index) => [
        String(index + 1),
        entry.name || shortAddress(entry.address),
        (entry.score || 0) + ' / ' + CAMPAIGN_MISSION_COUNT
      ])
    } else {
      setHead(['#', 'Commander', 'W', 'L', 'Win %'])
      const entries = Array.isArray(list) ? list.slice(0, 50) : []
      if (entries.length === 0) {
        setNote(EMPTY.skirmish, false)
        return
      }
      fillRows(entries, (entry, index) => {
        const games = (entry.wins || 0) + (entry.losses || 0)
        const winRate = games > 0 ? Math.round((entry.wins / games) * 100) + '%' : '—'
        return [
          String(index + 1),
          entry.name || shortAddress(entry.address),
          String(entry.wins || 0),
          String(entry.losses || 0),
          winRate
        ]
      })
    }

    if (updatedEl && boards.updated) {
      updatedEl.textContent = 'Last updated ' + new Date(boards.updated).toLocaleString()
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      currentTab = tab.getAttribute('data-board') || 'campaign'
      render()
    })
  })

  /** 404 = empty board (not offline). Network / 5xx = feed failure. */
  function loadJson(url) {
    return fetch(url, { cache: 'no-store' }).then(async (response) => {
      if (response.status === 404) return null
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    })
  }

  Promise.allSettled([loadJson(LADDER_ENDPOINT), loadJson(BOARDS_ENDPOINT)]).then((results) => {
    if (results[0].status === 'fulfilled') {
      ranked = results[0].value
    } else {
      rankedFailed = true
    }
    if (results[1].status === 'fulfilled') {
      boards = results[1].value
    } else {
      boardsFailed = true
    }
    render()
  })
})()
