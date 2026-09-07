import { DEFAULT_MUSIC_VOLUME, DEFAULT_SOUND_VOLUME } from '../audio/volume'

export const SAVE_SCHEMA_VERSION = 16 as const

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

export interface SaveStateV11 {
  v: 11
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
  /**
   * Which recolour of the mascot the player wears.
   *
   * **Ownership is not a field, the choice is** — the same split every other cosmetic here makes.
   * A bought skin is an ordinary `'unlock'` in `purchases` behind `skinItemId`, sharing that array
   * with the themes; `verify:skins` asserts the two id spaces cannot claim each other's ids. What
   * is genuinely new state is which one is worn, and that is what took the schema to 11.
   *
   * Never trusted on its own, for the reason `selectedTheme` is not: `resolveSelectedSnail` checks
   * it against `purchases` and falls back to the free skin, because a save can outlive a skin id
   * and can be edited by hand.
   */
  selectedSnail: string
  /** Shop currency balance — see `src/shop/coins.ts` for the pure earn/spend/afford logic
   * that operates on this field (always via `store.mutate()`), and CLAUDE.md "Shop Layer". */
  coins: number
  /** Ids of every `'unlock'`-kind `ShopItem` (`src/shop/catalog.ts`) ever purchased — a
   * `'consumable'` purchase never appears here, only one-time unlocks do. */
  purchases: string[]
  settings: SaveSettings
}

export interface SaveStateV12 extends Omit<SaveStateV11, 'v'> {
  v: 12
  /**
   * Whether the player has already been taught the game — see `run/tutorial.ts`.
   *
   * **⚠ A returning save gets `true` and a fresh one gets `false`, and that asymmetry is the whole
   * decision.** The tutorial is the first four hundred segments of a first run; a player who has
   * been running this game for weeks is not a first-time player, and dealing them a hand-placed
   * beginner's road with cards on it would be the upgrade taking their game away for a minute.
   * `upgradeV11ToV12` therefore writes `true`, which is *not* what the normaliser would default —
   * the one migration in this ladder that deliberately disagrees with its own default.
   *
   * It stays reachable: Settings has a button that clears it, so the tutorial is something a player
   * can ask for rather than something that happened to them once.
   */
  tutorialDone: boolean
}

export interface SaveStateV13 extends Omit<SaveStateV12, 'v'> {
  v: 13
  /**
   * The quest board: what this session is being asked to go and do.
   *
   * **Stored as data rather than as ids into a table**, because a quest carries live progress and
   * the table it came from can be re-tuned under it. `resolveQuestBoard` repairs whatever comes
   * back — re-deriving every target from what a lap currently offers — so a save written before a
   * placer changed cannot hold a goal that no longer matches the road.
   */
  quests: QuestBoardSave
}

/** The board's shape on disk. Deliberately plain: `resolveQuestBoard` is what validates it. */
export interface QuestBoardSave {
  active: { id: number; kind: string; target: number; progress: number; claimed: boolean }[]
  nextId: number
}

export interface SaveStateV14 extends Omit<SaveStateV13, 'v'> {
  v: 14
  /**
   * Which stages have been cleared, as a list of ids.
   *
   * A list rather than a count, and `unlockedStages` reads it as a **chain** — a hand-edited save
   * holding only the last id unlocks one stage, not all five. Same rule, and the same reason, as
   * the rail shooter's `cleared`.
   */
  stagesCleared: string[]
  /**
   * What the next run is: `'endless'`, or a stage id.
   *
   * **A choice, and therefore a save field.** The alternative — always starting endless and making
   * the player re-pick a stage every time — would make the mode a thing they set rather than a
   * thing they are in. `resolveMode` repairs a value naming a stage that is not open.
   */
  runMode: string
}

/**
 * ⚠ **A version with no field of its own, because the one it added was withdrawn.**
 *
 * v15 was `wornAccessories`: five items a skin could be worn with — a crown, a cap, a helmet,
 * goggles, a jetpack — reported on sight as looking poor on the creature and removed whole. The
 * number is **spent rather than reused**: a save written by that build is still read (its extra
 * field is simply not looked at, exactly as every unknown key is), and reusing 15 for a different
 * meaning later would make two incompatible payloads claim the same schema.
 */
export interface SaveStateV15 extends Omit<SaveStateV14, 'v'> {
  v: 15
}

/**
 * The stage mode is gone and a run can be put down instead.
 *
 * **⚠ Two fields are dropped and one is added, and dropping is the unusual half.** Every version
 * before this only ever added: an unknown key costs nothing, so the cheap thing is to leave it.
 * These two are removed from the *type* rather than from the payload — `stagesCleared` and
 * `runMode` are simply no longer read, so an older save still loads and its two extra keys are
 * ignored exactly as any other unknown key is. What that buys is that nothing can go on reading
 * them by accident, which is how a field ends up meaning one thing to the code and another to the
 * player.
 *
 * `suspendedRun` is the first save field in this game that is a whole simulation state rather than
 * an id or a count. It is typed `unknown` here on purpose: the save layer knows it is *something*
 * that was stored, and `resolveSuspended` in `run/suspend.ts` is what decides whether it is a run —
 * the same split `selectedTheme`, `selectedShip` and the quest board are all under, and the reason
 * is the same one, that this layer must not import the rules module.
 */
export interface SaveStateV16 extends Omit<SaveStateV15, 'v' | 'stagesCleared' | 'runMode'> {
  v: 16
  /** A run the player left in the middle of, or `null`. See `run/suspend.ts`. */
  suspendedRun: unknown
}

export type SaveState = SaveStateV16

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

/**
 * The mascot skin a save starts on.
 *
 * **Must equal `DEFAULT_SNAIL_SKIN` in `src/run/snailSkins.ts`**, and `verify:skins` asserts it.
 * Duplicated rather than imported for the reason `DEFAULT_THEME_ID` is: the save layer needs to
 * know that a skin id is a string, not what skins exist or how one is drawn.
 */
export const DEFAULT_SNAIL_ID = 'amber'

export const DEFAULT_SAVE_STATE: SaveState = {
  v: SAVE_SCHEMA_VERSION,
  // Empty rather than a dealt board: dealing needs a seed and a rules module the save layer must
  // not import, so `resolveQuestBoard` fills it on the way out. That is also what makes an upgraded
  // save and a fresh one take the same path.
  quests: { active: [], nextId: 1 },
  // Nothing to continue: a new save has no run in progress, and "there is nothing to continue" is
  // a value rather than a gap — see `SaveStateV16`.
  suspendedRun: null,
  tutorialDone: false,
  bestScore: 0,
  bestWave: 0,
  themeProgress: {},
  selectedTheme: AUTO_THEME_ID,
  selectedWeapon: DEFAULT_WEAPON_ID,
  selectedShip: DEFAULT_SHIP_ID_VALUE,
  selectedSnail: DEFAULT_SNAIL_ID,
  // Nothing worn. A new player owns the base colour and no items, which is what the two tiers mean.
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
