/**
 * The textures obstacles are drawn with, generated per theme.
 *
 * **This module exists as a named seam before it has anything to draw.** `road/applyTheme.ts`
 * tears down and regenerates every texture whose pixels are a function of the theme, and it has
 * to be handed *the list* — the rail shooter pointed it at `enemyArt.ts`, and that back-reference
 * from the untouchable `src/road/` layer into the genre layer is the one thing about the fork
 * that could not simply be deleted. So the seam keeps its shape and changes what stands behind
 * it: `generatedObstacleKeys()` / `createObstacleTextures()` are what `applyTheme` calls, and
 * `src/road/` needs to know nothing else about what a runner puts on the road.
 *
 * Chunk 4 fills these in with the three obstacle classes' art. Until then they are honestly
 * empty rather than absent — an empty list regenerates nothing, which is exactly right for a
 * theme swap in a build that has no obstacles yet.
 */
import type * as Phaser from 'phaser'

/**
 * Keys this module actually generated, for `applyTheme` to remove before regenerating.
 *
 * **Only generated keys, never every declared key** — the rule inherited from `decor.ts`: a slot
 * showing *loaded* art has nothing to regenerate from, so removing it would blank that slot for
 * the rest of the session. Art-backed obstacles are themed by tint at draw time instead.
 */
export function generatedObstacleKeys(): readonly string[] {
  return OBSTACLE_TEXTURE_KEYS.filter((key) => generated.has(key))
}

/** Every obstacle texture key, generated or loaded. Chunk 4 populates this. */
export const OBSTACLE_TEXTURE_KEYS: readonly string[] = []

/** Which of the keys above this module drew itself, as opposed to the loader having filled them. */
const generated = new Set<string>()

/**
 * Draws whatever obstacle art the current theme needs and is missing.
 *
 * Idempotent: a key that already exists is left alone, which is what lets `applyTheme` call this
 * unconditionally after removing the previous theme's set.
 */
export function createObstacleTextures(_scene: Phaser.Scene): void {
  // Chunk 4.
}
