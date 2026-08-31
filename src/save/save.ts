import { LOAD_ATTEMPTS, loadBackoffMs } from '../platform/retry'
import { loadData as ytLoadData, saveData as ytSaveData, logError, logWarning } from '../platform/yt'
import { migrate } from './migrate'
import { DEFAULT_SAVE_STATE, SaveState } from './types'

// ytgame.game.saveData()'s hard limit — exceeding it rejects with SIZE_LIMIT_EXCEEDED.
const SAVE_SIZE_LIMIT_BYTES = 3 * 1024 * 1024
const SAVE_SIZE_WARN_RATIO = 0.8

/**
 * Loads and migrates the persisted SaveState. Never throws: an empty string (no save
 * yet, or a signed-out YouTube user — both valid), corrupt JSON, and an unrecognized
 * schema version all fall back to DEFAULT_SAVE_STATE with a console.warn.
 */
/**
 * Whether the save slot has actually been READ this session.
 *
 * **⚠ Nothing may be written until this is true, and that is the difference between a retry and
 * data loss.** `load()` used to catch a `loadData()` rejection and return defaults; the store then
 * held defaults, and the first `mutate()` wrote them straight over the player's real cloud save.
 * The SDK's own error table lists `API_UNAVAILABLE` as *retry later*, so a transient failure on a
 * cold platform was enough to wipe a save — silently, because from the game's side it looks
 * exactly like a new player.
 *
 * A *corrupt* payload or an unrecognised schema still counts as confirmed: the slot was read, it
 * held something the migrations cannot use, and overwriting that is the intended repair. What is
 * not confirmed is a read that never happened.
 */
let loadConfirmed = false

export function isLoadConfirmed(): boolean {
  return loadConfirmed
}

/** Reads the slot, retrying a transient failure. See `LOAD_ATTEMPTS` for why one attempt is wrong. */
async function readRaw(): Promise<{ raw: string } | null> {
  for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt++) {
    const wait = loadBackoffMs(attempt)

    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))

    try {
      return { raw: await ytLoadData() }
    } catch (e) {
      console.warn(`[save] loadData() failed (attempt ${attempt + 1}/${LOAD_ATTEMPTS})`, e)
    }
  }

  return null
}

export async function load(): Promise<SaveState> {
  const read = await readRaw()

  if (!read) {
    // **Not confirmed, so nothing will be saved.** The game runs on defaults for this session and
    // the player's slot is left exactly as it was, which is the only safe answer when the read
    // failed for reasons that have nothing to do with what is in it.
    console.error(`[save] could not read the save after ${LOAD_ATTEMPTS} attempts — saving is disabled this session`)
    logError()

    return { ...DEFAULT_SAVE_STATE }
  }

  loadConfirmed = true

  const raw = read.raw

  if (raw === '') {
    return { ...DEFAULT_SAVE_STATE }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    console.warn('[save] corrupt save JSON, using defaults', e)
    return { ...DEFAULT_SAVE_STATE }
  }

  const migrated = migrate(parsed)
  if (!migrated) {
    console.warn('[save] unrecognized save schema, using defaults')
    return { ...DEFAULT_SAVE_STATE }
  }

  return migrated
}

/** Serializes and persists a SaveState. Skips (with a warning) rather than throwing on bad input. */
export async function save(state: SaveState): Promise<void> {
  // **The guard the whole `loadConfirmed` mechanism exists for.** Refusing to write is the only
  // safe answer when the slot was never read: the alternative is defaults over a real save.
  if (!loadConfirmed) {
    console.warn('[save] refusing to save: the slot was never read this session')

    return
  }

  const json = JSON.stringify(state)

  // isWellFormed() is ES2024; tsconfig's lib covers the type, but this build may end up
  // reused on a platform/browser old enough to lack the runtime method, so feature-detect
  // rather than assume — esbuild doesn't polyfill methods, only syntax.
  const isWellFormed = typeof json.isWellFormed === 'function' ? json.isWellFormed() : true
  if (!isWellFormed) {
    console.warn('[save] serialized save is not well-formed UTF-16, aborting save')
    logWarning()
    return
  }

  // JS strings are UTF-16 internally; approximate the SDK's byte limit as 2 bytes/code unit.
  const byteSize = json.length * 2
  if (byteSize > SAVE_SIZE_LIMIT_BYTES) {
    console.warn(`[save] save payload is ${byteSize} bytes, over the ${SAVE_SIZE_LIMIT_BYTES}-byte SDK limit — aborting save`)
    logWarning()
    return
  }
  if (byteSize > SAVE_SIZE_LIMIT_BYTES * SAVE_SIZE_WARN_RATIO) {
    console.warn(`[save] save payload is ${((byteSize / SAVE_SIZE_LIMIT_BYTES) * 100).toFixed(0)}% of the SDK size limit`)
  }

  try {
    await ytSaveData(json)
  } catch (e) {
    console.warn('[save] saveData() failed', e)
    logError()
  }
}
