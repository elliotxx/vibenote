import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { afterPack } from '../../scripts/after-pack-update.mjs'
import {
  checksumArtifactNames,
  createMacPackagingPlan,
  describeMacPackagingPlan,
  electronBuilderArgs,
  electronBuilderEnv,
  githubReleaseFeedUrl,
  notarizeRequest,
  releaseArtifactNames,
  releaseAssetPaths,
  renderAppUpdateYml,
  renderLatestMacYml,
  renderReleaseNotes,
} from '../../scripts/mac-packaging.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const appleIdEnv = {
  VIBENOTE_MAC_SIGN: '1',
  CSC_LINK: 'developer-id.p12',
  CSC_KEY_PASSWORD: 'p12-password',
  APPLE_ID: 'dev@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-password',
  APPLE_TEAM_ID: 'TEAMID1234',
}

test('unsigned packaging keeps the custom DMG path and disables discovery', () => {
  const plan = createMacPackagingPlan({
    CSC_LINK: 'developer-id.p12',
    CSC_KEY_PASSWORD: 'p12-password',
    VIBENOTE_MAC_SIGN: '0',
    VIBENOTE_UPDATE_FEED_URL: 'disabled',
    VIBENOTE_MAC_RELEASE_FEED_DEFAULT: 'github',
  }, {
    defaultGithubFeed: 'https://github.com/elliotxx/vibenote/releases/latest/download',
  })

  assert.equal(plan.sign, false)
  assert.equal(plan.notarize, false)
  assert.equal(plan.customDmg, true)
  assert.deepEqual(plan.targets, ['dir'])
  assert.deepEqual(electronBuilderArgs(plan), [
    '--mac',
    'dir',
    '--arm64',
    '--publish',
    'never',
    '-c.mac.notarize=false',
  ])

  const env = electronBuilderEnv(plan, {
    CSC_LINK: 'developer-id.p12',
    CSC_KEY_PASSWORD: 'p12-password',
    CSC_NAME: 'Vibenote',
    VIBENOTE_RESOLVED_UPDATE_FEED: 'https://example.com/feed',
  })
  assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, 'false')
  assert.equal(env.CSC_LINK, undefined)
  assert.equal(env.CSC_KEY_PASSWORD, undefined)
  assert.equal(env.CSC_NAME, undefined)
  assert.equal(env.VIBENOTE_RESOLVED_UPDATE_FEED, undefined)
})

test('signed packaging notarizes, uses electron-builder archives, and can default to GitHub Releases', () => {
  const plan = createMacPackagingPlan({
    ...appleIdEnv,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    VIBENOTE_MAC_RELEASE_FEED_DEFAULT: 'github',
  }, {
    defaultGithubFeed: githubReleaseFeedUrl('git+https://github.com/elliotxx/vibenote.git'),
  })

  assert.equal(plan.sign, true)
  assert.equal(plan.notarize, true)
  assert.equal(plan.notary, 'apple-id')
  assert.equal(plan.customDmg, false)
  assert.equal(plan.identitySource, 'csc-link')
  assert.equal(plan.feedUrl, 'https://github.com/elliotxx/vibenote/releases/latest/download')
  assert.deepEqual(describeMacPackagingPlan(plan), {
    arch: 'arm64',
    sign: true,
    notarize: true,
    notary: 'apple-id',
    targets: ['dmg', 'zip'],
    customDmg: false,
    identitySource: 'csc-link',
    updateFeed: true,
  })
  assert.equal(JSON.stringify(describeMacPackagingPlan(plan)).includes('p12-password'), false)

  const args = electronBuilderArgs(plan, { electronDist: true })
  assert.ok(args.includes('dmg'))
  assert.ok(args.includes('zip'))
  assert.ok(args.includes('-c.mac.forceCodeSigning=true'))
  assert.equal(args.includes('-c.mac.notarize=false'), false)
  assert.ok(args.includes('-c.publish.url=https://github.com/elliotxx/vibenote/releases/latest/download'))
  assert.ok(args.includes('-c.electronDist=.electron-dist'))

  const env = electronBuilderEnv(plan, { CSC_IDENTITY_AUTO_DISCOVERY: 'false', CSC_LINK: 'developer-id.p12' })
  assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, undefined)
  assert.equal(env.CSC_LINK, 'developer-id.p12')
  assert.equal(env.VIBENOTE_RESOLVED_UPDATE_FEED, plan.feedUrl)
})

test('signing credentials are required and are not echoed in errors', () => {
  assert.throws(
    () => createMacPackagingPlan({ VIBENOTE_MAC_SIGN: '1', CSC_LINK: 'developer-id.p12' }),
    error => {
      assert.match(error.message, /CSC_KEY_PASSWORD/)
      assert.equal(error.message.includes('developer-id.p12'), false)
      return true
    },
  )
  assert.throws(
    () => createMacPackagingPlan({
      ...appleIdEnv,
      APPLE_TEAM_ID: '',
      APPLE_APP_SPECIFIC_PASSWORD: 'super-secret-password',
    }),
    error => {
      assert.match(error.message, /APPLE_TEAM_ID/)
      assert.equal(error.message.includes('super-secret-password'), false)
      return true
    },
  )
  assert.throws(
    () => createMacPackagingPlan({ VIBENOTE_UPDATE_FEED_URL: 'https://example.com/feed' }),
    /signed build/,
  )
  assert.throws(
    () => createMacPackagingPlan({ ...appleIdEnv, VIBENOTE_UPDATE_FEED_URL: 'http://example.com/feed' }),
    /https/,
  )
  const credentialUrl = ['https://', 'user', ':', 'password', '@example.com/feed'].join('')
  assert.throws(
    () => createMacPackagingPlan({ ...appleIdEnv, VIBENOTE_UPDATE_FEED_URL: credentialUrl }),
    /credentials/,
  )
})

test('a Developer ID in the environment turns the tag build into a signed release', () => {
  const plan = createMacPackagingPlan({
    CSC_LINK: 'developer-id.p12',
    CSC_KEY_PASSWORD: 'p12-password',
    APPLE_KEYCHAIN_PROFILE: 'vibenote-notary',
  })
  assert.equal(plan.sign, true)
  assert.equal(plan.notarize, true)
  assert.equal(plan.notary, 'keychain')
  assert.equal(plan.customDmg, false)
})

test('API key and keychain notarization are accepted, and signature experiments can skip notarization', () => {
  const apiPlan = createMacPackagingPlan({
    VIBENOTE_MAC_SIGN: '1',
    CSC_NAME: 'Vibenote Developer',
    APPLE_API_KEY: '/tmp/AuthKey.p8',
    APPLE_API_KEY_ID: 'KEYID12345',
    APPLE_API_ISSUER: 'issuer-id',
    VIBENOTE_UPDATE_FEED_URL: 'disabled',
    VIBENOTE_MAC_RELEASE_FEED_DEFAULT: 'github',
  }, {
    defaultGithubFeed: 'https://github.com/elliotxx/vibenote/releases/latest/download',
  })
  assert.equal(apiPlan.notary, 'api-key')
  assert.equal(apiPlan.feedUrl, '')
  assert.equal(apiPlan.identitySource, 'csc-name')
  assert.deepEqual(notarizeRequest('/tmp/Vibenote.dmg', {
    APPLE_API_KEY: '/tmp/AuthKey.p8',
    APPLE_API_KEY_ID: 'KEYID12345',
    APPLE_API_ISSUER: 'issuer-id',
  }), {
    appPath: '/tmp/Vibenote.dmg',
    appleApiKey: '/tmp/AuthKey.p8',
    appleApiKeyId: 'KEYID12345',
    appleApiIssuer: 'issuer-id',
  })

  const experiment = createMacPackagingPlan({
    VIBENOTE_MAC_SIGN: '1',
    CSC_LINK: 'developer-id.p12',
    CSC_KEY_PASSWORD: 'p12-password',
    VIBENOTE_MAC_NOTARIZE: '0',
  })
  assert.equal(experiment.sign, true)
  assert.equal(experiment.notarize, false)
  assert.equal(experiment.notary, null)
})

test('update metadata and release notes follow the packaging mode', () => {
  const names = releaseArtifactNames({ version: '0.1.21', arch: 'arm64' })
  assert.deepEqual(checksumArtifactNames(names, {
    signed: false,
    updateFeed: false,
    exists: () => false,
  }), ['Vibenote-0.1.21-arm64.dmg'])
  assert.deepEqual(checksumArtifactNames(names, {
    signed: true,
    updateFeed: true,
    exists: () => false,
  }), [
    'Vibenote-0.1.21-arm64.dmg',
    'Vibenote-0.1.21-arm64.zip',
    'Vibenote-0.1.21-arm64.zip.blockmap',
    'latest-mac.yml',
  ])

  const manifest = renderLatestMacYml({
    version: '0.1.21',
    zipName: names.zipName,
    sha512: 'abc+def/ghi=',
    size: 42,
    releaseDate: '2026-10-24T00:00:00.000Z',
  })
  assert.match(manifest, /sha512: 'abc\+def\/ghi='/)
  assert.match(renderAppUpdateYml('https://example.com/feed/'), /^provider: generic\nurl: https:\/\/example\.com\/feed\n/)

  const unsignedNotes = renderReleaseNotes({ version: '0.1.21', mode: { signed: false } })
  assert.match(unsignedNotes, /unsigned/)
  assert.doesNotMatch(unsignedNotes, /notarized macOS/)
  const signedNotes = renderReleaseNotes({
    version: '0.1.21',
    tag: 'v0.1.21',
    mode: { signed: true, notarized: true, updateFeed: true },
  })
  assert.match(signedNotes, /signed and notarized/)
  assert.match(signedNotes, /latest-mac\.yml/)
  assert.doesNotMatch(signedNotes, /right-click/)

  const assets = releaseAssetPaths('/work', names, {
    exists: name => name.endsWith('.zip'),
  })
  assert.deepEqual(assets, [
    path.join('/work', 'dist', names.dmgName),
    path.join('/work', 'dist', names.sumsName),
    path.join('/work', 'dist', names.zipName),
  ])
})

test('afterPack writes the generic feed before signing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-after-pack-'))
  const previous = process.env.VIBENOTE_RESOLVED_UPDATE_FEED
  process.env.VIBENOTE_RESOLVED_UPDATE_FEED = 'https://example.com/updates'
  try {
    await afterPack({
      appOutDir: directory,
      packager: { appInfo: { productFilename: 'Vibenote' } },
    })
    const written = fs.readFileSync(path.join(directory, 'Vibenote.app', 'Contents', 'Resources', 'app-update.yml'), 'utf8')
    assert.match(written, /url: https:\/\/example\.com\/updates\n/)
  } finally {
    if (previous === undefined) delete process.env.VIBENOTE_RESOLVED_UPDATE_FEED
    else process.env.VIBENOTE_RESOLVED_UPDATE_FEED = previous
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('packaging plan command redacts secrets', () => {
  const unsigned = spawnSync(process.execPath, ['scripts/build-mac.mjs', '--plan'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(unsigned.status, 0, unsigned.stderr)
  assert.equal(JSON.parse(unsigned.stdout).sign, false)

  const signed = spawnSync(process.execPath, ['scripts/build-mac.mjs', '--plan', '--signed'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CSC_LINK: 'developer-id.p12',
      APPLE_APP_SPECIFIC_PASSWORD: 'super-secret-password',
    },
  })
  assert.notEqual(signed.status, 0)
  assert.match(signed.stderr, /CSC_KEY_PASSWORD/)
  assert.equal(signed.stderr.includes('super-secret-password'), false)
  assert.equal(signed.stdout.includes('super-secret-password'), false)
})
