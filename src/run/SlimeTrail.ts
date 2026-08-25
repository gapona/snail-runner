import * as Phaser from 'phaser'
import { DRAW_DISTANCE, ROAD_MESH_DEPTH, ROAD_WIDTH, SEGMENT_LENGTH } from '../road/constants'
import { createScreenPoint, wrapZ, type ScreenPoint } from '../road/project'
import { trackLengthOf, type Segment } from '../road/track'
import { playerGroundInto } from './playerProjection'
import { slimeFade, SLIME_NEAR_CULL_Z, type SlimePoint } from './slime'

/**
 * The slime trail, drawn as one ribbon of quads lying on the road.
 *
 * **A ribbon rather than a pool of sprites, and the difference is perspective.** A trail made of
 * billboarded blobs is a row of vertical stamps: each one faces the camera, so the trail reads as a
 * line of stickers standing on the tarmac rather than as a mark *on* it. Filling a quad between
 * each pair of consecutive points instead means the near end is genuinely wider than the far end,
 * because both edges come out of the road's own projection — the same thing `DecalMesh` does for
 * the track's baked marks, which is the shape the road layer already established for anything lying
 * flat.
 *
 * It is also cheaper: one `Graphics` and about thirty quads against forty pooled `Image`s.
 *
 * **Depth puts it just above the road and below everything else in the world.** A mark on the
 * ground is under anything standing on the ground, at every distance — so unlike obstacles and
 * pickups this does *not* join `worldDepth`'s distance sort. `DecalMesh` sits in the same place for
 * the same reason.
 *
 * **Must run after `WorldView.render` in the same frame**, like every other consumer of the mesh
 * pass: it reads each point's segment projection straight out of it.
 */
export const SLIME_DEPTH = ROAD_MESH_DEPTH + 0.5

/**
 * The two passes: a dull wet body and a narrower bright core.
 *
 * **One flat colour reads as paint, not as slime.** What makes something look wet is a broad dull
 * area with a specular streak down the middle of it, and two fills is the cheapest way to have one.
 * The core is drawn at a fraction of the body's width and a little brighter than the snail's own
 * light green, so the trail reads as coming *off* the snail rather than as a road marking.
 */
const BODY_COLOR = 0x9fc24a
const CORE_COLOR = 0xe8f7a6

/** How much of the body's width the bright core takes. */
const CORE_WIDTH = 0.42

export class SlimeTrail {
  readonly gameObject: Phaser.GameObjects.Graphics

  /** Quads filled last frame — the DEV perf report's only interest here. */
  usedLastFrame = 0

  /**
   * One reusable projection slot, so a frame allocates nothing.
   *
   * One is enough because an `Edge` holds copied numbers rather than a reference — the slot is only
   * live inside `edgeFor`, and `previous` keeps nothing that could alias it.
   */
  private readonly ground: ScreenPoint = createScreenPoint()

  constructor(scene: Phaser.Scene) {
    this.gameObject = scene.add.graphics().setDepth(SLIME_DEPTH)
  }

  /**
   * Redraws the whole ribbon.
   *
   * Cleared and refilled every frame rather than accumulated: the points move relative to the
   * camera continuously, so there is nothing about last frame's geometry worth keeping.
   */
  render(
    points: readonly SlimePoint[],
    track: Segment[],
    baseIndex: number,
    cameraZ: number,
    screenWidth: number,
  ): void {
    const g = this.gameObject

    g.clear()
    this.usedLastFrame = 0

    if (points.length < 2) return

    const trackLength = trackLengthOf(track.length)
    let previous: Edge | null = null

    for (const point of points) {
      const edge = this.edgeFor(point, track, baseIndex, cameraZ, trackLength, screenWidth)

      if (!edge) {
        previous = null
        continue
      }

      if (previous) {
        // Two fills per pair: the wet body, then the core inside it. Alpha is the mean of the two
        // ends' own alphas, which is what makes the ribbon fade smoothly along its length without
        // needing a gradient fill Graphics does not have.
        const alpha = (previous.alpha + edge.alpha) / 2

        if (alpha > 0.01) {
          this.quad(g, previous.leftX, previous.y, edge.leftX, edge.y, edge.rightX, previous.rightX, BODY_COLOR, alpha)
          this.quad(
            g,
            previous.coreLeftX,
            previous.y,
            edge.coreLeftX,
            edge.y,
            edge.coreRightX,
            previous.coreRightX,
            CORE_COLOR,
            alpha * 0.8,
          )
          this.usedLastFrame += 2
        }
      }

      previous = edge
    }
  }

  /** One trapezoid, given its two rows and four x's. */
  private quad(
    g: Phaser.GameObjects.Graphics,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    x3: number,
    color: number,
    alpha: number,
  ): void {
    g.fillStyle(color, alpha)
    g.beginPath()
    g.moveTo(x0, y0)
    g.lineTo(x1, y1)
    g.lineTo(x2, y1)
    g.lineTo(x3, y0)
    g.closePath()
    g.fillPath()
  }

  /**
   * Projects one point into a screen row and its four x's, or `null` if it is not drawable.
   *
   * The ground projection is `playerProjection.ts`'s, interpolated across the segment — and for the
   * same reason it exists for the snail: a slime point sits at a fixed `z` while the segment under
   * it changes, so reading the segment's near edge would make the whole ribbon jump by 11% every
   * time one of its points crossed a boundary.
   */
  private edgeFor(
    point: SlimePoint,
    track: Segment[],
    baseIndex: number,
    cameraZ: number,
    trackLength: number,
    screenWidth: number,
  ): Edge | null {
    const ahead = wrapZ(point.z - cameraZ, trackLength)

    // Dropped before anything is projected: see `SLIME_NEAR_CULL_Z` for the 668-pixel quad this
    // avoids filling entirely below the frame.
    if (ahead < SLIME_NEAR_CULL_Z) return null

    const index = Math.floor(wrapZ(point.z, trackLength) / SEGMENT_LENGTH) % track.length
    const distanceIndex = (index - baseIndex + track.length) % track.length

    if (distanceIndex >= DRAW_DISTANCE) return null

    const segment = track[index]

    if (!Number.isFinite(segment.s1.scale) || segment.s1.scale <= 0) return null

    const ground = playerGroundInto(this.ground, segment.s1, segment.s2, wrapZ(point.z, trackLength))

    if (!Number.isFinite(ground.scale) || ground.scale <= 0) return null

    // The same conversion `billboardRectInto` does for an offset across the road, without building
    // a rect: this needs two x's per row rather than a centre and a width.
    const widthScale = (ground.scale * screenWidth) / 2
    const centreX = ground.x + widthScale * point.offsetX * ROAD_WIDTH
    const halfPx = widthScale * point.halfWidth * ROAD_WIDTH
    const alpha = point.strength * slimeFade(ahead)

    return {
      y: ground.y,
      leftX: centreX - halfPx,
      rightX: centreX + halfPx,
      coreLeftX: centreX - halfPx * CORE_WIDTH,
      coreRightX: centreX + halfPx * CORE_WIDTH,
      alpha,
    }
  }

  destroy(): void {
    this.gameObject.destroy()
  }
}

interface Edge {
  y: number
  leftX: number
  rightX: number
  coreLeftX: number
  coreRightX: number
  alpha: number
}
