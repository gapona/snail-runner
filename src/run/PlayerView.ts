import * as Phaser from 'phaser'
import { billboardRectInto, createBillboardRect } from '../road/billboard'
import { DRAW_DISTANCE, SEGMENT_LENGTH, SPRITE_SCALE } from '../road/constants'
import { segmentPercent, surfaceHeight, trackLengthOf, type Segment } from '../road/track'
import { createScreenPoint, wrapZ } from '../road/project'
import { playerGroundInto } from './playerProjection'
import { WORLD_LAYER, worldDepth } from './worldDepth'
import { SHADOW_DARKEN, SHADOW_FOOTPRINT, shadowAlpha, shadowScale } from './shadows'
import { PLAYER_BODY_H, PLAYER_WIDTH, PLAYER_Z } from './constants'
import { createSnailTexture, snailFrameKey, SNAIL_TEXTURE } from './snailArt'
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
 * How far ahead of the camera the snail is, in segments — 9.83, not a whole number.
 *
 * **That it lands between two segments is the point.** The snail's depth has to place it after the
 * obstacle one segment behind it (which is nearer to the camera, and must paint over it as it
 * passes) and before the one ahead. A flat depth put it in front of both. See `worldDepth.ts`.
 */
const PLAYER_DISTANCE_INDEX = PLAYER_Z / SEGMENT_LENGTH

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
  readonly shadow: Phaser.GameObjects.Ellipse

  /** Where the snail was drawn last frame, in screen pixels — for the camera lean and for FX. */
  screenX = 0
  screenY = 0

  private readonly rect = createBillboardRect()
  /**
   * The snail's own ground projection, interpolated between the segment's two edges every frame.
   *
   * A field rather than a local so the frame allocates nothing — the same reason `Segment` carries
   * its own `s1`/`s2` slots instead of `project()` returning fresh objects.
   */
  private readonly ground = createScreenPoint()

  constructor(scene: Phaser.Scene) {
    createSnailTexture(scene)

    // Below the snail in the display list, and below it in depth: an ellipse drawn over the
    // sprite would read as a hole rather than as a shadow.
    // Both depths are constant, unlike every other world object's: the snail never changes its
    // distance from the camera. They still come from the same scale everything else sorts on.
    // Multiply, not a grey fill: on pale sand a neutral ellipse reads as a puddle rather than as
    // an absence of light. See `SHADOW_DARKEN`.
    this.shadow = scene.add
      .ellipse(0, 0, 10, 4, 0x000000)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(worldDepth(PLAYER_DISTANCE_INDEX, WORLD_LAYER.shadow))
    this.sprite = scene.add
      .image(0, 0, SNAIL_TEXTURE)
      // Bottom centre: a billboard is positioned by the point where it meets the ground.
      .setOrigin(0.5, 1)
      .setDepth(worldDepth(PLAYER_DISTANCE_INDEX, WORLD_LAYER.player))
  }

  /** Both objects, for the camera `ignore()` lists and for teardown. */
  get gameObjects(): Phaser.GameObjects.GameObject[] {
    return [this.shadow, this.sprite]
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
    look: { invulnerable: boolean; now: number } = { invulnerable: false, now: 0 },
  ): void {
    const trackLength = trackLengthOf(track.length)
    const worldZ = wrapZ(cameraZ + PLAYER_Z, trackLength)
    const index = Math.floor(worldZ / SEGMENT_LENGTH) % track.length
    // How far ahead of the camera's own segment the snail's is. Outside the drawn range it has
    // no projection this frame, which can only happen if `PLAYER_Z` is ever pushed past the draw
    // distance — worth failing quietly rather than drawing against last frame's numbers.
    const ahead = (index - baseIndex + track.length) % track.length

    if (ahead >= DRAW_DISTANCE) {
      this.sprite.setVisible(false)
      this.shadow.setVisible(false)

      return
    }

    const segment = track[index]

    if (!Number.isFinite(segment.s1.scale) || segment.s1.scale <= 0) {
      this.sprite.setVisible(false)
      this.shadow.setVisible(false)

      return
    }

    // The snail is the one object not attached to the segment it is over, so its ground point is
    // interpolated across that segment rather than read off its near edge — see
    // `playerProjection.ts` for the 11.3%-per-segment pop that costs, and `verify:player` for the
    // check that keeps it fixed.
    const ground = playerGroundInto(this.ground, segment.s1, segment.s2, worldZ)

    if (!Number.isFinite(ground.scale) || ground.scale <= 0) {
      this.sprite.setVisible(false)
      this.shadow.setVisible(false)

      return
    }

    // The shadow first, on the ground, at the snail's own `offsetX` — height zero, always. It is
    // the *reference* the jump is read against, so it must never move up with the snail.
    billboardRectInto(
      this.rect,
      ground,
      player.offsetX,
      0,
      DRAW_UNITS.width,
      DRAW_UNITS.height,
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
    this.shadow.setSize(footprint * SHADOW_FOOTPRINT.width * scale, footprint * SHADOW_FOOTPRINT.height * scale)
    this.shadow.setAlpha(shadowAlpha(lift) * SHADOW_DARKEN)

    // Then the snail itself, lifted by its world height through the same helper — so the lift is
    // in the projection's own units and shrinks with distance exactly as the sprite does.
    billboardRectInto(
      this.rect,
      ground,
      player.offsetX,
      player.y,
      DRAW_UNITS.width,
      DRAW_UNITS.height,
      screenWidth,
      screenHeight,
    )

    // The glide frame. Set before the position for no reason but readability; `setTexture` on the
    // key it already holds is a no-op inside Phaser, so this costs nothing on the five frames out
    // of six where nothing changes.
    this.sprite.setTexture(snailFrameKey(Math.floor(distance / GLIDE_UNITS_PER_FRAME)))
    this.sprite.setVisible(true)
    this.sprite.setPosition(this.rect.x, this.rect.y)
    // Squash and stretch is volume-preserving: wider when flatter. Applied here rather than baked
    // into the billboard size so the collision footprint never changes with the animation.
    this.sprite.setDisplaySize(this.rect.w / squash, this.rect.h * squash)
    // The shadow blinks with the snail: a solid shadow under a flickering creature reads as the
    // sprite failing to draw rather than as the creature being briefly untouchable.
    const blink = look.invulnerable && Math.floor(look.now / BLINK_PERIOD_MS) % 2 === 1 ? BLINK_DIM : 1

    this.sprite.setAlpha(blink)
    this.shadow.setAlpha(shadowAlpha(Math.max(0, player.y)) * SHADOW_DARKEN * blink)

    this.screenX = this.rect.x
    this.screenY = this.rect.y
  }

  /** The ground height under the snail, for anything that needs the surface it is standing on. */
  groundHeightAt(track: Segment[], cameraZ: number): number {
    const trackLength = trackLengthOf(track.length)
    const worldZ = wrapZ(cameraZ + PLAYER_Z, trackLength)
    const segment = track[Math.floor(worldZ / SEGMENT_LENGTH) % track.length]

    return surfaceHeight(segment, segmentPercent(worldZ))
  }

  destroy(): void {
    this.sprite.destroy()
    this.shadow.destroy()
  }
}
