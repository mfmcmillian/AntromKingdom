import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const RAW_DIR = 'C:/Users/matth/.cursor/projects/c-Users-matth-AppData-Roaming-creator-hub-Scenes-Kingdom-of-Antrom/assets'
const OUT_DIR = 'images/ui/profile'

mkdirSync(OUT_DIR, { recursive: true })

const PORTRAITS = [
  { raw: 'portrait-kael-raw.png', out: 'portrait-kael.jpg' },
  { raw: 'portrait-auren-raw.png', out: 'portrait-auren.jpg' },
  { raw: 'portrait-szel-raw.png', out: 'portrait-szel.jpg' },
  { raw: 'portrait-antrom-raw.png', out: 'portrait-antrom.jpg' },
  { raw: 'portrait-patron-raw.png', out: 'portrait-patron.jpg' },
  { raw: 'portrait-locked-raw.png', out: 'portrait-locked.jpg' },
  { raw: 'frame-locked-raw.png', out: 'frame-locked.jpg' }
]

const FRAMES = [
  'frame-iron-raw.png',
  'frame-bronze-raw.png',
  'frame-silver-raw.png',
  'frame-gold-raw.png',
  'frame-champion-raw.png'
]

function isMagenta(r, g, b) {
  return r > 170 && b > 170 && g < 90 && r - g > 70 && b - g > 70
}

for (const portrait of PORTRAITS) {
  const dest = path.join(OUT_DIR, portrait.out)
  await sharp(path.join(RAW_DIR, portrait.raw))
    .resize(512, 512, { fit: 'cover' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(dest)
  console.log(portrait.out)
}

for (const raw of FRAMES) {
  const out = raw.replace('-raw.png', '.png')
  const { data, info } = await sharp(path.join(RAW_DIR, raw))
    .resize(512, 512, { fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixels = new Uint8Array(data)
  for (let i = 0; i < pixels.length; i += 4) {
    if (isMagenta(pixels[i], pixels[i + 1], pixels[i + 2])) pixels[i + 3] = 0
  }

  // Guarantee a clear inner window so the portrait always shows through.
  const hole = Math.round(info.width * 0.16)
  for (let y = hole; y < info.height - hole; y++) {
    for (let x = hole; x < info.width - hole; x++) {
      pixels[(y * info.width + x) * 4 + 3] = 0
    }
  }

  await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, out))
  console.log(out)
}
