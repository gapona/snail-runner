import * as Phaser from 'phaser'
import {
  getMusicVolume,
  getSoundVolume,
  isMusicOn,
  isSoundOn,
  setMusic,
  setMusicVolume,
  setSound,
  setSoundVolume,
} from '../audio/audio'
import { isSilent } from '../audio/volume'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { t } from '../i18n/strings'
import { mutate } from '../save/store'
import { bindLayout } from '../ui/layout'
import {
  KIT,
  kitButton,
  kitDivider,
  kitSlider,
  kitTitle,
  kitToggle,
  plate,
  type KitButton,
  type KitDivider,
  type KitSlider,
  type KitToggle,
  type Plate,
} from '../ui/kit'
import { uiScale } from '../ui/uiScale'

interface SettingsData {
  opener: string
}

/**
 * Settings, rebuilt on the game's own widget kit.
 *
 * **What changed and why.** It used to be two neon buttons whose labels read `Sound: ON` — a
 * control that says what it is rather than showing it, in a palette borrowed from the template's
 * dark demo and laid over this game's daylight sky. Now each channel is a switch and a slider, in
 * the kit's colours (see `ui/kit.ts` for the palette and where every colour in it comes from).
 *
 * **A switch *and* a slider, not one or the other.** They answer different questions and the
 * platform only ever asks one of them: YouTube can mute the game itself, and a player who comes
 * back from that must find their volume where they left it. Collapsing the pair into a single
 * number means the number has to remember its own pre-mute value, which is a switch with extra
 * steps — see `save/types.ts`'s note on `SaveSettings`.
 *
 * **The slider dims when the channel is switched off** rather than disappearing: a control that
 * vanishes leaves the player wondering whether the feature exists. It is also *why* the row says
 * `Muted` — a silent game with no explanation reads as broken, and the one thing this screen can
 * usefully tell the player is which of the two reasons applies.
 */
const PANEL_WIDTH = 380
const TOP_PAD = 22
const BOTTOM_PAD = 18
const TITLE_HEIGHT = 46
const SECTION_HEIGHT = 30
const CHANNEL_HEIGHT = 84
const FOOTER_HEIGHT = 62
/**
 * The row that offers the tutorial again.
 *
 * **⚠ Without it the tutorial is a thing that happened to the player once.** It runs on the first
 * run and writes a flag; a player who skidded through it, or who came to the game before it
 * existed and was migrated past it on purpose (see `upgradeV11ToV12`), would otherwise have no way
 * to ask for it. A muted button rather than a primary one: it is the third thing on this screen and
 * the way out is still the loudest.
 */
const REPLAY_HEIGHT = 58
const SIDE_PADDING = 24

/**
 * The panel's height at scale 1, and the two bounds on shrinking it.
 *
 * `MIN_HEIGHT_FIT` is a floor rather than an unbounded shrink because past it the type stops being
 * readable and the tap targets stop clearing 44px — at which point the honest answer is a panel that
 * overflows a viewport nothing can lay this out in, not one nobody can use.
 */
const PANEL_UNIT_HEIGHT =
  TOP_PAD + TITLE_HEIGHT + SECTION_HEIGHT + CHANNEL_HEIGHT * 2 + REPLAY_HEIGHT + FOOTER_HEIGHT + BOTTOM_PAD
const MIN_SCREEN_MARGIN = 12
const MIN_HEIGHT_FIT = 0.62

/** Below the plate's own negative depth — see the backdrop's own note in `create()`. */
const BACKDROP_DEPTH = -10

const TITLE_FONT_SIZE = 26
const SECTION_FONT_SIZE = 14
const LABEL_FONT_SIZE = 19
const STATUS_FONT_SIZE = 13
const CLOSE_FONT_SIZE = 20

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/** One audio channel: a name, a switch, a slider, and a reason it is silent when it is. */
interface Channel {
  label: Phaser.GameObjects.Text
  status: Phaser.GameObjects.Text
  toggle: KitToggle
  slider: KitSlider
  isOn: () => boolean
}

export class Settings extends Phaser.Scene {
  private openerKey = ''
  private backdrop!: Phaser.GameObjects.Rectangle
  private panel!: Plate
  private title!: Phaser.GameObjects.Text
  private section!: Phaser.GameObjects.Text
  private soundChannel!: Channel
  private musicChannel!: Channel
  private closeButton!: KitButton
  private replayButton!: KitButton
  private divider!: KitDivider

  constructor() {
    super('Settings')
  }

  create(data: SettingsData) {
    this.openerKey = data.opener

    // Sized 0x0 here on purpose — `layout()` is the only place that sets real dimensions, and
    // `setInteractive()` is deliberately not called yet: Phaser silently creates no `.input` at all
    // for a 0x0 object, so an interactive backdrop has to wait for a real size. See CLAUDE.md
    // "Responsive Layout", gotcha #1.
    this.backdrop = this.add.rectangle(0, 0, 0, 0, 0x04121e, 0.66)
    // Explicitly below the plate. `plate()` puts its own graphics at a *negative* depth so it sits
    // under its contents (see `ui/kit.ts`), and a backdrop left at the default 0 therefore draws over
    // the panel rather than behind it — the panel still shows, dimmed by the very scrim meant to dim
    // the world behind it. Nothing errors and it looks plausible, which is why the depth is stated.
    this.backdrop.setDepth(BACKDROP_DEPTH)

    this.panel = plate(this)
    this.title = kitTitle(this, t('settings'), TITLE_FONT_SIZE)
    this.section = this.add
      .text(0, 0, t('audio').toUpperCase(), { fontFamily: 'Arial', fontSize: SECTION_FONT_SIZE, color: css(KIT.muted) })
      .setOrigin(0, 0.5)

    this.soundChannel = this.createChannel(t('sound'), isSoundOn(), getSoundVolume(), setSound, setSoundVolume)
    bindAction(this, 'toggleSound', { pointer: this.soundChannel.toggle.container, keys: ['S'] }, () =>
      this.soundChannel.toggle.toggle(),
    )

    this.musicChannel = this.createChannel(t('music'), isMusicOn(), getMusicVolume(), setMusic, setMusicVolume)
    bindAction(this, 'toggleMusic', { pointer: this.musicChannel.toggle.container, keys: ['M'] }, () =>
      this.musicChannel.toggle.toggle(),
    )

    // Both channels describe themselves before the first frame, not after the first interaction.
    this.refresh()

    // Between the two channels, so they read as two settings rather than as four rows.
    this.divider = kitDivider(this)
    // Clears the flag rather than starting a run: this panel is `launch`ed over whatever opened it,
    // and starting a scene from here would leave that one alive underneath — the same two-worlds
    // trap the result screen's Menu button fell into. The next run picks the flag up and teaches.
    this.replayButton = kitButton(this, t('tutorialReplay'), { muted: true, fontSize: SECTION_FONT_SIZE + 4 })
    bindAction(this, 'replayTutorial', { pointer: this.replayButton.container, keys: ['T'] }, () => {
      mutate((state) => {
        state.tutorialDone = false
      })
      this.replayButton.setText(`✓ ${t('tutorialReplay')}`)
    })
    this.closeButton = kitButton(this, t('close'), { primary: true, fontSize: CLOSE_FONT_SIZE })
    bindAction(this, 'close', { pointer: this.closeButton.container, keys: ['ESC', 'ENTER'] }, () => this.close())

    // The sliders own scene-level pointer listeners (a drag is not an action — see `ui/kit.ts`), so
    // they have to be torn down explicitly. `Systems.shutdown()` does not do it for them.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.soundChannel.slider.destroy()
      this.musicChannel.slider.destroy()
      this.panel.destroy()
    })

    bindLayout(this, (width, height) => this.layout(width, height))
  }

  layout(width: number, height: number): void {
    // **`uiScale` scales on width, and a landscape phone is wide.** At 844x390 it hands back a full
    // 1, so the panel keeps its whole 346px height inside a 390px frame — inside it, but with 22px
    // to spare, and one shorter viewport away from pushing the Close button off the bottom. Every
    // fixed-height stack in this project has needed the same second pass against the axis `uiScale`
    // does not look at; the menu's button stack and the wave banner each learned it the hard way.
    const scale = uiScale(width) * this.heightFit(uiScale(width), height)
    const panelWidth = Math.min(PANEL_WIDTH * scale, width - 24)
    const panelHeight = PANEL_UNIT_HEIGHT * scale
    const cx = width / 2
    const cy = height / 2
    const panelTop = cy - panelHeight / 2
    const contentWidth = panelWidth - SIDE_PADDING * 2 * scale

    this.backdrop.setPosition(cx, cy).setSize(width, height)
    if (!this.backdrop.input) {
      this.backdrop.setInteractive()
    } else {
      ;(this.backdrop.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height)
    }

    this.panel.draw(cx, cy, panelWidth, panelHeight)

    this.title.setFontSize(TITLE_FONT_SIZE * scale)
    this.title.setPosition(cx, panelTop + (TOP_PAD + TITLE_HEIGHT / 2) * scale)

    this.section.setFontSize(SECTION_FONT_SIZE * scale)
    this.section.setPosition(cx - contentWidth / 2, panelTop + (TOP_PAD + TITLE_HEIGHT + SECTION_HEIGHT / 2) * scale)

    let cursor = panelTop + (TOP_PAD + TITLE_HEIGHT + SECTION_HEIGHT) * scale

    this.layoutChannel(this.soundChannel, cx, cursor, contentWidth, scale)
    cursor += CHANNEL_HEIGHT * scale
    // Midway between the sound slider and the music label — `cursor` is exactly that point,
    // because a channel's own content ends well above its allotted height.
    this.divider.draw(cx, cursor + 4 * scale, contentWidth, scale)
    this.layoutChannel(this.musicChannel, cx, cursor, contentWidth, scale)
    cursor += CHANNEL_HEIGHT * scale

    this.replayButton.setFontSize((SECTION_FONT_SIZE + 4) * scale)
    this.replayButton.setMinWidth(contentWidth)
    this.replayButton.container.setPosition(cx, cursor + (REPLAY_HEIGHT / 2) * scale)
    cursor += REPLAY_HEIGHT * scale

    this.closeButton.setFontSize(CLOSE_FONT_SIZE * scale)
    // The full content width, like every other panel's footer button. Half of it read as a control
    // that had been squeezed rather than as the way out of the screen.
    this.closeButton.setMinWidth(contentWidth)
    this.closeButton.container.setPosition(cx, panelTop + panelHeight - (BOTTOM_PAD + FOOTER_HEIGHT / 2) * scale)
  }

  /**
   * How much the panel has to shrink to fit the viewport's height, `0..1`.
   *
   * A single factor applied to the whole scale rather than a squeezed layout: the panel's proportions
   * are what make it readable, and a version that only compressed the gaps would put the switch and
   * the slider in one another's tap targets — which is worse than a smaller panel.
   */
  private heightFit(scale: number, height: number): number {
    const wanted = PANEL_UNIT_HEIGHT * scale
    const available = height - MIN_SCREEN_MARGIN * 2

    return wanted <= available ? 1 : Math.max(MIN_HEIGHT_FIT, available / wanted)
  }

  /** A channel is two rows: name and switch, then the slider under them. */
  private layoutChannel(channel: Channel, cx: number, top: number, contentWidth: number, scale: number): void {
    const nameRow = top + 24 * scale
    const sliderRow = top + 60 * scale

    channel.label.setFontSize(LABEL_FONT_SIZE * scale)
    channel.label.setPosition(cx - contentWidth / 2, nameRow)

    channel.status.setFontSize(STATUS_FONT_SIZE * scale)
    channel.status.setPosition(cx - contentWidth / 2 + channel.label.width + 10 * scale, nameRow + 1 * scale)

    channel.toggle.layout(scale)
    channel.toggle.container.setPosition(cx + contentWidth / 2 - channel.toggle.width / 2, nameRow)

    channel.slider.layout(cx, sliderRow, contentWidth, scale)
  }

  private createChannel(
    label: string,
    initialOn: boolean,
    initialVolume: number,
    onToggle: (on: boolean) => void,
    onVolume: (volume: number) => void,
  ): Channel {
    const labelText = this.add
      .text(0, 0, label, { fontFamily: 'Arial', fontSize: LABEL_FONT_SIZE, color: css(KIT.rim) })
      .setOrigin(0, 0.5)
    const statusText = this.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: STATUS_FONT_SIZE, color: css(KIT.muted) })
      .setOrigin(0, 0.5)

    const channel: Channel = {
      label: labelText,
      status: statusText,
      toggle: kitToggle(this, initialOn, (on) => {
        onToggle(on)
        this.refresh()
      }),
      // **The slider is unlabelled, and losing that label is the point.** Both channels used to
      // carry a row reading "Volume" under a row reading "Sound" or "Music", so the panel said
      // `Volume` twice and neither one told the player which channel it belonged to — the answer
      // was the line above it, which is where the name already was. Dropping it also hands the
      // track the 30% of the row the label was reserving, which on a phone is the difference
      // between a rail a thumb can aim at and one it cannot. See `kitSlider`.
      slider: kitSlider(this, '', initialVolume, (volume) => {
        onVolume(volume)
        this.refresh()
      }),
      isOn: () => channel.toggle.value(),
    }

    return channel
  }

  /**
   * Re-derives what each channel says about itself.
   *
   * Called from both controls rather than only from the one that changed, because they describe one
   * state between them: a slider dragged to zero silences a channel whose switch is still on, and a
   * switch turned off silences one whose slider is at 80%. Either way the player is owed the reason.
   */
  private refresh(): void {
    for (const channel of [this.soundChannel, this.musicChannel]) {
      const on = channel.isOn()
      const silent = !on || isSilent(channel.slider.value())

      channel.slider.setEnabled(on)
      channel.status.setText(silent ? t('muted') : '')
      channel.label.setColor(css(on ? KIT.rim : KIT.muted))
    }
  }

  private close(): void {
    this.scene.stop()

    if (isPlatformPaused()) {
      // A platform pause (e.g. the YouTube tab backgrounded) started while Settings was open.
      // Resuming the opener now would unpause gameplay/audio the platform still considers
      // suspended; defer until the matching YTEvents.RESUME actually fires.
      this.game.events.once(YTEvents.RESUME, () => {
        this.scene.resume(this.openerKey)
      })
      return
    }

    this.scene.resume(this.openerKey)
  }
}
