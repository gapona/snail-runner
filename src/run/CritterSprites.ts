import * as Phaser from 'phaser'
import {
  billboardOnScreen,
  billboardRectInto,
  billboardVisibleFraction,
  createBillboardRect,
} from '../road/billboard'
import {
  billboardAppear,
  billboardFog,
  DRAW_DISTANCE,
  MAX_BILLBOARD_FOG,
  ROAD_WIDTH,
  SEGMENT_LENGTH,
  SPRITE_SCALE,
} from '../road/constants'
import type { Segment } from '../road/track'
import { createCritterTextures, critterFrameKey, CRITTER_STEP_UNITS } from './critterArt'
import { CRITTER_KINDS, MAX_CRITTERS, type Critter } from './critters'
import { playerGroundInto, type GroundPoint } from './playerProjection'
import { WORLD_LAYER, worldDepth } from './worldDepth'
import { SHADOW_DARKEN, SHADOW_FOOTPRINT, shadowAlpha, shadowClipFade, shadowScale } from './shadows'

/**
 * How many bugs may be drawn at once.
 *
 * **`MAX_CRITTERS` rather than a number of its own, so this pool can never refuse anything.** Every
 * other pool in the game is sized against a *measured* peak because its demand is emergent — how
 * many props a stretch of verge happens to hold, how many obstacles fall in the draw distance. The
 * population here is hard-capped by the model, so the honest ceiling is that cap, and deriving it
 * means the two cannot drift apart the way `DECOR_POOL_SIZE` and its own measured peak once did.
 */
export const CRITTER_POOL_SIZE = MAX_CRITTERS

/** What one pool slot is currently showing, so a frame can skip work it does not need. */
interface SlotState {
  image: Phaser.GameObjects.Image
  /**
   * The mark a flying critter throws on the road, owned by the same slot as the sprite.
   *
   * **This is what makes a bee read as flying rather than as floating**, and it is the cue the
   * deleted `overhead` class could never have had. That class was drawn inside a band starting 362
   * units up, so it hung in the air with nothing beneath it, and it was reported as exactly that
   * three times. A shadow is this game's one mark meaning *something is above this spot* — see
   * `shadows.ts`, and the rule that a soft dark patch on the ground may mean nothing else.
   *
   * A field on the slot rather than a second pool, for `PickupSprites`' reason: two pools filled in
   * the same order every frame is a desync waiting to happen, and its symptom is a shadow with no
   * object.
   */
  shadow: Phaser.GameObjects.Ellipse
  key: string
  cropped: boolean
}

/**
 * Every bug on screen, drawn from a fixed pool of `Image`s.
 *
 * **The same split `obstacles.ts` / `ObstacleSprites.ts` have**: the model is world coordinates and
 * pure functions, this is Phaser and nothing else. Nothing in `critters.ts` knows a sprite exists.
 *
 * **Must run after `WorldView.render` in the same frame**, and it reuses that pass twice over: each
 * segment's projected edges, and its `clipY` for the hill in front of it.
 *
 * ## ⚠ A critter is projected the way the SNAIL is, not the way an obstacle is
 *
 * `ObstacleSprites` reads `Segment.s1` — the projection of its segment's near edge — and for a rock
 * that is exact enough to be invisible: the rock is up to a segment away from the point it is drawn
 * at, and being *always* that far away, the error never changes and nothing can be seen moving.
 *
 * A bug crosses a segment boundary several times a second, so the same read gives it an error that
 * sweeps a whole segment and then snaps back — the **11.3% pop in size and screen row** that
 * `playerProjection.ts` was written for, at 2.9 boundaries a second at the critter's own speed and
 * far more once the road's own scroll is added. So this interpolates between the segment's two
 * projected edges by how far into it the critter actually is, through the same helper the snail
 * uses. That module's own note says exactly this: *anything given a position that moves relative to
 * its segment needs the same treatment.*
 */
export class CritterSprites {
  /** Everything this pool draws, for the scene's camera `ignore` lists. */
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]

  /** Critters that passed culling last frame, including any the pool had no room for. */
  wantedLastFrame = 0

  /** Pool slots actually used last frame. */
  usedLastFrame = 0

  private readonly slots: SlotState[]
  private readonly rect = createBillboardRect()
  /** A second scratch rect: a flying critter's mark, projected at height zero. */
  private readonly shadowRect = createBillboardRect()
  private readonly ground: GroundPoint = { x: 0, y: 0, w: 0, scale: 0 }

  constructor(scene: Phaser.Scene, poolSize = CRITTER_POOL_SIZE) {
    createCritterTextures(scene)

    const initialKey = critterFrameKey('beetle', 0)

    this.slots = Array.from({ length: poolSize }, () => ({
      // Bottom centre, like every other billboard: a critter is positioned by the point where its
      // own band begins — the road for a beetle, and 431 units of daylight up for a bee.
      image: scene.add.image(0, 0, initialKey).setOrigin(0.5, 1).setVisible(false),
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
   * Places every visible bug into the pool for this frame.
   *
   * **Two camera positions, because they answer different questions and neither can do the other's
   * job.** `cameraOdometer` is the run's own unwrapped distance, which is the space `critter.z`
   * lives in, so `z - cameraOdometer` is how far ahead a bug is with no wrap arithmetic anywhere —
   * the whole reason `critters.ts` keeps absolute positions. `cameraTrackZ` is the wrapped position
   * the mesh walked from, and is needed only for *where inside its segment* a point sits, which is
   * what the interpolation below is a function of.
   */
  render(
    critters: readonly Critter[],
    cameraOdometer: number,
    cameraTrackZ: number,
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
    // How far the camera stands into its own base segment. The mesh's walk starts at that
    // segment's near edge, so a bug's segment offset is measured from there and not from the camera.
    const intoBase = cameraTrackZ - Math.floor(cameraTrackZ / SEGMENT_LENGTH) * SEGMENT_LENGTH

    // **Near to far**, so if the pool ever runs short it is the specks at the horizon that go
    // undrawn rather than the bug about to arrive. The field is a handful of objects.
    const visible = [...critters].sort((a, b) => a.z - b.z)

    for (const critter of visible) {
      const ahead = critter.z - cameraOdometer
      const n = Math.floor((ahead + intoBase) / SEGMENT_LENGTH)

      if (n < 0 || n >= DRAW_DISTANCE || n >= clipY.length) continue

      const segment = track[(baseIndex + n) % track.length]

      // Same guard as the mesh's: a segment on the camera plane projects an infinite scale, which
      // passes a naive `> 0` test and writes NaN into a position.
      if (!Number.isFinite(segment.s1.scale) || segment.s1.scale <= 0) continue

      // Interpolated across the segment rather than read off its near edge — see the class note.
      // Only `worldZ`'s remainder modulo one segment is read, so the unwrapped sum is exact here.
      const ground = playerGroundInto(this.ground, segment.s1, segment.s2, cameraTrackZ + ahead)

      if (!Number.isFinite(ground.scale) || ground.scale <= 0) continue

      const worldWidth = critter.halfWidths * 2 * ROAD_WIDTH
      const worldHeight = critter.yHigh - critter.yLow
      const rect = billboardRectInto(
        this.rect,
        ground,
        critter.offsetX,
        // Lifted by the bottom of its own band: zero for a beetle, and for a bee the daylight a
        // grounded snail passes through.
        critter.yLow,
        worldWidth / SPRITE_SCALE,
        worldHeight / SPRITE_SCALE,
        screenWidth,
        screenHeight,
      )
      const fraction = billboardVisibleFraction(rect, clipY[n])

      if (!billboardOnScreen(rect, fraction, screenWidth, screenHeight)) continue

      wanted++
      // Past capacity the loop keeps counting but stops drawing, so `wantedLastFrame` stays an
      // honest measure of demand rather than reporting the pool as exactly big enough.
      if (used >= capacity) continue

      // **The leg cycle advances with the bug's OWN travel**, not with a clock and not with the
      // road: its speed is constant, so its cadence is, and a pose derived from a position cannot
      // drift out of step with where the creature is.
      const pose = Math.floor((critter.bornZ - critter.z) / CRITTER_STEP_UNITS[critter.kind])
      // **Only a flying kind throws a mark, and it is projected rather than drawn in screen
      // coordinates** — same segment, same `offsetX`, height zero — so it rides the road through a
      // bend and over a crest because it is the road's own arithmetic that placed it.
      const shadowRect = CRITTER_KINDS[critter.kind].flying
        ? billboardRectInto(
            this.shadowRect,
            ground,
            critter.offsetX,
            0,
            worldWidth / SPRITE_SCALE,
            worldHeight / SPRITE_SCALE,
            screenWidth,
            screenHeight,
          )
        : null

      // Fractional, so the depth is continuous as the bug crosses a boundary rather than stepping
      // with the segment index — the same reason the snail's own distance index is 8.25 and not 8.
      this.place(
        this.slots[used],
        critterFrameKey(critter.kind, pose),
        rect,
        fraction,
        ahead / SEGMENT_LENGTH,
        shadowRect,
        critter.yLow,
        clipY[n],
      )
      used++
    }

    for (let i = used; i < previousUsed; i++) {
      this.slots[i].image.setVisible(false)
      this.slots[i].shadow.setVisible(false)
    }

    this.usedLastFrame = used
    this.wantedLastFrame = wanted
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
    shadowRect: { x: number; y: number; w: number; h: number } | null,
    height: number,
    clip: number,
  ): void {
    const image = slot.image
    const scale = shadowScale(height)
    const markHeight = shadowRect ? shadowRect.w * SHADOW_FOOTPRINT.height * scale : 0
    // The hill clips the mark as well as the object -- a crest hides a billboard from the bottom up,
    // so the ground under a bee is the LAST part of it to come out from behind the ridge.
    const clipped = shadowRect ? shadowClipFade(shadowRect.y, markHeight, clip) : 0

    if (shadowRect && clipped > 0) {
      slot.shadow.setVisible(true)
      slot.shadow.setPosition(shadowRect.x, shadowRect.y)
      slot.shadow.setSize(shadowRect.w * SHADOW_FOOTPRINT.width * scale, markHeight)
      slot.shadow.setAlpha(shadowAlpha(height) * SHADOW_DARKEN * clipped)
      slot.shadow.setDepth(worldDepth(distanceIndex, WORLD_LAYER.shadow))
    } else {
      slot.shadow.setVisible(false)
    }

    if (slot.key !== key) {
      // A crop is in the frame's own pixels, so one left over from another texture is meaningless
      // against this one.
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
    // Set every frame, because the distance changes every frame — see `worldDepth.ts` for what a
    // depth assigned once in a constructor did to the obstacle pool.
    image.setDepth(worldDepth(distanceIndex, WORLD_LAYER.critter))
    // The same two terms every billboard carries: the haze it is seen through, and the fade it
    // arrives with. A critter is *born* at the draw distance, so the second one is what stops it
    // being seen appearing.
    image.setAlpha((1 - billboardFog(distanceIndex) * MAX_BILLBOARD_FOG) * billboardAppear(distanceIndex))

    if (visibleFraction < 1) {
      // Measured off the frame, never off the world size, and from (0, 0) — a hill always hides a
      // billboard from the bottom up, which is the one crop origin Phaser positions correctly.
      image.setCrop(0, 0, image.frame.realWidth, Math.max(1, Math.round(image.frame.realHeight * visibleFraction)))
      slot.cropped = true
    } else if (slot.cropped) {
      image.setCrop()
      slot.cropped = false
    }
  }
}
