/**
 * Custom error classes for DeckUse
 */

export class DeckUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeckUseError'
    Error.captureStackTrace(this, this.constructor)
  }
}

export class WorkspaceNotInitializedError extends DeckUseError {
  constructor(path?: string) {
    super(
      path
        ? `Workspace not initialized at: ${path}`
        : 'Workspace not initialized'
    )
    this.name = 'WorkspaceNotInitializedError'
  }
}

export class WorkspaceInvalidError extends DeckUseError {
  constructor(message: string) {
    super(`Invalid workspace: ${message}`)
    this.name = 'WorkspaceInvalidError'
  }
}

export class InvalidSelectorError extends DeckUseError {
  constructor(selector: string, reason?: string) {
    super(
      reason
        ? `Invalid selector "${selector}": ${reason}`
        : `Invalid selector: ${selector}`
    )
    this.name = 'InvalidSelectorError'
  }
}

export class ValidationError extends DeckUseError {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class CommandError extends DeckUseError {
  constructor(command: string, message: string) {
    super(`Command "${command}" failed: ${message}`)
    this.name = 'CommandError'
  }
}

export class SelectorNotFoundError extends DeckUseError {
  constructor(selector: string) {
    super(`Selector not found: ${selector}`)
    this.name = 'SelectorNotFoundError'
  }
}

export class FileNotFoundError extends DeckUseError {
  constructor(path: string) {
    super(`File not found: ${path}`)
    this.name = 'FileNotFoundError'
  }
}
