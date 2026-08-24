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
 * The ground colours come in pairs for the same reason the road's do: they alternate on the
 * `RUMBLE_LENGTH` rhythm, which is what stops a flat expanse from reading as motionless.
 */

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
  },
  {
    id: 'dunes',
    ground: [0xb99a5e, 0xc1a365],
    props: ['decor-dune_rock', 'decor-dune_grass', 'decor-dune_grass', 'decor-dune_cactus', 'decor-dune_bone', 'decor-dune_shrub', 'decor-dune_shrub', 'decor-dune_spire'],
    /** dry sand, the warmest of the eight. */
    decorTint: 0xe8c68a,
  },
  {
    id: 'wetland',
    ground: [0x2c6a5e, 0x307163],
    props: ['decor-wet_reeds', 'decor-wet_reeds', 'decor-wet_stump', 'decor-wet_lily', 'decor-wet_willow', 'decor-wet_log', 'decor-wet_cattail', 'decor-wet_cattail'],
    /** green water rather than green leaf: cooler and less saturated than forest. */
    decorTint: 0x8fd0bc,
  },
  {
    id: 'ridge',
    ground: [0x5a6270, 0x616977],
    props: ['decor-rid_scree', 'decor-rid_scree', 'decor-rid_monolith', 'decor-rid_arch', 'decor-rid_cairn', 'decor-rid_lichen', 'decor-rid_snag', 'decor-rid_snag'],
    /** cold stone. Barely a hue at all, which is the point -- rock reads by light. */
    decorTint: 0xb8c4d2,
  },
  {
    id: 'ashen',
    ground: [0x54494a, 0x5b4f50],
    // `decor-ash_mound` was here twice — the most common prop in the biome — and the art shipped
    // for it was a flying saucer. Pulled until it is re-rendered; its two slots go to the two
    // props that already carry the biome's silhouette.
    props: ['decor-ash_stump', 'decor-ash_stump', 'decor-ash_slab', 'decor-ash_spar', 'decor-ash_vent', 'decor-ash_scrub', 'decor-ash_scrub', 'decor-ash_slab'],
    /** warm dead grey, lifted so `night` does not crush it past visibility. */
    decorTint: 0xc2bdb5,
  },
  {
    // The ninth. Ground is a deep sea-green rather than another blue or another green: `forest` and
    // `wetland` own the green end and `crystal` the violet, and a biome that reads as one of those
    // at a glance is a biome the player has already been to.
    id: 'fungal',
    ground: [0x2c6a5f, 0x307064],
    props: ['decor-fun_tall', 'decor-fun_dome', 'decor-fun_dome', 'decor-fun_cluster', 'decor-fun_cluster', 'decor-fun_pair', 'decor-fun_wide'],
    /** Pale mint. Light on purpose — the product of a biome tint and a theme tint is what actually
     *  lands on a prop, and two dark factors crush it to a silhouette; `verify:road` holds every
     *  one of the 9x7 products above a luminance floor and out of the reserved threat band. */
    decorTint: 0xa6dcc6,
  },
  {
    id: 'crystal',
    ground: [0x6165ad, 0x696cb1],
    // Five props, not six: `cry_shard` was rejected for pointing downwards, which a
    // bottom-anchored billboard cannot use. Listed twice each where a prop is meant to be
    // common, same weighting convention as every other biome.
    props: ['decor-cry_cluster', 'decor-cry_cluster', 'decor-cry_geode', 'decor-cry_bloom', 'decor-cry_pillar', 'decor-cry_slab', 'decor-cry_slab'],
    /** blue-violet, **not** red-violet: at `0xc0a8e0` the product with `dusk` was
     *     `#a36f65`, inside the reserved threat band. The first thing the new sweep rejected. */
    decorTint: 0xaeb2ec,
  },
  {
    id: 'coast',
    // The brightest ground in the game — pale sand over a green-blue wash. It is authored bright
    // and dimmed per theme by `groundPairForTheme` like every other pair, so "brightest" is a
    // relationship to its own theme's asphalt rather than an absolute that a dark theme breaks.
    ground: [0xc9b483, 0xd1bd8d],
    // Four props, not six: `coa_drift` and `coa_shell` are being re-rendered — see
    // `decorShapes.ts`. Each is listed twice so the density matches its neighbours; a biome with
    // fewer distinct shapes must not also be a biome with less scenery, or the stretch reads as
    // empty rather than as different.
    props: ['decor-coa_stack', 'decor-coa_stack', 'decor-coa_kelp', 'decor-coa_kelp', 'decor-coa_palm', 'decor-coa_reef', 'decor-coa_reef'],
    /** pale sea light. */
    decorTint: 0xa4cfe8,
  },
  {
    id: 'ruins',
    // Cool grey stone, and the darkest of the eight: it is the one biome whose props are pale, so
    // the ground has to give them something to stand against.
    ground: [0x5b5f63, 0x62666a],
    props: ['decor-rui_rubble', 'decor-rui_rubble', 'decor-rui_column', 'decor-rui_wall', 'decor-rui_arch', 'decor-rui_statue', 'decor-rui_obelisk'],
    /** weathered warm stone, a shade browner than `dunes`. */
    decorTint: 0xdcc9a6,
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
