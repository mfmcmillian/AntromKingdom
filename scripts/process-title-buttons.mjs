import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// Crops the generated StarCraft-style button art (wide band on black) down to
// the button bounds and saves game-ready textures. Corner screws in the raw
// image corners defeat a naive trim, so we cut the center band first.

const RAW_DIR = 'C:/Users/matth/.cursor/projects/c-Users-matth-AppData-Roaming-creator-hub-Scenes-Kingdom-of-Antrom/assets'
const OUT_DIR = 'images/ui/buttons'

const BUTTONS = [
  { raw: 'btn-single-player-raw.png', out: 'btn-single-player.png', width: 680 },
  { raw: 'btn-multiplayer-raw.png', out: 'btn-multiplayer.png', width: 680 },
  { raw: 'btn-wiki-raw.png', out: 'btn-wiki.png', width: 480 },
  { raw: 'btn-back-raw.png', out: 'btn-back.png', width: 560 },
  { raw: 'btn-start-match-raw.png', out: 'btn-start-match.png', width: 680 },
  { raw: 'btn-ready-up-raw.png', out: 'btn-ready-up.png', width: 560 },
  { raw: 'btn-unready-raw.png', out: 'btn-unready.png', width: 560 },
  { raw: 'btn-leave-room-raw.png', out: 'btn-leave-room.png', width: 560 },
  { raw: 'btn-enter-raw.png', out: 'btn-enter.png', width: 330 },
  { raw: 'btn-view-raw.png', out: 'btn-view.png', width: 330 }
]

mkdirSync(OUT_DIR, { recursive: true })

for (const button of BUTTONS) {
  const source = sharp(path.join(RAW_DIR, button.raw))
  const meta = await source.metadata()

  // Center band: the button occupies the middle ~two thirds; image corners hold stray rivet art.
  const bandTop = Math.round(meta.height * 0.16)
  const bandHeight = Math.round(meta.height * 0.68)
  const band = await source.extract({ left: 0, top: bandTop, width: meta.width, height: bandHeight }).toBuffer()

  const trimmed = await sharp(band).trim({ threshold: 28 }).toBuffer()
  const trimmedMeta = await sharp(trimmed).metadata()

  await sharp(trimmed)
    .resize({ width: button.width })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, button.out))

  const finalMeta = await sharp(path.join(OUT_DIR, button.out)).metadata()
  console.log(`${button.out}: trimmed ${trimmedMeta.width}x${trimmedMeta.height} -> ${finalMeta.width}x${finalMeta.height} (aspect ${(finalMeta.width / finalMeta.height).toFixed(2)}:1)`)
}
