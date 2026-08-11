#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const allowedEnvironmentExamples = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
])

const privateKeyHeader = new RegExp([
  '-'.repeat(5),
  'BEGIN ',
  '(?:RSA |EC |OPENSSH )?',
  'PRIVATE KEY',
  '-'.repeat(5),
].join(''))

const githubClassicPrefix = ['gh', 'p_'].join('')
const githubFineGrainedPrefix = ['github', 'pat', ''].join('_')

const contentRules = [
  {
    id: 'private-key',
    pattern: privateKeyHeader,
  },
  {
    id: 'github-token',
    pattern: new RegExp(`\\b(?:${githubClassicPrefix}[A-Za-z0-9]{30,}|${githubFineGrainedPrefix}[A-Za-z0-9_]{30,})\\b`),
  },
  {
    id: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    id: 'credential-bearing-url',
    pattern: /https?:\/\/[^\s/:@]+:[^\s/@]+@/i,
  },
  {
    id: 'macos-home-path',
    pattern: /\/Users\/[A-Za-z0-9._-]+\//,
  },
  {
    id: 'linux-home-path',
    pattern: /\/home\/[A-Za-z0-9._-]+\//,
  },
  {
    id: 'windows-home-path',
    pattern: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/i,
  },
  {
    id: 'private-hostname',
    pattern: /https?:\/\/[^\s/]+\.(?:internal|corp|intranet)(?=[:/\s]|$)/i,
  },
  {
    id: 'private-ip-url',
    pattern: /https?:\/\/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?=[:/\s]|$)/i,
  },
  {
    id: 'chinese-person-mention',
    pattern: /@[\p{Script=Han}]{2,8}/u,
  },
]

const blockedBasenames = new Set([
  'ai-key.bin',
  'ai-settings.json',
  'external-documents.json',
  'git-backup-settings.json',
  'git-backup-state.json',
  'id_ed25519',
  'id_rsa',
])

const blockedTopLevelDirectories = new Set([
  'backups',
  'private-notes',
  'recovery',
  'user-data',
])

export function sensitivePathRule(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/')
  const parts = normalized.split('/')
  const basename = parts.at(-1)?.toLowerCase() || ''
  const directories = parts.slice(0, -1).map(part => part.toLowerCase())

  if (directories.some(directory => blockedTopLevelDirectories.has(directory))) {
    return 'private-data-directory'
  }
  if (blockedBasenames.has(basename)) return 'private-data-file'
  if (basename === '.env' || (basename.startsWith('.env.') && !allowedEnvironmentExamples.has(basename))) {
    return 'environment-file'
  }
  if (/\.(?:key|pem|p12|pfx|mobileprovision)$/i.test(basename)) return 'credential-file'
  if (/^(?:credentials?|secrets?)(?:[._-].*)?\.json$/i.test(basename)) return 'credential-file'
  if (/\.vibenote$/i.test(basename)) return 'note-export'
  return null
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length
}

export function scanText(relativePath, text, extraRules = []) {
  const findings = []
  for (const rule of [...contentRules, ...extraRules]) {
    const match = rule.pattern.exec(text)
    rule.pattern.lastIndex = 0
    if (!match) continue
    findings.push({
      path: relativePath,
      line: lineNumberAt(text, match.index),
      rule: rule.id,
    })
  }
  return findings
}

function repositoryRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
}

function gitFiles(root, staged) {
  const args = staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
    : ['ls-files', '-z']
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

function configuredPatternValues(root) {
  let localPatterns = []
  try {
    localPatterns = execFileSync(
      'git',
      ['config', '--local', '--get-all', 'publicSafety.blockedPattern'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).split('\n')
  } catch {
    // No clone-local glossary has been configured.
  }

  return [
    ...(process.env.PUBLIC_SAFETY_BLOCKED_PATTERNS || '').split('\n'),
    ...localPatterns,
  ]
}

function extraContentRules(root) {
  return configuredPatternValues(root)
    .map(value => value.trim())
    .filter(Boolean)
    .map((value, index) => {
      try {
        return {
          id: `configured-pattern-${index + 1}`,
          pattern: new RegExp(value, 'i'),
        }
      } catch {
        throw new Error(`Invalid configured pattern at line ${index + 1}`)
      }
    })
}

function readFileContent(root, relativePath, staged) {
  if (staged) {
    return execFileSync('git', ['show', `:${relativePath}`], { cwd: root })
  }
  const fullPath = path.join(root, relativePath)
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null
  return fs.readFileSync(fullPath)
}

function scanFile(root, relativePath, extraRules, staged) {
  const findings = []
  const pathRule = sensitivePathRule(relativePath)
  if (pathRule) findings.push({ path: relativePath, line: null, rule: pathRule })

  const content = readFileContent(root, relativePath, staged)
  if (!content) return findings
  if (content.includes(0)) return findings
  return findings.concat(scanText(relativePath, content.toString('utf8'), extraRules))
}

export function runPublicSafetyCheck({ staged = false } = {}) {
  const root = repositoryRoot()
  const extraRules = extraContentRules(root)
  return gitFiles(root, staged).flatMap(file => scanFile(root, file, extraRules, staged))
}

function main() {
  const unknownArgs = process.argv.slice(2).filter(arg => arg !== '--staged' && arg !== '--tracked')
  if (unknownArgs.length > 0) {
    console.error(`Unknown argument: ${unknownArgs[0]}`)
    process.exitCode = 2
    return
  }

  let findings
  try {
    findings = runPublicSafetyCheck({ staged: process.argv.includes('--staged') })
  } catch (error) {
    console.error(`Public safety check could not run: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
    return
  }

  if (findings.length === 0) {
    console.log('Public safety check passed.')
    return
  }

  console.error('Public safety check failed. Matched content is intentionally not printed.')
  for (const finding of findings) {
    const location = finding.line ? `${finding.path}:${finding.line}` : finding.path
    console.error(`- ${location} [${finding.rule}]`)
  }
  process.exitCode = 1
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  main()
}
