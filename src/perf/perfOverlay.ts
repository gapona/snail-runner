/**
 * The on-device frame-time overlay: `?perf=1` on a perf build, and nothing anywhere else.
 *
 * **It is DOM, not a Phaser scene, on purpose.** An instrument drawn inside the frame it measures
 * is part of the measurement — a `Text` re-rendered four times a second is a canvas upload the
 * game does not otherwise make. A `<pre>` beside the canvas costs the game nothing, and it is the
 * game's cost this exists to report.
 *
 * **⚠ And a DOM text update is not free either, which the first phone reading showed.** Every
 * `REFRESH_EVERY_FRAMES` frames this writes a text node, and the browser lays it out and
 * re-rasters the layer between two of the game's frames — on the browser's thread, outside `cpu`
 * and inside `wall`. The refresh cadence is 1 in 30 frames and the first phone reading had 9.7%
 * long frames, so the overlay's own share has to be *measured*, not assumed away: every long
 * frame's phase against the refresh cycle is counted and the share landing right after a refresh
 * is printed beside what a uniform spread would give. See `PhaseHistogram`.
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
import { MIPS_FLAG, MSAA_FLAG, mipsRequested, msaaDisabled, toggledFlagSearch, toggledOptInSearch } from './perfFlags'

/** The element id, and the literal `check-bundle.mjs` forbids in a production build. */
export const OVERLAY_ID = 'snail-perf-overlay'

/**
 * Frames between two redraws of the text — half a second at 60Hz.
 *
 * Was 15. Halved after the first phone reading, because the refresh is the one thing this overlay
 * does that lands inside `wall`; the phase histogram says how much it costs, and a rarer refresh
 * costs less of it while the numbers stay readable.
 */
const REFRESH_EVERY_FRAMES = 30

/**
 * Where a report is POSTed. `vite.config.ts`'s `perfReportSink` answers it on `npm run
 * preview:perf` and writes the body to `perf-reports/`; a LAN `http://` page has no
 * `navigator.clipboard` (not a secure context), so this is the path that actually gets a JSON off
 * the phone. Relative, because the page is served at `./`.
 */
export const REPORT_PATH = '__perf'

/**
 * Sets the WebGL context attributes the flags ask for. Must run before `new Phaser.Game(...)`,
 * because that is when the context is created and the attribute is read.
 *
 * Only `antialiasGL`, the context attribute, and never `antialias`: the latter is the texture
 * filter (`LINEAR` against `NEAREST`), and switching that would change every sprite's sampling
 * rather than the one thing the flag is asking about, which is the framebuffer's multisampling.
 */
export function applyPerfRenderFlags(config: Phaser.Types.Core.GameConfig, search: string): void {
  if (msaaDisabled(search)) config.render = { ...config.render, antialiasGL: false }
  // The shipped config has no mipmap filter (see `config.ts` for the phone that broke on one);
  // this puts the one the atlas round used back, to ask the next device the same question.
  if (mipsRequested(search)) config.render = { ...config.render, mipmapFilter: 'LINEAR_MIPMAP_LINEAR' }
}

interface Memory {
  usedJSHeapSize: number
}

/**
 * `performance.memory` is Chrome-only and not in the lib types; absent on Safari and Firefox.
 * **On Chrome for Android it is quantised to a bucket** — the first phone reading sat at 13.6MB
 * for a whole run — so the GC count there is blind rather than zero. Read anyway; the desktop
 * reading is real and the snapshot says `n/a` where nothing is readable at all.
 */
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
  const frame = `${Math.round(game.scale.width)}x${Math.round(game.scale.height)} @${window.devicePixelRatio.toFixed(1)}`
  const gl = (game.renderer as { gl?: WebGLRenderingContext }).gl
  if (!gl) return { frame, renderer: 'Canvas', samples: '-', gpu: '-' }

  const samples = gl.getParameter(gl.SAMPLES) as number
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const gpu = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
  const version = gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1'
  const mips = (game.renderer as { mipmapFilter?: unknown }).mipmapFilter ? 'mips on' : 'mips off'
  return { frame, renderer: version, samples: `${samples > 0 ? `MSAA ${samples}x` : 'MSAA off'}  ${mips}`, gpu }
}

function ms(value: number): string {
  return value.toFixed(1).padStart(5)
}

function mb(bytes: number | null): string {
  return bytes === null ? 'n/a' : `${(bytes / 1048576).toFixed(1)}MB`
}

function pct(value: number): string {
  return `${(100 * value).toFixed(0)}%`
}

function activeSceneKeys(game: Phaser.Game): string[] {
  return game.scene.getScenes(true).map((scene) => scene.scene.key)
}

function activeSceneLine(game: Phaser.Game): string {
  const scenes = game.scene.getScenes(true)
  if (scenes.length === 0) return 'scene -'
  return scenes.map((scene) => `${scene.scene.key}:${scene.children.length}`).join(' ')
}

/** One line summarising a window: what the previous scene's numbers were once the scene has moved on. */
function summaryLine(label: string, stats: FrameStatsSnapshot): string {
  const share = stats.frames > 0 ? (100 * stats.long) / stats.frames : 0
  return `${label}: wall ${stats.wall.p50.toFixed(1)}/${stats.wall.p90.toFixed(1)}/${stats.wall.p99.toFixed(1)}  cpu ${stats.cpu.p50.toFixed(1)}/${stats.cpu.p90.toFixed(1)}/${stats.cpu.p99.toFixed(1)}  long ${share.toFixed(1)}% of ${stats.frames}`
}

/**
 * The collapsed view: one line, because the panel was reported as hiding the game. What survives
 * is the pair of clocks and the two shares the next decision is taken on; everything else is a
 * tap away.
 */
function renderCompact(stats: FrameStatsSnapshot): string {
  const share = stats.frames > 0 ? (100 * stats.long) / stats.frames : 0
  const ovl = stats.longPhase ? ` ovl ${pct(stats.longPhase.share)}` : ''
  return `wall ${stats.wall.p50.toFixed(1)}/${stats.wall.p90.toFixed(1)}/${stats.wall.p99.toFixed(1)}  cpu ${stats.cpu.p50.toFixed(1)}/${stats.cpu.p90.toFixed(1)}/${stats.cpu.p99.toFixed(1)}  long ${share.toFixed(1)}%${ovl}`
}

function renderText(device: DeviceInfo, label: string, stats: FrameStatsSnapshot, sceneLine: string, other: string | null): string {
  const share = stats.frames > 0 ? ((100 * stats.long) / stats.frames).toFixed(1) : '0.0'
  const phase = stats.longPhase
  const overlayLine = phase
    ? `overlay: ${pct(phase.share)} of long frames in the 2 after a refresh (uniform ${pct(phase.expected)}, n ${phase.total})`
    : ''
  return [
    `${device.frame}  ${device.renderer}  ${device.samples}`,
    device.gpu,
    `${label.padEnd(8).slice(0, 8)}p50    p90    p99    max   (n ${stats.wall.n})`,
    `wall  ${ms(stats.wall.p50)}  ${ms(stats.wall.p90)}  ${ms(stats.wall.p99)}  ${ms(stats.wall.max)}`,
    `cpu   ${ms(stats.cpu.p50)}  ${ms(stats.cpu.p90)}  ${ms(stats.cpu.p99)}  ${ms(stats.cpu.max)}`,
    `long >${LONG_FRAME_MS}ms ${stats.long}/${stats.frames} (${share}%)   >${DROPPED_FRAME_MS}ms ${stats.dropped}   skipped ${stats.skipped}`,
    overlayLine,
    `heap ${mb(stats.heapBytes)}  peak ${mb(stats.heapPeakBytes)}  gc ${stats.gcs ?? 'n/a'}  biggest drop ${mb(stats.gcLargestDropBytes)}`,
    sceneLine,
    other ?? '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function button(label: string, onClick: (el: HTMLButtonElement) => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.textContent = label
  el.style.cssText =
    'font: 12px monospace; padding: 6px 10px; margin: 0 6px 6px 0; background: #223; color: #cde;' +
    ' border: 1px solid #58a; border-radius: 4px; pointer-events: auto; touch-action: manipulation;'
  el.addEventListener('click', () => onClick(el))
  return el
}

/**
 * Copies to the clipboard on a LAN page, where `navigator.clipboard` does not exist.
 *
 * `execCommand('copy')` is deprecated and is also the only thing that works in a non-secure
 * context, provided it runs inside the user's own gesture — which a click handler is. The textarea
 * it copies from stays on screen afterwards, selectable, so a device where even that fails still
 * has the text in front of it.
 */
function copyThroughTextarea(area: HTMLTextAreaElement): boolean {
  area.style.display = 'block'
  area.focus()
  area.select()
  area.setSelectionRange(0, area.value.length)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  }
}

export function mountPerfOverlay(game: Phaser.Game): void {
  if (document.getElementById(OVERLAY_ID)) return

  // **Two windows, and neither resets by itself.** `session` runs from mount to `reset`. `run`
  // starts over when `RunScene` becomes the only active scene and freezes when it stops being —
  // the pause dialog, the result panel and the menu all take it out of the active set — so "what
  // did the last run measure" is a whole snapshot that survives every screen after it. The first
  // version reset one window on every scene change and kept the ended one as a line; both
  // readings the phone sent back had `n 1` and `n 11`, taken a second after a change, with the
  // run's own numbers already overwritten by the panel's.
  const session = new FrameStats(undefined, REFRESH_EVERY_FRAMES)
  const run = new FrameStats(undefined, REFRESH_EVERY_FRAMES)
  let inRun = false

  const root = document.createElement('div')
  root.id = OVERLAY_ID
  // Fixed over the page rather than inside `#app`, and transparent to the pointer everywhere
  // except its controls: the game steers from wherever the finger is, and a panel that swallowed a
  // drag across it would be an instrument that changes what it measures.
  // **Collapsed by default, because the full panel was reported as hiding the game.** Collapsed it
  // is one 11px line and a `▸`; expanded it is the whole readout and the controls. Either way it
  // sits at 34% down the frame — over the far road, which is the band with the least in it that a
  // fixed screen-space strip can occupy on a portrait phone.
  root.style.cssText =
    'position: fixed; left: 0; top: 34%; z-index: 10; pointer-events: none;' +
    ' background: rgba(0, 0, 0, 0.5); color: #dfe; padding: 3px 6px; max-width: 100vw; box-sizing: border-box;'

  const row = document.createElement('div')
  row.style.cssText = 'display: flex; align-items: flex-start; gap: 6px;'
  root.appendChild(row)

  const pre = document.createElement('pre')
  pre.style.cssText = 'margin: 0; font: 11px/1.35 monospace; white-space: pre; overflow-x: auto; flex: 1 1 auto;'
  const toggle = document.createElement('button')
  toggle.textContent = '▸'
  toggle.style.cssText =
    'font: 14px/1 monospace; padding: 2px 8px; margin: 0; background: #223; color: #cde; border: 1px solid #58a;' +
    ' border-radius: 4px; pointer-events: auto; touch-action: manipulation; flex: 0 0 auto;'
  row.appendChild(toggle)
  row.appendChild(pre)

  let expanded = false

  // Read on the first refresh, not at mount: `mountPerfOverlay` runs on the line after
  // `new Phaser.Game(...)`, when the scale manager has no size yet and the WebGL context does not
  // exist. Both are there by the time a frame has rendered.
  let device: DeviceInfo | null = null
  let lastSnapshot: FrameStatsSnapshot = session.snapshot()
  let lastRun: FrameStatsSnapshot = run.snapshot()

  const report = (): string =>
    JSON.stringify(
      {
        at: new Date().toISOString(),
        device,
        userAgent: navigator.userAgent,
        msaaFlag: msaaDisabled(location.search) ? 'off' : 'default',
        mipsFlag: mipsRequested(location.search) ? 'on' : 'default',
        refreshEveryFrames: REFRESH_EVERY_FRAMES,
        scenes: activeSceneLine(game),
        runLive: inRun,
        run: lastRun,
        session: lastSnapshot,
      },
      null,
      2,
    )

  const area = document.createElement('textarea')
  area.readOnly = true
  // `display` is toggled inline rather than through `hidden`: an inline `display: block` here
  // would override the UA stylesheet's `[hidden] { display: none }`, which is exactly how the bar
  // and this textarea first shipped visible on a panel that said they were hidden.
  area.style.cssText =
    'display: none; width: min(92vw, 520px); height: 120px; font: 10px monospace; pointer-events: auto;' +
    ' background: #111; color: #cde; border: 1px solid #58a; margin-top: 6px;'

  const bar = document.createElement('div')
  bar.style.cssText = 'display: none; flex-wrap: wrap; margin-top: 6px;'
  bar.appendChild(
    button('reset', () => {
      session.reset()
      run.reset()
      inRun = false
      area.style.display = 'none'
    }),
  )
  bar.appendChild(
    button(msaaDisabled(location.search) ? 'MSAA: off → on' : 'MSAA: on → off', () => {
      location.search = toggledFlagSearch(location.search, MSAA_FLAG)
    }),
  )
  bar.appendChild(
    button(mipsRequested(location.search) ? 'mips: on → off' : 'mips: off → on', () => {
      location.search = toggledOptInSearch(location.search, MIPS_FLAG)
    }),
  )
  bar.appendChild(
    button('send', (el) => {
      el.textContent = 'sending…'
      fetch(REPORT_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: report() })
        .then((res) => {
          el.textContent = res.ok ? 'sent ✓' : `send failed (${res.status})`
        })
        .catch(() => {
          el.textContent = 'send failed'
        })
    }),
  )
  bar.appendChild(
    button('copy JSON', (el) => {
      const text = report()
      area.value = text
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(
          () => {
            el.textContent = 'copied ✓'
          },
          () => {
            el.textContent = copyThroughTextarea(area) ? 'copied ✓' : 'select below'
          },
        )
        return
      }
      el.textContent = copyThroughTextarea(area) ? 'copied ✓' : 'select below'
    }),
  )
  root.appendChild(bar)
  root.appendChild(area)
  document.body.appendChild(root)

  const draw = (): void => {
    if (device === null) return
    const haveRun = lastRun.frames > 0
    const label = haveRun ? (inRun ? 'run' : 'last run') : 'session'
    const shown = haveRun ? lastRun : lastSnapshot
    const other = haveRun ? summaryLine('session', lastSnapshot) : null
    pre.textContent = expanded ? renderText(device, label, shown, activeSceneLine(game), other) : `${label}: ${renderCompact(shown)}`
  }
  toggle.addEventListener('click', () => {
    expanded = !expanded
    toggle.textContent = expanded ? '▾' : '▸'
    bar.style.display = expanded ? 'flex' : 'none'
    if (!expanded) area.style.display = 'none'
    draw()
  })

  let frameStart = -1
  let lastFrameStart = -1
  // Frames since the text was last written. `0` is the frame whose wall interval contains the
  // DOM update — the one that pays for it — which is what the phase histogram is keyed on.
  let sinceRefresh = 0

  game.events.on('prestep', () => {
    frameStart = performance.now()
  })
  game.events.on('postrender', () => {
    const now = performance.now()
    const runNow = activeSceneKeys(game).join('+') === 'RunScene'
    if (runNow && !inRun) run.reset()
    inRun = runNow
    if (lastFrameStart >= 0 && frameStart >= 0) {
      const wall = frameStart - lastFrameStart
      const cpu = now - frameStart
      const heap = readHeap()
      session.push(wall, cpu, heap, sinceRefresh)
      if (inRun) run.push(wall, cpu, heap, sinceRefresh)
    }
    lastFrameStart = frameStart

    sinceRefresh += 1
    if (sinceRefresh < REFRESH_EVERY_FRAMES) return
    sinceRefresh = 0
    device ??= describeDevice(game)
    lastSnapshot = session.snapshot()
    lastRun = run.snapshot()
    draw()
  })
}
