/**
 * What hangs in the air over each biome: ash, spores, snow, sand, dust, glints.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:road`.
 *
 * **Atmosphere is the cheapest thing in the frame that says where you are.** Nine biomes are told
 * apart by the ground's colour, the props standing on it and the sky behind it — all of them *out
 * there*. Something drifting between the camera and the world is the only cue that puts the player
 * inside the place rather than in front of it, and it costs one small texture and a handful of
 * numbers.
 *
 * **Four shapes across nine biomes, and that is deliberate rather than a shortcut.** The shape says
 * what kind of thing is in the air — a flake falls, a speck hangs, a glint catches light — and
 * there are not nine of those. What separates two biomes sharing one is the tint, the size and the
 * fall, which is the same argument the decor makes for one texture under nine biome tints.
 */

/** The four things that can be in the air. Drawn procedurally — see `particleArt.ts`. */
export const MOTE_SHAPES = ['speck', 'flake', 'mote', 'glint'] as const

export type MoteShape = (typeof MOTE_SHAPES)[number]

export interface BiomeAtmosphere {
  shape: MoteShape
  /**
   * The mote's own colour.
   *
   * Swept for the reserved threat band by `verify:road`, exactly as the biome and decor tints are:
   * a mote is a colour the player sees, and something drifting across the whole frame in the danger
   * hue would dilute the one signal the frame reserves. A reservation enforced on one palette is
   * not enforced.
   */
  tint: number
  /** Motes emitted per second. The whole set is deliberately sparse — see `ATMOSPHERE_ALPHA`. */
  rate: number
  /** Drawn size, as a multiple of the mote texture's own 32px. */
  scale: { min: number; max: number }
  /** How fast it crosses the frame, in fractions of the viewport's height per second. */
  fall: { min: number; max: number }
  /** Sideways drift, in fractions of the viewport's width per second. Signed. */
  drift: number
}

/**
 * Peak opacity of a mote.
 *
 * **Low, and the number is a readability decision rather than a taste one.** Motes drift across the
 * whole frame, including the strip where the player reads telegraphs and picks targets
 * (`ENEMY_BAND`). Atmosphere that competes with a wind-up ring is atmosphere that has cost the
 * player a shield. At this alpha a mote reads as air rather than as an object, which is what it is.
 */
export const ATMOSPHERE_ALPHA = 0.34

/** How long a mote lives, in milliseconds. Long enough to cross the frame at the slowest fall. */
export const MOTE_LIFESPAN_MS = 5200

/**
 * One entry per biome, keyed by `Biome.id`.
 *
 * `verify:road` asserts the two sets match exactly, so a tenth biome cannot ship with nothing in
 * its air and a removed one cannot leave an entry behind.
 */
export const BIOME_ATMOSPHERE: Readonly<Record<string, BiomeAtmosphere>> = {
  // Pollen, hanging rather than falling, drifting with whatever wind is under the canopy.
  forest: { shape: 'speck', tint: 0xd8e8b0, rate: 7, scale: { min: 0.5, max: 1 }, fall: { min: 0.02, max: 0.06 }, drift: 0.03 },
  // Sand, moving fast and sideways: the one biome where the air is going somewhere.
  dunes: { shape: 'mote', tint: 0xe8cf9a, rate: 10, scale: { min: 0.4, max: 0.8 }, fall: { min: 0.05, max: 0.1 }, drift: 0.12 },
  // Midges over standing water, barely falling at all.
  wetland: { shape: 'speck', tint: 0xa8d8c4, rate: 9, scale: { min: 0.35, max: 0.7 }, fall: { min: 0.01, max: 0.04 }, drift: 0.05 },
  // Snow off the ridge: the heaviest fall in the set, and the only one that reads as weather.
  ridge: { shape: 'flake', tint: 0xe6f0ff, rate: 11, scale: { min: 0.5, max: 1.1 }, fall: { min: 0.1, max: 0.2 }, drift: 0.04 },
  // Ash, rising as much as falling — which is why its fall is the slowest and its drift upward.
  ashen: { shape: 'flake', tint: 0xd9d2c8, rate: 10, scale: { min: 0.45, max: 0.95 }, fall: { min: 0.015, max: 0.05 }, drift: -0.02 },
  // Spores, the densest air in the game, because a spore forest is what the biome is.
  fungal: { shape: 'speck', tint: 0xd5c0e8, rate: 11, scale: { min: 0.45, max: 0.9 }, fall: { min: 0.02, max: 0.05 }, drift: 0.02 },
  // Light catching on facets. Rare, because a glint that is always there is not a glint.
  crystal: { shape: 'glint', tint: 0xbfe8ff, rate: 5, scale: { min: 0.4, max: 0.9 }, fall: { min: 0.03, max: 0.07 }, drift: 0.01 },
  // Sea spray, blown along the shore.
  coast: { shape: 'mote', tint: 0xc8e6f2, rate: 8, scale: { min: 0.4, max: 0.85 }, fall: { min: 0.04, max: 0.09 }, drift: 0.08 },
  // Dust off old stone, settling.
  ruins: { shape: 'mote', tint: 0xd6cdbe, rate: 8, scale: { min: 0.4, max: 0.8 }, fall: { min: 0.03, max: 0.08 }, drift: 0.03 },
}

/**
 * The most motes an emitter may hold, **derived from the table rather than written down**.
 *
 * How many are actually in the air is `rate * lifespan`, so a pool picked by hand is either short
 * — in which case the emitter silently drops what the busiest biome asked for and the pool reports
 * its own ceiling as the demand, the exact defect the decor pool shipped with twice — or it is far
 * larger than anything can fill and says nothing at all. Derived, it cannot be either: it is the
 * densest biome's own demand plus a little headroom for the rounding, and `verify:road` asserts
 * both halves of that against every entry.
 */
export const MOTE_POOL_SIZE = Math.ceil(
  (Math.max(...Object.values(BIOME_ATMOSPHERE).map((air) => air.rate)) * MOTE_LIFESPAN_MS) / 1000 + 4,
)

/** The air over a biome, or `null` for one with no entry — which the checks forbid shipping. */
export function atmosphereFor(biomeId: string): BiomeAtmosphere | null {
  return BIOME_ATMOSPHERE[biomeId] ?? null
}

/** Every shape some biome actually asks for. A shape nothing uses is a texture nobody sees. */
export function usedMoteShapes(): readonly MoteShape[] {
  return [...new Set(Object.values(BIOME_ATMOSPHERE).map((entry) => entry.shape))]
}
