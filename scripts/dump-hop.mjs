// Dumps the frog's hop as a table, through the game's own modules -- the renderer that draws the
// acceptance GIF composites this rather than reimplementing the arc or the pose swap.
import { hopPose, HOP_APEX, HOP_LAUNCH_V, HOP_FLIGHT_MS, HOP_CYCLE_MS, CROUCH_MS, LANDING_MS } from '../src/run/critterJump.ts'
import { CRITTER_KINDS, CRITTER_AIR_POSES, CRITTER_GROUND_ANCHOR, tuckOffset } from '../src/run/critters.ts'
import { JUMP_APEX } from '../src/run/constants.ts'

const spec = CRITTER_KINDS.frog
const speed = spec.speed
const air = CRITTER_AIR_POSES.frog
const offset = tuckOffset('frog')
const groundH = spec.band.yHigh - spec.band.yLow

const out = {
  apex: HOP_APEX, launchV: HOP_LAUNCH_V, flightMs: HOP_FLIGHT_MS, cycleMs: HOP_CYCLE_MS,
  crouchMs: CROUCH_MS, landingMs: LANDING_MS, speed, jumpApex: JUMP_APEX,
  groundHeight: groundH, groundWidth: spec.halfWidths * 2 * 2000,
  air, tuckOffset: offset, groundAnchor: CRITTER_GROUND_ANCHOR.frog,
  frames: [],
}
const steps = 240
for (let i = 0; i < steps; i++) {
  const ms = (i / steps) * HOP_CYCLE_MS
  const p = hopPose((ms / 1000) * speed, speed, 0, offset)
  // The anchor's world height, computed the way CritterSprites places the sprite -- so the clip
  // can assert continuity on the same number the game draws with.
  const baseOffset = p.tucked ? offset * p.scaleY : 0
  const base = p.y - baseOffset
  const h = (p.tucked ? air.height : groundH) * p.scaleY
  const anchorFrac = p.tucked ? air.anchorFromBottom : CRITTER_GROUND_ANCHOR.frog
  out.frames.push({
    ms: +ms.toFixed(1), y: +p.y.toFixed(2), sx: +p.scaleX.toFixed(4), sy: +p.scaleY.toFixed(4),
    air: p.airborne, tucked: p.tucked, base: +base.toFixed(2),
    anchorY: +(base + anchorFrac * h).toFixed(2),
  })
}
console.log(JSON.stringify(out))
