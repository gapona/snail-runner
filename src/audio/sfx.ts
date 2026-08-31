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
  /**
   * A shield taking the hit instead of you.
   *
   * **It has to be told apart from `HIT` by the ear alone**, because the two happen at the identical
   * moment and for the identical reason — the player has just driven into something — and the whole
   * question is which of them it cost. `HIT` is the set's one noise burst; this is tonal, bright and
   * falling: the sound of a thing that was there and now is not, rather than of an impact.
   */
  SHIELD_BREAK: 'sfx-shield-break',
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
 *
 * **⚠ Two semitones, down from three, and the coin's brightness is what paid for it.** The interval
 * was three on the reasoning that it is "wide enough to count by ear and narrow enough that eight of
 * them stay inside two octaves" — both still true, and the second one is the constraint that moved.
 * Eight three-semitone steps is a span of 21 semitones, i.e. the eighth coin plays at **3.36x** the
 * pitch of the first; that is affordable when the sound is a 392Hz triangle and unaffordable when it
 * is a bright arcade blip, because the top of the ladder is then a shriek. Reported as the coin
 * sounding like struck metal rather than money: the fix is a brighter sample, and a brighter sample
 * needs a shorter ladder.
 *
 * Measured over the shipped file at both ends — 176ms/3060Hz at step 0, and at step 7:
 *
 * ```
 * per step   span   step 7    verdict
 *      3st    21st   9521Hz   a shriek
 *      2st    14st   6650Hz   where the OLD coin's top step already sat (6464Hz)
 * ```
 *
 * So nothing on this ladder is shriller than it was before, the first coin — much the most common
 * one — is 56% brighter, and eight whole tones is still eight distinct steps. The span is 14
 * semitones against the two-octave ceiling, i.e. more headroom than it had, not less.
 *
 * **`STREAK_BASE_HZ` is the ladder's reference pitch and no longer a synth input** — the tone it
 * used to render is a recording now (see `SFX_FILES`), and `streakFrequency` is what still reads
 * it: the ladder is applied as *cents of detune*, so what the base is only decides what the
 * printed frequencies mean.
 */
export const STREAK_BASE_HZ = 392
export const STREAK_SEMITONES_PER_STEP = 2

/**
 * How many steps the ladder is checked to hold.
 *
 * Eight, unchanged from the rail shooter's `MAX_LOCKS` — not because a runner has locks, but
 * because eight steps is what the two-octave ceiling affords. At the interval this ladder carries
 * today that is 14 semitones of the 24 available, which is the headroom the coin's brightness is
 * spent out of — see `STREAK_SEMITONES_PER_STEP`.
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
    key: SFX.BOOST,
    spec: { waveform: 'triangle', frequency: 523, sweepTo: 1046, durationMs: 420, attackMs: 6, releaseMs: 260, gain: 0.34, harmonicSemitones: 4 },
  },
  {
    key: SFX.SHIELD_BREAK,
    // Falls, like every "something is gone" in this set, and is the only *tonal* fall short enough
    // to land inside an impact — `RUN_OVER` is the long one, and this must not read as the run
    // ending. The harmonic is what keeps it glassy rather than heavy: a shield is a thin thing.
    spec: {
      waveform: 'triangle',
      frequency: 880,
      sweepTo: 392,
      durationMs: 260,
      attackMs: 2,
      releaseMs: 190,
      gain: 0.3,
      harmonicSemitones: 7,
    },
  },
  {
    key: SFX.RUN_OVER,
    // Falls, and is the longest sound in the game: the one moment nothing else is competing for
    // the ear, and the only one that is allowed to take its time.
    spec: { waveform: 'saw', frequency: 160, sweepTo: 90, durationMs: 520, attackMs: 8, releaseMs: 400, gain: 0.42 },
  },
  {
    key: SFX.MILESTONE,
    // A fifth above the boost chime and half its length: related to it by interval, so the two
    // read as the same family, and short enough that several in a row do not become a melody.
    spec: { waveform: 'triangle', frequency: 784, sweepTo: 1568, durationMs: 200, attackMs: 4, releaseMs: 150, gain: 0.24, harmonicSemitones: 7 },
  },
]

/**
 * The two sounds that are **recordings rather than arithmetic**, and the paths they ship at.
 *
 * ## ⚠ This is a deliberate exception to "every sound is generated", not a drift away from it
 *
 * The rest of the set is rendered at boot, and the reasons hold: a tone from arithmetic *is*
 * self-generated, so there is no provenance row to keep and nothing in `dist/`. What it cannot do is
 * sound like an object. A triangle wave is a fine jump and a fine milestone — those are abstract
 * events — and it is a poor coin and a poor impact, because both of those are *things hitting
 * things* and the ear knows what that sounds like.
 *
 * Both files are **CC0 from kenney.nl**, which is the one licence this project accepts alongside
 * self-generated (see `AUDIO-SOURCES.md`, where each has a row, and CLAUDE.md's asset policy). 12KB
 * for the pair.
 *
 * ## How they were picked, since nobody involved could listen to them
 *
 * `dev-assets/audio/measure.py` reports what an ear would judge, as numbers: length, brightness
 * (spectral centroid), tonality (how much energy sits in a few partials), and **how much of the
 * sound is above 500Hz**, which is where a phone speaker starts reproducing anything at all. That
 * last column decided both picks and rejected the obvious candidates:
 *
 * ```
 * candidate                   ms   centroid   tonal   >500Hz
 * impactSoft_medium_000      115      126Hz    1.00     0.00   <- the obvious "damage" thud
 * impactWood_medium_000      116      236Hz    0.77     0.00
 * impactGeneric_light_000     64      915Hz    0.84     0.39
 * phaserDown1                338     1213Hz    0.76     0.76   <- SFX.HIT
 * glass_001                  174     1959Hz    0.99     1.00
 * powerUp2                   175     3072Hz    0.83     1.00   <- SFX.STREAK
 * powerUp7                   277     4491Hz    0.74     1.00   <- SFX.PICKUP
 * ```
 *
 * ## The third one had a constraint of its own: it must not be the coin
 *
 * `SFX.PICKUP` is what a fruit or a shield sounds like, and it plays in the same seconds as the
 * coin — so "bright, rising, arcade" is necessary and nowhere near sufficient. It has to be
 * *distinguishable*, which is a confusion test, and this project already runs one of those on the
 * pickups' own silhouettes at 24px.
 *
 * The audio version: a 24-band log-frequency profile of each candidate, cosine-compared against the
 * shipped coin **at both ends of its ladder** and against the impact. The scale is set by one
 * reference measured the same way — **the coin against itself pitched up its own 14 semitones scores
 * 0.18**, so anything near that is as different as one sound gets from a transposition of itself.
 *
 * ```
 * candidate      ms   vs coin@0   vs coin@+14st   vs hit   worst
 * powerUp10     350        0.20            0.16     0.28    0.28
 * powerUp7      277        0.29            0.20     0.31    0.31   <- shipped
 * powerUp5      233        0.24            0.38     0.28    0.38
 * powerUp9      284        0.29            0.41     0.16    0.41
 * pepSound5     403        0.24            0.03     0.44    0.44
 * ```
 *
 * `powerUp10` separates slightly better and is 73ms longer, which a fruit cannot afford: chains run
 * three to five, so every millisecond is one the next fruit is stacking on top of.
 *
 * **A soft body thud puts all of its energy under a phone's rolloff**, so on the device most people
 * play on it is a damage cue nobody hears — which is the one thing a damage cue may not be. That
 * column is why the two obvious impacts lost to a descending phaser.
 *
 * ## ⚠ The first pair was measured, shipped, and reported as wrong
 *
 * They were `glass_001` and `impactGeneric_light_000`, and both cleared every number above. What the
 * numbers did not carry is *genre*: the coin was a single struck partial at 99% tonality, which is
 * the sound of **hitting metal** rather than of money, and the impact was a 64ms tick that read as
 * thin. Reported exactly that way — brighter, juicier, more arcade.
 *
 * So the second pair is picked on two properties the first round did not measure at all:
 *
 * - **direction**, which is what an arcade actually uses to say good and bad. The coin *rises* and
 *   the damage *falls*; that opposition is stronger and more universal than the timbre rule this
 *   file used to state ("the only noise burst in the set"), and it survives a phone speaker, a
 *   busy frame and a player who has never seen the game before.
 * - **brightness at the sound's own base**, not merely somewhere in its spectrum: 3060Hz against
 *   1959Hz, with all of it above the phone rolloff.
 *
 * The coin still has a constraint the others do not — it is played through `streakDetuneCents`'
 * eight-step ladder, so it has to survive being pitched up. That is what took the ladder from three
 * semitones a step to two; see `STREAK_SEMITONES_PER_STEP` for the measurement, and note that the
 * top of the new ladder (6650Hz) lands where the *old* coin's top step already was (6464Hz).
 *
 * **`SFX.STREAK` is still one sample detuned, not eight files.** That is the whole reason the ladder
 * is expressed in cents, and it is why swapping a synthesised tone for a recording changed nothing
 * about how the streak works.
 *
 * ## ⚠ Both were levelled before they shipped, and that is not optional
 *
 * Every generated sound in `SFX_ASSETS` bakes its own `gain`, and the set runs 0.24 to 0.55. A
 * recording dropped in at full scale therefore arrives about twice as loud as everything around it —
 * so each is scaled to the peak of the tone it replaced (`0.42` for the coin, `0.55` for the
 * impact) and the mix the rest of the set was tuned against is unchanged. `AUDIO-SOURCES.md` records
 * that, because it is a modification to a file whose provenance row would otherwise claim it is the
 * original.
 */
export const SFX_FILES: Readonly<Record<string, string>> = {
  [SFX.STREAK]: 'audio/coin.ogg',
  [SFX.PICKUP]: 'audio/pickup.ogg',
  [SFX.HIT]: 'audio/hit.ogg',
}

/**
 * How far each non-coin pickup is detuned from `SFX.PICKUP`'s own pitch, in cents.
 *
 * **⚠ The old spec's comment promised this and the code never did it.** It said "the three kinds are
 * the same sample at three pitches (`detune`), so the player can tell what they took without looking
 * away from the road" — and `RunScene` returned a flat `0` for everything that is not a coin, so a
 * fruit and a shield were the same sound. A comment that describes a feature the code does not have
 * is worse than no comment: it is the reason nobody notices the feature is missing.
 *
 * A shield sits a minor third *below* a fruit. Which way round is arbitrary as physics and is not as
 * meaning: the fruit is the common one and the thing that fills the gauge, so it keeps the brighter
 * pitch, and the rarer, defensive pickup is the lower and more solid of the two. What matters is
 * that they are three semitones apart, which is the interval the streak ladder used to use precisely
 * because it is the smallest one a player counts reliably without training.
 */
export const PICKUP_DETUNE_CENTS: Readonly<Record<string, number>> = {
  fruit: 0,
  shield: -300,
}

/** Renders every *generated* sound to a `data:` URI, for the Preloader to hand to Phaser's loader. */
export function renderSfxUris(): { key: string; uri: string }[] {
  return SFX_ASSETS.map(({ key, spec }) => ({ key, uri: renderToneUri(spec) }))
}
