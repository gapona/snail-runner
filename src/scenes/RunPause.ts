import * as Phaser from 'phaser'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { t } from '../i18n/strings'
import { bindLayout } from '../ui/layout'
import { kitButton, kitDivider, kitTitle, plate, type KitButton, type KitDivider, type Plate } from '../ui/kit'
import { KIT } from '../ui/kitPalette'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

/**
 * The run underneath, as this dialog needs it: two things it can be asked.
 *
 * **Structural rather than an import of `RunScene`**, for `ContinuableRun`'s reason — the run opens
 * the dialog and knows its key, and the dialog must not have to know the run's class to hand the
 * decision back. What "leaving" *means* stays the run's own business: an ordinary run is put down
 * and a tutorial run ends, and neither is a branch this screen takes.
 */
export interface LeavableRun {
  /** Whether leaving keeps the run to come back to, which is the only thing the body text says. */
  isSuspendable(): boolean
  /** Banks what the run earned and goes home. */
  leaveRun(): void
}

export interface RunPauseData {
  /** The paused run this dialog is drawn over. */
  run: LeavableRun
}

/**
 * The confirm in front of leaving a run.
 *
 * **⚠ The exit used to leave on the tap, with no way back.** Firing on the release rather than the
 * press is a real guard against a *steer* that begins on the glyph — see `RunScene`'s own note —
 * and it is no guard at all against a deliberate press the player immediately regrets. A run is the
 * whole product and there is no undo, so the one control that throws one away asks first.
 *
 * **The road stops while it asks, and that is the other half of it.** `launchOverlay` pauses the
 * caller, so the run's `update` — the clock, the placer, the collisions and the critters — is
 * frozen for as long as this is up. A dialog over a road still moving underneath it would be asking
 * the player to read a question while the thing it is about carries on without them, which is the
 * objection that made the tutorial's cards stop the world.
 *
 * **The body says what actually happens, and it is two sentences rather than one.** An ordinary run
 * is snapshotted and resumable from the front screen; a tutorial run cannot be resumed part way
 * through — its cards are a hand-placed stretch taught in an order that does not survive being
 * interrupted — so it ends. Telling the second player the first thing would be the dialog promising
 * something the game is about to not do.
 */
export class RunPause extends Phaser.Scene {
  private run!: LeavableRun
  private backdrop!: Phaser.GameObjects.Rectangle
  private panel!: Plate
  private title!: Phaser.GameObjects.Text
  private body!: Phaser.GameObjects.Text
  private divider!: KitDivider
  private keepButton!: KitButton
  private leaveButton!: KitButton

  constructor() {
    super('RunPause')
  }

  init(data: RunPauseData): void {
    this.run = data.run
  }

  create(): void {
    // Dims the frozen road, and swallows anything that misses the panel. The run is paused so
    // nothing underneath is listening anyway; what this buys is that the frame *reads* as stopped
    // rather than as a panel laid over a game still being played.
    this.backdrop = this.add.rectangle(0, 0, 0, 0, 0x000000, 0.55).setOrigin(0, 0).setDepth(BACKDROP_DEPTH)
    this.panel = plate(this)
    this.title = kitTitle(this, t('leaveTitle'))
    this.body = this.add
      .text(0, 0, this.run.isSuspendable() ? t('leaveSaved') : t('leaveEnds'), {
        fontFamily: 'Arial',
        fontSize: BODY_SIZE,
        color: toCssColor(KIT.muted),
        align: 'center',
      })
      .setOrigin(0.5)
    this.divider = kitDivider(this)

    // **The safe action is the solid one**, which is the whole hierarchy of this screen: a thumb
    // reaching for the obvious button must not be reaching for the one that ends the run.
    this.keepButton = kitButton(this, t('leaveKeep'), { solid: true, fontSize: 22 })
    this.leaveButton = kitButton(this, t('leaveConfirm'), { muted: true, fontSize: 18 })

    // **ESC cancels and ENTER confirms**, which is the one keyboard mapping nobody has to be taught
    // — and it is deliberately not "ENTER activates the primary button", because the primary here
    // is chosen for the thumb and a keyboard has no thumb to protect. A player who opened this with
    // ESC can therefore close it or finish it without reaching for the mouse.
    bindAction(this, 'close', { pointer: [this.keepButton.container, this.backdrop], keys: ['ESC'] }, () =>
      this.resumeRun(),
    )
    // On the tap, like every other control in this game that spends something the player cannot get
    // back — the shop's rows, the quest board's collect, and the exit that opened this.
    bindAction(this, 'primary', { pointer: this.leaveButton.container, keys: ['ENTER'], tap: true }, () => this.leave())

    bindLayout(this, (width, height) => this.layout(width, height))
  }

  /**
   * Closes, and hands the resume back to the run.
   *
   * The `isPlatformPaused` check is `Settings`' own and is here for its own reason: resuming now
   * would unpause a scene the platform still considers suspended, and skipping it without a
   * deferred handoff would leave the run paused with no interface over it and no way out.
   */
  private resumeRun(): void {
    this.scene.stop()

    if (isPlatformPaused()) {
      this.game.events.once(YTEvents.RESUME, () => this.scene.resume('RunScene'))

      return
    }
    this.scene.resume('RunScene')
  }

  /**
   * **This dialog goes first, then the run acts.** Leaving either starts `MainMenu` or launches the
   * result panel over the run, and both are arrangements this one must not still be sitting on top
   * of — scenes render in registration order, so an overlay left running would be painted over
   * whatever replaced the thing it was covering.
   */
  private leave(): void {
    this.scene.stop()
    this.run.leaveRun()
  }

  layout(width: number, height: number): void {
    this.backdrop.setSize(width, height)
    // `setInteractive` on a 0x0 object silently creates no `.input` at all, which is why the
    // backdrop is only ever made interactive here — after it has a real size. See "Responsive
    // Layout"'s first gotcha.
    if (!this.backdrop.input) this.backdrop.setInteractive()
    else this.backdrop.input.hitArea.setTo(0, 0, width, height)

    // The same measure-fit-measure pass every stacked panel in this project has needed: `uiScale`
    // scales on *width*, so a landscape phone hands back a full 1 for a stack that does not fit the
    // axis it never looks at. The wrap width moves with the scale, so the body is re-wrapped
    // against the scale that was chosen rather than the one it was measured at.
    const available = height - MIN_SCREEN_MARGIN * 2
    const base = uiScale(width)

    this.wrapBody(width, base)

    const scale = Math.max(MIN_HEIGHT_FIT * base, Math.min(base, (base * available) / this.naturalHeight(base)))
    const contentWidth = this.wrapBody(width, scale)
    const panelHeight = Math.min(this.naturalHeight(scale), available)
    const panelWidth = contentWidth + SIDE_PADDING * 2 * scale

    for (const button of [this.keepButton, this.leaveButton]) button.setMinWidth(contentWidth)

    // `plate.draw` is centred on the point it is given, not anchored to it.
    this.panel.draw(width / 2, height / 2, panelWidth, panelHeight)

    let y = height / 2 - panelHeight / 2 + TOP_PAD * scale

    this.title.setPosition(width / 2, y + this.title.height / 2)
    y += this.title.height + TITLE_GAP * scale
    this.body.setPosition(width / 2, y + this.body.height / 2)
    y += this.body.height + DIVIDER_GAP * scale

    this.divider.draw(width / 2, y, contentWidth, scale)
    y += DIVIDER_GAP * scale

    this.keepButton.container.setPosition(width / 2, y + this.keepButton.height / 2)
    y += this.keepButton.height + BUTTON_GAP * scale
    this.leaveButton.container.setPosition(width / 2, y + this.leaveButton.height / 2)
  }

  /** Sets the body's face and wrap for a scale, and returns the content width it was wrapped to. */
  private wrapBody(width: number, scale: number): number {
    const panelWidth = Math.min(PANEL_WIDTH * scale, width - MIN_SCREEN_MARGIN * 2)
    const contentWidth = panelWidth - SIDE_PADDING * 2 * scale

    this.body.setFontSize(BODY_SIZE * scale)
    this.body.setWordWrapWidth(contentWidth)

    return contentWidth
  }

  /**
   * Every gap and every text height this panel is made of, at the scale it is asked about — one
   * number, so the fit above can ask "does this scale fit?" without laying anything out.
   */
  private naturalHeight(scale: number): number {
    this.title.setFontSize(TITLE_SIZE * scale)
    this.keepButton.setFontSize(22 * scale)
    this.leaveButton.setFontSize(18 * scale)

    return (
      (TOP_PAD + BOTTOM_PAD) * scale +
      this.title.height +
      TITLE_GAP * scale +
      this.body.height +
      DIVIDER_GAP * 2 * scale +
      this.keepButton.height +
      BUTTON_GAP * scale +
      this.leaveButton.height
    )
  }
}

const PANEL_WIDTH = 380
const SIDE_PADDING = 26
const TOP_PAD = 26
const BOTTOM_PAD = 26
const TITLE_GAP = 14
const DIVIDER_GAP = 18
const BUTTON_GAP = 10
const MIN_SCREEN_MARGIN = 12
const TITLE_SIZE = 26
const BODY_SIZE = 17
/** See `RunOver`'s own note: a floor rather than an unbounded shrink. */
const MIN_HEIGHT_FIT = 0.62
/** Below the plate, which is itself below the content — see `Settings`' own note. */
const BACKDROP_DEPTH = -4
