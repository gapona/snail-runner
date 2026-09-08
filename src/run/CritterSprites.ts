import * as Phaser from 'phaser'
import { GROUNDED_POSE, HOP_PHASE_STAGGER_MS, hopPose } from './critterJump'
import { vaultBodyOf, vaultPose } from './critterVault'
import type { Obstacle } from './obstacles'
import { rotatedSpan, wingAngle, WING_PHASE_STAGGER_MS } from './critterWings'
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
import {
  createCritterTextures,
  critterAirKey,
  critterFrameKey,
  critterWingKey,
  CRITTER_STEP_UNITS,
} from './critterArt'
import {
  CRITTER_AIR_POSES,
  CRITTER_KIND_IDS,
  CRITTER_KINDS,
  CRITTER_WINGS,
  MAX_CRITTERS,
  tuckOffset,
  type Critter,
  type CritterAirPose,
  type CritterKind,
} from './critters'
import { groundPointInto, type GroundPoint } from './groundProjection'
import { distanceIndexOf, WORLD_LAYER, worldDepth } from './worldDepth'
import { SHADOW_DARKEN, SHADOW_FOOTPRINT, shadowAlpha, shadowClipFade, shadowScale } from './shadows'
import { createShadow } from './shadowArt'

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
   * A flyer's two wings: ONE drawing, used twice, the second mirrored.
   *
   * Owned by the slot for the shadow's own reason -- two pools filled in the same order every frame
   * is a desync waiting to happen, and its symptom here would be a wing beating on the wrong body.
   */
  wings: [Phaser.GameObjects.Image, Phaser.GameObjects.Image]
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
  shadow: Phaser.GameObjects.Image
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
  /** Kept so `airPose` can ask the texture manager whether a supplied pose actually loaded. */
  private readonly textures: Phaser.Textures.TextureManager

  constructor(scene: Phaser.Scene, poolSize = CRITTER_POOL_SIZE) {
    this.textures = scene.textures
    createCritterTextures(scene)

    // Any valid key will do -- the pool only needs one to construct its images with. Taken
    // from the table rather than named, so removing a kind cannot leave a dangling texture key.
    const initialKey = critterFrameKey(CRITTER_KIND_IDS[0], 0)

    this.slots = Array.from({ length: poolSize }, () => ({
      // Bottom centre, like every other billboard: a critter is positioned by the point where its
      // own band begins — the road for a beetle, and 431 units of daylight up for a bee.
      image: scene.add.image(0, 0, initialKey).setOrigin(0.5, 1).setVisible(false),
      // Two wings per slot, allocated up front like everything else in this pool: an image created
      // later would miss the scene's camera `ignore()` lists, which are built at scene create, and
      // would be drawn twice. Hidden until a flyer needs them.
      wings: [0, 1].map(() => scene.add.image(0, 0, initialKey).setVisible(false)) as [
        Phaser.GameObjects.Image,
        Phaser.GameObjects.Image,
      ],
      // An `Image` on the shared ellipse texture — see `shadowArt.ts`. This is the fourth pool
      // that was resizing an `Ellipse` every frame, and the one that pays most per mark: a critter
      // is the only thing in the frame moving under its own power, so its shadow's size changes on
      // every frame of every crossing rather than only while something is airborne.
      shadow: createShadow(scene),
      key: initialKey,
      cropped: false,
    }))

    // **⚠ The wings belong in this list, and for four rounds they did not.** `RunScene` builds its
    // two-camera split from `worldObjects()`, which is this — so anything missing from it is never
    // `uiCamera.ignore()`-ed and is therefore drawn **twice**: once by the world camera at its own
    // depth, and again by the UI camera, which is added second and composites on top of the entire
    // frame. Reported four times as seeing a flyer's wings through the scenery, and the picture that
    // finally settled it shows exactly that signature: a barrier filling the frame, two wings drawn
    // over it, and **no body between them** — the body was correctly occluded the whole time.
    //
    // Three rounds of fixes went to the wrong place because the symptom points at depth: a
    // translucent membrane, a contour rebuild, and two pools measuring depth from different origins
    // were each a real defect and none of them was this one. See `assertWorldIsSingleCamera` for why
    // the guard that exists for exactly this could not see it.
    this.gameObjects = this.slots.flatMap((slot) => [slot.shadow, slot.image, ...slot.wings])
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
  /**
   * The kind's tucked drawing, or null when it has none or its texture has not loaded.
   *
   * Checked against the texture manager rather than against the table alone, because a supplied
   * pose has no procedural fallback: `createCritterTextures` cannot invent one. A scene that starts
   * before `Preloader` has finished -- which the stepping harness does routinely -- would otherwise
   * ask for a key that is not there and draw the placeholder.
   */
  private airPose(kind: CritterKind): CritterAirPose | null {
    const pose = CRITTER_AIR_POSES[kind]

    if (!pose || !this.textures.exists(critterAirKey(kind))) return null

    return pose
  }

  render(
    critters: readonly Critter[],
    cameraOdometer: number,
    cameraTrackZ: number,
    track: Segment[],
    baseIndex: number,
    clipY: readonly number[],
    screenWidth: number,
    screenHeight: number,
    // ⚠ Scene time, and it is the ONE animation clock in this file. A wingbeat is not a gait -- see
    // `critterWings.ts` for why it is time-driven where the frog's hop and the beetle's legs are
    // driven by travel. Defaulted so an existing caller keeps compiling; the scene passes its own.
    now = 0,
    // What the creatures have to get over. Read only to DRAW them clearing it -- see
    // `critterVault.ts` for why this cannot reach `stepCritters` and why the collision band is
    // untouched by it. Defaulted to nothing, so a caller with no obstacles draws exactly what it
    // drew before.
    obstacles: readonly Obstacle[] = [],
    trackLength = 0,
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
      const ground = groundPointInto(this.ground, segment.s1, segment.s2, cameraTrackZ + ahead)

      if (!Number.isFinite(ground.scale) || ground.scale <= 0) continue

      // **The hop is a deformation of the one drawing, not a second set of frames.** Its arc comes
      // from the player's own flight solver -- see `critterJump.ts` -- and it is offset per critter
      // so two frogs on screen never hop in lockstep, which reads as one object drawn twice.
      const spec = CRITTER_KINDS[critter.kind]
      // The tucked pose is only offered when its texture is actually loaded: there is no
      // procedural fallback for a supplied drawing, and a missing one must degrade to the deformed
      // ground pose rather than to nothing.
      const air = this.airPose(critter.kind)
      const tuckAbove = air ? tuckOffset(critter.kind) : Infinity
      // ⚠ Clearing something in front of it OVERRIDES its own cycle, and it is not a sum. Two arcs
      // added together put the creature at the height of neither: a frog part-way through its own
      // hop when a barrier arrives would leave the ground from wherever that hop had got to and
      // clear the panel by however much was left over. What has to be true is that the base is over
      // the obstacle's top as it crosses, which is a statement about ONE arc.
      const vault = vaultPose(
        vaultBodyOf(critter, cameraTrackZ + ahead, spec.speed),
        obstacles,
        trackLength,
        tuckAbove,
      )
      const hop =
        vault ??
        (spec.gait === 'hop'
          ? hopPose(
              critter.bornZ - critter.z,
              spec.speed,
              critter.id * HOP_PHASE_STAGGER_MS,
              tuckAbove,
            )
          : GROUNDED_POSE)

      // ⚠ When tucked, the box is the AIR pose's own -- its own width and its own height, both
      // measured at the same creature scale as the ground pose. Reusing the ground box would
      // stretch a 1.33:1 drawing onto a 1.94:1 frame, which is the distortion `fromModel` exists to
      // prevent, arriving from inside one kind.
      const boxWidth = hop.tucked && air ? air.width : critter.halfWidths * 2 * ROAD_WIDTH
      const boxHeight = hop.tucked && air ? air.height : critter.yHigh - critter.yLow
      const worldWidth = boxWidth * hop.scaleX
      const worldHeight = boxHeight * hop.scaleY
      // The anchor, not the base. Placing the tucked drawing so its centre of mass lands where the
      // ground pose's already was is the whole of what stops the swap jumping -- and because the
      // swap waits until the hop has lifted the creature by exactly this offset, the base is at
      // ground level at that instant.
      const baseOffset = hop.tucked && air ? tuckOffset(critter.kind) * hop.scaleY : 0
      const rect = billboardRectInto(
        this.rect,
        ground,
        critter.offsetX,
        // Lifted by the bottom of its own band: zero for a beetle, and for a bee the daylight a
        // grounded snail passes through. A hop adds its own height on top, which is the only
        // place the arc reaches the frame -- the collision band is untouched.
        critter.yLow + hop.y - baseOffset,
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

      // ⚠ Measured from the base segment's near edge, NOT from the camera. It was `ahead /
      // SEGMENT_LENGTH` — a continuous index, which is right, from an origin the obstacle pool does
      // not share, which is not: the camera stands some way into its own base segment and `n`
      // counts from that edge. See `distanceIndexOf` for what the two origins cost.
      const distanceIndex = distanceIndexOf(n, cameraTrackZ + ahead)
      // A flyer's box is its ASSEMBLED span, so the body is drawn at its own share of it and the
      // wings fill the rest. A ground kind's body IS the box, and `bodyRect` returns it unchanged.
      const bodyRect = this.bodyRectOf(critter.kind, rect)

      this.place(
        this.slots[used],
        hop.tucked ? critterAirKey(critter.kind) : critterFrameKey(critter.kind, pose),
        bodyRect,
        fraction,
        distanceIndex,
        shadowRect,
        critter.yLow,
        clipY[n],
      )
      this.placeWings(
        this.slots[used],
        critter.kind,
        rect,
        distanceIndex,
        this.slots[used].image.alpha,
        now,
        critter.id * WING_PHASE_STAGGER_MS,
        clipY[n],
      )
      used++
    }

    for (let i = used; i < previousUsed; i++) {
      this.slots[i].image.setVisible(false)
      this.slots[i].shadow.setVisible(false)
      for (const wing of this.slots[i].wings) wing.setVisible(false)
    }

    this.usedLastFrame = used
    this.wantedLastFrame = wanted
  }

  destroy(): void {
    for (const slot of this.slots) {
      slot.image.destroy()
      slot.shadow.destroy()
      for (const wing of slot.wings) wing.destroy()
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
      slot.shadow.setDisplaySize(shadowRect.w * SHADOW_FOOTPRINT.width * scale, markHeight)
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

  /**
   * Places a flyer's two wings against the body's own projected box.
   *
   * Everything is a fraction of that box, so the wings follow the body through the projection with
   * no second piece of arithmetic that could disagree with it -- the same reason a critter is
   * projected from the segment's own two edges rather than re-projected.
   *
   * **The mirror is an origin flip, not a negated scale.** `flipX` mirrors the texture inside its
   * frame and leaves the origin fraction where it is, so the left wing's origin has to be
   * `1 - pivotX` or it would hinge on its own TIP.
   */
  /** The body's own box inside the kind's world box. Identity for anything without wings. */
  private bodyRectOf(
    kind: CritterKind,
    rect: { x: number; y: number; w: number; h: number },
  ): { x: number; y: number; w: number; h: number } {
    const spec = CRITTER_WINGS[kind]

    if (!spec) return rect

    const h = rect.h * spec.bodyHeight
    // The width is the DRAWING's, so the body is never stretched; only where it sits comes from the
    // reference. The insect is symmetric, so it is centred.
    const w = h * spec.bodyAspect

    // The rect is bottom-centre, so x is a centre and y is the BASE.
    return { x: rect.x, y: rect.y - rect.h + spec.bodyTop * rect.h + h, w, h }
  }

  private placeWings(
    slot: SlotState,
    kind: CritterKind,
    rect: { x: number; y: number; w: number; h: number },
    distanceIndex: number,
    alpha: number,
    ms: number,
    stagger: number,
    clip: number,
  ): void {
    const spec = CRITTER_WINGS[kind]
    const key = critterWingKey(kind)

    if (!spec || !this.textures.exists(key)) {
      for (const wing of slot.wings) wing.setVisible(false)
      return
    }

    const [hx, hy] = spec.hingeInBody
    const [px, py] = spec.pivot
    // ⚠ Everything about the wing is measured against the BODY, never against the world box. The
    // wing is attached to the body, the two are one drawing at one scale in the material, and a box
    // rebuilt from the reference is the thing that put earlier versions' wings in clear air. See
    // `CritterWings.hingeInBody`.
    const body = this.bodyRectOf(kind, rect)
    const w = body.w * spec.wingOverBody
    const h = w / spec.wingAspect
    // The body rect is bottom-centre, like every rect here.
    const left = body.x - body.w / 2
    const top = body.y - body.h
    const angle = wingAngle(kind, ms, spec.restDeg, stagger)
    const depth = worldDepth(distanceIndex, WORLD_LAYER.critterWing)

    slot.wings.forEach((wing, i) => {
      const right = i === 0

      wing.setVisible(true)
      wing.setTexture(key)
      wing.setOrigin(right ? px : 1 - px, py)
      wing.setFlipX(!right)
      wing.setDisplaySize(w, h)
      wing.setPosition(left + (right ? hx : 1 - hx) * body.w, top + hy * body.h)
      wing.setRotation(right ? angle : -angle)
      wing.setDepth(depth)
      // ⚠ The hill clips a wing too, and for as long as wings have existed it did not. The body is
      // cropped against `clipY` and the wings were drawn at full size beside it, so a flyer coming
      // over a crest showed two wings hanging in the air with no insect between them -- reported as
      // seeing the wings through the scenery. A crop is the wrong instrument here because a wing is
      // ROTATED and a crop is applied in the frame's own pixels, before the rotation; so it fades
      // over its own height, which is what the shadows already do against the same line.
      //
      // ⚠ And the first version faded on the HINGE, which is the one point of a wing that is never
      // the part behind the hill. The blade sweeps up to two thirds of the body's own height below
      // it, so a flyer whose body had been cropped to a sliver still drew both wings at full alpha:
      // measured over the run circuit, 0.4-1.6% of the frames a flyer is big enough to read in.
      // It is the wing's own drawn extent now -- the bottom of the rotated box, faded over the
      // whole of it.
      const extent = rotatedSpan(w, h, right ? px : 1 - px, py, right ? angle : -angle)

      wing.setAlpha(alpha * shadowClipFade(wing.y + extent.bottom, extent.height * 2, clip))
    })
  }
}
