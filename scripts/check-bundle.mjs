// Post-build size/content guard, run automatically as part of `npm run build`.
// Nothing here talks to the network or a platform SDK -- it only inspects the dist/
// output that `vite build` just produced.
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(ROOT, 'dist')

const MB = 1024 * 1024
/**
 * The project's own working ceiling, and it fails the build rather than sitting in a document.
 *
 * **It was a number in CLAUDE.md and it drifted to 99.3% of itself without anything noticing.** The
 * platform allows 200 MB per archive and `PLAYABLES-SDK.md` targets 15; 6 MB was picked as
 * "comfortably above what this game needs" when the game had 3 MB of art. It now has 99 per-biome
 * enemy skins, which is content that was asked for rather than bloat — so the ceiling moves once,
 * with the reason, to **8 MB**, still half the SDK's own target. What it must not do is move again
 * quietly, which is why it is here and not only in prose: a comment cannot fail a build.
 */
const WORKING_CEILING_BYTES = 8 * MB

const TOTAL_WARN_BYTES = 10 * MB
const TOTAL_FAIL_BYTES = 25 * MB
// Platform's own per-file limit is 30 MB (see PLAYABLES-SDK.md); 25 MB keeps a 5 MB
// margin so this guard trips before an actual submission would be rejected.
const FILE_FAIL_BYTES = 25 * MB

// Source-authoring formats that should never ship in a web build. Deliberately does NOT
// include audio/image delivery formats like .wav/.png/.mp3 -- this project already ships
// public/assets/audio/blip.wav as a real runtime asset, and a generic extension check
// can't tell a "WAV master" from a normal delivered sound file by extension alone. That
// distinction is a provenance/policy concern instead, enforced by
// public/assets/AUDIO-SOURCES.md and the CLAUDE.md rule requiring an entry for every
// audio file (see CLAUDE.md "Build Guards & Asset Policy").
const FORBIDDEN_SOURCE_EXTENSIONS = ['.psd', '.ai', '.sketch', '.fig', '.xcf', '.blend', '.aep']

/**
 * Globals the dev build hangs off `window`, which must not survive into a submission.
 *
 * They are already behind `import.meta.env.DEV`, which Vite eliminates as dead code — but
 * "we gated it" and "it is gone" are different claims, and only one of them is checkable.
 * Grepping the built bundle is the check; the gate is merely how it passes.
 */
const FORBIDDEN_DEV_GLOBALS = ['__game', '__getRecentErrors', '__adGate', '__roadPerf', '__decorPerf', '__runPerf', '__menuContrast', '__menu', '__run', '__marks', '__reaction', '__steer']

/**
 * Filename fragments that mark an asset as work-in-progress.
 *
 * Checked on what is **in dist/**, not on what the code loads. A guard at the load site does not
 * protect anything: an unreferenced asset in `public/` is copied into the build regardless, ships
 * at full size, and is exactly what a reviewer finds.
 */
const PLACEHOLDER_MARKERS = ['placeholder', 'wip', 'draft', 'scratch', 'todo', 'dev-only', 'debug']

/**
 * Literals that only exist inside an `import.meta.env.DEV` branch and must be gone from a build.
 *
 * Same reasoning as `FORBIDDEN_DEV_GLOBALS`, applied to strings rather than globals: "we gated
 * it" and "it is gone" are different claims, and only the second is checkable. These are
 * diagnostic messages carrying buffer sizes and quad indices — no use to a player, and their
 * presence would mean the DEV branch survived elimination and the *throwing* path is live in
 * production, which for `RoadMesh.writeQuad` would end the game over a strip of road.
 */
const FORBIDDEN_DEV_LITERALS = ['RoadMesh.writeQuad overflow']

/** Text files worth grepping. Anything else is treated as opaque. */
const TEXT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.txt', '.svg']

function fail(message) {
  console.error(`[check-bundle] ${message}`)
  process.exitCode = 1
}

function collectFiles(dir, base = dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, base))
    } else if (entry.isFile()) {
      const size = statSync(fullPath).size
      files.push({ relPath: path.relative(base, fullPath).split(path.sep).join('/'), size })
    }
  }
  return files
}

function formatMB(bytes) {
  return `${(bytes / MB).toFixed(2)} MB`
}

if (!existsSync(DIST_DIR)) {
  console.error('[check-bundle] dist/ not found -- run "vite build" first.')
  process.exit(1)
}

const files = collectFiles(DIST_DIR)
const totalBytes = files.reduce((sum, f) => sum + f.size, 0)

const top10 = [...files].sort((a, b) => b.size - a.size).slice(0, 10)
console.log(`[check-bundle] top ${Math.min(10, top10.length)} largest files in dist/ (${files.length} total, ${formatMB(totalBytes)}):`)
console.table(top10.map((f) => ({ file: f.relPath, size: formatMB(f.size) })))

const oversizedFiles = files.filter((f) => f.size > FILE_FAIL_BYTES)
for (const f of oversizedFiles) {
  fail(`${f.relPath} is ${formatMB(f.size)}, over the ${formatMB(FILE_FAIL_BYTES)} per-file limit.`)
}

const forbiddenFiles = files.filter((f) => FORBIDDEN_SOURCE_EXTENSIONS.includes(path.extname(f.relPath).toLowerCase()))
for (const f of forbiddenFiles) {
  fail(`${f.relPath} looks like a source-authoring file, not a runtime asset -- it should never ship in dist/.`)
}

const placeholderFiles = files.filter((f) =>
  PLACEHOLDER_MARKERS.some((marker) => f.relPath.toLowerCase().includes(marker)),
)
for (const f of placeholderFiles) {
  fail(`${f.relPath} is named like a work-in-progress asset -- it should not ship in dist/.`)
}

for (const f of files) {
  if (!TEXT_EXTENSIONS.includes(path.extname(f.relPath).toLowerCase())) continue

  const contents = readFileSync(path.join(DIST_DIR, f.relPath), 'utf8')

  for (const name of FORBIDDEN_DEV_GLOBALS) {
    if (contents.includes(name)) {
      fail(`${f.relPath} still contains the dev-only global "${name}" -- it must be eliminated from a production build.`)
    }
  }

  for (const literal of FORBIDDEN_DEV_LITERALS) {
    if (contents.includes(literal)) {
      fail(`${f.relPath} still contains the DEV-only literal "${literal}" -- its import.meta.env.DEV branch was not eliminated.`)
    }
  }
}

if (totalBytes > TOTAL_FAIL_BYTES) {
  fail(`dist/ totals ${formatMB(totalBytes)}, over the ${formatMB(TOTAL_FAIL_BYTES)} limit.`)
} else if (totalBytes > TOTAL_WARN_BYTES) {
  console.warn(`[check-bundle] warning: dist/ totals ${formatMB(totalBytes)}, over the ${formatMB(TOTAL_WARN_BYTES)} warning threshold.`)
}

if (process.exitCode) {
  console.error('[check-bundle] FAILED')
} else {
  if (totalBytes > WORKING_CEILING_BYTES) {
  console.error(
    `[check-bundle] FAIL: ${(totalBytes / MB).toFixed(2)} MB is past this project's own ` +
      `${WORKING_CEILING_BYTES / MB} MB working ceiling. Either the art earns the room and the ` +
      `ceiling moves with a written reason, or something in dist/ does not belong there.`,
  )
  process.exit(1)
}

console.log('[check-bundle] OK')
}
