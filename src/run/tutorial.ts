/**
 * The first run, which teaches itself.
 *
 * **Show and do, on the real road — not a slideshow and not a separate mode.** The game has seven
 * things a player has to know (steer, jump, what a wall means, what cannot be jumped at all, what
 * fruit is for, what a shield does, what a ramp is for) and until now it had no way of saying any
 * of them. A player who does not know that `blocking` cannot be jumped learns it by dying, and a
 * player who does not know the leaf is a Fever gauge never finds out at all.
 *
 * The design has three rules, and each of them is a decision that could have gone the other way:
 *
 * 1. **The tutorial IS the first run.** Not a mode with its own scene, its own loop and its own way
 *    out — those are two games to keep working, and the second one is the one nobody tests. What is
 *    different about a tutorial run is the first four hundred segments of its layout and a card in
 *    the frame; everything else is the game, and when the last card clears the run carries straight
 *    on into the ordinary placer with no seam and nothing to dismiss.
 * 2. **⚠ A card stops the road, and this reverses what shipped first.** The first version explained
 *    things while the run kept moving, on the argument that a runner which stops to explain itself
 *    has stopped being a runner. That is a good argument about a *game* and the wrong one about a
 *    *first minute*: it asks the player to read a sentence, understand it and act on it while the
 *    thing it is about is already arriving, which is three jobs at once for somebody who has none
 *    of them yet. So the run freezes on every card and starts again when it is answered — show,
 *    then do, then go.
 *
 *    **The snail is not frozen with it**, and that is the half that makes this teach anything. The
 *    world stops; `stepPlayer` does not. So the two control lessons are performed *inside* their
 *    own pause, with nothing coming — the player drags the snail across a still road and watches it
 *    move, taps and watches it jump — and the card clears because they did the thing, not because
 *    they dismissed it.
 * 3. **A card says what the thing is FOR, not which button to press.** "Tap to jump" is a control;
 *    "a wall has no gap, so the jump is the way through" is a reason — and a reason is what the
 *    player can apply to the next wall the game deals them without being told again.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:tutorial` loads it under Node. The
 * card that draws it is `TutorialCard.ts`.
 */
import { SEGMENT_LENGTH } from '../road/constants'
import { createObstacle, drawWall, OBSTACLE_HALF_WIDTHS, type Obstacle } from './obstacles'
import { PICKUP_HEIGHT, type Pickup } from './pickups'
import { RAMP_HALF_WIDTHS, type Ramp } from './ramp'

/** Which lesson a card is teaching. Ordered, and the order is the order the road deals them in. */
export type TutorialStepId = 'steer' | 'jump' | 'low' | 'wall' | 'blocking' | 'fruit' | 'shield' | 'ramp'

/**
 * How a step decides it is finished. **Both kinds stop the road; they differ in what starts it.**
 *
 * `act` is a control, and the control can be exercised inside its own pause: the road is still, the
 * snail is not, and the card clears the moment the player does the thing it names. There is nothing
 * on the road during either of them, so the pause costs the run nothing at all.
 *
 * `read` is an explanation of an object that has not arrived yet — a wall 45 segments out, frozen
 * where the player can look at it. The thing it asks for can only be done in motion, so what clears
 * the card is an acknowledgement, and the road then starts and delivers the object. The card stays
 * up until it is behind them, so the sentence and the thing it was about are on screen together.
 */
export type TutorialStepKind = 'act' | 'read'

/**
 * A readout on the HUD that a card is talking about.
 *
 * **⚠ A card that names something on screen has to point at it.** "Fills the leaf" is a sentence
 * about an object the player has never been told the name of, in a corner they have no reason to be
 * looking at — reported as exactly that: *say where this Fever thing is, that it is the gauge in
 * the corner.* Naming a HUD element in prose and leaving the player to find it is the same failure
 * as a control with no affordance.
 *
 * Where each one actually is comes from `Hud.highlightRect`, because the HUD solves those boxes
 * from the frame's own width and a card carrying its own coordinates would be a second opinion.
 */
export type TutorialHighlight = 'gauge' | 'lives'

export interface TutorialStep {
  id: TutorialStepId
  kind: TutorialStepKind
  /** Where the thing this card is about stands, in world units from the start of the lap. */
  z: number
  /** The readout this card is about, if it is about one. */
  highlight?: TutorialHighlight
}

/**
 * How far ahead of its subject a `meet` card comes up, in world units.
 *
 * **Reading a sentence and then acting on it is a much longer job than reacting to a rock**, which
 * is what `REACTION_MS` is a floor for — so this is deliberately several times that. 45 segments is
 * 5.4 seconds at the speed a run starts at and still 2.5 at `SPEED_CAP`, which is the fastest this
 * band can be met at since it sits in the first third of the first lap.
 */
export const TUTORIAL_LEAD_Z = SEGMENT_LENGTH * 45

/**
 * How far past its subject a `meet` card stays up, in world units.
 *
 * Enough that the player can look at the card and the thing it was about in one glance after the
 * fact. A card that vanished the instant its rock did would leave nothing connecting the two.
 */
export const TUTORIAL_PASSED_Z = SEGMENT_LENGTH * 6

/** How long a satisfied card stays up before the next one may come, in milliseconds. */
export const TUTORIAL_HOLD_MS = 900

/**
 * The lessons, in the order the road deals them.
 *
 * **The spacing is the design.** Each subject is 55 segments past the last, ten more than the lead,
 * so a card is never up while the previous card's object is still arriving and the player is never
 * reading about two things at once. That is the whole reason the tutorial owns a stretch of road
 * rather than annotating whatever the ordinary placer happened to deal: the placer is tuned to keep
 * a player busy, which is the exact opposite of what a first minute needs.
 *
 * The order is not arbitrary either. Steering comes before jumping because it is the control the
 * player is already using; the low rock comes after the jump so the jump has a reason before it has
 * a use; the wall comes after the low rock, because a wall is only legible as "the row with no gap"
 * to someone who has already seen a row with one.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: 'steer', kind: 'act', z: SEGMENT_LENGTH * 12 },
  { id: 'jump', kind: 'act', z: SEGMENT_LENGTH * 70 },
  { id: 'low', kind: 'read', z: SEGMENT_LENGTH * 130 },
  { id: 'wall', kind: 'read', z: SEGMENT_LENGTH * 185 },
  { id: 'blocking', kind: 'read', z: SEGMENT_LENGTH * 240 },
  // The two cards that name something on screen, and the only two: a leaf the player has never been
  // pointed at, and the pips a shield is spent instead of.
  { id: 'fruit', kind: 'read', z: SEGMENT_LENGTH * 295, highlight: 'gauge' },
  { id: 'shield', kind: 'read', z: SEGMENT_LENGTH * 350, highlight: 'lives' },
  { id: 'ramp', kind: 'read', z: SEGMENT_LENGTH * 405 },
]

/**
 * Where the tutorial's own stretch of road ends and the ordinary placer takes over.
 *
 * Past the last subject by a lead's worth, so the last card has cleared before the first generated
 * row arrives — otherwise the run's own difficulty would start while the player was still reading
 * about ramps.
 */
export const TUTORIAL_LENGTH_Z = TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].z + TUTORIAL_LEAD_Z

/**
 * How much steering counts as having steered, in road half-widths of travel.
 *
 * Total distance moved rather than a position reached: a player who has pushed the snail a third of
 * the way across the road and back has understood the control, while one whose finger happens to
 * start at the edge has not. `ROAD_EDGE` is about 0.9, so this is roughly one full crossing.
 */
export const TUTORIAL_STEER_UNITS = 0.9

/**
 * What the player has done so far, as the scene sees it.
 *
 * **⚠ Every one of these is CUMULATIVE for the whole run, and a card is answered by what has
 * happened since it came up.** The first version passed `jumped: boolean` — "has this player ever
 * left the ground" — and the check caught what that means: a player who taps once out of curiosity
 * while the *steering* card is up arrives at the jump card with it already satisfied, so the card
 * that teaches the jump appears and clears in the same frame and teaches nothing. Same for
 * steering, and same for the tap that clears an explanation.
 *
 * The fix is a baseline rather than a reset, and it lives in `TutorialState` rather than in the
 * scene: a rule kept in two places is a rule that will eventually be applied in one of them.
 */
export interface TutorialSignals {
  /** How far the run has travelled, in world units. */
  distance: number
  /** Total lateral movement this run, in road half-widths. Only ever rises. */
  steered: number
  /** How many times the player has left the ground this run. */
  jumps: number
  /**
   * How many times the player has asked a card to go away.
   *
   * A count of its own rather than a tap counted here, because the scene owns what "asked" means:
   * the press that dismisses a card is the same one that jumps, and only the scene can say which of
   * the two a given press was. See `RunScene.tryJump`.
   */
  acknowledgements: number
  /** Wall-clock milliseconds, for the hold after a card is satisfied. */
  now: number
}

/** Where the tutorial has got to. */
export interface TutorialState {
  /** Which step is current. Equal to `TUTORIAL_STEPS.length` once the tutorial is over. */
  index: number
  /** When the current step was satisfied, in ms. `-1` while it is still open. */
  doneAt: number
  /**
   * Whether the current card has come up yet.
   *
   * A card arms on the first frame it is on screen, and arming is when its baselines are taken —
   * so what answers it is what the player does *from that moment*, not what they had already done.
   * See `TutorialSignals`.
   */
  armed: boolean
  /** The cumulative signals as they stood when this card armed. */
  base: { steered: number; jumps: number; acknowledgements: number }
}

export function createTutorialState(): TutorialState {
  return { index: 0, doneAt: -1, armed: false, base: { steered: 0, jumps: 0, acknowledgements: 0 } }
}

/** Whether the tutorial still has something to say. */
export function tutorialRunning(state: TutorialState): boolean {
  return state.index < TUTORIAL_STEPS.length
}

/** The step being taught right now, or `null` once they are all done. */
export function currentStep(state: TutorialState): TutorialStep | null {
  return tutorialRunning(state) ? TUTORIAL_STEPS[state.index] : null
}

/** Whether the current card has been satisfied and is holding before it goes. */
export function stepSatisfied(state: TutorialState): boolean {
  return state.doneAt >= 0
}

/**
 * Advances the tutorial, and returns the new state.
 *
 * Pure, so the scene holds a value and every rule lives here. The two kinds are handled in one pass
 * because they differ only in what satisfies them and in whether an unsatisfied card may expire.
 */
export function stepTutorial(state: TutorialState, signals: TutorialSignals): TutorialState {
  if (!tutorialRunning(state)) return state

  const step = TUTORIAL_STEPS[state.index]

  // **⚠ Only ARMING waits for the card to be on screen, and putting this guard one line earlier
  // deadlocked the whole thing.** A `read` card stops being visible once its object is behind the
  // player — which is exactly the condition it advances on — so a visibility guard in front of the
  // advance rules freezes the machine on the first explanation and the tutorial never ends.
  //
  // Arming takes the baselines, and it costs a frame on purpose: answering is measured from here,
  // so a card cannot be satisfied by anything the player did before it existed — which is the whole
  // of what `TutorialSignals` documents. The earliest a card can be answered is the frame after it
  // appears, which is also the earliest a human could have answered it.
  if (!state.armed) {
    if (!cardVisible(step, signals.distance)) return state

    return {
      ...state,
      armed: true,
      base: { steered: signals.steered, jumps: signals.jumps, acknowledgements: signals.acknowledgements },
    }
  }

  if (state.doneAt < 0) {
    // Still open, so the road is still stopped. Nothing here can expire on distance, because
    // distance is exactly what is not advancing — see `tutorialPaused`.
    return isSatisfied(step, state, signals) ? { ...state, doneAt: signals.now } : state
  }

  // **Answered, and the two kinds now part company.** A control card holds for a beat so the player
  // sees that it was them that cleared it, and then goes: the lesson is over, because they have
  // just performed it. An explanation's lesson has not happened yet — the object it was about is 45
  // segments ahead — so it stays up until that object is behind them, which is what puts the
  // sentence and the thing on screen at the same time.
  if (step.kind === 'act') {
    return signals.now - state.doneAt < TUTORIAL_HOLD_MS ? state : advance(state)
  }

  return signals.distance > step.z + TUTORIAL_PASSED_Z ? advance(state) : state
}

/** On to the next card, disarmed so it takes its own baselines when it comes up. */
function advance(state: TutorialState): TutorialState {
  return { index: state.index + 1, doneAt: -1, armed: false, base: { steered: 0, jumps: 0, acknowledgements: 0 } }
}

/**
 * Whether the run should be standing still right now.
 *
 * **The whole of the pause rule, in one place, so the scene cannot hold half of it.** A card that is
 * up and has not been answered stops the road; everything else runs. Note what it does *not* cover:
 * the snail. `RunScene` keeps stepping the player through this, because performing the control is
 * how the two `act` cards are answered — freezing the creature too would make them unanswerable.
 */
export function tutorialPaused(state: TutorialState, distance: number): boolean {
  const step = currentStep(state)

  return step !== null && state.doneAt < 0 && cardVisible(step, distance)
}

/**
 * Whether the card on screen is still waiting to be answered.
 *
 * The same question `tutorialPaused` asks, and deliberately a second name for it: the scene reads
 * one to decide whether to advance the run and the card reads the other to decide whether to draw
 * its prompt, and those are different jobs that happen to have the same answer today.
 */
export function cardOpen(state: TutorialState, distance: number): boolean {
  return tutorialPaused(state, distance)
}

/** Whether the current card is one the player has to acknowledge rather than perform. */
export function awaitingAcknowledgement(state: TutorialState, distance: number): boolean {
  const step = currentStep(state)

  return step !== null && step.kind === 'read' && state.doneAt < 0 && cardVisible(step, distance)
}

/** Whether the current card should be on screen at `distance`. */
export function cardVisible(step: TutorialStep, distance: number): boolean {
  if (step.kind === 'act') return distance >= step.z - TUTORIAL_LEAD_Z

  return distance >= step.z - TUTORIAL_LEAD_Z && distance <= step.z + TUTORIAL_PASSED_Z
}

/**
 * How far past its subject a `read` card's own pause would sit, if it were ever reached.
 *
 * It is not: a `read` card stops the road the instant it appears, so the player is always
 * acknowledging it from `z - TUTORIAL_LEAD_Z` and never from anywhere else. The window
 * `cardVisible` describes is what the card is *drawn* across after that, while the run is moving
 * again — which is why the two are separate questions and this file answers them separately.
 */

/** Whether this lap position is inside the stretch the tutorial owns. */
export function insideTutorialBand(z: number): boolean {
  return z < TUTORIAL_LENGTH_Z
}

/**
 * The tutorial's own stretch of road.
 *
 * **Hand-placed, and that is the point: one thing at a time, with nothing else in the frame.** The
 * ordinary placer is tuned by `difficulty.ts` to keep a player busy — density, the wall share, the
 * unjumpable share — and every one of those knobs is wrong for the first minute of a first run. It
 * also cannot be *told* to deal a wall next, which is most of what a tutorial needs.
 *
 * Passability needs no proof here, and that is not an exemption: every row is a single object with
 * the rest of the road open beside it, except the wall — which is the one row a jump is required
 * for, and it is dealt immediately after the jump has been taught and used once.
 * `verify:tutorial` asserts both halves rather than taking them on trust.
 */
export function tutorialLayout(
  nextObstacleId: () => number,
  nextPickupId: () => number,
  /** The id the tutorial's own ramp takes — see `rampIdStride`. */
  rampId: number,
): { obstacles: Obstacle[]; pickups: Pickup[]; ramps: Ramp[] } {
  const obstacles: Obstacle[] = []
  const pickups: Pickup[] = []
  const ramps: Ramp[] = []
  const at = (id: TutorialStepId): number => {
    const step = TUTORIAL_STEPS.find((candidate) => candidate.id === id)

    if (!step) throw new Error(`no tutorial step ${id}`)

    return step.z
  }

  // **Coins to steer into, rather than a card that only says "steer".** The first lesson is that
  // leaving your line is worth something, and a line of coins running across the road is the only
  // way to say that without words. Laid as a diagonal so it cannot be collected by holding still.
  for (let i = 0; i < 7; i++) {
    pickups.push({
      id: nextPickupId(),
      z: at('steer') + SEGMENT_LENGTH * (16 + i * 5),
      offsetX: -0.55 + i * 0.18,
      kind: 'coin',
      y: PICKUP_HEIGHT,
      taken: false,
    })
  }

  // One low rock, off centre, with the whole rest of the road open beside it: the first obstacle a
  // player meets has to be one they could also have dodged, so that clearing it is a move they
  // chose rather than the only thing that was available.
  obstacles.push(
    createObstacle({
      id: nextObstacleId(),
      z: at('low'),
      offsetX: -0.2,
      halfWidths: OBSTACLE_HALF_WIDTHS.max,
      kind: 'low',
    }),
  )

  // The wall: the one row with no line through it. Built by `drawWall` rather than by hand, so the
  // thing the tutorial teaches is the thing the game actually deals.
  obstacles.push(...drawWall(at('wall'), nextObstacleId))

  // A tall barrier, which a jump does not clear — `blocking.yHigh` is 620 against a `JUMP_APEX` of
  // 430. Off the centreline with the road open past it, so "go around" is a move the player can
  // still make on the frame they finish reading the card.
  obstacles.push(
    createObstacle({
      id: nextObstacleId(),
      z: at('blocking'),
      offsetX: 0.42,
      halfWidths: OBSTACLE_HALF_WIDTHS.max,
      kind: 'blocking',
    }),
  )

  // Fruit, three of them: enough to move the leaf visibly, and nowhere near the eight a Fever
  // costs — firing one here would run the effect while the card explaining it was still up.
  for (let i = 0; i < 3; i++) {
    pickups.push({
      id: nextPickupId(),
      z: at('fruit') + SEGMENT_LENGTH * i * 4,
      offsetX: 0.1 - i * 0.1,
      kind: 'fruit',
      y: PICKUP_HEIGHT,
      taken: false,
    })
  }

  // One shield, on the centreline. It is the rarest thing on the road, and the tutorial is the only
  // place a player is guaranteed to meet one at all.
  pickups.push({ id: nextPickupId(), z: at('shield'), offsetX: 0, kind: 'shield', y: PICKUP_HEIGHT, taken: false })

  // And a ramp, centred, with nothing else near it. Its arc chain is laid by the scene exactly as
  // any other ramp's is — the tutorial does not lay it, because the flight's speed is not knowable
  // from here. See `RunScene.relayArcs`.
  // **Its own id, out of the ramp space rather than the obstacle one.** `arcOf` names a ramp, and
  // `rampIdStride` reserves a block per lap that the generator provably cannot fill — so the top of
  // lap 0's block is a name no generated ramp will ever take. Borrowing the obstacle counter (which
  // is what this did) put a ramp id in the hundreds, which lap 15's block would eventually reach.
  ramps.push({ id: rampId, z: at('ramp'), offsetX: 0, halfWidths: RAMP_HALF_WIDTHS })

  return { obstacles, pickups, ramps }
}

/** Whether the current card's own condition has been met **since it came up**. */
function isSatisfied(step: TutorialStep, state: TutorialState, signals: TutorialSignals): boolean {
  switch (step.id) {
    case 'steer':
      return signals.steered - state.base.steered >= TUTORIAL_STEER_UNITS
    case 'jump':
      return signals.jumps > state.base.jumps
    default:
      // A `read` card is answered by being acknowledged, and by nothing else. It cannot be answered
      // by distance any more: the road is not moving while it is up, so distance is exactly the
      // quantity that has stopped.
      return signals.acknowledgements > state.base.acknowledgements
  }
}
