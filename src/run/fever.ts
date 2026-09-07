/**
 * The fruit gauge and the Fever it pays for: the run's one big reward, as a value.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:fever` loads it under Node.
 *
 * A run had two speeds in it and they answered the same question. `boost` raised the ceiling by
 * 60% for three seconds and Fever raises it by 60% for six; a player cannot be asked to remember
 * the difference between "a bit faster" and "a lot faster", and the rail shooter's own set was cut
 * twice on exactly that rule. So **all of the speed is in the fruit now**: fruit fills a gauge, the
 * gauge buys Fever, and there is no other way to go faster than the run's own ceiling.
 *
 * ## ⚠ THERE IS NO GUARD. A FEVER CAN BE CRASHED, AND THAT IS THE POINT
 *
 * Fever used to switch the hitbox off for its whole length, plus the ease after it, plus a fourth
 * phase that held the guard up until the road ahead opened. **Reported twice, from two
 * directions**: that a lot of things on the road were passing through the snail without doing
 * anything, and that flying under the fruit boost should not make the player immortal. Those are
 * the same sentence.
 *
 * A hazard that passes through the snail without hurting it is the same defect as one that hits
 * from further away than it looks, read from the other side — which is what this file used to say
 * about a *removal*, while performing the suppression it was arguing against.
 *
 * **Being hittable at Fever speed is safe by construction rather than by luck.** Every row in this
 * game is spaced against `REACTION_MS` at `MAX_ATTAINABLE_SPEED`, and `MAX_ATTAINABLE_SPEED` *is*
 * `SPEED_CAP * FEVER_SPEED_FACTOR` — the placer has always laid the road on the assumption that
 * the player might be meeting it at Fever speed and would have to react. `verify:obstacles`
 * measures that floor over 500 simulated runs; `verify:fever` asserts the two constants are the
 * same number, so a Fever can never outrun the spacing it was measured against.
 *
 * What a Fever is now is speed and a magnet, and it is *ridden* rather than waited out.
 *
 * ## The exit is still an ordering, and it is still not optional
 *
 * The speed cannot simply stop: sixty percent of it has to come off, and it comes off over
 * `FEVER_EASE_MS` with `FEVER_SETTLE_MS` at the end spent at factor 1, so the run lands on its own
 * ceiling rather than a tenth above it. What went with the guard is the fourth phase — `holding`
 * existed only to keep an invulnerability up until the road opened, and an ordering that protects
 * nothing is not an ordering.
 *
 * ## Why the gauge does not drain
 *
 * It only ever empties into a Fever. A slow leak punishes the player for *playing* — for a stretch
 * with no fruit on it, which is a stretch the placer chose — and reads as the game taking something
 * back. What fruit collected during a Fever counts toward is the *next* one, which is the only
 * arrangement that does not throw away a pickup the player went and got.
 */
import {
  FEVER_EASE_MS,
  FEVER_FRUIT_TARGET,
  FEVER_MAGNET_Z,
  FEVER_MS,
  FEVER_SETTLE_MS,
  FEVER_SPEED_FACTOR,
} from './constants'

/**
 * Where the run is in the cycle.
 *
 * `easing` is a phase of its own rather than a flag on `active` because the two differ in the one
 * thing that still matters once the guard is gone: `active` is a reward held at a fixed ceiling and
 * `easing` is the ramp down off it, and `feverSpeedFactor` has to tell them apart.
 *
 * **There were four.** `holding` waited, after the ease, until the road ahead was clear enough to
 * drop the invulnerability. With no invulnerability to drop it is a phase nothing branches on, so
 * it is gone rather than left as dead state.
 */
/**
 * The phases, as a list, with the type derived from it.
 *
 * **A list rather than a bare union, because a saved run carries one.** `resolveSuspended` has to
 * ask whether a stored string is a phase, and a union alone cannot be asked at runtime — deriving
 * the type from the list is what stops the two from disagreeing the day a phase is added.
 */
export const FEVER_PHASES = ['idle', 'active', 'easing'] as const

export type FeverPhase = (typeof FEVER_PHASES)[number]

export interface FeverState {
  /** Fruit banked toward the next Fever, `0..FEVER_FRUIT_TARGET`. */
  fruit: number
  phase: FeverPhase
  /** Simulated milliseconds left in the current phase. `0` while idle. */
  msRemaining: number
}

export function createFeverState(): FeverState {
  return { fruit: 0, phase: 'idle', msRemaining: 0 }
}

/** How full the gauge is, `0..1`. What the HUD's fruit bar draws. */
export function feverCharge(state: FeverState): number {
  return Math.min(1, state.fruit / FEVER_FRUIT_TARGET)
}

/**
 * Banks one fruit, and starts a Fever if that filled the gauge.
 *
 * **The gauge is spent on entry rather than on exit**, so fruit taken during a Fever — and the
 * magnet means there is a lot of it — counts toward the next one instead of being discarded.
 */
export function addFruit(state: FeverState): FeverState {
  if (state.phase !== 'idle') return { ...state, fruit: state.fruit + 1 }

  return ignite({ ...state, fruit: state.fruit + 1 })
}

/**
 * Starts a Fever if the gauge is full, and leaves the state alone if it is not.
 *
 * **One rule for "the gauge is full", used by the fruit that fills it and by the end of a Fever.**
 * Two copies would be two places to disagree about what full means, and the second of them was
 * missing entirely — see below.
 *
 * **⚠ A Fever used to end with a full gauge and nothing happening.** Fruit collected during one
 * banks toward the next, and the magnet means there is a lot of it: collect eight or more and the
 * leaf came back reading 1.00 with the run idle, waiting for one further fruit before it would
 * fire. A permanently full gauge is a permanent question, which is the same objection that hid the
 * boost meter when it was empty.
 *
 * **It cannot run away, and that is measured rather than argued.** A Fever plus its landing covers
 * 14.1% of a lap, a lap carries 33.2 fruit, so **4.7 pass under the magnet against a target of 8** —
 * a chain has to be paid for in fruit, and one Fever does not earn the next. What chaining does is
 * spend an overflow the player already collected, immediately, instead of holding it hostage.
 */
export function ignite(state: FeverState): FeverState {
  if (state.fruit < FEVER_FRUIT_TARGET) return state

  return { fruit: state.fruit - FEVER_FRUIT_TARGET, phase: 'active', msRemaining: FEVER_MS }
}

/**
 * Advances by `dtMs` of **simulated** time. Called from inside `stepRun`'s fixed tick.
 *
 * **It returns the state and nothing else.** It used to return two flags beside it — one for the
 * tick the ease began on, so the scene could clear the road ahead of the guard, and one for the
 * tick the guard came off. Neither is a thing any more, and neither had a reader left.
 */
export function stepFever(state: FeverState, dtMs: number): FeverState {
  if (state.phase === 'idle') return state

  const msRemaining = state.msRemaining - dtMs

  if (msRemaining > 0) return { ...state, msRemaining }

  if (state.phase === 'active') {
    // The overrun carries into the ease rather than being dropped, so the two phases together are
    // exactly `FEVER_MS + FEVER_EASE_MS` however the ticks happen to fall.
    return { ...state, phase: 'easing', msRemaining: FEVER_EASE_MS + msRemaining }
  }

  // **Straight into the next one if the gauge filled again on the way.** A Fever that ended on a
  // full gauge used to sit there doing nothing — the leaf came back reading 1.00 with the run idle,
  // waiting for one *further* fruit before it would fire. See `ignite`.
  return ignite({ ...state, phase: 'idle', msRemaining: 0 })
}

/**
 * What the speed ceiling is multiplied by right now.
 *
 * `1` when idle, `FEVER_SPEED_FACTOR` while active, and a straight ramp between them over the ease
 * — a ramp rather than a curve because what it has to guarantee is arriving at exactly `1` at a
 * known moment, and an ease-out spends its last third almost stationary above the ceiling.
 *
 * **The ramp finishes `FEVER_SETTLE_MS` before the ease does.** See that constant: the speed
 * *follows* this number rather than being it, and following a falling ramp leaves a fixed error
 * above it — measured at 3958 u/s against a 3600 ceiling before the settle existed. That error is
 * no longer an unfair death; it is the run meeting rows at a speed the placer never spaced them
 * for, which is worse.
 */
export function feverSpeedFactor(state: FeverState): number {
  if (state.phase === 'idle') return 1
  if (state.phase === 'active') return FEVER_SPEED_FACTOR

  const ramp = Math.max(1, FEVER_EASE_MS - FEVER_SETTLE_MS)
  const t = Math.max(0, Math.min(1, (state.msRemaining - FEVER_SETTLE_MS) / ramp))

  return 1 + (FEVER_SPEED_FACTOR - 1) * t
}

/** Whether pickups are being pulled in. Ends with the guard, so the reward is one continuous thing. */
export function feverMagnet(state: FeverState): boolean {
  return state.phase !== 'idle'
}



/**
 * How hard a pickup `aheadZ` in front is pulled toward the snail's line, `0..1`.
 *
 * Linear in the gap, so something just entering the window barely moves and something about to
 * arrive is already on the line. **The pull moves the pickup, it does not widen the collection
 * box**: a magnet drawn as a bigger invisible box is a pickup that vanishes off to one side, and
 * this way the ordinary `reaches` test still does the collecting and there is one rule for it.
 */
export function magnetPull(aheadZ: number): number {
  if (aheadZ < 0 || aheadZ > FEVER_MAGNET_Z) return 0

  return 1 - aheadZ / FEVER_MAGNET_Z
}
