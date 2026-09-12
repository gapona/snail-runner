/**
 * How high above its ground point a thing is drawn, in screen pixels.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:jump` covers it.
 *
 * ## ⚠ The projection is not square, and heights were drawn on the wrong axis
 *
 * `projectInto` scales a lateral world offset by `screenWidth / 2` and a vertical one by
 * `screenHeight / 2`, so a world unit is a different number of pixels across than it is up — by
 * exactly the frame's aspect. That is fine for the road, which is a flat ribbon and has always
 * looked right at every aspect. It is not fine for a billboard: `billboardRectInto` sizes every
 * sprite off the **width** (so a snail is the same share of the road on every frame) and lifts it
 * off the ground by the **height**. The two halves of one object were on two different scales.
 *
 * Reported from a landscape phone: jumping over an obstacle, the snail visually almost catches it.
 * It did, on screen, while the collision said it cleared. A jump's apex against the snail's own
 * drawn height, by frame:
 *
 * | frame | apex / snail | a `low` block / snail |
 * |---|---|---|
 * | portrait 384x744 | 2.70 | 0.74 |
 * | desktop 1920x945 | 0.78 | 0.74 — the feet skim the top |
 * | landscape webview 828x300 | **0.50** | 0.74 — the feet below the top |
 *
 * And portrait was wrong the other way: the tall barrier is built so the snail's head at the apex
 * stays under it ("a jump can no longer draw clear of one"), and at 2.7 the snail drew well clear
 * of it — which is the "the tall barrier looks jumpable" report, arriving again from the axis.
 *
 * So a height is drawn on the sprite's own scale — `scale * height * screenWidth / 2` — and the
 * apex is 1.39 snail heights on every frame, which is the number the bands were designed against.
 * `src/road/` is not touched: this lifts from the ground point `billboardRectInto` already
 * projected, which is the one thing that has to agree with the road.
 *
 * ## The soft ceiling, because a true-scale ramp flight leaves a short frame
 *
 * At true scale a ramp's 1200-unit apex is 3.9 snail heights, and a 300px-tall landscape frame is
 * about four. So above `LIFT_KNEE` of the room between the ground point and the top of the frame,
 * the lift is eased toward that room and never reaches it: the snail rises into the top of the
 * frame and stays in it rather than leaving it. A jump is nowhere near the knee on any frame the
 * game supports; only a ramp flight on a short one gets there.
 */

import { billboardRectInto, type BillboardRect } from '../road/billboard'
import type { ScreenPoint } from '../road/project'
import { PLAYER_BODY_H } from './constants'

/** Where the compression starts, as a share of the room above the ground point. */
export const LIFT_KNEE = 0.72

/** How far from the frame's top edge the reference body's top may come, as a share of the frame. */
export const LIFT_TOP_MARGIN = 0.03

/**
 * The drawn lift, in pixels, of something `height` world units above a ground point at `groundY`.
 *
 * `scale` is the ground point's projected scale. Monotonic and continuous in `height`, exactly the
 * true lift below the knee, and strictly under the room above it.
 *
 * **The room is measured to the top of a SNAIL, whatever is being lifted.** A ceiling measured to
 * each sprite's own top would pin a coin and the snail at different heights for the same world
 * height — so an arc laid along a ramp flight would part company with the flight exactly where the
 * two meet. Measured against one body, everything at one world height and one distance is drawn at
 * one lift, and the collection the player sees is the collection that happens.
 */
export function drawnLift(scale: number, height: number, groundY: number, screenWidth: number, screenHeight: number): number {
  if (!(scale > 0) || !Number.isFinite(height)) return 0

  const unit = (scale * screenWidth) / 2
  const lift = unit * height

  // Below the ground point (a creature's tucked pose hangs its base a little under it) is drawn at
  // true scale: the ceiling is a question about the top of the frame.
  if (height <= 0) return lift

  const room = groundY - unit * PLAYER_BODY_H - screenHeight * LIFT_TOP_MARGIN

  // No room at all — a body already taller than the frame above its feet. Drawn at true scale:
  // the ceiling is for keeping a flight on screen, not for pinning something that never was.
  if (!(room > 0)) return lift

  const knee = room * LIFT_KNEE

  if (lift <= knee) return lift

  const span = room - knee

  return knee + span * (1 - Math.exp(-(lift - knee) / span))
}

/**
 * `billboardRectInto`, lifted by `drawnLift` rather than by the road's own vertical scale.
 *
 * The sprite's size and its ground point are the billboard's, unchanged — only how far above that
 * point it is drawn moves onto the sprite's own axis. Every pool that draws something at a height
 * calls this instead, so none of them can be left on the other scale.
 */
export function liftedRectInto(
  out: BillboardRect,
  ground: ScreenPoint,
  offsetX: number,
  height: number,
  textureWidth: number,
  textureHeight: number,
  screenWidth: number,
  screenHeight: number,
): BillboardRect {
  billboardRectInto(out, ground, offsetX, 0, textureWidth, textureHeight, screenWidth, screenHeight)
  out.y = ground.y - drawnLift(ground.scale, height, ground.y, screenWidth, screenHeight)

  return out
}
