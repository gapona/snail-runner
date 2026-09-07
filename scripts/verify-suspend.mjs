#!/usr/bin/env node
// Putting a run down and picking it up — `src/run/suspend.ts` and the layout cursor it resumes.
//
// **The failure to be afraid of is not "the run does not come back".** That one is loud: the player
// presses Continue and lands on the start line, and they say so. The quiet ones are a snapshot that
// comes back *slightly* wrong — a resumed run whose first frame resolves every obstacle on the lap,
// a stored `Infinity` that reaches the camera as `NaN` and blanks the frame, a coin banked twice —
// and every one of those is a number nobody would look at.
import assert from 'node:assert/strict'
import { createRunState, takeHit } from '../src/run/runState.ts'
import { createPlayerState } from '../src/run/playerMotion.ts'
import { isResumable, resolveSuspended } from '../src/run/suspend.ts'
import { LapLayout } from '../src/run/lapLayout.ts'
import { createTally, QUEST_KINDS } from '../src/run/quests.ts'
import { FEVER_PHASES } from '../src/run/fever.ts'
import { MAX_SHIELDS, RUN_LIVES, SPEED_BASE } from '../src/run/constants.ts'
import { SEGMENT_LENGTH } from '../src/road/constants.ts'
import { migrate } from '../src/save/migrate.ts'
import { DEFAULT_SAVE_STATE, SAVE_SCHEMA_VERSION } from '../src/save/types.ts'

let passed = 0

function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/** A plausible run in progress: three laps in, mid-air, with a shield and a partly full gauge. */
function midRun() {
  return {
    seed: 4242,
    run: {
      ...createRunState(),
      z: 91_000,
      distance: 913_400,
      speed: 3210,
      ticks: 40_000,
      stepRemainderMs: 4.2,
      lives: 2,
      shields: 1,
      coins: 187,
      bonus: 940,
      tally: { ...createTally(), fruit: 6, nearMiss: 11 },
      fever: { fruit: 5, phase: 'idle', msRemaining: 0 },
    },
    player: { ...createPlayerState(), offsetX: 0.42, vx: -0.9, y: 180, vy: 260, grounded: false },
    bankedCoins: 187,
    invulnerableUntilDistance: 913_800,
  }
}

/** What the save actually stores it as — the round trip is where `Infinity` becomes `null`. */
function stored(snapshot) {
  return JSON.parse(JSON.stringify(snapshot))
}

console.log('a run survives being put down')

check('a mid-run snapshot comes back field for field through JSON', () => {
  const before = midRun()
  const after = resolveSuspended(stored(before))

  assert.notEqual(after, null, 'a plausible run was refused')
  // **Every field, not a sample.** A resolver that quietly dropped one would leave a run that is
  // *nearly* the one the player put down, and "nearly" is a thing nobody reports and everybody
  // feels — the wrong speed, the wrong gauge, one life short.
  for (const key of ['z', 'distance', 'speed', 'ticks', 'stepRemainderMs', 'lives', 'shields', 'coins', 'bonus']) {
    assert.equal(after.run[key], before.run[key], `run.${key} did not survive the round trip`)
  }
  for (const kind of QUEST_KINDS) {
    assert.equal(after.run.tally[kind], before.run.tally[kind], `the ${kind} tally did not survive`)
  }
  for (const key of ['offsetX', 'vx', 'y', 'vy', 'grounded', 'flightV0', 'flightSpins', 'airControl']) {
    assert.equal(after.player[key], before.player[key], `player.${key} did not survive the round trip`)
  }
  assert.equal(after.seed, before.seed, 'the seed did not survive, so the road would not')
  assert.equal(after.bankedCoins, before.bankedCoins, 'what was already banked did not survive')
  assert.deepEqual(after.run.fever, before.run.fever, 'the fruit gauge did not survive')
  console.log(`    ${before.run.distance / 100}m, ${before.run.lives} lives, ${before.run.coins} coins, mid-flight at y ${before.player.y}`)
})

check('⚠ a run that is over, or has not started, is not offered', () => {
  // **A run that is over is finished, not suspended**, and one that has travelled nothing is what
  // Play already does — a Continue button that puts the player on the start line is a Continue
  // button that lied.
  const dead = midRun()
  let run = dead.run

  for (let i = 0; i < RUN_LIVES + 2; i++) run = takeHit(run)

  assert.equal(run.over, true, 'the fixture did not actually kill the run')
  assert.equal(resolveSuspended(stored({ ...dead, run })), null, 'a dead run was offered as resumable')

  const fresh = { ...midRun(), run: createRunState() }

  assert.equal(resolveSuspended(stored(fresh)), null, 'a run at the start line was offered as resumable')
  assert.equal(isResumable(null), false, 'nothing stored is somehow resumable')
  assert.equal(resolveSuspended(null), null, 'a null snapshot is not a run')
  assert.equal(resolveSuspended('stage-3'), null, 'a string is not a run')
  assert.equal(resolveSuspended({}), null, 'an empty object is not a run')
})

check('⚠ Infinity and NaN come back as null, and neither reaches the camera', () => {
  // **This is the one corruption the save layer produces by itself.** `JSON.stringify` turns both
  // into `null`, so a field that was either arrives as a *type* error rather than as a bad number —
  // and a `NaN` reaching `stepRun` puts the camera at `NaN` and blanks the frame with nothing in
  // the console to say why. The near-miss streak used to carry a `-Infinity`, which is exactly how
  // this was found before it could ship.
  const poisoned = midRun()

  poisoned.run.speed = Infinity
  poisoned.player.vx = NaN
  poisoned.run.bonus = -Infinity

  const raw = stored(poisoned)

  assert.equal(raw.run.speed, null, 'JSON did not do the thing this check exists for')

  const after = resolveSuspended(raw)

  assert.notEqual(after, null, 'a run with one poisoned field was thrown away rather than repaired')
  for (const value of [after.run.speed, after.run.bonus, after.player.vx, after.run.z, after.run.distance]) {
    assert.ok(Number.isFinite(value), 'a non-finite number survived the resolver')
  }
  assert.equal(after.run.speed, SPEED_BASE, 'a poisoned speed did not fall back to the starting speed')

  // A poisoned *distance* is the one that cannot be repaired: it is what says the run happened.
  const noDistance = stored(midRun())

  noDistance.run.distance = Infinity
  assert.equal(resolveSuspended(noDistance), null, 'a run with no usable distance was offered anyway')
})

check('⚠ a hand-edited payload cannot produce a state the run could not draw', () => {
  const cheated = stored(midRun())

  cheated.run.lives = 99
  cheated.run.shields = 99
  cheated.run.coins = -500
  cheated.run.fever.phase = 'invincible'
  cheated.player.offsetX = 400
  cheated.player.airControl = 12

  const after = resolveSuspended(cheated)

  assert.equal(after.run.lives, RUN_LIVES, `lives came back as ${after.run.lives}`)
  assert.equal(after.run.shields, MAX_SHIELDS, `shields came back as ${after.run.shields}`)
  assert.equal(after.run.coins, 0, `a negative purse came back as ${after.run.coins}`)
  assert.ok(FEVER_PHASES.includes(after.run.fever.phase), `the fever phase came back as ${after.run.fever.phase}`)
  assert.ok(Math.abs(after.player.offsetX) <= 2, `the snail came back ${after.player.offsetX} half-widths off the road`)
  assert.ok(after.player.airControl <= 1, `air control came back at ${after.player.airControl}`)
  assert.equal(after.run.over, false, 'a resumed run is never restored as over')
})

console.log('\nthe road comes back with it')

check('⚠ the layout cursor starts on the run lap, not at the start line', () => {
  // **The whole reason `startLap` exists.** A resumed run is handed to a layout built at lap 0, and
  // the first `advance` would walk every segment of every lap in between — calling `build` once per
  // lap boundary on the way. That is tens of layout generations inside one `create`, for road
  // nobody will ever see.
  const trackLength = 1434 * SEGMENT_LENGTH
  const segmentCount = 1434
  const distance = 3.4 * trackLength
  const built = []
  const options = {
    trackLength,
    segmentCount,
    build: (lapOffset) => {
      built.push(lapOffset)

      return { obstacles: [], pickups: [], ramps: [] }
    },
  }

  const resumed = new LapLayout({ ...options, startLap: Math.floor(distance / trackLength) })
  const atStart = built.length

  resumed.advance(distance)

  const resumedBuilds = built.length
  const walked = resumed.handedOver

  built.length = 0

  const fromZero = new LapLayout(options)

  fromZero.advance(distance)

  assert.equal(atStart, 2, `a resumed layout built ${atStart} laps up front rather than this lap and the next`)
  assert.ok(
    resumedBuilds < built.length,
    `resuming built ${resumedBuilds} laps against ${built.length} from the start line, i.e. startLap does nothing`,
  )
  assert.ok(walked <= segmentCount + 2, `the cursor walked ${walked} segments to catch up, i.e. more than one lap`)
  console.log(`    lap 3 of a ${segmentCount}-segment track: ${resumedBuilds} builds and ${walked} segments walked, against ${built.length} builds and ${fromZero.handedOver} from the start line`)
})

check('the ground a resumed run stands on is the same road the seed laid', () => {
  // The snapshot carries no road at all — the point being that it does not have to. Two layouts
  // built from one seed have to be the same layout, or resuming would put the player on a lap they
  // were never running.
  const trackLength = 1434 * SEGMENT_LENGTH
  const lay = (lapOffset) => ({
    obstacles: [{ id: lapOffset + 1, z: lapOffset % trackLength, offsetX: 0.2, halfWidth: 0.1, yLow: 0, yHigh: 200 }],
    pickups: [],
    ramps: [],
  })
  const options = { trackLength, segmentCount: 1434, build: lay }
  const a = new LapLayout({ ...options, startLap: 3 })
  const b = new LapLayout({ ...options, startLap: 3 })

  assert.deepEqual([...a.obstacles.keys()], [...b.obstacles.keys()], 'one seed produced two different laps')
})

console.log('\nthe save carries it')

check('v16 drops the stage fields and adds the snapshot, and an older save still loads', () => {
  assert.equal(SAVE_SCHEMA_VERSION, 16, 'the schema version moved without this check moving with it')
  assert.equal(DEFAULT_SAVE_STATE.suspendedRun, null, 'a new save starts with something to continue')

  // A v15 payload, with the two fields the stage mode owned and a purse worth keeping.
  const old = {
    v: 15,
    coins: 730,
    purchases: ['theme-night'],
    stagesCleared: ['stage-1', 'stage-2'],
    runMode: 'stage-3',
    tutorialDone: true,
    bestScore: 1549,
  }
  const migrated = migrate(old)

  assert.notEqual(migrated, null, 'a v15 save no longer loads')
  assert.equal(migrated.v, 16, `the migrated save is v${migrated.v}`)
  assert.equal(migrated.coins, 730, 'the purse did not survive the migration')
  assert.equal(migrated.bestScore, 1549, 'the record did not survive the migration')
  assert.deepEqual(migrated.purchases, ['theme-night'], 'the purchases did not survive the migration')
  // **The two old keys are not read and are not deleted.** Deleting is the one migration operation
  // that cannot be undone, and an unknown key costs nothing — see `upgradeV15ToV16`.
  assert.equal(migrated.suspendedRun, null, 'an upgraded save arrived with something to continue')
  assert.equal(Object.hasOwn(migrated, 'runMode'), false, 'the normaliser still writes a mode nothing reads')

  // And a v16 save carrying a real snapshot keeps it, still as an opaque value — validating it is
  // `resolveSuspended`'s job, which is the same split the quest board is under.
  const withRun = migrate({ ...old, v: 16, suspendedRun: stored(midRun()) })

  assert.notEqual(withRun.suspendedRun, null, 'a stored run was dropped by the normaliser')
  assert.notEqual(resolveSuspended(withRun.suspendedRun), null, 'a stored run did not survive to the resolver')

  // Junk in that slot is refused rather than crashing anything.
  assert.equal(migrate({ ...old, v: 16, suspendedRun: 'stage-3' }).suspendedRun, null, 'a string survived as a run')
})

console.log(`\n${passed} checks passed`)
