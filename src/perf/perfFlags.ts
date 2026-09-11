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
/**
 * `?mips=1` turns the mipmap min filter back ON. It is opt-in because the game ships without one:
 * distant coins drew as an opaque black square on a Mali phone and came right up close, which is a
 * broken mip chain rather than a broken sprite (see `config.ts`). The flag exists so the next
 * device can be asked the same question without a rebuild.
 */
export const MIPS_FLAG = 'mips'

export function perfRequested(search: string): boolean {
  const value = new URLSearchParams(search).get(PERF_FLAG)
  return value === '1' || value === 'true'
}

/** `true` when `?msaa=0` asks for a context with no multisampling. Absent or anything else keeps the default. */
export function msaaDisabled(search: string): boolean {
  const value = new URLSearchParams(search).get(MSAA_FLAG)
  return value === '0' || value === 'false'
}

/** `true` when `?mips=1` asks for the mipmap chain the shipped config leaves off. */
export function mipsRequested(search: string): boolean {
  const value = new URLSearchParams(search).get(MIPS_FLAG)
  return value === '1' || value === 'true'
}

/** The search string that flips one opt-in (`=1`) flag and keeps every other. */
export function toggledOptInSearch(search: string, flag: string): string {
  const params = new URLSearchParams(search)
  const value = params.get(flag)
  if (value === '1' || value === 'true') params.delete(flag)
  else params.set(flag, '1')
  const out = params.toString()
  return out ? `?${out}` : ''
}

/**
 * The search string that flips one `=0` flag and keeps every other — `perf=1` above all, or the
 * reload would come back without the overlay that asked for it.
 */
export function toggledFlagSearch(search: string, flag: string): string {
  const params = new URLSearchParams(search)
  const value = params.get(flag)
  if (value === '0' || value === 'false') params.delete(flag)
  else params.set(flag, '0')
  const out = params.toString()
  return out ? `?${out}` : ''
}

export function toggledMsaaSearch(search: string): string {
  return toggledFlagSearch(search, MSAA_FLAG)
}
