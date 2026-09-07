#!/usr/bin/env node
// Logic check for src/run/quests.ts -- what a run is asked to go and do, and what finishing it is
// worth. Imports no phaser, which is what makes it runnable here.
//
// The two things this suite exists to hold, and neither is about the arithmetic:
//   * a quest names a consequence of a DECISION, never of time -- the same rule the scoring ladder
//     is under, and the reason "travel 500m" is not on the board;
//   * every target is a share of what a lap ACTUALLY offers, re-derived from the real placers, so
//     "finishable in a run or two" cannot quietly stop being true when a placer is re-tuned.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyTally,
  claimQuest,
  createQuestBoard,
  createTally,
  dealQuest,
  isQuestComplete,
  PER_LAP,
  QUEST_COIN_RATE,
  QUEST_KINDS,
  QUEST_SHARE,
  QUEST_SLOTS,
  questProgress,
  questReward,
  questTarget,
  resolveQuestBoard,
} from '../src/run/quests.ts'
import { placeFormations } from '../src/run/formations.ts'
import { placeRamps } from '../src/run/ramp.ts'
import { placeRunObstacles } from '../src/run/obstacles.ts'
import { createRng } from '../src/race/rng.ts'
import { buildRunCircuit } from '../src/road/circuits.ts'
import { SEGMENT_LENGTH } from '../src/road/constants.ts'
import { FEVER_FRUIT_TARGET } from '../src/run/constants.ts'

const TRACK = buildRunCircuit().length * SEGMENT_LENGTH

let passed = 0

function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('quests -- what a run is for')

check('every target is a share of what a lap actually offers', () => {
  // **⚠ This is the check that keeps "one or two runs" true.** The targets are not literals; they
  // are `QUEST_SHARE` of what the placers lay, and the placers move. If a re-tuned difficulty curve
  // halves the fruit on a lap, a literal target would silently become a two-lap grind and nothing
  // would say so.
  // ⚠ **Swept over seeds, because one lap is one draw from a wide distribution.** This measured a
  // single seed and the table was written from it — and a lap's ramps swing 4..8 across seeds while
  // its fruit swings 11..35, so the two figures it produced (7 and 19) were both unlucky draws and
  // the check could be pushed past its own 35% tolerance by nothing but a re-rolled layout. The
  // quantity `PER_LAP` claims to hold is what a lap *offers*, which is a mean and not a sample --
  // the same correction `verify:formations` already records for its own forty-seed sweep.
  const SEEDS = 40
  let rampTotal = 0
  let fruitTotal = 0
  const rampDraws = []
  const fruitDraws = []

  for (let i = 1; i <= SEEDS; i++) {
    const obstacles = placeRunObstacles(4242 + i, TRACK, TRACK * 3)
    const ramps = placeRamps(7 + i, TRACK, 0, obstacles)
    const pickups = placeFormations({
      rng: createRng(11 + i),
      fromZ: 0,
      toZ: TRACK,
      trackLength: TRACK,
      obstacles,
      launches: ramps,
    })

    rampTotal += ramps.length
    rampDraws.push(ramps.length)
    fruitTotal += pickups.filter((pickup) => pickup.kind === 'fruit').length
    fruitDraws.push(pickups.filter((pickup) => pickup.kind === 'fruit').length)
  }

  const fruit = Math.round(fruitTotal / SEEDS)
  const measured = {
    fruit,
    ramp: Math.round(rampTotal / SEEDS),
    fever: Math.floor(fruit / FEVER_FRUIT_TARGET),
  }

  console.log(
    `    over ${SEEDS} laps: ramps ${Math.min(...rampDraws)}..${Math.max(...rampDraws)} (mean ` +
      `${(rampTotal / SEEDS).toFixed(1)}), fruit ${Math.min(...fruitDraws)}..${Math.max(...fruitDraws)} ` +
      `(mean ${(fruitTotal / SEEDS).toFixed(1)}) -- one draw is not the offer`,
  )

  console.log('      kind        table  measured  target  reward')
  for (const kind of QUEST_KINDS) {
    console.log(
      `      ${kind.padEnd(10)}${String(PER_LAP[kind]).padStart(6)}` +
        `${(measured[kind] === undefined ? '-' : String(measured[kind])).padStart(10)}` +
        `${String(questTarget(kind)).padStart(8)}${String(questReward(kind)).padStart(8)}`,
    )
  }

  // The three that can be counted from a placer have to agree with the table they were taken from.
  // `nearMiss` cannot: what limits it is how often the snail can be *steered* onto a close line,
  // which is a property of the player and was measured in the running game instead.
  for (const [kind, count] of Object.entries(measured)) {
    const drift = Math.abs(count - PER_LAP[kind]) / PER_LAP[kind]

    assert.ok(
      drift < 0.2,
      `a lap now offers ${count} ${kind} against a table saying ${PER_LAP[kind]} -- ${(drift * 100).toFixed(0)}% out`,
    )
  }

  for (const kind of QUEST_KINDS) {
    assert.equal(questTarget(kind), Math.max(1, Math.ceil(PER_LAP[kind] * QUEST_SHARE)), `${kind} target stopped being a share`)
    assert.ok(questTarget(kind) >= 1, `${kind} asks for nothing`)
    // At most a lap's worth: a quest carries across runs, so a full lap is two ordinary ones —
    // but more than a lap would be a quest a perfect run still could not finish alone.
    assert.ok(questTarget(kind) <= PER_LAP[kind], `${kind} asks for more than a lap holds`)
  }
})

check('equal effort pays equally, whatever the verb', () => {
  // **One rate, not a table.** Every quest asks for the same share of a lap, so every quest is the
  // same amount of run — and re-tuning a placer moves the target while leaving the pay alone.
  const rewards = new Set(QUEST_KINDS.map((kind) => questReward(kind)))

  assert.equal(rewards.size, 1, 'two kinds asking for the same share of a lap pay differently')
  assert.equal([...rewards][0], Math.round(QUEST_COIN_RATE * QUEST_SHARE))

  // Worth having, and not worth more than a good run: a quest that outpaid the run would make the
  // run the thing you do between quests.
  assert.ok([...rewards][0] >= 20, 'a quest is worth less than a handful of pickups')
  assert.ok([...rewards][0] <= 100, 'a quest outpays the run it is played during')

  // **⚠ And it has to reach the screen, which for one round it did not.** Reported as *what do we
  // get for a mission? the reward is not visible* — `questReward` was **imported by the board and
  // never called**, so the pay existed, was banked on claim, and was stated nowhere. That is the
  // sixth authored quantity this project has found doing nothing, and the first hidden by an unused
  // *import* rather than an unread constant, which is why the guard is on the call site rather than
  // on the value. The purse it lands in is checked the same way: the front screen had none at all.
  const board = readFileSync('src/ui/questBoard.ts', 'utf8')
  const menu = readFileSync('src/scenes/MainMenu.ts', 'utf8')

  assert.ok(/questReward\(/.test(board), 'the quest board imports the reward and never draws it')
  assert.ok(/this\.purse\.setText\(/.test(menu), 'the front screen has no purse for a claim to land in')
  assert.ok(/tweens\.add\(\{ targets: this\.purse/.test(menu), 'the purse does not react when it is paid')
})

check('a board is three live quests, no two of a kind', () => {
  // Two fruit quests are one quest with a bigger number, and they would fill together — so a board
  // of three would offer two instructions while looking like three.
  for (let seed = 1; seed <= 40; seed++) {
    const board = createQuestBoard(seed)

    assert.equal(board.active.length, QUEST_SLOTS, `seed ${seed} dealt ${board.active.length} quests`)

    const kinds = new Set(board.active.map((quest) => quest.kind))

    assert.equal(kinds.size, QUEST_SLOTS, `seed ${seed} dealt two quests of one kind`)

    const ids = new Set(board.active.map((quest) => quest.id))

    assert.equal(ids.size, QUEST_SLOTS, `seed ${seed} dealt two quests sharing an id`)
    for (const quest of board.active) assert.equal(quest.progress, 0, 'a fresh quest started part-done')
  }
})

check('progress carries between runs, and stops at the target', () => {
  // **A quest that reset on death would be a quest only a good run can finish**, and the player who
  // most needs something to aim at is the one having bad runs.
  let board = createQuestBoard(3)
  const kind = board.active[0].kind
  const target = board.active[0].target
  const tally = createTally()

  tally[kind] = 1

  for (let run = 0; run < target; run++) board = applyTally(board, tally)

  assert.ok(isQuestComplete(board.active[0]), `${target} runs of one did not finish a target of ${target}`)
  assert.equal(board.active[0].progress, target, 'progress overshot its own target')

  // A finished quest stops accumulating: a bar past full says nothing, and the number under it
  // would start reporting something the quest is not about.
  board = applyTally(board, tally)
  assert.equal(board.active[0].progress, target, 'a finished quest kept counting')
  assert.equal(questProgress(board.active[0]), 1)

  // An empty tally changes nothing, which is what makes banking idempotent.
  const before = JSON.stringify(board)

  assert.equal(JSON.stringify(applyTally(board, createTally())), before, 'an empty run moved the board')
})

check('claiming pays once, deals a replacement, and refuses an unfinished quest', () => {
  let board = createQuestBoard(5)
  const quest = board.active[0]
  const tally = createTally()

  // Unfinished: nothing happens, and nothing is dealt.
  const early = claimQuest(board, quest.id, createRng(1))

  assert.equal(early.coins, 0, 'an unfinished quest paid out')
  assert.equal(early.board.active.length, QUEST_SLOTS)

  tally[quest.kind] = quest.target
  board = applyTally(board, tally)

  const claimed = claimQuest(board, quest.id, createRng(1))

  assert.equal(claimed.coins, questReward(quest.kind), 'the reward was not what the quest promised')
  assert.equal(claimed.board.active.length, QUEST_SLOTS, 'the board did not refill')
  assert.ok(!claimed.board.active.some((entry) => entry.id === quest.id), 'the claimed quest is still on the board')

  // Ids are never reused, which is the rule this project has now paid for three times.
  assert.ok(
    claimed.board.active.every((entry) => entry.id !== quest.id),
    'a replacement took the claimed quest id',
  )
  assert.ok(claimed.board.nextId > quest.id, 'the id counter went backwards')

  // Claiming the same one twice pays once.
  assert.equal(claimQuest(claimed.board, quest.id, createRng(1)).coins, 0, 'a quest paid out twice')
})

check('a board off a save is repaired rather than trusted', () => {
  // The same rule `resolveLoadout` and `resolveSelectedTheme` are under: a save can outlive a kind,
  // carry a target from a re-tuned placer, or be hand-edited.
  const good = createQuestBoard(9)

  assert.deepEqual(resolveQuestBoard(good, 9).active.length, QUEST_SLOTS)

  for (const junk of [null, undefined, 0, 'quests', [], {}, { active: 'no' }, { active: [1, 2, 3] }]) {
    const board = resolveQuestBoard(junk, 2)

    assert.equal(board.active.length, QUEST_SLOTS, `junk ${JSON.stringify(junk)} did not produce a full board`)
    for (const quest of board.active) assert.ok(QUEST_KINDS.includes(quest.kind), 'an unknown kind survived')
  }

  // **⚠ The target is re-derived, never restored.** A save written before a placer was re-tuned
  // would otherwise hold a goal that no longer matches the road.
  const stale = { active: [{ id: 1, kind: 'fruit', target: 999, progress: 900, claimed: false }], nextId: 2 }
  const repaired = resolveQuestBoard(stale, 4)
  const fruit = repaired.active.find((quest) => quest.kind === 'fruit')

  assert.equal(fruit.target, questTarget('fruit'), 'a stale target survived a reload')
  assert.ok(fruit.progress <= fruit.target, 'progress survived past the target it was clamped to')

  // An unknown kind is dropped and the slot refilled rather than the board coming back short.
  const alien = resolveQuestBoard({ active: [{ id: 1, kind: 'wheelie', target: 3, progress: 1 }], nextId: 2 }, 6)

  assert.equal(alien.active.length, QUEST_SLOTS)
  assert.ok(!alien.active.some((quest) => quest.kind === 'wheelie'))
})

check('the board only ever asks for decisions', () => {
  // **The rule the scoring ladder is under, applied to the goals.** "Travel 500m" is a stopwatch:
  // every run satisfies it eventually and no play changes that. Every kind here is something the
  // player has to choose to do, and this is what stops a distance or a timer being added to the
  // list later without the argument being had again.
  const byTime = ['distance', 'metres', 'seconds', 'survive', 'time', 'laps']

  for (const kind of QUEST_KINDS) {
    assert.ok(!byTime.includes(kind), `"${kind}" is a stopwatch, not a decision`)
  }

  // And each has to be an event the run can actually count, or the quest is unfinishable.
  const tally = createTally()

  assert.deepEqual(Object.keys(tally).sort(), [...QUEST_KINDS].sort(), 'a kind has no counter in the run')
})

check('the whole board is finishable inside a couple of runs', () => {
  // The acceptance in one number: how many laps' worth of play a full board is.
  const laps = QUEST_KINDS.map((kind) => questTarget(kind) / PER_LAP[kind])
  const worst = Math.max(...laps)

  assert.ok(worst <= 1, `the hardest quest asks for ${worst.toFixed(2)} of a lap`)
  console.log(`      the hardest quest is ${worst.toFixed(2)} of a lap; a full board pays ${QUEST_SLOTS * questReward('fruit')} coins`)

  // A board dealt fresh cannot contain a quest that a single perfect lap could not touch.
  const board = createQuestBoard(1)

  for (const quest of board.active) {
    assert.ok(quest.target <= PER_LAP[quest.kind], `${quest.kind} asks for more than a lap holds`)
  }
})

console.log(`\n${passed} checks passed`)
