/**
 * A seeded, deterministic pseudo-random generator.
 *
 * Lives here, alongside the fixed timestep, because it is genre-neutral in exactly the same
 * way: it survived the racer and is shared by whatever the game happens to be. `src/road/`
 * seeds track decoration with it (chunk 5) and `src/rail/` will seed enemy waves with it
 * (chunk 6).
 *
 * **Nothing that has to look the same twice may use `Math.random()`.** A track whose scenery
 * reshuffles on every scene restart cannot be compared frame-to-frame between chunks, cannot
 * be reproduced from a bug report, and — once waves land — would make a run unrepeatable.
 * Seeding is the whole point; the exact bit-mixing below is not.
 *
 * `phaser`-free, like everything else under `src/race/` — covered by `npm run verify:road`.
 */

/**
 * mulberry32: a 32-bit generator that is small, fast, and has no visible structure at the
 * scales this project uses it at (a few thousand draws per track).
 *
 * Returns a function producing values in `[0, 1)`. Two generators built from the same seed
 * produce identical sequences, which is the only property anything here relies on.
 */
export function createRng(seed: number): () => number {
  // Forced into a 32-bit unsigned integer up front: the state arithmetic below is all
  // `|0`/`>>>` based, and a float or a negative seed would otherwise silently take a
  // different path through it than the same seed written as a positive integer.
  let state = seed >>> 0

  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0

    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A number in `[min, max)`, drawn from `rng`. */
export function randomRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

/** A uniformly chosen element of `items`. Throws on an empty list rather than returning junk. */
export function randomItem<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('randomItem: cannot draw from an empty list')
  }

  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}
