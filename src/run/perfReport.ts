/**
 * The DEV-only frame-cost report.
 *
 * **This module exists to be absent from the production bundle**, and the shape is the whole
 * point. Gating the *call site* with `import.meta.env.DEV` removes the call but not the method
 * it called: Vite eliminates the dead branch, and the class method — string literals and all —
 * stays in the bundle unreferenced. `check-bundle.mjs` greps the built output for these global
 * names precisely because "we gated it" and "it is gone" are different claims, and it caught
 * exactly this: four `__*Perf` names shipping in a build that could never assign them.
 *
 * Reached only through a dynamic `import()` inside a `import.meta.env.DEV` branch, so with the
 * branch eliminated nothing references this file and Rollup never emits it.
 */

export interface PerfReport {
  road: Record<string, unknown>
  decor: Record<string, unknown>
  enemies: Record<string, unknown>
  effects: Record<string, unknown>
}

/**
 * Publishes the report on `window` and logs it.
 *
 * On `window` rather than returned, because the only consumers are a human at a console and an
 * automation script — and a raw dynamic `import()` from a test script gets its own disconnected
 * module instance, so a global is the one place both can reliably reach. See CLAUDE.md's note
 * on that gotcha under "Audio Layer".
 */
export function reportPerf(report: PerfReport): void {
  const globals = window as unknown as Record<string, unknown>

  globals.__roadPerf = report.road
  globals.__decorPerf = report.decor
  globals.__enemyPerf = report.enemies
  globals.__effectPerf = report.effects

  console.log('[road] RoadMesh.render cost', report.road)
  console.log('[decor] RoadSprites.render cost', report.decor)
  console.log('[enemies] Enemies.render + ShotSprites.render + lock-on cost', report.enemies)
  console.log('[effects] Effects.update cost', report.effects)
}
