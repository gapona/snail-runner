/**
 * Marks lying in the plane of the ribbon: stains, cracks, skids, scatter.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:road`.
 *
 * **The one thing the world was missing that no amount of scenery could supply.** Everything
 * standing on the ground is a billboard, so the surface itself — the largest object in the frame
 * by a wide margin — carried nothing at all except its own two-colour alternation and the rungs.
 * Adding props does not fix an empty floor; a mark *on* the floor does.
 *
 * **Derived from the segment index, never stored and never rolled.** Same rule, and the same
 * reason, as `decorVariation.ts`: a decal must be in the same place on the same lap the second
 * time round, at every screen size, whatever pool slot it lands in. So there is no `decorate` pass
 * and nothing on `Segment` — a decal is a pure function of where it is.
 *
 * **They darken rather than colour**, which is what makes one texture enough for nine biomes and
 * seven themes: a stain is the ground with less light coming off it, so the mark is drawn with a
 * multiply blend and takes the colour of whatever it happens to lie on. A tinted decal would need
 * a per-biome variant and a palette to select it — the road mesh's own trick — for a mark whose
 * whole identity is that it is darker.
 */

/**
 * The seven marks. Their shapes are drawn procedurally — see `decalArt.ts`.
 *
 * **Four of these are road marks and three are ground marks, and the split is the point.** The
 * first four were authored when a decal could only be within `2.2` half-widths of the centreline,
 * i.e. on the asphalt or on the very edge of the verge — a stain, a crack, a skid and some
 * scatter are all things that happen to a *surface*. The field reaches across the verge now, and
 * a skid mark out there would be a lie about what made it. So the vocabulary grew the three
 * things ground has that road does not: loose stones, a tuft of growth, and standing water.
 *
 * Which of them a stretch may use is the biome's business — see `Biome.decals`. A puddle in the
 * dunes and a tuft on a lava field are the same failure the prop lists exist to prevent.
 */
export const DECAL_KINDS = ['stain', 'crack', 'skid', 'scatter', 'stones', 'tuft', 'puddle'] as const

export type DecalKind = (typeof DECAL_KINDS)[number]

import { DRAW_DISTANCE, FOG_STEPS, fogStepFor } from './constants'
import { biomeForSegment } from './biomes'

/**
 * The opacities the atlas is drawn at, one row per entry.
 *
 * **A `Mesh2D` carries one object-wide tint and no per-vertex colour** — the same constraint that
 * made the road's own distance fog a texture rather than a tint — so a decal cannot be handed its
 * own opacity at draw time. It picks one instead: the atlas holds every mark at each of these
 * strengths, and a quad's V coordinate selects the row. That buys the two things a single alpha
 * could not, in one mechanism and for no extra draw call: marks that differ from each other, and
 * marks that fade into the fog rather than sitting on it at full strength.
 */
export const DECAL_ROW_ALPHAS = [1, 0.8, 0.62, 0.46, 0.3, 0.16] as const

/**
 * Which row a mark of this strength, this far into the fog, is drawn from.
 *
 * Nearest rather than interpolated: there is nothing to interpolate between — a quad reads one
 * row, and picking the closest available opacity is the whole of the decision. Returns `-1` when
 * the mark has faded past the faintest row, which the renderer takes as "do not draw it at all".
 */
export function decalRowFor(strength: number, fade: number): number {
  const wanted = strength * (1 - Math.min(1, Math.max(0, fade)))

  if (wanted < DECAL_ROW_ALPHAS[DECAL_ROW_ALPHAS.length - 1] * 0.6) return -1

  let best = 0

  for (let row = 1; row < DECAL_ROW_ALPHAS.length; row++) {
    if (Math.abs(DECAL_ROW_ALPHAS[row] - wanted) < Math.abs(DECAL_ROW_ALPHAS[best] - wanted)) best = row
  }

  return best
}

/**
 * How far down the draw distance decals are drawn at all.
 *
 * **A near-ground detail by construction rather than by taste.** Perspective compresses the far
 * half of `DRAW_DISTANCE` into a handful of pixels — the same fact `FOG_CURVE` is front-loaded for
 * — so a mark beyond this is smaller than the pixel it would be drawn into, and the quad costs the
 * same as one filling the bottom of the frame. Bounding it here is also what keeps the mesh's
 * fixed quad count small enough to be honest about.
 *
 * The fade does most of the work before this bites: a mark is dropped as soon as it is fainter
 * than the atlas's faintest row, which on the shipped curve happens well inside this range for all
 * but the strongest. This is the ceiling, not the typical case.
 */
export const DECAL_DRAW_SEGMENTS = 110

/**
 * Marks the mesh can draw at once.
 *
 * **Swept rather than guessed** — `verify:road` walks the whole lap, prints the busiest stretch's
 * demand against this, and fails both if the demand exceeds it and if it is more than twice the
 * demand. The second half is the lesson the decor pool taught by sitting at 72 against a measured
 * peak of exactly 72: a saturated pool reports its own ceiling, and an oversized one reports
 * nothing at all.
 *
 * It lives here rather than on `DecalMesh` because a check cannot import that file — it imports
 * phaser — and a pool ceiling nothing can measure is the shape of the problem it exists to avoid.
 */
export const DECAL_POOL_SIZE = 96

/**
 * How far into its own fade a mark this far away is, `0..1`.
 *
 * **The ground's own fog curve, renormalised over the decal band.** Two requirements pull against
 * each other here: a mark has to fade at the rate the ground under it fades, or it separates from
 * the surface it is painted on; and it has to have finished fading by the time the band ends, or it
 * winks out mid-air at `DECAL_DRAW_SEGMENTS`. Taking the road's own front-loaded curve and dividing
 * by its value at the end of the band satisfies both — the shape is the fog's, the end is the
 * band's. `verify:road` prints where the faintest and the strongest mark actually go out, and both
 * are inside the band.
 */
export function decalFade(distanceIndex: number): number {
  const end = fogStepFor(Math.min(DECAL_DRAW_SEGMENTS, DRAW_DISTANCE - 1)) / (FOG_STEPS - 1)

  if (!(end > 0)) return 0

  return Math.min(1, fogStepFor(distanceIndex) / (FOG_STEPS - 1) / end)
}

/**
 * Chance that a segment starts a decal.
 *
 * **⚠ ZERO: no mark is laid on the ground unless something is hanging over that spot.** These were
 * added to give the largest surface in the frame some fibre, and they do — but a soft dark patch
 * on the ground is exactly what a shadow is, and the ground carried dozens of them. Reported as
 * stray shadows lying nowhere near their objects; a DEV overlay labelling every dark patch by
 * whatever drew it (`DebugMarks`) came back **43 decals, 13 shadows, 0 orphans**, so they were not
 * misplaced shadows at all and no pool was out of step. They were these.
 *
 * **The rule this leaves, and it is the whole reason the knob is 0 rather than the file deleted:
 * a soft dark patch on the ground means an object is above that spot, and nothing else. Surface
 * texture is carried by the colour of the surface** — `GROUND_SHADES_PER_BIOME` for the verge and
 * `ROAD_SHADES_PER_THEME` for the asphalt — which cannot be confused with a shadow by
 * construction, because it *is* the ground rather than something laid over it.
 *
 * Kept as a knob at 0, the same line `GROUND_ALTERNATION` is on: the machinery is correct, and if
 * a mark is ever wanted again it will be one *attached to an object* — a scuff at the foot of a
 * boulder, a scrape where the snail landed — which has an owner and so cannot be ownerless. That
 * needs the placer to take an owner, not a different density.
 */
export const DECAL_DENSITY = 0

/**
 * How far either side of the centreline a decal may sit, in road half-widths.
 *
 * **Was 2.2, which is the road plus the lip of the verge — and from there out to
 * `GROUND_EXTENT` the ground carried nothing at all.** That is the flat expanse: not a missing
 * texture, a marked strip a tenth as wide as the surface it sits on.
 *
 * Bounded by where the ground actually is rather than by the frame: a mark past `GROUND_EXTENT`
 * would be drawn on sky. Kept well inside it because the far tier of scenery starts at 20 and a
 * mark under a distant silhouette is a mark nobody resolves.
 */
export const DECAL_MAX_OFFSET = 13

/**
 * How the offsets crowd the near verge, as an exponent on a `0..1` draw.
 *
 * **A uniform draw across a field six times wider is a field six times emptier where it is
 * looked at.** `DECOR.OFFSET_BIAS` exists for the identical reason and this is the same trick:
 * raising a `0..1` value to a power above 1 pulls it toward zero, so most marks stay in the band
 * the player reads and the rest fill the ground out to the edge of the frame. `verify:road`
 * measures the share that still lands inside the old 2.2 band rather than trusting the exponent.
 */
export const DECAL_OFFSET_BIAS = 2.1

/** Size range, in road half-widths. A decal is wider than it is long — see `lengthSegments`. */
export const DECAL_HALF_WIDTH = { min: 0.18, max: 0.62 } as const

/** How many segments long a decal is. One segment is 200 units against a 2000-unit road. */
export const DECAL_LENGTH_SEGMENTS = { min: 2, max: 4 } as const

export interface DecalPlacement {
  kind: DecalKind
  /** Index into `DECAL_KINDS`, which is also the atlas cell — see `decalArt.ts`. */
  kindIndex: number
  /** Centre, in road half-widths from the centreline. `0` is the middle of the road. */
  offsetX: number
  /** Half its width, in road half-widths. */
  halfWidth: number
  /** How many segments of track it covers. */
  lengthSegments: number
  /** Mirrored along X, which doubles four shapes into eight for nothing. */
  flipX: boolean
  /** How dark it is drawn, `0..1`. */
  strength: number
}

/**
 * A 32-bit hash of a segment index.
 *
 * Its own hash rather than `createRng`, for exactly the reason `decorVariation.ts` gives: a seeded
 * generator is a *stream* and has to be walked in order to reach the nth value, and what is wanted
 * here is an answer for one coordinate, in any order, the same every time.
 */
function hash(segmentIndex: number): number {
  let h = 2166136261 ^ Math.imul(segmentIndex + 1, 2654435761)

  h ^= h >>> 15
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13

  return h >>> 0
}

/** A stable `0..1` from the hash, per axis, so the axes vary apart rather than together. */
function unit(h: number, axis: number): number {
  const mixed = Math.imul(h ^ Math.imul(axis + 1, 0x9e3779b1), 0x85ebca6b)

  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296
}

/**
 * The mark starting on this segment, or `null` for the segments — most of them — that carry none.
 *
 * **Starting, not covering**: a decal runs over `lengthSegments` segments, and only the first of
 * them answers. That is what stops two decals from being generated inside each other, and it is
 * why the renderer walks segments rather than asking each visible one what it is showing.
 */
export function decalAt(
  segmentIndex: number,
  trackLength = 0,
  // **Takeable as an argument so the placer stays under test with the shipped density at 0.** The
  // machinery is correct and is what a future object-owned mark would be built on; a check that
  // could only ever see "nothing is placed" would stop guarding any of it.
  density = DECAL_DENSITY,
): DecalPlacement | null {
  const h = hash(segmentIndex)

  if (unit(h, 0) >= density) return null

  const between = (axis: number, min: number, max: number) => min + unit(h, axis) * (max - min)

  // **The biome decides which marks exist here, exactly as it decides which props stand here.**
  // Listed in order of commonness and picked uniformly, so a kind named twice appears twice as
  // often -- the same cheaper-than-weights knob `Biome.props` uses, and readable in the data.
  const allowed = trackLength > 0 ? biomeForSegment(segmentIndex, trackLength).decals : DECAL_KINDS
  const name = allowed[Math.min(allowed.length - 1, Math.floor(unit(h, 1) * allowed.length))]
  const kindIndex = Math.max(0, DECAL_KINDS.indexOf(name as DecalKind))

  // Biased toward the near verge: `|offset|` is a biased draw and the side is its own axis, so
  // the two do not correlate the way `between(-max, max)` would leave them.
  const side = unit(h, 7) < 0.5 ? -1 : 1

  return {
    kind: DECAL_KINDS[kindIndex],
    kindIndex,
    offsetX: side * Math.pow(unit(h, 2), DECAL_OFFSET_BIAS) * DECAL_MAX_OFFSET,
    halfWidth: between(3, DECAL_HALF_WIDTH.min, DECAL_HALF_WIDTH.max),
    lengthSegments: Math.round(between(4, DECAL_LENGTH_SEGMENTS.min, DECAL_LENGTH_SEGMENTS.max)),
    flipX: unit(h, 5) < 0.5,
    // Never fully opaque and never invisible: a mark at full strength is a hole in the road, and
    // one under a third of the way up is a smudge nobody sees at the distance it appears at.
    strength: between(6, 0.35, 0.85),
  }
}

/**
 * How many marks are actually drawn with the camera on `fromSegment`. For sizing the pool.
 *
 * **Drawn, not present**: the density is the chance a segment *starts* a mark, and a mark that has
 * faded past the faintest row is not drawn at all — counting those would size the pool for demand
 * that never arrives. What this cannot know is the hill clip, which needs a projection; that only
 * ever removes marks, so this is an upper bound on what a frame asks for.
 */
export function decalsIn(fromSegment: number, segments: number, trackLength = 0, density = DECAL_DENSITY): number {
  let count = 0

  for (let i = 0; i < segments; i++) {
    const decal = decalAt(fromSegment + i, trackLength, density)

    if (decal && decalRowFor(decal.strength, decalFade(i)) >= 0) count++
  }

  return count
}
