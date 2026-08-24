/**
 * How dark a plate has to be under a piece of text for that text to be readable on it.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:menu` loads it under Node.
 *
 * The problem it solves is specific to a menu drawn over the live world: the background is a
 * different colour on every theme, at every point of the track, and at every viewport (the sky
 * takes more of a portrait frame than a landscape one). A text colour picked by eye against one
 * of those is wrong against the other six — white on the `day` sky measures well under 3:1,
 * which is where this started — and a fixed scrim alpha is either invisible on `night` or a
 * black slab on `day`.
 *
 * So nothing here is picked: the caller measures what is actually on screen, and this solves for
 * the alpha that reaches the contrast target against that measurement. The solving is a search
 * rather than algebra because the contrast ratio is a ratio of gamma-decoded luminances of an
 * **sRGB-space** blend, which does not inverting nicely — and a 12-step bisection over a
 * monotonic function costs nothing at the once-per-scene rate this runs at.
 */
import { contrastRatio, relativeLuminance } from '../road/color'

/** WCAG AA for body text, and the target the redesign asks for. */
export const CONTRAST_TARGET = 4.5

/** Steps of bisection. 12 resolves alpha to under 0.00025, far past what a byte can express. */
const BISECTION_STEPS = 12

/** Blends `over` onto `under` at `alpha`, per channel in sRGB — what the GPU actually does. */
export function blendOver(under: number, over: number, alpha: number): number {
  const mix = (shift: number) => {
    const a = (under >> shift) & 0xff
    const b = (over >> shift) & 0xff

    return Math.round(a + (b - a) * alpha) & 0xff
  }

  return (mix(16) << 16) | (mix(8) << 8) | mix(0)
}

/**
 * Picks the text colour that has the better chance against `background` before any scrim.
 *
 * Deliberately a *first* decision rather than the whole one: on a bright sky dark text starts
 * ahead, but "ahead" is not "enough", and the scrim below is what closes the rest of the gap.
 * Choosing per theme by hand is what this replaces — seven themes and three of them ambiguous.
 */
export function bestTextColor(background: number, dark: number, light: number): number {
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light
}

/**
 * The smallest alpha of `scrim` over `background` that puts `text` at `target` contrast.
 *
 * Returns `0` when the background already clears the target — a plate nobody needs is a plate
 * that should not be drawn, and this is the case a bright title over a dark sky lands in.
 * Returns `1` when even the opaque scrim cannot do it, which is a real possibility if the scrim
 * and the text are close in luminance, and the caller is expected to check rather than assume:
 * see `scrimResultFor` for the checked form.
 */
export function scrimAlphaFor(
  background: number,
  scrim: number,
  text: number,
  target: number = CONTRAST_TARGET,
): number {
  if (contrastRatio(background, text) >= target) return 0
  if (contrastRatio(scrim, text) < target) return 1

  let low = 0
  let high = 1

  // Monotonic in alpha *because* the scrim is on the far side of the text from the background:
  // every step moves the plate towards a colour that clears the target, so the first alpha that
  // clears it is the boundary the bisection converges on.
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (low + high) / 2

    if (contrastRatio(blendOver(background, scrim, mid), text) >= target) high = mid
    else low = mid
  }

  return high
}

/** What a scrim decision came out as — the alpha to draw, and the contrast it actually buys. */
export interface ScrimResult {
  textColor: number
  alpha: number
  contrast: number
  /** False when even an opaque scrim leaves the text under the target. */
  meetsTarget: boolean
}

/**
 * The whole decision for one block of text: which colour, how dark a plate, and what it measures.
 *
 * **Both candidate colours are solved for and the cheaper plate wins.** Choosing the colour first
 * — on the bare background, which is what `bestTextColor` answers — and then solving for it is
 * wrong in a way that only shows up on mid-tone backgrounds: against the live composite measured
 * on `day` (`#3f7fb2`) dark text starts ahead, so a colour-first solver picks it, then darkens
 * the plate *towards* the text and the contrast collapses to **1.03:1**. Solving both and taking
 * the lighter plate picks light text at 0.24 alpha and reaches the target. Caught by a check that
 * used the colour-first form on the live reading.
 *
 * `contrast` is computed on the *composite*, not promised from the target — it is the number the
 * acceptance asks for, and it has to be the one the screen would produce rather than the one the
 * search was aiming at.
 */
export function scrimResultFor(
  background: number,
  scrim: number,
  dark: number,
  light: number,
  target: number = CONTRAST_TARGET,
): ScrimResult {
  const candidates = [dark, light].map((textColor) => {
    const alpha = scrimAlphaFor(background, scrim, textColor, target)
    const contrast = contrastRatio(blendOver(background, scrim, alpha), textColor)

    return { textColor, alpha, contrast, meetsTarget: contrast >= target }
  })

  // A plate that reaches the target always beats one that does not, however light it is; between
  // two that both reach it, the lighter one wins, because the plate is a cost paid in obscuring
  // the game behind it.
  return candidates.sort((a, b) => Number(b.meetsTarget) - Number(a.meetsTarget) || a.alpha - b.alpha)[0]
}

/** Mean colour of a set of samples, channel by channel. The measurement a caller feeds in. */
export function meanColor(samples: readonly number[]): number {
  if (samples.length === 0) return 0

  let r = 0
  let g = 0
  let b = 0

  for (const sample of samples) {
    r += (sample >> 16) & 0xff
    g += (sample >> 8) & 0xff
    b += sample & 0xff
  }

  const mix = (total: number) => Math.round(total / samples.length) & 0xff

  return (mix(r) << 16) | (mix(g) << 8) | mix(b)
}

/**
 * The *worst* sample rather than the mean, by contrast against `text`.
 *
 * **A mean is the wrong statistic for a legibility guarantee and this is the whole reason both
 * exist.** A title band that is half bright sky and half dark hillside averages to something
 * neither half looks like, and the letters standing on the bright half are the ones nobody can
 * read. The scrim is solved against this; the mean is kept only for reporting what the band is.
 */
export function worstSample(samples: readonly number[], text: number): number {
  let worst = samples[0] ?? 0
  let worstRatio = Infinity

  for (const sample of samples) {
    const ratio = contrastRatio(sample, text)

    if (ratio < worstRatio) {
      worstRatio = ratio
      worst = sample
    }
  }

  return worst
}

/** Relative luminance, re-exported so a caller needs one import for the whole decision. */
export { relativeLuminance }
