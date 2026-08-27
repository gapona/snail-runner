import * as Phaser from 'phaser'
import { HORIZON_Y } from '../road/constants'
import { HUD_DEPTH } from './hudDepth'
import { feverSpeedFactor, type FeverState } from './fever'
import { FEVER_SPEED_FACTOR } from './constants'

/**
 * What a Fever looks like: a warm wash and a field of speed lines, over the whole frame.
 *
 * **A Fever that is only a number is a Fever the player plays through defensively.** They are
 * invulnerable for six seconds and the only way they can find that out is by being told — a gauge
 * that emptied is a fact about the HUD, not about the road. If the frame does not say "you are
 * different now", the player keeps dodging, and the reward is spent on nothing.
 *
 * Three signals, deliberately of different kinds so no one of them has to carry it:
 *
 * - **the wash** is the palette shift, and it is done here rather than in the road's palette on
 *   purpose. Rebaking the palette texture per frame is the one thing `applyTheme` is documented as
 *   not being safe to do while the world is drawing, and a Fever is exactly when it is drawing
 *   hardest. A screen-space wash over the finished frame says the same thing for nothing.
 * - **the lines** are the speed, radiating from the vanishing point, so they agree with the
 *   projection the whole world is drawn through. They are the one signal that is *animated*, which
 *   is what stops the effect reading as a still overlay.
 * - **the trail** is not here at all — it comes for free, because `slimeIntensity` is a function of
 *   speed and clamps above 1 precisely so that going faster than the run's own ceiling has
 *   somewhere to show.
 *
 * On `uiCamera`, like the HUD: it is screen-space, and the world camera would put it through the
 * road's projection twice.
 */
export class FeverView {
  private readonly lines: Phaser.GameObjects.Graphics
  private readonly wash: Phaser.GameObjects.Rectangle

  /** How much of the effect is showing, `0..1`. Eased toward the target so nothing snaps on. */
  private shown = 0
  /** Where each line sits along its own ray, `0..1`. Advanced by the frame delta. */
  private readonly phases: number[]

  constructor(scene: Phaser.Scene, private readonly count = 26) {
    this.wash = scene.add
      .rectangle(0, 0, 10, 10, WASH_COLOR, 1)
      .setOrigin(0, 0)
      .setDepth(HUD_DEPTH - 2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
    this.lines = scene.add.graphics().setDepth(HUD_DEPTH - 1).setAlpha(0)
    // Evenly spaced rather than random: a random set clumps, and a clump reads as a smear across
    // one part of the frame instead of as motion through the whole of it.
    this.phases = Array.from({ length: count }, (_, i) => i / count)
  }

  get gameObjects(): Phaser.GameObjects.GameObject[] {
    return [this.wash, this.lines]
  }

  /**
   * Redraws for this frame.
   *
   * **The strength follows `feverSpeedFactor`, not the phase**, so the effect lands and lifts on
   * exactly the same ramp the speed does. The player sees the frame calm down over the same second
   * the run slows down in, which is what makes the landing legible as a landing rather than as the
   * reward being switched off.
   */
  update(state: FeverState, delta: number, width: number, height: number): void {
    const target = (feverSpeedFactor(state) - 1) / (FEVER_SPEED_FACTOR - 1)

    // Eased on rather than assigned: a wash that appears in one frame reads as a dropped frame.
    this.shown += (target - this.shown) * Math.min(1, delta / EASE_MS)
    if (this.shown < 0.004) {
      this.shown = 0
      this.wash.setAlpha(0)
      this.lines.setAlpha(0).clear()

      return
    }

    this.wash.setSize(width, height).setAlpha(this.shown * WASH_ALPHA)
    this.lines.setAlpha(this.shown)
    this.lines.clear()

    const cx = width / 2
    const cy = height * HORIZON_Y
    const reach = Math.hypot(width, height)
    // Faster than the world, on purpose: the lines are the *sensation* of speed rather than a
    // measurement of it, and matching the ground's own rate would put them at the pace of the
    // scenery, which is what the player is already looking past.
    const step = (delta / 1000) * LINE_SPEED

    for (let i = 0; i < this.count; i++) {
      this.phases[i] = (this.phases[i] + step) % 1

      const t = this.phases[i]
      // Squared, so a line spends most of its life near the frame's edge where it is long and
      // fast. Linear puts half of them in the middle of the picture, over the road.
      const near = t * t
      // Deterministic per index rather than rolled per frame: a ray that changed angle every frame
      // is a flicker, not a line.
      const angle = (i / this.count) * Math.PI * 2 + (i % 3) * 0.21
      const from = INNER_HOLE + near * (1 - INNER_HOLE)
      const to = Math.min(1, from + LINE_LENGTH)
      // Fades in from the hole and out at the edge, so nothing appears or vanishes mid-frame.
      const alpha = Math.min(1, near * 4) * Math.min(1, (1 - near) * 3)

      this.lines.lineStyle(Math.max(1, height * LINE_WIDTH), LINE_COLOR, alpha * LINE_ALPHA)
      this.lines.beginPath()
      this.lines.moveTo(cx + Math.cos(angle) * reach * from, cy + Math.sin(angle) * reach * from)
      this.lines.lineTo(cx + Math.cos(angle) * reach * to, cy + Math.sin(angle) * reach * to)
      this.lines.strokePath()
    }
  }

  destroy(): void {
    for (const object of this.gameObjects) object.destroy()
  }
}

/** Warm amber, added rather than blended — the frame gets brighter, not tinted grey. */
const WASH_COLOR = 0x4a2a06
/**
 * **⚠ Pulled back from 0.55 after looking at a live Fever frame.** Additive white-ish light washes
 * *saturation* out of everything under it, and the snail is the one object in this game that is
 * allowed to be saturated — it is thirteen times the chroma of anything it shares a frame with
 * precisely so the player never has to search for it. At 0.55 the mascot went from orange to pale
 * gold, i.e. the effect was spending the mascot's own separation on itself. At 0.38 the frame still
 * plainly changes and the snail stays orange; what carries the rest of the signal is the lines,
 * which are brighter to compensate.
 */
const WASH_ALPHA = 0.38
const LINE_COLOR = 0xfff2cc
const LINE_ALPHA = 0.7
/** As a fraction of the frame's height, so a line is the same weight on any viewport. */
const LINE_WIDTH = 0.004
/** Fraction of the diagonal a line covers. */
const LINE_LENGTH = 0.16
/**
 * How much of the frame around the vanishing point carries no lines.
 *
 * The road ahead is what the player reads obstacles out of, and it is the one part of the picture
 * this effect may not touch — the guard comes off while the wash is still up, so the frame has to
 * be readable throughout.
 */
const INNER_HOLE = 0.22
/** Fractions of the ray travelled per second. */
const LINE_SPEED = 0.85
/** How fast the whole effect follows its target, in milliseconds of time constant. */
const EASE_MS = 220
