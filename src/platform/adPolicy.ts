/**
 * When an ad may be shown. Pure decision logic, no SDK, no scene.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:run`.
 *
 * Separate from `adGate.ts` on purpose: that module owns *how* an ad is shown (the pause, the
 * resume, the arbitration with a real platform pause). This one owns *whether*, which is a
 * product decision with real consequences for whether the game gets certified and whether
 * anyone plays it twice.
 */

/** Interstitials per session, and the minimum gap between two of them. */
export const MAX_INTERSTITIALS_PER_SESSION = 3
export const MIN_INTERSTITIAL_GAP_MS = 90_000

/** How long after the game starts before the first interstitial may appear. */
export const FIRST_INTERSTITIAL_DELAY_MS = 60_000

export interface AdPolicyState {
  interstitialsShown: number
  lastInterstitialAt: number
  /**
   * Which of the run's two continues have been spent, keyed by where they came from.
   *
   * **⚠ It was one flag for both, and the two offers cancelled each other out.** Paying for a
   * continue in coins marked the run's continue used, so the *next* death offered nothing at all —
   * neither the ad nor the price. Reported as exactly that, and the report is right: the paid door
   * and the watched door are two products, and taking one is not a reason to close the other.
   *
   * They are still **one each per run**, which is the limit that matters: the ad cannot be watched
   * twice, and the price cannot be paid twice. What a player who does both gets is two extensions
   * of one run, having paid for one of them.
   */
  continuesUsed: Record<ContinueSource, boolean>
  /**
   * How many times each rewarded offer has been taken this session, keyed by reward id.
   *
   * **⚠ The shop's top-up had no limit at all**, so a player could stand in the shop and watch ads
   * until they owned the catalogue — an hour of ads is not a game, and every price in the shop is
   * set against what a *run* pays rather than against how long somebody is willing to sit there.
   * The limit lives here rather than in the scene because a scene is rebuilt every time it is
   * opened and a session is not, which is the same reason `RunOver` keeps this object `static`.
   */
  rewardedTaken: Record<string, number>
}

/**
 * Where a continue was bought.
 *
 * The distinction is the whole of what the two flags are for: a rewarded offer's alternative has to
 * stay reachable *after* the offer has been taken, or the alternative was never really one.
 */
export type ContinueSource = 'ad' | 'coins'

export const CONTINUE_SOURCES: readonly ContinueSource[] = ['ad', 'coins']

export function createAdPolicy(): AdPolicyState {
  return { interstitialsShown: 0, lastInterstitialAt: 0, continuesUsed: noContinuesUsed(), rewardedTaken: {} }
}

function noContinuesUsed(): Record<ContinueSource, boolean> {
  return { ad: false, coins: false }
}

/**
 * How many of a limited rewarded offer are left this session.
 *
 * `limit` is the offer's own `perSession` — `null` for one whose limit is not a session count at
 * all (the two result-screen offers are once per *run*, tracked by `continueUsed` and by the
 * screen's own state), in which case this reports `Infinity` and the caller's own rule decides.
 */
export function rewardedLeft(state: AdPolicyState, id: string, limit: number | null): number {
  if (limit === null) return Number.POSITIVE_INFINITY

  return Math.max(0, limit - (state.rewardedTaken[id] ?? 0))
}

/**
 * Records that a rewarded offer was taken.
 *
 * **Spent on the offer, not on the reward** — the rule `noteContinue` already states: an ad that
 * fails, is skipped, or that the platform simply has none of still costs one, because otherwise a
 * refused ad leaves the button there to be pressed again, which is what turns a rewarded offer into
 * a slot machine.
 */
export function noteRewarded(state: AdPolicyState, id: string): void {
  state.rewardedTaken[id] = (state.rewardedTaken[id] ?? 0) + 1
}

/**
 * Whether an interstitial may be shown right now.
 *
 * `betweenRuns` is the caller's assertion that nothing is in play. **An interstitial mid-wave is
 * not a pacing problem, it is a lost run**: the game is paused under the ad, the player comes
 * back to a screen that has moved on, and Playables reviewers treat it as an interruption of
 * gameplay. The flag is required rather than inferred so the one place that knows is the one
 * that decides.
 *
 * The cap and the gap are separate limits and both matter: three per session stops a long
 * session becoming an ad break with a game attached, and 90 seconds stops three of them landing
 * inside two minutes of a player restarting repeatedly.
 */
export function canShowInterstitial(state: AdPolicyState, now: number, betweenRuns: boolean): boolean {
  if (!betweenRuns) return false
  if (state.interstitialsShown >= MAX_INTERSTITIALS_PER_SESSION) return false
  if (now < FIRST_INTERSTITIAL_DELAY_MS) return false
  if (state.interstitialsShown > 0 && now - state.lastInterstitialAt < MIN_INTERSTITIAL_GAP_MS) return false

  return true
}

/** Records that one was shown. Called whether or not the SDK actually had one to show. */
export function noteInterstitial(state: AdPolicyState, now: number): void {
  state.interstitialsShown++
  state.lastInterstitialAt = now
}

/**
 * Whether the player may be offered a continue from `source`.
 *
 * Once per run **per source**, and only when the run actually ended in failure — a continue offered
 * after a cleared run is an ad with nothing attached to it, which is the version of this that gets
 * a submission rejected.
 *
 * **Asked per source rather than once, and that is the fix rather than a convenience.** With one
 * shared flag, paying in coins shut the ad down and watching the ad shut the price down: the two
 * doors closed each other, so a run had one continue whichever way it was taken. See
 * `continuesUsed`.
 */
export function canOfferContinue(state: AdPolicyState, runFailed: boolean, source: ContinueSource): boolean {
  return runFailed && !state.continuesUsed[source]
}

/**
 * Records that a continue from `source` was offered, spent or refused.
 *
 * **Spent on the offer, not on the reward**, which is `noteRewarded`'s rule and matters most here:
 * an ad that fails, is skipped, or that the platform simply has none of still costs the run its
 * *ad* continue, because otherwise a refused ad leaves the button there to be pressed again. It
 * costs the coin one nothing, which is the whole point of them being two.
 */
export function noteContinue(state: AdPolicyState, source: ContinueSource): void {
  state.continuesUsed[source] = true
}

/** Resets the per-run half of the policy. The session counters deliberately survive. */
export function resetForNewRun(state: AdPolicyState): void {
  state.continuesUsed = noContinuesUsed()
}

/**
 * The one ad budget this session has.
 *
 * **⚠ It was two, for about ten minutes, and that is the shape of the bug this exists to prevent.**
 * `RunOver` has held a `static` policy since interstitials landed, and giving the shop's new
 * per-offer counter its own `static` object beside it produced two session budgets for one session:
 * three interstitials *and* three top-ups tracked in different places, with nothing able to say the
 * two were meant to be the same thing. A session has one budget the same way a screen has one
 * entry list — see `MainMenu.entryGroups`, which is this lesson in the other layer.
 *
 * A module singleton rather than a scene `static`, because the two scenes that read it are rebuilt
 * on different schedules and neither owns the session.
 */
const SESSION_POLICY = createAdPolicy()

export function sessionAdPolicy(): AdPolicyState {
  return SESSION_POLICY
}
