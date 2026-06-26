const { promises: fs } = require('fs')
const path = require('path')

async function main() {
  const svgPath = path.join(__dirname, 'src-tauri', 'icons', 'reimimdhat.svg')
  const icoPath = path.join(__dirname, 'src-tauri', 'icons', 'icon.ico')

  const svg = await fs.readFile(svgPath)

  // Use sharp to generate PNG buffers at various sizes
  const sharp = require('sharp')
  const sizes = [16, 32, 48, 64, 128, 256]
  const buffers = []

  for (const s of sizes) {
    const buf = await sharp(svg).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    buffers.push({ size: s, buf })
  }

  // Build ICO header
  const headerLen = 6
  const dirLen = buffers.length * 16
  let ico = Buffer.alloc(headerLen + dirLen)

  // ICO header
  ico.writeUInt16LE(0, 0)      // reserved
  ico.writeUInt16LE(1, 2)      // ICO type
  ico.writeUInt16LE(buffers.length, 4) // image count

  // Directory entries
  let offset = headerLen + dirLen
  for (let i = 0; i < buffers.length; i++) {
    const b = buffers[i]
    const w = b.size >= 256 ? 0 : b.size
    const entryOffset = 6 + i * 16
    ico.writeUInt8(w, entryOffset)         // width
    ico.writeUInt8(w, entryOffset + 1)     // height
    ico.writeUInt8(0, entryOffset + 2)     // colors
    ico.writeUInt8(0, entryOffset + 3)     // reserved
    ico.writeUInt16LE(1, entryOffset + 4)  // planes
    ico.writeUInt16LE(32, entryOffset + 6) // bpp
    ico.writeUInt32LE(b.buf.length, entryOffset + 8)  // size
    ico.writeUInt32LE(offset, entryOffset + 12)        // offset
    offset += b.buf.length
  }

  // Append image data
  ico = Buffer.concat([ico, ...buffers.map(b => b.buf)])

  await fs.writeFile(icoPath, ico)
  console.log(`ICO created: ${icoPath} (${ico.length} bytes, ${buffers.length} sizes)`)
}

main().catch(console.error)
