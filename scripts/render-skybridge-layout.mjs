// Renders the Skybridge Islands top-down diagram (islands + anchors + fields
// from src/rts/maps.ts) to scripts/skybridge-layout.png for the map selector.
import sharp from 'sharp'

const S = 6 // px per meter
const SIZE = 160 * S
const PAD = 70
const W = SIZE + PAD * 2
const H = SIZE + PAD * 2 + 80 // extra strip for the legend

const px = (x) => PAD + x * S
const py = (z) => PAD + (160 - z) * S // world +z is north (up)

// Mirrors SKYBRIDGE_ISLANDS in src/rts/maps.ts.
const PLAYER_ISLANDS = [
  { x: 128.5, z: 108, radius: 18 },
  { x: 80, z: 136, radius: 18 },
  { x: 31.5, z: 108, radius: 18 },
  { x: 31.5, z: 52, radius: 18 },
  { x: 80, z: 24, radius: 18 },
  { x: 128.5, z: 52, radius: 18 }
]
const EXPANSION_ISLANDS = [
  { x: 146, z: 80, radius: 11 },
  { x: 113, z: 137, radius: 11 },
  { x: 47, z: 137, radius: 11 },
  { x: 14, z: 80, radius: 11 },
  { x: 47, z: 23, radius: 11 },
  { x: 113, z: 23, radius: 11 }
]
const CENTER_ISLAND = { x: 80, z: 80, radius: 14 }

// Mirrors SKYBRIDGE_ANCHORS in order (seat 1 = the player), colors matching
// the classic diagram.
const ANCHORS = [
  { x: 132, z: 110, label: 'START 1 (YOU)', color: '#35a4ff' },
  { x: 80, z: 140, label: 'START 2', color: '#f24d3e' },
  { x: 28, z: 110, label: 'START 3', color: '#ff9e26' },
  { x: 28, z: 50, label: 'START 4', color: '#c855f2' },
  { x: 80, z: 20, label: 'START 5', color: '#59e440' },
  { x: 132, z: 50, label: 'START 6', color: '#ff59b4' }
]

// Mirrors SKYBRIDGE_FIELDS: k = m(inerals) | g(as).
const FIELDS = [
  { k: 'm', x: 139, z: 114, c: 6, r: 4 }, { k: 'g', x: 124, z: 117 }, { k: 'g', x: 134, z: 99 },
  { k: 'm', x: 80, z: 148, c: 6, r: 4 }, { k: 'g', x: 70, z: 136 }, { k: 'g', x: 90, z: 136 },
  { k: 'm', x: 21, z: 114, c: 6, r: 4 }, { k: 'g', x: 27, z: 99 }, { k: 'g', x: 37, z: 117 },
  { k: 'm', x: 21, z: 46, c: 6, r: 4 }, { k: 'g', x: 37, z: 43 }, { k: 'g', x: 27, z: 61 },
  { k: 'm', x: 80, z: 12, c: 6, r: 4 }, { k: 'g', x: 90, z: 24 }, { k: 'g', x: 70, z: 24 },
  { k: 'm', x: 139, z: 46, c: 6, r: 4 }, { k: 'g', x: 134, z: 61 }, { k: 'g', x: 124, z: 43 },
  { k: 'm', x: 76, z: 76, c: 6, r: 4, rich: true, tag: 'RICH CENTER' }, { k: 'g', x: 88, z: 72, rich: true }, { k: 'g', x: 72, z: 88, rich: true },
  { k: 'm', x: 149, z: 77, c: 5, r: 3.2 }, { k: 'g', x: 141, z: 85 },
  { k: 'm', x: 116, z: 140, c: 5, r: 3.2 }, { k: 'g', x: 108, z: 131 },
  { k: 'm', x: 44, z: 140, c: 5, r: 3.2 }, { k: 'g', x: 52, z: 131 },
  { k: 'm', x: 11, z: 77, c: 5, r: 3.2 }, { k: 'g', x: 19, z: 85 },
  { k: 'm', x: 44, z: 20, c: 5, r: 3.2 }, { k: 'g', x: 52, z: 29 },
  { k: 'm', x: 116, z: 20, c: 5, r: 3.2 }, { k: 'g', x: 108, z: 29 }
]

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
svg += `<rect width="${W}" height="${H}" fill="#0b0e14"/>`
// The battlefield is deep space: a near-black void with stars.
svg += `<rect x="${PAD}" y="${PAD}" width="${SIZE}" height="${SIZE}" fill="#0a0c18" stroke="#3a4356" stroke-width="3"/>`

// Star glints scattered in the void.
for (let i = 0; i < 90; i++) {
  const a = (i * 2654435761) % 4294967296
  const cx = PAD + ((a % 997) / 997) * SIZE
  const cy = PAD + (((a >> 8) % 991) / 991) * SIZE
  const r = 1 + ((a >> 16) % 3)
  const warm = (a >> 20) % 4 === 0
  svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${warm ? '#ffd9a0' : '#dfe9ff'}" opacity="${0.5 + ((a >> 24) % 50) / 100}"/>`
}
// A couple of faint nebula wisps for color depth.
for (let i = 0; i < 6; i++) {
  const a = ((i + 7) * 2654435761) % 4294967296
  const cx = PAD + ((a % 997) / 997) * SIZE
  const cy = PAD + (((a >> 8) % 991) / 991) * SIZE
  const rw = 60 + ((a >> 16) % 80)
  svg += `<ellipse cx="${cx}" cy="${cy}" rx="${rw}" ry="${rw * 0.4}" fill="${i % 2 === 0 ? '#3a2c66' : '#1f4066'}" opacity="0.28"/>`
}

// Islands: player isles (large), expansions (mid), rich center.
const drawIsland = (isle, fill, stroke) => {
  const cx = px(isle.x)
  const cy = py(isle.z)
  const r = isle.radius * S
  svg += `<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="#0e1523" opacity="0.9"/>`
  svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`
}
for (const isle of PLAYER_ISLANDS) drawIsland(isle, '#2b4a22', '#4a7038')
for (const isle of EXPANSION_ISLANDS) drawIsland(isle, '#254019', '#42632f')
drawIsland(CENTER_ISLAND, '#3d4a1e', '#6b6136')

// Expansion isle tags.
for (const isle of EXPANSION_ISLANDS) {
  svg += `<text x="${px(isle.x)}" y="${py(isle.z) - isle.radius * S - 10}" fill="#8fa3c0" font-family="Arial" font-size="16" font-weight="bold" text-anchor="middle">EMPTY ISLE</text>`
}

// Resource fields.
for (const f of FIELDS) {
  if (f.k === 'm') {
    const n = f.c ?? 6
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.5
      const rr = (f.r ?? 4) * 0.75
      const cx = px(f.x + Math.cos(a) * rr)
      const cy = py(f.z + Math.sin(a) * rr)
      svg += `<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" fill="${f.rich ? '#ffc63d' : '#5aa0ff'}" transform="rotate(45 ${cx} ${cy})"/>`
    }
    if (f.tag) {
      svg += `<text x="${px(f.x) + 4}" y="${py(f.z) + 52}" fill="#ffc63d" font-family="Arial" font-size="17" font-weight="bold" text-anchor="middle">${f.tag}</text>`
    }
  } else {
    const cx = px(f.x)
    const cy = py(f.z)
    const gc = f.rich ? '#6fd8ff' : '#3ddb5a'
    svg += `<circle cx="${cx}" cy="${cy}" r="9" fill="${gc}"/><circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="${gc}" stroke-width="2" opacity="0.55"/>`
  }
}

// Base anchors on top.
for (const a of ANCHORS) {
  const cx = px(a.x)
  const cy = py(a.z)
  svg += `<rect x="${cx - 15}" y="${cy - 15}" width="30" height="30" fill="${a.color}" stroke="#0b0e14" stroke-width="3"/>`
  const ty = a.z > 100 ? cy - 26 : cy + 44
  const anchor = a.x < 40 ? 'start' : a.x > 120 ? 'end' : 'middle'
  const tx = a.x < 40 ? cx - 14 : a.x > 120 ? cx + 14 : cx
  svg += `<text x="${tx}" y="${ty}" fill="${a.color}" font-family="Arial" font-size="21" font-weight="bold" text-anchor="${anchor}">${a.label}</text>`
}

// Compass, title, legend.
svg += `<text x="${PAD + 10}" y="${PAD - 14}" fill="#697a94" font-family="Arial" font-size="20" font-weight="bold">N ^</text>`
svg += `<text x="${W / 2}" y="${PAD - 24}" fill="#e8edf5" font-family="Arial" font-size="30" font-weight="bold" text-anchor="middle">SKYBRIDGE ISLANDS - NO LAND ROUTES (160m x 160m)</text>`
const ly = PAD + SIZE + 44
svg += `<rect x="${PAD}" y="${ly - 12}" width="14" height="14" fill="#5aa0ff" transform="rotate(45 ${PAD + 7} ${ly - 5})"/>`
svg += `<text x="${PAD + 24}" y="${ly}" fill="#c7d2e4" font-family="Arial" font-size="20">Crystal field</text>`
svg += `<circle cx="${PAD + 190}" cy="${ly - 6}" r="9" fill="#3ddb5a"/>`
svg += `<text x="${PAD + 210}" y="${ly}" fill="#c7d2e4" font-family="Arial" font-size="20">Plasma vent</text>`
svg += `<rect x="${PAD + 380}" y="${ly - 12}" width="14" height="14" fill="#ffc63d" transform="rotate(45 ${PAD + 387} ${ly - 5})"/>`
svg += `<text x="${PAD + 404}" y="${ly}" fill="#c7d2e4" font-family="Arial" font-size="20">Gold vein (1.5x)</text>`
svg += `<circle cx="${PAD + 600}" cy="${ly - 6}" r="9" fill="#6fd8ff"/>`
svg += `<text x="${PAD + 620}" y="${ly}" fill="#c7d2e4" font-family="Arial" font-size="20">Cryo vent (1.5x)</text>`
svg += `<rect x="${PAD + 810}" y="${ly - 18}" width="22" height="22" fill="#35a4ff"/>`
svg += `<text x="${PAD + 842}" y="${ly}" fill="#c7d2e4" font-family="Arial" font-size="20">Base start</text>`
svg += `</svg>`

await sharp(Buffer.from(svg)).png().toFile('scripts/skybridge-layout.png')
console.log('written scripts/skybridge-layout.png')
