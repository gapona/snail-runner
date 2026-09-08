import * as Phaser from 'phaser'
import { glanceBack, LOOK_BACK, type LookBackState, lookBackTurn, stepLookBack } from './lookBack'
import { billboardRectInto, createBillboardRect } from '../road/billboard'
import { DRAW_DISTANCE, SEGMENT_LENGTH, SPRITE_SCALE } from '../road/constants'
import { segmentPercent, surfaceHeight, trackLengthOf, type Segment } from '../road/track'
import { createScreenPoint, wrapZ } from '../road/project'
import { groundPointInto } from './groundProjection'
import { distanceIndexOf, WORLD_LAYER, worldDepth } from './worldDepth'
import { SHADOW_DARKEN, SHADOW_FOOTPRINT, shadowAlpha, shadowScale } from './shadows'
import { createShadow } from './shadowArt'
import { spinAngle } from './ramp'
import { MASCOT_ASPECT, PLAYER_BODY_H, PLAYER_WIDTH, PLAYER_Z } from './constants'
import { createSnailTexture, snailSkinFrameKey } from './snailArt'
import { ensureShieldTexture, SHIELD_TEXTURE } from './shieldArt'
import {
  SHIELD_BUBBLE_SPAN,
  shieldBreathAlpha,
  shieldBreathScale,
  shieldPopAlpha,
  shieldPopProgress,
  shieldPopScale,
  SHIELD_POP,
} from './shield'
import { PICKUP_COLORS } from './artPalette'
import { DEFAULT_SNAIL_SKIN } from './snailSkins'
import type { PlayerState } from './playerMotion'

/**
 * The snail's footprint in the units `billboardRectInto` wants.
 *
 * That function's `textureWidth`/`textureHeight` are in **texture pixels**, and it multiplies them
 * by `SPRITE_SCALE` (world units per texture pixel) to get a world size. Feeding it the drawing's
 * own pixel size would make the art decide how big the snail is; dividing the *world* size back
 * out means the collision box decides, and the art can be redrawn at any resolution without
 * touching gameplay. See `PLAYER_WIDTH`.
 */
const DRAW_UNITS = { width: PLAYER_WIDTH / SPRITE_SCALE, height: PLAYER_BODY_H / SPRITE_SCALE }

// The shadow's size, alpha and colour rule all live in `shadows.ts` now, shared with every other
// object that leaves the ground. What used to be here was a second copy of them for the one object
// that had a shadow at all — and a second copy is how the snail's height cue and a pickup's end up
// meaning different things.

/**
 * The invulnerability blink: how fast, and how far down it dips.
 *
 * **Grace the player cannot see is indistinguishable from a broken hitbox.** Before this the snail
 * looked identical whether it could be hit or not, so driving through a rock unharmed read as the
 * game failing rather than as mercy it had been given — which is exactly how it was reported.
 *
 * It never goes fully transparent: the snail is the thing being steered, and a mascot that
 * disappears for 50ms at a time is one the player loses track of at the moment they most need it.
 * 0.35 is dim enough to be unmistakable and solid enough to stay steerable.
 *
 * Blinked on a wall clock rather than on distance, unlike everything else about the grace period —
 * the *window* is a distance because the road is, but a blink is something an eye reads, and an eye
 * reads in milliseconds.
 */
const BLINK_PERIOD_MS = 110
const BLINK_DIM = 0.35

/**
 * ⚠ The snail's own distance index is computed per frame, not held here.
 *
 * It was `PLAYER_Z / SEGMENT_LENGTH` — a constant, because the snail's distance from the camera is
 * one — and that is measured **from the camera**, where every standing object's index is measured
 * from the base segment's near edge. The two differ by however far the camera has travelled into
 * that segment, which is up to a whole segment, so an obstacle the snail had just passed could
 * still draw behind it and one still ahead could draw over it. See `distanceIndexOf`.
 *
 * `PLAYER_SEGMENT_PHASE` still snaps `PLAYER_Z` off a segment boundary and its argument still
 * holds — it is what keeps the tiebreak from having to decide a tie that is not arbitrary.
 */

/**
 * How far the run travels per frame of the glide cycle, in world units.
 *
 * **Tied to distance rather than to time, so the ripple speeds up with the snail.** A cycle on a
 * wall clock would ripple at the same rate whether the run was crawling at `SPEED_BASE` or flat out
 * at `SPEED_CAP`, which reads as the animation having come loose from the game. One segment per
 * frame gives 7.2 frames a second at the base speed and 18 at the cap, and puts the ripple on the
 * same rhythm as the road's own rumble stripes.
 */
const GLIDE_UNITS_PER_FRAME = SEGMENT_LENGTH

/**
 * The Phaser half of the player: two objects, no state of its own.
 *
 * **The snail is drawn by the same `billboardRectInto` every piece of scenery uses**, against the
 * projection of the segment it is standing on. That is the whole payoff of keeping the player in
 * road space: the visual and the simulation cannot disagree about where it is, because they are
 * the same numbers. `RoadSprites` does this for the verge; this does it for one object.
 *
 * **The shadow is not polish.** On a pseudo-3D road there is no other cue for height: a snail at
 * `y = 300` and a snail standing on a rise both draw higher up the frame, and nothing about the
 * sprite says which. The ellipse stays on the ground at the snail's own `offsetX` and shrinks with
 * altitude, so "how high am I" and "am I over that log yet" become readable. It is part of the
 * jump mechanic, and taking it out breaks the game rather than making it plainer.
 *
 * Must run **after** `WorldView.render` in the same frame, and for the same reason `RoadSprites`
 * must: it reads this frame's `Segment.s1` projections straight out of the mesh pass.
 */

export class PlayerView {
  readonly sprite: Phaser.GameObjects.Image
  readonly shadow: Phaser.GameObjects.Image
  /** The shell drawn round the snail while a shield is carried, and thrown when one breaks. */
  readonly bubble: Phaser.GameObjects.Image

  /** Where the snail was drawn last frame, in screen pixels — for the camera lean and for FX. */
  screenX = 0
  screenY = 0

  /** Where the snail's feet were drawn this frame, in screen pixels. See `render`. */
  groundX = 0
  groundY = 0

  /**
   * The snail's whole drawn box this frame, in screen pixels — bottom-centre origin unpacked.
   *
   * **Published so the HUD can get out of its way, never so the HUD can be positioned by it.** A
   * readout anchored to the mascot is how the fruit gauge once ended up drawn on the horizon; what
   * this is for is the opposite question — is the thing the player is steering currently underneath
   * a corner readout — and the answer only ever changes an *alpha*. See `Hud.update` and
   * `gaugeYield`.
   */
  readonly drawnBox = { left: 0, right: 0, top: 0, bottom: 0 }


  private readonly rect = createBillboardRect()
  private lookBack: LookBackState = { startedAt: -1, nextAt: 0 }
  /** When the carried bubble was last broken by a hit, in scene ms. `-1` for never. */
  private brokeAt = -1
  /**
   * The snail's own ground projection, interpolated between the segment's two edges every frame.
   *
   * A field rather than a local so the frame allocates nothing — the same reason `Segment` carries
   * its own `s1`/`s2` slots instead of `project()` returning fresh objects.
   */
  private readonly ground = createScreenPoint()

  /**
   * How much bigger than its collision box this snail is drawn.
   *
   * **⚠ 1 everywhere a hit can happen, and the rule that says so is `PLAYER_WIDTH`'s.** The drawn
   * box is the collision box, because a mascot drawn wider than its body gets hit by things it
   * visibly cleared and one drawn narrower clips through them. The single exception is the front
   * screen, which has no obstacles, no pickups and no collision at all: there the mascot is the
   * subject of the picture rather than a hitbox, and it is drawn bigger on purpose.
   *
   * Constructor-only, so it cannot be reached from a render loop that also resolves hits.
   */
  private sizeScale: number

  /**
   * Changes that scale. **Menu-only, for the same reason the option is.**
   *
   * A setter rather than a constructor value because the front screen makes the mascot bigger on a
   * narrow frame — everything on this road is sized off the frame's WIDTH, so on a phone the snail
   * comes out a fifth of its desktop size, which is right for a hitbox and wrong for the object the
   * picture is about. Nothing in a run may call this.
   */
  setSizeScale(scale: number): void {
    this.sizeScale = scale
  }

  /**
   * Which recolour of the mascot this view draws — see `snailSkins.ts`.
   *
   * A field rather than a texture key because the key changes six times a cycle: the glide frame is
   * derived from distance every render, so the skin has to be the thing that is held and the key
   * the thing that is computed. Held here rather than read from the save on every frame for the
   * same reason `getRoadTheme()` is read through a getter and not captured — except in the other
   * direction: this is a *render* loop, and a save read per frame is a save read 60 times a second.
   */
  private skin: string

  /**
   * Changes it, and rebuilds that skin's frames if this is the first time they have been asked for.
   *
   * Exists for the front screen, which is where a skin is chosen: the shop hands its selection back
   * to `MainMenu`, and the mascot standing on the road *is* the preview. A run never calls this — it
   * resolves the skin once, at `create()`.
   */
  setSkin(scene: Phaser.Scene, skinId: string): void {
    createSnailTexture(scene, skinId)
    this.skin = skinId
  }



  /**
   * Rebuilds the mascot for the theme that is now active, and re-points the sprite at it.
   *
   * **⚠ The mascot became a themed texture and `applyTheme` therefore destroys it.** Its pad answers
   * to the theme's own ground light and its contour is chosen against the road it will be drawn
   * over, so a skin's frames belong to a (skin, theme) pair — and the key carries the theme id.
   * Without this the sprite is left holding a texture the swap has just removed, which is the
   * `glTexture` of null this project has now diagnosed from four separate directions.
   *
   * Called on the same beat as `WorldView.refreshTheme`, by whichever scene owns the swap.
   */
  refreshTheme(scene: Phaser.Scene): void {
    createSnailTexture(scene, this.skin)
    // Re-pointed rather than left to the next `render`: a paused menu may not draw another frame
    // before the player looks at it, and `setTexture` on an unchanged key is a no-op anyway.
    this.sprite.setTexture(snailSkinFrameKey(0, this.skin))
  }

  constructor(
    scene: Phaser.Scene,
    options: { sizeScale?: number; skin?: string } = {},
  ) {
    this.skin = options.skin ?? DEFAULT_SNAIL_SKIN
    createSnailTexture(scene, this.skin)
    this.sizeScale = options.sizeScale ?? 1

    // Below the snail in the display list, and below it in depth: an ellipse drawn over the
    // sprite would read as a hole rather than as a shadow.
    // ⚠ All three depths are re-set every frame in `render`. They used to be assigned here, on the
    // reasoning that the snail's distance from the camera never changes — true of the distance and
    // false of the INDEX, which is measured from the base segment's near edge and therefore slides
    // as the camera crosses one. See `distanceIndexOf`.
    // Multiply, not a grey fill: on pale sand a neutral ellipse reads as a puddle rather than as
    // an absence of light. See `SHADOW_DARKEN`.
    // **An `Image` on one shared ellipse texture, never an `Ellipse` game object** — see
    // `shadowArt.ts`. A shadow is resized every frame, and `Ellipse.setSize` re-tessellates the
    // curve and re-triangulates it on every call.
    this.shadow = createShadow(scene)
    this.sprite = scene.add
      .image(0, 0, snailSkinFrameKey(0, this.skin))
      // **⚠ Its own centre, not its feet, and that is what a tumble turns about.** A billboard is
      // *positioned* by where it meets the ground — `render` still does exactly that, by placing
      // this centre half a drawn height above it — but the origin is also the pivot, and pivoting a
      // spinning creature on its feet swung it below the ground point. See `bodyBand`.
      .setOrigin(0.5, 0.5)

    ensureShieldTexture(scene)
    // **Between the player and the pickups**, so the shell's rim draws over the mascot's own edge —
    // which is what makes it a bubble around the snail rather than a hoop behind it — while a coin
    // being collected still draws over the bubble. Both are `WORLD_LAYER` tiebreaks under one
    // segment, so distance still decides first, as it must.
    this.bubble = scene.add
      .image(0, 0, SHIELD_TEXTURE)
      .setTint(PICKUP_COLORS.shield.light)
      .setVisible(false)

    // **⚠ Three images made now and hidden, never one made when an item is put on.** `RunScene`,
    // `MainMenu` and `Garage` all build their camera `ignore()` lists from `gameObjects` at
    // `create()` time, and an object created after that is in *neither* list — which is drawn
    // twice, once by the world camera at its own depth and once by `uiCamera` over the whole frame.
    // That is the defect the critters' wings shipped with for four rounds, and a wardrobe the
    // player changes at runtime is exactly the shape that reintroduces it. A fixed pool makes it
    // unrepresentable rather than remembered.
    //
  }

  /**
   * A hit has just been absorbed: throw the bubble outward and let it go.
   *
   * Called by the scene rather than inferred from `shields` falling, because the two are not the
   * same event — a run can end on the frame a shield breaks, and inferring it from a count would
   * put the burst on whichever frame the view happened to notice.
   */
  popShield(now: number): void {
    this.brokeAt = now
  }

  /** Every object, for the camera `ignore()` lists and for teardown. */
  get gameObjects(): Phaser.GameObjects.GameObject[] {
    return [this.shadow, this.sprite, this.bubble]
  }

  /**
   * Places the snail and its shadow for this frame.
   *
   * `track`, `baseIndex` and the camera's `z` all come from the `WorldView` render that must
   * already have run. The segment the snail stands on is the one holding `cameraZ + PLAYER_Z`,
   * found by index rather than by search — the mesh has already projected it this frame.
   */
  render(
    player: PlayerState,
    track: Segment[],
    baseIndex: number,
    cameraZ: number,
    screenWidth: number,
    screenHeight: number,
    squash = 1,
    distance = 0,
    look: { invulnerable: boolean; now: number; shields?: number } = { invulnerable: false, now: 0 },
  ): void {
    const trackLength = trackLengthOf(track.length)
    const worldZ = wrapZ(cameraZ + PLAYER_Z, trackLength)
    const index = Math.floor(worldZ / SEGMENT_LENGTH) % track.length
    // How far ahead of the camera's own segment the snail's is. Outside the drawn range it has
    // no projection this frame, which can only happen if `PLAYER_Z` is ever pushed past the draw
    // distance — worth failing quietly rather than drawing against last frame's numbers.
    const ahead = (index - baseIndex + track.length) % track.length

    if (ahead >= DRAW_DISTANCE) {
      this.hideAll()

      return
    }

    const segment = track[index]

    if (!Number.isFinite(segment.s1.scale) || segment.s1.scale <= 0) {
      this.hideAll()

      return
    }

    // The snail is the one object not attached to the segment it is over, so its ground point is
    // interpolated across that segment rather than read off its near edge — see
    // `playerProjection.ts` for the 11.3%-per-segment pop that costs, and `verify:player` for the
    // check that keeps it fixed.
    const ground = groundPointInto(this.ground, segment.s1, segment.s2, worldZ)
    // The same index every standing object uses, from the same origin -- see `distanceIndexOf`.
    // Set every frame, because `ahead` steps down as the camera crosses a boundary and the
    // fractional part slides continuously between those steps.
    const distanceIndex = distanceIndexOf(ahead, worldZ)

    this.shadow.setDepth(worldDepth(distanceIndex, WORLD_LAYER.shadow))
    this.sprite.setDepth(worldDepth(distanceIndex, WORLD_LAYER.player))
    this.bubble.setDepth(worldDepth(distanceIndex, (WORLD_LAYER.player + WORLD_LAYER.pickup) / 2))

    if (!Number.isFinite(ground.scale) || ground.scale <= 0) {
      this.hideAll()

      return
    }

    // The shadow first, on the ground, at the snail's own `offsetX` — height zero, always. It is
    // the *reference* the jump is read against, so it must never move up with the snail.
    billboardRectInto(
      this.rect,
      ground,
      player.offsetX,
      0,
      DRAW_UNITS.width * this.sizeScale,
      DRAW_UNITS.height * this.sizeScale,
      screenWidth,
      screenHeight,
    )

    const groundX = this.rect.x
    const groundY = this.rect.y
    const footprint = this.rect.w

    // **Wider and weaker with height, which is the reverse of what shipped before.** The old rule
    // shrank it and held the alpha, because an earlier version had shrunk *and* faded it and the
    // two multiplied to nothing. Spreading it while fading pulls the two terms against each other
    // instead, and `shadows.ts` carries the arithmetic that says the apex stays at least as
    // visible as the ground -- along with the check that holds it there.
    const lift = Math.max(0, player.y)
    const scale = shadowScale(lift)

    this.shadow.setVisible(true)
    this.shadow.setPosition(groundX, groundY)
    // Recorded so a landing can throw its dust from the snail's own feet. Kept here rather than
    // recomputed by the scene because this is the point that has already been through the road's
    // projection this frame — a second computation is a second thing that can disagree with the
    // shadow about where the ground is.
    this.groundX = groundX
    this.groundY = groundY
    this.shadow.setDisplaySize(footprint * SHADOW_FOOTPRINT.width * scale, footprint * SHADOW_FOOTPRINT.height * scale)
    this.shadow.setAlpha(shadowAlpha(lift) * SHADOW_DARKEN)

    // Then the snail itself, lifted by its world height through the same helper — so the lift is
    // in the projection's own units and shrinks with distance exactly as the sprite does.
    billboardRectInto(
      this.rect,
      ground,
      player.offsetX,
      player.y,
      DRAW_UNITS.width * this.sizeScale,
      DRAW_UNITS.height * this.sizeScale,
      screenWidth,
      screenHeight,
    )

    // The glide frame. Set before the position for no reason but readability; `setTexture` on the
    // key it already holds is a no-op inside Phaser, so this costs nothing on the five frames out
    // of six where nothing changes.
    this.sprite.setTexture(snailSkinFrameKey(Math.floor(distance / GLIDE_UNITS_PER_FRAME), this.skin))
    this.sprite.setVisible(true)
    // Squash and stretch is volume-preserving: wider when flatter. Applied here rather than baked
    // into the billboard size so the collision footprint never changes with the animation.
    // **The glance, folded into the same two calls the squash already uses.** A rear-view shell
    // rotating a little *and* narrowing reads as a head coming round; rotating alone reads as the
    // whole creature tipping over. Both terms come off one eased scalar so they cannot disagree
    // about how far through the turn it is. See `lookBack.ts`.
    this.lookBack = stepLookBack(this.lookBack, look.now, Math.random)

    const glance = lookBackTurn(this.lookBack, look.now)

    this.sprite.setDisplaySize((this.rect.w / squash) * (1 - LOOK_BACK.pinch * glance), this.rect.h * squash)
    // **⚠ Positioned by its CENTRE, and it used to be positioned by its feet.** The origin is
    // `(0.5, 0.5)`, so this is where the turn happens — and turning a tumbling creature about the
    // point where it meets the ground swung its body 310 units *below* that point, which is what
    // stopped a ramp clearing a tall barrier. See `bodyBand`, which is the same rectangle and has
    // to stay the same rectangle. At rest the two placements are identical to the pixel, because a
    // box drawn from its centre at `y - h/2` is a box drawn from its bottom at `y`.
    this.sprite.setPosition(this.rect.x, this.rect.y - this.sprite.displayHeight / 2)
    // **The spin, and the shadow deliberately does not take it.** A shadow is a mark on the ground
    // and the ground is not turning; rotating it would read as the whole world tipping rather than
    // as the snail doing something. It grows and fades with height and nothing else — see
    // `shadows.ts`. `spinAngle` is 0 for an ordinary jump, so this line costs nothing there.
    this.sprite.setAngle(spinAngle(player) + LOOK_BACK.turnDegrees * glance)
    // The shadow blinks with the snail: a solid shadow under a flickering creature reads as the
    // sprite failing to draw rather than as the creature being briefly untouchable.
    const blink = look.invulnerable && Math.floor(look.now / BLINK_PERIOD_MS) % 2 === 1 ? BLINK_DIM : 1

    this.sprite.setAlpha(blink)
    this.shadow.setAlpha(shadowAlpha(Math.max(0, player.y)) * SHADOW_DARKEN * blink)

    this.screenX = this.rect.x
    this.screenY = this.rect.y
    // Written in place rather than reallocated: this runs every frame of every run.
    this.drawnBox.left = this.rect.x - this.rect.w / 2
    this.drawnBox.right = this.rect.x + this.rect.w / 2
    this.drawnBox.top = this.rect.y - this.rect.h
    this.drawnBox.bottom = this.rect.y
    // **Above the mascot and below the bubble**, both `WORLD_LAYER` tiebreaks inside one segment so
    // distance still decides first. Set every frame for the reason every other depth here is: the
    // index slides as the camera crosses a boundary.
    this.drawBubble(look.shields ?? 0, look.now)
  }

  /**
   * The shield's shell: carried, or coming apart.
   *
   * Positioned on the sprite's own drawn box rather than re-projected, so it cannot disagree with
   * the mascot about where the mascot is — the same argument `groundX`/`groundY` are recorded for.
   * Sized off the **width** in both axes: the snail is 1.6 times wider than it is tall, and an
   * ellipse stretched to that box reads as a shadow standing on its end rather than as a shell.
   *
   * The break outlives the shield it belonged to, which is the point: `shields` is already one
   * lower on the frame the burst starts. See `shield.ts`.
   */
  private drawBubble(shields: number, now: number): void {
    const popping = this.brokeAt >= 0 && now - this.brokeAt < SHIELD_POP.durationMs
    const size = this.sprite.displayWidth * SHIELD_BUBBLE_SPAN

    if (!popping && shields <= 0) {
      this.bubble.setVisible(false)

      return
    }

    const progress = popping ? shieldPopProgress(now - this.brokeAt) : 0
    const scale = popping ? shieldPopScale(progress) : shieldBreathScale(now)
    const alpha = popping ? shieldPopAlpha(progress) : shieldBreathAlpha(now)

    this.bubble.setVisible(true)
    // The snail's centre: its origin is at its feet, so half a drawn height up from there.
    // The sprite is drawn from its own centre, so that *is* the body's middle — see `render`.
    this.bubble.setPosition(this.sprite.x, this.sprite.y)
    this.bubble.setDisplaySize(size * scale, size * scale)
    this.bubble.setAlpha(alpha)
  }

  /** Everything the view draws, off. One place, so a new object cannot be forgotten in three. */
  private hideAll(): void {
    this.sprite.setVisible(false)
    this.shadow.setVisible(false)
    this.bubble.setVisible(false)
  }

  /** The ground height under the snail, for anything that needs the surface it is standing on. */
  groundHeightAt(track: Segment[], cameraZ: number): number {
    const trackLength = trackLengthOf(track.length)
    const worldZ = wrapZ(cameraZ + PLAYER_Z, trackLength)
    const segment = track[Math.floor(worldZ / SEGMENT_LENGTH) % track.length]

    return surfaceHeight(segment, segmentPercent(worldZ))
  }

  /** The three moments the run hands over: fruit taken, a Fever entered, a ramp landed. */
  glance(now: number): void {
    this.lookBack = glanceBack(this.lookBack, now, Math.random)
  }

  destroy(): void {
    this.sprite.destroy()
    this.shadow.destroy()
    this.bubble.destroy()
  }


}
