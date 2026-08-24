/**
 * Billboard projection: where a world object standing on the ground lands on screen, and how
 * much of it a hill in front of it leaves visible.
 *
 * **Rule: this file never imports `phaser`.** Same reason as `project.ts` — it is imported
 * directly by `scripts/verify-road-projection.mjs` under plain Node. The Phaser half (the
 * sprite pool that consumes these rectangles) is `RoadSprites.ts`.
 *
 * There is no separate 3D pipeline here: a billboard reuses the *road's own* projection of
 * the segment it stands on. Its scale, its screen x and the screen y of the ground beneath it
 * all come out of that segment's already-projected near edge (`Segment.s1`), so scenery can
 * never drift away from the ground it is standing on — they are literally the same numbers.
 */
import { ROAD_WIDTH, SPRITE_SCALE } from './constants'
import type { ScreenPoint } from './project'

/** A billboard's screen footprint. `x` is its horizontal centre, `y` its **base**. */
export interface BillboardRect {
  x: number
  y: number
  w: number
  h: number
}

/** Allocates a zeroed `BillboardRect`, for a renderer's reusable per-frame slot. */
export function createBillboardRect(): BillboardRect {
  return { x: 0, y: 0, w: 0, h: 0 }
}

/**
 * Projects one billboard onto `out` and returns it.
 *
 * `offsetX` is in road half-widths: `0` is the centreline, `1` the right-hand edge of the
 * ground strip, so scenery sits somewhere past `±1`. `height` is how far the object's base
 * floats above the ground, in **world units** — `0` for anything standing on it, which is
 * almost everything.
 *
 * **`screenWidth` scales the height too, not `screenHeight`.** That looks wrong and is not:
 * it keeps a billboard the same size *relative to the road* at every viewport aspect (the
 * road's own projected half-width is scaled by `screenWidth` in exactly the same way), and it
 * keeps the texture's own aspect ratio square. Using `screenHeight` for the vertical would
 * stretch every object in portrait and squash it in landscape. The one place `screenHeight`
 * genuinely belongs is lifting the base off the ground, which is a world-space height and so
 * shares the vertical scale `project()` itself uses.
 *
 * A consequence worth stating: `SPRITE_SCALE` is **world units per texture pixel**. A 40px
 * wide texture is 400 world units wide on the ground, against a `ROAD_WIDTH` of 2000.
 */
export function billboardRectInto(
  out: BillboardRect,
  ground: ScreenPoint,
  offsetX: number,
  height: number,
  textureWidth: number,
  textureHeight: number,
  screenWidth: number,
  screenHeight: number,
): BillboardRect {
  const scale = ground.scale
  const widthScale = (scale * screenWidth) / 2

  out.x = ground.x + widthScale * offsetX * ROAD_WIDTH
  out.y = ground.y - ((scale * height * screenHeight) / 2)
  out.w = textureWidth * widthScale * SPRITE_SCALE
  out.h = textureHeight * widthScale * SPRITE_SCALE

  return out
}

/**
 * How much of a billboard's height survives the hill in front of it, as `0..1` measured from
 * its top.
 *
 * `clipY` is the screen y below which this segment's scenery is hidden behind nearer ground —
 * see `RoadMesh.clipY`, and the comment there on why that array exists at all. A billboard
 * spans `[rect.y - rect.h, rect.y]`, so anything past `clipY` is behind the hill: without
 * this, an object standing in a dip beyond a crest shows straight through the hillside, which
 * reads as the ground being transparent rather than as a depth bug.
 *
 * Returns `0` for a billboard entirely hidden, `1` for one entirely clear.
 */
export function billboardVisibleFraction(rect: BillboardRect, clipY: number): number {
  if (!(rect.h > 0)) return 0

  const hidden = rect.y - clipY

  if (hidden <= 0) return 1
  if (hidden >= rect.h) return 0

  return 1 - hidden / rect.h
}

/**
 * Whether any of a billboard's visible part falls inside the viewport.
 *
 * Called before a pool slot is claimed, so that scenery flying off the sides at close range —
 * which is most of it, since the nearest segments project their offsets hundreds of pixels
 * beyond the screen edge — does not consume slots that a visible, farther object could use.
 */
export function billboardOnScreen(
  rect: BillboardRect,
  visibleFraction: number,
  screenWidth: number,
  screenHeight: number,
): boolean {
  if (visibleFraction <= 0) return false

  const top = rect.y - rect.h
  const bottom = top + rect.h * visibleFraction

  return rect.x + rect.w / 2 >= 0 && rect.x - rect.w / 2 <= screenWidth && bottom >= 0 && top <= screenHeight
}
