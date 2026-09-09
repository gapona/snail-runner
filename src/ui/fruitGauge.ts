/**
 * The Fever gauge, as geometry: a vertical tank beside the mascot, one segment per fruit.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:ui`.
 *
 * ## ⚠ Three shapes, and each was reported off a frame
 *
 * **It was a leaf**, and the leaf was wrong twice over. It is not what a player collects — the fuel
 * for a Fever is *fruit*, and there is no leaf anywhere in this game — so the gauge was drawn in a
 * currency the run never mentions. And it was a large flat two-colour blade with a thick contour in
 * a frame made of dense low-poly masses under soft light, which is why it was the first thing the
 * eye landed on: it did not belong to the picture at all.
 *
 * **Then it was a horizontal row of fruit**, which fixed the currency and the count and put a
 * 250px-wide readout across the top-left corner under the distance — a second block of interface in
 * the band that already carries the run's own number.
 *
 * **It is a vertical tank now, in the bottom-right corner, and the axis is the argument.** A tank is
 * the shape everything that fills is drawn as, so which way it fills needs no explaining; standing
 * it upright puts it in the one column of the frame the run leaves empty, next to the mascot the
 * fruit is being collected by, in a strip a few segments wide rather than a bar across a corner.
 *
 * The three things the old *bar* could not say are said by construction, and they are why this is
 * segmented rather than a single blade:
 *
 * - **how many more** — one segment per fruit, so the count is a number of steps rather than a
 *   length to estimate;
 * - **which way** — it fills from the bottom, which is what a tank does;
 * - **where full is** — `FULL_MARK` is drawn across the top whether or not the tank is full, so the
 *   target is on screen from the first frame of a run rather than arriving with the last fruit.
 *
 * ## ⚠ It is anchored to the frame, and `fruitGaugeBox` takes the viewport and nothing else
 *
 * An older version rode above the mascot's projected head, on the argument that the corner is the
 * furthest point in the frame from where the player is looking. The argument is right and the place
 * it produced is worse: the snail's head sits just under the vanishing point, so `head − height`
 * parked the gauge **on the horizon, dead centre** — measured at y 591 against a horizon at 586 on
 * a 945-tall frame — which is the one strip of the picture the player reads obstacles out of.
 *
 * So there is no anchor, and that is the fix rather than a retreat: **`fruitGaugeBox` is a pure
 * function of the frame**, `verify:ui` asserts its arity, and there is therefore no branch —
 * fallback or otherwise — that could put this in world coordinates or scale it with distance. A
 * screen-space readout cannot be given a world position by a function never told one.
 */

/** One segment's proportions, in unscaled pixels. */
export const FRUIT_SEGMENT = {
  /**
   * How wide the tank is.
   *
   * **Narrow on purpose, and the number is bounded by the mascot rather than by taste.** This sits
   * in the bottom-right corner, and at full lock on a narrow portrait frame the snail's own drawn
   * box reaches most of the way across the road — so every pixel of width here is a pixel that can
   * end up over the thing the player is steering. `verify:ui` measures the clearance at every
   * supported viewport against the real projection.
   */
  width: 22,
  /** How tall one fruit's segment is. */
  height: 13,
  /** Space between two segments. The boundary the count is read off. */
  gap: 5,
} as const

export interface GaugeBox {
  x: number
  y: number
  w: number
  h: number
  /**
   * The scale the segments inside it are drawn at.
   *
   * **Returned rather than recomputed by the caller**, because it is not simply `uiScale`: a short
   * frame cannot hold eight readable segments at the interface scale's own 0.8 floor, so the tank
   * takes whichever is smaller. Two places deriving that independently is two places to get it
   * wrong, and the failure would be a tank whose drawn segments do not fit the box measured for it.
   */
  scale: number
}

/**
 * The tallest the tank may be, as a share of the frame's height.
 *
 * A tank running the height of the screen stops reading as a readout and starts reading as scenery,
 * and on a landscape frame it would reach the band the distance readout sits in. `verify:ui` holds
 * every supported viewport under it.
 */
export const MAX_COLUMN_HEIGHT_FRACTION = 0.42

/**
 * How wide and tall a tank of `count` segments is at `scale`.
 *
 * Separate from `fruitGaugeBox` because the tank is measured before it is placed — the corner it
 * sits in is derived from its own size, so the size cannot be derived from the corner.
 */
export function fruitColumnSize(count: number, scale: number): { w: number; h: number } {
  const h = FRUIT_SEGMENT.height * scale
  const gap = FRUIT_SEGMENT.gap * scale

  return { w: FRUIT_SEGMENT.width * scale, h: count * h + Math.max(0, count - 1) * gap }
}

/**
 * Where the tank sits, in screen pixels: the **bottom-right corner**, beside the mascot.
 *
 * Three arguments, all of them numbers about the frame, and the count of them is asserted. This is
 * the whole of the fix for a gauge that once ended up on the horizon: the box cannot depend on the
 * mascot, the camera, the run's distance or a projection, because none of those is in scope and
 * there is nowhere to put one. `verify:ui` checks the arity rather than the output — an output can
 * be right on the day it is measured, where an argument list cannot grow by accident.
 *
 * `scale` is passed in rather than recomputed, because `ui/uiScale.ts` imports Phaser as a value
 * and so cannot be reached from a `verify:` script; a local copy of that curve would be a second
 * opinion about how narrow a frame is.
 */
export function fruitGaugeBox(width: number, height: number, scale: number): GaugeBox {
  const full = fruitColumnSize(FRUIT_GAUGE_PIPS, scale)
  // **The tank shrinks past `uiScale`'s floor rather than overflowing.** That floor exists so type
  // stays readable on a narrow screen; this is not type, it is eight blocks, and eight blocks over
  // half the height of a short landscape frame is scenery. Taking the smaller of the two keeps the
  // tank inside its share of the frame by construction rather than by the numbers working out.
  const fitted = Math.min(scale, (scale * height * MAX_COLUMN_HEIGHT_FRACTION) / full.h)
  const { w, h } = fruitColumnSize(FRUIT_GAUGE_PIPS, fitted)
  const margin = 16 * scale

  return { x: width - margin - w, y: height - margin - h, w, h, scale: fitted }
}

/**
 * How many segments the tank has.
 *
 * Deliberately a constant here rather than an import of `FEVER_FRUIT_TARGET`: `src/ui/` is the
 * interface kit and must not depend on the run's rules, and `verify:ui` asserts the two are equal
 * so the tank cannot quietly stop being one segment per fruit.
 */
export const FRUIT_GAUGE_PIPS = 8

/**
 * How full each segment is, `0..1`, **bottom to top**.
 *
 * **The partial segment is the boundary, and it is why this returns a number per segment rather
 * than a count.** While fruit is being banked the fill is already quantised — eight fruit, eight
 * segments, so every one is exactly 0 or 1 and the boundary is a hard edge between two of them.
 * While a Fever *drains*, the fill is continuous, and the one segment caught mid-way is what says
 * the tank is emptying rather than sitting still. Same object, two states, one rule.
 */
export function pipFills(fill: number, count: number): number[] {
  const clamped = Math.min(1, Math.max(0, fill))
  const lit = clamped * count

  return Array.from({ length: count }, (_, i) => Math.min(1, Math.max(0, lit - i)))
}

/**
 * The bottom edge of segment `i`, measured **up from the bottom of the box**.
 *
 * Index 0 is the bottom segment, which is the whole point of the axis: a caller that drew index 0
 * at the top would have built a tank that empties as it fills.
 */
export function segmentOffsetY(i: number, scale: number): number {
  const h = FRUIT_SEGMENT.height * scale

  return i * (h + FRUIT_SEGMENT.gap * scale)
}

/**
 * How the full-tank mark is drawn, as fractions of the tank's own width.
 *
 * **It is on screen whether or not the tank is full**, which is the half a plain bar could not do:
 * the mark is the statement of the target, and a target that only appears once it is met is not a
 * target. It overhangs the tank on both sides so it reads as a line *across* the tank rather than
 * as a ninth segment stacked on top of the eight, and `standoff` holds it clear of the top one --
 * resting on it, it read as exactly that ninth segment on the first frame it was looked at.
 */
export const FULL_MARK = { overhang: 0.28, thickness: 0.16, standoff: 0.22 } as const

/**
 * The pulse a filling tank carries, `0..1`, from the time since the last fruit was banked.
 *
 * **One pulse per fruit, not a continuous throb.** A readout that is always moving is one the eye
 * stops catching — the same finding the last shield pip and the sun's own corona are both under —
 * so this fires on the *event* and decays. What it says is "that went in", at the moment it did.
 */
export const FRUIT_PULSE_MS = 380

export function fillPulse(t: number): number {
  const p = Math.min(1, Math.max(0, t))

  return Math.sin(Math.PI * p) * (1 - p)
}

/**
 * The pulse a **full** tank carries, `0..1`, from a free-running clock.
 *
 * This one *is* continuous, and the exception is the point: a full tank is a state the player has
 * to act on rather than an event that has passed, so it goes on saying so until it is spent. Two
 * incommensurate periods, for `SUN_ANIM`'s reason — the eye finds a single sine's period in about
 * three cycles and the thing starts reading as a mechanism rather than as something ready to go.
 */
export const FULL_PULSE = { fastMs: 640, slowMs: 1030 } as const

export function fullPulse(nowMs: number): number {
  const fast = Math.sin((nowMs / FULL_PULSE.fastMs) * Math.PI * 2)
  const slow = Math.sin((nowMs / FULL_PULSE.slowMs) * Math.PI * 2)

  return (fast * 0.6 + slow * 0.4) * 0.5 + 0.5
}

/**
 * How far the tank dims while the mascot is under it, and the floor it never goes below.
 *
 * **⚠ The bottom-right corner cannot be cleared, and that is arithmetic rather than a bad choice
 * of margin.** At the player's own row the road is **102% of the frame wide** — `PLAYER_Z` is
 * solved so that a finger at the screen's edge can still ask for the road's edge
 * (`STEER_REACH_MARGIN`), which puts the asphalt's edge just off screen. So the mascot's drawn box
 * reaches the frame's right edge at full lock, and a column standing anywhere on that edge is
 * crossed. Measured on the shipped constants, the snail meets the tank at **|offsetX| 0.67 on a
 * 320x568 frame and 0.82 at 1920x945**, against a road edge of 0.875 — i.e. during ordinary
 * steering, not only out on the verge. No width fixes it: clearing the snail at maximum steer
 * would need the tank's left edge at 337px of a 320px frame.
 *
 * The row in the other corner has no such problem, and the difference is instructive: it clears
 * *vertically*, sitting under the mascot's feet, which is a band no amount of steering enters.
 * A tank tall enough to hold eight readable segments does not fit in that band on a short
 * landscape frame — 33px at 844x390 — so it cannot buy its clearance the same way.
 *
 * What is left is to yield. The tank fades while the mascot is over it and comes straight back,
 * because between a readout and the thing the player is steering, the readout is the one that can
 * afford to be harder to see for a moment. It never fades to nothing: a gauge that vanished would
 * be indistinguishable from one that had broken, and the player would still be able to see roughly
 * how full it is at `YIELD_ALPHA`.
 *
 * **This is an alpha and never a position.** `fruitGaugeBox` still takes the frame and nothing
 * else, which is the property that keeps a screen-space readout out of world space — the mascot's
 * box is allowed to change how hard this is drawn and is not allowed to change where it is.
 */
export const YIELD_ALPHA = 0.3

/**
 * How hard to draw the tank given where the mascot currently is, `YIELD_ALPHA..1`.
 *
 * Ramped over the mascot's own width rather than switched, so a snail sliding along the right edge
 * dims the tank smoothly instead of blinking it — a readout that flickers on and off with the
 * steering is worse than one that is simply covered.
 */
export function gaugeYield(
  tank: { x: number; y: number; w: number; h: number },
  mascot: { left: number; right: number; top: number; bottom: number },
): number {
  const overlapX = Math.min(tank.x + tank.w, mascot.right) - Math.max(tank.x, mascot.left)
  const overlapY = Math.min(tank.y + tank.h, mascot.bottom) - Math.max(tank.y, mascot.top)

  if (overlapX <= 0 || overlapY <= 0) return 1

  // Ramped on how much of the **tank** is covered rather than on how much of the mascot is over
  // it: what the player loses is the readout, so the readout's own width is the thing that scales.
  // Measured against the mascot instead, a snail three times the tank's width could never dim it
  // fully however completely it covered it.
  const covered = Math.min(1, overlapX / Math.max(1, tank.w))

  return 1 - (1 - YIELD_ALPHA) * covered
}

/**
 * The pulse halo's stroke width, as a fraction of the tank's own width.
 *
 * Here rather than as a literal in `Hud.ts` because `gaugeBleed` has to know it: the halo is drawn
 * *around* the tank, so half its width is the widest thing outside the box on three sides.
 */
export const GAUGE_HALO_FRACTION = 0.09

/**
 * How far outside its own box the tank can draw, in screen pixels.
 *
 * **The tank is baked into a texture and anything past it is clipped**, so this is a bound rather
 * than a margin — see `ui/bakedGraphics.ts`. Two things put ink outside `fruitGaugeBox`: the
 * full-tank mark, which overhangs by `FULL_MARK.overhang` of the width and stands off above the
 * first segment; and the pulse halo, a stroke around the whole column that reaches half its own
 * width beyond whichever edge it is drawn on. Per axis, because the tank is tall and narrow and
 * what reaches furthest above it is not what reaches furthest beside it.
 */
export function gaugeBleed(w: number): { x: number; y: number } {
  const over = w * FULL_MARK.overhang
  const thickness = Math.max(2, w * FULL_MARK.thickness)
  const halo = Math.max(2, w * GAUGE_HALO_FRACTION)

  return {
    // Sideways: the full mark reaches furthest, with the halo close behind it.
    x: Math.max(over, over * 0.5 + halo / 2),
    // Vertically the mark's own height and its stand-off dominate, and the halo is drawn two
    // pixels above that and four below the tank. One number covers both ends.
    y: Math.max(thickness + FULL_MARK.standoff * w + 2 + halo / 2, 4 + halo / 2),
  }
}
