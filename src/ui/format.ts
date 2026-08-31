/** Seconds -> `"M:SS"`. Locale-invariant (every timer/count in this kit is a plain digit, no
 * ICU/plural rules needed). */
export function formatTime(elapsedSec: number): string {
  const total = Math.round(elapsedSec)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** `'retro-tech'` -> `'Retro Tech'` — a generic fallback for any hyphenated id (asset key,
 * slug, etc.) that needs a human-readable label with no dedicated display name. */
export function titleCase(id: string): string {
  return id
    .split('-')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

/**
 * A whole number with thousands separators, identically on every device.
 *
 * **⚠ Pinned to `en-US` rather than left to `toLocaleString()`'s default, and that is the point.**
 * The HUD pinned it and the front screen did not, so one readout said `1,014` and the other
 * `12144` -- the same quantity under two rules, decided by the player's own locale. A score is a
 * number the player compares against their own record and against a leaderboard, so it has to look
 * the same in both places and on both devices; the game's own strings are localised through `t()`,
 * which is where language belongs.
 */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}
