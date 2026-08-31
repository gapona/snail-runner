/**
 * What happens between the last shield going and the result screen arriving.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:player`.
 *
 * **⚠ Nothing happened at all before this.** The shot that took the last shield called `finishRun`
 * on the same frame: the result panel appeared over a ship that was still flying, still banking,
 * still trailing its plume. Every *enemy* in the game comes apart when it dies — freeze, swell,
 * fade, debris, the splitter's own parting — and the one death the player actually cares about was
 * the only one the game did not draw. Reported by a player as the obvious missing thing it is.
 *
 * **⚠ AND THEN THE FORK SHIPPED THE SAME DEFECT, BY KEEPING THIS FILE AND NEVER CALLING IT.** The
 * runner's third hit went straight from `takeHit` to `scene.pause()` and the result panel — so the
 * snail was mid-stride, the road was still scrolling, and the panel arrived over a frame in which
 * nothing had happened. Reported the same way the rail shooter's was: the crash needs to be *seen*
 * before the score for it is. This module was already written and already right; what was missing
 * was three guards in the scene's update and the curves below.
 *
 * The state is here rather than in the scene because it answers three questions the scene keeps
 * getting wrong on its own: is the player still flying (no), may another shot take a shield (no,
 * and a second one must not restart the death or end the run twice), and has the wreck finished
 * (only then does the run end).
 */

/** How long the wreck plays before the result screen replaces it. */
export const PLAYER_DEATH_MS = 1000

/**
 * How long the hull itself is drawn coming apart, of that.
 *
 * Shorter than the whole: the hull bursts, and what fills the rest of the window is the debris and
 * the flash it threw. A hull that faded for the entire second would be a slow puncture rather than
 * a kill.
 */
export const HULL_BURST_MS = 260

export interface PlayerDeath {
  /**
   * When the killing hit landed, or `NOT_DEAD` while the player is alive.
   *
   * **`-1` rather than `0`, and the check that caught it starts its clock at zero.** A scene's
   * first frame can report `now === 0` — this project's own stepping harness does exactly that —
   * and a sentinel of `0` would make "died on the first frame" indistinguishable from "alive", so
   * the wreck would never play and the run would never end. Same value, and the same reason, as
   * `FxSprites.lastLaunchCheck`.
   */
  startedAt: number
}

/** The sentinel for a living player. Read through `hasDied` rather than compared at call sites. */
export const NOT_DEAD = -1

export function createPlayerDeath(): PlayerDeath {
  return { startedAt: NOT_DEAD }
}

/** Whether the killing hit has landed at all. The scene asks this, never the raw field. */
export function hasDied(state: PlayerDeath): boolean {
  return state.startedAt >= 0
}

/**
 * Starts the wreck. Returns whether this call is the one that started it.
 *
 * **A second hit inside the window is ignored rather than restarting it.** Two enemies firing at
 * the same moment is ordinary, and the second shot must not stretch the death, replay the burst, or
 * — the one that matters — end the run twice, since `finishRun` writes the save and offers the
 * rewarded continue.
 */
export function startPlayerDeath(state: PlayerDeath, now: number): boolean {
  if (hasDied(state)) return false

  state.startedAt = now

  return true
}

/** Whether the wreck is playing: the player is not flying and cannot be hit again. */
export function isDying(state: PlayerDeath, now: number): boolean {
  return hasDied(state) && now < state.startedAt + PLAYER_DEATH_MS
}

/** Whether the wreck has finished and the run may now end. `false` for a player still alive. */
export function deathComplete(state: PlayerDeath, now: number): boolean {
  return hasDied(state) && now >= state.startedAt + PLAYER_DEATH_MS
}

/**
 * How far through the hull's own burst, `0..1`, or `1` once it is over.
 *
 * The hull swells and fades on this, which is the same shape an enemy's death uses — the player's
 * craft coming apart the way everything else in the game does is the point, not a separate idiom.
 */
export function hullBurstProgress(state: PlayerDeath, now: number): number {
  if (!hasDied(state)) return 0

  return Math.min(1, Math.max(0, (now - state.startedAt) / HULL_BURST_MS))
}

/**
 * How far the wreck swells, and how far it turns.
 *
 * **The same shape every other death in this family uses** — swell, fade, come apart — because the
 * player's own craft dying the way everything else dies is the point rather than a separate idiom.
 * The turn is progress-driven rather than a fixed angular velocity, for the reason `spinAngle` is:
 * `progress` reaches exactly 1 at the end of the window by definition, so the wreck cannot be left
 * part-way through a rotation by a frame rate nobody tested.
 */
export const DEATH_SWELL = 1.5
export const DEATH_SPIN_DEGREES = 210

/**
 * How long the frame flashes for, of `PLAYER_DEATH_MS`.
 *
 * **Well under the whole window, and that is a requirement rather than taste**: the flash has to be
 * gone before the result panel arrives, or the panel is read through a coloured frame nobody asked
 * for. `verify:player` asserts the two against each other.
 */
export const DEATH_FLASH_MS = 320

/**
 * How much bigger the hull is drawn, `1..DEATH_SWELL`.
 *
 * Eased *out*: most of the swell is spent in the first third, so it reads as a burst rather than as
 * something inflating. The mirror curve looks almost right and reads as a wreck that has stopped
 * moving before it has finished, which is the same argument the telegraph ring's own easing lost.
 */
export function hullSwell(progress: number): number {
  const t = Math.min(1, Math.max(0, progress))

  return 1 + (DEATH_SWELL - 1) * (1 - (1 - t) * (1 - t))
}

/**
 * How solid the hull still is, `1..0`.
 *
 * Eased *in*, the opposite way from the swell: the snail holds for a beat and then goes. A linear
 * fade starts vanishing on the frame of impact, which is the one frame the player is looking at it
 * to find out what just happened.
 */
export function hullFade(progress: number): number {
  const t = Math.min(1, Math.max(0, progress))

  return 1 - t * t
}

/** How far the wreck has turned, in degrees. */
export function deathSpin(progress: number): number {
  return DEATH_SPIN_DEGREES * Math.min(1, Math.max(0, progress))
}

/**
 * How strong the frame's flash is right now, `1..0`.
 *
 * Loudest on the frame of impact and gone inside `DEATH_FLASH_MS`. Driven from the death's own
 * clock rather than from a tween, so it cannot outlive the wreck or survive a scene restart.
 */
export function deathFlash(state: PlayerDeath, now: number): number {
  if (!hasDied(state)) return 0

  return Math.min(1, Math.max(0, 1 - (now - state.startedAt) / DEATH_FLASH_MS))
}
