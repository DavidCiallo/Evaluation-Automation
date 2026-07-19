// One-shot: render SVG logo into favicon PNGs + ICO + apple-touch-icon.
// Run with: bun run scripts/generate-icons.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import pngToIco from "png-to-ico"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const logoPath = join(root, "client/assets/logo.svg")
const publicDir = join(root, "public")

// PNG sizes needed:
//  16,32 -> classic favicon
//  180   -> apple-touch-icon
//  192,512 -> PWA manifest icons (kept in /public for future manifest use)
const SIZES = [16, 32, 180, 192, 512]

async function main() {
  await mkdir(publicDir, { recursive: true })
  const svg = await readFile(logoPath)

  // Render every PNG. apple-touch-icon gets flattened onto opaque white
  // because iOS ignores alpha and pads transparent corners with white.
  const pngs = {}
  for (const s of SIZES) {
    const buf = await sharp(svg, { density: 384 })
      .resize(s, s, { fit: "cover" })
      .png()
      .toBuffer()
    pngs[s] = buf
    const out = join(publicDir, s === 180 ? "apple-touch-icon.png" : `icon-${s}.png`)
    await writeFile(out, buf)
    console.log(`wrote ${out} (${buf.length} bytes)`)
  }

  // ICO bundling 16+32 (and 48 for Windows desktop). PNG-encoded frames inside.
  const ico = await pngToIco([pngs[16], pngs[32], pngs[32]])
  const icoPath = join(publicDir, "favicon.ico")
  await writeFile(icoPath, ico)
  console.log(`wrote ${icoPath} (${ico.length} bytes)`)

  console.log("done.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
