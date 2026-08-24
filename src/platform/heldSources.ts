/**
 * Tracking for "is this action being held down right now", across however many independent
 * input sources are bound to it.
 *
 * Pure and `phaser`-free on purpose: this is the half of held-input handling that has a real
 * failure mode, so it is covered by `npm run verify:ship`. `src/platform/input.ts`'s
 * `bindHeldAction` is the thin Phaser wiring on top.
 */

/**
 * The set of sources currently holding one action down.
 *
 * **A set, not a counter.** The OS repeats a held key as a stream of `keydown` events with no
 * matching `keyup` between them. A counter incremented per `keydown` therefore climbs without
 * bound while a key is held, and the single `keyup` on release decrements it by one — leaving
 * it positive, so the action stays stuck on forever. Keying by source id makes a repeat
 * idempotent, which is the whole point.
 */
export class HeldSourceSet {
  private readonly active = new Set<string>()

  /** Marks `sourceId` as holding the action. Repeating this for the same id is a no-op. */
  press(sourceId: string): void {
    this.active.add(sourceId)
  }

  /** Marks `sourceId` as no longer holding the action. Releasing an unheld id is a no-op. */
  release(sourceId: string): void {
    this.active.delete(sourceId)
  }

  /** Drops every source at once — for focus loss, where no `keyup` is coming. */
  clear(): void {
    this.active.clear()
  }

  /** Whether any source is currently holding the action. */
  get isHeld(): boolean {
    return this.active.size > 0
  }

  /** How many distinct sources are holding it. Diagnostics only. */
  get heldCount(): number {
    return this.active.size
  }
}

export type Axis = -1 | 0 | 1

/**
 * Combines two opposed held actions into a single axis.
 *
 * Holding both cancels to `0`, and — because each direction is tracked independently rather
 * than as one shared counter — releasing one of them immediately yields the other, with no
 * need to re-press it.
 */
export function axisFrom(negativeHeld: boolean, positiveHeld: boolean): Axis {
  return ((positiveHeld ? 1 : 0) - (negativeHeld ? 1 : 0)) as Axis
}
