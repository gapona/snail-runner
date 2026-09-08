import * as Phaser from 'phaser'
import { showInterstitial, showRewarded } from '../platform/adGate'
import {
  canOfferContinue,
  canShowInterstitial,
  noteContinue,
  noteInterstitial,
  resetForNewRun,
  sessionAdPolicy,
  type AdPolicyState,
} from '../platform/adPolicy'
import { bindAction } from '../platform/input'
import { sendScore } from '../platform/yt'
import { t } from '../i18n/strings'
import { getState, mutate } from '../save/store'
import { canAfford, earnCoins, spendCoins } from '../shop/coins'
import { CONTINUE_COINS } from '../shop/adCatalog'
import { bindLayout } from '../ui/layout'
import { formatCount } from '../ui/format'
import { KIT, kitButton, kitDivider, kitTitle, plate, type KitButton, type KitDivider, type Plate } from '../ui/kit'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

/**
 * The run underneath, as this screen needs it: one thing it can be asked to do.
 *
 * **Structural rather than an import of `RunScene`**, which is what keeps the dependency pointing
 * one way — the run launches the panel and knows its key, and the panel must not have to know the
 * run's class to hand it back the road.
 */
export interface ContinuableRun {
  /**
   * Whether a continue would actually do anything, asked before this panel commits to one.
   *
   * **⚠ Without it the game freezes, and it did.** Both continue paths stop this panel and *then*
   * call `continueRun`, which is deliberate — the panel has to go first or the road runs for a frame
   * underneath a screen reporting that it stopped. But `continueRun` refuses a run that is not over,
   * and the moment stages existed there was a second way for a run to end: reaching its finish. A
   * cleared stage therefore offered a continue, the panel stopped itself, the refusal did nothing,
   * and the player was left looking at a paused road with no interface on it and no way out.
   *
   * So the question is asked separately from the doing. A panel that has stopped itself cannot put
   * itself back.
   */
  canContinue(): boolean
  /** Puts the player back where they crashed, with a life and a window of grace. */
  continueRun(): void
}

/**
 * The screen at the end of a run: what you got, and what there is to do about it.
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
  /**
   * Coins collected *since the last time this screen banked any*, before any doubling.
   *
   * Not the run's total: a continue means the run ends twice and the coins from before the crash
   * have already been paid in. See `RunScene.bankedCoins`.
   */
  coins: number
  /** The paused run this panel is drawn over, for the rewarded continue. */
  run?: ContinuableRun
  /**
   * Whether the player asked to leave rather than the run ending on its own.
   *
   * **Only the continue offer turns on this.** A quit run is still a run: its coins, its quests and
   * its distance are banked exactly as a crashed one's are, and the panel says the same thing. What
   * it must not do is offer to *continue* — the player has just said they are done, and a rewarded
   * ad attached to that is an ad attached to nothing.
   */
  quit?: boolean
  /**
   * What the run's close passes were worth, in points.
   *
   * ## ⚠ It was accumulated all run and read by nothing at all
   *
   * `RunState.bonus` is written on every scoring pass by `earnBonus` and — until this line — had
   * exactly two other mentions in the codebase: the suspend snapshot that carries it, and the check
   * that asserts the snapshot carries it. **Nothing displayed it.** So the reward for going near
   * things was a plaque that flashed for a second and a total that existed only inside the run, and
   * a player who asked what the close passes had added up to had nowhere to look.
   *
   * It is the sixth piece of authored state this project has found doing nothing, after
   * `cooldownMs`, `fanScale`, `arcRelaid`, `SFX.MILESTONE` and `PICKUP_WEIGHTS` — and it is the one
   * that made the reward itself read as worthless, which is how it was reported.
   *
   * **Here rather than in the HUD**, because it is a *total*: the run already announces each pass
   * where the player is looking, and a second live counter in a corner would be one more number to
   * read while steering. What was missing is the sentence at the end — distance is how far you got,
   * this is what you were willing to go near to get there.
   */
  bonus?: number
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
  private bonusText!: Phaser.GameObjects.Text
  private coinText!: Phaser.GameObjects.Text
  private againButton!: KitButton
  private menuButton!: KitButton
  /**
   * Offered only when the run actually banked something. See `create`.
   *
   * Optional for the reason the two continue offers are: a control the screen does not show is
   * cheaper to reason about than one it shows and refuses.
   *
   * **⚠ `| null`, not `?`, and that is not a style choice.** Every one of these three has to be
   * cleared in `create` (see `clearOptionalButtons`), and a field that can simply be *absent* reads
   * as one nobody has to clear — which is exactly how this one came to be the one that was not.
   */
  private doubleButton: KitButton | null = null
  /** Only built when the offer is actually available — see `create`. */
  private continueButton: KitButton | null = null
  /** The same continue, bought rather than watched — see its construction for why it exists. */
  private continueCoinsButton: KitButton | null = null
  /** Every button on the panel, top to bottom, so the fit and the layout cannot disagree. */
  private actions: KitButton[] = []
  private divider!: KitDivider

  private metres = 0
  private coins = 0
  private bonus = 0
  private doubled = false
  private continuing = false
  private quit = false
  private run: ContinuableRun | null = null

  /**
   * The session's ad policy.
   *
   * **Static, because a scene is rebuilt on every run and the policy is about the session.** An
   * instance field would reset the session's interstitial count every time the player died, which
   * is exactly the opposite of what a per-session cap is for.
   */
  /**
   * The session's ad budget — `adPolicy.ts`'s singleton, not this scene's own.
   *
   * It *was* this scene's own, which was right while the result screen was the only place an ad
   * could appear. The shop's rewarded top-up now has a session limit too, and giving that its own
   * counter would have been two budgets for one session. See `sessionAdPolicy`.
   */
  private static get policy(): AdPolicyState {
    return sessionAdPolicy()
  }

  constructor() {
    super('RunOver')
  }

  create(data: RunOverData) {
    this.metres = Math.floor(data.distance / UNITS_PER_METRE)
    this.coins = data.coins
    this.bonus = Math.max(0, Math.round(data.bonus ?? 0))
    this.doubled = false
    this.continuing = false
    this.run = data.run ?? null
    this.quit = data.quit ?? false
    // **⚠ Reset here, not only at its declaration.** Phaser reuses the scene instance across every
    // `launch`, so a field holding a widget built by a previous `create` survives the shutdown that
    // destroyed the widget — and the next `naturalHeight` then sets a font size on a destroyed
    // widget, which throws inside the renderer. That is exactly how the shop crashed the second
    // time it was opened.
    this.clearOptionalButtons()

    // **`runFailed` is passed rather than assumed inside the policy**, so the policy stays a pure
    // function of its inputs — and the input is not constant: a run can stop two ways now. It
    // either ran out of lives, or the player asked to leave, and a continue offered to somebody who
    // has just said they are done is an ad with nothing attached to it, which is the exact thing
    // `canOfferContinue`'s own docstring says gets a submission rejected.
    //
    // **⚠ It was three outcomes for a while.** A stage could also be *cleared*, which was a success
    // and therefore not a continue either; the mode is gone and so is that branch. See
    // `runState.ts`.
    const failed = !this.quit
    // **⚠ Asked once per source, because the two used to close each other.** One shared flag meant
    // paying in coins spent the run's continue and the next death offered neither door — reported
    // as exactly that. See `AdPolicyState.continuesUsed`.
    const canRun = this.run !== null && failed
    const offerContinue = canRun && canOfferContinue(RunOver.policy, failed, 'ad')
    const offerContinueCoins = canRun && canOfferContinue(RunOver.policy, failed, 'coins')

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
    // **Two titles.** A run that beat the record is told so, because that is the only thing this
    // screen has to celebrate — there was a third for a cleared stage, and the mode it belonged to
    // is gone.
    this.title = kitTitle(this, this.metres > previousBest ? t('newBest') : t('runOver'))
    this.distanceText = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 52, color: toCssColor(KIT.active) }).setOrigin(0.5)
    this.bestText = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 16, color: toCssColor(KIT.muted) }).setOrigin(0.5)
    this.bonusText = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 18, color: toCssColor(KIT.active) }).setOrigin(0.5)
    this.coinText = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 22, color: toCssColor(KIT.coin) }).setOrigin(0.5)
    this.divider = kitDivider(this)

    // **Four actions at most, and exactly one of them is `solid`.** They used to be an
    // accent-outlined button and two identical ones, so `Double coins` and `Menu` were separated by
    // their labels and nothing else. The filled button is the one thing the player most wants, and
    // which that is depends on what is on offer: keeping the run beats starting another one, so
    // `Continue` takes the weight when it is available and `Again` takes it back when it is not.
    // Everything else is an outline, and leaving is `muted`, because it is the way *out* of the
    // loop the rest of the screen exists to restart.
    const affordCoins = canAfford(getState().coins, CONTINUE_COINS)
    // **Whichever continue is on offer takes the weight, and the ad's takes it first.** Keeping the
    // run beats starting another one, so `Again` only gets the fill when there is no continue the
    // player can actually act on — an unaffordable price is not one.
    const leadContinue = offerContinue ? 'ad' : offerContinueCoins && affordCoins ? 'coins' : 'again'

    if (offerContinue) {
      this.continueButton = kitButton(this, t('continueRun'), { solid: leadContinue === 'ad', fontSize: 22 })
    }
    if (offerContinueCoins) {
      // **⚠ The one offer in the game that had no coin alternative now has one, and it outlives the
      // ad rather than sharing its budget.** The rule every rewarded offer here is under is that
      // nothing is obtainable *only* by watching an ad — and an alternative that closed the moment
      // the ad was taken was one on paper. The price is derived rather than picked: `CONTINUE_COINS`
      // is what one ad pays, so the two doors into the same room cost the same.
      this.continueCoinsButton = kitButton(this, t('continueCoins', { n: CONTINUE_COINS }), {
        solid: leadContinue === 'coins',
        fontSize: leadContinue === 'coins' ? 22 : 17,
      })
      this.continueCoinsButton.setEnabled(affordCoins)
    }
    this.againButton = kitButton(this, t('again'), { solid: leadContinue === 'again', fontSize: 26 })
    this.menuButton = kitButton(this, t('menu'), { muted: true, fontSize: 17 })
    // **⚠ A run that banked nothing is not offered the doubler at all.** It used to be built
    // always and disabled at zero, which put a dead grey control in the middle of the column on
    // exactly the runs a player is least pleased with — and it is the frame the "why are the
    // buttons different colours" report was taken from. Doubling zero is not a thing the player
    // could want; the disabled state is for a control that is *temporarily* out of reach, which is
    // what the coin continue's own `setEnabled(affordCoins)` says and this never did.
    //
    // Same rule the road follows for a pickup the run has no room for: a reward the game cannot
    // pay is not offered rather
    // than drawn and refused, because a control the player presses and is given nothing for reads
    // as the game dropping it.
    if (this.coins > 0) this.doubleButton = kitButton(this, t('doubleCoins'), { fontSize: 17 })

    this.actions = [
      ...(this.continueButton ? [this.continueButton] : []),
      // Directly under the ad, because the two are one decision with two prices and reading them
      // as a pair is the point. It is an outline against the ad's fill: paying coins is the option
      // for a player who already has them, and it should not be the thing the screen shouts.
      ...(this.continueCoinsButton ? [this.continueCoinsButton] : []),
      this.againButton,
      ...(this.doubleButton ? [this.doubleButton] : []),
      this.menuButton,
    ]

    this.refresh(getState().bestScore)

    // **The keyboard keeps `Again`, even when `Continue` is the filled button.** A key that starts
    // an ad is a key nobody meant to press: a rewarded offer has to be taken deliberately, and the
    // deliberate gesture is the one aimed at the button.
    bindAction(this, 'primary', { pointer: this.againButton.container, keys: ['SPACE', 'ENTER'] }, () => this.again())
    bindAction(this, 'close', { pointer: this.menuButton.container, keys: ['ESC'] }, () => this.toMenu())
    if (this.doubleButton) {
      bindAction(this, 'openShop', { pointer: this.doubleButton.container }, () => void this.doubleCoins())
    }
    if (this.continueCoinsButton) {
      bindAction(this, 'continueCoins', { pointer: this.continueCoinsButton.container }, () => this.continueForCoins())
    }
    if (this.continueButton) {
      bindAction(this, 'continueRun', { pointer: this.continueButton.container }, () => void this.continueRun())
    }

    bindLayout(this, (width, height) => this.layout(width, height))

    void this.maybeShowInterstitial()
  }

  /**
   * Forgets every button this panel does not always build, before it builds any of them.
   *
   * ## ⚠ It said "the one button on this panel that is not always built" and there were three
   *
   * Two of them were cleared and `doubleButton` was not, so a panel that had shown `Double coins`
   * left the field pointing at a destroyed widget — and the very next panel that did *not* rebuild
   * it (a run that banked nothing) put that corpse straight into `actions`, bound a pointer to its
   * dead container, and resized it. `NineSlice.setTexture` then reads `scene.sys` on a game object
   * whose scene is gone, the throw comes out of `bindLayout` inside `create`, and the panel never
   * finishes: **the road stays frozen on the wreck, no result screen ever appears, and the game is
   * over as far as the player is concerned.** Reported as exactly that.
   *
   * **The path there runs through a suspend, which is why it looked like a Continue bug.** A
   * suspend banks, so a resumed run's `bankedCoins` starts level with its coins — and the panel is
   * paid the *difference*. A player who resumes and dies without picking anything up therefore
   * hands this screen `coins = 0`, which is the one case that skips the doubler. The previous run
   * had built it.
   *
   * **One call rather than three assignments**, because the defect was a list somebody had to
   * remember to extend — the same shape as the menu's reset-and-restore lists, which shipped a
   * button at alpha 0 twice for the same reason. `verify:ui` asserts the two sets agree: every
   * optional `KitButton` field on this scene is cleared here.
   */
  private clearOptionalButtons(): void {
    this.continueButton = null
    this.continueCoinsButton = null
    this.doubleButton = null
  }

  private refresh(best: number): void {
    this.distanceText.setText(`${formatCount(this.metres)} m`)
    this.bestText.setText(`${t('best')} ${formatCount(best)} m`)
    // Blank rather than a zero, for `coinText`'s reason: a run that never went near anything has
    // nothing to report, and `0` reads as a score rather than as an absence.
    this.bonusText.setText(this.bonus > 0 ? `${t('closePasses')} ${formatCount(this.bonus)}` : '')
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
    this.doubleButton?.setEnabled(false)

    const granted = await showRewarded(this.game, 'coins-double')

    if (!granted) return

    mutate((state) => {
      state.coins = earnCoins(state.coins, this.coins)
    })
    this.coins *= 2
    this.refresh(getState().bestScore)
    // **The other offer's affordability moved, so it has to be asked again.** Doubling can take a
    // player from not being able to afford the continue to being able to, and a button that stays
    // disabled through a change in the thing it is gated on reads as the purchase not having
    // worked. The reverse — a rewarded top-up in the shop — cannot reach this panel, so this is the
    // only place the two offers interact.
    this.continueCoinsButton?.setEnabled(canAfford(getState().coins, CONTINUE_COINS))
  }

  /**
   * The other rewarded offer: watch an ad, and get the run itself back.
   *
   * **The alternative is `Again`, and it is the honest one to name.** The rule every rewarded offer
   * here is under is that nothing is *only* obtainable through an ad — and this one cannot hand out
   * a duplicate of what it sells, because there is exactly one of this run. What it can do, and
   * does, is sit beside a button that costs nothing and gives the player another go at the same
   * thing. A player who never watches one is never blocked, only sooner back at the start line.
   *
   * **Spent on the offer, not on the reward.** `noteContinue` runs before the ad, so an ad that
   * fails, is skipped, or that the platform simply has none of still uses the run's one continue —
   * otherwise a refused ad leaves the button sitting there to be pressed again, which is the
   * arrangement that turns a rewarded offer into a slot machine.
   *
   * **Awaited rather than joined on the platform's `RESUME`.** `platform/rewardJoin.ts` exists for
   * the case where the two signals can arrive in either order; they cannot here, because
   * `adGate.showRewarded` emits its own `RESUME` in a `finally` *inside* the promise this awaits,
   * so the resume is always first. The panel is also an `OVERLAY_SCENES` member, so neither the
   * ad's pause nor a real one resumes the run underneath it — this method is the only thing that
   * ever does.
   */
  /**
   * The continue, paid for in coins.
   *
   * **Asked, then paid, then committed, in that order.** `canContinue` is what makes the ordering
   * safe: this panel stops itself before handing over, so a refusal arriving after that would leave
   * the run paused with no interface on it — see `ContinuableRun.canContinue` for the freeze that
   * cost.
   *
   * `spendCoins` returns `null` rather than partially deducting, so a player who cannot afford it
   * loses nothing and nothing happens — the same read-check-write inside one `mutate` the shop's own
   * purchase uses.
   *
   * **It spends the COIN continue and leaves the ad's alone**, which is the whole of what makes the
   * price a real alternative: an option that shuts the other door the moment it is used is an
   * option the player only ever gets to take instead of the ad, never as well. Each is still once
   * per run, so neither can be repeated — see `AdPolicyState.continuesUsed`.
   */
  private continueForCoins(): void {
    const run = this.run

    if (this.continuing || run === null || !run.canContinue()) return

    let paid = false

    mutate((state) => {
      const balance = spendCoins(state.coins, CONTINUE_COINS)

      if (balance === null) return
      state.coins = balance
      paid = true
    })

    if (!paid) return

    this.continuing = true
    noteContinue(RunOver.policy, 'coins')
    this.scene.stop()
    run.continueRun()
  }

  private async continueRun(): Promise<void> {
    const run = this.run

    if (this.continuing || run === null) return

    if (!run.canContinue()) return

    this.continuing = true
    this.continueButton?.setEnabled(false)
    noteContinue(RunOver.policy, 'ad')

    const granted = await showRewarded(this.game, 'run-continue')

    if (!granted) {
      this.continuing = false

      return
    }

    // **The run is resumed, never restarted**, which is only possible because `endRun` paused it
    // rather than stopping it. The panel goes first: it is drawn over a scene that is about to
    // start moving again, and a frame of the road running under a result screen is exactly the
    // "the panel arrived over a frame in which nothing had happened" defect from the other side.
    this.scene.stop()
    run.continueRun()
  }

  /**
   * Back to the road.
   *
   * `start` on the paused `RunScene` shuts it down and boots it again, so the world this panel was
   * drawn over is rebuilt rather than resumed — which is what makes the next run a new run.
   *
   * **The per-run half of the ad policy is reset here and in `toMenu`**, i.e. on both of the two
   * ways this screen is left for a *different* run. Resetting it in `RunScene.create` instead would
   * mean the run reaching into a policy this scene owns, and resetting it in `continueRun` would
   * hand the same run a second continue, which is the one thing `continueUsed` exists to prevent.
   */
  private again(): void {
    resetForNewRun(RunOver.policy)
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
    resetForNewRun(RunOver.policy)
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
    this.bonusText.setFontSize(18 * scale)
    this.coinText.setFontSize(22 * scale)
    this.continueButton?.setFontSize(22 * scale)
    this.continueCoinsButton?.setFontSize(17 * scale)
    this.againButton.setFontSize(26 * scale)
    this.doubleButton?.setFontSize(17 * scale)
    this.menuButton.setFontSize(17 * scale)

    const readout =
      this.title.height +
      TITLE_GAP * scale +
      this.distanceText.height +
      BEST_GAP * scale +
      this.bestText.height +
      BEST_GAP * scale +
      this.bonusText.height +
      COIN_GAP * scale +
      this.coinText.height
    // Summed over whatever is actually on the panel — three buttons, or five when the continue is
    // offered with both its prices — so the fit and the layout below cannot disagree about how tall
    // the stack is. **This is what makes adding a button safe**: the panel measures itself, so the
    // coin continue widened it without anybody choosing a new height.
    const actions = this.actions.reduce(
      (total, button, index) => total + button.height + (index > 0 ? BUTTON_GAP * scale : 0),
      0,
    )

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
    for (const button of this.actions) button.setMinWidth(contentWidth)

    // `plate.draw` is centred on the point it is given, not anchored to it.
    this.panel.draw(width / 2, height / 2, panelWidth, panelHeight)

    let y = height / 2 - panelHeight / 2 + TOP_PAD * scale

    this.title.setPosition(width / 2, y + this.title.height / 2)
    y += this.title.height + TITLE_GAP * scale
    this.distanceText.setPosition(width / 2, y + this.distanceText.height / 2)
    y += this.distanceText.height + BEST_GAP * scale
    this.bestText.setPosition(width / 2, y + this.bestText.height / 2)
    y += this.bestText.height + BEST_GAP * scale
    this.bonusText.setPosition(width / 2, y + this.bonusText.height / 2)
    y += this.bonusText.height + COIN_GAP * scale
    this.coinText.setPosition(width / 2, y + this.coinText.height / 2)
    y += this.coinText.height + DIVIDER_GAP * scale

    this.divider.draw(width / 2, y, contentWidth, scale)
    y += DIVIDER_GAP * scale

    for (const button of this.actions) {
      button.container.setPosition(width / 2, y + button.height / 2)
      y += button.height + BUTTON_GAP * scale
    }
  }
}
