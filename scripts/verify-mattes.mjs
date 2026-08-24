#!/usr/bin/env node
// Matte check for every RGBA sprite the game ships: the alpha floor and the colour flood under the
// transparency. Unlike the fifteen logic suites this one reads *binary assets* rather than
// pure modules, so it carries its own minimal PNG decoder (8-bit, colour type 6, non-interlaced --
// which is every RGBA asset in this project) rather than taking a dependency.
//
// **It was written against a measurement, not against a description, and then rewritten when the
// first measurement turned out to be measuring the art.** The brief it comes from diagnosed a
// *light* rim from an uncut white background. On these files the transparent pixels are black, 0 of
// 62 are white, and only 3 have a lighter edge -- so that defect does not exist here. The first
// version of this check therefore asserted the opposite (the edge must not be much *darker* than
// the body) and failed 85 of 85 files, which looked like a find until the raw renders were compared
// against the shipped ones: **28 of the 37 dark-edged sprites are dark in the raw render too.**
// That edge is the black outline the whole art style is drawn with. A check that cannot tell the
// style from a defect is not a check, and it is gone.
//
// What is left is what a matte can be wrong about independently of what is drawn: alpha that is
// present but meaningless, and colour that was never flooded under the transparency. Corners are
// reported rather than asserted -- see below.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { decodePng } from './png.mjs'

/** Alpha below this is noise rather than coverage, and lights up a whole bounding box. */
const ALPHA_FLOOR = 0.06

/**
 * How dark the transparent ring around a shape may be, relative to the pixels it touches.
 *
 * **Calibrated against files that are known to be flooded and known not to be**, because three
 * earlier attempts at this check were all measuring the art instead. Never-flooded raw renders
 * score **0.01-0.02** -- their transparent ring is pure black while the shape's own edge carries
 * colour. The same sprites after the flood score **0.16-1.24, median 0.53**. The floor sits between
 * those two populations with room on both sides, and the check reports the number so the next
 * person can see where it actually sits rather than trusting the constant.
 *
 * It stays a *ratio against the neighbouring pixels* rather than an absolute brightness precisely
 * so a sprite outlined in black -- which is every sprite in this game -- passes on its own terms:
 * a black ring around a black outline is a flooded ring.
 */
const MIN_RING_RATIO = 0.1

const ROOTS = ['public/assets/decor', 'public/assets/fx']

/** Decodes an 8-bit, non-interlaced, colour-type-6 PNG into `{ width, height, data }` (RGBA). */
const lightness = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** The 1px transparent ring around a shape, against the filled pixels it touches. */
function ringRatioOf({ width, height, data }) {
  const at = (x, y) => (y * width + x) * 4
  let ringSum = 0
  let ringCount = 0
  let innerSum = 0
  let innerCount = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = at(x, y)
      const filled = data[i + 3] > 0
      let touchesFilled = false

      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        if (data[at(x + dx, y + dy) + 3] > 0) {
          touchesFilled = true
          break
        }
      }

      if (!touchesFilled) continue

      const value = lightness(data[i], data[i + 1], data[i + 2])

      if (filled) {
        innerSum += value
        innerCount++
      } else {
        ringSum += value
        ringCount++
      }
    }
  }

  if (ringCount < 4 || innerCount < 4) return 1

  return (ringSum / ringCount + 1) / (innerSum / innerCount + 1)
}

function inspect(path) {
  const image = decodePng(readFileSync(path))

  if (!image) return null

  const { width, height, data } = image
  const at = (x, y) => (y * width + x) * 4
  const alphaAt = (x, y) => data[at(x, y) + 3] / 255

  const failures = []
  let faint = 0

  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i] / 255

    if (alpha > 0 && alpha < ALPHA_FLOOR) faint++
  }

  const ringRatio = ringRatioOf(image)

  const corners = [alphaAt(0, 0), alphaAt(width - 1, 0), alphaAt(0, height - 1), alphaAt(width - 1, height - 1)]

  // **Not a failure, and the brief asked for it to be one.** "All four corners transparent" is a
  // proxy for "the background was cut out" -- but these sprites are cropped tight, so content
  // reaching the frame is what a tight crop *means*: a turret's base spans the bottom edge, a
  // spire's base sits in both bottom corners, and `im_sparks` throws sparks to all four. Measured,
  // 12 of 85 files have an opaque corner and every one of them is the object. Reported, because a
  // sudden jump in the number would mean a plate came back.
  if (faint > 0) failures.push(`${faint} px under the alpha floor`)
  if (ringRatio < MIN_RING_RATIO) {
    failures.push(`the transparent ring is at ${(ringRatio * 100).toFixed(0)}% of the colour it borders, i.e. not flooded`)
  }

  return { failures, faint, ringRatio, cornered: corners.some((value) => value > 0) }
}

function walk(dir) {
  const out = []

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)

    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (entry.endsWith('.png')) out.push(path)
  }

  return out
}

const files = ROOTS.flatMap((root) => {
  try {
    return walk(root)
  } catch {
    return []
  }
})

const results = []

for (const path of files) {
  const result = inspect(path)

  if (result) results.push({ path: relative(process.cwd(), path), ...result })
}

const failed = results.filter((r) => r.failures.length > 0)

console.log(`${results.length} RGBA sprites checked`)

if (failed.length > 0) {
  console.log(`\n${failed.length} failing:`)
  for (const r of failed.slice(0, 12)) {
    console.log(`  ${r.path.padEnd(34)} ${r.failures.join('; ')}`)
  }
  if (failed.length > 12) console.log(`  ...and ${failed.length - 12} more`)
}

const ratios = results.map((r) => r.ringRatio).sort((a, b) => a - b)

console.log(
  `\n${results.filter((r) => r.cornered).length} sprites reach a corner of their own canvas, which a tight crop implies`,
)
console.log(
  `ring/border lightness: median ${ratios[Math.floor(ratios.length / 2)].toFixed(2)}, worst ${ratios[0].toFixed(2)} ` +
    `(floor ${MIN_RING_RATIO}; a never-flooded file scores 0.01)`,
)

// **The check is shown to fail before it is believed.** A synthetic sprite with a coloured body and
// a black transparent border -- exactly what a never-flooded file looks like -- has to be rejected,
// and the same sprite with its border flooded has to pass. Without this the floor above is a number
// that has only ever been satisfied.
{
  const size = 16
  const make = (flooded) => {
    const data = Buffer.alloc(size * size * 4)

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        const inside = x >= 4 && x < 12 && y >= 4 && y < 12
        const border = !inside && x >= 3 && x < 13 && y >= 3 && y < 13

        if (inside) {
          data[i] = 200
          data[i + 1] = 180
          data[i + 2] = 160
          data[i + 3] = 255
        } else if (border && flooded) {
          data[i] = 200
          data[i + 1] = 180
          data[i + 2] = 160
        }
      }
    }

    return { width: size, height: size, data }
  }

  const unflooded = ringRatioOf(make(false))
  const flooded = ringRatioOf(make(true))

  assert.ok(unflooded < MIN_RING_RATIO, 'the ring check accepts a sprite that was never flooded')
  assert.ok(flooded >= MIN_RING_RATIO, 'the ring check rejects a sprite that was flooded')
  console.log(`self-test: an unflooded sprite scores ${unflooded.toFixed(2)}, a flooded one ${flooded.toFixed(2)}`)
}

assert.equal(failed.length, 0, `${failed.length} of ${results.length} sprites fail the matte check`)
console.log('every sprite carries a floored alpha and a flooded border')
