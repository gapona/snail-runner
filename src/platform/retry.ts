/**
 * Two retry policies the platform layer needs, as arithmetic.
 *
 * **Rule: this file never imports `phaser` and touches no global** — `npm run verify:platform`
 * loads it under plain Node. That matters more here than usual: both policies exist because of
 * failures that only happen when the *platform* is slow, which is the one condition a developer's
 * machine never reproduces, so the only place they can be exercised is a test.
 *
 * Both are about the same underlying fact: **the SDK is a script the page does not control the
 * timing of.** Reading it once, synchronously, at the moment the game happens to want it is a bet
 * that it has already arrived — and when that bet loses there is no second chance, because nothing
 * calls again.
 */

/**
 * How long a mandatory ready call keeps trying, and how often.
 *
 * **⚠ `firstFrameReady()` and `gameReady()` are MUST-CALL, and a lost one is invisible.** Both used
 * to be `getSdk()?.game.firstFrameReady()` — an optional chain that does nothing at all when the
 * SDK has not attached yet, followed by a `console.debug` saying the call was made. So a platform
 * that is 200ms late does not delay the signal, it *deletes* it: the game is never shown, and the
 * log says everything is fine.
 *
 * The window is generous on purpose. There is no cost to still trying at 8 seconds — the retry is a
 * cheap poll of a global — and the cost of giving up too early is a submission that fails
 * certification intermittently, on exactly the connections the reviewer is least likely to have.
 */
export const READY_RETRY = { intervalMs: 100, windowMs: 8000 } as const

/** How many times a ready call is attempted across `READY_RETRY.windowMs`. */
export function readyAttempts(policy: { intervalMs: number; windowMs: number } = READY_RETRY): number {
  return Math.max(1, Math.floor(policy.windowMs / policy.intervalMs))
}

/**
 * How many times the save is read before the game gives up on it, and how long it waits between.
 *
 * **⚠ `LOAD_ATTEMPTS` is not politeness, it is the difference between a retry and data loss.** The
 * SDK's own error table lists `API_UNAVAILABLE` as *retry later*; one attempt turns that transient
 * into "this player has no save", and the first thing the game then does is write defaults over
 * their real one. See `loadConfirmed` in `src/save/save.ts` for the other half of the fix — the
 * retry alone is not enough, because the last attempt can still fail.
 *
 * Backoff rather than a fixed gap: the failure this is for is a platform still starting up, which
 * resolves in tens of milliseconds or in seconds, and a fixed 100ms gap spends all four attempts
 * inside the first case.
 */
export const LOAD_ATTEMPTS = 4
export const LOAD_BACKOFF = { firstMs: 120, factor: 2.5, maxMs: 2000 } as const

/**
 * How long to wait before attempt `index` (0-based), in milliseconds.
 *
 * `0` before the first, so a working platform pays nothing for the policy existing.
 */
export function loadBackoffMs(
  index: number,
  policy: { firstMs: number; factor: number; maxMs: number } = LOAD_BACKOFF,
): number {
  if (index <= 0) return 0

  return Math.min(policy.maxMs, policy.firstMs * policy.factor ** (index - 1))
}

/** The total time a full set of attempts can take waiting, excluding the calls themselves. */
export function loadBudgetMs(attempts = LOAD_ATTEMPTS, policy = LOAD_BACKOFF): number {
  let total = 0

  for (let i = 0; i < attempts; i++) total += loadBackoffMs(i, policy)

  return total
}
