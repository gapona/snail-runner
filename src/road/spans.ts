/**
 * How many segments the road mesh merges into one trapezoid.
 *
 * **Rule: this file never imports `phaser`.** Same split, and the same reason, as `surface.ts`
 * and `project.ts`: the arithmetic lives here where `npm run verify:road` can assert it, and
 * `RoadMesh` does nothing with it but ask when to close a span.
 *
 * The road is walked `DRAW_DISTANCE` segments deep and every one of them used to write its own
 * six quads — 1800 in all, submitted every frame whatever the camera could see. Measured in the
 * running game at 375x667, the far field is not merely small, it is **unresolvable**: over a
 * live run the segments past the 120th draw a median of 8.4 screen pixels of road between them
 * and 28 at their worst, spread across 180 segments. That is 0.05 to 0.15 of a pixel each.
 *
 * So they are merged rather than culled, and the distinction is the whole design. Culling would
 * take 28 pixels of road off a crest, which is a hole in the picture at exactly the moment the
 * player can see furthest. Merging draws the same band with fewer, longer quads.
 *
 * **What bounds the damage is that a span is closed by height.** A span emitted the moment it
 * reaches `minPx` covers at most that much of the frame plus whatever the segment that closed it
 * adds — so what a merge can hide is bounded by the size of the thing that hid it, and the near
 * field, where one segment is tens of pixels tall, never merges at all.
 *
 * The floor itself is `MIN_ROAD_SPAN_PX`, and it is the framebuffer's *sample* spacing rather
 * than its pixel spacing — see that constant for why a multisampled context makes those two
 * different numbers, and for the measured cost of getting it wrong in either direction.
 */

/**
 * Whether the span opened at `spanNearY` and now reaching `farY` is tall enough to emit.
 *
 * Screen y grows downward, so a span's height is `near - far`. A non-positive height cannot
 * close a span: that is a segment projecting inside-out or onto its own near edge, which the
 * caller culls anyway, and treating it as full would emit a zero-area quad and start a new span
 * on the next segment — i.e. it would merge nothing while paying for the attempt.
 */
export function spanIsFull(spanNearY: number, farY: number, minPx: number): boolean {
  return spanNearY - farY >= minPx
}

/**
 * The span lengths a run of per-segment screen heights produces, for the check.
 *
 * Not used by the renderer — `RoadMesh` closes spans as it walks, because it has the projection
 * in hand and this would mean keeping the heights. It is here so `verify:road` can assert the
 * properties that matter over a whole walk (coverage, the bound on what a merge hides, and that
 * a floor of zero reproduces one span per segment) against the same predicate the renderer uses.
 *
 * A zero or negative height is a culled segment: it closes whatever span is open and belongs to
 * none, exactly as the renderer treats it.
 */
export function planSpans(heights: readonly number[], minPx: number): number[] {
  const spans: number[] = []
  let open = 0
  let height = 0

  for (const h of heights) {
    if (h <= 0) {
      if (open > 0) spans.push(open)
      open = 0
      height = 0
      continue
    }

    open++
    height += h

    if (spanIsFull(height, 0, minPx)) {
      spans.push(open)
      open = 0
      height = 0
    }
  }
  if (open > 0) spans.push(open)

  return spans
}
