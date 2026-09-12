import * as Phaser from 'phaser'
import { showRewarded } from '../platform/adGate'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { t, tOptional } from '../i18n/strings'
import { titleCase } from '../ui/format'
import { bindLayout } from '../ui/layout'
import {
  kitBadge,
  kitButton,
  kitRow,
  kitTitle,
  plate,
  type KitBadge,
  type KitButton,
  type KitRow,
  type Plate,
  type RowState,
} from '../ui/kit'
import { uiScale } from '../ui/uiScale'
import { getCatalog, type ShopItem } from '../shop/catalog'
import { canAfford, earnCoins, hasPurchased, REWARDED_TOPUP_COINS, spendCoins } from '../shop/coins'
import { adOffer } from '../shop/adCatalog'
import { noteRewarded, rewardedLeft, sessionAdPolicy } from '../platform/adPolicy'
import { getState, mutate } from '../save/store'
import { scrollPanel, type ScrollPanel } from '../ui/scrollPanel'
import { contentHeight, windowHeight } from '../ui/scrollList'

export interface ShopData {
  opener: string
  /** Fired after a `'consumable'` item is purchased (coins already debited) — the game
   * applies whatever effect the item represents. Never called for `'unlock'` items; those
   * are tracked entirely in `SaveState.purchases`, nothing else needs telling. */
  onPurchase?: (item: ShopItem) => void
  /**
   * Called when an **already-owned** `'unlock'` row is tapped.
   *
   * Without this an owned unlock is a dead row — bought once and never touchable again, which
   * is right for a permanent capability and wrong for a cosmetic the player picks between.
   * Supplying it turns "Owned" into a two-state Select / In use control.
   */
  onSelect?: (item: ShopItem) => void
  /**
   * Whether an owned unlock is the one currently in use.
   *
   * A predicate rather than an id, because it is re-read on every refresh: the selection
   * changes while the shop is open, and a value captured at launch would go stale the moment
   * the player picks something.
   */
  isSelected?: (item: ShopItem) => boolean
}

const TOPUP_REWARD_ID = 'coins-topup'
/**
 * The session's ad budget is `adPolicy.ts`'s singleton, never a field of this scene.
 *
 * A scene is rebuilt every time it is opened and a session is not, so a per-instance counter would
 * hand the player three more top-ups every time they closed the shop and opened it again — a limit
 * that limits nothing. And a `static` here would be a *second* session budget beside `RunOver`'s,
 * which is the bug `sessionAdPolicy` was extracted to make unrepresentable.
 */

const PANEL_WIDTH = 420
const PANEL_SIDE_PADDING = 24
const ROW_WIDTH = PANEL_WIDTH - PANEL_SIDE_PADDING * 2
const ROW_HEIGHT = 52
const ROW_GAP = 10
const HEADER_HEIGHT = 60
const TOPUP_HEIGHT = 60
/**
 * The tab strip, and the gap between two tabs.
 *
 * Only drawn when the catalogue has more than one category - a game whose products are all one
 * kind gets the screen exactly as it was before tabs existed, chrome height included.
 */
const TABS_HEIGHT = 52
const TAB_GAP = 8
const TAB_FONT_SIZE = 15
const FOOTER_HEIGHT = 70
const TOP_PAD = 24
const BOTTOM_PAD = 16

/**
 * Largest fraction of the viewport's height the panel may take, and the smallest the row window
 * may shrink to.
 *
 * The panel used to be exactly as tall as its contents, which was correct while the catalogue was
 * eight rows and is unshippable at seventeen: 17 rows is 1044px of list before any chrome, so on
 * every phone in portrait the panel would extend past both edges of the screen and the Close
 * button would sit off the bottom. Capping the panel and scrolling the rows inside it is what
 * makes the catalogue's length stop being a layout constraint at all.
 *
 * `MIN_WINDOW_HEIGHT` is what stops a short landscape viewport from producing a zero- or
 * negative-height camera, which Phaser throws on rather than degrading.
 */
const MAX_PANEL_HEIGHT_FRACTION = 0.86
const MIN_WINDOW_HEIGHT = 60
/** How far the whole panel may be shrunk to fit a short frame — see `layout`. */
const MIN_FIT = 0.6

/** Below the plate's own negative depth — see the backdrop's own note in `create()`. */
const BACKDROP_DEPTH = -10

const TITLE_FONT_SIZE = 26
const TOPUP_FONT_SIZE = 17
const CLOSE_FONT_SIZE = 20

interface RowEntry {
  item: ShopItem
  row: KitRow
}

interface TabEntry {
  /** The category key, itself an i18n key - see `ShopItem.category`. */
  key: string
  button: KitButton
}

/** A row's whole title: the glyph, the translated name, the number after it, and what it does. */
function rowLabel(item: ShopItem): string {
  const name = tOptional(item.titleKey) ?? titleCase(item.id)
  const detail = item.detailKey === undefined ? undefined : tOptional(item.detailKey)

  return (
    `${item.icon} ${name}${item.titleSuffix ? ` ${item.titleSuffix}` : ''}` +
    `${detail ? `  · ${detail}` : ''}`
  )
}

/**
 * The shop, on the game's own widget kit.
 *
 * **What changed in the restyle, and what deliberately did not.** Every widget is now from
 * `ui/kit.ts` — the soft plate, the kit's rows, the coin badge — so the screen stops being neon
 * pink over a daylight sky. The scrolling, the tap-to-buy rule and the four row states are
 * untouched: each of them was worked out against a real defect (see below) and a restyle is not a
 * licence to re-litigate them.
 *
 * - **Rows buy on the tap, not on the press** (`bindAction`'s `tap: true`). The rows are the only
 *   thing there is to grab, so every scroll gesture begins on one; on the press, the first flick
 *   through the catalogue spends the player's coins.
 * - **The clip is a camera viewport, never a mask.** `setMask(geometryMask)` is a silent no-op
 *   under this renderer — see `ui/scrollRegion.ts`, where that is documented as a standing fact
 *   about Phaser rather than a bug to work around.
 * - **Four row states, distinguished by mark and not by tint alone.** `ui/kit.ts`'s `kitRow` draws
 *   the diamond on the one in use; the previous version differed only in the colour of the same
 *   label, which made the list something the player had to read word by word.
 */
export class Shop extends Phaser.Scene {
  private openerKey = ''
  private onPurchase?: (item: ShopItem) => void
  private onSelect?: (item: ShopItem) => void
  private isSelected?: (item: ShopItem) => boolean
  private backdrop!: Phaser.GameObjects.Rectangle
  private panel!: Plate
  private title!: Phaser.GameObjects.Text
  private coinsBadge!: KitBadge
  private topupButton!: KitButton
  private closeButton!: KitButton
  private rows: RowEntry[] = []
  /**
   * One tab per category in the catalogue, in the order the game registered them.
   *
   * Empty when every item shares a category (or has none), which is what keeps a single-kind
   * catalogue laying out exactly as it did before this existed. The tabs *filter* rather than
   * rebuild: every row is created once in `create()` and a hidden one is simply not visible, so
   * switching tabs allocates nothing and a row's purchase binding never has to be re-made.
   */
  private tabs: TabEntry[] = []
  private activeTab = ''

  /**
   * The scrolling window the rows are drawn through — clip, flick physics and pointer binding.
   *
   * A camera viewport rather than a mask, and that is a standing rule of this project rather than
   * a preference: `setMask(geometryMask)` is a **silent no-op** under this renderer — it warns and
   * returns without ever assigning `.mask` — so a masked list does not clip at all and scrolled
   * rows render straight over the header and the Close button. See `ui/scrollRegion.ts`.
   *
   * The wiring lives in `ui/scrollPanel.ts` since the loadout screen needed the same thing; what
   * stays here is the half only this scene can know, which objects belong to which camera.
   */
  private scroll!: ScrollPanel
  private windowSize = 0
  private rowsExtent = 0

  constructor() {
    super('Shop')
  }

  create(data: ShopData) {
    this.openerKey = data.opener
    this.onPurchase = data.onPurchase
    this.onSelect = data.onSelect
    this.isSelected = data.isSelected
    this.rows = []
    // **Reset beside `rows`, and for the same reason.** This scene is launched again every time the
    // player opens the shop, and `create()` builds a fresh set of buttons each time; a list that
    // survives the previous instance leaves `layoutTabs` sizing objects Phaser has already
    // destroyed, which throws inside the text renderer on a texture that is gone. Caught by opening
    // the shop a second time, not by reading the code.
    this.tabs = []

    // Same 0x0-until-layout() backdrop pattern as Settings.ts — see its own comment for why
    // setInteractive() can't be called until a real size exists.
    this.backdrop = this.add.rectangle(0, 0, 0, 0, 0x04121e, 0.66)
    // Explicitly below the plate. `plate()` puts its own graphics at a *negative* depth so it sits
    // under its contents (see `ui/kit.ts`), and a backdrop left at the default 0 therefore draws over
    // the panel rather than behind it — the panel still shows, dimmed by the very scrim meant to dim
    // the world behind it. Nothing errors and it looks plausible, which is why the depth is stated.
    this.backdrop.setDepth(BACKDROP_DEPTH)

    this.panel = plate(this)
    this.title = kitTitle(this, t('shop'), TITLE_FONT_SIZE)
    this.coinsBadge = kitBadge(this, '🪙', getState().coins)

    this.topupButton = kitButton(this, this.topupLabel(), { fontSize: TOPUP_FONT_SIZE })
    this.refreshTopup()
    bindAction(this, 'shopTopup', { pointer: this.topupButton.container }, () => {
      void this.requestTopup()
    })

    for (const item of getCatalog()) {
      const row = kitRow(this, rowLabel(item), `🪙 ${item.priceCoins}`, 'buy')
      // `tap: true`, not the default press: the rows are the only thing there is to grab, so a
      // press that starts a scroll always lands on one. On the press it would buy it.
      bindAction(this, `shopBuy:${item.id}`, { pointer: row.container, tap: true }, () => this.purchase(item))
      this.rows.push({ item, row })
    }

    this.buildTabs()
    this.refreshAllRows()

    this.closeButton = kitButton(this, t('close'), { primary: true, fontSize: CLOSE_FONT_SIZE })
    bindAction(this, 'close', { pointer: this.closeButton.container, keys: ['ESC', 'ENTER'] }, () => this.close())

    // Created after every widget exists, because both halves of the split are named explicitly:
    // the region's camera must ignore all the chrome, and the main camera must ignore the rows.
    // Nothing guesses which side an object belongs to — see `scrollRegion.ts`.
    this.scroll = scrollPanel(this)
    this.scroll.camera.ignore(this.chromeObjects())
    this.cameras.main.ignore(this.rowObjects())

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scroll.destroy()
      this.panel.destroy()
    })

    bindLayout(this, (width, height) => this.layout(width, height))
  }

  /** Everything drawn by the main camera, i.e. everything the scrolling window must not show. */
  private chromeObjects(): Phaser.GameObjects.GameObject[] {
    return [
      this.backdrop,
      ...this.panel.gameObjects,
      this.title,
      this.coinsBadge.container,
      this.topupButton.container,
      this.closeButton.container,
      ...this.tabs.map((tab) => tab.button.container),
    ]
  }

  /** Everything that scrolls. */
  private rowObjects(): Phaser.GameObjects.GameObject[] {
    return this.rows.map(({ row }) => row.container)
  }

  update(time: number, delta: number): void {
    this.scroll.update(time, delta)
  }

  layout(width: number, height: number): void {
    // **The list is what the active tab holds, not what the catalogue holds.** Every measurement
    // below - the panel's height, the window's height, the scroll extent - is about the rows the
    // player can actually reach, so a 21-row upgrade tab must not make the themes tab scroll.
    const visible = this.visibleRows()
    const tabsHeight = this.tabs.length > 1 ? TABS_HEIGHT : 0
    // **⚠ Fitted to the height, because the width said nothing about it.** On a landscape phone —
    // 828x300 once a webview's header has taken its share — the chrome alone was most of the panel
    // at full size, the list window was held at its 60px floor anyway, and the Close button was
    // drawn across the one row the window could show. The scale is solved so the chrome plus one
    // window's worth of list fits the panel, floored at `MIN_FIT`.
    const maxPanel = Math.max(height * MAX_PANEL_HEIGHT_FRACTION, height - 24)
    const chromeUnscaled = TOP_PAD + HEADER_HEIGHT + TOPUP_HEIGHT + tabsHeight + FOOTER_HEIGHT + BOTTOM_PAD
    const scale =
      uiScale(width) * Math.min(1, Math.max(MIN_FIT, maxPanel / ((chromeUnscaled + MIN_WINDOW_HEIGHT) * uiScale(width))))
    const rowsHeight = contentHeight(visible.length, ROW_HEIGHT, ROW_GAP)
    const chromeHeight = (TOP_PAD + HEADER_HEIGHT + TOPUP_HEIGHT + tabsHeight + FOOTER_HEIGHT + BOTTOM_PAD) * scale
    // The panel is as tall as its content wants **or** as tall as the screen allows, whichever is
    // smaller. Only the second branch scrolls; a short catalogue lays out exactly as it did before
    // this scene could scroll at all, which is what keeps the template's own demo unchanged.
    const panelHeight = Math.min(chromeHeight + rowsHeight * scale, maxPanel)
    const panelWidth = Math.min(PANEL_WIDTH * scale, width - 24)

    const cx = width / 2
    const cy = height / 2
    const panelTop = cy - panelHeight / 2
    const panelLeft = cx - panelWidth / 2

    this.backdrop.setPosition(cx, cy).setSize(width, height)
    if (!this.backdrop.input) {
      this.backdrop.setInteractive()
    } else {
      ;(this.backdrop.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height)
    }

    this.panel.draw(cx, cy, panelWidth, panelHeight)

    this.title.setFontSize(TITLE_FONT_SIZE * scale)
    this.title.setPosition(cx, panelTop + TOP_PAD * scale + (HEADER_HEIGHT * scale) / 2)

    this.coinsBadge.layout(scale)
    this.coinsBadge.container.setPosition(
      panelLeft + panelWidth - PANEL_SIDE_PADDING * scale - this.coinsBadge.width / 2,
      panelTop + TOP_PAD * scale + (HEADER_HEIGHT * scale) / 2,
    )

    this.topupButton.setFontSize(TOPUP_FONT_SIZE * scale)
    // The rewarded offer spans the row list it sits over, so the panel reads as one column rather
    // than as a centred chip above a stack of full-width rows.
    this.topupButton.setMinWidth(ROW_WIDTH * scale)
    this.topupButton.container.setPosition(cx, panelTop + (TOP_PAD + HEADER_HEIGHT) * scale + (TOPUP_HEIGHT * scale) / 2)

    this.layoutTabs(
      cx,
      panelTop + (TOP_PAD + HEADER_HEIGHT + TOPUP_HEIGHT) * scale + (tabsHeight * scale) / 2,
      scale,
      ROW_WIDTH * scale,
    )

    // The scrolling window: everything between the tab strip and the footer.
    const windowTop = panelTop + (TOP_PAD + HEADER_HEIGHT + TOPUP_HEIGHT + tabsHeight) * scale

    this.windowSize = windowHeight(panelHeight, chromeHeight, MIN_WINDOW_HEIGHT * scale)
    this.rowsExtent = contentHeight(visible.length, ROW_HEIGHT * scale, ROW_GAP * scale)
    this.scroll.setWindow(
      { x: panelLeft, y: windowTop, width: panelWidth, height: this.windowSize },
      this.rowsExtent,
    )

    // **Rows are positioned once, at their true unscrolled coordinates, and never touched again
    // by a scroll tick** — the camera pans over them. The coordinate they are laid out in is the
    // camera's, whose origin is the top of the window, so the first row sits at half a row down
    // and not at `windowTop`.
    let cursorY = (ROW_HEIGHT * scale) / 2

    for (const entry of this.rows) {
      const shown = visible.includes(entry)

      // A hidden row is hidden rather than moved off-window, which is also what keeps it out of the
      // input system: Phaser hit-tests through `willRender`, so an invisible container cannot be
      // tapped and the tab filter needs no second guard in the purchase path.
      entry.row.container.setVisible(shown)

      if (!shown) continue

      entry.row.layout(Math.min(ROW_WIDTH * scale, panelWidth - PANEL_SIDE_PADDING * 2 * scale), ROW_HEIGHT * scale, scale)
      entry.row.container.setPosition(panelWidth / 2, cursorY)
      cursorY += (ROW_HEIGHT + ROW_GAP) * scale
    }

    this.closeButton.setFontSize(CLOSE_FONT_SIZE * scale)
    this.closeButton.setMinWidth(ROW_WIDTH * scale)
    this.closeButton.container.setPosition(cx, panelTop + panelHeight - BOTTOM_PAD * scale - (FOOTER_HEIGHT * scale) / 2)
  }

  /**
   * One button per category the catalogue actually uses, in first-appearance order.
   *
   * **Order comes from the catalogue, not from the shop.** The shop has no opinion about whether
   * weapons matter more than themes — it cannot, since it does not know what either is — so the
   * game says which tab opens first by the order it registers its items in (see `main.ts`).
   *
   * A catalogue with one category (or none) gets no strip at all: a single tab is a label the
   * player can press, which teaches them that the control does nothing.
   */
  private buildTabs(): void {
    const keys: string[] = []

    for (const { item } of this.rows) {
      const key = item.category ?? ''

      if (!keys.includes(key)) keys.push(key)
    }

    this.activeTab = keys[0] ?? ''

    if (keys.length < 2) return

    for (const key of keys) {
      const button = kitButton(this, tOptional(key) ?? titleCase(key), {
        primary: key === this.activeTab,
        fontSize: TAB_FONT_SIZE,
      })

      bindAction(this, `shopTab:${key}`, { pointer: button.container }, () => this.setActiveTab(key))
      this.tabs.push({ key, button })
    }
  }

  /** The rows the active tab shows. */
  private visibleRows(): RowEntry[] {
    return this.rows.filter(({ item }) => (item.category ?? '') === this.activeTab)
  }

  /**
   * Switches tabs, and **jumps the list back to the top**.
   *
   * `setWindow` deliberately re-clamps the offset rather than resetting it, which is the right
   * answer for a rotation and the wrong one here: the content has been replaced, not reshaped, and
   * clamping would drop the player part-way down a list they have never seen.
   */
  private setActiveTab(key: string): void {
    if (key === this.activeTab) return

    this.activeTab = key

    for (const tab of this.tabs) tab.button.setPrimary(tab.key === key)

    this.scroll.scrollTo(0)
    this.layout(this.scale.width, this.scale.height)
  }

  /** The strip itself, centred on the panel and measured from the buttons' own widths. */
  /**
   * The tab strip, spanning the row column in equal shares.
   *
   * **They used to be auto-sized to their own labels and centred**, which made the one element on
   * the screen that did not line up with anything else: a short "Snails" beside a longer "Themes",
   * floating in the middle of a panel whose top-up button, rows and footer are all one column. Equal
   * shares also stop the strip's shape from depending on how long a translation is — the widths are
   * the panel's, not the words'.
   */
  private layoutTabs(cx: number, cy: number, scale: number, width: number): void {
    if (this.tabs.length < 2) return

    const gap = TAB_GAP * scale
    const each = (width - gap * (this.tabs.length - 1)) / this.tabs.length
    let cursorX = cx - width / 2

    for (const tab of this.tabs) {
      tab.button.setFontSize(TAB_FONT_SIZE * scale)
      tab.button.setMinWidth(each)
      tab.button.container.setPosition(cursorX + each / 2, cy)
      cursorX += each + gap
    }
  }

  /**
   * What the offer reads: what it pays, and what is left of it.
   *
   * **The count is on the button rather than in a tooltip nobody opens.** A rewarded offer with a
   * hidden limit is one the player discovers by being refused, which reads as the button being
   * broken — the same defect class as a target that silently ignores a stroke.
   */
  private topupLabel(): string {
    const offer = adOffer(TOPUP_REWARD_ID)
    const left = rewardedLeft(sessionAdPolicy(), offer.id, offer.perSession)

    if (left <= 0) return t('adSpent')

    return `${t('shopTopup', { n: REWARDED_TOPUP_COINS })}  ·  ${t('adLeft', { n: left })}`
  }

  private refreshTopup(): void {
    const offer = adOffer(TOPUP_REWARD_ID)

    this.topupButton.setText(this.topupLabel())
    this.topupButton.setEnabled(rewardedLeft(sessionAdPolicy(), offer.id, offer.perSession) > 0)
  }

  private async requestTopup(): Promise<void> {
    const offer = adOffer(TOPUP_REWARD_ID)

    if (rewardedLeft(sessionAdPolicy(), offer.id, offer.perSession) <= 0) return

    // Spent on the offer rather than on the reward, which is `noteContinue`'s own rule: a refused
    // ad that left the button pressable again would be a slot machine.
    noteRewarded(sessionAdPolicy(), offer.id)
    this.refreshTopup()

    const granted = await showRewarded(this.game, TOPUP_REWARD_ID)
    if (!granted) return
    mutate((s) => {
      s.coins = earnCoins(s.coins, REWARDED_TOPUP_COINS)
    })
    this.coinsBadge.setValue(getState().coins)
    this.refreshAllRows()
  }

  private purchase(item: ShopItem): void {
    const state = getState()
    if (item.kind === 'unlock' && (item.priceCoins <= 0 || hasPurchased(state.purchases, item.id))) {
      // Owned already: this tap is a selection, not a purchase. Falls through to the old
      // silent no-op when the caller did not supply a selector.
      if (this.onSelect && item.selectable !== false) {
        this.onSelect(item)
        this.refreshAllRows()
      }

      return
    }
    // The prerequisite is checked here as well as in the row's state, because a state is a picture
    // and a purchase is a debit: the two are refreshed at different moments, and only one of them
    // takes the player's coins.
    if (item.requires !== undefined && !hasPurchased(state.purchases, item.requires)) return
    if (!canAfford(state.coins, item.priceCoins)) return

    let spent = false
    mutate((s) => {
      const result = spendCoins(s.coins, item.priceCoins)
      if (result === null) return
      s.coins = result
      if (item.kind === 'unlock') s.purchases.push(item.id)
      spent = true
    })
    if (!spent) return

    this.coinsBadge.setValue(getState().coins)
    this.refreshAllRows()
    if (item.kind === 'consumable') this.onPurchase?.(item)
  }

  /**
   * Re-derives every row's state from the current balance and purchase list — called after both a
   * purchase (this item's own state changed) and a top-up (every row's affordability may have
   * changed).
   *
   * Four states rather than two, because the row means four different things and the player has to
   * be able to tell them apart at a glance: something they can buy, something they cannot yet
   * afford, something they own but are not using, and the one in use.
   */
  private refreshAllRows(): void {
    const state = getState()

    for (const { item, row } of this.rows) {
      // A zero-price unlock is owned by definition — it is a thing the player already has, listed so
      // that it can be *selected*. Without this it would render as a `Buy` row that, when tapped,
      // "spends" nothing and writes a purchase record for something nobody bought.
      const owned = item.kind === 'unlock' && (item.priceCoins <= 0 || hasPurchased(state.purchases, item.id))
      const affordable = canAfford(state.coins, item.priceCoins)
      // Not yet reachable at any price — something else has to be bought first. Distinguished from
      // "cannot afford" by its label rather than by its tint, because the two are different
      // problems: one is solved by playing another run, the other by buying the row above.
      const blocked = !owned && item.requires !== undefined && !hasPurchased(state.purchases, item.requires)
      const label = rowLabel(item)
      let stateName: RowState

      if (!owned) stateName = !blocked && affordable ? 'buy' : 'locked'
      else if (this.isSelected?.(item)) stateName = 'selected'
      else stateName = 'owned'

      // With no selector supplied — or for an item that is not a choice at all, like an upgrade
      // that applies the moment it is bought — an owned unlock is a finished transaction rather
      // than a control, so it says so. A `Select` the player can tap and see nothing happen is
      // worse than a label.
      const selectable = item.selectable !== false && this.onSelect !== undefined
      const actionLabel = blocked ? t('shopLocked') : owned && !selectable ? t('owned') : undefined

      row.setContent(label, owned ? '' : `🪙 ${item.priceCoins}`, stateName, actionLabel)
    }
  }

  private close(): void {
    this.scene.stop()

    if (isPlatformPaused()) {
      this.game.events.once(YTEvents.RESUME, () => {
        this.scene.resume(this.openerKey)
      })
      return
    }

    this.scene.resume(this.openerKey)
  }
}
