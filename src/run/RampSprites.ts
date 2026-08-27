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
 * A wedge, drawn as a billboard like everything else standing on the road.
 *
 * **It reads by its slope, which is the one thing on the road that is not vertical.** Obstacles are
 * upright masses and pickups are floating icons; a shape whose top edge climbs from the ground to a
 * lip is the only thing in the frame that says "this goes up", and it has to say that from far
 * enough away for the player to line up on it.
 *
 * Drawn in the obstacle family's own colours rather than a new hue: a ramp is made of the same
 * timber the crates and the fences are, and this game's one colour rule is that everything is muted
 * except the snail and the things it is steered towards. A ramp is not a reward.
 */
export function createRampTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(RAMP_TEXTURE)) return

  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  const s = (f: number): number => CANVAS * f
  // Ink weight off the geometric mean of the canvas, the rule the obstacles' own art records: a
  // fraction of the width puts a rope round a short shape and a hairline round a tall one.
  const ink = Math.max(2, Math.sqrt(CANVAS * CANVAS) * 0.022)
  const colors = OBSTACLE_MATERIALS.blocking

  // The slope, rising left to right, with the lip at the top of the frame — the billboard's origin
  // is its bottom edge, so this is drawn as it stands on the road.
  const face = [s(0.03), s(1), s(0.97), s(0.1), s(0.97), s(1)]

  g.fillStyle(INK, 1)
  g.fillTriangle(face[0] - ink, face[1] + ink, face[2] + ink, face[3] - ink, face[4] + ink, face[5] + ink)
  g.fillStyle(colors.mid, 1)
  g.fillTriangle(face[0], face[1], face[2], face[3], face[4], face[5])
  // The running surface, lighter than the body: a wedge drawn in one flat colour is a triangle, and
  // a triangle is not a thing that goes up.
  g.fillStyle(colors.light, 1)
  g.fillTriangle(s(0.05), s(0.99), s(0.95), s(0.12), s(0.95), s(0.34))
  // The end wall, so the far side reads as a lip rather than as a point.
  g.fillStyle(colors.dark, 1)
  g.fillRect(s(0.9), s(0.12), s(0.07), s(0.87))

  // **⚠ Chevrons, and they are the only saturated thing on the object.** Two rounds of looking at
  // this in the running game: at 164 x 21 pixels a timber wedge on a pale road is invisible, and
  // the game's own colour rule — everything muted except the snail and what it is steered towards —
  // forbids painting the body bright. A *marking* is the way out: the road already carries pale
  // paint, and a pair of gold chevrons climbing the slope is a road marking that says which way it
  // goes. It is also the one shape in the frame with a direction, which is exactly what a ramp is.
  for (let i = 0; i < 2; i++) {
    const at = 0.3 + i * 0.3
    // Along the slope, so the chevrons lie on the surface rather than standing on it.
    const y = 0.99 - at * 0.84
    const w = 0.1

    g.fillStyle(CHEVRON, 1)
    g.beginPath()
    g.moveTo(s(at + w), s(y - 0.1))
    g.lineTo(s(at + w * 2), s(y - 0.03))
    g.lineTo(s(at + w), s(y + 0.04))
    g.lineTo(s(at + w * 0.55), s(y - 0.03))
    g.closePath()
    g.fillPath()
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
