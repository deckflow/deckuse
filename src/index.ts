/**
 * DeckUse library entry point
 * Exports public API for programmatic use
 */

// Core classes
export { Workspace } from './core/workspace.js'
export { SelectorParser, SelectorResolver } from './core/selector.js'

// Reader/Writer
export { PptxReader } from './readers/pptx-reader.js'
export { PptxWriter } from './writers/pptx-writer.js'

// Commands
export { initCommand } from './commands/init.js'
export { statusCommand } from './commands/status.js'
export { commitCommand } from './commands/commit.js'
export { listSlidesCommand } from './commands/list-slides.js'
export { showSlideCommand } from './commands/show-slide.js'
export { getTextCommand } from './commands/get-text.js'
export { setTextCommand } from './commands/set-text.js'
export { replaceTextCommand } from './commands/replace-text.js'
export { setFontSizeCommand } from './commands/set-font-size.js'

// Types
export type {
  DeckUseConfig,
  SlideInfo,
  ShapeInfo,
  WorkspaceStatus,
  WorkspaceMetadata,
  SlideIndex,
  ShapeIndex,
  LayoutIndex,
  Selector,
  ResolvedTarget,
  ValidationResult,
  ValidationError as ValidationErrorType,
  ValidationWarning,
} from './core/types.js'

// Errors
export {
  DeckUseError,
  WorkspaceNotInitializedError,
  WorkspaceInvalidError,
  InvalidSelectorError,
  ValidationError,
  CommandError,
  SelectorNotFoundError,
  FileNotFoundError,
} from './utils/errors.js'

// Utilities
export { Logger, logger } from './utils/logger.js'
export type { LogLevel } from './utils/logger.js'
