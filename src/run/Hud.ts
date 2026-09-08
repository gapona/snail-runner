import * as Phaser from 'phaser'
import { hudScale, KIT } from '../ui/kitPalette'
import { ensureMinHitArea } from '../ui/uiScale'
import { TOP_BAR, topBarHeight, topBarLayout, type TopBarLayout } from '../ui/topBar'
import { EXIT_ALPHA, EXIT_GLYPH } from '../ui/exitButton'
import { ensureTopWashTexture, TOP_WASH_TEXTURE } from '../ui/scrimTexture'
import {
  FRUIT_GAUGE_PIPS,
  FRUIT_PULSE_MS,
  FRUIT_SEGMENT,
  FULL_MARK,
  fillPulse,
  fruitGaugeBox,
  fullPulse,
  gaugeYield,
  pipFills,
  segmentOffsetY,
  type GaugeBox,
} from '../ui/fruitGauge'
import {
  LIFE_ENTRY_MS,
  LIFE_PIP,
  HEART_COLOR,
  HEART_LIGHT,
  LIFE_SPEND_MS,
  entryBounce,
  entryOffset,
  lifeRowBox,
  lifeRowSlots,
  progressIn,
  slideEase,
  slotCentreX,
  spendFlash,
  spendSquash,
  type LifeSlotKind,
} from '../ui/lifeRow'
import { roundedRectPoints, type RectPoint } from '../ui/roundedRect'
import { toCssColor } from '../ui/theme'
import { formatCount } from '../ui/format'
import { HUD_DEPTH } from './hudDepth'
import { FEVER_EASE_MS, FEVER_MS, MAX_SHIELDS, PLAYER_REST_Y_FRACTION, RUN_LIVES } from './constants'
import { PICKUP_COLORS } from './artPalette'
import { feverCharge } from './fever'
import {
  createPlaque,
  MILESTONE_FLASH_MS,
  milestoneFlash,
  PLAQUE_ROW,
  plaqueAlpha,
  plaquePunch,
  type Plaque,
} from './rewards'
import { type RunState } from './runState'

/**
 * The run's readouts: how far it has come, what it has collected, how much carelessness is left,
 * and how close the next Fever is.
 *
 * ## ⚠ Four readouts in three places, and the round before this had six in two blocks
 *
 * The HUD had grown a **panel** in the top-left: a rounded plate carrying the fruit gauge with the
 * lives and the shield pips under it, sitting below the distance. Three problems, and the third is
 * the one that made the other two worth fixing:
 *
 * - **shields and lives answered one question in two counters.** Both mean "how many more hits do I
 *   survive", and they were two shapes, two colours and two objects — so reading them was finding
 *   both and adding up. They are one row now; see `ui/lifeRow.ts`.
 * - **the panel was a slab.** A filled plate is the one contrast device this project has now paid
 *   for four separate times (the menu's measured scrim, the pickups' bright rim, the front screen's
 *   button strip, this) and the finding is always the same: it is judged on a frame, not on the
 *   argument for it. Every readout here is stroked instead, which is what the distance already did.
 * - **it put two blocks of interface in the band the run's own number lives in.** The top third
 *   carries the distance on the left and the coins on the right, and nothing else.
 *
 * ## Where things sit now
 *
 * | | |
 * |---|---|
 * | top left | the distance — what the run is scored in |
 * | top right | the coins |
 * | bottom left | the survivability row: shields, then hearts, spent left to right |
 * | bottom right | the Fever tank, filling bottom-up beside the mascot |
 *
 * **⚠ The bottom corners are where a previous round was reported for covering the snail**, and what
 * makes them safe now is height rather than optimism: the block that was reported was ~100px tall
 * against a band under the mascot's feet worth 66px on a 320x568 phone. A row of elements is 21px
 * there and the tank is a 18px-wide column. `verify:ui` measures both against the mascot's own
 * projected box at every supported viewport rather than arguing about it.
 *
 * On `uiCamera`, never on `cameras.main`: these are screen-space, and the world camera would draw
 * them through the road's own projection.
 */
export class Hud {
  private readonly distance: Phaser.GameObjects.Text
  private readonly coins: Phaser.GameObjects.Text
  /**
   * The run's own way out.
   *
   * **⚠ It was a `KitButton` and it was the loudest thing in the frame.** The argument for the
   * button was that a control which does not look like a control is a control nobody finds — true,
   * and it produced a 62x48 filled widget in the top-right corner of a game the player is meant to
   * be looking *down* the road in, on a screen where the one thing they must almost never press was
   * the highest-contrast object on it. Reported as exactly that.
   *
   * It is a glyph now, quiet, at the smallest drawn size in the HUD — and it is still findable,
   * because the top-right corner is where every game of this kind puts it and the band's own wash
   * is what makes it legible. **Drawn small, hit big**: `ensureMinHitArea` floors the target at
   * `MIN_TOUCH` while the glyph is a third of that, which is the split `sliderHitHeight` already
   * makes for the same reason. See `EXIT_SAFE` for the other half — an accidental exit is the worst
   * mistake this game can make, so the corner is a measured claim rather than a habit.
   */
  private readonly exit: Phaser.GameObjects.Text
  /** The band's own wash, and the milestone rule along its bottom. */
  private readonly wash: Phaser.GameObjects.Image
  /** The survivability row — shields and hearts, one line, drawn rather than set as text. */
  private readonly row: Phaser.GameObjects.Graphics
  /** The Fever tank. */
  private readonly gauge: Phaser.GameObjects.Graphics
  /**
   * The one reward plaque, in the strip the player is already reading the road out of.
   *
   * **One, never a queue** — see `rewards.ts`. A streak on a dense stretch fires several times a
   * second, and a plaque per reward fills the middle of the frame with text at exactly the moment
   * the road has to be visible through it.
   */
  private readonly plaqueText: Phaser.GameObjects.Text
  private readonly plaqueSub: Phaser.GameObjects.Text
  /** The bar to the next milestone, which is the next biome. */
  private readonly milestone: Phaser.GameObjects.Graphics

  /** What the counters are currently showing, so they count up rather than jump. */
  private shownMetres = 0

  /**
   * The row as it is being *drawn*, which is not the same as the row the run implies.
   *
   * A spent element is still on screen for `LIFE_SPEND_MS` while it goes out, and an arriving one
   * is on screen before the hearts have finished making room for it — so the drawn row lags the
   * state deliberately, and this is where that lag lives.
   */
  private elements: RowElement[] = []
  private shownShields = 0
  private shownLives = RUN_LIVES
  /**
   * The hearts' slide: which way they moved and when, in slots.
   *
   * One number for the whole heart section rather than a per-element tween, because they only ever
   * move together and only ever by one slot — the shield section is 0 or 1 elements long.
   */
  private slide = { by: 0, at: -1 }

  private gaugeBox: GaugeBox = { x: 0, y: 0, w: 0, h: 0, scale: 1 }
  private rowBox = { x: 0, y: 0, w: 0, h: 0 }
  private rowScale = 1
  /** When the last fruit went in, so the tank can pulse on the event rather than continuously. */
  private bankedAt = -1
  private shownCharge = 0
  private plaque: Plaque = createPlaque()
  /** When the last milestone was crossed, for its flash. `-1` for none yet. */
  private milestoneAt = -1
  private milestoneBox = { x: 0, y: 0, w: 0, h: 0 }
  /** Where the top band ends, for anything the scene stacks under it. */
  private barBottom = 0
  /** The band as `layout` last solved it, so `update` can re-fit the row without re-solving it. */
  private bar: TopBarLayout | null = null
  private barScale = 1
  /** What `fitRow` last fitted against, so it can skip a frame that would set the same two faces. */
  private fittedBar: TopBarLayout | null = null
  private fittedRow = ''
  /**
   * What each of the three `Graphics` readouts was last *drawn* from.
   *
   * **⚠ A `Graphics` is rebuilt and replayed on every frame it is redrawn, and these three were
   * redrawn on every frame full stop.** Measured on the shipped HUD: the tank is **1248**
   * command-buffer entries and the life row **1326** — eight rounded-rect segments, and five pips
   * with a fill, a highlight and a stroke each — re-tessellated sixty times a second for readouts
   * that change when a fruit is banked or a life is lost and at no other time. Hiding the tank
   * alone took the renderer's own pass below every control in the A/B, which made it the largest
   * single item in the frame.
   *
   * Each signature is built from exactly the values its draw reads, so two frames that agree on it
   * would have produced the same commands. It is deliberately *not* a timer: the animated terms are
   * in it, quantised finer than the pixels they move, so a pulse still runs at full rate and a
   * resting readout costs one string comparison.
   */
  private drawnGauge = ''
  private drawnRow = ''
  private drawnMilestone = ''
  private shownProgress = 0
  private plaqueScale = 1

  constructor(scene: Phaser.Scene) {
    const body = { fontFamily: 'Arial', fontSize: 22, color: toCssColor(KIT.rim) }

    // **Stroked rather than plated.** A readout over a bright outdoor world needs to survive sky,
    // sand and grass without a panel behind it, and an outline does that at a fraction of the ink a
    // plate costs — which matters here because the thing behind these numbers is the road the
    // player is reading.
    this.distance = scene.add
      .text(0, 0, '0 m', { ...body, color: toCssColor(KIT.coin) })
      .setOrigin(0, 0)
      .setStroke(toCssColor(KIT.plate), 4)
      .setDepth(HUD_DEPTH)
    this.coins = scene.add
      .text(0, 0, '', { ...body, color: toCssColor(KIT.coin) })
      .setOrigin(1, 0)
      .setStroke(toCssColor(KIT.plate), 4)
      .setDepth(HUD_DEPTH)
    // **Stroked, centred, and in the strip the eye is already on.** No plate: this sits over the
    // road the player is reading, and a filled panel there would hide the thing it is congratulating
    // them about.
    this.plaqueText = scene.add
      .text(0, 0, '', { ...body, color: toCssColor(KIT.coin), fontStyle: 'bold' })
      .setOrigin(0.5, 1)
      .setStroke(toCssColor(KIT.plate), 6)
      .setDepth(HUD_DEPTH)
      .setAlpha(0)
    this.plaqueSub = scene.add
      .text(0, 0, '', { ...body, color: toCssColor(KIT.active) })
      .setOrigin(0.5, 0)
      .setStroke(toCssColor(KIT.plate), 5)
      .setDepth(HUD_DEPTH)
      .setAlpha(0)
    ensureTopWashTexture(scene)
    // **Under everything else in the band**, and under the readouts it exists to carry: it is what
    // they are read against, so it cannot be over them.
    this.wash = scene.add
      .image(0, 0, TOP_WASH_TEXTURE)
      .setOrigin(0, 0)
      .setTint(KIT.plate)
      .setAlpha(TOP_BAR.washAlpha)
      .setDepth(HUD_DEPTH - 1)
    this.exit = scene.add
      .text(0, 0, '✕', { ...body, color: toCssColor(KIT.rim) })
      .setOrigin(0.5)
      .setAlpha(EXIT_ALPHA)
      .setDepth(HUD_DEPTH)
    this.milestone = scene.add.graphics().setDepth(HUD_DEPTH)
    this.row = scene.add.graphics().setDepth(HUD_DEPTH)
    this.gauge = scene.add.graphics().setDepth(HUD_DEPTH)
  }

  /**
   * How far down the top-left block reaches, in screen pixels.
   *
   * Read by the tutorial card, which is centred and nearly frame-wide on a phone. It is the
   * distance readout's own bottom now that nothing else is stacked under it.
   */
  get blockBottom(): number {
    // **The band's own bottom, not the distance readout's.** Every element up there shares one
    // baseline now, so "how far down the top block reaches" is a property of the band rather than
    // of whichever readout happens to be tallest — and the milestone rule is the last row of it.
    return this.barBottom
  }

  /**
   * Where a readout the tutorial wants to point at actually is, in screen pixels.
   *
   * **The HUD is asked rather than told**, because a card that carried its own coordinates would be
   * a second opinion about where the gauge is — and both boxes are solved from the frame every
   * `layout`. See `TutorialCard.update`.
   */
  highlightRect(target: 'gauge' | 'lives'): { x: number; y: number; w: number; h: number } {
    const box = target === 'gauge' ? this.gaugeBox : this.rowBox
    // Generous around the tank, which is narrow, and tight around the row, which is not — a ring
    // has to read as pointing at one thing, and those two shapes need different margins to do it.
    const pad = target === 'gauge' ? 10 : 8

    return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
  }

  /**
   * What `RunScene` binds its `close` action to.
   *
   * A standalone `Text` acting as its own button, which is the one shape `ensureMinHitArea` is for
   * — never a child of a widget whose container is already interactive, which is how the garage's
   * close button came to swallow its own press.
   */
  get exitTarget(): Phaser.GameObjects.GameObject {
    return this.exit
  }

  get gameObjects(): Phaser.GameObjects.GameObject[] {
    return [this.wash, this.distance, this.coins, this.row, this.gauge, this.plaqueText, this.plaqueSub, this.milestone, this.exit]
  }

  /**
   * Redraws from the run's state.
   *
   * **Distance is shown in metres, which is a hundred world units.** The raw number climbs by 3600
   * a second at top speed, and a counter whose last three digits are a blur is a counter nobody
   * reads. A hundred to one puts it at 36 a second — fast enough to feel, slow enough that the
   * leading digits mean something.
   *
   * `now` is the scene's clock and every animation in here is a function of it, never of a stored
   * per-frame delta: a readout driven by accumulated deltas drifts against the events that started
   * it, and these animations exist precisely to mark events.
   */
  /** Announces a reward, folding it into the plaque that is already up if one is. */
  announce(plaque: Plaque): void {
    this.plaque = plaque
  }

  /** Marks a milestone as just crossed, for its flash. */
  markMilestone(now: number): void {
    this.milestoneAt = now
  }

  update(run: RunState, width: number, now: number, progress: number, mascot?: MascotBox): void {
    const metres = Math.floor(run.distance / 100)

    if (metres !== this.shownMetres) {
      this.shownMetres = metres
      this.distance.setText(metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${formatCount(metres)} m`)
    }

    this.coins.setText(run.coins > 0 ? `🪙 ${run.coins}` : '')
    // Both readouts have just been written, which is the only moment their widths are known.
    this.fitRow()

    this.shownProgress = progress
    this.drawPlaque(now, width)
    this.drawMilestone(run, now)
    this.syncRow(run, now)
    this.drawRow(now)
    this.drawGauge(run, now, mascot)
    void width
  }

  /**
   * The reward plaque: what was just earned, and how long a run of it.
   *
   * **In the upper third and centred, which is where the player already is.** They are looking up
   * the road at the strip under the horizon, because that is where the next thing to decide about
   * appears — so an announcement anywhere else arrives after the fact. It sits above `HORIZON_Y`
   * for the reason the tutorial card does: over sky rather than over the road it is about.
   */
  private drawPlaque(now: number, width: number): void {
    const alpha = plaqueAlpha(this.plaque, now)

    if (alpha <= 0) {
      this.plaqueText.setAlpha(0)
      this.plaqueSub.setAlpha(0)

      return
    }

    // The punch is what says *another one* when the plaque is already up and only the number has
    // changed. A number that merely increments is a number nobody notices changing.
    const punch = plaquePunch(this.plaque, now)
    const scale = this.plaqueScale * (1 + punch * 0.18)

    this.plaqueText.setText(`+${formatCount(this.plaque.points)}`)
    this.plaqueText.setScale(scale)
    this.plaqueText.setAlpha(alpha)
    // **The streak multiplier, not how many rewards were merged.** Merges only happen inside
    // `PLAQUE_MERGE_MS`, and on a real road close passes are seconds apart — so the merge count was
    // almost always 1 and the multiplier never appeared. The streak survives those gaps, and is
    // what the player is playing for.
    const showsStreak = this.plaque.multiplier > 1.001
    const shown = this.plaque.multiplier.toFixed(this.plaque.multiplier % 1 === 0 ? 0 : 2)

    this.plaqueSub.setText(showsStreak ? `x${shown}` : '')
    this.plaqueSub.setScale(this.plaqueScale * (1 + punch * 0.26))
    this.plaqueSub.setAlpha(showsStreak ? alpha : 0)
    void width
  }

  /**
   * The bar to the next milestone, and the flash when one is reached.
   *
   * **⚠ The milestone is the biome change, not a counter beside one.** Two ladders would drift the
   * moment the lap length or the biome count moved, and the player would be told they had arrived
   * somewhere the world did not change — which is worse than no milestone, because the world
   * changing *is* the reward. See `rewards.ts`.
   */
  private drawMilestone(run: RunState, now: number): void {
    const { x, y, w, h } = this.milestoneBox
    const progress = this.shownProgress
    const flash = milestoneFlash(this.milestoneAt, now)
    // **Quantised to the pixel the bar is actually drawn at**, which is exact rather than a
    // tolerance: the fill's width lands on a whole pixel in the rasteriser anyway, so two frames
    // whose rounded width agrees draw the identical bar. The run advances this readout
    // continuously, and without the rounding that would be a rebuild every frame for a bar that
    // moves one pixel every few of them.
    const signature = [x, y, w, h, progress > 0 ? 1 : 0, Math.round(Math.max(h, w * progress)), flash.toFixed(3)].join(',')

    if (signature === this.drawnMilestone) return

    this.drawnMilestone = signature

    this.milestone.clear()

    if (w <= 0) return

    const radius = h / 2

    this.milestone.fillStyle(KIT.plate, 0.7)
    fillRounded(this.milestone, x, y, w, h, radius)

    if (progress > 0) {
      this.milestone.fillStyle(KIT.coin, 0.95)
      fillRounded(this.milestone, x, y, Math.max(h, w * progress), h, radius)
    }

    this.milestone.lineStyle(Math.max(1.5, h * 0.22), KIT.muted, 0.6)
    strokeRounded(this.milestone, x, y, w, h, radius)

    // The flash marks the boundary rather than celebrating it: short, and over the bar itself so it
    // reads as *that* filling rather than as something happening to the whole frame. Computed with
    // the signature above, because it is one of the terms that decides whether this frame differs.
    if (flash > 0) {
      // **Inside the rule's own box, because the rule spans the band now.** It used to be a
      // centred bar with room either side, so the flash could overhang it; full width, the same
      // overhang runs off the frame.
      this.milestone.fillStyle(0xffffff, flash * 0.8)
      fillRounded(this.milestone, x, y - h * 0.6, w, h * 2.2, radius * 2)
    }
    void run
  }

  /**
   * Brings the drawn row into line with the run, one event at a time.
   *
   * **The diff is what makes the animation possible at all.** Rebuilding the row from
   * `lifeRowSlots` every frame would be correct and would say nothing: what the player has to see is
   * the *transition* — which element went out, and which one arrived — and a redrawn row has no
   * memory of either.
   */
  private syncRow(run: RunState, now: number): void {
    // **⚠ Clamped, because this row is driven by DELTAS and the state it mirrors is not bounded.**
    // `lifeRowSlots` clamps for its own draw, but the diff below reacts to every change — so a run
    // holding more lives than there are slots (a continue, or a harness) would hollow one heart per
    // hit while the count stayed far above zero, and the row would report losses the player had not
    // taken. Comparing the clamped value is what keeps the drawn row a function of the state rather
    // than of the history of changes to it.
    const lives = Math.max(0, Math.min(RUN_LIVES, run.lives))

    // Retire anything whose death has finished playing. A heart leaves its socket behind and a
    // shield does not, which is the asymmetry `lifeRow.ts` argues: a life is a slot, a shield is
    // carried. Done before the diff so a spend and a pickup in the same second cannot pile up.
    for (const element of this.elements) {
      if (element.diedAt >= 0 && now - element.diedAt >= LIFE_SPEND_MS) element.diedAt = -1
    }

    const gone = this.elements.filter((e) => e.kind === 'shield' && !e.filled && e.diedAt < 0)

    if (gone.length > 0) {
      this.elements = this.elements.filter((e) => !gone.includes(e))
      // The hearts close up over the gap the shield left, easing rather than snapping.
      this.slide = { by: -gone.length, at: now }
    }

    if (this.elements.length === 0) {
      // First frame of a run: the row exists before anything has happened to it, so nothing is
      // animated in. `bornAt: -1` is "has always been there" — see `progressIn`.
      this.elements = lifeRowSlots(run.shields, lives, RUN_LIVES).map((slot) => ({
        ...slot,
        bornAt: -1,
        diedAt: -1,
      }))
      this.shownShields = run.shields
      this.shownLives = lives

      return
    }

    if (run.shields > this.shownShields) {
      // A shield arrives at the front of the queue, because the front of the queue is what goes
      // first — which is the whole of what this row teaches about the pickup.
      this.elements.unshift({ kind: 'shield', filled: true, bornAt: now, diedAt: -1 })
      this.slide = { by: 1, at: now }
    } else if (run.shields < this.shownShields) {
      const shield = this.elements.find((e) => e.kind === 'shield' && e.filled)

      if (shield) {
        shield.filled = false
        shield.diedAt = now
      }
    }

    if (lives < this.shownLives) {
      // The leftmost filled heart, which is the leftmost unspent element once the shields are gone.
      const heart = this.elements.find((e) => e.kind === 'heart' && e.filled)

      if (heart) {
        heart.filled = false
        heart.diedAt = now
      }
    } else if (lives > this.shownLives) {
      // A continue puts lives back. Filled from the left, so the row grows the way it shrank.
      let toFill = lives - this.shownLives

      for (const element of this.elements) {
        if (toFill <= 0) break
        if (element.kind !== 'heart' || element.filled) continue
        element.filled = true
        element.bornAt = now
        toFill--
      }
    }

    this.shownShields = run.shields
    this.shownLives = lives
  }

  /**
   * The survivability row: shields, then hearts, spent left to right.
   *
   * Every element is the same radius on the same centre line — the two kinds differ in silhouette
   * and colour and in nothing else, which is what makes this one row rather than two counters
   * standing next to each other. See `ui/lifeRow.ts`.
   */
  private drawRow(now: number): void {

    const scale = this.rowScale
    const r = LIFE_PIP.radius * scale
    const pitch = r * 2 + LIFE_PIP.gap * scale
    const cy = this.rowBox.y + this.rowBox.h / 2
    const slid = slideEase(progressIn(this.slide.at, now, LIFE_ENTRY_MS))
    // **Rebuilt only when the drawn row would differ** — see `drawnRow`. Every term the loop below
    // reads is here: the box and the scale, the slide, and per element its kind, whether it is
    // filled, and how far through its entry and its death it is. Those last two are the only
    // `now`-dependent quantities in the draw, and they are the whole of what makes the row an
    // animation rather than a picture — so a run in which nothing has been lost or collected
    // recently is a run in which this readout is not touched at all.
    let signature = [scale, this.rowBox.x, this.rowBox.y, this.rowBox.w, this.rowBox.h, this.slide.by, slid.toFixed(3)].join(',')

    for (const element of this.elements) {
      const entry = element.bornAt >= 0 ? progressIn(element.bornAt, now, LIFE_ENTRY_MS) : 1
      const death = element.diedAt >= 0 ? progressIn(element.diedAt, now, LIFE_SPEND_MS) : -1

      signature += '|' + element.kind + (element.filled ? 1 : 0) + ':' + entry.toFixed(3) + ':' + death.toFixed(3)
    }

    if (signature === this.drawnRow) return

    this.drawnRow = signature

    this.row.clear()

    if (this.rowBox.w <= 0) return

    for (let i = 0; i < this.elements.length; i++) {
      const element = this.elements[i]
      const dying = element.diedAt >= 0
      const entering = element.bornAt >= 0 && now - element.bornAt < LIFE_ENTRY_MS
      let cx = this.rowBox.x + slotCentreX(i, scale)
      let sx = 1
      let sy = 1
      let flash = 0

      // The hearts start where they were and ease to where they now are, so an arriving shield
      // pushes the row open rather than teleporting it.
      if (element.kind === 'heart' && this.slide.by !== 0) cx -= this.slide.by * pitch * (1 - slid)

      if (entering) {
        const t = progressIn(element.bornAt, now, LIFE_ENTRY_MS)

        cx -= pitch * entryOffset(t)
        sx = sy = entryBounce(t)
      }

      if (dying) {
        const t = progressIn(element.diedAt, now, LIFE_SPEND_MS)
        const squash = spendSquash(t)

        sx = squash.x
        sy = squash.y
        flash = spendFlash(t)
      }

      // The socket first, and always: it is what says a spent life is a place a life used to be.
      // A shield has no socket — it is carried, not slotted — so it only ever draws one while it is
      // still on the row.
      // **⚠ A spent life is a hollow heart, in the heart's own colour.** Drawn in the interface's
      // muted grey it read as a different object sitting in the row rather than as a heart that has
      // gone — reported as looking strange. Same shape, same colour, no fill: the row is then one
      // vocabulary from end to end and the only thing that varies is whether an element is still
      // there.
      if (element.kind === 'heart') this.strokeSlot(cx, cy, r, 'heart', HEART_COLOR, 0.45, 1, 1)

      if (!element.filled && !dying) continue

      const colour = element.kind === 'shield' ? PICKUP_COLORS.shield.mid : this.heartColour()
      const light = element.kind === 'shield' ? PICKUP_COLORS.shield.light : HEART_LIGHT

      this.fillSlot(cx, cy, r, element.kind, colour, 1, sx, sy)
      // Lit from above, like everything else this game draws.
      this.fillSlot(cx, cy - r * 0.22, r * 0.42, element.kind, light, 0.5, sx, sy)
      this.strokeSlot(cx, cy, r, element.kind, light, 0.92, sx, sy)

      if (flash > 0) {
        // The flash is what says *now*. Drawn over the squash and slightly proud of it, so the
        // element reads as struck rather than as glowing.
        this.fillSlot(cx, cy, r * 1.12, element.kind, 0xffffff, flash * 0.85, sx, sy)
      }
    }
  }

  /**
   * What a filled heart is drawn in.
   *
   * **⚠ Red, and the only red in this game that is legal.** `THREAT_COLOR` reserves a band round
   * the warm red the whole frame means *something has landed on you* by, and every ordinary heart
   * colour is inside it — `f2617a` measures 10.2 degrees from it, `ff6b81` 9.1, and a deep crimson
   * fails as well. But the reservation has three terms and a colour clears it by defeating any one:
   * this one keeps the hue (15.5 degrees, well inside the band) and escapes on **lightness**, at
   * |dL| 0.237 against the 0.22 the rule allows. So a player reads a red heart, and the threat
   * colour keeps its meaning, because the two are never the same brightness.
   *
   * Measured: 139 degrees from the shield's green, 7.50:1 on the interface plate.
   */
  private heartColour(): number {
    return HEART_COLOR
  }


  /** One element's body, in whichever of the two silhouettes it is. */
  private fillSlot(cx: number, cy: number, r: number, kind: LifeSlotKind, colour: number, alpha: number, sx: number, sy: number): void {
    this.row.fillStyle(colour, alpha)
    this.row.fillPoints(slotPoints(cx, cy, r, kind, sx, sy), true)
  }

  /** One element's outline — the half that survives the downscale to a phone. */
  private strokeSlot(cx: number, cy: number, r: number, kind: LifeSlotKind, colour: number, alpha: number, sx: number, sy: number): void {
    this.row.lineStyle(Math.max(1.5, r * 0.15), colour, alpha)
    this.row.strokePoints(slotPoints(cx, cy, r, kind, sx, sy), true)
  }

  /**
   * The Fever tank: one segment per fruit, filling bottom-up.
   *
   * **One object showing two states rather than two bars.** The tank fills with fruit and then
   * empties as the Fever runs, and those are the same thing seen at two moments — where the pair of
   * bars this eventually replaced asked the player to read a colour to find out which question was
   * being answered. The colour still changes, and it is confirmation rather than the whole signal:
   * what says "this is a Fever" is that the tank is draining instead of filling.
   *
   * **Every segment is drawn whether or not it is lit**, which is the half a plain bar could not do:
   * the empty ones are the statement of how many more are needed, and they are on screen from the
   * first frame of a run rather than appearing as the player earns them.
   */
  private drawGauge(run: RunState, now: number, mascot?: MascotBox): void {
    const { x, y, w, h, scale } = this.gaugeBox

    if (w <= 0) return

    // **The one thing about this readout the mascot is allowed to change, and it is not where it
    // is.** The road is wider than the frame at the player's own row, so a column on the right edge
    // is crossed during ordinary steering and no width avoids it — see `gaugeYield`. The tank
    // steps back while the snail is over it and comes straight back afterwards.
    this.gauge.setAlpha(mascot ? gaugeYield(this.gaugeBox, mascot) : 1)

    const fever = run.fever.phase !== 'idle'
    // The ease counts toward the meter: a tank that emptied when the speed started coming back
    // would say the Fever was over a second before it was.
    const left = run.fever.phase === 'active' ? run.fever.msRemaining + FEVER_EASE_MS : run.fever.msRemaining
    const charge = feverCharge(run.fever)
    const fill = fever ? Math.max(0, Math.min(1, left / (FEVER_MS + FEVER_EASE_MS))) : charge

    // One pulse per fruit banked, taken from the charge going *up* — an event, not a level, so a
    // Fever draining past a threshold cannot fire it.
    if (charge > this.shownCharge) this.bankedAt = now
    this.shownCharge = charge

    const body = fever ? FEVER_BODY : FRUIT_BODY
    const lit = fever ? FEVER_LIGHT : FRUIT_LIGHT
    const segH = FRUIT_SEGMENT.height * scale
    const radius = Math.min(segH, w) * 0.32
    const full = fill >= 1 - 1e-6
    // A full tank goes on saying so; a filling one says it once, at the moment it happens. The two
    // are deliberately different kinds of motion — see `fullPulse` and `fillPulse`.
    const pulse = full ? fullPulse(now) : fillPulse(progressIn(this.bankedAt, now, FRUIT_PULSE_MS))
    const fills = pipFills(fill, FRUIT_GAUGE_PIPS)

    // **⚠ Rebuilt only when the picture would differ, because a `Graphics` is rebuilt AND replayed
    // every frame it is redrawn.** Eight segments at up to four rounded rects each is **1248
    // command-buffer entries**, measured on the shipped tank — re-tessellated on `clear()` and
    // walked again by the renderer, sixty times a second, for a readout that changes when a fruit
    // is banked and at no other time. Hiding this one object took the renderer's own pass from
    // 2.2–3.2ms to 1.62ms, which made it the largest single item in the frame.
    //
    // **The guard is the drawn values, not a clock.** Everything below reads exactly these, so two
    // frames with the same signature would produce the same commands; the alpha is set above and
    // outside it, because that is a property of the object rather than of its geometry and is what
    // lets the tank yield to the mascot without a rebuild. `pulse` is quantised to a thousandth —
    // finer than a pixel of the halo it drives, and coarse enough that a resting tank is one string.
    const signature = `${x},${y},${w},${h},${scale},${body},${lit},${full ? 1 : 0},${pulse.toFixed(3)},${fills.join(',')}`

    if (signature === this.drawnGauge) return

    this.drawnGauge = signature

    this.gauge.clear()

    for (let i = 0; i < fills.length; i++) {
      // Index 0 is the bottom, which is the whole point of the axis.
      const top = y + h - segmentOffsetY(i, scale) - segH
      const amount = fills[i]

      // The socket: a dark well the fruit sits in, so an unlit segment is a *place* for one rather
      // than a faint one. This is what carries the count when the tank is empty.
      this.gauge.fillStyle(KIT.plate, 0.72)
      fillRounded(this.gauge, x, top, w, segH, radius)

      if (amount > 0) {
        const inset = w * 0.14
        // **A partial segment is drawn as a partial segment, not rounded away.** Banking fruit is
        // already quantised, so this only ever bites while a Fever drains — and it is the one thing
        // in the tank that says it is emptying rather than sitting still. It shrinks from the top,
        // because that is the direction it filled from.
        const lh = (segH - inset) * amount

        this.gauge.fillStyle(body, 1)
        fillRounded(this.gauge, x + inset / 2, top + inset / 2 + (segH - inset - lh), w - inset, lh, radius * 0.7)
        // Lit from above, like everything else this game draws.
        this.gauge.fillStyle(lit, 0.5)
        fillRounded(this.gauge, x + inset, top + inset / 2 + (segH - inset - lh), w - inset * 2, Math.min(lh, segH * 0.3), radius * 0.5)
      }

      // The rim last, over both states, so a lit and an unlit segment are the same *shape* and the
      // tank reads as one column rather than as two groups.
      this.gauge.lineStyle(Math.max(1.2, w * 0.05), amount > 0 ? lit : KIT.muted, amount > 0 ? 0.9 : 0.5)
      strokeRounded(this.gauge, x, top, w, segH, radius)
    }

    // **⚠ The full-tank mark is drawn only once the tank IS full.** It used to sit above the
    // segments at all times, on the argument that a target which appears only when it is met is not
    // a target — and on a frame that is a stray grey bar floating over the readout, which is how it
    // was reported. What actually says where full is, and says it from the first frame of a run, is
    // the column of eight empty sockets: the target is the length of the tank. So this is not a
    // target marker at all, it is the *reached* state — and it arrives, and pulses, at the one
    // moment the player has something to do about it.
    const over = w * FULL_MARK.overhang
    const thickness = Math.max(2, w * FULL_MARK.thickness)
    const markY = y - thickness - FULL_MARK.standoff * w

    if (full) {
      this.gauge.fillStyle(lit, 0.75 + pulse * 0.25)
      fillRounded(this.gauge, x - over, markY, w + over * 2, thickness, thickness / 2)
    }

    if (pulse > 0.01) {
      // The pulse is a halo around the whole tank rather than a change of its colour: the colour is
      // already carrying which of the two states this is in, and a readout that says two things
      // with one channel says neither.
      const top = full ? markY - 2 : y - 2

      this.gauge.lineStyle(Math.max(2, w * 0.09), lit, pulse * (full ? 0.5 : 0.75))
      strokeRounded(this.gauge, x - over * 0.5, top, w + over, y + h - top + 4, radius * 1.6)
    }
  }


  /**
   * Sets and places the two readouts that share the top row.
   *
   * **⚠ Called from `update` as well as from `layout`, because the distance grows all run.** They
   * never competed before — the coins were on a second line under the exit — and fitted once at
   * layout the row overlapped by 74px the first time it was looked at on a 320px frame: the fit was
   * measured while the readout still said `0 m` and never asked again once it said `1.39 km`.
   *
   * That is the rule this project already states twice, arriving a third time: **a thing sized or
   * positioned from another thing's text has to be sized where that text is written.** The shield
   * pips landed on the lives for it, and the speed badge's chrome draws in `update` for it.
   *
   * Both ends take the *same* factor: the icon and the number are one size by the brief, and a row
   * whose two ends were set at two sizes reads as a heading with a footnote rather than as a row.
   *
   * **⚠ And it only re-fits when one of its own inputs has changed, because the measurement is not
   * free and on a phone it ran twice.** `Text.setFontSize` re-renders the string to a canvas and
   * re-uploads that canvas to the GPU on every *change* — and the fit is measured by setting the
   * base face, reading the drawn widths, and then setting the fitted one. Where the row fits
   * (`fit === 1`, i.e. every desktop frame) the second call never happens and the first is a no-op
   * after the first frame. Where it does **not** fit — which is a phone, and is the entire reason
   * this method exists — every frame went base -> measure -> smaller, so both readouts were
   * re-rendered twice a frame forever.
   *
   * Measured in the running game at 375x667: **4.08 `updateText` calls and 4.08 `texImage2D`
   * uploads a frame**, costing 0.21ms of a 0.35ms HUD pass on a desktop and considerably more of a
   * phone's, where a texture upload is the expensive half. **The defect is mobile-only by
   * construction**, which is exactly how it was reported.
   *
   * The guard is the *inputs*, not a timer: the two strings and the band. Nothing else can change
   * what the fit comes out at, so a skipped frame is a frame that would have set the same two font
   * sizes it already had.
   */
  private fitRow(): void {
    const bar = this.bar

    if (bar === null) return

    const scale = this.barScale
    // The whole of what the answer depends on. `bar` is replaced wholesale by `layout`, so its
    // identity is enough to catch a resize; the two texts are what change during a run.
    const signature = `${this.distance.text}|${this.coins.text}|${scale}`

    if (this.fittedBar === bar && this.fittedRow === signature) return

    this.fittedBar = bar
    this.fittedRow = signature

    const setFaces = (size: number): void => {
      this.distance.setFontSize(size)
      this.coins.setFontSize(size)
    }
    const room = bar.coinRight - bar.left - ROW_GAP * scale

    setFaces(ROW_FONT_SIZE * scale)

    const fit = Math.min(1, room / Math.max(1, this.distance.width + this.coins.width))

    if (fit < 1) setFaces(Math.max(ROW_FONT_MIN, ROW_FONT_SIZE * scale * fit))

    this.distance.setOrigin(0, 0.5)
    this.distance.setPosition(bar.left, bar.baseline)
    // Metres at one end and coins at the other, on the row the exit is in rather than under it.
    this.coins.setOrigin(1, 0.5)
    this.coins.setPosition(bar.coinRight, bar.baseline)
  }

  /** Positions everything. Called from the scene's own `layout()`. */
  layout(width: number, height: number): void {
    // **`hudScale`, never `uiScale` — see `kitPalette.ts` for the whole argument.** A readout that
    // owns a corner has to be *bigger* on a phone, not smaller: a CSS pixel is about 40% less of an
    // inch there, so `uiScale`'s 0.94 at 375 was the same pixel count as a desktop and then a
    // little under. Every number below hangs off this one, which is why it is the only line that
    // changed for it.
    const scale = hudScale(width, height)
    const margin = 16 * scale

    // **The distance is the big number, and it is the only one.** It is what `sendScore` sends and
    // what the save records as the best, and the readout that used to be twice its size — `SCORE`,
    // distance plus what the pickups paid — agreed with neither.
    // **The distance is the big number, and it is the only one.** It is what `sendScore` sends and
    // what the save records as the best, and the readout that used to be twice its size — `SCORE`,
    // distance plus what the pickups paid — agreed with neither.
    this.exit.setFontSize(EXIT_GLYPH * scale)

    // **One band, one baseline, two insets** — see `ui/topBar.ts` for what this replaces. The band
    // is measured from the frame and from the exit's own drawn box and from nothing else, so no
    // readout in it can be positioned by the text it happens to be showing.
    const bar = topBarLayout(width, scale, { w: this.exit.width, h: this.exit.height })

    this.wash.setPosition(bar.wash.x, bar.wash.y)
    // **Whole pixels.** A stretched gradient whose bottom edge lands on a half pixel draws a 1px
    // line there — measured at 11 luminance units across an otherwise clean sky. See `WASH_PAD`.
    this.wash.setDisplaySize(Math.ceil(bar.wash.w), Math.ceil(bar.wash.h))

    this.exit.setPosition(bar.exit.x + bar.exit.w / 2, bar.exit.y + bar.exit.h / 2)
    // Drawn small, hit big: the glyph is a third of the floor it is tapped at.
    ensureMinHitArea(this.exit)

    this.bar = bar
    this.barScale = scale
    this.fitRow()

    // **⚠ The milestone rule is PART of the band now, and that is the whole of what was wrong with
    // it.** It floated above everything at 0.6 of the margin, clipped by the frame's top edge, at a
    // width solved from whatever the two corners happened to measure — a fourth element at a fourth
    // height. It is the band's own bottom edge: full width between the same two insets, so it can
    // neither be clipped nor argue with anything about where it belongs.
    this.milestoneBox = bar.rule
    this.barBottom = topBarHeight(scale, Math.max(this.exit.height, 0))

    // Centred in the upper third and above the horizon, so it is over sky rather than over the road
    // it is about — the same band, and the same reason, as the tutorial card's.
    this.plaqueScale = scale
    this.plaqueText.setFontSize(38 * scale)
    this.plaqueSub.setFontSize(24 * scale)
    this.plaqueText.setPosition(width / 2, height * PLAQUE_ROW)
    this.plaqueSub.setPosition(width / 2, height * PLAQUE_ROW + 2 * scale)

    // The row is laid out at its **longest** — every shield the run can carry plus every life — so
    // its corner does not move when a shield is picked up. Only the elements slide; the box does
    // not, which is what stops the readout jumping about the corner on every pickup.
    this.rowScale = scale
    // **⚠ Pushed below the mascot's feet, and only ever down.** The row's whole safety is the axis
    // — it sits *under* the feet, in a band no amount of steering enters — and standing the snail a
    // quarter-segment nearer for its size (`STEER_REACH_MARGIN`) moved that row from 87.4% of the
    // frame to 90.9%. On a 844x390 landscape phone that leaves 35px for a 26px row plus a 20px
    // margin, and `verify:ui` measured the result at full left lock: a 7px overlap with the snail.
    //
    // **The clamp is here rather than inside `lifeRowBox`**, which takes the frame and what it is
    // showing and nothing else — a box that could be positioned from the camera is the defect that
    // rule exists to prevent. The rest row is a *constant*, not a projection, and the scene is where
    // the two are already known.
    this.rowBox = clearOfFeet(lifeRowBox(width, height, scale, MAX_ROW_SLOTS), height, scale)

    const gauge = fruitGaugeBox(width, height, scale)

    this.gaugeBox = gauge
  }

  destroy(): void {
    for (const object of this.gameObjects) object.destroy()
  }
}


/**
 * Pushes a bottom-corner readout below the mascot's own feet, without letting it leave the frame.
 *
 * The gap is small on purpose: what it buys is a readout that is not *under* the creature, and the
 * band it has to fit in is 35px on the shortest frame the run is accepted at.
 */
function clearOfFeet(
  box: { x: number; y: number; w: number; h: number },
  height: number,
  scale: number,
): { x: number; y: number; w: number; h: number } {
  const feet = height * PLAYER_REST_Y_FRACTION
  const floor = height - FEET_CLEARANCE * scale - box.h

  return { ...box, y: Math.min(Math.max(box.y, feet + FEET_CLEARANCE * scale), Math.max(0, floor)) }
}

/** How far a bottom readout keeps off the mascot's feet and off the frame's own edge. */
const FEET_CLEARANCE = 4


/**
 * The top row's face, the gap the two readouts keep between them, and the floor the fit stops at.
 *
 * **One size for both ends of the row.** The distance is still the number the run is scored in, and
 * what says so is that it is the *first* thing in the row and the one that grows — not a bigger
 * face than the purse beside it.
 */
const ROW_FONT_SIZE = 34
const ROW_GAP = 18
const ROW_FONT_MIN = 15

/**
 * The longest the survivability row can ever be: every shield plus every life.
 *
 * Kept as one expression rather than a literal so a re-tuned `MAX_SHIELDS` or `RUN_LIVES` moves the
 * box the row is laid out in, and `verify:ui` measures the clearance against this rather than
 * against a number somebody has to remember to update.
 */
export const MAX_ROW_SLOTS = MAX_SHIELDS + RUN_LIVES

/**
 * One element's outline, as a single closed loop of points.
 *
 * **⚠ One loop, and that is the fix for a spent heart that "looked strange".** A heart drawn as two
 * circles plus a triangle is three shapes: filled they merge, but *stroked* every internal edge
 * shows, so an empty socket came out as two rings and a wedge overlapping rather than as the
 * outline of a heart. Both kinds are now one polygon, and `fillPoints`/`strokePoints` over the same
 * list is what guarantees the filled and the hollow states are the same silhouette.
 */
/**
 * A rounded rect drawn as a polygon rather than through `fillRoundedRect`.
 *
 * **⚠ Only for the two readouts that are on screen for a whole run** — see `ui/roundedRect.ts` for
 * the hundred-points-per-corner this exists to avoid, and for why every panel and card in the game
 * should go on using Phaser's own call.
 */
/**
 * `fillPoints`/`strokePoints` as they actually behave.
 *
 * **⚠ A `.d.ts` gap, not a cast around a real constraint.** Both are typed `Vector2[]`, and both
 * implementations read `points[i].x` and `points[i].y` and nothing else
 * (`Graphics.js`) — so a plain `{ x, y }` is exactly what they want and building 40 `Vector2`s a
 * redraw would be allocating 35 unused methods apiece. Same shape, and the same reason, as the
 * `MutableSound` extension `audio.ts` carries for `BaseSound.mute`.
 */
interface PointDrawable {
  fillPoints(points: RectPoint[], closeShape?: boolean): unknown
  strokePoints(points: RectPoint[], closeShape?: boolean): unknown
}

function fillRounded(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, radius: number): void {
  ;(g as unknown as PointDrawable).fillPoints(roundedRectPoints(x, y, w, h, radius), true)
}

function strokeRounded(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, radius: number): void {
  ;(g as unknown as PointDrawable).strokePoints(roundedRectPoints(x, y, w, h, radius), true)
}

function slotPoints(cx: number, cy: number, r: number, kind: LifeSlotKind, sx: number, sy: number): Phaser.Math.Vector2[] {
  return kind === 'heart' ? heartPoints(cx, cy, r, sx, sy) : shieldPoints(cx, cy, r, sx, sy)
}

/**
 * The heart, from the standard parametric curve rather than assembled out of primitives.
 *
 * `HEART_STEPS` is enough that the lobes read as round at the size a phone draws this and few
 * enough that the whole row is a handful of triangles. The curve's own extent is normalised so the
 * heart fills the same box the shield does — the two must be one size, which is what makes the row
 * one row.
 */
function heartPoints(cx: number, cy: number, r: number, sx: number, sy: number): Phaser.Math.Vector2[] {
  const points: Phaser.Math.Vector2[] = []

  for (let i = 0; i < HEART_STEPS; i++) {
    const t = (i / HEART_STEPS) * Math.PI * 2
    const x = 16 * Math.sin(t) ** 3
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)

    // Screen y grows downward, so the curve's own +y (the lobes) is subtracted.
    points.push(new Phaser.Math.Vector2(cx + (x / 16) * r * sx, cy - (y / 15) * r * sy))
  }

  return points
}

const HEART_STEPS = 34

/** The shield's silhouette: flat shoulders, straight sides, a point at the bottom. */
function shieldPoints(cx: number, cy: number, r: number, sx: number, sy: number): Phaser.Math.Vector2[] {
  return [
    new Phaser.Math.Vector2(cx - r * 0.86 * sx, cy - r * 0.9 * sy),
    new Phaser.Math.Vector2(cx + r * 0.86 * sx, cy - r * 0.9 * sy),
    new Phaser.Math.Vector2(cx + r * 0.86 * sx, cy + r * 0.06 * sy),
    new Phaser.Math.Vector2(cx, cy + r * 0.98 * sy),
    new Phaser.Math.Vector2(cx - r * 0.86 * sx, cy + r * 0.06 * sy),
  ]
}

/** The mascot's drawn box, as `PlayerView` publishes it. Read for its alpha, never for its place. */
interface MascotBox {
  left: number
  right: number
  top: number
  bottom: number
}

interface RowElement {
  kind: LifeSlotKind
  filled: boolean
  /** When it arrived, or `-1` for one that has always been there. See `progressIn`. */
  bornAt: number
  /** When it was spent, or `-1` for one that is not currently going out. */
  diedAt: number
}

/**
 * What a banked fruit is drawn in.
 *
 * **⚠ Not the fruit pickup's own violet, and not the coin's gold either.** Violet on a gauge was
 * reported as reading like damage — a purple bar filling beside the mascot says "you are losing
 * something" — and the round that fixed it chose the ripe gold the other three fruit renders share.
 * That is right about the fruit and wrong about *this frame*: the coin counter is already gold, so
 * gold fruit beside it is one currency drawn twice. What is left, and what the fruit set actually
 * looks like, is a warm red-orange: ripe, unmistakably not a coin, and 60 degrees off the reserved
 * threat hue rather than in it.
 */
const FRUIT_BODY = 0xe8622f
/** The lit edge of a banked fruit. The rest of this game's art is lit from above. */
const FRUIT_LIGHT = 0xffb05c
/** A Fever's own colour: the interface palette's warning amber, which is what a Fever already is. */
const FEVER_BODY = 0xf2b431
const FEVER_LIGHT = 0xffe3a8
