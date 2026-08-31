#!/usr/bin/env node
// Logic check for src/platform/retry.ts -- the two policies that decide whether the game is shown
// at all and whether a player's save survives a slow platform. Plain assertions, no framework, via
// the register-ts-loader.mjs + ts-extensionless-loader.mjs Node-native-TS setup.
//
// **These are the only rules in the project whose failure mode is invisible on a developer
// machine.** Both exist because the SDK is a script the page does not control the timing of, and
// both were written as a single synchronous read of a global that is normally already there. A test
// is the only place the "not there yet" branch is ever taken.
import assert from 'node:assert/strict'
import {
  LOAD_ATTEMPTS,
  LOAD_BACKOFF,
  loadBackoffMs,
  loadBudgetMs,
  READY_RETRY,
  readyAttempts,
} from '../src/platform/retry.ts'

let passed = 0

function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

console.log('the mandatory ready calls')

check('the retry window outlives a platform that is seconds late', () => {
  // **⚠ `firstFrameReady()` is MUST-CALL: without it the platform never shows the game.** The old
  // code was `getSdk()?.game.firstFrameReady()` — one synchronous read, no second chance — and it
  // logged success whether or not the SDK was there to take it.
  assert.ok(READY_RETRY.windowMs >= 5000, `the ready window is ${READY_RETRY.windowMs}ms`)
  assert.ok(READY_RETRY.intervalMs <= 250, 'the poll is too coarse to catch a brief window')
  assert.ok(readyAttempts() >= 20, `only ${readyAttempts()} attempts across the window`)
  console.log(`    ${readyAttempts()} attempts over ${READY_RETRY.windowMs}ms, every ${READY_RETRY.intervalMs}ms`)
})

check('a working platform pays nothing for the policy existing', () => {
  // The first attempt is synchronous, inside the call itself: on the normal path the SDK is already
  // attached and the retry timer is never started at all.
  assert.equal(readyAttempts({ intervalMs: 100, windowMs: 100 }), 1)
  assert.ok(readyAttempts() > 1, 'a single attempt is the arrangement this replaces')
})

console.log('reading the save')

check('⚠ one attempt is not enough, and the SDK says so itself', () => {
  // The SDK's error table lists `API_UNAVAILABLE` as *retry later*. One attempt turns that
  // transient into "this player has no save", and the next thing the game does is write defaults.
  assert.ok(LOAD_ATTEMPTS >= 3, `LOAD_ATTEMPTS is ${LOAD_ATTEMPTS}`)
})

check('the backoff starts at zero and grows, and is bounded', () => {
  assert.equal(loadBackoffMs(0), 0, 'a working platform waits before its first read')

  let previous = -1

  for (let i = 0; i < LOAD_ATTEMPTS; i++) {
    const wait = loadBackoffMs(i)

    assert.ok(wait >= previous, `the backoff shrinks between attempt ${i - 1} and ${i}`)
    assert.ok(wait <= LOAD_BACKOFF.maxMs, `attempt ${i} waits ${wait}ms, past the ${LOAD_BACKOFF.maxMs}ms cap`)
    previous = wait
  }

  // **Backoff rather than a fixed gap, and the reason is a measurement.** The failure this is for
  // is a platform still starting up, which resolves either in tens of milliseconds or in seconds;
  // a fixed 100ms gap spends every attempt inside the first case and never reaches the second.
  const flat = loadBudgetMs(LOAD_ATTEMPTS, { firstMs: 100, factor: 1, maxMs: 100 })

  assert.ok(
    loadBudgetMs() > flat * 2,
    `the backoff covers ${loadBudgetMs()}ms against a flat policy's ${flat}ms`,
  )
  console.log(
    `    waits ${Array.from({ length: LOAD_ATTEMPTS }, (_, i) => loadBackoffMs(i)).join('/')}ms, ` +
      `${loadBudgetMs()}ms in total against a flat policy's ${flat}ms`,
  )
})

check('the whole read finishes well inside the loading screen', () => {
  // The read runs while the loading screen is up, so its budget has to be a fraction of a load
  // rather than a thing the player waits through on its own.
  assert.ok(loadBudgetMs() <= 5000, `the read can take ${loadBudgetMs()}ms of waiting`)
})

console.log(`${passed} checks passed`)
