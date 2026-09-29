// The metrics dashboard: reads /api/metrics (one row of counters per UTC day,
// posted by the game's server) and draws the window the visitor picks.
// Nothing here names a player; the rows never carried addresses.

(function () {
  const params = new URLSearchParams(location.search)
  const game = params.get('game') || 'antrom'
  const demo = params.get('demo') === '1'
  const $ = (id) => document.getElementById(id)
  const charts = {}
  let all = []
  let meta = {}

  const GOLD = '#e6c465', GOLD_DIM = '#a08a3c', GREEN = '#5cb86a', RED = '#d1584f', CYAN = '#6fb8d6', MUTED = '#9aa5b4', LINE = '#243040'
  Chart.defaults.color = MUTED
  Chart.defaults.borderColor = LINE
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif'
  Chart.defaults.font.size = 11

  // ---- helpers -----------------------------------------------------------
  const num = (v) => Number(v) || 0
  const sum = (rows, pick) => rows.reduce((t, r) => t + num(pick(r)), 0)
  const sumTable = (rows, pick) => {
    const out = {}
    for (const r of rows) for (const [k, v] of Object.entries(pick(r) || {})) out[k] = (out[k] || 0) + num(v)
    return out
  }
  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) + '%' : '–')
  const minutes = (seconds) => (seconds / 60).toFixed(1) + ' min'
  const fmt = (n) => (Math.abs(n) >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n * 10) / 10))
  const shiftDay = (day, by) => new Date(Date.parse(day + 'T00:00:00Z') + by * 86400000).toISOString().slice(0, 10)
  const shortDay = (day) => day.slice(5)
  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const runTotal = (d, key) => Object.values(d.runs || {}).reduce((t, r) => t + num(r[key]), 0)

  function card(label, value, note, tone) {
    return `<div class="card${tone ? ' ' + tone : ''}"><div class="label">${escape(label)}</div><div class="value">${escape(value)}</div>${note ? `<div class="note">${escape(note)}</div>` : ''}</div>`
  }

  function draw(id, config) {
    if (charts[id]) charts[id].destroy()
    charts[id] = new Chart($(id).getContext('2d'), config)
  }

  // ---- render ------------------------------------------------------------
  function render() {
    const span = Number($('window').value) || 30
    if (all.length === 0) return
    const last = all[all.length - 1].day
    const cutoff = shiftDay(last, -(span - 1))
    const days = all.filter((d) => d.day >= cutoff)
    const byDay = new Map(all.map((d) => [d.day, d]))
    const latest = days[days.length - 1]

    // Headline
    const playerDays = sum(days, (d) => d.uniques)
    const newPlayers = sum(days, (d) => d.new)
    const sessions = sum(days, (d) => d.sessions)
    const seconds = sum(days, (d) => d.seconds)
    const bounces = sum(days, (d) => d.bounces)
    const retention = retentionRows(days, byDay)
    const d1 = retention.find((r) => r.n === 1), d7 = retention.find((r) => r.n === 7)
    $('headline').innerHTML = [
      card('Players, 30 days', fmt(latest.window ? latest.window.mau : 0), 'distinct wallets, trailing'),
      card('Players, 7 days', fmt(latest.window ? latest.window.wau : 0), 'distinct wallets, trailing'),
      card('Daily players', (playerDays / days.length).toFixed(1), 'average · best ' + Math.max(...days.map((d) => num(d.uniques)))),
      card('New players', fmt(newPlayers), 'first visit in the window'),
      card('Sessions', fmt(sessions), sessions ? minutes(seconds / sessions) + ' average' : ''),
      card('Peak at once', String(Math.max(...days.map((d) => num(d.peak)))), 'most in the scene together'),
      card('Back next day', d1 && d1.cohort ? pct(d1.back, d1.cohort) : '–', d1 && d1.cohort ? `${d1.back} of ${d1.cohort} new players` : 'no cohort yet', d1 && d1.cohort ? (d1.back / d1.cohort >= 0.25 ? 'good' : 'bad') : ''),
      card('Back after a week', d7 && d7.cohort ? pct(d7.back, d7.cohort) : '–', d7 && d7.cohort ? `${d7.back} of ${d7.cohort}` : 'no cohort old enough', d7 && d7.cohort ? (d7.back / d7.cohort >= 0.1 ? 'good' : 'bad') : ''),
      card('Title bounces', pct(bounces, sessions), `${bounces} left inside 3 min without Play`, sessions && bounces / sessions > 0.2 ? 'bad' : '')
    ].join('')

    // Players chart
    draw('playersChart', {
      type: 'bar',
      data: {
        labels: days.map((d) => shortDay(d.day)),
        datasets: [
          { label: 'New', data: days.map((d) => num(d.new)), backgroundColor: GOLD, stack: 'p' },
          { label: 'Returning', data: days.map((d) => Math.max(0, num(d.uniques) - num(d.new))), backgroundColor: GOLD_DIM, stack: 'p' },
          { label: '7-day players', type: 'line', data: days.map((d) => (d.window ? num(d.window.wau) : null)), borderColor: CYAN, pointRadius: 0, tension: 0.3, yAxisID: 'y2' }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y2: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { precision: 0 } } } }
    })

    // Sessions chart
    draw('sessionsChart', {
      type: 'bar',
      data: {
        labels: days.map((d) => shortDay(d.day)),
        datasets: [
          { label: 'Sessions', data: days.map((d) => num(d.sessions)), backgroundColor: GOLD_DIM },
          { label: 'Average minutes', type: 'line', data: days.map((d) => (d.sessions ? num(d.seconds) / num(d.sessions) / 60 : null)), borderColor: GREEN, pointRadius: 2, tension: 0.3, yAxisID: 'y2' }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, y2: { position: 'right', beginAtZero: true, grid: { display: false } } } }
    })

    // Retention table
    $('retention').innerHTML = '<tr><th>Day</th><th>Back</th><th>Cohort</th><th>Rate</th></tr>' + retention.map((r) =>
      `<tr><td>D${r.n}</td><td>${r.cohort ? r.back : '–'}</td><td>${r.cohort || '–'}</td><td>${r.cohort ? `<span class="bar" style="width:${Math.round((r.back / r.cohort) * 60)}px"></span>${pct(r.back, r.cohort)}` : 'not old enough'}</td></tr>`).join('')

    // Platform
    const platform = sumTable(days, (d) => d.platform)
    const platformNames = Object.keys(platform).sort((a, b) => platform[b] - platform[a])
    draw('platformChart', {
      type: 'doughnut',
      data: { labels: platformNames, datasets: [{ data: platformNames.map((n) => platform[n]), backgroundColor: [GOLD, CYAN, GREEN, RED, MUTED], borderColor: '#0e131b' }] },
      options: { responsive: true, aspectRatio: 2, plugins: { legend: { position: 'right' } }, cutout: '60%' }
    })
    const load = {}
    for (const d of days) for (const [name, entry] of Object.entries(d.load || {})) {
      const slot = load[name] || (load[name] = { n: 0, seconds: 0 })
      slot.n += num(entry.n); slot.seconds += num(entry.seconds)
    }
    $('load').innerHTML = Object.entries(load).filter(([, e]) => e.n).map(([name, e]) => `<li><span>Load until the client spoke, ${escape(name)}</span><span>${(e.seconds / e.n).toFixed(0)} s over ${e.n}</span></li>`).join('') || '<li><span>No load times yet</span><span></span></li>'

    // Funnel
    const funnel = sumTable(days, (d) => d.funnel)
    const steps = [['title', 'Saw the title'], ['play', 'Pressed Play'], ['champion', 'Champion ready'], ['dungeon', 'Entered a dungeon'], ['clear', 'Cleared one'], ['upgrade', 'Used the pit'], ['raid', 'Went to the Colossus'], ['raid-clear', 'Broke it']]
    const top = num(funnel.title)
    draw('funnelChart', {
      type: 'bar',
      data: { labels: steps.map((s) => s[1]), datasets: [{ label: 'Players', data: steps.map((s) => num(funnel[s[0]])), backgroundColor: steps.map((s, i) => (i === 0 ? GOLD : GOLD_DIM)) }] },
      options: {
        indexAxis: 'y', responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.raw} · ${pct(c.raw, top)} of title` } } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    })

    // Runs
    const runs = {}
    for (const d of days) for (const [level, r] of Object.entries(d.runs || {})) {
      const slot = runs[level] || (runs[level] = { enter: 0, clear: 0, wipe: 0, leave: 0, seconds: 0, solo: 0, grouped: 0 })
      for (const k of Object.keys(slot)) slot[k] += num(r[k])
    }
    const runRows = Object.entries(runs).sort((a, b) => Number(a[0]) - Number(b[0]))
    $('runs').innerHTML = '<tr><th>Level</th><th>Runs</th><th>Cleared</th><th>Wiped</th><th>Left early</th><th>Time</th><th>In a party</th></tr>' +
      (runRows.length ? runRows.map(([level, r]) => {
        const done = r.clear + r.wipe
        return `<tr><td>Level ${Number(level) + 1}</td><td>${r.enter}</td><td>${pct(r.clear, done)}</td><td>${pct(r.wipe, done)}</td><td>${r.leave}</td><td>${done ? minutes(r.seconds / done) : '–'}</td><td>${pct(r.grouped, r.enter)}</td></tr>`
      }).join('') : '<tr><td colspan="7">No runs in the window</td></tr>')

    // Raid and economy
    const raid = { join: 0, wake: 0, clear: 0, wipe: 0, abandon: 0 }
    for (const d of days) for (const k of Object.keys(raid)) raid[k] += num(d.raid && d.raid[k])
    $('raid').innerHTML = [card('Went down', String(raid.join)), card('Woke it', String(raid.wake)), card('Broke it', String(raid.clear), '', raid.clear ? 'good' : ''), card('Wiped', String(raid.wipe)), card('Walked away', String(raid.abandon))].join('')
    const attempts = sum(days, (d) => d.upgrades && d.upgrades.attempt)
    $('economy').innerHTML = [
      card('Deaths', fmt(sum(days, (d) => d.deaths))),
      card('XP awarded', fmt(sum(days, (d) => d.xp))),
      card('Level-ups', fmt(sum(days, (d) => d.levelUps))),
      card('Pit upgrades', fmt(attempts), attempts ? pct(sum(days, (d) => d.upgrades && d.upgrades.success), attempts) + ' succeeded' : ''),
      card('Coins dropped', fmt(sum(days, (d) => d.loot && d.loot.coins))),
      card('Items dropped', fmt(sum(days, (d) => d.loot && d.loot.items)), sum(days, (d) => d.loot && d.loot.boss) + ' from bosses'),
      card('Parties formed', fmt(sum(days, (d) => d.party && d.party.formed)), sum(days, (d) => d.party && d.party.joined) + ' joins')
    ].join('')

    // Levels
    const levels = sumTable(days, (d) => d.levels)
    const buckets = {}
    for (const [level, count] of Object.entries(levels)) {
      const from = Math.floor((Number(level) - 1) / 5) * 5 + 1
      const key = `${from}–${from + 4}`
      buckets[key] = (buckets[key] || 0) + count
    }
    const bucketKeys = Object.keys(buckets).sort((a, b) => parseInt(a) - parseInt(b))
    draw('levelsChart', {
      type: 'bar',
      data: { labels: bucketKeys, datasets: [{ label: 'Departures', data: bucketKeys.map((k) => buckets[k]), backgroundColor: GOLD_DIM }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    })

    // Day table
    $('days').innerHTML = '<tr><th>Day</th><th>Players</th><th>New</th><th>Sessions</th><th>Avg</th><th>Peak</th><th>Runs</th><th>Clears</th><th>Deaths</th><th>Bounces</th></tr>' +
      [...days].reverse().map((d) => `<tr><td>${d.day}</td><td>${num(d.uniques)}</td><td>${num(d.new)}</td><td>${num(d.sessions)}</td><td>${d.sessions ? minutes(num(d.seconds) / num(d.sessions)) : '–'}</td><td>${num(d.peak)}</td><td>${runTotal(d, 'enter')}</td><td>${runTotal(d, 'clear')}</td><td>${num(d.deaths)}</td><td>${num(d.bounces)}</td></tr>`).join('')

    $('foot').textContent = `${days[0].day} to ${last} · ${days.length} day${days.length === 1 ? '' : 's'} shown of ${all.length} on record` +
      (meta.version ? ` · game ${meta.version}` : '') + (meta.updated ? ` · updated ${new Date(meta.updated).toLocaleString()}` : '') +
      ' · days are UTC · a return inside 30 minutes is the same session · developers are not counted'
  }

  function retentionRows(days, byDay) {
    return [1, 3, 7, 14, 30].map((n) => {
      let cohort = 0, back = 0
      for (const d of days) {
        const target = byDay.get(shiftDay(d.day, n))
        if (!target || !(num(d.new) > 0)) continue
        cohort += num(d.new)
        back += num(target.ages && target.ages[String(n)])
      }
      return { n, cohort, back }
    })
  }

  // ---- demo data ---------------------------------------------------------
  function demoDays() {
    let seed = 7
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
    const between = (a, b) => a + Math.floor(rand() * (b - a + 1))
    const rows = []
    const today = new Date().toISOString().slice(0, 10)
    for (let i = 59; i >= 0; i--) {
      const day = shiftDay(today, -i)
      const fresh = between(2, 9), uniques = fresh + between(3, 12), sessions = uniques + between(0, 6)
      const ages = { 0: fresh }
      for (const a of [1, 3, 7, 14, 30]) if (59 - i >= a) ages[a] = between(0, Math.max(1, Math.round(fresh * (0.5 / Math.sqrt(a)))))
      rows.push({
        day, uniques, new: fresh, sessions, seconds: sessions * between(240, 900), peak: between(2, 7), bounces: between(0, 3),
        platform: { desktop: uniques - between(1, 5), mobile: between(1, 5) },
        load: { mobile: { n: 3, seconds: between(90, 180) }, desktop: { n: 8, seconds: between(40, 90) } },
        ages, levels: { 3: between(0, 3), 8: between(0, 3), 14: between(0, 2), 27: between(0, 1) },
        funnel: { title: fresh, play: fresh - 1, champion: Math.max(0, fresh - 2), dungeon: Math.max(0, fresh - 3), clear: Math.max(0, fresh - 4), death: Math.max(0, fresh - 3), upgrade: between(0, 1), raid: between(0, 1), 'raid-clear': 0 },
        runs: { 0: { enter: between(5, 12), clear: between(3, 7), wipe: between(1, 4), leave: between(0, 2), seconds: 8 * 300, solo: 6, grouped: 3 }, 1: { enter: between(1, 6), clear: between(0, 2), wipe: between(1, 3), leave: 0, seconds: 4 * 400, solo: 2, grouped: 2 } },
        raid: { join: between(0, 4), wake: between(0, 1), clear: 0, wipe: between(0, 1), abandon: 0 },
        deaths: between(3, 20), xp: between(500, 5000), levelUps: between(0, 6), upgrades: { attempt: between(0, 6), success: between(0, 4) },
        loot: { coins: between(100, 500), items: between(4, 20), boss: between(0, 4) }, party: { formed: between(2, 9), joined: between(0, 4) },
        window: { wau: between(30, 50), mau: between(90, 140) }
      })
    }
    return rows
  }

  // ---- boot --------------------------------------------------------------
  async function boot() {
    try {
      if (demo) {
        all = demoDays(); meta = { version: 'demo' }
      } else {
        const response = await fetch(`/api/metrics?game=${encodeURIComponent(game)}`, { cache: 'no-store' })
        if (response.status === 404) { $('empty').hidden = false; $('status').textContent = 'No data yet'; return }
        if (!response.ok) throw new Error('HTTP ' + response.status)
        const body = await response.json()
        all = (body.days || []).filter((d) => d && d.day).sort((a, b) => (a.day < b.day ? -1 : 1))
        meta = body
        if (all.length === 0) { $('empty').hidden = false; $('status').textContent = 'No data yet'; return }
      }
      $('status').textContent = demo ? 'Demo numbers' : `${all.length} day${all.length === 1 ? '' : 's'} on record`
      $('app').hidden = false
      render()
      $('window').addEventListener('change', render)
    } catch (error) {
      $('status').textContent = 'Could not load: ' + error.message
    }
  }
  boot()
})()
