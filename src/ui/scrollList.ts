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
 * Release speed, in px/ms, from which a snapping list reads a release as a flick in a direction
 * rather than a finger let go where it was.
 *
 * About a quarter of what a deliberate thumb flick measures on a phone, and well above the drift a
 * finger has when it is simply lifted — a lifted finger is not asking to move a row.
 */
export const SNAP_FLICK_PX_PER_MS = 0.25

/**
 * Where a snapping list comes to rest: a row boundary, or the end of the travel.
 *
 * **⚠ A free coast is the wrong physics for a window a row tall, and it was reported as the scroll
 * being far too sensitive.** `stepMomentum` coasts `v / λ` — about **325px for every px/ms** of
 * release speed — which is a moderate glide down a shop's catalogue and, on the front screen's quest
 * window, several times its whole travel: a 50px window over three 37px rows has 54px to go, so
 * every flick slammed it to the end and every lifted finger drifted past the row it had stopped on.
 * A list that small is not browsed, it is *paged*: one gesture, one row.
 *
 * - `direction` 0 is a finger let go where it was: the nearest stop.
 * - `direction` +1 / -1 is a flick: the next stop that way from `anchor` — where the list was when
 *   the finger went down — and **only the next**, so a flick moves one row whatever its speed.
 *
 * **⚠ Counted from the press, not from the release.** A flick is a short drag and then a lift, and
 * the drag half already moves the list. On 37px rows a 40px flick from rest crosses the first stop
 * before the finger lifts, and "the next stop from the release" is then the one after it — two rows
 * for one gesture, which is the sensitivity this exists to remove. Counted from the press it is one.
 * A drag that genuinely carried the list further still lands where the finger took it: the nearest
 * stop to the release wins whenever it is further along the flick.
 *
 * The stops are the multiples of `pitch` short of `limit`, plus `limit` itself: the last row sits at
 * the window's bottom edge, which is not generally a whole number of rows from the top.
 */
export function snapTarget(offset: number, direction: number, pitch: number, limit: number, anchor = offset): number {
  if (!(limit > 0) || !(pitch > 0)) return 0

  const stops: number[] = []

  for (let stop = 0; stop < limit - 0.5; stop += pitch) stops.push(stop)
  stops.push(limit)

  // A pixel of slack, so a list sitting exactly on a stop moves to the next one rather than
  // counting the one it is on as "the next".
  const EPS = 1

  let nearest = stops[0]

  for (const stop of stops) if (Math.abs(stop - offset) < Math.abs(nearest - offset)) nearest = stop

  if (direction > 0) return Math.max(stops.find((stop) => stop > anchor + EPS) ?? limit, nearest)
  if (direction < 0) return Math.min([...stops].reverse().find((stop) => stop < anchor - EPS) ?? 0, nearest)

  return nearest
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
 * How long a whole-screen press may last, and how far it may slide, and still be a *jump*.
 *
 * **⚠ A different question from `TAP_SLOP_PX`, and borrowing that one broke the jump on every
 * phone.** A scrolling list asks "tap or scroll", where 12px is right: a finger that has moved a
 * centimetre was scrolling. The runner's whole-screen jump asks "jump or steer", and steering is
 * an *absolute* axis — the snail goes where the thumb is — so the thumb is travelling almost
 * whenever the player is playing. Measured in the running game with real touch pointers: a clean
 * tap jumped, a tap that slid **21px did not**, and a steer never did. On a phone, reacting to
 * something at speed, 21px of slide is an ordinary tap. Reported as *"tapping does not jump, it
 * hits the obstacle 100% of the time"*, and that is exactly what it was.
 *
 * **What tells a jump from a steer is TIME, not distance.** A jump is a stab; a steer is a hold —
 * that is the whole of the gesture, and it is what the player is already doing. So the duration is
 * the test and the distance is only a backstop against a fast flick that was meant to steer.
 *
 * The distance is the touch floor, which makes it a sentence rather than a number: **a tap that
 * stayed inside one touch target is a tap.** The duration is a deliberate stab — a press held past
 * it is somebody positioning the snail, whatever it lands on.
 */
export const JUMP_TAP_MS = 260

/** @see JUMP_TAP_MS — the backstop, in pixels: one touch target. */
export const JUMP_TAP_SLOP_PX = 44

/**
 * Whether a whole-screen press was a jump rather than the beginning of a steer.
 *
 * Both bounds, because either alone admits the other gesture: a slow small drag is a steer that
 * happens not to have gone far, and a fast flick across the road is a steer that happens to have
 * been quick.
 */
export function isJumpTap(dx: number, dy: number, heldMs: number): boolean {
  return heldMs <= JUMP_TAP_MS && isTap(dx, dy, JUMP_TAP_SLOP_PX)
}

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
