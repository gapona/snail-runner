// The world sheet -- public/assets/atlas/world.{png,json} -- against the sources it was packed from
// and the keys the game asks it for. Runs inside `npm run build` because a stale sheet is invisible
// on every frame: the picture is simply last month's art, and nothing on screen says so.
//
// Pure Node: reads the manifest, the PNG headers and the key lists the art modules declare. The
// art modules import `phaser` as a type only, so the TS loader reaches them.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DECOR_TEXTURES } from '../src/road/decorShapes'
import { OBSTACLE_ART_KEYS } from '../src/run/obstacleArt'
import { CRITTER_TEXTURE_KEYS } from '../src/run/critterArt'
import { PICKUP_TEXTURES } from '../src/run/pickupArt'
import { ATLAS_IMAGE_PATH, ATLAS_JSON_PATH } from '../src/art/atlas'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = path.join(ROOT, 'public', 'assets')
// Must agree with `FOLDERS` in scripts/build-atlas.py and `ATLAS_SOURCE_FOLDERS` in vite.config.ts.
const FOLDERS = { decor: 'decor-', obstacle: '', critter: '', pickup: '' }

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

/** Width and height straight out of a PNG's IHDR chunk. */
function pngSize(file) {
  const buf = readFileSync(file)
  assert.equal(buf.toString('latin1', 1, 4), 'PNG', `${file}: not a PNG`)
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'public', ATLAS_JSON_PATH), 'utf8'))
const frames = manifest.frames
const meta = manifest.meta
const sheetFile = path.join(ROOT, 'public', ATLAS_IMAGE_PATH)

check('the sheet is on disk, power-of-two on both sides, and the size the manifest says', () => {
  assert.ok(existsSync(sheetFile), `${sheetFile} missing -- run scripts/build-atlas.py`)
  const { w, h } = pngSize(sheetFile)
  assert.deepEqual({ w, h }, meta.size, 'manifest meta.size disagrees with the PNG header')
  const pot = (n) => n > 0 && (n & (n - 1)) === 0
  assert.ok(pot(w) && pot(h), `${w}x${h} is not power-of-two: Phaser 4 generates mipmaps for POT textures only`)
  console.log(`      ${w}x${h}, ${Object.keys(frames).length} frames, padding ${meta.padding}px`)
})

check('every source sprite is in the sheet, unchanged since it was packed, at its own size', () => {
  const expected = new Map()
  for (const [folder, prefix] of Object.entries(FOLDERS)) {
    for (const name of readdirSync(path.join(ASSETS, folder)).filter((n) => n.endsWith('.png')).sort()) {
      expected.set(prefix + name.slice(0, -4), `${folder}/${name}`)
    }
  }
  assert.deepEqual([...Object.keys(frames)].sort(), [...expected.keys()].sort(), 'frame set != source set -- re-run scripts/build-atlas.py')

  const stale = []
  for (const [key, file] of expected) {
    const source = meta.sources[key]
    assert.ok(source, `${key}: no source record`)
    assert.equal(source.file, file)
    const bytes = readFileSync(path.join(ASSETS, file))
    if (createHash('sha1').update(bytes).digest('hex') !== source.sha1) stale.push(file)
    const { w, h } = pngSize(path.join(ASSETS, file))
    assert.deepEqual({ w: frames[key].frame.w, h: frames[key].frame.h }, { w, h }, `${key}: frame size != PNG size`)
  }
  assert.deepEqual(stale, [], `sources edited since the sheet was packed -- re-run scripts/build-atlas.py: ${stale.join(', ')}`)
})

check('frames lie inside the sheet and keep the padding between each other', () => {
  const { w: W, h: H } = meta.size
  const pad = meta.padding
  const list = Object.entries(frames).map(([key, f]) => ({ key, ...f.frame }))
  for (const a of list) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= W && a.y + a.h <= H, `${a.key} leaves the sheet`)
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const apart =
        a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y
      assert.ok(apart, `${a.key} and ${b.key} are closer than ${pad}px -- a mipmap would average one into the other`)
    }
  }
})

check('every key the game declares is a frame, so no fallback is drawn over shipped art', () => {
  const declared = [
    ...DECOR_TEXTURES.map((t) => t.key),
    ...OBSTACLE_ART_KEYS,
    ...CRITTER_TEXTURE_KEYS,
    ...Object.values(PICKUP_TEXTURES).flat(),
  ]
  const missing = declared.filter((key) => !frames[key])
  assert.deepEqual(missing, [], `declared but not packed: ${missing.join(', ')}`)
  const orphans = Object.keys(frames).filter((key) => !declared.includes(key))
  assert.deepEqual(orphans, [], `packed but declared nowhere: ${orphans.join(', ')}`)
  console.log(`      ${declared.length} declared keys, all present`)
})

check('the build drops exactly the packed source folders from dist', () => {
  const vite = readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8')
  const m = vite.match(/ATLAS_SOURCE_FOLDERS = \[([^\]]+)\]/)
  assert.ok(m, 'vite.config.ts: ATLAS_SOURCE_FOLDERS not found')
  const folders = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
  assert.deepEqual(folders, Object.keys(FOLDERS).sort(), 'vite drops a different set of folders than the packer reads')
  assert.ok(vite.includes('dropAtlasSources()'), 'vite.config.ts: the drop plugin is not registered')
  // The sheet is still power-of-two so that it CAN carry mipmaps, and the game ships without them:
  // a Mali phone drew distant coins as black squares from the lower levels. `verify:perf` holds
  // that line in `config.ts`; the padding above is kept for the day a device-safe chain returns.
})

console.log(`${passed} checks passed`)
