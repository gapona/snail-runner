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
 * ## ⚠ The exit is the whole difficulty, and it is an ordering
 *
 * Leaving Fever at Fever speed is a guaranteed death: the player has been flying through obstacles
 * for six seconds, the guard comes off, and the next row arrives sooner than they can answer it.
 * The best moment of the run would end in a hit the player cannot explain, and they would blame the
 * game — correctly. The three steps are therefore ordered and none of them is optional:
 *
 * 1. **the speed comes back first**, over `FEVER_EASE_MS`, while the guard is still up;
 * 2. **only then does the guard come off** — `feverInvulnerable` covers `active` *and* `easing`;
 * 3. **and the road ahead is already clear** for `REACTION_MS` past that, because the scene clears
 *    it at the moment the ease begins (see `feverClearanceUnits`).
 *
 * Step 3 is a *removal*, not a suppression: obstacles inside the window are cleared off the road
 * while the player is still visibly in Fever, rather than being drawn and then declining to hurt
 * anyone. A hazard that passes through the snail without doing anything is the same defect as one
 * that hits from further away than it looks, read from the other side.
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
  FEVER_CLEAR_MARGIN,
  FEVER_HOLD_MAX_MS,
  FEVER_MS,
  FEVER_SETTLE_MS,
  FEVER_SPEED_FACTOR,
  REACTION_MS,
} from './constants'

/**
 * Where the run is in the cycle.
 *
 * `easing` is a phase of its own rather than a flag on `active` because the two differ in the one
 * thing that matters: `active` is a reward and `easing` is a landing, and the guard has to outlive
 * both. Collapsing them would make "how much Fever is left" and "am I safe" the same number, which
 * is the bug this file is mostly about.
 */
export type FeverPhase = 'idle' | 'active' | 'easing' | 'holding'

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

export interface FeverStep {
  state: FeverState
  /** True on the tick `active` handed over to `easing` — when the scene clears the road ahead. */
  easingStarted: boolean
  /** True on the tick the guard came off. */
  ended: boolean
}

/** Advances by `dtMs` of **simulated** time. Called from inside `stepRun`'s fixed tick. */
export function stepFever(state: FeverState, dtMs: number, roadClear = true): FeverStep {
  if (state.phase === 'idle') return { state, easingStarted: false, ended: false }

  const msRemaining = state.msRemaining - dtMs

  // **The hold ends on the road, not on the clock** — that is the whole of step 2. The clock is
  // only a ceiling, so a run that somehow never finds a gap still leaves Fever.
  if (state.phase === 'holding') {
    if (roadClear || msRemaining <= 0) {
      // Straight into the next one if the gauge filled again on the way — see `ignite`.
      const next = ignite({ ...state, phase: 'idle', msRemaining: 0 })

      return { state: next, easingStarted: false, ended: next.phase === 'idle' }
    }

    return { state: { ...state, msRemaining }, easingStarted: false, ended: false }
  }

  if (msRemaining > 0) return { state: { ...state, msRemaining }, easingStarted: false, ended: false }

  if (state.phase === 'active') {
    // The overrun carries into the ease rather than being dropped, so the two phases together are
    // exactly `FEVER_MS + FEVER_EASE_MS` however the ticks happen to fall.
    return {
      state: { ...state, phase: 'easing', msRemaining: FEVER_EASE_MS + msRemaining },
      easingStarted: true,
      ended: false,
    }
  }

  return {
    state: { ...state, phase: 'holding', msRemaining: FEVER_HOLD_MAX_MS },
    easingStarted: false,
    ended: false,
  }
}

/**
 * Whether the road ahead is clear enough to drop the guard, given the nearest obstacle.
 *
 * `REACTION_MS` at the *current* speed, which is the ordinary ceiling by the time the hold begins —
 * the ease has already brought the run back. `Infinity` for an empty road.
 */
export function roadIsClear(nearestAheadUnits: number, speed: number): boolean {
  return nearestAheadUnits >= (speed * REACTION_MS * FEVER_CLEAR_MARGIN) / 1000
}

/**
 * What the speed ceiling is multiplied by right now.
 *
 * `1` when idle, `FEVER_SPEED_FACTOR` while active, and a straight ramp between them over the ease
 * — a ramp rather than a curve because what it has to guarantee is arriving at exactly `1` at a
 * known moment, and an ease-out spends its last third almost stationary above the ceiling.
 *
 * **The ramp finishes `FEVER_SETTLE_MS` before the ease does**, and the guard is up for all of it.
 * See that constant: the speed *follows* this number rather than being it, and following a falling
 * ramp leaves a fixed error above it.
 */
export function feverSpeedFactor(state: FeverState): number {
  if (state.phase === 'idle' || state.phase === 'holding') return 1
  if (state.phase === 'active') return FEVER_SPEED_FACTOR

  const ramp = Math.max(1, FEVER_EASE_MS - FEVER_SETTLE_MS)
  const t = Math.max(0, Math.min(1, (state.msRemaining - FEVER_SETTLE_MS) / ramp))

  return 1 + (FEVER_SPEED_FACTOR - 1) * t
}

/** Whether the guard is up. **Covers the ease as well as the Fever** — that is step 2 above. */
export function feverInvulnerable(state: FeverState): boolean {
  return state.phase !== 'idle'
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
