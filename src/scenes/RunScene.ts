import * as Phaser from 'phaser'
import { bindAction, bindSteering, type Steering } from '../platform/input'
import { bindLayout } from '../ui/layout'
import { WorldView } from '../run/WorldView'
import { createRunState, runSeconds, stepRun, type RunState } from '../run/runState'
import { createPlayerState, isOffRoad, jump, playerScreenFraction, stepPlayer, type PlayerState } from '../run/playerMotion'
import { PlayerView } from '../run/PlayerView'
import { createSquashState, squashAt, squashOnLanding, squashOnLaunch, type SquashState } from '../run/squash'
import { addFreeze, isFrozen, type Freezable } from '../run/hitstop'
import {
  JUMP_LAUNCH_V,
  KEYBOARD_POINT_SPEED,
  LANDING_HITSTOP_MS,
  OFFROAD_DRAG,
  SPEED_BASE,
} from '../run/constants'
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

    // The ground, the scenery, the sky and the camera that rides through them — all of it in
    // `WorldView`, which `MainMenu` builds the same way. Two scenes drawing the same world from
    // one class cannot disagree about the horizon, the palette or the fog.
    //
    // **The circuit is `buildRunCircuit()`'s, unchanged and unrandomised**, and that is a decision
    // rather than a default: it is the one lap measured against the sightline floor (`verify:road`
    // sweeps every point of it), and a per-run random circuit would be an unverified one. Variety
    // across runs comes from the scenery seed and from the eight biomes the lap already cycles
    // through, neither of which can produce a corner you cannot see round.
    this.world = new WorldView(this, { speed: SPEED_BASE, decorSeed: Math.floor(Math.random() * 0xffff) })

    // Built after the world, because it draws over it and the display list is the draw order.
    this.playerView = new PlayerView(this)

    // World/UI split per CLAUDE.md "Responsive Layout". Nothing screen-space exists yet; the
    // snail is a *world* object and belongs on `cameras.main` with the road.
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    this.uiCamera.ignore(this.worldObjects())

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
    return [...this.world.gameObjects, ...this.playerView.gameObjects]
  }

  layout(width: number, height: number): void {
    // cameras.main is deliberately left alone — no zoom, no centerOn. The road's own projection
    // is the camera model; a Phaser zoom on top of it would fight the horizon.
    this.uiCamera.setViewport(0, 0, width, height)
    this.world.layout(width, height)
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
