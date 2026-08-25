/**
 * Every colour the game draws its own art with, and the two measurements that decide them.
 *
 * **Rule: this file never imports `phaser`.** It is loaded under plain Node by
 * `scripts/verify-obstacles.mjs`, which is the point: the two mistakes made while drawing this art
 * were both mistakes about *numbers*, and both are catchable without a rasteriser.
 *
 * The target comes from the scenery itself. `node scripts/measure-art.mjs` walks the 49 verge PNGs
 * and reports **lightness 111, saturation 5%, ink 34%**; the rail shooter established that this
 * triple — not line style — is what makes a prop belong to a frame or jump out of it. So:
 *
 * - **Obstacles aim at it.** A rock or a fallen trunk is part of the picture; what separates it
 *   from the verge is that it stands on grey asphalt, not that it is a different colour.
 * - **The snail aims away from it.** It is the one object the player's eye must never search for,
 *   so it is deliberately brighter and many times more saturated than anything around it.
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
 * Warm shell against a cool-green body so the two never merge at distance, and both far past the
 * scenery's 5% saturation. Bands rather than gradients — a gradient at the 21px a phone delivers is
 * a smear, where three flat steps still read as a lit round thing.
 */
export const SNAIL_SHELL = { light: 0xf6b45c, mid: 0xe08a2e, dark: 0xa85f1c } as const
export const SNAIL_BODY = { light: 0xd7e86a, mid: 0xb6cf42, dark: 0x7c9a28 } as const

/**
 * The obstacles: stone for the two rocks, weathered timber for the trunk.
 *
 * **Both the saturation and the darkness here were set by measurement, not by eye, and both were
 * wrong on the first pass.** The trunk came back at 42% saturation against the scenery's 5%, and
 * every `dark` band landed at lightness 71-72 — a hair *above* `INK_LIGHTNESS`, so the shaded half
 * of every rock counted as body colour and the obstacles measured 10-18% ink against the verge's
 * 34%. They looked flat and pasted-on beside it. Every `dark` is now under the threshold, which is
 * what puts a rock's shadow side into the same tonal bracket as the outline around it.
 */
export const OBSTACLE_MATERIALS = {
  low: { light: 0x968f88, mid: 0x6f6862, dark: 0x433f3a },
  blocking: { light: 0x939aa1, mid: 0x6a7078, dark: 0x3c4147 },
  overhead: { light: 0x8c847a, mid: 0x6b645b, dark: 0x3e3a34 },
} as const

/**
 * The pickups: bright, saturated, and in the snail's family rather than the scenery's.
 *
 * **A pickup is a thing the player is meant to want, so it is lit like the creature and not like
 * the rock.** That is the whole colour rule of this game stated in one place: everything is muted
 * except the snail and the things you steer it towards.
 *
 * Three easy hues — cyan, green, gold — but colour is the second cue. The silhouettes carry the
 * read: a directional stack of chevrons, a closed plate, a ring with a hole. See `pickupArt.ts`.
 */
export const PICKUP_COLORS = {
  boost: { light: 0x7fe6ff, mid: 0x2fbde8, dark: 0x116d8c },
  shield: { light: 0x9df2a1, mid: 0x4fc663, dark: 0x1f6b34 },
  coin: { light: 0xffd964, mid: 0xf0b024, dark: 0x8f5f0e },
} as const
