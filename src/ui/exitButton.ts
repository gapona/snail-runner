// **`kitPalette`, not `uiScale`** — the same number lives in both, and only this one is reachable
// from a check: `uiScale.ts` imports `phaser` as a value, and a value import of Phaser executes its
// init code, which reads `window` and crashes under Node. It is also the more correct of the two
// here, because it is the floor `kitButton` actually applies to the box this reserves.
import { MIN_TOUCH } from './kitPalette'

/**
 * Where the run's own way out sits, and how much of the frame it reserves.
 *
 * ## ⚠ A run had no exit that a thumb could reach
 *
 * `RunScene` bound its `close` action to `ESC` and to nothing else, so on a phone — which is the
 * platform this game ships to — **the only way out of a run was to die**. It is the one screen in
 * the game with no visible way back, and it went unnoticed because every acceptance pass so far was
 * driven from a desktop keyboard.
 *
 * ## ⚠ The run no longer uses this, and what is left is a shared corner
 *
 * The HUD's own exit moved into the top band (`ui/topBar.ts`) when that band became one row: the
 * button was the loudest object in a frame the player is meant to be reading the road in, and the
 * coins it had pushed onto a second row were landing on the sun. What this still owns is the
 * *corner arithmetic* — a box measured from the frame and the control's own drawn size — which the
 * garage's own ✕ uses and got wrong by hand before it existed.
 *
 * It is the corner a steering thumb is least likely to be in, which is why both screens want it:
 * the snail rides the bottom of the frame and is dragged along it, so the top strip is the quietest
 * part of the screen. The run states that as a measured claim rather than a habit — see `EXIT_SAFE`.
 *
 * ## The reserved box is square and never scales below the touch floor
 *
 * `uiScale` shrinks type on a narrow frame, and this is not type — it is a target. `kitButton`
 * already floors its own box at `MIN_TOUCH` in both axes, so what this reserves is that
 * floor plus the margin, and `verify:ui` asserts the reservation clears every other HUD box at
 * every supported viewport rather than trusting that three corners stay three corners.
 */
/**
 * How loud a way out is, and how big its glyph is drawn.
 *
 * **The quietest control on whatever screen it is on, deliberately.** In a run everything else in
 * the top band is something the player wants to read and this is the one thing they should almost
 * never touch; in the garage it competes with the arrows that page the wardrobe, and it was
 * reported for winning — a solid `kitButton` drawn larger than the two controls the screen is
 * actually for. Its *target* is the 44px floor either way; what is quiet is the ink, not the box.
 *
 * **Here rather than in `Hud.ts`, because two screens now draw it.** These were module-private
 * there, so the garage had no way to match without copying two numbers — and two copies of one
 * look is one of them drifting the first time either is tuned.
 */
export const EXIT_ALPHA = 0.55
export const EXIT_GLYPH = 20

/**
 * ...and how loud it is once it is standing on the bar's own plate.
 *
 * **⚠ Quiet ink over a picture is quiet ink nobody finds.** `EXIT_ALPHA` is the right weight for
 * the run, where the control sits inside the top band's wash beside two readouts that group it;
 * the garage has no such band, so the same glyph was a faint mark on open sky and was reported as
 * unnoticeable. What answers that is the surface rather than the ink — `drawNavSurface` gives the
 * control the bottom bar's own plate — and once there is a plate the glyph has to be read against
 * *it*, not against the sky. So the two numbers are stated as a pair: a bare ✕ is quiet, a plated
 * one is not, and neither screen has to decide that for itself.
 */
export const EXIT_PLATED_ALPHA = 1

export const EXIT_BUTTON = {
  /** Margin from the frame's edges, in unscaled pixels — the same one the rest of the HUD uses. */
  margin: 16,
  /** The gap between this and the coin readout that now sits under it. */
  gap: 6,
} as const

/**
 * The corner this occupies, in screen pixels, for a frame of this size.
 *
 * **⚠ The drawn size is passed in rather than assumed, because it is not 44.** `kitButton` sizes
 * itself from its own label plus padding and only *floors* that at `MIN_TOUCH`; the glyph here
 * comes out 62x48 on a desktop frame. The first version of this reserved a flat 44 square, and the
 * coin readout — which is placed from the bottom of this box — ended up 2px under a button 4px
 * taller than the reservation. Two numbers for one box is one of them being wrong, so there is one:
 * the HUD hands in what it measured, and the default is the floor a check can reason about.
 *
 * **⚠ The margin is a parameter because a second screen has the same corner and got it wrong.**
 * `Garage` placed its own ✕ by setting the container's *centre* a flat 28px in from the top-right —
 * and a `kitButton` is drawn from its centre, so a 62x48 glyph hung 3px past the right edge and its
 * rim was cut off along the top. Two screens computing one corner is one of them being wrong; this
 * is the corner, and a caller may only choose how far in it sits.
 */
export function exitButtonBox(
  width: number,
  scale: number,
  size: { w: number; h: number } = { w: MIN_TOUCH, h: MIN_TOUCH },
  marginPx: number = EXIT_BUTTON.margin,
): { x: number; y: number; w: number; h: number } {
  const margin = marginPx * scale
  const w = Math.max(MIN_TOUCH, size.w)
  const h = Math.max(MIN_TOUCH, size.h)

  return { x: width - margin - w, y: margin, w, h }
}
