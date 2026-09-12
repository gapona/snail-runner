/**
 * Where the quest panel, its rows, their tracks and the collapsed chip sit, in screen pixels.
 *
 * **Pure, and separate from `questBoard.ts` for `navLayout.ts`'s reason** — that file imports
 * `phaser` as a value, so nothing in it is reachable from a `verify:` script, and every claim this
 * module makes is exactly the kind that has to be structural rather than eyeballed.
 *
 * ## ⚠ The track's length was a function of the numbers written beside it
 *
 * The bar was laid from the right edge inwards, past the count: `right - barW - count.width - gap`.
 * `barW` was constant, so the *length* was — but the whole track slid left by however wide the count
 * happened to be, so `5/9` and `13/14` put their bars in two different places, and three rows of a
 * board read as three different lengths. A progress bar is compared against the row above it before
 * it is read on its own, so a track that moves is a track that lies.
 *
 * **The fix is a reserved column, and the guarantee is the signature**: `questRowColumns` is handed
 * the row's box and nothing else — there is no quest, no count and no label in scope, so the
 * geometry *cannot* depend on them. `verify:ui` asserts that shape rather than sampling values
 * through it.
 *
 * ## ⚠ And the rows were three lines of text hanging over the sky
 *
 * Reported off a frame: no container, no heading, interface type rather than the game's, no mark
 * per row, and bars of a shape that appears nowhere else in the game — *debug output*, sitting in
 * the middle of the picture the front screen exists to sell. What is here now is a panel in the
 * kit's own language with a heading, a mark per row, and tracks drawn as the Fever gauge's own
 * segmented column laid on its side. See `questBoard.ts` for why that panel is allowed a plate
 * when the rest of this screen is not, and `QUEST_CHIP` for why it is collapsed by default.
 */

/**
 * How many segments a track carries, and it is deliberately `FRUIT_GAUGE_PIPS`.
 *
 * **⚠ A segment here is NOT one unit, and that is the one place this parts company with the Fever
 * tank it borrows its drawing from.** The tank has no counter beside it, so its segments have to
 * carry the count — "one segment per fruit" is that readout's whole argument. A quest row has the
 * exact number written at the end of it (`6/14`), so what is left for the track to say is the
 * *shape*: how far along, at a glance, against the row above it.
 *
 * A target of 14 drawn as 14 segments is a 3px block on a phone, which is a hatched line rather
 * than a count. Eight is what the tank uses, which is what makes the two readouts the same object
 * seen twice — `verify:ui` asserts the two constants are equal so they cannot drift apart.
 */
export const QUEST_BAR_SEGMENTS = 8

/**
 * How many segments *this* quest's track is cut into.
 *
 * **⚠ `QUEST_BAR_SEGMENTS` is a ceiling, not the answer, and shipping it as the answer drew eight
 * empty boxes for a target of two.** Reported by pointing at the board: *"the tracks take a heap of
 * room, but 0/2?"* — and that is the honest reading of eight sockets beside a counter that says the
 * whole quest is two of something. The player counts the sockets, gets eight, and the number beside
 * them disagrees.
 *
 * The ceiling's own reason is unchanged and is why this is a `min` rather than the target: *a
 * target of 14 drawn as 14 segments is a 3px block on a phone*, which is a hatched line rather than
 * a readout. So a small target gets a segment each — where the track then says exactly what the
 * counter says — and a large one is still cut into eight.
 */
export function questBarSegments(target: number): number {
  return Math.max(1, Math.min(QUEST_BAR_SEGMENTS, Math.floor(target)))
}

export const QUEST_ROW = {
  /** Row height and the gap under it, unscaled. */
  height: 30,
  gap: 7,
  /** The kind's mark, at the left of the row where the eye starts. Square. */
  iconSize: 22,
  /** The space between two columns. */
  gutter: 8,
  /** The track's share of a row's width. */
  barFraction: 0.3,
  /**
   * The column reserved at the right end of a row, as a share of its width.
   *
   * It holds two different things and is sized for the larger: `6/14` while a quest is running, and
   * the `COLLECT` button once it is done. Wide enough for the button at the narrowest frame the
   * menu is accepted at — `verify:ui` measures it against the shipped face rather than assuming it.
   */
  actionFraction: 0.22,
  /** How tall a track's segments are, and the gap between two of them. */
  barHeight: 13,
  segmentGap: 3,
} as const

/**
 * The panel the rows sit in.
 *
 * `maxWidth` is bounded rather than a share of the frame: three rows of text at a desktop's full
 * width would be a line of type running most of the way across the picture, which is a thing to
 * read rather than a thing to glance at.
 */
export const QUEST_PANEL = {
  padX: 14,
  padY: 12,
  /** The heading's band, and the gap under it before the first row. */
  headerHeight: 26,
  headerGap: 10,
  maxWidth: 380,
} as const

/**
 * The collapsed chip: `Quests 1/3`, with the whole board behind it.
 *
 * **⚠ The board is collapsed by default, and that is a composition decision rather than a saving of
 * space.** Three rows between the wordmark and the mascot cut the frame in half and left the
 * creature the third-largest thing on its own front screen, behind the type and the interface —
 * reported as exactly that. The front screen's job is to sell the game, which means showing the
 * game; a list of chores is something the player asks for.
 *
 * What the chip has to carry, and does, is the *reason* to ask for it: the count, and — when
 * something is claimable — the same warm accent and dot the shop's own badge uses. A collapsed
 * board that could not say a reward was waiting would be a collapsed board nobody ever opens.
 */
export const QUEST_CHIP = { height: 34, padX: 13, gap: 8, markSize: 14, chevron: 9 } as const

export interface QuestBarBox {
  x: number
  y: number
  w: number
  h: number
}

export interface QuestRowColumns {
  icon: { x: number; w: number }
  label: { x: number; w: number }
  bar: QuestBarBox
  action: { x: number; w: number }
}

/**
 * The four columns of a row whose box is `(x, y, width)` — a function of the box and nothing else.
 *
 * Reading order, left to right: **what** (the mark), **which** (the label), **how far** (the
 * track), **how many, or take it** (the count, or the collect button). `verify:ui` asserts the
 * arity, which is the property that stops a column ever being sized by the text it happens to hold.
 */
export function questRowColumns(x: number, y: number, width: number, scale: number): QuestRowColumns {
  const height = QUEST_ROW.height * scale
  const gutter = QUEST_ROW.gutter * scale
  const iconW = QUEST_ROW.iconSize * scale
  const barW = width * QUEST_ROW.barFraction
  const actionW = width * QUEST_ROW.actionFraction
  const barH = QUEST_ROW.barHeight * scale

  const actionX = x + width - actionW
  const barX = actionX - gutter - barW
  const labelX = x + iconW + gutter

  return {
    icon: { x, w: iconW },
    label: { x: labelX, w: Math.max(0, barX - gutter - labelX) },
    bar: { x: barX, y: y + height / 2 - barH / 2, w: barW, h: barH },
    action: { x: actionX, w: actionW },
  }
}

/** The track alone, kept as its own name because that is the geometry the first ⚠ above is about. */
export function questBarBox(x: number, y: number, width: number, scale: number): QuestBarBox {
  return questRowColumns(x, y, width, scale).bar
}

/**
 * Segment `i` of a track, left to right.
 *
 * The gaps come out of the track's own width rather than being added to it, so a bar spans exactly
 * the column `questRowColumns` reserved for it however many segments it is cut into.
 */
export function questSegmentBox(i: number, bar: QuestBarBox, count: number, scale: number): QuestBarBox {
  const gap = QUEST_ROW.segmentGap * scale
  const w = (bar.w - gap * Math.max(0, count - 1)) / Math.max(1, count)

  return { x: bar.x + i * (w + gap), y: bar.y, w, h: bar.h }
}

/** How tall a stack of `count` rows is. */
export function questBoardHeight(count: number, scale: number): number {
  return count * QUEST_ROW.height * scale + Math.max(0, count - 1) * QUEST_ROW.gap * scale
}

/**
 * How much of the next row the scroll window leaves in view when not every row fits.
 *
 * **A row cut off at a row boundary says the list has ended**, which is the one thing a window that
 * scrolls must never say. Half a row under the last whole one is the ordinary way a list tells a
 * thumb there is more of it, before the chevron under the window says so again.
 */
export const QUEST_WINDOW_PEEK = 0.45

/**
 * How tall the open panel's rows window is, given `count` rows and `room` pixels to put them in.
 *
 * **⚠ The rows used to be DROPPED against the floor, and that is why the quests were not visible.**
 * On a phone held sideways in a webview the room under the heading holds one row, so the panel
 * showed one and the other two did not exist anywhere on screen — reported twice, and the second
 * report came after the wordmark had already been made to give its band up. Now every row is laid
 * out and the window scrolls: all of them fit, the window is exactly their height and nothing
 * scrolls; otherwise it shows whole rows plus `QUEST_WINDOW_PEEK` of the next, and never less than
 * one whole row, because a window that cannot show one row is not a window.
 */
export function questWindowHeight(count: number, room: number, scale: number): number {
  const extent = questBoardHeight(count, scale)

  if (extent <= room) return extent

  const rowH = QUEST_ROW.height * scale
  const pitch = (QUEST_ROW.height + QUEST_ROW.gap) * scale
  const peek = QUEST_WINDOW_PEEK * rowH

  if (room < pitch + peek) return Math.min(extent, Math.max(rowH, room))

  return Math.min(extent, Math.floor((room - peek) / pitch) * pitch + peek)
}

/** The open panel's height around a rows window `window` tall. */
export function questPanelHeightFor(window: number, scale: number): number {
  return (
    QUEST_PANEL.padY * 2 * scale + QUEST_PANEL.headerHeight * scale + QUEST_PANEL.headerGap * scale + window
  )
}

/** How wide and tall the open panel is, for `rows` rows at `scale` inside a frame of `width`. */
export function questPanelSize(
  rows: number,
  scale: number,
  width: number,
  margin: number,
): { w: number; h: number } {
  return {
    w: Math.min(width - margin * 2, QUEST_PANEL.maxWidth * scale),
    h:
      QUEST_PANEL.padY * 2 * scale +
      QUEST_PANEL.headerHeight * scale +
      QUEST_PANEL.headerGap * scale +
      questBoardHeight(rows, scale),
  }
}

/** How wide and tall the collapsed chip is, given its measured label. */
export function questChipSize(labelWidth: number, scale: number): { w: number; h: number } {
  const c = QUEST_CHIP

  return {
    w: c.padX * 2 * scale + c.markSize * scale + c.gap * scale + labelWidth + c.gap * scale + c.chevron * scale,
    h: c.height * scale,
  }
}
