/**
 * The widget kit's palette, and the geometry rules its controls are built to.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:ui` loads it under Node, which is
 * the only way the palette's two hard requirements can be checked without a browser: that no colour
 * in it strays into the reserved threat hue, and that its text meets 4.5:1 against its own plate.
 * `ui/kit.ts` re-exports `KIT`, so a widget author never needs to know this file exists.
 *
 * **Fixed rather than derived from the active road theme.** Deriving it was the first instinct and
 * it is wrong: the world's palette is what the interface has to stay legible *against*, and a UI
 * that changed colour with it would need its contrast re-measured per theme — seven times, over a
 * background that also moves. A fixed palette is measured once. The colours themselves are taken
 * from the world rather than invented: the sky's deep top, the HUD's neutral, the ship's cyan, the
 * coin's warm sand.
 */

import { THREAT_COLOR } from '../road/themes'

export const KIT = {
  /** Plate fill. The sky's own deep navy, so a panel reads as a piece of the same picture. */
  plate: 0x10283f,
  /** Rim and body text. The HUD's neutral. */
  rim: 0xdce6f0,
  /** Muted text and inactive rims. */
  muted: 0x8fa6bd,
  /** The active/positive accent: the ship's own cyan, so "yours" is one colour everywhere. */
  active: 0x7fd8f2,
  /** Currency and rewards. Warm sand — the one warm colour in the kit, and it is not the threat. */
  coin: 0xe8c98a,
  /**
   * Your own systems are in trouble: shields down to one, the lock counter at its ceiling, the top
   * step.
   *
   * **Not the threat colour, and the distinction is the whole point of having a fifth colour.**
   * Red means "something out there is about to shoot you"; amber means "your own machine is telling
   * you something". Before this existed the combat layer drew both of those in whatever `secondary`
   * happened to be — which, once the palette moved, made the low-shield pulse and the lock counter
   * a *white* flash, i.e. a warning with no warning colour at all.
   *
   * Picked by measurement from six candidates rather than by eye: 46.1 degrees from `THREAT_COLOR`
   * (against the 30 reserved), luminance 0.454 (over the HUD's own 0.3 floor), 7.21:1 on the plate,
   * and the furthest of the six from `coin` -- which matters because the heat bar's warm step is
   * `coin` and its hot step is this, one above the other on the same bar. The separation the eye
   * actually uses there is the luminance step, 0.454 against 0.608.
   */
  warning: 0xf2a33c,
  /** Disabled. Deliberately desaturated, so it can never be mistaken for the threat hue. */
  disabled: 0x6b7a8a,
} as const

/**
 * The colour of being hit: the HUD's directional edge flash and `Effects`' damage frame.
 *
 * **It is `THREAT_COLOR` itself, deliberately, and that is why it lives outside `KIT`.** Every other
 * colour in this file is held out of the reserved band by `verify:ui`; this one *is* the reserved
 * band, because the thing it marks is the threat arriving. `enemy.rim` and `enemyTint` are the two
 * exemptions CLAUDE.md already records, and this is the third and last: the shot landing on you is
 * as much "the threat" as the enemy that fired it.
 *
 * It replaces a hardcoded `0xff3355` in `Effects.ts` -- an undocumented near-miss sitting **4.4
 * degrees** from the reserved hue, i.e. the threat colour arrived at by eye rather than by name. One
 * constant with a reason beats two literals that happen to agree.
 */
export const DAMAGE_COLOR = THREAT_COLOR

/**
 * The widget kit's palette mapped onto `ui/theme.ts`'s six slots, applied once from `main.ts`.
 *
 * **This is not cosmetic tidying — the slot it replaces was inside the reserved threat band.**
 * `DEFAULT_THEME.primary` ships as `0xff2975`, which measures **15.4 degrees** from `THREAT_COLOR`
 * at chroma 0.243 and a lightness within 0.006 of it: all three terms of the project's own standing
 * rule, i.e. the danger colour by any test this codebase applies to anything else. And it is what
 * the HUD drew the player's **shields** in, along with the heat bar, the selected weapon cell, the
 * lock-on ring and the result panel — so the one hue reserved for "something is about to shoot you"
 * was also the hue of every readout saying "this is yours". That is exactly the dilution the
 * reservation exists to prevent, and it survived because the rule was enforced on the *road*
 * themes, where it was written, and never on the interface palette. `verify:ui` now holds both.
 *
 * The mapping keeps each slot's meaning rather than merely recolouring it: `primary` is the "yours"
 * accent (the ship's cyan), `secondary` the neutral rim, `accent` the warm currency sand — which is
 * what `valueBadge` and the score glow already used it for.
 */
export const UI_THEME_COLORS = {
  primary: KIT.active,
  secondary: KIT.rim,
  accent: KIT.coin,
  backgroundTop: KIT.plate,
  backgroundBottom: 0x081a2b,
  surface: 0x0a1c2e,
} as const

/**
 * The smallest tap target, and the smallest a control may be *drawn* at.
 *
 * They are different numbers on purpose: a slider's rail is 8px because a 44px rail is a trough,
 * and its *hit zone* is 44 because nobody can hit 8px with a thumb. Every interactive widget in the
 * kit pads its hit area out to `MIN_TOUCH` regardless of how small it draws — `verify:ui` asserts
 * the arithmetic each of them uses to do it.
 */
export const MIN_TOUCH = 44

/** Slider geometry, in pixels at `uiScale` 1. Shared with `ui/kit.ts`'s own drawing. */
export const SLIDER_GEOMETRY = { track: 8, handle: 22, ticks: 10 } as const

/** Button padding and corner radius, in pixels at `uiScale` 1. */
export const BUTTON_GEOMETRY = { padX: 22, padY: 12, radius: 12 } as const

/**
 * The height of a slider's hit zone at a given ui scale.
 *
 * Extracted so the floor can be asserted rather than trusted: the rail is 8px and the handle 22px,
 * so without the `MIN_TOUCH` floor the zone would be 35px at scale 1 and 28px at the narrow end —
 * both under the touch minimum, on exactly the devices where a touch is the only input.
 */
export function sliderHitHeight(scale: number): number {
  return Math.max(MIN_TOUCH, SLIDER_GEOMETRY.handle * scale * 1.6)
}
