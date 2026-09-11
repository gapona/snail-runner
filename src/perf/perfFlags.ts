/**
 * The two query flags the perf build reads, as pure string functions.
 *
 * Kept apart from the overlay so `verify:perf` can hold them without touching `document`: the
 * overlay module is DOM from its first line, and a rule a check cannot reach is a rule nobody is
 * checking.
 *
 * - `?perf=1` mounts the overlay. Anything else — absent, `0`, `false` — does not, so a build
 *   carrying the instrument still comes up clean by default.
 * - `?msaa=0` creates the WebGL context without multisampling. **It cannot be toggled live**:
 *   `antialias` is a context-creation attribute and the context is made once, so the overlay's
 *   button reloads the page with the flag flipped rather than pretending to switch it in place.
 */

export const PERF_FLAG = 'perf'
export const MSAA_FLAG = 'msaa'

export function perfRequested(search: string): boolean {
  const value = new URLSearchParams(search).get(PERF_FLAG)
  return value === '1' || value === 'true'
}

/** `true` when `?msaa=0` asks for a context with no multisampling. Absent or anything else keeps the default. */
export function msaaDisabled(search: string): boolean {
  const value = new URLSearchParams(search).get(MSAA_FLAG)
  return value === '0' || value === 'false'
}

/**
 * The search string that flips MSAA and keeps every other flag — `perf=1` above all, or the
 * reload would come back without the overlay that asked for it.
 */
export function toggledMsaaSearch(search: string): string {
  const params = new URLSearchParams(search)
  if (msaaDisabled(search)) params.delete(MSAA_FLAG)
  else params.set(MSAA_FLAG, '0')
  const out = params.toString()
  return out ? `?${out}` : ''
}
