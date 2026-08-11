import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exportGitBackup, verifyGitBackupSnapshot } from '../electron/gitBackupExport.js'

const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-export-check-'))
const userData = path.join(root, 'profile')
const notesPath = path.join(userData, 'notes')
const userImagesPath = path.join(userData, 'images')
const repositoryPath = path.join(root, 'repository')

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }

async function directoryHash(directory) {
  const records = []
  async function visit(current) {
    for (const entry of (await fs.promises.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(fullPath)
      else records.push(`${path.relative(directory, fullPath)}:${sha256(await fs.promises.readFile(fullPath))}`)
    }
  }
  await visit(directory)
  return sha256(records.join('\n'))
}

try {
  await Promise.all([notesPath, userImagesPath, repositoryPath].map(directory => fs.promises.mkdir(directory, { recursive: true })))
  const besideAssets = path.join(notesPath, 'stream.assets')
  const appAssets = path.join(userImagesPath, 'stream-fixture')
  await fs.promises.mkdir(besideAssets, { recursive: true })
  await fs.promises.mkdir(appAssets, { recursive: true })
  const besideImage = path.join(besideAssets, 'sample image.png')
  const appImage = path.join(appAssets, 'sample image.png')
  await fs.promises.writeFile(besideImage, Buffer.from('synthetic-beside-image'))
  await fs.promises.writeFile(appImage, Buffer.from('synthetic-app-image'))
  await fs.promises.writeFile(path.join(notesPath, 'stream.txt'), `Synthetic stream\n![beside](<${besideImage}>)\n![app](<${appImage}>)\n![remote](https://example.com/asset.png)\n`)
  await fs.promises.writeFile(path.join(notesPath, 'archive.txt'), 'Synthetic archive\n')
  await fs.promises.writeFile(path.join(userData, 'external-documents.json'), JSON.stringify([{ fixture: true }]))
  await fs.promises.mkdir(path.join(userData, 'recovery'))
  await fs.promises.writeFile(path.join(userData, 'recovery', 'fixture.txt'), 'excluded fixture')

  const sourceBefore = await directoryHash(userData)
  const manifest = await exportGitBackup({ notesPath, userImagesPath, repositoryPath, appVersion: 'runtime-fixture' })
  assert.equal(manifest.documents.length, 2)
  assert.equal(manifest.assets.length, 2)
  assert.equal(new Set(manifest.assets.map(asset => asset.exportPath)).size, 2)
  assert.equal(await verifyGitBackupSnapshot(repositoryPath), true)
  assert.equal(await directoryHash(userData), sourceBefore)
  assert.equal(fs.existsSync(path.join(repositoryPath, 'vibenote-backup', 'external-documents.json')), false)
  console.log('ok - snapshot manifest and hashes verify without changing the source profile')

  const movedRepository = path.join(root, 'relocated-repository')
  await fs.promises.cp(repositoryPath, movedRepository, { recursive: true })
  const exportedStream = await fs.promises.readFile(path.join(movedRepository, 'vibenote-backup', 'notes', 'stream.txt'), 'utf8')
  assert.doesNotMatch(exportedStream, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  for (const match of exportedStream.matchAll(/!\[[^\]]*]\(<([^>]+)>\)/g)) {
    const resolved = path.resolve(movedRepository, 'vibenote-backup', 'notes', match[1])
    assert.equal((await fs.promises.stat(resolved)).isFile(), true)
  }
  console.log('ok - relative image links remain valid after repository relocation')

  const publishedNote = path.join(repositoryPath, 'vibenote-backup', 'notes', 'stream.txt')
  await fs.promises.appendFile(publishedNote, 'outside edit\n')
  await assert.rejects(
    exportGitBackup({ notesPath, userImagesPath, repositoryPath, appVersion: 'runtime-fixture' }),
    error => error.code === 'mirror-conflict',
  )
  assert.match(await fs.promises.readFile(publishedNote, 'utf8'), /outside edit/)
  console.log('ok - mirror conflict fails closed and preserves external edits')

  const incompleteRepository = path.join(root, 'incomplete-repository')
  await fs.promises.mkdir(incompleteRepository)
  const missingImage = path.join(besideAssets, 'missing.png')
  await fs.promises.writeFile(path.join(notesPath, 'stream.txt'), `![missing](<${missingImage}>)\n`)
  await assert.rejects(
    exportGitBackup({ notesPath, userImagesPath, repositoryPath: incompleteRepository, appVersion: 'runtime-fixture' }),
    error => error.code === 'export-incomplete',
  )
  assert.equal(fs.existsSync(path.join(incompleteRepository, 'vibenote-backup')), false)
  console.log('ok - missing images never publish an incomplete snapshot')

  const failureRepository = path.join(root, 'failure-repository')
  await fs.promises.mkdir(failureRepository)
  await fs.promises.writeFile(path.join(notesPath, 'stream.txt'), 'Stable synthetic note\n')
  await exportGitBackup({ notesPath, userImagesPath, repositoryPath: failureRepository, appVersion: 'runtime-fixture' })
  const stableSnapshotHash = await directoryHash(path.join(failureRepository, 'vibenote-backup'))
  await fs.promises.writeFile(path.join(notesPath, 'stream.txt'), 'New synthetic note\n')
  await assert.rejects(exportGitBackup({ notesPath, userImagesPath, repositoryPath: failureRepository, appVersion: 'runtime-fixture', faultAt: 'switch' }))
  assert.equal(await directoryHash(path.join(failureRepository, 'vibenote-backup')), stableSnapshotHash)
  assert.equal(await verifyGitBackupSnapshot(failureRepository), true)
  console.log('ok - an interrupted atomic switch restores the prior verified snapshot')

  const unsafeRepository = path.join(root, 'unsafe-repository')
  const outsideImage = path.join(root, 'outside.png')
  await fs.promises.mkdir(unsafeRepository)
  await fs.promises.writeFile(outsideImage, 'outside fixture')
  await fs.promises.writeFile(path.join(notesPath, 'stream.txt'), `![outside](<${outsideImage}>)\n`)
  await assert.rejects(
    exportGitBackup({ notesPath, userImagesPath, repositoryPath: unsafeRepository, appVersion: 'runtime-fixture' }),
    error => error.code === 'export-incomplete',
  )
  console.log('ok - images outside managed storage are rejected')
} finally {
  await fs.promises.rm(root, { recursive: true, force: true })
}
