/**
 * What the steering actually did, measured in a real run rather than in a model.
 *
 * **Rule: this file never imports `phaser`.** It is loaded directly under plain Node by
 * `scripts/verify-player.mjs`.
 *
 * `scripts/measure-steering.mjs` answers the same four questions offline, against a simulated
 * player, and it is the right instrument for a comparison — it can run ten times per configuration
 * and it can drive a phone-sized frame from a desktop. What it cannot do is have a thumb. This is
 * the half that does: it records the same four numbers off whatever the player's own hand did, so
 * the model can be checked against a person instead of believed.
 *
 * DEV only, fed from `RunScene.update` and read through `window.__steer.report()`.
 *
 * ## What each number is, and why it is that one
 *
 * - **`gapPx`** — how far the snail is from the finger, on screen, while the finger is asking. This
 *   is the spring's lag made visible, and it is in *pixels* rather than in half-widths because that
 *   is the unit the complaint is in: the same lag is a fifth of a phone's road and a twentieth of a
 *   desktop's.
 * - **`startMs`** — from a new request to the snail visibly moving. A control that does not answer
 *   inside about 100ms reads as ignoring the input rather than as being heavy.
 * - **`arriveMs`** — from a new request to the snail being inside a snail's half-width of it, for
 *   requests worth at least that much. Against `REACTION_MS` (450), which is what the road promises.
 * - **`overshoots`** — how often the snail crossed the request and had to come back. **Only counted
 *   once it is past half a snail-half-width**, because a sign flip inside the settling noise is not
 *   the player watching their creature sail past a gap — counted raw, it makes every single request
 *   an overshoot and the metric says nothing.
 *
 * A *request* here is a change in where the finger is asking, not a frame: holding still is not a
 * new decision, and counting frames would report the frame rate.
 */

/**
 * One completed gesture: the thumb moved, then stopped, and this is what the snail did about it.
 */
export interface SteerRequest {
  /** How far the request moved over the whole gesture, in road half-widths. */
  travel: number
  /** From the thumb first moving to the snail first moving, in ms. `null` if it never did. */
  startMs: number | null
  /** From the thumb *stopping* to the snail arriving where it stopped, in ms. `null` if never. */
  arriveMs: number | null
  /** How many times the snail crossed the settled request afterwards. */
  overshoots: number
}

export interface SteerProbeState {
  /** Every frame's finger-to-snail distance in px, while the player was asking. */
  gapPx: number[]
  requests: SteerRequest[]
  /** The gesture being watched, if one is open. */
  open: {
    movingUntil: number
    startedAt: number
    from: number
    want: number
    stoppedAt: number | null
    /** When the snail last came inside a snail-half of the request, or `null` if it is outside. */
    withinSince: number | null
    startMs: number | null
    arriveMs: number | null
    overshoots: number
    sign: number
  } | null
  lastWant: number | null
}

/** How much the request has to move in a frame for the thumb to count as moving, in half-widths. */
export const MOVING_THRESHOLD = 0.004
/** How long the thumb has to hold still before the gesture is treated as finished, in ms. */
export const STILL_MS = 80
/** How long after the thumb stops the snail is given to arrive before the gesture is filed, in ms. */
export const SETTLE_WINDOW_MS = 1200

export function createSteerProbe(): SteerProbeState {
  return { gapPx: [], requests: [], open: null, lastWant: null }
}

export interface SteerSample {
  /** Where the player is asking to be, in half-widths. */
  want: number
  /** Whether they are asking at all. */
  active: boolean
  /** Where the snail is, in half-widths. */
  at: number
  /** How far apart the finger and the snail are on screen, in px. */
  gapPx: number
  /** How wide the snail is drawn, in half-widths — the tolerance everything here is measured in. */
  snailHalf: number
  /** Now, in ms. */
  now: number
}

/**
 * Folds one frame into the probe.
 *
 * **A gesture, not a frame and not a sample.** A thumb sliding across the glass moves a little
 * every frame, so a rule that opened a request per movement would file sixty of them a second and
 * report that almost none ever arrived — each superseded by the next before the spring could close
 * it. What a player experiences as one ask is *the thumb moving and then stopping*, so that is the
 * unit: the clock for "did it answer" starts when the thumb starts, and the clock for "did it get
 * there" starts when the thumb **stops**.
 *
 * Mutates rather than returning a new state, unlike everything else pure in this project: it runs
 * every frame for the whole of a run and its whole purpose is to be free.
 */
export function stepSteerProbe(probe: SteerProbeState, sample: SteerSample): void {
  if (!sample.active) {
    close(probe)
    probe.lastWant = null

    return
  }

  probe.gapPx.push(sample.gapPx)

  const moved = probe.lastWant === null ? 0 : Math.abs(sample.want - probe.lastWant)
  const moving = moved >= MOVING_THRESHOLD

  probe.lastWant = sample.want

  if (moving && !probe.open) {
    probe.open = {
      movingUntil: sample.now,
      startedAt: sample.now,
      from: sample.at,
      want: sample.want,
      stoppedAt: null,
      withinSince: null,
      startMs: null,
      arriveMs: null,
      overshoots: 0,
      sign: Math.sign(sample.at - sample.want) || 1,
    }
  }

  const open = probe.open

  if (!open) return

  if (moving) {
    // Still being asked: the target keeps moving with the thumb and the settle clock has not begun.
    open.movingUntil = sample.now
    open.want = sample.want
    open.stoppedAt = null
  } else if (open.stoppedAt === null && sample.now - open.movingUntil >= STILL_MS) {
    open.stoppedAt = open.movingUntil
    open.sign = Math.sign(sample.at - open.want) || open.sign
  }

  if (open.startMs === null && Math.abs(sample.at - open.from) >= sample.snailHalf * 0.1) {
    open.startMs = sample.now - open.startedAt
  }

  const error = sample.at - open.want
  const sign = Math.sign(error) || open.sign
  const within = Math.abs(error) <= sample.snailHalf

  // **Tracked every frame, including while the thumb is still moving.** The stop is only *noticed*
  // `STILL_MS` after it happens, so an arrival measured from the moment it is noticed can never
  // report less than that — a snail already sitting on the request would be filed as having taken
  // 83ms to get somewhere it never left.
  if (!within) open.withinSince = null
  else if (open.withinSince === null) open.withinSince = sample.now

  if (open.stoppedAt === null) return

  if (open.arriveMs === null && within) {
    open.arriveMs = Math.max(0, (open.withinSince ?? sample.now) - open.stoppedAt)
  }
  // **A crossing only counts once it is visible.** Sign flips inside the settling noise are not the
  // player watching their creature sail past a gap — counted raw, they make every gesture an
  // overshoot and the number says nothing.
  if (open.arriveMs !== null && Math.abs(error) > sample.snailHalf * 0.5 && sign !== open.sign) {
    open.overshoots++
    open.sign = sign
  }
  if (sample.now - open.stoppedAt > SETTLE_WINDOW_MS) close(probe)
}

function close(probe: SteerProbeState): void {
  if (!probe.open) return

  const { from, want, startMs, arriveMs, overshoots } = probe.open

  probe.requests.push({ travel: Math.abs(want - from), startMs, arriveMs, overshoots })
  probe.open = null
}

export interface SteerReport {
  frames: number
  requests: number
  gapPxMedian: number
  gapPxP95: number
  startMsMean: number | null
  arriveMsMean: number | null
  arriveMsP95: number | null
  overshootShare: number
  neverArrived: number
}

function pct(values: number[], p: number): number {
  if (!values.length) return 0

  const sorted = [...values].sort((a, b) => a - b)

  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

/**
 * The four numbers, over everything recorded so far.
 *
 * `arriveMs` is taken only over requests that asked for at least a snail's half-width of movement:
 * a request the snail was already satisfying arrives in zero milliseconds, and averaging those in
 * measures how often the player was already in the right place rather than how fast the control is.
 */
export function steerReport(probe: SteerProbeState, snailHalf: number): SteerReport {
  const real = probe.requests.filter((request) => request.travel >= snailHalf)
  const arrived = real.filter((request) => request.arriveMs !== null).map((request) => request.arriveMs as number)
  const started = real.filter((request) => request.startMs !== null).map((request) => request.startMs as number)

  return {
    frames: probe.gapPx.length,
    requests: real.length,
    gapPxMedian: pct(probe.gapPx, 50),
    gapPxP95: pct(probe.gapPx, 95),
    startMsMean: mean(started),
    arriveMsMean: mean(arrived),
    arriveMsP95: arrived.length ? pct(arrived, 95) : null,
    overshootShare: real.length ? real.filter((request) => request.overshoots > 0).length / real.length : 0,
    neverArrived: real.length - arrived.length,
  }
}
