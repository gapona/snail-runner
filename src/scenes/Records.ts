import * as Phaser from 'phaser'
import { bindAction } from '../platform/input'
import { getState } from '../save/store'
import { kitButton, type KitButton } from '../ui/kit'
import { KIT } from '../ui/kitPalette'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'
import { bindLayout } from '../ui/layout'
import { formatCount } from '../ui/format'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { ownsSnailSkin, snailSkinIds } from '../run/snailSkins'
import { themeIds } from '../road/themes'
import { ownsTheme } from '../shop/themeCatalog'
import { resolveQuestBoard } from '../run/quests'

/**
 * What the player has to show for it: the record, the purse, and the collection.
 *
 * **⚠ An endless runner keeps almost nothing, and that is the problem this answers.** The only
 * durable number was `bestScore`, shown as one line under the Play button — so a session's whole
 * legacy was a figure the player had already seen and could not compare against anything. What a
 * records screen adds is not more numbers, it is *shape*: a best to beat, a purse to spend, and two
 * collections with a denominator, which is the only thing here that says how much game is left.
 *
 * **An overlay, not a screen of its own**, and that is a deliberate difference from the garage. That
 * one had to build a `WorldView` because the mascot has to stand on a road; this is a list, so it
 * can be `launch`ed over whatever opened it — and the rule it therefore never has to obey is the one
 * that has bitten this project five times. See `Garage` for the other side of the same decision.
 */
export class Records extends Phaser.Scene {
  private openerKey = ''
  private backdrop!: Phaser.GameObjects.Rectangle
  private plate!: Phaser.GameObjects.Graphics
  private title!: Phaser.GameObjects.Text
  private rows: { label: Phaser.GameObjects.Text; value: Phaser.GameObjects.Text }[] = []
  private divider!: Phaser.GameObjects.Graphics
  private closeButton!: KitButton

  constructor() {
    super('Records')
  }

  init(data: { opener: string }): void {
    this.openerKey = data.opener
  }

  create(): void {
    this.backdrop = this.add.rectangle(0, 0, 0, 0, 0x000000, 0.55).setOrigin(0, 0).setDepth(BACKDROP_DEPTH)
    // The panel is drawn rather than composed from a kit widget: `kitPlate` does not exist, and
    // what this needs is one rounded box with the coin rim every other panel got in the restyle.
    this.plate = this.add.graphics().setDepth(0)
    this.divider = this.add.graphics().setDepth(1)
    this.title = this.add
      .text(0, 0, 'Records', { fontFamily: 'Arial', fontSize: 30, color: toCssColor(KIT.coin), fontStyle: 'bold' })
      .setOrigin(0.5, 0.5)
      .setDepth(1)

    for (let i = 0; i < ROW_COUNT; i++) {
      this.rows.push({
        label: this.add
          .text(0, 0, '', { fontFamily: 'Arial', fontSize: 18, color: toCssColor(KIT.rim) })
          .setOrigin(0, 0.5)
          .setDepth(1),
        value: this.add
          .text(0, 0, '', { fontFamily: 'Arial', fontSize: 18, color: toCssColor(KIT.coin) })
          .setOrigin(1, 0.5)
          .setDepth(1),
      })
    }

    this.closeButton = kitButton(this, 'Close', { fontSize: 20, muted: true })
    bindAction(this, 'close', { pointer: this.closeButton.container, keys: ['ESC', 'ENTER'] }, () => this.close())

    this.refresh()
    bindLayout(this, (width, height) => this.layout(width, height))
  }

  /**
   * Reads the save once and fills the rows.
   *
   * **Two of these carry a denominator and three do not, which is the whole reason the collections
   * are here.** "202 coins" is a fact; "2 of 5 skins" is a fact *and* a shape — it is the only place
   * in this game that says how much of it is still ahead.
   */
  private refresh(): void {
    const state = getState()
    const skins = snailSkinIds()
    const themes = themeIds()
    const board = resolveQuestBoard(state.quests, 1)
    const lines: [string, string][] = [
      ['Furthest run', `${formatCount(Math.floor(state.bestScore / 100))} m`],
      ['Coins', `🪙 ${formatCount(state.coins)}`],
      ['Skins', `${skins.filter((id) => ownsSnailSkin(state.purchases, id)).length} / ${skins.length}`],
      ['Themes', `${themes.filter((id) => ownsTheme(state.purchases, id)).length} / ${themes.length}`],
      // Not a record but the one thing on this screen that is *live*: what the session is currently
      // being asked for. It is here because a player checking their progress is the player deciding
      // what to do next, and the answer is on the front screen they just left.
      ['Quests ready', `${board.active.filter((quest) => quest.progress >= quest.target).length} / ${board.active.length}`],
    ]

    for (let i = 0; i < this.rows.length; i++) {
      this.rows[i].label.setText(lines[i]?.[0] ?? '')
      this.rows[i].value.setText(lines[i]?.[1] ?? '')
    }
  }

  /**
   * Closes, and hands the resume back to whoever opened it.
   *
   * The `isPlatformPaused` check is `Settings`' own, for its own reason: resuming the opener now
   * would unpause a scene the platform still considers suspended, and skipping it without a
   * deferred handoff would leave it paused forever.
   */
  private close(): void {
    this.scene.stop()

    if (isPlatformPaused()) {
      this.game.events.once(YTEvents.RESUME, () => this.scene.resume(this.openerKey))

      return
    }
    this.scene.resume(this.openerKey)
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)

    this.backdrop.setSize(width, height)
    if (!this.backdrop.input) this.backdrop.setInteractive()
    else this.backdrop.input.hitArea.setTo(0, 0, width, height)

    const panelW = Math.min(width - 40 * scale, PANEL.width * scale)
    // Measured from its own contents rather than a fixed height — the fit pass every stacked panel
    // in this project has needed, and for the same reason: `uiScale` scales on *width*, so a
    // landscape phone keeps full-size type in a frame with no room for it.
    const panelH = Math.min(height - 40 * scale, (PANEL.top + ROW_COUNT * PANEL.row + PANEL.bottom) * scale)
    const x = (width - panelW) / 2
    const y = (height - panelH) / 2

    this.plate.clear()
    kitPlateDraw(this.plate, x, y, panelW, panelH, scale)

    this.title.setFontSize(30 * scale)
    this.title.setPosition(width / 2, y + PANEL.top * 0.55 * scale)

    this.divider.clear()
    this.divider.lineStyle(Math.max(1.5, 2 * scale), KIT.muted, 0.45)
    this.divider.lineBetween(x + 26 * scale, y + PANEL.top * scale, x + panelW - 26 * scale, y + PANEL.top * scale)

    for (let i = 0; i < this.rows.length; i++) {
      const rowY = y + (PANEL.top + PANEL.row * (i + 0.5)) * scale

      this.rows[i].label.setFontSize(18 * scale)
      this.rows[i].value.setFontSize(18 * scale)
      this.rows[i].label.setPosition(x + 26 * scale, rowY)
      this.rows[i].value.setPosition(x + panelW - 26 * scale, rowY)
    }

    this.closeButton.setFontSize(20 * scale)
    this.closeButton.container.setPosition(width / 2, y + panelH - PANEL.bottom * 0.5 * scale)
    // **⚠ Never `ensureMinHitArea` on a `KitButton`'s label.** The button's *container* is what
    // `bindAction` binds and what `kitButton` already gives a hit area of at least the label plus its
    // padding; calling this on the label makes a **second interactive object inside the first**, and
    // which of the two a press reaches is decided by hit-test ordering that nothing here controls.
    // When the Text wins, the press lands on an object with no handler and is swallowed — the button
    // simply does not respond, which is how it was reported. Every older panel (`Settings`, `Shop`)
    // binds the container and leaves the label alone; these two were the only ones that did not.
  }
}

/** How the panel is laid out, in unscaled pixels. */
const PANEL = { width: 380, top: 62, row: 38, bottom: 62 } as const
const ROW_COUNT = 5
/** Below the plate, which is itself below the content — see `Settings`' own note. */
const BACKDROP_DEPTH = -2

function kitPlateDraw(
  plate: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): void {
  const radius = 18 * scale

  plate.fillStyle(KIT.plate, 0.96)
  plate.fillRoundedRect(x, y, w, h, radius)
  plate.lineStyle(Math.max(2, 3 * scale), KIT.coin, 0.9)
  plate.strokeRoundedRect(x, y, w, h, radius)
}
