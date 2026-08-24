/**
 * Hitstop: the brief freeze that makes a hit land instead of merely registering.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:effects`.
 *
 * **Per entity, never globally.** Not `timeScale`, not `physics.world.pause()`: a volley can
 * strike eight targets in half a second, and eight global stops in a row is not impact, it is
 * a slideshow — and it freezes the ship the player is trying to fly at the same time. Each
 * entity carries its own `frozenUntil` and the ones nobody hit keep moving.
 *
 * **The deadline contract.** Anything that both freezes and holds a timestamp must shift that
 * timestamp by the frozen duration, or it will act early: an enemy caught mid-wind-up would
 * fire before it finished showing the wind-up, which is exactly the unfairness `TELEGRAPH_MS`
 * exists to prevent. `addFreeze` returns the amount added precisely so the caller can do that
 * — see `freezeEnemy`.
 *
 * The shift is applied **when the freeze starts**, not when it ends. The plan called for an
 * `onThaw(frozenMs)`, and this is the same arithmetic moved to the one moment it cannot be
 * missed: a frozen entity is skipped by its own step function, so at the instant it thaws
 * there is nobody running its code to notice. Detecting the thaw edge from outside is a bug
 * waiting to be written; adding the time up front is not.
 */

/** Anything that can be held still for a moment. */
export interface Freezable {
  /** Timestamp until which this entity does not advance. `0` means never frozen. */
  frozenUntil: number
}

export function isFrozen(entity: Freezable, now: number): boolean {
  return now < entity.frozenUntil
}

/**
 * Adds `durationMs` of frozen time and returns how much was actually added.
 *
 * Composes: a second hit landing mid-freeze extends the freeze by another full duration rather
 * than restarting it or being swallowed, so two hits always cost two hitstops' worth of time.
 * The caller shifts its own deadlines by the returned amount.
 */
export function addFreeze(entity: Freezable, now: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0

  entity.frozenUntil = Math.max(entity.frozenUntil, now) + durationMs

  return durationMs
}

/** How much longer this entity stays frozen, in milliseconds. `0` if it is running. */
export function remainingFreeze(entity: Freezable, now: number): number {
  return Math.max(0, entity.frozenUntil - now)
}
