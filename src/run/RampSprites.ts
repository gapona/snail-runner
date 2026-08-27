import * as Phaser from 'phaser'
import {
  billboardOnScreen,
  billboardRectInto,
  billboardVisibleFraction,
  createBillboardRect,
} from '../road/billboard'
import { billboardAppear, billboardFog, DRAW_DISTANCE, MAX_BILLBOARD_FOG, ROAD_WIDTH, SPRITE_SCALE } from '../road/constants'
import type { Segment } from '../road/track'
import { INK, OBSTACLE_MATERIALS } from './artPalette'
import { RAMP_HEIGHT, type Ramp } from './ramp'
import { WORLD_LAYER, worldDepth } from './worldDepth'

/** The one texture, drawn rather than loaded — a ramp has no render and needs none. */
export const RAMP_TEXTURE = 'ramp-wedge'

const CANVAS = 256

/**
 * The chevron gold — the coin's own `mid`, deliberately.
 *
 * A ramp is not a reward and its body is muted like every other made thing on this road; what is
 * bright is the *marking*, and borrowing the colour the player already reads as "go for this" is
 * cheaper than teaching a new one.
 */
const CHEVRON = 0xf0b024

/**
 * The ramp, seen from behind — which is the only vantage this game has.
 *
 * **⚠ The first version drew it in PROFILE and it was wrong by ninety degrees.** A wedge whose slope
 * rises left to right is a ramp you are looking at from the side, and the player is never to the
 * side: they are directly behind it, running at it. What they saw was a ramp lying across their
 * path, which is a thing you hit rather than a thing you ride. Reported by pointing at a screenshot.
 *
 * So it is drawn receding: the **near edge is wide and on the road, the far edge is narrower and
 * raised**, and between them is the running surface going away from the camera. The narrowing is
 * what makes it read as length rather than as a flat plate — perspective inside a billboard has to
 * be painted, because the projection only scales the whole quad.
 *
 * Three things carry it at the 160-odd pixels it is actually seen at:
 *
 * - the **trapezoid**, which is the only shape on this road that is wider at the bottom;
 * - the **lip**, a darker band capping the far edge, so the surface ends at a raised edge rather
 *   than fading out;
 * - the **chevrons**, pointing away up the slope, and they are the only saturated thing on the
 *   object — see `CHEVRON` for why the body may not be.
 *
 * The billboard is about four times as wide as it is tall, so everything here is drawn tall on a
 * square canvas and comes out flattened. That suits a ramp seen end-on, which really is foreshortened,
 * but it means the shapes have to be few and large: fine detail arrives as a smear.
 */
export function createRampTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(RAMP_TEXTURE)) return

  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  const s = (f: number): number => CANVAS * f
  // Ink weight off the geometric mean of the canvas, the rule the obstacles' own art records: a
  // fraction of the width puts a rope round a short shape and a hairline round a tall one.
  // **⚠ Thin, and the first value was three times this.** At 0.02 of the canvas the ink ring plus
  // the two rails were most of what reached the screen: the ramp came out as a dark trapezoid — a
  // hole in a pale road rather than a thing standing on it. A billboard this flat has very little
  // interior left after a border, so the border has to be a hairline.
  const ink = Math.max(1.5, Math.sqrt(CANVAS * CANVAS) * 0.007)
  // **Sandstone, not crate timber.** `blocking`'s greys are what an upright mass is read against the
  // SKY in; a ramp is read against the ROAD, which is pale warm flagstone, and a mid grey on it is a
  // hole. `low` is the family's own sun-bleached stone and straw — warmer and lighter, so the wedge
  // reads as something raised off the road rather than cut into it.
  const colors = OBSTACLE_MATERIALS.low

  const poly = (points: number[][], color: number): void => {
    g.fillStyle(color, 1)
    g.beginPath()
    g.moveTo(s(points[0][0]), s(points[0][1]))
    for (let i = 1; i < points.length; i++) g.lineTo(s(points[i][0]), s(points[i][1]))
    g.closePath()
    g.fillPath()
  }

  // Near edge at the bottom, full width; far edge at the top, pulled in — the recession.
  const near = 0.5
  const far = 0.3
  const nearY = 1
  const farY = 0.24
  const lipY = 0.05
  const o = ink / CANVAS

  // The silhouette, in ink, one step out from everything drawn over it.
  poly(
    [
      [0.5 - near - o, nearY + o],
      [0.5 + near + o, nearY + o],
      [0.5 + far + o, lipY - o],
      [0.5 - far - o, lipY - o],
    ],
    INK,
  )
  // The running surface. Lighter than the body, because it is the face the light falls on and the
  // face the player is aiming at.
  poly(
    [
      [0.5 - near, nearY],
      [0.5 + near, nearY],
      [0.5 + far, farY],
      [0.5 - far, farY],
    ],
    colors.light,
  )
  // The lip: the raised far edge, capping the surface. Darker, so the ramp ends on an edge rather
  // than dissolving into the road behind it.
  poly(
    [
      [0.5 - far, farY],
      [0.5 + far, farY],
      [0.5 + far, lipY],
      [0.5 - far, lipY],
    ],
    colors.mid,
  )
  // Rails down both sides, so the surface has thickness and the eye has two converging lines to
  // read the recession off.
  for (const side of [-1, 1]) {
    poly(
      [
        [0.5 + side * near, nearY],
        [0.5 + side * (near - 0.03), nearY],
        [0.5 + side * (far - 0.02), farY],
        [0.5 + side * far, farY],
      ],
      colors.dark,
    )
  }

  // **⚠ Chevrons, and they are the only saturated thing on the object.** Two rounds of looking at
  // this in the running game: a timber ramp on a pale road is invisible, and the game's own colour
  // rule — everything muted except the snail and what it is steered towards — forbids painting the
  // body bright. A *marking* is the way out: the road already carries pale paint, and arrows
  // pointing away up the surface are a road marking that says which way it goes.
  for (let i = 0; i < 3; i++) {
    const t = 0.12 + i * 0.27
    const y = nearY - t * (nearY - farY)
    // Narrowing with the surface, so they lie on it rather than floating over it.
    const w = 0.3 - t * 0.14
    const h = 0.15

    poly(
      [
        [0.5, y - h],
        [0.5 + w, y],
        [0.5 + w * 0.45, y],
        [0.5, y - h * 0.5],
        [0.5 - w * 0.45, y],
        [0.5 - w, y],
      ],
      CHEVRON,
    )
  }

  g.generateTexture(RAMP_TEXTURE, CANVAS, CANVAS)
  g.destroy()
}

/** How many ramps may be on screen at once. They are laid ~210 segments apart; two is generous. */
export const RAMP_POOL_SIZE = 4

/**
 * Every ramp on screen, from a fixed pool.
 *
 * The same shape as `ObstacleSprites` and under the same rules: near-to-far, no shadow (it lies on
 * the road, and a shadow under something already touching the ground is a dark rim nobody can
 * read), depth per object per frame from `worldDepth`, and it **must run after `WorldView.render`**
 * because it reads that pass's per-segment projections and hill clip.
 */
export class RampSprites {
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]

  usedLastFrame = 0

  private readonly slots: Phaser.GameObjects.Image[]
  private readonly cropped: boolean[]
  private readonly rect = createBillboardRect()

  constructor(scene: Phaser.Scene, poolSize = RAMP_POOL_SIZE) {
    createRampTexture(scene)

    this.slots = Array.from({ length: poolSize }, () =>
      scene.add.image(0, 0, RAMP_TEXTURE).setOrigin(0.5, 1).setVisible(false),
    )
    this.cropped = this.slots.map(() => false)
    this.gameObjects = this.slots
  }

  render(
    bySegment: ReadonlyMap<number, Ramp[]>,
    track: Segment[],
    baseIndex: number,
    clipY: readonly number[],
    screenWidth: number,
    screenHeight: number,
  ): void {
    const previousUsed = this.usedLastFrame
    let used = 0

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const index = (baseIndex + n) % track.length
      const here = bySegment.get(index)

      if (!here || here.length === 0) continue

      const ground = track[index].s1

      if (!Number.isFinite(ground.scale) || ground.scale <= 0) continue

      for (const ramp of here) {
        if (used >= this.slots.length) break

        const rect = billboardRectInto(
          this.rect,
          ground,
          ramp.offsetX,
          0,
          (ramp.halfWidths * 2 * ROAD_WIDTH) / SPRITE_SCALE,
          RAMP_HEIGHT / SPRITE_SCALE,
          screenWidth,
          screenHeight,
        )
        const visible = billboardVisibleFraction(rect, clipY[n])

        if (!billboardOnScreen(rect, visible, screenWidth, screenHeight)) continue

        const image = this.slots[used]

        image.setVisible(true)
        image.setPosition(rect.x, rect.y)
        image.setDisplaySize(rect.w, rect.h)
        image.setDepth(worldDepth(n, WORLD_LAYER.obstacle))
        // The same distance haze obstacles and pickups take, so a ramp does not read as pasted onto
        // a faded world — and the same combat ceiling, because lining up on one is a thing the
        // player has to be able to do at range.
        image.setAlpha(billboardAppear(n) * (1 - billboardFog(n) * MAX_BILLBOARD_FOG))

        if (visible < 1) {
          image.setCrop(0, 0, image.frame.realWidth, image.frame.realHeight * visible)
          this.cropped[used] = true
        } else if (this.cropped[used]) {
          image.setCrop(0, 0, image.frame.realWidth, image.frame.realHeight)
          this.cropped[used] = false
        }
        used++
      }
    }

    for (let i = used; i < previousUsed; i++) this.slots[i].setVisible(false)
    this.usedLastFrame = used
  }

  destroy(): void {
    for (const slot of this.slots) slot.destroy()
  }
}
