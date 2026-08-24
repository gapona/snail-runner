/**
 * The shop's product list is entirely game-defined — this template ships the TYPE and a
 * simple registration mechanism (`setCatalog`/`getCatalog`), no actual items. A game calls
 * `setCatalog([...])` once (e.g. from `main.ts`, alongside `ui/theme.ts`'s `setTheme()`)
 * before `Shop` is ever opened; `scenes/Shop.ts` reads `getCatalog()` at `create()` time. See
 * CLAUDE.md "Shop Layer".
 */

export type ShopItemKind = 'consumable' | 'unlock'

export interface ShopItem {
  /** Stable id — for `'unlock'`-kind items this is also the key stored in
   * `SaveState.purchases` (`save/types.ts`), so it must never change once shipped. */
  id: string
  priceCoins: number
  /** An i18n key (see `i18n/strings.ts`'s `tOptional()`) for the item's display name — not
   * required to have a dictionary entry; `Shop.ts` falls back to a title-cased `id` for any
   * key with no match, the same "dynamic content, optional translation" convention other
   * generated display-name lookups in this kind of project use. */
  titleKey: string
  icon: string
  /**
   * Extra words after the translated title, already in their final form.
   *
   * For something whose name is a name plus a *number* — a weapon and which of its three upgrade
   * steps this row is — where the number is the same in every language and so has no business in
   * a dictionary. `undefined` for an item whose title is just its title.
   */
  titleSuffix?: string
  /**
   * An i18n key for a few words saying what the item *does*, drawn after the title.
   *
   * For a catalogue whose rows are not self-explanatory from their name - a numbered upgrade step
   * whose effect differs per weapon is the case this exists for. Resolved through `tOptional()`
   * and simply omitted on a miss, so a catalogue can ship a key before its translation.
   */
  detailKey?: string
  /**
   * Which tab this item sits under — itself an i18n key, resolved through `tOptional()` with a
   * title-cased fallback, exactly as `titleKey` is.
   *
   * Optional, and a catalogue that sets it on nothing renders exactly as it did before tabs
   * existed: `Shop.ts` only draws the strip when there is more than one group. Grouping is by
   * first appearance in the catalogue, so the tab order is the order the game registered its
   * items in rather than anything the shop decides.
   */
  category?: string
  /**
   * Another item's id that must be owned before this one may be bought.
   *
   * A generic prerequisite rather than an upgrade-shaped one: the shop knows only that some rows
   * are not yet reachable, and the game says which. A row whose prerequisite is unmet renders
   * locked and refuses the tap — checked in `Shop.purchase()` as well as in the row's state,
   * because a state is a picture and a purchase is a debit.
   */
  requires?: string
  /**
   * Whether owning this item is a *choice* — i.e. whether tapping an owned row means anything.
   *
   * Defaults to true, which is right for a theme or a weapon: both are things the player picks
   * between. An upgrade is not; it applies the moment it is bought, so its owned row says `Owned`
   * and does nothing rather than offering a `Select` that cannot select.
   */
  selectable?: boolean
  /** `'consumable'` — repeatable; `Shop.ts` calls the purchaser's `onPurchase` callback and
   * the game applies whatever effect it wants (grant a hint, extend time, ...); the shop
   * itself only ever debits coins, it has no idea what a consumable "does". `'unlock'` — a
   * one-time buy; its id is pushed into `SaveState.purchases` and the row switches to an
   * "Owned" state instead of being purchasable again. */
  kind: ShopItemKind
}

let catalog: ShopItem[] = []

/** Registers the game's product list, replacing whatever was set before. */
export function setCatalog(items: ShopItem[]): void {
  catalog = items
}

/** The active catalog — `[]` until a game calls `setCatalog()`. */
export function getCatalog(): readonly ShopItem[] {
  return catalog
}
