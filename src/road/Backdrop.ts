import * as Phaser from 'phaser'
import { createRng } from '../race/rng'
import { HORIZON_Y, ROAD_MESH_DEPTH, SKYLINE_LAYER } from './constants'
import { getRoadTheme, getRoadThemeId } from './themes'

/** Depths: sky behind the ground, glow and vignette in front of it but behind everything else. */
const SKY_DEPTH = ROAD_MESH_DEPTH - 10
const GLOW_DEPTH = ROAD_MESH_DEPTH + 1

/** How much of the camera's lateral drift and height each sky layer answers to. */
const LAYER_PARALLAX = [0.04, 0.12, 0.26] as const

/**
 * The sun: where it sits, how big it is, and how it is drawn.
 *
 * **⚠ It does not move, and that is a property of the projection rather than a simplification.**
 * `projectInto` puts a point at `screenWidth / 2 + scale * (x - cameraX) * screenWidth / 2`, and
 * `scale` goes to zero with distance — so **every** infinitely distant point projects to the exact
 * centre of the frame, at every camera position. This projection has no way to represent a
 * *direction* at all, only a position, which has two consequences: an object at infinity cannot
 * drift when the road bends (there is nothing for it to drift with), and its place in the frame
 * cannot be derived from an azimuth. `x`/`y` below are therefore a composition decision and are
 * openly written as one.
 *
 * Off-centre and high, for what is around it rather than for realism: the distance readout is
 * centred at the top, the shield pips sit top-left, and the range tops out around 0.32 of the
 * frame. `size` is a share of the **height**, because the sky is a share of the height — measured
 * off the width the sun would be a pinhead on an ultrawide frame and half the sky on a portrait
 * phone.
 *
 * Drawn between sky layer 0 and layer 1, so the haze bands pass in *front* of it. A sun with the
 * haze behind it is a lamp stuck on the glass.
 */
const SUN = { x: 0.76, y: 0.19, size: 0.2 } as const

/** Texture key for the built mountain strip, loaded by `Preloader` from `assets/sky/skyline.png`. */
export const SKYLINE_TEXTURE = 'skyline'

/**
 * The mountain range, as a fourth parallax layer rather than as scenery.
 *
 * **⚠ THIS WAS TWICE BUILT OUT OF BILLBOARDS AND TWICE REPORTED, IN OPPOSITE DIRECTIONS.** The
 * ranges first stood on segments in the decor pool's far tier — and everything standing on the
 * ground in this projection eventually arrives at the camera, so a mountain grew until it filled
 * half the frame and then slid off the edge, which reads as a whole texture vanishing. Pushing it
 * further out made it exit *sooner*, because a lateral offset is exactly what decides the nearest
 * distance at which something is still inside the frame. Fading it out before it could grow fixed
 * that and broke the mirror case: a range dead ahead dissolved while the player was looking at it.
 *
 * The property a horizon needs is that it does not approach, and no arrangement of an object that
 * stands on the ground has it. A `TileSprite` does, for free, and the sky beside it has been doing
 * exactly this since the plates landed: the parallax is a texture offset, so a strip that has
 * scrolled a thousand pixels costs what one that has not costs. It never approaches, never grows,
 * never has to be culled and never has to be faded.
 *
 * What it gives up is real parallax against the verge — the range answers to the track's curvature
 * and to nothing else, so cresting a hill does not move it. The sky has always had that limitation
 * and nobody has ever reported it.
 *
 * The tuning lives in `SKYLINE_LAYER`, in the phaser-free module, because one of its numbers needs
 * a check that runs under plain Node.
 */

/**
 * How far the range's tint is pulled back towards the haze, as `0..1`.
 *
 * **The biome's own colour is the wrong colour for a horizon, and the first strip proved it**: at
 * full tint the forest's green turned the range into a hedgerow. Aerial perspective is the reason
 * — a ridge kilometres out is mostly the air in front of it, which is why distant hills read
 * blue-grey whatever they are made of. So the biome still steers the hue, and the haze wins.
 */
const SKYLINE_TINT_MIX = 0.62

// The horizon fraction is imported, never redeclared. This file used to carry its own `0.5`
// beside the projection's implicit one — two constants describing one line, which stay right
// only for as long as nobody moves either.

/** Seed for the star field. Fixed, like every other generated thing here. */
const SKY_SEED = 111_213

/** Sky texture size. Width tiles horizontally for the parallax; height is scaled to fit once. */
const SKY_TEXTURE_WIDTH = 512

/**
 * Height of the generated sky texture, in pixels.
 *
 * **1024, up from 256, and the old value was quietly magnifying every defect in this file.** The
 * layer is drawn at the full viewport height with `tileScaleY = height / SKY_TEXTURE_HEIGHT`, so at
 * 256 against a 945px frame every feature in the texture was **stretched 3.7x vertically**: a haze
 * band authored 1-4px tall drew as a hard bar 4-15px tall, and a 1px star drew as a 4px vertical
 * streak — which is exactly what a screenshot of the `night` sky looked like, a set of ruled lines
 * over the horizon with rain falling through them.
 *
 * Softening the bands and thinning the stars would have treated the symptom; the texture simply has
 * to be authored at roughly the size it is drawn. At 1024 the scale is 0.92 at 945px and 1.4 at
 * 1440p, i.e. near enough to 1 that nothing is magnified into a defect. The cost is one 512x1024
 * canvas per layer.
 */
const SKY_TEXTURE_HEIGHT = 1024

/**
 * Everything behind and over the road that is not the road: sky parallax, glow, vignette.
 *
 * **All three are drawn layers, never filters.** A filter is a shader pass and `Phaser.AUTO`
 * decides per device whether there is a pipeline at all; a layer costs and looks the same under
 * the Canvas fallback. The glow in particular is an *additive-blended layer* over the ground
 * rather than a bloom postFX, which is what makes it survive that fallback.
 *
 * The sky is three `TileSprite`s so a layer can scroll without moving or reallocating anything:
 * the parallax is a texture offset, not a transform, so a layer that has drifted a thousand
 * pixels is exactly as cheap as one that has not.
 */
export class Backdrop {
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]

  private readonly layers: Phaser.GameObjects.TileSprite[]
  private readonly sun: Phaser.GameObjects.Image
  private readonly skyline: Phaser.GameObjects.TileSprite | undefined
  private readonly glow: Phaser.GameObjects.Graphics
  private readonly vignette: Phaser.GameObjects.Image
  private width = 0
  private height = 0

  constructor(scene: Phaser.Scene) {
    ensureSkyTextures(scene)

    this.layers = LAYER_PARALLAX.map((_, index) =>
      scene.add
        .tileSprite(0, 0, 1, 1, this.layerTexture(scene, index))
        .setOrigin(0, 0)
        .setDepth(SKY_DEPTH + index),
    )
    // Created before the range so the display list already has it underneath, and given its
    // texture here for the same reason the vignette is: `getRoadTheme()` has to be answerable.
    ensureSunTexture(scene)
    this.sun = scene.add.image(0, 0, sunTextureKey()).setOrigin(0.5, 0.5).setDepth(SKY_DEPTH + 0.5)
    // Only if the strip actually loaded. A missing plate degrades the sky to its procedural
    // gradient; a missing range degrades the horizon to bare sky, which is what it was before.
    this.skyline = scene.textures.exists(SKYLINE_TEXTURE)
      ? scene.add
          .tileSprite(0, 0, 1, 1, SKYLINE_TEXTURE)
          .setOrigin(0, 0)
          .setDepth(SKY_DEPTH + LAYER_PARALLAX.length)
      : undefined
    this.glow = scene.add.graphics().setDepth(GLOW_DEPTH).setBlendMode(Phaser.BlendModes.ADD)
    // Created with a placeholder key; `drawVignette` swaps in the theme's own texture, which
    // cannot be generated before `getRoadTheme()` is answerable.
    ensureVignetteTexture(scene)
    this.vignette = scene.add.image(0, 0, vignetteTextureKey()).setOrigin(0.5, 0.5).setDepth(GLOW_DEPTH + 1)
    this.gameObjects = [
      ...this.layers,
      this.sun,
      ...(this.skyline ? [this.skyline] : []),
      this.glow,
      this.vignette,
    ]
  }

  /**
   * Which texture layer `index` should be showing right now.
   *
   * Layer 0 prefers the theme's loaded plate and falls back to the procedural gradient — so a
   * missing or still-loading plate degrades to the previous look rather than to a blank sprite.
   */
  private layerTexture(scene: Phaser.Scene, index: number): string {
    const plate = skyPlateKey(getRoadThemeId())

    return index === 0 && scene.textures.exists(plate) ? plate : skyTextureKey(index)
  }

  /** Resizes every layer to the viewport and redraws the two static ones. */
  layout(width: number, height: number): void {
    this.width = width
    this.height = height

    // Re-pointed every layout, not just at construction: a theme switch removes and rebuilds
    // the procedural textures under the same keys, which leaves a TileSprite holding a
    // destroyed one. Re-reading the key here is what makes that self-heal.
    for (const [index, layer] of this.layers.entries()) {
      layer.setTexture(this.layerTexture(layer.scene, index))
    }

    for (const layer of this.layers) {
      // Full height, not just down to the horizon: a layer that stops there leaves a hard seam
      // across the middle of the screen wherever the ground does not cover it.
      layer.setSize(width, height)
      // ...and `tileScaleY` so the texture covers that height in exactly one repeat. A
      // `TileSprite` tiles in both axes, so a short sky on a tall sprite repeats and restarts its
      // gradient at every boundary — a hard horizontal line across the screen. Horizontal tiling
      // is left alone: that repeat is what the parallax scroll rides on.
      //
      // **⚠ Divided by the height of the texture actually on this layer, not by
      // `SKY_TEXTURE_HEIGHT`.** That constant is the *procedural* canvas height, and layer 0
      // usually is not the procedural canvas — it is the theme's generated plate, which
      // `build-sky-plates.py` delivers at **320px**. Dividing a 320px plate by 1024 gave it a
      // tile 295px tall on a 945px frame, i.e. **the plate repeated 3.2 times down the screen**:
      // exactly the defect this line exists to prevent, on six of the seven themes, for as long
      // as the plates have existed. It went unseen because the one theme without a plate is the
      // default, and because the constant's name reads like it means "the sky texture's height"
      // rather than "the height of one particular sky texture".
      layer.tileScaleY = height / (layer.frame.realHeight || SKY_TEXTURE_HEIGHT)
    }

    // Re-pointed every layout for the same reason the sky layers are: a theme switch removes and
    // rebuilds this texture under a new key, and an `Image` left holding the old one throws inside
    // the renderer a few frames later.
    this.sun.setTexture(sunTextureKey())
    this.sun.setDisplaySize(height * SUN.size, height * SUN.size)
    this.sun.setPosition(width * SUN.x, height * SUN.y)

    this.layoutSkyline()
    this.drawGlow()
    this.drawVignette()
  }

  /**
   * Sizes the range and glues its feet under the horizon.
   *
   * **`tileScaleX` and `tileScaleY` are the same number, and that is the whole difference between
   * this layer and a sky plate.** A plate is horizontal structure only — a gradient and haze bands
   * — so stretching it vertically to fill the frame costs nothing, which is what the sky layers do.
   * A mountain has shape in both axes: scale the two apart and the peaks come out as spires, which
   * is exactly the defect that got `day_v5`'s clouds re-picked. So the strip keeps its own aspect
   * and repeats horizontally as many times as the frame needs.
   *
   * The sprite is exactly one vertical repeat tall, because a `TileSprite` tiles in **both** axes
   * and a band taller than its own tile would stack a second range on top of the first.
   */
  private layoutSkyline(): void {
    if (!this.skyline) return

    const band = this.height * SKYLINE_LAYER.height
    const scale = band / (this.skyline.frame.realHeight || band)

    this.skyline.tileScaleX = scale
    this.skyline.tileScaleY = scale
    this.skyline.setSize(this.width, band)
    this.skyline.setPosition(0, this.height * HORIZON_Y + this.height * SKYLINE_LAYER.sink - band)
  }

  /**
   * The colour the range is seen in — the biome's own, under the theme's light.
   *
   * The same product every verge prop is drawn with, which is what keeps a desert's horizon sandy
   * and a forest's cool without nine strips of art. One tint for the whole strip rather than per
   * segment: a backdrop has no distance, so there is nothing to interpolate along, and the change
   * lands over the second or so a biome seam takes to pass.
   */
  setSkylineTint(tint: number): void {
    if (!this.skyline) return

    const haze = getRoadTheme().sky.band
    const mix = (shift: number): number => {
      const from = (tint >> shift) & 0xff
      const to = (haze >> shift) & 0xff

      return Math.round(from + (to - from) * SKYLINE_TINT_MIX) << shift
    }

    // Towards the theme's own horizon band rather than towards white: haze is the sky seen
    // through, so on a night or an ember theme it is that sky, not a grey one.
    this.skyline.setTint(mix(16) | mix(8) | mix(0))
  }

  /**
   * Scrolls the sky.
   *
   * `driftX` is the camera's accumulated lateral offset from the track's curvature and
   * `cameraY` its height above the ground — the two things that actually move the horizon. The
   * layers answer to them in different proportions, which is the entire parallax: a distant
   * band barely moves while a near one sweeps.
   */
  update(driftX: number, cameraY: number, baseCameraY: number): void {
    // Horizontal only. The sky's vertical term is a texture offset inside a full-height sprite, so
    // it can never expose an edge; the range is one tile tall with its feet buried under the
    // horizon, and sliding it by a hill's worth of camera height would lift those feet into view.
    //
    // **Divided by the tile scale, because `tilePositionX` is in TEXTURE pixels and the budget in
    // `SKYLINE_LAYER.driftPixels` is stated in screen ones.** The sky gets away with a bare factor
    // because it never scales its own tile; this layer does, and a factor that meant one thing at
    // one viewport height and another at the next is exactly how the first value went unnoticed.
    if (this.skyline) {
      this.skyline.tilePositionX = (driftX * SKYLINE_LAYER.driftPixels) / (this.skyline.tileScaleX || 1)
    }

    for (const [index, layer] of this.layers.entries()) {
      const factor = LAYER_PARALLAX[index]

      layer.tilePositionX = driftX * factor
      // Height moves the sky the *opposite* way: cresting a hill lifts the camera, which drops
      // the horizon down the screen.
      layer.tilePositionY = -(cameraY - baseCameraY) * factor * 0.02
    }
  }

  destroy(): void {
    for (const object of this.gameObjects) object.destroy()
  }

  /**
   * A soft bloom sitting on the horizon, drawn additively.
   *
   * Bands rather than a gradient fill: `Graphics` has no gradient, and a texture would be one
   * more thing to regenerate per theme for an effect that is eight rectangles.
   */
  private drawGlow(): void {
    const { color, alpha } = getRoadTheme().glow
    const horizon = this.height * HORIZON_Y
    const bands = 8

    this.glow.clear()

    for (let i = 0; i < bands; i++) {
      const spread = (this.height * 0.16 * (i + 1)) / bands
      // Falls off towards the outside, so the brightest part is the horizon line itself.
      const bandAlpha = alpha * (1 - i / bands) * 0.5

      this.glow.fillStyle(color, bandAlpha)
      this.glow.fillRect(0, horizon - spread, this.width, spread * 2)
    }
  }

  /**
   * A vignette, drawn as a **generated radial-gradient texture** rather than as nested strokes.
   *
   * **Both of its numbers were far too strong, and it took a bright theme to show it.** At six
   * bands over 28% of the frame at 0.34 alpha the corner measured `#9797aa` against the `#b7c0d4`
   * underneath it — a fifth of the brightness and most of the saturation removed from the entire
   * edge of the picture. On the near-black palettes it shipped with that was invisible, because it
   * was darkening something already almost black.
   *
   * **⚠ Then the band count went the wrong way, and that is the lesson worth keeping.** The stack
   * of rectangles was banding, so it went 6 -> 18 -> 48 to make each step smaller, and each step
   * did get smaller: a column scan down the frame went quiet. What the column scan could not see
   * is that **every rectangle in a nested stack puts a corner on the same diagonal**, so shrinking
   * the step did not remove the artefact, it concentrated it into a fan of steps radiating out of
   * each corner of the screen — which is where a player then saw it. Measured on the diagonal out
   * of the top-left corner: **152 luminance jumps with the vignette against 6 without it.**
   *
   * A `strokeRect` stack cannot be made smooth in both directions at once, because it has corners
   * and a vignette does not. One radial gradient has neither steps nor corners, and the "a texture
   * is one more thing to regenerate per theme" argument this used to carry no longer holds: the
   * theme's sky layers are already regenerated per theme by `ensureSkyTextures`, so this rides the
   * same lifecycle rather than adding one.
   *
   * The texture is square and stretched to the viewport, so the falloff is elliptical — which is
   * what a vignette on a wide frame should be, and what a circular one would not be.
   */
  private drawVignette(): void {
    ensureVignetteTexture(this.vignette.scene)
    this.vignette.setTexture(vignetteTextureKey())
    this.vignette.setPosition(this.width / 2, this.height / 2)
    // Sized past the frame so the very edge of the texture, where the gradient is at full
    // strength, sits just outside the picture: a vignette that reaches its darkest exactly on the
    // last row of pixels reads as a border rather than as a falloff.
    this.vignette.setDisplaySize(this.width * 1.04, this.height * 1.04)
  }
}

/**
 * Texture key for a theme's generated sky plate, loaded from `public/assets/sky/`.
 *
 * The far layer is the one place in the game where real art beat the procedural version: a
 * hand-tuned gradient with faint haze bands is exactly what a diffusion model is good at and
 * exactly what a `createLinearGradient` call is not. The two nearer layers stay procedural —
 * they need alpha, which the plates do not have.
 */
export function skyPlateKey(themeId: string): string {
  return `sky-plate-${themeId}`
}

/** Texture key for sky layer `index` of the active theme. */
function skyTextureKey(index: number): string {
  return `sky-${getRoadThemeId()}-${index}`
}

/**
 * Generates the active theme's sky layers, if they are not already there.
 *
 * **Only the active theme's textures ever exist** — see `applyTheme`. With generated art the
 * "load" is canvas work rather than a download, but the property the plan asks for is the same
 * one: nothing but the current theme occupies memory, and switching pays for the new set on
 * demand. When real art replaces this, the per-theme `load.image` goes exactly here.
 */
export function ensureSkyTextures(scene: Phaser.Scene): void {
  const theme = getRoadTheme()
  const rng = createRng(SKY_SEED)
  const width = SKY_TEXTURE_WIDTH
  const height = SKY_TEXTURE_HEIGHT

  for (let index = 0; index < LAYER_PARALLAX.length; index++) {
    const key = skyTextureKey(index)

    if (scene.textures.exists(key)) continue

    const canvasTexture = scene.textures.createCanvas(key, width, height)

    if (!canvasTexture) throw new Error(`ensureSkyTextures: could not create canvas texture "${key}"`)

    const context = canvasTexture.context

    context.clearRect(0, 0, width, height)

    if (index === 0) {
      // The furthest layer is the only opaque one — it is the sky itself. The rest are
      // transparent overlays, or each would hide the one behind it.
      const gradient = context.createLinearGradient(0, 0, 0, height)

      gradient.addColorStop(0, cssColor(theme.sky.top))
      gradient.addColorStop(1, cssColor(theme.sky.bottom))
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
    }

    // Haze bands near the horizon, denser on the nearer layers.
    //
    // **Scaled down hard on a bright sky, for the same reason as the stars below.** These are
    // full-width hard-edged rectangles standing in for soft haze, which works while the contrast
    // between the band and the sky is small — on the night palettes they shipped with, a band at
    // alpha 0.24 over a near-black gradient is a suggestion. On daylight the same band is a set
    // of crisp horizontal lines ruled across the sky, which is what a screenshot of the `coast`
    // stretch showed. The brightness gate keeps the effect where it works and removes it where it
    // reads as a defect, rather than tuning one number until both cases are equally wrong.
    const bright = luminance(theme.sky.top) >= STARFIELD_MAX_SKY_LUMINANCE
    const bands = 3 + index * 2

    for (let b = 0; b < bands; b++) {
      const y = height * (0.55 + 0.42 * rng())
      // Authored in the texture's own pixels, which are now roughly screen pixels — see
      // `SKY_TEXTURE_HEIGHT`. A band this tall was 4-15px on screen at the old texture size.
      const thickness = 8 + Math.floor(rng() * (10 + index * 10))

      // **A vertical gradient, not a flat fill.** These stand in for haze, and haze has no edges;
      // a `fillRect` gives it two, one at the top and one at the bottom, and a hard edge across
      // the sky reads as a ruled line however faint it is. The gradient is a canvas call, not a
      // shader, so it costs the same as the rectangle did and works identically under the Canvas
      // fallback — the same argument every other effect in this file is built on.
      const band = context.createLinearGradient(0, y, 0, y + thickness)
      const peak = (0.1 + 0.14 * rng() + index * 0.05) * (bright ? 0.22 : 1)

      band.addColorStop(0, `${cssColor(theme.sky.band)}00`)
      band.addColorStop(0.5, cssColor(theme.sky.band))
      band.addColorStop(1, `${cssColor(theme.sky.band)}00`)
      context.fillStyle = band
      context.globalAlpha = peak
      context.fillRect(0, y, width, thickness)
    }

    // A scatter of points, only on the far layers, so the near ones do not crawl with specks.
    //
    // **Gated on the sky actually being dark, and that is a real defect it fixes rather than a
    // nicety.** The texture is 512px wide and tiled horizontally, so every star is drawn again
    // every 512 screen pixels: on a 1920-wide frame the same dot appears four times at the same
    // height, which reads as a repeating pattern rather than as a sky. A horizontal luminance scan
    // found the jumps at exactly 497, 1009 and 1521 — one texture width apart, three times.
    //
    // It was invisible until daylight for the obvious reason: on a near-black sky a dim speck is
    // nothing, and there is nowhere for the eye to notice the rhythm. Rather than fight the tiling
    // — the horizontal repeat is what the parallax scroll rides on and must stay — stars are now
    // simply not drawn on a sky bright enough for them to show, which is also the only sky they
    // have no business being in.
    if (index < 2 && luminance(theme.sky.top) < STARFIELD_MAX_SKY_LUMINANCE) {
      const stars = 60 - index * 30

      context.fillStyle = cssColor(theme.sky.band)
      for (let s = 0; s < stars; s++) {
        context.globalAlpha = 0.25 + 0.5 * rng()
        context.fillRect(Math.floor(rng() * width), Math.floor(rng() * height * 0.7), 1, 1)
      }
    }

    context.globalAlpha = 1
    canvasTexture.refresh()
  }
}

/** Size of the generated vignette texture. Square; stretched to the viewport, so its falloff
 * becomes elliptical — which is what a vignette on a wide frame should be. */
const VIGNETTE_TEXTURE_SIZE = 512

/** Where the falloff starts, as a fraction of the radius, and how dark it gets at the very edge. */
const VIGNETTE_INNER_STOP = 0.55
const VIGNETTE_MAX_ALPHA = 0.34

/** Texture key for the active theme's vignette. Per theme, because its colour is per theme. */
function vignetteTextureKey(): string {
  return `vignette-${getRoadThemeId()}`
}

/**
 * Generates the active theme's vignette, if it is not already there.
 *
 * A real `createRadialGradient` rather than a stack of rectangles: a gradient has no steps and no
 * corners, and the stack had both — see `drawVignette` for the measurement that settled it.
 *
 * **Three colour stops, not two.** A single ramp from the centre to the edge darkens the middle of
 * the picture, which is where the game is; holding full transparency out to `VIGNETTE_INNER_STOP`
 * keeps the falloff in the outer half where a vignette belongs.
 */
export function ensureVignetteTexture(scene: Phaser.Scene): void {
  const key = vignetteTextureKey()

  if (scene.textures.exists(key)) return

  const size = VIGNETTE_TEXTURE_SIZE
  const canvasTexture = scene.textures.createCanvas(key, size, size)

  if (!canvasTexture) throw new Error(`ensureVignetteTexture: could not create canvas texture "${key}"`)

  const context = canvasTexture.context
  const half = size / 2
  const colour = getRoadTheme().vignette
  const rgb = `${(colour >> 16) & 0xff}, ${(colour >> 8) & 0xff}, ${colour & 0xff}`
  const gradient = context.createRadialGradient(half, half, 0, half, half, half)

  gradient.addColorStop(0, `rgba(${rgb}, 0)`)
  gradient.addColorStop(VIGNETTE_INNER_STOP, `rgba(${rgb}, 0)`)
  gradient.addColorStop(1, `rgba(${rgb}, ${VIGNETTE_MAX_ALPHA})`)

  context.clearRect(0, 0, size, size)
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  canvasTexture.refresh()
}

/** Diameter of the generated sun texture, in pixels. */
const SUN_TEXTURE_SIZE = 256

/**
 * Where the disc ends and the halo begins, as a fraction of the texture's radius.
 *
 * **Two stops close together rather than one long ramp**, because a sun is an object with an edge
 * and a single falloff draws a fuzzy ball with none. The halo that follows is the long tail, and it
 * is what stops the edge reading as a sticker cut out of the sky.
 */
const SUN_DISC_STOP = 0.3
const SUN_EDGE_STOP = 0.37

/**
 * How far the core is pushed towards white, as `0..1`.
 *
 * A sun's disc is white-hot and its *halo* carries the colour — drawn in one flat tint the whole
 * thing reads as a pale sticker, which is what the first version was. The core is still derived
 * from the theme rather than hardcoded, so a cool night glow still gives a cool moon.
 */
const SUN_CORE_WHITEN = 0.55

function sunTextureKey(): string {
  return `sun-${getRoadThemeId()}`
}

/**
 * Generates the sun for the active theme, if it does not exist yet.
 *
 * **Drawn in the theme's own `glow.color`, not in a colour of its own**, and that is the whole
 * reason it needs no new palette entry: the glow is already the horizon bloom — the light this
 * sun is the source of — so the two cannot disagree, and every theme already answers the question.
 * A night theme's cool glow makes this a moon without anything having to branch on it.
 */
export function ensureSunTexture(scene: Phaser.Scene): void {
  const key = sunTextureKey()

  if (scene.textures.exists(key)) return

  const size = SUN_TEXTURE_SIZE
  const canvasTexture = scene.textures.createCanvas(key, size, size)

  if (!canvasTexture) throw new Error(`ensureSunTexture: could not create canvas texture "${key}"`)

  const context = canvasTexture.context
  const half = size / 2
  const colour = getRoadTheme().glow.color
  const rgb = `${(colour >> 16) & 0xff}, ${(colour >> 8) & 0xff}, ${colour & 0xff}`
  const gradient = context.createRadialGradient(half, half, 0, half, half, half)

  const whiten = (channel: number) => Math.round(channel + (255 - channel) * SUN_CORE_WHITEN)
  const core =
    `${whiten((colour >> 16) & 0xff)}, ${whiten((colour >> 8) & 0xff)}, ${whiten(colour & 0xff)}`

  gradient.addColorStop(0, `rgba(${core}, 1)`)
  gradient.addColorStop(SUN_DISC_STOP, `rgba(${core}, 1)`)
  gradient.addColorStop(SUN_EDGE_STOP, `rgba(${rgb}, 0.34)`)
  gradient.addColorStop(0.5, `rgba(${rgb}, 0.1)`)
  gradient.addColorStop(1, `rgba(${rgb}, 0)`)

  context.clearRect(0, 0, size, size)
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  canvasTexture.refresh()
}

/** Removes the sun texture of `themeId`, alongside its sky set. */
export function removeSunTexture(scene: Phaser.Scene, themeId: string): void {
  const key = `sun-${themeId}`

  if (scene.textures.exists(key)) scene.textures.remove(key)
}

/** Removes the vignette texture of `themeId`, alongside its sky set. */
export function removeVignetteTexture(scene: Phaser.Scene, themeId: string): void {
  const key = `vignette-${themeId}`

  if (scene.textures.exists(key)) scene.textures.remove(key)
}

/** Removes the sky textures of `themeId`, so a theme switch does not keep both sets alive. */
export function removeSkyTextures(scene: Phaser.Scene, themeId: string): void {
  for (let index = 0; index < LAYER_PARALLAX.length; index++) {
    const key = `sky-${themeId}-${index}`

    if (scene.textures.exists(key)) scene.textures.remove(key)
  }
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/**
 * Brightest sky that still gets stars. Above it a night affordance is only a tiling artefact.
 *
 * Measured rather than picked: `night`'s repainted sky top sits at 0.011 and `dusk`'s at 0.041,
 * while `day` is 0.316 and the repainted `ice` 0.316 — so any threshold in the wide gap between
 * them separates the skies that want stars from the ones that do not, and 0.12 sits in the middle
 * of it.
 */
const STARFIELD_MAX_SKY_LUMINANCE = 0.12

/** sRGB relative luminance. Local rather than imported so this file stays free of a cycle. */
function luminance(color: number): number {
  const channel = (value: number) => {
    const c = value / 255

    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }

  return (
    0.2126 * channel((color >> 16) & 0xff) +
    0.7152 * channel((color >> 8) & 0xff) +
    0.0722 * channel(color & 0xff)
  )
}
