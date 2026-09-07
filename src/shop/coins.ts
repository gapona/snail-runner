/**
 * Pure, store-agnostic shop-currency logic — mirrors this template's general "plain
 * functions over primitives, mutate the store at the call site" pattern (see
 * `save/store.ts`'s `mutate()`). Nothing here touches `SaveState` or the store directly, so
 * it's trivially unit-testable and reusable outside a Phaser scene.
 */

/** Whether `coins` covers `price` — a read-only query, for deciding whether to render a buy
 * affordance as enabled without mutating anything. */
export function canAfford(coins: number, price: number): boolean {
  return coins >= price
}

/** New balance after crediting `amount` (floored, never negative — a caller passing a
 * negative/fractional value can't accidentally shrink the balance through this function). */
/**
 * What a lap of the circuit pays, in coins.
 *
 * **Measured on the real placer, and the one anchor the whole economy hangs off.** A lap lays 59
 * coin pickups and pays 45 more in milestones — nine biome arrivals at `MILESTONE_COINS` — for 104.
 * Spelled out rather than computed, because computing it means importing the placer and the circuit
 * into the currency module; `verify:ads` re-measures it and holds this to it, which is what stops
 * it going stale the way the figure it replaced did.
 *
 * **⚠ It said 69 first, from a five-seed mean, and five seeds is not a measurement of this.** A
 * lap's coins swing **34 to 91** with nothing but the seed, so a handful of draws has a standard
 * error worth ten coins and the check could be pushed past its own tolerance by a re-rolled layout
 * with nothing about the game having changed — which is exactly how it was found. Forty laps, the
 * number `verify:formations` already sweeps, puts the mean at 58.9.
 *
 * Everything priced against "what a run pays" reads this rather than repeating the number: the
 * rewarded ad below, and `stages.ts`'s clear bonus. Two constants each citing 114 in a comment is
 * two constants that will disagree.
 */
export const COINS_PER_LAP = 104

/**
 * How much of a run a rewarded ad is worth.
 *
 * The rule, unchanged since the offer existed: **a share of a run, not a round number.** An ad worth
 * a fiftieth of a run is one nobody would trade thirty seconds for; an ad worth more than a run is
 * one that makes playing the slow way to get coins.
 */
export const AD_SHARE_OF_RUN = 0.2

/**
 * What a run is measured in, for the purpose above: laps of the circuit.
 *
 * Two, which is what a player who is doing well covers. It is a stated assumption rather than a
 * measurement — nothing in the game records how far a typical run gets — and it is stated here so
 * the next person to move the reward moves *this* and lets the arithmetic follow.
 */
export const AD_REFERENCE_LAPS = 2

/**
 * What the rewarded ad pays.
 *
 * **⚠ It was 150, and that number belonged to a game this one is a fork of.** Its own docstring
 * anchored it to `coinCapFor` — a per-level coin ceiling in `src/game/levels.ts`, which the fork
 * deleted along with levels — and `verify:levels`, the suite that held it to a fifth of the average
 * cap, went with it. So the constant spent the whole fork unheld by anything, against an economy
 * that had been replaced underneath it: the runner does not bank a capped share of a score, it
 * picks coins up off the road. At 150 one ad was worth **1.3 laps** — more than a whole lap of play
 * for thirty seconds of watching, which is the failure this rule exists to prevent, arrived at by a
 * constant standing still while the game moved.
 *
 * **Computed rather than written down**, so there is no rounded value sitting a little away from
 * its own derivation and no room for the two to drift.
 */
export const REWARDED_TOPUP_COINS = Math.round(AD_SHARE_OF_RUN * AD_REFERENCE_LAPS * COINS_PER_LAP)

export function earnCoins(coins: number, amount: number): number {
  return coins + Math.max(0, Math.floor(amount))
}

/**
 * New balance after spending `price`, or `null` if `coins` doesn't cover it — never
 * partially deducts; there is no intermediate state between "can't afford, balance
 * unchanged" and "affordable, balance now reduced by exactly `price`". Callers should run
 * the whole read-check-write sequence inside one `store.mutate()` call (see `Shop.ts`'s
 * `purchase()`) so no other mutation can interleave between the check and the deduction.
 */
export function spendCoins(coins: number, price: number): number | null {
  if (price < 0 || coins < price) return null
  return coins - price
}

/** Whether `itemId` (an `'unlock'`-kind `ShopItem`'s id) is already in `purchases`. */
export function hasPurchased(purchases: readonly string[], itemId: string): boolean {
  return purchases.includes(itemId)
}
