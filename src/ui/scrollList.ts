/**
 * The arithmetic behind a scrollable row list, and the tap-versus-drag decision.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:scroll`.
 *
 * Sits between the two halves that already exist and never talked to each other:
 * `ui/scrollRegion.ts` owns the clipping camera, `ui/scrollMomentum.ts` owns the flick physics,
 * and neither knows how tall the content is or whether a release was a tap. Both of those are
 * pure arithmetic over numbers a scene already has, which is why they live here rather than
 * inside the scene that first needed them.
 */

/** Total height of `count` rows of `rowHeight` separated by `gap`. Zero rows is zero, not a gap. */
export function contentHeight(count: number, rowHeight: number, gap: number): number {
  if (count <= 0) return 0

  return count * rowHeight + (count - 1) * gap
}

/**
 * The largest scroll offset that still shows content, i.e. how far the list may travel.
 *
 * **Never negative.** A list shorter than its viewport has nowhere to go, and returning a
 * negative bound would let `clampScroll` push short content off the top of its own window — a
 * catalogue with two items in it would scroll, which reads as a broken list rather than a short
 * one.
 */
export function maxScroll(content: number, viewport: number): number {
  return Math.max(0, content - viewport)
}

/** Holds an offset inside `0..maxScroll`. */
export function clampScroll(offset: number, content: number, viewport: number): number {
  const limit = maxScroll(content, viewport)

  if (!(offset > 0)) return 0

  return offset > limit ? limit : offset
}

/**
 * Whether a press-and-release was a tap on the thing under it, rather than the start of a drag.
 *
 * **This is why the row list could not simply keep firing on `pointerdown`.** A scrollable list
 * is grabbed by its rows — there is nothing else to grab — so a press that begins a scroll lands
 * on a row every time. Buying on the press means the first flick through a catalogue spends the
 * player's coins on whatever they happened to touch, which is a real purchase they did not make
 * and cannot undo.
 *
 * Measured from the *press* position rather than between frames: a slow drag never moves far in
 * any one frame and would pass a per-frame test the whole way down the list.
 */
export function isTap(dx: number, dy: number, slop: number): boolean {
  return dx * dx + dy * dy <= slop * slop
}

/**
 * How far a pointer may travel between press and release and still count as a tap, in pixels.
 *
 * Generous rather than tight, because **the two errors do not cost the same**: a tap read as a
 * drag costs one repeated tap, and a drag read as a tap costs a purchase the player did not make.
 *
 * Lives here rather than beside `bindAction`, which is the only thing that reads it, for one
 * mechanical reason: `platform/input.ts` imports `phaser` as a value, and a value import of
 * Phaser executes its init code, which reads `window` — so anything a `verify:*` script needs to
 * assert against cannot live in that file. Same rule the pure/Phaser split follows everywhere
 * else in this project.
 */
export const TAP_SLOP_PX = 12

/**
 * How tall the scrollable window should be, given everything else the panel must fit.
 *
 * Returned separately from the panel height because the two answer different questions and the
 * naive version conflates them: the panel is as tall as it is *allowed* to be, the window is
 * whatever is left after the chrome. Floored at `minimum` so a viewport too short for the chrome
 * yields a window that is small rather than negative — a negative viewport is a camera Phaser
 * throws on, and it is reachable on a phone in landscape.
 */
export function windowHeight(panel: number, chrome: number, minimum: number): number {
  return Math.max(minimum, panel - chrome)
}
