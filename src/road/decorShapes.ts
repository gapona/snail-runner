/**
 * Scenery data: which pieces exist, how big they are, and their outlines.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:road`. Split out of
 * `decor.ts` for exactly that reason: that file creates `CanvasTexture`s and so must import
 * Phaser, whose init code reads `window` and cannot run under Node. Same split as
 * `constants.ts` vs `palette.ts`.
 */

/** A scenery texture and the size `billboardRectInto` should project it at. */
export interface DecorTexture {
  key: string
  width: number
  height: number
}

/**
 * The scenery set: eight pieces — a conifer, a rock, a broad outcrop, a fern, three different
 * bushes, and a bare dead tree.
 *
 * **Three bushes rather than one** because bushes are what the roadside is mostly made of, and a
 * single one repeated is the fastest way to make a stretch of track read as a repeating tile.
 * They are deliberately different *classes* of shape — a solid mound, a spiky rosette, a
 * broadleaf clump — not three variations on a blob, because everything here is desaturated and
 * tinted at draw time and hue cannot be used to tell them apart.
 *
 * **These numbers are a *world* size, not a pixel size**, and the distinction became load-bearing
 * the moment real art arrived. They are world units divided by `SPRITE_SCALE` (10 world units
 * per unit here), so the spire is 870x1800 world units against a `CAMERA_HEIGHT` of 1000 and a
 * `ROAD_WIDTH` of 2000 — that is what `billboardRectInto` projects. The *texture* behind each
 * key is whatever resolution it happens to be, and nothing may assume the two agree; see
 * `RoadSprites.place`, whose crop rectangle has to be measured off the frame for exactly this
 * reason.
 *
 * **Each width is the drawn art's own aspect times the height**, recomputed whenever a pick
 * changes (`scripts/build-sprites.py` prints them). Keeping the pre-art numbers would have
 * squeezed the conifer to 0.22 of its height against the 0.49 it is drawn at — a distortion
 * that reads as a rendering fault rather than as a thin tree. The heights are unchanged from
 * the placeholder set, so nothing about how tall the scenery stands has moved.
 */
export const DECOR_TEXTURES: readonly DecorTexture[] = [

  // The biome sets. Each width is the shipped art's own aspect times a world height chosen for
  // what the thing is -- a pine stands 190 units tall, a lily pad 46 -- so scale reads as scale
  // rather than every prop being the same size in a different outline.
  { key: 'decor-dune_rock', width: 108, height: 70 },
  { key: 'decor-dune_grass', width: 38, height: 60 },
  { key: 'decor-dune_cactus', width: 66, height: 150 },
  { key: 'decor-dune_bone', width: 55, height: 55 },
  { key: 'decor-dune_shrub', width: 89, height: 64 },
  // **59, not 94.** The re-rendered spire is drawn at the 35:100 its own brief calls "the thinnest
  // slot in the set"; the old art was nearly twice as wide, which is part of what made it read as a
  // landscape rather than as a splinter of rock. Same rule as every other entry: the width is the
  // shipped art's own aspect times the height.
  { key: 'decor-dune_spire', width: 59, height: 170 },
  { key: 'decor-wet_reeds', width: 85, height: 130 },
  { key: 'decor-wet_stump', width: 78, height: 80 },
  { key: 'decor-wet_lily', width: 82, height: 46 },
  { key: 'decor-wet_willow', width: 93, height: 150 },
  { key: 'decor-wet_log', width: 104, height: 52 },
  { key: 'decor-wet_cattail', width: 78, height: 140 },
  { key: 'decor-for_pine', width: 128, height: 190 },
  { key: 'decor-for_birch', width: 115, height: 175 },
  { key: 'decor-for_fern', width: 82, height: 80 },
  { key: 'decor-for_mushroom', width: 81, height: 70 },
  { key: 'decor-for_bramble', width: 109, height: 66 },
  { key: 'decor-for_boulder', width: 93, height: 72 },
  { key: 'decor-rid_scree', width: 92, height: 50 },
  { key: 'decor-rid_monolith', width: 74, height: 185 },
  { key: 'decor-rid_arch', width: 187, height: 105 },
  { key: 'decor-rid_cairn', width: 65, height: 95 },
  { key: 'decor-rid_lichen', width: 70, height: 48 },
  { key: 'decor-rid_snag', width: 107, height: 165 },
  { key: 'decor-ash_stump', width: 88, height: 78 },
  { key: 'decor-ash_mound', width: 88, height: 56 },
  { key: 'decor-ash_spar', width: 104, height: 180 },
  { key: 'decor-ash_vent', width: 94, height: 54 },
  { key: 'decor-ash_scrub', width: 102, height: 70 },
  { key: 'decor-ash_slab', width: 106, height: 50 },

  // `crystal`, five props rather than six: `cry_shard` was rejected for pointing downwards.
  // Billboards here are anchored by the point where they meet the ground, so a shard drawn
  // hanging point-down would read as hovering, which no amount of resizing fixes.
  { key: 'decor-cry_geode', width: 80, height: 74 },
  { key: 'decor-cry_bloom', width: 96, height: 96 },
  { key: 'decor-cry_cluster', width: 91, height: 62 },
  { key: 'decor-cry_pillar', width: 71, height: 170 },
  { key: 'decor-cry_slab', width: 105, height: 52 },

  // `coast`, four props rather than six, for the same reason `crystal` has five: `coa_drift` came
  // back as a cartoon bone and `coa_shell` inside a drawn rectangular frame, and both are being
  // re-rendered rather than shipped. See `DECOR_PICKS` in `scripts/build-sprites.py`.
  { key: 'decor-coa_stack', width: 84, height: 150 },
  { key: 'decor-coa_kelp', width: 75, height: 130 },
  { key: 'decor-coa_palm', width: 128, height: 190 },
  { key: 'decor-coa_reef', width: 94, height: 60 },

  // `ruins`, the one biome made of things somebody built. Its two tallest props are the tallest
  // in the game (`rui_obelisk` at 200 against `for_pine`'s 190) on purpose: a skyline is what
  // makes a ruin read as a place rather than as scattered masonry.
  { key: 'decor-rui_column', width: 71, height: 175 },
  { key: 'decor-rui_arch', width: 175, height: 120 },
  { key: 'decor-rui_wall', width: 131, height: 80 },
  { key: 'decor-rui_statue', width: 108, height: 165 },
  { key: 'decor-rui_rubble', width: 112, height: 62 },
  { key: 'decor-rui_obelisk', width: 122, height: 200 },

  // `fungal`, the ninth biome and the first added after the table could take one. Its whole reason
  // to exist is silhouette room: the game desaturates every prop by half and multiplies it by a
  // tint, so hue is not information and the outline is the entire asset — and a heavy domed cap, a
  // bare spire and a cluster of spheres are shapes none of the other forty-four supply.
  { key: 'decor-fun_tall', width: 66, height: 114 },
  { key: 'decor-fun_dome', width: 112, height: 110 },
  { key: 'decor-fun_cluster', width: 111, height: 120 },
  { key: 'decor-fun_pair', width: 133, height: 74 },
  { key: 'decor-fun_wide', width: 122, height: 60 },
]

/** Every decor texture key, in `DECOR_TEXTURES` order. */
export const DECOR_KEYS: readonly string[] = DECOR_TEXTURES.map((texture) => texture.key)

export type Polygon = readonly (readonly [number, number])[]

/**
 * Outlines in `0..1` of each texture's own box, origin top-left. Kept as fractions rather than
 * pixels so a texture can be re-sized in `DECOR_TEXTURES` without redrawing its shape.
 *
 * **Only the original six are authored by hand.** The thirty biome props are shipped art, and a
 * hand-drawn polygon per slot would be thirty outlines that never render — `createDecorTextures`
 * skips any key a loaded texture already occupies. What they still need is *something* to draw
 * if their PNG ever fails to load, and `fallbackShapeFor` supplies it by proportion: a tall slot
 * borrows the conifer's outline, a squat one the boulder's. A missing texture then degrades to a
 * plausible silhouette rather than to a crash inside Phaser on `frame.realWidth`.
 */
export const DECOR_SHAPES: Record<string, Polygon> = {
  'decor-spire': [
    [0.5, 0],
    [0.78, 0.42],
    [0.66, 1],
    [0.34, 1],
    [0.2, 0.4],
  ],
  'decor-boulder': [
    [0.28, 0.12],
    [0.62, 0],
    [0.92, 0.34],
    [1, 0.78],
    [0.84, 1],
    [0.12, 1],
    [0, 0.6],
  ],
  'decor-ridge': [
    [0, 1],
    [0.14, 0.46],
    [0.32, 0.62],
    [0.5, 0.08],
    [0.66, 0.5],
    [0.82, 0.3],
    [1, 1],
  ],
  // A fan of five stiff blades from a narrow base — vertical, but without the spire's hard
  // taper, so a stretch of road reads as growing rather than as quarried.
  'decor-frond': [
    [0.46, 1],
    [0.42, 0.55],
    [0.12, 0.18],
    [0.3, 0.5],
    [0.28, 0.1],
    [0.44, 0.42],
    [0.5, 0],
    [0.56, 0.42],
    [0.72, 0.1],
    [0.7, 0.5],
    [0.88, 0.18],
    [0.58, 0.55],
    [0.54, 1],
  ],
  // A solid rounded mound — the one bush with no spikes at all, so it separates from the other
  // two by outline alone once colour is gone.
  'decor-boxwood': [
    [0, 1],
    [0.04, 0.62],
    [0.2, 0.3],
    [0.44, 0.16],
    [0.62, 0.2],
    [0.82, 0.36],
    [0.96, 0.66],
    [1, 1],
  ],
  // A rosette of long blades springing from a point, wider than the frond and much lower.
  'decor-thistle': [
    [0.5, 1],
    [0.2, 0.72],
    [0, 0.4],
    [0.28, 0.6],
    [0.3, 0.2],
    [0.44, 0.52],
    [0.5, 0.04],
    [0.56, 0.52],
    [0.7, 0.2],
    [0.72, 0.6],
    [1, 0.4],
    [0.8, 0.72],
  ],
  // Deliberately irregular: no two points the same height, so it never reads as a repeated
  // stamp the way an evenly-toothed shape does when the same texture appears six times on
  // screen at once.
  'decor-bramble': [
    [0, 1],
    [0.06, 0.6],
    [0.16, 0.72],
    [0.22, 0.34],
    [0.34, 0.6],
    [0.42, 0.18],
    [0.52, 0.52],
    [0.62, 0.22],
    [0.72, 0.58],
    [0.82, 0.36],
    [0.9, 0.66],
    [1, 1],
  ],
  // Fallback only — the shipped slot is a bare dead tree. Kept as a tall, narrow, obviously
  // man-made outline so that if the art ever fails to load the silhouette still reads as a
  // deliberate marker rather than as a missing texture.
  'decor-deadtree': [
    [0.42, 1],
    [0.42, 0.62],
    [0.1, 0.56],
    [0.1, 0.48],
    [0.42, 0.54],
    [0.42, 0.34],
    [0.18, 0.28],
    [0.18, 0.2],
    [0.42, 0.26],
    [0.44, 0],
    [0.56, 0],
    [0.58, 0.26],
    [0.82, 0.2],
    [0.82, 0.28],
    [0.58, 0.34],
    [0.58, 0.54],
    [0.9, 0.48],
    [0.9, 0.56],
    [0.58, 0.62],
    [0.58, 1],
  ],
}

/**
 * An outline for a slot that has none of its own, chosen by the slot's proportions.
 *
 * Never returns undefined: every declared texture must be drawable, because the alternative is a
 * `Graphics` call against `undefined` deep inside texture creation, at boot, with a stack that
 * points nowhere useful.
 */
export function fallbackShapeFor(key: string): Polygon {
  const own = DECOR_SHAPES[key]

  if (own) return own

  const texture = DECOR_TEXTURES.find((candidate) => candidate.key === key)
  const aspect = texture ? texture.width / texture.height : 1

  if (aspect < 0.7) return DECOR_SHAPES['decor-spire']
  if (aspect > 1.4) return DECOR_SHAPES['decor-boulder']

  return DECOR_SHAPES['decor-bramble']
}
