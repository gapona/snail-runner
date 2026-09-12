// `type` on SaveState is load-bearing, not style: Node's native TS stripping (which
// `npm run verify:run` loads this file through) erases imports without executing them, so a
// type imported as a value becomes a missing export at runtime.
import { clampVolume, LEGACY_DEFAULT_MUSIC_VOLUME, migratedMusicVolume } from '../audio/volume'
import { AUTO_THEME_ID, DEFAULT_SAVE_STATE, DEFAULT_THEME_ID, DEFAULT_WEAPON_ID, type SaveState } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A finite, non-negative number from an unverified field, or the default. */
function count(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * The selected theme, with a stored `day` collapsed onto `auto`.
 *
 * They name the same palette — `auto` means "no override", which resolves to `DEFAULT_ROAD_THEME`,
 * which is `day` — and `day` no longer has a row of its own in the shop (see `buildThemeCatalog`).
 * A save still holding it would light no row at all, leaving the player unable to see what is
 * selected. Collapsing here rather than in a migration step because it changes no outcome: both
 * values already played on the same theme, so there is no version at which the meaning changed.
 */
function normalizeSelectedTheme(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return DEFAULT_SAVE_STATE.selectedTheme

  return value === DEFAULT_THEME_ID ? AUTO_THEME_ID : value
}

function normalizeV12(raw: Record<string, unknown>): SaveState {
  const settings = isRecord(raw.settings) ? raw.settings : {}
  const purchases = Array.isArray(raw.purchases) ? raw.purchases.filter((p): p is string => typeof p === 'string') : DEFAULT_SAVE_STATE.purchases
  const themeProgress: Record<string, number> = {}

  if (isRecord(raw.themeProgress)) {
    // Filtered field by field rather than trusted wholesale: this is a map whose *keys* come
    // from data, so one corrupt entry must not poison the rest of the record.
    for (const [id, best] of Object.entries(raw.themeProgress)) {
      if (typeof best === 'number' && Number.isFinite(best) && best >= 0) themeProgress[id] = best
    }
  }

  const weaponLoadout = Array.isArray(raw.weaponLoadout)
    ? raw.weaponLoadout.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : DEFAULT_SAVE_STATE.weaponLoadout

  const quests = raw.quests

  return {
    v: 17,
    // **Passed through rather than validated here.** The save layer knows a board is an object with
    // an array in it; what a quest *kind* is, and what a target should currently be, belongs to
    // `quests.ts` — and `resolveQuestBoard` re-derives every target on the way out, so a board
    // written before a placer was re-tuned cannot survive as a goal that no longer fits the road.
    quests:
      quests && typeof quests === 'object'
        ? (quests as SaveState['quests'])
        : { active: [], nextId: 1 },
    // **Passed through rather than validated, for the quest board's reason exactly.** This layer
    // knows a suspended run is an object that was stored; whether it is a *run* — whether its
    // distance is a number, whether its fever phase is a phase, whether it is over — belongs to
    // `run/suspend.ts`, and `resolveSuspended` refuses anything that is not rather than repairing
    // one into existence. A snapshot is the one field here where the fallback is `null` and not a
    // default: there is no default run.
    suspendedRun:
      raw.suspendedRun !== null && typeof raw.suspendedRun === 'object' ? raw.suspendedRun : null,
    // Defaults to `false` — a save with no opinion on this is a save from before the tutorial
    // existed *or* a brand new one, and only the migration can tell those apart. See `SaveStateV12`.
    tutorialDone: raw.tutorialDone === true,
    bestScore: count(raw.bestScore, DEFAULT_SAVE_STATE.bestScore),
    selectedTheme: normalizeSelectedTheme(raw.selectedTheme),
    selectedWeapon:
      typeof raw.selectedWeapon === 'string' && raw.selectedWeapon.length > 0
        ? raw.selectedWeapon
        : DEFAULT_SAVE_STATE.selectedWeapon,
    weaponLoadout,
    selectedShip:
      typeof raw.selectedShip === 'string' && raw.selectedShip.length > 0
        ? raw.selectedShip
        : DEFAULT_SAVE_STATE.selectedShip,
    selectedSnail:
      typeof raw.selectedSnail === 'string' && raw.selectedSnail.length > 0
        ? raw.selectedSnail
        : DEFAULT_SAVE_STATE.selectedSnail,
    bestWave: count(raw.bestWave, DEFAULT_SAVE_STATE.bestWave),
    themeProgress,
    coins: count(raw.coins, DEFAULT_SAVE_STATE.coins),
    purchases,
    // Filtered entry by entry, exactly as `themeProgress` is and for the same reason: the keys
    // come from data, and one corrupt entry must not poison the record.
    levelProgress: normalizeLevelProgress(raw.levelProgress),
    settings: {
      sound: typeof settings.sound === 'boolean' ? settings.sound : DEFAULT_SAVE_STATE.settings.sound,
      music: typeof settings.music === 'boolean' ? settings.music : DEFAULT_SAVE_STATE.settings.music,
      // Through `clampVolume`, which is where an edited save's `2` or `"loud"` becomes a number
      // the mixer can use. It defaults to full rather than to silence: a save that arrives with a
      // corrupt volume should not leave the player wondering why the game is mute.
      soundVolume:
        settings.soundVolume === undefined
          ? DEFAULT_SAVE_STATE.settings.soundVolume
          : clampVolume(settings.soundVolume),
      musicVolume:
        settings.musicVolume === undefined
          ? DEFAULT_SAVE_STATE.settings.musicVolume
          : clampVolume(settings.musicVolume),
    },
  }
}

/**
 * v8 -> v9: opens the first level and stops an unchosen theme from overriding every level.
 *
 * Two things, both about not taking anything away:
 *
 * - **Level progress starts empty**, which `unlockedCount` reads as "the first level is open". A
 *   returning player's `bestWave` is not translated into cleared levels: waves and levels are
 *   different units, and inventing a clear the player never got would hand them content unplayed.
 * - **`selectedTheme` moves to `'auto'` only if it is the old default.** That value means "nobody
 *   chose", and leaving it would make every level render in `day` — the identity levels exist for,
 *   gone on upgrade for everyone who never opened the shop. A deliberately chosen theme is left
 *   exactly where it is and keeps overriding, which is what buying one was for.
 */
function upgradeV8ToV9(raw: Record<string, unknown>): Record<string, unknown> {
  const chosen = typeof raw.selectedTheme === 'string' ? raw.selectedTheme : DEFAULT_THEME_ID

  return {
    ...raw,
    v: 9,
    selectedTheme: chosen === DEFAULT_THEME_ID ? AUTO_THEME_ID : chosen,
    levelProgress: { cleared: [], stars: {}, bestScore: {} },
  }
}

/**
 * v9 -> v10: the hull the player flies.
 *
 * **A default would have been enough here, and the migration exists anyway.** Every earlier save
 * has no `selectedShip` at all, and `normalizeV10` already fills a missing one with the starting
 * hull — so this step writes the same value the normaliser would. It is written out rather than
 * skipped because the ladder is the place a reader looks to find out what changed at each version,
 * and a version that silently does nothing is a version nobody can tell from a bug.
 *
 * What it deliberately does **not** do is grant anything: a returning player owns the free hull and
 * whatever they have actually bought, and inventing a purchase would make `purchases` a lie the
 * first time anything else reads it.
 */
function upgradeV9ToV10(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, v: 10, selectedShip: DEFAULT_SAVE_STATE.selectedShip }
}

/**
 * v10 -> v11: which recolour of the mascot the player wears.
 *
 * Written out for the reason `upgradeV9ToV10` is, and it grants nothing for the same reason: every
 * earlier save has no `selectedSnail`, the normaliser already fills a missing one with the free
 * skin, and inventing a purchase would make `purchases` a lie the first time anything reads it. A
 * returning player comes back on the snail they have always had — which is the shipped render, bit
 * for bit, because `DEFAULT_SNAIL_SKIN` names the render's own measured hues rather than moving
 * them.
 */
function upgradeV10ToV11(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, v: 11, selectedSnail: DEFAULT_SAVE_STATE.selectedSnail }
}

/**
 * v11 -> v12: the tutorial flag, and it is written **true**.
 *
 * **⚠ The one step in this ladder that deliberately does not write what the normaliser would.**
 * Every other upgrade fills a new field with its default, because a field nobody has had an opinion
 * about should read as though they never did. This one is the opposite: `tutorialDone: false` means
 * "has never played", and a save arriving at v12 is by definition from someone who has. Defaulting
 * it would deal every existing player a beginner's road with cards on it on their next run.
 *
 * It grants nothing else, and the tutorial stays reachable from Settings.
 */
/**
 * v12 -> v13: the quest board.
 *
 * Writes an **empty** board rather than a dealt one, which is what the normaliser would default —
 * and unlike `upgradeV11ToV12`, that is the right answer here. A quest board is a thing the player
 * is *offered*, not a thing they have earned or lost: a returning player is dealt one on their next
 * visit to the menu exactly as a new player is, and dealing it inside a migration would need the
 * rules module the save layer deliberately does not import.
 */
/**
 * v13 -> v14: the stage mode.
 *
 * **Writes what the normaliser would have defaulted**, which is the ordinary case in this ladder —
 * unlike `upgradeV11ToV12`, whose whole point was to disagree. A returning player has cleared no
 * stages because there were none to clear, and starts in endless because that is where they already
 * were: nothing is taken away and nothing is granted.
 */
/**
 * ⚠ **A step that adds nothing, and the version is kept for exactly that reason.**
 *
 * v15 added `wornAccessories` — the items a skin could be worn with — and they were withdrawn
 * before release. The field is no longer read, so this writes nothing; what the step still does is
 * let a save written by that build through the ladder rather than sending it to `null`, which is
 * how a withdrawn feature would otherwise take a player's coins with it. See `SaveStateV15`.
 */
/**
 * v15 -> v16: the stage mode is removed and a run can be suspended instead.
 *
 * **It writes the new field's default and deliberately does not delete the two old ones.** The
 * normaliser does not read `stagesCleared` or `runMode` any more, so they are unknown keys from
 * here on and cost nothing — and deleting a key is the one migration operation that cannot be
 * undone if the removal is ever reversed. What a player loses is which stages they had cleared,
 * which is a record for a mode that no longer exists.
 *
 * `suspendedRun` is `null` rather than absent: a returning player has no run in progress, and
 * "there is nothing to continue" is a value rather than a gap.
 */
/**
 * v16 -> v17: the music slider's scale moved, so a saved position is re-expressed on it.
 *
 * Both sliders default to 100% now and the whole game is 15% quieter at the top (`MASTER_GAIN_CEILING`).
 * The music's 100% is what its old default of 70% delivered, so a saved position is converted to
 * keep what the player hears — see `migratedMusicVolume`. An untouched slider at 0.7 lands on 1,
 * which is the case this exists for: a returning player would otherwise see 70% and be at a quieter
 * music than a fresh install. The effects slider needs nothing, because its scale did not move.
 */
function upgradeV16ToV17(raw: Record<string, unknown>): Record<string, unknown> {
  const settings = isRecord(raw.settings) ? raw.settings : null

  if (!settings || typeof settings.musicVolume !== 'number') return { ...raw, v: 17 }

  return { ...raw, v: 17, settings: { ...settings, musicVolume: migratedMusicVolume(settings.musicVolume) } }
}

function upgradeV15ToV16(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, v: 16, suspendedRun: null }
}

function upgradeV14ToV15(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, v: 15 }
}

function upgradeV13ToV14(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, v: 14, stagesCleared: [], runMode: 'endless' }
}

function upgradeV12ToV13(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, v: 13, quests: { active: [], nextId: 1 } }
}

function upgradeV11ToV12(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, v: 12, tutorialDone: true }
}

/** Every field of `levelProgress`, filtered entry by entry. */
function normalizeLevelProgress(raw: unknown): SaveState['levelProgress'] {
  if (!isRecord(raw)) return { cleared: [], stars: {}, bestScore: {} }

  const cleared = Array.isArray(raw.cleared) ? raw.cleared.filter((id): id is string => typeof id === 'string') : []
  const numbers = (value: unknown): Record<string, number> => {
    if (!isRecord(value)) return {}

    const out: Record<string, number> = {}

    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = entry
    }

    return out
  }

  return { cleared: [...new Set(cleared)], stars: numbers(raw.stars), bestScore: numbers(raw.bestScore) }
}

/**
 * v7 -> v8: gives an existing player the volumes their flags implied.
 *
 * **A muted channel must come back at zero, not at full.** Before v8 the only control was on/off,
 * so a player who turned music off and then met a volume slider would otherwise find it sitting at
 * 70% with the music silent — two controls disagreeing about the same thing on the first frame the
 * second one existed. So `false` becomes 0 and `true` becomes the default; the flag itself is left
 * exactly as it was, because `audio.ts` still reads it.
 */
function upgradeV7ToV8(raw: Record<string, unknown>): Record<string, unknown> {
  const settings = isRecord(raw.settings) ? raw.settings : {}
  const soundOn = typeof settings.sound === 'boolean' ? settings.sound : true
  const musicOn = typeof settings.music === 'boolean' ? settings.music : true

  return {
    ...raw,
    v: 8,
    settings: {
      ...settings,
      soundVolume: soundOn ? DEFAULT_SAVE_STATE.settings.soundVolume : 0,
      // The default *at v8*, frozen: `DEFAULT_MUSIC_VOLUME` moved at v17, and a migration may not
      // read a constant that describes the present. `upgradeV16ToV17` then carries it forward.
      musicVolume: musicOn ? LEGACY_DEFAULT_MUSIC_VOLUME : 0,
    },
  }
}

/**
 * v6 -> v7: seeds the loadout from the weapon the player was already carrying.
 *
 * **A default of `[]` would be wrong rather than merely empty.** A returning player has a
 * `selectedWeapon` they chose and possibly paid for, and an empty loadout would put them back on
 * the starting weapon with their own choice sitting one menu away — a silent demotion on
 * upgrade. Seeding from `selectedWeapon` makes the first run after the update the run they were
 * already set up for; `resolveLoadout` then fills the other two cells from what they own.
 *
 * The rest of the row is deliberately *not* seeded here. This step knows nothing about which
 * weapons exist or which are owned — that is `resolveLoadout`'s job, and duplicating the
 * ownership rule in a migration is how the two drift apart.
 */
function upgradeV6ToV7(raw: Record<string, unknown>): Record<string, unknown> {
  // A save old enough to have no weapon at all still has *a* weapon — the one everybody starts
  // with — so the row is seeded with it rather than left empty. An empty loadout is legal (
  // `resolveLoadout` refills it) but it is not what the player had, and a migration that writes
  // something other than what the player had is the kind of thing nobody checks twice.
  const selected =
    typeof raw.selectedWeapon === 'string' && raw.selectedWeapon.length > 0 ? raw.selectedWeapon : DEFAULT_WEAPON_ID

  return { ...raw, v: 7, weaponLoadout: [selected] }
}

/**
 * v2 -> v3: carries the old `bestScore` into the new per-theme record.
 *
 * The one thing in this bump that is a real *upgrade* rather than a default: a returning player
 * whose best score predates themes has certainly played the default theme, and dropping that
 * into an empty `themeProgress` would silently reset a record they can see on the results
 * screen. Everything else v3 adds (`bestWave`) genuinely has no v2 answer and defaults to 0.
 */
function upgradeV2ToV3(raw: Record<string, unknown>): Record<string, unknown> {
  const bestScore = count(raw.bestScore, 0)

  return {
    ...raw,
    v: 3,
    themeProgress: bestScore > 0 ? { [LEGACY_DEFAULT_THEME_ID]: bestScore } : {},
  }
}

/**
 * v3 -> v4: renames the placeholder theme key to the real one.
 *
 * v3 recorded per-theme progress under the literal `'default'`, written before themes had
 * names; chunk 11 named them, and the starting one is `'night'`. Without this the record a
 * returning player can see on the results screen is orphaned under a key no theme answers to.
 */
function upgradeV3ToV4(raw: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(raw.themeProgress)) return { ...raw, v: 4 }

  const { default: legacy, ...rest } = raw.themeProgress as Record<string, unknown>
  const progress: Record<string, unknown> = { ...rest }

  if (typeof legacy === 'number' && (typeof progress[LEGACY_DEFAULT_THEME_ID] !== 'number' || legacy > (progress[LEGACY_DEFAULT_THEME_ID] as number))) {
    progress[LEGACY_DEFAULT_THEME_ID] = legacy
  }

  return { ...raw, v: 4, themeProgress: progress }
}

/**
 * The theme that was the default when the v2 and v3 upgrades were written.
 *
 * **Frozen as a literal, deliberately, and not `DEFAULT_THEME_ID`.** Those two steps mean "the
 * theme this player's old score was earned on", which is a fact about the past — and it was
 * `'night'`, because that is what the game shipped as. They were written against the live constant
 * and therefore changed meaning silently the day the default moved to `'day'`, quietly relabelling
 * every archived score as having been set on a theme that did not exist when it was set.
 *
 * The general rule: **a migration may not read a constant that describes the present.** Anything a
 * migration says about an old payload has to be spelled out at the version that wrote it.
 */
const LEGACY_DEFAULT_THEME_ID = 'night'

/**
 * v5 -> v6: moves a save still sitting on the old default theme onto the new one.
 *
 * `night` was the default and the only free theme, so **every** save that never actively chose
 * anything holds `selectedTheme: 'night'` — not because the player picked a night palette but
 * because that is what the field was initialised to. Leaving it would mean a returning player
 * loads the game and sees the old dark look with no indication that anything changed.
 *
 * **This cannot distinguish "defaulted to night" from "chose night", and nothing can**: `night`
 * costs nothing, so choosing it leaves no purchase record. The trade is accepted knowingly — a
 * player who really wants night re-picks it in one tap from the shop, where it remains free and
 * owned, and the alternative leaves everyone else on a look that was replaced for being unreadable.
 * Any other saved theme is left exactly alone, because holding one of those *is* a deliberate act.
 */
function upgradeV5ToV6(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.selectedTheme !== LEGACY_DEFAULT_THEME_ID) return { ...raw, v: 6 }

  return { ...raw, v: 6, selectedTheme: DEFAULT_THEME_ID }
}

/**
 * Migrates a parsed-but-unverified save payload to the current SaveState shape.
 * Returns null for anything unrecognized — the caller falls back to DEFAULT_SAVE_STATE.
 *
 * Ladder pattern: each case upgrades the payload and falls through to the next, ending at
 * SAVE_SCHEMA_VERSION. The v1 -> v2 bump (adding `coins`/`purchases`) needed no upgrade step at
 * all — a real v1 payload simply has neither field, and `normalizeV6`'s own `typeof`/
 * `Array.isArray` checks already default a missing one — so `case 1` falls straight through.
 * The v2 -> v3 bump is the first that has to *derive* something (`themeProgress` from the old
 * `bestScore`), which is what `upgradeV2ToV3` is for and why the ladder has a step in it now.
 */
export function migrate(raw: unknown): SaveState | null {
  if (!isRecord(raw)) {
    return null
  }

  let payload = raw

  switch (payload.v) {
    case 1:
    // A v1 payload has no v2 fields to derive; it upgrades by defaulting, so it falls through.
    case 2:
      payload = upgradeV2ToV3(payload)
    // falls through
    case 3:
      payload = upgradeV3ToV4(payload)
    // falls through
    case 4:
    // **The v4 -> v5 step needs no `upgradeV4ToV5`, and that is a property of the change rather
    // than an oversight.** It adds one field, `selectedWeapon`, which `normalizeV6` already
    // defaults when absent — exactly the situation the v1 -> v2 fallthrough documents. A bump
    // that *derived* something from the old shape (as v2 -> v3 does, carrying `bestScore` into
    // `themeProgress`) would need its own step.
    // falls through
    case 5:
      payload = upgradeV5ToV6(payload)
    // falls through
    case 6:
      payload = upgradeV6ToV7(payload)
    // eslint-disable-next-line no-fallthrough
    case 7:
      payload = upgradeV7ToV8(payload)
    // eslint-disable-next-line no-fallthrough
    case 8:
      payload = upgradeV8ToV9(payload)
    // eslint-disable-next-line no-fallthrough
    // eslint-disable-next-line no-fallthrough
    case 9:
      payload = upgradeV9ToV10(payload)
    // eslint-disable-next-line no-fallthrough
    case 10:
      payload = upgradeV10ToV11(payload)
    // eslint-disable-next-line no-fallthrough
    case 11:
      payload = upgradeV11ToV12(payload)
    // eslint-disable-next-line no-fallthrough
    case 12:
      payload = upgradeV12ToV13(payload)
    // falls through
    case 13:
      payload = upgradeV13ToV14(payload)
    // falls through
    case 14:
      payload = upgradeV14ToV15(payload)
    // falls through
    case 15:
      payload = upgradeV15ToV16(payload)
    // falls through
    case 16:
      payload = upgradeV16ToV17(payload)
    // falls through
    case 17:
      return normalizeV12(payload)

    default:
      return null
  }
}
