import { DebugMarks } from '../run/DebugMarks'
import {
  createSteerProbe,
  stepSteerProbe,
  steerReport,
  type SteerProbeState,
} from '../run/steerProbe'
import {
  applySteerPreset,
  getSteerTuning,
  relativeTarget,
  setSteerTuning,
  steerPresetName,
  type SteerMode,
  type SteerPresetName,
} from '../run/steerTuning'
import { HUD_DEPTH } from '../run/hudDepth'
import * as Phaser from 'phaser'
import { bindAction, bindSteering, type Steering } from '../platform/input'
import { bindLayout } from '../ui/layout'
import { launchOverlay } from '../ui/overlay'
import type { LeavableRun, RunPauseData } from './RunPause'
import { WorldView } from '../run/WorldView'
import {
  addShield,
  canTakeHeal,
  heal,
  canTakeShield,
  earnBonus,
  tally,
  eatFruit,
  createRunState,
  earnCoin,
  isRunOver,
  revive,
  runSeconds,
  speedAfter,
  stepRun,
  takeHit,
  type RunState,
} from '../run/runState'
import {
  createPlayerState,
  isOffRoad,
  jump,
  launch,
  playerScreenFraction,
  stepPlayer,
  type PlayerState,
} from '../run/playerMotion'
import { PlayerView } from '../run/PlayerView'
import { resolveSelectedSnail } from '../run/snailSkins'
import {
  createPlayerDeath,
  deathComplete,
  deathFlash,
  deathSpin,
  hasDied,
  hullBurstProgress,
  hullFade,
  hullSwell,
  startPlayerDeath,
  type PlayerDeath,
} from '../run/playerDeath'
import { THREAT_COLOR } from '../road/themes'
import { distanceIndexOf } from '../run/worldDepth'
import { isResumable, resolveSuspended, type SuspendedRun } from '../run/suspend'
import { flush, getState, mutate } from '../save/store'
import { earnCoins } from '../shop/coins'
import { createSquashState, squashAt, squashOnLanding, squashOnLaunch, type SquashState } from '../run/squash'
import { addFreeze, isFrozen, type Freezable } from '../run/hitstop'
import { hits, placeRunObstacles, type Body, type Obstacle } from '../run/obstacles'
import {
  awaitingAcknowledgement,
  createTutorialState,
  insideTutorialBand,
  stepTutorial,
  tutorialLayout,
  tutorialPaused,
  tutorialRunning,
  TUTORIAL_LENGTH_Z,
  type TutorialState,
} from '../run/tutorial'
import { TutorialCard } from '../run/TutorialCard'
import { ObstacleSprites } from '../run/ObstacleSprites'
import { CritterSprites } from '../run/CritterSprites'
import {
  createCritterField,
  resolveCritters,
  stepCritters,
  CRITTER_FIRST_Z,
  type CritterField,
} from '../run/critters'
import { reaches, type Pickup,
  type PickupKind,
  uselessKinds,
} from '../run/pickups'
import { ARC_RELAY_NEAR_Z, ARC_RELAY_Z, chainPoints, placeFormations } from '../run/formations'
import {
  placeRamps,
  RAMP_AIR_CONTROL,
  RAMP_DEPTH,
  RAMP_LAUNCH_V,
  RAMP_SPINS,
  rampIdStride,
  spinAngle,
  ridesOver,
  type Ramp,
} from '../run/ramp'
import { RampSprites } from '../run/RampSprites'
import { Dust } from '../run/Dust'
import { LapLayout, type LapContent } from '../run/lapLayout'
import {
  feverMagnet,
  magnetPull,
  type FeverPhase,
} from '../run/fever'
import { PickupSprites } from '../run/PickupSprites'
import { FeverView } from '../run/FeverView'
import { Hud } from '../run/Hud'
import { stepSlime, type SlimePoint } from '../run/slime'
import { SlimeTrail } from '../run/SlimeTrail'
import { createRng } from '../race/rng'
import {
  HITSTOP_MS,
  FEVER_MAGNET_RATE,
  FEVER_MAGNET_Z,
  CONTINUE_GRACE_Z,
  HIT_INVULNERABLE_Z,
  JUMP_LAUNCH_V,
  KEYBOARD_POINT_SPEED,
  LANDING_HITSTOP_MS,
  OBSTACLE_DEPTH,
  OFFROAD_DRAG,
  OFFROAD_LIMIT,
  PLAYER_HALF_WIDTHS,
  PLAYER_Z,
  steerTarget,
  SPEED_BASE,
} from '../run/constants'
import { DRAW_DISTANCE, SEGMENT_LENGTH } from '../road/constants'
import { PICKUP_DETUNE_CENTS, streakDetuneCents, STREAK_STEPS } from '../audio/sfx'
import { wrapZ } from '../road/project'
import { playSfx } from '../audio/audio'
import { SFX } from '../audio/sfx'
import {
  breakStreak,
  createStreak,
  boxGap,
  nearMissTier,
  scoreNearMiss,
  streakMultiplier,
  type StreakState,
} from '../run/nearMiss'
import { nearMissDetuneCents, nearMissGain } from '../audio/sfx'
import { critterMidpointCrossings, CRITTER_KINDS, type Critter } from '../run/critters'
import { CAMERA_DEPTH, ROAD_WIDTH } from '../road/constants'
import { applyTally, createTally, QUEST_KINDS, resolveQuestBoard } from '../run/quests'
import {
  announce,
  createPlaque,
  MILESTONE_COINS,
  milestoneCrossed,
  milestoneProgress,
  type Plaque,
} from '../run/rewards'
import { bodyBand } from '../run/obstacles'
import { feverSpeedFactor } from '../run/fever'

/**
 * One object the snail has just passed, and how closely.
 *
 * Buffered rather than scored on the spot because the unit being paid for is a *manoeuvre*: a row
 * cleared by one hop is one decision, and three payments for it would say otherwise. See
 * `settleManoeuvre`.
 */
interface PassedObject {
  object: { offsetX: number; halfWidths: number; yLow: number; yHigh: number }
  /** Clearance in road half-widths — lateral on the ground, vertical in the air. */
  gap: number
  /** How fast the two came together, as a multiple of the run's own speed. */
  closing: number
}

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
/**
 * The wreck's loud half: how hard the frame shakes, how much dust the crash throws, and how strongly
 * it flashes.
 *
 * **The flash is the reserved threat colour, and this is the one place in the runner that may use
 * it.** `THREAT_COLOR` means "something out there has landed on you", which is precisely what has
 * just happened — the same exemption the rail shooter's damage frame was granted. At 0.3 it tints
 * the frame rather than whiting it out, because what the player is being shown is the crash and not
 * the flash.
 *
 * The shake is the hardest in the game and three times a hit's: a hit is a cost, and this is the
 * end of the run.
 */
const DEATH_SHAKE_MS = 520
const DEATH_SHAKE = 0.022
const DEATH_DUST = 26
const DEATH_FLASH_ALPHA = 0.3

export class RunScene extends Phaser.Scene implements LeavableRun {
  private world!: WorldView
  private uiCamera!: Phaser.Cameras.Scene2D.Camera
  private run!: RunState
  private player!: PlayerState
  private playerView!: PlayerView
  private steering!: Steering
  /**
   * Where a relative drag has asked the snail to be, in half-widths. Unused in `absolute` mode.
   *
   * Held by the scene rather than by the binder because it is a *road* position and the binder
   * deals in screen fractions — the same split that keeps `bindSteering` free of the projection.
   */
  private relativeTarget = 0
  /** Which mode the previous frame steered in, so a switch can re-seed the relative request. */
  private steerModeWas: SteerMode = 'absolute'
  /** DEV only: what the steering actually did this run. See `steerProbe.ts`. */
  private steerProbe: SteerProbeState | null = null
  private squash!: SquashState
  private obstacles!: Obstacle[]
  private obstacleSprites!: ObstacleSprites
  /**
   * The bugs, which are a population rather than a layout.
   *
   * Deliberately not in `LapLayout` beside the obstacles, the pickups and the ramps: those are
   * filed under the segment they stand on and handed over behind the camera, and all three of those
   * properties are false of something that walks. See `critters.ts`.
   */
  private critters!: CritterField
  private critterSprites!: CritterSprites
  /** The player's own position on the run's unwrapped odometer at the end of the last frame. */
  private previousPlayerOdometer = 0
  /**
   * Everything standing on the ground, indexed by segment, and the cursor that rolls the next lap
   * into it **behind the camera** — see `lapLayout.ts` for the defect that shape exists to fix.
   *
   * **Indexed rather than walked flat**, which is what it always was: the renderer visits 300
   * segments a frame and the run holds a couple of thousand obstacles, so a flat walk would be
   * O(obstacles) per frame instead of O(what is on screen).
   */
  private lap!: LapLayout
  /**
   * Which lap each obstacle was last resolved against the snail on.
   *
   * The track is a closed loop the run goes round several times, so "already hit" cannot be a
   * boolean — it would disarm every obstacle for the rest of the run after one lap. Keyed by
   * obstacle id, holding the lap number, so each obstacle is live again next time round.
   */
  private resolvedOnLap!: Map<number, number>
  private pickupSprites!: PickupSprites
  private feverView!: FeverView
  private rampSprites!: RampSprites
  private dust!: Dust
  /**
   * Which ramps have already had their arc re-laid for the run's real speed — see `relayArcs`.
   *
   * **A `WeakSet` of the ramp objects rather than a set of ids**, because ids restart at zero every
   * lap and the handover replaces the objects: keyed by id, a lap-old entry would leave the next
   * lap's chain laid for whatever speed the last one had, and there is no longer a lap boundary at
   * which to clear it. Keyed by identity it clears itself.
   */
  private readonly arcRelaid = new WeakSet<Ramp>()
  private hud!: Hud
  /**
   * The slime trail's world-space points, and the ribbon that draws them.
   *
   * A plain array mutated in place by `stepSlime`, like `debris.ts`'s chunks — the rest of
   * `src/run/` is pure because the rest of it is state a scene replaces, and a pool is not.
   */
  private slime!: SlimePoint[]
  private slimeTrail!: SlimeTrail
  /** Where the snail was along the track last frame, for the swept collision test. */
  private previousPlayerZ = 0
  /**
   * How far the run must travel before the snail can be hit again — a **distance**, not a deadline.
   *
   * See `HIT_INVULNERABLE_Z`: as a duration this covered one whole row at `SPEED_CAP` and two under
   * a boost, so after any hit the next rows passed straight through.
   */
  private invulnerableUntilDistance = 0
  /**
   * How many of this run's coins the result screen has already paid into the save.
   *
   * **A continue means the run ends twice, and coins may only be banked once.** `RunOver` banks
   * what it is handed the moment it opens — before an ad or a scene change can lose them — so the
   * second panel has to be handed the coins taken *since* the first one, or every coin collected
   * before the crash is paid for a second time. `run.coins` stays the run's true total, because
   * that is what the HUD counts.
   */
  private bankedCoins = 0
  /**
   * The tutorial, when this is a first run. `null` once the player has been taught.
   *
   * **Resolved once, at `create`, from the save** — like the snail's skin and for the same reason:
   * `update` runs sixty times a second and the save is not a thing to consult at that rate.
   */
  private tutorial: TutorialState | null = null
  private tutorialCard: TutorialCard | null = null
  /** Total lateral travel, in road half-widths — the tutorial's own "have they steered yet". */
  private steered = 0
  /** How many times the player has left the ground this run. */
  private jumps = 0
  /**
   * How many times the player has asked a tutorial card to go away.
   *
   * **All three of these are cumulative and none of them is ever reset here.** A card is answered
   * by what has happened *since it came up*, and the baseline it measures against is taken by
   * `stepTutorial` when the card arms — so the rule lives in one place instead of being half a
   * counter here and half a comparison there. See `TutorialSignals`.
   */
  private acknowledgements = 0
  /** The reused body handed to `hits` — see `spinningBody`. */
  private readonly body: Body = { offsetX: 0, y: 0, spinDegrees: 0 }
  /**
   * The wreck between the last life going and the result screen arriving — see `playerDeath.ts`.
   *
   * A field on the scene rather than on `RunState` because nothing pure needs it: the run is over
   * the moment `isRunOver` says so, and this is only about how long the frame takes to admit it.
   */
  private death: PlayerDeath = createPlayerDeath()
  /** Full-frame flash on the killing hit. On `uiCamera`, so a camera shake cannot drag its edges in. */
  private deathFlashRect!: Phaser.GameObjects.Rectangle
  /** One number a whole run is reproducible from: the scenery scatter and the obstacle layout. */
  private runSeed = 0
  /** DEV only: labels every dark patch on the ground with what drew it. */
  private debugMarks: DebugMarks | null = null

  /**
   * DEV only: when each obstacle was first drawn at a readable alpha, and the budget that bought.
   *
   * **⚠ The reaction budget the game actually gives is measured at the moment of DRAWING, and
   * nothing was measuring that.** `verify:obstacles` checks the placer's row spacing against
   * `REACTION_MS` -- a statement about where obstacles are *put*, which is green whether or not
   * they are ever shown in time. What the player gets is the gap between the first frame a hazard
   * is legible and the frame it reaches them.
   */
  private reactionSeen: Map<number, number> | null = null
  private reactionSamples: { id: number; kind: string; ms: number; firstIndex: number; refused: boolean }[] = []
  private reactionRefused = new Set<number>()
  /** DEV only, and off unless `window.__marks.on()` asks for it. */
  private marksVisible = false
  /** How many times this run has been hit. Reported by the DEV hook; the HUD reads `run.lives`. */
  private hitCount = 0
  /** Coins taken in a row, for the rising collection tone. Reset by anything that is not a coin. */
  private streak = 0
  /**
   * The close-pass streak, and the manoeuvre currently being paid for.
   *
   * **One buffer rather than one event per object, because the unit being rewarded is a decision.**
   * A row of three rocks taken in one hop is one manoeuvre, not three; a row threaded on the ground
   * is one line, not two dodges. So passes are collected and settled together — at the end of the
   * frame while the snail is grounded, and on landing while it is not, which is exactly the moment
   * the manoeuvre stopped being revisable. See `nearMiss.ts`.
   */
  private nearMissStreak: StreakState = createStreak()
  private readonly passes: PassedObject[] = []
  private readonly crossedCritters: Critter[] = []
  private plaque: Plaque = createPlaque()
  /** When the current flight began, so a hop can be paid for what it committed. `-1` on the ground. */
  private flightStartedAt = -1
  /**
   * The player's own hitstop deadline — `hitstop.ts`'s `Freezable`, on the snail and nothing else.
   *
   * **Never `timeScale`, never a global pause.** The ground has to keep moving through a landing:
   * a world that stopped would read as a dropped frame, where a snail that stops for 45ms while
   * the road keeps going reads as weight. Same rule the rail shooter's per-entity hitstop had, and
   * the module is the same one.
   */
  private playerFreeze!: Freezable
  /**
   * Whether this run was resumed from a snapshot, for the DEV report and for one rule: a resumed
   * run may not be a tutorial run, because the tutorial is what refuses to be suspended.
   */
  private resumed = false
  /** `uselessNow`'s memo: the answer, and the two facts it was computed from. */
  private uselessCache: ReadonlySet<PickupKind> | null = null
  private uselessHeal = false
  private uselessShield = false
  constructor() {
    super('RunScene')
  }

  create() {
    // **Read once, here, never per frame.** The run is not a place to consult the save sixty times a
    // second — the same rule the skin and the ship are resolved under.
    const saved = getState()
    // **A run the player put down, or `null`.** `resolveSuspended` never trusts what is stored and
    // refuses anything that is not a run rather than repairing one into existence — see
    // `suspend.ts`. Refused, this is a fresh run, which is exactly what the player asked for by
    // pressing a button that says Play.
    const resume = saved.tutorialDone ? resolveSuspended(saved.suspendedRun) : null

    this.resumed = resume !== null
    this.run = resume?.run ?? createRunState()
    this.player = resume?.player ?? createPlayerState()
    this.squash = createSquashState()
    this.playerFreeze = { frozenUntil: 0 }
    // **⚠ Before the world and before `LapLayout`, because that constructor builds lap 0 inside
    // itself.** Created where the rest of the scene's views are — after the world, beside the HUD —
    // this was still `null` when `buildLap(0)` ran, so a tutorial run was dealt the ordinary
    // generated road and the cards explained a wall that was not there. Found by driving a real run
    // and reading the lap back: a wall at 26m against a tutorial band whose first object is a rock
    // at 260m. The *card* is built later, where a view belongs; only the state is hoisted.
    if (!getState().tutorialDone) this.tutorial = createTutorialState()
    this.resolvedOnLap = new Map()
    this.slime = []
    this.invulnerableUntilDistance = resume?.invulnerableUntilDistance ?? 0
    // **Carried across a suspend, because a suspend BANKS.** Without it, resuming and then ending
    // would pay the same coins into the save twice — see `suspend.ts`.
    this.bankedCoins = resume?.bankedCoins ?? 0
    this.death = createPlayerDeath()
    this.hitCount = 0
    this.streak = 0
    this.nearMissStreak = createStreak()
    this.plaque = createPlaque()
    this.passes.length = 0
    this.flightStartedAt = -1

    // The ground, the scenery, the sky and the camera that rides through them — all of it in
    // `WorldView`, which `MainMenu` builds the same way. Two scenes drawing the same world from
    // one class cannot disagree about the horizon, the palette or the fog.
    //
    // **The circuit is `buildRunCircuit()`'s, unchanged and unrandomised**, and that is a decision
    // rather than a default: it is the one lap measured against the sightline floor (`verify:road`
    // sweeps every point of it), and a per-run random circuit would be an unverified one. Variety
    // across runs comes from the scenery seed and from the eight biomes the lap already cycles
    // through, neither of which can produce a corner you cannot see round.
    // **The seed comes back with a resumed run**, because the road is a pure function of it: the
    // obstacles, the pickups, the ramps, the scenery and the bugs are all derived, so restoring one
    // number restores the whole lap the player was in the middle of. That is the entire reason the
    // snapshot does not have to carry a road.
    this.runSeed = resume?.seed ?? Math.floor(Math.random() * 0xffff)
    this.world = new WorldView(this, { speed: SPEED_BASE, decorSeed: this.runSeed })

    // The obstacles, laid along the finished track and *proved passable* before they are used —
    // see `obstacles.ts`. Seeded from the same draw as the scenery so a run is reproducible from
    // one number.
    this.lap = new LapLayout({
      trackLength: this.world.trackLength,
      segmentCount: this.world.track.length,
      build: (lapOffset) => this.buildLap(lapOffset),
      // **The lap the run is on, not its distance**, or the first `advance` would walk every
      // segment of every lap in between and build a layout at each boundary — see `startLap`.
      startLap: Math.floor(this.run.distance / this.world.trackLength),
    })
    // **Seeded from where the run actually is**, so the first frame of a resumed run sweeps the
    // few units it really travelled rather than the whole distance from the start line — which
    // would resolve every obstacle on the lap in one frame.
    this.previousPlayerZ = wrapZ(this.run.z + PLAYER_Z, this.world.trackLength)
    this.previousPlayerOdometer = this.run.distance + PLAYER_Z
    // **A first run meets no bugs until it has been taught the road.** The tutorial owns the first
    // `TUTORIAL_LENGTH_Z` and its cards stop the world one at a time; a creature walking into a
    // frozen frame while a card explains something else is two things at once, which is the whole
    // objection that made the cards stop the road in the first place. Its own seed, so moving a tree
    // does not rearrange the bugs — the rule `waveSeed` and `pickupSeed` already state.
    this.critters = createCritterField(
      this.runSeed ^ 0x1b0d,
      this.tutorial ? TUTORIAL_LENGTH_Z + CRITTER_FIRST_Z : CRITTER_FIRST_Z,
    )

    // Built after the world, because they draw over it and the display list is the draw order.
    // The trail goes first of the three: it lies *on* the road, under everything standing on it.
    this.slimeTrail = new SlimeTrail(this)
    this.obstacleSprites = new ObstacleSprites(this)
    this.critterSprites = new CritterSprites(this)
    this.pickupSprites = new PickupSprites(this)
    this.feverView = new FeverView(this)
    this.rampSprites = new RampSprites(this)
    this.dust = new Dust(this, this.runSeed)
    // The skin is resolved once, here, rather than read per frame: `render` runs sixty times a
    // second and the save is not a thing to consult at that rate. `resolveSelectedSnail` never
    // trusts the stored id — a save can outlive a skin and can be edited by hand.
    this.playerView = new PlayerView(this, {
      skin: resolveSelectedSnail(getState().selectedSnail, getState().purchases),
      // Resolved once here, never per frame, for the same reason the skin is — and through
    })
    // Screen-space, so it goes on `uiCamera` and is hidden from the world camera.
    this.hud = new Hud(this)

    // **The first run teaches itself, and it is the same run.** No second scene and no mode to
    // leave: what a tutorial run has is a hand-placed opening stretch and a card, and when the last
    // card clears it carries straight on into the ordinary placer. See `run/tutorial.ts`. The state
    // was made at the top of `create` — the lap is built from it; this is only the card.
    if (this.tutorial) this.tutorialCard = new TutorialCard(this)
    // **The flash lives on `uiCamera` for the reason the rail shooter's damage frame did**: a
    // full-bleed rectangle drawn on a camera that is shaking drags its own edges into view, showing
    // black gaps at exactly the busiest moment. Sized in `renderWreck`; invisible until then.
    this.deathFlashRect = this.add
      .rectangle(0, 0, 1, 1, THREAT_COLOR)
      .setAlpha(0)
      .setDepth(HUD_DEPTH + 1)

    // World/UI split per CLAUDE.md "Responsive Layout". Nothing screen-space exists yet; the
    // snail is a *world* object and belongs on `cameras.main` with the road.
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    this.uiCamera.ignore(this.worldObjects())
    this.cameras.main.ignore([
      ...this.hud.gameObjects,
      ...this.feverView.gameObjects,
      ...(this.tutorialCard?.gameObjects ?? []),
      this.deathFlashRect,
    ])

    if (import.meta.env.DEV) {
      // A static import inside a DEV branch, not a gated call: gating the *call* leaves the module
      // in the bundle, which is the finding `perfReport.ts` exists for.
      this.debugMarks = new DebugMarks(this, HUD_DEPTH - 1)
      this.reactionSeen = new Map()
      const reactionHook = window as unknown as { __reaction?: { samples(): unknown[]; reset(): void } }

      reactionHook.__reaction = {
        samples: () => this.reactionSamples.slice(),
        reset: () => { this.reactionSamples.length = 0; this.reactionSeen?.clear(); this.reactionRefused.clear() },
      }
      this.cameras.main.ignore(this.debugMarks.gameObjects)

      // **The steering instrument and the panel that changes what it is measuring.** Both DEV-only
      // and both `window.__*`-shaped for the reason `__marks` and `__adGate` are: a module imported
      // from an injected script is a different instance, so the only way to reach the live one is a
      // hook the game itself installed. `check-bundle.mjs` greps for the name.
      this.steerProbe = createSteerProbe()

      const steerHook = window as unknown as {
        __steer?: {
          preset(name: SteerPresetName): void
          mode(mode: 'absolute' | 'relative'): void
          set(overrides: object): void
          get(): object
          report(): object
          reset(): void
        }
      }

      steerHook.__steer = {
        preset: (name) => { applySteerPreset(name) },
        mode: (mode) => { setSteerTuning({ mode }) },
        set: (overrides) => { setSteerTuning(overrides) },
        get: () => ({ ...getSteerTuning(), preset: steerPresetName() }),
        report: () => (this.steerProbe ? steerReport(this.steerProbe, PLAYER_HALF_WIDTHS) : {}),
        reset: () => { this.steerProbe = createSteerProbe() },
      }

      // Live, without stopping: three presets on 1/2/3 and the mode on M, so the same stretch of
      // road can be driven under two springs a few seconds apart. The panel is for the values in
      // between and has to pause the run -- see `SteerTuner` for why a slider cannot share a screen
      // with a control that reads `pointer.x`.
      bindAction(this, 'steer-viscous', { keys: ['ONE'] }, () => applySteerPreset('viscous'))
      bindAction(this, 'steer-current', { keys: ['TWO'] }, () => applySteerPreset('current'))
      bindAction(this, 'steer-snappy', { keys: ['THREE'] }, () => applySteerPreset('snappy'))
      bindAction(this, 'steer-mode', { keys: ['M'] }, () =>
        setSteerTuning({ mode: getSteerTuning().mode === 'absolute' ? 'relative' : 'absolute' }),
      )
      bindAction(this, 'steer-panel', { keys: ['T'] }, () => launchOverlay(this, 'SteerTuner'))
      // **⚠ Off unless asked for.** It shipped on, and a diagnostic that labels every mark in the
      // frame is unreadable to look past -- it was reported the first time it was seen. A dev
      // overlay defaults to silent; this is the same `window.__*` hook shape `__adGate` and
      // `__getRecentErrors` use, and `check-bundle.mjs` greps for the name so "we gated it" and
      // "it is gone" stay separate claims.
      const w = window as unknown as { __marks?: { on(): void; off(): void; isOn(): boolean } }
      const scene = this

      w.__marks = {
        on: () => { scene.marksVisible = true },
        off: () => { scene.marksVisible = false },
        isOn: () => scene.marksVisible,
      }
    }

    // Steering is an *absolute* axis — a runner steers to a place, not in a direction — so it is
    // `bindSteering` rather than `bindHeldAction`. See `platform/input.ts` for why that shape had
    // to exist and why reading `activePointer` at this call site would not do.
    this.steering = bindSteering(this, 'steer', {
      leftKeys: ['LEFT', 'A'],
      rightKeys: ['RIGHT', 'D'],
      keyboardSpeed: KEYBOARD_POINT_SPEED,
    })

    // **A press anywhere jumps on a mouse; a tap anywhere jumps on a finger.** They share the
    // pointer with steering and do not conflict, and the two devices resolve that differently:
    // a mouse steers by hovering, so its button is free and the jump fires on the press like the
    // space bar does; a finger steers by being held, so only a press-and-release inside
    // `TAP_SLOP_PX` is a jump rather than a dodge. See `screenTap` for the latency that firing
    // both on the release cost. On a keyboard they are separate keys and the question does not
    // arise.
    bindAction(this, 'jump', { keys: ['SPACE', 'UP', 'W'], screenTap: true }, () => this.tryJump())

    // **⚠ This used to be ESC and nothing else, and it threw the run away.** Two defects in one
    // line: on a phone there was no way out of a run at all, and the way out a keyboard had went
    // straight to the menu — so the coins collected, the quest progress and the distance were all
    // lost, because `endRun` is the only place any of that is banked.
    //
    // **⚠ And then it left immediately, which is a control with no undo behind it.** Firing on the
    // tap rather than the press is a real guard against a *steer* that begins on the glyph, and it
    // is no guard at all against a deliberate press the player regrets in the next quarter second —
    // reported as exactly that. It opens `RunPause` now: the road stops dead (`launchOverlay`
    // pauses this scene, so the clock, the placer, the collisions and the critters all freeze) and
    // the dialog says what leaving does before it does it. See `RunPause` for why the safe answer
    // is the solid button and the leaving one is muted.
    //
    // **On the tap for the same reason it always was**: the gesture the player makes constantly is
    // a drag across the frame, and a press that begins on the glyph and goes somewhere is a press
    // they changed their mind about. Same rule as the shop rows and the quest board's collect.
    bindAction(this, 'close', { pointer: this.hud.exitTarget, keys: ['ESC'], tap: true }, () =>
      launchOverlay(this, 'RunPause', { run: this } satisfies RunPauseData),
    )

    bindLayout(this, (width, height) => this.layout(width, height))

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.playerView.destroy()
      this.slimeTrail.destroy()
      this.obstacleSprites.destroy()
      this.critterSprites.destroy()
      this.pickupSprites.destroy()
      this.feverView.destroy()
      this.rampSprites.destroy()
      this.dust.destroy()
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
      obstacles: () => this.lap.liveObstacles().length,
      critters: () =>
        this.critters.critters.map((critter) => ({
          id: critter.id,
          kind: critter.kind,
          ahead: critter.z - (this.run.distance + PLAYER_Z),
          offsetX: critter.offsetX,
        })),
      crittersDrawn: () => ({ used: this.critterSprites.usedLastFrame, wanted: this.critterSprites.wantedLastFrame }),
      slime: () => ({ points: this.slime.length, quads: this.slimeTrail.usedLastFrame }),
      drawn: () => ({ used: this.obstacleSprites.usedLastFrame, wanted: this.obstacleSprites.wantedLastFrame }),
      hits: () => this.hitCount,
      invulnerable: () => this.isInvulnerable(),
    }
  }

  /**
   * A missed `ignore()` draws the object twice — once per camera, at different transforms — which
   * on a road that is mostly one colour looks like a rendering artefact rather than a wiring
   * mistake. Cheap to check once at start-up, impossible to spot by eye later.
   */
  private assertWorldIsSingleCamera(): void {
    // **⚠ This walked `worldObjects()` and was therefore blind to the one mistake it exists to
    // catch.** An object missing from that list is not ignored by either camera and is drawn twice —
    // and checking the list can only ever confirm that the things *in* it were handled. A flyer's
    // wings were absent for four rounds, drawn a second time by `uiCamera` on top of the whole
    // frame, and this guard reported nothing every single time.
    //
    // What it asks now is the property rather than the bookkeeping: **is anything on this scene's
    // display list drawn by both cameras?** An object belongs to exactly one of them, so a
    // `cameraFilter` carrying neither camera's id is the defect, whatever list it was left out of.
    // **⚠ And it walks the pools as well as the list, now that a slot off duty is off the list.**
    // `pooled.ts` takes an unused slot out of the display list entirely — which is what makes the
    // property still true (an object on no list is drawn by neither camera) and would make a guard
    // that runs once at create blind to a pool, since every slot starts hidden. The union is as
    // strong as the list alone was: an object a pool forgot to list is also one it never hides, so
    // it stays on the display list for good — which is the half that cannot be opted out of.
    const seen = new Set<Phaser.GameObjects.GameObject>([...this.children.list, ...this.worldObjects()])
    const both = [...seen].filter(
      (object) =>
        (object.cameraFilter & this.uiCamera.id) === 0 && (object.cameraFilter & this.cameras.main.id) === 0,
    )

    if (both.length > 0) {
      const names = both.slice(0, 6).map((object) => object.type + (object.name ? `:${object.name}` : ''))

      console.warn(
        `[run] ${both.length} object(s) are ignored by neither camera and will be drawn twice: ${names.join(', ')}`,
      )
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
  /**
   * Which pickup kinds the run currently has no room for.
   *
   * **Memoised on the two facts it is a function of**, because it is asked three times a frame and
   * allocates a `Set` each time — for an answer that changes when a life or a shield does, i.e. a
   * few times a run. The renderer takes it every frame to decide what to draw dimmed, so the
   * allocation was per frame and permanent; the pair of booleans is what actually moves.
   */
  private uselessNow(): ReadonlySet<PickupKind> {
    const canHeal = canTakeHeal(this.run)
    const canShield = canTakeShield(this.run)

    if (this.uselessCache === null || this.uselessHeal !== canHeal || this.uselessShield !== canShield) {
      this.uselessHeal = canHeal
      this.uselessShield = canShield
      this.uselessCache = uselessKinds({ canHeal, canShield })
    }

    return this.uselessCache
  }

  private resolveObstacles(fromZ: number, toZ: number, lap: number, now: number): void {
    if (this.isInvulnerable()) return

    // Only the segments the sweep actually touched, through the same index the renderer uses. The
    // alternative — walking the run's whole obstacle list every frame — is a couple of thousand
    // comparisons per frame to find the two or three that can possibly matter.
    const first = Math.floor(fromZ / SEGMENT_LENGTH) - 1
    const last = Math.floor(toZ / SEGMENT_LENGTH)
    const segmentCount = this.world.track.length

    for (let index = first; index <= last; index++) {
      const here = this.lap.obstacles.get(((index % segmentCount) + segmentCount) % segmentCount)

      if (!here) continue

      for (const obstacle of here) {
        if (this.resolvedOnLap.get(obstacle.id) === lap) continue

        // Not there yet.
        if (toZ < obstacle.z) continue

        // **Past it. Only now is it settled** — see below for why it is not settled before that.
        if (fromZ > obstacle.z + OBSTACLE_DEPTH) {
          this.resolvedOnLap.set(obstacle.id, lap)
          continue
        }

        // **The instant of the pass, which is the instant the reward is about.** The two are
        // closest in `z` at the obstacle's own midpoint, so that is where the clearance is read
        // rather than at the near edge (where the player has not arrived) or at settling (where
        // they have already moved on). Swept over the frame's travel so a dropped frame cannot step
        // over it. See `nearMiss.ts`.
        const middle = obstacle.z + OBSTACLE_DEPTH / 2

        if (fromZ <= middle && middle < toZ) this.notePass(obstacle, 1)

        // **⚠ Inside it, so it is tested again every frame until it is behind us.** The first
        // version marked an obstacle resolved on the frame the sweep first *touched* its near edge
        // and never looked again — one instant, at the moment of contact. But an obstacle is 200
        // units deep, which is 55ms of crossing at the cap, and the snail can slide sideways into
        // it during that. Measured by driving deliberately into 28 rows: four of them registered
        // nothing at all with the snail visibly inside the rock.
        //
        // Being inside it at *any* point while passing is what the player sees, so that is what the
        // test is now.
        if (!hits(this.spinningBody(), obstacle)) continue

        this.resolvedOnLap.set(obstacle.id, lap)
        this.takeHit(now)

        return
      }
    }
  }

  /**
   * Walks the bugs and settles any the player ran into.
   *
   * **The step runs whether or not the player can be hit; only the resolve is guarded.** Grace after
   * a hit is a promise about damage, not about the world — a bug that stopped walking for a quarter
   * of a second because the snail was blinking would be the one object in the frame that reacts to
   * the player's invulnerability, which is a thing the player can see and cannot explain.
   *
   * A bug costs exactly what a rock costs. It is deliberately not worse: the punishment in this game
   * is denominated in speed and lives, and a hazard with its own private penalty would be a second
   * economy for the player to learn. What makes a critter different is that it comes to you.
   */
  private resolveCritterHits(playerOdometer: number, deltaMs: number, now: number): void {
    if (this.isInvulnerable()) return

    // Scored before the hit is resolved, because a critter that struck is settled by that call and
    // would then be invisible here — and a pass the player did not make must not pay.
    for (const critter of critterMidpointCrossings(
      this.critters,
      this.previousPlayerOdometer,
      playerOdometer,
      deltaMs,
      this.crossedCritters,
    )) {
      // **The one place the closing ratio is not 1.** A bug walks at the player, so the same gap is
      // a shorter escape by exactly this much — see `URGENCY_CAP`.
      const closing = (this.run.speed + CRITTER_KINDS[critter.kind].speed) / Math.max(1, this.run.speed)

      this.notePass(critter, closing)
    }

    const struck = resolveCritters(
      this.critters,
      this.spinningBody(),
      this.previousPlayerOdometer,
      playerOdometer,
      deltaMs,
    )

    if (struck) this.takeHit(now)
  }

  /**
   * Builds one lap's contents, at the difficulty the run has reached by then.
   *
   * **Whole-lap generation, delivered a segment at a time.** The row spacing, the passability proof
   * and `sideAwayFrom` all reason about a lap as a unit, so this has to build one; what may not
   * happen is the *delivery* landing on road the player is looking at — see `lapLayout.ts` for the
   * 69 obstacle slots that used to change in view every time the run wrapped.
   */
  private buildLap(lapOffset: number): LapContent {
    const obstacles = placeRunObstacles(this.runSeed, this.world.trackLength, lapOffset)

    if (this.tutorial && lapOffset === 0) return this.buildTutorialLap(obstacles)

    // **Ramps before pickups, because a ramp is where an arc chain goes.** `formations.ts` will not
    // lay an `arc` anywhere else — an arc over flat road is a chain hanging in the air.
    const ramps = placeRamps(this.runSeed ^ 0x2a17, this.world.trackLength, lapOffset, obstacles)
    // Laid *after* the obstacles and against them — see `sideAwayFrom`. A pickup in the gap the
    // player was already threading costs nothing, and a pickup that costs nothing is scenery.
    const pickups = placeFormations({
      rng: createRng((this.runSeed ^ 0x5eed) + Math.round(lapOffset / SEGMENT_LENGTH)),
      fromZ: lapOffset === 0 ? SEGMENT_LENGTH * 20 : 0,
      toZ: this.world.trackLength,
      trackLength: this.world.trackLength,
      obstacles,
      launches: ramps.map((ramp) => ({ id: ramp.id, z: ramp.z, offsetX: ramp.offsetX, launchV: RAMP_LAUNCH_V })),
    })

    return { obstacles, pickups, ramps }
  }

  /**
   * The first lap of a first run: the tutorial's own opening stretch, then the ordinary road.
   *
   * **The generated layout is filtered rather than shortened**, because the placers reason about a
   * lap as a unit — the row spacing, the passability proof and `sideAwayFrom` all do — and asking
   * them for "a lap starting at 450 segments" would be asking for a different thing than the lap
   * they were written to produce. Dropping what falls inside the band leaves the rest exactly as it
   * would have been, which is what makes the handover seamless: the road past `TUTORIAL_LENGTH_Z`
   * is the road this run was always going to have.
   *
   * Ids continue from the generated set rather than restarting, because `RunScene.resolvedOnLap` is
   * keyed by id and two obstacles sharing one are one obstacle to the collision — the defect that
   * once left two thirds of a lap unable to hit the player.
   */
  private buildTutorialLap(generated: readonly Obstacle[]): LapContent {
    const past = <T extends { z: number }>(items: readonly T[]): T[] =>
      items.filter((item) => !insideTutorialBand(item.z))
    const arcsAndPast = (items: readonly Pickup[]): Pickup[] =>
      items.filter((item) => item.arcOf !== undefined || !insideTutorialBand(item.z))

    let nextId = generated.reduce((highest, obstacle) => Math.max(highest, obstacle.id), 0) + 1
    let nextPickupId = 1
    const taught = tutorialLayout(
      () => nextId++,
      () => nextPickupId++,
      // The top of lap 0's ramp block, which the generator provably cannot reach — see
      // `rampIdStride` for the cross-lap collision that rule exists to prevent.
      rampIdStride(this.world.trackLength) - 1,
    )

    const obstacles = [...taught.obstacles, ...past(generated)]
    const ramps = [...taught.ramps, ...past(placeRamps(this.runSeed ^ 0x2a17, this.world.trackLength, 0, obstacles))]
    const pickups = [
      ...taught.pickups,
      // **⚠ An arc is filtered by its LAUNCH, never by the band, and filtering it by the band left
      // the tutorial's own ramp with no coins on it.** `past` drops what the generator laid inside
      // the tutorial's stretch — which is right for a chain, because a chain belongs to a piece of
      // road, and wrong for an arc, because an arc belongs to a *ramp*. The tutorial's ramp sits at
      // 810m inside a 900m band, so its whole chain was dropped and the card promising "the coins
      // are laid along the flight you are about to take" pointed at an empty sky. Every launch in
      // the list is either the tutorial's own or already past the band, so keeping all the arcs
      // cannot keep one that should have gone.
      ...arcsAndPast(
        placeFormations({
          rng: createRng(this.runSeed ^ 0x5eed),
          fromZ: TUTORIAL_LENGTH_Z,
          toZ: this.world.trackLength,
          trackLength: this.world.trackLength,
          obstacles,
          launches: ramps.map((ramp) => ({
            id: ramp.id,
            z: ramp.z,
            offsetX: ramp.offsetX,
            launchV: RAMP_LAUNCH_V,
          })),
        }),
      ),
    ]

    return { obstacles, pickups, ramps }
  }



  /**
   * Buffers one thing the snail has just gone past, for `settleManoeuvre` to pay for.
   *
   * **The unit being rewarded is a decision, not an object.** A row of three cleared by one hop is
   * one hop, so passes are collected here and settled together — see `settleManoeuvre` for the two
   * moments that happens at and why they differ.
   *
   * **⚠ The axis is not chosen here any more, and choosing it is what broke ramps.** This used to
   * read lateral on the ground and vertical in the air — so a flight was graded on its height over
   * an obstacle it may have been three lanes away from, and one obstacle crossed low on the ascent
   * refused the whole manoeuvre. `boxGap` measures the distance between the two boxes instead and
   * the axis falls out of it; see its own note for the measurement.
   *
   * The band is the body's own rather than its feet, so a tumble off a ramp is graded on the
   * rectangle it is actually drawn in — see `bodyBand`.
   *
   * Nothing needs an invulnerability guard here: both callers return before this while the player
   * cannot be hit, because a pass that costs nothing is not a pass the player made.
   */
  private notePass(object: { offsetX: number; halfWidths: number; yLow: number; yHigh: number }, closing: number): void {
    const band = bodyBand({
      offsetX: this.player.offsetX,
      y: this.player.y,
      spinDegrees: spinAngle(this.player),
    })
    // One `offsetX` unit is `ROAD_WIDTH` world units, which is what puts the two axes in the same
    // units as `NEAR_MISS_GAP`.
    const gap = boxGap({ offsetX: this.player.offsetX, low: band.low, high: band.high }, object, ROAD_WIDTH)

    this.passes.push({ object, gap, closing })
  }

  /**
   * Settles the manoeuvre the buffered passes belong to, and pays for it once.
   *
   * **Called at the end of a grounded frame and on landing, and the difference is the design.** A
   * steer is revisable up to the last instant, so it settles as soon as the row is behind; a flight
   * is not revisable at all once it has begun, so everything it clears belongs to the single
   * decision that started it — which is what makes "one hop over three things" a rung of its own
   * rather than three payments.
   */
  private settleManoeuvre(now: number, width: number): void {
    if (this.passes.length === 0) return

    // The tightest of them is what the manoeuvre is graded on: clearing three things by a mile and
    // one by a hair is a hair-thin decision, and the mile is what the other two were worth.
    let gap = Infinity
    let closing = 1

    for (const pass of this.passes) {
      gap = Math.min(gap, pass.gap)
      closing = Math.max(closing, pass.closing)
    }

    const count = this.passes.length
    const airControl = this.player.grounded ? 1 : this.player.airControl
    const commitmentMs = this.flightStartedAt >= 0 ? Math.max(0, now - this.flightStartedAt) : 0

    this.passes.length = 0

    const scored = scoreNearMiss(
      gap,
      closing,
      commitmentMs,
      count,
      feverSpeedFactor(this.run.fever),
      this.nearMissStreak,
      this.run.distance,
      airControl,
    )

    if (!scored) return

    this.nearMissStreak = scored.streak
    this.run = tally(earnBonus(this.run, scored.miss.points), 'nearMiss')

    const tier = nearMissTier(scored.miss)
    // **One plaque, updated, never a queue of them.** A streak on a dense stretch fires several
    // times a second, and a plaque per reward fills the strip the road is read through. See
    // `rewards.ts`.
    const announced = announce(this.plaque, scored.miss.points, tier, streakMultiplier(this.nearMissStreak.count), now)

    this.plaque = announced.plaque
    this.hud.announce(this.plaque)

    // **The sound is the feedback, not the number.** At this moment the player is looking at the
    // road: a pitch can say which manoeuvre and how far into a streak without moving their eyes.
    playSfx(SFX.NEAR_MISS, {
      detune: nearMissDetuneCents(tier, this.nearMissStreak.count - 1),
      volume: nearMissGain(tier),
    })
    void width
  }

  /**
   * Collects anything the snail passed through this frame.
   *
   * Swept over the same interval as the obstacles and for the same reason. A pickup is *taken*
   * rather than resolved-per-lap: it is gone for the rest of the run, which is what makes a stretch
   * the player has already cleared feel cleared.
   */
  private collectPickups(fromZ: number, toZ: number): void {
    const useless = this.uselessNow()
    const first = Math.floor(fromZ / SEGMENT_LENGTH) - 1
    const last = Math.floor(toZ / SEGMENT_LENGTH)
    const segmentCount = this.world.track.length

    for (let index = first; index <= last; index++) {
      const here = this.lap.pickups.get(((index % segmentCount) + segmentCount) % segmentCount)

      if (!here) continue

      for (const pickup of here) {
        if (pickup.taken || toZ < pickup.z || fromZ > pickup.z + SEGMENT_LENGTH) continue
        // **A pickup the run has no room for is passed through, not consumed** — it is drawn
        // dimmed and stays on the road. See `UNAVAILABLE_ALPHA` for why it is no longer deleted
        // 600m ahead instead, and `uselessKinds` for the two kinds this can be true of.
        if (useless.has(pickup.kind)) continue
        if (!reaches(this.player, pickup)) continue

        pickup.taken = true
        if (pickup.kind === 'fruit') {
          this.run = tally(eatFruit(this.run), 'fruit')
          // One of the three moments the mascot looks back — see `lookBack.ts`. The event glances
          // are the half that matters: a purely periodic one is a tic, and these land at the exact
          // moments the player is already watching the snail rather than the road.
          this.playerView.glance(this.time.now)
        }
        else if (pickup.kind === 'shield') this.run = addShield(this.run)
        else if (pickup.kind === 'heal') this.run = heal(this.run)
        else this.run = earnCoin(this.run)
        // The streak ladder: each coin in a row sounds one interval higher, so the player can hear
        // how many they have taken without looking away from the road. Reset by a gap.
        playSfx(pickup.kind === 'coin' ? SFX.STREAK : SFX.PICKUP, { detune: this.streakDetune(pickup.kind) })
      }
    }
  }

  /**
   * Reacts to Fever changing phase — and the middle branch is the one that keeps the player alive.
   *
   * **The road is cleared when the ease *begins*, not when the guard comes off**, and the two are a
   * second apart. Clearing at the moment of vulnerability would delete rocks from directly in front
   * of a snail the player is looking at; clearing a second earlier does the same removal while the
   * screen is still washed and the wake is still up, so what the player sees is the Fever sweeping
   * the road rather than the road forgetting itself.
   */
  private onFeverPhase(before: FeverPhase, after: FeverPhase): void {
    if (before === after) return

    if (before === 'idle') {
      // The one sound in the vocabulary that already meant "you just got faster" — it was the
      // boost pickup's, and Fever is what became of that.
      playSfx(SFX.BOOST)
      this.playerView.glance(this.time.now)
      // **Counted on entry, not on the gauge filling.** Filling it is arithmetic on fruit already
      // counted by its own quest; *entering* is the event the player experiences, and counting both
      // would pay one action twice.
      this.run = tally(this.run, 'fever')

      return
    }

  }

  /**
   * Drags pickups inside the magnet window onto the snail's line.
   *
   * **It moves the pickup rather than widening the collection box**, which is the whole difference
   * between a magnet and a bigger invisible catchment: the player watches the coins come to them,
   * and `reaches` still does the collecting, so there is one rule for what counts as touching
   * something. The move is permanent — a pickup that was pulled halfway when the Fever ended has
   * genuinely moved, which is the honest outcome and costs nothing, since the placer relays the lap
   * anyway.
   *
   * The rate is exponential in the frame delta rather than linear, so a dropped frame pulls the
   * same distance as the two frames it replaced.
   */
  private pullPickups(playerZ: number, delta: number): void {
    const rate = 1 - Math.exp((-FEVER_MAGNET_RATE * delta) / 1000)

    const useless = this.uselessNow()

    for (const pickup of this.lap.livePickups()) {
      // **The magnet does not drag something the run cannot take.** Pulling a greyed medkit onto
      // the snail's line would be the game offering what it is about to refuse.
      if (pickup.taken || useless.has(pickup.kind)) continue

      const ahead = wrapZ(pickup.z - playerZ, this.world.trackLength)

      if (ahead > FEVER_MAGNET_Z) continue

      pickup.offsetX += (this.player.offsetX - pickup.offsetX) * rate * magnetPull(ahead)
    }
  }

  /**
   * Launches the snail off any ramp it rode onto this frame.
   *
   * Swept over the same interval as the obstacles and the pickups, and for the same reason: at top
   * speed a frame covers 96 world units against a ramp one segment deep, so a point test works
   * until the frame a phone drops. Not keyed per lap — a ramp is not consumed, and riding the same
   * one next lap is riding it again.
   */
  private resolveRamps(fromZ: number, toZ: number): void {
    if (!this.player.grounded) return

    const first = Math.floor(fromZ / SEGMENT_LENGTH) - 1
    const last = Math.floor(toZ / SEGMENT_LENGTH)
    const segmentCount = this.world.track.length

    for (let index = first; index <= last; index++) {
      const here = this.lap.ramps.get(((index % segmentCount) + segmentCount) % segmentCount)

      if (!here) continue

      for (const ramp of here) {
        if (toZ < ramp.z || fromZ > ramp.z + RAMP_DEPTH) continue
        if (!ridesOver(this.player, ramp)) continue

        this.player = launch(this.player, RAMP_LAUNCH_V, RAMP_SPINS, RAMP_AIR_CONTROL)
        this.run = tally(this.run, 'ramp')
        // The chain is laid for the speed this flight is actually flown at, which is knowable here
        // and nowhere earlier. See `layArc`.
        this.layArc(ramp, this.run.speed)
        squashOnLaunch(this.squash, this.time.now)
        playSfx(SFX.JUMP, { detune: -400 })

        return
      }
    }
  }

  /**
   * Re-lays a ramp's arc chain for the speed the run is actually doing, once, on approach.
   *
   * **⚠ An arc in world space is a function of the run speed, and the placer cannot know it.** The
   * heights come from the flight solver and are right in *time*; the positions those heights sit at
   * are `speed * t`. `verify:formations` measured what that costs: a chain laid at `SPEED_CAP` is
   * collected 5 of 5 at the cap, 3 of 5 at Fever speed and **0 of 5** at the speed a run starts at.
   *
   * The two ways out are pinning the horizontal speed through the flight — which would make the
   * ramp overrule the run's whole speed economy for a second — or laying the chain from the real
   * speed. This is the second. It happens `ARC_RELAY_Z` out, where the speed is within a couple of
   * percent of what it will be at the ramp (`SPEED_ACCEL` has a 5.9-second time constant, and this
   * is under two seconds of road), and the chain is far enough away that nothing is seen moving.
   *
   * Once per ramp per lap: re-laying every frame would keep sliding a chain the player is already
   * lining up on.
   */
  private relayArcs(playerZ: number): void {
    for (const ramp of this.lap.liveRamps()) {
      const ahead = wrapZ(ramp.z - playerZ, this.world.trackLength)

      // **Only while it is far enough away that nothing is seen moving.** Inside this the chain is
      // left alone: the player is lining up on it, and coins sliding under an approach are worse
      // than coins laid for a speed a second out of date. The launch itself puts it right — see
      // `layArc`.
      if (ahead > ARC_RELAY_Z || ahead < ARC_RELAY_NEAR_Z) continue

      // **⚠ And once, which is what `arcRelaid` is for — it was declared, documented and never
      // read.** Without it this ran every frame for the whole 50-segment band, and the run is
      // accelerating the entire time it is in there, so the chain slid continuously under a player
      // who was watching it. The band is 40 to 90 segments out against a road drawn 300 ahead: all
      // of it is in view, so "far enough away that nothing is seen moving" was never true of the
      // band, only of its far edge. Reported as coins changing position with the speed.
      if (this.arcRelaid.has(ramp)) continue

      this.arcRelaid.add(ramp)
      // **And laid for the speed the ramp will be reached at, not the speed here.** The run
      // accelerates over the 90 segments in between, so the current speed builds a chain that is
      // already short by the time the player launches off it — 4.8 segments of tail at the speed a
      // run starts at, corrected at the launch, in view. See `speedAfter`.
      this.layArc(ramp, speedAfter(this.run.speed, ahead))
    }
  }

  /**
   * Lays one ramp's arc for a given speed.
   *
   * **⚠ An arc in world space is a function of the run speed, and no placer can know it.** The
   * heights come from the flight solver and are right in *time*; the positions those heights sit at
   * are `speed * t`. `verify:formations` measured what the mismatch costs: a chain laid at
   * `SPEED_CAP` is collected 5 of 5 at the cap, **3 of 5 at Fever speed and 0 of 5 at the speed a
   * run starts at**. Reported as coins not always being collected off a ramp, with Fever correctly
   * guessed as the reason — a Fever entered between the approach and the ramp changes the speed by
   * 60% and nothing had re-laid the chain.
   *
   * So it is laid twice: once on the approach, far enough out that the shift is invisible, and once
   * **at the moment of launch**, where the speed is known exactly rather than predicted. The chain
   * belongs to the flight it is collected in, and that is the only instant that flight is a fact.
   */
  private layArc(ramp: Ramp, speed: number): void {
    // **`arcOf` is a ramp id, and it has to be unique across LAPS rather than within one.** The
    // handover keeps two laps' contents on the ground at all times, so this filter sees both — and
    // while ramp ids restarted at zero every lap it matched the next lap's ramp of the same id as
    // well. Every one of a lap's six ramps collided, turning a 5-coin chain into a 10-coin one and
    // teleporting five coins in from elsewhere on the track. See `rampIdStride`.
    const mine = this.lap.livePickups().filter((pickup) => pickup.arcOf === ramp.id)

    if (mine.length === 0) return

    const points = chainPoints({
      kind: 'arc',
      pickup: 'coin',
      count: mine.length,
      fromZ: ramp.z,
      offsetX: ramp.offsetX,
      launchV: RAMP_LAUNCH_V,
      speed,
    })

    for (let i = 0; i < mine.length; i++) {
      this.lap.movePickup(mine[i], wrapZ(points[i].z, this.world.trackLength), points[i].offsetX, points[i].y)
    }
  }

  /**
   * Moves one pickup and keeps the segment index it is filed under in step.
   *
   * The index is what both the collection sweep and the sprite pool walk, so a pickup moved without
   * it is a pickup that is drawn in one place and collected in another — the same class of defect
   * as `formations.ts`'s own clamp-after-check.
   */
  private movePickup(pickup: Pickup, z: number, offsetX: number, y: number): void {
    const count = this.world.track.length
    const from = Math.floor(pickup.z / SEGMENT_LENGTH) % count
    const to = Math.floor(z / SEGMENT_LENGTH) % count

    if (from !== to) {
      const bucket = this.lap.pickups.get(from)

      if (bucket) {
        const at = bucket.indexOf(pickup)

        if (at >= 0) bucket.splice(at, 1)
      }

      const target = this.lap.pickups.get(to)

      if (target) target.push(pickup)
      else this.lap.pickups.set(to, [pickup])
    }

    pickup.z = z
    pickup.offsetX = offsetX
    pickup.y = y
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

      // **A fruit and a shield are different pickups and now sound like it.** They were both a flat
      // zero, under a comment claiming they were "the same sample at three pitches" — see
      // `PICKUP_DETUNE_CENTS`, which is where the interval and its reasoning live.
      return PICKUP_DETUNE_CENTS[kind] ?? 0
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
    // **The reset is the whole reason the streak is worth holding.** A multiplier that survived
    // damage would make a close pass a free upside on top of a mistake. Anything buffered goes with
    // it: a manoeuvre that ended in a hit was not a manoeuvre that came off.
    this.nearMissStreak = breakStreak()
    this.passes.length = 0
    this.invulnerableUntilDistance = this.run.distance + HIT_INVULNERABLE_Z
    addFreeze(this.playerFreeze, now, HITSTOP_MS)
    // **Asked before the hit is applied, because the hit is what spends it.** `takeHit` returns a
    // new state with the shield already gone, so a shield that absorbed something is only knowable
    // from the state that went in.
    const absorbed = this.run.shields > 0

    // The whole penalty is one call into the pure module — speed, shields and lives together, so
    // there is no half-applied state a scene could leave behind.
    this.run = takeHit(this.run)

    // **⚠ An absorbed hit used to look and sound exactly like an expensive one**: the same shake,
    // the same impact, the same blink. A shield's entire product is that the next mistake is free,
    // and a free mistake that is presented as a costly one has not been made free anywhere the
    // player can check. So the two branch — see `shield.ts` for the three cues and why they are
    // three. The speed still goes either way, which is the rule `takeHit` states: a shield is spent
    // instead of a *life*, never instead of the speed.
    if (absorbed) {
      this.playerView.popShield(now)
      this.cameras.main.shake(120, 0.004)
      playSfx(SFX.SHIELD_BREAK)
    } else {
      this.cameras.main.shake(180, 0.008)
      playSfx(SFX.HIT)
    }

    if (isRunOver(this.run)) this.crash(now)
  }

  /**
   * The last hit: the run stops, the snail comes apart, and only then does the panel arrive.
   *
   * **⚠ This used to be `endRun()` on the same frame** — `scene.pause()` and the result panel over a
   * snail mid-stride on a road still scrolling. Every other death in this game is drawn; the one the
   * player cares about was the only one that was not, which is exactly the defect `playerDeath.ts`
   * was written for in the rail shooter and then inherited unused.
   *
   * **The sound moved here from `RunOver.create`.** It belongs to the crash, not to the screen that
   * turns up a second later reporting it.
   */
  private crash(now: number): void {
    if (!startPlayerDeath(this.death, now)) return

    // A crash stops you. The world freezes because `update` stops stepping the run at all while the
    // wreck plays — see its guards — and this is what the frozen frame shows.
    this.cameras.main.shake(DEATH_SHAKE_MS, DEATH_SHAKE)
    // Twice a landing's puff, thrown from the snail's own feet — the point the road's projection
    // already put there this frame, so it cannot disagree with the shadow about where the ground is.
    this.dust.burst(this.playerView.groundX, this.playerView.groundY, now, this.scale.width, DEATH_DUST)
    this.dust.burst(this.playerView.groundX, this.playerView.groundY, now + 1, this.scale.width, DEATH_DUST)
    playSfx(SFX.RUN_OVER)
  }

  /**
   * Draws the wreck, and ends the run when it has finished.
   *
   * Applied *after* `PlayerView.render`, which sets the sprite's alpha and angle from the blink and
   * the spin every frame — so the wreck has to be the last word on both or it would be overwritten
   * on the next one.
   */
  private renderWreck(now: number, width: number, height: number): void {
    const progress = hullBurstProgress(this.death, now)

    this.playerView.sprite.setAlpha(hullFade(progress))
    this.playerView.sprite.setScale(
      this.playerView.sprite.scaleX * hullSwell(progress),
      this.playerView.sprite.scaleY * hullSwell(progress),
    )
    this.playerView.sprite.setAngle(deathSpin(progress))
    // The mark on the ground goes with the thing that was standing on it.
    this.playerView.shadow.setVisible(false)

    this.deathFlashRect
      .setPosition(width / 2, height / 2)
      .setSize(width, height)
      .setAlpha(deathFlash(this.death, now) * DEATH_FLASH_ALPHA)

    if (deathComplete(this.death, now)) this.endRun()
  }

  /**
   * The snail as the collision model wants it: its lane, its height, and **how far it is turned**.
   *
   * A reused object rather than a spread, because this is asked once per obstacle per frame and the
   * frame it matters on is the one with a wall on it. `spinAngle` is 0 for an ordinary jump, so
   * outside a ramp flight this is the state it always was — see `bodyBand`.
   */
  private spinningBody(): Body {
    this.body.offsetX = this.player.offsetX
    this.body.y = this.player.y
    this.body.spinDegrees = spinAngle(this.player)

    return this.body
  }

  /**
   * Whether the snail can be hit at all.
   *
   * **One source, and it is the grace after a hit** — a **distance** rather than a duration, see
   * `HIT_INVULNERABLE_Z`: what it exists for is the rest of the row you just hit, because a wall is
   * eight rocks and being charged eight times for one mistake is not a difficulty setting.
   *
   * **⚠ There were two, and Fever's was reported as a bug twice.** A Fever switched the hitbox off
   * for six seconds plus its landing, so a large share of every lap's obstacles passed through the
   * snail doing nothing — which is exactly how it was described. It is gone; see `fever.ts` for why
   * being hittable at Fever speed is safe by construction rather than by luck.
   */
  private isInvulnerable(): boolean {
    // A wrecked snail cannot be hit again — and saying so here rather than in a second place is what
    // stops a rock arriving during the wreck from taking a life the run no longer has.
    return hasDied(this.death) || this.run.distance < this.invulnerableUntilDistance
  }

  /**
   * Ends the run and hands over to the result screen.
   *
   * **Paused, not stopped.** The result panel is drawn over a frozen road rather than over black:
   * the world is what the player was just in, and cutting to an empty background makes the run
   * feel deleted rather than finished. Same overlay shape as `Settings` and `Shop`.
   */
  /**
   * DEV only: the reaction budget each obstacle actually bought, in milliseconds.
   *
   * **Measured between two events the player experiences**, not between two numbers in the model:
   * the first frame the hazard is drawn at an alpha worth calling visible, and the frame it
   * reaches the snail. Every obstacle the run passes yields a sample whether or not it was hit --
   * the question is what the player was given, and a clean dodge is the same measurement as a
   * collision. Read through `window.__reaction`.
   */
  private recordReaction(time: number): void {
    const seen = this.reactionSeen

    if (!seen) return

    for (const id of this.obstacleSprites.refusedIds) this.reactionRefused.add(id)

    // **Alpha, not merely "was placed".** A sprite fading up at the draw distance is on screen and
    // is not yet something a player can act on; `BILLBOARD_FADE_IN_FRACTION` spends the far 28% of
    // the draw distance getting there. Half opacity is the threshold used here, and it is stated
    // rather than assumed so it can be argued with.
    for (const drawn of this.obstacleSprites.drawnIds) {
      if (drawn.alpha >= 0.5 && !seen.has(drawn.id)) seen.set(drawn.id, time)
    }

    // The moment each obstacle reaches the snail. Every one is passed exactly once per lap, and
    // the sample is taken on the crossing rather than on a hit.
    const playerZ = wrapZ(this.run.z + PLAYER_Z, this.world.trackLength)
    const previous = this.previousPlayerZ

    for (const obstacle of this.lap.liveObstacles()) {
      const crossed = previous <= playerZ
        ? obstacle.z > previous && obstacle.z <= playerZ
        : obstacle.z > previous || obstacle.z <= playerZ

      if (!crossed) continue

      const first = seen.get(obstacle.id)

      this.reactionSamples.push({
        id: obstacle.id,
        kind: obstacle.kind,
        ms: first === undefined ? 0 : time - first,
        firstIndex: -1,
        refused: this.reactionRefused.has(obstacle.id),
      })
      seen.delete(obstacle.id)
      this.reactionRefused.delete(obstacle.id)
    }
  }

  /**
   * Ends the run and hands over to the result panel.
   *
   * `quit` is the player having asked to leave rather than the road having ended it, and the only
   * thing that turns on it is the rewarded continue: a continue offered on a run the player chose
   * to end is an ad attached to nothing, which is the exact shape `canOfferContinue` exists to
   * refuse. Everything else — the coins, the quests, a cleared stage — is banked identically,
   * because what was earned was earned however the run stopped.
   */
  private endRun(quit = false): void {
    const coins = this.run.coins - this.bankedCoins

    this.bankedCoins = this.run.coins
    // **The board is advanced once, here, rather than per event.** A quest advanced as each fruit
    // is taken is a save write per fruit; and the board is only ever read on the front screen,
    // which is also the only place a finished quest can be claimed. See `quests.ts`.
    this.bankQuestProgress()
    // **A run that ends is a run there is nothing to continue.** Cleared here rather than on the
    // panel: the panel is where the player is *told*, and a run whose panel never opened — a
    // platform pause, a reload — must not leave a snapshot the front screen would offer to resume.
    this.clearSuspended()
    launchOverlay(this, 'RunOver', { distance: this.run.distance, coins, bonus: this.run.bonus, run: this, quit })
  }

  /**
   * Puts the run down: banks what it has earned, writes the rest into the save, and goes home.
   *
   * **⚠ It banks, and that is what makes putting a run down safe rather than a gamble.** A snapshot
   * that held the coins would mean a player who suspends and later starts a new run has silently
   * thrown away everything the old one earned — and finds out afterwards. Banking here and carrying
   * `bankedCoins` into the snapshot means abandoning a suspended run costs nothing already earned;
   * what it costs is the distance, which is the thing they were in the middle of.
   *
   * **The scene is stopped, not paused.** `MainMenu` builds a `WorldView` of its own and two worlds
   * may never be alive at once — the `glTexture` crash this project has now diagnosed from five
   * directions. That is the whole reason the run comes back as a value rather than as a scene.
   */
  /**
   * Whether leaving would put this run down rather than end it — `RunPause`'s one question.
   *
   * **⚠ Except during the tutorial, which ends instead.** Its cards are a hand-placed 900m stretch
   * taught in an order that does not survive being interrupted — the same argument that used to
   * gate the stage mode behind it. So a tutorial run leaves the way every run used to: banked,
   * ended, and the panel over it. The dialog reads this to say which of the two is about to happen;
   * it does not branch on it, because which one is the run's business and not the dialog's.
   */
  isSuspendable(): boolean {
    return this.tutorial === null
  }

  /** The decision `RunPause` hands back. Both doors bank; only one of them keeps the road. */
  leaveRun(): void {
    if (this.isSuspendable()) this.suspend()
    else this.endRun(true)
  }

  private suspend(): void {
    const coins = this.run.coins - this.bankedCoins
    const snapshot: SuspendedRun = {
      seed: this.runSeed,
      run: this.run,
      player: this.player,
      bankedCoins: this.run.coins,
      invulnerableUntilDistance: this.invulnerableUntilDistance,
    }

    this.bankedCoins = this.run.coins
    this.bankQuestProgress()
    mutate((state) => {
      state.coins = earnCoins(state.coins, coins)
      state.suspendedRun = isResumable(snapshot) ? snapshot : null
    })
    // Flushed rather than left to the debounce: the next thing that happens to this tab may be the
    // platform killing it, and a suspended run that did not reach the disk is a run thrown away by
    // the one gesture that exists to keep it. `bindAutosave` covers the pause; this covers the tap.
    void flush()
    this.scene.start('MainMenu')
  }

  /** Forgets a suspended run. Called wherever a run stops being one. */
  private clearSuspended(): void {
    if (getState().suspendedRun === null) return

    mutate((state) => {
      state.suspendedRun = null
    })
  }

  /**
   * Puts the player back on the road they crashed on. Called by `RunOver`, once, after a rewarded ad.
   *
   * **The run is resumed, not restarted, and that is only possible because it was never stopped.**
   * `endRun` *pauses* this scene and launches the panel over it — which is the arrangement that
   * made `Menu` hang the game once, and is the arrangement that makes a continue nearly free: every
   * lap, every pool, the layout cursor, the tutorial's place and the fixed step's own remainder are
   * still sitting exactly where the crash left them. Nothing here rebuilds a thing.
   *
   * What has to be undone is only what the death did: the flag that ended the run (`revive`), the
   * wreck's own state, and the frame the wreck was tinting. The sprite needs no repair — `render`
   * writes its size, angle and alpha from scratch every frame, so the swell and the fade are gone
   * on the first frame after this.
   *
   * **The grace is the part that makes the offer honest.** The snail comes back on the piece of
   * road that killed it, at the speed it was doing, with the rest of that row still standing — see
   * `CONTINUE_GRACE_Z`. Resuming without it would sell the player a continue and spend it before
   * they could touch the controls.
   */
  /**
   * Whether `continueRun` would do anything — the question `RunOver` has to ask before it stops
   * itself. See `ContinuableRun.canContinue` for what it costs to skip it.
   */
  canContinue(): boolean {
    return isRunOver(this.run)
  }

  continueRun(): void {
    // **The guard is not paranoia: the panel stays interactive while its ad plays.** `RunOver` is an
    // `OVERLAY_SCENES` member, so nothing pauses it — a player who presses `Again` (or SPACE) while
    // the ad is in flight restarts this scene, and the reward then arrives for a run that no longer
    // exists. A restarted run is not over, so this is where that lands.
    if (!isRunOver(this.run)) return

    this.run = revive(this.run)
    this.death = createPlayerDeath()
    this.deathFlashRect.setAlpha(0)
    this.invulnerableUntilDistance = this.run.distance + CONTINUE_GRACE_Z
    this.scene.resume()
  }

  /**
   * Leaves the ground, if the snail is on it.
   *
   * The sound and the stretch are triggered here rather than by watching `grounded` flip, because
   * a launch is a thing the *player* did: reacting to the state change would also fire on any
   * future launch the game itself causes (a bounce, a ramp), which wants a different sound.
   */
  private tryJump(): void {
    // **⚠ The same press is "continue" and "jump", and only this scene can tell them apart.** A
    // `read` card is answered by acknowledging it, and the natural thing to press is the one that
    // is already bound to the only other verb in the game — so while one is up the press is spent
    // on the card and the snail does not hop. On the `jump` card it is the opposite: the jump *is*
    // the answer, so this branch does not fire and the ordinary path below satisfies it.
    if (this.tutorial && awaitingAcknowledgement(this.tutorial, this.run.distance)) {
      this.acknowledgements += 1

      return
    }

    if (!this.player.grounded) return

    this.player = jump(this.player)
    this.jumps += 1
    squashOnLaunch(this.squash, this.time.now)
    playSfx(SFX.JUMP)
  }

  /**
   * Advances the tutorial and redraws its card.
   *
   * **The flag is written the moment the last card clears, not at the end of the run.** A player who
   * has been taught has been taught, and a run that ends in a crash before the results screen is
   * still a run they learned from — banking it at `endRun` would teach the same lesson twice to
   * anyone whose first attempt was a short one.
   */
  private updateTutorial(now: number): void {
    if (!this.tutorial || !this.tutorialCard) return

    this.tutorial = stepTutorial(this.tutorial, {
      distance: this.run.distance,
      steered: this.steered,
      jumps: this.jumps,
      acknowledgements: this.acknowledgements,
      now,
    })
    // The card asks the HUD where the readout it names actually is — see `Hud.highlightRect`.
    this.tutorialCard.setHudBottom(this.hud.blockBottom)
    this.tutorialCard.update(this.tutorial, this.run.distance, now, (target) => this.hud.highlightRect(target))

    if (tutorialRunning(this.tutorial)) return

    this.tutorial = null
    this.tutorialCard.destroy()
    this.tutorialCard = null
    mutate((state) => {
      state.tutorialDone = true
    })
  }

  /**
   * Folds this run's tallies into the saved quest board.
   *
   * **Idempotent by construction**, because a run can end more than once: `RunOver` is launched over
   * a *paused* scene and `Again` resumes it, so `endRun` runs again on the next death. The tally is
   * cleared as it is banked, so a second call adds nothing.
   */
  private bankQuestProgress(): void {
    const banked = this.run.tally

    this.run = { ...this.run, tally: createTally() }

    if (QUEST_KINDS.every((kind) => banked[kind] === 0)) return

    mutate((state) => {
      state.quests = applyTally(resolveQuestBoard(state.quests, this.runSeed), banked)
    })
  }

  /** Everything that belongs to `cameras.main` and must be hidden from `uiCamera`. */
  private worldObjects(): Phaser.GameObjects.GameObject[] {
    return [
      ...this.world.gameObjects,
      this.slimeTrail.gameObject,
      ...this.obstacleSprites.gameObjects,
      ...this.critterSprites.gameObjects,
      ...this.pickupSprites.gameObjects,
      ...this.rampSprites.gameObjects,
      ...this.dust.gameObjects,
      ...this.playerView.gameObjects,
    ]
  }

  layout(width: number, height: number): void {
    // cameras.main is deliberately left alone — no zoom, no centerOn. The road's own projection
    // is the camera model; a Phaser zoom on top of it would fight the horizon.
    this.uiCamera.setViewport(0, 0, width, height)
    this.world.layout(width, height)
    this.hud.layout(width, height)
    this.tutorialCard?.layout(width, height)
  }

  update(time: number, delta: number): void {
    const width = this.scale.width
    const height = this.scale.height

    // **The snail is stepped before the run, and the run reads the result.** Leaving the road
    // costs speed, so the drag this frame has to be about where the snail is *now* — stepping the
    // run first would charge the verge a frame late, which at top speed is a whole segment.
    // **Everything that advances the run is skipped while the wreck plays.** The road stops, the
    // snail stops steering, nothing new can be collected or hit, and the frame keeps drawing — which
    // is the whole effect: a crash that stops you, held long enough to read, before the panel.
    const dying = hasDied(this.death)
    // **A tutorial card stops the road and leaves the snail alone.** Everything that advances the
    // *run* is skipped while one is up and unanswered — the same set of skips the wreck uses, and
    // for a related reason: the player is being asked to take in one thing, and a road arriving
    // underneath it is the other thing. `stepPlayer` deliberately keeps running, because performing
    // the control is how the two `act` cards are answered. See `tutorialPaused`.
    const taught = this.tutorial !== null && tutorialPaused(this.tutorial, this.run.distance)
    const frozen = dying || taught
    const steer = this.steering.read(delta)
    const wasAirborne = !this.player.grounded

    // **The snail is frozen; the world is not.** A landing takes 45ms out of the creature and
    // nothing else, so the road keeps scrolling underneath it — which is what reads as weight
    // rather than as a stutter. `stepPlayer` is simply not called, so its accumulator does not
    // advance either and the frame it thaws on is a clean one.
    if (!dying && !isFrozen(this.playerFreeze, time)) {
      const wasAt = this.player.offsetX
      const tuning = getSteerTuning()

      // **The two modes differ in what the thumb's movement *means*, and nothing else.** Absolute
      // hands the column straight to the spring, which is the shipped scheme; relative integrates
      // the movement into a request the thumb pushes around, so the frame's size drops out of the
      // placement error. See `steerTuning.ts` for the measurement that made this worth having a
      // switch for, and note that the spring underneath is the same either way.
      if (tuning.mode === 'relative') {
        // **⚠ Switching mode mid-press has to re-seed the request, or the first delta is applied to
        // a stale one.** `relativeTarget` is only maintained while relative is the live mode, so a
        // switch with a finger already down would push from wherever the request happened to be
        // left — measured live, a 60px push moved the snail most of the way across the road.
        if (this.steerModeWas !== 'relative') this.relativeTarget = this.player.offsetX

        if (steer.active) {
          this.relativeTarget = Math.min(
            OFFROAD_LIMIT,
            Math.max(-OFFROAD_LIMIT, relativeTarget(this.relativeTarget, steer.deltaFraction, tuning.sensitivity)),
          )
        } else {
          // Letting go holds the line, and the request has to be put back on the snail or the next
          // press would push from wherever the thumb had left it. Same rule as `targetFor`.
          this.relativeTarget = this.player.offsetX
        }
      }
      this.steerModeWas = tuning.mode

      this.player = stepPlayer(
        this.player,
        tuning.mode === 'relative'
          ? { targetOffsetX: this.relativeTarget, active: steer.active }
          : { targetFraction: steer.targetFraction, active: steer.active },
        delta,
        { stiffness: tuning.stiffness, damping: tuning.damping },
      )
      // DEV only: what the finger asked for against what the snail did. See `steerProbe.ts`.
      if (this.steerProbe) {
        const want =
          tuning.mode === 'relative' ? this.relativeTarget : steerTarget(steer.targetFraction)
        const scaleAtLane = CAMERA_DEPTH / PLAYER_Z
        const perHalfWidth = (scaleAtLane * ROAD_WIDTH * this.scale.width) / 4

        stepSteerProbe(this.steerProbe, {
          want,
          active: steer.active,
          at: this.player.offsetX,
          gapPx: Math.abs(want - this.player.offsetX) * perHalfWidth,
          snailHalf: PLAYER_HALF_WIDTHS,
          now: time,
        })
      }
      // **Total travel, not a position reached** — a player who has pushed the snail across the road
      // and back has learned the control, and one whose finger started at the edge has not. The
      // tutorial's first card is the only thing that reads it. See `TUTORIAL_STEER_UNITS`.
      this.steered += Math.abs(this.player.offsetX - wasAt)
    }

    // **Collisions before the draw and after the step**, so a hit is resolved against the frame
    // the player actually saw. The snail's own z is the camera's plus the constant it lives at.
    const playerZ = wrapZ(this.run.z + PLAYER_Z, this.world.trackLength)
    const lap = Math.floor((this.run.distance + PLAYER_Z) / this.world.trackLength)

    // **The next lap is handed over a segment at a time, behind the camera.** Never at the wrap:
    // the road is drawn 300 segments ahead of a 1434-segment lap, so a whole-lap swap rewrote a
    // fifth of what the player was looking at. See `lapLayout.ts`.
    this.lap.advance(this.run.distance)

    if (frozen) {
      // Nothing to resolve and nothing to hand over: the run is not moving.
    } else if (playerZ >= this.previousPlayerZ) {
      this.resolveRamps(this.previousPlayerZ, playerZ)
      this.collectPickups(this.previousPlayerZ, playerZ)
      this.resolveObstacles(this.previousPlayerZ, playerZ, lap, time)
    } else {
      // The frame crossed the loop seam. Two calls rather than one wrapped comparison: the second
      // is a different lap, and an obstacle straddling the seam must be live in both.
      this.resolveRamps(this.previousPlayerZ, this.world.trackLength)
      this.resolveRamps(0, playerZ)
      this.collectPickups(this.previousPlayerZ, this.world.trackLength)
      this.collectPickups(0, playerZ)
      this.resolveObstacles(this.previousPlayerZ, this.world.trackLength, lap - 1, time)
      this.resolveObstacles(0, playerZ, lap, time)
    }
    // **A milestone IS the biome change**, so it is detected from the biome index rather than from
    // a counter of its own — two ladders would drift the moment the lap length or the biome count
    // moved, and the player would be told they had arrived somewhere the world did not change.
    if (!frozen && milestoneCrossed(this.previousPlayerZ, playerZ, this.world.track.length)) {
      for (let i = 0; i < MILESTONE_COINS; i++) this.run = earnCoin(this.run)
      this.hud.markMilestone(time)
      playSfx(SFX.MILESTONE)
    }

    this.previousPlayerZ = playerZ

    // **The flight settles on landing, the ground settles every frame.** A hop is one decision from
    // launch to touchdown; a steer is revisable to the last instant, so its row is paid for as soon
    // as it is behind. See `settleManoeuvre`.
    if (this.player.grounded) this.settleManoeuvre(time, width)

    if (!wasAirborne && !this.player.grounded) this.flightStartedAt = time
    if (this.player.grounded) this.flightStartedAt = -1

    if (wasAirborne && this.player.grounded) {
      squashOnLanding(this.squash, time)
      if (this.player.flightSpins > 0) this.playerView.glance(time)
      addFreeze(this.playerFreeze, time, LANDING_HITSTOP_MS)
      playSfx(SFX.LAND)
      // The puff is thrown from where the snail was *drawn* last frame — its own feet on screen,
      // which is the only place a landing can be. `PlayerView` keeps that point because it is the
      // one that already went through the road's projection.
      this.dust.burst(this.playerView.groundX, this.playerView.groundY, time, width)
    }
    const feverWas = this.run.fever.phase

    if (!frozen) {
      this.run = stepRun(this.run, delta, {
        trackLength: this.world.trackLength,
        drag: isOffRoad(this.player.offsetX) ? OFFROAD_DRAG : 0,
      })
    }
    this.onFeverPhase(feverWas, this.run.fever.phase)
    // **The bugs walk after the run has, and against the position it just reached.** They are the one
    // thing in the frame moving under their own power, so their step and the collision that follows
    // it are a self-contained pair over the interval the player actually covered this frame — see
    // `critters.ts` for why that interval is measured on the odometer rather than in track space.
    if (!frozen) {
      const playerOdometer = this.run.distance + PLAYER_Z

      stepCritters(this.critters, playerOdometer, delta)
      this.resolveCritterHits(playerOdometer, delta, time)
      this.previousPlayerOdometer = playerOdometer
    }
    // **The magnet runs after the step and before the draw**, so a pickup is pulled and then drawn
    // where it was pulled to. Doing it after the draw would put the sprite one frame behind the
    // position the collection test is using, which at Fever speed is a whole blob's width.
    if (feverMagnet(this.run.fever)) this.pullPickups(playerZ, delta)
    this.relayArcs(playerZ)

    // **The world is told where the camera is, not how fast to go.** `WorldView.advance` integrates
    // a speed of its own, which is right for the menu (it rides on a script) and wrong here: the
    // run already integrated the same quantity, under a fixed timestep, and letting the world
    // integrate it again over the raw frame delta would give two answers to "how far have we come"
    // — with the score reading one of them and the road drawing the other.
    // **Laid before the world is drawn and from the snail's *current* line**, so the newest blob
    // is under the snail this frame rather than one frame behind it — at top speed a frame is 60
    // world units, which is a whole blob's spacing.
    if (!frozen) {
      stepSlime(this.slime, this.run.distance, this.run.z, this.player.offsetX, this.run.speed, this.world.trackLength)
    }

    this.world.setSpeed(0)
    this.world.cameraZ = this.run.z
    // Still called, with the real delta and a zero speed: `advance` also eases the camera's lean,
    // and that easing is dt-corrected — handing it a zero delta would freeze the lean instead of
    // leaving it alone. What it follows is the snail's own screen fraction, converted from its
    // road position rather than read off the sprite: the sprite is a frame behind by the time
    // this runs, and the lean is what decides where the sprite goes.
    this.world.advance(delta, playerScreenFraction(this.player.offsetX))
    this.world.render(width, height)
    // After the world, before everything that stands on the road: it reads this frame's segment
    // projections out of the mesh pass exactly as the sprite pools do.
    this.slimeTrail.render(this.slime, this.world.track, this.world.baseIndex, this.run.z, width)
    this.rampSprites.render(
      this.lap.ramps,
      this.world.track,
      this.world.baseIndex,
      this.world.clipY,
      width,
      height,
    )
    this.obstacleSprites.render(
      this.lap.obstacles,
      this.world.track,
      this.world.baseIndex,
      this.world.clipY,
      width,
      height,
    )
    // `run.z` is exactly `wrapZ(run.distance)` — `stepRun` derives one from the other — so the two
    // camera positions handed over here cannot disagree about where the camera is.
    this.critterSprites.render(
      this.critters.critters,
      this.run.distance,
      this.run.z,
      this.world.track,
      this.world.baseIndex,
      this.world.clipY,
      width,
      height,
      this.time.now,
      this.lap.liveObstacles(),
      this.world.track.length * SEGMENT_LENGTH,
    )
    this.pickupSprites.render(
      this.lap.pickups,
      this.world.track,
      this.world.baseIndex,
      this.world.clipY,
      width,
      height,
      time,
      this.uselessNow(),
    )
    if (import.meta.env.DEV && this.reactionSeen) this.recordReaction(time)

    // **No anchor, and that is the fix rather than a simplification.** The HUD used to be handed the
    // mascot's projected head so the fruit gauge could ride above it — which put the gauge on the
    // vanishing point, because the snail is drawn just under it. See `ui/fruitGauge.ts`.
    this.hud.update(
      this.run,
      width,
      time,
      milestoneProgress(this.run.z, this.world.track.length),
      this.playerView.drawnBox,
    )
    this.updateTutorial(time)
    this.feverView.update(this.run.fever, delta, width, height)
    this.dust.update(time, delta, height)

    if (import.meta.env.DEV && this.debugMarks && !this.marksVisible) {
      // Cleared once when it is switched off, or the last labelled frame stays on screen.
      this.debugMarks.update([], [], [])
    } else if (import.meta.env.DEV && this.debugMarks) {
      // **The orphan test, which is the whole point of the overlay.** A shadow whose owner is not
      // in the live list is a pool that has outlived its objects; a shadow whose owner IS live is
      // working correctly, and the patch beside it is somebody else's.
      const liveObstacles = new Set(this.lap.liveObstacles().map((o) => `${o.kind}#${o.id}`))
      const livePickups = new Set(this.lap.livePickups().map((p) => `pickup#${p.id}`))
      const shadows = [
        ...this.obstacleSprites.shadowMarks.map((m) => ({ ...m, live: liveObstacles.has(m.owner) })),
        ...this.pickupSprites.shadowMarks.map((m) => ({ ...m, live: livePickups.has(m.owner) })),
      ]

      this.debugMarks.update(
        this.world.decalMesh.drawnMarks.map((m) => ({ x: m.x, y: m.y, label: `decal:${m.kind}` })),
        [
          ...shadows.filter((m) => m.live).map((m) => ({ x: m.x, y: m.y, label: `shadow of ${m.owner}` })),
          { x: this.playerView.shadow.x, y: this.playerView.shadow.y, label: 'shadow of snail' },
        ],
        shadows.filter((m) => !m.live).map((m) => ({ x: m.x, y: m.y, label: `ORPHAN ${m.owner}` })),
      )
    }
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
      this.run.distance,
      { invulnerable: this.isInvulnerable(), now: time, shields: this.run.shields },
    )
    // **Asked again here rather than reusing `dying` from the top of the frame.** The killing hit
    // happens *inside* this update, in `resolveObstacles`, so the flag captured before it is false
    // on the very frame the snail crashes — which left the first frame of the wreck showing the
    // invulnerability blink instead of a solid snail, and the flash at zero on the one frame it
    // exists to be loudest. The guards above still use the captured value, because what they skip
    // has already run by then.
    if (hasDied(this.death)) this.renderWreck(time, width, height)
  }
}

