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

/** What the sliders are worth by default: effects at full, music under them. */
export const DEFAULT_SOUND_VOLUME = 1
export const DEFAULT_MUSIC_VOLUME = 0.7

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

/** Whether a channel is silent — the slider at the bottom counts as off, not as very quiet. */
export function isSilent(volume: number): boolean {
  return gainFor(volume) <= 0
}
