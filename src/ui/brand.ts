import * as Phaser from 'phaser'
import { t } from '../i18n/strings'
import { getTheme, neonText, toCssColor } from './theme'

/**
 * The game's front of house: the backdrop, the emblem and the wordmark, shared by the loading
 * screen and the main menu so the two read as one product rather than two.
 *
 * **The wordmark is typography, not art, and that is a decision rather than a shortcut.** Every
 * other visible thing in this game is a generated PNG, and the obvious next step would have been
 * to generate the logo too. Diffusion models cannot spell — the generation pipeline this project
 * uses carries `text, letters, words, logo` in its own standing negative prompt, precisely because
 * asking for lettering produces glyph-shaped noise. Drawn as text instead it costs zero bytes,
 * stays sharp at any viewport, re-flows for a narrow screen, and could be localised; what is
 * generated is the *plate behind it*, which is a shape, and shapes are what the model is good at.
 *
 * Every asset here is optional. A missing texture degrades to the theme's own colours rather than
 * to a blank screen — the same rule the ship's art follows, and for the same reason: generated art
 * can fail to come out, and the honest outcome of that is a game that still runs.
 */

/** Texture keys for the generated front-of-house art. Absent until the art lands. */
export const BRAND_TEXTURES = {
  background: 'brand-menu-bg',
  emblem: 'brand-emblem',
  mascot: 'brand-mascot',
  rival: 'brand-rival',
} as const

/**
 * The game's name, read from the dictionary rather than held here.
 *
 * It used to be two constants in this file — the loading screen's only copy of it — which made
 * renaming the game a code change in a UI module. It is now `t('gameTitle')`, one key, and the
 * loading screen and the menu read the same one, so they cannot disagree about what the game is
 * called. (Set in both dictionaries to the same word: a brand is not translated.)
 */
export function gameTitle(): string {
  return t('gameTitle')
}

/** Base font size, scaled by `uiScale` at layout time. */
const TITLE_FONT_SIZE = 58

/**
 * The wordmark's own colours, **fixed rather than taken from `getTheme()`**.
 *
 * Every other widget in this game reads its colour from the UI theme, and the first version of
 * this one did too — which put a neon pink title over a pale daylight sky, where it measured as
 * unreadable and looked it. A brand does not change colour with the furniture; more practically,
 * the UI palette is still the template's neon-on-dark and the menu is now a bright outdoor scene,
 * so the two are answering different questions.
 *
 * Deep navy over a pale sky, with `neonText`'s glow doing the work of a drop shadow rather than a
 * halo — the glow is the same colour as the text, so on a light background it reads as the mark
 * being lifted off the plate instead of as neon.
 */
const TITLE_COLOR = 0x10283f

/**
 * How much of the frame's width the emblem spans, and how tall the wordmark block sits.
 *
 * Fractions rather than pixels because this is the one screen guaranteed to be seen on every
 * device a certification reviewer owns — see the `Preloader` note in CLAUDE.md about a fixed
 * 468px bar overflowing a 390px phone.
 */
const EMBLEM_WIDTH_FRACTION = 0.62
const EMBLEM_MAX_WIDTH = 520

export interface Brand {
  /** Every object, for the camera `ignore()` lists and for teardown. */
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]
  /** Positions everything. Call from the scene's own `layout()`. `centerY` is the wordmark's. */
  layout(width: number, height: number, centerY: number, scale: number): void
  /** The bottom edge of the wordmark block in screen pixels, so a caller can stack under it. */
  readonly bottom: number
  /** How tall the whole lockup is, so a caller can work out where its centre may sit. */
  readonly blockHeight: number
  destroy(): void
}

/**
 * Builds the backdrop, the emblem and the two-line wordmark.
 *
 * The backdrop is a `cover` fit rather than a stretch: the plate is generated at one aspect and
 * shown on everything from 9:16 to 21:9, and stretching a horizon is the one distortion the eye
 * reads instantly.
 */
export function createBrand(scene: Phaser.Scene): Brand {
  const colors = getTheme().colors
  const objects: Phaser.GameObjects.GameObject[] = []

  // **The wash is created first and the plate second, because the display list is the draw order
  // here and creation order is the display list.** Pushing them into the returned array in the
  // right order is not the same thing and does not help — the first version did exactly that and
  // the plate was drawn and then painted over by the wash, which reads as the background simply
  // not having loaded.
  const wash = scene.add.rectangle(0, 0, 1, 1, colors.backgroundTop).setOrigin(0.5, 0.5)
  const backdrop = scene.textures.exists(BRAND_TEXTURES.background)
    ? scene.add.image(0, 0, BRAND_TEXTURES.background).setOrigin(0.5, 0.5)
    : null

  objects.push(wash)
  if (backdrop) objects.push(backdrop)

  const emblem = scene.textures.exists(BRAND_TEXTURES.emblem)
    ? scene.add.image(0, 0, BRAND_TEXTURES.emblem).setOrigin(0.5, 0.5)
    : null

  if (emblem) objects.push(emblem)

  // One line. The two-line stack existed because "SHOOTING RACER" is 13 glyphs and does not fit a
  // 390px phone at a size that reads as a logo; the name it was set for is gone, and a single
  // seven-letter word does fit. Nothing here re-flows a name that has to be wrapped — if one ever
  // does, that is a `Text` word-wrap width, not a second neonText.
  const title = neonText(scene, gameTitle(), TITLE_COLOR, TITLE_FONT_SIZE, 0.5, 0.5)

  objects.push(title.container)

  const brand: Brand = {
    gameObjects: objects,
    bottom: 0,
    blockHeight: 0,
    layout(width: number, height: number, centerY: number, scale: number) {
      wash.setPosition(width / 2, height / 2).setSize(width, height)

      if (backdrop) {
        backdrop.setPosition(width / 2, height / 2)
        // Cover fit: fill the frame on both axes and let the overflow crop, rather than
        // distorting the horizon the plate was drawn with.
        const cover = Math.max(width / backdrop.width, height / backdrop.height)

        backdrop.setScale(cover)
      }

      // **A crest above the wordmark, not behind it.** Setting the name across the shield is the
      // obvious lockup and it fails twice: the long word is wider than the shield's flat centre at
      // every size that keeps the shield a crest, and light text on brushed silver has no contrast
      // to sit on. Stacked, each half gets the whole width and neither has to fight the other.
      const emblemWidth = Math.min(EMBLEM_MAX_WIDTH * scale, width * EMBLEM_WIDTH_FRACTION, height * 0.30)
      const emblemHeight = emblem ? emblemWidth * (emblem.frame.realHeight / emblem.frame.realWidth) : 0

      title.setFontSize(TITLE_FONT_SIZE * scale)

      // Measured off the drawn text rather than from the font size: a glyph's box is taller than
      // its ink, and stacking on the nominal size leaves a gap that grows with the scale.
      const titleHeight = title.height
      const blockHeight = emblemHeight + titleHeight
      const top = centerY - blockHeight / 2

      if (emblem) {
        emblem.setPosition(width / 2, top + emblemHeight / 2)
        emblem.setDisplaySize(emblemWidth, emblemHeight)
      }

      title.container.setPosition(width / 2, top + emblemHeight + titleHeight * 0.5)

      ;(brand as { bottom: number; blockHeight: number }).bottom = top + blockHeight
      ;(brand as { bottom: number; blockHeight: number }).blockHeight = blockHeight
    },
    destroy() {
      for (const object of objects) object.destroy()
    },
  }

  return brand
}

/**
 * The two flanking robots are gone, and this note is what is left of them.
 *
 * They were drawn in two different techniques (cel shading against line art), neither of which
 * appears anywhere in the game, and they stood beside a logo on a screen that now shows the game
 * itself. `createFlankers` and its `FLANKER_*` constants were deleted with the menu that used
 * them; `public/assets/brand/{mascot,rival}.png` are still on disk and no longer loaded.
 */

/** A theme-coloured CSS string, re-exported so scenes need not reach into `theme.ts` for it. */
export function brandTextColor(): string {
  return toCssColor(getTheme().colors.primary)
}
