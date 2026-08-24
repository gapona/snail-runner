#!/usr/bin/env node
// Tone measurement for the game's sprites: how bright, how saturated, and how much of each shape
// reads as ink. Reports rather than asserts -- it is the instrument the art pass is aimed with,
// not a gate.
//
// **The three numbers exist because the rail shooter learned the hard way that the tell is tone,
// not line style.** Bought low-poly props dropped into that game's verge measured 1.29x as bright,
// 2.66x as saturated and carrying 0.38x the ink of its own hand-drawn scenery, and that -- not the
// shape language -- is what made them jump forward off the roadside. See CLAUDE.md, "On buying
// roadside props instead of generating them".
//
// So anything new that has to stand *in* the scenery is aimed at the scenery's own numbers, and
// anything that has to stand *out* of it is aimed deliberately away from them. In this game that
// second case is exactly one object: the snail.
//
// Usage:  node scripts/measure-art.mjs [dir-or-file ...]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng } from './png.mjs'

/** Alpha below this is a matte's soft edge rather than the shape, and would drag every average. */
const OPAQUE = 0.6

/**
 * Lightness below this reads as ink — an outline or a deep shadow — rather than as body colour.
 *
 * 70 of 255 is where the rail shooter's own measurement put it, and the useful property is not the
 * exact threshold but that the same one is applied to everything being compared.
 */
const INK_LIGHTNESS = 70

const lightness = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Saturation as a fraction, on the HSV definition: how far the channels spread from grey. */
function saturation(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)

  return max === 0 ? 0 : (max - min) / max
}

/** The three numbers, over the opaque pixels of one image. */
function measure({ width, height, data }) {
  let count = 0
  let lightSum = 0
  let satSum = 0
  let ink = 0

  for (let i = 0; i < width * height; i++) {
    const alpha = data[i * 4 + 3] / 255

    if (alpha < OPAQUE) continue

    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const l = lightness(r, g, b)

    count++
    lightSum += l
    satSum += saturation(r, g, b)
    if (l < INK_LIGHTNESS) ink++
  }

  if (count === 0) return null

  return {
    pixels: count,
    lightness: lightSum / count,
    saturation: (satSum / count) * 100,
    ink: (ink / count) * 100,
  }
}

function pngsIn(path) {
  if (statSync(path).isFile()) return path.endsWith('.png') ? [path] : []

  return readdirSync(path).flatMap((entry) => pngsIn(join(path, entry)))
}

const targets = process.argv.slice(2)
const roots = targets.length > 0 ? targets : ['public/assets/decor']

console.log('  file                              px      lightness  saturation  ink')

const all = []

for (const root of roots) {
  const files = pngsIn(root).sort()

  for (const file of files) {
    const stats = measure(decodePng(readFileSync(file)))

    if (!stats) continue

    all.push({ file, ...stats })
    console.log(
      `  ${file.replace(/^public\/assets\//, '').padEnd(32)}` +
        `${String(stats.pixels).padStart(7)}` +
        `${stats.lightness.toFixed(0).padStart(11)}` +
        `${stats.saturation.toFixed(0).padStart(11)}%` +
        `${stats.ink.toFixed(0).padStart(6)}%`,
    )
  }
}

if (all.length > 1) {
  const median = (pick) => {
    const sorted = all.map(pick).sort((a, b) => a - b)

    return sorted[Math.floor(sorted.length / 2)]
  }

  console.log(
    `\n  ${all.length} files — median lightness ${median((f) => f.lightness).toFixed(0)}, ` +
      `saturation ${median((f) => f.saturation).toFixed(0)}%, ` +
      `ink ${median((f) => f.ink).toFixed(0)}%`,
  )
}
