import * as Phaser from 'phaser'
import { DRAW_DISTANCE, ROAD_MESH_DEPTH } from './constants'
import { createDecalAtlas, decalCellU, decalCellV } from './decalArt'
import { DECAL_DRAW_SEGMENTS, DECAL_POOL_SIZE, decalAt, decalFade, decalRowFor } from './decals'
import type { Segment } from './track'
import { OrderedQuads } from './meshIndices'

/** Floats per vertex in a `Mesh2D` vertex buffer: `x, y, u, v`. */
const VERTEX_STRIDE = 4

/** Floats per quad: four vertices. */
const QUAD_VERTEX_STRIDE = VERTEX_STRIDE * 4

/** Entries per triangle in a `Mesh2D` index buffer: `a, b, c, page`. */
const INDEX_STRIDE = 4

/**
 * Hands the mesh a typed-array index list. See `RoadMesh`'s copy for why the cast is safe: Phaser
 * types `indicesOrdered` as `number[]` and the renderer only reads `ordered[i]` and `ordered.length`.
 */
function setOrderedIndices(mesh: Phaser.GameObjects.Mesh2D, indices: Uint32Array): void {
  ;(mesh as unknown as { indicesOrdered: ArrayLike<number> }).indicesOrdered = indices
}

/**
 * The ground's own marks: stains, cracks, skids and scatter lying in the plane of the ribbon.
 *
 * **A second `Mesh2D`, not more billboards, and that is the whole point of the class.** Everything
 * else standing on the ground is a sprite facing the camera; a mark on the floor is not standing on
 * anything, and drawing one as a squashed sprite would keep it flat only for as long as the road
 * ran straight. These are real quads built from the *same projected segment edges the road itself
 * was drawn from this frame*, so a mark bends with the bend, climbs with the hill, and cannot drift
 * off the surface it is painted on — the same argument `RoadSprites` makes for reading `s1` out of
 * the mesh's pass rather than re-projecting.
 *
 * **It must run after `RoadMesh.render` and before the billboards**, for that reason and for its
 * depth: the ground is at `ROAD_MESH_DEPTH` and scenery at `-n`, so the marks sit between them.
 *
 * **Multiply blend, one texture, no tint.** A decal darkens whatever it lies on, so it needs no
 * per-biome variant and no palette to pick one — see `decalArt.ts`. What it cannot do is get its
 * own opacity from the object, since a `Mesh2D` has one tint and no per-vertex colour, so the
 * strength rides in the texture's V instead.
 */
export class DecalMesh {
  /** The single Game Object this class owns, for camera `ignore()` lists. */
  readonly gameObject: Phaser.GameObjects.Mesh2D

  /** How many marks the last frame drew, for the DEV pool-pressure report. */
  usedLastFrame = 0

  /** How many it wanted, which is the number the pool ceiling has to answer. */
  wantedLastFrame = 0

  private readonly vertices: number[]

  /**
   * The ordered index list and its per-count truncations — see `meshIndices.ts`.
   *
   * **This mesh is the sharpest case that helper exists for.** `DECAL_DENSITY` is 0 — a dark patch
   * on the ground means one thing in this game now, and these marks are off — so `render` draws
   * nothing at all, and every one of the pool's 96 quads was still walked and transformed by the
   * submitter every frame. Measured at **0.043ms a frame for an empty mesh**. Truncating to `used`
   * makes that zero, and makes it right again by itself the day marks come back.
   */
  private readonly ordered = new OrderedQuads(DECAL_POOL_SIZE)

  constructor(scene: Phaser.Scene) {
    this.vertices = new Array<number>(DECAL_POOL_SIZE * QUAD_VERTEX_STRIDE).fill(0)

    // Same winding as `RoadMesh`: v0 far-left, v1 near-left, v2 far-right, v3 near-right, which
    // `buildOrderedIndices` pairs into one quad read as TL, BL, TR, BR.
    const indices: number[] = new Array<number>(DECAL_POOL_SIZE * 2 * INDEX_STRIDE)

    for (let quad = 0; quad < DECAL_POOL_SIZE; quad++) {
      const v = quad * 4
      const i = quad * 2 * INDEX_STRIDE

      indices[i] = v
      indices[i + 1] = v + 1
      indices[i + 2] = v + 2
      indices[i + 3] = 0

      indices[i + 4] = v + 1
      indices[i + 5] = v + 2
      indices[i + 6] = v + 3
      indices[i + 7] = 0
    }

    // `flipV: true`, the same as the road's — and for the same reason, which cost this project a
    // long-lived bug once already: the default hands V straight to GL, which samples bottom-up, so
    // every cell would be read from the wrong row of the atlas.
    this.gameObject = scene.add.mesh2d(0, 0, createDecalAtlas(scene), this.vertices, indices, true)
    // Built by hand rather than by `buildOrderedIndices`, for the reason `meshIndices.ts` gives:
    // truncating the list is only correct if quad `i` provably occupies entries `i * 8 ..`.
    this.gameObject.setUseOrderedIndices(true)
    setOrderedIndices(this.gameObject, this.ordered.all)
    this.gameObject.renderAsTriangles = false
    this.gameObject.setBlendMode(Phaser.BlendModes.MULTIPLY)
    // Above the ground it is painted on, below the nearest billboard (depth 0) that may stand on
    // it. There is no depth buffer anywhere in this renderer; draw order is the whole depth test.
    this.gameObject.setDepth(ROAD_MESH_DEPTH + 1)
  }

  /**
   * Rewrites the vertex buffer for this frame.
   *
   * `track` must already carry this frame's projections — `RoadMesh.render` writes them into each
   * segment's own `s1`/`s2` — and `clipY` must be the same pass's. Walked near to far so that the
   * marks nearest the camera get the slots when the pool is short, which is where they are largest
   * and most obviously missing.
   */
  /** What this frame drew and where, for the DEV mark overlay. Empty in a production build. */
  readonly drawnMarks: { x: number; y: number; kind: string }[] = []

  render(track: Segment[], baseIndex: number, clipY: readonly number[]): void {
    const vertices = this.vertices
    let used = 0
    let wanted = 0

    if (import.meta.env.DEV) this.drawnMarks.length = 0

    for (let n = 0; n < DECAL_DRAW_SEGMENTS && n < DRAW_DISTANCE; n++) {
      const index = baseIndex + n
      // The track's length is what turns a segment index into a biome, and the biome is what
      // decides which marks may lie here at all -- see `Biome.decals`.
      const decal = decalAt(index, track.length)

      if (!decal) continue

      const near = track[index % track.length]
      // The far end of the mark: the segment its length reaches, still inside the drawn band.
      const farIndex = Math.min(n + decal.lengthSegments, DRAW_DISTANCE - 1)
      const far = track[(baseIndex + farIndex) % track.length]
      const s1 = near.s1
      const s2 = far.s2

      // The same three conditions the mesh culls its own quads by, and they have to be the same:
      // a mark lies on a road quad, so it is visible exactly when that quad is. `s2.y >= clipY[n]`
      // is the running horizon clip — the hill in front of this segment hides what is on it.
      if (!Number.isFinite(s1.scale) || s1.scale <= 0 || s2.y >= s1.y || s2.y >= clipY[n]) continue

      // Faded on the ground's own curve, renormalised so a mark is gone before the band ends
      // rather than winking out at its edge — see `decalFade`.
      const row = decalRowFor(decal.strength, decalFade(n))

      if (row < 0) continue

      wanted++

      // Past capacity the loop keeps counting and stops drawing, so `wantedLastFrame` stays an
      // honest measure of demand — the lesson the decor pool taught by reporting its own ceiling.
      if (used >= DECAL_POOL_SIZE) continue

      const { u0, u1 } = decalCellU(decal.kindIndex)
      const { v0, v1 } = decalCellV(row)
      // Mirroring costs nothing and doubles four shapes into eight; swapping the U ends is all it
      // takes on a mesh, where a sprite would need a flip flag.
      const uLeft = decal.flipX ? u1 : u0
      const uRight = decal.flipX ? u0 : u1

      this.writeQuad(
        used++,
        s2.y,
        s2.x + (decal.offsetX - decal.halfWidth) * s2.w,
        s2.x + (decal.offsetX + decal.halfWidth) * s2.w,
        s1.y,
        s1.x + (decal.offsetX - decal.halfWidth) * s1.w,
        s1.x + (decal.offsetX + decal.halfWidth) * s1.w,
        uLeft,
        uRight,
        v0,
        v1,
      )

      // DEV only, and it is the reason this array exists: a dark patch on the road has exactly two
      // possible sources, and the only way to tell which one a given patch is is to ask the thing
      // that drew it. See `DebugMarks`.
      if (import.meta.env.DEV) {
        this.drawnMarks.push({ x: s1.x + decal.offsetX * s1.w, y: s1.y, kind: decal.kind })
      }
    }

    // **⚠ The unused slots used to be degenerated, and that is no longer what stops them drawing.**
    // The index buffer was a fixed length, so a slot left unwritten kept last frame's geometry —
    // true while every quad was submitted, and it made an empty mesh cost as much as a full one.
    // Now the list is cut to what was written, so the tail is unread rather than collapsed, and
    // `used === 0` submits nothing at all.
    setOrderedIndices(this.gameObject, this.ordered.first(used))

    this.usedLastFrame = used
    this.wantedLastFrame = wanted
  }

  destroy(): void {
    this.gameObject.destroy()
  }

  /** One trapezoid, with its own UV rectangle. Winding as set up in the constructor. */
  private writeQuad(
    quad: number,
    farY: number,
    farLeftX: number,
    farRightX: number,
    nearY: number,
    nearLeftX: number,
    nearRightX: number,
    uLeft: number,
    uRight: number,
    vFar: number,
    vNear: number,
  ): void {
    const v = this.vertices
    const o = quad * QUAD_VERTEX_STRIDE

    v[o] = farLeftX
    v[o + 1] = farY
    v[o + 2] = uLeft
    v[o + 3] = vFar

    v[o + 4] = nearLeftX
    v[o + 5] = nearY
    v[o + 6] = uLeft
    v[o + 7] = vNear

    v[o + 8] = farRightX
    v[o + 9] = farY
    v[o + 10] = uRight
    v[o + 11] = vFar

    v[o + 12] = nearRightX
    v[o + 13] = nearY
    v[o + 14] = uRight
    v[o + 15] = vNear
  }
}
