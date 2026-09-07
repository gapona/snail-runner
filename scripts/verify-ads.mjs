/**
 * The ad catalogue: what this game shows, what it pays, and what it can be had for instead.
 *
 * The suite exists because **this project's oldest ad rule was kept by argument rather than by
 * anything that could fail a build**: "nothing is obtainable only by watching an ad" was a
 * paragraph on each of three offers, in two different scenes, with no list of the three anywhere.
 * A rule enforced in prose is a rule enforced until somebody adds a fourth offer.
 */

import assert from 'node:assert/strict'
import './register-ts-loader.mjs'

const { AD_OFFERS, CONTINUE_COINS, MAX_TOPUPS_PER_SESSION, adOffer, offersOn } = await import(
  '../src/shop/adCatalog.ts'
)
const { AD_REFERENCE_LAPS, AD_SHARE_OF_RUN, REWARDED_TOPUP_COINS } = await import('../src/shop/coins.ts')
const {
  canOfferContinue,
  CONTINUE_SOURCES,
  createAdPolicy,
  noteContinue,
  noteRewarded,
  resetForNewRun,
  rewardedLeft,
  sessionAdPolicy,
} = await import('../src/platform/adPolicy.ts')
const { placeFormations } = await import('../src/run/formations.ts')
const { placeRamps } = await import('../src/run/ramp.ts')
const { placeRunObstacles } = await import('../src/run/obstacles.ts')
const { createRng } = await import('../src/race/rng.ts')
const { buildRunCircuit } = await import('../src/road/circuits.ts')
const { SEGMENT_LENGTH } = await import('../src/road/constants.ts')
const { MILESTONE_COINS } = await import('../src/run/rewards.ts')
const { BIOMES } = await import('../src/road/biomes.ts')
const { skinIdFromItem } = await import('../src/run/snailSkins.ts')
const { themeIdFromItem } = await import('../src/shop/themeCatalog.ts')

const TRACK = buildRunCircuit().length * SEGMENT_LENGTH
/** Several, because one lap is one sample of a seeded placer and the spread is real (48 to 86). */
// ⚠ Forty, and it was five. A lap's coins swing 34..91 on the seed alone, so a five-seed mean
// carries a standard error worth ten coins — enough for a re-rolled layout to push the shipped
// constant out of this check's own tolerance with nothing about the game having changed. The same
// sweep `verify:formations` uses, for the same reason.
const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 97)

/**
 * How many coins a lap lays, from the real placer.
 *
 * **A price has to be anchored to what a run pays, and in this game that is not a constant.** The
 * rail shooter banked `score / rate` against a per-level cap; the runner picks coins up off the
 * road one at a time, so the only honest figure is what the placer actually deals — measured here
 * the same way `verify:quests` measures its own per-lap table, and for the same reason: a re-tuned
 * chain length would otherwise move the economy with nothing able to say so.
 */
function coinsPerLap(seed) {
  const obstacles = placeRunObstacles(seed, TRACK, TRACK * 3)
  const ramps = placeRamps(7, TRACK, 0, obstacles)
  const pickups = placeFormations({
    rng: createRng(seed + 1),
    fromZ: 0,
    toZ: TRACK,
    trackLength: TRACK,
    obstacles,
    launches: ramps,
  })

  return pickups.filter((pickup) => pickup.kind === 'coin').length
}

let checks = 0
const check = (name, fn) => {
  fn()
  checks++
  console.log(`  ok  ${name}`)
}

console.log('ad catalogue')

// ---------------------------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------------------------

check('every offer has either a coin price or a stated reason it cannot', () => {
  for (const offer of AD_OFFERS) {
    const priced = offer.priceCoins !== null
    const excused = typeof offer.freeReason === 'string' && offer.freeReason.length > 0

    assert.ok(
      priced !== excused,
      `${offer.id}: exactly one of priceCoins and freeReason must be set (priced=${priced}, excused=${excused})`,
    )
  }
  console.log(
    `      ${AD_OFFERS.filter((o) => o.priceCoins !== null).length} priced, ` +
      `${AD_OFFERS.filter((o) => o.freeReason).length} excused, of ${AD_OFFERS.length}`,
  )
})

check('the check rejects an offer with neither, and one with both', () => {
  // The negative control this project insists on: a threshold that has never rejected anything is
  // not a threshold, and the same is true of a rule.
  const neither = { id: 'x', priceCoins: null }
  const both = { id: 'y', priceCoins: 10, freeReason: 'because' }
  const legal = (offer) =>
    (offer.priceCoins !== null) !== (typeof offer.freeReason === 'string' && offer.freeReason.length > 0)

  assert.equal(legal(neither), false)
  assert.equal(legal(both), false)
  assert.equal(legal({ id: 'z', priceCoins: 150 }), true)
  assert.equal(legal({ id: 'w', priceCoins: null, freeReason: 'coins are what a run pays' }), true)
})

check('the continue is the priced one, and its price is what an ad pays', () => {
  const offer = adOffer('run-continue')

  assert.equal(offer.priceCoins, CONTINUE_COINS)
  // Derived, not picked: watching an ad for coins and spending them on the continue has to be the
  // same transaction as watching an ad for the continue, or one door is strictly better.
  assert.equal(CONTINUE_COINS, REWARDED_TOPUP_COINS)
  console.log(`      continue ${CONTINUE_COINS} coins = one ad's ${REWARDED_TOPUP_COINS}`)
})

check('the ad reward is the share of a run it says it is', () => {
  // **⚠ The constant this replaces was anchored to a function the fork deleted.** It read
  // `coinCapFor`, a per-level coin ceiling from `src/game/levels.ts`, and the suite that held it to
  // a fifth of the average cap went with levels — so it spent the whole fork unheld, against an
  // economy that had been replaced underneath it. This is that anchor rebuilt against what the
  // runner actually pays, so it cannot go stale a second time.
  const laps = SEEDS.map(coinsPerLap)
  const pickups = laps.reduce((sum, n) => sum + n, 0) / laps.length
  const milestones = BIOMES.length * MILESTONE_COINS
  const perLap = pickups + milestones
  const derived = AD_SHARE_OF_RUN * AD_REFERENCE_LAPS * perLap

  console.log(
    `      a lap lays ${laps.join('/')} coins (mean ${pickups.toFixed(0)}) + ${milestones} in ` +
      `milestones = ${perLap.toFixed(0)}; ${AD_SHARE_OF_RUN} x ${AD_REFERENCE_LAPS} laps = ` +
      `${derived.toFixed(0)}, shipped ${REWARDED_TOPUP_COINS}`,
  )
  // Within a coin or two of the derivation — a rounded value, not a free one.
  assert.ok(
    Math.abs(REWARDED_TOPUP_COINS - derived) <= 3,
    `${REWARDED_TOPUP_COINS} against a derived ${derived.toFixed(1)}`,
  )
  // And the control: the value it replaced is now shown to fail, so the check is measuring
  // something rather than agreeing with whatever is in the file.
  assert.ok(Math.abs(150 - derived) > 3, 'the old 150 must not pass this')
  console.log(`      the fork-inherited 150 was ${(150 / perLap).toFixed(1)} laps and is rejected`)
})

check('a continue costs a share of a lap, not more than one', () => {
  // **Otherwise the alternative is not one.** A price above what a lap can pay means the only real
  // route to a continue is the ad, which is the rule broken through the back door — and a price far
  // under it means the coin door is strictly better and the ad is the thing nobody takes.
  // ⚠ Against what a lap PAYS, which is its pickups plus its milestones -- the same quantity the
  // derivation above uses. This compared the price to the coin pickups alone, so it was asking the
  // continue to be affordable out of part of a lap while calling it a lap; the leanest lap lays 31
  // pickups and pays 76.
  const milestones = BIOMES.length * MILESTONE_COINS
  const laps = SEEDS.map((seed) => coinsPerLap(seed) + milestones)
  const mean = laps.reduce((sum, n) => sum + n, 0) / laps.length
  const worst = Math.min(...laps)
  const share = CONTINUE_COINS / mean

  assert.ok(CONTINUE_COINS < worst, `continue ${CONTINUE_COINS} against the leanest lap's ${worst}`)
  assert.ok(share > 0.1 && share < 0.9, `continue is ${(share * 100).toFixed(0)}% of a lap`)
  console.log(
    `      the leanest of ${laps.length} laps pays ${worst} coins, the mean ${mean.toFixed(0)}; ` +
      `continue ${CONTINUE_COINS} = ${(share * 100).toFixed(0)}% of one, under the leanest`,
  )
})

// ---------------------------------------------------------------------------------------------
// The limits
// ---------------------------------------------------------------------------------------------

check('a limited offer runs out, and the count is what says so', () => {
  const state = createAdPolicy()
  const offer = adOffer('coins-topup')
  const seen = []

  for (let i = 0; i < offer.perSession + 2; i++) {
    seen.push(rewardedLeft(state, offer.id, offer.perSession))
    if (rewardedLeft(state, offer.id, offer.perSession) > 0) noteRewarded(state, offer.id)
  }

  assert.deepEqual(seen, [MAX_TOPUPS_PER_SESSION, 2, 1, 0, 0])
  assert.equal(rewardedLeft(state, offer.id, offer.perSession), 0)
})

check('an unlimited offer never runs out', () => {
  const state = createAdPolicy()

  for (const offer of AD_OFFERS.filter((candidate) => candidate.perSession === null)) {
    for (let i = 0; i < 50; i++) noteRewarded(state, offer.id)
    assert.equal(rewardedLeft(state, offer.id, offer.perSession), Number.POSITIVE_INFINITY)
  }
})

check('one offer running out does not spend another', () => {
  const state = createAdPolicy()

  for (let i = 0; i < 10; i++) noteRewarded(state, 'coins-topup')
  assert.equal(rewardedLeft(state, 'coins-double', 3), 3)
})

check('each continue is once per run and survives into the next one', () => {
  for (const source of CONTINUE_SOURCES) {
    const state = createAdPolicy()

    assert.equal(canOfferContinue(state, true, source), true)
    noteContinue(state, source)
    assert.equal(canOfferContinue(state, false, source), false)
    assert.equal(canOfferContinue(state, true, source), false)
    resetForNewRun(state)
    assert.equal(canOfferContinue(state, true, source), true)
    // A cleared run is never offered one — an ad with nothing attached to it.
    assert.equal(canOfferContinue(state, false, source), false)
  }
})

check('⚠ taking one continue does not close the other', () => {
  // **The two doors used to share a flag, so each closed the other**: paying in coins spent the
  // run's continue and the next death offered neither the ad nor the price — reported as exactly
  // that. What makes an alternative real is that it is still there after the offer beside it has
  // been taken.
  for (const taken of CONTINUE_SOURCES) {
    const other = CONTINUE_SOURCES.find((source) => source !== taken)
    const state = createAdPolicy()

    noteContinue(state, taken)
    assert.equal(canOfferContinue(state, true, taken), false, `${taken} can be taken twice in one run`)
    assert.equal(canOfferContinue(state, true, other), true, `taking the ${taken} continue closed the ${other} one`)
  }

  // **The control is the arrangement that shipped**: one flag for both, which closes the other door
  // every time. Written as the shared-flag rule rather than pointed at a deleted field, so it keeps
  // measuring something if the state's shape changes again.
  const shared = { used: false }
  const sharedCanOffer = () => !shared.used

  shared.used = true
  assert.equal(sharedCanOffer(), false, 'the control does not close the other door, i.e. this measures nothing')
  // And neither can be taken twice, which is the limit the split had to keep.
  const both = createAdPolicy()

  for (const source of CONTINUE_SOURCES) noteContinue(both, source)
  for (const source of CONTINUE_SOURCES) assert.equal(canOfferContinue(both, true, source), false)
  console.log(`      a run offers ${CONTINUE_SOURCES.length} continues, one each: ${CONTINUE_SOURCES.join(' and ')}`)
})

check('the session budget survives a new run, and the per-run half does not', () => {
  const state = createAdPolicy()

  noteRewarded(state, 'coins-topup')
  for (const source of CONTINUE_SOURCES) noteContinue(state, source)
  resetForNewRun(state)

  for (const source of CONTINUE_SOURCES) {
    assert.equal(state.continuesUsed[source], false, `the run half does not reset ${source}`)
  }
  assert.equal(rewardedLeft(state, 'coins-topup', MAX_TOPUPS_PER_SESSION), MAX_TOPUPS_PER_SESSION - 1)
})

check('there is exactly one session budget', () => {
  // **⚠ There were two for about ten minutes.** `RunOver` has held a `static` policy since
  // interstitials landed, and the shop's new per-offer counter was written as a second `static`
  // beside it — two budgets for one session, with nothing able to say they were meant to be one
  // thing. Asserted by identity rather than by reading either scene, which is the only form of this
  // that a scene cannot quietly opt out of.
  assert.equal(sessionAdPolicy(), sessionAdPolicy())
  const state = sessionAdPolicy()

  noteRewarded(state, 'probe')
  assert.equal(sessionAdPolicy().rewardedTaken.probe, 1)
  delete sessionAdPolicy().rewardedTaken.probe
})

// ---------------------------------------------------------------------------------------------
// The ids and the surfaces
// ---------------------------------------------------------------------------------------------

check('reward ids are distinct, and are not any other id space', () => {
  const ids = AD_OFFERS.map((offer) => offer.id)

  assert.equal(new Set(ids).size, ids.length, 'reward ids are distinct')
  for (const id of ids) {
    assert.equal(skinIdFromItem(id), null, `${id} must not parse as a snail id`)
    assert.equal(themeIdFromItem(id), null, `${id} must not parse as a theme id`)
  }
})

check('every offer names a surface, and both surfaces carry one', () => {
  for (const offer of AD_OFFERS) {
    assert.ok(offer.surface === 'shop' || offer.surface === 'result', `${offer.id}: ${offer.surface}`)
    assert.ok(offer.titleKey.length > 0 && offer.icon.length > 0, `${offer.id} has a name and an icon`)
  }
  assert.ok(offersOn('shop').length > 0, 'the shop shows at least one')
  assert.ok(offersOn('result').length > 0, 'the result screen shows at least one')
  console.log(
    `      shop: ${offersOn('shop').map((o) => o.id).join(', ')} | ` +
      `result: ${offersOn('result').map((o) => o.id).join(', ')}`,
  )
})

check('asking for an offer that does not exist throws rather than returning nothing', () => {
  // A silent `undefined` here is a button drawn with no label and no reward id, which the SDK
  // would happily be handed.
  assert.throws(() => adOffer('nope'))
})

// ---------------------------------------------------------------------------------------------
// The table, printed
// ---------------------------------------------------------------------------------------------

console.log('\n  offer          surface  per session  coins  alternative')
for (const offer of AD_OFFERS) {
  const limit = offer.perSession === null ? 'per run' : String(offer.perSession)
  const price = offer.priceCoins === null ? '—' : String(offer.priceCoins)

  console.log(
    `  ${offer.id.padEnd(14)} ${offer.surface.padEnd(8)} ${limit.padEnd(12)} ${price.padEnd(6)} ` +
      (offer.freeReason ?? 'buy it'),
  )
}

console.log(`\nverify:ads — ${checks} checks passed`)
