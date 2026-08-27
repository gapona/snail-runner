/**
 * Biomes: what the ground beside the road is made of, and what grows on it.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:road`.
 *
 * **A biome is a stretch of track; a theme is a palette over the whole game.** The two are
 * deliberately orthogonal and it is worth being precise about why, because collapsing them is the
 * obvious simplification and it is wrong: a theme answers "what light is this scene in" and
 * changes every colour at once, while a biome answers "what place is this" and changes only along
 * the road. Merging them would mean six themes times six places is thirty-six palettes to author
 * instead of six plus six, and a run would no longer pass through anything — the whole track
 * would be one biome because the theme is one.
 *
 * So a biome contributes two things and nothing else:
 *
 *  - **Ground colours**, which reach the renderer as extra columns in the road palette texture.
 *    They are theme-agnostic base colours; the theme's fog blends over them exactly as it does
 *    over the road, so a forest in `ice` is a cold forest without anyone authoring one.
 *  - **A prop set**, which `decorateTrack` draws from. Scenery is desaturated and tinted at draw
 *    time by the theme, so a prop never needs a per-theme variant either.
 *
 * The ground colours are authored as a pair — see `GROUND_ALTERNATION` for why only one of them
 * reaches the screen, and `GROUND_SHADES_PER_BIOME` for what is drawn instead.
 */

// `color.ts` imports no phaser either, so this stays on the testable side of the line.
import { contrastRatio, fromOklab, relativeLuminance, toOklab } from './color'

/**
 * Smallest contrast ratio between a biome's ground and the asphalt it lies beside.
 *
 * The number the road's edge needs in order to read, and nothing more — this is a separation
 * floor, not a brightness target. 1.6 is the same figure `verify:road` already holds the rumble
 * stripe to against the asphalt, and for the identical reason: the stripe and the verge are the
 * two things that tell the player where the road stops.
 */
export const MIN_GROUND_CONTRAST = 1.6

/**
 * How much of a biome's authored light/dark alternation actually reaches the screen, `0..1`.
 *
 * **Zero: the ground does not alternate.** The pair exists because a flat expanse beside the road
 * would otherwise read as motionless however fast the camera is moving — a real problem with a
 * real fix — but the ground is by a wide margin the **largest surface in the frame**, and a
 * rhythm laid across it does not read as motion, it reads as a moiré over the whole picture. That
 * is what a player reported seeing, in those words, and it is the correct reading.
 *
 * **The cue it provided is not lost, because it was never the only one.** Four motion cues remain
 * and every one of them is on a smaller surface, where a rhythm reads as rhythm: the road's own
 * asphalt alternation, the dashed centre line, the rumble stripes down both edges, and the
 * scenery streaming past. The ground was the fifth and the only one big enough to become texture.
 *
 * Kept as a knob at 0 rather than deleted, and that is a deliberate line: removing the pair
 * outright would mean one palette column per biome instead of two, which touches
 * `PALETTE_COLUMNS`, `groundPaletteIndex` and the mesh's own alternation handling — a wide change
 * to reach a look that one number already reaches. The second column simply carries the same
 * colour, and turning the effect back on is an edit here.
 */
export const GROUND_ALTERNATION = 0

/**
 * How many palette columns each biome's ground occupies.
 *
 * **Two was one shade with a knob turned off**, not a texture. `GROUND_ALTERNATION` collapsed the
 * authored pair into a single colour, so every biome drew as one flat expanse across the largest
 * surface in the frame — which is what "the ground has no fibre" means, mechanically.
 *
 * Five, because a `Mesh2D` cannot express this any other way: it has one object-wide tint, no
 * per-vertex tint and no second UV set, so a per-segment ground colour has to be a column in the
 * palette (see `PALETTE_COLUMNS`). Adding columns costs a wider 1px-per-texel texture and
 * **nothing else** — no draw call, no pass, no shader. The same argument put distance fog on
 * this texture's other axis.
 *
 * Named rather than written into `PALETTE_COLUMNS` as a literal: three call sites derive their
 * arithmetic from it, and a bare `* 2` in one of them is how a palette silently stops lining up
 * with the columns actually baked into it.
 */
export const GROUND_SHADES_PER_BIOME = 5

/**
 * The five shades, as offsets from the biome's own ground colour in OKLab.
 *
 * **⚠ Lightness and chroma are moved INDEPENDENTLY, and that is the whole reason this is a
 * table rather than a ramp.** A set spread along one axis — five steps of brightness, or five
 * steps of saturation — reads as one colour under a gradient, because the eye has a single
 * ordering to collapse them onto. Shade 1 is darker *and* duller, shade 3 lighter *and* richer,
 * shade 4 lighter *and* duller: no monotone relation between the two columns, so no ordering the
 * eye can flatten. Hue is deliberately untouched — five hues is five materials, and this is one
 * material lit and worn unevenly.
 *
 * The numbers are OKLab units, where `L` runs 0..1 and chroma is roughly 0..0.4 for anything the
 * ground is made of. `verify:road` holds the delivered set apart on both axes rather than
 * trusting these, because what actually reaches the screen has been through the theme's light,
 * the separation push against the asphalt and the fog blend.
 */
export const GROUND_SHADE_SPREAD: readonly { lightness: number; chroma: number }[] = [
  { lightness: -0.052, chroma: +0.014 },
  { lightness: -0.024, chroma: -0.011 },
  { lightness: 0, chroma: 0 },
  { lightness: +0.026, chroma: +0.009 },
  { lightness: +0.055, chroma: -0.016 },
]

/** Moves a colour by an OKLab lightness and chroma offset, keeping its hue. */
function shiftLightnessAndChroma(colour: number, lightness: number, chromaDelta: number): number {
  const lab = toOklab(colour)
  const current = Math.hypot(lab.a, lab.b)
  // A grey has no hue to preserve, so a chroma offset has no direction to point in. Left alone
  // rather than given an arbitrary one: `signal` is an almost monochrome theme by design.
  const scale = current > 1e-6 ? Math.max(0, current + chromaDelta) / current : 1

  return fromOklab({
    L: Math.min(1, Math.max(0, lab.L + lightness)),
    a: lab.a * scale,
    b: lab.b * scale,
  })
}

/**
 * The `GROUND_SHADES_PER_BIOME` colours a biome's ground is drawn in, under one theme.
 *
 * **Derived from the pair rather than authored per biome, and the order matters.** The pair is
 * what carries this biome's identity and what `groundPairForTheme` has already pushed clear of
 * the asphalt — so the spread runs on its *output*, not on the raw authored colour. Spreading
 * first would hand the separation rule five inputs and let it push each one a different distance,
 * which is how a biome ends up with one shade that has quietly merged with the road.
 *
 * **⚠ The lightness spread is ANCHORED at the pair and runs away from the road, never centred
 * on it.** Centred is the obvious reading of a spread and it walks the far end straight across
 * the asphalt's own brightness: measured on the first version, `day`/`forest` delivered a shade
 * at **1.00:1** against the road — the exact arrangement `MIN_GROUND_CONTRAST` exists to forbid,
 * on the default theme, and invisible to the old check because that only ever measured the pair.
 * Anchoring costs nothing: the range is the same, the darkest (or lightest) shade is simply the
 * pair itself, which has already been cleared, and every other shade is further from the road
 * rather than nearer. The direction is decided once for the whole set from the pair's own lean,
 * exactly as the separation push decides it — splitting a set across the road's brightness is
 * the one arrangement guaranteed to make part of it invisible.
 */
export function groundShadesForTheme(
  ground: readonly [number, number],
  roadDark: number,
  roadLight: number,
  alternation?: number,
  groundLight?: number,
): number[] {
  const pair = groundPairForTheme(ground, roadDark, roadLight, alternation, groundLight)
  const roadHi = Math.max(relativeLuminance(roadDark), relativeLuminance(roadLight))
  const brighten = relativeLuminance(pair[0]) >= roadHi

  const offsets = GROUND_SHADE_SPREAD.map((offset) => offset.lightness)
  const anchor = brighten ? Math.min(...offsets) : Math.max(...offsets)

  return GROUND_SHADE_SPREAD.map((offset) => {
    const lightness = offset.lightness - anchor
    const shade = shiftLightnessAndChroma(pair[0], lightness, offset.chroma)

    return clearOfRoad(shade, pair[0], roadDark, roadLight, brighten, offset.chroma)
  })
}

/**
 * Nudges one shade further from the road until it clears `MIN_GROUND_CONTRAST`.
 *
 * **⚠ The chroma half of the spread moves luminance too, and that is enough to matter at the
 * boundary.** `groundPairForTheme` pushes a pair to *exactly* the floor and stops, so a biome
 * sitting on it has no headroom at all: on `ice`/`crystal` a chroma offset of +0.014 took the
 * anchor shade to **1.59:1** against a floor of 1.60. Anchoring the lightness spread cannot
 * prevent that, because the offending shade is the anchor itself.
 *
 * Only the shade that actually falls short moves, and it moves in the set's own direction — so
 * it ends up further from its neighbours rather than collapsed onto them, which is what a naive
 * clamp to the floor would do to every violating shade at once.
 */
function clearOfRoad(
  shade: number,
  reference: number,
  roadDark: number,
  roadLight: number,
  brighten: boolean,
  chromaDelta: number,
): number {
  const nearest = (colour: number) =>
    Math.min(contrastRatio(colour, roadDark), contrastRatio(colour, roadLight))

  if (nearest(shade) >= MIN_GROUND_CONTRAST) return shade

  const base = toOklab(reference).L
  const step = brighten ? 0.004 : -0.004
  let lightness = toOklab(shade).L - base

  // Bounded: 60 steps is 0.24 of OKLab lightness, which is further than any ground could need and
  // still terminates if a theme is ever authored where no amount of pushing can clear the road.
  for (let i = 0; i < 60; i++) {
    lightness += step

    const moved = shiftLightnessAndChroma(reference, lightness, chromaDelta)

    if (nearest(moved) >= MIN_GROUND_CONTRAST) return moved
  }

  return shade
}

/**
 * How many segments one patch of ground covers — the wavelength of the noise the shade is drawn
 * from, not a hard run length, so what comes out varies either side of it.
 *
 * **A segment is 200 world units, so this is what the number means on screen:** fourteen of them
 * is 2800 units, about 0.8s of ground at `SPEED_CAP` and 1.9s at `SPEED_BASE`. Measured on the
 * shipped value, patches run a **median of 6 segments and a mean of 8.6**, and only **2.1% of the
 * ground sits in a patch shorter than three** — that last figure is the one that was tuned for.
 * At a spacing of 10 it is 8.3%, and those one- and two-segment slivers are precisely the
 * per-segment ripple this whole step exists to remove: at this projection a one-segment patch is
 * a horizontal band across the verge, which is a stripe, not ground.
 *
 * The upper bound is the visible verge. Past about twenty the patches are longer than what is on
 * screen at once and stop reading as patches at all — the ground just changes colour.
 */
export const GROUND_PATCH_SEGMENTS = 14

/** The band `verify:road` holds the delivered mean patch length inside. */
export const GROUND_PATCH_MIN_SEGMENTS = 5
export const GROUND_PATCH_MAX_SEGMENTS = 15

/** Deterministic hash of one integer to `0..1`. The lattice `groundNoise` interpolates between. */
function hash01(index: number): number {
  let h = Math.trunc(index) | 0

  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)

  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * One octave of value noise along the track, in `0..1`.
 *
 * Smoothstep between lattice points rather than linear: a linear interpolation has a corner at
 * every lattice point, and a corner in the value is an extra shade boundary wherever it happens
 * to sit near one — i.e. more of exactly the slivers `GROUND_PATCH_SEGMENTS` was tuned against.
 *
 * **One octave, and the single octave is what does the weighting.** Interpolating between two
 * uniform draws does not give a uniform result: it concentrates towards the middle of the range,
 * so mapping it evenly onto the five shades delivers roughly **15/24/24/22/15 percent** of the
 * ground rather than a flat fifth each. That is the wanted distribution and it comes free — the
 * middle three shades carry the ground and the two ends of `GROUND_SHADE_SPREAD`, which are the
 * colours furthest from the biome's own, are the occasional patch.
 *
 * **⚠ An explicit weights table was tried first and removed.** Mapping the noise through a
 * cumulative `[1,3,4,3,1]` looked like it stated the intent, and it does not deliver it: the
 * noise is already non-uniform, so the two distributions compound and shade 0 came out at 1827
 * of 40000 segments against the 3333 the table claimed. A weights table that does not produce
 * its own weights is worse than no table, because the next person reads it and believes it.
 */
function groundNoise(index: number): number {
  const x = index / GROUND_PATCH_SEGMENTS
  const cell = Math.floor(x)
  const t = x - cell
  const eased = t * t * (3 - 2 * t)

  return hash01(cell) + (hash01(cell + 1) - hash01(cell)) * eased
}

/**
 * How many palette columns the road surface itself occupies.
 *
 * **⚠ The asphalt had two shades and they alternated on the rumble rhythm, which is a beat rather
 * than a texture.** With the ownerless decals switched off (see `DECAL_DENSITY`) the road would
 * have been left as two flat colours in a regular stripe — and the reason those decals had to go
 * is that surface texture must be the *colour of the surface* rather than something laid over it,
 * or it cannot be told apart from a shadow. That argument applies to the road exactly as it
 * applies to the verge, so the road gets the same treatment the verge already has.
 */
export const ROAD_SHADES_PER_THEME = 5

/**
 * The `ROAD_SHADES_PER_THEME` colours the asphalt is drawn in, under one theme.
 *
 * **Spread by `GROUND_SHADE_SPREAD`, the same table the verge uses**, so the two surfaces are worn
 * by the same amount and read as one world rather than as two materials that happen to meet. No
 * separation push here, unlike `groundShadesForTheme`: this *is* the road, and there is nothing
 * for it to clear.
 *
 * Centred on the pair rather than anchored to one end, which the verge could not do because its
 * far end would walk across the asphalt's own brightness. Here there is no such edge to cross, and
 * centring keeps the mean where the theme authored it.
 */
export function roadShadesForTheme(dark: number, light: number): number[] {
  const base = mixColour(dark, light, 0.5)

  return GROUND_SHADE_SPREAD.map((offset) => shiftLightnessAndChroma(base, offset.lightness, offset.chroma))
}

/**
 * Which of the road's shades a segment is drawn in.
 *
 * **Offset from the verge's own draw on purpose.** Both surfaces read the same noise, and reading
 * it at the same coordinate would change them together at every patch boundary — one band across
 * the whole width of the frame, which is a stripe with extra steps and precisely what the
 * alternation was replaced to avoid. Half a patch out of step is enough that the two boundaries
 * never coincide.
 */
export function roadShadeFor(index: number): number {
  return groundShadeFor(index + Math.round(GROUND_PATCH_SEGMENTS / 2))
}

/**
 * Which of a biome's shades a segment is drawn in — deterministic, from the index alone.
 *
 * **⚠ Deliberately NOT the rumble alternation, and deliberately not a bare hash either.** The
 * stripes are a rhythm and have to stay one: a regular light/dark beat across the ground is what
 * read as a moiré over the whole picture and is why `GROUND_ALTERNATION` is 0. But a per-segment
 * hash is the opposite failure and just as wrong — it gives every segment an independent shade,
 * and at this projection a one-segment patch is a horizontal band across the verge. It was built
 * that way first and photographed, and the ripple is exactly what the frame showed.
 *
 * So the shade comes from a noise octave along the track: neighbouring segments read nearly the
 * same value and therefore usually land on the same shade, which is what makes a patch.
 *
 * A hash-backed lattice rather than an RNG stream, for the reason `decorVariation` gives: a
 * seeded stream has to be walked in order to reach its nth value, and what is wanted here is an
 * answer for one coordinate, computable in any order, the same on the next lap and at every
 * viewport size.
 */
export function groundShadeFor(index: number): number {
  return Math.min(GROUND_SHADES_PER_BIOME - 1, Math.floor(groundNoise(index) * GROUND_SHADES_PER_BIOME))
}


/** One biome: what its ground looks like and what stands on it. */
export interface Biome {
  id: string
  /** Alternating ground pair, dark then light. Blended toward the theme's fog by distance. */
  ground: readonly [number, number]
  /**
   * Decor keys this biome may place, **in order of how common they should be**: the decorator
   * picks uniformly, so a prop listed twice appears twice as often. That is a cheaper knob than
   * per-prop weights and it keeps the data readable.
   */
  props: readonly string[]
  /**
   * What colour this biome's props are, before the theme says what light falls on them.
   *
   * **⚠ Without this the props had no colour at all, and the game shipped that way.** The build
   * desaturates decor by 50% on purpose (`build-sprites.py`'s `DESATURATE`) so that a multiply tint
   * has authority over it — and the only tint applied was the *theme*'s, whose default (`day`) is
   * `0xffffff`, i.e. no tint. So on the default theme every prop drew at half saturation and
   * untinted: black outlines over a pale grey fill, on a bright ground. Reported as "the trees have
   * a white background", which is what it looks like; the mattes were in fact clean, measured at
   * 0.00-0.99% edge-connected plate across all 54 sprites.
   *
   * The ground has always carried the biome's colour and the props never did. This is the missing
   * half: `biome.decorTint * theme.decorTint` is what reaches the sprite, so a forest is green on
   * every theme while the theme still says whether it is noon or moonlight.
   *
   * **Authored light on purpose.** A tint multiplies, and it multiplies again by the theme's — two
   * dark factors crush the prop to a silhouette. `verify:road` sweeps all 8x7 products for both the
   * threat reservation and a luminance floor; the darkest today is `night` x `forest` at 0.110.
   */
  decorTint: number
  /**
   * Which ground marks this stretch may carry, in order of how common they should be — the same
   * "listed twice appears twice as often" knob `props` uses, and readable in the data.
   *
   * **A puddle in the dunes is the same failure a palm tree on a glacier is.** The four original
   * marks were surface marks and could go anywhere because the field never left the asphalt; it
   * reaches across the verge now, so what is on the ground has to be something this ground could
   * plausibly have. Strings rather than the `DecalKind` union, because `decals.ts` imports this
   * file to answer the per-segment question and a type import back the other way is a cycle.
   */
  decals: readonly string[]
}


/**
 * Every biome, in the order a run passes through them.
 *
 * **These are authored at a visible brightness and dimmed per theme, not authored dark.** The
 * road must stay the brightest surface in the lower frame — it is the thing the player is flying
 * along, and verges that out-read it pull the eye off the centre. The first version enforced
 * that by making the ground darker than the *darkest* theme's asphalt, which is `signal`'s
 * deliberately near-black road: one intentionally monochrome theme dragged every biome in the
 * game down to a luminance of 0.006, where the ground was technically present and practically
 * invisible. `groundForTheme` now scales each pair against **its own theme's** road, so the
 * invariant holds per theme by construction and a biome can be authored at a brightness someone
 * can actually see. `verify:road` holds the scaled result, not the raw one.
 */
export const BIOMES: readonly Biome[] = [
  {
    id: 'forest',
    ground: [0x2f6b3a, 0x33723e],
    props: ['decor-for_pine', 'decor-for_pine', 'decor-for_birch', 'decor-for_fern', 'decor-for_fern', 'decor-for_mushroom', 'decor-for_bramble', 'decor-for_boulder'],
    /** leaf green -- the only biome whose props are mostly foliage. */
    decorTint: 0x8fc98a,
    decals: ['tuft', 'tuft', 'scatter', 'stain', 'stones', 'puddle'],
  },
  {
    id: 'dunes',
    ground: [0xb99a5e, 0xc1a365],
    props: ['decor-dune_rock', 'decor-dune_grass', 'decor-dune_grass', 'decor-dune_cactus', 'decor-dune_bone', 'decor-dune_shrub', 'decor-dune_shrub', 'decor-dune_spire'],
    /** dry sand, the warmest of the eight. */
    decorTint: 0xe8c68a,
    decals: ['scatter', 'scatter', 'stones', 'stain', 'crack'],
  },
  {
    id: 'wetland',
    // **⚠ Repainted from a teal `0x2c6a5e`, which sat 30 degrees from the sky's own hue at 55%
    // saturation** -- a saturated turquoise field competing with the air above it. See
    // `MIN_GROUND_SKY_HUE_GAP`. Moved by HUE ALONE, at equal **relative luminance** -- a biome is
    // recognised by its colour and separated from the road by its lightness, and those are two
    // different jobs. **⚠ Matching HSL's own lightness is not the same thing and does not work**:
    // a violet at L=29% is far darker than a teal at L=29%, and the first pass at this repaint put
    // `fungal` under the visibility floor on `night`. Solved against `relativeLuminance` instead.
    ground: [0x3f6b34, 0x437138],
    // **`decor-wet_log` is pulled and gone: no key, no PNG.** The Kenney model (`log_large`) is
    // hollow and the render squares the bore off into a dark rectangle in the end face, so at the
    // size a verge prop is read the object is a brown box with a black doorway in it. Every
    // hollow-log render in this project has now been rejected the same way — see `PULLED_ART` in
    // `src/run/obstacleArt.ts`, which is where the third one is written up.
    props: ['decor-wet_reeds', 'decor-wet_reeds', 'decor-wet_stump', 'decor-wet_lily', 'decor-wet_willow', 'decor-wet_cattail', 'decor-wet_cattail'],
    /** green water rather than green leaf: cooler and less saturated than forest. */
    decorTint: 0x8fd0bc,
    decals: ['puddle', 'puddle', 'tuft', 'stain', 'scatter'],
  },
  {
    id: 'ridge',
    ground: [0x5a6270, 0x616977],
    props: ['decor-rid_scree', 'decor-rid_scree', 'decor-rid_monolith', 'decor-rid_arch', 'decor-rid_cairn', 'decor-rid_lichen', 'decor-rid_snag', 'decor-rid_snag'],
    /** cold stone. Barely a hue at all, which is the point -- rock reads by light. */
    decorTint: 0xb8c4d2,
    decals: ['stones', 'stones', 'scatter', 'crack', 'stain'],
  },
  {
    id: 'ashen',
    ground: [0x54494a, 0x5b4f50],
    // `decor-ash_mound` was pulled here for a round, because the art shipped for it was a flying
    // saucer and it was the biome's most common prop. It is back: the glossy regeneration
    // re-briefed it as a low dome and negated `flying saucer, ufo, spaceship` by name, which is
    // what the slot's own note in `snail_prompts.py` records.
    props: ['decor-ash_stump', 'decor-ash_mound', 'decor-ash_slab', 'decor-ash_spar', 'decor-ash_vent', 'decor-ash_scrub', 'decor-ash_scrub', 'decor-ash_slab'],
    /** warm dead grey, lifted so `night` does not crush it past visibility. */
    decorTint: 0xc2bdb5,
    decals: ['crack', 'crack', 'stain', 'scatter', 'stones'],
  },
  {
    // The ninth. Ground is a deep sea-green rather than another blue or another green: `forest` and
    // `wetland` own the green end and `crystal` the violet, and a biome that reads as one of those
    // at a glance is a biome the player has already been to.
    id: 'fungal',
    // Repainted from the same teal `wetland` carried, and for the same reason. Sent to violet
    // rather than to green so a spore forest still reads as one and does not become a second
    // wetland -- the props' own tint is already the cool green of spore light.
    //
    // **⚠ And then taken down from 49% saturation to 26%, which the first pass got wrong.** The
    // teal's own saturation was carried over with the hue, and `PALETTE_SATURATION.ground` then
    // multiplies it by 1.5: on screen it came out as a magenta ribbon laid across the frame,
    // visible from the biome before it. That is the reported defect again in a different hue --
    // a large flat field cannot carry the saturation a prop can.
    ground: [0x725876, 0x795c7d],
    props: ['decor-fun_tall', 'decor-fun_dome', 'decor-fun_dome', 'decor-fun_cluster', 'decor-fun_cluster', 'decor-fun_pair', 'decor-fun_wide'],
    /** Pale mint. Light on purpose — the product of a biome tint and a theme tint is what actually
     *  lands on a prop, and two dark factors crush it to a silhouette; `verify:road` holds every
     *  one of the 9x7 products above a luminance floor and out of the reserved threat band. */
    decorTint: 0xa6dcc6,
    decals: ['tuft', 'puddle', 'stain', 'scatter', 'stones'],
  },
  {
    id: 'crystal',
    // Repainted from `0x6165ad`: 38 degrees from the sky at 31% saturation, which is inside the
    // air's family for a ground that bright. Pushed round to violet, keeping its lightness -- it
    // is still the palest ground in the game after `coast`, which is what a crystal field is.
    ground: [0x7c6096, 0x84669d],
    // Six now. `cry_shard` was rejected once for pointing downwards, which a bottom-anchored
    // billboard cannot use; the regeneration re-briefed it as a spike growing UP from a rock base
    // and negates `pointing down, hanging, stalactite, icicle` by name. Listed twice each where a
    // prop is meant to be common, same weighting convention as every other biome.
    props: ['decor-cry_cluster', 'decor-cry_cluster', 'decor-cry_geode', 'decor-cry_bloom', 'decor-cry_pillar', 'decor-cry_shard', 'decor-cry_slab'],
    /** blue-violet, **not** red-violet: at `0xc0a8e0` the product with `dusk` was
     *     `#a36f65`, inside the reserved threat band. The first thing the new sweep rejected. */
    decorTint: 0xaeb2ec,
    decals: ['stones', 'scatter', 'crack', 'stain'],
  },
  {
    id: 'coast',
    // The brightest ground in the game — pale sand over a green-blue wash. It is authored bright
    // and dimmed per theme by `groundPairForTheme` like every other pair, so "brightest" is a
    // relationship to its own theme's asphalt rather than an absolute that a dark theme breaks.
    ground: [0xc9b483, 0xd1bd8d],
    // Five props, not six, and the missing one is a deliberate omission rather than a pending
    // render. **`coa_drift` is pulled again**, and not for the cartoon bone it first shipped as:
    // the re-render is the hollow log, kept once on the reasoning that a hexagonal bore reads as a
    // log where a square one does not. A player pointed at it. The bore's shape is not what fails. **`coa_shell` is not, and will not be:** a large glossy
    // spiral shell is the mascot's own silhouette, and at the 20-60px a verge prop is read at,
    // scattering snail shells along the roadside makes the player search for the one object this
    // whole art direction exists to keep them from searching for. The render is fine; the subject
    // is wrong for this game. See "The Regeneration: A Glossy World" in CLAUDE.md.
    props: ['decor-coa_stack', 'decor-coa_stack', 'decor-coa_kelp', 'decor-coa_palm', 'decor-coa_reef', 'decor-coa_reef'],
    /** pale sea light. */
    decorTint: 0xa4cfe8,
    decals: ['scatter', 'scatter', 'puddle', 'stones', 'stain'],
  },
  {
    id: 'ruins',
    // Cool grey stone, and the darkest of the eight: it is the one biome whose props are pale, so
    // the ground has to give them something to stand against.
    ground: [0x5b5f63, 0x62666a],
    props: ['decor-rui_rubble', 'decor-rui_rubble', 'decor-rui_column', 'decor-rui_wall', 'decor-rui_arch', 'decor-rui_statue', 'decor-rui_obelisk'],
    /** weathered warm stone, a shade browner than `dunes`. */
    decorTint: 0xdcc9a6,
    decals: ['crack', 'crack', 'stones', 'scatter', 'stain', 'skid'],
  },
] as const

/**
 * A biome's ground pair as it should appear under a given theme.
 *
 * **The rule is separation, not darkness, and that is a correction of a real defect.** This used
 * to dim every pair until the brighter shade sat below the theme's asphalt, on the reasoning that
 * the road must be the brightest surface in the lower frame. Measured on the shipped palettes,
 * what that actually produced was: asphalt at a luminance of 0.014–0.020 and **every one of the
 * 48 biome/theme grounds crushed to 0.007–0.008**, i.e. under one percent — the verges rendered
 * black, and a screenshot of the game is a road floating in a void. The rule was satisfied, and
 * satisfying it was the bug.
 *
 * The property the road actually needs is that its **edge reads**, which is a question of
 * contrast, not of rank. Grass beside a grey road is brighter than the road in life and in every
 * cartoon; what must never happen is grass the same brightness as asphalt, because then the edge
 * of the road disappears. So the pair is pushed *away* from the asphalt — up if it is already
 * lighter, down if it is already darker — until it clears `MIN_GROUND_CONTRAST`, and is otherwise
 * left exactly as authored.
 *
 * Pure and exported so `verify:road` can assert the rule on the value that actually reaches the
 * palette rather than on the authored constant, which never does.
 */
export function groundPairForTheme(
  ground: readonly [number, number],
  roadDark: number,
  roadLight: number,
  minContrast = MIN_GROUND_CONTRAST,
  groundLight = 1,
  alternation = GROUND_ALTERNATION,
): [number, number] {
  const channel = (value: number) => {
    const c = value / 255

    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const luminance = (colour: number) =>
    0.2126 * channel((colour >> 16) & 0xff) +
    0.7152 * channel((colour >> 8) & 0xff) +
    0.0722 * channel(colour & 0xff)
  // **Every channel is clamped to 255, and that is not defensive padding.** The factor may now be
  // greater than one — the rule brightens as well as darkens — and an unclamped `220 * 1.4` is
  // 308, which shifted left by 16 does not saturate, it *carries into the channel above*. The
  // symptom is a ground that comes back a completely unrelated colour at exactly the brightness
  // of the road it was supposed to separate from, which is how this was found.
  const clamp8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
  const scaled = (colour: number, k: number) =>
    (clamp8(((colour >> 16) & 0xff) * k) << 16) |
    (clamp8(((colour >> 8) & 0xff) * k) << 8) |
    clamp8((colour & 0xff) * k)

  // **The theme's light level is applied first, and the separation rule then runs on the result.**
  // Order matters and only this order is correct: dimming after the push would walk the ground
  // straight back into the asphalt it was just separated from, and the road's edge would stop
  // reading on exactly the dark themes that need it most.
  // **The alternation is collapsed here, before anything else looks at the pair**, so every rule
  // below — the separation push, the contrast measurement, what `verify:road` asserts — runs on
  // the two colours that will actually be drawn rather than on an authored intent that no longer
  // reaches the screen. See `GROUND_ALTERNATION`.
  const alternated: readonly [number, number] = [
    ground[0],
    mixColour(ground[0], ground[1], alternation),
  ]
  const lit: readonly [number, number] =
    groundLight === 1
      ? alternated
      : [scaled(alternated[0], groundLight), scaled(alternated[1], groundLight)]

  // The road's own two shades, as one number to clear: the ground has to separate from whichever
  // of them it is nearest, or it merges with the road on half the rumble cycle.
  const roadLo = Math.min(luminance(roadDark), luminance(roadLight))
  const roadHi = Math.max(luminance(roadDark), luminance(roadLight))
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

  // Measured against the *nearer* shade of the pair, since that is the one that merges first.
  const nearest = (value: number) => (contrast(value, roadLo) < contrast(value, roadHi) ? roadLo : roadHi)
  const worst = () => {
    const a = luminance(lit[0])
    const b = luminance(lit[1])

    return Math.min(contrast(a, nearest(a)), contrast(b, nearest(b)))
  }

  if (worst() >= minContrast) return [lit[0], lit[1]]

  // **Pushed away from the road, in whichever direction it already leans, and as one factor for
  // the pair.** Scaling each shade independently is the obvious version and it destroys the thing
  // the pair exists for: both converge on the same value, the alternation dies, and a flat expanse
  // beside the road reads as motionless however fast the camera moves.
  //
  // The direction is decided once, from the brighter shade: a ground lighter than the asphalt gets
  // lighter, a darker one gets darker. Deciding per shade could split a pair across the road's own
  // brightness, which is the one arrangement guaranteed to make one of the two invisible.
  const brighten = Math.max(luminance(lit[0]), luminance(lit[1])) >= roadHi

  // Binary search rather than a closed form: the sRGB transfer curve is not linear, and a linear
  // approximation is worst exactly at the dark end these colours used to live in.
  let low = brighten ? 1 : 0
  let high = brighten ? 4 : 1

  for (let i = 0; i < 28; i++) {
    const mid = (low + high) / 2
    const a = luminance(scaled(lit[0], mid))
    const b = luminance(scaled(lit[1], mid))
    const ok = Math.min(contrast(a, nearest(a)), contrast(b, nearest(b))) >= minContrast

    if (brighten) {
      if (ok) high = mid
      else low = mid
    } else if (ok) {
      low = mid
    } else {
      high = mid
    }
  }

  const factor = brighten ? high : low

  return [scaled(lit[0], factor), scaled(lit[1], factor)]
}

/** Straight per-channel blend from `a` to `b`. `t` of 0 gives `a`, 1 gives `b`. */
function mixColour(a: number, b: number, t: number): number {
  const channel = (colour: number, shift: number) => (colour >> shift) & 0xff
  const blend = (shift: number) => Math.round(channel(a, shift) + (channel(b, shift) - channel(a, shift)) * t)

  return (blend(16) << 16) | (blend(8) << 8) | blend(0)
}

/** Every biome id, in `BIOMES` order. */
export const BIOME_IDS: readonly string[] = BIOMES.map((biome) => biome.id)

/** The biome a segment belongs to when nothing has assigned one. */
export const DEFAULT_BIOME = BIOMES[0].id

/** Looks a biome up by id, falling back to the default rather than returning undefined. */
export function biomeById(id: string): Biome {
  return BIOMES.find((biome) => biome.id === id) ?? BIOMES[0]
}

/** Index of a biome in `BIOMES`, which is what the palette column is derived from. */
export function biomeIndex(id: string): number {
  const index = BIOMES.findIndex((biome) => biome.id === id)

  return index < 0 ? 0 : index
}

/**
 * How long a biome runs for before the next one starts, in segments.
 *
 * **Set against the *readable* band, not `DRAW_DISTANCE`.** The obvious reasoning — "a biome must
 * outlast the draw distance or every frame is a border" — picks 300+ and is wrong, because the
 * draw distance is what the renderer *considers*, not what the player can see. A prop at 80
 * segments is already only ~25px tall and one at 300 is a few pixels; the band that actually
 * reads as a place is roughly the nearest 150–200 segments.
 *
 * The second number that matters is the track: the shipped one is 1434 segments, so the run length
 * has to be about `1434 / BIOMES.length` or a lap does not reach them all. At the 420 this was
 * first written as, a lap reached four of six and two biomes existed only in theory.
 *
 * **179, down from the 240 that fitted six.** Adding `coast` and `ruins` made 240 reach six of
 * eight — caught by `verify:road`, which is the check that exists for exactly this and has now
 * failed twice for the same reason. Worth noting that the new value is *better* justified than the
 * old one rather than a grudging squeeze: 240 sat above the 150-200 band this docstring identifies
 * as what reads as a place, and 179 sits inside it. `1434 / 179 = 8.01`.
 *
 * **⚠ It used to be a hand-set constant, and it had already been wrong twice** ${EM} 420 when six
 * biomes shipped (a lap reached four of them and two existed only in the data), then 240 when eight
 * did (six of eight). Both were caught by the same check, both were fixed by hand, and its own
 * docstring said "this does not scale, and the next biome is where it stops".
 *
 * So it is now **derived from the lap it has to divide**, which is what it always meant: the run
 * length is the track over the number of biomes. Two things follow, and both are the point ${EM} adding
 * a biome moves it by itself, and the number can no longer disagree with the count it is supposed to
 * be derived from. On the shipped 1434-segment lap with eight biomes it computes **179**, i.e. bit
 * for bit the value that was arrived at by hand, which is the best evidence available that this is
 * the right derivation rather than a convenient one.
 *
 * **What does not scale is the floor, and that is now a live constraint rather than a note.** Below
 * `MIN_BIOME_RUN_SEGMENTS` a biome stops being a place and becomes a strip of differently coloured
 * verge; nine biomes on the shipped lap give 159 and ten give 143, so the tenth is where
 * `verify:road` fails ${EM} and it fails pointing at the track's own length, which is the lever the
 * old docstring named.
 */
export const MIN_BIOME_RUN_SEGMENTS = 150

export function biomeRunSegments(trackLength: number, biomeCount: number = BIOMES.length): number {
  const count = Math.max(1, Math.trunc(biomeCount))

  return Math.max(1, Math.floor(Math.max(0, trackLength) / count))
}

/**
 * Which biome a segment falls in, from its index alone.
 *
 * Derived rather than stored per segment so it costs nothing to ask and cannot drift out of sync
 * with itself. It wraps with the track, and **the track's segment count is not usually a multiple
 * of `BIOME_RUN_SEGMENTS`**, so the last stretch before the loop point is short and the seam puts
 * two different biomes next to each other. That is fine — a biome change is a legal event
 * anywhere — but it does mean the seam is not special-cased, and a build that ever needs it to be
 * should say so out loud rather than assuming it already is.
 */
/**
 * How biomes are laid along the track.
 *
 * `'cycle'` is the endless circuit: all eight in sequence, `BIOME_RUN_SEGMENTS` each. A level pins
 * one for its whole track instead — which is the entire mechanism behind "a level is a place", and
 * it is one module-level value rather than a parameter threaded through three call sites.
 *
 * **There are exactly three consumers and they must never disagree**: the mesh picks the ground
 * colour by biome, the sprite pool picks the decor tint by biome, and the decorator picks which
 * props may stand there. A layout passed to one and not another gives a forest floor under desert
 * scrub. They all read `biomeIndexForSegment`, so this is the one place it is decided.
 */
export type BiomeLayout = { readonly kind: 'cycle' } | { readonly kind: 'single'; readonly index: number }

let biomeLayout: BiomeLayout = { kind: 'cycle' }

/**
 * Sets the layout. Called once when a world is built, before anything draws.
 *
 * Module-level for the same reason `setRoadTheme` is: everything that needs the answer is deep
 * inside a render loop that has no business being handed a level id, and the alternative is the
 * same value copied onto three objects that can then drift.
 */
export function setBiomeLayout(next: BiomeLayout): void {
  biomeLayout = next.kind === 'single' ? { kind: 'single', index: clampBiomeIndex(next.index) } : next
}

export function getBiomeLayout(): BiomeLayout {
  return biomeLayout
}

/** Wraps into range rather than throwing: a level id from a save is data, and data can be wrong. */
function clampBiomeIndex(index: number): number {
  if (!Number.isFinite(index)) return 0

  return ((Math.trunc(index) % BIOMES.length) + BIOMES.length) % BIOMES.length
}

export function biomeForSegment(index: number, trackLength: number): Biome {
  return BIOMES[biomeIndexForSegment(index, trackLength)]
}

/**
 * The same lookup as `biomeForSegment`, as an index.
 *
 * The renderer keeps a parallel array of per-biome tints and wants to address it directly; asking
 * for the record and then `indexOf`-ing it back would put a linear scan inside the draw loop, once
 * per drawn sprite. Both functions share this one piece of arithmetic so they cannot disagree.
 */
export function biomeIndexForSegment(index: number, trackLength: number): number {
  if (biomeLayout.kind === 'single') return biomeLayout.index
  if (!(trackLength > 0)) return 0

  const wrapped = ((index % trackLength) + trackLength) % trackLength

  // `% BIOMES.length` still matters after the derivation: `floor(trackLength / count) * count` is
  // at most `trackLength`, so the last few segments of a lap that does not divide evenly land one
  // index past the end. They wrap onto biome 0 ${EM} which is the biome the lap *starts* with, so the
  // seam is now a longer first stretch rather than a boundary between two different places.
  return Math.floor(wrapped / biomeRunSegments(trackLength)) % BIOMES.length
}

/**
 * Over how many segments the skyline crossfades from one biome's steer to the next.
 *
 * **The strip has no `z`, and that is the whole reason this number exists.** Everything else the
 * biome colours — the ground, the props, the decals — is addressed per segment, so a boundary
 * arrives as a line sweeping up the frame and the change is spread across the second or two it
 * takes to pass. A `TileSprite` is one object with one tint: whatever it is handed lands on the
 * full width of the screen in a single frame. A hard step there does not read as a new place, it
 * reads as the renderer having dropped a texture.
 *
 * 64 segments is 3.6s at `SPEED_CAP` and 8.9s at `SPEED_BASE`, against a biome run of 179 — so a
 * third of a run is spent in transition and two thirds sit on the biome's own steer. Centred on
 * the seam rather than trailing it, so the horizon is half-changed at the moment the ground under
 * the player changes and neither half of the move is a surprise.
 */
export const SKYLINE_SEAM_BLEND_SEGMENTS = 64

/** Hermite ease. Zero derivative at both ends, so the window opens and closes without a corner. */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t))

  return x * x * (3 - 2 * x)
}

/**
 * The biome steer the skyline is drawn with at a given segment — crossfaded across the seam.
 *
 * **This is deliberately NOT `biomeForSegment(...).decorTint`, and the difference is the bug it
 * was written for.** That lookup is a hard step, which is correct for anything with a distance:
 * the segment carries its own `z`, so the step happens at one place on the road and sweeps up the
 * frame. The range has no distance at all — see `SKYLINE_SEAM_BLEND_SEGMENTS`.
 *
 * **⚠ The seam is FOUND, not computed from `biomeRunSegments`, and the first version got that
 * wrong.** A lap that does not divide evenly ends in a short stub which wraps onto biome 0 — the
 * biome the lap starts with — so run arithmetic reports a boundary at segment 0 where the ground
 * does not actually change. On the shipped 1434-segment circuit that put a **5-level jump into
 * the delivered tint at segment 1433**, i.e. exactly the whole-width step this function exists to
 * remove, at the one place nobody would look for it. `verify:road` caught it on its first run.
 *
 * So both neighbours are found by walking outward through `biomeIndexForSegment` itself: whatever
 * that says is a boundary is a boundary, and this cannot disagree with the ground for any layout,
 * any lap length or any remainder. The walk is bounded by half the window and runs once a frame,
 * not once a sprite. A pinned (`'single'`) layout falls out for free — every lookup returns the
 * same biome, both walks run to their limit, and the crossfade never engages.
 */
export function skylineBiomeTint(index: number, trackLength: number): number {
  const here = biomeIndexForSegment(index, trackLength)
  const own = BIOMES[here].decorTint

  if (!(trackLength > 0)) return own

  const window = Math.max(2, SKYLINE_SEAM_BLEND_SEGMENTS)
  const half = Math.floor(window / 2)

  // Leaving a seam behind: the second half of a move that began `half` segments before it. The
  // half-segment offset is what makes the two branches meet either side of the boundary rather
  // than both landing on it, so the crossfade is exactly half done as the ground changes.
  let back = 0

  while (back < half && biomeIndexForSegment(index - back - 1, trackLength) === here) back += 1

  if (back < half) {
    const previous = BIOMES[biomeIndexForSegment(index - back - 1, trackLength)]

    return mixColour(previous.decorTint, own, smoothstep(0.5 + (back + 0.5) / window))
  }

  // Approaching the next one: the first half of the same move.
  let ahead = 0

  while (ahead < half && biomeIndexForSegment(index + ahead + 1, trackLength) === here) ahead += 1

  if (ahead < half) {
    const next = BIOMES[biomeIndexForSegment(index + ahead + 1, trackLength)]

    return mixColour(own, next.decorTint, smoothstep(0.5 - (ahead + 0.5) / window))
  }

  return own
}
