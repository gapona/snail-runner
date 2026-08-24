import { DEFAULT_MUSIC_VOLUME, DEFAULT_SOUND_VOLUME } from '../audio/volume'

export const SAVE_SCHEMA_VERSION = 10 as const

export interface SaveSettings {
  /**
   * Whether each channel is switched on at all.
   *
   * **Kept alongside the volumes rather than replaced by them**, because they answer different
   * questions and the platform only asks one of them: `audio.ts` combines these flags with the
   * platform's own mute (`isAudioEnabled()`), and a player who muted the game from the platform
   * and then came back must find their volume where they left it. A single number would have to
   * remember its own pre-mute value, which is a flag with extra steps.
   */
  sound: boolean
  music: boolean
  /** Slider positions, `0..1`. Turned into gain by `audio/volume.ts` — not a gain themselves. */
  soundVolume: number
  musicVolume: number
}

export interface SaveStateV9 {
  v: 10
  bestScore: number
  /**
   * Furthest wave ever cleared in a single run — the run's own progress record, separate from
   * the score because a careful player and a lucky one are different achievements.
   */
  bestWave: number
  /**
   * Best score per theme id, keyed by the theme the run was played on.
   *
   * One entry (`'default'`) today; chunk 11 adds real themes and this is what stops that from
   * being another schema bump. A theme with no entry has never been played.
   */
  themeProgress: Record<string, number>
  /**
   * Which theme the player is currently playing on.
   *
   * Separate from `themeProgress`, which records a best score *per* theme: this is the choice,
   * that is the history. Always a theme the player owns — `applySelectedTheme` falls back to
   * the default rather than trusting it, because a save can outlive a theme id.
   */
  selectedTheme: string
  /**
   * Which levels have been cleared, and the best stars and score on each.
   *
   * `cleared` is an ordered list rather than a count because a level id is what survives a table
   * edit: a count would silently mean a different set the moment a level is inserted, and the
   * unlock chain reads ids for exactly that reason.
   */
  levelProgress: {
    cleared: string[]
    stars: Record<string, number>
    bestScore: Record<string, number>
  }
  /**
   * Which weapon the player is currently armed with.
   *
   * Same shape and same caveat as `selectedTheme`: this is the *choice*, and it is never trusted
   * on its own — `resolveSelectedWeapon` checks it against `purchases` and falls back to the
   * default, because a save can outlive a weapon id and can be edited.
   */
  selectedWeapon: string
  /**
   * Which hull the player flies.
   *
   * **Ownership is not a field.** A bought hull is an ordinary `'unlock'` in `purchases`, exactly
   * as a weapon, a theme, an upgrade step and the fourth loadout slot are ${EM} four id spaces sharing
   * one array, which `verify:ships` asserts cannot collide. What genuinely is new state is the
   * *choice*, and a choice needs somewhere to live, which is what took the schema to 10.
   *
   * Same caveat as `selectedTheme` and `selectedWeapon`: never trusted on its own. `resolveShip`
   * checks it against `purchases` and falls back, because a save can outlive a hull id and can be
   * edited by hand.
   */
  selectedShip: string
  /**
   * The three weapons this player flies with, in row order.
   *
   * **A choice about a run, not a record of the collection.** The row along the bottom of the
   * frame holds three cells because three is what a player can hold in their head while
   * something is shooting at them; the catalogue holds seven. Never trusted on its own —
   * `resolveLoadout` drops anything unowned or unknown and refills from what is owned, for the
   * same reason `selectedWeapon` is checked rather than believed.
   */
  weaponLoadout: string[]
  /** Shop currency balance — see `src/shop/coins.ts` for the pure earn/spend/afford logic
   * that operates on this field (always via `store.mutate()`), and CLAUDE.md "Shop Layer". */
  coins: number
  /** Ids of every `'unlock'`-kind `ShopItem` (`src/shop/catalog.ts`) ever purchased — a
   * `'consumable'` purchase never appears here, only one-time unlocks do. */
  purchases: string[]
  settings: SaveSettings
}

export type SaveState = SaveStateV9

/**
 * The `selectedTheme` value meaning "whatever the level says".
 *
 * **Not a theme — the absence of an override.** Levels carry an authored theme, and themes are also
 * a thing the player buys; if a bought theme simply *were* the selection, then every level after the
 * first purchase would look the same and the identity levels exist for would be gone. So a purchase
 * is an override the player opts into, and this is the value that says they have not.
 *
 * It is the default for new saves, and `upgradeV8ToV9` moves existing saves onto it **only** when
 * their selection is the old default — i.e. a value nobody ever chose. A player who deliberately
 * picked `ice` keeps `ice` on every level. Same reasoning, and the same limitation, as
 * `upgradeV5ToV6` when the default theme moved: a free theme leaves no purchase record, so
 * "defaulted to day" and "chose day" are indistinguishable and the trade is taken knowingly.
 */
export const AUTO_THEME_ID = 'auto'

/**
 * The theme a save defaults to.
 *
 * **Must equal `DEFAULT_ROAD_THEME` in `src/road/themes.ts`**, and `verify:run` asserts it.
 * Duplicated rather than imported to keep the save layer independent of the renderer's — the
 * save only ever needs to know that a theme id is a string, not what themes exist.
 */
export const DEFAULT_THEME_ID = 'day'

/**
 * The weapon a save defaults to.
 *
 * **Must equal `DEFAULT_WEAPON` in `src/rail/weapons.ts`**, and `verify:run` asserts it.
 * Duplicated for the same reason `DEFAULT_THEME_ID` is: the save layer only needs to know that a
 * weapon id is a string, not what weapons exist.
 */
export const DEFAULT_WEAPON_ID = 'lance'

/**
 * The hull a save starts on.
 *
 * Duplicated here for the same reason `DEFAULT_WEAPON_ID` is: the save layer needs to know that a
 * hull id is a string, not what hulls exist. `verify:ships` asserts the two agree.
 */
export const DEFAULT_SHIP_ID_VALUE = 'lance-hull'

export const DEFAULT_SAVE_STATE: SaveState = {
  v: SAVE_SCHEMA_VERSION,
  bestScore: 0,
  bestWave: 0,
  themeProgress: {},
  selectedTheme: AUTO_THEME_ID,
  selectedWeapon: DEFAULT_WEAPON_ID,
  selectedShip: DEFAULT_SHIP_ID_VALUE,
  weaponLoadout: [DEFAULT_WEAPON_ID],
  coins: 0,
  purchases: [],
  levelProgress: { cleared: [], stars: {}, bestScore: {} },
  settings: {
    sound: true,
    music: true,
    soundVolume: DEFAULT_SOUND_VOLUME,
    musicVolume: DEFAULT_MUSIC_VOLUME,
  },
}
