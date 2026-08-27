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
 * The shape is `y = ±(h/2) * sin(pi * t) ^ LEAF_ROUNDNESS` over `t` in `0..1`: pointed at both ends,
 * fattest in the middle, and monotone in `x` along each edge — which is the property that makes
 * truncating it a matter of dropping points rather than of clipping geometry.
 */

/**
 * How round the leaf is between its two points.
 *
 * Below 1 fattens it toward the tips, so the gauge reads as nearly full well before it is — which
 * is the wrong way for a gauge to lie. Above 1 makes a thin spindle whose fill is invisible at
 * either end. At 0.72 the widest part sits over the middle and the fill's width tracks its own
 * progress closely enough that a glance is not misleading.
 */
export const LEAF_ROUNDNESS = 0.72

/** How many points each edge is sampled at. Enough that the curve reads as one at HUD sizes. */
export const LEAF_SAMPLES = 24

export interface Point {
  x: number
  y: number
}

/** Half the leaf's height at `t` along it, `0..1`. */
export function leafHalfHeight(t: number, height: number): number {
  const clamped = Math.max(0, Math.min(1, t))

  return (height / 2) * Math.sin(Math.PI * clamped) ** LEAF_ROUNDNESS
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

    points.push({ x: t * width, y: -leafHalfHeight(t, height) })
  }
  for (let i = samples; i >= 0; i--) {
    const t = i / samples

    points.push({ x: t * width, y: leafHalfHeight(t, height) })
  }

  return points
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
  const edge = (t: number, sign: number): Point => ({ x: t * width, y: sign * leafHalfHeight(t, height) })

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
