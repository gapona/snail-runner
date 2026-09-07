// Per-frame motion of the frog's centre of mass across one hop, at the rate it is seen at.
// The question is not "is any step large" but "is any step an OUTLIER" -- a phase boundary that
// moves the creature much further in one frame than the rest of the cycle does is a snap.
import { hopPose, HOP_CYCLE_MS, CROUCH_MS, HOP_FLIGHT_MS, LANDING_IN_MS } from '../src/run/critterJump.ts'
import { CRITTER_KINDS, CRITTER_AIR_POSES, CRITTER_GROUND_ANCHOR, tuckOffset } from '../src/run/critters.ts'

const kind = 'frog'
const spec = CRITTER_KINDS[kind]
const air = CRITTER_AIR_POSES[kind]
const groundAnchor = CRITTER_GROUND_ANCHOR[kind]
const offset = tuckOffset(kind)
const groundHeight = spec.band.yHigh - spec.band.yLow
const HZ = 60

const anchorAt = (ms) => {
  const p = hopPose((ms / 1000) * spec.speed, spec.speed, 0, offset)
  const base = p.y - (p.tucked ? offset * p.scaleY : 0)
  const height = (p.tucked ? air.height : groundHeight) * p.scaleY
  return base + (p.tucked ? air.anchorFromBottom : groundAnchor) * height
}

const label = (ms) =>
  ms < CROUCH_MS ? 'crouch'
  : ms < CROUCH_MS + HOP_FLIGHT_MS ? 'flight'
  : ms < CROUCH_MS + HOP_FLIGHT_MS + LANDING_IN_MS ? 'impact'
  : 'recover'

const step = 1000 / HZ
const steps = []
for (let ms = 0; ms + step < HOP_CYCLE_MS; ms += step) {
  steps.push({ ms, moved: Math.abs(anchorAt(ms + step) - anchorAt(ms)), phase: `${label(ms)}->${label(ms + step)}` })
}
const sorted = [...steps].map((s) => s.moved).sort((a, b) => a - b)
const median = sorted[Math.floor(sorted.length / 2)]
console.log(`cycle ${HOP_CYCLE_MS.toFixed(0)}ms, ${steps.length} frames at ${HZ}Hz`)
console.log(`median step ${median.toFixed(2)}u   p90 ${sorted[Math.floor(sorted.length * 0.9)].toFixed(2)}u   max ${sorted.at(-1).toFixed(2)}u`)
console.log('largest five:')
for (const s of [...steps].sort((a, b) => b.moved - a.moved).slice(0, 5)) {
  console.log(`  ${s.ms.toFixed(0).padStart(4)}ms  ${s.moved.toFixed(2).padStart(6)}u   ${(s.moved / median).toFixed(1)}x median   ${s.phase}`)
}
