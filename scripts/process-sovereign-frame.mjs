import sharp from 'sharp'
import path from 'node:path'

const RAW = 'C:/Users/matth/.cursor/projects/c-Users-matth-AppData-Roaming-creator-hub-Scenes-Kingdom-of-Antrom/assets/frame-sovereign-raw.png'
const OUT = 'images/ui/profile/frame-sovereign.png'

function isMagenta(r, g, b) {
  return r > 170 && b > 170 && g < 90 && r - g > 70 && b - g > 70
}

const { data, info } = await sharp(RAW).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const pixels = new Uint8Array(data)
const { width, height } = info

let minX = width
let minY = height
let maxX = 0
let maxY = 0
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    if (!isMagenta(pixels[i], pixels[i + 1], pixels[i + 2])) continue
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
}

const holeW = maxX - minX + 1
const holeH = maxY - minY + 1
const pad = Math.round(Math.max(holeW, holeH) * 0.28)
const left = Math.max(0, minX - pad)
const top = Math.max(0, minY - pad)
const cropW = Math.min(width - left, holeW + pad * 2)
const cropH = Math.min(height - top, holeH + pad * 2)
const size = Math.min(cropW, cropH)

const cropped = await sharp(RAW)
  .extract({ left, top, width: size, height: size })
  .resize(512, 512, { fit: 'cover' })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const out = new Uint8Array(cropped.data)
const w = cropped.info.width
const h = cropped.info.height
for (let i = 0; i < out.length; i += 4) {
  if (isMagenta(out[i], out[i + 1], out[i + 2])) out[i + 3] = 0
}
const hole = Math.round(w * 0.16)
for (let y = hole; y < h - hole; y++) {
  for (let x = hole; x < w - hole; x++) {
    out[(y * w + x) * 4 + 3] = 0
  }
}

await sharp(out, { raw: { width: w, height: h, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(path.resolve(OUT))

console.log(`sovereign frame: magenta ${holeW}x${holeH} -> crop ${size} -> 512`)
