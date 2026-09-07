import { createRng } from '../race/rng'

/**
 * What a run is *for*, beyond going further than last time.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:quests`.
 *
 * ## ⚠ An endless runner's only goal is a number that never stops
 *
 * The distance has no ceiling, so "do better" is the whole of what the game asks, and on any given
 * run it asks for nothing in particular. A quest gives *this* run a shape: it names something to go
 * and do, it can be finished, and finishing it pays. That is a different question from the score —
 * the score asks how the run went, a quest asks what the player set out to do.
 *
 * ## What may be asked for, and what may not
 *
 * The same rule the scoring ladder is under: **a quest names a consequence of a decision, never of
 * time or luck.** "Travel 500m" is a stopwatch — every run satisfies it eventually and no play
 * changes that — where "pass three things closely" is a thing the player has to choose to do, four
 * times over. So the four kinds are exactly the four verbs this game has: leave your line for
 * fruit, go near something, spend a gauge, and take a ramp.
 *
 * That is also why quests could not exist before the near-miss round. Without it the only
 * measurable events in a run were pickups and distance, and a board made of those asks for the
 * thing the player was going to do anyway.
 */

export type QuestKind = 'fruit' | 'nearMiss' | 'fever' | 'ramp'

export const QUEST_KINDS: readonly QuestKind[] = ['fruit', 'nearMiss', 'fever', 'ramp']

/**
 * How many quests are live at once.
 *
 * Three, and the number is bounded on both sides. One is a single instruction, which makes the run
 * a checklist with one box and leaves a player who does not fancy that item with nothing; five is a
 * list nobody reads before pressing Play. Three fits the space above the Play button and is enough
 * that at least one of them usually suits the run the player was going to have anyway.
 */
export const QUEST_SLOTS = 3

/**
 * What one lap of the run offers of each kind, measured from the real placers.
 *
 * **⚠ Targets are a share of this, never a number somebody picked.** A quest has to be finishable
 * in a run or two, and how long that is depends on the fruit the placer lays, the ramps it lays and
 * how often a road even *offers* a close pass — all of which move when the difficulty curve or the
 * spacing is re-tuned. Pinning a literal target would make "one or two runs" true on the day it was
 * written and false afterwards, silently.
 *
 * `verify:quests` recomputes these from `placeFormations`, `placeRamps` and the near-miss rate
 * measured in the running game, and fails if any of them has drifted far enough to move what a
 * quest is worth.
 */
export const PER_LAP = {
  /**
   * Fruit laid on one lap.
   *
   * **⚠ 33 when this table was first written, and the check rejected it on its first run.** That
   * figure came from the Fever chapter, which measured it before the pickup set was cut from seven
   * kinds to five and the weights moved with it. A target taken from the old number would have
   * asked for 18 — a flawless run rather than the one or two ordinary ones a quest is supposed to
   * be. Exactly the drift `verify:quests` exists to catch, and it caught it before a single quest
   * had been dealt.
   *
   * **⚠ And the 19 that replaced it was itself one seed's lap.** Fruit swings 11..35 across seeds,
   * so a single draw says almost nothing about the offer; the mean over twelve laps is **25**.
   */
  fruit: 25,
  /**
   * Close passes a lap *offers*, which is not the same as the obstacles on it.
   *
   * Measured in the running game rather than counted from the placer: an autopilot aiming at every
   * obstacle it could reach scored one pass per ~9000 world units, i.e. about a third of the rows.
   * What limits it is how often the snail can be steered onto a close line in time, not how many
   * rocks there are.
   */
  nearMiss: 15,
  /**
   * Fevers a lap's fruit can buy: `fruit / FEVER_FRUIT_TARGET`, if every one is taken.
   *
   * Derived from the row above and moves with it — three now that the fruit figure is a mean over
   * forty laps rather than one lap's draw. It is still the kind whose target is the largest share
   * of what a lap holds, because a Fever *is* a lap's worth of fruit by construction.
   */
  fever: 3,
  /**
   * Ramps laid on one lap.
   *
   * **⚠ 7 when this was written, and that was one seed's draw rather than what a lap offers.** A
   * lap lays between four and eight of them depending only on the seed, so the single measurement
   * both this and `fruit` were taken from could be pushed out of the check's own tolerance by a
   * re-rolled layout with nothing about the game having changed. Both are means over twelve laps
   * now, over the forty laps `verify:formations` already sweeps for the same reason.
   */
  ramp: 5,
} as const

/**
 * What share of a lap's worth of a thing a quest asks for.
 *
 * **Under one, deliberately.** A quest asking for a whole lap's fruit requires a perfect lap, which
 * is not "one or two runs", it is "one flawless run" — and a board of those is a board the player
 * stops reading. At 0.55 a quest is comfortably one good run or two ordinary ones, which is the
 * shape asked for.
 */
export const QUEST_SHARE = 0.55

/**
 * What a quest pays, in coins per unit of a lap's worth.
 *
 * **One rate for every kind, which is what stops this being a table.** A quest asking for 55% of a
 * lap's fruit and one asking for 55% of its ramps are the same amount of run, so they are worth the
 * same — and re-tuning the placers moves both targets *and* keeps the rewards equal without anyone
 * re-balancing anything. Compare `MILESTONE_COINS`, which is flat because a milestone is always the
 * same distance.
 */
export const QUEST_COIN_RATE = 60

export interface Quest {
  /** Stable for the life of the quest, so the save and the board agree about which is which. */
  id: number
  kind: QuestKind
  target: number
  progress: number
  /** Set when the player takes the reward, which is what removes it from the board. */
  claimed: boolean
}

export interface QuestBoard {
  active: Quest[]
  /** Never reused, so two quests alive at once cannot share an id. The rule ids are under here. */
  nextId: number
}

/**
 * How many of a kind a quest asks for. Always at least one, and always a share of a lap.
 *
 * **⚠ Rounded UP, and the kind with the smallest pool is why.** A lap affords two Fevers, so 55%
 * of it rounds *down* to one — and one Fever is something any decent run does without trying, which
 * makes that quest a box the board ticks for the player rather than a thing to go and do. Rounding
 * up asks for at least the share on every kind, and on the large pools the difference is a single
 * fruit.
 */
export function questTarget(kind: QuestKind): number {
  return Math.max(1, Math.ceil(PER_LAP[kind] * QUEST_SHARE))
}

/**
 * What finishing one is worth, in coins.
 *
 * **The same for every kind, and that is a consequence rather than a decision.** Every quest asks
 * for the same *share* of a lap (`QUEST_SHARE`), so every quest is the same amount of run — and
 * paying equal effort equally is what stops this being a table somebody has to keep in step with
 * the placers. It takes the kind anyway, because the day a kind is given its own share is the day
 * the reward has to follow it, and a signature that already carries the kind will not need finding.
 */
export function questReward(kind: QuestKind): number {
  void kind

  return Math.max(1, Math.round(QUEST_COIN_RATE * QUEST_SHARE))
}

export function isQuestComplete(quest: Quest): boolean {
  return quest.progress >= quest.target
}

/** How far along a quest is, `0..1`, for the bar that draws it. */
export function questProgress(quest: Quest): number {
  return quest.target > 0 ? Math.min(1, quest.progress / quest.target) : 0
}

/**
 * Deals one quest of a kind not already on the board.
 *
 * **No two live quests share a kind.** Two fruit quests are one quest with a bigger number, and
 * they would fill together — so a board of three would offer two instructions and look like three.
 */
export function dealQuest(board: QuestBoard, rng: () => number): Quest {
  const taken = new Set(board.active.filter((quest) => !quest.claimed).map((quest) => quest.kind))
  const available = QUEST_KINDS.filter((kind) => !taken.has(kind))
  const pool = available.length > 0 ? available : QUEST_KINDS
  const kind = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]

  return { id: board.nextId, kind, target: questTarget(kind), progress: 0, claimed: false }
}

/** A full board, dealt from a seed. */
export function createQuestBoard(seed = 1): QuestBoard {
  const rng = createRng(seed)
  const board: QuestBoard = { active: [], nextId: 1 }

  while (board.active.length < QUEST_SLOTS) {
    const quest = dealQuest(board, rng)

    board.active.push(quest)
    board.nextId = quest.id + 1
  }

  return board
}

/**
 * Adds a run's tallies to the board.
 *
 * **Progress carries between runs, which is what makes a quest a session's goal rather than a
 * run's.** A quest that reset every death would be a quest only a good run can finish, and the
 * player who most needs a goal to aim at is the one having bad runs.
 *
 * A completed quest stops accumulating: its bar is full, and a number climbing past its own target
 * is a number that has stopped meaning anything.
 */
export function applyTally(board: QuestBoard, tally: Readonly<Record<QuestKind, number>>): QuestBoard {
  return {
    ...board,
    active: board.active.map((quest) =>
      quest.claimed || isQuestComplete(quest)
        ? quest
        : { ...quest, progress: Math.min(quest.target, quest.progress + Math.max(0, tally[quest.kind] ?? 0)) },
    ),
  }
}

/**
 * Takes the reward for a finished quest and deals its replacement.
 *
 * **Claimed by hand, never automatically.** The collect is the moment the player is told they did
 * the thing — take it away and the quest completes silently somewhere inside a run, which is
 * exactly where nobody is reading a list of objectives. It also means the replacement is dealt
 * while the player is looking at the board, so the next goal is something they have seen.
 */
export function claimQuest(board: QuestBoard, id: number, rng: () => number): { board: QuestBoard; coins: number } {
  const quest = board.active.find((entry) => entry.id === id)

  if (!quest || quest.claimed || !isQuestComplete(quest)) return { board, coins: 0 }

  const without: QuestBoard = { active: board.active.filter((entry) => entry.id !== id), nextId: board.nextId }
  const replacement = dealQuest(without, rng)

  return {
    board: { active: [...without.active, replacement], nextId: replacement.id + 1 },
    coins: questReward(quest.kind),
  }
}

/** An empty tally, for a run to fill. */
export function createTally(): Record<QuestKind, number> {
  return { fruit: 0, nearMiss: 0, fever: 0, ramp: 0 }
}

/**
 * Repairs a board off a save, the way every list in this project is repaired rather than trusted.
 *
 * A save can outlive a quest kind, carry a target from a re-tuned placer, or be hand-edited. What
 * comes back is always exactly `QUEST_SLOTS` quests of known kinds with sane targets — the same
 * rule `resolveLoadout` and `resolveSelectedTheme` are under.
 */
export function resolveQuestBoard(raw: unknown, seed = 1): QuestBoard {
  const fallback = createQuestBoard(seed)

  if (!raw || typeof raw !== 'object') return fallback

  const source = raw as { active?: unknown; nextId?: unknown }
  const active: Quest[] = []
  let nextId = typeof source.nextId === 'number' && Number.isFinite(source.nextId) ? Math.max(1, Math.trunc(source.nextId)) : 1

  if (Array.isArray(source.active)) {
    for (const entry of source.active) {
      if (!entry || typeof entry !== 'object') continue

      const quest = entry as Partial<Quest>

      if (typeof quest.kind !== 'string' || !QUEST_KINDS.includes(quest.kind as QuestKind)) continue
      if (typeof quest.id !== 'number' || !Number.isFinite(quest.id)) continue
      if (active.some((existing) => existing.id === quest.id)) continue

      // **The target is re-derived, never restored.** It is a share of what a lap offers, so a save
      // written before the placer was re-tuned would otherwise hold a goal that no longer matches
      // the road — asking for a lap and a half of fruit, or for a third of one.
      const target = questTarget(quest.kind as QuestKind)

      active.push({
        id: Math.trunc(quest.id),
        kind: quest.kind as QuestKind,
        target,
        progress: typeof quest.progress === 'number' && Number.isFinite(quest.progress) ? Math.max(0, Math.min(target, Math.trunc(quest.progress))) : 0,
        claimed: quest.claimed === true,
      })
      nextId = Math.max(nextId, Math.trunc(quest.id) + 1)
    }
  }

  const board: QuestBoard = { active: active.filter((quest) => !quest.claimed).slice(0, QUEST_SLOTS), nextId }
  const rng = createRng(seed)

  while (board.active.length < QUEST_SLOTS) {
    const quest = dealQuest(board, rng)

    board.active.push(quest)
    board.nextId = quest.id + 1
  }

  return board
}
