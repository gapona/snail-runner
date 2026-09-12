import type * as Phaser from 'phaser'

/**
 * Compiling every shader variant the sprite batch can ask for, while the loading bar is up.
 *
 * **⚠ Phaser 4 compiles a new program for every texture COUNT it meets.** `BatchHandlerQuad.run`
 * calls `finalizeTextureCount(entry.unit)` for each sub-batch and asks the program manager for a
 * program built for exactly that many texture units — `STANDARD__…_7TexCount_GetTexture7_Tint` is
 * a different program from the `…8…` one, and each is compiled and linked **synchronously** the
 * first time a batch happens to hold that many textures. Up to sixteen of them for the sprite
 * batch and sixteen more for the tile-sprite one.
 *
 * Which counts turn up depends on what is on screen, so they arrive one at a time across the first
 * minutes of a session: measured on a desktop, the menu compiled the 1-, 2-, 3-, 4-, 5-, 7- and
 * 8-texture variants and the tenth frame of the first run compiled the 9. A compile is nothing on a
 * desktop GPU and a stall on a phone's — which is the report exactly: **the start of a run stutters
 * and later it is fine**, because by then every count the game ever produces has been compiled
 * once and cached for the rest of the session.
 *
 * So each variant is compiled here instead, one per frame of the loading screen, where the main
 * thread is otherwise waiting on the network. `Preloader.create` flushes whatever is left before
 * handing over, so no variant is ever first compiled in front of the player.
 *
 * **Not `render.skipUnreadyShaders`.** That is Phaser's own answer — compile in parallel and skip
 * drawing whatever asks for a program that is not ready — and it trades the stutter for objects
 * missing from the frame until their shader lands. It is off here (Phaser's default), which is why
 * a first-time variant is a synchronous stall rather than a pop-in.
 *
 * **Touches renderer internals, and says which.** `renderNodes.getNode`, a node's
 * `maxTexturesPerBatch`, `finalizeTextureCount` and `programManager.getCurrentProgramSuite` are all
 * public members of the render-node classes, and the last is the exact call `run` makes, so the key
 * a warmed program is cached under is the key the game later asks for. The node's addition state is
 * left at the last count warmed, which is harmless: `run` sets it again before every draw.
 */

/**
 * The batch handlers whose programs vary with the texture count, and the additions each is drawn
 * with in this game.
 *
 * **⚠ The tile-sprite batch is never drawn in its default configuration here**, and the first
 * version of this warmed that default — sixteen programs compiled for nothing, and the two the game
 * really uses (`…TexCoordFrameWrap_1…` and `…_4…`: the sky layers, the clouds and the range all
 * wrap their frame) still compiled in front of the player. A program's key is its whole addition
 * list, so a warm-up is only worth anything in the exact configuration the frame will ask for.
 * Measured by listing `shaderProgramFactory.programs` after a menu and a run.
 */
const COUNTED_BATCHES: readonly { node: string; enable: readonly string[] }[] = [
  { node: 'BatchHandlerQuad', enable: [] },
  { node: 'BatchHandlerTileSprite', enable: ['TexCoordFrameWrap'] },
]

interface Addition {
  disable?: boolean
}

interface CountedBatch {
  maxTexturesPerBatch: number
  finalizeTextureCount(count: number): void
  programManager: { getCurrentProgramSuite(): unknown; getAddition(name: string): Addition | null | undefined }
}

interface NodeSource {
  renderNodes?: { getNode(name: string): unknown }
}

function isCountedBatch(node: unknown): node is CountedBatch {
  const candidate = node as Partial<CountedBatch> | null

  return (
    !!candidate &&
    typeof candidate.maxTexturesPerBatch === 'number' &&
    typeof candidate.finalizeTextureCount === 'function' &&
    typeof candidate.programManager?.getCurrentProgramSuite === 'function' &&
    typeof candidate.programManager?.getAddition === 'function'
  )
}

/**
 * One job per program: every texture count, for each batch whose programs depend on it.
 *
 * Empty under the Canvas renderer, which has no programs, and for any node whose shape is not the
 * one described above — a Phaser upgrade that renames these members turns this into a no-op rather
 * than a crash on the loading screen.
 */
export function shaderWarmupJobs(game: Phaser.Game): (() => void)[] {
  const renderer = game.renderer as unknown as NodeSource

  if (!renderer.renderNodes) return []

  const jobs: (() => void)[] = []

  for (const batch of COUNTED_BATCHES) {
    const node = renderer.renderNodes.getNode(batch.node)

    if (!isCountedBatch(node)) continue

    const additions = batch.enable.map((name) => node.programManager.getAddition(name))

    // An addition this Phaser does not have would warm a key the game never asks for.
    if (additions.some((addition) => !addition)) continue

    for (let count = 1; count <= node.maxTexturesPerBatch; count++) {
      jobs.push(() => {
        // Switched on for the compile and put back exactly as found, so the node's own record of
        // its render options still describes its addition list when it next draws.
        const was = additions.map((addition) => addition!.disable)

        for (const addition of additions) addition!.disable = false
        node.finalizeTextureCount(count)
        node.programManager.getCurrentProgramSuite()
        additions.forEach((addition, i) => (addition!.disable = was[i]))
      })
    }
  }

  return jobs
}
