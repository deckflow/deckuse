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
  idPath?: number[]             // Canonical id path (e.g. #22 -> [22])
  paragraphIndex?: number       // Paragraph index from p:N
  raw: string
}

export type PageType = 'slide' | 'slideLayout' | 'slideMaster'

export interface ResolvedTarget {
  /**
   * 对于 pageType=slide: slideIndex (1-based)
   * 对于 pageType=slideLayout: layoutIndex (1-based, flattened)
   * 对于 pageType=slideMaster: masterIndex (1-based)
   */
  slide: number
  shapeId?: string
  element: any
  metadata?: Record<string, unknown>
  pageType?: PageType
}

/**
 * 段落级定位结果，可直接传给 pptx-modifier
 * idPath 最后追加 paragraphIndex 即为 overwriteApTextByIdPath 的完整 idPath
 */
export interface ResolvedParagraph {
  pageType: PageType
  pageIndex: number
  idPath: number[]
  paragraphIndex: number
  text: string
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
