import * as Phaser from 'phaser'
import {
  CAMERA_DEPTH,
  CAMERA_HEIGHT,
  DRAW_DISTANCE,
  fogStepFor,
  MIN_ROAD_SPAN_PX,
  GROUND_EXTENT,
  groundPaletteIndex,
  roadPaletteIndex,
  hasRung,
  PALETTE_INDEX,
  paletteU,
  paletteV,
  ROAD_MESH_DEPTH,
  ROAD_WIDTH,
  RUMBLE_WIDTH_FRACTION,
} from './constants'
import { logWarning } from '../platform/yt'
import { biomeForSegment, biomeIndex, groundShadeFor, roadShadeFor } from './biomes'
import { quadWriteAction } from './meshGuard'
import { createRoadPalette } from './palette'
import { createScreenPoint, projectInto, type ScreenPoint } from './project'
import { spanIsFull } from './spans'
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

/**
 * Total quads the mesh can hold — fixed for its whole lifetime. See the class docstring.
 *
 * Still one allocation per segment, because a frame where nothing merges (every segment over
 * `MIN_ROAD_SPAN_PX` tall) needs exactly that many. What varies is how many are *submitted*.
 */
const QUAD_COUNT = DRAW_DISTANCE * QUADS_PER_SEGMENT

/**
 * One trapezoid of road, covering one segment or several.
 *
 * `near` and `far` are copies rather than references into the segments' own `ScreenPoint`s: a
 * span outlives the loop iteration that opened it, and holding a reference would break the day a
 * track shorter than `DRAW_DISTANCE` made the walk revisit a segment and reproject it underneath
 * an open span. Six numbers copied per span is cheaper than that class of bug.
 *
 * `rungFar` is the *opening segment's* own far edge, not the span's. A rung is a marking one
 * segment deep, so a merged span must not stretch it to the span's depth — and in the near
 * field, where nothing merges, the two are the same point and the rung is pixel-identical to
 * what it always was.
 */
interface RoadSpan {
  near: ScreenPoint
  far: ScreenPoint
  rungFar: ScreenPoint
  alternate: boolean
  rung: boolean
  fogV: number
  biome: number
  shade: number
  roadShade: number
}

/** Copies a projected point into a span's own storage. See `RoadSpan` for why it is a copy. */
function copyPoint(out: ScreenPoint, from: ScreenPoint): void {
  out.x = from.x
  out.y = from.y
  out.w = from.w
  out.scale = from.scale
}

function createSpan(): RoadSpan {
  return {
    near: createScreenPoint(),
    far: createScreenPoint(),
    rungFar: createScreenPoint(),
    alternate: false,
    rung: false,
    fogV: 0,
    biome: 0,
    shade: 0,
    roadShade: 0,
  }
}

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
 * Index-buffer entries one quad occupies in the ordered list: two triangles of `a, b, c, page`.
 *
 * The submitter walks `indicesOrdered` in strides of this, so **the used quads have to be a
 * prefix of the list** — which is why spans are written far-first into slots `0..spans-1` and
 * the list is then truncated to them. See `viewFor`.
 */
const INDICES_PER_QUAD = INDEX_STRIDE * 2

/**
 * Hands the mesh an index list that is a typed array rather than a `number[]`.
 *
 * Phaser types `indicesOrdered` as `number[]` because that is what its own builder produces, and
 * the renderer only ever reads `ordered[i]` and `ordered.length` (confirmed in
 * `SubmitterMeshToQuad.run`) — both of which a `Uint32Array` answers identically. A typed array
 * is what makes a per-frame `subarray` view cheap, which is the whole mechanism behind the
 * truncation. Same shape as the `MutableSound` cast in `audio.ts`: an interface that is wider
 * at runtime than in the `.d.ts`.
 */
function setOrderedIndices(mesh: Phaser.GameObjects.Mesh2D, indices: Uint32Array): void {
  ;(mesh as unknown as { indicesOrdered: ArrayLike<number> }).indicesOrdered = indices
}

/**
 * The whole road surface, rendered as a single `Mesh2D`.
 *
 * **Topology is fixed; only vertex positions, UVs and how many quads are submitted change.**
 * The mesh always *holds* `QUAD_COUNT` quads and the index list is built once in the constructor;
 * `render()` writes into `mesh.vertices` and then hands the renderer a truncated view of that
 * list. So the per-frame cost is array writes with no reallocation and no index rebuild, over
 * only the quads that reach the screen.
 *
 * **⚠ The rule used to be that a culled segment cannot be skipped, only degenerated**, because
 * the index list had a fixed length and a skipped slot would keep last frame's geometry. That is
 * still true of any slot inside the submitted range — the rung relies on it — and it is no longer
 * true of the tail: `render` packs the spans it drew into slots `0..spans-1` and truncates the
 * list to them, so everything past the last span is unread rather than degenerate. Which is the
 * point: the submitter transforms and batches four vertices per quad it walks, and it used to
 * walk 1800 of them a frame to draw a road that is 253 pixels tall. See `MIN_ROAD_SPAN_PX`.
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

  /**
   * Every span the walk can produce, allocated once.
   *
   * `DRAW_DISTANCE` of them, because a frame in which nothing merges opens one per segment —
   * the ceiling is the shipped-before behaviour, which is the honest size for a pool whose
   * demand is bounded by the model rather than emergent. Reused in place, so a frame allocates
   * nothing however the road bends.
   */
  private readonly spans: RoadSpan[] = Array.from({ length: DRAW_DISTANCE }, createSpan)

  /**
   * The ordered index list, in slot order, built once.
   *
   * Built here rather than by `buildOrderedIndices` because **the truncation depends on the
   * order**: quad `i` has to occupy entries `i * INDICES_PER_QUAD ..`, or shortening the list
   * would drop arbitrary quads rather than the unused tail. Phaser's own builder happens to
   * produce exactly this order for a topology whose quads share no vertices, and the check in
   * the constructor asserts it — but a property of somebody else's optimiser is not a thing to
   * build a render loop on.
   */
  private readonly ordered: Uint32Array

  /**
   * A truncated view of `ordered` per span count, so a frame allocates none.
   *
   * `subarray` is cheap but not free, and the count changes on almost every frame; there are at
   * most `DRAW_DISTANCE + 1` distinct answers, so each is made once and kept.
   */
  private readonly views: (Uint32Array | undefined)[] = new Array<Uint32Array | undefined>(DRAW_DISTANCE + 1)

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

    // Built exactly once, here, because the topology never changes — and built by hand rather
    // than by `buildOrderedIndices`, so that quad `i` provably occupies entries `i * 8 ..` and
    // the per-frame truncation in `render` drops the unused tail rather than an arbitrary
    // scattering of quads. `useOrderedIndices` still has to be set, or the mesh silently falls
    // back to submitting one degenerate quad per triangle.
    this.ordered = new Uint32Array(QUAD_COUNT * INDICES_PER_QUAD)

    for (let quad = 0; quad < QUAD_COUNT; quad++) {
      const v = quad * 4
      const i = quad * INDICES_PER_QUAD

      this.ordered[i] = v
      this.ordered[i + 1] = v + 1
      this.ordered[i + 2] = v + 2
      this.ordered[i + 3] = 0

      this.ordered[i + 4] = v + 1
      this.ordered[i + 5] = v + 2
      this.ordered[i + 6] = v + 3
      this.ordered[i + 7] = 0
    }

    this.gameObject.setUseOrderedIndices(true)
    setOrderedIndices(this.gameObject, this.ordered)
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

    // How many spans the walk has opened, and the one still taking segments. **A span is closed
    // by height, not by segment count** — see `MIN_ROAD_SPAN_PX` — so the near field, where every
    // segment is tens of pixels tall, still emits one span per segment and is untouched.
    let spans = 0
    let open: RoadSpan | null = null

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
        // **A cull closes the open span rather than being merged into it.** It is culled because
        // the geometry is discontinuous there — behind a crest, inside-out over one, or behind the
        // camera — and a span reaching across that would draw a trapezoid over the hill that hid
        // it. What is already in the span stays: it is emitted at whatever height it reached.
        open = null
        continue
      }

      if (open === null) {
        open = this.spans[spans]
        spans++

        copyPoint(open.near, s1)
        // The opening segment's own far edge, kept for the rung alone -- see `RoadSpan`.
        copyPoint(open.rungFar, s2)
        // **Every colour on a span is the opening segment's**, i.e. the one nearest the camera and
        // so the one most of the span's pixels belong to. A merged span can therefore miss a
        // biome seam, a shade patch or a rumble beat by up to its own length — which is bounded
        // by `MIN_ROAD_SPAN_PX`, so what it can hide is under a pixel.
        open.alternate = segment.alternate
        open.rung = hasRung(segment.index)
        // The fog row is chosen by how far this segment is from the camera, and travels to
        // the GPU as the quad's V — no tint, no second pass. See `createRoadPalette`.
        open.fogV = paletteV(fogStepFor(n))
        // Derived from the segment index rather than stored on the segment: it costs nothing to
        // ask and cannot drift out of sync with itself. See `biomeForSegment`.
        open.biome = biomeIndex(biomeForSegment(segment.index, track.length).id)
        // Keyed on the segment's own index, so the patch a piece of ground belongs to is a
        // property of that piece of ground: it is the same on the next lap, at every viewport
        // size and in whatever pool slot the segment happens to land.
        open.shade = groundShadeFor(segment.index)
        // Offset from the verge's own draw, so the two surfaces never change shade on the same
        // segment -- see `roadShadeFor`.
        open.roadShade = roadShadeFor(segment.index)
      }

      copyPoint(open.far, s2)

      if (spanIsFull(open.near.y, s2.y, MIN_ROAD_SPAN_PX)) open = null

      maxY = s2.y
    }

    // **Written far-to-near, into a contiguous prefix.** Both halves are load-bearing: the
    // painter's order needs the farthest span submitted first, and the truncation below needs the
    // used quads to start at slot 0. Nothing degenerates the rest — an unsubmitted slot is never
    // read, so last frame's numbers sitting in it cost nothing and cannot be seen.
    for (let i = 0; i < spans; i++) this.writeSpan(i, this.spans[spans - 1 - i])

    setOrderedIndices(this.gameObject, this.viewFor(spans))

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
   * The ordered index list truncated to `spans` worth of quads, cached per count.
   *
   * The submitter walks `indicesOrdered.length`, so this is the whole of what stops it
   * transforming and batching quads nothing can see: at 375x667 it takes the median from 1800
   * quads a frame to about 430.
   */
  private viewFor(spans: number): Uint32Array {
    const cached = this.views[spans]

    if (cached) return cached

    const view = this.ordered.subarray(0, spans * QUADS_PER_SEGMENT * INDICES_PER_QUAD)

    this.views[spans] = view

    return view
  }

  /**
   * Writes one span's quads: the two ground bands, the asphalt trapezoid, the two rumble
   * stripes flanking it, and the surface rung.
   */
  private writeSpan(slot: number, span: RoadSpan): void {
    const s1 = span.near
    const s2 = span.far
    const { alternate, rung, fogV, biome, shade, roadShade } = span

    // **The asphalt picks one of five shades by noise, not one of two by the rumble beat.** A beat
    // across the largest surface in the frame is a stripe; the stripes themselves still ride
    // `alternate` below, which is the rhythm it was always for. See `ROAD_SHADES_PER_THEME`.
    const roadU = paletteU(roadPaletteIndex(roadShade))
    const rumbleU = paletteU(alternate ? PALETTE_INDEX.RUMBLE_DARK : PALETTE_INDEX.RUMBLE_LIGHT)
    // The ground does NOT ride the rumble beat -- see `groundShadeFor`. `alternate` still
    // drives the asphalt and the stripes above, which is the rhythm it was always for.
    const groundU = paletteU(groundPaletteIndex(biome, shade))

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
      rungQuadInto(this.rung, s1, span.rungFar)

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
   * Collapses one quad onto a point, so the rasteriser drops it as two zero-area triangles.
   *
   * **The rung is the only quad that still needs this**, and it needs it for the reason the whole
   * mesh used to: it is one of a span's six submitted slots, so a span without a rung has to
   * *fill* that slot rather than skip it or last frame's marking stays on screen. Slots past the
   * last span are a different case — they are not submitted at all, so nothing reads them.
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
