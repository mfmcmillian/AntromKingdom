// Live v1.3.3 numbers from src/rts (races, config, upgrades, campaign, maps, combat).
// DPS is derived in balance.js as damage / attackRate (default rate 1).

const BALANCE_VERSION = '1.3.3'

const RACE_META = {
  human: {
    id: 'human',
    name: 'VANGUARD',
    short: 'Vanguard',
    accent: '#73b3ff',
    tagline: 'Baseline all-rounder. Crews repair 1.75×.',
    identity: 'Middle cost, middle power, middle train times. Repair 21 HP/s. Beacon vision 42 m. Kael aura +25% damage in 9 m.'
  },
  alien: {
    id: 'alien',
    name: 'AETHYR',
    short: 'Aethyr',
    accent: '#d9a6ff',
    tagline: 'Expensive, durable, slow. Buildings self-assemble.',
    identity: 'Highest HP and damage, longest trains, plasma on T1 melee. Seeded buildings finish at 0.5× worker speed. Auren 4 HP/s.'
  },
  bio: {
    id: 'bio',
    name: 'MYRIAD',
    short: 'Myriad',
    accent: '#ff7350',
    tagline: 'Cheap, fast, fragile swarm. 1 HP/s regen.',
    identity: 'Lowest cost and HP, fastest trains. Every living unit regenerates 1 HP/s. Szel births a free Mauler every 35 s.'
  }
}

const OPENING = {
  crystal: 50,
  plasma: 0,
  workers: 5,
  supplyUsed: 5,
  supplyCap: 10,
  heroSupply: 0,
  mapSize: 160,
  defaultStance: 'defensive'
}

const GATHER = {
  mineTime: 3,
  carry: 10,
  richCarry: 15,
  workerSpeed: 2.5,
  nodeCrystal: 750,
  nodePlasma: 1500,
  richCrystal: 1125,
  richPlasma: 2250,
  typicalMainIncome: 0.64,
  typicalMainIncomeNote: 'SW HQ to crystal line ≈ 16 m. Round trip 12.6 s walk + 3 s mine = 15.6 s → 10 / 15.6 = 0.64 crystal/s.'
}

const COMBAT = {
  autoAcquire: 12,
  aggressiveAcquire: 18,
  aggressiveHunt: 22,
  leash: 15,
  buildingAcquire: 18,
  splashFactor: 0.6,
  defaultRate: 1,
  workerDamage: 3,
  workerRange: 1.6,
  minAntiAirRange: 4,
  siegeTransform: 1.4,
  siegeMobileFactor: 0.5,
  siegeMobileRange: 7.5,
  turretRange: 10,
  turretDamage: 14,
  turretRate: 1,
  turretHp: 260
}

const CASTER = {
  maxEnergy: 100,
  regen: 6,
  cost: 40,
  castRange: 12,
  abilities: {
    human: { name: 'Chain Lightning', cd: 8, effect: 'Up to 3 arcs, 7 m, 70% weapon damage each' },
    alien: { name: 'Time Fracture', cd: 10, effect: '5 m, 50% move speed for 3 s (soldiers only)' },
    bio: { name: 'Spore Plague', cd: 9, effect: '5 m, 4 HP/s poison for 5 s' }
  }
}

const HEROES = {
  human: {
    name: 'Warmaster Kael',
    hp: 550, dmg: 26, rate: 1.1, range: 6.5, speed: 3, splash: 0,
    passive: 'Allied fighters within 9 m deal ×1.25 damage',
    active: 'Rally Cry: 60 HP to allies in 10 m',
    cooldown: 45
  },
  alien: {
    name: 'Riftlord Auren',
    hp: 650, dmg: 34, rate: 1.6, range: 7.5, speed: 2.6, splash: 3.5,
    passive: '4 HP/s self-heal (full bar in 162.5 s idle)',
    active: 'Rift Nova: 45 damage to enemies in 8 m',
    cooldown: 45
  },
  bio: {
    name: 'Broodmother Szel',
    hp: 750, dmg: 24, rate: 1.4, range: 2.2, speed: 3.2, splash: 1.6,
    passive: 'Free Mauler every 35 s if supply allows',
    active: 'Birth Surge: 3 free Maulers',
    cooldown: 60
  }
}

const HEALERS = {
  human: { name: 'Field Medic', rate: 9, range: 2.5, scan: 12, mode: 'Single-target beam, idle only, units only' },
  alien: { name: 'Lightmender', rate: 7, range: 3, scan: 12, mode: 'Single-target beam, idle only, units and completed buildings' },
  bio: { name: 'Broodtender', rate: 3, range: 3.5, scan: 0, mode: 'Aura on every nearby ally, including while moving. No buildings.' }
}

const UTILITY = {
  human: { name: 'Beacon', effect: 'Vision 42 m (units 18, other buildings 24)' },
  alien: { name: 'Obelisk', effect: '+25% move speed in 9 m, refresh 0.5 s' },
  bio: { name: 'Spore Mound', effect: 'Poison hostiles in 8 m: 3 HP/s, 2.5 s' }
}

const BUILDINGS = [
  { slot: 'HQ', names: 'Command Post / Monolith / Brood Heart', m: 300, g: 0, hp: 400, time: 10, supply: '+10', requires: '—' },
  { slot: 'Supply', names: 'Habitat / Conduit / Growth Pod', m: 100, g: 0, hp: 150, time: 5, supply: '+5', requires: '—' },
  { slot: 'Barracks', names: 'Armory / Rift Gate / Spawning Pit', m: 150, g: 0, hp: 250, time: 8, supply: '0', requires: '—' },
  { slot: 'Tech', names: 'Starforge / Sanctum / Grand Nest', m: 200, g: 100, hp: 220, time: 9, supply: '0', requires: 'Barracks' },
  { slot: 'Forge', names: 'Foundry / Ascension Spire / Mutation Den', m: 150, g: 50, hp: 200, time: 7, supply: '0', requires: 'Barracks' },
  { slot: 'Air forge', names: 'Skyharbor / Zenith Spire / Wind Roost', m: 150, g: 100, hp: 220, time: 8, supply: '0', requires: 'Tech' },
  { slot: 'Turret', names: 'Sentry Cannon / Arc Spire / Thorn Mound', m: 100, g: 25, hp: 260, time: 6, supply: '0', requires: 'Barracks' },
  { slot: 'Utility', names: 'Beacon / Obelisk / Spore Mound', m: 50, g: 0, hp: 120, time: 4, supply: '0', requires: '—' }
]

const UPGRADES = [
  { track: 'Weapons', per: '+20% ground damage', costs: ['100/50', '175/100', '250/175'], total: '525 / 325', times: '15 / 22 / 30 s' },
  { track: 'Propulsion', per: '+10% ground speed', costs: ['75/50', '150/100', '225/150'], total: '450 / 300', times: '15 / 22 / 30 s' },
  { track: 'Flight weapons', per: '+20% flyer damage', costs: ['100/75', '150/125', '200/175'], total: '450 / 375', times: '15 / 22 / 30 s' },
  { track: 'Flight propulsion', per: '+10% flyer speed', costs: ['75/50', '125/100', '175/150'], total: '375 / 300', times: '15 / 22 / 30 s' }
]

const MAPS = [
  { name: 'Shattered Crown', players: 6, crystal: 75375, plasma: 34500, nodes: '97 (7 rich)', vents: '22 (2 rich)', main: '7 crystal + 2 vents', layout: 'Solid. Natural each. Rich mid.' },
  { name: 'Islands', players: 6, crystal: 56250, plasma: 31500, nodes: '72 (6 rich)', vents: '20 (2 rich)', main: '6 crystal + 2 vents', layout: 'No land routes. Transports.' },
  { name: 'Ashen Procession', players: 4, crystal: 60750, plasma: 28500, nodes: '78 (6 rich)', vents: '18 (2 rich)', main: '7 crystal + 2 vents', layout: 'Two halves, one road.' },
  { name: 'Twin Reliquaries', players: 2, crystal: 44250, plasma: 19500, nodes: '56 (6 rich)', vents: '12 (2 rich)', main: '7 crystal + 2 vents', layout: '1v1 solid, flanks + mid.' }
]

const AI = {
  headers: ['Easy', 'Medium', 'Hard'],
  rows: [
    ['Decision rate', '3 s', '1.5 s', '1 s'],
    ['Attack interval', '150 s', '90 s', '70 s'],
    ['First-wave head start', '0 s', '25 s', '30 s'],
    ['Defenders held', '2', '4', '5'],
    ['Target workers', '9', '14', '24'],
    ['Target army', '8', '18', '24'],
    ['Max advanced units', '2', '8', '12'],
    ['Max supply buildings', '4', '7', '8'],
    ['Max HQs', '1', '3', '4'],
    ['Max turrets', '1', '2', '3'],
    ['Research', 'No', 'Yes', 'Yes'],
    ['Expands', 'No', 'No', 'Yes'],
    ['Gather multiplier', '1.00×', '1.00×', '1.25×']
  ]
}

const ASSAULT = {
  wave: 42,
  first: 18,
  workers: 10,
  army: 22,
  gather: 1.2,
  turrets: 0,
  survive: 360
}

const CAMPAIGN = [
  { n: 1, act: 'Teach eco', diff: 'Easy', opp: '1 other race', map: 'Home ground', extras: '+100 crystal' },
  { n: 2, act: 'Teach barracks', diff: 'Easy', opp: '1 remaining race', map: 'Home ground', extras: '+80 crystal, pre-built barracks' },
  { n: 3, act: 'Medium 1v1', diff: 'Medium', opp: '1', map: 'Open war', extras: 'Standard bank' },
  { n: 4, act: 'FFA 1v2', diff: 'Med + Easy', opp: '2, they fight', map: 'Ashen Procession', extras: 'Standard bank' },
  { n: 5, act: 'Islands', diff: 'Medium', opp: '1', map: 'No land bridge', extras: '+120 crystal, +50 plasma' },
  { n: 6, act: 'Survive 6:00', diff: 'Medium assault', opp: '1', map: 'Home / road', extras: '+150/40, barracks, 2 turrets' },
  { n: 7, act: 'Hard 1v1', diff: 'Hard', opp: '1 rival hero race', map: 'Crown / Reliquaries', extras: 'Standard bank' },
  { n: 8, act: 'Finale 1v2 team', diff: 'Hard + Hard', opp: '2 allied vs you', map: 'Themed islands', extras: '+40 plasma; enemy 2 turrets + barracks' }
]

const MISSIONS = {
  human: ['Dustfall', 'Foundry Floor', 'Rift Line', 'Two Predators', 'Skyhaul', 'Hold the Line', 'High Command', 'Last Colony'],
  alien: ['First Light', 'Gate Open', 'Trespassers', 'Split Sky', 'Void Crossing', 'Hold the Spire', 'Warmaster', 'Twin Suns'],
  bio: ['First Taste', 'Nest Rising', 'The Hunt', 'Two Herds', 'Across the Water', 'Hold the Heart', 'Golden Prey', 'The Feast']
}

const TARGETING = [
  ['Melee / worker / close hero', 'Yes', 'No (range < 4)', 'Yes'],
  ['Ranged / caster / flyer / heavy air', 'Yes', 'Yes', 'Yes'],
  ['Anti-air', 'No', 'Yes only', 'No'],
  ['Siege', 'Yes', 'No', 'Yes'],
  ['Titan / heavy air', 'Yes', 'Yes', 'Yes'],
  ['Healer / transport', 'Never', 'Never', 'Never'],
  ['Turret 10 m / 14 DPS', 'Yes', 'Yes — no air check', 'No']
]

// rate omitted = 1. Siege rows are deployed stats; mobile is derived in JS.
const UNITS = [
  { role: 'Worker', key: 'worker', train: 'HQ',
    human: { name: 'Rigger', hp: 35, dmg: 3, rate: 1, range: 1.6, speed: 2.5, splash: 0, m: 50, g: 0, time: 2, supply: 1, notes: 'No auto-aggro' },
    alien: { name: 'Seeker', hp: 35, dmg: 3, rate: 1, range: 1.6, speed: 2.5, splash: 0, m: 50, g: 0, time: 2.5, supply: 1, notes: 'Slowest worker' },
    bio: { name: 'Grub', hp: 30, dmg: 3, rate: 1, range: 1.6, speed: 2.5, splash: 0, m: 50, g: 0, time: 1.5, supply: 1, notes: 'Fastest worker + regen' }
  },
  { role: 'Melee', key: 'melee', train: 'Barracks',
    human: { name: 'Breacher', hp: 100, dmg: 11, rate: 1, range: 1.8, speed: 3, splash: 0, m: 100, g: 0, time: 2, supply: 1, notes: 'Cannot hit air' },
    alien: { name: 'Sentinel', hp: 125, dmg: 16, rate: 1, range: 1.8, speed: 2.8, splash: 0, m: 125, g: 50, time: 3, supply: 1, notes: 'Only T1 melee with plasma' },
    bio: { name: 'Mauler', hp: 55, dmg: 7, rate: 1, range: 1.8, speed: 3.6, splash: 0, m: 50, g: 0, time: 1.2, supply: 1, notes: 'Fastest / cheapest fighter' }
  },
  { role: 'Ranged', key: 'ranged', train: 'Barracks',
    human: { name: 'Longshot', hp: 70, dmg: 9, rate: 1, range: 6, speed: 2.9, splash: 0, m: 80, g: 25, time: 2.2, supply: 1, notes: 'Hits air' },
    alien: { name: 'Lancer', hp: 85, dmg: 13, rate: 1, range: 7, speed: 2.7, splash: 0, m: 100, g: 75, time: 3.2, supply: 1, notes: 'Longest T1 gun' },
    bio: { name: 'Spitter', hp: 45, dmg: 6, rate: 1, range: 5.5, speed: 3.2, splash: 0, m: 50, g: 25, time: 1.4, supply: 1, notes: 'Shortest gun range' }
  },
  { role: 'Healer', key: 'healer', train: 'Barracks',
    human: { name: 'Field Medic', hp: 60, dmg: 0, rate: 1, range: 2.5, speed: 3.1, splash: 0, m: 75, g: 50, time: 2.5, supply: 1, notes: '9 HP/s beam' },
    alien: { name: 'Lightmender', hp: 85, dmg: 0, rate: 1, range: 3, speed: 2.7, splash: 0, m: 100, g: 75, time: 3.2, supply: 1, notes: '7 HP/s, mends buildings' },
    bio: { name: 'Broodtender', hp: 50, dmg: 0, rate: 1, range: 3.5, speed: 3.4, splash: 0, m: 60, g: 25, time: 1.6, supply: 1, notes: '3 HP/s aura while moving' }
  },
  { role: 'Caster', key: 'caster', train: 'Barracks',
    human: { name: 'Stormcaller', hp: 60, dmg: 14, rate: 1.7, range: 7, speed: 2.7, splash: 2.8, m: 100, g: 100, time: 3.5, supply: 2, notes: 'Chain Lightning' },
    alien: { name: 'Riftweaver', hp: 70, dmg: 18, rate: 1.9, range: 8, speed: 2.6, splash: 3.2, m: 125, g: 125, time: 4, supply: 2, notes: 'Time Fracture' },
    bio: { name: 'Plague Weaver', hp: 50, dmg: 10, rate: 1.5, range: 6, speed: 3, splash: 2.6, m: 80, g: 60, time: 2.5, supply: 2, notes: 'Spore Plague' }
  },
  { role: 'Anti-air', key: 'antiAir', train: 'Barracks',
    human: { name: 'Flakgunner', hp: 70, dmg: 16, rate: 1.1, range: 8, speed: 3.1, splash: 0, m: 75, g: 25, time: 2.4, supply: 1, notes: 'Air only' },
    alien: { name: 'Starlance', hp: 90, dmg: 20, rate: 1.3, range: 8.5, speed: 2.9, splash: 0, m: 100, g: 50, time: 3, supply: 1, notes: 'Air only' },
    bio: { name: 'Spore Lasher', hp: 55, dmg: 12, rate: 0.9, range: 7.5, speed: 3.5, splash: 0, m: 60, g: 25, time: 1.6, supply: 1, notes: 'Fastest AA cycle' }
  },
  { role: 'Flyer', key: 'flyer', train: 'Tech lab',
    human: { name: 'Kestrel', hp: 90, dmg: 12, rate: 0.9, range: 6.5, speed: 4.2, splash: 0, m: 120, g: 80, time: 3.5, supply: 2, notes: 'Starforge' },
    alien: { name: 'Zephyr', hp: 110, dmg: 15, rate: 1.1, range: 7, speed: 3.9, splash: 0, m: 150, g: 100, time: 4, supply: 2, notes: 'Sanctum' },
    bio: { name: 'Shrieker', hp: 70, dmg: 9, rate: 0.8, range: 5.5, speed: 4.5, splash: 0, m: 90, g: 50, time: 2.2, supply: 2, notes: 'Fastest flyer' }
  },
  { role: 'Transport', key: 'transport', train: 'Tech lab',
    human: { name: 'Skyhauler', hp: 160, dmg: 0, rate: 1, range: 0, speed: 3.6, splash: 0, m: 150, g: 75, time: 4, supply: 2, notes: '8 cargo, unarmed' },
    alien: { name: 'Riftbarge', hp: 200, dmg: 0, rate: 1, range: 0, speed: 3.3, splash: 0, m: 175, g: 100, time: 4.5, supply: 2, notes: '8 cargo, unarmed' },
    bio: { name: 'Broodwing', hp: 130, dmg: 0, rate: 1, range: 0, speed: 3.9, splash: 0, m: 125, g: 50, time: 3, supply: 2, notes: 'Cheapest ferry' }
  },
  { role: 'Heavy air', key: 'heavyAir', train: 'Tech + air forge',
    human: { name: 'Dreadnought', hp: 340, dmg: 26, rate: 1.6, range: 7, speed: 2.5, splash: 1.8, m: 300, g: 200, time: 8, supply: 4, notes: 'Needs Skyharbor' },
    alien: { name: 'Solar Ark', hp: 400, dmg: 32, rate: 1.8, range: 7.5, speed: 2.3, splash: 2, m: 350, g: 250, time: 9, supply: 4, notes: 'Needs Zenith Spire' },
    bio: { name: 'Sky Leviathan', hp: 280, dmg: 20, rate: 1.3, range: 6.5, speed: 2.7, splash: 1.8, m: 250, g: 150, time: 6, supply: 4, notes: 'Splash vs ground and air' }
  },
  { role: 'Siege', key: 'siege', train: 'Tech + forge',
    human: { name: 'Thunderhead', hp: 170, dmg: 52, rate: 3, range: 12.5, speed: 2.15, splash: 3, m: 200, g: 125, time: 5.5, supply: 3, notes: 'Dug in. Immobile. No air.' },
    alien: { name: 'Sunlance', hp: 200, dmg: 68, rate: 3.3, range: 13.5, speed: 1.95, splash: 2.6, m: 250, g: 175, time: 6.5, supply: 3, notes: 'Highest single bolt' },
    bio: { name: 'Acidmaw', hp: 140, dmg: 38, rate: 2.6, range: 12, speed: 2.55, splash: 3.4, m: 150, g: 100, time: 4, supply: 3, notes: 'Poison 4 HP/s for 4 s' }
  },
  { role: 'Titan', key: 'titan', train: 'Tech + forge',
    human: { name: 'Juggernaut', hp: 380, dmg: 40, rate: 1.7, range: 2.8, speed: 2.2, splash: 2.2, m: 300, g: 200, time: 8, supply: 4, notes: 'Can swat air' },
    alien: { name: 'Avatar', hp: 450, dmg: 50, rate: 1.9, range: 3, speed: 2, splash: 2.4, m: 350, g: 250, time: 9, supply: 4, notes: 'Can swat air' },
    bio: { name: 'Behemoth', hp: 320, dmg: 30, rate: 1.5, range: 2.6, speed: 2.6, splash: 2, m: 250, g: 150, time: 6, supply: 4, notes: 'Can swat air' }
  },
  { role: 'Hero', key: 'hero', train: 'Match start',
    human: { name: 'Warmaster Kael', hp: 550, dmg: 26, rate: 1.1, range: 6.5, speed: 3, splash: 0, m: 0, g: 0, time: 0, supply: 0, notes: 'Aura ×1.25 in 9 m' },
    alien: { name: 'Riftlord Auren', hp: 650, dmg: 34, rate: 1.6, range: 7.5, speed: 2.6, splash: 3.5, m: 0, g: 0, time: 0, supply: 0, notes: '4 HP/s regen' },
    bio: { name: 'Broodmother Szel', hp: 750, dmg: 24, rate: 1.4, range: 2.2, speed: 3.2, splash: 1.6, m: 0, g: 0, time: 0, supply: 0, notes: 'Free Mauler / 35 s' }
  }
]

const ANALYSIS = [
  {
    title: 'The racial identity is real at T1, and it mostly survives later tiers',
    body: 'Myriad melee is 2× the DPS per crystal-equivalent of Aethyr and 1.3× Vanguard, with 1.2 s trains. Aethyr Sentinel is the only T1 melee that spends plasma (50), so a one-base Aethyr army is gated by vents in a way Vanguard and Myriad are not. Titan, heavy-air, and siege keep the same cost-efficiency order: Myriad 250+150, Vanguard 300+200, Aethyr 350+250.'
  },
  {
    title: 'Production is bursty compared with classic RTS clocks',
    body: 'A Vanguard Armory dumps a Breacher every 2 s. Ten melee is 20 s from one building. Fights resolve in a few volleys; the scarce resources are plasma, supply, and tech buildings, not factory time. One unit trains at a time per building.'
  },
  {
    title: 'Casters sit on the barracks, not the tech lab',
    body: 'Stormcaller is 100 crystal + 100 plasma from the Armory with no extra gate — the same plasma as a Tech Lab. Early gas is contested by Longshot (25), Flakgunner (25), Medic (50), and the caster (100). Aethyr’s T1 melee already wants 50 plasma, so Riftweaver (125) is a later barracks unit in practice even though the building allows it immediately.'
  },
  {
    title: 'Turrets answer air; siege does not',
    body: 'Siege outranges the 10 m turret only after a 1.4 s dig-in (12–13.5 m). Mobile siege is 7.5 m at half damage with no splash, so it loses the range war to a turret until deployed. Siege cannot elevate. Turret code has no air filter, so a flyer parked on a dug-in Sunlance is safe from the cannon and still takes Sentry Cannon fire.'
  },
  {
    title: 'Heroes are opening-game units, not late-game unlocks',
    body: 'Kael’s 23.6 DPS and 9 m aura are on the field at 0:00. Auren’s 4 HP/s is 240 HP/min. Szel’s 35 s Mauler is 50 crystal and 7 DPS of free army per tick; over a 6:00 survive that is up to 10 Maulers if supply is kept open (500 crystal and 70 DPS of free value). Heroes cost 0, take 0 supply, and cannot be rebuilt.'
  },
  {
    title: 'Hard’s only cheat is income; Easy’s only softness is tempo',
    body: 'Hard gather 1.25× on 24 workers is a 50% worker-count jump over Medium plus a 25% yield cheat. Easy does not under-gather; it waits 150 s between waves, skips research, and caps at 8 army / 1 HQ. Campaign missions 1–2 are Easy, so they test execution more than they test the racial math. Survive missions overlay 42 s waves from 18 s with 1.2× gather and no turrets.'
  },
  {
    title: 'Aethyr’s hidden eco perk offsets the 2.5 s worker',
    body: 'Seekers train 25% slower than Riggers. Seeded buildings keep assembling at half speed, so the Seeker can return to the line after the first tap. An 8 s barracks is 16 s unattended versus a Vanguard Rigger standing there for the full 8 s. That counterweight does not show up on the unit card.'
  },
  {
    title: 'Myriad regen is a swarm stat, not a hero stat',
    body: '1 HP/s is 1.8%/s on a Mauler and 0.13%/s on Szel. Broodtender aura (3 HP/s × N) is the actual sustain button. Combined with 3.6 move speed, Maulers want numbers and a tender, not even fights. 1v1 TTK: Breacher kills Mauler in 5.0 s; Mauler needs 14.3 s to kill a Breacher. Two Maulers versus one Breacher is a near-even mineral trade.'
  },
  {
    title: 'Main mineral lifetime is closer to 20 min than 10',
    body: 'A 7-node main is 5,250 crystal. At 1 worker/node and 0.64/s that lasts ~19.5 min. Config comments call 750 “~10 min of saturated mining”; hitting 10 min would need roughly two workers per node or much shorter travel. Rich center nodes last about as long but pay 1.5× income.'
  }
]
