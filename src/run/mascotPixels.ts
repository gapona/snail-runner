import { getRoadTheme, type RoadTheme } from '../road/themes'
import { fromOklab, mixOklab, relativeLuminance, toOklab } from '../road/color'
import { recolour, snailColourFamily, type SnailSkin } from './snailSkins'

/**
 * The whole of what turns the shipped mascot render into the texture a run draws.
 *
 * **Rule: this file never imports `phaser`** — it is a pass over a pixel buffer, and that is the
 * point of it existing at all. `snailArt.ts` owns the Phaser side (getting a canvas, reading its
 * data, putting it back) and this owns every decision about what the pixels become, so
 * `verify:palettes` can recompute the skin × theme matrix through **the code the game actually
 * runs** rather than through a second copy of it.
 *
 * That split was forced by a report, and the reason outlived what forced it. The matrix asserting
 * the mascot separates from every backdrop had been computed against a contour the game had since
 * stopped drawing, and it could not be recomputed because the pass lived behind a Phaser import. A
 * rule the checks cannot reach is a rule nobody is checking — which is as true of the pad's light
 * as it was of the contour that is now gone.
 *
 * Two things happen here, and the order matters: the skin's hue rotation, then the pad taking the
 * theme's light — the pad is ground, and was reported as the brightest thing in a night frame.
 *
 * ## ⚠ There is no contour, and three rounds of one were removed to get here
 *
 * A two-tone rim used to be painted round the creature after both of those. It was reported three
 * times and each report was answered by keeping the mechanism and changing a number: first the rim
 * traced the *pad* rather than the creature (the render is a snail on a spread of its own foot, so
 * the sprite's silhouette is mostly the foot's); then its pale band was a white ring; then its
 * tones were chosen against a measured backdrop instead of bracketed. The fourth report was
 * *remove it entirely — not black, not white, none*, and that is what this file does now.
 *
 * **What it gives up is stated rather than hidden.** The rim was the second half of an `or`:
 * `verify:palettes`' A5 asks that a skin separates from every ground *either* by its own colour
 * *or* by its contour, and with the contour gone only the first half is left. Several skin-and-
 * theme pairs lean on the second — see the table that check prints. What carries the mascot now is
 * what carried it before the rim existed: it is the one saturated thing in the frame, and the
 * render's own drawn edge. If a skin is ever reported as lost against a ground, the answer is that
 * skin's colour or that theme's ground, not a line round the creature.
 */

/**
 * How dark the pad may get, and how far toward the theme's air it is carried.
 *
 * **⚠ The floor exists because the pad is part of the mascot's own picture, not only a patch of
 * ground.** A pad driven to near-black is a hole under the creature rather than a foot, and it
 * takes the shell's lower edge with it. At `night`'s 0.34 the pad keeps 55% of its own lightness —
 * dark enough to stop being the brightest thing in the frame, light enough to still read as a
 * foot.
 *
 * Mixed toward the theme's fog rather than simply scaled: a pure multiply drives a saturated green
 * toward black and leaves a hole where the pad was, where a mix toward the air the theme is lit by
 * keeps it reading as a wet green surface in that light.
 */
export const PAD_LIGHT_FLOOR = 0.32
export const PAD_FOG_MIX = 0.35

/**
 * Puts a pad pixel under the theme's own light.
 *
 * `groundLight` is the factor every biome's ground is dimmed by before the road-edge contrast rule
 * runs — 1 at noon, 0.34 at night — so using it here is the pad answering to the same lamp as the
 * ground it lies on rather than to a second one invented for it.
 *
 * **The creature is deliberately not touched.** The snail is the one object in this game allowed to
 * be saturated, precisely so the player never has to search for it; what recedes is the ground it
 * is standing on, which is what the report was about.
 */
export function litLikeGround(color: number, theme: RoadTheme): number {
  const light = theme.groundLight

  if (light >= 1) return color

  const { L, a, b } = toOklab(color)
  const dimmed = fromOklab({ L: L * (PAD_LIGHT_FLOOR + (1 - PAD_LIGHT_FLOOR) * light), a, b })

  return mixOklab(dimmed, theme.fog, (1 - light) * PAD_FOG_MIX)
}

/**
 * What the mascot is actually drawn over, as relative luminance.
 *
 * **⚠ The near road, not the theme's ground and not an average of the palette.** The snail is drawn
 * at `PLAYER_Z`, a handful of segments ahead of the camera, so what is behind it is the road
 * surface at the very front of the frame before any fog has touched it. Taking the theme's ground
 * would measure the verge, which the mascot is only over at full lock.
 *
 * Both asphalt shades are averaged because the road alternates between them on the rumble beat, so
 * over a second the mascot is over each about equally.
 */
export function roadLuminance(theme: RoadTheme): number {
  return (relativeLuminance(theme.road[0]) + relativeLuminance(theme.road[1])) / 2
}

/**
 * The creature's own mean relative luminance, measured on the shipped render.
 *
 * **What it is for: anything drawn ON the mascot has to be toned against the mascot** rather than
 * against the road behind it. Taking that from a constant rather than from the sprite keeps the
 * decision off a pixel pass over a creature the caller has not been handed.
 *
 * **⚠ It is stated as skin-independent and that is nearly true rather than exactly true.** `recolour`
 * is a rigid hue rotation at constant OKLab lightness, so a skin cannot brighten the shell — but
 * relative luminance is not OKLab lightness and the sRGB clamp moves it a little either way.
 * Measured over the five: **0.2915 (`rose`) to 0.3469 (`teal`), mean 0.313**. What has to hold is
 * not that the number is fixed but that the *tone* chosen against it is, and `verify:skins` asserts
 * exactly that over all five — if it ever stops holding, such a texture's key needs the skin
 * in it and this constant becomes a function.
 */
export const MASCOT_CREATURE_LUMINANCE = 0.313

/** The mascot's own luminance, for anything choosing a colour to draw *on* the creature. */
export function creatureLuminance(): number {
  return MASCOT_CREATURE_LUMINANCE
}

export interface MascotPass {
  /**
   * The creature's measured mean luminance for *this* skin, so a check can hold
   * `MASCOT_CREATURE_LUMINANCE` against the pixels rather than against the day it was typed.
   */
  creatureLuminance: number
  /** The pad's mean luminance after the theme's light. */
  padLuminance: number
  /**
   * One byte per pixel, non-zero for the creature — everything the pad is not.
   *
   * **Returned because "does the mascot merge with the ground" is a question about the creature.**
   * The pad *is* ground now, lit by the theme like every other piece of it, so counting its pixels
   * as the mascot's colour would fail a check for the thing this round set out to do.
   */
  creature: Uint8Array
}

/**
 * Recolours one frame and dims its pad, in place. `pixels` is RGBA, row-major.
 *
 * `cache` is optional and is the difference between a pass worth doing at scene start and one worth
 * precomputing into files: `build-sprites.py` quantises to 64 colours, so one shared map turns
 * 187k OKLab round trips into about 64. Pass the same map for all six frames of a skin.
 */
export function paintMascot(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  skin: SnailSkin,
  theme: RoadTheme = getRoadTheme(),
  cache: Map<number, number> = new Map(),
): MascotPass {
  // **The creature, not the sprite.** The render is a snail standing on a spread of its own foot,
  // and that pad is 39% of the opaque pixels and the full width of the canvas from row 104 down —
  // so any question about "the mascot's colour" that reads the whole sprite is mostly a question
  // about its foot. Built on the base art, before the recolour, because a skin turns the pad's hue
  // and the mask has to be a property of the drawing rather than of the purchase. See
  // `snailColourFamily`.
  const creature = new Uint8Array(width * height)
  let padTotal = 0
  let padCount = 0
  let creatureTotal = 0
  let creatureCount = 0

  for (let i = 0; i < pixels.length; i += 4) {
    // Fully transparent pixels are skipped rather than recoloured: `build-sprites.py` floods colour
    // under the transparency on purpose (so no downscale mixes black into the silhouette), and
    // rotating that flood would cost the pass a third of its work to change nothing visible.
    if (pixels[i + 3] === 0) continue

    const packed = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]
    const pad = snailColourFamily(packed) === 'foot'

    if (!pad) creature[i / 4] = 1

    let turned = cache.get(packed)

    if (turned === undefined) {
      turned = recolour(packed, skin)
      if (pad) turned = litLikeGround(turned, theme)
      cache.set(packed, turned)
    }

    pixels[i] = (turned >> 16) & 0xff
    pixels[i + 1] = (turned >> 8) & 0xff
    pixels[i + 2] = turned & 0xff
    // Alpha is untouched, so a skin cannot change the silhouette `verify:mattes` measures.

    if (pad) {
      padTotal += relativeLuminance(turned)
      padCount++
    } else {
      creatureTotal += relativeLuminance(turned)
      creatureCount++
    }
  }

  const padLuminance = padCount > 0 ? padTotal / padCount : 0.5
  const creatureMean = creatureCount > 0 ? creatureTotal / creatureCount : MASCOT_CREATURE_LUMINANCE

  // Nothing is drawn round the creature. `creature` is still returned because "does the mascot
  // merge with the ground" is a question about the creature and not about the foot it stands on --
  // see `MascotPass.creature`.
  return { creatureLuminance: creatureMean, padLuminance, creature }
}

