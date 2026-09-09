#!/usr/bin/env node
// Logic check for the sound layer -- src/audio/synth.ts (WAV rendering) and src/audio/sfx.ts
// (the lock scale and the repeat policy). Neither imports phaser. Plain assertions, no
// framework, via the register-ts-loader.mjs + ts-extensionless-loader.mjs setup.
import assert from 'node:assert/strict'
import {
  MUSIC,
  MUSIC_KEY,
  MUSIC_LENGTH_MS,
  musicNotes,
  noteHz,
  renderMusic,
} from '../src/audio/music.ts'
import { TIER_COUNT } from '../src/run/nearMiss.ts'
import { existsSync, readFileSync, statSync } from 'node:fs'
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
  NEAR_MISS_BASE_HZ,
  NEAR_MISS_STREAK_CEILING,
  NEAR_MISS_STREAK_SEMITONES,
  NEAR_MISS_TIER_SEMITONES,
  NEAR_MISS_TIERS,
  nearMissDetuneCents,
  nearMissGain,
  NEAR_MISS_TIER_GAIN,
  nearMissFrequency,
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

check('the near-miss ladder climbs twice and stops before it shrieks', () => {
  // **⚠ The one number this check exists for: where the top of the ladder actually lands.** Two
  // ladders share one sample — five rungs of manoeuvre and a streak with no bound of its own — and
  // their spans add. At two semitones each that is 8 + 12 = 20 semitones over the base, so the base
  // is what decides whether the top is a reward or an alarm.
  const bottom = nearMissFrequency(0, 0)
  const top = nearMissFrequency(NEAR_MISS_TIERS - 1, 99)
  const harmonicTop = top * Math.pow(2, 7 / 12)

  assert.equal(bottom, NEAR_MISS_BASE_HZ, 'the bottom of the ladder is not the tone that was rendered')
  console.log(
    `    near miss ${bottom.toFixed(0)}Hz at the bottom, ${top.toFixed(0)}Hz at the top ` +
      `(${(Math.log2(top / bottom) * 12).toFixed(0)} semitones), harmonic reaching ${harmonicTop.toFixed(0)}Hz`,
  )

  // A tone whose fundamental passes ~1.2kHz starts reading as a beep rather than as an instrument,
  // and its harmonic is what actually hurts: this holds the partial the ear hears loudest.
  assert.ok(top < 1200, `the top of the ladder is ${top.toFixed(0)}Hz, which is a beep rather than a note`)
  assert.ok(harmonicTop < 2400, `the top harmonic is ${harmonicTop.toFixed(0)}Hz, i.e. it shrieks`)

  // **The cap is on the ceiling, not on the step**, which is the half a smaller interval would have
  // got wrong: the first few passes are the ones a player hears as a run, so the step has to stay
  // audible and the climb simply stops.
  assert.equal(NEAR_MISS_STREAK_SEMITONES, 2, 'the streak step shrank instead of the ceiling being capped')
  // The two intervals must differ, or their sum degenerates -- see the aliasing note on the module.
  assert.notEqual(
    NEAR_MISS_TIER_SEMITONES,
    NEAR_MISS_STREAK_SEMITONES,
    'the two ladders share an interval, so a cheap pass deep in a streak sounds like a dear one at its start',
  )
  assert.equal(
    nearMissDetuneCents(0, NEAR_MISS_STREAK_CEILING),
    nearMissDetuneCents(0, 500),
    'the streak keeps climbing past its ceiling',
  )
  assert.equal(
    Math.log2(nearMissFrequency(0, NEAR_MISS_STREAK_CEILING) / bottom) * 12,
    12,
    'the streak does not span exactly an octave',
  )
})

check('every rung and every streak step is a distinct pitch, and rungs stay ordered', () => {
  // A ladder whose rungs the ear cannot separate is not feedback, which is the whole reason the
  // rejected sixth manoeuvre ("through the one gap in a wall") was rejected.
  const heard = new Set()

  for (let tier = 0; tier < NEAR_MISS_TIERS; tier++) {
    let previousStep = -1

    for (let step = 0; step <= NEAR_MISS_STREAK_CEILING; step++) {
      const cents = nearMissDetuneCents(tier, step)

      assert.ok(cents > previousStep, `tier ${tier} step ${step} did not rise above the step below it`)
      previousStep = cents
      heard.add(cents)
    }

    // A dearer manoeuvre at the same point in a streak always sounds higher than a cheaper one.
    if (tier > 0) {
      assert.ok(
        nearMissDetuneCents(tier, 0) > nearMissDetuneCents(tier - 1, 0),
        `rung ${tier} is not above rung ${tier - 1}`,
      )
    }
  }

  // Every step of both ladders is at least a semitone from its neighbour, which is the interval
  // below which two notes stop reading as different notes at all.
  const sorted = [...heard].sort((a, b) => a - b)

  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i] - sorted[i - 1] >= 100, `two positions on the ladder are ${sorted[i] - sorted[i - 1]} cents apart`)
  }
  const combinations = NEAR_MISS_TIERS * (NEAR_MISS_STREAK_CEILING + 1)

  console.log(`    ${sorted.length} distinct pitches over ${combinations} rung/streak combinations`)
  // **⚠ Equal intervals collapsed this to 11 of 35** and made a cheap pass six into a streak
  // indistinguishable from the dearest manoeuvre at the start of one. Two thirds is what unequal
  // intervals buy; the rest is separated by weight rather than by pitch.
  assert.ok(
    sorted.length >= combinations * 0.55,
    `${sorted.length} of ${combinations} rung/streak pairs are audibly distinct, i.e. the ladders alias`,
  )

  // The rung is carried on a second channel precisely because pitch cannot separate every pair: a
  // dearer manoeuvre is always *fuller*, whatever the streak has done to its pitch.
  let previousGain = 0

  for (let tier = 0; tier < NEAR_MISS_TIERS; tier++) {
    const gain = nearMissGain(tier)

    assert.ok(gain > previousGain, `rung ${tier} is not louder than the rung below it`)
    previousGain = gain
  }
  assert.ok(previousGain <= 1.6, `the top rung is ${previousGain.toFixed(2)}x the bottom, which is a shout`)
  console.log(`    the dearest rung plays at ${previousGain.toFixed(2)}x the cheapest, so weight separates what pitch cannot`)
})

check('the audible ladder has one rung per manoeuvre the game can tell apart', () => {
  // `src/audio/` must not import the run's rules, so the rung count is a constant there and this is
  // what stops the two drifting: a sixth manoeuvre with no sound to put it on would ship silent.
  assert.equal(NEAR_MISS_TIERS, TIER_COUNT, 'the ladder and the scoring disagree about how many rungs there are')
})

console.log('the music loop')

check('⚠ the music file ships WITH a registry row, which is the rule it once failed', () => {
  // The rule is CC0 or self-generated, and a track that satisfies neither is one of the commonest
  // reasons a Playables submission is rejected. This file was pulled once for exactly that — no
  // source, no licence — and is back because the missing fact arrived: it is a Stable Audio
  // render, i.e. self-generated. **What is asserted is the row, not the sound**: nothing else in
  // the build reads `AUDIO-SOURCES.md`, so a file that quietly reappears with no provenance is a
  // file nobody would notice until a reviewer did.
  const file = 'public/assets/audio/music.mp3'

  assert.ok(existsSync(file), `${file} is missing — the front screen would throw on an empty cache`)
  const bytes = statSync(file).size
  const registry = readFileSync('AUDIO-SOURCES.md', 'utf8')

  assert.ok(registry.includes('audio/music.mp3'), 'the music file has no row in AUDIO-SOURCES.md')
  assert.ok(
    /Stable Audio/i.test(registry) && /self-generated/i.test(registry),
    'the music row does not state what generated it',
  )
  // It is one file against an 8MB build ceiling that this same track once broke on its own, so the
  // size is held here rather than left to `check-bundle.mjs` to report as a total nobody can
  // attribute. A quarter of the ceiling is the most a single bed is worth.
  assert.ok(bytes < 2 * 1024 * 1024, `music.mp3 is ${(bytes / 1024 / 1024).toFixed(2)}MB, a quarter of the whole build`)
  // Not in either SFX list, because it is neither an effect nor a one-shot — `audio.ts` retains a
  // single instance of it and mutes it in place.
  assert.ok(!Object.values(SFX).includes(MUSIC_KEY), 'the music key is declared as an effect')
  for (const path of Object.values(SFX_FILES)) {
    assert.ok(!path.includes('music'), `${path} ships music as an effect`)
  }
  console.log(`    ${MUSIC_KEY}: ${(bytes / 1024 / 1024).toFixed(2)}MB shipped, Stable Audio render`)
})

check('⚠ the track is off the loading screen, and the rendered loop is still its fallback', () => {
  // **The mp3 is 1.85MB — 31% of the wire — and it was on the blocking path.** Nothing on the front
  // screen needs it, so `MainMenu` asks for it once it is up. What must not happen is asking for it
  // before it is there: `playMusic` calls `soundManager.add(key)`, which throws on a key the cache
  // does not hold, and that takes the front screen with it rather than merely silencing it — which
  // is why the rendered loop is kept as the fallback rather than deleted with the loader step.
  const src = readFileSync('src/audio/musicFile.ts', 'utf8')
  const preloader = readFileSync('src/scenes/Preloader.ts', 'utf8')

  // **⚠ The path is spelled out from the root, not relative.** A loader's base path is the scene's:
  // `Preloader` sets `assets` and `MainMenu` does not, so a relative path 404s and the fallback
  // fires -- measured live, the game came up on the rendered loop with nothing to say so.
  assert.ok(src.includes("MUSIC_PATH = 'assets/audio/music.mp3'"), 'the file is not what is loaded')
  assert.ok(existsSync('public/assets/audio/music.mp3'), 'the path the loader asks for is not on disk')
  assert.ok(src.includes('renderMusicUri()'), 'the rendered loop has no caller — it is dead state')
  assert.ok(src.includes('Phaser.Scenes.Events.SHUTDOWN'), 'a scene torn down mid-request never retries')
  assert.ok(!preloader.includes('audio/music.mp3'), 'the mp3 is still on the blocking path')
  console.log(`    deferred to MainMenu; fallback ${(MUSIC_LENGTH_MS / 1000).toFixed(2)}s of ${MUSIC.bars} bars at ${MUSIC.bpm}bpm`)
})

check('⚠ the loop joins to itself without a click, which is what the wrap is for', () => {
  // A track rendered by truncation ends on whatever the last note was doing, so the join back to
  // the start is a step — and a step in a waveform is a click, once per loop, forever. `renderTrack`
  // folds an overrunning tail onto the head instead, so the sound crossing the seam is the same
  // sound on both sides of it.
  const samples = renderMusic()
  const seam = Math.abs(samples[samples.length - 1] - samples[0])
  // Against the loudest step the track takes anywhere inside itself: a seam is only a click if it
  // is bigger than the ordinary motion of the waveform around it.
  let worst = 0

  for (let i = 1; i < samples.length; i++) worst = Math.max(worst, Math.abs(samples[i] - samples[i - 1]))

  assert.ok(seam <= worst, `the seam steps ${seam.toFixed(4)} against a worst interior step of ${worst.toFixed(4)}`)
  console.log(`    seam ${seam.toFixed(5)} against a worst interior step of ${worst.toFixed(4)}`)
})

check('⚠ the mix does not clip, and stays under the loudest one-shot', () => {
  // Clamped rather than normalised (see `renderTrack`), so a mix that ran hot would flatten into
  // distortion silently. And it is a *bed*: the sounds that matter have to cut through it, so its
  // peak is held under the quietest levelled effect rather than merely under 1.
  const samples = renderMusic()
  let peak = 0
  let energy = 0

  for (const v of samples) {
    peak = Math.max(peak, Math.abs(v))
    energy += v * v
  }

  const rms = Math.sqrt(energy / samples.length)

  assert.ok(peak < 1, `the music mix clips at ${peak.toFixed(3)}`)
  assert.ok(peak <= 0.6, `the music peaks at ${peak.toFixed(3)}, which is an effect's loudness rather than a bed's`)
  console.log(`    ${musicNotes().length} notes, peak ${peak.toFixed(3)}, rms ${rms.toFixed(4)}`)
})

check('the loop is deterministic and its bars line up with its own tempo', () => {
  // Byte-identical between two renders, for the reason every other sound here is: "did the audio
  // change?" has to be answerable by comparison.
  const a = renderMusic()
  const b = renderMusic()

  assert.equal(a.length, b.length, 'two renders of the loop are different lengths')
  for (let i = 0; i < a.length; i += 997) assert.equal(a[i], b[i], `the loop is not deterministic at sample ${i}`)

  // The length is bars times beats times the tempo, and nothing may drift from that: a note is
  // scheduled at a multiple of the beat, so a length that was not would put the last bar short.
  const notes = musicNotes()

  for (const note of notes) {
    assert.ok(note.atMs >= 0 && note.atMs < MUSIC_LENGTH_MS, `a note is scheduled at ${note.atMs}ms, outside the loop`)
  }
  // Equal temperament, checked at the one octave everything else is derived from.
  assert.ok(Math.abs(noteHz('A4') - 440) < 1e-9, 'A4 is not 440Hz')
  assert.ok(Math.abs(noteHz('A3') - 220) < 1e-9, 'an octave down is not half the frequency')
  assert.ok(Math.abs(noteHz('C5') / noteHz('C4') - 2) < 1e-9, 'an octave is not a doubling')
  console.log(`    ${notes.length} notes, all inside ${(MUSIC_LENGTH_MS / 1000).toFixed(2)}s, deterministic`)
})

check('⚠ the YouTube mute button is obeyed live, and re-stated once the context can hear it', () => {
  // **The certification requirement this guards is "Game MUST respect the YouTube mute button", and
  // the way it is failed is total silence.** A game that reads `isAudioEnabled()` once at boot and
  // bakes it is silent for the whole session whenever a Playable is opened from a muted feed —
  // which on Android is routine. Nothing here had ever been asserted; this is the contract.
  //
  // Read as source, for `Preloader`'s reason: `audio.ts` imports `phaser` as a value, so none of it
  // is reachable from Node.
  const src = readFileSync('src/audio/audio.ts', 'utf8')

  // 1. The boot value is a starting point, and the change event is what keeps it true.
  assert.ok(/platformAudioEnabled = isAudioEnabled\(\)/.test(src), 'the platform mute is never read at boot')
  assert.ok(
    /AUDIO_ENABLED_CHANGE[\s\S]{0,200}platformAudioEnabled = enabled/.test(src),
    'the platform mute is read once and baked — a session opened from a muted feed stays silent',
  )
  // 2. Both channels consult it on every play rather than at construction.
  assert.ok(/function effectiveSound\(\)[\s\S]{0,200}platformAudioEnabled/.test(src), 'effects do not consult the platform mute')
  assert.ok(/function effectiveMusic\(\)[\s\S]{0,200}platformAudioEnabled/.test(src), 'music does not consult the platform mute')

  // 3. **One place sets the blanket mute, and it reads both platform facts.** `RESUME` used to set
  // it `false` unconditionally, so a pause/resume cycle unmuted the manager whether or not YouTube
  // was muted — a flag saying the opposite of what the platform asked for.
  // Comment lines are stripped first: this file's own prose quotes the shape it rejects, and a
  // check that reads the argument for a rule as an instance of breaking it measures nothing.
  const isComment = (line) => {
    const t = line.trim()

    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
  }
  const lines = src.split(/\r?\n/).filter((line) => !isComment(line))
  const code = lines.join(' ')
  const blanket = lines.map((line) => /soundManager\.mute = (.+)/.exec(line)).filter(Boolean).map((m) => m[1].trim())

  assert.equal(blanket.length, 1, `the blanket mute is set in ${blanket.length} places; one of them will disagree`)
  assert.ok(/platformAudioEnabled/.test(blanket[0]), 'the blanket mute ignores the YouTube mute button')
  assert.ok(/platformPaused/.test(blanket[0]), 'the blanket mute ignores the platform pause')
  // The control: the shipped-before shape, which is what this rejects.
  assert.ok(!/soundManager\.mute = (true|false)/.test(code), 'the blanket mute is set to a literal again')

  // 4. **⚠ And it is re-stated when the context is first able to hear anything.**
  // `WebAudioSoundManager.mute` is an `AudioParam` at both ends — set with `setValueAtTime`, read
  // back as `gain.value` — so on a suspended context (Android, every frame before the first touch)
  // a write does not land and the getter lies. Measured live: after the platform's own `PAUSE`,
  // whose first statement sets it, `game.sound.mute` reads false. `UNLOCKED` is the one moment it
  // can be made true.
  assert.ok(/Phaser\.Sound\.Events\.UNLOCKED/.test(src), 'nothing re-applies audibility when the audio context unlocks')
  assert.ok(
    /Phaser\.Sound\.Events\.UNLOCKED[\s\S]{0,120}applyAudibility\(\)/.test(src),
    'the unlock hook does not re-apply the platform state',
  )

  // 5. **⚠ A track a pause destroyed comes back when it becomes audible, and used to be gone for
  // the session.** Everything else here only *mutes* an instance that already exists, and `RESUME`
  // restarted one only if it was audible at that instant — so YouTube muted, a pause, a resume, and
  // then the player unmuting left nothing to unmute. Measured live before the fix: the manager's
  // sound list stayed empty. One restart path, in the function every entry point goes through.
  const restarts = lines.filter((line) => /playMusic\(currentMusicKey/.test(line))

  assert.equal(restarts.length, 1, `the music is restarted from ${restarts.length} places; one of them will be missed`)
  assert.ok(
    /function applyAudibility\(\)[\s\S]{0,1200}playMusic\(currentMusicKey/.test(src),
    'the one restart is not in applyAudibility, so an entry point that only mutes will lose the track',
  )
  // ...and the two the player drives reach it, or turning music back on after a pause does nothing.
  for (const setter of ['setMusicVolume', 'setMusic']) {
    assert.ok(
      new RegExp(`export function ${setter}\\([\\s\\S]{0,400}applyAudibility\\(\\)`).test(src),
      `${setter} only mutes, so it cannot bring a destroyed track back`,
    )
  }
  console.log(`    one blanket mute (${blanket[0]}), re-stated on UNLOCKED, one path back to a playing track`)
})

console.log(`${passed} checks passed`)
