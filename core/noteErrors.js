export class NoteError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'NoteError'
    this.code = code
    this.retryable = Boolean(options.retryable)
    this.exitCode = options.exitCode
  }
}

export function noteError(code, message, options) {
  return new NoteError(code, message, options)
}
