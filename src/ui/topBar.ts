import { MIN_TOUCH } from './kitPalette'

/**
 * The run's top bar: one band across the top of the frame, holding everything the run says up there.
 *
 * **Pure, and separate from `Hud.ts` for `navLayout.ts`'s reason** — that file imports `phaser` as a
 * value, so nothing in it is reachable from a `verify:` script, and "four readouts share one
 * baseline and two insets" is exactly the kind of claim a screenshot settles badly.
 *
 * ## ⚠ The top of the frame was four things at three heights
 *
 * The distance sat top-left at the margin, the milestone bar floated top-centre at 0.6 of it, the
 * exit button took the top-right corner, and the coins hung *under* the exit on a second row — where
 * on a portrait frame they landed on the sun. Nothing shared a baseline, nothing shared an inset,
 * and none of it had a background, so every one of them was read against whatever the sky and the
 * sun happened to be doing on that theme. Reported as a pile.
 *
 * What is here now is one band: a single content row with the distance at its left end and the
 * coins and the exit at its right, all on one baseline, inside one pair of insets, over a wash that
 * fades downward to nothing.
 *
 * ## Why a fade and not a plate
 *
 * A hard-edged plate across the top is the slab-across-the-road defect this project has removed
 * from the front screen three times. A wash that fades to nothing has no bottom edge to read as a
 * box — it is the sky getting darker toward the frame's edge, which is what the top of a frame does
 * anyway. It is a **generated texture** rather than a stack of rectangles for the vignette's own
 * reason: a quantised gradient bands, and a band-stack that is smooth in one direction has corners
 * in the other.
 */
export const TOP_BAR = {
  /**
   * How far the content sits in from the frame's edges, and from its top.
   *
   * **⚠ `padTop` is not `padX`, and the difference is the notch.** A phone's cutout eats the first
   * rows of the frame, and this game does no safe-area handling at all — there is no
   * `viewport-fit=cover` and no `env()` read anywhere — so what it can do instead is not put
   * anything it cannot afford to lose in the first few rows. The milestone rule is at the *bottom*
   * of the band for the same reason: it is the one part that is allowed to be a hairline, and a
   * hairline under a cutout is a hairline nobody misses.
   */
  padX: 14,
  padTop: 12,
  /** The content row's own height — the band a readout's baseline is centred in. */
  rowHeight: 40,
  /** The milestone rule along the bottom of the band, and the gap above it. */
  ruleHeight: 5,
  ruleGap: 6,
  /**
   * How far past the content the wash keeps fading, as a multiple of the band's own height.
   *
   * The wash has to end well below the last thing it is behind, or its own falloff becomes the
   * bottom edge of a box — which is the plate this is not.
   */
  washOvershoot: 0.7,
  /** How dark the wash is at the very top of the frame. It reaches zero at the bottom of its run. */
  washAlpha: 0.5,
  /** The gap between the coin readout and the exit beside it. */
  gap: 10,
} as const

export interface TopBarBox {
  x: number
  y: number
  w: number
  h: number
}

export interface TopBarLayout {
  /** The band the content sits in — insets already taken off. */
  content: TopBarBox
  /** The row every readout is centred on. One number, which is what "one baseline" means. */
  baseline: number
  /** Where the distance starts, and where the right-hand group ends. */
  left: number
  right: number
  /** The exit's own square, in the very corner of the content band. */
  exit: TopBarBox
  /** Where the coin readout's right edge sits: inside the exit, on the same baseline. */
  coinRight: number
  /** The milestone rule, along the bottom of the band. */
  rule: TopBarBox
  /** The wash behind all of it, which runs from the frame's top edge to past the band. */
  wash: TopBarBox
}

/**
 * How tall the whole band is, wash excluded — what anything below it has to clear.
 *
 * `exitHeight` is passed in rather than assumed for `exitButtonBox`'s reason: the drawn control is
 * measured, not predicted, and a band sized against a guess is a band the control hangs out of.
 */
export function topBarHeight(scale: number, exitHeight = MIN_TOUCH): number {
  const row = Math.max(TOP_BAR.rowHeight * scale, exitHeight)

  return TOP_BAR.padTop * scale + row + TOP_BAR.ruleGap * scale + TOP_BAR.ruleHeight * scale
}

/**
 * Everything in the band, from the frame and the two measured widths — and nothing else.
 *
 * The arity is the guarantee, exactly as it is for a quest row: there is no readout, no run and no
 * theme in scope, so nothing here can be positioned by the text it happens to hold. `verify:ui`
 * asserts it.
 */
export function topBarLayout(
  width: number,
  scale: number,
  exit: { w: number; h: number },
): TopBarLayout {
  const padX = TOP_BAR.padX * scale
  const exitW = Math.max(MIN_TOUCH, exit.w)
  const exitH = Math.max(MIN_TOUCH, exit.h)
  const row = Math.max(TOP_BAR.rowHeight * scale, exitH)
  const top = TOP_BAR.padTop * scale
  const height = topBarHeight(scale, exitH)

  const content: TopBarBox = { x: padX, y: top, w: Math.max(0, width - padX * 2), h: row }
  const baseline = top + row / 2
  const right = content.x + content.w

  return {
    content,
    baseline,
    left: content.x,
    right,
    // **The very corner, and the exit is the outermost thing in it.** The coins sit inside it on
    // the same baseline rather than under it, which is the second row this band exists to remove.
    exit: { x: right - exitW, y: baseline - exitH / 2, w: exitW, h: exitH },
    coinRight: right - exitW - TOP_BAR.gap * scale,
    rule: {
      x: padX,
      y: top + row + TOP_BAR.ruleGap * scale,
      w: Math.max(0, width - padX * 2),
      h: TOP_BAR.ruleHeight * scale,
    },
    // From the frame's own top edge, not from the inset: the wash is what the readouts are read
    // against, and a wash that started at the inset would leave a lit strip above itself.
    wash: { x: 0, y: 0, w: width, h: height * (1 + TOP_BAR.washOvershoot) },
  }
}

/**
 * How far into the frame the exit may sit before it is somewhere a steering thumb goes.
 *
 * **An accidental exit is the worst mistake this game can make**, so the claim is stated as a box
 * rather than left to "it is in the corner": the control has to be inside the top `topFraction` of
 * the frame and inside the outer `sideFraction` of its width. The snail is dragged along the bottom
 * of the screen and the thumb rests there, so the top corner is the quietest place there is — and
 * `verify:ui` measures the shipped box against both bounds at every supported viewport.
 */
export const EXIT_SAFE = { topFraction: 0.18, sideFraction: 0.28 } as const

/** Whether an exit box is out of the way of a steering thumb, for a frame of this size. */
export function exitIsClearOfThumb(exit: TopBarBox, width: number, height: number): boolean {
  return exit.y + exit.h <= height * EXIT_SAFE.topFraction && exit.x >= width * (1 - EXIT_SAFE.sideFraction)
}
