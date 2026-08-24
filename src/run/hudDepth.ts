/**
 * The one depth the whole HUD draws at.
 *
 * **Not a style choice — it is load-bearing, and it was found by screenshot.** The damage frame
 * also lives on `uiCamera` and draws at an *effect's* depth, so with the HUD at the default `0`
 * the readouts sat underneath it: the shields count vanished behind the very effect announcing
 * that one had been lost. Nothing about either file suggests they compete, which is exactly why
 * the number lives in one place that both the HUD and everything added beside it can read.
 *
 * Its own module so that `Hud.ts`, `ScorePops.ts` and `WaveBanner.ts` can share it without one
 * of them importing another purely for a constant.
 */
export const HUD_DEPTH = 5000
