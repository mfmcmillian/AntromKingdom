/* global BALANCE_VERSION, RACE_META, OPENING, GATHER, COMBAT, CASTER, HEROES, HEALERS, UTILITY, BUILDINGS, UPGRADES, MAPS, AI, ASSAULT, CAMPAIGN, MISSIONS, TARGETING, UNITS, ANALYSIS */

const RACES = ['human', 'alien', 'bio']
const GAS_WEIGHT = 2

const state = {
  page: 'overview',
  race: 'all',
  query: '',
  sortKey: 'role',
  sortDir: 1,
  metric: 'dps'
}

function $(id) {
  return document.getElementById(id)
}

function dps(u) {
  if (!u.dmg) return 0
  return u.dmg / (u.rate || 1)
}

function value(u) {
  return (u.m || 0) + GAS_WEIGHT * (u.g || 0)
}

function fmt(n, digits) {
  if (n === 0) return '—'
  const d = digits === undefined ? (Number.isInteger(n) ? 0 : 1) : digits
  return Number(n).toFixed(d).replace(/\.0$/, '')
}

function flattenUnits() {
  const rows = []
  for (const def of UNITS) {
    for (const race of RACES) {
      const u = def[race]
      const row = {
        race,
        raceName: RACE_META[race].short,
        role: def.role,
        key: def.key,
        train: def.train,
        ...u,
        dps: dps(u),
        value: value(u)
      }
      row.hpPer100 = row.value ? (row.hp / row.value) * 100 : 0
      row.dpsPer100 = row.value ? (row.dps / row.value) * 100 : 0
      rows.push(row)
    }
  }
  return rows
}

const ALL_ROWS = flattenUnits()

function kpi(label, value) {
  return `<div class="kpi"><div class="k">${label}</div><div class="v">${value}</div></div>`
}

function tableHtml(headers, rows, numeric) {
  const head = headers.map((h, i) => `<th class="${numeric && numeric[i] ? 'num' : ''}">${h}</th>`).join('')
  const body = rows
    .map((cells) => {
      const tds = cells
        .map((c, i) => `<td class="${numeric && numeric[i] ? 'num' : ''}">${c}</td>`)
        .join('')
      return `<tr>${tds}</tr>`
    })
    .join('')
  return `<div class="grid-table-wrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function groupedBars(categories, series) {
  const w = 760
  const h = 240
  const padL = 36
  const padR = 12
  const padT = 12
  const padB = 36
  const plotW = w - padL - padR
  const plotH = h - padT - padB
  const max = Math.max(...series.flatMap((s) => s.data), 1)
  const groupW = plotW / categories.length
  const barW = Math.min(22, (groupW * 0.7) / series.length)
  const gap = 3

  let bars = ''
  categories.forEach((cat, i) => {
    series.forEach((s, si) => {
      const val = s.data[i]
      const bh = (val / max) * plotH
      const x = padL + i * groupW + (groupW - series.length * (barW + gap)) / 2 + si * (barW + gap)
      const y = padT + plotH - bh
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${Math.max(1, bh).toFixed(1)}" fill="${s.color}" rx="1"/>`
    })
    const tx = padL + i * groupW + groupW / 2
    bars += `<text x="${tx.toFixed(1)}" y="${h - 10}" text-anchor="middle" fill="#97a2bd" font-size="11" font-family="Rajdhani,sans-serif">${cat}</text>`
  })

  const ticks = 4
  let grid = ''
  for (let t = 0; t <= ticks; t++) {
    const y = padT + (plotH * t) / ticks
    const label = Math.round(max * (1 - t / ticks))
    grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#232c4a" stroke-width="1"/>`
    grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" fill="#97a2bd" font-size="10">${label}</text>`
  }

  const legend = series
    .map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`)
    .join('')

  return `<div class="legend">${legend}</div>
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img">${grid}${bars}</svg>`
}

function renderOverview() {
  const melee = UNITS.find((u) => u.key === 'melee')
  $('page-overview').innerHTML = `
    <div class="note info">Stated identity: cost-efficiency orders Myriad &gt; Vanguard &gt; Aethyr at every tier; raw per-unit power is the reverse. Production times follow the same split.</div>
    <div class="race-cards">
      ${RACES.map((id) => {
        const r = RACE_META[id]
        return `<article class="race-card" style="--rc:${r.accent}"><h3>${r.name}</h3><div class="tag">${r.tagline}</div><p>${r.identity}</p></article>`
      }).join('')}
    </div>
    <h2 class="h2"><span>01</span> Opening bank</h2>
    <div class="kpi-row">
      ${kpi('Crystal', OPENING.crystal)}
      ${kpi('Plasma', OPENING.plasma)}
      ${kpi('Workers', OPENING.workers)}
      ${kpi('Supply', OPENING.supplyUsed + ' / ' + OPENING.supplyCap)}
      ${kpi('Hero supply', OPENING.heroSupply)}
      ${kpi('Map size', OPENING.mapSize + ' m')}
    </div>
    <p class="chart-cap">HQ adds 10 supply on a 0 base cap. Hero is free and takes no supply, so the opening is 5/10. Default stance is ${OPENING.defaultStance}.</p>

    <h2 class="h2"><span>02</span> T1 melee identity</h2>
    <div class="chart-box">
      <h3>HP — melee</h3>
      ${groupedBars(
        ['Vanguard', 'Aethyr', 'Myriad'],
        [{ name: 'HP', color: '#73b3ff', data: RACES.map((r) => melee[r].hp) }]
      )}
      <p class="chart-cap">Source: races.ts melee rows</p>
    </div>
    <div class="chart-box">
      <h3>DPS — melee</h3>
      ${groupedBars(
        ['Vanguard', 'Aethyr', 'Myriad'],
        [{ name: 'DPS', color: '#f2c14e', data: RACES.map((r) => dps(melee[r])) }]
      )}
      <p class="chart-cap">DPS at 1 s interval · 16 / 11 / 7</p>
    </div>
    <div class="chart-box">
      <h3>Cost-efficiency — melee (plasma × ${GAS_WEIGHT})</h3>
      ${groupedBars(
        ['Vanguard', 'Aethyr', 'Myriad'],
        [
          { name: 'HP / 100 value', color: '#35d4e9', data: RACES.map((r) => Math.round((melee[r].hp / value(melee[r])) * 100)) },
          { name: 'DPS / 100 value', color: '#21c063', data: RACES.map((r) => +((dps(melee[r]) / value(melee[r])) * 100).toFixed(1)) }
        ]
      )}
      <p class="chart-cap">Myriad 110 HP and 14 DPS per 100 value · Vanguard 100 and 11 · Aethyr 56 and 7.1. Value costs: 100 / 225 / 50.</p>
    </div>

    <h2 class="h2"><span>03</span> 1v1 time-to-kill, T1 melee</h2>
    ${tableHtml(
      ['Attacker → defender', 'TTK (s)', 'Reverse TTK (s)', 'Winner'],
      [
        ['Breacher vs Mauler', '5.0', '14.3', 'Breacher, easily'],
        ['Sentinel vs Breacher', '6.3', '11.4', 'Sentinel'],
        ['Sentinel vs Mauler', '3.4', '17.9', 'Sentinel'],
        ['2 Maulers vs 1 Breacher', '~7 (split fire)', '~10', 'Near-even mineral trade']
      ],
      [false, true, true, false]
    )}
    <p class="chart-cap">TTK ignores splash, upgrades, regen, and micro. Myriad 1 HP/s on a 55 HP body is +1.8%/s — it pads swarm trades, it does not flip the 1v1.</p>
  `
}

function raceClass(race) {
  return `r-${race}`
}

function renderUnits() {
  const filtered = ALL_ROWS.filter((row) => {
    if (state.race !== 'all' && row.race !== state.race) return false
    if (!state.query) return true
    const q = state.query.toLowerCase()
    return `${row.role} ${row.name} ${row.notes} ${row.train}`.toLowerCase().includes(q)
  })

  const key = state.sortKey
  filtered.sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (typeof av === 'string') return av.localeCompare(bv) * state.sortDir
    return ((av || 0) - (bv || 0)) * state.sortDir
  })

  const cols = [
    ['raceName', 'Race'],
    ['role', 'Role'],
    ['name', 'Name'],
    ['hp', 'HP'],
    ['dmg', 'Dmg'],
    ['rate', 'Rate'],
    ['dps', 'DPS'],
    ['range', 'Range'],
    ['speed', 'Speed'],
    ['splash', 'Splash'],
    ['m', 'Crystal'],
    ['g', 'Plasma'],
    ['value', 'Value'],
    ['hpPer100', 'HP/100'],
    ['dpsPer100', 'DPS/100'],
    ['time', 'Train'],
    ['supply', 'Sup'],
    ['train', 'Building'],
    ['notes', 'Notes']
  ]

  const head = cols
    .map(([k, label]) => {
      const cls = state.sortKey === k ? (state.sortDir > 0 ? 'sort-asc' : 'sort-desc') : ''
      const num = !['raceName', 'role', 'name', 'train', 'notes'].includes(k)
      return `<th data-sort="${k}" class="${cls}${num ? ' num' : ''}">${label}</th>`
    })
    .join('')

  const body = filtered
    .map((row) => {
      const cells = [
        `<span class="${raceClass(row.race)}">${row.raceName}</span>`,
        row.role,
        row.name,
        row.hp,
        row.dmg || '—',
        row.rate + 's',
        row.dps ? row.dps.toFixed(1) : '—',
        row.range || '—',
        row.speed,
        row.splash || '—',
        row.m,
        row.g || '—',
        row.value || '—',
        row.hpPer100 ? row.hpPer100.toFixed(0) : '—',
        row.dpsPer100 ? row.dpsPer100.toFixed(1) : '—',
        row.time + 's',
        row.supply,
        row.train,
        `<span class="dim">${row.notes}</span>`
      ]
      return `<tr>${cells
        .map((c, i) => {
          const num = i >= 3 && i <= 16 && i !== 17
          return `<td class="${num ? 'num' : ''}">${c}</td>`
        })
        .join('')}</tr>`
    })
    .join('')

  $('page-units').innerHTML = `
    <div class="filters">
      <button class="race-pill ${state.race === 'all' ? 'is-on' : ''}" data-race="all">All</button>
      ${RACES.map(
        (id) =>
          `<button class="race-pill ${state.race === id ? 'is-on' : ''}" data-race="${id}">${RACE_META[id].short}</button>`
      ).join('')}
      <input id="unitSearch" type="search" placeholder="Filter by name, role, notes…" value="${state.query.replace(/"/g, '&quot;')}" />
    </div>
    <p class="chart-cap">${filtered.length} rows · Value = crystal + ${GAS_WEIGHT}× plasma · DPS = damage ÷ interval · click a column to sort · siege numbers are dug-in</p>
    <div class="grid-table-wrap"><table class="grid" id="unitTable">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <h2 class="h2"><span>Siege mobile</span></h2>
    <p class="chart-cap">Trained siege starts mobile: half damage (rounded), 7.5 m range, no splash, 1.4 s to dig in or pack up.</p>
    ${tableHtml(
      ['Race', 'Name', 'Mobile dmg', 'Mobile DPS', 'Mobile range', 'Dug-in dmg', 'Dug-in DPS', 'Dug-in range'],
      RACES.map((id) => {
        const u = UNITS.find((x) => x.key === 'siege')[id]
        const md = Math.max(1, Math.round(u.dmg * 0.5))
        return [RACE_META[id].short, u.name, md, (md / u.rate).toFixed(1), '7.5', u.dmg, dps(u).toFixed(1), u.range]
      }),
      [false, false, true, true, true, true, true, true]
    )}
  `

  $('unitSearch').addEventListener('input', (e) => {
    state.query = e.target.value
    const pos = e.target.selectionStart
    renderUnits()
    const el = $('unitSearch')
    el.focus()
    try {
      el.setSelectionRange(pos, pos)
    } catch {
      /* ignore */
    }
  })
  document.querySelectorAll('#page-units .race-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.race = btn.dataset.race
      renderUnits()
    })
  })
  document.querySelectorAll('#unitTable th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort
      if (state.sortKey === k) state.sortDir *= -1
      else {
        state.sortKey = k
        state.sortDir = 1
      }
      renderUnits()
    })
  })
}

const COMPARE_ROLES = ['melee', 'ranged', 'caster', 'antiAir', 'flyer', 'siege', 'heavyAir', 'titan', 'hero']
const METRICS = [
  { id: 'hp', label: 'HP', pick: (u) => u.hp },
  { id: 'dps', label: 'DPS', pick: (u) => +dps(u).toFixed(1) },
  { id: 'value', label: 'Value cost', pick: (u) => value(u) },
  { id: 'dpsPer100', label: 'DPS / 100 value', pick: (u) => (value(u) ? +((dps(u) / value(u)) * 100).toFixed(1) : 0) },
  { id: 'hpPer100', label: 'HP / 100 value', pick: (u) => (value(u) ? Math.round((u.hp / value(u)) * 100) : 0) },
  { id: 'speed', label: 'Speed', pick: (u) => u.speed },
  { id: 'range', label: 'Range', pick: (u) => u.range },
  { id: 'time', label: 'Train time', pick: (u) => u.time }
]

function renderCompare() {
  const metric = METRICS.find((m) => m.id === state.metric)
  const cats = COMPARE_ROLES.map((k) => UNITS.find((u) => u.key === k).role)
  const series = RACES.map((id) => ({
    name: RACE_META[id].short,
    color: RACE_META[id].accent,
    data: COMPARE_ROLES.map((k) => metric.pick(UNITS.find((u) => u.key === k)[id]))
  }))

  $('page-compare').innerHTML = `
    <div class="metric-tabs">
      ${METRICS.map((m) => `<button class="metric-tab ${m.id === state.metric ? 'is-on' : ''}" data-metric="${m.id}">${m.label}</button>`).join('')}
    </div>
    <div class="chart-box">
      <h3>${metric.label} by role</h3>
      ${groupedBars(cats, series)}
      <p class="chart-cap">Heroes have 0 cost so efficiency metrics read 0 for them. Siege is dug-in.</p>
    </div>
    <h2 class="h2"><span>Same role</span></h2>
    ${tableHtml(
      ['Role', 'Vanguard', 'Aethyr', 'Myriad'],
      COMPARE_ROLES.map((k) => {
        const def = UNITS.find((u) => u.key === k)
        const cell = (id) => {
          const u = def[id]
          const v = value(u)
          return `${u.name} · ${u.hp} HP · ${u.dmg ? dps(u).toFixed(1) + ' DPS' : '0 DPS'} · ${u.m}${u.g ? '+' + u.g : ''}${v ? ' (val ' + v + ')' : ''}`
        }
        return [def.role, cell('human'), cell('alien'), cell('bio')]
      })
    )}
  `
  document.querySelectorAll('#page-compare .metric-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.metric = btn.dataset.metric
      renderCompare()
    })
  })
}

function renderEconomy() {
  $('page-economy').innerHTML = `
    <h2 class="h2"><span>01</span> Gathering</h2>
    <div class="kpi-row">
      ${kpi('Mine time', GATHER.mineTime + ' s')}
      ${kpi('Carry', GATHER.carry)}
      ${kpi('Rich carry', GATHER.richCarry)}
      ${kpi('Worker speed', GATHER.workerSpeed)}
      ${kpi('Crystal / node', GATHER.nodeCrystal.toLocaleString())}
      ${kpi('Plasma / vent', GATHER.nodePlasma.toLocaleString())}
    </div>
    <div class="note">${GATHER.typicalMainIncomeNote} Opening five workers ≈ ${(GATHER.typicalMainIncome * 5).toFixed(1)} crystal/s (${Math.round(GATHER.typicalMainIncome * 5 * 60)} / min).</div>
    ${tableHtml(
      ['Patch', 'Workers', 'Income', 'Main line lifetime (7×750)'],
      [
        ['Normal main, 1 per node', '7', '4.5 crystal/s', '~19.5 min'],
        ['Opening five on main', '5', '3.2 crystal/s', '~27 min'],
        ['Hard AI, 7 workers', '7', '5.6 crystal/s', '~15.6 min'],
        ['Rich center, 1 per node', '7', '6.7 crystal/s', '~19.5 min (7×1,125)']
      ],
      [false, true, true, false]
    )}

    <h2 class="h2"><span>02</span> Buildings</h2>
    ${tableHtml(
      ['Slot', 'Names', 'Crystal', 'Plasma', 'HP', 'Build', 'Supply', 'Requires'],
      BUILDINGS.map((b) => [b.slot, b.names, b.m, b.g || '—', b.hp, b.time + 's', b.supply, b.requires]),
      [false, false, true, true, true, true, false, false]
    )}
    <p class="chart-cap">Repair 12 HP/s (Vanguard 21 HP/s) at 2 crystal/s. Aethyr self-build 0.5× after seed. One unit at a time per production building. Construction refunds remaining fraction.</p>

    <h2 class="h2"><span>03</span> Tech tree</h2>
    ${tableHtml(
      ['Trains at', 'Units', 'Extra gate'],
      [
        ['HQ', 'Workers', '—'],
        ['Barracks', 'Melee, ranged, healer, caster, anti-air', 'Casters are T1 — no tech lab'],
        ['Tech lab', 'Flyer, transport, siege, titan, heavy air', 'Siege/titan need forge. Heavy air needs air forge.']
      ]
    )}

    <h2 class="h2"><span>04</span> Upgrades (3 levels)</h2>
    ${tableHtml(
      ['Track', 'Per level', 'L1', 'L2', 'L3', 'Total crystal/plasma', 'Times'],
      UPGRADES.map((u) => [u.track, u.per, u.costs[0], u.costs[1], u.costs[2], u.total, u.times])
    )}
    <p class="chart-cap">L3 weapons = +60% damage. L3 propulsion = +30% speed. Instant on units already in the field. Air tracks skip titans. Transports use air speed.</p>

    <h2 class="h2"><span>05</span> Map totals</h2>
    <div class="chart-box">
      <h3>Crystal and plasma in nodes</h3>
      ${groupedBars(
        MAPS.map((m) => m.name.split(' ')[0]),
        [
          { name: 'Crystal', color: '#5aa0ff', data: MAPS.map((m) => m.crystal) },
          { name: 'Plasma', color: '#3ddb5a', data: MAPS.map((m) => m.plasma) }
        ]
      )}
      <p class="chart-cap">Normal node 750 crystal / 1,500 plasma. Rich 1,125 / 2,250. Bloom Wastes copies Crown. Finale island skins copy Islands.</p>
    </div>
    ${tableHtml(
      ['Map', 'Players', 'Crystal', 'Plasma', 'Nodes', 'Vents', 'Main', 'Layout'],
      MAPS.map((m) => [m.name, m.players, m.crystal.toLocaleString(), m.plasma.toLocaleString(), m.nodes, m.vents, m.main, m.layout]),
      [false, true, true, true, false, false, false, false]
    )}
  `
}

function renderCombat() {
  $('page-combat').innerHTML = `
    <h2 class="h2"><span>01</span> Engine</h2>
    ${tableHtml(
      ['Rule', 'Value'],
      [
        ['Idle auto-acquire (defensive)', COMBAT.autoAcquire + ' m, scan 0.5 s'],
        ['Aggressive acquire', COMBAT.aggressiveAcquire + ' m idle, ' + COMBAT.aggressiveHunt + ' m after a kill'],
        ['Hold ground acquire', 'Weapon range only'],
        ['Defensive leash', COMBAT.leash + ' m from guard point'],
        ['Building acquire', COMBAT.buildingAcquire + ' m'],
        ['Splash on secondary targets', COMBAT.splashFactor * 100 + '% of primary'],
        ['Default attack interval', COMBAT.defaultRate + ' s'],
        ['Worker damage / range', COMBAT.workerDamage + ' / ' + COMBAT.workerRange + ' m, no auto-aggro'],
        ['Min range to hit air', COMBAT.minAntiAirRange + ' m (or titan / heavy air)']
      ]
    )}

    <h2 class="h2"><span>02</span> Who shoots whom</h2>
    ${tableHtml(['Attacker', 'Ground', 'Air', 'Buildings'], TARGETING)}
    <div class="note warn">Siege cannot elevate. Turrets can. A flyer parked on a dug-in Sunlance is safe from the cannon and still takes turret fire.</div>

    <h2 class="h2"><span>03</span> Turret vs siege</h2>
    <div class="kpi-row">
      ${kpi('Turret', COMBAT.turretRange + ' m / ' + COMBAT.turretDamage + ' DPS')}
      ${kpi('Turret HP', COMBAT.turretHp)}
      ${kpi('Dug-in siege', '12–13.5 m')}
      ${kpi('Mobile siege', COMBAT.siegeMobileRange + ' m')}
      ${kpi('Transform', COMBAT.siegeTransform + ' s')}
    </div>

    <h2 class="h2"><span>04</span> Healers</h2>
    ${tableHtml(
      ['Race', 'Name', 'Rate', 'Range', 'Mode'],
      RACES.map((id) => {
        const h = HEALERS[id]
        return [RACE_META[id].short, h.name, h.rate + ' HP/s', h.range + ' m', h.mode]
      })
    )}

    <h2 class="h2"><span>05</span> Casters</h2>
    <div class="kpi-row">
      ${kpi('Max energy', CASTER.maxEnergy)}
      ${kpi('Regen', CASTER.regen + ' / s')}
      ${kpi('Ability cost', CASTER.cost)}
      ${kpi('Manual range', CASTER.castRange + ' m')}
    </div>
    ${tableHtml(
      ['Race', 'Ability', 'Cooldown', 'Effect'],
      RACES.map((id) => {
        const a = CASTER.abilities[id]
        return [RACE_META[id].short, a.name, a.cd + ' s', a.effect]
      })
    )}
    <p class="chart-cap">Auto-casts on a normal attack when energy and cooldown are ready. 6 energy/s means another 40 energy in 6.7 s, so cooldown is the limiter for Vanguard (8 s).</p>

    <h2 class="h2"><span>06</span> Heroes</h2>
    ${tableHtml(
      ['Hero', 'HP', 'DPS', 'Passive', 'Active', 'CD'],
      RACES.map((id) => {
        const h = HEROES[id]
        return [
          h.name,
          h.hp,
          (h.dmg / h.rate).toFixed(1),
          h.passive,
          h.active,
          h.cooldown + ' s'
        ]
      }),
      [false, true, true, false, false, true]
    )}

    <h2 class="h2"><span>07</span> Utility (50 crystal)</h2>
    ${tableHtml(
      ['Race', 'Building', 'Effect'],
      RACES.map((id) => [RACE_META[id].short, UTILITY[id].name, UTILITY[id].effect])
    )}
  `
}

function renderCampaign() {
  $('page-campaign').innerHTML = `
    <h2 class="h2"><span>01</span> AI difficulty</h2>
    ${tableHtml(['', ...AI.headers], AI.rows)}
    <p class="chart-cap">Hard is the only income cheat. Easy never researches and waves every 2.5 min. Barracks at 6 workers; tech at 8; turrets at 7 workers + a barracks.</p>

    <h2 class="h2"><span>02</span> Survive-mission assault overlay</h2>
    <div class="kpi-row">
      ${kpi('Hold timer', ASSAULT.survive / 60 + ':00')}
      ${kpi('Wave interval', ASSAULT.wave + ' s')}
      ${kpi('First attack', ASSAULT.first + ' s')}
      ${kpi('Workers', ASSAULT.workers)}
      ${kpi('Army target', ASSAULT.army)}
      ${kpi('Gather', ASSAULT.gather + '×')}
    </div>
    <p class="chart-cap">Mission 6 in every campaign. No turrets, no expand, no research. Razing the enemy still wins early.</p>

    <h2 class="h2"><span>03</span> Eight-mission curve</h2>
    ${tableHtml(
      ['#', 'Act', 'Difficulty', 'Opponents', 'Map', 'Player extras'],
      CAMPAIGN.map((m) => [m.n, m.act, m.diff, m.opp, m.map, m.extras]),
      [true, false, false, false, false, false]
    )}

    <h2 class="h2"><span>04</span> Mission names</h2>
    ${tableHtml(
      ['#', 'Vanguard — The Last Colony', 'Aethyr — The Rift War', 'Myriad — The Bloom'],
      MISSIONS.human.map((name, i) => [i + 1, name, MISSIONS.alien[i], MISSIONS.bio[i]]),
      [true, false, false, false]
    )}
    <p class="chart-cap">24 missions. Sequential unlock per campaign. Portraits at 8/8 per race, Shattered Crown at 24/24. Ranked frames at 1 / 5 / 15 / 40 wins. Sovereign: a ranked win as each race.</p>
  `
}

function renderAnalysis() {
  $('page-analysis').innerHTML = ANALYSIS.map(
    (a) => `<article class="analysis-block"><h3>${a.title}</h3><p>${a.body}</p></article>`
  ).join('')
}

const PAGES = {
  overview: renderOverview,
  units: renderUnits,
  compare: renderCompare,
  economy: renderEconomy,
  combat: renderCombat,
  campaign: renderCampaign,
  analysis: renderAnalysis
}

function showPage(id) {
  state.page = id
  document.querySelectorAll('.bal-page').forEach((el) => {
    el.hidden = el.id !== 'page-' + id
  })
  document.querySelectorAll('.bal-tab').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.page === id)
  })
  PAGES[id]()
  window.scrollTo(0, 0)
}

document.querySelectorAll('.bal-tab').forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.page))
})

const burger = document.getElementById('navBurger')
if (burger) {
  burger.addEventListener('click', () => document.querySelector('.nav-links').classList.toggle('open'))
}

$('balVersion').textContent = 'v' + BALANCE_VERSION
showPage('overview')
