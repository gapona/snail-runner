/**
 * The game's actual shop catalogue: themes.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:run`.
 *
 * Themes are the natural product for this game and cost the shop layer nothing to support:
 * they already persist (`SaveState.themeProgress`), they cannot affect balance (a theme is
 * colour, see `road/themes.ts`), and unlocking one is exactly `kind: 'unlock'`, which
 * `Shop.ts` handles without a callback.
 */
import { DEFAULT_ROAD_THEME, themeIds } from '../road/themes'
import { AUTO_THEME_ID } from '../save/types'
import type { ShopItem } from './catalog'

/**
 * Price per theme, in coins.
 *
 * **The keys are permanent.** For an `'unlock'` item the id is the exact string stored in
 * `SaveState.purchases`, so renaming one orphans everyone who already bought it — they would
 * fail `hasPurchased` against the new id and be asked to pay again.
 *
 * The ramp is deliberate: the first paid theme is reachable in four or five runs, the last one
 * is a long-term goal rather than a purchase.
 */
export const THEME_PRICES: Record<string, number> = {
  // **Two themes are free, not one.** `day` is the new default and has to be free for that to mean
  // anything; `night` stays at 0 because it was the free one and its id is what every existing
  // save's `themeProgress` and `purchases` were written against. Charging for something a player
  // already had is the one change this table is not allowed to make.
  // `day` has no row of its own (see `buildThemeCatalog`) and still has to be listed here: this is
  // what `isThemeFree` and `ownsTheme` read, and a save that explicitly names it must stay valid.
  day: 0,
  night: 0,
  dusk: 300,
  ice: 600,
  ember: 900,
  verdant: 1200,
  signal: 1500,
}

/** Icon per theme. One glyph, no art dependency — the row is a list entry, not a preview. */
const THEME_ICONS: Record<string, string> = {
  night: '\u{1F311}',
  dusk: '\u{1F307}',
  ice: '\u{2744}',
  ember: '\u{1F30B}',
  verdant: '\u{1F33F}',
  signal: '\u{25C9}',
}

/** The shop id for a theme. Prefixed so a future non-theme product cannot collide with one. */
export function themeItemId(themeId: string): string {
  return `theme-${themeId}`
}

/** The theme id behind a shop item id, or `null` if the item is not a theme. */
export function themeIdFromItem(itemId: string): string | null {
  return itemId.startsWith('theme-') ? itemId.slice('theme-'.length) : null
}

/**
 * Whether a theme is available without buying it.
 *
 * The starting theme is free and is deliberately **not** written into `purchases`: a player who
 * has bought nothing still owns it, and recording a purchase that never happened would make
 * `purchases` a lie the first time anything else reads it.
 */
export function isThemeFree(themeId: string): boolean {
  return (THEME_PRICES[themeId] ?? 0) <= 0
}

/** Whether the player may select this theme right now. */
export function ownsTheme(purchases: readonly string[], themeId: string): boolean {
  return isThemeFree(themeId) || purchases.includes(themeItemId(themeId))
}

/**
 * Builds the catalogue in theme-declaration order, **including the free themes**.
 *
 * **⚠ They used to be filtered out, and that made the two free themes unreachable forever.** The
 * reasoning was sound for the shop this list was written for: a row that can never be bought and
 * never be refused is not a product, and it makes one row's "can I afford this?" trivially yes. Then
 * the shop grew `onSelect`/`isSelected` and its rows became a two-state Select / In use control —
 * at which point the list stopped being only a list of purchases and became the only place a theme
 * can be *chosen*. Filtering the free ones out of a selection list means that buying `dusk` takes
 * `day` and `night` away permanently, with no control anywhere that can bring them back.
 *
 * `ownsTheme` has always said the player may select them. This is the list finally agreeing.
 */
/** The tab these rows sit under — an i18n key, see `ShopItem.category`. */
export const THEME_CATEGORY = 'shopTabThemes'

export function buildThemeCatalog(): ShopItem[] {
  return [
    // **First row, and it is not a theme.** `AUTO_THEME_ID` is the absence of an override — the
    // value that lets each level use its own authored light. Without a row for it, buying any theme
    // would be one-way: the player could pick `ice` and never get level identity back, which is the
    // same trap the free themes were in before they were listed. A choice the game can enter and
    // not leave is not a choice.
    {
      id: themeItemId(AUTO_THEME_ID),
      priceCoins: 0,
      titleKey: 'themeAuto',
      icon: '\u{2726}',
      category: THEME_CATEGORY,
      kind: 'unlock' as const,
    },
    // **`day` is deliberately not a row, and this is NOT the free-theme trap above.** That trap was
    // removing the only way *back* to a theme; this removes the second way to the same one. `day` is
    // `DEFAULT_ROAD_THEME`, which is exactly what the `auto` row applies — so listing it put two
    // rows in the panel with one outcome, and only one of them could ever read `In use`. It stays
    // reachable, through that row. **The coupling is real: if `auto` ever stops resolving to
    // `DEFAULT_ROAD_THEME`, this filter is what makes the default theme unreachable.**
    ...themeIds()
      .filter((id) => id !== DEFAULT_ROAD_THEME)
      .map((id) => ({
        id: themeItemId(id),
        priceCoins: THEME_PRICES[id] ?? 0,
        titleKey: `theme_${id}`,
        icon: THEME_ICONS[id] ?? '\u{25C6}',
        category: THEME_CATEGORY,
        kind: 'unlock' as const,
      })),
  ]
}

/**
 * The theme to actually play on, given what the save says and what the player owns.
 *
 * Never trusts the saved id: a save can outlive a theme (renamed, removed, or written by a
 * newer build), and a missing theme must degrade to the default rather than to a blank screen.
 * It also re-checks ownership, so a save edited by hand cannot unlock anything.
 */
export function resolveSelectedTheme(selected: string, purchases: readonly string[]): string {
  return themeOverride(selected, purchases) ?? DEFAULT_ROAD_THEME
}

/**
 * The theme the player has chosen to force, or `null` if they have not chosen one.
 *
 * **The distinction levels made necessary.** A level carries its own authored theme, so the question
 * a scene has to ask is no longer "which theme?" but "has the player *overridden* this level's?".
 * `AUTO_THEME_ID` is the value that says no; anything else is a real choice and wins everywhere.
 *
 * Everything `resolveSelectedTheme` never trusted, this does not trust either: an id that is not a
 * theme, or one the player does not own, is not an override — a save can outlive a theme and can be
 * hand-edited.
 */
export function themeOverride(selected: string, purchases: readonly string[]): string | null {
  if (!themeIds().includes(selected)) return null
  if (!ownsTheme(purchases, selected)) return null

  return selected
}
