import * as Phaser from 'phaser'
import { BIOMES, biomeIndexForSegment, themedProp } from './biomes'

import {
  billboardOnScreen,
  billboardVisibleFraction,
  billboardRectInto,
  createBillboardRect,
} from './billboard'
import { tintFor, variationFor, type DecorVariation } from './decorVariation'
import {
  billboardAppear,
  billboardFog,
  DECOR_SINK_FRACTION,
  DECOR_TIERS,
  DRAW_DISTANCE,
  decorFog,
  decorFogCeiling,
} from './constants'
import { isDecorArt, type DecorTexture } from './decor'
import { sceneryDepth } from '../run/worldDepth'
import { getRoadTheme } from './themes'
import type { RoadSprite, Segment } from './track'
import { hidePooled, showPooled } from '../run/pooled'
import { addArtImage, setArt } from '../art/atlas'

/** What one pool slot is currently showing, so a frame can skip work it does not need. */
interface SlotState {
  image: Phaser.GameObjects.Image
  key: string
  cropped: boolean
}

/**
 * Every billboard on screen, drawn from a fixed pool of `Image`s.
 *
 * **The pool never grows.** Its size is decided once, in the constructor, and if a frame wants
 * more objects than there are slots the extras simply are not drawn. That is a deliberate
 * guarantee, not a limitation to be fixed later: a pool that grows on demand turns a busy
 * moment into an allocation spike and a texture-upload stall at exactly the moment the frame
 * is already the most expensive, and it does so unpredictably, which makes the frame budget
 * unmeasurable. `wantedLastFrame` reports the demand so the ceiling can be checked against
 * reality (`RailScene`'s DEV `__decorPerf` report) rather than assumed.
 *
 * **Candidates are gathered near-to-far**, so when slots do run out it is the *farthest*
 * objects that go undrawn — the ones a few pixels tall near the horizon, rather than the
 * building-sized one about to pass the camera.
 *
 * **Must run after `RoadMesh.render` in the same frame.** It reuses that pass's work twice
 * over: each segment's `s1` (the projection of the ground the billboard stands on, which
 * already carries the integrated curvature — recomputing it here would mean redoing a
 * stateful accumulation and getting a subtly different road) and its `clipY` (how much of
 * this segment a nearer hill hides). Both are per-frame scratch owned by the mesh.
 */

export class RoadSprites {
  /** Every pooled object. Callers need them for camera `ignore()` lists. */
  readonly gameObjects: readonly Phaser.GameObjects.Image[]

  /** Billboards that passed culling last frame, including any the pool had no room for. */
  wantedLastFrame = 0

  /** Pool slots actually used last frame — never more than `gameObjects.length`. */
  usedLastFrame = 0

  private readonly slots: SlotState[]
  private readonly sizes: Map<string, DecorTexture>
  private readonly rect = createBillboardRect()

  /**
   * Which slots show loaded art, decided once — the loader has long finished by the time this
   * scene is constructed, and nothing adds decor textures afterwards.
   */
  private readonly artKeys: Set<string>

  /**
   * What each biome's props are drawn in this frame: its own colour times the theme's light.
   *
   * One entry per biome, recomputed once per frame rather than per sprite — eight multiplies against
   * up to ninety draws. Recomputed *every* frame rather than cached across them for the same reason
   * the theme tint always was: a theme switch replaces the whole object, and a value captured once
   * keeps painting the light of a theme the player has left.
   */
  private readonly biomeTints: number[] = BIOMES.map(() => 0xffffff)
  /** The theme `biomeTints` was last built from, by identity. `null` until the first render. */
  private tintedTheme: ReturnType<typeof getRoadTheme> | null = null

  /**
   * What each prop is drawn as, cached against the record it belongs to.
   *
   * **The same finding as `biomeTints`, one level in.** That check stopped nine `themedProp` calls
   * a frame; this stops one `tintFor` *per drawn prop* — another OKLab round trip each, 143 of them
   * on a busy frame, to recompute a colour from a hash of the segment index, the side and the prop
   * id. None of those move. `variationFor` is cached with it because it is the input: it allocates
   * a record and six hashed numbers, and it is asked the same question about the same prop sixty
   * times a second.
   *
   * Keyed on the `RoadSprite` record, which `decorateTrack` creates one of per placement and never
   * replaces — so the key carries the segment, the side, the prop and therefore the biome, and a
   * prop cannot collide with another. A `WeakMap` rather than a `Map` because the track it is
   * keyed on is replaced wholesale when a scene rebuilds its world, and nothing here would know to
   * evict the old one.
   *
   * Thrown away by identity on a theme swap, exactly as `biomeTints` is rebuilt: the tint is a
   * function of the theme, and a stale one would go on painting the light the player has left.
   */
  private looks = new WeakMap<RoadSprite, { variation: DecorVariation; tint: number }>()

  constructor(scene: Phaser.Scene, poolSize: number, textures: readonly DecorTexture[]) {
    if (textures.length === 0) {
      throw new Error('RoadSprites: needs at least one texture to pool')
    }

    this.sizes = new Map(textures.map((texture) => [texture.key, texture]))
    this.artKeys = new Set(textures.map((t) => t.key).filter((key) => isDecorArt(scene, key)))

    const initialKey = textures[0].key

    this.slots = Array.from({ length: poolSize }, () => ({
      image: addArtImage(scene, initialKey)
        // Origin at the bottom centre: a billboard is positioned by the point where it meets
        // the ground, which is what the projection gives us.
        .setOrigin(0.5, 1)
        .setVisible(false),
      // Empty, never `initialKey`: see `art/atlas.ts`'s `addArtImage` for what a primed cache drew.
      key: '',
      cropped: false,
    }))

    this.gameObjects = this.slots.map((slot) => slot.image)
    // **Off the display list from the moment they exist.** A pool hides what it *stopped* using by
    // walking from `used` to last frame's count, and a slot that has never been used is on no such
    // walk — so without this the slack sits in the scene's list for its whole life, iterated twice a
    // frame by the two cameras for nothing. See `pooled.ts`.
    for (const slot of this.slots) hidePooled(slot.image)

  }

  /**
   * Places every visible billboard into the pool for this frame.
   *
   * `baseIndex` and `clipY` both come from the `RoadMesh` render that must already have run —
   * see the class docstring.
   */
  render(track: Segment[], baseIndex: number, clipY: readonly number[], screenWidth: number, screenHeight: number): void {
    const previousUsed = this.usedLastFrame
    const capacity = this.slots.length
    let used = 0
    let wanted = 0

    // Read through the getter every frame, never captured once: a theme switch replaces the
    // whole object, and a captured value would keep painting the previous theme's light.
    const theme = getRoadTheme()

    // **⚠ Rebuilt when the theme object changes, not on every frame.** `themedProp` is two
    // `treatColour` calls, and each is an OKLab round trip — three cube roots out and three cubes
    // back, plus two matrix multiplies — so this was eighteen of them a frame to recompute nine
    // colours from constants that only move when somebody buys a theme. The identity check is what
    // keeps the getter's own guarantee intact: `applyTheme` replaces the whole object, so a new
    // theme can never be missed, and nothing mutates one in place.
    if (this.tintedTheme !== theme) {
      this.tintedTheme = theme
      // Every cached prop colour was mixed from the outgoing theme's light. A `WeakMap` has no
      // `clear`, and replacing it is the honest operation anyway: what is wanted is a new cache.
      this.looks = new WeakMap()

      for (const [index, biome] of BIOMES.entries()) {
        // The theme lights the prop and rotates it; the biome keeps the hue relationships that make
        // it a place. A plain multiply did both jobs with one operation and lost the second — see
        // `themedProp`.
        this.biomeTints[index] = themedProp(biome.decorTint, theme.decorTint, theme.propChroma, theme.propHue)
      }
    }

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const segment = track[(baseIndex + n) % track.length]

      if (segment.sprites.length === 0) continue

      // **Per segment, not per frame.** Biomes run along the track, so two of them are on screen at
      // once at every boundary — a single tint for the whole frame would paint the forest in the
      // dunes' sand for the six seconds either side of the seam.
      const tint = this.biomeTints[biomeIndexForSegment(segment.index, track.length)]

      const ground = segment.s1

      // Same guard as the mesh's, and for the same reason: a segment sitting exactly on the
      // camera plane projects an infinite scale, which passes a naive `> 0` test and would
      // put NaN into a sprite's position rather than being culled.
      if (!Number.isFinite(ground.scale) || ground.scale <= 0) continue

      const clip = clipY[n]

      for (const [spriteIndex, sprite] of segment.sprites.entries()) {
        const texture = this.sizes.get(sprite.key)

        if (!texture) continue

        const rect = billboardRectInto(
          this.rect,
          ground,
          sprite.offsetX,
          // Planted slightly into the ground rather than exactly on it — see
          // `DECOR_SINK_FRACTION` for why the bias is one-directional.
          sprite.height - texture.height * DECOR_SINK_FRACTION,
          texture.width,
          texture.height,
          screenWidth,
          screenHeight,
        )
        // **The instance's own look, derived from where it stands.** Not stored on the sprite
        // record and not rolled here: `variationFor` is a pure function of the coordinate, so the
        // same prop on the same segment is the same object on every lap and at every screen size —
        // which is exactly why the answer is worth keeping. See `looks`.
        let look = this.looks.get(sprite)

        if (look === undefined) {
          const variation = variationFor(segment.index, Math.sign(sprite.offsetX), sprite.key)

          // The biome's colour under the theme's light, moved for this instance. Computed once per
          // prop per theme rather than once per prop per frame; it is a hue rotation in OKLab, and
          // nothing that goes into it changes between frames.
          look = { variation, tint: tintFor(tint, variation) }
          this.looks.set(sprite, look)
        }

        const variation = look.variation

        // **⚠ THE DRAWN SIZE IS RESOLVED HERE, BEFORE ANYTHING REASONS ABOUT THE RECTANGLE.**
        // Both scales used to be applied inside `place`, i.e. after the clip, the on-screen test
        // and the crop had already been computed — so all three reasoned about an object up to
        // `DECOR_TIERS.far.scale * VARIATION.scale.max` = 3.51x smaller than the one that got
        // drawn. The origin is bottom-centre, so a prop grows *upward* from its base: the clip
        // declared a sprite fully hidden while its real crown was most of the way clear of the
        // crest, and it then appeared at once. Measured on a `ROAD_HILL.HIGH` crest, the far tier
        // was **3.0 segments late and already 72% out** by the time it was first drawn.
        //
        // Only `w` and `h` move. `x` and `y` are the ground point, which the scale does not touch.
        const size = variation.scale * sprite.tierScale

        rect.w *= size
        rect.h *= size

        const visible = billboardVisibleFraction(rect, clip)

        if (!billboardOnScreen(rect, visible, screenWidth, screenHeight)) continue

        wanted++

        // Past capacity the loop keeps *counting* but stops drawing: the arithmetic above is
        // what makes `wantedLastFrame` an honest measure of demand, and it costs no Phaser
        // calls. Breaking out early would silently report the pool as exactly big enough.
        if (used >= capacity) continue

        this.place(
          this.slots[used],
          sprite.key,
          rect,
          visible,
          n,
          look.tint,
          variation,
          decorFogCeiling(sprite.tierScale),
          sprite.offsetX,
          spriteIndex,
        )
        used++
      }
    }

    // Only the slots that were in use last frame and are not in use now need hiding.
    for (let i = used; i < previousUsed; i++) {
      hidePooled(this.slots[i].image)
    }

    this.usedLastFrame = used
    this.wantedLastFrame = wanted
  }

  /**
   * Forgets which texture each slot is showing, after a theme swap rebuilt them all.
   *
   * The pool skips `setTexture` when the key has not changed — a real optimisation, and exactly
   * the wrong behaviour when the *pixels behind the key* were replaced: every slot then keeps a
   * reference to a destroyed `Texture` and the next frame throws inside the renderer. Clearing
   * the cached key makes the next render re-point every slot by construction, which is cheaper
   * and more honest than tracking texture identity per slot.
   */
  refreshTextures(): void {
    for (const slot of this.slots) {
      slot.key = ''
      hidePooled(slot.image)
    }
  }

  destroy(): void {
    for (const slot of this.slots) slot.image.destroy()
  }

  /** Points one pool slot at one billboard. */
  private place(
    slot: SlotState,
    key: string,
    rect: { x: number; y: number; w: number; h: number },
    visibleFraction: number,
    distanceIndex: number,
    /** This instance's finished colour, already through `tintFor` — see `looks`. */
    tint: number,
    variation: DecorVariation,
    /** Which tier's fog ceiling this prop fades under -- see `decorFogCeiling`. */
    fogCeiling: number,
    /** How far out it stands and where it fell in its segment's list -- see `sceneryDepth`. */
    offsetX: number,
    indexInSegment: number,
  ): void {
    const image = slot.image

    if (slot.key !== key) {
      // Crops are expressed in the frame's own pixels, so one left over from the previous
      // texture would be meaningless against the new one.
      if (slot.cropped) {
        image.setCrop()
        slot.cropped = false
      }
      setArt(image, key)
      slot.key = key
    }

    image.setPosition(rect.x, rect.y)
    // **The rectangle is already the drawn size** — both scales were folded into it by the caller
    // before the clip was measured, which is the whole of that fix. Nothing here may scale again:
    // a second multiply would put the drawn size back out of step with the clip, in the other
    // direction. Uniform either way, because scaling the two axes apart would stretch the prop.
    image.setDisplaySize(rect.w, rect.h)
    // Mirroring costs nothing and doubles the silhouettes. `setFlipX` rather than a negative
    // scale, because a negative display size confuses the crop the hill clip applies below.
    image.setFlipX(variation.flipX)
    // The lean, around the base: the origin is bottom-centre, so an angle rotates the prop about
    // the point where it meets the ground rather than about its middle.
    image.setAngle(variation.tilt)
    // Farther objects get a more negative depth and so are painted first. The ground mesh sits
    // below all of them at `ROAD_MESH_DEPTH`; there is no depth buffer in play — which is why two
    // props on the SAME segment need a tiebreak of their own, or the pool's own slot order decides
    // and changes under the player. See `sceneryDepth`.
    image.setDepth(sceneryDepth(distanceIndex, offsetX, indexInSegment, DECOR_TIERS.far.maxOffset))
    showPooled(image)
    // Distance haze, on the same curve the ground fades by. Applied every frame rather than
    // cached per slot: a slot's distance changes on almost every frame anyway, so a dirty check
    // would cost more than the assignment it skips.
    // Two independent terms: the haze it is seen through, and the fade it arrives with.
    // See `BILLBOARD_FADE_IN_FRACTION` for why they are not one number.
    // `decorFog`, not the billboard one: that is what obstacles and pickups fade by and it is
    // held down by the reaction budget. Scenery is not on one -- but it is on a gate, so the
    // near field keeps the alpha it always had. See `DECOR_FOG_GATE`.
    image.setAlpha((1 - decorFog(distanceIndex, fogCeiling)) * billboardAppear(distanceIndex))
    // Art gets its biome's colour under the theme's light, moved a little for this instance —
    // already mixed, once, by the caller's cache. A generated silhouette is left alone: it already
    // *is* the theme's colour, and tinting it again would darken it twice over.
    image.setTint(this.artKeys.has(key) ? tint : 0xffffff)

    if (visibleFraction < 1) {
      // Crop rather than squash: shrinking the display height would slide the object down the
      // hillside instead of sinking behind it. The crop origin is (0, 0) — the one case
      // Phaser positions correctly (see CLAUDE.md "UI Kit" on `preview.ts`'s same finding),
      // and the only one needed, since a hill always hides a billboard from the bottom up.
      //
      // **Measured off the frame, not off `texture`.** `DecorTexture.width/height` is a *world*
      // size (`billboardRectInto` above divides by `SPRITE_SCALE` with it); a crop rectangle is
      // in the frame's own pixels. The two coincide only for the generated canvas textures,
      // which happen to be created at exactly those dimensions. A loaded PNG of any other
      // resolution would crop to a corner of itself instead of to its lower part.
      const frameW = image.frame.realWidth
      const frameH = image.frame.realHeight

      image.setCrop(0, 0, frameW, Math.max(1, Math.round(frameH * visibleFraction)))
      slot.cropped = true
    } else if (slot.cropped) {
      image.setCrop()
      slot.cropped = false
    }
  }
}
