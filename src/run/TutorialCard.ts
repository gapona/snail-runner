import * as Phaser from 'phaser'
import { t } from '../i18n/strings'
import { KIT } from '../ui/kitPalette'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'
import { HUD_DEPTH } from './hudDepth'
import { INK } from './artPalette'
import { currentStep, stepSatisfied, cardVisible, type TutorialState } from './tutorial'

/** A box on the HUD the current card is pointing at, in screen pixels. */
export interface HighlightRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The tutorial's one piece of interface: a title, a reason, and a tick when it is answered.
 *
 * **Top centre, which is the only band a run leaves empty.** The HUD claims the top-left corner
 * (score, distance, lives), the top-right (the leaf and the coins) and the bottom-left (the speed
 * badge); the near ground is where the mascot is, and the middle of the frame is the road the
 * player is reading obstacles out of. What is left is the strip between the two top corners, above
 * `HORIZON_Y` — so the card sits on sky and distant scenery and covers nothing the player needs.
 *
 * **It is drawn rather than tweened, and it owns no input of its own.** The road is stopped while a
 * card is up, so a card does have to be got past — but the press that does it is the game's own
 * jump binding, spent on the card by `RunScene.tryJump` while one is waiting. A widget with its own
 * pointer handler would fire twice for one tap the moment the scene did the right thing, which is
 * the rule `kitToggle` is on and for the same reason.
 *
 * What it is drawn across still follows the road: it comes up as its subject reaches the lead
 * distance and goes once that subject is behind, so the sentence and the thing it is about are on
 * screen together.
 */
export class TutorialCard {
  private readonly plate: Phaser.GameObjects.Graphics
  private readonly title: Phaser.GameObjects.Text
  private readonly why: Phaser.GameObjects.Text
  /**
   * The line that says how the card goes away.
   *
   * **The road is stopped while a card is up, so this is the only thing on screen telling the
   * player how to start it again** — which makes it the one part of the card that is a control
   * rather than a reason, and the reason it is allowed to be one.
   */
  private readonly prompt: Phaser.GameObjects.Text
  /**
   * The ring round the readout a card names, and the line from the card to it.
   *
   * Its own `Graphics` rather than more drawing on the plate's, because it is somewhere else on the
   * frame: sharing one would mean clearing and rebuilding the plate every frame to animate a pulse
   * that belongs to the ring.
   */
  private readonly pointer: Phaser.GameObjects.Graphics

  /** The frame this was last laid out for, so `update` can size the plate without re-deriving it. */
  private frame = { width: 0, height: 0, scale: 1 }
  /** Where `draw` put the plate, so the pointer can leave its edge rather than its centre. */
  private box = { left: 0, right: 0, top: 0, bottom: 0 }
  /**
   * Whether a card is on screen and whether it has been answered, so `layout` can redraw it.
   *
   * **The plate and the three lines are placed in `draw`, and `draw` runs from `update`** — which is
   * the run's own loop. Everything else on this screen is repositioned by `layout` and is therefore
   * correct the instant a frame changes size; this would have been correct only on the next tick of
   * a loop that a paused scene does not run at all. A paused scene still *renders*, so a rotation
   * with a panel open over the run would leave the card drawn for the frame before it.
   */
  private shown: { done: boolean } | null = null

  constructor(scene: Phaser.Scene) {
    this.plate = scene.add.graphics().setDepth(HUD_DEPTH)
    this.title = scene.add
      .text(0, 0, '', { fontFamily: 'Arial Black, Arial', fontSize: 26, color: toCssColor(KIT.coin) })
      .setOrigin(0.5, 0)
      .setDepth(HUD_DEPTH + 1)
    this.why = scene.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: 17, color: toCssColor(KIT.rim), align: 'center' })
      .setOrigin(0.5, 0)
      .setDepth(HUD_DEPTH + 1)
    this.prompt = scene.add
      .text(0, 0, '', { fontFamily: 'Arial Black, Arial', fontSize: 14, color: toCssColor(KIT.active) })
      .setOrigin(0.5, 0)
      .setDepth(HUD_DEPTH + 1)
    // Above the HUD it is drawn around, or the ring would sit under the very thing it points at.
    this.pointer = scene.add.graphics().setDepth(HUD_DEPTH + 2)
  }

  get gameObjects(): Phaser.GameObjects.GameObject[] {
    return [this.plate, this.title, this.why, this.prompt, this.pointer]
  }

  /**
   * How far down the HUD's own top-left column reaches, in screen pixels.
   *
   * Set by the scene each frame from `Hud.blockBottom`, so the card cannot be laid over the fruit
   * row and the lives — see `draw`. Zero until it is told, which is the right default: a card with
   * no HUD under it belongs at `CARD_TOP`.
   */
  private hudBottom = 0

  setHudBottom(y: number): void {
    this.hudBottom = y
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)

    this.frame = { width, height, scale }
    this.title.setFontSize(26 * scale)
    this.why.setFontSize(17 * scale)
    this.prompt.setFontSize(14 * scale)
    // **Wrapped to the frame rather than to a fixed width**, or the reason line — the half that
    // actually teaches anything — runs off the side of a phone. The plate is then sized from the
    // wrapped text, which is why the two are measured in that order.
    this.why.setWordWrapWidth(Math.min(width - 48 * scale, 460 * scale))
    // The wrap width has just changed, so the reason's own height has too — and the plate is sized
    // from it. Redrawn here rather than waited for, per `shown`.
    if (this.shown) this.draw(this.shown.done)
  }

  /**
   * Redraws for the current step.
   *
   * Takes the run's own `distance` rather than a visibility flag: whether a card is up is a
   * property of where the player is relative to the thing it is about, and `cardVisible` is where
   * that rule lives. Passing a boolean in would put half the rule in the scene.
   */
  update(state: TutorialState, distance: number, now = 0, rectFor?: (target: 'gauge' | 'lives') => HighlightRect): void {
    const step = currentStep(state)

    if (!step || !cardVisible(step, distance)) {
      this.shown = null
      this.setVisible(false)

      return
    }

    const done = stepSatisfied(state)
    const key = step.id.charAt(0).toUpperCase() + step.id.slice(1)

    this.setVisible(true)
    // A tick rather than a new sentence: the card has already said what the thing is for, and
    // replacing that with "well done" takes the explanation away at the moment it was understood.
    this.title.setText(`${done ? '✓ ' : ''}${t(`tutorial${key}Title` as never)}`)
    this.why.setText(t(`tutorial${key}Why` as never))
    // **The prompt is gone the moment the card is answered**, because the road is moving again and
    // a line saying how to start it would be describing something that has already happened.
    this.prompt.setText(done ? '' : t(step.kind === 'read' ? 'tutorialContinue' : 'tutorialTryIt'))
    this.prompt.setVisible(!done)
    this.shown = { done }
    this.draw(done)
    this.drawPointer(step.highlight && rectFor ? rectFor(step.highlight) : null, now)
  }

  destroy(): void {
    this.plate.destroy()
    this.title.destroy()
    this.why.destroy()
    this.prompt.destroy()
    this.pointer.destroy()
  }

  private setVisible(visible: boolean): void {
    this.plate.setVisible(visible)
    this.title.setVisible(visible)
    this.why.setVisible(visible)
    this.prompt.setVisible(visible)
    this.pointer.setVisible(visible)
  }

  /**
   * Rings the readout this card is about, and runs a line to it from the card.
   *
   * **The ring pulses, and that is what makes it a pointer rather than a border.** A static
   * rectangle round a HUD element reads as part of the HUD — the player has no reason to think it
   * is new — and this has about two seconds in which to say "that thing, in the corner, is what the
   * sentence is about".
   *
   * The line leaves whichever side of the card the target is on, so it never crosses the card's own
   * text. Both readouts a card can name are in a top corner, so that is always left or right.
   */
  private drawPointer(rect: HighlightRect | null, now: number): void {
    this.pointer.clear()

    if (!rect) {
      this.pointer.setVisible(false)

      return
    }

    const { width, scale } = this.frame
    // Two seconds is about how long a card is read for, so the pulse is slow enough to be one
    // breath rather than a flicker — the same reasoning the shield bubble's own breath is set by.
    const pulse = 0.5 + 0.5 * Math.sin((now / 900) * Math.PI * 2)
    const grow = 1 + 0.06 * pulse
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    const w = rect.w * grow
    const h = rect.h * grow

    this.pointer.setVisible(true)
    this.pointer.lineStyle(Math.max(2, 3 * scale), KIT.active, 0.55 + 0.45 * pulse)
    this.pointer.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, Math.min(h / 2, 14 * scale))

    // From the card's near edge to the ring, at the ring's own height: a line that ended on the
    // card's centre would run behind the text it belongs to.
    const cardBox = this.box
    const fromX = cx > width / 2 ? cardBox.right : cardBox.left
    const fromY = Math.min(Math.max(cy, cardBox.top + 8 * scale), cardBox.bottom - 8 * scale)
    const toX = cx > width / 2 ? cx - w / 2 : cx + w / 2

    this.pointer.lineStyle(Math.max(2, 3 * scale), KIT.active, 0.35 + 0.35 * pulse)
    this.pointer.beginPath()
    this.pointer.moveTo(fromX, fromY)
    this.pointer.lineTo(toX, cy)
    this.pointer.strokePath()
  }

  /**
   * The plate, sized from the text that is on it.
   *
   * Drawn in `update` rather than in `layout` for the reason the speed badge is: its height follows
   * how many lines the reason wrapped to, and that is not known until there is a card to show. A
   * plate laid out to a fixed size is a plate with its own text hanging out of it.
   */
  private draw(done: boolean): void {
    const { width, height, scale } = this.frame
    const pad = 12 * scale
    const gap = 4 * scale
    const promptHeight = this.prompt.visible ? gap + this.prompt.height : 0
    const boxWidth = Math.max(this.title.width, this.why.width, this.prompt.width) + pad * 2
    const boxHeight = this.title.height + gap + this.why.height + promptHeight + pad * 2
    // **⚠ Never above whatever the HUD's own left column reaches.** The status block moved into
    // the top band when the bottom one turned out to be the mascot's, and on a portrait frame both
    // the block and this card are most of the width — so a fraction of the height alone would put
    // the card straight over the fruit row. `hudBottom` is measured from the HUD rather than
    // guessed, for the reason the highlight ring is: a card carrying its own idea of where the
    // readouts are is a second opinion about it.
    const top = Math.max(height * CARD_TOP, this.hudBottom + 10 * scale)
    const left = width / 2 - boxWidth / 2

    this.title.setPosition(width / 2, top + pad)
    this.why.setPosition(width / 2, top + pad + this.title.height + gap)
    this.prompt.setPosition(width / 2, top + pad + this.title.height + gap + this.why.height + gap)

    this.box = { left, right: left + boxWidth, top, bottom: top + boxHeight }

    this.plate.clear()
    this.plate.fillStyle(INK, CARD_PLATE_ALPHA)
    this.plate.fillRoundedRect(left, top, boxWidth, boxHeight, 12 * scale)
    // The rim turns green the moment the card is answered, which is the one thing on it that
    // changes state — the tick says *that* it was answered and the rim says it at a glance.
    this.plate.lineStyle(2 * scale, done ? KIT.active : KIT.rim, done ? 0.9 : 0.35)
    this.plate.strokeRoundedRect(left, top, boxWidth, boxHeight, 12 * scale)
  }
}

/**
 * Where the card's top edge sits, as a fraction of the frame's height.
 *
 * Under the HUD's own top row and well above `HORIZON_Y` (0.62), so the card is over sky at every
 * supported aspect and never over the road. On a landscape phone the top row is tight, which is why
 * this is a fraction rather than a pixel offset from the score.
 */
const CARD_TOP = 0.13

/**
 * How solid the plate is.
 *
 * **This is interface and is allowed a plate, unlike the front screen** — which had its own strip
 * removed for reading as a slab lying across the road. The difference is that this one is
 * temporary, is over sky rather than over the picture's subject, and is carrying two lines of text
 * that have to be read at speed rather than a button that is already the loudest shape on screen.
 */
const CARD_PLATE_ALPHA = 0.72
