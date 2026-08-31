/**
 * Tuning numbers for the pseudo-3D (segmented / OutRun-style) road renderer.
 *
 * Deliberately free of any `phaser` import: `src/road/project.ts` and `src/road/track.ts`
 * both pull from here and must stay runnable under plain Node for `npm run verify:road`
 * (a value `import * as Phaser from 'phaser'` executes Phaser's init, which reads `window`
 * — see CLAUDE.md "Known Issues Fixed" for the same rule applied to the platform layer).
 */

import { BIOMES, GROUND_SHADES_PER_BIOME, ROAD_SHADES_PER_THEME } from './biomes'

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
 * Columns in the palette texture: the road's own colours, then each biome's ground shades.
 *
 * **Biome ground rides in the same texture as everything else**, which is the whole reason the
 * ground can vary along the track at all. `Mesh2D` carries one object-wide tint and no
 * per-vertex tint, so a per-segment ground colour cannot be a tint; it has to be a UV. Adding
 * columns costs one wider texture and nothing else — no extra draw call, no second mesh, no
 * shader. Same argument that put distance fog on the Y axis of this texture.
 *
 * The multiplier is `GROUND_SHADES_PER_BIOME` rather than a literal, because `createRoadPalette`
 * derives which biome a column belongs to by dividing by the same number: a bare `2` in one of
 * the two is a palette whose columns no longer mean what the mesh thinks they mean, and nothing
 * about the resulting picture says which half is wrong.
 */
export const PALETTE_COLUMNS =
  ROAD_PALETTE.length + BIOMES.length * GROUND_SHADES_PER_BIOME + ROAD_SHADES_PER_THEME

/**
 * The palette column for one of a biome's ground shades.
 *
 * `shade` comes from `groundShadeFor(segment.index)` — a hash, deliberately not the rumble
 * alternation this function used to take. See `groundShadeFor` for why the ground may not share
 * the stripes' beat.
 */
export function roadPaletteIndex(shade: number): number {
  const clamped = Math.min(ROAD_SHADES_PER_THEME - 1, Math.max(0, Math.trunc(shade)))

  // After the ground block, which is after the road's own declared colours. The three offsets are
  // computed from the same three constants everywhere, here and in `createRoadPalette`.
  return ROAD_PALETTE.length + BIOMES.length * GROUND_SHADES_PER_BIOME + clamped
}

export function groundPaletteIndex(biome: number, shade: number): number {
  const clampedBiome = Math.min(BIOMES.length - 1, Math.max(0, biome))
  const clampedShade = Math.min(GROUND_SHADES_PER_BIOME - 1, Math.max(0, Math.trunc(shade)))

  return ROAD_PALETTE.length + clampedBiome * GROUND_SHADES_PER_BIOME + clampedShade
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
 *
 * **Raised 40 -> 56 with the decal field, and it now has a second thing to clear.** A mark past
 * the end of the ground is drawn on sky exactly as a prop would be, so `DECAL_MAX_OFFSET` joins
 * `DECOR_TIERS.far.maxOffset` in the relationship the check asserts. The extra width costs
 * nothing per frame: the ground is two quads a segment whatever they span.
 */
export const GROUND_EXTENT = 56

/**
 * How far every prop is planted BELOW the ground it stands on, as a fraction of its own height.
 *
 * **A billboard's base sits exactly on the projected ground, and exactly is the wrong place.** The
 * sprite is a flat quad facing the camera while the ground recedes under it, so a base that lands
 * on the ground line at the sprite's own centre is already slightly above it at the sprite's front
 * edge — and every one of the errors that stack on top of that (the trim's own rounding, a model
 * whose lowest polygon is a rounded underside, the ground's curvature across a wide prop) pushes
 * the same way: up. Reported repeatedly as things hovering.
 *
 * The asymmetry is the argument for a bias rather than for chasing each cause: a prop sunk a
 * little into the ground reads as standing in it, and a prop floating the same distance reads as
 * broken. When the error can only go one way, bias against it.
 *
 * A fraction rather than a fixed distance, because the same absolute sink that is invisible under a
 * mountain would bury a lily pad.
 */
export const DECOR_SINK_FRACTION = 0.05

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
  far: { chance: 0.11, minOffset: 20, maxOffset: 34, scale: 2.6 },
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
  // **0.26, raised from 0.16 because the sides read as empty.** This is the chance of an object
  // on EACH side of a given segment, so the expected count in view is `DRAW_DISTANCE * DENSITY * 2`
  // — 96 at these numbers against 48 before. The pool moved with it; see `DECOR_POOL_SIZE`, which
  // is sized from a measured sweep rather than from this arithmetic, because a saturated pool
  // reports its own ceiling as the demand.
  DENSITY: 0.26,
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
// **⚠ RE-MEASURED WHEN THE VERGES WERE MADE DENSER, BY THE PROCEDURE THIS DOCSTRING PRESCRIBES.**
// `DECOR.DENSITY` went 0.16 -> 0.26 and the far tier's chance 0.05 -> 0.11. The pool was raised to
// 240 first — clear of any plausible demand — and only then swept, because a pool that saturates
// reports its own ceiling rather than the demand, which is exactly how the 72 figure survived being
// wrong. Swept over 361km of running, i.e. past a full 286,800-unit lap: **peak 147 wanted, 0
// frames over capacity.** 200 leaves the same third of headroom over that peak as 120 left over 90.
export const DECOR_POOL_SIZE = 200

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
 * How many rows of distance fog the palette texture carries.
 *
 * **⚠ Was 48, and 48 was too many for the opposite reason to the one that set it.** It came up
 * from 16 because sixteen steps of an RGB lerp toward near-white were sixteen visible bands across
 * the ground. What replaced that lerp is `fogBlend`, which moves lightness only — so a step is a
 * change in lightness alone, and at 48 the difference between adjacent rows is **below what the
 * eye separates**. The planes stop being planes: near, middle and far ground all read as one
 * surface with a slight gradient over it, which is the flattening this whole round is about.
 *
 * Twelve is deliberately few enough that a step is visible as a step. That is not stylisation: a
 * readable depth cue is a *quantised* one, and the same argument is why a cel-shaded object reads
 * as solid where a smoothly shaded one reads as soft.
 *
 * The floor stays what it always was — every row must be reachable, or part of the texture is
 * dead weight and the curve is skipping over it. `verify:road` asserts that, and it is the check
 * that caught 56 stepping straight over row 1 under the old front-loaded curve.
 */
export const FOG_STEPS = 12

/**
 * How sharply the fog closes in with distance, as an exponent on `distanceIndex / DRAW_DISTANCE`.
 *
 * **⚠ Was 0.62, i.e. FRONT-loaded, and it is now 3.0 — back-loaded.** The old value was chosen
 * when the fog was an RGB lerp and the argument was about texture economy: perspective compresses
 * the far half of `DRAW_DISTANCE` into a few pixels, so a linear ramp spends most of its rows
 * where nobody can see them. True of the rows, and the wrong thing to optimise for. What it
 * actually did was start taking colour away almost immediately — **0.245 of the way to full fog
 * at a tenth of the draw distance** — so the middle of the frame, which is where the game is
 * read, was already washed.
 *
 * At 3.0 the first half of the draw distance costs **12.5%** of the ramp and the near quarter
 * costs 1.6%: the near and middle field keep their colour, and the fade is spent in the far
 * quarter where there genuinely is air between the camera and the object. `verify:road` still
 * asserts every fog row is reachable, which is what stops the exponent being raised until the
 * curve steps over the near rows entirely.
 */
export const FOG_CURVE = 3

/**
 * How much saturation each family of palette column is given before it is baked.
 *
 * **⚠ Three numbers rather than one, because the surfaces have to stay apart.** The road, its
 * rumble stripes and the ground beside it are adjacent in the frame and were authored to separate
 * by lightness; pushing all three by the same factor keeps them exactly as far apart in hue as
 * they were, which is to say it makes the picture more colourful without making it more readable.
 * The verge takes the most — it is what the biome *is* — the road takes the least, because it is
 * the surface the player reads obstacles against and a saturated road competes with them, and the
 * stripe takes a middle share so it does not merge with either neighbour.
 *
 * Applied in HSL at bake time, so hue and lightness are untouched: this is saturation and nothing
 * else. `verify:road` re-runs the whole threat sweep and the rumble-contrast floor over the
 * boosted colours, because a saturation lift is exactly the kind of change that can walk a colour
 * into the reserved band or flatten an edge that was reading on chroma.
 */
export const PALETTE_SATURATION = { road: 1.18, rumble: 1.32, ground: 1.5 } as const

/**
 * What the fog does to saturation, per family of surface.
 *
 * **⚠ This is a correction to the rule that replaced the RGB lerp, and the correction is that the
 * rule was right about only half of what it was applied to.** Holding saturation while lightness
 * rises is correct for anything with a *silhouette*: a distant conifer that keeps its green reads
 * as a green tree far away, and one that loses it reads as grey. It is wrong for a **solid fill**.
 * The ground is one unbroken expanse from the verge to the horizon, and a fill that keeps full
 * saturation while getting lighter does not recede at all — it comes out as a coloured pancake
 * pasted against the sky, which is what was reported.
 *
 * So the two are split, and the split is by what the surface *is* rather than by taste:
 *
 * - **Decor holds its saturation and needs no entry here**, because it does not fade through this
 *   function at all: a billboard fades by *alpha* (`decorFog`), toward whatever is behind it, and
 *   at the far end that is the fog colour. Its hue and saturation are never touched.
 * - **The ground keeps only a small share of its chroma at the far end.** Stated as *what is kept*
 *   rather than as a loss, and measured in **OKLCh** — see `fogBlendFill` for the two rounds spent
 *   discovering that HSL's saturation is not chroma, and that a fill whose lightness is being
 *   lifted gets louder even while its `s` falls.
 * - **The road keeps most of its**, because it starts near-neutral: there is little to take away
 *   and the road is what the player reads obstacles against.
 */
export const FOG_SATURATION = { ground: 0.12, road: 0.55 } as const

/**
 * Over what share of the fog rows the surface additionally dissolves into the sky.
 *
 * **⚠ The ground used to end at `theme.fog` and the sky began at `sky.bottom`, and those are two
 * different colours meeting on one row.** However good either is, a hard horizontal edge across
 * the frame reads as an artefact — the same defect, in a different place, as the cut-off cloud
 * lobes and the banded vignette. Over the last quarter of the ramp the surface blends the rest of
 * the way to the sky it meets, so the last row *is* the sky and there is no edge to see.
 *
 * A share of the rows rather than a count, so it survives `FOG_STEPS` changing — which it has, in
 * both directions.
 */
export const GROUND_HORIZON_BLEND = 0.25

/**
 * How far the ground's fade target is moved from the fog colour toward the sky, as `0..1`.
 *
 * `theme.fog` is the colour the far field as a whole sits in. The ground, though, runs all the way
 * to the horizon and meets the *sky* there, which on a sunset theme is much lighter than the fog.
 * Fading to the fog alone left `dusk`'s verge eleven points of lightness **darker** than the air
 * one row short of the horizon — receding into something darker than what it recedes against,
 * which is the inverse of aerial perspective. The road keeps the fog target: what the player reads
 * running to the horizon is the verge.
 */
export const GROUND_FOG_TOWARD_SKY = 0.7

/**
 * The band of hue that belongs to the air, which a biome's ground may not enter.
 *
 * **⚠ Blue and turquoise are the colours of AIR, and ground may not borrow them.** Measured on the
 * shipped palettes against `day`'s horizon at hue 199: `wetland` sat at **170 degrees and 55%
 * saturation** and `fungal` at **171 and 55%** — saturated turquoise fields competing with the sky
 * above them — and `crystal` at 238 and 31%. All three are repainted **by hue alone**, at equal
 * relative luminance, because a biome is recognised by its colour and separated from the road by
 * its lightness and those are two different jobs.
 *
 * **⚠ Stated as an absolute band rather than as a distance from each theme's sky, and the first
 * version was the latter.** A minimum gap from every theme's horizon is unsatisfiable and, worse,
 * it is the wrong question: the seven skies run from `ember`'s 40 through `verdant`'s 123 and
 * `day`'s 199 to `dusk`'s 326, so requiring 45 degrees from all of them leaves a handful of narrow
 * windows and forces two biomes onto the same hue. It also fights the rule the whole system rests
 * on — **a biome is a place and a theme is a light, and the two are orthogonal.** Under a blue
 * moon the ground goes blue *and so does everything else*; that is the light, not the ground
 * borrowing the air's colour. What is absolute is which hues read as air, and those are the cyans.
 *
 * The saturation floor is the same third term the threat reservation carries: `ruins` sits at hue
 * 210 and `ridge` at 217, both inside the band, and both are *grey* — at 5% and 12% saturation a
 * hue angle is numerical noise. A grey ground is not sky-coloured.
 */
export const GROUND_AIR_HUE_BAND = { from: 160, to: 235 } as const
export const GROUND_HUE_SATURATION_FLOOR = 0.25

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
 * How far in front of the draw distance a billboard fades up from nothing, as a fraction of that
 * distance.
 *
 * **⚠ THIS IS A SEPARATE QUANTITY FROM `MAX_BILLBOARD_FOG` AND CONFLATING THEM CAUSED A REGRESSION.**
 * The two answer different questions:
 *
 *   MAX_BILLBOARD_FOG   how hazy a distant object LOOKS. A property of the whole far field.
 *   this               how long an object takes to APPEAR. A property of one boundary.
 *
 * They were the same number by accident: with the fog at 0.30, an object entering the draw
 * distance started at alpha 0.70 and that was gentle enough to read as arriving out of haze. When
 * the fog was cut to 0.12 — correctly, because at 0.30 nearby props were visibly see-through over a
 * bright road — an object started at **alpha 0.88** instead, and the arrival became a pop. Reported
 * as things "appearing out of nowhere", and the mountains worst of all: a range is one sprite the
 * size of the sky, so its whole silhouette switched on at once and read as the world assembling
 * itself in layers.
 *
 * 0.28 of a 300-segment draw distance is 84 segments, or about 2.8 seconds at `SPEED_CAP` — long
 * enough that no single frame carries a visible step.
 *
 * **The band sits nowhere near anything the player has to react to.** An obstacle's reaction
 * distance is 13 segments; this fade lives between 216 and 300. `verify:obstacles` asserts the
 * alpha an obstacle is drawn at when the reaction budget starts, which is what keeps the two from
 * ever meeting.
 */
/**
 * The mountain range's backdrop layer — see `Backdrop`'s `SKYLINE_TEXTURE` for why it is a layer
 * at all rather than scenery.
 *
 * Here rather than beside the class because `Backdrop.ts` imports `phaser`, and the one number in
 * this table that has already been wrong needs a check that runs under plain Node.
 *
 * - `height` is the band's share of the viewport, and `sink` buries the strip's feet under the
 *   horizon so the ground covers them: a range whose bases are all *drawn* on one row reads as a
 *   row of standing objects rather than as terrain.
 * - **⚠ `driftPixels` is screen pixels of movement per world unit of `horizonDriftX`, and the
 *   first value was a guess that made the range unwatchable.** It was written as a bare factor on
 *   `tilePositionX` beside the sky's own 0.04-0.26, on the reasoning that a range is nearer than
 *   the sky and must lead it. That reasoning is fine and the units are not: `horizonDriftX` is the
 *   integrated curvature in **world** units, it swings +/-90 000 over a lap and changes by **27 132
 *   per second** at `SPEED_CAP` on the worst bend. At 0.55 that scrolled the strip roughly twelve
 *   tile-widths a second — reported as the mountains running, and running faster the faster you
 *   drive. The sky survives the same quantity at 0.26 only because a gradient has no feature that
 *   can be seen moving.
 *
 *   So the number is stated as what it does to the picture, and `verify:road` holds it to a budget
 *   measured off the real circuit at `MAX_ATTAINABLE_SPEED` — the boost included, because "it goes
 *   faster the faster I drive" is the report, and the boost is the fastest the game gets. At 0.0012
 *   the worst bend moves the range **55px a second** and a whole lap shifts it **218px**, about an
 *   eighth of a frame: a horizon that answers to the road without ever streaming past.
 */
export const SKYLINE_LAYER = { driftPixels: 0.0012, height: 0.3, sink: 0.035 } as const

/**
 * How much of the range's colour the biome under the player is allowed to supply, as `0..1`.
 *
 * **The far silhouette belongs to the air, not to the ground.** The strip used to be tinted with
 * the same product every verge prop is drawn with — `biome.decorTint * theme.decorTint`, the
 * ground family — so walking from the forest into the dunes repainted a mountain range that is
 * kilometres away and made of neither. A ridge at that distance is mostly the atmosphere in front
 * of it; that is why distant hills read blue-grey whatever they are made of, and it is the whole
 * reason a horizon cannot answer to what is underfoot.
 *
 * So the base is the theme's own air at the horizon (`sky.bottom` — the end of the sky gradient
 * the range is seen through, and the slot the SKYLOCK plates were authored against) and the biome
 * is a *steer* on top of it, nothing more. The complement, **0.85, is the aerial perspective**:
 * this is the same quantity the old `SKYLINE_TINT_MIX = 0.62` stated from the other end, and the
 * move from 0.38 to 0.15 of biome is what takes the seam from visible to not.
 *
 * **⚠ This is not `MAX_BILLBOARD_FOG` and must never be derived from it.** That constant is how
 * far a *billboard's alpha* is taken away with distance, it is load-bearing for how obstacles and
 * pickups read at the reaction distance, and it never reaches this layer — the range is a
 * `TileSprite` with no distance and no alpha ramp at all. Two quantities, two owners.
 */
export const BIOME_SKYLINE_WEIGHT = 0.15

/** Size of the strip `scripts/build-sprites.py` composites. Width matters — see `layoutSkyline`. */
export const SKYLINE_TEXTURE_SIZE = { width: 3072, height: 384 } as const

/**
 * The cloud band: how tall it is drawn, where it sits, and how fast it answers to a bend.
 *
 * **⚠ Clouds may not be baked into a sky plate, and that is recorded rather than guessed.** A sky
 * layer tiles horizontally at 1:1 while being stretched to the full viewport vertically — roughly
 * three times on a 945px frame against a 320px plate — so anything with shape in both axes comes
 * out as spires. That is exactly why `day_v5` was re-picked: its round cloud lobes drew as pale
 * vertical spikes along the horizon. A plate may carry horizontal structure and nothing else.
 *
 * So this is its own `TileSprite`, the fifth layer, on the mountain range's pattern:
 *
 * - `height` is a fraction of the **texture's** own height, applied as one uniform scale to both
 *   axes. That is the whole difference from a sky layer, which derives its vertical scale from the
 *   viewport. Uniform means the aspect is preserved exactly, which is what makes the shape the same
 *   on a 320px frame and a 1440px one.
 * - `sink` puts the band's foot below the horizon, so a cloud never appears to stand on the ground.
 * - `driftPixels` is **screen pixels per world unit of horizon drift**, the unit `SKYLINE_LAYER`
 *   had to be restated in after a bare factor sent the mountains running: `horizonDriftX` is the
 *   curvature integrated to the draw distance, in world units, and it swings ±90 000 over a lap.
 *   Half the range's figure, because a cloud is further away than a ridge.
 */
export const CLOUD_LAYER = { height: 1, sink: 0.02, driftPixels: 0.0006 } as const

/** Size of the generated cloud strip. Wide, because it wraps horizontally and must outrun a frame. */
export const CLOUD_TEXTURE_SIZE = { width: 2048, height: 288 } as const

/**
 * Where the sun sits and how big it is drawn, as fractions of the frame.
 *
 * **Pinned to the frame, and that is a property of the projection rather than a simplification.**
 * `projectInto` puts a point at `screenWidth / 2 + scale * (x - cameraX) * screenWidth / 2` and
 * `scale` goes to zero with distance, so **every** infinitely distant point projects to the exact
 * centre of the frame at every camera position. This projection has no way to represent a
 * *direction*, only a position — so an object at infinity cannot drift when the road bends, and
 * its place in the frame cannot be derived from an azimuth. `x` and `y` are a composition
 * decision and are written as one.
 *
 * **Sized off the frame's HEIGHT, never its width**, because the sky is a share of the height:
 * measured off the width this would be a pinhead on an ultrawide frame and half the sky on a
 * portrait phone.
 *
 * `size` covers the whole drawn image — disc *and* rays — so growing it grows both together.
 * Placed off-centre and high for what is around it: the distance readout is centred at the top,
 * the shield pips sit top-left, and the mountain range tops out around 0.32 of the frame.
 */
export const SUN = { x: 0.76, y: 0.2, size: 0.3 } as const

/**
 * Smallest gap between the sun and the frame's edge, as a fraction of the frame's width.
 *
 * **⚠ `SUN.x` is a fraction of the WIDTH and `SUN.size` a fraction of the HEIGHT, and on a
 * portrait frame those two diverge far enough to push the sun off the screen.** At 390x844 the
 * drawn image is 253px against a 390px frame, so a centre at `0.76` of the width puts its right
 * edge at 423 — thirty-three pixels outside. It fit before only because the sun was smaller: the
 * defect arrived the moment it was grown, and no aspect anybody had open would have shown it.
 *
 * The fix is a clamp rather than a smaller sun or an `x` moved inwards for everyone, because both
 * of those pay for the narrowest frame on every other one. Sizing stays off the height — that
 * rule is right, and measured off the width this would be a pinhead on an ultrawide frame.
 */
export const SUN_EDGE_MARGIN = 0.02

/**
 * Where the sun's centre actually goes, with the frame's own width taken into account.
 *
 * Pure and exported so `verify:road` can sweep it at every supported aspect rather than assert
 * against the raw fraction, which is the number that is wrong.
 */
export function sunCenterX(width: number, height: number): number {
  const halfDrawn = sunSize(width, height) / 2
  const margin = width * SUN_EDGE_MARGIN

  return Math.min(Math.max(width * SUN.x, halfDrawn + margin), width - halfDrawn - margin)
}

/**
 * The largest the sun may be drawn, as a fraction of the frame's **width**.
 *
 * **⚠ `SUN.size` is a share of the HEIGHT, and on a portrait phone that is half the frame's width.**
 * At 375x667 — an iPhone SE, the narrowest thing this game supports — `0.3` of the height is 200px
 * against a 375px frame: **53% of the width**, where the same constant is 15% of a 1568px desktop.
 * The asymmetry is a property of the projection, not of the constant: everything sized off one axis
 * and read against the other diverges as the aspect does, which is the same arithmetic that made the
 * mascot too small on a phone, arrived at from the other end.
 *
 * What it cost was reported directly: the sun sat behind the wordmark on the front screen, and in a
 * run it sits behind the leaf gauge. **Sizing off the height is still the right rule** — measured off
 * the width the sun would be a pinhead on an ultrawide frame — so this is a ceiling on it rather
 * than a replacement, exactly as `sunCenterX` is a clamp rather than a smaller `SUN.x`.
 *
 * **0.24 is derived rather than chosen, and the derivation is a check rather than arithmetic here.**
 * What has to be true is that the front screen's wordmark fits between the sun's bottom edge and the
 * bottom of its own band — the band is what keeps the title off the vanishing point and out of the
 * HUD's rows, so it is not somewhere the title may be pushed out of. Three portrait frames
 * independently want a ceiling near 0.245; `verify:menu` measures the clearance at every supported
 * aspect and carries the unbounded sun as its control. It does not bind on any landscape frame at
 * all — a desktop sun is unchanged to the pixel.
 */
export const SUN_MAX_WIDTH_FRACTION = 0.24

/**
 * How big the sun is actually drawn, in pixels.
 *
 * Pure and exported so both the backdrop and the front screen's own layout read one answer — a
 * second expression of this is a second thing that can disagree about where the sun ends.
 */
export function sunSize(width: number, height: number): number {
  return Math.min(height * SUN.size, width * SUN_MAX_WIDTH_FRACTION)
}

/** Diameter of the generated sun texture, in pixels. */
export const SUN_TEXTURE_SIZE = 320

/**
 * Where the disc ends and the halo begins, as a fraction of the texture's radius.
 *
 * **Two stops close together rather than one long ramp**, because a sun is an object with an edge
 * and a single falloff draws a fuzzy ball with none. The halo that follows is the long tail, and
 * it is what stops the edge reading as a sticker cut out of the sky.
 *
 * The gap between them is what "cartoon" actually means here, mechanically: a wide gap is an
 * airbrushed glow, a narrow one is a drawn shape. Tightened from `0.30..0.37` to `0.32..0.35`, so
 * the edge is a line rather than a fade while the halo behind it is untouched.
 */
export const SUN_DISC_STOP = 0.32
export const SUN_EDGE_STOP = 0.35

/**
 * How far the core is pushed towards white, as `0..1`.
 *
 * A sun's disc is white-hot and its *halo* carries the colour — drawn in one flat tint the whole
 * thing reads as a pale sticker, which is what the first version was. The core is still derived
 * from the theme rather than hardcoded, so a cool night glow still gives a cool moon.
 *
 * **Whitening moves a colour towards white, i.e. towards zero chroma**, so raising it can only
 * move the sun *away* from the reserved threat band, never into it. That is why this number is
 * free to be tuned by eye while the colour it is applied to is not.
 *
 * **⚠ Two numbers, because one of them made the disc white and a white disc is not a cartoon
 * sun.** Pushed to 0.72 everywhere the sun came out bright and colourless — brighter, which was
 * the ask, and read as a bare bulb: the rays were the only warm thing left in the object. The hot
 * centre keeps the high number and the disc's own rim keeps most of the theme's colour, so the
 * disc is yellow with a white core rather than uniformly pale. That gradient across the disc is
 * also what a drawn sun has and a photographed one does not.
 */
export const SUN_CORE_WHITEN = 0.84
export const SUN_RIM_WHITEN = 0.34

/** Where the hot centre gives way to the disc's own colour, as a fraction of the texture radius. */
export const SUN_CORE_STOP = 0.14

/**
 * The spikes around the disc.
 *
 * **Rays are what make this read as drawn rather than as a light source**, and they are the one
 * part of the sun that is a shape rather than a gradient. Everything about them is stated as a
 * fraction of the texture radius or as an angle, so the whole thing scales with `SUN.size` and
 * with the viewport without a second set of numbers.
 *
 * - `count` is **even on purpose**: the lengths alternate, so an odd count would put two long
 *   rays next to each other where the ring closes. `verify:road` asserts it.
 * - `innerRadius` sits **inside `SUN_DISC_STOP`**, so every ray's root is covered by the disc
 *   drawn over it. A ray that started outside the disc would show its own base as a hard edge
 *   floating just off the sun, which reads as a crack rather than as light.
 * - `tipTaper` is the tip's width as a fraction of the base's. Not zero: a needle-sharp ray reads
 *   as a lens flare, and a blunt one reads as drawn. This is the single number that most decides
 *   whether the sun looks like a child's drawing or like a photograph artefact.
 * - `halfAngle` has to leave a real gap at `count` rays or the spikes merge into a collar. The
 *   check compares it against the spacing rather than trusting the pair.
 */
export const SUN_RAYS = {
  count: 12,
  halfAngle: (9.5 * Math.PI) / 180,
  innerRadius: 0.24,
  longLength: 0.9,
  shortLength: 0.62,
  tipTaper: 0.46,
  /** Alpha at the root. The gradient along the ray takes it to zero at the tip. */
  alpha: 0.9,
} as const

/**
 * How the sun moves: a slow turn, a breath, and an occasional glint.
 *
 * **⚠ The corona is a separate texture from the disc so these can differ, and that split is the
 * whole feature.** Turning the disc does nothing — it is radially symmetric — and breathing it is
 * a sun that changes size, which reads as one that is approaching. What may move is the *light*:
 * the spikes sweep, lengthen and flare, and the body they come out of holds still.
 *
 * **Two breathing periods, not one, and they are deliberately incommensurate.** A single sine is a
 * mechanism: the eye finds the period in about three cycles and the sun starts reading as a
 * pulsing light rather than as a burning one. 4300 and 6700 have a common multiple of 288
 * seconds, so nothing a player sees repeats — `verify:road` asserts that rather than trusting the
 * two numbers to look unrelated.
 *
 * **The glint is a surge of the light, never a star or a streak.** A four-point sparkle is a lens
 * flare, i.e. an artefact of a camera, and this world does not have one — the same rule that made
 * the rays blunt trapezoids rather than points. So a glint is the whole corona brightening and
 * reaching further for half a second, on a smooth rise and fall with no step at either end.
 */
export const SUN_ANIM = {
  /** Degrees the corona turns per second. 60 degrees — one repeat of the long/short pattern — takes 12s. */
  spinDegreesPerSecond: 5,
  /** The two breathing periods, in milliseconds. See above for why there are two. */
  breathMs: [4300, 6700] as const,
  /** How much the corona's reach varies with the breath, as a fraction. */
  breathScale: 0.06,
  /** How much its alpha varies with the breath. */
  breathAlpha: 0.08,
  /**
   * Where the corona's alpha sits at rest.
   *
   * Below 1 so the glint has somewhere to go: a flare that cannot get brighter than the resting
   * state is a flare nobody sees. It tops out at exactly 1 at the peak of a glint.
   */
  restAlpha: 0.85,
  /** How often a glint comes and how long it lasts, in milliseconds. */
  glintPeriodMs: 7900,
  glintMs: 520,
  /**
   * How far into the cycle a scene starts, in milliseconds — so the first glint is not immediate.
   *
   * **⚠ Without it every scene flares in its first half-second.** The clock is per-backdrop and a
   * run builds its own, so the menu's handover — which is deliberately a fade of the interface over
   * a world that does not cut — would have had the sun flaring on the frame the run began, the one
   * discontinuity the whole handover exists to avoid. At 4000 the first glint lands 3.9s in.
   */
  glintOffsetMs: 4000,
  glintScale: 0.15,
  glintAlpha: 0.15,
  /**
   * How much the disc itself breathes.
   *
   * An order of magnitude under the corona's, because the disc has an edge and the corona does
   * not: a body that visibly changes size is a body that is moving toward you, and this one is at
   * infinity — see `SUN` for why it cannot move at all.
   */
  discBreath: 0.012,
} as const

export interface SunShimmer {
  /** How far the corona has turned, in degrees. Rises without bound; `Image.angle` wraps it. */
  spinDegrees: number
  /** Multipliers on the corona's drawn size and the disc's, and the corona's alpha, `0..1`. */
  rayScale: number
  rayAlpha: number
  discScale: number
}

/**
 * The sun's state at `elapsedMs` of **accumulated frame time**, not of wall clock.
 *
 * Accumulated, for the reason everything else timed in this project is: a backgrounded tab hands
 * back a multi-second delta, and a sun driven by `Date.now()` would jump a third of a turn on the
 * frame it comes back. Pure, so `verify:road` can sweep a minute of it under Node.
 */
export function sunShimmer(elapsedMs: number): SunShimmer {
  const t = Math.max(0, elapsedMs)
  const breath =
    (Math.sin((t / SUN_ANIM.breathMs[0]) * Math.PI * 2) + Math.sin((t / SUN_ANIM.breathMs[1]) * Math.PI * 2)) / 2
  const into = (t + SUN_ANIM.glintOffsetMs) % SUN_ANIM.glintPeriodMs
  // A half-sine over the glint's own window: zero at both ends, so there is no step into it or out
  // of it. A linear ramp would show its corners, which reads as a light being switched.
  const glint = into < SUN_ANIM.glintMs ? Math.sin((into / SUN_ANIM.glintMs) * Math.PI) : 0

  return {
    spinDegrees: (t / 1000) * SUN_ANIM.spinDegreesPerSecond,
    rayScale: 1 + breath * SUN_ANIM.breathScale + glint * SUN_ANIM.glintScale,
    rayAlpha: Math.max(
      0,
      Math.min(1, SUN_ANIM.restAlpha + breath * SUN_ANIM.breathAlpha + glint * SUN_ANIM.glintAlpha),
    ),
    discScale: 1 + breath * SUN_ANIM.discBreath,
  }
}

/** One ray's angle and length, so the geometry can be checked without a canvas. */
export function sunRay(index: number): { angle: number; length: number } {
  const wrapped = ((index % SUN_RAYS.count) + SUN_RAYS.count) % SUN_RAYS.count

  return {
    angle: (wrapped / SUN_RAYS.count) * Math.PI * 2,
    // Alternating, which is the whole reason `count` must be even.
    length: wrapped % 2 === 0 ? SUN_RAYS.longLength : SUN_RAYS.shortLength,
  }
}


export const BILLBOARD_FADE_IN_FRACTION = 0.28

/**
 * How opaque a billboard is at `distanceIndex`, as `0..1`, from the fade-in alone.
 *
 * Smoothstep rather than linear: a linear ramp has a corner at each end, and the corner at the top
 * — where the sprite reaches full opacity — is exactly the kind of discontinuity the eye catches on
 * an object that is also growing. Smoothstep leaves both ends flat.
 */
export function billboardAppear(distanceIndex: number, drawDistance: number = DRAW_DISTANCE): number {
  const band = drawDistance * BILLBOARD_FADE_IN_FRACTION

  if (!(band > 0)) return 1

  const t = Math.min(1, Math.max(0, (drawDistance - distanceIndex) / band))

  return t * t * (3 - 2 * t)
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
 * **⚠ 0.30 WAS STILL VISIBLY TOO MUCH ONCE THE WORLD GOT BRIGHT, AND IT WAS REPORTED AS EXACTLY
 * THAT — "the textures are transparent".** The figure was set against the rail shooter's near-black
 * palette, where taking 30% of a prop's alpha away over a dark ground changes very little; over a
 * pale flagstone road and a bright sky the same 30% is the sky showing through a mushroom. Now
 * 0.12, which is the most the eye reads as haze rather than as a hole. The argument above is
 * unchanged and is what makes this affordable: perspective size and the ground's own palette fog
 * were always doing the distance work, and this was only ever the seasoning.
 *
 * **The correct fix, if this is ever revisited, is a second pass**: draw each billboard again on
 * top of itself with `setTint(fogColour).setTintMode(FILL)` at alpha `fog`, which blends the sprite
 * toward the fog colour instead of toward whatever is behind it. That is real aerial perspective
 * and it works on a pale fog. It costs one extra pooled image per visible sprite (~120), which the
 * frame budget can afford — it is not done here because doubling the pool touches the camera
 * ignore lists, the depth ordering and the DEV single-camera assertion, and a mistake in those is
 * worse than distant scenery being slightly too crisp.
 */
export const MAX_BILLBOARD_FOG = 0.12

/**
 * How far a billboard of scenery fades, by tier.
 *
 * **⚠ One ceiling for all scenery is why the middle distance was white.** `far` exists to be
 * *air* — huge silhouettes beyond the corridor, whose whole job is to sit in the haze and give the
 * horizon depth — and it wants most of the ramp. `mid` is the verge: the trees and rocks the
 * player actually looks at, at the distance the game is read. Fading those by the same 0.85 is
 * what took a conifer forty segments out and made it paler than the identical conifer at ten,
 * which is the defect this is split for. The near tier is barely faded at all; it passes the
 * camera in a moment and is the one thing in the frame at full colour by design.
 *
 * `MAX_BILLBOARD_FOG` is deliberately not in this table: it is a **combat** constant, what
 * obstacles and pickups fade by, and `verify:obstacles` measures what a hazard still has at the
 * distance `REACTION_MS` is counted from. A prop that is hard to see is atmosphere; a rock that is
 * hard to see is an unfair hit.
 */
export const DECOR_FOG_BY_TIER = { near: 0.15, mid: 0.45, far: 0.85 } as const

/**
 * How hard the decor haze is held off until the far end, as an exponent on `billboardFog`.
 *
 * **⚠ It was 4, on top of a FRONT-loaded `FOG_CURVE` of 0.62, and it exists because of that
 * curve.** `billboardFog` was already a quarter of the way to full fog a tenth of the distance
 * out, so a large ceiling had to be gated hard to keep the near field opaque. The curve is
 * back-loaded now (`FOG_CURVE` is 3), which does that job in the right place, and a second
 * exponent on top of it would push the whole fade into the last few segments and leave the far
 * tier as crisp as the near one — the opposite failure. 1.35 is a light shaping of a curve that
 * is already correct rather than a rescue of one that was not.
 */
export const DECOR_FOG_GATE = 1.35

/** How faded a billboard of scenery is at `distanceIndex`, given the tier it belongs to. */
export function decorFog(
  distanceIndex: number,
  ceiling: number = DECOR_FOG_BY_TIER.mid,
  drawDistance: number = DRAW_DISTANCE,
): number {
  return ceiling * Math.pow(billboardFog(distanceIndex, drawDistance), DECOR_FOG_GATE)
}

/**
 * Which ceiling a prop drawn at `tierScale` belongs under.
 *
 * Keyed off the scale rather than a stored tier because that is what the placement already
 * carries — see `RoadSprite.tierScale` — and one fact stored in one place cannot disagree with
 * itself. The far tier is the only one scaled up past the verge, so the test is a threshold.
 */
export function decorFogCeiling(tierScale: number): number {
  if (tierScale >= DECOR_TIERS.far.scale) return DECOR_FOG_BY_TIER.far
  if (tierScale >= DECOR_TIERS.near.scale) return DECOR_FOG_BY_TIER.near

  return DECOR_FOG_BY_TIER.mid
}

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


