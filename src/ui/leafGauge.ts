/**
 * The outline of a leaf, and how much of it a fill covers.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:ui` loads it under Node.
 *
 * A leaf rather than a bar because the gauge is filled by **fruit**, and a bar is the one shape in
 * an interface that means nothing in particular: this game already has two of them and a third
 * would be a third thing to read the colour of. A leaf says what fills it before any colour does.
 *
 * ## ⚠ Why the fill is a polygon and not a mask
 *
 * `GameObject.setMask(geometryMask)` is a **silent no-op under this project's WebGL renderer** — it
 * warns and returns without assigning `.mask`, which this codebase has now hit in four separate
 * places. So the fill cannot be the whole leaf with a rectangle over it; it has to be the leaf
 * *truncated*, computed as a shorter polygon. That is what `leafFill` returns.
 *
 * ## ⚠ A symmetric lens is not a leaf, it is an eye
 *
 * The first shape was `sin(pi t)` — fattest exactly in the middle, pointed identically at both ends,
 * with a straight rib through it. On screen that is an eye, and it was reported as looking poor. A
 * leaf is **asymmetric**: it is fattest a third of the way from the stem and tapers to a long point,
 * it has a stem, and its rib curves.
 *
 * So the profile is a beta curve, `t^p * (1-t)^q` normalised to 1 at its own peak. `p < q` puts the
 * widest part near the base, which is the whole difference — and the peak's position is `p/(p+q)`,
 * so it is a number that can be stated and checked rather than eyeballed.
 *
 * Both edges are still monotone in `x`, which is the property that makes truncating the fill a
 * matter of dropping points rather than of clipping geometry — see `leafFill`.
 */

/**
 * The two exponents of the profile: `t^base * (1-t)^tip`.
 *
 * `base < tip` is what makes it a leaf rather than a lens — the blade swells quickly out of the stem
 * and then runs a long way to the point. Their ratio is the only thing that decides the silhouette,
 * and `LEAF_WIDEST` states where it puts the widest part so the shape is a number rather than a
 * feeling.
 */
export const LEAF_SHAPE = { base: 0.62, tip: 1.45 } as const

/** Where the leaf is at its widest, `0..1` from the stem — `p / (p + q)` of the profile above. */
export const LEAF_WIDEST = LEAF_SHAPE.base / (LEAF_SHAPE.base + LEAF_SHAPE.tip)

/** How far the rib bows toward the tip, as a fraction of the half-height. A straight rib reads as an eye. */
export const LEAF_RIB_BOW = 0.34

/** How long the stem is, as a fraction of the leaf's own length. */
export const LEAF_STEM = 0.16

/** How many points each edge is sampled at. Enough that the curve reads as one at HUD sizes. */
export const LEAF_SAMPLES = 24

export interface Point {
  x: number
  y: number
}

/**
 * Half the leaf's height at `t` along it, `0..1`, measured from the rib.
 *
 * Normalised by the profile's own peak so `height` means what it says whatever the exponents are —
 * without that, changing the shape silently changes the size.
 */
export function leafHalfHeight(t: number, height: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  const { base, tip } = LEAF_SHAPE
  const peak = LEAF_WIDEST ** base * (1 - LEAF_WIDEST) ** tip

  return (height / 2) * ((clamped ** base * (1 - clamped) ** tip) / peak)
}

/**
 * Where the rib sits at `t`, relative to the leaf's own centre line.
 *
 * A shallow bow toward the tip. It is what stops the shape reading as an eye, and it is also what a
 * leaf actually does — the midrib is the stiff part and the blade hangs off it.
 */
export function leafRib(t: number, height: number): number {
  const clamped = Math.max(0, Math.min(1, t))

  return -(height / 2) * LEAF_RIB_BOW * Math.sin(Math.PI * clamped) * clamped
}

/**
 * The closed outline, from the left tip along the top edge to the right tip and back.
 *
 * Returned as a flat point list so the caller can hand it straight to a path: the drawing side of
 * this has no arithmetic in it at all, which is what keeps the shape testable.
 */
export function leafOutline(width: number, height: number, samples = LEAF_SAMPLES): Point[] {
  const points: Point[] = []

  for (let i = 0; i <= samples; i++) {
    const t = i / samples

    points.push({ x: t * width, y: leafRib(t, height) - leafHalfHeight(t, height) })
  }
  for (let i = samples; i >= 0; i--) {
    const t = i / samples

    points.push({ x: t * width, y: leafRib(t, height) + leafHalfHeight(t, height) })
  }

  return points
}

/** The rib itself, from stem to tip, as a polyline. */
export function leafRibLine(width: number, height: number, samples = LEAF_SAMPLES): Point[] {
  const points: Point[] = []

  for (let i = 0; i <= samples; i++) {
    const t = i / samples

    points.push({ x: t * width, y: leafRib(t, height) })
  }

  return points
}

/**
 * The side veins, as pairs of points from the rib out to just short of the edge.
 *
 * Four of them, alternating sides, angled toward the tip — which is the one detail that makes a
 * green shape read as a leaf rather than as a green shape, and it costs four line segments.
 */
export function leafVeins(width: number, height: number): [Point, Point][] {
  const veins: [Point, Point][] = []

  for (let i = 0; i < 4; i++) {
    const t = 0.2 + i * 0.18
    const side = i % 2 === 0 ? -1 : 1
    const reach = leafHalfHeight(t, height) * 0.78

    veins.push([
      { x: t * width, y: leafRib(t, height) },
      { x: (t + 0.13) * width, y: leafRib(t, height) + side * reach },
    ])
  }

  return veins
}

/**
 * The same leaf truncated at `fill` of its width, as a closed polygon.
 *
 * Empty below a pixel of fill: a polygon with two coincident points is a degenerate triangle, and
 * the renderer draws it as a stray hairline at the leaf's own tip — which reads as a gauge that is
 * never quite empty.
 */
export function leafFill(width: number, height: number, fill: number, samples = LEAF_SAMPLES): Point[] {
  const cut = Math.max(0, Math.min(1, fill))

  if (cut * width < 1) return []

  const points: Point[] = []
  const edge = (t: number, sign: number): Point => ({
    x: t * width,
    y: leafRib(t, height) + sign * leafHalfHeight(t, height),
  })

  for (let i = 0; i <= samples; i++) {
    const t = i / samples

    if (t > cut) break
    points.push(edge(t, -1))
  }
  // The cut itself, top and bottom, so the fill ends on a straight edge rather than on whichever
  // sample happened to fall nearest it.
  points.push(edge(cut, -1))
  points.push(edge(cut, 1))
  for (let i = samples; i >= 0; i--) {
    const t = i / samples

    if (t > cut) continue
    points.push(edge(t, 1))
  }

  return points
}
