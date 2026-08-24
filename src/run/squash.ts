/**
 * Squash and stretch for the snail: one number, driven by the jump.
 *
 * **Rule: this file never imports `phaser`** — it is arithmetic, and `verify:jump` loads it.
 *
 * **A snail is the cheapest possible mascot to animate, and this is why.** A runner with legs
 * needs a walk cycle, a run cycle, a launch pose, an airborne pose and a landing pose, and every
 * one of them is art. A snail has no legs and no gait: it glides, and everything it does to
 * express effort is a deformation of one blob. So the whole animation system is a scalar —
 * `> 1` taller and narrower, `< 1` flatter and wider — applied to a single sprite, and the six
 * frames of a slide cycle that chunk 7 adds sit *underneath* it rather than replacing it.
 *
 * The deformation is volume-preserving (`width / s`, `height * s`) because the alternative reads
 * as the sprite being scaled rather than as the creature being compressed.
 */

/** How far the snail stretches at launch, and how long that stretch takes to relax. */
export const LAUNCH_STRETCH = 1.18
export const LAUNCH_MS = 140

/** How far it squashes on landing, and how long the recovery takes. */
export const LANDING_SQUASH = 0.72
export const LANDING_MS = 190

/**
 * How much the *airborne* stretch follows vertical speed, per unit of `JUMP_LAUNCH_V`.
 *
 * Small, and it points the same way at the top and the bottom of the arc: what it is expressing is
 * "moving fast vertically", not "going up". A stretch that inverted at the apex would read as the
 * snail flipping over.
 */
export const FLIGHT_STRETCH = 0.1

export interface SquashState {
  /** When the current impulse started, in scene time. `-1` for none. */
  startedAt: number
  /** What the impulse deforms towards: `LAUNCH_STRETCH` or `LANDING_SQUASH`. */
  peak: number
  /** How long it takes to relax back to 1. */
  durationMs: number
}

export function createSquashState(): SquashState {
  return { startedAt: -1, peak: 1, durationMs: 1 }
}

/** Starts the launch impulse. */
export function squashOnLaunch(state: SquashState, now: number): void {
  state.startedAt = now
  state.peak = LAUNCH_STRETCH
  state.durationMs = LAUNCH_MS
}

/** Starts the landing impulse. Overrides an unfinished launch — the newer event is the true one. */
export function squashOnLanding(state: SquashState, now: number): void {
  state.startedAt = now
  state.peak = LANDING_SQUASH
  state.durationMs = LANDING_MS
}

/**
 * The deformation to draw with, right now.
 *
 * The impulse decays as `(1 - t)^2` rather than linearly: a linear relax reads as the sprite being
 * *animated* back to shape, where a curve that leaves fast and arrives slowly reads as elasticity.
 * The flight term rides on top of it, so a snail launched and immediately rising is stretched by
 * both without either being special-cased.
 */
export function squashAt(state: SquashState, now: number, verticalSpeedFraction: number): number {
  const flight = 1 + FLIGHT_STRETCH * Math.min(1, Math.abs(verticalSpeedFraction))

  if (state.startedAt < 0) return flight

  const t = (now - state.startedAt) / state.durationMs

  if (t >= 1 || !(t >= 0)) return flight

  const remaining = (1 - t) * (1 - t)

  return flight * (1 + (state.peak - 1) * remaining)
}
