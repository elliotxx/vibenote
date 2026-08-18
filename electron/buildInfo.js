import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function parseGitDescribe(appVersion, gitDescribe) {
  const dirty = gitDescribe.endsWith('-dirty')
  const cleanDescribe = dirty ? gitDescribe.slice(0, -'-dirty'.length) : gitDescribe
  const tagged = /^(.*)-(\d+)-g([0-9a-f]+)$/i.exec(cleanDescribe)
  if (tagged) {
    return {
      appVersion,
      gitDescribe,
      tag: tagged[1],
      commitDistance: Number(tagged[2]),
      commit: tagged[3],
      dirty,
    }
  }

  const untagged = /^([0-9a-f]+)$/i.exec(cleanDescribe)
  return {
    appVersion,
    gitDescribe,
    tag: null,
    commitDistance: null,
    commit: untagged?.[1] || null,
    dirty,
  }
}

export function aboutPanelOptions(buildInfo) {
  return {
    applicationName: 'Vibenote',
    applicationVersion: buildInfo.appVersion,
    version: buildInfo.gitDescribe,
  }
}

function gitOutput(repositoryRoot, args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

export function collectBuildInfo(appVersion, repositoryRoot) {
  try {
    let gitDescribe = gitOutput(repositoryRoot, ['describe', '--tags', '--long', '--dirty', '--always'])
    const dirty = gitOutput(repositoryRoot, ['status', '--porcelain', '--untracked-files=normal']).length > 0
    if (dirty && !gitDescribe.endsWith('-dirty')) gitDescribe += '-dirty'
    return parseGitDescribe(appVersion, gitDescribe)
  } catch {
    return parseGitDescribe(appVersion, 'unknown')
  }
}

export function loadBuildInfo(appVersion, { isPackaged, resourcesPath, repositoryRoot }) {
  if (!isPackaged) return collectBuildInfo(appVersion, repositoryRoot)

  try {
    const buildInfoPath = path.join(resourcesPath, 'app.asar', 'dist', 'build-info.json')
    const stored = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'))
    if (stored.appVersion !== appVersion || typeof stored.gitDescribe !== 'string') {
      return parseGitDescribe(appVersion, 'unknown')
    }
    return parseGitDescribe(appVersion, stored.gitDescribe)
  } catch {
    return parseGitDescribe(appVersion, 'unknown')
  }
}
