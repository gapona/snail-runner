import * as Phaser from 'phaser'
import { bindAction } from '../platform/input'
import { gameReady } from '../platform/yt'
import { ensureMusic } from '../audio/musicFile'
import { SFX } from '../audio/sfx'
import { t } from '../i18n/strings'
import { getCatalog, type ShopItem } from '../shop/catalog'
import { resolveSelectedSnail } from '../run/snailSkins'
import { hasPurchased } from '../shop/coins'
import { applyTheme } from '../road/applyTheme'
import { getState, mutate } from '../save/store'
import { bindLayout } from '../ui/layout'
import { formatCount } from '../ui/format'
import { kitButton, type KitButton } from '../ui/kit'
import { KIT } from '../ui/kitPalette'
import { toCssColor } from '../ui/theme'
import { getDisplayFontStack } from '../ui/font'
import { uiScale } from '../ui/uiScale'
import { createNavBar, type NavBar } from '../ui/navBar'
import { launchOverlay } from '../ui/overlay'
import { isCosmeticSelected, selectCosmetic } from '../shop/cosmetics'
import { playSfx } from '../audio/audio'
import { buttonBand, mascotFeetRow, mascotLift, MENU_ENTRY as ENTRY, secondaryMaxWidth, titleBand, titleRow } from '../ui/menuLayout'
import { resolveSuspended } from '../run/suspend'
import { WorldView } from '../run/WorldView'
import { biomeIndexForSegment } from '../road/biomes'
import { PlayerView } from '../run/PlayerView'
import { createQuestBoard, type QuestBoardView } from '../ui/questBoard'
import { questPanelSize } from '../ui/questLayout'
import { claimQuest, QUEST_SLOTS, resolveQuestBoard, type QuestBoard } from '../run/quests'
import { createRng } from '../race/rng'
import { createPlayerState } from '../run/playerMotion'
import { PLAYER_REST_Y_FRACTION, PLAYER_WIDTH, PLAYER_Z, readableScale, SPEED_BASE } from '../run/constants'
import { CAMERA_HEIGHT, HORIZON_Y } from '../road/constants'
import { INK } from '../run/artPalette'

/** Base font sizes, scaled by `uiScale(width)` and by each band's own fit. */
/** The purse's face, its inset from the frame's corner, and how hard it punches when it is paid. */
const PURSE_SIZE = 20
const PURSE_INSET = 20
const PURSE_PUNCH = 1.18

const TITLE_FONT_SIZE = 112
const PLAY_FONT_SIZE = 38
/** The secondary action under it, at half the primary's face. Its width is `secondaryMaxWidth`'s. */
const NEW_RUN_FONT_SIZE = 19

/**
 * The wordmark's outline and shadow, as fractions of its own font size.
 *
 * **⚠ These replace a measured translucent plate, and the swap is the point.** The menu used to
 * solve a scrim alpha per theme from a framebuffer read (`ui/contrastProbe.ts`), because white text
 * on a pale sky measures well under 3:1 — and what that bought was a grey smear behind the title on
 * every bright theme. An outline is the same guarantee obtained differently: the letter is dark-
 * edged against *whatever* is behind it, so the contrast stops being a property of the sky at all
 * and the probe stops having anything to measure.
 *
 * Stated as fractions rather than pixels because the title shrinks to fit — a 14px stroke on a 74px
 * face is a logo, and the same 14px on the 34px the narrowest frame gets is a blob.
 */
const TITLE_INK = { stroke: 0.19, shadowY: 0.13, tiltDegrees: -3 } as const

/** How much of the title band the wordmark may fill, and how much of the frame's width. */
const TITLE_BAND_FILL = 0.78
const TITLE_MAX_WIDTH_FRACTION = 0.88

/**
 * The primary action's own geometry, in unscaled pixels.
 *
 * **A share of the frame between a floor and a ceiling, not a fixed width.** A 264px button is
 * two thirds of a 320px phone and an eighth of a desktop — the same object reading as "the thing to
 * press" on one and as a chip on the other. The floor is what keeps it thumb-sized on the narrowest
 * supported frame; the ceiling is what stops a wide desktop turning it into a banner.
 */
const PLAY_WIDTH = { fraction: 0.4, min: 264, max: 380 }
/** The gap between the Play button and the secondary action under it, when there is one. */
const STACK_GAP = 10

/** How close anything may come to the edges of the frame. */
const SIDE_MARGIN = 16

/**
 * The mascot's place in the picture.
 *
 * `offsetX` is in road half-widths, so the snail rides the road through a bend exactly as it does
 * in a run; `scale` is the one place in the game the drawn box is allowed to exceed the collision
 * box, and it may be, because the menu has no collision — see `PlayerView`'s own note.
 *
 * **⚠ `zScale` is what keeps the mascot out of the buttons, and it is a composition tool rather
 * than a cheat.** The snail's row on screen is fixed by `PLAYER_Z`: at the run's own distance its
 * feet land at 0.80 of the frame, which is inside the button band, and no amount of scaling moves
 * that — scaling about a bottom-centre origin grows a sprite UPWARDS from the same row. Standing it
 * further up the road raises the row (the offset from the horizon goes as 1/z) and shrinks it, and
 * `scale` buys the size back. Net: the same big mascot, a band higher, with nothing to argue with.
 */
const MASCOT = {
  offsetX: 0.58,
  /**
   * Where the mascot stands when the Play stack is beside it rather than under it.
   *
   * Measured, not chosen: on an 844x390 frame the mascot's box is 256px wide and the button 380, so
   * the two need 636 of 844 plus margins — which they have, and only just. See `SIDE_COLUMN`.
   */
  sideOffsetX: 0.95,
  widthFraction: 0.2,
  /**
   * How far up the road the front screen's mascot stands, as a multiple of the run's own distance
   * — **the floor of a derived lift, not the lift itself.**
   *
   * The drawn size is `widthFraction` and is unaffected by this, so standing the mascot further out
   * raises its feet without shrinking it: the offset from the horizon goes as `1 / z` and
   * `mascotScale` multiplies the size back. What it cannot do is lift them *past* the horizon,
   * which is the asymptote and why `maxZScale` exists.
   *
   * **⚠ It was one number for every frame, and one number cannot be right at both ends.** Raised to
   * 3.6 to get the mascot out of the Play button on a phone, it measured a **0px** gap at 320x568
   * — still touching, on the smallest frame the game supports — while adding 38px of sky to a
   * desktop that already had 44px of clearance and needed none. The band the creature has to fit
   * in is the frame's own: between the horizon and the top of the Play stack, which is 46px on a
   * 320x568 frame against a mascot 75px tall, and 158px on a desktop. A constant cannot answer
   * both.
   *
   * So the lift is **solved from the row it has to clear** (`mascotLift`) and this is only the
   * floor: a frame with room to spare keeps exactly the composition it had, and a frame without it
   * gets precisely the lift it needs and no more.
   */
  zScale: 2.4,
  /**
   * How far the lift may go, and how much road is left showing under the pad.
   *
   * The feet approach `HORIZON_Y` asymptotically, so there is no value of `z` that cannot be asked
   * for and no point past which more buys anything: past about 6 the return is under a pixel a
   * unit. `clearance` is a strip of road wide enough to read as a gap rather than as a join, and it
   * is scaled, because on a narrow frame every other gap on this screen is.
   */
  maxZScale: 6,
  clearance: 14,
} as const

/**
 * The multiplier that puts the front screen's mascot at `MASCOT.widthFraction` of the frame.
 *
 * **⚠ It was a bare `scale: 3.4`, and that made the menu's composition a function of the run's
 * hitbox.** The run's mascot is `PLAYER_WIDTH * scale(PLAYER_REST_Y_FRACTION)` of the frame's
 * width, and a round that grew either of those grew the front screen by the same factor without
 * anybody deciding to — measured, the hero snail went from 20% of a desktop frame to 32% of one as
 * a side effect of making the *in-run* snail readable on a phone.
 *
 * So the size the picture wants is stated, and the multiplier is solved from it. Nothing about the
 * run can move it now: if `PLAYER_BODY_H` or the rest row changes, this changes with them and the
 * front screen looks the same.
 *
 * **The lift is an argument rather than a constant**, and it has to be: standing the mascot further
 * up the road shrinks it by exactly that factor, so a lift that varies per frame with a size that
 * does not would make the creature a different size on every screen. See `mascotLift`.
 */
function mascotScale(zScale: number): number {
  const runFraction = (PLAYER_WIDTH * 2 * (PLAYER_REST_Y_FRACTION - HORIZON_Y)) / CAMERA_HEIGHT / 2

  return (MASCOT.widthFraction / runFraction) * zScale
}

/**
 * The idle cycle: a slow breath, a slower sway, and a rarer glance back.
 *
 * **⚠ There is no blink and no eye turn, and that is an art fact rather than an omission.** The
 * shipped mascot is a REAR view — shell to the camera, head and both stalks going away, which
 * CLAUDE.md records as the pick that fixed the model's drift to profile. There are no eyes facing
 * the player to blink or to turn, and drawing some would be new art.
 *
 * What is available is the same one scalar the jump uses (`squash.ts`: `> 1` taller and narrower,
 * `< 1` flatter and wider, volume-preserving) plus a rotation. So: `breath` is the creature
 * breathing, `sway` is its weight shifting, and `glance` is an occasional quick rise-and-tilt that
 * reads as looking back over the shell. Three periods that share no common multiple under a
 * minute, so the cycle never visibly repeats — the same trick the sun's corona uses.
 */
const IDLE = {
  breath: { amount: 0.055, periodMs: 2600 },
  sway: { degrees: 2.4, periodMs: 4100 },
  glance: { periodMs: 9400, durationMs: 620, degrees: 7, rise: 0.09 },
} as const

/** The exit: interface out, world up to speed, then the handover. */
const EXIT = { fadeMs: 180, accelerateMs: 600 } as const

/** How loud the corner icons are against the primary. Secondary means quieter, not just smaller. */
const CORNER_ALPHA = 0.78

/** The idle pulse on the primary action. */
const PLAY_PULSE = { scale: 1.035, periodMs: 1900 } as const

/**
 * The front screen: the game itself, running, with the fewest controls that can start it.
 *
 * **It is an attract mode rather than a picture of one.** The same `WorldView` the play scene
 * builds, on the same circuit machinery, at the run's own `SPEED_BASE`, with the real `PlayerView`
 * on the road — biomes change, the verge streams past, the mascot glides. What it does *not* have
 * is the run: no obstacles, no pickups, no collision, no HUD. That costs nothing to draw and it is
 * the only thing on the screen that sells both the speed and the character.
 *
 * **The composition keeps off the vanishing point.** Every line in the frame converges at
 * `HORIZON_Y`; the title takes the empty sky above it, the mascot stands in the middle distance off
 * the centreline, and the controls sit on the near ground a run leaves blank. See `ui/menuLayout.ts`
 * for the bands and for why nothing may sit in the middle.
 *
 * **The hierarchy is one filled button and two icons.** Play is the only solid shape on the screen;
 * Shop and Settings are unlabelled glyphs in the corner at half its weight. That is the reverse of
 * what shipped: Play was a 16%-alpha outline and the two secondaries were near-opaque plates.
 */
export class MainMenu extends Phaser.Scene {
  private world!: WorldView
  private mascot!: PlayerView
  /**
   * The quest board, and the rows that draw it.
   *
   * **Read from the save and repaired every time the menu is entered**, never held across scenes:
   * a run banks its tallies into the save on ending, so the board the player comes back to has to
   * be the saved one rather than the one this scene was holding when it handed over.
   */
  private questBoard!: QuestBoard
  /**
   * The purse, top-left, in the corner the garage puts its own.
   *
   * **⚠ The front screen had none, which is half of "the reward is not visible".** A quest paid its
   * coins into `mutate` and the only thing that moved was a sound: the shop's badge answers to the
   * balance and the shop is a tab away, so the player had no way to see either what a mission was
   * worth or that it had paid. The rows carry the first half (`questBoard.ts`); this is where the
   * payment lands, and it punches when it changes so the landing is visible rather than merely
   * recorded.
   */
  private purse!: Phaser.GameObjects.Text
  private quests!: QuestBoardView
  private mascotState = createPlayerState()
  private uiCamera!: Phaser.Cameras.Scene2D.Camera

  private title!: Phaser.GameObjects.Text
  private playButton!: KitButton
  /**
   * Starting over, drawn only when there is a run to start over from.
   *
   * **⚠ This band held a mode selector, and there is one mode now.** The chip named which of six
   * things Play was about to start — endless or one of five stages — and with the stages gone a
   * selector with one option is a control that opens a list with one row in it. What the band is
   * for instead is the second thing a player with a suspended run might want, and only then.
   */
  private newRunButton!: KitButton
  /** Whether the save holds a run worth offering to resume — see `readSuspended`. */
  private resumable = false
  private nav!: NavBar
  /** Set by `layoutQuests` and read by `placeStack` — see the note there. */
  private stackCovered = false

  /**
   * The lift solved for this frame, cached by `layout` and read by the render.
   *
   * A field rather than a call in `update`, because solving it needs the Play stack's own measured
   * height — which is a `layout` fact — and `update` runs sixty times a second against a frame that
   * has not changed. See `mascotLift`.
   */
  private mascotZ: number = MASCOT.zScale
  private shopBadge!: Phaser.GameObjects.Graphics

  private elapsedMs = 0
  private leaving = false
  private playPulse?: Phaser.Tweens.Tween

  constructor() {
    super('MainMenu')
  }

  create() {
    this.elapsedMs = 0
    this.leaving = false
    this.mascotState = createPlayerState()
    this.mascotState.offsetX = MASCOT.offsetX

    // **At the run's own speed, not a fraction of it.** The menu used to travel at 0.55 of
    // `SPEED_BASE` so the frame would sit still under a block of text; with the text out of the
    // middle of the picture there is nothing left for the motion to fight, and an attract mode that
    // moves slower than the game is an attract mode advertising the wrong game.
    this.world = new WorldView(this, { circuit: 'menu', speed: SPEED_BASE, decorSeed: 4242 })
    this.mascot = new PlayerView(this, {
      sizeScale: mascotScale(MASCOT.zScale),
      // **The front screen is the skin's preview, and this is why it can be.** The shop's rows are
      // a glyph and a name; what a player is actually buying is the creature standing on the road
      // behind the panel, so the menu draws the skin they have chosen and changes it the moment
      // they choose another. `resolveSelectedSnail` rather than the raw field: a save can outlive a
      // skin id, and a hand-edited one must not unlock anything.
      skin: resolveSelectedSnail(getState().selectedSnail, getState().purchases),
      // Resolved once here, never per frame, for the same reason the skin is — and through
    })


    this.title = this.add
      .text(0, 0, t('gameTitle'), {
        fontFamily: getDisplayFontStack(),
        fontSize: TITLE_FONT_SIZE,
        color: toCssColor(KIT.coin),
      })
      .setOrigin(0, 0.5)
      .setAngle(TITLE_INK.tiltDegrees)

    this.playButton = kitButton(this, t('play'), {
      primary: true,
      solid: true,
      fontSize: PLAY_FONT_SIZE,
      fontFamily: getDisplayFontStack(),
    })

    // **The only thing Continue does not do.** Drawn only when there is a run to abandon, so a
    // screen with nothing suspended is one button — which is what this screen was before the mode
    // chip, and what it is again now that there is one mode. `muted` rather than a second solid
    // face: starting over is the secondary of the two, and `secondaryMaxWidth` is the rule that
    // stops a translated label growing it past the button above it.
    this.newRunButton = kitButton(this, t('newRun'), { muted: true, fontSize: NEW_RUN_FONT_SIZE })
    // **Before the first `layout`, because both controls are sized and placed from it.** The label
    // on the primary button and whether the secondary exists at all are the two things this
    // answers, and `measureStack` reads the second.
    this.readSuspended()

    // **Glyphs, not textures.** Two unlabelled icons is what "secondary" looks like, and the game
    // already sets emoji in `valueBadge` and the ad button — so this needs no new asset, which is
    // the constraint this whole round is under.
    // **⚠ Three destinations became a bar, because a corner is where things go to be missed.** The
    // shop and the settings were faint glyphs in the top-right at `CORNER_ALPHA` — made secondary
    // by weight *and* by placement, which together is not "secondary", it is "invisible next to
    // Play". See `ui/navBar.ts`.
    this.nav = createNavBar(this, NAV_DEPTH)
    this.shopBadge = this.add.graphics()

    // **⚠ Before the camera split, because the split reads `entryGroups()` — which reads this.**
    // Built after it, `uiObjects()` walked a board that did not exist yet and `create` threw on the
    // first frame. The old rows survived the same ordering only because they were a field
    // initialised to `[]`, i.e. by accident rather than by design.
    // **Read from the save every time the menu is entered, never held across scenes.** A run banks
    // its tallies on ending, so the board to show is the saved one rather than the one this scene
    // was holding when it handed over.
    this.questBoard = resolveQuestBoard(getState().quests, Date.now())
    this.quests = createQuestBoard(this, QUEST_BOARD_DEPTH)
    this.quests.setBoard(this.questBoard)

    this.purse = this.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: PURSE_SIZE, color: toCssColor(KIT.coin) })
      .setOrigin(0, 0)
      .setDepth(QUEST_BOARD_DEPTH + 4)
    this.purse.setStroke(toCssColor(INK), 4)

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    this.uiCamera.ignore(this.worldObjects())
    this.cameras.main.ignore(this.uiObjects())

    this.quests.collectTargets.forEach((target, index) => {
      // The collect fires on a *tap*, the rule every row list in this project is under: the rows are
      // the only thing there is to grab, so firing on the press spends a gesture the player meant
      // as something else. See `ui/scrollList.ts`.
      bindAction(this, 'claimQuest', { pointer: target, tap: true }, () => this.claim(this.quests.questIdAt(index)))
    })
    // **The board opens and shuts on the same gesture, from two places.** The chip is what is on
    // screen while it is closed; the heading is what is on screen while it is open, and it is where
    // a player looks to shut a panel.
    bindAction(this, 'toggleQuests', { pointer: this.quests.chip, tap: true }, () => this.toggleQuests())
    bindAction(this, 'toggleQuests', { pointer: this.quests.header, tap: true }, () => this.toggleQuests())

    this.bindActions()
    bindLayout(this, (width, height) => this.layout(width, height))
    this.playEntry()

    this.exposeForTesting()

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // **Tweens are killed explicitly.** `Systems.shutdown()` does not stop them, and this scene
      // is re-entered every time a run ends — without this, a second visit runs two copies of the
      // idle pulse on the same button, at whatever phase each happened to be at.
      this.tweens.killAll()
      this.playPulse = undefined
      this.mascot.destroy()
      this.world.destroy()
      this.quests.destroy()
    })

    /**
     * The music, started here and never stopped by a scene.
     *
     * **The front screen owns it because it is the one screen every session passes through and a
     * run does not.** `Again` goes straight back into `RunScene` without touching the menu, so
     * starting it there would restart the track on every death — and starting it in `Preloader`
     * would start it under a loading bar the player has not yet chosen to be behind.
     *
     * `playMusic` is idempotent on the key it is already playing, which is what makes this safe on
     * the second and every later entry: coming back from a run does not restart the loop, it finds
     * it already running and only re-applies the volume. Pausing, muting and the platform's own
     * PAUSE/RESUME are all `audio.ts`'s, and none of them is this scene's business.
     *
     * The browser will not let a track start before the player has touched the page; Phaser's own
     * sound manager holds it locked and plays it on the first input, so this is a request rather
     * than a guarantee about the very first frame.
     */
    // **⚠ Fetched here rather than by the loading screen**, because it is 1.85MB — 37% of what
    // that bar waited for — and nothing on this screen needs it to exist. See
    // `ensureMusic`, which is what keeps `playMusic` from being asked for a key that is not there
    // yet: that call throws, and it takes the front screen with it.
    ensureMusic(this)

    // The world is up, the interface is interactable, the preloader is gone.
    gameReady()
  }

  /**
   * Reads the save for a run the player put down, and repoints the two controls at it.
   *
   * **Called on `create` and on every `RESUME`**, because the shop and the garage are launched over
   * this scene and a run cannot start from either — but `RunOver` can end one, and `Again` goes
   * straight back into `RunScene` without passing through here. What that leaves is: the snapshot
   * is read at the one moment it can have changed under this screen.
   *
   * `resolveSuspended` is what decides whether the stored value is a run; this only asks the
   * question. See `run/suspend.ts` for why a refusal is `null` rather than a repaired run.
   */
  private readSuspended(): void {
    this.resumable = resolveSuspended(getState().suspendedRun) !== null
    // **The label changes, the button does not.** Resuming and starting are the same action applied
    // to two different states of the same thing, so one control does both and says which — where a
    // second button would ask the player to notice that only one of the two is lit.
    this.playButton.setText(this.resumable ? t('resumeRun') : t('play'))
  }

  /**
   * Whether the shop has something the player can act on right now.
   *
   * **Affordable and unowned, which is a narrower question than "is there anything in there".** A
   * badge that is always lit is a badge nobody reads, so it is not "you have coins" and not "there
   * are themes" — it is that some specific row would succeed if tapped today.
   */
  private shopHasNews(): boolean {
    const state = getState()

    return getCatalog().some(
      (item) => item.priceCoins > 0 && item.priceCoins <= state.coins && !hasPurchased(state.purchases, item.id),
    )
  }

  /**
   * The DEV-only handle the menu's acceptance is measured through.
   *
   * Gated like every other hook in this project, and `__menu` is registered in `check-bundle.mjs`
   * so that "we gated it" can be checked against "it is gone". **The guard is inside the method,
   * not at the call site**: gating the *call* removes the call and leaves the method on the class,
   * unreferenced, with its string literals intact — which is exactly how the first version of this
   * shipped into a production bundle.
   */
  private exposeForTesting(): void {
    if (!import.meta.env.DEV) return

    ;(window as unknown as Record<string, unknown>).__menu = {
      setTheme: (id: string) => {
        if (!applyTheme(this, id)) return false
        this.world.refreshTheme(this, this.scale.width, this.scale.height)
    this.mascot.refreshTheme(this)

        return true
      },
      bounds: () => ({
        viewport: { width: this.scale.width, height: this.scale.height },
        title: rectOf(this.title.getBounds()),
        // **⚠ Not `getBounds()`, which for a `Container` is the union of its CHILDREN.** A kit
        // button's box is drawn by a `Graphics`, which contributes nothing to that union, so the
        // first version of this hook reported the label's own size — a 76px "Play" and two icons
        // under the touch floor, none of which is what is on screen or what is tappable.
        play: boxOf(this.playButton),
        newRun: this.resumable ? boxOf(this.newRunButton) : null,
        questChip: rectOf(this.quests.chip.getBounds()),
        questsExpanded: this.quests.expanded,
        shop: rectOf(this.nav.targets.shop.getBounds()),
        settings: rectOf(this.nav.targets.settings.getBounds()),
        mascot: rectOf(this.mascot.sprite.getBounds()),
      }),
      alphas: () => ({
        title: this.title.alpha,
        play: this.playButton.container.alpha,
        shop: this.nav.targets.shop.alpha,
        settings: this.nav.targets.settings.alpha,
      }),
      biome: () => biomeIndexForSegment(this.world.baseIndex, this.world.track.length),
      tweens: () => this.tweens.getTweens().length,
      leave: () => this.leave(),
    }
  }

  private worldObjects(): Phaser.GameObjects.GameObject[] {
    return [...this.world.gameObjects, ...this.mascot.gameObjects]
  }

  private uiObjects(): Phaser.GameObjects.GameObject[] {
    return [...this.uiAlphaTargets(), this.shopBadge]
  }

  /**
   * The corner icons, as one list.
   *
   * **⚠ There were two lists and they disagreed, which is how a third button once shipped
   * invisible.** `playEntry` sets every `uiAlphaTargets()` object to alpha 0 and then fades in an
   * explicitly named set; a button in the first list and not the second is correctly positioned,
   * correctly sized, interactive, and drawn at alpha 0 — present to every measurement and invisible
   * to the eye. Every consumer reads this one accessor.
   */
  /** Everything the bar draws with, as one list — the accessor rule, applied to a widget. */
  private cornerButtons(): (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] {
    return this.nav.objects
  }

  /**
   * The entry cascade, as data: what fades in, when, and to what.
   *
   * **This is the single list `uiAlphaTargets` used to be half of.** Anything the menu fades has to
   * name a timing here, which is what makes "reset but never restored" unrepresentable — see
   * `playEntry` for the two objects that shipped invisible before it was.
   */
  private entryGroups(): {
    targets: (Phaser.GameObjects.Image | Phaser.GameObjects.Text | Phaser.GameObjects.Container | Phaser.GameObjects.Graphics)[]
    timing: { delay: number; duration: number }
    alpha?: number
    onComplete?: () => void
  }[] {
    return [
      { targets: [this.title], timing: ENTRY.title },
      {
        targets: [this.playButton.container, this.newRunButton.container],
        timing: ENTRY.play,
        onComplete: () => this.startPlayPulse(),
      },
      // The board arrives with the button, because the two are read as one block — and the purse
      // with the board, because what a row pays and what the player has are one question.
      {
        targets: [
          ...(this.quests.objects as (Phaser.GameObjects.Text | Phaser.GameObjects.Container | Phaser.GameObjects.Graphics | Phaser.GameObjects.Image)[]),
          this.purse,
        ],
        timing: ENTRY.play,
      },
      {
        // The accessor, never a hand-written list — see `cornerButtons`. The bar is no longer held
        // back at `CORNER_ALPHA`: that alpha existed to keep two glyphs from competing with Play,
        // and a bar along the bottom edge is not in Play's zone at all. What each object comes up
        // *at* is its own — `navBar.layout` draws an inactive tab's icon at 0.72 — which is why the
        // cascade restores a captured alpha rather than 1. See `playEntry`.
        targets: this.nav.objects,
        timing: ENTRY.corner,
      },
    ]
  }

  /** The same objects, typed as things that have an alpha — for the exit tween and the camera split. */
  private uiAlphaTargets(): (Phaser.GameObjects.Image | Phaser.GameObjects.Text | Phaser.GameObjects.Container | Phaser.GameObjects.Graphics)[] {
    return this.entryGroups().flatMap((group) => group.targets)
  }

  /**
   * Takes the reward for a finished quest, and deals its replacement while the player is looking.
   *
   * **Claimed by hand rather than paid out on completion**, which is the whole point of the button:
   * a quest that filled silently inside a run would tell the player they had done it by moving a
   * coin counter, at a moment they are watching the road.
   */
  private claim(questId: number): void {
    const claimed = claimQuest(this.questBoard, questId, createRng(Date.now() ^ questId))

    if (claimed.coins <= 0) return

    this.questBoard = claimed.board
    this.quests.setBoard(claimed.board)
    mutate((state) => {
      state.coins += claimed.coins
      state.quests = claimed.board
    })
    playSfx(SFX.MILESTONE)
    // **The payment is shown, not only banked.** A number that changes while nobody is looking at
    // it is the defect this round is about; a punch is what the HUD's own score does for the same
    // reason — see `scoreEmphasis`.
    this.tweens.killTweensOf(this.purse)
    this.purse.setScale(1)
    this.tweens.add({ targets: this.purse, scale: PURSE_PUNCH, duration: 90, yoyo: true, ease: 'Quad.easeOut' })
    // The whole screen, not only the board: the shop's badge answers to the purse, and claiming is
    // one of the two things on this screen that moves it.
    this.layout(this.scale.width, this.scale.height)
  }

  /**
   * Opens and shuts the board.
   *
   * **Collapsed is the resting state and expanding is an act**, which is what keeps the mascot the
   * subject of its own front screen — see `QUEST_CHIP`. It is not remembered across scenes for the
   * same reason: coming back from a run should show the game, not the list the player last left
   * open.
   */
  private toggleQuests(): void {
    this.quests.setExpanded(!this.quests.expanded)
    playSfx(SFX.PICKUP)
    this.layout(this.scale.width, this.scale.height)
  }

  /**
   * The board, under the wordmark, collapsed to a chip unless the player has opened it.
   *
   * **Under the title rather than above the Play button — the mascot owns the middle of this
   * screen.** The first version sat the rows immediately above the primary action, which is where a
   * player looks on the way to pressing it and is also, on this screen, exactly where the snail is
   * standing: three rows of text ran across it and the COLLECT button was drawn over its shell. The
   * upper-left is the one part of the frame with nothing in it — the title band ends above it, the
   * sun is on the right, and the mascot is centred and lower.
   */
  private layoutQuests(width: number, height: number, scale: number): void {
    const x = SIDE_MARGIN * scale
    const y = this.title.y + this.title.height / 2 + QUEST_BOARD_GAP * scale
    // **⚠ The board gives way where the column cannot hold both it and the button, and it is the
    // one that gives.** On a landscape phone the Play stack stands *beside* the mascot, i.e. in this
    // column, and there are 182px between the title and the bar for a 108px board plus a 132px
    // stack: measured, the third row was drawn straight through the button. The stack is the reason
    // the screen exists and is already at its own floor, so what is dropped is the rows that do not
    // fit — a board that shows two of three is still a board, the chip's own count still says three,
    // and the three rotate anyway.
    const floor =
      height - this.nav.heightAt(width) - STACK_GAP * scale - this.stackHeight(scale) - QUEST_BOARD_GAP * scale
    // **⚠ On a short landscape frame there is no room above the stack for even one row**, and a
    // control that opens onto nothing is worse than one that does not open. Measured at 844x390:
    // 25px between the wordmark and the Play button, against a 90px one-row panel — and the board
    // this replaces showed nothing there either, silently.
    //
    // So on a frame that tight the panel takes the room the stack would have used and **the stack
    // is hidden while it is open**. That is what a dialog is; it is also what removes the hazard of
    // a tap on the panel's own blank space falling through to Play and starting a run, since a
    // hidden object is not hit-tested. The heading is the way back, and Play is one tap away again.
    const tight = this.quests.expanded && y + questPanelSize(QUEST_SLOTS, scale, width, x).h > floor

    this.stackCovered = tight
    this.quests.layout(x, y, width, scale, tight ? height - this.nav.heightAt(width) : floor)
    // The same corner, and the same inset, the garage puts its own coin line in.
    this.purse.setFontSize(PURSE_SIZE * scale)
    this.purse.setPosition(PURSE_INSET * scale, PURSE_INSET * scale)
    this.purse.setText(`\u{1FA99} ${getState().coins}`)
  }


  private bindActions(): void {
    // 'primary' must fire at most once — starting the same scene twice mid-transition is unsafe,
    // and the exit runs for `EXIT.accelerateMs` before the handover, which is a long window.
    bindAction(this, 'primary', { pointer: this.playButton.container, keys: ['SPACE', 'ENTER'] }, () => {
      if (this.leaving) return
      this.leave()
    })

    bindAction(this, 'openSettings', { pointer: this.nav.targets.settings, keys: ['ESC'] }, () => {
      launchOverlay(this, 'Settings', { opener: 'MainMenu' })
    })

    // **`start`, not `launch`** — the garage draws the game's own world, and two worlds may never
    // be alive at once. `ScenePlugin.start` shuts this scene down, taking its `WorldView` with it,
    // before the garage builds one. See `Garage`'s own note for the four separate crashes that rule
    // has been reached from.
    bindAction(this, 'openGarage', { pointer: this.nav.targets.garage }, () => {
      this.scene.start('Garage')
    })

    // **Throwing a run away is a tap, never a press.** It is the one control on this screen that
    // destroys something the player cannot get back, and the gesture that reaches it most often by
    // accident is a press that was meant for the button directly above it — so it fires on the
    // release, which is the same safety rule the shop's rows, the quest board's collect and the
    // run's own exit are all under.
    //
    // **No confirm dialog, and that is what banking bought.** Suspending pays out the coins and the
    // quest progress as it goes (see `RunScene.suspend`), so what starting over actually costs is
    // the distance — and a dialog in front of a button labelled `New run`, on a screen whose other
    // button says `Continue`, would be asking the player to confirm the thing they just read.
    bindAction(this, 'newRun', { pointer: this.newRunButton.container, tap: true }, () => {
      mutate((state) => {
        state.suspendedRun = null
      })
      this.readSuspended()
      if (!this.leaving) this.leave()
    })

    bindAction(this, 'openRecords', { pointer: this.nav.targets.records }, () => {
      launchOverlay(this, 'Records', { opener: 'MainMenu' })
    })

    bindAction(this, 'openShop', { pointer: this.nav.targets.shop }, () => {
      launchOverlay(this, 'Shop', {
        opener: 'MainMenu',
        onSelect: (item: ShopItem) => selectCosmetic(this, { world: this.world, mascot: this.mascot }, item),
        isSelected: (item: ShopItem) => isCosmeticSelected(item),
      })
    })

    // The shop can spend coins and buy a theme, so both readouts are stale the moment it closes.
    this.events.on(Phaser.Scenes.Events.RESUME, () => {
      this.readSuspended()
      // **⚠ The accent used to be repainted here too, and it is not any more.** Both controls took
      // the active theme's rung, so a theme bought from the shop left them on the previous one's
      // colour until the menu was re-entered — a real defect, and it is gone with the mechanism
      // rather than fixed: the accent is `KIT.active` on every theme now (see `kitButton`'s `fill`),
      // because on `day` a cream road marking under a near-white label was reported as unreadable.
      this.layout(this.scale.width, this.scale.height)
    })
  }

  /** The entry cascade. The world is already running, so it has no entrance of its own. */
  private playEntry(): void {
    // **⚠ One list, and every group in it is both reset and restored.** The reset used to walk
    // `uiAlphaTargets()` while the fades named three groups by hand — so an object added to the
    // accessor and not to a tween came out positioned, sized, interactive and drawn at **alpha 0**:
    // present to every measurement and invisible to the eye. That shipped once as a corner button
    // and was reproduced immediately by the quest board, which is what turned "read one accessor"
    // into "there is only one list". A group with no timing cannot be added.
    for (const group of this.entryGroups()) {
      // **⚠ Restored to each object's OWN resting alpha, captured before the reset — never to 1.**
      // `layout` has already run, so what an object is drawn at now is what it is meant to be drawn
      // at, and fading everything to a flat 1 overrides that. Two things in this cascade are not 1:
      // the nav bar's inactive tab icons and its gear rest at 0.72, so the entry was flattening the
      // one cue that says which tab you are on; and a `plate()`'s wash is created at alpha 0 and is
      // only given a position, a size and `PLATE_ALPHA` by `draw()` — so the collapsed quest
      // panel's wash, which has never been drawn, was faded up to **full strength at (0, 0) at its
      // texture's own 256x96**, i.e. a black box in the top-left corner of the front screen. That
      // is what was reported, and it is the reset-list defect one level along: the two lists agree
      // about *which* objects fade and disagreed about *what to*.
      const rest = group.targets.map((object) => group.alpha ?? object.alpha)

      for (const object of group.targets) object.setAlpha(0)

      group.targets.forEach((object, index) => {
        this.tweens.add({
          targets: object,
          alpha: rest[index],
          delay: group.timing.delay,
          duration: group.timing.duration,
          ease: 'Cubic.easeOut',
          onComplete: index === 0 ? group.onComplete : undefined,
        })
      })
    }
  }


  /**
   * The idle pulse on the primary action, which stops the moment the pointer is on it.
   *
   * A pulse is an invitation, and an invitation the player has already accepted is noise — worse, a
   * button that keeps moving under the cursor is a button that is harder to hit.
   */
  private startPlayPulse(): void {
    this.playPulse = this.tweens.add({
      targets: this.playButton.container,
      scale: PLAY_PULSE.scale,
      duration: PLAY_PULSE.periodMs / 2,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    this.playButton.container.on(Phaser.Input.Events.POINTER_OVER, () => {
      this.playPulse?.pause()
      this.playButton.container.setScale(1)
    })
    this.playButton.container.on(Phaser.Input.Events.POINTER_OUT, () => this.playPulse?.resume())
  }

  /**
   * Hands over to the run **without a fade to black**.
   *
   * The interface leaves, the world is already at the run's speed, and only then does the scene
   * change. Nothing is hidden during the change because nothing has to move: the horizon, the
   * palette and the fog are the same numbers on both sides of it — and now so is the speed.
   */
  private leave(): void {
    if (this.leaving) return
    this.leaving = true

    this.playPulse?.stop()
    // **The entry cascade has to be killed first, or it wins.** Play is clickable from the frame it
    // appears, which is before the corner row's own fade-in has finished — and a still-running entry
    // tween keeps writing alpha 1 over the exit tween's fade.
    this.tweens.killTweensOf(this.uiAlphaTargets())
    this.tweens.add({
      targets: this.uiAlphaTargets(),
      alpha: 0,
      duration: EXIT.fadeMs,
      ease: 'Cubic.easeIn',
      onUpdate: () => this.shopBadge.setAlpha(this.nav.targets.shop.alpha),
    })
    this.time.delayedCall(EXIT.accelerateMs, () => this.scene.start('RunScene'))
  }

  update(_time: number, delta: number): void {
    const width = this.scale.width
    const height = this.scale.height

    this.elapsedMs += delta

    // The camera leans towards the mascot exactly as it does in a run, so the one object the
    // picture is about is also the one the frame is composed around.
    this.world.advance(delta, 0.5 + this.mascotState.offsetX * 0.5)
    this.world.render(width, height)

    // After the world, never before: it reads this frame's segment projections out of the mesh pass.
    this.mascot.render(
      this.mascotState,
      this.world.track,
      this.world.baseIndex,
      // Stood further up the road than a run stands it, by however much this frame needs — see
      // `mascotLift`. `PlayerView` adds `PLAYER_Z` to whatever it is handed, so the extra distance
      // goes in here rather than in a second knob on a class that must not learn about menus.
      this.world.cameraZ + PLAYER_Z * (this.mascotZ - 1),
      width,
      height,
      this.idleSquash(),
      this.world.cameraZ,
    )
    this.mascot.sprite.setAngle(this.idleAngle())
  }

  /** The breath, plus the rise of a glance. One scalar, the same one the jump uses. */
  private idleSquash(): number {
    const breath = Math.sin((this.elapsedMs / IDLE.breath.periodMs) * Math.PI * 2) * IDLE.breath.amount

    return 1 + breath + this.glance() * IDLE.glance.rise
  }

  /** The sway, plus the tilt of a glance. */
  private idleAngle(): number {
    const sway = Math.sin((this.elapsedMs / IDLE.sway.periodMs) * Math.PI * 2) * IDLE.sway.degrees

    return sway + this.glance() * IDLE.glance.degrees
  }

  /**
   * `0..1` over the glance's own window, and exactly 0 outside it.
   *
   * A half-sine rather than a ramp, for the reason the sun's glint is one: a linear rise shows its
   * corners and reads as the sprite being switched rather than as the creature moving.
   */
  private glance(): number {
    const into = this.elapsedMs % IDLE.glance.periodMs

    return into < IDLE.glance.durationMs ? Math.sin((into / IDLE.glance.durationMs) * Math.PI) : 0
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)

    this.uiCamera.setViewport(0, 0, width, height)
    this.world.layout(width, height)

    // **The mascot is boosted on a narrow frame, and it is the one object here allowed to be.**
    // Everything on this road is sized off the frame's WIDTH — which is what keeps an object the
    // same size relative to the road at every aspect, and which makes the snail a fifth of its
    // desktop size on a phone. That is correct for a hitbox and wrong for the subject of a
    // picture, so the front screen borrows `readableScale`: the same rule, for the same reason, in
    // the only other place a sprite and a box need not agree.
    this.layoutTitle(width, height, scale)
    // **The order is measure, then SOLVE, then reserve, then place.** The board hangs off the
    // title's measured bottom edge and reserves room for the Play stack; the stack is then placed
    // against what the board left. The solve goes in the middle because the mascot's lift is
    // derived from the stack's own top — which needs its measured height — and the mascot's *size*
    // is derived from the lift. See `mascotLift` for why those two cannot be separated.
    this.measureStack(width, scale)
    this.mascotZ = this.sideBySide(width, height, scale)
      ? // Beside the stack rather than under it, so there is nothing to clear and the creature
        // stands at the composition's own distance.
        MASCOT.zScale
      : this.mascotLift(width, height, scale).z
    this.mascot.setSizeScale(mascotScale(this.mascotZ) * readableScale(width))
    this.layoutQuests(width, height, scale)
    this.placeStack(width, height, scale)
    this.layoutCorner(width, scale)
  }

  /**
   * Sets the wordmark inside the title band.
   *
   * **⚠ The title is what shrinks, and the Play button is what does not.** The band's fit is applied
   * here and `layoutButtons` has no fit of its own beyond the touch floor — if the frame is too
   * short for both, the thing the player came to press keeps its size and the decoration gives way.
   * That is the reverse of the old order, where a single stack fit shrank Play along with everything
   * else on a landscape phone.
   *
   * Measured off the drawn text rather than the nominal font size, in a second pass: a `Text`
   * object's height is a property of the font's metrics, not of the size asked for, so the only
   * honest way to know whether it fits is to set it and look.
   */
  private layoutTitle(width: number, height: number, scale: number): void {
    const band = titleBand(height)
    const setSize = (size: number): void => {
      this.title.setFontSize(size)
      // Both are fractions of the face, so a title shrunk to fit keeps its own proportions rather
      // than turning into a thin letter inside a fixed-width stroke.
      this.title.setStroke(toCssColor(INK), size * TITLE_INK.stroke)
      this.title.setShadow(0, size * TITLE_INK.shadowY, toCssColor(INK), 0, true, true)
    }

    setSize(TITLE_FONT_SIZE * scale)

    const fit = Math.min(
      1,
      (band.height * TITLE_BAND_FILL) / this.title.height,
      (width * TITLE_MAX_WIDTH_FRACTION) / this.title.width,
    )

    if (fit < 1) setSize(TITLE_FONT_SIZE * scale * fit)

    // Left-aligned rather than centred: the mascot has the right of the frame, so the two sit on a
    // diagonal and the vanishing point between them stays clear.
    const left = SIDE_MARGIN * scale + this.title.height * 0.1

    // **And pushed down where the sun is in the way**, which on a portrait phone it is — see
    // `titleRow`. On a landscape frame the two never overlap and this returns the band's centre.
    this.title.setPosition(left, titleRow(width, height, { left, width: this.title.width, height: this.title.height }))
  }

  /**
   * Sizes the primary action and the mode chip, without placing either.
   *
   * **⚠ Split from the placement because the board sits between them.** `layoutQuests` reserves
   * room for this stack (`stackHeight`) and the stack is then placed against what the board left —
   * so the two heights have to be known before the board is laid out, and the two *positions*
   * cannot be known until after it. One pass doing both is the ordering that once drew a quest row
   * through the Play button on a landscape phone.
   */
  private measureStack(width: number, scale: number): void {
    this.playButton.setFontSize(PLAY_FONT_SIZE * scale)
    this.playButton.setMinWidth(
      Math.min(
        Math.max(width * PLAY_WIDTH.fraction, PLAY_WIDTH.min * scale),
        PLAY_WIDTH.max,
        width - SIDE_MARGIN * 4 * scale,
      ),
    )
    // **Bounded by the button above it, which is the whole of "lighter and narrower than Play".**
    // Weight is carried by the tier — a muted face against a solid one — and width has to be a rule
    // or a translated label would grow the secondary control past the primary one. See
    // `secondaryMaxWidth`.
    this.newRunButton.setFontSize(NEW_RUN_FONT_SIZE * scale)
    this.newRunButton.setMinWidth(Math.min(this.newRunButton.width, secondaryMaxWidth(this.playButton.width)))
  }

  /**
   * The primary action and the mode chip, on the bare near ground.
   *
   * Both are centred: the button is the one thing on the screen the player is meant to hit, and the
   * centre of the near ground is the easiest place on a phone to hit with either thumb. The mascot
   * is what moves out of the way — it stands off the centreline in `MASCOT.offsetX` and, being in
   * the middle distance, sits a band above this one.
   */
  private placeStack(width: number, height: number, scale: number): void {

    // **⚠ The row is never dropped now, and that is a change of what it says rather than of the
    // geometry.** It used to be the record, which the Records tab carries — so a short frame could
    // lose it without losing anything. It is the *mode* now, i.e. what the button above it is about
    // to start, and a Play button whose destination is written nowhere is worse on a small screen
    // than on a large one. What made keeping it affordable is `MASCOT.zScale`: standing the mascot
    // further up the road raised its feet, and the room between them and the bar went from 115 to
    // comfortably over the 106 this stack needs. The one frame that still cannot hold it under the
    // mascot puts it beside instead — see `sideBySide`.
    const stack = this.stackHeight(scale)

    // **⚠ On a short landscape frame the stack goes BESIDE the mascot, because under it is not a
    // place that exists.** The feet can never rise above `HORIZON_Y` — that is what the projection
    // is — so at 844x390 they sit at 242px at best against a bar top of 314, leaving 72px for a
    // 65px button and two gaps. No value of `MASCOT.zScale` reaches it. What such a frame does have
    // is width: 256px of mascot and 380px of button fit side by side in 844 with room to spare, so
    // the mascot moves to the far side of the road and the button takes the column it leaves.
    // **⚠ And it may only happen on a frame that is actually wide, which is what a portrait phone
    // proved.** The vertical test alone is satisfied by any *short* frame, and a tall narrow one is
    // short too once the bar and the mascot have taken their share: at 455x648 the room came out at
    // 109px against a stack of 99 plus its breathing room, so the button jumped into the left column
    // and the mascot was shoved to the verge — reported on sight. The branch exists because a short
    // frame has width to spend instead, and a portrait frame has none: it is landscape or it is the
    // ordinary centred stack, and the stack still fits there because 109 > 99.
    // **⚠ The question is whether the mascot can stand CLEAR of the stack, not whether the stack
    // fits under where the mascot happens to be.** `room` measures the second, against a feet row
    // that is now solved rather than fixed — so it would report a frame as tight and then lift the
    // mascot out of the way anyway. `mascotLift` answers the first directly: it returns `clears`
    // false only when the lift ran out of road, i.e. when the stack's top is at or above the
    // horizon the feet can never pass. The aspect guard is unchanged and is what keeps a portrait
    // frame out of this branch — see below.
    const sideBySide = this.sideBySide(width, height, scale)
    // **⚠ Clamped above the bar, not merely nudged.** `buttonBand` describes the frame's own lower
    // zone and knows nothing about chrome laid over it, so centring on it put the Play button's
    // bottom edge 7px *into* the bar and the record line squarely behind it. Shifting the band's
    // centre by half the bar was the first attempt and was still short — what the stack needs is a
    // hard floor, because the bar owns the bottom outright.
    const top = sideBySide
      ? // **⚠ Under the quest board, not centred in the space.** Centring it was the first version
        // and it put the button squarely across all three quest rows — the board is in the upper
        // left and this frame moves the button into the same column, which is a collision the
        // vertical measurements could not see because they were taken against the mascot and the
        // bar. The two share the column by stacking, and the board is a chip until it is asked for.
        Math.min(this.quests.bottom + STACK_GAP * scale * 1.5, this.stackFloor(width, height, scale) - stack)
      : this.stackTop(width, height, scale)
    const column = sideBySide ? width * SIDE_COLUMN : width / 2

    this.mascotState.offsetX = sideBySide ? MASCOT.sideOffsetX : MASCOT.offsetX
    // Hidden rather than merely drawn under: an object that does not render is not hit-tested, and
    // a tap on the open panel's blank space must not fall through and start a run.
    this.playButton.container.setVisible(!this.stackCovered)
    // **Hidden rather than merely absent from the layout**, for the reason above: an object that
    // does not render is not hit-tested, so a run cannot be thrown away by a tap on a control the
    // player cannot see.
    this.newRunButton.container.setVisible(!this.stackCovered && this.resumable)
    this.playButton.container.setPosition(column, top + this.playButton.height / 2)
    this.newRunButton.container.setPosition(
      column,
      top + this.playButton.height + STACK_GAP * scale + this.newRunButton.height / 2,
    )
  }

  /**
   * The two icons, in the top-right corner, at half the primary's weight.
   *
   * The corner is the one part of the frame a run's HUD leaves to the *right* of its own gauge, and
   * it is as far from the primary action as the screen allows — which is the point: a secondary
   * control that shares a zone with the primary one is competing with it.
   */
  /**
   * Where the mascot's feet land, as a screen row — the floor everything below it has to clear.
   *
   * Derived rather than read off `drawnBox`, because `layout` runs before the first render and the
   * box is zero until then. `PLAYER_REST_Y_FRACTION` is the run's own row; standing the mascot
   * further up the road (`MASCOT.zScale`) raises it, and the relation is the projection's: the
   * offset from the horizon goes as `1 / z`.
   */
  /**
   * How tall the Play button and the mode line under it are together.
   *
   * One expression, because the board reserves room for this stack and the stack is then placed
   * against what the board left — two readings of it is one of them being wrong, which is how the
   * board came to be drawn through the button on a landscape phone.
   */
  private stackHeight(scale: number): number {
    if (!this.resumable) return this.playButton.height

    return this.playButton.height + STACK_GAP * scale + this.newRunButton.height
  }

  private mascotFeet(height: number, zScale: number = this.mascotZ): number {
    return mascotFeetRow(height, HORIZON_Y, PLAYER_REST_Y_FRACTION, zScale)
  }

  /**
   * The lowest row the Play stack may reach — the bar owns everything under it.
   *
   * **⚠ A hard floor rather than a nudge.** `buttonBand` describes the frame's own lower zone and
   * knows nothing about chrome laid over it, so centring on it put the Play button's bottom edge
   * 7px *into* the bar and the mode line squarely behind it. Shifting the band's centre by half the
   * bar was the first attempt and was still short.
   */
  private stackFloor(width: number, height: number, scale: number): number {
    return height - this.nav.heightAt(width) - STACK_GAP * scale
  }

  /** Where the Play stack's top edge lands when it is centred under the mascot. */
  private stackTop(width: number, height: number, scale: number): number {
    const stack = this.stackHeight(scale)

    return Math.min(buttonBand(height).centre - stack / 2, this.stackFloor(width, height, scale) - stack)
  }

  /**
   * How far up the road the mascot has to stand to keep its feet clear of the Play stack.
   *
   * **⚠ This replaces a constant that was wrong at both ends of the range of frames.** The band the
   * creature has to fit into is between `HORIZON_Y` — which its feet approach and can never pass —
   * and the top of the stack, and that band is 46px on a 320x568 frame against a 75px mascot and
   * 158px on a desktop. One lift for both leaves the phone touching the button and spends 38px of
   * sky on a desktop that had 44px of clearance already.
   *
   * The arithmetic is the projection's own, inverted: the feet sit at
   * `HORIZON_Y + (rest - HORIZON_Y) / z` of the frame, so asking for a row gives the `z` that puts
   * them there. Clamped into `[zScale, maxZScale]`, which is what makes a roomy frame keep exactly
   * the composition it had rather than being pushed *down* the road to use its slack up.
   *
   * `clears` is false when the row asked for is at or above the horizon, i.e. when there is no `z`
   * at all that would do it — the honest answer on a short landscape frame, and what `placeStack`
   * reads to put the stack beside the mascot instead of under it.
   *
   * **⚠ It has to be solved before the mascot is SIZED, not after.** Standing further up the road
   * shrinks the sprite by exactly `z` and `mascotScale` multiplies it back, so a lift that varies
   * per frame with a size scale that does not would draw a different-sized creature on every
   * screen. `layout` therefore measures the stack, solves this, then sizes.
   */
  private mascotLift(width: number, height: number, scale: number): { z: number; clears: boolean } {
    return mascotLift({
      height,
      stackTop: this.stackTop(width, height, scale),
      clearance: MASCOT.clearance * scale,
      horizon: HORIZON_Y,
      rest: PLAYER_REST_Y_FRACTION,
      minZ: MASCOT.zScale,
      maxZ: MASCOT.maxZScale,
    })
  }

  /**
   * Whether this frame puts the Play stack beside the mascot rather than under it.
   *
   * **⚠ On a short landscape frame, under the mascot is not a place that exists.** The feet can
   * never rise above `HORIZON_Y` — that is what the projection is — so at 844x390 they sit at 242px
   * at best against a bar top of 314, leaving 72px for a 65px button and two gaps. What such a
   * frame does have is width: 256px of mascot and 380px of button fit side by side in 844 with room
   * to spare, so the mascot moves to the far side of the road and the button takes the column it
   * leaves.
   *
   * **⚠ And it may only happen on a frame that is actually wide, which is what a portrait phone
   * proved.** The vertical test alone is satisfied by any *short* frame, and a tall narrow one is
   * short too once the bar and the mascot have taken their share: at 455x648 the button jumped into
   * the left column and the mascot was shoved to the verge — reported on sight.
   */
  private sideBySide(width: number, height: number, scale: number): boolean {
    return !this.mascotLift(width, height, scale).clears && width / height >= SIDE_BY_SIDE_MIN_ASPECT
  }

  private layoutCorner(width: number, scale: number): void {
    // **No tab is active here**: the front screen is not one of the three destinations, it is the
    // thing they hang off. Highlighting one would tell the player they were somewhere they are not.
    this.nav.layout(width, this.scale.height, null)

    // A dot on the shop, drawn rather than a texture, and only when the shop can actually do
    // something for the player right now — see `shopHasNews`.
    const shop = this.nav.targets.shop
    const radius = Math.max(4, 5 * scale)

    this.shopBadge.clear()
    this.shopBadge.setDepth(NAV_DEPTH + 2)
    this.shopBadge.setAlpha(shop.alpha)

    if (this.shopHasNews()) {
      this.shopBadge.fillStyle(KIT.plate, 1)
      this.shopBadge.fillCircle(shop.x + shop.width * 0.5, shop.y - shop.height * 0.85, radius * 1.5)
      this.shopBadge.fillStyle(KIT.coin, 1)
      this.shopBadge.fillCircle(shop.x + shop.width * 0.5, shop.y - shop.height * 0.85, radius)
    }
  }

}

/** A widget's real drawn box, centred on its container — see `boxOf`'s note on `getBounds`. */
function boxOf2(
  container: Phaser.GameObjects.Container,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return { x: container.x - width / 2, y: container.y - height / 2, width, height }
}

/** A kit button's real drawn box, centred on its container. */
function boxOf(button: KitButton): { x: number; y: number; width: number; height: number } {
  return {
    x: button.container.x - button.width / 2,
    y: button.container.y - button.height / 2,
    width: button.width,
    height: button.height,
  }
}

/** A `Rectangle` as plain numbers, for the DEV hook to hand out. */
function rectOf(rect: Phaser.Geom.Rectangle): { x: number; y: number; width: number; height: number } {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** Above the world, below nothing else — the menu draws no other layered interface. */
const QUEST_BOARD_DEPTH = 10
/** The bar sits over the board, because it is chrome and the board is content. */
const NAV_DEPTH = 20
/**
 * Which column the Play stack takes when it stands beside the mascot rather than under it.
 *
 * Left of centre, because the mascot is right of it: `MASCOT.offsetX` has always put the creature
 * off the centreline so the button could have the middle, and on a side-by-side frame that same
 * decision simply gets acted on in the other axis.
 */
const SIDE_COLUMN = 0.28
/**
 * The frame proportion at which the Play stack may stand *beside* the mascot rather than under it.
 *
 * A landscape phone (844x390, 2.16) is the case the branch was written for; a portrait one (0.70)
 * is the case it broke. 1.3 is between them with room on both sides — the nearest supported frame
 * on the wrong side of it is 1280x720 at 1.78, which has vertical room to spare and never asks.
 */
const SIDE_BY_SIDE_MIN_ASPECT = 1.3

const QUEST_BOARD_GAP = 18
