/**
 * The simulation timestep, shared by everything that steps per frame.
 *
 * This file used to hold the car's handling tuning as well. That model died with the change
 * of genre from racer to rail shooter — `ACCEL`, `BRAKING`, `DECEL`, `OFF_ROAD_DECEL`,
 * `OFF_ROAD_LIMIT`, `CENTRIFUGAL`, `STEER_SPEED` and `MAX_PLAYER_X` are all gone, along with
 * `physics.ts` and `Car.ts`. In a rail shooter the speed is set by the track, not the player,
 * and the ship is not attached to the surface. What remains here is genre-neutral.
 *
 * `phaser`-free — see `fixedStep.ts` and CLAUDE.md "Commands".
 */

/**
 * The simulation tick. Fixed at 60Hz regardless of render rate — see `runFixedSteps` for why
 * nothing may be integrated over a raw frame delta.
 */
export const FIXED_STEP_MS = 1000 / 60

/**
 * Slack on the "has a whole tick accumulated?" comparison, in milliseconds.
 *
 * Summing many small deltas drifts by a few ulps, so a run that should total exactly N ticks
 * can land a fraction of a femtosecond short and silently run N-1. That is not a rounding
 * detail — it is a whole missing tick, and it makes results differ between frame rates, which
 * is the one thing the fixed timestep exists to prevent. 144Hz braking for one second
 * reproduced it exactly.
 */
export const TICK_EPSILON_MS = 1e-9

/**
 * Ceiling on how many ticks one step call may run.
 *
 * A backgrounded tab (which Playables produces constantly) hands back a delta of seconds, and
 * without a cap the catch-up loop would run hundreds of ticks in one frame, lengthening that
 * frame, which grows the next delta — the classic spiral. Beyond the cap the backlog is
 * dropped: simulated time falls behind wall-clock, which nobody can see, whereas a frozen
 * frame is immediately obvious.
 */
export const MAX_SUB_STEPS = 5
