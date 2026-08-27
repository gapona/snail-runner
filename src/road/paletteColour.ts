/**
 * What colour one palette texel actually gets: the whole chain, in one pure place.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:road` loads it under Node.
 *
 * **⚠ It exists because a check was sweeping a blend the renderer had stopped performing.** The
 * threat reservation is swept over every fog blend of every ground colour, and that sweep was
 * written against `blendColor` — an sRGB lerp — while `createRoadPalette` had moved to an HSL fade
 * with a saturation term and an OKLab dissolve into the sky. The check went on rejecting a colour
 * that no longer reaches the screen and passing ones that do. A reservation swept over the wrong
 * arithmetic is not a reservation.
 *
 * So the chain lives here and both callers use it. The renderer cannot drift from the check
 * because there is one function, and the check cannot go stale because it is the same call.
 */
import { fogBlendFill, fromHsl, mixOklab, toHsl } from './color'
import { FOG_SATURATION, GROUND_FOG_TOWARD_SKY, GROUND_HORIZON_BLEND, PALETTE_SATURATION } from './constants'

/** Which family of surface a column belongs to — they are saturated and faded differently. */
export type SurfaceFamily = 'road' | 'rumble' | 'ground'

export interface SurfaceColourInput {
  /** The authored colour, before anything is done to it. */
  base: number
  family: SurfaceFamily
  /** The theme's fog colour, which lightness travels toward. */
  fog: number
  /** The theme's horizon, which the last rows dissolve into. */
  sky: number
  /** How far into the fog this row is, `0..1`. */
  amount: number
}

/**
 * The three steps, in the one order that is correct.
 *
 * 1. **Saturation is lifted first**, so the fade works on the colour that actually ships rather
 *    than on the authored one.
 * 2. **The fade moves lightness toward the fog and takes saturation away** for a solid fill — see
 *    `FOG_SATURATION` for why a billboard is the opposite case and does not come through here.
 * 3. **The last rows dissolve into the sky**, in OKLab rather than sRGB: an sRGB lerp from a sandy
 *    ground to a pink horizon detours through a saturated red, which put `dunes` and `coast` one
 *    row inside the reserved band. OKLab goes the perceptually straight way, through a desaturated
 *    mauve whose chroma is under the band's own floor.
 */
export function surfaceColour({ base, family, fog, sky, amount }: SurfaceColourInput): number {
  const lift = PALETTE_SATURATION[family]
  const hsl = toHsl(base)
  // A grey stays grey: scaling the saturation of something with no hue invents one.
  const lifted = fromHsl({ h: hsl.h, s: hsl.s <= 0.01 ? hsl.s : hsl.s * lift, l: hsl.l })
  const kept = family === 'ground' ? FOG_SATURATION.ground : FOG_SATURATION.road
  // **⚠ The ground fades toward the AIR, not toward the fog colour, and the difference is a
  // measurable one.** `theme.fog` is authored as the colour the whole far field sits in; the
  // ground meets the *sky*, which on a sunset theme is far lighter than that. Fading to the fog
  // alone left `dusk`'s ground eleven points of lightness darker than the air one row short of the
  // horizon -- receding into something darker than what it recedes against, which is the inverse
  // of aerial perspective. The road keeps the fog target: it does not run to the horizon in the
  // player's eye, the verge does.
  const target = family === 'ground' ? mixOklab(fog, sky, GROUND_FOG_TOWARD_SKY) : fog
  // In OKLCh, where the fade controls perceptual chroma directly -- see `fogBlendFill` for the two
  // rounds spent discovering that HSL saturation is not chroma and that a lightening fill gets
  // louder while its `s` falls.
  const faded = fogBlendFill(lifted, target, amount, kept)
  const intoSky = Math.max(0, amount - (1 - GROUND_HORIZON_BLEND)) / GROUND_HORIZON_BLEND

  if (intoSky <= 0) return faded

  // **⚠ Cubed, and not for looks.** A linear ramp holds the surface *part* of the way into the sky
  // for several rows, and on `dusk` -- whose horizon is a pink already close to the reserved band --
  // those middle rows landed inside it. Easing spends almost the whole dissolve on the last row,
  // which is also where it is actually needed: the requirement is that the surface's final row IS
  // the sky, so there is no edge, not that it approaches it slowly.
  const eased = Math.min(1, intoSky) ** 3

  return mixOklab(faded, sky, eased)
}
