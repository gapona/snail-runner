#!/usr/bin/env node
// Logic check for the sound layer -- src/audio/synth.ts (WAV rendering) and src/audio/sfx.ts
// (the lock scale and the repeat policy). Neither imports phaser. Plain assertions, no
// framework, via the register-ts-loader.mjs + ts-extensionless-loader.mjs setup.
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import {
  encodeWav,
  FADE_TEARDOWN_GAP_MS,
  renderSamples,
  renderToneUri,
  SAMPLE_RATE,
  teardownDelayMs,
  toBase64,
} from '../src/audio/synth.ts'
import {
  createRepeatState,
  STREAK_BASE_HZ,
  STREAK_STEPS,
  STREAK_SEMITONES_PER_STEP,
  streakDetuneCents,
  streakFrequency,
  MIN_REPEAT_GAP_MS,
  nextRepeat,
  renderSfxUris,
  SFX,
  SFX_ASSETS,
  SFX_FILES,
  VARIATION_CENTS,
} from '../src/audio/sfx.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

console.log('src/audio/synth.ts')

check('a rendered tone has the right length and never clips', () => {
  const samples = renderSamples({ waveform: 'sine', frequency: 440, durationMs: 100, gain: 0.5 })

  assert.equal(samples.length, Math.round(0.1 * SAMPLE_RATE))
  for (const value of samples) assert.ok(value >= -1 && value <= 1, `sample out of range: ${value}`)
  assert.ok(Math.max(...samples) > 0.3, 'the tone is inaudibly quiet')
  assert.ok(Math.max(...samples) <= 0.5 + 1e-6, 'the tone exceeded its own gain')
})

check('the envelope fades in and out, so nothing clicks', () => {
  const samples = renderSamples({ waveform: 'square', frequency: 300, durationMs: 200, attackMs: 20, releaseMs: 80, gain: 1 })
  const peak = (from, to) => Math.max(...Array.from(samples.slice(from, to)).map(Math.abs))

  // A square wave at full gain would sit at 1 throughout without an envelope.
  assert.ok(Math.abs(samples[0]) < 0.2, `the first sample is ${samples[0]} — that is a click`)
  assert.ok(Math.abs(samples[samples.length - 1]) < 0.2, 'the last sample is a click')
  assert.ok(peak(Math.round(samples.length * 0.4), Math.round(samples.length * 0.6)) > 0.8, 'the middle should be at full level')
})

check('rendering is deterministic, noise included', () => {
  const spec = { waveform: 'noise', frequency: 200, durationMs: 120, gain: 0.6 }

  assert.deepEqual(renderSamples(spec), renderSamples(spec))
  assert.equal(renderToneUri(spec), renderToneUri(spec))
})

check('a sweep actually moves, and does so smoothly', () => {
  const samples = renderSamples({ waveform: 'sine', frequency: 200, sweepTo: 1200, durationMs: 300, gain: 0.8 })
  // Zero crossings per unit time must rise across the sound if the pitch is climbing.
  const crossings = (from, to) => {
    let count = 0
    for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 !== samples[i] < 0) count++
    return count
  }
  const third = Math.floor(samples.length / 3)

  assert.ok(crossings(2 * third, samples.length) > crossings(0, third) * 2, 'the sweep did not rise')

  // Phase is integrated, so there must be no jump between consecutive samples.
  let worst = 0
  for (let i = 1; i < samples.length; i++) worst = Math.max(worst, Math.abs(samples[i] - samples[i - 1]))
  assert.ok(worst < 0.5, `a discontinuity of ${worst} — the sweep is recomputing phase rather than integrating it`)
})

console.log('src/audio/synth.ts -- the WAV container')

check('the header is a real 16-bit mono PCM WAV of the right size', () => {
  const samples = renderSamples({ waveform: 'sine', frequency: 440, durationMs: 50 })
  const wav = encodeWav(samples)
  const view = new DataView(wav.buffer)
  const ascii = (at, length) => String.fromCharCode(...wav.slice(at, at + length))

  assert.equal(wav.length, 44 + samples.length * 2)
  assert.equal(ascii(0, 4), 'RIFF')
  assert.equal(ascii(8, 4), 'WAVE')
  assert.equal(ascii(12, 4), 'fmt ')
  assert.equal(ascii(36, 4), 'data')
  assert.equal(view.getUint32(4, true), 36 + samples.length * 2, 'RIFF size must exclude its own 8-byte header')
  assert.equal(view.getUint16(20, true), 1, 'format must be PCM')
  assert.equal(view.getUint16(22, true), 1, 'mono')
  assert.equal(view.getUint32(24, true), SAMPLE_RATE)
  assert.equal(view.getUint32(28, true), SAMPLE_RATE * 2, 'byte rate must match 16-bit mono')
  assert.equal(view.getUint16(32, true), 2, 'block align')
  assert.equal(view.getUint16(34, true), 16, 'bits per sample')
  assert.equal(view.getUint32(40, true), samples.length * 2)
})

check('full-scale samples do not wrap around to the opposite sign', () => {
  // Signed 16-bit runs -32768..32767, so scaling both directions by the same number either
  // clips the positive peak or overflows it into a loud negative crack.
  const wav = encodeWav(Float32Array.from([1, -1, 0, 0.5, -0.5]))
  const view = new DataView(wav.buffer)

  assert.equal(view.getInt16(44, true), 32767)
  assert.equal(view.getInt16(46, true), -32768)
  assert.equal(view.getInt16(48, true), 0)
  assert.ok(view.getInt16(50, true) > 16000 && view.getInt16(52, true) < -16000)
})

check('base64 encodes correctly, including both padding cases', () => {
  const encode = (text) => toBase64(Uint8Array.from([...text].map((c) => c.charCodeAt(0))))

  assert.equal(encode('any carnal pleasure.'), 'YW55IGNhcm5hbCBwbGVhc3VyZS4=')
  assert.equal(encode('any carnal pleasure'), 'YW55IGNhcm5hbCBwbGVhc3VyZQ==')
  assert.equal(encode('any carnal pleasur'), 'YW55IGNhcm5hbCBwbGVhc3Vy')
  assert.equal(encode(''), '')
})

check('every sound renders to a playable data URI, and none is absurdly large', () => {
  const uris = renderSfxUris()

  assert.equal(uris.length, SFX_ASSETS.length)
  assert.equal(new Set(uris.map((u) => u.key)).size, uris.length, 'two sounds share a key')
  for (const { key, uri } of uris) {
    assert.ok(uri.startsWith('data:audio/wav;base64,'), `${key} is not a wav data URI`)
    assert.ok(uri.length > 1000, `${key} is suspiciously short`)
    assert.ok(uri.length < 80_000, `${key} is ${Math.round(uri.length / 1024)}KB — too big to be generated at boot`)
  }
  const total = uris.reduce((sum, u) => sum + u.uri.length, 0)
  console.log(`    ${uris.length} sounds, ${Math.round(total / 1024)}KB of base64 in total, zero bytes in the bundle`)
})

check('every declared key is either rendered or shipped, and never both', () => {
  // **Two sources now, and the failure this guards is a key with neither.** Most sounds are
  // arithmetic; two are CC0 recordings, because a waveform cannot sound like an object being struck
  // (see `SFX_FILES`). A key in *both* lists would load twice into one cache entry, and a key in
  // neither is a `playSfx` that throws on a missing key at the moment it is wanted.
  const declared = new Set(Object.values(SFX))
  const rendered = new Set(SFX_ASSETS.map((a) => a.key))
  const shipped = new Set(Object.keys(SFX_FILES))

  for (const key of declared) {
    const sources = (rendered.has(key) ? 1 : 0) + (shipped.has(key) ? 1 : 0)

    assert.equal(sources, 1, `${key} has ${sources} sources — it must be rendered or shipped, exactly one`)
  }
  for (const key of rendered) assert.ok(declared.has(key), `${key} is rendered but not declared in SFX`)
  for (const key of shipped) assert.ok(declared.has(key), `${key} is shipped but not declared in SFX`)
  console.log(`    ${rendered.size} rendered, ${shipped.size} shipped, ${declared.size} declared`)
})

check('⚠ every shipped sound is actually on disk, and small enough to be one', () => {
  // A path that does not exist is a 404 during the loading screen and a throw at the moment the
  // sound is wanted -- and the loader's own error handler stops the handover, so a typo here is a
  // game that never reaches the menu. Checked against the file system rather than trusted, because
  // nothing else in the build looks at these strings.
  let bytes = 0

  for (const [key, path] of Object.entries(SFX_FILES)) {
    const file = `public/assets/${path}`

    assert.ok(existsSync(file), `${key} points at ${file}, which is not there`)
    const size = statSync(file).size

    // Not a budget so much as a shape check: these are one-shot effects, and anything approaching a
    // hundred kilobytes is a music loop that has been filed in the wrong place.
    assert.ok(size > 0 && size < 100 * 1024, `${file} is ${size} bytes — that is not a one-shot effect`)
    bytes += size
  }
  console.log(`    ${Object.keys(SFX_FILES).length} shipped sounds, ${(bytes / 1024).toFixed(1)}KB in total`)
})

console.log('src/audio/synth.ts -- the fade teardown gap')

check('a fading sound is destroyed strictly after its ramp, with room to spare', () => {
  // The trap this guards is silent: Chromium drops a scheduled AudioParam change if the node
  // is torn down in the same tick, with no exception and no console warning — the sound cuts
  // where it should have faded. The observable edge is around 10ms.
  assert.ok(FADE_TEARDOWN_GAP_MS >= 10, `a ${FADE_TEARDOWN_GAP_MS}ms gap is inside the range where Chromium drops the ramp`)
  assert.equal(teardownDelayMs(0), FADE_TEARDOWN_GAP_MS, 'even a zero-length fade needs the gap')
  assert.equal(teardownDelayMs(250), 250 + FADE_TEARDOWN_GAP_MS)
  assert.ok(teardownDelayMs(250) > 250, 'the teardown must land after the ramp, not on it')
  // A negative duration must not pull the teardown forward into the same tick.
  assert.equal(teardownDelayMs(-100), FADE_TEARDOWN_GAP_MS)
})

console.log('src/audio/sfx.ts -- the streak scale')

check('each step is one fixed interval above the last, all the way to STREAK_STEPS', () => {
  // The property the whole design rests on: the player must be able to count steps by ear.
  assert.equal(streakDetuneCents(0), 0)
  for (let i = 1; i <= STREAK_STEPS; i++) {
    assert.equal(streakDetuneCents(i) - streakDetuneCents(i - 1), STREAK_SEMITONES_PER_STEP * 100, `step ${i} is not a fixed interval`)
  }
  assert.ok(Math.abs(streakFrequency(0) - STREAK_BASE_HZ) < 1e-9)
  // Every step must be a clearly audible change, and the top must stay in a sane register.
  for (let i = 1; i < STREAK_STEPS; i++) {
    const ratio = streakFrequency(i) / streakFrequency(i - 1)
    assert.ok(ratio > 1.1, `step ${i} is only a ${((ratio - 1) * 100).toFixed(1)}% change — too small to count by ear`)
  }
  assert.ok(streakFrequency(STREAK_STEPS - 1) < 4000, `the eighth step sits at ${Math.round(streakFrequency(STREAK_STEPS - 1))}Hz — shrill`)
  console.log(`    ${STREAK_STEPS} steps span ${Math.round(streakFrequency(0))}Hz to ${Math.round(streakFrequency(STREAK_STEPS - 1))}Hz`)
})

console.log('src/audio/sfx.ts -- the repeat policy')

check('a burst inside the minimum gap is thinned rather than played in full', () => {
  const state = createRepeatState()

  assert.notEqual(nextRepeat(state, 1000), null, 'the first play must always be allowed')
  assert.equal(nextRepeat(state, 1000), null, 'the same millisecond must not play twice')
  assert.equal(nextRepeat(state, 1000 + MIN_REPEAT_GAP_MS - 1), null)
  assert.notEqual(nextRepeat(state, 1000 + MIN_REPEAT_GAP_MS), null)
})

check('a refused call does not advance the rotation', () => {
  const state = createRepeatState()
  const first = nextRepeat(state, 0)

  nextRepeat(state, 1)
  nextRepeat(state, 2)
  const second = nextRepeat(state, MIN_REPEAT_GAP_MS)

  assert.notEqual(first, second, 'two consecutive plays came out identical — the rotation was burnt by refusals')
})

check('consecutive plays rotate across the full detune spread, symmetrically', () => {
  const state = createRepeatState()
  const detunes = []

  for (let i = 0; i < 6; i++) detunes.push(nextRepeat(state, i * MIN_REPEAT_GAP_MS))

  assert.deepEqual(detunes.slice(0, 3), [-VARIATION_CENTS, 0, VARIATION_CENTS])
  assert.deepEqual(detunes.slice(3), detunes.slice(0, 3), 'the rotation must cycle')
  assert.equal(detunes[0] + detunes[2], 0, 'the spread must be symmetric about the original pitch')
})

check('a single-variant sound is allowed, and plays at its own pitch', () => {
  const state = createRepeatState()

  assert.equal(nextRepeat(state, 0, 1), 0)
  assert.equal(nextRepeat(state, MIN_REPEAT_GAP_MS, 1), 0)
})

check('eight simultaneous impacts collapse to one sound, not eight', () => {
  // The case this exists for: a volley of eight arriving together.
  const state = createRepeatState()
  let played = 0

  for (let i = 0; i < 8; i++) if (nextRepeat(state, 5000) !== null) played++
  assert.equal(played, 1)

  // ...but a second volley 400ms later is heard.
  assert.notEqual(nextRepeat(state, 5400), null)
})

console.log(`${passed} checks passed`)
