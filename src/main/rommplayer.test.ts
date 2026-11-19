import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPlayerPage, isServerRequest, isSignInPage, playerUrl } from './rommplayer.ts'

test("the player page is RomM's own route for the game", () => {
  assert.equal(playerUrl('https://romm.lan', 7, 'browser'), 'https://romm.lan/rom/7/ejs')
  assert.equal(playerUrl('https://romm.lan/', 7, 'stream'), 'https://romm.lan/rom/7/stream')
})

test('only requests to the server carry the sign-in', () => {
  const origin = 'https://romm.lan:8443'
  assert.equal(isServerRequest('https://romm.lan:8443/api/users/me', origin), true)
  // Another port is another origin, and so is the same host over plain HTTP.
  assert.equal(isServerRequest('https://romm.lan/api/users/me', origin), false)
  assert.equal(isServerRequest('http://romm.lan:8443/api/users/me', origin), false)
  assert.equal(isServerRequest('https://cdn.example/core.wasm', origin), false)
  assert.equal(isServerRequest('not a url', origin), false)
})

test("RomM's sign-in page is recognised, under the server's own path too", () => {
  assert.equal(isSignInPage('https://romm.lan/login?next=/rom/7/ejs', 'https://romm.lan'), true)
  assert.equal(isSignInPage('https://romm.lan/romm/login', 'https://romm.lan/romm/'), true)
  assert.equal(isSignInPage('https://romm.lan/rom/7/ejs', 'https://romm.lan'), false)
  // A page merely starting with the word is not it, and neither is another host's.
  assert.equal(isSignInPage('https://romm.lan/loginhelp', 'https://romm.lan'), false)
  assert.equal(isSignInPage('https://other.lan/login', 'https://romm.lan'), false)
})

test('the page has left the player once it is off both player routes', () => {
  assert.equal(isPlayerPage('https://romm.lan/rom/7/ejs'), true)
  assert.equal(isPlayerPage('https://romm.lan/romm/rom/7/stream'), true)
  assert.equal(isPlayerPage('https://romm.lan/rom/7'), false)
  assert.equal(isPlayerPage('https://romm.lan/'), false)
})
