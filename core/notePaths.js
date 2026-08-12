import path from 'node:path'

export function notePaths(userDataPath) {
  const userData = path.resolve(userDataPath)
  const runtime = path.join(userData, 'runtime')
  return {
    userData,
    notes: path.join(userData, 'notes'),
    snapshots: path.join(userData, 'backups'),
    recovery: path.join(userData, 'recovery'),
    runtime,
    locks: path.join(runtime, 'locks'),
  }
}
