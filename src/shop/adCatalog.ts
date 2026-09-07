import { REWARDED_TOPUP_COINS } from './coins'

/**
 * Every rewarded ad this game shows, as a product list.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:ads`.
 *
 * ## ⚠ There were three offers and no list of them
 *
 * A rewarded top-up lived as a button in the shop's chrome, a coin doubler and a continue as two
 * buttons on the result screen, and each carried its own reward figure, its own reward id and its
 * own idea of how often it could be taken. Nothing anywhere could answer *what ads does this game
 * show and what do they pay* — which is a question the player has an obvious interest in, and one a
 * certification reviewer asks directly.
 *
 * Presenting them as products is the fix for both halves at once. A list is enumerable, so the
 * offers can be shown with what they give and what is left of them; and it is one table, so the
 * numbers stop being scattered across two scenes.
 *
 * ## The rule, made mechanical
 *
 * This project's standing rule is that **nothing is obtainable only by watching an ad**. It was
 * kept by argument — each of the three offers had a paragraph explaining its alternative — and an
 * argument in a docstring is not a thing a check can hold. Every offer now carries either a
 * `priceCoins`, or a `freeReason` saying why it cannot have one, and `verify:ads` asserts that
 * exactly one of the two is present. An offer added later with neither fails the build.
 *
 * **And writing that down cost the continue a coin price it should always have had.** Its stated
 * alternative was the `Again` button, which is honest as far as it goes — a player who never
 * watches one is never blocked, only sooner back at the start line — and it is not an *alternative
 * way to get the thing*, which is what the rule is about. It has one now, and the price is derived
 * rather than picked: see `CONTINUE_COINS`.
 */

export type AdOfferId = 'coins-topup' | 'coins-double' | 'run-continue'

/** Where an offer can be taken from — which is not the same question as what it gives. */
export type AdOfferSurface = 'shop' | 'result'

export interface AdOffer {
  /**
   * The reward id handed to the SDK, and the row's own key.
   *
   * **Stable, and a distinct id space from `purchases`.** The SDK treats each reward id as an
   * independent placement, so renaming one silently orphans whatever the platform has learned about
   * it. `verify:ads` asserts none of these can be parsed as a weapon, theme, snail or slot id.
   */
  id: AdOfferId
  icon: string
  /** i18n key for what the offer gives, resolved through `t()` at the call site. */
  titleKey: string
  surface: AdOfferSurface
  /**
   * How many times a session may take it.
   *
   * **⚠ The top-up had no limit at all**, so a player could sit in the shop and watch ads until they
   * owned the catalogue — which is bad for the player (an hour of ads is not a game) and bad for the
   * economy (every price in the shop is set against what a *run* pays). A count per session rather
   * than per run, because the shop is not inside a run.
   *
   * `null` means the limit is not this table's to keep: the two result-screen offers are once per
   * *run*, which `adPolicy.ts` already tracks against the run's own lifecycle.
   */
  perSession: number | null
  /**
   * What the same thing costs in coins, or `null` when it cannot be bought at all.
   *
   * Exactly one of this and `freeReason` is set, asserted.
   */
  priceCoins: number | null
  /**
   * Why this offer has no coin price — prose, and load-bearing.
   *
   * Not documentation of an omission: it is the escape from the rule above, and the check requires
   * it, so an offer with no alternative and no reason cannot ship quietly.
   */
  freeReason?: string
}

/**
 * What a continue costs in coins.
 *
 * **Derived from what an ad pays, not chosen.** A player can already watch one ad and be handed
 * `REWARDED_TOPUP_COINS`; pricing the continue at exactly that makes "watch an ad for the continue"
 * and "watch an ad for coins and spend them on the continue" the same transaction, which is the only
 * price at which the two doors into the same room cost the same. Any other number makes one of the
 * two strictly better and turns the choice into arithmetic.
 */
export const CONTINUE_COINS = REWARDED_TOPUP_COINS

/**
 * How many coin top-ups a session may take.
 *
 * Three, the same number as `MAX_INTERSTITIALS_PER_SESSION` and for the same reason: past about
 * that many, a session stops being a game with ads in it. It is stated here rather than shared with
 * that constant because the two limits are independent — an interstitial is something the game does
 * to the player and a rewarded ad is something the player asks for, and they should be able to move
 * apart without anybody having to notice they were once equal.
 */
export const MAX_TOPUPS_PER_SESSION = 3

export const AD_OFFERS: readonly AdOffer[] = [
  {
    id: 'coins-topup',
    icon: '🪙',
    titleKey: 'adTopup',
    surface: 'shop',
    perSession: MAX_TOPUPS_PER_SESSION,
    priceCoins: null,
    // Paying coins for coins is not a product, it is arithmetic. What makes this legal under the
    // rule is that the coins themselves are not ad-only: a lap of the circuit lays 69 of them and
    // pays 45 more in milestones, measured — so the ad is a shortcut past a wait and never past a
    // wall, and it is worth well under a lap by construction (see `REWARDED_TOPUP_COINS`).
    freeReason: 'coins are what a run pays; this is a shortcut, not the only door',
  },
  {
    id: 'coins-double',
    icon: '🎬',
    titleKey: 'adDouble',
    surface: 'result',
    // Once per run, and the run's own policy is what knows that.
    perSession: null,
    priceCoins: null,
    // The coins were banked before this button existed and this doubles them, so a coin price would
    // be selling coins for coins at a rate — the same non-product as above wearing a multiplier.
    freeReason: 'doubles coins already banked; a coin price would be buying coins with coins',
  },
  {
    id: 'run-continue',
    icon: '❤️',
    titleKey: 'adContinue',
    surface: 'result',
    perSession: null,
    priceCoins: CONTINUE_COINS,
  },
]

export function adOffer(id: AdOfferId): AdOffer {
  const offer = AD_OFFERS.find((candidate) => candidate.id === id)

  if (offer === undefined) throw new Error(`unknown ad offer: ${id}`)

  return offer
}

/** The offers a given screen may show, in table order. */
export function offersOn(surface: AdOfferSurface): readonly AdOffer[] {
  return AD_OFFERS.filter((offer) => offer.surface === surface)
}
