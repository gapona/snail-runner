/**
 * The menu's zones, as fractions of viewport height.
 *
 * **Rule: this file never imports `phaser`** — it is loaded under plain Node by the layout checks.
 *
 * The menu does not invent a composition. It lays itself out against the same constants the play
 * scene does, so that **no element of it occupies a row that means something during a run** — and
 * the payoff is the transition: nothing has to fade, slide or dim, because the interface leaves
 * rows that are meant to be empty and the world underneath never moved.
 *
 * ```
 * 0.00 ────────────────────────  top
 *        the HUD's own rows in a run. In the menu: the two icon buttons, in the
 *        corner, which is the one thing small enough to share them.
 * 0.13 ────────────────────────  TITLE_TOP
 *        TITLE. Clear sky, and the emptiest part of the frame in a run.
 * 0.36 ────────────────────────  BAND_TOP
 *        the rows an approaching obstacle is read in, and where the MASCOT stands.
 * 0.62 ────────────────────────  HORIZON — the vanishing point. Nothing may go here.
 * 0.80 ────────────────────────  BUTTONS_TOP
 *        BUTTONS. The near ground, which a run deliberately leaves empty.
 * 0.96 ────────────────────────  SAFE_BOTTOM
 * ```
 *
 * **⚠ Nothing goes on the vanishing point, and that is why the title is at the top rather than
 * the middle.** Every line in the frame converges at `HORIZON_Y` — the road's edges, the rumble
 * stripes, the centre marking, the verge — so a block of text there is read against more edges
 * than anywhere else on screen. The empty upper band is the opposite: the only thing crossing it
 * is sky.
 */

/**
 * The rows an approaching obstacle occupies, as fractions of viewport height.
 *
 * **Inherited from the rail shooter's `ENEMY_BAND_TOP`/`ENEMY_BAND_BOTTOM`, numbers unchanged.**
 * There they were a *reservation*, derived so a flier's base always landed inside them; here they
 * are a measurement of the same rows, which the road's own projection produces for free: an
 * obstacle first becomes readable a little under the horizon (`HORIZON_Y = 0.62`) and grows down
 * the frame from there. The menu's rule — nothing of the interface may sit where a run puts
 * something the player has to read — is the same rule, so the band keeps its job and loses its
 * derivation.
 *
 * Local constants rather than an import from `run/constants.ts`, so this file stays a pure
 * statement about the *frame* and never has to grow a dependency on the simulation.
 */
const OBSTACLE_BAND_TOP = 0.36
const OBSTACLE_BAND_BOTTOM = 0.62

export const MENU_ZONES = {
  /**
   * The rows a run's HUD claims. Only the corner icons may enter them.
   *
   * **⚠ The title used to start here and it was moved down.** The HUD's score, distance and lives
   * run down the top-left corner and its gauge down the top-right; a wordmark starting at 0.20 was
   * clear of them by the width of the frame, not by height, and that only held while the title was
   * short. 0.13 is under the score block at every supported viewport, measured.
   */
  HUD_BOTTOM: 0.13,
  /** The title band. Deliberately the largest zone: it is the only empty part of a run's frame. */
  TITLE_TOP: 0.13,
  TITLE_BOTTOM: OBSTACLE_BAND_TOP,
  /** Reserved for approaching obstacles, in the menu exactly as in a run. The mascot stands here. */
  BAND_TOP: OBSTACLE_BAND_TOP,
  BAND_BOTTOM: OBSTACLE_BAND_BOTTOM,
  /** The button band: the near ground, which a run leaves empty by design. */
  BUTTONS_TOP: 0.80,
  SAFE_BOTTOM: 0.96,
} as const

/**
 * The entry cascade, in milliseconds, and it is a budget rather than a taste.
 *
 * **Everything is on screen inside `budgetMs`**, because a menu that makes the player wait to press
 * the one button it exists for has spent its whole budget on itself. It lives here rather than in
 * the scene so that a check can hold it: `verify:menu` adds every delay to its own duration and
 * fails if any of them lands past the budget, which is the one property nobody can eyeball.
 *
 * **The cascade only moves ALPHA.** Play is bound and hit-testable from the first frame — an entry
 * that animated position or interactivity would make the budget a lie even while the numbers here
 * stayed inside it.
 */
export const MENU_ENTRY = {
  budgetMs: 400,
  title: { delay: 0, duration: 260 },
  play: { delay: 90, duration: 240 },
  corner: { delay: 160, duration: 200 },
} as const

import { SUN, sunCenterX, sunSize } from '../road/constants'

/** One band of the frame in pixels, with the row a block centred in it would sit on. */
export interface Band {
  top: number
  bottom: number
  centre: number
  height: number
}

function band(height: number, top: number, bottom: number): Band {
  const t = height * top
  const b = height * bottom

  return { top: t, bottom: b, centre: (t + b) / 2, height: b - t }
}

/** The title band in pixels, for a viewport of `height`. */
export function titleBand(height: number): Band {
  return band(height, MENU_ZONES.TITLE_TOP, MENU_ZONES.TITLE_BOTTOM)
}

/**
 * The row a title block of `blockHeight` should be centred on, given the sun is in the same band.
 *
 * **⚠ The sun was drawn through the wordmark on a portrait phone, and it was reported from an
 * iPhone SE.** `SUN.y` is 0.2 and `SUN.size` 0.3 of the frame's height, so the sun occupies
 * 0.05..0.35 of it — which is very nearly the whole of the title band (0.13..0.36). On a landscape
 * frame the two never meet, because the title is left-aligned and the sun sits at 0.76 of the
 * width; on a narrow one the title is scaled to 88% of the width and runs straight under it.
 *
 * Two things had to move and only together are they enough. `sunSize` now bounds the sun by the
 * frame's *width*, which is the real defect — an object sized off the height is half the width of a
 * portrait phone — and this pushes the title **down** to sit under whatever is left.
 *
 * **The push is conditional on the two actually overlapping horizontally**, or a desktop title
 * would be shoved to the bottom of its band to avoid a sun it is nowhere near. And it is clamped
 * inside the band: the band is what keeps the wordmark off the vanishing point and out of the HUD's
 * rows, and no amount of sun is worth leaving it.
 */
export function titleRow(
  width: number,
  height: number,
  title: { left: number; width: number; height: number },
): number {
  const band = titleBand(height)
  const centred = band.centre
  const half = title.height / 2
  const lowest = Math.max(band.top + half, band.bottom - half)

  const sunHalf = sunSize(width, height) / 2
  const sunLeft = sunCenterX(width, height) - sunHalf
  const sunRight = sunCenterX(width, height) + sunHalf
  const sunBottom = height * SUN.y + sunHalf

  const apart = title.left + title.width <= sunLeft || title.left >= sunRight

  if (apart) return centred

  return Math.min(lowest, Math.max(centred, sunBottom + SUN_TITLE_GAP * height + half))
}

/**
 * How much daylight is left between the sun and the wordmark, as a fraction of the frame's height.
 *
 * Small, because the room it is spent out of is what the title has left after clearing the sun at
 * all: at 375x667 the whole band is 153px and the title is 55 of them.
 */
const SUN_TITLE_GAP = 0.004

/** The button band in pixels, for a viewport of `height`. */
export function buttonBand(height: number): Band {
  return band(height, MENU_ZONES.BUTTONS_TOP, MENU_ZONES.SAFE_BOTTOM)
}

/** The rows reserved for approaching obstacles, in pixels. */
export function obstacleBand(height: number): Band {
  return band(height, MENU_ZONES.BAND_TOP, MENU_ZONES.BAND_BOTTOM)
}

/**
 * Whether a block spanning `top..bottom` (in pixels) reaches into `into`.
 *
 * Used by the acceptance check rather than by the layout: the layout puts things where they go,
 * and this asks afterwards whether anything ended up somewhere it may not be. The two halves are
 * separate on purpose — a rule enforced only by the code that follows it has no way to fail.
 */
export function intersects(top: number, bottom: number, into: Band): boolean {
  return bottom > into.top && top < into.bottom
}

/**
 * How far up the road the front screen's mascot must stand for its feet to clear a row.
 *
 * **⚠ This replaced a constant, and the constant was wrong at both ends of the range of frames.**
 * The band the creature has to fit into is between the horizon — which its feet approach and can
 * never pass — and the top of the Play stack, and that band is 46px on a 320x568 frame against a
 * 75px mascot, and 158px on a desktop. One lift for both leaves the phone's pad *touching* the
 * button (measured at 0px) and spends 38px of sky on a desktop that had 44px of clearance already.
 *
 * The arithmetic is the projection's own, inverted. A mascot standing `z` times the run's distance
 * has its feet at `horizon + (rest - horizon) / z` of the frame, because the offset from the
 * horizon goes as `1 / z` — so asking for a row gives back the `z` that puts them there.
 *
 * - **Clamped into `[minZ, maxZ]`**, and the floor is what makes a roomy frame keep exactly the
 *   composition it had: without it a desktop would be pushed *down* the road to spend its slack.
 * - **`clears` is false when the row asked for is at or above the horizon**, i.e. when no `z` does
 *   it at all. That is the honest answer on a short landscape frame, and it is a better question
 *   than "does the stack fit under where the mascot happens to be" — which is what the caller used
 *   to ask, against a feet row that is now solved rather than fixed.
 *
 * Pure, and in this file rather than in the scene, because it is a statement about the frame's own
 * zones — and because a rule a `verify:` script cannot reach is a rule nobody is checking.
 */
export function mascotLift(spec: {
  /** The viewport's height in pixels. */
  readonly height: number
  /** The row the feet have to end up above — the Play stack's own top edge, in pixels. */
  readonly stackTop: number
  /** How much road is left showing under the pad, in pixels. */
  readonly clearance: number
  /**
   * The vanishing row and where a run's own mascot stands, both as fractions of the frame's height.
   *
   * Arguments rather than this file's own `MENU_ZONES.BAND_BOTTOM`, which happens to carry the same
   * 0.62: the horizon is the *projection's* number and the rest row is solved from it, so a copy
   * here would be two constants agreeing by coincidence — which is exactly what `verify:menu`
   * asserts against a real `HORIZON_Y` rather than a local one.
   */
  readonly horizon: number
  readonly rest: number
  /** The composition's own distance, and how far the lift may go. */
  readonly minZ: number
  readonly maxZ: number
}): { z: number; clears: boolean } {
  const above = spec.stackTop - spec.clearance - spec.height * spec.horizon

  if (above <= 0) return { z: spec.maxZ, clears: false }

  const z = (spec.height * (spec.rest - spec.horizon)) / above

  return { z: Math.min(Math.max(z, spec.minZ), spec.maxZ), clears: z <= spec.maxZ }
}

/** Where a mascot standing `z` times the run's distance puts its feet, in pixels. */
export function mascotFeetRow(height: number, horizon: number, rest: number, z: number): number {
  return height * (horizon + (rest - horizon) / z)
}

/**
 * How wide the secondary control under Play may be drawn, as a share of Play itself.
 *
 * **The hierarchy's one arithmetic rule, and it is inherited from the control this replaced.** The
 * mode chip carried the same number for the same reason: weight is carried by the tier — a muted
 * face against a solid one — and width has to be a *rule*, or a longer label would quietly grow the
 * secondary control past the primary one and invert the hierarchy the first time somebody
 * translated it. `New run` is much shorter than `Play` is wide, so this binds on nothing today and
 * is the guard for the day it does.
 */
export const SECONDARY_WIDTH_OF_PLAY = 0.82

export function secondaryMaxWidth(playWidth: number): number {
  return playWidth * SECONDARY_WIDTH_OF_PLAY
}
