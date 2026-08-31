/**
 * The other half of the shop's catalogue: what the snail looks like.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:skins`.
 *
 * Built exactly as `themeCatalog.ts` is, and the sameness is the point: both sell a look, both are
 * pure `'unlock'` items whose id is the string that goes into `SaveState.purchases`, and both are
 * `selectable`, so an owned row is a Select / In use control rather than a dead `Owned`. The shop
 * scene learns nothing new for this catalogue to exist.
 *
 * The prices, the hues and the reasoning behind both live in `run/snailSkins.ts`; this file only
 * turns that table into rows.
 */
import { SNAIL_SKINS, skinItemId } from '../run/snailSkins'
import type { ShopItem } from './catalog'

/** The tab these rows sit under — an i18n key, see `ShopItem.category`. */
export const SNAIL_CATEGORY = 'shopTabSnails'

/**
 * The catalogue, in table order — **including the free skin.**
 *
 * `themeCatalog.ts` records why that is not an oversight: a row that can never be bought is not a
 * product, so the first version of *that* list filtered the free themes out — and buying one paid
 * theme then took `day` and `night` away permanently, because the list had quietly stopped being a
 * list of purchases and become the only place a look can be *chosen*. The same trap is one line
 * away here, so the free skin is a row from the start.
 */
export function buildSnailCatalog(): ShopItem[] {
  return SNAIL_SKINS.map((skin) => ({
    id: skinItemId(skin.id),
    priceCoins: skin.priceCoins,
    titleKey: skin.titleKey,
    icon: skin.icon,
    category: SNAIL_CATEGORY,
    kind: 'unlock' as const,
  }))
}
