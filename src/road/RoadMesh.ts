import * as Phaser from 'phaser'
import {
  CAMERA_DEPTH,
  CAMERA_HEIGHT,
  DRAW_DISTANCE,
  fogStepFor,
  GROUND_EXTENT,
  groundPaletteIndex,
  hasRung,
  PALETTE_INDEX,
  paletteU,
  paletteV,
  ROAD_MESH_DEPTH,
  ROAD_WIDTH,
  RUMBLE_WIDTH_FRACTION,
} from './constants'
import { logWarning } from '../platform/yt'
import { biomeForSegment, biomeIndex } from './biomes'
import { quadWriteAction } from './meshGuard'
import { createRoadPalette } from './palette'
import { projectInto, type ScreenPoint } from './project'
import { createRungQuad, rungQuadInto, type RungQuad } from './surface'
import { findSegment, segmentPercent, surfaceHeight, trackLengthOf, type Segment } from './track'

const PALETTE_TEXTURE_KEY = 'road-palette'

/**
 * Quads per segment: the ground on each side, the asphalt trapezoid, a rumble stripe on each
 * side, and the centre dash.
 *
 * The dash is a full slot even on segments that do not draw one. **It has to be** — the index
 * buffer is built once at a fixed length, so a segment that simply wrote fewer quads would not
 * shift anything, it would leave the previous frame's geometry sitting in the unwritten slot.
 * Same rule as a culled segment: degenerate it, never skip it.
 */
const QUADS_PER_SEGMENT = 6

/** Total quads in the mesh — fixed for the mesh's whole lifetime. See the class docstring. */
const QUAD_COUNT = DRAW_DISTANCE * QUADS_PER_SEGMENT

/**
 * Whether the production overflow path has already reported this session.
 *
 * Module-level rather than per-instance: the point is one report per *session*, and a scene
 * restart builds a new mesh. Per-instance would report again on every restart, which for a game
 * the player retries is most of the way back to per-frame spam.
 */
let overflowReported = false

/** Floats per vertex in a Mesh2D vertex buffer: `x, y, u, v`. */
const VERTEX_STRIDE = 4

/** Floats per quad: 4 vertices x `VERTEX_STRIDE`. */
const QUAD_VERTEX_STRIDE = VERTEX_STRIDE * 4

/** Entries per triangle in a Mesh2D index buffer: `a, b, c, page`. */
const INDEX_STRIDE = 4

/**
 * The whole road surface, rendered as a single `Mesh2D`.
 *
 * **Topology is fixed; only vertex positions and UVs change.** The mesh always holds exactly
 * `QUAD_COUNT` quads, whatever the camera sees. `indices` is built once in the constructor
 * and `buildOrderedIndices(2, true)` runs there too — neither is ever touched again, and
 * `render()` below writes only into `mesh.vertices`. That is what makes the per-frame cost
 * pure array writes with no reallocation and no index rebuild.
 *
 * The consequence, and the one non-obvious rule here: **a culled segment cannot be skipped.**
 * Its slot in the buffer still exists and its indices still reference four vertices, so
 * skipping it would leave last frame's geometry behind and shift nothing. Culled segments are
 * *degenerated* instead — all four vertices collapsed onto one point — and the rasteriser
 * discards the zero-area triangles for free. See `degenerateSegment`.
 *
 * `renderAsTriangles` stays `false` so the mesh routes through the quad batch handler and can
 * batch together with ordinary sprites — which matters from chunk 4, when billboards join the
 * scene.
 */
export class RoadMesh {
  /** The single Game Object this class owns. Callers need it for camera `ignore()` lists. */
  readonly gameObject: Phaser.GameObjects.Mesh2D

  /**
   * Per-segment screen y below which nothing on that segment is visible, indexed by distance
   * from the base segment. Rewritten every `render()`; meaningless outside that frame.
   *
   * **This is a deliberate leak of the mesh's internals, and it must not be tidied away.**
   * The horizon clip (`maxY` in `render`) is the only thing in the renderer that knows a hill
   * is standing in front of something, and billboards need exactly that: without it, scenery
   * in a dip beyond a crest draws straight through the hillside, which reads as the ground
   * being transparent rather than as a depth error. There is no depth buffer to ask instead —
   * the whole renderer is painter's-order — and recomputing the clip outside would mean
   * re-walking every segment and re-integrating the curvature, i.e. running the entire render
   * pass twice to recover a number this one already had.
   *
   * The consumer is `RoadSprites.render`, which must therefore run *after* this one in the
   * same frame. See its class docstring for the other half of this contract.
   */
  readonly clipY: number[] = new Array<number>(DRAW_DISTANCE).fill(0)

  /** Index of the segment the camera is inside, as of the last `render()`. */
  baseIndex = 0

  /**
   * The centreline's accumulated lateral offset at the far end of the draw distance, and the
   * camera's height above the ground — both as of the last `render()`.
   *
   * Published for the sky parallax, which needs exactly the two quantities that move the
   * horizon and has no way to derive either: the drift is the *integral* of the track's
   * curvature from the camera outwards, which only this loop computes, and the height comes
   * from the surface under the camera. Same deliberate leak as `clipY`, and the same rule —
   * meaningless outside the frame that wrote it.
   */
  horizonDriftX = 0
  cameraY = 0

  private readonly track: Segment[]
  private readonly trackLength: number
  /** Reusable rung corners, so the marking allocates nothing per segment per frame. */
  private readonly rung: RungQuad = createRungQuad()

  private readonly vertices: number[]

  constructor(scene: Phaser.Scene, track: Segment[]) {
    this.track = track
    this.trackLength = trackLengthOf(track.length)

    const paletteTexture = createRoadPalette(scene, PALETTE_TEXTURE_KEY)

    this.vertices = new Array<number>(QUAD_COUNT * QUAD_VERTEX_STRIDE).fill(0)

    // Two triangles per quad, wound so that they share the v1-v2 edge:
    //
    //   v0 ---- v2      triangle A = v0, v1, v2
    //   |  \     |      triangle B = v1, v2, v3
    //   v1 ---- v3      shared edge = v1, v2
    //
    // buildOrderedIndices() detects that shared edge and emits the pair as one quad
    // (p=v0, q=v1, r=v2, s=v3), which the renderer consumes as TL, BL, TR, BR. Vertex
    // indices are unique per quad, so no two quads can ever be mis-paired with each other.
    const indices: number[] = new Array<number>(QUAD_COUNT * 2 * INDEX_STRIDE)

    for (let quad = 0; quad < QUAD_COUNT; quad++) {
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

    // **`flipV` is `true`, and leaving it at the factory default was a real bug that shipped.**
    // Phaser's default is `false`, which hands the geometry's V straight to GL — and GL samples
    // textures bottom-up, so `paletteV(0)` (the unfogged row, drawn at canvas y=0) was read as the
    // row at the *bottom* of the palette, which is full fog. Distance fog therefore ran backwards
    // for its entire life: the nearest segments were the most fogged and the horizon was clear.
    //
    // It was invisible for as long as it lasted because every palette in the game was a night
    // palette — fog toward 0x0b0d12 over asphalt at 0x1d1f26 is a change of a few units either
    // way. It became glaring the moment a daylight theme fogged toward near-white. Found by
    // painting the fog colour magenta and screenshotting: the *near* road came back pure magenta.
    this.gameObject = scene.add.mesh2d(0, 0, paletteTexture, this.vertices, indices, true)

    // Built exactly once, here, because the topology never changes. The second argument
    // sets `useOrderedIndices` — without it the ordered list is built but never consumed,
    // and the mesh silently falls back to submitting one degenerate quad per triangle.
    this.gameObject.buildOrderedIndices(2, true)
    this.gameObject.renderAsTriangles = false
    // Below every billboard: scenery draws at `-n` for its distance index, so the nearest
    // possible one is depth 0 and the ground has to sit under all of them.
    this.gameObject.setDepth(ROAD_MESH_DEPTH)
  }

  /**
   * Rewrites the mesh's vertex buffer for the current camera position.
   *
   * Segments are walked near-to-far so the running `maxY` horizon clip works (each drawn
   * segment lowers the ceiling for everything behind it), but written far-to-near so the
   * painter's-algorithm draw order is correct: nearer quads are submitted later and paint
   * over farther ones. There is no depth buffer involved.
   *
   * `playerX` is in road half-widths: `0` is the centreline, `-1`/`+1` the road edges. It is
   * always `0` until chunk 3 adds steering, but the parameter exists now so that landing
   * steering does not change this signature.
   *
   * The camera's height and lateral position are *derived* here rather than passed in —
   * height from the road surface under the camera, lateral position from the integrated
   * curvature ahead of it — so neither can be supplied by the caller any more.
   */
  render(playerX: number, cameraZ: number, screenWidth: number, screenHeight: number): void {
    const track = this.track
    const base = findSegment(track, cameraZ)

    this.baseIndex = base.index

    // How far the camera sits through its own segment. Drives both the height interpolation
    // below and the partial curvature already "spent" on the segment the camera is inside.
    const basePercent = segmentPercent(cameraZ)

    // Ride the road surface instead of a fixed plane: without this the camera keeps its
    // absolute height and so ploughs through the inside of a hill and floats over a dip.
    const cameraY = surfaceHeight(base, basePercent) + CAMERA_HEIGHT

    this.cameraY = cameraY

    // Curvature is integrated, not stored as geometry (see track.ts). `x` is the centreline's
    // accumulated lateral offset at the current segment and `dx` the per-segment increment.
    // `dx` starts at minus the fraction of the base segment's curve the camera has already
    // driven through, so the road does not jolt sideways as the camera crosses into a new
    // segment — the accumulation must begin from where the camera actually is, not from the
    // segment boundary behind it.
    let x = 0
    let dx = -(base.curve * basePercent)
    let maxY = screenHeight

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const segment = track[(base.index + n) % track.length]

      // A segment whose index has fallen behind the base one is past the loop seam: it must
      // be projected as if the camera were one track-length back, otherwise it would appear
      // behind the camera and the road would visibly tear once per lap.
      const looped = segment.index < base.index
      const relativeCameraZ = looped ? cameraZ - this.trackLength : cameraZ

      // Near and far edges get different camera-x values: the difference between them IS the
      // bend across this segment. Sharing one value would render every segment as a straight
      // slab and lose the curve entirely.
      const s1 = projectInto(
        segment.s1,
        segment.p1,
        playerX * ROAD_WIDTH - x,
        cameraY,
        relativeCameraZ,
        CAMERA_DEPTH,
        screenWidth,
        screenHeight,
        ROAD_WIDTH,
      )
      const s2 = projectInto(
        segment.s2,
        segment.p2,
        playerX * ROAD_WIDTH - x - dx,
        cameraY,
        relativeCameraZ,
        CAMERA_DEPTH,
        screenWidth,
        screenHeight,
        ROAD_WIDTH,
      )

      // Advanced for EVERY segment, before any culling: a culled segment still bends the road
      // for everything behind it. Skipping the accumulation would straighten the far half of
      // a curve the moment its near half fell off the bottom of the screen.
      x += dx
      dx += segment.curve

      // Written back-to-front: slot 0 is the farthest segment, so it is submitted first.
      const slot = DRAW_DISTANCE - 1 - n

      // Recorded for EVERY segment, before the cull below, and using the clip established by
      // the nearer segments already walked. A culled segment is precisely the case that
      // matters: it is culled because a hill in front of it hides it, and a billboard standing
      // on it has to be hidden by that same hill. See the `clipY` field's docstring.
      this.clipY[n] = maxY

      // Three cull conditions:
      // - `scale <= 0` is behind the camera. The non-finite check is not paranoia: on the
      //   very first frame `cameraZ` is exactly 0, which puts the base segment's near edge
      //   exactly on the camera plane and makes `scale` Infinity — which passes a naive
      //   `> 0` test and would write NaN coordinates into the buffer.
      // - `s2.y >= s1.y` means the far edge projected *below* the near one, i.e. the segment
      //   is inside-out on screen. Only reachable once hills exist (a crest flips the
      //   ordering just past its peak) and it renders as a bow-tie if drawn.
      // - `s2.y >= maxY` is the running horizon clip: already hidden behind nearer road.
      if (!Number.isFinite(s1.scale) || s1.scale <= 0 || s2.y >= s1.y || s2.y >= maxY) {
        this.degenerateSegment(slot)
        continue
      }

      // The fog row is chosen by how far this segment is from the camera, and travels to
      // the GPU as the quad's V — no tint, no second pass. See `createRoadPalette`.
      this.writeSegment(
        slot,
        s1,
        s2,
        segment.alternate,
        hasRung(segment.index),
        paletteV(fogStepFor(n)),
        // Derived from the segment index rather than stored on the segment: it costs nothing to
        // ask and cannot drift out of sync with itself. See `biomeForSegment`.
        biomeIndex(biomeForSegment(segment.index, track.length).id),
      )
      maxY = s2.y
    }

    // What the curvature integration ended up at: the horizon's lateral offset, for the sky.
    this.horizonDriftX = x

    // No dirty flag to set: Mesh2D's WebGL renderer reads `vertices` straight off the object
    // every frame (verified in node_modules/phaser/src/renderer/webgl/renderNodes/submitter/
    // SubmitterMeshToQuad.js), so mutating the array in place is the whole update.
  }

  /**
   * Re-points the mesh at a freshly built palette, after a theme swap.
   *
   * **The palette is the one themed texture nothing else can re-point for us.** `createRoadPalette`
   * removes and rebuilds its own key, which leaves this mesh holding a destroyed `Texture` object
   * — the mesh keeps a reference, not a key, so a swap without this either draws the old theme's
   * colours or throws inside the renderer on the next frame. It never mattered while the only
   * caller of `applyTheme` was a menu with no road in it; the menu has a road now.
   */
  refreshPalette(scene: Phaser.Scene): void {
    // Rebuilt first, then handed over by key: `setTexture` takes a key here, and the rebuild is
    // what makes that key point at the new theme's pixels.
    createRoadPalette(scene, PALETTE_TEXTURE_KEY)
    this.gameObject.setTexture(PALETTE_TEXTURE_KEY)
  }

  destroy(): void {
    this.gameObject.destroy()
  }

  /**
   * Writes one segment's quads: the two ground bands, the asphalt trapezoid, the two rumble
   * stripes flanking it, and the surface rung.
   */
  private writeSegment(
    slot: number,
    s1: ScreenPoint,
    s2: ScreenPoint,
    alternate: boolean,
    rung: boolean,
    fogV: number,
    biome: number,
  ): void {
    const roadU = paletteU(alternate ? PALETTE_INDEX.ASPHALT_DARK : PALETTE_INDEX.ASPHALT_LIGHT)
    const rumbleU = paletteU(alternate ? PALETTE_INDEX.RUMBLE_DARK : PALETTE_INDEX.RUMBLE_LIGHT)
    const groundU = paletteU(groundPaletteIndex(biome, alternate))

    const near = slot * QUADS_PER_SEGMENT
    const rumble1 = s1.w * RUMBLE_WIDTH_FRACTION
    const rumble2 = s2.w * RUMBLE_WIDTH_FRACTION
    const ground1 = s1.w * GROUND_EXTENT
    const ground2 = s2.w * GROUND_EXTENT

    // Ground first, so everything else is drawn over it. Within one segment the quads share a
    // slot range and are submitted in order, and the road/rumble overlap the ground's inner edge
    // by design — an exact abutment leaves a seam of background showing through wherever the two
    // trapezoids disagree by less than a pixel.
    this.writeQuad(
      near,
      s2.y,
      s2.x - ground2,
      s2.x - s2.w - rumble2,
      s1.y,
      s1.x - ground1,
      s1.x - s1.w - rumble1,
      groundU,
      fogV,
    )
    this.writeQuad(
      near + 1,
      s2.y,
      s2.x + s2.w + rumble2,
      s2.x + ground2,
      s1.y,
      s1.x + s1.w + rumble1,
      s1.x + ground1,
      groundU,
      fogV,
    )

    // Asphalt.
    this.writeQuad(near + 2, s2.y, s2.x - s2.w, s2.x + s2.w, s1.y, s1.x - s1.w, s1.x + s1.w, roadU, fogV)

    // Left rumble, outboard of the road edge.
    this.writeQuad(
      near + 3,
      s2.y,
      s2.x - s2.w - rumble2,
      s2.x - s2.w,
      s1.y,
      s1.x - s1.w - rumble1,
      s1.x - s1.w,
      rumbleU,
      fogV,
    )

    // Right rumble.
    this.writeQuad(
      near + 4,
      s2.y,
      s2.x + s2.w,
      s2.x + s2.w + rumble2,
      s1.y,
      s1.x + s1.w,
      s1.x + s1.w + rumble1,
      rumbleU,
      fogV,
    )

    // Rung across the ribbon — one per full rumble cycle, not one per segment of every other
    // band, which is what made the first version read as a zebra crossing (see `TRACK_RUNG`).
    // Written into the *road's* own projected centre (`s1.x`/`s2.x`), which already carries the
    // integrated curvature, so a rung leans with the road through a corner rather than staying
    // square to the screen.
    if (rung) {
      // Geometry in `road/surface.ts`, which imports no Phaser and is asserted by `verify:road`
      // — see that file for why this one piece of the road is worth testing on its own.
      rungQuadInto(this.rung, s1, s2)

      this.writeQuad(
        near + 5,
        this.rung.farY,
        this.rung.farLeftX,
        this.rung.farRightX,
        this.rung.nearY,
        this.rung.nearLeftX,
        this.rung.nearRightX,
        paletteU(PALETTE_INDEX.TRACK_MARK),
        fogV,
      )
    } else {
      this.degenerateQuad(near + 5)
    }
  }

  /**
   * Writes one trapezoid. Vertex order matches the winding set up in the constructor:
   * `v0` far-left, `v1` near-left, `v2` far-right, `v3` near-right — which the renderer
   * reads as TL, BL, TR, BR.
   */
  private writeQuad(
    quad: number,
    farY: number,
    farLeftX: number,
    farRightX: number,
    nearY: number,
    nearLeftX: number,
    nearRightX: number,
    u: number,
    fogV: number,
  ): void {
    const v = this.vertices
    const o = quad * QUAD_VERTEX_STRIDE

    // The decision itself lives in `meshGuard.ts` so both of its branches can be tested under
    // Node — this file imports Phaser and cannot be. See there for why DEV throws and production
    // does not.
    const action = quadWriteAction(quad, QUAD_VERTEX_STRIDE, v.length, import.meta.env.DEV, overflowReported)

    if (action !== 'write') {
      // `import.meta.env.DEV` has to appear **here**, not only inside `quadWriteAction`. The
      // function already refuses to return 'throw' in production, but Vite cannot prove that
      // through a call boundary, so the message literal survived into the bundle — which
      // `check-bundle.mjs` caught on the very next build. A statically-false condition is what
      // makes the whole block, string and all, eliminable.
      if (import.meta.env.DEV && action === 'throw') {
        throw new Error(
          `RoadMesh.writeQuad overflow: quad ${quad} writes ${o}..${o + QUAD_VERTEX_STRIDE} past a ${v.length}-float buffer ` +
            `(${QUAD_COUNT} quads x ${QUAD_VERTEX_STRIDE} floats, ${QUADS_PER_SEGMENT} per segment)`,
        )
      }

      if (action === 'report') {
        overflowReported = true
        logWarning()
        console.warn('[road] vertex buffer overflow; the extra quad was dropped. Reported once per session.')
      }

      return
    }

    v[o] = farLeftX
    v[o + 1] = farY
    v[o + 2] = u
    v[o + 3] = fogV

    v[o + 4] = nearLeftX
    v[o + 5] = nearY
    v[o + 6] = u
    v[o + 7] = fogV

    v[o + 8] = farRightX
    v[o + 9] = farY
    v[o + 10] = u
    v[o + 11] = fogV

    v[o + 12] = nearRightX
    v[o + 13] = nearY
    v[o + 14] = u
    v[o + 15] = fogV
  }

  /**
   * Collapses a segment's whole run of quads to a single point, so the rasteriser drops them as
   * zero-area triangles. The buffer slot has to be *filled*, not skipped — see the class
   * docstring.
   */
  private degenerateSegment(slot: number): void {
    for (let quad = 0; quad < QUADS_PER_SEGMENT; quad++) this.degenerateQuad(slot * QUADS_PER_SEGMENT + quad)
  }

  /**
   * Collapses one quad. Separate from `degenerateSegment` because the centre dash is drawn on
   * only half the segments, and the half that does not draw it must still write its slot.
   */
  private degenerateQuad(quad: number): void {
    const v = this.vertices
    const start = quad * QUAD_VERTEX_STRIDE
    const end = start + QUAD_VERTEX_STRIDE

    for (let o = start; o < end; o += VERTEX_STRIDE) {
      v[o] = 0
      v[o + 1] = 0
    }
  }
}
