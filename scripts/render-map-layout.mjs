// Renders a top-down diagram of the 160x160 map layout (base anchors +
// resource fields from src/rts/config.ts) to scripts/map-layout.png.
import sharp from 'sharp'

const S = 6 // px per meter
const SIZE = 160 * S
const PAD = 70
const W = SIZE + PAD * 2
const H = SIZE + PAD * 2 + 80 // extra strip for the legend

const px = (x) => PAD + x * S
const py = (z) => PAD + (160 - z) * S // world +z is north (up)

const ANCHORS = [
  { x: 8.54, z: 3.48, label: 'START 1 (YOU)', color: '#35a4ff' },
  { x: 142.89, z: 136.75, label: 'START 2', color: '#f24d3e' },
  { x: 80, z: 148, label: 'START 3', color: '#ff9e26' },
  { x: 12, z: 146, label: 'START 4', color: '#c855f2' },
  { x: 148, z: 12, label: 'START 5', color: '#59e440' },
  { x: 80, z: 12, label: 'START 6', color: '#ff59b4' }
]

const FIELDS = [
  // mains
  { k: 'm', x: 21, z: 13, c: 7, r: 4.5 }, { k: 'g', x: 9, z: 22 }, { k: 'g', x: 29, z: 5 },
  { k: 'm', x: 139, z: 147, c: 7, r: 4.5 }, { k: 'g', x: 151, z: 138 }, { k: 'g', x: 131, z: 155 },
  { k: 'm', x: 68, z: 142, c: 7, r: 4.5 }, { k: 'g', x: 93, z: 152 }, { k: 'g', x: 60, z: 131 },
  { k: 'm', x: 24, z: 137, c: 7, r: 4.5 }, { k: 'g', x: 10, z: 128 }, { k: 'g', x: 32, z: 150 },
  { k: 'm', x: 135, z: 21, c: 7, r: 4.5 }, { k: 'g', x: 150, z: 30 }, { k: 'g', x: 127, z: 8 },
  { k: 'm', x: 92, z: 18, c: 7, r: 4.5 }, { k: 'g', x: 67, z: 8 }, { k: 'g', x: 100, z: 29 },
  // naturals
  { k: 'm', x: 12, z: 54, c: 6, r: 4, tag: 'NATURAL' }, { k: 'g', x: 21, z: 63 },
  { k: 'm', x: 148, z: 106, c: 6, r: 4, tag: 'NATURAL' }, { k: 'g', x: 139, z: 97 },
  { k: 'm', x: 82, z: 114, c: 6, r: 4, tag: 'NATURAL' }, { k: 'g', x: 92, z: 120 },
  { k: 'm', x: 40, z: 118, c: 6, r: 4, tag: 'NATURAL' }, { k: 'g', x: 49, z: 125 },
  { k: 'm', x: 120, z: 42, c: 6, r: 4, tag: 'NATURAL' }, { k: 'g', x: 111, z: 35 },
  { k: 'm', x: 78, z: 46, c: 6, r: 4, tag: 'NATURAL' }, { k: 'g', x: 68, z: 40 },
  // contested rims
  { k: 'm', x: 10, z: 84, c: 6, r: 4, tag: 'CONTESTED' }, { k: 'g', x: 18, z: 92 },
  { k: 'm', x: 150, z: 76, c: 6, r: 4, tag: 'CONTESTED' }, { k: 'g', x: 142, z: 68 },
  // center
  { k: 'm', x: 80, z: 80, c: 7, r: 5, tag: 'CENTER' }, { k: 'g', x: 70, z: 90 }, { k: 'g', x: 90, z: 70 }
]

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
svg += `<rect width="${W}" height="${H}" fill="#0b0e14"/>`
svg += `<rect x="${PAD}" y="${PAD}" width="${SIZE}" height="${SIZE}" fill="#1a1f29" stroke="#3a4356" stroke-width="3"/>`

// 20m grid
for (let m = 20; m < 160; m += 20) {
  svg += `<line x1="${px(m)}" y1="${PAD}" x2="${px(m)}" y2="${PAD + SIZE}" stroke="#242c3a" stroke-width="1"/>`
  svg += `<line x1="${PAD}" y1="${py(m)}" x2="${PAD + SIZE}" y2="${py(m)}" stroke="#242c3a" stroke-width="1"/>`
}

// resource fields (under the bases)
for (const f of FIELDS) {
  if (f.k === 'm') {
    const n = f.c ?? 6
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.5
      const rr = (f.r ?? 4) * 0.75
      const cx = px(f.x + Math.cos(a) * rr)
      const cy = py(f.z + Math.sin(a) * rr)
      svg += `<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" fill="#5aa0ff" transform="rotate(45 ${cx} ${cy})"/>`
    }
    if (f.tag) {
      svg += `<text x="${px(f.x)}" y="${py(f.z) + 42}" fill="#8fa3c0" font-family="Arial" font-size="17" font-weight="bold" text-anchor="middle">${f.tag}</text>`
    }
  } else {
    const cx = px(f.x)
    const cy = py(f.z)
    svg += `<circle cx="${cx}" cy="${cy}" r="9" fill="#3ddb5a"/><circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="#3ddb5a" stroke-width="2" opacity="0.55"/>`
  }
}

// base anchors on top
for (const a of ANCHORS) {
  const cx = px(a.x)
  const cy = py(a.z)
  svg += `<rect x="${cx - 15}" y="${cy - 15}" width="30" height="30" fill="${a.color}" stroke="#0b0e14" stroke-width="3"/>`
  // Labels point away from the map edge so they never cover the base's own fields.
  const ty = a.z > 100 ? cy - 26 : cy + 44
  const anchor = a.x < 25 ? 'start' : a.x > 135 ? 'end' : 'middle'
  const tx = a.x < 25 ? cx - 14 : a.x > 135 ? cx + 14 : cx
  svg += `<text x="${tx}" y="${ty}" fill="${a.color}" font-family="Arial" font-size="21" font-weight="bold" text-anchor="${anchor}">${a.label}</text>`
}

// compass + legend
svg += `<text x="${PAD + 10}" y="${PAD - 14}" fill="#697a94" font-family="Arial" font-size="20" font-weight="bold">N ^</text>`
svg += `<text x="${W / 2}" y="${PAD - 24}" fill="#e8edf5" font-family="Arial" font-size="30" font-weight="bold" text-anchor="middle">DECENTRACRAFT - 6-PLAYER MAP (160m x 160m)</text>`
const ly = PAD + SIZE + 44
svg += `<rect x="${PAD}" y="${ly - 12}" width="14" height="14" fill="#5aa0ff" transform="rotate(45 ${PAD + 7} ${ly - 5})"/>`
svg += `<text x="${PAD + 24}" y="${ly}" fill="#c7d2e4" font-family="Arial" font-size="20">Crystal field</text>`
svg += `<circle cx="${PAD + 190}" cy="${ly - 6}" r="9" fill="#3ddb5a"/>`
svg += `<text x="${PAD + 210}" y="${ly}" fill="#c7d2e4" font-family="Arial" font-size="20">Plasma vent</text>`
svg += `<rect x="${PAD + 380}" y="${ly - 18}" width="22" height="22" fill="#35a4ff"/>`
svg += `<text x="${PAD + 412}" y="${ly}" fill="#c7d2e4" font-family="Arial" font-size="20">Base start (7 crystals + 2 vents, own NATURAL nearby)</text>`
svg += `</svg>`

await sharp(Buffer.from(svg)).png().toFile('scripts/map-layout.png')
console.log('written scripts/map-layout.png')
