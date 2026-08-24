/**
 * The fixed-timestep accumulator, lifted verbatim out of the deleted `src/race/physics.ts`
 * when the game changed genre from racer to rail shooter.
 *
 * It is the one piece of the car's handling model that was worth keeping: the model itself
 * (acceleration, braking, off-road grip, centrifugal drift) is gone, but *how* it was
 * integrated is genre-neutral and hard-won. `src/rail/ship.ts` uses it now, and anything
 * else with a per-frame simulation should too.
 *
 * `phaser`-free, so it stays runnable under plain Node for `npm run verify:ship`.
 *
 * (Naming note: this lives under `src/race/` only because that is where it was written. There
 * is nothing racing-specific left in this directory — it is now just the shared timestep
 * machinery. Worth renaming if anything else moves.)
 */
import { FIXED_STEP_MS, MAX_SUB_STEPS, TICK_EPSILON_MS } from './constants'

/** Length of one fixed tick, in seconds — what a `tick` callback should integrate over. */
export const FIXED_STEP_SEC = FIXED_STEP_MS / 1000

/**
 * Runs however many whole 60Hz ticks `dtMs` has earned, and returns the leftover to be
 * carried into the next call.
 *
 * **Why a fixed tick at all:** plain Euler over a raw frame delta makes every derived quantity
 * frame-rate dependent. That is the bug class which surfaces months later as "it behaves
 * differently on my phone" and is invisible when testing on one machine. Running a whole
 * number of identical ticks means a frame rate changes only *when* results appear, never
 * *what* they are.
 *
 * Three details, each of which was a real defect before it was fixed:
 *
 * - **The remainder must be carried by the caller.** Without it two 8.3ms frames would each
 *   do nothing at all instead of together producing one tick.
 * - **`TICK_EPSILON_MS` is load-bearing.** Summing many small deltas drifts a few ulps, so a
 *   run that should total exactly N ticks lands a hair short and silently runs N-1 — a whole
 *   missing tick, and a frame-rate-dependent result. Reproduced by 144Hz braking for one
 *   second; do not "simplify" this back to a bare `>=`.
 * - **The backlog beyond `MAX_SUB_STEPS` is dropped, not carried.** A backgrounded tab
 *   (constant on Playables) returns multi-second deltas; simulating all of it in one frame
 *   lengthens that frame, which grows the next delta — the classic spiral.
 *
 * Negative, `NaN` and `Infinity` deltas are treated as no time passing rather than
 * integrating backwards; a clock that jumps should stall the sim, not corrupt it.
 */
export function runFixedSteps(remainderMs: number, dtMs: number, tick: (dtSec: number) => void): number {
  let pending = remainderMs + (Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0)
  let steps = 0

  while (pending + TICK_EPSILON_MS >= FIXED_STEP_MS && steps < MAX_SUB_STEPS) {
    tick(FIXED_STEP_SEC)
    pending -= FIXED_STEP_MS
    steps++
  }

  // Dropped backlog, plus the lower clamp catching the tiny negative the epsilon can leave.
  if (pending >= FIXED_STEP_MS || pending < 0) pending = 0

  return pending
}
