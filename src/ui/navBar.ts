import * as Phaser from 'phaser'
import { KIT } from './kitPalette'
import { toCssColor } from './theme'
import { uiScale, ensureMinHitArea } from './uiScale'
import { NAV_BAR, NAV_SURFACE, navBarBoxes, navBarHeight, NAV_MIN_TOUCH } from './navLayout'
import { INK } from '../run/artPalette'

/**
 * The bar along the bottom of the front screens: where the player goes when they are not playing.
 *
 * ## ⚠ The destinations were two glyphs in a corner, and a corner is where things go to be missed
 *
 * The shop and the settings were 🛒 and ⚙ at the top right, at `CORNER_ALPHA` — deliberately faint,
 * on the argument that a secondary control sharing a zone with the primary one competes with it.
 * That argument is right about *weight* and wrong about *placement*: made faint **and** put in the
 * far corner, they were not competing with Play, they were invisible next to it. The garage made
 * that worse by needing a third one.
 *
 * A bar is the opposite trade. It is the one piece of interface a player of this kind of game looks
 * for without being told, it holds a name beside each icon so nothing has to be guessed from a
 * glyph, and it says *which one you are on*, which three corner icons never could.
 *
 * ## What is a tab and what is not
 *
 * Three tabs, as asked: **shop, garage, records**. The gear is on the same bar but set apart, and
 * that is a distinction rather than a compromise — a tab is a *place in the game* the player moves
 * between, and settings is a drawer you open and shut. Giving it a fourth tab would say the game
 * has four places, and it has three.
 */

/**
 * Draws the bar's own surface — a rounded plate and its rim — into any `Graphics`.
 *
 * **⚠ The bar is not the only thing that wants it.** The garage's way out was a bare ✕ at
 * `EXIT_ALPHA` over open sky and was reported as unnoticeable, which is the same finding this bar
 * was built on read one control smaller: *a corner is where things go to be missed*, and what
 * rescues one is a surface under it rather than louder ink. So the surface is a function both call
 * rather than a set of numbers copied into the second screen — the bar's own plate is drawn with
 * this too, so the two cannot say different things about what the game's chrome looks like.
 */
export function drawNavSurface(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  radiusPx: number = NAV_BAR.radius,
): void {
  const radius = radiusPx * scale

  g.fillStyle(KIT.plate, NAV_SURFACE.fillAlpha)
  g.fillRoundedRect(x, y, w, h, radius)
  g.lineStyle(Math.max(NAV_SURFACE.minStrokePx, NAV_SURFACE.strokePx * scale), KIT.muted, NAV_SURFACE.strokeAlpha)
  g.strokeRoundedRect(x, y, w, h, radius)
}

export type NavTab = 'shop' | 'garage' | 'records'

export const NAV_TABS: readonly { id: NavTab; icon: string; label: string }[] = [
  { id: 'shop', icon: '🛒', label: 'Shop' },
  // The middle one, because it is the one a player opens most and the middle of a bar is where a
  // thumb rests. The reference does the same with its own garage.
  // **Named for what is in it rather than for the room it is.** "Garage" is a word this genre took
  // from racing games, where the thing being kept is a vehicle; here it is the mascot, and the tab
  // is the only place the player is told what the game is about before pressing Play.
  { id: 'garage', icon: '🐌', label: 'Snail' },
  { id: 'records', icon: '🏆', label: 'Records' },
]

export { NAV_BAR } from './navLayout'

export interface NavBar {
  /** Every object the bar draws with, for the camera split and the entry fade. */
  objects: (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[]
  /** The tappable target for each tab, and for the gear. */
  targets: Record<NavTab | 'settings', Phaser.GameObjects.Text>
  layout(width: number, height: number, active: NavTab | null): void
  /** How tall the bar is at this width — what a screen above it has to keep clear of. */
  heightAt(width: number): number
}

/**
 * Builds the bar. Positioned entirely in `layout`, per the project's layout contract.
 *
 * **This one keeps its plate**, unlike every other panel on the front screen. The three removals
 * this project has made were all of plates sitting *over the picture* — a scrim under the title, a
 * strip under the buttons, a rim round the pickups — and each was reported because it covered the
 * thing it was decorating. A bar along the very bottom edge covers the near ground, which is the
 * one band a menu leaves empty; and it is chrome rather than an annotation, so it is supposed to
 * read as a surface.
 */
export function createNavBar(scene: Phaser.Scene, depth: number): NavBar {
  const plate = scene.add.graphics().setDepth(depth)
  const targets = {} as Record<NavTab | 'settings', Phaser.GameObjects.Text>
  const labels: Phaser.GameObjects.Text[] = []
  const objects: (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] = [plate]

  const make = (glyph: string, name: string, key: NavTab | 'settings') => {
    const icon = scene.add
      .text(0, 0, glyph, { fontFamily: 'Arial', fontSize: 22, color: toCssColor(KIT.rim) })
      .setOrigin(0.5, 1)
      .setDepth(depth + 1)
      .setInteractive({ useHandCursor: true })
    const label = scene.add
      .text(0, 0, name, { fontFamily: 'Arial', fontSize: 12, color: toCssColor(KIT.muted) })
      .setOrigin(0.5, 0)
      .setDepth(depth + 1)

    for (const text of [icon, label]) text.setStroke(toCssColor(INK), 3)
    targets[key] = icon
    labels.push(label)
    objects.push(icon, label)

    return { icon, label }
  }

  const tabs = NAV_TABS.map((tab) => ({ ...tab, ...make(tab.icon, tab.label, tab.id) }))
  const gear = make('⚙', '', 'settings')

  // **The one glyph on this bar that is centred on its own cell rather than hung from the icon
  // row.** Every tab is an icon above a label, so the pair fills the bar between them; the gear has
  // no label, and sharing the tabs' baseline put it a fifth of the bar's height above centre —
  // which is how it was reported. Origin, not a second Y offset, so the cell's own centre is what
  // it is placed by and there is nothing to keep in step.
  gear.icon.setOrigin(0.5, 0.5)

  return {
    objects,
    targets,
    heightAt: (width: number) => navBarHeight(uiScale(width)),
    layout(width: number, height: number, active: NavTab | null): void {
      const scale = uiScale(width)
      const boxes = navBarBoxes(width, height, scale, tabs.length)
      const { bar } = boxes

      plate.clear()
      drawNavSurface(plate, bar.x, bar.y, bar.w, bar.h, scale)

      // The icon sits above this line and its label below it, so the pair straddles the cell's
      // centre rather than starting at it.
      const iconY = bar.y + bar.h * 0.56
      const labelY = iconY + 2 * scale

      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i]
        const cell = boxes.tabs[i]
        const on = tab.id === active

        tab.icon.setFontSize(22 * scale)
        tab.label.setFontSize(12 * scale)
        tab.icon.setPosition(cell.cx, iconY)
        tab.label.setPosition(cell.cx, labelY)
        // **The active tab is said with a colour and a lozenge, never with a size.** A tab that grew
        // would move its neighbours, and a bar whose contents shift as you move through it is a bar
        // that is hard to hit twice in the same place.
        tab.label.setColor(toCssColor(on ? KIT.active : KIT.muted))
        tab.icon.setAlpha(on ? 1 : 0.72)

        if (on) {
          plate.fillStyle(KIT.active, 0.16)
          plate.fillRoundedRect(cell.cx - cell.w * 0.42, bar.y + bar.h * 0.08, cell.w * 0.84, bar.h * 0.84, NAV_BAR.radius * 0.7 * scale)
        }
        ensureMinHitArea(tab.icon, NAV_MIN_TOUCH)
      }

      // Set apart from the tabs by a rule, because it is a drawer rather than a place: the bar has
      // three destinations and one control, and the line is what says which is which.
      gear.icon.setFontSize(20 * scale)
      gear.icon.setPosition(boxes.gear.cx, boxes.gear.cy)
      gear.icon.setAlpha(0.72)
      gear.label.setText('')
      plate.lineStyle(Math.max(1, 1.5 * scale), KIT.muted, 0.35)
      plate.lineBetween(boxes.divider.x, boxes.divider.top, boxes.divider.x, boxes.divider.bottom)
      ensureMinHitArea(gear.icon, NAV_MIN_TOUCH)

      void labels
    },
  }
}
