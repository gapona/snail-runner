import * as Phaser from 'phaser'
import { ATMOSPHERE_DEPTH } from '../run/constants'
import { createMoteTextures, moteTextureKey, MOTE_TEXTURE_SIZE } from './particleArt'
import {
  ATMOSPHERE_ALPHA,
  MOTE_LIFESPAN_MS,
  MOTE_POOL_SIZE,
  MOTE_SHAPES,
  atmosphereFor,
  type MoteShape,
} from './particles'

/**
 * Where the motes are born: a band across the top of the ground's own half of the frame.
 *
 * Not the whole frame: a mote spawning at the bottom edge appears out of nothing right where the
 * player is looking. Born near the horizon and drifting down, each one is smallest and faintest
 * exactly where it arrives, which is what makes the spawn invisible.
 */
const SPAWN_TOP = 0.24
const SPAWN_HEIGHT = 0.22

/**
 * What hangs in the air, drawn as one emitter per shape.
 *
 * **One emitter per shape rather than one reconfigured emitter, and the reason is the seam.**
 * `ParticleEmitter.setConfig` resets the emitter, so a biome boundary — where two biomes are on
 * screen at once for several seconds — would blink the existing motes out of the air. Four emitters
 * cost four idle objects and give the crossfade for free: the biome that has been left stops
 * emitting and its motes finish their own lives while the new biome's begin.
 *
 * **On the world camera, above the scenery and below the ship.** Motes are between the camera and
 * the world, so they draw over the ground and the billboards; they stay under the ship because the
 * player's own craft is the one thing in the frame nothing may obscure.
 */
export class Atmosphere {
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]

  private readonly emitters = new Map<MoteShape, Phaser.GameObjects.Particles.ParticleEmitter>()
  private current: string | null = null
  private width = 0
  private height = 0

  /**
   * The band motes are born in, as a live object rather than a `Phaser.Geom.Rectangle`.
   *
   * **A hand-written source, and it is a typing gap rather than a preference.** The emit zone
   * config takes a `RandomZoneSource`, whose `getRandomPoint` this build's definitions declare as
   * `(point: Vector2Like) => void` — while `Phaser.Geom.Rectangle`'s own is generic over
   * `Vector2`, so the obvious `{ type: 'random', source: rect }` does not typecheck. The same class
   * of `.d.ts` gap as `BaseSound`'s missing `mute`, and worked around the same way: a local shape
   * that satisfies the declared contract exactly.
   *
   * It reads `this.width`/`this.height` when it is asked rather than being rebuilt, so a resize
   * costs nothing and no emitter has to be reconfigured to follow one.
   */
  private readonly spawnZone = {
    getRandomPoint: (point: Phaser.Types.Math.Vector2Like): void => {
      point.x = Phaser.Math.FloatBetween(0, this.width)
      point.y = Phaser.Math.FloatBetween(this.height * SPAWN_TOP, this.height * (SPAWN_TOP + SPAWN_HEIGHT))
    },
  }

  constructor(scene: Phaser.Scene) {
    createMoteTextures(scene)

    for (const shape of MOTE_SHAPES) {
      const emitter = scene.add.particles(0, 0, moteTextureKey(shape), {
        lifespan: MOTE_LIFESPAN_MS,
        alpha: 0,
        maxParticles: MOTE_POOL_SIZE,
        emitting: false,
        blendMode: Phaser.BlendModes.NORMAL,
      })

      emitter.setDepth(ATMOSPHERE_DEPTH)
      this.emitters.set(shape, emitter)
    }

    this.gameObjects = [...this.emitters.values()]
  }

  /**
   * Points the air at a biome. Cheap to call every frame; it only acts on a change.
   *
   * The biome under the *camera*, not under the whole frame: two biomes are visible at every
   * boundary, and the air belongs to the one the player is in.
   */
  setBiome(biomeId: string): void {
    if (biomeId === this.current) return

    this.current = biomeId
    this.apply()
  }

  /** The emit zone is a fraction of the viewport, so it has to be rebuilt on a resize. */
  layout(width: number, height: number): void {
    this.width = width
    this.height = height
    this.apply()
  }

  destroy(): void {
    for (const emitter of this.emitters.values()) emitter.destroy()
    this.emitters.clear()
  }

  /** How many motes are alive, for the DEV cost report. */
  get liveMotes(): number {
    let alive = 0

    for (const emitter of this.emitters.values()) alive += emitter.getAliveParticleCount()

    return alive
  }

  private apply(): void {
    const air = this.current === null ? null : atmosphereFor(this.current)

    for (const [shape, emitter] of this.emitters) {
      if (!air || air.shape !== shape || this.width === 0) {
        // Stopped, not killed: the motes already in the air finish their own lives, which is what
        // makes a biome boundary a crossfade rather than a blink.
        emitter.stop()
        continue
      }

      emitter.setParticleTint(air.tint)
      emitter.setConfig({
        lifespan: MOTE_LIFESPAN_MS,
        maxParticles: MOTE_POOL_SIZE,
        // `rate` is motes per second, which is the number the table is authored in; the emitter
        // wants a gap in milliseconds between single emissions.
        frequency: 1000 / Math.max(0.1, air.rate),
        quantity: 1,
        // Scaled off the texture's own size, so the table's numbers stay independent of it.
        scale: {
          min: (air.scale.min * this.height * 0.018) / MOTE_TEXTURE_SIZE,
          max: (air.scale.max * this.height * 0.018) / MOTE_TEXTURE_SIZE,
        },
        // In and out over the mote's own life, not a single ramp: a mote that arrived at full
        // strength would announce its spawn point, and one that faded to nothing only at the end
        // would sit at full strength across the busiest part of the frame.
        alpha: { values: [0, ATMOSPHERE_ALPHA, ATMOSPHERE_ALPHA, 0], interpolation: 'linear' },
        speedY: { min: air.fall.min * this.height, max: air.fall.max * this.height },
        speedX: { min: air.drift * this.width * 0.6, max: air.drift * this.width * 1.4 },
        emitZone: { type: 'random', source: this.spawnZone },
      })
      emitter.setParticleTint(air.tint)
      emitter.start()
    }
  }
}
