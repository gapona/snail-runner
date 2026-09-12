/**
 * The 3-2-1 before a run comes back.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:suspend` covers it, beside the other
 * half of putting a run back on the road.
 *
 * Asked for after playing: once a continue is taken, give a pause and a 3-2-1 in the middle of the
 * screen, so there is time to focus. A continue puts the snail back on the piece of road that
 * killed it, at the speed it was doing — and it did so on the frame the panel closed, i.e. while the
 * player's thumb was still on the button they had just pressed. `CONTINUE_GRACE_Z` made the first
 * obstacle harmless; nothing made the first *second* readable.
 *
 * - **The road holds and the snail does not.** It is the tutorial card's arrangement: everything
 *   that advances the run is skipped, and `stepPlayer` still runs, so the count is time to line the
 *   snail up rather than time spent watching a frozen frame.
 * - **The grace survives it whole**, because the grace is a distance and the road is not moving.
 * - **Ticked by the frame's own delta, clamped**, so a backgrounded tab's multi-second delta cannot
 *   skip the count — the player comes back to the same number they left. A paused scene does not
 *   tick at all, so a platform pause mid-count resumes the count where it was.
 */

/** How long the count is: one second a digit. */
export const RESUME_COUNTDOWN_MS = 3000

/** The largest delta one frame may take off the count. See the module docstring. */
export const COUNTDOWN_MAX_STEP_MS = 100

/** The digit on screen for this much of the count left: 3, 2, 1, and 0 once it is over. */
export function countdownDigit(leftMs: number): number {
  if (!(leftMs > 0)) return 0

  return Math.min(Math.ceil(RESUME_COUNTDOWN_MS / 1000), Math.ceil(leftMs / 1000))
}

/**
 * How a digit is drawn at this point in its own second.
 *
 * It arrives large and snaps down to its size — a punch, which is what makes three numbers in a
 * row read as a count rather than as a label changing — and it fades over the last fifth of its
 * second, so the next one arrives into an empty frame instead of on top of the last.
 */
export function countdownPulse(leftMs: number): { scale: number; alpha: number } {
  if (!(leftMs > 0)) return { scale: 1, alpha: 0 }

  // 1 as a digit arrives, 0 as it leaves.
  const phase = (leftMs % 1000 || 1000) / 1000
  const scale = 1 + 0.6 * phase ** 4
  const alpha = Math.min(1, phase / 0.2)

  return { scale, alpha }
}

/** One frame of the count. */
export function stepCountdown(leftMs: number, deltaMs: number): number {
  if (!(leftMs > 0)) return 0

  const step = Number.isFinite(deltaMs) && deltaMs > 0 ? Math.min(deltaMs, COUNTDOWN_MAX_STEP_MS) : 0

  return Math.max(0, leftMs - step)
}
