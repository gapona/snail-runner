import * as Phaser from 'phaser'
import { bindAction, bindSteering, type Steering } from '../platform/input'
import { bindLayout } from '../ui/layout'
import { WorldView } from '../run/WorldView'
import {
  addShield,
  applyBoost,
  createRunState,
  earnCoin,
  isRunOver,
  runSeconds,
  stepRun,
  takeHit,
  type RunState,
} from '../run/runState'
import { createPlayerState, isOffRoad, jump, playerScreenFraction, stepPlayer, type PlayerState } from '../run/playerMotion'
import { PlayerView } from '../run/PlayerView'
import { createSquashState, squashAt, squashOnLanding, squashOnLaunch, type SquashState } from '../run/squash'
import { addFreeze, isFrozen, type Freezable } from '../run/hitstop'
import { hits, placeRunObstacles, type Obstacle } from '../run/obstacles'
import { ObstacleSprites } from '../run/ObstacleSprites'
import { placePickups, reaches, type Pickup } from '../run/pickups'
import { PickupSprites } from '../run/PickupSprites'
import { Hud } from '../run/Hud'
import { createRng } from '../race/rng'
import {
  HITSTOP_MS,
  HIT_INVULNERABLE_MS,
  JUMP_LAUNCH_V,
  KEYBOARD_POINT_SPEED,
  LANDING_HITSTOP_MS,
  OBSTACLE_DEPTH,
  OFFROAD_DRAG,
  PLAYER_Z,
  SPEED_BASE,
} from '../run/constants'
import { SEGMENT_LENGTH } from '../road/constants'
import { streakDetuneCents, STREAK_STEPS } from '../audio/sfx'
import { wrapZ } from '../road/project'
import { playSfx } from '../audio/audio'
import { SFX } from '../audio/sfx'

/**
 * The run.
 *
 * **What is here is the world and the clock; the snail arrives in chunk 2.** This is the rail
 * shooter's `RailScene` after the combat layer came out: the ground, the scenery, the sky, and a
 * camera that now moves from `runState.ts` rather than at a speed the level table handed it.
 *
 * **The scene owns no simulation of its own.** `RunState` is a plain value stepped by a pure
 * function; this class reads `state.z` into the world every frame and draws. That split is what
 * makes the run testable under Node — see `npm run verify:run-speed` — and it is the same split
 * `WorldView` already has between "what the world is" and "what the rules are".
 *
 * The two-camera split is set up before there is anything to put on it, because it is the part
 * that is expensive to retrofit: `uiCamera` renders screen-space furniture 1:1 while `cameras.main`
 * carries the world, and every world object has to be `uiCamera.ignore()`-ed or it is drawn twice
 * at two different transforms. `assertWorldIsSingleCamera` checks that in DEV, so the mistake is
 * reported rather than merely visible.
 */
export class RunScene extends Phaser.Scene {
  private world!: WorldView
  private uiCamera!: Phaser.Cameras.Scene2D.Camera
  private run!: RunState
  private player!: PlayerState
  private playerView!: PlayerView
  private steering!: Steering
  private squash!: SquashState
  private obstacles!: Obstacle[]
  private obstacleSprites!: ObstacleSprites
  /**
   * Obstacles indexed by the segment they stand on.
   *
   * **Built once, walked per frame.** The renderer visits 300 segments a frame and the run holds
   * a couple of thousand obstacles; without this the draw would be O(obstacles) per frame instead
   * of O(what is on screen), which is the same reason `Segment.sprites` exists in the road layer.
   */
  private obstaclesBySegment!: Map<number, Obstacle[]>
  /**
   * Which lap each obstacle was last resolved against the snail on.
   *
   * The track is a closed loop the run goes round several times, so "already hit" cannot be a
   * boolean — it would disarm every obstacle for the rest of the run after one lap. Keyed by
   * obstacle id, holding the lap number, so each obstacle is live again next time round.
   */
  private resolvedOnLap!: Map<number, number>
  /**
   * The pickups, and the same segment index the obstacles get.
   *
   * `taken` is a plain boolean here where the obstacles need a per-lap key: a collected pickup is
   * gone for the rest of the run, which is what makes a stretch already cleared feel cleared.
   */
  private pickups!: Pickup[]
  private pickupsBySegment!: Map<number, Pickup[]>
  private pickupSprites!: PickupSprites
  private hud!: Hud
  /** Where the snail was along the track last frame, for the swept collision test. */
  private previousPlayerZ = 0
  private invulnerableUntil = 0
  /** One number a whole run is reproducible from: the scenery scatter and the obstacle layout. */
  private runSeed = 0
  /** Which lap the current obstacle layout was generated for. See `layLap`. */
  private laidLap = 0
  /** How many times this run has been hit. Reported by the DEV hook; the HUD reads `run.lives`. */
  private hitCount = 0
  /** Coins taken in a row, for the rising collection tone. Reset by anything that is not a coin. */
  private streak = 0
  /**
   * The player's own hitstop deadline — `hitstop.ts`'s `Freezable`, on the snail and nothing else.
   *
   * **Never `timeScale`, never a global pause.** The ground has to keep moving through a landing:
   * a world that stopped would read as a dropped frame, where a snail that stops for 45ms while
   * the road keeps going reads as weight. Same rule the rail shooter's per-entity hitstop had, and
   * the module is the same one.
   */
  private playerFreeze!: Freezable

  constructor() {
    super('RunScene')
  }

  create() {
    this.run = createRunState()
    this.player = createPlayerState()
    this.squash = createSquashState()
    this.playerFreeze = { frozenUntil: 0 }
    this.resolvedOnLap = new Map()
    this.invulnerableUntil = 0
    this.hitCount = 0
    this.streak = 0

    // The ground, the scenery, the sky and the camera that rides through them — all of it in
    // `WorldView`, which `MainMenu` builds the same way. Two scenes drawing the same world from
    // one class cannot disagree about the horizon, the palette or the fog.
    //
    // **The circuit is `buildRunCircuit()`'s, unchanged and unrandomised**, and that is a decision
    // rather than a default: it is the one lap measured against the sightline floor (`verify:road`
    // sweeps every point of it), and a per-run random circuit would be an unverified one. Variety
    // across runs comes from the scenery seed and from the eight biomes the lap already cycles
    // through, neither of which can produce a corner you cannot see round.
    this.runSeed = Math.floor(Math.random() * 0xffff)
    this.world = new WorldView(this, { speed: SPEED_BASE, decorSeed: this.runSeed })

    // The obstacles, laid along the finished track and *proved passable* before they are used —
    // see `obstacles.ts`. Seeded from the same draw as the scenery so a run is reproducible from
    // one number.
    this.layLap(0)
    this.previousPlayerZ = PLAYER_Z

    // Built after the world, because they draw over it and the display list is the draw order.
    this.obstacleSprites = new ObstacleSprites(this)
    this.pickupSprites = new PickupSprites(this)
    this.playerView = new PlayerView(this)
    // Screen-space, so it goes on `uiCamera` and is hidden from the world camera.
    this.hud = new Hud(this)

    // World/UI split per CLAUDE.md "Responsive Layout". Nothing screen-space exists yet; the
    // snail is a *world* object and belongs on `cameras.main` with the road.
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    this.uiCamera.ignore(this.worldObjects())
    this.cameras.main.ignore(this.hud.gameObjects)

    // Steering is an *absolute* axis — a runner steers to a place, not in a direction — so it is
    // `bindSteering` rather than `bindHeldAction`. See `platform/input.ts` for why that shape had
    // to exist and why reading `activePointer` at this call site would not do.
    this.steering = bindSteering(this, 'steer', {
      leftKeys: ['LEFT', 'A'],
      rightKeys: ['RIGHT', 'D'],
      keyboardSpeed: KEYBOARD_POINT_SPEED,
    })

    // **A tap anywhere jumps, and steering is a drag.** They share the pointer and do not
    // conflict: `bindAction`'s `tap` mode fires only on a press-and-release that stayed inside
    // `TAP_SLOP_PX`, which is exactly the gesture a steer is not. On a keyboard they are separate
    // keys and the question does not arise.
    bindAction(this, 'jump', { keys: ['SPACE', 'UP', 'W'], screenTap: true }, () => this.tryJump())

    bindAction(this, 'close', { keys: ['ESC'] }, () => {
      this.scene.start('MainMenu')
    })

    bindLayout(this, (width, height) => this.layout(width, height))

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.playerView.destroy()
      this.obstacleSprites.destroy()
      this.pickupSprites.destroy()
      this.hud.destroy()
      this.world.destroy()
    })

    this.exposeForTesting()

    if (import.meta.env.DEV) this.assertWorldIsSingleCamera()
  }

  /**
   * The DEV-only handle the run's numbers are read through.
   *
   * **The guard is inside the method, not at the call site.** Gating the *call* removes the call
   * and leaves the method on the class, unreferenced, with its string literals intact — which is
   * how `__menu` once reached a production bundle. An early return on `import.meta.env.DEV` makes
   * the body itself dead code, which is what the minifier can actually drop, and
   * `check-bundle.mjs` greps the built output to confirm it did.
   */
  private exposeForTesting(): void {
    if (!import.meta.env.DEV) return

    ;(window as unknown as Record<string, unknown>).__run = {
      state: () => ({ ...this.run }),
      jump: () => this.tryJump(),
      player: () => ({ ...this.player, offRoad: isOffRoad(this.player.offsetX) }),
      screen: () => ({ x: this.playerView.screenX, y: this.playerView.screenY }),
      seconds: () => runSeconds(this.run),
      obstacles: () => this.obstacles.length,
      drawn: () => ({ used: this.obstacleSprites.usedLastFrame, wanted: this.obstacleSprites.wantedLastFrame }),
      hits: () => this.hitCount,
    }
  }

  /**
   * A missed `ignore()` draws the object twice — once per camera, at different transforms — which
   * on a road that is mostly one colour looks like a rendering artefact rather than a wiring
   * mistake. Cheap to check once at start-up, impossible to spot by eye later.
   */
  private assertWorldIsSingleCamera(): void {
    const leaked = this.worldObjects().filter((object) => (object.cameraFilter & this.uiCamera.id) === 0)

    if (leaked.length > 0) {
      console.warn(`[run] ${leaked.length} world object(s) are not ignored by uiCamera and will be drawn twice`)
    }
  }

  /**
   * Resolves the snail against everything it crossed this frame.
   *
   * **Swept, not sampled.** At `SPEED_CAP` a frame covers 60 world units and an obstacle is 200
   * deep, so a point test would usually work and would miss on a long frame — which is exactly the
   * frame a phone drops. The test is against the *interval* the snail travelled, so nothing can be
   * passed through however long the frame was.
   *
   * The lap number is part of the key because the track loops: `hit` as a boolean would disarm
   * every obstacle permanently after one lap.
   */
  private resolveObstacles(fromZ: number, toZ: number, lap: number, now: number): void {
    if (now < this.invulnerableUntil) return

    // Only the segments the sweep actually touched, through the same index the renderer uses. The
    // alternative — walking the run's whole obstacle list every frame — is a couple of thousand
    // comparisons per frame to find the two or three that can possibly matter.
    const first = Math.floor(fromZ / SEGMENT_LENGTH) - 1
    const last = Math.floor(toZ / SEGMENT_LENGTH)
    const segmentCount = this.world.track.length

    for (let index = first; index <= last; index++) {
      const here = this.obstaclesBySegment.get(((index % segmentCount) + segmentCount) % segmentCount)

      if (!here) continue

      for (const obstacle of here) {
        if (this.resolvedOnLap.get(obstacle.id) === lap) continue
        // The swept interval against the obstacle's own depth. Both are unwrapped within one lap;
        // the caller splits a frame that crosses the seam into two calls.
        if (toZ < obstacle.z || fromZ > obstacle.z + OBSTACLE_DEPTH) continue

        this.resolvedOnLap.set(obstacle.id, lap)
        if (!hits(this.player, obstacle)) continue

        this.takeHit(now)

        return
      }
    }
  }

  /**
   * Lays out one lap of obstacles and pickups, at the difficulty the run has reached.
   *
   * **Called again every time the run wraps, and that is not an optimisation.** The renderer and
   * the collision both index by *segment*, so a layout generated across a distance longer than the
   * lap would put two obstacles on the same piece of ground. Regenerating per lap keeps one
   * obstacle per place and lets `difficultyAt` see how far the run has actually come — see
   * `placeRunObstacles`.
   */
  private layLap(lapOffset: number): void {
    this.obstacles = placeRunObstacles(this.runSeed, this.world.trackLength, lapOffset)
    this.obstaclesBySegment = indexBySegment(this.obstacles, this.world.track.length)
    // Laid *after* the obstacles and against them — see `sideAwayFrom`. A pickup in the gap the
    // player was already threading costs nothing, and a pickup that costs nothing is scenery.
    this.pickups = placePickups({
      rng: createRng((this.runSeed ^ 0x5eed) + Math.round(lapOffset / SEGMENT_LENGTH)),
      fromZ: lapOffset === 0 ? SEGMENT_LENGTH * 20 : 0,
      toZ: this.world.trackLength,
      trackLength: this.world.trackLength,
      obstacles: this.obstacles,
    })
    this.pickupsBySegment = indexBySegment(this.pickups, this.world.track.length)
    // A fresh set of ids means the old lap's resolutions mean nothing, and keeping them would
    // disarm whatever happened to reuse a number.
    this.resolvedOnLap.clear()
    this.laidLap = Math.floor(lapOffset / this.world.trackLength)
  }

  /**
   * Collects anything the snail passed through this frame.
   *
   * Swept over the same interval as the obstacles and for the same reason. A pickup is *taken*
   * rather than resolved-per-lap: it is gone for the rest of the run, which is what makes a stretch
   * the player has already cleared feel cleared.
   */
  private collectPickups(fromZ: number, toZ: number): void {
    const first = Math.floor(fromZ / SEGMENT_LENGTH) - 1
    const last = Math.floor(toZ / SEGMENT_LENGTH)
    const segmentCount = this.world.track.length

    for (let index = first; index <= last; index++) {
      const here = this.pickupsBySegment.get(((index % segmentCount) + segmentCount) % segmentCount)

      if (!here) continue

      for (const pickup of here) {
        if (pickup.taken || toZ < pickup.z || fromZ > pickup.z + SEGMENT_LENGTH) continue
        if (!reaches(this.player, pickup)) continue

        pickup.taken = true
        if (pickup.kind === 'boost') this.run = applyBoost(this.run)
        else if (pickup.kind === 'shield') this.run = addShield(this.run)
        else this.run = earnCoin(this.run)
        // The streak ladder: each coin in a row sounds one interval higher, so the player can hear
        // how many they have taken without looking away from the road. Reset by a gap.
        playSfx(pickup.kind === 'coin' ? SFX.STREAK : SFX.PICKUP, { detune: this.streakDetune(pickup.kind) })
      }
    }
  }

  /**
   * How far to detune the next collection sound, in cents.
   *
   * Only coins climb; a boost or a shield is a *different* event and resets the run of them, which
   * is what stops the ladder from encoding "how many things did I touch" instead of "how many coins
   * in a row did I get".
   */
  private streakDetune(kind: string): number {
    if (kind !== 'coin') {
      this.streak = 0

      return 0
    }

    const step = Math.min(this.streak, STREAK_STEPS - 1)

    this.streak++

    return streakDetuneCents(step)
  }

  /**
   * What a hit costs: speed, a moment of the snail's own time, and a window of not being hit again.
   *
   * **Speed, not a life.** The punishment is measured in the same unit as the reward, which is what
   * makes the whole run one economy rather than a score plus a health bar bolted to it. Three of
   * them end the run — chunk 5 owns that part; this is the per-hit half.
   */
  private takeHit(now: number): void {
    this.hitCount++
    this.streak = 0
    this.invulnerableUntil = now + HIT_INVULNERABLE_MS
    addFreeze(this.playerFreeze, now, HITSTOP_MS)
    // The whole penalty is one call into the pure module — speed, shields and lives together, so
    // there is no half-applied state a scene could leave behind.
    this.run = takeHit(this.run)
    this.cameras.main.shake(180, 0.008)
    playSfx(SFX.HIT)

    if (isRunOver(this.run)) this.endRun()
  }

  /**
   * Ends the run and hands over to the result screen.
   *
   * **Paused, not stopped.** The result panel is drawn over a frozen road rather than over black:
   * the world is what the player was just in, and cutting to an empty background makes the run
   * feel deleted rather than finished. Same overlay shape as `Settings` and `Shop`.
   */
  private endRun(): void {
    this.scene.pause()
    this.scene.launch('RunOver', { distance: this.run.distance, coins: this.run.coins })
  }

  /**
   * Leaves the ground, if the snail is on it.
   *
   * The sound and the stretch are triggered here rather than by watching `grounded` flip, because
   * a launch is a thing the *player* did: reacting to the state change would also fire on any
   * future launch the game itself causes (a bounce, a ramp), which wants a different sound.
   */
  private tryJump(): void {
    if (!this.player.grounded) return

    this.player = jump(this.player)
    squashOnLaunch(this.squash, this.time.now)
    playSfx(SFX.JUMP)
  }

  /** Everything that belongs to `cameras.main` and must be hidden from `uiCamera`. */
  private worldObjects(): Phaser.GameObjects.GameObject[] {
    return [
      ...this.world.gameObjects,
      ...this.obstacleSprites.gameObjects,
      ...this.pickupSprites.gameObjects,
      ...this.playerView.gameObjects,
    ]
  }

  layout(width: number, height: number): void {
    // cameras.main is deliberately left alone — no zoom, no centerOn. The road's own projection
    // is the camera model; a Phaser zoom on top of it would fight the horizon.
    this.uiCamera.setViewport(0, 0, width, height)
    this.world.layout(width, height)
    this.hud.layout(width, height)
  }

  update(time: number, delta: number): void {
    const width = this.scale.width
    const height = this.scale.height

    // **The snail is stepped before the run, and the run reads the result.** Leaving the road
    // costs speed, so the drag this frame has to be about where the snail is *now* — stepping the
    // run first would charge the verge a frame late, which at top speed is a whole segment.
    const steer = this.steering.read(delta)
    const wasAirborne = !this.player.grounded

    // **The snail is frozen; the world is not.** A landing takes 45ms out of the creature and
    // nothing else, so the road keeps scrolling underneath it — which is what reads as weight
    // rather than as a stutter. `stepPlayer` is simply not called, so its accumulator does not
    // advance either and the frame it thaws on is a clean one.
    if (!isFrozen(this.playerFreeze, time)) {
      this.player = stepPlayer(this.player, { targetFraction: steer.targetFraction, active: steer.active }, delta)
    }

    // **Collisions before the draw and after the step**, so a hit is resolved against the frame
    // the player actually saw. The snail's own z is the camera's plus the constant it lives at.
    const playerZ = wrapZ(this.run.z + PLAYER_Z, this.world.trackLength)
    const lap = Math.floor((this.run.distance + PLAYER_Z) / this.world.trackLength)

    // A new lap needs a new layout, at whatever difficulty the run has reached — see `layLap`.
    if (lap !== this.laidLap) this.layLap(lap * this.world.trackLength)

    if (playerZ >= this.previousPlayerZ) {
      this.collectPickups(this.previousPlayerZ, playerZ)
      this.resolveObstacles(this.previousPlayerZ, playerZ, lap, time)
    } else {
      // The frame crossed the loop seam. Two calls rather than one wrapped comparison: the second
      // is a different lap, and an obstacle straddling the seam must be live in both.
      this.collectPickups(this.previousPlayerZ, this.world.trackLength)
      this.collectPickups(0, playerZ)
      this.resolveObstacles(this.previousPlayerZ, this.world.trackLength, lap - 1, time)
      this.resolveObstacles(0, playerZ, lap, time)
    }
    this.previousPlayerZ = playerZ

    if (wasAirborne && this.player.grounded) {
      squashOnLanding(this.squash, time)
      addFreeze(this.playerFreeze, time, LANDING_HITSTOP_MS)
      playSfx(SFX.LAND)
    }
    this.run = stepRun(this.run, delta, {
      trackLength: this.world.trackLength,
      drag: isOffRoad(this.player.offsetX) ? OFFROAD_DRAG : 0,
    })

    // **The world is told where the camera is, not how fast to go.** `WorldView.advance` integrates
    // a speed of its own, which is right for the menu (it rides on a script) and wrong here: the
    // run already integrated the same quantity, under a fixed timestep, and letting the world
    // integrate it again over the raw frame delta would give two answers to "how far have we come"
    // — with the score reading one of them and the road drawing the other.
    this.world.setSpeed(0)
    this.world.cameraZ = this.run.z
    // Still called, with the real delta and a zero speed: `advance` also eases the camera's lean,
    // and that easing is dt-corrected — handing it a zero delta would freeze the lean instead of
    // leaving it alone. What it follows is the snail's own screen fraction, converted from its
    // road position rather than read off the sprite: the sprite is a frame behind by the time
    // this runs, and the lean is what decides where the sprite goes.
    this.world.advance(delta, playerScreenFraction(this.player.offsetX))
    this.world.render(width, height)
    this.obstacleSprites.render(
      this.obstaclesBySegment,
      this.world.track,
      this.world.baseIndex,
      this.world.clipY,
      width,
      height,
    )
    this.pickupSprites.render(
      this.pickupsBySegment,
      this.world.track,
      this.world.baseIndex,
      this.world.clipY,
      width,
      height,
      time,
    )
    this.hud.update(this.run, width)
    // After the world, never before: it reads this frame's segment projections out of the mesh
    // pass, exactly as `RoadSprites` does.
    this.playerView.render(
      this.player,
      this.world.track,
      this.world.baseIndex,
      this.run.z,
      width,
      height,
      squashAt(this.squash, time, this.player.vy / JUMP_LAUNCH_V),
    )
  }
}

/**
 * Groups obstacles by the segment index they stand on.
 *
 * The renderer walks segments, not obstacles — see `ObstacleSprites.render` — so this is what
 * turns a run-long list into something a 300-segment draw can index into. The same shape
 * `Segment.sprites` gives the scenery, built here rather than on the segment because `src/road/`
 * does not know obstacles exist and is not going to be taught.
 */
function indexBySegment<T extends { z: number }>(items: readonly T[], segmentCount: number): Map<number, T[]> {
  const index = new Map<number, T[]>()

  for (const item of items) {
    const key = Math.floor(item.z / SEGMENT_LENGTH) % segmentCount
    const list = index.get(key)

    if (list) list.push(item)
    else index.set(key, [item])
  }

  return index
}
