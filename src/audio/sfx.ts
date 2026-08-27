/**
 * The game's sound vocabulary: what each sound is, and the rules for playing it often.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:audio`. The playing
 * itself goes through `audio.ts`, which is still the only module allowed to touch `game.sound`.
 */
import { renderToneUri, type ToneSpec } from './synth'

export const SFX = {
  /**
   * The rising tone as coins are taken in a row. The main sound of the game.
   *
   * **The rail shooter's lock tone, kept whole because what it does survived the genre change.**
   * There it counted the targets in a stroke; here it counts a streak of pickups. Both are the
   * same question — "how many did I just get, without looking away" — and the answer is the same
   * fixed interval per step.
   */
  STREAK: 'sfx-streak',
  /** Leaving the ground. Short and rising, so the ear files it as "up". */
  JUMP: 'sfx-jump',
  /** Coming back down. The jump's mirror: low, falling, and shorter. */
  LAND: 'sfx-land',
  /** Hitting something. The only noise burst in the set, so it cannot be mistaken for a reward. */
  HIT: 'sfx-hit',
  /** Fever starting, and the run ending. */
  BOOST: 'sfx-boost',
  RUN_OVER: 'sfx-run-over',
  /**
   * Every thousand points.
   *
   * An unbounded distance has no landmarks in it — the number simply gets longer — so this is
   * the only thing in the run that says "you have got somewhere" without the run ending. Short
   * and high, so it lands *over* the impacts rather than among them: it is a punctuation mark,
   * not an event on the road.
   */
  MILESTONE: 'sfx-milestone',
  PICKUP: 'sfx-pickup',
} as const

/**
 * Base pitch of the streak tone, and the interval each further step adds.
 *
 * **A fixed interval per step is the whole design.** The player has to be able to hear how many
 * they have taken without looking away from the road — the HUD is the fallback, not the readout.
 * Three semitones is wide enough to count by ear and narrow enough that eight of them stay
 * inside two octaves.
 */
export const STREAK_BASE_HZ = 392
export const STREAK_SEMITONES_PER_STEP = 3

/**
 * How many steps the ladder is checked to hold.
 *
 * Eight, unchanged from the rail shooter's `MAX_LOCKS` — not because a runner has locks, but
 * because eight three-semitone steps is exactly the span that stays inside two octaves, which is
 * the constraint that picked the interval in the first place.
 */
export const STREAK_STEPS = 8

/** Cents of detune applied to repeated sounds, and how close together two may play. */
export const VARIATION_CENTS = 60
export const MIN_REPEAT_GAP_MS = 45

/**
 * How much to detune the streak tone for the `index`-th step, in cents.
 *
 * Cents rather than a pre-rendered scale: one sample detuned is one decode and one cache entry,
 * and `STREAK_STEPS` separately rendered tones would be eight of each for a sound the player
 * hears as a single rising run.
 */
export function streakDetuneCents(index: number): number {
  return index * STREAK_SEMITONES_PER_STEP * 100
}

/** The frequency the `index`-th step actually sounds at — for tests and for tuning by ear. */
export function streakFrequency(index: number): number {
  return STREAK_BASE_HZ * Math.pow(2, (index * STREAK_SEMITONES_PER_STEP) / 12)
}

/** Per-sound state for the repeat policy below. One of these per throttled sound key. */
export interface RepeatState {
  lastAt: number
  variant: number
}

export function createRepeatState(): RepeatState {
  return { lastAt: -Infinity, variant: 0 }
}

/**
 * Whether this sound may play again yet, and at what detune if so.
 *
 * Two rules, both there to stop a burst of identical one-shots turning into a buzz:
 *
 * - **a minimum gap.** Eight volley shots landing inside 400ms, each with its own hit, is more
 *   triggers than the ear resolves as separate events; past `MIN_REPEAT_GAP_MS` the extras add
 *   loudness and nothing else.
 * - **rotating detune.** Consecutive plays alternate through `variants` positions spread across
 *   ±`VARIATION_CENTS`, so even the ones that do get through are not the identical sample twice.
 *
 * Mutates `state` only when it returns a play, so a refused call cannot advance the rotation.
 */
export function nextRepeat(
  state: RepeatState,
  now: number,
  variants = 3,
  minGapMs = MIN_REPEAT_GAP_MS,
  spreadCents = VARIATION_CENTS,
): number | null {
  if (now - state.lastAt < minGapMs) return null

  const count = Math.max(1, variants)
  const index = state.variant % count
  // Spread evenly across the full ±range, so with 3 variants they sit at -60, 0, +60.
  const detune = count === 1 ? 0 : -spreadCents + (2 * spreadCents * index) / (count - 1)

  state.lastAt = now
  state.variant = (state.variant + 1) % count

  return detune
}

/** A sound's key and the tone it is rendered from. */
export interface SfxAsset {
  key: string
  spec: ToneSpec
}

/**
 * Every sound in the game, as a description.
 *
 * They are deliberately different *shapes*, not the same blip at different pitches: damage is the
 * only noise burst, the landing falls where the jump rises, and every reward carries a harmonic
 * that nothing in the impact family has.
 */
export const SFX_ASSETS: readonly SfxAsset[] = [
  {
    key: SFX.STREAK,
    // Short, clean and harmonically simple, because it is played up to eight times in a row and
    // anything with body would smear into the next one.
    spec: { waveform: 'triangle', frequency: STREAK_BASE_HZ, durationMs: 90, attackMs: 2, releaseMs: 60, gain: 0.42 },
  },
  {
    key: SFX.JUMP,
    // Rises, and is the only rise in the impact family: a jump is a thing the player did, so it
    // has to be distinguishable from a pickup (also rising, but in the reward family, brighter
    // and with a harmonic) at the moment both can happen.
    spec: { waveform: 'triangle', frequency: 330, sweepTo: 560, durationMs: 110, attackMs: 2, releaseMs: 70, gain: 0.3 },
  },
  {
    key: SFX.LAND,
    // The jump's mirror and deliberately shorter: landing is a punctuation mark on a move the
    // player already heard start, and a landing as long as the launch reads as a second event.
    spec: { waveform: 'square', frequency: 240, sweepTo: 160, durationMs: 70, attackMs: 1, releaseMs: 55, gain: 0.26 },
  },
  {
    key: SFX.HIT,
    // The only noise burst in the set. Damage must not share a waveform with anything the player
    // wants, which is what makes it readable in a frame where a pickup was also taken.
    spec: { waveform: 'noise', frequency: 120, durationMs: 380, attackMs: 2, releaseMs: 340, gain: 0.55 },
  },
  {
    key: SFX.BOOST,
    spec: { waveform: 'triangle', frequency: 523, sweepTo: 1046, durationMs: 420, attackMs: 6, releaseMs: 260, gain: 0.34, harmonicSemitones: 4 },
  },
  {
    key: SFX.RUN_OVER,
    // Falls, and is the longest sound in the game: the one moment nothing else is competing for
    // the ear, and the only one that is allowed to take its time.
    spec: { waveform: 'saw', frequency: 160, sweepTo: 90, durationMs: 520, attackMs: 8, releaseMs: 400, gain: 0.42 },
  },
  {
    key: SFX.PICKUP,
    // Short, bright and rising, in the boost family rather than the impact family — a pickup is a
    // reward, and the ear should file it beside the other rewards. The three kinds are the same
    // sample at three pitches (`detune`), so the player can tell what they took without looking
    // away from the road — the same trick the streak ladder uses to count.
    spec: { waveform: 'triangle', frequency: 660, sweepTo: 990, durationMs: 180, attackMs: 3, releaseMs: 130, gain: 0.3, harmonicSemitones: 5 },
  },
  {
    key: SFX.MILESTONE,
    // A fifth above the boost chime and half its length: related to it by interval, so the two
    // read as the same family, and short enough that several in a row do not become a melody.
    spec: { waveform: 'triangle', frequency: 784, sweepTo: 1568, durationMs: 200, attackMs: 4, releaseMs: 150, gain: 0.24, harmonicSemitones: 7 },
  },
]

/** Renders every sound to a `data:` URI, for the Preloader to hand to Phaser's loader. */
export function renderSfxUris(): { key: string; uri: string }[] {
  return SFX_ASSETS.map(({ key, spec }) => ({ key, uri: renderToneUri(spec) }))
}
