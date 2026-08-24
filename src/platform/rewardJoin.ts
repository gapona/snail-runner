/**
 * Joining the two signals a rewarded ad produces, in either order, exactly once.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:run`.
 *
 * A rewarded ad hands back two things at two different times: the platform's `RESUME`, and the
 * promise that says whether the reward was earned. **The platform sends `RESUME` first**, and by
 * the time the promise settles the scene may have been restarted underneath it — so restoring
 * state in the promise's `.then()` acts on a scene that is no longer the one that asked.
 *
 * Restoring on `RESUME` alone is no better: at that moment nobody knows yet whether the reward
 * was actually earned, so it would hand out the continue for an ad the player skipped.
 *
 * So: wait for both, apply on whichever arrives second, and apply once. The ordering is not
 * assumed anywhere — that is the whole point, because the ordering is exactly what a test on a
 * developer machine gets wrong and a real platform gets right.
 */

export interface RewardJoin {
  resumed: boolean
  /** Whether the reward was actually earned. Meaningless until `settled`. */
  granted: boolean
  settled: boolean
  applied: boolean
}

export function createRewardJoin(): RewardJoin {
  return { resumed: false, granted: false, settled: false, applied: false }
}

/** Records the platform's resume. Applies if the reward has already been decided. */
export function noteResume(join: RewardJoin, apply: () => void): void {
  join.resumed = true
  maybeApply(join, apply)
}

/** Records the ad's outcome. Applies if the resume has already arrived. */
export function noteReward(join: RewardJoin, granted: boolean, apply: () => void): void {
  join.settled = true
  join.granted = granted
  maybeApply(join, apply)
}

function maybeApply(join: RewardJoin, apply: () => void): void {
  if (join.applied) return
  if (!join.resumed || !join.settled) return

  // Marked applied even when the reward was refused: the join is spent either way, so a second
  // stray signal cannot re-run it.
  join.applied = true
  if (join.granted) apply()
}
