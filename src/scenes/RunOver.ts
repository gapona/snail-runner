import * as Phaser from 'phaser'
import { showInterstitial, showRewarded } from '../platform/adGate'
import { canShowInterstitial, createAdPolicy, noteInterstitial, type AdPolicyState } from '../platform/adPolicy'
import { bindAction } from '../platform/input'
import { sendScore } from '../platform/yt'
import { t } from '../i18n/strings'
import { getState, mutate } from '../save/store'
import { earnCoins } from '../shop/coins'
import { bindLayout } from '../ui/layout'
import { formatCount } from '../ui/format'
import { KIT, kitButton, kitDivider, kitTitle, plate, type KitButton, type KitDivider, type Plate } from '../ui/kit'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

/**
 * The screen at the end of a run: what you got, and the two things you can do next.
 *
 * **This is the only place an ad may appear.** Not between biomes, not on a hit, not on a pause —
 * an interstitial mid-run in a game whose whole subject is momentum is the worst possible
 * interruption, and a rewarded ad offered mid-run would make the reward a reason to die. The
 * policy (`platform/adPolicy.ts`) further limits it by session count, by gap and by a first-run
 * grace period, all of which are checked here rather than assumed.
 *
 * **Every rewarded offer has a coin alternative**, which is the rule the platform's own guidelines
 * ask for and the rule that keeps the game honest: nothing here is only purchasable with attention.
 *
 * Launched with `scene.launch('RunOver', { ... })` over the paused run, the same overlay shape
 * `Settings` and `Shop` use — and, like them, registered in `platform/lifecycle.ts`'s
 * `OVERLAY_SCENES` so a platform pause cannot freeze its own buttons.
 */
export interface RunOverData {
  /** Distance travelled this run, in world units. */
  distance: number
  /** Coins collected this run, before any doubling. */
  coins: number
}

/** One world unit is a centimetre; the HUD and this screen both count in metres. */
const UNITS_PER_METRE = 100

/**
 * The panel's own measurements. Gaps rather than row heights, because every block on this screen is
 * sized by its own text — see `layout`.
 */
const PANEL_WIDTH = 420
const SIDE_PADDING = 26
const TOP_PAD = 24
const BOTTOM_PAD = 24
const TITLE_GAP = 14
const BEST_GAP = 6
const COIN_GAP = 14
const DIVIDER_GAP = 18
const BUTTON_GAP = 10
const MIN_SCREEN_MARGIN = 12
/**
 * How far the panel may shrink to fit a short viewport.
 *
 * A floor rather than an unbounded shrink, for the reason `Settings` states: past it the type stops
 * being readable and the buttons stop clearing 44px, and the honest answer to a viewport nothing can
 * lay this out in is a panel that overflows rather than one nobody can use. The buttons keep their
 * own 44px floor regardless — `kitButton` enforces it — so what this bounds is the type.
 */
const MIN_HEIGHT_FIT = 0.62

export class RunOver extends Phaser.Scene {
  private panel!: Plate
  private title!: Phaser.GameObjects.Text
  private distanceText!: Phaser.GameObjects.Text
  private bestText!: Phaser.GameObjects.Text
  private coinText!: Phaser.GameObjects.Text
  private againButton!: KitButton
  private menuButton!: KitButton
  private doubleButton!: KitButton
  private divider!: KitDivider

  private metres = 0
  private coins = 0
  private doubled = false

  /**
   * The session's ad policy.
   *
   * **Static, because a scene is rebuilt on every run and the policy is about the session.** An
   * instance field would reset the session's interstitial count every time the player died, which
   * is exactly the opposite of what a per-session cap is for.
   */
  private static policy: AdPolicyState = createAdPolicy()

  constructor() {
    super('RunOver')
  }

  create(data: RunOverData) {
    this.metres = Math.floor(data.distance / UNITS_PER_METRE)
    this.coins = data.coins
    this.doubled = false

    const previousBest = getState().bestScore

    // **Banked before anything else can go wrong.** The score and the coins are the only things a
    // run produces, and an ad or a scene change between earning and saving them is a run the player
    // played for nothing.
    mutate((state) => {
      state.bestScore = Math.max(state.bestScore, this.metres)
      state.coins = earnCoins(state.coins, this.coins)
    })
    // Rounded to an integer by `sendScore` itself — the SDK rejects a float, and a distance in
    // metres is already one.
    sendScore(this.metres)
    // **The crash sound is not here any more.** It plays on the frame the snail comes apart, which
    // is a second earlier — a sound that belongs to an event and arrives with the screen reporting
    // it is a sound the player hears as belonging to the screen. See `RunScene.crash`.

    this.panel = plate(this)
    this.title = kitTitle(this, this.metres > previousBest ? t('newBest') : t('runOver'))
    this.distanceText = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 52, color: toCssColor(KIT.active) }).setOrigin(0.5)
    this.bestText = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 16, color: toCssColor(KIT.muted) }).setOrigin(0.5)
    this.coinText = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 22, color: toCssColor(KIT.coin) }).setOrigin(0.5)
    this.divider = kitDivider(this)

    // **Three actions, three weights.** They used to be an accent-outlined button and two identical
    // ones, so `Double coins` and `Menu` were separated by their labels and nothing else. `Again` is
    // the one thing a player who just died wants, so it is the kit's `solid` — the single control on
    // a screen allowed to read as a filled button rather than a frame; the rewarded offer keeps the
    // ordinary outline; and leaving is `muted`, because it is the way *out* of the loop the rest of
    // the screen exists to restart.
    this.againButton = kitButton(this, t('again'), { solid: true, fontSize: 26 })
    this.menuButton = kitButton(this, t('menu'), { muted: true, fontSize: 17 })
    this.doubleButton = kitButton(this, t('doubleCoins'), { fontSize: 17 })
    this.doubleButton.setEnabled(this.coins > 0)

    this.refresh(getState().bestScore)

    bindAction(this, 'primary', { pointer: this.againButton.container, keys: ['SPACE', 'ENTER'] }, () => this.again())
    bindAction(this, 'close', { pointer: this.menuButton.container, keys: ['ESC'] }, () => this.toMenu())
    bindAction(this, 'openShop', { pointer: this.doubleButton.container }, () => void this.doubleCoins())

    bindLayout(this, (width, height) => this.layout(width, height))

    void this.maybeShowInterstitial()
  }

  private refresh(best: number): void {
    this.distanceText.setText(`${formatCount(this.metres)} m`)
    this.bestText.setText(`${t('best')} ${formatCount(best)} m`)
    this.coinText.setText(this.coins > 0 ? `🪙 +${this.coins}` : '')
  }

  /**
   * Shows an interstitial, if the policy allows one.
   *
   * `betweenRuns` is `true` by construction here — this scene only exists between runs — and it is
   * still passed explicitly rather than hardcoded inside the policy, so the policy stays a pure
   * function of its inputs and `verify:*` can ask it about both cases.
   */
  private async maybeShowInterstitial(): Promise<void> {
    const now = this.time.now

    if (!canShowInterstitial(RunOver.policy, now, true)) return

    noteInterstitial(RunOver.policy, now)
    await showInterstitial(this.game)
  }

  /**
   * The rewarded offer: watch an ad, double the run's coins.
   *
   * **The coin alternative is the run itself.** Nothing here is only obtainable through an ad —
   * the coins were already banked before this button existed, and this doubles them. A player who
   * never watches one is slower, never blocked.
   */
  private async doubleCoins(): Promise<void> {
    if (this.doubled || this.coins <= 0) return

    this.doubled = true
    this.doubleButton.setEnabled(false)

    const granted = await showRewarded(this.game, 'coins-double')

    if (!granted) return

    mutate((state) => {
      state.coins = earnCoins(state.coins, this.coins)
    })
    this.coins *= 2
    this.refresh(getState().bestScore)
  }

  /**
   * Back to the road.
   *
   * `start` on the paused `RunScene` shuts it down and boots it again, so the world this panel was
   * drawn over is rebuilt rather than resumed — which is what makes the next run a new run.
   */
  private again(): void {
    this.scene.stop()
    this.scene.start('RunScene')
  }

  /**
   * Out to the front screen.
   *
   * **⚠ `RunScene` has to be stopped by name, and leaving it paused hung the game.** This panel is
   * `launch`ed over a *paused* run, not a stopped one — see `RunScene.endRun` — so `Again` works by
   * accident of `start` restarting the very scene it names, while `Menu` named a different one and
   * left the run alive underneath. `MainMenu` then builds its own `WorldView`, which regenerates
   * every themed texture while the paused run's `Mesh2D` is still holding them, and the renderer
   * throws on `glTexture` of null a frame later.
   *
   * That is the precondition `applyTheme` documents, reached from a third direction: this file
   * already records it for `scene.start('RunScene')` over a live `MainMenu`, and CLAUDE.md records
   * it again for the shop being opened twice. **Two worlds may never be alive at once**, and the
   * scene that is leaving is the one that has to say so.
   */
  private toMenu(): void {
    this.scene.stop('RunScene')
    this.scene.stop()
    this.scene.start('MainMenu')
  }

  /**
   * Every gap and every text height this panel is made of, at the scale it is asked about.
   *
   * Measured rather than assumed, because each block is sized by its own text — and returned as one
   * number so the fit below can ask "does this scale fit?" without laying anything out.
   */
  private naturalHeight(scale: number): number {
    this.title.setFontSize(26 * scale)
    this.distanceText.setFontSize(52 * scale)
    this.bestText.setFontSize(16 * scale)
    this.coinText.setFontSize(22 * scale)
    this.againButton.setFontSize(26 * scale)
    this.doubleButton.setFontSize(17 * scale)
    this.menuButton.setFontSize(17 * scale)

    const readout =
      this.title.height +
      TITLE_GAP * scale +
      this.distanceText.height +
      BEST_GAP * scale +
      this.bestText.height +
      COIN_GAP * scale +
      this.coinText.height
    const actions =
      this.againButton.height + BUTTON_GAP * scale + this.doubleButton.height + BUTTON_GAP * scale + this.menuButton.height

    return (TOP_PAD + BOTTOM_PAD) * scale + readout + DIVIDER_GAP * 2 * scale + actions
  }

  layout(width: number, height: number): void {
    // **`uiScale` scales on width, and a landscape phone is wide.** At 844x390 it hands back a full
    // 1 and this panel wants 422px inside a 390px frame — so the stack has to be fitted against the
    // axis `uiScale` never looks at. Every fixed stack in this project has needed the same second
    // pass; the settings panel, the menu's button column and the wave banner each learned it, and
    // the result screen learned it once before by hanging its own button off the bottom of its own
    // plate. Measured, then scaled, then measured again, because the fonts move with the scale.
    const available = height - MIN_SCREEN_MARGIN * 2
    const base = uiScale(width)
    const scale = Math.max(MIN_HEIGHT_FIT * base, Math.min(base, (base * available) / this.naturalHeight(base)))
    const panelHeight = Math.min(this.naturalHeight(scale), available)
    const panelWidth = Math.min(PANEL_WIDTH * scale, width - MIN_SCREEN_MARGIN * 2)
    const contentWidth = panelWidth - SIDE_PADDING * 2 * scale

    // **Every button is the content width, and the hierarchy is carried by weight.** They were
    // auto-sized to their own labels and centred, which made a ragged column of three different
    // widths — and read as three alternatives rather than as one obvious action with two ways past
    // it. One column also means the stack's width no longer depends on how long a translation is.
    for (const button of [this.againButton, this.doubleButton, this.menuButton]) button.setMinWidth(contentWidth)

    // `plate.draw` is centred on the point it is given, not anchored to it.
    this.panel.draw(width / 2, height / 2, panelWidth, panelHeight)

    let y = height / 2 - panelHeight / 2 + TOP_PAD * scale

    this.title.setPosition(width / 2, y + this.title.height / 2)
    y += this.title.height + TITLE_GAP * scale
    this.distanceText.setPosition(width / 2, y + this.distanceText.height / 2)
    y += this.distanceText.height + BEST_GAP * scale
    this.bestText.setPosition(width / 2, y + this.bestText.height / 2)
    y += this.bestText.height + COIN_GAP * scale
    this.coinText.setPosition(width / 2, y + this.coinText.height / 2)
    y += this.coinText.height + DIVIDER_GAP * scale

    this.divider.draw(width / 2, y, contentWidth, scale)
    y += DIVIDER_GAP * scale

    for (const button of [this.againButton, this.doubleButton, this.menuButton]) {
      button.container.setPosition(width / 2, y + button.height / 2)
      y += button.height + BUTTON_GAP * scale
    }
  }
}
