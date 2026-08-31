/**
 * The mascot glancing back over its shell.
 *
 * **Rule: this file never imports `phaser`** — it is a clock and a curve, covered by
 * `npm run verify:player`.
 *
 * ## Why the mascot needs one at all
 *
 * The shipped render is a **rear view**: shell to the camera, head and both stalks going away. That
 * pick was correct and is written up at length — the model kept drifting to profile, and a profile
 * is a creature travelling across the screen while the road travels into it. What it costs is that
 * the player spends a whole run looking at concentric rings on a shell, and concentric rings read
 * as a **target**, not as an animal. There is no face to put on the frame because there is no face
 * in the art.
 *
 * A glance is the cheapest thing that fixes that, and it needs no new art: for half a second the
 * creature turns, which is a motion no target makes.
 *
 * ## It fires on a clock AND on events, and the events are the half that matters
 *
 * A purely periodic glance is a tic — the eye finds the period in three repetitions and it stops
 * meaning anything, the same failure `SUN_ANIM`'s single sine had. What makes it read as an animal
 * is that it *also* happens when something has just occurred: fruit taken, a Fever entered, a ramp
 * landed. Those are the three moments the player is already looking at the mascot, so the glance
 * lands where it is seen, and the periodic one only has to cover the gaps.
 *
 * An event glance **restarts the timer**, so the two cannot stack into a stutter and a busy stretch
 * does not produce a snail whose head is permanently over its shoulder.
 */

/**
 * The shape of the movement.
 *
 * `minGapMs`/`maxGapMs` are the idle window the brief asks for. The duration is short on purpose:
 * this is a glance, and anything long enough to read as *holding* a look is a creature that has
 * stopped watching the road — which is the one thing the player is doing through it.
 */
export const LOOK_BACK = {
  durationMs: 500,
  minGapMs: 6000,
  maxGapMs: 10000,
  /**
   * How far the shell turns, in degrees.
   *
   * Small, because the sprite is a rear view and rotating it far enough to be unambiguous would
   * put the mascot visibly on its side — the same rotated-drawn-box problem the ramp's spin caused,
   * and `bodyBand` is what pays for that one. Under this angle the drawn box's own extent moves by
   * under a pixel at the size the mascot is drawn, so nothing has to be re-proved.
   */
  turnDegrees: 13,
  /** How much of the width the turn pinches away, so the shell reads as rotating rather than tilting. */
  pinch: 0.12,
} as const

export interface LookBackState {
  /** When the current glance began, or `-1` for "not glancing". */
  startedAt: number
  /** When the next idle glance is due. */
  nextAt: number
}

/**
 * **`-1` rather than `0` for "not glancing", and it is the same sentinel `startPlayerDeath` uses.**
 * A scene's first frame can report `now === 0` — this project's stepping harness does exactly that
 * — so a `0` sentinel makes "glanced on the first frame" indistinguishable from "idle".
 */
export function createLookBack(now: number, random: () => number): LookBackState {
  return { startedAt: -1, nextAt: now + gap(random) }
}

function gap(random: () => number): number {
  return LOOK_BACK.minGapMs + random() * (LOOK_BACK.maxGapMs - LOOK_BACK.minGapMs)
}

/** Starts a glance now, whatever the clock was going to do. Used by the three events. */
export function glanceBack(state: LookBackState, now: number, random: () => number): LookBackState {
  // Already glancing: left alone rather than restarted. Two pickups half a second apart would
  // otherwise reset the curve mid-turn, which reads as a stutter rather than as a second glance.
  if (state.startedAt >= 0 && now - state.startedAt < LOOK_BACK.durationMs) return state

  return { startedAt: now, nextAt: now + LOOK_BACK.durationMs + gap(random) }
}

/** Advances the clock, starting an idle glance when one is due. */
export function stepLookBack(state: LookBackState, now: number, random: () => number): LookBackState {
  if (state.startedAt >= 0 && now - state.startedAt >= LOOK_BACK.durationMs) {
    return { startedAt: -1, nextAt: state.nextAt }
  }

  if (state.startedAt < 0 && now >= state.nextAt) return glanceBack(state, now, random)

  return state
}

/**
 * How far through the turn the mascot is, `0` at rest and `1` at the extreme.
 *
 * A half-sine over the whole window, so the head goes and comes back with no step at either end and
 * no hold in the middle. A linear ramp shows its corners; an ease that lingered at the top would be
 * the creature *holding* a look, which is what the duration is short to avoid.
 */
export function lookBackTurn(state: LookBackState, now: number): number {
  if (state.startedAt < 0) return 0

  const elapsed = now - state.startedAt

  if (elapsed <= 0 || elapsed >= LOOK_BACK.durationMs) return 0

  return Math.sin((elapsed / LOOK_BACK.durationMs) * Math.PI)
}
