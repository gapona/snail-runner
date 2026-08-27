/**
 * Every colour the game draws its own art with, and the two measurements that decide them.
 *
 * **Rule: this file never imports `phaser`.** It is loaded under plain Node by
 * `scripts/verify-obstacles.mjs`, which is the point: every mistake made while drawing this art
 * has been a mistake about *numbers*, and those are catchable without a rasteriser.
 *
 * ── ⚠ THE TARGET INVERTED WHEN THE ART DID, AND THAT IS THE WHOLE OF THIS FILE ───
 *
 * This file used to state the rail shooter's rule, and it was a good rule for that game's art:
 *
 *     the 49 inherited verge props measure **lightness 111, saturation 5%, ink 34%**, and every
 *     obstacle aims AT that triple, because tone — not line style — is what makes an object
 *     belong to a frame or jump out of it.
 *
 * Every sprite that rule was written for is gone. The game was re-arted to a glossy casual-mobile
 * brief (high chroma, soft studio light, creamy speculars, chunky bevelled forms, no black
 * contour), and aiming an obstacle at 5% saturation now means drawing the one object in the frame
 * still in the old game's idiom — on the road, where it is most visible.
 *
 * **What did NOT change is the reason the old rule existed**, and it is worth separating the two,
 * because only one of them was ever about muteness:
 *
 * - **An obstacle must belong to the picture and still separate from the scenery.** It used to do
 *   that by matching the verge's tone and standing on grey asphalt. It now does it by being a
 *   MADE thing among natural ones — a block wall, hay bales, barrels, crates, a stone pillar —
 *   which separates by structure and by hue at once. See `OBSTACLE_MATERIALS`.
 * - **The snail must never have to be searched for.** Unchanged, and it is now the harder of the
 *   two to hold: everything around it got brighter, so the margin it wins by is smaller and is
 *   asserted rather than assumed.
 *
 * The measured triple is still worth having and `node scripts/measure-art.mjs` still reports it.
 * What it is no longer is a target — it is the record of what the art used to be.
 */

/** Lightness below this reads as ink rather than as body colour — `measure-art.mjs`'s threshold. */
export const INK_LIGHTNESS = 70

/** Rec. 709 luma of a packed `0xRRGGBB`, on the 0-255 scale the measurements use. */
export function lightnessOf(color: number): number {
  return 0.2126 * ((color >> 16) & 0xff) + 0.7152 * ((color >> 8) & 0xff) + 0.0722 * (color & 0xff)
}

/** HSV saturation of a packed `0xRRGGBB`, as a percentage. */
export function saturationOf(color: number): number {
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)

  return max === 0 ? 0 : ((max - min) / max) * 100
}

/**
 * The one ink, shared by the snail and every obstacle.
 *
 * **Not pure black, and that is a `verify:mattes` requirement rather than a preference.** A
 * pure-black outline hard against the alpha boundary means the pipeline's closing flood copies
 * black into the transparent ring, and every mipmap level then averages it back into the
 * silhouette. `26,28,26` is the value that check established as passing.
 */
export const INK = 0x1a1c1a

/**
 * The snail: three cel bands per material.
 *
 * Warm shell against a cool-green body so the two never merge at distance. Bands rather than
 * gradients — a gradient at the 21px a phone delivers is a smear, where three flat steps still
 * read as a lit round thing.
 *
 * **These are also the tones the generated mascot was rendered from**, and that is deliberate
 * rather than a coincidence: `snail_roughs.py` in the sibling Remotion project seeds its img2img
 * init with exactly these six values, so the shipped PNG and the drawn fallback are the same
 * character in two renderings rather than two characters. A missing PNG drops the game back to
 * this palette mid-session, and the player should not be able to tell which one they are looking
 * at beyond the fidelity.
 */
export const SNAIL_SHELL = { light: 0xf6b45c, mid: 0xe08a2e, dark: 0xa85f1c } as const
export const SNAIL_BODY = { light: 0xd7e86a, mid: 0xb6cf42, dark: 0x7c9a28 } as const

/**
 * The obstacles: three made things, one material each.
 *
 * **⚠ These are no longer rocks, and the change is a readability decision rather than a restyle.**
 * Two rounds of generation asked for glossy candy-coloured stone and failed in opposite
 * directions — a 4.57:1 "cluster of boulders" returned a seamless pebble field six times of nine,
 * and once that was fixed the same brief returned wet plastic, because `glossy` and `smooth` are
 * right for a shell or a leaf and produce liquid on a featureless mass. The two renders that
 * landed in either round were both WOODEN LOGS: wood has structure the model can hold on to.
 *
 * So the classes are a low course of sandstone blocks and hay bales and barrels, an upright stack
 * of crates or a stone pillar, and a fallen trunk overhead. They separate from the scenery by
 * being *artificial* among nine biomes of natural props, which is a stronger separation than tone
 * ever gave — and the game they are aimed at is a castle-and-garden world built almost entirely
 * out of exactly these objects.
 *
 * **What the bands still have to obey, unchanged:**
 *
 * - **Every `dark` band is below `INK_LIGHTNESS`.** The first pass of the old art landed them at
 *   71-72 against a threshold of 70, so the shaded half of every obstacle counted as body colour
 *   and the set measured 10-18% ink beside a verge at 34% — flat cut-outs pasted onto the road.
 *   A `dark` band under the threshold is what puts an obstacle's shadow side into the same tonal
 *   bracket as the outline around it.
 * - **The bands are ordered light > mid > dark.** A material whose "shadow" is its brightest step
 *   is not lit, it is noise.
 *
 * **What no longer applies:** the 25% saturation ceiling these used to be held under. It was the
 * verge's 5% plus a margin, and a weathered material does not reach it from below any more.
 *
 * **⚠ AND THE FIRST DRAFT OF THIS TABLE WENT TOO FAR THE OTHER WAY, WHICH IS THE USEFUL PART.**
 * It was authored as honey sandstone, rich oak and warm bark — 60% mean saturation — and
 * `verify:obstacles` immediately failed: the snail came out only **1.2x** as saturated as an
 * obstacle against a 3x floor. That was not a stale threshold, it was a real defect and the check
 * was right. Two things were wrong at once:
 *
 * - the mascot's shell is amber, so a warm-brown hazard family sits in the SAME HUE as the one
 *   object the player must never have to search for; and
 * - the reference this whole round is aimed at does not do that either. Its stone walls, its
 *   crates and its architecture are low-chroma; what carries the chroma is the characters and the
 *   collectibles. "Candy-coloured stone" was a misreading of it.
 *
 * These are the weathered values instead: real bleached sandstone, aged crate timber and bark are
 * far less chromatic than a glossy render of them suggests. Measured, the three classes now sit at
 * 32% / 16% / 37% mean saturation against the mascot's 70%.
 */
export const OBSTACLE_MATERIALS = {
  /** Sun-bleached sandstone and straw — the low course of blocks, the bales, the barrels. */
  low: { light: 0xdcc5a0, mid: 0xa89070, dark: 0x413729 },
  /** Weathered crate timber and pale granite — whichever upright variant a row draws. */
  blocking: { light: 0xada695, mid: 0x7d766a, dark: 0x2f2c26 },
  /** Bark: the darkest of the three, because it is read against sky rather than against road. */
  overhead: { light: 0x9d8869, mid: 0x6f5f47, dark: 0x2b2519 },
} as const

/**
 * The pickups: bright, saturated, and in the snail's family rather than the scenery's.
 *
 * **A pickup is a thing the player is meant to want, so it is lit like the creature and not like
 * the rock.** That is the whole colour rule of this game stated in one place: everything is muted
 * except the snail and the things you steer it towards.
 *
 * Three easy hues — cyan, green, gold — but colour is the second cue. The silhouettes carry the
 * read: a chevron with a direction, a closed crest, a hoop with a hole. See `pickupArt.ts`.
 *
 * **All three sit on one shared dark backing disc**, drawn by `pickupArt.ts` for the fallback and
 * composited by `scripts/build-sprites.py` for the art. One disc rather than three, and it is the
 * same disc in both paths: a pickup has to separate from grey road, green grass and pale sand, and
 * the nine biomes make every one of those the background at some point.
 */
export const PICKUP_COLORS = {
  fruit: { light: 0xe3b6f5, mid: 0xa964d8, dark: 0x5d2f80 },
  shield: { light: 0x9df2a1, mid: 0x4fc663, dark: 0x1f6b34 },
  coin: { light: 0xffd964, mid: 0xf0b024, dark: 0x8f5f0e },
} as const
