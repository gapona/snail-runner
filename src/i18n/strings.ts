/**
 * A plain lookup-table i18n layer, not a library — `t(key, params?)` does `{name}` substitution
 * only; no plurals, no ICU MessageFormat, no locale-aware number/date formatting. Reach for a
 * real i18n library instead if a game ever needs those.
 *
 * This module ships as a FRAMEWORK, not a finished dictionary — the `en`/`es` objects below
 * hold only generic, cross-game UI strings (Settings/Close/Sound/...). A game adds its own
 * domain strings (menu copy, gameplay text, ...) by extending these same two objects; it must
 * NOT keep a second, parallel `t()` mechanism.
 *
 * `es` is typed as `Record<StringKey, string>` (`StringKey` derived FROM `en`'s own keys, not
 * hand-duplicated) — TypeScript's excess-property + missing-property checks on that assignment
 * mean `es` must have exactly the same key set as `en`, at compile time. A locale dictionary
 * silently drifting out of sync with the canonical `en` one (a key added to one but not the
 * other) is exactly the kind of bug that's invisible until a specific UI element renders
 * blank/wrong in one language — this makes it a build error instead. Extend both objects
 * together, in the same commit.
 */
import { getLanguage } from '../platform/yt'

export type Locale = 'en' | 'es'
export const DEFAULT_LOCALE: Locale = 'en'
const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'es']

const en = {
  settings: 'Settings',
  sound: 'Sound',
  music: 'Music',
  close: 'Close',
  shopTabShips: 'Ships',
  hangar: 'Hangar',
  hangarEquipped: 'Equipped',
  hangarEquip: 'Equip',
  hangarLocked: 'Locked',
  statShields: 'Shields',
  statFireRate: 'Fire rate',
  statLocks: 'Locks',
  statSpeed: 'Speed',
  shipLanceHull: 'Lancehull',
  shipLanceHullDetail: 'Balanced',
  shipNeedle: 'Needle',
  shipNeedleDetail: 'Fast gun, fast rail, fragile',
  shipBastion: 'Bastion',
  shipBastionDetail: 'Tough, but slow to fire',
  shipHive: 'Hive',
  shipHiveDetail: 'Wider strokes, slower rail',
  pickupHeal: 'HEALTH',
  pickupShield: 'SHIELD',
  pickupWeapon: 'NEW GUN',
  pickupFruit: 'FRUIT',
  pickupDouble: 'DOUBLE SCORE',
  back: 'Back',
  on: 'ON',
  off: 'OFF',
  shop: 'Shop',
  buy: 'Buy',
  owned: 'Owned',
  // The tab strip. Each key is also a `ShopItem.category` value, which is why they are ordinary
  // dictionary entries rather than anything the shop knows about by name.
  shopTabWeapons: 'Weapons',
  shopTabUpgrades: 'Upgrades',
  shopTabThemes: 'Themes',
  shopTabSnails: 'Snails',
  // Not "cannot afford": a blocked row is waiting on the row above it, which is a different
  // problem and has a different answer.
  shopLocked: 'Locked',
  // What an upgrade step buys. Step II depends on the weapon - see `rail/upgrades.ts`'s
  // `UPGRADE_PATH` - so the row says it rather than showing a bare numeral.
  upgradeRate: 'Rate',
  upgradePower: 'Power',
  upgradeShot: 'Extra shot',
  upgradeDamage: 'Damage',
  shopTopup: '\u{1F3AC} +{n} coins',
  // The ad catalogue's own names — see `shop/adCatalog.ts`. One per offer, so the list can be
  // rendered from the table rather than from three labels scattered across two scenes.
  adTopup: 'Coin top-up',
  /**
   * Putting a run down and picking it up — see `run/suspend.ts`.
   *
   * **`resumeRun` replaces `play` on the button rather than sitting beside it**, because it is the
   * same control doing the same thing to a run that already exists. What sits beside it is
   * `newRun`, the only thing the player might want that resuming does not do — and it is drawn only
   * when there is a run to abandon, so a screen with nothing suspended is one button.
   *
   * **⚠ Not `continueRun`, which is taken and means something else**: that one is the rewarded ad
   * on the result screen, i.e. buying a life back on a run that has *ended*. Two labels a player
   * would read as the same word, on two screens, meaning two different things — so the one added
   * here is named for what it is.
   */
  resumeRun: 'Continue',
  newRun: 'New run',
  /**
   * The quest board — see `ui/questBoard.ts`.
   *
   * **A label names the verb and never the sum.** They read `Collect 14 fruit` beside a counter
   * saying `6/14`, i.e. the target twice, with the row's widest column spent on the repetition.
   */
  questsTitle: 'Quests',
  questFruit: 'Collect fruit',
  questNearMiss: 'Close passes',
  questFever: 'Enter Fever',
  questRamp: 'Ride ramps',
  questCollect: 'COLLECT',
  adDouble: 'Double coins',
  adContinue: 'Continue run',
  // What is left of a limited offer, and what it reads when nothing is.
  adLeft: '{n} left',
  adSpent: 'None left today',
  // The coin-priced continue. It says the price on the button, because a player who has just lost a
  // run is not going to hunt for what it costs.
  continueCoins: '\u{2764} Continue · {n} \u{1FA99}',
  // Rail shooter strings. Added to both dictionaries in the same commit, which the
  // `Record<StringKey, string>` typing on `es` makes a build error rather than a blank label.
  start: 'Click to start',
  // The game's name, as a string rather than a constant: the menu and the loading screen both
  // read it from here, so changing it is a dictionary edit and not a code change. `SHOOTING
  // RACER` described a racer, which this game stopped being at the pivot.
  gameTitle: 'SNAIL RUNNER',
  play: 'Play',
  /**
   * The first run, which teaches itself. See `run/tutorial.ts`.
   *
   * **Each card is a title and a reason, and the reason is the half that matters.** A line naming
   * the button is a control the player forgets; a line saying what the thing is *for* is something
   * they can apply to the next one the game deals them without being told again.
   *
   * Kept to a handful of words each, because they are read at speed while a road is coming.
   */
  tutorialSteerTitle: 'Steer',
  tutorialSteerWhy: 'Drag anywhere. Coins are score — your line is what they cost.',
  tutorialJumpTitle: 'Jump',
  tutorialJumpWhy: 'Tap or press space. Height is the other way past things.',
  tutorialLowTitle: 'Low rock',
  tutorialLowWhy: 'Short enough to hop. Or go round it — both work.',
  tutorialWallTitle: 'A wall',
  tutorialWallWhy: 'No gap anywhere. The jump is the only way through.',
  tutorialBlockingTitle: 'Too tall',
  tutorialBlockingWhy: 'A jump will not clear this. Go around.',
  tutorialFruitTitle: 'Fruit',
  tutorialFruitWhy: 'Fills the leaf. A full leaf fires a Fever: faster, and it pulls pickups in.',
  tutorialShieldTitle: 'Shield',
  tutorialShieldWhy: 'A bubble you can see. It takes one hit instead of a life.',
  tutorialRampTitle: 'Ramp',
  tutorialRampWhy: 'Ride it. The coins are laid along the flight you are about to take.',
  tutorialDone: 'Good. The road is yours.',
  /**
   * The prompt under a `read` card.
   *
   * **It names the outcome, not the key**, for the reason every other line here does: the player is
   * about to press whatever is under their thumb, and what they need to know is that the road will
   * start when they do.
   */
  tutorialContinue: 'Tap to go',
  /** Under an `act` card, which is answered by doing the thing rather than by dismissing it. */
  tutorialTryIt: 'Try it',
  tutorialReplay: 'Tutorial',
  loadFailed: 'Could not load the game.\nCheck your connection and try again.',
  retry: 'Retry',
  /** The run's own screen: what a run produced and the two things to do next. */
  runOver: 'Run Ended',
  newBest: 'New best!',
  best: 'Best',
  menu: 'Menu',
  doubleCoins: '🎬 Double coins',
  waveIncoming: 'Wave {n} of {total} in {seconds}',
  // The endless run: no total, because there is not one. See `WaveBanner.announce`.
  waveEndless: 'Endless',
  levelEndless: 'Endless',
  levelEndlessHint: 'Clear all eight to open',
  // The combat banner. `waveTitle` is the announcement's own line and `waveOf` its subtitle;
  // the summary reuses none of them, because the two events are deliberately not alike.
  waveTitle: 'WAVE {n}',
  waveOf: '{n} of {total}',
  waveCleared: 'WAVE {n} CLEAR',
  summaryKills: 'Kills {n}',
  summaryAccuracy: 'Accuracy {n}%',
  summaryScore: 'Score {n}',
  runCleared: 'Cleared',
  runFailed: 'Shields down',
  resultScore: 'Score {score}',
  resultBest: 'Best {best}',
  resultWaves: 'Waves {cleared} of {total}',
  // What the run paid. Shown even at zero, because "this is where coins come from" is the thing
  // the line exists to say, and a line that only appears on good runs never teaches it.
  resultCoins: '\u{1FA99} +{n} coins',
  resultCoinsMax: '\u{1FA99} +{n} coins (max)',
  again: 'Again',
  // The rewarded continue. It names what it buys — the run — rather than reading `Continue`, which
  // on a screen that also offers `Again` is two words for the same thing to anyone reading fast.
  continueRun: '\u{1F3AC} Continue run',
  select: 'Select',
  selected: 'In use',
  // The settings screen's own strings. `percent` is a format rather than a word, and it is a
  // dictionary entry rather than a template literal because the symbol's position is not universal.
  audio: 'Audio',
  percent: '{n}%',
  muted: 'Muted',
  volume: 'Volume',
  // The level screen. Biome names are keyed `biome_<id>` so a level's label comes from its biome
  // rather than being maintained twice, exactly as theme names are keyed `theme_<id>`.
  levels: 'Levels',
  levelsProgress: '{n} of {total} unlocked',
  levelLocked: 'Locked',
  nextLevel: 'Next',
  levelLockedBy: 'Clear {name}',
  // **Named for the palette it applies, not for the mechanism.** `auto` means "no override",
  // which resolves to `DEFAULT_ROAD_THEME` — and that is `day`. The old label said "Match level",
  // which described a rail shooter that had levels; this fork has none, so it named a concept the
  // player could not find. **Coupled to `DEFAULT_ROAD_THEME`: move the default and this lies.**
  themeAuto: 'Day',
  // The mascot's five recolours. Names of colours rather than of species: what a skin changes is
  // where the shell and the foot sit on the hue wheel, and calling one "Forest Snail" would promise
  // a different creature. See `run/snailSkins.ts`.
  snail_amber: 'Amber',
  snail_fern: 'Fern',
  snail_teal: 'Teal',
  snail_indigo: 'Indigo',
  snail_rose: 'Rose',
  biome_forest: 'Forest',
  biome_dunes: 'Dunes',
  biome_wetland: 'Wetland',
  biome_ridge: 'Ridge',
  biome_ashen: 'Ashen',
  biome_crystal: 'Crystal',
  biome_coast: 'Coast',
  biome_ruins: 'Ruins',
  // The loadout screen. `loadoutSlot` is the number a row shows when the weapon is in the row; the
  // hint is one line because the two verbs are one each.
  loadout: 'Loadout',
  loadoutHint: 'Tap a weapon to lead with it.',
  loadoutBench: 'Benched',
  loadoutSlot: 'Slot {n}',
  loadoutFourthSlot: 'Fourth slot',
  loadoutFourthSlotDetail: 'Carry one more',
  // Theme names. Keyed `theme_<id>` so `ShopItem.titleKey` can be derived from the theme id
  // rather than hand-maintained; a theme with no entry falls back to a title-cased id.
  theme_night: 'Night',
  theme_dusk: 'Dusk',
  theme_ice: 'Ice',
  theme_ember: 'Ember',
  theme_verdant: 'Verdant',
  theme_signal: 'Signal',
  weaponLance: 'Lance',
  weaponScatter: 'Scatter',
  weaponPulse: 'Pulse',
  weaponRipple: 'Ripple',
  weaponFlechette: 'Flechette',
  weaponMortar: 'Mortar',
  weaponNeedle: 'Needle',
} as const

export type StringKey = keyof typeof en

const es: Record<StringKey, string> = {
  settings: 'Ajustes',
  sound: 'Sonido',
  music: 'Música',
  close: 'Cerrar',
  shopTabShips: 'Naves',
  hangar: 'Hangar',
  hangarEquipped: 'Equipada',
  hangarEquip: 'Equipar',
  hangarLocked: 'Bloqueada',
  statShields: 'Escudos',
  statFireRate: 'Cadencia',
  statLocks: 'Marcas',
  statSpeed: 'Velocidad',
  shipLanceHull: 'Casco Lanza',
  shipLanceHullDetail: 'Equilibrada',
  shipNeedle: 'Aguja',
  shipNeedleDetail: 'Arma rápida, riel rápido, frágil',
  shipBastion: 'Bastion',
  shipBastionDetail: 'Resistente, pero dispara lento',
  shipHive: 'Enjambre',
  shipHiveDetail: 'Más marcas, riel más lento',
  pickupHeal: 'SALUD',
  pickupShield: 'ESCUDO',
  pickupWeapon: 'ARMA NUEVA',
  pickupFruit: 'FRUTA',
  pickupDouble: 'PUNTOS x2',
  back: 'Atrás',
  on: 'SÍ',
  off: 'NO',
  shop: 'Tienda',
  buy: 'Comprar',
  owned: 'Comprado',
  shopTabWeapons: 'Armas',
  shopTabUpgrades: 'Mejoras',
  shopTabThemes: 'Temas',
  shopTabSnails: 'Caracoles',
  shopLocked: 'Bloqueado',
  upgradeRate: 'Cadencia',
  upgradePower: 'Potencia',
  upgradeShot: 'Disparo extra',
  upgradeDamage: 'Daño',
  shopTopup: '\u{1F3AC} +{n} monedas',
  adTopup: 'Monedas extra',
  resumeRun: 'Continuar',
  newRun: 'Nueva partida',
  questsTitle: 'Misiones',
  questFruit: 'Recoge fruta',
  questNearMiss: 'Pasa cerca',
  questFever: 'Entra en Fiebre',
  questRamp: 'Usa rampas',
  questCollect: 'COBRAR',
  adDouble: 'Duplicar monedas',
  adContinue: 'Seguir el recorrido',
  adLeft: 'Quedan {n}',
  adSpent: 'No quedan hoy',
  continueCoins: '\u{2764} Seguir · {n} \u{1FA99}',
  start: 'Toca para empezar',
  // A brand name is not translated; the key exists in both dictionaries because the type demands
  // it, and both hold the same word on purpose.
  gameTitle: 'SNAIL RUNNER',
  play: 'Jugar',
  tutorialSteerTitle: 'Conduce',
  tutorialSteerWhy: 'Arrastra donde sea. Las monedas son puntos: tu trazada es lo que cuestan.',
  tutorialJumpTitle: 'Salta',
  tutorialJumpWhy: 'Toca o pulsa espacio. La altura es la otra forma de pasar.',
  tutorialLowTitle: 'Roca baja',
  tutorialLowWhy: 'Basta un salto. O rodéala: las dos valen.',
  tutorialWallTitle: 'Un muro',
  tutorialWallWhy: 'No hay hueco. El salto es la única forma de pasar.',
  tutorialBlockingTitle: 'Demasiado alto',
  tutorialBlockingWhy: 'Un salto no lo supera. Rodéalo.',
  tutorialFruitTitle: 'Fruta',
  tutorialFruitWhy: 'Llena la hoja. Una hoja llena lanza el Fever: más rápido, y atrae los objetos.',
  tutorialShieldTitle: 'Escudo',
  tutorialShieldWhy: 'Una burbuja visible. Aguanta un golpe en lugar de una vida.',
  tutorialRampTitle: 'Rampa',
  tutorialRampWhy: 'Súbete. Las monedas están puestas a lo largo del vuelo que vas a hacer.',
  tutorialDone: 'Bien. La carretera es tuya.',
  tutorialContinue: 'Toca para seguir',
  tutorialTryIt: 'Pruébalo',
  tutorialReplay: 'Tutorial',
  loadFailed: 'No se pudo cargar el juego.\nComprueba tu conexión e inténtalo de nuevo.',
  retry: 'Reintentar',
  runOver: 'Recorrido terminado',
  newBest: '¡Nuevo récord!',
  best: 'Mejor',
  menu: 'Menú',
  doubleCoins: '🎬 Duplicar monedas',
  waveIncoming: 'Oleada {n} de {total} en {seconds}',
  waveEndless: 'Sin fin',
  levelEndless: 'Sin fin',
  levelEndlessHint: 'Supera las ocho para abrirlo',
  waveTitle: 'OLEADA {n}',
  waveOf: '{n} de {total}',
  waveCleared: 'OLEADA {n} LISTA',
  summaryKills: 'Bajas {n}',
  summaryAccuracy: 'Precision {n}%',
  summaryScore: 'Puntos {n}',
  runCleared: 'Superado',
  runFailed: 'Escudos agotados',
  resultScore: 'Puntos {score}',
  resultBest: 'Récord {best}',
  resultWaves: 'Oleadas {cleared} de {total}',
  resultCoins: '\u{1FA99} +{n} monedas',
  resultCoinsMax: '\u{1FA99} +{n} monedas (máx)',
  again: 'Otra vez',
  continueRun: '\u{1F3AC} Seguir el recorrido',
  select: 'Elegir',
  selected: 'En uso',
  audio: 'Audio',
  percent: '{n}%',
  muted: 'Silencio',
  volume: 'Volumen',
  levels: 'Niveles',
  levelsProgress: '{n} de {total} desbloqueados',
  levelLocked: 'Bloqueado',
  nextLevel: 'Siguiente',
  levelLockedBy: 'Completa {name}',
  themeAuto: 'Día',
  snail_amber: 'Ámbar',
  snail_fern: 'Helecho',
  snail_teal: 'Turquesa',
  snail_indigo: 'Índigo',
  snail_rose: 'Rosa',
  biome_forest: 'Bosque',
  biome_dunes: 'Dunas',
  biome_wetland: 'Humedal',
  biome_ridge: 'Cresta',
  biome_ashen: 'Ceniza',
  biome_crystal: 'Cristal',
  biome_coast: 'Costa',
  biome_ruins: 'Ruinas',
  loadout: 'Equipo',
  loadoutHint: 'Toca un arma para llevarla primero.',
  loadoutBench: 'Fuera',
  loadoutSlot: 'Ranura {n}',
  loadoutFourthSlot: 'Cuarta ranura',
  loadoutFourthSlotDetail: 'Lleva una más',
  theme_night: 'Noche',
  theme_dusk: 'Ocaso',
  theme_ice: 'Hielo',
  theme_ember: 'Brasa',
  theme_verdant: 'Verdor',
  theme_signal: 'Señal',
  weaponLance: 'Lanza',
  weaponScatter: 'Dispersión',
  weaponPulse: 'Pulso',
  weaponRipple: 'Onda',
  weaponFlechette: 'Flechilla',
  weaponMortar: 'Mortero',
  weaponNeedle: 'Aguja',
}

const STRINGS: Record<Locale, Record<StringKey, string>> = { en, es }

let currentLocale: Locale = DEFAULT_LOCALE

/**
 * BCP-47 prefix match: `'es-MX'` -> `'es'`, `'fr-FR'` -> `'fr'` -> not in `SUPPORTED_LOCALES`
 * -> falls back to `DEFAULT_LOCALE`. Written generically (not hardcoded to just `en`/`es`) so
 * adding a locale later is only a new dictionary object plus one entry in `SUPPORTED_LOCALES`.
 */
export function resolveLocale(raw: string): Locale {
  const prefix = raw.toLowerCase().split('-')[0]
  return (SUPPORTED_LOCALES as readonly string[]).includes(prefix) ? (prefix as Locale) : DEFAULT_LOCALE
}

/**
 * Called once from `main.ts`, before `new Phaser.Game(...)` (same timing as any other
 * boot-order-sensitive init) — a scene can read `t()` strings from its very first `create()`
 * call, so the locale has to already be resolved before that, not resolved lazily on first
 * use. `getLanguage()` itself never rejects (see `platform/yt.ts`), but this still guards with
 * a fallback rather than letting a hypothetical future throw there block game boot over a
 * cosmetic concern.
 */
export async function initLocale(): Promise<void> {
  try {
    currentLocale = resolveLocale(await getLanguage())
  } catch {
    currentLocale = DEFAULT_LOCALE
  }
}

/** The currently resolved locale (`DEFAULT_LOCALE` until `initLocale()` resolves). */
export function getLocale(): Locale {
  return currentLocale
}

function lookup(key: string): string | undefined {
  return (STRINGS[currentLocale] as Record<string, string>)[key] ?? (STRINGS[DEFAULT_LOCALE] as Record<string, string>)[key]
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole))
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  // lookup() can't actually miss for a real StringKey (both dictionaries are total over it,
  // enforced at compile time above) — the `?? key` is only a defensive fallback so a typo'd
  // key reads as visible mistranslated text in dev rather than throwing mid-scene.
  return interpolate(lookup(key) ?? key, params)
}

/**
 * For a dynamic, not-statically-known key (e.g. a generated/content-driven display-name key) —
 * returns `undefined` instead of the key itself on a miss, so a caller can fall back to its own
 * default (e.g. `?? rawId`) rather than displaying a raw dictionary key string.
 */
export function tOptional(key: string): string | undefined {
  return lookup(key)
}
