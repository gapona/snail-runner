import * as Phaser from 'phaser'
import {
  billboardOnScreen,
  billboardRectInto,
  billboardVisibleFraction,
  createBillboardRect,
} from '../road/billboard'
import { billboardAppear, billboardFog, DRAW_DISTANCE, MAX_BILLBOARD_FOG, ROAD_WIDTH, SPRITE_SCALE } from '../road/constants'
import type { Segment } from '../road/track'
import { createObstacleTextures, obstacleTextureKey } from './obstacleArt'
import { WORLD_LAYER, worldDepth } from './worldDepth'
import { SHADOW_DARKEN, SHADOW_FOOTPRINT, shadowAlpha, shadowScale } from './shadows'
import type { Obstacle } from './obstacles'

/** What one pool slot is currently showing, so a frame can skip work it does not need. */
interface SlotState {
  image: Phaser.GameObjects.Image
  /**
   * The shadow, owned by the same slot as the sprite it belongs to.
   *
   * Only an `overhead` ever shows one: `low` and `blocking` sit on the road, and a shadow under
   * something already touching the ground is a dark rim nobody can read. Kept as a field rather
   * than a second pool for the reason `PickupSprites` states — two pools filled in the same order
   * on every frame is a desync waiting to happen, and its symptom is a shadow with no object.
   */
  shadow: Phaser.GameObjects.Ellipse
  key: string
  cropped: boolean
}

/**
 * How many obstacles may be on screen at once.
 *
 * **The pool never grows**, the same guarantee `RoadSprites` makes and for the same reason: a pool
 * that allocates on demand turns a busy moment into a texture-upload stall at exactly the moment
 * the frame is already the most expensive. At the placer's tightest spacing (8.1 segments) and
 * three obstacles a row, the 300-segment draw distance holds 37 rows — but almost all of them are
 * a few pixels tall near the horizon, and `wantedLastFrame` reports the real demand so the ceiling
 * can be checked against measurement rather than against arithmetic.
 */
export const OBSTACLE_POOL_SIZE = 48

/**
 * Every obstacle on screen, drawn from a fixed pool of `Image`s.
 *
 * **The same split the rail shooter had between `enemy.ts` and `Enemies.ts`**: the model is world
 * coordinates and pure functions, this is Phaser and nothing else. Nothing in `obstacles.ts` knows
 * a sprite exists, and nothing here decides whether anything was hit.
 *
 * **Candidates are gathered near-to-far**, so when slots run out it is the farthest obstacles that
 * go undrawn — the ones a few pixels tall by the horizon, never the boulder about to arrive.
 *
 * **Must run after `WorldView.render` in the same frame.** It reuses that pass's work twice over:
 * each segment's `s1` (the projection of the ground the obstacle stands on, already carrying the
 * integrated curvature) and its `clipY` (how much of it a nearer hill hides). Both are per-frame
 * scratch owned by the mesh.
 */
export class ObstacleSprites {
  /** Every pooled object. Callers need them for camera `ignore()` lists. */
  /**
   * Everything this pool draws, for the scene's camera `ignore` lists.
   *
   * **Shadows included, and a missed one is not an error but a duplicate** — an object left out
   * of the exclusion is drawn by the UI camera as well, which shows up as a faint second copy
   * rather than as anything that throws. Built from the same `slots` array as the sprites, so a
   * slot cannot contribute one without the other.
   */
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]

  /** Obstacles that passed culling last frame, including any the pool had no room for. */
  wantedLastFrame = 0

  /** Pool slots actually used last frame. */
  usedLastFrame = 0

  private readonly slots: SlotState[]
  private readonly rect = createBillboardRect()
  /** A second scratch rect: the shadow's own projection, taken at height zero. */
  private readonly shadowRect = createBillboardRect()

  constructor(scene: Phaser.Scene, poolSize = OBSTACLE_POOL_SIZE) {
    createObstacleTextures(scene)

    const initialKey = obstacleTextureKey('low', 0)

    this.slots = Array.from({ length: poolSize }, () => ({
      image: scene.add
        .image(0, 0, initialKey)
        // Origin at the bottom centre: a billboard is positioned by the point where it meets the
        // ground — which for an overhead is the bottom of its *band*, not the road.
        .setOrigin(0.5, 1)
        // No depth here: it is set per object per frame from how far away it is — see
        // `worldDepth.ts` for what a flat depth did to the draw order.
        .setVisible(false),
      shadow: scene.add
        .ellipse(0, 0, 1, 1, 0x000000)
        .setBlendMode(Phaser.BlendModes.MULTIPLY)
        .setVisible(false),
      key: initialKey,
      cropped: false,
    }))

    this.gameObjects = this.slots.flatMap((slot) => [slot.shadow, slot.image])
  }

  /**
   * Places every visible obstacle into the pool for this frame.
   *
   * `obstacles` is the whole run's list; this walks the *segments* rather than the list, so the
   * cost is proportional to what is on screen and not to how long the track is. That needs an
   * index from segment to obstacles, which the caller owns — see `RunScene`.
   */
  render(
    bySegment: ReadonlyMap<number, Obstacle[]>,
    track: Segment[],
    baseIndex: number,
    clipY: readonly number[],
    screenWidth: number,
    screenHeight: number,
  ): void {
    const previousUsed = this.usedLastFrame
    const capacity = this.slots.length
    let used = 0
    let wanted = 0

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const index = (baseIndex + n) % track.length
      const here = bySegment.get(index)

      if (!here || here.length === 0) continue

      const segment = track[index]
      const ground = segment.s1

      // Same guard as the mesh's: a segment sitting exactly on the camera plane projects an
      // infinite scale, which passes a naive `> 0` test and would put NaN into a position.
      if (!Number.isFinite(ground.scale) || ground.scale <= 0) continue

      const clip = clipY[n]

      for (const obstacle of here) {
        const key = obstacleTextureKey(obstacle.kind, obstacle.id)
        // The world box, converted into the texture-pixel units `billboardRectInto` wants — the
        // same conversion `PlayerView` does, and for the same reason: the drawn size has to be the
        // collision box, so the sprite can never claim ground the model does not.
        const worldWidth = obstacle.halfWidths * 2 * ROAD_WIDTH
        const worldHeight = obstacle.yHigh - obstacle.yLow

        const rect = billboardRectInto(
          this.rect,
          ground,
          obstacle.offsetX,
          // Lifted by the *bottom of its band*. For a low rock or a boulder that is zero; for an
          // overhead it is 260 world units, which is what puts the daylight under it.
          obstacle.yLow,
          worldWidth / SPRITE_SCALE,
          worldHeight / SPRITE_SCALE,
          screenWidth,
          screenHeight,
        )
        const visible = billboardVisibleFraction(rect, clip)

        if (!billboardOnScreen(rect, visible, screenWidth, screenHeight)) continue

        wanted++
        // Past capacity the loop keeps *counting* but stops drawing, so `wantedLastFrame` stays an
        // honest measure of demand. Breaking out early would report the pool as exactly big enough.
        if (used >= capacity) continue

        // Height zero, same segment, same `offsetX` -- projected rather than drawn in screen
        // coordinates, so it rides the road through a bend and over a crest.
        const shadowRect = obstacle.yLow > 0
          ? billboardRectInto(
              this.shadowRect,
              ground,
              obstacle.offsetX,
              0,
              worldWidth / SPRITE_SCALE,
              worldHeight / SPRITE_SCALE,
              screenWidth,
              screenHeight,
            )
          : null

        this.place(this.slots[used], key, rect, visible, n, (obstacle.id & 1) === 1, shadowRect, obstacle.yLow)
        used++
      }
    }

    for (let i = used; i < previousUsed; i++) {
      this.slots[i].image.setVisible(false)
      this.slots[i].shadow.setVisible(false)
    }

    this.usedLastFrame = used
    this.wantedLastFrame = wanted
  }

  /** Forgets which texture each slot shows, after a theme swap rebuilt them all. */
  refreshTextures(): void {
    for (const slot of this.slots) {
      slot.key = ''
      slot.image.setVisible(false)
      slot.shadow.setVisible(false)
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      slot.image.destroy()
      slot.shadow.destroy()
    }
  }

  /** Points one pool slot at one billboard. */
  private place(
    slot: SlotState,
    key: string,
    rect: { x: number; y: number; w: number; h: number },
    visibleFraction: number,
    distanceIndex: number,
    flipX: boolean,
    shadowRect: { x: number; y: number; w: number; h: number } | null,
    height: number,
  ): void {
    const image = slot.image

    if (shadowRect) {
      const scale = shadowScale(height)

      slot.shadow.setVisible(true)
      slot.shadow.setPosition(shadowRect.x, shadowRect.y)
      slot.shadow.setSize(
        shadowRect.w * SHADOW_FOOTPRINT.width * scale,
        shadowRect.w * SHADOW_FOOTPRINT.height * scale,
      )
      slot.shadow.setAlpha(shadowAlpha(height) * SHADOW_DARKEN)
      slot.shadow.setDepth(worldDepth(distanceIndex, WORLD_LAYER.shadow))
    } else {
      slot.shadow.setVisible(false)
    }

    if (slot.key !== key) {
      // Crops are expressed in the frame's own pixels, so one left over from the previous texture
      // would be meaningless against the new one.
      if (slot.cropped) {
        image.setCrop()
        slot.cropped = false
      }
      image.setTexture(key)
      slot.key = key
    }

    image.setVisible(true)
    image.setPosition(rect.x, rect.y)
    image.setDisplaySize(rect.w, Math.max(1, rect.h))
    // Mirroring doubles the silhouettes for free. `setFlipX` rather than a negative display size,
    // because a negative size confuses the hill crop below — the same note `RoadSprites` carries.
    image.setFlipX(flipX)
    // **Sorted with the scenery, on the scenery's own axis.** Set every frame because the distance
    // changes every frame; a depth assigned once in the constructor is what let the farthest
    // obstacle paint over the nearest.
    image.setDepth(worldDepth(distanceIndex, WORLD_LAYER.obstacle))
    // The same distance haze the verge gets. Obstacles were the one thing in the frame drawn at
    // full contrast against faded scenery, which read as pasted on rather than as standing there.
    // At the reaction distance it is a 4% fade, so it costs the read nothing — measured, not
    // assumed, because `REACTION_MS` is a floor and this is the one place that could quietly
    // undercut it.
    // Two independent terms: the haze it is seen through, and the fade it arrives with.
    // See `BILLBOARD_FADE_IN_FRACTION` for why they are not one number.
    image.setAlpha((1 - billboardFog(distanceIndex) * MAX_BILLBOARD_FOG) * billboardAppear(distanceIndex))

    // A hill in front of this segment hides the bottom of whatever stands on it. Cropping from the
    // top of the frame's worth of texture is the same trick `RoadSprites` uses — without it an
    // obstacle in a dip beyond a crest draws straight through the hillside.
    if (visibleFraction < 1) {
      // **Measured off the frame, not off the world size.** A crop rectangle is in the frame's own
      // pixels; the numbers handed to `billboardRectInto` above are world units divided by
      // `SPRITE_SCALE`. The two are unrelated, and mixing them crops to a corner of the image.
      // The crop origin is (0, 0) — the one case Phaser positions correctly, and the only one
      // needed, since a hill always hides a billboard from the bottom up.
      image.setCrop(0, 0, image.frame.realWidth, Math.max(1, Math.round(image.frame.realHeight * visibleFraction)))
      slot.cropped = true
    } else if (slot.cropped) {
      image.setCrop()
      slot.cropped = false
    }
  }
}
