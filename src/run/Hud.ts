import * as Phaser from 'phaser'
import { anchorTopLeft, anchorTopRight } from '../ui/anchors'
import { KIT } from '../ui/kitPalette'
import { leafFill, leafHalfHeight, leafOutline, leafRib, leafRibLine, LEAF_STEM, leafVeins } from '../ui/leafGauge'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'
import { HUD_DEPTH } from './hudDepth'
import { FEVER_EASE_MS, FEVER_MS, RUN_LIVES, SPEED_BASE } from './constants'
import { PICKUP_COLORS } from './artPalette'

/**
 * How many shield pips are drawn before the readout switches to a `+`.
 *
 * Shields do not cap in `addShield`, and a row of eleven diamonds is a number to count rather than
 * a shape to glance at — which is the whole reason the lives are pips in the first place.
 */
const MAX_SHIELD_PIPS = 5
import { feverCharge } from './fever'
import { runScore, type RunState } from './runState'

/**
 * The run's readouts: what it is worth, how far it has come, how much Fever is banked, how fast it
 * is going, and how much carelessness is left.
 *
 * **Five readouts against the rail shooter's eleven, and each is a question the frame cannot
 * answer.** That game carried shields, score, a multiplier, a wave banner, a lock counter, a boss
 * bar and a weapon row because the fight had a state the picture could not show. A runner's state is
 * almost all visible — speed is the ground moving, position is the snail, what is coming is on
 * screen. What is not visible is the number the run is scored in, how far it has come, how close the
 * next Fever is, how fast "fast" currently is, and how many mistakes are left.
 *
 * ## ⚠ Score and distance are two numbers on purpose
 *
 * They used to be one: distance *was* the score. They answer different questions — how far you got,
 * and how much you were willing to leave your line for — and a player who never takes a pickup sees
 * them agree, which is the clearest possible statement of what the pickups are worth. See
 * `runScore`.
 *
 * ## Where things sit
 *
 * Score and distance top-left, the fruit gauge top-right, the speed bottom-left, lives under the
 * score. Everything except the speed sits in the top band `ui/menuLayout.ts` reserves, so the HUD
 * appears into rows the menu deliberately leaves empty and the handover from menu to run is a fade
 * of the interface and nothing else.
 *
 * On `uiCamera`, never on `cameras.main`: these are screen-space, and the world camera would draw
 * them through the road's own projection.
 */
export class Hud {
  private readonly score: Phaser.GameObjects.Text
  private readonly distance: Phaser.GameObjects.Text
  private readonly lives: Phaser.GameObjects.Text
  /**
   * How many shields are being carried, as pips beside the lives.
   *
   * **⚠ Its own object because it is its own colour, and its own colour because it is not a life.**
   * The lives are one `Text` and a `Text` has one colour, so a shield drawn into that string would
   * be a life-coloured pip standing for something that is spent first and bought separately. It sits
   * *after* the lives and in the shield pickup's own green, which is the colour the player took it
   * in — the only colour they have ever been shown for it.
   *
   * The whole of this used to be a `◆` glued onto the front of the coin counter. See `shield.ts`.
   */
  private readonly shields: Phaser.GameObjects.Text
  private readonly coins: Phaser.GameObjects.Text
  /** The fruit gauge and the Fever meter, drawn together because they are one object's two states. */
  private readonly gauge: Phaser.GameObjects.Graphics
  private readonly speedPlate: Phaser.GameObjects.Graphics
  private readonly speed: Phaser.GameObjects.Text

  /** What the counters are currently showing, so they count up rather than jump. */
  private shownScore = 0
  private shownMetres = 0
  /** Where `layout` put the gauge and how big it is, so `update` can redraw without re-deriving it. */
  private gaugeBox = { x: 0, y: 0, w: 0, h: 0 }
  /** Where the lives row starts, so `update` can lay the shields beside whatever the lives became. */
  private livesRow = { x: 0, y: 0, gap: 0 }
  /** Where the speed badge sits and how big its chrome is; its width follows the text. */
  private plateAnchor = { x: 0, bottom: 0, height: 0, pad: 0 }

  constructor(scene: Phaser.Scene) {
    const body = { fontFamily: 'Arial', fontSize: 22, color: toCssColor(KIT.rim) }

    // **Stroked rather than plated.** A readout over a bright outdoor world needs to survive sky,
    // sand and grass without a panel behind it, and an outline does that at a fraction of the ink a
    // plate costs — which matters here because the thing behind these two numbers is the road the
    // player is reading.
    this.score = scene.add
      .text(0, 0, 'SCORE: 0', { fontFamily: 'Arial Black, Arial', fontSize: 34, color: toCssColor(KIT.rim) })
      .setOrigin(0, 0)
      .setStroke(toCssColor(KIT.plate), 6)
      .setShadow(0, 3, toCssColor(KIT.plate), 4, false, true)
      .setDepth(HUD_DEPTH)
    this.distance = scene.add
      .text(0, 0, '0 m', { ...body, color: toCssColor(KIT.coin) })
      .setOrigin(0, 0)
      .setStroke(toCssColor(KIT.plate), 4)
      .setDepth(HUD_DEPTH)
    this.lives = scene.add.text(0, 0, '', body).setOrigin(0, 0).setStroke(toCssColor(KIT.plate), 4).setDepth(HUD_DEPTH)
    this.shields = scene.add
      .text(0, 0, '', { ...body, color: toCssColor(PICKUP_COLORS.shield.light) })
      .setOrigin(0, 0)
      .setStroke(toCssColor(KIT.plate), 4)
      .setDepth(HUD_DEPTH)
    this.coins = scene.add
      .text(0, 0, '', { ...body, color: toCssColor(KIT.coin) })
      .setOrigin(1, 0)
      .setStroke(toCssColor(KIT.plate), 4)
      .setDepth(HUD_DEPTH)
    this.gauge = scene.add.graphics().setDepth(HUD_DEPTH)
    this.speedPlate = scene.add.graphics().setDepth(HUD_DEPTH)
    this.speed = scene.add
      .text(0, 0, '', { ...body, fontFamily: 'Arial Black, Arial', color: toCssColor(KIT.active) })
      .setOrigin(0, 0.5)
      .setDepth(HUD_DEPTH + 1)
  }

  /**
   * Where a readout the tutorial wants to point at actually is, in screen pixels.
   *
   * **The HUD is asked rather than told**, because a card that carried its own coordinates would be
   * a second opinion about where the leaf is — and the leaf's own box is solved from the frame's
   * width every `layout`. See `TutorialCard.update`.
   */
  highlightRect(target: 'gauge' | 'lives'): { x: number; y: number; w: number; h: number } {
    if (target === 'gauge') {
      const { x, y, w, h } = this.gaugeBox

      // The stem reaches back past the leaf's own left edge, so the box is widened to hold it —
      // and the vertical padding is kept tight, because the leaf sits one margin from the top of
      // the frame and a generous ring would be drawn with its own top edge off the screen.
      return { x: x - w * 0.14, y: y - h * 0.62, w: w * 1.2, h: h * 1.24 }
    }

    // The lives row, and deliberately the whole row rather than the shield pips alone: before the
    // shield is collected there are no pips, and a ring drawn round an empty spot points at nothing.
    // The card that uses this says a shield is taken "instead of a life", so the lives are what it
    // is about anyway.
    const width = Math.max(this.lives.width + this.shields.width + this.livesRow.gap, 48)

    return { x: this.livesRow.x - 8, y: this.livesRow.y - 6, w: width + 16, h: this.lives.height + 12 }
  }

  get gameObjects(): Phaser.GameObjects.GameObject[] {
    return [this.score, this.distance, this.lives, this.shields, this.coins, this.gauge, this.speedPlate, this.speed]
  }

  /**
   * Redraws from the run's state.
   *
   * **Distance is shown in metres, which is a hundred world units.** The raw number climbs by 3600
   * a second at top speed, and a counter whose last three digits are a blur is a counter nobody
   * reads. A hundred to one puts it at 36 a second — fast enough to feel, slow enough that the
   * leading digits mean something.
   */
  update(run: RunState, width: number): void {
    const points = runScore(run)

    if (points !== this.shownScore) {
      this.shownScore = points
      this.score.setText(`SCORE: ${points.toLocaleString('en-US')}`)
    }

    const metres = Math.floor(run.distance / 100)

    if (metres !== this.shownMetres) {
      this.shownMetres = metres
      this.distance.setText(metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${metres} m`)
    }

    // Filled pips for lives left, hollow for lives spent. A count is a number to read; pips are a
    // shape to glance at, and glancing is all the player can afford mid-run.
    this.lives.setText('●'.repeat(Math.max(0, run.lives)) + '○'.repeat(Math.max(0, RUN_LIVES - run.lives)))
    this.lives.setColor(toCssColor(run.lives <= 1 ? KIT.warning : KIT.rim))

    // One pip per shield, in the pickup's own green, laid after the lives — a count is a number to
    // read and this has to survive a glance, which is the same argument the lives themselves are on.
    this.shields.setText('◆'.repeat(Math.min(run.shields, MAX_SHIELD_PIPS)) + (run.shields > MAX_SHIELD_PIPS ? '+' : ''))
    // Beside the lives rather than under them — they are read as one row: how much carelessness is
    // left, and how much of it is already paid for. Placed here because `this.lives.width` is only
    // a real number once the pips are in it; see `livesRow`.
    this.shields.setPosition(this.livesRow.x + this.lives.width + this.livesRow.gap, this.livesRow.y)
    this.coins.setText(run.coins > 0 ? `🪙 ${run.coins}` : '')

    // **The speed is a multiple of the run's own floor, not a number of units.** 5760 means nothing;
    // "2.4x" is the same fact in the unit the player actually experiences, and it is the one readout
    // that makes a Fever legible as a number as well as as a wash.
    this.speed.setText(`SPEED: ${(run.speed / SPEED_BASE).toFixed(1)}x`)
    this.drawSpeedPlate()
    this.drawGauge(run)
    void width
  }

  /**
   * The leaf, its fill, and the Fever meter that replaces the fill while one is running.
   *
   * **One object showing two states rather than two bars.** The gauge fills with fruit and then
   * empties as the Fever runs, and those are the same thing seen at two moments — where the pair of
   * bars this replaced asked the player to read a colour to find out which question was being
   * answered. The colour still changes, but now it is confirmation rather than the whole signal:
   * what says "this is a Fever" is that the leaf is draining instead of filling.
   */
  private drawGauge(run: RunState): void {
    const { x, y, w, h } = this.gaugeBox

    if (w <= 0) return

    const fever = run.fever.phase !== 'idle'
    // The ease counts toward the meter: the guard is up through it, so a bar that emptied when the
    // speed started coming back would say the player was vulnerable a second before they were.
    const left = run.fever.phase === 'active' ? run.fever.msRemaining + FEVER_EASE_MS : run.fever.msRemaining
    const fill = fever ? Math.max(0, Math.min(1, left / (FEVER_MS + FEVER_EASE_MS))) : feverCharge(run.fever)

    this.gauge.clear()

    const path = (points: { x: number; y: number }[], close: boolean): void => {
      if (points.length < 2) return
      this.gauge.beginPath()
      this.gauge.moveTo(x + points[0].x, y + points[0].y)
      for (let i = 1; i < points.length; i++) this.gauge.lineTo(x + points[i].x, y + points[i].y)
      if (close) this.gauge.closePath()
    }
    const outline = leafOutline(w, h)

    // The stem, first and behind everything: a leaf without one is a shape, and it is what tells
    // the eye which end the gauge fills from.
    this.gauge.lineStyle(Math.max(2, h * 0.085), LEAF_STEM_COLOR, 1)
    this.gauge.beginPath()
    this.gauge.moveTo(x - w * LEAF_STEM, y + h * 0.1)
    this.gauge.lineTo(x + w * 0.02, y)
    this.gauge.strokePath()

    // The empty blade, then the fill inside it, then the rim over both.
    this.gauge.fillStyle(KIT.plate, 0.8)
    path(outline, true)
    this.gauge.fillPath()

    const filled = leafFill(w, h, fill)

    if (filled.length > 2) {
      this.gauge.fillStyle(fever ? KIT.warning : LEAF_FRUIT, 1)
      path(filled, true)
      this.gauge.fillPath()
      // A lighter band along the upper edge of what is filled: one flat colour reads as paper, and
      // the rest of this game's art is lit from above.
      this.gauge.fillStyle(fever ? LEAF_FEVER_LIGHT : LEAF_FRUIT_LIGHT, 0.55)
      path(
        filled.filter((point) => point.y < leafRib(point.x / w, h) - leafHalfHeight(point.x / w, h) * 0.35),
        false,
      )
      this.gauge.lineStyle(Math.max(2, h * 0.13), fever ? LEAF_FEVER_LIGHT : LEAF_FRUIT_LIGHT, 0.5)
      this.gauge.strokePath()
    }

    // The veins, inside the blade and under the rim, so they read as part of the leaf rather than
    // as marks on top of it.
    this.gauge.lineStyle(Math.max(1, h * 0.035), LEAF_RIM, 0.5)
    for (const [from, to] of leafVeins(w, h)) {
      this.gauge.beginPath()
      this.gauge.moveTo(x + from.x, y + from.y)
      this.gauge.lineTo(x + to.x, y + to.y)
      this.gauge.strokePath()
    }

    this.gauge.lineStyle(Math.max(2, h * 0.1), LEAF_RIM, 1)
    path(outline, true)
    this.gauge.strokePath()
    // The midrib last, over the fill: it is the stiff part of a leaf and reads as being on top.
    this.gauge.lineStyle(Math.max(1, h * 0.055), LEAF_RIM, 0.85)
    path(leafRibLine(w, h), false)
    this.gauge.strokePath()
  }

  /** Positions everything. Called from the scene's own `layout()`. */
  layout(width: number, height: number): void {
    const scale = uiScale(width)
    const margin = 16 * scale

    this.score.setFontSize(34 * scale)
    for (const text of [this.distance, this.lives, this.shields, this.coins, this.speed]) text.setFontSize(22 * scale)

    anchorTopLeft(this.score, margin, margin)
    this.distance.setPosition(margin, this.score.y + this.score.height + 2 * scale)
    this.lives.setPosition(margin, this.distance.y + this.distance.height + 4 * scale)
    // **⚠ The shields are placed in `update`, not here, and placing them here drew them ON TOP of
    // the lives.** They sit beside the lives, so their x follows the lives' own *width* — and
    // `layout` runs once at scene create, before the first `update` has put any pips in either
    // string, so that width is zero and both readouts land on the same pixel. It never corrects
    // itself either: `layout` only runs again on a resize. Same rule, and the same failure, as the
    // speed badge's chrome one block below: **a thing positioned from another thing's text has to
    // be positioned where the text is written.** Reported from a screenshot of the corner.
    this.livesRow = { x: margin, y: this.lives.y, gap: 10 * scale }

    // The leaf, top right, sized off the width so it keeps its proportion on any frame.
    const leafW = Math.min(200 * scale, width * 0.24)
    const leafH = leafW * 0.42

    this.gaugeBox = { x: width - margin - leafW, y: margin + leafH / 2, w: leafW, h: leafH }
    anchorTopRight(this.coins, margin, margin + leafH + 6 * scale)

    // The speed badge, bottom left: a rounded plate with the multiple on it. Bottom rather than top
    // because it is the one readout the player checks *after* deciding, not before.
    //
    // **The plate is drawn in `update`, not here**, because its width follows the text and the text
    // is not written until there is a run to read it from. Laying it out to a fixed width instead
    // is how a badge ends up with its own label hanging off the end of it.
    const plateH = 40 * scale

    this.plateAnchor = { x: margin, bottom: height - margin, height: plateH, pad: 16 * scale }
    this.speed.setPosition(margin + this.plateAnchor.pad, height - margin - plateH / 2)
    this.drawSpeedPlate()
  }

  /** The badge's chrome, sized around whatever the readout currently says. */
  private drawSpeedPlate(): void {
    const { x, bottom, height, pad } = this.plateAnchor

    if (height <= 0) return

    const w = this.speed.width + pad * 2
    const y = bottom - height

    this.speedPlate.clear()
    this.speedPlate.fillStyle(KIT.plate, 0.82)
    this.speedPlate.fillRoundedRect(x, y, w, height, height / 2)
    this.speedPlate.lineStyle(Math.max(2, height * 0.06), KIT.active, 0.9)
    this.speedPlate.strokeRoundedRect(x, y, w, height, height / 2)
  }

  destroy(): void {
    for (const object of this.gameObjects) object.destroy()
  }
}

/** The fruit's own violet, so the gauge and the thing that fills it are the same colour. */
const LEAF_FRUIT = 0xa964d8
/** The leaf itself: the shield pickup's green, which is the only leaf-coloured thing in the game. */
const LEAF_RIM = 0x4fc663
/** The stem, a shade darker so it reads as woody rather than as more blade. */
const LEAF_STEM_COLOR = 0x2f7d3c
/** The lit edge of whatever is filling it. The rest of this game's art is lit from above. */
const LEAF_FRUIT_LIGHT = 0xd7a8f2
const LEAF_FEVER_LIGHT = 0xffe3a8
