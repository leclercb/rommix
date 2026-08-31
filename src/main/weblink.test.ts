import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isWebAddress } from './weblink.ts'

/**
 * What RomMix will hand to the desktop to open.
 *
 * The interface only ever passes RomMix's own constants here, so the failure
 * this guards against is not a link the user followed — it is a renderer that
 * has been made to ask for something else, and a desktop that would oblige it.
 */

test('the two schemes the web is served over are opened', () => {
  assert.equal(isWebAddress('https://github.com/leclercb/rommix/releases'), true)
  // A RomM server on the local network is plain http far more often than not.
  assert.equal(isWebAddress('http://192.168.1.10:8080'), true)
  // A scheme is case-insensitive, and a check that is not can be walked past.
  assert.equal(isWebAddress('HTTPS://romm.app'), true)
})

test('anything else a desktop has a handler for is refused', () => {
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'smb://server/share',
    'steam://run/123',
    'mailto:someone@example.com',
    ''
  ]) {
    assert.equal(isWebAddress(url), false, `${url} is not a web address`)
  }
})

test('the scheme has to be at the front, not merely somewhere in the string', () => {
  assert.equal(isWebAddress('file:///tmp/x#https://romm.app'), false)
  assert.equal(isWebAddress(' https://romm.app'), false)
})
