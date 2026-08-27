import * as Phaser from 'phaser'
import {
  billboardOnScreen,
  billboardRectInto,
  billboardVisibleFraction,
  createBillboardRect,
} from '../road/billboard'
import { billboardAppear, billboardFog, DRAW_DISTANCE, MAX_BILLBOARD_FOG, SPRITE_SCALE } from '../road/constants'
import type { Segment } from '../road/track'
import { createPickupTextures, PICKUP_TEXTURES } from './pickupArt'
import { WORLD_LAYER, worldDepth } from './worldDepth'
import { PICKUP_DRAW_SIZE, PICKUP_HEIGHT, type Pickup } from './pickups'

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
  key: string
  cropped: boolean
}

export class PickupSprites {
  readonly gameObjects: readonly Phaser.GameObjects.Image[]

  usedLastFrame = 0

  private readonly slots: SlotState[]
  private readonly rect = createBillboardRect()

  constructor(scene: Phaser.Scene, poolSize = PICKUP_POOL_SIZE) {
    createPickupTextures(scene)

    const initialKey = PICKUP_TEXTURES.coin

    this.slots = Array.from({ length: poolSize }, () => ({
      // Depth is set per object per frame, from distance — see `worldDepth.ts`.
      image: scene.add.image(0, 0, initialKey).setOrigin(0.5, 1).setVisible(false),
      key: initialKey,
      cropped: false,
    }))

    this.gameObjects = this.slots.map((slot) => slot.image)
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
          PICKUP_HEIGHT + bob,
          PICKUP_DRAW_SIZE / SPRITE_SCALE,
          PICKUP_DRAW_SIZE / SPRITE_SCALE,
          screenWidth,
          screenHeight,
        )
        const visible = billboardVisibleFraction(rect, clip)

        if (!billboardOnScreen(rect, visible, screenWidth, screenHeight)) continue

        this.place(this.slots[used], PICKUP_TEXTURES[pickup.kind], rect, visible, n)
        used++
      }
    }

    for (let i = used; i < previousUsed; i++) this.slots[i].image.setVisible(false)

    this.usedLastFrame = used
  }

  refreshTextures(): void {
    for (const slot of this.slots) {
      slot.key = ''
      slot.image.setVisible(false)
    }
  }

  destroy(): void {
    for (const slot of this.slots) slot.image.destroy()
  }

  private place(
    slot: SlotState,
    key: string,
    rect: { x: number; y: number; w: number; h: number },
    visibleFraction: number,
    distanceIndex: number,
  ): void {
    const image = slot.image

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
