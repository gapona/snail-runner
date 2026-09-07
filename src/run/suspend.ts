import { createRunState, type RunState } from './runState'
import { createPlayerState, type PlayerState } from './playerMotion'
import { createFeverState, FEVER_PHASES, type FeverPhase, type FeverState } from './fever'
import { createTally, QUEST_KINDS, type QuestKind } from './quests'
import { MAX_SHIELDS, RUN_LIVES, SPEED_BASE } from './constants'
import { FIXED_STEP_MS } from '../race/constants'

/**
 * A run put down and picked up again.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:suspend`.
 *
 * ## ⚠ It is a snapshot, not a paused scene, and the reason is a rule this project already has
 *
 * The obvious way to let a player leave a run and come back is to pause `RunScene` and resume it —
 * which is what the result panel does, and it works there because that panel is an *overlay* over a
 * paused scene. It cannot work here: leaving goes to `MainMenu`, `MainMenu` builds a `WorldView` of
 * its own, and **two worlds may never be alive at once** — `applyTheme` swaps the pixels behind
 * live texture keys, so the second world throws inside the renderer on `glTexture` a frame later.
 * This project has diagnosed that from five directions; it is not a thing to test a sixth time.
 *
 * So the scene is stopped and what survives is a value. `RunScene.create` builds the run from it
 * instead of from the start line.
 *
 * ## What is kept, and what is deliberately let go
 *
 * The road is **not** in the snapshot and does not need to be: a lap is a pure function of the seed
 * and the lap index, so the same seed regenerates the identical layout. Everything else is in one
 * of two classes.
 *
 * Kept: the **seed** (the road, the scenery, the ramps and the bugs all derive from it), the whole
 * **`RunState`** (distance, speed, lives, shields, coins, the fruit gauge, the fixed step's own
 * remainder), the whole **`PlayerState`** (where on the road, how high, and mid-flight if it was
 * mid-flight), **`bankedCoins`** so resuming cannot pay the same coins twice, and
 * **`invulnerableUntilDistance`** because grace bought by a hit is grace the player keeps.
 *
 * Let go: the **slime trail** (a record of the last second, and it regrows in one), the
 * **critters** (a population spawned ahead of the camera and retired behind it — it refills), the
 * **near-miss streak** (a streak is *unbroken* close passes, and putting the run down breaks it),
 * **`resolvedOnLap`** (it only decides obstacles being crossed right now, and the grace window
 * covers the single frame in which dropping it could double-charge), and the coin-sound ladder.
 *
 * ## ⚠ Suspending BANKS, and that is what makes putting a run down safe
 *
 * A snapshot that held the coins hostage would mean a player who suspends and then starts a new run
 * has silently thrown away everything the old one earned — and would find that out afterwards,
 * which is the worst possible moment. So a suspend banks the coins and the quest tally exactly as
 * ending a run does: `bankedCoins` keeps the accounting honest and `bankQuestProgress` zeroes the
 * tally it banked, so both are safe to run again when the run really ends. Abandoning a suspended
 * run therefore costs nothing already earned; what it costs is the distance, which is the thing the
 * player was in the middle of.
 *
 * ## ⚠ The tutorial cannot be suspended, and that is a mechanical rule rather than a pacing one
 *
 * `tutorial.ts` states it: the cards teach the wall *after* the low rock, because "the row with no
 * gap" is only legible to somebody who has seen a row with one. It is a hand-placed 900m stretch
 * that is not resumable half way through, which is also why the stage mode used to be gated behind
 * it. `RunScene` therefore ends a tutorial run on exit rather than suspending it — the same thing
 * leaving used to do for every run.
 */
export interface SuspendedRun {
  /** The draw the whole road was generated from. */
  seed: number
  run: RunState
  player: PlayerState
  /** Coins already paid into the save, so resuming and then ending cannot pay them again. */
  bankedCoins: number
  /** Grace bought by a hit, as a distance — see `HIT_INVULNERABLE_Z`. */
  invulnerableUntilDistance: number
}

/**
 * Whether a snapshot is worth offering.
 *
 * **A run that is over is not suspended, it is finished**, and one that has travelled nothing is
 * not worth a control on the front screen: the player would press Continue and be put on the start
 * line, which is what Play already does.
 */
export function isResumable(snapshot: SuspendedRun | null | undefined): snapshot is SuspendedRun {
  return snapshot !== null && snapshot !== undefined && !snapshot.run.over && snapshot.run.distance > 0
}

/**
 * Repairs a stored snapshot, or refuses it.
 *
 * **Never trusted, for the reason `resolveSelectedSnail` and `resolveQuestBoard` are not.** This is
 * the first save field in this game that is a whole simulation state rather than an id or a count,
 * so the ways it can be wrong are the ways a number can be wrong: a hand-edited payload, a field
 * that `JSON.stringify` turned into `null` (which is what it does to `Infinity` and `NaN`), or a
 * snapshot written by a build whose `RunState` had a field this one does not.
 *
 * **⚠ It returns `null` rather than repairing a run into existence.** Every other resolver here
 * falls back to a default because there is always something sensible to fall back to — the free
 * skin, the first weapon. There is no default run: one the player did not play is not one to hand
 * them, so a snapshot that does not survive this is simply not offered and Play starts a new one.
 */
export function resolveSuspended(raw: unknown): SuspendedRun | null {
  if (raw === null || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const run = resolveRunState(record.run)
  const player = resolvePlayerState(record.player)

  if (run === null || player === null) return null

  const snapshot: SuspendedRun = {
    seed: Math.max(0, Math.floor(finite(record.seed, 0))),
    run,
    player,
    bankedCoins: Math.max(0, Math.floor(finite(record.bankedCoins, 0))),
    invulnerableUntilDistance: Math.max(0, finite(record.invulnerableUntilDistance, 0)),
  }

  return isResumable(snapshot) ? snapshot : null
}

/**
 * A finite number, or the fallback.
 *
 * **The `JSON.stringify` cases are why this is one helper rather than a `typeof` at each site.**
 * `Infinity` and `NaN` both serialise to `null`, so a field that was either comes back as a *type*
 * error rather than as a bad number — and a `NaN` reaching `stepRun` would put the camera at `NaN`
 * and blank the frame with nothing in the console to say why.
 */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function resolveRunState(raw: unknown): RunState | null {
  if (raw === null || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const distance = finite(record.distance, -1)

  if (distance <= 0) return null
  // **⚠ Refused here rather than repaired, and the check caught the difference.** The output's
  // `over` is written `false` below, so asking `isResumable` about the *resolved* snapshot could
  // never see a stored run that had ended — it would come back alive with its lives clamped up to
  // one, which is a dead run handed back as a Continue. What is asked is the stored value.
  if (record.over === true) return null

  return {
    ...createRunState(),
    z: Math.max(0, finite(record.z, 0)),
    distance,
    // Floored at the same speed `takeHit` floors at, and for the same reason: a run at zero speed
    // has ended without saying so.
    speed: Math.max(SPEED_BASE * 0.4, finite(record.speed, SPEED_BASE)),
    ticks: Math.max(0, Math.floor(finite(record.ticks, 0))),
    stepRemainderMs: clamp(finite(record.stepRemainderMs, 0), 0, FIXED_STEP_MS),
    lives: clamp(Math.round(finite(record.lives, RUN_LIVES)), 1, RUN_LIVES),
    shields: clamp(Math.round(finite(record.shields, 0)), 0, MAX_SHIELDS),
    coins: Math.max(0, Math.floor(finite(record.coins, 0))),
    bonus: Math.max(0, finite(record.bonus, 0)),
    tally: resolveTally(record.tally),
    fever: resolveFever(record.fever),
    // **Never restored as over.** `isResumable` refuses such a snapshot anyway; writing it here as
    // well means the two cannot disagree about what a resumed run is.
    over: false,
  }
}

function resolveTally(raw: unknown): Record<QuestKind, number> {
  const tally = createTally()

  if (raw === null || typeof raw !== 'object') return tally

  const record = raw as Record<string, unknown>

  for (const kind of QUEST_KINDS) tally[kind] = Math.max(0, Math.floor(finite(record[kind], 0)))

  return tally
}

function resolveFever(raw: unknown): FeverState {
  if (raw === null || typeof raw !== 'object') return createFeverState()

  const record = raw as Record<string, unknown>
  const phase = record.phase

  return {
    fruit: Math.max(0, Math.floor(finite(record.fruit, 0))),
    phase: FEVER_PHASES.includes(phase as FeverPhase) ? (phase as FeverPhase) : 'idle',
    msRemaining: Math.max(0, finite(record.msRemaining, 0)),
  }
}

function resolvePlayerState(raw: unknown): PlayerState | null {
  if (raw === null || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>

  return {
    ...createPlayerState(),
    // Clamped to the verge either side rather than to `ROAD_EDGE`: the soft wall lets the spring
    // overshoot past the asphalt, so a legitimate snapshot can hold an offset outside it.
    offsetX: clamp(finite(record.offsetX, 0), -2, 2),
    vx: finite(record.vx, 0),
    y: Math.max(0, finite(record.y, 0)),
    vy: finite(record.vy, 0),
    grounded: record.grounded !== false,
    flightV0: Math.max(0, finite(record.flightV0, 0)),
    flightSpins: Math.max(0, Math.floor(finite(record.flightSpins, 0))),
    airControl: clamp(finite(record.airControl, 1), 0, 1),
    stepRemainderMs: clamp(finite(record.stepRemainderMs, 0), 0, FIXED_STEP_MS),
  }
}
