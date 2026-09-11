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
 * `?mips=0` builds without a mipmap min filter, i.e. the world sheet sampled from level 0 alone.
 * The second phone report was coins drawn as an opaque black square for the first seconds of a
 * run and then fine — which is what WebGL1 draws for a texture whose mipmap chain is not complete,
 * and `generateMipmap` on a 2048x4096 sheet is also the one start-of-run cost a phone GPU pays
 * that a desktop does not. One flag tests both halves at once.
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

/** `true` when `?mips=0` asks for the world sheet without a mipmap chain. */
export function mipsDisabled(search: string): boolean {
  const value = new URLSearchParams(search).get(MIPS_FLAG)
  return value === '0' || value === 'false'
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
