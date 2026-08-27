import * as Phaser from 'phaser'
import { BIOMES, GROUND_SHADES_PER_BIOME, groundShadesForTheme } from './biomes'
import { FOG_STEPS, PALETTE_COLUMNS, PALETTE_INDEX } from './constants'
import { blendColor, getRoadTheme } from './themes'

// `paletteU`/`paletteV` are defined in constants.ts (which imports no phaser) and re-exported
// here so callers can treat them as part of the palette's API while `npm run verify:road` can
// still import them under plain Node. See their docstrings for why the texel *centre* matters.
export { paletteU, paletteV, fogStepFor } from './constants'

/**
 * Builds the road's palette as a `PALETTE_COLUMNS x FOG_STEPS` texture: one column per colour, one row per
 * step of distance fog.
 *
 * **Both dimensions exist for the same reason: `Mesh2D` has no per-vertex tint.** It carries a
 * single object-wide tint, so neither the colour of a quad nor how far it has faded into the
 * distance can be expressed per quad. Colour travels through U, fog through V, and a quad
 * selects both by its own UVs — which costs **zero extra draw calls and zero passes**, because
 * it is the same texture the mesh was already sampling.
 *
 * NEAREST filtering is mandatory in both axes, not cosmetic. Under the default LINEAR filter
 * the GPU blends adjacent texels near a sample point, so a quad's colour bleeds into its
 * neighbour's along the edges: horizontally the rumble stripes appear to swim, vertically the
 * far road shimmers between two fog steps. Together with `paletteU`/`paletteV`'s texel-centre
 * sampling, NEAREST makes each quad's colour exact.
 */
export function createRoadPalette(scene: Phaser.Scene, key: string): Phaser.Textures.Texture {
  const theme = getRoadTheme()
  const width = PALETTE_COLUMNS

  // A theme change rebuilds this, so an existing texture of the same key is stale rather than
  // reusable. Removed and re-created instead of reused — see `applyTheme`.
  if (scene.textures.exists(key)) scene.textures.remove(key)

  const canvasTexture = scene.textures.createCanvas(key, width, FOG_STEPS)

  if (!canvasTexture) {
    throw new Error(`createRoadPalette: could not create canvas texture "${key}"`)
  }

  const context = canvasTexture.context

  for (let row = 0; row < FOG_STEPS; row++) {
    // Row 0 is the colour untouched; the last row is fully the fog colour.
    const amount = FOG_STEPS <= 1 ? 0 : row / (FOG_STEPS - 1)

    for (let column = 0; column < width; column++) {
      // The road's own colours first, then `GROUND_SHADES_PER_BIOME` shades per biome. Ground is faded
      // by the theme's fog exactly as the road is, which is what makes a forest in `ice` a cold
      // forest without anyone authoring one: the place is the biome, the light is the theme.
      const base = column < theme.road.length
        ? theme.road[column]
        : groundShadesForTheme(
            BIOMES[Math.floor((column - theme.road.length) / GROUND_SHADES_PER_BIOME)].ground,
            theme.road[PALETTE_INDEX.ASPHALT_DARK],
            theme.road[PALETTE_INDEX.ASPHALT_LIGHT],
            undefined,
            theme.groundLight,
          )[(column - theme.road.length) % GROUND_SHADES_PER_BIOME]
      const faded = blendColor(base, theme.fog, amount)

      context.fillStyle = `#${faded.toString(16).padStart(6, '0')}`
      context.fillRect(column, row, 1, 1)
    }
  }

  canvasTexture.refresh()
  canvasTexture.setFilter(Phaser.Textures.FilterMode.NEAREST)

  return canvasTexture
}
