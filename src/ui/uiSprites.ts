/**
 * The button language, as textures.
 *
 * `scripts/normalize-ui.py` builds `public/assets/ui/*.png` as **greyscale value maps**: a pixel's
 * grey is its lightness ratio to the face, so one master serves every colour the interface uses.
 * This file is the other half — it turns a master and one colour into a texture, and hands back a
 * nine-slice drawn from it.
 *
 * **⚠ The numbers below are `scripts/ui_style.py`'s, spelled out.** A TypeScript module cannot
 * import a Python one, so the two copies are held together by `normalize-ui.py`, which greps this
 * file and fails the build if any of them disagree — the same arrangement, and the same reason, as
 * `UPGRADE_REFERENCE_MARKS` and `DEFAULT_WEAPON_ID`. Change one and the build tells you about the
 * other. Every value is argued for in `ART-STYLE.md`; do not tune one here.
 */

import { fromOklab, toOklab } from '../road/color'

/** Native height of a button — the unit every fraction in ART-STYLE.md is quoted in. */
export const UI_NATIVE_HEIGHT = 64
/** The dark contour, on all four sides and on the face/cheek seam. */
export const UI_INK = 2
/** The light strip along the top of the face. */
export const UI_BAND = 6
/** The deep lip along the bottom. This is the whole of the object's volume. */
export const UI_CHEEK = 13
/** Corner radius, one value on all four corners. */
export const UI_RADIUS = 19
/** How far a pressed button sinks: the difference between the two lip heights. */
export const UI_SINK = 10
/** The grey a master's face is drawn at; every other grey is a ratio to it. */
export const UI_FACE_GREY = 190

/**
 * Nine-slice inset, on every side that slices.
 *
 * **Computed, not chosen.** It has to contain the corner arc (`UI_RADIUS + UI_INK`), the top band
 * (`UI_INK + UI_BAND` = 8) and the cheek (`UI_CHEEK + UI_INK` = 15); the arc is the largest of the
 * three, so it sets the number. A smaller inset would let the band or the lip fall into the
 * stretching middle, and a stretched lip is a lip whose height depends on how tall the button is.
 */
export const UI_SLICE = UI_RADIUS + UI_INK

/** The shapes `normalize-ui.py` ships, and how each is drawn. */
export type UiShape = 'btn' | 'round' | 'panel' | 'bar-frame' | 'bar-fill'

interface ShapeSpec {
  /** Which axes stretch. A circle has no straight middle; a bar is fixed in height. */
  readonly slice: 'xy' | 'x' | 'none'
  readonly pressed: boolean
}

export const UI_SHAPES: Record<UiShape, ShapeSpec> = {
  btn: { slice: 'xy', pressed: true },
  round: { slice: 'none', pressed: true },
  panel: { slice: 'xy', pressed: false },
  'bar-frame': { slice: 'x', pressed: false },
  'bar-fill': { slice: 'x', pressed: false },
}

/** Where `Preloader` loads the masters from, and the key each lands under. */
export function uiMasterKey(shape: UiShape, pressed = false): string {
  return `ui-${shape}${pressed ? '-pressed' : ''}`
}

export const UI_MASTER_KEYS: readonly string[] = Object.entries(UI_SHAPES).flatMap(
  ([shape, spec]) =>
    spec.pressed
      ? [uiMasterKey(shape as UiShape), uiMasterKey(shape as UiShape, true)]
      : [uiMasterKey(shape as UiShape)],
)

// ── Tone ────────────────────────────────────────────────────────────────────
//
// ART-STYLE.md states the three tones as RATIOS OF LUMA to the face — 1.25 for the band, 0.60 for
// the cheek, 0.06 for the contour — because a ratio is the only form that can be applied to a
// colour nobody has seen yet, and the primary button's accent comes from the active theme.
//
// So rather than carrying three tuned constants per colour, `toneTo` SOLVES for the ratio: it
// bisects on an OKLab operation until the delivered Rec.601 luma lands on the asked-for ratio. The
// document's table is then literally the implementation, and a repaint of the theme table cannot
// put the set out of step with it.

const LUMA_R = 0.299
const LUMA_G = 0.587
const LUMA_B = 0.114

function luma(color: number): number {
  return (
    LUMA_R * ((color >> 16) & 0xff) + LUMA_G * ((color >> 8) & 0xff) + LUMA_B * (color & 0xff)
  )
}

/**
 * Deepen by scaling OKLab lightness, keeping most of the chroma.
 *
 * Chroma is kept rather than scaled with the lightness because **the contour carries the hue** —
 * measured on the references at `(20,7,0)` under orange and `(44,0,60)` under purple, i.e. a dark
 * version of the button rather than a neutral black. It is also this project's standing rule that
 * ink is never pure black: a hard black outline against the alpha boundary bleeds black into every
 * mipmap level, which is what `verify:mattes`'s flood exists to prevent.
 */
function deepen(color: number, lScale: number, chromaKept: number): number {
  const { L, a, b } = toOklab(color)
  return fromOklab({ L: L * lScale, a: a * chromaKept, b: b * chromaKept })
}

/** Lift toward white. Above the face there is nowhere else to go — chroma has to fall. */
function lift(color: number, amount: number): number {
  const { L, a, b } = toOklab(color)
  return fromOklab({ L: L + (1 - L) * amount, a: a * (1 - amount * 0.5), b: b * (1 - amount * 0.5) })
}

const CHROMA_KEPT = 0.78
const BISECT_STEPS = 18

/**
 * The colour whose luma is `ratio` times `base`'s.
 *
 * Bisected rather than solved in closed form because the operation is not linear in luma and the
 * two ends are different operations (deepening below the face, lifting toward white above it).
 * Eighteen steps land inside a quarter of a luma unit, and this runs 256 times per bake — once per
 * possible grey — not per pixel.
 *
 * **It clamps rather than failing when a ratio is unreachable**, which happens at both ends: a
 * near-white accent cannot be lifted 25% further, and a near-black one cannot be deepened. The
 * honest outcome there is that the band merges with the face, not a thrown error in a menu.
 */
export function toneTo(base: number, ratio: number): number {
  if (ratio === 1) return base
  const target = luma(base) * ratio
  let lo = 0
  let hi = 1
  let best = base
  for (let i = 0; i < BISECT_STEPS; i += 1) {
    const mid = (lo + hi) / 2
    const candidate = ratio < 1 ? deepen(base, mid, CHROMA_KEPT) : lift(base, mid)
    best = candidate
    const value = luma(candidate)
    // Deepening is monotone increasing in `mid`; lifting is too, so one comparison serves both.
    if (value < target) lo = mid
    else hi = mid
  }
  return best
}

/**
 * The 256-entry lookup a bake runs through.
 *
 * A master's grey is a ratio to `UI_FACE_GREY`, so the table is just `toneTo` over every byte. The
 * point of building it once per colour rather than per pixel is that a panel is 256x192 — 49k
 * pixels against 256 distinct answers.
 */
function toneTable(base: number): Uint32Array {
  const table = new Uint32Array(256)
  for (let g = 0; g < 256; g += 1) table[g] = toneTo(base, g / UI_FACE_GREY)
  return table
}

// ── Baking ──────────────────────────────────────────────────────────────────

function bakedKey(shape: UiShape, pressed: boolean, color: number): string {
  return `${uiMasterKey(shape, pressed)}-${color.toString(16).padStart(6, '0')}`
}

/**
 * A coloured copy of one master, cached under `(shape, state, colour)`.
 *
 * The same arrangement as the mascot's five skins, and cheap for the same reason: the work happens
 * once per colour per session, not per frame. A run that never opens the shop bakes the two or
 * three colours its own screens use and nothing else.
 *
 * Returns the master's own key unchanged when the texture manager has no master to work from —
 * a scene that draws before `Preloader` has finished must not throw, and the caller's fallback is
 * to draw the widget the old way.
 */
export function bakeUiSprite(
  scene: Phaser.Scene,
  shape: UiShape,
  pressed: boolean,
  color: number,
): string | null {
  const master = uiMasterKey(shape, pressed)
  if (!scene.textures.exists(master)) return null
  const key = bakedKey(shape, pressed, color)
  if (scene.textures.exists(key)) return key

  const source = scene.textures.get(master).getSourceImage() as HTMLImageElement
  const canvas = scene.textures.createCanvas(key, source.width, source.height)
  if (!canvas) return null

  canvas.draw(0, 0, source)
  const image = canvas.getData(0, 0, source.width, source.height)
  const data = image.data
  const table = toneTable(color)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const rgb = table[data[i]]
    data[i] = (rgb >> 16) & 0xff
    data[i + 1] = (rgb >> 8) & 0xff
    data[i + 2] = rgb & 0xff
  }
  canvas.putData(image, 0, 0)
  canvas.refresh()
  return key
}

/**
 * Every baked copy of every master, for a theme swap to tear down.
 *
 * **The primary button is coloured from the active theme**, so its baked textures are themed
 * textures and `applyTheme`'s precondition covers them: a sprite left holding a removed texture
 * throws inside the renderer a few frames later, with a stack that points nowhere near the cause.
 * Swept by prefix rather than enumerated, because which colours have been baked depends on which
 * screens the player has opened — the same reason `removeSnailSkinTextures` sweeps.
 */
export function removeBakedUiTextures(scene: Phaser.Scene): void {
  const masters = new Set(UI_MASTER_KEYS)
  for (const key of scene.textures.getTextureKeys()) {
    if (!key.startsWith('ui-') || masters.has(key)) continue
    scene.textures.remove(key)
  }
}

/**
 * A nine-slice of one shape at one colour, or `null` if the masters have not loaded.
 *
 * The insets come from `UI_SLICE` and the shape's own axis table, never from a literal at the call
 * site: a widget that passed its own inset would be a second opinion about where the corners end,
 * and the corners are the whole reason this is a nine-slice rather than a stretched image.
 */
export function uiNineSlice(
  scene: Phaser.Scene,
  shape: UiShape,
  pressed: boolean,
  color: number,
  width: number,
  height: number,
): Phaser.GameObjects.NineSlice | null {
  const key = bakeUiSprite(scene, shape, pressed, color)
  if (!key) return null
  const axis = UI_SHAPES[shape].slice
  const x = axis === 'none' ? 0 : UI_SLICE
  const y = axis === 'xy' ? UI_SLICE : 0
  return scene.add.nineslice(0, 0, key, undefined, width, height, x, x, y, y)
}
