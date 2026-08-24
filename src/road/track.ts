/**
 * Track data and authoring: the list of segments the renderer walks each frame, plus the
 * `TrackBuilder` DSL that composes one out of straights, curves and hills.
 *
 * Like `project.ts`, this file never imports `phaser` — `scripts/verify-road-projection.mjs`
 * imports from it under plain Node.
 *
 * **Curvature is not geometry here.** A segment's `curve` is stored verbatim and integrated
 * at render time (`RoadMesh.render`); it is never baked into `p1.x`/`p2.x`, which stay zero.
 * Hills are the opposite: `p1.y`/`p2.y` are real world heights, resolved at build time.
 */
import { createRng, randomItem, randomRange } from '../race/rng'
import { biomeForSegment, type Biome } from './biomes'
import { DECOR, DECOR_TIERS, ROAD_CURVE, ROAD_HILL, ROAD_LENGTH, RUMBLE_LENGTH, SEGMENT_LENGTH } from './constants'
import { createScreenPoint, wrapZ, type ScreenPoint, type WorldPoint } from './project'

/**
 * One piece of scenery standing on a segment.
 *
 * `offsetX` is in road half-widths (`0` centreline, `±1` the edges of the ground strip) and
 * `height` is how far its base floats above the ground, in world units — `0` for anything
 * standing on it. Both are consumed verbatim by `billboardRectInto`.
 *
 * Deliberately just data: it names a texture and a place, and knows nothing about pools,
 * cameras or draw order. `RoadSprites` owns all of that.
 */
export interface RoadSprite {
  key: string
  offsetX: number
  height: number
  /**
   * How much bigger this one is drawn than the middle tier's props — see `DECOR_TIERS`.
   *
   * A property of the *placement* rather than of the instance, and separate from
   * `DecorVariation.scale` for that reason: the instance variation is what makes two ferns on the
   * same verge different, and this is what makes a far silhouette a silhouette. They multiply.
   */
  tierScale: number
}

export interface Segment {
  /** Position in the track array. Always equal to the array index. */
  index: number
  /** Near edge of the segment, in world coordinates. */
  p1: WorldPoint
  /** Far edge of the segment, in world coordinates. */
  p2: WorldPoint
  /**
   * Projected near edge. Owned by the renderer, which overwrites it every frame — it is
   * stored on the segment (rather than returned) only to avoid per-frame allocation.
   * Meaningless outside the frame in which the segment was actually drawn.
   */
  s1: ScreenPoint
  /** Projected far edge. Same ownership caveat as `s1`. */
  s2: ScreenPoint
  /**
   * Lateral curvature contributed by this segment, integrated by the renderer rather than
   * baked into `p1.x`/`p2.x`. Positive bends right, negative left. See the file docstring.
   */
  curve: number
  /**
   * Which half of the alternating rumble band this segment falls in — drives the
   * light/dark palette pick for both the asphalt and the rumble stripes.
   */
  alternate: boolean
  /**
   * Scenery standing on this segment. Empty until `decorateTrack` runs, and empty on most
   * segments afterwards.
   */
  sprites: RoadSprite[]
}

/**
 * How many `ROAD_LENGTH` presets a composite section spends.
 *
 * The reference implementation this projection is modelled on builds every section as three
 * phases (ease the curve in, hold it, ease it out). This DSL exposes a section's *total*
 * length instead, so the composite presets below multiply by this to land on the same
 * gradients — see `ROAD_HILL`'s note on why a section must be long relative to its height.
 */
const SECTION_PHASES = 3

/** How many segments the auto-generated closing section spends per unit of height it undoes. */
const CLOSING_SEGMENTS_PER_HEIGHT_UNIT = 4

/** Tolerance for "the track's height returns to zero at the loop seam". */
const LOOP_HEIGHT_EPSILON = 0.01

/** Total length of a track of `count` segments, in world units. */
export function trackLengthOf(count: number): number {
  return count * SEGMENT_LENGTH
}

/** Straight-line blend: `percent` 0 gives `a`, 1 gives `b`. */
export function interpolate(a: number, b: number, percent: number): number {
  return a + (b - a) * percent
}

/**
 * Cosine ease between `a` and `b`.
 *
 * Exactly `a` at `percent` 0, exactly `b` at 1, and the midpoint at 0.5 — but crucially its
 * *derivative* is zero at both ends. That is what makes a hill read as a hill: a linear ramp
 * would meet the flat road at a visible crease, because the road's slope would jump
 * discontinuously at the section boundary.
 */
export function easeInOut(a: number, b: number, percent: number): number {
  return a + (b - a) * (-Math.cos(percent * Math.PI) / 2 + 0.5)
}

/**
 * Rounds a segment count up to the next whole light/dark rumble cycle.
 *
 * The rumble stripes alternate every `RUMBLE_LENGTH` segments, so one full cycle is
 * `RUMBLE_LENGTH * 2` segments. Unless the track is a whole number of cycles long, the
 * pattern does not tile across the loop seam: at 500 segments the band running into the
 * seam (498-499) and the one leaving it (0-2) are the same colour, so the stripe rhythm
 * visibly stutters once per lap. Rounding up costs a handful of segments and removes it.
 */
export function alignSegmentCount(count: number): number {
  const cycle = RUMBLE_LENGTH * 2

  return Math.ceil(count / cycle) * cycle
}

/** How far through its own segment a track-space `z` sits, as `0..1`. */
export function segmentPercent(z: number): number {
  return wrapZ(z, SEGMENT_LENGTH) / SEGMENT_LENGTH
}

/** Road-surface height `percent` of the way through `segment`. */
export function surfaceHeight(segment: Segment, percent: number): number {
  return interpolate(segment.p1.y, segment.p2.y, percent)
}

/**
 * Ground height at any track-space `z`, interpolated across whichever segment contains it.
 *
 * The renderer already does this internally to keep the camera on the surface, but anything
 * that has to *stand on* the ground needs it too. From chunk 6 that is every enemy: their
 * world `y` is this plus their own height, and without it they would sit at a fixed altitude
 * and sink into every hill the track climbs.
 *
 * `z` is wrapped, so positions past either end of the loop resolve correctly.
 */
export function groundYAt(track: Segment[], z: number): number {
  return surfaceHeight(findSegment(track, z), segmentPercent(z))
}

/** Knobs for `decorateTrack`; every one defaults to the `DECOR` presets. */
export interface DecorateOptions {
  seed?: number
  /** Chance of an object on **each** side of a segment, `0..1`. */
  density?: number
  /** Range of `|offsetX|`, in road half-widths. */
  minOffset?: number
  maxOffset?: number
  /** Exponent on the offset roll; above 1 crowds the near verge. See `DECOR.OFFSET_BIAS`. */
  offsetBias?: number
  /** How many placements back to avoid repeating, per side. See `DECOR.NO_REPEAT_WINDOW`. */
  noRepeatWindow?: number
}

/**
 * Scatters scenery along `track`, in place and deterministically.
 *
 * **Determinism is the requirement, not the randomness.** The same seed must lay out the same
 * track every time: a scene restart that reshuffles the scenery makes two frame-cost readings
 * incomparable, makes a screenshot impossible to reproduce from a bug report, and — once
 * chunk 6 seeds waves the same way — would make a run unrepeatable. Nothing here may reach
 * for `Math.random()`; see `src/race/rng.ts`.
 *
 * Idempotent: each segment's list is rebuilt from scratch, so decorating twice with the same
 * seed leaves the same track rather than twice the scenery.
 *
 * Objects are kept off the ground strip itself (`minOffset > 1`). The strip is about to fill
 * up with things the player is meant to shoot at, and scenery standing among them would read
 * as a target that cannot be hit.
 */
export function decorateTrack(track: Segment[], keys: readonly string[], options: DecorateOptions = {}): void {
  const {
    seed = DECOR.SEED,
    density = DECOR.DENSITY,
    minOffset = DECOR.MIN_OFFSET,
    maxOffset = DECOR.MAX_OFFSET,
    offsetBias = DECOR.OFFSET_BIAS,
    noRepeatWindow = DECOR.NO_REPEAT_WINDOW,
  } = options
  const rng = createRng(seed)

  const available = new Set(keys)
  // A biome's prop list is a *proposal*; what actually gets placed is the intersection with the
  // keys the caller says exist. That is what lets biomes be authored ahead of their art: a biome
  // whose props have not been generated yet falls back to the whole available set rather than
  // leaving a bare stretch of ground, and the fallback disappears on its own the moment the
  // assets land. Nothing has to be switched over.
  const propsFor = (biome: Biome): readonly string[] => {
    const owned = biome.props.filter((prop) => available.has(prop))

    return owned.length > 0 ? owned : keys
  }

  // The last few keys placed on each side, so a run of neighbouring segments cannot come back as
  // a clump of clones — see `DECOR.NO_REPEAT_WINDOW`. Two histories, not one: the sides are
  // hundreds of world units apart and a prop on the left says nothing about what may stand on the
  // right, so sharing a history would suppress legitimate variety for no gain.
  const recent: Record<number, string[]> = { [-1]: [], [1]: [] }

  for (const segment of track) {
    // Rebuilt, not appended to — see the idempotence note above.
    segment.sprites = []

    if (keys.length === 0) continue

    const props = propsFor(biomeForSegment(segment.index, track.length))

    if (props.length === 0) continue

    for (const side of [-1, 1]) {
      if (rng() >= density) continue

      const key = pickUnrepeated(rng, props, recent[side], noRepeatWindow)

      recent[side].push(key)
      if (recent[side].length > noRepeatWindow) recent[side].shift()

      segment.sprites.push({
        key,
        tierScale: DECOR_TIERS.mid.scale,
        // **Biased toward the road rather than uniform across the band.** The band is wide enough
        // to fill the sides of the frame, and spreading uniformly across it would thin the near
        // verge — the part the player actually looks at — to a fifth of what it was.
        offsetX: side * (minOffset + (maxOffset - minOffset) * Math.pow(rng(), offsetBias)),
        height: 0,
      })
    }

    // **The other two tiers, from the same generator and the same prop list.** Drawn after the
    // middle tier's own roll so the sequence of random numbers is unchanged for it -- a track that
    // re-rolled its whole scenery the moment tiers were added would make every frame-cost reading
    // and every screenshot taken before this incomparable.
    for (const [tier, spec] of [
      ['far', DECOR_TIERS.far],
      ['near', DECOR_TIERS.near],
    ] as const) {
      if (rng() >= spec.chance) continue

      const side = rng() < 0.5 ? -1 : 1
      const key = pickUnrepeated(rng, props, recent[side], noRepeatWindow)

      segment.sprites.push({
        key,
        tierScale: spec.scale,
        // Uniform across the tier's own band rather than biased: the bias exists to keep the near
        // verge dense inside a very wide band, and neither of these bands is wide.
        offsetX: side * (spec.minOffset + (spec.maxOffset - spec.minOffset) * rng()),
        height: 0,
      })
      void tier
    }
  }
}

/**
 * Picks a prop that is not among the last `window` placed, when the biome offers enough to allow
 * it.
 *
 * **Bounded retries, not a filtered list.** Filtering the candidates and picking from what is left
 * is the obvious implementation and it silently changes the weighting: a biome lists a prop twice
 * to make it twice as common, and removing one entry from the pool for a few placements skews
 * exactly the distribution the data was written to express. Re-rolling leaves the weighting alone
 * and simply declines a few draws.
 *
 * Gives up after a fixed number of tries rather than looping: a biome with fewer distinct props
 * than the window **cannot** satisfy the rule, and the honest outcome there is a repeat rather
 * than a hang. `coast` with four props and a window of three is that case today.
 */
function pickUnrepeated(rng: () => number, props: readonly string[], recent: readonly string[], window: number): string {
  const distinct = new Set(props).size

  if (distinct <= 1 || window <= 0) return randomItem(rng, props)

  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = randomItem(rng, props)

    if (!recent.includes(candidate)) return candidate
  }

  return randomItem(rng, props)
}

/**
 * Composes a looping track out of sections.
 *
 * ```ts
 * const track = new TrackBuilder()
 *   .addStraight(ROAD_LENGTH.LONG)
 *   .addCurve(ROAD_LENGTH.MEDIUM, ROAD_CURVE.HARD)
 *   .addLowRollingHills()
 *   .addSCurve()
 *   .build()
 * ```
 *
 * `build()` is what makes the result *loopable* — see its docstring. Nothing else in the
 * codebase may construct a `Segment` by hand.
 */
export class TrackBuilder {
  private readonly segments: Segment[] = []

  /** Height the next segment starts at: the previous segment's far edge, or 0 at the start. */
  private lastY(): number {
    return this.segments.length === 0 ? 0 : this.segments[this.segments.length - 1].p2.y
  }

  /** Appends one segment whose far edge sits at height `y`. */
  private push(curve: number, y: number): void {
    const index = this.segments.length

    this.segments.push({
      index,
      // x stays 0 on both edges: lateral shape comes from `curve` at render time, not here.
      p1: { x: 0, y: this.lastY(), z: index * SEGMENT_LENGTH },
      p2: { x: 0, y, z: (index + 1) * SEGMENT_LENGTH },
      s1: createScreenPoint(),
      s2: createScreenPoint(),
      curve,
      alternate: Math.floor(index / RUMBLE_LENGTH) % 2 === 0,
      sprites: [],
    })
  }

  /**
   * Appends `length` segments at a constant `curve`, easing the road's height by
   * `heightUnits * SEGMENT_LENGTH` across them.
   *
   * The ease is sampled at `(n + 1) / count` rather than `n / count` so the final segment's
   * far edge lands on the target height *exactly*, not one step short of it. That exactness
   * is what lets `build()` assert the loop closes rather than merely hoping it nearly does.
   */
  private addSection(length: number, curve: number, heightUnits: number): this {
    const count = Math.max(0, Math.round(length))
    const startY = this.lastY()
    const endY = startY + heightUnits * SEGMENT_LENGTH

    for (let n = 0; n < count; n++) {
      this.push(curve, easeInOut(startY, endY, (n + 1) / count))
    }

    return this
  }

  /** A flat, straight run of `length` segments. */
  addStraight(length: number = ROAD_LENGTH.MEDIUM): this {
    return this.addSection(length, ROAD_CURVE.NONE, ROAD_HILL.NONE)
  }

  /** A constant-curvature bend, optionally climbing or dropping by `hill` at the same time. */
  addCurve(length: number = ROAD_LENGTH.MEDIUM, curve: number = ROAD_CURVE.MEDIUM, hill: number = ROAD_HILL.NONE): this {
    return this.addSection(length, curve, hill)
  }

  /** A straight climb (or drop, for a negative `height`) of `height` units. */
  addHill(length: number = ROAD_LENGTH.MEDIUM, height: number = ROAD_HILL.MEDIUM): this {
    return this.addSection(length, ROAD_CURVE.NONE, height)
  }

  /** Five alternating bends with height changes woven through them. Does not self-close in y. */
  addSCurve(length: number = ROAD_LENGTH.MEDIUM * SECTION_PHASES): this {
    return this.addCurve(length, -ROAD_CURVE.EASY, ROAD_HILL.NONE)
      .addCurve(length, ROAD_CURVE.MEDIUM, ROAD_HILL.MEDIUM)
      .addCurve(length, ROAD_CURVE.EASY, -ROAD_HILL.LOW)
      .addCurve(length, -ROAD_CURVE.EASY, ROAD_HILL.MEDIUM)
      .addCurve(length, -ROAD_CURVE.MEDIUM, -ROAD_HILL.MEDIUM)
  }

  /** A gentle undulating stretch. Its height changes sum to zero, so it self-closes. */
  addLowRollingHills(
    length: number = ROAD_LENGTH.SHORT * SECTION_PHASES,
    height: number = ROAD_HILL.LOW,
  ): this {
    return this.addHill(length, height / 2)
      .addHill(length, -height)
      .addCurve(length, ROAD_CURVE.EASY, height)
      .addStraight(length)
      .addCurve(length, ROAD_CURVE.EASY, -height / 2)
      .addStraight(length)
  }

  /**
   * Finishes the track, making it safe to drive round in a loop.
   *
   * Two things happen here that no individual section can do for itself:
   *
   * 1. **Height is returned to zero**, by appending a closing section if the sections so far
   *    left the road above or below its starting height. The track wraps in `z`, so a
   *    non-zero final height means the road teleports vertically every lap — the camera
   *    would drop (or climb) by the whole accumulated height in a single frame at the seam.
   *    Curvature needs no equivalent: it is integrated forward from the camera each frame and
   *    never carries across the seam.
   * 2. **The segment count is padded** to a whole rumble cycle — see `alignSegmentCount`.
   *    Padding runs *after* closing, so the added segments are flat and cannot reopen the gap.
   *
   * The closing height is then asserted rather than assumed: a silent vertical seam is the
   * kind of defect that reads as "the physics is broken" long after the cause is forgotten.
   */
  build(): Segment[] {
    this.closeHeight()
    this.padToRumbleCycle()

    if (this.segments.length === 0) {
      throw new Error('TrackBuilder.build: track is empty — add at least one section first')
    }

    const last = this.segments[this.segments.length - 1]

    if (Math.abs(last.p2.y) >= LOOP_HEIGHT_EPSILON) {
      throw new Error(
        `TrackBuilder.build: track does not close in height — final y is ${last.p2.y}, expected 0`,
      )
    }

    return this.segments
  }

  /** Appends a section easing the road back down (or up) to height zero, if it is not already. */
  private closeHeight(): void {
    const startY = this.lastY()

    if (Math.abs(startY) < LOOP_HEIGHT_EPSILON) return

    const heightUnits = -startY / SEGMENT_LENGTH
    const length = Math.max(
      ROAD_LENGTH.MEDIUM,
      Math.ceil(Math.abs(heightUnits) * CLOSING_SEGMENTS_PER_HEIGHT_UNIT),
    )

    this.addSection(length, ROAD_CURVE.NONE, heightUnits)
  }

  /** Appends flat, straight segments until the count is a whole rumble cycle. */
  private padToRumbleCycle(): void {
    const target = alignSegmentCount(this.segments.length)

    while (this.segments.length < target) {
      this.push(ROAD_CURVE.NONE, this.lastY())
    }
  }
}

/**
 * Builds a straight, flat, looping track: `x` and `y` are zero throughout, `z` advances by
 * `SEGMENT_LENGTH` per segment.
 *
 * The requested `count` is rounded up by `alignSegmentCount` — see its note on the loop seam.
 */
export function buildStraightTrack(count: number): Segment[] {
  return new TrackBuilder().addStraight(count).build()
}

/**
 * Returns the segment whose `[p1.z, p2.z)` range contains `z`.
 *
 * `z` is wrapped first, so a camera position past the end of the loop (or behind its
 * start) resolves to the correct segment rather than running off the array.
 */
export function findSegment(track: Segment[], z: number): Segment {
  const wrapped = wrapZ(z, trackLengthOf(track.length))

  return track[Math.floor(wrapped / SEGMENT_LENGTH) % track.length]
}
