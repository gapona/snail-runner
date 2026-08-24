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
  /** Whether the player has already taken the one rewarded continue this run allows. */
  continueUsed: boolean
}

export function createAdPolicy(): AdPolicyState {
  return { interstitialsShown: 0, lastInterstitialAt: 0, continueUsed: false }
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
 * Whether the player may be offered a rewarded continue.
 *
 * Once per run, and only when the run actually ended in failure — a continue offered after a
 * cleared run is an ad with nothing attached to it, which is the version of this that gets a
 * submission rejected.
 */
export function canOfferContinue(state: AdPolicyState, runFailed: boolean): boolean {
  return runFailed && !state.continueUsed
}

/** Records that the continue was offered, spent or refused. Either way it is gone for this run. */
export function noteContinue(state: AdPolicyState): void {
  state.continueUsed = true
}

/** Resets the per-run half of the policy. The session counters deliberately survive. */
export function resetForNewRun(state: AdPolicyState): void {
  state.continueUsed = false
}
