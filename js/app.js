// ---------------------------------------------------------------------------
// DecentraCraft site interactivity: faction cards, the wiki grid and the
// detail modal. Plain vanilla JS - open index.html and it just works.
// ---------------------------------------------------------------------------

/* global RACES, UNITS, BUILDINGS */

let activeRace = 'human'
let activeCat = 'units'

const $ = (id) => document.getElementById(id)

function iconPath(stem, race) {
  return `assets/icons/${stem}${RACES[race].iconSuffix}.jpg`
}

function costText(m, g) {
  if (!m && !g) return 'Free'
  const parts = []
  if (m) parts.push(`<span class="c-min">${m} crystal</span>`)
  if (g) parts.push(`<span class="c-gas">${g} plasma</span>`)
  return parts.join(' · ')
}

// ------------------------------ Factions ------------------------------

function buildFactions() {
  const grid = $('factionGrid')
  grid.innerHTML = Object.values(RACES)
    .map((race) => {
      const heroImg = iconPath('icon-unit-hero', race.id)
      return `
      <article class="faction-card reveal" style="--fc:${race.accent}">
        <div class="faction-portrait" style="background-image:url('${heroImg}')"></div>
        <div class="faction-body">
          <h3>${race.name}</h3>
          <p class="f-tag">${race.tagline}</p>
          <p>${race.trait}</p>
          <div class="f-hero">
            <p><strong>${race.hero}</strong> — ${race.heroTrait}</p>
            <p>${race.heroAbility}</p>
          </div>
        </div>
      </article>`
    })
    .join('')
}

// ------------------------------ Wiki grid ------------------------------

function buildWiki() {
  const grid = $('wikiGrid')
  const race = RACES[activeRace]

  if (activeCat === 'units') {
    grid.innerHTML = UNITS.map((unit, index) => {
      const stats = unit.perRace[activeRace]
      return `
      <button class="wiki-card reveal shown" style="--rc:${race.accent}" data-kind="unit" data-index="${index}">
        <img src="${iconPath(unit.icon, activeRace)}" alt="${stats.name}" loading="lazy" />
        <div class="wc-body">
          <div class="wc-name">${stats.name}</div>
          <div class="wc-role">${unit.label}</div>
          <div class="wc-cost">${costText(stats.m, stats.g)}</div>
        </div>
      </button>`
    }).join('')
  } else {
    grid.innerHTML = BUILDINGS.map((building, index) => `
      <button class="wiki-card reveal shown" style="--rc:${race.accent}" data-kind="building" data-index="${index}">
        <img src="${iconPath(building.icon, activeRace)}" alt="${building.names[activeRace]}" loading="lazy" />
        <div class="wc-body">
          <div class="wc-name">${building.names[activeRace]}</div>
          <div class="wc-role">${building.label}</div>
          <div class="wc-cost">${costText(building.m, building.g)}</div>
        </div>
      </button>`).join('')
  }

  grid.querySelectorAll('.wiki-card').forEach((card) => {
    card.addEventListener('click', () => openModal(card.dataset.kind, Number(card.dataset.index)))
  })
}

// ------------------------------ Modal ------------------------------

function statBox(label, value) {
  return value === undefined || value === null || value === '' ? '' : `<div class="stat"><div class="s-label">${label}</div><div class="s-value">${value}</div></div>`
}

function openModal(kind, index, raceId = activeRace) {
  const race = RACES[raceId]
  const body = $('modalBody')
  let html = ''

  if (kind === 'unit') {
    const unit = UNITS[index]
    const s = unit.perRace[raceId]
    html = `
      <div class="modal-hero" style="--rc:${race.accent}">
        <img src="${iconPath(unit.icon, raceId)}" alt="${s.name}" />
        <div>
          <div class="mh-role" style="color:${race.accent}">${race.name} · ${unit.label}</div>
          <h3>${s.name}</h3>
          <p class="mh-blurb">${unit.blurb}</p>
        </div>
      </div>
      <div class="modal-stats">
        ${statBox('Hit Points', s.hp)}
        ${statBox('Damage', s.dmg)}
        ${statBox('Healing', s.heal)}
        ${statBox('Range', s.rng ? s.rng + 'm' : undefined)}
        ${statBox('Splash', s.splash ? s.splash + 'm' : undefined)}
        ${statBox('Speed', s.spd ? s.spd + ' m/s' : undefined)}
        ${statBox('Cargo', s.cargo ? s.cargo + ' units' : undefined)}
        ${statBox('Cost', s.m || s.g ? `${s.m ? s.m + 'c' : ''}${s.m && s.g ? ' / ' : ''}${s.g ? s.g + 'p' : ''}` : 'Free')}
        ${statBox('Supply', s.supply || undefined)}
        ${statBox('Build Time', s.time ? s.time + 's' : undefined)}
      </div>
      <div class="modal-extra">
        <p><strong>Trained at:</strong> ${unit.trainedAt}</p>
        ${unit.role === 'hero' ? `<p><strong>Trait:</strong> ${race.heroTrait}</p><p><strong>Ability:</strong> ${race.heroAbility}</p>` : ''}
      </div>
      <div class="modal-races" style="--rc:${race.accent}">
        ${Object.values(RACES).map((r) => `<button data-race="${r.id}" class="${r.id === raceId ? 'active' : ''}">${r.name}: ${unit.perRace[r.id].name}</button>`).join('')}
      </div>`
  } else {
    const building = BUILDINGS[index]
    html = `
      <div class="modal-hero" style="--rc:${race.accent}">
        <img src="${iconPath(building.icon, raceId)}" alt="${building.names[raceId]}" />
        <div>
          <div class="mh-role" style="color:${race.accent}">${race.name} · ${building.label}</div>
          <h3>${building.names[raceId]}</h3>
          <p class="mh-blurb">${building.blurb}</p>
        </div>
      </div>
      <div class="modal-stats">
        ${statBox('Hit Points', building.hp)}
        ${statBox('Cost', `${building.m ? building.m + 'c' : ''}${building.m && building.g ? ' / ' : ''}${building.g ? building.g + 'p' : ''}`)}
        ${statBox('Build Time', building.time + 's')}
        ${statBox('Notes', building.supply || undefined)}
      </div>
      <div class="modal-races" style="--rc:${race.accent}">
        ${Object.values(RACES).map((r) => `<button data-race="${r.id}" class="${r.id === raceId ? 'active' : ''}">${r.name}: ${building.names[r.id]}</button>`).join('')}
      </div>`
  }

  body.innerHTML = html
  body.querySelectorAll('.modal-races button').forEach((button) => {
    button.addEventListener('click', () => openModal(kind, index, button.dataset.race))
  })
  $('modalBackdrop').hidden = false
  document.body.style.overflow = 'hidden'
}

function closeModal() {
  $('modalBackdrop').hidden = true
  document.body.style.overflow = ''
}

// ------------------------------ Wiring ------------------------------

document.querySelectorAll('.race-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    activeRace = tab.dataset.race
    document.querySelectorAll('.race-tab').forEach((t) => t.classList.toggle('active', t === tab))
    buildWiki()
  })
})

document.querySelectorAll('.cat-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    activeCat = tab.dataset.cat
    document.querySelectorAll('.cat-tab').forEach((t) => t.classList.toggle('active', t === tab))
    buildWiki()
  })
})

$('modalClose').addEventListener('click', closeModal)
$('modalBackdrop').addEventListener('click', (event) => {
  if (event.target === $('modalBackdrop')) closeModal()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal()
})

// Mobile nav
$('navBurger').addEventListener('click', () => {
  document.querySelector('.nav-links').classList.toggle('open')
})
document.querySelectorAll('.nav-links a').forEach((link) => {
  link.addEventListener('click', () => document.querySelector('.nav-links').classList.remove('open'))
})

// Reveal-on-scroll for section blocks
const revealObserver = new IntersectionObserver(
  (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('shown')),
  { threshold: 0.12 }
)
document.querySelectorAll('.lore-block, .map-card, .team-card, .step').forEach((element) => {
  element.classList.add('reveal')
  revealObserver.observe(element)
})

buildFactions()
document.querySelectorAll('.faction-card').forEach((element) => revealObserver.observe(element))
buildWiki()
