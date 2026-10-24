import fs from 'node:fs'
import path from 'node:path'

export function explicitUpdateFeed(env = process.env) {
  return String(env.VIBENOTE_UPDATE_FEED_URL || '').trim()
}

export function bundledUpdateConfigPath(resourcesPath) {
  if (!resourcesPath) return ''
  return path.join(resourcesPath, 'app-update.yml')
}

export function shouldCheckForUpdates({
  isPackaged = false,
  isHeadless = false,
  resourcesPath = '',
  env = process.env,
} = {}) {
  if (String(env.VIBENOTE_DISABLE_AUTO_UPDATE || '').trim() === '1') return false
  if (!isPackaged || isHeadless) return false
  if (explicitUpdateFeed(env)) return true
  const bundled = bundledUpdateConfigPath(resourcesPath)
  return Boolean(bundled && fs.existsSync(bundled))
}

export async function configureAutoUpdate({
  isPackaged = false,
  isHeadless = false,
  resourcesPath = '',
  env = process.env,
  logger = console,
  updater = null,
} = {}) {
  try {
    if (!shouldCheckForUpdates({ isPackaged, isHeadless, resourcesPath, env })) {
      logger.info?.('Auto-update disabled.')
      return { enabled: false }
    }

    let resolvedUpdater = updater
    if (!resolvedUpdater) {
      const imported = await import('electron-updater')
      resolvedUpdater = imported.autoUpdater || imported.default?.autoUpdater
    }
    if (!resolvedUpdater) {
      logger.error?.('Auto-update failed: electron-updater is unavailable.')
      return { enabled: false }
    }

    const feed = explicitUpdateFeed(env)
    resolvedUpdater.autoDownload = true
    resolvedUpdater.autoInstallOnAppQuit = true
    resolvedUpdater.logger = logger
    if (feed) {
      resolvedUpdater.setFeedURL({ provider: 'generic', url: feed })
    }
    resolvedUpdater.on?.('error', error => {
      logger.error?.(`Auto-update error: ${error instanceof Error ? error.message : error}`)
    })

    try {
      if (typeof resolvedUpdater.checkForUpdatesAndNotify === 'function') {
        await resolvedUpdater.checkForUpdatesAndNotify()
      } else {
        await resolvedUpdater.checkForUpdates()
      }
    } catch (error) {
      logger.error?.(`Auto-update check failed: ${error instanceof Error ? error.message : error}`)
    }
    return { enabled: true }
  } catch (error) {
    logger.error?.(`Auto-update failed: ${error instanceof Error ? error.message : error}`)
    return { enabled: false }
  }
}
