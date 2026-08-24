import * as Phaser from 'phaser'
import { anchorTopCenter, anchorTopLeft, anchorTopRight } from '../ui/anchors'
import { KIT } from '../ui/kitPalette'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'
import { HUD_DEPTH } from './hudDepth'
import { BOOST_MS, RUN_LIVES } from './constants'
import type { RunState } from './runState'

/**
 * The run's readouts: how far, how many lives, how much boost.
 *
 * **Three things, and the rail shooter's 42KB HUD is why it is three.** That one carried shields,
 * score, a multiplier, a wave banner, a lock counter, a boss bar and a weapon row — and every one
 * of them existed because the fight had a state the frame could not show. A runner's state is
 * almost entirely visible: how fast you are going is the ground moving, where you are is the snail,
 * what is coming is on screen. What is *not* visible is the number the run is scored in, how much
 * carelessness is left, and whether the boost is still running.
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
  private readonly boostTrack: Phaser.GameObjects.Rectangle
  private readonly boostFill: Phaser.GameObjects.Rectangle

  /** What the counter is currently showing, so it can count up rather than jump. */
  private shownDistance = 0

  constructor(scene: Phaser.Scene) {
    const style = { fontFamily: 'Arial', fontSize: 24, color: toCssColor(KIT.rim) }

    this.distance = scene.add.text(0, 0, '0 m', style).setOrigin(0.5, 0).setDepth(HUD_DEPTH)
    this.lives = scene.add.text(0, 0, '', style).setOrigin(0, 0).setDepth(HUD_DEPTH)
    this.coins = scene.add.text(0, 0, '', style).setOrigin(1, 0).setDepth(HUD_DEPTH)
    // Created hidden — the meter is only meaningful while a boost is running, and a permanently
    // empty gauge is a permanent question the player has to keep re-answering.
    this.boostTrack = scene.add.rectangle(0, 0, 10, 4, KIT.plate, 0.5).setOrigin(0.5, 0).setDepth(HUD_DEPTH).setVisible(false)
    this.boostFill = scene.add.rectangle(0, 0, 10, 4, KIT.active, 1).setOrigin(0, 0).setDepth(HUD_DEPTH).setVisible(false)
  }

  get gameObjects(): Phaser.GameObjects.GameObject[] {
    return [this.distance, this.lives, this.coins, this.boostTrack, this.boostFill]
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

    const boosting = run.boostMsRemaining > 0

    this.boostTrack.setVisible(boosting)
    this.boostFill.setVisible(boosting)
    if (boosting) {
      this.boostFill.width = this.boostTrack.width * (run.boostMsRemaining / BOOST_MS)
    }
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

    this.boostTrack.setSize(trackWidth, 5 * scale)
    this.boostTrack.setPosition(width / 2, this.distance.y + this.distance.height + 8 * scale)
    this.boostFill.setSize(trackWidth, 5 * scale)
    this.boostFill.setPosition(width / 2 - trackWidth / 2, this.boostTrack.y)
    void height
  }

  destroy(): void {
    for (const object of this.gameObjects) object.destroy()
  }
}
