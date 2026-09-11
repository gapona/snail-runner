/**
 * The on-device frame-time overlay: `?perf=1` on a perf build, and nothing anywhere else.
 *
 * **It is DOM, not a Phaser scene, on purpose.** An instrument drawn inside the frame it measures
 * is part of the measurement — a `Text` re-rendered four times a second is a canvas upload the
 * game does not otherwise make. A `<pre>` beside the canvas costs the game nothing, and it is the
 * game's cost this exists to report.
 *
 * **It is absent from the production bundle by the same mechanism `perfReport.ts` and
 * `SteerTuner` are.** `main.ts` references this module only inside an
 * `import.meta.env.DEV || import.meta.env.MODE === 'perf'` branch; Vite replaces both statically,
 * the branch is dead in a production build, and Rollup drops the module. `check-bundle.mjs` greps
 * `dist/` for `snail-perf-overlay` — the element id below — so "we gated it" and "it is gone" stay
 * two claims. `npm run build:perf` builds with `--mode perf` into `dist-perf/`, which no guard
 * reads and no bundle zips.
 *
 * Everything below reads `game.events` at `PRE_STEP` and `POST_RENDER` and touches nothing else in
 * the game: no scene, no pool, no renderer state. The MSAA toggle reloads the page, because a
 * context attribute cannot change after the context exists.
 */
import type * as Phaser from 'phaser'
import { FrameStats, LONG_FRAME_MS, DROPPED_FRAME_MS, type FrameStatsSnapshot } from './frameStats'
import { msaaDisabled, toggledMsaaSearch } from './perfFlags'

/** The element id, and the literal `check-bundle.mjs` forbids in a production build. */
export const OVERLAY_ID = 'snail-perf-overlay'

/** Frames between two redraws of the text — a quarter of a second at 60Hz. */
const REFRESH_EVERY_FRAMES = 15

/**
 * Sets the WebGL context attributes the flags ask for. Must run before `new Phaser.Game(...)`,
 * because that is when the context is created and the attribute is read.
 *
 * Only `antialiasGL`, the context attribute, and never `antialias`: the latter is the texture
 * filter (`LINEAR` against `NEAREST`), and switching that would change every sprite's sampling
 * rather than the one thing the flag is asking about, which is the framebuffer's multisampling.
 */
export function applyPerfRenderFlags(config: Phaser.Types.Core.GameConfig, search: string): void {
  if (!msaaDisabled(search)) return
  config.render = { ...config.render, antialiasGL: false }
}

interface Memory {
  usedJSHeapSize: number
}

/** `performance.memory` is Chrome-only and not in the lib types; absent on Safari and Firefox. */
function readHeap(): number | undefined {
  const memory = (performance as unknown as { memory?: Memory }).memory
  return memory?.usedJSHeapSize
}

interface DeviceInfo {
  frame: string
  renderer: string
  samples: string
  gpu: string
}

function describeDevice(game: Phaser.Game): DeviceInfo {
  const frame = `${game.scale.width}x${game.scale.height} @${window.devicePixelRatio.toFixed(1)}`
  const gl = (game.renderer as { gl?: WebGLRenderingContext }).gl
  if (!gl) return { frame, renderer: 'Canvas', samples: '-', gpu: '-' }

  const samples = gl.getParameter(gl.SAMPLES) as number
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const gpu = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
  const version = gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1'
  return { frame, renderer: version, samples: samples > 0 ? `MSAA ${samples}x` : 'MSAA off', gpu }
}

function ms(value: number): string {
  return value.toFixed(1).padStart(5)
}

function mb(bytes: number | null): string {
  return bytes === null ? 'n/a' : `${(bytes / 1048576).toFixed(1)}MB`
}

function activeSceneLine(game: Phaser.Game): string {
  const scenes = game.scene.getScenes(true)
  if (scenes.length === 0) return 'scene -'
  return scenes.map((scene) => `${scene.scene.key}:${scene.children.length}`).join(' ')
}

function renderText(device: DeviceInfo, stats: FrameStatsSnapshot, sceneLine: string): string {
  const pct = stats.frames > 0 ? ((100 * stats.long) / stats.frames).toFixed(1) : '0.0'
  return [
    `${device.frame}  ${device.renderer}  ${device.samples}`,
    device.gpu,
    `        p50    p90    p99    max   (n ${stats.wall.n})`,
    `wall  ${ms(stats.wall.p50)}  ${ms(stats.wall.p90)}  ${ms(stats.wall.p99)}  ${ms(stats.wall.max)}`,
    `cpu   ${ms(stats.cpu.p50)}  ${ms(stats.cpu.p90)}  ${ms(stats.cpu.p99)}  ${ms(stats.cpu.max)}`,
    `long >${LONG_FRAME_MS}ms ${stats.long}/${stats.frames} (${pct}%)   >${DROPPED_FRAME_MS}ms ${stats.dropped}   skipped ${stats.skipped}`,
    `heap ${mb(stats.heapBytes)}  peak ${mb(stats.heapPeakBytes)}  gc ${stats.gcs ?? 'n/a'}  biggest drop ${mb(stats.gcLargestDropBytes)}`,
    sceneLine,
  ].join('\n')
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.textContent = label
  el.style.cssText =
    'font: 12px monospace; padding: 6px 10px; margin: 0 6px 0 0; background: #223; color: #cde;' +
    ' border: 1px solid #58a; border-radius: 4px; pointer-events: auto; touch-action: manipulation;'
  el.addEventListener('click', onClick)
  return el
}

export function mountPerfOverlay(game: Phaser.Game): void {
  if (document.getElementById(OVERLAY_ID)) return

  const stats = new FrameStats()

  const root = document.createElement('div')
  root.id = OVERLAY_ID
  // Fixed over the page rather than inside `#app`, and transparent to the pointer everywhere
  // except its buttons: the game steers from wherever the finger is, and a panel that swallowed a
  // drag across it would be an instrument that changes what it measures.
  root.style.cssText =
    'position: fixed; left: 0; top: 34%; z-index: 10; pointer-events: none;' +
    ' background: rgba(0, 0, 0, 0.62); color: #dfe; padding: 6px 8px; max-width: 100vw; box-sizing: border-box;'

  const pre = document.createElement('pre')
  pre.style.cssText = 'margin: 0 0 6px; font: 11px/1.35 monospace; white-space: pre; overflow-x: auto;'
  root.appendChild(pre)

  // Read on the first refresh, not at mount: `mountPerfOverlay` runs on the line after
  // `new Phaser.Game(...)`, when the scale manager has no size yet and the WebGL context does not
  // exist. Both are there by the time a frame has rendered.
  let device: DeviceInfo | null = null
  let lastSnapshot: FrameStatsSnapshot = stats.snapshot()

  const report = (): string =>
    JSON.stringify(
      {
        device,
        userAgent: navigator.userAgent,
        msaaFlag: msaaDisabled(location.search) ? 'off' : 'default',
        stats: lastSnapshot,
        scenes: activeSceneLine(game),
      },
      null,
      2,
    )

  const bar = document.createElement('div')
  bar.style.cssText = 'display: flex; flex-wrap: wrap;'
  bar.appendChild(button('reset', () => stats.reset()))
  bar.appendChild(
    button(msaaDisabled(location.search) ? 'MSAA: off → on' : 'MSAA: on → off', () => {
      location.search = toggledMsaaSearch(location.search)
    }),
  )
  bar.appendChild(
    button('copy JSON', () => {
      const text = report()
      // The clipboard API is refused outside a secure context, which a LAN http:// preview is not
      // — the JSON then goes into the panel itself, where a long press selects it.
      void navigator.clipboard?.writeText(text).catch(() => {
        pre.textContent = text
      })
      if (!navigator.clipboard) pre.textContent = text
    }),
  )
  root.appendChild(bar)
  document.body.appendChild(root)

  let frameStart = -1
  let lastFrameStart = -1
  let sinceRefresh = 0

  game.events.on('prestep', () => {
    frameStart = performance.now()
  })
  game.events.on('postrender', () => {
    const now = performance.now()
    if (lastFrameStart >= 0 && frameStart >= 0) {
      stats.push(frameStart - lastFrameStart, now - frameStart, readHeap())
    }
    lastFrameStart = frameStart

    if (++sinceRefresh < REFRESH_EVERY_FRAMES) return
    sinceRefresh = 0
    device ??= describeDevice(game)
    lastSnapshot = stats.snapshot()
    pre.textContent = renderText(device, lastSnapshot, activeSceneLine(game))
  })
}
