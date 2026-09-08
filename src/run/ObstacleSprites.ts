import * as Phaser from 'phaser'
import {
  billboardOnScreen,
  billboardRectInto,
  billboardVisibleFraction,
  createBillboardRect,
} from '../road/billboard'
import { billboardAppear, billboardFog, DRAW_DISTANCE, MAX_BILLBOARD_FOG, ROAD_WIDTH, SPRITE_SCALE } from '../road/constants'
import type { Segment } from '../road/track'
import { createObstacleTextures, obstacleDrawKey } from './obstacleArt'
import { distanceIndexOf, WORLD_LAYER, worldDepth } from './worldDepth'
import { SHADOW_DARKEN, SHADOW_FOOTPRINT, shadowAlpha, shadowClipFade, shadowScale } from './shadows'
import { OBSTACLE_POOL_SIZE, type Obstacle } from './obstacles'
import { groundPointInto, type GroundPoint } from './groundProjection'
import { createShadow } from './shadowArt'

/** What one pool slot is currently showing, so a frame can skip work it does not need. */
interface SlotState {
  image: Phaser.GameObjects.Image
  /**
   * The shadow, owned by the same slot as the sprite it belongs to.
   *
   * **⚠ Nothing casts one today, and the condition is kept rather than the code deleted.** The rule
   * is `yLow > 0` — an obstacle standing off the road throws a mark on it — and the only class that
   * ever did was `overhead`, which is gone. `low` and `blocking` sit on the road, and a shadow
   * under something already touching the ground is a dark rim nobody can read. The branch is three
   * lines, evaluates false, and is what any future floating class would need; `verify:obstacles`
   * asserts every band starts at zero, so it cannot go stale unnoticed.
   *
   * Kept as a field rather than a second pool for the reason `PickupSprites` states — two pools
   * filled in the same order on every frame is a desync waiting to happen, and its symptom is a
   * shadow with no object.
   */
  shadow: Phaser.GameObjects.Image
  key: string
  cropped: boolean
}

export { OBSTACLE_POOL_SIZE }

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
  /** Which shadow belongs to which object this frame, for the DEV mark overlay. */
  readonly shadowMarks: { x: number; y: number; owner: string }[] = []

  /**
   * DEV only: what was drawn this frame and at what alpha, and what the pool refused.
   *
   * **The honesty bug is about the moment a hazard is DRAWN, and only the renderer knows that.**
   * The model's spawn distance is a different number and is what the existing reaction check
   * measures -- which is why that check is green while a player is being hit by something they
   * never saw. Empty in a production build.
   */
  readonly drawnIds: { id: number; alpha: number; distanceIndex: number }[] = []
  readonly refusedIds: number[] = []

  private readonly rect = createBillboardRect()
  /** A second scratch rect: the shadow's own projection, taken at height zero. */
  private readonly shadowRect = createBillboardRect()
  /** The interpolated ground point, reused per obstacle. */
  private readonly ground: GroundPoint = { x: 0, y: 0, w: 0, scale: 0 }

  constructor(scene: Phaser.Scene, poolSize = OBSTACLE_POOL_SIZE) {
    createObstacleTextures(scene)

    const initialKey = obstacleDrawKey('low', 0)

    this.slots = Array.from({ length: poolSize }, () => ({
      image: scene.add
        .image(0, 0, initialKey)
        // Origin at the bottom centre: a billboard is positioned by the point where it meets the
        // ground — which for an overhead is the bottom of its *band*, not the road.
        .setOrigin(0.5, 1)
        // No depth here: it is set per object per frame from how far away it is — see
        // `worldDepth.ts` for what a flat depth did to the draw order.
        .setVisible(false),
      // An `Image` on the shared ellipse texture — see `shadowArt.ts` for the per-frame
      // tessellation an `Ellipse` charges for a mark whose size changes every frame.
      shadow: createShadow(scene),
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

    if (import.meta.env.DEV) {
      this.shadowMarks.length = 0
      this.drawnIds.length = 0
      this.refusedIds.length = 0
    }
    let wanted = 0

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const index = (baseIndex + n) % track.length
      const here = bySegment.get(index)

      if (!here || here.length === 0) continue

      const segment = track[index]

      // Same guard as the mesh's: a segment sitting exactly on the camera plane projects an
      // infinite scale, which passes a naive `> 0` test and would put NaN into a position.
      if (!Number.isFinite(segment.s1.scale) || segment.s1.scale <= 0) continue

      const clip = clipY[n]

      for (const obstacle of here) {
      // **⚠ Interpolated across the segment, not read off its near edge.** `Segment.s1` is exact for
      // a tree, which stands *at* that edge; this stands at its own `z`, anywhere inside the
      // segment, so drawing it from `s1` meant the sprite and the collision box were reasoning
      // about depths up to one `SEGMENT_LENGTH` apart — and a lateral offset projects through that
      // depth. Measured before the fix: up to **0.095 road half-widths** of lateral error at the
      // road's edge, 0.76 of the snail's own half-width. See `groundProjection.ts`.
        const ground = groundPointInto(this.ground, segment.s1, segment.s2, obstacle.z)
        // Where it stands INSIDE its segment, not which segment it stands on -- see
        // `distanceIndexOf`, and the bug a bare `n` here put a bee through a barrier with.
        const distanceIndex = distanceIndexOf(n, obstacle.z)

        const key = obstacleDrawKey(obstacle.kind, obstacle.id)
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
        if (used >= capacity) {
          if (import.meta.env.DEV) this.refusedIds.push(obstacle.id)
          continue
        }

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

        this.place(
          this.slots[used],
          key,
          rect,
          visible,
          distanceIndex,
          (obstacle.id & 1) === 1,
          shadowRect,
          obstacle.yLow,
          clip,
        )
        if (import.meta.env.DEV) {
          this.drawnIds.push({
            id: obstacle.id,
            alpha: this.slots[used].image.alpha,
            distanceIndex,
          })
        }
        if (import.meta.env.DEV && this.slots[used].shadow.visible) {
          this.shadowMarks.push({
            x: this.slots[used].shadow.x,
            y: this.slots[used].shadow.y,
            owner: `${obstacle.kind}#${obstacle.id}`,
          })
        }
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
    clip: number,
  ): void {
    const image = slot.image

    const scale = shadowScale(height)
    const markHeight = shadowRect ? shadowRect.w * SHADOW_FOOTPRINT.height * scale : 0
    // **The hill clips the mark as well as the object** -- see `shadowClipFade`. A crest hides a
    // billboard from the bottom up, so the ground under an overhead is the LAST part of it to
    // come out from behind the ridge, and it was the only part never clipped at all.
    const clipped = shadowRect ? shadowClipFade(shadowRect.y, markHeight, clip) : 0

    if (shadowRect && clipped > 0) {
      slot.shadow.setVisible(true)
      slot.shadow.setPosition(shadowRect.x, shadowRect.y)
      slot.shadow.setDisplaySize(shadowRect.w * SHADOW_FOOTPRINT.width * scale, markHeight)
      slot.shadow.setAlpha(shadowAlpha(height) * SHADOW_DARKEN * clipped)
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
