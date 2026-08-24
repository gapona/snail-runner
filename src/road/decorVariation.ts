/**
 * How one instance of a prop differs from every other instance of the same prop.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:road`.
 *
 * **Variety comes from instances, not from files.** Nine biomes hold 5–6 props each, so a lap shows
 * the same handful of shapes dozens of times; the obvious answer is to draw 150 more, which costs
 * bundle weight the platform budget cannot spend twice. The cheaper answer is that one texture,
 * mirrored, resized, tilted and shifted in hue, is several visibly different objects — and none of
 * it costs a byte.
 *
 * **Derived from the coordinate, never from the spawn.** A prop must not change its look when the
 * screen rotates, when the pool slot it happens to land in changes, or when the player comes round
 * the same lap a second time. So every axis below is a pure function of
 * `(segmentIndex, side, propId)` and nothing else — the same rule, and the same reason, as
 * `decorateTrack` being seeded rather than rolled.
 */
import { fromOklab, toOklab } from './color'

export interface DecorVariation {
  /** Mirrored along X. Doubles the silhouette count for nothing. */
  flipX: boolean
  /** Uniform scale. **Both axes together**, or the prop's own proportions drift. */
  scale: number
  /** Hue rotation applied to the tint, in degrees. */
  hueShift: number
  /** Multipliers on the tint's chroma and lightness, drawn independently of the hue. */
  satScale: number
  lightScale: number
  /** Lean, in degrees. Zero for anything that is not vegetation — see `propLeans`. */
  tilt: number
}

export const VARIATION = {
  scale: { min: 0.75, max: 1.35 },
  hueDegrees: 14,
  sat: { min: 0.8, max: 1.15 },
  light: { min: 0.85, max: 1.1 },
  tiltDegrees: 6,
} as const

/**
 * Which props lean.
 *
 * **A rock that leans is a rock that has fallen over**, and a masonry block at six degrees reads as
 * a mistake rather than as variety.
 *
 * **⚠ This was a regex over the prop ids' own vocabulary first, and it was wrong in both
 * directions**: it leaned `cry_cluster` and `dune_spire` — a crystal formation and a rock needle —
 * because the words appear in plant names elsewhere, and it refused `dune_cactus` and `wet_cattail`
 * because theirs do not. The argument for it was that a new plant would lean without anybody
 * remembering to list it; what it actually bought was two wrong answers out of the first four
 * looked at.
 *
 * So it is a list, and the default is **not** to lean. That is the safe direction: a plant that
 * stands straight looks fine, and a boulder at an angle looks broken.
 */
const LEANING_NOUNS = new Set([
  'scrub',
  'kelp',
  'palm',
  'cactus',
  'grass',
  'shrub',
  'birch',
  'bramble',
  'fern',
  'pine',
  'lichen',
  'cattail',
  'reeds',
  'willow',
  'mushroom',
])

export function propLeans(propId: string): boolean {
  const slot = propId.replace(/^decor-/, '')
  // Every fungal prop is a mushroom, so the biome answers for the whole set rather than five nouns
  // that happen to describe proportions (`fun_tall`, `fun_wide`) rather than species.
  if (slot.startsWith('fun_')) return true

  return LEANING_NOUNS.has(slot.slice(slot.indexOf('_') + 1))
}

/**
 * A 32-bit hash of the three things an instance is identified by.
 *
 * Its own hash rather than `createRng`: the generator in `race/rng.ts` is a *stream*, and a stream
 * has to be walked in order to reach the nth value. What is needed here is the opposite — an
 * answer for one coordinate, computable in any order, the same every time.
 */
function hash(segmentIndex: number, side: number, propId: string): number {
  let h = 2166136261 ^ (segmentIndex * 2654435761) ^ ((side > 0 ? 1 : 0) * 40503)

  for (let i = 0; i < propId.length; i++) {
    h ^= propId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }

  h ^= h >>> 15
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13

  return h >>> 0
}

/** A stable `0..1` from the hash, per axis. Each axis takes its own slice so they vary apart. */
function unit(h: number, axis: number): number {
  const mixed = Math.imul(h ^ Math.imul(axis + 1, 0x9e3779b1), 0x85ebca6b)

  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296
}

export function variationFor(segmentIndex: number, side: number, propId: string): DecorVariation {
  const h = hash(segmentIndex, side, propId)
  const between = (axis: number, min: number, max: number) => min + unit(h, axis) * (max - min)

  return {
    flipX: unit(h, 0) < 0.5,
    scale: between(1, VARIATION.scale.min, VARIATION.scale.max),
    hueShift: between(2, -VARIATION.hueDegrees, VARIATION.hueDegrees),
    satScale: between(3, VARIATION.sat.min, VARIATION.sat.max),
    lightScale: between(4, VARIATION.light.min, VARIATION.light.max),
    tilt: propLeans(propId) ? between(5, -VARIATION.tiltDegrees, VARIATION.tiltDegrees) : 0,
  }
}

/**
 * The tint this instance is drawn with: the biome's own colour, moved.
 *
 * In OKLab, because the whole project measures colour there — a hue rotation in RGB changes
 * lightness as a side effect, which would make the "independent" lightness axis a lie.
 *
 * **The result is still bound by the threat reservation.** A shifted tint is a colour the player
 * sees, so `verify:road` sweeps the extremes of every biome × theme product through the same
 * three-term rule the unshifted products already go through; a shift that could carry a prop into
 * the reserved band is a shift that would put the danger colour on a bush.
 */
export function tintFor(base: number, variation: DecorVariation): number {
  const lab = toOklab(base)
  const chroma = Math.hypot(lab.a, lab.b)
  const hue = Math.atan2(lab.b, lab.a) + (variation.hueShift * Math.PI) / 180
  const scaledChroma = chroma * variation.satScale

  return fromOklab({
    L: Math.min(1, Math.max(0, lab.L * variation.lightScale)),
    a: Math.cos(hue) * scaledChroma,
    b: Math.sin(hue) * scaledChroma,
  })
}

/**
 * Whether two instances would read as the same object.
 *
 * The acceptance the plan states, written down as a function so the check and the intent cannot
 * drift apart: same prop, same mirroring, and a hue within a few degrees. Scale and tilt are
 * deliberately *not* part of it — two identical ferns at 0.8 and 1.3 read as near and far, which is
 * exactly the illusion this file is buying.
 */
export function readsAsSame(
  a: { propId: string; variation: DecorVariation },
  b: { propId: string; variation: DecorVariation },
): boolean {
  return (
    a.propId === b.propId &&
    a.variation.flipX === b.variation.flipX &&
    Math.abs(a.variation.hueShift - b.variation.hueShift) < 4
  )
}
