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
 *        HUD's rows: distance, lives, boost. Empty in the menu, so the
 *        eye does not have to move when they appear.
 * 0.20 ────────────────────────  HUD_BOTTOM / TITLE_TOP
 *        TITLE. Clear sky above the enemy band.
 * 0.34 ────────────────────────  OBSTACLE_BAND_TOP
 *        the rows an approaching obstacle is read in. Menu content: nothing.
 * 0.55 ────────────────────────  OBSTACLE_BAND_BOTTOM
 *        the snail's own row and the ground around it.
 * 0.72 ────────────────────────  BUTTONS_TOP
 *        BUTTONS. The near ground, which a run deliberately leaves empty.
 * 0.94 ────────────────────────  SAFE_BOTTOM
 * ```
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
const OBSTACLE_BAND_TOP = 0.34
const OBSTACLE_BAND_BOTTOM = 0.55

export const MENU_ZONES = {
  /** Below the rows the HUD claims in a run. Nothing of the menu goes above this. */
  HUD_BOTTOM: 0.2,
  /** The title band: from the HUD's floor to the enemy band's ceiling. */
  TITLE_TOP: 0.2,
  TITLE_BOTTOM: OBSTACLE_BAND_TOP,
  /** Reserved for approaching obstacles, in the menu exactly as in a run. */
  BAND_TOP: OBSTACLE_BAND_TOP,
  BAND_BOTTOM: OBSTACLE_BAND_BOTTOM,
  /** The button band: the near ground, which a run leaves empty by design. */
  BUTTONS_TOP: 0.72,
  SAFE_BOTTOM: 0.94,
} as const

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
