/**
 * A minimal PNG decoder: 8-bit, non-interlaced, colour type 6 (RGBA) — which is every image this
 * project ships or generates.
 *
 * **Extracted from `verify-mattes.mjs` rather than written twice.** That suite carries its own
 * decoder so it can read binary assets without taking a dependency; `measure-art.mjs` needs the
 * same pixels to answer a different question, and two decoders drifting apart would mean the matte
 * check and the tone check disagreeing about what a file contains.
 */
import { inflateSync } from 'node:zlib'

export function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]

  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) throw new Error('not a PNG')
  }

  let offset = 8
  let header = null
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colourType: body[9],
        interlace: body[12],
      }
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }

    offset += 12 + length
  }

  if (!header) throw new Error('no IHDR')
  // Palette images carry no alpha in this project (the sky plates) and are skipped by the caller.
  if (header.colourType !== 6 || header.depth !== 8 || header.interlace !== 0) return null

  const raw = inflateSync(Buffer.concat(idat))
  const { width, height } = header
  const stride = width * 4
  const data = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const out = data.subarray(y * stride, (y + 1) * stride)
    const prior = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null

    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[x - 4] : 0
      const b = prior ? prior[x] : 0
      const c = prior && x >= 4 ? prior[x - 4] : 0
      let value = line[x]

      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)

        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[x] = value & 0xff
    }
  }

  return { width, height, data }
}
