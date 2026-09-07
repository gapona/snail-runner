import { MIN_TOUCH } from './kitPalette'

/**
 * Where the wardrobe screen's interface goes, given where the mascot ended up.
 *
 * **Pure, and separate from `Garage.ts` for `navLayout.ts`'s reason** — the scene imports `phaser`
 * as a value, and the three claims worth holding here are exactly the kind a screenshot cannot
 * settle: the caption never lands on the creature, the arrows are beside the creature rather than
 * beside the horizon, and every control clears the touch floor.
 *
 * ## ⚠ Three things were reported off one frame and all three are geometry
 *
 * - **the skin's name was printed over the snail.** The stack was placed at `feet + gap` and then
 *   clamped up with `Math.min` so it would clear the bottom bar — and on any frame where the band
 *   between the feet and the bar is shorter than the stack, that clamp wins and puts the caption on
 *   the shell. A clamp that can move a label *onto* the thing it labels is not a clamp.
 * - **the way out was the loudest object on the screen**, a solid `kitButton` bigger than the
 *   arrows that page the wardrobe. It is the run HUD's own quiet glyph now — see `EXIT_ALPHA`.
 * - **the arrows sat at the horizon**, on a fixed fraction of the frame, a long way from the thing
 *   they page. They hang off the mascot's own drawn box here.
 *
 * ## The stack is bottom-anchored and the caption never rises past the feet
 *
 * Anchoring from the bar upward is what maximises the clearance: the action button is as low as it
 * can be, the caption sits directly above it, and whatever room is left is *above* the caption
 * rather than being spent between it and the bar. If the band is still too short the stack **fits**
 * — one factor over the whole thing, floored, the same pass `Settings`, the result panel and the
 * front screen's title all needed — and only if it will not fit at the floor does the layout change
 * shape.
 *
 * ## ⚠ The screen is static, and it was the road that made the caption resize
 *
 * A later report, off a phone: the text changes size along with the road being run on. It did. This
 * was solved every frame against `PlayerView.drawnBox` — the projection's own box, on a road that
 * ran — and `fit` was measured from labels the *previous* pass had already shrunk, which is a
 * feedback loop: smaller text, smaller `needed`, larger fit, larger text. `Garage` freezes the road
 * and measures the labels unfitted; this file is unchanged by that, which is the point of it being
 * a function of its arguments.
 *
 * ## ⚠ And on a short landscape frame no arrangement puts it under the mascot
 *
 * The feet sit on a row the projection fixes (`PLAYER_Z` times the screen's own `zScale`), and the
 * bar owns the bottom band, so the room between them is a property of the frame rather than of this
 * layout. On a 844x390 frame it is under 60px against a stack that needs 90 at full size — and
 * raising the mascot further up the road cannot help past the horizon, which is the same wall the
 * front screen's own stack hit. So the stack goes **beside** the mascot there, which is the answer
 * `MainMenu` already reached for the identical measurement.
 */
export const GARAGE_LAYOUT = {
  /** Between the feet and the caption, and between the caption and the button, in unscaled px. */
  gap: 14,
  /** How far the stack may be shrunk before the layout changes shape instead. */
  minFit: 0.72,
  /** Below this frame aspect the stack goes beside the mascot rather than under it. */
  sideBySideMinAspect: 1.3,
  /** How far outside the mascot's own drawn box the arrows sit, as a share of the frame's width. */
  arrowStandoff: 0.03,
  /** How far in from the frame's edges the arrows may come, in unscaled px. */
  arrowMargin: 10,
  /** The overview strip: dot diameter, the gap between two, and how far under the caption it sits. */
  dot: 9,
  dotGap: 7,
  stripGap: 10,
  /** How much bigger the dot for the entry currently on screen is drawn. */
  currentScale: 1.6,
} as const


/**
 * The overview strip: one dot per wardrobe entry, under the caption.
 *
 * ## ⚠ Why a strip and not a second selector
 *
 * The wardrobe is one flat list — five colours then five items — paged by a pair of arrows, and the
 * cost of that was stated when it shipped: *ten entries paged one at a time is a wardrobe with no
 * overview, and the player cannot see at a glance what they own.* The screen's own argument is that
 * exactly one thing is on it at a time and it is the size of the product, so what may not be added
 * is a strip of thumbnails — that is the row list this screen replaced.
 *
 * A dot carries the two facts the arrows cannot: **how many there are** and **where in them you
 * are**, plus owned-and-worn as a fill. It is not a control: tapping one would be the second
 * selector this is instead of.
 *
 * It goes **under the caption** rather than over the mascot, for the reason everything else on this
 * screen does — the creature is what the player came to look at.
 */
export function wardrobeStrip(
  centreX: number,
  y: number,
  scale: number,
  count: number,
  current: number,
): { x: number; y: number; radius: number; current: boolean }[] {
  const pitch = (GARAGE_LAYOUT.dot + GARAGE_LAYOUT.dotGap) * scale
  const left = centreX - ((count - 1) * pitch) / 2
  const dots = []

  for (let i = 0; i < count; i++) {
    dots.push({
      x: left + i * pitch,
      y,
      radius: ((GARAGE_LAYOUT.dot * scale) / 2) * (i === current ? GARAGE_LAYOUT.currentScale : 1),
      current: i === current,
    })
  }

  return dots
}

/** How much vertical room the strip asks for, so the stack can reserve it. */
export function wardrobeStripHeight(scale: number): number {
  return (GARAGE_LAYOUT.stripGap + GARAGE_LAYOUT.dot * GARAGE_LAYOUT.currentScale) * scale
}

export interface WardrobeBoxes {
  /** True when the caption and the button are beside the mascot rather than under it. */
  side: boolean
  /** The factor the caption and the button are drawn at. 1 unless the band is short. */
  fit: number
  name: { x: number; y: number }
  action: { x: number; y: number }
  arrows: { leftX: number; rightX: number; y: number }
}

/**
 * Solves the whole screen below the title in one pass.
 *
 * `feetY` is where the mascot's drawn box ends and `mascot` is that box — both come from
 * `PlayerView.drawnBox`, which is the only thing that knows where the projection actually put the
 * creature this frame. `barTop` is where the nav bar begins.
 *
 * **The caption's y is its own centre and it is never above `feetY`**, which is the property the
 * report is about and the one `verify:ui` asserts. In the side layout that is vacuous — nothing is
 * under the mascot at all — so the check asks the horizontal question there instead.
 */
export function wardrobeStack(
  width: number,
  height: number,
  scale: number,
  mascot: { left: number; right: number; top: number; bottom: number },
  barTop: number,
  sizes: { name: number; action: number; arrow: number },
): WardrobeBoxes {
  const gap = GARAGE_LAYOUT.gap * scale
  const feet = mascot.bottom
  // The strip is part of the stack's own height: reserved here rather than drawn into whatever gap
  // happens to be left, which is how a row ends up on top of a button — see `MainMenu`'s own board.
  const needed = sizes.name + wardrobeStripHeight(scale) + gap + sizes.action
  const band = barTop - gap - feet - gap
  const side = width / height >= GARAGE_LAYOUT.sideBySideMinAspect && band < needed * GARAGE_LAYOUT.minFit
  const fit = side ? 1 : Math.min(1, Math.max(GARAGE_LAYOUT.minFit, band / Math.max(needed, 1)))

  // The arrows flank the creature at its own middle, wherever the projection has put it — and are
  // pulled back inside the frame rather than allowed off it, because a control at the edge of a
  // wide mascot on a narrow frame is a control that is half off the screen.
  //
  // **⚠ Both bounds are the arrow's own half-width, and both used to be something else.** The
  // standoff was applied to the arrow's *centre*, so the control overlapped the creature by half
  // of itself — visible the moment the mascot grew on a phone — and the frame margin was
  // `MIN_TOUCH / 2`, which is the floor a `kitButton` may be rather than the width it turned out
  // to be: at a delivered 59px the arrow hung 9px off the edge of a 383px frame. Same correction,
  // and the same rule, as `exitButtonBox` — a control is inset by what it measures, never by what
  // it was assumed to be.
  const standoff = width * GARAGE_LAYOUT.arrowStandoff
  const half = Math.max(MIN_TOUCH, sizes.arrow) / 2
  const margin = GARAGE_LAYOUT.arrowMargin * scale + half
  const arrows = {
    leftX: Math.max(margin, mascot.left - standoff - half),
    rightX: Math.min(width - margin, mascot.right + standoff + half),
    y: (mascot.top + mascot.bottom) / 2,
  }

  if (side) {
    // The mascot keeps the side of the frame it is standing on; the stack takes the other one.
    const column = mascot.left > width / 2 ? mascot.left / 2 : width - (width - mascot.right) / 2
    const middle = (barTop + mascot.top) / 2

    return {
      side,
      fit,
      name: { x: column, y: middle - (sizes.action / 2 + gap / 2) },
      action: { x: column, y: middle + (sizes.name / 2 + gap / 2) },
      arrows,
    }
  }

  // **⚠ The strip is subtracted here as well as counted in `needed`, and it was not.** `needed`
  // reserved a row for the dots and the placement then left only `gap` between the caption and the
  // button — so the strip, drawn under the caption, was laid across the button's top edge. Reserved
  // in one place and spent in another is the same defect as a board that reserves the stack's
  // height and then draws over it; it is one expression now, read by both.
  const actionY = barTop - gap - (sizes.action * fit) / 2
  const nameY = actionY - (sizes.action * fit) / 2 - gap - wardrobeStripHeight(scale) - (sizes.name * fit) / 2

  return { side, fit, name: { x: width / 2, y: nameY }, action: { x: width / 2, y: actionY }, arrows }
}
