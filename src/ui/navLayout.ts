import { MIN_TOUCH } from './kitPalette'

/**
 * Where the bottom bar's plate, its tabs and its gear sit, in screen pixels.
 *
 * **Pure, and separate from `navBar.ts` for the reason `exitButton.ts` is separate from the HUD**:
 * that file imports `phaser` as a value, so nothing in it can be reached from a `verify:` script,
 * and "the gear is centred in its own cell and clears the touch floor at every supported frame" is
 * exactly the kind of claim that has to be measured rather than eyeballed. `scale` is a parameter
 * for the same reason — `uiScale` lives on the Phaser side of that line.
 */

export const NAV_BAR = {
  /**
   * Bar height in unscaled pixels, and the plate's corner radius.
   *
   * **⚠ Trimmed once the bar was on a real frame.** At 58 plus a 10px margin it took **78px** off the
   * bottom of a screen that had no slack: the Play button's own stack needs ~106px and the gap
   * between the mascot's feet and the bar came out at 73px on a desktop and **6px** on a short
   * landscape phone. This is the cheaper half of the fix — the other half stands the mascot further
   * up the road (`MASCOT.zScale`), which raises its feet without shrinking it.
   */
  height: 50,
  radius: 14,
  /** How far in from the frame's edges the bar sits. */
  margin: 8,
  /** The gear's share of the bar's width, taken off the right end before the tabs are laid out. */
  gearFraction: 0.16,
  /**
   * ...and the bounds on that share, in unscaled pixels.
   *
   * **⚠ A fraction alone is a 305px void on a desktop bar.** 16% of a 1904px bar puts the gear a
   * third of the way in from the right edge with nothing between it and the divider — reported as
   * the settings control having no sensible inset. A phone is where the fraction is right (59px on
   * a 383px frame), so it is kept and bounded rather than replaced: the cell is a share where a
   * share is small and a fixed corner control where it is not.
   */
  gearMin: 52,
  gearMax: 72,
} as const

/**
 * The bar's own surface: what "a plate like the bottom panel" actually is, in numbers.
 *
 * **Here rather than inline in `navBar.ts`, because a second control now wants the same surface.**
 * The garage's ✕ was a bare glyph in a corner over open sky and was reported as unnoticeable; what
 * makes the bar findable is not its ink but the plate under it, so the fix is to give that control
 * the bar's own surface rather than a louder glyph. Two copies of one look is one of them drifting
 * the first time either is tuned — see `EXIT_ALPHA`, which exists for exactly that reason.
 */
export const NAV_SURFACE = {
  fillAlpha: 0.9,
  strokeAlpha: 0.5,
  /** Stroke width in unscaled pixels, and the floor it may not thin below on a narrow frame. */
  strokePx: 2,
  minStrokePx: 1.5,
} as const

export interface NavRect {
  x: number
  y: number
  w: number
  h: number
  /** The centre, which is what a glyph is positioned by — stated rather than re-derived per caller. */
  cx: number
  cy: number
}

export interface NavBarBoxes {
  bar: NavRect
  tabs: NavRect[]
  gear: NavRect
  /** The rule between the tabs and the gear: a tab is a place, the gear is a drawer. */
  divider: { x: number; top: number; bottom: number }
}

function rect(x: number, y: number, w: number, h: number): NavRect {
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
}

/** How tall the bar is, including its margins — what a screen above it has to keep clear of. */
export function navBarHeight(scale: number): number {
  return (NAV_BAR.height + NAV_BAR.margin * 2) * scale
}

export function navBarBoxes(width: number, height: number, scale: number, tabCount: number): NavBarBoxes {
  const margin = NAV_BAR.margin * scale
  const barH = NAV_BAR.height * scale
  const barW = width - margin * 2
  const barX = margin
  const barY = height - margin - barH

  // Bounded on three sides: the share, the two absolute limits, and — for a frame narrow enough
  // that the limits fight each other — never more than a couple of tabs' worth of the bar.
  const gearW = Math.min(
    Math.max(barW * NAV_BAR.gearFraction, NAV_BAR.gearMin * scale),
    NAV_BAR.gearMax * scale,
    barW * 0.4,
  )
  const tabsW = barW - gearW
  const slot = tabsW / tabCount
  const tabs: NavRect[] = []

  for (let i = 0; i < tabCount; i++) tabs.push(rect(barX + slot * i, barY, slot, barH))

  return {
    bar: rect(barX, barY, barW, barH),
    tabs,
    // **Centred in its own cell in BOTH axes, which is the half that was wrong.** The tabs carry an
    // icon above a label, so their block fills the bar; the gear is a lone glyph, and hung from the
    // icons' own baseline it sat a fifth of the bar's height high — the bar looked as though its
    // last control had been dropped in from the row above.
    gear: rect(barX + tabsW, barY, gearW, barH),
    divider: { x: barX + tabsW, top: barY + barH * 0.22, bottom: barY + barH * 0.78 },
  }
}

/** The floor a nav target has to clear, re-exported so a caller states one number rather than two. */
export const NAV_MIN_TOUCH = MIN_TOUCH
