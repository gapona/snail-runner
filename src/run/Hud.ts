import * as Phaser from 'phaser'
import { anchorTopCenter, anchorTopLeft, anchorTopRight } from '../ui/anchors'
import { KIT } from '../ui/kitPalette'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'
import { HUD_DEPTH } from './hudDepth'
import { FEVER_EASE_MS, FEVER_MS, RUN_LIVES } from './constants'
import { feverCharge } from './fever'
import type { RunState } from './runState'

/** The fruit's own violet, so the gauge and the thing that fills it are the same colour. */
const FRUIT_COLOR = 0xa964d8

/**
 * The run's readouts: how far, how many lives, how much fruit, and how much Fever is left.
 *
 * **Three things, and the rail shooter's 42KB HUD is why it is three.** That one carried shields,
 * score, a multiplier, a wave banner, a lock counter, a boss bar and a weapon row — and every one
 * of them existed because the fight had a state the frame could not show. A runner's state is
 * almost entirely visible: how fast you are going is the ground moving, where you are is the snail,
 * what is coming is on screen. What is *not* visible is the number the run is scored in, how much
 * carelessness is left, how close the next Fever is, and how much of the current one is left.
 *
 * **⚠ The fruit gauge and the Fever meter are two bars, and collapsing them into one would be
 * wrong in both directions.** They answer opposite questions — one is filling and one is emptying —
 * and they are true at the same time, because fruit taken during a Fever counts toward the next
 * one. A single bar that changed meaning halfway would be asking the player to read its colour to
 * find out which question it is currently answering, mid-run, at Fever speed.
 *
 * **The gauge is always drawn, unlike the boost meter it replaced.** That meter was hidden when
 * empty on the argument that a permanently empty gauge is a permanent question — true of something
 * that is either running or not, and false of *progress*: a bar the player is filling has to be
 * visible while they fill it, or collecting fruit is an act with no feedback and Fever is a thing
 * that happens to them rather than something they earned.
 *
 * Everything sits in the top band `ui/menuLayout.ts` reserves, so it appears into rows the menu
 * deliberately left empty — which is what lets the handover from menu to run be nothing but a fade.
 *
 * On `uiCamera`, never on `cameras.main`: these are screen-space, and the world camera would draw
 * them through the road's own projection.
 */
export class Hud {
  private readonly distance: Phaser.GameObjects.Text
  private readonly lives: Phaser.GameObjects.Text
  private readonly coins: Phaser.GameObjects.Text
  private readonly fruitTrack: Phaser.GameObjects.Rectangle
  private readonly fruitFill: Phaser.GameObjects.Rectangle
  private readonly feverTrack: Phaser.GameObjects.Rectangle
  private readonly feverFill: Phaser.GameObjects.Rectangle

  /** What the counter is currently showing, so it can count up rather than jump. */
  private shownDistance = 0

  constructor(scene: Phaser.Scene) {
    const style = { fontFamily: 'Arial', fontSize: 24, color: toCssColor(KIT.rim) }

    this.distance = scene.add.text(0, 0, '0 m', style).setOrigin(0.5, 0).setDepth(HUD_DEPTH)
    this.lives = scene.add.text(0, 0, '', style).setOrigin(0, 0).setDepth(HUD_DEPTH)
    this.coins = scene.add.text(0, 0, '', style).setOrigin(1, 0).setDepth(HUD_DEPTH)
    // The gauge is visible from the first frame — see the header for why this one is not hidden
    // when empty the way the boost meter was.
    this.fruitTrack = scene.add.rectangle(0, 0, 10, 4, KIT.plate, 0.5).setOrigin(0.5, 0).setDepth(HUD_DEPTH)
    this.fruitFill = scene.add.rectangle(0, 0, 10, 4, FRUIT_COLOR, 1).setOrigin(0, 0).setDepth(HUD_DEPTH)
    // The Fever meter is hidden when idle, and that one *is* a state rather than progress.
    this.feverTrack = scene.add.rectangle(0, 0, 10, 4, KIT.plate, 0.5).setOrigin(0.5, 0).setDepth(HUD_DEPTH).setVisible(false)
    this.feverFill = scene.add.rectangle(0, 0, 10, 4, KIT.warning, 1).setOrigin(0, 0).setDepth(HUD_DEPTH).setVisible(false)
  }

  get gameObjects(): Phaser.GameObjects.GameObject[] {
    return [this.distance, this.lives, this.coins, this.fruitTrack, this.fruitFill, this.feverTrack, this.feverFill]
  }

  /**
   * Redraws from the run's state.
   *
   * **Distance is shown in metres, which is a hundred world units.** The raw number climbs by
   * 3600 a second at top speed, and a counter whose last three digits are a blur is a counter
   * nobody reads. A hundred to one puts it at 36 a second — fast enough to feel, slow enough that
   * the leading digits mean something.
   */
  update(run: RunState, width: number): void {
    const metres = Math.floor(run.distance / 100)

    if (metres !== this.shownDistance) {
      this.shownDistance = metres
      this.distance.setText(`${metres} m`)
    }

    // Filled pips for lives left, hollow for lives spent. A count is a number to read; pips are a
    // shape to glance at, and glancing is all the player can afford mid-run.
    this.lives.setText('●'.repeat(Math.max(0, run.lives)) + '○'.repeat(Math.max(0, RUN_LIVES - run.lives)))
    this.lives.setColor(toCssColor(run.lives <= 1 ? KIT.warning : KIT.rim))

    this.coins.setText(run.coins > 0 || run.shields > 0 ? `${run.shields > 0 ? '◆ ' : ''}🪙 ${run.coins}` : '')

    this.fruitFill.width = this.fruitTrack.width * feverCharge(run.fever)

    const fever = run.fever.phase !== 'idle'

    this.feverTrack.setVisible(fever)
    this.feverFill.setVisible(fever)
    if (fever) {
      // **The ease counts toward the bar.** The guard is up through it, so a meter that emptied
      // when the *speed* started coming back would say the player was vulnerable a second before
      // they were — which is the one thing about Fever the HUD must not get wrong.
      const left = run.fever.phase === 'active' ? run.fever.msRemaining + FEVER_EASE_MS : run.fever.msRemaining

      this.feverFill.width = this.feverTrack.width * Math.max(0, left / (FEVER_MS + FEVER_EASE_MS))
    }
    void width
  }

  /** Positions everything. Called from the scene's own `layout()`. */
  layout(width: number, height: number): void {
    const scale = uiScale(width)
    const margin = 16 * scale

    for (const text of [this.distance, this.lives, this.coins]) text.setFontSize(24 * scale)

    anchorTopCenter(this.distance, margin)
    anchorTopLeft(this.lives, margin, margin)
    anchorTopRight(this.coins, margin, margin)

    const trackWidth = Math.min(220 * scale, width * 0.4)
    const bar = 5 * scale
    const top = this.distance.y + this.distance.height + 8 * scale

    for (const [track, fill, row] of [
      [this.fruitTrack, this.fruitFill, 0],
      [this.feverTrack, this.feverFill, 1],
    ] as const) {
      // **A whole bar's worth of gap, not a hairline.** At 4px the two sat close enough to read as
      // one two-tone bar, which is the single readout this pair exists not to be.
      const y = top + row * (bar * 2 + 3 * scale)

      track.setSize(trackWidth, bar).setPosition(width / 2, y)
      fill.setSize(trackWidth, bar).setPosition(width / 2 - trackWidth / 2, y)
    }
    void height
  }

  destroy(): void {
    for (const object of this.gameObjects) object.destroy()
  }
}
