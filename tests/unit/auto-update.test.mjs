import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { configureAutoUpdate, shouldCheckForUpdates } from '../../electron/autoUpdate.js'

test('auto-update stays off for local, headless, and unconfigured builds', () => {
  assert.equal(shouldCheckForUpdates({
    isPackaged: true,
    resourcesPath: '/tmp/missing-resources',
    env: {},
  }), false)
  assert.equal(shouldCheckForUpdates({
    isPackaged: false,
    env: { VIBENOTE_UPDATE_FEED_URL: 'https://example.com/feed' },
  }), false)
  assert.equal(shouldCheckForUpdates({
    isPackaged: true,
    isHeadless: true,
    env: { VIBENOTE_UPDATE_FEED_URL: 'https://example.com/feed' },
  }), false)
  assert.equal(shouldCheckForUpdates({
    isPackaged: true,
    env: {
      VIBENOTE_UPDATE_FEED_URL: 'https://example.com/feed',
      VIBENOTE_DISABLE_AUTO_UPDATE: '1',
    },
  }), false)
})

test('auto-update can use a bundled feed or a runtime override', () => {
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-update-'))
  fs.writeFileSync(path.join(resources, 'app-update.yml'), 'provider: generic\nurl: https://example.com/feed\n')
  try {
    assert.equal(shouldCheckForUpdates({
      isPackaged: true,
      resourcesPath: resources,
      env: {},
    }), true)
  } finally {
    fs.rmSync(resources, { recursive: true, force: true })
  }
})

test('configureAutoUpdate does not load the updater when disabled', async () => {
  const result = await configureAutoUpdate({
    isPackaged: false,
    env: { VIBENOTE_UPDATE_FEED_URL: 'https://example.com/feed' },
    logger: { info() {}, error() {} },
  })
  assert.deepEqual(result, { enabled: false })
})

test('configureAutoUpdate checks a generic feed and keeps update failures contained', async () => {
  const calls = []
  const updater = {
    on(event, handler) {
      calls.push(['on', event])
      handler(new Error('offline'))
    },
    setFeedURL(feed) {
      calls.push(['feed', feed])
    },
    async checkForUpdatesAndNotify() {
      calls.push(['check'])
      throw new Error('feed unavailable')
    },
  }
  const errors = []
  const result = await configureAutoUpdate({
    isPackaged: true,
    resourcesPath: '/tmp/does-not-matter',
    env: { VIBENOTE_UPDATE_FEED_URL: 'https://example.com/feed' },
    logger: {
      info() {},
      error(message) { errors.push(message) },
    },
    updater,
  })

  assert.equal(result.enabled, true)
  assert.equal(updater.autoDownload, true)
  assert.equal(updater.autoInstallOnAppQuit, true)
  assert.deepEqual(calls[0], ['feed', { provider: 'generic', url: 'https://example.com/feed' }])
  assert.deepEqual(calls[2], ['check'])
  assert.match(errors.join('\n'), /feed unavailable/)
  assert.match(errors.join('\n'), /offline/)
})
