/**
 * The survivability row: shields and lives as one line of elements.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:ui`.
 *
 * ## ⚠ Two readouts answering one question, in two places and two shapes
 *
 * Shields and lives are both "how many more hits do I survive". They shipped as two separate
 * counters — three `●` pips in the interface rim colour, then a gap, then `◆` pips in the shield
 * pickup's green — so the player had to find both and add them up. Worse, the two were only ever
 * *beside* each other because one was positioned from the other's text width, which is how they
 * came to be drawn on top of one another once already.
 *
 * One row fixes the question rather than the styling: **the length of the lit run is the answer.**
 * Nothing has to be added, because the elements are laid in the order they will be spent.
 *
 * ## What differs between a shield and a heart, and what may not
 *
 * They differ in **silhouette and colour** and in nothing else — same radius, same baseline, same
 * spacing. That is what makes the row one row: a bigger or a raised shield would read as a badge
 * standing next to a counter, which is the arrangement being replaced. `verify:ui` asserts every
 * element shares a size and a centre line, so the two cannot drift apart by styling.
 *
 * ## ⚠ The shield section is variable and the heart section is fixed, and the asymmetry is real
 *
 * A life is a **slot**: `RUN_LIVES` of them exist from the first frame, and a spent one leaves a
 * hollow socket that says what was lost. A shield is **carried**: there is no socket for one you do
 * not have, because an empty shield socket permanently on the left of the row is a slot the player
 * would read as a life they have somehow already lost.
 *
 * So picking a shield up *lengthens* the row and spending it shortens it again, which is what makes
 * the pickup legible without a word of text: the thing just collected is visibly one more hit.
 */

/**
 * One element's proportions, in unscaled pixels — shared by both kinds, which is the point.
 *
 * Sized against the fruit gauge's own segments so the two readouts in the bottom corners read as
 * one interface rather than two designs, and against the standing report that the readouts are too
 * small: the widest row this game can show is four elements, 129px on a desktop.
 */
/**
 * How thick an element's outline is, as a fraction of its radius.
 *
 * Named because `lifeRowBleed` has to know it: the stroke is centred on the shape's own path, so
 * half of it lies outside whatever the fill reaches.
 */
export const LIFE_PIP_STROKE_FRACTION = 0.15

export const LIFE_PIP = {
  radius: 13,
  /** Space between two elements, edge to edge. What stops the row reading as one bar. */
  gap: 7,
} as const

/**
 * The heart's red, and the lit edge on top of it.
 *
 * **⚠ Red, and the only red in this game that is legal.** `THREAT_COLOR` reserves a band round the
 * warm red the whole frame means *something has landed on you* by, and every ordinary heart colour
 * is inside it: `f2617a` measures 10.2 degrees from it, `ff6b81` 9.1, a deep crimson 3.5. A heart
 * in any of those would have the frame saying "damage" in the colour it says "life".
 *
 * The reservation has three terms and a colour clears it by defeating any one. This one keeps the
 * **hue** — it is supposed to read as red, and at 15.5 degrees it is well inside the band — and
 * escapes on **lightness**, at |dL| 0.237 against the 0.22 the rule allows. So the player reads a
 * red heart and the threat colour keeps its meaning, because the two are never the same brightness.
 * `verify:ui` asserts exactly that escape, so darkening this toward a richer red fails a check
 * rather than a frame.
 *
 * Measured: 139 degrees from the shield's green, 7.50:1 on the interface plate.
 *
 * **Here rather than in `Hud.ts` because `Hud.ts` imports Phaser** and no `verify:` script can
 * reach it — the same split every pure rule in this project is under.
 */
export const HEART_COLOR = 0xff9aae
export const HEART_LIGHT = 0xffd3dc

/** Which of the two shapes an element is. They differ in outline and colour, never in size. */
export type LifeSlotKind = 'shield' | 'heart'

export interface LifeSlot {
  kind: LifeSlotKind
  /** Whether it is still there to be spent. A hollow heart is a life already lost. */
  filled: boolean
}

/**
 * The row, left to right, **in the order the elements will be spent**.
 *
 * Shields first, because `takeHit` spends a shield before a life — so the leftmost lit element is
 * always the next one to go, and the player learns the shield's whole mechanic by watching the row
 * rather than by being told. See `runState.takeHit`.
 */
export function lifeRowSlots(shields: number, lives: number, maxLives: number): LifeSlot[] {
  const carried = Math.max(0, Math.floor(shields))
  const left = Math.max(0, Math.min(maxLives, Math.floor(lives)))
  const slots: LifeSlot[] = []

  for (let i = 0; i < carried; i++) slots.push({ kind: 'shield', filled: true })
  for (let i = 0; i < maxLives; i++) slots.push({ kind: 'heart', filled: i < left })

  return slots
}

/** How wide and tall a row of `count` elements is at `scale`. */
export function lifeRowSize(count: number, scale: number): { w: number; h: number } {
  const d = LIFE_PIP.radius * 2 * scale
  const gap = LIFE_PIP.gap * scale

  return { w: count * d + Math.max(0, count - 1) * gap, h: d }
}

/** The centre of element `i`, relative to the row's left edge. */
export function slotCentreX(i: number, scale: number): number {
  const d = LIFE_PIP.radius * 2 * scale

  return d / 2 + i * (d + LIFE_PIP.gap * scale)
}

/**
 * Where the row sits, in screen pixels: the **bottom-left corner**, under the mascot's own feet.
 *
 * **⚠ The bottom-left corner is where a previous round was reported for covering the snail**, and
 * the difference is height rather than luck. That block was a plate carrying the fruit gauge *and*
 * the lives — about 100px against a band under the mascot's feet that is 11.7% of the frame, 66px
 * on a 320x568 phone. This is one row of elements, 21px at that frame's scale, and `verify:ui`
 * measures it against the mascot's own projected box at every supported viewport rather than
 * arguing about it. See the clearance check there.
 *
 * Four arguments, all of them numbers about the frame plus what the row is showing, and `verify:ui`
 * asserts the count: the box cannot depend on the mascot, the camera or a projection, because none
 * of those is in scope. Same rule, and the same fix, as `fruitGaugeBox`'s.
 */
export function lifeRowBox(
  width: number,
  height: number,
  scale: number,
  count: number,
): { x: number; y: number; w: number; h: number } {
  const margin = 16 * scale
  const { w, h } = lifeRowSize(count, scale)

  return { x: margin, y: height - margin - h, w, h }
}

/**
 * How long an element takes to go out, in milliseconds.
 *
 * **⚠ Held under the grace a hit buys, measured at the speed that makes it shortest.**
 * `HIT_INVULNERABLE_Z` is a *distance*, so in milliseconds it is about a second at the speed a run
 * starts at and around 250ms at `MAX_ATTAINABLE_SPEED` — and an element still visibly dying when
 * the player can be hit again is a readout showing them a life they no longer have at exactly the
 * moment the count has to be right. Same bound, and the same reasoning, as `SHIELD_POP`;
 * `verify:ui` measures it against the fast end rather than the comfortable one.
 */
export const LIFE_SPEND_MS = 220

/**
 * How long an arriving element takes to land.
 *
 * Allowed to be longer than the spend because nothing is at stake while it plays: it is a reward
 * arriving, not a count the player is about to act on.
 */
export const LIFE_ENTRY_MS = 420

/** `0` before the window, rising to `1` at its end, and clamped at both ends. */
export function progressIn(startedAt: number, now: number, durationMs: number): number {
  if (startedAt < 0 || durationMs <= 0) return 1

  return clamp01((now - startedAt) / durationMs)
}

/**
 * How far the row has finished sliding, `0..1`.
 *
 * Eased rather than snapped: collecting a shield pushes every heart one slot to the right, and
 * three elements teleporting sideways on the frame a pickup lands reads as the HUD being rebuilt
 * rather than as one thing being added to it.
 */
export function slideEase(t: number): number {
  const p = clamp01(t)

  return 1 - (1 - p) * (1 - p) * (1 - p)
}

/**
 * The arriving element's scale: `0`, past `1`, and back — the bounce.
 *
 * **A back-out overshoot rather than a plain ease**, because the two say different things: an
 * element that grows past its size and settles reads as something *landing*, where one that eases
 * up to its size reads as one fading in. What the player just did is catch a thing.
 */
export function entryBounce(t: number): number {
  const p = clamp01(t)
  const back = 1.9
  const s = p - 1

  return 1 + s * s * ((back + 1) * s + back)
}

/**
 * How far to the left of its home an arriving element still is, in slot widths.
 *
 * It flies in from *before* the row's start, which is the spend order read backwards: the thing
 * arriving is going to the front of the queue, and the front of the queue is what goes first.
 */
export function entryOffset(t: number): number {
  return 1 - slideEase(t)
}

/**
 * A dying element's shape: how wide and how tall it is drawn, as multiples of its own radius.
 *
 * **Squash, not a shrink.** It flattens — wider than it is tall — and only then collapses, which is
 * the one deformation that reads as something being *spent* rather than as something fading out.
 * The same volume-preserving idea the mascot's own jump is animated with; see `squash.ts`.
 */
export function spendSquash(t: number): { x: number; y: number } {
  const p = clamp01(t)
  // Most of the flattening happens in the first third, so the eye catches the moment of impact
  // rather than the middle of the collapse.
  const squash = Math.sin(Math.min(1, p * 3) * Math.PI) * 0.45
  const shrink = 1 - p * p

  return { x: shrink * (1 + squash), y: shrink * (1 - squash) }
}

/**
 * A dying element's flash, `0..1`: full on the frame it is spent, gone well before the shape is.
 *
 * Front-loaded on purpose — the flash is what says *now*, and one that outlived the squash would
 * read as the element glowing rather than as it being struck.
 */
export function spendFlash(t: number): number {
  const p = clamp01(t)

  return p >= 0.45 ? 0 : 1 - p / 0.45
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * The most an element is ever drawn at, as a multiple of its own radius.
 *
 * Sampled from the two curves that stretch one rather than written down beside them: `entryBounce`
 * overshoots on arrival and `spendSquash` flattens on the way out, and either could be re-tuned
 * without anyone remembering a constant over here. The flash is drawn at `1.12` of the radius on
 * top of whichever is running, which is where that term comes from.
 */
export const LIFE_PIP_MAX_STRETCH = (() => {
  let most = 1

  // Finely enough that a check sampling the same curves cannot find a taller point than this did
  // — which is what a bound has to be, and what a hundred samples was not: `verify:ui` walks 200
  // and caught the peak between two of them on its first run.
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000
    const squash = spendSquash(t)

    most = Math.max(most, entryBounce(t), squash.x, squash.y)
  }

  return most * 1.12
})()

/**
 * How far outside its own box the row can draw, in screen pixels.
 *
 * **The row is baked into a texture and anything past it is clipped**, so this is a bound rather
 * than a margin — see `ui/bakedGraphics.ts`. Three things put ink outside `lifeRowBox`: an element
 * still flying in is up to one slot to the left of home (`entryOffset` reaches 1), the hearts slide
 * by whole slots when a shield arrives or goes, and a stretched element is `LIFE_PIP_MAX_STRETCH`
 * of its radius where the box allows it one.
 *
 * `slideSlots` is this frame's slide rather than a worst case, because the caller knows it and a
 * texture sized per redraw costs nothing extra — a bound that has to cover every animation the row
 * could ever run is a bigger texture on every frame that runs none of them.
 */
export function lifeRowBleed(scale: number, slideSlots: number): { x: number; y: number } {
  const r = LIFE_PIP.radius * scale
  const pitch = r * 2 + LIFE_PIP.gap * scale
  // **⚠ A stroke is centred on its path, so half of it is outside the shape.** Left out of the
  // first version of this, which made a struck element's outline land exactly on the texture's
  // edge — correct to the arithmetic and a pixel short in practice, since the size is rounded up
  // to whole pixels and the outline is drawn on both sides of the path.
  const outline = Math.max(1.5, r * LIFE_PIP_STROKE_FRACTION) / 2
  const stretch = r * LIFE_PIP_MAX_STRETCH - r + outline

  // **Per axis, because the row only ever travels sideways.** One pad for both would make the
  // texture as tall as it is wide during a slide — 312px for a 33px readout — which is a lot of
  // transparent fill for a movement that happens along one of them.
  return { x: pitch * (1 + Math.abs(slideSlots)) + stretch, y: stretch }
}
