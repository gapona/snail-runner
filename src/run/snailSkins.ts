/**
 * The mascot's wardrobe: what a snail skin is, which ones the shop sells, and the one transform
 * that turns the shipped render into any of them.
 *
 * **Rule: this file never imports `phaser`.** It is loaded directly under plain Node by
 * `scripts/verify-skins.mjs`, which decodes the real `snail-0.png` and runs `recolour` over every
 * pixel of it — so the palette rules below are checked against what actually reaches the screen
 * rather than against the numbers that were typed. The Phaser half is `snailArt.ts`.
 *
 * **A skin is a recolour of the one render, not a second render.** Six frames per skin is 130KB of
 * PNG each, and — much worse — six more drawings of a creature whose identity is the entire
 * product: the shell's spiral, the two stalks and the wave along the foot are what a player reads
 * as "the snail", and redrawing them per skin is five chances to draw a different animal. What may
 * differ without touching identity is colour, and colour is free.
 *
 * **The transform is a rigid hue rotation per family, in OKLCh.** Every pixel keeps its own
 * lightness and its own offset from its family's mean hue, so the render's shading, its ink and its
 * specular survive exactly; what moves is where the family sits on the wheel. Two things fall out
 * of that and neither needed a special case:
 *
 * - **the ink and the highlight recolour themselves by not being colours.** Both sit below
 *   `THREAT_MIN_CHROMA`, where a hue angle is numerical noise — the same escape the threat
 *   reservation grants — so rotating them is a no-op on a near-neutral;
 * - **the shell and the foot move independently**, because the render's own hues fall into two
 *   clean clusters with 20 degrees of empty wheel between them (see `SNAIL_HUE_SPLIT`).
 *
 * **⚠ A rotation at constant chroma routinely leaves sRGB, and the clamp back moves the hue
 * again.** `scripts/threat_guard.py` learned that the expensive way — its first pass left 1327
 * "corrected" pixels still illegal. Nothing here trusts the arithmetic: `verify:skins` sweeps the
 * *output* pixels, which is the only place the clamp's answer exists.
 */
import { fromOklab, toOklab } from '../road/color'

/**
 * The hue at which the shell family ends and the foot family begins, in OKLCh degrees.
 *
 * **Measured off the shipped render, an external fact rather than a choice** — the same standing as
 * `MASCOT_ASPECT`. Over `snail-0.png`'s 15810 opaque pixels the legible ones (chroma at or above
 * `THREAT_MIN_CHROMA`) fall in exactly two clusters: **46.0..91.5 degrees** with 9186 pixels, whose
 * centroid is the upper half of the sprite, and **111.6..139.4** with 5896, whose centroid is the
 * lower half. Shell and foot. The 728 pixels between and beyond them are all below that chroma —
 * the ink, the mouth stroke, the eyes and the shell's specular — so which side of this line they
 * land on cannot change what they look like.
 */
export const SNAIL_HUE_SPLIT = 105

/**
 * Where each family sits today, in OKLCh degrees — the origin every rotation is measured from.
 *
 * Measured, not authored: they are the means of the two clusters above. A skin's `shellHue` of 118
 * means "rotate the shell family by `118 - 62.1`", so the shipped render is reproduced exactly by
 * naming its own means, which is what `amber` does.
 */
export const SNAIL_BASE_HUES = { shell: 62.1, foot: 127.0 } as const

/** The measured hue span of each family, as offsets from its mean — what the checks sweep. */
export const SNAIL_HUE_SPREAD = {
  shell: { min: -16.1, max: 29.4 },
  foot: { min: -15.4, max: 12.4 },
} as const

export interface SnailSkin {
  /**
   * Stable id. **For a paid skin this is also what goes into `SaveState.purchases`** (behind
   * `skinItemId`), so renaming one asks everybody who owns it to buy it again.
   */
  id: string
  /** An i18n key — resolved through `tOptional()`, so a skin may ship before its translation. */
  titleKey: string
  priceCoins: number
  /**
   * One glyph for the shop row. No art dependency: a row is a list entry, not a preview — what
   * previews a skin is the front screen, where selecting one changes the mascot standing on it.
   */
  icon: string
  /** Where this skin puts the shell family and the foot family, in OKLCh degrees. */
  shellHue: number
  footHue: number
}

/**
 * The five the shop sells.
 *
 * **Every hue here is bounded by two rules, and `verify:skins` holds both against the real
 * pixels.** A family rotated to `T` occupies `[T + spread.min, T + spread.max]`, so a target is
 * only legal while that whole arc stays out of the reserved threat band — `THREAT_COLOR` plus or
 * minus `THREAT_MIN_HUE_DEGREES` — which leaves the shell `[69, 323.5]` and the foot
 * `[68.3, 340.5]`. **The mascot may not wear the danger colour**: it is the one hue this game
 * reserves, and a player sold a red snail has been sold the thing they are meant to be dodging.
 *
 * The second rule is that no two of them are the same snail: shell hues are at least 40 degrees
 * apart, which the shipped set clears by 50. Shell rather than foot because the shell is 61% of the
 * sprite's legible pixels and the thing a player names the skin by.
 *
 * **⚠ And the gamut is a third constraint nobody would guess at, so it was swept rather than
 * assumed.** sRGB is much narrower in magenta than in cyan at the render's own lightnesses, so a
 * rigid rotation there is partly eaten by the clamp: `rose` at a shell of 318 came back holding
 * **81%** of the render's saturation, against 131% for `teal`. Measured across 296..323 the cost
 * falls off steeply — 318 is 82%, 311 is 85%, 302 is 91% — so `rose` sits at 302 and `indigo` moved
 * 262 -> 255 to keep the 40-degree separation in front of it. `verify:skins` prints the retention
 * for every skin, because that number is a property of the colour space and will move again the day
 * the mascot is re-rendered.
 *
 * The price ladder mirrors the themes' deliberately — the two catalogues sell the same kind of
 * thing (a look, bought once, changing no number in the game) and pricing them differently would
 * say something about them that is not true.
 */
export const SNAIL_SKINS: readonly SnailSkin[] = [
  { id: 'amber', titleKey: 'snail_amber', priceCoins: 0, icon: '\u{1F7E0}', shellHue: 62.1, footHue: 127 },
  { id: 'fern', titleKey: 'snail_fern', priceCoins: 300, icon: '\u{1F7E2}', shellHue: 118, footHue: 150 },
  { id: 'teal', titleKey: 'snail_teal', priceCoins: 600, icon: '\u{1F535}', shellHue: 180, footHue: 205 },
  { id: 'indigo', titleKey: 'snail_indigo', priceCoins: 900, icon: '\u{1F7E3}', shellHue: 255, footHue: 285 },
  { id: 'rose', titleKey: 'snail_rose', priceCoins: 1200, icon: '\u{1F338}', shellHue: 302, footHue: 330 },
] as const

/**
 * The skin a save starts on, and the one the shipped render already is.
 *
 * **It is free and is deliberately not written into `purchases`**, exactly as the starting theme
 * is: a player who has bought nothing still owns it, and recording a purchase that never happened
 * makes `purchases` a lie the first time anything else reads it.
 */
export const DEFAULT_SNAIL_SKIN = 'amber'

export function snailSkinIds(): string[] {
  return SNAIL_SKINS.map((skin) => skin.id)
}

export function snailSkin(id: string): SnailSkin | undefined {
  return SNAIL_SKINS.find((skin) => skin.id === id)
}

/** The shop id for a skin. Prefixed so it can never collide with a theme's. */
export function skinItemId(skinId: string): string {
  return `snail-${skinId}`
}

/** The skin behind a shop item id, or `null` if the item is not a skin. */
export function skinIdFromItem(itemId: string): string | null {
  return itemId.startsWith('snail-') ? itemId.slice('snail-'.length) : null
}

export function isSnailSkinFree(skinId: string): boolean {
  return (snailSkin(skinId)?.priceCoins ?? 0) <= 0
}

/** Whether the player may wear this skin right now. */
export function ownsSnailSkin(purchases: readonly string[], skinId: string): boolean {
  if (!snailSkin(skinId)) return false

  return isSnailSkinFree(skinId) || purchases.includes(skinItemId(skinId))
}

/**
 * The skin to actually draw, given what the save says and what the player owns.
 *
 * Never trusts the saved id, for the reasons `resolveSelectedTheme` does not: a save can outlive a
 * skin id (renamed, dropped, or written by a newer build) and it can be edited by hand, so an
 * unknown or unowned id degrades to the default rather than unlocking anything or drawing nothing.
 */
export function resolveSelectedSnail(selected: string, purchases: readonly string[]): string {
  return ownsSnailSkin(purchases, selected) ? selected : DEFAULT_SNAIL_SKIN
}

/**
 * One pixel, recoloured — **the whole of what a skin is.**
 *
 * `color` is packed `0xRRGGBB`; alpha is the caller's business and is never touched, because a skin
 * must not change the silhouette `verify:mattes` measures.
 *
 * Cheap enough to run per pixel, and cheaper than that in practice: `build-sprites.py` quantises
 * every sprite to 64 colours, so a caller that memoises by input value does about 64 conversions
 * per frame rather than 31136. `snailArt.ts` does exactly that.
 */
export function recolour(color: number, skin: SnailSkin): number {
  const { L, a, b } = toOklab(color)
  const c = Math.hypot(a, b)

  // A near-neutral has no hue to rotate — this is the ink, the mouth, the eyes and the shell's
  // specular, and leaving them alone is what keeps every skin the same drawing.
  if (c < 1e-4) return color

  const hue = (Math.atan2(b, a) * 180) / Math.PI
  const family = ((hue % 360) + 360) % 360 < SNAIL_HUE_SPLIT ? 'shell' : 'foot'
  const turn = family === 'shell' ? skin.shellHue - SNAIL_BASE_HUES.shell : skin.footHue - SNAIL_BASE_HUES.foot
  const turned = ((hue + turn) * Math.PI) / 180

  return fromOklab({ L, a: Math.cos(turned) * c, b: Math.sin(turned) * c })
}
