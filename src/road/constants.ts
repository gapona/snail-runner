/**
 * Tuning numbers for the pseudo-3D (segmented / OutRun-style) road renderer.
 *
 * Deliberately free of any `phaser` import: `src/road/project.ts` and `src/road/track.ts`
 * both pull from here and must stay runnable under plain Node for `npm run verify:road`
 * (a value `import * as Phaser from 'phaser'` executes Phaser's init, which reads `window`
 * — see CLAUDE.md "Known Issues Fixed" for the same rule applied to the platform layer).
 */

import { BIOMES } from './biomes'

/** Depth of one track segment, in world units. */
export const SEGMENT_LENGTH = 200

/** Full width of the drivable road surface, in world units. */
export const ROAD_WIDTH = 2000

/** How many segments ahead of the camera are considered for drawing each frame. */
export const DRAW_DISTANCE = 300

/** Camera height above the road surface, in world units. */
export const CAMERA_HEIGHT = 1000

/**
 * Where the horizon sits, as a fraction of viewport height from the top.
 *
 * **The single source of truth for the vanishing row.** Everything that has an opinion about
 * where the horizon is — the projection, the sky glow, the ship's box, the heights enemies fly
 * at — reads this. It used to be implicit (the projection put the vanishing point at exactly
 * `screenHeight / 2`, and `Backdrop` carried its own hardcoded `0.5` beside it), which is two
 * places that could disagree about one line.
 *
 * Raised from the implicit 0.5 to give the ground **38% of the frame instead of 63%**. The old
 * split was backwards for this genre: everything that matters happens in the far field, and the
 * near ground carries nothing but flat colour — so the bottom half of the screen was dead space
 * while the band the player actually reads was squeezed. Tilting the camera down is the same
 * operation, and it is what this constant is: a vertical offset of the vanishing point, with the
 * horizontal projection untouched.
 *
 * **Changing it moves three other things** and none of them follow automatically: the ship's
 * vertical box (`SHIP_MIN_Y_FRACTION`), the heights enemies are laid out at
 * (`ENEMY_BASE_HEIGHT`), and how much sky the backdrop has to fill. `verify:road` pins the
 * projection half; the other two are judged by eye.
 */
export const HORIZON_Y = 0.62

/** Horizontal field of view, in degrees. */
export const FIELD_OF_VIEW = 100

/** Segments per rumble-stripe band — the alternating light/dark pattern's period. */
export const RUMBLE_LENGTH = 3

/** Number of segments in the (looping) track. */
export const TRACK_SEGMENT_COUNT = 500

/** Top speed, in world units per second. */
export const MAX_SPEED = SEGMENT_LENGTH * 60

/**
 * Distance from the eye to the projection plane, derived from the FOV.
 * `scale = CAMERA_DEPTH / (pointZ - cameraZ)` is the whole of the perspective divide.
 */
export const CAMERA_DEPTH = 1 / Math.tan(((FIELD_OF_VIEW / 2) * Math.PI) / 180)

/** Rumble-stripe width, as a fraction of the road's projected half-width. */
export const RUMBLE_WIDTH_FRACTION = 0.15

/**
 * Section-length presets for `TrackBuilder`, in segments.
 *
 * These name a *phase* length, not a whole section — the composite presets
 * (`addSCurve`, `addLowRollingHills`) spend `SECTION_PHASES` of them per section, which is
 * what keeps hill gradients sane. See `src/road/track.ts`.
 */
export const ROAD_LENGTH = { SHORT: 25, MEDIUM: 50, LONG: 100 } as const

/**
 * Curvature presets, in "screen units of lateral drift accumulated per segment".
 *
 * Curvature is not baked into segment geometry — it is integrated at render time (see
 * `RoadMesh.render`), so these are second-derivative values: the road's centreline offset
 * accumulates `x += dx` while `dx += segment.curve`.
 */
export const ROAD_CURVE = { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6 } as const

/**
 * Hill-height presets, in **units of `SEGMENT_LENGTH`** — `ROAD_HILL.MEDIUM` is a rise of
 * `40 * SEGMENT_LENGTH` = 8000 world units over the section, not 40 world units.
 *
 * The gradient is therefore `height / lengthInSegments`; keep a section at least ~4x its
 * height in segments (which the `ROAD_LENGTH` presets times `SECTION_PHASES` gives you) or
 * the road turns into a wall.
 */
export const ROAD_HILL = { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60 } as const

/**
 * The road's whole colour vocabulary, in palette-texel order:
 * `[dark asphalt, light asphalt, dark rumble, light rumble]`.
 *
 * Kept here as the single place colours are defined — chunk 8 (theme/light) reskins the
 * road by editing this array and nothing else. `Mesh2D` has no per-vertex tint component,
 * so these are not applied as tints: `src/road/palette.ts` bakes them into a 1px-tall
 * texture strip and each quad picks its colour by UV. See `paletteU` below.
 */
export const ROAD_PALETTE = [0x1d1f26, 0x24262f, 0x4a7fd6, 0xf2f2f5, 0x969698]

/**
 * Columns in the palette texture: the road's own colours, then two ground shades per biome.
 *
 * **Biome ground rides in the same texture as everything else**, which is the whole reason the
 * ground can vary along the track at all. `Mesh2D` carries one object-wide tint and no
 * per-vertex tint, so a per-segment ground colour cannot be a tint; it has to be a UV. Adding
 * columns costs one wider texture and nothing else — no extra draw call, no second mesh, no
 * shader. Same argument that put distance fog on the Y axis of this texture.
 */
export const PALETTE_COLUMNS = ROAD_PALETTE.length + BIOMES.length * 2

/**
 * The palette column for a biome's ground, on the alternating rumble rhythm.
 *
 * The alternation is not decoration: a flat expanse of one colour beside the road reads as
 * motionless however fast the camera is moving, which is the same reason the road itself
 * alternates and the surface is rungged rather than plain.
 */
export function groundPaletteIndex(biome: number, alternate: boolean): number {
  const clamped = Math.min(BIOMES.length - 1, Math.max(0, biome))

  return ROAD_PALETTE.length + clamped * 2 + (alternate ? 0 : 1)
}

/**
 * How far the ground band extends beyond the road edge, in road half-widths.
 *
 * Wide enough that the near segments cover the full width of any viewport — the ground is what
 * the scenery stands on, and before this existed everything beside the road was drawn against
 * the sky, so props read as floating in a void.
 *
 * **It must stay comfortably past `DECOR.MAX_OFFSET`, and that relationship went stale the moment
 * the scatter was widened.** This was 14 against a 4.5 offset; widening the offset to 18 to fill
 * the sides of the frame put every far-placed prop past the end of the ground it is supposed to
 * stand on, which draws as scenery hanging in the sky. `verify:road` now asserts the relationship
 * rather than leaving it to a comment, because a comment is exactly what failed here.
 */
export const GROUND_EXTENT = 40

/** Named indices into `ROAD_PALETTE`, so call sites don't carry bare magic numbers. */
export const PALETTE_INDEX = {
  ASPHALT_DARK: 0,
  ASPHALT_LIGHT: 1,
  RUMBLE_DARK: 2,
  RUMBLE_LIGHT: 3,
  TRACK_MARK: 4,
  /**
   * The lane's edge, drawn as a stripe on the asphalt.
   *
   * **The ship's own cyan, deliberately.** Everything in this game that belongs to the player is
   * that hue — the hull, the lock ring, the armed weapon's cell — and the lane is the one piece
   * of the *world* that is a property of the player rather than of the track. It is also as far
   * from the reserved threat hue as the wheel allows, which the line has to be: a bright marking
   * running the length of the frame must not read as a warning.
   */
} as const

/**
 * The marking on the surface: **rungs across the ribbon, not a line down the middle of it.**
 *
 * The two carry the same information — a rhythm the eye can measure the camera's speed against —
 * and the old one carried a second message nobody asked for. A dashed line down the centre of a
 * grey surface with white paint along both edges is a *road*, and the game stopped being about
 * driving on one several chunks ago; the frame kept saying otherwise, which is the thing this
 * whole round is fixing.
 *
 * A rung is also the better cue of the two, for a reason that is geometry rather than taste: a
 * longitudinal dash moves *along* its own axis, so what sweeps down the screen is only the
 * boundary between paint and no-paint, while a transverse bar sweeps its whole length. The dead
 * near ground the plan complains about is exactly where that difference is largest.
 *
 * `WIDTH` is a half-width as a fraction of the road's own projected half-width, so the rung is
 * inset from both edges and cannot merge with the rumble stripes into one bright band. `DEPTH`
 * is how much of a segment's *depth* it occupies, measured from the near edge — the rest of the
 * segment is the gap.
 *
 * **`SPACING` is the number that stops this reading as a pedestrian crossing, and the first
 * version did not have it.** Riding the rumble stripes' own `alternate` flag put a rung on every
 * segment of every *on* band — three bars 45% of a segment apart, then a gap, repeating — which
 * on screen is a zebra crossing painted the length of the road. One rung per full rumble cycle
 * is a ladder instead: 1200 world units apart, about five passing per second at `RAIL_SPEED`,
 * which is a rhythm the eye reads as speed rather than as road furniture.
 *
 * `WIDTH` came down with it. At 0.34 (68% of the surface) a bar is close enough to both edges to
 * read as a stripe *across a road*; at 0.22 it is a rung the ribbon is built from.
 */
export const TRACK_RUNG = { WIDTH: 0.22, DEPTH: 0.5, SPACING: RUMBLE_LENGTH * 2 } as const

/** True on the segments a rung is painted on — one per full rumble cycle. See `TRACK_RUNG`. */
export function hasRung(segmentIndex: number): boolean {
  return segmentIndex % TRACK_RUNG.SPACING === 0
}

/** Flat fill behind the road — the sky/void. Chunk 8 replaces this with real layers. */
export const SKY_COLOR = 0x0b0d12

/**
 * World units per texture pixel for a billboard — see `billboardRectInto`.
 *
 * At `10`, a 40x180 texture is a 400x1800 world-unit object: slender, and nearly twice
 * `CAMERA_HEIGHT` tall. Raising this scales all scenery together without touching a texture.
 */
export const SPRITE_SCALE = 10

/**
 * Placeholder scenery colours: a flat silhouette body and a lighter rim.
 *
 * A flat fill is the point, not a shortcut — chunk 11's own acceptance is that an object's
 * *type* reads from its outline at 24px, so the placeholders are built to be judged the same
 * way. The rim exists only so an object does not disappear into `SKY_COLOR` at the horizon.
 */
export const DECOR_COLORS = { body: 0x2b3040, rim: 0x59637f } as const

/**
 * How the deterministic decorator scatters scenery — see `decorateTrack`.
 *
 * `DENSITY` is the chance of an object on *each* side of a given segment, so the expected
 * count in view is `DRAW_DISTANCE * DENSITY * 2` (~48 at these numbers) of which most are
 * beyond the screen edge or sub-pixel. `MIN_OFFSET` sits comfortably outside the rumble
 * stripes: scenery on the ground strip itself would read as an obstacle in a game where the
 * strip is about to fill up with things you are meant to shoot.
 */
/**
 * How scenery is scattered: how often, how far out, and how far out it *reaches*.
 *
 * **`MAX_OFFSET` was 4.5 and that is why the sides of the frame were empty.** Every object in the
 * game stood in a band between 1.35 and 4.5 road half-widths, i.e. hugging the verge, so beyond a
 * few metres of the asphalt there was nothing at all — the world ended just past the road. 18
 * half-widths puts scenery out to the edge of the frame at the distances the player actually
 * reads, and costs nothing extra to draw: an object too far out to be on screen is culled by the
 * same test that culls one too far away.
 *
 * **`OFFSET_BIAS` is what stops the wide band from thinning the near verge.** Drawing the offset
 * uniformly over 1.35..18 puts only a fifth of the objects in the near band that used to hold all
 * of them, and the roadside would read as *emptier* than before the field was widened. The bias
 * is an exponent on a 0..1 roll — above 1 it crowds the near edge, and 1.7 keeps roughly the old
 * near-verge density while filling the distance with what is added.
 *
 * `DENSITY` rises with the widened band for the same reason: it is a per-side, per-segment chance,
 * so the same number over a field four times as wide is a field four times as sparse.
 */
/**
 * The three tiers a biome is built from, beyond the one row along the verge it used to be.
 *
 * **The near tier is the cheapest speed cue in the game.** One large object passing close to the
 * edge of the frame every few seconds reads as speed far more strongly than doubling the density of
 * the middle tier, because what the eye measures speed by is angular rate — and only something
 * close has any.
 *
 * The far tier is the opposite trade: large shapes well beyond the corridor, drawn deep in the fog
 * with no detail, which is what stops the world ending at the edge of the decorated band. Neither
 * costs a new file: both are the same props the middle tier draws, at a different distance and a
 * different scale.
 */
export const DECOR_TIERS = {
  /** Beyond the corridor: rare, huge, and mostly fog. */
  far: { chance: 0.05, minOffset: 20, maxOffset: 34, scale: 2.6 },
  /** The verge, and the tier that was already there. */
  mid: { chance: 1, minOffset: 1.35, maxOffset: 18, scale: 1 },
  /**
   * Close to the frame's edge and gone in a moment.
   *
   * **Rare on purpose, and the first number was wrong.** At 1 in 40 segments the arithmetic comes
   * out at one close pass every **1.1 seconds** ${EM} a segment is 200 world units and the rail covers
   * 6000 a second, so 40 segments is a second and a third, not the three the brief asks for. At 1 in 100 the *measured* rate over 2000 segments is 5.6s, and at 1 in 62 it is the 3-4s
   * the brief asks for -- the roll is per segment, so the effective spacing is not simply 1/chance. More often than that and it stops being an event and starts being a fence
   * between the player and the fight.
   */
  near: { chance: 0.011, minOffset: 1.6, maxOffset: 2.6, scale: 1.9 },
} as const

export const DECOR = {
  DENSITY: 0.16,
  MIN_OFFSET: 1.35,
  MAX_OFFSET: 18,
  OFFSET_BIAS: 1.7,
  SEED: 20250815,
  /**
   * How many placements back the decorator remembers, per side, to avoid repeating a prop.
   *
   * **This is the "ten identical rocks in one spot" fix.** The key was drawn independently per
   * placement, so with a biome offering four distinct props a run of neighbouring segments picked
   * the same one about as often as not — and neighbouring segments are 200 world units apart,
   * which at any distance reads as a clump of clones rather than as scenery. Remembering the last
   * few and re-rolling against them costs one small array and removes the artefact entirely.
   *
   * Bounded rather than "never repeat": a biome with four props cannot avoid repeating forever,
   * and a decorator that tried would either loop or run out of choices.
   */
  NO_REPEAT_WINDOW: 3,
} as const

/**
 * Slots in the scenery pool. Fixed for the pool's whole lifetime — see `RoadSprites`.
 *
 * **Measured, not guessed, and re-measured when the scatter changed.** Sweeping the camera over
 * a whole lap peaks at **90** on-screen billboards, and that number barely moves with the
 * viewport (88 at 1920x945, 88 at 3440x1440, 90 at 390x844, 64 at 844x390) because what bounds it
 * is how many decorated segments fall in the visible band, not how wide the screen is. 120 leaves
 * a third of headroom over that peak, so eviction stays a safety valve rather than something the
 * player watches happen.
 *
 * **The previous value was 72 against a measured peak of 58, and widening the scatter silently
 * broke it**: with `DECOR.MAX_OFFSET` out to 18 half-widths and the density doubled to match, the
 * first re-measurement came back at exactly 72 of 72 — a saturated pool reports its own ceiling,
 * not the demand, so the real number was invisible until the pool was raised out of the way and
 * the sweep repeated. Any future change to `DECOR.DENSITY`, `DECOR.MAX_OFFSET` or `DRAW_DISTANCE`
 * has to be measured the same way round: raise the pool first, sweep, then size it.
 */
export const DECOR_POOL_SIZE = 120

/**
 * Depth of the ground mesh, below every billboard.
 *
 * Scenery draws at `-n` for its distance index `n` (far = more negative = drawn first, the
 * painter's order the whole renderer runs on), so the nearest possible billboard is depth `0`
 * and the ground has to sit below all of them. There is no depth buffer here: draw order *is*
 * the depth test.
 */
export const ROAD_MESH_DEPTH = -(DRAW_DISTANCE + 1)

/**
 * Rows in the palette texture — one per step of distance fog.
 *
 * **This is how the road fogs out without a tint, a filter or a second pass.** `Mesh2D` has one
 * object-wide tint and no per-vertex tint component, so a far segment cannot simply be drawn
 * darker. Instead the palette grows a second dimension: X still picks the colour, Y picks how
 * far into the fog it is, and a quad selects its row by its own distance. The cost is zero
 * extra draw calls, zero shader passes, and one more texture row per step.
 *
 * **48, up from the 16 this shipped with, and the old value's own docstring said why it would
 * eventually be wrong**: it claimed 16 was "past the point where the banding is visible against
 * this palette" — and *that* palette was near-black, where sixteen steps between two colours a
 * few units apart are indistinguishable. Against a daylight palette fogging toward near-white the
 * same sixteen steps are sixteen visible horizontal bands laid across the ground, which was half
 * of what the frame was rippling with. A row costs `PALETTE_COLUMNS` texels — the whole texture at
 * 48 rows is 21x48 — so this is the cheapest fix available to any banding problem here.
 *
 * **48 rather than 64, and the ceiling is set by a test rather than by taste.** `verify:road`
 * asserts every row is actually reachable, so no part of the texture is dead weight. With
 * `DRAW_DISTANCE` at 300 and `FOG_CURVE` front-loading the near end, 48 is the largest count where
 * that still holds: at 56 and 64 the curve steps straight over row 1 and it is never sampled.
 */
export const FOG_STEPS = 48

/**
 * How sharply the fog closes in with distance.
 *
 * Below 1 it builds quickly near the camera and flattens out; the road's own perspective
 * already compresses the far half of `DRAW_DISTANCE` into a few pixels, so a linear ramp spends
 * most of its steps where nobody can see them.
 */
export const FOG_CURVE = 0.62

/**
 * Which fog row a segment `n` steps from the camera samples.
 *
 * Clamped at both ends, so a caller that hands over a distance past `DRAW_DISTANCE` gets the
 * fully-fogged row rather than reading off the end of the texture.
 */
export function fogStepFor(distanceIndex: number, drawDistance: number = DRAW_DISTANCE): number {
  if (!(drawDistance > 0)) return 0

  const t = Math.min(1, Math.max(0, distanceIndex / drawDistance))

  return Math.min(FOG_STEPS - 1, Math.round(Math.pow(t, FOG_CURVE) * (FOG_STEPS - 1)))
}

/**
 * How much fog is over a billboard `distanceIndex` steps away, as `0..1`.
 *
 * **Shares `FOG_CURVE` with the ground on purpose.** The road fades through the palette's fog
 * rows and scenery fades by alpha, but if the two used different curves a tree would visibly
 * lead or lag the ground it stands on as it approaches — the one artefact that makes billboards
 * read as stickers rather than as objects in the world.
 *
 * Continuous rather than quantised into `FOG_STEPS`: the road is banded because a `Mesh2D` quad
 * samples one texel of a palette, which is a constraint of that renderer, not of fog. A sprite
 * can take the real value, and stepping it would only add banding nothing asked for.
 */
export function billboardFog(distanceIndex: number, drawDistance: number = DRAW_DISTANCE): number {
  if (!(drawDistance > 0)) return 0

  const t = Math.min(1, Math.max(0, distanceIndex / drawDistance))

  return Math.pow(t, FOG_CURVE)
}

/**
 * How much of a billboard's opacity the farthest fog takes.
 *
 * **Fog is applied as transparency rather than as a tint toward the fog colour**, because
 * `setTint` is a multiply and can only darken — on a pale fog it would send distant scenery
 * toward black while the road behind it washes out. Fading costs no extra draw call the way
 * compositing a fog-coloured copy over each sprite would.
 *
 * **0.30, down from the 0.78 this shipped with, because transparency and haze are not the same
 * thing and the difference only shows on a lit scene.** Haze puts something *between* you and the
 * object; alpha takes the object away and shows you what is behind it. At 0.78 the measured alpha
 * of the nearest, largest prop on screen was **0.78 and the farthest 0.60** — every piece of
 * scenery in the game was 22-40% see-through, and against a bright ground that reads as ghosts
 * rather than as distance. Against the near-black palettes it shipped on, "faded" and "faint"
 * looked identical, which is why it lasted.
 *
 * At 0.30 nothing is obviously transparent and the distance cue is carried where it belongs: by
 * the ground's own fog, which is a real colour blend through the palette, plus perspective size.
 *
 * **The correct fix, if this is ever revisited, is a second pass**: draw each billboard again on
 * top of itself with `setTint(fogColour).setTintMode(FILL)` at alpha `fog`, which blends the sprite
 * toward the fog colour instead of toward whatever is behind it. That is real aerial perspective
 * and it works on a pale fog. It costs one extra pooled image per visible sprite (~120), which the
 * frame budget can afford — it is not done here because doubling the pool touches the camera
 * ignore lists, the depth ordering and the DEV single-camera assertion, and a mistake in those is
 * worse than distant scenery being slightly too crisp.
 */
export const MAX_BILLBOARD_FOG = 0.3

/**
 * The V coordinate that samples the **centre** of fog row `step`.
 *
 * Exactly the same requirement as `paletteU`, for exactly the same reason: paired with NEAREST
 * filtering, sampling the centre guarantees a quad reads one row. Sampling a row *boundary*
 * would let a quad pick up the neighbouring fog step along its edges, which reads as the far
 * road shimmering between two shades.
 */
export function paletteV(step: number): number {
  return (Math.min(FOG_STEPS - 1, Math.max(0, step)) + 0.5) / FOG_STEPS
}

/**
 * The U coordinate that samples the **centre** of palette texel `index`.
 *
 * The centre, not the edge, is load-bearing: paired with the palette texture's NEAREST
 * filter (see `src/road/palette.ts`), it guarantees a quad samples exactly one texel.
 * Sampling at a texel *boundary* lets bilinear/rounding error pick up the neighbouring
 * colour along a quad's edge, which reads on screen as the road stripes "swimming" — a
 * bug that looks like broken projection but is purely a texture-sampling artifact.
 *
 * Lives in `constants.ts` rather than `palette.ts` (which it is conceptually part of, and
 * which re-exports it) purely so `scripts/verify-road-projection.mjs` can import it under
 * plain Node: `palette.ts` needs a runtime `phaser` import for `FilterMode`, this doesn't.
 */
export function paletteU(index: number): number {
  return (index + 0.5) / PALETTE_COLUMNS
}


