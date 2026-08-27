import * as Phaser from 'phaser'
import { CAMERA_HEIGHT, DECOR_POOL_SIZE, SEGMENT_LENGTH } from '../road/constants'
import { Backdrop } from '../road/Backdrop'
import { buildLevelCircuit, buildMenuCircuit, buildRunCircuit, type CircuitSpec } from '../road/circuits'
import { createDecorTextures, DECOR_KEYS } from '../road/decor'
import { Atmosphere } from '../road/Atmosphere'
import { DecalMesh } from '../road/DecalMesh'
import { RoadMesh } from '../road/RoadMesh'
import { RoadSprites } from '../road/RoadSprites'
import { wrapZ } from '../road/project'
import { decorateTrack, trackLengthOf, type Segment } from '../road/track'
import { biomeForSegment, skylineBiomeTint } from '../road/biomes'
import { multiplyTint } from '../road/color'
import { getRoadTheme } from '../road/themes'
import { FIXED_STEP_MS } from '../race/constants'
import { CAMERA_LEAN, CAMERA_LEAN_SMOOTHING, SPEED_BASE } from './constants'

/** How the world is set up for one scene. Everything has a default; nothing has to be passed. */
export interface WorldViewOptions {
  /** Camera speed along the track, in world units per second. */
  speed?: number
  /** Which circuit to ride — see `road/circuits.ts`. */
  circuit?: 'run' | 'menu'
  /** Seed for the scenery scatter. A different one gives a recognisably different stretch. */
  decorSeed?: number
  /**
   * Build this level's own circuit instead of one of the two named ones.
   *
   * A level is one biome for its whole track, so its lap is authored per level rather than being a
   * slice of the eight-biome circuit. When absent the world is the endless run circuit or the
   * menu's, exactly as before — which is what keeps the menu and the endless mode untouched.
   */
  levelCircuit?: CircuitSpec
  /** How far the camera leans towards whatever it is following, in road half-widths. */
  lean?: number
}

/** What one `render()` cost, in milliseconds. The DEV perf report is the only consumer. */
export interface WorldRenderCost {
  roadMs: number
  decorMs: number
  /**
   * What `DecalMesh.render` cost this frame, on its own.
   *
   * Separated from `decorMs` because the ground marks and the billboards are sized by different
   * things — the decals by `DECAL_DRAW_SEGMENTS` and their own density, the sprites by how many
   * decorated segments fall in the visible band — so a change to one is invisible inside a total
   * that is mostly the other.
   *
   * **Timed with `performance.now()` around the call, never inferred from a frame rate.** A tab
   * that is not focused has its rAF throttled and in a hidden one suspended outright, so an fps
   * figure taken under automation says nothing about what anything cost. Compare the batched
   * per-frame figure rather than the percentiles: `performance.now()` is clamped to ~100us in a
   * page that is not cross-origin isolated, which is coarser than a single one of these calls.
   */
  decalMs: number
}

/**
 * The world, without any rules: ground, scenery, sky, fog, and the camera that travels through
 * them. Everything both scenes draw and neither scene owns.
 *
 * **The menu renders the real world, and this class is what makes that a fact rather than a
 * resemblance.** The alternative — a second copy of the setup in `MainMenu` — would agree with
 * the play scene on the day it was written and disagree with it after the first theme change,
 * horizon move or palette edit, and the whole point of a menu built out of the game is that the
 * transition into play does not need a fade to hide a seam.
 *
 * What stays out of here is as deliberate as what is in it: no snail, no obstacles, no
 * run, no HUD. Those are rules. A scene composes them on top of a world; the world has no
 * opinion about whether anything is shooting.
 *
 * **Order inside `render()` is load-bearing** and is why the three pieces are behind one call
 * rather than three: `RoadSprites` reads this frame's segment projections and `RoadMesh.clipY`
 * straight out of the mesh pass, and `Backdrop` reads the camera drift the same loop integrates.
 * A caller that got them separately could get them in the wrong order, and the symptom would be
 * scenery standing on last frame's road.
 */
export class WorldView {
  /** The mesh itself, for the DEV cost benchmark, which drives it directly. */
  readonly roadMesh: RoadMesh

  readonly track: Segment[]
  readonly trackLength: number

  /** Distance travelled along the rail. Advances on its own; the player cannot change it. */
  cameraZ = 0

  /** Current lateral lean towards whatever is being followed, in road half-widths. */
  cameraLean = 0

  private readonly roadSprites: RoadSprites
  /** Readable so the DEV mark overlay can ask it what it drew. Nothing else touches it. */
  readonly decalMesh: DecalMesh
  private readonly atmosphere: Atmosphere
  private readonly backdrop: Backdrop
  /**
   * Camera speed along the track.
   *
   * **Not readonly, because in a runner the speed *is* the game.** The menu sets it once at
   * construction and leaves it; `RunScene` writes it every frame from `RunState.speed`. A plain
   * assignment rather than a ramp, because the caller owns the curve — see `runState.ts`.
   */
  private speed: number
  private readonly leanAmount: number

  constructor(scene: Phaser.Scene, options: WorldViewOptions = {}) {
    this.speed = options.speed ?? SPEED_BASE
    this.leanAmount = options.lean ?? CAMERA_LEAN

    this.track =
      options.levelCircuit !== undefined
        ? buildLevelCircuit(options.levelCircuit)
        : options.circuit === 'menu'
          ? buildMenuCircuit()
          : buildRunCircuit()
    this.trackLength = trackLengthOf(this.track.length)

    // Scenery is placed on the finished track (after build()'s closing and padding sections),
    // deterministically from a seed — see `decorateTrack` on why that matters.
    const decorTextures = createDecorTextures(scene)

    decorateTrack(this.track, DECOR_KEYS, options.decorSeed === undefined ? {} : { seed: options.decorSeed })

    // The flat background fill is what shows behind the parallax layers, so a frame where a
    // layer has not been drawn yet is still the theme's own sky rather than black.
    scene.cameras.main.setBackgroundColor(getRoadTheme().sky.top)
    this.backdrop = new Backdrop(scene)
    this.roadMesh = new RoadMesh(scene, this.track)
    // Between the ground and everything standing on it, in construction order as in draw order.
    this.decalMesh = new DecalMesh(scene)
    this.roadSprites = new RoadSprites(scene, DECOR_POOL_SIZE, decorTextures)
    // Between the camera and everything else: what is in the air is the one cue that puts the
    // player *inside* a biome rather than in front of it.
    this.atmosphere = new Atmosphere(scene)
  }

  /** Everything that belongs to `cameras.main` and must be hidden from a scene's `uiCamera`. */
  get gameObjects(): Phaser.GameObjects.GameObject[] {
    return [
      this.roadMesh.gameObject,
      this.decalMesh.gameObject,
      ...this.roadSprites.gameObjects,
      ...this.atmosphere.gameObjects,
      ...this.backdrop.gameObjects,
    ]
  }

  /** The segment the camera is currently on — enemies and scenery both index off it. */
  get baseIndex(): number {
    return this.roadMesh.baseIndex
  }

  /** Per-segment screen y below which a hill hides everything. See `RoadMesh.clipY`. */
  get clipY(): number[] {
    return this.roadMesh.clipY
  }

  /** How far along the rail one segment is, in world units — for anything spawning ahead. */
  get segmentLength(): number {
    return SEGMENT_LENGTH
  }

  /**
   * Advances the rail and eases the camera's lean towards `followFraction`.
   *
   * `followFraction` is where the thing being followed sits across the frame, `0..1`. The play
   * scene passes the ship; the menu passes the ship it is flying on a script. Passing the centre
   * (`0.5`) simply means the camera does not lean.
   */
  /** Sets the travel speed. `RunScene` calls this every frame from `RunState.speed`. */
  setSpeed(speed: number): void {
    this.speed = Math.max(0, speed)
  }

  advance(deltaMs: number, followFraction: number): void {
    this.cameraZ = wrapZ(this.cameraZ + (this.speed * deltaMs) / 1000, this.trackLength)

    // `RoadMesh.render` integrates the track's own curvature internally into its camera-x, so
    // what is tracked here is ONLY the lean — adding the curve drift out here would bend twice.
    const target = (followFraction - 0.5) * this.leanAmount
    // dt-corrected exponential smoothing: `CAMERA_LEAN_SMOOTHING` is the fraction closed per
    // 60Hz frame, so a longer frame must close proportionally more, not the same amount.
    const smoothing = 1 - Math.pow(1 - CAMERA_LEAN_SMOOTHING, deltaMs / FIXED_STEP_MS)

    this.cameraLean += (target - this.cameraLean) * smoothing
    // The sun's own clock. Advanced here rather than in `render` because a paused scene renders
    // and does not advance, which is what stops the sun turning behind a result panel.
    this.backdrop.advance(deltaMs)
  }

  /**
   * Draws the ground, then the sky's parallax, then the scenery standing on the ground.
   *
   * Returns what each pass cost so a scene's DEV perf report can keep reporting them separately
   * — the numbers are the reason the split exists, and hiding them behind this call would make
   * the one measurement anybody takes of this class impossible to take.
   */
  /**
   *
   * Passed per frame rather than held, because it depends on the ship's drawn size and the
   * viewport, both of which change on a resize. The menu has no ship and passes nothing.
   */
  render(width: number, height: number): WorldRenderCost {
    const roadStarted = performance.now()

    this.roadMesh.render(this.cameraLean, this.cameraZ, width, height)

    const roadMs = performance.now() - roadStarted

    // The sky answers to the two things that actually move the horizon: the camera's lateral
    // drift from the track's curvature, and its height above the ground. Both come out of the
    // mesh's own render, which is why this runs after it.
    this.backdrop.update(this.roadMesh.horizonDriftX, this.roadMesh.cameraY, CAMERA_HEIGHT)

    const decorStarted = performance.now()

    // Marks on the ground before the things standing on it: they read this frame's projections out
    // of the mesh pass exactly as the billboards do, and they are painted under them.
    this.decalMesh.render(this.track, this.roadMesh.baseIndex, this.roadMesh.clipY)

    const decalMs = performance.now() - decorStarted

    this.roadSprites.render(this.track, this.roadMesh.baseIndex, this.roadMesh.clipY, width, height)
    // The biome under the *camera*, not the one filling the frame: two are visible at every
    // boundary, and the air belongs to the one the player is in. Cheap to call every frame — the
    // emitters only react to a change.
    const biome = biomeForSegment(this.roadMesh.baseIndex, this.track.length)

    this.atmosphere.setBiome(biome.id)
    // The range is NOT drawn in the props' product. It is the theme's air with a small steer from
    // the biome, and the steer is crossfaded across the seam rather than stepped — the strip has
    // no `z`, so a step lands on the whole width of the frame at once. See `BIOME_SKYLINE_WEIGHT`
    // and `skylineBiomeTint`. The theme's light still multiplies in, so a night horizon is dark.
    this.backdrop.setSkylineTint(
      multiplyTint(skylineBiomeTint(this.roadMesh.baseIndex, this.track.length), getRoadTheme().decorTint),
    )

    return { roadMs, decorMs: performance.now() - decorStarted, decalMs }
  }

  /** How many scenery slots the last frame wanted, for the DEV pool-pressure report. */
  get decorWantedLastFrame(): number {
    return this.roadSprites.wantedLastFrame
  }

  /** Size of the scenery pool, which the same report measures that demand against. */
  get decorPoolSize(): number {
    return this.roadSprites.gameObjects.length
  }

  /** Ground marks drawn and wanted last frame — the same pool-pressure pair the scenery reports. */
  get decalsLastFrame(): { used: number; wanted: number } {
    return { used: this.decalMesh.usedLastFrame, wanted: this.decalMesh.wantedLastFrame }
  }

  /** Motes in the air right now, for the same report. */
  get liveMotes(): number {
    return this.atmosphere.liveMotes
  }

  layout(width: number, height: number): void {
    this.backdrop.layout(width, height)
    this.atmosphere.layout(width, height)
  }

  /**
   * Puts the world back on its feet after `applyTheme` swapped every themed texture.
   *
   * **`applyTheme`'s precondition used to be free and is not any more.** It removes and rebuilds
   * the pixels behind live keys, and its own documented rule is that nothing may be drawing them
   * at the time — which held while the only caller was a menu made of a static illustration. A
   * menu that renders the world breaks that rule by existing, so the world has to be able to
   * absorb the swap: the palette is re-pointed (the mesh holds a `Texture`, not a key), the
   * sprite pools forget their cached keys, and the backdrop's own `layout` re-points the sky.
   *
   * Found by switching themes in the running menu and watching the renderer throw on
   * `glTexture` of null — not by reading the code.
   */
  refreshTheme(scene: Phaser.Scene, width: number, height: number): void {
    this.roadMesh.refreshPalette(scene)
    this.roadSprites.refreshTextures()
    this.layout(width, height)
  }

  destroy(): void {
    this.roadMesh.destroy()
    this.decalMesh.destroy()
    this.atmosphere.destroy()
    this.roadSprites.destroy()
    this.backdrop.destroy()
  }
}
