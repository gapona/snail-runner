/**
 * Tap or drag: the one decision every control laid over the playfield has to make about a pointer.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:weapons` and `npm run verify:ui`
 * both load it under Node. It lives here rather than beside `bindAction` for the same mechanical
 * reason `TAP_SLOP_PX` used to live in `ui/scrollList.ts`: `platform/input.ts` imports `phaser` as
 * a value, so nothing a verify script can reach may sit next to it.
 *
 * **Three controls now share this one rule**, which is why it is in `ui/` rather than in `rail/`
 * where it started: the shop's rows (a flick through the catalogue must not buy), the weapon row
 * (a stroke that begins on a cell must still lock targets), and the settings sliders (a drag along
 * a track sets a value, a tap on it jumps there). Each of the three had the same failure available
 * to it, and one of them had already shipped it.
 */

/** How far a press may travel and still count as a tap, in pixels at `uiScale` 1. */
export const TAP_SLOP_PX = 12

/** A point a pointer was at. */
export interface GesturePoint {
  x: number
  y: number
}

/**
 * Whether a gesture from `press` to `point` is still a tap.
 *
 * **Radial, and measured from the press rather than between frames.** A slow drag never moves far
 * in any one frame and would pass a per-frame test the whole way across the screen — the trap
 * `ui/scrollList.ts` documents from the shop, where it spent the player's coins on whatever was
 * under the finger when a flick began.
 *
 * `scale` is `uiScale(width)`, so the threshold is the same *apparent* distance on a phone as on
 * a desktop: a 12px slop on a 390px-wide frame is three times the fraction of the screen it is at
 * 1920, which would make the row hard to tap on exactly the device where taps are the input.
 */
export function isTap(press: GesturePoint, point: GesturePoint, scale = 1): boolean {
  return Math.hypot(point.x - press.x, point.y - press.y) <= TAP_SLOP_PX * scale
}
