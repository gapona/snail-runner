/**
 * Themes: every colour in the game, in one place, switchable at runtime.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:road`.
 *
 * A theme is *only* colour. Nothing here changes geometry, timing or behaviour, which is what
 * makes adding one cheap and makes a bad one impossible to ship by accident: there is no code
 * path a theme can take that another theme does not.
 */

/**
 * The one colour reserved for "this can kill you", identical in every theme.
 *
 * **It is a constant rather than a per-theme choice on purpose.** A warning the player has to
 * re-learn on each theme is not a warning; the whole value of a threat colour is that it needs
 * no reading. Every theme's `enemy.telegraph` is assigned this, and `verify:road` asserts both
 * that they all match and that no theme's scenery, road or sky colour comes near it — the
 * reservation is only worth anything if nothing else is allowed to use it.
 *
 * Warm red rather than the yellow this used to be: yellow is what vegetation and the ground glow
 * are already made of, so a yellow warning was competing with the scenery it had to be spotted
 * against.
 */
export const THREAT_COLOR = 0xff2f43

/**
 * When another colour counts as "too close to the warning" — a **perceptual** test, in three
 * parts, all of which must hold for a colour to be rejected.
 *
 * This replaced a channel-wise RGB distance, and the replacement was not cosmetic: under the old
 * metric `dusk.sky.band` (`0xa8447a`) scored 121 against a threshold of 120 and **passed by one
 * unit**, while sitting **one degree** from the threat hue. A metric that clears a colour which
 * is visibly the same colour is not measuring the thing the rule is about. See `road/color.ts`
 * for why RGB distance fails in both directions at once.
 *
 * The three parts, and why one number could not do the job:
 *
 * - **Hue** is what carries the identity. A warm red at a different lightness is still the
 *   warning; a blue at the same lightness is not.
 * - **Chroma** decides whether a hue is even legible. Below the floor a colour is effectively a
 *   grey, its hue angle is numerical noise, and it cannot be mistaken for a saturated signal —
 *   which is why `ember.decor.rim` (a dusty brown at chroma 0.05) is allowed to sit 24° away.
 * - **Lightness** is the escape hatch that keeps warm *themes* possible at all. `dusk` and
 *   `ember` are built out of sunset and fire; banning the whole red-orange range would delete
 *   them. A deep maroon or a pale peach at the threat's hue reads as scenery, not as a warning,
 *   so a colour far enough from the threat's own lightness is cleared regardless of hue.
 */
export const THREAT_MIN_HUE_DEGREES = 30
export const THREAT_MIN_CHROMA = 0.06
export const THREAT_LIGHTNESS_ESCAPE = 0.22

export interface RoadTheme {
  id: string
  /**
   * The road's five colours, in `PALETTE_INDEX` order.
   *
   * The fifth is the centre-line marking. It exists because a plain asphalt surface carries no
   * information about speed at all — the only motion cue on the ground was the rumble stripes at
   * the very edges of the frame, so the middle of the screen, where the player is actually
   * looking, read as static however fast the camera was moving.
   */
  road: readonly [number, number, number, number, number]
  /** What the far distance fades towards. Usually the sky, or the eye reads a hard horizon. */
  fog: number
  sky: { top: number; bottom: number; band: number }
  decor: { body: number; rim: number }
  /**
   * Multiplied over art-backed scenery, which cannot be redrawn per theme the way the generated
   * silhouettes are (see `applyTheme`). Kept as its own field rather than derived from `decor`:
   * those two are near-black body colours meant to be *drawn* with, and multiplying a coloured
   * cartoon sprite by one would leave a black blob. This is a lighting colour, not a paint.
   */
  decorTint: number
  enemy: { body: number; rim: number; telegraph: number }
  /**
   * Multiplied over art-backed enemies.
   *
   * Much lighter than `decorTint` on purpose. Enemy art is exempt from the build's desaturation
   * pass and is brightened instead, because an enemy has to be spotted at the horizon for the
   * telegraph to mean anything — so this is a light cast that says which theme we are in, not a
   * paint that decides what colour the enemy is.
   */
  enemyTint: number
  /**
   * How much light this theme's scene is in, applied to biome ground before anything else.
   *
   * **A biome says what the place is; this says what light it is in, and the two were collapsed
   * into one number until a bright theme existed.** Ground colours are authored at daylight, so
   * without this a moonlit run showed bright sand under a black sky — which is exactly what a
   * screenshot of `night` came back as. The old code got the night case right by accident, as a
   * side effect of dimming everything below the asphalt; removing that dimming to fix the black
   * verges removed the light level with it, and it has to come back as its own idea rather than
   * as a side effect of a contrast rule.
   *
   * Applied *before* `MIN_GROUND_CONTRAST`, never after: the separation floor is what keeps the
   * road's edge readable, so a dark theme may make the ground dim but may not make it merge.
   */
  groundLight: number
  /** Additive glow laid over the road surface, and how strong it is at its brightest. */
  glow: { color: number; alpha: number }
  vignette: number
}

/**
 * Every theme the game knows about.
 *
 * Only one is ever *materialised* — see `applyTheme`. These are descriptions: a handful of
 * numbers each, which is the whole point of driving the look from a palette rather than from
 * art files.
 */
export const THEMES: Record<string, RoadTheme> = {
  /**
   * Daylight, and **the theme this game should have shipped as the default from the start.**
   *
   * Every other palette here is a night palette. Measured across the six that shipped: asphalt
   * luminance 0.012–0.035, sky tops as low as 0.0018, and — once the old ground rule had dimmed
   * them — verges at 0.007. `ice`'s own comment calls it "the bright one" at 3.5% luminance. The
   * result is a game that renders as a road floating in a void, which is what it looked like and
   * what the screenshot that prompted this showed.
   *
   * So `day` is not a seventh flavour, it is the reference the rest are now read against: a mid
   * grey road, a real blue sky, white markings, and enough light on the scenery for a cartoon
   * silhouette to be a colour rather than a shape in the dark.
   */
  day: {
    id: 'day',
    groundLight: 1,
    // The fifth slot is the surface rung, and on this theme it was `0xf2c94c` -- highway yellow,
    // down the middle of a grey surface with white paint along both edges. Every other theme
    // already carried a neutral there; `day` is the default and so it was the one the game was
    // read on. Repainted to a cool near-white, which reads as a lit marking on a track rather
    // than as road paint, and stays clear of both the reserved threat hue and the yellow the
    // vegetation and the ground glow are made of.
    road: [0x44484f, 0x4e525a, 0xe8ecf2, 0xffffff, 0x8d9dae],
    // Warm haze, close to the sky's own bottom — the far field has to fade *into* the sky rather
    // than into a colour of its own, or the horizon becomes a line.
    fog: 0xb9d4e8,
    sky: { top: 0x4a9fe0, bottom: 0xbde3f5, band: 0xffffff },
    decor: { body: 0x5f7a52, rim: 0x9ec489 },
    decorTint: 0xffffff, // full daylight: art-backed scenery keeps its own colour, untinted
    enemy: { body: 0x5a2030, rim: 0xff4d6d, telegraph: THREAT_COLOR },
    enemyTint: 0xffe0e8, // a hair warm, so a hostile is still the pinkest thing in a green frame
    glow: { color: 0xfff2c4, alpha: 0.07 },
    vignette: 0x2a3a4a,
  },
  night: {
    id: 'night',
    groundLight: 0.34,
    road: [0x363b48, 0x404554, 0x4a7fd6, 0xf2f2f5, 0xb0b4bd],
    fog: 0x2c3550,
    sky: { top: 0x121a33, bottom: 0x3a4a70, band: 0x6a80ad },
    decor: { body: 0x2b3040, rim: 0x59637f },
    decorTint: 0x6f7fb0, // cool moonlight; the darkest of the six
    enemy: { body: 0x3a1f2b, rim: 0xff4d6d, telegraph: THREAT_COLOR },
    enemyTint: 0xe0b6d2, // cool violet, so a hostile still separates from the blue-grey scenery
    glow: { color: 0x2d6cff, alpha: 0.1 },
    vignette: 0x000000,
  },
  dusk: {
    id: 'dusk',
    groundLight: 0.6,
    road: [0x5a4450, 0x67505c, 0xffd45e, 0xffe9d6, 0xd6c3b4],
    fog: 0x8a6a9a,
    sky: { top: 0x3d2a63, bottom: 0xc87fa8, band: 0xffc27a },
    decor: { body: 0x4a2f3d, rim: 0x9c6a8c },
    decorTint: 0xd8a973, // low warm sun
    // **Repainted from a cyan `0x66e0ff`, which measured 1.6 degrees from the ship's own hull.**
    // `enemy.rim` is what an enemy *shot* is drawn in and what a generated silhouette is outlined
    // in, so on this theme the things trying to kill you wore the player's colour. Now the same
    // cold pink family as this theme's `enemyTint`. See `verify:road`.
    enemy: { body: 0x2b1a34, rim: 0xff5da0, telegraph: THREAT_COLOR },
    enemyTint: 0xf0b8ce, // cold pink against the warm ground
    glow: { color: 0xffc85a, alpha: 0.09 },
    vignette: 0x100820,
  },
  ice: {
    id: 'ice',
    groundLight: 0.88,
    road: [0x53687a, 0x5f7789, 0x7fdcff, 0xffffff, 0xc9d6de],
    fog: 0x9fc4d8,
    sky: { top: 0x5f9fc4, bottom: 0xcfe6f0, band: 0xffffff },
    decor: { body: 0x2c3f4f, rim: 0x7f9fb2 },
    decorTint: 0xa8d2ea, // pale and cold, barely darkened -- this theme is the bright one
    enemy: { body: 0x2a0f14, rim: 0xff5d5d, telegraph: THREAT_COLOR },
    enemyTint: 0xf0b4b4, // warm red -- the only warm thing on this theme
    glow: { color: 0x8fe6ff, alpha: 0.12 },
    vignette: 0x061018,
  },
  ember: {
    id: 'ember',
    groundLight: 0.5,
    road: [0x4a3a34, 0x56443d, 0xffa726, 0xffd9a8, 0xd8b98f],
    fog: 0x8a6f28,
    sky: { top: 0x5a2410, bottom: 0xd49a2a, band: 0xffb45c },
    // Deliberately ashen rather than colourful: against this much orange, a decor rim with any
    // saturation of its own starts competing with the enemies for the eye.
    decor: { body: 0x241a18, rim: 0x6b4a3a },
    decorTint: 0xd99b3f, // firelight
    // Repainted from a cyan `0x4dd8ff` for the same reason `dusk` was: 1.7 degrees from the ship.
    // Violet rather than pink here, so the theme keeps its "cold enemy against a fiery ground"
    // reading — it is simply a cold that is not the player's cold.
    enemy: { body: 0x0e1a24, rim: 0xa08cff, telegraph: THREAT_COLOR },
    enemyTint: 0xb8dcf0, // cold blue against the fire
    glow: { color: 0xffa430, alpha: 0.16 },
    vignette: 0x0a0402,
  },
  verdant: {
    id: 'verdant',
    groundLight: 0.9,
    road: [0x4a5a4e, 0x56685a, 0x86e05a, 0xe8ffe0, 0xd8e4cf],
    fog: 0xa8d4b4,
    sky: { top: 0x69b88f, bottom: 0xcdeacf, band: 0xf2ffe8 },
    decor: { body: 0x1e3a2c, rim: 0x4f8f6a },
    decorTint: 0x9ad18f, // green shade, close to neutral
    enemy: { body: 0x2e1030, rim: 0xff5ad0, telegraph: THREAT_COLOR },
    enemyTint: 0xf0b6f0, // magenta, the one hue the foliage cannot supply
    glow: { color: 0x3ee08a, alpha: 0.11 },
    vignette: 0x1c3326,
  },
  signal: {
    id: 'signal',
    groundLight: 0.62,
    // Monochrome with exactly one chromatic colour in the frame, and it means "enemy". Doubles
    // as the readable option for anyone who cannot separate the red/green pairs the other
    // themes lean on.
    road: [0x4a4a4a, 0x555555, 0xe6e6e6, 0xffffff, 0xd0d0d0],
    fog: 0x8f8f8f,
    sky: { top: 0x585858, bottom: 0xb8b8b8, band: 0xe8e8e8 },
    decor: { body: 0x1a1a1a, rim: 0x4a4a4a },
    decorTint: 0x93999c, // desaturated; this theme reads as almost monochrome
    enemy: { body: 0x1a0000, rim: 0xff2d2d, telegraph: THREAT_COLOR },
    enemyTint: 0xf0a0a0, // red, the single colour on a monochrome theme
    glow: { color: 0xffffff, alpha: 0.06 },
    vignette: 0x000000,
  },
}

/** The theme a run starts on. Saved progress is recorded per theme — see `SaveState`. */
export const DEFAULT_ROAD_THEME = 'day'

let activeThemeId = DEFAULT_ROAD_THEME

/** The theme currently in force. Every colour in the game reads through this. */
export function getRoadTheme(): RoadTheme {
  return THEMES[activeThemeId] ?? THEMES[DEFAULT_ROAD_THEME]
}

export function getRoadThemeId(): string {
  return activeThemeId
}

/**
 * Selects a theme. Returns whether it actually changed.
 *
 * Does not touch textures — that is `applyTheme`'s job, and keeping the two apart is what lets
 * this file stay `phaser`-free and testable.
 */
export function setRoadTheme(id: string): boolean {
  if (!THEMES[id] || id === activeThemeId) return false

  activeThemeId = id

  return true
}

/** Ids of every theme, in declaration order. */
export function themeIds(): string[] {
  return Object.keys(THEMES)
}

/**
 * Blends `color` towards `towards` by `amount` (`0..1`), in 24-bit RGB.
 *
 * Used to build the palette's fog rows. Channel-wise linear, which is not perceptually correct
 * and does not need to be: it is mixing a colour with the very fog it is disappearing into, so
 * the endpoints are what matter and both are exact.
 */
export function blendColor(color: number, towards: number, amount: number): number {
  const t = Math.min(1, Math.max(0, amount))
  const mix = (shift: number) => {
    const from = (color >> shift) & 0xff
    const to = (towards >> shift) & 0xff

    return Math.round(from + (to - from) * t) & 0xff
  }

  return (mix(16) << 16) | (mix(8) << 8) | mix(0)
}
