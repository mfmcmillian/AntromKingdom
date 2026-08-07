// ---------------------------------------------------------------------------
// DecentraCraft wiki data. Stats mirror src/rts/races.ts and src/rts/config.ts
// in the game code - if the game rebalances, update the numbers here too.
// ---------------------------------------------------------------------------

const RACES = {
  human: {
    id: 'human',
    name: 'VANGUARD',
    color: '#5a8cd9',
    accent: '#73b3ff',
    tagline: 'Exiled colonists. Balanced units; crews repair structures fast.',
    trait: 'Repair crews weld structures and mech units back together 75% faster than anyone else.',
    hero: 'Warmaster Kael',
    heroTrait: 'Battle Standard: allied fighters near Kael deal +25% damage.',
    heroAbility: 'Rally Cry (45s cooldown) - heals allied fighters within 10m of Kael for 60 HP.',
    iconSuffix: ''
  },
  alien: {
    id: 'alien',
    name: 'AETHYR',
    color: '#bf9a3f',
    accent: '#d9a6ff',
    tagline: 'Ancient tech. Devastating units; structures assemble themselves.',
    trait: 'Structures self-assemble once seeded: the worker walks away and the building finishes itself at half speed.',
    hero: 'Riftlord Auren',
    heroTrait: 'Aetheric Ward: Auren constantly regenerates 4 HP per second.',
    heroAbility: 'Rift Nova (45s cooldown) - deals 45 damage to every enemy within 8m of Auren.',
    iconSuffix: '-alien'
  },
  bio: {
    id: 'bio',
    name: 'MYRIAD',
    color: '#c25248',
    accent: '#ff7350',
    tagline: 'Living horde. Cheap and fast; wounded units regenerate.',
    trait: 'Every living unit regenerates 1 HP per second. The swarm never stays wounded for long.',
    hero: 'Broodmother Szel',
    heroTrait: 'Endless Brood: Szel births a free Mauler every 35 seconds.',
    heroAbility: 'Birth Surge (60s cooldown) - Szel instantly births 3 free Maulers, supply permitting.',
    iconSuffix: '-bio'
  }
}

// Unit roles in tech order. icon = filename stem in assets/icons/.
// Stats per race: hp, dmg, spd, rng, cost (m=crystal, g=plasma), time, supply.
const UNITS = [
  {
    role: 'worker', icon: 'icon-unit-worker', label: 'Worker', trainedAt: 'Command structure',
    blurb: 'The economy. Harvests crystal and plasma, builds and repairs structures.',
    perRace: {
      human: { name: 'Rigger', hp: 35, m: 50, g: 0, time: 2, supply: 1 },
      alien: { name: 'Seeker', hp: 35, m: 50, g: 0, time: 2.5, supply: 1 },
      bio: { name: 'Grub', hp: 30, m: 50, g: 0, time: 1.5, supply: 1 }
    }
  },
  {
    role: 'melee', icon: 'icon-unit-melee', label: 'Melee Fighter', trainedAt: 'Barracks',
    blurb: 'Frontline brawler. Cheap, tough for its cost, and cannot reach the sky.',
    perRace: {
      human: { name: 'Breacher', hp: 100, dmg: 11, spd: 3, rng: 1.8, m: 100, g: 0, time: 2, supply: 1 },
      alien: { name: 'Sentinel', hp: 125, dmg: 16, spd: 2.8, rng: 1.8, m: 125, g: 50, time: 3, supply: 1 },
      bio: { name: 'Mauler', hp: 55, dmg: 7, spd: 3.6, rng: 1.8, m: 50, g: 0, time: 1.2, supply: 1 }
    }
  },
  {
    role: 'ranged', icon: 'icon-unit-ranged', label: 'Ranged Fighter', trainedAt: 'Barracks',
    blurb: 'Fires from a distance and can shoot down flyers. The backbone of any army.',
    perRace: {
      human: { name: 'Longshot', hp: 70, dmg: 9, spd: 2.9, rng: 6, m: 80, g: 25, time: 2.2, supply: 1 },
      alien: { name: 'Lancer', hp: 85, dmg: 13, spd: 2.7, rng: 7, m: 100, g: 75, time: 3.2, supply: 1 },
      bio: { name: 'Spitter', hp: 45, dmg: 6, spd: 3.2, rng: 5.5, m: 50, g: 25, time: 1.4, supply: 1 }
    }
  },
  {
    role: 'healer', icon: 'icon-unit-healer', label: 'Support / Healer', trainedAt: 'Barracks',
    blurb: 'Keeps the army alive. Never attacks. Each faction heals its own way: single-target beam, structure-mending beam, or a regeneration aura.',
    perRace: {
      human: { name: 'Field Medic', hp: 60, spd: 3.1, rng: 2.5, heal: '9 HP/s beam', m: 75, g: 50, time: 2.5, supply: 1 },
      alien: { name: 'Lightmender', hp: 85, spd: 2.7, rng: 3, heal: '7 HP/s beam, also mends structures', m: 100, g: 75, time: 3.2, supply: 1 },
      bio: { name: 'Broodtender', hp: 50, spd: 3.4, rng: 3.5, heal: '3 HP/s aura, all nearby allies', m: 60, g: 25, time: 1.6, supply: 1 }
    }
  },
  {
    role: 'caster', icon: 'icon-unit-caster', label: 'Spellcaster', trainedAt: 'Barracks',
    blurb: 'Slow, heavy blasts that splash every enemy near the impact. Melts clumped armies.',
    perRace: {
      human: { name: 'Stormcaller', hp: 60, dmg: 14, spd: 2.7, rng: 7, splash: 2.8, m: 100, g: 100, time: 3.5, supply: 2 },
      alien: { name: 'Riftweaver', hp: 70, dmg: 18, spd: 2.6, rng: 8, splash: 3.2, m: 125, g: 125, time: 4, supply: 2 },
      bio: { name: 'Plague Weaver', hp: 50, dmg: 10, spd: 3, rng: 6, splash: 2.6, m: 80, g: 60, time: 2.5, supply: 2 }
    }
  },
  {
    role: 'antiAir', icon: 'icon-unit-antiair', label: 'Anti-Air Trooper', trainedAt: 'Barracks',
    blurb: 'A dedicated flak specialist. Long-range weapon that ONLY hits airborne targets - it completely ignores everything on the ground.',
    perRace: {
      human: { name: 'Flakgunner', hp: 70, dmg: 16, spd: 3.1, rng: 8, m: 75, g: 25, time: 2.4, supply: 1 },
      alien: { name: 'Starlance', hp: 90, dmg: 20, spd: 2.9, rng: 8.5, m: 100, g: 50, time: 3, supply: 1 },
      bio: { name: 'Spore Lasher', hp: 55, dmg: 12, spd: 3.5, rng: 7.5, m: 60, g: 25, time: 1.6, supply: 1 }
    }
  },
  {
    role: 'flyer', icon: 'icon-unit-flyer', label: 'Flyer', trainedAt: 'Tech structure',
    blurb: 'Fast gunship that hovers over the battlefield. Crosses water freely on island maps; only ranged weapons, titans and anti-air can touch it.',
    perRace: {
      human: { name: 'Kestrel Gunship', hp: 90, dmg: 12, spd: 4.2, rng: 6.5, m: 120, g: 80, time: 3.5, supply: 2 },
      alien: { name: 'Zephyr', hp: 110, dmg: 15, spd: 3.9, rng: 7, m: 150, g: 100, time: 4, supply: 2 },
      bio: { name: 'Shrieker', hp: 70, dmg: 9, spd: 4.5, rng: 5.5, m: 90, g: 50, time: 2.2, supply: 2 }
    }
  },
  {
    role: 'transport', icon: 'icon-unit-transport', label: 'Transport', trainedAt: 'Tech structure',
    blurb: 'Unarmed flying carrier. Loads up to 8 ground units and ferries them across the water - the only way ground armies leave home on Islands.',
    perRace: {
      human: { name: 'Skyhauler', hp: 160, spd: 3.6, cargo: 8, m: 150, g: 75, time: 4, supply: 2 },
      alien: { name: 'Riftbarge', hp: 200, spd: 3.3, cargo: 8, m: 175, g: 100, time: 4.5, supply: 2 },
      bio: { name: 'Broodwing', hp: 130, spd: 3.9, cargo: 8, m: 125, g: 50, time: 3, supply: 2 }
    }
  },
  {
    role: 'heavyAir', icon: 'icon-unit-heavyair', label: 'Capital Ship', trainedAt: 'Tech structure (requires Flight structure)',
    blurb: 'The heavy end of the sky. Slow, heavily armored, splash damage against ground AND air. Only anti-air-capable weapons can answer it.',
    perRace: {
      human: { name: 'Dreadnought', hp: 340, dmg: 26, spd: 2.5, rng: 7, splash: 1.8, m: 300, g: 200, time: 8, supply: 4 },
      alien: { name: 'Solar Ark', hp: 400, dmg: 32, spd: 2.3, rng: 7.5, splash: 2, m: 350, g: 250, time: 9, supply: 4 },
      bio: { name: 'Sky Leviathan', hp: 280, dmg: 20, spd: 2.7, rng: 6.5, splash: 1.8, m: 250, g: 150, time: 6, supply: 4 }
    }
  },
  {
    role: 'siege', icon: 'icon-unit-siege', label: 'Siege Artillery', trainedAt: 'Tech structure (requires Upgrade structure)',
    blurb: 'Weak while mobile - dig in to grow the cannon. Deployed, it outranges defense towers and shatters bases. Cannot hit air.',
    perRace: {
      human: { name: 'Thunderhead', hp: 150, dmg: 44, spd: 1.9, rng: 11, splash: 2.6, m: 200, g: 125, time: 5.5, supply: 3 },
      alien: { name: 'Sunlance', hp: 180, dmg: 58, spd: 1.7, rng: 12, splash: 2.2, m: 250, g: 175, time: 6.5, supply: 3 },
      bio: { name: 'Acidmaw', hp: 120, dmg: 30, spd: 2.3, rng: 10.5, splash: 3, m: 150, g: 100, time: 4, supply: 3 }
    }
  },
  {
    role: 'titan', icon: 'icon-unit-titan', label: 'Titan', trainedAt: 'Tech structure (requires Upgrade structure)',
    blurb: 'A walking siege engine. Massive HP, splash stomps, and big enough to swat flyers out of the sky.',
    perRace: {
      human: { name: 'Juggernaut', hp: 380, dmg: 40, spd: 2.2, rng: 2.8, splash: 2.2, m: 300, g: 200, time: 8, supply: 4 },
      alien: { name: 'Avatar', hp: 450, dmg: 50, spd: 2, rng: 3, splash: 2.4, m: 350, g: 250, time: 9, supply: 4 },
      bio: { name: 'Behemoth', hp: 320, dmg: 30, spd: 2.6, rng: 2.6, splash: 2, m: 250, g: 150, time: 6, supply: 4 }
    }
  },
  {
    role: 'hero', icon: 'icon-unit-hero', label: 'Hero', trainedAt: 'Granted at match start - one per commander, cannot be rebuilt',
    blurb: 'Your faction\u2019s champion. A passive trait, a signature active ability on cooldown, and a very big health bar.',
    perRace: {
      human: { name: 'Warmaster Kael', hp: 550, dmg: 26, spd: 3, rng: 6.5, m: 0, g: 0, time: 0, supply: 0 },
      alien: { name: 'Riftlord Auren', hp: 650, dmg: 34, spd: 2.6, rng: 7.5, splash: 3.5, m: 0, g: 0, time: 0, supply: 0 },
      bio: { name: 'Broodmother Szel', hp: 750, dmg: 24, spd: 3.2, rng: 2.2, splash: 1.6, m: 0, g: 0, time: 0, supply: 0 }
    }
  }
]

// Structures. Costs/HP are shared across factions; names and flavor differ.
const BUILDINGS = [
  {
    kind: 'temple', icon: 'icon-building-temple', label: 'Command Structure',
    hp: 400, m: 300, g: 0, time: 10, supply: '+10 supply',
    blurb: 'The heart of the base. Trains workers, receives harvested resources, raises the supply cap. Lose every structure and you lose the war.',
    names: { human: 'Command Post', alien: 'Monolith', bio: 'Brood Heart' }
  },
  {
    kind: 'supplyHouse', icon: 'icon-building-supply', label: 'Supply Structure',
    hp: 150, m: 100, g: 0, time: 5, supply: '+5 supply',
    blurb: 'Cheap supply. Build these on a rhythm or your production stalls at the worst moment.',
    names: { human: 'Habitat', alien: 'Conduit', bio: 'Growth Pod' }
  },
  {
    kind: 'barracks', icon: 'icon-building-barracks', label: 'Infantry Structure',
    hp: 250, m: 150, g: 0, time: 8, supply: '',
    blurb: 'Tier-1 production: melee, ranged, healers, spellcasters and anti-air troopers all march out of here.',
    names: { human: 'Armory', alien: 'Rift Gate', bio: 'Spawning Pit' }
  },
  {
    kind: 'techLab', icon: 'icon-building-techlab', label: 'Tech Structure',
    hp: 220, m: 200, g: 100, time: 9, supply: 'Requires Infantry Structure',
    blurb: 'Tier-2 production: flyers, transports, capital ships, siege artillery and titans. The gateway to the late game.',
    names: { human: 'Starforge', alien: 'Sanctum', bio: 'Grand Nest' }
  },
  {
    kind: 'forge', icon: 'icon-building-forge', label: 'Upgrade Structure',
    hp: 200, m: 150, g: 50, time: 7, supply: 'Requires Infantry Structure',
    blurb: 'Researches ground Weapons and Propulsion upgrades for the whole army, and unlocks siege artillery and the titan.',
    names: { human: 'Foundry', alien: 'Ascension Spire', bio: 'Mutation Den' }
  },
  {
    kind: 'airForge', icon: 'icon-building-airforge', label: 'Flight Structure',
    hp: 220, m: 150, g: 100, time: 8, supply: 'Requires Tech Structure',
    blurb: 'Researches Flight Weapons and Flight Propulsion for everything with wings, and unlocks the capital ship.',
    names: { human: 'Skyharbor', alien: 'Zenith Spire', bio: 'Wind Roost' }
  },
  {
    kind: 'fireplace', icon: 'icon-building-fireplace', label: 'Utility Structure',
    hp: 120, m: 50, g: 0, time: 4, supply: 'Unique per faction',
    blurb: 'Each faction\u2019s camp building does something different: the Vanguard Beacon lights up a huge area through the fog, the Aethyr Obelisk hastes nearby allies +25% move speed, and the Myriad Spore Mound poisons hostiles that come near.',
    names: { human: 'Beacon', alien: 'Obelisk', bio: 'Spore Mound' }
  },
  {
    kind: 'turret', icon: 'icon-building-turret', label: 'Defense Tower',
    hp: 260, m: 100, g: 25, time: 6, supply: 'Requires Infantry Structure',
    blurb: 'Automated defense. 14 damage per second at 10m range, hits ground and air alike. Siege artillery outranges it - screen your towers.',
    names: { human: 'Sentry Cannon', alien: 'Arc Spire', bio: 'Thorn Mound' }
  }
]
