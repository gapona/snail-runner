import * as Phaser from 'phaser'
import { showInterstitial, showRewarded } from '../platform/adGate'
import { canShowInterstitial, createAdPolicy, noteInterstitial, type AdPolicyState } from '../platform/adPolicy'
import { bindAction } from '../platform/input'
import { sendScore } from '../platform/yt'
import { t } from '../i18n/strings'
import { getState, mutate } from '../save/store'
import { earnCoins } from '../shop/coins'
import { bindLayout } from '../ui/layout'
import { KIT, kitButton, kitTitle, plate, type KitButton, type Plate } from '../ui/kit'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'
import { playSfx } from '../audio/audio'
import { SFX } from '../audio/sfx'

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

export class RunOver extends Phaser.Scene {
  private panel!: Plate
  private title!: Phaser.GameObjects.Text
  private distanceText!: Phaser.GameObjects.Text
  private bestText!: Phaser.GameObjects.Text
  private coinText!: Phaser.GameObjects.Text
  private againButton!: KitButton
  private menuButton!: KitButton
  private doubleButton!: KitButton

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
    playSfx(SFX.RUN_OVER)

    this.panel = plate(this)
    this.title = kitTitle(this, this.metres > previousBest ? t('newBest') : t('runOver'))
    this.distanceText = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 40, color: toCssColor(KIT.active) }).setOrigin(0.5)
    this.bestText = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 18, color: toCssColor(KIT.muted) }).setOrigin(0.5)
    this.coinText = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 22, color: toCssColor(KIT.coin) }).setOrigin(0.5)

    this.againButton = kitButton(this, t('again'), { primary: true, fontSize: 26 })
    this.menuButton = kitButton(this, t('menu'), { fontSize: 18 })
    this.doubleButton = kitButton(this, t('doubleCoins'), { fontSize: 18 })
    this.doubleButton.setEnabled(this.coins > 0)

    this.refresh(getState().bestScore)

    bindAction(this, 'primary', { pointer: this.againButton.container, keys: ['SPACE', 'ENTER'] }, () => this.again())
    bindAction(this, 'close', { pointer: this.menuButton.container, keys: ['ESC'] }, () => this.toMenu())
    bindAction(this, 'openShop', { pointer: this.doubleButton.container }, () => void this.doubleCoins())

    bindLayout(this, (width, height) => this.layout(width, height))

    void this.maybeShowInterstitial()
  }

  private refresh(best: number): void {
    this.distanceText.setText(`${this.metres} m`)
    this.bestText.setText(`${t('best')} ${best} m`)
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

  private again(): void {
    this.scene.stop()
    this.scene.start('RunScene')
  }

  private toMenu(): void {
    this.scene.stop()
    this.scene.start('MainMenu')
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)
    const panelWidth = Math.min(420 * scale, width - 40 * scale)
    const panelHeight = Math.min(360 * scale, height - 40 * scale)

    // `plate.draw` is centred on the point it is given, not anchored to it.
    this.panel.draw(width / 2, height / 2, panelWidth, panelHeight)

    const top = height / 2 - panelHeight / 2
    const step = panelHeight / 7

    this.title.setFontSize(26 * scale).setPosition(width / 2, top + step * 0.7)
    this.distanceText.setFontSize(40 * scale).setPosition(width / 2, top + step * 1.8)
    this.bestText.setFontSize(18 * scale).setPosition(width / 2, top + step * 2.6)
    this.coinText.setFontSize(22 * scale).setPosition(width / 2, top + step * 3.4)
    this.againButton.setFontSize(26 * scale)
    this.againButton.container.setPosition(width / 2, top + step * 4.6)
    this.doubleButton.setFontSize(18 * scale)
    this.doubleButton.container.setPosition(width / 2, top + step * 5.6)
    this.menuButton.setFontSize(18 * scale)
    this.menuButton.container.setPosition(width / 2, top + step * 6.4)
  }
}
