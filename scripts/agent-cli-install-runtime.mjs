import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PackagedAppHarness, noteContent } from './lib/packaged-app-harness.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseArch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appBundlePath = path.join(root, 'dist', `mac-${releaseArch}`, `${packageJson.build.productName}.app`)
let harness

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`ok - ${message}`)
}

function runCli(binDirectory, args) {
  return spawnSync('vibenote', args, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDirectory}${path.delimiter}${process.env.PATH || ''}` },
  })
}

try {
  check(fs.existsSync(appBundlePath), `packaged app exists at ${appBundlePath}`)
  harness = new PackagedAppHarness({
    appBundlePath,
    initialContent: noteContent([{ language: 'markdown', auto: true, content: 'Agent CLI install verification' }]),
  })
  const binDirectory = path.join(harness.tempPath, 'bin')
  harness.environment = {
    VIBENOTE_AGENT_CLI_BIN_DIR: binDirectory,
    PATH: `${binDirectory}${path.delimiter}${process.env.PATH || ''}`,
  }
  const page = await harness.launch()
  await page.getByTitle('设置').click()
  const section = page.locator('.settings-section', { has: page.getByRole('heading', { name: 'Agent CLI' }) })
  await section.getByRole('button', { name: '安装 Agent CLI' }).click()
  await section.getByText(`已安装 · v${packageJson.version}`).waitFor()

  const version = runCli(binDirectory, ['version', '--output', 'json'])
  check(version.status === 0, 'installed command runs from a fresh PATH')
  check(JSON.parse(version.stdout).data.version === packageJson.version, 'installed command reports the packaged app version')
  const capabilities = runCli(binDirectory, ['capabilities', '--output', 'json'])
  check(capabilities.status === 0, 'installed command exposes Agent CLI capabilities')
  check(JSON.parse(capabilities.stdout).data.commands.includes('blocks.append'), 'installed command exposes safe append capability')

  await section.getByRole('button', { name: '卸载' }).click()
  await section.getByText('尚未安装').waitFor()
  check(!fs.existsSync(path.join(binDirectory, 'vibenote')), 'uninstall removes only the managed command')
  console.log('Agent CLI packaged install verification completed.')
} finally {
  await harness?.cleanup({ force: true })
}

process.exit(0)
