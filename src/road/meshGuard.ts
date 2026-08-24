/**
 * The vertex-buffer bounds decision, split out of `RoadMesh` so both of its branches are
 * testable.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:road`. `RoadMesh` must
 * import Phaser, so the decision it makes on every quad write could not otherwise be exercised
 * under Node at all, and the production branch — the one that must *not* throw — is exactly the
 * branch nobody would notice was wrong.
 *
 * The failure being guarded is silent by nature: a quad index past the end of the buffer writes
 * over the *next* segment's vertices, because a JS array grows rather than throwing. It surfaces
 * as geometry flickering at the draw-distance boundary, nowhere near the arithmetic that caused
 * it. Every buffer size derives from `QUADS_PER_SEGMENT`, so it can only happen when a segment
 * starts emitting more quads than that constant claims — which is precisely what adding the
 * centre-line dash did.
 */

/** What the caller should do about a quad write. */
export type QuadWriteAction =
  /** In bounds — write it. */
  | 'write'
  /** Out of bounds in DEV: throw, loudly, at the first bad write. */
  | 'throw'
  /** Out of bounds in production, first time: drop the write and report once. */
  | 'report'
  /** Out of bounds in production, already reported: drop the write silently. */
  | 'skip'

/**
 * Decides what to do with a quad write.
 *
 * **The two environments want opposite things.** In DEV a throw is right: the check runs every
 * frame and a loud failure at the first bad write is what makes the cause findable at all. In
 * production the same throw would end the game over a cosmetic strip of road, so the write is
 * dropped — at worst one stale trapezoid — and the fault reported **once per session**. Per-frame
 * reporting would push the same signal into a rate-limited health API sixty times a second,
 * which is the mistake `health.ts` already exists to prevent.
 */
export function quadWriteAction(
  quad: number,
  quadStride: number,
  bufferLength: number,
  isDev: boolean,
  alreadyReported: boolean,
): QuadWriteAction {
  const offset = quad * quadStride

  if (quad >= 0 && Number.isFinite(quad) && offset + quadStride <= bufferLength) return 'write'
  if (isDev) return 'throw'

  return alreadyReported ? 'skip' : 'report'
}
