/**
 * The steering feel, as a value that can be changed while a run is going.
 *
 * **Rule: this file never imports `phaser`.** It is loaded directly under plain Node by
 * `scripts/verify-player.mjs`.
 *
 * ## Why this exists at all
 *
 * `PLAYER_STIFFNESS = 60` and `PLAYER_DAMPING = 0.85` are the rail shooter's `SHIP_STIFFNESS` and
 * `SHIP_DAMPING`, carried over unchanged — and `playerMotion.ts` says so plainly: *"that is the
 * entire fork of `shipMotion.ts`, and keeping the constants identical is what preserves the
 * handling the rail shooter spent a chunk measuring."* What it preserved is handling that was
 * measured against a **telegraph**: `SHIP_STIFFNESS` was set so that at least 80% of a 300px dodge
 * is covered inside `TELEGRAPH_MS`, on a craft that flew in screen pixels and never had to *stop*
 * anywhere in particular.
 *
 * A runner asks the opposite question. There is no telegraph; there is a gap in a row, and the
 * snail has to arrive **and stay** in it. Nothing has ever measured these two numbers against that,
 * so they are not tuned for this game — they are inherited, and this module is what makes trying
 * something else cost a keypress instead of a rebuild.
 *
 * ## The three presets, and what separates them
 *
 * They are not three tastes; they are three points solved through `playerResponse()`, which is the
 * same closed form `verify:player` asserts against the real integrator:
 *
 * | preset  |  k  |  d   | zeta  | tau    | lag    |
 * |---------|-----|------|-------|--------|--------|
 * | viscous |  34 | 0.82 | 1.073 | 264 ms | 0.3874 |
 * | current |  60 | 0.85 | 0.655 | 205 ms | 0.1765 |
 * | snappy  | 100 | 0.78 | 0.793 | 134 ms | 0.1692 |
 *
 * `zeta` above 1 never overshoots at all; `tau` is how long the snail takes to close a move; `lag`
 * is how far it trails a finger that is still moving.
 *
 * **⚠ `snappy` beats `current` on all three at once, which is worth reading twice.** It settles
 * faster (134ms against 205), overshoots *less* (0.793 against 0.655) and trails a moving finger
 * less (0.169 against 0.177). The shipped pair is not on the frontier — it is one point on a curve
 * that was drawn for a different game, and there are strictly better ones. That is a claim about
 * arithmetic rather than about feel, which is exactly why the presets exist: the arithmetic cannot
 * say which of the three a player wants.
 *
 * ## The mode is the other half, and it is a separate question
 *
 * The spring decides how the snail follows the *request*. The mode decides how a thumb makes one.
 * Measured over ten runs against the real placer (`scripts/measure-steering.mjs`), those two
 * failures are almost disjoint: relative drag takes a patient player's hits on a portrait phone
 * from 44 to 8 and does nothing at all for a player who over-corrects, while the spring is the
 * only thing that touches the second. Neither preset fixes the other's half.
 */

import { REACHABLE_EDGE } from './constants'

/** How a thumb makes a request. A mouse and the keys are always `absolute`; this is a finger's. */
export type SteerMode =
  /**
   * The finger's column *is* the request — the scheme a touch shipped with until the thumbstick.
   *
   * Its cost is that the thumb has to *land on* a column, so its error is a placement error in
   * **screen pixels**, while the road is a fraction of the frame. That is why the same law measures
   * six times worse on a portrait phone than on a desktop with nothing else changed.
   */
  | 'absolute'
  /**
   * The finger's *movement* is the request, from wherever it was pressed.
   *
   * Its error is a share of the push rather than a number of pixels, so the frame's size drops out
   * of it — and the thumb no longer has to sit on the snail's own column, which is the other half
   * of the report (see `SteerTuning.sensitivity`).
   */
  | 'relative'

export interface SteerTuning {
  /** Spring constant pulling the snail towards the request, in 1/s^2. */
  stiffness: number
  /** Velocity retained per 60Hz tick. Lower is *more* damped. */
  damping: number
  mode: SteerMode
  /**
   * In `relative` mode, how many road half-widths a drag the length of the frame's **short side**
   * asks for — see `dragScale` for why the short side and not the width.
   *
   * Higher crosses the road in a shorter swipe and costs precision; lower the opposite. Ignored in
   * `absolute` mode, where the mapping is the projection's own and there is nothing to choose.
   */
  sensitivity: number
}

export type SteerPresetName = 'viscous' | 'current' | 'snappy'

/**
 * Three points on the spring, solved rather than chosen — see the table above.
 *
 * `current` is the shipped pair exactly, so switching to it is a no-op and the comparison always
 * has its own control in it.
 */
export const STEER_PRESETS: Readonly<Record<SteerPresetName, { stiffness: number; damping: number }>> = {
  viscous: { stiffness: 34, damping: 0.82 },
  current: { stiffness: 60, damping: 0.85 },
  snappy: { stiffness: 100, damping: 0.78 },
}

/**
 * How much of the frame's short side one swipe has to cover to cross the whole drivable road.
 *
 * **⚠ It was a whole frame WIDTH, and a thumb does not swipe a whole frame.** Reported from the
 * phone: one gesture should take the snail from one edge of the road to the other, and a swipe
 * across the screen fell a little short. It could not do anything else — a thumb starts and stops
 * a finger's width in from each edge, so a "full" swipe is 80–90% of the frame and delivered 80–90%
 * of the road. In landscape it was far worse: the frame is twice as wide, so the same thumb travel
 * crossed about a third of the road.
 *
 * 0.65 of the short side is about 250px on a phone in either orientation, so an ordinary swipe
 * crosses the road with a third to spare and a deliberate full swipe saturates at the verge. What it
 * costs is precision, stated: a gap a row leaves (0.18 half-widths at the median) is about 26px of
 * thumb travel on a portrait phone, where it was 40.
 */
export const SWIPE_CROSS_SHARE = 0.65

/**
 * The default relative sensitivity: a swipe of `SWIPE_CROSS_SHARE` of the short side crosses the
 * whole drivable road.
 *
 * Stated from `REACHABLE_EDGE` rather than as a number, so it keeps its meaning if the road, the
 * reach or the mascot ever move — the same discipline `PICKUP_HEIGHT` was corrected to once it
 * stopped being half a body by construction.
 */
export const RELATIVE_SENSITIVITY_DEFAULT = (2 * REACHABLE_EDGE) / SWIPE_CROSS_SHARE

/**
 * Converts a drag measured as a fraction of the frame's width into one measured against its short
 * side, which is what `sensitivity` is stated in.
 *
 * **The short side, because a thumb's reach is a physical length.** The same phone held either way
 * gives the same thumb the same comfortable swipe, and in landscape that swipe is a much smaller
 * share of the width. Measured against the width, turning the phone sideways made the road three
 * times as wide under the thumb.
 */
export function dragScale(width: number, height: number): number {
  return width / Math.max(1, Math.min(width, height))
}

/**
 * What the game ships with.
 *
 * **⚠ `mode` is `relative` now, and it is the FINGER's mode.** It shipped `absolute` with relative
 * behind a DEV key — i.e. behind a keyboard, i.e. never on the one device the measurement was
 * about — and the controls were then reported from a phone as doubtful. A mouse and the keys are
 * absolute whatever this says (`RunScene` reads the mode only for a touch), and on a finger this
 * is the scheme the thumbstick in `platform/joystick.ts` is drawn over.
 */
const SHIPPED: SteerTuning = {
  ...STEER_PRESETS.current,
  mode: 'relative',
  sensitivity: RELATIVE_SENSITIVITY_DEFAULT,
}

let live: SteerTuning = { ...SHIPPED }

/** What the run is steering with right now. */
export function getSteerTuning(): SteerTuning {
  return live
}

/**
 * Changes part of the tuning, leaving the rest alone.
 *
 * One module-level value read by the run, the same shape `ui/theme.ts`'s `setTheme` uses and for
 * the same reason: a tuning threaded through every call site is a tuning that ends up applied in
 * some of them.
 */
export function setSteerTuning(overrides: Partial<SteerTuning>): SteerTuning {
  live = { ...live, ...overrides }

  return live
}

/** Puts the spring back to whatever the game ships with, mode and sensitivity untouched. */
export function resetSteerTuning(): SteerTuning {
  live = { ...live, ...SHIPPED, mode: live.mode, sensitivity: live.sensitivity }

  return live
}

/** Applies one of the three named springs. */
export function applySteerPreset(name: SteerPresetName): SteerTuning {
  return setSteerTuning(STEER_PRESETS[name])
}

/** Which preset the spring currently matches, or `null` if it has been dragged off all three. */
export function steerPresetName(tuning: SteerTuning = live): SteerPresetName | null {
  for (const name of Object.keys(STEER_PRESETS) as SteerPresetName[]) {
    const preset = STEER_PRESETS[name]

    if (Math.abs(preset.stiffness - tuning.stiffness) < 0.5 && Math.abs(preset.damping - tuning.damping) < 0.005) {
      return name
    }
  }

  return null
}

/**
 * Where a relative drag has asked the snail to be, given where it was asked to be last frame.
 *
 * **The anchor is the previous *request*, not the snail's current position.** Anchoring to the
 * snail would feed the spring's own lag straight back into the request — a drag would ask for less
 * than it moved, by exactly the amount the snail was behind, and the control would quietly get
 * heavier the faster the player pushed. Integrating the request keeps the two apart: the thumb
 * moves a request, the spring chases it, and neither is a function of the other.
 *
 * Pure and clamped by the caller, so `verify:player` can hold it to those two properties without a
 * scene.
 */
export function relativeTarget(previousTarget: number, deltaFraction: number, sensitivity: number): number {
  return previousTarget + deltaFraction * sensitivity
}
