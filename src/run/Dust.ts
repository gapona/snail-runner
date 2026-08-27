import * as Phaser from 'phaser'
import { DEBRIS_LIFE_MS, MAX_DEBRIS } from './constants'
import { debrisAlpha, spawnDebris, stepDebris, type DebrisChunk } from './debris'
import { WORLD_LAYER, worldDepth } from './worldDepth'

/**
 * The puff a landing kicks up, drawn from the inherited debris model.
 *
 * **The model is `debris.ts` unchanged**, which the rail shooter wrote for things coming apart: it
 * allocates nothing per frame, compacts survivors in place, has a hard pool ceiling and clamps its
 * own delta so a backgrounded tab does not put every chunk three screens away on the frame it comes
 * back. All four of those are exactly what a landing puff needs, and none of them are worth writing
 * twice.
 *
 * What differs is only what it is drawn as: pale round motes rather than tumbling shards, because
 * dust has no edges. They are drawn as circles in one `Graphics` rather than as pooled `Image`s —
 * a dozen `fillCircle` calls against a dozen sprites that would each need a texture, a slot and a
 * depth.
 *
 * On `cameras.main` at the ground's own depth: the puff is at the snail's feet, in the world, and
 * anything standing on that ground has to paint over it.
 */
export class Dust {
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]

  private readonly graphics: Phaser.GameObjects.Graphics
  private readonly chunks: DebrisChunk[] = []
  private readonly rng: () => number

  constructor(scene: Phaser.Scene, seed = 1) {
    // Deterministic, like every other scatter here: the same landing on the same run throws the
    // same puff, so two frame-cost readings are comparable and a screenshot is reproducible.
    let state = seed >>> 0

    this.rng = () => {
      state = (state * 1664525 + 1013904223) >>> 0

      return state / 4294967296
    }
    this.graphics = scene.add.graphics().setDepth(worldDepth(0, WORLD_LAYER.shadow))
    this.gameObjects = [this.graphics]
  }

  /** Throws a puff out from a screen position — the snail's feet, at the moment of contact. */
  burst(x: number, y: number, now: number, screenWidth: number, count = DUST_PER_LANDING): void {
    spawnDebris(this.chunks, x, y, count, now, screenWidth * DUST_SPREAD, this.rng, MAX_DEBRIS)
  }

  update(now: number, dtMs: number, screenHeight: number): void {
    stepDebris(this.chunks, dtMs, now, screenHeight)
    this.graphics.clear()

    for (const chunk of this.chunks) {
      // Dust thins as it spreads: the alpha ramp is the debris model's own, and the radius grows
      // with age so a puff opens out instead of drifting as a clump.
      const age = Math.max(0, Math.min(1, (now - chunk.bornAt) / DEBRIS_LIFE_MS))

      this.graphics.fillStyle(DUST_COLOR, debrisAlpha(chunk, now) * DUST_ALPHA)
      this.graphics.fillCircle(chunk.x, chunk.y, chunk.size * (1 + age * DUST_GROWTH))
    }
  }

  destroy(): void {
    this.graphics.destroy()
  }
}

/** How many motes one landing throws. */
const DUST_PER_LANDING = 10
/**
 * How fast they spread, as a fraction of what a hit's debris does.
 *
 * Much slower: a hit is something breaking and a landing is air being pushed out from under a foot.
 * At the debris speed the puff reads as the snail exploding.
 */
const DUST_SPREAD = 0.34
const DUST_GROWTH = 1.6
const DUST_ALPHA = 0.5
/** Pale warm grey — dust is the ground in the air, and every ground in this game is warmer than white. */
const DUST_COLOR = 0xd9cdb8
