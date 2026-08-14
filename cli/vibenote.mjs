#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CLI_CONTRACT } from '../core/noteContract.js'
import { NoteStore } from '../core/noteStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))

const booleanOptions = new Set(['dry-run', 'accept-current', 'content-stdin', 'raw', 'no-color'])

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function parseArguments(argv) {
  const positionals = []
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) {
      positionals.push(value)
      continue
    }
    const name = value.slice(2)
    if (booleanOptions.has(name)) {
      options[camelCase(name)] = true
      continue
    }
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) throw cliError('INVALID_ARGUMENT', `Option --${name} requires a value`)
    options[camelCase(name)] = next
    index += 1
  }
  return { positionals, options }
}

function cliError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function commandName(positionals) {
  if (positionals[0] === 'notes') return `notes.${positionals[1] || ''}`
  if (positionals[0] === 'blocks') return `blocks.${positionals[1] || ''}`
  return positionals[0] || ''
}

function defaultUserDataPath() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Vibenote')
  throw cliError('PLATFORM_UNSUPPORTED', 'This platform has no declared default data directory')
}

function resolveDataDirectory(options) {
  if (options.dataDir) return { path: path.resolve(options.dataDir), source: 'argument', explicit: true }
  if (process.env.VIBENOTE_USER_DATA_DIR) return { path: path.resolve(process.env.VIBENOTE_USER_DATA_DIR), source: 'environment', explicit: false }
  return { path: defaultUserDataPath(), source: 'default', explicit: false }
}

function exitCodeFor(code) {
  if (['INVALID_ARGUMENT', 'CONTENT_TOO_LARGE'].includes(code)) return CLI_CONTRACT.exitCodes.usage
  if (['NOTE_NOT_FOUND', 'BLOCK_NOT_FOUND'].includes(code)) return CLI_CONTRACT.exitCodes.notFound
  if (['REVISION_CONFLICT', 'STORAGE_REVISION_CONFLICT', 'NOTE_BUSY', 'CURSOR_STALE'].includes(code)) return CLI_CONTRACT.exitCodes.conflict
  if (['MUTATION_SCOPE_DENIED', 'SCOPE_DENIED', 'PLATFORM_UNSUPPORTED', 'DESKTOP_COORDINATION_UNAVAILABLE'].includes(code)) return CLI_CONTRACT.exitCodes.denied
  if (['INVALID_NOTE_FORMAT', 'IDEMPOTENCY_CORRUPT', 'IDEMPOTENCY_MISMATCH'].includes(code)) return CLI_CONTRACT.exitCodes.dataSafety
  return CLI_CONTRACT.exitCodes.runtime
}

function jsonEnvelope(command, data) {
  return { ok: true, schemaVersion: CLI_CONTRACT.schemaVersion, command, data, warnings: [] }
}

function errorEnvelope(command, error) {
  return {
    ok: false,
    schemaVersion: CLI_CONTRACT.schemaVersion,
    command,
    error: {
      code: error.code || 'RUNTIME_ERROR',
      message: error.message || 'The command failed',
      retryable: Boolean(error.retryable),
    },
  }
}

function printSuccess(command, data, output) {
  const envelope = jsonEnvelope(command, data)
  if (output === 'json' || !process.stdout.isTTY) process.stdout.write(`${JSON.stringify(envelope)}\n`)
  else process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
}

const HELP_PAGES = Object.freeze({
  '': `Usage: vibenote <command> [options]

Commands:
  version              Show the Vibenote version
  capabilities         Show the versioned Agent CLI contract
  doctor               Check note storage health
  notes list           List internal notes
  notes read           Read an internal note
  blocks list          List blocks in an internal note
  blocks read          Read one block
  blocks append        Safely append one block
  search               Search internal note blocks

Run "vibenote <command> --help" for command options.
Run "vibenote capabilities" for the machine-readable command contract.
`,
  notes: `Usage: vibenote notes <command> [options]

Commands:
  notes list           List internal notes
  notes read           Read an internal note

Run "vibenote notes <command> --help" for command options.
`,
  blocks: `Usage: vibenote blocks <command> [options]

Commands:
  blocks list          List blocks in an internal note
  blocks read          Read one block
  blocks append        Safely append one block

Run "vibenote blocks <command> --help" for command options.
`,
  version: `Usage: vibenote version [--output json]
`,
  capabilities: `Usage: vibenote capabilities [--data-dir <path>] [--output json]
`,
  doctor: `Usage: vibenote doctor [--data-dir <path>] [--output json]
`,
  'notes.list': `Usage: vibenote notes list [--data-dir <path>] [--limit <n>] [--cursor <cursor>] [--output json]
`,
  'notes.read': `Usage: vibenote notes read --note <id> [--data-dir <path>] [--raw] [--output json]
`,
  'blocks.list': `Usage: vibenote blocks list --note <id> [--data-dir <path>] [--limit <n>] [--cursor <cursor>] [--output json]
`,
  'blocks.read': `Usage: vibenote blocks read --note <id> (--block <id> | --legacy-index <n>) [--offset <bytes>] [--max-bytes <bytes>] [--data-dir <path>] [--output json]
`,
  'blocks.append': `Usage: vibenote blocks append --data-dir <path> --note <id> (--content <text> | --content-stdin) --idempotency-key <key> (--expected-revision <revision> | --accept-current) [--language <language>] [--dry-run] [--output json]
`,
  search: `Usage: vibenote search --query <text> [--data-dir <path>] [--limit <n>] [--output json]
`,
})

function helpText(topic = '') {
  return HELP_PAGES[topic]
}

function helpTopic(argv) {
  if (argv.length === 0) return ''
  if (argv.length === 1 && ['help', '-h', '--help'].includes(argv[0])) return ''
  if (argv[0] === 'help') {
    const topic = argv.slice(1).join('.')
    return Object.hasOwn(HELP_PAGES, topic) ? topic : null
  }
  if (['-h', '--help'].includes(argv.at(-1))) {
    const topic = argv.slice(0, -1).join('.')
    return Object.hasOwn(HELP_PAGES, topic) ? topic : null
  }
  return null
}

async function execute(command, options, dataDirectory) {
  if (command === 'version') return { version: packageJson.version }
  const store = new NoteStore({ userDataPath: dataDirectory.path, appVersion: packageJson.version })
  if (command === 'capabilities') return store.capabilities()
  if (command === 'doctor') return { ...(await store.doctor()), pathSource: dataDirectory.source }
  if (command === 'notes.list') return store.listNotes({ limit: options.limit, cursor: options.cursor })
  if (command === 'notes.read') return store.readNote({ noteId: options.note, raw: options.raw })
  if (command === 'blocks.list') return store.listBlocks({ noteId: options.note, limit: options.limit, cursor: options.cursor })
  if (command === 'blocks.read') return store.readBlock({ noteId: options.note, blockId: options.block, legacyIndex: options.legacyIndex, offset: Number(options.offset || 0), maxBytes: options.maxBytes ? Number(options.maxBytes) : undefined })
  if (command === 'search') return store.search({ query: options.query, limit: options.limit })
  if (command === 'blocks.append') {
    if (!dataDirectory.explicit) throw cliError('MUTATION_SCOPE_DENIED', 'Mutation requires an explicit --data-dir until desktop coordination is enabled')
    if (options.content !== undefined && options.contentStdin) throw cliError('INVALID_ARGUMENT', 'Use either --content or --content-stdin')
    if (options.content === undefined && !options.contentStdin) throw cliError('INVALID_ARGUMENT', 'Content is required')
    const content = options.contentStdin ? fs.readFileSync(0, 'utf8') : options.content
    return store.appendBlock({
      noteId: options.note,
      language: options.language || 'markdown',
      content,
      idempotencyKey: options.idempotencyKey,
      expectedRevision: options.expectedRevision,
      acceptCurrent: options.acceptCurrent,
      dryRun: options.dryRun,
      auto: false,
    })
  }
  throw cliError('INVALID_ARGUMENT', 'Unknown command')
}

const argv = process.argv.slice(2)
const requestedHelpTopic = helpTopic(argv)
if (requestedHelpTopic !== null) {
  process.stdout.write(helpText(requestedHelpTopic))
} else {
  let command = ''
  try {
    const parsed = parseArguments(argv)
    command = commandName(parsed.positionals)
    const dataDirectory = command === 'version'
      ? { path: '', source: 'none', explicit: false }
      : resolveDataDirectory(parsed.options)
    const data = await execute(command, parsed.options, dataDirectory)
    printSuccess(command, data, parsed.options.output)
  } catch (error) {
    const envelope = errorEnvelope(command, error)
    process.stderr.write(`${JSON.stringify(envelope)}\n`)
    process.exitCode = exitCodeFor(error?.code)
  }
}
