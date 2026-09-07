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
  /** Sun-bleached stone: the low barrier block, and the brightest of the three. */
  low: { light: 0xdcc5a0, mid: 0xa89070, dark: 0x413729 },
  /** Weathered grey timber: the upright panel, whichever variant a row draws. */
  blocking: { light: 0xb6b6b0, mid: 0x82827c, dark: 0x31312c },
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
  // **⚠ Not the obvious medkit red, and the reason is the reservation.** `THREAT_COLOR` owns the
  // warm red this object is drawn in everywhere else, and `threat_guard` rotates any reserved pixel
  // out at build time — a red that stays has to escape on lightness, so it is a deep oxblood
  // (`L` 0.39 against the threat's 0.648) and it is the *cross* rather than the case. See
  // `dev-assets/cc0-3d/medkit_render.py`, which measured the inverse and rejected it.
  heal: { light: 0xf0ece2, mid: 0x8f1d2c, dark: 0x7d1a28 },
  coin: { light: 0xffd35a, mid: 0xf2b526, dark: 0xc07a10 },
} as const

/**
 * The bug: chitin, and two eyes.
 *
 * **It is separated from the obstacles by VALUE, which is the one axis that survives this road.**
 * The rule the barrier family is held to — classes at least 12 lightness apart, because the distance
 * haze and the biome tint take hue away before they take brightness — applies with more force here,
 * since a critter is met at the sizes a `low` block is and must never be mistaken for one. It is the
 * darkest thing the game draws on the road: **57 lightness against sun-bleached stone at 134 and
 * weathered timber at 120**, on a surface that is warm pale flagstone.
 *
 * **And it is deliberately NOT saturated, which is the opposite of what a hazard wants to be.**
 * Colour in this game means "come and get it" — the mascot and the pickups own it, at 70% and 61%
 * against the barriers' 19% — so a vivid bug would be the first thing on the road a player steers
 * *towards*. Measured, this sits at **18%**, below the barriers it has to be told apart from and a
 * quarter of the mascot's. What makes a critter noticeable instead is the one cue nothing else in
 * the frame has: it is the only object that moves against the road rather than with it.
 *
 * **The eyes are the whole of the "this is alive" read**, and they are near-neutral on purpose. Two
 * pale dots on a dark head is what a player resolves at the 20px a phone delivers, long after the
 * legs have gone; giving them a hue would spend a colour the reward family is using.
 */
export const CRITTER_COLORS = {
  /** The lit top of the carapace. */
  light: 0x655a66,
  /** The shell's own body, and the legs. */
  mid: 0x3b323d,
  /** Under the shell and along the seam — below `INK_LIGHTNESS`, like every other `dark` band. */
  dark: 0x1e181f,
  /** Two dots, and nothing else in the drawing is this bright. */
  eye: 0xdfe6ea,
} as const

/**
 * The bee: the one hazard in this game allowed to be loud.
 *
 * **⚠ It breaks the rule the beetle's own palette states, and the exception is the point.** Colour
 * here means "come and get it" — the mascot and the pickups own it, and a critter was deliberately
 * drawn at 18% saturation so a player would never steer *towards* one. A bee is the opposite kind of
 * object: it is the thing you must not fly into, and unlike a beetle it cannot be read from its
 * position on the road, because it is not on the road. Its whole warning is its own surface.
 *
 * So it wears the one pattern that means "do not touch this" outside any game — **black and amber
 * banding** — and that is a real cost, stated rather than hidden: amber is the mascot's own shell
 * hue. What keeps the two apart is value and context. The mascot is `SNAIL_SHELL` at 141 lightness
 * on the road; the bee's body is 92, its bands sit against near-black, and it is the only object in
 * the game drawn *above* the road. `verify:critters` holds it clear of the reserved threat band and
 * measures the separation from the mascot rather than trusting it.
 */
export const BEE_COLORS = {
  /** The lit top of the thorax, and the bands. */
  band: 0xf2b12c,
  /** Chitin between the bands, and the head. */
  dark: 0x241d18,
  /** Wings: pale, and the only translucent-reading thing in the set. */
  wing: 0xd6e4ef,
  /** Two dots, as the beetle has. */
  eye: 0xdfe6ea,
} as const
