import * as Phaser from 'phaser'
import {
  billboardOnScreen,
  billboardRectInto,
  billboardVisibleFraction,
  createBillboardRect,
} from '../road/billboard'
import { billboardAppear, billboardFog, DRAW_DISTANCE, MAX_BILLBOARD_FOG, SPRITE_SCALE } from '../road/constants'
import type { Segment } from '../road/track'
import { createPickupTextures, PICKUP_TEXTURES, pickupTexture } from './pickupArt'
import { WORLD_LAYER, worldDepth } from './worldDepth'
import { PICKUP_DRAW_SIZE, type Pickup } from './pickups'
import { SHADOW_DARKEN, SHADOW_FOOTPRINT, shadowAlpha, shadowScale } from './shadows'

/**
 * Every pickup on screen, from a fixed pool.
 *
 * The same shape as `ObstacleSprites` and for the same reasons — near-to-far gathering, a pool
 * that never grows, and a hard requirement to run *after* `WorldView.render` so it can read this
 * frame's segment projections and hill clips out of the mesh pass.
 *
 * Smaller pool: pickups are laid every fourteen segments against the obstacles' eight, and only
 * one at a time.
 */
export const PICKUP_POOL_SIZE = 24

interface SlotState {
  image: Phaser.GameObjects.Image
  /**
   * The shadow this pickup casts, owned by the same slot as the sprite.
   *
   * **⚠ One slot, two objects — deliberately not a second pool.** A separate shadow pool has to
   * be filled in the same order, to the same length, with the same skips, on every frame; the
   * first thing that goes wrong with one is a shadow left under an object that is no longer there
   * and an object with no shadow at all, which is precisely what was reported. Making the shadow a
   * field of the slot makes that desync unrepresentable: whatever hides the sprite hides its
   * shadow, and whatever places one places the other.
   */
  shadow: Phaser.GameObjects.Ellipse
  key: string
  cropped: boolean
}

export class PickupSprites {
  /**
   * Everything this pool draws, for the scene's camera `ignore` lists.
   *
   * **Shadows included, and a missed one is not an error but a duplicate** — an object left out
   * of the exclusion is drawn by the UI camera as well, which shows up as a faint second copy
   * rather than as anything that throws. Built from the same `slots` array as the sprites, so a
   * slot cannot contribute one without the other.
   */
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]

  usedLastFrame = 0

  private readonly slots: SlotState[]
  /** Which shadow belongs to which object this frame, for the DEV mark overlay. */
  readonly shadowMarks: { x: number; y: number; owner: string }[] = []

  private readonly rect = createBillboardRect()
  /** A second scratch rect: the shadow's own projection, taken at height zero. */
  private readonly shadowRect = createBillboardRect()

  constructor(scene: Phaser.Scene, poolSize = PICKUP_POOL_SIZE) {
    createPickupTextures(scene)

    const initialKey = PICKUP_TEXTURES.coin[0]

    this.slots = Array.from({ length: poolSize }, () => ({
      // Depth is set per object per frame, from distance — see `worldDepth.ts`.
      image: scene.add.image(0, 0, initialKey).setOrigin(0.5, 1).setVisible(false),
      // Multiply rather than a grey fill: see `SHADOW_DARKEN`. The colour is pure black at a
      // fraction of alpha, so what reaches the screen is the ground's own colour taken down.
      shadow: scene.add
        .ellipse(0, 0, 1, 1, 0x000000)
        .setBlendMode(Phaser.BlendModes.MULTIPLY)
        .setVisible(false),
      key: initialKey,
      cropped: false,
    }))

    this.gameObjects = this.slots.flatMap((slot) => [slot.shadow, slot.image])
  }

  render(
    bySegment: ReadonlyMap<number, Pickup[]>,
    track: Segment[],
    baseIndex: number,
    clipY: readonly number[],
    screenWidth: number,
    screenHeight: number,
    now: number,
  ): void {
    const previousUsed = this.usedLastFrame
    const capacity = this.slots.length
    let used = 0

    if (import.meta.env.DEV) this.shadowMarks.length = 0

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const index = (baseIndex + n) % track.length
      const here = bySegment.get(index)

      if (!here || here.length === 0) continue

      const ground = track[index].s1

      if (!Number.isFinite(ground.scale) || ground.scale <= 0) continue

      const clip = clipY[n]

      for (const pickup of here) {
        if (pickup.taken || used >= capacity) continue

        // **The bob is in world units, not screen pixels.** A pixel bob would be a huge motion at
        // the near end of the road and invisible at the far end; a world bob is the same 40 units
        // everywhere and shrinks with distance exactly as the sprite does.
        const bob = Math.sin(now / 260 + pickup.id) * 22

        const rect = billboardRectInto(
          this.rect,
          ground,
          pickup.offsetX,
          pickup.y + bob,
          PICKUP_DRAW_SIZE / SPRITE_SCALE,
          PICKUP_DRAW_SIZE / SPRITE_SCALE,
          screenWidth,
          screenHeight,
        )
        const visible = billboardVisibleFraction(rect, clip)

        if (!billboardOnScreen(rect, visible, screenWidth, screenHeight)) continue

        // **The shadow is projected, not drawn as a screen-space circle**, and it is projected
        // from the same `ground` point the sprite was — same segment, same `offsetX`, height
        // zero. So on a climb and through a bend it rides the road, because it is the road's own
        // arithmetic that placed it.
        const shadowRect = billboardRectInto(
          this.shadowRect,
          ground,
          pickup.offsetX,
          0,
          PICKUP_DRAW_SIZE / SPRITE_SCALE,
          PICKUP_DRAW_SIZE / SPRITE_SCALE,
          screenWidth,
          screenHeight,
        )

        this.place(this.slots[used], pickupTexture(pickup), rect, visible, n, shadowRect, pickup.y + bob)
        if (import.meta.env.DEV) {
          this.shadowMarks.push({ x: shadowRect.x, y: shadowRect.y, owner: `pickup#${pickup.id}` })
        }
        used++
      }
    }

    for (let i = used; i < previousUsed; i++) {
      this.slots[i].image.setVisible(false)
      this.slots[i].shadow.setVisible(false)
    }

    this.usedLastFrame = used
  }

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

  private place(
    slot: SlotState,
    key: string,
    rect: { x: number; y: number; w: number; h: number },
    visibleFraction: number,
    distanceIndex: number,
    shadowRect: { x: number; y: number; w: number; h: number },
    height: number,
  ): void {
    const image = slot.image

    // Hard-edged ellipse, sized off the same footprint the sprite is drawn at, widening and
    // weakening with height -- see `shadows.ts` for why those two pull against each other.
    const scale = shadowScale(height)

    slot.shadow.setVisible(true)
    slot.shadow.setPosition(shadowRect.x, shadowRect.y)
    slot.shadow.setSize(shadowRect.w * SHADOW_FOOTPRINT.width * scale, shadowRect.w * SHADOW_FOOTPRINT.height * scale)
    slot.shadow.setAlpha(shadowAlpha(height) * SHADOW_DARKEN)
    slot.shadow.setDepth(worldDepth(distanceIndex, WORLD_LAYER.shadow))

    if (slot.key !== key) {
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
    // A pickup wins a tie against an obstacle on the same segment — it is the small bright thing
    // that must not be swallowed by the boulder beside it — but loses to anything nearer.
    image.setDepth(worldDepth(distanceIndex, WORLD_LAYER.pickup))
    // Two independent terms: the haze it is seen through, and the fade it arrives with.
    // See `BILLBOARD_FADE_IN_FRACTION` for why they are not one number.
    image.setAlpha((1 - billboardFog(distanceIndex) * MAX_BILLBOARD_FOG) * billboardAppear(distanceIndex))

    if (visibleFraction < 1) {
      image.setCrop(0, 0, image.frame.realWidth, Math.max(1, Math.round(image.frame.realHeight * visibleFraction)))
      slot.cropped = true
    } else if (slot.cropped) {
      image.setCrop()
      slot.cropped = false
    }
  }
}
