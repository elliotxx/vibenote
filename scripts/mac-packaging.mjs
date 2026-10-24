import fs from 'node:fs'
import path from 'node:path'

export class MacPackagingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MacPackagingError'
  }
}

export const GITHUB_FEED_DEFAULT = 'github'
const FEED_DISABLED = new Set(['0', 'disabled', 'false', 'off'])

function present(value) {
  return Boolean(String(value || '').trim())
}

export function githubReleaseFeedUrl(repositoryUrl = '') {
  const cleaned = String(repositoryUrl).trim().replace(/^git\+/, '')
  let parsed
  try {
    parsed = new URL(cleaned)
  } catch {
    return ''
  }
  if (parsed.hostname !== 'github.com') return ''
  const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
  if (!owner || !repo) return ''
  return `https://github.com/${owner}/${repo.replace(/\.git$/, '')}/releases/latest/download`
}

export function validateUpdateFeedUrl(value) {
  const raw = String(value || '').trim()
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new MacPackagingError('VIBENOTE_UPDATE_FEED_URL must be an https URL.')
  }
  if (parsed.protocol !== 'https:') {
    throw new MacPackagingError('VIBENOTE_UPDATE_FEED_URL must use https.')
  }
  if (parsed.username || parsed.password) {
    throw new MacPackagingError('VIBENOTE_UPDATE_FEED_URL must not include credentials.')
  }
  parsed.hash = ''
  const href = parsed.toString()
  return href.endsWith('/') ? href.slice(0, -1) : href
}

export function signingRequested(env, { signedFlag = false } = {}) {
  if (signedFlag || String(env.VIBENOTE_MAC_SIGN || '').trim() === '1') return true
  if (String(env.VIBENOTE_MAC_SIGN || '').trim() === '0') return false
  return present(env.CSC_LINK) || present(env.CSC_NAME)
}

export function notaryCredentialKind(env) {
  const appleId = present(env.APPLE_ID)
  const applePassword = present(env.APPLE_APP_SPECIFIC_PASSWORD)
  const teamId = present(env.APPLE_TEAM_ID)
  if (appleId || applePassword || teamId) {
    if (!(appleId && applePassword && teamId)) {
      throw new MacPackagingError('Apple ID notarization requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID.')
    }
    return 'apple-id'
  }

  const apiKey = present(env.APPLE_API_KEY)
  const apiKeyId = present(env.APPLE_API_KEY_ID)
  const apiIssuer = present(env.APPLE_API_ISSUER)
  if (apiKey || apiKeyId || apiIssuer) {
    if (!(apiKey && apiKeyId && apiIssuer)) {
      throw new MacPackagingError('App Store Connect API notarization requires APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER.')
    }
    return 'api-key'
  }

  if (present(env.APPLE_KEYCHAIN_PROFILE)) return 'keychain'
  return null
}

export function notarizeRequest(filePath, env) {
  const kind = notaryCredentialKind(env)
  if (kind === 'apple-id') {
    return {
      appPath: filePath,
      appleId: env.APPLE_ID.trim(),
      appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD.trim(),
      teamId: env.APPLE_TEAM_ID.trim(),
    }
  }
  if (kind === 'api-key') {
    return {
      appPath: filePath,
      appleApiKey: env.APPLE_API_KEY.trim(),
      appleApiKeyId: env.APPLE_API_KEY_ID.trim(),
      appleApiIssuer: env.APPLE_API_ISSUER.trim(),
    }
  }
  if (kind === 'keychain') {
    const request = {
      appPath: filePath,
      keychainProfile: env.APPLE_KEYCHAIN_PROFILE.trim(),
    }
    if (present(env.APPLE_KEYCHAIN)) request.keychain = env.APPLE_KEYCHAIN.trim()
    return request
  }
  return null
}

function resolveFeedUrl(env, { sign, defaultGithubFeed }) {
  const raw = String(env.VIBENOTE_UPDATE_FEED_URL || '').trim()
  if (FEED_DISABLED.has(raw.toLowerCase())) return ''
  if (raw) return validateUpdateFeedUrl(raw)
  if (sign && String(env.VIBENOTE_MAC_RELEASE_FEED_DEFAULT || '').trim() === GITHUB_FEED_DEFAULT) {
    if (!defaultGithubFeed) {
      throw new MacPackagingError('Could not derive the GitHub Releases update feed from package.json repository.')
    }
    return defaultGithubFeed
  }
  return ''
}

export function createMacPackagingPlan(env, { signedFlag = false, defaultGithubFeed = '' } = {}) {
  const sign = signingRequested(env, { signedFlag })
  const arch = String(env.VIBENOTE_RELEASE_ARCH || 'arm64').trim() || 'arm64'
  if (sign && present(env.CSC_LINK) && !present(env.CSC_KEY_PASSWORD)) {
    throw new MacPackagingError('CSC_LINK is set but CSC_KEY_PASSWORD is missing.')
  }

  const notarizeDisabled = String(env.VIBENOTE_MAC_NOTARIZE || '').trim() === '0'
  let notary = null
  if (sign && !notarizeDisabled) {
    notary = notaryCredentialKind(env)
    if (!notary) {
      throw new MacPackagingError('Signed macOS releases notarize by default. Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID, or APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER, or APPLE_KEYCHAIN_PROFILE. Set VIBENOTE_MAC_NOTARIZE=0 only for a local signature experiment.')
    }
  } else if (sign && notarizeDisabled) {
    const partial = [env.APPLE_ID, env.APPLE_APP_SPECIFIC_PASSWORD, env.APPLE_TEAM_ID, env.APPLE_API_KEY, env.APPLE_API_KEY_ID, env.APPLE_API_ISSUER]
    if (partial.some(present)) notaryCredentialKind(env)
  }

  const feedUrl = resolveFeedUrl(env, { sign, defaultGithubFeed })
  if (feedUrl && !sign) {
    throw new MacPackagingError('An update feed requires a signed build. Unsigned local builds leave auto-update disabled.')
  }

  if (!sign) {
    return {
      arch,
      sign: false,
      notarize: false,
      notary: null,
      targets: ['dir'],
      customDmg: true,
      feedUrl: '',
      identitySource: 'unsigned',
    }
  }

  let identitySource = 'keychain'
  if (present(env.CSC_LINK)) identitySource = 'csc-link'
  else if (present(env.CSC_NAME)) identitySource = 'csc-name'

  return {
    arch,
    sign: true,
    notarize: !notarizeDisabled,
    notary: notarizeDisabled ? null : notary,
    targets: ['dmg', 'zip'],
    customDmg: false,
    feedUrl,
    identitySource,
  }
}

export function electronBuilderArgs(plan, { electronDist = false } = {}) {
  const args = ['--mac', ...plan.targets, `--${plan.arch}`, '--publish', 'never']
  if (plan.sign) args.push('-c.mac.forceCodeSigning=true')
  if (!plan.notarize) args.push('-c.mac.notarize=false')
  if (plan.feedUrl) {
    args.push('-c.publish.provider=generic', `-c.publish.url=${plan.feedUrl}`)
  }
  if (electronDist) args.push('-c.electronDist=.electron-dist')
  return args
}

export function electronBuilderEnv(plan, baseEnv) {
  const env = { ...baseEnv }
  if (!plan.sign) {
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    delete env.CSC_LINK
    delete env.CSC_KEY_PASSWORD
    delete env.CSC_NAME
    delete env.VIBENOTE_RESOLVED_UPDATE_FEED
    return env
  }

  delete env.CSC_IDENTITY_AUTO_DISCOVERY
  if (plan.feedUrl) env.VIBENOTE_RESOLVED_UPDATE_FEED = plan.feedUrl
  else delete env.VIBENOTE_RESOLVED_UPDATE_FEED
  return env
}

export function describeMacPackagingPlan(plan) {
  return {
    arch: plan.arch,
    sign: plan.sign,
    notarize: plan.notarize,
    notary: plan.notary,
    targets: plan.targets,
    customDmg: plan.customDmg,
    identitySource: plan.identitySource,
    updateFeed: Boolean(plan.feedUrl),
  }
}

export function releaseArtifactNames({ productName = 'Vibenote', version, arch = 'arm64' }) {
  const base = `${productName}-${version}-${arch}`
  return {
    dmgName: `${base}.dmg`,
    zipName: `${base}.zip`,
    blockmapName: `${base}.zip.blockmap`,
    updateInfoName: 'latest-mac.yml',
    sumsName: 'SHA256SUMS',
  }
}

export function releaseModePath(root) {
  return path.join(root, 'dist', 'release-mode.json')
}

export function writeReleaseMode(root, mode) {
  const filePath = releaseModePath(root)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify({
    signed: mode.signed === true,
    notarized: mode.notarized === true,
    updateFeed: mode.updateFeed === true,
    customDmg: mode.customDmg !== false,
    arch: mode.arch || 'arm64',
  }, null, 2)}\n`)
  return filePath
}

export function readReleaseMode(root) {
  const filePath = releaseModePath(root)
  if (!fs.existsSync(filePath)) return null
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return {
    signed: parsed.signed === true,
    notarized: parsed.notarized === true,
    updateFeed: parsed.updateFeed === true,
    customDmg: parsed.customDmg !== false,
    arch: parsed.arch || 'arm64',
  }
}

export function renderAppUpdateYml(feedUrl) {
  const url = validateUpdateFeedUrl(feedUrl)
  return `provider: generic\nurl: ${url}\nupdaterCacheDirName: vibenote-updater\n`
}

export function renderLatestMacYml({ version, zipName, sha512, size, releaseDate }) {
  const quotedHash = `'${String(sha512).replaceAll("'", "''")}'`
  const quotedDate = `'${String(releaseDate).replaceAll("'", "''")}'`
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${zipName}`,
    `    sha512: ${quotedHash}`,
    `    size: ${size}`,
    `path: ${zipName}`,
    `sha512: ${quotedHash}`,
    `releaseDate: ${quotedDate}`,
    '',
  ].join('\n')
}

export function checksumArtifactNames(names, { signed, updateFeed, exists }) {
  const selected = [names.dmgName]
  if (signed || exists(names.zipName)) selected.push(names.zipName)
  if (signed || exists(names.blockmapName)) selected.push(names.blockmapName)
  if (updateFeed || exists(names.updateInfoName)) selected.push(names.updateInfoName)
  return [...new Set(selected)]
}

export function releaseAssetPaths(root, names, { exists }) {
  const assets = [names.dmgName, names.sumsName]
  for (const name of [names.zipName, names.blockmapName, names.updateInfoName]) {
    if (exists(name)) assets.push(name)
  }
  return assets.map(name => path.join(root, 'dist', name))
}

export function renderReleaseNotes({ version, tag, mode }) {
  const releaseTag = tag || `v${version}`
  const verify = [
    '### Verify',
    '',
    'Download `SHA256SUMS`, then run:',
    '',
    '```sh',
    'cd <download-folder>',
    'shasum -a 256 -c SHA256SUMS',
    '```',
    '',
    '### Scope',
    '',
    '- macOS arm64 only.',
    '- One persistent note stream.',
    '- Block-based plain text capture.',
    '- Autosave and quit-time save.',
    '- Local app data under `$HOME/Library/Application Support/Vibenote`.',
    '- No Heynote data migration or access.',
    '',
  ]

  if (!mode?.signed) {
    return [
      `## Vibenote ${releaseTag}`,
      '',
      'This is an unsigned macOS Apple Silicon release.',
      '',
      '### Install',
      '',
      `1. Download \`Vibenote-${version}-arm64.dmg\`.`,
      '2. Open the DMG and drag `Vibenote.app` to Applications.',
      '3. On first launch, macOS may block the app because it is unsigned.',
      '4. Open the Applications folder in Finder, right-click `Vibenote.app`, choose `Open`, then confirm the warning.',
      '5. If it is still blocked, open System Settings, Privacy & Security, and allow Vibenote from the security warning.',
      '',
      'Only install this build if you trust the source.',
      '',
      ...verify,
      '### Known Limits',
      '',
      '- Unsigned and not notarized.',
      '- macOS Gatekeeper warning on first launch.',
      '- No auto-update channel.',
      '',
    ].join('\n')
  }

  const updateLines = mode.updateFeed
    ? [
      '- A signed update archive (`.zip` and `.zip.blockmap`) and `latest-mac.yml` are attached.',
      '- The app checks that feed in the background and applies a downloaded update on quit.',
      '- No update UI was added.',
    ]
    : ['- Auto-update is disabled for this build because no update feed was configured.']

  const gatekeeper = mode.notarized
    ? '3. Launch Vibenote. This build is signed and notarized.'
    : '3. This build is signed but was not notarized. Gatekeeper may still warn until notarization is stapled.'

  return [
    `## Vibenote ${releaseTag}`,
    '',
    mode.notarized
      ? 'This is a signed and notarized macOS Apple Silicon release.'
      : 'This is a signed macOS Apple Silicon release without notarization.',
    '',
    '### Install',
    '',
    `1. Download \`Vibenote-${version}-arm64.dmg\`.`,
    '2. Open the DMG and drag `Vibenote.app` to Applications.',
    gatekeeper,
    '',
    ...verify,
    '### Updates',
    '',
    ...updateLines,
    '',
    '### Known Limits',
    '',
    '- macOS arm64 only.',
    ...(mode.notarized ? [] : ['- Not notarized.']),
    ...(mode.updateFeed ? [] : ['- No auto-update channel.']),
    '',
  ].join('\n')
}
