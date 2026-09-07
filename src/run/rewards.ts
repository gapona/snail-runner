import { biomeIndexForSegment, biomeRunSegments } from '../road/biomes'
import { SEGMENT_LENGTH } from '../road/constants'

/**
 * Where a reward is announced, and what marks the next milestone.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:scoring`.
 *
 * ## ⚠ The reward was announced where nobody was looking
 *
 * Coins landed as a number in the corner and a close pass as nothing at all, both at the bottom of
 * the frame beside the mascot. The player is not looking there: they are looking **up the road**,
 * at the strip just under the horizon, because that is where the next thing to decide about
 * appears. An announcement outside that strip is an announcement that arrives after the fact, if at
 * all — which for a mechanic whose whole job is to say *that was worth doing* is the same as not
 * having one.
 *
 * ## ⚠ And one plaque, never a queue of them
 *
 * A streak on a dense stretch fires several times a second. Spawning a plaque per reward fills the
 * middle of the screen with text at exactly the moment the player most needs to see the road
 * through it — so a reward arriving while one is already up **updates that one**: the points add,
 * the multiplier climbs, and its life restarts. What the player reads is one number growing, which
 * is also a truer picture of a streak than six numbers stacking.
 */

/** Where the plaque sits, as a fraction of the frame. Centred, in the upper third. */
export const PLAQUE_ROW = 0.22

/**
 * How long a plaque stays up after its last update, and how long it takes to fade.
 *
 * Long enough to be read at a glance and short enough that a quiet stretch clears it: the strip it
 * sits in is the one obstacles are read out of, so it may not be the resting state of the frame.
 */
export const PLAQUE_LIFE_MS = 900
export const PLAQUE_FADE_MS = 260

/**
 * How long after a reward another one still counts as the same announcement.
 *
 * **Deliberately longer than the plaque's own life is short.** Anything inside this window merges;
 * past it the plaque has already begun to fade and a new reward reads as a new event, which is what
 * a gap in a streak should look like. It is a *duration* rather than a distance — unlike every
 * window in the run — because what it bounds is how fast the eye can take in a changing number,
 * and that does not go faster when the road does.
 */
export const PLAQUE_MERGE_MS = 700

export interface Plaque {
  /** Total points announced, which is what the number on it reads. */
  points: number
  /** How many rewards have been folded into this announcement. */
  count: number
  /**
   * The streak multiplier to show, which is **not** the same as `count`.
   *
   * **⚠ The plaque first showed the merge count and it was the wrong number.** Merges only happen
   * when two rewards land inside `PLAQUE_MERGE_MS` of each other, and measured on a real road close
   * passes come about 9000 world units — two and a half seconds — apart, so almost every plaque was
   * a lone `x1` and the multiplier never appeared. What survives a gap is the *streak*, which is
   * also the number the player is playing for.
   */
  multiplier: number
  /** The dearest rung any of them landed on, so the plaque's weight matches the loudest sound. */
  tier: number
  /** When it last changed, which is what its life is measured from. */
  updatedAt: number
  /** When the current announcement began, so a merge can punch without restarting the entry. */
  bornAt: number
}

export function createPlaque(): Plaque {
  return { points: 0, count: 0, multiplier: 1, tier: 0, updatedAt: -Infinity, bornAt: -Infinity }
}

/**
 * Folds a reward into the plaque, starting a new announcement if the last one has gone stale.
 *
 * Returns the plaque and whether this was a *new* announcement rather than a merge — the caller
 * uses that to decide between an entry animation and a punch.
 */
export function announce(
  plaque: Plaque,
  points: number,
  tier: number,
  multiplier: number,
  now: number,
): { plaque: Plaque; fresh: boolean } {
  const fresh = now - plaque.updatedAt > PLAQUE_MERGE_MS

  if (fresh) {
    return { plaque: { points, count: 1, multiplier, tier, updatedAt: now, bornAt: now }, fresh: true }
  }

  return {
    plaque: {
      points: plaque.points + points,
      count: plaque.count + 1,
      // The live multiplier, not the highest seen: it is what the *next* pass will be worth, and a
      // plaque holding a stale one would be advertising a streak the run no longer has.
      multiplier,
      // The dearest rung, not the latest: a plaque that dropped back to a squeeze's weight after a
      // ramp would report the streak as having got cheaper when it has only got longer.
      tier: Math.max(plaque.tier, tier),
      updatedAt: now,
      bornAt: plaque.bornAt,
    },
    fresh: false,
  }
}

/** How hard the plaque is drawn, `0..1`: full while it lives, then out over the fade. */
export function plaqueAlpha(plaque: Plaque, now: number): number {
  if (plaque.count === 0) return 0

  const age = now - plaque.updatedAt

  if (age <= PLAQUE_LIFE_MS) return 1
  if (age >= PLAQUE_LIFE_MS + PLAQUE_FADE_MS) return 0

  return 1 - (age - PLAQUE_LIFE_MS) / PLAQUE_FADE_MS
}

/**
 * The punch a merge gives the plaque, `0..1`, decaying over `PLAQUE_PUNCH_MS`.
 *
 * What says *another one* when the plaque is already up and the number is the only thing changing.
 * A number that merely increments is a number nobody notices changing.
 */
export const PLAQUE_PUNCH_MS = 180

export function plaquePunch(plaque: Plaque, now: number): number {
  const t = (now - plaque.updatedAt) / PLAQUE_PUNCH_MS

  return t < 0 || t >= 1 ? 0 : 1 - t
}

/**
 * How long one milestone stretch is, in world units.
 *
 * **⚠ A milestone IS a biome change, not a counter that happens to line up with one.** Two
 * independent ladders would drift the moment either the lap length or the biome count moved, and
 * the player would then be told they had reached something at a place where the world did not
 * change — which is worse than no milestone, because the world changing is the reward. So the
 * length is the biome stretch's own, derived from the same function the renderer picks colours by.
 */
export function milestoneLength(trackSegments: number): number {
  return biomeRunSegments(trackSegments) * SEGMENT_LENGTH
}

/**
 * How far through the current stretch the run is, `0..1`.
 *
 * Taken from the **wrapped** segment index rather than from the unwrapped odometer, because that is
 * what decides the biome: a lap that does not divide evenly by the biome count leaves a short last
 * stretch, and a progress bar computed from distance would run past 1 across it and reset early.
 */
export function milestoneProgress(z: number, trackSegments: number): number {
  const length = milestoneLength(trackSegments)

  if (!(length > 0) || !(trackSegments > 0)) return 0

  const wrapped = ((z % (trackSegments * SEGMENT_LENGTH)) + trackSegments * SEGMENT_LENGTH) % (trackSegments * SEGMENT_LENGTH)

  return Math.min(1, (wrapped % length) / length)
}

/**
 * Whether the run crossed into a new biome between two positions.
 *
 * The biome index is what is compared, never the distance — see `milestoneLength`. That also makes
 * the lap seam behave: the last short stretch of a lap wraps onto biome 0, which `biomeIndexForSegment`
 * already handles, so the milestone fires there exactly once like everywhere else.
 */
export function milestoneCrossed(previousZ: number, z: number, trackSegments: number): boolean {
  if (!(trackSegments > 0)) return false

  const before = biomeIndexForSegment(Math.floor(previousZ / SEGMENT_LENGTH), trackSegments)
  const after = biomeIndexForSegment(Math.floor(z / SEGMENT_LENGTH), trackSegments)

  return before !== after
}

/**
 * What reaching a milestone is worth, in coins.
 *
 * **Coins rather than points**, because a milestone is not a decision — it is arrived at by
 * playing, and the points ladder is reserved for things the player chose. Paying it in the currency
 * that survives the run is what makes a long run worth more than a short one without the score
 * having to say so twice.
 */
export const MILESTONE_COINS = 5

/** How long the milestone flash lasts. Short: it marks a boundary, it does not celebrate one. */
export const MILESTONE_FLASH_MS = 420

export function milestoneFlash(startedAt: number, now: number): number {
  if (startedAt < 0) return 0

  const t = (now - startedAt) / MILESTONE_FLASH_MS

  if (t < 0 || t >= 1) return 0

  // Front-loaded, like every other flash in this game: what it says is *now*.
  return (1 - t) * (1 - t)
}
