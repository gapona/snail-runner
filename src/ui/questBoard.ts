import * as Phaser from 'phaser'
import { KIT } from './kitPalette'
import { toCssColor } from './theme'
import { applyPanelInk, plate } from './kit'
import { getDisplayFontStack } from './font'
import { ensureMinHitArea } from './uiScale'
import { t } from '../i18n/strings'
import { pipFills } from './fruitGauge'
import {
  questBarSegments,
  QUEST_CHIP,
  QUEST_PANEL,
  QUEST_ROW,
  questChipSize,
  questPanelSize,
  questRowColumns,
  questSegmentBox,
  type QuestBarBox,
} from './questLayout'
import {
  isQuestComplete,
  questProgress,
  questReward,
  QUEST_SLOTS,
  type Quest,
  type QuestBoard,
  type QuestKind,
} from '../run/quests'

/**
 * The quest board on the front screen: three things to go and do, and a button to take the pay.
 *
 * ## ⚠ It was three lines of text and a bar, hanging over the sky
 *
 * No container, no heading, interface type rather than the game's, no mark to say what a row was
 * about, and tracks of a shape used nowhere else — reported as reading like debug output, which is
 * a fair description of a list rendered with none of the things that make a list a panel. It also
 * sat between the wordmark and the mascot and **cut the frame in half**, leaving the creature the
 * third-largest thing on its own front screen, behind the type and the interface.
 *
 * Both halves are fixed by the same decision: the board is a **panel**, in the kit's own language,
 * and it is **collapsed by default** into one chip that says how many are done. The panel is
 * something the player asks for; what the front screen shows unasked is the game.
 *
 * ## ⚠ It has a plate, and this screen has had three plates removed from it
 *
 * The measured scrim under the title, the strip under the buttons and the pickups' bright rim were
 * each argued for correctly and each reported on sight — *a contrast device is judged on a frame,
 * not on the argument for it*. This one is allowed for the tutorial card's reasons, which are the
 * three that distinguish it: it is **temporary** (collapsed unless asked for), it sits over the
 * **sky** rather than over the picture's subject, and it carries text that has to be *read* rather
 * than glanced at. A permanent plate on the near ground is a slab across the road; a panel the
 * player opened is a panel.
 *
 * ## The track is the Fever gauge, laid on its side
 *
 * Same eight segments, same socket-fill-lit-rim drawing, and the fill comes from `pipFills` — the
 * function the tank itself calls — so the two readouts cannot drift into two shapes. What differs
 * is what a segment *means*: see `QUEST_BAR_SEGMENTS`.
 */

/**
 * What each kind asks for, as the verb rather than the sum.
 *
 * **⚠ The numbers came out of the label when the row grew a counter.** It read `Collect 14 fruit`
 * beside `6/14`, which is the target stated twice and the row's widest column spent on the
 * repetition — on a 320px frame the label then had to shrink past the count it was duplicating.
 * The label names the verb, the counter carries the numbers, and the two say different things.
 */
const LABEL_KEYS: Record<QuestKind, 'questFruit' | 'questNearMiss' | 'questFever' | 'questRamp'> = {
  fruit: 'questFruit',
  nearMiss: 'questNearMiss',
  fever: 'questFever',
  ramp: 'questRamp',
}

/**
 * The marks' colours, and each mark is the object its quest is about.
 *
 * Drawn rather than set as glyphs, for the mode chip's reason: an emoji is whatever the platform's
 * font supplies and reads as a chat message dropped into a game. Fruit is the pickup, the near miss
 * is a barrier with the mascot's own amber squeezing past it, the Fever is three segments of the
 * tank this board's own tracks are drawn as, and the ramp is a wedge with the gold chevron the real
 * one carries.
 */
const MARK = {
  fruit: 0xe8622f,
  fruitLit: 0xffb05c,
  leaf: 0x5f9b3e,
  fever: 0xf2b431,
  feverLit: 0xffe3a8,
  mascot: 0xffa63d,
  stone: 0x9aa7b4,
} as const

const LABEL_SIZE = 15
const COUNT_SIZE = 14
const COLLECT_SIZE = 12
/** The payout's own face. Smaller than the label: it is a fact about the row, not its name. */
const REWARD_SIZE = 12
/** How far a row's label may be shrunk to clear the payout beside it. */
const LABEL_MIN_FIT = 0.75
const TITLE_SIZE = 20
const CHIP_LABEL_SIZE = 15

/** The lit edge a filled track carries, running and finished. */
const TRACK_LIT = { running: 0xd6f4ff, done: 0xfff0cf } as const

function drawMark(g: Phaser.GameObjects.Graphics, kind: QuestKind, size: number): void {
  const half = size / 2

  g.clear()

  if (kind === 'fruit') {
    g.fillStyle(MARK.fruit, 1)
    g.fillCircle(0, half * 0.22, half * 0.72)
    g.fillStyle(MARK.fruitLit, 0.85)
    g.fillCircle(-half * 0.22, half * 0.02, half * 0.26)
    // The stem, which is what stops a filled circle reading as the coin.
    g.lineStyle(Math.max(1.5, size * 0.1), MARK.leaf, 1)
    g.beginPath()
    g.moveTo(0, -half * 0.5)
    g.lineTo(half * 0.45, -half)
    g.strokePath()
    return
  }

  if (kind === 'nearMiss') {
    // A barrier, and the mascot's own amber going past it with a hair of daylight between.
    //
    // **⚠ The post was drawn `size * 1.6` tall in a `size` box** and ran off the mark's own canvas
    // top and bottom — the leg-off-the-canvas defect this project already records for the critters,
    // and invisible for the same reason: `Graphics` crops silently. Every extent here is now stated
    // against `half` so it can be read against the box at a glance.
    const postW = size * 0.3
    const postH = size * 0.8

    g.fillStyle(MARK.stone, 1)
    g.fillRoundedRect(-half, -postH / 2, postW, postH, postW * 0.35)
    g.fillStyle(MARK.mascot, 1)
    g.fillCircle(half * 0.4, 0, half * 0.5)
    return
  }

  if (kind === 'fever') {
    // Three of the tank's own segments, the top one dark — the readout this row's track is made of.
    const h = size * 0.26
    const gap = size * 0.09

    for (let i = 0; i < 3; i++) {
      const y = half - h - i * (h + gap)

      g.fillStyle(i < 2 ? MARK.fever : KIT.plate, i < 2 ? 1 : 0.85)
      g.fillRoundedRect(-half * 0.7, y, size * 0.7, h, h * 0.35)
    }
    g.lineStyle(Math.max(1, size * 0.06), MARK.feverLit, 0.8)
    g.strokeRoundedRect(-half * 0.7, half - h * 3 - gap * 2, size * 0.7, h * 3 + gap * 2, h * 0.35)
    return
  }

  // A ramp: the wedge, seen from the side, with its gold chevron on the slope.
  g.fillStyle(MARK.stone, 1)
  g.fillTriangle(-half, half * 0.85, half, half * 0.85, half, -half * 0.7)
  g.fillStyle(KIT.coin, 1)
  g.fillTriangle(half * 0.02, half * 0.24, half * 0.52, half * 0.24, half * 0.3, -half * 0.24)
}

/** `›`, `▾` and `▴` as strokes, for the reason the marks are drawn rather than set. */
function drawChevron(g: Phaser.GameObjects.Graphics, size: number, dir: 'up' | 'down' | 'right'): void {
  const weight = Math.max(1.8, size * 0.24)

  g.clear()
  g.lineStyle(weight, KIT.rim, 0.9)
  g.beginPath()
  if (dir === 'right') {
    g.moveTo(-size * 0.3, -size * 0.5)
    g.lineTo(size * 0.3, 0)
    g.lineTo(-size * 0.3, size * 0.5)
  } else {
    const sign = dir === 'down' ? 1 : -1

    g.moveTo(-size * 0.5, -size * 0.28 * sign)
    g.lineTo(0, size * 0.28 * sign)
    g.lineTo(size * 0.5, -size * 0.28 * sign)
  }
  g.strokePath()
}

/**
 * One track, drawn as the Fever tank is: a socket per segment, a lit body inside it, a rim over
 * both so a full and an empty segment are the same *shape*.
 *
 * A finished quest fills every segment in the coin accent and takes a tick at its right end — one
 * of the three marks a done row carries, beside the coin-coloured label and the collect button.
 */
function drawTrack(
  g: Phaser.GameObjects.Graphics,
  bar: QuestBarBox,
  fill: number,
  done: boolean,
  scale: number,
  target: number,
): void {
  // **The target's own segment count, capped at `QUEST_BAR_SEGMENTS`** — see `questBarSegments`.
  // Eight sockets beside `0/2` is the track disagreeing with the counter next to it.
  const count = questBarSegments(target)
  const fills = done ? Array.from({ length: count }, () => 1) : pipFills(fill, count)
  const body = done ? KIT.coin : KIT.active
  const lit = done ? TRACK_LIT.done : TRACK_LIT.running
  const radius = Math.min(bar.h, bar.w / count) * 0.34

  g.clear()

  for (let i = 0; i < fills.length; i++) {
    const seg = questSegmentBox(i, bar, count, scale)
    const amount = fills[i]

    g.fillStyle(KIT.plate, 0.72)
    g.fillRoundedRect(seg.x, seg.y, seg.w, seg.h, radius)

    if (amount > 0) {
      const inset = seg.h * 0.16
      const w = (seg.w - inset) * amount

      g.fillStyle(body, 1)
      g.fillRoundedRect(seg.x + inset / 2, seg.y + inset / 2, w, seg.h - inset, radius * 0.7)
      // Lit from above, like everything else this game draws.
      g.fillStyle(lit, 0.5)
      g.fillRoundedRect(seg.x + inset, seg.y + inset, Math.max(0, w - inset), (seg.h - inset) * 0.34, radius * 0.5)
    }

    g.lineStyle(Math.max(1, seg.h * 0.09), amount > 0 ? lit : KIT.muted, amount > 0 ? 0.9 : 0.5)
    g.strokeRoundedRect(seg.x, seg.y, seg.w, seg.h, radius)
  }

  if (done) {
    const weight = Math.max(1.6, bar.h * 0.16)
    const cx = bar.x + bar.w - bar.h * 0.6
    const cy = bar.y + bar.h / 2

    g.lineStyle(weight, KIT.plate, 1)
    g.beginPath()
    g.moveTo(cx - bar.h * 0.26, cy)
    g.lineTo(cx - bar.h * 0.06, cy + bar.h * 0.2)
    g.lineTo(cx + bar.h * 0.28, cy - bar.h * 0.24)
    g.strokePath()
  }
}

interface Row {
  mark: Phaser.GameObjects.Graphics
  label: Phaser.GameObjects.Text
  bar: Phaser.GameObjects.Graphics
  count: Phaser.GameObjects.Text
  /** The collect button's pill. Drawn only while the row is claimable. */
  action: Phaser.GameObjects.Graphics
  collect: Phaser.GameObjects.Text
  reward: Phaser.GameObjects.Text
  /** The quest this row currently shows, so a tap knows which to claim. */
  questId: number
}

export interface QuestBoardView {
  /** Everything the board draws with — for the camera split and the entry cascade's one list. */
  readonly objects: Phaser.GameObjects.GameObject[]
  /** What a tap toggles: the collapsed chip, and the open panel's own heading. */
  readonly chip: Phaser.GameObjects.Container
  readonly header: Phaser.GameObjects.Zone
  /** One per slot, bound once in `create` — the rows are reused, never rebuilt. */
  readonly collectTargets: Phaser.GameObjects.Text[]
  readonly expanded: boolean
  /** How many rows the last `layout` actually drew — see the floor it is dropped against. */
  readonly rowsShown: number
  /** The board's bottom edge in screen pixels, for whatever the menu stacks under it. */
  readonly bottom: number
  questIdAt(index: number): number
  setBoard(board: QuestBoard): void
  setExpanded(expanded: boolean): void
  layout(x: number, y: number, frameWidth: number, scale: number, floor: number): void
  destroy(): void
}

/**
 * Builds the board. Positioned entirely in `layout`, per the layout contract.
 *
 * `depth` is the depth the board's *content* sits at; the plate places itself below it — see
 * `kit.ts`'s `plate`, and the defect that once put a panel's rim over its own title.
 */
export function createQuestBoard(scene: Phaser.Scene, depth: number): QuestBoardView {
  const panel = plate(scene, depth)
  const title = scene.add
    .text(0, 0, t('questsTitle'), {
      fontFamily: getDisplayFontStack(),
      fontSize: TITLE_SIZE,
      color: toCssColor(KIT.rim),
    })
    .setOrigin(0, 0.5)
    .setDepth(depth + 2)
  const headerChevron = scene.add.graphics().setDepth(depth + 2)
  // A `Zone` rather than a container: the heading is a hit area over two objects that are already
  // positioned in screen coordinates, and a container would add its own origin offset to both.
  const header = scene.add.zone(0, 0, 1, 1)

  const chipBg = scene.add.graphics()
  const chipMark = scene.add.graphics()
  const chipLabel = scene.add
    .text(0, 0, '', { fontFamily: getDisplayFontStack(), fontSize: CHIP_LABEL_SIZE, color: toCssColor(KIT.rim) })
    .setOrigin(0, 0.5)
  const chipChevron = scene.add.graphics()
  const chipBadge = scene.add.graphics()
  const chip = scene.add
    .container(0, 0, [chipBg, chipMark, chipLabel, chipChevron, chipBadge])
    .setDepth(depth + 2)

  applyPanelInk(title, TITLE_SIZE)

  const rows: Row[] = Array.from({ length: QUEST_SLOTS }, () => ({
    mark: scene.add.graphics().setDepth(depth + 1),
    bar: scene.add.graphics().setDepth(depth + 1),
    action: scene.add.graphics().setDepth(depth + 1),
    label: scene.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: LABEL_SIZE, color: toCssColor(KIT.rim) })
      .setOrigin(0, 0.5)
      .setDepth(depth + 2),
    count: scene.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: COUNT_SIZE, color: toCssColor(KIT.muted) })
      .setOrigin(0.5, 0.5)
      .setDepth(depth + 2),
    /**
     * What the row pays, in the coin accent.
     *
     * **⚠ Reported as "what do we get for a mission? the reward is not visible", and it was not:**
     * `questReward` was *imported by this file and never called*. The sixth authored quantity this
     * project has found doing nothing, after `cooldownMs`, `fanScale`, `arcRelaid`, `SFX.MILESTONE`
     * and `PICKUP_WEIGHTS` — and the first that was invisible because of an unused **import** rather
     * than an unread constant.
     *
     * Right-aligned against the track, so the row reads: what, which, **what it pays**, how far,
     * take it. In `KIT.coin` because that is the colour this game has taught means money since the
     * first coin on the road.
     */
    reward: scene.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: REWARD_SIZE, color: toCssColor(KIT.coin) })
      .setOrigin(1, 0.5)
      .setDepth(depth + 2),
    collect: scene.add
      .text(0, 0, '', {
        fontFamily: 'Arial',
        fontSize: COLLECT_SIZE,
        color: toCssColor(KIT.plate),
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(depth + 3),
    questId: -1,
  }))

  let board: QuestBoard | null = null
  let expanded = false
  let bottom = 0
  let rowsShown = 0

  const rowObjects = (row: Row): (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] => [
    row.mark,
    row.bar,
    row.action,
    row.label,
    row.count,
    row.collect,
    row.reward,
  ]

  const liveQuests = (): Quest[] => (board?.active ?? []).filter((quest) => !quest.claimed)

  /** How many of the live quests are claimable — the number the collapsed chip exists to carry. */
  const doneCount = (): number => liveQuests().filter(isQuestComplete).length

  function setRectHitArea(object: Phaser.GameObjects.GameObject & { input: Phaser.Types.Input.InteractiveObject | null }, x: number, y: number, w: number, h: number): void {
    if (!object.input) {
      object.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(x, y, w, h),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      })
      return
    }
    ;(object.input.hitArea as Phaser.Geom.Rectangle).setTo(x, y, w, h)
  }

  function layoutChip(x: number, y: number, scale: number): { w: number; h: number } {
    const c = QUEST_CHIP
    const done = doneCount()
    const total = liveQuests().length || QUEST_SLOTS

    chipLabel.setFontSize(CHIP_LABEL_SIZE * scale)
    chipLabel.setText(`${t('questsTitle')} ${done}/${total}`)
    chipLabel.setColor(toCssColor(done > 0 ? KIT.coin : KIT.rim))

    const size = questChipSize(chipLabel.width, scale)
    const halfW = size.w / 2
    const halfH = size.h / 2

    chip.setPosition(x + halfW, y + halfH)

    chipBg.clear()
    chipBg.fillStyle(KIT.plate, 0.82)
    chipBg.fillRoundedRect(-halfW, -halfH, size.w, size.h, 11 * scale)
    chipBg.lineStyle(Math.max(1.5, 2 * scale), done > 0 ? KIT.coin : KIT.rim, done > 0 ? 0.95 : 0.55)
    chipBg.strokeRoundedRect(-halfW, -halfH, size.w, size.h, 11 * scale)

    // A ticked box: the one mark that means "a list of things to do" without a word.
    const mark = c.markSize * scale
    let cursor = -halfW + c.padX * scale

    chipMark.clear()
    chipMark.lineStyle(Math.max(1.4, mark * 0.12), done > 0 ? KIT.coin : KIT.rim, 0.9)
    chipMark.strokeRoundedRect(-mark / 2, -mark / 2, mark, mark, mark * 0.22)
    chipMark.beginPath()
    chipMark.moveTo(-mark * 0.24, 0)
    chipMark.lineTo(-mark * 0.04, mark * 0.2)
    chipMark.lineTo(mark * 0.26, -mark * 0.26)
    chipMark.strokePath()
    chipMark.setPosition(cursor + mark / 2, 0)
    cursor += mark + c.gap * scale

    chipLabel.setPosition(cursor, 0)

    drawChevron(chipChevron, c.chevron * scale, 'down')
    chipChevron.setPosition(halfW - c.padX * scale - (c.chevron * scale) / 2, 0)

    // The shop's own badge, for the same reason it has one: a collapsed control that could not say
    // a reward was waiting is a collapsed control nobody opens.
    chipBadge.clear()
    if (done > 0) {
      const r = Math.max(3.5, 4.5 * scale)

      chipBadge.fillStyle(KIT.plate, 1)
      chipBadge.fillCircle(halfW - 2 * scale, -halfH + 2 * scale, r * 1.6)
      chipBadge.fillStyle(KIT.coin, 1)
      chipBadge.fillCircle(halfW - 2 * scale, -halfH + 2 * scale, r)
    }

    chip.setSize(size.w, size.h)
    // The `Container` hit-area trap: its origin is fixed at 0.5, so the tested point already
    // carries the display origin and the rectangle has to *start* at (0, 0).
    setRectHitArea(chip, 0, 0, size.w, size.h)

    return size
  }

  function layoutRow(row: Row, quest: Quest, x: number, y: number, width: number, scale: number): void {
    const columns = questRowColumns(x, y, width, scale)
    const mid = y + (QUEST_ROW.height * scale) / 2
    const done = isQuestComplete(quest)

    row.questId = quest.id

    drawMark(row.mark, quest.kind, QUEST_ROW.iconSize * scale)
    row.mark.setPosition(columns.icon.x + columns.icon.w / 2, mid)

    // **The reward is measured first, because the label is fitted into what is left of the column.**
    // A long verb and a payout in the same column is the collision every fixed-width row in this
    // project has had; the number is the half that may not be truncated.
    row.reward.setFontSize(REWARD_SIZE * scale)
    row.reward.setText(`\u{1FA99} ${questReward(quest.kind)}`)
    row.reward.setPosition(columns.label.x + columns.label.w, mid)

    row.label.setFontSize(LABEL_SIZE * scale)
    row.label.setText(t(LABEL_KEYS[quest.kind]))
    row.label.setColor(toCssColor(done ? KIT.coin : KIT.rim))
    row.label.setPosition(columns.label.x, mid)
    // **Fitted against what the payout left, measured rather than assumed.** The two share one
    // column — a left-aligned verb and a right-aligned number — and a translated label is longer
    // than an English one by however much it is. Floored, because a label shrunk past legibility is
    // not a fit; below the floor the two are allowed to close up, which no shipped string reaches.
    const room = Math.max(1, columns.label.w - row.reward.width - QUEST_ROW.gutter * scale)

    if (row.label.width > room) {
      row.label.setFontSize(Math.max(LABEL_SIZE * scale * LABEL_MIN_FIT, LABEL_SIZE * scale * (room / row.label.width)))
    }

    drawTrack(row.bar, columns.bar, questProgress(quest), done, scale, quest.target)

    row.count.setFontSize(COUNT_SIZE * scale)
    row.count.setText(done ? '' : `${quest.progress}/${quest.target}`)
    row.count.setPosition(columns.action.x + columns.action.w / 2, mid)

    row.action.clear()
    row.collect.setFontSize(COLLECT_SIZE * scale)
    row.collect.setText(done ? t('questCollect') : '')
    row.collect.setPosition(columns.action.x + columns.action.w / 2, mid)
    row.collect.setVisible(done)

    if (done) {
      const h = QUEST_ROW.height * scale * 0.8
      const w = Math.min(columns.action.w, row.collect.width + 16 * scale)

      row.action.fillStyle(KIT.coin, 1)
      row.action.fillRoundedRect(columns.action.x + columns.action.w / 2 - w / 2, mid - h / 2, w, h, h / 2)
      // The hit area has to follow the text, which only has a size once it has been set — the same
      // rule the shield pips and the speed badge's chrome are both under. Correct use of the
      // helper: a standalone `Text` acting as its own button, never a child of an interactive
      // container.
      ensureMinHitArea(row.collect)
    }
  }

  return {
    objects: [...panel.gameObjects, title, headerChevron, chip, ...rows.flatMap(rowObjects)],
    chip,
    header,
    collectTargets: rows.map((row) => row.collect),
    get expanded() {
      return expanded
    },
    get rowsShown() {
      return rowsShown
    },
    get bottom() {
      return bottom
    },
    questIdAt(index) {
      return rows[index]?.questId ?? -1
    },
    setBoard(next) {
      board = next
    },
    setExpanded(next) {
      expanded = next
    },
    layout(x, y, frameWidth, scale, floor) {
      const live = liveQuests()

      // One state, drawn one way — never both, which is how a collapsed panel ends up leaving its
      // own heading on screen.
      chip.setVisible(!expanded)
      title.setVisible(expanded)
      headerChevron.setVisible(expanded)
      for (const row of rows) for (const object of rowObjects(row)) object.setVisible(false)

      rowsShown = 0

      if (!expanded) {
        panel.clear()
        header.setSize(1, 1)
        setRectHitArea(header, 0, 0, 1, 1)
        bottom = y + layoutChip(x, y, scale).h
        return
      }

      const size = questPanelSize(live.length, scale, frameWidth, x)
      const contentX = x + QUEST_PANEL.padX * scale
      const contentW = size.w - QUEST_PANEL.padX * 2 * scale
      const headerH = QUEST_PANEL.padY * scale + QUEST_PANEL.headerHeight * scale

      panel.draw(x + size.w / 2, y + size.h / 2, size.w, size.h)

      title.setFontSize(TITLE_SIZE * scale)
      applyPanelInk(title, TITLE_SIZE * scale)
      title.setPosition(contentX, y + QUEST_PANEL.padY * scale + (QUEST_PANEL.headerHeight * scale) / 2)

      drawChevron(headerChevron, QUEST_CHIP.chevron * scale, 'up')
      headerChevron.setPosition(x + size.w - QUEST_PANEL.padX * scale - (QUEST_CHIP.chevron * scale) / 2, title.y)

      // The heading is the collapse control, which is where a player looks to shut a panel. A
      // `Zone`'s origin is 0.5, so it is positioned by its centre and its rectangle starts at 0.
      header.setPosition(x + size.w / 2, y + headerH / 2).setSize(size.w, headerH)
      setRectHitArea(header, 0, 0, size.w, headerH)

      let rowY = y + headerH + QUEST_PANEL.headerGap * scale

      for (let i = 0; i < rows.length; i++) {
        const quest = live[i]

        // A row that would run past the floor is dropped rather than drawn off the bottom of the
        // frame. The chip's own count still tells the truth, which is what makes that safe.
        if (!quest || rowY + QUEST_ROW.height * scale > floor) continue

        for (const object of rowObjects(rows[i])) object.setVisible(true)
        layoutRow(rows[i], quest, contentX, rowY, contentW, scale)
        rows[i].collect.setVisible(isQuestComplete(quest))
        rowsShown += 1
        rowY += (QUEST_ROW.height + QUEST_ROW.gap) * scale
      }

      bottom = y + size.h
    },
    destroy() {
      panel.destroy()
      header.destroy()
      title.destroy()
      headerChevron.destroy()
      chip.destroy(true)
      for (const row of rows) for (const object of rowObjects(row)) object.destroy()
    },
  }
}
