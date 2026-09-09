/**
 * "Would this frame draw the same picture as the last one?", asked without allocating.
 *
 * **⚠ The guard cost seven times what it guarded.** The HUD's three readouts each decide whether to
 * rebuild by composing a *string* out of everything their draw reads and comparing it to the last
 * one — an array, a `join`, a dozen `toFixed(3)` calls and a string concatenation per element,
 * every frame, to answer a question whose answer is "no" on 88 of every 100 frames. Measured in the
 * running game at 375x667: `drawRow` cost **0.087ms a frame** while `paintRow`, the drawing it
 * exists to skip, cost **0.012ms**.
 *
 * That is worth writing down as a shape rather than as one bug: **a dirty-check that allocates is a
 * dirty-check that can cost more than redrawing.** `toFixed` is the sharpest edge of it — it
 * formats a number into a fresh string, and it was being used purely to *quantise*, which is
 * `Math.round(value * 1000)` with nothing allocated.
 *
 * So the values are compared as numbers against the previous set, in place. Nothing is allocated
 * after the first frame, the comparison is exact rather than hashed — a hash collision here is a
 * readout that silently stops updating — and the quantisation the string version got from
 * `toFixed(3)` is kept, because it is load-bearing: it is what lets a pulse run at full rate while
 * a resting readout costs one pass of number compares.
 */
export class DirtyValues {
  /** The set that was last accepted, i.e. last drawn. Grown once and then reused. */
  private readonly last: number[] = []

  private at = 0
  private dirty = false

  /** Starts a set. Everything the draw reads goes in between this and `changed()`. */
  begin(): void {
    this.at = 0
    this.dirty = false
  }

  /**
   * Adds one value.
   *
   * **A differing value is written through immediately**, which is what makes the whole thing one
   * pass: by the time `changed()` returns true the stored set is already the new one, and when it
   * returns false nothing was touched.
   */
  add(value: number): void {
    if (this.at === this.last.length) {
      this.last.push(value)
      this.dirty = true
    } else if (this.last[this.at] !== value) {
      this.last[this.at] = value
      this.dirty = true
    }

    this.at++
  }

  /** Adds a boolean. Spelled out so a caller cannot pass one by accident and compare `NaN`. */
  addFlag(value: boolean): void {
    this.add(value ? 1 : 0)
  }

  /**
   * Adds a value quantised to `1 / steps`, which is what `toFixed(3)` was doing for free.
   *
   * The quantum has to be coarser than the pixels the value drives and finer than the motion, or a
   * pulse either stops running or never rests.
   */
  addQuantised(value: number, steps = 1000): void {
    this.add(Math.round(value * steps))
  }

  /**
   * Whether anything in this set differs from the last accepted one.
   *
   * **⚠ A shorter set has to truncate**, or every later frame compares against stale trailing
   * values and reports a change for ever. That is the one case a string signature got right for
   * free and this does not.
   */
  changed(): boolean {
    if (this.at !== this.last.length) {
      this.last.length = this.at
      this.dirty = true
    }

    return this.dirty
  }

  /**
   * Forgets what was drawn, so the next set is a change whatever it holds.
   *
   * For a caller that has thrown its picture away for a reason the values cannot see — a texture
   * rebuilt under it, a scene restarted.
   */
  reset(): void {
    this.last.length = 0
    this.at = 0
    this.dirty = false
  }
}
