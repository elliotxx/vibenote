import { formatInitialContent } from './common/noteFormat'

const STORAGE_KEY = 'vibenote:mock-buffers'

type MockBuffer = BufferInfo & { content: string }

function readBuffers(): MockBuffer[] {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return JSON.parse(stored)
  const buffers = [
    {
      path: 'stream.txt',
      name: 'Stream',
      tags: [],
      isScratch: true,
      content: `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${formatInitialContent('markdown')}# Stream\n\nDrop plain text notes here.\n\n---block:json;auto=0;created=${new Date().toISOString()}\n{"service":"api","ok":true}\n\n---block:sql;auto=0;created=${new Date().toISOString()}\nselect * from users where active = true\n\n---block:math;auto=0;created=${new Date().toISOString()}\n2 + 2 * 10\n`,
    },
    {
      path: 'api-notes.txt',
      name: 'API Notes',
      tags: [],
      isScratch: false,
      content: `${JSON.stringify({ formatVersion: '1.0.0', name: 'API Notes' })}\n${formatInitialContent('markdown')}# API Notes\n\nTemporary endpoint notes.\n`,
    },
  ]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buffers))
  return buffers
}

function writeBuffers(buffers: MockBuffer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buffers))
}

export function installDevMock() {
  if (window.vibenote) return
  window.vibenote = {
    buffer: {
      async list() {
        return readBuffers().map(({ content, ...buffer }) => buffer)
      },
      async load(path: string) {
        return readBuffers().find(buffer => buffer.path === path)?.content || ''
      },
      async save(path: string, content: string) {
        const buffers = readBuffers()
        const buffer = buffers.find(item => item.path === path)
        if (buffer) buffer.content = content
        writeBuffers(buffers)
        return true
      },
      saveSync(path: string, content: string) {
        const buffers = readBuffers()
        const buffer = buffers.find(item => item.path === path)
        if (buffer) buffer.content = content
        writeBuffers(buffers)
        return true
      },
      async create(name: string) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
        const path = `${slug}.txt`
        const buffers = readBuffers()
        buffers.push({
          path,
          name,
          tags: [],
          isScratch: false,
          content: `${JSON.stringify({ formatVersion: '1.0.0', name })}\n${formatInitialContent('markdown')}`,
        })
        writeBuffers(buffers)
        return path
      },
      async delete(path: string) {
        writeBuffers(readBuffers().filter(buffer => buffer.path !== path || buffer.isScratch))
        return true
      },
      async archiveStream(name: string) {
        const buffers = readBuffers()
        const stream = buffers.find(buffer => buffer.isScratch)!
        const path = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`
        buffers.push({ ...stream, path, name, isScratch: false })
        stream.content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${formatInitialContent('markdown')}`
        writeBuffers(buffers)
        return path
      },
    },
    library: {
      async search(query: string) {
        return readBuffers().flatMap(buffer =>
          buffer.content
            .split('\n')
            .map((line, index) => ({ line, index }))
            .filter(({ line }) => line.toLowerCase().includes(query.toLowerCase()))
            .map(({ line, index }) => ({
              path: buffer.path,
              line: index + 1,
              column: Math.max(0, line.toLowerCase().indexOf(query.toLowerCase())),
              preview: line.trim(),
            })),
        )
      },
    },
    image: {
      async save({ mime, data }: { mime: string; data: ArrayBuffer }) {
        return URL.createObjectURL(new Blob([data], { type: mime }))
      },
    },
    settings: {
      async getTheme() {
        return 'light'
      },
      async setTheme() {
        return true
      },
    },
    commands: {
      onEditorCommand() {
        return () => {}
      },
    },
  }
}
