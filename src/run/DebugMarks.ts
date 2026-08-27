import * as Phaser from 'phaser'

/**
 * DEV-only overlay that labels every dark patch on the ground with what drew it.
 *
 * **⚠ This exists because "there are stray dark spots on the road" has two completely different
 * causes with opposite fixes, and no screenshot can tell them apart.** Either they are decals —
 * marks the ground carries on its own, which would be turned off — or they are shadows left behind
 * by objects that have already despawned, which is a pool desync and would not be helped at all by
 * touching decals. Guessing costs a wasted round; asking the code that drew each patch costs this
 * file.
 *
 * Every label is sourced from the renderer that actually emitted the mark, in the same frame, so a
 * patch with no label is itself the answer: something is drawing that nobody admits to.
 *
 * Behind `import.meta.env.DEV` at the call site, and the whole module is tree-shaken out of a
 * production build — the static import in `RunScene` sits inside a DEV branch, which is the shape
 * `perfReport.ts` established after a gated *call* was found to keep its module in the bundle.
 */
export interface MarkSource {
  x: number
  y: number
  label: string
}

/** Colour per source, so the two classes are separable at a glance as well as by reading. */
const DECAL_COLOUR = '#ffd24a'
const SHADOW_COLOUR = '#4adcff'
const ORPHAN_COLOUR = '#ff4d6d'

export class DebugMarks {
  private readonly labels: Phaser.GameObjects.Text[] = []
  private readonly graphics: Phaser.GameObjects.Graphics

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {
    this.graphics = scene.add.graphics().setDepth(depth)
  }

  /** Everything the overlay draws, for the scene's camera `ignore` lists. */
  get gameObjects(): Phaser.GameObjects.GameObject[] {
    return [this.graphics, ...this.labels]
  }

  /**
   * Draws one label per mark.
   *
   * `decals` and `shadows` come from the renderers themselves. `orphans` is the interesting case:
   * a shadow drawn at a position no live object claims. It is passed separately rather than
   * derived here, because only the scene knows which objects are alive.
   */
  update(decals: readonly MarkSource[], shadows: readonly MarkSource[], orphans: readonly MarkSource[]): void {
    const all = [
      ...decals.map((m) => ({ ...m, colour: DECAL_COLOUR })),
      ...shadows.map((m) => ({ ...m, colour: SHADOW_COLOUR })),
      ...orphans.map((m) => ({ ...m, colour: ORPHAN_COLOUR })),
    ]

    this.graphics.clear()

    while (this.labels.length < all.length) {
      this.labels.push(
        this.scene.add
          .text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff' })
          .setOrigin(0.5, 1)
          .setDepth(this.depth + 1),
      )
    }

    for (const [i, label] of this.labels.entries()) {
      const mark = all[i]

      if (!mark) {
        label.setVisible(false)
        continue
      }

      // A ring on the mark and a leader up to the text: at this density the labels overlap, and a
      // label that cannot be traced back to its own patch is worse than no label.
      this.graphics.lineStyle(1.5, Number.parseInt(mark.colour.slice(1), 16), 0.9)
      this.graphics.strokeCircle(mark.x, mark.y, 7)
      this.graphics.lineBetween(mark.x, mark.y - 7, mark.x, mark.y - 18)

      label.setVisible(true)
      label.setPosition(mark.x, mark.y - 18)
      label.setText(mark.label)
      label.setColor(mark.colour)
    }
  }

  destroy(): void {
    this.graphics.destroy()
    for (const label of this.labels) label.destroy()
  }
}
