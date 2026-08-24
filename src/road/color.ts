/**
 * Colour maths for the palette rules — perceptual distance, and plain luminance contrast.
 *
 * **Rule: this file never imports `phaser`** — it is imported directly by
 * `scripts/verify-road-projection.mjs` under plain Node.
 *
 * **Why OKLab and not the RGB distance this replaced.** The reservation around `THREAT_COLOR`
 * exists to stop anything else in the game *looking* like the warning, and a channel-wise RGB
 * distance does not measure that. It is wrong in both directions at once:
 *
 * - **False alarms on dark colours.** Two near-black tones are numerically far apart in RGB
 *   while being visually indistinguishable, so a dark theme colour could be flagged for sharing
 *   nothing with the threat but a couple of raw channel values.
 * - **Misses on light ones.** RGB compresses the differences the eye is most sensitive to at
 *   high lightness, so a washed-out pink can sit "far" from the threat red numerically and read
 *   as the same warning on screen.
 *
 * And the identity of `THREAT_COLOR` is carried by its **hue**, which RGB does not represent at
 * all — a distance that treats a hue rotation and a lightness change as the same quantity cannot
 * enforce "nothing else may be this colour".
 */

/** A colour in OKLab: perceptual lightness plus two opponent axes. */
export interface Oklab {
  L: number
  a: number
  b: number
}

/** Undoes the sRGB transfer function, giving linear light. */
function linearize(channel: number): number {
  const c = channel / 255

  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Converts a packed `0xRRGGBB` to OKLab (Björn Ottosson's matrices). */
export function toOklab(color: number): Oklab {
  const r = linearize((color >> 16) & 0xff)
  const g = linearize((color >> 8) & 0xff)
  const b = linearize(color & 0xff)

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** Applies the sRGB transfer function to linear light, and clamps to a byte. */
function encode(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(Math.max(0, channel), 1 / 2.4) - 0.055

  return Math.round(Math.min(255, Math.max(0, c * 255)))
}

/**
 * OKLab back to a packed `0xRRGGBB` ${EM} the inverse of `toOklab`, same matrices.
 *
 * **Clamps rather than gamut-maps.** A hue rotation at constant chroma routinely leaves sRGB, and
 * the honest options are to clamp (which shifts the hue slightly) or to reduce chroma until the
 * colour fits (which shifts saturation). This project has been bitten by the first before ${EM} the
 * threat guard's own rotation left 1,327 pixels still illegal after clamping ${EM} so anything whose
 * *legality* depends on the result must re-measure it after the round trip rather than trusting the
 * angle it asked for.
 */
export function fromOklab({ L, a, b }: Oklab): number {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  const r = encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bb = encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)

  return (r << 16) | (g << 8) | bb
}

/** Chroma — how saturated a colour is, independent of its hue and lightness. */
export function chroma(color: number): number {
  const { a, b } = toOklab(color)

  return Math.hypot(a, b)
}

/** Hue angle in degrees, `0..360`. Meaningless for a grey, whose chroma is ~0. */
export function hueAngle(color: number): number {
  const { a, b } = toOklab(color)

  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
}

/** Perceptual distance between two colours: plain Euclidean in OKLab, which is its whole point. */
export function deltaE(a: number, b: number): number {
  const x = toOklab(a)
  const y = toOklab(b)

  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b)
}

/** Smallest angle between two hues, in degrees, `0..180`. */
export function hueDistance(a: number, b: number): number {
  const gap = Math.abs(hueAngle(a) - hueAngle(b)) % 360

  return gap > 180 ? 360 - gap : gap
}

/**
 * Relative luminance, WCAG's definition — for "can you see the edge", not "is it the same hue".
 *
 * Kept separate from the OKLab helpers deliberately: the rumble stripe has to *contrast* with
 * the asphalt beside it, which is a lightness question and has nothing to do with the threat
 * reservation. Using one metric for both would let a repaint satisfy one rule by breaking the
 * other without anything noticing.
 */
export function relativeLuminance(color: number): number {
  return (
    0.2126 * linearize((color >> 16) & 0xff) +
    0.7152 * linearize((color >> 8) & 0xff) +
    0.0722 * linearize(color & 0xff)
  )
}

/** WCAG contrast ratio, `1` (identical) to `21` (black on white). */
export function contrastRatio(a: number, b: number): number {
  const x = relativeLuminance(a)
  const y = relativeLuminance(b)

  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * Two tints applied one after the other, as one colour.
 *
 * A Phaser tint multiplies, so a sprite drawn with tint A under a pass that would have applied B
 * ends up at exactly this — per channel, normalised. It lives here rather than in the renderer
 * because **what reaches the screen is the product, not either factor**, and the product is what has
 * to be held to the threat reservation and to a visibility floor. Both of those checks run in Node.
 */
export function multiplyTint(a: number, b: number): number {
  const r = Math.round((((a >> 16) & 0xff) * ((b >> 16) & 0xff)) / 255)
  const g = Math.round((((a >> 8) & 0xff) * ((b >> 8) & 0xff)) / 255)
  const blue = Math.round(((a & 0xff) * (b & 0xff)) / 255)

  return (r << 16) | (g << 8) | blue
}
