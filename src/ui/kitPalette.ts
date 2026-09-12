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

import { fromOklab, toOklab } from '../road/color'
import { THREAT_COLOR } from '../road/themes'

/**
 * The hue every button face in this kit is built on: the navigation blue.
 *
 * **One hue, three weights.** A screen's buttons differing by *colour* reads as three unrelated
 * controls — reported off the result panel, where a cyan `Again`, a grey `Double coins` and a slate
 * `Menu` sat in one column and the question was why they were not all the same blue. What tells the
 * tiers apart is how bright and how saturated they are, which is the same argument `SECONDARY_FACE`
 * makes for the mode chip drawn over the sky.
 *
 * `btnConfirm` is the one deliberate exception and stays green: buy/confirm is a different *kind* of
 * action rather than a different weight of the same one, and green is the only colour in the
 * interface that says so.
 */
const BTN_FACE = 0x3f9bd8

/**
 * A face on the button hue, at a stated OKLab lightness and chroma.
 *
 * **⚠ The numbers are the face as it is PAINTED, and a button face is opaque.** Worth stating,
 * because the first attempt at this solved them backwards through an alpha composite over the
 * plate: `kitButton` really does carry a `fillAlpha` of 0.32 for the tertiary tier and 0.72 for
 * disabled — and every one of those belongs to the **fallback** drawing, the one a scene gets when
 * the nine-slice masters have not loaded. The shipped look is `bakeUiSprite`, which paints the face
 * at full opacity. Solved against the blend, `btnMuted` came out a bright sky blue and drew *louder*
 * than the tier above it; that was caught by sampling the framebuffer, not by any check.
 *
 * This project already records the same failure as *"a check sweeping a blend the renderer had
 * stopped performing"*. This is that shape from the other end: arithmetic against a blend the
 * renderer only performs somewhere the player never looks.
 */
function onButtonHue(lightness: number, chroma: number): number {
  const { a, b } = toOklab(BTN_FACE)
  const base = Math.hypot(a, b)
  const scale = base > 0 ? chroma / base : 0

  return fromOklab({ L: lightness, a: a * scale, b: b * scale })
}

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
  /** The default button. Navigation, and the most common face on any screen. */
  btnFace: BTN_FACE,
  /** Buy, confirm, proceed. The one green in the interface. */
  btnConfirm: 0x5cb45f,
  /**
   * The tertiary tier: present, pressable, and asking for nothing.
   *
   * **⚠ It was `0x5a6b80` and read as grey beside a blue button.** The instructive part is that it
   * was already in the right *hue* — 12.4 degrees off the navigation blue — and its **chroma was
   * 0.039 against that blue's 0.125**, under a third. A colour with a third of the chroma is not a
   * quieter member of a family, it is a grey with a bluish cast, which is exactly how it looked.
   *
   * So the neutral tiers are solved on the navigation blue's own hue rather than typed as hex, and
   * what separates them is **lightness and chroma, never hue**.
   */
  btnMuted: onButtonHue(0.52, 0.072),
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
  /**
   * Disabled.
   *
   * **The dimmest of the family and the least saturated, which is the signal.** Colour is what says
   * a control can be acted on, so a disabled face keeps the hue and gives up most of the chroma: it
   * plainly belongs to the same blue and is plainly not offering anything. Still deliberately far
   * from the threat hue, which a near-neutral blue is by construction.
   */
  disabled: onButtonHue(0.57, 0.038),
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

/*
 * ⚠ `SECONDARY_FACE` / `secondaryFace` used to live here and are deleted.
 *
 * They derived a quieter face from the primary — the mode chip's, after it shipped in the kit's
 * fixed slate and was reported as a control from another screen. The chip is now Play's colour
 * exactly (the two were reported for not matching), so the derivation had no
 * caller left, and this project has five separate write-ups of what an authored quantity nothing
 * reads eventually does. Restore it from history if a *second* secondary control ever needs one;
 * the rule it encoded — a face beside a themed primary is derived from it, never a fixed colour —
 * is what is worth keeping, and it is stated on `kitButton`'s own `fill`.
 */

/**
 * How much bigger the run's HUD is drawn on a hand-held frame, and where that stops.
 *
 * **⚠ Keyed on the frame's SHORT side, which is the half no other scale in this project does.**
 * `uiScale` keys on width because it is about *fitting* — a wide widget must not overflow a narrow
 * frame, so it shrinks below its reference. Applied to the HUD that is exactly backwards, and it
 * shipped that way: the readouts came out at **0.94** of their desktop pixel size on a 375px phone,
 * reported as the icons being too small on mobile.
 *
 * The reason a phone needs *more* pixels is that a CSS pixel is not a size. A 393-wide phone spreads
 * its frame over about 2.8 inches — roughly 140 CSS px to the inch — where a 1920-wide monitor
 * spreads it over 23, at 82. The same 26px pip is 4.7mm in the hand and 8mm on the desk, so anything
 * sized in CSS pixels is close to 40% smaller physically on the device this game ships to.
 *
 * The short side rather than the width, because this is about *physical* size and a frame is held in
 * the hand when its short side is small. On width alone an 844x390 landscape phone is a desktop and
 * keeps a 1.0 HUD — which is the frame the rule most needs to reach.
 */
export const HUD_SCALE = { reference: 480, max: 1.35, landscapeHeight: 300 } as const

/**
 * The run HUD's scale at a given viewport. 1 on a desk, up to `HUD_SCALE.max` in the hand.
 *
 * Never below 1: the HUD owns four corners and is laid out against them, so it has nothing to
 * overflow and no reason to shrink. `verify:ui`'s corner sweep measures every HUD box at this scale
 * rather than at a hand-written column, so the cap is held by the check that already exists.
 */
export function hudScale(width: number, height: number): number {
  const short = Math.min(width, height)

  // **A frame with no size falls back to 1, rather than to the cap.** `reference / 0` is Infinity
  // and would clamp to `max`, i.e. the biggest HUD in the game on a viewport that does not exist —
  // and a scene laid out before the ScaleManager has read its parent gets exactly that. The floor
  // has to be the neutral value, not the loud one.
  if (!(short > 0)) return 1

  // **⚠ But in landscape the short side is the HEIGHT, and height is the one thing a landscape phone
  // has none of.** Keyed on the short side alone, a phone held sideways in a webview — about 828x300
  // once the browser's own header has taken its share — got the *biggest* HUD in the game: a top
  // band a third of the frame tall over a road squeezed into the bottom third, reported as
  // everything overlapping everything. The physical argument still holds, and it is capped by what
  // the frame can hold: no bigger than the height allows, where `landscapeHeight` is the height at
  // which the unscaled HUD is already as much of the frame as it should be. 844x390 is unchanged.
  const landscapeCap = width > height ? height / HUD_SCALE.landscapeHeight : Infinity

  return Math.max(1, Math.min(HUD_SCALE.max, HUD_SCALE.reference / short, landscapeCap))
}
