import { execSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * The Playables Test Suite's "SDK loaded before any game code" check watches actual
 * NETWORK load order, not DOM/script-tag order or JS execution order. A static
 * `<script type="module" src="...">` -- what Vite normally emits for the entry point --
 * is visible to the browser's *preload scanner*, which speculatively fetches it in
 * parallel with, not after, the classic blocking SDK `<script>` tag that precedes it in
 * the document. A small local bundle can finish downloading before the SDK's
 * network-round-trip-bound fetch does, failing the MUST check even though the tag order
 * (and the actual module's *execution* order, since module scripts are deferred) are both
 * already correct.
 *
 * Fix: rewrite the entry tag into a classic inline `<script>import("...")</script>`. A
 * dynamic `import()` call is invisible to the preload scanner -- it only scans HTML
 * attributes, not JS source -- so the fetch for the bundle can't start until this classic,
 * parser-blocking script actually executes, which (being positioned after the SDK's own
 * classic script) cannot happen before the SDK script has already finished loading and
 * running. Also strips any `<link rel="modulepreload">` Vite might emit for other
 * chunks -- those are equally visible to the preload scanner. There's only one chunk
 * today (nothing to strip), but this guards against a future code-split silently
 * reintroducing the same race.
 *
 * `apply: 'build'` + `enforce: 'post'`: only runs for `vite build` (dev serving is
 * untouched -- Vite manages its own module graph there, see CLAUDE.md "Build Guards &
 * Asset Policy"), and runs after Vite's own core HTML plugin has already injected the
 * entry `<script type="module">` tag this rewrites.
 */
function inlineModuleLoader(): Plugin {
  return {
    name: 'inline-module-loader',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      let out = html.replace(
        /<script type="module"([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g,
        (_match, _before, src) => `<script>import(${JSON.stringify(src)})</script>`,
      )
      out = out.replace(/<link\s+rel="modulepreload"[^>]*>\s*/gi, '')
      return out
    },
  }
}

/**
 * The folders `scripts/build-atlas.py` packs into `public/assets/atlas/world.png`. They stay in
 * `public/` because every art check reads them there and `build-sprites.py` writes them there, and
 * `public/` is copied into `dist/` verbatim — so without this the bundle would carry the sheet *and*
 * its sources, 2.5MB twice. Nothing in the shipped game loads them: `Preloader` asks for the sheet
 * and `src/art/atlas.ts` answers every key from it. Kept in step with the packer by `verify:atlas`.
 */
export const ATLAS_SOURCE_FOLDERS = ['decor', 'obstacle', 'critter', 'pickup'] as const

function dropAtlasSources(): Plugin {
  // The resolved output folder rather than a literal `dist`: `npm run build:perf` builds into
  // `dist-perf/`, and a plugin that always cleaned `dist/` would leave the perf build carrying its
  // sources twice while deleting nothing from the folder it was asked to build.
  let outDir = 'dist'
  return {
    name: 'drop-atlas-sources',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      for (const folder of ATLAS_SOURCE_FOLDERS) {
        rmSync(path.join(outDir, 'assets', folder), { recursive: true, force: true })
      }
    },
  }
}

/**
 * Where the `?perf=1` overlay's `send` button lands. A page served over LAN `http://` is not a
 * secure context, so it has no `navigator.clipboard` and the JSON could not leave the phone; a
 * POST to the same origin can. Preview only — `vite preview` is what `npm run preview:perf` runs —
 * and the body goes to `perf-reports/<timestamp>.json`, gitignored. Nothing here reaches a build.
 */
function perfReportSink(): Plugin {
  return {
    name: 'perf-report-sink',
    configurePreviewServer(server) {
      server.middlewares.use('/__perf', (req, res, next) => {
        if (req.method !== 'POST') return next()
        let body = ''
        req.on('data', (chunk: Buffer | string) => {
          body += chunk
        })
        req.on('end', () => {
          const dir = path.resolve('perf-reports')
          mkdirSync(dir, { recursive: true })
          const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
          writeFileSync(file, body)
          console.log(`[perf] report saved: ${path.relative(process.cwd(), file)} (${body.length} bytes)`)
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

/**
 * Which commit a build was made from, and when — shown by the perf overlay.
 *
 * **Because a phone is the one place a stale build cannot be told from a live one.** A report came
 * back describing a defect the build it was supposedly taken on had just fixed, and nothing on the
 * screen could say which build the phone was running: the preview serves from a LAN address the
 * browser happily caches. `+dirty` marks a build made from uncommitted work, which is how a round is
 * tested before it is committed.
 */
function buildId(): string {
  const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ')

  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''

    return `${hash}${dirty ? '+dirty' : ''} ${stamp}Z`
  } catch {
    return `unknown ${stamp}Z`
  }
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  // Playables does not host games at the domain root, so root-absolute asset paths
  // (Vite's default, e.g. `/assets/foo.js`) 404 there even though they work locally.
  // './' emits relative paths (`./assets/foo.js`) that resolve correctly regardless of
  // where the game is actually served from.
  base: './',
  plugins: [inlineModuleLoader(), dropAtlasSources(), perfReportSink()],
  server: {
    port: 8080,
    open: true,
  },
  // **The preview is what the phone is pointed at, and a phone caches it.** `sirv` sends an ETag and
  // no `Cache-Control`, so a mobile browser is free to keep last night's `index.html` — and with it
  // last night's bundle — and a defect report then describes a build that no longer exists. Local
  // serving only: nothing here reaches the submission ZIP.
  preview: {
    headers: { 'Cache-Control': 'no-store' },
  },
  build: {
    outDir: 'dist',
    // esbuild's default target predates top-level await, which src/main.ts relies on
    // to wait for the Playables SDK before constructing the Phaser.Game instance.
    target: 'es2022',
  },
})
