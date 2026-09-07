/**
 * A flyer's wings: one drawing, mirrored, rotated about its own hinge.
 *
 * **Rule: this file never imports `phaser`** — it is arithmetic, and `npm run verify:critters`
 * loads it under Node.
 *
 * ── No frames ──────────────────────────────────────────────────────────────────────────────────
 *
 * The same argument the frog's hop is built on. A wingbeat drawn as frames is art that can disagree
 * with itself, and it bakes the RATE into the sprite: `references/wasp 2.jpg` is exactly that — a
 * render with motion-blurred wings — and it was rejected for it, because a blur is a speed, and the
 * speed here is a per-kind constant the game may re-tune. One wing, rotated, costs one texture and
 * has a frequency the code owns.
 *
 * ── ⚠ The beat is a CLOCK, and it is the one animation here that may be ────────────────────────
 *
 * Everything else in this game that moves is driven by distance — the slime trail, the glide cycle,
 * the beetle's gait, the frog's hop — because a time-driven cadence stops matching the ground going
 * past. A wingbeat is the exception and deliberately so: it is not a gait. It does not push against
 * the road, it is not what carries the creature along, and at 30-plus beats a second it is far past
 * anything the eye can count anyway. Tying it to travel would make a hovering wasp's wings stop,
 * which is the one thing a wingbeat may never do.
 *
 * ── The numbers are measured, not authored ─────────────────────────────────────────────────────
 *
 * `attach`, `pivot` and `restAngle` all come from `scripts/normalize-flyer.py`, which reads them off
 * the supplied ASSEMBLED reference: it finds the body as the tall central plateau of the drawing,
 * takes the wings as the flanks, and puts the hinge where they meet. They live in `critters.ts`'s
 * table beside the kind, and `dev-assets/critter/critter-art.json` is the report they were read
 * from — see ART-STYLE.md.
 */

/**
 * How far a wing swings either side of its resting angle, in degrees.
 *
 * **A wingbeat is not a flap.** These are drawn from the front, so what the player sees is the wing
 * foreshortening rather than sweeping — a large angle reads as a bird's wing and a small one as a
 * blur of something much faster. 26 degrees is what keeps the tip inside the silhouette the
 * creature is read by.
 */
export const WING_SWEEP_DEG = 26

/**
 * Beats per second, per kind, and the ordering is the design.
 *
 * The three flyers differ in danger and the wingbeat is one of the two cues that says so from a
 * distance (the other is closing speed). A mosquito's whine is the fastest thing in the frame; a
 * bee is the most placid.
 *
 * **All three are past what a frame rate resolves, and that is the point** — this project's own
 * finding on the first bee: *a wingbeat the eye can count is a bird*. What the player sees is a
 * shimmer whose rate they read without counting.
 */
export const WING_BEATS_PER_SECOND: Record<string, number> = {
  bee: 34,
  hornet: 42,
  mosquito: 58,
}

export interface WingPose {
  /** Rotation of the RIGHT wing, in radians. The left is its mirror. */
  readonly angle: number
}

/**
 * Where a wing is at time `ms`.
 *
 * `offsetMs` staggers one creature against another, for `HOP_PHASE_STAGGER_MS`' reason: two flyers
 * beating in lockstep read as one object drawn twice.
 */
export function wingAngle(kind: string, ms: number, restDeg: number, offsetMs = 0): number {
  const beats = WING_BEATS_PER_SECOND[kind] ?? 0

  if (!beats) return (restDeg * Math.PI) / 180

  const phase = ((ms + offsetMs) / 1000) * beats * Math.PI * 2

  return ((restDeg + WING_SWEEP_DEG * Math.sin(phase)) * Math.PI) / 180
}

/** How far apart two flyers' beats are pushed, per unit of id. See `HOP_PHASE_STAGGER_MS`. */
export const WING_PHASE_STAGGER_MS = 31

/**
 * The vertical extent of a rotated sprite, relative to the point it is positioned at.
 *
 * A wing is drawn from an origin inside its own frame and then turned about it, so neither its
 * `y` nor its display height says where the blade actually reaches. `bottom` is how far below the
 * position the lowest drawn corner falls and `height` is the whole span, which is what the hill
 * clip has to fade over.
 */
export function rotatedSpan(
  width: number,
  height: number,
  originX: number,
  originY: number,
  angle: number,
): { bottom: number; height: number } {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let low = -Infinity
  let high = Infinity

  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const y = (u - originX) * width * sin + (v - originY) * height * cos

    if (y > low) low = y
    if (y < high) high = y
  }

  return { bottom: low, height: low - high }
}
