import * as Phaser from 'phaser'
import { bindAction } from '../platform/input'
import { getState, mutate } from '../save/store'
import { WorldView } from '../run/WorldView'
import { PlayerView } from '../run/PlayerView'
import { buildMenuCircuit } from '../road/circuits'
import { ensureThemeTextures } from '../road/applyTheme'
import { kitButton, type KitButton } from '../ui/kit'
import { KIT } from '../ui/kitPalette'
import { toCssColor } from '../ui/theme'
import { ensureMinHitArea, uiScale } from '../ui/uiScale'
import { createNavBar, drawNavSurface, type NavBar } from '../ui/navBar'
import { exitButtonBox } from '../ui/exitButton'
import { launchOverlay } from '../ui/overlay'
import { isCosmeticSelected, selectCosmetic } from '../shop/cosmetics'
import type { ShopItem } from '../shop/catalog'
import { bindLayout } from '../ui/layout'
import { INK } from '../run/artPalette'
import { playSfx } from '../audio/audio'
import { SFX } from '../audio/sfx'
import { spendCoins } from '../shop/coins'
import { ownsSnailSkin, resolveSelectedSnail, skinItemId, snailSkin, snailSkinIds } from '../run/snailSkins'
import { EXIT_GLYPH, EXIT_PLATED_ALPHA } from '../ui/exitButton'
import { wardrobeStack, wardrobeStrip, wardrobeStripHeight } from '../ui/garageLayout'
import { createPlayerState } from '../run/playerMotion'
import { PLAYER_Z, readableScale, SPEED_BASE } from '../run/constants'
import { t, tOptional } from '../i18n/strings'
import { titleCase } from '../ui/format'

/**
 * The garage: the mascot at full height, and the wardrobe cycled around it.
 *
 * ## ⚠ A skin was a row in a list, and the thing being sold was not on screen
 *
 * Skins shipped as rows in the shop — a glyph, a name and a price — and the only preview was the
 * snail standing on the front screen *behind* the panel, at menu size, half covered by it. So the
 * player was choosing the game's entire visual identity from a word. The mascot is the product;
 * it has to be the thing you are looking at while you choose.
 *
 * ## ⚠ It is `start`ed, never `launch`ed, and that is a hard requirement rather than a preference
 *
 * This screen draws the game's own world, which means it builds a `WorldView` — and **two worlds may
 * never be alive at once**. That rule has now been reached from four directions in this project
 * (`applyTheme`'s precondition, `scene.start('RunScene')` over a live menu, the result screen's Menu
 * button, the shop opened twice), and every one of them surfaced as `Cannot read properties of
 * undefined (reading 'glTexture')` a frame or two later, with a stack pointing nowhere near the
 * cause.
 *
 * `ScenePlugin.start` shuts the calling scene down, so `MainMenu` is gone — and with it its world —
 * before this one's is built. An overlay `launch`ed over a paused menu would have had both.
 *
 * What that costs is that the road is not continuous across the transition, unlike the menu's own
 * handover into a run. It is the right trade here: the handover into a run exists so the player
 * cannot see a seam between choosing and playing, and there is no such continuity to protect
 * between a menu and a wardrobe.
 */
export class Garage extends Phaser.Scene {
  private world!: WorldView
  private mascot!: PlayerView
  private previous!: KitButton
  private next!: KitButton
  private action!: KitButton
  /**
   * The way out, as a glyph rather than as a button.
   *
   * **⚠ It was a solid `kitButton` and was the highest-contrast object on the screen** — larger
   * than the two arrows that page the wardrobe, which are what this screen is for. That is the run
   * HUD's own finding arriving on a second screen, so it is the run HUD's own answer: 20px of type,
   * with `ensureMinHitArea` putting the 44px target back under it. Small type, big target.
   *
   * **⚠ And then it was reported the other way: at `EXIT_ALPHA` over open sky nobody could see it.**
   * Both reports are right, and what reconciles them is that the run's exit sits inside the top
   * band's wash beside two readouts while this one had nothing behind it at all — so the quiet ink
   * that reads as restraint there read as an unfinished mark here. The answer is the surface rather
   * than the ink: it stands on the bottom bar's own plate (`drawNavSurface`), which is the one
   * piece of chrome on this screen the player already knows is chrome, and the glyph goes to
   * `EXIT_PLATED_ALPHA` because it is now read against that plate and not against the picture.
   *
   * **The coin readout in the opposite corner deliberately does not get one.** A plate says *this
   * is a control*; the balance is a fact about the player, and putting the two on matching chips
   * would invite a tap on the one that does nothing.
   */
  private close!: Phaser.GameObjects.Text
  /** The plate under it — the bottom bar's own surface, so the way out reads as chrome. */
  private closePlate!: Phaser.GameObjects.Graphics
  /**
   * The overview strip: one dot per entry, under the caption.
   *
   * A `Graphics` rather than one object per entry, because it is redrawn on every step and each
   * image would be one more thing to keep in the camera lists — an object created after `create()`
   * is in neither list, i.e. drawn by both cameras.
   */
  private strip!: Phaser.GameObjects.Graphics
  private name!: Phaser.GameObjects.Text
  private hint!: Phaser.GameObjects.Text
  private uiCamera!: Phaser.Cameras.Scene2D.Camera
  private nav!: NavBar
  /**
   * The wardrobe: the mascot's colours, and nothing else.
   *
   * **⚠ It sold worn items for one round and they are gone.** Five accessories shipped behind a
   * rubric selector — a crown, a cap, a helmet, goggles, a jetpack — and were reported on sight:
   * they look poor on the creature. What is left is the thing the recolour argument was always
   * about (`snailSkins.ts`): the mascot is one drawing, and what a skin may change is where its two
   * hue families sit on the wheel. See `run/snailSkins.ts` for what that buys and CLAUDE.md for
   * what the items cost to find out.
   */
  private entries: string[] = []
  private index = 0
  private readonly mascotState = createPlayerState()
  /**
   * The mascot box the stack was last placed against, or `null` for "not placed yet".
   *
   * **The layout is an event, not a frame.** It used to run every tick off `drawnBox`, which is
   * what let the road resize the caption — see `placeLabels`. What moves it now is a resize, a
   * change of entry, and the box itself moving.
   *
   * **⚠ That last one is not redundant even with the road frozen**, and a plain "placed once" flag
   * shipped for about ten minutes before the measurement caught it: `cameraLean` eases from 0 to
   * its target over roughly a second whatever the speed is, so the creature drifts laterally after
   * the first frame. Placed once, the arrows kept the position they were given at frame one and
   * ended up sitting on the mascot's own edge, 11px in from where the standoff puts them.
   */
  private placedAgainst: { left: number; right: number; top: number; bottom: number } | null = null

  constructor() {
    super('Garage')
  }

  create(): void {
    ensureThemeTextures(this)
    // **The front screen's own world, on the front screen's own circuit.** Not a second look for a
    // second screen: the wardrobe is the menu with the interface swapped, and a different road
    // behind it would say the player had gone somewhere.
    this.world = new WorldView(this, { circuit: 'menu', speed: SPEED_BASE, decorSeed: 4242 })
    // **⚠ The road does not move on this screen, and that reverses what shipped.** It ran at the
    // front screen's own speed on the argument that a still frame behind a wardrobe would look
    // broken rather than calm — a fair claim about the *picture*, and the wrong one about the
    // *layout*: every control here hangs off the mascot's drawn box, the box is the projection's,
    // and the projection answers to a road that undulates. So the caption's own font size changed
    // several times a second as the hills went by, which is how it was reported. Frozen, the box is
    // a constant and the screen is what a wardrobe should be — one thing, held still, to look at.
    // `advance` is still called, so the sun's own clock keeps running: what stops is the ground.
    this.world.setSpeed(0)

    const owned = getState()
    const worn = resolveSelectedSnail(owned.selectedSnail, owned.purchases)

    // Colours first, then items. The order is the tab order the shop's own catalogue uses and for
    // the same reason: the cheap tier is what a new player is looking at, and the free colour
    // standing in row one is what says this is a wardrobe rather than a paywall.
    this.entries = snailSkinIds()
    // Opened on the colour the player is actually wearing, which is the one thing on this screen
    // they have already chosen.
    this.index = Math.max(0, this.entries.indexOf(worn))
    // The same `sizeScale` argument the front screen makes: there is no collision here, so the one
    // place the drawn box may exceed the model's is a screen with no model on it. See `PlayerView`.
    // Bigger than the front screen stands it, because here it *is* the screen. The same argument
    // `PlayerView.sizeScale` records: there is no collision on a menu, so this is the one place the
    // drawn box may exceed the model's.
    this.mascot = new PlayerView(this, { sizeScale: GARAGE.mascotScale, skin: worn })

    this.name = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 30, color: toCssColor(KIT.rim) }).setOrigin(0.5, 0.5)
    this.hint = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 18, color: toCssColor(KIT.muted) }).setOrigin(0.5, 0.5)
    this.strip = this.add.graphics()
    for (const text of [this.name, this.hint]) text.setStroke(toCssColor(INK), 5)

    // **Arrows, not a list.** The whole point of this screen is that exactly one skin is on it at a
    // time and it is the size of the product; a strip of thumbnails would be the row list again.
    // **⚠ Smaller than they were, because the report was a ratio.** At 34 the kit delivers a 59px
    // box, which is a slab beside a mascot the projection draws at a fixed share of a small frame.
    // The floor is what may not move — `kitButton` keeps its own box at `MIN_TOUCH` — so this is
    // the glyph getting quieter rather than the target getting harder to hit.
    this.previous = kitButton(this, '‹', { fontSize: GARAGE.arrowSize })
    this.next = kitButton(this, '›', { fontSize: GARAGE.arrowSize })
    this.action = kitButton(this, '', { fontSize: 22, solid: true })
    // **The way out stands on the bottom bar's own plate**, and it is created before the glyph so
    // the display list draws it underneath — everything here shares one depth, so creation order is
    // the order. See `EXIT_PLATED_ALPHA`: a bare ✕ over open sky was reported as unnoticeable, and
    // what answers that is a surface rather than louder ink.
    this.closePlate = this.add.graphics()
    this.close = this.add
      .text(0, 0, '✕', { fontFamily: 'Arial', fontSize: EXIT_GLYPH, color: toCssColor(KIT.rim) })
      .setOrigin(0.5)
      .setAlpha(EXIT_PLATED_ALPHA)
    // The bar's own icons carry the same ink stroke, so the glyph reads the same way on the same
    // surface rather than being a different kind of mark that happens to sit on one.
    this.close.setStroke(toCssColor(INK), 3)
    // **The bar is on this screen too, with `garage` lit.** A destination that can only be left by
    // going back is a dead end: the whole point of a tab bar is that the three places connect to
    // each other rather than each to a home screen.
    this.nav = createNavBar(this, 20)

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    this.uiCamera.ignore(this.worldObjects())
    this.cameras.main.ignore(this.uiObjects())

    bindAction(this, 'primary', { pointer: this.previous.container }, () => this.cycle(-1))
    bindAction(this, 'primary', { pointer: this.next.container }, () => this.cycle(1))
    bindAction(this, 'primary', { pointer: this.action.container }, () => this.act())
    bindAction(this, 'close', { pointer: this.close, keys: ['ESC'] }, () => this.leave())
    // Its own tab returns to the menu, which is what the close does: pressing where you already are
    // has to do something, and the only honest something is "leave".
    bindAction(this, 'openGarage', { pointer: this.nav.targets.garage }, () => this.leave())
    // **⚠ Through `launchOverlay`, never `pause` + `launch` by hand.** Scenes are painted in
    // registration order, and this one is registered after `Settings` and `Shop` — so opening
    // either from here drew the panel *underneath* the garage's own full-frame world and left a
    // paused front screen with nothing on it. See `ui/overlay.ts`.
    bindAction(this, 'openShop', { pointer: this.nav.targets.shop }, () => {
      // **⚠ With no `onSelect` the shop cannot sell a look, only charge for one.** `Shop` marks a
      // row selectable only when its opener handed it a callback, so an owned theme opened from
      // here read `Owned` with no control anywhere that wears it — the Buy/Owned defect this
      // screen's own action button exists to avoid, arriving through the door the nav bar opened.
      // The pair is `MainMenu`'s, moved into `shop/cosmetics.ts` rather than copied.
      launchOverlay(this, 'Shop', {
        opener: 'Garage',
        onSelect: (item: ShopItem) => selectCosmetic(this, { world: this.world, mascot: this.mascot }, item),
        isSelected: (item: ShopItem) => isCosmeticSelected(item),
      })
    })
    bindAction(this, 'openRecords', { pointer: this.nav.targets.records }, () => {
      launchOverlay(this, 'Records', { opener: 'Garage' })
    })
    bindAction(this, 'openSettings', { pointer: this.nav.targets.settings }, () => {
      launchOverlay(this, 'Settings', { opener: 'Garage' })
    })

    // The shop can wear a skin and switch a theme, so both this screen's labels and its arrow
    // position are stale the moment it closes. Same listener, and the same reason, as the menu's.
    this.events.on(Phaser.Scenes.Events.RESUME, () => {
      // The shop can switch a theme behind this screen, which rebuilds the mascot's textures — so
      // the preview has to be re-applied rather than assumed to have survived.
      this.preview()
      this.refresh()
      this.layout(this.scale.width, this.scale.height)
    })

    this.refresh()
    bindLayout(this, (width, height) => this.layout(width, height))

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tweens.killAll()
      this.mascot.destroy()
      this.world.destroy()
    })
  }

  /**
   * Steps to the next entry, wrapping.
   *
   * **The mascot changes immediately, before anything is bought.** That is the whole feature: the
   * preview *is* the product, so looking costs nothing and commits to nothing. What the save
   * records is only ever what was equipped.
   */
  private cycle(step: number): void {
    this.index = (this.index + step + this.entries.length) % this.entries.length
    this.preview()
    playSfx(SFX.PICKUP)
    this.refresh()
    this.layout(this.scale.width, this.scale.height)
  }

  /** The entry currently on screen, which is not necessarily the one being worn. */
  private shown(): string {
    const entry = this.entries[this.index]

    if (!entry) throw new Error(`garage is showing an entry that does not exist: ${this.index}`)

    return entry
  }


  /**
   * Puts the colour on screen onto the mascot, before anything is bought.
   *
   * That is the whole feature: the preview *is* the product, so looking costs nothing and commits
   * to nothing. What the save records is only ever what was equipped.
   */
  private preview(): void {
    this.mascot.setSkin(this, this.shown())
  }


  /**
   * Buys, equips, or does nothing — the three states this button has to have.
   *
   * **⚠ Three at minimum, never two.** A Buy/Owned pair hides a real defect: the coins go, the
   * label changes, and nothing in the game is different because no control equips the thing. That
   * is the hangar's finding when hulls shipped, and it is the same button here.
   *
   * **There is no fourth state now.** `Remove` existed because an item could be taken *off* — there
   * is no "no colour", and there are no items any more.
   */
  private act(): void {
    const id = this.shown()
    const state = getState()
    const price = snailSkin(id)?.priceCoins ?? 0
    const owns = ownsSnailSkin(state.purchases, id)

    if (!owns) {
      const spent = spendCoins(state.coins, price)

      if (spent === null) return

      mutate((save) => {
        save.coins = spent
        save.purchases = [...save.purchases, skinItemId(id)]
        // Bought and worn in one action: the thing just paid for is already standing in front of
        // the player, and a second identical-looking tap is not a decision.
        save.selectedSnail = id
      })
      playSfx(SFX.MILESTONE)
    } else {
      if (state.selectedSnail === id) return

      mutate((save) => {
        save.selectedSnail = id
      })
      playSfx(SFX.PICKUP)
    }

    this.preview()
    this.refresh()
    this.layout(this.scale.width, this.scale.height)
  }


  /** Re-reads the save and re-labels everything. Cheap, and the only place the labels are decided. */
  private refresh(): void {
    const id = this.shown()
    const state = getState()
    const skin = snailSkin(id)
    const price = skin?.priceCoins ?? 0
    const owns = ownsSnailSkin(state.purchases, id)
    const worn = state.selectedSnail === id

    // The i18n key if it has one, the id title-cased if it does not — the same fallback the shop
    // rows use, so a colour can ship before its translation does.
    this.name.setText(tOptional(skin?.titleKey ?? id) ?? titleCase(id))
    this.hint.setText(`🪙 ${state.coins}`)
    this.action.setText(worn ? 'Worn' : owns ? 'Wear' : `Buy · ${price}`)
    // A button that cannot do anything says so by being disabled rather than by vanishing: a
    // control that disappears takes its own explanation with it.
    this.action.setEnabled(worn ? false : owns || state.coins >= price)
    // **The stack is sized from these two labels, so changing them is one of the three things that
    // moves it.** Nothing places them per frame any more — see `placeLabels`.
    if (this.placedAgainst) this.placeLabels(this.scale.width, this.scale.height)
  }

  private leave(): void {
    this.scene.start('MainMenu')
  }

  private worldObjects(): Phaser.GameObjects.GameObject[] {
    return [...this.world.gameObjects, ...this.mascot.gameObjects]
  }

  private uiObjects(): Phaser.GameObjects.GameObject[] {
    return [
      this.name,
      this.hint,
      this.previous.container,
      this.next.container,
      this.action.container,
      this.closePlate,
      this.close,
      this.strip,
      ...this.nav.objects,
    ]
  }

  update(_time: number, delta: number): void {
    // The road runs, at the front screen's own fraction of a run's speed: this is the same attract
    // mode, and a still frame behind a wardrobe would make the world look broken rather than calm.
    this.world.advance(delta, 1)
    this.world.render(this.scale.width, this.scale.height)
    // After the world, never before: it reads this frame's segment projections out of the mesh pass.
    this.mascot.render(
      this.mascotState,
      this.world.track,
      this.world.baseIndex,
      // Stood further up the road than a run stands it, which is what raises its row out of the
      // button band — the same lever the front screen pulls. See `MASCOT.zScale` there.
      this.world.cameraZ + PLAYER_Z * (GARAGE.zScale - 1),
      this.scale.width,
      this.scale.height,
      1,
      this.world.cameraZ,
    )
    // **Placed from where the mascot actually is, not from a fraction of the frame** — but placed
    // *once*, on the first frame the projection has drawn one. `layout` runs before any render, so
    // the box is still zero then and the stack would sit on a guess forever if this never ran.
    if (this.mascotMoved()) this.placeLabels(this.scale.width, this.scale.height)
  }

  /**
   * The name and the action, stacked under the mascot's own drawn bottom edge.
   *
   * Run every frame rather than only on a resize, because the box it hangs off moves: the mascot is
   * drawn through the road's projection and the menu circuit bends, so its feet wander laterally
   * and its size answers to the frame.
   *
   * **⚠ The caption is never placed above the feet, which is exactly what the old `Math.min` did.**
   * See `wardrobeStack` for the whole of that report, and for what a frame with no room under the
   * mascot does instead.
   */
  private placeLabels(width: number, height: number): void {
    const scale = uiScale(width)
    const drawn = this.mascot.drawnBox.bottom > 0

    // **⚠ The heights are measured at FULL size, and reading the drawn ones was a feedback loop.**
    // `fit` is solved from how much room the stack needs, and the stack was measured *after* the
    // previous pass had already shrunk it — so a fit under 1 made the text smaller, which made the
    // next frame's `needed` smaller, which raised the fit, which made the text bigger again. It sat
    // still only where the floor clamped it. Measured unfitted, `fit` is a function of the frame
    // and the entry rather than of its own last answer.
    this.name.setFontSize(GARAGE.nameSize * scale)
    this.action.setFontSize(GARAGE.actionSize * scale)

    const boxes = wardrobeStack(
      width,
      height,
      scale,
      drawn ? this.mascot.drawnBox : fallbackBox(width, height),
      height - this.nav.heightAt(width),
      { name: this.name.height, action: this.action.height, arrow: this.previous.width },
    )

    this.name.setFontSize(GARAGE.nameSize * scale * boxes.fit)
    this.action.setFontSize(GARAGE.actionSize * scale * boxes.fit)
    // Only a pass against the real box counts as placed; the fallback one is a guess for the frame
    // before the projection has drawn anything, and must not be what the next frame compares to.
    this.placedAgainst = drawn ? { ...this.mascot.drawnBox } : null
    this.name.setPosition(boxes.name.x, boxes.name.y)
    this.action.container.setPosition(boxes.action.x, boxes.action.y)
    this.drawStrip(boxes.name.x, boxes.name.y + (this.name.height * boxes.fit) / 2 + wardrobeStripHeight(scale) / 2)
    // **The arrows page the mascot, so they belong beside the mascot.** They sat on a fixed
    // fraction of the frame's height and came out level with the mountains — a long way from the
    // thing they change, which is how it was reported.
    this.previous.container.setPosition(boxes.arrows.leftX, boxes.arrows.y)
    this.next.container.setPosition(boxes.arrows.rightX, boxes.arrows.y)
  }

  /**
   * Whether the creature has moved since the stack was placed against it.
   *
   * A pixel of tolerance, because the comparison is against a float the projection recomputes every
   * frame: an exact test would re-lay the whole stack forever on a road that is standing still.
   */
  private mascotMoved(): boolean {
    const was = this.placedAgainst

    if (!was) return true
    const box = this.mascot.drawnBox

    return (
      Math.abs(box.left - was.left) > 1 ||
      Math.abs(box.right - was.right) > 1 ||
      Math.abs(box.top - was.top) > 1 ||
      Math.abs(box.bottom - was.bottom) > 1
    )
  }

  /**
   * The strip: owned entries filled, the worn ones ringed, the one on screen bigger than the rest.
   *
   * **Not interactive**, deliberately — see `wardrobeStrip`. It answers "how many, and where am I",
   * which is the pair the arrows cannot; tapping one would be the second selector it exists instead
   * of.
   */
  private drawStrip(centreX: number, y: number): void {
    const state = getState()
    const dots = wardrobeStrip(centreX, y, uiScale(this.scale.width), this.entries.length, this.index)

    this.strip.clear()
    dots.forEach((dot, i) => {
      const id = this.entries[i] ?? ''
      const owns = ownsSnailSkin(state.purchases, id)
      const worn = state.selectedSnail === id

      this.strip.fillStyle(worn ? KIT.active : KIT.rim, owns ? 1 : 0.28)
      this.strip.fillCircle(dot.x, dot.y, dot.radius)
      // The one on screen keeps a ring whether or not it is owned, or a run of unowned items would
      // leave the player unable to see where they are in the list at all.
      if (dot.current) {
        this.strip.lineStyle(Math.max(1.5, dot.radius * 0.35), KIT.rim, 0.9)
        this.strip.strokeCircle(dot.x, dot.y, dot.radius * 1.5)
      }
    })
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)

    this.uiCamera.setSize(width, height)
    this.world.layout(width, height)

    // **⚠ The front screen grows its mascot on a narrow frame and this one did not**, which is the
    // whole of "the arrows are huge next to the snail on mobile". Everything on this road is sized
    // off the frame's WIDTH, so the creature is the same *share* of every viewport — while an arrow
    // is floored at `MIN_TOUCH`, an absolute 44px. On a 383px frame that puts two arrows either side
    // of a snail barely wider than one of them; on a desktop the same pair is a sixth of it. So the
    // ratio is a property of the device, and `readableScale` is the lever that was already built for
    // exactly this and already used by `MainMenu` — 1 at 1280px and wider, up to 1.9 on a phone.
    // It costs nothing here: there is no collision on this screen, which is what `sizeScale` is for.
    this.mascot.setSizeScale(GARAGE.mascotScale * readableScale(width))
    this.placedAgainst = null

    this.previous.setFontSize(GARAGE.arrowSize * scale)
    this.next.setFontSize(GARAGE.arrowSize * scale)
    this.hint.setFontSize(20 * scale)
    // The balance sits where the run puts its own coin readout: a corner, permanently, because it
    // is a fact about the player rather than about the entry currently on screen.
    this.hint.setOrigin(0, 0)
    this.hint.setPosition(GARAGE.corner * scale, GARAGE.corner * scale)
    this.close.setFontSize(EXIT_GLYPH * scale)

    // **⚠ This used to set the container's CENTRE a flat 28px in, and a `kitButton` is drawn from
    // its centre**, so the shipped 62x48 glyph reached 3px past the right edge and its rim was cut
    // off along the top — reported on both a phone and a desktop frame. `exitButtonBox` is the run
    // HUD's own answer to the same corner: it takes the control's *measured* box and insets that,
    // so the margin is the same however wide the glyph turns out to be. The coin readout in the
    // opposite corner is inset by the same number, which is what makes the top row read as a pair.
    const corner = exitButtonBox(width, scale, { w: this.close.width, h: this.close.height }, GARAGE.corner)

    this.close.setPosition(corner.x + corner.w / 2, corner.y + corner.h / 2)
    // The reserved corner *is* the plate, so the chip cannot end up a different size from the
    // target under it — which is the defect `exitButtonBox` exists to have fixed once already.
    this.closePlate.clear()
    drawNavSurface(this.closePlate, corner.x, corner.y, corner.w, corner.h, scale, GARAGE.closeRadius)
    // Small glyph, big target — the split `sliderHitHeight` already makes for a rail nobody could
    // otherwise hit, and what lets the way out be quiet without being unpressable.
    ensureMinHitArea(this.close)
    this.nav.layout(width, height, 'garage')

    this.placeLabels(width, height)

    // **⚠ Never `ensureMinHitArea` on a `KitButton`'s label, which is what this used to do.**
    // `kitButton` already floors its container's own box at `MIN_TOUCH`, and the container is what
    // `bindAction` binds; padding the *label* makes a second interactive object inside the first,
    // and which of the two a press reaches is decided by hit-test ordering nothing here controls.
    // When the Text wins, the press lands on an object with no handler and is swallowed — the
    // control simply stops responding, which is how the close button was reported. `Records` and
    // `Records` carries the same note; this was one of the panels doing it.
  }
}

/**
 * Where the pieces sit.
 *
 * **Nothing here is a fraction of the frame any more.** Every position on this screen now hangs off
 * the mascot's own measured box (`wardrobeStack`) or off a corner — which is the correction the
 * three reported defects share: a caption placed by a fraction landed on the shell, and arrows
 * placed by a fraction landed level with the mountains. What is left is how big the creature is,
 * how far up the road it stands, and how far in the two corner readouts sit.
 */
const GARAGE = {
  /** How much bigger than a run's mascot this one is drawn. The screen is the mascot. */
  mascotScale: 4.9,
  /**
   * How far up the road it stands, which is the only lever that moves its feet.
   *
   * **⚠ Raised from 1.35, and that is what the caption's report actually cost.** The drawn size is
   * `mascotScale` and is unaffected by this — standing the mascot further out raises its feet
   * without shrinking it, because the offset from the horizon goes as `1 / z` — so this is free
   * room under the creature and nothing else. At 1.35 the band between the feet and the bar was
   * shorter than the two-row stack on every portrait frame, which is what made the old clamp fire
   * and put the name on the shell. What it cannot do is lift the feet past the horizon, which is
   * why a short landscape frame still needs `wardrobeStack`'s side layout.
   *
   * **⚠ Raised again, 2.2 -> 2.7, and `mascotScale` moved WITH it — the pair is one lever.** The
   * two are not independent: the projection scales as `1 / z`, so standing the creature further out
   * shrinks it, and the note above is right only about where the *feet* land. Held at the same
   * ratio (4.9 / 2.7 against 4.0 / 2.2, 0.2% apart) the mascot is drawn at exactly the size it was
   * and its feet are 22px higher on a 720px frame — which is what buys the caption its room back.
   * It was needed because measuring the labels honestly (see `placeLabels`) made `needed` bigger
   * than the flattering figure the old feedback loop produced, and 1280x720 tipped into the side
   * layout as a result — a caption drawn over the scenery on a frame with visible room under the
   * snail. Delivered `fit`: 0.72 -> 0.82 at 383px, and "under" restored at 1280x720.
   */
  zScale: 2.7,
  nameSize: 30,
  actionSize: 22,
  /** The chevrons' glyph. Their *box* is `kitButton`'s own `MIN_TOUCH` floor and is not this. */
  arrowSize: 26,
  /** How far in from the frame's edges both top-corner readouts sit, in unscaled pixels. */
  corner: 20,
  /**
   * The exit chip's corner radius, in unscaled pixels.
   *
   * **Its own number rather than the bar's `NAV_BAR.radius`, because the two boxes are not the same
   * shape.** 14 on a 50px-tall bar spanning the frame is a soft edge; the same 14 on a 44px square
   * is very nearly a circle, which reads as a different family of control. This is the radius that
   * gives a square chip the bar's own *proportion* of rounding rather than its absolute value.
   */
  closeRadius: 11,
} as const

/**
 * Where the stack goes on the first frame, before the projection has put the mascot anywhere.
 *
 * `layout` runs from `bindLayout` at scene create, which is before any `update` — so the drawn box
 * is still zero and a stack hung off it would be laid out at the top of the frame for exactly one
 * frame. A box roughly where the mascot lands keeps that frame from being visibly wrong.
 */
function fallbackBox(width: number, height: number): { left: number; right: number; top: number; bottom: number } {
  return { left: width * 0.3, right: width * 0.7, top: height * 0.3, bottom: height * 0.7 }
}
