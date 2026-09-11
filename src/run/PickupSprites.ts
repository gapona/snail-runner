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
import { distanceIndexOf, WORLD_LAYER, worldDepth } from './worldDepth'
import {
  PICKUP_BOB,
  PICKUP_POOL_SIZE,
  PICKUP_SHADOW_LINK,
  pickupDrawWidth,
  UNAVAILABLE_ALPHA,
  type Pickup,
  type PickupKind,
} from './pickups'
import {
  SHADOW_DARKEN,
  SHADOW_FOOTPRINT,
  shadowAlpha,
  shadowClipFade,
  shadowLinkFade,
  shadowScale,
} from './shadows'
import { groundPointInto, type GroundPoint } from './groundProjection'
import { createShadow } from './shadowArt'
import { hidePooled, showPooled } from './pooled'
import { setArt } from '../art/atlas'

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
export { PICKUP_POOL_SIZE }

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
  shadow: Phaser.GameObjects.Image
  key: string
  cropped: boolean
}

const EMPTY_KINDS: ReadonlySet<PickupKind> = new Set()

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

  /**
   * Pickups that passed culling last frame, **including any the pool had no room for.**
   *
   * The counter this pool did not have, and the reason it was 24 against a demand of 47 for years:
   * a pool that stops counting when it stops drawing reports its own size back as the demand.
   */
  wantedLastFrame = 0

  private readonly slots: SlotState[]
  /** Which shadow belongs to which object this frame, for the DEV mark overlay. */
  readonly shadowMarks: { x: number; y: number; owner: string }[] = []

  private readonly rect = createBillboardRect()
  /** The interpolated ground point, reused per object. */
  private readonly ground: GroundPoint = { x: 0, y: 0, w: 0, scale: 0 }
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
      // An `Image` on the shared ellipse texture — see `shadowArt.ts`. This pool draws the most
      // shadows of the three, and was paying a 64-point tessellation plus an `Earcut` for each of
      // them on every frame.
      shadow: createShadow(scene),
      key: initialKey,
      cropped: false,
    }))

    this.gameObjects = this.slots.flatMap((slot) => [slot.shadow, slot.image])
    // **Off the display list from the moment they exist.** A pool hides what it *stopped* using by
    // walking from `used` to last frame's count, and a slot that has never been used is on no such
    // walk — so without this the slack sits in the scene's list for its whole life, iterated twice a
    // frame by the two cameras for nothing. See `pooled.ts`.
    for (const slot of this.slots) {
      hidePooled(slot.image)
      hidePooled(slot.shadow)
    }

  }

  render(
    bySegment: ReadonlyMap<number, Pickup[]>,
    track: Segment[],
    baseIndex: number,
    clipY: readonly number[],
    screenWidth: number,
    screenHeight: number,
    now: number,
    /**
     * Kinds the run has no room for — drawn dimmed rather than taken off the road.
     *
     * **Passed in rather than read here**, because it is a fact about the run and this class knows
     * only how to draw. See `UNAVAILABLE_ALPHA` for the round in which these were deleted instead
     * and what that cost.
     */
    useless: ReadonlySet<PickupKind> = EMPTY_KINDS,
  ): void {
    const previousUsed = this.usedLastFrame
    const capacity = this.slots.length
    let used = 0
    let wanted = 0

    if (import.meta.env.DEV) this.shadowMarks.length = 0

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const index = (baseIndex + n) % track.length
      const here = bySegment.get(index)

      if (!here || here.length === 0) continue

      const segment = track[index]

      if (!Number.isFinite(segment.s1.scale) || segment.s1.scale <= 0) continue

      const clip = clipY[n]

      for (const pickup of here) {
        // **⚠ Interpolated across the segment, not read off its near edge** — see
        // `groundProjection.ts`. `Segment.s1` is exact for a tree, which stands *at* that edge;
        // this stands at its own `z` anywhere inside the segment, so drawing it from `s1` put the
        // sprite and the world position up to one `SEGMENT_LENGTH` apart in depth.
        const ground = groundPointInto(this.ground, segment.s1, segment.s2, pickup.z)
        // Where it stands INSIDE its segment -- see `distanceIndexOf`.
        const distanceIndex = distanceIndexOf(n, pickup.z)
        if (pickup.taken) continue

        // The bob is in world units, not screen pixels -- see `PICKUP_BOB`.
        const height = pickup.y + Math.sin(now / 260 + pickup.id) * PICKUP_BOB

        // **Bigger on a narrow frame, and only a pickup may be** — see `readableScale` for why the
        // catchment box is what makes that free here and impossible for anything else, and
        // `PICKUP_MAX_ICON_SHARE` for the bound the boost had been missing: unbounded it drew the
        // icon at 95% of that box on a phone, which is the coin-the-size-of-the-road failure
        // `PICKUP_DRAW_SIZE` exists to prevent.
        const drawn = pickupDrawWidth(screenWidth)
        const rect = billboardRectInto(
          this.rect,
          ground,
          pickup.offsetX,
          height,
          drawn / SPRITE_SCALE,
          drawn / SPRITE_SCALE,
          screenWidth,
          screenHeight,
        )
        const visible = billboardVisibleFraction(rect, clip)

        if (!billboardOnScreen(rect, visible, screenWidth, screenHeight)) continue

        wanted++
        // Past capacity the loop keeps *counting* and stops drawing, so `wantedLastFrame` stays an
        // honest measure of demand. The old `used >= capacity` guard sat before the cull and simply
        // skipped, which is why nobody could see the pool was half the size it needed to be.
        if (used >= capacity) continue

        // **Only a pickup near the road casts a shadow** -- see `PICKUP_SHADOW_LINK`. An arc chain
        // is laid along a ramp flight, so its members sit hundreds of units up and their marks
        // land most of a screen below them, where the pair stops reading as a pair at all.
        const link = shadowLinkFade(height, PICKUP_SHADOW_LINK.full, PICKUP_SHADOW_LINK.gone)
        // **The shadow is projected, not drawn as a screen-space circle**, and it is projected
        // from the same `ground` point the sprite was — same segment, same `offsetX`, height
        // zero. So on a climb and through a bend it rides the road, because it is the road's own
        // arithmetic that placed it.
        const shadowRect =
          link > 0
            ? billboardRectInto(
                this.shadowRect,
                ground,
                pickup.offsetX,
                0,
                // The mark takes the icon's *drawn* width, not the authored one: on a narrow
                // frame the icon is boosted and a shadow left at the base size would be a mark
                // narrower than the thing casting it.
                drawn / SPRITE_SCALE,
                drawn / SPRITE_SCALE,
                screenWidth,
                screenHeight,
              )
            : null

        this.place(
          this.slots[used],
          pickupTexture(pickup),
          rect,
          visible,
          distanceIndex,
          shadowRect,
          height,
          link,
          clip,
          useless.has(pickup.kind) ? UNAVAILABLE_ALPHA : 1,
        )
        if (import.meta.env.DEV && this.slots[used].shadow.visible) {
          this.shadowMarks.push({ x: this.slots[used].shadow.x, y: this.slots[used].shadow.y, owner: `pickup#${pickup.id}` })
        }
        used++
      }
    }

    for (let i = used; i < previousUsed; i++) {
      hidePooled(this.slots[i].image)
      hidePooled(this.slots[i].shadow)
    }

    this.usedLastFrame = used
    this.wantedLastFrame = wanted
  }

  refreshTextures(): void {
    for (const slot of this.slots) {
      slot.key = ''
      hidePooled(slot.image)
      hidePooled(slot.shadow)
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
    shadowRect: { x: number; y: number; w: number; h: number } | null,
    height: number,
    link: number,
    clip: number,
    available: number,
  ): void {
    const image = slot.image

    // Hard-edged ellipse, sized off the same footprint the sprite is drawn at, widening and
    // weakening with height -- see `shadows.ts` for why those two pull against each other.
    const scale = shadowScale(height)
    const markHeight = shadowRect ? shadowRect.w * SHADOW_FOOTPRINT.height * scale : 0
    // **The hill clips the mark as well as the object** -- see `shadowClipFade`. Tested at the
    // ellipse's centre, which is the ground point, because that is what a crest either covers or
    // does not.
    const clipped = shadowRect ? shadowClipFade(shadowRect.y, markHeight, clip) : 0

    if (shadowRect && clipped > 0) {
      showPooled(slot.shadow)
      slot.shadow.setPosition(shadowRect.x, shadowRect.y)
      slot.shadow.setDisplaySize(shadowRect.w * SHADOW_FOOTPRINT.width * scale, markHeight)
      // The mark dims with the icon: a full-strength shadow under a greyed pickup reads as the
      // sprite failing to draw rather than as the pickup being inert — the same pairing the
      // mascot's blink makes with its own shadow.
      slot.shadow.setAlpha(shadowAlpha(height) * SHADOW_DARKEN * link * clipped * available)
      slot.shadow.setDepth(worldDepth(distanceIndex, WORLD_LAYER.shadow))
    } else {
      hidePooled(slot.shadow)
    }

    if (slot.key !== key) {
      if (slot.cropped) {
        image.setCrop()
        slot.cropped = false
      }
      setArt(image, key)
      slot.key = key
    }

    showPooled(image)
    image.setPosition(rect.x, rect.y)
    image.setDisplaySize(rect.w, Math.max(1, rect.h))
    // A pickup wins a tie against an obstacle on the same segment — it is the small bright thing
    // that must not be swallowed by the boulder beside it — but loses to anything nearer.
    image.setDepth(worldDepth(distanceIndex, WORLD_LAYER.pickup))
    // Two independent terms: the haze it is seen through, and the fade it arrives with.
    // See `BILLBOARD_FADE_IN_FRACTION` for why they are not one number.
    image.setAlpha((1 - billboardFog(distanceIndex) * MAX_BILLBOARD_FOG) * billboardAppear(distanceIndex) * available)

    if (visibleFraction < 1) {
      image.setCrop(0, 0, image.frame.realWidth, Math.max(1, Math.round(image.frame.realHeight * visibleFraction)))
      slot.cropped = true
    } else if (slot.cropped) {
      image.setCrop()
      slot.cropped = false
    }
  }
}
