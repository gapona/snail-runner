/**
 * Turning a slider position into a gain.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:audio` loads it under Node.
 *
 * **A slider at half is not half as loud, and that is the whole reason this file exists.**
 * Loudness is roughly logarithmic: a linear gain sends the top half of the travel almost nowhere
 * and crams every audible change into the bottom quarter, which is why a linear volume slider
 * always feels like it does nothing until it suddenly does everything. Squaring the position is
 * the cheap standard approximation — at the halfway point it is a quarter of the gain, which is
 * close to the half-loudness the player expects — and it costs one multiply.
 *
 * The mapping is kept here rather than in `audio.ts` so it can be asserted without a browser, and
 * so the two channels cannot drift apart by having their own copy of it.
 */

/**
 * What the sliders are worth by default: **both at full.**
 *
 * Music used to default to 0.7, i.e. a slider reading 70% on a fresh install — which reads as the
 * game having turned something down for no reason. What 70% delivered is now what 100% delivers,
 * less `MASTER_GAIN_CEILING`: see `MUSIC_GAIN_CEILING`, and `upgradeV16ToV17` for existing saves.
 */
export const DEFAULT_SOUND_VOLUME = 1
export const DEFAULT_MUSIC_VOLUME = 1

/**
 * The music default before v17, frozen. A migration reads this and never `DEFAULT_MUSIC_VOLUME`,
 * because a migration may not read a constant that describes the present — see `upgradeV7ToV8`.
 */
export const LEGACY_DEFAULT_MUSIC_VOLUME = 0.7

/** The music ceiling before v17, frozen for the same reason. */
const LEGACY_MUSIC_GAIN_CEILING = 0.8

/**
 * The loudest the whole game can be, as a share of what it was before v17.
 *
 * Asked for directly after playing: the maximum should be about 15% less deafening. A factor on the
 * gain rather than on the slider, so the slider still means "all the way up" at its top and "off"
 * at its bottom — `0` times any ceiling is still exactly `0`. Applied to both channels, so the mix
 * between effects and music is exactly what it was.
 */
export const MASTER_GAIN_CEILING = 0.85

/** Clamps an unverified number (a save can be edited) into `0..1`. */
export function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1

  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * The gain for a slider position.
 *
 * Exactly `0` at the bottom, so the slider can mute: a curve that only *approaches* zero leaves a
 * faint sound at the setting the player chose to silence something with.
 */
export function gainFor(volume: number): number {
  const clamped = clampVolume(volume)

  return clamped * clamped
}

/**
 * How much of the music channel's headroom is actually usable, `0..1`, before the master ceiling.
 *
 * **⚠ Solved so that 100% is what the old default delivered**: the slider used to default to 0.7
 * under a ceiling of 0.8, i.e. a gain of `0.7² × 0.8` = 0.392, and a fresh install now defaults to
 * 100%. Keeping 0.8 would have made the default music 74% louder in the same round that was asked to
 * make the game quieter. The effects never had this problem: they already defaulted to full.
 *
 * **The slider's top is not the file's top, and that is deliberate.** The music is one recorded
 * track playing continuously under a set of generated effects that were levelled against each
 * other by hand (`sfx.ts` runs 0.24-0.55); a bed at full scale sits on top of that mix rather than
 * under it. This is the one knob that lowers the loudest the music can ever be without touching
 * the effects, the saved slider position, or what a slider reading 100% means to the player -
 * which is still "all the way up", just up to a quieter ceiling.
 *
 * Applied as a factor rather than by rescaling the slider, so it cannot change which positions
 * count as silent: `0` times any ceiling is still exactly `0`.
 */
export const MUSIC_GAIN_CEILING = LEGACY_DEFAULT_MUSIC_VOLUME ** 2 * LEGACY_MUSIC_GAIN_CEILING

/**
 * The gain for a music slider position - `gainFor` under `MUSIC_GAIN_CEILING`.
 *
 * Every place that sets a music volume goes through this, for the reason the curve itself lives
 * here: a ceiling applied at one call site and not the next is a track that changes loudness when
 * it restarts.
 */
export function musicGainFor(volume: number): number {
  return gainFor(volume) * MUSIC_GAIN_CEILING * MASTER_GAIN_CEILING
}

/** The gain for an effects slider position - `gainFor` under the master ceiling. */
export function soundGainFor(volume: number): number {
  return gainFor(volume) * MASTER_GAIN_CEILING
}

/**
 * Where an old music slider has to sit to deliver what it did, less the master ceiling.
 *
 * The music scale moved (`MUSIC_GAIN_CEILING` is the old 70% now), so a saved position means a
 * different loudness than it did. This keeps what the player *hears* — a slider left at the old
 * default of 70% lands on 100%, one at 35% on 50% — snapped to the slider's own 5% steps, and a
 * slider that was above the old default lands on 100%, which is the loudest the new scale goes.
 */
export function migratedMusicVolume(oldVolume: number): number {
  const kept = clampVolume(oldVolume) * Math.sqrt(LEGACY_MUSIC_GAIN_CEILING / MUSIC_GAIN_CEILING)

  return Math.min(1, Math.round(kept * 20) / 20)
}

/** Whether a channel is silent — the slider at the bottom counts as off, not as very quiet. */
export function isSilent(volume: number): boolean {
  return gainFor(volume) <= 0
}
