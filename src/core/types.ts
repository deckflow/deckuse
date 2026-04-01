/**
 * Core type definitions for DeckUse
 */

export interface DeckUseConfig {
  version: string
}

export interface SlideInfo {
  index: number
  id: string
  title?: string
  layout: string
  shapeCount: number
  hasNotes: boolean
}

export interface ShapeInfo {
  id: string
  name: string
  type: string
  bbox: { x: number; y: number; w: number; h: number }
  zOrder: number
  text?: string
}

export interface WorkspaceStatus {
  initialized: boolean
  sourceFile?: string
  valid: boolean
  hasChanges: boolean
  lastValidated?: Date
}

export interface WorkspaceMetadata {
  version: string
  sourcePptx?: string
  initialized: Date
  lastModified: Date
  /**
   * Complete presentation object from @deckflow/presentation parsing
   * This is the single source of truth for all PPTX structure data
   * Contains: slides, slideMasters, slideSize, defaultTextStyle, etc.
   */
  results?: any // Presentation.toJSON() result
}

export interface SlideIndex {
  index: number
  id: string
  title?: string
  layout: string
  path: string
}

export interface ShapeIndex {
  slideIndex: number
  shapeId: string
  shapeName: string
  shapeType: string
  text?: string
}

export interface LayoutIndex {
  id: string
  name: string
  path: string
  usedBySlides: number[]
}

export interface Selector {
  type: 'slide' | 'shape' | 'text' | 'layout'
  index?: number
  filters?: Record<string, string>
  path?: (string | Selector)[]  // Support nested selectors in path
  raw: string
}

export interface ResolvedTarget {
  slide: number
  shapeId?: string
  element: any
  metadata?: Record<string, unknown>
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  code: string
  message: string
  path?: string
}

export interface ValidationWarning {
  code: string
  message: string
  path?: string
}
